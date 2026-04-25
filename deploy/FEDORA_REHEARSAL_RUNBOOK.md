# Fedora Rehearsal Runbook

This runbook is for Fedora-side rehearsal only. It does not authorize or
perform a production cutover.

## Goals

- Preserve Fedora as the live storage host for `data/uploads/`
- Take a timestamped SQLite snapshot before rehearsal import
- Capture an uploads backup plus verification manifest
- Refresh `trackmaster_rehearsal` from the SQLite snapshot
- Run API contract validation against rehearsal Postgres only
- Produce a clear rehearsal `GO_REHEARSAL_ONLY` or `NO_GO`

## Preconditions

- Live `trackmaster-api.service` remains on SQLite
- No production routing changes
- No live `.env` backend switch
- Local Postgres rehearsal target is available
- Operator has a writable backup root, recommended:
  `/home/aibry/backups/trackmaster`

## Read-Only Preflight

```bash
npm run fedora:storage-preflight
npm run fedora:backup-preflight
npm run fedora:readiness
npm run fedora:cutover-no-go || true
```

## Rehearsal Snapshot And Backup

Choose a timestamp once and reuse it:

```bash
ts="$(date +%Y%m%d-%H%M%S)"
backup_root="/home/aibry/backups/trackmaster/$ts"
mkdir -p "$backup_root"
```

Take a SQLite snapshot:

```bash
cp data/trackmaster.sqlite "$backup_root/trackmaster.sqlite"
sha256sum "$backup_root/trackmaster.sqlite" > "$backup_root/trackmaster.sqlite.sha256"
```

Back up Fedora uploads and verify contents:

```bash
tar -C data -cf "$backup_root/uploads.tar" uploads
sha256sum "$backup_root/uploads.tar" > "$backup_root/uploads.tar.sha256"
find data/uploads -type f -printf '%P\t%s\n' | sort > "$backup_root/uploads.manifest.tsv"
```

## Refresh Rehearsal Postgres

Point the importer at the snapshot:

```bash
export TRACKMASTER_SQLITE_PATH="$backup_root/trackmaster.sqlite"
export TRACKMASTER_MIGRATION_DATABASE_URL='postgresql://<user>:<password>@127.0.0.1:5432/trackmaster_rehearsal'
npm run migration:rehearsal
```

## Rehearsal API Contract Validation

Run the validation-only API on an alternate port:

```bash
export TRACKMASTER_REPOSITORY_BACKEND=postgres
export TRACKMASTER_ENABLE_POSTGRES_RUNTIME=I_UNDERSTAND_THIS_IS_VALIDATION_ONLY
export TRACKMASTER_POSTGRES_URL="$TRACKMASTER_MIGRATION_DATABASE_URL"
PORT=3107 TRACKMASTER_HOST=127.0.0.1 TRACKMASTER_JWT_SECRET=trackmaster-local-dev-secret-change-me node server/index.js
```

In a second shell:

```bash
TRACKMASTER_API_BASE_URL='http://127.0.0.1:3107' npm run validate:api:writes
TRACKMASTER_API_BASE_URL='http://127.0.0.1:3107' npm run validate:api:reads
```

## Compare Counts And Checksums

The rehearsal importer already records source and target counts/checksums in
`migration-reports/trackmaster-postgres-rehearsal-*.json`.

Generate/update summary reports:

```bash
npm run backend-switch:report
npm run fedora:readiness
```

## Rehearsal Verdict

Declare `GO_REHEARSAL_ONLY` only if all of the following are true:

- latest rehearsal import report says `validation: passed`
- Postgres read validation passed
- Postgres write validation passed
- live `trackmaster-api.service` never changed off SQLite
- Fedora uploads backup and SQLite snapshot both verify

Otherwise declare `NO_GO` and preserve SQLite as the only writer.
