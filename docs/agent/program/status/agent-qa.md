# Status — agent-qa (QA & integration)

Only agent-qa edits this file. Update it in every PR.

## In flight
- **PR 1 — program fixtures** (`agent/qa/fixtures-v1`): fake-provider DataEnvelopes for all 12 MD-1 v1 kinds and
  the 3 SC-1 kinds; cases live · delayed · periodic · historical · stale · market-closed · unavailable · refused ·
  partial · no-source-time. JSON under `app/src/agent/__fixtures__/program/` (generated), Python loader + rail in
  `tests/test_uct_agent_qa_fixtures.py` (`load_fixture`, `cases_for`, `fake_kind`, `fake_registry`), browser
  loader `app/src/agent/__fixtures__/program/index.js`.
  ⚠ Per-kind `data` shapes for MD-1 kinds are PROVISIONAL until agent-md documents them; envelope = MD-1 §3,
  scan `data` = SC-1 §2.
- Next: PR 2 conformance suite, PR 3 cost and limits suite, PR 4 integration.

## Findings (open; the fix belongs to the owner)
- **F-1 (agent-lead / agent-md): `app/src/agent/marketdata/client.js` is unreachable.**
  Repro: `cd app && npx vitest run src/components/screener/reachable.test.js`.
  Expected: the client is imported by a capability or a test, or has an `AWAITING_A_DECISION` entry.
  Actual: listed as "connected to nothing". It is the MD-1 browser door, so it is expected to stay unwired
  until a capability uses it; it needs an `AWAITING_A_DECISION` entry or an importer.
- **F-2 (outside the program, recorded for agent-lead to route):** the same rail fails on master content.
  The "DASHBOARD COCKPIT RETIREMENT" parking note expired 2026-10-31.
  `components/chart/supportLoop/doorNameCoverage.js` is unreachable.
  `components/chart/engine/ast/doorCoverage.js` is reachable but still parked.
  None are in an agent-qa path.
- **F-3 (agent-lead), reported by agent-md on PR #569:**
  `tests/test_uct_agent_program_gateway.py::test_dark_by_default_and_nothing_registered` asserts that no kinds
  are registered, so it fails as soon as MD-1 kinds land. It needs agent-lead to update it.

## Blockers
- (none)

## Handoffs (to / from)
- To agent-md, agent-sc: fixtures ready to code against once PR 1 merges.
- From agent-md: PR #569 (quote, quotes) is ready. An ownership check and conformance review are queued.

## Ready for integration
- PR 1 (fixtures), once opened.

## Verdicts on `agent/int`
- (none yet)
