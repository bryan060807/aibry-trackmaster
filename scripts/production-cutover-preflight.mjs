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

const freezeAck = 'I_CONFIRM_THE_APPROVED_CUTOVER_FREEZE_WINDOW_IS_ACTIVE';
const sourceOfTruthAck = 'sqlite_until_handoff';
const riskAck = 'I_UNDERSTAND_FILESYSTEM_AUDIO_REMAINS_ON_FEDORA';

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

function latest(prefix) {
  if (!fs.existsSync(reportsDir)) return null;
  const files = fs.readdirSync(reportsDir).filter((name) => name.startsWith(prefix) && name.endsWith('.json')).sort();
  if (files.length === 0) return null;
  const file = files.at(-1);
  return { file, report: JSON.parse(fs.readFileSync(path.join(reportsDir, file), 'utf8')) };
}

function check(name, ok, detail) {
  return { name, ok, detail };
}

const envFile = fs.existsSync(envPath) ? parseEnvFile(fs.readFileSync(envPath, 'utf8')) : {};
const serviceFile = fs.existsSync(servicePath) ? fs.readFileSync(servicePath, 'utf8') : '';
const readiness = latest('trackmaster-backend-switch-readiness-');
const rehearsal = latest('trackmaster-postgres-rehearsal-');

const checks = [
  check('.env exists', fs.existsSync(envPath), envPath),
  check('live env still defaults to sqlite', !envFile.TRACKMASTER_REPOSITORY_BACKEND || envFile.TRACKMASTER_REPOSITORY_BACKEND === 'sqlite', envFile.TRACKMASTER_REPOSITORY_BACKEND || '(unset)'),
  check('live env has no postgres validation opt-in', !envFile.TRACKMASTER_ENABLE_POSTGRES_RUNTIME, envFile.TRACKMASTER_ENABLE_POSTGRES_RUNTIME || '(unset)'),
  check('api service still references production env-file flow', serviceFile.includes('--env-file /home/aibry/projects/aibry-trackmaster/.env'), servicePath),
  check('sqlite source exists', fs.existsSync(sqlitePath), sqlitePath),
  check('filesystem uploads path exists', fs.existsSync(uploadsPath), uploadsPath),
  check('backend-switch readiness report exists', Boolean(readiness), readiness?.file || '(missing)'),
  check('backend-switch readiness verdict is rehearsal only', readiness?.report?.readinessVerdict === 'GO_REHEARSAL_ONLY', readiness?.report?.readinessVerdict || '(missing)'),
  check('latest postgres rehearsal passed', rehearsal?.report?.validation === 'passed', rehearsal?.file || '(missing)'),
  check('approved freeze window acknowledged', process.env.TRACKMASTER_CUTOVER_FREEZE === freezeAck, process.env.TRACKMASTER_CUTOVER_FREEZE || '(unset)'),
  check('source-of-truth handoff acknowledged', process.env.TRACKMASTER_CUTOVER_SOURCE_OF_TRUTH === sourceOfTruthAck, process.env.TRACKMASTER_CUTOVER_SOURCE_OF_TRUTH || '(unset)'),
  check('filesystem storage limitation acknowledged', process.env.TRACKMASTER_CUTOVER_STORAGE_ACK === riskAck, process.env.TRACKMASTER_CUTOVER_STORAGE_ACK || '(unset)'),
];

const blockingConditions = [
  'Production cutover is still unapproved in code and docs.',
  'Filesystem audio remains on Fedora and is not migrated or abstracted.',
  'No final live writer handoff has been exercised.',
  'No production service override file or audited env switch artifact exists yet.',
];

const summary = {
  generatedAt: new Date().toISOString(),
  intendedAction: 'production-cutover-planning-only',
  checks,
  blockingConditions,
  verdict: 'NO_GO',
};

console.log(JSON.stringify(summary, null, 2));

process.exit(1);
