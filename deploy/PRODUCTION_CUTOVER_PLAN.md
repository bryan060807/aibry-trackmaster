# TrackMaster Production Cutover Plan

This document is a production cutover plan only. It does not authorize or
perform the cutover.

Current status:

- Live backend: SQLite
- Postgres import rehearsal: passed
- Postgres read validation: passed
- Postgres write validation: passed
- Backend-switch rehearsal: passed
- Real production cutover: not yet approved

## Filesystem and Audio Storage Constraint

TrackMaster audio exports remain on Fedora local filesystem storage under
`data/uploads/`.

This does not block a metadata backend cutover by itself because both SQLite and
Postgres reference the same filesystem paths on Fedora.

It does constrain the cutover:

1. Fedora remains the storage host during and after cutover.
2. The cutover changes only metadata persistence from SQLite to Postgres.
3. Rollback must preserve the same Fedora filesystem paths and must not move or
   rewrite audio assets.

## Split-Brain Risk

The primary cutover risk is split brain between SQLite and Postgres.

To avoid split brain during the cutover window:

1. SQLite remains the source of truth until the final import finishes.
2. A write freeze starts before the final SQLite to Postgres refresh.
3. No writes are allowed during the final refresh and service switch.
4. Postgres becomes the source of truth only after the live service is restarted
   with the production switch env.
5. Rollback reverts the live service to SQLite and treats SQLite as the source
   of truth again.

## Pre-Cutover Checks

1. Confirm `npm run backend-switch:report` still yields rehearsal-only success.
2. Confirm the latest migration rehearsal report passed.
3. Confirm Fedora local filesystem paths exist:
   - `data/trackmaster.sqlite`
   - `data/uploads/`
4. Confirm approved cutover owner and rollback owner are assigned.
5. Confirm an approved freeze window exists.
6. Confirm no background jobs or external writers besides the TrackMaster API are
   writing SQLite.
7. Confirm the target production Postgres database and role are prepared.
8. Confirm the production `.env` change has been staged but not applied.

## Approved Freeze Window Steps

1. Announce the freeze window start.
2. Stop incoming write traffic at the operator level.
3. Stop the live `trackmaster-api.service`.
4. Confirm no TrackMaster writer remains active.
5. Take a timestamped backup copy of:
   - `.env`
   - `data/trackmaster.sqlite`
   - `data/uploads/` metadata listing if desired

## Final Refresh and Source-of-Truth Handoff

1. While the API is stopped and the freeze window is active, run the final
   SQLite to Postgres refresh against the production Postgres target.
2. Validate counts and checksums.
3. Only after a clean final refresh, treat Postgres as the pending source of
   truth for restart.
4. Apply the production `.env` backend switch.
5. Restart the live service.
6. Postgres becomes the source of truth only once the restarted live service
   passes validation on port `3004`.

## Live Service Env Change

The live `.env` would need these additions for the cutover:

```bash
TRACKMASTER_REPOSITORY_BACKEND=postgres
TRACKMASTER_ENABLE_POSTGRES_RUNTIME=I_UNDERSTAND_THIS_IS_VALIDATION_ONLY
TRACKMASTER_POSTGRES_URL='postgresql://trackmaster_migrator:<password>@127.0.0.1:5432/trackmaster_production'
TRACKMASTER_ALLOW_UNSAFE_POSTGRES_RUNTIME=I_UNDERSTAND_THIS_COULD_TARGET_A_NON_REHEARSAL_DATABASE
```

This plan does not apply those changes now.

## Cutover Procedure

1. Export the approved freeze declarations:

```bash
export TRACKMASTER_CUTOVER_FREEZE=I_CONFIRM_THE_APPROVED_CUTOVER_FREEZE_WINDOW_IS_ACTIVE
export TRACKMASTER_CUTOVER_SOURCE_OF_TRUTH=sqlite_until_handoff
export TRACKMASTER_CUTOVER_STORAGE_ACK=I_UNDERSTAND_FILESYSTEM_AUDIO_REMAINS_ON_FEDORA
```

2. Run cutover planning preflight:

```bash
npm run production-cutover:preflight
```

3. Back up the current live env and SQLite DB:

```bash
cp .env ".env.sqlite-backup.$(date +%Y%m%d-%H%M%S)"
cp data/trackmaster.sqlite "data/trackmaster.sqlite.backup.$(date +%Y%m%d-%H%M%S)"
```

4. Stop the live API:

```bash
systemctl --user stop trackmaster-api.service
```

5. Run the final refresh into the production Postgres target:

```bash
export TRACKMASTER_MIGRATION_DATABASE_URL='postgresql://trackmaster_migrator:<password>@127.0.0.1:5432/trackmaster_production'
export TRACKMASTER_ALLOW_PRODUCTION_POSTGRES_IMPORT=I_UNDERSTAND_THIS_WRITES_TO_TARGET
npm run migration:rehearsal
```

6. Update `.env` for the live backend switch.
7. Restart the live API:

```bash
systemctl --user start trackmaster-api.service
```

## Post-Cutover Validation

1. Confirm `GET /api/health` on `127.0.0.1:3004`.
2. Run read validation against `http://127.0.0.1:3004`.
3. Run write validation against `http://127.0.0.1:3004`.
4. Verify downloads still resolve from the Fedora filesystem.
5. Generate the planning report:

```bash
npm run production-cutover:report
```

## Rollback Conditions

Rollback immediately if any of the following occur after restart:

- `GET /api/health` fails
- auth validation fails
- track or preset reads fail
- write validation fails
- audio download path resolution fails
- operator observes unexpected Postgres runtime errors

## Rollback Procedure

1. Stop the live API:

```bash
systemctl --user stop trackmaster-api.service
```

2. Restore the backed-up SQLite `.env`:

```bash
cp ".env.sqlite-backup.<timestamp>" .env
```

3. Confirm `.env` no longer points at Postgres.
4. Start the live API:

```bash
systemctl --user start trackmaster-api.service
```

5. Validate health, reads, writes, and audio download on SQLite.
6. Treat SQLite as the source of truth again.

## Scheduling Verdict

This repo state is still planning-only for production cutover. Use the cutover
report script to record the current status before scheduling a real window.
