# Rollback Worksheet

Use this only during an approved cutover window if the Postgres-backed
production switch fails validation or introduces instability.

## Rollback Goals

- Restore SQLite as the source of truth
- Preserve Fedora `data/uploads/` paths exactly
- Revert the production `.env` switch
- Restart the original Fedora service
- Re-verify public API and UI behavior

## Required Inputs

- timestamp of the final approved SQLite snapshot
- timestamp of the final `.env` backup
- timestamp of the final uploads verification manifest/archive
- rollback owner

## Rollback Steps

1. Confirm the cutover is failing and declare rollback.
2. Stop writers so Postgres and SQLite are not both receiving writes.
3. Restore the pre-cutover `.env` backup that kept SQLite active.
4. Restore the final SQLite snapshot if the cutover modified or replaced it.
5. Keep Fedora uploads on the same filesystem path:
   `/home/aibry/projects/aibry-trackmaster/data/uploads`
6. Restart the original `trackmaster-api.service`.
7. Verify:
   - `systemctl --user status trackmaster-api.service`
   - `curl -fsS http://127.0.0.1:3004/api/health`
   - `curl -I http://127.0.0.1:3000/`
8. Confirm public UI/API behavior through the existing Fedora/nginx/Cloudflare path.

## Exact Restore Commands

Replace `<timestamp>` with the approved freeze-window artifacts:

```bash
systemctl --user stop trackmaster-api.service
cp "/home/aibry/backups/trackmaster/<timestamp>/.env" /home/aibry/projects/aibry-trackmaster/.env
cp "/home/aibry/backups/trackmaster/<timestamp>/trackmaster.sqlite" /home/aibry/projects/aibry-trackmaster/data/trackmaster.sqlite
systemctl --user start trackmaster-api.service
systemctl --user status trackmaster-api.service
curl -fsS http://127.0.0.1:3004/api/health
curl -I http://127.0.0.1:3000/
```

## Non-Negotiable Constraint

Rollback must preserve the same Fedora-backed uploads path. If that path changes,
the remapping must be documented and validated before the cutover begins.
