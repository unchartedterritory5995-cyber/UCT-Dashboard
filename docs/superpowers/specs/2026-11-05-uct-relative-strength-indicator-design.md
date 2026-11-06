# UCT Relative Strength — the indicator, the rating, and the Chartmaster rules

**Status:** 🟡 PLAN, for owner review (2026-11-05). No implementation alongside it.
**Owner ask (2026-11-05):** "Make the charts widget RS indicator elite to an extreme level — MarketSmith / MarketSurge / Deepvue / TradingView and beyond. Combine that with Chartmaster's Discord library and the RS indicator he uses, and make a plan for a UCT-specific Relative Strength indicator."
**Base:** `origin/master` `3e11e6bf63`. **Branch:** `docs/uct-rs-indicator`.
**Relationship to prior work:** extends the shipped server-lane RS line (Phase C Tasks 13/14, `nativeRegistry.RS_LINE_RAW`, `signature._rs_line_provider`) and the universal-indicator ecosystem (`docs/superpowers/specs/universal-indicator-ecosystem/`). It does not touch the Pine parity waves, but §7 names the one capability both programmes need.

---

## 1. Where we are today (measured on master, 2026-11-05)

| Surface | What exists | Verdict |
|---|---|---|
| Chart widget → "Relative Strength Line" | `close ÷ benchmark close`, benchmark enum **SPY / QQQ / IWM**, own pane (15 %), one line, 4-decimal legend. Premium. | Basic. No MA on the line, no markers, no overlay, no rating. |
| Chart widget → "% From MA", "52-Week High/Low" | Filed under the Relative Strength heading. | Extension/level studies, not RS. |
| RS Rating (1–99) | `api/services/rs_ranking.py` + `rs_weighted_return.py`. Universe = cap universe ($300M+, ~3.7k). Hourly in-memory cache, disk snapshot, **no history**. Shown as `RsBadge` on Research header, video dock, notebook — **never on the chart**. | Exists, but the formula is **not IBD's** (see §4.2) and the chart never shows it. |
| Screener | `rs_rank`, `rs_return`, `rs_line_trend` (20-bar slope of ticker/SPY → up/flat/down), `sector_rs_pct`. | Good raw material for scans; nothing visual. |
| Compare Symbols panel | Overlays other tickers' normalised % performance; supports theme / sector / industry groups and "new price scale". | The overlay-with-own-scale mechanics already exist on the chart — reuse. |
| Engine schema (`defSchema.js`) | `PLOT_STYLES` has `markers` (shape, position, size, text ≤ 24 chars), `line`, `histogram`, `area`, `baseline`, `hlines`, `band`. `PLACEMENT_TARGETS` = price / pane / volume. `symbol` is a **reserved** input type (decision A3). | Markers and pane are ready today. Price overlay with its own scale and a free-text benchmark are the two schema changes (§6). |

**What the elite tools have that we don't:** RS line on the price pane; RS-line new-high "blue dot"; RS new high *before* price; any benchmark (sector ETF, industry group, any symbol); a moving average on the RS line; the RS Rating printed on the chart with 1M/3M/6M components and a plottable rating history; industry-group RS.

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

## 3. Design principle

