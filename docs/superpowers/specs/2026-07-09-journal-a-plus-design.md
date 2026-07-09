# Journal 2.0 → A+ — Design Spec

**Date:** 2026-07-09
**Status:** Approved design, pending implementation planning
**Owner ask:** "Take the journal from C+ to A+. A smoother, simpler experience while continuing to provide incredibly detailed data. A premier competitor to Tradervue, TraderSync, TradeZella."

**Provenance:** Synthesized from a 4-vision / 3-judge product panel (simplify · analytics · coach · competitor lenses), a competitor teardown (TradeZella / TraderSync / Tradervue / Edgewonk / Stonk, mid-2026), a fresh codebase audit, and a 4-persona adversarial design review (pro designer · principal engineer · CEO · trialing-user walkthrough). All code claims below were verified against `origin/master` at `898e21ac`.

---

## 1. Goals, ICP, and non-goals

**ICP:** swing/position traders on retail brokers (the owner's own profile), plus manual-entry traders journaling to learn. NOT scalpers — this justifies every refusal below.

**Product goals (measurable):**
- A TradeZella/TraderSync/Tradervue user can import full history and see populated Insights within 30 minutes of signup.
- A new manual trader reaches a coached first trade (pre-trade verdict seen) within their first session.
- Log a manual trade in ≤2 interactions from any surface (persistent header "+ Log Trade").
- Today fits one desktop viewport without scrolling; every surface has a designed zero-data state.
- Numbers never disagree between surfaces: one math engine, one filter contract, parity-tested.
- Full CSV/JSON export of the user's own journal, always ("your data leaves with you").

**Per-phase success signals** (instrumented from P1, not P6): surface visits (Today vs old landing), trade-page opens per session, scope-bar activations, tag-completion rate, import-preset completions, verdict-embed usage, trial→paid conversion.

**Refusal list (plan law):**
- **No tick replay.** No tick feed exists; a 5m-bar imitation benchmarks as inferior to TradeZella's best-in-class replay in every review. Counter-position, shipped as product + marketing: *"coaching before the trade beats replaying after it"* — the pre-trade verdict embed is the artifact behind the argument, and it ships in P1.
- **No visual backtesting.** A second product; TradeZella gives it away unlimited — unwinnable parity for a solo owner.
- **No drag-drop widget dashboard engine.** Today ships as a fixed, opinionated smart layout.
- **No native mobile app this cycle** — which makes mobile *web* the mobile product (see §9 mobile workstream).
- **No curation of imported data, ever** (broker-mirror law — standing owner decision).
- **No SQLite→Postgres migration this cycle.** All schema work stays additive in `auth.db`.

**Cross-cutting requirements (apply to every phase):**
- Accessibility: P&L never encoded by red/green alone — sign prefixes and/or shape glyphs everywhere; gold-on-dark contrast per design tokens.
- All web deploys ship ≥4:20 PM ET or <9:15 AM ET (every phase, not just IA phases).
- Two walkthrough gates per phase: (a) broker-less manual account WITH data, (b) fresh zero-data account (no broker, 0 trades).
- Every AI-generated artifact is opt-in, event-driven, materiality-gated, and cost-instrumented (Automated Compass stays paused; nothing auto-arms).

---

## 2. Information architecture — 8 tabs → 5 surfaces

**The seam, in one sentence:** **TRADES** = what the broker says happened (the objective record). **JOURNAL** = what you say about it (calendar, reflections, notes). **TODAY** = now, never history. **INSIGHTS** = what the record means. **COMPASS** = the coach.

Primary nav (left rail desktop, bottom bar ≤640px; gold SVG icons — the current emoji tab labels violate the no-generic-emoji brand law and are replaced):

1. **TODAY** — default landing. Three states, each leading with exactly ONE module and answering one question:
   - Pre-market: *"Am I ready?"* — open positions vs today's calendar/catalysts, discipline state, unresolved reflection prompts.
   - Market hours: *"How am I doing?"* — live positions hero + day P&L (the current landing habit survives, elevated).
   - Post-close: *"What did I learn?"* — EOD recap leads + one-tap day reflection.
   - Below the lead module: one consolidated coach strip (replaces the Nudges/EODRecap/intervention banner pile), week calendar strip (the SAME component as Journal's calendar in week mode — every day cell deep-links to the Journal day page), goal progress (existing goals feature — `/accounts/{id}/goals` + `GoalProgress.jsx`; canonical goal-setting home = Settings → Accounts), quick actions.
   - One-desktop-viewport cap. **Zero-data variant:** guided checklist card (Connect broker / Import CSV / Log first trade) + Compass intro; positions hero and goal modules suppressed until data exists. **No-sync variant:** manual accounts get a "log today's trades" quick-entry block where synced accounts get the live hero.
   - Today ignores the global Scope; with an active scope the bar renders muted, labeled "Not applied here."

2. **TRADES** — Open Positions + Trade Journal merged; `Open | Closed | All` segments; one table, one filters surface, one stats header. Server-side pagination + total counts (years of broker fills cannot load-everything). Rows open the unified Trade page (§4). CSV import (incl. competitor presets) lives here. localStorage column-pref keys get a migration map when tables merge.

3. **JOURNAL** — Calendar (default view, labeled "Calendar" inside the surface) + day pages + Notebook. Day page unifies day stats, reflection, rules checklist, attachments, that day's trades, day-dated notes. Notebook keeps folders/TipTap; gains a 3-template library (trade review · weekly plan · daily prep — templates, not a template engine) + auto day-stats header block.

4. **INSIGHTS** — Analytics decomposed into routed, lazy sections. **Launch with five:** Overview (equity curve + headline KPIs + Edge Scorecard), Setups/Playbook, Symbols & Time, Risk & Exits, Options. Psychology and Regime arrive P5. Accounts comparison folds into Overview until it earns a section. Every aggregate number drills through to the scoped trade list.

5. **COMPASS** — remains a destination (chat home, reviews, profile, settings) AND embeds contextually: verdict in Add Trade/Add Position, post-mortem on Trade pages, recap on Today. Every Compass surface carries the **"Unlimited — no credits, ever"** badge (the moat is invisible unless labeled). Free tier sees designed teaser states, never broken/hidden nav.

**Chrome:** persistent **"+ Log Trade"** header action on all surfaces (keyboard shortcut; Today's quick actions are shortcuts to it, not its home). Header account switcher with sync-health dot. **Community** moves to header/overflow (feature unchanged). **Settings** → routed sections (mechanical decomposition of the 1,076-line modal; nobody trials a journal for its settings IA — timeboxed). **Settings → Accounts** is the canonical account-management home (broker connect/disconnect, goals); the header switcher and Insights link to it.

**Routing:** real nested React Router routes replace the `?j2tab=` machine. The redirect shim is **permanent** (~20 lines; coach email digests hold deep links forever). Old `g>` hotkeys alias to new ones for a month with a one-time teaching toast. One shared SSE price provider mounts at the J2 layout (single EventSource above all routes — no per-route reconnect churn; respects the shared MAX_SSE_TICKERS cap). Vite `manualChunks` stays object-form when re-splitting routes (known white-screen hazard).

**Nav changes exactly once:** the 8→5 flip (including the Journal *grouping*) ships in P4; Journal *internals* merge in P5 without moving nav again.

---

## 3. Data foundations (the trust spine)

- **ET trading-day spine:** `trading_day_et` + `hour_et` columns on `j2_trades` (and closed option strategies), computed at write/import. `hour_et` is **NULL for date-only rows** (manual entries, some CSV imports); every hour-grouped analytic excludes NULL explicitly — no fake-midnight clusters. Kills the ±1-day-buffer-refilter pattern in `analytics.py` / `calendar.py`.
- **Backfill:** idempotent **admin-triggered endpoint** (batched commits ~500 rows/txn), run off-hours in the web process — never in `init_db`, never before uvicorn binds (`auth.db` also serves logins; boot-blocking is this repo's known incident class). Ships with a before/after snapshot diff. Because historical daily P&L can visibly move: dismissible banner on Trades + Journal for 7 days ("Timestamps recomputed to exchange time — N trades moved days. See what changed →") linking a per-day diff view reachable from any changed calendar cell.
- **One math engine, with a carve-out:** Python (`calculations.py`, `options.py`) is the sole authority for **persisted/closed-trade metrics**. Golden-fixture parity harness (emit fixtures from the Python test suite; run the JS suite against them) ships in P1 as a report; the actual thinning of `calculations.js`/`optionCalcs.js` executes in P3 when the filter contract touches those endpoints anyway. **Live-tick math (open-position P&L, day P&L) stays client-side by design** — the server cannot compute per-SSE-tick values. The parity guarantee becomes Trust Center copy ("every number computed once, server-side, verified against N fixture trades").
- **Manual-entry capture upgrades (P1):** optional entry/exit **time-of-day** fields on Add Trade ("unlocks time analytics + excursions" hint) — without them manual users are excluded by schema from excursions, hour analytics, and the revenge detector. **No-stop contract:** kill the silent stop-defaults-to-entry fallback (`AddTradeModal` line ~83); store null / sentinel + display "R: — (no stop logged)" with one-tap add-stop on the Trade page. Never fabricate R.
- **Annotation identity (P1, hard gate):** all user/derived annotations — screenshots, tags, notes, verdict links, excursions, trade reviews — key on **`(user_id, external_id)`** for broker trades, NOT row UUIDs. Verified: `service.py::_purge_imported` deletes all broker trades on full resync and rebuild mints fresh `uuid4` ids; incremental re-slices can also re-fingerprint. Re-link pass runs after every purge/rebuild; orphaned annotations are **parked and surfaced** (Trust Center queue: "reattach 3 items"), never deleted.
- **Cleanups:** one shared J2 API client (kills per-tab `jsonFetch` copies); merge the two FE lib folders; delete `playbook.py` — and drop `j2_playbook_entries` only after a row-count check, exporting any rows to notebook entries first; stale phase comments + Compass inline styles swept as surfaces are touched (timeboxed hygiene, not a workstream).

---

## 4. Unified Trade page (flagship)

Route `/journal-2-0/trade/:id` (designed against the final route scheme). One page for closed trades, converging with the existing open-position detail pattern (`PositionDetailPage` at `/journal-2-0/position/:sym`, verified live).

**Layout (a page, not an ingredients list):**
1. **Outcome header** — symbol/side/dates, net P&L, R multiple (or "R: — (no stop logged)"), hold time, exit-efficiency % (once P2 lands).
2. **Chart** — entry/exit/stop markers (reuse `useJ2ChartMarkers` + bars API); MFE/MAE shading from P2. **P1 placeholder state:** "Excursion analysis coming — computed nightly from intraday bars" (never an empty region); post-P2 fresh trades show "pending tonight's analysis." Date-only manual trades get daily-candle markers (stated, not silent).
3. **The story** — setup/mistake/emotion tags (inline edit), notes, screenshots. The per-trade **rules checklist** (rules sourced from the setup's Playbook definition, §7; adherence persisted per trade) slots in here when Playbook ships in P5.
4. **Executions** — collapsed by default; broker provenance ("built from these N Robinhood fills" → linked `j2_broker_activities` rows); "Verify against broker" link.
5. **Compass post-mortem** — embedded `TradeReviewCard`.

**Screenshots:** paste/drag, extends the DayAttachments pattern — **gated on an off-volume backup** for the attachments tree (R2 sync or nightly tarball) since the web `/data` volume currently has zero attachment backup.

**Multi-leg options:** legs grouped under one strategy header, combined P&L/R on top, per-leg executions beneath. If too heavy for P1: per-leg rows with a strategy badge, stated interim.

**Navigation:** prev/next honoring the active filter (P1: the Trades-table local filters; Scope-aware from P3), with j/k + arrow keys and Esc-to-list.

**Share:** one-click "export trade card" — branded dark/gold PNG (chart + outcome header + watermark). The product's only organic growth loop; traders post trade recaps daily.

---

## 5. Excursion engine + Exit Quality

**Job placement (corrected):** an **in-web APScheduler job** (scheduler + lock already run in the web process) with async batching — the worker CANNOT do this (separate Railway service, separate `/data` volume; `auth.db` and all `j2_` tables are web-only). Bars read via **internal functions against the local bars cache, never HTTP `/api/bars`** (64-token threadpool; prior 524 starvation). Batched by (symbol, date-range) with cross-user dedupe — trades cluster on symbols/dates; per-trade fetches multiply work. Same-day closed trades compute **on trade-close** (bars already hot in cache); the nightly job handles backfill/repair. Job is tolerant of trades vanishing mid-run (re-check existence at write). Excursion rows key on `(user_id, external_id)`.

**Three-tier data policy (bounded by verified bar reality — Massive intraday lookback caps ~1m=10d, 5m=90d):**
- **Intraday-approximate:** closed ≤90 days → 5m bars (≤10 days gets 1m). Label: "bar-approximate (5m)."
- **Daily-approximate:** older multi-day trades → daily high/low walk. Label: "daily-approximate." This is the tier that serves the owner's multi-year swing history — most of it would otherwise be N/A.
- **N/A:** older same-day trades only. Manual trades without execution times get the distinct label **"N/A — no execution times logged"** (linking to add times) — the bars exist; the timestamps don't.

**Schema:** `j2_trade_excursions` — mfe/mae price, $, R (vs original stop), timing, bar resolution, `data_quality` tier flag.

**Exit Quality (Insights → Risk & Exits):** plain-language module titles with the technical term as subtitle — "How much of the move did you capture?" (exit efficiency), "How much heat do your winners survive?" (MAE analysis). Missed $/R always paired with the top-3 trades driving it (linked) + one-tap "ask Compass why" — the sting becomes the coach's opening, never a bare number. **Coverage gate:** header shows "computed from N of M eligible trades (backfill 62%)"; aggregate missed-$ suppressed until coverage ≥90%. **Options:** excursions via underlying, labeled "underlying-based," **excluded from the blended exit-efficiency %** and headline missed-$ (underlying dollars are not option dollars); reported in a separate labeled sub-section in R/underlying-move terms.

**Honesty invariants (tested, not aspirational):** methodology label on every surface; "N/A" never rendered as 0; assertion tests that no excursion figure renders without its tier label.

---

## 6. Global Scope (one filter, everywhere)

**Contract (backend lands P1/P2; UI lands P3):** one versioned **FilterSpec** — a single pydantic model + a single TS type + ONE URL codec (designed against the final P4 route scheme from day one, so the URL schema migrates zero times). A SQL WHERE-fragment compiler for `j2_trades` + thin adapters for calendar-day aggregation and option strategies over the same spec — no endpoint parses filter params directly, and no one function is forced across three entity shapes. Includes `limit/offset` + total counts. **Containment:** applies to J2 read endpoints (~20); non-journal endpoints untouched. **Decision:** Compass coach tools do NOT honor Scope — the coach always sees the full account (prevents "the coach can't see my trades" confusion).

**Scope bar (P3):** account · date range · symbol · side · setup · tag. Mounted in the OLD nav first (Trade Journal, Calendar, Analytics tabs), **replacing** their local filter rows in the same phase — never stacked filter systems. **Active-scope state is loud:** bar fills gold, shows "N of M trades," pins a Clear button; scoped-empty results say "No trades match this scope — Clear," never a bare empty table (a user concluding trades are missing is a trust incident for a broker-mirror product). Mobile: collapsed one-line chip summary ("RH · 30d · +2 filters") opening a filter sheet.

**Sharing:** URL-serialized scope = shareable filtered links ("send your mentor your last 20 breakout trades as a link") — this is P3's announcement. Saved-views ship as copy-scoped-URL + simple pins; management UI (rename/default) deferred.

**Parity extension:** the golden-fixture harness extends to filtered aggregates — same FilterSpec must yield identical rows across analytics/calendar/trades/setup-stats (filtered numbers disagreeing with totals is the exact complaint we weaponize against competitors).

---

## 7. Edge intelligence

- **Playbook (Insights section, not a new tab):** setup cards on the existing `setup_stats.py` — win rate/PF/expectancy/exit-efficiency per setup — PLUS the piece TradeZella users actually pay for: **rules defined per setup, checked per trade** (the Trade page checklist writes adherence), **adherence % and adherence-vs-expectancy split** on every card. Drill-through to the scoped trade list.
- **Psychology (P5):** Emotion×Outcome matrix, Cost of Mistakes headline, revenge-trade detector, tilt indicator.
  - **Empty state IS the feature** for import-only users (who never tagged anything): a designed pitch card — "Tag your last 20 trades — 2 minutes — and this section comes alive" — launching a rapid one-tap tagging flow over recent trades.
  - Revenge detector requires **≥2 corroborating signals** (loss + re-entry same symbol + within X min), has a per-flag "not revenge" dismissal feeding a suppression list, **skips rows without a real time component**, and shows "requires execution times" on manual accounts instead of a falsely-clean zero.
  - Tilt = small corner **glyph** on calendar day cells (shape-distinct from P&L color, one per cell, colorblind-safe) — not a second color ring.
- **Regime-conditioned analytics (P5, slimmed):** per-trade regime tag captured at entry going forward + ONE "win rate by regime" bar — no matrix until real n exists. Inline "What are regimes?" popover. **Verified data gap:** `regime.py` classifies only the CURRENT regime; no stored historical series exists in J2 — P1 carries a verification task on whether the breadth-history series can backfill; UI labels "since regime history began." Structurally uncopyable (rides proprietary UCT regime data) — this is the capstone announcement.
- **Confidence shading is a launch requirement everywhere:** n<10 stats grayed, including every cross-cut cell (regime×setup, emotion×outcome).
- **Weekly Edge Score card:** composite from the existing Edge Scorecard components, rendered as a shareable branded card — the direct Zella Score answer.

---

## 8. Trust + coach amplification

**Sync Trust Center (P3, v1 scope):** health badge per account + imported-vs-broker activity counts with drill-down + token-expiry warnings BEFORE sync silently dies + sync audit log (all backed by existing `j2_broker_sync_log` / `j2_broker_dup_flags` / `j2_broker_activities` plumbing) + the orphaned-annotation reattach queue (§3). **Hidden for manual accounts** (at most one line: "manual account — nothing to reconcile"). Point-of-doubt trust surfaces outside the Center: sync-health dot on the header switcher; "Verify against broker" on Trade pages.
**Explicitly v2:** the "$X unexplained" daily drift line — it requires a balances/holdings reconciliation engine (dividends/fees/interest/assignments/splits taxonomy) that `broker/sync.py` marks as unbuilt. A wrong drift number attacks our own moat. Named, sized, deferred.

**Coach embeds (early, opt-in, all riding existing endpoints):**
- **Pre-trade verdict embed** in Add Trade / Add Position (P1 — UI over the existing GO/HOLD/SKIP endpoint; the counter-position artifact and the manual-trader's killer feature). Verdict auto-attaches to the resulting trade (keyed by external_id) → **verdict-vs-outcome scoring** later (P6) — the coach held accountable.
- **Auto-drafted day reflection** (P2): EOD recap drafts it; the user edits/accepts instead of writing from scratch. Opt-in, materiality-gated, cached.
- **"Make this a rule"** (P6): one-tap on analytics findings/review bullets → armed intervention with evidence link ("created from your Jun 30 review: 11:30–1:00 window is −$2.1k lifetime"). Suggestion cards only; nothing auto-arms.
- **AI-suggested tags on import** (P6, last, first-cut-if-P6-slips): dashed "suggested" chips, one-tap confirm/reject with telemetry, side-table storage — imported rows never mutated.

**Switching levers:**
- **Competitor CSV import presets (P1):** TradeZella first (largest defector pool), Tradervue/TraderSync as config follow-ons. Full semantics: map competitor setup/tag fields → J2 setups/tags, preserve execution timestamps, route through the standard write path (so imports get `trading_day_et` now and excursions at P2). Import flow spec: upload → auto-detected mapping preview with per-column confidence → dry-run diff ("42 new, 3 duplicates skipped, 1 unparseable — view") → import with undo window. Golden sample files per format checked into tests (formats change silently).
- **Data export (P3):** filtered trades → CSV/JSON, near-free once the FilterSpec exists. "Your data leaves with you."
- **Marketing (P1, zero engineering):** public comparison/pricing page exploiting the claims that exist TODAY — unmetered AI ("no credits, ever"), broker-mirror fidelity, honesty posture ("we tell you when the data isn't good enough — they don't").
- **Broker coverage (P1 verification task):** confirm whether the SnapTrade portal already permits non-Robinhood brokers end-to-end; if yes, that's a marketing claim, not an engineering project. Named here so the decision is conscious.

**Pricing/packaging (owner decision — recommendation only):** 14-day full-access trial (no card); free tier = manual entry + limited history + a weekly coach touch as the unmetered-AI teaser; paid anchored under TradeZella's $288/yr with "Unlimited AI coaching — no credits, ever" as the headline. The design builds the surfaces; the pricing call is the owner's.

---

## 9. Phasing

Every phase: one deployable slice, ships ≥4:20 PM ET, both walkthrough gates (broker-less-with-data + fresh-zero-data), a named announcement, a test gate, and a rollback line.

| Phase | Foundation (invisible) | Visible win | Announcement |
|---|---|---|---|
| **P1a** | ET spine + admin backfill endpoint + snapshot diff · parity harness (report) · FilterSpec backend · `(user_id, external_id)` annotation schema · attachments R2 backup · playbook purge (row-check + archive) · activation telemetry · regime-history + broker-coverage verification tasks | — (dark, gated) | — |
| **P1b** | — | **Trade page** (placeholder excursion state) + screenshots + **competitor CSV import** + time-of-day fields + no-stop contract + **verdict embed** + "no credits, ever" badge + comparison page | "Trade pages, screenshots, and bring your TradeZella history" |
| **P2** | Excursion engine (in-web job, 3-tier policy, on-close compute) + backfill w/ coverage gate | **Exit Quality** section + trade-page MFE/MAE + exit-efficiency in outcome header · auto-drafted reflection (opt-in) | "How much money did your exits leave on the table?" |
| **P3** | JS math thinning (harness-gated) · filtered-aggregate parity | **Scope bar** (old nav, replaces local filters) + **Insights hub** (5 sections, split as sub-nav inside the existing Analytics tab; real URLs arrive with P4's route swap) + drill-through + shareable scoped links + **CSV/JSON export** + **Sync Trust Center v1** | "Filter everything, trust everything" |
| **P4** | Route swap + permanent shim + **runtime kill-switch** (restores 8-tab shell without a deploy — the deploy freeze makes same-day deploy-rollback impossible) · localStorage migrations · shared SSE provider | **Today** (3 states + zero-data + no-sync variants) + 8→5 nav (incl. Journal grouping) + "+ Log Trade" + settings sections (mechanical) + hotkey aliases + what-moved-where (covers Accounts explicitly) + **zero-state pass on every surface** + **mobile bottom nav + quick log** | "The journal now opens somewhere worth opening" |
| **P5** | Journal internals merge (nav already moved) | **Playbook w/ per-trade adherence** + **Psychology** (backfill-tagging flow) + **regime bar** + **weekly Edge Score shareable card** + trade-card PNG export + notebook templates + day-stats header | Capstone: "Your edge, by market regime — no other journal can do this" |
| **P6** | AI cost instrumentation | "Make this a rule" + verdict-vs-outcome scoring + AI-suggested tags (opt-in) + celebration moments (process-based: reflection streaks, tagged-trade milestones — subtle gold, never confetti) + remaining mobile/a11y polish | "The journal that coaches back" |

**Test gates:** P1a parity fixtures green + backfill snapshot-diff on a prod copy; P1b annotation re-link test (purge+rebuild → zero orphans) + import golden files; P2 excursion fixtures with known bar sets + honesty-label assertions (N/A never renders as 0) + coverage-gate tests; P3 golden-query equivalence (same FilterSpec → identical rows across analytics/calendar/trades/setup-stats) + pagination tests; P4 redirect-matrix e2e (Playwright) + hotkey + localStorage-migration + kill-switch drill; P5 confidence-shading tests + adherence math; P6 cost-instrumentation assertions.

**Rollback lines:** P1 additive columns + retained pre-backfill snapshot; P2 new table behind an Insights feature flag; P3 endpoints param-compatible behind equivalence tests; P4 runtime kill-switch; P5/P6 per-feature flags.

**Mobile workstream (spans P4–P6, no native app = mobile web IS the mobile product):** per-surface 390px specs — Today single-column (hero + coach strip above fold), Trade page (chart full-bleed, executions behind a tab), Scope bar (chip + sheet), calendar (week default <640px). "Renders designed at 390px" is a per-phase acceptance criterion from P4 on.

---

## 10. Deferred (v2) — decisions, not accidents

Drift-line reconciliation engine (named + sized separately) · Cmd-K command palette · saved-views management UI · Accounts-comparison Insights section (fold into Overview until multi-broker demand exists) · regime×setup matrix (until n exists) · missed-trade log · pre-market briefing automation · session-review-vs-plan scoring (verdict-vs-outcome covers the accountability loop) · voice debrief · mentor mode · prop-firm tracking · widget customization · full-text notes search · additional-broker marketing push (pending the P1 verification) · pricing changes (owner decision, recommendation in §8).

---

## Appendix A — Code-verified constraints this design is built around

1. Web and worker are separate Railway services with separate `/data` volumes; `auth.db` (all `j2_` tables) is web-only → excursion job runs in-web (§5).
2. `broker/service.py::_purge_imported` deletes all broker trades on full resync; rebuilds mint fresh UUIDs → annotations key on `(user_id, external_id)` (§3).
3. Massive intraday lookback caps (~1m=10d, 5m=90d, `bars_fetch.py`) → three-tier excursion policy (§5).
4. `analytics.py:111-122` ±1-day UTC/ET buffer pattern → ET spine (§3).
5. `AddTradeModal` collects date-only timestamps and defaults blank stop to entry price → capture upgrades + no-stop contract (§3).
6. `regime.py` classifies current regime only; no stored J2 historical series → forward capture + verification task (§7).
7. Balances/holdings reconciliation is explicitly unbuilt (`broker/sync.py` docstring) → drift line deferred (§8).
8. Attachments live on the web `/data` volume; R2 sync covers bars only → backup gate before screenshots (§4).
9. `PositionDetailPage` exists at `/journal-2-0/position/:sym` (App.jsx:173) → Trade page completes an existing pattern (§4).
10. Coach email digests embed permanent deep links → redirect shim is permanent (§2).
11. Prior incidents: 524 threadpool starvation (never HTTP-self-call for bars), worker boot-purge (nothing slow before uvicorn), Vite manualChunks function-form white-screen (stay object-form).
