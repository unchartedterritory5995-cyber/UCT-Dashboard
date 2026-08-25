# Researcher 10 — Competitive Teardown: Candlestick Structure Features

**Date:** 2026-08-24
**Scope:** what rival platforms actually ship to end users for candlestick identification.
**Method:** primary documentation and live product pages only (vendor help centers, vendor reference libraries, vendor screener pages). Where a vendor blocked fetch (403), that is stated explicitly and the finding is downgraded.

**Headline:** the parity bar is not "seven labels." Every serious platform ships between **11 and 104** named candle structures, and the two platforms closest to this product's positioning (TradingView, Thinkorswim) ship **44** and **58** respectively. More importantly, the platforms that solve the "dash for most rows" problem do it with an explicit **basic-candle fallback taxonomy** (StockCharts "Candlestick Building Blocks", TC2000 "Basic Candle Formulas") that classifies *every* bar, not with more exotic patterns.

---

## A. PLATFORM SECTIONS

Each section answers the seven capture fields:
(1) complete pattern list · (2) exact UI wording · (3) surface · (4) one vs many + strength + color · (5) underlying numbers exposed? · (6) teaching/tooltip pattern · (7) free vs paid.

---

### A1. TradingView — 44 patterns, THE reference implementation

**(1) Complete list — 44, verbatim, with TradingView's own strength/type classification.** This is the single most directly relevant artifact in this whole report, because TradingView ships the identical vocabulary as both a *chart indicator family* and a *screener filter + screener column* — exactly the shape being built here.

| # | Pattern (verbatim UI wording) | Signal strength | Signal type |
|---|---|---|---|
| 1 | Abandoned Baby - Bearish | Strong | Reversal |
| 2 | Abandoned Baby - Bullish | Strong | Reversal |
| 3 | Engulfing - Bearish | Strong | Reversal |
| 4 | Engulfing - Bullish | Strong | Reversal |
| 5 | Evening Star | Strong | Reversal |
| 6 | Falling Three Methods | Strong | Continuation |
| 7 | Kicking - Bearish | Strong | Reversal |
| 8 | Kicking - Bullish | Strong | Reversal |
| 9 | Morning Star - Bullish | Strong | Reversal |
| 10 | Rising Three Methods | Strong | Continuation |
| 11 | Three Black Crows - Bearish | Strong | Reversal |
| 12 | Three White Soldiers - Bullish | Strong | Reversal |
| 13 | Bearish Harami | Medium | Reversal |
| 14 | Bullish Harami | Medium | Reversal |
| 15 | Dark Cloud Cover | Medium | Reversal |
| 16 | Doji Star - Bearish | Medium | Reversal |
| 17 | Doji Star - Bullish | Medium | Reversal |
| 18 | Downside Tasuki Gap | Medium | Continuation |
| 19 | Evening Doji Star | Medium | Reversal |
| 20 | Falling Window | Medium | Continuation |
| 21 | Harami Cross - Bearish | Medium | Reversal |
| 22 | Harami Cross - Bullish | Medium | Reversal |
| 23 | Morning Doji Star | Medium | Reversal |
| 24 | Piercing - Bullish | Medium | Reversal |
| 25 | Rising Window | Medium | Continuation |
| 26 | Tri-Star - Bearish | Medium | Reversal |
| 27 | Tri-Star - Bullish | Medium | Reversal |
| 28 | Tweezer Bottom | Medium | Reversal |
| 29 | Tweezer Top | Medium | Reversal |
| 30 | Upside Tasuki Gap | Medium | Continuation |
| 31 | Doji | Weak | Reversal |
| 32 | Dragonfly Doji - Bullish | Weak | Reversal |
| 33 | Gravestone Doji | Weak | Reversal |
| 34 | Hammer | Weak | Reversal |
| 35 | Hanging Man | Weak | Reversal |
| 36 | Inverted Hammer | Weak | Reversal |
| 37 | Long Lower Shadow - Bullish | Weak | Reversal |
| 38 | Long Upper Shadow - Bearish | Weak | Reversal |
| 39 | Marubozu Black - Bearish | Weak | Continuation |
| 40 | Marubozu White - Bullish | Weak | Continuation |
| 41 | On Neck (Bearish) | Weak | Continuation |
| 42 | Shooting Star - Bearish | Weak | Reversal |
| 43 | Spinning Top Black | Weak | Reversal |
| 44 | Spinning Top White | Weak | Reversal |

**(2) Exact wording.** Direction is a **suffix after an em-style hyphen**: `Engulfing - Bullish`, not "Bullish Engulfing". Note the internal inconsistency TradingView itself has: `Bearish Harami` / `Bullish Harami` use a *prefix*, while `Harami Cross - Bearish` uses a *suffix*; and `On Neck (Bearish)` uses parentheses. Marubozu and Spinning Top encode body color as a word: `Marubozu White - Bullish`, `Spinning Top Black`. Direction is dropped entirely where the name already implies it (`Evening Star`, `Dark Cloud Cover`, `Tweezer Top`).

**(3) Surface.** Three surfaces, one vocabulary:
- **Chart indicators** — `Indicators, metrics, and strategies` → `Technicals` → `Patterns`. One indicator per pattern.
- **Screener filter** — dropdown listing all 44 alphabetically, each with a miniature candle glyph.
- **Screener column** — a "Candlestick Pattern" field showing the most recent pattern(s).
- **Alerts** — the pattern indicators wire into TradingView's alert system.

**(4) One vs many / strength / color.** **Many per bar.** The screener column renders **up to four miniatures, ordered by signal strength** — "Strong patterns like engulfing or three white soldiers appear first, while weaker single-candle signals like spinning tops come last." Beyond four, a `+3` counter appears with a hover tooltip listing the rest. Strength is a **three-level ordinal (Strong / Medium / Weak)** and signal type is a second axis (**Continuation / Reversal**). Color: **bullish green, bearish red**, applied to the miniature candle glyph itself. On the chart, labels are **blue = bullish indicator, red = bearish indicator, gray = indicator that can fire both ways**.

**(5) Underlying numbers.** **No.** TradingView exposes the name, the strength tier, the type, and a picture. It never shows body % or wick %. The *picture* is the substitute for the numbers — "colored miniatures that show the actual candle layout: the bodies, the shadows, the gaps."

**(6) Teaching.** Hover the chart label → popup tooltip with the pattern's name and description. In the screener, multi-select collapses to a counter with a hover tooltip enumerating selections. Separate ChartSchool-style support articles ("Introduction to candlestick charts and patterns") group patterns pedagogically by **number of candles (one to five)** and by **reversal / continuation / neutral**.

**(7) Gating.** The pattern vocabulary itself is **free**. What is paid is the **timeframe**: the filter and column both take a timeframe from 1 minute to 1 month, and *"intraday timeframe options require a paid subscription; daily and longer intervals are available to all users."* This is a notable monetization pattern — gate the interval, not the pattern.

---

### A2. Thinkorswim / Schwab — 58 patterns, the deepest mainstream retail library

**(1) Complete list — 58, verbatim CamelCase study names**, split into Thinkorswim's own three groups.

*Bearish and Bullish (17) — patterns that can fire either direction:*
`AbandonedBaby` · `BeltHold` · `Breakaway` · `Doji` · `Engulfing` · `Harami` · `HaramiCross` · `Kicking` · `LongLeggedDoji` · `Marubozu` · `MeetingLines` · `SeparatingLines` · `SideBySideWhiteLines` · `ThreeLineStrike` · `TriStar` · `WilliamsFractal` · `ZigZagStepPattern`

*Bullish Only (20):*
`ConcealingBabySwallow` · `Hammer` · `HighPriceGappingPlay` · `HomingPigeon` · `InvertedHammer` · `MatchingLow` · `MatHold` · `MorningDojiStar` · `MorningStar` · `OneWhiteSoldier` · `PiercingLine` · `RisingThreeMethods` · `StickSandwich` · `ThreeInsideUp` · `ThreeOutsideUp` · `ThreeStarsInTheSouth` · `ThreeWhiteSoldiers` · `UniqueThreeRiverBottom` · `UpsideGapThreeMethods` · `UpsideTasukiGap`

*Bearish Only (21):*
`AdvanceBlock` · `DarkCloudCover` · `Deliberation` · `DownsideGapThreeMethods` · `DownsideTasukiGap` · `EveningDojiStar` · `EveningStar` · `FallingThreeMethods` · `HangingMan` · `IdenticalThreeCrows` · `InNeck` · `LowPriceGappingPlay` · `OneBlackCrow` · `OnNeck` · `ShootingStar` · `ThreeBlackCrows` · `ThreeInsideDown` · `ThreeOutsideDown` · `Thrusting` · `TwoCrows` · `UpsideGapTwoCrows`

**(2) Exact wording.** **PascalCase, no spaces, no direction word** — `DarkCloudCover`, `ThreeWhiteSoldiers`, `HaramiCross`. Direction is carried by *taxonomy* (which of the three folders the study lives in), not by the name. Two uniquely-Schwab entries worth flagging: `WilliamsFractal` and `ZigZagStepPattern` are structural/swing patterns, not classical Japanese candles — Schwab has quietly extended the family beyond Nison/Morris.

