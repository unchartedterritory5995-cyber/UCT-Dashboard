# PR: outcome tests for the 12 held-out-only execution rows

Branch `agent/pl/exec-heldout12`, on master 5fed0561f1 (#1016 merged). Test and docs only; no product code.

## What it adds
- `app/src/agent/qa/chartsOutcome/heldout12.outcome.test.jsx`. Outcome tests through the REAL Agent panel with a scripted
  model. Each case checks:
  - the end state, read back from the stored opts or the chart blob through the product's readers;
  - that the chart and every other widget are byte-identical;
  - that Undo is exact;
  - that the scripted plan really was consumed.
- `docs/agent/program/EXEC-HELDOUT12.md`: method, the per-row table, and the gaps.
- `docs/agent/CHARTS_EXECUTION_STATUS.md`:
  - the 12 rows are updated in "All actions";
  - "Counts by area", "The number" and the runtime-only bullet are recounted;
  - a "Combined counts" row is added;
  - an "Update 2026-11-10 (2)" section is added.
- `docs/agent/program/recount-h12.mjs`: the script that made the status-doc change. Run it as
  `node docs/agent/program/recount-h12.mjs docs/agent/CHARTS_EXECUTION_STATUS.md`; it is a dry run without `--write`. It first
  checks that its recount reproduces the previous "Counts by area" exactly from the previous rows, and it keeps every line's
  line ending.

## Result
- **Command (from `app/`):** `npx vitest run src/agent/qa/chartsOutcome/heldout12.outcome.test.jsx`
- **Commit:** 5fed0561f1 plus this branch's test.
- **Scope:** one file.
- **Totals:** `Test Files 1 passed (1)` / `Tests 33 passed | 4 todo (37)`.
- **Evidence label:** jsdom panel test, SIMULATED (scripted model). Not a real browser, no paid model, no backend.

## Counts (recounted from "All actions")

| | VERIFIED | PARTIAL | IMPL / UNVERIFIED | MISSING | BLOCKED | UNMAPPED | In scope | Excluded |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| before (master 5fed0561f1) | 225 | 9 | 69 | 126 | 43 | 12 | 484 | 19 |
| after | 233 | 13 | 64 | 119 | 43 | 12 | 484 | 19 |

- VERIFIED (8): C1-065, C1-066, C3-125, C3-133, C3-159, C3-164, C3-165, C3-194.
- PARTIAL (4): C3-151, C3-166, C3-195, C3-206. PARTIAL rows are never counted as VERIFIED.
- Runtime-only IMPLEMENTED / UNVERIFIED rows: 29 before, 25 after.

## Known gaps (pinned: `it.fails` outcome + a plain `it` asserting today's exact output)
1. **C3-151.** "show only 3 star economic events" and "calendar widget: only 3 star economic events" reach the model with no
   `widget.setOption` and no widgetControls section (only `calendar.day` is offered). "change the calendar widget filter to 3
   stars" works. This is a routing-word gap.
2. **C3-166, a product fix for pl-exec.** "only show sweeps in the options flow" is answered before the model by
   `FLOW_WIDGET_REFUSAL` (useAgent.js:2299-2305: the screener fast path reads "sweeps" as a flow screen filter, and the message
   names the Options Flow widget). That refusal is stale: `widget.setOption printType` already sets that very filter ("options
   flow: sweeps only" passes).

## it.todo (no capability)
- C3-195: market map zoom.
- C3-206: replay to the end date, the start mark, and ungrouping back to stocks.
