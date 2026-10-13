# WS4 — Unified formula language, builder, and shared formula intelligence

Audit of production `84164aee3d` (worktree `C:/w/indaud`, branch `audit/indicators-competitive-2026-10-13`), 2026-10-13.
Audit only: no runtime code, tests or config were changed. The evidence harnesses live in
`app/src/__audit_scratch__/ws4/` and are not committed:

- `capability.test.js` — 146 formulas through the real authoring door (`evaluateFormula`), the client interpreter and the picker;
- `capability_py.py` — the same canonical trees through the Python interpreter, `scan_definition.assert_scannable` and `alert_user_series.plot_admissions`;
- `consumers.test.js` — the owner examples built as real documents (`buildDefinition`, `validateDefinition`, `outputsOf`, `evaluability` on every lane);
- `pine_probe.test.js`, `probe2.test.js`, `probe3.test.js` — what the Pine and thinkScript doors admit, VWAP and MTF limits, and intraday bars;
- the raw outputs: `js_results.json`, `py_results.json`, `consumers_log.json`, `door_probe.json`, `probe2.json`, `probe3.json`.

Bars used: 400 deterministic synthetic daily bars (LCG, date-keyed like `/api/bars?tf=D`), plus the committed `app/src/pages/parityBars/intraday5m.json` (579 five-minute bars). No real market data was used.

---

## 0. Verdict in one paragraph

There really is **one formula language**. A single closed manifest (`app/src/components/chart/engine/ast/closedTable.json`) feeds one parser (`parse.js`, jsep, browser-only) and two interpreters (`interpret.js` and `api/services/ast_interpret.py`). Every lane reads the same persisted tree: chart, colour paints, markers, info values, alerts and saved scans. Python never parses. On the 97 of 98 admitted formulas, the two interpreters agreed exactly, value for value. The one exception is `vwap()` on date-keyed bars (see G-12).

Boolean and numeric output is decided structurally from the tree:
- browser: `outputType.js:26-31` (via `sentence.yieldsOf`);
- server: `scan_definition.py:226-331` (`is_boolean_tree`).

One gate, `evaluability.js:343`, decides per lane, so consumer sharing is genuinely good.

The weaknesses sit in **expressive reach**:
- no input-driven window lengths;
- no Daily (or 60m) reads on an intraday chart;
- session functions (VWAP) cannot be combined with anything that looks back, so "close crosses VWAP" is refused;
- no cross-definition composition and no reusable functions;
- a short moving-average and statistics list.

They also sit in **authoring ergonomics**:
- multi-kilobyte error dumps that blame "the read-back";
- `and`/`or` misrouted to the TC2000 reader;
- a one-level picker that shows raw identifiers.

**No P0 was found.**

---

## 1. Architecture of the language (verified)

| Piece | Path | Role |
|---|---|---|
| Manifest | `app/src/components/chart/engine/ast/closedTable.json` | 79 functions, 5 bar series, 30 clock names, 138 per-symbol scalars, 15 operators; also exclusion reasons (`_functions_excluded`, 25 entries) |
| Generated reference | `docs/formulas/GRAMMAR.md` (regenerated and checked by `formulaDocs.test.js`) | Lead only; it matched the manifest |
| Parser | `parse.js:1495` `parseFormula` → `canonicalise` → `expandCalls` (`callExpansions.js`: `roc`, `mom`, `vwma`, `linreg`, `correlation`, `kcMiddle/Upper/Lower` expand into table trees) | Node types are fixed at `parse.js:379` (`num series op call offset tf sym tf_live str symtext textop ltf`) |
| Operators | `parse.js:950` (precedence), `parse.js:982` `configureParser` removes every jsep operator the table does not declare (`%`, `**`, `&`, `|`, `??`, `===` …) | |
| Dialect routing | `pcf.js:1762` `readFormulaSource` (native / pcf auto-detect); `dialect.js:32` lists `pine`, `thinkscript`, `pcf`, `formula` | Pine and thinkScript enter through `PineBox`/`ImportBox` (`pine.js:22588` `translatePine`, `thinkscript.js:4597`), not the formula box |
| `let` sugar | `letPrepass.js:182` `prepareSource` | Inlined before parsing. The tree and hash are unchanged; guards `let:syntax` / `let:shadow` / `let:undefined` |
| Bind-time folding | `bind.js` (`foldScalar`, `foldBound`) | `syminfo`/`text_*` are folded once per symbol |
| Budget | `budget.js:163` `DEFAULT_BUDGET = {maxNodes:128, maxLookback:max(550, SESSION_MAX_BARS=960), maxSeriesRefs:8}` | `effectiveBudget` only clamps downward (`budget.js:282`). Node count is DAG-aware (`interpret.js:4103` `nodeCount` / `evaluationUnits`). Python twin: `ast_budget.py` |
| Repaint linter | `lint.js:880` `lintRepaint` → `non-repainting` / `preview-repaints` / `repaints` | `canSaveFormula` (`FormulaField.jsx:307`): `repaints` blocks save; `preview-repaints` needs an acknowledgement |
| Read-back | `sentence.js:1151` `sentenceFor`; Python mirror is in `definition_concierge.py:1716` | A tree with no sentence is refused (`sentence:*`) |
| The one authoring door | `FormulaField.jsx:123` `evaluateFormula` | Steps: parse → lint verdict → budget → read-back → a gate that runs the tree on 4 probe bars (`FormulaField.jsx:228-260`) |

---

## 2. Language capability matrix

Legend:
- ✅ works, verified by the scratch run;
- ⚠️ works with a caveat;
- ❌ refused, with the guard named;
- n/t not tested directly; the code reading is cited.

Column meanings:
- **parse**: `evaluateFormula` returned `ok`.
- **client** / **server**: finite values from `interpret` / `ast_interpret.interpret`; `=` means the two lanes agreed on the last 5 values and the finite count.
- **ind**: chart indicator (lane `chart`).
- **cond/colour**: `chart-paint` / `signal`.
- **alert**: `plot_admissions`, plus the signal/numeric gate in `triggerPolicy`.
- **scan**: `assert_scannable`.
- **info**: lane `info-value`.

| Feature | Example tested | parse | client | server | ind | cond/colour | alert | scan | info | Evidence / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| OHLCV operands | `open + high + low + volume` | ✅ | ✅400 | ✅= | ✅ | n/a (numeric) | ✅ numeric thresholds | ❌ `yields` (numeric) | ✅ | `js_results.json`; numeric scans are refused by design (`scan_definition.py:564`) |
| `hl2`/`hlc3`/`ohlc4` | `hl2` | ❌ `sentence:name` (2,533-char dump) | – | – | – | – | – | – | – | Excluded by ruling (`closedTable._functions_excluded.hl2`: "use `(high + low) / 2`"). The Formula box does **not** show that reason. `(high + low) / 2` ✅ |
| Clock / bar state | `dayofweek`, `barindex`, `islast` | ✅ | ✅ | ✅= | ✅ | ✅ | ✅ | ⚠️ `barindex` may be withheld (`scan_definition.py:640`) | ✅ | GRAMMAR.md clock section |
| Arithmetic `+ - * /`, unary `-` | `close * 2 - open / 3` | ✅ | ✅ | ✅= | ✅ | – | ✅ | ❌ yields | ✅ | |
| `%` and `**` | `close % 2`, `close ** 2` | ❌ `parser` ("Unexpected "%"…") | | | | | | | | Removed at configure time (`parse.js:982`); `mod()` and `pow()` ✅ |
| Comparisons `> >= < <= == !=` | `close >= open` | ✅ | ✅ | ✅= | ✅ (0/1) | ✅ | ✅ | ✅ | ✅ yes/no | |
| Boolean `&&` `\|\|` `!` | `!(close > open)` | ✅ | ✅ | ✅= | ✅ | ✅ | ✅ | ✅ | ✅ | |
| Word operators `and`/`or`/`not` | `close > open and volume > 0` | ❌ **misrouted to the PCF reader**: "this is not a TC2000 name this reader knows — `close`" | | | | | | | | `pcf.js:1676` `detectDialect`; G-7 |
| `true`/`false` | `true` | ✅ (canonicalised to 1/0) | ✅ | ✅= | ✅ | ✅ | ✅ | ✅ | ✅ | `parse.js:1000` |
| Ternary `?:` | `close > open ? close : open` | ✅ | ✅ | ✅= | ✅ | if both arms are 0/1 → condition | ✅ | only when both arms are boolean (`scan_definition.py:318`) | ✅ | Nested ternary ✅ |
| `iff()` | `iff(c, 1, 0)` | ❌ `resolve:function`, no suggestion | | | | | | | | Use `?:` |
| Crossovers | `crossOver(ema(close,9), ema(close,20))`, `crossUnder` | ✅ | ✅ | ✅= | ✅ | ✅ | ✅ | ✅ | ✅ | `crossover` (lower case) and `cross` are ❌ with no did-you-mean |
| History `x[n]` | `close[1]`, `(close>open)[1]`, `sma(close,20)[3]` | ✅ | ✅ | ✅= | ✅ | ✅ | ✅ | ✅ | ✅ | `x[0]` folds to `x` (`parse.js:1393`) |
| Negative, chained or computed offset | `close[-1]`, `close[1][1]`, `close[barindex]` | ❌ `canonicalise:offset-forward` / `-chained` / `-literal` | | | | | | | | Clear messages. The dynamic form is `barsAgo(src, k, cap)` ✅ |
| Window aggregations | `sum`, `highest`, `lowest`, `highestbars`, `barssince`, `valuewhen`, `change`, `rising`, `falling`, `cum`, `sum(close>open,10) >= 7` | ✅ all | ✅ | ✅= | ✅ | ✅ (bool forms) | ✅ | ✅ (bool) | ✅ | `cum` is window-dependent by design (`parse.js:115`) |
| Moving averages present | `sma`, `ema`, `wma`, `rma`, `hma`, `vwma` (expanded) | ✅ | ✅ | ✅= | ✅ | – | ✅ | – | ✅ | |
| Moving averages missing | `dema`, `tema`, `alma`, `kama`, `zlema`, `smma` | ❌ `resolve:function` | | | | | | | | `dema` is expressible by hand (`2*ema(c,20)-ema(ema(c,20),20)`; Pine import folds it). `alma`, `kama` and `zlema` are not available. `smma` = `rma` |
| Window must be a literal | `sma(close, 252 * 4)`, `sma(close, len)` | ❌ `resolve:window` | | | | | | | | `interpret.js` `windowLiteral`; G-1 |
| Lookback cap | `sma(close, 960)` ✅, `sma(close, 1000)` ❌ `budget:lookback` "measures 1000 and the cap is 960" | | | | | | | | | `budget.js:163` |
| Statistics | `stdev`, `dev`, `median`, `percentrank`, `percentileLinearInterpolation`, `correlation`, `linreg`, a hand-built z-score | ✅ | ✅ | ✅= | ✅ | – | ✅ | – | ✅ | `variance` and `zscore` ❌ (expressible by hand; the reason is in the manifest) |
| Indicator functions | `rsi`, `macd`, `atr`, `adx`, `stoch`, `cci`, `mfi`, `bbw`, `kcUpper`, `obvN`, `roc`, `mom`, `ichimoku*`, `aroon*`, `williamsR`, `pivothigh/low` | ✅ | ✅ | ✅= | ✅ | – | ✅ | – | ✅ | `macd` gives the line only; the signal line is written by hand (`ema(macd(...),9)` ✅). `obv`, `supertrend` and `sar` are ❌ (stateful; reasons in the manifest) |
| Recurrence / state | `accum(0, self + volume*sign(change(close)), 250)` | ✅ | ✅ | ✅= | ✅ | ✅ | ✅ | ✅ | ✅ | The only state primitive. No general `var`, loops or arrays in the native language |
| Multi-output | several builder rows → `compute.trees` | ✅ (per row) | ✅ | ✅ (`interpret_trees`, `ast_interpret.py:6324`) | ✅ | ✅ one hidden condition row can drive several elements (§5) | ✅ per plot (`PER_PLOT_GATES`) | scan reads `compute.ast` / `scanPlot` only | ✅ per output | `BuilderSheet.jsx:475-560` |
| Multi-timeframe W/M | `tf(close,'W')`, `close > tf(sma(close,10),'W')` | ✅ | ✅ (daily and 5m bases) | ✅= | ✅ | ✅ | ✅ | ✅ | ✅ | Reads the last closed period (no lookahead) |
| MTF Daily or 60m from intraday | `tf(close,'D')` on 5m, `tf(close,'60')` | ⚠️ the door admits it on its probe bars | ❌ `interpret:timeframe` on 5m | – | ❌ | ❌ | ❌ | – | ❌ | Deliberate (`interpret.js:154-190`); G-3 |
| Lower timeframe | `ltf(close,'60')` | ✅ saved | ⚠️ only with an intraday supply | – | ❌ `lower-tf:formula-unsupported` for a non-Pine document (`evaluability.js:79`) | ❌ | ❌ `withheld` | ❌ `cadence` | ❌ | The door admits a formula no chart computes (G-10) |
| Cross-symbol | `close / sym('SPY', close)`, `sym('QQQ', close > sma(close,50))` | ✅ | needs secondary bars (`secondaryBars.js`) | ✅ | ✅ when bars arrive | ✅ | ✅ ≤ 2 tickers (`evaluability.js:210`) | ✅ benchmarks only; `sym('AAPL',…)` ❌ `symbol` | ✅ | The ticker must be a quoted literal (`parse.js:1319`) |
| Nesting | `ema(rsi(close,14),9)`, `sma(sma(sma(close,10),10),10)` | ✅ | ✅ | ✅= | ✅ | ✅ | ✅ | ✅ | ✅ | The picker cannot show nested calls (`picker:term`) |
| `let` variables | `let fast = ema(close,9)` / `let slow = …` / `fast > slow` | ✅ | ✅ | ✅= | ✅ | ✅ | ✅ | ✅ | ✅ | Errors: `let:shadow` "`x` is already bound above". `fast = …` without `let` is misrouted to PCF |
| User-defined functions | `f(x) = x*2`, `function f(x){…}` | ❌ (PCF misroute / `parser`) | | | | | | | | Native: none. Pine `f(x,n) => …` ✅ at import; it is inlined into the tree (`door_probe.json` `pine:udf`) |
| Fundamentals (per-symbol scalars) | `market_cap > 1e9`, `rs_rank >= 80 && above_50sma` | ✅ | ⚠️ the probe gives 0 with empty scalars | ✅ | ❌ `chart:scalar-current-only` | ❌ | ❌ `scalar` (per plot) | ✅ | ❌ | `outputType.js:28`; current-only by design (GRAMMAR.md "Per-symbol values") |
| Economic operands | `cpi`, `gdp_growth > 2` | ❌ `sentence:name` (suggests `eps_growth`) | | | | | | | | None exist in the manifest |
| Text / symbol info | `text_startswith(syminfo('ticker'),'A')` | ❌ `sentence:node` "no rule for node type textop" | | | | | | | | Parses (`parse.js:1365`) but the native door's read-back refuses it; reachable via Pine only |
| VWAP family | `close > vwap()` ✅; `crossOver(close, vwap())`, `change(vwap())`, `crossOver(close, avwap(t))` | ❌ `budget:lookback` "measures 961 and the cap is 960" | | ⚠️ `vwap()` on date-keyed bars: JS = hlc3 on every bar, Python = blank | ✅ intraday | | | ❌ `cadence` | | G-2, G-12 |
| Repainting reads | `pivothigh(high,5,5)` | ✅ `preview-repaints`, forward=5 | ✅ | | ✅ after acknowledgement | ✅ | n/t | n/t | | `repaintWarning.js` words the 5-bar finality |
| Node budget | 20 SMA terms ✅ (measured 380 finite); 40 `(close > sma(close,i))` terms ❌ `budget:nodes` "measures 160 and the cap is 128" | | | | | | | | | `let`-reused subtrees are counted once: 12 uses of a 9-node binding measured 42 nodes (`consumers_log.json`) |

