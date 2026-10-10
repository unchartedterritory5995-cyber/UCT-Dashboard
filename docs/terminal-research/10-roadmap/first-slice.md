---
id: FIRST-SLICE
title: The first vertical slice of the UCT Terminal, as it was actually delivered
role: Charter Document B §49 gate item 18 ("MVP and first vertical slice specified per Part
  CCXLIII", `10-roadmap/first-slice.md`). Ledger row X-03, roadmap row RM-N16.
as_of: master 11fa16167 (2026-10-10)
status: retrospective. The slice shipped before this file was written, so every field below
  describes what was built and cites it, rather than proposing it.
---

# First vertical slice: the `/terminal` shell, gated behind `TERMINAL_NEXT_ENABLED`

## How to read this file

Part CCXLIII (`00-program-control/charter/C-master-directive.md:2529-2535`) asks for a
specification another session can start building from. The terminal had already shipped when
this file was written (2026-10-10), so it is written after the fact: each field says what the
first slice was, with the commit or `file:line` that shows it. Where something was not measured,
it says "not measured".

The MVP (`10-roadmap/mvp.md`) is a different thing. It is a pre-registered displacement trial
with Ravi (`10-roadmap/2026-09-30-mvp-preregistration-ravi.md`), not a build. The owner waived
that trial on 2026-10-10 (`12-decisions/2026-10-07-owner-delegated-decisions.md:213-221`). The
slice below is the first piece of the terminal that was built end to end.

## The slice in one paragraph

Commit `e5f189c56` (2026-10-02, "feat(terminal): UCT Terminal shell, slice A-F, gated behind
TERMINAL_NEXT_ENABLED") added the `/terminal` route: one command line (`TICKER FUNC [args]`)
driving 1, 2 or 4 linked panels, with the calendar as its first section, phone layout, and its
own test rails. It was gated by the server's cohort list, so it was invisible to members on the
day it landed. It reached master in the X-01 landing `2e304db42` (2026-10-04). The kill switch was
found armed on web and recorded on 2026-10-07 (`4084cd903`), and the nav entry moved to
`/terminal` the same day (`c941080f0`).

## Part CCXLIII fields

### 1. Exact user problem

The owner's rulings of 2026-10-02 asked for a Bloomberg-style shell: one command line driving
linked panels (D-005, `00-program-control/OWNER_DECISIONS.md:18`), with the calendar living inside
it (D-006, `00-program-control/OWNER_DECISIONS.md:19`) and full phone parity (D-007,
`00-program-control/OWNER_DECISIONS.md:20`). Before the slice, a member moved between separate
pages (`/calendar`, `/research/:sym`, `/charts`) and retyped the ticker on each one. The slice let
a member type a ticker and a function once and keep that security across panels.

### 2. Why now

The rulings landed on 2026-10-02 and the slice was committed the same day (`e5f189c56`). The
rollout lever already existed: `TERMINAL_NEXT_ENABLED` and the `terminal-next` cohort were declared
at rung zero on 2026-09-26 with no consumer (`docs/feature_flags.json`, key
`TERMINAL_NEXT_ENABLED`, the "BEFORE THIS CONSUMER" paragraph). The slice was its first consumer.

### 3. Wireframe (as built, desktop)

```
+--------------------------------------------------------------------------+
| [ NVDA GP                                    ]   command line, history ^ |
+-----------+--------------------------------------------------------------+
| Functions | +----------------------------+ +---------------------------+ |
|  CAL      | | Panel 1  (group A)  NVDA   | | Panel 2  (group A)  NVDA  | |
|  DES      | | GP: StockChart             | | DES: research overview    | |
|  GP       | |                            | |                           | |
|  ...      | +----------------------------+ +---------------------------+ |
|  HELP     |  layout: 1 / 2 / 4 panels; link group A-D or N (unlinked)    |
+-----------+--------------------------------------------------------------+
Phone (<=640 px): one panel, command line pinned first, function list in a Sheet.
```

The wireframe is drawn from the commit message's parts B to E (`e5f189c56`). No screenshot of the
slice-day build was kept: not measured.

### 4. Data flow

1. Every authenticated payload (`/api/auth/me`, login, signup) carries `cohorts`, the effective
   list from `rollout_gate.client_cohorts` (`api/routers/auth.py:700`). The kill switch is read
   first, per request (`api/services/rollout_gate.py:141-155`).
2. The client reads that list once, through `useTerminalNext`
   (`app/src/pages/terminal/terminalGate.js`), and never re-derives access from a role, plan or
   preference.
3. Panels read the data the existing pages already read (the research tab components, StockChart,
   the Calendar page component), unforked (`e5f189c56` part C). The slice added no new data
   endpoint.
4. The layout persists in the additions-only preference key `terminal_layout`
   (`app/src/pages/terminal/boardPrefs.js:12`, allow-listed in
   `app/src/lib/persistence/persistenceManifest.json:573`). The link groups A-D read and write the
   `/charts` key `charts_workspace_groups` (`e5f189c56` part C).

### 5. Code flow

`App.jsx` route -> `TerminalRoute` (redirects to `/calendar` when the gate is closed) ->
`TerminalShell.jsx` -> `CommandLine.jsx` -> `parseCommand.js` (pure parser) -> `functions.js`
(the one registry) -> `panels.jsx` (code to component) -> the embedded page component. `/calendar`
goes through `CalendarRoute`, which redirects into `/terminal/calendar` with the query string and
hash kept when the gate is open. All of these files are in `e5f189c56`'s file list.

### 6. API contracts

- No new route. The one server change was the `cohorts` field on the auth payload
  (`api/routers/auth.py` in `e5f189c56`, now `api/routers/auth.py:700`).
- Autocomplete reused `/api/ticker-search` and `/api/address/search` (`e5f189c56` part B).
- Later lanes added the grammar store's `/api/terminal/*` routes behind their own gate
  (`docs/feature_flags.json:144`). They were not part of this slice.

### 7. Schema implications

None on the server. The only new persisted shape was the preference value under
`terminal_layout`, added to the persistence manifest (`e5f189c56`). No table, no migration, and no
existing `calendar_*` key was touched (the coexistence rule CX-2,
`10-roadmap/coexistence.md:243`).

### 8. Component tree

`TerminalRoutes.jsx` (`TerminalRoute`, `CalendarRoute`) -> `TerminalShell.jsx` -> `CommandLine.jsx`
+ function rail + panel grid -> `ChartPanel.jsx`, `HelpPanel.jsx`, `OverviewPanel.jsx` and the
embedded Calendar and research components. The panel set at slice time is in `e5f189c56`'s file
list. The commit message says the registry held 32 codes; `grep -c "code: '"` over `functions.js`
at that commit prints 31. Today the same count prints 85 (`app/src/pages/terminal/functions.js`).

### 9. Telemetry

None was added by the slice. Grammar telemetry (counts per member, never a ticker or typed text)
came later with lane T3 (`docs/feature_flags.json:144`). Usage of the slice itself: not measured.

### 10. Tests

Added in `e5f189c56` (part F):

- `app/src/pages/terminal/functions.rail.test.js`: every panel imported, every door an `App.jsx`
  route, every section a research `SECTION_TO_TAB` key, every flag an `AuthContext` key.
- `app/src/pages/terminal/parseCommand.test.js`: the parser, table-driven.
- `app/src/pages/terminal/TerminalShell.test.jsx`: the gate pair, command line, linking, phone,
  CSS layout.
- `app/src/pages/terminal/parityMatrix.test.js` with the generated
  `10-roadmap/coexistence-parity-matrix.md` (MG-7: 31 rows at slice time, 28 carried, 2 unaffected,
  1 gap, the hub calendar mode). The matrix now reads 37 rows, 34 carried, 2 unaffected, 1 gap
  (`10-roadmap/coexistence-parity-matrix.md:8`).
- `tests/test_terminal_next_flag.py`: the flag ledger entry against the code default.

### 11. Rollout

1. 2026-10-02, `e5f189c56`: built dark on `integrate/terminal-fixes`; flag `pending`, set on no
   service, cohort empty.
2. 2026-10-04, `2e304db42`: on master (the X-01 landing).
3. 2026-10-07, `4084cd903`: `TERMINAL_NEXT_ENABLED=1` found set on web and recorded as `armed`;
   every member enrolled in the cohort (new signups at signup, existing members by a one-time boot
   seed, `api/services/rollout_gate.py:191-229`).
4. 2026-10-07, `c941080f0`: the nav entry graduated to `/terminal`
   (`app/src/components/NavBar.jsx:27`), and `18676e3ec` measured `/terminal` viewport-locked.

### 12. Rollback

Set `TERMINAL_NEXT_ENABLED=0` on web: the shell disappears for everyone on their next
authenticated request, every member is back on `/calendar`, and no tag or preference is touched
(`docs/feature_flags.json`, key `TERMINAL_NEXT_ENABLED`; tier 1 in
`10-roadmap/rollout-rollback.md:690`). The exact commands and the verification steps are in
`docs/runbooks/terminal-rollback.md` on branch `rollback/terminal-next-off` (ledger row RM-X02).

### 13. Acceptance criteria, and whether each was met

| criterion | evidence | met? |
|---|---|---|
| A closed gate never shows a member a 404; it redirects to `/calendar` | `TerminalRoute` at `app/src/pages/terminal/TerminalRoutes.jsx:52`; gate-pair cases at `app/src/pages/terminal/TerminalShell.test.jsx:128` | yes |
| An open gate sends `/calendar` into the shell with the query string and hash kept | `calendarIntoShell` at `app/src/pages/terminal/terminalGate.js:43`; `CalendarRoute` at `app/src/pages/terminal/TerminalRoutes.jsx:27` | yes |
| Every input gets a result or an error with suggestions, never silence | `app/src/pages/terminal/parseCommand.js:26` | yes |
| Panels on one link group follow one security | linking cases in `TerminalShell.test.jsx`; list rows joined later in `523bf837b` | yes |
| The phone shell is usable | slice: one panel, command line first; the panel switcher came later (`67d0c1936`, P14a) | partly at slice time, completed later |
| Every must-carry `/calendar` behaviour is carried, replaced or retired (MG-7) | `10-roadmap/coexistence-parity-matrix.md:8`: one gap, the hub calendar mode, hub-owned | yes, with one named gap |
| The five terminal-grade properties re-walked on `/terminal` | ledger rows X-11 and V22 | not measured |
