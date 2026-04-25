# TrackMaster Post-Cutover Validation Checklist

Use this only after the approved cutover window has moved authority to the
Windows runtime. Until that point, this checklist stays parked and the current
state remains `NO-GO` for live cutover.

## Current Allowed State

As of April 24, 2026:

- GO: rehearsal validation only.
- NO-GO: live production cutover.
- NO-GO: dual writers.
- NO-GO: treating Postgres as authoritative while Fedora SQLite writes continue.

## Local Windows Validation

- [ ] `pm2 status trackmaster-api` shows the approved production API process.
- [ ] `Invoke-RestMethod http://127.0.0.1:3004/api/health` returns `ok: true`.
- [ ] `Invoke-RestMethod http://127.0.0.1:3004/api/readiness` returns
      `repositoryBackend: postgres`.
- [ ] `Invoke-RestMethod http://127.0.0.1:3004/api/readiness` reports the
      expected host, port, and production mode.
- [ ] API log path recorded:
- [ ] API process id recorded:

## UI And Static Asset Validation

- [ ] The current root build output in `dist/` matches the approved cutover
      artifact.
- [ ] The Windows static host is serving the approved `dist/` directory.
- [ ] Login screen loads without missing asset errors.
- [ ] Session restore works for an existing user.
- [ ] Preset list loads.
- [ ] Preset create/readback passes.
- [ ] Track history loads.
- [ ] Track download succeeds for an imported track owner.
- [ ] UI/static host owner recorded:

## Public Entry Validation

- [ ] If public traffic has moved, the approved public UI entry loads.
- [ ] If public traffic has moved, the approved public `/api/health` path
      passes.
- [ ] If public traffic has not moved yet, record that status here:

## PM2 Save And Resurrect

- [ ] `trackmaster-windows-readiness-api` is absent from the production PM2
      list.
- [ ] The reviewed production PM2 process list contains only approved entries.
- [ ] `pm2 save` was run only after the production list was verified.
- [ ] `pm2 resurrect` expectation or reboot drill result recorded:

## Firewall And Exposure Notes

- [ ] API bind host and port recorded:
- [ ] UI/static host bind host and port recorded:
- [ ] Any Windows Firewall or LAN exposure change is recorded with an owner.
- [ ] No unreviewed extra listener was opened during cutover.

## Rollback Triggers

- [ ] If any required check above fails before writes reopen, stop and rollback.
- [ ] If any required check fails after writes reopen, freeze writes before
      rollback because the path is now data-sensitive.
- [ ] Rollback worksheet path:

## Validation Signoff

- Windows operator:
- Application checker:
- Rollback owner:
- Completed at:
- Notes:
