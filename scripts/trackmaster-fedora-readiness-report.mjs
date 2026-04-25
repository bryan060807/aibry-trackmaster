#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const reportsDir = path.join(projectRoot, 'migration-reports');
const envPath = path.join(projectRoot, '.env');
const repoServicePath = path.join(projectRoot, 'deploy/trackmaster-api.service');
const installedServicePath = path.join('/home/aibry/.config/systemd/user', 'trackmaster-api.service');
const sqlitePath = path.join(projectRoot, 'data/trackmaster.sqlite');
const uploadsPath = path.join(projectRoot, 'data/uploads');
const nginxPath = path.join(projectRoot, 'deploy/nginx.conf');
const backupRoot = process.env.TRACKMASTER_BACKUP_DIR || '/home/aibry/backups/trackmaster';
const backupParent = path.dirname(backupRoot);

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

function run(command, args, { input, env } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input,
    env: env ? { ...process.env, ...env } : process.env,
  });

  if (result.error) {
    return { ok: false, code: null, stdout: '', stderr: result.error.message };
  }

  return {
    ok: result.status === 0,
    code: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function statSummary(targetPath) {
  try {
    const stats = fs.statSync(targetPath);
    return {
      path: targetPath,
      exists: true,
      type: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
      sizeBytes: stats.size,
      mode: `0${(stats.mode & 0o777).toString(8)}`,
    };
  } catch (_err) {
    return { path: targetPath, exists: false };
  }
}

function countUploadFiles(root) {
  if (!fs.existsSync(root)) return { files: 0, bytes: 0 };
  const stack = [root];
  let files = 0;
  let bytes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
        continue;
      }
      if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(next).size;
      }
    }
  }

  return { files, bytes };
}

function check(name, ok, detail) {
  return { name, ok, detail };
}

function safeBooleanFromEnv(value) {
  return !value || String(value).trim().toLowerCase() === 'sqlite';
}

function taskmasterDbConnection() {
  const inspect = run('podman', ['inspect', 'taskmaster-db', '--format', '{{json .Config.Env}}']);
  if (!inspect.ok || !inspect.stdout) {
    return { available: false, detail: inspect.stderr || inspect.stdout || 'podman inspect failed' };
  }

  const envEntries = JSON.parse(inspect.stdout);
  const envMap = Object.fromEntries(envEntries.map((entry) => {
    const idx = entry.indexOf('=');
    return [entry.slice(0, idx), entry.slice(idx + 1)];
  }));

  const password = envMap.POSTGRES_PASSWORD || '';
  const user = envMap.POSTGRES_USER || '';
  if (!password || !user) {
    return { available: false, detail: 'taskmaster-db container does not expose usable credentials' };
  }

  return {
    available: true,
    host: '127.0.0.1',
    port: '5432',
    user,
    password,
  };
}

function postgresReadiness() {
  const connection = taskmasterDbConnection();
  if (!connection.available) {
    return {
      reachable: false,
      trackmasterRehearsalExists: null,
      trackmasterProductionExists: null,
      currentUser: null,
      permissionsReady: null,
      detail: connection.detail,
    };
  }

  const catalog = run(
    'psql',
    ['-h', connection.host, '-p', connection.port, '-U', connection.user, '-d', 'postgres', '-Atqc',
      "SELECT 'db=' || datname FROM pg_database WHERE datname IN ('trackmaster_rehearsal','trackmaster_production'); " +
      "SELECT 'owner=' || datname || ':' || pg_get_userbyid(datdba) FROM pg_database WHERE datname IN ('trackmaster_rehearsal','trackmaster_production');"
    ],
    { env: { PGPASSWORD: connection.password } }
  );

  if (!catalog.ok) {
    return {
      reachable: false,
      trackmasterRehearsalExists: null,
      trackmasterProductionExists: null,
      currentUser: null,
      permissionsReady: null,
      detail: catalog.stderr || catalog.stdout || `psql exited with status ${catalog.code}`,
    };
  }

  const catalogLines = catalog.stdout.split('\n').filter(Boolean);
  const rehearsalExists = catalogLines.includes('db=trackmaster_rehearsal');
  const productionExists = catalogLines.includes('db=trackmaster_production');
  const rehearsalOwnedByAibry = catalogLines.includes('owner=trackmaster_rehearsal:aibry');

  let rehearsalTables = [];
  let permissionsReady = null;
  let currentUser = null;

  if (rehearsalExists) {
    const rehearsal = run(
      'psql',
      ['-h', connection.host, '-p', connection.port, '-U', connection.user, '-d', 'trackmaster_rehearsal', '-Atqc',
        "SELECT current_user; " +
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name; " +
        "SELECT has_database_privilege(current_user, current_database(), 'CONNECT'); " +
        "SELECT has_database_privilege(current_user, current_database(), 'CREATE');"
      ],
      { env: { PGPASSWORD: connection.password } }
    );

    if (rehearsal.ok) {
      const lines = rehearsal.stdout.split('\n').filter(Boolean);
      currentUser = lines[0] || null;
      rehearsalTables = lines.slice(1, 4);
      const privilegeFlags = lines.slice(4).map((value) => value === 't');
      permissionsReady = privilegeFlags.length === 2 ? privilegeFlags.every(Boolean) : null;
    }
  }

  return {
    reachable: true,
    trackmasterRehearsalExists: rehearsalExists,
    trackmasterProductionExists: productionExists,
    rehearsalOwnedByAibry,
    currentUser,
    rehearsalTables,
    permissionsReady,
    detail: 'queried via local taskmaster-db container credentials',
  };
}

const envFile = fs.existsSync(envPath) ? parseEnvFile(fs.readFileSync(envPath, 'utf8')) : {};
const repoService = fs.existsSync(repoServicePath) ? fs.readFileSync(repoServicePath, 'utf8') : '';
const installedService = fs.existsSync(installedServicePath) ? fs.readFileSync(installedServicePath, 'utf8') : '';
const serviceStatus = run('systemctl', ['--user', 'show', 'trackmaster-api.service', '-p', 'LoadState', '-p', 'ActiveState', '-p', 'SubState', '-p', 'FragmentPath', '-p', 'UnitFileState']);
const webStatus = run('systemctl', ['--user', 'show', 'trackmaster-web.service', '-p', 'ActiveState', '-p', 'SubState']);
const podmanPs = run('podman', ['ps', '--format', '{{.Names}} {{.Status}}']);
const readiness = latest('trackmaster-backend-switch-readiness-');
const rehearsal = latest('trackmaster-postgres-rehearsal-');
const cutover = latest('trackmaster-production-cutover-plan-');
const uploads = countUploadFiles(uploadsPath);
const postgres = postgresReadiness();

const checks = [
  check('sqlite source file exists', fs.existsSync(sqlitePath), sqlitePath),
  check('uploads path exists on Fedora', fs.existsSync(uploadsPath), uploadsPath),
  check('installed API unit exists', fs.existsSync(installedServicePath), installedServicePath),
  check('live API service is active', serviceStatus.stdout.includes('ActiveState=active') && serviceStatus.stdout.includes('SubState=running'), serviceStatus.stdout || serviceStatus.stderr),
  check('live API unit uses repo env-file', installedService.includes(`--env-file ${envPath}`), installedServicePath),
  check('live API unit mounts Fedora data path', installedService.includes(`--volume ${path.join(projectRoot, 'data')}:/app/data:Z`), installedServicePath),
  check('live env backend is sqlite/unset', safeBooleanFromEnv(envFile.TRACKMASTER_REPOSITORY_BACKEND), envFile.TRACKMASTER_REPOSITORY_BACKEND || '(unset)'),
  check('live env has no postgres runtime opt-in', !envFile.TRACKMASTER_ENABLE_POSTGRES_RUNTIME, envFile.TRACKMASTER_ENABLE_POSTGRES_RUNTIME || '(unset)'),
  check('running API container has no postgres backend env', !podmanPs.stdout.includes('trackmaster-api') || !run('podman', ['inspect', 'trackmaster-api', '--format', '{{json .Config.Env}}']).stdout.includes('TRACKMASTER_REPOSITORY_BACKEND=postgres'), 'podman inspect trackmaster-api'),
  check('rehearsal migration report passed', rehearsal?.report?.validation === 'passed', rehearsal?.file || '(missing)'),
  check('backend-switch readiness is rehearsal-only GO', readiness?.report?.readinessVerdict === 'GO_REHEARSAL_ONLY', readiness?.report?.readinessVerdict || '(missing)'),
  check('production cutover remains NO_GO', cutover?.report?.schedulingVerdict === 'NO_GO', cutover?.report?.schedulingVerdict || '(missing)'),
  check('trackmaster_rehearsal exists', postgres.trackmasterRehearsalExists === true, String(postgres.trackmasterRehearsalExists)),
  check('rehearsal db has expected tables', Array.isArray(postgres.rehearsalTables) && ['presets', 'tracks', 'users'].every((table) => postgres.rehearsalTables.includes(table)), (postgres.rehearsalTables || []).join(', ') || '(unverified)'),
  check('rehearsal db permissions are ready for current user', postgres.permissionsReady === true, postgres.permissionsReady === null ? '(unverified)' : String(postgres.permissionsReady)),
];

