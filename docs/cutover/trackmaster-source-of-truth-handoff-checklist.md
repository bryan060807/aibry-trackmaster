# TrackMaster Source-Of-Truth Handoff Checklist

Use this checklist to record the exact moment TrackMaster authority moves from
Fedora SQLite-backed production to the approved Windows runtime. Until every
required item is complete, Fedora remains the source of truth.

## Current Allowed State

As of April 24, 2026:

- GO: rehearsal validation only.
- NO-GO: live production cutover.
- NO-GO: dual writers.
- NO-GO: treating Postgres as authoritative while Fedora SQLite writes continue.

## Handoff Record

- Change ticket:
- Current authority before handoff: Fedora SQLite-backed TrackMaster
- Proposed authority after handoff: Windows Postgres-backed TrackMaster
- Freeze owner:
- Handoff approver:
- Windows operator:
- Fedora operator:

## Preconditions

- [ ] Freeze checklist is complete through final snapshot confirmation.
- [ ] Import validation and runtime validation artifacts are attached.
- [ ] Rollback worksheet is prepared and owned.
- [ ] Windows runtime readiness checklist is complete.
- [ ] Windows production env diff has been reviewed and approved.

## Single-Writer Confirmation

- [ ] Fedora production writes are still frozen.
- [ ] Windows production writer has not accepted production traffic yet.
- [ ] No readiness-only process is acting as a production writer.
- [ ] No Windows or Fedora service is still writing to a separate local source
      while authority is changing.
- [ ] Operators agree on the single writer that will exist immediately after
      handoff.

## Handoff Gate

- [ ] Record the final SQLite snapshot path used for import:
- [ ] Record the validated Postgres target:
- [ ] Record the runtime validation artifact path:
- [ ] Record the exact time authority moves to Windows:
- [ ] Record the human who authorized that moment:
- [ ] Only after the timestamp above, start or enable the approved Windows
      production writer.

## After Handoff

- [ ] Confirm `trackmaster-api` is the only production writer.
- [ ] Confirm Fedora is no longer acting as the TrackMaster production writer.
- [ ] Confirm the saved PM2 production list contains the approved Windows
      processes only.
- [ ] Confirm operators understand rollback becomes data-sensitive after writes
      reopen on Windows.

## Stop Conditions

- [ ] Stop and keep Fedora authoritative if any item above is incomplete.
- [ ] Stop if a second writer is discovered.
- [ ] Stop if anybody proposes treating Postgres as authoritative before the
      recorded handoff timestamp.

## Signoff

- Fedora operator:
- Windows operator:
- Handoff approver:
- Rollback owner:
- Notes:
