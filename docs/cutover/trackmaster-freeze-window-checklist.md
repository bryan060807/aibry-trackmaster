# TrackMaster Freeze Window Checklist

This checklist covers the write-freeze and final-prep portion of a future
cutover window. It does not authorize a live switch by itself.

## Current Allowed State

As of April 24, 2026:

- GO: rehearsal validation only.
- NO-GO: live production cutover.
- NO-GO: dual writers.
- NO-GO: treating Postgres as authoritative while Fedora SQLite writes continue.

## Window Record

- Change ticket:
- Scheduled start:
- Freeze owner:
- Windows operator:
- Fedora operator:
- Rollback owner:

## Before Freeze

- [ ] Latest Fedora rehearsal report says `Decision: GO`.
- [ ] Windows runtime readiness checklist is complete.
- [ ] Final rollback owner is on the call.
- [ ] Operators confirm Fedora remains the current source of truth.
- [ ] Operators confirm no Windows production writer is running.
- [ ] Operators confirm `trackmaster-windows-readiness-api` is not saved as a
      production PM2 process.

## Enter Freeze

- [ ] Announce the freeze window.
- [ ] Stop or block Fedora TrackMaster production writes.
- [ ] Confirm no Windows or Fedora TrackMaster API instance can continue
      writing to a different local store.
- [ ] Record freeze start timestamp:
- [ ] Record the operator who confirmed write freeze:

## Final Snapshot And Import Preconditions

- [ ] Create the final Fedora SQLite snapshot from the frozen production data.
- [ ] Run the SQLite integrity check on the frozen snapshot.
- [ ] Record the final snapshot path:
- [ ] Record the snapshot checksum or size:
- [ ] Confirm the approved Postgres target is the one intended for the cutover
      window.
- [ ] Confirm the Windows side still has not started a production writer.

## Windows Writer Hold Point

- [ ] Do not start `trackmaster-api` on Windows yet.
- [ ] Do not activate a Windows production env file yet.
- [ ] Do not let any operator treat imported Postgres data as authoritative yet.
- [ ] Continue to treat Fedora as the source of truth until the handoff
      checklist says otherwise.

## Abort Conditions

- [ ] Abort if the final SQLite snapshot or integrity check fails.
- [ ] Abort if any second writer is discovered.
- [ ] Abort if the approved Postgres target is uncertain.
- [ ] Abort if Windows production processes start before handoff approval.
- [ ] Abort if any operator cannot prove which system is authoritative.

## Freeze Exit Record

- Freeze released by:
- Freeze released at:
- Handoff checklist path:
- Rollback worksheet path:
- Notes:
