#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const reportsDir = path.join(projectRoot, 'migration-reports');

function latest(prefix) {
  if (!fs.existsSync(reportsDir)) return null;
  const files = fs.readdirSync(reportsDir).filter((name) => name.startsWith(prefix) && name.endsWith('.json')).sort();
  if (files.length === 0) return null;
  const file = files.at(-1);
  return { file, report: JSON.parse(fs.readFileSync(path.join(reportsDir, file), 'utf8')) };
}

const readiness = latest('trackmaster-backend-switch-readiness-');
const rehearsal = latest('trackmaster-postgres-rehearsal-');
const now = new Date().toISOString();

const summary = {
  generatedAt: now,
  purpose: 'TrackMaster production cutover planning status',
  currentLiveBackend: 'sqlite',
  postgresReadValidation: readiness?.report?.validatedCapabilities?.postgresReadValidation || 'missing',
  postgresWriteValidation: readiness?.report?.validatedCapabilities?.postgresWriteValidation || 'missing',
  latestBackendSwitchReadiness: readiness?.file || null,
  latestMigrationRehearsal: rehearsal?.file || null,
  filesystemStorageConstraint: 'Audio files remain on Fedora local filesystem. This does not block a metadata backend cutover by itself, but it means cutover keeps Fedora as the storage host and requires rollback to preserve those same paths.',
  cutoverChecklistStatus: {
    rehearsalCoverageComplete: readiness?.report?.readinessVerdict === 'GO_REHEARSAL_ONLY',
    productionWriterHandoffApproved: false,
    finalFreezeWindowApproved: false,
    rollbackWindowApproved: false,
    serviceSwitchArtifactPrepared: false,
  },
  remainingBlockers: [
    'No approved production freeze window or owner sign-off is recorded.',
    'No final service env change artifact has been reviewed for production use.',
    'No executed production handoff from SQLite writer to Postgres writer has been approved.',
    'Filesystem audio remains local to Fedora, so cutover is metadata-only and rollback must preserve the same host paths.',
  ],
  schedulingVerdict: 'NO_GO',
};

fs.mkdirSync(reportsDir, { recursive: true });
const outputPath = path.join(reportsDir, `trackmaster-production-cutover-plan-${now.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o640 });

console.log(JSON.stringify({ ...summary, outputPath }, null, 2));