**(3) Surface.** Studies (chart overlays) + scan filters + the **Candlestick Pattern Editor**, a UI that lets a user *define their own* pattern from candle primitives and then scan for it. Patterns are also selectable per-chart via a Patterns panel.

**(4) One vs many / strength / color.** Many per bar (each study is independent and can be stacked). **No numeric strength or reliability score** — the only grading is the three-way bullish/bearish/both taxonomy. Coloring follows the study's direction.

**(5) Underlying numbers.** No body%/wick% surfaced in the pattern label. However — and this is the important differentiator — the **Candlestick Pattern Editor** exposes the *primitives* (body size, shadow ratios, gaps, relation to prior bars) as user-editable inputs. Schwab's answer to "expose the numbers" is "let the user re-author the definition."

**(6) Teaching.** Every one of the 58 has its **own reference page** under `toslc.thinkorswim.com/center/reference/Patterns/candlestick-patterns-library/...` with a description and an idealized diagram. Deep, per-pattern documentation is the norm here, not the exception.

**(7) Gating.** Free with a Schwab/thinkorswim account. No pattern-level paywall.

---

### A3. StockCharts — 17 pattern clauses + 9 building blocks (and the fallback idea)

**(1) Complete list.**

*Candlestick pattern scan clauses — bullish (8):* Bullish Engulfing · Piercing Line · Bullish Harami · Morning Star · Rising Three Methods · Dragonfly Doji · Three White Soldiers · Hammer

*Candlestick pattern scan clauses — bearish (9):* Bearish Engulfing · Dark Cloud Cover · Bearish Harami · Evening Star · Falling Three Methods · Gravestone Doji · Three Black Crows · Hanging Man · Shooting Star

*"Candlestick Building Blocks" (9) — THE KEY FINDING:* **Uptrend · Downtrend · Long Body · Short Body · Doji · Marubozu · Star · Spinning Top · Engulfed**

*Other candle clauses (5):* Filled Black Candle · Hollow Red Candle · Elder Bar Red · Elder Bar Blue · Elder Bar Green

*(StockCharts also ships 25 P&F pattern clauses — `PnF Bullish Catapult`, `PnF Triple Top Breakout`, etc. — which are chart patterns, not candles, and are out of scope here but confirm the vendor's habit of shipping named-pattern booleans.)*

*Separately, the **ChartSchool Candlestick Pattern Dictionary** documents 32 named entries with a neutral/bullish/bearish reversal/continuation tag:* Abandoned Baby (bearish reversal) · Dark Cloud Cover · Doji (neutral) · Downside Tasuki Gap (bearish continuation) · Dragonfly Doji (neutral) · Engulfing Pattern · Evening Doji Star · Evening Star · Falling Three Methods · Gravestone Doji (neutral) · Hammer · Hanging Man · Harami · Harami Cross · Inverted Hammer · **Long Body / Long Day (neutral)** · Long-Legged Doji (neutral) · **Long Shadows (neutral)** · Marubozu (neutral) · Morning Doji Star · Morning Star · Piercing Line · Rising Three Methods · Shooting Star · **Short Body / Short Day (neutral)** · Spinning Top (neutral) · Stars (neutral) · Stick Sandwich · Three Black Crows · Three White Soldiers · Upside Gap Two Crows · Upside Tasuki Gap.

**(2) Exact wording.** **Title Case with the direction as a PREFIX**: `Bullish Engulfing`, `Bearish Harami`. Building blocks are bare nouns: `Doji`, `Marubozu`, `Spinning Top`, `Engulfed`. Scan syntax renders each as a boolean clause, e.g. `[Hammer is true]`.

**(3) Surface.** A **filter/scan clause only** — the "Candlestick Patterns" tab of the Advanced Scan Workbench. There is **no candlestick-pattern results column**. Results come back as a symbol list; the user then looks at the chart. This is a real product gap on StockCharts' side and an opportunity.

**(4) One vs many / strength / color.** All clauses are **pure booleans** — "true/false clauses, indicating whether the pattern is currently present for that stock." **No strength score. No color coding.** A user can AND/OR building blocks together to synthesize a pattern StockCharts doesn't ship (e.g. `[Doji is true] AND [Uptrend is true]`).

**(5) Underlying numbers.** Not in the pattern clauses — but the building blocks *are* the numbers, re-expressed as booleans. `Long Body`, `Short Body`, `Marubozu`, `Spinning Top`, `Engulfed` are exactly the body-% / wick-% primitives, exposed as composable predicates. **This is the design that guarantees every bar is classifiable.**

**(6) Teaching.** The ChartSchool Candlestick Pattern Dictionary + Introduction to Candlesticks — long-form articles with idealized diagrams, each tagged neutral / bullish reversal / bearish reversal / continuation.

**(7) Gating.** Scan clauses require a logged-in member. Saved-scan limits by tier: Basic = 1 saved scan, Extra = up to 200, Pro = up to 500. The *clauses* are not individually gated; the *saving* is.

---

### A4. Barchart — 17 patterns, one dedicated screen per pattern

**(1) Complete list — 17, with live match counts observed on the page:**
Doji (88) · Doji Yesterday (67) · Doji and Near Doji (540) · Bullish Engulfing (158) · Bearish Engulfing (219) · Hammer (70) · Inverted Hammer (31) · Hanging Man (698) · Piercing Line (1) · Dark Cloud (5) · Bullish Harami (200) · Bearish Harami (224) · Morning Star (6) · Evening Star (12) · Bullish Kicker (19) · Bearish Kicker (69) · Shooting Star (41).

**(2) Exact wording.** **Title Case, direction as PREFIX**: `Bullish Engulfing`, `Bearish Harami`, `Bullish Kicker`. Two idiosyncrasies worth noting: it says **`Dark Cloud`** (not "Dark Cloud Cover") and **`Bullish Kicker` / `Bearish Kicker`** (TA-Lib and Thinkorswim say "Kicking"). It also ships **time-shifted variants** — `Doji Yesterday` — and a **loosened variant** — `Doji and Near Doji` — which is a smart, cheap way to turn one detector into three products.

**(3) Surface.** A **dedicated landing page per pattern** (`/investing-ideas/candlestick-patterns/stocks/engulfing-bullish`) plus an index page listing all 17 with a live `# Stocks` count and a one-line description. Each page has a **"screen" link that pushes those symbols into the general Stock Screener** for further filtering. It is a *list product*, not a column.

**(4) One vs many / strength / color.** **One pattern per screen** — the user picks the pattern first, then sees the stocks. No per-row multi-label, no strength score. Bullish/bearish is carried in the name and in the page's editorial framing.

**(5) Underlying numbers.** No. Result tables carry price/change/volume/opinion, not candle geometry.

**(6) Teaching.** Every pattern page opens with an editorial definition — e.g. Bullish Engulfing = "a strong reversal signal when it appears at the bottom"; Piercing Line = "a two-candle reversal signal formation that indicates a bullish pattern when it appears at bottom"; Bullish Kicker = "a two candle signal, indicating a radical change in investor sentiment towards the bullish side." Note the recurring **"when it appears at the bottom / at the top"** qualifier — Barchart teaches that context, not geometry, makes the signal.

**(7) Gating.** The pattern lists are **free** (delayed, refreshed ~every 10 minutes). Barchart applies a hard **universe filter** that is directly relevant here: *price between $2 and $10,000, and 20-day average volume > 10,000.* They do not run the detector on the whole tape — they run it on a liquid subset. Barchart Premier gates deeper history and download.

---

### A5. Finviz — 11 candlestick options; the "Pattern" filter is NOT candlesticks

**(1) Complete list — 11 candlestick filter options:**
Long Lower Shadow · Long Upper Shadow · Hammer · Inverted Hammer · Spinning Top White · Spinning Top Black · Doji · Dragonfly Doji · Gravestone Doji · Marubozu White · Marubozu Black.

**(2) Honest correction — the "Pattern" filter is chart patterns, not candlesticks.** Finviz's Technical tab has **two separate filters**. `Pattern` returns *multi-bar chart formations*: Horizontal S/R, TL Resistance, TL Support, Wedge Up, Wedge Down, Triangle Ascending, Triangle Descending, Wedge, Channel Up, Channel Down, Channel, Double Top, Double Bottom, Multiple Top, Multiple Bottom, Head & Shoulders, Head & Shoulders Inverse. Finviz's own help draws the line explicitly: a *candlestick* pattern is "a distinct formation of the Open, High, Low, and Close prices for given periods of time," whereas a *chart* pattern is "a distinct formation on a stock chart." **Anyone benchmarking "Finviz has 17 patterns" is counting the wrong filter.**

**(3) Surface.** A **filter only** (Technical tab dropdown). Finviz help records that both filters are **`Sorting: No | Export: No`** — meaning **there is no candlestick column in the results table, and the value cannot be exported.** This is the single clearest competitive opening in this report: the market leader in free screening cannot show you, or export, which candle each row printed.

**(4) One vs many / strength / color.** One selection at a time in the filter. No column, no multi-label, no strength, no color.

**(5) Underlying numbers.** No.

**(6) Teaching.** Minimal — a help page defining candlestick vs chart pattern generally. No per-pattern reference.

**(7) Gating.** Screener filters are free; Finviz Elite gates real-time data, export, and backtesting.

**Note for the implementer:** the memory file already records that finviz header matching is EXACT (case-sensitive) and that the finviz export has no cap filter. Finviz is the upstream for some columns here — but it **cannot be the upstream for a candle column**, because the field is neither sortable nor exportable. The candle column has to be computed locally from bars.

---

### A6. TrendSpider — 41 documented traditional definitions, 50+ selectable, 100+ claimed

**(1) Complete list — 41 patterns with published definitions**, verbatim:
3 Black Crows · Three Soldiers · Abandoned Baby · Advance Block · Belt Hold · Counter Attack · Dark Cloud Cover · Doji · Dragon Fly Doji · Engulfing · Evening Doji Star · Evening Star · Side by Side White Gap · Gravestone Doji · Hammer · Hanging Man · Harami · Harami Cross · High Wave · Homing Pigeon · In Neck · Inverted Hammer · Marubozu · Mat Hold · Morning Doji Star · Morning Star · On Neck · Piercing Pattern · Three Methods · Separating Lines · Shooting Star · Spinning Top · Stalled · Stick Sandwich · Tasuki Gap · Thrusting · Tristar · Upside Gap Two Crows · Gap Three Methods · **Raindrop/Balloon** · **Raindrop Double Flip**.

Beyond the traditional set, TrendSpider markets **"more than 100 auto-recognized candlestick patterns"** spanning three additional families: **Rob Smith's The Strat**, **Tom Bulkowski's The Pattern Site**, and **Newsome Candles**. The in-app Patterns menu exposes **50+** selectable entries.

**(2) Exact wording.** Title Case, **no direction word** — `Engulfing`, `Harami`, `Marubozu`. Direction is inferred from the bar's own color. Note the loose/abbreviated spellings: `3 Black Crows` (numeral), `Dragon Fly Doji` (three words), `Tristar` (one word), `Three Methods` and `Gap Three Methods` (direction-agnostic collapse of the Rising/Falling and Upside/Downside pairs).

**(3) Surface.** A **chart overlay with automatic labels**, toggled by a `Patterns` button that turns green when active; a three-dot menu opens a **searchable multi-select list showing the count of selected patterns at the top**. Patterns feed TrendSpider's scanner/alerts and its backtesting.

**(4) One vs many / strength / color.** Labels are drawn on the chart at each detection; multiple selected patterns can label the same region. **No published strength or reliability score.** Direction is read from the candle, not from a badge.

**(5) Underlying numbers.** The **definitions** are published in prose ("Short body with very long upper and lower shadows"; "High volume concentration above 60% of body"), so the user can see the rule — but the label itself carries no numbers. The Raindrop patterns are the exception and are **volume-distribution-aware**, which no other platform in this survey does.

**(6) Teaching.** A dedicated KB page — "Auto-Recognized Traditional Candlestick Pattern Definitions" — giving a one-line geometric definition per pattern. Hovering a chart label reveals the full pattern name.

**(7) Gating.** Paid product throughout (no free tier for automated analysis); pattern breadth increases with plan.

---

### A7. Investing.com — 30+ configurations, and the only mainstream RELIABILITY score

**(1) List — "more than 30 candlestick configurations."** Observed in the live filter/results: Harami Bullish · Doji Star Bearish · Harami Cross · Three Outside Down · Evening Star · Three Inside Down · Three Inside Up · Engulfing Bearish · Bullish Hammer · Morning Doji Star · Harami Bearish · Hanging Man · Falling Three Methods · Three Outside Up · Inverted Hammer · Belt Hold Bullish · Bullish doji Star · Bullish Engulfing · Deliberation Bearish · Evening Doji Star. *(Observed subset; the vendor claims 30+.)*

**(2) Exact wording — inconsistent, and instructively so.** The same product uses **suffix** (`Harami Bullish`, `Engulfing Bearish`, `Belt Hold Bullish`, `Deliberation Bearish`) *and* **prefix** (`Bullish Engulfing`, `Bullish Hammer`) *and* a casing bug (`Bullish doji Star`) in one dropdown. It is a live demonstration of what happens when the display vocabulary is not centrally owned.

**(3) Surface.** A **dedicated scanner screen** — main menu `Technical` → `Candlestick Patterns` — plus a per-asset panel on individual instrument pages and a portfolio view.

**(4) One vs many / strength / color.** Results are a **row per detection**, so one symbol can appear several times. Columns: **Name · Timeframe · Reliability · Pattern · Candle #**. `Candle #` is `Current / 1 / 2 / 3` — how many bars ago the pattern completed, which is a genuinely useful column nobody else ships. **Reliability is a three-tier ordinal: strong / medium / weak.** Filters exist for bullish vs bearish and for continuation vs reversal.

**(5) Underlying numbers.** No geometry exposed. The tool analyzes **the last 70 candles** of each timeframe and supports intervals from **15 minutes to 1 month**.

**(6) Teaching.** Each detection carries a pattern explanation and a directional read (continuation or reversal), drawn from an internal TA knowledge base.

**(7) Gating.** Broadly free; a free account is needed to persist filter preferences.

---

### A8. TA-Lib — 61 functions; the de-facto engine standard

Not a consumer platform, but **the vocabulary that most downstream products inherit** — if the implementer picks a detection library, this is almost certainly what it wraps, so its naming will leak into the product unless deliberately mapped.

**(1) Complete list — 61, function name → official human-readable description:**

`CDL2CROWS` Two Crows · `CDL3BLACKCROWS` Three Black Crows · `CDL3INSIDE` Three Inside Up/Down · `CDL3LINESTRIKE` Three-Line Strike · `CDL3OUTSIDE` Three Outside Up/Down · `CDL3STARSINSOUTH` Three Stars In The South · `CDL3WHITESOLDIERS` Three Advancing White Soldiers · `CDLABANDONEDBABY` Abandoned Baby · `CDLADVANCEBLOCK` Advance Block · `CDLBELTHOLD` Belt-hold · `CDLBREAKAWAY` Breakaway · `CDLCLOSINGMARUBOZU` Closing Marubozu · `CDLCONCEALBABYSWALL` Concealing Baby Swallow · `CDLCOUNTERATTACK` Counterattack · `CDLDARKCLOUDCOVER` Dark Cloud Cover · `CDLDOJI` Doji · `CDLDOJISTAR` Doji Star · `CDLDRAGONFLYDOJI` Dragonfly Doji · `CDLENGULFING` Engulfing Pattern · `CDLEVENINGDOJISTAR` Evening Doji Star · `CDLEVENINGSTAR` Evening Star · `CDLGAPSIDESIDEWHITE` Up/Down-gap side-by-side white lines · `CDLGRAVESTONEDOJI` Gravestone Doji · `CDLHAMMER` Hammer · `CDLHANGINGMAN` Hanging Man · `CDLHARAMI` Harami Pattern · `CDLHARAMICROSS` Harami Cross Pattern · `CDLHIGHWAVE` High-Wave Candle · `CDLHIKKAKE` Hikkake Pattern · `CDLHIKKAKEMOD` Modified Hikkake Pattern · `CDLHOMINGPIGEON` Homing Pigeon · `CDLIDENTICAL3CROWS` Identical Three Crows · `CDLINNECK` In-Neck Pattern · `CDLINVERTEDHAMMER` Inverted Hammer · `CDLKICKING` Kicking · `CDLKICKINGBYLENGTH` Kicking - bull/bear determined by the longer marubozu · `CDLLADDERBOTTOM` Ladder Bottom · `CDLLONGLEGGEDDOJI` Long Legged Doji · `CDLLONGLINE` Long Line Candle · `CDLMARUBOZU` Marubozu · `CDLMATCHINGLOW` Matching Low · `CDLMATHOLD` Mat Hold · `CDLMORNINGDOJISTAR` Morning Doji Star · `CDLMORNINGSTAR` Morning Star · `CDLONNECK` On-Neck Pattern · `CDLPIERCING` Piercing Pattern · `CDLRICKSHAWMAN` Rickshaw Man · `CDLRISEFALL3METHODS` Rising/Falling Three Methods · `CDLSEPARATINGLINES` Separating Lines · `CDLSHOOTINGSTAR` Shooting Star · `CDLSHORTLINE` Short Line Candle · `CDLSPINNINGTOP` Spinning Top · `CDLSTALLEDPATTERN` Stalled Pattern · `CDLSTICKSANDWICH` Stick Sandwich · `CDLTAKURI` Takuri (Dragonfly Doji with very long lower shadow) · `CDLTASUKIGAP` Tasuki Gap · `CDLTHRUSTING` Thrusting Pattern · `CDLTRISTAR` Tristar Pattern · `CDLUNIQUE3RIVER` Unique 3 River · `CDLUPSIDEGAP2CROWS` Upside Gap Two Crows · `CDLXSIDEGAP3METHODS` Upside/Downside Gap Three Methods.

**(2) Exact wording.** `SCREAMINGCAPS` machine names, human descriptions with inconsistent suffixes ("Pattern", "Candle", nothing). Several functions are **direction-agnostic and return a signed integer** (+100 bullish / −100 bearish / 0 none), notably `CDL3INSIDE`, `CDL3OUTSIDE`, `CDLENGULFING`, `CDLHARAMI`, `CDLMARUBOZU`, `CDLBELTHOLD`, `CDLTASUKIGAP`, `CDLRISEFALL3METHODS`, `CDLXSIDEGAP3METHODS`.

**(3)–(7)** Library, not a UI: no surface, no color, no tooltip, no gating. **Free (BSD).** Its practical relevance: it exposes a **signed magnitude**, which is the closest thing in the ecosystem to a machine-readable strength — and if wrapped naively, `CDLENGULFING` will produce the raw string `CDLENGULFING` in a UI, which is exactly what to avoid.

---

### A9. TC2000 — 90 named formulas, and the second "fallback taxonomy" precedent

**(1) Complete list — 19 basic candle formulas + 35 bullish + 36 bearish = 90.**

*Basic Candle Formulas (19) — every one of these classifies ANY bar:*
Black Candle · White Candle · Long Candle · Short Candle · Long Black Candle · Long White Candle · Short Black Candle · Short White Candle · Doji Candle · True Doji Candle · Marubozu Candle · Black Marubozu Candle · White Marubozu Candle · Opening Marubozu Candle · Closing Marubozu Candle · Black Opening Marubozu Candle · Black Closing Marubozu Candle · White Opening Marubozu Candle · White Closing Marubozu Candle.

**The formulas are published verbatim** — directly reusable as a specification:
```
Black Candle           C < O
White Candle           O < C
Long Candle            ABS(O - C) > 3 * AVG(ABS(O - C), 15) / 2
Short Candle           ABS(O - C) < AVG(ABS(O - C), 15) / 2
Doji Candle            20 * ABS(O - C) <= H - L
True Doji Candle       O = C
Marubozu Candle        H - L = ABS(O - C) AND H - L > 3 * AVG(ABS(O - C), 15) / 2
Opening Marubozu       (L = O OR O = H) AND H - L > ABS(O - C) AND ABS(O - C) > 3 * AVG(ABS(O - C), 15) / 2
Closing Marubozu       (L = C OR C = H) AND H - L > ABS(O - C) AND ABS(O - C) > 3 * AVG(ABS(O - C), 15) / 2
```
Note the design: **"long" and "short" are relative to a 15-bar average body**, not to an absolute threshold. That is how TC2000 makes a size label meaningful across a $3 stock and a $900 stock. A screener spanning ~3,700 tickers must do the same or the label will be worthless.

*Bullish (35):* Abandoned Baby · Belt Hold · Breakaway · Concealing Baby Swallow · Doji (Dragonfly) · Doji (Gravestone) · Doji Star (Unconfirmed Bullish Morning Doji Star) · Engulfing · Hammer/Dragonfly Doji · Harami · Harami Cross · Homing Pigeon · Inverted Hammer · Kicking · Ladder Bottom · Mat Hold · Matching Low · Meeting Lines · Morning Doji Star (Bullish Morning Star Variant) · Morning Star · Piercing Line · Rising Three Method · Separating Lines · Side by Side White Lines · Stick Sandwich · Three Inside Up (Confirmed Bullish Harami) · Three Line Strike · Three Outside Up (Confirmed Bullish Engulfing) · Three Stars in the South · Three White Soldiers · Tri Star · Tweezer Bottom · Unique Three River Bottom · Upside Gap Three Methods · Upside Tasuki Gap.

*Bearish (36):* Abandoned Baby · Advance Block · Belt Hold · Breakaway · Dark Cloud Cover · Deliberation · Downside Gap Three Methods · Downside Tasuki Gap · Doji Star · Doji (Gravestone) · Dragonfly Doji/Hanging Man · Engulfing · Evening Doji Star · Evening Star · Falling Three Methods · Grave Stone Doji/Shooting Star · Hanging Man · Harami (Bearish Harami Variant) · Harami Cross · Identical Three Crows · In Neck · Kicking · Meeting Lines · On Neck · Separating Lines · Shooting Star · Side-by-side White Lines · Three Black Crows · Three Inside Down · Three Line Strike · Three Outside Down (Confirmed Bearish Engulfing) · Thrusting · Tri Star · Tweezer Top · Two Crows · Upside Gap Two Crows.

**(2) Exact wording.** Title Case, **no direction word in the name** (direction comes from which table it's in), plus **parenthetical teaching annotations** — `Three Inside Up (Confirmed Bullish Harami)`, `Three Outside Up (Confirmed Bullish Engulfing)`, `Doji Star (Unconfirmed Bullish Morning Doji Star)`. That annotation pattern is worth stealing: it teaches the relationship between patterns inside the label itself.

**(3) Surface.** **Pre-Built condition tab** → boolean PCF conditions usable in scans, watchlist columns, and sorts.

**(4) One vs many / strength / color.** Booleans, stackable, no strength score.

**(5) Underlying numbers.** **Fully exposed** — the formula is visible and **every parameter is user-adjustable**: "Parameters are assigned default values based on either the standard interpretation of the pattern or a value that would return a generic version of the pattern, and you are encouraged to adjust these parameters to suit your definition." TC2000 is the most transparent platform in this survey.

**(6) Teaching.** Formula tables + per-pattern help pages.

**(7) Gating.** Requires a paid TC2000 tier for scanning at scale.

---

### A10. CandleScanner — 104 (20 basic + 84 patterns); the exhaustive ceiling

**(1) Complete list — 104.**

*Basic candles (20):* Black Candle · White Candle · Long Black Candle · Long White Candle · Short Black Candle · Short White Candle · Black Marubozu · White Marubozu · Closing Black Marubozu · Closing White Marubozu · Opening Black Marubozu · Opening White Marubozu · Black Spinning Top · White Spinning Top · Doji · Long-Legged Doji · Dragonfly Doji · Gravestone Doji · Four-Price Doji · High Wave.

*One-line patterns (10):* Bearish Belt Hold · Bullish Belt Hold · Hammer · Hanging Man · Southern Doji · Northern Doji · Takuri Line · Gapping Down Doji · Gapping Up Doji · One-Candle Shooting Star.

*Two-line patterns (35):* Bearish Doji Star · Bearish Engulfing · Bearish Harami · Bearish Harami Cross · Bearish Meeting Lines · Bearish Separating Lines · Bearish Tasuki Line · Dark Cloud Cover · Descending Hawk · Falling Window · Kicking Down · Last Engulfing Top · On Neck · Thrusting · Turn Down · Two Black Gapping Candles · Two-Candle Shooting Star · Tweezers Top · Bullish Doji Star · Bullish Engulfing · Bullish Harami · Bullish Harami Cross · Bullish Meeting Lines · Bullish Separating Lines · Bullish Tasuki Line · Homing Pigeon · Inverted Hammer · Kicking Up · Last Engulfing Bottom · Matching High · Matching Low · Piercing · Rising Window · Turn Up · Tweezers Bottom.

*Three-line patterns (28):* Advance Block · Bearish Abandoned Baby · Bearish Side-by-Side White Lines · Bearish Tri Star · Collapsing Doji Star · Deliberation · Evening Doji Star · Evening Star · Identical Three Crows · Three Black Crows · Three Inside Down · Three Outside Down · Two Crows · Upside Gap Two Crows · Bullish Abandoned Baby · Bullish Side-by-Side White Lines · Bullish Tri Star · Concealing Baby Swallow · Ladder Bottom · Morning Doji Star · Morning Star · Three Inside Up · Three Outside Up · Three Stars in the South · Three White Soldiers · Unique Three-River Bottom · Upside Gap Three Methods · Upside Tasuki Gap.

*Four-line (3):* Bearish Three-Line Strike · Bullish Three-Line Strike · Concealing Baby Swallow.
*Five-line (7):* Bearish Breakaway · Bullish Breakaway · Downside Gap Three Methods · Falling Three Methods · Ladder Top · Mat Hold · Rising Three Methods.

**(2) Exact wording.** Title Case with **direction as PREFIX** (`Bearish Engulfing`, `Bullish Harami Cross`) — except where the pattern name is inherently directional (`Dark Cloud Cover`, `Homing Pigeon`, `Rising Window`). Note `Tweezers Top` (plural) vs everyone else's `Tweezer Top`.

**(3) Surface.** Desktop software: chart labels + a scanner producing a per-pattern hit list.

**(4) One vs many / strength / color.** Multiple; grouped bullish/bearish; **the taxonomy itself is by candle count (1/2/3/4/5-line)**, which is a clean and honest organizing axis — it tells the user how much history the label consumed.

**(5) Underlying numbers.** Parameters are user-controllable, and the vendor is explicit that pattern definitions differ between authors: "even between well-known authors, and their publications, there are differences, and even contradictions."

**(6) Teaching.** A Patterns Dictionary with per-pattern effectiveness commentary.

**(7) Gating.** Paid desktop license (trial available).

---

### A11. MetaStock / Optuma / Amibroker — legacy, and thinner than their reputation

**MetaStock.** Ships **5 built-in explorations**: CandleStick Bearish Patterns (6), CandleStick Bullish Patterns (6), CandleStick Continuation Patterns (3), CandleStick Doji Patterns (8), CandleStick Reversal Patterns (12) — roughly 35 pattern slots. The formula language exposes candlestick functions (`Hammer()`, `EngulfingBull()`, `MorningStar()`, doji functions, etc.) via a Functions box with a "show English names" option that writes the formula for the user. **Critically, native recognition is considered inadequate by the vendor's own ecosystem: real pattern recognition requires the paid add-on "Greg Morris' Japanese Candle Pattern Recognition" (~$349 one-off)**, which adds automatic identification of "REAL Japanese patterns" plus trend filtering and automatic support/resistance. Morris's book documents 89 patterns. **Takeaway: the "exhaustive legacy library" is a paid bolt-on, not the base product.**

**Optuma.** Ships a **Candlestick Pattern Overlay** tool that "automatically highlights different candlestick patterns on the chart including multiple patterns at once" — bullish/bearish continuation (e.g. marabuzo), reversals (e.g. engulfing) and dojis — plus a **`CANDLESTICKPATTERN()` scripting function** for scanning. Named patterns confirmed in use: Bullish Engulfing, Bearish Engulfing, Doji, Bullish Hammer, Bullish Harami, Bearish Harami, **Bullish Hikkake**, Marabuzo. *(Optuma's KB returned HTTP 403 to automated fetch; this list is confirmed-partial, drawn from Optuma FAQ/forum content. Hikkake support is notable — only TA-Lib otherwise ships it.)*

**Amibroker.** No first-party pattern library. Recognition is community AFL: doji/long-legged doji/dragonfly/gravestone/hanging man identification formulas, long-shadow finders, candle-identification includes. **Effectively zero out-of-the-box parity.**

**Capture fields (all three):** surfaced as chart overlay + exploration/scan; multiple labels per bar; **no strength score anywhere**; numbers fully exposed because the user writes the formula; teaching is manual/book-based; MetaStock's real capability is **paid**.

---

### A12. Trade Ideas — 2 aggregate alerts, no per-pattern vocabulary

Ships exactly **two candlestick surfaces**: a **"Bullish Candlestick Patterns"** trading monitor ("identifies patterns including Hammers, Piercing and Engulfing Patterns") and a **"Bearish Candlestick Patterns"** monitor ("short-term patterns including Hanging Man, Dark Cloud Cover and Engulfing Patterns"). Both use "real-time Japanese Candlestick recognition algorithms."

**Wording:** the alert *window* is named, the individual pattern is not — a row says which alert fired, not which of the six patterns it was. **Surface:** a streaming alert window, filterable by price/volume/float. **One vs many:** one alert per event; no strength; direction is the window. **Numbers:** none. **Gating:** paid, real-time-focused.

**Takeaway:** Trade Ideas deliberately collapsed the vocabulary to two buckets. That is the opposite extreme from CandleScanner's 104, and it validates that "more names" is not automatically the right product — but it also means a per-row named label is a real differentiator against them.

---

### A13. ChartMill (partial)

Third-party lab testing reports ChartMill's screener **scans for 30 candlestick patterns**, and ChartMill publishes per-pattern definition articles (Bullish Engulfing, Bearish Harami, Bullish Hammer, etc.) under `/documentation/technical-analysis/candlestick-patterns/`. Its Technical Analysis Report evaluates chart and candlestick patterns per symbol. **ChartMill returned HTTP 403 to automated fetch; the count is vendor-adjacent, not vendor-primary. Treat as indicative only and excluded from the parity vote below.**

---

## B. THE PARITY LIST

**Method.** Ten platforms with a fully or substantially enumerated public list are treated as voters: **TV** TradingView (44) · **TOS** Thinkorswim (58) · **SC** StockCharts (17 clauses + 9 building blocks + 32 dictionary) · **BC** Barchart (17) · **FV** Finviz (11 candlestick options) · **TS** TrendSpider (41 documented) · **INV** Investing.com (20 observed of 30+) · **TAL** TA-Lib (61) · **TC** TC2000 (90) · **CS** CandleScanner (104). Optuma/MetaStock/Amibroker/Trade Ideas/ChartMill are excluded from the vote (partial or non-enumerated lists) but are discussed above.

**Union size: 92 canonical structures** (counting a bullish/bearish pair as one canonical family, e.g. "Engulfing" covers Bullish and Bearish Engulfing). Expanded to directional variants the union is **~140 distinct labels**.

Investing.com's list is a confirmed subset, so counts that would include INV are conservative (marked with a leading `≥` where INV plausibly ships it but it was not directly observed).

### Tier 1 — TABLE STAKES (7+ of 10 platforms)

| # | Canonical name | Platforms | Count |
|---|---|---|---|
| 1 | **Hammer** | TV TOS SC BC FV TS INV TAL TC CS | **10** |
| 2 | **Inverted Hammer** | TV TOS SC BC FV TS INV TAL TC CS | **10** |
| 3 | **Doji** | TV TOS SC BC FV TS TAL TC CS | **9** |
| 4 | **Engulfing (Bullish)** | TV TOS SC BC TS INV TAL TC CS | **9** |
| 5 | **Engulfing (Bearish)** | TV TOS SC BC TS INV TAL TC CS | **9** |
| 6 | **Hanging Man** | TV TOS SC BC TS INV TAL TC CS | **9** |
| 7 | **Harami (Bullish)** | TV TOS SC BC TS INV TAL TC CS | **9** |
| 8 | **Harami (Bearish)** | TV TOS SC BC TS INV TAL TC CS | **9** |
| 9 | **Evening Star** | TV TOS SC BC TS INV TAL TC CS | **9** |
| 10 | **Morning Star** | TV TOS SC BC TS TAL TC CS | **8** |
| 11 | **Shooting Star** | TV TOS SC BC TS TAL TC CS | **8** |
| 12 | **Dark Cloud Cover** | TV TOS SC BC TS TAL TC CS | **8** |
| 13 | **Piercing Line** | TV TOS SC BC TS TAL TC CS | **8** |
| 14 | **Harami Cross** | TV TOS SC TS INV TAL TC CS | **8** |
| 15 | **Marubozu (White/Black)** | TV TOS SC FV TS TAL TC CS | **8** |
| 16 | **Evening Doji Star** | TV TOS SC TS INV TAL TC CS | **8** |
| 17 | **Morning Doji Star** | TV TOS SC TS INV TAL TC CS | **8** |
| 18 | **Falling Three Methods** | TV TOS SC TS INV TAL TC CS | **8** |
| 19 | **Rising Three Methods** | TV TOS SC TS TAL TC CS | **7** |
| 20 | **Three White Soldiers** | TV TOS SC TS TAL TC CS | **7** |
| 21 | **Three Black Crows** | TV TOS SC TS TAL TC CS | **7** |
| 22 | **Dragonfly Doji** | TV SC FV TS TAL TC CS | **7** |
| 23 | **Gravestone Doji** | TV SC FV TS TAL TC CS | **7** |
| 24 | **Abandoned Baby** | TV TOS SC TS TAL TC CS | **7** |
| 25 | **Upside Tasuki Gap** | TV TOS SC TS TAL TC CS | **7** |

### Tier 2 — STRONG PARITY (5–6 of 10)

| # | Canonical name | Platforms | Count |
|---|---|---|---|
| 26 | **Spinning Top (White/Black)** | TV SC FV TS TAL CS | 6 |
| 27 | **Downside Tasuki Gap** | TV TOS SC TS TAL TC | 6 |
| 28 | **Tri-Star** | TV TOS TS TAL TC CS | 6 |
| 29 | **Kicking / Kicker** | TV TOS BC TAL TC CS | 6 |
| 30 | **On Neck** | TV TOS TS TAL TC CS | 6 |
| 31 | **Upside Gap Two Crows** | TOS SC TS TAL TC CS | 6 |
| 32 | **Belt Hold** | TOS INV TAL TC CS | 5 |
| 33 | **Three Inside Up / Down** | TOS INV TAL TC CS | 5 |
| 34 | **Three Outside Up / Down** | TOS INV TAL TC CS | 5 |
| 35 | **Separating Lines** | TOS TS TAL TC CS | 5 |
| 36 | **Side-by-Side White Lines** | TOS TS TAL TC CS | 5 |
| 37 | **Deliberation / Stalled Pattern** | TOS INV TS TAL CS | 5 |
| 38 | **Thrusting** | TOS TS TAL TC CS | 5 |
| 39 | **Upside/Downside Gap Three Methods** | TOS TS TAL TC CS | 5 |
| 40 | **Doji Star (Bullish/Bearish)** | TV INV TAL TC CS | 5 |
| 41 | **Long-Legged Doji** | TOS SC TAL CS | 4* |
| 42 | **Meeting Lines / Counterattack** | TOS TS TAL TC CS | 5 |

### Tier 3 — MID PARITY (3–4 of 10)

Three-Line Strike (TOS TAL TC CS = 4) · Breakaway (TOS TAL TC CS = 4) · Advance Block (TOS TS TAL CS = 4) · Concealing Baby Swallow (TOS TAL TC CS = 4) · Matching Low (TOS TAL TC CS = 4) · Mat Hold (TOS TAL TC CS = 4) · Three Stars in the South (TOS TAL TC CS = 4) · Unique Three River Bottom (TOS TAL TC CS = 4) · Two Crows (TOS TAL TC CS = 4) · Identical Three Crows (TOS TAL TC CS = 4) · In Neck (TOS TS TAL TC = 4) · Stick Sandwich (SC TS TAL TC = 4) · Long-Legged Doji (4) · Homing Pigeon (TOS TAL CS = 3) · High Wave (TS TAL CS = 3) · Ladder Bottom/Top (TAL TC CS = 3) · Closing Marubozu (TAL TC CS = 3) · Long Body / Long Line Candle (SC TAL TC = 3) · Short Body / Short Line Candle (SC TAL TC = 3) · Long Upper Shadow / Long Lower Shadow (TV SC FV = 3) · Tweezer Top / Tweezer Bottom (TV TC CS = 3).

### Tier 4 — DIFFERENTIATORS (1–2 of 10)

Rising Window / Falling Window (TV CS = 2) · Hikkake + Modified Hikkake (TAL, Optuma = 2) · Takuri (TAL CS = 2) · Rickshaw Man (TAL = 1) · Four-Price Doji (CS = 1) · Williams Fractal (TOS = 1) · Zig Zag Step Pattern (TOS = 1) · One White Soldier / One Black Crow (TOS = 1) · High Price Gapping Play / Low Price Gapping Play (TOS = 1) · Engulfed *(building block)* (SC = 1) · Star *(building block)* (SC = 1) · Uptrend / Downtrend *(building block)* (SC = 1) · Hollow Red Candle / Filled Black Candle (SC = 1) · Elder Bar Red/Blue/Green (SC = 1) · Descending Hawk (CS = 1) · Last Engulfing Top / Bottom (CS = 1) · Turn Up / Turn Down (CS = 1) · Two Black Gapping Candles (CS = 1) · Matching High (CS = 1) · Collapsing Doji Star (CS = 1) · Northern Doji / Southern Doji (CS = 1) · Gapping Up Doji / Gapping Down Doji (CS = 1) · Two-Candle Shooting Star (CS = 1) · Raindrop / Balloon (TS = 1) · Raindrop Double Flip (TS = 1) · Doji Yesterday, Doji and Near Doji (BC = 1).

### The separate, decisive axis: BASIC-CANDLE FALLBACK

Three platforms ship a taxonomy whose explicit purpose is that **no bar goes unlabeled**. This is *not* in the pattern tiers above and is the most product-relevant finding for the dash problem:

| Fallback vocabulary | StockCharts ("Building Blocks") | TC2000 ("Basic Candle Formulas") | CandleScanner ("Basic Candles") |
|---|---|---|---|
| Body size | Long Body, Short Body | Long Candle, Short Candle, Long/Short Black/White Candle | Long/Short Black/White Candle |
| Body ≈ 0 | Doji | Doji Candle, True Doji Candle | Doji, Four-Price Doji |
| No wicks | Marubozu | Marubozu + Opening/Closing × Black/White (7 variants) | Marubozu + Opening/Closing × Black/White (6) |
| Small body, both wicks | Spinning Top | — | Black/White Spinning Top, High Wave |
| Direction | Uptrend, Downtrend | Black Candle, White Candle | Black Candle, White Candle |
| Relation to prior bar | Engulfed, Star | — | — |

**3 of 10 platforms guarantee full coverage.** The other seven leave rows blank. That is the gap this product can own.

---

## C. THE GAP ANALYSIS

Current column vocabulary (7): `hammer` · `shooting-star` · `doji` · `marubozu` · `bullish-engulfing` · `bearish-engulfing` · `spinning-top`.

Against the parity list, the product currently ships **7 of 25 Tier-1 structures (28%)** and **7 of 92 canonical structures (7.6%)**.

### C1. Missing Tier-1 structures, ranked by competitor count

| Rank | Missing pattern | Competitors shipping | Bars needed | Notes |
|---|---|---|---|---|
| 1 | **Inverted Hammer** | **10 / 10** | 1 | The only pattern shipped by *every single platform surveyed* that this product lacks. It is the mirror of an existing detector (`shooting-star` geometry, different trend context). Cheapest possible win. |
| 2 | **Hanging Man** | 9 | 1 | Same geometry as `hammer`, opposite trend context. Requires a trend qualifier, not new geometry. |
| 3 | **Bullish Harami** | 9 | 2 | |
| 4 | **Bearish Harami** | 9 | 2 | |
| 5 | **Evening Star** | 9 | 3 | |
| 6 | **Morning Star** | 8 | 3 | |
| 7 | **Dark Cloud Cover** | 8 | 2 | |
| 8 | **Piercing Line** | 8 | 2 | |
| 9 | **Harami Cross** | 8 | 2 | Trivially derived once Harami + Doji both exist. |
| 10 | **Evening Doji Star** | 8 | 3 | Derived from Evening Star + Doji. |
| 11 | **Morning Doji Star** | 8 | 3 | Derived from Morning Star + Doji. |
| 12 | **Falling Three Methods** | 8 | 5 | |
| 13 | **Rising Three Methods** | 7 | 5 | |
| 14 | **Three White Soldiers** | 7 | 3 | |
| 15 | **Three Black Crows** | 7 | 3 | |
| 16 | **Dragonfly Doji** | 7 | 1 | Pure geometry, single bar. Already 90% implemented if `doji` exists. |
| 17 | **Gravestone Doji** | 7 | 1 | Same. |
| 18 | **Abandoned Baby** | 7 | 3 | Needs gap detection. |
| 19 | **Upside Tasuki Gap** | 7 | 3 | Needs gap detection. |

**Observation: 4 of the top 17 misses (Inverted Hammer, Hanging Man, Dragonfly Doji, Gravestone Doji) are single-bar, geometry-only, and are near-free given the detectors already shipped.** Adding just those four moves Tier-1 coverage from 7/25 to 11/25 (28% → 44%) with no new bar-history requirement.

### C2. Structural gaps beyond the name list

| Gap | Who has it | Severity |
|---|---|---|
| **A basic-candle fallback so no row shows a dash** | SC, TC, CS (3/10) | **Highest.** The owner's stated goal — "every stock receives a meaningful, uniquely-identified candle structure" — is *exactly* this feature, and it is the one where 7 of 10 rivals are also weak. |
| **Multiple labels per bar with a precedence order** | TV (up to 4, strength-ordered), TOS, TS, CS | High. A single-label column must have a *documented, deterministic* precedence rule or the same bar will show different labels across runs. |
| **A strength / reliability tier** | TV (Strong/Medium/Weak), INV (strong/medium/weak) | High. Two of the three most consumer-facing platforms grade patterns. Without it, `Doji` and `Three White Soldiers` look equally important in a column. |
| **A continuation vs reversal axis** | TV, INV, SC dictionary | Medium. Cheap to add as metadata, filters well. |
| **Bullish/bearish color coding in the column** | TV (green/red miniatures), TOS (folder taxonomy) | High. Zero-cost visual scanability. |
| **Gap-aware patterns (Windows, Tasuki, Abandoned Baby, Kicking)** | TV, TOS, TAL, TC, CS | Medium. Requires gap detection, which the pipeline may not have. |
| **A trend qualifier** (Hammer vs Hanging Man are the SAME shape) | TOS folders, SC `Uptrend`/`Downtrend` blocks, MetaStock add-on, Barchart's editorial "when it appears at the bottom" | **High and under-appreciated.** Roughly a third of the Tier-1 list is only disambiguated by prior trend. Without a trend input, Hammer/Hanging Man and Shooting Star/Inverted Hammer cannot be told apart, and the labels are *wrong*, not merely missing. |
| **"Bars ago" for the detection** | INV (`Candle #`: Current/1/2/3) | Low-Medium. Nobody else ships it; genuinely differentiating for a *newest-bar* column ("this fired 2 bars ago"). |
| **Exposing body% / wick% numbers** | TC2000 (formulas + adjustable params), CS (params), TS (published definitions) | Medium. No *web* screener exposes the geometry. Doing so — e.g. a `body_pct` and `upper_wick_pct` column alongside `candle` — would be unmatched among web competitors and directly serves the existing 185-column model. |
| **Timeframe selection on the pattern** | TV (1m–1M, intraday paid), INV (15m–1M) | Low for a daily-bar product; note as a future monetization lever mirroring TradingView's. |
| **Size normalized to a rolling average body** | TC2000 (`3 * AVG(ABS(O-C),15) / 2`) | **Critical correctness item.** Any "long"/"short"/"marubozu" label must be relative to the symbol's own recent bodies, or it will fire constantly on high-vol names and never on low-vol ones across a 3,700-name universe. |

### C3. Where competitors are weak (the openings)

1. **Finviz** — candlestick filter exists but is **`Sorting: No | Export: No`** and has **no results column**. A sortable, exportable candle column beats the most-used free screener outright.
2. **StockCharts** — booleans only, **no results column**, no color, no strength.
3. **Barchart** — one pattern per page; you cannot see *what candle a given stock printed* without visiting 17 pages.
4. **Trade Ideas** — two buckets, no per-pattern name at all.
5. **TradingView** — the strongest competitor, but it is **glyph-first**: it shows a picture, not a word. A **word-first, sortable, exportable, text-searchable** column is differentiated from it, and reads better in a CSV, an alert, or a Discord post.
6. **Nobody** exposes the geometry numbers on the web. Nobody except Investing.com says how many bars ago it fired.

---

## D. DISPLAY-NAME RECOMMENDATION

### D1. The naming convention decision

**Survey of conventions actually shipped:**

| Convention | Platforms |
|---|---|
| Direction as **prefix** — `Bullish Engulfing` | StockCharts, Barchart, CandleScanner, ChartMill, Investing.com (partly) |
| Direction as **suffix** — `Engulfing - Bullish` | TradingView, Investing.com (partly) |
| **No direction word**, taxonomy carries it | Thinkorswim, TC2000, TrendSpider, TA-Lib |
| `SCREAMINGCAPS` machine token | TA-Lib only (never user-facing in a good product) |
| `PascalCaseNoSpaces` | Thinkorswim only |

**Recommendation: Title Case, direction as a PREFIX, and only where the base name is directionally ambiguous.** Prefix is the plurality convention among *consumer web* products (StockCharts, Barchart, CandleScanner, ChartMill), it sorts sensibly in a filter dropdown, and it front-loads the word the eye needs when scanning a narrow left-aligned column. TradingView's suffix form exists to keep pairs adjacent in an alphabetical dropdown — a dropdown problem, not a column problem — and TradingView is itself inconsistent about it (`Bearish Harami` vs `Harami Cross - Bearish` vs `On Neck (Bearish)`).

**Do not add a direction word to a name that already carries direction.** `Morning Star`, `Dark Cloud Cover`, `Hanging Man`, `Shooting Star`, `Three White Soldiers`, `Tweezer Top`, `Rising Window` need no prefix, and every platform that adds one (TradingView's `Morning Star - Bullish`, `Three White Soldiers - Bullish`) is wasting 10 characters of column width on redundancy.

**Keep the current lowercase-hyphenated strings as the STABLE MACHINE KEY.** Add a separate display label. Renaming the stored values would silently re-select every saved screen that filters on candle — the exact failure mode this repo already recorded when Wilder RSI changed and saved RSI scans reselected. `candle` (machine, unchanged, plus new keys) and `candle_label` (display) must be two fields.

### D2. Recommended display vocabulary

**Phase 1 — close the Tier-1 gap (25 pattern labels).** Sorted by parity count; the 7 already shipped are marked ✅.

| Machine key (stable, lowercase-hyphen) | Display label | Dir | Strength | Type | Bars | Parity |
|---|---|---|---|---|---|---|
| `bullish-engulfing` ✅ | Bullish Engulfing | ▲ | Strong | Reversal | 2 | 9 |
| `bearish-engulfing` ✅ | Bearish Engulfing | ▼ | Strong | Reversal | 2 | 9 |
| `hammer` ✅ | Hammer | ▲ | Medium | Reversal | 1 | 10 |
| `inverted-hammer` | Inverted Hammer | ▲ | Medium | Reversal | 1 | **10** |
| `hanging-man` | Hanging Man | ▼ | Medium | Reversal | 1 | 9 |
| `shooting-star` ✅ | Shooting Star | ▼ | Medium | Reversal | 1 | 8 |
| `doji` ✅ | Doji | ◆ | Weak | Neutral | 1 | 9 |
| `dragonfly-doji` | Dragonfly Doji | ▲ | Weak | Reversal | 1 | 7 |
| `gravestone-doji` | Gravestone Doji | ▼ | Weak | Reversal | 1 | 7 |
| `long-legged-doji` | Long-Legged Doji | ◆ | Weak | Neutral | 1 | 4 |
| `bullish-harami` | Bullish Harami | ▲ | Medium | Reversal | 2 | 9 |
| `bearish-harami` | Bearish Harami | ▼ | Medium | Reversal | 2 | 9 |
| `bullish-harami-cross` | Bullish Harami Cross | ▲ | Medium | Reversal | 2 | 8 |
| `bearish-harami-cross` | Bearish Harami Cross | ▼ | Medium | Reversal | 2 | 8 |
| `piercing-line` | Piercing Line | ▲ | Medium | Reversal | 2 | 8 |
| `dark-cloud-cover` | Dark Cloud Cover | ▼ | Medium | Reversal | 2 | 8 |
| `morning-star` | Morning Star | ▲ | Strong | Reversal | 3 | 8 |
| `evening-star` | Evening Star | ▼ | Strong | Reversal | 3 | 9 |
| `morning-doji-star` | Morning Doji Star | ▲ | Strong | Reversal | 3 | 8 |
| `evening-doji-star` | Evening Doji Star | ▼ | Strong | Reversal | 3 | 8 |
| `three-white-soldiers` | Three White Soldiers | ▲ | Strong | Reversal | 3 | 7 |
| `three-black-crows` | Three Black Crows | ▼ | Strong | Reversal | 3 | 7 |
| `marubozu` ✅ → split | White Marubozu / Black Marubozu | ▲/▼ | Medium | Continuation | 1 | 8 |
| `spinning-top` ✅ | Spinning Top | ◆ | Weak | Neutral | 1 | 6 |
| `abandoned-baby-bullish` / `-bearish` | Bullish Abandoned Baby / Bearish Abandoned Baby | ▲/▼ | Strong | Reversal | 3 | 7 |

*Note on `marubozu`:* every platform that ships it splits by body color (`Marubozu White - Bullish` TV; `White Marubozu` CS; `Black Marubozu Candle` TC; `Marubozu White` FV). A single undirected `marubozu` label cannot be color-coded and is the weakest of the current seven. **Recommend splitting into `white-marubozu` / `black-marubozu`, keeping `marubozu` as a filter-level parent.**

**Phase 2 — the fallback taxonomy (never show a dash).** These are what the ~85% of rows currently showing `—` should show. Precedent: StockCharts Building Blocks, TC2000 Basic Candle Formulas, CandleScanner Basic Candles.

| Machine key | Display label | Dir | Rule sketch (normalize to 15-bar avg body, per TC2000) |
|---|---|---|---|
| `long-white-candle` | Long White Candle | ▲ | `C>O` and `body > 1.5 × avg15(body)` |
| `long-black-candle` | Long Black Candle | ▼ | `O>C` and `body > 1.5 × avg15(body)` |
| `short-white-candle` | Short White Candle | ▲ | `C>O` and `body < 0.5 × avg15(body)` |
| `short-black-candle` | Short Black Candle | ▼ | `O>C` and `body < 0.5 × avg15(body)` |
| `white-candle` | White Candle | ▲ | `C>O`, otherwise unremarkable |
| `black-candle` | Black Candle | ▼ | `O>C`, otherwise unremarkable |
| `high-wave` | High Wave | ◆ | tiny body, both wicks very long (TAL/TS/CS ship this) |
| `four-price-doji` | Four-Price Doji | ◆ | `O=H=L=C` (CS ships this; also the honest label for halted/illiquid rows) |

With Phase 1 + Phase 2, **coverage is 100% by construction** — a bar that matches no named pattern still resolves to one of eight basic candles. **This is the feature. No competitor except three desktop/legacy tools guarantees it, and none of them puts it in a full-market web screener column.**

### D3. Column width and scanability

- **Longest Phase-1 label:** `Bearish Harami Cross` = 20 chars. `Three White Soldiers` = 20. `Bullish Abandoned Baby` = 22.
- **Longest if Tier-2/3 are added later:** `Concealing Baby Swallow` = 23, `Downside Gap Three Methods` = 26.
- **Recommendation:** size the column to **~22ch / ~180px**, left-aligned, `text-overflow: ellipsis`, full label in the `title` tooltip. Do not abbreviate in the data (`Falling 3 Methods`) — abbreviation in the stored label breaks CSV export and search; abbreviate only in CSS.
- **Avoid ALL-CAPS and avoid the TA-Lib token** — `CDLENGULFING` in a user-facing column is an instant tell that the column is a thin library wrapper.
- **Sort order:** the column must sort *by strength then alphabetically*, not raw-alphabetically, or `Abandoned Baby` and `Black Candle` land adjacent and the column reads as noise. TradingView's ordering rule ("strongest first, weakest single-candle signals last") is the right precedent.

### D4. Color coding

Follow TradingView's semantics, not its palette:

| Direction | Token | Applies to |
|---|---|---|
| Bullish ▲ | the existing screener green | Bullish Engulfing, Hammer, Inverted Hammer, Morning Star, Piercing Line, Three White Soldiers, White Marubozu, Long White Candle, … |
| Bearish ▼ | the existing screener red | Bearish Engulfing, Hanging Man, Shooting Star, Evening Star, Dark Cloud Cover, Three Black Crows, Black Marubozu, Long Black Candle, … |
| Neutral ◆ | muted foreground | Doji, Long-Legged Doji, Spinning Top, High Wave, Four-Price Doji |

Rules that matter: (a) **color the text, not a filled chip** — 3,700 rows of colored chips is visual noise; (b) **never rely on color alone** — the direction word or an inherently-directional name must carry the meaning for colorblind users and for CSV export; (c) **the neutral tier is load-bearing** — it is what visually demotes the fallback rows so the real signals still pop, which is the whole reason "no dashes" doesn't become "all noise".

### D5. Tooltip / teaching

Every platform teaches. The two patterns worth copying:
- **Barchart's contextual one-liner** — "a strong reversal signal **when it appears at the bottom**." Context, not geometry.
- **TC2000's parenthetical cross-reference** — `Three Inside Up (Confirmed Bullish Harami)`. Teaches the family relationship inside the label.

**Recommended tooltip shape (three lines):**
```
Bullish Harami
Reversal · Medium · 2 bars
A small up-body contained inside the prior large down-body — selling pressure stalled.
```
Optionally append the geometry, which no web competitor shows: `body 18% of range · lower wick 61%`.

### D6. What NOT to build

- **Do not chase 100+ patterns.** CandleScanner's 104 and TrendSpider's 100+ are desktop/paid niche plays. TradingView, the actual competitor, ships 44, and 25 canonical structures covers all of Tier 1.
- **Do not ship Tier-4 proprietary patterns** (Raindrop, Zig Zag Step, Descending Hawk). One platform each; no user is asking.
- **Do not ship a strength score you cannot defend.** TradingView's Strong/Medium/Weak is an editorial taxonomy, not a backtest. Ship it as *pattern class* metadata (which is defensible and matches TV/Investing.com), and do not label it "reliability" or "probability" unless it is measured. This repo has an explicit standing lesson that a `0` meaning "unknown" sorts and filters — the same trap applies to a fabricated strength number.
- **Do not label Hammer vs Hanging Man without a trend input.** Same geometry, opposite meaning. Shipping both from geometry alone produces labels that are *wrong*, which is worse than the dash they replace.

---

## E. SOURCES

**TradingView**
- https://www.tradingview.com/support/solutions/43000752737-candlestick-pattern-in-screener/ — the 44-pattern table with Signal strength / Signal type (also fetched via https://in.tradingview.com/support/solutions/43000752737-candlestick-pattern-in-screener/)
- https://www.tradingview.com/blog/en/candlestick-patterns-in-screener-59644/ — screener column behavior, 4 miniatures, `+N` counter, green/red, intraday paid gating
- https://www.tradingview.com/support/solutions/43000584462-automatic-candlestick-pattern-detection/ — chart labels blue/red/gray, tooltips, Technicals → Patterns
- https://www.tradingview.com/blog/en/new-indicators-to-search-for-candlestick-patterns-18937/ — indicator category, alerts integration
- https://www.tradingview.com/support/solutions/43000745269-introduction-to-candlestick-charts-and-patterns/ — one-to-five-candle taxonomy, reversal/continuation/neutral

**Thinkorswim / Schwab**
- https://toslc.thinkorswim.com/center/reference/Patterns/candlestick-patterns-library
- https://toslc.thinkorswim.com/center/reference/Patterns/candlestick-patterns-library/bearish-and-bullish — 17
- https://toslc.thinkorswim.com/center/reference/Patterns/candlestick-patterns-library/bullish-only — 20
- https://toslc.thinkorswim.com/center/reference/Patterns/candlestick-patterns-library/bearish-only — 21
- https://toslc.thinkorswim.com/center/howToTos/thinkManual/charts/Patterns/Candlestick-Pattern-Editor
- https://toslc.thinkorswim.com/center/howToTos/thinkManual/charts/Patterns/using-candlestick-patterns

**StockCharts**
- https://help.stockcharts.com/scanning-and-alerts/scan-writing-resource-center/scan-syntax-reference/scan-syntax-predefined-patterns — 17 pattern clauses, 9 building blocks, 25 P&F clauses
- https://help.stockcharts.com/scanning-and-alerts/technical-scans/advanced-scan-workbench — true/false clauses, saved-scan tier limits
- https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-pattern-dictionary — 32-entry dictionary with neutral/bullish/bearish tags
- https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/introduction-to-candlesticks

**Barchart**
- https://www.barchart.com/investing-ideas/candlestick-patterns/stocks — the 17-pattern index with live counts and the $2–$10,000 / 20-day-vol >10,000 universe rule
- https://www.barchart.com/investing-ideas/candlestick-patterns/stocks/engulfing-bullish
- https://www.barchart.com/investing-ideas/candlestick-patterns/stocks/kicker-bullish
- https://www.barchart.com/investing-ideas/candlestick-patterns/stocks/piercing-line
- https://www.barchart.com/education/site-features/candlesticks

**Finviz**
- https://finviz.com/help/screener — Technical tab; Candlestick and Pattern are separate filters; both `Sorting: No | Export: No`
- https://finviz.com/help/technical-analysis/charts-patterns — the chart-pattern list (wedges, triangles, channels, tops/bottoms, H&S) confirming Pattern ≠ candlesticks

**TrendSpider**
- https://help.trendspider.com/kb/automated-technical-analysis/auto-recognized-traditional-candlestick-pattern-definitions — 41 patterns with definitions
- https://help.trendspider.com/kb/automated-technical-analysis/types-of-automated-analysis
- https://help.trendspider.com/kb/automated-technical-analysis
- https://trendspider.com/blog/utilizing-the-candlestick-pattern-recognition-feature-trendspider-user-guide/ — 50+ selectable, Patterns button, searchable multi-select
- https://trendspider.com/trading-tools-store/indicators/candlestick-pattern-detection-labeling/

**Investing.com**
- https://www.investing.com/technical/candlestick-patterns — live scanner; columns Name / Timeframe / Reliability / Pattern / Candle #
- https://www.investing.com/blog/what-does-the-chart-say-find-out-with-candlestick-patterns-137 — 30+ configurations, strong/medium/weak reliability, 15m–1M, last 70 candles

**TA-Lib**
- https://ta-lib.github.io/ta-lib-python/func_groups/pattern_recognition.html — all 61 CDL* functions with human-readable descriptions
- https://ta-lib.github.io/ta-lib-python/funcs.html

**TC2000**
- https://help.tc2000.com/m/69445/c/226486 — Candlestick Patterns section index
- https://help.tc2000.com/m/69445/l/798543-basic-candle-formulas-table — 19 basic candle formulas with published PCF source
- https://help.tc2000.com/m/69445/l/800589-bullish-candlestick-patterns-formulas-table — 35 bullish
- https://help.tc2000.com/m/69445/l/800590-bearish-candlestick-patterns-formulas-table — 36 bearish
- https://help.tc2000.com/m/69445/l/1745234-pre-built-candlestick-pattern-formulas

**CandleScanner**
- https://www.candlescanner.com/candlestick-patterns/patterns-supported-by-candlescanner/ — 20 basic candles + 84 patterns, grouped by candle count
- https://www.candlescanner.com/patterns-dictionary/
- https://www.candlescanner.com/candlescanner-overview/

**MetaStock / Optuma / Amibroker**
- https://www.metastock.com/products/thirdparty/?3pc-add-jcpr= — Greg Morris' Japanese Candle Pattern Recognition add-on (~$349)
- https://forum.metastock.com/posts/m176116findunread-Finding-candlesticks-patterns-in-explorer — the 5 built-in explorations (6/6/3/8/12)
- https://www.optuma.com/kb/optuma/tools/price/candlestick-pattern-overlay — *(HTTP 403 to automated fetch; content confirmed via Optuma FAQ + community)*
- https://www.optuma.com/kb/optuma/scripting/formulas-and-scripting-functions/candlestick-pattern-function — *(HTTP 403)*
- https://help.optuma.com/kb/faq.php?id=780
- https://www.wisestocktrader.com/indicators/744-candle-identification — Amibroker community AFL

**Trade Ideas**
- https://www.trade-ideas.com/GettingStarted.html?name=Bullish+Candlestick+Patterns&list_name=MAIN
- https://www.trade-ideas.com/GettingStarted.html?name=Bearish+Candlestick+Patterns&list_name=MAIN
- https://www.trade-ideas.com/ProductHelp.html

**ChartMill (partial — 403 to automated fetch)**
- https://www.chartmill.com/documentation/candlestick-patterns
- https://www.liberatedstocktrader.com/chartmill-review/ — third-party report of "30 candlestick patterns"

**Cross-platform comparison**
- https://www.liberatedstocktrader.com/candlestick-pattern-analysis-recognition-software/ — 2026 comparative test of pattern-recognition tools

**Fetch failures recorded for honesty:** Optuma KB (403 ×2), ChartMill documentation + screener (403 ×2), `tradingview.com/support/solutions/43000594687-all-candlestick-patterns/` (404 — superseded by the screener support page), `help.trendspider.com/.../candlestick-pattern-recognition` (404). MetaStock's and Optuma's full lists are therefore *confirmed-partial* and were excluded from the parity vote.
