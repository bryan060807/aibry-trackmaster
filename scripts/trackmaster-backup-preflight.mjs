#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const sqlitePath = path.join(projectRoot, 'data/trackmaster.sqlite');
const uploadsPath = path.join(projectRoot, 'data/uploads');
const backupRoot = process.env.TRACKMASTER_BACKUP_DIR || '/home/aibry/backups/trackmaster';
const backupParent = path.dirname(backupRoot);

function access(targetPath, mode) {
  try {
    fs.accessSync(targetPath, mode);
    return true;
  } catch (_err) {
    return false;
  }
}

function check(name, ok, detail) {
  return { name, ok, detail };
}

const timestampExample = new Date().toISOString().replace(/[:.]/g, '-');
const checks = [
  check('sqlite source exists', fs.existsSync(sqlitePath), sqlitePath),
  check('sqlite source is readable', access(sqlitePath, fs.constants.R_OK), sqlitePath),
  check('uploads path exists', fs.existsSync(uploadsPath), uploadsPath),
  check('uploads path is readable', access(uploadsPath, fs.constants.R_OK | fs.constants.X_OK), uploadsPath),
  check('backup parent exists', fs.existsSync(backupParent), backupParent),
  check('backup parent is writable by operator', access(backupParent, fs.constants.W_OK), backupParent),
];

const report = {
  generatedAt: new Date().toISOString(),
  purpose: 'Fedora backup preflight',
  recommendedBackupRoot: backupRoot,
  timestampExample,
  expectedArtifacts: {
    sqliteSnapshot: path.join(backupRoot, `trackmaster.sqlite.${timestampExample}`),
    uploadsArchive: path.join(backupRoot, `uploads.${timestampExample}.tar`),
    uploadsManifest: path.join(backupRoot, `uploads.${timestampExample}.sha256`),
    envBackup: path.join(backupRoot, `.env.${timestampExample}`),
  },
  checks,
};

console.log(JSON.stringify(report, null, 2));

if (checks.some((entry) => !entry.ok)) {
  process.exit(1);
}
