# TrackMaster Rollback Execution Worksheet

This worksheet records how to abort or reverse a future cutover window without
creating split-brain risk. It does not by itself execute any runtime or traffic
change.

## Current Allowed State

As of April 24, 2026:

- GO: rehearsal validation only.
- NO-GO: live production cutover.
- NO-GO: dual writers.
- NO-GO: treating Postgres as authoritative while Fedora SQLite writes continue.

## Incident Record

- Change ticket:
- Failure detected at:
- Failure summary:
- Detected by:
- Rollback owner:
- Windows operator:
- Fedora operator:

## Decision Gate

- [ ] Did Windows ever become the recorded source of truth?
- [ ] Did Windows accept production writes after handoff?
- [ ] Did public production traffic change?
- [ ] Has a second writer been detected?

If the answer to "Did Windows accept production writes after handoff?" is
`yes`, rollback is data-sensitive. Freeze writes first and do not run Fedora and
Windows as concurrent writers.

## Pre-Write-Reopen Rollback Path

Use this path only when Windows has not accepted production writes after
handoff.

- [ ] Keep or restore Fedora as the source of truth.
- [ ] Stop the Windows production writer.
- [ ] Do not treat Postgres as authoritative.
- [ ] Remove any accidental Windows production PM2 save entry if needed.
- [ ] Validate Fedora health before ending the rollback.

## Post-Write-Reopen Rollback Path

Use this path only when Windows has accepted production writes after handoff.

- [ ] Freeze writes immediately.
- [ ] Stop the Windows production writer.
- [ ] Preserve the Windows Postgres state for investigation and reconciliation.
- [ ] Record whether public traffic changed and who will reverse it.
- [ ] Assign a reconciliation owner before reactivating Fedora.
- [ ] Do not restart Fedora as a writer until the post-handoff write history is
      understood.

## Artifact Capture

- [ ] Windows API log path:
- [ ] Windows UI/static host log path:
- [ ] Postgres validation artifact path:
- [ ] Final SQLite snapshot path:
- [ ] Any dump or backup captured during rollback:

## Validation After Rollback

- [ ] Confirm exactly one TrackMaster writer is active.
- [ ] Confirm the restored authoritative system passes health checks.
- [ ] Confirm operators know whether Postgres data is retained for reconciliation
      or discarded as part of the abort.
- [ ] Confirm the incident and decision timestamps are written down.

## Signoff

- Rollback owner:
- Windows operator:
- Fedora operator:
- End state:
- Completed at:
- Notes:
