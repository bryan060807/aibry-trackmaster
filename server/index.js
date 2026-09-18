import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWithPortGuard } from './startup-port-guard.js';

const require = createRequire(import.meta.url);
const { loadRuntimeEnv } = require('./runtime-env.cjs');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

loadRuntimeEnv({ projectRoot });

const { startServer } = await import('../trackmaster-api/src/server.js');

const host = process.env.TRACKMASTER_HOST || '127.0.0.1';
const configuredPort = Number.parseInt(process.env.PORT || '', 10);
const port = Number.isFinite(configuredPort) ? configuredPort : 3004;

startWithPortGuard({
  host,
  port,
  expectedService: 'trackmaster-api',
  healthPath: '/api/health',
  start: () => startServer(),
}).catch((err) => {
  console.error('Failed to start trackmaster-api', err);
  process.exit(1);
});
