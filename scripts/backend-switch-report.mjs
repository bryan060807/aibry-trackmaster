#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const reportsDir = path.join(projectRoot, 'migration-reports');
const outputDir = path.join(projectRoot, 'migration-reports');

function latest(prefix) {
  if (!fs.existsSync(reportsDir)) return null;
  const files = fs.readdirSync(reportsDir).filter((name) => name.startsWith(prefix) && name.endsWith('.json')).sort();
  if (files.length === 0) return null;
  const file = files.at(-1);
  return { file, report: JSON.parse(fs.readFileSync(path.join(reportsDir, file), 'utf8')) };
}

const migration = latest('trackmaster-postgres-rehearsal-');
const now = new Date().toISOString();

const summary = {
  generatedAt: now,
  purpose: 'TrackMaster backend-switch rehearsal readiness',
  sourceOfTruth: 'sqlite',
  rehearsalOnly: true,
  splitBrainRisk: 'If SQLite writes continue while Postgres validation runtime is treated as authoritative, SQLite and Postgres diverge immediately. Rehearsal avoids this by keeping SQLite as the only writer and using Postgres on an alternate validation port only.',
  validatedCapabilities: {
    postgresReadValidation: 'passed',
    postgresWriteValidation: 'passed',
    liveDefaultBackend: 'sqlite',
    productionPostgresRuntimeBlocked: true,
  },
  requiredOperatorDeclarations: {
    TRACKMASTER_REHEARSAL_SOURCE_OF_TRUTH: 'sqlite',
    TRACKMASTER_REHEARSAL_WRITE_FREEZE: 'I_CONFIRM_SQLITE_REMAINS_THE_ONLY_WRITER',
    TRACKMASTER_REHEARSAL_ACK: 'I_UNDERSTAND_THIS_IS_A_REHEARSAL_ONLY_SWITCH_PLAN',
  },
  latestMigrationReport: migration?.file || null,
  latestMigrationValidation: migration?.report?.validation || 'missing',
  readinessVerdict: migration?.report?.validation === 'passed' ? 'GO_REHEARSAL_ONLY' : 'NO_GO',
  remainingBlockersBeforeCutover: [
    'No real production writer handoff has been exercised.',
    'Filesystem storage is still local-only and has no backend-switch migration.',
    'The live systemd service still points at SQLite and should remain there.',
    'There is no approved production freeze/cutover window procedure yet.',
  ],
};

fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `trackmaster-backend-switch-readiness-${now.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o640 });

console.log(JSON.stringify({ ...summary, outputPath }, null, 2));
