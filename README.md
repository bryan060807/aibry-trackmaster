# AIBRY TrackMaster

Garage-native browser mastering rack.

TrackMaster is a Vite/React frontend plus a local Node/Express API. The browser
does the audio processing with the Web Audio API; the API stores mastering logs,
custom presets, and exported audio on the garage server using SQLite and the
local filesystem.

## Architecture

- Frontend: static Vite build served by nginx
- API: Express on `127.0.0.1:3004`
- Database: `data/trackmaster.sqlite`
- Storage: `data/uploads/`
- Public web entry: Cloudflare Tunnel to `http://127.0.0.1:3000`
- Public API entry: Cloudflare Tunnel to `http://127.0.0.1:3004`
- Auth: local account login with JWT-protected API routes

Current live ownership stays on the Fedora host. The Windows-side PM2 scaffold
in this repo is readiness-only; it binds to localhost, uses a separate
`data-windows-readiness/` SQLite data directory, and must not be saved into the
Windows PM2 resurrect list as a production process.

The repo now also includes a separate Windows production PM2 scaffold in
`ecosystem.production.config.cjs`. That file is for an approved Windows cutover
only. It must not reuse `trackmaster-windows-readiness-api`, and it must not be
started while placeholder secrets, placeholder Postgres connection values, or
placeholder storage paths are still in place.

## Repository Layout

The current split is intentional and these paths are required source, not
duplicates:

- `server/`: compatibility API launcher. `server/index.js` starts
  `trackmaster-api/src/server.js`.
- `trackmaster-api/`: API-owned source, tests, migrations, and Fedora cutover
  docs. This tree is copied by the API container build and is required for
  runtime validation.
- `src/`: current Vite UI entrypoint and React app shell.
- `trackmaster-ui/`: UI-owned split source introduced during the scaffold pass.
  The root UI still builds from `src/`, but `src/lib/api.ts` intentionally
  re-exports the shared API/session client from `trackmaster-ui/src/lib`.
- `deploy/`: Fedora live deployment assets.
- `scripts/` and `docs/`: Windows-readiness operator helpers and runbooks.

Only generated artifacts stay ignored: `dist/`, `data/`,
`data-windows-readiness/`, `node_modules/`, and `trackmaster-api/reports/`.

## Repository Backend

The runtime supports a narrow repository abstraction for `users`, `sessions`,
`tracks`, and `presets`.

- Default backend: SQLite
- Validation backend: Postgres
- Production safety: SQLite remains the default and Postgres runtime is opt-in
  for validation or approved cutover work only

Runtime selector env vars:

- `TRACKMASTER_REPOSITORY_BACKEND=sqlite|postgres`
- `TRACKMASTER_ENABLE_POSTGRES_RUNTIME=I_UNDERSTAND_THIS_IS_VALIDATION_ONLY`
- `TRACKMASTER_POSTGRES_URL=postgresql://...`
- `TRACKMASTER_POSTGRES_POOL_MAX=5`

## Local Development

```bash
npm ci
npm run dev:api
npm run dev
```

The Vite dev server proxies `/api` to `http://127.0.0.1:3004`.

## Validation

```bash
npm run lint
npm run build
npm audit --audit-level=high
```

Windows readiness helpers remain available from the root workspace:

```bash
npm run start:windows-readiness
npm run pm2:windows-readiness:status
```

Those commands are for readiness and cutover artifact generation only. They do
not replace the Fedora-hosted live service.

## Postgres Migration Rehearsal

The live TrackMaster API still uses SQLite and local filesystem audio storage.
Do not point the production API at Postgres in this phase.

This checkout includes a Fedora-local rehearsal/import CLI for validating the
current SQLite data against an isolated Postgres database. It does not change the
runtime entrypoint, systemd unit, API routes, or audio storage path.

Required local inputs:

- SQLite source:
  `TRACKMASTER_MIGRATION_SQLITE_PATH` or `TRACKMASTER_SQLITE_PATH`, defaulting to
  `data/trackmaster.sqlite`
