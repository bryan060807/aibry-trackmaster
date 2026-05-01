# TrackMaster Windows Readiness Runbook

This runbook is for Windows-side readiness checks only. It must not be used as
a live production cutover. Fedora remains the authoritative TrackMaster runtime,
database owner, storage owner, nginx front door, and Cloudflare target until the
separate Fedora cutover runbook is approved and executed.

## Current Allowed State

As of April 24, 2026:

- GO: localhost and other non-production rehearsal validation.
- NO-GO: live production cutover.
- NO-GO: dual writers.
- NO-GO: treating Postgres as authoritative while Fedora SQLite writes continue.

## Guardrails

- Do not point Fedora nginx or Cloudflare at the Windows readiness API.
- Do not open an inbound Windows Firewall rule for this readiness process.
- Do not run `pm2 save` for `trackmaster-windows-readiness-api`.
- Do not set `TRACKMASTER_REPOSITORY_BACKEND=postgres` for this Windows process.
- Do not reuse Fedora production `data/` or audio storage paths.
- Do not start any Windows production writer until Fedora handoff is complete.

The Windows readiness process binds to `127.0.0.1:3104`, uses SQLite, and writes
only under `data-windows-readiness/`, which is intentionally separate from the
Fedora-owned production data.

The production PM2 scaffold now lives in `ecosystem.production.config.cjs`, but
that does not change the current no-cutover guardrails. Treat it as a separate
approved-cutover runtime only:

- API PM2 name: `trackmaster-api`
- UI PM2 name: `trackmaster-ui`
- Production API port: `3004`
- Production UI port: `3000`
- Readiness-only PM2 name that must remain separate: `trackmaster-windows-readiness-api`

Do not start the production scaffold while any required env value is still a
placeholder. In particular, do not start it with an unreviewed
`TRACKMASTER_POSTGRES_URL`, an unreviewed `TRACKMASTER_DATA_DIR`, or a
placeholder `TRACKMASTER_JWT_SECRET`.

The production PM2 config reads those values directly from the Windows
environment and fails closed if they are unset or still marked as placeholders.

The production UI scaffold is only a static host for `dist/`. It does not proxy
`/api` locally. HTTP `200` on the UI host proves static hosting only; full
browser flows still require the approved front-door or reverse-proxy path that
maps `/api` to the TrackMaster API process.

TrackMaster storage still resolves to `TRACKMASTER_DATA_DIR/uploads`. Fedora
durable uploads therefore still require an operational Windows mount or junction
at that exact uploads path before Windows production can claim Fedora-backed
storage ownership.

## One-Shot Local API Check

```powershell
cd C:\Users\bryan\aibry\projects\aibry-trackmaster
npm install
npm --prefix trackmaster-api install
npm run start:windows-readiness
```

In another PowerShell session:

```powershell
Invoke-RestMethod http://127.0.0.1:3104/api/health
Invoke-RestMethod http://127.0.0.1:3104/api/readiness
```

Stop the foreground process with `Ctrl+C`.

## PM2 Readiness Check

```powershell
cd C:\Users\bryan\aibry\projects\aibry-trackmaster
npm install
npm --prefix trackmaster-api install
npm run pm2:windows-readiness:start
npm run pm2:windows-readiness:status
Invoke-RestMethod http://127.0.0.1:3104/api/readiness
npm run pm2:windows-readiness:logs
npm run pm2:windows-readiness:delete
```

Do not run `pm2 save` after starting this process. If it is accidentally saved,
remove it and save the cleaned PM2 list:

```powershell
npm run pm2:windows-readiness:delete
pm2 save
```

## Validation

```powershell
npm run check:api
powershell -ExecutionPolicy Bypass -File scripts\validate-windows-readiness.ps1
node --check server\static-web.js
node --check ecosystem.production.config.cjs
```

Expected readiness properties:

- `ok: true`
- `service: trackmaster-api`
- `repositoryBackend: sqlite`
- `storage.ready: true`
- `runtime.host: 127.0.0.1`
- `runtime.production: false`

Use the Windows runtime operator checklist before any approved cutover work:

- `docs/cutover/trackmaster-windows-runtime-readiness-checklist.md`
- `docs/cutover/trackmaster-production-env-switch-template.md`
- `docs/cutover/trackmaster-freeze-window-checklist.md`
- `docs/cutover/trackmaster-source-of-truth-handoff-checklist.md`
- `docs/cutover/trackmaster-post-cutover-validation-checklist.md`
- `docs/cutover/trackmaster-rollback-execution-worksheet.md`

Any Postgres runtime validation or live API cutover remains covered by
`trackmaster-api/docs/fedora-cutover-runbook.md`, not this Windows runbook.
