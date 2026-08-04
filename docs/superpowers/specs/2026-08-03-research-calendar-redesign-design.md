# Research Page + Earnings Modal Redesign — Design Spec

**Date:** 2026-08-03 (rev 3 — full 5-lens review applied, including engineer code-verification)
**Status:** Approved design; amended per 5-lens review (CEO · designer · engineer · 12-persona user panel)
**Branch:** `feat/research-calendar-redesign` (worktree `C:\Users\Patrick\uct-worktrees\research-redesign`)
**Research base:** `docs/superpowers/research/2026-08-03-research-calendar-redesign/` — 01 current inventory (64 regions), 02 earnings-event UX (50 patterns/28 platforms), 03 research-page UX (12 paradigms + 50 widgets/33 platforms), 04 dataviz patterns (33 patterns + library eval), 05 backend data options (~30 endpoints + 6 gaps), 06 review reports (CEO, designer, engineer, 2 user panels)

## 1. Problem

Clicking a stock on the Calendar opens `EarningsModal` — 26 sections in one unstructured scroll with both CTAs at the bottom, two duplicate transcript UIs, broken design-token references, a hardcoded `#111612` background, and no URL state. `/research/:sym` is 7 flat tabs sharing 137 lines of one-line CSS, renders UCT ratings three different ways, has a permanently-dead "Latest report" card (`row={null}` at `ResearchPage.jsx:51`), and draws zero charts outside the single price chart. Neither surface uses the app's type scale or `tabular-nums`. The owner wants both surfaces "smooth and aesthetic … more professional."

## 2. Design north stars (owner-approved)

1. **Glass Premium register** — elevated translucent cards, soft gold accents, restrained glow, clean stat tiles (Screen 1 choice D) — with the restraint rules in §3.1 protecting the "simple and clean" intent from decoration creep.
2. **Cleanest navigation + profound information** — an opinion with an audit trail: every grade/chip carries its denominator (horizon, basis, inputs) and a path to its methodology; time-derivatives (revisions, deltas, drift) over static levels; micro-provenance (as-of timestamps, session labels) everywhere.
3. **One visual system** — modal and page share components; the modal is the page in miniature; "Open full report" feels like the modal expanding.
4. **Event-time first** — the two peak-value windows (pre-market triage, the 4:00–4:30 PM print window) get explicitly designed states (§4.5), not just steady state.

## 3. System foundations

### 3.1 Tokens (extend `app/src/styles/tokens.css`)
- **New score tokens:** `--score-elite/-strong/-neutral/-weak/-poor` (replacing the 5 copy-pasted hexes in `scoreColor()`), plus letter-grade aliases.
- **Heat-grid tiers:** promote the Breadth `bgG3…bgR3` rgba ladder to tokens (`--heat-g3…--heat-r3`) and reuse in financial grids.
- **Glass surfaces:** `--glass-surface` (rgba(34,37,30,.55)), `--glass-elevated`, `--glass-border-neutral` (default card border — NOT gold), `--glass-border-accent` (gold, restricted use below), `--glass-chrome` (≥.92 alpha, for pinned banner/footer/rail so text always sits on near-opaque ink), `--focus-ring`. Backdrop-filter usage limited to the modal backdrop (perf). The modal shell itself is opaque; at most ONE translucency level inside it.
- **Restraint rules (normative):** gold borders appear only on the banner, the ONE hero widget per canvas, and the active rail item; maximum one gold data-highlight per canvas; maximum one glow component per view; no gradient text, no text-shadow, no glowing marks on data elements. One ticking element per banner (the countdown); prices update without animation.
- **Theme scope:** glass token values are defined for dark + oled only. Light-theme adaptation of these surfaces is explicitly deferred to the post-launch app-wide token sweep (§10). This is a decision, not an omission.
- Fix all broken references: `--gold`, `--text-dim` do not exist as tokens yet are referenced at `EarningsModal.module.css:255,271,275` (always resolving to their fallbacks) — replace with `--ut-gold`, `--text-muted`. No hardcoded surface hexes (`background:#111612` at `EarningsModal.module.css:14` confirmed).

