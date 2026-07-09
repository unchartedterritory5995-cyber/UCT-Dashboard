# Calendar Flagship Redesign — "The Earnings Terminal, Briefed"

**Date:** 2026-07-09
**Status:** FINAL — approved design pending owner sign-off
**Provenance:** 12-agent design board (2 competitor teardowns · data-capability audit · forensic visual critique · simple-user walkthrough → 3 independent design visions → executive judge synthesis → 3 adversarial verify passes), findings folded in as binding amendments below.

---

## North star

> A swing trader glancing at this page for five seconds gets a ranked, personal answer to
> "what prints, when, how big is the move — and am I exposed": a brief of THEIR names on top,
> one Main Event per day, thirty-plus tickers of real numbers per screen, zero placeholder
> pixels, and gold spent only where it signals.

## Where we stand competitively (research digest)

**Table stakes we currently fail:** time navigation (week paging — API takes no date param), ticker search, land-on-today, actuals swapped onto entries after the print, confirmed-vs-estimated date rigor, importance hierarchy, a dense list/table mode, native watchlist alerts.

**Moat no competitor ships at any price** (and we already compute the data): implied vs realized move on every entry (Market Chameleon paywalls exactly this); broker-position earnings risk live in-app via SnapTrade (`_sources` is computed today and never rendered); a real-time Print Tape reflow; date-integrity badges at retail (Wall Street Horizon sells this to institutions).

**Verdict from the completeness reviewer:** covers ~90% of combined retail+pro table stakes, executes nearly every steal-worthy pattern, differentiator stack is genuinely ownable — *after* the six blocker fixes below.

---

## Information architecture

ONE PAGE, THREE DENSITIES OF THE SAME RANKED TRUTH, WITH A PERSONAL BRIEF ON TOP.

- **BOARD** (default; retires the "Feed" label): the working surface. Today's Brief rail → day groups, each: macro band → Main Event card → featured cards → 36px data table → compact cluster.
- **WEEK**: the ranked logo mosaic — EarningsWhispers-style five-column anticipation map in UCT gold/blue; ten-second triage; source of the shareable PNG.
- **MONTH**: heat overview — counts + marquee names per cell; every cell clicks through to Board scrolled to that day.
- **EarningsModal**: the depth layer (widened to 720px), Bloomberg event-object model — the same entry accretes estimates → actuals → verdict → recap → transcript.
- **My Stocks Hub** stays a separate sub-page; the Brief rail is its ambient front door. Calendar owns time, Hub owns depth.

### Header (two rows, sticky)

**Row 1:** title 18px/800 · Board/Week/Month segmented toggle (existing style, gold active) · **ticker search** 240px ('/' focuses; typeahead over prewarmed ticker_meta: 16px logo + ticker + name + "Reports Thu Jul 17 · Before open"; Enter filters the visible board; out-of-window names resolve via a next-report endpoint → "Jump to week of Aug 24"; arrival pulses the card gold 2×) · star **Hub** link with visible label.

**Row 2 — Week Navigator (the spine):** ‹ arrow | five day-tabs `THU 9 · 21 ★3` (count dim, gold star-count of MY names; today gold-underlined) | › arrow | **Today** pill (gold outline; hidden when on current week AND at today) | week label as a button (`Week of Jul 6–10 ▾`) opening a popover of prev/next 8 weeks labeled with lazily-warmed reporter counts. **[AMENDED]** The ±52-week mini month grid is CUT (three overlapping time-nav systems; Month view owns long range). **[AMENDED]** Day tabs have ONE verb in all three views: *take me to that day* — scroll-to-day in Board, scroll/highlight in Week, and in Month they jump to Board scrolled to that day (never a no-op).

Below: audience chips (My Stocks / Watchlist / Positions / UCT20 / All $300M+) **UNCHANGED in placement, order, gold active state — sacred** — plus a '?' micro-explainer beside My Stocks and tooltips on All($300M+)/UCT20; then Filters.