- Postgres target:
  `TRACKMASTER_MIGRATION_POSTGRES_URL` or `TRACKMASTER_MIGRATION_DATABASE_URL`
- Report directory:
  `TRACKMASTER_MIGRATION_REPORT_DIR`, defaulting to `migration-reports/`

Target guardrail:

- `npm run migration:rehearsal` refuses to write unless the target database name
  contains `rehearsal`, `dryrun`, `scratch`, `test`, `tmp`, or `temporary`.
- A production-looking target requires the explicit override
  `TRACKMASTER_ALLOW_PRODUCTION_POSTGRES_IMPORT=I_UNDERSTAND_THIS_WRITES_TO_TARGET`.
  Do not use that override for Fedora rehearsal.

Dry-run source validation:

```bash
npm run migration:dry-run
```

Isolated Postgres rehearsal:

```bash
createdb trackmaster_rehearsal
export TRACKMASTER_MIGRATION_DATABASE_URL='postgresql://trackmaster_migrator:<password>@127.0.0.1:5432/trackmaster_rehearsal'
npm run migration:rehearsal
```

The rehearsal creates/imports `users`, `tracks`, and `presets`, then validates
source and target row counts plus table-level SHA-256 checksums. JSON reports are
written under `migration-reports/`.

## Postgres API Read Validation

The Postgres backend exists for validation only. It uses the same route shapes
and response mappers as SQLite, and it leaves filesystem audio storage under
`data/uploads/`.

SQLite mode:

```bash
TRACKMASTER_REPOSITORY_BACKEND=sqlite npm run dev:api
```

Postgres validation mode:

```bash
export TRACKMASTER_REPOSITORY_BACKEND=postgres
export TRACKMASTER_ENABLE_POSTGRES_RUNTIME=I_UNDERSTAND_THIS_IS_VALIDATION_ONLY
export TRACKMASTER_POSTGRES_URL='postgresql://trackmaster_migrator:<password>@127.0.0.1:5432/trackmaster_rehearsal'
PORT=3104 TRACKMASTER_HOST=127.0.0.1 TRACKMASTER_JWT_SECRET=trackmaster-local-dev-secret-change-me node server/index.js
TRACKMASTER_API_BASE_URL='http://127.0.0.1:3104' npm run validate:api:reads
```

That validation checks:

- `GET /api/health`
- `GET /api/auth/me`
- `GET /api/tracks`
- `GET /api/presets`

## Postgres API Write Validation

The write validator exercises the current mutation surface without changing route
shapes:

- `POST /api/auth/register`
- duplicate `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/presets`
- `PUT /api/presets/:id`
- `POST /api/tracks`
- `GET /api/tracks/:id/download`
- `DELETE /api/tracks/:id`
- `DELETE /api/presets/:id`

Use an isolated SQLite copy for SQLite-mode validation so the default data
directory is not mutated:

```bash
rm -rf /tmp/trackmaster-sqlite-validation
mkdir -p /tmp/trackmaster-sqlite-validation
cp -a data/. /tmp/trackmaster-sqlite-validation/
PORT=3106 TRACKMASTER_HOST=127.0.0.1 TRACKMASTER_DATA_DIR=/tmp/trackmaster-sqlite-validation TRACKMASTER_REPOSITORY_BACKEND=sqlite TRACKMASTER_JWT_SECRET=trackmaster-local-dev-secret-change-me node server/index.js
TRACKMASTER_API_BASE_URL='http://127.0.0.1:3106' npm run validate:api:writes
TRACKMASTER_API_BASE_URL='http://127.0.0.1:3106' npm run validate:api:reads
```

Refresh the rehearsal DB before Postgres write validation:

```bash
export TRACKMASTER_MIGRATION_DATABASE_URL='postgresql://trackmaster_migrator:<password>@127.0.0.1:5432/trackmaster_rehearsal'
npm run migration:rehearsal
```