Lane agreement: of the 98 parse-OK formulas, 97 agreed exactly between JS and Python; `vwap()` on date-keyed bars was the only difference (`py_results.json`, `laneAgree`).

---

## 3. Consumer-sharing analysis

### 3.1 What is genuinely shared
- **One tree, one manifest, two interpreters.** `ast_table.py:46` reads the same `closedTable.json` bytes, and `scan_definition.py:536` resolves through the same `ast_interpret.max_lookback`.
- **One type authority.** `outputType.js:26-31` (`treeOutputType`: SERIES / CONDITION / SCALAR) and `scan_definition.is_boolean_tree` (`scan_definition.py:226`) both derive from manifest `yields`. A ternary is boolean only when every arm is boolean: `close > open ? 1 : 0` → condition, `? 2 : 1` → series (verified).
- **One permission gate.** `evaluability(def, key, lane)` (`evaluability.js:343`) covers `chart`, `chart-marker`, `chart-paint`, `builder-preview`, `info-value`, `signal`, `alert` and `scan`.
  - The alert answer is a preflight of `alert_user_series.plot_admissions` (`alert_user_series.py:1032`), held equal to it by `tests/fixtures/ast/p1_evaluability_alert.json`.
  - That parity suite passed: `tests/test_p1_truth_core.py` and `tests/test_p1_truth_signal.py`, part of the 156 passing tests.
- **Signal semantics.**
  - `triggerPolicy.js:42` maps a condition to `becomes_true` / `becomes_false` / `is_true`.
  - Numeric outputs get `above` / `below` / `cross_above` / `cross_below` against a constant (`triggerPolicy.js:144`).
  - Markers draw where the value is > 0, and this is disclosed for numeric outputs (`evaluability.js:390`).

### 3.2 Where consumers diverge, and why

| Feature | Accepted by | Refused by | Mechanism |
|---|---|---|---|
| Per-symbol scalars (fundamentals) | scan | chart, paint, signal, info value, alert | `chartScalars.js` (`chart:scalar-current-only`), `alert_user_series` `scalar` gate. Reason: no bar history |
| Numeric output | chart, info value, numeric alert | scan (`yields`), signal (`signal:numeric-output`) | `scan_definition.py:564`, `evaluability.js:367` |
| `vwap`/`avwap` (live cadence) | intraday chart | scan (`cadence`, `scan_definition.py:618`) | `ast_table.live_cadence_functions` |
| `sym('AAPL', …)` | chart (any ticker), alert (≤ 2) | scan (benchmarks only) | `scan_definition.py:540-556` reads `_benchmarks` |
| `ltf(...)` | Pine-origin chart, Formula-tab **save** | chart for non-Pine documents, alert (`withheld`), scan (`cadence`) | `evaluability.js:79`, `scan_definition.py:557` |
| `barindex`-dependent | chart | scan (`withheld`) | `scan_definition.py:640` |
| Repainting | chart (with acknowledgement) | alert `repaint` gate | `alert_user_series.py:824` |
| Scan preflight optimism | JS `evaluability(...,'scan')` says supported for `ltf`, `vwap()` and a non-benchmark `sym` | server refuses | type-layer only, `final:false` (`evaluability.js:357`). Disclosed, but a member is told "supported" first (G-11) |

### 3.3 Consumers that do **not** share the language
- **Screener typed-criteria box** (`api/services/screener/grammar.py`, FT-029) is a **second formula language** with different syntax:
  - `and`/`or`/`not`, `between`, `in [..]`;
  - `1.5m`/`25%` literals;
  - snapshot field names such as `sma50`;
  - arithmetic limited to `MAX_ARITH_NODES = 15`.

  It compiles to SQL filters (`query.build_where`), not to AST trees. It is dark by default (`SCREENER_LOGIC_ENABLED`, `logic.py:38`; v2 behind `SCREENER_ALERT_GRAMMAR_ENABLED`).
- **Two AI compilers:**
  - `api/services/screener/nl_compile.py` (English → screener criteria);
  - `definition_concierge.py` and `definition_conversation.py` (English → AST, or English → builder patch).
- **Watchlist columns.** No user formula can become a watchlist or screener result column:
  - `useServerColumns` and `serverCompute.js` serve only `compute.kind:'server'` native definitions (`serverCompute.js:1-30`; consumers are `nativeRegistry.js:3009` and `StockChart.jsx:6778`);
  - the scan sweep returns pass/fail only (`<tree> != 0`).

  A numeric formula value is visible only as a chart **info value** (`infoValueResolve.js:94`, ≤ 12 per chart, `infoValues.js:61`).
- **Historical study.** `EvidenceTab.jsx` (mounted from `BuilderSheet.jsx:896`, `tf="D"`) is the retro-study / forward-record surface for a saved condition. It reports occurrence rate against a baseline. It reuses the definition's `def_hash`, so it is the same tree.

---

## 4. Authoring UX assessment

### 4.1 Surfaces
- **Formula editor.** `FormulaField.jsx` keeps a textarea as the value carrier and fallback, and lazy-loads the CodeMirror `CodeEditor.jsx`. The editor provides:
  - autocomplete derived from the manifest, declared inputs and `let` names (`editor/completions.js:150`);
  - syntax highlighting for formula, Pine, PCF and thinkScript (`editor/languages.js:31`, `:214`, `:238`, `:325`, `:376`);
  - diagnostics at the door's own position (`editor/diagnostics.js:201`);
  - a debounce of 250 ms (`FormulaField.jsx:66`).
- **Visual builder.** `CriteriaPicker.jsx` and `criteria.js` produce only a source string. That string re-enters the same door, so there is no second save path. Row shapes:
  - comparison, crossing, flag and negation;
  - groups joined by and/or.

  Its limits are covered in G-8.
- **Read-back.** `sentenceFor` is deterministic and generated from the manifest. A sample: *"(1 when (the 9-bar exponential average of close) is greater than (the 20-bar exponential average of close) and 0 otherwise) and (1 when volume is greater than (the 20-bar average of volume) and 0 otherwise)"*. It is accurate but robotic. It contains a grammar slip, *"rising for 1 bars"* (owner example 2).
- **Live preview.** `editor/PreviewPane.jsx` and `previewDefinition.js` (`u_editor-preview`) draw through the same `computeFor` (evaluability lane `builder-preview`).
- **Type checking.** The intent read-back (`authoringIntent.js:100` `intentReadback`) shows each output's derived type in words (`typeWords`): "a yes/no on every bar". Save is blocked when the selected output is refused on the intent's lane.
- **Repaint warnings.**
  - `lintRepaint` measures the forward reach;
  - `authoring/repaintWarning.js` words it ("until 5 more bars close");
  - `canSaveFormula` (`FormulaField.jsx:307`) blocks `repaints` and needs an acknowledgement for `preview-repaints`.
- **Budget warnings.** Exact numbers, plus a reason for the VWAP case (`budget.js:328-334`).
- **Function discovery.**
  - `/formulas/reference` (`pages/formulas/FormulaReference.jsx`, routed at `App.jsx:630`, in NavBar and MoreSheet) is generated from `vocabulary.js`, including the exclusion reasons and substitutes.
  - It is linked from `PineBox.jsx:1391` but **not from the Formula tab**: a grep of `FormulaField.jsx` and `BuilderSheet.jsx` found no link.
- **Starter library.** `StarterLibrary.jsx` holds 8 shipped starters and 24 named-but-ungrounded setups (`starterScans.json`, version 2026-08-23.6). They are scan-oriented setups, not an indicator library.
- **Saved libraries.** `pine_library_store.py` stores third-party **Pine** library source only (`Author/Library/Version`, outside git). There is no native-formula user library of reusable blocks.
- **Parameters.**
  - `ParamControls.jsx` and member inputs work for thresholds and multipliers: `rsi(close,14) > lvl` ✅, with read-back "…greater than the input lvl…".
  - **Not for window lengths:** `sma(close, len)` → `resolve:window`. `builderInputs.js:395` `formulaTabWindowRefusal` explains this to the member.
  - Pine imports fold `input.int` to its default (`inputLen` → `sma(close, 20)`). A Pine-only `paramManifest` exists (`paramIdSource.js`).

### 4.2 Real error strings (verbatim from the door; long ones truncated with "…")

| Input | Guard | Message | Quality |
|---|---|---|---|
| `sma(close)` | `resolve:arity` | "wrong number of arguments — sma expects 2 arguments, got 1" | Good |
| `sma(close, 20` | `parser` | "Expected ) at character 13" | Good (positioned) |
| `macd(close, 26, 12)` | `resolve:domain` | "a period reaches past the window its own entry declares — macd argument 1 is its fastPeriod at 26, past argument 2, its slowPeriod, at 12 … put the larger one in argument 2. As written, this call computes nothing on any bar." | Excellent |
| `sma(close, 1000)` | `budget:lookback` | "exceeds the lookback budget — this formula measures 1000 and the cap is 960" | OK; it gives no fix |
| `crossOver(close, vwap())` | `budget:lookback` | "…measures 961 and the cap is 960. `vwap()` reaches back one whole trading session, which is the entire lookback budget — so it can be compared and combined, but nothing can be wrapped around it…" | Honest, but refuses the most common intraday formula |
| `close[-1]` | `canonicalise:offset-forward` | "a bar offset reads backwards, and a negative one would name a future bar" | Good |
| `sma(close, length)` | `resolve:window` | "a window must be a whole-number literal — sma argument 1 must be a whole number of at least 1, got {"type":"series","name":"length"}" | **Leaks raw JSON AST** |
| `highest(high, -5)` | `resolve:window` | "…got {"type":"op","name":"u-","args":[{"type":"num","value":5}]}" | Leaks JSON |
| `smaa(close, 20)` / `emma(...)` / `crossover(...)` | `resolve:function` | "unknown function "smaa" — this table declares abs, accum, adx, … cum" (≈705 chars) | **No did-you-mean**, even for a case-only typo (`crossover` vs `crossOver`) |
| `hl2` | `sentence:name` | "the read-back cannot name a value the table does not declare at $: "hl2" — this table declares close, high, low, open, volume, its clock is …, its scalars are … (138 names) …, and this definition declares no inputs" (2,533 chars) | **Poor**: blames "the read-back", exposes JSON path `$`, and does not show the manifest's own substitute `(high + low) / 2` |
| `gdp_growth > 2` | `sentence:name` | "…at $.args[0]: "gdp_growth" — did you mean `eps_growth` or `rev_growth`? — this table declares …" (2,593 chars) | Did-you-mean exists for names only (`sentence.js:191`, `:871`) |
| `close > open and volume > 0` | `pcf:name` | "this is not a TC2000 name this reader knows — `close` at character 0" | **Misleading**: the member wrote English booleans, not TC2000 |
| `tf(close, '60')` | `interpret:timeframe` | "a higher-timeframe read names a timeframe this engine cannot serve from the bars it was given '60' — this engine resamples W, M from the bars it is given. The declared ladder is …" | Accurate; engine-speak |
| `text_startswith(syminfo('ticker'),'A')` | `sentence:node` | "this read-back has no rule for that node shape at $: node type "textop" — the canonical types are …" | Internal |

### 4.3 Judgements
- **Can an intermediate trader with no programming background build useful indicators?**
  - *Partly, yes, for conditions.* Starters, the picker, autocomplete, the read-back, typed intent and repaint and budget gates make "X above Y and Z rising" buildable and safe. Both owner examples are pickable.
  - *Weakly for indicators.* The picker cannot express `volume > 1.5 * sma(volume, 20)`, nested calls, or anything numeric. Function names are raw (`percentileLinearInterpolation(…)`, `atrPine(…)`), and arguments are unlabelled "argument 1/2" fields (`CriteriaPicker.jsx:289-330`). Error messages often dump the whole vocabulary or blame the read-back. A non-programmer typing `and` gets a TC2000 error.
- **Are advanced traders artificially constrained?** **Yes, materially.**
  - no input-driven lengths;
  - no Daily or 60m on intraday;
  - VWAP cannot be crossed or smoothed;
  - no loops, arrays or general `var` (only `accum`);
  - no user functions or cross-definition references;
  - missing `alma`/`kama`/`zlema`/`supertrend`/`sar`/`obv`;
  - literal-only windows (`252*4` refused);
  - 128 nodes (about 30-40 distinct comparison terms; reuse is free thanks to DAG counting);
  - a 960-bar lookback.

  Many of these are principled and documented in the manifest's exclusion reasons; the code is unusually honest. They still cap what an advanced TradingView or ThinkScript user can port: `request.security(...,"D")`, Pine loops and `ta.supertrend` are all refused (`door_probe.json`).

### 4.4 Formula assistant (concierge / conversation) architecture
- **Concierge** (`definition_concierge.py`) turns English into a tree. Its pipeline is cost → generate (tool schema generated from the manifest, `:476` `tool_schema`) → schema → canonical shape → budget → lint → compute → read back.
  - The read-back sentence is assigned from `sentence_for(ast)`, never by the model.
  - It allows one repair, then refuses with a named gate.
  - It keeps a persistent per-member spend ledger (`:163` `spend_for`).
- **Conversation** (`definition_conversation.py`) turns English into a structured patch (`builder/authoring/patchSchema.json`). The server never applies the patch; the client applies it through `applyPatch.js` against the same `evaluateFormula`, schema and evaluability. Other properties:
  - inputs are delimited and JSON-escaped (prompt-injection boundary);
  - `MAX_MODEL_CALLS = 2`;
  - per-conversation caps.

  These are sound gates. Machine-written formulas get no privileged lane.
- **Known test drift, confirmed.** `tests/test_definition_concierge.py` gives **5 failed, 92 passed**:
  - `test_the_BUDGET_is_consulted_BEFORE_the_linter_which_is_how_M6_is_visible` (expected `lint:repaint`, got `budget:nodes`);
  - `test_a_proposal_that_LINTS_repainting_gets_ONE_repair_and_then_a_REFUSAL`;
  - `test_the_REPAINT_refusal_is_the_LINTERS_and_disappears_when_the_LINTER_alone_goes`;
  - `test_EVERY_refusal_names_a_door_and_hands_back_NO_formula`;
  - `test_the_CORPUS_of_FIRM_PHRASINGS_gets_a_NAMED_OUTCOME_for_EVERY_ROW`.

  This is consistent with fixture drift plus a corpus gap; it was not re-investigated.

---

## 5. Composition findings

| Question | Answer | Evidence |
|---|---|---|
| Reference one indicator inside another | **No** for user formulas. Built-in natives can take a `source` input (`defId.plotKey`) validated by `defSchema.validateSourceReferents` (`defSchema.js:2221`; `dataSeries`/MA in `nativeRegistry.js:1120-1200`). The formula lane has no node for another definition's column, and `input.source` is refused (`builderInputs.js:248` `FOLDED_INPUT_INEXPRESSIBLE`) | `parse.js:379` |
| Build composites | Yes, inside one formula (nesting, `let`) and one document (several rows / `compute.trees`). A tree cannot read a sibling row's value; it must restate it | `BuilderSheet.jsx:515-530` |
| Reuse functions | Native: no. `let` is per-formula source sugar only (`letPrepass.js`). Pine UDFs are inlined at import (`pine:udf` → `ema(close, 20) - sma(close, 20)`) | `door_probe.json` |
| Save building blocks | Whole definitions only (user definition store; reopen and edit). No snippet or function library. `pine_library_store` is third-party Pine source | `pine_library_store.py:1-20` |
| One condition → several chart elements | **Yes, within one document.** A hidden boolean row can drive (a) a plot's `colorMode:'column:<key>'` with `colorUp`/`colorDown`, (b) a `barcolor` paint, (c) a `bgcolor` paint and (d) a marker. Verified as a valid document: owner example 2 drives an MA colour and a background from one condition. Across documents: no | `consumers_log.json` `owner2.*`; `defSchema.js:2043` `validatePaints`; `authoringIntent.js:180` `signalPaintsFor` |

---

## 6. The two owner examples

### 6.1 "Colour candles green when the 9 EMA is above the 20 EMA, but only if volume is above its 20-day average"
- **Expression.** `ema(close, 9) > ema(close, 20) && volume > sma(volume, 20)`.
  - Door: `ok`, `non-repainting`, type `condition`.
  - Interpreters: client 400/400 finite; Python identical (`laneAgree`).
  - `is_boolean_tree` true; scan ADMIT; alert ADMIT.
  - Picker: ✅ (`fromSource` ok).
- **Document.** `buildDefinition({plots:[hidden condition row], paints: signalPaintsFor('signal',{barcolor:'#00ff00'})})` produces `paints:[{kind:'barcolor', colorMode:'column:signal', colorUp:'#00ff00', colorDown:'transparent'}]`.
  - `validateDefinition` ok;
  - `presentationVerdict` supported;
  - `evaluability` supported on all 8 lanes.
- **Rendering path.**
  1. BuilderSheet SIGNAL intent, "signal-barcolor" checkbox (`BuilderSheet.jsx:3527`).
  2. `signalPaintsFor` (`authoringIntent.js:180`).
  3. `buildDefinition` (`BuilderSheet.jsx:487`).
  4. `binder.syncPaints` (`binder.js:827`) builds a `time → colour` map.
  5. `StockChart.jsx:88`, `:13027` `wrapSeriesForBarColours` / `reapplyBarColours` call `barColours.applyBarColour` on the candles' own data points.
- **Verdict.** Expressible and renderable today. Bars where the condition is false keep the default candle colour (`NO_PAINT`).
- **Caveat.** "20-day" holds only on a daily chart. On intraday, `sma(volume, 20)` means 20 bars, and a native formula cannot read a daily SMA from an intraday chart (G-3).
- The UI click path was traced in code, not driven in a browser.

### 6.2 "Highlight periods when RSI > 70 and price is above a rising 50-day MA"
- **Expression.** `rsi(close, 14) > 70 && close > sma(close, 50) && rising(sma(close, 50), 1)`. The alternative `… && sma(close,50) > sma(close,50)[1]` also works.
  - Both: `ok`, condition, lanes agree, scan and alert ADMIT, picker ✅.
- **Document.**
  - a hidden condition row;
  - an `sma(close,50)` row with `colorMode:'column:hot'` (orange when hot, blue otherwise);
  - a `bgcolor` paint at opacity 0.2.

  `validateDefinition` ok. The condition is supported on all lanes. The MA row is a series: `signal` and `scan` are refused (correctly), and the marker lane is disclosed.
- **Rendering path.** As in 6.1, except `bgcolor` is drawn by `paintPrimitive.js:87` `createBackgroundPrimitive` / `backgroundRuns`.
- **Verdict.** Expressible and renderable today.
- **Semantics caveat.** `rising(x, 1)` means up versus one bar ago; "rising" over N bars is `rising(x, N)` (strictly monotone).
- **Read-back slip.** *"rising for 1 bars"*.

---

## 7. Gaps

Each gap gives: description; evidence; current vs expected; user impact; complexity; dependencies; regression risk.

### G-1 (P1) A native formula cannot expose a length as a parameter
- **Description.** A window argument must be a numeric literal, so `sma(close, len)` with a declared input `len` is refused.
- **Evidence.** `consumers_log.json` "input:sma(close, len)" → `resolve:window`; `builderInputs.js:395-403`; `parse.js:294-345` (`INPUTS_ARE_FOLDED`, `inputDefault` only for Pine-folded inputs).
- **Current vs expected.** Today only thresholds and multipliers can be inputs. Expected: `input.int` lengths bounded by a declared `maxval`, the path the manifest already records in `_input_windows.whenRuntime`.
- **User impact.** Every hand-built MA, RSI or channel indicator needs a formula edit to change its period. Settings panels are thin compared with built-ins.
- **Complexity.** M–L: budget, lint and the scan cadence must bound by `maxval`; both lanes change.
- **Dependencies.** `_input_windows` ruling; `ast_budget`; alert re-admission per input set.
- **Regression risk.** Medium. Lookback and repaint proofs change from constants to bounds.

### G-2 (P1) Session functions cannot be combined with anything that looks back
- **Description.** `crossOver(close, vwap())`, `change(vwap())` and `crossOver(close, avwap(t))` are refused at 961 > 960. "Price crosses VWAP" cannot be expressed in any spelling.
- **Evidence.** `probe2.json`; `budget.js:163`, `:328-334` (the code itself calls this "the formula a member will type first").
- **Current vs expected.** Only `close > vwap()` is allowed. Expected: a session lookback plus a small offset should be admissible.
- **User impact.** Intraday traders cannot alert on or colour VWAP crosses with a formula.
- **Complexity.** S–M: cap the session at `SESSION_MAX_BARS + k`, or special-case the session in lookback arithmetic.
- **Dependencies.** Python `ast_budget`; the scan cadence gate is unaffected because the scan already refuses VWAP.
- **Regression risk.** Low–medium (budget invariants and drawable-fraction maths).

### G-3 (P1) Multi-timeframe reads are limited to W and M resampled from the chart's own bars
- **Description.** No Daily or 60m read is possible on an intraday chart, and `request.security(…, "D", …)` is refused.
- **Evidence.** `probe3.json` (`tf(close,'D')` on 5m → `interpret:timeframe`); `interpret.js:152-215` ruling.
- **Current vs expected.** Today: W/M only. Expected: `tf_live`/`tf` chosen by base timeframe, as the ruling's own unblock note describes, plus a higher-timeframe bar supply.
- **User impact.** Prior-day high or low, a daily EMA on a 5m chart, and 60m trend filters are all impossible. The Evaluability door admits `tf(close,'D')` on its probe bars, then the chart refuses it.
- **Complexity.** L.
- **Dependencies.** Secondary bars supply (`secondaryBars.js`), the translator base timeframe, both interpreters.
- **Regression risk.** Medium (lookahead correctness).

### G-4 (P1) No composition across definitions and no reusable functions
- **Description.** A user formula cannot read another indicator's output. There is no `source` input binding, no native user-defined function, and no library of building blocks.
- **Evidence.** §5; `builderInputs.js:248`; `parse.js:379`.
- **Current vs expected.** Today the user copies and pastes formula text. Expected: `src` inputs bound to `defId.plotKey` (the native lane already has this), and named saved snippets.
- **User impact.** Advanced users duplicate logic; one edit does not propagate. "RSI of my custom oscillator" is impossible unless the user restates the oscillator.
- **Complexity.** L.
- **Dependencies.** Registry dependency ordering, hash invalidation (`compute.rev`), alert admission of dependent definitions.
- **Regression risk.** High.

### G-5 (P2) Unknown-name and unknown-function errors are vocabulary dumps that blame "the read-back"
- **Description.**
  - Unknown names give 2.5k-character messages with JSON paths and leaked JSON ASTs.
  - Functions get no did-you-mean, not even for a case-only mismatch.
  - The manifest's own substitutes (`hl2` → `(high+low)/2`, `variance` → `stdev²`) are not surfaced in the Formula box.
- **Evidence.** §4.2; `sentence.js:871`; `vocabulary.js:152` `substituteFor` (used only by `FormulaReference`).
- **Current vs expected.** Expected: a short message, the nearest match, the substitute, and a link to `/formulas/reference`.
- **User impact.** High friction for non-programmers.
- **Complexity.** S.
- **Dependencies.** Disjoint-message rails (`budget.test.js`, `diagnostics.test.js`).
- **Regression risk.** Low (wording rails will need updating).

### G-6 (P2) Common functions are missing
- **Description.** `alma`, `kama`, `zlema`, `dema`/`tema` (hand-expressible only), `supertrend`, `sar`, `obv` (only `obvN`), `iff`, `cross`, a MACD signal/histogram helper, and Bollinger upper/lower bands (excluded because of the float multiplier).
- **Evidence.** `js_results.json`; `closedTable._functions_excluded` (25 entries with reasons).
- **Current vs expected.** Expected: at least the stateful classics (supertrend, SAR) via the `accum`/recurrence lane, and named helpers for idioms.
- **User impact.** Ports from TradingView fail; users rebuild the idioms by hand.
- **Complexity.** M each (both lanes, vendor parity fixtures).
- **Dependencies.** Recurrence planner; vendor-parity harness.
- **Regression risk.** Low per function.

### G-7 (P2) English boolean words and bare assignments are misrouted to the TC2000 (PCF) reader
- **Description.** The resulting errors name the wrong problem.
- **Evidence.** `close > open and volume > 0` → `pcf:name` "`close` is not a TC2000 name"; `fast = ema(close, 9)` → `pcf:name`; `pcf.js:1676` `detectDialect`.
- **Current vs expected.** Expected: either accept `and`/`or`/`not` as aliases (the screener grammar already uses them), or refuse with "use `&&` / `||` / `!`".
- **User impact.** The first thing many non-programmers type fails confusingly.
- **Complexity.** S.
- **Dependencies.** The dialect-detection rails.
- **Regression risk.** Low–medium (PCF detection heuristics).

### G-8 (P2) The visual builder is one level deep
- **Description.** No arithmetic on a term (`1.5 * sma(volume,20)`), no nested calls (`rsi(ema(close,5),14)`), raw identifiers, unlabelled arguments, scalars mixed with bar series in one dropdown, and numeric indicators are not buildable at all (`picker:not-a-condition`).
- **Evidence.** `CriteriaPicker.jsx:278-330`; `criteria.js:208-218`; `js_results.json` picker column.
- **Current vs expected.** Expected: an argument-role-labelled function picker (the manifest has `argRoles`), one level of arithmetic, and nested calls.
- **User impact.** Intermediate users hit the wall quickly and must switch to text.
- **Complexity.** M.
- **Dependencies.** The `fromAst`/`toSource` identity rails.
- **Regression risk.** Low–medium.

### G-9 (P2) Two formula languages and two AI compilers for screening
- **Description.** The screener `where` grammar (FT-029: `and`/`or`, `1.5m`, `%`, snapshot fields) and the formula AST language (`&&`, functions) have different syntax and semantics. `nl_compile.py` and `definition_concierge.py` both compile English.
- **Evidence.** `api/services/screener/grammar.py:1-60`; `pages/screener/shell/criteriaApi.js`.
- **Current vs expected.** Expected: one language, or at least an explicit bridge. The definition scan lane already exists (`scan_definition.assert_scannable`).
- **User impact.** Inconsistent mental model once the screener box ships. It is dark today (`SCREENER_LOGIC_ENABLED` defaults off).
- **Complexity.** L.
- **Dependencies.** Screener SQL snapshot vs bar-series scan sweep.
- **Regression risk.** Medium.

### G-10 (P2) The Formula tab saves formulas no consumer computes
- **Description.** `ltf(...)` in a non-Pine document saves, then is refused on every chart (`lower-tf:formula-unsupported`), on alerts (`withheld`) and on scans (`cadence`). `text_*` is refused at the read-back although it parses.
- **Evidence.** `consumers_log.json` `ltf.lanes`; `evaluability.js:79`; `js_results.json` (`textop`).
- **Expected.** Refuse at the door with the chart's sentence.
- **User impact.** A confusing dead artefact.
- **Complexity.** S.
- **Regression risk.** Low.

### G-11 (P3) The browser scan preflight is optimistic
- **Description.** `ltf`, `vwap()` and a non-benchmark `sym` read "supported" in the browser and are refused by the server.
- **Evidence.** `evaluability.js:357-364` (type layer only, `final:false`); `py_results.json` scan column.
- **Expected.** Mirror the server's cadence, symbol and withheld gates in the preflight.
- **Complexity.** S.
- **Regression risk.** Low.

### G-12 (P3) `vwap()` on date-keyed daily bars: the lanes disagree
- **Description.** JS returns hlc3 on every bar (each bar is its own session, which matches Pine). Python returns blank on every bar.
- **Evidence.** `py_results.json` `vwap()` (pyFinite 0 vs jsFinite 400); both lanes call `compute_vwap_raw`/`computeVWAP`.
- **User impact.** Low. A daily VWAP is not meaningful, and arm-time cross-lane proof would refuse the alert rather than fire wrongly. It is still an unrecorded divergence.
- **Complexity.** S.
- **Regression risk.** Low.

### G-13 (P3) Read-back quality
- **Description.** The read-back is accurate but mechanical ("1 when … and 0 otherwise") and has a grammar slip ("rising for 1 bars").
- **Evidence.** `sentence.js` rules; owner example 2.
- **Complexity.** S.
- **Regression risk.** Low. The saved description changes, but descriptions are not hashed.

### G-14 (P3) Budget ceilings
- **Description.**
  - 128 nodes: about 30-40 distinct comparison terms (40 terms measured 160). Reuse is free (DAG count).
  - 960-bar lookback (`sma(close,1000)` refused).
  - Windows must be literal (`252*4` refused).
- **Evidence.** `js_results.json` budget rows; `budget.js:163-167`.
- **User impact.** Rarely binding for intermediate users. It binds for composite "score" indicators.
- **Complexity.** S to raise or constant-fold windows (both lanes).
- **Regression risk.** Low–medium (performance).

### G-15 (P2, hygiene) Concierge test drift
- **Description.** 5 failing tests in `tests/test_definition_concierge.py` on production.
- **Evidence.** Pytest output (§8).
- **Impact.** The safety rails of the AI door are not green, so a real regression there would be masked.
- **Complexity.** S.

---

## 8. Tests run

| Command (targeted) | Result |
|---|---|
| `npx vitest run src/__audit_scratch__/ws4/capability.test.js` | 1 passed (146 formula cases recorded, 98 admitted) |
| `python app/src/__audit_scratch__/ws4/capability_py.py` | 98 parse-OK trees through Python: 97 lane-equal; `vwap()` differs (G-12) |
| `npx vitest run src/__audit_scratch__/ws4/consumers.test.js` | 7 passed |
| `npx vitest run src/__audit_scratch__/ws4/pine_probe.test.js` / `probe2.test.js` / `probe3.test.js` | passed (probe outputs recorded) |
| `npx vitest run ast/budget.test.js ast/letPrepass.test.js builder/criteria.test.js engine/evaluability.levelLines.test.js ast/formulaDocs.test.js builder/editor/completions.test.js builder/editor/diagnostics.test.js` | 7 files, **1005 passed** |
| `pytest tests/test_scan_definition.py tests/test_ast_budget.py tests/test_p1_truth_core.py tests/test_p1_truth_signal.py` | **156 passed** |
| `pytest tests/test_definition_concierge.py` | **5 failed, 92 passed** (the known drift; names in §4.4) |
