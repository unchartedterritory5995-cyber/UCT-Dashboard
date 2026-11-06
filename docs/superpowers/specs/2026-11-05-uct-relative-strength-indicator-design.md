# UCT Relative Strength — the indicator, the rating, and the Chartmaster rules

**Status:** 🟡 PLAN v2, for owner review (2026-11-05). No implementation alongside it.
**Owner ask (2026-11-05):** "Make the charts widget RS indicator elite to an extreme level — MarketSmith / MarketSurge / Deepvue / TradingView and beyond. Combine that with Chartmaster's Discord library and the RS indicator he uses, and make a plan for a UCT-specific Relative Strength indicator." Follow-up the same evening: "If it does not reach a 99/100 level of quality then get it there" — v2 is that pass.
**Base:** `origin/master` `3e11e6bf63`. **Branch:** `docs/uct-rs-indicator`.
**Relationship to prior work:** extends the shipped server-lane RS line (Phase C Tasks 13/14, `nativeRegistry.RS_LINE_RAW`, `signature._rs_line_provider`) and the universal-indicator ecosystem (`docs/superpowers/specs/universal-indicator-ecosystem/`). It does not touch the Pine parity waves, but §9 names the one capability both programmes need.

**What v2 added over v1 (self-review, recorded so the next reader knows what was missing):** v1 had the gap analysis, Chartmaster's rules and the feature list, but no description of what a member actually sees and touches (§4), no exact formulas (§5), no server contract (§6), no definition of done or named tests per phase (§11), no rollout/rollback/telemetry (§12), no risks (§13), no member glossary (§16), and it did not know the server lane fetches only 400 bars (§8.6). Those are the sections that turn a brief into a plan someone can build and a product a member can use without reading a manual.

---

## 0. The one-paragraph version