**Filters:** full feature set unchanged, rendered through `Sheet.jsx` — 280px anchored panel desktop with `max-height: calc(100vh−120px)` + internal scroll (fixes the 768px clip), bottom sheet ≤640px. Compass FAB/toast z-index audited so it can never cover controls.

**Keyboard** ('?' overlay): `←/→` weeks · `T` today · `/` search · `Esc` close. **[AMENDED]** 1-5 weekday jumps and B/W/M switching trimmed to backlog.

### Time model

`GET /api/calendar?week=YYYY-MM-DD` (Monday-anchored, per-week cache keys). Current week keeps the EW+Finviz merged path; **EarningsWhispers is NEVER paged**. Other weeks: Finnhub range via the proven `_fh_get_month` pattern, with FMP `stable/earnings-calendar` as candidate primary **only after a probe confirms it** (sibling stable endpoints 404 on this plan — build order must not assume FMP).

**[AMENDED — universe seam]:** all weeks normalize through ONE universe rule before counting or ranking — the existing cap_universe/$300M filter applied to range results, and the current week's `[:40]` per-session truncation aligned to the same rule. Navigator/picker counts come from the normalized set only, so `THU 9 · 21` this week and `THU 16 · 43` next week describe the same universe. Estimate precedence on the seam: current-week EW/Finviz values win; range-call values fill gaps.

**[AMENDED — session truth]:** a third **TIME TBD** session state end-to-end. Server stops coercing `tbd→AMC` (calendar.py:346, 538); Board table + Week columns get a neutral TIME TBD group after AMC (10px uppercase, dim, no gold/blue); lifecycle chip shows "time unconfirmed"; add-to-calendar emits an all-day event; Print Tape excludes TBD names from the pre-open window.

**[AMENDED — cache unweld scope]:** `/reactions`, `/day-metrics`, `_compute_enrichment_for_date`, **plus the other three readers of `calendar_weekly`** — `_collect_reporters_for_ics`, the awareness engine's R5 earnings-proximity scan, and `calendar_alerts.py` — all resolve from per-week caches. Paging horizon: ±13 weeks cached live; older weeks on-demand, no-cache (protects the bounded LRU from churn).

**[AMENDED — enrichment safety]:** implied move is SKIPPED for dates < today (yfinance only lists future expiries — past-week EMs would be garbage); enrichment restricted to current week ±2 with a module-level semaphore (concurrency 1-2); `get_implied_move`'s yfinance calls wrapped in `yf_util.bounded_call`; multi-hour TTL for non-current weeks; a coverage counter in the batch payload + admin status endpoint (a silent universe-wide enrichment failure must not silently flatten the hierarchy).

Deep-linkable URL state: `/calendar?week=…&d=…`. Board auto-scrolls to today's anchor on load. Past days render reported grammar only — never "EPS est". **[AMENDED]** Historical weeks carry actuals inline from the range call ( `_patch_today_actuals` extension is current-week-only); past-day reaction % computed from the bars cache (report-date open vs prior close), cached per (sym, report_date), inside the enrichment pass.

### The hierarchy algorithm (one number, every view)

`imp = 2.0·z(ln(1+ew)) + 1.5·z(ln(1+mc_b)) + 1.0·z(ln(1+avg_vol·price)) + 0.75·clamp(EM%/5,0,3)`, missing fields contribute 0.

**[AMENDED — computed CLIENT-side]** over the three payloads the client already joins (week + day-metrics + enrichment-batch), matching the my-sets join pattern — the server payload cannot see mc_b/EM at build time on the live path, and a server imp would flip the Main Event seconds after first paint. The day's Main Event selection is **frozen after first computation** (no reflow). `imp_eff = imp + 3.0·positions + 2.0·(watchlist|flagged) + 1.0·uct20`.

Tiers per day: **MAIN EVENT** = argmax imp_eff, exactly 1, only if ≥ week's P75 (quiet days get none). **FEATURED** = mine OR mc_b≥10 OR top-3 by imp_eff, cap 4/day. **[AMENDED — table gate]** **TABLE** = has ANY datum (eps_est OR rev_est OR expected_move) — the `AND mc_b≥2` gate is dead; it hid data for the sub-$2B names this audience trades. **COMPACT** = genuinely zero-data names only. Weights logged (daily Main Event picks) and threshold-tuned after a week of live evidence, per the tuning playbook.

