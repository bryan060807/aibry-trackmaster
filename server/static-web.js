import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const indexFile = path.join(distDir, 'index.html');

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

const host = process.env.HOST || '127.0.0.1';
const port = readPort(process.env.PORT);
const app = express();

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

app.use('/api', (_req, res) => {
  res.status(502).json({
    ok: false,
    error: 'This static host does not proxy /api. Use the TrackMaster API port directly or the approved front-door proxy.',
  });
});

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

app.listen(port, host, () => {
  console.log(`trackmaster-ui static host listening on http://${host}:${port}`);
});
