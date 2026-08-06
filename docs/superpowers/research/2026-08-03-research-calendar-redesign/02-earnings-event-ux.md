# Earnings Event UX Research — Single-Ticker Earnings Presentation Patterns

**Purpose:** Design research for the UCT dashboard earnings quick-peek modal (dark-theme React popup shown when a user clicks a ticker on the earnings calendar).
**Date:** 2026-08-03
**Method:** Web research (search + page fetches) across 28 platforms. No browser automation used.

**Platforms investigated:** EarningsWhispers, EarningsHub, Quartr, Zacks, Benzinga Pro, Unusual Whales, Stocktwits, TradingView, Seeking Alpha, TipRanks, MarketBeat, StreetInsider, Fiscal.ai, Koyfin, Wallmine, AlphaQuery, OptionCharts.io, Market Chameleon, Barchart, plus discovered: Bloomberg Terminal (ERN/EA), ORATS, EarningsWatcher, SpotGamma, Moomoo, Robinhood, Aiera, AlphaSense, Option Samurai, Nasdaq.com, TrendSpider, Fey, Investing.com Pro.

**Fit score legend:** 5 = perfect for a compact modal (glanceable, small footprint) · 3 = works in a modal if simplified · 1 = full-page only.

---

## A. Date, Timing & Context Patterns

### 1. Earnings date + session badge + confirmation status
- **Platforms:** EarningsWhispers (its signature strength), Barchart, Market Chameleon, Nasdaq, TipRanks, Benzinga Pro, AlphaQuery
- **What/how:** Date shown with a **BMO / AMC / TBD** session badge and a *confirmed vs estimated/inferred* state. EarningsWhispers built its brand on date confirmation accuracy; Barchart flags any ticker whose earnings fall **within 28 days in red** and prints `BMO`/`AMC`/`--` inline. Market Chameleon's Earnings-Dates page lists "Upcoming and Historical" dates with confirmation state per row.
- **Why effective:** The #1 question is "when, exactly, and is that date real?" A wrong/unconfirmed date invalidates every other widget. The confirmed/estimated distinction builds trust.
- **Data required:** Earnings calendar feed with confirmation flag (company PR vs inferred), session timing.
- **Modal fit:** **5** — this is the mandatory header row of any quick-peek.

### 2. Countdown timer ("reports in 2d 4h")
- **Platforms:** EarningsHub (alerts framing), Robinhood (timely alerts), various fintech apps; implied by EW's live calendar ordering
- **What/how:** Live countdown to the report or to the call start, often paired with an "add alert / notify me" button. EarningsHub sells text/email/in-app alerts around the exact moment.
- **Why effective:** Converts a static date into urgency; anchors the modal in time ("tonight after close" reads differently than "Aug 5").
- **Data required:** Confirmed timestamp (or session window), client clock.
- **Modal fit:** **5** — one line under the date; cheap and high-value.

### 3. Fiscal period context chip
- **Platforms:** Seeking Alpha, TipRanks, Zacks, Fiscal.ai, Koyfin
- **What/how:** "Q2 FY2026 (quarter ended Jun 30)" chip near the date, so users know *which* quarter is being reported vs the current calendar quarter.
- **Why effective:** Prevents the classic off-by-one-quarter confusion for off-cycle fiscal years (NVDA, ORCL, etc.).
- **Data required:** Fiscal calendar mapping.
- **Modal fit:** **5** — a chip, costs nothing.

### 4. Typical report time / punctuality history
- **Platforms:** EarningsWhispers ("Dates" tab on stock pages), Market Chameleon (historical dates table)
- **What/how:** A small table/note of past report dates and times: "typically reports at 4:05 PM ET; has reported on the expected date 12 of 12 quarters." EW keeps a whole tab for date history.
- **Why effective:** Options traders time entries to the minute; a company that habitually pre-announces or slips dates changes the trade.
- **Data required:** Historical report timestamps.
- **Modal fit:** **3** — one derived sentence fits; the full table is page material.

### 5. Peer earnings this week / sympathy watch
- **Platforms:** EarningsWhispers ("Peers" tab), Investing.com Pro (peer comparison), Bloomberg EA (sector season view), Zacks snapshot (peer stack-up)
- **What/how:** List of same-sector names reporting in the same window with their dates/times, sometimes with peer results already reported this season (beat/missed) as leading indicators.
- **Why effective:** Earnings are traded in sympathy clusters; knowing MSFT reports the night before GOOGL is actionable context no single-ticker stat provides.
- **Data required:** Sector/peer mapping joined to the calendar.
- **Modal fit:** **4** — a 3-5 row mini-list with tickers + dates; full comparisons belong on a page.

### 6. Earnings lifecycle stage indicator
- **Platforms:** EarningsWhispers ("Life Cycle" field on stock page)
- **What/how:** Labels where the stock is in its earnings cycle (pre-announcement drift window, announcement week, post-earnings drift window), tied to EW's PEAD research framing.
- **Why effective:** Frames *which strategy class is even applicable today* (pre-earnings premium capture vs post-drift follow-through).
- **Data required:** Days-to/since-earnings + a labeling rule.
- **Modal fit:** **4** — a single labeled chip.

