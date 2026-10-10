---
id: MASTER-PLAN
title: UCT TERMINAL — INSTITUTIONAL PRODUCT & ENGINEERING MASTER PLAN
role: Charter Document B §49 gate item 24 ("Master plan assembled per Part CC",
  `13-executive-synthesis/MASTER_PLAN.md`). Ledger row X-04, roadmap row RM-N17. The input to the
  readiness test (gate item 26, `00-program-control/readiness-test.md`).
as_of: master 11fa16167 (2026-10-10)
status: assembled 2026-10-10 by lane f-l1, after the terminal shipped. It summarises and points; the
  per-item authority is `COMPLETION-LEDGER.md`, and the rulings' authority is
  `00-program-control/OWNER_DECISIONS.md` plus `12-decisions/`.
---

# UCT TERMINAL — INSTITUTIONAL PRODUCT & ENGINEERING MASTER PLAN

## How to read this file

- Part CC (`docs/terminal-research/00-program-control/charter/C-master-directive.md:2207-2258`)
  names 42 sections and asks that each open with a five-line summary. They are below, in order.
- **Citation rule (R-CITE).** Every measured fact cites a `file:line` or a commit. A fact nobody
  measured says "not measured". Paths in backticks are from the repository root unless they start
  with a programme folder such as `10-roadmap/`, which is under `docs/terminal-research/`.
  `python tools/doc_citation_resolver.py <file>` checks that every `file:line` here resolves.
- **Most research predates the build.** The research waves ran 2026-09-02 to 2026-09-30. The
  terminal was built 2026-10-02 to 2026-10-10. Where the two disagree, the code and the ledger win,
  and the section says so.
- Two parts were added beyond Part CC because the charter requires them for this file: **Part A,
  the owner rulings D-005..D-014 and later**, and **Part B, the completion ledger state**. A third,
  **Part C, starting a work package**, is the practical brief for an implementing session.

## Part A. Owner rulings in force

### A.1 The 2026-10-02 rulings, D-005..D-014

All ten were given by the owner directly on 2026-10-02 and are recorded in
`docs/terminal-research/00-program-control/OWNER_DECISIONS.md:18-27` (DL-026..DL-035).

| id | ruling, in plain words | what it changed | cite |
|---|---|---|---|
| D-005 | The UCT Terminal is a Bloomberg-style shell: one command line (`TICKER FUNC [args]`) driving linked panels. | Built as `/terminal` (`e5f189c56`). | `docs/terminal-research/00-program-control/OWNER_DECISIONS.md:18` |
| D-006 | The calendar is a section inside the terminal (CAL), not a separate product. | CAL is a rail section (`app/src/pages/terminal/functions.js:39`). Retire-or-keep `/calendar` was decided later as keep (P-9). | `docs/terminal-research/00-program-control/OWNER_DECISIONS.md:19` |
| D-007 | Full phone parity: the phone operates the terminal, not only monitors it. | Retracts non-goal NG-10. Phone panel switcher built (`67d0c1936`). | `docs/terminal-research/00-program-control/OWNER_DECISIONS.md:20` |
| D-008 | Data gaps: "everything we can possibly get". | Retracts NG-15 as a scope line. A row that needs a purchase stays owner-blocked on that purchase. | `docs/terminal-research/00-program-control/OWNER_DECISIONS.md:21` |
| D-009 | Ship each surface when its own rails and gates are green (standing go). | No per-surface ask; each ship still needs its gates and a member-impact line. | `docs/terminal-research/00-program-control/OWNER_DECISIONS.md:22` |
| D-010 | Everything is paywalled; there are no free member pages. | `FREE_PAGES = []` (`app/src/constants/freePages.js:21`). | `docs/terminal-research/00-program-control/OWNER_DECISIONS.md:23` |
| D-011 | Licensing is settled for the current estate. | Closes D-002; a new data source still gets its own terms read (ADR-0015). | `docs/terminal-research/00-program-control/OWNER_DECISIONS.md:24` |
| D-012 | Build mobile push (BRK-04). | Built dark behind `WEB_PUSH_ENABLED`. | `docs/terminal-research/00-program-control/OWNER_DECISIONS.md:25` |
| D-013 | Agent cap 6 for this programme's build lanes. | Conflicts with `CLAUDE.md`'s cap of 3; recorded, not resolved (ledger X-10). | `docs/terminal-research/00-program-control/OWNER_DECISIONS.md:26` |
| D-014 | Engine-file changes and dead bot code deletion are the building agent's call. | The mechanics (backup, parity test, unmount before delete) still apply. | `docs/terminal-research/00-program-control/OWNER_DECISIONS.md:27` |

### A.2 Later rulings

