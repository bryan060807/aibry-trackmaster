import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createStaticWebApp, isEntryPoint } from './static-web.js';

test('recognizes the PM2 script path as the static-web entry point', () => assert.equal(isEntryPoint(undefined, fileURLToPath(new URL('./static-web.js', import.meta.url))), true));

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

let upstream;
let staticWeb;
let staticWebBaseUrl;

before(async () => {
  upstream = http.createServer(async (req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'upstream' }));
      return;
    }

    if (req.url === '/api/auth/login') {
      let body = '';
      for await (const chunk of req) body += chunk;
      res.writeHead(201, {
        'content-type': 'application/json',
        'set-cookie': ['tm_session=proxy-test; Path=/; HttpOnly', 'tm_pref=compact; Path=/'],
        'x-upstream-status': 'created',
      });
      res.end(JSON.stringify({ method: req.method, body }));
      return;
    }

    if (req.url === '/api/fail') {
      req.socket.destroy();
      return;
    }

    if (req.url === '/api/tracks?async=1') {
      let body = '';
      for await (const chunk of req) body += chunk;
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ body }));
      return;
    }

    res.writeHead(404).end();
  });

  const upstreamPort = await listen(upstream);
  staticWeb = http.createServer(createStaticWebApp({
    host: '127.0.0.1',
    port: 0,
    apiOrigin: new URL(`http://127.0.0.1:${upstreamPort}`),
    canonicalOrigin: new URL('https://trackmaster.aibrylabs.com'),
    legacyOrigins: [new URL('https://trackmaster.aibry.shop')],
    apiTimeoutMs: 100,
    apiUploadTimeoutMs: 1000,
  }));
  const staticPort = await listen(staticWeb);
  staticWebBaseUrl = `http://127.0.0.1:${staticPort}`;
});

after(async () => {
  await new Promise((resolve) => staticWeb.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
});

test('proxies GET /api/health', async () => {
  const response = await fetch(`${staticWebBaseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'upstream' });
});

test('redirects the legacy app host before auth or API proxying', async () => {
  const response = await fetch(`${staticWebBaseUrl}/auth/aibry-id/callback?code=test-code&state=test-state`, {
    headers: { 'x-forwarded-host': 'trackmaster.aibry.shop' },
    redirect: 'manual',
  });

  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get('location'),
    'https://trackmaster.aibrylabs.com/auth/aibry-id/callback?code=test-code&state=test-state',
  );
});

test('forwards POST /api/auth/login body and response headers', async () => {
  const requestBody = JSON.stringify({ email: 'proxy-test@example.invalid' });
  const response = await fetch(`${staticWebBaseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: requestBody,
  });

  assert.equal(response.status, 201);
  assert.equal(response.headers.get('x-upstream-status'), 'created');
  assert.deepEqual(response.headers.getSetCookie(), [
    'tm_session=proxy-test; Path=/; HttpOnly',
    'tm_pref=compact; Path=/',
  ]);
  assert.deepEqual(await response.json(), { method: 'POST', body: requestBody });
});

test('returns JSON 502 when the upstream request fails', async () => {
  const response = await fetch(`${staticWebBaseUrl}/api/fail`);

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: 'TrackMaster API unavailable' });
});

test('allows a streaming track upload to exceed the normal API timeout', async () => {
  async function* slowBody() {
    yield 'first-';
    await new Promise((resolve) => setTimeout(resolve, 150));
    yield 'second';
  }

  const response = await fetch(`${staticWebBaseUrl}/api/tracks?async=1`, {
    method: 'POST',
    body: Readable.from(slowBody()),
    duplex: 'half',
  });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { body: 'first-second' });
});
