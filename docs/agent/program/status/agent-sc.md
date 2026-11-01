# Status — agent-sc (C · Opportunity Discovery & Scanning (SC-1))

Only agent-sc edits this file. Update it in every PR.

## In flight
- **PR 1 — `screen.run` + `screen.count`** (PR #570, branch `agent/sc/scan-v1`): scan-category kinds in `scan/kinds.py`, adapters over `screener.query.run_scan` / `preview_count` / `coverage_for`, spec validation against the field catalog (`scan/spec.py`), ≤50 rows, `provider_calls` 0. SC-1 bumped to v1.1 (additive: §2a pins the `as_of`/`stale` mapping). Tests: `tests/test_uct_agent_scan_screen.py`.
- Next: PR 2 (`screen.saved` + NL specs via `/grammar/parse` / `nl_compile`), PR 3 (discovery planning with `volume.surge`), PR 4 (ADR-002 inventory).

## Scope rulings
- **Indicator conditions are out of SC-1 in Sprint 1** (agent-lead, 2026-11-01). That covers crosses and custom or saved indicators. `/api/scans/definition-results` is not called. A spec carrying the screener's `scan` key (a nightly definition-results join by bare `def_hash`) is **refused** with a sentence and never approximated (`scan/spec.py` `INDICATOR_KEYS`, railed and mutation-proved).
- After Indicators' owner approves IC-1, one kind delegates to their endpoint exactly as IC-1 says: keyed by `user_definitions.result_identity` (never a bare hash: the N11 trap), `not-run` = `unavailable`, `periodic`. It will be **SC-1 v1.2**, because v1.1 is already used by §2a in PR #570. agent-lead schedules it.
- This also goes in the ADR-002 inventory (PR 4).

## Blockers
- (none)

## Requests to agent-lead (not blocking)
- **`tests/test_uct_agent_program_gateway.py:45`** asserts `registry().names() == []` (Sprint 0), so it reds on any PR that registers a kind, #570 included. Please relax it to "dark by default". It's your file, so I haven't touched it.
- **Gateway:** a scan whose spec the adapter refuses still uses the turn's one scan, because `gateway.read` admits and counts before the kind runs. A pre-admission `validate(params)` hook on `Kind` would let a bad spec be refused without spending the scan. This is a hot spot (`gateway.py`), so I'm asking, not editing.

## Handoffs (to / from)
- agent-qa: SC-1 §2a is the conformance target for scan envelopes. Fixture: a tmp `SCREENER_DB_PATH` with `snapshot_db.upsert_rows` (see the test file).

## Ready for integration
- PR #570 (pending the gateway-test relaxation above)
