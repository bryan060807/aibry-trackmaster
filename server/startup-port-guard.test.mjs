import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { classifyListener, startWithPortGuard } from './startup-port-guard.js';

let server;
let port;

before(async () => {
  server = http.createServer((request, response) => {
    if (request.url === '/api/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, service: 'trackmaster-api' }));
      return;
    }

    response.writeHead(404).end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('classifies a matching API health response as an expected TrackMaster listener', async () => {
  const result = await classifyListener({
    host: '127.0.0.1',
    port,
    expectedService: 'trackmaster-api',
    healthPath: '/api/health',
  });

  assert.equal(result.state, 'expected');
  assert.equal(result.status, 200);
});

test('does not classify an occupied listener with the wrong health identity as TrackMaster', async () => {
  const result = await classifyListener({
    host: '127.0.0.1',
    port,
    expectedService: 'trackmaster-ui',
    healthPath: '/health',
  });

  assert.equal(result.state, 'unexpected');
  assert.equal(result.status, 404);
});

test('holds for a healthy existing instance and starts after takeover becomes possible', async () => {
  const states = [{ state: 'expected' }, { state: 'free' }];
  const delays = [];
  let starts = 0;

  const result = await startWithPortGuard({
    host: '127.0.0.1',
    port: 3004,
    expectedService: 'trackmaster-api',
    healthPath: '/api/health',
    classify: async () => states.shift(),
    sleepFn: async (delayMs) => delays.push(delayMs),
    logger: null,
    start: async () => {
      starts += 1;
      return 'started';
    },
  });

  assert.equal(result, 'started');
  assert.equal(starts, 1);
  assert.deepEqual(delays, [2000]);
});

test('fails unknown ownership without attempting to start or kill a process', async () => {
  let starts = 0;

  await assert.rejects(
    () => startWithPortGuard({
      host: '127.0.0.1',
      port: 3004,
      expectedService: 'trackmaster-api',
      healthPath: '/api/health',
      classify: async () => ({ state: 'unexpected', status: 200 }),
      logger: null,
      start: async () => {
        starts += 1;
      },
    }),
    /unknown listener.*No process was terminated/,
  );

  assert.equal(starts, 0);
});
