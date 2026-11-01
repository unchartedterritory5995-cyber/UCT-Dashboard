# Status — agent-sc (C · Opportunity Discovery & Scanning (SC-1))

Only agent-sc edits this file. Update it in every PR.

## Integrated (agent/int)
- **#570** `screen.run` + `screen.count`: SC-1 v1.1 §2a, the `Kind.validate` precheck, and the F-4 zero-match fix. QA 79/79 after the merge.
- **#578** `screen.saved` + `saved_id` / `text` sources: SC-1 §2b, acked. QA 19/19 after the merge.
- **#580** (agent-lead) ADR-002 accepted with agent-sc's inventory of legacy-screener callers.

## In flight
- **Discovery corpus + `screen.saved` coverage fix** (branch `agent/sc/scan-corpus`, this PR).
  - `api/services/uct_agent/scan/eval/discovery.json`: 31 questions in agent-qa's schema, across 8 categories plus refusals. The `nl` flag marks natural-language interpretation cases (evidence for whether a paid compiler is ever needed). No paid compiler runs.
  - `tests/test_uct_agent_scan_corpus.py`: every expected answer parses in the screener's own grammar and names real catalog fields. agent-qa owns the scorer (`tests/test_uct_agent_qa_scan_corpus.py`).
  - `screen.saved`: `coverage` counts every screen, while only the 100 newest are listed (agent-qa's low finding).
- **Screener capability through the gateway** (branch `agent/sc/screener-gateway`, pushed, PR not yet opened).
  - The run, runSaved and listSaved answers go through `readData` when `serverServesScan()`; with the flag off, the path is byte-identical.
  - `produce()` and latest-session measure screens stay on the Screener's route, above SC-1's 50-row cap. agent-lead approved this.
  - **Waiting on #581** (`trace.currentTurnId()`). Then: switch the turn id, add the `panelHarness` acceptance scenario, and open the PR.
- Next: PR 3 discovery planning with agent-md's `volume.surge` once it's integrated.

## Scope rulings
- **Indicator conditions are out of SC-1 in Sprint 1** (agent-lead, 2026-11-01). The screener `scan` key is refused, never approximated.
  - IC-1 draft.2 (#573) is confirmed by agent-sc: C1–C8 resolved.
  - The delegating kind will be **SC-1 v1.2**, unscheduled. It is keyed by `result_identity`; `not-run` = `unavailable`.
- **`/api/screener/compile` is not used** (a paid model path). This is a standing rule, recorded in ADR-002.
- **SC-1's 50-row cap stays.** Raising it for `produce` is a later SC-1 decision for agent-lead.

## Blockers
- `agent/sc/screener-gateway`: waiting on #581 merging into agent/int.

## Handoffs (to / from)
- agent-qa: scorer for `discovery.json` (their path); the #572 scan fixtures mirror the merged shapes.

## Ready for integration
- `agent/sc/scan-corpus` (this PR).
