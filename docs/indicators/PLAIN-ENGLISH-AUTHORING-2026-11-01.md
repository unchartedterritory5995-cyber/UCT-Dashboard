# Plain-English indicator authoring: where it stands (2026-11-01)

Measured on `origin/master` `2cd4c3839c`. Every `file:line` here is a dated claim; re-read the code
before relying on a line number.

## 1. The layer already exists, and it is the right shape

A trader's description becomes a definition through a **model-assisted interpretation layer that emits
structured, validated patches over the canonical engine**. Nothing in it is a second calculation engine,
and the owner's three examples are all expressible today:

| Example | How it is built | Door |
|---|---|---|
| "highlight when the 9 EMA crosses above the 20 EMA" | output `crossOver(ema(close, 9), ema(close, 20))` + `set_marker` / `set_paint` | `/converse` |
| "RSI 28 with a 5-period moving average of RSI" | two outputs: `rsi(close, 28)` and `sma(rsi(close, 28), 5)` | `/converse` |
| "background green when the 9 EMA is above the 20 EMA" | yes/no output + `set_paint{channel: "bgcolor"}` | `/converse` |

There are two doors:

- **`POST /api/user-definitions/converse`**: the full builder door.
  - Code: `api/routers/user_definitions.py`, `api/services/definition_conversation.py`.
  - It is behind the `create-indicator` cohort gate (`CREATE_INDICATOR_COHORT_ENABLED`, default off) or admin access.
  - The model emits a `uct.authoring.patch/1` envelope (`authoring/patchSchema.json`).
  - The browser applies it atomically (`authoring/applyPatch.js`): canonical check, expansion, node-type allow-list, evaluate, hash round-trip, repaint refusal.
  - The browser then reads it back in words (`authoring/readback.js`).
  - Saving goes through the ordinary door (`prepareSave` → `validateUserDefinitions`).
- **`POST /api/user-definitions/propose`**: one formula column only. No markers, paints or second outputs.
  - Code: `definition_concierge.py`.
  - It is the box non-cohort members see (`ConciergeBox.jsx`) and the scan tab's box.

UCT Agent reaches the same layer through `components/chart/builder/agentAuthoring.js` (`openDraft`,
`draftTurn`, `saveDraft` …). It is one layer, with two callers.

## 2. What tonight's probe found

**Method.** 58 synthetic trader phrasings, run through the door's deterministic half: the pre-flight,
member names and the planner. This is everything a turn does before the model is called, and it costs
nothing to run.

**What it showed.** A phrase refused there costs the member a turn and never reaches the model.

### Defect 1: full indicator names were refused with no model call (FIXED)

The planner's Title-Case rule refuses an unknown capitalised phrase as an unnamed concept (the McGinley
rule: "Add the McGinley Dynamic" must never reach a model that might substitute an EMA). But a declared
function was reachable **only by its code name**. So all of these were refused, while the lower-case
spelling of the same request reached the model:

- "show the **Relative Strength Index** 14"
- "plot the **Average True Range**"
- "plot the **Weighted Moving Average** 20"
- "show the **Commodity Channel Index**"
- "**Money Flow Index**"
- "**Hull Moving Average**"
- "**Donchian Channel**"
- "**Ichimoku Cloud**"

**Fix.** `preflightRules.json::chartFunctionWords`, the existing shared data table for this door's
function words, now carries the conventional full names of functions `closedTable.json` already
declares. No maths was added, and undeclared studies stay refused: Chaikin Money Flow, Awesome
Oscillator, Ultimate Oscillator, McGinley Dynamic.

### Defect 2: "Bollinger Bands" was refused, and no function existed to name (FIXED)

Bollinger Bands are the most-requested overlay that was missing. Pine's `ta.bb` already lowers to
`sma(src, n) ± mult × stdev(src, n)`.

**Fix.** Added the call expansions `bbMiddle` / `bbUpper` / `bbLower`, following the Keltner
precedent exactly:

- both lanes: `callExpansions.js` and `call_expansions.py`;
- read-back by name;
- slots;
- name labels;
- the model's function list.

Each builds **the same tree as the Pine import**, so a pasted `ta.bb` and "add Bollinger Bands" store
one identity, pinned by `astHash`. A bare `sma` is never renamed `bbMiddle` unless the member wrote
`bbMiddle` (`allowBareSma`, as `kcMiddle` does for `ema`).

### Defect 3: a working candle indicator was contradicted by an internal note (FIXED)

"mark a doji", "every inside day" and "highlight bullish engulfing candles" reach the model, which
builds them from OHLC. But the planner also names a **screener** text column for each (`candle_matches`,
`bar_character`), and the chart door printed it under the finished indicator:
"candle_matches isn't available yet — TEXT -- the Candle Matches column…". That line leaked an
internal column name and manifest prose, and it was false.

**Fix.** `authoringSession.unavailableLines`:
- a turn that **built something** no longer prints these notes. The read-back already says what was
  built, and the model is never shown the notes (`_language_notes`).
- a turn that built nothing says, in member words: "“sector” is a text label in UCT's screener data,
  which a chart formula can't read."

Rail: `authoring/unavailableLines.test.js`. A mutation that puts the old line back reds it.

### A prior manifest ruling, reversed for review

`closedTable.json::_functions_excluded` refused `bbUpper` / `bbMiddle` / `bbLower` as **table
entries**, for two reasons:
- the `int`-only multiplier;
- a second spelling and a second implementation.

Both reasons are met by an expansion:
- the multiplier is any node;
- the stored definition holds the expanded `sma ± k × stdev`, which is one implementation.

The three rulings are rewritten in place (SAR's precedent), with the old text quoted. The three
`formulaHints.json` "write it as sma + 2 * stdev" hints are removed, because `bbUpper(…)` now parses.
**This reverses a written decision and should be read by a reviewer before it merges.**

### Refactor that makes it testable

`definition_conversation.understand_turn(message, chart)` is the deterministic half, extracted
**unchanged** from `_converse_turn`. `tests/test_plain_english_chart_door.py` drives the real code over
`tests/fixtures/authoring/plain_english_chart_door.json`. A rail asserts that `_converse_turn` calls it,
and that no second copy of the pre-flight remains.

## 3. Remaining gaps, in priority order

1. **Who can use the full door is a rollout decision.** Non-cohort members get `/propose`, which cannot
   paint, mark or add a second output, so none of the three examples work for them today. This needs
   no code; it is the owner's decision under the existing cohort gate.
2. **`/propose` and the scan concierge still refuse the full names.** The shared planner (`dc.LEXICON`)
   was left untouched on purpose; the screener's planner reads it too. Extending it is a one-line
   lexicon merge, but it changes a screen door's behaviour, so it needs the Screener owner's OK. A rail
   records the current behaviour as a follow-up, not as a property to keep.
3. **No live-model evaluation of the corpus.** Every test here is model-free. A paid run through the
   real model would score how often `/converse` builds the intended definition. The fixture is ready
   for it, but the run needs authorization (spend).
4. **"MA of RSI" restates the RSI subtree.** An output cannot reference another output
   (`applyPatch.js` `scopeOf`). The maths is correct, and the hash is the same as hand-writing it. The
   cost is tree size and op budget on deep stacks.
   - An output-reference node would be an engine-format change: a stored-definition shape change, both
     lanes, and sweep identity.
   - **Proposal only.** It is not started and needs review.
## 4. Verification (local, 2026-11-01, branch `feat/indicators-plain-english`)

**JS** (`vitest run src/components/chart/builder src/components/chart/engine src/agent src/testing`):
- 1159 files; 18,732 passed, 4 failed.
- The 4 failures are the known `origin/master` baseline: `symbolFoldParity` ×3 and
  `targetScriptReport.measure` ×1. **0 new.**

**Python**, 21 neighbouring files (conversation, concierge, truth, slice2, batch1/2, rollout, vocabulary,
call-expansion parity, vendor truth, scalars, the new corpus):
- 732 passed, 12 failed.
- All 12 are the known baseline (`test_concept_vocabulary` ×6, `test_definition_concierge` ×5,
  `test_ast_scalars` ×1). The first 11 were re-measured identical on a clean `origin/master` checkout.
  **0 new.**

**Mutations**, each reds its rail:
- the new words removed reds 14 corpus cases;
- the old unavailable line restored reds the change-path case.

**Lane parity:** the new expansions build byte-identical trees in both lanes, and the same `astHash`
as Pine's `ta.bb` parts.

**No model was called.** No paid service, flag, data or deploy was involved.

## 5. Lifecycle audit, the same night (read-only; one item fixed separately)

These open defects are recorded in docs or tests and confirmed present in code, ranked by impact over
size:

| # | Defect | Evidence | Size | State |
|---|---|---|---|---|
| 1 | A saved `fund:` / Market Cap / `econ:` source is blank after a reload | OPEN-FINDINGS §10 | S | **fixed** on `fix/indicators-fund-source-reload` |
| 2 | The Save receipt covers the legend and the top-left chart objects | OPEN-FINDINGS §2; `studio/SaveReceipt.jsx` | S | open |
| 3 | The model can relabel an output the member never named; only the prompt forbids it | OPEN-FINDINGS §3 | S–M | open |
| 4 | Edits on override-hosted charts (grid cells, drill, widgets) write indicator changes into the global `chart_settings` | A1 reports; `StockChart.jsx` restore | M | needs an owner decision |
| 5 | A reused output key silently re-binds whatever reads it | `p2x.sourceref.truth.test.js` `it.todo` | L | open; needs output provenance |
| 6 | Low contrast on the light "Paper" theme | OPEN-FINDINGS §9 | S–M | chart-theme owner |
| 7 | The stored drill-board blob keeps removed instances | FINDINGS-FOR-OTHER-OWNERS | S–M | open |
| 8 | The legend's context menu has no focus trap | `BuilderSheet.jsx` note | S–M | accessibility |
