#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
const servicePath = path.join(projectRoot, 'deploy/trackmaster-api.service');
const sqlitePath = path.join(projectRoot, 'data/trackmaster.sqlite');
const uploadsPath = path.join(projectRoot, 'data/uploads');
const reportsDir = path.join(projectRoot, 'migration-reports');

const sourceOfTruthAck = 'sqlite';
const writeFreezeAck = 'I_CONFIRM_SQLITE_REMAINS_THE_ONLY_WRITER';
const rehearsalAck = 'I_UNDERSTAND_THIS_IS_A_REHEARSAL_ONLY_SWITCH_PLAN';

function parseEnvFile(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    values[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return values;
}

function safeDatabaseName(databaseUrl) {
  if (!databaseUrl) return null;
  const parsed = new URL(databaseUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  return /(^|[_-])(rehearsal|dryrun|scratch|test|tmp|temporary)([_-]|$)/i.test(database) ? database : null;
}

function latestPassedMigrationReport() {
  if (!fs.existsSync(reportsDir)) return null;
  const files = fs.readdirSync(reportsDir)
    .filter((name) => name.startsWith('trackmaster-postgres-rehearsal-') && name.endsWith('.json'))
    .sort();
  if (files.length === 0) return null;
  const latest = files.at(-1);
  const report = JSON.parse(fs.readFileSync(path.join(reportsDir, latest), 'utf8'));
  return report.validation === 'passed' ? { file: latest, report } : null;
}

function check(name, ok, detail) {
  return { name, ok, detail };
}

const envFile = fs.existsSync(envPath) ? parseEnvFile(fs.readFileSync(envPath, 'utf8')) : {};
const serviceFile = fs.existsSync(servicePath) ? fs.readFileSync(servicePath, 'utf8') : '';
const latestReport = latestPassedMigrationReport();
const postgresUrl = process.env.TRACKMASTER_POSTGRES_URL || process.env.TRACKMASTER_MIGRATION_DATABASE_URL || '';
const rehearsalDatabase = safeDatabaseName(postgresUrl);

const checks = [
  check('.env exists', fs.existsSync(envPath), envPath),
  check('live env backend remains sqlite/unset', !envFile.TRACKMASTER_REPOSITORY_BACKEND || envFile.TRACKMASTER_REPOSITORY_BACKEND === 'sqlite', envFile.TRACKMASTER_REPOSITORY_BACKEND || '(unset)'),
  check('live env does not opt into postgres runtime', !envFile.TRACKMASTER_ENABLE_POSTGRES_RUNTIME, envFile.TRACKMASTER_ENABLE_POSTGRES_RUNTIME || '(unset)'),
  check('api service pins NODE_ENV=production', serviceFile.includes('--env NODE_ENV=production'), servicePath),
  check('sqlite source exists', fs.existsSync(sqlitePath), sqlitePath),
  check('filesystem uploads path exists', fs.existsSync(uploadsPath), uploadsPath),
  check('source-of-truth declared as sqlite', process.env.TRACKMASTER_REHEARSAL_SOURCE_OF_TRUTH === sourceOfTruthAck, process.env.TRACKMASTER_REHEARSAL_SOURCE_OF_TRUTH || '(unset)'),
  check('write freeze acknowledged', process.env.TRACKMASTER_REHEARSAL_WRITE_FREEZE === writeFreezeAck, process.env.TRACKMASTER_REHEARSAL_WRITE_FREEZE || '(unset)'),
  check('rehearsal ack set', process.env.TRACKMASTER_REHEARSAL_ACK === rehearsalAck, process.env.TRACKMASTER_REHEARSAL_ACK || '(unset)'),
  check('passed migration rehearsal report exists', Boolean(latestReport), latestReport?.file || '(missing)'),
  check('postgres target is rehearsal-scoped', Boolean(rehearsalDatabase), rehearsalDatabase || '(unset or unsafe)'),
];

const summary = {
  generatedAt: new Date().toISOString(),
  rehearsalOnly: true,
  liveSourceOfTruth: 'sqlite',
  liveBackendMustRemain: 'sqlite',
  postgresValidationOnly: true,
  checks,
};

console.log(JSON.stringify(summary, null, 2));

if (checks.some((entry) => !entry.ok)) {
  process.exit(1);
}
