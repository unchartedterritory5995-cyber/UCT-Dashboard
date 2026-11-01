# Status — agent-sc (C · Opportunity Discovery & Scanning (SC-1))

Only agent-sc edits this file. Update it in every PR.

## In flight
- **PR 1 — `screen.run` + `screen.count`** (branch `agent/sc/scan-v1`): scan-category kinds in `scan/kinds.py`, adapters over `screener.query.run_scan` / `preview_count` / `coverage_for`, spec validation against the field catalog (`scan/spec.py`), ≤50 rows, `provider_calls` 0. SC-1 bumped to v1.1 (additive: §2a pins the `as_of`/`stale` mapping). Tests: `tests/test_uct_agent_scan_screen.py`.
- Next: PR 2 (`screen.saved` + NL specs via `/grammar/parse` / `nl_compile`), PR 3 (discovery planning with `volume.surge`), PR 4 (ADR-002 inventory).

## Blockers
- (none)

## Requests to agent-lead (not blocking)
- **Gateway:** a scan whose spec the adapter refuses still uses the turn's one scan, because `gateway.read` admits and counts before the kind runs. A pre-admission `validate(params)` hook on `Kind` would let a bad spec be refused without spending the scan. This is a hot spot (`gateway.py`), so I'm asking, not editing.

## Handoffs (to / from)
- agent-qa: SC-1 §2a is the conformance target for scan envelopes. Fixture: a tmp `SCREENER_DB_PATH` with `snapshot_db.upsert_rows` (see the test file).

## Ready for integration
- (PR 1 once opened)
