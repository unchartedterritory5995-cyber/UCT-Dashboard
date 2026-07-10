# Journal 2.0 A+ — P3: Global Scope + Insights Hub + Sync Trust Center — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship "Filter everything, trust everything" — one global Scope filter (FilterSpec) that drives every J2 aggregate surface with shareable URLs, an Insights hub of setup/edge analytics with drill-through, filtered CSV/JSON export, and a Sync Trust Center v1 for broker-connected accounts.

**Architecture:** P1a already shipped the FilterSpec spine (`filters.py`: model + `trades_where` compiler + `parse_filter_query`) and the paginated `GET /api/j2/trades` additive envelope. P3 (a) extends FilterSpec to a versioned contract with a `tags` facet + adapters for analytics/calendar/options/setup-stats so ONE spec filters all surfaces identically, (b) builds the frontend Scope bar (one component, URL-serialized, replacing the three tabs' divergent local filter rows), (c) builds an Insights hub sub-nav inside the Analytics tab reusing existing analytics data, and (d) assembles a Sync Trust Center from existing broker plumbing. Two ship milestones: **A** (Scope spine + bar + export) then **B** (Insights hub + Sync Trust Center).

**Tech Stack:** FastAPI + SQLite (`j2_*` tables, `auth.db`), pydantic v2, React + Vite SPA, react-router `useSearchParams`, SWR, ECharts, existing `Sheet`/`CollapsibleSection`/`UIcon` primitives.

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the approved spec (`docs/superpowers/specs/2026-07-09-journal-a-plus-design.md` §6/§7/§8) and locked project invariants.

- **FilterSpec is the ONE filter contract.** No J2 endpoint parses filter query params directly — every filtered read takes a `FilterSpec` via `Depends(parse_filter_query)`. Add facets to the model + `parse_filter_query` + the WHERE compilers, never inline.
- **Canonical Scope date semantics = EXIT/trading-day**, i.e. `COALESCE(trading_day_et, substr(exit_date,1,10))` — the existing `_DAY` spine in `filters.py:42`. This matches analytics + calendar. The legacy Trade-Journal client filter used *entry* date; P3 switches it to the spine (a deliberate, documented behavior change — filtered numbers must agree across surfaces).
- **Compass coach tools do NOT honor Scope** — the coach always sees the full account. Do not thread FilterSpec into any `coach_*` / voice path.
- **Active scope is LOUD:** the Scope bar fills gold when any facet is set, shows "N of M trades," and pins a Clear button. Scoped-empty results render a designed "No trades match this scope — Clear" state, NEVER a bare empty table (a broker-mirror user concluding trades vanished is a trust incident).
- **Confidence threshold = 10 everywhere.** Any stat computed on n<10 rows renders grayed with an explicit "n=X, need 10" affordance — including every cross-cut cell. Backend keeps the "None-with-counts" idiom (`_edge_score` at `analytics.py:540`, `_exit_quality_section` at `analytics.py:600`).
- **Sync Trust Center is HIDDEN for manual accounts** — gate on `account.balanceSource === 'broker'` (or `!== 'manual'`, the more robust form used by Calendar). At most one line for manual accounts.
- **No emoji.** All iconography via `<UIcon name=… />` (`app/src/components/ui/UIcon.jsx`). Add a glyph to the registry if needed; never a system emoji.
- **Mobile pattern:** desktop popover / mobile bottom-`Sheet`, mirroring `components/FiltersPanel.jsx` (`useIsTouch()` → `<Sheet variant="bottom-sheet">`). Use CSS `@media` for layout (the `useIsTouch` first-paint-stale gotcha), `useIsTouch` only for click-triggered render choices.
- **`?j2tab=` is a PERMANENT deep-link contract** (coach email links, `DayDetailPage`). The Scope bar must not disturb it. Scope params coexist with `j2tab` in the same querystring.
- **Broker merge invariant:** `grep -c broker_sync api/main.py` must be ≥ 7 before every push. Never edit partner-owned `OptionsFlow.jsx` inline styles.
- **Additive only.** Journal 1.0 (`api/services/journal_service.py`, `app/src/pages/journal/`) is untouched. New `j2_*` tables via `_PHASE_2_ALTERS` / `_J2_SCHEMA` in `db.py` (`IF NOT EXISTS`, idempotent).
- **Baseline test state:** 20 pre-existing failures (15 `test_options.py` time-brittle past-expirations + 5 `test_coach_chat_tools.py`). NEVER attribute these to P3 work. A clean run = "708 passed, 20 failed" shape.
- **Ship window normally ≥4:20 PM ET / <9:15 AM ET** (LiveFlow options tape). The owner authorized overriding the window for this initiative; still verify `broker_sync` grep + import before each push.

---

# MILESTONE A — Global Scope spine + bar + export

Ships as one deployable slice. Announcement: "Filter everything — one filter, everywhere, with shareable links, and your data leaves with you."

---

### Task A1: Extend FilterSpec with `tags` facet + version + tag compiler

**Files:**
- Modify: `api/services/journal_two/filters.py`
- Test: `api/services/journal_two/test_filters.py`

**Interfaces:**
- Consumes: existing `FilterSpec` (fields `date_from/date_to/symbol/sides[]/setups[]/limit/offset`), `_DAY` spine constant, `trades_where`, `parse_filter_query`.
- Produces: `FilterSpec.tags: list[str] = []` + `FilterSpec.version: int = 1`; `trades_where` emits a tag EXISTS subquery; `parse_filter_query` parses a `tags` query param (comma-joined, `unquote`d, same as `sides`/`setups`).

**Context:** `tags` filters trades whose `mistake_tags` OR `emotion_tags` JSON-array column contains ANY selected tag. Both are TEXT columns holding JSON arrays (`db.py:566-567`). SQLite `json_each` is available. The facet is additive; when `tags` is empty, emit no fragment (unbounded, unchanged).

- [ ] **Step 1: Write failing tests** in `test_filters.py`:
  - `test_tags_filter_emits_json_each_exists`: `trades_where(FilterSpec(tags=['fomo','revenge']))` returns a fragment containing `json_each` and exactly the right param list `['fomo','revenge','fomo','revenge']` (mistake OR emotion), and no fragment when `tags=[]`.
  - `test_version_defaults_to_1` and `test_version_roundtrips` (a passed `version=2` is preserved).
  - `test_parse_filter_query_parses_tags`: comma-joined `tags="fomo,revenge"` → `spec.tags == ['fomo','revenge']`; a `%2C`-encoded literal comma survives.
- [ ] **Step 2: Run tests, verify they fail.** `python -m pytest api/services/journal_two/test_filters.py -q`
- [ ] **Step 3: Implement.** Add to the model:
  ```python
  version: int = 1
  tags: list[str] = []
  ```
  In `trades_where`, after the `setups` clause, append (parameterized, tags applied to BOTH JSON columns with OR):
  ```python
  if spec.tags:
      ph = ",".join("?" * len(spec.tags))
      frag.append(
          "AND (EXISTS (SELECT 1 FROM json_each(COALESCE(mistake_tags,'[]')) WHERE value IN (%s))"
          " OR EXISTS (SELECT 1 FROM json_each(COALESCE(emotion_tags,'[]')) WHERE value IN (%s)))" % (ph, ph)
      )
      params.extend(spec.tags)
      params.extend(spec.tags)
  ```
  In `parse_filter_query`, add a `tags: str | None = Query(None)` param and split/`unquote` it exactly like `sides`/`setups`; pass into the returned `FilterSpec`.
- [ ] **Step 4: Run tests, verify pass** + the whole `test_filters.py` still green.
- [ ] **Step 5: Commit** `feat(j2-p3): FilterSpec tags facet + version + json_each tag compiler`

---

### Task A2: Analytics FilterSpec adapter — `/analytics` honors full Scope

**Files:**
- Modify: `api/services/journal_two/analytics.py` (`get_analytics`, `_fetch_trades`)
- Modify: `api/routers/journal_two.py` (the `/analytics` route, ~line 1212)
- Test: `api/services/journal_two/test_analytics.py` (add cases)

**Interfaces:**
- Consumes: `FilterSpec`, `trades_where`, `parse_filter_query`, existing `get_analytics(user_id, account_id=, date_from=, date_to=)`.
- Produces: `get_analytics(user_id, account_id=None, *, spec=None)` where a passed `spec` supplies date + symbol/sides/setups/tags via `trades_where`; the route passes `Depends(parse_filter_query)`. Back-compat: `date_from`/`date_to` kwargs retained (delegating to a spec internally) so any existing caller/test still works.

**Context:** `_fetch_trades` currently builds its own `account_id` + ET-date-range WHERE on the `trading_day_et` spine. Splice `trades_where(spec)`'s fragment after the base predicate. `account_id` stays a separate base predicate (as `list_trades_for_user` does at `trades.py:976-981`). All 8 analytics sections then reflect the scope automatically (they consume the fetched rows).

- [ ] **Step 1: Write failing tests.** Seed a user with trades across two setups + two symbols; assert `get_analytics(uid, spec=FilterSpec(setups=['VCP']))` yields `tradeCount` == the VCP-only count and `attribution.bySetup` has only VCP. Assert `date_from/date_to` kwargs still filter identically to before (regression).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** Give `get_analytics` a `spec` kwarg; when present, thread it into `_fetch_trades` and splice `trades_where`. When absent, synthesize a spec from `date_from/date_to` (so one code path). Update the `/analytics` route to `spec: FilterSpec = Depends(parse_filter_query)` + `account_id` and call `get_analytics(user["id"], account_id=account_id, spec=spec)`.
- [ ] **Step 4: Run tests + full `test_analytics.py`.**
- [ ] **Step 5: Commit** `feat(j2-p3): analytics honors full FilterSpec (symbol/side/setup/tag)`

---

### Task A3: Calendar FilterSpec adapter — non-date facets filter day aggregates

**Files:**
- Modify: `api/services/journal_two/calendar.py` (`get_calendar`, `get_day_detail`)
- Modify: `api/routers/journal_two.py` (`/calendar` ~1244, `/calendar/day/{date}` ~1274)
- Test: `api/services/journal_two/test_calendar.py` (add cases)

**Interfaces:**
- Consumes: `FilterSpec`, `trades_where`, existing calendar range SQL (`calendar.py:399-402`).
- Produces: `get_calendar(...)` + `get_day_detail(...)` gain an optional `spec` kwarg; when present, the trade-side aggregation splices `trades_where(spec)`'s **non-date** clauses (symbol/sides/setups/tags). The calendar's own date window (view/year/month/week) is UNCHANGED — the calendar navigates dates itself; the Scope date facet does not apply here (enforced by ignoring `spec.date_from/date_to` in the calendar adapter).

**Context:** Per spec, on Calendar the date facet renders muted ("the calendar sets its own dates"); symbol/side/setup/tag DO filter which trades count toward each day. Build a `trades_where` variant call that drops the date clauses, OR simply construct a `FilterSpec` copy with `date_from=date_to=None` before compiling. Option-strategy union into day P&L should apply symbol/side where meaningful (setups/tags don't apply to option strategies — leave those unfiltered for strategies, documented).

- [ ] **Step 1: Write failing tests.** Seed two symbols reporting P&L on the same day; assert `get_calendar(spec=FilterSpec(symbol='AAPL'))` yields that day's `pnlDollar`/`tradeCount` from AAPL only; assert passing `spec.date_from` does NOT shrink the calendar window (date facet ignored here).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** Add `spec` kwarg; compile `trades_where(spec.model_copy(update={'date_from': None, 'date_to': None}))` and splice into the trade aggregation query. Route: `spec: FilterSpec = Depends(parse_filter_query)`.
- [ ] **Step 4: Run tests + full `test_calendar.py`.**
- [ ] **Step 5: Commit** `feat(j2-p3): calendar day aggregates honor non-date Scope facets`

---

### Task A4: Remaining aggregate adapters — options, setup-stats, accounts/comparison, goal-progress

**Files:**
- Modify: `api/services/journal_two/options.py` (`list_strategies`) + route `journal_two.py:1076`
- Modify: `api/services/journal_two/setup_stats.py` + route `journal_two.py:867`
- Modify: `api/services/journal_two/accounts.py` (comparison + goal-progress aggregates) + routes `journal_two.py:720, 805`
- Test: `api/services/journal_two/test_setup_stats.py`, `test_options.py` (add non-brittle cases in a new `test_p3_adapters.py` to avoid the time-brittle option expirations)

**Interfaces:** each gains an optional `spec` kwarg applying the non-date (and, where the surface is date-ranged, date) facets via `trades_where`. Setup-stats already takes a `setup`; the Scope `setups` facet composes with it (Scope narrows the row universe; the `setup` arg picks the card).

**Context:** This closes the containment surface named in the research (the ~8 aggregate endpoints). Options: apply symbol/side (setups/tags N/A to strategies). Setup-stats + comparison + goal-progress: apply the full non-date facets. Keep each change minimal and mirror A2's splice pattern. **Write adapter tests in a fresh `test_p3_adapters.py`** so they don't inherit `test_options.py`'s brittle past-expiration fixtures.

- [ ] **Step 1: Write failing tests** in `test_p3_adapters.py` for each surface (symbol/setup scoping narrows the aggregate as expected; empty spec = unchanged).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the four splices. Routes take `Depends(parse_filter_query)`.
- [ ] **Step 4: Run `test_p3_adapters.py` + the four services' existing tests.**
- [ ] **Step 5: Commit** `feat(j2-p3): options/setup-stats/comparison/goal-progress honor Scope`

---

### Task A5: Filtered-aggregate parity fixtures

**Files:**
- Modify: `api/services/journal_two/tools_emit_parity_fixtures.py` (add a filtered-aggregate case set)
- Modify: `api/services/journal_two/test_parity_fixtures.py` (assert the aggregate fixtures)
- Create/seed: extend `app/src/lib/journal-2-0/parity-fixtures.json` (Python-authored, regenerated)
- Test: `api/services/journal_two/test_scope_parity.py` (new — the cross-surface identity assertion)

**Interfaces:** a new fixture category seeding N trades + a `FilterSpec`, then asserting that the SAME spec yields identical trade-row sets across `list_trades_for_user`, `get_analytics` (its `tradeCount` + `attribution.bySetup` counts), `get_calendar` (summed `tradeCount`), and `setup_stats`. Python-authority; the fixtures document the contract.

**Context:** The spec's competitive weapon: "filtered numbers disagreeing with totals is the exact complaint we weaponize against competitors." This test is the guarantee. It is NOT the JS math parity harness (that stays pure-math) — this is a Python-side cross-surface identity test seeded from a real in-memory DB.

- [ ] **Step 1: Write `test_scope_parity.py`.** Seed a deterministic book (fixed dates/symbols/setups/tags, no `Date.now`), pick 3 representative specs (symbol-only, setup+tag, date+side), assert the trade-count from each surface agrees for each spec. Fail first (adapters must already exist — they do after A2–A4).
- [ ] **Step 2: Run, confirm it exercises all four surfaces.**
- [ ] **Step 3: Implement** any glue needed so all four expose a comparable count; regenerate parity fixtures if the emitter is extended (`python -m api.services.journal_two.tools_emit_parity_fixtures`).
- [ ] **Step 4: Run `test_scope_parity.py` + `test_parity_fixtures.py` + the JS `parity.test.js` (unchanged, must stay green).**
- [ ] **Step 5: Commit** `test(j2-p3): cross-surface filtered-aggregate parity (Scope identity)`

---

### Task A6: TS FilterSpec type + versioned URL codec

**Files:**
- Create: `app/src/lib/journal-2-0/scope.js` (the codec + type via JSDoc)
- Create: `app/src/lib/journal-2-0/scope.test.js`

**Interfaces:**
- Produces: `EMPTY_SCOPE` (`{acct, from, to, symbol, sides:[], setups:[], tags:[]}`), `scopeToSearchParams(scope) → URLSearchParams`, `scopeFromSearchParams(params) → scope`, `scopeToApiParams(scope) → {account_id, date_from, date_to, symbol, sides, setups, tags}` (snake_case, matching `parse_filter_query`), `scopeIsActive(scope) → bool`, `scopeActiveCount(scope) → number`, `SCOPE_VERSION = 1`.
- Canonical URL keys (namespaced, collision-free with calendar's `view/y/m/w` and `j2tab`): `sc_acct, sc_from, sc_to, sc_sym, sc_side, sc_setup, sc_tag, sc_v`. Multi-value facets comma-joined + `encodeURIComponent`d per member.

**Context:** This is the shareable-links engine and the single source of truth for scope↔URL. `scopeToApiParams` is the ONE place that maps camelCase UI keys → the backend's snake_case `parse_filter_query` names — resolving the legacy `useJ2Filters` key-mismatch. Account is part of the scope object but maps to the `account_id` param (and syncs with `useJ2SelectedAccount`, wired in A7). Include `sc_v` so a future schema change can migrate.

- [ ] **Step 1: Write failing tests:** round-trip (`scopeFromSearchParams(scopeToSearchParams(s))` deep-equals `s`), empty scope → no params, `scopeToApiParams` emits snake_case, `scopeActiveCount` counts set facets, a literal comma in a setup survives, unknown/extra params are ignored, `sc_v` present.
- [ ] **Step 2: Run, verify fail.** `cd app && npx vitest run src/lib/journal-2-0/scope.test.js`
- [ ] **Step 3: Implement** the codec (pure functions, no React).
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** `feat(j2-p3): TS FilterSpec type + versioned scope URL codec`

---

### Task A7: `useScope` hook — URL-backed scope + account sync

**Files:**
- Create: `app/src/pages/journal-2-0/hooks/useScope.js`
- Create: `app/src/pages/journal-2-0/hooks/useScope.test.jsx`

**Interfaces:**
- Consumes: `scope.js` codec, react-router `useSearchParams`, `useJ2SelectedAccount` (`hooks/useJ2SelectedAccount.js` — `{accountId, setAccount}` + the `uct:j2:selected-account-changed` event).
- Produces: `useScope()` → `{ scope, setFacet(key, value), toggleMember(key, member), clearScope(), isActive, activeCount, apiParams }`. `scope.acct` is kept in lockstep with `useJ2SelectedAccount`: reading prefers the hook's `accountId`; `setFacet('acct', id)` calls `setAccount(id)`. URL is the source of truth for the other facets (write with `{replace:true}` to avoid history spam), matching `useJ2Filters`' model at `useJ2Filters.js:12-15`.

**Context:** Replaces the ROLE of `useJ2Filters` (which stays in the tree until A8/A9 remove its consumers). Account deliberately is NOT stored in the URL by the account switcher today (localStorage + event); the Scope bar surfaces it and `apiParams.account_id` comes from the hook so shared links can optionally include `sc_acct`. Decision: a shared link WITH `sc_acct` sets the account on load (so "my last 20 breakouts" links land on the right account); without it, the viewer's current account is used.

- [ ] **Step 1: Write failing tests** (render hook in a `MemoryRouter`): setFacet writes the URL; toggleMember adds/removes a setup; clearScope wipes facets but a subsequent read still reflects the live account; `apiParams` is snake_case; account change via the event bus updates `scope.acct`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: Commit** `feat(j2-p3): useScope hook (URL-backed facets + account sync)`

---

### Task A8: ScopeBar component (desktop bar + mobile sheet)

**Files:**
- Create: `app/src/pages/journal-2-0/components/scope/ScopeBar.jsx` + `.module.css`
- Create: `app/src/pages/journal-2-0/components/scope/ScopeBar.test.jsx`

**Interfaces:**
- Props: `ScopeBar({ surface, dateApplies = true, resultCount = null, totalCount = null })`. `surface ∈ 'journal'|'calendar'|'analytics'` (drives which facets show + labels). `dateApplies=false` (Calendar) renders the date facet muted with a tooltip "The calendar sets its own dates."
- Consumes: `useScope`, `useJ2SelectedAccount` (accounts list for the account facet + `AccountSelector` styling parity), `settings` setups + `mistakeTags`/`emotionTags` for the setup/tag option lists (via existing settings hook), `Sheet` (`components/mobile/Sheet.jsx`), `useIsTouch`, `UIcon`.
- Behavior: gold-filled when `isActive`; shows "N of M trades" when `resultCount`/`totalCount` provided; pins a Clear button (`clearScope`) when active. Desktop = inline bar + anchored facet popovers; touch = one-line chip summary (e.g. "RH · 30d · +2 filters") opening a bottom-`Sheet` with all facets + a "Clear all" footer — mirroring `FiltersPanel.jsx:161-184`.

**Context:** Facets: account (dropdown of accounts + "All Accounts"), date range (From/To date inputs + quick presets Today/Week/Month/YTD/All that write `from`/`to`), symbol (starts-with text, `/` hotkey focus), side (Long/Short), setup (checkbox list from settings), tag (checkbox list from mistake+emotion taxonomies). No emoji — gold ▾/× via UIcon. Reuse `FiltersPanel`'s shared-content-for-both-surfaces structure.

- [ ] **Step 1: Write failing tests:** renders facets for `surface='journal'`; date facet muted when `dateApplies=false`; active state shows Clear + "N of M"; clicking Clear calls `clearScope`; touch mode renders a chip that opens a Sheet (mock `useIsTouch=true`); no emoji in output.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + `cd app && npm run build`.**
- [ ] **Step 5: Commit** `feat(j2-p3): ScopeBar component (desktop bar + mobile sheet, per-surface facets)`

---

### Task A9: Wire ScopeBar into Trade Journal (replace local filters, go server-side)

**Files:**
- Modify: `app/src/pages/journal-2-0/tabs/TradeJournalTab.jsx`
- Modify: `app/src/pages/journal-2-0/hooks/useJ2Trades.js` (accept scope apiParams + pagination)
- Delete/retire consumers of `useJ2Filters` in this tab (leave `useJ2Filters.js` file for now; remove its import here)
- Test: `app/src/pages/journal-2-0/tabs/TradeJournalTab.test.jsx` (update/add)

**Interfaces:** `useJ2Trades(accountId, apiParams?)` fetches `GET /api/j2/trades?{apiParams}` and returns `{trades, total, isLoading, refresh, mutate}` (reads the P1a `{trades,total,limit,offset}` envelope). TradeJournalTab renders `<ScopeBar surface="journal" resultCount={trades.length} totalCount={total} />` in place of the Period pill row (`:284-307`) + the `☰ Filters ▾` button/popover (`:309-343`). Filtering is now SERVER-SIDE via the scope apiParams; the client-side `applyFilters` path is removed.

**Context:** Keep `TradesTable`'s sortable headers + inline setup `<select>` untouched (`components/TradesTable.jsx`). Preserve the "N of M" span meaning (now server total). Preserve prev/next on the detail page honoring the active filter — the detail nav already reads `location.search`; the scope params ride the same querystring. Scoped-empty → the designed "No trades match this scope — Clear" state (Global Constraint). If `total` exceeds a page and pagination is wired, add a simple "load more"/page control (limit default via scope; unbounded when no page requested — the envelope supports both).

- [ ] **Step 1: Update tests** — mock `/api/j2/trades` returning the envelope; assert the tab renders `<ScopeBar>`, filtered results reflect apiParams, and scoped-empty shows the designed state (not a bare table).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** Remove `useJ2Filters` + `applyFilters` usage here; thread `useScope().apiParams` into `useJ2Trades`.
- [ ] **Step 4: Run tests + `npm run build`.**
- [ ] **Step 5: Commit** `feat(j2-p3): Trade Journal uses ScopeBar + server-side FilterSpec`

---

### Task A10: Wire ScopeBar into Analytics + Calendar

**Files:**
- Modify: `app/src/pages/journal-2-0/tabs/AnalyticsTab.jsx` (replace the Range pill row `:150-192`), `hooks/useJ2Analytics.js` (send scope apiParams)
- Modify: `app/src/pages/journal-2-0/tabs/CalendarTab.jsx` (mount ScopeBar, `dateApplies={false}`), `hooks/useJ2Calendar.js` (send non-date scope apiParams)
- Test: update `AnalyticsTab`/`CalendarTab` tests

**Interfaces:** `useJ2Analytics(scopeApiParams)` → `GET /api/j2/analytics?{apiParams}`. `useJ2Calendar({view,year,month,week,basis, ...scopeApiParams})` → `/api/j2/calendar` with the calendar's own view params PLUS the non-date scope facets. Analytics keeps its accordion (`CollapsibleSection`) unchanged; only the top filter row becomes the ScopeBar. Calendar keeps CalendarHeader's view/period/mode/basis chrome (those are navigation, not scope) and adds the ScopeBar above it with the date facet muted.

**Context:** Both surfaces already filter server-side, so this is swapping the filter UI + widening the params. The unified `from/to` scope replaces `afrom/ato` (Analytics) — migrate the range presets into the ScopeBar's date facet so Analytics date-range still works. Confirm the shared scope in the URL round-trips across all three tabs (switch tabs → scope persists).

- [ ] **Step 1: Update tests** — assert AnalyticsTab renders `<ScopeBar>` (no Range pills), the analytics fetch includes scope apiParams; CalendarTab renders `<ScopeBar dateApplies=false>` and the calendar fetch includes non-date facets but not `date_from/date_to`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + `npm run build`.**
- [ ] **Step 5: Commit** `feat(j2-p3): Analytics + Calendar mount ScopeBar (unified date facet)`

---

### Task A11: Filtered data export (backend + Scope-bar button)

**Files:**
- Modify: `api/routers/journal_two.py` (add `GET /trades/export`)
- Modify: `api/services/journal_two/trades.py` (a `rows_for_export(user_id, spec, conn=None)` helper if needed — reuse `list_trades_for_user`)
- Modify: `app/src/pages/journal-2-0/components/scope/ScopeBar.jsx` (Export button) reusing `app/src/pages/journal-2-0/lib/csvTemplates.js` (`toCsv`/`downloadCsv`)
- Test: `api/services/journal_two/test_export.py` (new) + frontend export test

**Interfaces:** `GET /api/j2/trades/export?format=csv|json&{filter params}` → a `StreamingResponse` with `Content-Disposition: attachment; filename="uct-journal-trades-{date}.{ext}"`. Uses `Depends(parse_filter_query)` — the SAME FilterSpec, so export == what's on screen. CSV columns: a stable, documented set (symbol, side, entry/exit date+time, shares, entry/exit price, pnlDollarNet, rMultiple, setup, mistakeTags, emotionTags, source). JSON = the full `list_trades_for_user` row list.

**Context:** "Your data leaves with you" (spec §8). Near-free given FilterSpec + the existing `toCsv`/`downloadCsv` primitives (`csvTemplates.js:34,49`). Frontend: an Export control in the ScopeBar (desktop) / Sheet footer (mobile) → downloads the scoped CSV. Prefer the backend endpoint for the authoritative row set (client `toCsv` is a fallback for the already-loaded page).

- [ ] **Step 1: Write failing backend test:** seed trades, `GET /trades/export?format=csv&setups=VCP` returns only VCP rows as CSV with the header row + correct `Content-Disposition`; `format=json` returns the row list; an unknown format → 422.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the endpoint + the ScopeBar Export button.
- [ ] **Step 4: Run backend test + `npm run build`.**
- [ ] **Step 5: Commit** `feat(j2-p3): filtered CSV/JSON trade export over FilterSpec`

---

**MILESTONE A SHIP GATE:** full backend suite (expect 20-baseline shape), FE `journal-2-0` + `lib/journal-2-0` suites, `npm run build`, `grep -c broker_sync api/main.py` ≥ 7, `python -c "import api.main"`. Rebase onto `origin/master`, re-verify grep + import, push `feat/journal-aplus-p3:master`. Verify deploy (health 200; `GET /api/j2/trades?limit=1` returns the envelope). Announcement: shareable scoped links + export.

---

# MILESTONE B — Insights hub + Sync Trust Center

Builds on Milestone A (drill-through uses the scope URL codec). Ships as a second slice. Announcement: "See your edge, trust your sync."

---

### Task B1: Per-setup PF + expectancy + exit-efficiency (backend)

**Files:**
- Modify: `api/services/journal_two/setup_stats.py` (add PF/expectancy/exit-efficiency to the per-setup output) OR add `api/services/journal_two/playbook_stats.py` for an all-setups aggregate
- Modify: route `journal_two.py` (a `/accounts/{id}/playbook` or extend setup-stats to return all setups)
- Test: `api/services/journal_two/test_playbook_stats.py` (new)

**Interfaces:** an all-setups aggregate `[{setup, tradeCount, winRate, profitFactor, expectancy, avgR, exitEfficiency, lastFive}]` honoring the Scope (`spec` kwarg). PF = Σwins/|Σlosses| (copy the `_edge_score` logic at `analytics.py:552`, cap at 5 for display parity). Expectancy = mean per-trade `pnlDollarNet` (or mean R when R exists). `exitEfficiency` = mean of the P2 `j2_trade_excursions.exit_efficiency` joined by `trade_ref` for that setup's trades (None when coverage < the P2 gate — reuse the coverage idiom).

**Context:** `setup_stats.py` stops at win-rate/avgR (`setup_stats.py:57-68`); `_attribution_section.bySetup` also lacks PF/expectancy/exit-eff. This task produces the Playbook-card data. Reuse P2's excursion join pattern from `analytics.py:673`. Confidence: mark each setup with n<10 → the frontend shades it (B2).

- [ ] **Step 1: Write failing tests** — seed 2 setups; assert PF/expectancy computed correctly, exitEfficiency null when excursions absent, scope narrows the setups.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: Commit** `feat(j2-p3): per-setup PF/expectancy/exit-efficiency aggregate`

---

### Task B2: Confidence-shading shared component

**Files:**
- Create: `app/src/pages/journal-2-0/components/analytics/ConfidenceStat.jsx` + `.module.css`
- Create: `ConfidenceStat.test.jsx`

**Interfaces:** `<ConfidenceStat value={…} n={…} min={10} format={fn} label="" />` — renders the formatted value normally when `n >= min`, else a dimmed value + a small "n={n}, need {min}" affordance (title tooltip + `.dim` class). `null`/undefined value → an em-dash with the same affordance.

**Context:** Factors out the idiom that exists ad-hoc in `EdgeScorecard` (`AnalyticsTab.jsx:302-308`) and `RiskExitsSection`. Canonical threshold 10 (Global Constraint). Reused by every Playbook/Edge cell + cross-cut cell. No emoji.

- [ ] **Step 1: Write failing tests:** n≥10 shows value; n<10 shows dim + affordance; null value → em-dash + affordance.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: Commit** `feat(j2-p3): ConfidenceStat shared n<10 shading component`

---

### Task B3: Insights hub shell (sub-nav inside Analytics)

**Files:**
- Create: `app/src/pages/journal-2-0/components/insights/InsightsHub.jsx` + `.module.css`
- Modify: `app/src/pages/journal-2-0/tabs/AnalyticsTab.jsx` (host the hub sub-nav)
- Create: `InsightsHub.test.jsx`

**Interfaces:** `InsightsHub` renders a horizontal sub-nav (Playbook · Exit Quality · Edge · Psychology · Regime) inside the Analytics tab. Active section persists in the URL (a `?ins=` param, coexisting with `j2tab` + scope) — real routes arrive in P4, so a query param now. Only ONE section mounts at a time (inherit `CollapsibleSection`'s unmount-when-hidden benefit so ECharts don't all mount). Playbook/Exit Quality/Edge are live in P3; Psychology + Regime render a designed "Coming with the psychology/regime release" placeholder (NOT a broken/empty chart).

**Context:** The existing flat CollapsibleSection accordion (`AnalyticsTab.jsx:223-264`) stays as the "classic" analytics; the hub is the new organized entry. Decision: keep the accordion sections available (equity/performance/distribution/attribution/options) under an "All charts" sub-section OR fold them under the relevant hub tabs. Simplest v1: the hub adds Playbook + Edge + Exit-Quality as first-class sub-nav items; the remaining accordion sections stay below as "More analytics." Reuse `RiskExitsSection` unchanged for Exit Quality (it's already headerless + coverage-gated).

- [ ] **Step 1: Write failing tests:** renders the 5-item sub-nav; clicking Playbook mounts the Playbook section only; Psychology shows the placeholder; `?ins=` persists selection.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + `npm run build`.**
- [ ] **Step 5: Commit** `feat(j2-p3): Insights hub sub-nav shell inside Analytics`

---

### Task B4: Playbook section + drill-through

**Files:**
- Create: `app/src/pages/journal-2-0/components/insights/PlaybookSection.jsx` + `.module.css`
- Create: `app/src/pages/journal-2-0/hooks/useJ2Playbook.js` (SWR over the B1 endpoint, scope-aware)
- Create: `PlaybookSection.test.jsx`

**Interfaces:** setup cards, each showing win rate / PF / expectancy / avg-R / exit-efficiency via `<ConfidenceStat>`. Each card is a drill-through: clicking it sets the Scope `setup` facet (via `useScope().setFacet('setups', [name])`) and navigates to `?j2tab=journal` — landing on the scoped trade list. Cards honor the current Scope (the hook sends `apiParams`).

**Context:** This is "the piece TradeZella users pay for" minus the rules/adherence (which is P5 — do NOT build per-trade adherence here; the card shows the performance stats only). Drill-through is the P3 headline for the hub — it reuses A6's codec through `useScope`. Confidence-shade every cell.

- [ ] **Step 1: Write failing tests:** renders cards from mocked B1 data; n<10 setups shaded; clicking a card sets the setup scope + routes to the journal tab.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + `npm run build`.**
- [ ] **Step 5: Commit** `feat(j2-p3): Playbook section (setup cards + scope drill-through)`

---

### Task B5: Weekly Edge Score shareable card

**Files:**
- Create: `app/src/pages/journal-2-0/components/insights/EdgeScoreCard.jsx` + `.module.css`
- Create: `EdgeScoreCard.test.jsx`
- (Optional) Modify: `InsightsHub.jsx` to surface it in the Edge section

**Interfaces:** a branded dark/gold card rendering the `edgeScore` composite (`{score, components:{winRate, profitFactor, rConsistency, tradeCount}}` from `analytics.py:_edge_score`) with a "Share" action that produces a copyable image or a shareable scoped URL. v1: a visually-polished card + "Copy link" (scoped URL) — an image export can reuse the existing branded-card/canvas approach if trivial, else defer image to a follow-up. Null score (n<10) → the ConfidenceStat treatment ("Need 10+ trades with R-multiples").

**Context:** The direct "Zella Score" answer (spec §7). Data is already computed (`edgeScore` key). Keep it honest — no score until n≥10. No emoji; gold accents per brand.

- [ ] **Step 1: Write failing tests:** renders score + components; null score shows the need-10 state; Share copies a scoped link.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + `npm run build`.**
- [ ] **Step 5: Commit** `feat(j2-p3): Weekly Edge Score shareable card`

---

### Task B6: Sync Trust Center — backend (audit log read + activity counts + token expiry)

**Files:**
- Modify: `api/routers/broker_sync.py` (add `GET /sync-log`, `GET /trust`)
- Modify: `api/services/journal_two/broker/service.py` (a `trust_summary(user_id)` assembling health + counts + token state) + `connections.py` (capture `brokerage_authorization.disabled`/`disabled_date` if available)
- Test: `api/services/journal_two/broker/test_trust.py` (new; mock the SnapTrade client)

**Interfaces:**
- `GET /api/j2/broker/sync-log?account_id=&limit=` → user-scoped rows from `j2_broker_sync_log` (`started_at, finished_at, trades_imported, positions_upserted, options_imported, status, error`) — the log is written today (`sync.py:93-126`) but only admin-readable; expose it per-user.
- `GET /api/j2/broker/trust` → `{accounts:[{…health…, importedActivityCount, tradeCount, positionCount, tokenState}], anyBroker}` where `tokenState ∈ 'ok'|'expiring'|'broken'`. `broken` = existing `status='broken'`; `expiring` = SnapTrade `brokerage_authorization.disabled` truthy or `disabled_date` within a window (best-effort — if the field isn't captured, `tokenState` falls back to `ok`/`broken` only, documented).
- Imported-vs-broker counts: `j2_broker_activities` count (broker truth) vs `j2_trades`/`j2_positions` where `source='broker'` (imported) per account.

**Context:** ~80% assembly (research R4). Token-expiry proactive warning is the one genuinely-new capture: read the authorization's disabled flag in `connections.summarize_account` (`connections.py:157-183` currently reads it only for the name). If SnapTrade doesn't expose it on the current plan, ship `tokenState` with `ok`/`broken` only and leave a TODO — do not fabricate an expiry.

- [ ] **Step 1: Write failing tests** (mock SnapTrade + seed the tables): `/sync-log` returns the user's rows only; `/trust` reports per-account health + counts; a `status='broken'` account → `tokenState='broken'`; a disabled authorization → `'expiring'` (or `'broken'` if that's all the API gives).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + confirm `grep -c broker_sync api/main.py` unchanged.**
- [ ] **Step 5: Commit** `feat(j2-p3): Sync Trust Center backend (sync-log read + trust summary + token state)`

---

### Task B7: Orphaned-annotation reattach queue (backend)

**Files:**
- Modify: `api/services/journal_two/trade_refs.py` (add a `scan_orphans(user_id, conn)` that collects distinct `trade_ref`s across annotation tables + returns those failing `resolve_trade_by_ref`) — the `orphaned_refs()` primitive exists with zero callers
- Modify: `api/routers/journal_two.py` (add `GET /trust/orphans`, `POST /trust/orphans/reattach`)
- Test: `api/services/journal_two/test_orphans.py` (new)

**Interfaces:**
- `GET /api/j2/trust/orphans` → `[{tradeRef, kind, summary}]` — annotation `trade_ref`s (from `j2_trade_attachments`, `j2_trade_excursions`, verdicts/notes/tags if keyed by ref) that no longer resolve to a live trade.
- `POST /api/j2/trust/orphans/reattach {tradeRef, targetTradeId}` → re-points the orphaned annotation(s) to the chosen live trade's ref.

**Context:** The stable `ext:`/`id:` ref design means the COMMON resync case auto-reattaches (research R4); orphans are the residue when the FIFO fingerprint itself shifts or a trade was deleted. v1: a scan across the attachment + excursion tables (the two ref-keyed stores that exist) + a manual reattach. Park orphans (return them), never delete. Keep it small — this is a safety surface, not a migration engine.

- [ ] **Step 1: Write failing tests:** create an attachment keyed to a ref, delete the underlying trade, assert `scan_orphans` surfaces it; reattach to a new trade updates the ref; a resolvable ref is not surfaced.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: Commit** `feat(j2-p3): orphaned-annotation scan + reattach endpoints`

---

### Task B8: Sync Trust Center — frontend

**Files:**
- Create: `app/src/pages/journal-2-0/components/trust/SyncTrustCenter.jsx` + `.module.css`
- Create: `app/src/pages/journal-2-0/hooks/useSyncTrust.js` (SWR over `/trust` + `/sync-log`)
- Mount: in `tabs/OpenPositionsTab.jsx` (near `BrokerSyncStatus`) OR Settings `BrokerConnectionsCard` — pick the Open Positions tab (broker home)
- Create: `SyncTrustCenter.test.jsx`

**Interfaces:** a panel showing, per broker account: health badge (dot: green ok / amber expiring / red broken) + "synced Xm ago" + imported-vs-broker counts + a token-expiry warning banner when `tokenState==='expiring'` ("Reconnect soon — your brokerage authorization is expiring") + an expandable sync audit log (recent `/sync-log` rows) + the dup-flag review (reuse the existing `BrokerConnectionsCard` dup UI or link to it) + the orphaned-annotation reattach queue (list + "reattach to…" picker). **Hidden entirely for manual accounts** (`balanceSource !== 'broker'`) — render at most one muted line.

**Context:** Consolidates + extends `BrokerSyncStatus`/`BrokerReviewNudge`/`BrokerConnectionsCard` (research R4). Reuse `timeAgo`, `UIcon`, `Sheet` for mobile. Do not duplicate the dup-merge logic — link or reuse. No emoji.

- [ ] **Step 1: Write failing tests:** manual account → nothing (or one muted line); broker account → health badge + counts + audit log; `tokenState='expiring'` → warning banner; orphans list renders + reattach calls the endpoint.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + `npm run build`.**
- [ ] **Step 5: Commit** `feat(j2-p3): Sync Trust Center frontend (health/audit/token/reattach)`

---

**MILESTONE B SHIP GATE:** full backend suite (20-baseline shape), FE `journal-2-0` + `lib/journal-2-0` suites, `npm run build`, `grep -c broker_sync api/main.py` ≥ 7, `python -c "import api.main"`. Rebase onto `origin/master`, re-verify, push. Verify deploy (health 200; `GET /api/j2/broker/trust` auth-gated 401 not 405; `GET /api/j2/trades/export` present). Then the whole-branch adversarial review + fix pass, then update memory.

---

## Self-Review (spec coverage)

- §6 Global Scope → A1–A10 (FilterSpec facets, adapters, bar, shareable URLs, "N of M", scoped-empty, mobile sheet, parity). ✅
- §6 Compass ignores Scope → Global Constraint (no coach threading). ✅
- §7 Playbook (setup cards, PF/expectancy/exit-eff, drill-through) → B1, B4. Rules/adherence explicitly P5 (excluded). ✅
- §7 Confidence shading everywhere → B2 + applied in B4/B5. ✅
- §7 Weekly Edge Score card → B5. Psychology + Regime = placeholders (B3), full builds P5. ✅
- §8 Sync Trust Center v1 (health, counts, audit log, token-expiry, reattach, hidden-for-manual) → B6, B7, B8. Drift line explicitly v2 (excluded). ✅
- §8 Data export → A11. ✅
- Parity extension → A5. ✅
- JS math thinning (harness-gated) → deferred: the parity harness stays authoritative (A5); actual JS-thinning is optional cleanup, not shipped in P3 unless trivial (documented deferral, not a spec gap — the harness that GATES it is delivered).

## Execution Handoff

Execute via **subagent-driven-development**: fresh implementer per task + task review + whole-branch review at each milestone boundary. Ship at the two milestone gates.
