# Journal 2.0 A+ — P4: 8→5 Nav Restructure + Today + Runtime Kill-Switch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship "The journal now opens somewhere worth opening" — collapse the 8-tab `?j2tab=` shell into 5 real nested-route surfaces (Today · Trades · Journal · Insights · Compass), add a **Today** landing with three time-of-day states, and gate the whole flip behind a **runtime kill-switch** that restores the old 8-tab shell without a deploy.

**Architecture:** `/journal` is currently a single leaf route hosting an 8-tab `?j2tab=` state machine (`JournalTwoRoot.jsx`). P4 (a) adds a runtime kill-switch (`uct.j2.shell`, mirroring `uct.barsPush.enabled`) that renders the *existing* `JournalTwoRoot` verbatim when set to legacy; (b) builds a new nested-route shell (`JournalLayout` + `<Outlet/>`) with 5 primary surfaces, where Trades/Journal/Insights **group** the existing tab components (deep content-merge is P5 — "nav moves once"); (c) adds a permanent `?j2tab=` → route redirect shim preserving `sc_*`/`ins` querystrings; (d) builds the **Today** surface by assembling existing components keyed on `useMarketOpen`. React Router is 7.13 (nested-capable); `Layout` already renders `<Outlet/>`. Two ship milestones: **A** (reversible nav swap) then **B** (Today + polish + e2e gate).

**Tech Stack:** React + Vite SPA, react-router-dom ^7.13, react-hotkeys-hook, SWR, the browser-wide `priceStreamManager` SSE pool, existing J2 components/hooks, Playwright (`tools/mobile_audit.py` harness + a new redirect-matrix e2e).

## Global Constraints

Every task's requirements implicitly include this section. Copied from the approved spec (`docs/superpowers/specs/2026-07-09-journal-a-plus-design.md` §2/§9) + locked invariants + research findings.

- **RUNTIME KILL-SWITCH IS LOAD-BEARING and ships FIRST (Task A1).** The deploy freeze (9:15am–4:20pm ET options tape) makes same-day deploy-rollback impossible, so the 8→5 flip MUST be reversible at runtime. Mirror `uct.barsPush.enabled` (`StockChart.jsx:256-288`): a `uct.j2.shell` localStorage value (`'v5'` new default | `'v8'` legacy), a `window.__uctJ2Shell(v)` DevTools handle, a same-tab `Event` so it re-reads without reload, and a rollout constant `J2_SHELL_ROLLOUT_PCT`. When resolved to legacy, render the **existing `JournalTwoRoot` unchanged**. Optionally also honor a server flag (like `/api/community/status`) so ops can force-legacy fleet-wide via a Railway env with no frontend deploy — but the localStorage path is the required minimum.
- **Nav moves EXACTLY ONCE.** The 8→5 grouping (incl. Journal grouping) ships in P4. **Do NOT deep-merge surface internals in P4** — Trades groups Open Positions + Trade Journal as segments reusing the existing tab components; the single unified table + server pagination + day-page unification are **P5**. Reuse `OpenPositionsTab`/`TradeJournalTab`/`CalendarTab`/`NotebookTab`/`AnalyticsTab`/`CompassTab` components inside the new routes; don't rewrite them.
- **The `?j2tab=` redirect shim is PERMANENT** and must preserve the FULL querystring (`sc_*` scope params + `ins=` sub-nav), not just map the tab — the 9 consumer sites (esp. `TradeDetailPage`, `PlaybookSection`, `EdgeScoreCard`, `InsightsHub`) carry scope/ins params. Tab→route map: `positions`,`journal`→`/journal/trades`; `calendar`,`notebook`→`/journal/journal`; `analytics`→`/journal/insights` (carry `ins=`); `accounts`→`/journal/accounts`; `compass`→`/journal/compass`; `community`→`/journal/community`.
- **No emoji.** All iconography via `<UIcon name=… />` (the current emoji-ish tab treatment is replaced with gold SVG icons per §2). The 5 primary nav items get gold `UIcon` glyphs.
- **Vite `manualChunks` stays OBJECT form** (`vite.config.js:17-28`) — function form white-screens. Adding lazy routes auto-chunks; do NOT convert to function form.
- **Shared SSE:** the browser-wide `priceStreamManager` pool already exists (union + 400ms debounce, `MAX_SSE_TICKERS=50`). Mounting a provider at the J2 layout changes the subscription *lifecycle* (stable union across intra-journal nav, no per-tab-switch rebuild), not the socket count — keep it feeding the same pool; never bypass `MAX_SSE_TICKERS`.
- **Today ignores the global Scope** — with an active scope, the ScopeBar renders muted, labeled "Not applied here" (§53). Today is NOT a Scope-filtered surface.
- **All-Accounts (`_all_`/null account) is an explicit decision** (research caveat): `BrokerAccountHero`/`GoalProgress`/discipline/nudges no-op on `accountId===null`. Today on All-Accounts uses the coach `overview` (which supports `_all_` scope) for the lead + coach strip, and shows a "pick an account" affordance where a concrete-account module (hero/goals) would go — never a blank.
- **Free tier** sees designed teaser states, never broken/hidden nav (§61). Compass stays `paidOnly` but its nav item shows a teaser, not a missing item.
- **Broker merge invariant:** `grep -c broker_sync api/main.py` ≥ 7 before every push (P4 is frontend-heavy, but confirm). Never edit partner-owned `OptionsFlow.jsx`.
- **Additive / non-destructive:** Journal 1.0 (`app/src/pages/journal/`) untouched. The OLD `JournalTwoRoot` stays in the tree (the kill-switch renders it) — do not delete it in P4.
- **Baseline test state:** ~20 pre-existing backend failures (15 `test_options` + 5 `test_coach_chat_tools`; +3 `test_interventions` flap by wall-clock time). NEVER attribute these to P4. P4 is mostly frontend — the FE `journal-2-0` suite is the primary gate.
- **Mobile "renders designed at 390px" is a P4 acceptance criterion.** Use CSS `@media (max-width:640px)` for layout (the `useIsPhone` first-paint-stale gotcha), `useIsPhone`/`useIsTouch` only for tap-triggered render choices. The mobile toolkit (`Sheet`, phone card mode) is already present.
- **Ship window** normally ≥4:20 PM ET / <9:15 AM ET; owner authorized override for this initiative. The kill-switch is the real safety net regardless.

---

# MILESTONE A — Reversible nav swap (kill-switch + routing + shim + hotkeys + "+ Log Trade")

Ships as one deployable slice. The new shell is DEFAULT but instantly revertible via the kill-switch. Announcement holds until Milestone B (Today) lands, OR ship A dark-ish (kill-switch default legacy) and flip after B — decide at the A gate.

---

### Task A1: Runtime kill-switch + shell selector

**Files:**
- Create: `app/src/pages/journal-2-0/shellFlag.js` (the flag module) + `shellFlag.test.js`
- Modify: `app/src/App.jsx` (route `/journal` → a selector that picks new vs legacy shell)

**Interfaces:**
- Produces: `J2_SHELL_ROLLOUT_PCT` (const, default `100`), `resolveJ2Shell() -> 'v5' | 'v8'` (reads `localStorage['uct.j2.shell']`: `'v8'`→legacy, `'v5'`→new, else rollout bucket like `_barsPushEnabled`), `setJ2Shell(v)` (writes localStorage + dispatches `Event('uct-j2shell-change')`), `useJ2Shell()` (a hook subscribing to the event + storage, returns the current shell). `window.__uctJ2Shell = setJ2Shell` DevTools handle.
- The `/journal` route element becomes a small selector component: `useJ2Shell()==='v8' ? <JournalTwoRoot/> (legacy) : <JournalLayout/> (new, A2)`.

**Context:** This is the reversibility guarantee and must land before the new shell is wired. Mirror `StockChart.jsx:256-288` exactly (per-browser bucket in `uct.j2.shell.bucket`, explicit `'v8'`/`'v5'` overrides, rollout %). Until A2 exists, the selector can render `<JournalTwoRoot/>` for both branches (new shell added in A2). Optionally read a server flag later; localStorage is the required minimum.

- [ ] **Step 1: Write `shellFlag.test.js`** — `'v8'`→'v8'; `'v5'`→'v5'; unset→rollout bucket (with `J2_SHELL_ROLLOUT_PCT=100`→'v5'); `setJ2Shell('v8')` writes localStorage + fires the event; `resolveJ2Shell` re-reads after set.
- [ ] **Step 2: Run, verify fail.** `cd app && npx vitest run src/pages/journal-2-0/shellFlag.test.js`
- [ ] **Step 3: Implement** shellFlag.js (mirror barsPush) + wire the `/journal` selector in App.jsx (both branches → JournalTwoRoot for now).
- [ ] **Step 4: Run tests + `npm run build`.**
- [ ] **Step 5: Commit** `feat(j2-p4): runtime shell kill-switch (uct.j2.shell, mirrors barsPush)`

---

### Task A2: JournalLayout nested-route shell + 5-item nav

**Files:**
- Create: `app/src/pages/journal-2-0/JournalLayout.jsx` + `.module.css` + `JournalLayout.test.jsx`
- Create: route surface wrappers `app/src/pages/journal-2-0/surfaces/{TodaySurface,TradesSurface,JournalSurface,InsightsSurface,CompassSurface}.jsx` (thin wrappers that host existing tab components; TodaySurface is a placeholder until B1)
- Modify: `app/src/App.jsx` (nested routes under `/journal`)

**Interfaces:**
- `JournalLayout` renders: the J2 header (title + AccountSelector + "+ Log Trade" [A5] + Settings gear + Community/overflow [A5]) + a 5-item primary nav (gold `UIcon`, `NavLink` to each route, active styling) + `<Outlet/>`. Mounts the shared SSE provider [A6] + the consolidated modals.
- Routes (App.jsx, nested under `/journal`): index → `TodaySurface`; `/journal/trades` → `TradesSurface`; `/journal/journal` → `JournalSurface`; `/journal/insights` → `InsightsSurface`; `/journal/compass` → `CompassSurface` (paid-gated); `/journal/community` → CommunityTab surface; `/journal/accounts` → AccountsTab surface (folded, reachable via Settings/overflow).
- Surface wrappers:
  - `TradesSurface` — a segmented surface (`Open Positions | Closed Trades`) reusing `<OpenPositionsTab>` + `<TradeJournalTab>` (NOT merged — P5). Segment state in the URL (`?seg=open|closed`) or a nested route (`/journal/trades` index=open, `/journal/trades/closed`). Keep it simple: a segment toggle rendering one of the two existing tabs.
  - `JournalSurface` — segmented `Calendar | Notebook` reusing `<CalendarTab>` + `<NotebookTab>`.
  - `InsightsSurface` — renders `<AnalyticsTab>` (which already hosts the P3 InsightsHub sub-nav + ScopeBar).
  - `CompassSurface` — renders `<CompassTab>`.
  - `TodaySurface` — placeholder ("Today — coming in this release") until B1 replaces it.

**Context:** This is the structural swap. The surfaces GROUP existing components — do not rewrite them. `Layout` already provides `<Outlet/>` so `/journal` nesting is idiomatic. Keep `manualChunks` object-form; the new surface files auto-chunk via lazy imports if you lazy them (optional). The header's Generate-Report + Settings gear + ShortcutCheatSheet carry over from `JournalTwoRoot`.

- [ ] **Step 1: Write `JournalLayout.test.jsx`** — renders the 5 nav items; the active route's surface renders; navigating to `/journal/trades` shows the Trades segment (mock the tab components); Compass nav is paid-gated (teaser when free).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** JournalLayout + surface wrappers + App.jsx nested routes. Wire the A1 selector to render `<JournalLayout/>` for `'v5'`.
- [ ] **Step 4: Run tests + `npm run build` (confirm no white-screen; manualChunks object-form intact).**
- [ ] **Step 5: Commit** `feat(j2-p4): JournalLayout nested-route shell + 5 primary surfaces`

---

### Task A3: Permanent `?j2tab=` redirect shim (querystring-preserving)

**Files:**
- Create: `app/src/pages/journal-2-0/j2tabRedirect.js` (the tab→route + querystring mapper) + `j2tabRedirect.test.js`
- Modify: `app/src/App.jsx` (the `/journal` route handles a `?j2tab=` param by redirecting) OR handle inside JournalLayout's index

**Interfaces:**
- `mapJ2TabToRoute(searchParams) -> { path, search } | null` — reads `j2tab`, maps to the new route path, and RETURNS the remaining querystring (minus `j2tab`) preserved (esp. `sc_*`, `ins`, `note`, `seg`). `analytics`+`ins=edge` → `/journal/insights?ins=edge`. Returns null when no `j2tab`.
- On `/journal?j2tab=…`, redirect (`<Navigate replace>`) to `path?preservedSearch`. The redirect must run under BOTH shells? No — only the new shell; if the kill-switch is legacy (`v8`), the old `JournalTwoRoot` already handles `?j2tab=` natively, so the shim only applies when `resolveJ2Shell()==='v5'`.

**Context:** The 9 consumer sites (research R1 §4) build `?j2tab=` links, several with scope/ins params. The shim keeps them working forever. Mirror the existing `<Navigate to=… replace/>` redirect precedent (App.jsx:171,177). Test the querystring preservation explicitly (a link with `sc_setup=VCP&sc_v=1` must arrive intact).

- [ ] **Step 1: Write `j2tabRedirect.test.js`** — `j2tab=positions`→`/journal/trades`; `j2tab=analytics&ins=edge`→`/journal/insights?ins=edge`; `j2tab=journal&sc_setup=VCP&sc_v=1`→`/journal/trades?sc_setup=VCP&sc_v=1`; `j2tab=notebook&note=abc`→`/journal/journal?...note=abc`; no j2tab→null.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the mapper + wire the redirect in the new shell (index route detects `j2tab` and Navigates).
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p4): permanent ?j2tab= redirect shim (preserves sc_*/ins querystrings)`

---

### Task A4: `g>` hotkey aliases → navigation + ShortcutCheatSheet update

**Files:**
- Modify: `app/src/pages/journal-2-0/JournalLayout.jsx` (hotkeys) + `app/src/pages/journal-2-0/components/ShortcutCheatSheet.jsx`
- Test: `JournalLayout.test.jsx` (add hotkey cases) or a dedicated test

**Interfaces:** the 8 existing `g>` chords (`g>p`,`g>j`,`g>a`,`g>t`,`g>y`,`g>n`,`g>k`,`g>c`) now `navigate()` to the new routes: `g>p`/`g>j`→`/journal/trades`; `g>a`→`/journal/journal` (calendar); `g>y`→`/journal/insights`; `g>t`→`/journal/accounts`; `g>n`→`/journal/journal` (notebook segment); `g>k`→`/journal/compass` (paid); `g>c`→`/journal/community`. Add new primary aliases: `g>o` or `g>h`→Today (`/journal`). Update `ShortcutCheatSheet` to list ALL current chords (it currently documents only 4 — out of sync).

**Context:** Spec §65: "Old `g>` hotkeys alias to new ones for a month with a one-time teaching toast." For P4, the aliases route to the new surfaces (a teaching toast is optional polish — a one-time localStorage-gated toast "Shortcuts now open the new sections" is nice-to-have). Keep the chords working so muscle memory survives.

- [ ] **Step 1: Write hotkey tests** — firing `g>y` navigates to `/journal/insights`; `g>c`→`/journal/community`; the cheat sheet lists all chords.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the navigate aliases + update ShortcutCheatSheet.
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p4): g> hotkey aliases route to new surfaces + cheat sheet sync`

---

### Task A5: "+ Log Trade" header action + Community/Accounts relocation

**Files:**
- Modify: `app/src/pages/journal-2-0/JournalLayout.jsx` (header: "+ Log Trade" + Community overflow + Settings link to Accounts)
- Create (if needed): a small `LogTradeButton.jsx` reusing `AddPositionModal`/`AddTradeModal`
- Test: `JournalLayout.test.jsx`

**Interfaces:**
- **"+ Log Trade"** — a persistent header action on every surface. Clicking opens the add flow (reuse `AddPositionModal` for open positions and/or `AddTradeModal` for closed trades — a small menu "Log open position | Log closed trade", or default to the most common). Reuse the `GlobalAddPositionProvider` recipe (`AddPositionModal` + `useJ2SelectedAccount` + `POST /api/j2/positions`). Keyboard shortcut alias (the existing `a`/`t` in-tab shortcuts → a global one).
- **Community** — the J2 `CommunityTab` moves OUT of the primary nav into the header overflow (a "⋯"/menu or a header link to `/journal/community`). The route still exists (A2); it's just not a primary nav item.
- **Accounts** — not a primary nav item; reachable via the header (Settings/account overflow) → `/journal/accounts`. The AccountSelector header pill keeps account switching. (The comparison grid folding into Insights is B-phase polish; A5 just relocates the nav entry.)

**Context:** §63 chrome: persistent "+ Log Trade", header account switcher with sync-health dot, Community→header/overflow. Keep it minimal + reuse existing modals. No emoji.

- [ ] **Step 1: Write tests** — "+ Log Trade" in the header opens the add modal; Community is NOT a primary nav item but reachable via the overflow/header; Accounts likewise.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p4): + Log Trade header action + Community/Accounts to overflow`

---

### Task A6: Shared SSE provider at J2 layout + localStorage migration map

**Files:**
- Create: `app/src/pages/journal-2-0/J2PriceProvider.jsx` (subscribes the union of J2-relevant symbols to `priceStreamManager` once, stable across intra-journal nav) + context
- Create: `app/src/pages/journal-2-0/lib/localStorageMigrate.js` (one-shot migration map) + test
- Modify: `JournalLayout.jsx` (mount the provider) + the surfaces to consume it where trivial (optional — the existing per-tab `useRealtimePrices` still works via the pool; the provider stabilizes the union)

**Interfaces:**
- `J2PriceProvider` — mounts at JournalLayout, subscribes the open-position symbols (+ any always-relevant set) to `priceStreamManager` so the union stays stable across tab switches (no rebuild). Respects `MAX_SSE_TICKERS`. Exposes prices via context for surfaces that want them (existing `useRealtimePrices` callers keep working unchanged — this is additive).
- `localStorageMigrate.js` — a one-shot (guarded by a `uct.j2.migrated.v4` flag) that copies/renames keys when surfaces regroup. For P4 the migration is MINIMAL (surfaces aren't deep-merged): ensure `uct.j2.selectedAccountId`, column prefs, calendar mode, analytics section keys, holdings sort all still resolve under the new shell (they do — same components). The map is a NO-OP placeholder + the flag, ready for P5's real table merge (`openPositions.columns`+`tradeJournal.columns`→`trades.columns`). Document that the deep column-merge migration lands in P5.

**Context:** Research R3 §1 — the pool already solves socket churn; the provider stabilizes the subscription union across the new nested routes. R3 §3 — tab identity is URL not localStorage, so P4's migration is light; the real column-merge migration is P5. Keep A6 minimal and correct: don't break existing localStorage-backed prefs.

- [ ] **Step 1: Write `localStorageMigrate.test.js`** — the migration runs once (flag-gated), is idempotent, and preserves existing keys; a no-op when already migrated.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the provider (thin) + the migration (flag + no-op-safe) + mount in JournalLayout.
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p4): shared J2 SSE provider + localStorage migration scaffold`

---

**MILESTONE A SHIP GATE:** FE `journal-2-0` + `lib/journal-2-0` suites, `npm run build` (no white-screen — manualChunks object-form), `grep -c broker_sync api/main.py` ≥ 7, plus a MANUAL smoke via the mobile-audit harness or a quick Playwright: `/journal` renders the new shell; `?j2tab=analytics&ins=edge` redirects to `/journal/insights?ins=edge`; `window.__uctJ2Shell('v8')` restores the old 8-tab shell; `window.__uctJ2Shell('v5')` restores the new. Rebase onto `origin/master`, re-verify, push. **Decide at the gate:** ship A with `J2_SHELL_ROLLOUT_PCT=100` (new shell default, kill-switch ready) OR `=0` (new shell dark, opt-in) until Today lands in B. Given Today is the point of the new shell, recommend `=0` (dark) at A and flip to `100` at the B gate — so users never see a Today placeholder.

---

# MILESTONE B — Today surface + zero-states + mobile + Accounts home + e2e gate

Builds on A. Ships the Today flagship + the polish that makes the new shell worth opening, then flips the rollout to 100%.

---

### Task B1: Today surface — session router + 3 states + zero-data/no-sync/All-Accounts

**Files:**
- Create: `app/src/pages/journal-2-0/surfaces/today/TodaySurface.jsx` (replaces the A2 placeholder) + `.module.css`
- Create: `today/TodayHero.jsx` (the per-state lead module), `today/TodayZeroData.jsx`, `today/TodayNoSync.jsx`
- Create hook: `app/src/pages/journal-2-0/hooks/useTodayState.js` (derives the state)
- Test: `TodaySurface.test.jsx`

**Interfaces:**
- `useTodayState()` → `{ session: 'premarket'|'market'|'postclose', zeroData: bool, noSync: bool, allAccounts: bool }` — `session` from `useMarketOpen` (`premarket=isPremarket`, `market=isOpen`, `postclose=!isOpen && !isPremarket`); `zeroData` = positions.length===0 && optionStrategies===0 && comparison tradeCount===0; `noSync` = selectedAccount.balanceSource!=='broker'; `allAccounts` = accountId===null/'_all_'.
- `TodaySurface` renders: the ScopeBar MUTED ("Not applied here") if a scope is active; then ONE lead module by session (pre-market → discipline/readiness via `DisciplineLockBanner`+`useJ2DisciplineState` + owned-positions-vs-calendar; market → `BrokerAccountHero` live positions + day P&L; post-close → `EODRecap`+`useJ2EODRecaps` lead + one-tap reflection); then the CoachStrip [B2], week strip [B3], goal progress [B3], quick actions [B3]. One-desktop-viewport cap.
- **Zero-data variant** → `TodayZeroData` (guided checklist: Connect broker / Import CSV / Log first trade [reuse ImportCsvModal/AddTradeModal] + Compass intro; suppress hero/goals).
- **No-sync variant** → manual accounts get a "log today's trades" quick-entry block (reuse `AddTradeModal`/`AddPositionModal`) where synced accounts get the live hero.
- **All-Accounts** → lead + coach strip use the coach `overview` (`useCompassOverview`, supports `_all_` scope); the concrete-account modules (hero/goals) show a "select an account" affordance, never blank.

**Context:** Research R2 — ~90% assembly. The `overview` payload (`useCompassOverview` → `/accounts/{scope}/coach/overview`) gives today's trade_count/net_pnl/eod-recap-state + regime + WTD in one fetch. Reuse `BrokerAccountHero`, `EODRecap`, `DisciplineLockBanner`, `useMarketOpen`, `useJ2AccountComparison`. No emoji.

- [ ] **Step 1: Write `TodaySurface.test.jsx`** — mock useMarketOpen for each session → the right lead module mounts; zeroData → checklist (not hero); noSync manual → quick-entry block; allAccounts → overview lead + "select account" affordance; active scope → muted ScopeBar "Not applied here".
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p4): Today surface (3 session states + zero-data/no-sync/all-accounts)`

---

### Task B2: Consolidated CoachStrip (fold the banner pile)

**Files:**
- Create: `app/src/pages/journal-2-0/components/CoachStrip.jsx` + `.module.css` + test
- Modify: `TodaySurface.jsx` (mount CoachStrip); remove the redundant banner mounts from the Today lead (do NOT touch OpenPositionsTab's banners — those stay for the legacy shell / Trades surface unless clearly superseded)

**Interfaces:** `CoachStrip` takes the union of advisory signals — nudges (`useJ2Nudges`), active interventions (`useInterventions`), broker-review count (`/api/j2/broker/unreviewed`), unviewed EOD (`useJ2UnviewedEOD`), discipline lock (`useJ2DisciplineState`) — and renders ONE consistent strip (severity-ordered, dismissible, deep-linking to the relevant surface). Replaces the NudgesBanner + BrokerReviewNudge + InterventionBanner + EODRecapBanner + DisciplineLockBanner pile on Today. Renders null when nothing to show (calm surface).

**Context:** Research R2 §4 — these 5 banners currently mount inconsistently across OpenPositionsTab/CompassTab/JournalTwoRoot with per-component styles. CoachStrip is the "one consolidated coach strip" (§51). Much of the data is pre-aggregated in the `overview` payload (intervention/suggestion counts, eod state) — use it to minimize fetches. Keep it presentational + calm. No emoji.

- [ ] **Step 1: Write `CoachStrip.test.jsx`** — renders a nudge + an intervention + broker-review as consistent rows; dismiss works; renders null when all empty; severity ordering.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p4): consolidated CoachStrip (folds nudges/interventions/review/eod/discipline)`

---

### Task B3: Today secondary modules — week strip + goals + quick actions

**Files:**
- Create: `app/src/pages/journal-2-0/surfaces/today/TodayWeekStrip.jsx` (compact WeekView skin) + `TodayQuickActions.jsx`
- Modify: `TodaySurface.jsx` (mount them + GoalProgress)
- Test: extend `TodaySurface.test.jsx`

**Interfaces:**
- `TodayWeekStrip` — reuses `WeekView` logic (7 day cells, each `navigate('/journal-2-0/calendar/${date}')`) in a COMPACT skin (the existing WeekView is full-size cards; wrap it or add a `compact` variant via CSS). Defaults to the current ISO week. Deep-links to the Journal day page (which stays the same route).
- `GoalProgress` — reuse `<GoalProgress account={selectedAccount} />` (needs a concrete account; hidden/"select account" on All-Accounts).
- `TodayQuickActions` — shortcut buttons to "+ Log Trade" (A5), "Open Journal", "Review a trade" — shortcuts, not new homes (§63).

**Context:** Research R2 §5/§6. WeekView day-cells already deep-link correctly. GoalProgress reuses `/accounts/{id}/goal-progress`. Keep the one-viewport cap in mind (Today is dense but must fit a desktop viewport). No emoji.

- [ ] **Step 1: Write tests** — week strip renders 7 days + a day-cell click navigates to the day page; goals render for a concrete account; quick actions trigger the add flow.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p4): Today week strip + goal progress + quick actions`

---

### Task B4: Zero-state pass (Open Positions list, Calendar, Accounts)

**Files:**
- Modify: `app/src/pages/journal-2-0/components/HoldingsList.jsx` (empty → designed state, not `null`)
- Modify: `app/src/pages/journal-2-0/tabs/CalendarTab.jsx` (or CalendarSurface) — a first-run prompt when the account has zero closed trades
- Modify: `AccountsTab.jsx` / GoalProgress — a "set your first goal" nudge when no goals
- Test: the affected component tests

**Interfaces:** each surface that currently shows a bare/blank empty gets a designed zero-state (a card with a one-line explanation + a primary action). `HoldingsList` empty → "No open positions — Log one or connect a broker" (not blank). Calendar with zero trades → a subtle first-run banner "Your trading days will appear here — log or import trades" (don't replace the grid, overlay/prepend a prompt). Accounts/goals → "Set a daily/weekly goal to track progress."

**Context:** Research R3 §4 — Trade Journal/Analytics/Notebook/Community/Compass already have designed empties; the gaps are Open Positions LIST view (HoldingsList returns null), Calendar (bare grid), Accounts/goals. §176 requires "zero-state pass on every surface." No emoji.

- [ ] **Step 1: Write/extend tests** — HoldingsList empty renders the designed state (not null); Calendar zero-trades shows the first-run prompt.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p4): designed zero-states on Open Positions list, Calendar, Accounts`

---

### Task B5: Mobile bottom nav (5 sections) + mobile quick-log

**Files:**
- Create: `app/src/pages/journal-2-0/JournalMobileNav.jsx` (bottom bar for the 5 J2 surfaces, phone only) + `.module.css`
- Modify: `JournalLayout.jsx` (render JournalMobileNav on phone; the primary rail hides on phone)
- Test: `JournalMobileNav.test.jsx` + a phone-layout assertion

**Interfaces:** a phone-only bottom bar (below/above the global `MobileTabBar`? — coordinate so they don't collide; the global bar is app-wide `position:fixed` bottom). Options: (a) a secondary journal bar that sits above the global bar, or (b) when inside `/journal` on phone, the journal's 5 sections replace the global bar's context. SIMPLEST + non-colliding: a journal sub-nav as a horizontal segmented scroller at the TOP of the surface on phone (not a second fixed bottom bar) + a floating "+ Log Trade" FAB (mobile quick-log). Decide based on collision: if a second fixed bottom bar stacks poorly with the global one, use the top segmented scroller + FAB. Use CSS `@media (max-width:640px)` for layout (not JS).

**Context:** Research R1 §5 — no J2-specific mobile nav today (the 8-tab row just wraps); the global `MobileTabBar` routes TO `/journal`. Research R3 §5 — the mobile toolkit (Sheet, phone card mode) is present. §184 — "Today single-column (hero + coach strip above fold)" + mobile quick-log. Keep it non-colliding with the global bottom bar. No emoji.

- [ ] **Step 1: Write tests** — the 5 journal sections are reachable on phone (mock useIsPhone); the "+ Log Trade" FAB/action opens the add flow; no collision assertion (the journal nav + global bar coexist).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build + a mobile-audit smoke at 390px on `/journal` (overflow check).**
- [ ] **Step 5: Commit** `feat(j2-p4): mobile journal nav (5 sections) + quick-log FAB`

---

### Task B6: Accounts settings home (broker + goals) — the canonical account-management surface

**Files:**
- Create: `app/src/pages/journal-2-0/surfaces/AccountsSurface.jsx` (or extend the existing AccountsTab) — the canonical account-management home
- Modify: relocate `BrokerConnectionsCard` (currently in global `Settings.jsx:1066`) reference so it's reachable from the J2 Accounts surface (import + render it there; you MAY leave it in global Settings too, or move it — prefer render-in-both-safe: import into AccountsSurface without removing from Settings unless clean)
- Test: `AccountsSurface.test.jsx`

**Interfaces:** the `/journal/accounts` surface becomes the "canonical account-management home": account list (create/select/delete via the existing AccountsTab pieces) + `<BrokerConnectionsCard/>` (broker connect/disconnect + dup review) + `<GoalProgress/>` (goals) + the account comparison grid. The header AccountSelector + Insights link here. This is the spec's "Settings → Accounts is the canonical account-management home (broker connect/disconnect, goals)."

**Context:** Research R3 §2 — the full PortfolioSettingsModal 15-section decomposition is explicitly timeboxed/mechanical; P4's REQUIRED settings work is consolidating account management (broker + goals + accounts) into ONE reachable Accounts home. The 15-section modal keeps working as-is (accessible via the header gear); its routed decomposition is a mechanical follow-up, not a P4 blocker. Keep B6 scoped to the Accounts home. No emoji.

- [ ] **Step 1: Write tests** — AccountsSurface renders the account list + BrokerConnectionsCard + GoalProgress + comparison; broker connect reachable here.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build.**
- [ ] **Step 5: Commit** `feat(j2-p4): canonical Accounts home (broker connect + goals + comparison)`

---

### Task B7: Redirect-matrix e2e + hotkey + localStorage-migration + kill-switch drill (the P4 test gate)

**Files:**
- Create: `tools/j2_p4_redirect_matrix.py` (a Playwright e2e mirroring the `tools/mobile_audit.py` harness — boots the app with an admin account, drives the redirects) OR a vitest+jsdom route-integration test if Playwright-against-local is heavy
- Create: `app/src/pages/journal-2-0/__tests__/p4RedirectMatrix.test.jsx` (a jsdom MemoryRouter integration test as the primary gate — cheaper + deterministic)

**Interfaces:** the P4 test gate (spec §180): a redirect-matrix asserting EVERY `?j2tab=<tab>[&extra]` lands on the right new route with querystring preserved (the 9 consumer forms); the `g>` hotkeys navigate correctly; the localStorage migration is idempotent; the kill-switch drill (`setJ2Shell('v8')` renders the legacy shell, `'v5'` the new). Prefer a jsdom MemoryRouter integration test (deterministic, in-suite) for the redirect matrix + kill-switch; a Playwright smoke is optional if local-boot is available.

**Context:** §180 P4 gate = "redirect-matrix e2e (Playwright) + hotkey + localStorage-migration + kill-switch drill." A jsdom integration test covers the matrix + hotkeys + kill-switch deterministically; note in the report if a full Playwright run was substituted (with why). This is the regression guard for the whole nav swap.

- [ ] **Step 1: Write the redirect-matrix integration test** (all 9 j2tab forms + querystring preservation + hotkeys + kill-switch v8/v5).
- [ ] **Step 2: Run, verify it exercises real routing (fail-first where behavior is missing).**
- [ ] **Step 3: Fix any gaps it surfaces (in the shim/hotkeys, not by weakening the test).**
- [ ] **Step 4: Run the full FE journal suite + build.**
- [ ] **Step 5: Commit** `test(j2-p4): redirect-matrix + hotkey + kill-switch drill gate`

---

**MILESTONE B SHIP GATE:** full FE `journal-2-0` + `lib/journal-2-0` suites, `npm run build`, `grep -c broker_sync api/main.py` ≥ 7, the redirect-matrix gate green, a 390px mobile-audit smoke on `/journal` (no horizontal overflow), and the kill-switch drill verified. Flip `J2_SHELL_ROLLOUT_PCT` to `100` (new shell default). Whole-branch adversarial review + fix pass. Rebase onto `origin/master`, re-verify, push. Verify deploy (health swap + `/journal` renders the new shell live). Update memory. Announcement: "The journal now opens somewhere worth opening."

---

## Self-Review (spec coverage)

- §2 8→5 nav (Today/Trades/Journal/Insights/Compass) → A2 (routes/surfaces), A5 (Community/Accounts relocation). Deep internal merges deferred to P5 per §67. ✅
- §2 Today (3 states + zero-data + no-sync + one-viewport + ignores Scope) → B1, B2, B3. ✅
- §9 P4 foundation: route swap + permanent shim (A3) + runtime kill-switch (A1) + localStorage migration (A6) + shared SSE provider (A6). ✅
- §9 P4 visible: Today (B1-B3) + 8→5 nav (A2/A5) + "+ Log Trade" (A5) + hotkey aliases (A4) + zero-state pass (B4) + mobile bottom nav + quick log (B5) + settings sections (B6 — scoped to Accounts home; full 15-section decomposition = mechanical follow-up, spec-timeboxed). ✅
- §9 test gate: redirect-matrix + hotkey + localStorage-migration + kill-switch drill → B7. ✅
- §9 rollback: runtime kill-switch → A1. ✅
- §63 chrome (Log Trade, Community overflow, Accounts home) → A5, B6. ✅
- §65 routing (nested routes, permanent shim, hotkey aliases, shared SSE, manualChunks object-form) → A2/A3/A4/A6. ✅
- Explicitly deferred (documented, not gaps): the unified TRADES single-table + server pagination + day-page unification (P5, "nav moves once"); the full 15-section PortfolioSettingsModal route decomposition (spec-timeboxed mechanical follow-up); the one-time teaching toast (nice-to-have polish).

## Execution Handoff

Execute via **subagent-driven-development**: fresh implementer per task + task review + whole-branch review at each milestone boundary. A1 (kill-switch) ships FIRST. Recommend shipping Milestone A with the new shell DARK (`J2_SHELL_ROLLOUT_PCT=0`) and flipping to 100% at the Milestone B gate, so users never see a Today placeholder.
