# PR: the Options Flow widget's chips (F-16 widened) and the which-widget ASK guard

Branch `agent/pl/exec-flow-filters` (pl-widget), on master `292983f4bc`. It builds on #872 (`agent/pl/f16-widget-claim`, Calls Only): its three commits are cherry-picked, with one test-file conflict resolved in #872's favour. #872 can be closed as superseded.

## Owner decision

F-16 is widened to EVERY existing Options Flow widget filter chip: Calls, Puts, Sweep, Block, Bull, Bear, and the premium floor. The Agent operates only the widget's own control (widget.setOption → `opts.filters`), exactly as the chips write it. It never runs a screen, no hidden field or proprietary value reaches the model (chip values only), no data access is added, and no trade is placed (the widget has no order path).

## The chips, as the UI has them (OptionsFlowWidget.jsx)

| group | chips (stored value → word) | key |
|---|---|---|
| Min premium | 0 All · 250000 $250K · 500000 $500K · 1000000 $1M | `minPremium` → `filters.minPrem` |
| Call / put | all All · C Calls · P Puts | `callPut` → `filters.cp` |
| Print type | all Any · SWEEP Sweep · BLOCK Block | `printType` → `filters.type` |
| Direction | all All · BULL Bull · BEAR Bear | `direction` → `filters.dir` |

- Each group is single-select (one chip on). Groups combine with AND, as the widget's own client-side filter does.
- There is no "clear all" button: a reset is each group's own All / Any chip.
- A request for two chips of ONE group ("calls and puts only", "sweeps and blocks") is refused with the group's own choices: "callPut on the Options Flow is one choice: All, Calls, Puts — not Calls and Puts together". The UI cannot show that combination, so the Agent never lets one value quietly win.
- A value no chip has (a $2M floor, ML, "Straddles") or an invented filter ("dark pool") is refused. Nothing is written.

## What changed

