# Current UI Inventory — Earnings Quick-Peek Modal + Research Page

Worktree: `C:\Users\Patrick\uct-worktrees\research-redesign` (clean `origin/master`)

## Surface 1 — EarningsModal (quick-peek)

**Files:** `app/src/components/tiles/EarningsModal.jsx` (671 lines) · `EarningsModal.module.css` (737 lines)

### Trigger path from Calendar

- `app/src/pages/Calendar.jsx:490` — `onSelect(entry, timing)` builds `{ row: toModalRow(entry), label: timingLabel(timing), reportDate: entry._ds, timing }` into `selected` state; rendered at `Calendar.jsx:635` inside an `<ErrorBoundary key={selected.row.sym}>`.
- Normalizer: `app/src/pages/calendar/earningsModalRow.js` — `toModalRow()` maps `eps_act/eps_est/rev_act/rev_est` → `reported_eps/eps_estimate/rev_actual/rev_estimate` + computes `surprise_pct` strings (`"+4.1%"`), and derives `verdict` (`beat|miss|mixed|pending|reported`). `timingLabel()` → `BEFORE MARKET OPEN | AFTER MARKET CLOSE | TIME TBD`.
- `onSelect` is fanned down to every clickable row/card: `FeedView.jsx:194,231` (PrintTape rows, CompactCluster chips), `CalendarDayTable.jsx:55` (dense day table `Row`), `EarningsCard.jsx:75` (feed card), `MainEventCard.jsx:54`, `WeekView.jsx:36` (`wrow`) + `EarningsTile.jsx:15` (logo tile), `TodaysBrief.jsx:112,140`, `DayDetailDrawer.jsx:36-53`.
- Second mount point: `app/src/pages/calendar/MyStocksHub.jsx:445` (same modal, own state). Third: `app/src/components/tiles/CatalystFlow.jsx:147`.
- Modal is **not routed** — pure state, no URL, no deep link, no browser-back close.

### Widget inventory (26 regions, top → bottom, single scroll column)

| # | Region | Renders | Data source | Styling |
|---|---|---|---|---|
| 1 | Backdrop | click-to-close overlay | — | `.backdrop` `rgba(0,0,0,.88)` + `backdrop-filter: blur(6px)`, `z-index: var(--z-modal)` |
| 2 | Modal shell | `min(720px, 100vw-32px)`, `max-height: calc(100vh-48px)`, `overflow-y:auto`, flex col `gap:14px`, `padding:20px` | — | `.modal` — **`background:#111612` hardcoded** (not `--bg-surface`), `border-radius:10px` (off-scale), `z-index:1001` literal |
| 3 | Header | `CompanyLogo size={38} tile` + ticker (22px, `--ut-cream`, ls 1px) + "Add to calendar" ICS link + `×` close | `/api/ticker-logo/{sym}`; ICS = `/api/calendar/report.ics?sym&date&timing` | `.header/.sym/.addCal/.close`; addCal uses `var(--ut-gold, #c9a84c)` + `rgba(201,168,76,.4)` border, `radius:7px` |
| 4 | Badge row | `EARNINGS REPORT` eyebrow + session pill (`label` prop) | prop from `timingLabel()` | `.badges/.badge/.badgeTime` — 9px, ls 1.5px; pill always uses **`--gain`/`--gain-bg`** green even for TIME TBD |
| 5 | Metrics table | 4 cols METRIC/EXPECTED/REPORTED/SURPRISE × 2 rows (EPS, REVENUE). `fmtEps` → `$1.23`; `fmtRev` → `$1.24B` / `$412M` | `row` prop (calendar entry) | `.table` — th 9px muted, td 10px padding, `td:first-child` 10px uppercase; surprise colored by naive `String.startsWith('+')` |
| 6 | Verdict banner | `Beat — EPS $x vs $y est (+z%)`, `~ Mixed`, `Miss` + UIcon check/x | derived from `row.verdict` | `.summary` + `.summaryBeat/.summaryMiss/.summaryMixed`; mixed variant uses raw `rgba(255,255,255,.03)` |
| 7 | Stats strip A | `EXPECTED MOVE` (Options ±x.x% · Hist avg ±y.y% (Nq)), `RUN-IN` (label), `REVISIONS` (arrow + label, colored by `delta_90d`) | `/api/earnings-analysis/{sym}` (30s abort timeout) | `.statsStrip/.statRow/.statLabel(min-width:110px)/.statVal` |
| 8 | AI Preview box (pending) | `EARNINGS PREVIEW` badge + 2-sentence `_gist()` + "Read full preview ▾" + `THINGS TO WATCH` bullets + NewsList | `/api/earnings-analysis/{sym}` `preview_text`/`preview_bullets`/`news` | `.previewBox` — `border-left:2px solid #c9a84c` **hardcoded**, `rgba(201,168,76,.06)` |
| 9 | AI loading | spinner + "Generating preview…" / "Analyzing earnings…" | same | `.aiLoading/.aiSpinner` (10px, 0.8s spin) |
| 10 | Trend block | `YoY EPS +x%` chip + **beat-magnitude bars** (4px wide, height `4–18px`, magnitude clipped at 30%, oldest→newest) + streak text; fallback = ✓/✗ UIcon row | `beat_surprises[]` / `beat_history[]` / `beat_streak` from earnings-analysis | `.trend/.beatBars/.beatBarPos(#3cb868)/.beatBarNeg(--loss)`, inline `style={{height}}` |
| 11 | Gap row | `↑ Gap +2.31%` centered | `/api/snapshot/{sym}` → `change_pct` | `.gap` + `.pos/.neg` |
| 12 | "Company detail" toggle | full-width left-aligned button, "Company detail — analyst · ownership · fundamentals ▾" | — | `.moreToggle` — `var(--border, rgba(...))`, **`var(--text-dim,#9aa0ab)` and `var(--gold,#c9a84c)` are NON-EXISTENT tokens** → always fall back |
| 13 | AnalystPanel | consensus rating + Buy/Hold/Sell counts + 3-segment bar; price-target low/avg/high + range track w/ current marker + upside %; recent rating-change rows (▲▼◆• glyph + firm + grades + PT + date + link icon); skeleton loader | `useAnalystIntel` → `/api/analyst-intel/{sym}` | `AnalystPanel.module.css` (47 lines, **0 media queries**) |
| 14 | OwnershipPanel | inst % (clamped `>100% (incl. derivatives)`) + as-of date; top-holders `<table>` (holder/shares/%out/value/delta chip NEW,+ADD,−CUT,SOLD); Biggest buyers / Biggest sellers two-column | `useOwnership` → **`/api/ownership/{sym}`** (different endpoint from the research tab's) | `OwnershipPanel.module.css` (18 lines, 0 media queries) |
| 15 | FundamentalsStrip | 6 label/value items: Mkt Cap · Fwd P/E · Beta · 52W Range · Avg Vol · Div Yield | `/api/fundamentals/{ticker}` | `.strip` `rgba(255,255,255,.02)`; labels 8px/ls1.2/opacity .7, values 11px |
| 16 | SentimentGauge | `EARNINGS SENTIMENT` + label pill + signed score + center-origin bar (−1..+1 → 0..100) + Bearish/Neutral/Bullish ticks + rationale + drivers `<ul>` | `useSentiment` → `/api/earnings/sentiment/{ticker}` | `SentimentGauge.module.css` (120 lines, 0 media queries); bar fill via inline `style={{width, left|right:'50%'}}` |
| 17 | CallRecapSection | Biggest sub-widget (415-line CSS): header + 🔊 Listen TTS toggle; keyword `<input>` + clear ×; headline; sentiment badge; GUIDANCE RAISED/LOWERED/MAINTAINED chip; KEY POINTS bullets; GUIDANCE block; MANAGEMENT QUOTES; Q&A HIGHLIGHTS; RATING CHANGES list; native `<audio>` player or "Listen live ↗"; **FULL TRANSCRIPT** collapsible (lazy) with per-segment speaker/title/sentiment + its own TTS button; `<mark>` keyword highlighting throughout | `useCallRecap` → `/api/earnings/call-recap/{sym}`, `useEarningsAudio` → `/api/earnings/audio/{sym}`, `useTranscript` (lazy) | `CallRecapSection.module.css`, **0 media queries**. Note typo class `.webcástLink` |
| 18 | SEC Filings | `SEC FILINGS` label + ≤5 grouped rows: plain-language label (`Insider trade (Form 4) ×9`) + date + `↗`; deduped + same-form-same-day collapsed | `useFilings` → `/api/filings/{sym}?count=10` | `.filingsSection/.filingItem/.filingForm(--gain green)/.filingDate/.filingArrow` |
| 19 | Stats strip B | `HIST REACTIONS` avg ±x.x% over N · up k/N; `PLAYBOOK` biggest +x% · −y% over last N prints | `row.hist_stats` (calendar enrichment) | reuses `.statsStrip` — visually identical to #7 but a different concept, 12 sections apart |
| 20 | AI Analysis box (reported) | headline + summary + `KEY TAKEAWAYS` bullets (or legacy paragraph fallback) + NewsList | `/api/earnings-analysis/{sym}` | `.analysisBox` — same gold left-border recipe as `.previewBox`, duplicated |
| 21 | NewsList | per item: `SOURCE · time` eyebrow (8px, ls 1.5) + headline in `var(--info,#5ba3f5)` | earnings-analysis `news[]` | `.newsList/.newsItem/.newsItemSource/.newsItemHeadline` |
| 22 | TweetsBlock | collapsible "💬 Recent tweets (N)" (auto-expanded ≤5) + tweet cards: `@handle`, timeAgo, `↗`, cashtag-gold text, RT rows dimmed via **inline `{fontSize:'90%',opacity:.75}`** | `useTickerTweets(sym,{hours:24})`; gated by `VITE_TWITTER_UI_ENABLED` | `.tweetsBlock` `rgba(201,168,76,.04)`, `margin:12px 8px 8px` (asymmetric vs everything else) |
| 23 | Transcript section | **Second, independent transcript UI**: collapsible `EARNINGS CALL TRANSCRIPT` + `Q3 2026` + BULLISH/BEARISH/NEUTRAL pill; body = headline + `ReadAloudButton` + bullets | `/api/transcripts/{sym}` (fetched only when opened, 25s abort) | `.transcriptSection/.transcriptToggle/.sentimentBull/Bear/Neutral/.transcriptBody` |
| 24 | Transcript loading | "Loading transcript…" 10px opacity .5 | same | `.transcriptLoading` |
| 25 | Key quotes | `LAST CALL — KEY QUOTES` + `topic: "quote"` italic list | earnings-analysis `key_quotes[]` | `.quotesSection/.quoteList/.quoteTopic/.quoteText` |
| 26 | Actions footer | `View Chart` (TickerPopup as button, green) + `Open full report →` / lock-icon `Unlock full research →` → `navigate('/research/{sym}')` | `useAuth().isPaid` | `.actions/.btnChart(gain)/.btnReport(--ut-gold)` |

**Modal effects:** body-scroll lock on mount; Escape key close; three independent `fetch` effects keyed on `row.sym` (snapshot, earnings-analysis w/ AbortController, transcript gated on open).

**Mobile:** ONE `@media (max-width:640px)` block (`EarningsModal.module.css:723-737`) — 44px close button, badge 9→10px, news 8→9/10→11px, `.btnChart` padding 12px, `.actions` stacks. **Untouched on phone:** the 4-column metric table, `.statLabel{min-width:110px}` (crushes `.statVal`), tweet cards, transcript header, all 5 imported sub-panels (0 media queries between them). No tablet (641–1024) rules anywhere.

---

## Surface 2 — Research page (`/research/:sym`)

**Files:** `app/src/pages/research/` — `ResearchPage.jsx` (60 lines), `ResearchHeader.jsx`, `RatingBadges.jsx`, `PaywallTeaser.jsx`, `ResearchPage.module.css` (**137 lines, one-line rules, styles the entire page + all 7 tabs**), `tabs/` (8 files), `hooks/` (7 files). Route: `App.jsx:269`, lazy-loaded.

**Composition:** `useResearchOverview(sym)` fans out to 4 endpoints + live prices; `useRatings(sym)` feeds the header badges; each tab owns its own hook. Non-paid users get **only** `PaywallTeaser` — no header, no teaser data.

### Widget inventory (38 regions)

**Shell / header (top)**

| # | Region | Renders | Data | Styling |
|---|---|---|---|---|
| 1 | `.page` | `padding:18px 22px 26px`, `overflow-y:auto`, `background:var(--bg)` | — | one-liner |
| 2 | Header identity | `CompanyLogo size={52}` + `AAPL · Apple Inc.` (18px/800 + 14px/600 inline) + `NASDAQ · Technology · Consumer Electronics` (11px muted) | `/api/ticker-meta/{sym}` | `.hdr/.hdrId/.hdrName/.hdrCo/.hdrSub`, flex-wrap, bottom border |
| 3 | RS badge | IBD-style 1–99 chip, 4 tiers | `/api/rs-rankings/{sym}` | `RsBadge.module.css` |
| 4 | Price block | `$256.50 ▲1.80%` (18px/800) | `useLivePrices([sym])` (15s poll) | `.hdrPx/.hdrPxBig/.up/.down` |
| 5 | SymbolSearch | predictive ticker dropdown → `navigate('/research/{S}')` | `/api/ticker-search` | `.hdrSearch` |
| 6 | RatingBadges strip | 8 chips: UCT Composite (hero, gold gradient) + EPS · Rel Strength · Growth · Value · SMR · Acc/Dis · Sponsorship. 8px label / 16px value, `—` when null | `/api/research/ratings/{sym}` | `.ratings/.rb/.rbHero(linear-gradient gold)/.rbLbl/.rbVal` |
| 7 | Tab bar | 7 buttons, `overflow-x:auto`, active = gold-dim bg + gold border | local `useState` (no URL state) | `.tabs/.tab/.tabOn` |
| 8 | PaywallTeaser | glass card: "Unlock {sym} Research" (22px gold), sub-paragraph, 4-item UIcon list, "Upgrade to unlock →" → `/settings?section=billing` | `useAuth().isPaid` | `.paywall/.paywallGlass(radius 16px, --shadow-lg)/.paywallCta(radius 9px, color #1a1c17 hardcoded)` |

**Overview tab** (`OverviewTab.jsx`)

| # | Region | Notes |
|---|---|---|
| 9 | FundamentalSnapshot card | Whole nested widget: name/sector header, next-earnings chip, `Percentile · N` / `Absolute v1` basis pill, **composite hero + 4 numeric boxes w/ meters + 3 letter boxes**, Sector RS row, data-box grid, Stock Checkup list, skeleton loader. Source `useFundamentalSnapshot` → `/api/fundamental-snapshot/{sym}`. **Duplicates region 6 and the entire Ratings tab.** |
| 10 | Chart card | `StockChart tf="D" height="100%"` with `showDrawingTools=false, hideReplay, hidePatterns, hideCompare, hideCountdown, showVolume, volumeSeparatePane`; `.ovChart{height:300px}` → 240px @640 |
| 11 | "Latest report" table | 4-col Metric/Est/Actual/Surp × EPS + Revenue. **`row` is hardcoded `null` at `ResearchPage.jsx:51` → this card is permanently all `—`.** |
| 12 | "Key stats" | 5 `.kv` rows: Mkt cap, Fwd P/E, Beta, Div yield, 52-wk range. `/api/fundamentals/{sym}` |
| 13 | "Analyst view" | Consensus `Buy 37 · Hold 8 · Sell 1`, Target `low — **mean(gold)** — high`. `/api/earnings/intel/{sym}` |
| 14 | "AI snapshot" | one paragraph, fallback copy "Earnings analysis will appear here once available." `/api/earnings-analysis/{sym}` |
| — | Layout | `.ovWrap` column gap 10px; 11-14 in `.grid` = fixed `1fr 1fr` → 1 col @640 |

**Financials tab** (`useFinancials` → `/api/research/financials/{sym}`)

| # | Region | Notes |
|---|---|---|
| 15 | Quarterly GrowthGrid | 8 cols: Period, Revenue, Rev YoY, EPS, EPS YoY, Gross, Op, Net. `.gridScroll{overflow-x:auto}` |
| 16 | Annual GrowthGrid | same 8 cols |
| 17 | Balance sheet | 5 `.kv`: Cash, Total debt, Debt/equity, Current ratio, FCF |
| 18 | Profitability | 5 `.kv`: ROE, ROA, Gross/Operating/Net margin |
| 19 | States | loading reuses `.soon` (280px centered); `.fnote` "Statement history is unavailable" |
| — | Heat cells | 4 classes: `.heatPos2` ≥25% `rgba(60,184,104,.30)` + `#c8f4d8`; `.heatPos1` >0; `.heatNeg1` <0; `.heatNeg2` ≤−25% `rgba(231,76,60,.30)` + `#f6cdc8`. Raw rgba, not tokens. `.fgrid tbody tr:nth-child(even)` zebra |

**Estimates tab** (`/api/research/estimates/{sym}`)

| # | Region | Notes |
|---|---|---|
| 20 | Analyst consensus | label (18px, colored by regex on `buy|outperform|overweight`) + N analysts + **5-segment stacked bar** (10px tall, all geometry in inline styles, segment colors from `var(--ut-green-bright/--ut-green/--text-muted/--ut-red/--ut-red-bright)`) + count legend |
| 21 | Price target | 3 inline-flex columns: Consensus (20px), Range, "Last month avg (N)" via `ptRecency()` |
| 22 | Forward estimates | 6-col grid: Period, EPS avg, Range, Analysts, EPS growth, Revenue |
| 23 | EPS revisions | 6-col grid: Period, Current, 30d ago, 90d ago, ↑30d, ↓30d |
| 24 | Rating changes | `.rclist/.rcrow` CSS grid `88px 1fr auto auto`: date · firm (ellipsis) · `Buy → Strong Buy` · action (regex-colored) |
| 25 | Empty | `.fnote` "Estimate data is unavailable for this ticker." |

**Ratings tab** (`/api/research/ratings/{sym}`)

| # | Region | Notes |
|---|---|---|
| 26 | Composite hero | **46px/900** number colored by `scoreColor()` + "UCT Composite Rating" + "0–99 · higher is stronger" |
| 27 | Rating grid | `repeat(auto-fill, minmax(140px,1fr))`; 4 numeric cards (24px value + 5px meter, `width:${v}%`) + 3 letter cards (no meter) |
| 28 | Stock Checkup | `.checkRow` grid `22px 1fr auto`: UIcon check/x/`–` + label + value |
| 29 | Method footnote | `.fnote` |
| — | Colors | `scoreColor` bands 80/60/40/20 → `#3cb868/#7fb84e/#c9a84c/#e08a3c/#e74c3c`; `letterColor` A–F. **Byte-identical duplicates of the functions in `FundamentalSnapshot.jsx`.** All applied as inline `style={{color}}` |

**Ownership tab** (`/api/research/ownership/{sym}`)

| # | Region | Notes |
|---|---|---|
| 30 | Institutional ownership | `% held` kv + holders table (Holder/Shares/%Out/Value), `.holderName{max-width:170px}` ellipsis |
| 31 | Short interest | 5 `.kv`: Short % float, Days to cover, Shares short, Float, Shares outstanding |
| 32 | Form 13F | quarter suffix; 3 summary stats with ±pp / ±int deltas (all layout inline-styled); position-flow chip row (new/increased/reduced/closed); top-holders table with Δ Shares + `NEW`/`SOLD` 9px tags |
| 33 | Insider activity | `.insrow` grid `88px 1fr auto auto auto`: date · name · title · buy/sell · shares · amount |
| 34 | Empty | `.fnote` |

**Calls & Transcript tab**

| # | Region | Notes |
|---|---|---|
| 35 | SentimentGauge | same component as modal region 16 |
| 36 | CallRecapSection | same component as modal region 17 — **but fed `recapData?.recap` here vs `recapData` in the modal**, so the two surfaces unwrap the payload differently |
| 37 | States | "Loading earnings call recap…" / "No earnings call recap is available yet" (`.fnote`) |

**Filings & Events tab**

| # | Region | Notes |
|---|---|---|
| 38 | SEC filings card | `.filingRow` grid `72px 1fr auto`: raw form code (gold) · date · `View →` link. **No plain-language labels, no dedupe, no grouping** — the modal (region 18) does all three. Loading/empty `.fnote` |

**Dead code:** `tabs/ComingSoonTab.jsx` is no longer imported by `ResearchPage.jsx`.

**Mobile:** two `@media (max-width:640px)` blocks in `ResearchPage.module.css` — (a) `.ovChart` 300→240px, (b) page padding 14/12/80, `.grid`→1 col, `.hdrPx` unfloats, `.tabs` edge-to-edge scroller with `--tap-min` tabs + hidden scrollbar, `.rb` min-width 58px, paywall full-width CTA. **Not handled:** the 8-column financial/estimate grids only get `overflow-x:auto` (no frozen first column, no scroll affordance) despite `components/mobile/ResponsiveTable.jsx` existing; `.rcrow`/`.insrow`/`.filingRow` fixed-px grid columns are unchanged on phone; `.compNum` stays 46px; no tablet tier.

---

## Shared design language

**Tokens** (`app/src/styles/tokens.css`, 387 lines; imported by `index.css` alongside `breakpoints.css`; `App.css` is dead Vite boilerplate).

- **Palette (dark default):** warm olive-black canvas `--bg #0e0f0d` → `--bg-surface #1a1c17` → `--bg-elevated #22251e` → `--bg-hover #2a2d24`; borders `--border #2e3127` / `--border-accent #3a3d32`.
- **Text ramp (warm sand, not grey):** `--text #b6b09d`, `--text-muted #8c8674`, `--text-bright #e0dac8`, `--text-heading #f0ead8`, `--ut-cream #d4c9a8`.
- **Accents:** brand gold `--ut-gold #c9a84c` (+`-dim #c9a84c15`, `-glow #c9a84c35`, aliased as `--accent`); green `--ut-green #2d8c4e` / `--ut-green-bright #3cb868`; red `--ut-red #c0392b` / `--ut-red-bright #e74c3c`. Semantic pairs `--gain/--gain-bg/--gain-border`, `--loss/*`, `--warn/*`, `--info #6ba3be`. A separate theme-invariant `--menu-*` palette for popovers.
- **Type:** ONE family — `'Instrument Sans'` deliberately aliased across `--font-sans`, `--font-mono`, `--font-display`, `--font-heading` (tokens.css:88-95 explicitly forbids repointing `--font-mono` to a real mono stack). Scale `--text-xs 10 → --text-3xl 24` with a phone comfort bump (@640: xs 11, sm 12, base 13, md 14). Line heights 1.2/1.4/1.6; letter-spacing `--ls-label 1.5px` for eyebrows. Global utility classes `.t-page-title / .t-section-title / .t-label / .t-body / .t-caption / .t-mono`.
- **Geometry:** radii 4/6/8/12; spacing 4/8/12/16/24/32/48; canonical control geometry `--control-pad-y 9px / -x 12px / radius 8px / font 13px`; shadows sm/md/lg/`--shadow-modal`/`--shadow-popover`; z-scale to `--z-modal 1000`; `--tap-min 44px`.
- **Themes:** `[data-theme]` = oled / dim / light. The light theme's own comment warns "roughly half the app's colors are hardcoded hex/rgba in .module.css files and will stay dark on white" — both of these surfaces are in that half.
- **Breakpoints:** only 640 and 1024 are legal (`styles/breakpoints.css` + `.js`); utilities `.hideOnPhone/.showOnPhone/.hideOnTouch/.touchTarget/.hoverReveal`.
- **Polished reference surfaces:** `TileCard.jsx/.module.css` is the house card — `--bg-surface`, `border-radius:12px`, a gradient green→gold→green 2px left spine at 30% opacity, 10px/600/ls-1.5 uppercase title with a gold UIcon, 10px 14px 10px 18px header, `--gain` badge pill. `MorningWire.module.css` uses container queries (`container-name: mw`, 3-pane at ≥1280px), gold 10px/ls-3px rail labels, 16px gaps, 900px reading column. `Dashboard.module.css` composes with `var(--space-*)` tokens and `--radius-xl`. `OptionsFlow.module.css` is a 6-line stub (that page is ~7k lines of inline styles, partner-owned).
- **Iconography:** `components/ui/UIcon.jsx` (~65 gold-embossed inline SVGs) is the mandated system; no emoji.

## Charting / viz libraries available (`app/package.json`)

`lightweight-charts ^5.1.0` (house chart engine, `StockChart.jsx`) · `echarts ^6.0.0` + `echarts-for-react ^3.0.6` (breadth, journal analytics, treemaps) · `recharts ^2.15.4` (SVG; `index.css` pins `.recharts-text` to `--font-sans`) · `chart.js ^4.4.0` + `react-chartjs-2 ^5.2.0` (COT only — do not replace) · `@tanstack/react-virtual ^3.13.24` (installed, currently unused) · `react-grid-layout ^1.5.3` · `swr ^2.4.0` · `react 19.2` · `tippy.js`, `papaparse`, `@dnd-kit/*`, `@tiptap/*`. **No d3.** Neither research surface currently renders any chart except the single Overview `StockChart` — all trends are text, tables, or hand-rolled `<span>` bars.

---

## Top 10 clunkiest things

1. **`row={null}` is hardcoded** at `ResearchPage.jsx:51`, so Overview's "Latest report" card renders `— — —` for every ticker, forever. A dead widget on the flagship tab.
2. **UCT ratings render three different ways on one page**: the header `RatingBadges` 8-chip strip, `FundamentalSnapshot`'s composite hero + 7 boxes + meters inside the Overview card, and the whole Ratings tab (46px hero + auto-fill card grid). Same numbers, three visual languages.
3. **`scoreColor()`/`letterColor()` are copy-pasted byte-for-byte** between `RatingsTab.jsx` and `FundamentalSnapshot.jsx`, and applied as inline `style={{color}}` — five ad-hoc hexes (`#3cb868 #7fb84e #c9a84c #e08a3c #e74c3c`) that exist nowhere in tokens.css. Heat cells add four more raw `rgba()`s.
3. **`ResearchPage.module.css` is 137 lines of single-line rules for an entire 7-tab page** — one `.card`, one `.ct`, one `.tbl`, one `.fgrid` shared by everything, no per-tab modules, no visual hierarchy beyond "card with a 9px uppercase label".
5. **Layout lives in JSX**: EstimatesTab's consensus bar and price-target row, OwnershipTab's whole 13F block, and RatingsTab's meters are built from inline `style={{display:'flex', gap:28, fontSize:20…}}`. Nothing is themeable or responsive.
6. **Broken token references** in `EarningsModal.module.css`: `var(--gold, #c9a84c)`, `var(--text-dim, #9aa0ab)`, `var(--ut-green-bright, #3cb868)` — `--gold` and `--text-dim` don't exist, so those always resolve to the hardcoded fallback, and `.modal{background:#111612}` bypasses `--bg-surface` entirely. The light theme cannot reach this modal.
7. **Two independent transcript UIs inside one modal** (`CallRecapSection`'s lazy "FULL TRANSCRIPT" from AlphaVantage + the modal's own "EARNINGS CALL TRANSCRIPT" from `/api/transcripts/{sym}`), plus `.statsStrip` reused for two unrelated concepts 12 sections apart, plus rating-change lists rendered three different ways (`AnalystPanel.ActionRow`, `CallRecapSection.RatingChanges`, `EstimatesTab.rcrow`).
8. **The modal is a 26-section single scroll column with no chrome** — no sticky header, no fixed footer, no tabs. The two primary CTAs ("View Chart", "Open full report") sit at the very bottom, after AI essays, tweets, transcripts and quotes. Body-scroll lock is the only concession.
9. **Typography has no system**: 8, 9, 10, 11, 12, 12.5, 13, 14, 16, 18, 20, 22, 24, 46px across the two surfaces; ~30 rules invoke `var(--font-mono)` that resolves to a proportional sans; not one numeric column sets `font-variant-numeric: tabular-nums`, so every price/percent column mis-aligns. The `--text-*` scale and `.t-*` utilities are used by neither surface.
10. **Mobile is a patch, not a plan**: the modal has one 640 block (close button + 3 font sizes + stacked buttons) and its five imported sub-panels have **zero** media queries between them; the research page has two 640 blocks, leaves 8-column grids as bare `overflow-x:auto` with no frozen column (while `ResponsiveTable.jsx` sits unused), keeps fixed-px grid columns on `.rcrow`/`.insrow`/`.filingRow`, and neither surface has any 641–1024 tablet handling. Bonus: `.tbl` cells are `3px 4px` and `.fgrid` `4px 8px` — different densities for identical-looking tables — and loading states use five different idioms (spinner box, `.soon` 280px empty-state, `.fnote` text, skeleton rows, ellipsis).

---

## Notable cross-surface facts for the redesign

- `ComingSoonTab.jsx` is dead code.
- `CallRecapSection` is fed `recapData` in the modal but `recapData?.recap` in CallsTab (payload unwrapped differently).
- The Filings tab shows raw form codes while the modal shows deduped plain-language labels — the modal is strictly better at the one thing they share.
- The modal's OwnershipPanel uses `/api/ownership/{sym}` while the research OwnershipTab uses `/api/research/ownership/{sym}` — two different endpoints for the same concept.
