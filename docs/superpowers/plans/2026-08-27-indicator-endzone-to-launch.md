# Indicator End-Zone → Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the custom-indicator platform from its measured state (54/100 against TradingView / thinkorswim / TC2000 / DeepVue / LuxAlgo) to feature-ready for launch — every remaining segment closed, or refused for a stated reason nobody has to re-discover.

**Architecture:** Seven segments, each independently shippable. The engine already holds a closed grammar (8 node types, 62 functions, 111 scalars) verified across two lanes at 1e-9, a scan sweep, and sharing. What remains is three new definition KINDS (`strategy`, `program`, and drawing outputs), one new accumulator, the measured tail of import blockers, discovery on top of sharing, and the launch surface around all of it.

**Tech Stack:** Python 3.12 / FastAPI / SQLite (append-only stores) · React + Vite · Lightweight Charts v5 · the closed manifest `closedTable.json` as the single grammar authority.

**Spec:** `docs/superpowers/specs/2026-08-27-indicator-endzone-wave2.md` (waves 2b/5b/6/7/8) plus the measured scorecard this plan argues from — every "today" number below was run against the code at `92623df71`, not read off a document.

---

## Global Constraints

Copied verbatim from the invariants this codebase already enforces. Every task's requirements implicitly include this section.

1. **Two lanes, one answer.** Any change to evaluation lands in BOTH `api/services/ast_interpret.py` and `app/src/components/chart/engine/ast/interpret.js`, and `python tools/ast_conformance.py --check` must stay green at 1e-9. Adding a corpus case requires `--record --force`, which refuses if the lanes disagree.
2. **A node type costs eleven layers.** Both interpreters, both linters, `ast_freshness`, `parse.js` (NODE_TYPES + CANONICAL_KEYS + guard + convert surface), `user_definitions._CANONICAL_KEYS`, `scan_definition` branch + census, `sentence.js` renderer AND `sentence.test.js`'s independent reader, `criteria.nodeTypes.test.js` exemption, the conformance instrument, corpus cases, and every count/prose floor. There is no partial landing.
3. **Refuse by name, at the door the member typed at, with what would unblock it.** A silent mistranslation is worse than a refusal. An unactionable refusal is never revisited.
4. **Derive, never restate.** No hand-typed count beside the list it describes. `lesson_a_second_authority_over_one_value` is this repo's most repeated defect.
5. **The scan lane stays total.** Any kind the sweep cannot terminate on refuses by name at `assert_scannable` — `program` and `strategy` both do.
6. **Repaint verdicts are DERIVED from the reach walk**, never asserted by the thing being judged.
7. **Append-only stores.** `test_the_MODULE_ISSUES_NO_UPDATE_STATEMENT` is module-wide by AST; a state change is a new row.
8. **Nothing is public by default.** Reachability requires a row an owner caused.
9. **Sizing is the firm's one formula:** `Account Risk % = Position Size % × Stop Distance %`, hard cap 2%. Never invent another.
10. **No emoji as UI iconography** — `UIcon` only.
11. **Every measurement is re-run after the change.** A blocker table built by grepping for a feature counts scripts that CONTAIN it, not scripts BLOCKED BY it — measured wrong five times in this wave.

---

## The measured starting point

Run at `92623df71`. Re-run before starting; do not trust these numbers if the head has moved.

| Surface | Today |
|---|---|
| Pine curated | **12/21**, 51 usable columns |
| Pine community | **13/30** |
| thinkScript | **8/24** (at its documented ceiling) |
| TC2000 PCF | 48 accepted / 23 refused-by-design / 7 offset-dependent |
| Grammar | 8 node types · 62 functions · 111 scalars · 15 operators · 13 clock · 15 benchmarks |
| Shipped indicators | 17 |
| Screener | 179 filters over 200 columns |
| Two-lane conformance | 113 asts × 579 bars |
| Gates | frontend 789 files / 11,804 · backend AST+scan 1,169 |

**The 43 remaining refusals, by cause** — this is the work-list, and it is read off refusing lines, not grepped:

| Cause | Count | Segment that closes it |
|---|---|---|
| function not in table | 10 | D (`cum`), E (the rest), — (5 are vendor-blocked) |
| mutable state (`var`, ToS state) | 5 | D |
| cross-symbol / timeframe shapes | 5 | — mostly correct refusals |
| no plottable output | 3 | B |
| ~~displaced plot~~ | ~~4~~ → **0** | ✅ **SOLVED 27 Aug** — see the amendment in Segment E |
| arrays / `fold` | 2 | C |
| strategy declarations | 2 | A |
| module `import`, named-arg, statement, undefined | 4 | E |
| thinkScript time/symbol/aggregation/account | 6 | E |

---

## File structure

**Segment A — strategies**
- Create `api/services/strategy_signals.py` — definition trees → the signal list `backtest_engine.simulate` already consumes.
- Create `api/routers/strategies.py` — run a strategy, return equity curve + trades + stats.
- Create `app/src/components/chart/builder/StrategyPanel.jsx` + `.module.css`.
- Modify `api/services/backtest_engine.py` — stops, targets, trailing.
- Modify `app/src/components/chart/engine/defSchema.js` — the `strategy` kind.
- Modify `app/src/components/chart/engine/ast/pine.js` — `strategy.entry/exit/close`.
- Modify `app/src/components/chart/engine/ast/thinkscript.js` — `AddOrder`.

**Segment B — drawing objects**
- Create `app/src/components/chart/engine/drawings/emitter.js` — bounded object emission.
- Create `app/src/components/chart/engine/drawings/render.js` — LWC primitives.
- Modify `defSchema.js` — `draws[]`; `binder.js` — the render pass; `pine.js` — `line.new`/`label.new`/`box.new`.

**Segment C — programs**
- Create `app/src/components/chart/engine/program/interpret.js` + `api/services/program_interpret.py` — the bounded loop lane, both sides.
- Modify `defSchema.js` (`program` kind), `ast_budget` (MAX_STEPS), `scan_definition` (refuse by name).

**Segment D — unbounded accumulator**
- Modify `closedTable.json` (`cumsum` entry), both interpreters, both linters, corpus.

**Segment E — the import tail**
- Modify `pine.js`, `thinkscript.js` only. No grammar change.

**Segment F — public library**
- Create `api/services/definition_library.py`, `api/routers/library.py`, `app/src/pages/formulas/Library.jsx`.

**Segment G — launch readiness**
- Modify mobile CSS, `entitlements.py`, add `docs/formulas/`, admin observability.

---

## Dependency order

```
A (strategies) ─────────┐
B (drawings)   ─────────┤
C (programs)   ──> D?   ├──> G (launch readiness)
D (accumulator)─────────┤
E (import tail)─────────┤
F (library, needs W5b sharing — SHIPPED) ─┘
```

A, B, C, D, E, F are **disjoint in file ownership** and may run concurrently. G is last because it hardens what the others land. C's `for` loop benefits from D's accumulator but does not require it.

---

# SEGMENT A — Strategies

