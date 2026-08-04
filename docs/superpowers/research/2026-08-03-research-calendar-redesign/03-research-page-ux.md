# Single-Ticker Research Page UX — Competitive Catalog

Research for the UCT `/research/:sym` redesign (dark-theme premium React dashboard; current design: 7 tabs — Overview, Financials, Estimates, Ratings, Ownership, Calls & Transcript, Filings & Events). Competes with MarketSurge, EarningsWhispers, EarningsHub.

Compiled 2026-08-03 from product pages, help-center docs, live page fetches (Finviz quote, stockanalysis.com forecast), third-party reviews, and platform methodology docs.

## Platforms touched (33)

| # | Platform | One-line layout DNA |
|---|----------|---------------------|
| 1 | MarketSurge (IBD) | Chart-first cockpit; 1–99 ratings stack beside chart; pattern recognition annotations |
| 2 | IBD Stock Checkup (investors.com) | Pass/fail/neutral checklist page, green/yellow/red circles |
| 3 | Koyfin | Left-rail nav tree per ticker (Overview → FA → Estimates → Transcripts → Ownership), graph-everything |
| 4 | TIKR | Tabbed terminal: Overview / Financials / Estimates / Valuation / Ownership / News; spreadsheet grids |
| 5 | Finviz quote | One-page density bomb: 72-cell snapshot table + chart + ratings + insider + news |
| 6 | Simply Wall St | Single-scroll narrative "company report" with snowflake radar + numbered sections |
| 7 | YCharts | Quote page + "chart any metric" engine; sector-specific Financials tab layouts |
| 8 | Morningstar | Verdict block (stars, fair value, moat, uncertainty) above analysis modules |
| 9 | Seeking Alpha | Ratings-summary trio (SA authors / Wall St / Quant) + A–F factor grades; tabbed sub-nav |
| 10 | TipRanks | Smart Score dial (1–10) + 8-factor evidence stack; per-analyst accountability |
| 11 | Fintel | Plain tables, deep data: short interest, borrow fee, 13F flow deltas, squeeze score |
| 12 | stockanalysis.com | Fast multi-tab hub (Overview/Financials/Forecast/Options/Dividend/Chart/News), spreadsheet-clean |
| 13 | Barchart | Widget-grid quote page; Opinion composite of 13 indicator signals by horizon |
| 14 | Fey (acq. by Wealthsimple 2025) | Keyboard-native command bar; `/AAPL → F → Tab` reaches quarterly BS; minimal dark UI |
| 15 | Stock Rover | Insight Panel with 11 subsections + 8-page generated research report |
| 16 | Zacks | Rank #1–5 + Style Score letter chips at top of every quote page; left-nav research links |
| 17 | ChartMill | Dual generated reports (technical + fundamental) with 5-aspect 0–10 ratings |
| 18 | Wisesheets | No page at all — Excel/Sheets add-in; "the grid is the UI" (anti-pattern reference) |
| 19 | Bloomberg Terminal | Function-per-screen (DES, FA, ANR, EE, GP, HDS); command line + panels |
| 20 | FactSet | Workspace tabs; stacked linked panels (quote + chart + news + estimates) |
| 21 | Yahoo Finance | 2023–24 redesign: cleaner quote pages, compare mode, persistent "dock" follow-along panel |
| 22 | WSJ Markets quote | Airy editorial quote page; price header + key stats strip + analyst consensus dial |
| 23 | Robinhood | Consumer card stack; bulls-vs-bears text digests; expected-vs-actual EPS dots |
| 24 | Webull | Trader-dense mobile detail: quote panel, depth, analyst sentiment bars, capital flow |
| 25 | moomoo | Capital-flow pie (L/M/S orders), institution tracker, quote-page module scroll |
| 26 | EarningsWhispers | Whisper vs consensus per ticker; EW Grade (F–A+), Score, Power Rating (PEAD) |
| 27 | EarningsHub | Earnings-centric ticker view: calendar, live calls, transcripts + AI summaries, alerts |
| 28 | Quartr | Audio-first: live call player, real-time transcript, AI "Topics" Q&A condensation |
| 29 | TradingView symbol page | Chart + Financials rows with drop-down depth + estimate distributions (min/avg/max) |
| 30 | GuruFocus | GF Score pentagon-in-circle; customizable summary dashboard; warning signs list |
| 31 | WallStreetZen | Due Diligence Score = 38 binary checks across 5 dimensions; Zen Ratings 7 component grades |
| 32 | AlphaSpread | Valuation-first: intrinsic value vs price bar, DCF sensitivity matrix, scenario toggles |
| 33 | Danelfin / fiscal.ai (FinChat) | Explainable-AI score with ranked green/red alpha signals / segment-KPI charting + AI copilot |

---

# PART A — PAGE-LEVEL LAYOUT PARADIGMS

## A1. Classic multi-tab ticker hub
- **Platforms:** stockanalysis.com, TIKR, Seeking Alpha, Finviz (Overview/Compare/Short Interest/Financials/Options/Filings), Zacks, Fintel, current UCT page.
- **Structure:** Persistent quote header (price, change, session) + horizontal tab bar; each tab is a full page swap. stockanalysis.com is the cleanest execution: Overview / Financials / Forecast / Options / Dividend / Chart / News, each loading instantly with URL-addressable routes.
- **Pros:** URL-per-view (deep-linkable, SEO, shareable); each domain gets full width; mentally simple; cheapest to lazy-load. Familiar to 100% of the audience.
- **Cons:** Context destruction on every switch — you can't see ratings while reading financials; hides content behind clicks so weaker tabs rot unseen; encourages "7 shallow pages" instead of one strong page. Reviews consistently praise stockanalysis for *speed*, not layout novelty — the tab paradigm only wins when switching is instant.
- **Prosumer fit:** Acceptable baseline, but it is exactly what UCT has today; every leader below augments or abandons it.

## A2. Single-scroll narrative report with numbered/sticky section nav
- **Platforms:** Simply Wall St (canonical), AlphaSpread, Stock Rover research report (PDF-style), ChartMill reports, GuruFocus summary.
- **Structure:** One long scrolling document: verdict visualization up top (snowflake / GF pentagon / intrinsic-value bar), then numbered sections (SWS: 1 Overview, 2 Valuation, 3 Future Growth, 4 Past Performance, 5 Financial Health, 6 Dividend, 7 Management, 8 Ownership) with a sticky left TOC that highlights scroll position.
- **Pros:** Tells a story — score at top, evidence in order; scroll is the friendliest gesture on mobile; sticky TOC gives random access without losing place; every section is discoverable (no dead tabs).
- **Cons:** Reads "guided/consumer," can feel slow to a trader who wants one number; long DOM = perf care needed (virtualize/lazy sections); poor for dense side-by-side grids.
- **Prosumer fit:** Strong pattern for the *Overview* tab specifically — verdict → evidence — even if the full page keeps tabs.

## A3. Left-rail navigation tree + main canvas
- **Platforms:** Koyfin (canonical: ticker loads with left rail of Overview, News, Snapshot/Highlights, Financial Analysis, Estimates — Overview/Trends/Price Target, Filings, Transcripts, Ownership, Percentile Rank, Dividend), Zacks left research links, FactSet, Bloomberg menu panes.
- **Structure:** Vertical rail (icons + labels, collapsible) is the section switcher; the canvas keeps a persistent mini quote header. Koyfin nests sub-views under parents (Estimates → Overview / Trends / Price Target), which scales to 20+ views without a mega tab bar.
- **Pros:** Scales far beyond 7 sections; rail is always visible = you always know where you are; reads "terminal/professional"; leaves full canvas width for grids; sub-nesting keeps IA shallow-feeling.
- **Cons:** Costs 200–240 horizontal px; a rail with too many items becomes a junk drawer; on mobile it must collapse into a sheet/dropdown anyway.
- **Prosumer fit:** Excellent — this is the visual signature of "research terminal" (Koyfin is the most-cloned prosumer research UI of the decade). Pairs naturally with a dark theme.

## A4. Terminal function-per-screen + command line
- **Platforms:** Bloomberg (DES, FA, ANR, EE, HDS, GP…), FactSet workspaces, Fey (modern reinterpretation).
- **Structure:** No page hierarchy at all: each analytical view is a flat, named, full-screen function reached by typed mnemonic (`AAPL US Equity FA <GO>`). Fey modernized this: `/` opens a command bar, `/AAPL` switches symbol, single keys jump views, Tab cycles sub-tabs — reviewers repeatedly cite "keyboard-first" as the reason it feels professional.
- **Pros:** Fastest possible navigation for daily power users; muscle memory compounds; screens can be arbitrarily dense because each does one job; zero chrome.
- **Cons:** Discoverability cliff; needs a searchable command palette as a crutch; overkill as the *only* nav for a web product.
- **Prosumer fit:** Adopt as a *layer*, not the architecture: Cmd-K palette that switches symbols AND jumps to sections ("AAPL estimates") is cheap and reads elite.

## A5. Chart-first cockpit with ratings side panel
- **Platforms:** MarketSurge (canonical), TradingView symbol page, Webull/moomoo detail, ThinkorSwim-style.
- **Structure:** Giant chart is ~70% of the viewport; right/side panel stacks the proprietary numbers (MarketSurge: Composite, EPS, RS, SMR, Acc/Dis ratings + fundamentals + earnings table); overlays annotate the chart itself (base patterns, pivot points, earnings line, RS line). Everything else is secondary panels/flyouts.
- **Pros:** Traders live on price — ratings *in the chart's context* (RS line at new high, base count) is MarketSurge's entire moat; single screen = zero navigation for the core loop.
- **Cons:** Fundamentals depth suffers (MarketSurge reviews complain about static charts and shallow drill-down); doesn't serve a 7-domain research hub; chart engine investment is huge.
- **Prosumer fit:** UCT already has a chart product; the research page should *link into* it, not recreate it — but steal the "ratings panel pinned beside price context" idea for the Overview.

## A6. Dense one-page snapshot table
- **Platforms:** Finviz quote (canonical), EarningsWhispers ticker page, Barchart legacy quote, Wisesheets (grid-as-UI, degenerate case).
- **Structure:** Live Finviz fetch: price block w/ after-hours → tab strip → tag chips → ~72-metric snapshot table (Market Cap → P/E → margins → RSI → ATR → performance rows) → chart → analyst ratings table → news feed → description → management → insider table. Everything above the fold, near-zero whitespace.
- **Pros:** Unmatched time-to-answer for "what is this stock?"; scan speed rewards experts who know where each cell lives; loads instantly; zero interaction cost.
- **Cons:** Zero hierarchy — nothing tells you what matters *today*; no visual encoding (numbers, not graphics); intimidating to newcomers; ugly by modern standards and reads 2008.
- **Prosumer fit:** The *information density target* is right, the presentation isn't. A "key stats wall" module with Finviz density but designed cells (spark-bars, percentile shading) is the upgrade path.

## A7. Dashboard grid of modular cards (customizable)
- **Platforms:** Barchart dashboards, GuruFocus customizable stock summary, Yahoo redesign, Koyfin *market* dashboards, Stock Rover layout selector (table/chart/insight combos).
- **Structure:** Ticker page = grid of self-contained cards (ratings card, estimates card, ownership card, news card…), often drag-to-rearrange, cloud-saved layouts.
- **Pros:** Each card is independently buildable/shippable (good for an incremental React migration); users self-serve priorities; degrades gracefully to mobile (cards stack).
- **Cons:** Card chrome eats space; uniform card sizes flatten hierarchy (the snowflake and the news list look equally important); customization is used by <10% of users but taxes every design decision; can feel like a widget junkyard (Barchart reviews: "plain-looking").
- **Prosumer fit:** Good for the Overview tab as a *curated* (not user-customizable) grid; skip drag-and-drop in v1.

## A8. Sticky live-quote header + persistent context strip
- **Platforms:** Universal among leaders — Yahoo (plus its follow-you "dock"), Seeking Alpha, stockanalysis.com, Webull, TipRanks, Koyfin mini-header.
- **Structure:** Row 1: symbol, name, live price, change, session tag (pre/after-market with its own price+change — Finviz and stockanalysis both show dual-session), market state clock. Row 2 (often sticky on scroll): key stats strip (mkt cap, P/E, next earnings date, 52w position) + actions (watchlist, alert, compare). Header persists across all tabs/sections so price context never disappears.
- **Pros:** The single highest-agreement pattern in the space; anchors identity while deep in a filing; earnings-date-in-header is a trader favorite (EarningsWhispers/EarningsHub lead with it).
- **Cons:** Sticky headers steal vertical space — keep collapsed state ≤56px; live ticking needs throttling discipline.
- **Prosumer fit:** Mandatory. UCT already has SSE price streaming — a ticking header with session provenance is table stakes and cheap.

