#!/usr/bin/env node

import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run') || !args.has('--apply');
const apply = args.has('--apply');
const reset = args.has('--reset');
const json = args.has('--json');

const sqlitePath = path.resolve(
  projectRoot,
  process.env.TRACKMASTER_SQLITE_PATH || process.env.TRACKMASTER_SQLITE_DB || 'data/trackmaster.sqlite'
);
const databaseUrl = process.env.TRACKMASTER_MIGRATION_DATABASE_URL || '';
const allowProductionTarget = process.env.TRACKMASTER_ALLOW_PRODUCTION_POSTGRES_IMPORT === 'I_UNDERSTAND_THIS_WRITES_TO_TARGET';
const reportsDir = path.resolve(projectRoot, process.env.TRACKMASTER_MIGRATION_REPORT_DIR || 'migration-reports');

const tableSpecs = [
  {
    name: 'users',
    order: 'id',
    columns: ['id', 'email', 'password_hash', 'created_at'],
    createSql: `
      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        created_at text NOT NULL DEFAULT (now()::text)
      );
    `,
  },
  {
    name: 'tracks',
    order: 'id',
    columns: ['id', 'user_id', 'file_name', 'storage_path', 'status', 'duration_seconds', 'size_bytes', 'format', 'created_at'],
    createSql: `
      CREATE TABLE IF NOT EXISTS tracks (
        id text PRIMARY KEY,
        user_id text REFERENCES users(id) ON DELETE SET NULL,
        file_name text NOT NULL,
        storage_path text NOT NULL UNIQUE,
        status text NOT NULL DEFAULT 'mastered',
        duration_seconds double precision,
        size_bytes bigint,
        format text,
        created_at text NOT NULL DEFAULT (now()::text)
      );
    `,
  },
  {
    name: 'presets',
    order: 'id',
    columns: [
      'id',
      'user_id',
      'name',
      'eq_low',
      'eq_mid',
      'eq_high',
      'comp_threshold',
      'comp_ratio',
      'makeup_gain',
      'delay_time',
      'delay_feedback',
      'delay_mix',
      'reverb_decay',
      'reverb_mix',
      'saturation_drive',
      'saturation_mix',
      'created_at',
      'updated_at',
    ],
    createSql: `
      CREATE TABLE IF NOT EXISTS presets (
        id text PRIMARY KEY,
        user_id text REFERENCES users(id) ON DELETE SET NULL,
        name text NOT NULL,
        eq_low double precision NOT NULL,
        eq_mid double precision NOT NULL,
        eq_high double precision NOT NULL,
        comp_threshold double precision NOT NULL,
        comp_ratio double precision NOT NULL,
        makeup_gain double precision NOT NULL,
        delay_time double precision NOT NULL,
        delay_feedback double precision NOT NULL,
        delay_mix double precision NOT NULL,
        reverb_decay double precision NOT NULL,
        reverb_mix double precision NOT NULL,
        saturation_drive double precision NOT NULL,
        saturation_mix double precision NOT NULL,
        created_at text NOT NULL DEFAULT (now()::text),
        updated_at text NOT NULL DEFAULT (now()::text)
      );
    `,
  },
];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parsePgEnv(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_err) {
    fail('TRACKMASTER_MIGRATION_DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    fail('TRACKMASTER_MIGRATION_DATABASE_URL must use postgres:// or postgresql://.');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    fail('TRACKMASTER_MIGRATION_DATABASE_URL must include a database name.');
  }

  return {
    PGHOST: parsed.hostname || 'localhost',
    PGPORT: parsed.port || '5432',
    PGDATABASE: database,
    PGUSER: decodeURIComponent(parsed.username || ''),
    PGPASSWORD: decodeURIComponent(parsed.password || ''),
  };
}

function assertSafeTarget(pgEnv) {
  const safeName = /(^|[_-])(rehearsal|dryrun|scratch|test|tmp|temporary)([_-]|$)/i.test(pgEnv.PGDATABASE);
  if (!safeName && !allowProductionTarget) {
    fail(
      `Refusing to write to database "${pgEnv.PGDATABASE}". Use an isolated rehearsal/test database name, ` +
      'or set TRACKMASTER_ALLOW_PRODUCTION_POSTGRES_IMPORT=I_UNDERSTAND_THIS_WRITES_TO_TARGET.'
    );
  }
}

