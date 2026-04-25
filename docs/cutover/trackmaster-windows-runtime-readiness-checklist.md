# TrackMaster Windows Runtime Readiness Checklist

This checklist prepares the Windows side for operation after an approved
cutover. It does not authorize a live switch by itself.

## Current Allowed State

As of April 24, 2026:

- GO: localhost and rehearsal validation only.
- NO-GO: live production cutover.
- NO-GO: dual writers.
- NO-GO: treating Postgres as authoritative while Fedora SQLite writes continue.
- Fedora remains the source of truth until a human-approved handoff is recorded.

## Required Tracked Runtime Trees

- [ ] Root runtime files are present: `package.json`, `server/`, `src/`,
      `scripts/`, and `docs/`.
- [ ] `trackmaster-api/` is present and treated as required source/runtime, not
      a duplicate.
- [ ] `trackmaster-ui/` is present and treated as required source, not a
      duplicate or generated tree.
- [ ] `src/lib/api.ts` still re-exports the shared API/session client from
      `trackmaster-ui/src/lib`.

## Generated Artifacts That Must Stay Uncommitted

- [ ] `dist/`
- [ ] `node_modules/`
- [ ] `data/`
- [ ] `data-windows-readiness/`
- [ ] `trackmaster-api/reports/`
- [ ] `.env*` except `.env.example` and `.env.local.example`
- [ ] `*.log`

## Install And Build Validation

- [ ] Run `npm install` from the repo root when `node_modules/` is missing or
      `package-lock.json` changes.
- [ ] Run `npm --prefix trackmaster-api install` when
      `trackmaster-api/node_modules/` is missing or
      `trackmaster-api/package-lock.json` changes.
- [ ] Run `npm run check:api`.
- [ ] Run
      `powershell -ExecutionPolicy Bypass -File scripts\validate-windows-readiness.ps1`.
- [ ] Run `npm run build` and confirm the current root Vite build writes `dist/`.
- [ ] Record the build artifact timestamp:
- [ ] Record the operator and host used for validation:

## API Startup: SQLite Mode Only

- [ ] Start the readiness-only API with `npm run start:windows-readiness`.
- [ ] Confirm `http://127.0.0.1:3104/api/health` returns `ok: true`.
- [ ] Confirm `http://127.0.0.1:3104/api/readiness` returns:
      `repositoryBackend: sqlite`, `runtime.host: 127.0.0.1`, and
      `runtime.production: false`.
- [ ] Confirm the data directory is `./data-windows-readiness`.
- [ ] Confirm no production data path, Fedora data path, or shared uploads path
      is reused.
- [ ] Stop the readiness-only process after validation.

## API Startup: Rehearsal Postgres Mode Only

- [ ] Use only a disposable imported Postgres target or rehearsal Postgres
      target for this check.
- [ ] Set `TRACKMASTER_STAGING_ALLOW_RUNTIME_VALIDATION=1`.
- [ ] Set a staging-only JWT secret of at least 32 characters in
      `TRACKMASTER_STAGING_API_JWT_SECRET`.
- [ ] Run
      `npm --prefix trackmaster-api run validate:postgres-runtime -- --postgres-url <rehearsal-postgres-url> --data-dir <staged-data-dir> --out-dir <artifact-dir>`.
- [ ] Confirm the validator writes `staging-runtime-report.json` and `server.log`
      under the chosen artifact directory.
- [ ] Confirm the validator passes required health/auth/read smoke checks and
      shuts its child API process down cleanly.
- [ ] Do not point this validator at the approved production Postgres target
      before the migration window is approved.
- [ ] Do not let this path become a live writer.

## UI Build And Static Serving

- [ ] Treat the root `src/` tree as the current build entrypoint.
- [ ] Treat `trackmaster-ui/` as required source because the root UI imports its
      shared API/session client code.
- [ ] Run `npm run build` and confirm `dist/` contains the static UI bundle.
- [ ] If a local static smoke check is needed, use
      `npm run preview -- --host 127.0.0.1 --port 4173` for asset validation
      only.
- [ ] Do not treat `vite preview` as a production reverse proxy or a substitute
      for the approved Windows static host.
- [ ] Record the planned Windows static host owner for `dist/`:
- [ ] Record the planned local bind host and port for the static host:

## PM2 Naming Proposal

- [ ] Reserve `trackmaster-windows-readiness-api` for validation-only use.
- [ ] Proposed Windows production API process name: `trackmaster-api`.
- [ ] Proposed Windows production UI process name: `trackmaster-ui`.
- [ ] Do not rename the readiness-only process to either production name.

## PM2 Save And Resurrect Expectations

- [ ] Do not run `pm2 save` while only `trackmaster-windows-readiness-api` is
      present.
- [ ] Remove the readiness-only process before saving any future production PM2
      list.
- [ ] Save the PM2 list only after the final approved Windows production process
      list is correct.
- [ ] `pm2 resurrect` should restore only the approved production processes,
      never the readiness-only process.
- [ ] Record the exact PM2 process list reviewed before any future `pm2 save`:

## Windows Firewall And LAN Exposure Notes

- [ ] Keep the API bound to `127.0.0.1` unless an approved reverse proxy design
      explicitly requires a different bind.
- [ ] Do not open inbound Windows Firewall rules for readiness or rehearsal
      paths.
- [ ] Do not expose the Windows API or UI to the LAN or public internet during
      this readiness phase.
- [ ] If cutover later requires LAN or public exposure, record the exact port,
      host, proxy owner, and rollback step before opening access.

## Final Hold Point

- [ ] Do not start a Windows production writer until the Fedora freeze and
      source-of-truth handoff checklists are complete.
- [ ] If any item above is incomplete, Windows remains readiness-only and
      Fedora remains authoritative.