- **2026-10-07, delegated.** The owner delegated every remaining terminal decision ("decide it all;
  make it complete, live-ready, world class"), and lane `tf9-decide` decided them:
  `docs/terminal-research/12-decisions/2026-10-07-owner-delegated-decisions.md:3-4`. It closed D-001
  as members first (P-1) and D-003 as one decisive shape with its receipt (P-2), and made `/calendar`
  a permanent URL (P-9) (`docs/terminal-research/12-decisions/2026-10-07-owner-delegated-decisions.md:71-79`).
- **2026-10-08, owner answers.** Bullflow, Unusual Whales and TheFly are not paid; one subscription
  is one person, enforced in code with a two-device limit; no new ops channel
  (`docs/terminal-research/12-decisions/2026-10-07-owner-delegated-decisions.md:186-205`).
- **2026-10-10, owner ruling.** "no need to wait for ravi on anything we can proceed fully with all
  of those": the Ravi MVP trial is waived and ledger row X-14 is moot
  (`docs/terminal-research/12-decisions/2026-10-07-owner-delegated-decisions.md:213-221`).

## Part B. Completion ledger state

`docs/terminal-research/COMPLETION-LEDGER.md` is the single "is the vision complete" checklist: one
row per item, one state per row (`live`, `dark`, `building`, `owner-blocked`, `moot`). Its counts are
derived by the command in its §0, never typed.

- **The answer today: not complete.** It is complete when every row is `live` or `moot`.
- **Counts after this lane's edits** (the §0 command, run 2026-10-10 on branch f-l1):
  `279 Counter({'live': 177, 'building': 41, 'moot': 40, 'dark': 13, 'owner-blocked': 8})`, 0 duplicate ids. So 217 of 279 rows are `live` or `moot` and 62 are not (`docs/terminal-research/COMPLETION-LEDGER.md` §0).
- Before this lane (the same command, master `11fa16167`): 279 rows, 174 live, 44 building, 39 moot,
  13 dark, 9 owner-blocked (`docs/terminal-research/COMPLETION-LEDGER.md:40` as committed there).
- What only the owner can do is grouped in the ledger's §8
  (`docs/terminal-research/COMPLETION-LEDGER.md:378`).
- What shipped in the final push (waves 5-9, 2026-10-08 to 10-10), with live verification, is in
  `docs/terminal-research/13-executive-synthesis/2026-10-10-terminal-delivery-record.md`.

## Part C. Starting a work package (for an implementing session)

- **Repository.** One repo, `uct-dashboard`: React + Vite SPA in `app/`, FastAPI in `api/`
  (`CLAUDE.md:28-29`). Seven Railway services (`CLAUDE.md:30`). Terminal code is
  `app/src/pages/terminal/`; its rollout gate is `api/services/rollout_gate.py`. Sister repos
  `morning-wire` and `uct-intelligence` are mirrored under `external/` and are not touched by
  terminal work unless a ticket says so.
- **Picking the package.** `10-roadmap/backlog.md` holds the tickets in the Part CCI schema. The
  register lists them in band order (`docs/terminal-research/10-roadmap/backlog.md:317-321`), and
  TERM-001 is the first. Before planning a ticket, read its ledger row: many are already `live`
  (TERM-001 is, `docs/terminal-research/COMPLETION-LEDGER.md:104`), and the remainder is what the
  row's note names. Open rows are the `building` and `dark` ones.
- **TERM-001 specifically (the board-size bound).** Built and on master. One authority,
  `app/src/pages/charts/boardBound.json`, read by `app/src/pages/charts/boardBound.js:21`
  (`MAX_BOARD_WIDGETS`, 16) and by the server check `api/services/board_bound.py`. The decision
  record is `docs/terminal-research/12-decisions/2026-10-02-term-001-006-board-bound-and-freshness.md`,
  re-affirmed as T-1 (`docs/terminal-research/12-decisions/2026-10-07-owner-delegated-decisions.md:46`).
  Work left on it: none in the ledger; saved-layout sizes were never measured (backlog note on the
  TERM-001 row).
- **TERM-001 facts an implementer needs** (added after readiness run 1, which asked for them):
  - *Merge.* Built in `e509700b2` (2026-10-02) on `lane/term-001-006`, merged into
    `integrate/terminal-fixes` by `daf658088`, and on master through the X-01 landing `2e304db42`
    (`git merge-base --is-ancestor e509700b2 origin/master` succeeds). The backlog register cell
    that still says "not merged" predates the landing.
  - *Acceptance criteria.* Band 0 has no Part CCI package. The agreed behaviour is the decision
    record's "Decision" and "Where it is enforced" paragraphs
    (`docs/terminal-research/12-decisions/2026-10-02-term-001-006-board-bound-and-freshness.md:11-58`):
    grow refused past 16 with the bound's sentence; an over-16 board is never truncated, stays
    editable, cannot grow; an over-16 write cannot replace a stored board of unknown size.
  - *Existing tests.* `tests/test_board_bound.py` (server), `app/src/pages/charts/boardBound.test.js`
    and `app/src/pages/charts/ChartsWorkspace.test.jsx` (client). Extend these; do not add a
    second copy of the rule.
  - *Scope of the server check.* It guards only the `/charts` key `charts_workspace_layout`
    (`api/services/board_bound.py:31`), through `auth.enforce_board_bound` on
    `POST /api/auth/preferences` (`api/routers/auth.py:3022`) and `POST /api/workspace/doc/apply` (`api/routers/workspace_doc.py:37`, `api/routers/workspace_doc.py:160-177`). The terminal's own
    `terminal_layout` / `terminal_boards` keys have separate caps in
    `app/src/pages/terminal/boardModel.js:41-46` and are not TERM-001's bound.
  - *Remaining item 1, saved-layout sizes.* Never measured. The census is the PH-1 aggregate over
    `charts_layouts.layout_json`, read-only, against a copy
    (`docs/terminal-research/12-decisions/2026-10-02-term-001-006-board-bound-and-freshness.md:32-35`).
    Agents do not read production stores; the owner or the integrator takes the copy
    (`VACUUM INTO` over `railway ssh`) and the agent runs the aggregate on it.
  - *Remaining item 2, "its own panel curve".* The backlog names it
    (`docs/terminal-research/10-roadmap/backlog.md:1998`) but no file defines it. The bound was
    decided without it, on the 16-cell production spike
    (`docs/terminal-research/12-decisions/2026-10-02-term-001-006-board-bound-and-freshness.md:21-29`),
    so it is optional evidence, not a blocker. If taken, it is cost against widget count 1..16 in
    the 2026-10-14 quiet window, recorded with `deployments_sampled`.
  - *Push window.* `python tools/flow_worker_watch_coverage.py` reports whether a diff reaches
    flow-worker. `api/services/**` is not on flow-worker's watch list, so a `board_bound.py`
    change deploys web only.
  - *(Added after readiness run 2.)* *The apply route* is `POST /api/workspace/doc/apply` (with a
    slash): the router prefix is `/api/workspace/doc` (`api/routers/workspace_doc.py:37`) and the
    handler is `@router.post("/apply")`, which calls `enforce_board_bound`
    (`api/routers/workspace_doc.py:160-177`). The hyphenated spelling in the 2026-10-02 decision
    record and in a docstring at `api/routers/auth.py:2988` is a typo for the same route.
  - *Schema and counting rule.* Table `charts_layouts` in `/data/charts_layouts.db`, one row per
    saved layout: `scope` (`global` for admin prebuilts, `user` for a member's own), `user_id`,
    `name`, `layout_json` = `{widgets: [...], cols: N}` (`api/services/charts_layout_service.py:36-48`).
    A widget is one element of `layout_json.widgets`, counted exactly as the server counts it,
    `board_bound.widget_count` (`api/services/board_bound.py:58-69`); reuse that function, never a
    second rule. Rows whose `layout_json.kind` is `multichart` are Multi-Chart grids, not boards
    (`app/src/pages/charts/grid/MultiChartMenu.jsx:42-43`); they store `widgets: []` and are
    excluded. Report `global` and `user` rows separately.
  - *Census tool.* None exists to reuse: the PH-1 figure (17 boards, max 5) was a one-off
    read-only aggregate over `user_preferences`
    (`docs/terminal-research/12-decisions/2026-10-02-term-001-006-board-bound-and-freshness.md:20`).
    Write a small read-only script that imports `board_bound.widget_count` and prints n, the
    histogram, max, count over 16 and count unreadable, with a totals line.
  - *How the copy is handled.* The copy never leaves the pod. The owner or integrator runs, over
    `railway ssh` on web with `/opt/venv/bin/python`: `VACUUM INTO
    '/data/backups/charts_layouts-<date>.db'` against the live file, then the script against that
    copy opened as `file:...?mode=ro`, and pastes back only the printed aggregate (no names, no
    layout bodies). The printed copy path and `mode=ro` in the output are the proof it was the copy.
  - *Opening a saved layout over 16.* Refused, in words, only when it would grow a smaller board:
    `applyTemplate` calls `boardMayBecome` and shows the layout refusal sentence
    (`app/src/pages/charts/ChartsWorkspace.jsx:2030-2037`, rule at
    `app/src/pages/charts/boardBound.js:36-39`), and the server refuses the same write. The saved
    layout stays in its store, untouched. So a census row over 16 means "a layout that can be
    opened only onto a board at least that large", not lost data.
  - *Settings Limits card.* It does not publish the board bound today: its list holds only
    `MAX_COMPARISONS` and `MAX_CHART_TEMPLATES` (`app/src/lib/persistence/personalization.js:17`,
    `app/src/lib/persistence/personalization.js:22-44`). Adding `MAX_BOARD_WIDGETS` there is a
    TERM-052 follow-up, imported from `boardBound.js` per that file's own rule; it is not a
    TERM-001 blocker.
  - *Panel-curve instrument (optional item).* The 16-cell figure came from the admin-only
    `?gridspike=N` harness on `/charts` grid mode (`app/src/pages/charts/grid/gridSpike.js:1-20`,
    wired at `app/src/pages/charts/grid/MultiChartGrid.jsx:46-50`). It prints one
    `[gridspike:done] {json}` line with `allFramedMs`, per-cell median and p95, heap and idle long
    tasks; the 2026-09-26 run is
    `docs/terminal-research/10-roadmap/evidence/2026-09-26-protocol-c-and-gridspike/results.md:29`.
    A curve is that harness at N = 1..16 in a visible tab inside the quiet window.
  - *(Added after readiness run 3.)* *The sentences, verbatim.* All three live only in
    `app/src/pages/charts/boardBound.json:3-5`, with `{max}` and `{count}` placeholders filled by
    `boardBound.js` (client) and `board_bound.refusal_sentence` (server):
    refusal "A board holds at most {max} widgets, and this one would hold {count}. Close a widget
    before adding another."; layout refusal "That layout holds {count} widgets, more than the {max}
    a board can hold, so it was not opened. It is still saved exactly as it was."; over-bound
    "This board holds {count} widgets, more than the {max} a board can hold. Nothing was removed:
    it stays as it is, and it can take a new widget once you close enough to bring it under {max}."
    Tests assert the filled sentence by importing the template, never by retyping it.
  - *Which store the census covers.* Only `charts_layouts` (named saved layouts). Working boards
    (`user_preferences`, key `charts_workspace_layout`, in auth.db) were already measured as PH-1;
    the open item is the saved layouts alone
    (`docs/terminal-research/12-decisions/2026-10-02-term-001-006-board-bound-and-freshness.md:32-35`).
  - *Existing test cases, by name.* Server, `tests/test_board_bound.py`: the shared file is read by
    both runtimes (`:49`), headroom over the census (`:60`), within-bound saves (`:70`), growth
    refused in words (`:76`), over-bound stays editable and the same size (`:83`), an over-bound
    write cannot replace an unreadable or absent board (`:90`), other keys ignored (`:95`), the
    preferences route refuses growth (`:122`) and keeps an over-bound board whole (`:130`), the
    apply door uses the same function (`:142`). Client, `app/src/pages/charts/boardBound.test.js`
    (`:15-62`) and `app/src/pages/charts/ChartsWorkspace.test.jsx:1153-1230` (room, full board in
    words, `?ensure=` door, over-bound board loads whole, saved layout over the bound refused).
    All three shipped criteria are already covered; the lane is verification plus the gap below.
  - *`widget_count` contract.* Takes the raw text or an already-parsed value; returns the length
    of `widgets` when the value is a dict holding a `widgets` list, otherwise `None` (absent,
    empty, unparseable, or no list). It never raises
    (`api/services/board_bound.py:58-69`). The census counts `None` as unreadable.
  - *Row kinds in `charts_layouts`.* Two: board layouts and Multi-Chart grids
    (`layout.kind === 'multichart'`). The workspace's own picker excludes exactly the grids
    (`app/src/pages/charts/ChartsWorkspace.jsx:2634-2635`); no third kind is read anywhere in
    `app/src`. Chart-settings templates are a different store.
  - *A door the bound does not guard (finding).* `POST /api/workspace/doc/restore` writes restored
    values, including `charts_workspace_layout` (`api/services/workspace_doc_store.py:105`),
    through `_write_back`, which calls `set_user_preference` without `enforce_board_bound`
    (`api/routers/workspace_doc.py:71-84`, `api/routers/workspace_doc.py:129-142`). A restored
    version can only be a size the member once held, but it is still an unguarded write. TERM-001's
    remaining work therefore includes: a failing test that restores a 17-widget version over a
    16-widget board, then calling `enforce_board_bound` per key in `_write_back` and reporting a
    refused key in `prefs_failed` (never deleting it).
  - *Test baseline.* Frontend: `docs/plans/joystick/gate-baseline.json` (adopted 2026-09-24 at
    master `73a4286d0`); neither `boardBound.test.js` nor `ChartsWorkspace.test.jsx` is in it, so
    any red in them is new. Backend: `docs/test-baseline/python-failures.md` and `.json`.
- **Tests.** Backend pytest is always scoped to named files, never the whole tree
  (`CLAUDE.md:2003-2004`). Frontend vitest runs scoped to directories with a worker cap. A run
  without a totals line is not a run. The gate is "no new failures against a dated baseline", not
  a fully green suite (`docs/terminal-research/10-roadmap/testing-plan.md:62`).
- **Flags and rollout.** Every gate is declared in `docs/feature_flags.json`, and a flip is recorded
  there in the same push (`CLAUDE.md:4066-4068`). Member rollout is by cohort through
  `rollout_gate` (kill switch read first, per request; `api/services/rollout_gate.py:141-155`). The
  ladder and the six rollback tiers are in `docs/terminal-research/10-roadmap/rollout-rollback.md:310-315`.
- **Shipping.** One master merge at a time, and wait for the `web` deploy to succeed before the next
  push (`CLAUDE.md:3750-3751`). `web` deploys from the `production` branch after the master deploy
  gate (`CLAUDE.md:3115`). Docs, tests, tools and `app/**` can be pushed any time
  (`CLAUDE.md:3393`); a push touching a flow-worker watched file costs a permanent options-tape gap.
- **Editing records.** Write files with the line endings git already stores; a new file is LF
  (`python tools/check_repo_hygiene.py --staged`). Edit JSON and Markdown as text, never by
  load-and-dump.

## Part D. The 42 sections of Part CC

### 1. Executive Summary

- The UCT Terminal shipped to every member: a `/terminal` shell, one command line driving linked panels (`e5f189c56`, `c941080f0`).
- It is gated by `TERMINAL_NEXT_ENABLED`, armed on web and now the master kill switch (`docs/feature_flags.json:2415-2418`).
- The registry holds 85 function codes (`grep -c "{ code: '" app/src/pages/terminal/functions.js`).
- The vision is not complete: see Part B for the derived counts of what is still `building`, `dark` or `owner-blocked`.
- The owner-facing summary of the research is `docs/terminal-research/13-executive-synthesis/owner-decision-memo.md`.

The programme ran in two halves. From 2026-09-02 to 2026-09-30 it researched and decided: 38
deliverables, a 93-ticket backlog and a decision record, with no member surface shipped
(`docs/terminal-research/13-executive-synthesis/executive-summary.md:22-28`). On 2026-10-02 the
owner ruled for a Bloomberg-style shell (D-005), and the build followed: the first slice the same
day (`e5f189c56`), master on 2026-10-04 (`2e304db42`), every member enrolled and the nav graduated
on 2026-10-07 (`4084cd903`, `c941080f0`), and the final waves 5-9 on 2026-10-08 to 10-10
(`docs/terminal-research/13-executive-synthesis/2026-10-10-terminal-delivery-record.md`). What is
left is the non-`live` rows of the completion ledger.

Read more: `docs/terminal-research/13-executive-synthesis/owner-decision-memo.md`,
`docs/terminal-research/COMPLETION-LEDGER.md`.

### 2. Vision

- The philosophy, in the owner's words (typo kept): "the goal is to aggreagte all the best features so someone can only use our site instead of the others" (`docs/terminal-research/05-product-strategy/product-vision.md:47-50`).
- Success means a member closes a competitor's tab, not that a feature shipped (`docs/terminal-research/05-product-strategy/product-vision.md:60-66`).
- What is combined is the best way to do each job, under one command grammar, not each competitor's feature set (`docs/terminal-research/05-product-strategy/product-vision.md:92-101`).
- The ceiling: members leave to place trades, because there is no execution (`docs/terminal-research/05-product-strategy/product-vision.md:78-83`).
- The shipped shell is the owner's 2026-10-02 shape (D-005), which postdates the vision document (`docs/terminal-research/00-program-control/OWNER_DECISIONS.md:18`).

Read more: `docs/terminal-research/05-product-strategy/product-vision.md`.

### 3. Existing UCT Landscape

- The old "UCT Terminal" at `/calendar` had 4 views, a 12-panel research modal and 31 `/api/calendar*` and wire routes (`docs/terminal-research/01-existing-system/terminal-current-map.md:29`, `docs/terminal-research/01-existing-system/terminal-current-map.md:35-36`).
- Its weekly payload has 8 consumers outside the page, so retiring the page and retiring the API are separate decisions (`docs/terminal-research/01-existing-system/terminal-current-map.md:43-45`).
- Two machines run the business: the owner's PC (34 scheduled jobs) and the web pod (one process, 1,187 routes, 143 scheduler jobs) (`docs/terminal-research/01-existing-system/system-map.md:29-30`).
- The capability ledger counts 178 capabilities and warns each cell is a dated measurement (`docs/terminal-research/01-existing-system/capability-ledger.md:325`, `docs/terminal-research/01-existing-system/capability-ledger.md:18-20`).
- Out of date since: the system map says five Railway services; `CLAUDE.md:30` now lists seven.

Read more: `docs/terminal-research/01-existing-system/terminal-current-map.md`, `docs/terminal-research/01-existing-system/system-map.md`.

### 4. Existing Data & Provider Landscape

- 48 providers across six code locations, 20 of them core (`docs/terminal-research/02-data-providers/provider-ledger.md:31`).
- Massive is the hub behind 20 of 29 derived products; FMP is the spine for fundamentals, estimates and the calendar (`docs/terminal-research/02-data-providers/provider-ledger.md:37`).
- No provider existed for Level 2, bond quotes, FX or crypto bars, whisper numbers, revision timelines, short-interest history or per-broker estimates (`docs/terminal-research/02-data-providers/provider-ledger.md:33`).
- The open "which Massive plan" question was superseded by D-011, licensing settled (`docs/terminal-research/00-program-control/OWNER_DECISIONS.md:24`).
- Purchases ruled on 2026-10-07: no Level II feed, no FMP named-analyst upgrade, no SMS (`docs/terminal-research/12-decisions/2026-10-07-owner-delegated-decisions.md:87-89`).

Read more: `docs/terminal-research/02-data-providers/provider-ledger.md`.

### 5. User Personas

- Five roles, defined by work done; three of them are the same confirmed person (`docs/terminal-research/04-workflows/personas.md:80-84`).
- Telling member types apart is inconclusive until owner input OI-02 is answered (`docs/terminal-research/04-workflows/personas.md:86-89`).
- The member slot is left empty on purpose: 23 member accounts, 13 with any page view (`docs/terminal-research/04-workflows/personas.md:414-425`).
- The population is too small for percentages, and the ~750 paying Discord members belong to a separate product (`docs/terminal-research/04-workflows/personas.md:104-113`, `docs/terminal-research/04-workflows/personas.md:126-130`).
- Five roles the product cannot serve are named, including the executing trader (`docs/terminal-research/04-workflows/personas.md:494`).

Read more: `docs/terminal-research/04-workflows/personas.md`.

### 6. Core Jobs to Be Done

- The library holds 45 jobs, grouped by time of day (`docs/terminal-research/04-workflows/jobs-to-be-done.md:178-460`).
- J1: decide in the first twenty minutes whether today's plan is live or void (`docs/terminal-research/04-workflows/jobs-to-be-done.md:20-27`).
- J2: find what the desk already decided about a name, including rejected names; no benchmarked product does this (`docs/terminal-research/04-workflows/jobs-to-be-done.md:29-39`).
- J3: be told when something happens instead of watching (`docs/terminal-research/04-workflows/jobs-to-be-done.md:41-50`).
- The only first-hand evidence: the owner opens thinkorswim, TradingView, Finviz and Unusual Whales by hand; frequency not measured (`docs/terminal-research/04-workflows/jobs-to-be-done.md:63-67`).

Read more: `docs/terminal-research/04-workflows/jobs-to-be-done.md`.

### 7. Daily Workflows

- 38 workflows in three groups: the owner's PC day, the pod's day, the desk at a screen (`docs/terminal-research/04-workflows/workflow-library.md:308`).
- The missed-wire watchdog finding (it ran at 09:05 ET and could not fire) has since been fixed: the trigger is 09:35 ET (`docs/terminal-research/04-workflows/workflow-library.md:27-35`, `api/main.py:2742`).
- The two schedulers run on different machines and clocks; only the pod's is in the repo (`docs/terminal-research/04-workflows/workflow-library.md:46-50`).
- Every workflow that ends in a trade leaves the site by design (`docs/terminal-research/04-workflows/workflow-library.md:69-76`).
- No real human sequence was ever recorded, so the interactive steps are medium confidence (`docs/terminal-research/04-workflows/workflow-library.md:9-10`).

Read more: `docs/terminal-research/04-workflows/workflow-library.md`.

### 8. Competitive Research

- The original 13-name candidate list had zero options-native products and was recast (`docs/terminal-research/03-competitive-research/benchmark-universe.md:21`).
- The recast universe is 12 dossiers plus 4 desk tools (`docs/terminal-research/03-competitive-research/benchmark-universe.md:320`).
- Options coverage went from 0 to 3 products (Unusual Whales, SpotGamma, Market Chameleon) (`docs/terminal-research/03-competitive-research/benchmark-universe.md:343`).
- The decision log accepted the recast as DL-017 (`docs/terminal-research/00-program-control/DECISION_LOG.md:23`).
- All of it is dated 2026-09-02, before the build (`docs/terminal-research/03-competitive-research/benchmark-universe.md:14`).

Read more: `docs/terminal-research/03-competitive-research/benchmark-universe.md:318-343`.

### 9. Bloomberg Findings

- Every function is a short typed address in one grammar, and the chosen security stays loaded across functions (`docs/terminal-research/03-competitive-research/bloomberg/dossier.md:39`).
- Evidence ceiling: no Terminal seat, screenshot, transcript or practitioner interview (`docs/terminal-research/03-competitive-research/bloomberg/dossier.md:10`).
- One seat or practitioner would raise most yellow ratings to green (`docs/terminal-research/03-competitive-research/bloomberg/dossier.md:575`).
- The stickiest moat is the chat network, not the data (`docs/terminal-research/03-competitive-research/bloomberg/dossier.md:604`).
- The strongest idea flagged: link each AI bullet to its source passage (M9) (`docs/terminal-research/03-competitive-research/bloomberg/dossier.md:500`).

Read more: `docs/terminal-research/03-competitive-research/bloomberg/dossier.md`.

### 10. Gödel Findings

- The dossier sorts evidence into VERIFIED, DEMONSTRATED, CLAIMED, REPORTED and SPECULATED; DEMONSTRATED is empty because there is no official video channel (`docs/terminal-research/03-competitive-research/godel/dossier.md:37`, `docs/terminal-research/03-competitive-research/godel/dossier.md:51`).
- Verified: a Bloomberg-style command grammar and a 48-command index (`docs/terminal-research/03-competitive-research/godel/dossier.md:59`, `docs/terminal-research/03-competitive-research/godel/dossier.md:68`).
- Verified: no AI capability (`docs/terminal-research/03-competitive-research/godel/dossier.md:96`).
- Claimed only: "news in milliseconds" and multi-asset coverage (`docs/terminal-research/03-competitive-research/godel/dossier.md:119-121`).
- No trial seat was taken (OI-18), so performance is not determined (`docs/terminal-research/03-competitive-research/godel/dossier.md:513`).

Read more: `docs/terminal-research/03-competitive-research/godel/dossier.md`.

### 11. Cross-Product Findings

- The capability matrix is a break-out ledger: each row is a member task that sends someone to another tab (`docs/terminal-research/05-product-strategy/capability-matrix/capability-matrix.md:47-50`).
- 18 of 45 jobs break out to an external product, an upper bound (`docs/terminal-research/05-product-strategy/capability-matrix/capability-matrix.md:354-356`).
- The biggest break-out is pre-trade options analysis, buildable within the charter (`docs/terminal-research/05-product-strategy/capability-matrix/capability-matrix.md:358-382`).
- The biggest one that cannot be closed is the Finviz Elite scan universe (`docs/terminal-research/05-product-strategy/capability-matrix/capability-matrix.md:384-391`).
- Four absence claims turned out false at master: the product was wider than its own documents said (`docs/terminal-research/05-product-strategy/capability-matrix/capability-matrix.md:399-405`).

Read more: `docs/terminal-research/05-product-strategy/capability-matrix/capability-matrix.md`.

### 12. Best-of-Breed Capabilities

- The matrix ranks mechanisms, not execution; no product was watched running (`docs/terminal-research/05-product-strategy/capability-matrix/best-of-breed.md:11`).
- Bloomberg wins on its addressing model, the cheapest thing to copy (`docs/terminal-research/05-product-strategy/capability-matrix/best-of-breed.md:56-65`).
- The best alert grammar, AI-trust design and feature-status display each cost under $120 a month (`docs/terminal-research/05-product-strategy/capability-matrix/best-of-breed.md:67-83`).
- UCT's largest gap at the time was command, search and navigation, which the shell now covers (`docs/terminal-research/05-product-strategy/capability-matrix/best-of-breed.md:1063-1070`).
- Three gaps cannot be closed: futures quotes, Finviz and the Bloomberg chat network (`docs/terminal-research/05-product-strategy/capability-matrix/best-of-breed.md:1104-1112`).

Read more: `docs/terminal-research/05-product-strategy/capability-matrix/best-of-breed.md`.

### 13. Anti-Patterns

- The library has 65 entries: 55 from the repo's own failure record, 10 from competitors (`docs/terminal-research/05-product-strategy/anti-patterns.md:59-61`).
- The likeliest to recur: a hand-typed count beside the file that owns it (DOC-1) (`docs/terminal-research/05-product-strategy/anti-patterns.md:73`).
- The costliest measured: navigation froze app-wide for about 4.5 hours behind a green gate (PERF-4) (`docs/terminal-research/05-product-strategy/anti-patterns.md:2377`).
- No "Frankenstein terminal": aggregate jobs inside one grammar (`docs/terminal-research/05-product-strategy/product-vision.md:94-102`).
- From competitors: chasing feature-count parity, and a chart that renders blank instead of an error (`docs/terminal-research/03-competitive-research/bloomberg/dossier.md:525`, `docs/terminal-research/03-competitive-research/godel/dossier.md:465-468`).

Read more: `docs/terminal-research/05-product-strategy/anti-patterns.md`.

### 14. UCT Proprietary Advantages

- 71 claims in four classes: 14 accumulated, 20 built, 18 licensed, 19 claimed but not evidenced (`docs/terminal-research/05-product-strategy/proprietary-advantage-inventory.md:552-558`).
- Only the accumulated class is a moat, and the unproven pile is bigger than it (`docs/terminal-research/05-product-strategy/proprietary-advantage-inventory.md:55-58`).
- The strongest asset is the decision record: 22,574 `wire_universe` rows over 60 issues (`docs/terminal-research/05-product-strategy/proprietary-advantage-inventory.md:310`).
- On 2026-09-26, five of the 14 accumulated assets had no member surface (`docs/terminal-research/05-product-strategy/proprietary-advantage-inventory.md:593-594`).
- Since then the shell has a `DR` (decision record) function (`app/src/pages/terminal/functions.js:92-93`); whether it serves the full table is not measured.

Read more: `docs/terminal-research/05-product-strategy/proprietary-advantage-inventory.md`.

### 15. Product Principles

- One product philosophy and no Frankenstein terminal; win on workflow for the UCT niche (`docs/terminal-research/00-program-control/GOVERNING_PRINCIPLES.md:60`).
- Defaults: US equities first, no execution, no renaming of persisted keys (`docs/terminal-research/00-program-control/GOVERNING_PRINCIPLES.md:78`).
- A code comment is a claim until confirmed, and every finding carries a confidence mark (`docs/terminal-research/00-program-control/GOVERNING_PRINCIPLES.md:36-39`).
- NG-01 bans execution and NG-04 bans a free tier, strengthened by D-010 (`docs/terminal-research/05-product-strategy/non-goals.md:69`, `docs/terminal-research/05-product-strategy/non-goals.md:95`).
- NG-10 (no phone parity) and NG-15 (no per-broker estimates) were retracted by D-007 and D-008 (`docs/terminal-research/05-product-strategy/non-goals.md:108`, `docs/terminal-research/05-product-strategy/non-goals.md:132`).

Read more: `docs/terminal-research/00-program-control/GOVERNING_PRINCIPLES.md`, `docs/terminal-research/05-product-strategy/non-goals.md`.

### 16. Proposed Information Architecture

- Five levels were designed: L0 session frame, L1 market pages, L2 entity page, L3 personal objects, L4 intelligence overlay (`docs/terminal-research/06-ux-and-information-architecture/information-architecture.md:79-87`).
- L0 is built: ET clock, regime chip, alert inbox, active channel (`app/src/pages/terminal/L0Strip.jsx:1-15`).
- The registry sorts functions into six groups: Calendar, Security, Research depth, Options, Market, Shell (`app/src/pages/terminal/functions.js:31`).
- A bare ticker opens DES, which plays the L2 entity-page role (`app/src/pages/terminal/parseCommand.js:7-8`).
- The shell lives at `/terminal`; the calendar is `/terminal/calendar` (`app/src/pages/terminal/terminalGate.js:33-37`).

Read more: `docs/terminal-research/06-ux-and-information-architecture/information-architecture.md`.

### 17. Proposed Terminal UX Architecture

- The design decision was hybrid: desk-authored fixed pages for market-wide questions, one composable board for personal ones (`docs/terminal-research/06-ux-and-information-architecture/fixed-modular-hybrid.md:19-21`).
- The real risk named was persistence, not layout (`docs/terminal-research/06-ux-and-information-architecture/fixed-modular-hybrid.md:24-28`).
- Built: a member shows 1 to 4 panels at a time (`app/src/pages/terminal/boardModel.js:38-39`).
- Built: each panel has its own error boundary with a retry, so one crash leaves the others running (`app/src/pages/terminal/TerminalShell.jsx:430`).
- Built: a panel can pop out into its own window and come back (`app/src/pages/terminal/TerminalShell.jsx:425-427`).

Read more: `docs/terminal-research/06-ux-and-information-architecture/fixed-modular-hybrid.md`.

### 18. Workspace Model

- Two preference keys: `terminal_layout` (the board on screen) and `terminal_boards` (named boards) (`app/src/pages/terminal/boardPrefs.js:12-13`).
- The layout is at schema version 2 (`app/src/pages/terminal/boardModel.js:34`).
- Bounds: panels, channels and boards are capped in one place (`app/src/pages/terminal/boardModel.js:41-46`).
- Link groups A-D (shared with `/charts`) plus N for unlinked (`app/src/pages/terminal/boardModel.js:54-56`, `app/src/pages/terminal/useTerminalLayout.js:16-18`).
- Writes are debounced, and a stored layout that cannot be read is never written over (`app/src/pages/terminal/useTerminalLayout.js:11-14`, `app/src/pages/terminal/useTerminalLayout.js:44`).

Read more: `app/src/pages/terminal/boardModel.js`, `app/src/pages/terminal/useTerminalLayout.js`.

### 19. Search & Command System

- One parser serves both the command line and the Ctrl/Cmd-K palette (`app/src/pages/terminal/parseCommand.js:3-5`).
- Grammar: `TICKER FUNC [args]`, `$` to force a ticker, row numbers, `@B` channel targeting, `A/B` compare, `ASK`, `ALIAS` (`app/src/pages/terminal/parseCommand.js:7-23`).
- Every input gets a result or an error with suggestions, never silence (`app/src/pages/terminal/parseCommand.js:26`).
- 85 function codes, counted with `grep -c "{ code: '" app/src/pages/terminal/functions.js`.
- Codes that are also real tickers are listed as collisions (`app/src/pages/terminal/grammar.js:28`).

Read more: `app/src/pages/terminal/grammar.js`, `docs/terminal-research/06-ux-and-information-architecture/command-grammars.md`.

### 20. Data Architecture

- Design: one adapter per vendor, FMP first and Massive second (`docs/terminal-research/07-technical-architecture/data-architecture.md:1648`).
- Design: a permanent internal entity id plus a dated ticker-alias history (`docs/terminal-research/07-technical-architecture/data-architecture.md:1650`).
- Design: freshness and provenance as first-class fields (`docs/terminal-research/07-technical-architecture/data-architecture.md:1656-1660`).
- Built: panels show a freshness badge wired to TERM-006's freshness contract (`app/src/pages/terminal/panelFreshness.test.jsx:1-10`).
- Built: the grammar's server store keeps per-member counts and aliases in auth.db (`docs/feature_flags.json:144`); whether a symbol master was built is not measured.

Read more: `docs/terminal-research/07-technical-architecture/data-architecture.md:1644-1672`.

### 21. Real-Time Architecture

- Built: live prices come from one shared, ref-counted poll of all subscribed tickers (`app/src/hooks/livePriceStore.js:8-11`).
- It polls every 2 s on desktop and 4 s on mobile, and pauses in a hidden tab (`app/src/hooks/livePriceStore.js:52`, `app/src/hooks/livePriceStore.js:11`).
- The L0 regime chip refreshes during market hours only, and a stale reading is dimmed and dated (`app/src/pages/terminal/L0Strip.jsx:65`, `app/src/pages/terminal/L0Strip.jsx:68-72`).
- Design finding: the web pod leaked memory and the edge cached the flow payload (`docs/terminal-research/07-technical-architecture/realtime-performance-architecture.md:55-65`).
- Design rule: a panel declares its data need and never owns a transport (`docs/terminal-research/07-technical-architecture/realtime-performance-architecture.md:574-577`).

Read more: `docs/terminal-research/07-technical-architecture/realtime-performance-architecture.md`.

### 22. AI Architecture

- The terminal adds no AI layer of its own; it inherits the one that runs (`docs/terminal-research/08-ai/ai-architecture.md:29-30`).
- The shipped contract has a blocking grounding gate, and refusals come from gaps in the evidence (`docs/terminal-research/08-ai/ai-architecture.md:32-38`).
- The named risk is the spending caps, not the model bill (`docs/terminal-research/08-ai/ai-architecture.md:48-56`).
- Built: `ASK` opens an AI panel for a ticker or the AI Search page (`app/src/pages/terminal/functions.js:115-117`).
- Built: an unparseable line that reads like a question goes to AI Search instead of being refused (`app/src/pages/terminal/parseCommand.js:22-23`).

Read more: `docs/terminal-research/08-ai/ai-architecture.md`.

### 23. Security & Entitlements

- The gate checks the kill switch first, then the user, then cohort membership, and fails closed (`api/services/rollout_gate.py:176-188`).
- New signups join the `terminal-next` cohort; existing members were seeded once (`api/services/rollout_gate.py:191-229`).
- `TERMINAL_NEXT_ENABLED` is armed on web; the code default is still "0" (`docs/feature_flags.json:2415-2418`, `api/services/rollout_gate.py:122`).
- Everything is behind the paywall: `FREE_PAGES = []` (`app/src/constants/freePages.js:21`).
- One subscription is one person, with a two-device limit, by the owner's 2026-10-08 answer (`docs/terminal-research/12-decisions/2026-10-07-owner-delegated-decisions.md:193-198`).

Read more: `api/services/rollout_gate.py`, `docs/terminal-research/09-security-licensing-cost/security-entitlement-architecture.md`.

### 24. Licensing

- ADR-0015 (accepted 2026-09-26): cleared for the current estate, open for each new source (`docs/terminal-research/12-decisions/adr/ADR-0015-licensing-cleared-for-the-estate-open-per-new-source.md:3`).
- D-011 (2026-10-02): licensing is settled (`docs/terminal-research/00-program-control/OWNER_DECISIONS.md:24`).
- The register totals 118 rows: 76 likely allowed, 18 restricted, 12 unknown, 8 unsuitable (`docs/terminal-research/09-security-licensing-cost/licensing-register.md:345-350`).
- yfinance is an owner-accepted risk, not a licence (D-004) (`docs/terminal-research/00-program-control/OWNER_DECISIONS.md:17`).
- A new data source still gets its own terms read before it ships (`docs/terminal-research/00-program-control/OWNER_DECISIONS.md:24`).

Read more: `docs/terminal-research/09-security-licensing-cost/licensing-register.md`.

### 25. Performance

- `/api/scatter/universes` went from 43 s to 0.6 s; `/api/screener/meta` from over 60 s to 0.2 s warm (`docs/terminal-research/13-executive-synthesis/2026-10-10-terminal-delivery-record.md:54-55`).
- `/api/rs-rankings` returns 200 at 78 s uptime instead of about 3 minutes of 503 (`docs/terminal-research/13-executive-synthesis/2026-10-10-terminal-delivery-record.md:57`).
- Moving the registry out of the entry chunk saved 32.6 KB on every page (`docs/terminal-research/13-executive-synthesis/2026-10-10-terminal-delivery-record.md:47`).
- Layout writes are debounced (`app/src/pages/terminal/useTerminalLayout.js:44`).
- The market-hours speed check is still open, set for Wednesday 2026-10-14 (`docs/terminal-research/13-executive-synthesis/2026-10-10-terminal-delivery-record.md:77`).

Read more: `docs/terminal-research/13-executive-synthesis/2026-10-10-terminal-delivery-record.md:50-58`.

### 26. Reliability

- `TERMINAL_NEXT_ENABLED=0` on web hides the shell for every member on the next auth request; no tag is touched (`docs/feature_flags.json:2425`).
- A closed gate redirects and never shows a 404 (`app/src/pages/terminal/terminalGate.js:13-15`).
- Each panel has its own crash isolation (`app/src/pages/terminal/TerminalShell.jsx:430`).
- Incident: web restarted three times on 2026-10-09 from overlapping heavy reads; the batch was rolled back and re-landed (`docs/terminal-research/11-risks-and-open-questions/2026-10-09-web-restarts-and-heavy-reads.md:5-17`).
- Railway keeps only 500 log lines, so that crash itself was never seen (`docs/terminal-research/11-risks-and-open-questions/2026-10-09-web-restarts-and-heavy-reads.md:9-10`).

Read more: `docs/terminal-research/10-roadmap/rollout-rollback.md`.

### 27. Observability

- The terminal monitor exists as its own Railway service (`docs/terminal-research/10-roadmap/observability-plan.md:54-57`).
- In-process counters reset on every deploy, so a multi-day maximum cannot be read (`docs/terminal-research/10-roadmap/observability-plan.md:67-85`).
- Whether the monitor service runs its cron today: not measured (`docs/feature_flags.json:2432`).
- Grammar telemetry is counts only, never a ticker or typed text (`docs/feature_flags.json:144`).
- A status endpoint per adapter was designed (`docs/terminal-research/07-technical-architecture/data-architecture.md:1665`); how far it was built: not measured.

Read more: `docs/terminal-research/10-roadmap/observability-plan.md`.

### 28. Feature Priorities

- The 85 backlog items fall into six bands of 10, 8, 8, 10, 26 and 23 (`docs/terminal-research/05-product-strategy/feature-scoring.md:829`).
- Bands come from filters in a fixed order, not summed scores; band 0 is held items (`docs/terminal-research/05-product-strategy/feature-scoring.md:817-827`).
- A value axis is refused on purpose (`docs/terminal-research/05-product-strategy/feature-scoring.md:137-143`).
- The highest-leverage item is the provenance components (FB-S8-01), with 11 items behind it (`docs/terminal-research/05-product-strategy/feature-scoring.md:677`).
- The charter's Tier S-X labels are not used; the bands stand in for them (`docs/terminal-research/05-product-strategy/product-vision.md:443`).

Read more: `docs/terminal-research/05-product-strategy/feature-scoring.md:808-936`.

### 29. MVP

- The MVP was defined as a pre-registered displacement trial, not a release (`docs/terminal-research/10-roadmap/mvp.md:90`).
- The task was JTBD-M02: drill from a breadth number to its names, then one chart (`docs/terminal-research/10-roadmap/mvp.md:96`).
- The trial with Ravi was pre-registered 2026-09-30 and never started (`docs/terminal-research/10-roadmap/2026-09-30-mvp-preregistration-ravi.md:5`).
- The owner waived it on 2026-10-10; nothing waits on it (`docs/terminal-research/12-decisions/2026-10-07-owner-delegated-decisions.md:213-221`).
- The first vertical slice is recorded separately (`docs/terminal-research/10-roadmap/first-slice.md`).

Read more: `docs/terminal-research/10-roadmap/mvp.md`, `docs/terminal-research/10-roadmap/first-slice.md`.

### 30. Coexistence with Terminal-Current

- Terminal-Current is the `/calendar` page; its "UCT Terminal" name was display-only (`docs/terminal-research/10-roadmap/coexistence.md:23-25`).
- Eleven rulings, CX-1..CX-11; CX-2 means new keys only (`docs/terminal-research/10-roadmap/coexistence.md:242-252`).
- The parity matrix: 37 rows, 34 carried, 2 unaffected, 1 gap (`docs/terminal-research/10-roadmap/coexistence-parity-matrix.md:8`).
- The one gap is the joystick hub's calendar mode (`docs/terminal-research/10-roadmap/coexistence-parity-matrix.md:67`).
- `/calendar` coexists permanently as a URL, with no retirement countdown (P-9) (`docs/terminal-research/12-decisions/2026-10-07-owner-delegated-decisions.md:79`).

Read more: `docs/terminal-research/10-roadmap/coexistence.md`.

### 31. Migration Strategy

- Ten gates, MG-0..MG-9, specific to two products sharing one site (`docs/terminal-research/10-roadmap/coexistence.md:449-451`).
- Eight use an existing rail; MG-0 and MG-5 are human checks (`docs/terminal-research/10-roadmap/coexistence.md:453`).
- MG-4, the saved-settings key gate, is the one most often skipped (`docs/terminal-research/10-roadmap/coexistence.md:519`).
- MG-7: every must-carry row named carried, replaced or retired before members see anything (`docs/terminal-research/10-roadmap/coexistence.md:513`).
- MG-8 is moot because there is no countdown (P-10) (`docs/terminal-research/12-decisions/2026-10-07-owner-delegated-decisions.md:80`).

Read more: `docs/terminal-research/10-roadmap/coexistence.md:449-580`.

### 32. Implementation Roadmap

- Three horizons, NOW, NEXT and LATER, plus NOT PLANNED (`docs/terminal-research/10-roadmap/roadmap.md:63-69`).
- No row carries a date or duration (`docs/terminal-research/10-roadmap/roadmap.md:72`).
- Row counts at writing: NOW 15, NEXT 7, LATER 19, NOT PLANNED 14 (`docs/terminal-research/10-roadmap/roadmap.md:782-786`).
- The largest item, pre-trade options analysis (BRK-01), had no ticket (`docs/terminal-research/10-roadmap/roadmap.md:169-171`).
- Today's state per item is the completion ledger, not the roadmap (Part B).

Read more: `docs/terminal-research/10-roadmap/roadmap.md`.

### 33. Technical Dependency Graph

- 118 nodes and 109 typed edges (`docs/terminal-research/10-roadmap/dependency-graph.md:202-203`).
- 82 hard edges and 27 soft (`docs/terminal-research/10-roadmap/dependency-graph.md:206`).
- 40 items have no hard prerequisite (`docs/terminal-research/10-roadmap/dependency-graph.md:207-208`).
- The longest chain is 3 edges, so the graph is wide and shallow (`docs/terminal-research/10-roadmap/dependency-graph.md:209`).
- Delivery is bounded by concurrency, not by dependencies (`docs/terminal-research/10-roadmap/dependency-graph.md:502-510`).

Read more: `docs/terminal-research/10-roadmap/dependency-graph.md`.

### 34. Engineering Backlog

- 93 tickets, TERM-001..TERM-093, in the Part CCI schema with a rollback tier added (`docs/terminal-research/10-roadmap/backlog.md:169-216`).
- The register lists them in band order; TERM-001 (the board-size bound) is first (`docs/terminal-research/10-roadmap/backlog.md:317-321`).
- 25 tickets have no rollback tier, and the file says how to handle one (`docs/terminal-research/10-roadmap/backlog.md:475-539`).
- TERM-001 is `live` on master (`docs/terminal-research/COMPLETION-LEDGER.md:104`); see Part C for its files.
- Each ticket's current state is its ledger row in `docs/terminal-research/COMPLETION-LEDGER.md` §3.

Read more: `docs/terminal-research/10-roadmap/backlog.md`.

### 35. Testing

- The gate is no new failures against a dated baseline, never a fully green suite (`docs/terminal-research/10-roadmap/testing-plan.md:62`).
- The frontend baseline at writing was 126 named failures across 43 files (`docs/terminal-research/10-roadmap/testing-plan.md:64-65`).
- The six-shard gate takes 46-92 minutes, longer than master stays still (`docs/terminal-research/10-roadmap/testing-plan.md:77-78`).
- Eight test tiers, T0 to T7, each with what it cannot see (`docs/terminal-research/10-roadmap/testing-plan.md:411-418`).
- Backend pytest is always scoped to named files (`CLAUDE.md:2003-2004`).

Read more: `docs/terminal-research/10-roadmap/testing-plan.md`.

### 36. Rollout

- Five rungs, S0 to S4; no rung is a pricing tier (`docs/terminal-research/10-roadmap/rollout-rollback.md:503-508`).
- Rollout is by cohort, then by surface; percentage staging is ruled out at this population (`docs/terminal-research/10-roadmap/rollout-rollback.md:98-103`).
- Six rollback tiers, from a per-browser switch to an emergency production force (`docs/terminal-research/10-roadmap/rollout-rollback.md:310-315`).
- The terminal reached S4: every member enrolled, `TERMINAL_NEXT_ENABLED` armed (`4084cd903`, `docs/feature_flags.json:2425`).
- The pre-authored rollback is `docs/runbooks/terminal-rollback.md` on branch `rollback/terminal-next-off` (ledger RM-X02).

Read more: `docs/terminal-research/10-roadmap/rollout-rollback.md`.

### 37. Success Metrics

- 21 metrics: 7 member-visible quality, 5 product health, 6 engineering, 3 cost (`docs/terminal-research/10-roadmap/success-metrics.md:234`).
- Only 9 could be computed when written (`docs/terminal-research/10-roadmap/success-metrics.md:74`).
- No business metric can be read: at about 26 accounts one account moves a rate by 3.85 points (`docs/terminal-research/10-roadmap/success-metrics.md:76`).
- 13 accounts had any page-view row (`docs/terminal-research/10-roadmap/success-metrics.md:175`).
- Terminal usage since launch: not measured.

Read more: `docs/terminal-research/10-roadmap/success-metrics.md`.

### 38. Cost Model

- The owner de-scoped cost and usage work on 2026-09-26 (ADR-0014) (`docs/terminal-research/12-decisions/adr/ADR-0014-costs-and-usage-de-scoped.md:27`).
- Licensing still matters as a compliance question (`docs/terminal-research/12-decisions/adr/ADR-0014-costs-and-usage-de-scoped.md:33`).
- Before that, six AI features were modelled at $2.8-3.6 per member per month on a ~$515 fixed base (`docs/terminal-research/09-security-licensing-cost/cost-model-ai-infra.md:36`).
- The data cost model uses public list prices only, no invoices (`docs/terminal-research/09-security-licensing-cost/cost-model-data.md:10`).
- The gate's `cost-model.md` path does not exist; the model is these two files.

Read more: `docs/terminal-research/09-security-licensing-cost/cost-model-data.md`, `docs/terminal-research/09-security-licensing-cost/cost-model-ai-infra.md`.

### 39. Risk Register

- 19 risks, R-01..R-19, all marked open, written before the build (`docs/terminal-research/00-program-control/RISK_REGISTER.md:7-25`).
- R-04: a single web pod on SQLite may not carry a multi-panel terminal (`docs/terminal-research/00-program-control/RISK_REGISTER.md:10`).
- R-17: unauthenticated live-data endpoints (`docs/terminal-research/00-program-control/RISK_REGISTER.md:23`).
- The 2026-10-09 restarts are the nearest measured instance of R-04 (`docs/terminal-research/11-risks-and-open-questions/2026-10-09-web-restarts-and-heavy-reads.md:5-17`).
- Which risks the build retired: not measured; the register was not re-walked after the build.

Read more: `docs/terminal-research/00-program-control/RISK_REGISTER.md`, `docs/terminal-research/11-risks-and-open-questions/`.

### 40. Open Questions

- 16 open questions, OQ-01..OQ-16, written before the build (`docs/terminal-research/00-program-control/OPEN_QUESTIONS.md:7-22`).
- 21 owner inputs were requested (`docs/terminal-research/00-program-control/OWNER_INPUTS_REQUESTED.md:9-28`).
- Most programme decisions still marked open were decided on 2026-10-07 (`docs/terminal-research/12-decisions/2026-10-07-owner-delegated-decisions.md:69-81`).
- The owner-only remainder is the ledger's §8 (`docs/terminal-research/COMPLETION-LEDGER.md:378`).
- The one unruled question there: may message text be kept so social sentiment can carry a polarity (FT-080).

Read more: `docs/terminal-research/00-program-control/OWNER_INPUTS_REQUESTED.md`.

### 41. ADR Summary

- 52 ADRs: 43 accepted, 6 superseded, 2 withdrawn, 1 accepted by practice (`docs/terminal-research/12-decisions/adr/ADR-INDEX.md:52-57`).
- ADR-0009 one paid tier; ADR-0010 $200 a month or $2,000 a year (`docs/terminal-research/12-decisions/adr/ADR-INDEX.md:256-257`).
- ADR-0012 coverage is the binding constraint; ADR-0013 no execution (`docs/terminal-research/12-decisions/adr/ADR-INDEX.md:259-260`).
- ADR-0014 costs de-scoped; ADR-0015 licensing cleared per estate (`docs/terminal-research/12-decisions/adr/ADR-INDEX.md:261-262`).
- ADR-0017 one versioned workspace document; ADR-0022 one entitlement object; ADR-0039 the MVP definition (`docs/terminal-research/12-decisions/adr/ADR-INDEX.md:264`, `docs/terminal-research/12-decisions/adr/ADR-INDEX.md:269`, `docs/terminal-research/12-decisions/adr/ADR-INDEX.md:286`).

Read more: `docs/terminal-research/12-decisions/adr/ADR-INDEX.md`.

### 42. Final Recommendation

- Keep the terminal on: it is live for every member with a tested one-variable rollback (Part B, RM-X02).
- Work the ledger's `building` rows by lane; they are agent-buildable (`docs/terminal-research/COMPLETION-LEDGER.md` §0).
- Arm the `dark` rows under D-009 once each surface's gates are green.
- Take the owner-only actions in the ledger's §8, starting with the 2026-10-14 market-hours speed check.
- Re-walk the five terminal-grade properties on `/terminal` itself (X-11, V22), which has not been measured.
