# Research Page + Earnings Modal Redesign — Design Spec

**Date:** 2026-08-03
**Status:** Approved in visual-companion brainstorm (10 screens, owner-selected); awaiting final spec sign-off
**Branch:** `feat/research-calendar-redesign` (worktree `C:\Users\Patrick\uct-worktrees\research-redesign`)
**Research base:** `docs/superpowers/research/2026-08-03-research-calendar-redesign/` — 01 current inventory (64 regions), 02 earnings-event UX (50 patterns/28 platforms), 03 research-page UX (12 paradigms + 50 widgets/33 platforms), 04 dataviz patterns (33 patterns + library eval), 05 backend data options (~30 endpoints + 6 gaps)

## 1. Problem

Clicking a stock on the Calendar opens `EarningsModal` — 26 sections in one unstructured scroll with both CTAs at the bottom, two duplicate transcript UIs, broken design-token references, a hardcoded `#111612` background, and no URL state. `/research/:sym` is 7 flat tabs sharing 137 lines of one-line CSS, renders UCT ratings three different ways, has a permanently-dead "Latest report" card (`row={null}` at `ResearchPage.jsx:51`), and draws zero charts outside the single price chart. Neither surface uses the app's type scale or `tabular-nums`. The owner wants both surfaces "smooth and aesthetic … more professional."

## 2. Design north stars (owner-approved)

1. **Glass Premium register** — elevated translucent cards, soft gold accents, restrained glow, clean stat tiles (Screen 1 choice D).
2. **Cleanest navigation + profound information** — an opinion with an audit trail: verdict chips backed by evidence widgets; time-derivatives (revisions, deltas, drift) over static levels; micro-provenance (as-of timestamps, session labels) everywhere.
3. **One visual system** — modal and page share components; the modal is the page in miniature; "Open full report" feels like the modal expanding.

## 3. System foundations

### 3.1 Tokens (extend `app/src/styles/tokens.css`)
- **New score tokens:** `--score-elite/-strong/-neutral/-weak/-poor` (replacing the 5 copy-pasted hexes in `scoreColor()`), plus letter-grade aliases.
- **Heat-grid tiers:** promote the Breadth `bgG3…bgR3` rgba ladder to tokens (`--heat-g3…--heat-r3`) and reuse in financial grids.
- **Glass surfaces:** `--glass-surface` (rgba(34,37,30,.55)), `--glass-elevated`, `--glass-border` (rgba(201,168,76,.22)), `--glass-inner-glow`. Backdrop-filter usage limited to the modal backdrop (perf).
- Fix all broken references: `--gold`, `--text-dim` do not exist — replace with `--ut-gold`, `--text-muted`. No hardcoded surface hexes.

### 3.2 Typography
- `font-variant-numeric: tabular-nums` on every numeric cell/column (new utility `.t-num`).
- Both surfaces adopt the existing `--text-*` scale + `.t-*` utilities; the 13 ad-hoc sizes collapse to the scale. Eyebrow labels: 10px/600/`--ls-label` uppercase, consistently.

### 3.3 Color grammar
- Green/red = **realized** outcomes only. Hollow/grey = **expectations** (estimates, implied). Gold = brand verdicts/accents. `--info` for links. Session-state colors on live prices (regular vs pre/post label).

### 3.4 Component library (new, `app/src/components/research-kit/`)
`GlassCard` · `StatTile` · `VerdictChip` · `EyebrowLabel` · `ConsensusBar` · `RangeSlider` (52-wk + PT + expected-move dollar strip) · `LollipopChart` · `ReactionBars` · `RevisionColumns` · `ImpliedVsRealized` · `RatingCrown` (ring + component chips) · `CheckupRow` · `HeatGrid` · `RatingChangeList` · `SkeletonBlock` (THE one loading idiom — today there are five). Every component: CSS module, tokens only, no inline layout styles, phone + tablet rules in-module.
- **Chart rendering:** plain SVG/CSS for meters/strips/sliders/dots; ECharts via `echarts/core` tree-shaken imports for lollipop/columns/histogram (this also executes the backlogged echarts bundle-shrink); lightweight-charts for anything sharing the price axis (expected-move band, earnings markers). **Zero new dependencies.**

## 4. Surface 1 — Earnings Modal

### 4.1 Structure
Two-pane glass modal, `min(960px, 100vw−32px)`: left rail (nav + section state) switches the right canvas per section. No global scroll column. Pinned glass banner above both panes; pinned footer below.

### 4.2 Banner (pinned)
Logo · ticker + company + sector · report timing line · live price (15s poll, session-aware) · **verdict grade chip**.
- Timing line pre-report: `Reports tonight AMC · confirmed · call 5:00 PM ET` + live countdown. `confirmed|estimated` from the calendar feed.
- **Post-report flip:** timing line becomes the result: `Beat $0.98 vs $0.94 · guidance raised · +4.2% AH`. Pure data, no LLM.
- Verdict chip = computed grade (A+…F) from: beat streak, revision direction 30d, RS rank, IV premium rich/cheap. Deterministic arithmetic on data already fetched; formula documented in code; tooltip shows the four inputs (audit trail).

### 4.3 Rail sections (6)
1. **Setup** (default) —
   a. `ImpliedVsRealized` hero: 8 paired bars (hollow = implied at the time, solid = realized, green/red by close direction), current quarter's hollow bar highlighted; `VerdictChip` "PREMIUM RICH/CHEAP — priced ±x%, moves ±y% avg". Dollar break-even `RangeSlider` beneath.
   b. `ReactionBars`: next-day move bars + beat/miss dot row, tonight's implied ± as a gold dashed bracket overlay; beat-but-sold-off quarters starred; caption row of `StatTile`s (AVG MOVE · CLOSED UP n/8 · BEST · WORST).
   c. Key-stats strip (mkt cap · fwd P/E · beta · 52-wk `RangeSlider` · avg vol · div yield).
2. **Earnings History** — `LollipopChart` (hollow estimate dot + whisker, solid actual dot, dashed next-quarter estimate) side-by-side with the compact quarterly table (ACT/EST · SURPRISE · REV · NEXT-DAY); streak chips caption ("7/8 BEATS · AVG SURPRISE +4.2%"). Table stacks under the chart on phone.
3. **Brief** — ALL prose lives here: AI preview (pre) / analysis (post) with headline + bullets, key quotes, news list. Provenance line ("AI · updated 2:10 PM"). Reuses existing cost-guarded endpoints; no new LLM surface.
4. **Analyst & Ownership** — twin `GlassCard` panels. Left: `ConsensusBar` + counts, PT `RangeSlider` with upside %, `RevisionColumns` mini (90d up/down + "21↑/3↓" chip), `RatingChangeList` (≤3, latest). Right: institutional % + q/q delta, short % float + DTC, 13F flow chips (NEW/ADDED/TRIMMED/CLOSED), top-3 holder deltas.
5. **Call** — single merged call system: recap headline, sentiment, guidance chip, key points, quotes, Q&A, audio player/TTS, lazy full transcript with keyword search. (Deletes the modal's second independent transcript section; keeps `/api/transcripts` as data fallback inside this one UI.)
6. **Filings** — the modal's existing plain-language + dedupe treatment, restyled.

### 4.4 Behavior
- **URL state:** opening pushes `?earnings=SYM` (pushState, so browser Back closes the modal); Escape keeps working and pops the same entry; deep link opens the modal on Calendar load. Applies to all three mount points (Calendar, MyStocksHub, CatalystFlow).
- **Arrow keys** ← → step through the day's reporters (same list the calendar view passed in).
- **Footer (pinned):** `View Chart` (TickerPopup) · `Open full report →` / lock CTA (unchanged gating semantics) · flag-to-watchlist quick action.
- **Phone:** bottom-sheet via existing `components/mobile/Sheet.jsx` (`variant="bottom-sheet"`); rail becomes a horizontal chip row; tablet keeps two-pane at reduced rail width.
- **States:** every section = `SkeletonBlock` while loading, one styled empty-state ("No transcript yet — typically posts within 2h of the call"), fetch failures show the section with a retry link, never a blank canvas.

## 5. Surface 2 — Research Page

### 5.1 Architecture
Sticky glass header + left-rail navigator + canvas (Koyfin architecture), replacing the 7-tab bar. Rail: Overview · Ratings · Financials · Estimates · Ownership · Calls · Filings (future: Options, Peers, News). Rail state syncs to `?section=` for deep links; collapses to icon rail ≤1024px, dropdown ≤640px.

### 5.2 Header (sticky)
Logo 52px · `TICKER · Company` · exchange/sector line · live price with session state · **composite `RatingBadge`** (clicking scrolls/navigates to the Ratings crown) · `SymbolSearch`. RS chip stays. Paywall behavior unchanged: non-paid → `PaywallTeaser` only.

### 5.3 Sections
- **Overview** — `RatingCrown` (composite ring + 7 component chips; **the only ratings rendering on the page** — header badge is a compressed echo of the same component); price chart card (`StockChart` D + expected-move band price-lines + earnings-date markers); key stats card; analyst snapshot card; AI snapshot card; **latest-report card wired to the unified earnings-history endpoint** (bug fix for `row={null}`).
- **Ratings** — full-size crown + component meter cards + Stock Checkup as `CheckupRow`s showing actual-vs-threshold ("ROE 28.4% vs 17% req ✓"); `method` provenance footnote kept. Crown is built to receive the future percentile job without redesign (basis pill: `Absolute v1` → `Percentile · N`).
- **Financials** — quarterly + annual `HeatGrid`s on the tokenized tier ladder; **click any row → inline ECharts trend** of that metric (8q/5y); balance-sheet + profitability as `StatTile` cards; frozen-first-column scroll on phone via `ResponsiveTable`.
- **Estimates** — full-size `RevisionColumns` (weekly diverging up/down, 90d) as the hero; forward-estimates grid; PT `RangeSlider` (+ analyst-distribution histogram **only after** the FMP `price-target-news` probe passes via `/api/debug/earnings-sources`); `RatingChangeList` (shared component).
- **Ownership** — 13F flow chips + summary deltas; holders table with Δ + NEW/SOLD tags; short-interest panel (point-in-time now; historical FINRA chart when the feed lands); insider rows. Modal + page consume the SAME endpoint (today they use two different ones — consolidate on `/api/research/ownership`, keep the other as an alias until callers migrate).
- **Calls** — same merged Call system as modal section 5 (one component, page passes `recapData?.recap` unwrap fixed at the hook level so both surfaces receive identical shape).
- **Filings** — plain-language labels + dedupe + grouping (port the modal's strictly-better logic); raw form code kept as secondary text.

## 6. Backend data plan (respecting known provider traps)

| Need | Source | Notes |
|---|---|---|
| Expected move (implied) | **NEW: in-house from Massive chains** via existing `api/services/polygon_options.py` (ATM straddle mid ± IV cross-check) | Replaces slow yfinance straddle; service exists, currently voice-only. Cache 15min + serve-stale. |
| Implied-at-the-time per past quarter | Store the computed implied nightly near each report date (forward-filling history builds over time); backfill best-effort from IV history if available, else the pair renders realized-only with hollow bars appearing as data accrues | Honest labeling: "implied history since 2026-08". |
| Unified earnings history (est/actual/surprise/next-day reaction/gap/drift per quarter) | **NEW endpoint** `GET /api/research/earnings-history/{sym}` composing FMP `stable/earnings` (already live for ModelBook) + internal bars store | Fixes the dead Overview card; feeds lollipop, reaction bars, modal + page. 30d cache for closed quarters. |
| Whisper proxy | yfinance `eps_trend` drift (7d/30d) | Label as "consensus drift", never "whisper". |
| Revisions momentum | yfinance `eps_trend`/`eps_revisions` (already in estimates service) | Weekly bucketing server-side. |
| PT histogram | FMP `price-target-news` — **gated on live probe** | If probe 404s, ship slider-only; no silent fallback rendering. |
| Short-interest history | FINRA free bi-monthly API → SQLite (COT pattern) | Later phase. |
| Everything else | Existing ~30 endpoints unchanged | 13F, insider, filings, call-recap, sentiment, fundamentals, ratings. |

**Hard rules:** every new FMP endpoint passes `GET /api/debug/earnings-sources/{sym}` first (tier ambiguity); Finnhub `/quote` is regular-session only — session labels come from Massive; no per-card fetch storms (batch via enrichment); new caches follow the `serve_stale.py` single-flight pattern (never bare TTL in front of a fan-out); never cache a failed fetch as a value; `live_massive_router.py` and partner-owned files are untouched.

## 7. Performance

- Section content lazy-loads on first rail visit (modal + page); Setup/Overview prefetch on open.
- SWR everywhere with existing polling conventions (15s prices, no new intervals).
- ECharts imported via `echarts/core` + per-chart modules only.
- Modal keeps AbortController on symbol switch; arrow-key stepping reuses mounted shell (no remount flash).

## 8. Testing

- **FE (vitest):** per-component render tests for the kit (VerdictChip grades, ImpliedVsRealized pairing, LollipopChart beat coloring, HeatGrid tier mapping); modal URL-state open/close/back; rail switching; paywall gating unchanged; one test asserting the Overview latest-report card renders real data (regression for the `row={null}` bug).
- **BE (pytest):** earnings-history composition (est/actual/reaction math, gap vs drift), implied-move computation vs fixture chain, FMP-probe gating logic, cache/serve-stale behavior. Weekday-clock injected per house rule (no weekend-only time bombs).
- **Verification:** `npm run build` green; full suites green; mobile audit harness (`tools/mobile_audit.py`) run on both surfaces phone+tablet with zero horizontal overflow.

## 9. Phasing

1. **P1 — Foundations:** tokens (score/heat/glass), `.t-num`, research-kit components with tests. No surface changes yet.
2. **P2 — Modal rebuild:** two-pane shell, banner + verdict, 6 sections on existing data (expected move still yfinance), URL state, bottom sheet.
3. **P3 — Page rebuild:** header + rail shell, Overview + Ratings, then Financials/Estimates/Ownership/Calls/Filings.
4. **P4 — Data upgrades:** in-house implied move (+ nightly implied store), unified earnings-history endpoint (wires the lollipop table + dead card), FMP probe → PT histogram.
5. **P5 — Polish:** mobile audit pass, tablet tier, empty-state copy, cross-surface QA, delete dead code (`ComingSoonTab.jsx`, legacy duplicated panels).

Each phase = its own implementation plan + review; ships only on explicit owner approval, within deploy windows, via `git push origin feat/research-calendar-redesign:master`.

## 10. Non-goals

- No change to paywall/auth semantics, calendar feed logic, or `/api/calendar` internals (perf branch `perf/calendar-load` ships independently and first if possible).
- No percentile-ratings nightly job in this initiative (crown is built to receive it).
- No live/recorded audio provider wiring beyond what exists.
- No Options-flow section on the research page yet (future rail item).
- Partner-owned files (`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`) untouched.

## 11. Decision provenance

Owner-selected on screens: Glass Premium register (S1) · two-pane rail modal with tab-like switching (S2) · banner header (S3) · implied-vs-realized + dollar strip (S4) · lollipop + side table (S5/5b) · Brief-contained AI + post-report banner flip (S7) · page left-rail architecture (S9). Delegated to Claude: reaction bars + dots + bracket (S6) · twin Analyst|Ownership panels (S8) · rail composition, footer, behavior, typography, data plan, phasing (S10, approved wholesale "whatever is best, cleanest to navigate, profound diligent information").
