#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const dataRoot = path.join(projectRoot, 'data');
const sqlitePath = path.join(dataRoot, 'trackmaster.sqlite');
const uploadsPath = path.join(dataRoot, 'uploads');

function access(targetPath, mode) {
  try {
    fs.accessSync(targetPath, mode);
    return true;
  } catch (_err) {
    return false;
  }
}

function sampleEntries(root, limit = 12) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .slice(0, limit)
    .map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
    }));
}

function check(name, ok, detail) {
  return { name, ok, detail };
}

const checks = [
  check('data root exists', fs.existsSync(dataRoot), dataRoot),
  check('sqlite source exists', fs.existsSync(sqlitePath), sqlitePath),
  check('sqlite source is readable', access(sqlitePath, fs.constants.R_OK), sqlitePath),
  check('uploads path exists', fs.existsSync(uploadsPath), uploadsPath),
  check('uploads path is readable', access(uploadsPath, fs.constants.R_OK | fs.constants.X_OK), uploadsPath),
];

const report = {
  generatedAt: new Date().toISOString(),
  purpose: 'Fedora storage preflight',
  storageConstraint: 'TrackMaster audio uploads must remain Fedora-backed during metadata cutover and rollback.',
  paths: {
    dataRoot,
    sqlitePath,
    uploadsPath,
  },
  uploadsTopLevelEntries: sampleEntries(uploadsPath),
  checks,
};

console.log(JSON.stringify(report, null, 2));

if (checks.some((entry) => !entry.ok)) {
  process.exit(1);
}