## A9. Command palette / symbol switcher layer
- **Platforms:** Fey (canonical modern), Bloomberg command line, Koyfin `/` search, TIKR search, Atom-descendants; Fey's is searchable when you forget shortcuts.
- **Structure:** Global Cmd-K / `/` opens an omnibox: type a ticker to switch symbol in-place (stay on the same section), or type an action/section name to jump ("transcript", "short interest"). Recent symbols and watchlist surface first.
- **Pros:** Makes a 7-section page feel like one surface; symbol-switch-preserving-section is the killer behavior (compare 5 tickers' Estimates tabs in 15 seconds); strongest cheap signal of "built for professionals."
- **Cons:** Invisible without a hint (show `⌘K` chip in the header); requires debounced fast symbol search API.
- **Prosumer fit:** Shortlist. Low engineering cost, disproportionate perceived quality.

## A10. Peer-comparison strip / compare mode
- **Platforms:** Yahoo compare mode (side-by-side quote analysis, marketed as unique), Finviz peer row + Compare tab, Simply Wall St (peer context embedded in every section), stockanalysis Compare tab, Koyfin percentile-rank-vs-sector views, YCharts multi-ticker fundamental charts.
- **Structure:** Two flavors: (a) a slim horizontal strip of sibling tickers (logo, price, 1D%) that swaps the page's symbol on click; (b) a true compare view where each metric row shows the ticker vs 3–5 peers vs sector median, often with percentile shading.
- **Pros:** Answers "is 34% growth good?" — the question raw grids never answer; percentile-vs-sector coloring (Koyfin, Seeking Alpha grades) is the cheapest way to add judgment without opinions.
- **Cons:** Peer-set selection is editorially hard (auto peers are often wrong — let users edit); full compare mode is a separate product surface.
- **Prosumer fit:** Embed flavor (a) in the header area and percentile context inside widgets; defer full compare mode.

## A11. Score-first "verdict page" (rating on top, evidence below)
- **Platforms:** TipRanks (Smart Score dial → 8 factor rows), Zacks (Rank + VGM chips atop every page), Morningstar (stars + fair value + moat + uncertainty block), WallStreetZen, Danelfin, GuruFocus, Simply Wall St.
- **Structure:** The page opens with the house verdict rendered as a designed object (dial, stars, pentagon, snowflake, letter chips) plus 3–6 sub-scores; every section below exists to justify a sub-score, and sub-scores deep-link to their evidence section.
- **Pros:** Gives the page a spine and the product a brand asset (people say "it's a 99 Composite" / "an 8 Smart Score"); creates recurring engagement (score changes = notifications); UCT's Ratings tab could *become* the page's crown instead of tab #4.
- **Cons:** A score you can't defend destroys trust — needs the Danelfin move: explainable components with green/red contribution signals; house scores are a data-science commitment, not just UI.
- **Prosumer fit:** Shortlist. This is MarketSurge's actual differentiator (the 1–99 system), and it's the pattern with the highest brand payoff.

## A12. Mobile handling: card-stack collapse + horizontal-scroll tab pills
- **Platforms:** Robinhood (canonical consumer: single card stack — price, chart, your position, stats accordion, analyst card, earnings dots, news), Webull/moomoo (module scroll with expandable "more" links per module), Simply Wall St (sections become accordions), stockanalysis (tabs become swipeable pill row), Yahoo app.
- **Structure:** Desktop tabs/rails become either (a) a horizontally scrollable pill bar under the sticky header, or (b) one long stack where each desktop widget becomes a card with a "See all" drill-in. Charts simplify to sparkline-grade; tables show 3 columns max with expand.
- **Pros:** (b) preserves discovery; accordions keep first paint light; Robinhood proves stats-behind-accordion is acceptable even for money decisions.
- **Cons:** Pill bars hide far-right sections (Filings will never be found); dense grids (Financials) fundamentally don't fit — leaders ship a transposed "metric per row, quarters as swipeable columns" view instead of shrinking the desktop grid.
- **Prosumer fit:** Pill bar + per-widget drill-ins; accept that Financials mobile is a different component, not a responsive squeeze.

---

# PART B — WIDGET PATTERN CATALOG

Format per widget — **Name** · Platforms · What/how · Why it works · Data required · Sophistication (1–5) & register (institutional vs retail).

## B1. Price header treatments

**W1. Dual-session live price block**
- **Platforms:** Finviz (shows "Last Close" + separate "Aftermarket" line with own change), stockanalysis.com (real-time incl. pre/post), Yahoo, Webull, Robinhood.
- **What:** Big price + change/%, then a second smaller line for the *other* session (pre-market or after-hours) with its own delta and timestamp; session label ("At close 3:59 PM ET · After hours 7:59 PM").
- **Why it works:** Traders' first question at 7am is "what's it doing *now*" — omitting the extended session instantly reads amateur. Timestamp = data-provenance trust.
- **Data:** Real-time or delayed quote + extended-hours feed with session flags (UCT SSE stream; note Finnhub /quote regular-session trap in memory).
- **Sophistication:** 3 · Professional when timestamped, retail when not.

**W2. 52-week range slider with current-price thumb**
- **Platforms:** Yahoo, WSJ, Webull, Barchart, stockanalysis.
- **What:** Horizontal track from 52w low to high; marker at current price; often a second marker for the 50/200-DMA or analyst target. Sometimes doubled with a day-range slider.
- **Why:** One glance encodes "near highs or lows" — the trader's default context question; far faster than reading two numbers.
- **Data:** 52w high/low, last price (already in bars cache).
- **Sophistication:** 2 · Neutral — ubiquitous; execution quality (thin track, precise thumb) decides whether it reads pro.

**W3. Sticky key-stats strip**
- **Platforms:** stockanalysis (mkt cap, P/E, EPS, div yield row under price), Finviz snapshot top row, Seeking Alpha, Koyfin highlights band.
- **What:** 6–10 micro-stats in a single row that stays with the sticky header: Mkt Cap · P/E (fwd) · EPS · Div/Yield · Beta · Avg Vol · Short % Float · Next Earnings (date + BMO/AMC).
- **Why:** Removes the need to visit tabs for the five numbers every visitor wants; "Next Earnings" chip doubles as the event hook.
- **Data:** Fundamentals snapshot + earnings calendar.
- **Sophistication:** 2 · Professional if typographically disciplined (tabular numerals, muted labels).

**W4. Header mini-sparkline / intraday thumbnail**
- **Platforms:** Fey, Robinhood (1D line dominates), Koyfin mini-header, Yahoo dock, Google Finance.
- **What:** 80–140px 1D sparkline next to price, colored by day direction, often with prior-close reference line; on hover shows time+price.
- **Why:** Shape of the day (gap-and-fade vs grind-up) carries information a % number doesn't; keeps header alive without a full chart.
- **Data:** 1-min/5-min intraday bars.
- **Sophistication:** 3 · Professional; the prior-close dotted baseline is the detail that separates it from a toy.

**W5. Symbol identity + status chips row**
- **Platforms:** Finviz (sector/industry/country/cap tags), TradingView, Koyfin, TipRanks.
- **What:** Logo, name, exchange, then clickable chips: sector, industry, market-cap class, index membership, "Earnings in 3d", "High short interest". Chips link to screens of that cohort.
- **Why:** Instant classification + escape hatches into cohort views; status chips ("Earnings soon") surface time-sensitive context passively.
- **Data:** Reference/profile data + derived flags.
- **Sophistication:** 2 · Neutral; flag chips push it professional.

**W6. Follow-you dock / mini-watchlist rail**
- **Platforms:** Yahoo redesign (customizable dock with portfolio + trending that follows you), FactSet linked panels, Fey watchlists pane.
- **What:** Slim right-edge collapsible panel with the user's watchlist ticking live; clicking swaps the research page's symbol without navigation.
- **Why:** Supports the real workflow — rotating through a watchlist during prep; symbol-swap-in-place is the same win as the command palette for mouse users.
- **Data:** Watchlist + streaming quotes (UCT has both).
- **Sophistication:** 4 · Professional/terminal.

## B2. Ratings visualizations

**W7. 0–99 percentile composite rating stack (IBD-style)**
- **Platforms:** MarketSurge/IBD (Composite, EPS Rating, RS Rating, SMR Grade, Acc/Dis Rating), GuruFocus GF Score (0–100).
- **What:** A vertical stack of proprietary percentile ranks, each a bold number 1–99 against the whole market, with letter grades for the non-numeric ones (SMR: A–E, Acc/Dis: A–E). Pinned beside the chart, always visible.
- **Why:** Percentile-vs-entire-market is instantly interpretable ("98 = elite"); a small set of memorable numbers becomes the product's language and the user's shorthand; drives screening ("Composite ≥ 95").
- **Data:** Cross-sectional ranking engine over the full universe (earnings growth, sales, margins, ROE, rel. strength) recomputed daily — a real data-science asset, and exactly what UCT's brain/ratings data could feed.
- **Sophistication:** 4 · Strongly professional — the defining artifact of the CANSLIM subculture.

**W8. Pass/fail/neutral checklist (IBD Stock Checkup)**
- **Platforms:** IBD Stock Checkup (canonical: green/yellow/red circles across ~6 headline ratings, expandable to 25+ line items), WallStreetZen Due Diligence (38 binary checks in 5 dimensions, scored as % passed), Simply Wall St (each section has ✓/✗ risk-and-reward bullets), Stock Rover Warnings page.
- **What:** A vertical list of named criteria ("EPS growth ≥25%", "RS line at new high"), each with a colored pass dot and the actual value beside the threshold; grouped by theme; group headers show n-of-m passed.
- **Why:** Converts methodology into a glanceable audit; the actual-value-next-to-threshold teaches users the discipline; near-zero chart literacy required yet respected by pros because criteria are explicit.
- **Data:** Rule thresholds + the underlying fundamentals/technicals per rule. Cheap to build once metrics exist.
- **Sophistication:** 3 · Reads professional *because* it's opinionated and auditable; the highest value-per-engineering-hour widget in this catalog.

**W9. Multi-factor letter-grade row (A+–F)**
- **Platforms:** Seeking Alpha factor grades (Valuation, Growth, Profitability, Momentum, EPS Revisions — graded vs sector), Zacks Style Scores (V/G/M + composite VGM), WallStreetZen Zen Ratings (7 component grades incl. an "AI" grade).
- **What:** A compact row/table of factor names with big letter chips, color-stepped (A green → F red); SA shows "now vs 3m ago vs 6m ago" columns so grade *drift* is visible; hover reveals the underlying metric percentiles.
- **Why:** Letters compress percentile math into school-grade intuition; sector-relative grading answers "good for a software company?"; the drift columns add a time dimension gauges lack.
- **Data:** Sector-relative percentile scoring across metric buckets, snapshotted historically.
- **Sophistication:** 3 · Bridges retail and pro; the drift columns are what make it pro.

**W10. Composite score dial with factor breakdown (Smart Score pattern)**
- **Platforms:** TipRanks (1–10 dial + 8 signal rows: analyst consensus, blogger sentiment, insider activity, hedge fund activity, news sentiment, technicals, fundamentals), Danelfin (1–10 AI Score + ranked alpha signals).
- **What:** A gauge/dial renders the headline score; below it, each contributing signal gets its own row with direction (bullish/bearish icon) and its own mini-visualization; Danelfin ranks features by contribution, green if additive, red if detractive.
- **Why:** The dial is marketing; the breakdown is trust. Danelfin's explainability pattern (ranked signed contributions) is the state of the art for making a black-box score credible.
- **Data:** The composite model + per-factor signals; contribution weights if explainable.
- **Sophistication:** 3 (dial) to 4 (explainable contributions) · Dial alone reads retail; contributions read quant-professional.

**W11. Radar/polygon score glyph (Snowflake / GF pentagon)**
- **Platforms:** Simply Wall St snowflake (5 axes: value, future, past, health, dividend; colored green→red by overall), GuruFocus pentagon-in-circle (financial strength, profitability, growth, GF Value, momentum — area = score).
- **What:** A 5-axis radar whose filled area is the verdict-at-a-glance; axis labels deep-link to evidence sections; small enough to reuse as an icon in tables/watchlists.
- **Why:** Shape memory — users recognize "balanced pentagon" vs "spiky value trap" pre-attentively; works at 24px (list icon) and 240px (hero) alike, which no gauge does.
- **Cons to note:** Radar area is mathematically misleading (adjacent-axis correlation); pros know this — pair with the raw sub-scores.
- **Data:** 5 composite sub-scores.
- **Sophistication:** 4 visual craft · Reads modern-retail (SWS) unless rendered austerely (GuruFocus manages neutral).

**W12. Verdict block: rating + fair value + risk qualifier (Morningstar pattern)**
- **Platforms:** Morningstar (star rating, fair value estimate vs price with % premium/discount, economic moat [wide/narrow/none], uncertainty rating [low→extreme], capital allocation grade).
- **What:** A single header block of 4–5 labeled facts, each one word or number; star rating is *derived* from price-vs-fair-value discount scaled by uncertainty (bigger required margin of safety when uncertainty is high).
- **Why:** The uncertainty qualifier is the sophisticated part — it encodes "how much to trust the fair value" and changes the buy threshold; a ratings block that acknowledges its own error bars reads deeply institutional.
- **Data:** Fair value model (DCF or house model), moat/uncertainty classification (editorial or heuristic).
- **Sophistication:** 4 · Institutional; the inverse of a hype dial.

**W13. Technical-opinion composite by horizon (Barchart Opinion)**
- **Platforms:** Barchart (13 indicators bucketed into short/medium/long-term groups; each signal Buy/Sell/Hold; group averages; overall "88% Buy"; plus a 3-period history strip of how the opinion changed vs yesterday/last week/last month).
- **What:** Grouped table of indicator signals with per-group average and an overall percentage verdict, refreshed intraday; includes support/resistance/pivot numbers.
- **Why:** Horizon bucketing (ST/MT/LT can disagree) mirrors how traders actually think; the opinion-change strip adds momentum-of-signal.
- **Data:** Standard indicator computations off daily bars — fully derivable from UCT's bars cache.
- **Sophistication:** 2 visually / 3 conceptually · Reads quant-retail; grouping + history strip elevate it.

**W14. Rating history timeline**
- **Platforms:** Seeking Alpha (quant rating time series with hover for that day's factor grades), TipRanks (Smart Score history), Zacks (rank changes), MarketSurge (RS line history as proxy).
- **What:** A small line/step chart of the house score over 1–3 years, overlaid or paired with price; hover reconstructs the score's components on that date.
- **Why:** "Was the system right on this name?" — self-accountability that no static score provides; also surfaces *revisions* as tradable events.
- **Data:** Daily snapshots of the score (start persisting from day one).
- **Sophistication:** 4 · Professional; rare outside SA/TipRanks — differentiator opportunity.

**W15. Relative Strength line + RS blue-dot annotation**
- **Platforms:** MarketSurge (RS line vs S&P on every chart; blue dot when RS hits new high before price does), ChartMill (relative strength ratings).
- **What:** Price chart companion line of ticker/SPX ratio; a colored dot marks RS-line new-highs; RS 1–99 rank shown beside it.
- **Why:** Institutional accumulation shows in RS before price; the blue-dot pattern is a beloved IBD tell; it converts "ratings" into an on-chart, in-context signal.
- **Data:** Price bars + benchmark bars.
- **Sophistication:** 4 · Deeply professional in the growth-trader subculture; near-unknown to retail.

## B3. Financials grids

**W16. Heat-shaded quarterly acceleration grid**
- **Platforms:** MarketSurge (quarterly EPS %chg and Sales %chg boxes beside chart, colored by acceleration), TradingView financials (YoY column), fiscal.ai.
- **What:** Grid of last 6–8 quarters × {EPS YoY%, Sales YoY%, Margin}; cells color-ramped (deep green = accelerating >40%, red = deceleration); an acceleration arrow when growth rate itself rises 2+ quarters.
- **Why:** CANSLIM's core question — is growth *accelerating* — answered pre-attentively; heat shading turns a table into a chart with zero space cost.
- **Data:** Quarterly income statement history (8+ quarters) — UCT Financials tab already has the numbers.
- **Sophistication:** 4 · Professional/growth-trader; the single most on-brand upgrade for a MarketSurge competitor.

**W17. Spreadsheet statement grid with chart-any-row**
- **Platforms:** TIKR (canonical), Koyfin FA, stockanalysis (Pro: 40yr history), YCharts, fiscal.ai, TradingView (collapsible sub-sections per line item).
- **What:** Statements as a wide grid (periods as columns, annual/quarterly/TTM toggle, reverse-order toggle); every row has a chart icon that pops the metric as a time-series chart; expandable roll-ups (click "Operating Expenses" → components); CAGR column at right.
- **Why:** The grid is for lookup, the pop-chart is for insight — one click from any number to its trend is the most-praised interaction in TIKR/Koyfin reviews; drop-down depth keeps the default view scannable.
- **Data:** Full statement history, ideally 10y+.
- **Sophistication:** 3 · Professional; the chart-icon affordance is the tell.

**W18. Segment / KPI stacked-bar module**
- **Platforms:** fiscal.ai (canonical — segments and KPIs "management actually talks about": iPhone rev, AWS rev, subscriber counts, for 2,000+ companies), TIKR segments, Koyfin.
- **What:** Stacked bars of revenue by segment per quarter/year with % mix line; a KPI table of company-specific operating metrics with QoQ/YoY deltas; segment margin table when disclosed.
- **Why:** This is where "why did the stock move" actually lives; reviewers call fiscal.ai's segment/KPI data its unmatched moat; almost no competitor has it because the data is extraction-hard.
- **Data:** Segment revenue extraction from 10-Q/K (or vendor); hard — flag as premium/differentiating.
- **Sophistication:** 5 · Institutional.

**W19. Margin waterfall / income-statement Sankey**
- **Platforms:** fiscal.ai/FinChat popularized the earnings Sankey (revenue → COGS/gross → opex lines → operating income → net income) that went viral on X; App Economy Insights charts; SWS uses simplified revenue→profit bars.
- **What:** A per-quarter flow diagram of the income statement, magnitudes as ribbon widths, costs red / profits green; alternative compact form: margin waterfall bars (gross → op → net) with YoY deltas.
- **Why:** Shows cost structure and where margin was won/lost in one image; extremely shareable (marketing surface); a plain-table income statement becomes a story.
- **Data:** Income statement lines for the period; pure client-side rendering.
- **Sophistication:** 5 when done cleanly · Reads modern-professional; sloppy versions read infographic-retail. (Fits UCT's dataviz skill + engine-drawn philosophy.)

**W20. Earnings line / fundamentals-on-price overlay**
- **Platforms:** MarketSurge "Earnings Line" (quarterly EPS trend drawn under price), FASTgraphs (canonical price vs earnings-justified-value channel), YCharts fundamental charts.
- **What:** Price chart with a smoothed EPS (or fair-value multiple × EPS) line beneath/behind it, so divergence of price from earnings power is visible.
- **Why:** The core long-term investor chart — "price follows earnings"; visually justifies both value and growth theses.
- **Data:** Quarterly EPS history + bars.
- **Sophistication:** 4 · Professional/old-school-institutional.

**W21. 10-year metric history strip**
- **Platforms:** Stock Rover ("10 Year History of Key Valuation and Profitability Metrics" report page), GuruFocus (10y high/low/median bands per ratio), stockanalysis Pro deep history.
- **What:** For each key ratio (P/E, EV/EBITDA, gross margin, ROIC): a small area chart of 10 years with median line and current-value marker; often a "current vs 10y percentile" bead.
- **Why:** "Is 30× cheap *for this stock*" requires its own history, not the sector's; the percentile bead compresses the answer to one glyph.
- **Data:** Long ratio history (needs long statements + price history).
- **Sophistication:** 4 · Institutional.

**W22. Financial health snake / debt-vs-cash visual**
- **Platforms:** Simply Wall St (debt vs equity vs cash growth chart, "financial health snake"), ChartMill health rating detail.
- **What:** Area chart of debt and cash over time with coverage ratios called out; pass/fail bullets ("debt covered by operating cash flow?").
- **Why:** Makes balance-sheet risk visible to non-accountants without dumbing down the inputs.
- **Data:** Balance sheet + CF history.
- **Sophistication:** 3 · Modern-retail leaning; the pass/fail pairing rescues it for pros.

**W23. Expense/efficiency ratio mini-grid**
- **Platforms:** Koyfin FA ratios pages, YCharts sector-specific financial tabs (bank pages get NIM/efficiency ratio; SaaS gets Rule-of-40).
- **What:** A ratios grid that *changes by sector* — banks show NIM, credit provisions; insurers combined ratio; SaaS shows NRR, Rule of 40, SBC %.
- **Why:** Sector-appropriate metrics are the strongest "this tool understands the business" signal; YCharts ships this as a headline feature.
- **Data:** Sector classification + metric mapping tables.
- **Sophistication:** 4 · Institutional.

## B4. Estimates & forecasts

**W24. Forward estimates grid (actuals + consensus, beat/miss colored)**
- **Platforms:** TIKR (canonical: rows = revenue/EBITDA/EPS etc., columns = FY-2…FY+3, actuals then consensus with analyst count), Koyfin (Actuals and Consensus view), TradingView Forecast (per-metric min/avg/max distribution + analyst count), stockanalysis Financial Estimates (annual + quarterly, FY21–FY28 span).
- **What:** A statement-shaped grid extended into the future; estimate cells visually distinct (italic/tint); past estimate columns show beat/miss vs actual as green/red deltas; analyst count per cell for reliability.
- **Why:** "The market looks 18 months ahead" — this grid is how prosumers build a forward P/E in their head; showing n-analysts tells them how much to trust each number.
- **Data:** Consensus estimates feed (mean/median/high/low, n) + actuals history. The key data purchase for the whole Estimates tab.
- **Sophistication:** 4 · Institutional — the tables that make TIKR feel like CapIQ.

**W25. Estimate revision momentum chart**
- **Platforms:** Koyfin Estimate Trends (consensus for a fixed fiscal year charted over time), Zacks Price & Consensus chart (canonical — price line + each FY's consensus EPS line), Seeking Alpha EPS Revisions grade with up/down counts.
- **What:** Line chart where each series is "FY26 consensus EPS" evolving over the past 12–24 months, optionally with price overlaid; companion stat: # up vs # down revisions in last 30/90 days.
- **Why:** Revisions are the most empirically validated fundamental signal (the entire Zacks Rank is built on it); the chart shows whether the analyst crowd is chasing up or capitulating — pure "momentum of expectations."
- **Data:** Time-series snapshots of consensus (vendor-provided or self-archived daily).
- **Sophistication:** 5 · Deeply institutional; almost nothing else on the page will impress a pro more.

**W26. Consensus range / fan chart (high–avg–low)**
- **Platforms:** stockanalysis forecast charts (revenue & EPS 2026–28 with high/avg/low bands), TradingView (min/max/avg per estimate), AlphaSpread scenarios.
- **What:** Actual history line extending into a shaded forward fan bounded by high and low street estimates, mean line in the middle.
- **Why:** Dispersion is information — wide fan = battleground stock; visually honest about uncertainty instead of a fake-precise single line.
- **Data:** High/low/mean estimates per period.
- **Sophistication:** 4 · Professional.

**W27. Price target slider with analyst distribution**
- **Platforms:** stockanalysis (avg $324 +6.8%, low $215, high $400 layout), TipRanks (avg/high/low + 12-mo chart), WSJ, Yahoo, TradingView analyst price forecast widget.
- **What:** Horizontal bar from street-low to street-high, current price marker and consensus marker with % upside; below it a histogram of individual targets, and a chronological table of recent target changes (analyst, firm, action, new target).
- **Why:** The upside% number is what retail scans for, the distribution + recency table is what pros need (is the consensus stale?); action verbs (raises/cuts/initiates) carry the news.
- **Data:** Individual analyst targets + actions feed.
- **Sophistication:** 3 · Neutral; histogram + action feed pushes professional.

**W28. Recommendation trend stacked bars**
- **Platforms:** stockanalysis (6-month monthly stacked bars of StrongBuy→StrongSell counts), Yahoo, Robinhood (simplified % buy ring), Webull sentiment bar.
- **What:** Monthly stacked/100% bars of rating counts over 6–12 months, showing migration (holds→buys); n analysts labeled.
- **Why:** The *trend* of ratings matters more than the level (perma-buy bias); migration is a slow-motion revision signal.
- **Data:** Ratings counts history.
- **Sophistication:** 2 · Neutral-retail; trend framing adds value.

**W29. Earnings surprise history quad**
- **Platforms:** EarningsWhispers (beat rate vs whisper), Zacks surprise chart, Robinhood (expected-vs-actual EPS dot pairs per quarter — canonical retail treatment), EarningsHub (history of rev & EPS).
- **What:** Last 8 quarters: expected marker vs actual marker per quarter (dots or paired bars), green when beat; summary stats: beat streak, avg surprise %, and — crucially — *price reaction* next day per event.
- **Why:** Prosumers trade the *reaction*, not the beat; pairing surprise with subsequent 1-day move answers "does beating even matter for this name" (many names sell off on beats).
- **Data:** Estimate/actual history + daily bars around events.
- **Sophistication:** 3 (4 with price-reaction column) · The reaction column is the professional differentiator.

**W30. Whisper vs consensus card**
- **Platforms:** EarningsWhispers (canonical: whisper number beside consensus, EW Grade F–A+, EW Score for pre-earnings odds, Power Rating for PEAD).
- **What:** For the upcoming report: consensus EPS, whisper EPS, the gap, plus a letter grade of expected earnings quality and a post-event drift score; historical whisper accuracy shown.
- **Why:** Sets up the event trade — the gap between whisper and consensus is the tradable expectation spread; EW has 25 years of brand equity behind the concept.
- **Data:** Proprietary (EW licenses it); UCT-equivalent: own "expectation gap" from options-implied vs consensus.
- **Sophistication:** 3 · Trader-professional, event-driven.

**W31. Implied move / options-expectation card**
- **Platforms:** EarningsHub (implied move context, IV crush framing), Barchart options tabs, moomoo/Webull options stats; Market Chameleon.
- **What:** "Options price a ±6.2% move by Friday" — implied move from ATM straddle, vs the stock's average historical earnings move (last 8), vs realized after the event; small bar comparing implied vs historical avg.
- **Why:** The single most actionable pre-earnings stat for an options-flow audience (UCT's audience); implied-vs-historical instantly frames rich/cheap.
- **Data:** Options chain (UCT already ingests options flow via Massive) + earnings-move history.
- **Sophistication:** 4 · Professional; perfectly on-brand for UCT's options-flow identity.

**W32. Analyst accountability leaderboard**
- **Platforms:** TipRanks (canonical: each analyst has success rate + avg return; page shows "most accurate analysts covering this stock" cards with photo, star rating, win rate).
- **What:** Ranked cards/rows of the individual analysts on the name, sorted by historical accuracy on *this stock*; their current target highlighted.
- **Why:** Converts anonymous consensus into weighted trust; "the best analyst on NVDA says $210" is a much stronger sentence than "consensus is $195."
- **Data:** Per-analyst historical recommendation performance (vendor or self-computed from actions + bars).
- **Sophistication:** 4 · TipRanks' entire moat; professional-adjacent.

## B5. Ownership & positioning

**W33. Institutional flow delta table (13F deltas)**
- **Platforms:** Fintel (canonical: PrevShares vs LatestShares vs %change per filer, quarterly), moomoo Institutional Tracker, Koyfin ownership tab, Yahoo holders.
- **What:** Table of top institutional holders with columns: shares held, Δ shares QoQ, % of portfolio, value; green/red delta arrows; summary header: total institutional %, # increased vs # decreased positions this quarter.
- **Why:** Turns a static register into a *flow* story — accumulation vs distribution is the CANSLIM "I"; the increased-vs-decreased counter is a one-glance verdict.
- **Data:** 13F aggregation (SEC EDGAR, quarterly, 45-day lag — label the staleness).
- **Sophistication:** 3 · Professional; must display the as-of date prominently or it misleads.

**W34. Ownership composition donut + float math**
- **Platforms:** Simply Wall St (ownership breakdown: institutions/insiders/general public/funds), Webull, moomoo.
- **What:** Donut of insider % / institutional % / retail float %, beside float stats: shares out, float, % float short, insider lockups if recent IPO.
- **Why:** Explains *who can move the stock*; small float + high institutional demand is the squeeze/momentum setup UCT's audience hunts.
- **Data:** Shares outstanding, float, insider/institutional %.
- **Sophistication:** 2 · Neutral; the float-math sidebar makes it trader-grade.

**W35. Short interest gauge + squeeze score**
- **Platforms:** Fintel (canonical: short % float, days-to-cover, borrow fee rate, off-exchange short volume %, proprietary Squeeze Score 0–100), Finviz short ratio cells, stockanalysis Short Interest tab.
- **What:** A compact cluster: % float short as a gauge/bead vs market percentiles, DTC number, borrow-fee trend sparkline (rising fee = tightening), bi-monthly short-interest bar history, and a composite squeeze score.
- **Why:** Squeeze mechanics are a first-class trade thesis for this audience; the *trend* of borrow fee is the leading indicator most sites omit.
- **Data:** FINRA bi-monthly SI, daily borrow/fee (harder, vendor), short volume prints.
- **Sophistication:** 4 · Trader-professional.

**W36. Insider transactions tape**
- **Platforms:** Finviz quote (insider table: who, relationship, date, buy/sell, $, shares), OpenInsider-style cluster detection, Simply Wall St (insider buying section with 12-mo net chart).
- **What:** Chronological table of Form-4s colored buy-green/sell-red with $ size; a 12-month net-insider-activity bar; "cluster buy" badge when 3+ insiders buy within a window.
- **Why:** Insider *buying* clusters are among the few free high-signal events; badges do the pattern detection users would otherwise miss.
- **Data:** Form 4 feed (EDGAR real-time).
- **Sophistication:** 3 · Professional when clustered/annotated, tabloid when raw.

**W37. Smart-money badges / guru holders**
- **Platforms:** GuruFocus (which tracked gurus hold it, buys/sells by guru), TipRanks hedge-fund signal, moomoo institution tracking, WhaleWisdom.
- **What:** Row of famous-fund chips (Berkshire, Renaissance, Druckenmiller…) each with position change arrow; click → that fund's history in the name.
- **Why:** Social proof with names people know; genuinely predictive for some fund cohorts; drives shares/discussion.
- **Data:** 13F parsed + curated fund list.
- **Sophistication:** 2 · Retail-leaning but beloved; keep small.

**W38. Intraday capital-flow module**
- **Platforms:** moomoo (canonical: pie of Large/Medium/Small order net flow + intraday net-inflow curve + multi-day trend), Webull money flow.
- **What:** Classifies tape by trade size, shows net inflow/outflow by cohort intraday and over days/weeks; the "large orders" series is read as institutional intent.
- **Why:** Ties directly to UCT's live options-flow DNA — same mental model (size-classified tape) applied to equities; near-real-time versus 13F's 45-day lag.
- **Data:** Tick/trade tape with size classification (UCT already size-classifies options prints; equities analog exists in Massive feed).
- **Sophistication:** 4 · Professional-trader; a natural UCT-native differentiator no US research page but moomoo/Webull ships.

## B6. Calls & transcripts

**W39. Live/replay call player with synced transcript**
- **Platforms:** Quartr (canonical: live audio + word-by-word real-time transcript; full transcript available at event end), EarningsHub (live + past calls in-app), Koyfin transcripts (9,000+ companies to 2004).
- **What:** Audio player with waveform/progress bar chaptered by call section (prepared remarks / Q&A / per-question); transcript auto-scrolls in sync; click a paragraph to seek audio; speaker labels with roles.
- **Why:** Removes the webcast-portal friction entirely; chaptering by question is the killer detail — pros skip prepared remarks and hunt specific analyst questions.
- **Data:** Call audio + timestamped diarized transcript (vendors: Quartr API, FMP, AssemblyAI on webcast audio).
- **Sophistication:** 5 · Institutional; this is Quartr's whole company.

**W40. Structured AI call summary**
- **Platforms:** Quartr Summaries (consistent structure: financial highlights, management commentary, capital allocation), EarningsHub AI transcript summaries, Robinhood AI digests, fiscal.ai.
- **What:** A fixed-template summary card per call: Results vs expectations · Guidance changes · Key positives · Key concerns · Notable Q&A — each bullet deep-linking to the transcript paragraph (and audio timestamp) it came from.
- **Why:** The fixed template makes summaries comparable across quarters; citation-links solve the LLM-trust problem (click to verify); "guidance changes" is the bullet traders actually open.
- **Data:** Transcript + LLM pipeline with citation anchors (UCT's brain pipeline is well-suited; ground per lesson_llm_market_examples_need_data_grounding).
- **Sophistication:** 4 · Professional if cited, gimmick if not.

**W41. Q&A topic condensation ("Topics")**
- **Platforms:** Quartr Pro Topics (condensed insights from Q&A sessions), fiscal.ai chat-over-transcripts.
- **What:** Q&A section clustered into topics (China demand, margins, buybacks…), each with the analyst question(s), a 2-line answer distillation, and sentiment of management's response; topics recur across quarters so you can track "what did they say about margins the last 4 calls."
- **Why:** The cross-quarter topic thread is the pro workflow (consistency-checking management) that raw transcripts make miserable.
- **Data:** Multi-quarter transcripts + clustering/LLM.
- **Sophistication:** 5 · Institutional.

**W42. Transcript reader with search + keyword hits**
- **Platforms:** Koyfin, Seeking Alpha transcripts, fiscal.ai, TIKR.
- **What:** Clean reading pane, speaker avatars/roles, sticky quarter selector, in-transcript search with hit-count-by-quarter ("'AI' mentioned 47× vs 12× last year"), keyword mention trend sparkline.
- **Why:** Mention-count trend is a beloved alt-data toy with real signal; reading ergonomics (width, type) are cheap wins vs SA's ad-choked reader.
- **Data:** Transcript archive.
- **Sophistication:** 3 · Professional.

**W43. Post-earnings grade / drift score card**
- **Platforms:** EarningsWhispers (Earnings Grade F–A+ on the release quality vs sentiment; Power Rating for likely PEAD), Zacks ESP pre-event.
- **What:** After a report: a letter grade of the print's quality (not just beat/miss — composition, guidance, whisper gap) plus a drift indicator ("conditions historically followed by positive 3-day drift").
- **Why:** Gives the page something opinionated to say in the 48h window when traffic spikes; PEAD is real and monetizable attention.
- **Data:** House model over surprise components + historical drift stats.
- **Sophistication:** 4 · Trader-professional.

## B7. Filings & events

**W44. Filings timeline with type-filter chips**
- **Platforms:** stockanalysis Filings tab, Finviz Filings tab, Koyfin filings, EDGAR full-text UI (raw).
- **What:** Reverse-chron list of SEC filings with colored type chips (10-K amber, 10-Q blue, 8-K red, Form 4 green, 13D/G purple); filter row of chips with counts; each row: type, one-line AI gist ("8-K: CFO resignation"), date, link to doc viewer.
- **Why:** Type-coloring + the one-line gist converts a compliance list into a news surface; 8-K gisting is where the alpha is (material events).
- **Data:** EDGAR feed + light LLM gisting.
- **Sophistication:** 3 (4 with gists) · Professional.

**W45. Next-event countdown card**
- **Platforms:** EarningsWhispers/EarningsHub (canonical: confirmed earnings date, BMO/AMC, countdown, calendar-add), Webull, TipRanks.
- **What:** Card with next earnings date + confirmation status (estimated vs company-confirmed — EW's signature accuracy claim), time slot, conference call time, days-to-go; secondary: ex-div date, splits, investor day.
- **Why:** Date *confirmation status* matters (estimated dates move); this card is the natural alert/watchlist hook ("notify me").
- **Data:** Earnings calendar with confirmation flags (EW licenses; FMP/Zacks have estimated).
- **Sophistication:** 2 · Neutral; confirmation status is the pro detail.

**W46. Corporate events composite feed**
- **Platforms:** Quartr (earnings calls, capital markets days, conferences, M&A calls), Koyfin news+filings merged, Yahoo events.
- **What:** Unified timeline mixing filings, events, dividends, splits, guidance updates, conference appearances — each with icon taxonomy; filterable; past events link to materials (deck PDF, audio).
- **Why:** "Everything the company did" in one stream is the IR-page killer; deck links (Quartr indexes slides) are underserved.
- **Data:** Calendar + filings + IR materials scraping.
- **Sophistication:** 4 · Institutional.

**W47. Dividend history & safety module**
- **Platforms:** Stock Rover dividends report page, stockanalysis Dividend tab, Simply Wall St dividend section (yield vs market bands, payout ratio gauge, 10y DPS bars with cut markers).
- **What:** DPS bar history with increase-streak counter, yield vs 5y-avg band, payout ratio vs safety threshold, next ex-date.
- **Why:** Self-contained answer for income-minded users; streak + cut markers encode reliability instantly.
- **Data:** Dividend history + EPS/FCF payout.
- **Sophistication:** 2 · Neutral-retail; fine as a collapsed module for a trading audience.

## B8. Cross-cutting patterns

**W48. Peer comparison strip/table with percentile shading**
- **Platforms:** Simply Wall St (peers woven through every section), Koyfin Percentile Rank tab (metrics vs sector percentiles), Yahoo compare mode, Finviz peer row, stockanalysis Compare.
- **What:** Header strip of 4–6 peers (logo, price, 1D%, mkt cap) that re-symbols the page on click; inside widgets, key metrics get a "vs peers" bead (P/E 32× — 78th pctile of semis, shaded).
- **Why:** Context-per-metric beats a separate compare page; the percentile bead is one glyph of judgment with zero editorial risk.
- **Data:** Peer mapping + cross-sectional metric percentiles.
- **Sophistication:** 4 · Institutional when percentile-based.

**W49. Red-flags / warning-signs list**
- **Platforms:** GuruFocus (Severe/Medium warning signs: declining margins, issuing debt, insider selling…), Stock Rover Warnings report page, Simply Wall St Risks bullets.
- **What:** Auto-generated list of detected negatives, severity-tiered (severe red / caution amber), each with the triggering value and a link to evidence; count badge surfaces in the page header ("3 warnings").
- **Why:** Asymmetric value — users forgive a missing feature but not a blown-up position; a tool that volunteers bad news earns trust; the badge creates a reason to click through.
- **Data:** Rule engine over fundamentals/ownership/technicals (same infra as W8 checklists).
- **Sophistication:** 3 · Professional; skepticism reads institutional.

**W50. Ticker-scoped AI copilot / generated brief**
- **Platforms:** fiscal.ai (chat grounded in S&P-sourced fundamentals), TipRanks AI report (pros/cons summary), Robinhood digests ("why it moved"), Danelfin explanation layer.
- **What:** Either (a) a generated daily one-paragraph brief at top of Overview — "what's going on with NVDA" citing the day's catalysts — or (b) a chat drawer whose answers cite the page's own widgets/data.
- **Why:** (a) is the highest-read module wherever it ships (Robinhood); grounding in the page's own data keeps it honest and differentiates from generic chatbots.
- **Data:** House data + LLM with citations (UCT brain + wire pipeline is exactly this muscle).
- **Sophistication:** 3–5 depending on grounding · Professional only with citations.

---

## Cross-platform synthesis (what separates pro-feeling pages from clunky ones)

1. **Opinion with an audit trail.** The platforms with cult followings (MarketSurge, Zacks, TipRanks, SWS, EarningsWhispers) all *say something* — a number, grade, or pass/fail — and then show exactly why (Checkup line items, Danelfin signed contributions, SA grade drift). Pages that only display data (Finviz, Fintel, Barchart) get described in reviews as "plain," "dated," "requires work." Pages that opine without evidence read as toys.
2. **Time-derivatives beat levels.** The professional widgets are consistently the *change* views: estimate revisions (Zacks/Koyfin), 13F deltas (Fintel), grade drift (SA), acceleration heat grids (MarketSurge), opinion-change strips (Barchart), borrow-fee trend. Clunky pages show snapshots; pro pages show motion.
3. **One click from any number to its chart, and any claim to its source.** TIKR/Koyfin's chart-icon-per-row, Quartr's transcript-seeks-audio, summary-bullets-linking-to-paragraphs: the interaction grammar of trust. Dead numbers and uncited AI are the two fastest ways to read cheap.
4. **Navigation is a speed feature, not chrome.** Fey's keyboard bar, Bloomberg mnemonics, Koyfin's rail, Yahoo's dock — the pro platforms treat "get to the next view/symbol" as a <1s operation. Reviews praise stockanalysis.com's *speed* above its content.
5. **Session/provenance honesty.** Dual-session prices with timestamps, 13F as-of labels, estimated-vs-confirmed earnings dates — small labels that traders subconsciously use to grade credibility.

## Notes for UCT specifically

- The 7-tab structure maps cleanly onto **A3 (left rail) + A11 (score-first Overview) + A8/A9 (sticky header + Cmd-K)**: keep the 7 domains as rail sections, make Overview a verdict-led curated grid (A2/A7 hybrid), promote Ratings from "tab 4" to the page's crown.
- Options-flow DNA is the unfair advantage: **W31 implied move** and **W38 size-classified flow** exist on no US research competitor's ticker page; both are buildable from Massive data already flowing.
- W7/W8 (0–99 composite + pass/fail checklist) is the direct MarketSurge counterattack, and W25 (revision momentum) + W29-with-reaction are the EarningsWhispers/EarningsHub counterattack.
- Dark-theme fit: the institutional-reading widgets here (heat grids, percentile beads, fan charts, rails) are all dense-and-dark native; the retail-reading ones (snowflakes, donuts, big dials) need restraint or omission.
