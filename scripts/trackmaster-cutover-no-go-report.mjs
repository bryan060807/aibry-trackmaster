#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const reportsDir = path.join(projectRoot, 'migration-reports');
const envPath = path.join(projectRoot, '.env');

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

const envFile = fs.existsSync(envPath) ? parseEnvFile(fs.readFileSync(envPath, 'utf8')) : {};
const readiness = latest('trackmaster-fedora-readiness-report-');
const rehearsal = latest('trackmaster-postgres-rehearsal-');

const blockers = [
  'No approved production freeze window is recorded.',
  'No owner sign-off is recorded.',
  'No reviewed production .env switch artifact is recorded.',
  'No approved final writer handoff from SQLite to Postgres is recorded.',
  'Live trackmaster-api.service intentionally remains SQLite.',
  'Split-brain risk remains if SQLite writes continue while Postgres is treated as authoritative.',
];

const report = {
  generatedAt: new Date().toISOString(),
  purpose: 'TrackMaster production cutover NO_GO report',
  verdict: 'NO_GO',
  currentLiveBackend: envFile.TRACKMASTER_REPOSITORY_BACKEND || 'sqlite (implicit default)',
  latestFedoraReadinessReport: readiness?.file || null,
  latestRehearsalImportReport: rehearsal?.file || null,
  blockers,
  operatorReminder: 'Do not execute production cutover commands until every blocker is explicitly cleared in an approved change window.',
};

fs.mkdirSync(reportsDir, { recursive: true });
const outputPath = path.join(reportsDir, `trackmaster-cutover-no-go-report-${report.generatedAt.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o640 });

console.log(JSON.stringify({ outputPath, report }, null, 2));
process.exit(1);
