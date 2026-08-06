# 04 — Dataviz Patterns for Fundamentals & Earnings (Earnings Modal + Equity Research Page)

Research date: 2026-08-03 · Scope: visualization patterns for earnings/fundamentals data and the concrete
library mapping for the UCT dashboard (`uct-worktrees/research-redesign/app`).

**Ground truth from `app/package.json` (worktree):** React **19.2** (not 18), Vite 7, and **four chart
libraries already installed**: `lightweight-charts ^5.1.0` (StockChart price charts — memory says master
pins 5.2.0), `echarts ^6.0.0` + `echarts-for-react ^3.0.6` (12 files: Breadth treemap, BreadthCharts,
J2 Analytics), `chart.js ^4.4.0` + `react-chartjs-2` (1 file: CotData — LOCKED, "COT charts are Chart.js,
do NOT replace"), `recharts ^2.15.4` (3 files: OptionsFlow.jsx + OptionsFlow_admin.jsx — **partner-owned,
don't touch** — and UCT20Backtest.jsx). No d3, no visx, no nivo.

**Headline recommendation (detail in Part B): zero new dependencies.** Plain SVG/CSS for every meter,
chip, strip, slider and sparkline (the house already does this: MarketBreadth SVG gauge, SetupGlyph,
FuturesStrip sparklines, UIcon); tree-shaken **ECharts** for every "real chart" (lollipop, waterfall,
scatter, radar, revision columns, stacked areas); **lightweight-charts** only when the viz sits ON the
price chart (expected-move band, earnings markers, EPS line overlay). Do not extend recharts or chart.js.

---

## Part A — Visualization pattern catalog (33 patterns)

Difficulty scale: 1 = an hour of SVG/CSS · 3 = a day incl. dark-theme polish + hover layer · 5 = multi-day,
needs custom series/plugin work. "Render with" points at the Part B mapping.

### Group 1 — Earnings event & estimates (the earnings modal core)

**1. EPS beat/miss lollipop (estimate vs reported)**
- Where seen: TradingView symbol page "Earnings" section (the canonical version), Nasdaq earnings page, Seeking Alpha.
- Encoding: x = fiscal quarter; per quarter a **hollow circle at estimate**, **filled circle at actual**, thin vertical connector; actual dot green when above estimate, red when below. TradingView also puts E-icons on the price chart X-axis — green pointed-up when surprise > 0, red pointed-down when < 0.
- Beats a table when: the question is "does this company habitually beat, and by how much?" — 8 quarters read in one saccade; magnitude of surprise is the gap length, invisible in a % column.
- Difficulty: **2** (ECharts `custom` series or two scatter series + a bar connector; or ~80 lines of plain SVG since scales are trivial).
- Render with: ECharts (interactive tooltip per quarter) or plain SVG inside the modal.

**2. Revenue bars with YoY growth overlay**
- Where seen: Koyfin financials graphs, YCharts, Simply Wall St "past performance", every IR deck.
- Encoding: quarterly revenue as columns; YoY % growth as a second encoding. **Caution: the classic version is a dual-axis chart, which is the #1 chart mistake** (two y-scales lie about crossovers). Honest variants: (a) growth % as a direct label above each bar, colored by sign; (b) a thin aligned "small multiple" strip *below* the bars sharing the x-axis with its own scale; (c) growth-only bars with revenue as the label. Prefer (a) for a modal, (b) for the research page.
- Beats a table when: showing acceleration/deceleration — the *shape* of the bar series plus label sequence (+12% → +18% → +26%) is the story.
- Difficulty: **2** (bars + labels), **3** (aligned two-panel small multiple).
- Render with: ECharts (single `grid` for (a); two stacked `grid`s for (b)).

**3. Estimate-revision momentum (up/down counts over time)**
- Where seen: Zacks (the entire Zacks Rank is built on this), Yahoo Finance "EPS revisions" (up-last-7-days / up-last-30 / down-last-30 counts), Nasdaq, Fidelity's Zacks panels.
- Encoding: for trailing windows (7d/30d/60d/90d), paired diverging columns — **up-revisions above a zero baseline (green), down-revisions below (red)** — optionally with ▲/▼ arrow glyph + count as the direct label. A single net-revisions sparkline works as the compact tile form.
- Beats a table when: the signal is *direction of the crowd*, not any single number; a 4-window diverging strip shows "analysts flipped bullish in the last month" instantly.
- Difficulty: **2** (four pairs of divs/SVG rects is genuinely enough; ECharts if hover detail needed).
- Render with: plain SVG/CSS in the modal; ECharts bar (two series, one negative) on the research page.

**4. Consensus estimate trend / "estimate walk" lines**
- Where seen: Koyfin Estimates tab, FactSet/Bloomberg-style "consensus over time", Simply Wall St future-growth chart.
- Encoding: x = calendar time (last 6-12 months); one line per fiscal period (FY1, FY2) tracking how the consensus EPS/revenue number itself drifted. Rising line = upward revisions. Terminal dot labeled with the current consensus.
- Beats a table when: a table shows only today's estimate; the *drift* is the alpha (estimate momentum precedes price).
- Difficulty: **3** (needs revision-history data; chart itself is trivial lines).
- Render with: ECharts line.

**5. Expected-move range band around price**
- Where seen: Options AI expected-move visualizer (the reference implementation — cone from spot to the event date), thinkorswim MMM, Barchart expected-move page, MarketChameleon.
- Encoding: on the price chart, a **shaded band (or cone) from current price to the earnings date**, bounded at ±expected move (85% of the ATM straddle, or 1σ from ATM IV); band edges labeled with the $ levels. The project already computes `get_implied_move` for calendar enrichment — the data exists.
- Beats a table when: "±6.2%" means little; the band drawn against actual recent candles shows whether the market is pricing a breakout past a visible level.
- Difficulty: **3-4** integrated into StockChart (two `createPriceLine`s = cheap v1; a filled band needs an area series pair or the LWC v5 custom-series/primitives API); **2** as a standalone mini strip (horizontal price scale, band + current-price marker in SVG).
- Render with: lightweight-charts price lines/primitives on the real chart; plain SVG for the modal mini version.

**6. Post-earnings reaction strip (last 8 quarters)**
- Where seen: MarketChameleon earnings history, Fintel, Unusual Whales earnings tab; TradingView shows it implicitly via chart E-icons.
- Encoding: 8 small vertical bars (or squares) in a row, one per past report; height/intensity = next-day % move, green up / red down; optional hollow outline = closed below open ("faded the gap"). Tooltip: date, gap %, close %.
- Beats a table when: assessing "how does this name trade *after* it reports" — the win/loss rhythm and typical magnitude are pattern questions, not lookup questions.
- Difficulty: **1-2** (8 rects; the project's Calendar enrichment already carries 4Q beat history + reactions — extend to 8).
- Render with: plain SVG/CSS.

**7. Beat-streak dot row (EPS + revenue, dual track)**
- Where seen: Seeking Alpha earnings summary (green/red beats dots), eToro, Simply Wall St.
- Encoding: two rows of 4-8 dots labeled EPS / REV; filled green = beat, red = miss, gray hollow = met/no estimate. Compact enough for a table cell or card corner.
- Beats a table when: used as an *in-list* glyph — scanning 20 reporters for "double-beat streaks" without opening anything.
- Difficulty: **1**.
- Render with: CSS (flex row of styled spans) — no chart library should ever render this.

**8. Implied vs realized move dumbbell**
- Where seen: MarketChameleon "implied vs actual" earnings table, Options AI post-mortems.
- Encoding: per past quarter, a horizontal dumbbell: hollow dot = implied (expected) move, filled dot = realized |move|, connecting line colored by which was larger (realized > implied = options were cheap = orange highlight).
- Beats a table when: judging whether buying the straddle into this name historically paid — the systematic over/under-pricing is visible as all dots leaning one way.
- Difficulty: **2-3**.
- Render with: ECharts custom/scatter pair, or plain SVG (scales are simple).

**9. Guidance-change waterfall**
- Where seen: corporate IR decks, YCharts custom, sell-side notes; rare in retail platforms — differentiator opportunity.
- Encoding: floating bars stepping from prior guidance midpoint → puts/takes (FX, demand, pricing, one-offs) → new guidance midpoint; green rises, red falls, gray anchor columns at both ends, connector rules between bars.
- Beats a table when: explaining *why* the number moved; the bridge IS the narrative.
- Difficulty: **3** (classic stacked-bar-with-transparent-base trick).
- Render with: ECharts (stacked bar, bottom series transparent) — well-documented pattern.

**10. Earnings countdown / session chip**
- Where seen: every platform (TradingView "E in 3 days", Robinhood, the project's own Calendar).
- Encoding: text chip "Q2 · in 3d · AMC" with BMO/AMC glyph (▲ pre / ▼ post — the project already uses this in CatalystFlow); amber tint inside 3 days (matches the Awareness R5 rule window).
- Beats a table when: always — it's metadata, never a chart.
- Difficulty: **1**.
- Render with: CSS chip.

### Group 2 — Ratings, scores, meters

**11. 0-99 rating ring (donut arc + centered number)**
- Where seen: IBD/MarketSurge Composite Rating (numeric), TipRanks Smart Score (ring 1-10), Simply Wall St company score; the project's own MarketBreadth SVG gauge is the house sibling.
- Encoding: circular arc sweeping 0→score over a faint full-circle track; arc color from a semantic ramp (red → amber → green, or gold for elite ≥90); large tabular-numeral center label.
- Beats a table when: the score is the *headline* of a card — a ring gives it hierarchy a cell can't; also encodes "distance to max" spatially.
- Difficulty: **2** (one SVG circle + `stroke-dasharray`; animate `stroke-dashoffset` on mount, reduced-motion-gated).
- Render with: plain SVG — never a chart library. The most professional-looking versions (TipRanks, Apple Watch) are all hand-drawn SVG.

**12. Segmented bar meter (5-10 cells)**
- Where seen: Fey score bars, TradingView "Technical Rating" gauge alternative, hardware-UI-style VU meters in trading dashboards.
- Encoding: N discrete cells, filled left→right up to the score; filled cells take the semantic color, unfilled stay as dark hairline outlines. Discrete cells read faster than a continuous bar for 0-99 ("7 of 10 lit") and hide false precision.
- Beats a table when: rows of entities each carry a score — a column of segmented meters is scannable like a bar chart but fits table density.
- Difficulty: **1** (flex row of divs).
- Render with: CSS only.

**13. Letter-grade chips (A+ … F)**
- Where seen: Zacks Style Scores (A-F for Value/Growth/Momentum), TipRanks, Seeking Alpha Quant grades; the project already has `GRADES` (A+/A/B/C/F) in `setupGroups.js` and grade-colored Model Book markers.
- Encoding: small rounded-rect chip, letter in tabular/mono type; background = translucent tint of grade color (A=green, B=teal/blue, C=amber, D/F=red), 1px border in the solid color. Never color-alone: the letter IS the redundant encoding, which is why grades beat pure color dots.
- Beats a table when: it *is* the table cell — grades compress a 0-99 into an ordinal a human can compare across 8 columns without reading.
- Difficulty: **1**.
- Render with: CSS. Reuse the exact grade-color mapping Model Book already established.

**14. Radar/spider for component scores**
- Where seen: **Simply Wall St Snowflake** (pentagon: Value / Future / Past / Health / Dividend, each 0-6; shape+size+color = instant read), Morningstar style box cousins, Fey company DNA.
- Encoding: 4-6 axes from center; filled translucent polygon; color = overall health (green→red). SWS proves the *fill color follows the aggregate*, not per-axis.
- Beats a table when: comparing *shape* of quality across 4-6 dimensions ("great growth, weak balance sheet" is a lopsided polygon) or overlaying two companies. Weak beyond 6 axes or for precise values.
- Difficulty: **2** with ECharts (`radar` series is built-in and themes well on dark); **4** hand-rolled.
- Render with: ECharts radar. Note the UIcon SVG-in-`<text>` caveat: axis labels take ★/◆ text markers only, not UIcon glyphs.

**15. Bullet chart (score vs bands vs target)**
- Where seen: Stephen Few's design, Koyfin-style KPI rows, corporate dashboards; the professional replacement for every speedometer gauge.
- Encoding: horizontal bar (the measure) over background bands (poor/ok/good ranges as darkening tints), plus a perpendicular tick = target or peer median.
- Beats a table when: a number needs *context bands* (P/E of 32 — vs its own 5-yr range and vs sector); one row per metric stacks into a dense comparative panel.
- Difficulty: **2** (layered divs or SVG rects).
- Render with: CSS/SVG.

**16. Short-interest gauge → render as bullet/linear, not a dial**
- Where seen: Fintel short squeeze score, Finviz short-float column, Benzinga squeeze meters (dials — and they look like toys).
- Encoding: short % of float on a linear scale with threshold bands (>10% elevated, >20% crowded) + days-to-cover as a second small bullet. Radial dials waste space and read worse on dark themes; the linear form is the premium look.
- Beats a table when: thresholds matter more than the number — "inside the danger band" is spatial.
- Difficulty: **1-2**.
- Render with: CSS/SVG bullet (pattern 15 reused).

**17. Analyst consensus stacked bar (Strong Buy → Sell)**
- Where seen: Yahoo Finance "Recommendation Trends" (monthly stacked columns), TipRanks, Robinhood analyst section, the project's `/api/earnings/intel/{sym}` already returns Finnhub recommendation data (EarningsModal shows it as text today).
- Encoding: single horizontal 100%-stacked bar: StrongBuy (deep green) → Buy → Hold (gray) → Sell → StrongSell (deep red), count labels inside segments ≥ ~12%; a small ×4 monthly small-multiple shows drift.
- Beats a table when: the *distribution* is the message (12 buys 1 sell ≠ "consensus: buy" in a cell); month-over-month drift = upgrade momentum.
- Difficulty: **1-2** (flex row with % widths); **2** for the monthly mini-multiples.
- Render with: CSS for the single bar; ECharts stacked bar for the trend version.

**18. Price-target range slider**
- Where seen: Yahoo Finance (low—avg—high with current marker), TipRanks, Robinhood, CNN Forecast.
- Encoding: horizontal track from analyst low to high; soft gradient or neutral fill; tick+label at average target; **distinct marker (▼ or dot) at current price**; % upside-to-average as the direct label, green/red by sign.
- Beats a table when: three numbers (low/avg/high) plus current collapse into one spatial read — "price is already above the average target" is instant.
- Difficulty: **1-2**.
- Render with: CSS/SVG. Same component skeleton as the 52-week slider (#19) — build once, parameterize.

### Group 3 — Price-context strips & tiles

**19. 52-week range slider with current-price marker**
- Where seen: Finviz snapshot bar, Google Finance, Robinhood, Webull, Bloomberg — universal.
- Encoding: horizontal hairline track (low → high, $ labels at ends); filled portion or marker at current price; optional secondary faint tick = 50-day MA. Position near the high = strength (Minervini/IBD convention: buy in top 25% of range) — tint the top-quartile zone faintly gold.
- Beats a table when: "$182 (52w: $91-$199)" takes math; the marker position is pre-computed cognition. In lists it becomes a scannable strength column.
- Difficulty: **1**.
- Render with: CSS (track div + absolutely-positioned marker).

**20. Sparklines in stat tiles**
- Where seen: Robinhood cards, Fey stat tiles, Google Finance, Koyfin watchlists; the project's FuturesStrip already ships hand-built SVG sparklines with gradient/glow.
- Encoding: 20-60 point line or area, no axes/grid, single accent or semantic green/red by period change, terminal dot; the tile's big number carries the value, the spark carries the shape.
- Beats a table when: always, for tiles — a number plus shape ("grinding up" vs "V-bounce") costs 40px of height.
- Difficulty: **1-2** (SVG polyline; the house pattern exists — extract FuturesStrip's spark into a shared `<Sparkline points={..} tone={..}/>`).
- Render with: plain SVG. Do not mount a chart library instance per tile (16 tiles × ECharts = wasted MB and mount time; J2 AnalyticsTab already had to unmount collapsed ECharts for this reason).

**21. Mini-candle context strip (last ~30 sessions)**
- Where seen: TradingView screener row hover, MarketSmith mini charts, the project's TickerPopup (full StockChart).
- Encoding: tiny candlestick/HLC strip with earnings day highlighted (gold candle — the house `highlightBarTime` convention already exists in Model Book).
- Beats a table when: pre-earnings setup quality (tight range vs extended) is the question.
- Difficulty: **2** (reuse StockChart with `liveUpdates={false}`, chrome off) or SVG rects for a dumb version.
- Render with: lightweight-charts (existing component) when interactive; SVG when 20+ per page.

**22. Relative-volume pill**
- Where seen: Finviz (Rel Volume), the project's CatalystTable `vol_x`, Webull.
- Encoding: "3.2×" chip whose tint intensity scales with the multiple (log scale — 10× shouldn't be 10 shades brighter); optionally a 5-cell segmented meter behind it.
- Beats a table when: embedded in rows as pre-attentive intensity.
- Difficulty: **1**. Render with: CSS.

### Group 4 — Fundamentals trends & structure

**23. Margin trend small multiples (gross / operating / net / FCF)**
- Where seen: Koyfin graph pages, YCharts, Fey financials, Simply Wall St past performance.
- Encoding: 3-4 tiny aligned line charts, one metric each, **shared x (8-12 quarters), independent y**, direct-labeled last value; NOT four lines on one chart (they occupy different % ranges and one axis flattens them — and one-axis-per-chart is a hard rule).
- Beats a table when: margin *inflection* (operating leverage kicking in) is the thesis; a table of 32 percentages hides the elbow.
- Difficulty: **2-3** (one ECharts instance with 4 grids, or 4 SVG sparklines with labels).
- Render with: ECharts multi-grid (single canvas, one tooltip axis-linked) — cheaper than 4 instances.

**24. Heat-shaded acceleration grid (QoQ growth cells)**
- Where seen: MarketSurge/IBD acceleration flags, Sentieo/AlphaSense table heat, Zacks ESP grids; the project's Breadth monitor 8-tier `bgG3…bgR3` system is the exact house precedent.
- Encoding: table where rows = metrics (EPS growth, rev growth, margin), columns = quarters; **cell background from a diverging ramp on the value; intensity ramps darker for extremes; text stays uniform white** (the Breadth rule). Optional ▲ corner tick when a cell accelerated vs prior quarter.
- Beats a table when: it IS a table, upgraded — sequential scanning becomes regional perception ("the whole right side turned green in 2025").
- Difficulty: **2** (reuse the `cellClass` tier approach verbatim).
- Render with: HTML table + CSS classes. Never a chart-library heatmap for this — DOM cells get hover/click/a11y free.

**25. Institutional ownership trend area**
- Where seen: Fintel ownership charts, Simply Wall St ownership breakdown, WhaleWisdom, Nasdaq institutional holdings.
- Encoding: quarterly (13F cadence) area/line of institutional % of float; optional thin stacked area splitting insider/institutional/retail; increasing-funds vs decreasing-funds counts as a companion diverging mini-bar (same skeleton as #3).
- Beats a table when: the *slope* (accumulation vs distribution across quarters) is the read.
- Difficulty: **2**. Render with: ECharts area (13F data source needed — Finnhub/FMP have endpoints).

**26. Insider activity event strip**
- Where seen: Finviz insider table, OpenInsider, Capitol Trades; the project already has Finnhub insider data (`insider.get_recent_insider_buys`).
- Encoding: timeline strip (last 12 months): one tick/dot per transaction, up-green tick = buy, down-red = sell, size ~ log($ value); cluster density is the signal. Sits under a price sparkline so buys can be seen near lows.
- Beats a table when: *clustered* buying is the signal — 5 buys in 2 weeks reads as a dense green burst.
- Difficulty: **2-3** (time scale + jitter for overlaps).
- Render with: ECharts scatter on a time axis, or SVG.

**27. EPS line vs price ("earnings line") overlay**
- Where seen: MarketSurge weekly charts (the classic O'Neil overlay), the "MarketSurge EPS Line" TradingView community indicator.
- Encoding: on the weekly price chart, a stepped line of TTM EPS **indexed to price at a common anchor** (both rebased to 100) — NOT a second axis; divergence (price running ahead of the EPS line) is the read.
- Beats a table when: the entire growth-vs-price thesis in one overlay; this is the single most "pro swing-trader" pattern on the list and fits the firm's IBD-style methodology.
- Difficulty: **3-4** (indexing logic + LWC extra line series on the existing chart; data plumbing from the earnings table).
- Render with: lightweight-charts additional series on StockChart (it's price-chart-resident by definition).

**28. Revenue segment stacked bars/areas**
- Where seen: company IR, Simply Wall St revenue breakdown, App Economy Insights' famous charts.
- Encoding: quarterly stacked bars by segment (fixed categorical hue order, 2px gaps between segments per the mark spec); "Other" folds anything past 5-6 segments.
- Beats a table when: mix-shift is the story (cloud overtaking legacy).
- Difficulty: **2-3** (chart trivial; segment data is the hard part — FMP has segment endpoints).
- Render with: ECharts stacked bar.

**29. Peer scatter — growth vs valuation**
- Where seen: Koyfin scatter plots, Finviz bubbles, YCharts fundamental charts, "Rule of 40" SaaS charts.
- Encoding: x = fwd revenue growth, y = EV/S or fwd P/E; each peer a dot (subject ticker gold + ring, peers slate); optional quadrant hairlines at medians; direct ticker labels (≤ ~15 points — beyond that, label on hover only).
- Beats a table when: "expensive for its growth?" is inherently 2-dimensional; residual from the pack is visible, not computed.
- Difficulty: **2-3** (label-collision is the only real work; ECharts `labelLayout` handles it).
- Render with: ECharts scatter.

**30. Valuation-vs-history percentile band**
- Where seen: Koyfin (current multiple vs 5-yr range), YCharts, Morningstar fair-value.
- Encoding: same bullet skeleton as #15: horizontal band = 5-yr P/E range with 25-75th percentile darker inner band, tick = current multiple, label "P/E 34 · 82nd pctile of 5y".
- Beats a table when: a multiple without its own history is noise; the percentile position is the actual information.
- Difficulty: **2**. Render with: CSS/SVG bullet.

**31. Income-statement waterfall (revenue → net income bridge)**
- Where seen: App Economy Insights, Simply Wall St financial-health visuals, IR decks.
- Encoding: revenue anchor bar → COGS/OpEx/tax floating negative steps → net income anchor; per-quarter or annual.
- Beats a table when: cost-structure questions ("where does the money go") — margins become lengths.
- Difficulty: **3** (same technique as #9; build the waterfall helper once, use for both).
- Render with: ECharts.

**32. Ownership/short-interest composition donut — use sparingly**
- Where seen: Simply Wall St ownership pie, Fintel.
- Encoding: 3-4 segment donut (insiders / institutions / retail / short). Only viable at ≤4 segments with direct labels; otherwise a 100%-stacked bar (#17 skeleton) is strictly better and is the recommended form here.
- Difficulty: **1-2**. Render with: CSS conic-gradient or the stacked-bar skeleton.

**33. Sector/RS percentile rail**
- Where seen: MarketSurge RS Rating (1-99), the project's own RS rankings service (already computed hourly for 3,685 tickers).
- Encoding: thin vertical/horizontal rail 0-99 with a marker at the ticker's RS percentile; gold zone ≥ 90 (house convention: gold = elite). Doubles as the segmented meter (#12) in table rows.
- Beats a table when: percentile is positional by nature; also visually links the research page to the existing UCT20 RS language.
- Difficulty: **1**. Render with: CSS.

**Deliberately excluded:** speedometer/dial gauges for anything with more than one threshold (bullet
charts win), 3D anything, dual-axis combos (per the one-axis rule), word-cloud transcript viz, and
pie charts beyond 4 segments.

---

## Part B — Library evaluation, grounded in the actual repo

### What is installed and where it is actually used (grep of the worktree)

| Library | package.json | Real usage | Verdict |
|---|---|---|---|
| `lightweight-charts` ^5.1.0 | ✔ | `StockChart.jsx` (the whole price-chart stack), `UCT20Performance.jsx` | **Keep — price/volume charts only.** Its canvas, time-scale and series model are built for OHLC; it is the wrong tool for categorical/quarterly axes. |
| `echarts` ^6.0.0 + `echarts-for-react` ^3.0.6 | ✔ | 12 files: Breadth `TreemapView`, `BreadthCharts`, J2 `AnalyticsTab`/`PerformancePanel`/`RiskExitsSection`/`InsightsHub` | **Primary workhorse for new fundamentals charts.** Already paid for on multiple routes; supports every Part A "real chart" (custom series → lollipop/dumbbell; stacked-transparent → waterfall; radar; multi-grid small multiples; scatter with `labelLayout`). Dark theming is fully controllable per-option (no global theme needed). |
| `chart.js` ^4.4.0 + `react-chartjs-2` | ✔ | 1 file: `CotData.jsx` | **Frozen.** CLAUDE.md locks COT to Chart.js. Do not add new Chart.js surfaces — two general-purpose canvas chart libs is already one too many. |
| `recharts` ^2.15.4 | ✔ | 3 files: `OptionsFlow.jsx`, `OptionsFlow_admin.jsx` (**partner-owned — untouchable**), `UCT20Backtest.jsx` | **Contain.** ~150KB gz for capabilities ECharts already covers. Cannot be removed (Ravi's surfaces), but no new code should import it. Long-term: migrate `UCT20Backtest` off it, leaving recharts isolated to the partner bundle chunk. |
| d3 / visx / nivo | ✘ | — | Not installed; see candidates below. |

React note: the app is on **React 19.2**, not 18. `echarts-for-react` 3.x works on 19 (it is a thin
imperative wrapper — low framework coupling, which is exactly why it survives major React bumps).
Recharts 2.x had a slower React-19 path (fixed in 2.15/3.x) — another reason not to deepen that dependency.

### Bundle-size reality (Vite, `feedback_vite_manualchunks_object_form` applies)

- Full `echarts` import ≈ 1MB min / ~340KB gz — and "1.1MB echarts shrink" is already on the project's
  known-remaining perf backlog. **The redesign is the moment to do it:** new code imports from
  `echarts/core` + `echarts/charts` + `echarts/components` + `CanvasRenderer`, registered via
  `echarts.use([...])`; `echarts-for-react` supports this through its `core` entry
  (`echarts-for-react/lib/core`). Tree-shaken bar+line+scatter+radar+custom+grid+tooltip lands
  around **~150-200KB gz**, roughly halving the chart chunk while ADDING capability.
  Existing full-import call sites can migrate opportunistically; keep echarts in its own manualChunk.
- Plain SVG/CSS patterns: **0KB**. This is not a consolation prize — the sharpest-looking meters,
  rings, sliders and chips at TipRanks/Fey/Robinhood are hand-drawn, because chart libraries impose
  padding, axes and tooltip chrome that fight tile-scale design. The house already proves this
  (MarketBreadth gauge, SetupGlyph, FuturesStrip sparks, the 8-tier Breadth heat table).
- Recharts ~150KB gz, Chart.js ~92KB gz: both stay resident because of locked/partner surfaces, which
  is exactly why **adding a fifth library is indefensible**.

### Candidate additions evaluated (and rejected)

| Candidate | Size | Dark-theme | React 19 | License | Verdict |
|---|---|---|---|---|---|
| **visx** (airbnb) | modular, ~30-50KB per chart | full control (headless) | good (hooks-based) | MIT | The only candidate worth naming — unstyled primitives yield bespoke results. **Rejected:** everything visx would draw here is either simple enough for raw SVG (meters, strips, lollipops) or already covered by installed ECharts (scatter, waterfall, radar). It would be a 5th charting dependency solving no unsolved problem. |
| **nivo** | heavy (d3 + framer-motion chains) | themable | ok | MIT | Rejected: biggest bundle for the least control; animation-forward defaults read consumer-grade. |
| **d3 (full)** | ~90KB gz | n/a | n/a | ISC | Rejected as a chart layer. *Permissible micro-exception if ever needed:* `d3-scale`/`d3-shape` (~5KB each, ISC) for a smooth monotone area path in hand-rolled SVG — but `<polyline>` + CSS has covered the house sparklines fine so far. |

**Recommendation: zero new dependencies.**

### Concrete mapping — viz class → renderer

| Viz class (patterns) | Renderer | Why |
|---|---|---|
| Chips, grades, countdown, vol pill (7, 10, 13, 22) | **CSS** | Text-first; any chart lib is malpractice here. |
| Meters: ring, segmented, bullet, short-interest, RS rail, valuation band (11, 12, 15, 16, 30, 33) | **Plain SVG/CSS** | 0KB, pixel-perfect on dark, house precedent (MarketBreadth gauge). One shared `<Meter>`/`<Bullet>` component family. |
| Range sliders: 52-week, price-target (18, 19) | **CSS/SVG** (one parameterized component) | Track + marker positioning is layout, not charting. |
| Strips: reaction bars, beat dots, sparklines, revision arrows (3-compact, 6, 20) | **Plain SVG** | Dozens per page → must be library-instance-free; extract FuturesStrip spark. |
| Quarterly charts: lollipop, revenue+growth, estimate walk, consensus trend, stacked segments, ownership area, margin small-multiples, insider timeline (1, 2, 4, 17-trend, 23, 25, 26, 28) | **ECharts (tree-shaken core)** | Needs axes/tooltips/hover; bar+line+custom series cover all; single canvas multi-grid for small multiples. |
| Specialty: waterfall ×2, radar, peer scatter, dumbbell (8, 9, 14, 29, 31) | **ECharts** | Stacked-transparent waterfall, built-in radar, `labelLayout` scatter — solved problems in ECharts, expensive anywhere else. |
| Heat/acceleration grid (24) | **HTML table + CSS tiers** | Reuse Breadth `bgG3…bgR3` + `cellClass` system verbatim; DOM cells give free hover/click/a11y. |
| On-price-chart: expected-move band, earnings E-markers, EPS line overlay, mini candles (5, 21, 27) | **lightweight-charts** (StockChart extensions) | Anything sharing the price axis must live in LWC — markers/priceLines/extra series/primitives; respects the pooled-series #2049 rule (never destroy/recreate). |
| COT (existing) | Chart.js | Locked; not part of this redesign. |
| Options Flow (existing) | recharts | Partner-owned; do not touch. |

---

## Part C — Aesthetic principles for professional dark-theme financial dataviz

**1. Semantic color is a reserved vocabulary — and desaturated for dark surfaces.**
Green/red mean gain/loss and *nothing else*; gold is the house elite/highlight accent (UCT already
reserves it: HVC bars, UCT20 star, grade colors). Never spend green/red on categorical series.
On near-black, pure `#00ff00`/`#ff0000` bloom and vibrate — use desaturated mid-lightness steps
(the project's `#4ade80` / `#f8a5a5-family` tints are right; TradingView uses `#26a69a`/`#ef5350` for
exactly this reason). Encode magnitude with *intensity within the hue* (the Breadth 8-tier system:
light tint = mild, dark saturated = extreme — dark ink for extremes keeps white text legible).
Done right by: TradingView, the project's own Breadth monitor.

**2. Fills are translucent, strokes are thin.**
On dark themes, solid bright fills create adjacent-glow mush. Area fills at 8-16% alpha of the line
color, 2px lines, hairline (1px, ~10% white) borders on bars/segments, 2px surface-color gaps between
stacked segments and adjacent bars. Fey's entire look is essentially this rule plus one accent hue.
Done right by: Fey, Robinhood (single 2px line, faint gradient fog), FuturesStrip's existing sparks.

**3. Muted until hover; detail on demand.**
Resting state shows shape: no per-point markers, no value labels except the terminal/selective ones,
non-focused series dimmed. Hover raises a crosshair + tooltip (house convention already exists: the
OHLCV legend overlay) and brightens the hovered mark; everything else stays recessive. Neighboring
series fade (ECharts `emphasis`/`blur` states do this for free). Interactive ≠ busy.
Done right by: Koyfin (dense pages stay calm), TradingView crosshair legend.

**4. Tabular numerals, monospace tickers, right-aligned columns.**
Every number that can change or be compared sits in `font-variant-numeric: tabular-nums` (Instrument
Sans supports it) or the house IBM Plex Mono (already the ticker convention — gold, letter-spaced).
Numbers right-align; units and % stay attached to the number, not the header. Without this, a
polling dashboard *jitters* as digits change width — the single most common tell of amateur fintech UI.
Done right by: Bloomberg terminal, TradingView watchlists, Koyfin tables.

**5. Kill the grid; let alignment and labels carry the structure.**
At most 3-4 horizontal gridlines at ~6-8% white, no vertical gridlines (crosshair on hover replaces
them), no axis spine boxes, no chart borders. Direct-label the last value instead of forcing an
axis read. Zero/baseline gets one slightly stronger rule — it is semantic (above/below) in finance.
Done right by: Robinhood (no visible grid at all), Fey, Simply Wall St.

**6. One axis per panel; index or facet instead of dual axes.**
Two measures of different scale get two aligned panels (shared x, own y — the margin small-multiples
form) or get indexed to a common base (the EPS-line-vs-price overlay rebases both to 100). A second
y-axis manufactures fake crossovers and is the most common chart lie in finance media. The lone
inherited exception is CotData's existing y/y2 (legacy, locked) — do not replicate it in new work.
Done right by: Koyfin (indexed comparison mode), MarketSurge EPS line.

**7. Numbers get hierarchy from type scale, not decoration.**
A stat tile is: label (11px, muted, uppercase, tracked) → value (20-28px, tabular, primary ink) →
delta (12px, semantic color) → optional spark. No card-in-card borders, no icons-per-stat, no
drop shadows on data. Text always wears text tokens — never the series color — with a small colored
mark alongside carrying the semantics (a red *number* reads as an error state; a red *delta chip*
reads as a loss).
Done right by: Fey stat rows, Robinhood holdings header, Apple Stocks.

**8. Motion is state-change only, and short.**
One mount animation per surface (ring sweep, bar grow ≤ 300ms, reduced-motion-gated — the UIcon
shimmer already models the gating); live updates tween ≤ 150ms; **no re-animation on poll refresh**
(a chart that re-draws every 30s SWR tick looks broken — the house already learned this with the
no-op repaint guard in StockChart). Attention-motion (pulse) is reserved for genuine events: alert
fired, earnings just crossed the tape.
Done right by: TradingView (price flashes only the changed cell), Robinhood line-draw on period switch.

---

## Sources

- [TradingView — Earnings icons & estimate/reported semantics](https://www.tradingview.com/support/solutions/43000629790-earnings/) · [MarketSurge EPS Line indicator](https://www.tradingview.com/script/1slDwMjH-MarketSurge-EPS-Line-tradeviZion/) · [LevelUp Earnings Line](https://www.tradingview.com/script/X3sDdhln-LevelUp-Earnings-Line-Quarterly-EPS/)
- [Simply Wall St — How the Snowflake works](https://support.simplywall.st/hc/en-us/articles/360001740916-How-does-the-Snowflake-work) · [SWS analysis model (GitHub)](https://github.com/SimplyWallSt/Company-Analysis-Model/blob/master/MODEL.markdown)
- [Koyfin features](https://www.koyfin.com/features/) · [Koyfin — estimates/ratings platforms](https://www.koyfin.com/blog/best-platforms-earnings-estimates-price-targets-analyst-ratings/)
- [Fey — high-contrast dark finance design](https://www.sitefav.com/site/high-contrast-dark-theme-finance-white-website-inspiration-feyapp-com) · [Fey UI screens](https://nicelydone.club/apps/fey) · [Fey × Benzinga design write-up](https://medium.com/benzinga-apis/fey-benzinga-seamless-insights-meet-artful-design-fd072d9c3ba6)
- [Options AI — Expected Move visualizer](https://tools.optionsai.com/expected-move) · [Barchart expected move](https://www.barchart.com/stocks/quotes/HOOD/expected-move) · [MarketChameleon IV](https://marketchameleon.com/Overview/HOOD/IV/)
- [Zacks — earnings estimate revisions methodology](https://www.zacks.com/upload_education/zrank.pdf) · [Zacks momentum screening](https://www.zacks.com/education/articles.php?id=79)
- [Apache ECharts — tree-shakeable imports](https://apache.github.io/echarts-handbook/en/basics/import/) · [echarts-for-react tree shaking](https://echartsforreact.com/docs/guides/tree-shaking/)
- [Recharts vs visx bundle comparison (gist)](https://gist.github.com/kevinnft/8e2313a2c43d05be37c374ae6249a475) · [PkgPulse React charting 2026](https://www.pkgpulse.com/guides/recharts-vs-chartjs-vs-nivo-vs-visx-react-charting-2026) · [LogRocket — React chart libraries 2026](https://blog.logrocket.com/best-react-chart-libraries-2026/)
