# UCT Relative Strength — design plan v3

**Status:** 🟡 PLAN v3, for owner review (2026-11-05, evening). No implementation alongside it.
**Base:** `origin/master` `3e11e6bf63`. **Branch:** `docs/uct-rs-indicator`. **PR:** #875 (draft).
**Owner asks, in order:** (1) make the chart widget's RS indicator "elite to an extreme level", MarketSmith / MarketSurge / Deepvue / TradingView and beyond; (2) combine that with Chartmaster's library and the RS indicator he uses; (3) get the plan to 99/100; (4) **"far too much emphasis on Chartmaster posts vs relative strength indicators and studies of public indicators"** — spend significant time on the knowledge, understanding and usefulness of RS indicators, and put a huge emphasis on **user friendliness, customization and the Uncharted Territory brand**, designing for the members who will use it; (5) be extremely detailed and thorough throughout, with reliability from research and observation.

**How this document is sourced.** Every claim carries one of three kinds of backing. **Research** claims cite the knowledge base at `docs/research/relative-strength/` by file and section (`01 §2` = `01-methodologies.md`, section 2), where each fact is tagged [V] verified in the primary source, [S] secondary source, or [U] unverified. **Code** claims cite a file on master and were read for this plan, not recalled. **Decisions** are marked as such and listed in §16 for the owner. Anything we could not verify is tagged [U] inline and never becomes member-facing copy until it is.

**What changed from v2.** v2 was a Chartmaster-framed feature plan. v3 reframes the indicator around the field (seven published methods, the forty-year evidence base, how eleven products present RS, how the best educators teach it), around the member (four personas, a settings model built on what members actually change, a phone mode, honest tooltips), and around the brand (name, voice, colour roles, type, vocabulary, and what the indicator must never do). Chartmaster and Manrav remain as two of seven presets, as the voice of the UCT-specific tooltips, and as one validation fixture. Several v2 engineering assumptions were corrected after reading the engine: inputs already support `group`, `tooltip` and `activeWhen`, so Simple/Pro needs no schema change; indicator templates already exist (behind a flag) and are additive; the settings dialog is already a three-tab Inputs / Style / Visibility form.

---

## 0. The one-paragraph version

A member types "RS" in the indicator library and turns on **UCT Relative Strength**. The RS line appears under the price bars against the S&P 500, the way IBD draws it, with a 21-day moving average, light-blue dots where the line makes a 52-week high, a gold dot where it does so before price, and the IBD-style RS Rating in the legend beside the benchmark name. Hover anything and three lines appear: what it is, where the idea comes from, what the evidence says. A **Preset** menu offers seven ways to read the same line, each named for its method and its origin: Classic (O'Neil), Phase (21 EMA), Trend (Mansfield), Rotation (RRG-style), Quality (Clenow), Volatility-adjusted, and Stress test (UCT's down-day method). Simple mode shows the five settings members change; Advanced shows everything the pros expose; Style and Visibility tabs do the rest; presets save as the member's own templates without destroying anything. The same columns run in the screener, fire alerts, build the Leadership list and post to Discord. The phone gets a rating-only compact mode. Every number the indicator prints about edge comes from our own nightly backtest, with sample size and dates, or it is not printed.

## 1. The field: what forty years of relative-strength work settles (research summary)

Full synthesis in `00-synthesis.md`; formulas in `01`; products in `02`; evidence in `03`; teaching in `04`.

1. **Three primitives cover every method** (01 §Design implications). A ratio line (price ÷ benchmark), a trend-of-ratio measure (52-week SMA for Mansfield, 21 EMA for the "phase" schools, regression slope for Clenow, JdK RS-Ratio for RRG, a P&F column for Dorsey Wright) and a momentum-of-ratio measure (new highs, zero-line crosses, JdK RS-Momentum). One indicator that computes the primitives and exposes methods as presets covers the field.
2. **Persistence is real at 6–12 months** (03 §2 [V]). Winners-minus-losers momentum earned 8.3%/yr (Sharpe 0.50) 1927–2013, positive in 81% of rolling one-year windows; the long side carries 73.6% of it. Dorsey Wright's point-in-time RS buy signals returned 13.9%/yr vs 9.3% for the S&P 1990–2015 and beat it in 85% of rolling three-year windows (03 §3 [V]).
3. **The blue dot has no published hit rate** (03 §1, §4 [V]). IBD says RS new highs before price are "more bullish" and "not a precondition"; no percentages exist. The one measured study (Bulkowski, 15,763 patterns) found RS direction before a breakout barely matters (gains 29–34% across all combinations) and RS rising after it matters a lot (+41% vs +22%).
4. **Crashes are the signature failure** (03 §2 [V]). All 15 worst momentum months since 1927 came after a negative two-year market return, during rebounds (1932, 2001, 2009; loser decile +156–163% in spring 2009). Volatility scaling roughly doubled the Sharpe (0.53 → 0.97, [S]).
5. **The benchmark changes the answer** (03 §5 [V]). 78% of S&P 500 stocks lagged the cap-weighted index over 2023–24 because seven names carried it; Dorsey Wright benchmarks RS to the equal-weight S&P; StockCharts resolves `$SECTOR` / `$INDUSTRY` automatically (02 §1.4 [V]).
6. **IBD's rating is approximated, never reproduced** (01 §1; 02 §1.3 [V]). The 40/20/20/20 quarter weighting comes from a 1999 column; replicas report ±3–5 points vs MarketSurge, worst in the 30–60 band; Deepvue and MarketInOut label theirs approximations.
7. **Thresholds are heuristics** (03 §1 [V]). IBD says 80, 85 and 90 in different articles and warns that stocks from long bases break out at RS 50–70; the "87 average" has no published sample. Minervini's template says 70, "preferably 80s or 90s" (01 §8).
8. **Members are pre-trained on three conventions** (02 §2c [V]): the RS line under price in the price pane (IBD, "the squiggly blue line found under the stock's price bars"); a settings dialog with Inputs / Style / Visibility tabs (TradingView); two dot intensities for RS new high vs RS new high before price (ChillLax light/dark, Deepvue green/pink).
9. **Ten settings members actually change** (02 §2b), in order of how many products expose them: benchmark; pane placement; moving average on the line; new-high lookback; dot toggles and colours; line colour mode (static vs rising-green/falling-red); rating thresholds; label position and a "rating only" phone mode; interval visibility; save as default.
10. **Dot history matters** (02 §2c [V]). MarketSurge shows only the latest blue dot; the most-liked TradingView clones exist because members wanted the history.
11. **Templates must not destroy** (02 §2c [V]). TradingView's indicator templates remove existing indicators and delete pane drawings.
12. **RS vs RSI is the first confusion to defuse** (04 §6 [V]); the best explanations are a question ("Is this stock beating the market, or just riding it?") and a picture (the beach ball under water), used by IBD, TraderLion, JC Parets and UCT's own workshops (04 §a–d).

## 2. The member: who uses this and what they need

### 2.1 Four personas (drawn from the Desk, the curriculum, the Pine programme's census and the product research)
| Persona | Arrives from | Expects | Fails if |
|---|---|---|---|
| **The curriculum learner** | Study and the Desk videos (Manrav's RS lesson, video 59; Chartmaster's workshops) | The 21-EMA phase colouring they were taught; "Learn" links back to the lesson; plain words | They see a raw ratio with four decimals and no explanation |
| **The IBD / MarketSurge migrant** | MarketSurge, Deepvue | RS line under price, blue dot, RS Rating 1–99 that roughly agrees with what they paid for; weekly chart first-class | Our rating disagrees by ten points with no explanation; no weekly dots |
| **The TradingView power user** | TradingView scripts (ChillLax, Fred6724), Pine | Inputs / Style / Visibility; every knob; dot history; a custom benchmark; a saveable template; alerts | A fixed three-ETF benchmark menu; no Style tab; templates that wipe their chart |
| **The phone-first member** | The mobile chart shell | A compact readout: rating, benchmark, last RS high; big tap targets; no text markers | Dots with text at 390 px; a pane too small to read |