A member opens the indicator library, types "RS", and turns on **UCT Relative Strength**. One pane appears under the price: the RS line against the S&P 500 with its 21-day EMA, coloured turquoise when leading and red when lagging, blue dots where the RS line makes a 52-week high, a bigger dark dot where it does so **before** price (Chartmaster's "beach ball underwater"), and a gold dot where it happens on a red market day (his favourite tell). The legend shows the RS Rating — the same 1–99 number MarketSurge and Deepvue print — beside UCT's faster rating. Hovering any dot explains it in one plain sentence. Switching to Pro mode exposes every knob the pros have: any benchmark (sector ETF, industry group, any symbol), lookback, thresholds, a rating-history line, a Relative Weakness mode, and the four manual checks from the workshop computed as numbers. The same columns run in the screener, fire alerts, build the leadership list, and post "RS New Highs" to Discord on down days. Nothing requires a setting to be useful on first click.

## 1. Where we are today (measured on master, 2026-11-05)

| Surface | What exists | Verdict |
|---|---|---|
| Chart widget → "Relative Strength Line" | `close ÷ benchmark close`, benchmark enum **SPY / QQQ / IWM**, own pane (15 %), one line, 4-decimal legend ("0.0423"). Premium. Library description: *"This symbol's close divided by a benchmark's — is it leading or lagging the market?"* | Basic. No MA on the line, no markers, no overlay, no rating. The legend value is a raw ratio no member can read. |
| Chart widget → "% From MA", "52-Week High/Low" | Filed under the Relative Strength heading. | Extension/level studies, not RS. |
| RS Rating (1–99) | `api/services/rs_ranking.py` + `rs_weighted_return.py`. Universe = cap universe ($300M+, 3,742 tickers). Hourly in-memory cache, disk snapshot, **no history**. Shown as `RsBadge` on Research header, video dock, notebook — **never on the chart**. Route `api/routers/rs_ranking.py`. | Exists, but the formula is **not IBD's** (§5.8) and the chart never shows it. |
| Screener | `rs_rank`, `rs_return`, `rs_line_trend` (20-bar slope of ticker/SPY → up/flat/down), `sector_rs_pct`. | Good raw material for scans; nothing visual. |
| Indicator alerts | `IndicatorAlertPopover` reads `GET /api/indicator-alerts/catalog`, which is `indicator_alert_evaluator.INDICATOR_FUNCS` (rsi, macd, bb, price_vs_ma, ma_cross, …). | No RS entry. Adding RS alerts = adding rows to that one dict; the popover picks them up with no UI work. |
| Compare Symbols panel | Overlays other tickers' normalised % performance; supports theme / sector / industry groups and per-item `scaleMode: 'new'`. | The overlay-with-own-scale mechanics already exist on the chart — reuse. |
| Engine schema (`defSchema.js`) | `PLOT_STYLES` has `markers` (shape, position, size, text ≤ 24 chars) rendered by `markerPrimitive.js` from 0/1/NaN event columns; `line`, `histogram`, `area`, `baseline`, `hlines`, `band`. `PLACEMENT_TARGETS` = price / pane / volume. `symbol` is a **reserved** input type (decision A3). | Markers and pane are ready today. Price overlay with its own scale and a free-text benchmark are the two schema changes (§8). |
| Server lane | `_rs_line_provider(sym, tf, inputs)` fetches `_fetch_bars_for_tf(sym, tf, count=400)` for both symbols, returns `{"columns": {"rsLine": [...]}, "times": [...], "asOf": ...}`. | **400 bars is not enough** for a 252-session new-high lookback with any history behind it (§8.6). |
| Phone | `MobileIndicatorSheet` already edits int/float inputs with −/+ steppers, enums, colours (8 swatches) and switches. | The new inputs render on the phone with no new UI, if we keep input types inside the existing vocabulary. |

**What the elite tools have that we don't:** RS line on the price pane; RS-line new-high "blue dot"; RS new high *before* price; any benchmark (sector ETF, industry group, any symbol); a moving average on the RS line; the RS Rating printed on the chart with 1M/3M/6M components and a plottable rating history; industry-group RS; one-sentence explanations on hover (nobody has that — it is where "beyond" lives).

## 2. What Chartmaster actually does (sources: his four UCT workshops)

Transcripts pulled 2026-11-05 from the education library's YouTube ids: `mfswYu5UlX8` (RS & Weakness), `_0ZvKLYznLo` (Mastering RS), `QCTOJgCQmjw` (Options / RS / Pullbacks), `uugeU83Ns84` (8-Week EMA & PEG). Manrav's RS workshop `sM-aFdyOps4` is the firm's second RS source and matches the curriculum's anchor lesson (video 59, "The RS Line vs. SPY: Building the 21-EMA Cross").

**His tool.** A MarketSurge-style **RS Rating indicator** ("likely based off Mike Webster's relative strength rating"), configured so it **flags relative-strength new highs on the day**. He says the rating relates the stock to the rest of the S&P 500 stocks. Lookback for "RS new high" in his words: "the last 200–250 sessions". He turns it on and "goes around and finds" the names.

**His rules, verbatim where it matters:**

| # | Rule | Where he said it |
|---|---|---|
| R1 | **Hunt RS new highs on red market days.** "The ones that show new relative strength highs specifically on red days are almost tipping their hand." | RS&W 5:41 |
| R2 | **Rating floor.** "Most of the stocks we trade are over 90 RS rating. I like them pushing 95 or higher." | RS&W 21:38 |
| R3 | **RS new high *before* price** on the **weekly** chart: "they all showed the relative strength high on the weekly before breaking out … before putting in new highs." The "beach ball underwater." | Mastering 30:14, 47:35 |
| R4 | **Rising RS line, never declining.** A declining RS line + rounding top = avoid / short candidate. A red candle on a day everything else is up "is a sign of not having relative strength." | RS&W 8:22, Mastering 75:47 |
| R5 | **Buy RS names on weakness:** gap-down → reclaim, pullback to the **8-day EMA** (daily) or **8-week EMA** (weekly), 30-minute pivot, first pullback after an all-time high. | Mastering 12:18–20:03, Opt 25:16 |
| R6 | **Right theme matters.** "Relative strength in the wrong theme or wrong sector is a killer." | Mastering 77:27 |
| R7 | **200-day rule.** No longs below the 200-day, no shorts above it. | Opt 62:54 |
| R8 | **Three lists:** RS/leadership list (5–30 names), emerging setups, catalyst / PEG gappers. | Mastering 48:25 |

**The four manual RS checks (owner's framing in the same workshop, 12:06–18:15):**
1. **Relationship to the moving averages vs the index** — e.g. QQQ 16 % *below* its 200-day while PLTR bottomed 15 % *above* its own.
2. **Anchoring to key dates** — how the stock behaved from a named market pivot (e.g. Nov 14) versus the index.
3. **Ability to move quickly away from pivots** — opened at the lows and closed at the highs while QQQ was down 1.6 %.
4. **Green on red days**, plus the RS Rating indicator as the mechanical check.

**Manrav's indicator (what the curriculum's anchor lesson teaches):** 3-month RS line vs SPY (switchable to QQQ for tech), coloured turquoise above / red below its **21-day EMA**; long signal = RS line crosses above the 21 EMA; watch for RS new highs diverging from a correcting market; combine with a Launchpad (8/21/50 stacked).

**Still to fold in (Phase 0):** his Discord posts in `#1chartmaster` (wisdom.db on the web pod). The read-only query is written; the owner runs it. Every dated "RS new highs" post becomes a fixture (§11.1).

## 3. Design principles

1. **Everything Chartmaster does by eye becomes a column, a marker, or a number.** One definition, several plots, so a member turns on "UCT RS" and gets his whole method, and the screener runs the same columns across the universe.
2. **Useful on the first click, with zero settings.** Simple mode is the product; Pro mode is for the ten percent who want the knobs. No default needs changing to trade the way the workshops teach.
3. **Every dot and number explains itself in one sentence**, in Chartmaster's words where we have them. Hover on desktop, long-press on phone.
4. **Never invent a value.** Not enough history → NaN and a hollow marker, never a 0 that reads as "no signal". Same rule as `rs_weighted_return` ("an absent period is dropped, it never becomes a value").
5. **One answer everywhere.** The chart, the screener, the alert, the Discord post and the leadership list read the same server columns, so a member never sees a dot on the chart that the scan would not have found.
6. **Match the pros where a number already has a meaning** (RS Rating 1–99, 52-week blue dot) and name our own things differently ("UCT RS (fast)") so nobody confuses the two.

## 4. What the member sees (user-friendliness spec)

### 4.1 Finding it
- **Library row:** name **"UCT Relative Strength"**, short name **"UCT RS"**, category Relative Strength, **Premium** badge (as today). The current "Relative Strength Line" row is replaced, not duplicated — saved layouts with `rsLine` keep working (§12.1).
- **Description (shown in the library):** *"Is this stock leading or lagging the market? The RS line vs a benchmark, with Chartmaster's signals: RS new highs, RS new highs before price, RS new highs on red days, and the 1–99 RS Rating."*
- **Search aliases** (library search is search-first, TradingView-style): "RS", "relative strength", "RS rating", "blue dot", "leader", "Chartmaster", "Mansfield", "comparative".
- The two mislabelled studies ("% From MA", "52-Week High/Low") move out of the Relative Strength category to Price Levels, so the category contains only RS.

### 4.2 First turn-on (Simple mode)
What appears with no settings touched:
- A **pane under price (18 % height)** with the RS line vs **SPY** and its **21 EMA**. Line turquoise above the EMA, red below (Manrav/curriculum colours; both are also distinguishable by the EMA being dashed, §4.9).
- **Blue dots** under the RS line on RS 52-week highs. **Large dark-blue dot with "RS>P"** when the RS high comes before a price high. **Gold dot "NH/RED"** when it comes on a red market day.
- **Legend chip:** `UCT RS · vs SPY · +2.1% vs 21 EMA ↑ · 52-wk high ✓ 3d ago · RS 94`.
- **No axis numbers on the RS pane** (decision D6). The raw ratio is meaningless to a member; what matters is slope, the EMA relationship and the highs, which the legend states in words.
- A one-time **three-card tour** the first time any member turns it on (dismissable, never shown again, stored in preferences): *1. The line: up = beating the market. 2. The dots: blue = RS at a 52-week high; dark blue = before price did; gold = on a red day (the tell). 3. The number: RS Rating 1–99, Chartmaster trades 90+.* Each card has a "Watch the lesson" link (§4.10).

### 4.3 Simple vs Pro settings
The settings row (desktop) and `MobileIndicatorSheet` (phone) render inputs from the definition. Simple mode shows the first six; Pro shows all. Implemented as an `advanced: true` flag on an input, rendered as a collapsed "Advanced" group by both surfaces (one small schema addition, §8.4; fallback if refused: order the inputs so the six Simple ones come first).

| Group | Input | Type | Default | Plain-English help text |
|---|---|---|---|---|
| **Simple** | Benchmark | enum | S&P 500 (SPY) | "What are we comparing against? Sector and Industry pick the right group for this stock automatically." Options: S&P 500 (SPY) · Nasdaq 100 (QQQ) · Russell 2000 (IWM) · Equal-weight S&P (RSP) · **Sector ETF (auto)** · **Industry group (auto)** · Custom symbol (Phase 3) |
| | Show RS new highs | bool | on | "Blue dot when the RS line hits its highest level in the lookback." |
| | Show RS new high before price | bool | on | "Big dark dot: the RS line made a new high while price has not yet. Chartmaster's 'beach ball underwater'." |
| | Show RS new high on red day | bool | on | "Gold dot: an RS new high on a day the market closed down. 'They're almost tipping their hand.'" |
| | Show RS Rating | bool | on | "The 1–99 rating in the legend. 99 = top 1% of the market over the last year." |
| | Moving average on RS line | int | 21 | "Turquoise above, red below. 21 is the lesson default; 8 for fast, 50 for slow." (min 2, max 200) |
| **Advanced** | MA type | enum | EMA | EMA / SMA |
| | New-high lookback | int | 252 | "Sessions. 252 ≈ one trading year (what MarketSurge calls 52-week). Weekly charts use weeks." (min 20, max 500) |
| | Price-high tolerance | float | 2.0 % | "Price counts as 'not at its high' when it is more than this far below its own lookback high." |
| | Red-day threshold | float | −0.5 % | "The benchmark must close at least this much down for a 'red day'." |
| | Short-history dots | bool | on | "Hollow dot when the stock has fewer bars than the lookback (new IPOs)." |
| | Green-on-red markers | bool | off | "Small green triangle on days the stock closed up while the market closed down." |
| | RS line / MA cross arrows | bool | off | "Arrow when the RS line crosses its moving average (the curriculum's long signal)." |
| | Headline rating | enum | IBD 12-month | IBD 12-month (matches MarketSurge/Deepvue) / UCT fast (reacts in days) / Both |
| | Rating history line | bool | off | "Plot the RS Rating as a line in its own pane with the 90 and 80 bands." (Phase 2) |
| | Relative Weakness mode | bool | off | "Flip everything: RS new lows, red-on-green days, declining-MA colouring. Chartmaster's short-side read." |
| | Scorecard | bool | on | "Show the four workshop checks in the detail readout." |
| | Placement | enum | Pane | Pane / On price (own scale) (Phase 3) |
| | Colours & widths | color / int | see §4.9 | line up, line down, MA, dot colours, line width 1–4 |

Rules: every input has a `label` and a one-line `help`; no abbreviation appears without its expansion in the help text; every numeric input has a min/max so the stepper on the phone cannot produce nonsense.

### 4.4 Legend and hover
- **Legend chip (always):** benchmark name, % distance from the RS MA with ↑/↓ slope arrow, "52-wk high ✓ N d ago" or "— below high by X%", the rating(s). Rating coloured by the `RsBadge` tiers (≥80 lead / ≥60 strong / ≥40 neutral) so the colour language matches the rest of the site.
- **Crosshair:** moving the cursor shows that bar's values (ratio hidden, the words shown) and the rating on that date once history exists (Phase 2).
- **Marker hover / long-press:** a tooltip with the marker's name, the date, and its sentence (§4.5). On the phone the tooltip is a small sheet with a "Learn" link.

### 4.5 The markers, in the member's words

| Marker | Looks like | Tooltip sentence |
|---|---|---|
| RS New High | small blue dot under the RS line | "The RS line closed at its highest level of the last 52 weeks. The stock is beating the market by the most in a year." |
| RS New High before Price ("RS>P") | large dark-blue dot, text "RS>P" | "RS made a new high while price has not. Chartmaster: 'they all showed the relative strength high before putting in new highs.'" |
| RS New High on Red Day ("NH/RED") | gold dot, text "NH/RED" | "An RS new high on a day the market closed down. Chartmaster: 'they're almost tipping their hand.'" |
| Short-history RS high | hollow blue dot | "RS high over all available history (fewer than 252 sessions trade). Treat with care." |
| Green on Red | small green triangle under price | "Stock closed up while the benchmark closed down." |
| RS / MA cross | up or down arrow on the RS pane | "RS line crossed above/below its 21 EMA. The curriculum's long signal (above)." |
| RS New Low (weakness mode) | red dot | "The RS line closed at its lowest level of the lookback. Chartmaster treats this as an avoid or a short candidate." |
| Red on Green (weakness mode) | small red triangle | "Stock closed down while the benchmark closed up." |

Density rule: when more than 600 bars are visible, plain RS New High dots shrink to 1px ticks and the RS>P / NH/RED dots stay full size, so a five-year weekly chart is readable.

### 4.6 The RS Scorecard (readout)
In the indicator's detail readout (where the engine shows per-indicator rows today), and in the crosshair legend's expanded form, a compact card:

```
RS SCORECARD · NVDA vs SPY · Daily
Rating        IBD 96  ·  UCT fast 98  ·  Δ5d +2  ·  Δ20d +7
Components    1M 91 · 3M 97 · 6M 95 · 12M 96
RS line       +2.1% above 21 EMA, rising · 52-wk high 3 days ago (before price ✓, red day ✓)
Check 1 MAs   Stock +15% vs 200d  |  SPY −3% vs 200d          ✓
Check 2 Anchor Since SPY low 10/15: Stock +18%  |  SPY +6%      ✓
Check 3 Pivots 7 of last 10 market-down days closed in top third ✓
Check 4 Green-on-red  6 of last 20 sessions                    ✓
Theme         Semiconductors · sector RS 88 · group RS pct 92  ✓
200-day       Stock above · SPY above                          ✓
Pullback      1.8% above 8-day EMA (buy-the-8 zone < 1%)
```
Ticks are informational, never a verdict. Every row has the same hover explanation as its marker. A member clicks any row to jump to the relevant lesson (§4.10).

### 4.7 Phone
- Turn-on, toggles and numeric inputs use the existing `MobileIndicatorSheet` steppers, switches and swatches — nothing new to learn.
- The pane height is 22 % on phones (the 15 % pane is unreadable at 390 px wide).
- Long-press a dot → the tooltip sheet. The Scorecard is a sheet reached from the legend chip.
- Markers with text ("RS>P", "NH/RED") drop their text below 420 px width and keep shape + colour.

### 4.8 Timeframes
- **Daily:** everything.
- **Weekly:** identical, with the lookback in weeks (52), the MA default 21 weeks, the pullback row reading the 8-week EMA (R5), and the rating still the daily rating as of that week's last session. Chartmaster's R3 is a weekly rule, so the weekly chart is first-class, not a port.
- **Monthly:** RS line + MA + highs only; markers that depend on daily red days are hidden with a legend note "red-day markers are daily/weekly".
- **Intraday (1m–1h):** RS line vs the benchmark's intraday bars, MA, cross arrows; new-high markers off by default (a 252-bar lookback on 5-minute bars is two days and means nothing). The legend still shows the daily rating. The pane note says "RS highs are a daily/weekly signal".

### 4.9 Colour, shape and accessibility
- Defaults: line up `#4ECDC4` (the current turquoise), line down `#F87171`, MA `#E0DAC8` dashed, RS NH `#38BDF8`, RS>P `#1D4ED8`, NH/RED `#C9A84C` (the site's gold), green-on-red `#4ADE80`, weakness `#F87171`.
- **Never colour-only:** up/down is also dashed-vs-solid MA relationship and the arrow glyph; the three NH markers differ by size and text, not only hue. The palette is checked against deuteranopia and protanopia simulations before Phase 1 ships (acceptance item, §11.4).
- Text ≥ 11 px on markers; tooltips readable at 200 % browser zoom; animations none (the tour cards fade only, respecting `prefers-reduced-motion`).

### 4.10 Learn links
- Each tooltip, tour card and Scorecard row carries a "Learn" link into the Desk's education library: Manrav video 59 (RS line & 21 EMA), video 61/63 (leadership & rotation), and Chartmaster's four workshops at the timestamps in §2. Links use the existing education routes; no new pages.
- The Study module (`docs/study`) gets one new drill family in Phase 4: "Which of these two RS lines is the leader?" using real charts with the indicator on.

### 4.11 Empty, error and edge states (copy)
| State | What the member sees |
|---|---|
| Free member | The library row with the Premium badge and "Unlock with UCT Pro" (the server answers 402; nothing half-renders). |
| Benchmark has no bars for this timeframe | Pane shows "No SPY bars for this timeframe yet" and the line is hidden; never a flat 1.0 line. |
| Stock has < 63 sessions | Line and MA draw; rating chip says "RS — (needs 3 months)"; dots hollow. |
| Stock has 63–251 sessions | Everything draws; new-high dots hollow with the short-history sentence. |
| Benchmark = the stock itself (SPY vs SPY) | Pane note "Pick a different benchmark"; line hidden (single-symbol RS is 1.0, an existing golden test). |
| Sector/Industry auto cannot resolve (no GICS for the ticker) | Falls back to SPY and the legend says "vs SPY (no sector found)". |
| Server slow | Pane shows the last cached columns with a "updating…" chip; after 8 s "RS unavailable right now" — price chart never waits on RS. |

## 5. Exact definitions (the formulas the build implements and the tests pin)

Notation: `C[t]` stock close, `B[t]` benchmark close, joined by bar time; `N` lookback (252 daily / 52 weekly); `rs[t] = C[t] / B[t]`. Any bar where either close is missing → `rs[t] = NaN` and every derived column is NaN at `t`.

1. **RS line:** `rs[t]` as above. Displayed raw (decision D6). Legend shows `(rs[t]/rsMA[t] − 1) × 100` and the slope sign of `rsMA[t] − rsMA[t−1]`.
2. **RS MA:** EMA (default) or SMA of `rs`, length `L` (default 21), NaN for the first `L−1` bars. Colour column `rsAbove[t] = rs[t] ≥ rsMA[t]`.
3. **RS New High:** `rsNH[t] = 1` iff `rs[t] ≥ max(rs[t−N … t−1])` with all N prior values present; `0` otherwise; NaN when fewer than N prior bars exist **unless** short-history dots are on, in which case `rsNHpartial[t]` is the same test over all available bars (minimum 20) and renders hollow. Ties (equal to the prior max) count as a new high (matches the TradingView open-source convention).
4. **Price New High:** `pxNH[t] = 1` iff `C[t] ≥ max(C[t−N … t−1]) × (1 − tol)`, `tol` default 0.02. (A price within 2 % of its high is "at its high" for this purpose.)
5. **RS NH before Price:** `rsNHbeforePx[t] = rsNH[t] ∧ ¬pxNH[t]`.
6. **Red day:** `red[t] = (B[t]/B[t−1] − 1) ≤ −0.005` (threshold input). **Green on red:** `gor[t] = red[t] ∧ C[t] > C[t−1]`. **Red on green:** mirror.
7. **RS NH on Red Day:** `rsNHred[t] = rsNH[t] ∧ red[t]`.
8. **RS Rating (IBD-standard):** for each ticker in the cap universe with ≥ 63 daily closes, `score = 0.40·(C/C₋₆₃) + 0.20·(C/C₋₁₂₆) + 0.20·(C/C₋₁₈₉) + 0.20·(C/C₋₂₅₂)`; a missing term is dropped and the weights renormalised (the `rs_weighted_return` rule; the 63-day term is required). Rating = percentile rank of `score` across the universe, mapped to 1–99 (`ceil(pct × 99)`, floor 1). ETFs and the benchmarks themselves are excluded from the ranked universe but still receive a rating. IBD's exact proprietary weighting is not public; the parity target is ±2 against MarketSurge on the same date (§11.2), not identity.
9. **UCT RS (fast):** today's `rs_ranking` number unchanged (3M 40 % / 6M 20 % / 1M 20 % / 1W 20 %), renamed in the UI.
10. **Components:** 1M / 3M / 6M / 12M = percentile rank (1–99) of the plain period return over 21 / 63 / 126 / 252 sessions.
11. **Rating change:** `Δ5 = rating[t] − rating[t−5]`, `Δ20` likewise, from the history table (Phase 2); "—" before history exists.
12. **Scorecard rows:** Check 1 = `(C/SMA200(C) − 1)` vs `(B/SMA200(B) − 1)`, also for 50; Check 2 = `C[t]/C[a] − 1` vs `B[t]/B[a] − 1` from anchor `a` (default: the benchmark's lowest close of the last 20 sessions; user-clickable date in Phase 3); Check 3 = over the last 10 `red` days, count where `(C − L)/(H − L) ≥ 2/3`; Check 4 = `Σ gor` over the last 20 sessions; Theme = sector ETF's IBD rating and `sector_rs_pct`; 200-day flags = `C > SMA200(C)`, `B > SMA200(B)`; Pullback = `(C/EMA8(C) − 1)` daily, `EMA8` of weekly closes on weekly.
13. **Weakness mode:** `rsNL`, `rsNLpartial`, `rog` (red on green), colouring by `rs < rsMA ∧ rsMA falling`; rounding-top helper = three successive lower RS highs among the last 20 bars' local maxima.
14. **Weekly:** computed on weekly bars (Friday-dated, the site's convention), N = 52, L = 21 weeks, EMA8 of weekly closes. **Never** resampled from daily on the client.

## 6. Server contract

- **Endpoint:** unchanged, `GET /api/signature/columns?defId=rsLine&sym=&tf=&inputs=` (premium, `require_paid`). Only the inputs JSON and the response grow.
- **Response:**
  ```json
  {
    "columns": {
      "rsLine": [...], "rsMa": [...], "rsAbove": [...],
      "rsNH": [...], "rsNHpartial": [...], "rsNHbeforePx": [...], "rsNHred": [...],
      "gor": [...], "rog": [...], "rsCrossUp": [...], "rsCrossDown": [...],
      "rsNL": [...], "rsNLpartial": [...],
      "rsRatingHist": [...]            // Phase 2, NaN before history
    },
    "times": [...],
    "payload": {
      "benchmark": {"requested": "SECTOR", "resolved": "SMH", "label": "Semiconductors (SMH)"},
      "rating": {"ibd": 96, "fast": 98, "d5": 2, "d20": 7, "m1": 91, "m3": 97, "m6": 95, "m12": 96, "asOf": "2026-11-05"},
      "scorecard": {"ma50": [..], "ma200": [..], "anchor": {"date": "2026-10-15", "stock": 18.0, "bench": 6.0},
                    "pivotSpeed": [7, 10], "greenOnRed20": 6, "sector": {"etf": "SMH", "ibd": 88, "groupPct": 92},
                    "above200": [true, true], "distEma8": 1.8},
      "lastRsHigh": {"date": "2026-11-02", "beforePrice": true, "redDay": true},
      "history": {"bars": 1400, "short": false}
    },
    "asOf": 1762387200.0,
    "rev": 2
  }
  ```
- **Event columns** are `{0, 1, NaN}` exactly as `markerPrimitive.js` requires; the golden test asserts no other value appears.
- **Bars fetched:** daily `count = N + 600` (default 852) so a member sees two and a half years of dots behind the current one; weekly `N + 200`; intraday 400 as today. Benchmark fetched with the same count.
- **Benchmark resolution on the server:** `SPY/QQQ/IWM/RSP` literal; `SECTOR` → the ticker's GICS sector ETF from `ticker_meta` (XLK, XLF, …, fallback SPY with `payload.benchmark.fallback: "no sector"`); `INDUSTRY` → the UCT industry composite the Compare panel uses (equal-weight index of the group's closes, computed server-side and cached per session); `CUSTOM:<SYM>` (Phase 3) → `_sym_or_422`.
- **Caching:** key `(defId, sym, tf, canonical inputs JSON, session date)`; TTL 15 min intraday, until next session close for D/W/M; the rating block comes from the hourly `rs_ranking` cache and the nightly history table, never recomputed per request.
- **Performance budget:** warm response ≤ 150 ms p95 on the web pod; payload ≤ 80 KB gzipped for 852 bars × 14 columns; universe-wide nightly job ≤ 5 min. Measured in Phase 1's final review and recorded in the PR.
- **Errors:** unknown benchmark → 422 with `{"error": "unknown benchmark", "allowed": [...]}`; no bars → 200 with empty columns and `payload.history.bars = 0` (the client renders the §4.11 state); free member → 402 (unchanged).
- **Versioning:** `compute.rev: 2`. The client treats a `rev` mismatch as a cache miss, so a deploy never shows new plots over old columns.

## 7. Beyond the chart — the same columns everywhere

1. **Screener columns** (built from the same functions in the nightly screener snapshot): `rs_new_high`, `rs_nh_before_price`, `rs_nh_red_day`, `rs_nh_days_ago`, `green_on_red_20`, `rs_line_above_ma`, `rs_rating_ibd`, `rs_rating_chg_5`, `rs_rating_chg_20`, `rs_rating_1m/3m/6m/12m`, `rs_vs_sector_pct`. Presets published for the concept vocabulary: **"RS 90+"**, **"RS new high before price (weekly)"**, **"RS new highs on a red day"**, **"Emerging RS (crossed 21 EMA ≤ 5 days)"**.
2. **Alerts:** three rows added to `indicator_alert_evaluator.INDICATOR_FUNCS` (`rs_new_high` with conditions *any / before price / on red day*, `rs_ma_cross` *above / below*, `rs_rating` *crosses above 90 / 80 / falls below 80*). The popover and the alert evaluator pick them up with no UI change; alert copy: *"NVDA: RS new high before price (weekly) vs SPY — Chartmaster's beach-ball signal."*
3. **Discord "RS New Highs" post** on any session where the benchmark closes ≤ −0.5 %, routed through the existing screener-alert routing (`screen_alerts.py` / `alert_routing.py`) to the premium scanners channel, attributed to the rule, never to him. Template:
   ```
   📈 RS New Highs on a red day — SPY −0.8% · Wed Nov 5
   14 names made a relative-strength 52-week high today while the market fell.
   Before price too (RS>P): NVDA · CRWD · AXON · …
   Also: APP · HOOD · …
   Rating 90+ in bold. Open the chart → UCT RS to see the dots. Rule: Chartmaster RS&W workshop, 5:41.
   ```
   Owner-approved or automatic is decision D5. Posts are suppressed when fewer than 3 names qualify (noise rule).
4. **Leadership list (R8):** an auto-built watchlist in the Watchlists widget, refreshed nightly: `rs_rating_ibd ≥ 90 ∧ rs_nh_days_ago ≤ 10 ∧ above 200d`, grouped by theme, capped at 30 (his own range is 5–30). **Emerging list:** `rs_line_above_ma` turned true within 5 sessions ∧ rating ≥ 80. Each row shows the rating badge and the last-dot date.
5. **Study / Compass:** each marker's sentence (§4.5) is the explanation Compass gives when asked "what does the gold dot mean"; the Study drill family from §4.10.

## 8. Engineering notes — what has to change in the engine

### 8.1 Price overlay with its own scale (Phase 3)
`placement.target: 'price'` shares the price scale today; an RS ratio near 1.0 on a $400 stock would be a flat line at the bottom. Add `placement.scale: 'own'` (hidden right-side scale, autoscaled) — the Compare panel already drives lightweight-charts' per-series price scale (`scaleMode: 'new'`), so the binder change is small. Schema change → `defSchema` vocabulary + golden tests + `registrySizes` manifest.

### 8.2 Benchmark as a free symbol (Phase 3)
`symbol` is a reserved input type (A3). Sector (auto), Industry (auto) and RSP **do not need it** — they are enum values the server resolves. Custom symbol does. Un-reserve `symbol` for **server-lane definitions only** (the server already validates `_sym_or_422`), keep it reserved for natives. The picker reuses `SymbolSearch`.

### 8.3 Server lane carries several columns and a payload (Phase 1)
`_rs_line_provider` returns one column today. Extend to the §6 column set + `payload`. The lane is generic; no `if defId` anywhere (the AST test enforces it). `serverCompute.js` already time-joins columns; it learns to pass `payload` through to the readout.

### 8.4 Two small client-schema additions (Phase 1)
- `inputs[].advanced: true` → collapsed "Advanced" group in the settings row and `MobileIndicatorSheet`.
- `inputs[].help: string` (≤ 160 chars) → the help line under each control and the tooltip on hover. Today only `label` exists.
- `readout: [{key, label, source: 'payload.rating.ibd', format}]` on a definition → the legend chip and Scorecard read payload scalars (today `readout.js` reads only series values). Marker tooltips come from `plots[].tooltip`.
If any of these is refused, the fallback is a hand-written RS legend block — the pattern the engine has been removing, so the schema route is strongly preferred.

### 8.5 Nightly RS rating history (Phase 2)
Worker job (`WORKER_ENABLED`) after the screener build: compute IBD + fast ratings + components for the universe, write `rs_rating_history(session, ticker, ibd, fast, m1, m3, m6, m12)` with a primary key on `(session, ticker)`. Backfill from `bars.db` daily closes (~3.7k tickers × ~500 sessions — minutes, not hours) on first run, guarded by a `.rs_history_backfill_v1` flag file in `DATA_DIR` like the other one-shot heals. Snapshot to R2 beside `bars.db`. The hourly warmer stays for the live number; the history row for today is written at the close.

### 8.6 Bar count
`_fetch_bars_for_tf` defaults to 400 bars. A 252-session lookback leaves 148 bars of dots — six months. Raise per §6 (`N + 600` daily). Cost: two extra SQLite reads of ~450 rows; negligible.

### 8.7 Tier and gating
Stays **premium** (the lane's handler is `require_paid`). The rating badge already is. The library shows the row to free members with the badge (as the other premium rows do today).

## 9. Tie-in to the Pine parity programme
The one capability every Pine RS script needs is `request.security(benchmark, …)` — a second symbol. §8.2/8.3 build exactly that door on the server lane. When the W-waves reach `request.security`, they should route it through this provider rather than a new one. The Pine programme is paused (2026-11-03); this plan does not depend on it.

## 10. Research still open (Phase 0)
1. **Chartmaster's Discord posts.** The owner runs the ready query (`scratchpad/rs/run.sh`, read-only) → `out.json`. From it: every dated "RS new highs" list → fixture rows `(date, tickers)`; any screenshots of his indicator settings → confirm lookback and benchmark; any tweet with a rating threshold → confirm R2.
2. **Sector ETF map.** Confirm `ticker_meta` carries GICS sector for ≥ 95 % of the cap universe; otherwise the Sector (auto) option ships with the SPY fallback visible in the legend.
3. **Industry composite.** Confirm the Compare panel's industry groups are reachable server-side (they are built client-side today from the theme taxonomy; the server needs the same list).

## 11. Validation and definition of done

### 11.1 Chartmaster fixture set (the best use of the message library)
From `#1chartmaster`: every post naming RS new highs on a dated red day. Replay our columns on those dates. **Target: ≥ 90 % of his names flagged by `rsNHred` that session; ≥ 95 % flagged by `rsNH` within ±1 session.** Misses are listed by name in the PR with the reason (different benchmark, data gap, his judgement). Test: `tests/test_rs_chartmaster_fixtures.py`, fixture file `tests/fixtures/rs/chartmaster_posts.json`.

### 11.2 MarketSurge / Deepvue parity
Owner supplies 20 screenshots (10 daily, 10 weekly) with the date visible. Targets: RS Rating within ±2 on the same date; blue-dot days match ±1 bar; RS-NH-before-price agrees on every screenshot. Recorded in `docs/superpowers/specs/rs-parity/` with the screenshot, our capture and the diff. Deepvue's 1M/3M/6M components within ±3.

### 11.3 Manrav lesson parity
The 21-EMA crosses he walks through (GS, D, MARA in `sM-aFdyOps4`) reproduce as cross arrows on our chart within ±1 bar.

### 11.4 Usability acceptance (before Phase 1 is called done)
Five members the owner picks, who have never seen the indicator, on their own machine, no coaching. Within 60 seconds each must: turn it on; say which benchmark it is comparing against; point to the most recent RS new high; read the rating. **Pass = 4 of 5 on all four tasks.** Two of the five on a phone. One session recorded for the Phase 4 education copy. Colour-blind check: the default palette passed through deuteranopia and protanopia simulation, markers still distinguishable (screenshots in the PR).

### 11.5 Golden and unit tests (named)
- `app/src/components/chart/engine/__tests__/rsIndicator.golden.test.js`: single-symbol RS stays 1.0; every event column ∈ {0,1,NaN}; NaN warm-up lengths exactly `L−1` and `N`; time-joined never index-joined (a benchmark with a missing holiday bar); weekly lookback = 52; tie counts as new high; `tol` boundary.
- `tests/test_rs_columns_provider.py`: payload shape of §6; benchmark resolution incl. `SECTOR` fallback; 422 on unknown benchmark; `rev` = 2; bar count ≥ `N + 600`; p95 latency under budget on a warm cache.
- `tests/test_rs_rating_ibd.py`: formula of §5.8 on a synthetic universe; renormalisation when the 252-day term is missing; `None` when the 63-day term is missing; percentile → 1–99 mapping edges.
- `tests/test_rs_rating_history.py`: idempotent backfill; one row per (session, ticker); today's row written at close.
- `tests/test_indicator_alert_catalog_rs.py`: the three RS rows exist and evaluate on a fixture bar series.
- Existing rails that must stay green: `registrySizes`, the AST "no `if def_id`" test, the free-user-refused-on-every-route test, `singleWriterIndex`.

### 11.6 Definition of done, per phase
| Phase | Done when |
|---|---|
| 0 | Fixture set exists with ≥ 10 dated posts; D1–D8 ruled; §10.2–10.3 confirmed. |
| 1 | §4.2 first turn-on exactly as written; §4.3 Simple inputs; §4.5 markers (daily + weekly); §4.6 Scorecard minus rating history; §4.11 states; §11.1, 11.3, 11.4, 11.5 green; performance budget met and recorded. |
| 2 | Rating in legend (both formulas), components, Δ5/Δ20, history line + bands; screener columns + presets; alerts; Discord post (behind D5); §11.2 parity recorded. |
| 3 | Price overlay with own scale; custom benchmark; clickable anchor date; intraday behaviour of §4.8. |
| 4 | Leadership + Emerging lists; tour cards; Learn links; Study drill; Compass sentences; a 90-second walkthrough video for the Desk. |

## 12. Rollout, rollback, telemetry

### 12.1 Saved layouts keep working
The definition keeps `id: 'rsLine'` and bumps `version: 2`; every new input has a default, so an existing instance with `{benchmark: 'QQQ'}` renders the v2 indicator against QQQ with nothing else changed. No migration of member preferences.

### 12.2 Flags
Phase 1 ships behind `RS_V2_ENABLED` on the web pod (server returns the v1 single column when off, and the client definition hides the new plots when the response has `rev: 1`). Flip for admins first (`RS_V2_ENABLED=admin`), then everyone. Phase 2's nightly job gates on `WORKER_ENABLED` + `RS_HISTORY_ENABLED`. The Discord post gates on `RS_DISCORD_POST_ENABLED` and D5.

### 12.3 Rollback
Unset the flag and `railway redeploy --service web --yes` (a delete alone does not restart the process — the deploy runbook's measured rule). Code rollback = revert the PR; the history table is additive and can stay.

### 12.4 Telemetry (small, counts only)
Events via the chart's existing telemetry pattern (`studioTelemetry.js` is the model): `rs_on`, `rs_off_within_60s` (the confusion signal), `rs_pro_opened`, `rs_benchmark_changed{value}`, `rs_marker_hover{kind}`, `rs_learn_click{target}`, `rs_tour_dismissed{card}`. Success after 30 days: ≥ 25 % of active chart users have it on; `rs_off_within_60s / rs_on` < 10 %; Learn clicks > 0 on every marker kind.

## 13. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Our IBD-style rating disagrees with MarketSurge by more than ±2 for many names | Universe differences are the usual cause. Record the parity set first; expose "universe: UCT cap universe (3,742)" in the Scorecard hover so the difference is explained, not hidden. |
| Marker clutter on long charts | Density rule §4.5; Simple mode shows three marker kinds only. |
| Sector/industry auto resolves wrong for conglomerates | Legend always prints the resolved benchmark; one click to override. |
| Server cost per chart open rises (14 columns, 852 bars) | Cache per session; budget measured; the price chart never waits on RS. |
| Members read ticks in the Scorecard as buy signals | Copy says "checks", never "score"; no aggregate; Compass sentences repeat Chartmaster's "RS in the wrong theme is a killer" caveat. |
| Pine programme later wants a different second-symbol door | §9: route `request.security` through this provider; the lane is generic. |
| The Discord post looks like Chartmaster's own call | Attributed to the rule and the workshop timestamp, posted by Uncharted Scanners, suppressed under 3 names. |
| Fixture set small if his Discord history is short | Fall back to his dated workshop examples (PLTR, HOOD, APP, CRWD names and dates from §2) as fixtures. |

## 14. Phases and sizing

| Phase | Scope | Size |
|---|---|---|
| **0 — Close the research** | §10; owner rules D1–D8. | 1–2 days |
| **1 — RS line elite** | §4.1–4.5, 4.7–4.9, 4.11; §5.1–5.7, 5.12 (minus rating rows), 5.13–5.14; §6; §8.3, 8.4, 8.6; §11.1, 11.3–11.6. All inside the existing server lane and pane. | ~2.5 weeks |
| **2 — RS Rating on the chart** | §5.8–5.11; §8.5; §7.1–7.3; §4.6 complete; §11.2. | ~2 weeks |
| **3 — Schema changes** | §8.1, 8.2; anchor-date click; §4.8 intraday polish. | ~1–2 weeks |
| **4 — Teach it** | §4.10 tour and Learn links; §7.4–7.5; walkthrough video; Study drill. | ~1 week |

Phases 1 and 2 are independent and can run on two build machines under the existing desktop/laptop channel. Phase 1 grew by half a week over v1 for the help text, states, tour and usability test — the parts that make it usable, not just complete.

## 15. Owner decisions needed before Phase 1 (recommendation first)
1. **Default benchmark:** SPY (Chartmaster, IBD) or QQQ (Manrav for tech)? **Recommend SPY, with Sector (auto) one click away.**
2. **RS-new-high lookback:** 250 sessions (his words) or 252 (one trading year)? **Recommend 252 and call it "52-week".**
3. **"Red day" threshold:** −0.5 % or −1.0 % on the benchmark? **Recommend −0.5 %, adjustable in Advanced.**
4. **Headline rating:** IBD 12-month (matches the pros) or UCT fast? **Recommend IBD as headline, fast beside it; "Both" is the legend default.**
5. **Discord "RS New Highs" post:** every qualifying down day automatically, or owner-approved? **Recommend automatic, premium channel only, ≥ 3 names.**
6. **RS pane axis:** hide the ratio numbers and say it in words (legend), or show the raw ratio like TradingView? **Recommend hide; the ratio is not a number anyone trades.**
7. **Simple mode default:** six inputs visible, the rest under Advanced? **Recommend yes; Pro users find Advanced in one click.**
8. **Free members:** see the row with the Premium badge (today's behaviour) or also a static preview image of the indicator? **Recommend badge only for Phase 1; preview image in Phase 4 if conversion data wants it.**

## 16. Glossary (member-facing, used in tooltips and the Desk)
- **RS line** — the stock's price divided by the market's. Rising = beating the market, falling = lagging. The level does not matter; the direction and the highs do.
- **RS new high** — the RS line is at its highest point in a year. The stock is outperforming by the most it has in 52 weeks.
- **RS new high before price** — the RS line made a new high while the stock's price has not yet. Chartmaster's "beach ball underwater": the price is being held down by a weak market and tends to pop when the market turns.
- **RS new high on a red day** — the RS high happened while the market closed down. The stock went up when it had every excuse to go down.
- **RS Rating** — a 1–99 rank of the stock's 12-month performance against every other stock (the most recent quarter counts double). 99 is the top 1 %. Chartmaster trades 90+ and likes 95+.
- **UCT RS (fast)** — UCT's own version of the rating that weights the last three months heavily, so it moves within days when a stock starts leading.
- **Green on red** — the stock closed up on a day the market closed down.
- **Relative Weakness** — the mirror image: RS new lows, red on green, a falling RS line. Names to avoid or to short.
- **Benchmark** — what we compare against: the S&P 500 (SPY) by default, or the Nasdaq 100, Russell 2000, equal-weight S&P, the stock's sector ETF, or its industry group.

## 17. Sources
- Education library (`api/services/education_seed.py`): `mfswYu5UlX8`, `_0ZvKLYznLo`, `QCTOJgCQmjw`, `uugeU83Ns84`, `sM-aFdyOps4`; curriculum `docs/curriculum/curriculum_final_v2.json` Module 4 / Leadership & Rotation (videos 59, 61, 63).
- Code read for this plan: `app/src/components/chart/engine/{nativeRegistry,defSchema,serverCompute,markerPrimitive,readout}.js`, `app/src/components/chart/{IndicatorLibraryDialog,IndicatorAlertPopover}.jsx`, `app/src/pages/charts/mobile/MobileIndicatorSheet.jsx`, `app/src/pages/charts/CompareSymbolsPanel.jsx`, `api/routers/signature.py` (`_rs_line_provider`, `_fetch_bars_for_tf`), `api/services/signature/registry_defs.py`, `api/services/{rs_ranking,rs_weighted_return,indicator_alert_evaluator}.py`, `api/services/screener/{technicals,enrich,screen_alerts}.py`, `api/services/alert_routing.py`, `app/src/components/RsBadge.jsx`.
- External, for parity targets: MarketSurge RS line blue dot (RS line at 52-week high while basing/breaking out; benchmark changeable); IBD RS Rating definition (12-month price performance, most recent quarter double-weighted, 1–99 percentile); Deepvue RS components (1M/3M/6M); ChillLax "Relative Strength Line with NewHigh/NewLow Blue Dot" (TradingView open source: light dot = RS NH over lookback, dark dot = RS NH before price).
