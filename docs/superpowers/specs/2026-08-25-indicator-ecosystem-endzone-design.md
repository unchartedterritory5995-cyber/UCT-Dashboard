# Indicator & Scan Ecosystem — the end zone

**Status:** owner-approved design, 2026-08-25. Supersedes the sequencing in
`2026-08-11-custom-indicator-authoring.md` (its measurements stand) and the
"scripting tier killed" adjudication of `2026-07-31-indicator-platform-design.md`
(overruled by the owner 2026-08-11: *author anything, at TradingView's level*).

## 0. The one-sentence version

A member writes, pastes (Pine · thinkScript · TC2000) or describes an indicator
or scan **once**; the same object draws on the chart, sweeps the full universe
nightly and continuously through the session, arms a closed-bar alert, carries
an honest forward record and a base-rate-controlled retro study, and can be
shared with attribution — with every capability the five rivals sell for that
job, plus the three none of them have: cross-platform import, full-universe
scans on a member's own script, and evidence.

## 1. Finish line — acceptance, all measurable

| # | Acceptance | Yardstick (pinned in a test, both directions) |
|---|---|---|
| A1 | Author a MACD-with-histogram from scratch in the editor: three plots, member inputs, overlay/pane choice, styles; it draws, scans (on `hist > 0`), alerts — one `def_hash` at every surface | `tests/test_endzone_acceptance.py` + a `BuilderSheet.endzone.test.jsx` walking the four surfaces on one hash |
| A2 | Paste any of the 21-script Pine corpus: **17/21** translate (the 4 by-design refusals name their reason) | `pine.corpus.test.js` snapshot: `saveable == 17` |
| A3 | Paste the 30-script Pine **community** corpus: ≥ 80 % translate, every refusal at its token | `pine.community.test.js` snapshot, pinned both directions |
| A4 | Paste the 24-script **thinkScript** corpus: **8/24 in Wave 1 — the MEASURED ceiling, and the corpus is already at it** (12/24 only if four vendor pages publish; **15 is unreachable by construction**). Chrome calls listed as ignored lines, never dropped. See the 2026-08-27 amendment below for the partition and its derivation. | `thinkscript.corpus.test.js` snapshot, pinned both directions, partition asserted TOTAL and DISJOINT |
| A5 | TC2000: **63/71 shipped against a MEASURED ceiling of 65/71** — 66 was not reachable; the five named refusals were right but **incomplete**. Partition asserted TOTAL and DISJOINT. See the 2026-08-27 amendment below. | `pcf.vocabulary.test.js` EXPECTED table, every claimed spelling asserted to **compute** end-to-end, not merely parse |
| A6 | A scan runs on the full universe nightly **and** every 5 min through the session with a per-cycle coverage receipt; a member sees live vs nightly per hit | `test_scan_live_sweep.py` + the receipt fields on the surface |
| A7 | A weekly condition inside a daily scan (`tf(close > sma(close,10), 'W')`) and an RS-vs-SPY condition (`sym('SPY', close)`) both sweep and both draw | conformance fixtures for `tf`/`sym` in both lanes at 1e-9 |
| A8 | Every 0/1 definition has an **Evidence** tab: forward record (E-6) beside a retro study with baseline, fill-at-open, coverage, horizons 1/5/10/20 — never a naked hit rate | `screener/backtest.py` receipt rendered; a rail refuses a `strategy` stat without its `baseline` |
| A9 | Share a definition: the recipient gets a copy carrying author + origin hash + the record; export/import JSON round-trips byte-identically | `test_definition_sharing.py` |
| A10 | Drawing outputs on the chart lane: `hline`, `fill`, `bgcolor`, `plotshape`, `label` (series-derived) and bounded objects (`line`/`box`) | pixel parity harness case per output kind |
| A11 | Chart-lane programs: arrays, bounded `for`, records, under a step budget; badged **chart-only**; the scan lane refuses them by name | `program.budget.test.js` (a step over the cap refuses) |
| A12 | Strategies: entry/exit conditions + sizing → equity curve, trade list, stats; Pine `strategy.*` and ToS `AddOrder` translate into it | `test_strategy_engine.py` + a translated corpus strategy |

## 2. Where we stand — measured on `origin/master` 2026-08-25

- Engine: jsep AST, JS + Python lanes at 1e-9, closed table **5 series · 15 operators · 50 functions · 108 scalars** (`tableVersion: 1`), repaint linter (`non-repainting | preview-repaints | repaints`), node/lookback budgets (128 / 550), append-only per-user store with `compute.rev` migration.
- Doors: Library (8 grounded starters, 24 named-but-unexpressible) · Conditions picker · typed formula (a **2-row textarea**; TC2000 auto-detected) · Pine paste (`PineBox`) · AI concierge (`/propose`, **Sonnet 5**, schema derived from the table).
- Import: Pine **12/21** (189 tests; ceiling 17 — `request.security` ×2, `strategy`, `cum` are correct refusals) · TC2000 **61/71** (98 tests) · thinkScript **0** (no references in the tree).
- Definitions: **one tree → one plot → a forced 15 % pane**; Pine `input.*` folds to constants; no `let`; no overlay/style choice; `AST_DEFS` is frozen-empty and user formulas resolve only through the session index.
- Scans: Phase E E-1…E-6, E-8, E-9 shipped; 05:00 ET sweep **armed in prod** (`SCAN_SWEEP_ENABLED=1`); `scan_hits`/`scan_coverage`; scan→chart; alerts on user formulas (`USER_FUNCS`); E-7 mechanism live with no numbers. No authoring door on `/screener`; nightly only; no MTF; no value columns.
- Evidence: `api/services/screener/backtest.py` (833 lines, pure, baseline REQUIRED, fill-at-open) and `api/routers/backtest.py` + `backtest_engine.simulate` + 4 strategy templates — **both paid-gated and reachable from no UI**. `candle_backtest.py` holds the date-matched base rate.
- Live precedent: `screener/live_tier.py` — a side table, one writer, LEFT-JOIN overlay, zero new provider calls (the 30 s `full_market_snapshot`), per-row provenance. The nightly sweep's whole compute measured **42.4 s**.
- Known reds/landmines: colour change not live (8/15, unfixed) · `computeVWAP` buckets sessions by UTC day · ~~`test_definition_record.py` red on the shared-root guard~~ (CORRECTED 2026-08-26: green since b69c45ca4 — the red was the probe’s own sqlite3.connect, not a writer) · legend compact mode hides the settings door · two settings systems (MAs vs indicators).

### A4 amended 2026-08-26 — the measured ceiling, not an aspiration

The original ≥ 70 % was written before the corpus was measured. Nine of the 24 scripts
refuse for reasons that are **correct**, not missing work: `thinkscript:aggregation`
(files 06, 09, 22 — secondary aggregation costs THREE files, not one), `:symbol` (08),
`:time` (15, 23), `:fold` (18), `:strategy` (21), `:account` (24). Wave 1's honest
ceiling is therefore **15/24**; `tf`/`sym` (W2b) convert the aggregation and symbol
refusals, taking it to **19/24**. `:fold`, `:strategy` and `:account` are permanent
by-design refusals in the same sense as Pine's four.

⛔ A number a lane cannot reach is not a target — it is a lie the lane has to explain
later. The snapshot is pinned in BOTH directions at the measured figure, so a gain
cannot hide a regression and neither can a lowered bar.

## 3. Owner decisions, 2026-08-25 (standing — do not re-litigate)

1. **Cadence: continuous intraday universe sweep** through the session, on top of nightly. (Cost raised once; decided.)
2. **Order: all waves now, in parallel where file ownership allows.**
3. **Multi-symbol in scans: benchmark whitelist** (chart lane may fetch any symbol).
4. **Scope: the full program through W8** (loops/UDTs and strategies included).

## 4. Non-negotiables every wave inherits

- A thing that cannot be computed **refuses by name** at its token; nothing resolves to a neighbour. A translator never truncates, approximates, or guesses a proprietary formula.
- **One object, one hash.** `def_hash` is the `astHash` of the scan tree; chart, scan, alert, record and share all hold that one string. Multi-plot must not move any existing hash.
- **The closed table is the single authority** — vocabularies, completions, schemas, sentences, pickers and translators are *derived* from it; nothing hand-lists names. A new section arrives in both lanes with a conformance fixture, and the census control stays closed.
- **Two lanes at 1e-9** for everything a scan can run. The chart-only lane (programs, object drawings) is the one declared exception and is badged.
- **Closed-bar alerts; the repaint linter is the brand.** Any lookforward is declared (`preview-repaints` with its k) or refused.
- **Never a naked hit rate** — every strategy stat ships with its date-matched baseline (`HorizonResult` refuses otherwise).
- **Derive, never restate** (a second authority over one value is this repo's most repeated defect). Counts are pinned in both directions and move with the manifest.
- **No provider storm.** Live paths read the shared 30 s snapshot; prewarm rings respect the Massive breaker and are sized by measurement.
- **Open the artifact.** Every wave ends with a live-surface audit of a REAL payload, per the standing review→audit→ship cadence.

## 5. Architecture — the changes to the core

### 5.1 Definition shape v2 — multi-plot, placement, style
`compute.kind: 'ast'` gains `trees: { <plotKey>: <canonical ast> }`; `compute.ast` stays as the **scan tree alias** (the plot named by `scanPlot`, default the only/first plot) so `def_hash` of every existing definition is unchanged and `scan_hits`/`definition_record` keys do not move. `compute.fn` stays `astHash(compute.ast)` — the scan tree — so `defSchema`'s rule 3 (*an `ast` definition's `compute.fn` IS its `astHash`*) holds unchanged; a multi-plot document additionally carries `compute.treesHash` (the `astHash` over the canonical `[plotKey, tree]` list) for change detection and `compute.rev` migration; single-plot documents hash exactly as today. `plots[]` carries per-plot `style` (`line | histogram | area | columns | circles | cross`), colour `token:*` refs, `lineWidth`, `levels[]` (hlines), `fill: {a, b}`; `placement.target: 'overlay' | 'pane'` chosen by the member (default derived: a tree whose value range is price-like overlays). Both lanes evaluate every tree; alert addresses already carry `u_<id>.<plotKey>`. `defSchema` validates the new fields; `binder` draws them (it already draws multi-plot natives).

### 5.2 Language — new closed-table sections (both lanes, fixtures, census control)
- **`let` bindings** (source sugar): `let c1 = …` lines, then the expression. The parser inlines → the AST and `astHash` are unchanged; `source` is kept verbatim. Shadowing a table name refuses by name.
- **`clock` section** (series-kind, non-repainting): `time` (bar epoch s), `year`, `month`, `dayofmonth`, `dayofweek`, `hour`, `minute`, `sessionfirst` (0/1), `barindex`; and tf booleans `isintraday`, `isdaily`, `isweekly`, `ismonthly` derived from the evaluation `tf`. Unlocks Pine 14/15 and thinkScript `GetTime`/`SecondsFromTime` shapes.
- **Session VWAP** `vwap()` and **anchored** `avwap(anchorEpoch)` with window kind `session` — lookback declared as "the session"; `computeVWAP`'s UTC-day bucketing is replaced by the ET session (landmine §2) before either lands. `obvN(n)` = signed-volume sum over `n` (bounded; OBV's level stays refused, with the reason).
- **`tf(expr, '<tf>')` node** — higher-timeframe evaluation. `expr` is evaluated on HTF bars (the one resampler `_timeframe_candle` already owns for D→W/M; intraday ratios from the bars store) and each base bar reads the **last CLOSED** HTF bar (TV `lookahead=off` + `[1]` semantics) → `non-repainting`. `tf_live(expr, tf)` reads the forming HTF bar → `preview-repaints`. Lookback in base bars = expr lookback × ratio, declared. Scan lane: `D | W | M` only (99.5 % weekly / 99.8 % monthly coverage measured 8/24). Refuses a TF lower than the base TF by name.
- **`sym('<TICKER>', expr)` node** — other-symbol evaluation aligned by session (missing session → NaN → `not_computable`). Chart lane: any symbol via `bars_fetch`. Scan lane: the `benchmarks` manifest section (SPY, QQQ, IWM, DIA + the 11 sector SPDRs), loaded once per sweep and memoised per `(sym, subtree)`; any other symbol refuses `scan:symbol`.
- **`pivothigh/pivotlow(src, left, right)`** with declared lookforward `right` → `preview-repaints` (k = right). **`barssince(cond, n)`, `valuewhen(cond, src, n)`, `highestbars/lowestbars(src, n)`** — bounded forms (window required); unbounded stays refused with the sentence.
- **`stochWorden`, `aroonUp/aroonDown`, `bop`** — declared from published formulas so TC2000's remaining spellings land honestly; `ms`/`tsv` remain permanent named refusals.
- `yields`, `lookback`, `sentence`, `cadence` are declared for every new entry; `manifest.tableVersion` bumps to 2 with a provenance line.