### 2.2 Jobs to be done (the questions a member asks the indicator)
1. Is this stock beating the market, or just riding it? (the line's slope)
2. Is it a leader right now? (RS new high, rating band)
3. Did strength show up before price? (RS new high before price)
4. Is it holding up on bad days? (stress test: red-day RS highs, green-on-red count)
5. Versus the right thing? (benchmark: market, equal-weight, sector, group)
6. Is the market regime one where leaders keep leading? (regime chip)
7. Which names in my watchlist or theme lead? (Leadership list, rotation view)
8. What should I do with this? (Learn links; honest edge card; never a verdict)

### 2.3 Design principles
1. **Useful on the first click with zero settings.** The default is what IBD, Deepvue and the curriculum teach, so a member recognises it.
2. **Innovate on explanation, not on chrome** (the indicator platform's own rule, spec §1.5). Copy the three conventions members already know.
3. **Three lines on everything**: what it is, where it comes from, what the evidence says.
4. **Never invent a value.** NaN and a hollow marker when history is short, never a 0 that reads as "no signal" (the `rs_weighted_return` rule).
5. **One answer everywhere.** Chart, screener, alert, Discord post and Leadership list read the same server columns.
6. **Match the pros where a number already has a meaning**, and label approximations ("IBD-style, typically ±3–5 points").
7. **Customization is layered, not hidden.** Simple shows what people change; Advanced shows everything; nothing is removed, only dimmed (the platform's `activeWhen` rule).
8. **Nothing destructive.** Presets add; they never remove a member's other indicators or drawings.

## 3. The brand: how Uncharted Territory shows up in an indicator

Source: `docs/brand-design-system.md` §1–3, §16, §18, §22, `app/src/styles/tokens.css`, `app/src/components/chart/designTokens.js`, `app/src/components/ui/UIcon.jsx`.

- **Name.** "UCT Relative Strength", short name "UCT RS". The product prefix is the brand's convention (UCT 20, UCT Terminal). Preset names use the field's own words plus the originator in brackets; the UCT-specific preset is "Stress test (UCT)". No invented cute names; the brand is "editorial, restrained, operator-grade".
- **Voice.** Plain, declarative, no exclamation marks, no hype, no emojis anywhere including the Discord post (brand §22). Microcopy states facts and caveats in the same breath. The tagline is never paraphrased.
- **Vocabulary.** "Leadership" and "Regime" are operator words the brand already owns; the Leadership list and the regime chip use them. "Navigate" appears once, in the tour's last card.
- **Colour roles** (designTokens `IND_TOKENS`, per chart preset): `bull` / `bear` for the line above / below its MA (direction of relative performance is direction of money); `info` for the plain RS-new-high dot (the field's blue convention, and blue is "informational only" in the brand); **`premium` gold for the RS-new-high-before-price dot**, the brand's "look here" highlight exactly as HVC volume bars use it (brand §18.1); gold with a ring for the red-day high; `neutral` for a static-coloured line; `warn` amber (never gold, never red) for degraded states. Red is losses and errors only.
- **Type.** Instrument Sans everywhere, tabular numerals via `font-variant-numeric`, never a monospace (designTokens rule 1; brand §22).
- **Iconography.** `UIcon` glyphs only; the library row uses the existing `compass` glyph as its category mark. No emoji.
- **Themes.** Colours come from the chart preset's token set so the indicator reads as part of Classic Dark, OLED, TradingView and Light; the member's UCT chart themes recolour it with everything else (`chartThemes.js`).
- **Premium.** The Premium badge and lock use gold; the locked state shows a static preview (the platform's state 6, "Premium locked (lock + preview)").
- **What the indicator must never do.** Use gold for a warning; use green for an "active" control; show a serif; show an emoji; print "buy" or "sell"; call itself IBD's rating.

## 4. Where we are today (measured on master, 2026-11-05)

| Surface | What exists (code read) | Verdict |
|---|---|---|
| Chart → "Relative Strength Line" | `nativeRegistry.RS_LINE_RAW`: `close ÷ benchmark close`, enum **SPY / QQQ / IWM**, own pane (15 %), one line, legend 4 decimals, premium. Description: "This symbol's close divided by a benchmark's — is it leading or lagging the market?" | Basic. No MA, no markers, no overlay, no rating, no explanation. |
| Server lane | `signature._rs_line_provider` fetches `_fetch_bars_for_tf(sym, tf, count=400)` for both symbols; returns `{columns:{rsLine}, times, asOf}`; `registry_defs.store_tf` maps chart timeframes to store keys. | **400 bars** leaves six months of dot history behind a 252-session lookback. |
| RS Rating | `rs_ranking.py` + `rs_weighted_return.py`: `RS_TERMS` 3M 40% / 6M 20% / 1M 20% / 1W 20%, 3M required, missing terms dropped and renormalised; universe = cap universe (3,742); hourly cache; snapshot; **no history**; `RsBadge` tiers ≥80 / ≥60 / ≥40; never on the chart. | Not IBD's formula (01 §1); will be renamed "UCT fast". |
| Screener | `rs_rank`, `rs_return`, `rs_line_trend` (20-bar slope vs SPY), `sector_rs_pct`. | Raw material; no events. |
| Indicator alerts | `IndicatorAlertPopover` reads `GET /api/indicator-alerts/catalog` = `indicator_alert_evaluator.INDICATOR_FUNCS` (rsi, macd, bb, price_vs_ma, ma_cross, …). | No RS rows; adding rows is the whole front-end change. |
| Engine inputs | `defSchema.js`: types int/float/bool/enum/string/color/source; modifiers **`group`, `inline`, `tooltip`, `disabled`, `activeWhen`** (spec: `activeWhen` dims, never removes; dialog has collapsible groups). | Simple/Advanced needs no schema change. |
| Settings UI | `IndicatorSettingsDialog.jsx`: three tabs **Inputs / Style / Visibility** over one instance, live-apply, cancel-rollback, 250 ms debounce. | TradingView parity exists. |
| Templates | `builder/indicatorTemplates.js`: capture/apply a named set of instances, **additive** (`addInstanceCopy`), skips duplicates, behind `indicatorTemplatesEnabled()`; `chartTemplateApply.js` for whole-chart templates; `chartThemes.js` visual skins. | Presets ride this; the flag must be on for members. |
| Markers | `markerPrimitive.js`: event columns `{0,1,NaN}`; shapes `circle, square, arrowUp, arrowDown`; positions above/below/in bar; text ≤ 24 chars. | Ready. |
| Phone | `MobileIndicatorSheet.jsx`: steppers for int/float (tap value to type), enum rows, 8 colour swatches, switches, history buttons. | New inputs render with no new UI if types stay in vocabulary. |
| Compare panel | `CompareSymbolsPanel.jsx`: per-item `scaleMode: 'new'` drives a separate price scale. | Own-scale overlay mechanics exist. |
| Education | Routes `/desk`, `/desk?section=videos`; `GET /api/education/by-youtube/{youtube_id}`. | Learn links can deep-link by video id. |
| Brand tokens | `--ut-gold #c9a84c` (light `#7a5c16`), `--info #6ba3be`, `--gain #3cb868`, `--loss #e74c3c`; designTokens roles incl. amber `warn #ff8100`. | Colour roles are defined; we assign, not invent. |

## 5. Product definition: one indicator, seven presets

A **preset** is a named set of input values over one definition (`rsLine`, version 2). Choosing a preset writes those inputs; the member can then change anything. Presets are additive indicator templates (§11), so applying one never removes another indicator or a drawing.

| Preset | What the member sees | Origin (research) | Evidence line shown | Timeframe default |
|---|---|---|---|---|
| **Classic (O'Neil)** — default | RS line under price vs SPY, 21 EMA, light-blue dots on 52-week RS highs, gold dot when before price, "RS 94 · vs SPY" label | IBD / MarketSurge, 01 §1, 02 §1.1 | "Stocks that led over 6–12 months kept leading on average (academic momentum, 8.3%/yr long-short 1927–2013). No published hit rate exists for the blue dot; ours will come from our nightly test." | Daily |
| **Phase (21 EMA)** | Line coloured bull above / bear below its 21 EMA; cross arrows; shading between | Manrav video 59, TraderLion RS Phase, Deepvue Webby RS, 04 §7, 02 §1.2 | "A moving average on the ratio is the field's standard trend read (StockCharts 150-day, Deepvue 21/50). It lags turns by design." | Daily |
| **Trend (Mansfield)** | Oscillator around zero: ratio vs its 52-week SMA; bull / bear / neutral background | Weinstein, Mansfield charts, 01 §2 | "Stage Analysis practitioners require RS above zero or crossing it on a Stage 2 breakout. The 52-week average lags badly at turns." | Weekly |
| **Rotation (RRG-style)** | RS-Ratio and RS-Momentum around 100, quadrant label (Leading / Weakening / Lagging / Improving); mini rotation plot for a watchlist | de Kempenaer, 01 §6 (UCT normalisation, "inspired by") | "RRG shows trend and its momentum for a whole group. It is a map, not a trading system; RS-Momentum crosses 100 often." | Weekly |
| **Quality (Clenow)** | Annualised regression slope × R² as a score; gap flag when any 90-day move > 15% | *Stocks on the Move*, 01 §4, 03 §3 | "Ranks steady climbers above gappers. Out of sample it lagged the S&P 2015–2025 (7.5% vs 13.4%, Quanterlab)." | Daily |
| **Volatility-adjusted** | ATR-normalised RS vs its 50 MA, four states (strong gaining / strong fading / weak improving / weak) | OANDA VARS, Daniel–Moskowitz, 01 §9 | "Volatility scaling roughly doubled momentum's Sharpe in academic tests. It dampens genuine breakouts." | Daily |
| **Stress test (UCT)** | RS new highs on red market days, green-on-red count (last 20), pivot speed, pullback-to-8-EMA distance | UCT workshops (Chartmaster RS&W 5:41, Mastering 12:06–18:15; Kell; TraderLion "down days"), 04 §7 | "Watching leaders on down days is taught by O'Neil, Kell and UCT's mentors. No published forward-return study exists; ours will." | Daily |

Every preset carries the regime chip (§6.6) and the Leadership readout; the presets differ in which plots and markers are on and which inputs are foregrounded.

## 6. The member experience

### 6.1 Finding it
- **Library row.** Name **UCT Relative Strength**, short name **UCT RS**, category Relative Strength (the two mislabelled studies "% From MA" and "52-Week High/Low" move to Price Levels so the category holds RS only), Premium badge, `compass` glyph.
- **Description** (shown in `IndicatorLibraryDialog`, which already renders `meta.description`): *"Is this stock beating the market, or just riding it? The RS line against a benchmark, with new-high dots, the 1–99 RS Rating and seven ways to read it, from O'Neil's classic to Weinstein's Mansfield and UCT's stress test."*
- **Search aliases** (the dialog is search-first): RS, relative strength, RS line, RS rating, blue dot, Mansfield, RRG, rotation, leader, leadership, comparative, price relative, momentum.
- **Disambiguation.** Searching "RSI" shows the RSI row first and, beneath it, one line: "Looking for strength versus the market? That is UCT Relative Strength." (04 §6: the field's first confusion.)

### 6.2 First turn-on (Classic preset, nothing touched)
1. The RS line draws **in the price pane, under the bars, with its own hidden scale** once Phase 3 lands; until then in a pane under price at 18 % height (phones 22 %). Deepvue's own docs admit the pane-first default sends every new user hunting for "Move to" (02 §2c mistake 1), so the Phase 3 overlay is the end state and the pane is the interim.
2. A 21-day EMA on the line, dashed, `neutral`. The line itself coloured `bull` above the EMA, `bear` below (Phase colouring is on in Classic because the curriculum teaches it; a Style toggle makes it static).
3. **Light-blue dots** (`info`) under the line on 52-week RS highs, history kept. **Gold dots** (`premium`) when the RS high comes while price is more than 2 % below its own 52-week high. Gold-ringed when it also falls on a red market day.
4. **Legend chip:** `UCT RS · vs SPY · RS 94 (IBD-style) · above 21 EMA +2.1% · 52-wk high 3d ago`.
5. **Tour**, five cards, once per member, dismissable, stored in preferences (copy in §6.11).
6. No input needs changing to trade the way IBD, Deepvue or the curriculum teach.

### 6.3 The settings dialog: Inputs tab (every input, with its tooltip)
Rendered by `IndicatorSettingsDialog` from the definition; groups collapse; `activeWhen` dims an input that does not apply to the chosen preset instead of hiding it (platform rule). Types stay inside the existing vocabulary so `MobileIndicatorSheet` renders them unchanged.

**Group: Preset**
| key | type | default | options / range | tooltip |
|---|---|---|---|---|
| `preset` | enum | `classic` | classic · phase · mansfield · rotation · clenow · volAdj · stress | "Seven ways to read the same line. Choosing one sets the inputs below; change anything after." |

**Group: Simple** (always expanded)
| key | type | default | options / range | tooltip |
|---|---|---|---|---|
| `benchmark` | enum | `SPY` | SPY · **RSP (equal-weight S&P)** · **SECTOR (auto)** · QQQ · IWM · INDUSTRY (auto) · CUSTOM (Phase 3) | "What we compare against. Change the benchmark and the question changes. In 2023–24 most S&P stocks lagged the cap-weighted index; equal-weight or sector isolates the stock's own strength." |
| `placement` | enum | `price` (Phase 3) / `pane` (interim) | price · pane above · pane below | "Under the price bars is how IBD draws it and makes divergences easy to see. A pane gives it room." |
| `maLength` | int | 21 | 2–200 | "Moving average on the RS line. 21 days is the curriculum default; 50 is Deepvue's second line; Mansfield uses 52 weeks." |
| `showNewHigh` | bool | on | | "Light dot when the RS line is at its highest level of the lookback." |
| `showNewHighBeforePrice` | bool | on | | "Gold dot when the RS line makes a new high while price is still below its own high. IBD calls this more bullish; it is not a precondition." |
| `showRating` | bool | on | | "The 1–99 RS Rating in the legend. 90 means the stock beat 90 % of the universe over the past year." |

**Group: Line** (Style-adjacent inputs that change computation)
| key | type | default | options / range | tooltip |
|---|---|---|---|---|
| `maType` | enum | EMA | EMA · SMA | "EMA reacts faster; SMA is what Mansfield and StockCharts use." |
| `colorMode` | enum | `phase` | phase (above/below MA) · slope (rising/falling) · static | "How the line is coloured. Phase and slope use the chart's gain and loss colours." |
| `showMaFill` | bool | off | | "Shade between the line and its average, the way Fred6724's RS Rating script does." |

**Group: New highs and lows**
| key | type | default | options / range | tooltip |
|---|---|---|---|---|
| `lookback` | int | 252 | 20–500 | "Sessions for a 'new high'. 252 is one trading year, what MarketSurge calls 52-week; ChillLax's script defaults to 50 for a faster read. Weekly charts count weeks." |
| `priceTolerance` | float | 2.0 | 0–10 (%) | "Price counts as 'not at its high' when it is more than this far below its lookback high." |
| `showNewLow` | bool | off | | "Red dot on RS new lows. Relative weakness, the short side's read." |
| `shortHistoryDots` | bool | on | | "Hollow dot when the stock has fewer bars than the lookback (new listings). Treat with care." |
| `dotHistory` | bool | on | | "Keep every dot. MarketSurge shows only the latest; members asked for the history." |

**Group: Rating**
| key | type | default | options / range | tooltip |
|---|---|---|---|---|
| `headlineRating` | enum | `ibd` | ibd · fast · both | "IBD-style weights the past year by quarter (40/20/20/20) and matches MarketSurge within about ±3–5 points. UCT fast weights the last three months and moves within days." |
| `showComponents` | bool | off | | "1M / 3M / 6M / 12M ratings in the readout, Deepvue's layout." |
| `ratingBands` | bool | on | | "Legend colour by band: 90+, 80–89, 60–79, below. Bands are the field's heuristics, not tested cut-offs." |
| `showRatingHistory` | bool | off | | "Plot the rating as a line in its own pane with the 90 and 80 bands (Phase 2)." |

**Group: Stress test** (dims unless preset = stress or `showStress` on)
| key | type | default | options / range | tooltip |
|---|---|---|---|---|
| `showStress` | bool | off (on in Stress preset) | | "Red-day RS highs, green-on-red days and pivot speed. UCT's down-day method." |
| `redDayThreshold` | float | −0.5 | −3.0–0 (%) | "The benchmark must close at least this much down for a 'red day'." |
| `showGreenOnRed` | bool | off | | "Small green triangle on days the stock closed up while the market closed down." |

**Group: Method inputs** (each dims unless its preset is chosen)
| key | type | default | options / range | applies to | tooltip |
|---|---|---|---|---|---|
| `mansfieldLength` | int | 52 (weekly) / 200 (daily) | 20–300 | Trend | "The average the ratio is measured against. Weinstein's charts used 52 weeks; do not shorten it on weekly charts." |
| `rrgWindow` | int | 14 | 5–60 | Rotation | "Bars used to normalise the ratio's trend and momentum. StockCharts needs at least 50 bars of history." |
| `rrgTail` | int | 12 | 3–30 | Rotation | "Points of trail on the rotation plot." |
| `clenowWindow` | int | 90 | 30–250 | Quality | "Regression window. Clenow's book uses 90 trading days." |
| `clenowGapPct` | float | 15 | 5–50 (%) | Quality | "Flag any move larger than this inside the window. Clenow disqualifies them." |
| `atrLength` | int | 20 | 5–50 | Volatility-adjusted | "ATR length used to normalise daily changes." |
| `varsLookback` | int | 60 | 20–250 | Volatility-adjusted | "Sessions summed into the volatility-adjusted score." |

**Group: Readout**
| key | type | default | tooltip |
|---|---|---|---|
| `showLeadership` | bool | on | "The Leadership readout: checks, regime, theme, pullback distance." |
| `showRegime` | bool | on | "Regime chip: benchmark vs its 200-day, two-year trend, volatility. Leaders reverse hardest in rebounds after bear markets." |
| `showEvidence` | bool | on | "Evidence lines on hover. Our own backtest numbers once they exist; the field's published findings until then." |
| `compactMode` | bool | off (on by default on phones) | "Rating only: a one-line legend and no markers with text. Fred6724's phone mode." |

Rules: every numeric input has `min`/`max`/`step` so phone steppers cannot produce nonsense; every input has `label` and `tooltip`; abbreviations are expanded in the tooltip; `activeWhen` references only declared keys (the schema validates this).

### 6.4 Style tab
Generated from the plots (platform: "ONE formatting pipeline drives Style-tab precision, chip values, and crosshair readout"). Per plot: colour, width 1–4, visibility; dot size Tiny / Small / Normal (NNenov's three sizes, 02 §1.3) via marker `size`; label position (legend / top-right / bottom-right). Colours default to the chart preset's `IND_TOKENS` roles so a member on OLED or Light sees the right palette without touching anything; a UCT chart theme recolours them with the rest of the chart.

### 6.5 Visibility tab
Per-interval display (TradingView's convention, 02 §1.3). Defaults: Classic, Phase, Quality, Volatility-adjusted and Stress on daily; Trend and Rotation on weekly; the RS line and MA on every interval; new-high markers off on intraday (a 252-bar lookback on 5-minute bars is two days and means nothing); the rating label on every interval, since it is a daily number.

### 6.6 Legend, crosshair and the Leadership readout
- **Legend chip (always):** benchmark name resolved (never the code alone; "vs Semiconductors (SMH)"), rating with method tag, % distance from the MA with slope arrow, last RS high age, and, in Rotation preset, the quadrant. Rating coloured by `RsBadge` tiers so the colour language matches the rest of the site.
- **Crosshair:** that bar's values in words (ratio hidden by default, decision D6) and, once history exists, the rating on that date.
- **Leadership readout** (the engine's per-indicator readout rows; a sheet on phones):

```
LEADERSHIP · NVDA vs SPY · Daily · as of Nov 5 close
Rating         IBD-style 96 (±3–5 vs MarketSurge) · UCT fast 98 · 5d +2 · 20d +7
Components     1M 91 · 3M 97 · 6M 95 · 12M 96
RS line        +2.1 % above 21 EMA, rising · 52-wk high 3 days ago · before price: yes · red day: yes
Benchmarks     vs SPY rising · vs RSP rising · vs SMH flat        (sensitivity: agree)
Regime         SPY above 200d · 2-yr trend positive · volatility low tercile  → persistence regime
Theme          Semiconductors · sector RS 88 · group percentile 92
Checks         MAs: stock +15 % vs 200d, SPY −3 %  ·  Anchor Oct 15: stock +18 %, SPY +6 %
               Pivot speed: 7 of last 10 market-down days closed in top third  ·  Green on red: 6 of 20
Pullback       1.8 % above 8-day EMA
Evidence       Our test: after an RS 52-wk high while price < high, median +3.1 % vs SPY at 60 sessions,
               hit 56 %, n = 2,410 events on 310 dates, 2016–2026. Field: no published hit rate. (Phase 2)
```
No aggregate score, no verdict, no tick marks (v2's ticks read as a buy signal; the research says RS is a filter, not timing, 04 §e).

### 6.7 Markers and their three-line cards
Each marker's hover (long-press on phones) shows **What · Origin · Evidence**.

| Marker | Looks like | What | Origin | Evidence (launch copy; replaced by our numbers in Phase 2) |
|---|---|---|---|---|
| RS new high | small `info` dot under the line | "The RS line closed at its highest level of the last 52 weeks. The stock is beating the market by the most in a year." | IBD's RS line new high; MarketSurge's blue dot | "Leaders over 6–12 months kept leading on average in forty years of data. No published hit rate for the dot itself." |
| RS new high before price | `premium` gold dot, larger | "RS made a new high while price has not. IBD: 'even more bullish… not a precondition.' UCT's workshops call it the beach ball under water." | IBD; Deepvue pink dot; ChillLax dark dot; UCT workshops | "Not measured anywhere public. Bulkowski found RS before a breakout barely changed outcomes; RS rising after it did (+41 % vs +22 %)." |
| RS new high on a red day | gold dot with ring | "An RS new high on a day the market closed down." | UCT workshops ("almost tipping their hand"); Kell; TraderLion "down days" | "Taught widely, never measured publicly. Our nightly test will publish it." |
| Short-history RS high | hollow `info` dot | "Highest RS over all available history (fewer bars than the lookback)." | IBD rates young stocks on available data | "Treat with care: fewer than 252 sessions." |
| Green on red | small `bull` triangle under price | "Stock closed up while the benchmark closed down." | Deepvue "Up On Down Days"; UCT workshops | "A count, not a signal: 6 of 20 is unusual; 1 of 20 is noise." |
| RS / MA cross | arrow on the RS pane | "RS line crossed its moving average." | Curriculum video 59; TraderLion RS Phase; Deepvue crossover icon | "A trend read with lag by design." |
| Mansfield zero cross | small marker at the zero line | "The ratio crossed its 52-week average." | Weinstein | "Most Stage 2A breakouts occur above zero or the week it crosses." |
| RS new low | `bear` dot | "The RS line closed at its lowest level of the lookback." | ChillLax orange/red dots; Weinstein "don't buy negative RS" | "Relative weakness. In a bear market a leader just falls less; a laggard falls more." |

Density rule: past 600 visible bars, plain new-high dots shrink to ticks; gold dots stay full size. Text markers drop their text below 420 px width.

### 6.8 Presets, templates and sharing
- **Choosing a preset** writes its inputs through the one writer (`instanceControls.setInstanceInput`), so the toolbar, right-click, chords and the dialog stay in step.
- **Save as my default**: the member's current inputs become the definition's default for them (preference key, same persist path as chart settings).
- **Save as template**: the existing `captureIndicatorTemplate` / `applyIndicatorTemplate` (additive, duplicate-skipping). The seven shipped presets are read-only templates in the same list; a member's saved ones follow. Requires `indicatorTemplatesEnabled()` on for members (decision D10).
- **Share**: the existing share link carries the instance; a member can paste "my RS setup" to a teammate.
- **Reset to preset** restores the preset's inputs; **Reset to UCT default** restores Classic.

### 6.9 Phone
- All inputs edit in `MobileIndicatorSheet` (steppers, enums, swatches, switches); nothing new to learn.
- `compactMode` on by default: a one-line legend `RS 94 · vs SPY · 52-wk high 3d`, markers without text, pane 22 %.
- Long-press a dot: the three-line card as a sheet with a Learn row.
- The Leadership readout is a sheet from the legend chip; rows are 44 px.

### 6.10 Timeframes
- **Daily:** everything.
- **Weekly:** lookback in weeks (52), `maLength` 21 weeks (Fred6724 uses a 10-week SMA; offered as a tooltip hint), Mansfield 52, pullback row reads the 8-week EMA; the rating is the daily rating as of that week's last session; computed on the site's Friday-dated weekly bars, never resampled on the client.
- **Monthly:** line, MA, Mansfield, new highs only.
- **Intraday:** RS line vs the benchmark's intraday bars, MA, cross arrows; new-high and stress markers off (Visibility defaults); the legend still shows the daily rating with "(daily)".

### 6.11 Tour and Learn links
Five cards (from 04 §d, edited to the brand voice), shown once:
1. **Beating the market, or just riding it?** RS compares the stock to the S&P 500. A stock can go up and still lose the race.
2. **Read the slope, not the level.** The line rises when the stock outperforms and falls when it lags. Whether it sits above or below price means nothing; it is not a moving average.
3. **Watch for RS new highs.** When the line tops its old high before price does, demand may be building early. IBD's winners averaged a rating of 87 before their runs; IBD publishes no sample for that figure.
4. **Strong on a weak day.** Stocks that close green while the market sells off are showing real demand. Like a beach ball held under water, they tend to pop first when selling stops.
5. **RS says where to look, not when to buy.** Combine it with a base, volume and your own stop. Navigate the market with it; do not let it steer alone.

Learn links (every card, every marker card, every readout row): deep links into the Desk videos by YouTube id (`/desk?section=videos` + the `by-youtube` endpoint): Manrav video 59 for the line and 21 EMA, Chartmaster RS&W 5:41 for red-day highs, Mastering RS 30:14 for before-price, 12:06 for the checks; plus three external references in the glossary (ChartSchool Price Relative, IBD's RS line article, Stage Analysis Mansfield page).

### 6.12 States (mapped to the platform's ten-state inventory)
| State | What the member sees |
|---|---|
| Loading | Skeleton line, never a flashed error. |
| Refreshing | Last columns kept, subtle activity on the chip. |
| Warm-up / short history | Grey, "needs N more bars"; line and MA draw when they can; dots hollow; rating "— (needs 3 months)". Never error-styled. |
| Compute error | Red dot on the chip, message on click, Retry, copy diagnostic; plots removed, chip stays. |
| Server unavailable | Amber chip, last-good ghosted with as-of time; the price chart never waits on RS. |
| Premium locked | Gold lock and a static preview image of Classic on a leader. |
| Hidden / hidden on this timeframe | Greyed chip with tooltip "RS highs are a daily and weekly signal". |
| Benchmark has no bars | "No SPY bars for this timeframe yet"; line hidden; never a flat 1.0. |
| Benchmark = the symbol | "Pick a different benchmark"; line hidden (single-symbol RS is 1.0, an existing golden test). |
| Sector / Industry unresolved | Falls back to SPY; legend says "vs SPY (no sector found)". |
| Repaint badge | Not shown: every column is non-repainting (closed bars only). |
| Version migrated | Toast once: "Relative Strength Line is now UCT Relative Strength. Your benchmark and colours were kept." |

### 6.13 Copy guide (voice)
- Declarative sentences, present tense, no exclamation marks, no emoji, no "buy"/"sell", no "guarantee", no "signal" without "read" or "tendency" nearby.
- Numbers carry their source and date: "8.3 %/yr, 1927–2013 (Asness et al.)"; our own: "n = 2,410 events on 310 dates, 2016–2026".
- Approximations are labelled where they appear: "IBD-style (±3–5 vs MarketSurge)".
- Banned: "elite", "powerful", "unlock alpha", "institutional accumulation" (unmeasured, 03 §1), "leading indicator" (Bulkowski says otherwise), "crystal ball".
- Allowed brand lines: "Navigate the market" (once, tour card 5); "Leadership"; "Regime".

## 7. Exact definitions (what the tests pin)

Notation: `C[t]` stock close, `B[t]` benchmark close, joined by bar time; `N` lookback (252 daily / 52 weekly); `rs[t] = C[t] / B[t]`. Any bar where either close is missing → `rs[t] = NaN` and every derived column is NaN at `t`. All event columns are `{0, 1, NaN}`.

1. **RS line.** `rs[t]`. Displayed raw on a hidden scale (D6); legend shows `(rs/rsMA − 1) × 100` and the slope sign of `rsMA`.
2. **RS MA.** EMA (default) or SMA of `rs`, length `L`, NaN for the first `L − 1` bars. `rsAbove[t] = rs[t] ≥ rsMA[t]`.
3. **RS new high.** `rsNH[t] = 1` iff `rs[t] ≥ max(rs[t−N … t−1])` with all N prior values present (ties count, ChillLax convention); `0` otherwise; NaN before N bars unless `shortHistoryDots`, then `rsNHpartial` over all available bars (minimum 20), rendered hollow.
4. **Price new high.** `pxNH[t] = 1` iff `C[t] ≥ max(C[t−N … t−1]) × (1 − tol)`, `tol` default 0.02.
5. **RS NH before price.** `rsNHbeforePx = rsNH ∧ ¬pxNH`.
6. **Red day.** `red[t] = (B[t]/B[t−1] − 1) ≤ threshold` (default −0.005). **Green on red** `gor = red ∧ C[t] > C[t−1]`. **Red on green** mirror.
7. **RS NH on red day.** `rsNHred = rsNH ∧ red`.
8. **RS new low.** Mirror of 3.
9. **RS / MA cross.** `crossUp[t] = rsAbove[t] ∧ ¬rsAbove[t−1]`; `crossDown` mirror.
10. **Mansfield (Trend preset).** `RP = rs × 100`; `MRS = ((RP / SMA(RP, n)) − 1) × 100`, `n` 52 weekly / 200 daily (01 §2). Background: bull when `MRS > 0 ∧ MRS rising`, bear when `< 0 ∧ falling`, neutral otherwise (stageanalysis script convention, 02 §1.3). Zero-cross marker.
11. **Rotation (RRG-style, UCT normalisation).** JdK's formula is proprietary (01 §6), so we publish ours and label the preset "RRG-style": `trend[t] = (rs[t] / EMA(rs, W) − 1) × 100` with `W = rrgWindow × 3`; `rsRatio = 100 + 100 × trend[t] / σ(trend, 252)` clipped to [80, 120]; `rsMomentum = 100 + 100 × (rsRatio[t] − rsRatio[t − rrgWindow]) / σ(Δ, 252)` clipped the same. Quadrant: Leading (≥100, ≥100), Weakening (≥100, <100), Lagging (<100, <100), Improving (<100, ≥100). Needs ≥ 252 + W bars; else NaN with the warm-up state.
12. **Quality (Clenow).** Over `clenowWindow` bars: OLS of `ln C` on bar index → slope `b`, `R²`; `annual = (1 + b)^252 − 1`; `score = annual × R²`; `gapFlag = 1` if any `|C[i]/C[i−1] − 1| > clenowGapPct` inside the window (01 §4; sources differ 250/260 trading days, we use 252 and say so in the tooltip).
13. **Volatility-adjusted (VARS).** `ΔS[t] = (C[t] − C[t−1]) / ATR_C(atrLength)`; `ΔI[t] = (B[t] − B[t−1]) / ATR_B(atrLength)`; `vars[t] = Σ_{varsLookback} (ΔS − ΔI)`; state from sign of `vars` and `vars − SMA(vars, 50)` (01 §9).
14. **RS Rating (IBD-style).** For each ticker in the cap universe with ≥ 63 daily closes: `score = 0.40·C/C₋₆₃ + 0.20·C/C₋₁₂₆ + 0.20·C/C₋₁₈₉ + 0.20·C/C₋₂₅₂`; a missing term is dropped and weights renormalised (`rs_weighted_return` rule); the 63-day term required. Rating = percentile rank across the universe → `max(1, ceil(pct × 99))`. ETFs and the benchmarks are excluded from the ranked universe but still receive a rating. Labelled "IBD-style"; parity target ±3 against MarketSurge on the same date (02 §1.3 replicas report ±3–5; we aim one point tighter and report what we get).
15. **UCT RS (fast).** Today's `rs_ranking` number unchanged.
16. **Components.** 1M / 3M / 6M / 12M = percentile rank of the plain 21 / 63 / 126 / 252-session return (Deepvue's layout).
17. **Rating change.** `Δ5`, `Δ20` from `rs_rating_history`; "—" before history exists.
18. **Regime chip.** `above200 = B > SMA(B, 200)`; `trend2y = sign(B[t]/B[t−504] − 1)`; `volTercile` of 126-session realised volatility of `B` against its own trailing three-year distribution. "Persistence regime" when above200 ∧ trend2y > 0; "Rebound-risk regime" (Daniel–Moskowitz panic state) when trend2y < 0 ∧ volTercile = high; "Mixed" otherwise.
19. **Benchmark sensitivity.** Sign of the 20-session slope of `rs` vs SPY, RSP and the sector ETF; "agree" when all three signs match, else the disagreeing pair is named.
20. **Checks (Stress preset / readout).** MA relationship `(C/SMA200(C) − 1)` vs `(B/SMA200(B) − 1)` (also 50); anchor `C[t]/C[a] − 1` vs `B[t]/B[a] − 1` from the benchmark's lowest close of the last 20 sessions (clickable date, Phase 3); pivot speed = count over the last 10 red days where `(C − L)/(H − L) ≥ 2/3`; green-on-red count over 20 sessions; pullback `(C/EMA8(C) − 1)` daily, EMA8 of weekly closes on weekly.
21. **Weekly.** All of the above on Friday-dated weekly bars with N = 52, L = 21 weeks, Mansfield 52, EMA8 weekly.

## 8. Server contract

- **Endpoint** unchanged: `GET /api/signature/columns?defId=rsLine&sym=&tf=&inputs=` (premium, `require_paid`). Inputs JSON and response grow.
- **Columns**, all aligned to `times`: `rsLine, rsMa, rsAbove, rsNH, rsNHpartial, pxNH, rsNHbeforePx, rsNHred, rsNL, gor, rog, crossUp, crossDown, mansfield, mansfieldState, rsRatio, rsMomentum, clenowScore, clenowGap, vars, varsState, rsRatingHist (Phase 2)`. Line columns are floats; event columns `{0,1,NaN}`; state columns small ints with a published legend.
- **Payload** (scalars for the legend and readout): `benchmark {requested, resolved, label, fallback}`, `rating {ibd, fast, d5, d20, m1, m3, m6, m12, asOf, universeSize, method: "ibd-style"}`, `regime {above200, trend2y, volTercile, label}`, `sensitivity {spy, rsp, sector, agree}`, `checks {ma50, ma200, anchor, pivotSpeed, greenOnRed20, pullbackEma8}`, `theme {sectorEtf, sectorRating, groupPct}`, `lastRsHigh {date, beforePrice, redDay}`, `quadrant`, `history {bars, short}`, `evidence [{marker, horizon, median, mean, hit, n, dates, from, to}]` (Phase 2, from the nightly table).
- **Bars fetched:** daily `N + 600` (default 852); weekly `N + 200`; intraday 400 as today; benchmark and the two sensitivity benchmarks the same count (three extra SQLite reads of ~850 rows; negligible). Fixes the measured 400-bar gap.
- **Benchmark resolution on the server:** `SPY / QQQ / IWM / RSP` literal; `SECTOR` → GICS sector ETF from `ticker_meta` (XLK, XLF, …; coverage to be measured, §17.2) with SPY fallback and `payload.benchmark.fallback = "no sector"`; `INDUSTRY` → equal-weight composite of the UCT industry group's closes, computed server-side and cached per session (reachability to be confirmed, §17.3); `CUSTOM:<SYM>` (Phase 3) → `_sym_or_422`.
- **Caching:** key `(defId, sym, tf, canonical inputs JSON, session date)`; TTL 15 min intraday, until next close for D/W/M; the rating block from the hourly `rs_ranking` cache and the nightly history table, never recomputed per request.
- **Budget:** warm p95 ≤ 150 ms on the web pod; payload ≤ 100 KB gzipped for 852 bars × 22 columns; nightly universe job ≤ 8 min. Measured in Phase 1's final review and written into the PR.
- **Errors:** unknown benchmark → 422 `{"error": "unknown benchmark", "allowed": [...]}`; no bars → 200 with empty columns and `history.bars = 0`; free member → 402 (unchanged).
- **Versioning:** `compute.rev: 2`; the client treats a `rev` mismatch as a cache miss.

## 9. The honesty layer and the nightly backtest

**Why.** The research found no public hit rate for the dot everyone sells (03 §4). Printing our own, with sample size and dates, is the one claim to "beyond MarketSurge" that cannot be copied by adding a feature, and it fits a brand that calls itself operator-grade.

**What we say at launch (Phase 1), verbatim from 03 §b:** the six defensible statements (persistence over 6–12 months with the 8.3 %/yr figure and 81 % of rolling years; "a tendency, not a guarantee… loses roughly one year in five and reverses hardest at bear-market bottoms (2003, 2009)"; the line can rise while the stock falls; the benchmark matters with the 2023–24 figure; RS confirmed after a breakout associated with larger follow-through, Bulkowski +41 % vs +22 %). **What we never say:** the seven items in 03 §b "must not claim".

**The nightly job (Phase 2),** specified in 03 §c and summarised here: five tagged signals (rating crosses 80/90 and deciles; RS line 63/126/252-day highs; RS high while price ≥ 5 % below its high; price high without RS high; post-breakout RS confirmation within 10 sessions) × three benchmarks (SPY, RSP, sector) × three horizons (20/60/120 sessions) × regime splits (benchmark vs 200-day; Daniel–Moskowitz panic state; breadth terciles). Measures median and mean excess return, quartiles, hit rate, baseline lift, N and effective N (first event per non-overlapping window for display; block bootstrap internally), distinct event dates with a date-bootstrap CI, median max adverse excursion. Rules: point-in-time universe including delisted names with delisting returns; no lookahead (signals use closes through t, forward returns from t+1 and say so); index total-return series as benchmark; gross and net (0.2 % round trip, ADV floor); definitions frozen in advance, six months out of sample before any variant; shrinkage toward baseline with weight N/(N+200); display suppressed under effective N 100. Outputs: per-signal table, drift check (last 250 sessions vs history), benchmark-sensitivity panel (rank correlation of RS vs SPY / RSP / sector). Every tooltip number carries computation date, window and universe size.

## 10. Beyond the chart: the same columns everywhere

1. **Screener columns** (from the same functions in the nightly screener snapshot): `rs_new_high`, `rs_nh_before_price`, `rs_nh_red_day`, `rs_nh_days_ago`, `green_on_red_20`, `rs_line_above_ma`, `rs_rating_ibd`, `rs_rating_fast`, `rs_rating_chg_5`, `rs_rating_chg_20`, `rs_rating_1m/3m/6m/12m`, `mansfield`, `rrg_quadrant`, `clenow_score`, `vars_state`, `rs_vs_sector_pct`, `rs_benchmark_agree`. **Presets in plain English** (Deepvue's naming lesson, 02 §2c): "RS 90+", "RS new highs (52-week)", "RS new high before price (weekly)", "RS new highs on a red day", "Up on down days (6 of 20)", "Crossed above 21 EMA within 5 days", "Mansfield crossed zero (weekly)", "Rotation: Improving quadrant", "Leaders vs equal-weight too".
2. **Alerts:** rows added to `indicator_alert_evaluator.INDICATOR_FUNCS`: `rs_new_high` (conditions: any / before price / on red day), `rs_ma_cross` (above / below), `rs_rating` (crosses above 90 / 80, falls below 80; NNenov ships 85/70, 02 §1.3), `mansfield_zero` (above / below), `rrg_quadrant` (enters Leading / Improving). Alert copy: "NVDA: RS new high before price (weekly) vs SPY."
3. **Discord "RS leaders on a red day" post** on any session where SPY closes ≤ −0.5 %, through the screener alert routing that already posts to Discord (`screen_alerts.py`, `alert_routing.py`; exact hook verified at build), premium scanners channel, suppressed under three names, attributed to the rule and the method, never to a person. Template, no emoji:
   ```
   RS leaders on a red day · SPY −0.8 % · Wed Nov 5
   14 names made a relative-strength 52-week high while the market fell.
   Before price too: NVDA · CRWD · AXON · HOOD
   Also: APP · ANET · VRT · …
   Rating 90+ in bold. Chart → UCT RS → Stress test preset. Method: UCT RS & Weakness workshop, 5:41.
   ```
4. **Leadership list (brand vocabulary):** an auto-built watchlist, refreshed nightly: `rs_rating_ibd ≥ 90 ∧ rs_nh_days_ago ≤ 10 ∧ above 200-day ∧ rs_benchmark_agree`, grouped by theme, capped at 30. **Emerging:** crossed above the 21 EMA within 5 sessions ∧ rating ≥ 80. **Rotation view** (Phase 3): the Compare panel gains a rotation plot of the watchlist's or theme's RS-Ratio / RS-Momentum with tails, quadrant-coloured.
5. **Study and Compass:** each marker's three lines are what Compass says when asked "what does the gold dot mean"; Study gains a drill family "Which of these two RS lines is the leader?" and, in Phase 4, a replay drill over rating history.

## 11. Engineering: what exists, what changes

| Need | Exists today (verified) | Change |
|---|---|---|
| Simple / Advanced inputs | `group`, `tooltip`, `activeWhen` in `defSchema`; collapsible groups and dimming in the dialog | None. Author the definition. |
| Inputs / Style / Visibility | `IndicatorSettingsDialog` three tabs | None. |
| Presets | `indicatorTemplates.js` additive templates behind `indicatorTemplatesEnabled()` | Ship the seven presets as read-only templates; turn the flag on for members (D10); a `preset` enum input that writes a template's inputs. |
| Markers | `markerPrimitive.js`, `{0,1,NaN}`, four shapes, text ≤ 24 | None. |
| Phone editing | `MobileIndicatorSheet` | None if types stay in vocabulary. |
| Several columns + payload | Provider returns one column | Extend `_rs_line_provider` to §8; `serverCompute.js` passes `payload` through. The lane stays generic (no `if defId`; the AST test enforces it). |
| Legend reads payload scalars | `readout.js` reads series values only | Small addition: a definition-level `readout: [{key, label, source, format}]` the chip and readout rows render. If refused, a hand-written RS legend block (the pattern the engine is retiring, so the schema route is preferred). |
| Three-line marker cards | Plots have `legend`; no tooltip text | Small addition: `plots[].card: {what, origin, evidence}` strings; the evidence string is replaced at runtime by `payload.evidence` when present. |
| Bar count | `_fetch_bars_for_tf(…, count=400)` | Pass `N + 600` daily, `N + 200` weekly from the provider. |
| Benchmark macros | Enum SPY/QQQ/IWM | Enum grows: RSP, SECTOR, INDUSTRY, CUSTOM (Phase 3); server resolves. `symbol` stays reserved for natives; un-reserved for server-lane definitions only in Phase 3 (A3 preserved for natives). |
| Price overlay with own scale | Compare panel `scaleMode: 'new'` | `placement.scale: 'own'` in `defSchema` + binder (Phase 3). |
| Rating history | None | Worker job after the screener build: `rs_rating_history(session, ticker, ibd, fast, m1, m3, m6, m12)`, PK `(session, ticker)`, backfill from `bars.db` behind a `.rs_history_backfill_v1` flag file, snapshot to R2 (Phase 2). |
| Nightly backtest | None | Worker job writing `rs_evidence(signal, benchmark, horizon, regime, median, mean, hit, n, effN, dates, ciLo, ciHi, from, to, computedAt)` (Phase 2). |
| Alerts | `INDICATOR_FUNCS` dict | Add the §10.2 rows; the popover needs no change. |
| Tier | `require_paid` on the lane | Unchanged; premium. |

## 12. Validation and definition of done

### 12.1 Fixture sets (all four, no single frame)
1. **Public method parity.** Mansfield vs the stageanalysis TradingView script on five tickers over two years (weekly), within rounding; Clenow score vs the quant-investing worked example; VARS vs the OANDA case study shape; RRG quadrant agreement with StockCharts' RRG on a sector ETF set for the last 12 weeks ≥ 85 % (our normalisation differs, so agreement, not identity).
2. **MarketSurge / Deepvue parity.** 20 owner screenshots (10 daily, 10 weekly, dates visible): IBD-style rating within ±3 (report the distribution; replicas report ±3–5); blue-dot days within ±1 bar; before-price agrees; Deepvue components within ±3.
3. **Curriculum parity.** Manrav's GS, D and MARA crosses (video 59) within ±1 bar; Chartmaster's dated Discord "RS new highs" posts (once the owner runs the pod query): ≥ 90 % flagged by `rsNHred` that session, misses listed by name with reason.
4. **Literature replication.** On our universe 2016–2026 with point-in-time rules: reproduce the direction of Bulkowski's finding (post-breakout RS confirmation beats pre-breakout RS) and the DWA shape (top RS decile beats the equal-weight universe in most rolling 3-year windows). Publish whichever way it comes out.

### 12.2 Usability acceptance (Phase 1 gate)
Five members the owner picks, never having seen the indicator, on their own devices, two on phones, no coaching. Within 60 seconds each: turn it on; say which benchmark it compares to; point to the most recent RS new high; read the rating and say what 90 means; change the benchmark to the sector. **Pass = 4 of 5 on all five tasks.** One session recorded for the Phase 4 walkthrough. Separately: the default palette passed through deuteranopia and protanopia simulation with markers distinguishable by size and ring, screenshots in the PR; every control reachable by keyboard with the gold focus ring; no text under 11 px.

### 12.3 Named tests
- `app/src/components/chart/engine/__tests__/rsIndicator.golden.test.js`: single-symbol RS = 1.0; every event column ∈ {0,1,NaN}; warm-up NaN lengths exactly `L − 1`, `N`, `252 + W`; time-joined never index-joined (benchmark missing a holiday bar); weekly N = 52; tie counts as new high; `tol` boundary; Mansfield zero at `RP = SMA`; RRG quadrant boundaries at exactly 100; Clenow `R² = 1` on a perfect exponential; VARS = 0 when stock and benchmark move equal ATR multiples.
- `tests/test_rs_columns_provider.py`: payload shape §8; benchmark resolution incl. SECTOR fallback and INDUSTRY composite; 422 unknown benchmark; `rev = 2`; bar count ≥ `N + 600`; p95 latency under budget on a warm cache; no `if def_id` (existing AST rail).
- `tests/test_rs_rating_ibd.py`: §7.14 on a synthetic universe; renormalisation; `None` when the 63-day term is missing; percentile edges 1 and 99; ETFs excluded from the ranked set but rated.
- `tests/test_rs_rating_history.py`: idempotent backfill; one row per (session, ticker); today's row written at the close.
- `tests/test_rs_evidence_job.py`: point-in-time universe used; first-event de-overlap; shrinkage; suppression under effective N 100; no forward return begins before t+1.
- `tests/test_indicator_alert_catalog_rs.py`: the §10.2 rows exist and evaluate on fixtures.
- `app/src/components/chart/__tests__/rsPresets.test.js`: each preset applies additively; applying twice adds nothing; dims the right inputs; Reset restores.
- Existing rails that must stay green: `registrySizes`, the AST rail, the free-user-refused-on-every-route rail, `singleWriterIndex`, `designTokens.test.js` (warn ≠ premium).

### 12.4 Definition of done per phase
| Phase | Done when |
|---|---|
| 0 | Owner rules D1–D12; sector-map coverage and industry-composite reachability measured (§17); Chartmaster posts pulled; parity screenshots collected. |
| 1 | Classic, Phase and Stress presets as written in §5–6; all §6.3 inputs with tooltips; markers and three-line cards with launch evidence copy; Leadership readout minus rating history and evidence rows; states §6.12; §12.1 sets 1 (Mansfield excluded), 3 and §12.2 green; budgets met and recorded. |
| 2 | IBD-style rating, components, Δ5/Δ20, history line and bands; nightly evidence job and the evidence rows live; Trend (Mansfield) preset; screener columns and presets; alerts; Discord post behind its flag; §12.1 sets 2 and 4 recorded. |
| 3 | Price overlay with own scale; CUSTOM benchmark; Rotation, Quality and Volatility-adjusted presets; rotation view in the Compare panel; clickable anchor date; intraday polish. |
| 4 | Leadership and Emerging lists; tour; Learn links; Study drills; Compass sentences; a 90-second walkthrough video on the Desk; glossary page. |

## 13. Rollout, rollback, telemetry, success

- **Saved layouts keep working.** Definition keeps `id: 'rsLine'`, bumps `version: 2`; every new input has a default; an existing `{benchmark: 'QQQ'}` instance renders Classic against QQQ. One migration toast (§6.12).
- **Flags.** `RS_V2_ENABLED` on the web pod (server returns the v1 single column when off; the client hides new plots on `rev: 1`); `admin` first, then all. `RS_HISTORY_ENABLED` and `RS_EVIDENCE_ENABLED` on the worker. `RS_DISCORD_POST_ENABLED`. Indicator templates flag on for members (D10).
- **Rollback.** Unset the flag and `railway redeploy --service web --yes` (a variable delete alone does not restart the process; the deploy runbook's measured rule). Code rollback = revert; the history and evidence tables are additive and may stay.
- **Telemetry** (counts only, the chart's existing telemetry pattern): `rs_on`, `rs_off_within_60s`, `rs_preset{name}`, `rs_benchmark{value}`, `rs_advanced_opened`, `rs_style_opened`, `rs_template_saved`, `rs_marker_card{kind}`, `rs_learn{target}`, `rs_tour{card}`, `rs_compact_mode`.
- **Success after 30 days:** ≥ 25 % of active chart members have it on; `rs_off_within_60s / rs_on` < 10 %; ≥ 3 presets each used by ≥ 5 % of users; ≥ 20 % of users open a marker card; Learn clicks on every marker kind; zero support tickets about "wrong rating" that the ±3 label does not answer.

## 14. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Our IBD-style rating disagrees with MarketSurge for many names | Label the deviation on the number; readout shows universe size and method; parity distribution published in the PR. |
| Seven presets confuse a beginner | Classic is the default and the tour never mentions the others; presets live behind one menu with one line each; telemetry on preset use decides whether to trim. |
| The honest evidence lines dampen enthusiasm | They are what makes the "beyond" claim true; the copy pairs each caveat with the positive finding; members who want hype have other tools. |
| Nightly backtest produces an unflattering number for the before-price dot | Publish it. The design principle is honesty; the marker stays because members expect it and it is a confirmation read (Bulkowski). |
| Momentum-crash regime arrives and leaders reverse | The regime chip names the state in one line, as the research says it is forecastable in state, not timing. |
| Sector / industry auto resolves wrong for conglomerates | Legend always prints the resolved benchmark; one click to override; coverage measured before launch. |
| Marker clutter on long charts | Density rule; compact mode; Visibility defaults. |
| Server cost rises (22 columns, three benchmarks, 852 bars) | Session caching; measured budget; the price chart never waits on RS. |
| Templates flag is dark for members | Decision D10; fallback is a `preset` enum alone (less convenient, same inputs). |
| The Discord post reads as a person's call | Attributed to the method and timestamp; posted by Uncharted Scanners; suppressed under three names; no emoji, no adjectives. |

## 15. Phases and sizing
| Phase | Scope | Size |
|---|---|---|
| **0 — Close the research** | §17; D1–D12; screenshots; pod query. | 2–3 days |
| **1 — Classic, Phase, Stress** | §6 complete except rating history, evidence rows, overlay and three later presets; §7.1–9, 18–21; §8; §11 rows marked "none" plus provider, readout and card additions, bar count; §12.1 (1, 3), 12.2, 12.3 (golden, provider, presets, alerts). | ~3 weeks |
| **2 — Rating, evidence, Trend** | §7.10, 14–17; §9 nightly job; §10.1–10.3; §12.1 (2, 4). | ~2.5 weeks |
| **3 — Overlay, custom benchmark, Rotation / Quality / Volatility-adjusted** | §7.11–13; §11 overlay and symbol rows; rotation view; anchor click. | ~2 weeks |
| **4 — Teach it** | §6.11 tour and Learn; §10.4–10.5; walkthrough video; glossary page. | ~1.5 weeks |

Phases 1 and 2 are independent and run on both build machines under the existing channel. Sizing grew from v2 because three more presets, the evidence job and the usability gate are in scope; they are what make it the field's indicator rather than one shop's.

## 16. Owner decisions (recommendation first)
1. **Default benchmark.** SPY (IBD, Deepvue, the curriculum) **[recommend]**; or RSP given the 2023–24 evidence. RSP and Sector sit on the Simple menu either way.
2. **New-high lookback.** 252 sessions, called "52-week" **[recommend]**; or 250 (Fred6724, Chartmaster's "200–250").
3. **Red-day threshold.** −0.5 % **[recommend]**, adjustable; or −1.0 %.
4. **Headline rating.** IBD-style with the ±3–5 label, UCT fast beside it **[recommend]**; or UCT fast as headline.
5. **Discord post.** Automatic on qualifying down days, premium channel, ≥ 3 names **[recommend]**; or owner-approved.
6. **RS pane axis.** Hidden numbers, words in the legend **[recommend]**; or the raw ratio as TradingView shows it.
7. **Default placement at launch.** Pane under price until the Phase 3 overlay ships **[recommend]**; or hold launch for the overlay.
8. **Gold for the before-price dot.** Use the brand's premium gold as the "look here" mark, like HVC bars **[recommend]**; or keep the field's dark-blue convention and reserve gold for chrome.
9. **Phase colouring on in Classic.** Line coloured above/below its 21 EMA by default **[recommend]**, since the curriculum teaches it; or a static line as IBD draws it.
10. **Indicator templates flag.** Turn `indicatorTemplatesEnabled()` on for members so presets save and share **[recommend]**; or ship presets as a plain enum first.
11. **Evidence lines at launch.** Show the field's published findings with sources until our numbers exist **[recommend]**; or show nothing until Phase 2.
12. **Seven presets or four.** Ship all seven across Phases 1–3 **[recommend]**; or Classic, Phase, Trend, Stress only.

## 17. Open research items (Phase 0)
1. **Chartmaster's Discord posts** (fixture set 3): owner runs the read-only pod query (`scratchpad/rs/run.sh`).
2. **Sector ETF coverage:** measure the share of the cap universe with a GICS sector in `ticker_meta`; below 95 % the SPY fallback will be common and the legend must say so.
3. **Industry composite reachability:** confirm the Compare panel's industry groups (built client-side from the theme taxonomy) are available server-side; otherwise ship INDUSTRY in Phase 3.
4. **MarketSurge specifics** [U]: exact blue-dot lookback and whether the US product shows dot history; owner screenshots settle both.
5. **IBD short-history handling** [U]: we compute on available data and flag; revisit if a primary source appears.
6. **Weekly MA convention:** Fred6724 uses a 10-week SMA; the curriculum's 21-day EMA has no weekly analogue stated; D-minor, default 21 weeks with a tooltip hint.

## 18. Glossary (member-facing; from 04 §c, brand voice)
1. **RS line** — The stock's price divided by the market's, drawn as a line. Up means beating the market; down means lagging it. Only its direction and its own prior highs matter.
2. **RS Rating** — A 1–99 rank of the stock's price change over roughly the past year against every other stock in the universe. 90 means it beat 90 % of them. Ours is IBD-style, typically within ±3–5 points of MarketSurge.
3. **RS new high** — The RS line is higher than at any point in the lookback.
4. **RS new high before price** — The RS line hits a new high while price is still below its own high. IBD calls it more bullish and not a precondition.
5. **Benchmark** — What we compare against: the S&P 500, the equal-weight S&P, the Nasdaq 100, the Russell 2000, the stock's sector or industry group. Change it and the question changes.
6. **Mansfield RS** — Weinstein's version: the ratio measured against its own 52-week average so it swings around zero.
7. **Rotation quadrant** — Leading, Weakening, Lagging, Improving, from the ratio's trend and that trend's momentum. A map, not a system.
8. **Momentum** — How fast a price, or an RS line, is moving. The academic name for relative strength.
9. **Relative weakness** — The stock is losing ground to the market, even if its price is rising.
10. **Leader vs laggard** — A leader beats the market and its group; a laggard trails them.
11. **Defensive RS** — RS that rises only because the stock fell less than a falling market. It can fade when the market recovers.
12. **Lookback** — The window for a rating or a new high. Shorter reacts faster and flips more often.
13. **Percentile rank** — "Beat X % of the group."
14. **Divergence** — Price and the RS line disagree. Price at a new high without RS is a warning; RS rising while price falls is hidden strength.
15. **Regime** — The market state the signal lives in. Leaders keep leading in persistence regimes and reverse hardest in rebounds after bear markets.

## 19. Sources
- **Knowledge base:** `docs/research/relative-strength/00-synthesis.md`, `01-methodologies.md`, `02-products-and-ux.md`, `03-evidence.md`, `04-how-rs-is-taught.md` (each with URLs and verification tags).
- **Code read for this plan (master `3e11e6bf63`):** `app/src/components/chart/engine/{nativeRegistry,defSchema,serverCompute,markerPrimitive,readout,instanceControls}.js`, `app/src/components/chart/{IndicatorLibraryDialog,IndicatorSettingsDialog,IndicatorAlertPopover}.jsx`, `app/src/components/chart/builder/indicatorTemplates.js`, `app/src/components/chart/{chartTemplateApply,chartThemes,designTokens,chartDefaults,discoveryCatalog}.js`, `app/src/pages/charts/mobile/MobileIndicatorSheet.jsx`, `app/src/pages/charts/CompareSymbolsPanel.jsx`, `app/src/components/ui/UIcon.jsx`, `app/src/styles/tokens.css`, `app/src/App.jsx`, `api/routers/{signature,education}.py`, `api/services/signature/registry_defs.py`, `api/services/{rs_ranking,rs_weighted_return,indicator_alert_evaluator}.py`, `api/services/screener/{technicals,enrich,screen_alerts}.py`, `api/services/alert_routing.py`, `app/src/components/RsBadge.jsx`.
- **Brand:** `docs/brand-design-system.md` §1–3, §16, §18, §22; `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §1.5, §3.1, §6 (settings form, state inventory).
- **Education library:** Manrav `sM-aFdyOps4` (video 59); Chartmaster `mfswYu5UlX8`, `_0ZvKLYznLo`, `QCTOJgCQmjw`, `uugeU83Ns84`; curriculum videos 59, 61, 63.
