# TrackMaster Production Env Switch Template

This is a fill-in approval template for the future Windows production env
switch. It is not an execution script and it must not be applied while Fedora
is still the source of truth.

## Current Allowed State

As of April 24, 2026:

- GO: rehearsal validation on localhost and other non-production paths.
- NO-GO: live production cutover.
- NO-GO: dual writers.
- NO-GO: treating Postgres as authoritative while Fedora SQLite writes continue.
- Fedora remains authoritative until the handoff checklist is completed and
  signed.

## Change Record

- Change ticket:
- Planned window start:
- Planned handoff time:
- Prepared by:
- Approved by:
- Freeze owner:
- Rollback owner:
- Latest Fedora rehearsal report:
- Latest Windows runtime readiness evidence:

## Preconditions

- [ ] Latest Fedora rehearsal report says `Decision: GO`.
- [ ] `docs/cutover/trackmaster-windows-runtime-readiness-checklist.md` is
      complete.
- [ ] `docs/cutover/trackmaster-freeze-window-checklist.md` is complete through
      final freeze confirmation.
- [ ] `docs/cutover/trackmaster-source-of-truth-handoff-checklist.md` is ready
      with named operators.
- [ ] No Windows production writer is running yet.
- [ ] `trackmaster-windows-readiness-api` is not treated as a production
      process and is not saved as a production PM2 resurrect entry.
- [ ] Public production traffic still remains on the Fedora side until the
      separate approved traffic switch step.

## Proposed API Env Diff

Fill this table in before the cutover window. The current safe/readiness column
documents what is allowed today.

| Variable | Current safe/readiness value | Approved cutover value | Operator initials |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | `production` | |
| `PORT` | `3104` | `3004` | |
| `TRACKMASTER_HOST` | `127.0.0.1` | `127.0.0.1` unless an approved reverse proxy requires otherwise | |
| `TRACKMASTER_DATA_DIR` | `./data-windows-readiness` | `<approved-windows-production-data-dir>` | |
| `TRACKMASTER_REPOSITORY_BACKEND` | `sqlite` | `postgres` only after Fedora handoff is complete | |
| `TRACKMASTER_POSTGRES_URL` | unset | `<approved-production-postgres-url>` | |
| `TRACKMASTER_POSTGRES_POOL_MAX` | unset or readiness default | `<approved-pool-size>` | |
| `TRACKMASTER_JWT_SECRET` | local readiness secret | `<32+-byte-production-secret>` | |
| `TRACKMASTER_JWT_EXPIRES_IN` | `12h` | `<approved-value>` | |
| `TRACKMASTER_SESSION_COOKIE` | `tm_session_windows_readiness` | `tm_session` | |
| `TRACKMASTER_SESSION_EXPIRES_IN_SECONDS` | `43200` | `43200` or approved override | |
| `TRACKMASTER_API_RATE_WINDOW_MS` | `60000` | `<approved-value>` | |
| `TRACKMASTER_API_RATE_LIMIT` | `240` | `<approved-value>` | |
| `TRACKMASTER_AUTH_RATE_WINDOW_MS` | `900000` | `<approved-value>` | |
| `TRACKMASTER_AUTH_RATE_LIMIT` | `20` | `<approved-value>` | |
| `TRACKMASTER_UPLOAD_LIMIT` | `120mb` | `<approved-value>` | |
| `CORS_ORIGIN` | `http://127.0.0.1:3000` | empty unless a reviewed production origin is required | |

## Proposed Windows Runtime Identity

- Production API PM2 name: `trackmaster-api`
- Production UI PM2 name: `trackmaster-ui`
- Readiness-only PM2 name that must stay separate: `trackmaster-windows-readiness-api`
- Planned Windows API env file path:
- Planned Windows UI/static host config path:

## Execution Hold Points

- [ ] Do not set `TRACKMASTER_REPOSITORY_BACKEND=postgres` for the Windows
      production writer until the freeze and handoff checklists are complete.
- [ ] Do not start the Windows production writer while Fedora still accepts
      SQLite-backed production writes.
- [ ] Do not treat Postgres as authoritative while Fedora SQLite writes
      continue.
- [ ] Do not move public production traffic as part of this template alone.

## Operator Record

- Fedora freeze confirmed at:
- Final SQLite snapshot path:
- Imported Postgres validation artifact:
- Windows API env staged at:
- Windows API env activated at:
- Windows API PM2 start time:
- Windows UI/static host start time:
- Post-switch validation checklist path:
- Rollback worksheet path:
