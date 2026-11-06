# UCT Relative Strength — design plan v4 (final, post-audit)

**Status:** 🟢 FINAL for implementation (2026-11-06). Owner accepted every v3 recommendation (D1–D12) on 2026-11-05 and asked for a final audit before build; v4 is v3 with the audit's findings folded in. Three accepted decisions were amended by the audit and are marked **[amended]** in §16.
**Base:** `origin/master` `7f6dd3714d` (Phase 1 branch `feat/uct-rs-phase1`, worktree `C:/Users/pgosz/uct-worktrees/rs-phase1`). **Plan branch:** `docs/uct-rs-indicator`, PR #875.
**Owner asks, in order:** elite RS indicator beyond MarketSurge / Deepvue / TradingView; combine with Chartmaster's library; reach 99/100; then "far too much emphasis on Chartmaster posts" — spend real time on the knowledge and usefulness of RS indicators and put a huge emphasis on user friendliness, customization and the Uncharted Territory brand; be extremely detailed with reliability from research and observation; run a final audit and begin.

**How this document is sourced.** Research claims cite `docs/research/relative-strength/` by file and section (`01 §2` = `01-methodologies.md` §2), each fact tagged [V] verified in the primary source, [S] secondary, [U] unverified. Code claims cite a file on master and were read, not recalled; the independent audit re-read every one with line numbers. Nothing tagged [S] or [U] is member-facing copy.

**What the audit changed (v3 → v4).** Fifteen engineering claims were wrong or unproven and are corrected below; the biggest: presets are a generic preset-picker in the settings dialog, not an input and not additive templates; the server's payload needs a real client path (envelope cache, a `scalarsFor` read, `rev` gating, a `readout` schema), not a pass-through; markers are limited to the engine's four shapes with intensity carried by size and colour, and the three-line explanation lives on the legend chip and readout because markers have no hover; per-interval visibility is per instance and lives in the Chart Data panel, so the server carries the intraday rule in the data; placement is not an input; the custom benchmark is a `string` input so `symbol` stays reserved; alerts need a two-symbol series lane and move to Phase 2b; the rating is a Phase 2a deliverable so Phase 1's first turn-on has no rating on the chart; the indicator-templates flag is a build-time variable. Eleven internal inconsistencies were resolved (one before-price tolerance, one red-day unit, one band scheme, one preset mechanism). Ten pieces of [S]/[U] research were removed from member copy. Phase 1 was re-scoped to about three weeks and Phase 2 split into 2a and 2b.

---

## 0. The one-paragraph version

A member types "RS" in the indicator library and turns on **UCT Relative Strength**. The RS line appears under the price bars against the S&P 500, the way IBD draws it, blue, with a dashed 21-day moving average, small blue dots where the line makes a 52-week high and a larger gold dot where it does so while price is still below its own high. The legend chip reads `UCT RS · SPY`. A **Preset** picker at the top of the settings dialog offers seven ways to read the same line, each named for its method and origin; Simple shows the five settings members change, Advanced the rest. From Phase 2a the chip also carries the 1–99 RS Rating (IBD-style and UCT fast), the Leadership readout explains every number in three lines (what, origin, evidence), the Stress test preset marks RS highs on red market days, and the same columns run in the screener. From Phase 2b every evidence line is our own nightly backtest number with sample size and dates, alerts fire on RS events, and the red-day leaders post to Discord. Phases 3 and 4 add the on-price overlay, custom benchmark, the Rotation, Quality and Volatility-adjusted presets, the rotation view, the tour and Learn links.

## 1. The field (research summary; full synthesis in `00-synthesis.md`)

1. **Three primitives cover every method** (01 §Design implications): a ratio line, a trend-of-ratio measure and a momentum-of-ratio measure. Presets over the primitives cover the field.
2. **Persistence is real at 6–12 months** (03 §2–3 [V]): 8.3 %/yr long-short 1927–2013, Sharpe 0.50, positive in 81 % of rolling years; the long side carries 73.6 %. Dorsey Wright's point-in-time RS buy signals: 13.9 %/yr vs 9.3 %, 1990–2015.
3. **The blue dot has no published hit rate** (03 §1, §4 [V]). Bulkowski, 15,763 patterns: RS direction before a breakout barely matters; RS rising after it does (+41 % vs +22 %).
4. **Crashes are the signature failure** (03 §2 [V]): the 15 worst momentum months all followed a negative two-year market return, 14 of them in months the market rose (1932, 2001, 2009).
5. **The benchmark changes the answer** (03 §5 [V]): 78 % of S&P 500 stocks lagged the cap-weighted index over 2023–24; Dorsey Wright benchmarks to equal-weight; StockCharts resolves sector and industry automatically.
6. **IBD's rating is approximated, never reproduced** (01 §1 [V]); one replica author reports ±3–5 points [S]. We will measure our own difference and publish it.
7. **Thresholds are heuristics** (03 §1 [V]): IBD says 80, 85 and 90 in different articles; the "87 average" has no published sample.
8. **Members are pre-trained on three conventions** (02 §2c [V]): the RS line under price, Inputs / Style / Visibility tabs, two dot intensities.
9. **Ten settings members change** (02 §2b): benchmark, placement, MA on the line, lookback, dot toggles and colours, line colour mode, rating thresholds, label position and a phone mode, interval visibility, save as default.
10. **Dot history matters** (02 §2c): the most-liked TradingView clones keep every dot; a clone author reports MarketSurge shows only the latest [U, §17.4].
11. **Templates must not destroy** (02 §2c [V]).
12. **RS vs RSI is the first confusion to defuse** (04 §6 [V]); a question and a picture explain RS best (04 §a–d).

## 2. The member

### 2.1 Four personas
| Persona | Arrives from | Expects | Fails if |
|---|---|---|---|
| Curriculum learner | Study, Desk videos (Manrav video 59; the UCT workshops) | The 21-EMA phase colouring they were taught; Learn links; plain words | A raw ratio with four decimals and no explanation |
| IBD / MarketSurge migrant | MarketSurge, Deepvue | RS line under price, blue dot, a rating that roughly agrees; weekly first-class | A rating ten points off with no explanation; no weekly dots |
| TradingView power user | ChillLax, Fred6724 scripts; Pine | Inputs / Style / Visibility; every knob; dot history; custom benchmark; a saveable setup | A fixed benchmark menu; templates that wipe their chart |
| Phone-first member | The mobile chart shell | A compact readout; big tap targets; no text markers | Dots with text at 390 px; an unreadable pane |

### 2.2 Jobs to be done
Is it beating the market or riding it? Is it a leader now? Did strength show before price? Does it hold up on bad days? Versus the right benchmark? In a regime where leaders keep leading? Which names in my list lead? What do I do with this (learn, never a verdict)?

### 2.3 Design principles
1. Useful on the first click with zero settings. 2. Innovate on explanation, not chrome (platform spec §1.5). 3. Three lines on everything: what, origin, evidence. 4. Never invent a value: NaN, never 0 (the `rs_weighted_return` rule). 5. One answer everywhere: chart, screener, alert, Discord, lists read the same columns. 6. Match the pros where a number has a meaning; label approximations. 7. Customization layered, not hidden: Advanced dims, never removes (the platform's `activeWhen` rule). 8. Nothing destructive.

## 3. The brand (`docs/brand-design-system.md` §1–3, §16, §18, §22; `designTokens.js`; platform spec §7)

- **Name.** UCT Relative Strength, short name UCT RS; presets named for method and originator; the UCT one is Stress test (UCT).
- **Voice.** Declarative, no exclamation marks, no emoji anywhere including Discord, no "buy"/"sell", no "guarantee". Banned: elite, powerful, unlock alpha, institutional accumulation, leading indicator, crystal ball. The tagline appears once, unparaphrased, on the last tour card.
- **Palette budget (platform §7, machine-checkable):** ≤ 2 hues + 1 neutral per indicator, gold rationed to ≤ 1 gold element per chart, shape first and colour second. Classic therefore draws the line in `info` blue (IBD's "squiggly blue line"), the MA in `neutral`, plain new-high dots in `info` (small), and the one gold element is the large `premium` dot for an RS high before price. The Phase preset trades the blue line for `bull`/`bear` colouring and keeps the gold dot; it is the documented three-hue exception. Red is losses and errors only; amber (`warn`) for degraded states, never gold.
- **Marker vocabulary (platform §3.1, locked):** circle = information, square = level, triangle = entry/exit, diamond = named event, cross = invalidation. Every RS dot is a **circle**; no triangles or arrows anywhere (they read as buy/sell).
- **Type and icon.** Instrument Sans only, tabular numerals, no monospace; `UIcon` `compass` for the category.
- **Tokens.** `--ut-gold` is `#dcbb5e` on the Graphite root and `#7a5c16` on light (`tokens.css`); the indicator gold is `designTokens.GOLD #c9a84c` per chart preset. Colours come from the preset's `IND_TOKENS` roles so Classic Dark, OLED, TradingView and Light each look right untouched.
- **Vocabulary.** Leadership, Regime.

## 4. Where we are today (code read; line numbers per the audit, master `3e11e6bf63`/`7f6dd3714d`, no drift in these files)

| Surface | What exists | Consequence for the plan |
|---|---|---|
| `nativeRegistry.RS_LINE_RAW` | `close ÷ benchmark`, enum SPY/QQQ/IWM, pane 15 %, one line, legend 4 dp, premium. | Replaced in place (same id, version 2). |
| `signature._rs_line_provider`, `_fetch_bars_for_tf(count=400)` | One column; 400 bars both legs; no cache. | 400 − 252 = 148 sessions (~7 months) of dot history; raise to `N + 600`. Add a TTL cache. |
| `registry_defs._RS_LINE` | Python row declares `benchmark` only; `resolve_inputs` drops undeclared keys and validates enums only; `payload_keys: []`; `wire_columns` requires the returned keys to **equal** the declared `columns`. | Every compute input must be declared on the Python row with min/max; `payload_keys: ["payload"]`; the flag must change the declared `columns` list, not the provider's output. |
| `serverCompute.columnsFromWire` | Keeps `{times, columns}` only; cache stores that pair; `useServerColumns` has no `rev` logic. | Scalars need a new path (§8.3). |
| `rs_ranking.py` | UCT fast rating, hourly cache, no history; fetches 200 calendar days via Massive. | IBD-style needs ≥ 252 closes → a bars.db job on the worker (Phase 2a). |
| `cap_universe.json` | 3,640 tickers incl. ETFs (SPY, QQQ, IWM, XLK, SMH present; **RSP absent**). | Rating excludes ETFs explicitly; RSP must join the bars prewarm set (§17). |
| `industry_map.py` | Universe-wide ticker → Finviz sector / industry map, ~100 % coverage incl. ETFs; `get_groups`, `tickers_in_industry`, `list_sectors`. | SECTOR and INDUSTRY benchmarks resolve server-side from this map, not from `ticker_meta`. A Finviz-sector → SPDR ETF table is written (11 rows). |
| `IndicatorSettingsDialog` | Inputs / Style / Visibility; collapsible groups (all **expanded** at open); tooltips; `evalActiveWhen` dims (one comparator); Visibility tab = hidden + move-to only; per-timeframe visibility is **per instance** and lives in the Chart Data panel (`inst.visibility`, presets all/intraday/dailyUp/custom). | A `meta.groupsCollapsed` hint; no per-plot visibility; the server NaNs intraday event columns. |
| Style tab | The inputs that plots reference via `$refs` (color, width, levels, lineStyle); `marker.size` must be a literal; dot size is `presentation.dotSize` small/medium/large. | One colour input per visible plot; dot size via `presentation`. |
| `markerPrimitive`, `binder` | Shapes circle/square/arrowUp/arrowDown; `inBar` rides the plot's own series at the plotted value; above/below rides the candle series only in pane 0; no hover/hit-test. | Dots are circles in the RS pane carrying the RS value; cards go on the chip/readout. |
| `indicatorTemplates.js` | Additive apply (new instance), duplicate-skipping; `indicatorTemplatesEnabled()` reads `VITE_INDICATOR_TEMPLATES_ENABLED` at build time. | Presets are not templates (§6.8). |
| `instanceControls` | `setInstanceDisplayTarget` (price/pane/volume), `setInstancePanePosition`, `setInstanceVisibility`, `setInstanceDotSize` (no `.jsx` caller yet). | Placement is instance state, not an input. |
| `defSchema.placement.scale` | `{min, max}` object; a string is refused. | Own-scale overlay needs a new key `placement.ownScale`. |
| Alerts | `INDICATOR_FUNCS` is derived from `alert_series.SERIES_FUNCS` (one-symbol closures); events live in `EVENT_ADDRESSES`. | RS alerts need a two-symbol series builder; Phase 2b. |
| `MobileIndicatorSheet` | Flat rows, steppers, enums, swatches, switches; no groups, no tooltips, no `activeWhen`. | Phase 1's ~12 inputs are fine flat; groups + dimming on mobile in Phase 2a. |
| Library | Tier badge only; no lock + preview. | Badge only in Phase 1; preview image Phase 4. |
| Education | `/desk?section=videos`; `GET /api/education/by-youtube/{id}`; no per-video URL param. | Learn deep links need a `video` param (Phase 4). |

## 5. One indicator, seven presets

A **preset** is a named set of input values (`meta.presets = [{id, label, origin, caveat, inputs}]`) applied by the generic preset-picker at the top of the settings dialog through the one writer, `setInstanceInput`, so the toolbar, right-click doors, chords and dialog stay in step. A preset reconfigures **the current instance**; it never adds one. Saving a member's own setup uses the existing indicator templates (additive, for *saving* only).

| Preset | What the member sees | Origin | Evidence line (launch copy, §9) | Phase |
|---|---|---|---|---|
| **Classic (O'Neil)** default | Blue RS line under price vs SPY, dashed 21 EMA, small blue dots on 52-week RS highs, large gold dot when before price | IBD, MarketSurge (01 §1, 02 §1.1) | Persistence over 6–12 months; no published hit rate for the dot | 1 |
| **Phase (21 EMA)** | Line `bull` above / `bear` below its 21 EMA; cross events in the readout | Manrav video 59; TraderLion RS Phase; Deepvue Webby | A standard trend read that lags turns by design | 1 |
| **Trend (Mansfield)** | Oscillator around zero; bull / bear / neutral shading | Weinstein (01 §2) | Most Stage 2A breakouts occur above zero or the week it crosses | 2a |
| **Stress test (UCT)** | Large gold dots on RS highs that fall on red market days; green-on-red count and pivot speed in the readout | UCT workshops; Kell; TraderLion down days (04 §7) | Taught widely, never measured publicly; our test will | 2a |
| **Rotation (RRG-style)** | RS-Ratio and RS-Momentum around 100, quadrant in the readout; rotation view in the Compare panel | de Kempenaer; UCT normalisation (01 §6) | A map, not a system | 3 |
| **Quality (Clenow)** | Regression slope × R² score, gap flag | *Stocks on the Move* (01 §4) | Lagged the S&P out of sample 2015–2025 (Quanterlab) | 3 |
| **Volatility-adjusted** | ATR-normalised RS vs its 50 MA, four states | OANDA VARS; Daniel–Moskowitz (01 §9) | Dampens genuine breakouts | 3 |

## 6. The member experience

### 6.1 Finding it
Library row: **UCT Relative Strength**, short name UCT RS, category Relative Strength (the two mislabelled studies move to Price Levels; a string change in their rows, with the catalog category test updated), Premium badge, `compass` glyph. Description: *"Is this stock beating the market, or just riding it? The RS line against a benchmark, with new-high dots and seven ways to read it, from O'Neil's classic to Weinstein's Mansfield and UCT's stress test."* Search aliases through `meta.tags` (already drives library search): RS, relative strength, RS line, RS rating, blue dot, Mansfield, RRG, rotation, leader, leadership, comparative, price relative, momentum. The RSI disambiguation row is Phase 4.

### 6.2 First turn-on (Classic, nothing touched) — Phase 1
1. The RS line in a pane under price, 18 % height (one number; the pane has no phone variant), in `info` blue, with a dashed `neutral` 21-day EMA. The on-price overlay with its own scale is Phase 3 (D7).
2. Small `info` circles on 52-week RS highs, every one kept. A large `premium` gold circle when the RS high comes while price is more than 2 % below its own 52-week high.
3. Legend chip, one line as the platform requires: `UCT RS · SPY` (Phase 1); `UCT RS · SPY · 94` once the rating lands (2a). The RS pane's axis numbers are hidden (D6); values appear in the crosshair readout and, from 2a, in words in the Leadership readout.
4. No tour until Phase 4; no input needs changing to trade the way IBD, Deepvue or the curriculum teach.

### 6.3 Settings dialog: Inputs tab
Groups collapse via a new `meta.groupsCollapsed: ['Line', 'New highs', 'Rating', 'Stress test', 'Method']` hint honoured by the dialog (Phase 1, generic); `activeWhen` is one comparator per input (`{key, equals}` etc.), so each dependent group dims on a single boolean. Inputs stay inside the existing type vocabulary; every numeric input carries `min`/`max`/`step`; every input carries `label` and `tooltip`. Lookbacks are declared in **bars** and say so, because an input has one default (the weekly presets set weekly values).

**Preset picker** (dialog header, not an input): Classic · Phase · Trend · Stress test · Rotation · Quality · Volatility-adjusted, each with its origin line; "Reset to preset" restores.

**Group: Simple** (expanded)
| key | type | default | options / range | tooltip |
|---|---|---|---|---|
| `benchmark` | enum | `SPY` | SPY · RSP (equal-weight S&P 500) · SECTOR (auto) · QQQ · IWM · INDUSTRY (auto) | "What we compare against. Change the benchmark and the question changes. Equal-weight or the sector isolates the stock's own strength when a few giants carry the index." |
| `maLength` | int | 21 | 2–200 | "Bars in the moving average on the RS line. 21 is the curriculum default; 50 is a slower read; Mansfield's Trend preset uses 52 weeks." |
| `showNewHigh` | bool | on | | "Small dot when the RS line is at its highest level of the lookback." |
| `showNewHighBeforePrice` | bool | on | | "Large gold dot when the RS line makes a new high while price is still more than 2 % below its own high. IBD calls this more bullish, and not a precondition." |
| `showRating` | bool | on | | "The 1–99 RS Rating in the legend and readout. 90 means the stock beat 90 % of the universe." (2a) |

**Group: Line** (collapsed)
| `maType` | enum | EMA | EMA · SMA | "EMA reacts faster; SMA is what Mansfield and StockCharts use." |
| `colorMode` | enum | `static` (Classic) / `phase` (Phase preset) | static · phase · slope | "Static keeps one colour. Phase colours the line by its position against the moving average; slope by its direction." |
| `lineColor`, `maColor`, `dotColor`, `dotBeforePriceColor` | color | preset tokens | | Style tab (plots reference these via `$refs`) |
| `lineWidth` | int | 1 | 1–4 | |

**Group: New highs** (collapsed)
| `lookback` | int | 252 | 20–500 | "Bars for a 'new high'. 252 bars is one trading year on a daily chart; the weekly presets use 52. Shorter reacts faster and fires more often." |
| `priceTolerance` | float | 2.0 | 0–10 (%) | "Price counts as 'not at its high' when it is more than this far below its lookback high. The same 2 % defines the dot and the evidence statistic." |
| `showNewLow` | bool | off | | "Small red dot on RS new lows. Relative weakness." (2a) |
| `shortHistoryDots` | bool | on | | "Mark RS highs over all available history when the stock has fewer bars than the lookback. Drawn in the neutral colour." |
| `dotHistory` | bool | on | | "Keep every dot, not only the latest." |

**Group: Rating** (collapsed, 2a): `headlineRating` enum ibd · fast · both (default both); `showComponents` bool off; `ratingBands` bool on ("Legend colour by the site's bands: 80 and above, 60, 40; a 90 reference line on the rating pane. Bands are heuristics, not tested cut-offs."); `showRatingHistory` bool off.

**Group: Stress test** (collapsed; dims unless `showStress`, 2a): `showStress` bool off (Stress preset sets on); `redDayThreshold` float −0.5, −3.0–0 (%) ("The benchmark must close at least this much down, in percent, for a 'red day'."); `showGreenOnRedCount` bool on (readout row, no marker).

**Group: Method** (collapsed; each dims unless its preset's switch is on): `mansfieldLength` int 200 (bars; the Trend weekly preset sets 52), `rrgWindow` 14, `rrgTail` 12, `clenowWindow` 90 ("Commonly implemented with 90 trading days."), `clenowGapPct` 15, `atrLength` 20, `varsLookback` 60.

**Group: Readout** (2a): `showLeadership` on, `showRegime` on, `showEvidence` on.

**Not inputs** (owned by existing writers and surfaces, stated so nobody adds a second door): placement (`setInstanceDisplayTarget`, dialog Visibility tab), pane order (`setInstancePanePosition`), per-timeframe visibility (`setInstanceVisibility`, Chart Data panel; presets `all` / `dailyUp`), dot size (`presentation.dotSize` small/medium/large, Chart Data panel; a dialog Style control is Phase 2a), hidden (dialog Visibility tab).

### 6.4 Style tab
Generated from the colour and width inputs the plots reference. Defaults from the chart preset's `IND_TOKENS`. Dot size via `presentation.dotSize`. No label position.

### 6.5 Timeframe behaviour (data carries the rule)
Per-interval display is per instance (Chart Data panel presets). The **server** sets event and dot columns to NaN on intraday timeframes (1–60 minute), so new-high markers never draw on a 5-minute chart whatever the visibility setting; the line and MA draw on every interval. Weekly: computed on the site's Friday-dated weekly bars, never resampled on the client; the Classic (weekly) and Trend presets set `lookback` 52, `maLength` 21 and `mansfieldLength` 52.

### 6.6 Legend, crosshair, Leadership readout
- **Chip:** one line, `shortName + params` (platform §7): `UCT RS · SPY` → `UCT RS · SMH · 94` (benchmark resolved to its ticker; the full name is in the readout). Chips collapse to dots on phones as the platform does.
- **Crosshair:** the RS value and MA value for that bar (4 dp), plus `rating on that date` from 2a.
- **Leadership readout** (2a; the engine's per-indicator readout rows, from a definition-level `readout` schema that reads `payload`):

```
LEADERSHIP · NVDA vs SPY · Daily · as of Nov 5 close
Rating         IBD-style 96 · UCT fast 98 · 5d +2 · 20d +7 · universe 3,600, ETFs excluded
Components     1M 91 · 3M 97 · 6M 95 · 12M 96
RS line        +2.1 % above 21 EMA, rising · 52-wk high 3 bars ago · before price: yes · red day: yes
Benchmarks     vs SPY rising · vs RSP rising · vs SMH flat       sensitivity: agree
Regime         SPY above 200d · 2-yr trend positive · volatility low   persistence regime
Theme          Semiconductors (SMH) · sector RS percentile 88
Checks         MAs: stock +15 % vs 200d, SPY −3 %  ·  Anchor Oct 15: stock +18 %, SPY +6 %
               Pivot speed 7 of last 10 market-down days closed in top third  ·  Green on red 6 of 20
Pullback       1.8 % above 8-day EMA
Evidence       Our test: RS 52-wk high while price > 2 % below its high → median +3.1 % vs SPY at 60
               sessions, hit 56 %, n = 2,410 events on 310 dates, 2016–2026. Field: no published hit rate.
```
No aggregate score, no verdict, no ticks. "sector RS percentile" is `sector_rs_pct` from the screener snapshot; an industry-group percentile is defined in 2a when the composite exists. The three-line explanation (what, origin, evidence) opens from the chip and from each readout row.

### 6.7 Markers (engine shapes only; intensity by size and colour; no hover)
| Marker | Shape, size, colour | What | Origin | Phase |
|---|---|---|---|---|
| RS new high | circle, small, `info` | "The RS line closed at its highest level of the last 252 bars." | IBD's RS line new high; the blue dot | 1 |
| RS new high before price | circle, large, `premium` | "RS made a new high while price is still more than 2 % below its own high. IBD: more bullish, not a precondition." | IBD; Deepvue; ChillLax | 1 |
| Short-history RS high | circle, small, `neutral` | "Highest RS over all available history (fewer bars than the lookback)." | — | 1 |
| RS new high on a red day | circle, large, `premium`, text `RED` | "An RS new high on a day the market closed down." | UCT workshops; Kell; TraderLion | 2a |
| RS new low | circle, small, `bear` | "The RS line closed at its lowest level of the lookback." | ChillLax; Weinstein | 2a |
| Mansfield zero cross | circle, small, `neutral` at the zero line | "The ratio crossed its 52-week average." | Weinstein | 2a |
Green-on-red and RS/MA crosses are **columns** (readout counts, screener, alerts), not markers: a triangle or arrow is the platform's entry/exit vocabulary. Dots ride the RS series (`position: 'inBar'`, column = RS value on event bars, NaN elsewhere). Dot density on long charts is handled by `presentation.dotSize` (small) rather than a custom thinning rule.

### 6.8 Presets, saving, sharing
Preset picker (above). **Save as template** uses the existing additive templates when the build carries `VITE_INDICATOR_TEMPLATES_ENABLED=1` (a build-time variable, D10 amended); the share link already carries an instance. "Save as my default" is Phase 2a (preference key and writer to be named at build; none exists).

### 6.9 Phone
Phase 1's ~12 inputs render as the sheet's flat rows. Groups, tooltips and `activeWhen` in `MobileIndicatorSheet` are a Phase 2a generic addition before the input count grows. Chips collapse to dots as the platform does; the readout is a sheet from the chip (2a).

### 6.10 States (platform ten-state inventory; existing paths only)
Loading skeleton · Refreshing (serve-stale) · Warm-up grey "needs N more bars" (never error-styled) · Compute error (red dot, retry) · Server unavailable (amber, last good ghosted) · Premium: tier badge in the library (lock + preview does not exist; Phase 4) · Hidden / hidden-on-this-timeframe (Chart Data panel) · Repaint badge not shown (non-repainting) · Version bump: silent (defaults fill; no toast path exists; release note instead). Benchmark without bars → empty columns and `payload.history.bars = 0` → the warm-up state with the sentence "No SPY bars for this timeframe yet". Benchmark = symbol → "Pick a different benchmark". SECTOR unresolved → SPY with `payload.benchmark.fallback`.

### 6.11 Tour and Learn links (Phase 4)
Five cards from 04 §d in the brand voice, with card 4's forward claim removed: "Strong on a weak day. Stocks that close green while the market sells off are showing demand you can see." Learn links need a `video` URL parameter on the Desk videos section plus the `by-youtube` endpoint.

### 6.12 Copy guide
Declarative, present tense; numbers carry source and date; approximations labelled where they appear; the banned list in §3. **Removed from member copy by the audit** until measured or verified: "MarketSurge shows only the latest dot" [U]; "what MarketSurge calls 52-week" [U]; "±3–5 points vs MarketSurge" [S] (replaced by our measured difference from fixture set 2); "IBD rates young stocks on available data" [U]; "Clenow's book uses 90 days" [S] → "commonly implemented with 90 trading days".

## 7. Exact definitions (tests pin these)

Notation: `C[t]`, `B[t]` joined by bar time; `rs = C / B`; `N` lookback in bars; `L` MA length. Missing close → NaN everywhere derived. Event columns ∈ {0, 1, NaN}. Percent inputs are percent.

1. **RS line** `rs[t]`. 2. **RS MA** EMA/SMA of `rs` over the valid bars in order, gaps skipped, warm-up `L − 1` valid bars. 3. **rsAbove** `rs ≥ rsMA`. 4. **crossUp/crossDown** from `rsAbove`. 5. **RS new high** `rs[t] ≥ max(rs[t−N … t−1])`, all N present, ties count, NaN before N bars or when the window has a gap; **partial** over all available bars (≥ 20) below N, drawn `neutral`. 6. **Price new high** `C[t] ≥ max × (1 − 0.02)` (one tolerance everywhere, incl. the backtest signal). 7. **rsNHbeforePx** `rsNH ∧ ¬pxNH`. 8. **Red day** `(B[t]/B[t−1] − 1) × 100 ≤ −0.5`. 9. **gor** `red ∧ C up`; **rog** mirror. 10. **rsNHred** `rsNH ∧ red`. 11. **rsNL** mirror of 5. 12. **Dot columns** `rs` where the event fired, else NaN. 13. **Mansfield** `RP = rs × 100; MRS = ((RP / SMA(RP, n)) − 1) × 100`, `n` = `mansfieldLength` bars; shading bull (>0 rising) / bear (<0 falling) / neutral. 14. **Rotation (UCT normalisation, "RRG-style")** `trend = (rs / EMA(rs, 3W) − 1) × 100`; `rsRatio = 100 + 100 × trend / σ(trend, 252 daily | 104 weekly)` clipped [80, 120]; `rsMomentum` likewise over `Δ rsRatio` across `W` bars; quadrants at 100. 15. **Quality** OLS of `ln C` over `clenowWindow` bars → `annual = (1 + b)^252 − 1`, `score = annual × R²`, `gapFlag` when any one-bar move > `clenowGapPct`. 16. **VARS** `Σ (ΔC/ATR_C − ΔB/ATR_B)` over `varsLookback`, states vs SMA50. 17. **RS Rating (IBD-style)** `0.40·C/C₋₆₃ + 0.20·C/C₋₁₂₆ + 0.20·C/C₋₁₈₉ + 0.20·C/C₋₂₅₂`, missing terms dropped and renormalised, 63-day term required, percentile across the cap universe **excluding ETFs** (an explicit ETF set from `industry_map`'s sector classification plus a hand list of the benchmarks) → `max(1, ceil(pct × 99))`; ETFs receive a rating by interpolation against the stock distribution. Labelled "IBD-style"; the measured difference to MarketSurge from fixture set 2 is printed once known. 18. **UCT fast** unchanged. 19. **Components** percentile of plain 21/63/126/252-bar returns. 20. **Δ5, Δ20** from history. 21. **Regime chip** benchmark vs SMA200; sign of the 504-bar return; 126-bar realised-vol tercile vs its own three-year distribution; labels persistence / rebound-risk / mixed. 22. **Sensitivity** sign of the 20-bar RS slope vs SPY, RSP and the sector ETF. 23. **Checks** as v3 §7.20. 24. **Intraday** (`tf` in 1/5/15/30/60): event and dot columns NaN; line and MA computed.

## 8. Server and client contract

### 8.1 Python row (`registry_defs._RS_LINE`, version 2)
Declares every **compute-affecting** input with type, default, `min`/`max` (the resolver gains numeric clamping; enums keep vocabulary refusal): `benchmark`, `maLength`, `maType`, `lookback`, `priceTolerance`, `redDayThreshold`, `shortHistoryDots`, plus the Phase 2a/3 method inputs as they ship. Style inputs (colours, width, toggles that only hide a plot) are **not** declared, so `resolve_inputs` drops them. `columns` = the Phase 1 list below (the exact-match contract); `payload_keys: ["payload"]`; `compute.rev: 2`. `RS_LINE_BENCHMARKS` grows to `("SPY", "RSP", "SECTOR", "QQQ", "IWM", "INDUSTRY")` and the one-list rail (`test_the_rs_line_benchmarks_are_ONE_list_across_BOTH_LANES`) keeps JS and Python equal.

### 8.2 Provider (`_rs_line_provider`)
Fetches `N + 600` bars daily (`N + 200` weekly, 400 intraday) for the symbol, the benchmark and, from 2a, RSP and the sector ETF for sensitivity. Resolves `SECTOR` via `industry_map.get_groups` → Finviz sector → SPDR ETF table (Technology→XLK, Financial→XLF, Energy→XLE, Healthcare→XLV, Industrials→XLI, Consumer Cyclical→XLY, Consumer Defensive→XLP, Utilities→XLU, Basic Materials→XLB, Real Estate→XLRE, Communication Services→XLC); `INDUSTRY` via `tickers_in_industry` → equal-weight composite of closes (cached per session). Calls `relative_strength.compute_phase1_columns` (committed `ab9693d50b`), rounds line columns to 6 dp, leaves events as 0/1/None, builds `payload` (`benchmark {requested, resolved, label, fallback}`, `legend {pctFromMa, maSlope, above}`, `lastRsHigh`, `history {bars, short}`; 2a adds `rating`, `regime`, `sensitivity`, `checks`, `theme`, `evidence`). TTL cache keyed `(defId, sym, tf, canonical compute inputs, session date)`: 15 min intraday, to next close for D/W/M. Budget p95 ≤ 150 ms warm, ≤ 100 KB gzipped, measured in the Phase 1 PR.

**Phase 1 columns:** `rsLine, rsMa, rsAbove, rsNH, rsNHpartial, pxNH, rsNHbeforePx, rsNHred, rsNL, gor, rog, crossUp, crossDown, dotNH, dotNHbeforePx, dotNHred, dotNHpartial, dotNL` (events and dots for red-day and new-low ship as columns in Phase 1 so scans can use them; their markers are 2a).

### 8.3 Client
- `columnsFromWire` keeps `payload` beside `{times, columns}`; the cache stores the whole parsed envelope; `scalarsFor(def, ctx)` returns `payload` for the readout; `useServerColumns` treats a `rev` different from the definition's as a cache miss. Phase 1 ships the cache shape and `rev` gating; the readout consumer ships in 2a with the `readout` schema (`readout: [{key, label, source: 'payload.…', format}]` on the definition, validated by `defSchema`, rendered by the chip and readout rows).
- `serverColumnsKey` builds the fetch/cache key from the inputs the **server definition declares** (the client already fetches `/api/signature/definitions`), so a colour change never refetches.
- Markers: `plots[].style: 'markers'` with `marker: {shape: 'circle', position: 'inBar', size}` on the dot columns.
- Flag `RS_V2_ENABLED` (web pod): read at import by the Python row, which declares the v1 `columns`/`payload_keys` when off and v2 when on; the JS definition hides the new plots when the envelope's `rev` is 1. No admin cohort (`serve()` has no user); rollout is flag on, rollback is flag off plus `railway redeploy`.
- Errors: unknown benchmark 422 with the allowed list; no bars → empty columns + `history.bars = 0`; free member 402.

## 9. The honesty layer and the nightly backtest (2b)
Launch copy = the defensible statements in 03 §b (five statements, plus our own numbers once they exist); the six must-not-claims there are enforced by the copy review. The nightly job is 03 §c unchanged except: signal 3 uses the same 2 % tolerance as the dot; **delisted-name data is an open item** (§17.6): bars.db holds the current cap universe, so the first version is point-in-time over the names we hold and says so in the readout ("universe as held, survivorship not yet corrected") until a delisting source exists.

## 10. Beyond the chart
1. **Screener columns and presets** (2a): from the same functions in the nightly snapshot: `rs_new_high`, `rs_nh_before_price`, `rs_nh_red_day`, `rs_nh_bars_ago`, `green_on_red_20`, `rs_line_above_ma`, `rs_rating_ibd`, `rs_rating_fast`, `rs_rating_chg_5/20`, `rs_rating_1m/3m/6m/12m`, `mansfield`, `rs_benchmark_agree`; Phase 3 adds `rrg_quadrant`, `clenow_score`, `vars_state`. Presets in plain English: "RS 90+", "RS new highs (52-week)", "RS new high before price (weekly)", "RS new highs on a red day", "Up on down days (6 of 20)", "Crossed above 21 EMA within 5 bars", "Mansfield crossed zero (weekly)", "Leaders vs equal-weight too".
2. **Alerts** (2b): a benchmark-aware series builder beside `alert_series.SERIES_FUNCS`, RS addresses in `EVENT_ADDRESSES` (never grown into `INDICATOR_FUNCS`, which moves the replay grid), `ALERT_CONDITIONS` rows: RS new high (any / before price / on red day), RS line crossed its MA (above / below), RS Rating crossed 90 / 80 / fell below 80, Mansfield crossed zero. The popover reads the catalog unchanged.
3. **Discord "RS leaders on a red day"** (2b): through the screener alert routing (`screen_alerts.py`, `alert_routing.py`; exact hook verified at build), premium channel, ≥ 3 names, attributed to the method, no emoji. Template as v3 §10.3.
4. **Leadership and Emerging lists** (4): rating ≥ 90 ∧ RS high within 10 bars ∧ above 200-day ∧ benchmarks agree, grouped by theme, cap 30; Emerging: crossed above the MA within 5 bars ∧ rating ≥ 80.
5. **Rotation view** (3), **Study and Compass** (4).

## 11. Engineering: what exists, what changes

| Need | Exists | Change (phase) |
|---|---|---|
| Groups, tooltips, dimming | Yes (dialog) | `meta.groupsCollapsed` hint (1); mobile groups + `activeWhen` (2a) |
| Preset picker | No | Generic dialog header control over `meta.presets`, writes via `setInstanceInput` (1) |
| Markers | Circles/squares/arrows, inBar at plotted value | None; dots are circles (1) |
| Many columns + payload | One column; `payload_keys` plumbing exists | Python row declares inputs with min/max and `payload_keys` (1); provider rewrite (1); numeric clamping in `resolve_inputs` (1) |
| Scalar path | None | Envelope cache + `scalarsFor` + `rev` gating (1); `readout` schema + chip/readout renderer (2a) |
| Cache key | Every instance input | Server-declared inputs only (1) |
| Bars | 400 | `N + 600` daily (1) |
| SECTOR / INDUSTRY | `industry_map` | Sector→ETF table; composite builder (1) |
| RSP bars | Not in cap universe | Add to the bars prewarm priority set (1) |
| Flag | None | `RS_V2_ENABLED` at import on the Python row (1) |
| Rating IBD-style + history | `rs_ranking` (fast, Massive 200 days) | Worker job over bars.db, `rs_rating_history`, backfill behind `.rs_history_backfill_v1` (2a) |
| Evidence job | None | `rs_evidence` table (2b) |
| Alerts | One-symbol lane | Two-symbol series builder, `EVENT_ADDRESSES` (2b) |
| Own-scale overlay | `scale {min,max}`; pool resolves `priceScaleId` from `scaleId` | `placement.ownScale: true` + binder (3) |
| Custom benchmark | `symbol` reserved (C-A3 stays) | `customBenchmark` string input, `_sym_or_422` server-side (3) |
| Tier | `require_paid` | Unchanged |

## 12. Validation and definition of done

### 12.1 Fixture sets
1. **Public-method parity** (per preset as it ships): Mansfield vs the stageanalysis script on five weekly tickers (2a); RRG quadrant agreement ≥ 85 % with StockCharts on a sector set (3); Clenow vs the quant-investing worked example (3); VARS shape vs the OANDA case study (3).
2. **MarketSurge / Deepvue parity** (2a): 20 owner screenshots; IBD-style rating difference **measured and published** (no target asserted in copy; the plan's engineering target is ±3); blue-dot days ±1 bar; before-price agreement; Deepvue components ±3.
3. **Curriculum parity** (1): Manrav's GS, D, MARA crosses ±1 bar; Chartmaster's dated posts replayed when pulled (≥ 90 % flagged by `rsNHred`), misses listed.
4. **Literature replication** (2b): direction of Bulkowski's finding and the DWA shape on our universe; published either way.

### 12.2 Usability gate (end of Phase 1)
Five members, two on phones, no coaching, 60 seconds each: turn it on; name the benchmark; point to the last RS high; change the benchmark to the sector; open the settings and find the lookback. Pass = 4 of 5 on all five. Colour-blind simulation screenshots; keyboard reachability; no text under 11 px.

### 12.3 Named tests
- `tests/test_relative_strength_columns.py` (done, 18): the §7.1–7.12 rails.
- `tests/test_rs_columns_provider.py` (1): payload shape; SECTOR/INDUSTRY resolution incl. fallback; 422 unknown benchmark; `rev = 2`; bar count ≥ `N + 600`; intraday events NaN; p95 under budget warm; the existing AST no-`if def_id` rail; the one-list benchmark rail.
- `app/src/components/chart/engine/__tests__/rsIndicator.golden.test.js` (1): single-symbol RS = 1.0; events ∈ {0,1,NaN}; dot columns finite only where events fire; time-joined; shared fixture `tests/fixtures/indicators/rs_events_default.json` read by both lanes.
- `app/src/components/chart/__tests__/rsPresets.test.js` (1): the picker writes through `setInstanceInput`, reconfigures the current instance, adds none; Reset restores; `groupsCollapsed` honoured.
- `serverCompute.test.js` additions (1): envelope cached with payload; `rev` mismatch is a miss; key ignores style inputs.
- `tests/test_rs_rating_ibd.py`, `tests/test_rs_rating_history.py` (2a); `tests/test_rs_evidence_job.py`, `tests/test_rs_alert_series.py` (2b); `rsReadout.test.js` (2a).
- Rails that stay green: `registrySizes`, the AST rail, free-user-refused-on-every-route, `singleWriterIndex`, `designTokens.test.js`, the catalog category test (updated for the two moved rows).

### 12.4 Definition of done
| Phase | Done when |
|---|---|
| 0 | D1–D12 ruled (done); sector→ETF table written; RSP in the prewarm set; Chartmaster posts pulled; screenshots collected. |
| 1 | Classic and Phase presets exactly as §6.2–6.3; Phase 1 columns and dots; Python row, provider, cache, flag; envelope cache and `rev` gating; preset picker; `groupsCollapsed`; states; fixture set 3; usability gate; §12.3 Phase 1 tests green; budget recorded. |
| 2a | IBD-style rating job + history; `readout` schema and Leadership readout with three-line cards; Trend and Stress presets with their markers; mobile groups; screener columns and presets; fixture sets 1 (Mansfield) and 2. |
| 2b | Evidence job and evidence rows; alert lane and conditions; Discord post behind its flag; fixture set 4. |
| 3 | Own-scale overlay; custom benchmark; Rotation, Quality, Volatility-adjusted presets; rotation view; anchor click; fixture set 1 (rest). |
| 4 | Lists; tour; Learn links with the `video` param; RSI row; premium preview; Study drills; Compass sentences; walkthrough video. |

## 13. Rollout, rollback, telemetry, success
Saved layouts keep working (same id, version 2, every new input defaulted; silent). Flags: `RS_V2_ENABLED` (web, Python row at import), `RS_HISTORY_ENABLED` and `RS_EVIDENCE_ENABLED` (worker), `RS_DISCORD_POST_ENABLED`; `VITE_INDICATOR_TEMPLATES_ENABLED=1` at build if member-saved templates are wanted. Rollback = flag off + `railway redeploy --service web --yes`. Telemetry counts as v3. Success after 30 days as v3. **Push discipline:** CI minutes are billed; one push per finished, locally tested unit; the Phase 1 branch was cut after PR #877 so it carries the filtered workflows.

## 14. Risks
As v3 §14, plus: **the readout schema is a new engine concept** (mitigation: Phase 1 ships without it, 2a adds it with its own rail); **the alert lane needs a second symbol** (2b, named); **no delisted-name source for the backtest** (first version says so in the readout); **gold dot beside gold HVC bars** exceeds the ≤ 1 gold element guidance when both are on (accepted by D8; the Style tab lets a member recolour).

## 15. Phases and sizing
| Phase | Scope | Size |
|---|---|---|
| 0 | §12.4 row 0 | 2–3 days |
| 1 | Classic + Phase presets; §7.1–7.12, 7.24; §8; preset picker; `groupsCollapsed`; states; tests; usability gate | ~3 weeks |
| 2a | Ratings + history; `readout` schema and Leadership readout; cards; Trend and Stress presets and markers; mobile groups; screener | ~3 weeks |
| 2b | Evidence job; alert lane; Discord; literature replication | ~3 weeks |
| 3 | Overlay; custom benchmark; Rotation, Quality, Volatility-adjusted; rotation view; anchor click | ~2 weeks |
| 4 | Lists; tour; Learn links; RSI row; preview; Study; Compass; video | ~1.5 weeks |

Phases 1 and 2a are now **dependent** (2a's readout consumes 1's scalar path); 2b can run beside 2a on a second machine.

## 16. Decisions (owner accepted all recommendations 2026-11-05; audit amendments marked)
1. Default benchmark SPY. 2. Lookback 252 bars, "one trading year". 3. Red day −0.5 %, adjustable. 4. Headline rating IBD-style with UCT fast beside it, **both** in the chip from 2a; **Phase 1 shows no rating on the chart** [amended by audit: the rating is 2a work]. 5. Discord post automatic, premium channel, ≥ 3 names. 6. RS pane axis hidden; values in crosshair and readout. 7. Pane under price at launch; overlay in Phase 3. 8. Gold for the before-price dot. 9. **Classic line is static `info` blue; the bull/bear colouring is the Phase preset** [amended: the platform's ≤ 2 hues + 1 neutral budget]. 10. **Indicator templates flag is a Vite build-time variable; presets do not depend on it** [amended]; set it at build in 2a if member-saved templates are wanted. 11. Evidence lines at launch = the field's defensible findings. 12. Seven presets across Phases 1–3.

## 17. Open items
1. Chartmaster's Discord posts (owner `!` query). 2. Sector→ETF table written at Phase 1 Task 2 from `industry_map`'s Finviz sector names (coverage is universe-wide per the module header; measured in the provider test). 3. INDUSTRY composite via `tickers_in_industry` (Phase 1). 4. MarketSurge dot history and lookback [U] → fixture set 2. 5. IBD short-history rule [U] → not member copy. 6. **Delisted-name source for the backtest** (2b). 7. RSP added to the bars prewarm priority set (1). 8. "Save as my default" preference key and writer (2a). 9. Desk `video` URL parameter (4).

## 18. Glossary — as v3 §18 with "typically within ±3–5 points of MarketSurge" replaced by "our measured difference is shown in the readout".

## 19. Sources — as v3 §19, plus the audit report (this session, 2026-11-06) and `api/services/industry_map.py`, `api/data/cap_universe.json`, `app/src/components/chart/engine/{instanceTimeframe,presentation,useServerColumns}.js`, `api/services/alert_series.py`.