function psql(pgEnv, input, extraArgs = []) {
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', ...extraArgs], {
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      PGHOST: pgEnv.PGHOST,
      PGPORT: pgEnv.PGPORT,
      PGDATABASE: pgEnv.PGDATABASE,
      PGUSER: pgEnv.PGUSER,
      PGPASSWORD: pgEnv.PGPASSWORD,
    },
  });

  if (result.error) {
    fail(`Unable to run psql: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(result.stderr || result.stdout || `psql exited with status ${result.status}`);
  }
  return result.stdout;
}

function sqliteRows(db, spec) {
  const quoted = spec.columns.map((column) => `"${column}"`).join(', ');
  return db.prepare(`SELECT ${quoted} FROM ${spec.name} ORDER BY ${spec.order}`).all();
}

function canonicalRows(rows, columns) {
  return rows.map((row) => {
    const out = {};
    for (const column of columns) out[column] = row[column] ?? null;
    return out;
  });
}

function checksumRows(rows, columns) {
  return createHash('sha256').update(JSON.stringify(canonicalRows(rows, columns))).digest('hex');
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertSql(spec, rows) {
  if (rows.length === 0) return '';
  const columns = spec.columns.map((column) => `"${column}"`).join(', ');
  const values = rows.map((row) => `(${spec.columns.map((column) => sqlLiteral(row[column])).join(', ')})`).join(',\n');
  return `INSERT INTO ${spec.name} (${columns}) VALUES\n${values};\n`;
}

function importSql(source) {
  const statements = [];
  if (reset) {
    statements.push('DROP TABLE IF EXISTS presets;');
    statements.push('DROP TABLE IF EXISTS tracks;');
    statements.push('DROP TABLE IF EXISTS users;');
  }
  for (const spec of tableSpecs) statements.push(spec.createSql.trim());
  for (const spec of tableSpecs) {
    if (!reset) statements.push(`DELETE FROM ${spec.name};`);
    statements.push(insertSql(spec, source[spec.name].rows));
  }
  return `BEGIN;\n${statements.filter(Boolean).join('\n')}\nCOMMIT;\n`;
}

function pgRows(pgEnv, spec) {
  const columns = spec.columns.map((column) => `"${column}"`).join(', ');
  const output = psql(
    pgEnv,
    `COPY (SELECT row_to_json(t)::text FROM (SELECT ${columns} FROM ${spec.name} ORDER BY ${spec.order}) t) TO STDOUT;\n`,
    ['-q', '-t', '-A']
  ).trim();
  return output ? output.split('\n').map((line) => JSON.parse(line)) : [];
}

function ensureSqliteReadable() {
  if (!fs.existsSync(sqlitePath)) {
    fail(`SQLite source not found: ${sqlitePath}`);
  }
}

function main() {
  ensureSqliteReadable();
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const source = {};
  for (const spec of tableSpecs) {
    const rows = sqliteRows(db, spec);
    source[spec.name] = {
      count: rows.length,
      checksum: checksumRows(rows, spec.columns),
      rows,
    };
  }
  db.close();

  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    sqlitePath,
    postgres: null,
    source: Object.fromEntries(tableSpecs.map((spec) => [spec.name, {
      count: source[spec.name].count,
      checksum: source[spec.name].checksum,
    }])),
    target: null,
    validation: dryRun ? 'not-run' : 'pending',
    generatedAt: new Date().toISOString(),
  };

  let pgEnv = null;
  if (apply) {
    if (!databaseUrl) fail('TRACKMASTER_MIGRATION_DATABASE_URL is required for --apply.');
    pgEnv = parsePgEnv(databaseUrl);
    assertSafeTarget(pgEnv);
    summary.postgres = {
      host: pgEnv.PGHOST,
      port: pgEnv.PGPORT,
      database: pgEnv.PGDATABASE,
      user: pgEnv.PGUSER || null,
      reset,
    };
    psql(pgEnv, importSql(source));

    const target = {};
    for (const spec of tableSpecs) {
      const rows = pgRows(pgEnv, spec);
      target[spec.name] = {
        count: rows.length,
        checksum: checksumRows(rows, spec.columns),
      };
    }
    summary.target = target;
    const mismatches = tableSpecs.filter((spec) => (
      summary.source[spec.name].count !== target[spec.name].count ||
      summary.source[spec.name].checksum !== target[spec.name].checksum
    ));
    summary.validation = mismatches.length === 0 ? 'passed' : 'failed';
    if (mismatches.length > 0) {
      summary.mismatches = mismatches.map((spec) => spec.name);
    }
  }

  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `trackmaster-postgres-rehearsal-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o640 });
  summary.reportPath = reportPath;

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`TrackMaster Postgres rehearsal ${summary.mode}`);
    console.log(`SQLite source: ${summary.sqlitePath}`);
    for (const spec of tableSpecs) {
      const src = summary.source[spec.name];
      console.log(`source ${spec.name}: count=${src.count} checksum=${src.checksum}`);
    }
    if (summary.target) {
      for (const spec of tableSpecs) {
        const tgt = summary.target[spec.name];
        console.log(`target ${spec.name}: count=${tgt.count} checksum=${tgt.checksum}`);
      }
      console.log(`validation: ${summary.validation}`);
    }
    console.log(`report: ${reportPath}`);
  }

  if (summary.validation === 'failed') process.exit(1);
}

main();
