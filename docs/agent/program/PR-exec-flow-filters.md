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

## The server relaxation, exactly (AUDIT #1029 item 2)

`turn.py` refuses, AFTER the model answers, any turn whose message names a hidden field and that plans a screen or is screen-shaped (`hidden_why and (plans_screen or hidden_screen_request(msg))`). The F-16 exception is the one `and not ...` on that line. Before: `plans_only_flow_calls_chip` (#872, `626d7c8798`, never on master). After: `plans_only_flow_chips` (the old name is an alias of it). Both run on the RAW planned ops, before validation, and both return True only when every one of these holds:

| check | before: `plans_only_flow_calls_chip` | after: `plans_only_flow_chips` |
|---|---|---|
| the hidden phrase the message names | the widget's name, "options flow" (also "option flow", "options-flow") | same, unchanged |
| a chip word in the message | `\bcalls?\b` | `_FLOW_CHIP_WORD`: calls, puts, sweeps, blocks, bull(ish), bear(ish), premium, million, 250k, 500k, 1m |
| no universe of stocks in the message (stocks, names, tickers, equities, companies) | required | same, unchanged |
| the plan has at least one op | required | same, unchanged |
| the turn's own board carries an `optionsflow` widget | required | same, unchanged |
| EVERY op's action | `widget.setOption` | same, unchanged |
| EVERY op's widget | an `optionsflow` widget on this turn's board | same, unchanged |
| EVERY op's key | `callPut` only | one of `minPremium`, `callPut`, `printType`, `direction` |
| EVERY op's value (case-insensitive) | `calls` or `c` | a chip of THAT key in `_FLOW_CHIPS`: its stored value or the word on it (`0 / all / 250000 / $250k / 500000 / $500k / 1000000 / $1m`; `all / c / calls / p / puts`; `all / any / sweep / block`; `all / bull / bear`) |

Plan shapes, for "only sweeps in the options flow" (or the matching chip message), on a board with an Options Flow widget `of` and a News widget `nw`:

| planned ops | before | after | test |
|---|---|---|---|
| `setOption(of, callPut, Calls)` | served | served | f16_calls_control `test_the_calls_chip...` |
| `setOption(of, callPut, Puts)` | refused | served | f16_flow_chips `test_every_chip...` |
| `setOption(of, printType, Sweep)`, `direction Bear`, `minPremium $1M / 500000` | refused | served | f16_flow_chips `test_every_chip...` |
| two or three chip ops on `of` (calls + sweep + bull) | refused | served | f16_flow_chips `test_every_chip...`, `test_two_chip_ops_alone...` |
| a reset chip (`callPut All`) | refused | served | f16_flow_chips `test_every_chip...` |
| a value no chip has (`ML`, `2000000`, `Straddles`) | refused | refused | f16_flow_chips / f16_calls_control |
| a key no chip group has (`darkPool`, `lead`, `filters`) | refused | refused | same |
| a chip op on another widget, or on a widget not on this board, or no flow widget on the board | refused | refused | same |
| prose (no ops) | refused | refused | f16_calls_control |
| any screen (`screener.run`, public or hidden field) | refused | refused | both files |
| **a chip op MIXED with any other op**: each of the 156 other capability names in the golden manifest, an unknown action, an empty action, a non-chip `setOption`, an op with no args or non-object args, a non-object op; the other op first or last | refused | refused | f16_flow_chips `test_a_chip_op_mixed_with_any_other_action...` (316 cases: 158 actions × 2 positions), `test_a_chip_op_mixed_with_a_set_option_that_is_no_chip...` (14 cases) |
| any plan, when the message names a universe of stocks, names "dark pool", or has no chip word | refused | refused | both files |

What the relaxation does NOT check, as before: that the chip value matches the chip WORD in the message ("only calls..." planned as `callPut Puts` is served). It is the widget's own visible control, undoable, with no data read; the browser's which-widget and same-group guards run after it. Nothing else is opened: no field, no route, no data.

Python files (CI's server-tests job; pytest was NOT run here, by rule): `tests/test_uct_agent_f16_flow_chips.py` (new, the mixed-plan cases added for this AUDIT), `tests/test_uct_agent_f16_calls_control.py` (#872's, amended), and `tests/test_uct_agent_w11_repair_b.py` (unchanged, also exercises this path). The new test file was parse-checked only (`ast.parse`).

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

**Mutations (AUDIT #1029 item 1).** The earlier "10 failed / 29 passed (39)" was ONE run with all three mutants applied together. It counted failing TESTS, not surviving mutants, so it is replaced here by one run per mutant.

Setup: scratch worktree at `e62493395b`, one mutant applied at a time and then reverted. Each run covers the same 5 files, 102 tests: flowFilters.outcome, agentFlowFiltersHeldOut, agentFlowChipsParity, agentWhichWidget, agentWidgetOptions. Command: `python ../tools/agent_suite_lock.py run --who pl-widget -- npx vitest run <the 5 files>`, at BelowNormal. Specs: scratchpad `f16m/mutants.json`.

Found by this run: `agentFlowChipsParity.test.js` failed to LOAD on the fresh CRLF checkout, in the base run too. Its `_FLOW_CHIPS` regex expected LF. It is fixed at `697274a7f7` (line endings normalised). In the table, parity is therefore a load failure in every row and is not counted. M7 and M8 target parity, so they were re-run on the parity file alone at `673a92b65e` (same code as `697274a7f7`; that commit only changed this doc), base first: `Tests 3 passed (3)`. Command: `cd app && npx vitest run src/agent/agentFlowChipsParity.test.js` (single jsdom file, no lock). Logs: `evidence/f16-mutants-parity-{base,M7-server-table-drops-a-chip,M8-server-word-drops-sweeps}.txt`; each prints the node_modules LinkType/Target first (Junction to `C:/w/pl-mc-fw/app/node_modules`).

**AUDIT note (parity file, local vs CI).** Locally (`core.autocrlf=true`), `agentFlowChipsParity.test.js` never loaded before `697274a7f7`, so every earlier LOCAL mutant "kill" that relied on that file was vacuous. The valid mutation table is the rerun after `697274a7f7` (M7 / M8 rows below, on the parity file at `673a92b65e`). On CI (Linux, LF) the file DID load and pass: run 42895564240 shows `✓ src/agent/agentFlowChipsParity.test.js (3 tests)` at `08b0cfd9b3`.

| mutant | what changed | tests failed / 102 | killed by |
|---|---|---:|---|
| base | none | 0 (parity load fail, see above) | — |
| M1 fail-closed off | no words → no guard | 2 | agentWhichWidget "no words at all … FAIL CLOSED" (setOption, sendToJournal) |
| M2 conflict guard off | same-group check skipped | 3 | the 3 conflict held-outs (calls and puts / sweeps and blocks / bull and bear) |
| M3a chip gate closed | asksAFlowChip → false | 18 | agentWidgetOptions owner-exception and F-16-widened cases, flowFilters held-outs |
| M3b chip gate open | asksAFlowChip → true | 4 | agentWidgetOptions "balls / falls / cells is no chip word", "F-16 holds" |
| M4 approved re-asked | the approved skip removed | 4 | agentWhichWidget "an approved proposal: never asked again" ×2, flowFilters approve cases ×2 |
| M5 re-aim off | a named other widget not re-aimed | 2 | agentWhichWidget "words that name the OTHER one" ×2 |
| M6 chip words swapped | Bull ↔ Bear words | 4 | flowFilters bearish held-outs ×2, the bull-and-bear conflict, agentWidgetOptions "only show bears" |
| M7 server table drops $1M | `_FLOW_CHIPS` | 1 of 3 (parity file, at `673a92b65e`) | agentFlowChipsParity "every chip, by stored value and by the word on it, maps to its stored value" (minPremium: 6 keys vs 7) |
| M8 server word drops sweeps | `_FLOW_CHIP_WORD` | 1 of 3 (parity file, at `673a92b65e`) | agentFlowChipsParity "every chip word a member types … is one the server reads as a chip request" (printType: Sweep) |
| M9 turn.py widening off | `plans_only_flow_chips` only Calls | CI only (pytest) | tests/test_uct_agent_f16_flow_chips.py `test_every_chip_of_a_flow_widget_on_this_board_is_served` (CI) |

Every mutant run here (M1 to M8) is killed by at least one test, and none survived. M9 is CI only (pytest).

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

## Changed files (git diff --stat origin/master...HEAD at e2be1abf86; merge base 292983f4bc; this commit adds only this list)

```
 api/services/uct_agent/turn.py                     |  52 +++++-
 app/src/agent/agentFlowChipsParity.test.js         |  43 +++++
 app/src/agent/agentFlowFiltersHeldOut.test.js      |  55 +++++++
 app/src/agent/agentWhichWidget.test.js             |  27 +++
 app/src/agent/agentWidgetControls.test.jsx         |   8 +-
 app/src/agent/agentWidgetOptions.test.jsx          | 130 +++++++++++++--
 app/src/agent/capabilities/board.js                |  52 +++++-
 app/src/agent/capabilities/screener.js             |  37 ++++-
 app/src/agent/fastPath.js                          |  21 +--
 .../qa/chartsOutcome/flowFilters.outcome.test.jsx  | 182 +++++++++++++++++++++
 app/src/agent/settingsLiveness.test.js             |   4 +
 app/src/agent/steps.js                             |   2 +-
 app/src/agent/useAgent.js                          |  24 +--
 app/src/widgets/widgetControls.js                  |  13 +-
 docs/agent/CHARTS_EXECUTION_STATUS.md              |  20 ++-
 docs/agent/program/PR-exec-flow-filters.md         | 164 +++++++++++++++++++
 ...mutants-parity-M7-server-table-drops-a-chip.txt |  34 ++++
 ...-mutants-parity-M8-server-word-drops-sweeps.txt |  27 +++
 .../program/evidence/f16-mutants-parity-base.txt   |   9 +
 docs/agent/program/evidence/f16-run2-dark-pool.txt |  27 +++
 docs/agent/program/recount-flow-filters.mjs        | 101 ++++++++++++
 tests/test_uct_agent_f16_calls_control.py          |  84 ++++++++++
 tests/test_uct_agent_f16_flow_chips.py             | 105 ++++++++++++
 23 files changed, 1162 insertions(+), 59 deletions(-)
```