Audience chips × tiers: when a filter yields a small set (e.g. Watchlist, 2 names), the day renders as a plain featured list — no Main Event, no table chrome.

---

## View specs

### Board

- **Today's Brief rail** (Board only, ~120px, snap-scroll): YOUR REPORTS — compact cards for My Stocks names reporting today/tomorrow: 24px logo + 13px/800 ticker + lifecycle chip + 10px POSITION (gold) vs WATCHLIST (dim) badge from `_sources`. REPORTED — verdict chips, **mine-only** (the Print Tape owns the market-wide tape — no duplication). MACRO TODAY — is_key econ chips. Empty state: one dismissible 11px line "Star names or connect your broker to build your brief" + Hub link; hidden after dismissal. Pure client-side join — zero new endpoints.
- **Day header** (sticky, 13px/700 CREAM — not gold): `THU JUL 9 · 21 companies reporting · ★3 mine` ("1 company reporting" — pluralization fixed; the word "reporters" dies). Past days append "· closed".
- **Macro band** under the day header (owner favorite, promoted): 11px, blue left-border kept; each event `8:30 AM CPI · est 3.2% · prior 3.4%`, released actual colored green/red vs estimate; is_key events as 10px gold-outline chips (`_fetch_ff_events` already returns estimate/prior/actual/is_key — currently thrown away).
- **Main Event card** (span-2): 40px logo · 18px/800 ticker · session chip + cap badge + lifecycle chip · deterministic zero-LLM editorial line — **[AMENDED plain language]** "Largest report of the day · options price a ±5.2% swing · typically moves ±3.1%" · "CPI day" collision chip · metric line `EPS 2.21 est · 2.05 last qtr | Rev 894M est · +6% YoY` (null fields absent, never "—") · EXPECTED MOVE hero: ±% 18px/800 gold + "±3.1% typical" beneath, rich tint + one-word "rich" label when implied > 1.3× realized · meta: 8-dot beat strip · reaction sparkline (fixes the live `fmtHistStats` array-as-scalar bug) · report time. **[AMENDED]** Hard max 4 chips/card, priority-ordered.
- **Featured strip** (≤3 more/day): `repeat(auto-fill, minmax(300px,1fr))`, 36px logo, same anatomy minus editorial line.
- **Data table** (the density engine): 36px rows — logo 20px | ticker 13px/700 + name 11px dim | session glyph | cap | EPS est/prior | Rev est | **MOVE ±%** header (**[AMENDED]** not "±EM%") | 8-dot beat strip | state chip. Sorted imp_eff desc within BMO → AMC → TIME TBD groups. **[AMENDED]** Click-to-sort column headers (cap, move, time, surprise) — pro-grid table stakes. Hover quick-stats popover on rows.
- **Compact cluster**: `Also reporting (12) ▸` collapsed row → 32px logo+ticker lines. Zero-data names only; an all-dash hero card is banned forever.
- **Reported transformation**: BEAT/MISS pill, `EPS 2.31 vs 2.19 est (+5.5%)`, post-print gap, EXT row. **Print Tape**: after 4:00 PM ET (and 6:00–9:30 AM for BMO) today re-sorts Reported (by |surprise|) above Upcoming, gaps streaming via existing SSE (confirm batched snapshot path, never per-sym calls); loud REPORTED/UPCOMING section headers + "sorted by biggest surprise" caption.
- **Empty day**: one 11px dim line "No companies reporting Friday" (macro band still renders). No dashes anywhere.
- **Density target**: ≥30 tickers with real data in the first 1920×1080 viewport (today: 6 cards, 3 with data).

### Week

