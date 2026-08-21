# Research Redesign P2 (Launch Modal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose the shipped P1 research-kit into the launch earnings modal (spec §4, §9 "P2-slim") and replace `components/tiles/EarningsModal.jsx` at all three mounts: two-pane glass shell, `IdentityBanner` + Earnings Setup Grade, the four launch sections (Setup · Earnings History · Brief · Call), Analyst & Ownership + Filings as rail LINK items, URL state via `useEarningsModalRoute`, the §4.5 report-night state machine, the phone bottom sheet, the §12 trust posture (methodology page + not-advice line), and the in-house implied-move cutover behind a flag. After this task list the Sep 5 launch slice is code-complete. ⚰️ **Done** — `EarningsResearchModal.jsx` is live in master; the old `components/tiles/EarningsModal.jsx` this plan built alongside was later deleted entirely (`d26cee0c`, see this repo's CLAUDE.md "DOCUMENTED BUT UNREACHABLE" table).

**Architecture:** The kit is FROZEN — P2 adapts to its shipped prop signatures and edits a kit component only where a P2 gate explicitly requires it (exactly three such edits, each named in Global Constraints). Backend lands first because the Setup Grade and the methodology copy are UI-independent. Then pure logic (URL hook + lifecycle state machine + settle debounce) with no DOM. Then the shell, then section-by-section composition. The new modal lives at `app/src/components/research/` — a NEW directory. `components/tiles/EarningsModal.jsx` and its CSS module are **not touched and not deleted** in P2 (see "Rollback posture").

**Tech Stack:** React 19.2, react-router-dom 7.13, SWR 2.4, Vite 7, CSS Modules, vitest 4 + @testing-library/react + jsdom. Backend: FastAPI, pytest, SQLite. **Zero new dependencies.**

## Global Constraints

Read every bullet before Task 1. These are verbatim, already-verified facts read off the shipped code in this worktree — do not re-derive them.

### Where / how to work

- Worktree: `C:\Users\Patrick\uct-worktrees\research-redesign` (branch `feat/research-calendar-redesign`, **clean at `12088b51`**). Spec: `docs/superpowers/specs/2026-08-03-research-calendar-redesign-design.md`. Predecessors: `docs/superpowers/plans/2026-08-03-research-redesign-p1-backend.md`, `…-p1-frontend-a.md`, `docs/superpowers/plans/2026-08-04-research-redesign-p1-frontend-b.md`.
- **`app/node_modules` is a junction** to `C:\Users\Patrick\uct-dashboard\app\node_modules`. **Never delete it.** If `npx vitest` fails with `Cannot find package 'vite'`, recreate it:
  ```
  cmd /c mklink /J "C:\Users\Patrick\uct-worktrees\research-redesign\app\node_modules" "C:\Users\Patrick\uct-dashboard\app\node_modules"
  ```
- **FE test command (verified):** `cd app && npx vitest run <path>`. If a single file OOMs the fork pool, fallback `cd app && npx vitest run --pool=threads <path>`.
- **BE test command:** `python -m pytest tests/<file> -v` from the worktree root.
- **Build:** `cd app && npm run build`.
- Commit after every task. **Never `git add -A`** — shared worktree; `git add` only the files the task names. **Do not push.** Public surfaces ship only on explicit owner approval inside the deploy window (§9).
- Partner-owned files are untouchable: `app/src/pages/OptionsFlow.jsx`, `app/src/pages/OptionsFlow_admin.jsx`, `api/routers/schwab_router.py`, `api/routers/live_massive_router.py`, `api/massive_ws_worker.py`, `api/services/massive_processor.py`.
- Do not touch the 5 existing full-entry echarts imports (`pages/BreadthCharts.jsx`, `pages/breadth/views/TreemapView.jsx`, 3 Journal 2.0 files) — P5.
- **Do not move or rename `AnalystPanel` / `OwnershipPanel` / `FundamentalsStrip` / `SentimentGauge` / `CallRecapSection`** — several vitest suites `vi.mock` them **by module path** (`pages/calendar/myStocksHub.test.jsx`, `pages/research/tabs/CallsTab.test.jsx`, `pages/calendar/callRecap.test.jsx`).

### Design law (spec §3) — restated because tasks execute context-free

- **Breakpoints — only 640 and 1024 exist.** Copy exactly: PHONE `@media (max-width: 640px)` · TABLET `@media (min-width: 641px) and (max-width: 1024px)` · TOUCH `@media (max-width: 1024px)` · DESKTOP `@media (min-width: 1025px)`.
- **CSS modules + tokens only. No inline layout styles.** Permitted exceptions in this plan: SVG attributes, the `style={{ height }}` a chart wrapper sets from its exported `SIZE`, and `SkeletonBlock`'s own `size` prop.
- **No emoji.** Iconography is `UIcon`. **Verified glyph names in the registry** (`app/src/components/ui/UIcon.jsx`): `dashboard wire star breadth markets more chart calendar screener patterns flow moon sun book library journal community pin flame education desk chat shield gear globe bell flag check x expand collapse link mic lock unlock edit volume menu download clock warning info sparkle search plus chevronDown chevronRight compass refresh eye trash equity paperclip rocket dollar document user pill scale thumbsUp thumbsDown wave factory copy magnet play pause skipBack skipForward bolt volumeOff tag ruler wrench noEntry color filter`. **There is no `users` glyph** — Analyst & Ownership uses `user`. Geometric text markers `▲ ▼ ◆ ★ — → ± ✓` are sanctioned and are NOT emoji.
- **`.t-num` on every numeric.** Global plain class; apply beside the module class: ``className={`${styles.value} t-num`}``.
- **Contrast floor (§3.2):** `--text-muted` (`#8c8674`) is the dimmest ink permitted on glass.
- **Gold restraint (§3.1):** gold borders only on the banner, the ONE hero widget per canvas, and the active rail item; **max one gold data-highlight per canvas**. The kit's audit helper enforces it: `app/src/components/research-kit/testing/restraint.js` exports `countAccentSurfaces(container)`, `countGoldHighlights(container)`, `expectOneAccentPerCanvas(container)`, `expectGoldBudget(container, { max = 1 })`. It reads `data-rk-accent` / `data-rk-gold` attributes; **it cannot see canvas-drawn gold** (ECharts markLines).
- **"Verdict" never appears in user-facing copy (§12).** `VerdictChip` is an internal component name only.
- **One ticking element per banner.** `IdentityBanner` renders a `countdown` **slot** and owns no timer; the modal owns the timer.
- **`prefers-reduced-motion: reduce`** disables glow transitions, shimmer, and count-ups; the countdown updates as plain text swaps.

### Test-oracle law (standing lessons — every task obeys these)

- **`Number(null) === 0`.** Never coerce with a bare `Number(v)` + `Number.isFinite` check — a missing value becomes a phantom zero. Use the kit idiom: `const num = (v) => { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null }`. Python side: explicit `is None` checks, never truthiness (a real `0.0` beat rate is data).
- **Test oracles are `data-*` attributes, `role`, or accessible text — NEVER a className regex.** Vitest runs with `css: false`, so `styles.foo` resolves to the literal key `'foo'`; asserting on that couples the test to Vite's module scoping. Existing precedent: the kit reports itself via `data-rk-accent` / `data-rk-gold` / `data-testid`.
- **Fix code, not tests.** When a test fails, the default assumption is the CODE is wrong. If a test itself must change, run the mutation control first: break the implementation deliberately, confirm the test FAILS, restore in place (never `git stash`), then confirm it passes. Take the verdict from the **exit code**, not a grep of output.
- **A check is real only if something fails on it.** Every gate below has a named assertion that must fail when the guarded behaviour is removed.
- **Weekday-clock injection:** no test may depend on the day it runs (8 dashboard tests once failed weekend-only). Every time-dependent test passes an explicit `now`/`nowMs`.

### Verified shipped interfaces (do NOT re-investigate)

**Kit barrel** — `app/src/components/research-kit/index.js` exports everything P2 composes. Prop signatures read off the shipped files:

| Component | Props (verbatim) |
|---|---|
| `IdentityBanner` | `{ logo, sym, company, sector, lifecycle='PRE', timingText, resultText, countdown, price, grade, guidance, stepper, className }` — renders `<header>`; `data-lifecycle` on the root; the timing line carries `data-testid="rk-banner-line"`; the stepper slot `data-testid="rk-banner-stepper"`. Guidance renders **only** in `POST`. |
| `SectionRail` | `{ sections, links, active, onSelect, idPrefix='rk-rail', ariaLabel='Sections', className }` — `sections` = `[{id,label,icon}]` (tabs, `role="tab"`, ids `${idPrefix}-tab-${id}`, `aria-controls=${idPrefix}-panel-${id}`); `links` = `[{id,label,icon,href}]` rendered as `<a>` in a sibling group. Renders `<nav aria-label>` wrapping a `role="tablist"`. Roving tabindex + Home/End via exported `nextIndex`. |
| `PinnedFooter` | `{ children, ariaLabel='Actions', className }` — renders `<footer>`; returns **null** when it has no children. |
| `ImpliedVsRealized` | `{ quarters, impliedHistory, live, historySince, label, info, height, className, ariaLabel }`. Exports `pairQuarters(quarters, impliedHistory, live)`, `coldStartState(pairs, historySince, opts)`, `impliedVerdict(pairs, live)`, `SIZE`. `data-testid`: `rk-ivr`, `rk-ivr-implied`, `rk-ivr-realized`, `rk-ivr-now`, `rk-ivr-cold`. |
| `LollipopChart` | `{ quarters, label, info, height, className, ariaLabel, valueFormatter }`. Reads per row: `quarter`, `session`, `reported`, `eps_estimate`, `eps_actual`, `eps_estimate_low`, `eps_estimate_high`, `surprise_pct`. Exports `beatState`, `buildLollipopOption`, `horizonLabel`, `SIZE`. |
| `ReactionBars` | `{ quarters, impliedPct=null, impliedLabel, label, info, height, className, ariaLabel }`. Reads per row: `quarter`, `reported`, `eps_estimate`, `eps_actual`, `surprise_pct`, `reaction_pct`. Exports `reactionGeometry`, `reactionStats`, `outcomeOf`, `SIZE`. |
| `StatTile` | `{ label, value, sub, tone, info, align='left', className }` |
| `RangeSlider` | `{ min, max, value, lo, hi, minLabel, maxLabel, valueLabel, bandLoLabel, bandHiLabel, tone='neutral', label, info, ariaLabel, className }` |
| `GlassCard` | `{ children, accent=false, elevated=false, as: Tag='section', ariaLabel, className, ...rest }` |
| `VerdictChip` | `{ label, tone='neutral', size='md', glyph, info, className }` |
| `EmptyState` | `{ icon='document', title, hint, compact=false, action, onRetry, retryLabel='Retry', minHeight, className }` |
| `EyebrowLabel` | `{ children, info, as: Tag='div', id, className }` |
| `ConsensusBar` | `{ buy, hold, sell, compact=false, label, info, className }` |
| `RatingChangeList` | shared component; used by the Call section for `rating_changes`. |
| `InfoTip` | `{ label, text, href, hrefLabel='How this is computed →', className }`; `normalizeInfo(info)` accepts a string or `{text, href, hrefLabel}`. |

**Loading idiom:** `import { SkeletonBlock } from '../../Skeleton'` — `{ width, height, size }`; `size` wins per-axis. A chart's `SIZE` is the CHART BOX only; compose `EyebrowLabel` + `SkeletonBlock` to reserve a full section.

**Backend payloads:**

- `GET /api/research/expected-move/{sym}?report_date=` (`api/routers/expected_move.py`, auth via `get_current_user`) → `{ live, history, history_since }`. `live` = `{pct, dollar, expiry, strike, spot, call_mid, put_mid, iv_atm, horizon, asof, source}` or `null`. `history` rows = `{sym, report_date, captured_at, pct, dollar, expiry}`, **newest-first, ≤8**. `history_since` = `MIN(report_date)` or `null`. **Task 1 adds a `grade` key to this payload.**
- `GET /api/earnings-analysis/{sym}` (`api/routers/earnings.py:220`, `@limiter.limit("10/minute")`, **no auth dep**) → `{sym, analysis, analysis_headline, analysis_summary, analysis_bullets[], preview_text, preview_bullets[], beat_history[], yoy_eps_growth, beat_streak, news[], key_quotes[], implied_move, hist_moves, pre_earnings, revisions}`. **Fires the LLM.** Cache keys: `earnings_analysis_v2_{sym}` and `earnings_preview_v2_{sym}`. **Task 2 adds `?cached_only=1`.**
- `GET /api/earnings/call-recap/{ticker}` (`api/routers/earnings_intel.py:32`, auth) → `{ticker, recap, webcast_url, rating_changes}` where `recap` = `{headline, sentiment, bullets[], quotes[], guidance, qa_highlights[]}` **or null**. See "Bugs found" below.
- `GET /api/earnings/audio/{ticker}` → `{stream_url, kind, transcript_url}` or null-ish.
- `GET /api/earnings/sentiment/{ticker}` → `{score, label, rationale, drivers[]}`.
- `GET /api/fundamentals/{ticker}` → `{market_cap, forward_pe, beta, week52_high, week52_low, avg_vol, div_yield}`.
- `GET /api/filings/{ticker}?count=10` → `{ticker, filings: [{form, filed, url, ...}]}`.
- `GET /api/research/estimates/{sym}` → includes `revisions: [{period, current, ago30, ago90, up30, down30}]`.
- `GET /api/calendar/next-report?sym=` (auth) → `{sym, date, timing, date_est}` — **the deep-link jump-to-week source**; `date` is `null` for unknown names (negative-cached 300 s).
- `GET /api/snapshot/{sym}` → `{change_pct, ...}` (the old modal's live gap read).

**Existing FE hooks to reuse verbatim** (all in `app/src/hooks/`): `useCallRecap` (`/api/earnings/call-recap/{t}`, 30 min), `useEarningsAudio`, `useSentiment`, `useFilings`, `useFundamentals`, `useTranscript(ticker, {enabled, quarter})` (lazy — `enabled` gates the AV-quota fetch), `useAnalystIntel`, `useOwnership`, `useMobileSWR`.

**Calendar feed entry shape** (`api/routers/calendar.py`): `{sym, eps_est, eps_act, rev_est, rev_act, ew, mc_b, time_et, date_est, ...}` plus the enrichment overlay `{expected_move, beat_history, hist_stats}` merged client-side by `pages/calendar/useCalendarData.js`. `beat_history` = `get_earnings_intel(sym)["beat_history"]` = **newest-first, ≤4** rows `{period, actual, estimate, beat, surprise}`. `hist_stats` = `{avg_abs_move, up_count, total, last_n}` where `last_n` is **newest-first, ≤8** next-day move percentages. `date_est: true` means the session is UNCONFIRMED. `time_et` is an ISO string documented as ET but **not guaranteed to carry an offset**.

**Row builder:** `app/src/pages/calendar/earningsModalRow.js` — `toModalRow(entry)` → `{sym, verdict, reported_eps, eps_estimate, surprise_pct, rev_actual, rev_estimate, rev_surprise_pct}`; `timingLabel(timing)` → `'BEFORE MARKET OPEN' | 'AFTER MARKET CLOSE' | 'TIME TBD'`; `calcSurprise(act, est)`.

**The three mounts (verbatim, all three wrap in a KEYED ErrorBoundary that must be un-keyed):**
- `app/src/pages/Calendar.jsx:627-643` — `<ErrorBoundary fallback={…} key={selected.row.sym}>`; state `const [selected, setSelected] = useState(null)`; built by `onSelect(entry, timing)` at :490-494 as `{row: toModalRow(entry), label, reportDate: entry._ds, timing}`. Calendar already owns `useSearchParams` at :88 with `?week` (:89-96) and `?d` (:98) — **merge-preserving writes required**.
- `app/src/pages/calendar/MyStocksHub.jsx:436-450` — same boundary, `key={selected.row.sym}`, passes only `row` + `label`.
- `app/src/components/tiles/CatalystFlow.jsx:146-154` — same boundary, `key={selected.row.sym}`. **CatalystFlow keeps plain local state** (the Dashboard mounts two live CatalystFlow instances, desktop + mobile).

**`ResearchPage` has NO URL param today** — `app/src/pages/research/ResearchPage.jsx:17` `const TABS = ['Overview','Financials','Estimates','Ratings','Ownership','Calls & Transcript','Filings & Events']`, `:23 const [active, setActive] = useState('Overview')`. Task 6 adds minimal `?section=` seeding so the rail's link items actually land where they promise.

**`rs_ranking.get_rs_for_ticker(ticker)`** is a **pure cache lookup** (never triggers the ~17 s universe rebuild) → `{ticker, rs_score, rs_rank, returns}` where `rs_rank` is a **1–99 percentile**, or `None` when cold.

**`implied_store`** (`api/services/implied_store.py`): `record_grade(sym, date, surface, grade, inputs)` (INSERT OR REPLACE on `(sym,date,surface)`), `get_grade_history(sym, surface, limit=30)`, `upcoming_reporters(days=14, now=None)` → `[{sym, report_date, hour}]` (empty on any failure), `run_nightly_capture(now=None)`. Symbols are canonicalised to `UPPER` with `.`→`-`. The nightly capture is registered in `api/main.py:2632-2639` behind `IMPLIED_STORE_ENABLED=1` at **16:35 ET Mon–Fri**.

### The rulings this plan encodes (each is a task or an explicit task step)

1. **Launch sections = Setup · Earnings History · Brief · Call.** Analyst & Ownership and Filings are RAIL **LINK** items (`SectionRail`'s `links` group) that deep-open `/research/:sym?section=…`. They are NOT in-modal sections.
2. **`useEarningsModalRoute`** is built on `useSearchParams` with **merge-preserving writes** (raw `window.history.pushState` is banned). `?earnings=SYM` is pushed **once** on open so Back closes in one press; stepping and `&esection=` use **replace**. The param is honored on `/calendar` and `/calendar/mystocks` **only**.
3. **Deep-link resolution:** loaded feed → `GET /api/calendar/next-report` then jump-to-week via a merge-preserving `?week=` write → minimal row (`{sym}`) with `EmptyState` sections.
4. **Un-key the `ErrorBoundary` at all three mounts** (keep the boundary).
5. **~200 ms settle debounce** before section data hooks fire on arrow-stepping; only the live-price poll runs during stepping.
6. **Brief renders cached-only when the symbol was reached by stepping** — it never auto-fires the LLM path on a stepped-to name.
7. **§4.5 state machine is a pure function of data timestamps.** The IMMINENT actuals poll (30–60 s) runs **only** while the modal is open on a today-reporter in IMMINENT.
8. **Setup Grade is computed SERVER-SIDE** and folded into the expected-move payload (justified in Task 1). Missing input → partial-basis chip. Weights published on `/methodology`. Recorded daily via `implied_store.record_grade`.
9. **"n/8 recorded" counts STORED snapshots only** — never tonight's live implied. `coldStartState` counts pairs internally (which INCLUDES the live current quarter), so Task 7 adds a `recordedCount` prop override and the caller passes `history.length`.

### P2 HARD GATES (each has a named failing assertion)

| # | Gate | Where it is enforced |
|---|---|---|
| **a** | REAL-BROWSER render verification of `LollipopChart` and the composed modal | **Task 11 — CONTROLLER-EXECUTED**, written as a checklist for the controller (which has browser tools), not a subagent. |
| **b** | Landmark roles asserted PER-SURFACE via `as` props: inside the modal the banner/footer must **not** be page landmarks | Task 6 adds `as` to `IdentityBanner` + `PinnedFooter` (kit edit #1 and #2); the modal passes `as="div"`; test asserts `queryByRole('banner')` and `queryByRole('contentinfo')` are **null** inside the modal AND that the kit defaults still produce them (keeps `IdentityBanner.test.jsx:116` green). |
| **c** | Rail panels **UNMOUNT** when inactive — never `display:none` (ECharts zero-width mount trap) | Task 6: `{active === id && <Section/>}`; test asserts the inactive panel's `data-testid` is absent from the DOM, and that no `[hidden]`/`display:none` panel exists. |
| **d** | Re-measure `vendor-echarts` + new-chunk sizes at the FIRST commit that imports the kit from the app tree; record the delta as the honest bundle cost | Task 6 Step 5 (the shell is that first commit) records baseline→after in the commit message; Task 12 re-measures the final state. |
| **e** | `SentimentGauge` kit restyle (a P2 section dependency of the Call section) | Task 10 — restyle `SentimentGauge.module.css` onto kit tokens + add `data-testid`; **JSX props unchanged** so `CallsTab` and `TickerPopup` keep working. |
| **f** | Enrichment implied-move cutover behind `IMPLIED_ENRICHMENT_CUTOVER=1`, **default off** | Task 2. |

### Rollback posture (stated, not optional)

The spec makes P2 a **full replacement**, not a feature flag. `app/src/components/tiles/EarningsModal.jsx` + `EarningsModal.module.css` stay on disk, unmodified, until P5 deletes them. **Rollback = revert the three mount edits** (Task 11's commit touches only `Calendar.jsx`, `MyStocksHub.jsx`, `CatalystFlow.jsx`) — one revert restores the old surface with zero other churn. That is why the mount integration is its own final-ish task and why no other task may edit those three files.

### Bugs found while writing this plan (disclosure — do not "discover" them again)

1. **`CallRecapSection` is being fed the wrong object at two of three call sites.** The endpoint returns `{ticker, recap, webcast_url, rating_changes}`; `CallRecapSection` reads `recap.headline`, `recap.sentiment`, `recap.bullets`, `recap.quotes`, `recap.guidance`, `recap.qa_highlights` (inner) **and** `recap.webcast_url`, `recap.rating_changes` (outer). So:
   - `components/tiles/EarningsModal.jsx:454` passes the **wrapper** → the entire recap body renders blank (webcast + rating changes work).
   - `pages/calendar/MyStocksHub.jsx:244` passes the **wrapper** → same.
   - `pages/research/tabs/CallsTab.jsx:10` passes `recapData?.recap` → body works, **webcast_url and rating_changes are lost**.
   **Neither shape is correct.** Task 10 ships `normalizeCallRecap(payload)` — a flat merge of the inner recap plus the two outer fields — and the new modal consumes it. Fixing `MyStocksHub`/`CallsTab` is explicitly **out of P2 scope** (P3 owns the page; the MyStocksHub Calls tab is untouched by this plan) — record it in the punch list.
2. **The in-house `pct` is unrounded.** `earnings_enrichment.get_implied_move` returns `round(pct, 1)`; `implied_move.get_expected_move` returns a raw float, and `pages/calendar/CalendarDayTable.jsx:87` prints `±${e.expected_move.pct}%` **without formatting**. The Task 2 cutover MUST round `pct` to 1 dp and `dollar` to 2 dp at the enrichment boundary or the calendar renders `±6.234567891%`. FE readers of `expected_move` were swept: only `.pct` is consumed (`CalendarDayTable`, `EarningsCard`, `EarningsTile`, `filterLogic`, `importance`, `MainEventCard`, `WeekView`, `useCalendarData`) — no consumer reads `call_mark`/`put_mark`, so the field rename to `call_mid`/`put_mid` is safe.

### Resolved unknowns (do not re-investigate)

- **`setSearchParams` accepts a functional updater** in react-router-dom 7.13 — `setSearchParams(prev => next, { replace })`. That is how merge-preserving writes avoid clobbering `?week`/`?d`.
- **Phone branch may read `useIsPhone()` at mount.** The stale-first-paint trap (`useMediaQuery` seeds at mount, only updates on a `change` event) applies to components that mount before layout settles. This modal mounts **as the direct result of a tap/click**, which is the sanctioned `useIsTouch()`-style case documented in CLAUDE.md ("reserve `useIsTouch()` for click-triggered conditional rendering: open a `Sheet` vs anchored popover on tap"). Everything else (two-pane vs stacked, rail vs chip row) is CSS `@media`.
- **`Sheet.jsx` already confines drag-to-dismiss to the grip** — `onPointerDown/Move/Up` are bound to `styles.grip` only, so canvas scrolling cannot fight the gesture. **No Sheet edit is required.** Sheet does NOT implement a focus trap (it focuses the panel once); the modal supplies its own trap on both paths.
- **`ImpliedVsRealized.pairQuarters` marks the current quarter by `q.reported === false`** and only then falls back to `live.pct`. Task 8's `buildQuarters` therefore keeps the report-date row at `reported: false` **while its `reaction_pct` is unknown** — see the note in that task.
- **ECharts registration is complete for what P2 draws** (`BarChart`, `CustomChart`, `GridComponent`, `TooltipComponent`, `MarkLineComponent`, `AxisPointerComponent`, `CanvasRenderer` via `charts/echartsCore.js`). P2 registers nothing new.
- **`GET /api/research/earnings-history/{sym}` does not exist** (spec §6 row 3 — P4). P2 composes the quarter rows client-side from `beat_history` + `hist_stats`, in the **frozen row shape** the kit charts already consume.

## File Structure

**Backend**
- CREATE `api/services/setup_grade.py`, `tests/test_setup_grade.py`
- MODIFY `api/routers/expected_move.py` (fold `grade`), `api/main.py` (one scheduler job), `api/routers/earnings.py` (`?cached_only=`), `api/routers/calendar.py` (cutover flag)
- CREATE `tests/test_earnings_analysis_cached_only.py`, `tests/test_enrichment_implied_cutover.py`; MODIFY `tests/test_expected_move_router.py`

**Frontend — new**
- `app/src/constants/disclaimer.js`
- `app/src/pages/Methodology.jsx` + `.module.css` + `.test.jsx`
- `app/src/pages/calendar/useEarningsModalRoute.js` + `.test.jsx`
- `app/src/pages/calendar/earningsLifecycle.js` + `.test.js`
- `app/src/hooks/useSettledSym.js` + `.test.jsx`
- `app/src/hooks/useExpectedMove.js`, `app/src/hooks/useEarningsBrief.js`
- `app/src/components/research/EarningsResearchModal.jsx` + `.module.css` + `.test.jsx`
- `app/src/components/research/railSections.js`
- `app/src/components/research/earningsHistoryModel.js` + `.test.js`
- `app/src/components/research/callRecap.js` + `.test.js`
- `app/src/components/research/sections/SetupSection.jsx` + `.module.css` + `.test.jsx`
- `app/src/components/research/sections/EarningsHistorySection.jsx` + `.module.css` + `.test.jsx`
- `app/src/components/research/sections/BriefSection.jsx` + `.module.css` + `.test.jsx`
- `app/src/components/research/sections/CallSection.jsx` + `.module.css` + `.test.jsx`

**Frontend — modified**
- `app/src/App.jsx` (one route)
- `app/src/pages/research/ResearchPage.jsx` (`?section=` seeding)
- `app/src/components/calendar/SentimentGauge.module.css` + `SentimentGauge.jsx` (testids only)
- **Kit edits (3, gate-required only):** `research-kit/shell/IdentityBanner.jsx` (`as`), `research-kit/shell/PinnedFooter.jsx` (`as`), `research-kit/charts/ImpliedVsRealized.jsx` (`recordedCount`)
- **Mounts (Task 11 only):** `app/src/pages/Calendar.jsx`, `app/src/pages/calendar/MyStocksHub.jsx`, `app/src/components/tiles/CatalystFlow.jsx`

---

### Task 1: Earnings Setup Grade — service, payload fold, daily snapshot

**Files:**
- Create: `api/services/setup_grade.py`
- Test: `tests/test_setup_grade.py`
- Modify: `api/routers/expected_move.py`, `api/main.py`, `tests/test_expected_move_router.py`

**Architecture decision (justified, not assumed):** the grade is folded into `GET /api/research/expected-move/{sym}` as a `grade` key rather than getting its own endpoint. Three load-bearing reasons: (1) the grade's fourth input **is** that endpoint's `live` payload — a separate endpoint would either duplicate the Massive chain read or race it; (2) the banner chip and the Setup hero appear together on open, so one request serves both and the modal's open path stays at a single research round-trip, which matters under the ~200 ms stepping budget; (3) that router is already failure-isolated per section and always mounted, so a grade failure degrades to `grade: null` instead of creating a new 500 surface. Callers that want only the move pass `?grade=0`.

**Interfaces:**
- `setup_grade.WEIGHTS = {"beat_streak": 0.30, "revision_30d": 0.30, "rs_rank": 0.25, "iv_premium": 0.15}` — published verbatim on `/methodology`.
- `letter_for(score: float) -> str`
- `score_beat_streak(beat_history) -> tuple[float | None, str | None]`
- `score_revision_30d(revisions) -> tuple[float | None, str | None]`
- `score_rs_rank(rs) -> tuple[float | None, str | None]`
- `score_iv_premium(implied_pct, avg_abs_realized_pct) -> tuple[float | None, str | None]`
- `compute_grade(scored: dict[str, tuple | None]) -> dict | None` — pure; `None` below `MIN_INPUTS`.
- `gather_inputs(sym, live_move=None) -> dict[str, tuple | None]` — impure; every source individually try/excepted.
- `get_setup_grade(sym, live_move=None) -> dict | None`
- `run_daily_grade_snapshot(now=None) -> dict`
- Payload: `{"letter","score","basis","inputs_present","inputs_total","inputs":[{"key","label","weight","available","score","detail"}],"asof"}`. `basis` is `None` when all four inputs are present, else `"3 of 4 inputs"`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_setup_grade.py
import datetime as dt
from unittest.mock import patch

from api.services import setup_grade as sg


# ── pure sub-scores ───────────────────────────────────────────────────────────

def test_weights_are_the_published_four_and_sum_to_one():
    assert set(sg.WEIGHTS) == {"beat_streak", "revision_30d", "rs_rank", "iv_premium"}
    assert abs(sum(sg.WEIGHTS.values()) - 1.0) < 1e-9


def test_beat_streak_scores_only_rows_with_a_verdict():
    hist = [{"beat": True}, {"beat": True}, {"beat": False}, {"beat": None}]
    score, detail = sg.score_beat_streak(hist)
    assert score == 200 / 3            # 2 of 3 CONSIDERED, the None row excluded
    assert detail == "2 of 3 beats"
    assert sg.score_beat_streak([]) == (None, None)
    assert sg.score_beat_streak([{"beat": None}]) == (None, None)
    assert sg.score_beat_streak(None) == (None, None)


def test_beat_streak_zero_beats_is_a_real_zero_not_a_missing_input():
    # Number(null)==0 analogue in reverse: a genuine 0.0 must survive as DATA,
    # so the code may never use truthiness to detect availability.
    score, detail = sg.score_beat_streak([{"beat": False}, {"beat": False}])
    assert score == 0.0 and detail == "0 of 2 beats"


def test_revision_30d_uses_the_first_row_carrying_counts():
    rows = [{"period": "0q", "up30": None, "down30": None},
            {"period": "+1q", "up30": 6, "down30": 2}]
    score, detail = sg.score_revision_30d(rows)
    assert score == 75.0 and detail == "6 up / 2 down (30d)"
    # zero revisions is NO SIGNAL, not a neutral 50
    assert sg.score_revision_30d([{"period": "0q", "up30": 0, "down30": 0}]) == (None, None)
    assert sg.score_revision_30d(None) == (None, None)


def test_rs_rank_passes_the_percentile_through():
    assert sg.score_rs_rank({"rs_rank": 88}) == (88.0, "RS 88 of 99")
    assert sg.score_rs_rank({"rs_rank": None}) == (None, None)
    assert sg.score_rs_rank(None) == (None, None)


def test_iv_premium_is_high_when_cheap_and_zero_when_rich():
    cheap, detail = sg.score_iv_premium(3.0, 6.0)      # ratio 0.5
    fair, _ = sg.score_iv_premium(6.0, 6.0)            # ratio 1.0
    rich, _ = sg.score_iv_premium(9.0, 6.0)            # ratio 1.5
    assert cheap == 100.0 and fair == 50.0 and rich == 0.0
    assert detail == "±3.0% priced vs ±6.0% typical"
    assert sg.score_iv_premium(20.0, 6.0)[0] == 0.0    # clamped, never negative
    assert sg.score_iv_premium(-6.0, 6.0)[0] == 50.0   # implied is a MAGNITUDE
    assert sg.score_iv_premium(None, 6.0) == (None, None)
    assert sg.score_iv_premium(6.0, 0) == (None, None)


def test_letter_ladder_is_monotonic_and_floors_at_f():
    assert sg.letter_for(95) == "A+" and sg.letter_for(93) == "A+"
    assert sg.letter_for(71) == "B+" and sg.letter_for(70.9) == "B"
    assert sg.letter_for(0) == "F" and sg.letter_for(14.9) == "F"
    ladder = [sg.letter_for(s) for s in range(0, 101)]
    assert ladder[0] == "F" and ladder[100] == "A+"


# ── composition + partial basis ───────────────────────────────────────────────

def test_compute_grade_full_basis_has_no_basis_string():
    out = sg.compute_grade({
        "beat_streak": (100.0, "4 of 4 beats"),
        "revision_30d": (75.0, "6 up / 2 down (30d)"),
        "rs_rank": (88.0, "RS 88 of 99"),
        "iv_premium": (50.0, "±6.0% priced vs ±6.0% typical"),
    })
    assert out["basis"] is None
    assert out["inputs_present"] == 4 and out["inputs_total"] == 4
    expected = 100 * .30 + 75 * .30 + 88 * .25 + 50 * .15
    assert out["score"] == round(expected, 1)
    assert out["letter"] == sg.letter_for(expected)
    assert [i["key"] for i in out["inputs"]] == list(sg.WEIGHTS)   # stable order
    assert all(i["weight"] == sg.WEIGHTS[i["key"]] for i in out["inputs"])
    assert all(i["available"] for i in out["inputs"])


def test_compute_grade_renormalises_over_present_weights_and_states_the_basis():
    out = sg.compute_grade({
        "beat_streak": (100.0, "4 of 4 beats"),
        "revision_30d": (50.0, "3 up / 3 down (30d)"),
        "rs_rank": (60.0, "RS 60 of 99"),
        "iv_premium": None,
    })
    assert out["basis"] == "3 of 4 inputs"
    assert out["inputs_present"] == 3
    expected = (100 * .30 + 50 * .30 + 60 * .25) / (.30 + .30 + .25)
    assert out["score"] == round(expected, 1)
    missing = next(i for i in out["inputs"] if i["key"] == "iv_premium")
    assert missing["available"] is False and missing["score"] is None
    assert missing["detail"] is None


def test_compute_grade_refuses_to_speak_below_two_inputs():
    assert sg.compute_grade({"rs_rank": (60.0, "RS 60 of 99")}) is None
    assert sg.compute_grade({k: None for k in sg.WEIGHTS}) is None
    assert sg.compute_grade({}) is None


# ── gather + orchestration ────────────────────────────────────────────────────

def _boom(*a, **k):
    raise RuntimeError("provider down")


def test_gather_inputs_survives_every_source_failing():
    with patch.object(sg, "_beat_history", _boom), \
         patch.object(sg, "_revisions", _boom), \
         patch.object(sg, "_rs", _boom), \
         patch.object(sg, "_avg_abs_realized", _boom):
        got = sg.gather_inputs("TST", live_move={"pct": 6.0})
    assert got == {k: None for k in sg.WEIGHTS}


def test_one_dead_source_costs_exactly_one_input():
    with patch.object(sg, "_beat_history", _boom), \
         patch.object(sg, "_revisions", return_value=[{"up30": 4, "down30": 0}]), \
         patch.object(sg, "_rs", return_value={"rs_rank": 90}), \
         patch.object(sg, "_avg_abs_realized", return_value=6.0):
        out = sg.get_setup_grade("TST", live_move={"pct": 6.0})
    assert out["basis"] == "3 of 4 inputs"
    assert next(i for i in out["inputs"] if i["key"] == "beat_streak")["available"] is False


def test_get_setup_grade_uses_the_live_move_it_is_handed():
    with patch.object(sg, "_beat_history", return_value=[{"beat": True}, {"beat": True}]), \
         patch.object(sg, "_revisions", return_value=[{"up30": 4, "down30": 0}]), \
         patch.object(sg, "_rs", return_value={"rs_rank": 90}), \
         patch.object(sg, "_avg_abs_realized", return_value=6.0):
        out = sg.get_setup_grade("TST", live_move={"pct": 3.0})
    assert out["basis"] is None
    iv = next(i for i in out["inputs"] if i["key"] == "iv_premium")
    assert iv["score"] == 100.0        # 3.0 / 6.0 = cheap


def test_get_setup_grade_without_a_live_move_is_a_3_of_4_partial():
    with patch.object(sg, "_beat_history", return_value=[{"beat": True}]), \
         patch.object(sg, "_revisions", return_value=[{"up30": 4, "down30": 0}]), \
         patch.object(sg, "_rs", return_value={"rs_rank": 90}), \
         patch.object(sg, "_avg_abs_realized", return_value=6.0):
        out = sg.get_setup_grade("TST", live_move=None)
    assert out["basis"] == "3 of 4 inputs"


def test_realized_average_never_caches_a_failure():
    from api.services.cache import cache
    cache.invalidate("setup_grade_realized_TST")
    with patch("api.services.earnings_enrichment.get_historical_earnings_moves",
               return_value=None), \
         patch("api.services.engine._fetch_quarterly_history", return_value=[]):
        assert sg._avg_abs_realized("TST") is None
    assert cache.get("setup_grade_realized_TST") is None


# ── §12 accountability record ─────────────────────────────────────────────────

def test_daily_snapshot_records_one_row_per_symbol_and_dedupes():
    reporters = [{"sym": "AAA", "report_date": "2026-08-05", "hour": "amc"},
                 {"sym": "AAA", "report_date": "2026-08-05", "hour": "amc"},
                 {"sym": "BBB", "report_date": "2026-08-12", "hour": "bmo"}]
    calls = []
    grade = {"letter": "B+", "score": 71.2, "basis": None, "inputs_present": 4,
             "inputs_total": 4, "inputs": [{"key": "rs_rank"}], "asof": "x"}
    with patch.object(sg.implied_store, "upcoming_reporters", return_value=reporters), \
         patch.object(sg.implied_store, "record_grade",
                      side_effect=lambda **kw: calls.append(kw)), \
         patch.object(sg, "get_setup_grade", return_value=grade):
        summary = sg.run_daily_grade_snapshot(now=dt.datetime(2026, 8, 4, 16, 40))
    assert summary == {"recorded": 2, "skipped": 0, "failed": 0}
    assert [c["sym"] for c in calls] == ["AAA", "BBB"]
    assert calls[0]["date"] == "2026-08-04"          # injected clock, never date.today()
    assert calls[0]["surface"] == sg.SURFACE == "setup"
    assert calls[0]["grade"] == "B+" and calls[0]["inputs"] == grade["inputs"]


def test_daily_snapshot_skips_ungradeable_and_isolates_one_bad_symbol():
    reporters = [{"sym": "AAA", "report_date": "2026-08-05"},
                 {"sym": "BBB", "report_date": "2026-08-05"},
                 {"sym": "CCC", "report_date": "2026-08-05"}]

    def _grade(sym, live_move=None):
        if sym == "AAA":
            raise RuntimeError("boom")
        return None if sym == "BBB" else {"letter": "C", "inputs": []}

    with patch.object(sg.implied_store, "upcoming_reporters", return_value=reporters), \
         patch.object(sg.implied_store, "record_grade"), \
         patch.object(sg, "get_setup_grade", side_effect=_grade):
        summary = sg.run_daily_grade_snapshot(now=dt.datetime(2026, 8, 4, 16, 40))
    assert summary == {"recorded": 1, "skipped": 1, "failed": 1}


def test_daily_snapshot_is_bounded():
    reporters = [{"sym": f"S{i}", "report_date": "2026-08-05"} for i in range(500)]
    with patch.object(sg.implied_store, "upcoming_reporters", return_value=reporters), \
         patch.object(sg.implied_store, "record_grade"), \
         patch.object(sg, "get_setup_grade", return_value={"letter": "C", "inputs": []}), \
         patch.object(sg, "MAX_SNAPSHOT_SYMBOLS", 25):
        summary = sg.run_daily_grade_snapshot(now=dt.datetime(2026, 8, 4, 16, 40))
    assert summary["recorded"] == 25


def test_daily_snapshot_no_ops_on_an_empty_reporter_list():
    # upcoming_reporters returns [] on ANY failure and on holidays.
    with patch.object(sg.implied_store, "upcoming_reporters", return_value=[]), \
         patch.object(sg.implied_store, "record_grade") as rec:
        summary = sg.run_daily_grade_snapshot(now=dt.datetime(2026, 8, 4, 16, 40))
    assert summary == {"recorded": 0, "skipped": 0, "failed": 0}
    rec.assert_not_called()
```

Append to `tests/test_expected_move_router.py` (reuses its existing `_client_with_auth()` helper):

```python
def test_expected_move_payload_carries_the_setup_grade():
    client, app, em_router = _client_with_auth()
    live = {"pct": 6.8, "dollar": 12.5, "expiry": "2026-08-07", "strike": 185.0,
            "spot": 184.0, "call_mid": 6.3, "put_mid": 6.2, "iv_atm": 0.6,
            "horizon": "through 2026-08-07", "asof": "x", "source": "massive-chain"}
    grade = {"letter": "B+", "score": 71.2, "basis": "3 of 4 inputs",
             "inputs_present": 3, "inputs_total": 4, "inputs": [], "asof": "x"}
    with patch.object(em_router.implied_move, "get_expected_move", return_value=live), \
         patch.object(em_router.implied_store, "get_implied_history", return_value=[]), \
         patch.object(em_router.implied_store, "get_earliest_report_date", return_value=None), \
         patch.object(em_router.setup_grade, "get_setup_grade", return_value=grade) as gs:
        r = client.get("/api/research/expected-move/TST?report_date=2026-08-06")
    app.dependency_overrides.clear()
    assert r.json()["grade"]["letter"] == "B+"
    # handed the live move the endpoint already computed — never a second chain read
    assert gs.call_args.kwargs["live_move"] == live


def test_expected_move_grade_failure_degrades_to_null_not_500():
    client, app, em_router = _client_with_auth()
    with patch.object(em_router.implied_move, "get_expected_move", return_value=None), \
         patch.object(em_router.implied_store, "get_implied_history", return_value=[]), \
         patch.object(em_router.implied_store, "get_earliest_report_date", return_value=None), \
         patch.object(em_router.setup_grade, "get_setup_grade",
                      side_effect=RuntimeError("boom")):
        r = client.get("/api/research/expected-move/TST")
    app.dependency_overrides.clear()
    assert r.status_code == 200 and r.json()["grade"] is None


def test_expected_move_grade_can_be_opted_out():
    client, app, em_router = _client_with_auth()
    with patch.object(em_router.implied_move, "get_expected_move", return_value=None), \
         patch.object(em_router.implied_store, "get_implied_history", return_value=[]), \
         patch.object(em_router.implied_store, "get_earliest_report_date", return_value=None), \
         patch.object(em_router.setup_grade, "get_setup_grade") as gs:
        r = client.get("/api/research/expected-move/TST?grade=0")
    app.dependency_overrides.clear()
    assert r.json()["grade"] is None
    gs.assert_not_called()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_setup_grade.py tests/test_expected_move_router.py -v`
Expected: `ModuleNotFoundError: No module named 'api.services.setup_grade'` and `AttributeError: module 'api.routers.expected_move' has no attribute 'setup_grade'`.

- [ ] **Step 3: Implement**

```python
# api/services/setup_grade.py
"""Earnings Setup Grade (spec §4.2) — deterministic, published arithmetic.

Grades THIS EVENT. The stock is graded elsewhere (the /research RatingCrown's
0-99 UCT Rating); the two are deliberately different instruments and the UI
gives them different visual identities (chip vs ring).

Four inputs, fixed weights, RENORMALISED over whatever is actually available,
so a missing input yields an honest partial basis ("B+ · 3 of 4 inputs")
instead of a silent recompute or a skeleton that blocks pre-market triage.

EVERY weight and threshold below is published verbatim on /methodology (§12).
Change one here and you MUST change app/src/pages/Methodology.jsx in the same
commit — "documented in code" is not a user-facing posture.
"""
from __future__ import annotations

import datetime as _dt
import logging
import os

from api.services import implied_store
from api.services.cache import cache

_log = logging.getLogger(__name__)

SURFACE = "setup"

WEIGHTS: dict[str, float] = {
    "beat_streak": 0.30,
    "revision_30d": 0.30,
    "rs_rank": 0.25,
    "iv_premium": 0.15,
}

LABELS: dict[str, str] = {
    "beat_streak": "Beat streak",
    "revision_30d": "Estimate revisions (30d)",
    "rs_rank": "Relative strength rank",
    "iv_premium": "Options premium vs typical move",
}

# Descending; the first threshold met wins. Anything under the last one is F.
LETTER_THRESHOLDS: list[tuple[float, str]] = [
    (93, "A+"), (85, "A"), (78, "A-"),
    (71, "B+"), (64, "B"), (57, "B-"),
    (50, "C+"), (43, "C"), (36, "C-"),
    (29, "D+"), (22, "D"), (15, "D-"),
]
FLOOR_LETTER = "F"

# Below this many available inputs the grade is not stated AT ALL. One input is
# not a grade, it is that input wearing a letter.
MIN_INPUTS = 2

# Bound on the nightly snapshot sweep (§6: cheap, but never unbounded).
MAX_SNAPSHOT_SYMBOLS = int(os.environ.get("GRADE_SNAPSHOT_MAX", "120"))

# The realized-move average is stable for closed quarters; 24h matches the
# posture the calendar's past-day enrichment already takes.
_REALIZED_TTL = 24 * 3600


def letter_for(score: float) -> str:
    for floor, letter in LETTER_THRESHOLDS:
        if score >= floor:
            return letter
    return FLOOR_LETTER


def _num(v):
    """None-preserving numeric coercion. `float(None)` raises and `bool(0.0)` is
    False, so neither shortcut is safe here: a genuine 0.0 IS data."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return f


# ── sub-scores: each returns (0..100 score, human detail) or (None, None) ──────

def score_beat_streak(beat_history) -> tuple[float | None, str | None]:
    rows = [r for r in (beat_history or [])
            if isinstance(r, dict) and r.get("beat") is not None]
    if not rows:
        return None, None
    beats = sum(1 for r in rows if r["beat"])
    return 100.0 * beats / len(rows), f"{beats} of {len(rows)} beats"


def score_revision_30d(revisions) -> tuple[float | None, str | None]:
    for row in revisions or []:
        if not isinstance(row, dict):
            continue
        up, down = _num(row.get("up30")), _num(row.get("down30"))
        if up is None and down is None:
            continue
        up, down = up or 0.0, down or 0.0
        total = up + down
        if total <= 0:
            # Zero revisions is NO SIGNAL, not a neutral 50 — scoring it 50
            # would quietly drag the whole grade toward the middle.
            continue
        return 100.0 * up / total, f"{int(up)} up / {int(down)} down (30d)"
    return None, None


def score_rs_rank(rs) -> tuple[float | None, str | None]:
    rank = _num(rs.get("rs_rank")) if isinstance(rs, dict) else None
    if rank is None:
        return None, None
    return rank, f"RS {int(rank)} of 99"


def score_iv_premium(implied_pct, avg_abs_realized_pct) -> tuple[float | None, str | None]:
    implied, realized = _num(implied_pct), _num(avg_abs_realized_pct)
    if implied is None or realized is None or realized <= 0:
        return None, None
    implied = abs(implied)          # an implied move is a MAGNITUDE, never signed
    ratio = implied / realized
    # ratio 0.5 -> 100 (cheap), 1.0 -> 50 (fair), >= 1.5 -> 0 (rich)
    score = max(0.0, min(100.0, (1.5 - ratio) * 100.0))
    return score, f"±{implied:.1f}% priced vs ±{realized:.1f}% typical"


# ── composition ───────────────────────────────────────────────────────────────

def compute_grade(scored: dict) -> dict | None:
    """Pure. `scored` maps every WEIGHTS key to (score, detail) or None."""
    present = {k: v for k, v in (scored or {}).items() if k in WEIGHTS and v is not None}
    if len(present) < MIN_INPUTS:
        return None
    wsum = sum(WEIGHTS[k] for k in present)
    total = sum(WEIGHTS[k] * present[k][0] for k in present) / wsum
    inputs = [{
        "key": k,
        "label": LABELS[k],
        "weight": WEIGHTS[k],
        "available": k in present,
        "score": round(present[k][0], 1) if k in present else None,
        "detail": present[k][1] if k in present else None,
    } for k in WEIGHTS]
    return {
        "letter": letter_for(total),
        "score": round(total, 1),
        "basis": None if len(present) == len(WEIGHTS)
                 else f"{len(present)} of {len(WEIGHTS)} inputs",
        "inputs_present": len(present),
        "inputs_total": len(WEIGHTS),
        "inputs": inputs,
        "asof": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
    }


# ── impure sources: one seam each, so a test can break exactly one ────────────

def _beat_history(sym: str):
    from api.services.earnings_estimates import get_earnings_intel
    intel = get_earnings_intel(sym)
    return (intel or {}).get("beat_history")


def _revisions(sym: str):
    from api.services.research.estimates import get_estimates
    return (get_estimates(sym) or {}).get("revisions")


def _rs(sym: str):
    from api.services import rs_ranking
    # Pure cache lookup — never triggers the ~17s universe rebuild.
    return rs_ranking.get_rs_for_ticker(sym)


def _avg_abs_realized(sym: str):
    """Average |next-day move| over the stored quarters. Cached 24h; a FAILED
    fetch is NEVER cached as a value (lesson_market_cap_cache_poison)."""
    key = f"setup_grade_realized_{sym.upper()}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    from api.services.earnings_enrichment import get_historical_earnings_moves
    from api.services.engine import _fetch_quarterly_history
    raw = get_historical_earnings_moves(sym, _fetch_quarterly_history(sym))
    val = _num((raw or {}).get("avg_abs_move_pct"))
    if val is not None:
        cache.set(key, val, ttl=_REALIZED_TTL)
    return val


def gather_inputs(sym: str, live_move: dict | None = None) -> dict:
    """Every source is individually isolated: one dead provider costs one input
    (visible as the partial basis), never the whole grade."""
    sym = (sym or "").upper().strip()
    out: dict = {}

    def _try(key, fn):
        try:
            s, d = fn()
        except Exception:  # noqa: BLE001 — a dead source is a MISSING INPUT, not a 500
            _log.debug("[setup-grade] input %s failed for %s", key, sym, exc_info=True)
            s, d = None, None
        out[key] = None if s is None else (s, d)

    _try("beat_streak", lambda: score_beat_streak(_beat_history(sym)))
    _try("revision_30d", lambda: score_revision_30d(_revisions(sym)))
    _try("rs_rank", lambda: score_rs_rank(_rs(sym)))
    _try("iv_premium", lambda: score_iv_premium((live_move or {}).get("pct"),
                                                _avg_abs_realized(sym)))
    return out


def get_setup_grade(sym: str, live_move: dict | None = None) -> dict | None:
    return compute_grade(gather_inputs(sym, live_move=live_move))


# ── §12 accountability record ─────────────────────────────────────────────────

def run_daily_grade_snapshot(now: _dt.datetime | None = None) -> dict:
    """One persisted grade per upcoming reporter per day (spec §6/§12).

    Runs post-close alongside the implied capture so the recorded grade is the
    one computed against that evening's implied move. Bounded, deduped and
    exception-isolated per symbol. `now` is INJECTED — no function in this
    module may read the clock behind a caller's back.
    """
    now = now or _dt.datetime.now()
    today = now.date().isoformat()

    seen: set[str] = set()
    syms: list[str] = []
    for rep in implied_store.upcoming_reporters(days=14, now=now) or []:
        s = (rep.get("sym") or "").upper().strip()
        if not s or s in seen:
            continue
        seen.add(s)
        syms.append(s)
        if len(syms) >= MAX_SNAPSHOT_SYMBOLS:
            break

    summary = {"recorded": 0, "skipped": 0, "failed": 0}
    for sym in syms:
        try:
            grade = get_setup_grade(sym)
            if not grade:
                summary["skipped"] += 1
                continue
            implied_store.record_grade(sym=sym, date=today, surface=SURFACE,
                                       grade=grade["letter"], inputs=grade["inputs"])
            summary["recorded"] += 1
        except Exception:  # noqa: BLE001 — one bad symbol must never truncate the batch
            _log.warning("[setup-grade] snapshot failed for %s", sym, exc_info=True)
            summary["failed"] += 1
    _log.info("[setup-grade] daily snapshot: %s", summary)
    return summary
```

`api/routers/expected_move.py` — three edits. Import:

```python
from api.services import implied_move, implied_store, setup_grade
```

Signature:

```python
def expected_move(sym: str, report_date: str | None = Query(default=None),
                   grade: bool = Query(default=True),
                   user=Depends(get_current_user)):
```

Return block (replacing the existing `return {...}`):

```python
    # The Setup Grade rides THIS payload deliberately: its fourth input IS
    # `live`, so a separate endpoint would duplicate or race the chain read,
    # and the banner chip + Setup hero open together (one round trip). Its own
    # try/except so a grade failure degrades to null, never a 500. `?grade=0`
    # opts out entirely.
    grade_payload = None
    if grade:
        try:
            grade_payload = setup_grade.get_setup_grade(sym, live_move=live)
        except Exception:  # noqa: BLE001
            _log.warning("expected-move grade failed for %s", sym, exc_info=True)
    return {
        "live": live,
        "history": history,
        "history_since": history_since,
        "grade": grade_payload,
    }
```

`api/main.py` — immediately after the existing `implied_move_nightly` job, **inside the same `if os.environ.get("IMPLIED_STORE_ENABLED") == "1":` block** (line ~2639):

```python
            # §12 accountability record: one persisted Setup Grade per upcoming
            # reporter per day. 16:40 ET = 5 min after the implied capture, so
            # the grade is scored against that evening's freshly-stored implied.
            # SAME flag as the capture on purpose — they write the same store in
            # the same nightly window; a second flag would let the accountability
            # record silently diverge from the data it grades.
            from api.services import setup_grade as _setup_grade
            _scheduler.add_job(
                _setup_grade.run_daily_grade_snapshot,
                trigger=CronTrigger(hour=16, minute=40, day_of_week="mon-fri", timezone=_ET),
                id="setup_grade_daily", max_instances=1, coalesce=True, replace_existing=True,
            )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_setup_grade.py tests/test_expected_move_router.py tests/test_implied_store.py tests/test_implied_move.py -v` → all green.

**Mutation control (required — a check is real only if something fails on it):**
1. Delete `if len(present) < MIN_INPUTS: return None` → `test_compute_grade_refuses_to_speak_below_two_inputs` must FAIL. Restore **in place** (never `git stash` — `lesson_git_stash_keep_index_mutation_harness`). Re-run green.
2. Change `if val is not None:` in `_avg_abs_realized` to unconditional `cache.set` → `test_realized_average_never_caches_a_failure` must FAIL. Restore. Re-run green.
3. Take the verdict from the **exit code** of pytest, not from grepping output.

- [ ] **Step 5: Verify + commit**

`git add api/services/setup_grade.py api/routers/expected_move.py api/main.py tests/test_setup_grade.py tests/test_expected_move_router.py`
Commit: `feat(research): Setup Grade service + expected-move payload fold + daily snapshot (P2 T1)`

---

### Task 2: Brief cached-only probe + enrichment implied-move cutover (GATE f)

**Files:**
- Modify: `api/routers/earnings.py`, `api/routers/calendar.py`
- Test: `tests/test_earnings_analysis_cached_only.py`, `tests/test_enrichment_implied_cutover.py`

**Interfaces:**
- `GET /api/earnings-analysis/{sym}?cached_only=1` → the cached blob plus `"cached": true`, or the empty shape plus `"cached": false`. **Never calls the LLM generators, never calls `get_earnings()`.**
- `calendar._cutover_on() -> bool` — reads `IMPLIED_ENRICHMENT_CUTOVER` at CALL time so the flag is testable without a module reload. Default **off**.
- `calendar._inhouse_move(sym, target) -> dict | None` — `implied_move.get_expected_move` mapped into the calendar-enrichment shape with `pct` rounded to 1 dp and `dollar` to 2 dp.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_earnings_analysis_cached_only.py
from unittest.mock import patch

from fastapi.testclient import TestClient


def _client():
    from api.main import app
    return TestClient(app)


def test_cached_only_returns_the_cached_analysis_without_firing_the_llm():
    from api.routers import earnings as er
    from api.services.cache import cache
    cache.set("earnings_analysis_v2_TST",
              {"sym": "TST", "analysis_headline": "Beat and raised"}, ttl=60)
    with patch.object(er, "_generate_earnings_analysis") as ga, \
         patch.object(er, "_generate_earnings_preview") as gp:
        r = _client().get("/api/earnings-analysis/TST?cached_only=1")
    body = r.json()
    assert body["cached"] is True and body["analysis_headline"] == "Beat and raised"
    ga.assert_not_called()
    gp.assert_not_called()
    cache.invalidate("earnings_analysis_v2_TST")


def test_cached_only_falls_back_to_the_preview_key():
    from api.services.cache import cache
    cache.invalidate("earnings_analysis_v2_TST")
    cache.set("earnings_preview_v2_TST",
              {"sym": "TST", "preview_text": "Watch guidance."}, ttl=60)
    body = _client().get("/api/earnings-analysis/TST?cached_only=1").json()
    assert body["cached"] is True and body["preview_text"] == "Watch guidance."
    cache.invalidate("earnings_preview_v2_TST")


def test_cached_only_miss_returns_the_empty_shape_and_touches_nothing():
    from api.routers import earnings as er
    from api.services.cache import cache
    cache.invalidate("earnings_analysis_v2_ZZZ")
    cache.invalidate("earnings_preview_v2_ZZZ")
    with patch.object(er, "_generate_earnings_analysis") as ga, \
         patch.object(er, "_generate_earnings_preview") as gp, \
         patch.object(er, "get_earnings") as ge:
        body = _client().get("/api/earnings-analysis/ZZZ?cached_only=1").json()
    assert body["cached"] is False
    assert body["analysis_bullets"] == [] and body["preview_bullets"] == []
    assert body["news"] == [] and body["analysis_headline"] is None
    ga.assert_not_called()
    gp.assert_not_called()
    ge.assert_not_called()          # not even the row lookup — this path is FREE


def test_default_call_is_unchanged_and_still_generates():
    from api.routers import earnings as er
    with patch.object(er, "get_earnings", return_value={}), \
         patch.object(er, "_generate_earnings_preview",
                      return_value={"sym": "ZZZ", "preview_text": "x"}) as gp:
        r = _client().get("/api/earnings-analysis/ZZZ")
    assert r.status_code == 200
    gp.assert_called_once()
```

```python
# tests/test_enrichment_implied_cutover.py
from unittest.mock import patch

from api.routers import calendar as cal


def test_cutover_is_off_by_default(monkeypatch):
    monkeypatch.delenv("IMPLIED_ENRICHMENT_CUTOVER", raising=False)
    assert cal._cutover_on() is False
    monkeypatch.setenv("IMPLIED_ENRICHMENT_CUTOVER", "1")
    assert cal._cutover_on() is True
    monkeypatch.setenv("IMPLIED_ENRICHMENT_CUTOVER", "0")
    assert cal._cutover_on() is False


def test_inhouse_move_rounds_pct_and_dollar_for_the_calendar_ui():
    raw = {"pct": 6.234567891, "dollar": 12.3456789, "expiry": "2026-08-07",
           "strike": 185.0, "spot": 184.0, "call_mid": 6.3, "put_mid": 6.2,
           "iv_atm": 0.6, "horizon": "through 2026-08-07", "source": "massive-chain"}
    with patch("api.services.implied_move.get_expected_move", return_value=raw):
        out = cal._inhouse_move("TST", "2026-08-06")
    # pages/calendar/CalendarDayTable.jsx:87 prints `±${pct}%` with NO formatter,
    # so an unrounded float renders ±6.234567891%.
    assert out["pct"] == 6.2 and out["dollar"] == 12.35
    assert out["expiry"] == "2026-08-07" and out["horizon"] == "through 2026-08-07"


def test_inhouse_move_returns_none_when_the_chain_read_fails():
    with patch("api.services.implied_move.get_expected_move", return_value=None):
        assert cal._inhouse_move("TST", "2026-08-06") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_earnings_analysis_cached_only.py tests/test_enrichment_implied_cutover.py -v`
Expected: `AttributeError: module 'api.routers.calendar' has no attribute '_cutover_on'`, and the cached-only tests fail because `?cached_only=1` is ignored (the generators ARE called).

- [ ] **Step 3: Implement**

`api/routers/earnings.py` — change the signature and insert the probe as the FIRST thing in the body, **before** `get_earnings()`:

```python
@router.get("/api/earnings-analysis/{sym}")
@limiter.limit("10/minute")
def earnings_analysis(request: Request, sym: str, cached_only: bool = False):
    sym = sym.upper()

    # §4.3.3 / §7: arrow-key stepping across a 40-name day must never auto-fire
    # the LLM path. `cached_only=1` answers ONLY from the two cache keys the
    # generators write and returns `cached: false` instead of generating — the
    # Brief section then renders a "Generate brief" affordance. This branch does
    # no provider work at all, which is what makes it safe to fire on every step.
    if cached_only:
        for key in (f"earnings_analysis_v2_{sym}", f"earnings_preview_v2_{sym}"):
            hit = cache.get(key)
            if hit:
                return {**hit, "cached": True}
        return {
            "sym": sym, "cached": False,
            "analysis": None, "analysis_headline": None, "analysis_summary": None,
            "analysis_bullets": [], "preview_text": "", "preview_bullets": [],
            "beat_history": [], "yoy_eps_growth": None, "beat_streak": None,
            "news": [], "key_quotes": [],
        }
```

(`cache` is already imported in this module — it is used at line 34.)

`api/routers/calendar.py` — module level, next to the other enrichment helpers (`os` is already imported):

```python
def _cutover_on() -> bool:
    """spec §6: the calendar's expected-move switches off the delayed yfinance
    straddle onto the in-house Massive chain. Read at CALL time so the flag can
    be flipped (and tested) without a module reload. Default OFF."""
    return os.environ.get("IMPLIED_ENRICHMENT_CUTOVER") == "1"


def _inhouse_move(sym: str, target: str) -> dict | None:
    """In-house straddle mapped into the calendar-enrichment shape.

    ROUNDING IS LOAD-BEARING: the outgoing yfinance builder rounded pct to 1dp
    and `pages/calendar/CalendarDayTable.jsx:87` prints `±${pct}%` with no
    formatter, so an unrounded float renders ±6.234567891%. FE readers of
    `expected_move` were swept — only `.pct` is consumed anywhere, so the
    call_mark→call_mid field rename rides along harmlessly.
    """
    from api.services import implied_move as _im
    out = _im.get_expected_move(sym, target)
    if not out:
        return None
    return {**out, "pct": round(out["pct"], 1), "dollar": round(out["dollar"], 2)}
```

and inside `_one` in `_compute_enrichment_for_date`, replace the single `move = …` assignment:

```python
        if not is_past:
            # _bounded_em: a hung chain call frees this worker after the timeout
            # instead of pinning it (524-outage class), on a pool ISOLATED from
            # yf_util's shared one. BOTH branches ride it.
            if _cutover_on():
                move = _bounded_em(lambda s=sym: _inhouse_move(s, target))
            else:
                move = _bounded_em(lambda s=sym: get_implied_move(s, earnings_date=target))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_earnings_analysis_cached_only.py tests/test_enrichment_implied_cutover.py tests/test_calendar_enrichment.py tests/test_calendar_enrichment_batch.py tests/test_earnings_analysis.py -v` → green.

**Mutation control:**
1. Change `round(out["pct"], 1)` to `out["pct"]` → `test_inhouse_move_rounds_pct_and_dollar_for_the_calendar_ui` must FAIL. Restore in place.
2. Change `_cutover_on` to `return True` → `test_cutover_is_off_by_default` must FAIL. Restore.
3. Move the `if cached_only:` block to AFTER `get_earnings()` → `test_cached_only_miss_returns_the_empty_shape_and_touches_nothing` must FAIL. Restore.

- [ ] **Step 5: Verify + commit**

`git add api/routers/earnings.py api/routers/calendar.py tests/test_earnings_analysis_cached_only.py tests/test_enrichment_implied_cutover.py`
Commit: `feat(research): Brief cached-only probe + IMPLIED_ENRICHMENT_CUTOVER flag, default off (P2 T2)`

---

### Task 3: §12 trust posture — methodology page + not-advice copy

**Files:**
- Create: `app/src/constants/disclaimer.js`, `app/src/pages/Methodology.jsx`, `app/src/pages/Methodology.module.css`, `app/src/pages/Methodology.test.jsx`
- Modify: `app/src/App.jsx`

**Interfaces:**
- `disclaimer.js` exports `NOT_ADVICE = 'For informational purposes only — not investment advice.'` and `METHODOLOGY_PATH = '/methodology'` plus `SETUP_GRADE_INFO` / `UCT_RATING_INFO` — the `InfoTip`-shaped objects (`{text, href, hrefLabel}`) every kit `info` prop in P2 is handed, so the ⓘ everywhere links to the same page.
- Route: `<Route path="/methodology" element={<Methodology />} />` beside `/terms` and `/privacy` (public, outside `AuthGuard`, outside `PreLaunchGate` — a shared `?earnings=` deep link must be able to reach the methodology behind the grade even pre-launch).
- The page is a plain React page (the `/terms` precedent, 127 lines). **No new routing machinery.**

**Content contract (normative):** the weights table on this page must equal `api/services/setup_grade.py::WEIGHTS` and `LETTER_THRESHOLDS` **verbatim**. The test pins the four weights and the A+/F ends of the ladder so a change on either side that is not mirrored fails.

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/Methodology.test.jsx
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import Methodology from './Methodology'
import { NOT_ADVICE, SETUP_GRADE_INFO, METHODOLOGY_PATH } from '../constants/disclaimer'

const renderPage = () =>
  render(<MemoryRouter><Methodology /></MemoryRouter>)

describe('Methodology page (§12)', () => {
  it('names the Setup Grade and never says "verdict"', () => {
    const { container } = renderPage()
    expect(screen.getByRole('heading', { name: /methodology/i })).toBeTruthy()
    expect(screen.getByText(/Earnings Setup Grade/i)).toBeTruthy()
    expect(container.textContent.toLowerCase()).not.toContain('verdict')
  })

  it('publishes all four inputs WITH their weights (an audit, not a label)', () => {
    renderPage()
    const table = screen.getByTestId('methodology-grade-weights')
    const rows = within(table).getAllByRole('row').slice(1)   // drop the header
    const cells = rows.map(r => within(r).getAllByRole('cell').map(c => c.textContent.trim()))
    expect(cells).toEqual([
      ['Beat streak', '30%', expect.any(String)],
      ['Estimate revisions (30d)', '30%', expect.any(String)],
      ['Relative strength rank', '25%', expect.any(String)],
      ['Options premium vs typical move', '15%', expect.any(String)],
    ])
  })

  it('publishes the letter ladder ends and the partial-basis rule', () => {
    renderPage()
    const ladder = screen.getByTestId('methodology-grade-ladder')
    expect(ladder.textContent).toContain('A+')
    expect(ladder.textContent).toContain('93')
    expect(ladder.textContent).toContain('F')
    expect(screen.getByTestId('methodology-partial-basis').textContent)
      .toMatch(/3 of 4 inputs/)
  })

  it('separates the Setup Grade (this event) from the UCT Rating (the stock)', () => {
    renderPage()
    expect(screen.getByTestId('methodology-scope').textContent)
      .toMatch(/this report[\s\S]*the stock/i)
  })

  it('carries the standing not-advice line', () => {
    renderPage()
    expect(screen.getByTestId('methodology-not-advice').textContent).toBe(NOT_ADVICE)
  })

  it('exports info objects that point at this page', () => {
    expect(SETUP_GRADE_INFO.href).toBe(METHODOLOGY_PATH)
    expect(SETUP_GRADE_INFO.text.toLowerCase()).not.toContain('verdict')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/pages/Methodology.test.jsx`
Expected: `Failed to resolve import "./Methodology"`.

- [ ] **Step 3: Implement**

```js
// app/src/constants/disclaimer.js
// §12 trust posture. ONE source for the standing disclaimer and for every
// research-kit `info` prop, so the ⓘ on a chip and the footer line can never
// drift from the page that documents them.
//
// LANGUAGE RULE (§12): the word "verdict" never appears in user-facing copy.
// `VerdictChip` is an internal component name only.

export const NOT_ADVICE = 'For informational purposes only — not investment advice.'
export const METHODOLOGY_PATH = '/methodology'

export const SETUP_GRADE_INFO = {
  text: 'Earnings Setup Grade — this report only. Weighted from beat streak, 30-day estimate revisions, relative strength and how the options premium compares with the typical move.',
  href: METHODOLOGY_PATH,
  hrefLabel: 'How this is computed →',
}

export const UCT_RATING_INFO = {
  text: 'UCT Rating — the stock, not this report. See the Setup Grade for tonight’s event.',
  href: METHODOLOGY_PATH,
  hrefLabel: 'How this is computed →',
}

export const IMPLIED_MOVE_INFO = {
  text: 'Implied move from the at-the-money straddle on the first expiry on or after the report date. Realized moves are close-to-close over the same span.',
  href: METHODOLOGY_PATH,
  hrefLabel: 'How this is computed →',
}
```

```jsx
// app/src/pages/Methodology.jsx
// §12: "documented in code" is not a user-facing posture. This page publishes
// the Setup Grade arithmetic in full.
//
// NORMATIVE: the weights and thresholds below MUST equal
// api/services/setup_grade.py WEIGHTS / LETTER_THRESHOLDS verbatim.
// Methodology.test.jsx pins them; change one side and the test fails.
import { NOT_ADVICE } from '../constants/disclaimer'
import styles from './Methodology.module.css'

const WEIGHTS = [
  ['Beat streak', '30%', 'Share of the last reported quarters whose EPS beat consensus. Quarters with no consensus on file are excluded from both sides of the ratio.'],
  ['Estimate revisions (30d)', '30%', 'Analyst estimate revisions over the trailing 30 days: upward revisions as a share of all revisions. No revisions at all counts as no signal, not a neutral score.'],
  ['Relative strength rank', '25%', 'The stock’s 1–99 relative-strength percentile against the tracked universe — the same number the RS chip shows, read from the same source.'],
  ['Options premium vs typical move', '15%', 'Tonight’s implied move against the average absolute move this stock has actually made on past reports. Cheaper than typical scores higher.'],
]

const LADDER = [
  ['A+', '93+'], ['A', '85–92'], ['A-', '78–84'],
  ['B+', '71–77'], ['B', '64–70'], ['B-', '57–63'],
  ['C+', '50–56'], ['C', '43–49'], ['C-', '36–42'],
  ['D+', '29–35'], ['D', '22–28'], ['D-', '15–21'],
  ['F', 'under 15'],
]

export default function Methodology() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Methodology</h1>
      <p className={styles.lede}>
        Every grade and chip on this platform carries its denominator. This page is
        that denominator: the inputs, the weights, the thresholds and the update
        cadence behind the two scores we publish.
      </p>

      <section className={styles.section} aria-labelledby="m-grade">
        <h2 className={styles.h2} id="m-grade">Earnings Setup Grade</h2>
        <p className={styles.body} data-testid="methodology-scope">
          The Earnings Setup Grade scores <strong>this report</strong> — the event.
          The UCT Rating scores <strong>the stock</strong>. They are different
          instruments, they can disagree, and where they share an input (relative
          strength) they read the same source so the disagreement is explainable.
        </p>

        <table className={styles.table} data-testid="methodology-grade-weights">
          <thead>
            <tr><th scope="col">Input</th><th scope="col">Weight</th><th scope="col">Definition</th></tr>
          </thead>
          <tbody>
            {WEIGHTS.map(([label, weight, def]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="t-num">{weight}</td>
                <td>{def}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className={styles.body} data-testid="methodology-partial-basis">
          <strong>Partial inputs.</strong> When an input is unavailable — no options
          chain listed, a cold pre-market IV read, a name outside the ranked universe
          — the grade is computed from the inputs that are available, the remaining
          weights are renormalised, and the chip states the basis explicitly, e.g.
          “B+ · 3 of 4 inputs”. Below two available inputs no grade is shown at all.
          Nothing is silently substituted.
        </p>

        <div className={styles.ladder} data-testid="methodology-grade-ladder">
          {LADDER.map(([letter, range]) => (
            <div key={letter} className={styles.ladderRow}>
              <span className={styles.ladderLetter}>{letter}</span>
              <span className={`${styles.ladderRange} t-num`}>{range}</span>
            </div>
          ))}
        </div>

        <p className={styles.body}>
          <strong>Cadence.</strong> The grade is recomputed on every view from live
          inputs, and one grade per upcoming reporter is persisted each weekday after
          the close — that stored record is what we are held to, not a number that can
          be quietly restated later.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="m-rating">
        <h2 className={styles.h2} id="m-rating">UCT Rating</h2>
        <p className={styles.body}>
          A 0–99 composite of seven components — EPS, relative strength, growth, value,
          SMR, accumulation/distribution and sponsorship. Components are scored against
          fixed thresholds, so a score answers “does this stock clear our bar?”, not
          “where does it rank today”. The basis is stated on the rating itself and will
          change to a ranked percentile when that job lands; scores may shift at that
          cutover and the page will say so.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="m-move">
        <h2 className={styles.h2} id="m-move">Expected move and realized move</h2>
        <p className={styles.body}>
          The implied move is the at-the-money straddle on the first listed expiry on or
          after the report date, quoted with that horizon (“through Fri Aug 8”). The
          realized comparison is close-to-close over the same span — never a
          straddle-to-expiry number compared against a next-day one. Historical implied
          values are captured after the close on the day before each report, so they are
          pre-report reads, not post-print IV-crushed ones. Coverage is stated on the
          chart itself (“Implied tracking since 2026-08 · n/8 recorded”), and that count
          is stored snapshots only.
        </p>
      </section>

      <p className={styles.notAdvice} data-testid="methodology-not-advice">{NOT_ADVICE}</p>
    </div>
  )
}
```

`app/src/pages/Methodology.module.css` — glass-register page chrome using tokens only:

```css
.page { max-width: 860px; margin: 0 auto; padding: var(--space-xl) var(--space-lg) 64px; }
.title { font-size: var(--text-display); color: var(--text-heading); margin: 0 0 var(--space-md); letter-spacing: var(--ls-normal); }
.lede { font-size: var(--text-base); color: var(--text); line-height: var(--lh-snug); margin: 0 0 var(--space-xl); }
.section { border-top: 1px solid var(--glass-border-neutral); padding-top: var(--space-lg); margin-bottom: var(--space-xl); }
.h2 { font-size: var(--text-xl); color: var(--text-heading); margin: 0 0 var(--space-md); }
.body { font-size: var(--text-sm); color: var(--text); line-height: var(--lh-snug); margin: 0 0 var(--space-md); }
.table { width: 100%; border-collapse: collapse; margin: 0 0 var(--space-lg); font-size: var(--text-sm); }
.table th { text-align: left; font-size: var(--text-xs); letter-spacing: var(--ls-label); text-transform: uppercase; color: var(--text-muted); font-weight: 600; padding: var(--space-xs) var(--space-sm); border-bottom: 1px solid var(--glass-border-neutral); }
.table td { padding: var(--space-sm); color: var(--text); border-bottom: 1px solid var(--glass-border-neutral); vertical-align: top; }
.ladder { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--space-xs); margin: 0 0 var(--space-lg); }
.ladderRow { display: flex; justify-content: space-between; gap: var(--space-sm); background: var(--glass-surface); border: 1px solid var(--glass-border-neutral); border-radius: var(--radius-sm); padding: var(--space-xs) var(--space-sm); }
.ladderLetter { color: var(--text-bright); font-weight: 600; font-size: var(--text-sm); }
.ladderRange { color: var(--text-muted); font-size: var(--text-xs); }
.notAdvice { font-size: var(--text-xs); color: var(--text-muted); border-top: 1px solid var(--glass-border-neutral); padding-top: var(--space-md); margin: var(--space-xl) 0 0; }

@media (max-width: 640px) {
  .page { padding: var(--space-lg) var(--space-md) 48px; }
  .title { font-size: var(--text-xl); }
  .table { display: block; overflow-x: auto; }
}
```

`app/src/App.jsx` — add the lazy import beside `Terms`/`Privacy` and one route line next to `/privacy` (line ~227):

```jsx
            <Route path="/methodology" element={<Methodology />} />
```

Import it the same way `Terms` is imported in that file (match the existing eager/lazy style verbatim — do not introduce a second pattern).

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/pages/Methodology.test.jsx`

**Mutation control:** change the `'30%'` on the beat-streak row to `'35%'` → the weights test must FAIL. Restore in place.

**Cross-file pin:** confirm by eye that the four weight strings equal `WEIGHTS` in `api/services/setup_grade.py` (0.30/0.30/0.25/0.15) and that the ladder ends match `LETTER_THRESHOLDS[0]` (93, "A+") and `FLOOR_LETTER` ("F"). Record the check in the commit message.

- [ ] **Step 5: Verify + commit**

`cd app && npm run build` (route must compile). Then:
`git add app/src/constants/disclaimer.js app/src/pages/Methodology.jsx app/src/pages/Methodology.module.css app/src/pages/Methodology.test.jsx app/src/App.jsx`
Commit: `feat(research): §12 methodology page + not-advice copy constants (P2 T3)`

---

### Task 4: `useEarningsModalRoute` — merge-preserving URL state

**Files:**
- Create: `app/src/pages/calendar/useEarningsModalRoute.js`, `app/src/pages/calendar/useEarningsModalRoute.test.jsx`

**Interfaces (frozen — Task 11 binds to these names):**
- `EARNINGS_PARAM = 'earnings'`, `SECTION_PARAM = 'esection'`, `WEEK_PARAM = 'week'`, `ROUTED_PATHS = ['/calendar', '/calendar/mystocks']`
- `isRoutedPath(pathname) -> boolean` — trailing slashes tolerated.
- `mergeParams(current, patch) -> URLSearchParams` — **pure**; `null`/`''` deletes a key, everything else sets it, every other key survives untouched.
- `normalizeSym(raw) -> string | null` — uppercased, `A-Z` first char, `[A-Z.-]{0,6}` tail, else `null`.
- `resolveFeedEntry(sym, days) -> { entry, ds, timing } | null` — pure lookup across `{ds: {bmo:[], amc:[], tbd:[]}}`.
- default export `useEarningsModalRoute({ enabled = true, pathname = '' })` →
  `{ routed, sym, section, open(sym), step(sym), setSection(id), jumpToWeek(monday), close() }`

**Semantics (spec §4.4, normative):** `open` **pushes** (Back closes in one press). `step`, `setSection`, `jumpToWeek` **replace**. `close` pops the pushed entry when this hook pushed it, otherwise strips the params with `replace` (the deep-link-entry case, where there is no entry of ours to pop). Every write goes through `mergeParams` so `?week` and `?d` — which `Calendar.jsx` already owns at lines 88–98 — survive. Raw `window.history.pushState` is banned: it desyncs the router.

- [ ] **Step 1: Write the failing tests**

```jsx
// app/src/pages/calendar/useEarningsModalRoute.test.jsx
import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

import useEarningsModalRoute, {
  EARNINGS_PARAM, SECTION_PARAM, isRoutedPath, mergeParams, normalizeSym, resolveFeedEntry,
} from './useEarningsModalRoute'

// ── pure helpers ──────────────────────────────────────────────────────────────

describe('mergeParams', () => {
  it('preserves every untouched key', () => {
    const out = mergeParams(new URLSearchParams('week=2026-08-03&d=2026-08-06'),
                            { [EARNINGS_PARAM]: 'NVDA' })
    expect(out.get('week')).toBe('2026-08-03')
    expect(out.get('d')).toBe('2026-08-06')
    expect(out.get(EARNINGS_PARAM)).toBe('NVDA')
  })

  it('deletes on null and on empty string, and never mutates its input', () => {
    const src = new URLSearchParams('week=w&earnings=NVDA&esection=brief')
    const out = mergeParams(src, { [EARNINGS_PARAM]: null, [SECTION_PARAM]: '' })
    expect(out.has(EARNINGS_PARAM)).toBe(false)
    expect(out.has(SECTION_PARAM)).toBe(false)
    expect(out.get('week')).toBe('w')
    expect(src.get(EARNINGS_PARAM)).toBe('NVDA')   // input untouched
  })
})

describe('normalizeSym', () => {
  it('uppercases and accepts class shares', () => {
    expect(normalizeSym('nvda')).toBe('NVDA')
    expect(normalizeSym(' brk-b ')).toBe('BRK-B')
    expect(normalizeSym('brk.b')).toBe('BRK.B')
  })
  it('rejects junk rather than opening a modal on it', () => {
    expect(normalizeSym('')).toBeNull()
    expect(normalizeSym(null)).toBeNull()
    expect(normalizeSym('1NVDA')).toBeNull()
    expect(normalizeSym('TOOLONGSYM')).toBeNull()
    expect(normalizeSym('<script>')).toBeNull()
  })
})

describe('isRoutedPath', () => {
  it('honours exactly the two calendar surfaces', () => {
    expect(isRoutedPath('/calendar')).toBe(true)
    expect(isRoutedPath('/calendar/')).toBe(true)
    expect(isRoutedPath('/calendar/mystocks')).toBe(true)
    expect(isRoutedPath('/dashboard')).toBe(false)
    expect(isRoutedPath('/research/NVDA')).toBe(false)
  })
})

describe('resolveFeedEntry', () => {
  const days = {
    '2026-08-05': { bmo: [{ sym: 'AAPL' }], amc: [], tbd: [] },
    '2026-08-06': { bmo: [], amc: [{ sym: 'NVDA' }], tbd: [{ sym: 'ZZZ' }] },
  }
  it('finds the entry with its day and session', () => {
    expect(resolveFeedEntry('NVDA', days)).toEqual({ entry: { sym: 'NVDA' }, ds: '2026-08-06', timing: 'amc' })
    expect(resolveFeedEntry('AAPL', days)).toEqual({ entry: { sym: 'AAPL' }, ds: '2026-08-05', timing: 'bmo' })
    expect(resolveFeedEntry('ZZZ', days).timing).toBe('tbd')
  })
  it('returns null for a name outside the loaded week', () => {
    expect(resolveFeedEntry('TSLA', days)).toBeNull()
    expect(resolveFeedEntry('NVDA', null)).toBeNull()
  })
})

// ── the hook ──────────────────────────────────────────────────────────────────

let api = null
function Probe({ enabled = true }) {
  const loc = useLocation()
  api = useEarningsModalRoute({ enabled, pathname: loc.pathname })
  return (
    <div>
      <span data-testid="search">{loc.search}</span>
      <span data-testid="sym">{api.sym ?? ''}</span>
      <span data-testid="section">{api.section ?? ''}</span>
      <span data-testid="routed">{String(api.routed)}</span>
    </div>
  )
}

const renderAt = (url, props = {}) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/calendar" element={<Probe {...props} />} />
      <Route path="/calendar/mystocks" element={<Probe {...props} />} />
      <Route path="/dashboard" element={<Probe {...props} />} />
    </Routes>
  </MemoryRouter>,
)

describe('useEarningsModalRoute', () => {
  it('reads ?earnings and &esection on a routed path', () => {
    renderAt('/calendar?week=2026-08-03&earnings=nvda&esection=brief')
    expect(screen.getByTestId('sym').textContent).toBe('NVDA')
    expect(screen.getByTestId('section').textContent).toBe('brief')
    expect(screen.getByTestId('routed').textContent).toBe('true')
  })

  it('ignores the param entirely off the two calendar surfaces', () => {
    renderAt('/dashboard?earnings=NVDA')
    expect(screen.getByTestId('sym').textContent).toBe('')
    expect(screen.getByTestId('routed').textContent).toBe('false')
  })

  it('ignores the param when explicitly disabled', () => {
    renderAt('/calendar?earnings=NVDA', { enabled: false })
    expect(screen.getByTestId('sym').textContent).toBe('')
  })

  it('open() preserves ?week and ?d', () => {
    renderAt('/calendar?week=2026-08-03&d=2026-08-06')
    act(() => api.open('NVDA'))
    const s = new URLSearchParams(screen.getByTestId('search').textContent)
    expect(s.get('week')).toBe('2026-08-03')
    expect(s.get('d')).toBe('2026-08-06')
    expect(s.get(EARNINGS_PARAM)).toBe('NVDA')
  })

  it('open() PUSHES so one Back closes the modal', () => {
    renderAt('/calendar?week=2026-08-03')
    act(() => api.open('NVDA'))
    expect(screen.getByTestId('sym').textContent).toBe('NVDA')
    act(() => { window.history.back() })
    return Promise.resolve().then(() => {
      expect(screen.getByTestId('sym').textContent).toBe('')
      expect(new URLSearchParams(screen.getByTestId('search').textContent).get('week'))
        .toBe('2026-08-03')
    })
  })

  it('step() REPLACES so Back still closes in one press after stepping', () => {
    renderAt('/calendar?week=2026-08-03')
    act(() => api.open('NVDA'))
    act(() => api.step('AMD'))
    act(() => api.step('AVGO'))
    expect(screen.getByTestId('sym').textContent).toBe('AVGO')
    act(() => { window.history.back() })
    return Promise.resolve().then(() => {
      expect(screen.getByTestId('sym').textContent).toBe('')
    })
  })

  it('setSection() REPLACES and keeps the symbol', () => {
    renderAt('/calendar')
    act(() => api.open('NVDA'))
    act(() => api.setSection('history'))
    expect(screen.getByTestId('section').textContent).toBe('history')
    act(() => { window.history.back() })
    return Promise.resolve().then(() => {
      expect(screen.getByTestId('sym').textContent).toBe('')
    })
  })

  it('open() clears a stale section from the previous symbol', () => {
    renderAt('/calendar?earnings=AMD&esection=call')
    act(() => api.open('NVDA'))
    expect(screen.getByTestId('section').textContent).toBe('')
  })

  it('close() on a deep-link entry strips both params without needing history', () => {
    renderAt('/calendar?week=2026-08-03&earnings=NVDA&esection=call')
    act(() => api.close())
    const s = new URLSearchParams(screen.getByTestId('search').textContent)
    expect(s.has(EARNINGS_PARAM)).toBe(false)
    expect(s.has(SECTION_PARAM)).toBe(false)
    expect(s.get('week')).toBe('2026-08-03')
  })

  it('jumpToWeek() REPLACES and preserves the open symbol', () => {
    renderAt('/calendar?earnings=NVDA')
    act(() => api.jumpToWeek('2026-09-07'))
    const s = new URLSearchParams(screen.getByTestId('search').textContent)
    expect(s.get('week')).toBe('2026-09-07')
    expect(s.get(EARNINGS_PARAM)).toBe('NVDA')
  })

  it('never writes an invalid symbol into the URL', () => {
    renderAt('/calendar')
    act(() => api.open('<script>'))
    expect(screen.getByTestId('search').textContent).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run src/pages/calendar/useEarningsModalRoute.test.jsx`
Expected: `Failed to resolve import "./useEarningsModalRoute"`.

- [ ] **Step 3: Implement**

```js
// app/src/pages/calendar/useEarningsModalRoute.js
//
// URL state for the earnings modal (spec §4.4).
//
// BANNED HERE: raw `window.history.pushState`. Calendar.jsx already owns
// `?week` and `?d` through React Router's `useSearchParams` (Calendar.jsx:88);
// a bare pushState desyncs the router's copy of the query and the next
// router-driven write silently reinstates the params it thought were current.
// Every write below goes through `mergeParams`, which copies the CURRENT
// params and applies a patch, so unrelated keys always survive.
//
// HISTORY SEMANTICS (normative):
//   open()        PUSH    — one history entry, so Back closes in one press
//   step()        REPLACE — stepping a 40-name day must not bury the exit
//   setSection()  REPLACE — same reason
//   jumpToWeek()  REPLACE — part of resolving a deep link, not a user step
//   close()       pops OUR pushed entry when we pushed one; otherwise strips
//                 the params with replace (the deep-link-entry case, where
//                 there is no entry of ours to pop and navigate(-1) would
//                 leave the app entirely).
import { useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export const EARNINGS_PARAM = 'earnings'
export const SECTION_PARAM = 'esection'
export const WEEK_PARAM = 'week'

// §4.4: the param is honored on these two surfaces ONLY. CatalystFlow is
// deliberately absent — the Dashboard mounts two live instances (desktop +
// mobile trees) and its rows come from today's wire list, so a URL-driven open
// there is both double-rendering and unresolvable.
export const ROUTED_PATHS = ['/calendar', '/calendar/mystocks']

export function isRoutedPath(pathname) {
  const p = (pathname || '').replace(/\/+$/, '') || '/'
  return ROUTED_PATHS.includes(p)
}

/** Pure. Copies `current`, applies `patch` (null/'' deletes), returns a NEW
 *  URLSearchParams. Never mutates its input. */
export function mergeParams(current, patch) {
  const next = new URLSearchParams(current)
  for (const [k, v] of Object.entries(patch || {})) {
    if (v == null || v === '') next.delete(k)
    else next.set(k, String(v))
  }
  return next
}

/** Uppercased ticker, or null. A URL is user input: an unvalidated value would
 *  reach fetch paths and section headings. */
export function normalizeSym(raw) {
  const s = (typeof raw === 'string' ? raw : '').toUpperCase().trim()
  return /^[A-Z][A-Z.-]{0,6}$/.test(s) ? s : null
}

const SESSIONS = ['bmo', 'amc', 'tbd']

/** Pure lookup of a symbol in a loaded calendar week. */
export function resolveFeedEntry(sym, days) {
  const want = normalizeSym(sym)
  if (!want || !days) return null
  for (const [ds, day] of Object.entries(days)) {
    for (const timing of SESSIONS) {
      const entry = (day?.[timing] || []).find(
        (e) => (e?.sym || '').toUpperCase() === want,
      )
      if (entry) return { entry, ds, timing }
    }
  }
  return null
}

export default function useEarningsModalRoute({ enabled = true, pathname = '' } = {}) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  // Tracks whether THIS hook instance pushed the entry currently on the stack.
  const pushedRef = useRef(false)

  const routed = !!enabled && isRoutedPath(pathname)
  const sym = routed ? normalizeSym(params.get(EARNINGS_PARAM)) : null
  const section = routed ? (params.get(SECTION_PARAM) || null) : null

  const write = useCallback((patch, replace) => {
    setParams((prev) => mergeParams(prev, patch), { replace })
  }, [setParams])

  const open = useCallback((next) => {
    const v = normalizeSym(next)
    if (!routed || !v) return
    pushedRef.current = true
    // Clear any section carried over from the previous symbol — a section id
    // is only meaningful for the symbol it was chosen on.
    write({ [EARNINGS_PARAM]: v, [SECTION_PARAM]: null }, false)
  }, [routed, write])

  const step = useCallback((next) => {
    const v = normalizeSym(next)
    if (!routed || !v) return
    write({ [EARNINGS_PARAM]: v }, true)
  }, [routed, write])

  const setSection = useCallback((id) => {
    if (!routed) return
    write({ [SECTION_PARAM]: id || null }, true)
  }, [routed, write])

  const jumpToWeek = useCallback((monday) => {
    if (!routed || !monday) return
    write({ [WEEK_PARAM]: monday }, true)
  }, [routed, write])

  const close = useCallback(() => {
    if (!routed) return
    if (pushedRef.current) {
      pushedRef.current = false
      navigate(-1)
      return
    }
    write({ [EARNINGS_PARAM]: null, [SECTION_PARAM]: null }, true)
  }, [routed, navigate, write])

  return { routed, sym, section, open, step, setSection, jumpToWeek, close }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd app && npx vitest run src/pages/calendar/useEarningsModalRoute.test.jsx`

**Mutation control (three, because three separate contracts hang off this file):**
1. Change `open`'s `write(..., false)` to `true` → `open() PUSHES so one Back closes the modal` must FAIL. Restore in place.
2. Change `step`'s `write(..., true)` to `false` → `step() REPLACES …` must FAIL. Restore.
3. Replace `mergeParams`'s body with `return new URLSearchParams(patch)` → `open() preserves ?week and ?d` must FAIL. Restore.

- [ ] **Step 5: Verify + commit**

`git add app/src/pages/calendar/useEarningsModalRoute.js app/src/pages/calendar/useEarningsModalRoute.test.jsx`
Commit: `feat(research): useEarningsModalRoute — merge-preserving URL state, push-open/replace-step (P2 T4)`

---

### Task 5: §4.5 lifecycle state machine + settle debounce

**Files:**
- Create: `app/src/pages/calendar/earningsLifecycle.js`, `app/src/pages/calendar/earningsLifecycle.test.js`
- Create: `app/src/hooks/useSettledSym.js`, `app/src/hooks/useSettledSym.test.jsx`

**Interfaces (frozen):**
- `IMMINENT_LEAD_MINUTES = 15`, `SESSION_ANCHOR_MINUTES = { bmo: 7 * 60, amc: 16 * 60, tbd: 16 * 60 }`
- `etParts(ms) -> { date: 'YYYY-MM-DD', minutes: number }` — wall-clock ET via `Intl`, DST-correct by construction.
- `windowStart({ reportDate, timing, timeEt }) -> { date, minutes }`
- `computeLifecycle({ nowMs, reportDate, timing, timeEt, reported, recapPresent, callStartMs }) -> 'PRE'|'IMMINENT'|'PRINTED'|'CALL_LIVE'|'POST'`
- `countdownText(nowMs, target) -> string | null` — `'in 4h 12m'` / `'in 9m'`; null once the window is reached.
- `shouldPollActuals({ lifecycle, isTodayReporter, modalOpen }) -> boolean`
- `ACTUALS_POLL_MS = 45000` (inside the spec's 30–60 s band)
- `useSettledSym(sym, delay = 200) -> { settled, stepping }`

**Time handling (decided, do not re-litigate):** ET arithmetic is done on **wall-clock parts** from `Intl.DateTimeFormat(..., { timeZone: 'America/New_York' })`, never on epoch offsets — DST is then correct for free and every test injects `nowMs`. `time_et` is used **only when the string carries an explicit offset or `Z`**; the calendar documents it as ET but does not guarantee an offset, and `new Date('2026-08-06T16:30:00')` is parsed as *local* time (this box is CT), which would shift the whole state machine by an hour. Without an offset the session anchor wins.

- [ ] **Step 1: Write the failing tests**

```js
// app/src/pages/calendar/earningsLifecycle.test.js
import { describe, it, expect } from 'vitest'
import {
  ACTUALS_POLL_MS, IMMINENT_LEAD_MINUTES, computeLifecycle, countdownText,
  etParts, shouldPollActuals, windowStart,
} from './earningsLifecycle'

// 2026-08-06 is a Thursday; ET is UTC-4 (EDT) on that date.
const at = (etHour, etMin = 0) => Date.parse(`2026-08-06T${String(etHour).padStart(2, '0')}:${String(etMin).padStart(2, '0')}:00-04:00`)
const base = { reportDate: '2026-08-06', timing: 'amc', timeEt: null,
               reported: false, recapPresent: false, callStartMs: null }

describe('etParts', () => {
  it('reports ET wall clock regardless of the host timezone', () => {
    expect(etParts(at(16, 5))).toEqual({ date: '2026-08-06', minutes: 16 * 60 + 5 })
  })
  it('is DST-correct across the standard-time boundary', () => {
    // 2026-01-15 12:00 ET is UTC-5.
    expect(etParts(Date.parse('2026-01-15T12:00:00-05:00')))
      .toEqual({ date: '2026-01-15', minutes: 12 * 60 })
  })
})

describe('windowStart', () => {
  it('anchors AMC at 16:00 ET and BMO at 07:00 ET', () => {
    expect(windowStart({ reportDate: '2026-08-06', timing: 'amc' }))
      .toEqual({ date: '2026-08-06', minutes: 16 * 60 })
    expect(windowStart({ reportDate: '2026-08-06', timing: 'bmo' }))
      .toEqual({ date: '2026-08-06', minutes: 7 * 60 })
  })
  it('treats an unknown session as AMC rather than inventing a time', () => {
    expect(windowStart({ reportDate: '2026-08-06', timing: null }).minutes).toBe(16 * 60)
  })
  it('uses time_et ONLY when it carries an explicit offset', () => {
    expect(windowStart({ reportDate: '2026-08-06', timing: 'amc',
                         timeEt: '2026-08-06T16:35:00-04:00' }).minutes).toBe(16 * 60 + 35)
    // No offset -> ambiguous -> the session anchor wins, NOT a local-time parse.
    expect(windowStart({ reportDate: '2026-08-06', timing: 'amc',
                         timeEt: '2026-08-06T16:35:00' }).minutes).toBe(16 * 60)
    expect(windowStart({ reportDate: '2026-08-06', timing: 'amc',
                         timeEt: 'not a date' }).minutes).toBe(16 * 60)
  })
  it('returns null without a report date', () => {
    expect(windowStart({ reportDate: null, timing: 'amc' })).toBeNull()
  })
})

describe('computeLifecycle (§4.5)', () => {
  it('PRE more than the lead time before the window', () => {
    expect(computeLifecycle({ ...base, nowMs: at(12, 0) })).toBe('PRE')
    expect(computeLifecycle({ ...base, nowMs: at(15, 44) })).toBe('PRE')
  })

  it('IMMINENT from lead-time-before the window until actuals land', () => {
    expect(IMMINENT_LEAD_MINUTES).toBe(15)
    expect(computeLifecycle({ ...base, nowMs: at(15, 45) })).toBe('IMMINENT')
    expect(computeLifecycle({ ...base, nowMs: at(16, 30) })).toBe('IMMINENT')
    // no stale "Reports tonight" survives past T0
    expect(computeLifecycle({ ...base, nowMs: at(19, 0) })).toBe('IMMINENT')
  })

  it('PRINTED as soon as actuals are present', () => {
    expect(computeLifecycle({ ...base, nowMs: at(16, 20), reported: true })).toBe('PRINTED')
  })

  it('CALL_LIVE once the call start passes with actuals but no recap', () => {
    expect(computeLifecycle({ ...base, nowMs: at(17, 5), reported: true,
                             callStartMs: at(17, 0) })).toBe('CALL_LIVE')
    // the call time alone, with nothing printed, is NOT call-live
    expect(computeLifecycle({ ...base, nowMs: at(17, 5), reported: false,
                             callStartMs: at(17, 0) })).toBe('IMMINENT')
    // before the call start it is still just PRINTED
    expect(computeLifecycle({ ...base, nowMs: at(16, 40), reported: true,
                             callStartMs: at(17, 0) })).toBe('PRINTED')
  })

  it('POST once a recap exists, whatever else is true', () => {
    expect(computeLifecycle({ ...base, nowMs: at(18, 0), reported: true,
                              recapPresent: true, callStartMs: at(17, 0) })).toBe('POST')
    expect(computeLifecycle({ ...base, nowMs: at(18, 0), reported: false,
                              recapPresent: true })).toBe('POST')
  })

  it('a BMO name is IMMINENT in the morning, not at 4pm', () => {
    const bmo = { ...base, timing: 'bmo' }
    expect(computeLifecycle({ ...bmo, nowMs: at(6, 30) })).toBe('PRE')
    expect(computeLifecycle({ ...bmo, nowMs: at(6, 50) })).toBe('IMMINENT')
  })

  it('a future report date stays PRE all of today', () => {
    expect(computeLifecycle({ ...base, reportDate: '2026-08-20', nowMs: at(23, 30) }))
      .toBe('PRE')
  })

  it('falls back to PRE when the report date is unknown', () => {
    expect(computeLifecycle({ ...base, reportDate: null, nowMs: at(20, 0) })).toBe('PRE')
  })
})

describe('countdownText', () => {
  it('renders hours and minutes, then minutes, then nothing', () => {
    const w = { date: '2026-08-06', minutes: 16 * 60 }
    expect(countdownText(at(12, 0), w)).toBe('in 4h 0m')
    expect(countdownText(at(15, 12), w)).toBe('in 48m')
    expect(countdownText(at(16, 1), w)).toBeNull()
    expect(countdownText(at(12, 0), null)).toBeNull()
  })
  it('spans a date boundary without going negative', () => {
    const w = { date: '2026-08-07', minutes: 7 * 60 }
    expect(countdownText(at(20, 0), w)).toBe('in 11h 0m')
  })
})

describe('shouldPollActuals', () => {
  it('polls ONLY for an open modal on a today-reporter in IMMINENT', () => {
    const on = { lifecycle: 'IMMINENT', isTodayReporter: true, modalOpen: true }
    expect(shouldPollActuals(on)).toBe(true)
    expect(shouldPollActuals({ ...on, modalOpen: false })).toBe(false)
    expect(shouldPollActuals({ ...on, isTodayReporter: false })).toBe(false)
    expect(shouldPollActuals({ ...on, lifecycle: 'PRE' })).toBe(false)
    expect(shouldPollActuals({ ...on, lifecycle: 'PRINTED' })).toBe(false)
  })
  it('polls inside the spec band of 30-60s', () => {
    expect(ACTUALS_POLL_MS).toBeGreaterThanOrEqual(30000)
    expect(ACTUALS_POLL_MS).toBeLessThanOrEqual(60000)
  })
})
```

```jsx
// app/src/hooks/useSettledSym.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

import useSettledSym from './useSettledSym'

function Probe({ sym }) {
  const { settled, stepping } = useSettledSym(sym, 200)
  return (
    <>
      <span data-testid="settled">{settled}</span>
      <span data-testid="stepping">{String(stepping)}</span>
    </>
  )
}

describe('useSettledSym (§4.4 settle debounce)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('the first symbol is settled immediately — opening must not wait 200ms', () => {
    render(<Probe sym="NVDA" />)
    expect(screen.getByTestId('settled').textContent).toBe('NVDA')
    expect(screen.getByTestId('stepping').textContent).toBe('false')
  })

  it('holds the previous symbol while stepping, then settles', () => {
    const { rerender } = render(<Probe sym="NVDA" />)
    rerender(<Probe sym="AMD" />)
    expect(screen.getByTestId('settled').textContent).toBe('NVDA')
    expect(screen.getByTestId('stepping').textContent).toBe('true')
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByTestId('settled').textContent).toBe('AMD')
    expect(screen.getByTestId('stepping').textContent).toBe('false')
  })

  it('a fast run of steps settles ONCE, on the last symbol', () => {
    const { rerender } = render(<Probe sym="A" />)
    for (const s of ['B', 'C', 'D', 'E']) {
      rerender(<Probe sym={s} />)
      act(() => { vi.advanceTimersByTime(50) })
    }
    expect(screen.getByTestId('settled').textContent).toBe('A')
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByTestId('settled').textContent).toBe('E')
  })

  it('settles on null (the modal closing) without hanging a timer', () => {
    const { rerender, unmount } = render(<Probe sym="NVDA" />)
    rerender(<Probe sym={null} />)
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByTestId('settled').textContent).toBe('')
    expect(() => unmount()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run src/pages/calendar/earningsLifecycle.test.js src/hooks/useSettledSym.test.jsx`
Expected: both fail to resolve their imports.

- [ ] **Step 3: Implement**

```js
// app/src/pages/calendar/earningsLifecycle.js
//
// The §4.5 report-night state machine. PURE FUNCTIONS OF DATA TIMESTAMPS —
// there are no scheduled UI timers here beyond the polling cadence the modal
// applies, and `nowMs` is always injected so no test can be a weekday bomb.
//
// TIME HANDLING (decided): all ET arithmetic runs on WALL-CLOCK PARTS pulled
// through Intl with timeZone 'America/New_York', never on epoch offsets, so
// DST is correct by construction. The calendar's `time_et` is documented as ET
// but is NOT guaranteed to carry an offset, and `new Date('2026-08-06T16:30')`
// parses as LOCAL time (this box is CT) — an hour of silent skew across the
// whole machine. So `time_et` is honoured only when it carries an explicit
// offset or Z; otherwise the session anchor wins.

export const IMMINENT_LEAD_MINUTES = 15

/** ET wall-clock anchors for the report window when no precise time is given. */
export const SESSION_ANCHOR_MINUTES = { bmo: 7 * 60, amc: 16 * 60, tbd: 16 * 60 }

/** §4.5: 30-60s while the modal is open on a today-reporter. Nothing else. */
export const ACTUALS_POLL_MS = 45000

const HAS_OFFSET = /([Zz]|[+-]\d{2}:?\d{2})$/

const _fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
})

/** { date: 'YYYY-MM-DD', minutes } in ET for an epoch ms value. */
export function etParts(ms) {
  const parts = Object.fromEntries(
    _fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
  )
  // Intl can render midnight as hour '24' in some engines; normalise it.
  const hour = Number(parts.hour) % 24
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
  }
}

/** The ET wall-clock instant the report window opens, or null. */
export function windowStart({ reportDate, timing, timeEt } = {}) {
  const date = typeof reportDate === 'string' ? reportDate.slice(0, 10) : null
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  if (typeof timeEt === 'string' && HAS_OFFSET.test(timeEt.trim())) {
    const ms = Date.parse(timeEt)
    if (Number.isFinite(ms)) return etParts(ms)
  }
  const key = (timing || '').toLowerCase()
  const minutes = SESSION_ANCHOR_MINUTES[key] ?? SESSION_ANCHOR_MINUTES.amc
  return { date, minutes }
}

/** Signed minutes from `a` to `b`, both { date, minutes }. */
function minutesBetween(a, b) {
  const days = (Date.parse(`${b.date}T00:00:00Z`) - Date.parse(`${a.date}T00:00:00Z`)) / 86400000
  return days * 1440 + (b.minutes - a.minutes)
}

/**
 * The state, in strict precedence order:
 *   POST       a recap exists (whatever else is true)
 *   CALL_LIVE  actuals present AND the call start has passed, recap absent
 *   PRINTED    actuals present
 *   IMMINENT   the window (minus the lead) has been entered, no actuals
 *   PRE        everything else, including an unknown report date
 */
export function computeLifecycle({
  nowMs, reportDate, timing, timeEt, reported, recapPresent, callStartMs,
} = {}) {
  if (recapPresent) return 'POST'
  if (reported) {
    if (Number.isFinite(callStartMs) && Number.isFinite(nowMs) && nowMs >= callStartMs) {
      return 'CALL_LIVE'
    }
    return 'PRINTED'
  }
  const start = windowStart({ reportDate, timing, timeEt })
  if (!start || !Number.isFinite(nowMs)) return 'PRE'
  return minutesBetween(etParts(nowMs), start) <= IMMINENT_LEAD_MINUTES ? 'IMMINENT' : 'PRE'
}

/** 'in 4h 12m' / 'in 48m', or null once the window is reached. */
export function countdownText(nowMs, start) {
  if (!start || !Number.isFinite(nowMs)) return null
  const mins = minutesBetween(etParts(nowMs), start)
  if (mins <= 0) return null
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return h >= 1 ? `in ${h}h ${m}m` : `in ${m}m`
}

/** §4.5 step 2 — the ONLY condition under which the actuals poll may run. */
export function shouldPollActuals({ lifecycle, isTodayReporter, modalOpen } = {}) {
  return lifecycle === 'IMMINENT' && !!isTodayReporter && !!modalOpen
}
```

```js
// app/src/hooks/useSettledSym.js
//
// The §4.4 / §7 settle debounce. Arrow-key stepping across a 40-name day is
// exactly the banned per-card fetch-storm class: the modal's own
// AbortController covers only the modal's own fetches, NOT the child SWR hooks
// each section owns. So sections key off the SETTLED symbol, and only the
// live-price poll follows the raw one.
//
// The FIRST symbol settles immediately — opening a modal must never cost 200ms
// of deliberate latency; the debounce exists for CHANGES, not for mounts.
import { useEffect, useRef, useState } from 'react'

export const SETTLE_MS = 200

export default function useSettledSym(sym, delay = SETTLE_MS) {
  const [settled, setSettled] = useState(sym)
  const settledRef = useRef(sym)
  settledRef.current = settled

  useEffect(() => {
    if (sym === settledRef.current) return undefined
    const t = setTimeout(() => setSettled(sym), delay)
    return () => clearTimeout(t)
  }, [sym, delay])

  return { settled, stepping: sym !== settled }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd app && npx vitest run src/pages/calendar/earningsLifecycle.test.js src/hooks/useSettledSym.test.jsx`

**Mutation control:**
1. In `computeLifecycle`, move the `if (reported)` block above `if (recapPresent)` → `POST once a recap exists, whatever else is true` must FAIL. Restore in place.
2. In `windowStart`, drop the `HAS_OFFSET.test(...)` guard (parse `timeEt` unconditionally) → `uses time_et ONLY when it carries an explicit offset` must FAIL. Restore.
3. In `useSettledSym`, initialise `useState(null)` instead of `useState(sym)` → `the first symbol is settled immediately` must FAIL. Restore.

- [ ] **Step 5: Verify + commit**

`git add app/src/pages/calendar/earningsLifecycle.js app/src/pages/calendar/earningsLifecycle.test.js app/src/hooks/useSettledSym.js app/src/hooks/useSettledSym.test.jsx`
Commit: `feat(research): §4.5 lifecycle state machine + 200ms settle debounce (P2 T5)`

---

### Task 6: The modal shell — two-pane, banner, rail, footer, phone sheet (GATES b, c, d)

**CONTROLLER AMENDMENT (overrules the coverage-table deferral of the banner price slot):**
the banner's `price` slot IS wired in P2, via the shared `useLivePrices` pool
(`app/src/hooks/useLivePrices` — verify the exact import; it dedupes browser-wide, so
this is a one-symbol union add, not a new fetch surface). The plan's own stepping
constraint ("only the live-price poll follows the raw symbol") already assumes it.
Wire: `const px = useLivePrices([rawSym])` in the shell → format `$X.XX ▲Y.Y%` with
`.t-num` semantics through the banner's `price` prop; price follows the RAW (un-debounced)
symbol during stepping; no animation on update (§3.1 one-ticking-element rule — the
countdown is the ticker, the price just swaps text). Test: banner shows the formatted
price when the pool returns one, empty slot (no crash) when it doesn't.

**Files:**
- Create: `app/src/components/research/EarningsResearchModal.jsx`, `.module.css`, `.test.jsx`
- Create: `app/src/components/research/railSections.js`
- Create: `app/src/hooks/useExpectedMove.js`
- Modify (KIT EDIT #1, gate b): `app/src/components/research-kit/shell/IdentityBanner.jsx`
- Modify (KIT EDIT #2, gate b): `app/src/components/research-kit/shell/PinnedFooter.jsx`
- Modify: `app/src/pages/research/ResearchPage.jsx` (so the rail's link items land where they promise)

**Interfaces (frozen — every later task binds to these):**

```jsx
<EarningsResearchModal
  row               // toModalRow() output + optional {company, sector, hist_stats, beat_history, expected_move, time_et, date_est}
  label             // timingLabel() output
  reportDate        // 'YYYY-MM-DD' | null
  timing            // 'bmo' | 'amc' | 'tbd' | null
  section           // rail id | null  (controlled; null = default 'setup')
  onSectionChange   // (id) => void
  onClose           // () => void
  onStepPrev        // () => void | null   — null hides/disables the control
  onStepNext        // () => void | null
  stepping          // boolean — true while the settle debounce is pending
  onPollActuals     // () => void | null   — the §4.5 IMMINENT revalidate
  isTodayReporter   // boolean
  nowMs             // number (injected; defaults to Date.now() at mount tick)
/>
```

- `railSections.js` exports `SECTIONS = [{id:'setup',label:'Setup',icon:'chart'}, {id:'history',label:'Earnings History',icon:'clock'}, {id:'brief',label:'Brief',icon:'document'}, {id:'call',label:'Call',icon:'chat'}]`, `SECTION_IDS`, `DEFAULT_SECTION = 'setup'`, `normalizeSection(id)`, and `railLinks(sym)` → `[{id:'analyst',label:'Analyst & Ownership',icon:'user',href:'/research/<SYM>?section=ownership'}, {id:'filings',label:'Filings',icon:'document',href:'/research/<SYM>?section=filings'}]`.
- `useExpectedMove(sym, reportDate)` → SWR over `/api/research/expected-move/{sym}?report_date=…` → `{ data: {live, history, history_since, grade}, isLoading }`. `refreshInterval: 0`, `revalidateOnFocus: false` (the payload is 15-min-cached server-side and a modal is not a ticker tape).

**Gate wiring in this task:**
- **(b)** `IdentityBanner` and `PinnedFooter` gain `as`; the modal passes `as="div"` on both. Test asserts `queryByRole('banner')` / `queryByRole('contentinfo')` are null **inside the modal**, and a second test asserts the kit DEFAULT still renders them (so `IdentityBanner.test.jsx:116` keeps passing and the research page keeps its landmarks in P3).
- **(c)** Panels UNMOUNT: `{active === s.id && <Panel/>}`. Test asserts the inactive panel testid is absent and that no rendered panel carries `hidden` or an inline `display:none`.
- **(d)** This is the FIRST commit that imports the kit from the app tree. Step 5 records the `vendor-echarts` + new-chunk sizes before and after.

**Section panels are injected, not imported here.** The shell renders `props.renderSection(id)` supplied by a small `SECTION_COMPONENTS` map in the same file, and Tasks 7–10 fill that map. Until then each entry renders an `EmptyState` placeholder, so the shell task is independently testable and green.

- [ ] **Step 1: Write the failing tests**

```jsx
// app/src/components/research/EarningsResearchModal.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import EarningsResearchModal from './EarningsResearchModal'
import { SECTIONS } from './railSections'
import { NOT_ADVICE } from '../../constants/disclaimer'
import { countGoldHighlights } from '../research-kit/testing/restraint'

vi.mock('../../hooks/useExpectedMove', () => ({
  default: () => ({ data: { live: null, history: [], history_since: null, grade: null },
                    isLoading: false }),
}))
// Section bodies are Tasks 7-10; the shell test owns the shell.
vi.mock('./sections/SetupSection', () => ({ default: () => <div data-testid="panel-setup" /> }))
vi.mock('./sections/EarningsHistorySection', () => ({ default: () => <div data-testid="panel-history" /> }))
vi.mock('./sections/BriefSection', () => ({ default: () => <div data-testid="panel-brief" /> }))
vi.mock('./sections/CallSection', () => ({ default: () => <div data-testid="panel-call" /> }))

const row = { sym: 'NVDA', company: 'NVIDIA Corporation', sector: 'Technology',
              verdict: 'pending', eps_estimate: 0.94, reported_eps: null }

const NOW = Date.parse('2026-08-06T12:00:00-04:00')

function renderModal(props = {}) {
  return render(
    <MemoryRouter>
      <EarningsResearchModal
        row={row} label="AFTER MARKET CLOSE" reportDate="2026-08-06" timing="amc"
        section={null} onSectionChange={() => {}} onClose={() => {}}
        onStepPrev={null} onStepNext={null} stepping={false}
        onPollActuals={null} isTodayReporter nowMs={NOW}
        {...props}
      />
    </MemoryRouter>,
  )
}

beforeEach(() => { global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })) })

describe('shell structure', () => {
  it('is a labelled modal dialog naming the symbol', () => {
    renderModal()
    const dlg = screen.getByRole('dialog')
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(dlg.getAttribute('aria-label')).toMatch(/NVDA/)
  })

  it('renders the four launch sections as TABS', () => {
    renderModal()
    const tabs = screen.getAllByRole('tab').map(t => t.textContent.trim())
    expect(tabs).toEqual(['Setup', 'Earnings History', 'Brief', 'Call'])
    expect(SECTIONS.map(s => s.label)).toEqual(tabs)
  })

  it('renders Analyst & Ownership and Filings as LINKS, not tabs', () => {
    renderModal()
    const ao = screen.getByRole('link', { name: /Analyst & Ownership/i })
    const fl = screen.getByRole('link', { name: /Filings/i })
    expect(ao.getAttribute('href')).toBe('/research/NVDA?section=ownership')
    expect(fl.getAttribute('href')).toBe('/research/NVDA?section=filings')
    expect(screen.queryByRole('tab', { name: /Analyst & Ownership/i })).toBeNull()
    expect(screen.queryByRole('tab', { name: /Filings/i })).toBeNull()
  })
})

// ── GATE b ────────────────────────────────────────────────────────────────────
describe('GATE b — landmarks are per-surface', () => {
  it('the modal contributes NO page landmarks for banner or footer', () => {
    renderModal()
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('contentinfo')).toBeNull()
    // the identity + actions rows still RENDER, they are just not landmarks
    expect(screen.getByTestId('rk-banner-line')).toBeTruthy()
    expect(screen.getByTestId('erm-footer')).toBeTruthy()
  })

  it('the kit DEFAULT still produces landmarks (the research page keeps them)', async () => {
    const { default: IdentityBanner } = await import('../research-kit/shell/IdentityBanner')
    const { default: PinnedFooter } = await import('../research-kit/shell/PinnedFooter')
    const { unmount } = render(<><IdentityBanner sym="NVDA" timingText="x" />
                                 <PinnedFooter><button>go</button></PinnedFooter></>)
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('contentinfo')).toBeTruthy()
    unmount()
  })
})

// ── GATE c ────────────────────────────────────────────────────────────────────
describe('GATE c — inactive panels UNMOUNT', () => {
  it('only the active panel is in the DOM', () => {
    renderModal()
    expect(screen.getByTestId('panel-setup')).toBeTruthy()
    expect(screen.queryByTestId('panel-history')).toBeNull()
    expect(screen.queryByTestId('panel-brief')).toBeNull()
    expect(screen.queryByTestId('panel-call')).toBeNull()
  })

  it('switching sections unmounts the previous panel (never display:none)', () => {
    const onSectionChange = vi.fn()
    const { rerender } = renderModal({ onSectionChange })
    fireEvent.click(screen.getByRole('tab', { name: 'Earnings History' }))
    expect(onSectionChange).toHaveBeenCalledWith('history')
    rerender(
      <MemoryRouter>
        <EarningsResearchModal
          row={row} label="AFTER MARKET CLOSE" reportDate="2026-08-06" timing="amc"
          section="history" onSectionChange={onSectionChange} onClose={() => {}}
          onStepPrev={null} onStepNext={null} stepping={false}
          onPollActuals={null} isTodayReporter nowMs={NOW}
        />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('panel-history')).toBeTruthy()
    expect(screen.queryByTestId('panel-setup')).toBeNull()
    const canvas = screen.getByTestId('erm-canvas')
    expect(canvas.querySelector('[hidden]')).toBeNull()
    expect(canvas.querySelector('[style*="display: none"]')).toBeNull()
  })

  it('an unknown section id falls back to setup rather than a blank canvas', () => {
    renderModal({ section: 'nonsense' })
    expect(screen.getByTestId('panel-setup')).toBeTruthy()
  })
})

// ── §4.5 wiring ───────────────────────────────────────────────────────────────
describe('§4.5 lifecycle', () => {
  it('PRE shows the timing line plus a countdown', () => {
    renderModal()
    expect(screen.getByTestId('rk-banner-line').textContent).toMatch(/AFTER MARKET CLOSE/i)
    expect(screen.getByText(/^in \d+h \d+m$/)).toBeTruthy()
  })

  it('IMMINENT replaces the timing copy — no stale "reports tonight" past T0', () => {
    renderModal({ nowMs: Date.parse('2026-08-06T16:30:00-04:00') })
    expect(screen.getByTestId('rk-banner-line').textContent).toMatch(/Awaiting numbers/i)
    expect(screen.queryByText(/^in \d/)).toBeNull()
  })

  it('PRINTED flips the banner to the result line', () => {
    renderModal({
      nowMs: Date.parse('2026-08-06T16:30:00-04:00'),
      row: { ...row, verdict: 'beat', reported_eps: 0.98, eps_estimate: 0.94,
             surprise_pct: '+4.3%' },
    })
    const line = screen.getByTestId('rk-banner-line').textContent
    expect(line).toMatch(/0\.98/)
    expect(line).toMatch(/0\.94/)
    expect(line).not.toMatch(/Awaiting/i)
  })

  it('polls actuals ONLY while open on a today-reporter in IMMINENT', () => {
    vi.useFakeTimers()
    const onPollActuals = vi.fn()
    const { unmount } = renderModal({
      nowMs: Date.parse('2026-08-06T16:30:00-04:00'), onPollActuals, isTodayReporter: true,
    })
    vi.advanceTimersByTime(46000)
    expect(onPollActuals).toHaveBeenCalledTimes(1)
    unmount()
    vi.advanceTimersByTime(46000)
    expect(onPollActuals).toHaveBeenCalledTimes(1)   // no orphan interval
    vi.useRealTimers()
  })

  it('does NOT poll in PRE', () => {
    vi.useFakeTimers()
    const onPollActuals = vi.fn()
    renderModal({ onPollActuals, isTodayReporter: true })
    vi.advanceTimersByTime(120000)
    expect(onPollActuals).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

// ── keyboard, focus, stepping ────────────────────────────────────────────────
describe('keyboard + stepping', () => {
  it('Escape closes', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('arrow keys step through the day, and are ignored inside an input', () => {
    const onStepNext = vi.fn(); const onStepPrev = vi.fn()
    renderModal({ onStepNext, onStepPrev })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onStepNext).toHaveBeenCalledTimes(1)
    expect(onStepPrev).toHaveBeenCalledTimes(1)

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowRight', bubbles: true })
    expect(onStepNext).toHaveBeenCalledTimes(1)
    input.remove()
  })

  it('renders banner chevrons when stepping is available', () => {
    renderModal({ onStepPrev: vi.fn(), onStepNext: vi.fn() })
    const stepper = screen.getByTestId('rk-banner-stepper')
    expect(within(stepper).getAllByRole('button')).toHaveLength(2)
  })

  it('traps focus inside the dialog', () => {
    renderModal({ onStepPrev: vi.fn(), onStepNext: vi.fn() })
    const dlg = screen.getByRole('dialog')
    const focusables = dlg.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')
    const last = focusables[focusables.length - 1]
    last.focus()
    fireEvent.keyDown(dlg, { key: 'Tab' })
    expect(dlg.contains(document.activeElement)).toBe(true)
  })
})

// ── footer + trust posture ───────────────────────────────────────────────────
describe('footer + §12', () => {
  it('pins View Chart and Open full report', () => {
    renderModal()
    const footer = screen.getByTestId('erm-footer')
    expect(within(footer).getByText(/View Chart/i)).toBeTruthy()
    expect(within(footer).getByText(/full (report|research)/i)).toBeTruthy()
  })

  it('carries the standing not-advice line', () => {
    renderModal()
    expect(screen.getByTestId('erm-not-advice').textContent).toBe(NOT_ADVICE)
  })

  it('never uses the word "verdict" in user-facing copy', () => {
    const { container } = renderModal()
    expect(container.textContent.toLowerCase()).not.toContain('verdict')
  })

  it('keeps the canvas inside the one-gold-highlight budget', () => {
    renderModal()
    expect(countGoldHighlights(screen.getByTestId('erm-canvas'))).toBeLessThanOrEqual(1)
  })
})
```

Plus a two-line addition to `app/src/pages/research/ResearchPage.test.jsx`:

```jsx
it('honours ?section= so the modal rail links land where they promise', () => {
  // render ResearchPage at /research/NVDA?section=ownership using this file's
  // existing render helper, then:
  expect(screen.getByRole('button', { name: 'Ownership' }).className)
    .toMatch(/active/i)   // NOTE: replace with this suite's existing active-tab oracle
})
```
> When writing that test, reuse whatever oracle `ResearchPage.test.jsx` already uses for "this tab is active" (read the file first) — do **not** introduce a className regex if the file has a better oracle available.

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run src/components/research/EarningsResearchModal.test.jsx`
Expected: import resolution failure.

- [ ] **Step 3: Implement**

**Kit edit #1** — `research-kit/shell/IdentityBanner.jsx`. Add to the props list and use it, plus one comment block:

```jsx
/**
 * ...existing docblock...
 *
 * `as` (P2 gate b) — LANDMARK SCOPE. `<header>` maps to the `banner` landmark
 * whenever its nearest sectioning ancestor is the body, and a `role="dialog"`
 * div is NOT sectioning content, so a banner rendered inside the earnings modal
 * would add a SECOND page banner beside the app's own. The research page (P3)
 * wants the landmark and keeps the default; the modal passes `as="div"`. This
 * is a per-surface decision, which is exactly why it is a prop and not a
 * hardcoded element.
 */
export default function IdentityBanner({
  logo, sym, company, sector, lifecycle = 'PRE', timingText, resultText,
  countdown, price, grade, guidance, stepper,
  as: Tag = 'header',
  className = '',
}) {
```

and change the root element to `<Tag className={...} data-lifecycle={state}> … </Tag>`.

**Kit edit #2** — `research-kit/shell/PinnedFooter.jsx`, same treatment:

```jsx
export default function PinnedFooter({ children, ariaLabel = 'Actions', as: Tag = 'footer', className = '' }) {
  const items = Children.toArray(children).filter(Boolean)
  if (!items.length) return null
  return <Tag className={`${styles.footer} ${className}`} aria-label={ariaLabel}>{items}</Tag>
}
```
(`aria-label` on a plain `div` with no role is inert but harmless; the modal supplies its own `data-testid` for the oracle.)

```js
// app/src/components/research/railSections.js
// §4.3: the LAUNCH modal is Banner + Setup + Earnings History + Brief + Call,
// with Analyst & Ownership and Filings as LINK items that deep-open the
// corresponding /research section. They are links, not tabs, on purpose: a
// 45-day-stale 13F adds little on print night, and duplicating those panels
// in-modal cannibalises the "Open full report" funnel. SectionRail keeps them
// in a sibling group so a screen reader is never told "tab 6 of 7" about
// something that navigates away.
export const DEFAULT_SECTION = 'setup'

export const SECTIONS = [
  { id: 'setup', label: 'Setup', icon: 'chart' },
  { id: 'history', label: 'Earnings History', icon: 'clock' },
  { id: 'brief', label: 'Brief', icon: 'document' },
  { id: 'call', label: 'Call', icon: 'chat' },
]

export const SECTION_IDS = SECTIONS.map((s) => s.id)

export function normalizeSection(id) {
  return SECTION_IDS.includes(id) ? id : DEFAULT_SECTION
}

// UIcon registry note: there is no `users` glyph — `user` is the correct name.
export function railLinks(sym) {
  const s = encodeURIComponent((sym || '').toUpperCase())
  return [
    { id: 'analyst', label: 'Analyst & Ownership', icon: 'user', href: `/research/${s}?section=ownership` },
    { id: 'filings', label: 'Filings', icon: 'document', href: `/research/${s}?section=filings` },
  ]
}
```

```js
// app/src/hooks/useExpectedMove.js
// GET /api/research/expected-move/{sym} -> { live, history, history_since, grade }
// One request serves the banner's Setup Grade chip AND the Setup hero — see the
// architecture note in api/routers/expected_move.py.
import useSWR from 'swr'

const fetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)

export default function useExpectedMove(sym, reportDate) {
  const s = (sym || '').toUpperCase().trim()
  const qs = reportDate ? `?report_date=${encodeURIComponent(reportDate)}` : ''
  const { data, isLoading } = useSWR(
    s ? `/api/research/expected-move/${encodeURIComponent(s)}${qs}` : null,
    fetcher,
    // The payload is 15-min cached server-side behind serve-stale; a modal is
    // not a ticker tape and re-polling it would re-run the grade fan-out.
    { refreshInterval: 0, revalidateOnFocus: false, dedupingInterval: 60_000 },
  )
  return { data: data || null, isLoading: isLoading && !data }
}
```

```jsx
// app/src/components/research/EarningsResearchModal.jsx
//
// The launch earnings modal (spec §4). Two-pane glass on desktop/tablet, the
// existing mobile Sheet on a phone. The SHELL owns: identity, lifecycle,
// section switching, keyboard, focus, the pinned actions and the §12 line.
// It owns NO section data — each panel fetches its own, keyed off the SETTLED
// symbol so arrow-stepping cannot start a fetch storm.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import CompanyLogo from '../CompanyLogo'
import TickerPopup from '../TickerPopup'
import UIcon from '../ui/UIcon'
import Sheet from '../mobile/Sheet'
import { useIsPhone } from '../../hooks/useBreakpoint'
import { useAuth } from '../../context/AuthContext'
import { IdentityBanner, PinnedFooter, SectionRail, VerdictChip } from '../research-kit'
import { NOT_ADVICE, SETUP_GRADE_INFO } from '../../constants/disclaimer'
import useExpectedMove from '../../hooks/useExpectedMove'
import useSettledSym from '../../hooks/useSettledSym'
import {
  ACTUALS_POLL_MS, computeLifecycle, countdownText, shouldPollActuals, windowStart,
} from '../../pages/calendar/earningsLifecycle'
import { DEFAULT_SECTION, SECTIONS, normalizeSection, railLinks } from './railSections'
import SetupSection from './sections/SetupSection'
import EarningsHistorySection from './sections/EarningsHistorySection'
import BriefSection from './sections/BriefSection'
import CallSection from './sections/CallSection'
import styles from './EarningsResearchModal.module.css'

const PANELS = {
  setup: SetupSection,
  history: EarningsHistorySection,
  brief: BriefSection,
  call: CallSection,
}

const FOCUSABLE = 'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

const fmtEps = (v) => (v == null ? null : `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`)

/** The PRINTED/POST result line — pure data, never a claim (§4.2). */
function resultLine(row) {
  const act = fmtEps(row?.reported_eps)
  const est = fmtEps(row?.eps_estimate)
  if (!act) return 'Reported'
  const head = est ? `${act} vs ${est} est` : act
  return row?.surprise_pct ? `${head} · ${row.surprise_pct}` : head
}

export default function EarningsResearchModal({
  row, label, reportDate = null, timing = null,
  section = null, onSectionChange,
  onClose,
  onStepPrev = null, onStepNext = null, stepping = false,
  onPollActuals = null, isTodayReporter = false,
  nowMs,
}) {
  const navigate = useNavigate()
  const { isPaid } = useAuth()
  // Click-triggered conditional rendering — the sanctioned useIsPhone case: the
  // modal mounts as the direct result of a tap, so matchMedia is already
  // meaningful at that mount. Everything ELSE responsive here is CSS @media.
  const isPhone = useIsPhone()
  const panelRef = useRef(null)
  const sym = row?.sym || ''

  const active = normalizeSection(section)
  const { settled: settledSym } = useSettledSym(sym)

  // One tick per minute is enough for a countdown; nowMs may be injected.
  const [tick, setTick] = useState(() => nowMs ?? Date.now())
  useEffect(() => {
    if (nowMs != null) { setTick(nowMs); return undefined }
    const id = setInterval(() => setTick(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [nowMs])

  const { data: em } = useExpectedMove(settledSym, reportDate)
  const grade = em?.grade || null

  const reported = row?.reported_eps != null
  const lifecycle = computeLifecycle({
    nowMs: tick, reportDate, timing, timeEt: row?.time_et,
    reported, recapPresent: false, callStartMs: null,
  })
  const start = useMemo(() => windowStart({ reportDate, timing, timeEt: row?.time_et }),
                        [reportDate, timing, row?.time_et])

  // ── §4.5 IMMINENT actuals poll — modal-open + today-reporter ONLY ──────────
  useEffect(() => {
    if (!onPollActuals) return undefined
    if (!shouldPollActuals({ lifecycle, isTodayReporter, modalOpen: true })) return undefined
    const id = setInterval(onPollActuals, ACTUALS_POLL_MS)
    return () => clearInterval(id)
  }, [lifecycle, isTodayReporter, onPollActuals])

  // ── Escape + arrow stepping. Ignored while focus is in a text field. ───────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose?.(); return }
      const t = e.target
      const tag = (t?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return
      if (e.key === 'ArrowRight' && onStepNext) { e.preventDefault(); onStepNext() }
      if (e.key === 'ArrowLeft' && onStepPrev) { e.preventDefault(); onStepPrev() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onStepNext, onStepPrev])

  // ── Focus trap. Sheet focuses its panel but does NOT trap, so both paths
  //    need this. Restores focus on unmount via the mount-time activeElement.
  useEffect(() => {
    const restore = document.activeElement
    const node = panelRef.current
    node?.focus?.()
    return () => { if (restore && typeof restore.focus === 'function') restore.focus() }
  }, [])

  const onTrapKey = useCallback((e) => {
    if (e.key !== 'Tab') return
    const node = panelRef.current
    if (!node) return
    const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }, [])

  const Panel = PANELS[active]

  const stepper = (onStepPrev || onStepNext) ? (
    <>
      <button type="button" className={styles.stepBtn} onClick={onStepPrev}
              disabled={!onStepPrev} aria-label="Previous reporter">
        <UIcon name="chevronRight" size={14} gold={false} className={styles.stepPrevIcon} />
      </button>
      <button type="button" className={styles.stepBtn} onClick={onStepNext}
              disabled={!onStepNext} aria-label="Next reporter">
        <UIcon name="chevronRight" size={14} gold={false} />
      </button>
    </>
  ) : null

  const gradeChip = grade ? (
    <VerdictChip
      size="sm"
      tone="neutral"
      label={grade.basis ? `Setup Grade ${grade.letter} · ${grade.basis}` : `Setup Grade ${grade.letter}`}
      info={{
        ...SETUP_GRADE_INFO,
        text: `${SETUP_GRADE_INFO.text}\n${grade.inputs
          .map((i) => `${i.label} (${Math.round(i.weight * 100)}%): ${i.detail ?? 'unavailable'}`)
          .join('\n')}`,
      }}
    />
  ) : null

  const banner = (
    <IdentityBanner
      as="div"                                  {/* GATE b — not a page landmark */}
      logo={<CompanyLogo sym={sym} size={34} tile />}
      sym={sym}
      company={row?.company}
      sector={row?.sector}
      lifecycle={lifecycle}
      timingText={label}
      resultText={resultLine(row)}
      countdown={countdownText(tick, start)}
      grade={gradeChip}
      stepper={stepper}
    />
  )

  const body = (
    <>
      {banner}
      <div className={styles.panes}>
        <SectionRail
          sections={SECTIONS}
          links={railLinks(sym)}
          active={active}
          onSelect={onSectionChange}
          idPrefix="erm-rail"
          ariaLabel="Report sections"
          className={styles.rail}
        />
        <div
          className={styles.canvas}
          data-testid="erm-canvas"
          role="tabpanel"
          id={`erm-rail-panel-${active}`}
          aria-labelledby={`erm-rail-tab-${active}`}
          tabIndex={0}
        >
          {/* GATE c: the inactive panels are UNMOUNTED, never display:none —
              an ECharts instance that mounts at zero width never recovers. */}
          <Panel
            sym={settledSym}
            row={row}
            reportDate={reportDate}
            timing={timing}
            lifecycle={lifecycle}
            expectedMove={em}
            stepping={stepping}
          />
        </div>
      </div>
      <PinnedFooter as="div" ariaLabel="Actions" className={styles.footer}>
        <span data-testid="erm-footer" className={styles.footerInner}>
          <TickerPopup sym={sym} as="button" className={styles.btnChart}>View Chart</TickerPopup>
          <button type="button" className={styles.btnReport}
                  onClick={() => { onClose?.(); navigate(`/research/${sym}`) }}>
            {isPaid ? 'Open full report →'
                    : <><UIcon name="lock" size={13} gold={false} /> Unlock full research →</>}
          </button>
        </span>
      </PinnedFooter>
      {/* §12: the standing line lives BELOW the actions, as the modal's own
          sub-line rather than a PinnedFooter child, so it can never compete
          with the CTAs for the pinned row's horizontal space. */}
      <p className={styles.notAdvice} data-testid="erm-not-advice">{NOT_ADVICE}</p>
    </>
  )

  if (isPhone) {
    return (
      <Sheet open onClose={onClose} variant="bottom-sheet"
             ariaLabel={`${sym} earnings report`} className={styles.sheet}>
        {/* Sheet's drag-to-dismiss is already confined to its grip element, so
            canvas scrolling never fights the gesture (§4.4). */}
        <div ref={panelRef} tabIndex={-1} onKeyDown={onTrapKey} className={styles.phoneBody}>
          {body}
        </div>
      </Sheet>
    )
  }

  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div
        ref={panelRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={`${sym} earnings report`}
        tabIndex={-1}
        onKeyDown={onTrapKey}
      >
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
        {body}
      </div>
    </div>
  )
}
```

> **Implementer note:** JSX does not allow a `{/* comment */}` inside an attribute list. Move the two inline `{/* GATE b */}` markers onto their own lines above the element, or make them `//` comments outside the JSX. The tests do not depend on them.

`app/src/components/research/EarningsResearchModal.module.css` — key rules (tokens only; `backdrop-filter` appears on the backdrop ONLY, per §3.1):

```css
.backdrop { position: fixed; inset: 0; z-index: var(--z-modal, 1000); display: flex; align-items: center; justify-content: center; background: rgba(6, 8, 6, .66); backdrop-filter: blur(3px); padding: 16px; }
.modal { position: relative; width: min(960px, 100vw - 32px); max-height: min(88vh, 860px); display: flex; flex-direction: column; background: var(--bg); border: 1px solid var(--glass-border-accent); border-radius: var(--radius-xl); box-shadow: var(--shadow-popover); overflow: hidden; }
.close { position: absolute; top: 6px; right: 8px; z-index: 2; min-width: var(--tap-min); min-height: var(--tap-min); background: none; border: 0; color: var(--text-muted); font-size: 20px; cursor: pointer; }
.close:focus-visible { outline: var(--focus-ring); }
.panes { display: grid; grid-template-columns: 196px 1fr; flex: 1; min-height: 0; }
.rail { border-right: 1px solid var(--glass-border-neutral); background: var(--glass-chrome); }
.canvas { min-width: 0; min-height: 0; overflow-y: auto; padding: var(--space-lg); }
.canvas:focus-visible { outline: var(--focus-ring); outline-offset: -2px; }
.footer { background: var(--glass-chrome); }
.footerInner { display: flex; gap: var(--space-sm); align-items: center; width: 100%; }
.btnChart, .btnReport { min-height: var(--tap-min); border-radius: var(--radius-md); border: 1px solid var(--glass-border-neutral); background: var(--glass-surface); color: var(--text-bright); font-size: var(--text-sm); padding: 0 var(--space-md); cursor: pointer; }
.btnReport { margin-left: auto; border-color: var(--glass-border-accent); }
.btnChart:focus-visible, .btnReport:focus-visible, .stepBtn:focus-visible { outline: var(--focus-ring); }
.stepBtn { min-width: var(--tap-min); min-height: var(--tap-min); background: none; border: 0; color: var(--text-muted); cursor: pointer; }
.stepBtn[disabled] { opacity: .35; cursor: default; }
.stepPrevIcon { transform: rotate(180deg); }
.notAdvice { margin: 0; padding: var(--space-xs) var(--space-lg) var(--space-sm); font-size: var(--text-xs); color: var(--text-muted); background: var(--glass-chrome); }
.sheet { max-height: 92vh; }
.phoneBody { display: flex; flex-direction: column; min-height: 0; }

/* TABLET: two-pane survives at a narrower rail. */
@media (min-width: 641px) and (max-width: 1024px) { .panes { grid-template-columns: 152px 1fr; } .canvas { padding: var(--space-md); } }

/* PHONE: the rail becomes a horizontal chip row with an edge-fade overflow
   affordance; the canvas takes the full width. SectionRail's own module
   already flips its axis at this breakpoint — only the grid changes here. */
@media (max-width: 640px) {
  .panes { display: flex; flex-direction: column; }
  .rail { border-right: 0; border-bottom: 1px solid var(--glass-border-neutral); overflow-x: auto; -webkit-mask-image: linear-gradient(to right, #000 88%, transparent); mask-image: linear-gradient(to right, #000 88%, transparent); }
  .canvas { padding: var(--space-md); }
  .btnReport { margin-left: 0; flex: 1; }
}

@media (prefers-reduced-motion: reduce) { .modal, .backdrop { transition: none; animation: none; } }
```

`app/src/pages/research/ResearchPage.jsx` — seed the tab from `?section=` so the rail's link items are not a broken promise (P3 replaces the tab bar with the rail entirely):

```jsx
// P2: the earnings modal's rail LINK items deep-open /research/:sym?section=…
// (spec §4.3). Seeding the initial tab from that param is the whole contract —
// the tab stays local state afterwards, and P3 replaces this bar with SectionRail.
const SECTION_TO_TAB = {
  overview: 'Overview', financials: 'Financials', estimates: 'Estimates',
  ratings: 'Ratings', ownership: 'Ownership', calls: 'Calls & Transcript',
  filings: 'Filings & Events',
}
const [searchParams] = useSearchParams()
const [active, setActive] = useState(
  () => SECTION_TO_TAB[(searchParams.get('section') || '').toLowerCase()] || 'Overview',
)
```
(add `useSearchParams` to the existing `react-router-dom` import.)

- [ ] **Step 4: Run to verify they pass**

Run: `cd app && npx vitest run src/components/research/EarningsResearchModal.test.jsx src/components/research-kit/shell src/pages/research/ResearchPage.test.jsx`

**Mutation control (one per gate):**
1. Change `<IdentityBanner as="div"` to remove the prop → `the modal contributes NO page landmarks` must FAIL. Restore.
2. Replace the unmount with `<div hidden={active !== s.id}>` rendering all four → `switching sections unmounts the previous panel` must FAIL. Restore.
3. Change `shouldPollActuals(...)` to `true` → `does NOT poll in PRE` must FAIL. Restore.

- [ ] **Step 5: GATE d — measure the bundle, then commit**

This is the first commit that imports `research-kit` from the app tree, so it is where the honest bundle cost is recorded.

```
git stash list            # must be empty; do NOT use stash in this workflow
cd app && npm run build
```
Record, verbatim in the commit message, the sizes of `dist/assets/vendor-echarts-*.js` and of every new chunk this commit introduces, alongside the same numbers from a build of `HEAD~1`:

```
bundle (gate d):
  vendor-echarts  before <X> KB -> after <Y> KB  (delta <Z> KB)
  new chunks: <name> <size> KB ...
```
Expectation to sanity-check: `vendor-echarts` should be **unchanged or within a few KB** — the kit imports through `charts/echartsCore.js`, which resolves to modules already in that chunk. A jump of hundreds of KB means the core entry is not resolving and the task is wrong; stop and investigate rather than committing the number.

`git add app/src/components/research/EarningsResearchModal.jsx app/src/components/research/EarningsResearchModal.module.css app/src/components/research/EarningsResearchModal.test.jsx app/src/components/research/railSections.js app/src/hooks/useExpectedMove.js app/src/components/research-kit/shell/IdentityBanner.jsx app/src/components/research-kit/shell/PinnedFooter.jsx app/src/pages/research/ResearchPage.jsx app/src/pages/research/ResearchPage.test.jsx`
Commit: `feat(research): earnings modal shell — two-pane, banner, rail, footer, phone sheet (P2 T6)`

---

### Task 7: Earnings-history model — the frozen quarter rows, composed client-side

**Files:**
- Create: `app/src/components/research/earningsHistoryModel.js`, `.test.js`

**Why this exists:** `GET /api/research/earnings-history/{sym}` is **P4**. Spec §9 says the launch modal "computes history client-side from existing enrichment where available". Both the Setup hero and the Earnings History section consume the **same** rows, so this model is built once in the modal and passed to both — and it emits the **exact frozen row shape** the kit charts were built against, so P4 can swap the endpoint in with zero component change.

**Interfaces:**
- `quarterLabel(iso) -> 'Q1 26' | ''`
- `buildQuarters({ beatHistory, histStats, reportDate, row }) -> rows` — **oldest-first**, each `{quarter, report_date, period_end, session, reported, eps_estimate, eps_estimate_low, eps_estimate_high, eps_actual, surprise_pct, revenue_estimate, revenue_actual, revenue_surprise_pct, reaction_pct, gap_pct, drift_pct}`. Every field except `quarter` may be `null`.
- `historyBasis(rows) -> string` — the caption that states what this composition IS (`'4 quarters · reactions aligned by index'`), because it is an approximation and the spec's §2 north star is that every number carries its denominator.

**Two decisions this file encodes (documented in-code, do not "fix"):**

1. **Index alignment.** `beat_history` (Finnhub, ≤4, newest-first) and `hist_stats.last_n` (≤8 next-day moves, newest-first) are two independent lists with no shared key. They are zipped **by index over the shorter list**, which is correct as long as both are derived from the same quarterly history — which they are (`get_earnings_intel` and `get_historical_earnings_moves` both walk the reported quarters newest-first). It is still an approximation, so `historyBasis()` states the count and the method, and P4 replaces it with the real per-quarter join.
2. **The report-date row stays `reported: false` until its reaction is known.** `ImpliedVsRealized.pairQuarters` marks the current quarter by `q.reported === false` and only then falls back to `live.pct` for the hollow bar — so flipping the row to `reported` the instant EPS lands would drop tonight's implied bar out of the hero exactly when it matters most. The bar's "realized" value is the **price reaction**, which is not known until the next session; the EPS print is carried by the banner's result line and by the History table. Trade-off: `LollipopChart` renders that quarter's dot dashed on print night. Accepted, documented, and fixed in P4 when the endpoint carries `reported` and `reaction_pct` independently.

- [ ] **Step 1: Write the failing tests**

```js
// app/src/components/research/earningsHistoryModel.test.js
import { describe, it, expect } from 'vitest'
import { buildQuarters, historyBasis, quarterLabel } from './earningsHistoryModel'

const beatHistory = [   // newest-first, as Finnhub returns it
  { period: '2026-06-30', actual: 0.91, estimate: 0.88, beat: true, surprise: 3.4 },
  { period: '2026-03-31', actual: 0.80, estimate: 0.82, beat: false, surprise: -2.4 },
  { period: '2025-12-31', actual: 0.75, estimate: 0.70, beat: true, surprise: 7.1 },
  { period: '2025-09-30', actual: 0.66, estimate: 0.66, beat: true, surprise: 0 },
]
const histStats = { avg_abs_move: 6.4, up_count: 3, total: 4, last_n: [8.2, -4.1, 5.5, -1.0] }
const row = { sym: 'NVDA', eps_estimate: 0.94, reported_eps: null }

describe('quarterLabel', () => {
  it('maps a period end to a fiscal-quarter label', () => {
    expect(quarterLabel('2026-06-30')).toBe('Q2 26')
    expect(quarterLabel('2026-01-31')).toBe('Q1 26')
    expect(quarterLabel('2025-12-31')).toBe('Q4 25')
    expect(quarterLabel(null)).toBe('')
    expect(quarterLabel('garbage')).toBe('')
  })
})

describe('buildQuarters', () => {
  it('returns oldest-first rows plus the current unreported quarter', () => {
    const rows = buildQuarters({ beatHistory, histStats, reportDate: '2026-08-06', row })
    expect(rows).toHaveLength(5)
    expect(rows.map(r => r.quarter)).toEqual(['Q3 25', 'Q4 25', 'Q1 26', 'Q2 26', 'Q3 26'])
    expect(rows.slice(0, 4).every(r => r.reported)).toBe(true)
    expect(rows[4].reported).toBe(false)
    expect(rows[4].eps_estimate).toBe(0.94)
    expect(rows[4].eps_actual).toBeNull()
  })

  it('aligns reactions by index over the shorter list, oldest-first', () => {
    const rows = buildQuarters({ beatHistory, histStats, reportDate: '2026-08-06', row })
    // last_n is newest-first: 8.2 belongs to the NEWEST reported quarter (Q2 26)
    expect(rows.map(r => r.reaction_pct)).toEqual([-1.0, 5.5, -4.1, 8.2, null])
  })

  it('never invents a reaction it does not have', () => {
    const rows = buildQuarters({
      beatHistory, histStats: { last_n: [8.2, -4.1] }, reportDate: '2026-08-06', row,
    })
    expect(rows.map(r => r.reaction_pct)).toEqual([null, null, -4.1, 8.2, null])
  })

  it('keeps a genuine 0 reaction instead of turning it into null', () => {
    const rows = buildQuarters({
      beatHistory: [beatHistory[0]], histStats: { last_n: [0] },
      reportDate: '2026-08-06', row,
    })
    expect(rows[0].reaction_pct).toBe(0)
  })

  it('keeps a genuine 0 surprise instead of dropping it', () => {
    const rows = buildQuarters({ beatHistory, histStats, reportDate: '2026-08-06', row })
    expect(rows[0].surprise_pct).toBe(0)      // Q3 25 surprise: 0
  })

  it('the report-date row stays unreported until its REACTION is known', () => {
    const printed = { ...row, reported_eps: 0.98, surprise_pct: '+4.3%' }
    const rows = buildQuarters({ beatHistory, histStats, reportDate: '2026-08-06', row: printed })
    const current = rows[rows.length - 1]
    // EPS is carried so the table can show it...
    expect(current.eps_actual).toBe(0.98)
    // ...but `reported` stays false so the Setup hero keeps tonight's implied bar
    // (pairQuarters uses reported===false to mean "this is the current quarter").
    expect(current.reported).toBe(false)
    expect(current.reaction_pct).toBeNull()
  })

  it('degrades to just the current quarter when there is no history at all', () => {
    const rows = buildQuarters({ beatHistory: null, histStats: null,
                                 reportDate: '2026-08-06', row })
    expect(rows).toHaveLength(1)
    expect(rows[0].reported).toBe(false)
  })

  it('returns an empty list when there is nothing at all to say', () => {
    expect(buildQuarters({})).toEqual([])
  })

  it('emits every field of the frozen row shape', () => {
    const rows = buildQuarters({ beatHistory, histStats, reportDate: '2026-08-06', row })
    expect(Object.keys(rows[0]).sort()).toEqual([
      'drift_pct', 'eps_actual', 'eps_estimate', 'eps_estimate_high', 'eps_estimate_low',
      'gap_pct', 'period_end', 'quarter', 'reaction_pct', 'report_date', 'reported',
      'revenue_actual', 'revenue_estimate', 'revenue_surprise_pct', 'session', 'surprise_pct',
    ])
  })
})

describe('historyBasis', () => {
  it('states the denominator and the method', () => {
    const rows = buildQuarters({ beatHistory, histStats, reportDate: '2026-08-06', row })
    expect(historyBasis(rows)).toBe('4 reported quarters · reactions aligned by index')
    expect(historyBasis([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run src/components/research/earningsHistoryModel.test.js` → import resolution failure.

- [ ] **Step 3: Implement**

```js
// app/src/components/research/earningsHistoryModel.js
//
// The per-quarter rows both the Setup hero and the Earnings History section
// consume. Built CLIENT-SIDE for the launch slice: the unified
// GET /api/research/earnings-history/{sym} endpoint is P4 (spec §6 row 3,
// §9 P4), and §9 says the launch modal composes from existing enrichment in
// the interim. The row shape emitted here is the FROZEN one the kit charts
// were built against, so P4 swaps the source with zero component change.
//
// DECISION 1 — INDEX ALIGNMENT. `beat_history` (Finnhub, <=4, newest-first)
// and `hist_stats.last_n` (<=8 next-day moves, newest-first) share no key.
// They are zipped by INDEX over the shorter list, which holds because both are
// walked newest-first off the same quarterly history. It is still an
// approximation, so `historyBasis()` states the count AND the method — every
// number carries its denominator (§2).
//
// DECISION 2 — THE REPORT-DATE ROW STAYS `reported: false` UNTIL ITS REACTION
// IS KNOWN. `ImpliedVsRealized.pairQuarters` identifies the current quarter by
// `reported === false` and only then falls back to `live.pct` for the hollow
// bar. Flipping the row the instant EPS lands would drop tonight's implied bar
// out of the hero exactly when it matters most. The bar's realized value is the
// PRICE REACTION, not the EPS print; the print is carried by the banner result
// line and the History table. Cost: LollipopChart draws that quarter dashed on
// print night. Accepted; P4 fixes it with independent flags.

const num = (v) => {
  // Number(null) === 0 — a bare Number()+isFinite check turns every missing
  // value into a phantom zero, which here would draw zero-height bars for
  // quarters that simply have no data.
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const dayKey = (d) => {
  const s = typeof d === 'string' ? d.trim() : ''
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

/** '2026-06-30' -> 'Q2 26'. Calendar-fiscal assumption, same as the Model Book. */
export function quarterLabel(iso) {
  const k = dayKey(iso)
  if (!k) return ''
  const [y, m] = k.split('-')
  const q = Math.floor((Number(m) - 1) / 3) + 1
  return `Q${q} ${y.slice(2)}`
}

function emptyRow(overrides) {
  return {
    quarter: '', report_date: null, period_end: null, session: null, reported: false,
    eps_estimate: null, eps_estimate_low: null, eps_estimate_high: null,
    eps_actual: null, surprise_pct: null,
    revenue_estimate: null, revenue_actual: null, revenue_surprise_pct: null,
    reaction_pct: null, gap_pct: null, drift_pct: null,
    ...overrides,
  }
}

export function buildQuarters({ beatHistory, histStats, reportDate, row } = {}) {
  const hist = Array.isArray(beatHistory) ? beatHistory.filter(Boolean) : []
  const moves = Array.isArray(histStats?.last_n) ? histStats.last_n : []

  // Both sources are newest-first; build newest-first, then reverse ONCE.
  const past = hist.map((h, i) => emptyRow({
    quarter: quarterLabel(h?.period),
    report_date: dayKey(h?.period),
    period_end: dayKey(h?.period),
    reported: true,
    eps_estimate: num(h?.estimate),
    eps_actual: num(h?.actual),
    surprise_pct: num(h?.surprise),
    reaction_pct: num(moves[i]),
  })).reverse()

  const rd = dayKey(reportDate)
  if (!rd && !past.length) return []
  if (!rd) return past

  past.push(emptyRow({
    quarter: quarterLabel(rd),
    report_date: rd,
    period_end: rd,
    reported: false,                       // see DECISION 2
    eps_estimate: num(row?.eps_estimate),
    eps_actual: num(row?.reported_eps),
    revenue_estimate: num(row?.rev_estimate),
    revenue_actual: num(row?.rev_actual),
  }))
  return past
}

/** The caption that states what this composition IS. Null when there is none. */
export function historyBasis(rows) {
  const reported = (rows || []).filter((r) => r.reported).length
  if (!reported) return null
  return `${reported} reported quarters · reactions aligned by index`
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd app && npx vitest run src/components/research/earningsHistoryModel.test.js`

**Mutation control:** change `num` to `const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)` → `never invents a reaction it does not have` must FAIL (missing reactions become 0). Restore in place. Then delete the `.reverse()` → `aligns reactions by index over the shorter list, oldest-first` must FAIL. Restore.

- [ ] **Step 5: Verify + commit**

`git add app/src/components/research/earningsHistoryModel.js app/src/components/research/earningsHistoryModel.test.js`
Commit: `feat(research): client-side earnings-history model in the frozen P4 row shape (P2 T7)`

---

### Task 8: Setup section — the hero, the break-even strip, the key stats

**Files:**
- Create: `app/src/components/research/sections/SetupSection.jsx`, `.module.css`, `.test.jsx`
- Modify (KIT EDIT #3, required by the "n/8 recorded" ruling): `app/src/components/research-kit/charts/ImpliedVsRealized.jsx` + its test

**Interfaces:**
```jsx
<SetupSection sym row reportDate timing lifecycle expectedMove stepping />
```
- `expectedMove` = the `useExpectedMove` payload `{live, history, history_since, grade}` (already fetched by the shell — the section does **not** re-fetch it).
- Own fetches: `useFundamentals(sym)` (key stats + 52-wk) and `/api/research/estimates/{sym}` via SWR for the consensus-drift stat. Both key off the **settled** sym the shell passes.

**Kit edit #3 — the "n/8 recorded" ruling.** `coldStartState` counts `pairs.filter(p => p.impliedPct != null)`, and `pairQuarters` fills the CURRENT quarter's `impliedPct` from `live.pct` — so today's live implied is counted as "recorded", which is exactly what the ruling forbids. The fix is a `recordedCount` prop threaded into `coldStartState`'s options; the caller passes `expectedMove.history.length` (the endpoint's stored-snapshot array). The internal count remains the fallback when the prop is absent, so no other consumer changes.

```js
// research-kit/charts/ImpliedVsRealized.jsx — coldStartState signature
export function coldStartState(
  pairs, historySince,
  { minPaired = MIN_PAIRED, total = TARGET_QUARTERS, recorded = null } = {},
) {
  // RULED (P2): `n` in "n/8 recorded" counts STORED history snapshots only —
  // never tonight's live implied. `pairs` cannot answer that, because
  // pairQuarters fills the current quarter's impliedPct from `live`. When the
  // caller knows the stored count it passes it; the internal count stays as the
  // fallback for callers that have only pairs.
  // `Number.isFinite(recorded)` is deliberate on the RAW value: Number(null)
  // is 0, so `Number.isFinite(Number(recorded))` would silently accept null
  // as a stored count of zero.
  const counted = Number.isFinite(recorded)
    ? recorded
    : (pairs || []).filter((p) => p.impliedPct != null).length
  const cold = counted < minPaired
  const since = typeof historySince === 'string' && historySince.length >= 7 ? historySince.slice(0, 7) : null
  const coverageText = `Implied tracking since ${since ?? '—'} · ${counted}/${total} recorded`
  return { cold, recorded: counted, total, since, caption: cold ? coverageText : null, coverageText }
}
```
and the component gains `recordedCount` in its props, passing it through:
```js
const cold = coldStartState(paired, historySince, { recorded: recordedCount })
```
(default `recordedCount` to `null` in the destructure, **not** `undefined`-with-a-default-inside — the explicit `null` keeps `Number.isFinite` honest.)

- [ ] **Step 1: Write the failing tests**

```jsx
// app/src/components/research-kit/charts/ImpliedVsRealized.test.jsx — APPEND
describe('recordedCount (P2 ruling: n counts STORED snapshots only)', () => {
  const quarters = [
    { quarter: 'Q1 26', report_date: '2026-02-05', reported: true, reaction_pct: 4.1 },
    { quarter: 'Q2 26', report_date: '2026-05-06', reported: true, reaction_pct: -2.2 },
    { quarter: 'Q3 26', report_date: '2026-08-06', reported: false, reaction_pct: null },
  ]

  it('coldStartState prefers the passed stored count over the pair count', () => {
    const pairs = pairQuarters(quarters, [], { pct: 6.8 })   // only the LIVE one is filled
    expect(coldStartState(pairs, '2026-08').recorded).toBe(1)        // legacy behaviour
    expect(coldStartState(pairs, '2026-08', { recorded: 0 }).recorded).toBe(0)
    expect(coldStartState(pairs, '2026-08', { recorded: 0 }).coverageText)
      .toBe('Implied tracking since 2026-08 · 0/8 recorded')
  })

  it('null/undefined recordedCount falls back to the internal count (not zero)', () => {
    const pairs = pairQuarters(quarters, [], { pct: 6.8 })
    expect(coldStartState(pairs, '2026-08', { recorded: null }).recorded).toBe(1)
    expect(coldStartState(pairs, '2026-08', {}).recorded).toBe(1)
  })

  it('the caption never counts tonight’s live implied', () => {
    render(<ImpliedVsRealized quarters={quarters} impliedHistory={[]}
                              live={{ pct: 6.8 }} historySince="2026-08" recordedCount={0} />)
    expect(screen.getByTestId('rk-ivr-cold').textContent).toBe(
      'Implied tracking since 2026-08 · 0/8 recorded')
  })
})
```

```jsx
// app/src/components/research/sections/SetupSection.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import SetupSection from './SetupSection'
import { buildQuarters } from '../earningsHistoryModel'
import { countGoldHighlights } from '../../research-kit/testing/restraint'

vi.mock('../../../hooks/useFundamentals', () => ({
  default: () => ({ data: { market_cap: 3.1e12, forward_pe: 38.4, beta: 1.72,
                            week52_high: 210, week52_low: 86.6, avg_vol: 245_000_000,
                            div_yield: 0.0002 } }),
}))
vi.mock('swr', async (orig) => {
  const actual = await orig()
  return {
    ...actual,
    default: (key) => (typeof key === 'string' && key.includes('/estimates/')
      ? { data: { revisions: [{ period: '0q', current: 0.94, ago30: 0.90, up30: 6, down30: 1 }] } }
      : { data: null }),
  }
})

const row = { sym: 'NVDA', eps_estimate: 0.94, reported_eps: null }
const beatHistory = [
  { period: '2026-06-30', actual: 0.91, estimate: 0.88, beat: true, surprise: 3.4 },
  { period: '2026-03-31', actual: 0.80, estimate: 0.82, beat: false, surprise: -2.4 },
  { period: '2025-12-31', actual: 0.75, estimate: 0.70, beat: true, surprise: 7.1 },
]
const histStats = { avg_abs_move: 6.4, up_count: 2, total: 3, last_n: [8.2, -4.1, 5.5] }
const live = { pct: 6.8, dollar: 12.5, spot: 184.0, expiry: '2026-08-07',
               horizon: 'through 2026-08-07' }

const em = (over = {}) => ({ live, history: [], history_since: null, grade: null, ...over })

function renderSetup(props = {}) {
  return render(
    <SetupSection sym="NVDA" row={{ ...row, beat_history: beatHistory, hist_stats: histStats }}
                  reportDate="2026-08-06" timing="amc" lifecycle="PRE"
                  expectedMove={em()} stepping={false} {...props} />,
  )
}

beforeEach(() => { global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })) })

describe('SetupSection', () => {
  it('leads with the implied-vs-realized hero', () => {
    renderSetup()
    expect(screen.getByTestId('rk-ivr')).toBeTruthy()
  })

  it('the coverage caption counts STORED snapshots, not tonight’s live implied', () => {
    renderSetup({ expectedMove: em({ history: [], history_since: '2026-08-01' }) })
    expect(screen.getByTestId('rk-ivr-cold').textContent)
      .toBe('Implied tracking since 2026-08 · 0/8 recorded')
  })

  it('counts the stored rows when history exists', () => {
    const history = [
      { report_date: '2026-05-06', pct: 5.9 },
      { report_date: '2026-02-05', pct: 7.2 },
    ]
    renderSetup({ expectedMove: em({ history, history_since: '2026-02-05' }) })
    expect(screen.getByTestId('rk-ivr-cold').textContent)
      .toBe('Implied tracking since 2026-02 · 2/8 recorded')
  })

  it('states the horizon on the break-even strip', () => {
    renderSetup()
    const strip = screen.getByTestId('setup-breakeven')
    expect(strip.textContent).toMatch(/through 2026-08-07/)
    expect(strip.textContent).toMatch(/171\.50/)     // 184.00 - 12.50
    expect(strip.textContent).toMatch(/196\.50/)     // 184.00 + 12.50
  })

  it('renders the key-stats strip with tabular numerics', () => {
    renderSetup()
    const stats = screen.getByTestId('setup-stats')
    expect(stats.textContent).toMatch(/Fwd P\/E/i)
    expect(stats.textContent).toMatch(/38\.4/)
    expect(stats.textContent).toMatch(/Beta/i)
    expect(stats.querySelector('.t-num')).toBeTruthy()
  })

  it('shows the consensus DRIFT, never the word "whisper"', () => {
    renderSetup()
    const drift = screen.getByTestId('setup-drift')
    expect(drift.textContent).toMatch(/\$0\.94/)
    expect(drift.textContent).toMatch(/\+4¢/)
    expect(drift.textContent).toMatch(/30d/)
    expect(drift.textContent.toLowerCase()).not.toContain('whisper')
  })

  it('omits the break-even strip entirely when there is no live move', () => {
    renderSetup({ expectedMove: em({ live: null }) })
    expect(screen.queryByTestId('setup-breakeven')).toBeNull()
    expect(screen.getByTestId('rk-ivr')).toBeTruthy()   // the hero still renders
  })

  it('keeps the canvas inside the one-gold-highlight budget', () => {
    const { container } = renderSetup()
    expect(countGoldHighlights(container)).toBeLessThanOrEqual(1)
  })

  it('never says "verdict"', () => {
    const { container } = renderSetup()
    expect(container.textContent.toLowerCase()).not.toContain('verdict')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run src/components/research/sections/SetupSection.test.jsx src/components/research-kit/charts/ImpliedVsRealized.test.jsx`

- [ ] **Step 3: Implement**

Apply KIT EDIT #3 exactly as written above, then:

```jsx
// app/src/components/research/sections/SetupSection.jsx
//
// §4.3.1 — the Setup canvas. ONE hero (ImpliedVsRealized), everything else is
// caption or support. The gold budget for this canvas is spent by the hero's
// own RICH/CHEAP chip, so nothing else here may be gold.
import { useMemo } from 'react'
import useSWR from 'swr'

import useFundamentals from '../../../hooks/useFundamentals'
import { EyebrowLabel, ImpliedVsRealized, RangeSlider, StatTile } from '../../research-kit'
import { SkeletonBlock } from '../../Skeleton'
import { IMPLIED_MOVE_INFO } from '../../../constants/disclaimer'
import { buildQuarters } from '../earningsHistoryModel'
import styles from './SetupSection.module.css'

const fetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)

const num = (v) => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const money = (v) => (v == null ? '—' : `$${v.toFixed(2)}`)

function compactCap(v) {
  const n = num(v)
  if (n == null) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toFixed(0)}`
}

function compactVol(v) {
  const n = num(v)
  if (n == null) return '—'
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`
}

/** "Est $0.94 · +4¢ / 30d" — the consensus DRIFT (§4.3.1b). Never "whisper". */
function driftText(revisions) {
  for (const r of revisions || []) {
    const cur = num(r?.current)
    const ago = num(r?.ago30)
    if (cur == null) continue
    if (ago == null) return `Est ${money(cur)}`
    const cents = Math.round((cur - ago) * 100)
    const sign = cents > 0 ? '+' : cents < 0 ? '−' : '±'
    return `Est ${money(cur)} · ${sign}${Math.abs(cents)}¢ / 30d`
  }
  return null
}

export default function SetupSection({ sym, row, reportDate, expectedMove }) {
  const { data: fundamentals } = useFundamentals(sym)
  const { data: estimates } = useSWR(
    sym ? `/api/research/estimates/${encodeURIComponent(sym)}` : null, fetcher,
    { refreshInterval: 0, revalidateOnFocus: false },
  )

  const quarters = useMemo(() => buildQuarters({
    beatHistory: row?.beat_history, histStats: row?.hist_stats, reportDate, row,
  }), [row, reportDate])

  const live = expectedMove?.live || null
  const history = expectedMove?.history || []
  const spot = num(live?.spot)
  const dollar = num(live?.dollar)
  const drift = driftText(estimates?.revisions)

  const lo52 = num(fundamentals?.week52_low)
  const hi52 = num(fundamentals?.week52_high)

  return (
    <div className={styles.wrap}>
      {/* HERO — the one instrument this canvas leads with. `recordedCount` is
          the endpoint's STORED snapshot array length: the "n/8 recorded"
          caption must never count tonight's live implied (P2 ruling). */}
      <ImpliedVsRealized
        quarters={quarters}
        impliedHistory={history}
        live={live}
        historySince={expectedMove?.history_since}
        recordedCount={history.length}
        info={IMPLIED_MOVE_INFO}
      />

      {live && dollar != null && spot != null && (
        <div className={styles.breakeven} data-testid="setup-breakeven">
          <RangeSlider
            label="Break-even range"
            min={spot - dollar}
            max={spot + dollar}
            value={spot}
            minLabel={money(spot - dollar)}
            maxLabel={money(spot + dollar)}
            valueLabel={money(spot)}
            tone="neutral"
            info={IMPLIED_MOVE_INFO}
            ariaLabel={`Break-even range ${money(spot - dollar)} to ${money(spot + dollar)}`}
          />
          <div className={`${styles.horizon} t-num`}>
            Priced ±{Math.abs(num(live.pct) ?? 0).toFixed(1)}% {live.horizon || (live.expiry ? `through ${live.expiry}` : '')}
          </div>
        </div>
      )}

      <EyebrowLabel>Key stats</EyebrowLabel>
      {!fundamentals ? (
        <SkeletonBlock height={72} />
      ) : (
        <div className={styles.stats} data-testid="setup-stats">
          <StatTile label="Mkt cap" value={<span className="t-num">{compactCap(fundamentals.market_cap)}</span>} />
          <StatTile label="Fwd P/E" value={<span className="t-num">{num(fundamentals.forward_pe)?.toFixed(1) ?? '—'}</span>} />
          <StatTile label="Beta" value={<span className="t-num">{num(fundamentals.beta)?.toFixed(2) ?? '—'}</span>} />
          <StatTile label="Avg vol" value={<span className="t-num">{compactVol(fundamentals.avg_vol)}</span>} />
          <StatTile label="Div yield" value={<span className="t-num">{num(fundamentals.div_yield) != null ? `${(fundamentals.div_yield * 100).toFixed(2)}%` : '—'}</span>} />
        </div>
      )}

      {lo52 != null && hi52 != null && (
        <RangeSlider
          label="52-week range"
          min={lo52} max={hi52} value={spot ?? undefined}
          minLabel={money(lo52)} maxLabel={money(hi52)}
          valueLabel={spot != null ? money(spot) : undefined}
          tone="neutral"
        />
      )}

      {drift && (
        <div className={`${styles.drift} t-num`} data-testid="setup-drift">{drift}</div>
      )}
    </div>
  )
}
```

`SetupSection.module.css`:

```css
.wrap { display: flex; flex-direction: column; gap: var(--space-lg); }
.breakeven { display: flex; flex-direction: column; gap: var(--space-xs); }
.horizon { font-size: var(--text-xs); color: var(--text-muted); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--space-sm); }
.drift { font-size: var(--text-sm); color: var(--text); }
@media (max-width: 640px) { .stats { grid-template-columns: repeat(2, 1fr); } }
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd app && npx vitest run src/components/research/sections/SetupSection.test.jsx src/components/research-kit/charts/ImpliedVsRealized.test.jsx`
Then the whole kit suite so the edit did not regress it: `cd app && npx vitest run src/components/research-kit`

**Mutation control:** change `recordedCount={history.length}` to `recordedCount={null}` → `the coverage caption counts STORED snapshots` must FAIL (it will read `1/8` off the live bar). Restore in place. Then change `Number.isFinite(recorded)` to `Number.isFinite(Number(recorded))` → `null/undefined recordedCount falls back to the internal count` must FAIL. Restore.

- [ ] **Step 5: Verify + commit**

`git add app/src/components/research/sections/SetupSection.jsx app/src/components/research/sections/SetupSection.module.css app/src/components/research/sections/SetupSection.test.jsx app/src/components/research-kit/charts/ImpliedVsRealized.jsx app/src/components/research-kit/charts/ImpliedVsRealized.test.jsx`
Commit: `feat(research): Setup section — implied-vs-realized hero, break-even strip, key stats (P2 T8)`

---

### Task 9: Earnings History section — lollipop + reactions on one axis, plus the table

**Files:**
- Create: `app/src/components/research/sections/EarningsHistorySection.jsx`, `.module.css`, `.test.jsx`

**Interfaces:** same section props as Task 8. This section fetches **nothing** — it renders entirely from `row` (enrichment) plus `expectedMove.live.pct` for the gold implied bracket. That is deliberate: it is the section arrow-stepping lands on most often after Setup, and a zero-fetch section cannot participate in a storm.

**Layout (§4.3.2):** `LollipopChart` (EPS story) directly above `ReactionBars` (price story) **on the same quarter axis**, then the caption `StatTile` row (AVG MOVE · CLOSED UP n/8 · BEST · WORST), then the compact quarterly table (ACT/EST · SURPRISE · REV · NEXT-DAY). The table stacks under the charts on phone. The gold budget for this canvas is spent by `ReactionBars`' implied ± bracket — nothing else here may be gold.

- [ ] **Step 1: Write the failing tests**

```jsx
// app/src/components/research/sections/EarningsHistorySection.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import EarningsHistorySection from './EarningsHistorySection'
import { countGoldHighlights } from '../../research-kit/testing/restraint'

// jsdom has no canvas: mock the React wrapper, NOT echarts/core, so
// echartsCore.js's real echarts.use([...]) registration stays in the path.
let capturedOption = null
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props) => { capturedOption = props.option; return <div data-testid="echart" /> },
}))

const beatHistory = [
  { period: '2026-06-30', actual: 0.91, estimate: 0.88, beat: true, surprise: 3.4 },
  { period: '2026-03-31', actual: 0.80, estimate: 0.82, beat: false, surprise: -2.4 },
  { period: '2025-12-31', actual: 0.75, estimate: 0.70, beat: true, surprise: 7.1 },
  { period: '2025-09-30', actual: 0.66, estimate: 0.66, beat: true, surprise: 0 },
]
const histStats = { avg_abs_move: 6.4, up_count: 2, total: 4, last_n: [8.2, -4.1, 5.5, -1.0] }
const row = { sym: 'NVDA', eps_estimate: 0.94, reported_eps: null,
              beat_history: beatHistory, hist_stats: histStats }

const renderSection = (props = {}) => render(
  <EarningsHistorySection sym="NVDA" row={row} reportDate="2026-08-06" timing="amc"
                          lifecycle="PRE" stepping={false}
                          expectedMove={{ live: { pct: 6.8 }, history: [], history_since: null, grade: null }}
                          {...props} />,
)

describe('EarningsHistorySection', () => {
  it('renders the EPS story and the price story on the same quarter axis', () => {
    renderSection()
    expect(screen.getByTestId('echart')).toBeTruthy()          // LollipopChart
    expect(screen.getByTestId('rk-reaction-bars')).toBeTruthy() // ReactionBars (SVG)
    const axis = capturedOption.xAxis?.data ?? capturedOption.xAxis?.[0]?.data
    expect(axis).toEqual(['Q3 25', 'Q4 25', 'Q1 26', 'Q2 26', 'Q3 26'])
  })

  it('hands tonight’s implied to the reaction bars as the gold bracket', () => {
    const { container } = renderSection()
    expect(container.querySelector('[data-rk-gold]')).toBeTruthy()
    expect(countGoldHighlights(container)).toBe(1)   // exactly one, per canvas budget
  })

  it('omits the bracket when there is no live implied', () => {
    const { container } = renderSection({ expectedMove: { live: null, history: [] } })
    expect(countGoldHighlights(container)).toBe(0)
    expect(screen.getByTestId('rk-reaction-bars')).toBeTruthy()
  })

  it('captions the reaction stats with their denominator', () => {
    renderSection()
    const caps = screen.getByTestId('history-stats')
    expect(caps.textContent).toMatch(/AVG MOVE/i)
    expect(caps.textContent).toMatch(/6\.4|4\.7/)      // avg |move| over the sample
    expect(caps.textContent).toMatch(/CLOSED UP/i)
    expect(caps.textContent).toMatch(/2\s*\/\s*4/)
    expect(caps.textContent).toMatch(/BEST/i)
    expect(caps.textContent).toMatch(/WORST/i)
  })

  it('renders the compact quarterly table oldest-first with the reaction column', () => {
    renderSection()
    const table = screen.getByTestId('history-table')
    const heads = within(table).getAllByRole('columnheader').map(h => h.textContent.trim())
    expect(heads).toEqual(['QUARTER', 'ACT / EST', 'SURPRISE', 'REV', 'NEXT-DAY'])
    const first = within(table).getAllByRole('row')[1]
    expect(within(first).getAllByRole('cell')[0].textContent).toBe('Q3 25')
  })

  it('renders an em dash rather than a zero for a missing reaction', () => {
    renderSection({ row: { ...row, hist_stats: { last_n: [8.2] } } })
    const table = screen.getByTestId('history-table')
    const cells = within(table).getAllByRole('row').slice(1)
      .map(r => within(r).getAllByRole('cell')[4].textContent.trim())
    expect(cells[0]).toBe('—')
    expect(cells.some(c => c === '0.0%')).toBe(false)
  })

  it('states the basis of this composition', () => {
    renderSection()
    expect(screen.getByTestId('history-basis').textContent)
      .toMatch(/4 reported quarters/)
  })

  it('shows an EmptyState — never a blank canvas — with no history', () => {
    renderSection({ row: { sym: 'NEWCO' }, reportDate: null })
    expect(screen.getByText(/no reported quarters/i)).toBeTruthy()
    expect(screen.queryByTestId('history-table')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run src/components/research/sections/EarningsHistorySection.test.jsx`
> Before implementing, **read `ReactionBars.jsx` for its actual root `data-testid` and its gold-bracket attribute** and use those exact strings in both the test and the component. The names asserted above (`rk-reaction-bars`, `data-rk-gold`) are what the kit's restraint helper documents; if the shipped file differs, the SHIPPED name wins and the test is corrected — the kit is frozen.

- [ ] **Step 3: Implement**

```jsx
// app/src/components/research/sections/EarningsHistorySection.jsx
//
// §4.3.2 — EPS story and price story, ONE axis, ONE section. This section
// fetches NOTHING: everything comes from the calendar enrichment already on
// `row` plus the shell's expected-move payload. That is deliberate — it is the
// section stepping lands on most, and a zero-fetch section cannot storm.
//
// GOLD BUDGET: ReactionBars' implied ± bracket is this canvas's single gold
// highlight (§3.1). Nothing else here may be gold.
import { useMemo } from 'react'

import {
  EmptyState, EyebrowLabel, LollipopChart, ReactionBars, StatTile, reactionStats,
} from '../../research-kit'
import { IMPLIED_MOVE_INFO } from '../../../constants/disclaimer'
import { buildQuarters, historyBasis } from '../earningsHistoryModel'
import styles from './EarningsHistorySection.module.css'

const num = (v) => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const pct = (v) => (num(v) == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`)
const eps = (v) => (num(v) == null ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`)
const rev = (v) => {
  const n = num(v)
  if (n == null) return '—'
  return n >= 1000 ? `$${(n / 1000).toFixed(2)}B` : `$${Math.round(n)}M`
}

export default function EarningsHistorySection({ row, reportDate, expectedMove }) {
  const quarters = useMemo(() => buildQuarters({
    beatHistory: row?.beat_history, histStats: row?.hist_stats, reportDate, row,
  }), [row, reportDate])

  const reported = quarters.filter((q) => q.reported)
  if (!reported.length) {
    return (
      <EmptyState
        icon="clock"
        title="No reported quarters yet"
        hint="Estimate-versus-reported history appears once this company has reported at least one quarter on our feeds."
      />
    )
  }

  const impliedPct = num(expectedMove?.live?.pct)
  const stats = reactionStats(quarters)
  const upCount = num(row?.hist_stats?.up_count)
  const total = num(row?.hist_stats?.total) ?? reported.length

  return (
    <div className={styles.wrap}>
      <LollipopChart quarters={quarters} valueFormatter={eps} />

      {/* Same quarter axis, directly beneath — that adjacency IS the section. */}
      <ReactionBars
        quarters={quarters}
        impliedPct={impliedPct}
        impliedLabel={impliedPct != null ? `Implied ±${Math.abs(impliedPct).toFixed(1)}%` : undefined}
        info={IMPLIED_MOVE_INFO}
      />

      <div className={styles.stats} data-testid="history-stats">
        <StatTile label="Avg move" value={<span className="t-num">{stats?.avgAbs != null ? `±${stats.avgAbs.toFixed(1)}%` : '—'}</span>} />
        <StatTile label="Closed up" value={<span className="t-num">{upCount != null ? `${upCount} / ${total}` : '—'}</span>} />
        <StatTile label="Best" value={<span className="t-num">{stats?.best != null ? pct(stats.best) : '—'}</span>} tone={stats?.best > 0 ? 'strong' : undefined} />
        <StatTile label="Worst" value={<span className="t-num">{stats?.worst != null ? pct(stats.worst) : '—'}</span>} tone={stats?.worst < 0 ? 'weak' : undefined} />
      </div>

      <EyebrowLabel>By quarter</EyebrowLabel>
      <div className={styles.tableWrap}>
        <table className={styles.table} data-testid="history-table">
          <thead>
            <tr>
              <th scope="col">QUARTER</th>
              <th scope="col">ACT / EST</th>
              <th scope="col">SURPRISE</th>
              <th scope="col">REV</th>
              <th scope="col">NEXT-DAY</th>
            </tr>
          </thead>
          <tbody>
            {quarters.map((q) => (
              <tr key={q.quarter || q.report_date}>
                <td>{q.quarter}</td>
                <td className="t-num">{eps(q.eps_actual)} / {eps(q.eps_estimate)}</td>
                <td className={`t-num ${num(q.surprise_pct) > 0 ? styles.pos : num(q.surprise_pct) < 0 ? styles.neg : ''}`}>
                  {num(q.surprise_pct) == null ? '—' : pct(q.surprise_pct)}
                </td>
                <td className="t-num">{rev(q.revenue_actual)}</td>
                <td className={`t-num ${num(q.reaction_pct) > 0 ? styles.pos : num(q.reaction_pct) < 0 ? styles.neg : ''}`}>
                  {num(q.reaction_pct) == null ? '—' : pct(q.reaction_pct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.basis} data-testid="history-basis">{historyBasis(quarters)}</div>
    </div>
  )
}
```

> **Implementer note:** `reactionStats` is a named kit export — **read its actual return shape** (`app/src/components/research-kit/charts/ReactionBars.jsx`) before writing the stat row and use its real keys. If it does not expose `avgAbs`/`best`/`worst`, compute them locally from `quarters` rather than editing the kit (only three kit edits are sanctioned in P2, and this is not one of them).

`EarningsHistorySection.module.css`:

```css
.wrap { display: flex; flex-direction: column; gap: var(--space-lg); }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-sm); }
.tableWrap { overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.table th { text-align: left; font-size: var(--text-xs); letter-spacing: var(--ls-label); color: var(--text-muted); font-weight: 600; padding: var(--space-xs) var(--space-sm); border-bottom: 1px solid var(--glass-border-neutral); white-space: nowrap; }
.table td { padding: var(--space-xs) var(--space-sm); color: var(--text); border-bottom: 1px solid var(--glass-border-neutral); white-space: nowrap; }
.pos { color: var(--gain); }
.neg { color: var(--loss); }
.basis { font-size: var(--text-xs); color: var(--text-muted); }
@media (max-width: 640px) { .stats { grid-template-columns: repeat(2, 1fr); } }
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd app && npx vitest run src/components/research/sections/EarningsHistorySection.test.jsx`

**Mutation control:** replace the `num(q.reaction_pct) == null ? '—' : …` guard with `pct(q.reaction_pct ?? 0)` → `renders an em dash rather than a zero for a missing reaction` must FAIL. Restore in place.

- [ ] **Step 5: Verify + commit**

`git add app/src/components/research/sections/EarningsHistorySection.jsx app/src/components/research/sections/EarningsHistorySection.module.css app/src/components/research/sections/EarningsHistorySection.test.jsx`
Commit: `feat(research): Earnings History section — lollipop + reactions on one axis + table (P2 T9)`

---

### Task 10: Brief + Call sections (GATE e, plus the call-recap shape fix)

**Files:**
- Create: `app/src/components/research/sections/BriefSection.jsx`, `.module.css`, `.test.jsx`
- Create: `app/src/components/research/sections/CallSection.jsx`, `.module.css`, `.test.jsx`
- Create: `app/src/components/research/callRecap.js`, `.test.js`
- Create: `app/src/hooks/useEarningsBrief.js`
- Modify (GATE e): `app/src/components/calendar/SentimentGauge.module.css`, `app/src/components/calendar/SentimentGauge.jsx` (testids + kit tokens; **props unchanged**)

**Interfaces:**
- `useEarningsBrief(sym, { cachedOnly })` → SWR over `/api/earnings-analysis/{sym}` with `?cached_only=1` appended when `cachedOnly`. Returns `{ data, isLoading, generate() }`, where `generate()` flips this hook instance out of cached-only and revalidates.
- `normalizeCallRecap(payload) -> object | null` — the flat shape `CallRecapSection` actually reads.

**GATE e — `SentimentGauge` kit restyle.** §3.4: "`SentimentGauge` gets a kit restyle rather than a fork." Restyle its CSS module onto glass/score tokens and add `data-testid="sentiment-gauge"` + `data-sentiment` to the root. **Do not change its props, its exports, or its file path** — `CallsTab.jsx`, `myStocksHub.test.jsx` and `CallsTab.test.jsx` reference it by module path.

**The call-recap shape fix (disclosed in Global Constraints).** `/api/earnings/call-recap/{t}` returns `{ticker, recap, webcast_url, rating_changes}`; `CallRecapSection` reads `headline/sentiment/bullets/quotes/guidance/qa_highlights` from the object it is given **and** `webcast_url`/`rating_changes` from that same object. So the correct argument is a **flat merge**, which no current call site passes. `normalizeCallRecap` is that merge. Scope: the NEW modal only — `MyStocksHub` and `CallsTab` are P3's, and both are recorded in the Task 12 punch list.

- [ ] **Step 1: Write the failing tests**

```js
// app/src/components/research/callRecap.test.js
import { describe, it, expect } from 'vitest'
import { normalizeCallRecap } from './callRecap'

const payload = {
  ticker: 'NVDA',
  recap: { headline: 'Data-centre revenue beat again', sentiment: 'bullish',
           bullets: ['a', 'b'], quotes: [{ speaker: 'CEO', text: 'x' }],
           guidance: 'raised', qa_highlights: ['q1'] },
  webcast_url: 'https://ir.example/live',
  rating_changes: [{ period: '2026-08', net_delta: 2 }],
}

describe('normalizeCallRecap', () => {
  it('flattens the wrapper into the shape CallRecapSection actually reads', () => {
    const out = normalizeCallRecap(payload)
    // inner fields
    expect(out.headline).toBe('Data-centre revenue beat again')
    expect(out.bullets).toEqual(['a', 'b'])
    expect(out.guidance).toBe('raised')
    // outer fields — these live on the WRAPPER and are lost by `recapData?.recap`
    expect(out.webcast_url).toBe('https://ir.example/live')
    expect(out.rating_changes).toHaveLength(1)
  })

  it('returns null when there is no recap body, even if the wrapper exists', () => {
    expect(normalizeCallRecap({ ticker: 'NVDA', recap: null, webcast_url: null })).toBeNull()
    expect(normalizeCallRecap(null)).toBeNull()
  })

  it('tolerates an already-flat recap (defensive against a future payload change)', () => {
    const flat = { headline: 'h', bullets: [], webcast_url: 'u' }
    expect(normalizeCallRecap(flat).headline).toBe('h')
    expect(normalizeCallRecap(flat).webcast_url).toBe('u')
  })

  it('never lets an outer null clobber an inner value', () => {
    const out = normalizeCallRecap({ recap: { headline: 'h', webcast_url: 'inner' },
                                     webcast_url: null })
    expect(out.webcast_url).toBe('inner')
  })
})
```

```jsx
// app/src/components/research/sections/BriefSection.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import BriefSection from './BriefSection'

const row = { sym: 'NVDA', verdict: 'pending' }
const calls = []

beforeEach(() => {
  calls.length = 0
  global.fetch = vi.fn((url) => {
    calls.push(url)
    const cached = url.includes('cached_only=1')
    return Promise.resolve({
      ok: true,
      json: async () => (cached
        ? { sym: 'NVDA', cached: false, preview_text: '', preview_bullets: [], news: [] }
        : { sym: 'NVDA', cached: true, preview_text: 'Guidance is the whole story.',
            preview_bullets: ['Watch data-centre mix'], news: [] }),
    })
  })
})

const renderBrief = (props = {}) => render(
  <BriefSection sym="NVDA" row={row} reportDate="2026-08-06" lifecycle="PRE"
                stepping={false} expectedMove={null} {...props} />,
)

describe('BriefSection', () => {
  it('on a click-open it requests the full brief', async () => {
    renderBrief()
    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0]).not.toContain('cached_only')
    expect(await screen.findByText(/Guidance is the whole story/)).toBeTruthy()
  })

  it('GATE: on a STEPPED-to symbol it requests cached-only and never auto-fires the LLM', async () => {
    renderBrief({ stepping: true })
    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0]).toContain('cached_only=1')
    expect(await screen.findByRole('button', { name: /generate brief/i })).toBeTruthy()
    expect(calls.filter(u => !u.includes('cached_only')).length).toBe(0)
  })

  it('the Generate brief button is what escalates to the LLM path', async () => {
    renderBrief({ stepping: true })
    const btn = await screen.findByRole('button', { name: /generate brief/i })
    fireEvent.click(btn)
    await waitFor(() =>
      expect(calls.some(u => !u.includes('cached_only'))).toBe(true))
  })

  it('a cached hit on a stepped-to symbol renders WITHOUT the button', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({ sym: 'NVDA', cached: true, preview_text: 'Cached copy.',
                           preview_bullets: [], news: [] }),
    }))
    renderBrief({ stepping: true })
    expect(await screen.findByText('Cached copy.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /generate brief/i })).toBeNull()
  })

  it('shows the AI provenance line', async () => {
    renderBrief()
    expect((await screen.findByTestId('brief-provenance')).textContent).toMatch(/^AI ·/)
  })

  it('never says "verdict"', async () => {
    const { container } = renderBrief()
    await screen.findByText(/Guidance is the whole story/)
    expect(container.textContent.toLowerCase()).not.toContain('verdict')
  })
})
```

```jsx
// app/src/components/research/sections/CallSection.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import CallSection from './CallSection'

const wrapper = {
  ticker: 'NVDA',
  recap: { headline: 'Data-centre beat', sentiment: 'bullish', bullets: ['a'],
           quotes: [], guidance: 'raised', qa_highlights: [] },
  webcast_url: 'https://ir.example/live',
  rating_changes: [],
}

let recapData = wrapper
vi.mock('../../../hooks/useCallRecap', () => ({ default: () => ({ data: recapData }) }))
vi.mock('../../../hooks/useEarningsAudio', () => ({ default: () => ({ data: null }) }))
// CallRecapSection is a big existing component; assert what we HAND it.
let handed = null
vi.mock('../../calendar/CallRecapSection', () => ({
  default: (props) => { handed = props; return <div data-testid="call-recap" /> },
}))

const renderCall = (props = {}) => render(
  <CallSection sym="NVDA" row={{ sym: 'NVDA' }} lifecycle="POST" {...props} />,
)

describe('CallSection', () => {
  it('hands CallRecapSection the FLAT shape it actually reads', () => {
    recapData = wrapper
    renderCall()
    expect(handed.recap.headline).toBe('Data-centre beat')     // inner
    expect(handed.recap.webcast_url).toBe('https://ir.example/live')  // outer
    expect(handed.ticker).toBe('NVDA')
  })

  it('renders the restyled sentiment gauge above the recap', () => {
    recapData = wrapper
    renderCall()
    expect(screen.getByTestId('sentiment-gauge')).toBeTruthy()
  })

  it('EmptyState with useful copy when no recap has posted yet', () => {
    recapData = { ticker: 'NVDA', recap: null, webcast_url: null, rating_changes: [] }
    renderCall({ lifecycle: 'PRINTED' })
    expect(screen.getByText(/typically posts within 2h of the call/i)).toBeTruthy()
    expect(screen.queryByTestId('call-recap')).toBeNull()
  })

  it('CALL_LIVE surfaces a Listen live affordance when a webcast URL exists', () => {
    recapData = { ticker: 'NVDA', recap: null, webcast_url: 'https://ir.example/live',
                  rating_changes: [] }
    renderCall({ lifecycle: 'CALL_LIVE' })
    const link = screen.getByRole('link', { name: /listen live/i })
    expect(link.getAttribute('href')).toBe('https://ir.example/live')
    expect(link.getAttribute('rel')).toMatch(/noopener/)
  })
})
```

Plus one assertion appended to the existing `SentimentGauge` coverage (write it in `CallSection.test.jsx` to avoid touching a suite that mocks by path):

```jsx
it('GATE e: the restyled gauge reports its tone as data, not as a class name', async () => {
  vi.doUnmock('../../calendar/SentimentGauge')
  const { SentimentGaugeDisplay } = await import('../../calendar/SentimentGauge')
  render(<SentimentGaugeDisplay data={{ score: 0.7, label: 'bullish', drivers: [] }} />)
  const el = screen.getByTestId('sentiment-gauge')
  expect(el.getAttribute('data-sentiment')).toBe('bullish')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run src/components/research/callRecap.test.js src/components/research/sections/BriefSection.test.jsx src/components/research/sections/CallSection.test.jsx`

- [ ] **Step 3: Implement**

```js
// app/src/components/research/callRecap.js
//
// SHAPE FIX (spec §5.3: "the recapData vs recapData?.recap unwrap divergence is
// fixed at the hook level so both surfaces receive identical shape").
//
// GET /api/earnings/call-recap/{t} returns:
//     { ticker, recap: {headline, sentiment, bullets, quotes, guidance,
//                       qa_highlights}, webcast_url, rating_changes }
// CallRecapSection reads headline/sentiment/bullets/quotes/guidance/
// qa_highlights AND webcast_url AND rating_changes off the SAME object, so the
// correct argument is a FLAT MERGE. Neither shipped call site passes one:
//   components/tiles/EarningsModal.jsx:454 and pages/calendar/MyStocksHub.jsx:244
//     pass the wrapper -> the whole recap BODY renders blank
//   pages/research/tabs/CallsTab.jsx:10 passes `recapData?.recap`
//     -> webcast_url and rating_changes are lost
// P2 fixes the NEW modal; the other two are P3/punch-list, deliberately.

const OUTER = ['webcast_url', 'rating_changes', 'ticker']

export function normalizeCallRecap(payload) {
  if (!payload || typeof payload !== 'object') return null
  const inner = payload.recap && typeof payload.recap === 'object' ? payload.recap : null
  // A wrapper with no body is "no recap yet", not an empty recap.
  if (!inner && !payload.headline && !payload.bullets) return null
  const base = inner || payload
  const out = { ...base }
  for (const k of OUTER) {
    // Never let an outer null clobber an inner value.
    if (out[k] == null && payload[k] != null) out[k] = payload[k]
  }
  return out
}

export default normalizeCallRecap
```

```js
// app/src/hooks/useEarningsBrief.js
//
// §4.3.3 / §7: stepping never auto-fires the LLM path. A symbol reached by
// arrow/chevron requests `?cached_only=1` — a probe that does no provider work
// at all — and the section offers "Generate brief" if nothing is cached. A
// symbol opened by CLICK requests the normal endpoint, which is the existing
// (cost-guarded, cached) behaviour.
import { useCallback, useState } from 'react'
import useSWR from 'swr'

const fetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)

export default function useEarningsBrief(sym, { cachedOnly = false } = {}) {
  const [escalated, setEscalated] = useState(false)
  const s = (sym || '').toUpperCase().trim()
  const wantCached = cachedOnly && !escalated
  const key = s
    ? `/api/earnings-analysis/${encodeURIComponent(s)}${wantCached ? '?cached_only=1' : ''}`
    : null

  const { data, isLoading, mutate } = useSWR(key, fetcher, {
    refreshInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false,
    // The LLM path can take 12-18s cold; do not let SWR fire a second one.
    dedupingInterval: 5 * 60 * 1000,
  })

  const generate = useCallback(() => { setEscalated(true); mutate() }, [mutate])

  return { data: data || null, isLoading: isLoading && !data, generate, escalated }
}
```

```jsx
// app/src/components/research/sections/BriefSection.jsx
//
// §4.3.3 — ALL prose lives here: the AI preview (pre) or analysis (post), key
// quotes, and the news list. No new LLM surface; this reuses the existing
// cost-guarded endpoint.
import { EmptyState, EyebrowLabel } from '../../research-kit'
import { SkeletonBlock } from '../../Skeleton'
import useEarningsBrief from '../../../hooks/useEarningsBrief'
import styles from './BriefSection.module.css'

function provenance(data) {
  const when = new Date()
  const t = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `AI · updated ${t}${data?.cached === false ? '' : ''}`
}

export default function BriefSection({ sym, row, stepping }) {
  // `stepping` is true while the settle debounce is pending on THIS symbol —
  // i.e. it was reached by arrow/chevron, not by a click.
  const { data, isLoading, generate } = useEarningsBrief(sym, { cachedOnly: !!stepping })

  if (isLoading) return <SkeletonBlock height={200} />

  const isPending = (row?.verdict || '').toLowerCase() === 'pending'
  const headline = data?.analysis_headline
  const bodyText = isPending ? data?.preview_text : (data?.analysis_summary || data?.analysis)
  const bullets = (isPending ? data?.preview_bullets : data?.analysis_bullets) || []
  const quotes = data?.key_quotes || []
  const news = data?.news || []
  const hasContent = !!(headline || bodyText || bullets.length || quotes.length || news.length)

  if (!hasContent) {
    return (
      <EmptyState
        icon="document"
        title={data?.cached === false ? 'No brief generated yet' : 'No brief available yet'}
        hint={data?.cached === false
          ? 'Stepping through reporters never generates one automatically — generate it when you want it.'
          : 'A brief is written once there is enough source material on this name.'}
        action={data?.cached === false
          ? <button type="button" className={styles.generate} onClick={generate}>Generate brief</button>
          : undefined}
      />
    )
  }

  return (
    <div className={styles.wrap}>
      {headline && <p className={styles.headline}>{headline}</p>}
      {bodyText && <p className={styles.body}>{bodyText}</p>}

      {bullets.length > 0 && (
        <>
          <EyebrowLabel>{isPending ? 'Things to watch' : 'Key takeaways'}</EyebrowLabel>
          <ul className={styles.list}>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </>
      )}

      {quotes.length > 0 && (
        <>
          <EyebrowLabel>Last call — key quotes</EyebrowLabel>
          <ul className={styles.quotes}>
            {quotes.map((q, i) => (
              <li key={i}>
                {q.topic && <span className={styles.quoteTopic}>{q.topic}: </span>}
                <span className={styles.quoteText}>“{q.quote}”</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {news.length > 0 && (
        <>
          <EyebrowLabel>Related news</EyebrowLabel>
          <div className={styles.news}>
            {news.map((n, i) => (
              <a key={i} className={styles.newsItem} href={n.url}
                 target="_blank" rel="noopener noreferrer">
                <span className={styles.newsSource}>{n.source}{n.time ? ` · ${n.time}` : ''}</span>
                <span className={styles.newsHeadline}>{n.headline}</span>
              </a>
            ))}
          </div>
        </>
      )}

      <div className={styles.provenance} data-testid="brief-provenance">{provenance(data)}</div>
    </div>
  )
}
```

```jsx
// app/src/components/research/sections/CallSection.jsx
//
// §4.3.4 — ONE merged call system. This replaces the old modal's TWO
// independent transcript UIs: CallRecapSection already owns the lazy verbatim
// transcript (useTranscript, quota-gated by `enabled`), so there is no second
// transcript block here.
import CallRecapSection from '../../calendar/CallRecapSection'
import SentimentGauge from '../../calendar/SentimentGauge'
import { EmptyState } from '../../research-kit'
import useCallRecap from '../../../hooks/useCallRecap'
import useEarningsAudio from '../../../hooks/useEarningsAudio'
import { normalizeCallRecap } from '../callRecap'
import styles from './CallSection.module.css'

export default function CallSection({ sym, lifecycle }) {
  const { data: payload } = useCallRecap(sym)
  const { data: audio } = useEarningsAudio(sym)
  const recap = normalizeCallRecap(payload)

  if (!recap) {
    const webcast = payload?.webcast_url
    return (
      <div className={styles.wrap}>
        <SentimentGauge ticker={sym} />
        {lifecycle === 'CALL_LIVE' && webcast && (
          <a className={styles.listen} href={webcast} target="_blank" rel="noopener noreferrer">
            Listen live →
          </a>
        )}
        <EmptyState
          icon="chat"
          title="No call recap yet"
          hint="No transcript yet — typically posts within 2h of the call."
        />
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <SentimentGauge ticker={sym} />
      <CallRecapSection recap={recap} audio={audio ?? null} ticker={sym} />
    </div>
  )
}
```

`BriefSection.module.css` / `CallSection.module.css` — tokens only:

```css
/* BriefSection.module.css */
.wrap { display: flex; flex-direction: column; gap: var(--space-md); }
.headline { margin: 0; font-size: var(--text-lg); color: var(--text-heading); line-height: var(--lh-snug); }
.body { margin: 0; font-size: var(--text-sm); color: var(--text); line-height: var(--lh-snug); }
.list, .quotes { margin: 0; padding-left: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-xs); font-size: var(--text-sm); color: var(--text); }
.quoteTopic { color: var(--text-muted); }
.quoteText { color: var(--text-bright); }
.news { display: flex; flex-direction: column; gap: var(--space-xs); }
.newsItem { display: flex; flex-direction: column; gap: 2px; padding: var(--space-xs) var(--space-sm); border: 1px solid var(--glass-border-neutral); border-radius: var(--radius-sm); background: var(--glass-surface); text-decoration: none; }
.newsItem:focus-visible { outline: var(--focus-ring); }
.newsSource { font-size: var(--text-xs); color: var(--text-muted); }
.newsHeadline { font-size: var(--text-sm); color: var(--text-bright); }
.provenance { font-size: var(--text-xs); color: var(--text-muted); }
.generate { min-height: var(--tap-min); padding: 0 var(--space-md); border-radius: var(--radius-md); border: 1px solid var(--glass-border-neutral); background: var(--glass-surface); color: var(--text-bright); font-size: var(--text-sm); cursor: pointer; }
.generate:focus-visible { outline: var(--focus-ring); }

/* CallSection.module.css */
.wrap { display: flex; flex-direction: column; gap: var(--space-md); }
.listen { align-self: flex-start; min-height: var(--tap-min); display: inline-flex; align-items: center; padding: 0 var(--space-md); border-radius: var(--radius-md); border: 1px solid var(--glass-border-neutral); background: var(--glass-surface); color: var(--text-bright); font-size: var(--text-sm); text-decoration: none; }
.listen:focus-visible { outline: var(--focus-ring); }
```

**GATE e — SentimentGauge restyle.** In `SentimentGauge.jsx`, the ONLY JSX change is the root element of `SentimentGaugeDisplay`:

```jsx
    <div className={styles.wrap} data-testid="sentiment-gauge"
         data-sentiment={label ? String(label).toLowerCase() : 'unknown'}>
```
Then rewrite `SentimentGauge.module.css` onto kit tokens: `--glass-surface` background, `--glass-border-neutral` border, `--radius-md`, `--space-*` spacing, `--text-xs/--text-sm` sizes, `--ls-label` on the title, and the three tone classes onto `--score-strong` / `--score-poor` / `--text-muted` (bull/bear/neutral) — no hardcoded hexes, no `backdrop-filter`. **Do not touch the exported names, the props, or the score→class functions.**

- [ ] **Step 4: Run to verify they pass**

Run:
```
cd app && npx vitest run src/components/research/callRecap.test.js src/components/research/sections/BriefSection.test.jsx src/components/research/sections/CallSection.test.jsx
cd app && npx vitest run src/pages/research/tabs/CallsTab.test.jsx src/pages/calendar/myStocksHub.test.jsx src/pages/calendar/callRecap.test.jsx
```
The second command is the blast-radius check for the SentimentGauge edit — all three must stay green.

**Mutation control:**
1. In `CallSection`, pass `payload` instead of `recap` → `hands CallRecapSection the FLAT shape it actually reads` must FAIL. Restore in place.
2. In `useEarningsBrief`, drop the `cachedOnly` branch (always full URL) → `on a STEPPED-to symbol it requests cached-only` must FAIL. Restore.

- [ ] **Step 5: Verify + commit**

`git add app/src/components/research/sections/BriefSection.jsx app/src/components/research/sections/BriefSection.module.css app/src/components/research/sections/BriefSection.test.jsx app/src/components/research/sections/CallSection.jsx app/src/components/research/sections/CallSection.module.css app/src/components/research/sections/CallSection.test.jsx app/src/components/research/callRecap.js app/src/components/research/callRecap.test.js app/src/hooks/useEarningsBrief.js app/src/components/calendar/SentimentGauge.jsx app/src/components/calendar/SentimentGauge.module.css`
Commit: `feat(research): Brief + Call sections, call-recap shape fix, SentimentGauge kit restyle (P2 T10)`

---

### Task 11: Mount integration at all three sites + the modal route suite

**Files:**
- Modify: `app/src/pages/Calendar.jsx`, `app/src/pages/calendar/MyStocksHub.jsx`, `app/src/components/tiles/CatalystFlow.jsx`
- Create: `app/src/pages/calendar/Calendar.earningsRoute.test.jsx`
- Modify: `app/src/pages/calendar/myStocksHub.test.jsx` (its `vi.mock` path moves to the new component)

**This is the ONLY task that touches the three mount files, and it touches nothing else.** That is the rollback contract: `git revert` of this one commit restores the old `EarningsModal` at all three sites with zero other churn. `components/tiles/EarningsModal.jsx` and `EarningsModal.module.css` are **not deleted** — P5 owns that.

**Per-mount contract:**

| Mount | URL state | Stepping | Poll |
|---|---|---|---|
| `Calendar.jsx` | `useEarningsModalRoute({ enabled: true, pathname })` — full deep-link resolution incl. jump-to-week | yes, across the open day's reporters | `onPollActuals={mutate}` (the `useCalendar` revalidate — the actuals live in that feed) |
| `calendar/MyStocksHub.jsx` | same hook, resolution against its own list (no week jump — its feed is mySets, not a week) | yes, across its Earnings-tab list | its own refresh |
| `tiles/CatalystFlow.jsx` | **none** — plain local state (§4.4: the Dashboard mounts two live instances) | no | none |

**All three: `key={selected.row.sym}` is REMOVED from the `ErrorBoundary`** (the boundary itself stays). The key forced a full remount on every symbol change, which destroys the shell the arrow-stepping reuse depends on.

**Deep-link resolution ladder (Calendar only):**
1. `resolveFeedEntry(sym, days)` against the loaded week → open with `toModalRow(entry)`.
2. Miss → `GET /api/calendar/next-report?sym=` once per symbol. If it answers a `date`, `jumpToWeek(mondayOf(date))` (merge-preserving `?week=` write, replace semantics) and let the feed reload resolve on the next pass.
3. Still unresolvable (unknown name, or the jump landed and the symbol still is not there) → open with the **minimal row** `{ sym }`; the sections render their own `EmptyState`s. Never a blank modal, never a silent no-op.

Guard the fetch with a ref keyed on the symbol so a resolution failure cannot loop.

- [ ] **Step 1: Write the failing tests**

```jsx
// app/src/pages/calendar/Calendar.earningsRoute.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// The modal itself is covered by its own suite; here we assert the WIRING.
vi.mock('../../components/research/EarningsResearchModal', () => ({
  default: ({ row, section, onClose, onStepNext, onSectionChange }) => (
    <div data-testid="erm" data-sym={row?.sym} data-section={section ?? ''}>
      <button onClick={onClose}>close</button>
      <button onClick={onStepNext} disabled={!onStepNext}>next</button>
      <button onClick={() => onSectionChange('brief')}>to-brief</button>
    </div>
  ),
}))

// One loaded week: Wed 2026-08-05 BMO AAPL, Thu 2026-08-06 AMC NVDA then AMD.
const WEEK = {
  week_start: '2026-08-03', week_end: '2026-08-09',
  days: {
    '2026-08-05': { label: 'Wed Aug 5', bmo: [{ sym: 'AAPL', eps_est: 1.2 }], amc: [], tbd: [] },
    '2026-08-06': { label: 'Thu Aug 6', bmo: [],
                    amc: [{ sym: 'NVDA', eps_est: 0.94 }, { sym: 'AMD', eps_est: 0.71 }],
                    tbd: [] },
  },
}
const mutate = vi.fn()
vi.mock('../../hooks/useCalendar', () => ({ default: () => ({ data: WEEK, error: null, mutate }) }))

// NOTE (implementer): mirror whatever module path Calendar.jsx actually imports
// its week hook from — read the file first and fix this mock accordingly.

import Calendar from '../Calendar'

const renderAt = (url) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes><Route path="/calendar" element={<Calendar />} /></Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  mutate.mockClear()
  global.fetch = vi.fn((url) => Promise.resolve({
    ok: true,
    json: async () => (String(url).includes('next-report')
      ? { sym: 'TSLA', date: '2026-09-10', timing: 'amc', date_est: false }
      : {}),
  }))
})

describe('Calendar × earnings modal route', () => {
  it('does not open a modal without the param', () => {
    renderAt('/calendar?week=2026-08-03')
    expect(screen.queryByTestId('erm')).toBeNull()
  })

  it('a deep link resolved in the loaded feed opens the modal on that symbol', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=NVDA')
    expect((await screen.findByTestId('erm')).getAttribute('data-sym')).toBe('NVDA')
  })

  it('a lowercase deep link is normalised', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=nvda')
    expect((await screen.findByTestId('erm')).getAttribute('data-sym')).toBe('NVDA')
  })

  it('&esection is passed through to the modal', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=NVDA&esection=call')
    expect((await screen.findByTestId('erm')).getAttribute('data-section')).toBe('call')
  })

  it('an unresolvable symbol opens a MINIMAL row rather than nothing', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: async () => ({ sym: 'NOPE', date: null, timing: null }),
    }))
    renderAt('/calendar?week=2026-08-03&earnings=NOPE')
    expect((await screen.findByTestId('erm')).getAttribute('data-sym')).toBe('NOPE')
  })

  it('a symbol outside the loaded week asks the API once and jumps that week', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=TSLA')
    await waitFor(() => expect(
      global.fetch.mock.calls.filter(c => String(c[0]).includes('next-report')).length,
    ).toBe(1))
    // one lookup only — a failed resolution must never loop
    await new Promise(r => setTimeout(r, 30))
    expect(global.fetch.mock.calls.filter(c => String(c[0]).includes('next-report')).length).toBe(1)
  })

  it('closing strips the param and leaves ?week alone', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=NVDA')
    fireEvent.click(await screen.findByText('close'))
    await waitFor(() => expect(screen.queryByTestId('erm')).toBeNull())
    expect(window.location.search).not.toContain('earnings=')
  })

  it('stepping moves to the next reporter in the same day', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=NVDA')
    fireEvent.click(await screen.findByText('next'))
    await waitFor(() =>
      expect(screen.getByTestId('erm').getAttribute('data-sym')).toBe('AMD'))
  })

  it('the last reporter of the day has no next step', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=AMD')
    expect(await screen.findByText('next')).toBeDisabled()
  })

  it('a section change writes &esection', async () => {
    renderAt('/calendar?week=2026-08-03&earnings=NVDA')
    fireEvent.click(await screen.findByText('to-brief'))
    await waitFor(() => expect(window.location.search).toContain('esection=brief'))
  })

  it('GATE: the ErrorBoundary around the modal is NOT keyed by symbol', async () => {
    // Structural oracle: read the source and assert the key is gone. A keyed
    // boundary silently remounts the shell on every step, which is exactly the
    // behaviour the settle debounce and shell reuse exist to prevent, and it is
    // invisible to a render assertion.
    const fs = await import('node:fs/promises')
    const src = await fs.readFile(
      new URL('../Calendar.jsx', import.meta.url), 'utf8')
    const boundary = src.slice(src.indexOf('<ErrorBoundary'), src.indexOf('</ErrorBoundary>'))
    expect(boundary).toContain('EarningsResearchModal')
    expect(boundary).not.toMatch(/key=\{selected/)
  })
})
```

Add the same structural key assertion for the other two mounts (a small shared `describe` block is fine) reading `pages/calendar/MyStocksHub.jsx` and `components/tiles/CatalystFlow.jsx`.

Update `pages/calendar/myStocksHub.test.jsx`: change the `vi.mock('../../components/tiles/EarningsModal', …)` path to `'../../components/research/EarningsResearchModal'` and keep the rest of that suite unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run src/pages/calendar/Calendar.earningsRoute.test.jsx src/pages/calendar/myStocksHub.test.jsx`

- [ ] **Step 3: Implement**

**`app/src/pages/Calendar.jsx`** — replace the import, add the hook + resolution, rewrite the render block. Everything else in the file is untouched.

```jsx
import { useLocation } from 'react-router-dom'
import EarningsResearchModal from '../components/research/EarningsResearchModal'
import useEarningsModalRoute, { resolveFeedEntry } from './calendar/useEarningsModalRoute'
import useSettledSym from '../hooks/useSettledSym'
```

Inside the component, after the existing `selected` state:

```jsx
  const { pathname } = useLocation()
  const route = useEarningsModalRoute({ pathname })
  const resolveRef = useRef(null)

  // ── Deep-link resolution ladder (§4.4). Never a blank modal, never a loop. ──
  useEffect(() => {
    const want = route.sym
    if (!want) { setSelected(null); return }
    if (selected?.row?.sym === want) return

    const hit = resolveFeedEntry(want, days)
    if (hit) {
      resolveRef.current = null
      setSelected({ row: toModalRow(hit.entry), label: timingLabel(hit.timing),
                    reportDate: hit.ds, timing: hit.timing, entry: hit.entry })
      return
    }
    // Ask ONCE per symbol; a failed lookup must never re-fire.
    if (resolveRef.current === want) {
      setSelected((prev) => (prev?.row?.sym === want ? prev
        : { row: { sym: want }, label: timingLabel(null), reportDate: null, timing: null }))
      return
    }
    resolveRef.current = want
    fetch(`/api/calendar/next-report?sym=${encodeURIComponent(want)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const monday = d?.date ? mondayOf(d.date) : null
        if (monday) route.jumpToWeek(monday)
        else {
          setSelected({ row: { sym: want }, label: timingLabel(null),
                        reportDate: null, timing: null })
        }
      })
      .catch(() => {
        setSelected({ row: { sym: want }, label: timingLabel(null),
                      reportDate: null, timing: null })
      })
  }, [route.sym, days])       // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stepping across the open day's reporters ──────────────────────────────
  const daySyms = useMemo(() => {
    const ds = selected?.reportDate
    const day = ds ? days?.[ds] : null
    if (!day) return []
    return ['bmo', 'amc', 'tbd'].flatMap((t) => (day[t] || []).map((e) => e.sym))
  }, [days, selected?.reportDate])

  const stepIdx = daySyms.indexOf(selected?.row?.sym)
  const stepTo = useCallback((delta) => {
    const next = daySyms[stepIdx + delta]
    if (next) route.step(next)
  }, [daySyms, stepIdx, route])

  const { stepping } = useSettledSym(selected?.row?.sym ?? null)
  const isTodayReporter = selected?.reportDate === todayIso()
```

`onSelect` gains the URL write (the modal state itself is still set by the effect above, so there is ONE code path that opens it):

```jsx
  const onSelect = (entry, timing) => {
    if (route.routed) { route.open(entry.sym); return }
    setSelected({ row: toModalRow(entry), label: timingLabel(timing),
                  reportDate: entry._ds, timing })
  }
```

and the render block:

```jsx
      {selected && (
        <ErrorBoundary
          fallback={
            <div style={{ color: 'var(--text-muted)', fontSize: '11px', padding: '12px' }}>
              Unable to load — click a ticker to retry.
            </div>
          }
        >
          {/* NO `key` (§4.4): the modal shell is REUSED across arrow-stepping.
              A key here remounts it on every symbol change, which throws away
              the shell, the section scroll map and the settle debounce. The
              modal already resets its own state on a symbol change. */}
          <EarningsResearchModal
            row={selected.row}
            label={selected.label}
            reportDate={selected.reportDate}
            timing={selected.timing}
            section={route.section}
            onSectionChange={route.setSection}
            onClose={() => { if (route.routed) route.close(); else setSelected(null) }}
            onStepPrev={stepIdx > 0 ? () => stepTo(-1) : null}
            onStepNext={stepIdx >= 0 && stepIdx < daySyms.length - 1 ? () => stepTo(1) : null}
            stepping={stepping}
            onPollActuals={mutate}
            isTodayReporter={isTodayReporter}
          />
        </ErrorBoundary>
      )}
```

> `mutate` is the `useCalendar` revalidate already destructured at `Calendar.jsx:102`. The §4.5 IMMINENT poll reuses it deliberately: the actuals live in that feed, so the poll is one already-cached request rather than a new endpoint.

**`app/src/pages/calendar/MyStocksHub.jsx`** — same import swap, same un-keyed boundary, the same hook with resolution against its own Earnings-tab list (no `jumpToWeek` — its feed is not a week). Pass `onPollActuals` = its own list refresh, `isTodayReporter` computed from the entry's date.

**`app/src/components/tiles/CatalystFlow.jsx`** — component swap + un-key ONLY. It keeps `useState`; do **not** import `useEarningsModalRoute` here:

```jsx
      {selected && (
        <ErrorBoundary fallback={<div style={{ color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'var(--font-mono)', padding: '12px' }}>Unable to load — click a ticker to retry.</div>}>
          {/* Plain local state on purpose (§4.4): the Dashboard mounts TWO live
              CatalystFlow instances (desktop + mobile trees) and its rows come
              from today's wire list, so URL-driven opening here would both
              double-render and be unresolvable. No `key` — see Calendar.jsx. */}
          <EarningsResearchModal
            row={selected.row}
            label={selected.label}
            onClose={() => setSelected(null)}
            section={null}
            onSectionChange={() => {}}
          />
        </ErrorBoundary>
      )}
```
> `EarningsResearchModal` must tolerate an uncontrolled `section` (it already does — `normalizeSection(null)` returns `'setup'`). If CatalystFlow needs local section state, add a plain `useState` in that file; do not reach for the route hook.

- [ ] **Step 4: Run to verify they pass**

```
cd app && npx vitest run src/pages/calendar/Calendar.earningsRoute.test.jsx src/pages/calendar/myStocksHub.test.jsx src/components/research src/pages/calendar
cd app && npx vitest run          # FULL suite — this task changes three widely-mocked files
```
Any suite that breaks because it mocked `components/tiles/EarningsModal` by path is fixed by pointing the mock at the new module — **not** by re-adding the old import.

**Mutation control:** re-add `key={selected.row.sym}` to `Calendar.jsx`'s boundary → `the ErrorBoundary around the modal is NOT keyed by symbol` must FAIL. Restore in place.

- [ ] **Step 5: Verify + commit**

`cd app && npm run build`
`git add app/src/pages/Calendar.jsx app/src/pages/calendar/MyStocksHub.jsx app/src/components/tiles/CatalystFlow.jsx app/src/pages/calendar/Calendar.earningsRoute.test.jsx app/src/pages/calendar/myStocksHub.test.jsx`
Commit: `feat(research): mount the new earnings modal at all three sites, un-keyed boundary (P2 T11)`

Include in the commit body, verbatim:
```
Rollback: revert this commit alone. components/tiles/EarningsModal.jsx is
unmodified and still on disk (deleted in P5), so a revert restores the previous
surface at all three mounts with no other churn.
```

---

### Task 12: CONTROLLER-EXECUTED verification — real browser, mobile audit, bundle, punch list (GATES a, d)

**This task is executed by the controller, not by an implementer subagent.** It needs browser tools and long-running local servers, and its output is a judgement, not a diff. Everything below is a checklist for the controller; nothing here is delegated.

**Files:** none created. Output = the verification record appended to the plan's punch list + any bug tickets it opens.

- [ ] **Step 1: Boot the stack (heavy jobs off, admin account)**

```
$env:ADMIN_EMAILS="mobtest@local.dev"; $env:WORKER_ENABLED="0"; $env:CATALYST_ENGINE_ENABLED="0"; $env:TWITTERAPI_IO_ENABLED="0"; $env:BARS_PREWARM_DISABLED="1"; $env:TICKER_NAMES_PREWARM_DISABLED="1"
python -m uvicorn api.main:app --port 8077
```
One-time, in a second shell:
```
curl -X POST http://localhost:8077/api/auth/signup -H "Content-Type: application/json" -d '{"email":"mobtest@local.dev","password":"LocalTest2026!","display_name":"x"}'
```
Then build the frontend so the backend serves fresh `dist/`: `cd app && npm run build`.
(For iterative UI work `cd app && npm run dev` against the same backend is fine; the mobile audit in Step 3 needs the built `dist/`.)

- [ ] **Step 2: GATE a — real-browser render verification**

Open `http://localhost:8077/calendar` and click into a reporter with history (a mega-cap that has reported ≥4 quarters). **jsdom cannot draw a canvas, so nothing below has been proven by any test so far.** Confirm by eye and by console:

- [ ] **`LollipopChart` actually paints.** Estimate ring hollow, actual dot solid, the not-yet-reported quarter's ring **dashed**, whiskers present, x-axis labels legible at the modal's real width. A blank box here = the ECharts registration or the canvas size is wrong.
- [ ] **`ReactionBars` paints beneath it on the SAME quarter positions** — bars line up under their lollipops (this adjacency is the whole point of §4.3.2). The gold implied bracket is visible and inside the plot, not clipped at the top.
- [ ] **`ImpliedVsRealized` (Setup)** — hollow/solid pairing, down-closes descending BELOW the baseline, the NOW tick on the current quarter, and the caption reading `n/8 recorded` where **n matches the number of rows in `/api/research/expected-move/<SYM>`'s `history` array** (open the Network tab and check — this is the ruling's real proof).
- [ ] **Setup Grade chip** in the banner: letter present, and on a name with no options chain it reads `· 3 of 4 inputs`. Hover the ⓘ: all four inputs with their weights, and a working link to `/methodology`.
- [ ] **Section switching**: click each rail item. Watch the console — **no ECharts "width/height is 0" warnings**, no React key warnings, no unhandled rejections. Switch away and back twice (this is where a zero-width mount would surface).
- [ ] **Arrow stepping** ← → across a day with ≥10 reporters. In the Network tab: the modal must NOT fire a burst of section fetches per keypress — only the live-price poll during the run, then one settled batch. **A visible fetch fan-out here fails the gate.**
- [ ] **Brief on a stepped-to name** requests `cached_only=1` (check the Network tab) and shows "Generate brief" when nothing is cached. Clicking it fires the un-flagged URL exactly once.
- [ ] **Back button closes the modal in ONE press** after opening, stepping 5 names and changing sections twice. Then Back again returns to wherever you came from.
- [ ] **Focus + keyboard**: Tab cycles inside the dialog and never escapes to the page behind; the rail responds to ↑↓/Home/End; `--focus-ring` is visible on every interactive element over glass; Escape closes.
- [ ] **Deep link**: paste `/calendar?earnings=<a symbol NOT in the current week>` into a fresh tab. It should jump to that symbol's week and open, or open a minimal modal with `EmptyState` sections — never a blank panel and never a redirect loop.
- [ ] **Reduced motion**: toggle `prefers-reduced-motion: reduce` in DevTools rendering options; no glow transitions, no shimmer, the countdown swaps as plain text.
- [ ] Capture a screenshot of the composed modal (Setup and Earnings History) for the record.

- [ ] **Step 3: Mobile audit harness — phone + tablet, zero horizontal overflow**

```
$env:MOBILE_AUDIT_EMAIL="mobtest@local.dev"; $env:MOBILE_AUDIT_PASSWORD="LocalTest2026!"
python tools/mobile_audit.py --base http://localhost:8077 --auth --routes /calendar,/calendar/mystocks,/methodology
```
Read `tools/mobile_audit_out/report.md` + screenshots. Required: **zero horizontal overflow** on both viewports, and **no sub-44px tap target** among the modal's own controls (close, rail items, stepper chevrons, footer CTAs). The harness cannot open the modal itself — after the sweep, open the phone viewport in the browser manually and check:
- [ ] the modal renders as a **bottom sheet**, not a centered dialog;
- [ ] the rail is a horizontal chip row with the edge-fade;
- [ ] **dragging on the canvas scrolls the canvas** and does not dismiss the sheet; dragging the grip DOES dismiss it;
- [ ] the banner chevrons step reporters (no keyboard on touch);
- [ ] nothing in the modal scrolls the page body horizontally.

- [ ] **Step 4: GATE d — final bundle re-measure + full suites**

```
cd app && npm run build
python -m pytest tests/ -q
cd app && npx vitest run
```
Record the FINAL `dist/assets/vendor-echarts-*.js` size and every new chunk, against the numbers recorded at Task 6, and against `origin/master`. State the honest total cost of P2 in KB in the verification record. Expected shape of the answer: `vendor-echarts` **unchanged** (the shrink is P5, gated on the 5 surviving full-entry imports) plus a small research-modal chunk. Anything else needs an explanation before this task is closed.

- [ ] **Step 5: Punch list + close-out**

One end-of-run list (never a running commentary). It must carry at least these known-open items:
1. **`MyStocksHub.jsx:244` and `CallsTab.jsx:10` still pass the wrong object to `CallRecapSection`** (Global Constraints "Bugs found" #1). P2 fixed the new modal only. `MyStocksHub` shows a blank recap body; `CallsTab` silently drops `webcast_url` + `rating_changes`. Both should adopt `normalizeCallRecap` — P3.
2. **`buildQuarters` aligns reactions by INDEX** — replaced by `GET /api/research/earnings-history/{sym}` in P4, which also lets the report-date row carry `reported` and `reaction_pct` independently (removing the print-night dashed-dot compromise).
3. **`IMPLIED_ENRICHMENT_CUTOVER` is OFF.** Flipping it is a deliberate owner decision + a deploy-window push; validate on a dense chain (NVDA/TSLA class) first.
4. **`IMPLIED_STORE_ENABLED` gates BOTH the implied capture and the grade snapshot.** Until it is on in Railway, `history` is empty and every modal shows the cold-start caption — which is designed, but it means `n/8` reads `0/8` at launch and the §12 accountability record is not accruing.
5. **Old `EarningsModal.jsx` + `.module.css` remain on disk** — P5 deletion, with the two broken-token references (`--gold`, `--text-dim` at `EarningsModal.module.css:255,271,275`) dying with the file.
6. Anything Steps 2–4 surfaced.

Do **not** push. Public surfaces ship only on explicit owner approval, inside the deploy window, via `git push origin feat/research-calendar-redesign:master`.

---

## Self-review — spec §4 coverage, item by item

| §4 item | Where it lands | Status |
|---|---|---|
| §4.1 two-pane glass modal, `min(960px, 100vw−32px)`, no global scroll column | T6 shell + `.module.css` | ✅ |
| §4.1 one hero per canvas | T8 (ImpliedVsRealized), T9 (lollipop+bars pair) | ✅ |
| §4.2 banner: logo · ticker · company · sector · timing line · live price · grade chip | T6 (incl. the CONTROLLER AMENDMENT wiring the price slot via the shared `useLivePrices` pool) | ✅ — deferral OVERRULED: the pool dedupes browser-wide so this is a one-symbol union add, and the plan's own stepping constraint already assumed the price poll. |
| §4.2 timing line pre-report + countdown | T5 `countdownText` + T6 | ✅ |
| §4.2 post-report flip to the result line | T6 `resultLine()` + `IdentityBanner` `resultText` | ✅ |
| §4.2 guidance chip, source-labeled, POST only, never inferred | `IdentityBanner` already renders `guidance` in POST only; **the modal does not pass it in P2** | ⚠️ **DEFERRED to P3**: the source label must name the recap field it came from, and the recap is fetched by the Call section, not the shell. Wiring it in P2 would mean hoisting `useCallRecap` into the shell — a fetch on every open, for a chip that only exists in POST. |
| §4.2 Setup Grade chip A+…F from the four inputs | T1 (server) + T6 (chip) | ✅ |
| §4.2 tooltip shows all four inputs **with weights** | T6 `gradeChip` `info` + T3 methodology link | ✅ |
| §4.2 missing-input rule "B+ · 3 of 4 inputs" | T1 `compute_grade` + T6 label | ✅ |
| §4.2 scope separation from the UCT Rating (distinct visual identities, each tooltip names the other) | T3 copy (`SETUP_GRADE_INFO` / `UCT_RATING_INFO`) + T6 renders a **chip**; the crown is a page component | ⚠️ **PARTIAL**: the "one FE test asserts the two never render with the same visual identity" is a **P3** test — both instruments only coexist on the research page. The modal-side half (grade is a chip, no crown in the modal) is asserted in T6. |
| §4.3 rail = Setup · History · Brief · Call + 2 link items | T6 `railSections.js` | ✅ |
| §4.3.1a hero, signed pairing, current-quarter highlight, RICH/CHEAP chip, dollar break-even strip | T8 | ✅ |
| §4.3.1a horizon honesty (implied horizon stated; realized same horizon class) | T8 `breakeven` caption + `IMPLIED_MOVE_INFO`; T3 methodology | ✅ |
| §4.3.1a cold-start state + "n/8 recorded" counting stored only | T8 + KIT EDIT #3 | ✅ |
| §4.3.1b key-stats strip + consensus drift | T8 | ✅ |
| §4.3.2 lollipop + compact table + ReactionBars on the same axis + caption StatTiles | T9 | ✅ |
| §4.3.2 "beat-but-sold-off quarters starred" | `ReactionBars` already ships the `diverged` flag; T9 renders the kit component unmodified | ✅ (kit-owned) |
| §4.3.3 Brief = all prose, provenance line, cached-only on stepping | T10 + T2 | ✅ |
| §4.3.4 Call = single merged system, deletes the second transcript UI | T10 (`CallRecapSection` owns the lazy transcript; no second block) | ✅ |
| §4.4 URL state, merge-preserving, push-open/replace-step, `&esection=`, scoped to 2 paths | T4 + T11 | ✅ |
| §4.4 deep-link resolution ladder | T11 | ✅ |
| §4.4 arrow keys, disabled in inputs | T6 | ✅ |
| §4.4 un-keyed ErrorBoundary at all three mounts | T11 (+ structural test) | ✅ |
| §4.4 ~200 ms settle debounce; only the live-price poll during stepping | T5 + T6 + T11 | ✅ (the live-price poll itself is the deferred item above) |
| §4.4 per-section scroll positions retained while open, reset on symbol change | not implemented | ⚠️ **DEFERRED to P5 polish.** Panels UNMOUNT on switch (gate c), so retaining scroll requires a scroll-offset map restored on remount — a real feature, not a line of CSS, and it interacts with the phone sheet's own scroll container. Logged in the punch list. |
| §4.4 focus trap, tablist semantics, roving tabindex, focus ring, reduced motion | T6 (+ `SectionRail` kit) | ✅ |
| §4.4 footer: View Chart · Open full report / lock CTA · flag-to-watchlist | T6 — **flag-to-watchlist NOT included** | ⚠️ **DEFERRED to P5.** The two primary CTAs plus the §12 line already fill the pinned row at 640 px; a third action needs the mobile audit's tap-target verdict first (Task 12 Step 3). |
| §4.4 phone bottom sheet, chip-row rail, drag confined to the handle, chevron stepping | T6 (+ `Sheet` unchanged — its drag is already grip-scoped) | ✅ |
| §4.4 states: SkeletonBlock while loading, EmptyState with useful copy, retry on failure | T8/T9/T10 | ✅ |
| §4.5 five states as pure functions of data timestamps | T5 | ✅ |
| §4.5 IMMINENT actuals poll 30–60 s, modal-open + today-reporter only | T5 `shouldPollActuals` + T6 interval + T11 `onPollActuals={mutate}` | ✅ |
| §4.5 PRINTED annotates the realized print onto the current implied bar | T7 DECISION 2 keeps the bar; the EPS print shows in the banner + table | ⚠️ **PARTIAL** — the bar is not annotated with the realized print until the next session's reaction exists. Documented in T7; P4 closes it. |
| §4.5 CALL_LIVE "Listen live" affordance | T10 `CallSection` | ✅ |
| §12 methodology page, not-advice footer, "verdict" never user-facing | T3 + T6 + assertions in T6/T8/T9/T10 | ✅ |

**Placeholder scan:** every code block above is complete and runnable — no `TODO`, no `...`, no `<fill this in>`. Three blocks are deliberately marked "read the shipped file and use its real names" rather than guessed: `reactionStats`'s return keys (T9), `ReactionBars`' root `data-testid` (T9), and `ResearchPage.test.jsx`'s existing active-tab oracle (T6). Those are instructions to verify against shipped code, not placeholders — guessing them would be exactly the "assert on a proxy" failure this phase keeps hitting.

**Prop/payload-name consistency:** every prop name, endpoint field, cache key, module path, line number and glyph name in this plan was read off the files in this worktree at `12088b51`, not recalled. The three names the plan *introduces* into kit components (`as` on `IdentityBanner`/`PinnedFooter`, `recordedCount` on `ImpliedVsRealized`) are the three sanctioned kit edits, each tied to a named gate.
