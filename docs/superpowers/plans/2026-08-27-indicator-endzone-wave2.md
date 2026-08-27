# Indicator End-Zone — Wave 2 & 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining acceptance criteria (A2, A3, A7, A9, A10, A11, A12) so a member can author, import, scan, share and back-test custom indicators at parity with TradingView / thinkorswim / TC2000.

**Architecture:** Wave 1 shipped the spine — one `def_hash` across five surfaces, a 62-function closed table, nightly + live sweeps with coverage receipts, and an Evidence tab. Wave 2 generalises the **expression grammar** (two new node types, then outputs-that-draw, then statements) and adds the **sharing** surface. Wave 3 adds strategies on top.

**Tech Stack:** JS engine (`app/src/components/chart/engine/ast/*`) mirrored at 1e-9 by Python (`api/services/ast_*.py`) over one manifest (`closedTable.json`); FastAPI + SQLite; React 18 + Vitest; pytest.

**Spec:** `docs/superpowers/specs/2026-08-25-indicator-ecosystem-endzone-design.md` (§5.2, §5.6, §5.7, §5.8, §5.9; wave ownership §6; the 2026-08-27 amendments to A2/A3/A4/A5).

---

## Global Constraints

Every task inherits these. They are the spec's §4 non-negotiables plus what Wave 1 measured.

1. **Two lanes, one manifest, 1e-9.** Any new node or entry lands in `interpret.js` AND `ast_interpret.py` in the same change, declared once in `closedTable.json`. `lesson_rail_the_mirror_not_just_the_lane`.
2. **A silent mistranslation is worse than a refusal.** Every refusal names its **guard**, its **token**, and — where one exists — **what would unblock it**. ⛔ X90: an unblocker that cannot be followed is worse than none. If the remedy is in another dialect or another door, the sentence says so.
3. **Refuse by name at the token**, with line/column and a caret. Tests bind to the **guard**, never the prose.
4. **`def_hash` does not move.** `compute.fn == astHash(compute.ast)`, and `compute.ast` is the alias of the plot `scanPlot` names. New node types must not change the hash of any existing document.
5. **The scan lane stays total.** An unattended sweep must terminate: no unbounded loops, no unbounded lookback, no unbounded symbol set. Anything that cannot promise that refuses `scan:*` by name and is badged **chart-only**.
6. **Declare `yields`, `lookback`, `sentence`, `cadence` for every new entry.** A missing `cadence` makes a live sweep dishonest.
7. **Every rail must DISTINGUISH.** A fixture where nothing passes satisfies a broken filter (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). Assert both directions, and carry a non-vacuity floor.
8. **Mutation-check every rail**, and verify the mutant is PRESENT in the file before running the suite. Two controls went vacuous on 2026-08-27 because an anchor missed.
9. **Commit with a pathspec** — `git commit -F - -- <paths>` — the git index is shared with other worktrees. Never `git add -A`, never `--amend`.
10. **Measure, never re-type.** No hand-typed count beside the list it describes (this repo's most repeated defect: the writer-index `FOUR`, the COT "4 routes", `three files ahead`).

---

## The map — what is left, and what each wave is worth

Measured 2026-08-27, every number pinned in a test.

| criterion | today | after this plan | owned by |
|---|---|---|---|
| A2 Pine curated (21) | **12/21** | 17/21 | W3b + W2b + W7 + W8 |
| A3 Pine community (30) | **10/30** | ~26/30 (≥80%) | W3b + W2b + W6 + W7 |
| A4 thinkScript (24) | **8/24 — AT CEILING** | **8/24** ⛔ | *nobody — see below* |
| A5 TC2000 (71) | **63/71** | 65/71 (ceiling) | W2a follow-up |
| A7 `tf()` / `sym()` | **0 built** | built | **W2b** |
| A9 sharing | **0** | built | **W5b** |
| A10 drawings (6 kinds) | **0/6** | 6/6 | **W6** |
| A11 programs (3) | **0/3** | 3/3 | **W7** |
| A12 strategies (2) | engine built, xlat **0/2** | 2/2 | **W8** |

### ⛔ A4 is not ours to close, and the plan says so rather than carrying a task for it

The 24-script thinkScript corpus partitions **total and disjoint: 8 translate + 9 refuse by design + 4 blocked on vendor documentation + 3 ruled**. The 4 are blocked because thinkorswim publishes no formula or no defaults for `RSI`, `BollingerBands`, `TTM_Squeeze`, `MovAvgExponential` — measured against the Studies-Library pages, which carry `Parameter | Description` and **no Default-value column at all**. `ATR` is the control: it *is* mapped, because its description publishes its defaults in one sentence.

**No engineering closes those 4.** The only paths are (a) thinkorswim publishes more, or (b) the owner rules that we ship a *stated* approximation. (b) contradicts Global Constraint 2 and is therefore an **owner decision, not a task**. It is listed in §Owner Decisions below and nowhere else.

### Dependency order — why W2b is first

`W2b` is the only remaining item that appears as a blocker on three other rows (A2, A3, A7) and gates two whole waves (`W3b`, `W4c`). Everything else is parallel:

```
W2b ──┬──> W3b (Pine push)     ──┐
      └──> W4c (MTF scans)      │
W5b ─────────────────────────────┼──> A9
W6  ─────────────────────────────┼──> A10, and half of A3
W7  ─────────────────────────────┴──> A11, and the last of A2
                                  └──> W8 (strategies) ──> A12
```

`W5b`, `W6`, `W7` are disjoint from `W2b` in file ownership (§6) and may run concurrently. `W8` depends on `W5a` (shipped) and `W3` (shipped).

---

## Wave 2b — `tf()` and `sym()` nodes

**Why first:** unblocks A7 outright, and is the named blocker on 4 Pine curated scripts and 4+ community scripts.

**Files:**
- Modify: `app/src/components/chart/engine/ast/parse.js` (`NODE_TYPES`, line 148)
- Modify: `app/src/components/chart/engine/ast/closedTable.json` (new `benchmarks` section; `tableVersion` provenance)
- Modify: `app/src/components/chart/engine/ast/interpret.js`
- Modify: `api/services/ast_interpret.py` (`NODE_TYPES`, line 110)
- Modify: `api/services/user_definitions.py` (`_CANONICAL_KEYS` — the four-shape check becomes six)
- Modify: `api/services/scan_definition.py` (`assert_scannable` — the symbol gate)
- Modify: `api/services/screener/scan_evaluator.py` (`cadence_ceiling`, HTF bar loading)
- Test: `app/src/components/chart/engine/ast/tfSym.test.js` (new)
- Test: `tests/test_ast_tf_sym.py` (new)
- Test: `tests/test_ast_conformance.py` (extend the parity corpus)

**Interfaces:**
- Consumes: `api/services/screener/candles.py::_timeframe_candle(bars, "weekly"|"monthly")` — the existing, owned D→W/M resampler. **Do not write a second one.**
- Produces: two canonical node shapes, frozen here because every later wave hashes them —
  - `{"type": "tf", "value": "<W|M|D|60|30|15|5>", "args": [<one child>]}`
  - `{"type": "sym", "name": "<TICKER>", "args": [<one child>]}`
  - Both mirror `offset`'s shape rule: the **parameter is a field on the node, not a child expression**, so a timeframe or a symbol can never be computed at runtime and `max_lookback` stays a tree sum.

### Task 1: Declare the two node types in both lanes, and refuse them everywhere else first

- [ ] **Step 1: Write the failing test** — `app/src/components/chart/engine/ast/tfSym.test.js`

```js
import { describe, it, expect } from 'vitest'
import { NODE_TYPES } from './parse.js'

describe('tf/sym node types', () => {
  it('⛔ the roster is SEVEN and the two new shapes are declared', () => {
    // Derived, not re-typed: the manifest and both lanes read this array.
    expect([...NODE_TYPES].sort())
      .toEqual(['call', 'num', 'offset', 'op', 'series', 'sym', 'tf'])
  })
})
```

- [ ] **Step 2: Run it, confirm it fails** — `cd app && npx vitest run src/components/chart/engine/ast/tfSym.test.js`. Expected: `['call','num','offset','op','series']` ≠ expected.

- [ ] **Step 3: Add both to `parse.js:148` and `ast_interpret.py:110`**, in the same commit. Nothing evaluates them yet.

- [ ] **Step 4: Add the canonical key sets** to `api/services/user_definitions.py::_CANONICAL_KEYS` — `tf` carries exactly `[args, type, value]`, `sym` exactly `[args, name, type]`. ⛔ `assert_canonical`'s error sentence enumerates `NODE_TYPES`; it must not be re-typed (Global Constraint 10).

- [ ] **Step 5: Prove the refusal comes FIRST.** Both interpreters must refuse an unimplemented `tf`/`sym` node **by name** rather than crash. Add to `tests/test_ast_tf_sym.py`:

```python
def test_an_unimplemented_tf_node_REFUSES_BY_NAME_and_does_not_crash():
    tree = {"type": "tf", "value": "W", "args": [{"type": "series", "name": "close"}]}
    with pytest.raises(ast_interpret.TableRefusal) as exc:
        ast_interpret.interpret(tree, _bars())
    assert "tf" in str(exc.value)
```

- [ ] **Step 6: Commit** — `git commit -F - -- app/src/components/chart/engine/ast/parse.js api/services/ast_interpret.py api/services/user_definitions.py app/src/components/chart/engine/ast/tfSym.test.js tests/test_ast_tf_sym.py`

### Task 2: `tf(expr, '<TF>')` — evaluation on the last CLOSED higher-timeframe bar

**The semantics, frozen:** each base bar reads the **last closed** HTF bar (TradingView `lookahead=off` + `[1]`). That is what makes the node `non-repainting`. A separate `tf_live` reading the forming HTF bar is **out of scope for this task** and is declared `preview-repaints` when it lands.

- [ ] **Step 1: Write the failing parity test** — `tests/test_ast_tf_sym.py`

```python
def test_tf_reads_the_LAST_CLOSED_higher_timeframe_bar_never_the_forming_one():
    """⛔ THE WHOLE REPAINT STORY. If a daily bar could see its own week's
    forming close, every backtest that used `tf` would be reading the future."""
    bars = _daily_bars_spanning_three_weeks()
    tree = {"type": "tf", "value": "W",
            "args": [{"type": "series", "name": "close"}]}
    col = ast_interpret.interpret(tree, bars)
    # A Monday bar sees LAST week's close, not this week's.
    assert col[_index_of(bars, MONDAY_WEEK3)] == _close_of_week(bars, 2)
    # …and the control: it is NOT simply the daily close.
    assert col[_index_of(bars, MONDAY_WEEK3)] != bars[_index_of(bars, MONDAY_WEEK3)]["c"]
```

- [ ] **Step 2: Run it, confirm it fails** — `python -m pytest tests/test_ast_tf_sym.py -q`

- [ ] **Step 3: Implement in `ast_interpret.py`** by resampling through `candles._timeframe_candle` and forward-filling the last closed HTF value onto each base bar. ⛔ Import the resampler; do not reimplement it (a second authority over one value).

- [ ] **Step 4: Mirror in `interpret.js`** with the same accumulation order. ⚠️ Plain loops, not array methods that change summation order — the 1e-9 guarantee depends on it (`ast_interpret`'s own docstring).

- [ ] **Step 5: Declare the lookback.** Base-bar lookback = `expr` lookback × the TF ratio, declared in `max_lookback` so `assert_scannable`'s resolve pass can bound it.

- [ ] **Step 6: Refuse a TF lower than the base TF, by name**, with the sentence naming both timeframes.

- [ ] **Step 7: Add to the conformance corpus** (`tests/test_ast_conformance.py`) so the two lanes are held equal at 1e-9 on `tf` trees.

- [ ] **Step 8: Run both suites and commit.**

### Task 3: The scan lane's `tf` gate — `D | W | M` only

- [ ] **Step 1: Write the failing test** — an intraday `tf` in a scan refuses `scan:timeframe` by name and says the coverage reason.
- [ ] **Step 2: Confirm it fails.**
- [ ] **Step 3: Gate in `scan_definition.py::assert_scannable`**, adding `timeframe` to `GATES` (the set is closed on purpose — a caller branches on it).
- [ ] **Step 4: Update `cadence_ceiling`** so a `tf('W')` tree is honest about how often re-running it can say something new.
- [ ] **Step 5: Rail both directions** — `W` accepted, `5` refused, with a non-vacuity floor.
- [ ] **Step 6: Commit.**

### Task 4: `sym('<TICKER>', expr)` and the `benchmarks` manifest section

- [ ] **Step 1: Write the failing test** — `sym('SPY', close)` on the chart lane returns SPY's aligned column; a missing session is `NaN` (→ `not_computable`), never a carried-forward value.
- [ ] **Step 2: Confirm it fails.**
- [ ] **Step 3: Add the `benchmarks` section** to `closedTable.json` — SPY, QQQ, IWM, DIA + the 11 sector SPDRs. ⛔ The table currently has **no** `benchmarks` key (verified 2026-08-27); this creates it, with a provenance line.
- [ ] **Step 4: Implement chart-lane `sym`** via `bars_fetch` (any symbol) and **scan-lane `sym`** restricted to `benchmarks`, memoised per `(sym, subtree)` and loaded once per sweep.
- [ ] **Step 5: Refuse a non-benchmark symbol in a scan** as `scan:symbol`, naming the declared benchmark list as the unblocker. ⛔ X90's rule: the remedy must be followable.
- [ ] **Step 6: Session alignment rail** — a symbol halted for a session yields `NaN` on that bar in BOTH lanes, and the receipt counts it `not_computable`, not `dropped`.
- [ ] **Step 7: Commit.**

### Task 5: Wire `tf`/`sym` into the Pine translator's `request.security`

- [ ] **Step 1:** `request.security(syminfo.tickerid, tf, expr)` → `tf` node; `request.security('SPY', …)` → `sym` node.
- [ ] **Step 2:** Re-measure the curated corpus. **Do not hand-edit the snapshot** — run it, read the number, and record it in the ledger.
- [ ] **Step 3:** Update `pine.corpus.test.js`'s pinned `saveable` count to the measured value, with the measurement in the commit message.
- [ ] **Step 4: Commit.**

**Acceptance for W2b:** A7 built and railed in both lanes; `pine.corpus.test.js` `saveable` moves off 12 by the measured amount; `thinkscript.corpus.test.js` re-measured (the spec predicts +4 from the aggregation bucket — *verify, do not assume*).

---

## Wave 5b — sharing and version history (parallel, self-contained)

**Files:** `api/services/user_definitions.py`, `api/routers/user_definitions.py`, new `app/src/components/chart/builder/SharePanel.jsx`, `app/src/hooks/useUserDefinitions.js`, `tests/test_definition_sharing.py`

- [ ] **Task 1:** `POST /api/user-definitions/{id}/share` mints a token. ⛔ Nothing is public by default — mirror `saved_screens.update`'s rule that a token exists only when the owner asks.
- [ ] **Task 2:** The recipient installs a **copy** carrying `origin_def_hash`, `author_id`, `origin_version`. The forward record travels because it is keyed by hash.
- [ ] **Task 3:** Export/import the canonical document, **byte-identical round trip** — the rail is a hash comparison, not a field-by-field diff.
- [ ] **Task 4:** ⛔ **A9's amendment (X81):** a recipient holding a byte-identical, origin-hash-verified copy can still compute differently if the manifest moved. The copy records `tableVersion`, and a mismatch **refuses by name** rather than drawing. This is the acceptance criterion, not a nicety.
- [ ] **Task 5:** Version-history UI over the store's existing `history`.

---

## Wave 6 — drawings (parallel)

**Files:** `app/src/components/chart/engine/binder.js`, `defSchema.js` (`draws[]`), `pine.js`, new `app/src/components/chart/engine/drawings/*`

- [ ] **Task 1:** A new manifest **section** for outputs that DRAW — this is the part that does not exist today. `yields` is not enough; a drawing declares what it renders.
- [ ] **Task 2:** Series-styled: `plotshape`, `plotchar`, `bgcolor`, `fill(a,b)`, `hline`, `label` — rendered by the binder with LWC markers, price lines and fills.
- [ ] **Task 3:** Objects: `line`, `box` from a bounded emitter, capped at 500 each (TradingView's own caps), **JS only**, badged `chart-only`.
- [ ] **Task 4:** ⛔ A scan on an object-drawing definition **refuses by name** — the scan lane stays total.
- [ ] **Task 5:** Pixel-parity harness, one case per output kind (A10 is a *value* check, not an identity join).

---

## Wave 7 — programs (parallel)

**Files:** new `app/src/components/chart/engine/program/*`, `defSchema.js` kind, `pine.js`

- [ ] **Task 1:** `kind: 'program'` — arrays (`new/push/get/set/size/sum/avg/max/min`), `for` over **literal or collection** bounds, records. `while` refused by name.
- [ ] **Task 2:** A `MAX_STEPS` budget enforced alongside the existing node budget.
- [ ] **Task 3:** Repaint verdict is `repaints` **unless** proven backward-looking by the same reach analysis — and when it cannot prove it, it says so.
- [ ] **Task 4:** ⛔ The scan lane refuses `program` by name, so an unattended sweep always terminates.

---

## Wave 8 — strategies (wave 3)

**Files:** `api/services/backtest_engine.py`, new `strategy_templates.py`, new `api/routers/strategies.py`, `pine.js`, `thinkscript.js`, new `StrategyPanel.jsx`

- [ ] **Task 1:** `kind: 'strategy'` — `entry`/`exit` 0/1 trees, `stop`/`target`/`trail`, `size` per the firm's formula (**risk % = position % × stop distance %**, max 2%), fees.
- [ ] **Task 2:** Extend `backtest_engine.simulate` for stops/targets/trailing; stats from `backtest_stats`.
- [ ] **Task 3:** Translate Pine `strategy.entry/exit/close` and ToS `AddOrder`.
- [ ] **Task 4:** Equity curve + trade list + the horizon study beside it, and the E-6 forward record extended to strategies.

---

## Owner decisions this plan does NOT make

1. **thinkScript's 4 doc-blocked scripts.** Ship a stated approximation for `RSI`/`BollingerBands`/`TTM_Squeeze`/`MovAvgExponential`, or leave them refused? Leaving them refused caps A4 at 8/24 permanently. Approximating contradicts Global Constraint 2.
2. **A5's target exceeds its ceiling.** 66/71 was set above the measured ceiling of 65. Re-target to 65, or fund the two extra vocabulary entries.
3. **Universe-wide intraday scanning** stays gated on the measured prewarm-ring number, never assumed (spec §5.5).

---

## Self-review

- **Spec coverage:** §5.2 (`tf`/`sym`, benchmarks) → W2b. §5.6 → W6. §5.7 → W7. §5.8 → W8. §5.9 sharing → W5b. §5.9 evidence → shipped (W5a). A4/A5 ceilings → Owner Decisions, deliberately not tasks.
- **Placeholders:** none. W3b and W4c carry no task list **on purpose** — their content is literally "whatever W2b unlocked", and W2b Task 5 Step 2 says to *measure* it rather than predict it. Writing their tasks now would be inventing numbers.
- **Type consistency:** the two node shapes are frozen in W2b's Interfaces block and referenced by W6/W7/W8 unchanged.