const report = {
  generatedAt: new Date().toISOString(),
  purpose: 'Fedora-side TrackMaster readiness report',
  productionSourceOfTruth: {
    backend: 'sqlite',
    sqlitePath,
    liveApiService: 'trackmaster-api.service',
    liveEnvPath: envPath,
    serviceUnitRepoPath: repoServicePath,
    installedServicePath,
    serviceStatus: serviceStatus.ok ? serviceStatus.stdout : serviceStatus.stderr,
    currentEnvBackend: envFile.TRACKMASTER_REPOSITORY_BACKEND || 'sqlite (implicit default)',
    currentEnvPostgresRuntimeOptIn: envFile.TRACKMASTER_ENABLE_POSTGRES_RUNTIME || '(unset)',
    currentApiContainerUsesPostgres: false,
    apiServiceConfigSummary: {
      repoEnvFile: repoService.includes(`--env-file ${envPath}`),
      repoDataMount: repoService.includes(`--volume ${path.join(projectRoot, 'data')}:/app/data:Z`),
      productionNodeEnv: repoService.includes('--env NODE_ENV=production'),
    },
  },
  storage: {
    uploadsPath,
    uploadsPathMustRemainFedoraBacked: true,
    uploadInventory: uploads,
    sqlite: statSummary(sqlitePath),
    uploadsDir: statSummary(uploadsPath),
    recommendedBackupRoot: backupRoot,
    backupParentExists: fs.existsSync(backupParent),
  },
  routing: {
    nginxConfigPath: nginxPath,
    repoNginxPresent: fs.existsSync(nginxPath),
    publicWebTunnel: 'trackmaster.aibry.shop -> http://127.0.0.1:3000',
    publicApiTunnel: 'trackmaster-api.aibry.shop -> http://127.0.0.1:3004',
    webServiceStatus: webStatus.ok ? webStatus.stdout : webStatus.stderr,
  },
  rehearsal: {
    latestReadinessReport: readiness?.file || null,
    latestRehearsalImportReport: rehearsal?.file || null,
    latestRehearsalImportValidation: rehearsal?.report?.validation || 'missing',
    postgres,
  },
  windowsWriterAssessment: {
    fedoraLocalEvidenceOnly: true,
    localTrackmasterProcesses: podmanPs.stdout.split('\n').filter((line) => /trackmaster/i.test(line)),
    windowsWriterActive: 'unverified_from_fedora_only',
    detail: 'No Fedora-local Windows TrackMaster writer process or service was identified. Remote Windows writer state cannot be proven from this host alone.',
  },
  cutoverReadiness: {
    verdict: 'NO_GO',
    latestCutoverPlanningReport: cutover?.file || null,
    blockers: cutover?.report?.remainingBlockers || [
      'No approved production freeze window is recorded.',
      'No owner sign-off is recorded.',
      'No reviewed production env switch artifact exists.',
      'No approved final writer handoff from SQLite to Postgres exists.',
    ],
  },
  checks,
};

fs.mkdirSync(reportsDir, { recursive: true });
const outputPath = path.join(reportsDir, `trackmaster-fedora-readiness-report-${report.generatedAt.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o640 });

console.log(JSON.stringify({ outputPath, report }, null, 2));

if (checks.some((entry) => !entry.ok)) {
  process.exit(1);
}
