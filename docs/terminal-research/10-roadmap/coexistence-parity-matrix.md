# Coexistence parity matrix — `/calendar` (TERMINAL-CURRENT) carried into the UCT Terminal shell

> ⛔ **GENERATED. Do not hand-edit.** `node tools/terminal_parity_matrix.mjs` writes it from
> `app/src/pages/terminal/parityMatrix.js`, which DERIVES every row from `app/src/pages/Calendar.jsx`
> (imports, `setPref` keys, URL params) and from the route table. `parityMatrix.test.js` fails when
> this file and the derivation disagree, or when a row is GAP without a named owner (MG-7).

**Rows: 31 · CARRIED 28 · UNAFFECTED 2 · GAP 1.**

Vocabulary (coexistence.md §3.1, inward): **CARRIED** = a member can do this inside the shell, so the
old page is not needed for it. **UNAFFECTED** = not part of the `/calendar` page; the shell changes
nothing about it. **GAP** = a member must leave the shell for it; each GAP names who closes it.

## The facts every verdict is computed from

| fact | holds |
|---|---|
| `embedsSameModule` | yes |
| `routed` | yes |
| `redirectKeepsSearch` | yes |
| `calendarRouteKept` | yes |
| `authGuardExact` | yes |
| `mystocksRoute` | yes |
| `renderRoute` | yes |
| `dashboardDoor` | yes |

## The matrix

| # | group | capability | verdict | by |
|---|---|---|---|---|
| 1 | Page module | EarningsResearchModal (../components/research/EarningsResearchModal) | **CARRIED** | embedsSameModule |
| 2 | Page module | useEarningsModalRoute (./calendar/useEarningsModalRoute) | **CARRIED** | embedsSameModule |
| 3 | Page module | useCalendar (./calendar/useCalendarData) | **CARRIED** | embedsSameModule |
| 4 | Page module | useCalendarMySets (./calendar/useCalendarData) | **CARRIED** | embedsSameModule |
| 5 | Page module | useWeekEnrichment (./calendar/useCalendarData) | **CARRIED** | embedsSameModule |
| 6 | Page module | useWeekMetrics (./calendar/useCalendarData) | **CARRIED** | embedsSameModule |
| 7 | Page module | useIpos (./calendar/useCalendarData) | **CARRIED** | embedsSameModule |
| 8 | Page module | useDividends (./calendar/useCalendarData) | **CARRIED** | embedsSameModule |
| 9 | Page module | CalendarHeader (./calendar/CalendarHeader) | **CARRIED** | embedsSameModule |
| 10 | Page module | useCalendarHubSection (../hub/sections/calendarSection) | **CARRIED** | embedsSameModule — the hub SECTION mounts with the page; the hub MODE is a separate adjacent row |
| 11 | Page module | FeedView (./calendar/FeedView) | **CARRIED** | embedsSameModule |
| 12 | Page module | WireView (./calendar/WireView) | **CARRIED** | embedsSameModule |
| 13 | Page module | useWireProbe (./calendar/useWire) | **CARRIED** | embedsSameModule |
| 14 | Page module | TodaysBrief (./calendar/TodaysBrief) | **CARRIED** | embedsSameModule |
| 15 | Page module | WeekView (./calendar/WeekView) | **CARRIED** | embedsSameModule |
| 16 | Page module | MonthView (./calendar/MonthView) | **CARRIED** | embedsSameModule |
| 17 | Page module | DayDetailDrawer (./calendar/DayDetailDrawer) | **CARRIED** | embedsSameModule |
| 18 | Persisted key | `calendar_view_v3` (setPref) | **CARRIED** | embedsSameModule — same key, same writer, no rename (MG-4: no shim needed) |
| 19 | Persisted key | `calendar_filters_v2` (setPref) | **CARRIED** | embedsSameModule — same key, same writer, no rename (MG-4: no shim needed) |
| 20 | Persisted key | `calendar_mystocks_sources` (setPref) | **CARRIED** | embedsSameModule — same key, same writer, no rename (MG-4: no shim needed) |
| 21 | Persisted key | `calendar_event_types_v2` (setPref) | **CARRIED** | embedsSameModule — same key, same writer, no rename (MG-4: no shim needed) |
| 22 | URL contract | `?d=` | **CARRIED** | redirectKeepsSearch + routed (ROUTED_PATHS has /terminal/calendar) |
| 23 | URL contract | `?earnings=` | **CARRIED** | redirectKeepsSearch + routed (ROUTED_PATHS has /terminal/calendar) |
| 24 | URL contract | `?esection=` | **CARRIED** | redirectKeepsSearch + routed (ROUTED_PATHS has /terminal/calendar) |
| 25 | URL contract | `?week=` | **CARRIED** | redirectKeepsSearch + routed (ROUTED_PATHS has /terminal/calendar) |
| 26 | Adjacent | `/calendar` still answers (bookmarks, nav entry, hub, voice) | **CARRIED** | `<Route path="/calendar">` kept: the page, or a redirect into the shell — never 404 |
| 27 | Adjacent | Free-tier `/calendar?earnings=SYM` -> `/research/SYM` (row E2) | **CARRIED** | AuthGuard matches `/calendar` exactly BEFORE the route element renders |
| 28 | Adjacent | `/calendar/mystocks` hub (row D1, DEAD/retire-candidate) | **UNAFFECTED** | its own route, untouched |
| 29 | Adjacent | `/r/calendar` screenshot contract (row D4) | **UNAFFECTED** | headless route, not inside the shell |
| 30 | Adjacent | Zone D "On deck" door key `calendar` -> `/calendar` (row D6) | **CARRIED** | `/calendar` link still resolves (redirect for cohort members) |
| 31 | Adjacent | Joystick hub `calendar` mode (row D9) | **GAP** | Joystick hub `calendar` mode is route-bound to `/calendar` (hub/registry.js). A cohort member is redirected to `/terminal/calendar`, so the hub does not resolve its calendar mode there. Needs a `/terminal` mode or route alias in `app/src/hub/**` — OUT OF THIS LANE (brief: STOP and report). |

## What this matrix is not

* It is not coexistence.md §3.4. That is the programme's hand-curated ledger of the same surface;
  this is its code-derived complement, at the page's import boundary. Rows inside an embedded module
  (MacroBand inside WeekView, the modal's sections C2–C11) are carried transitively by the same import.
* Server-side rows (enrichment warm cadence E5/E7, iCal D7, alerts D8, `/r/calendar-week.png` D5) do not
  depend on which client route renders the page, so the shell neither carries nor breaks them.