Load-proportional columns (fr-weighted by count, min 160px, `align-items:start`) — Monday's 2 names never stretch to Thursday's 21. Sessions **stack** (the side-by-side `.wtimings` 1fr/1fr split is deleted); empty session renders NOTHING. Rows 28-32px, every row carries a datum: featured = 24px logo + 13px/800 ticker + gold ±move%; default = 20px logo + 13px/500 dim ticker + cap — **[AMENDED]** with a tiny per-column header labeling the datum slot so adjacent rows' different numbers aren't mystery meat. Ordered by imp_eff, mine pinned first. `+N more` opens DayDetailDrawer. Macro chips in column headers. Logo fallback: rounded olive tile + 9px/800 gold monogram — never a blank white square; tickers never truncate. Mobile: vertical day accordion, today expanded. Density target: 45-60 tickers.

### Month

**Priority zero is the data fix** — Month currently contradicts Week ("No earnings" across a 30-reporter week), the page's worst trust bug. **[AMENDED]** Phase 1 ships counts + names heat ONLY (verified: cap_universe.json is a bare ticker array, ticker_meta has no market cap — logo-tiering by cap has no data source; an explicit chunked Finviz monthly fetch is a named optional cost later, not "free"). Cells 96px (down from 132px): date + count pill with 4-step opacity heat + up to 3 logos 16px + `+18` + gold star dot when MY names report. Empty cells: date only, recessed — the "No earnings" stamp ×25 is deleted. Mobile: agenda list of loaded days only, 44px rows.

### EarningsModal

`min(720px, 92vw)`, 2-col at ≥640px internal. Header: 40px logo · 22px/800 ticker + full company name · live price + day% · plain-language session chip · **"Add to calendar"** control with calendar-plus UIcon (**[AMENDED]** NOT a bell — a bell that downloads a file lies; the bell glyph is reserved for Phase 3 in-app notifications) + confirmation line "Downloads a calendar event". Sections render ONLY with content (the apology stack — "Preview unavailable", "No analyst coverage", empty recap with a search field — dies): surprise table (pre-print shows Expected column only) · expected move in full: "±11.6% (±$12.40) through Fri Jul 17" + tap-tooltip + "Run-in: +4.3% last 30 days · −2.3% last 5" · AI recap restructured (Key Takeaways / Guidance & Outlook / Q&A Highlights) + "Tone 68/100 — positive, down from 74" · growth table from `earnings_table` · analyst consensus/PT · fundamentals strip (ownership clamped ">100% (incl. derivatives)", human dates) · filings deduped by accession, plain-language labels ("Insider trade (Form 4)"), capped at 5 · tweets · View Chart / full report.

### Touch + accessibility (binding, from the simplicity review)

- Every explanation affordance is **tap-to-open popover** (hover-only tooltips don't exist on touch); info targets ≥24px; micro-controls inside 36px rows get ≥44px effective hit areas on touch.
- One **"What am I looking at?" legend** inside the '?' overlay: dots, tints, session colors, chip vocabulary, e-suffix — written once.
- Color never the sole carrier: beat/miss dots keep the "beat 6 of 8" text on featured tiers/tooltips; sessions keep sun/moon shapes; verdicts pair color with BEAT/MISS text.
- **Mobile chrome budget**: on scroll, navigator row + chips collapse to one compact bar (`Week of Jul 6 ▾ · My Stocks`); Brief rail collapses to a 32px summary line (`★3 today · 2 reported`), tap to re-expand; only the compact bar + day header stay sticky. Re-verified target: ≥5 entries per 390px screen *with sticky chrome mounted*.
- Loading/failure states: skeleton rows on week paging; "Couldn't load that week — retry" on range-call failure; search has designed no-answer states ("no confirmed date yet" for far-out names, honest empty for unknown symbols). Typeahead is cache-only; next-report fetch fires on selection, debounced, never per keystroke.
- One-time "what changed" cue for the 200 existing users (single dismissible line pointing at the navigator + search).
- Lifecycle chip wording: **REPORTING** at print time, never "LIVE" (we don't stream call audio — don't invite the question).

---

## Visual system

**Type scale — seven steps, 10px floor, one role = one size across ALL views**, tabular-nums on every numeric: 22px/800 modal ticker · 18px/800 page title, Main Event/featured ticker + EM hero · 15px/800 default-card ticker · 13px/700-800 all day headers, table/week/Brief tickers · 12px metric rows, editorial line, chips, table numerics · 11px company names, macro items, meta, counts · 10px/700-800 UPPERCASE (the ONLY micro tier): session marks, group headers, eyebrows, badges, column headers. The 8px/9px tiers and the 19px week ticker are abolished.

**Spacing**: 4px base, tokens 4/8/12/16/24/32 only. Radii 14/12/10/999. Row heights: Main Event ~170px, featured ~150px, table 36px, week 28-32px, compact 32px, Brief ~120px.

**Logo ladder** (flat 46px retired): modal + Main Event 40 · featured 36 · week-featured + Brief 24 · table/week/compact 20 · month chip + search 16. Fallback: olive tile + gold monogram.

**Gold is rationed to exactly four signals**: BMO marks, My-Stocks personalization, the expected-move value, active/today states. Blue = AMC + macro band identity. Green/red = verdicts and moves only. Day headers move OFF gold to cream — gold regains the exclusivity the owner's signal language needs.

**Empty-state grammar**: containers recede (bg + 40% dashed border, no text); one view-level dim line only where a whole day would confusingly vanish; null metric rows suppressed; modal empty sections don't render.

**Motion**: keep card hover physics + logo scale-on-hover; add exactly two: slow gold pulse on REPORTING, single 2× pulse on search/tab jump target.

---

## Roadmap

### Phase 0 — Half-day probe-and-respec (BEFORE any build)
1. Probe FMP `stable/earnings-calendar?from=&to=` on this key (add to the earnings.py debug probe); record whether any provider returns clock times or date-confirmation fields. Build order assumes Finnhub `_fh_get_month` until proven otherwise.
2. Confirm the extended-hours feed used by reported chips is the batched Massive snapshot path.
3. Baseline Playwright screenshots (harness below) for before/after.

### Phase 1 — Make it a calendar, kill the chunk (split into 2-3 deploys, each ≥4:20 PM ET or <9:15 AM)
- **Deploy 1a (backend)**: `?week=` param + per-week cache keys + universe normalization rule (incl. aligning the `[:40]` truncation) + TIME TBD state (stop coercing tbd→AMC) + unweld ALL SIX `calendar_weekly` readers + enrichment safety (past-date EM skip, ±2-week scope, semaphore, bounded_call, coverage telemetry) + long day-metrics TTL for past dates + company names batched from ticker_meta into the payload + "est." date badge riding the range call + deep-link `?week=&d=`.
- **Deploy 1b (frontend nav + honesty)**: Week Navigator (arrows, day tabs with counts/★, Today pill, 8-week count-labeled picker — counts lazily warmed) + ticker search + next-report endpoint + jump/pulse + auto-scroll-to-today + skeleton/error states + reported grammar on past days (range-call actuals + bars-cache reactions).
- **Deploy 1c (de-chunk + hygiene)**: `.cards` → `repeat(auto-fill, minmax(260px,1fr))`; default card shrink (28px logo, 12px padding); suppress every "—" row; zero-data names → compact cluster; Month data fix (counts+names heat, 96px cells, "No earnings" deleted); pluralization; filings dedup + plain labels; Filters → Sheet.jsx + Compass z-index audit; ics honors session anchors ("est." labeled — real clock times don't exist in any wired provider); ownership clamp; human dates; `fmtHistStats` array bug; macro est/prior; tap-tooltips + chip explainers.

### Phase 2 — The Terminal (hierarchy + density engine)
- Client-side `imp`/`imp_eff` + frozen Main Event selection + pick logging for tuning.
- Board rebuild: Main Event + featured strip + sortable 36px data table + compact cluster; cream day headers; macro band promoted.
- Week mosaic rebuild: load-proportional stacked columns, datum rows with slot headers, monogram fallback, mobile accordion.
- Type scale enforcement + gold rationing + spacing tokens + logo ladder + empty-state grammar.
- Card intelligence: implied-vs-realized pair (+ "rich" label), beat-dot strip, reaction sparkline, prior-actual + YoY.
- Lifecycle chip (session-anchored countdowns, "est." honesty, REPORTING pulse, BEAT +4.2% after hours) + "Add to calendar" per report.
- Modal flagship pass (720px, event-object, sections-collapse).
- Keyboard core (`←/→ T / Esc`) + '?' overlay with the legend.
- Mobile reflows + chrome budget + collapse-on-scroll.
- **Acceptance harness**: Playwright vite-preview screenshots asserting the density targets (≥30 tickers @1920, ≥5 entries @390 with chrome mounted) + the 10 walkthrough tasks re-scored.

### Phase 3 — Bar-none top tier (the moat)
- Today's Brief rail (POSITION/WATCHLIST badges, mine-only REPORTED cluster, dismissible empty state).
- Print Tape reflow.
- Instant verdict line — **deterministic template ONLY** (Claude polish cut by two reviewers; revisit after a quarter of Print Tapes).
- Native alerts for My Stocks names: "reports tomorrow/today" + "results out" in-app (shared computation, per-user delivery) + optional Resend weekly digest. Bell glyph lives here.
- Date-integrity layer: nightly diff job + revision table in `/data/calendar_dates.db` (the established /data/*.db pattern), "Date moved Jul 28 → Aug 4" chips, confirmed-only filter.
- Guidance chip — **modal-first** (genuinely zero new spend); card-face only behind an explicit nightly recap sub-budget for (reported ∩ (featured ∪ mine)), hard N/day cap, separate cost-log line item, catalyst-first priority (the shared $8/$15 guard melted down this same week — observability before spend).
- Structured recap sections + anchored tone delta in the modal.
- "Most Anticipated This Week" PNG — **server-side Pillow render** (reuse the proven desk_thumbnail pipeline + disk-cached logos), default CANONICAL unpersonalized imp ranking (one recognizable artifact for fintwit; "include my names" opt-in variant).
- "New since last visit" dots — **Brief rail only** (batched/debounced mark-seen endpoint, not one POST per item).
- Post-print behavior playbook ("gapped up like this 8 times · held the gap 6") from the bars cache — the chosen ONE of the two L-effort compute items.
- Sector scoping chips ("Tech this week") from ticker_meta sectors + peer read-through line (one cached Claude call per sector per day, cost-guarded) — the two cheap corpus differentiators the judge missed.

### Deferred / rejected (deliberate)
- Macro blast-radius (self-contradictory spec; per-symbol shared table + client join is the valid shape — Phase 4 backlog behind the playbook).
- ±52-week mini month grid; keyboard 1-5/B/W/M; Claude verdict polish; transcript-ready push notifications (dots test the retention hypothesis first).
- Whisper-number substitute ("watched by N UCT members") — acknowledged gap, too thin at 200 users.
- Live call audio — stays stubbed (contract-dependent); wording never implies it.
- Chart 'E' earnings flags on /charts timescale — named follow-on, out of this page's scope.

---

## Acceptance criteria (definition of done)

1. All 10 walkthrough tasks pass (ticker lookup, today, next week, my stocks, beat/miss recap, jargon comprehension, reminder, macro glance, 10-second modal, phone).
2. Density: Board ≥30 real-data tickers @1920×1080; Week 45-60 with a datum per row; Month zero repeated empty-text; ≥5 entries per 390px screen with sticky chrome mounted; chrome-to-content ~30/70.
3. Zero placeholder pixels: no "—" rows, no "No earnings" stamps, no blank white logo tiles, no apology sections.
4. Trust invariants: Month never contradicts Week; counts comparable across weeks (one universe rule); TBD never rendered as AMC; unconfirmed dates carry "est."; past days never say "EPS est".
5. No regression to: EW pacing (never paged), the 60-req-per-load fundamentals ban, single-process/client-join law, catalyst cost guard, mobile 640/1024 breakpoints, calBody container queries.
