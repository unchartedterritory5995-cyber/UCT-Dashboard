# UCT Indicators — Current Capability Inventory

**Audit date:** 2026-10-13
**Baseline:** master = production `84164aee3d`
**Branch:** `audit/indicators-competitive-2026-10-13`

**How to read this.** This inventory records what is verified in code at the production SHA. Where it says "verified", the item was also executed — by a scratch probe on synthetic bars, an existing test run, or the one browser session. Detailed tables with `path:line` evidence are in the workstream appendices (`workstreams/WS1…WS8`). This document is the consolidated catalogue.

## Shipped vs local vs dark

These categories are kept separate throughout.

| State | Meaning | Examples |
|---|---|---|
| **Shipped (member)** | In production code and reachable by paid members. Flag state is from `docs/feature_flags.json` and code defaults; the live environment was not read | 55 chart built-ins; formula builder; Pine/thinkScript/PCF import (host lane); Pine drawing objects (member pane); alerts on user formulas; scans; share links and public library |
| **Shipped (admin/cohort)** | In production, gated server-side | UCT Agent (admin-only, `uct_agent.py:63`); Create Indicator `/converse` (admin or `CREATE_INDICATOR_COHORT_ENABLED` cohort; the ledger says *pending*, so admin-only in practice) |
| **Dark in production** | In production code, switched off | Pine per-bar runtime VM (3 switches); lower-timeframe `request.security` (`VITE_PINE_LOWER_TF_ENABLED`) |
| **Ledger unclear** | Ledger "armed" but baked value "undefined" — must be verified live | `VITE_INDICATOR_TEMPLATES_ENABLED`, `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED` |
| **Local, unreleased** | Uncommitted or unmerged work in another worktree | `C:/w/rpw`: +165 lines in `thinkscript.js` (thinkScript presentation, "UIE-1"). Incomplete; never emitted. Not touched by this audit (read-only `git diff`) |

## A. Built-in indicator library [WS1]

**Count:** 55 user-facing chart built-ins (53 registry definitions in `engine/nativeRegistry.js` + Volume pane + visible-range Volume Profile). Full per-indicator table with inputs, defaults, outputs, placement and timeframe limits: WS1 §1.3.