---

## B. Expectation Patterns (what the market expects)

### 7. Consensus EPS + revenue estimate block
- **Platforms:** All 28; canonical layouts on Seeking Alpha, TipRanks, Zacks, Benzinga Pro, Koyfin, Nasdaq
- **What/how:** Two side-by-side stat tiles: consensus EPS and consensus revenue, usually with analyst count and often prior-year same-quarter value for YoY framing. Benzinga Pro's grid shows estimate / prior / reported / surprise as columns.
- **Why effective:** The baseline number every other widget references; without it "beat/miss" has no meaning.
- **Data required:** Consensus estimates (EPS + revenue), analyst count, prior-year actuals.
- **Modal fit:** **5** — two tiles, mandatory.

### 8. Estimate range (low / consensus / high) with wicks
- **Platforms:** Koyfin (estimate wicks on Earnings History Snapshot), Seeking Alpha (estimates tab), Bloomberg ERN
- **What/how:** Koyfin draws the analyst estimate as a **grey circle with upper/lower "wicks"** marking the highest and lowest street estimates — a candlestick metaphor for expectation dispersion.
- **Why effective:** Dispersion = disagreement = potential for violent surprise. A tight range that gets beaten big is a different event than a wide, uncertain range.
- **Data required:** Estimate distribution (high/low/consensus), not just the mean.
- **Modal fit:** **4** — a slim range bar with a consensus dot reads instantly.

### 9. Whisper number vs consensus delta
- **Platforms:** EarningsWhispers (signature metric; 25 years of it — "closer to actuals than consensus 69.7% of the time")
- **What/how:** Two numbers side by side — official consensus and the Whisper® number — with the delta highlighted. EW's research: stocks that beat the whisper closed +1.9% avg; stocks that beat consensus but missed the whisper closed lower 54.9% of the time.
- **Why effective:** Captures the true hurdle. Explains "beat but sold off" — the single most confusing outcome for retail users.
- **Data required:** A second, independent expectation estimate (whisper/buy-side/crowd-sourced).
- **Modal fit:** **5** — one extra number next to consensus with a delta badge.

### 10. Surprise-prediction score (Zacks ESP pattern)
- **Platforms:** Zacks (Earnings ESP = Most Accurate Estimate vs consensus %), combined with Zacks Rank
- **What/how:** A single signed percentage: `(Most Accurate Estimate − Consensus) / Consensus`. "Most Accurate" = only the most recently revised analysts. Zacks displays it as a column/stat and claims ~70% beat hit-rate when positive ESP is combined with Rank ≤ 3.
- **Why effective:** Compresses revision momentum into one predictive number with a published track record; latest revisions embed the freshest information.
- **Data required:** Estimate-level data with revision timestamps (not just consensus).
- **Modal fit:** **5** — a signed % chip with a tooltip explaining methodology.

### 11. Estimate revisions trend (30/60/90-day drift)
- **Platforms:** Seeking Alpha (Revisions tab: up/down revision counts), Koyfin (estimate history over time), Fiscal.ai, Zacks
- **What/how:** Arrow chips or a mini sparkline: "EPS est 90d ago $2.10 → now $2.18; 14 up / 3 down revisions." SA keeps a dedicated tab; Koyfin lets you plot how the consensus for a quarter evolved.
- **Why effective:** Direction of revisions into the print is one of the most-cited setup factors ("rising estimates often precede price"); a rising consensus raises the bar.
- **Data required:** Consensus time series + revision counts.
- **Modal fit:** **4** — one sparkline + up/down counts; full revision tables are page material.

### 12. YoY / QoQ growth framing
- **Platforms:** TipRanks ("change in EPS from previous year"), Seeking Alpha, Fiscal.ai, Koyfin
- **What/how:** Next to consensus: "vs $1.98 a year ago (+11% YoY expected)". TipRanks explicitly shows forecast change vs prior year.
- **Why effective:** A beat with decelerating growth is often sold; growth context turns raw estimates into narrative.
- **Data required:** Prior-year actuals.
- **Modal fit:** **5** — inline sub-label on the estimate tiles.

### 13. Key KPI / segment expectations ("what actually matters this quarter")
- **Platforms:** Fiscal.ai (segment & KPI data on 2,200+ companies: DAUs, deliveries, ARR, data-center revenue), AlphaSense (theme tracking)
- **What/how:** Beyond EPS/revenue: the 2-3 company-specific metrics the street trades on (e.g., NVDA data-center rev, TSLA deliveries, NFLX subs), each with consensus where available.
- **Why effective:** For mega-caps, headline EPS is often irrelevant; the KPI *is* the event. Displaying it signals real sophistication.
- **Data required:** Segment/KPI consensus (hardest data on this list; Fiscal.ai licenses it).
- **Modal fit:** **4** — 2-3 rows; the differentiator if data is attainable.

---

## C. History Patterns (track record)