**Everything Chartmaster does by eye becomes a column, a marker, or a number.** The indicator is one definition with several plots, so a subscriber turns on "UCT RS" and gets his whole method, and the screener/scanner can run the same columns across the universe (R8's leadership list builds itself).

## 4. The indicator — "UCT Relative Strength"

### 4.1 RS Line (upgrade the existing `rsLine`)
- **Ratio** `close / benchmark close`, joined by bar time (keep). Normalised so the visible window starts at 1.0 (MarketSurge look).
- **Benchmarks:** SPY (default), QQQ, IWM, **Sector ETF (auto, from the ticker's GICS sector)**, **Industry group composite (auto, UCT's industry list — the Compare panel already has these)**, Equal-weight S&P (RSP), **Custom symbol** (phase 3, needs §6.2).
- **MA on the RS line:** 21 EMA default (Manrav / curriculum), selectable 8 / 21 / 50, EMA or SMA. Line colour **turquoise above / red below** the MA.
- **Placement:** pane (today) **or price overlay with its own hidden scale** (phase 3, §6.1). Weekly works identically (8-week framing).

### 4.2 RS Rating (1–99) — on the chart, with history
- **Default formula = IBD standard:** 12-month weighted return, 40 % most-recent quarter + 20 % each of the three prior quarters, percentile-ranked 1–99 across the cap universe. This is what makes our number match MarketSurge / Deepvue for the same stock.
- **Keep the current UCT formula** (3M 40 % / 6M 20 % / 1M 20 % / 1W 20 %) as **"UCT RS (fast)"** — it reacts in days, which is what Chartmaster's "95+ or coming in" instinct is really describing. Both shown; user picks the headline.
- **Components:** 1M / 3M / 6M / 12M ratings (Deepvue style), plus **rating change over 5 and 20 sessions** (rating momentum).
- **History:** a plottable RS Rating line. Requires a nightly job writing one row per ticker per session (new `rs_rating_history` table in `/data`), **backfilled ~2 years from `bars.db`** on first run. The hourly warmer stays for the live number.
- **Bands:** 90 (Chartmaster's floor) and 80 (the firm's published `rs_rank >= 80` preset) as `hlines`; legend colours by band (reuse `RsBadge` tiers).

### 4.3 Markers — the Chartmaster signals
| Marker | Rule | Default look |
|---|---|---|
| **RS New High** | RS line at its highest close over the lookback (250 sessions daily / 52 weeks weekly; user-adjustable). | small blue dot under the RS line |
| **RS New High *before* Price** (R3) | RS NH **and** price is **not** within 2 % of its own lookback high. | large dark-blue dot, text "RS>P" |
| **RS New High on a Red Day** (R1) | RS NH **and** benchmark closed down ≥ 0.5 % (adjustable). | gold dot, text "NH/RED" |
| **Green on Red** (check 4) | Stock closed up while benchmark closed down ≥ 0.5 %. Count of such days in last 20 shown in legend. | small green triangle |
| **RS Line / MA cross** (Manrav) | RS line crosses above / below its MA. | up/down arrow |
| **RS New Low** (R4, weakness mode) | Mirror of RS NH; shown only when "Relative Weakness" is on. | red dot |

### 4.4 Readout (legend / detail dock) — the four manual checks, computed
- **Check 1 — MA relationship:** stock % from 50d & 200d **vs** benchmark % from its 50d & 200d, side by side ("+15 % vs −16 %").
- **Check 2 — Key-date anchor:** % change since a user-picked anchor date (default: the benchmark's last 20-day low) for stock vs benchmark. Reuses the AVWAP anchor/click mechanics.
- **Check 3 — Pivot speed:** on the last 20 benchmark-down days, how many times the stock closed in the top third of its range.
- **Check 4 — Green-on-red count** (last 20 sessions).
- **R6 — Theme context:** sector ETF RS Rating and `sector_rs_pct` beside the stock's.
- **R7 — 200-day flag:** above/below, for stock and benchmark.
- **R5 — Distance to the 8-day EMA (daily) / 8-week EMA (weekly)** so "buy the pullback to the 8" has a number.

### 4.5 Relative Weakness mode
One toggle flips the indicator: RS new lows, RS line below a declining MA, "red on green" days, rounding-top helper (RS line lower highs over 20 bars). Chartmaster's short-side read (R4) without a second indicator.

## 5. Beyond the chart — the same columns everywhere
1. **Screener columns:** `rs_new_high`, `rs_nh_before_price`, `rs_nh_red_day`, `green_on_red_20`, `rs_line_above_ma`, `rs_rating_ibd`, `rs_rating_chg_5`, `rs_rating_chg_20`, `rs_rating_1m/3m/6m`. Presets published so the concept vocabulary can cite them ("90+", "RS NH before price").
2. **Scanner / Discord:** an **"RS New Highs"** post on down days (benchmark ≤ −0.5 %) listing the names — the list Chartmaster posts by hand ("12 or 13 relative strength new highs back-to-back"). Posted by Uncharted Scanners, attributed to the rule, never to him.
3. **Alerts:** per-ticker "RS NH before price (weekly)", "RS line crossed 21 EMA", "RS rating crossed 90".
4. **Leadership list (R8):** auto-built watchlist = RS rating ≥ 90 **and** RS NH in last 10 sessions **and** above 200d, grouped by theme. Emerging list = RS line crossed above MA in last 5 sessions.
5. **Study / Compass:** each marker has a one-line "why" (Chartmaster's words) so the mentor can explain what the dot means; the curriculum's RS module (video 59, 61, 63) links to the live indicator.

## 6. Engineering notes — what has to change in the engine

### 6.1 Price overlay with its own scale
`placement.target: 'price'` shares the price scale today; an RS ratio near 1.0 on a $400 stock would be a flat line at the bottom. Add `placement.scale: 'own'` (hidden right-side scale, autoscaled) — the Compare panel already drives lightweight-charts' per-series `priceScaleId`, so the binder change is small. Schema change → `defSchema` vocabulary + golden tests + `registrySizes` manifest. **Phase 3.**

### 6.2 Benchmark as a free symbol
`symbol` is a reserved input type (A3). Sector ETF (auto) and Industry (auto) **do not need it** — they are enum values the server resolves. Custom symbol does. Un-reserve `symbol` for **server-lane definitions only** (the server already validates `_sym_or_422`), keep it reserved for natives. **Phase 3.**

### 6.3 Server lane carries several columns
`_rs_line_provider` returns `{"rsLine": [...]}`. Extend to `rsLine, rsMa, rsNewHigh, rsNhBeforePrice, rsNhRedDay, greenOnRed, rsCross, rsRating, rsRatingFast` + a `payload` with the readout scalars. Marker columns are 0/1 arrays. The lane is generic; no `if defId` anywhere (the AST test enforces it).

### 6.4 Nightly RS rating history
Worker job (`WORKER_ENABLED`) after the screener build: compute IBD + fast ratings for the universe, write `rs_rating_history(session, ticker, ibd, fast, m1, m3, m6, m12)`. Backfill from `bars.db` daily closes (~3.7k tickers × ~500 sessions — minutes, not hours). Snapshot to R2 like `bars.db`.

### 6.5 Tier
Stays **premium** (the lane's handler is `require_paid`). The rating badge already is.

## 7. Tie-in to the Pine parity programme
The one capability every Pine RS script needs is `request.security(benchmark, …)` — a second symbol. §6.2/6.3 build exactly that door on the server lane. When the W-waves reach `request.security`, they should route it through this provider rather than a new one.

## 8. Validation — how we know it is elite, not just bigger
1. **Chartmaster fixture set.** From his Discord channel (`#1chartmaster`, wisdom.db) pull every post where he names RS new highs on a dated red day (e.g. the "12–13 names" post). Replay our indicator on those dates: **target ≥ 90 % of his names flagged by `rs_nh_red_day` that session.** This is the single best use of the message library.
2. **MarketSurge / Deepvue parity.** Owner supplies 20 screenshots (10 daily, 10 weekly). Targets: RS Rating within ±2; blue-dot days match ±1 bar; RS-NH-before-price agrees.
3. **Manrav lesson parity.** The 21-EMA crosses he walks through (GS, D, MARA examples in `sM-aFdyOps4`) reproduce on our chart.
4. **Golden tests:** single-symbol RS line stays 1.0 (existing test), marker columns are 0/1 only, time-joined (never index-joined), weekly lookback = 52 weeks.

## 9. Phases and sizing

| Phase | Scope | Size |
|---|---|---|
| **0 — Close the research** | Owner runs the pod query (`scratchpad/rs/run.sh`) so Chartmaster's Discord posts + tweets land; build the §8.1 fixture set; owner rules on default benchmark, lookback, thresholds. | 1–2 days |
| **1 — RS Line elite** | §4.1 (minus custom symbol / overlay), §4.3 markers, §4.4 readout, Relative Weakness toggle. All inside the existing server lane and pane. | ~2 weeks |
| **2 — RS Rating on the chart** | §4.2 IBD + fast + components, nightly history + backfill, rating line + bands, §5.1 screener columns, §5.2 Discord "RS New Highs", §5.3 alerts. | ~2 weeks |
| **3 — Schema changes** | §6.1 price overlay, §6.2 custom benchmark, weekly polish, anchor-date check, mobile sheet. | ~1–2 weeks |
| **4 — Teach it** | §5.4 leadership lists, §5.5 Study/Compass copy, curriculum links, §8.2 parity sign-off. | ~1 week |

Phases 1 and 2 are independent and can run on two build machines under the existing desktop/laptop channel.

## 10. Owner decisions needed before Phase 1
1. Default benchmark: SPY (Chartmaster, IBD) or QQQ (Manrav for tech)? **Recommend SPY, with Sector-ETF auto one click away.**
2. RS-new-high lookback: 250 sessions (his words) or 252 (one trading year)? **Recommend 252 and call it "52-week".**
3. "Red day" threshold for R1: −0.5 % or −1.0 % on the benchmark? **Recommend −0.5 %, adjustable.**
4. Headline rating: IBD 12-month (matches the pros) or UCT fast? **Recommend IBD as headline, fast beside it.**
5. Discord "RS New Highs" post: every down day automatically, or owner-approved? **Recommend automatic, premium channel only.**

## 11. Sources
- Education library (api/services/education_seed.py): `mfswYu5UlX8`, `_0ZvKLYznLo`, `QCTOJgCQmjw`, `uugeU83Ns84`, `sM-aFdyOps4`; curriculum `docs/curriculum/curriculum_final_v2.json` Module 4 / Leadership & Rotation (videos 59, 61, 63).
- Code: `app/src/components/chart/engine/nativeRegistry.js` (`RS_LINE_RAW`), `api/routers/signature.py` (`_rs_line_provider`), `api/services/rs_weighted_return.py` (`RS_TERMS`), `api/services/screener/technicals.py` (`rs_line_trend`), `app/src/pages/charts/CompareSymbolsPanel.jsx`.
- External, for parity targets: MarketSurge RS line blue dot (RS line at 52-week high while basing/breaking out; benchmark changeable), ChillLax "Relative Strength Line with NewHigh/NewLow Blue Dot" (TradingView open source: light dot = RS NH over lookback, dark dot = RS NH before price).