| Status (brief's scale) | Count | Members |
|---|---|---|
| 1. Fully implemented and working | 13 | RSI, MACD, Bollinger, ATR, Parabolic SAR, MFI, CCI, Williams %R, ADX/DMI, OBV, Donchian, Data Series, Volume |
| 2. Working with limitations | 41 | Session VWAP (intraday 1/5/15/30/60 only; P1-4), Stochastic (fast-only on server), Anchored VWAP (P1-5), ATR Bands, Moving Average (9 types; alerts only for close SMA/EMA), Dollar Volume, RS Line (server, premium; SPY/QQQ/IWM), Volume Profile (approximate, untested), and 33 "Tier 1" studies (chart-only: no alerts or screener). Tier 1 includes SuperTrend, Aroon, Vortex, Choppiness, StochRSI, PPO, ROC, Momentum, TSI, CMO, TRIX, Awesome, Ultimate, BOP, Bull/Bear Power, Keltner, Envelope, %B, BandWidth, ATR%, ADR%, HV, Squeeze, RVOL, A/D, CMF, Chaikin Osc, Force Index, PVT, Up/Down Volume, % From MA, 52-Week, StdDev |
| 3. In UI but partially functional | 1 | **Ichimoku**: cloud not projected forward, no fill (P0-4) |
| 4. Defined in code, not user-accessible | 0 chart indicators | 18 dormant Market-Indicator series (registry `status`) |
| 5. Documented only | 0 | — |

**By category** (53 registry definitions):

| Category | Count |
|---|---|
| Momentum | 16 |
| Volatility | 12 |
| Volume/VWAP | 12 |
| Trend | 8 |
| Relative strength | 3 |
| Statistical | 1 |
| Data | 1 |

Breadth is delivered as **data series**, not indicator definitions.

**UCT-specific studies:**
- **Studies:** ADR %, % From MA, 52-Week High/Low, Dollar Volume, Relative Volume, RS Line.
- **Proprietary data series:** 45 UCT breadth symbols, 193 published Market-Indicator series, 237 economic series, point-in-time fundamentals.

**Alertable natives:** 14 indicators, 32 alert addresses (`api/services/alert_series.py:177-212`).

**Calculation verification:**
- **Method:** independent textbook implementations compared on 600 daily plus 900 five-minute synthetic bars (with a DST crossing).
- **Matches** (≤1.6e-13): SMA, EMA (SMA-seeded, like Pine), RSI (Wilder), Bollinger (population SD, like TradingView), MACD, session VWAP (ET-day anchor), Stochastic, OBV.
- **ATR:** an intentional, documented 1-bar seed difference from Pine; `atrPine` is exact.
- **Historical Volatility:** sample SD with √252, versus TradingView's √365 with population SD. Intentional and documented; TradingView reads about 23% higher.
- **Stochastic on a flat range:** UCT returns 50, Pine returns na.

**Engine properties (verified):**

| Property | Result |
|---|---|
| JS ↔ Python parity | ≤1.05e-11 |
| Lookahead | none in 52 natives × 4 truncation cuts, except Chikou (declared) |
| MTF daily → 5m | completed-bar semantics, zero lookahead |
| Determinism | byte-identical runs |
| Recalculation | **not incremental** (full recompute, memoised by bars identity) |
| Missing data | the NaN-hole policy differs by lane (P3) |

## B. Formula language and shared engine [WS4, WS1]

**Architecture:**
- One manifest (`engine/ast/closedTable.json`) feeds:
  - the browser parser (`parse.js`, jsep);
  - the browser interpreter (`interpret.js`);
  - the Python interpreter (`api/services/ast_interpret.py`), which reads the same JSON and never parses.
- One type authority: `outputType.js` / `scan_definition.is_boolean_tree`.
- One permission gate: `evaluability.js:343`.

**Vocabulary:**
- 79 functions:
  - moving averages: 5
  - momentum: 11
  - trend: 8
  - volatility: 8
  - volume/cumulative: 8
  - window statistics: 10
  - signals: 8
  - math: 21
- Plus 8 call expansions, 16 built-in call trees, 138 scalars and 31 clock names.
- 19 names are excluded, each with a stated reason.

**Verified capability matrix** (146 formulas tried through the real authoring door; 98 admitted; 97/98 agree across browser and Python):

| Capability | Status |
|---|---|
| OHLCV, clock operands, arithmetic, comparisons, `&&` `\|\|` `!`, ternary | ✅ |
| `crossOver` / `crossUnder`, `x[n]`, `barsAgo`, window aggregations | ✅ |
| sma/ema/wma/rma/hma/vwma, stats, rsi/macd/atr/adx/stoch/cci/mfi/ichimoku | ✅ |
| `accum` recurrence (bounded state), nesting, `let` bindings, multiple plots | ✅ |
| `tf(x,'W'\|'M')` (resampled from chart bars), `sym('SPY', …)` (benchmark roster) | ✅ (limited) |
| Fundamentals | ✅ screens only (refused on chart, paint, alert) |
| Lengths as parameters (`sma(close, len)`) | ❌ P1-9 |
| `crossOver(close, vwap())` | ❌ budget 961 > 960 (P1-10) |
| `tf(close,'D')` on intraday, intraday MTF | ❌ P1-11 |
| Reference another indicator's output; user functions; building blocks | ❌ P1-12 |
| Loops, arrays, general `var` state | ❌ (Pine runtime VM only, dark) |
| `hl2/hlc3/ohlc4`, `iff`, `%`, `**`, supertrend, obv, alma, dema, tema, sar, variance, zscore | ❌ P2-11 |
| Economic operands in formulas | ❌ none exist |

**Consumers sharing the tree:**

| Consumer | Shares the formula tree? | Notes |
|---|---|---|
| Chart indicator | ✅ | |
| Bar/candle colour, background, markers (paints) | ✅ | `binder.syncPaints`, `barColours.js`, `paintPrimitive.js` |
| Alerts on user formulas (server) | ✅ | `alert_user_series.py`; cross-lane check at arm time |
| Scans / screener (definition scans) | ✅ | `scan_definition.py` |
| Info values (header/legend values) | ✅ | `infoValues.js` |
| Watchlist / screener **columns** | ❌ | native definitions only (`serverCompute`) |
| Screener typed criteria and NL screens | ❌ | a **second** grammar (`api/services/screener/grammar.py`, `nl_compile.py`) |
| Historical market studies | partial | Market Intelligence event studies (`api/services/market_intel/event_study.py`) run on breadth and price conditions, not on user formulas (not audited in depth) |

**Limits** (identical in JS and Python):
- 128 nodes, which allows about 30–40 distinct terms;
- a lookback cap of 550, or the session cap, whichever is larger;
- 8 base-series reads.

The server checks the budget on every evaluation (`ast_interpret.py:5320`). [WS8]

**Owner's two examples:**
1. "Green candles when 9 EMA > 20 EMA and volume > 20-day average":
   - expressed as `ema(close,9) > ema(close,20) && volume > sma(volume,20)`;
   - renderable as a hidden condition + `barcolor` paint;
   - validated in all lanes.
2. "Highlight RSI > 70 and price above a rising 50-day MA":
   - expressed as `rsi(close,14) > 70 && close > sma(close,50) && rising(sma(close,50),1)`;
   - renderable as a hidden condition + `bgcolor` paint;
   - validated in all lanes.

Both render paths are traced in code but were not clicked in a browser. "20-day" holds only on a daily chart (P1-11). [WS4]

## C. Rendering [WS2]

| Capability | Status |
|---|---|
| Lines, multiple lines, step lines, histograms, side-by-side columns, dots | ✅ |
| Area (static colour) | ✅. Per-bar colour on area is **dropped** (P2-6) |
| Horizontal levels / hlines (incl. dashed) | ✅ native. Pine/thinkScript import hlines are **dropped on the chart door** (P1-17, P1-14) |
| Per-bar colour on line/histogram (sign/column/palette/gradient/packed) | ✅ |
| Bar/candle colouring (`barcolor`) | ✅ on OHLC chart types; disappears silently on Line/Area chart types (P3) |
| Background colouring (`bgcolor`) | ✅ |
| Fill between plots, conditional fills | ✅. Fill between two hlines ❌ (disclosed) |
| Pine lines/labels/boxes/linefills (price pane) | ✅. In an own-pane script they use **price-pane coordinates** (P1-2) |
| Tables (merge, formatting, 9 anchors, phone fit) | ✅ (`textContent`, XSS-safe) |
| Markers / shapes / arrows | ⚠️ 4 native shapes; spurious 0/1 dots (P1-3); two-tone colour only; `plotarrow` drawn as a line |
| Last-value labels, price-scale labels | ✅. "Last value horizontal" style ❌ (P0-5) |
| Precision / format | ⚠️ native yes; Pine `precision/format` not carried (disclosed) |
| Transparency, line widths, dashed/dotted | ✅ native. Imported `linewidth` → 1 (P1-17) |
| Visibility toggles | ✅ per instance. Global hide leaks layers (P2-5). No per-output hide |
| Plot ordering / z-order | ⚠️ list only; draw order fixed by DOM; in-pane reorder does not change drawing (P2-6) |
| Panes: own pane, merge, move to price, above/below price via order, resize, reorder | ✅. Pane-above-price writer exists with no UI; no numeric size/reset |
| Legends: chips, values, menu (Hide, Move, Settings, Info-value, Modify, Edit formula, Duplicate, Copy, Alerts, About, Remove) | ✅ |
| Polylines, `plot.style_cross`, `histbase`, plot offset | ❌ absent (offset shown "Coming soon") |

## D. Lifecycle and persistence [WS3]

| Step | Built-in | User-defined | Agent (admin) | Notes |
|---|---|---|---|---|
| Create / add | ✅ 2 clicks; Ctrl+I | ✅ builder, import, starters | ✅ `indicator.draft` | |
| Configure | ✅ 3 clicks + typing | ✅ declared inputs only (no length params) | ✅ | |
| Preview | ✅ | ✅ live preview, 4-bar probe at authoring | ✅ | |
| Apply | ✅ | ✅ | ✅ approval card | |
| Edit (correct instance) | ✅ exact `instanceId` targeting | ✅ revision check (409), `base_version` | ✅ refuses ambiguity | Agent edit-save leaves chart instance values stale (P2) |
| Save / reopen / reload | ✅ round-trip byte-identical | ✅ append-only store, history | ⚠️ drafts tab-scoped, evicted silently | Instances whose definition no longer resolves vanish silently (P1-7) |
| Duplicate | ✅ copies config | ✅ | — | "+ Add another" uses defaults (inconsistent) |
| Share | n/a | ✅ link (128-bit token, version-pinned), opt-in public library | — | Re-pin impossible (P2-3); `author_id` exposure (P2-1) |
| Delete | ✅ chip removes one instance | ✅ soft delete, share reports "gone" | — | **Toggle-off doors delete all instances** (P0-6); deleted definitions keep drawing in open tabs (P2-2) |
| Undo | ❌ drawings only | ❌ | ✅ in-memory, 20 steps | P1-8 |
| Multi-chart | ⚠️ no apply-to-all, no sync; per-chart scope is dead code | | | P2-4 |
| Templates | ⚠️ flag state unclear | | | |

**Persistence location:**
- Chart instance settings live in the `chart_settings` preference blob.
- With `WORKSPACE_DOC_STORE_ENABLED`, a workspace document store is added, with Version History. The ledger says armed since 09-27; not verified live. Without it, writes are last-write-wins across tabs.
- User definitions are stored server-side in `user_definitions`.

## E. Import doors [WS5, WS6]

Summary only. The standalone report is `06-CROSS-PLATFORM-MIGRATION.md`.

| Door | Pipeline | Shipped state |
|---|---|---|
| Pine Script v3–v6 | Lenient "screen" lane (paste box verdict) **and** strict "host" lane (chart door). Both save a UCT formula tree; Pine source not stored | Host lane + drawing objects: members. Runtime VM: dark |
| thinkScript | Own lexer/parser → per-plot canonical tree, 35 cited function mappings; saved as native formula text | Members |
| TC2000 PCF | Translated to the tree; PCF text stored as source and re-read on load | Members |
| Screenshot (vision) | One forced tool call → candidate trees → full `_validate` → candidates only, nothing stored | Paid + `INDICATOR_VISION_ENABLED` (ledger armed) + 10/h/pod |
| Natural language (`/propose`) | Vocabulary check → ≤2 model calls → `_validate`; $0.75/day/user | Paid, 40/h |
| Natural language (`/converse`, Create Indicator) | Patch → client applies through the same door | Admin / cohort |
| Pine libraries | Owner-curated store, exact versions, licence shown | Members (read needs login only) |
| Starter library | 8 firm setups as native definitions | Members |

## F. Performance, reliability, security [WS8]

**Performance:**
- Formulas run interpreted on the main thread, with no incremental update.
- The micro-benchmark (5,000 synthetic bars, shared CPU, ratios only) found:
  - parsing 10 formulas costs about 4% of a cold evaluation;
  - a one-bar tick costs 0.95× a cold recompute;
  - a budget-cap worst case costs 2.7–3.1×.

**Runtime VM limits:**
- 24 named limits: 200k instructions per bar, 10k while passes, call depth 64, 32,768 bars, 64 MiB, 5 s.
- A 20 s worker watchdog, plus a server kill list.
- Runaway loops stop in 14–39 ms. String growth is stopped only by V8 (P3, dark lane).

**Security:**
- No eval anywhere; every read is user-scoped.
- Admin and dark gates are enforced server-side per call.
- Telemetry is allow-listed and scalar-only.
- Colour allow-list; `textContent` tables.
- Hardening lows: P3 list.

**Tests:**
- About 615 frontend indicator test files:
  - engine 27, ast 313, runtime 118, builder 104, pane 6, legend 5, chart 40.
  - By kind: about 215 evaluator, 198 import compatibility, 67 rendering, 52 UI, 40 performance/limits, 21 pane, 12 parser.
- 64 core backend files.
- **Well tested:** evaluator semantics, cross-lane parity, runtime limits, refusal naming, colour trust, auth per route.
- **Partial:** main-thread performance (`.measure` tests are ungated), worker lifecycle, share UI, rate limits.
- **Untested:**
  - many charts × many formulas under live ticks;
  - long-session memory;
  - runtime string accounting;
  - prompt bounds;
  - telemetry rate limits;
  - rendering of G1–G6 (WS2);
  - value-checked MTF import (WS6).