Today: score 20. A backtest engine exists and runs; there is no `strategy` definition kind and no translation of `strategy.entry` or `AddOrder`. Two corpus scripts blocked (`19-strategy-supertrend-atr.pine`, `21-strategy-ma-crossover-addorder.ts`).

### Task A1: the `strategy` compute kind

**Files:**
- Modify: `app/src/components/chart/engine/defSchema.js` (`COMPUTE_KINDS`, `validateDefinition`)
- Modify: `api/services/user_definitions.py` (`validate_v2`)
- Test: `app/src/components/chart/engine/defSchema.test.js`, `tests/test_user_definitions.py`

**Interfaces:**
- Produces: a definition document shaped
  `{kind: 'strategy', entry: <tree>, exit: <tree>|null, stop: {kind:'pct'|'atr', value:number}|null, target: {...}|null, trail: {...}|null, sizing: {positionPct:number}, fees: {bps:number}}`.
  Later tasks consume `definition.compute.entry` / `.exit` / `.stop` / `.target` / `.trail` / `.sizing` / `.fees`.

- [ ] **Step 1: Write the failing test**

```javascript
it('⛔ a strategy declares entry and exit trees, and both are canonical', () => {
  const close = { type: 'series', name: 'close' }
  const cross = { type: 'call', name: 'crossOver', args: [close, { type: 'num', value: 50 }] }
  const doc = {
    schemaVersion: 1, id: 'u_1', version: 1,
    meta: { name: 'X', shortName: 'X', repaint: 'non-repainting' },
    compute: { kind: 'strategy', entry: cross, exit: null,
               stop: { kind: 'pct', value: 6 }, target: null, trail: null,
               sizing: { positionPct: 20 }, fees: { bps: 10 } },
    placement: { target: 'price' }, plots: [], inputs: [],
  }
  expect(validateDefinition(doc).ok).toBe(true)
})

it('⛔⛔ a strategy with NO entry is refused — an exit alone is not a strategy', () => {
  // A definition that can leave a position it can never take is not a
  // half-built strategy, it is a document that cannot mean anything.
  const doc = { /* …as above, but compute.entry = null… */ }
  expect(validateDefinition(doc).ok).toBe(false)
  expect(validateDefinition(doc).error).toMatch(/entry/i)
})
```

- [ ] **Step 2: Run it, confirm it fails** — `cd app && npx vitest run src/components/chart/engine/defSchema.test.js`
- [ ] **Step 3: Add `'strategy'` to `COMPUTE_KINDS` and a `validateStrategy(compute)` arm**, refusing a missing entry by name. ⛔ Do NOT add it to `SUPPORTED_KINDS` yet — a strategy is not a chart column, and the two lists say different things (see that file's own comment).
- [ ] **Step 4: Run both suites** — vitest + `pytest tests/test_user_definitions.py`
- [ ] **Step 5: Commit** — `feat(strategy): the strategy compute kind, entry required`

### Task A2: trees → signals

**Files:**
- Create: `api/services/strategy_signals.py`
- Test: `tests/test_strategy_signals.py`

**Interfaces:**
- Consumes: `ast_interpret.interpret(tree, bars, opts=…)` → column of `float|None`.
- Produces: `signals_for(definition, bars, opts=None) -> list[dict]`, each `{'t': int, 'side': 'long', 'kind': 'entry'|'exit', 'price': float, 'reason': str}` — **exactly the shape `backtest_engine.simulate` already documents**, so no change is needed on its input side.

- [ ] **Step 1: Write the failing test**

```python
def test_an_entry_fires_on_the_bar_its_condition_becomes_true():
    bars = _bars([10, 11, 12, 13])          # close rises
    tree = {"type": "op", "name": ">", "args": [CLOSE, {"type": "num", "value": 11.5}]}
    sigs = strategy_signals.signals_for(_strategy(entry=tree), bars)
    assert [s["t"] for s in sigs] == [bars[2]["t"]]
    assert sigs[0]["kind"] == "entry"


def test_an_entry_does_NOT_re_fire_while_the_condition_stays_true():
    """⛔ A CONDITION IS A STATE, AN ENTRY IS AN EVENT. `close > 11.5` is true on
    three consecutive bars; a strategy that entered on each would report three
    positions where a trader took one, and every statistic downstream would be
    wrong by that factor."""
    bars = _bars([10, 12, 13, 14])
    tree = {"type": "op", "name": ">", "args": [CLOSE, {"type": "num", "value": 11.5}]}
    sigs = strategy_signals.signals_for(_strategy(entry=tree), bars)
    assert len(sigs) == 1


def test_a_NaN_bar_is_not_an_exit():
    """⛔ NOT-COMPUTABLE IS NOT FALSE. A warmup bar where the tree cannot answer
    must leave the position alone; reading NaN as "condition false" would close
    every position during warmup on a strategy that never said so."""
    bars = _bars([10, 11, 12, 13, 14])
    entry = {"type": "op", "name": ">", "args": [CLOSE, {"type": "num", "value": 10.5}]}
    exit_ = {"type": "op", "name": ">",
             "args": [{"type": "call", "name": "sma", "args": [CLOSE, {"type": "num", "value": 99}]},
                      {"type": "num", "value": 0}]}          # all-NaN: 99-bar sma on 5 bars
    sigs = strategy_signals.signals_for(_strategy(entry=entry, exit=exit_), bars)
    assert [s["kind"] for s in sigs] == ["entry"]
```

- [ ] **Step 2: Run it, confirm it fails** — `PYTHONPATH=. python -m pytest tests/test_strategy_signals.py -q`
- [ ] **Step 3: Implement**

```python
def signals_for(definition, bars, opts=None):
    """Definition trees -> the signal list `backtest_engine.simulate` consumes.

    ⛔ AN EVENT, NOT A STATE. A signal fires on the bar a condition BECOMES true
    and not on the bars it stays true — otherwise one trade is reported as many.
    ⛔ AND `None` IS NOT `False`. A bar the tree cannot answer leaves the position
    exactly as it was.
    """
    compute = (definition or {}).get("compute") or {}
    entry_col = ast_interpret.interpret(compute["entry"], bars, opts=opts)
    exit_col = (ast_interpret.interpret(compute["exit"], bars, opts=opts)
                if compute.get("exit") else [None] * len(bars))
    out, holding, prev_entry, prev_exit = [], False, None, None
    for i, bar in enumerate(bars):
        e, x = entry_col[i], exit_col[i]
        fired_entry = _rose(prev_entry, e)
        fired_exit = _rose(prev_exit, x)
        if e is not None:
            prev_entry = e
        if x is not None:
            prev_exit = x
        price = _number(bar.get("c"))
        if price is None:
            continue
        if holding and fired_exit:
            out.append(_signal(bar["t"], "exit", price, "exit condition"))
            holding = False
        elif not holding and fired_entry:
            out.append(_signal(bar["t"], "entry", price, "entry condition"))
            holding = True
    return out


def _rose(prev, curr):
    """Did this condition BECOME true on this bar? `None` never fires."""
    if curr is None or curr == 0:
        return False
    return prev is None or prev == 0
```

- [ ] **Step 4: Run the tests** — expect PASS
- [ ] **Step 5: Commit** — `feat(strategy): trees to signals, an event not a state`

### Task A3: stops, targets and trailing in the simulator

**Files:**
- Modify: `api/services/backtest_engine.py` (`simulate`)
- Test: `tests/test_backtest_engine.py`

**Interfaces:**
- Produces: `simulate(bars, signals, capital, position_pct, fees_bps, stop=None, target=None, trail=None)`. `stop`/`target`/`trail` are `{'kind': 'pct'|'atr', 'value': float}` or `None`. Backwards compatible: omitting them behaves exactly as today.

- [ ] **Step 1: Write the failing test**

```python
def test_a_stop_exits_INSIDE_the_bar_at_the_stop_price_not_at_the_close():
    """⛔⛔ THE MOST EXPENSIVE ROUNDING IN A BACKTEST. A position stopped out
    mid-bar exits at the STOP, not at the bar's close — booking the close flatters
    every losing trade by the distance between them, on every trade, forever."""
    bars = [_bar(1, o=100, h=101, l=100, c=100), _bar(2, o=100, h=100, l=90, c=95)]
    sigs = [{"t": 1, "side": "long", "kind": "entry", "price": 100.0, "reason": "e"}]
    out = simulate(bars, sigs, capital=10000, position_pct=100, fees_bps=0,
                   stop={"kind": "pct", "value": 6})
    trade = out["trades"][0]
    assert trade["exit_price"] == pytest.approx(94.0)      # 100 * (1 - 0.06)
    assert trade["exit_reason"] == "stop"


def test_when_a_bar_hits_BOTH_stop_and_target_the_STOP_wins():
    """⛔ THE PESSIMISTIC RULE, STATED. Intrabar order is unknowable from OHLC, so
    a bar spanning both is scored as the loss. The opposite convention turns an
    ambiguous bar into a win and inflates every wide-range strategy."""
    bars = [_bar(1, o=100, h=101, l=100, c=100), _bar(2, o=100, h=120, l=90, c=110)]
    sigs = [{"t": 1, "side": "long", "kind": "entry", "price": 100.0, "reason": "e"}]
    out = simulate(bars, sigs, capital=10000, position_pct=100, fees_bps=0,
                   stop={"kind": "pct", "value": 6}, target={"kind": "pct", "value": 10})
    assert out["trades"][0]["exit_reason"] == "stop"


def test_a_trailing_stop_RATCHETS_and_never_loosens():
    bars = [_bar(1, o=100, h=100, l=100, c=100), _bar(2, o=100, h=120, l=100, c=120),
            _bar(3, o=120, h=120, l=100, c=105)]
    sigs = [{"t": 1, "side": "long", "kind": "entry", "price": 100.0, "reason": "e"}]
    out = simulate(bars, sigs, capital=10000, position_pct=100, fees_bps=0,
                   trail={"kind": "pct", "value": 10})
    # the high of 120 lifts the trail to 108; bar 3's low of 100 takes it out there
    assert out["trades"][0]["exit_price"] == pytest.approx(108.0)
```

- [ ] **Step 2: Run it, confirm it fails**
- [ ] **Step 3: Implement** the three exit checks inside the per-bar walk, in the order `stop → target → trail → exit signal`, each recording `exit_reason`. Keep `simulate` pure — no logging, no imports (its docstring says so).
- [ ] **Step 4: Run the tests, plus the existing backtest suite unchanged**
- [ ] **Step 5: Commit** — `feat(backtest): stops, targets and trailing, pessimistic on an ambiguous bar`

### Task A4: sizing, by the firm's one formula

**Files:**
- Modify: `api/services/strategy_signals.py`
- Test: `tests/test_strategy_signals.py`

- [ ] **Step 1: Write the failing test**

```python
def test_position_size_comes_from_the_FIRMS_formula_and_is_capped_at_two_percent():
    """⭐ `Account Risk % = Position Size % × Stop Distance %`, hard cap 2%.
    ⛔ NEVER INVENT ANOTHER — this is the sizing rule the whole product uses, and a
    second one here would be a strategy backtested on maths the desk does not run."""
    # a 6% stop at 20% position = 1.2% account risk — allowed
    assert strategy_signals.account_risk_pct(position_pct=20, stop_pct=6) == pytest.approx(1.2)
    # a 10% stop at 25% position = 2.5% — over the cap, so the POSITION is cut
    assert strategy_signals.size_for(stop_pct=10, wanted_pct=25) == pytest.approx(20.0)
    assert strategy_signals.account_risk_pct(position_pct=20, stop_pct=10) == pytest.approx(2.0)


def test_a_strategy_with_NO_stop_cannot_be_sized_and_says_so():
    """⛔ RISK IS UNDEFINED WITHOUT A STOP. Sizing it anyway would report an
    account-risk number that is not a number."""
    with pytest.raises(ValueError, match="stop"):
        strategy_signals.size_for(stop_pct=None, wanted_pct=25)
```

- [ ] **Step 2: Run it, confirm it fails**
- [ ] **Step 3: Implement** `account_risk_pct` and `size_for` with the 2% cap.
- [ ] **Step 4: Run the tests**
- [ ] **Step 5: Commit** — `feat(strategy): sizing by the firm's formula, 2% capped`

### Task A5: the run route

**Files:**
- Create: `api/routers/strategies.py`; modify `api/main.py` (include_router)
- Test: `tests/test_strategies_router.py`

**Interfaces:**
- Produces: `POST /api/strategies/{def_id}/run` body `{symbol, tf, bars?}` → `{equity_curve, trades, stats, signals}`. `require_paid`, scoped to `user["id"]`.

- [ ] **Step 1: Write the failing test** — a paid user runs a stored strategy and gets a curve; a free user gets 402; another member's `def_id` gets 404.
- [ ] **Step 2: Run it, confirm it fails**
- [ ] **Step 3: Implement**, reading bars through `bars_sqlite.get_bars` (local, no network — the sweep's rule) and composing `strategy_signals.signals_for` → `simulate` → `backtest_stats.compute_stats`.
- [ ] **Step 4: Run the tests, AND update `EXPECTED_ROUTE_COUNT` in both files that assert it** (`tests/test_user_definitions.py`, `tests/test_definition_concierge.py` — they duplicate the count deliberately).
- [ ] **Step 5: Commit** — `feat(strategy): the run route`

### Task A6: the scan lane refuses a strategy by name

**Files:**
- Modify: `api/services/scan_definition.py` (`assert_scannable`)
- Test: `tests/test_scan_definition.py`

- [ ] **Step 1: Write the failing test**

```python
def test_a_STRATEGY_is_refused_by_the_scan_gate_naming_what_it_is():
    """⛔ THE SCAN LANE STAYS TOTAL. A strategy is a position lifecycle, not a
    per-bar column — `<tree> != 0` on the last bar has no meaning for one. It
    refuses at `gate:kind` naming the lane, so a member is told what a strategy IS
    rather than that their formula is malformed."""
    with pytest.raises(scan_definition.ScanRefused) as exc:
        scan_definition.assert_scannable({"compute": {"kind": "strategy", "entry": TREE}})
    assert exc.value.gate == "kind"
    assert "strategy" in str(exc.value)
```

- [ ] **Step 2–4:** implement, run.
- [ ] **Step 5: Commit** — `feat(scan): a strategy refuses by name, the sweep stays total`

### Task A7: Pine `strategy.entry` / `strategy.close` / `strategy.exit`

**Files:**
- Modify: `app/src/components/chart/engine/ast/pine.js`
- Test: `app/src/components/chart/engine/ast/pine.strategy.test.js` (create)

- [ ] **Step 1: Write the failing test** — `strategy("x")` declaration plus `strategy.entry("L", strategy.long, when = cond)` produces `compute.kind === 'strategy'` with `entry` the `cond` tree; `strategy.close("L", when = other)` becomes `exit`. A `strategy.entry` with `strategy.short` refuses by name (this engine's simulator is long-only — say so rather than silently trading the other way).
- [ ] **Step 2: Run it, confirm it fails**
- [ ] **Step 3: Implement.** ⛔ The `pine:declaration-strategy` refusal is REPLACED, not bypassed: the guard exists because a strategy was not representable, and now it is.
- [ ] **Step 4: Re-measure the owner corpus** — `19-strategy-supertrend-atr.pine` should move. Update `pineCorpus.json` and the count assertions with a ⚰️ note.
- [ ] **Step 5: Commit** — `feat(pine): strategy.entry/close translate to the strategy kind`

### Task A8: thinkScript `AddOrder`

**Files:** `app/src/components/chart/engine/ast/thinkscript.js`; test `app/src/components/chart/engine/ast/thinkscript.strategy.test.js`

- [ ] **Step 1–5** as A7, for `AddOrder(OrderType.BUY_TO_OPEN, cond)` / `SELL_TO_CLOSE`. Re-measure the thinkScript corpus; `21-strategy-ma-crossover-addorder.ts` should move.

### Task A9: the Strategy panel

**Files:** create `app/src/components/chart/builder/StrategyPanel.jsx` + `.module.css`; mount in `BuilderSheet.jsx` behind an `editing`-gated tab and add `'strategy'` to `EDITING_ONLY_MODES`.

- [ ] **Step 1: Write the failing test** — the panel renders an equity curve, a trade list and the stat row; an empty result renders "no trades" rather than an empty chart; a transport failure says try again.
- [ ] **Step 2–4:** implement, run.
- [ ] **Step 5: Commit** — `feat(strategy): the Strategy panel, the door onto the run route`

---

# SEGMENT B — Drawing objects

Today: `plotshape`/`plotchar` land as columns (shipped). `line.new`, `label.new`, `box.new` do not exist; three community scripts blocked at `pine:no-output`.

### Task B1: the `draws[]` output shape

**Files:** modify `defSchema.js`; test `defSchema.test.js`

**Interfaces:**
- Produces: `definition.draws[]`, each `{kind: 'line'|'box'|'label', when: <tree>, at: {…}, cap: number}`. `draws` is DISJOINT from `plots` — a drawing is not a column.

- [ ] **Step 1: Write the failing test** — a definition with `draws[]` validates; a `draws` entry with no `when` tree refuses; `draws` + `compute.kind === 'ast'` is legal, `draws` on a `strategy` is refused.
- [ ] **Step 2–4:** implement, run.
- [ ] **Step 5: Commit** — `feat(draws): the drawing output shape`

### Task B2: the bounded emitter

**Files:** create `app/src/components/chart/engine/drawings/emitter.js`; test alongside.

**Interfaces:**
- Produces: `emitDrawings(draws, columns, bars, {cap = 500}) -> {objects: [...], truncated: number}`.

- [ ] **Step 1: Write the failing test**

```javascript
it('⛔⛔ emission is CAPPED, and the truncation is REPORTED not silent', () => {
  // TradingView caps at 500 per type and so do we. A silent cap draws a partial
  // picture that looks complete — the member sees a chart missing objects with
  // nothing anywhere saying so.
  const { objects, truncated } = emitDrawings(DRAWS, allBarsTrue(1200), bars)
  expect(objects.length).toBe(500)
  expect(truncated).toBe(700)
})

it('⭐ and the objects kept are the MOST RECENT, not the first found', () => {
  // A chart shows the right-hand edge. Keeping the oldest 500 would draw a
  // picture of history and nothing of now.
  const { objects } = emitDrawings(DRAWS, allBarsTrue(1200), bars)
  expect(objects[objects.length - 1].barIndex).toBe(1199)
})
```

- [ ] **Step 2–4:** implement, run.
- [ ] **Step 5: Commit** — `feat(draws): a bounded emitter that reports what it dropped`

### Task B3: rendering, and the `chart-only` badge

**Files:** create `drawings/render.js`; modify `binder.js`, `defSchema.js` (`REPAINT_MODES` unchanged; add a `surfaces` note).

- [ ] **Step 1: Write the failing test** — the binder creates exactly one primitive per emitted object and removes them all on unmount (the latch-reset rule StockChart already holds); a definition carrying `draws[]` reports `chart-only`.
- [ ] **Step 2–4:** implement, run.
- [ ] **Step 5: Commit** — `feat(draws): render objects, badged chart-only`

### Task B4: the scan lane refuses a drawing definition

**Files:** `api/services/scan_definition.py`; test as A6.

- [ ] **Step 1: Write the failing test** — a definition whose only outputs are `draws[]` refuses at `gate:yields` naming that a drawing is not a column. ⛔ A definition with BOTH a plot and draws is scannable on the PLOT — the drawings are ignored by the sweep, not a bar to it.
- [ ] **Step 2–5:** implement, run, commit.

### Task B5: Pine `line.new` / `label.new` / `box.new`

**Files:** `pine.js`; test `pine.drawings.test.js`

- [ ] **Step 1: Write the failing test** — `label.new(bar_index, high, "x")` inside an `if` becomes a `draws[]` entry whose `when` is the `if` condition. A drawing built inside a `for` loop refuses (that is Segment C's shape, and saying so names the right thing).
- [ ] **Step 2–4:** implement, run.
- [ ] **Step 5: Re-measure both corpora**, update snapshots with a ⚰️ note, commit.

### Task B6: the pixel-parity harness

**Files:** create `tools/drawing_parity.py`; test `tests/test_drawing_parity.py`

- [ ] **Step 1:** render one fixture chart per drawing kind headless, compare against a committed PNG within a stated tolerance. ⛔ A10 is a VALUE check, not an identity join — assert the object COUNT and POSITIONS, not that two renders hash alike.
- [ ] **Steps 2–5:** implement, run, commit.

---

# SEGMENT C — Programs

Today: none. Two scripts blocked (`array.get`, `fold`), and the shape roughly a third of the long tail needs.

### Task C1: the `program` kind and arrays

**Files:** create `app/src/components/chart/engine/program/interpret.js` and `api/services/program_interpret.py`; modify `defSchema.js`.

**Interfaces:**
- Produces: `runProgram(program, bars, opts) -> column`. Program ops: `new/push/get/set/size/sum/avg/max/min`.

- [ ] **Step 1: Write the failing test** — an array pushed once per bar and read back returns the pushed values; `get` out of range is NOT-COMPUTABLE, never 0.
- [ ] **Step 2–4:** implement, run — **in both lanes**, then `--record --force`.
- [ ] **Step 5: Commit** — `feat(program): arrays, both lanes`

### Task C2: bounded `for`, and the step budget

**Files:** as C1; modify `api/services/ast_budget.py`.

- [ ] **Step 1: Write the failing test**

```python
def test_a_loop_over_a_LITERAL_bound_runs_and_a_computed_one_REFUSES():
    """⛔ THE SCAN LANE STAYS TOTAL. A loop whose bound is a column cannot be
    proven to terminate before it runs, and an unattended nightly sweep is exactly
    where that must not be discovered."""

def test_the_step_budget_refuses_a_program_that_would_run_too_long():
    """⭐ MAX_STEPS IS ENFORCED ALONGSIDE the existing node budget, not instead of
    it: one bounds the TREE, the other bounds the WORK."""
```

- [ ] **Step 2–5:** implement, run, commit.

### Task C3: the repaint verdict for a program

**Files:** `ast_lint.py`, `lint.js`

- [ ] **Step 1: Write the failing test** — a program is `repaints` UNLESS the same reach walk proves it backward-looking; when it cannot prove it, the reason says so rather than defaulting silently.
- [ ] **Step 2–5:** implement, run, commit.

### Task C4: the scan lane refuses a program by name

As A6/B4. ⛔ This is the guarantee that an unattended sweep always terminates.

### Task C5: Pine `array.*` translation

Re-measure; `22-daily-weekly-monthly-highs-lows.pine` should move.

---

# SEGMENT D — The unbounded accumulator

Today: `cum` blocks two scripts and thinkScript state blocks three. The existing `accum` re-seeds a fixed number of bars back, so folding a running total into it would turn OBV into a rolling sum — the refusal says so and is right.

### Task D1: `cumsum` in the manifest

**Files:** `closedTable.json`, both interpreters, both linters, `ast_freshness`, corpus.

- [ ] **Step 1: Write the failing test**

```python
def test_cumsum_is_a_TRUE_running_total_from_the_first_bar_it_can_see():
    """⭐ AND ITS WARMUP IS DECLARED, WHICH IS WHY IT IS A NEW ENTRY RATHER THAN A
    WIDENED `accum`. A cumulative total depends on every bar before it, so its
    value depends on HOW MANY BARS THE CHART REQUESTED — the honest way to ship it
    is to say that in the manifest (`lookback: "session"`-style declaration) and let
    the freshness lane carry the caveat, not to pretend it is windowed."""
    col = ast_interpret.interpret(CUMSUM_VOLUME, bars)
    assert col[3] == pytest.approx(sum(b["v"] for b in bars[:4]))
```

- [ ] **Step 2: Run it, confirm it fails**
- [ ] **Step 3: Implement in both lanes**, add the manifest entry with its warmup declaration and its sentence.
- [ ] **Step 4: `--record --force`, confirm `0 MOVED`**, run both gates.
- [ ] **Step 5: Commit** — `feat(grammar): cumsum, with its warmup declared`

### Task D2: `cum` and ToS state translate onto it

- [ ] Re-measure; `09-on-balance-volume.pine`, `09-obv-oscillator-lazybear.pine` and the three ToS state scripts should move. Update snapshots with a ⚰️ note.

---

# SEGMENT E — The import tail

No grammar change. Translator-local only. **Re-measure after each task** — this wave's estimates were wrong five times because nobody did.

### Task E1: Pine `time(resolution)`

Blocks `25-spy-expected-move-by-vix.pine`. ⛔ Not the clock's `time` (seconds vs Pine's milliseconds — a thousand-fold error that never looks wrong); this is the session-open function.

### Task E2: `pine:named-argument` on `source`

Blocks `26-spy-to-es-qqq-to-nq.pine`. Read Pine's own parameter name for the call rather than assuming positional.

### Task E3: `pine:statement` and `pine:undefined`

`07-hull-suite.pine`, `10-ehlers-instantaneous-trend-lazybear.pine`. Read the refusing line first; each may be a one-construct gap or a genuine shape.

### Task E4: thinkScript `fold`, `getTime`, `barNumber`, `symbol`, aggregation, account

Six scripts. `fold` is Segment C's shape in another language and should reuse it. `GetQuantity`/account reads have no meaning without a broker context and should refuse by name, permanently.

### ✅ AMENDMENT, 27 Aug 2026 — two "stays refused" rulings were wrong

⛔⛔ **THIS PLAN SHIPPED WITH TWO ROADBLOCKS THAT WERE NOT ROADBLOCKS**, and both
were refusals whose own text named the unblocker.

- **`ta.highestbars` / `ta.lowestbars`.** The plan repeated "a negation is not a
  shift, and there is no node for it". `u-` is one of the fifteen operators the
  manifest declares, so `ta.highestbars(src, n)` is `-highestbars(src, n)`, exactly.
- **Displaced plots (4 scripts).** The plan said a negative offset is look-ahead
  and stays refused. That sentence is true about the DRAWING and false about the
  COLUMN: a scan reads the tree at the last confirmed bar, and where the author
  painted that number changes nothing about what it is. A POSITIVE offset turned
  out to be an exact identity (`x[N]`); a NEGATIVE one leaves the tree alone and
  records `displace`.

Measured after: community 13/30 → **16/30**, owner columns 51 → **59**, and
`pine:plot-offset` fires nowhere in either corpus.

⭐ **THE LESSON FOR THE REST OF THIS PLAN:** a refusal that names its own unblocker
is a TODO, not a wall — this codebase writes them that way on purpose. Before
accepting any "stays refused" row, re-read the refusal's own last sentence. Two of
the three in the original "what this says no to" section did not survive that
reading.

---

### Task E5: the vendor-blocked five — an OWNER DECISION, not a task

`RSI`, `BollingerBands`, `TTM_Squeeze`, `MovAvgExponential`, `SimpleMovingAvg` are blocked because thinkorswim publishes no default values (and for TTM_Squeeze, no formula at all). **No engineering closes these.** The only paths are (a) the vendor publishes more, or (b) the owner rules that we ship a *stated* approximation, which contradicts Global Constraint 3.

⛔ **Do not implement (b) without a written ruling.** A guessed default produces silently wrong trading signals under a name a member trusts.

⭐ **BUT THERE IS A THIRD PATH THE PLAN ORIGINALLY MISSED — Task E6.**

### Task E6: pending inputs — ask the one person who can see the answer

⭐⭐ **THE BLOCKER IS AN UNKNOWN DEFAULT, NOT UNKNOWN MATHS** (except `TTM_Squeeze`,
whose formula is genuinely unpublished). thinkorswim does not print `RSI`'s default
length on its Studies-Library page — but the member has thinkorswim open, and the
number is on their screen.

So the third path is neither guessing nor refusing: **translate with a DECLARED
HOLE.** A call whose defaults we cannot know produces a definition carrying a
`pendingInputs[]` entry — the parameter, the call it belongs to, and the
conventional value pre-filled but explicitly marked unverified. The member confirms
it once and the definition completes.

⛔ THIS IS NOT A STATED APPROXIMATION AND DOES NOT NEED THE E5 RULING. Nothing is
guessed and nothing computes until the member supplies the value; the engine never
asserts a number it was not given. What changes is that an unanswerable question
becomes a question for somebody who CAN answer it.

**Files:** `app/src/components/chart/engine/ast/thinkscript.js`, `defSchema.js`
(`pendingInputs[]`), and a panel in the import flow.

- [ ] **Step 1: Write the failing test**

```javascript
it('⭐⭐ a study whose DEFAULTS the vendor never published translates with a hole', () => {
  const out = translateThinkScript('plot x = RSI() > 70;')
  expect(out.refusal).toBe(null)
  expect(out.pendingInputs).toEqual([
    { call: 'RSI', param: 'length', suggested: 14, verified: false,
      why: 'thinkorswim publishes no default for this parameter' },
  ])
})

it('⛔ and it CANNOT be saved or scanned until the hole is filled', () => {
  // Well-formed and incomplete are different things. A pending input that saved
  // would be a guessed default wearing a checkbox.
  expect(canSaveFormula(translateThinkScript('plot x = RSI() > 70;'), false)).toBe(false)
})

it('⛔ TTM_Squeeze still refuses — its FORMULA is unpublished, not its defaults', () => {
  // A hole in a parameter is answerable by the member. A hole where the maths
  // should be is not, and an input box for it would imply we knew the rest.
  expect(translateThinkScript('plot x = TTM_Squeeze().Histogram;').refusal).toBeTruthy()
})
```

- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement** `pendingInputs[]` on the translation result, and the save gate that blocks on it.
- [ ] **Step 4: Re-measure the thinkScript corpus** — four of the five study-ref scripts should reach "pending" rather than "refused". ⚠️ They do NOT count as translating until filled; report both numbers.
- [ ] **Step 5: Commit** — `feat(thinkscript): pending inputs, for defaults only the member can see`

---

# SEGMENT F — The public library

Sharing shipped (W5b). What does not exist is discovery.

### Task F1: publish, with a moderation state

**Files:** create `api/services/definition_library.py`; append-only, like its neighbours.

- [ ] **Step 1: Write the failing test** — publishing requires an existing share token (you cannot list what you have not shared); a published entry starts `pending` and is invisible until `approved`; unpublishing is a new row.
- [ ] **Step 2–5:** implement, run, commit.

### Task F2: browse and rank

- [ ] Rank by installs and by the forward record already keyed on `ast_hash` — ⭐ the honest ranking signal this platform has and TradingView does not: how a formula has actually PERFORMED since it was published, not how many likes it has.

### Task F3: install from the library

Reuse `install_share` unchanged — a library entry resolves to a token.

### Task F4: the library page

`app/src/pages/formulas/Library.jsx`, routed and in `NAV`. ⛔ Free-tier visibility is an owner decision; default to paid-gated like every other definition route.

---

# SEGMENT G — Launch readiness

### Task G1: the builder on a phone

The builder sheet is desktop-shaped. Per `CLAUDE.md`: use CSS `@media` at the canonical 640/1024 breakpoints, never `useIsTouch()` for layout (it is stale at first paint), and `--tap-min: 44px` on every control. Run `python tools/mobile_audit.py --base http://localhost:8077 --auth --viewport phone --routes /charts` and **open the screenshots** — a mobile audit passes vacuously three ways.

### Task G2: performance under sweep load

- [ ] Measure the sweep with strategies and programs present. The existing budget assumed `ast` only. ⛔ The web pod is ONE uvicorn process with ONE shared threadpool; any new blocking call on the request path needs a timeout.

### Task G3: entitlements wired to plans

`limits_for` already exists and one toolkit ships (`"all"`). Decide and encode: how many definitions, how many strategies, whether the library is paid. ⛔ Read `TOOLKITS` — do not assume one toolkit means the lookup can be skipped.

### Task G4: onboarding

A first-run path from "I have a TradingView script" to a working scan: paste → preview → save → scan. The refusals already name their unblockers; onboarding is where a member meets them for the first time.

### Task G5: observability

An admin view over: definitions saved, scans run, import attempts by source and by refusal guard. ⭐ The refusal histogram is the roadmap — it is how the NEXT version of this plan gets written from measurement rather than from guessing.

### Task G6: the docs a member reads

`docs/formulas/` — the grammar, the 62 functions with their sentences (generated from the manifest, never hand-listed), what imports and what does not, and why. ⛔ Generate from `closedTable.json` so it cannot go stale.

---

## Acceptance — what "feature ready" means, as numbers

Re-run all of these before declaring the plan done. Each is a command, not a judgement.

| Criterion | Today | Target | How to check |
|---|---|---|---|
| Pine curated | 12/21 | ≥17/21 | `pine.corpus.test.js` |
| Pine community | 13/30 | ≥22/30 | `pine.community.test.js` |
| thinkScript | 8/24 | 8/24 (ceiling) or a written ruling | `dialect.test.js` + E5 |
| Two-lane conformance | 113 × 579 | green, `0 MOVED` on every record | `tools/ast_conformance.py --check` |
| Strategy corpus | 0/2 | 2/2 | A7 + A8 |
| Drawing kinds | 0/6 | 6/6 | B5 |
| Sharing | shipped | shipped + library | F |
| Frontend gate | 789 files | green | `npx vitest run` |
| Backend gate | 1,169 AST+scan | green, full suite in chunks | `pytest tests -q` |
| Mobile | unaudited | 0 horizontal overflows, 0 sub-44px targets | `tools/mobile_audit.py`, screenshots opened |

⭐⭐ **THE CEILING PARAGRAPH THAT STOOD HERE WAS MEASURING THE WRONG THING**, and it
is struck for the same reason the two rulings in Segment E were. It said the score
tops out in "roughly the low 70s" because we IMPORT four languages rather than owning
one. But that number scores us on *how completely we can absorb four foreign dialects*
— which is not what a member is buying, and not what any of the five rivals is
measured on either.

**The honest statement of the ceiling is a ROSTER, not a percentage.** Every dimension
except import fidelity can reach 100, because each is a thing we own outright:
authoring, scanning, charting, strategies, sharing, verifiability. Import fidelity
cannot, because a small number of scripts are genuinely unrepresentable — and the
right way to report that is to NAME them, with a reason each, so the list can be argued
with and shrunk. A percentage cannot be argued with; it just sits there sounding like
physics.

⛔ **So the reporting rule for this plan: state the residual as a named list with
reasons, never as a gap to 100.** A refusal roster shrinks every time somebody reads one
of its lines. A ceiling number is the sentence that stops anybody from reading them —
which is exactly how `ta.highestbars` survived as a wall for weeks.

---

## ✅ Points of contention — SETTLED, 27 Aug 2026

Seven things this plan (or I, out loud) called impossible or deferred. Each was
re-opened under the standing directive that a roadblock is a problem to solve.
**Six had answers. One did not, and its entry says why in terms somebody can check.**

### 1. Account reads (`GetQuantity`, `GetAveragePrice`) — SOLVED, as a *declared personal column*

⛔⛔ **I dismissed this as meaningless on the grounds that we have no broker context.
That was false when I said it.** SnapTrade sync has been live since June; `j2_positions`
holds `(user_id, symbol, shares, entry_price, stop_price)`. `GetQuantity()` is one lookup.

⭐ **But answering it truthfully creates a genuinely new problem, and THAT is the
interesting half.** A tree that reads the account no longer computes one number — it
computes a different number per member. `astHash` identifies a formula, the forward
record is keyed by that hash, and sharing hands the hash to somebody else. Answer it
naively and two members' rows collide in one store under one identity.

**The ruling is a third state, not a yes or a no:**
- `personal` is **DERIVED** by a walker over the tree (the shape `symbols_named` already
  uses), never asserted by the author — same rule as the repaint badge.
- A personal definition is **excluded from the shared forward record.** Its answers are
  computed per-viewer and stored per-viewer, or not stored at all.
- It **stays shareable**, and this is the part worth getting right: "stocks I hold that
  closed below their 50-day" shared to somebody else SHOULD mean *their* positions. That
  is a template, and it is the correct reading, not a compromise. The hash means *"the
  same question"* — it never meant *"the same answer"*.
- The badge says so at the door, because a column whose value depends on who is looking
  is exactly the kind of thing a member must not discover later.

### 2. Higher timeframes beyond weekly and monthly — SOLVED, by supplying bars

`TF_RESAMPLABLE = ("W", "M")`, and the refusal says honestly why: *"this engine resamples
W and M from the bars it is given."* Every reading of that treated it as a statement
about what timeframes EXIST. It is a statement about **where the bars come from.**

⭐ **`sym` already solved this exact problem three weeks ago.** A cross-symbol node does
not resample anything — the caller SUPPLIES the other symbol's series and the node aligns
on the bar's own `t`. Apply the identical shape to `tf` and the ladder opens: verified
this session, `bars_sqlite` serves all eight codes (1/5/15/30/60/D/W/M) per symbol, so
`tf(close, '60')` is a load-and-align, not a resample.

- **Chart lane: immediate.** One symbol, eight timeframes, already in the store.
- **Scan lane: a COST decision, and it takes the answer the owner already gave once.** A
  sweep over 3,742 symbols pulling intraday bars is a different order of expense from
  reading a daily row, so the scan ladder is DECLARED — exactly as multi-symbol scans are
  limited to the benchmark whitelist. Same question, same shape of answer.
- ⛔ `_assert_resamplable` becomes `_assert_servable(code, supplied)` and stays **ONE
  authority with two readers**. The bug it was written to kill — `max_lookback` holding a
  second opinion — is one careless edit away the whole time.

### 3. Exchange-prefixed symbols (`BINANCE:BTCEUR`) — SOLVED, by refusing on DATA instead of SPELLING

Today the prefix falls through on its shape. But **the grammar is ours and the data is
not**, so the sentence is the wrong thing to refuse. Parse the prefix, resolve the
symbol, and ask the only question that matters: *do we hold bars for it?*

`NASDAQ:AAPL` is AAPL and should simply work. `BINANCE:BTCEUR` gets **"we hold no bars for
the BINANCE venue"** — true, checkable, specific about which half is missing, and it
**stops being true the day we add the venue** without anybody editing a guard. A refusal
keyed on spelling would still be refusing that script long after the data arrived.

### 4. `import lib/1 as l` — SOLVED, by accepting the library beside the script

Terminal only if we insist the import resolve ITSELF. It does not have to: a member
pasting a script that imports a library can paste the library too. That turns an
unresolvable reference into an ordinary translation of a longer source — something this
engine already does. The refusal names the missing library and offers the second box.

### 5. `plotcandle`, `plotbar`, `plotarrow` — SOLVED, and the answer was already in the file

The refusal reads: *"Each needs more than one column to mean anything (`plotcandle` takes
four), so reading one as a single series would offer a member a quarter of a candle under
the script's title."* **Every clause of that is true, and the conclusion still does not
follow** — because nobody proposed reading ONE. A definition holds `plots[]`, an ARRAY,
and has since the beginning. Four columns land in four plots.

⭐⭐ **AND THE PRINCIPLE THAT SETTLES IT IS FOUR LINES ABOVE THE REFUSAL, IN THE SAME
COMMENT.** `plotshape` translates, and the file explains why in a sentence that decides
this case too: *"That is a difference in appearance, not in arithmetic, which is why it
translates rather than refusing."* A candle glyph versus four named lines is exactly a
difference in appearance. The arithmetic is untouched — `o`, `h`, `l`, `c` are four
ordinary series, individually scannable, individually correct.

**The ruling:** `plotcandle(o, h, l, c)` translates to four named columns and the CANDLE
GLYPH waits for W6's series primitives. ⛔ The one thing that must not happen is emitting
a subset — the refusal is right that a lone `h` under the script's title is worse than
nothing. All four or none.

⭐ This is the displaced plot again, exactly: **a claim about the DRAWING was doing duty
as a claim about the COLUMNS.** Twice in one file, in comments written months apart, by
somebody who knew the distinction well enough to write it down four lines earlier.

### 6. Unpublished vendor DEFAULTS — SOLVED by Task E6 (above): ask the member

The parameter is on their screen in thinkorswim. See E6.

### 7. `TTM_Squeeze` — ⛔ NOT SOLVED, and here is the shape of the wall

The formula is proprietary and unpublished. **We hold every ingredient** — Bollinger
Bands, Keltner Channels, momentum — and the *concept* is publicly documented (bands inside
channels). What we do not hold is the vendor's exact parameterisation, and no member can
read it off their screen either, because thinkorswim does not print it.

**The one honest option, which is an OWNER DECISION and not a task:** ship a
differently-named, publicly-cited reconstruction — `squeeze_bb_kc`, documented as OUR
formula with its sources — that a member opts into. That is legally clean and genuinely
useful.

⛔ **What is NOT on the table is emitting it under the vendor's name.** A member who types
`TTM_Squeeze` is asking for John Carter's indicator; handing them ours wearing his label is
the silent mistranslation this entire engine is built to refuse, and it would be the single
worst thing in the codebase precisely BECAUSE it would look right. If the owner declines
the reconstruction, the refusal stands and names the reason.

---

### What the six solved rulings have in common

Every one of them was a refusal that had **quietly widened from its own true sentence to a
bigger claim nobody re-read**:

| The true sentence | What it had become |
|---|---|
| "we resample W and M from the bars we are given" | "higher timeframes are impossible" |
| "a displaced plot draws at a different bar" | "displaced plots cannot be scanned" |
| "we have no broker context here" | "account reads are meaningless" |
| "this symbol has an exchange prefix" | "prefixed symbols are unsupported" |
| "we cannot resolve this import" | "library imports are out of scope" |
| "thinkorswim does not publish this default" | "this study cannot be translated" |

⭐ **The narrow sentence was accurate in every single case.** The wall was the
generalisation — and the generalisation is never written down, which is why it is never
reviewed. That is the failure mode this plan should be read against.

---

---


---

## ✅ SEGMENT H — PERSONAL COLUMNS: designed, gated on four owner decisions

The ruling in "Points of contention" said an account read becomes a **declared
personal column**. This is the design that implements it, and the questions that
must be answered before anyone starts. It is written here rather than left in a
review thread because the ruling without the design is not actionable, and the
design without the questions is a trap.

### H0. The shape — NO NEW NODE TYPE

**A declared name in a new manifest section, `account`, riding the existing
`series` node.**

⛔⛔ THE MANIFEST ALREADY MADE THIS EXACT RULING ONCE, for exactly this shape.
`closedTable.json::_scalars_node` says a scalar rides the `series` node rather
than adding one of its own, because *"every stored tree's `astHash` is taken over
`{type,…}` — so adding one is a decision that can never be undone without a
migration of every persisted definition."* `market_cap` is one number per symbol;
`shares_held` is one number per (symbol, viewer). **The only new axis is WHO, and
a node type is the wrong place to carry it** — the node vocabulary is what
`astHash` is taken over, and that hash is the identity every pin, share, migration
and forward-record row hangs off.

### H1. The invariants — each one testable

1. `personal` is a **total function of `def_hash`**: two definitions with equal
   `ast_hash` get the same verdict. It is a pure walk of the tree, DERIVED like
   the repaint badge, never asserted by the author.
2. `NODE_TYPES` and `_CANONICAL_KEYS` are **byte-identical in both lanes** before
   and after. The feature adds no node type and moves no persisted `astHash`.
3. **No row** exists in `scan_hits`, `scan_hits_live`, `scan_coverage` or
   `definition_evaluations` whose `def_hash` is a personal tree's. A census, both
   sides derived, with a size floor on each.
4. The nightly and live sweeps **refuse and write NOTHING** — every writer
   monkeypatched to raise, and the refusal appears in the receipt with its gate.
5. An on-demand run with no viewer **refuses**; it never evaluates against an
   empty account map.
6. ⭐ `assert_scannable` **SUCCEEDS** and returns `personal: True`. This is the
   negative control that stops the gate quietly becoming "no account reads at all".
7. `values_for` issues **one** SQL statement, its WHERE carries `user_id` as a
   bound parameter, and no reader of the definition's `author_id` reaches it —
   asserted by AST over the module and over `api/**`.
8. ⛔ **A shared personal definition evaluated for member B never returns a value
   derived from member A's positions.** A symbol B does not hold is
   `not_computable` naming the account read — never a confident 0.
9. `unresolved_inputs` names every account name with no usable value on the row,
   so `shares_held > 0` on an unheld symbol is a HOLE, not a comparison with NaN.
10. The member-scoped name set is DERIVED from `scope: "member"`, is non-empty,
    and equals the `account` section's keys.
11. `FRESHNESS_MODES` still has exactly three members; a personal tree answers
    `as-of-snapshot` with cadence `broker-sync`.
12. The two lanes agree to 1e-9 on a tree naming an account name, given the same
    supplied map.

### H2. ⛔ THE FOUR OWNER DECISIONS — DO NOT START WITHOUT THESE

1. **The SIGN of a short position.** `j2_positions` stores `side` plus POSITIVE
   `shares`. thinkorswim's `GetQuantity()` sign for a short is not pinned by any
   citation this work could find, so `shares_held`'s convention would be OURS
   alone. ⚠️ A member screening `shares_held > 0` gets a different universe
   depending on the answer, and nothing in the output reveals which was chosen.
2. **Multi-lot and multi-account aggregation.** One member can hold a symbol
   across several connected accounts. Summing is a convention, not a fact.
3. **Which `as_of` dates an account value** — the position row's `updated_at`
   (stale-but-recent for a symbol whose row did not change) or the broker
   connection's last successful sync (the real freshness of the whole answer).
   `_scalars_as_of` reasons that freshness is PER SYMBOL; the broker's own
   semantics point the other way.
4. **The share copy.** The ruling says a shared personal definition is a TEMPLATE
   — it means the recipient's positions. That is a sentence a member must read
   before they share, and it needs the owner's words, not mine.

### H3. ⚠️ RISKS MEASURED DURING DESIGN, worth carrying forward

- **The alert lane is a hole until it refuses.** `admit_user_definition` would arm
  a personal tree today and `_make_value_fn` supplies no account map. Harmless
  only because no account name exists yet — it must land WITH the section, not
  after it.
- **`stop_price` is a placeholder for broker rows** — `broker/balances.py` writes
  `entry_price` into the NOT NULL `stop_price` column. Any future `stop_held` name
  would be reading a placeholder as a fact.
- **Widening `ast_table.SECTIONS` widens `declared_names`**, which several rails
  compare against — including the conformance floors partition. Those move in the
  same change or they cry wolf.

### H4. Why this is not built here

⛔ Three of the four decisions above have **no citable answer**, and the fourth is
copy a member reads before sharing their own account data. The privacy invariant
(8) is the kind that must be reviewed by someone other than its author. Building
it unilaterally would mean choosing a short-position convention by coin flip and
writing the privacy sentence for the owner — which is exactly the shape of
decision this plan's own rules reserve for them.

⭐ What IS done: the ruling, the design, the invariants, and the questions. Anyone
picking this up starts at H2, not at a blank page.


## Self-review

**1. Spec coverage.** Every row of the scorecard's "what moves the number" table has a segment: strategies → A, drawing objects → B, programs → C, accumulator → D, functions/import tail → E, library → F. The launch surface (mobile, perf, entitlements, onboarding, observability, docs) is G, which the scorecard did not cover and a launch does.

**2. Placeholder scan.** No "TBD" / "add error handling" / "similar to Task N". E3 deliberately says "read the refusing line first" rather than inventing a fix for a script nobody has read at that line — that is an instruction, not a placeholder, and the alternative would be a plan asserting a cause it has not measured.

**3. Type consistency.** `signals_for(definition, bars, opts)` produces exactly the `{t, side, kind, price, reason}` dicts `backtest_engine.simulate` documents today; A3 extends `simulate`'s signature with keyword-only `stop`/`target`/`trail` and leaves the existing call sites working. `emitDrawings` returns `{objects, truncated}` and B3 consumes both. `account_risk_pct` and `size_for` are the only two sizing names, used in A4 and A9.

**4. One risk worth naming.** Segments A, B and C each add a definition KIND, and each must refuse in the scan lane by name (A6, B4, C4). If any one of those is skipped, the nightly sweep gains a definition it cannot terminate on — the single most expensive defect available in this codebase. They are separate tasks precisely so a reviewer can reject one without the whole segment.
