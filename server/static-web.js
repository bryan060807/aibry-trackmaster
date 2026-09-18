import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { startWithPortGuard } from './startup-port-guard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const indexFile = path.join(distDir, 'index.html');
const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function readApiOrigin(value) {
  let origin;

  try {
    origin = new URL(value || 'http://127.0.0.1:3004');
  } catch {
    throw new Error('TRACKMASTER_API_ORIGIN must be a valid http or https origin.');
  }

  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error('TRACKMASTER_API_ORIGIN must be an http or https origin without credentials or a path.');
  }

  return origin;
}

function readApiTimeout(value, {
  name = 'TRACKMASTER_API_TIMEOUT_MS',
  fallback = '15000',
  max = 120000,
} = {}) {
  const rawValue = value || fallback;
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be a whole number from 100 to ${max}.`);
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (parsed < 100 || parsed > max) {
    throw new Error(`${name} must be a whole number from 100 to ${max}.`);
  }

  return parsed;
}

function readWebOrigin(value, name, fallback) {
  let origin;

  try {
    origin = new URL(value || fallback);
  } catch {
    throw new Error(`${name} must be a valid http or https origin.`);
  }

  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error(`${name} must be an http or https origin without credentials or a path.`);
  }

  return origin;
}

function readLegacyOrigins(value) {
  return String(value || 'https://trackmaster.aibry.shop')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => readWebOrigin(entry, 'TRACKMASTER_LEGACY_ORIGINS', 'https://trackmaster.aibry.shop'));
}

function requestHost(req) {
  return (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().toLowerCase();
}

function createLegacyHostRedirect(canonicalOrigin, legacyOrigins) {
  const legacyHosts = new Set(legacyOrigins.map((origin) => origin.host.toLowerCase()));

  return function redirectLegacyHost(req, res, next) {
    if (!legacyHosts.has(requestHost(req))) return next();

    const location = new URL(req.originalUrl, canonicalOrigin);
    return res.redirect(308, location.toString());
  };
}

function distReady() {
  return fs.existsSync(indexFile);
}

function readPort(value) {
  const rawValue = value || '3000';
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`Invalid PORT "${rawValue}". Use a number from 1 to 65535.`);
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid PORT "${rawValue}". Use a number from 1 to 65535.`);
  }

  return parsed;
}

function buildProxyHeaders(headers) {
  const proxyHeaders = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase();
    if (
      !value ||
      normalizedKey === 'host' ||
      normalizedKey === 'content-length' ||
      normalizedKey === 'origin' ||
      hopByHopHeaders.has(normalizedKey)
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) proxyHeaders.append(key, item);
      continue;
    }

    proxyHeaders.set(key, value);
  }

  return proxyHeaders;
}

function isTrackUpload(req) {
  return req.method === 'POST' && /^\/api(?:\/v1)?\/tracks(?:\?|$)/.test(req.originalUrl);
}

function createApiProxy(apiOrigin, apiTimeoutMs, apiUploadTimeoutMs) {
  return async function proxyToApi(req, res) {
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const controller = new AbortController();
    const timeoutMs = isTrackUpload(req) ? apiUploadTimeoutMs : apiTimeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (!req.originalUrl.startsWith('/') || req.originalUrl.startsWith('//')) {
        return res.status(400).json({ ok: false, error: 'Invalid API request path.' });
      }

      const upstreamUrl = new URL(req.originalUrl, apiOrigin);
      if (upstreamUrl.origin !== apiOrigin.origin) {
        return res.status(400).json({ ok: false, error: 'Invalid API request path.' });
      }

      const upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers: buildProxyHeaders(req.headers),
        body: hasBody ? req : undefined,
        duplex: hasBody ? 'half' : undefined,
        redirect: 'manual',
        signal: controller.signal,
      });

      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie' && !hopByHopHeaders.has(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      });

      const setCookies = upstream.headers.getSetCookie?.() || [];
      if (setCookies.length) res.setHeader('set-cookie', setCookies);

      if (!upstream.body) {
        res.end();
        return;
      }

      Readable.fromWeb(upstream.body).pipe(res);
    } catch {
      const timedOut = controller.signal.aborted;
      console.error(timedOut ? 'trackmaster-ui proxy timeout' : 'trackmaster-ui proxy error');
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.status(timedOut ? 504 : 502).json({
        ok: false,
        error: timedOut ? 'TrackMaster API request timed out' : 'TrackMaster API unavailable',
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}

export function createStaticWebApp({
  host = process.env.HOST || '127.0.0.1',
  port = readPort(process.env.PORT),
  apiOrigin = readApiOrigin(process.env.TRACKMASTER_API_ORIGIN),
  canonicalOrigin = readWebOrigin(
    process.env.TRACKMASTER_CANONICAL_ORIGIN,
    'TRACKMASTER_CANONICAL_ORIGIN',
    'https://trackmaster.aibrylabs.com',
  ),
  legacyOrigins = readLegacyOrigins(process.env.TRACKMASTER_LEGACY_ORIGINS),
  apiTimeoutMs = readApiTimeout(process.env.TRACKMASTER_API_TIMEOUT_MS),
  apiUploadTimeoutMs = readApiTimeout(process.env.TRACKMASTER_API_UPLOAD_TIMEOUT_MS, {
    name: 'TRACKMASTER_API_UPLOAD_TIMEOUT_MS',
    fallback: '300000',
    max: 900000,
  }),
} = {}) {
  const app = express();
  const proxyToApi = createApiProxy(apiOrigin, apiTimeoutMs, apiUploadTimeoutMs);
  const redirectLegacyHost = createLegacyHostRedirect(canonicalOrigin, legacyOrigins);

  app.use(redirectLegacyHost);
  app.get('/health', (_req, res) => {
    const ready = distReady();
    res.status(ready ? 200 : 503).json({
      ok: ready,
      service: 'trackmaster-ui',
      distReady: ready,
      host,
      port,
    });
  });

  app.use('/auth', proxyToApi);
  app.use('/api', proxyToApi);
  app.use(express.static(distDir, { fallthrough: true }));

  app.get('*', (req, res) => {
    if (!distReady()) {
      return res.status(503).json({
        ok: false,
        error: 'Frontend build is missing. Run npm run build before starting the production static host.',
      });
    }

    if (path.extname(req.path)) {
      return res.status(404).json({
        ok: false,
        error: 'Asset not found.',
      });
    }

    return res.sendFile(indexFile);
  });

  return app;
}

export function isEntryPoint(
  argvEntryPath = process.argv[1],
  pmExecPath = process.env.pm_exec_path,
) {
  return [argvEntryPath, pmExecPath].some(
    (entryPath) => entryPath && path.resolve(entryPath) === fileURLToPath(import.meta.url),
  );
}

if (isEntryPoint()) {
  const host = process.env.HOST || '127.0.0.1';
  const port = readPort(process.env.PORT);
  const app = createStaticWebApp({ host, port });
  const start = () => new Promise((resolve, reject) => {
    const listener = app.listen(port, host, () => {
      listener.off('error', reject);
      console.log(`trackmaster-ui static host listening on http://${host}:${port}`);
      resolve(listener);
    });
    listener.once('error', reject);
  });

  startWithPortGuard({
    host,
    port,
    expectedService: 'trackmaster-ui',
    start,
  }).catch((error) => {
    console.error('Failed to start trackmaster-ui', error);
    process.exit(1);
  });
}
