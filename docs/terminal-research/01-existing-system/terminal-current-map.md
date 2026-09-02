---
id: D-09
title: TERMINAL-CURRENT surface map (/calendar)
role: Terminal-Current surface specialist
wave: 1
group: D
category: internal-system
scope: uct-dashboard worktree `terminal-research` (app/ + api/); cross-checks in uct_intelligence (Discord bot) and morning-wire
confidence: 🟢
evidence_ceiling: No production runtime access — no logs, no Railway env read, no prod endpoint calls. Every "is it running in prod" statement is CLAIM unless corroborated by the contract's 2026-09-02 production render. Env-var STATE (WIRE_ENABLED, CALENDAR_ALERTS_ENABLED, CALENDAR_WEEK_POST_ENABLED, IMPLIED_ENRICHMENT_CUTOVER, EARNINGS_WARM_ENABLED) is not readable from here.
sources: api/routers/calendar.py, api/routers/wire.py, app/src/pages/Calendar.jsx, app/src/pages/calendar/**, app/src/components/research/EarningsResearchModal.jsx, app/src/pages/charts/widgets/CalendarWidget.jsx, api/main.py, api/services/calendar_*.py, api/services/earnings_*.py, api/services/implied_move.py, tests/test_calendar_*.py, CLAUDE.md
uct_relevance: high
status: draft
date: 2026-09-02
---

# TERMINAL-CURRENT — the canonical map of `/calendar`

> **Vocabulary.** TERMINAL-CURRENT = the shipped surface at route `/calendar`, display-named "UCT Terminal" since 2026-09-01. TERMINAL-NEXT = the product this program designs. Every path below is in the dashboard worktree `C:\Users\Patrick\uct-worktrees\terminal-research` unless stated otherwise.
>
> **How to read this file.** Sections 1–11 answer contract D-09's eleven questions in order. Inventories are tables; the OBSERVATION / EVIDENCE / INTERPRETATION / RELEVANCE / CONFIDENCE / RECOMMENDATION / OPEN QUESTION frame is applied per topic, not per table row.
>
> **Method.** Read-only inspection of source, tests and `git log`. `CLAUDE.md` was treated as a CLAIMS document throughout; §10.1 records where it is now wrong. No production call was made; the contract's authenticated production render of 2026-09-02 05:46 UTC is used as an observed artifact and cited as such.

---

## 0. Executive shape (read this if you read nothing else)

TERMINAL-CURRENT is **not "a calendar page."** It is a four-view earnings terminal with a twelve-panel research modal, its own personalization model, its own alerting and export rails, an AI narrative layer, a server-side PNG/Discord publishing arm, and **eight consumers outside the page itself**. The route name is the smallest true thing about it.

Measured surface, by artifact:

| Dimension | Count | Owner artifact |
|---|---|---|
| Views inside `/calendar` | 4 (Wire · Board · Table · Month) + 1 sub-route (`/calendar/mystocks`, 5 tabs) | `app/src/pages/calendar/CalendarHeader.jsx:256` `VIEWS` |
| HTTP routes under `/api/calendar/*` | 27 in `api/routers/calendar.py` + 4 in `api/routers/wire.py` = **31** | `grep -n '^@router\.' api/routers/calendar.py api/routers/wire.py` |
| Modal panels | 12 leaves in 5 groups | `app/src/components/research/railSections.js` `SECTIONS` / `GROUPS` |
| Persisted per-user preference keys | 4 live + 3 legacy read-for-migration + 1 nested widget key | `app/src/pages/Calendar.jsx:150-191` |
| Backend line count, router alone | 4,078 | `wc -l api/routers/calendar.py` |
| Backend test files matching `calendar` or `earnings` | 62 | `ls tests/` |
| Frontend test files on the surface + modal | ~50 | `find app/src -iname '*.test.js*'` |
| Distinct external providers in the earnings path | 7 (EarningsWhispers, Finviz Elite, Finnhub, FMP, ForexFactory, Massive, yfinance) + AlphaVantage on the history/transcript fallback + the logo chain | `api/routers/calendar.py`, `api/services/earnings_*.py` |
| Non-`/calendar` consumers of the calendar data | 8 (Dashboard TheWeek tile, /charts CalendarWidget, notebook CalendarEmbed, /r/calendar renderer, OptionsFlow load policy, calendar_alerts, awareness R5, ICS collector + wire coverage monitor + week poster) | §6.1 |

**The single most load-bearing finding for TERMINAL-NEXT:** the `/api/calendar` weekly payload is a **shared backend fact**, not one page's private data. Nine distinct readers — four in the browser, five on the server — depend on the `calendar_weekly` cache key and its payload shape. Retiring or re-shaping `/calendar` **the surface** is a different, much smaller decision than retiring `/api/calendar` **the contract**. They are routinely conflated because they share a name.

---

## 1. Surface anatomy

### 1.1 The four views and the view state machine

**OBSERVATION.** `/calendar` renders exactly one of four views at a time, chosen by a single persisted string.

| key | Label | Tooltip (verbatim) | Component | Data |
|---|---|---|---|---|
| `wire` | Wire | "Live earnings results as they hit the tape" | `calendar/WireView.jsx` | `GET /api/calendar/wire` + `/wire-coverage` (10 s poll) |
| `board` | Board | "Five-day logo board — the week at a glance" | `calendar/WeekView.jsx` | week payload + enrichment + metrics |
| `table` | Table | "Day-by-day data table — EPS & revenue estimates, expected move, beat history" | `calendar/TodaysBrief.jsx` + `calendar/FeedView.jsx` → `CalendarDayTable.jsx` | same, plus `/reactions` |
| `month` | Month | "Full month grid" | `calendar/MonthView.jsx` | `GET /api/calendar/month` |

**EVIDENCE.** `app/src/pages/calendar/CalendarHeader.jsx:256-261` (`VIEWS`); dispatch at `app/src/pages/Calendar.jsx:757-806`. View resolution, `Calendar.jsx:150-156`:

```js
const view = _savedViewV3 || (
  _viewV2 === 'month' ? 'month'
  : (_viewV2 === 'feed' && prefs.calendar_density === 'rows') ? 'table'
  : 'board')
```

CONFIRMED by the production render (contract KNOWN FACTS: tabs Wire/Board/Table/Month present in the header).

**INTERPRETATION.** Three consequences a reader of the tab strip would not guess.

1. **`board` is the default for every user who has never chosen** — it is the migration ladder's `else` branch. A fresh member's first impression of TERMINAL-CURRENT is the logo mosaic, not the data table.
2. **`wire` is unreachable by migration.** No `calendar_view_v2` value maps to it; it exists only after an explicit click. A user who set a view before the Wire shipped (`5377f1e5e`, "wire: the Wire view, mounted as the first calendar view") has never seen it unless they clicked it.
3. **`table` is the only view that renders `TodaysBrief`**, and only on the current week (`Calendar.jsx:761`). The component that calls itself "the retention moat" (`TodaysBrief.jsx:2`) is invisible to a Board-default user.

**RELEVANCE TO UCT.** Four views is not four features; it is four answers to four different questions (what just printed / what is the week shaped like / what are the numbers / what is the month). TERMINAL-NEXT inherits the question set whether or not it inherits the tabs. The Wire's discoverability gap is a real property of the current surface and is worth not re-shipping.

**CONFIDENCE.** 🟢 — source and production render agree. **EVIDENCE CEILING:** view-mix telemetry is not in the repo; `page_views` in auth.db records routes, not view prefs. Reading it would settle which views earn their place.

**RECOMMENDATION.** Treat "Board default + Wire behind a click" as an observed fact about current usage, not as a design endorsement. If TERMINAL-NEXT keeps a view concept, choose the default deliberately rather than inheriting a migration ladder's `else`.

**OPEN QUESTION.** What fraction of `/calendar` sessions ever switch off `board`? Nothing in the repo answers this.

---

### 1.2 Scopes, filters and the "Filters · N" model

**OBSERVATION.** Two independent selector families act on the same row set, and they are routinely mistaken for one.

**Audience scope** (one at a time), `CalendarHeader.jsx:17-20`:

| value | Label | Meaning |
|---|---|---|
| `mine` | My Stocks | union of the enabled sources |
| `watchlist` | Watchlist | that source only |
| `positions` | Positions | that source only |
| `uct20` | UCT20 | that source only |
| `all` | All | no scoping (**default**) |

**My-Stocks source picker** (multi-select; defines what `mine` means AND drives the personalization boost), `CalendarHeader.jsx:22`: `watchlist` · `flagged` · `positions` · `uct20`. Default = all four (`Calendar.jsx:74` `ALL_SOURCES`).

**Filter set**, `app/src/pages/calendar/filterLogic.js:2-15`:

| field | default | UI |
|---|---|---|
| `audience` | `'all'` | audience chips |
| `minMcap` | `0` | quick cap pills — All / $1B+ / $10B+ / $100B+ → `0 \| 1 \| 10 \| 100` |
| `sort` | `'mine'` | ⚙ panel: My stocks first / Time / Market cap / Expected move |
| `minAvgVol` | `null` | ⚙ panel |
| `priceMin` / `priceMax` | `null` | ⚙ panel |
| `confirmedOnly` | `false` | ⚙ panel — hides rows whose date is only an estimate (`date_est`) |
| `sector` | `null` | derived sector chip row (only sectors present in the loaded week, so counts stay honest) |
| `q` | — | **ephemeral, never persisted** (a stale saved search silently blanking next session reads as data loss) |

**Event-type chips** (`CalendarHeader.jsx:28-33`): `earnings` (default on) · `macro` · `ipos` · `dividends`.

**EVIDENCE.** `filterLogic.js::applyFilters` — metric filters are **null-safe passthrough** (a row missing the metric is KEPT, not dropped); `Calendar.jsx:176-178` merges ephemeral `q` over persisted filters; hidden-count line `CalendarHeader.jsx:585-591` and `:725-730`. Production render CONFIRMED the strings "Filters · 1", cap chips All/$1B+/$10B+/$100B+, and "0 reporting · 145 hidden — Show all".

**INTERPRETATION.** The "145 hidden" line on a week showing 0 reporters is the surface's most important honesty mechanism, and there are in fact **two different "hidden" concepts** in play. `hiddenByQuickFilters` (`filterLogic.js:60`) deliberately stays **quiet when only the audience filter empties a day** — hiding days is what audience scoping is *for* — but shouts when a quick filter (search text or cap pill) blanked it. The header's own hidden count is broader and fires on any filter bite. Two components, two rules.

**RELEVANCE TO UCT.** The reusable asset is the principle, not the chips: *a filtered-to-empty view must say so in the same breath as the emptiness*. That is the screener's `CoverageLine` idiom applied to the calendar, and it is the difference between "quiet market" and "you filtered it away".

**CONFIDENCE.** 🟢.

**RECOMMENDATION.** If TERMINAL-NEXT reduces the filter surface, the metric filters (`minAvgVol`, `priceMin/Max`) are the weakest candidates to carry: ⚙-panel-only, null-safe-passthrough (so they under-filter exactly where data is sparse), and no test or comment records a member using them. The cap pills and `confirmedOnly` carry more evident weight.

**OPEN QUESTION.** Is `confirmedOnly` usable in practice? It depends on `date_est`, which only some provider legs populate — a filter that can only hide a subset it cannot enumerate.

---

### 1.3 Week navigation, anchoring and the time model

**OBSERVATION.** Time state lives in the URL: `/calendar?week=YYYY-MM-DD&d=YYYY-MM-DD`. `week` is a Monday; `d` is a day to land on. The paging horizon is **±52 weeks** (`_WEEK_HORIZON_WEEKS`, `api/routers/calendar.py:140`); beyond it the API returns `source: "out_of_range"` and the page renders its Retry branch.

**The anchor rule is a single decision implemented twice, deliberately mirrored.** `api/routers/calendar.py:104 _current_week_monday()` = "the ISO Monday of the next session day" — identity on a weekday, **rolls FORWARD on Sat/Sun**. The frontend derives the same rule in `app/src/pages/calendar/weekAnchor.js::currentWeekMonday`, and `tests/test_calendar_week_anchor.py` executes both implementations and compares them on every day of the week.

**EVIDENCE.** `calendar.py:104-128` — the docstring is the field's single owner and records the bug: a second, contradictory frontend rule (`mondayOf(todayIso())`, which snaps BACK) made "Next week ▶" a visual no-op and "◀ Prev week" skip a week, **every weekend**. Frontend side: `Calendar.jsx:96-104`, `:588-600` (`shiftWeek` anchors on `weekParam || currentWeekMonday(todayIso())`).

**Time helpers** — `app/src/pages/calendar/calendarTime.js`, 35 lines, the entire timezone model:
- `todayIsoEt()` — ET calendar date via `Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York'})`, never the browser's date.
- `etHour()` — ET hour 0-23, `% 24` because WebKit renders midnight as "24".
- `inPrintWindow()` — `h >= 16 || (6 <= h < 10)` ET.
- `isReportingNow(entry)` — session-anchored, **never a clock time**: BMO window 06:00–09:59 ET, AMC 16:00–20:59 ET, TBD → either. The file's own header states why: *"no clock times exist from any provider."*

**Keyboard core** (`Calendar.jsx:625-650`): `←`/`→` page weeks, `T` jumps to today, `/` focuses search (`CalendarHeader.jsx:63-73`). All suppressed while a modal or day drawer is open; `←`/`→` inert in Month view (month nav owns time there); input/textarea/select/contenteditable targets exempt.

**Landing** (`Calendar.jsx:651-701`): lands on `?d=` if it is in the loaded week, else on today for the current week — but only in `table` view, only after `mySets` resolves (the Brief rail grows above the feed and would otherwise push today below the fold), and never on an `error`/`out_of_range` payload (so a Retry can still land). Two nested `requestAnimationFrame`s: one for the DOM, one for layout.

**INTERPRETATION.** The weekend roll-forward is a **product decision, not an accident** ("a member who opens the calendar on a Saturday sees the upcoming week, because the week just past is over"). It is also the richest single source of off-by-one bugs in the surface's history, and the mirrored-rule test is the only thing keeping the two sides honest.

**RELEVANCE TO UCT.** Any TERMINAL-NEXT with a week concept inherits both the decision and the hazard. `weekAnchor.js`'s "TWO named intents, ONE anchor" pattern (see §6.2) is the reusable artifact.

**CONFIDENCE.** 🟢 — rail-backed on both sides.

**RECOMMENDATION.** Carry `weekAnchor.js` forward verbatim if TERMINAL-NEXT has weeks. It is a hundred-odd lines encoding a decision, a hazard and a rail.

---

### 1.4 The header

**OBSERVATION.** `CalendarHeader.jsx` (791 lines) is **always** rendered — including on the error and loading branches (`Calendar.jsx:713-750`) — because *"an arrow that strands you on a dead error page reads as broken."*

Header contents, in render order (`CalendarHeader.jsx:611-750`):

| Element | Detail |
|---|---|
| Title | `<UIcon name="calendar"/>` + literal string **"UCT Terminal"** (`:613`) — the display rename |
| View tabs | the four `VIEWS`, with tooltips |
| Month nav | `‹ Month YYYY ›`, month view only |
| Hub link | `<Link to="/calendar/mystocks">` labelled "Hub" with a star glyph (`:655`) |
| ICS export | `/api/calendar/export.ics?scope=mine&token=…` when a token resolves, else `?scope=all` (`:344-345`) |
| Week label + picker | `Week of Aug 31 – Sep 4, 2026` (`fmtWeekRange`, `Calendar.jsx:41`) with a ▾ week picker |
| Day tabs | MON 31 … FRI 4 with **filtered** counts plus a "mine" count (`Calendar.jsx:544-567`) |
| Search | one input: live-filters the loaded week AND offers a typeahead jump |
| Cap pills | All / $1B+ / $10B+ / $100B+ |
| Hidden line | `{total} shown · {hidden} hidden` + **Show all** |
| Sector chips | derived from loaded data, most-reporters-first |
| Event-type chips | Earnings / Macro / IPOs / Dividends |
| Mobile | `FiltersSheet` from `components/mobile` when `useIsPhone()` |

**The search is one control doing two jobs** (`CalendarHeader.jsx:39-135`): typing live-filters the loaded week through the parent's `quickQ`; simultaneously a 150 ms-debounced `GET /api/ticker-search?q=&limit=8` populates a dropdown. Selecting a result fires **exactly one** `GET /api/calendar/next-report?sym=` — never per keystroke — and jumps to that symbol's week. A monotonic `reqIdRef` drops stale responses so a slow answer for an old query cannot overwrite the current one or reopen a closed dropdown. Escape clears text *and* results.

**Day tabs are a primary control that must never no-op** (`Calendar.jsx:606-618`): clicking a day in Board or Month **switches the view to Table** and scrolls, rather than doing nothing.

**"Show all" is imported, not restated** (`CalendarHeader.jsx:12-14`): it reuses `DEFAULT_FILTERS` from `filterLogic.js` so it cannot drift from what a fresh visitor actually lands on.

**EVIDENCE.** Lines cited above; production render CONFIRMED "UCT Terminal", the four tabs, Hub, the MON 31…FRI 4 day strip, cap chips, the hidden line and the week label.

**INTERPRETATION.** The header is the surface's real navigation model — four views × 52 weeks × 5 days × 5 audience scopes × 4 event types compressed into one bar. "Always rendered" and "one verb per control" are two hard-won usability invariants.

**CONFIDENCE.** 🟢.

**RECOMMENDATION.** The "header survives a failed payload" rule and the "a primary control must never no-op" rule were both bought with incidents and are both cheap. Carry them.

---

### 1.5 The day table (Table view)

**OBSERVATION.** `app/src/pages/calendar/CalendarDayTable.jsx` — "the density engine": every non-featured reporter WITH data as a 36 px row, session-grouped BMO → AMC → TBD with coloured spines, `imp`-ordered within groups, sortable headers, click → the modal.

Columns (`COLUMNS`, `:28-35`): **Company** (sortable) · **Cap** · **EPS est** · **Rev est** · **Move ±%** · **Beats** (not sortable). Reported rows flip EPS to actual + surprise and the Move column to the realized post-print gap.

Formatters are local and explicit: `fmtCap` renders `$1.2T` / `$340B` / `$450M`; `fmtRev` renders `$1.2B` / `$450M`; `fmtEps` renders `-$0.12`.

**EVIDENCE.** File header `:1-7`; `SESSIONS` `:18-22`; `SPINE_CLASS`/`DOT_CLASS` `:24-25`; the file's own words describe the layout as "the WSE/EarningsHub row grammar".

**INTERPRETATION.** This is the component that competes directly with EarningsHub / Wall-Street-Horizon-style grids. It is the densest artifact on the surface and the one a professional user would miss most.

**CONFIDENCE.** 🟢.

---

### 1.6 The earnings research modal

**OBSERVATION.** `app/src/components/research/EarningsResearchModal.jsx` is the click-through for every ticker on the surface. **Twelve panels grouped into five tabs**, with one piece of state — the leaf id. The group is **derived** (`groupOf`), never stored beside it, so every existing deep link and `?section=` query keeps landing exactly where it did before the rail grew a second level.

| Group tab | Members (leaves, in reading order) | The question it answers |
|---|---|---|
| **Setup** | `setup` | is there a trade into this print? |
| **Company** | `profile`, `financials` | what is this business and how is it doing? |
| **The Print** | `history`, `brief`, `call` | what happened, and what will be said about it? |
| **Coverage** | `analysts` (labelled "The Street"), `catalysts`, `news`, `filings` | what is everyone else saying? |
| **Ask AI** | `ai` | whatever the reader brought |

**EVIDENCE.** `app/src/components/research/railSections.js:23-40` (`SECTIONS`), `:65-71` (`GROUPS`), `:75-77` (`GROUP_OF` built FROM `GROUPS`, never typed a second time). Panel bindings: `EarningsResearchModal.jsx:43-63` (`PANELS`, exported so a rail can assert every `SECTIONS` id has a panel behind it — a tab with no panel renders `<undefined/>`, which the modal's own tests cannot see).

Why grouping happened, in the file's own words (`railSections.js:14-19`): the rail reached twelve items and was **196 px of a 960 px modal — 20 % of the surface spent on navigation** beside a canvas that is mostly dense numbers. Grouping returned the width without retiring a single panel.

**Geometry and chrome.** `height: min(720px, 88vh)` (`EarningsResearchModal.module.css:150`). The shell wears the app's `--menu-*` chrome — **not** `--glass-*`.

⚠️ **This corrects a standing note.** The module CSS header (`:3-21`) states the modal *used to be* the only surface in the product built on the research kit's olive `--glass-*` palette, and was deliberately migrated to `--menu-*` so it stops reading "as if it came from a different product" (every other dialog — ChartSettingsModal, ChartThemesModal, IndicatorSettingsDialog, IndicatorLibraryDialog, both context menus, the earnings-marker popover — already wore `--menu-*`). `--glass-*` is now re-declared **locally** (`:70-73`) inside a deliberate **theme island** that pins every theme-variant token to its `:root` dark default — because pinning only the shell to theme-invariant `--menu-*` while the content still resolved `--text` / `--glass-*` from `:root` produced a light-theme blackout measured in a real browser at **20 of 20 sampled text nodes at contrast 1.00** (rgb(11,14,17) ink on an rgb(14,14,16) panel — invisible, not merely dim). The bridge aliases are re-declared too, because an alias does not follow a nested scope. Rail: `EarningsResearchModal.themeIsland.test.js`. Fixed in `662467cee`.

**Lifecycle behaviours worth naming:**
- **Settled-symbol fetching** (`useSettledSym`): every panel keys off a debounced symbol so arrow-stepping a 40-name day cannot start a fetch storm. The banner's live price is the one deliberate exception — it follows the raw symbol so the header number never lags the header name.
- **Stepping** (`Calendar.jsx:497-512`): ← / → across the open day's reporters (`bmo` then `amc` then `tbd`), via `route.step()`, which REPLACEs history so a 40-name day cannot bury the exit.
- **ErrorBoundary keyed on `openSeq`, not on symbol** (`Calendar.jsx:822-846`): a sym-key remounted the shell on every step and threw away the section scroll map and the settle debounce. `openSeq` bumps only on a genuine fresh open — and (`openMarkerRef`, `:110-140`) it is bumped in the *same commit* as the fresh data, because a boundary that remounts one render before its correct data arrives crashes again on stale data and then sits tripped forever.
- **Actuals polling** (`earningsLifecycle.js` — `ACTUALS_POLL_MS`, `shouldPollActuals`, `computeLifecycle`, `countdownText`, `windowStart`) with `onPollActuals={mutate}` re-fetching the week.
- **Null vs zero discipline**: `null`/`undefined` are distinguished from a legitimate `0` throughout the banner — the file records this as "the phantom-zero trap that has bitten this branch six times already."

**INTERPRETATION.** The modal is where most of the surface's value density lives: twelve panels, of which at least five (`brief`, `call`, `catalysts`, `analysts`, `ai`) carry LLM or paid-provider content. A parity matrix that counts "the calendar" as one capability under-counts it by roughly an order of magnitude.

**RELEVANCE TO UCT.** The modal is **already generic**. It is mounted from `/calendar` and from `/calendar/mystocks`, and its panels compose `/research/:sym`'s own tabs (`FilingsTab` is imported straight from `pages/research/tabs`). It is the least calendar-specific thing on the calendar.

**CONFIDENCE.** 🟢 for structure; 🟡 for which panels members actually open (no telemetry in-repo).

**RECOMMENDATION.** Treat the modal as a **separable asset**, not as part of the calendar surface. If TERMINAL-NEXT replaces the week views, this is the piece most likely to survive intact.

**OPEN QUESTION.** Does the two-level rail cost a click on the most-used panels? The grouping bought canvas width; nothing measures what it cost.

---

### 1.7 The deep link — `?earnings=SYM&esection=`

**OBSERVATION.** The modal is URL-routed. `app/src/pages/calendar/useEarningsModalRoute.js` owns `earnings` (the symbol), `esection` (the panel) and `week`. It is honored on **exactly two paths**: `ROUTED_PATHS = ['/calendar', '/calendar/mystocks']` (`:52`). CatalystFlow is deliberately excluded — the Dashboard mounts two live instances (desktop + mobile trees), so a URL-driven open there would both double-render and be unresolvable.

**History semantics** are normative and documented in-file (`:12-21`): `open()` PUSHes (Back closes in one press); `step()`, `setSection()` and `jumpToWeek()` REPLACE; `close()` pops our pushed entry **only when we still own the top of history**, otherwise strips the params with replace. Ownership is **re-derived on every location change** rather than held in a boolean, because a plain `pushedRef` cannot observe browser-driven traversal. The documented failure: arrive on a shared link (no push — that is the FIRST entry) → click a different ticker (push) → native Back → click ✕ → `close()` reads a stale "true" and navigates the user off the entry they arrived on, possibly off the app entirely.

⛔ **Raw `window.history.pushState` is banned in this file** — `Calendar.jsx` already owns `?week` and `?d` through React Router's `useSearchParams`, and a bare pushState desyncs the router's copy of the query. Every write goes through `mergeParams`, which copies current params and applies a patch, so unrelated keys always survive.

**The resolution ladder** (`Calendar.jsx:290-430`) is the surface's most defended code path. Each rule is a fixed production bug:

1. Symbol already showing → return, **unless** enrichment is still missing AND a fresh lookup would GAIN a field. The three enrichment fields are **three independent providers** (`beat_history` = Finnhub, `hist_stats` = FMP/AV, `expected_move` = the options chain) that each arrive or permanently fail on their own schedule. Stopping on the first arrival froze `beat_history` permanently null even after it became available — exactly the field the Earnings History section's emptiness depends on (live: CAT, 2026-08-04, behind a 10-min Finnhub negative cache).
2. A miss while `data` is still loading is **not** an answer. `days` is legitimately `{}` before the first `/api/calendar` response; treating that as authoritative fired the `/next-report` fallback, which answers "when does this symbol report NEXT" and therefore **excludes a report that has already happened today** — throwing a same-week deep link 13 weeks forward and then orphaning the real current-week payload (live: AMD/CAT, 2026-08-04).
3. `/next-report` is asked **once per symbol**; a failed lookup never re-fires. A late response is dropped if it is no longer the live ask.
4. An unresolved symbol commits `{ sym, history_unresolved: true }` — a GUESS, explicitly marked — because the modal's Earnings History section otherwise reads a bare `{sym}` as the CLAIM "no reported quarters yet", and it cannot tell that row apart by shape from a company that genuinely has none. Lived 2026-08-08: `?earnings=JAZZ` on a Saturday resolves to its November report, which the calendar feed does not carry yet, so JAZZ — nine reported quarters — was told it had never reported one.

**Free-tier deep link** (`app/src/components/AuthGuard.jsx:144-147`). `/calendar` is **paid**: `FREE_PAGES = ['/morning-wire']` (`AuthGuard.jsx:112`, mirrored in `NavBar.jsx:39` and `MoreSheet.jsx`). A blocked user hitting `/calendar?earnings=NVDA` is redirected to `/research/NVDA` — which AuthGuard lets through so the page renders its own `PaywallTeaser` — instead of being bounced to bare Morning Wire with no explanation of what they were sent. No param, or a param that fails `normalizeSym`, falls through to the same `FREE_HOME` bounce as before. Owner call, 2026-08-05.

**EVIDENCE.** Files and lines above; rails `AuthGuard.calendarDeepLink.test.jsx`, `Calendar.deepLinkWeek.test.jsx`, `Calendar.earningsRoute.test.jsx`, `useEarningsModalRoute.test.jsx`, `refusalLastHops.test.jsx`.

**INTERPRETATION.** The `?earnings=` link is described in-repo as "the most viral surface in the product". It is the sharing primitive: one URL that opens a specific company's specific research panel on a specific week, resolvable from cold against three provider ladders.

**RELEVANCE TO UCT.** This is a **capability, not an implementation detail**, and it is the one most likely to be silently dropped by a rewrite because nothing on screen advertises it. Losing it breaks every previously shared link.

**CONFIDENCE.** 🟢.

**RECOMMENDATION.** Whatever TERMINAL-NEXT looks like, the `?earnings=SYM&esection=` contract should be honored or 301'd, never simply retired. Record it in the parity matrix as a first-class capability.

---

### 1.8 ICS export, "seen" state, alerts and personalization

**ICS export — three routes, two shapes.**
- `GET /api/calendar/export-token` (**paid**) mints `hmac_hex(PUSH_SECRET, user_id)` — **stable, no TTL** — so a subscribed Google/Apple Calendar URL works indefinitely. Returns `{token, subscribe_url: "webcal://…/api/calendar/export.ics?scope=mine&token=…"}` (`calendar.py:3747-3760`).
- `GET /api/calendar/export.ics?scope=all|mine&token=` (**optional auth**: `user: dict | None = Depends(lambda: None)`) — returns a valid VCALENDAR with zero VEVENTs on a cache miss; never raises (`:3761`).
- `GET /api/calendar/report.ics?sym=&date=` — a single report as one event (`:3813`).

The collector (`_collect_reporters_for_ics`, `:3636`) reads the `calendar_weekly` cache first, supplements from `get_month_calendar` for the current and next month, then dedupes on `(sym, date)` and sorts by date then ticker.

⚠️ **Security-relevant and already fixed; recorded because the docstring is the record.** `require_paid` exists in `calendar.py:37` specifically because **seven personalized routes were session-only** — `my-sets`, `next-report`, `sector-read`, `dividends`, `seen` (GET + POST) and `export-token` — while signup is open and free, so the React router was the only thing in front of them, and it redirects a browser rather than refusing a request. `export-token` is called out as the sharpest: it mints a token that makes the `.ics` feed readable **without a cookie, indefinitely**, converting a session-scoped paywall into a permanent bearer credential. The anonymous calendar reads (`GET /api/calendar`, `/month`, `/enrichment*`, `/report.ics`, the three `.png` renders) are deliberately **untouched**, because `/r/calendar` is mounted outside `AuthGuard` as a cookieless renderer — an owner call recorded in `.superpowers/sdd/audit/fix-exposed-routes-report.md`. Secrets are referenced by name only throughout this document.

**"Seen" state.** `GET`/`POST /api/calendar/seen` (**paid**), backed by `api/services/calendar_seen.py` → table `calendar_seen(user_id, item_type, item_key, seen_at)` PK `(user_id, item_type, item_key)`, in **auth.db** (`CALENDAR_SEEN_DB_PATH`, default `/data/auth.db`), self-initialising on first use. `item_type ∈ earnings | filing | ipo | recap | insight | news`. Consumed by `app/src/hooks/useSeen.js`; used by `MyStocksHub` (per-tab unseen badge) and `TodaysBrief`.

**Pre-report alerts.** `api/services/calendar_alerts.py` — for each alert-enabled user, intersect their My-Stocks set with the day's reporters and fire through `watchlist_alert_service.deliver_alert_payload` (in-app AlertBell + email via Resend + Discord). Dedup table `calendar_alerts_fired(user_id, ticker, market_date)` in its **own** SQLite file `$DATA_DIR/calendar_alerts.db`, using the `INSERT OR IGNORE → IntegrityError` idiom that mirrors the catalyst alerts exactly. Reads the `calendar_weekly` cache (`:126`). Gated `CALENDAR_ALERTS_ENABLED=1`. Never raises.

**Personalization.** `api/services/calendar_personalization.py` assembles four sets from **auth.db** — watchlists, flagged (a watchlist with `is_flagged_list=1`, exposed separately so the UI can slice "Flagged" alone), J2 open positions, UCT20 — each wrapped in its own try/except so one failing source never blocks the others, and never raises. Served by `GET /api/calendar/my-sets` (**paid**).

**Personalization reaches the ranking, not only the filter** (`Calendar.jsx:271-277`): `_sources` is computed against the user's **active** source picker, not `ALL_SOURCES`, because using all four boosted names via a source the user had disabled — "a phantom position weighting the ranking".

**CONFIDENCE.** 🟢 for structure. 🔴 for whether alerts fire in production. **EVIDENCE CEILING:** one `railway variables --service web --json` read, printing key names only, would settle `CALENDAR_ALERTS_ENABLED`.

---

### 1.9 The importance hierarchy (why anything is bigger than anything else)

**OBSERVATION.** `app/src/pages/calendar/importance.js` — 256 lines, pure, no React, no fetch — is **THE hierarchy algorithm**: one number (`imp`) ranks every reporter, one boost (`imp_eff`) personalizes it, and one tier map drives Board, Table and Month **identically**, so the views cannot disagree about what matters.

Tiers: `mainEvent` (one per day) · `featured` (capped at `FEATURED_CAP`) · `table` · `compact`.

It is computed **client-side, deliberately** (`:7-11`): the server cannot see `mc_b` or expected move at build time on the live path, and a server-side `imp` would flip the Main Event seconds after first paint when the enrichment overlay lands.

**The Main Event is FROZEN per (week, day)** once metrics have actually delivered (`Calendar.jsx:517-546`). `metricsReady` gates on a **non-empty** metrics map, because a failed batch resolves to `{}` — defined but empty — and gating on `!== undefined` froze the pick on a metrics-less ranking that never healed. When a frozen pick differs from the recomputed one, the newly computed pick is **demoted into `featured` rather than lost**, and the card budget is preserved by evicting the lowest-ranked featured entry down into `table`. A cleanup effect prunes freeze keys for weeks the user paged away from, so the ref cannot grow one entry per (week, day) across a long session.

**Statistics.** z-scores are computed over **defined values only** (`zMap`, `:22-30`) — entries missing a field contribute 0 to `imp`, "neither rewarded nor punished for provider gaps". The z-score population is the **whole week**, so a Tuesday microcap and a Thursday megacap rank on one scale.

**INTERPRETATION.** This is the surface's genuine intellectual property: a ranking that is stable across a lazy multi-provider data arrival, honest about missing data, personalized without letting personalization fabricate importance, and shared by three views by construction rather than by convention.

**RELEVANCE TO UCT.** If TERMINAL-NEXT ranks anything, this file is the prior art — including its freeze semantics, which exist because ranking on lazily arriving data visibly reorders the page under the reader's cursor.

**CONFIDENCE.** 🟢. Rails: `importance.test.js`, `rankOrder.test.js`, `WeekView.rankWire.test.jsx`.

---

### 1.10 Mobile

**OBSERVATION.** The surface participates in the app's three-tier breakpoint system (phone ≤ 640 · tablet 641–1024 · desktop ≥ 1025). `Calendar.module.css` carries **six** `@media` blocks at the two canonical literals — `1024px` at `:1603`, `:3200`, `:3212`; `640px` at `:1640`, `:3033`, `:3154` — plus three `prefers-reduced-motion` blocks.

Phone-specific behaviour: `CalendarHeader` swaps its ⚙ panel for `FiltersSheet` from `components/mobile` when `useIsPhone()`; `MonthView` falls back to a scrollable agenda list; `EarningsResearchModal` renders inside the shared `Sheet` primitive rather than the two-pane glass.

Recent commits fixed a **tablet-specific** tap-target regression: `f3ab2f4ba` *"Calendar: the touch tier stops at 640px, so tablet had 19 sub-44px targets"* and `ea70b4756` *"Calendar modal: restore the 44px touch floor I shrank, and rail it"* (rail: `EarningsResearchModal.tapFloor.test.js`), inside the app-wide sweep `aab444be4` across 54 stylesheets.

**INTERPRETATION.** The calendar was a *named victim* of the "the touch tier is ≤ 1024, not ≤ 640" class. It is now rail-covered at the modal and less so at the page.

**CONFIDENCE.** 🟡 — source reading only. **EVIDENCE CEILING:** `tools/mobile_audit.py --routes "/calendar" --viewport tablet` against a sandboxed backend would convert this to a measurement. Not run: the harness needs a local backend, and this contract forbids one.

---

## 2. Event types and data

**OBSERVATION — the earnings build is a multi-stage merge over three date regimes.** `_build_current_week()` (`calendar.py:2068-2222`):

| Stage | What | Provider | Notes |
|---|---|---|---|
| 1 | live schedule | **EarningsWhispers** + Finviz | paced sequentially (`_EW_PACE_SECONDS = 0.6`, `_EW_RETRIES = 2`, backoff 1.5) — EW connection-drops parallel bursts, ~4 of 5 requests blocked |
| 1b | zero-earnings guard | wire_data `weekly_calendar` | if `live_total == 0`, fall through rather than accept an empty week |
| 2 | fallback | wire_data (morning engine push) | `source: "wire"` |
| 3 | empty shell | — | `_empty_day` per date |
| 3b | **past days of this week** | **Finnhub** (primary) + **FMP** + **Finviz** | `_backfill_past_days` — runs AFTER the wire-fallback decision so it cannot mask an empty live build |
| 3c | **today + still-future days** | **Finnhub** + **FMP** + **Finviz** | `_supplement_live_days` |
| 4 | actuals | **Finnhub** range, then **FMP** breadth | `_patch_today_actuals` → `_restore_sticky_reporters` → `_merge_sticky_actuals` |
| 5 | econ | **ForexFactory** (`nfs.faireconomy.media`) | `_curate_econ_events` — "real data, never AI" |
| 6 | names + date drift | Finviz name map, `ticker_meta` | `_attach_names`, `_attach_date_moves` |

Every entry is filtered against `cap_universe` from wire_data — **all three buckets** (`bmo`/`amc`/`tbd`), because `tbd` skipping the gate let sub-$300M Finviz names into the current week and thence into `calendar_alerts` and the ICS feed, while range weeks filtered them: "the exact count-incomparability class this redesign exists to kill."

**EVIDENCE / provider status.**

| Provider | Role | Status | Citation |
|---|---|---|---|
| EarningsWhispers | forward schedule, session (BMO/AMC), anticipation rank | **CODE-REFERENCED**; OBSERVED-CALLED by inference from the production render | `_build_live` `:266`, `_fetch_ew_day_resilient` `:245` |
| Finviz Elite | past sessions (`v=152&c=0,1,68`), day metrics, name map | CODE-REFERENCED | `:736`, `:2845`, `_build_finviz_name_map` `:1445` |
| Finnhub | month, past backfill, actuals, beat history | CODE-REFERENCED; `FINNHUB_API_KEY` | `:379`, `_fh_get_month` `:678` |
| FMP | range weeks, breadth actuals, next-report, econ | CODE-REFERENCED; `FMP_API_KEY` | `_fmp_calendar_day` `:1558`, `_fmp_range_week` `:1587` |
| ForexFactory | economic calendar | CODE-REFERENCED | `_FF_URLS` `:2230` |
| Massive | live reactions, day-metrics fallback, wire move overlay | CODE-REFERENCED | `:2619`, `:2756`, `wire.py:34` |
| yfinance | option chain for expected move (legacy leg) | CODE-REFERENCED, **flag-switchable** | `_cutover_on()` `:3017` |
| AlphaVantage | quarterly-history fallback, verbatim transcripts | CODE-REFERENCED | `_fetch_quarterly_history`, `av_transcripts.py` |
| logo.dev / Parqet / FMP / Finnhub / Clearbit | company logos via the `/api/ticker-logo` proxy | CODE-REFERENCED | `api/routers/ticker_logos.py` |

⚠️ **A key in configuration is not evidence of use.** Every row above is CODE-REFERENCED at minimum; none can be raised to OBSERVED-CALLED from the repository alone.

**The forward-week rule.** ⛔ **ONE PLACEMENT PER SYMBOL PER WEEK, across ALL days** (`calendar.py:1174`; rail `tests/test_calendar_forward_week_coverage.py:128`). Providers disagree about dates for the week ahead — measured on the live week of 2026-08-17: EW had XP on Monday while FMP projected Tuesday; Finnhub put ROST on Wednesday against EW's confirmed Thursday. A per-day dedup renders the company **twice in one week**. The FIRST placement wins, and the live schedule's placements are seeded before any supplementary leg runs, so a confirmed date always beats a projection.

**Why `_supplement_live_days` exists** — the measurement, `:1104-1122`. The current week used to be the only week whose *forward* days had a single source:

| date regime | sources before | after |
|---|---|---|
| past days of this week | Finnhub + FMP + Finviz | unchanged |
| today | EW + Finnhub + FMP | unchanged |
| **still-future days** | **EarningsWhispers ONLY** ← the hole | EW + Finnhub + FMP + Finviz |

On 2026-08-16, for the week of Aug 17, the served week held **71 in-universe reporters against 122** known to EW ∪ Finnhub ∪ FMP, and carried **not one symbol EW lacked**. BABA, BIDU, KLAR and FUTU were all present in Finnhub AND FMP on the right days. EW's `caldata` is an editorially ranked list, not a calendar — **29 rows for a Thursday against FMP's 673**. `_build_live`'s second leg could not cover: it asked Finviz for preset view `v=111`, whose export carries **no `Earnings` column at all** (measured live 2026-08-16), so every row failed its date parse and the leg contributed exactly nothing. That dead leg is gone; the working custom-view implementation runs here.

**Why `_backfill_past_days` exists.** EW and Finviz are forward-looking **schedules**: once a company reports, EW drops it from that date and Finviz's `Earnings` column rolls to next quarter, so Monday progressively emptied while the week was still open (EW served 2 names for Mon 7/27 against Finnhub's 119). The `live_total == 0` wire fallback never caught it, because today and tomorrow are always full. A finished day is capped **looser** than a live one (`_PAST_SESSION_CAP = 150` vs `_build_live`'s 40): the 40 bounds a forward schedule where EW's anticipation rank decides who matters, whereas truncating a day that already happened just hides reporters (a 40-cap showed 96 of Wed 7/29's 240). ~10 % of Finnhub past rows carry an empty `hour` and land honestly in **Time TBD** — a genuine provider gap, not a bucketing bug.

**Sticky actuals and sticky reporters.** `_restore_sticky_reporters` re-adds reporters a degraded past-day rebuild dropped (yesterday loses its roster when EW rolls it forward and the provider backfill lags a day) — **before** `_merge_sticky_actuals`, so a restored name still gets its printed numbers. "Pending" is **field-by-field, never "eps is null"** (`_patch_today_actuals`, `:369-375`): companies publish EPS and revenue separately (KOPN on 8/11 printed revenue with no EPS; LITE printed EPS while its revenue leg stayed frozen because the filter skipped any entry that already had an EPS). The Finnhub leg routes through the shared `finnhub_client.fh_get` so it shares the process-wide token bucket and 429 cooldown, and it **degrades instead of sleeping** — a blocking `sleep(2)` here held an anyio threadpool worker at exactly the moment threads are scarcest.

**Other event types.**
- **Economic** — ForexFactory, curated to Medium/High + Fed by `_curate_econ_events`. `_FED_TERMS` includes a **hand-typed surname list that goes stale on roster turnover**: the Powell-era list missed Chair Warsh entirely (8/21/26), and `jackson hole` had to be added because the symposium's title contains no "speech" and FMP's Medium impact let curation drop the Chair's week. `full_impact=1` (used by the /charts widget's star filter) overlays ALL-impact events instead of the curated set. A separate `api/services/econ_calendar_fmp.py` exists as an alternate source (rail `tests/test_econ_calendar_fmp.py`).
- **IPOs** — `api/services/ipo_calendar.py` (Finnhub); `GET /api/calendar/ipos?from=&to=`; 6 h service cache; **unauthenticated**; defaults derived by *calling* `_current_week_monday`, never restating it.
- **Dividends / splits** — `api/services/dividends_calendar.py` (yfinance); `GET /api/calendar/dividends?syms=` (**paid**, defaults to the caller's My-Stocks set); 12 h.
- **Catalysts** — reached only *inside the modal* (`CatalystsSection`), from the separate catalyst engine (`/data/catalysts.db`). Not part of the week payload.

**Day metrics** — `GET /api/calendar/day-metrics[-batch]`: `price`, 30-day `avg_vol`, `mc_b`. Primary **Finviz Elite `v=152`** (all three fields in one call); fallback **Massive** batch rich snapshots; `mc_b` also seeded from the wire-computed chip data, which is the most accurate. **Tiered TTL: 24 h past / 120 s today / 1 h future** — a past date's price, volume and cap are effectively immutable, so re-firing the bulk call every two minutes for history is pure waste.

**Expected move / implied move — the denominator rule.** An implied move is a **ratio**: `(call mark + put mark) / spot`, and *numerator and denominator must come from the same instant* (`api/services/earnings_enrichment.py:392-410`). The straddle was priced by the market against the spot that existed at quote time. Spot resolution is ordered deliberately (`_resolve_spot`, `:501-510`): (1) `chain.underlying` — the spot the provider returned **in the same response** as the marks, simultaneous and already paid for; (2) a separate yfinance read. `spot_source_counts()` reports which rail answered, process-lifetime, so the fail-soft direction is measurable rather than assumed.

The in-house replacement (`api/services/implied_move.py`, behind `IMPLIED_ENRICHMENT_CUTOVER=1`, **default OFF**) adds a **refusal layer** derived from measurement, not taste. A wide strike grid over a tiny spot fabricated enormous percentages — MAPS 2150 % (spot $0.35, strike $0.50), SGMOQ 1675 %, NRDY 1373 %, CTSO 615 %. The arithmetic was never wrong: `dollar / spot == pct` held on **776 of 776** rows. The fix is an **ATM-moneyness bound**, `|K−S|/S ≤ 0.10`, chosen because 10 % of spot is the widest gap a compliant standard strike grid produces at a tier boundary — and it **subsumes** a separate spot floor (of 24 chain rows with spot < $1, 21 are already refused by the bound).

Refusals are **typed**, and the type distinction is the point: `KIND_UNAVAILABLE` (we never got an answer — `chain_timeout`, `spot_unavailable`, `read_error`) is kept strictly apart from a genuine refusal, because *"telling a member 'we could not price this' when the truth is 'we never asked in time' is a confident false statement"* (`_bounded_em`, `calendar.py:3051-3070`). `_bounded_em` writes its outcome **only on failure**, never on success, so a callable that actually ran keeps the outcome from the evaluation that withheld the number.

The client honors the distinction end to end: `expected_move_outcome` is carried through `mergeEnrichment` (`useCalendarData.js:44-51`) and rendered by `MoveUnavailableMark` / `moveIsUnavailable` (`cardBits.jsx`, `constants/expectedMoveOutcome.js`), with `null` meaning "never attempted" (a past report) — a different fact from "attempted, came back empty". **Only the second is shown.** Rail: `impliedMoveReason.test.jsx`, `refusalLastHops.test.jsx`.

**Date drift.** `api/services/calendar_date_integrity.py` — table `calendar_date_history(sym, report_date, prev_date, first_seen, updated_at)` PK `(sym)`, on `/data/calendar_dates.db`. **No new provider**: fed from the same Finnhub/FMP range payloads the calendar already fetches, plus `earnings_table._next_report_date` for search lookups. Surfaces as a **"Date moved Jul 28 → Aug 4" chip** (`DateMovedChip`, `cardBits.jsx`). The file names the competitive frame explicitly: *"Wall Street Horizon sells exactly this to institutions: a wrong or shifted earnings date burns options traders every quarter, and no retail product flags it."*

**Sector read.** `GET /api/calendar/sector-read?sector=&week=` (**paid**) → `api/services/calendar_sector_read.py`: one AI sentence on a GICS sector's earnings setup this week, grounded on that sector's actual reporters (assembled from the week payload plus `get_day_metrics`), cost-guarded, cached per `(sector, week)`, returning `ready` / `generating` (fires a deduped background job) / `unavailable`.

**INTERPRETATION.** The data layer is the surface's real engineering mass. It is a **provider-disagreement reconciler** with three date regimes, an add-only precedence order, a universe gate, a placement-uniqueness invariant, sticky ledgers against degraded rebuilds, and typed refusals. Almost none of it is visible in the UI, and all of it would have to be rebuilt or re-inherited by TERMINAL-NEXT.

**CONFIDENCE.** 🟢 for the code path; 🟡 for which legs actually fire in production (depends on which API keys are live).

**RECOMMENDATION.** Before any decision about TERMINAL-NEXT's data layer, treat `api/routers/calendar.py` stages 3b/3c/4 as a **specification of a solved problem**, not as legacy. The measurements embedded in its docstrings — 71 vs 122 reporters; 2 vs 119 on a rolled-forward Monday; 29 vs 673 rows for a Thursday; 96 of 240 under a 40-cap — are the acceptance criteria any replacement must meet.

**OPEN QUESTION.** Is `IMPLIED_ENRICHMENT_CUTOVER` on in production? The default is OFF. If it is still off, the shipped expected move is the delayed yfinance straddle **with no refusal layer**, and the measured 2150 %-class rows would be visible on cards. One env read settles it.

---

## 3. API surface

**OBSERVATION.** 31 routes. The Auth column is derived from each function signature (`Depends`), not from documentation.

### 3.1 `api/routers/calendar.py` — 27 routes

| Method · Path | Params | Auth | Response (summary) | Cache / TTL |
|---|---|---|---|---|
| GET `/api/calendar` | `week`, `full_impact` | **none** | `{week_start, week_end, days:{ds:{label, is_today, bmo[], amc[], tbd[], econ[], fed[]}}, source, is_current_week}` | `calendar_weekly` 600 s (60 s if incomplete) + `ServeStale` 30 min |
| GET `/api/calendar/month` | `year`, `month` | **none** | `{month, days:{ds:{bmo, amc}}}` | 30 min (120 s degraded); assembled from per-week fetches |
| GET `/api/calendar/ipos` | `from`, `to` | **none** | `[{sym, name, date, exchange, price_range, shares, value, status}]` | 6 h in service |
| GET `/api/calendar/dividends` | `syms` | **paid** | `[{sym, type, date, amount?, ratio?}]` | 12 h |
| GET `/api/calendar/reactions` | `date` | **none** | `{SYM: pct}` | `_REACTIONS_TTL` |
| GET `/api/calendar/day-metrics` | `date` | **none** | `{SYM:{price, avg_vol, mc_b}}` | 24 h past / 120 s today / 1 h future |
| GET `/api/calendar/day-metrics-batch` | `dates` | **none** | `{ds:{SYM:{…}}}` | as above |
| GET `/api/calendar/enrichment` | `date` | **none** | `{SYM:{expected_move, expected_move_outcome, beat_history, hist_stats, history_unresolved}}` | 300 s current / 4 h future / 12 h past + `ServeStale` 30 min |
| GET `/api/calendar/enrichment-batch` | `dates` | **none** | `{ds:{SYM:{…}}}` | as above |
| GET `/api/calendar/implied-moves` | `date` | **none** | `{SYM:{pct, dollar, …}}` | 6 h past / 300 s |
| GET `/api/calendar/my-sets` | — | **paid** | `{watchlist[], flagged[], positions[], uct20[], all_mine[]}` | — |
| GET `/api/calendar/next-report` | `sym` | **paid** | `{sym, date, timing, date_est}` | 6 h; **300 s negative** (a None date is indistinguishable from a provider blip) |
| GET `/api/calendar/seen` | `item_type` | **paid** | `{seen:[key]}` | — |
| POST `/api/calendar/seen` | body `{item_type, item_key}` | **paid** | `{ok:true}` | — |
| GET `/api/calendar/export-token` | — | **paid** | `{token, subscribe_url}` | — |
| GET `/api/calendar/export.ics` | `scope`, `token` | **optional** | `text/calendar` | — |
| GET `/api/calendar/report.ics` | `sym`, `date` | **optional** | `text/calendar` | — |
| GET `/api/calendar/sector-read` | `sector`, `week` | **paid** | `{status, line?}` | per (sector, week) |
| GET `/api/calendar/most-anticipated.png` | `week` | **none** | `image/png` 1200×630 | cached |
| GET `/api/calendar/week-earnings.png` | `week` | **none** | `image/png` | cached |
| GET `/api/calendar/week-econ.png` | `week` | **none** | `image/png` | cached |
| POST `/api/calendar/refresh` | — | **admin** | rebuild + `_WEEKLY_STALE.remember` | — |
| POST `/api/calendar/post-week` | `target`, `week`, `force` | **admin** | Discord post result | dedup on `week_start` |
| GET `/api/admin/calendar-coverage-status` | — | none¹ | live-coverage telemetry | — |
| GET `/api/admin/calendar-enrichment-status` | — | none¹ | `_ENRICH_STATS` + `window_days` | — |
| GET `/api/admin/calendar-date-integrity` | — | none¹ | drift-store status | — |
| GET `/api/admin/implied-sweep-status` | — | none¹ | sweep telemetry | — |

¹ These four `/api/admin/*` routes carry **no `Depends`** — read-only status endpoints in the `bars-stream-status` / `reconciliation-status` idiom. Named for completeness; judging that pattern is outside this contract.

### 3.2 `api/routers/wire.py` — 4 routes (the Wire view's backend)

| Method · Path | Auth | Purpose |
|---|---|---|
| GET `/api/calendar/wire` | none | the session's wire rows, oldest arrival first; a **table read** with one shared, serve-stale move overlay |
| GET `/api/calendar/wire-coverage` | none | provider truth (FMP one-day chunk + Finnhub, in-universe, reporters WITH published actuals) diffed against the wire store |
| POST `/api/calendar/wire-coverage/run` | **PUSH_SECRET bearer** | run measure → heal → re-measure → alert now (a POST because the heal MUTATES) |
| GET `/api/calendar/wire-status` | none | detector liveness + the `price_first` vs `actuals_first` fill mix |

The wire endpoint *deliberately does no provider fan-out for the feed itself*: the detector job owns all provider work, so `first_seen_at` stays accurate when nobody has the page open, alerts fire unattended, and the request path stays off the anyio threadpool — the 2026-07-01 524 class.

### 3.3 Why an unauthenticated GET of `/api/calendar/week` returns the SPA shell

**This is route shape, not auth fall-through, and the distinction matters.**

**OBSERVATION.** There is **no route `/api/calendar/week`** anywhere in the codebase. The weekly endpoint is `GET /api/calendar` with a **query parameter** `?week=YYYY-MM-DD` (`calendar.py:2001-2009`).

**EVIDENCE.** `grep -n '^@router\.' api/routers/calendar.py` yields `/api/calendar` plus `/month`, `/ipos`, `/dividends`, `/reactions`, `/day-metrics`, `/day-metrics-batch`, `/enrichment`, `/enrichment-batch`, `/implied-moves`, `/my-sets`, `/next-report`, `/seen`, `/export-token`, `/export.ics`, `/report.ics`, `/sector-read`, `/refresh`, `/post-week` and the three `.png` renders — **no `/week`**. And `api/main.py:9323-9328`:

```python
@app.get("/{full_path:path}")
def spa_fallback(full_path: str):
    return FileResponse(os.path.join(DIST, "index.html"),
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
```

**INTERPRETATION.** FastAPI matches routes in registration order. `/api/calendar/week` matches no API route, falls through to the catch-all registered last, and is served `index.html` with **HTTP 200**. Authentication never enters the picture: the request never reaches an authenticated handler — and `/api/calendar` itself is **unauthenticated by design** anyway (`require_paid`'s docstring, `calendar.py:52-58`, records that the anonymous calendar reads are deliberately untouched because `/r/calendar` reads them with no cookie).

**The consequence worth naming:** any prober that tests a wrong path against this API receives **200 + HTML**, not 404 + JSON. To a naïve check that reads status codes, that looks like "the endpoint exists and returned something." This is the same class as the broker-sync tell recorded in `CLAUDE.md` — `POST /connect` → 405 while `GET /connect` → 200 HTML, when the router is unmounted.

**RELEVANCE TO UCT.** Two things for TERMINAL-NEXT: (a) any API-shape audit must assert on **content type and body**, never on status alone; (b) if TERMINAL-NEXT introduces `/api/terminal/*` routes, the catch-all will mask every path typo in exactly the same way.

**CONFIDENCE.** 🟢 — derived from the route table and the catch-all, both read directly.

**RECOMMENDATION.** Consider an `/api/{rest:path}` 404-JSON guard registered *before* the SPA catch-all. It costs one route and removes an entire class of false-green probes. (An observation, not a requirement — it would change behaviour for any client relying on the current fall-through.)

---

## 4. Persistence

**OBSERVATION.** Every calendar preference is a row in the **server-side** user-preferences store (`POST /api/auth/preferences`, read through `usePreferences`), **not** localStorage.

| Key | Type | Default | Written by | Read by |
|---|---|---|---|---|
| `calendar_view_v3` | string | *(absent → `board`)* | `Calendar.jsx:171` | `Calendar.jsx:151` |
| `calendar_filters_v2` | JSON | `DEFAULT_FILTERS` | `:172` | `:161` |
| `calendar_mystocks_sources` | JSON array | `['watchlist','flagged','positions','uct20']` | `:173`, `MyStocksHub.jsx:352` | `:170`, `MyStocksHub.jsx:351` |
| `calendar_event_types_v2` | JSON array | `['earnings']` | `:191` | `:186` |
| `calendar_view_v2` | string | — | **legacy, read-only** | `:150` migration |
| `calendar_density` | string | — | **legacy, read-only** | `:154` migration |
| `calendar_filters` | JSON | — | **legacy, read-only** | `:166` migration |
| `charts_workspace_layout` → `widgets[].type === 'calendar'` | JSON (nested) | — | `ChartsWorkspace.jsx` | `WidgetHost.jsx:62` |

**Migration history — three key bumps, each with a stated reason (all quoted from the in-file comments):**
- **`calendar_view` → `_v2` → `_v3`** (owner-approved UX pass, 2026-07-14): ONE self-describing segment — Board (logo mosaic, default) / Table / Month. This retired the muddy Feed/Week split **and** the Tiles|Rows density toggle, because Feed-in-tiles was visually redundant with the Board and the flagship table was hidden two non-obvious clicks deep. v2 migrates once: `feed`+`rows` → `table`; `month` → `month`; else `board`.
- **`calendar_filters` → `_v2`** (owner decision, 2026-07-13): first paint now defaults to the **full market ranked big→small** (`audience: 'all'`), because *"a fresh visitor must never land on a sparse My Stocks week."* Legacy metric filters carry over once; audience and sort reset to the new default.
- **`calendar_event_types` → `_v2`**: macro used to be a locked, always-on chip, so every legacy saved pref carries it **not by choice**. Bumping the key resets everyone to the earnings-only default.

**⛔ These are PERSISTED USER PREFERENCES, and the widget-type key `calendar` lives inside `charts_workspace_layout`.** Renaming any of them wipes saved views unless a read-fallback shim ships in the same commit.

This is precisely why the 2026-09-01 rename (`b958aefb4`) was **display-only**. `git show --stat b958aefb4` touches 18 files — all label strings, nav entries and their tests. **Unchanged:** the route `/calendar`, the door key `calendar`, the widget type key `calendar`, every `/api/calendar/*` path, `icon: 'calendar'`, every filename, every CSS class name, and all four preference keys.

**INTERPRETATION.** The v2/v3 ladder is the surface's own record of *how many times its view model turned out to be wrong* — three bumps in roughly eight weeks. Each bump is also a silent data event: a user's deliberate choice is discarded and replaced with a new default, on the theory that the old value was not really a choice. That theory is explicitly true for `calendar_event_types` (macro was locked on) and explicitly a judgement call for `calendar_filters_v2`.

**RELEVANCE TO UCT.** TERMINAL-NEXT faces the identical problem the moment it changes any view vocabulary. The pattern in use — bump the key, migrate once, state the reason in a comment above the migration — is cheap and worth copying. The **cumulative** cost is that no user's calendar preferences have survived intact since July.

**CONFIDENCE.** 🟢.

**RECOMMENDATION.** If TERMINAL-NEXT reuses these keys, ship the read-fallback shim in the same commit as any rename, and treat `charts_workspace_layout`'s `type: 'calendar'` as the hardest of the set to move — it is nested inside a per-user layout blob, not a top-level key, so a naive rewrite orphans whole workspaces rather than one preference.

**OPEN QUESTION.** How many users hold a non-default `calendar_view_v3`? Answerable from `user_preferences` in auth.db — not read here (production data).

---

## 5. Jobs and warmers

**OBSERVATION.** Seven scheduled or background jobs touch this surface. All are registered in `api/main.py`; each flag's default is recorded.

| # | Job / thread | Schedule | Gate (default) | What it does | Evidence |
|---|---|---|---|---|---|
| 1 | `_start_dashboard_warm_background` → `_warm("calendar")`, `("earnings-previews")`, `("enrichment")` | once, ~20 s post-boot | **ungated** | first users after a deploy hit warm caches (measured elsewhere in the same block: calendar 3.7 s → 51 ms) | `main.py:861-989` |
| 2 | `calendar-enrichment-warmer` daemon thread | every **240 s** (under the 300 s TTL), plus one neighbouring week per cycle (offsets −2, −1, +1, +2) | **ungated** | keeps current-week enrichment permanently hot | `main.py:995-1070`, `:2802` |
| 3 | `earnings_preview_warm` | **every day** 06:20 / 10:20 / 14:20 / 18:20 ET | `EARNINGS_WARM_ENABLED` (**default 1**) | pre-generate AI previews for the week's biggest reporters | `main.py:5559-5571` |
| 4 | `earnings_analysis_warm` | Mon–Fri 08:35 / 09:35 / 11:35 / 16:35 / 17:35 / 20:35 ET | same | post-print analyses warm after BMO prints and after the close | `main.py:5573-5578` |
| 5 | `calendar_alerts_evening` / `_morning` | 18:00 ET (tomorrow's reporters) / 07:00 ET (today's) | `CALENDAR_ALERTS_ENABLED` (**default 0**) | pre-report alerts to My-Stocks holders | `main.py:5810-5845` |
| 6 | `calendar_week_post` | **Sat 04:30 ET**, pinned `America/New_York` | `CALENDAR_WEEK_POST_ENABLED` (**default 0**) | render both week PNGs, post as ONE Discord message | `main.py:5792-5805` |
| 7 | `wire_detector` (20 s in print windows) + `wire_detector_slow` (hourly, `minute=5`) + `wire_coverage_monitor` (09:40 / 13:40 / 17:40 / 21:40 ET) | as noted | `WIRE_ENABLED` — **strict `== "1"`** | the Wire's detector and its self-enforcing completeness pass | `main.py:5600-5651`, `:7045-7051` |

**Job 2 is the most instructive.** `_ENRICH_TTL` is 300 s on a **hard clock** over a provider fan-out measured at **18–25 s for one day and 60–100 s for a cold week**; the boot warm is one-shot, so after five minutes every 300 s window handed the full cold recompute to whichever user opened the calendar first — who then sat on a spinner inside the earnings modal. Measured on prod 2026-08-08: **enrichment cold 17.9 s → warm 0.14 s; the whole-week batch cold 24.8 s → warm 0.22 s. A 130× cliff, re-armed every five minutes.** The warmer's shape is borrowed from the RS-rankings warmer. It explicitly does **not** add provider load in the steady state — the same compute already ran once per TTL expiry, triggered by a user, on the request path, inside the shared anyio threadpool. The warmer moves it off that path and makes it predictable.

**Job 3's cadence is a fixed bug.** It runs **every** day, not Mon–Fri: *"the reader who opens Wednesday's NVDA tile on a SUNDAY was the reported symptom (2026-08-23). A weekday-only warm leaves the whole weekend cold for next week's board — which is exactly when someone sits down to prepare for it."*

**Job 7's gate is deliberately strict.** `WIRE_ENABLED` uses `== "1"` rather than the looser `("1","true","yes")` idiom used elsewhere in `main.py`: *"this job polls providers every 20 s during market hours, so the failure direction must be OFF. A typo enables nothing."*

**CLAIM vs CONFIRMED.**
- Jobs 1 and 2 are **CONFIRMED-by-code to be ungated** — they run on every boot. Whether they succeed is not observable from here.
- Jobs 3 and 4 are **CLAIM**, with a default-on flag.
- Jobs 5 and 6 are **CLAIM**, default-off. Nothing in the repo says they are enabled in production.
- Job 7 is **CLAIM by code**, but **CONFIRMED-by-artifact in production.** The contract's 2026-09-02 render showed *"1 reported name not shown yet: PANW"*. That string is emitted **only** by `WireView`'s `CoverageLine` (`WireView.jsx:73-77`), and **only** when `/api/calendar/wire-coverage` returns `is_current_session: true` with a non-empty `missing_from_feed` array. That payload is produced by `api/services/wire/coverage.py` by diffing provider truth against the **wire store** — which is populated exclusively by the detector. A wire that had never ticked would render the empty state, not a coverage diff. ⇒ **the wire subsystem was live in production on 2026-09-02.**

**PC Task Scheduler dependencies.** TERMINAL-CURRENT depends on **one** local Task Scheduler job, indirectly: the **7:35 AM ET morning wire** run, which pushes `wire_data` carrying `cap_universe` (the universe gate applied to every earnings entry) and `weekly_calendar` (the fallback earnings source at stages 1b and 2). Named only — **D-14 confirms the scheduler entries.** No calendar-specific local task was found.

**RELEVANCE TO UCT.** A 130× cold/warm cliff re-armed every five minutes is a **structural property of a multi-provider fan-out behind a hard-clock TTL**, not a bug in this page. TERMINAL-NEXT will re-create it unless it also re-creates the serve-stale + background-warmer pair.

**CONFIDENCE.** 🟢 for registration and gating; 🔴 for production flag state. **EVIDENCE CEILING:** `railway variables --service web --json`, piped to print KEY NAMES ONLY, would raise jobs 3–6 out of CLAIM.

---

## 6. Integrations and inbound links

### 6.1 The nine consumers of the calendar's data

**OBSERVATION.** `/calendar` is not the only reader of its own backend.

| # | Consumer | Reads | Same data path? |
|---|---|---|---|
| 1 | `/calendar` (`Calendar.jsx`) | `/api/calendar`, `/my-sets`, `/enrichment-batch`, `/day-metrics-batch`, `/reactions`, `/next-report`, `/ipos`, `/dividends`, `/month`, `/wire*` | — |
| 2 | `/calendar/mystocks` (`MyStocksHub.jsx`) | `/api/calendar`, `/my-sets`, `/api/news`, `useFilings`, `useCallRecap`, `useSentiment`, `/api/calendar/seen` | **yes** — the same `useCalendar` hook |
| 3 | `/charts` **CalendarWidget** | `/api/calendar?week=…&full_impact=1`, `/api/calendar/implied-moves`, `/api/calendar/day-metrics-batch` | **yes, different week intent** — §6.2 |
| 4 | Notebook **CalendarEmbed** | mounts the **real** `CalendarWidget` under a frozen workspace context | **yes** — one component, two hosts |
| 5 | `/r/calendar` (`CalendarRender.jsx`) | `/api/calendar` (+ next week), `/api/ticker-logo` | **yes**, unauthenticated |
| 6 | Dashboard **TheWeek** tile | `/api/calendar` | **yes** |
| 7 | **OptionsFlow** load policy | `/api/calendar?week=` (multi-week) | **yes** |
| 8 | Server-side: `calendar_alerts`, `awareness/engine` (rule R5, earnings proximity), `_collect_reporters_for_ics`, `wire/coverage_monitor`, `calendar_week_poster` | the `calendar_weekly` **cache key**, in-process | **yes** |
| 9 | Morning Wire → Substack (`morning-wire/substack/panelshot.py`) | headless browser → `/r/calendar?w=900&from=today&days=5` | **yes**, via the render route |

**EVIDENCE.** `grep -rn '/api/calendar' app/src --include=*.jsx` (excluding `pages/calendar/`); `grep -rn 'calendar_weekly' api/ --include=*.py` → `awareness/engine.py:83,100`, `calendar_alerts.py:117,126`, `calendar_week_poster.py:351`, `wire/coverage_monitor.py:13,132`; `morning-wire/substack/panelshot.py:43` — `"calendar": ("/r/calendar", {"w": 900, "from": "today", "days": 5}, 940, _S)`.

**INTERPRETATION.** **`/api/calendar` is app infrastructure, not a page's data source.** Nine readers, five of them server-side, one of them in a *different repository* driving a headless browser. Any change to the payload shape has a nine-way blast radius.

The OptionsFlow coupling deserves separate naming: `app/src/pages/optionsFlow/flowLoadPolicy.js:310-318` records that `/api/calendar` was measured at **8,005 ms** on a real first load and describes it as "100× slower" than its neighbours (cold 5,442 ms, warm 53 ms). **The calendar's cold build sits on the critical path of an unrelated page.**

**RELEVANCE TO UCT.** The parity matrix must separate two questions the shared name conflates: *"can TERMINAL-NEXT replace the `/calendar` **surface**?"* and *"can it replace the `/api/calendar` **contract**?"* The second is a much larger commitment.

**CONFIDENCE.** 🟢.

**RECOMMENDATION.** Before any coexistence or retirement design (D-08's scope, not mine), enumerate these nine as a dependency ledger. Five fail **silently** if the payload changes shape: the awareness engine, the ICS collector, the week poster, the alerts job and the wire coverage monitor all read the cache with bare `.get(...)` chains and no schema assertion.

### 6.2 The /charts CalendarWidget — a second, DIFFERENT week intent

**OBSERVATION.** `app/src/pages/charts/widgets/CalendarWidget.jsx` renders **one trading day at a time** — economic events (+ Fed) and the day's earnings split into Pre-Market (BMO) and After Hours (AMC) — with prev/next day navigation. It is market-wide (not chart-linked), but clicking an earnings ticker **publishes** that symbol to the widget's colour group, so a linked chart follows (one-way).

Registry entry (`app/src/widgets/registry.js:386-408`): type key **`calendar`**; labels `{header: 'UCT Terminal', menu: 'UCT Terminal', tab: 'Terminal'}`; defaults `w:6 h:10 minW:2 minH:4`; `placement: {family:'panel', fill:'narrow'}`; `menus: {workspace:true, tab:true, mobile:false, journal:false}`; `themeFollow: true`; params `date` (**required**, `'YYYY-MM-DD'`), `econStars` (default 3), `selectedSym`, `tbdOpen`, `sections`, `settings`; `plainText: (p) => "[calendar: " + p.date + "]"`; `reconstructable: true`; `liveCapable: false`. Note the comment: *"The widget renders ONE DAY (the week is only the fetch granularity)."*

⭐ **The two week intents.** The widget's intent is *"the week of the most recent session"* (`lastSessionDay`); `/calendar`'s is *"the current-or-upcoming week"* (`currentWeekMonday`). **On a Saturday they are seven days apart.** Both are derived from the single module `app/src/pages/calendar/weekAnchor.js`, as two *named* intents rather than two hand-rolled Monday derivations. ⛔ An **AST rail** — `CalendarWidget.weekIntent.test.jsx` — traces both intents back to an import from `weekAnchor` and **fails on anything locally declared**.

**INTERPRETATION.** This is the correct resolution of a genuine product ambiguity: two surfaces legitimately want different weeks, and the codebase encodes the difference as two named intents over one anchor. It is the reusable artifact promised in §1.3.

**CONFIDENCE.** 🟢.

### 6.3 The notebook / journal embed — one component, two hosts

**OBSERVATION.** `app/src/pages/journal-2-0/components/notebook/CalendarEmbed.jsx` mounts **the real `CalendarWidget`** under a frozen workspace context with the captured day restored. `onOptsChange` is `null`, so nothing inside the embed can persist a change (day navigation inside an embed is view-only drift, gone on reload); `journalDoor={false}`, because an embed offering "send to journal" would be circular.

Because the calendar endpoints are date-parameterized and backfilled, **a March capture re-renders March's calendar live** — actuals filled in — which is the same frozen-evidence contract charts already have. Declared fidelity residuals (from the P2 audit, stated in-file): section sort / show-all state and the selected ticker are not restored, and market-cap ordering uses live caps.

⚠️ **This is a DIFFERENT calendar from the journal's own.** `app/src/pages/journal-2-0/components/calendar/` (`DayCell`, `DayDetailPage`, `CalendarHeader`, `useJ2Calendar`, `CalendarTab`) is the **trade journal P&L calendar** — J2 tables, no market data, no `/api/calendar/*` call anywhere. The two share only the word, and a `grep -i calendar` across `app/src` conflates them.

**CONFIDENCE.** 🟢.

### 6.4 The render route → Substack, and the Discord week post

**`/r/calendar`** (`app/src/pages/CalendarRender.jsx`) is a **public, token-gated headless export**: mounted **outside `AuthGuard`** (`App.jsx:396`, listed in the render-route set at `:286`), checks `?token=` against `VITE_CHART_RENDER_TOKEN`, sets `window.__panelReady` for the screenshotter, and renders `#panel-export`. It composes a compact "This Week's Earnings" panel — notable names per day by market cap, `PER_SESSION = 4` per BMO/AMC, with logos from `/api/ticker-logo`. `from=today` (the newsletter default) drops past days and extends into next week, because *"a Friday letter shows Fri + Mon + Tue, not the Wed/Thu that already reported."* Width is clamped 560–1200 px; days clamped 2–7.

Its consumer is **morning-wire**, not the chart-renderer service: `morning-wire/substack/panelshot.py:43` navigates a headless browser to `DASHBOARD_URL/r/calendar` with `{w: 900, from: 'today', days: 5}`. **No reference to `/r/calendar` or to the calendar was found anywhere under `services/chart_renderer/`.**

**The Discord week post.** `api/services/calendar_week_poster.py` renders `/api/calendar/week-earnings.png` and `/week-econ.png` and posts both as **one** message with two embeds (UCT gold `0xC9A84C`). Its design rules, stated in-file:
- **Targets are explicit.** `test` resolves to a channel in the UCT Intelligence server, falling back to the admin webhook so a test post needs zero setup; `live` resolves to `#event-calendar` **ONLY** and refuses if unset — *"a live post must never silently land in the admin channel."*
- **It refuses to post a hollow card.** A scheduled job that "succeeds" with an empty calendar is the `incident_wire_dns_outage_silent_success` failure mode; it alerts instead, *"so silence is never mistaken for success."*
- **Dedup on `week_start`** in `$DATA_DIR/calendar_week_posts.json`, so a pod restart or double-fire cannot double-post.
- **Never raises into the scheduler.**

A third PNG, `/api/calendar/most-anticipated.png` (`api/services/calendar_anticipated_png.py`, 1200×630 OG size), is described in-file as *"a top-of-funnel virality asset — a trader screenshots 'the week ahead' and it carries the UCT mark."* Zero LLM, zero external calls at render time (logos come from the on-disk cache with a monogram fallback); deterministic — same inputs, same bytes.

**CONFIDENCE.** 🟢 for the wiring; 🔴 for whether the Saturday post fires (flag default 0).

### 6.5 Discord bot — no calendar command

**OBSERVATION.** `C:\Users\Patrick\uct_intelligence` (the Discord bot; not a git repo) has **no slash command that reads `/api/calendar/*`**. `grep -n 'calendar' bot/commands.py` returns only two `@app_commands.describe` help strings that happen to contain the word "earnings" (`:56`, `:131`). The bot's RAG brain has its **own** catalyst-calendar path: `brain/retrieval.py:390-392` calls `uct_engine.get_catalyst_calendar_context(tickers[:5], days_ahead=7)` — an engine-side function, not the dashboard API.

**INTERPRETATION.** The Discord surface's earnings awareness is a **parallel implementation** living in the intelligence engine, entirely separate from TERMINAL-CURRENT. The only Discord traffic the calendar itself generates is outbound: the Saturday week post (§6.4) and the alert deliveries (§1.8).

**RELEVANCE TO UCT.** There is already a second, unreconciled answer to "when does X report" living in the bot. If TERMINAL-NEXT is meant to be *the* authority on the event calendar, that duplication is a decision waiting to be made — and it is the repo's most-recorded defect class (a second authority over one value).

**CONFIDENCE.** 🟢 — grep across `bot/`, `brain/`, `ingestion/`, `memory/`.

**OPEN QUESTION.** Does `get_catalyst_calendar_context` agree with `/api/calendar` on dates and sessions? Not answerable without running the engine.

---

## 7. Member workflows

> Everything in this section is **inference from code, comments, tests and owner decisions recorded in-repo**. No usage telemetry was read. Marked 🟡 unless otherwise noted.

**W1 — "Which of my names report this week?"** 🟡
Land on `/calendar` → the persisted view. In `table` view, `TodaysBrief` leads with **YOUR REPORTS** (your names printing today/tomorrow, badged POSITION / WATCHLIST / UCT20 — badges the file claims "no competitor shows live"), **REPORTED** (your verdicts since yesterday's close) and **MACRO TODAY**. In `board`, the reader instead scopes with the **My Stocks** audience chip. The day tabs carry a "mine" count alongside the total. `sourceBadge` ranks a broker POSITION above a watch and gives it the gold treatment.
*Evidence:* `TodaysBrief.jsx:1-6` — "the retention moat: a five-second personal answer pinned atop the Board"; a pure client-side join over data the page already has, zero new endpoints.
**Scope used:** `mine`, or the default `all` with `sort: 'mine'`, which pins owned names first without hiding the market.

**W2 — "What does the earnings modal give me before the print?"** 🟡
Click a ticker → **Setup** (is there a trade into this print?) → **The Print → Earnings History** (4-quarter beat dots; `hist_stats` = average absolute post-earnings move, up-count, total, and the last 8 individual moves newest-first) → **Brief** (the pre-generated AI preview, warmed by job 3 so it is instant rather than a 25–40 s cold wait) → **Coverage → The Street** (consensus, price targets, rating changes). The card itself already carries the **expected move** (`±X.X%`) and beat dots before any click.
*Evidence:* `railSections.js:56-62` states the group semantics verbatim; `earnings_preview_warm` exists specifically to remove the cold wait.

**W3 — "What just printed?"** 🟡
The **Wire** view, ordered by **arrival time, never by move** — a row's position is its arrival time and never changes, so a name being read cannot jump. Significance drives visual **weight** instead: `loud` at ≥ 8 %, `mid` at ≥ 4 %, `quiet` below. Above the rows, a trust line states one of three honest things: **complete** ("all N reported names are on the feed") · **incomplete WITH THE NAMES** ("N reported names not shown yet: …", capped at 8 + "+N more") · **unmeasured** ("Completeness unverified — the provider check is unavailable right now"), which renders as unknown and never as clean.
*Evidence:* `WireView.jsx:5-9`, `:41-82`. **This is the workflow the production render caught in progress** (PANW reported, not yet on the feed).

**W4 — "Prepare the week."** 🟡
Saturday or Sunday: open `/calendar`; the anchor rolls forward to the upcoming week **by design**; Board for shape, Table for numbers. Job 3 warms previews **every** day precisely because this happens at the weekend (the recorded symptom, 2026-08-23).

**W5 — "Follow one company through its cycle."** 🟡
`/calendar?earnings=SYM&esection=history` — a durable, shareable URL. Arrow-step across the day's other reporters without leaving the modal. Export a single report into a calendar app via `/api/calendar/report.ics`.

**W6 — "Subscribe my real calendar."** 🟡
Header → ICS. `scope=mine` with the stable HMAC token yields a `webcal://` URL that keeps working indefinitely in Google or Apple Calendar; `scope=all` needs no token.

**W7 — "The week post."** (owner / publishing) 🟢 for mechanism, 🟡 for cadence
Saturday 04:30 ET the poster renders both PNG cards and drops one message into `#event-calendar`. The same card family is the top-of-funnel screenshot asset. `POST /api/calendar/post-week?target=test` is the admin dry-run; `force=1` bypasses the once-per-week dedup.

**W8 — "The newsletter panel."** 🟢
Morning Wire's Substack build screenshots `/r/calendar` for the "This Week's Earnings" panel, `from=today`, 5 days.

**W9 — "My unread queue."** 🟡
`/calendar/mystocks` — five tabs (Earnings · News · Calls · Filings · Insights) scoped to the My-Stocks set, each with an unseen-count badge backed by `calendar_seen`; opening an item marks it seen. Mobile stacks rather than scrolling horizontally.

**RELEVANCE TO UCT.** W1, W3 and W9 are **retention** workflows (a reason to return daily); W2 and W5 are **depth** workflows (a reason to pay); W7 and W8 are **acquisition** workflows (the surface producing shareable artifacts). A parity matrix organised by workflow rather than by widget reads very differently from one organised by screen.

**CONFIDENCE.** 🟡 overall — inference. **EVIDENCE CEILING:** `page_views` in auth.db, `calendar_seen` row counts by `item_type`, and `calendar_alerts_fired` row counts would each convert a 🟡 into a measurement. All are production data and out of scope here.

---

## 8. Tests

**OBSERVATION.** Coverage is unusually deep on the backend data path and unusually thin on the *composition* of the page.

### 8.1 Backend — 28 files named `test_calendar_*`, plus 24 `test_earnings*` (62 files match `calendar|earnings`)

| File | What it pins |
|---|---|
| `test_calendar_week_anchor.py` | ⭐ executes BOTH the Python and the JS anchor and compares them on every day of the week |
| `test_calendar_paging.py` | `?week=` snapping, the ±52-week horizon, `out_of_range` / `error` shapes, `is_current_week` |
| `test_calendar_live.py` | the EW + Finviz live build |
| `test_calendar_past_day_backfill.py` | past days of the current week keep their reporters |
| `test_calendar_past_week_sessions.py` | finished-week session buckets |
| `test_calendar_today_supplement.py` | `_supplement_live_days` add-only precedence |
| `test_calendar_forward_week_coverage.py` | ⛔ **one placement per symbol per week** |
| `test_calendar_finviz_sessions.py` | the `v=152&c=0,1,68` custom-view leg |
| `test_calendar_actuals_patch.py` | field-by-field pending (EPS and revenue independently) |
| `test_calendar_enrichment.py` · `_batch.py` · `_throttle.py` · `_warmer.py` | the overlay, its batch endpoint, its 2-wide semaphore, its warm loop |
| `test_calendar_cache_policy.py` | `set_by_completeness` — a bad build never wins the cache |
| `test_calendar_load_latency.py` | the serve-stale contract (a cold rebuild never lands on a user) |
| `test_calendar_month.py` | month assembled from per-week fetches (the Finnhub 1,500-row cap) |
| `test_calendar_econ_sources.py` | ForexFactory curation and the Fed terms |
| `test_calendar_date_integrity.py` | the drift store |
| `test_calendar_day_metrics_avg_vol.py` · `_batch.py` | metrics shape and batching |
| `test_calendar_personalization.py` | the four My-Stocks sources, each independently fallible |
| `test_calendar_seen.py` | read / unseen |
| `test_calendar_alerts.py` | dedup and delivery |
| `test_calendar_ics.py` | VCALENDAR shape, token round-trip |
| `test_calendar_sector_read.py` | grounding and the status machine |
| `test_calendar_anticipated_png.py` · `_week_post.py` · `_week_schedule.py` | the PNG + Discord arm |
| `test_earnings_router_stays_unmounted.py` | ⭐ asserts `api/earnings_router.py` is **NOT** mounted (see §10.2) |
| `test_earnings_table*.py`, `_history_fmp.py`, `_growth_fmp.py`, `_estimates_*.py`, `_intel_*.py`, `_enrichment_*.py`, `_analysis*.py`, `_audio.py`, `_json_salvage.py` | the estimate / history / intel / transcript providers |

### 8.2 Frontend — the page and the modal

Page: `weekAnchor.test.js` (the JS half of the mirrored anchor) · `Calendar.weekNav.test.jsx` · `Calendar.deepLinkWeek.test.jsx` · `Calendar.earningsRoute.test.jsx` · `Calendar.realModal.test.jsx` (mounts the **real** modal, not a stub) · `CalendarHeader.test.jsx` · `CalendarDayTable.test.jsx` · `filterLogic.test.js` · `importance.test.js` · `rankOrder.test.js` · `monthGrid.test.js` · `earningsLifecycle.test.js` · `earningsModalRow.test.js` · `useCalendarData.test.js` · `useEarningsModalRoute.test.jsx` · `EarningsCard.test.jsx` · `eventCard.test.jsx` · `todaysBrief.test.jsx` · `impliedMoveReason.test.jsx` · `refusalLastHops.test.jsx` · `WireView.test.jsx` · `WireView.coverage.test.jsx` · `WeekView.rankWire.test.jsx` · `myStocksHub.test.jsx` + `.stepping` + `.crashRecovery` · `callRecap.test.jsx` · `CalendarWidget.weekIntent.test.jsx` (the AST rail on the two anchors) · `AuthGuard.calendarDeepLink.test.jsx`.

Modal: `EarningsResearchModal.test.jsx` · `.tapFloor.test.js` · `.themeIsland.test.js` · one test per section (`SetupSection`, `EarningsHistorySection`, `BriefSection`, `CallSection` ×3, `CatalystsSection`, `NewsSection`, `ProfileSection`, `AskAiSection`, `StatementPanels`, `sectionFetch`) · `railSections`-adjacent (`sectionLeads.test.js`, `askAiSuggestions.test.js`, `earningsHistoryModel.test.js`, `callRecap.test.js`) · ~20 `research-kit` component tests.

Transcript stack: `components/calendar/TranscriptPanel.test.jsx`, `.search.test.jsx`, `transcriptSearch.test.js`, `TranscriptSearchAll.test.jsx`, `KeywordAlerts.test.jsx`.

### 8.3 Untested critical paths (named, not counted)

1. **No end-to-end test that the four views agree on the tier map.** `importance.js` is unit-tested and `WeekView.rankWire.test.jsx` checks the Board wire, but nothing asserts Board / Table / Month agree about the Main Event for one payload — which is the *stated purpose* of the shared tier map.
2. **No test on the Main Event freeze across a metrics-arrival sequence.** The `metricsReady` gate (`Calendar.jsx:527`) fixed a real never-healing freeze; no test drives the `{} → populated` transition it exists for.
3. **No test on the view-preference migration ladder** (`calendar_view_v2` + `calendar_density` → `_v3`). Three key bumps, zero migration tests. A fourth bump would be unguarded.
4. **No test on the `?d=` landing sequencing.** The two-`requestAnimationFrame` + `mySets`-settled ordering (`Calendar.jsx:651-701`) is behaviour-critical and rail-free.
5. **`export.ics?scope=all` is unauthenticated and has no row-bound test.** `_collect_reporters_for_ics` unions the weekly cache with two months of Finnhub with no explicit cap.
6. **No rail asserting the nine consumers' payload assumptions** (§6.1). Five server-side readers do bare `.get()` chains on `calendar_weekly` and would degrade silently.

**RELEVANCE TO UCT.** Gaps 1 and 6 are the two that would bite a TERMINAL-NEXT migration hardest: the first is the invariant the multi-view design rests on; the second is the blast radius.

**CONFIDENCE.** 🟢 for the inventory (directory listings); 🟡 for the "untested" claims — derived from test names and the modules they import, not from coverage instrumentation. **EVIDENCE CEILING:** a coverage run over `app/src/pages/calendar/**` would make gaps 1–4 measurements. The contract does not authorize a suite run.

---

## 9. History

**OBSERVATION.** 224 non-merge commits touch `app/src/pages/Calendar.jsx`, `app/src/pages/calendar/**`, `api/routers/calendar.py` or `app/src/components/calendar/**`.

| Era | Commits | What changed |
|---|---|---|
| **Origin** | `5806a451c` "Add Calendar page — weekly earnings + macro events" | a two-panel table |
| Early corrections | `471bca3d4` refresh endpoint · `d3c8956ba` ET timezone · `cad1d98e4` **"show next week on weekends instead of last week"** | the anchor decision, made once and re-derived ever since |
| Econ honesty | `0c991b836` **"replace AI-hallucinated econ events with ForexFactory live feed"** · `571dedf9f` run curation on the fallback path too | the "never AI" rule enters |
| Multi-source | `267536278` "multi-source earnings pipeline + live reactions" · `0454ce01f` filter bar + modal integration | |
| **Dominant Feed rebuild (2026-06-01/02)** | `2f756b2f6` "wire dominant-feed page (header + views + enrichment overlay + modal)" · `bc1ccbacd` live post-print reaction gap | specs `docs/plans/2026-06-01-calendar-dominant-feed-design.md` + `…-phase2-competitor-design.md` |
| Header / visual passes (2026-06-14) | three specs: header simplification · visual sharpening · week-strip calm | |
| **Flagship redesign (2026-07-09)** | spec `docs/plans/2026-07-09-calendar-flagship-redesign-design.md` | the Board/Table/Month model, the hierarchy, `calendar_view_v3` |
| Performance | `9cfaf3fa8` **"Calendar: stop making a user pay the cold rebuild (6-8s → instant)"** | `ServeStale` |
| Forward-week coverage | `1c2c93016` **"TODAY's roster gains the provider legs — the wire can now see every reporter"** | `_supplement_live_days` |
| **The Wire (2026-07-31)** | `5377f1e5e` "the Wire view, mounted as the first calendar view" → `144dd3d63` self-enforcing completeness (heal-then-alert monitor + on-feed trust line) → `f52cad8a4` / `a19679c17` field-by-field pending | spec `2026-07-31-calendar-earnings-wire-design.md` |
| Discord post (2026-07-30) | spec `2026-07-30-calendar-week-discord-post-design.md` | |
| **Research-modal redesign (2026-08-03)** | spec `2026-08-03-research-calendar-redesign-design.md` | eleven sections → six, then twelve leaves → five groups |
| **Modal rebuild (2026-08-31)** | `6e14e7107` "the app's own chrome, five tabs, and a canvas that leads" → `662467cee` **"fix the light-theme blackout I shipped, and gate the band"** → `4052c61d7` / `510c6d47c` canvases lead with the answer → `6a8c54c73` tab switching no longer jumps to a different company → `ea70b4756` restore the 44 px touch floor and rail it | |
| Touch tier | `f3ab2f4ba` "the touch tier stops at 640px, so tablet had 19 sub-44px targets" · `aab444be4` app-wide across 54 stylesheets · `4ee35585b` "one focus trap, and the duplicate that never ran" | |
| **Display rename (2026-09-01)** | `b958aefb4` "Rename the Calendar surface to 'UCT Terminal'" + `7c8d89581` "finish the accessible/attribute strings the first pass missed"; merged as `88b87a32b` | |

**What the owner asked to keep.** `git show --stat b958aefb4` — **18 files**, every one a label string, a nav entry or its test: `NavBar.jsx`, `NavBar.test.jsx`, `MobileNav.jsx`, `mobile/MoreSheet.jsx` + test, `intro/IntroAnimation.jsx`, `Landing.jsx`, `Settings.jsx`, `Subscribe.jsx`, `calendar/CalendarHeader.jsx` + test, `calendar/MyStocksHub.jsx` + test, `CalendarRender.jsx`, `dashboard/doors.js`, `widgets/registry.js` + test, `screener/reachable.test.js`. **Unchanged:** the route `/calendar`, the door key `calendar`, the widget type key `calendar`, every `/api/calendar/*` path, `icon: 'calendar'`, every filename, every CSS class, and all four preference keys. The follow-up commit's existence confirms the first pass under-swept **display strings** — not plumbing.

**INTERPRETATION.** The surface has been rebuilt from the ground up **twice** (2026-06-01 dominant feed; 2026-07-09 flagship) and its modal once more (2026-08-31) inside about seven months. The rename is the fourth identity change and the only one that touched nothing but labels. Through all of it, `api/routers/calendar.py` grew rather than being replaced.

**RELEVANCE TO UCT.** Two facts for the program. (1) The **rate of redesign is itself evidence**: this surface has never sat still, and every rebuild kept the same backend. The stable asset is the router, not any front end. (2) The rename established a working pattern — *describes function ⇒ common noun; NAMES the surface ⇒ rename* — and proved a display-only rename is achievable at 18 files with zero plumbing risk.

**CONFIDENCE.** 🟢 — `git log` / `git show`, read-only.

---

## 10. Known defects and debt

### 10.1 CLAUDE.md's calendar section is stale in five specific ways (CLAIM vs code)

**OBSERVATION.** `CLAUDE.md:1608` — "### Calendar — Dominant Feed + EarningsHub Competitor (rebuilt 2026-06-01/02)" — is the document's only calendar section, and it describes the **June** surface, not the shipped one.

| CLAUDE.md says | Code says | Evidence |
|---|---|---|
| "**Views:** Feed (default) / Week / Month" | **Wire / Board / Table / Month**, with Board as the default | `CalendarHeader.jsx:256`, `Calendar.jsx:151` |
| "view persisted via `usePreferences('calendar_view')`" | `calendar_view_v3`; `calendar_view` is not read at all | `Calendar.jsx:151`, `:171` |
| "**Alerts:** … APScheduler 7am=today / 6pm=tomorrow" | correct — but the **flag default is 0** and the section does not say so | `main.py:5810` |
| no mention of the **Wire** view or its four routes | four routes in `api/routers/wire.py`; a first-class tab | `wire.py` |
| no mention of `/sector-read`, `most-anticipated.png`, `week-*.png`, `post-week`, `implied-moves`, `day-metrics-batch`, `next-report`, `wire*` | all present | §3 |

The section **is** accurate on: the `EarningsResearchModal` click-through (with its ⚰️ correction), the logo chain, `_backfill_past_days`, the `_PAST_SESSION_CAP=150` vs 40 asymmetry, the `is_past`-beats-`in_current_week` TTL rule, and the LOCKED invariants (enrichment must `return out`; LLM features cost-guarded and cached; AV transcripts lazy-only; never fetch per-card fundamentals).

**INTERPRETATION.** This is the repo's own recorded defect class — *a hand-typed enumeration beside the source that owns it* — instantiated in the section a new engineer reads to learn what the calendar is. Anyone reasoning from `CLAUDE.md` alone is reading a June artifact against a September surface.

**RECOMMENDATION.** Do **not** correct `CLAUDE.md` from this document — that creates the second-authority defect the file itself warns about. Instead treat **this file as the canonical map** and have the program point at it.

**CONFIDENCE.** 🟢 — both sides read directly.

### 10.2 `api/earnings_router.py` — still present, still unmounted

**OBSERVATION.** In D-09's scope and exactly as `CLAUDE.md` describes: the module exists, its own docstring instructs *"Mount in main.py: `app.include_router(earnings_router, prefix='/api/schwab')`"*, and `grep -n earnings_router api/main.py` returns **nothing**.

**EVIDENCE.** `api/earnings_router.py:1-6`; the empty grep; and a standing rail, `tests/test_earnings_router_stays_unmounted.py`.

**INTERPRETATION.** ⛔ **Do not follow that docstring.** It is a Finviz-scraping predecessor; `api/schwab_router.py`'s Yahoo-backed `_fetch_earnings_yf` + `POST /api/schwab/earnings` already serves at the exact prefix it asks for, and FastAPI answers on first match — so mounting it would place a **second authority on earnings dates** and silently shadow one of the two.

**RELEVANCE TO UCT.** A worked example of the pattern this program will meet repeatedly: **an instruction living inside evidence**. The correct response is a test, not a comment.

**CONFIDENCE.** 🟢.

### 10.3 Terminal-relevant performance and correctness debt

| # | Item | Evidence | Severity for TERMINAL-NEXT |
|---|---|---|---|
| 1 | **Cold `/api/calendar` is 4.5–8 s**, and was observed at **8,005 ms** from another page's resource timing, where it sits on that page's critical path | `calendar.py:2069` docstring; `flowLoadPolicy.js:310-318` | high — any replacement inherits the fan-out |
| 2 | **Enrichment cold 17.9 s / warm 0.14 s; week batch 24.8 s / 0.22 s** — a 130× cliff re-armed every 300 s, mitigated only by an ungated daemon thread | `main.py:995-1020` | high |
| 3 | `_ENRICH_EM_POOL` is 4 workers behind a 2-wide semaphore across dates, with a 15 s per-call bound | `calendar.py:3004`, `:3014`, `_bounded_em` | medium — a hard ceiling on expected-move throughput |
| 4 | **`_FED_TERMS` is a hand-typed surname list that goes stale on roster turnover** — it missed Chair Warsh entirely on 2026-08-21, and "Jackson Hole" had to be special-cased | `calendar.py:2244-2252` | medium — a *correctness* bug that presents as an absence, which is the hardest kind to notice |
| 5 | **Five server-side readers consume `calendar_weekly` with no schema assertion** | §6.1 | high for migration |
| 6 | **`is_current_week` says the opposite of what it reports** on weekends — documented at length, deliberately NOT renamed because tests and fixtures name it | `calendar.py:2172-2205`; commit `090851bae` | low–medium — a live trap for any new reader |
| 7 | **~10 % of past Finnhub rows carry no session** → they land in Time TBD | `calendar.py` §3b region | low, provider-inherent |
| 8 | **Three legacy preference keys are read forever** with no sunset | `Calendar.jsx:150-166` | low |
| 9 | **`FwdPeChip` was removed from cards** because per-card `useFundamentals` fired ~60 requests on feed load; the batched replacement was never built | `EarningsCard.jsx:9-11` | low — a known un-shipped feature |
| 10 | **Tablet touch-target debt** — the calendar was a named victim (19 sub-44 px targets); fixed at the modal with a rail, page level unverified here | `f3ab2f4ba`, `ea70b4756` | medium |
| 11 | **`IMPLIED_ENRICHMENT_CUTOVER` defaults OFF** — the refusal layer that kills the 2150 %-class rows may not be live | `calendar.py:3017` | high if off |

**No `TODO` or `FIXME` marker exists** anywhere in `api/routers/calendar.py`, `app/src/pages/calendar/*`, or `EarningsResearchModal.jsx`. The debt is recorded in prose docstrings instead — which is precisely why it is invisible to a grep-based audit and why this section had to be assembled by reading.

**CONFIDENCE.** 🟢 for items sourced to an in-repo measurement; 🔴 for item 11 and the flag-dependent half of item 5 (env state unreadable).

---

## 11. WHAT USERS WOULD LOSE — the legacy parity seed (appendix CDLXII)

> Capability by capability, if `/calendar` disappeared. The three tables separate *vanishes* from *degrades elsewhere* from *breaks something else*. These are **observations of what exists**, not requirements.

### 11.1 Capabilities that vanish entirely (no other surface provides them)

| # | Capability | Where it lives now |
|---|---|---|
| L1 | **A reconciled multi-provider earnings week** — EW ∪ Finnhub ∪ FMP ∪ Finviz, universe-gated, one placement per symbol | `_build_current_week` + `_supplement_live_days` + `_backfill_past_days` |
| L2 | **A past day that keeps its reporters** after the forward schedules roll away from it | `_backfill_past_days`, `_restore_sticky_reporters`, `_merge_sticky_actuals` |
| L3 | **The importance hierarchy** — one Main Event per day, frozen against lazy data arrival, personalized without fabricating importance, shared by three views | `importance.js` + `Calendar.jsx:513-546` |
| L4 | **`TodaysBrief`** — "your names printing today/tomorrow" with POSITION / WATCHLIST / UCT20 badges, plus your verdicts since yesterday's close | `TodaysBrief.jsx` (Table view, current week) |
| L5 | **The Wire** — arrival-ordered live prints with a three-state completeness trust line that names the missing companies | `WireView.jsx` + `api/routers/wire.py` + `api/services/wire/**` |
| L6 | **Date-drift detection** ("Date moved Jul 28 → Aug 4") | `calendar_date_integrity.py` + `DateMovedChip` |
| L7 | **Expected move with typed refusals** — "we could not price this" kept strictly distinct from "we never asked in time" | `implied_move.py` + `expectedMoveOutcome.js` + `cardBits.jsx` |
| L8 | **Sector read** — one grounded AI sentence per GICS sector per week | `calendar_sector_read.py` |
| L9 | **ICS / webcal subscription** with a permanent per-user token | `export.ics` + `export-token` + `report.ics` |
| L10 | **Pre-report alerts** on My-Stocks names across in-app + email + Discord | `calendar_alerts.py` |
| L11 | **Read/unseen state** across six item types | `calendar_seen.py` + `useSeen` |
| L12 | **`/calendar/mystocks`** — five personalized tabs with unseen badges | `MyStocksHub.jsx` |
| L13 | **The week's shareable PNG cards** + the Saturday Discord drop + the OG-size "most anticipated" asset | `calendar_*_png.py`, `calendar_week_poster.py` |
| L14 | **Week-scoped keyboard navigation** (← / → / T / `/`) | `Calendar.jsx:625-650`, `CalendarHeader.jsx:63-73` |
| L15 | **Sector / cap / volume / price / confirmed-only scoping of an earnings week**, with honest hidden counts | `filterLogic.js` + the header |
| L16 | **IPO and dividend/split event overlays** on a market week | `ipo_calendar.py`, `dividends_calendar.py`, `EventCard.jsx` |
| L17 | **Company-name resolution for reporters** via the Finviz name map (cards show a name, not a bare ticker) | `_attach_names`, `_finviz_name_map` |

### 11.2 Capabilities that survive elsewhere but lose their entry point

| # | Capability | Survives at | What is lost |
|---|---|---|---|
| S1 | The **12-panel research modal** | `/research/:sym` (shares panels), `/calendar/mystocks` (mounts the same modal) | its *calendar* context: the day's step-through, the report date, the "before the print" framing |
| S2 | **`?earnings=SYM&esection=`** deep link | `/research/:sym` (the paywall bounce target) | every previously shared link; the section anchor; the week context |
| S3 | **A day's earnings + econ events** | `/charts` **CalendarWidget** (one day, market-wide) | the week; the hierarchy; personalization; the modal step-through |
| S4 | **Earnings dates for a ticker** | chart earnings markers (`EarningsMarkerPopover`), `earnings_table`, Compass voice tools, the Discord bot's own engine path | the calendar as *the* authority; date-drift; session buckets |
| S5 | **Post-print reactions** | Dashboard `CatalystFlow` (today's BMO / yesterday's AMC only) | the whole week; the arrival ordering; the coverage measurement |
| S6 | **Macro / Fed events** | `/charts` CalendarWidget (`full_impact=1`) | curation to Med/High + Fed; the week band under the day |
| S7 | **"The week" summary** | Dashboard `TheWeek.jsx` tile | everything below the headline |

### 11.3 Capabilities that break silently elsewhere (the blast radius)

| # | What breaks | Why |
|---|---|---|
| B1 | **Morning Wire → Substack "This Week's Earnings" panel** | `panelshot.py` screenshots `/r/calendar`, which reads `/api/calendar` |
| B2 | **The notebook `CalendarEmbed`** in every saved note that has one | mounts the real `CalendarWidget` → `/api/calendar` |
| B3 | **Every `/charts` workspace holding a `calendar` widget** | `charts_workspace_layout` stores `type: 'calendar'` |
| B4 | **Awareness Engine rule R5** (earnings-proximity insights) | reads the `calendar_weekly` cache |
| B5 | **The Saturday Discord week post** | `calendar_week_poster` → the PNG routes → the week payload |
| B6 | **The wire coverage monitor's heal step** | forces a current-week build specifically to write `calendar_weekly` |
| B7 | **OptionsFlow's load policy** | seeds its date reasoning from `/api/calendar` |
| B8 | **Dashboard `TheWeek` tile** | `/api/calendar` |

**INTERPRETATION.** Seventeen capabilities vanish outright; seven degrade to a lesser form elsewhere; eight *other* surfaces break. The number that matters for TERMINAL-NEXT is not "one page" — it is **17 + 7 + 8 = 32 distinct things that change** if `/calendar` disappears.

**RELEVANCE TO UCT.** Several entries here (L8 sector read, L13 PNG cards, L16 event overlays, S6 macro) may well be things TERMINAL-NEXT chooses not to carry. The value of the list is that the choice becomes **explicit** rather than an accident of a rewrite's scope.

**CONFIDENCE.** 🟢 for L1–L17 and B1–B8 — each is traced to a named file. 🟡 for the S-column judgements about *how much* is lost; that is a product call, not a measurement.

**RECOMMENDATION.** Carry 11.1–11.3 into the parity matrix as three separate columns — *vanishes* · *degrades* · *breaks elsewhere*. The third column is the one a rewrite plan usually forgets, and it is the one whose failures are silent.

**OPEN QUESTION.** Of L1–L17, which are actually used? Nine of them (L4, L5, L6, L8, L9, L10, L11, L12, L13) have observable usage signals in production data — `calendar_seen` row counts, `calendar_alerts_fired` rows, `.ics` user-agent hits, `calendar_week_posts.json`, sector-read cache rows. None was read here.

---

## GAPS

What this contract's budget did not reach.

1. **`api/routers/calendar.py` was read selectively, not line by line.** 4,078 lines; roughly 1,400 were read in full. Un-read regions: `_from_wire` (`:162`), `_build_live` internals (`:266`), `_merge_finviz_sessions` (`:797`), `_build_range_week` internals (`:1630`), `_past_reactions` (`:2611`), `_curate_econ_events` internals (`:2434`), and the PNG render helpers (`:3846`–`:4078`). Their *contracts* are captured from docstrings and call sites; their *implementations* are not verified.
2. **The 12 modal panels were not individually read.** `railSections.js` and `PANELS` give the inventory; each panel's providers, caches and failure modes — especially the LLM-backed `brief`, `call` and `ai` — are named but not mapped. `api/routers/earnings_intel.py`, `api/services/call_recap.py`, `api/services/av_transcripts.py` and `api/services/earnings_ai_store.py` were not opened.
3. **No mobile measurement.** `tools/mobile_audit.py` was not run (it requires a local backend; the contract forbids one). §1.10 is source-reading only.
4. **No test execution and no coverage instrumentation.** §8.3's "untested" claims are derived from test names and the modules they import.
5. **`api/services/earnings_estimates.py` and `earnings_table.py` were read only at their headers** — enough to establish the TTLs (`_CACHE_TTL` 6 h, `_FRESH_TTL` 900 s, `_INTEL_FAIL_TTL` 600 s, `_MARKERS_CACHE_TTL` 12 h) and `_next_report_date`'s role. Their full FMP / Finnhub / AV precedence is not traced.
6. **`git log` was read as `--oneline` only.** No diff of the dominant-feed or flagship-redesign commits was inspected; §9's era table is built from commit subjects plus the spec filenames in `docs/plans/`.
7. **No production data.** No row counts, no usage telemetry, no alert-fire counts, no `page_views`. Every workflow in §7 is therefore 🟡.
8. **No env-var state.** Six flags govern whether documented behaviour actually happens; none is readable from here.
9. **The `calendar_png_common` / `calendar_week_png` render internals** and `calendar_seen`'s exact query shapes were read only at the header level.

## NOT INSPECTED

Paths, systems and machines out of reach, and why.

| What | Why |
|---|---|
| The production pod, `/api/health`, any production endpoint | Contract: no production calls. The 2026-09-02 render supplied by the contract is the only production artifact used, and it is cited wherever it carries a claim. |
| Railway env vars (`railway variables --json`) | Not granted to D-09 by this contract. This is the single read that would raise the most CLAIMs in §5. |
| Railway logs, `railway status` | Same. This is what would raise every provider in §2 from CODE-REFERENCED to OBSERVED-CALLED. |
| `C:\data` — `auth.db` (`user_preferences`, `calendar_seen`, `page_views`, `watchlists`), `calendar_alerts.db`, `calendar_dates.db`, `catalysts.db`, `education.db` | The production data volume; the contract forbids touching it. It holds the answers to the open questions in §4, §7 and §11. |
| The local backend on port 8077 | Preamble: it serves stale data and must not be probed. |
| The pytest suite | Not authorized by this contract; the repo-root `conftest.py` pins shared-data paths and the full run is ~9,600 tests requiring chunking. |
| `services/chart_renderer/` internals | Grepped for calendar references — none found. Not otherwise read. It is deployed separately with `railway up` from its subdirectory and is not git-connected (CLAIM, from the preamble). |
| `external/morning-wire`, `external/uct-intelligence` submodules | Preamble: may be empty in the worktree. The standalone repos `C:\Users\Patrick\morning-wire` and `C:\Users\Patrick\uct_intelligence` were used instead, read-only, and only for the two targeted greps in §6.4 and §6.5. |
| Partner-owned files (`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`) | `OptionsFlow.jsx:810` and `pages/optionsFlow/flowLoadPolicy.js` were read **only** far enough to establish that they call `/api/calendar` and to record the 8,005 ms measurement (§6.1). Deliberately not described further. |
| Browser rendering of `/calendar` at 390 / 820 / 1200 px | No browser session was run. The standing lesson ("the browser sees what no test can") applies: this map is source-derived, and §1.10 is the weakest section because of it. |
| `docs/superpowers/specs/2026-06-01-*`, `2026-07-09-*`, `2026-08-03-*` and the four 2026-06-14 design docs | Listed in §9 from a directory listing; contents not read. They are the richest remaining source on the *intent* behind the current design and are the obvious next read for whoever inherits this file. |
