# TrackMaster Backend-Switch Rehearsal

This is a rehearsal-only backend switch plan. It does not authorize or perform a
production cutover.

## Source of Truth

- SQLite on Fedora remains the only authoritative writer.
- Filesystem audio under `data/uploads/` remains on Fedora.
- Postgres is a validation target only.

## Split-Brain Risk

If the Postgres validation runtime is treated as a live writer while SQLite
production writes continue, the two backends diverge immediately.

This rehearsal avoids split brain by:

1. leaving the live `trackmaster-api.service` on SQLite
2. declaring a write freeze for the rehearsal window
3. refreshing `trackmaster_rehearsal` from SQLite immediately before validation
4. running the Postgres-backed API on an alternate local port only
5. rolling back by stopping the alternate validation process and leaving the live
   SQLite service unchanged

## Operator Checklist

1. Confirm SQLite remains the source of truth.
2. Confirm the live `trackmaster-api.service` stays on the existing `.env`.
3. Declare the write freeze for the rehearsal window.
4. Refresh `trackmaster_rehearsal` from SQLite.
5. Run preflight checks.
6. Start the Postgres-backed validation API on an alternate port.
7. Run read and write validation against the alternate port.
8. Generate a readiness report.
9. Stop the validation API.
10. Verify the live SQLite service was never changed.

## Preflight

Required declarations:

```bash
export TRACKMASTER_REHEARSAL_SOURCE_OF_TRUTH=sqlite
export TRACKMASTER_REHEARSAL_WRITE_FREEZE=I_CONFIRM_SQLITE_REMAINS_THE_ONLY_WRITER
export TRACKMASTER_REHEARSAL_ACK=I_UNDERSTAND_THIS_IS_A_REHEARSAL_ONLY_SWITCH_PLAN
```

Required database target:

```bash
export TRACKMASTER_POSTGRES_URL='postgresql://trackmaster_migrator:<password>@127.0.0.1:5432/trackmaster_rehearsal'
```

Run preflight:

```bash
node scripts/backend-switch-preflight.mjs
```

## Rehearsal Switch Procedure

Refresh rehearsal data first:

```bash
export TRACKMASTER_MIGRATION_DATABASE_URL="$TRACKMASTER_POSTGRES_URL"
npm run migration:rehearsal
```

Start the validation backend on an alternate port:

```bash
export TRACKMASTER_REPOSITORY_BACKEND=postgres
export TRACKMASTER_ENABLE_POSTGRES_RUNTIME=I_UNDERSTAND_THIS_IS_VALIDATION_ONLY
export TRACKMASTER_JWT_SECRET=trackmaster-local-dev-secret-change-me
PORT=3107 TRACKMASTER_HOST=127.0.0.1 node server/index.js
```

Validate the backend switch rehearsal:

```bash
TRACKMASTER_API_BASE_URL='http://127.0.0.1:3107' npm run validate:api:writes
TRACKMASTER_API_BASE_URL='http://127.0.0.1:3107' TRACKMASTER_JWT_SECRET=trackmaster-local-dev-secret-change-me npm run validate:api:reads
node scripts/backend-switch-report.mjs
```

## Rollback

Rollback is intentionally simple because the live service is never switched:

1. Stop the alternate Postgres-backed validation API process.
2. Unset rehearsal-only env vars:

```bash
unset TRACKMASTER_REPOSITORY_BACKEND
unset TRACKMASTER_ENABLE_POSTGRES_RUNTIME
unset TRACKMASTER_POSTGRES_URL
unset TRACKMASTER_MIGRATION_DATABASE_URL
unset TRACKMASTER_REHEARSAL_SOURCE_OF_TRUTH
unset TRACKMASTER_REHEARSAL_WRITE_FREEZE
unset TRACKMASTER_REHEARSAL_ACK
```

3. Verify the live SQLite service remains healthy:

```bash
curl -fsS http://127.0.0.1:3004/api/health
systemctl --user status trackmaster-api.service
```

## What This Rehearsal Proves

- SQLite remains the live default.
- Postgres runtime can serve validated reads and writes from the rehearsal copy.
- The repository boundary supports a controlled backend switch exercise on an
  alternate port.

## What It Does Not Prove

- It does not prove a real production writer cutover.
- It does not move or migrate filesystem audio storage.
- It does not remove split-brain risk outside the declared rehearsal window.