### 14. Beat/miss streak scoreboard
- **Platforms:** TipRanks, MarketBeat, Nasdaq, Koyfin (table), Zacks ("beat estimates again?" articles), Seeking Alpha surprise summary
- **What/how:** "Beat EPS in **7 of last 8** quarters" — often as a row of 8 green/red dots or checks in chronological order.
- **Why effective:** Instant base-rate; a dot-row is the fastest-scanning visual in the entire genre.
- **Data required:** 8 quarters of actual vs consensus.
- **Modal fit:** **5** — an 8-dot row with a summary count is peak modal design.

### 15. EPS surprise history — estimate-vs-actual dot/lollipop chart
- **Platforms:** **Koyfin** (grey estimate circle + green/red actual circle + estimate-range wicks per quarter), Seeking Alpha ("EPS Surprise & Estimates by Quarter"), Zacks, TradingView estimates panel
- **What/how:** X-axis = quarters; per quarter a grey circle (consensus) and a colored circle (actual: green above, red below), optionally connected — a lollipop showing the *gap* size, not just direction. Koyfin overlays the stock price as a blue line on the same chart.
- **Why effective:** Shows magnitude AND direction of surprises over time in one compact mark system; the estimate-to-actual gap is literally visible as distance.
- **Data required:** Quarterly estimates + actuals (8-12 quarters).
- **Modal fit:** **5** — the single best "history" chart for a modal at ~8 quarters wide.

### 16. Revenue surprise history (parallel track)
- **Platforms:** Seeking Alpha (revenue surprise tab), Koyfin (metric toggle: Sales/EBITDA/EBIT/EPS/EPS GAAP), Benzinga Pro, EarningsHub
- **What/how:** Same lollipop/dot treatment for revenue; Koyfin exposes it as a dropdown toggle on one chart rather than a second chart.
- **Why effective:** "Beat EPS, missed revenue" is a distinct, common scenario with its own price reaction; the toggle pattern saves space.
- **Data required:** Revenue estimates + actuals.
- **Modal fit:** **4** — as a *toggle* on pattern #15, not a second chart.

### 17. Combined price + consensus + surprise chart (Zacks pattern)
- **Platforms:** Zacks ("Price, Consensus and EPS Surprise" chart — embedded in every Zacks article and snapshot report)
- **What/how:** One chart: price line, consensus estimate paths for coming quarters (fan of converging lines), and markers for each historical surprise %. It is Zacks' one-image company summary.
- **Why effective:** Correlates expectations, results, and price in a single glance; the estimate "fan" also previews forward quarters.
- **Data required:** Price series + estimate history + surprises.
- **Modal fit:** **2** — too dense for a modal; the idea to steal is *price context behind surprise markers*.

### 18. Guidance history timeline (raised / lowered / inline / initial)
- **Platforms:** StreetInsider (dedicated Guidance page + "Hot Guidance"), MarketBeat (guidance captured per report in screener), FactSet (5 years of guidance history), Benzinga Pro
- **What/how:** Chronological chips per quarter: `Raised ↑` (green) / `Lowered ↓` (red) / `Inline` / `Initiated`, each linking to the guidance news item. MarketBeat records "beat or missed *guidance* and by how much."
- **Why effective:** Guidance moves stocks more than trailing results; a company that guides conservatively then raises every quarter has a tradable pattern.
- **Data required:** Structured guidance extraction from PRs (or a vendor feed) — moderately hard.
- **Modal fit:** **4** — a 4-chip row "last 4 guides: ↑ ↑ → ↑".

### 19. Post-earnings drift grade (PEAD)
- **Platforms:** EarningsWhispers (Earnings Whisper® Grade built on PEAD research since 1968; A+ historically outperforms; "Power Rating" flags big expectation-vs-actual gaps post-report)
- **What/how:** Letter grade (A+ … F) shown as a badge; post-report, the Power Rating highlights names likely to keep drifting for days after the announcement.
- **Why effective:** Extends the modal's usefulness *after* the print — the trade isn't over at the close; letter grades are instantly legible.
- **Data required:** Composite model (surprise size, revisions, sentiment) — or license/emulate.
- **Modal fit:** **4** — one badge; methodology behind a tooltip.

---

## D. Price-Reaction Patterns (what the stock did)

### 20. Post-earnings reaction history — last 8 quarters % move bars
- **Platforms:** Market Chameleon ("Price Effect" column per past date), TipRanks (price day-before/day-after table), Barchart ("actual move after the prior 4 earnings events, as well as the average move"), Moomoo (expected vs actual chart), TradingView community scripts
- **What/how:** Vertical green/red bar per quarter = next-day % move (close-before → close-after or open gap). Barchart appends the **average** as a summary stat. TipRanks renders it as a table with before/after prices and % change.
- **Why effective:** The empirical answer to "what does this stock *do* on earnings" — the single most requested stat by event traders; bars encode direction + magnitude instantly.
- **Data required:** Daily OHLC around past earnings dates (already in most bar caches).
- **Modal fit:** **5** — 8 slim bars + an avg |move| callout; arguably the modal's hero chart alongside #15.