### 3.2 Typography
- `font-variant-numeric: tabular-nums` on every numeric cell/column (new utility `.t-num`).
- Both surfaces adopt the existing `--text-*` scale + `.t-*` utilities; the 13 ad-hoc sizes collapse to the scale. **New `--text-display` token (~40px)** for the composite crown — the scale's current 24px cap is insufficient.
- Eyebrow labels: 10px/600/`--ls-label` uppercase, consistently.
- **Contrast floor (normative):** all text <18px must measure ≥4.5:1 against its *composited* background (glass over canvas, not the raw token). Label ink dimmer than `--text-muted` is banned on glass surfaces. Mockup hexes in the brainstorm screens are illustrative; tokens are normative.

### 3.3 Color grammar
- Green/red = **realized** outcomes only. Hollow/grey = **expectations** (estimates, implied). Gold = brand verdicts/accents. `--info` for links. Session-state colors on live prices (regular vs pre/post label).
- **Hue is never the only channel (normative):** every green/red encoding must also differ by position, shape, or fill. Specifically: ImpliedVsRealized solid bars plot **signed** (down-closes descend below the baseline), not direction-by-color-alone; beat/miss dots are shape-coded (beat = solid dot, miss = ring/✕), not color-alone; HeatGrid cells always show the signed number in uniform ink (inheriting Breadth's always-visible-number rule).

### 3.4 Component library (new, `app/src/components/research-kit/`)
**Widgets:** `GlassCard` · `StatTile` · `VerdictChip` · `EyebrowLabel` · `ConsensusBar` · `RangeSlider` (52-wk + PT + expected-move dollar strip) · `LollipopChart` · `ReactionBars` · `RevisionColumns` · `ImpliedVsRealized` · `RatingCrown` (ring + component chips) · `CheckupRow` · `HeatGrid` · `RatingChangeList` · `Histogram` · `MetricTrendChart` · `EmptyState` (the one empty-state idiom). **Loading idiom:** promote and extend the EXISTING `components/Skeleton.jsx` `SkeletonBlock` (already consumed by Desk + Journal 2.0) — do not create a second identically-named component in research-kit.
**Shell (enforces "the modal is the page in miniature"):** `IdentityBanner` · `SectionRail` · `PinnedFooter`. `SentimentGauge` gets a kit restyle rather than a fork.
- Every component: CSS module, tokens only, no inline layout styles, phone + tablet rules in-module.
- **Skeleton size contract:** each chart component exports its rendered dimensions; `SkeletonBlock` reserves exactly that box (no layout shift on load).
- **Learnability affordance:** `VerdictChip` and `EyebrowLabel` accept an optional ⓘ that opens a one-line plain-English explanation + "How this is computed →" link to the methodology page (§12). A one-time coach-mark (localStorage-gated) explains the hollow-vs-solid grammar on first exposure. Both surfaces inherit this from the kit — no per-surface tooltip forks.
- **Chart rendering:** plain SVG/CSS for meters/strips/sliders/dots; ECharts via `echarts/core` + `echarts-for-react/lib/core` (verified compatible at installed versions) for lollipop/columns/histogram; lightweight-charts for anything sharing the price axis (expected-move band, earnings markers). **Zero new dependencies.** Bundle note: the echarts shrink only materializes when the **5 existing full-entry imports** also migrate (`BreadthCharts.jsx`, `breadth/views/TreemapView.jsx` — scoped into P5; 3 Journal 2.0 files — separate follow-up, out of this initiative's surfaces). One surviving full import keeps full echarts in `vendor-echarts`; manualChunks stays object-form.

## 4. Surface 1 — Earnings Modal

### 4.1 Structure
Two-pane glass modal, `min(960px, 100vw−32px)`: left rail (nav + section state) switches the right canvas per section. No global scroll column. Pinned `IdentityBanner` above both panes; pinned footer below. **One hero per canvas** — each section leads with exactly one hero instrument; everything else in that canvas is caption or support.

### 4.2 Banner (pinned)
Logo · ticker + company + sector · report timing line · live price (15s poll, session-aware) · **Earnings Setup Grade chip**.
- Timing line pre-report: `Reports tonight AMC · confirmed · call 5:00 PM ET` + live countdown. `confirmed|estimated` from the calendar feed.
- **Post-report flip:** timing line becomes the result: `Beat $0.98 vs $0.94 · +4.2% AH` — pure data. A guidance chip (`RAISED/LOWERED/MAINTAINED`) renders **only** when the call-recap guidance field or FMP data provides it, with its source labeled; it is never inferred. (State machine in §4.5.)
- **Grade chip = "Earnings Setup Grade"** (never "verdict" — see §12): computed A+…F from beat streak, revision direction 30d, RS rank, IV premium rich/cheap. Deterministic arithmetic; weights and thresholds published on the methodology page (§12); tooltip shows all four inputs with their current values **and weights** (a real audit, not a label).
  - **Missing-input rule:** if an input is unavailable (no options chain, cold IV pre-market), the chip renders the partial basis explicitly — "B+ · 3 of 4 inputs" — never a silent recompute and never a skeleton that blocks triage.
  - **Scope separation from the UCT Rating:** the chip grades **this event**; the page's 0–99 `RatingCrown` rates **the stock**. Distinct visual identities (chip vs ring), each tooltip names the other ("Setup Grade for this report — see UCT Rating for the stock"). One FE test asserts the two never render with the same visual identity. Where inputs overlap (RS), both read the same source so disagreement is explainable.

### 4.3 Rail sections
**Launch modal = Banner + Setup + Earnings History + Brief + Call (+ two link items).** "Analyst & Ownership" and "Filings" appear in the rail at launch as **link items that deep-open the corresponding /research section** — they become full in-modal sections post-launch only if usage asks for it. (45-day-stale 13F adds little on print night, and in-modal duplication cannibalizes the "Open full report" funnel.)

1. **Setup** (default) —
   a. **Hero:** `ImpliedVsRealized` — 8 paired bars (hollow = implied at the time, solid = realized, signed above/below baseline per §3.3), current quarter's hollow bar highlighted; `VerdictChip` "PREMIUM RICH/CHEAP — priced ±x% through <expiry>, typically moves ±y%". Dollar break-even `RangeSlider` beneath.
   - **Horizon honesty (normative):** the implied move is computed from the expiry bracketing the report date and its caption states the horizon ("through Fri Aug 8"); the realized comparison uses the same horizon class (close-to-close over the same span), never straddle-to-expiry vs next-day. Historical implied snapshots are pinned at **T-1 close** before each report.
   - **Cold-start state (designed, not degraded-by-accident):** implied history accrues from the nightly store (§6). With <3 recorded implied quarters the hero renders realized bars + the current implied bracket with the caption "Implied tracking since 2026-08 · n/8 recorded" — labeled, intentional, and visually complete. The paired-bars form takes over as history accrues.
   b. Key-stats strip (mkt cap · fwd P/E · beta · 52-wk `RangeSlider` · avg vol · div yield) + **consensus-drift stat** ("Est $0.94 · +4¢ / 30d") from the estimates feed.
2. **Earnings History** — `LollipopChart` (hollow estimate dot + whisker, solid actual dot, dashed next-quarter estimate) side-by-side with the compact quarterly table (ACT/EST · SURPRISE · REV · NEXT-DAY); **`ReactionBars` lives here, directly under the lollipop on the same quarter axis** — bar = next-day move, shape-coded beat/miss dots, tonight's implied ± as a gold dashed bracket, beat-but-sold-off quarters starred; caption row of `StatTile`s (AVG MOVE · CLOSED UP n/8 · BEST · WORST). EPS story and price story, one axis, one section. Table stacks under the charts on phone.
3. **Brief** — ALL prose lives here: AI preview (pre) / analysis (post) with headline + bullets, key quotes, news list. Provenance line ("AI · updated 2:10 PM"). Reuses existing cost-guarded endpoints; no new LLM surface. **On arrow-key stepping, Brief renders cached-only with a "Generate brief" affordance — stepping never auto-fires the LLM path.**
4. **Call** — single merged call system: recap headline, sentiment, guidance chip, key points, quotes, Q&A, audio player/TTS, lazy full transcript with keyword search. (Deletes the modal's second independent transcript section; keeps `/api/transcripts` as data fallback inside this one UI.)

### 4.4 Behavior
- **URL state:** owned by a new `useEarningsModalRoute` hook built on React Router's `useSearchParams` with **merge-preserving writes** (Calendar already owns `?week`/`?d`; raw `window.history.pushState` desyncs router state and is banned here). Opening adds `?earnings=SYM` as ONE history entry (Back closes the modal); **arrow-key stepping and rail-section changes use replace semantics** — Back always closes in one press. Rail section serializes as `&esection=`. **Scope: the param is honored on `/calendar` and `/calendar/mystocks` only.** CatalystFlow keeps plain local state — the Dashboard mounts two live CatalystFlow instances simultaneously (desktop + mobile trees), and its modal rows are built from today's wire list, so URL-driven opening there is both double-rendering and unresolvable.
- **Deep-link resolution:** `?earnings=SYM` resolves against the loaded feed (`toModalRow(entry)`); if SYM isn't in the loaded week, fetch its report date from the calendar API and jump to that week; if still unresolvable, open with a minimal row (sym only) — sections needing feed enrichment show `EmptyState`.
- **Arrow keys** ← → step through the day's reporters (disabled while focus is in an input/textarea). **Shell reuse requires removing the `key={selected.row.sym}` from the ErrorBoundary at all three mounts** (keep the boundary; the modal already resets internal state on sym change). Stepping applies a ~200ms settle debounce before section data hooks fire — the modal's own AbortController does NOT cover child SWR hooks, and un-debounced stepping across a 40-name day is exactly the banned per-card fetch-storm class. Only the live-price poll runs during stepping. Per-section scroll positions are retained in a state map while the modal is open; symbol switch resets them.
- **Keyboard & focus:** modal is a focus trap; rail uses tablist semantics with roving tabindex; `--focus-ring` visible on all interactive elements over glass; `prefers-reduced-motion` disables glow transitions, shimmer, and count-up animations (countdown updates as plain text swaps).
- **Footer (pinned):** `View Chart` (TickerPopup) · `Open full report →` / lock CTA (unchanged gating semantics) · flag-to-watchlist quick action.
- **Phone:** bottom-sheet via existing `components/mobile/Sheet.jsx` (`variant="bottom-sheet"`); rail becomes a horizontal chip row with edge-fade overflow affordance; **drag-to-dismiss is confined to the sheet's handle zone so canvas scrolling never fights the gesture**; reporter-stepping via chevrons in the banner (no keyboard on touch). Tablet keeps two-pane at reduced rail width.
- **States:** every section = `SkeletonBlock` (size-contracted) while loading, `EmptyState` with useful copy ("No transcript yet — typically posts within 2h of the call"), fetch failures show the section with a retry link, never a blank canvas.

### 4.5 Report-night state machine (normative)
The banner + Setup derive from one lifecycle state, computed from the calendar feed + actuals presence:
1. **PRE** (>15m before window): countdown line, Setup Grade active.
2. **IMMINENT** (report window entered, no actuals): timing line becomes "Awaiting numbers…"; while the modal is open on a today-reporter, the actuals endpoint polls at 30–60s; no stale "Reports tonight" copy survives past T0.
3. **PRINTED** (actuals present): banner flips to the result line; Setup hero annotates the realized print onto the current implied bar; History gains the new quarter.
4. **CALL LIVE** (call start time reached, recap absent): Call section surfaces "Listen live" affordance.
5. **POST** (recap present): guidance chip renders (source-labeled), Brief switches to analysis mode.
States are pure functions of data timestamps — no scheduled UI timers beyond the polling cadence.

## 5. Surface 2 — Research Page

### 5.1 Architecture
Sticky glass header + left-rail navigator + canvas (Koyfin architecture), replacing the 7-tab bar. Rail: Overview · Ratings · Financials · Estimates · Ownership · Calls · Filings (future: Options, Peers, News). Rail state syncs to `?section=` for deep links; collapses to icon rail ≤1024px, dropdown ≤640px.

### 5.2 Header (sticky)
Logo 52px · `TICKER · Company` · exchange/sector line · live price with session state · **composite `RatingBadge`** (clicking scrolls/navigates to the Ratings crown) · `SymbolSearch`. RS chip stays. Paywall behavior unchanged: non-paid → `PaywallTeaser` only.

### 5.3 Sections
- **Overview** — `RatingCrown` (composite ring + 7 component chips; **the only ratings rendering on the page** — header badge is a compressed echo of the same component); price chart card (`StockChart` D + expected-move band price-lines + earnings-date markers); key stats card; analyst snapshot card; AI snapshot card; **latest-report card wired to the unified earnings-history endpoint** (bug fix for `row={null}`).
- **Ratings** — full-size crown ("**UCT Rating**") + component meter cards + Stock Checkup as `CheckupRow`s showing actual-vs-threshold ("ROE 28.4% vs 17% req ✓"); `method` provenance kept. **Basis pill in plain English:** "Scored against fixed thresholds — not ranked vs other stocks" (v1), switching to "Ranked vs 3,685 stocks" when the percentile job lands, with a tooltip explaining that scores may shift at cutover. Crown is built to receive the percentile job without redesign.
- **Financials** — quarterly + annual `HeatGrid`s on the tokenized tier ladder; **click any row → inline `MetricTrendChart`** (8q/5y); balance-sheet + profitability as `StatTile` cards; frozen-first-column scroll on phone via `ResponsiveTable`. P3 depth extension: annual 5y→10y where the source provides, and a cash-flow grid (yfinance cash-flow frames) — competitive floor vs free stockanalysis.com.
- **Estimates** — full-size `RevisionColumns` (weekly diverging up/down, 90d) as the hero; forward-estimates grid; PT `RangeSlider` (+ analyst-distribution `Histogram` **only after** the FMP `price-target-news` probe passes via `/api/debug/earnings-sources`); `RatingChangeList` (shared component).
- **Ownership** — 13F flow chips + summary deltas; holders table with Δ + NEW/SOLD tags; short-interest panel (point-in-time now; historical FINRA chart when the feed lands); insider rows. Modal + page consume the SAME endpoint. **Merge direction (corrected by code review):** the NEW/ADDED/TRIMMED/CLOSED deltas exist only in `/api/ownership`'s FMP path (`institutional_holdings._classify_change`) — port that logic INTO `/api/research/ownership` (the superset home: short interest + insider already live there), THEN alias `/api/ownership` until its other consumers (TickerPopup, FundamentalsWidget) migrate. Auth posture decided deliberately: the consolidated endpoint is **auth-gated** (`get_current_user`), matching the stricter of the two — research data is the paid product.
- **Calls** — same merged Call system as modal section 4 (one component; the `recapData` vs `recapData?.recap` unwrap divergence is fixed at the hook level so both surfaces receive identical shape).
- **Filings** — plain-language labels + dedupe + grouping (port the modal's strictly-better logic); raw form code kept as secondary text.

## 6. Backend data plan (respecting known provider traps)

| Need | Source | Notes |
|---|---|---|
| Expected move (implied) | **NEW: in-house from Massive chains** via `api/services/polygon_options.py` — with three code-verified fixes: **paginate `next_url` and/or bound strikes around spot** (one 250-contract page silently truncates TSLA/NVDA-class chains → wrong straddle on the highest-attention names); **apply `massive.to_polygon_symbol`** (BRK-B→BRK.B, else class shares return empty chains); **select expiry ≥ report date via `list_expirations`** (the no-arg front-expiry default is wrong for reports >1 week out — port the selection logic from the outgoing yfinance version in `earnings_enrichment.py:243-268`) | **Pulled into the launch slice** — the Setup Grade must not ship on the delayed yfinance straddle. Cache 15min via `ServeStale` (on master; the current bare 60s TTLCache with no single-flight is insufficient). Horizon stated in payload. |
| Implied-at-the-time per past quarter | **Nightly implied store — starts immediately** (UI-independent), snapshotting implied for symbols reporting within 14 days (~40–80/night, bounded). **Runs on the WEB service** (web-side APScheduler + web `/data/*.db` SQLite, cot.db idiom — the worker's `/data` volume is unreadable by web). **Capture post-close, PRE-report:** the post-close run covers tonight's AMC and tomorrow's BMO names; a morning-after run would store IV-crushed values and poison the history. Holiday guard; never store a failed fetch. | Best-effort IV-history backfill validated for the ~500 most-watched reporters pre-launch; cold-start UI state per §4.3.1a. Honest label: "tracking since 2026-08". |
| Unified earnings history (est/actual/surprise/next-day reaction/gap/drift per quarter) | **NEW endpoint** `GET /api/research/earnings-history/{sym}` on a **new "last N quarters, raw" accessor** over `_fmp_get("/stable/earnings")` reusing `_earn_row_preferred` dedup and **keeping the not-yet-reported row** (feeds the lollipop's dashed next-quarter dot) — do NOT compose year-keyed `get_year_earnings` (drops upcoming rows; refetches per year). Reactions from the internal bars store **via the cached bars layer** (off-universe names then on-demand-fetch instead of returning empty). | **BMO/AMC session source is required for reaction alignment** (FMP rows carry no session): primary = Finnhub calendar `hour` (~90% coverage per the 7/30 backfill work); fallback = gap-comparison heuristic (\|gap on date\| vs \|on date+1\|); the ~10% unknown-session rows are labeled, never guessed silently. Reaction day = **next stored bar after the report bar** (never date+1 arithmetic — holidays fall out for free). Split-between-close-and-reaction edge accepted and noted. 30d cache for closed quarters. |
| Consensus drift | yfinance `eps_trend` drift (7d/30d) | Label as "consensus drift", never "whisper". Rendered in Setup key stats (§4.3.1b). |
| Revisions momentum | yfinance `eps_trend`/`eps_revisions` (already in estimates service) | Weekly bucketing server-side. |
| PT histogram | FMP `price-target-news` — **gated on live probe** | Probe fails → slider-only ships **permanently**; no FMP tier upgrade for this feature (decision recorded — post-token-crisis cost posture). |
| Short-interest history | FINRA free bi-monthly API → SQLite (COT pattern) | Later phase. |
| Grade snapshots | **Daily persisted Setup Grade + UCT Rating snapshots from day one** (SQLite, COT pattern) | Accountability defense + future rating-history chart (research W14). Cheap; not skippable. |
| Everything else | Existing ~30 endpoints unchanged | 13F, insider, filings, call-recap, sentiment, fundamentals, ratings. |

**Hard rules:** every new FMP endpoint passes `GET /api/debug/earnings-sources/{sym}` first (tier ambiguity); Finnhub `/quote` is regular-session only — session labels come from Massive; no per-card fetch storms (batch via enrichment); new caches follow the `serve_stale.py` single-flight pattern (unit lands with `perf/calendar-load` — a launch prerequisite; if unmerged in time, vendor the unit); never cache a failed fetch as a value; `live_massive_router.py` and partner-owned files are untouched.

## 7. Performance

- Section content lazy-loads on first rail visit (modal + page); Setup/Overview prefetch on open.
- SWR everywhere with existing polling conventions (15s prices; the §4.5 IMMINENT 30–60s actuals poll is modal-open + today-reporter only).
- ECharts imported via `echarts/core` + per-chart modules only.
- Arrow-key stepping reuses the mounted shell (requires the un-keyed ErrorBoundary per §4.4) with the ~200ms settle debounce before section hooks fire; Brief renders cached-only (§4.3.3). AbortController covers the modal's own fetches only — the debounce is the storm control.

## 8. Testing

- **FE (vitest):** per-component render tests for the kit (VerdictChip grades incl. the 3-of-4-inputs partial state, ImpliedVsRealized signed pairing + cold-start state, LollipopChart beat coloring, ReactionBars shape-coded dots, HeatGrid tier mapping); modal URL-state open/close/back including the replaceState stepping contract; §4.5 state machine transitions (PRE→IMMINENT→PRINTED on fixture timestamps); rail switching + scroll retention; paywall gating unchanged; the Setup-Grade-vs-UCT-Rating distinct-identity assertion; one test asserting the Overview latest-report card renders real data (regression for `row={null}`).
- **BE (pytest):** earnings-history composition (est/actual/reaction math, AMC/BMO session-alignment fixtures incl. the unknown-session labeled path, gap vs drift, next-stored-bar reaction indexing over a holiday fixture), implied-move computation vs fixture chain incl. **a dense-chain pagination fixture (>250 contracts)**, symbol mapping, and expiry selection for a report >1 week out, FMP-probe gating logic, nightly-store bounding (14-day window) + post-close capture timing, grade-snapshot persistence, cache/serve-stale behavior. Weekday-clock injected per house rule (no weekend-only time bombs).
- **Verification:** `npm run build` green; full suites green; mobile audit harness (`tools/mobile_audit.py`) on both surfaces phone+tablet with zero horizontal overflow; a contrast check of composited glass surfaces against the §3.2 floor.

## 9. Phasing — with a defined launch slice (Sep 5)

**LAUNCH SLICE = P1 + P2-slim.** P3, P4 (except the implied-move service), and P5 explicitly do **not** block the Sep 5 launch and continue after it. `perf/calendar-load` is a **hard prerequisite** (a slow calendar with a beautiful modal is a worse first impression than the reverse). **Scope freeze ~Aug 22:** after it, only bug fixes land on the launch slice.

1. **P1 — Foundations:** tokens (score/heat/glass/focus/display), `.t-num`, research-kit components incl. shell (IdentityBanner/SectionRail/PinnedFooter) with tests. **Starts in parallel: the nightly implied store + grade-snapshot store + backfill validation (no UI dependency).**
2. **P2-slim — Launch modal:** two-pane shell, banner + Setup Grade (with methodology page + disclaimer footer, §12), Setup + Earnings History + Brief + Call sections, A&O + Filings as rail links, URL state via `useEarningsModalRoute`, §4.5 state machine, bottom sheet. **Includes the in-house implied-move service** (the grade does not launch on delayed yfinance IV). **Blast-radius rules:** the kit components are NEW — the legacy `AnalystPanel`/`OwnershipPanel` stay untouched (TickerPopup + FundamentalsWidget keep consuming them until P5); do not move legacy files in P2 (several vitest suites `vi.mock` them **by module path**); there is currently NO `EarningsModal.test.jsx` — the §8 modal suite is written from scratch and budgeted into P2.
3. **P3 — Page rebuild (post-launch):** header + rail shell, Overview + Ratings, then Financials (incl. depth extension)/Estimates/Ownership/Calls/Filings.
4. **P4 — Data upgrades (post-launch):** unified earnings-history endpoint wired everywhere (interim: launch modal computes history client-side from existing enrichment where available), FMP probe → PT histogram, FINRA short-interest history.
5. **P5 — Polish:** mobile audit pass, tablet tier, empty-state copy, cross-surface QA, dead-code deletion (`ComingSoonTab.jsx`, legacy duplicated panels), migrate TickerPopup/FundamentalsWidget onto the kit panels + the 2 breadth full-entry echarts imports onto `echarts/core`, full A&O/Filings modal sections if usage data asks.

Each phase = its own implementation plan + review; ships only on explicit owner approval, within deploy windows, via `git push origin feat/research-calendar-redesign:master`.

## 10. Non-goals & pinned post-launch roadmap

**Non-goals for this initiative:** paywall/auth semantic changes (but see §13), calendar feed logic or `/api/calendar` internals (perf branch ships independently and first), percentile-ratings nightly job (crown is built to receive it), live/recorded audio provider wiring beyond what exists, light-theme glass adaptation (deferred to the app-wide token sweep — a named post-launch initiative so the two-register period converges rather than forks), partner-owned files (`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`).

**Pinned post-launch roadmap (committed, not aspirational):**
1. **"Flow into the print" chip row** on modal Setup from own flow.db (`days=1` per the premium-cap gotcha) — the one asset no competitor can license.
2. **Setup Grade as a ranked Calendar column** — turns the grade into a nightly habit loop at ~zero data cost (top churn-retention ask from the user panel).
3. App-wide token sweep (register convergence).
4. Rating-history chart from the day-one grade snapshots.

## 11. Decision provenance

Owner-selected on screens: Glass Premium register (S1) · two-pane rail modal with tab-like switching (S2) · banner header (S3) · implied-vs-realized + dollar strip (S4) · lollipop + side table (S5/5b) · Brief-contained AI + post-report banner flip (S7) · page left-rail architecture (S9). Delegated to Claude: reaction bars + dots + bracket (S6) · twin Analyst|Ownership panels (S8 — now a post-launch modal section per CEO review; ships on the page in P3) · rail composition, footer, behavior, typography, data plan, phasing (S10, approved wholesale). **Rev 2 amendments** from the CEO/designer/user-panel review: launch slice + scope freeze, trust posture (§12), grade scope-labels + partial-input rule, horizon-honest implied math + T-1 pinning, §4.5 state machine, replace-semantics stepping, signed/shape-coded encodings, contrast floors, gold-restraint rules, shell components, ReactionBars → Earnings History, learnability layer, cold-start states, cost bounds. **Rev 3 amendments** from the engineer code-verification: chain pagination/symbol-mapping/expiry-selection requirements, BMO/AMC session source + next-stored-bar reaction indexing, ownership merge direction reversed + auth posture, `useEarningsModalRoute` over raw pushState + CatalystFlow scoped out + deep-link resolution, un-keyed boundary + settle debounce, echarts bundle-claim scoped to the real 5 full-import files, web-side implied store + post-close capture timing, existing `SkeletonBlock` promoted instead of duplicated, P2 blast-radius rules. One engineer claim was itself refuted by direct grep and NOT applied: `--gold`/`--text-dim` fallback references DO exist (`EarningsModal.module.css:255,271,275`). Review reports: `docs/superpowers/research/2026-08-03-research-calendar-redesign/06-review-*.md`. Mockup screens: `.superpowers/brainstorm/345223-1785804114/content/` (hexes illustrative; tokens normative).

## 12. Trust & compliance posture (new — required before any grade renders publicly)

- Standing footer on modal + research page: "For informational purposes only — not investment advice." (exact copy owner-approved before launch).
- **Public methodology page** documenting the Setup Grade and UCT Rating formulas (inputs, weights, thresholds, update cadence) — "documented in code" is not a user-facing posture. VerdictChip ⓘ and crown link here.
- UI language: "Setup Grade" / "Earnings Profile" — the word **"verdict" never appears in user-facing copy** (advice-flavored). Internal component names may keep `VerdictChip`.
- Terms of Service updated for published ratings (publisher's-exclusion posture: impersonal, regular-circulation analysis).
- Daily grade snapshots persisted from day one (§6) — the accountability record.

## 13. Open owner decisions (flagged by review, NOT applied)

1. **Conversion mechanics (CEO finding 6):** as shipped, free = Morning Wire only, so this redesign improves surfaces free users never see, and shared `?earnings=SYM` deep links dead-end for non-paid recipients. Options: (a) make the Calendar list view free with the modal's Setup section visible and other sections lock-teased — the redesigned modal becomes the conversion moment; (b) minimally, shared deep links land on a blurred-but-real modal teaser instead of a /dashboard redirect, plus one public sample ticker page for marketing. **Changes paywall semantics — owner call.**
2. **Naming the moat (CEO finding 11):** the implied-vs-realized hero is the nameable differentiator (no US competitor ships it on a ticker page). Working title "the Expectation Gap" — owner to name it (title style is owner-locked) for launch copy, coming-soon page, and paywall teaser.
