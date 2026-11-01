# Status — agent-sc (C · Opportunity Discovery & Scanning (SC-1))

Only agent-sc edits this file. Update it in every PR.

## In flight
- **PR 1 — `screen.run` + `screen.count`** (PR #570, branch `agent/sc/scan-v1`): scan-category kinds in `scan/kinds.py`, adapters over `screener.query.run_scan` / `preview_count` / `coverage_for`, spec validation against the field catalog (`scan/spec.py`), ≤50 rows, `provider_calls` 0. SC-1 bumped to v1.1 (additive: §2a pins the `as_of`/`stale` mapping). Tests: `tests/test_uct_agent_scan_screen.py`.
- **PR 2: `screen.saved` + spec sources** (branch `agent/sc/screen-saved`, **depends on #570**). Adds `screen.saved` (the member's own screens, read-only, never `init()`). `screen.run`/`count` gain `saved_id` (member-scoped) and `text` (the screener's own grammar, deterministic). SC-1 §2b. Tests: `tests/test_uct_agent_scan_saved.py`.
  - Not used: `/api/screener/compile`, because it's a paid model call. Approval needed from agent-lead/owner before any Agent use.
- Next: client gateway path for `screener.js` + `panelHarness` scenario; wiring `scan/spec.validate` into `Kind.validate` once agent-lead lands it; PR 3 (discovery planning with `volume.surge`), PR 4 (ADR-002 inventory).

## Scope rulings
- **Indicator conditions are out of SC-1 in Sprint 1** (agent-lead, 2026-11-01). That covers crosses and custom or saved indicators. `/api/scans/definition-results` is not called. A spec carrying the screener's `scan` key (a nightly definition-results join by bare `def_hash`) is **refused** with a sentence and never approximated (`scan/spec.py` `INDICATOR_KEYS`, railed and mutation-proved).
- After Indicators' owner approves IC-1, one kind delegates to their endpoint exactly as IC-1 says: keyed by `user_definitions.result_identity` (never a bare hash: the N11 trap), `not-run` = `unavailable`, `periodic`. It will be **SC-1 v1.2**, because v1.1 is already used by §2a in PR #570. agent-lead schedules it.
- This also goes in the ADR-002 inventory (PR 4).

## Blockers
- (none)

## Requests to agent-lead
- Done: the gateway test was relaxed (#571); SC-1 v1.1 §2a was acked.
- Pending (agent-lead): an optional `Kind.validate` pre-admission hook. A validation refusal spends nothing; an attempted execution spends the scan. I'll wire `scan/spec.validate` into it once it lands.

## Handoffs (to / from)
- agent-qa: SC-1 §2a is the conformance target for scan envelopes. Fixture: a tmp `SCREENER_DB_PATH` with `snapshot_db.upsert_rows` (see the test file).

## Ready for integration
- PR #570 (merged with origin/agent/int; awaiting agent-lead review)