### 5.3 Translators
- **Pine**: `input.*` → **member-declared inputs** (not folded constants; folding stays available as "freeze values"); `request.security(syminfo.tickerid, tf, expr)` → `tf`; `request.security('SPY', …)` → `sym`; `time`/`dayofweek`/`isintraday…` → `clock`; `ta.pivothigh/low`; the 02/21 state seeds (`var … = na`); `plotshape/plotchar/bgcolor/fill/hline` → §5.6 series-derived drawings; `line.new/box.new/label.new` → §5.6 objects (chart-only). `strategy.*` → §5.8. `cum`, `array.*` in scans, `request.footprint`, `runtime.*` stay refused by name.
- **thinkScript** (new, `engine/ast/thinkscript.js`, same shape as `pine.js`): lexer + statement reader for `declare`, `input`, `def`, `plot`, `rec`/`CompoundValue` (→ `accum`), `fold` (→ bounded unroll ONLY where the range is a literal and the body is expressible — measured on the corpus before building, per the Pine Wave-2 lesson), `if/then/else` and `switch/case` (→ `?:`), `crosses above/below`, `[n]` offsets, `Average/ExpAverage/WildersAverage/Highest/Lowest/StDev/Sum/RSI/ATR/…` → table functions by verified formula, `AggregationPeriod.*` → `tf`, `close(symbol=…)` → `sym`, `AddLabel/AddChartBubble/AddCloud/AssignPriceColor/SetDefaultColor/SetPaintingStrategy/Alert` → ignored lines listed by number (PineBox's idiom), `AddOrder` → §5.8, everything else refuses at its token. Corpus `tests/fixtures/thinkscript/` (24 scripts) is the yardstick; `thinkscript.corpus.test.js` pins it.
- **One "Import" tab** replaces the Pine tab: dialect auto-detected (`//@version`/`indicator(` · `declare`/`def `/`plot ` · Worden letters), with an override chip. Every import ends in the same `source` string and the same Save door.

### 5.4 The editor
CodeMirror 6, bundled (the CSP forbids CDNs): `@codemirror/state · view · language · autocomplete · lint · commands`, `@lezer/highlight`; four `StreamLanguage` tokenizers (formula · Pine · thinkScript · PCF). Completions are a **derived** source over the closed table (name, sentence, arity, lookback) + member inputs + `let` names. Diagnostics map the refusal `{guard, line, column, token, message}` 1:1 onto CM lint marks — no sentence of the editor's own. A live preview pane renders the draft definition on the current symbol through the same engine (the `ChartPane` universal component), debounced 250 ms like `FormulaField`. Keyboard shortcuts stay inside the sheet (the 8/10 leak fix is a rail). The `FormulaField` textarea remains the fallback when the editor bundle fails to load.

### 5.5 Scans — beyond Pine Screener
- **Continuous sweep** (`scan_evaluator.run_sweep(mode='live')`, every 5 min inside the regular session, sequential, off the request path): evaluates every definition whose `cadence_ceiling` permits (bars-only trees, and trees whose scalars the live tier recomputes — the manifest's `cadence` per scalar, never a list here) on daily bars **plus the forming bar** from the 30 s snapshot (`close = last_price`, `volume = today_vol`; `open/high/low` the day `massive.py` widens — until then a tree reading them on bar[0] is `not_computable` for live, stated). Results go to **`scan_hits_live`**, a side table with one writer, `as_of` = the tick, LEFT-JOIN overlaid on the read path exactly as `screener_live` is; a cycle that cannot finish inside 5 min skips with `skipped_reason`. Budget rail: the nightly compute measured 42.4 s; the live cycle asserts its own wall-clock against the interval.
- **Intraday timeframes**: the bars store holds intraday bars only for tickers already charted. The worker gains a **prewarm ring** (5m/15m/60m) ordered by demand — symbols named by member lists and definitions first — sized from the measured per-ticker delta latency and the breaker; the live sweep evaluates intraday-TF definitions over the covered subset and **states coverage** (`evaluated / answered / dropped / not_computable / withheld`). ⛔ Universe-wide intraday is gated on that measured number, never assumed.
- **On-demand run** `POST /api/scans/run {def_id, symbols | list_id, tf}` (≤ 500 symbols, live bars, rate-limited per member) for "run now on my list".
- **`/screener` authoring door** ("New scan" opens `BuilderSheet` kind=`scan` in place); **MTF conditions** via `tf`; **value columns** for the member's own hits (stored on the hit row at evaluation time); alerts re-read the **current** definition version (state this against TV's frozen snapshot).
- E-7 numbers stay the owner's; `#12` multi-period fundamentals stays its own data lane.

### 5.6 Drawings (chart lane)
Two kinds, both derived from series so the engine stays one-number-per-bar:
1. **Series-styled**: `plotshape(cond, shape, where)`, `plotchar`, `bgcolor(cond, token)`, `fill(plotA, plotB)`, `hline(level)`, `label(cond, text)` — declared on `plots[]`/`draws[]`, rendered by the binder with LWC 5.2 markers, price lines and fills.
2. **Objects**: `line(x1,y1,x2,y2)`, `box(x1,y1,x2,y2)` computed by a bounded emitter from series values (pivot boxes, session ranges), capped per definition (500 lines / 500 boxes / 500 labels — TV's own caps), **JS only**, badged `chart-only`; a scan on an object-drawing definition refuses by name.

### 5.7 Programs (chart lane)
`kind: 'program'` definitions: arrays (`array.new/push/get/set/size/sum/avg/max/min`), `for` over literal or collection bounds, records (UDTs), `while` refused; a **step budget** (`MAX_STEPS`) and the node budget both enforced; JS only; badged `chart-only`; the repaint verdict is `repaints` unless the program is proven backward-looking by the same reach analysis (else it says so). The scan lane refuses `program` by name — the table stays total so an unattended sweep always terminates.

### 5.8 Strategies
`kind: 'strategy'`: `entry`, `exit` (0/1 trees), `stop`/`target`/`trail` rules, `size` per the firm's sizing formula (risk % = position % × stop distance %), fees; runs through `backtest_engine.simulate` (extended for stops/targets/trailing), stats from `backtest_stats`, rendered as equity curve + trade list + the horizon study beside it. Pine `strategy.entry/exit/close` and ToS `AddOrder` translate into these fields. The E-6 record extends to strategies (forward-only, member-independent).

### 5.9 Evidence and sharing
- **Evidence tab** in the builder and on every scan: `POST /api/screener/backtest` (job) rendered with `HorizonResult` strategy vs baseline, coverage, method, window; winsorised means and the same-day-move control from `candle_backtest` added to `screener/backtest.py` if not already present; beside it the E-6 forward record. The naked-hit-rate refusal is a rail.
- **Sharing**: `POST /api/user-definitions/{id}/share` → token; the recipient installs a **copy** (`origin_def_hash`, `author_id`, `origin_version` kept; the record is read by hash so it travels); export/import JSON of the canonical document, byte-identical round trip. §12's marketplace amendment is the owner's wording; nothing here sells.
- **Version history** UI over the store's `history`.

### 5.10 Hygiene (W0)
Colour change applied live (isolate chip vs line first) · legend-compact settings door · `AST_DEFS` retired or made the install path (one truth) · concierge → `claude-opus-5` with a `cost_guard` entry · ~~`test_definition_record.py` red~~ (stale, see §2) · "Premium" badge on a member's own formula · ~~the 8 zero-returning starters~~ **MEASURED 2026-08-26 (W0.7): on PROD it is 1 of 22, not 8.** The "8" was a real measurement of the LOCAL dev snapshot — 7 of them gate on columns that are 0% filled locally and 67-98% filled on prod (they return 111/255/155/12/153/357/44 rows there). The one genuine zero is `starter_gap_movers` · `computeVWAP` ET sessions.

## 6. Waves and file ownership (parallel where disjoint)

| Wave | Owns (nobody else edits) | Depends on |
|---|---|---|
| W0 hygiene | `StockChart.jsx` legend/colour paths, `definition_concierge.py` model, `cost_guard`, `test_definition_record.py` | — |
| W1a editor | new `builder/editor/*`, `package.json` (+codemirror), `FormulaField.jsx` integration | — |
| W1b shape v2 | `defSchema.js`, `BuilderSheet.jsx` build/save, `binder.js` plots, `user_definitions.py` validation, `ast_interpret.py` multi-tree entry | — |
| W2a clock/vwap/bounded fns | `closedTable.json`, `interpret.js`, `ast_interpret.py`, `ast_table.py`, `lint.js`/`ast_lint.py` lookback grammar, conformance fixtures | — (serialise with W2b on the same files) |
| W2b `tf`/`sym` nodes | `parse.js` NODE_TYPES, `interpret.js`, `ast_interpret.py`, resampler owner, `benchmarks` section, `scan_definition.py` | W2a merged |
| W3 thinkScript | new `engine/ast/thinkscript.js` + tests, `BuilderSheet` Import tab, `tests/fixtures/thinkscript/` | corpus collected; `tf`/`sym` for the aggregation bucket |
| W3b Pine push | `pine.js`, corpus snapshots, `tests/fixtures/pine_community/` | W2a/W2b for the manifest names |
| W4a screener door + run-now | `Screener.jsx`, `ScreensManager.jsx`, new `routers/scan_run.py` | — |
| W4b continuous sweep | `scan_evaluator.py` live mode, new `scan_store` live table, `main.py` scheduler registration, worker prewarm ring | — |
| W4c MTF scans + value columns | `scan_evaluator.py` (after W4b), `scan_store.py` hit values | W2b, W4b |
| W5a evidence | new `builder/EvidenceTab.jsx`, `ScanResults.jsx`, `screener/backtest.py` controls | — |
| W5b sharing/versions | `user_definitions.py` + router share routes, new `SharePanel.jsx`, `useUserDefinitions.js` | W1b |
| W6 drawings | `binder.js` drawing renderers, `defSchema.js` `draws[]`, `pine.js` plotshape/bgcolor/fill map, new `engine/drawings/*` | W1b |
| W7 programs | new `engine/program/*` (JS interpreter + budget), `defSchema` kind, `pine.js` arrays/loops map | W1b |
| W8 strategies | `backtest_engine.py` extension, `strategy_templates.py`, new `routers/strategies.py`, `pine.js` `strategy.*` map, `thinkscript.js` `AddOrder` map, `StrategyPanel.jsx` | W5a, W3 |

Parallel wave 1 = W0 · W1a · W1b · W2a · W3 (post-corpus) · W4a · W4b · W5a. Parallel wave 2 = W2b · W3b · W4c · W5b · W6 · W7. Wave 3 = W8 and the closing acceptance (A1–A12). Each task commits with the pathspec form (`git commit -m … -- <paths>`) because the git index is shared.

## 7. Verification

- Every task: TDD; the gate named per task; review + live-surface audit of a real payload; then ship (`push origin feat/indicator-endzone:master` after fetch → merge → re-verify; never force).
- Corpus snapshots (Pine ×2, thinkScript, PCF) pinned **in both directions**; regenerated by measuring, never by hand.
- Conformance harness (`tools/ast_conformance.py`) extended with fixtures for every new node/section; both lanes at 1e-9.
- Mutation checks aimed at load-bearing gates only: the closed-bar semantics of `tf` (lookahead must red the fixture), the `sym` whitelist refusal, the live sweep's wall-clock rail, the naked-hit-rate refusal, the step budget.
- Pixel-parity harness: a case per drawing kind and per plot style; a case that reads 0 px both ways has measured nothing.
- Live audits per wave on production with a real member session: the four surfaces on one hash; a live-cycle receipt with non-zero `answered`; a chart with three plots recoloured live.

## 8. Risks, with the mitigation named

- **Same core files on two waves** (`interpret.js`/`ast_interpret.py`): W2a merges before W2b starts; everyone else imports, never edits them.
- **`alert_replay --check` grid is frozen**: no wave grows `INDICATOR_FUNCS`; user trees stay in `USER_FUNCS`.
- **Provider storm from intraday prewarm**: ring sized by measured latency; breaker-aware; receipts say what was not reached.
- **A second authority**: counts, vocabularies, benchmarks, TF maps all derived from one declaration each.
- **`pine.js` heredoc corruption**: edits through the Edit tool only.
- **Frontend suite ~10 min**: run when `app/src` changes and once per wave; `--pool=threads` is broken in this repo (forks only).
- **Hidden-tab rAF stalls** in the automation browser: layout claims verified with real input or stated as unverifiable.

## 9. Out of scope (this program)

`#12` multi-period fundamentals (own data lane) · mobile-specific editor · marketplace payments/pricing (E-7 numbers, §12 wording are the owner's) · custom bar types · auto-trading.

## 10. Open owner items (non-blocking, surfaced at the wave that touches them)

E-7 toolkit numbers (§8.4) · §12 sharing amendment wording · "everything is paid" vs the 16 natives' `tier: 'free'` badge · the compact-legend trade (settings door) · `ichimoku.chikou`'s badge · intraday universe coverage target once the prewarm number is measured.

### A4 amended 2026-08-27 — the ceiling is 8, and 15 was unreachable by construction

⛔ **The corpus is already AT its ceiling.** Regenerating moved nothing: 8 of 24
translate today (`02 03 04 11 12 13 14 20`), and every one carries
`perOutputRefusals === {}` — **no refused column anywhere** — now a permanent rail,
because a script that translates its chrome and refuses its subject would otherwise
count as a gain.

**The 24 are partitioned TOTAL and DISJOINT, and asserted, so a script leaving one
class and joining none goes red:**

| class | n | meaning |
|---|---|---|
| translating | **8** | every column computes |
| DOCS | **9** | blocked on vendor documentation that does not exist |
| DESIGN | **4** | deferred by design (`tf`/`sym`, `:account`, session boundaries) |
| RULED | **3** | refusals this door is **right** to make, permanently |

⭐ **"Reachable without new vendor documentation" is ZERO — computed by subtraction,
not claimed:** `FILES.filter(f => !translating && !DESIGN && !DOCS && !RULED)` → `[]`.
**Nothing is waiting on ordinary work.**

⛔ **The RULED class is not a gap and must never be counted as one.** `01`
(SuperTrend) and `10` (Laguerre) are **seedless self-recursions**; `17` is a **2-bar
self-lag**. Translating them would mean inventing a seed the engine cannot prove —
the silent-mistranslation failure this whole lane exists to prevent. Their refusals
already name the fix.

**Arithmetic, both forms pinned in the rail so the gap between the wish and the
measurement lives in assertions:** `24 − 9 = 15` and `12 + 3 = 15`. Reaching 15 needs
either a DESIGN-deferred script to move **or one of three correct refusals reversed**.

⚠️ **Four scripts are blocked by documentation ALONE** — `05` (BollingerBands + RSI),
`07` (TTM_Squeeze), `16` (RSI), `19` (MovAvgExponential). Each is asserted to actually
*call* its blocker, and each blocker to be a registered `TS_DOC_BLOCKED` entry, so the
set cannot drift into "things we did not get to."

⭐ **`BarNumber` is the highest-leverage single unblock** — it touches `17`, `23` and
`24`, and **one published example showing the number on a known bar** would clear it;
`barindex` is already declared and ready. ⚠️ **`TTM_Squeeze` is proprietary and may
never unblock.**

⛔ **A7's "19/24 after `tf`/`sym`" inherits the same defect and has NOT been
re-measured.** It was written from the same aspiration; treat it as unverified until
someone derives it the way A4 now is.

### A5 amended 2026-08-27 — 66/71 was not reachable; the measured ceiling is 65

**The 71 spellings are read out of `pcf.vocabulary.test.js` itself**, and the partition is
asserted **total and disjoint**, so a spelling leaving one class and joining none goes red:

| class | n | |
|---|---|---|
| **reading** (computes end to end) | **63** | shipped |
| **permanent refusals** | **6** | A5 named five |
| **reachable elsewhere** | **2** | `FAVGC20` / `HAVGC20` — need two new MA entries, outside W2a.7 |

⇒ **measured ceiling 65/71; 63 shipped.**

⛔ **The sixth refusal A5 did not account for is `OBV20`** — the SMA of a cumulative running
total. That is the exact ground `_functions_excluded.obv` has refused since this table
opened, and ⭐ **TC2000's own page calls the level "statistically irrelevant."** It is a
refusal we are **right** to make, on grounds the vendor states themselves — not a gap.

⚠️ **"Read" means computes, not parses.** Every claimed spelling is asserted to compute end
to end. A4 moved 4 → 8 and the lane then **refused three of those gains** because they
translated their chrome and left their subject as a refused column; the same standard is
now pinned here.

**This is the second acceptance number written before it was measured** (see the A4
amendment above: 15/24 against a real ceiling of 8). ⇒ **treat every remaining unmeasured
acceptance figure as provisional until a task derives it** — A7's "19/24 after `tf`/`sym`"
is already flagged, and A2/A3's Pine numbers have not been re-derived either.