### 21. Average / max move summary stats
- **Platforms:** Barchart (average of prior 4), Market Chameleon (trailing 12-quarter stats), Option Samurai (statistical context), Moomoo
- **What/how:** Stat chips: "Avg move ±5.2% · Max +14% · Max −11% (12q)". Often placed directly above the reaction-history bars.
- **Why effective:** Numeric anchors for sizing and strike selection; pairs with implied move for the over/underpriced verdict (#28).
- **Data required:** Same as #20 (derived).
- **Modal fit:** **5** — three chips.

### 22. Gap vs drift anatomy (open gap vs close-to-close)
- **Platforms:** Market Chameleon (benchmarks include "opening gap moves on the day of earnings" as a distinct series), Bloomberg EA (price reaction analysis)
- **What/how:** For each past event, split the reaction into overnight gap and intraday continuation/fade — MC plots opening-gap benchmarks separately from full-day moves.
- **Why effective:** "Gaps up then fades" vs "gaps up and runs" is *the* behavioral fingerprint day traders want.
- **Data required:** Open + close around events.
- **Modal fit:** **3** — one derived sentence/tag ("tends to fade the gap: 6 of 8") fits; the full split chart is page-level.

### 23. Earnings markers on the price chart (color-coded surprise icons)
- **Platforms:** TradingView (E-icons on the x-axis: green up-arrow = positive surprise, red down = negative, grey square = inline, pink = upcoming/unknown), TrendSpider (Reports sidebar widget)
- **What/how:** Small glyphs pinned to the date axis of the main price chart; hover reveals estimate/actual/surprise. Toggle in chart settings.
- **Why effective:** Places earnings in price context without a dedicated chart; the color/shape system is self-teaching.
- **Data required:** Earnings dates + surprise joined to charting layer.
- **Modal fit:** **3** — if the modal embeds a mini price chart, these markers are free value-add.

### 24. Day-before/day-after price table
- **Platforms:** TipRanks (explicit feature: "stock's price the day before and the day after recent earnings reports, including the percentage change")
- **What/how:** Table rows per past report: report date, price before, price after, % change, beat/miss flag — merging patterns #14 and #20 into one scannable grid.
- **Why effective:** Answers "did beating actually work?" — links fundamental outcome to price outcome row by row.
- **Data required:** #14 + #20 data joined.
- **Modal fit:** **3** — 4 rows max in a modal; better expressed as the dual-encoded bars (#25).

### 25. Dual-encoded reaction bars (beat/miss × up/down)
- **Platforms:** Synthesis of Koyfin (result color) + Market Chameleon/TipRanks (reaction); some TradingView "Earnings Dashboard" community scripts do this explicitly
- **What/how:** Reaction bars (#20) where the bar *fill* = price direction and a small dot/outline above = EPS beat/miss — exposing divergences (beat-but-dropped) at a glance.
- **Why effective:** The beat-price divergence is the most instructive earnings lesson; encoding both on one mark doubles information density at zero extra space.
- **Data required:** #14 + #20.
- **Modal fit:** **5** — best-value composite for a compact modal.

---

## E. Options & Volatility Patterns

### 26. Straddle-implied expected move (±$ / ±%)
- **Platforms:** Market Chameleon ("Implied Straddle" column), Unusual Whales (implied move on earnings screen + per ticker, multiple timeframes), Barchart (Expected Move pages per ticker), OptionCharts.io, Option Samurai, Bloomberg ("earnings-related implied move"), TipRanks/TheFly news ("options imply 9.1% move")
- **What/how:** Single headline stat: "Options imply **±6.8% ($12.40)** by Friday." Calculations vary: 85% of ATM straddle (Barchart), or OptionCharts' weighted blend (60% ATM straddle + 30% 1-strike strangle + 10% 2-strike strangle), or 1σ from ATM IV.
- **Why effective:** The market's own consensus on event size, in one number; instantly frames every historical move around it.
- **Data required:** Options chain (ATM straddle/strangle mid prices) for the post-earnings expiry.
- **Modal fit:** **5** — headline stat chip; the anchor of the options block.

### 27. Expected-move range bands drawn on the price chart
- **Platforms:** OptionCharts.io (Expected Move Chart: blue price history, green dotted upper / red dotted lower boundary, shaded corridor, expiry dropdown, hover values), Barchart (6 months of price + forward cones for next 2 weekly + monthly expiries, blue shading to nearest expiry, earnings marker inside the cone), AlphaQuery/Barchart ("chart shows where the options market thinks the underlying will trade at earnings")
- **What/how:** Price line continues into a forward-projected cone/corridor; the earnings date is marked inside it. Interaction: pick expiry from dropdown → band redraws; hover → exact upper/lower prices.
- **Why effective:** Turns the abstract ±% into concrete price levels on the chart the trader already reads; a 68%-probability corridor is intuitive even to novices.
- **Data required:** #26 + price series.
- **Modal fit:** **4** — a small sparkline-with-cone (last 1M price + forward band) fits beautifully in a modal.

### 28. Implied vs historical move verdict ("overpriced / underpriced")
- **Platforms:** Market Chameleon (charts of "implied moves plotted against benchmark values: previous historical moves, previous implied moves, opening gaps"; graph of expected vs actual for trailing 12 quarters), Moomoo ("Expected vs Actual Move" chart), Option Samurai (structural stat: implied overestimates actual ~70% of the time), AlphaQuery
- **What/how:** Paired columns per past quarter — implied move (hollow/grey) vs actual move (filled green/red) — plus a verdict line: "Options pricing ±6.8% vs ±4.9% avg actual → **premium rich**."
- **Why effective:** This IS the earnings options trade decision (buy vol vs sell vol) compressed into one visual; the historical pairing keeps it honest.
- **Data required:** Historical implied moves at each past event (must be captured/archived pre-event — a real data moat) + actual moves.
- **Modal fit:** **5** — the paired-bar mini chart + a one-word verdict badge is a premium differentiator.

### 29. IV rush/crush lifecycle curve
- **Platforms:** EarningsWatcher (black median-historical ATM IV path vs purple live IV overlay, x-axis = days to earnings, refreshed 15-min, green "IV expansion should outweigh theta" forecast), Market Chameleon ("IV before and after earnings for trailing 12 quarters"), SpotGamma (volatility dashboard)
- **What/how:** Line chart of ATM IV vs days-until-earnings: the ramp (rush) into the date and the cliff (crush) after; current cycle overlaid on the multi-year median path.
- **Why effective:** Shows whether vol is rich or cheap *relative to this name's own typical cycle*, and when the ramp usually accelerates ("last two hours before the close").
- **Data required:** Historical ATM IV time series aligned per event + live IV.
- **Modal fit:** **3** — a simplified spark version (median curve + "you are here" dot) fits; full overlay is page-level.

### 30. IV term-structure kink view
- **Platforms:** SpotGamma (term structure tab: front-expiry IV "kink" vs 60/90-day), ORATS (term structure IVs; solves the implied earnings move out of the term structure — "ex-earnings" IV), Barchart (IV per expiration in the expected-move table)
- **What/how:** IV plotted per expiration date; the earnings expiry shows a spike relative to the smooth curve. ORATS goes further: decomposes the kink into a clean "implied earnings move" number.
- **Why effective:** Quantifies exactly how much premium the event itself carries vs the base vol regime.
- **Data required:** Full chain IV by expiry.
- **Modal fit:** **2** — too specialist for a quick-peek; its *output* (event premium %) can appear as a chip.

### 31. IV Rank / IV Percentile chips
- **Platforms:** Barchart (both above the expected-move chart), AlphaQuery (30-day mean IV time series), Market Chameleon, tastytrade convention
- **What/how:** "IV Rank 82 · IV %ile 91" — current IV positioned within its 52-week range.
- **Why effective:** One glance = "is vol expensive for THIS name," the necessary companion to any expected-move number.
- **Data required:** 1y IV history.
- **Modal fit:** **5** — two chips.

### 32. Earnings straddle/strategy backtest stats
- **Platforms:** Market Chameleon (30+ options strategies backtested over up to 12 prior events: win rate, avg return, implied-vs-actual comparison; "Quarterly Earnings Straddle Performance" insights page), Option Samurai (earnings strategy backtesting)
- **What/how:** Table: strategy (long straddle, iron condor…), win rate, avg P&L if held through the event, per this specific ticker.
- **Why effective:** Converts all the vol stats into "what would have actually made money on this name."
- **Data required:** Historical chains around events (heavy).
- **Modal fit:** **2** — one derived line ("long straddle won 3/12 events") could appear; tables are full-page.

### 33. Options positioning snapshot (flow, OI, skew)
- **Platforms:** Unusual Whales (flow, GEX by strike, dark pool alongside its earnings screen), EarningsWhispers ("Options" tab on stock pages), Tradytics (ticker dashboards), SpotGamma
- **What/how:** Pre-event positioning: call vs put premium % traded today, put/call OI ratio, biggest OI strikes (the "pin" candidates), net premium sentiment; UW pairs earnings dates with live flow.
- **Why effective:** Shows how smart money is leaning into the event, complementing what options *cost* (#26) with what traders are *doing*.
- **Data required:** Options flow/OI feed (you already have Massive flow data — natural synergy).
- **Modal fit:** **4** — a 3-stat row (P/C, net premium, top OI strike); full flow belongs on the flow page.

---

## F. Sentiment & Crowd Patterns

### 34. Community bullish/bearish sentiment gauge
- **Platforms:** Stocktwits (per-ticker bull/bear vote aggregate, tracked into earnings as an "early indicator"; message volume), Tradytics (sentiment indicators)
- **What/how:** Horizontal split bar or dial: 68% bullish / 32% bearish, often with a trend arrow vs last week and message-volume context.
- **Why effective:** Positioning proxy + engagement hook; extreme crowd skew into a print is itself a contrarian datapoint.
- **Data required:** A voting community or licensed sentiment feed.
- **Modal fit:** **4** — one split bar.

### 35. Structured crowd polls: Beat/Meet/Miss + Up/Flat/Down
- **Platforms:** EarningsWhispers (both toggles sit at the top of every stock earnings page)
- **What/how:** Two 3-way segmented controls where users vote on (a) the earnings outcome and (b) the price reaction; aggregate results become the crowd forecast.
- **Why effective:** Structured (not free-text) predictions are aggregatable and gamifiable; separating outcome from reaction teaches users the difference — and voting drives return visits.
- **Data required:** Your own user base (no vendor needed).
- **Modal fit:** **5** — two compact segmented controls; a distinctive interactive element for a modal.

### 36. Attention/watcher count
- **Platforms:** Stocktwits (calendar shows "watchers" per ticker), EarningsHub (alerts subscribed)
- **What/how:** "12.4k watching this report" counter, sometimes ranked ("most-watched report this week").
- **Why effective:** Social proof + prioritization: tells users which events the crowd considers the main event.
- **Data required:** Internal engagement metrics.
- **Modal fit:** **5** — one chip.

### 37. Pre-earnings chat / live event room
- **Platforms:** Stocktwits (Pre-Earnings Chat on symbol pages; live sentiment during the call), Robinhood (live call listening)
- **What/how:** A dedicated chat thread scoped to the event, opened before the print and running through the call.
- **Why effective:** Converts an information page into a live communal event; retention machine.
- **Data required:** Chat infra.
- **Modal fit:** **2** — modal links into it ("Join 340 in the AAPL earnings room →"); the room itself is a page.

### 38. Composite letter grade / power rating
- **Platforms:** EarningsWhispers (Earnings Whisper® Grade A+…F; Power Rating; also a separate "Volatility Score" and "Sentiment" field per stock)
- **What/how:** A single prominent letter/score badge synthesizing revisions, whisper delta, sentiment, and PEAD odds; EW's stock page shows Grade, Sentiment, Volatility, Life Cycle as a 4-stat block.
- **Why effective:** Absolute fastest possible read; grades create a shared vocabulary users quote to each other ("it's an A+ setup").
- **Data required:** Your composite model.
- **Modal fit:** **5** — one badge, top-right of the modal.

### 39. Expected-volatility score (event-risk meter)
- **Platforms:** EarningsWhispers ("Volatility" score per stock), Benzinga Pro (filter by expected volatility)
- **What/how:** A 0-100 or Low/Med/High/Extreme meter for how violent the event is likely to be — options-implied move normalized vs the market and vs the name's own history.
- **Why effective:** Risk triage in one glyph — tells a swing trader whether to size down before anything else.
- **Data required:** #26 + #21 normalized.
- **Modal fit:** **5** — small meter/flame icons.

---

## G. Call, Content & AI Patterns

### 40. Live call player with synchronized transcript
- **Platforms:** Quartr (signature: live audio + real-time transcript, click any paragraph to jump audio there, jump-to-Q&A, searchable during live), EarningsHub (live + past calls), Robinhood, Stocktwits, Fey
- **What/how:** Audio player + streaming transcript; transcript text is the scrubber (tap sentence → audio seeks). Q&A section bookmarked. Complete transcript available the moment the call ends.
- **Why effective:** Collapses the 45-minute call into a random-access document; the text-as-scrubber interaction is the standout UX in this genre.
- **Data required:** Call audio/transcript vendor (Quartr API, EarningsCall.biz, Finnhub transcripts).
- **Modal fit:** **2** — modal shows a "Listen live · starts 5:00 PM" CTA; the player is a page.

### 41. AI one-liner / quarter summary
- **Platforms:** EarningsHub (AI transcript summaries), Seeking Alpha ("Earnings Calls Insights" AI summaries), Fiscal.ai (AI-summarized transcripts), Fey (instant summaries), earningscall.ai, AlphaSense Smart Summaries
- **What/how:** Pre-event: a 1-2 sentence setup ("Street looks for +11% rev growth; focus on data-center guide"). Post-event: "Beat on EPS/rev; raised FY guide; stock +6% AH." Usually one sentence bolded + 3 bullets.
- **Why effective:** Zero-effort orientation; the modal's narrative glue that makes numbers legible to non-quants.
- **Data required:** LLM + estimates/results/transcript feeds (UCT already has the brain infrastructure).
- **Modal fit:** **5** — one line pre-event, three bullets post-event.

### 42. Transcript highlights with timestamps
- **Platforms:** Fiscal.ai ("timestamped summaries so you can jump to specific sections", Q&A breakdowns), Quartr (automated summaries API), AlphaSense
- **What/how:** 3-5 pull-quotes from the call, each with speaker, timestamp, and jump link; Q&A separated from prepared remarks.
- **Why effective:** The 5 sentences that moved the stock, without reading 8,000 words.
- **Data required:** Transcript + extraction model.
- **Modal fit:** **3** — post-event only; 2-3 quotes max in a modal.

### 43. Management tone / tonal sentiment gauge
- **Platforms:** Aiera (+Helios: scores uncertainty/confidence in executives' *voice* during Q&A), AlphaSense (Sentiment Indices: quantified language shifts, phrase-level pos/neg highlighting, QoQ sentiment change screening, peer benchmarking)
- **What/how:** A score or dial for management confidence, with QoQ delta ("tone −12 vs last quarter") and highlighted phrases that drove the score.
- **Why effective:** Catches what numbers miss — hedging language and vocal uncertainty precede guidance cuts; a delta vs prior quarter makes it actionable.
- **Data required:** NLP/audio sentiment vendor (institutional-grade).
- **Modal fit:** **4** — one dial + delta chip post-event; deep-dive is page-level.

### 44. Event-scoped news feed / "hot earnings" stream
- **Platforms:** StreetInsider (real-time earnings vs consensus reporting, Hot Earnings, keyword/ticker alerts), Benzinga Pro (real-time squawk of beats/misses), EarningsWhispers (News tab)
- **What/how:** A filtered stream of only this ticker's earnings-relevant headlines (preview notes, results flash, guidance lines), newest first, each timestamped.
- **Why effective:** During the event window, seconds matter; a scoped feed beats the general news river.
- **Data required:** News feed with earnings tagging.
- **Modal fit:** **3** — last 2-3 headlines; the stream is page-level.

### 45. "What to watch" preview card
- **Platforms:** Zacks/Yahoo preview articles (templated "Reports Next Week: What to Expect"), AlphaSense earnings-season prep, Fiscal.ai KPI focus, Morning-Wire-style editorial
- **What/how:** 3 bullets: key metric thresholds, guidance focus, and the binary question of the quarter ("Can margins hold at 42%?").
- **Why effective:** Converts data into a decision frame — this is what premium subscribers actually pay for.
- **Data required:** Editorial/LLM synthesis of #7-#13.
- **Modal fit:** **4** — 3 bullets pre-event, swapped for #41's results post-event.

---

## H. Composite / Meta Patterns

### 46. Pre-earnings run-up seasonality ("how it trades into the print")
- **Platforms:** Academic-backed (QuantPedia: avg +0.31% excess in the 10-day pre-announcement window; +1.52% for high-IV names), EarningsWhispers (EAP — Earnings Announcement Premium — and its Whisper Score built on it), Market Chameleon (pre-event stats)
- **What/how:** Mini stat/sparkline: this ticker's average return in the 5/10 days *into* past earnings vs its normal drift ("typically gains +2.1% into the report, gives back −0.8% after").
- **Why effective:** Reveals the tradable ramp/fade pattern before the event even happens — rarely productized, high wow-factor.
- **Data required:** Daily bars around past events (already cached).
- **Modal fit:** **4** — one sparkline + one sentence.

### 47. Earnings-season scoreboard context
- **Platforms:** Bloomberg EA (index/industry earnings-season overview), FactSet Earnings Insight, Benzinga Pro calendar suite
- **What/how:** One context line: "So far this season, 78% of tech has beaten; peers that beat popped +3.1% avg."
- **Why effective:** Sets the grading curve — a beat in a season of beats is worth less.
- **Data required:** Aggregated season results by sector.
- **Modal fit:** **3** — a single caption line.

### 48. Alert/notify CTA with channel choice
- **Platforms:** EarningsHub (text/email/in-app), Robinhood (timely alerts), Wallmine (transcript notifications), StreetInsider (ticker alerts)
- **What/how:** "Notify me: [results drop] [call starts] [big move]" — checkboxes bound to the event, right in the modal.
- **Why effective:** The modal's natural conversion action; captures intent at peak interest.
- **Data required:** Notification infra.
- **Modal fit:** **5** — one button row, bottom of modal.

### 49. Tabbed progressive disclosure (Overview → deep dive)
- **Platforms:** EarningsWhispers (Overview / News / Transcript / History / Peers / Options / Dates tabs), Seeking Alpha (Summary / Estimates / Revisions / Surprise / Transcripts), Market Chameleon (Earnings-Dates / Earnings-Charts subpages)
- **What/how:** A compact overview surface with tabs or "View full analysis →" links routing each block to its full-page counterpart.
- **Why effective:** Resolves the modal-vs-page tension: modal answers 80% in 5 seconds, and every block is a doorway. This is the architecture pattern the whole catalog hangs on.
- **Data required:** —
- **Modal fit:** **5** — the modal *is* the Overview tab; each section header deep-links.

### 50. Confirmed-results diff view (post-event state swap)
- **Platforms:** Benzinga Pro (est / prior / reported / surprise columns turn live), EarningsHub ("expected, reported, and difference for each release"), StreetInsider (actual vs consensus in real time), Nasdaq
- **What/how:** The moment results hit, the expectation tiles morph: consensus grays out, actual lands next to it with a green/red surprise badge, AH price change appears. The same modal has two lifecycle states (pre/post).
- **Why effective:** The modal stays relevant across the entire event arc instead of dying at 4:00 PM; the visual state-flip itself communicates "results are in."
- **Data required:** Real-time results feed.
- **Modal fit:** **5** — designing pre/post states from day one is the highest-leverage architectural decision.

---

## Summary Table (fit ≥ 4 = modal candidates)

| # | Pattern | Best exemplar | Fit |
|---|---------|---------------|-----|
| 1 | Date + BMO/AMC + confirmed badge | EarningsWhispers | 5 |
| 2 | Countdown timer | EarningsHub | 5 |
| 3 | Fiscal period chip | Seeking Alpha | 5 |
| 7 | Consensus EPS + revenue tiles | all | 5 |
| 9 | Whisper vs consensus | EarningsWhispers | 5 |
| 10 | Surprise-prediction score (ESP) | Zacks | 5 |
| 12 | YoY growth framing | TipRanks | 5 |
| 14 | Beat/miss 8-dot streak | TipRanks/Nasdaq | 5 |
| 15 | Estimate-vs-actual lollipop | Koyfin | 5 |
| 20 | Last-8-quarters reaction bars | Market Chameleon/Barchart | 5 |
| 21 | Avg/max move chips | Barchart | 5 |
| 25 | Dual-encoded reaction bars | (synthesis) | 5 |
| 26 | Straddle-implied expected move | Market Chameleon/UW | 5 |
| 28 | Implied vs historical verdict | Market Chameleon | 5 |
| 31 | IV Rank/Percentile chips | Barchart | 5 |
| 35 | Beat/Meet/Miss + Up/Flat/Down polls | EarningsWhispers | 5 |
| 36 | Watcher count | Stocktwits | 5 |
| 38 | Composite letter grade | EarningsWhispers | 5 |
| 39 | Volatility/event-risk meter | EarningsWhispers | 5 |
| 41 | AI one-liner summary | Seeking Alpha/EarningsHub | 5 |
| 48 | Notify-me CTA | EarningsHub | 5 |
| 49 | Tabbed progressive disclosure | EarningsWhispers | 5 |
| 50 | Pre/post state swap | Benzinga Pro | 5 |
| 5 | Peer earnings this week | EarningsWhispers | 4 |
| 6 | Lifecycle stage chip | EarningsWhispers | 4 |
| 8 | Estimate range bar | Koyfin | 4 |
| 11 | Revisions trend sparkline | Seeking Alpha | 4 |
| 13 | KPI/segment expectations | Fiscal.ai | 4 |
| 16 | Revenue toggle on lollipop | Koyfin | 4 |
| 18 | Guidance history chips | StreetInsider/MarketBeat | 4 |
| 19 | PEAD grade | EarningsWhispers | 4 |
| 27 | Expected-move cone sparkline | OptionCharts/Barchart | 4 |
| 33 | Options positioning 3-stat row | Unusual Whales | 4 |
| 34 | Community sentiment bar | Stocktwits | 4 |
| 43 | Management tone dial | Aiera/AlphaSense | 4 |
| 45 | "What to watch" bullets | Zacks previews | 4 |
| 46 | Run-up seasonality sparkline | (rare — differentiator) | 4 |

Page-level (modal links out): 4, 17, 22-24, 29-30, 32, 37, 40, 42, 44, 47.

---

## Aesthetic & Layout Observations

1. **Stat-chip density over prose.** The professional platforms (Barchart, Market Chameleon, Koyfin) lead with a horizontal band of 4-6 labeled stat chips (IV Rank, Expected Move, Avg Move, Next Date) above any chart. Numbers first, charts second, sentences last.
2. **A strict, tiny color grammar.** Green = beat/up, red = miss/down, **grey = estimate/expected**, one accent (blue/purple) = price/live data. Koyfin's grey-circle-estimate vs colored-circle-actual is the cleanest example; TradingView's E-icon system proves color+shape can carry surprise data with zero labels.
3. **The estimate is always visually "hollow," the actual "solid."** Dotted lines, hollow circles, grey fills for expectations; solid fills for realized data (OptionCharts' dotted expected-move boundaries, Koyfin's circles). This expected-vs-realized visual convention is the genre's core metaphor.
4. **One hero visual per surface.** Every strong single-ticker earnings view centers ONE chart (lollipop history, reaction bars, or expected-move cone) and keeps everything else as chips/rows. Weak pages (Nasdaq) are walls of tables.
5. **Grades and verdicts sell.** EW's letter grades, Zacks' ESP+Rank combo, MC's "premium rich/cheap" — premium platforms are unafraid to compute an opinion. The verdict is the product; the charts are the evidence.
6. **Lifecycle-aware UI.** The best experiences change state across pre-event → live → post-event (Benzinga's columns fill in, Quartr's transcript goes live, EW's Power Rating activates post-print). A static modal wastes half the event's lifespan.
7. **Dark-theme options platforms (UW, Tradytics, SpotGamma)** use near-black surfaces with one saturated neon accent and mono-spaced numerals; the "terminal" aesthetic signals professionalism to this audience — but they overload; pairing that palette with Koyfin's restraint is the winning combination.