Then run the Postgres-backed validation API:

```bash
export TRACKMASTER_REPOSITORY_BACKEND=postgres
export TRACKMASTER_ENABLE_POSTGRES_RUNTIME=I_UNDERSTAND_THIS_IS_VALIDATION_ONLY
export TRACKMASTER_POSTGRES_URL='postgresql://trackmaster_migrator:<password>@127.0.0.1:5432/trackmaster_rehearsal'
PORT=3107 TRACKMASTER_HOST=127.0.0.1 TRACKMASTER_JWT_SECRET=trackmaster-local-dev-secret-change-me node server/index.js
TRACKMASTER_API_BASE_URL='http://127.0.0.1:3107' npm run validate:api:writes
TRACKMASTER_API_BASE_URL='http://127.0.0.1:3107' npm run validate:api:reads
```

## Backend-Switch Rehearsal

The backend-switch rehearsal remains SQLite-source-of-truth and PostgreSQL
validation-only. It is not a cutover path.

Guardrails:

- live `.env` must stay on SQLite
- live `trackmaster-api.service` must stay unchanged
- Postgres runtime still refuses `NODE_ENV=production`
- Postgres runtime now refuses non-rehearsal database names unless explicitly
  overridden

Preflight and readiness scripts:

```bash
export TRACKMASTER_REHEARSAL_SOURCE_OF_TRUTH=sqlite
export TRACKMASTER_REHEARSAL_WRITE_FREEZE=I_CONFIRM_SQLITE_REMAINS_THE_ONLY_WRITER
export TRACKMASTER_REHEARSAL_ACK=I_UNDERSTAND_THIS_IS_A_REHEARSAL_ONLY_SWITCH_PLAN
export TRACKMASTER_POSTGRES_URL='postgresql://trackmaster_migrator:<password>@127.0.0.1:5432/trackmaster_rehearsal'
npm run backend-switch:preflight
npm run backend-switch:report
npm run fedora:readiness
```

Full operator steps are documented in
[deploy/BACKEND_SWITCH_REHEARSAL.md](deploy/BACKEND_SWITCH_REHEARSAL.md).

## Cutover Artifacts

Keep both operator tracks in view during the rebase and validation workflow:

- Windows readiness and PM2 artifact references remain under `docs/`,
  `scripts/`, and the Windows readiness commands above.
- Fedora rehearsal and cutover artifacts remain under `deploy/`,
  `trackmaster-api/docs/`, and the root `scripts/` report helpers.

Do not save live `.env` files, production secrets, or generated reports into the
repository.

## Production Cutover Planning

Production cutover remains planning-only. The cutover runbook and rollback plan
are documented in
[deploy/PRODUCTION_CUTOVER_PLAN.md](deploy/PRODUCTION_CUTOVER_PLAN.md),
[deploy/FEDORA_REHEARSAL_RUNBOOK.md](deploy/FEDORA_REHEARSAL_RUNBOOK.md), and
[deploy/ROLLBACK_WORKSHEET.md](deploy/ROLLBACK_WORKSHEET.md).

Planning/report scripts:

```bash
npm run production-cutover:preflight
npm run production-cutover:report
npm run fedora:storage-preflight
npm run fedora:backup-preflight
npm run fedora:readiness
npm run fedora:cutover-no-go || true
```

The cutover preflight is intentionally conservative and currently returns
planning `NO_GO` until the remaining blockers are explicitly cleared and approved.

## Garage Deployment

See [deploy/README.md](deploy/README.md).

## Windows Production Runtime Scaffold

The Windows production scaffold is separate from the readiness-only runtime:

- PM2 ecosystem: `ecosystem.production.config.cjs`
- API process: `trackmaster-api`
- UI process: `trackmaster-ui`
- API entrypoint: `server/index.js`
- UI entrypoint: `server/static-web.js`