- `app/src/widgets/widgetControls.js`: the four rows get `shown` (the chips' own words, including All / Any) and `also` (how a person says one: bullish, bearish, million, 500k…).
- `app/src/agent/capabilities/screener.js`: #872's Calls-only gate becomes `asksAFlowChip`. Every chip word is data from those rows, with no phrase list. "Only Calls Only" is no longer said.
- `app/src/agent/useAgent.js` (approved by the Lead; minimal):
  - the round-3 `FLOW_WIDGET_REFUSAL` block, its constant and its two now-unused imports are REMOVED (chip requests are no longer claimed as screens, so they reach the planner);
  - `execute` takes `words` (the turn's own message on the model path; added at the two model-path calls) and calls `resolveArgs(args, host, words ?? member, { approved })`.
- `app/src/agent/steps.js`: the step path passes `words` too.
- `app/src/agent/capabilities/board.js`, two shared guards on the one widget-control layer:
  - **Same-group conflict.** One choice per single-select control per request. It is kept on the plan's own state object, so a no-op keeps its identity.
  - **Which widget (owner rule: ASK when unclear).** Applied to `widget.setOption` and `widget.sendToJournal`. When the op's widget is one of 2+ of its type on the visible board, and the words name none of them (by place among its type or on the board, by the list or scan it shows, by its unique linked ticker), the member is asked, with each candidate. Words that name the other one re-aim the op there.
    - It FAILS CLOSED: no words means asked.
    - An APPROVED proposal is not asked again. It exists only because the guard already ran on its request, and its ops carry the widget that was named or picked.
    - Once #988 merges, its stored original proposal words feed this on approve, as ONE mechanism (a Lead condition for the rebase).
- `api/services/uct_agent/turn.py`: the server's F-16 exception widens from `plans_only_flow_calls_chip` to `plans_only_flow_chips` (`_FLOW_CHIPS` table, `_FLOW_CHIP_WORD`); the old name is kept as an alias. Every planned op must set one of the widget's chip groups to one of its own chips, on an Options Flow widget on this turn's board, for a message that names the widget and a chip. Anything else keeps the refusal.
  - `app/src/agent/agentFlowChipsParity.test.js` pins the server table to the JS rows.
- Python tests, which CI's server-tests job runs (pytest was not run here):
  - `tests/test_uct_agent_f16_flow_chips.py` (new);
  - `tests/test_uct_agent_f16_calls_control.py` (#872's file; its "another chip is refused" cases became served, and two new refusal cases were added).

  `tests/test_uct_agent_w11_repair_b.py` also exercises turn.py's F-16 path (unchanged).

## Tests (LOCAL, SIMULATED: vitest + jsdom, scripted model, invented fixture prints; not a browser, not the real model)

Held-out families were committed FIRST (`860b438521`): `agentFlowFiltersHeldOut.test.js`, covering:
- 12 set phrasings and 2 resets;
- 5 refusals (3 same-group conflicts, a premium no chip has, an invented filter);
- 4 two-widget cases.

The outcome test is `qa/chartsOutcome/flowFilters.outcome.test.jsx`, over the REAL OptionsFlowWidget. The end state is read from `opts.filters` AND from the prints the widget draws; the chart is untouched; Undo is exact. Plus:
- two widgets, asked or named;
- approve paths: a click on a named proposal acts on that widget only; a typed "yes" on a named proposal does not re-ask; an unnamed request is asked before any proposal exists.

Unit rails: `agentWhichWidget.test.js` (fail closed, named, re-aimed, single widget, approved) and `agentFlowChipsParity.test.js`.

**Before the fix.** Product files were reverted to #872's head `626d7c8798`, with the tests at `cf59dbfb83`.
- `flowFilters.outcome` with `-t held-out`: `Tests 13 failed | 11 passed | 15 skipped (39)`.
  - The 10 held-out cases that passed before: single-chip phrasings #872's state already let reach the model (the rows existed, and those words don't read as a screen), plus the named-widget case.
  - The 13 that failed: the chips #872 refused as screens (sweeps, premium…), the conflicts, the two-widget asks, the reset.
- Unit rails (`agentWhichWidget`, `agentFlowChipsParity`): `Tests 12 failed (12)`.

**Mutations,** on `5ca372766b`, in a scratch worktree:
1. fail-closed off (no words → no guard);
2. same-group conflict guard off;
3. chip gate off.

Totals: `Tests 10 failed | 29 passed (39)`. Each mutation was caught:
1. the fail-closed unit rails (×2);
2. the 3 conflict held-outs;
3. the chip held-outs, among them "only sweeps in the options flow", "only 500k and up…" and the two-widget sweeps cases.

**Head** (`5ca372766b`, 15 files, focused, NOT a full run): `Test Files 15 passed (15)` / `Tests 919 passed (919)`. The files were:
- flowFilters.outcome 27;
- agentFlowFiltersHeldOut, agentFlowChipsParity 3, agentWhichWidget 12;
- agentWidgetOptions 62, agentWidgetControls 56, settingsLiveness 13, agentExecSideEffect, agentHidden;
- agentContracts, capreg inventory, agentNl1Selection;
- widgetDoorRows, widgetControls, watchlists outcome.

**Expectations corrected after run 2, and why.** The raw output of both original expectations is kept in `docs/agent/program/evidence/f16-run2-dark-pool.txt`.
- The held-out "only dark pool prints in the options flow" expected the capability's "no option darkPool". The actual path is the F-16 SCREEN refusal: "dark pool" is itself a hidden phrase, not the widget's name. The test now asserts that actual refusal text. The outcome assertions are unchanged and strict: refused, nothing written, no chip changed, nothing proposed.
- `agentWidgetControls` readOptions now reads "minPremium All" (the chip's word) instead of "minPremium 0".

## Rows

- C3-166 MISSING → VERIFIED (SIMULATED). Recounted by `docs/agent/program/recount-flow-filters.mjs`: 225 → 226 of 484 on this base.
- C3-164 / C3-165 are covered by #1023 and not touched here.
- When #1023 and #1027 land first, the recount scripts re-run on the new master. Each one stops if it cannot reproduce the current table.