The API process is production-capable now. The UI process is a minimal static
host for the root `dist/` build output. It serves the SPA bundle and returns a
clear error for direct `/api` requests because it does not act as a reverse
proxy.

Production runtime scripts:

```powershell
npm run pm2:production:start
npm run pm2:production:status
npm run pm2:production:logs
npm run pm2:production:restart
npm run pm2:production:stop
npm run pm2:production:save
```

Legacy `runtime:*` aliases still exist, but the `pm2:production:*` names are the
reviewed production entrypoints.

Do not run `npm run pm2:production:start` until all required production env
values are set to approved non-placeholder values.

### Required Windows Production Env Values

The production PM2 scaffold expects reviewed values for:

- `TRACKMASTER_HOST`
- `TRACKMASTER_UI_HOST`
- `TRACKMASTER_DATA_DIR`
- `TRACKMASTER_POSTGRES_URL`
- `TRACKMASTER_POSTGRES_POOL_MAX`
- `TRACKMASTER_JWT_SECRET`
- `TRACKMASTER_JWT_EXPIRES_IN`
- `TRACKMASTER_SESSION_COOKIE`
- `TRACKMASTER_SESSION_EXPIRES_IN_SECONDS`
- `TRACKMASTER_API_RATE_WINDOW_MS`
- `TRACKMASTER_API_RATE_LIMIT`
- `TRACKMASTER_AUTH_RATE_WINDOW_MS`
- `TRACKMASTER_AUTH_RATE_LIMIT`
- `TRACKMASTER_UPLOAD_LIMIT`
- `CORS_ORIGIN`

The scaffold defaults `TRACKMASTER_HOST` and `TRACKMASTER_UI_HOST` to
`127.0.0.1` for local validation only. If Fedora or another approved front-door
proxy must reach the Windows services directly, replace those bind hosts with an
approved Windows LAN, VPN, or proxy-facing address before startup.

`TRACKMASTER_DATA_DIR`, `TRACKMASTER_POSTGRES_URL`, and
`TRACKMASTER_JWT_SECRET` are read strictly from the environment by
`ecosystem.production.config.cjs`. The PM2 config refuses to load if any of
those values are missing or still use a placeholder marker.

### Storage Gap

Current TrackMaster code still uses `TRACKMASTER_DATA_DIR/uploads` as a local
filesystem path. The API does not yet implement a Fedora storage adapter or a
separate remote uploads configuration.

That means a Fedora-backed storage design on Windows still requires an
operational mount or junction under:

```text
<TRACKMASTER_DATA_DIR>\uploads
```

Until that mount or junction exists, Windows production will write to the local
filesystem path configured by `TRACKMASTER_DATA_DIR`.

### Validation Boundary

- API validation should use `/api/readiness` and confirm
  `repositoryBackend: postgres`.
- UI validation should use HTTP `200` on the static host and confirm that the
  approved `dist/` bundle is being served.

The UI static host only proves static serving. Full same-origin browser flows
still require the approved front-door or reverse-proxy path that maps `/api`
requests to the TrackMaster API service.

## Windows Readiness Only

Use this path to validate Windows syntax, PM2 wiring, and local health probes
without changing production authority:

```powershell
cd C:\Users\bryan\aibry\projects\aibry-trackmaster
npm install
npm --prefix trackmaster-api install
npm run check:api
powershell -ExecutionPolicy Bypass -File scripts\validate-windows-readiness.ps1
```

Optional local-only PM2 smoke check:

```powershell
npm run pm2:windows-readiness:start
Invoke-RestMethod http://127.0.0.1:3104/api/readiness
npm run pm2:windows-readiness:delete
```

Do not run `pm2 save` for `trackmaster-windows-readiness-api`, do not open a
firewall rule for it, and do not point Fedora nginx or Cloudflare at it. See
[docs/windows-readiness-runbook.md](docs/windows-readiness-runbook.md) and the
Windows operator packet under [docs/cutover](docs/cutover).
