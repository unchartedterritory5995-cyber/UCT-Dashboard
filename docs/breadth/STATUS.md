# Breadth → Data Charts overhaul — STATUS

Program: UX / visual / chart-mechanics overhaul of the Breadth → Data Charts tab.
Branch `feat/breadth-charts` · worktree `C:/Users/Patrick/uct-worktrees/breadth-charts`
· started from master `f4fc5d1c1` on 2026-09-13.

One short entry per phase, appended at the end of that phase. Decisions live in
[`DECISIONS.md`](DECISIONS.md), never here.

---

## Phase 0 — Discovery — DONE (2026-09-13)

- [`00-discovery.md`](00-discovery.md): every ground-truth line checked (4 corrections: the tab's
  fetcher is `BreadthCharts.jsx:19`, the magnitude "guard" is a test not a runtime check, Views has
  four palettes, FTD cannot exist before 2026 by construction); clickable map; option builder; 20 new
  findings with evidence tiers (one suspected finding measured and REFUTED).
- Instrument: `tools/breadth_charts_rig.py` (member-smoke, no account writes, per-segment deploy-swap
  verdicts, `--self-check`). 98 screenshots at 4 widths in `screenshots/before/`; measurements in
  `measurements/`.
- ⚠️ The first full run straddled another session's deploy; the affected segment was re-run on its own
  and spliced, with provenance in `before.json`. Tab-switch samples (5 per width) appended to §4.
- Not capturable: the live row (Sunday) — D-005.

## Phase 1 — Audit — DONE (2026-09-13)

- [`01-audit.md`](01-audit.md): 1 × P0 (a failed load reads as "No data in selected range"), 22 × P1,
  18 × P2, each with evidence and a lane; evaluations for Y axes (stacked panels), long history
  (projected pre-encoded endpoint + LTTB), registry unification (an adapter, byte-identical
  `HM_METRICS`), unoffered fields, URL state; prioritised backlog of 10 merges; north star.
- [`collector-asks.md`](collector-asks.md): 11 asks for the engine repo.
- Decisions D-007 … D-017.

## ⚠️ Exposure contained (2026-09-13) — D-018

The repository is public. The first Phase 0/1 push carried paid-data screenshots, measurement JSON and quoted metric
values; the remote branch was deleted within minutes, the commit rebuilt without them, and `docs/breadth/.gitignore` now
keeps that evidence on local disk. The original commit (`b98ce804b`) remains reachable on GitHub by SHA until purged —
owner action, Phase 6.

## Phase 2 — Design — DONE (2026-09-13)

- [`02-design.md`](02-design.md): token plan reviewed against the brief (five template defaults rejected), layouts for
  desktop/tablet/phone, controls, stacked-panel rules, axes, metric-attached reference lines, marks, a colour model
  validated on OLED/dark/light, the coverage and staleness language, nine member-visible states with copy, motion, URL,
  accessibility, and the flag architecture.
- [`mock/index.html`](mock/index.html) + `mock/render_mock.py` → `mock/renders/` (five boards). Synthetic series, the
  app's real tokens, fonts and ECharts; one critique pass applied (irregular ticks, colliding end labels, a heavy
  not-recorded area, a gold slider band, a record key naming absent states).
- Decisions D-019 … D-023. Tab-switch samples added to discovery §4 as not quotable, with the Phase 4 A/B method.

## Phase 3 — C1 honest states — MERGED (2026-09-13)

- Plan [`docs/superpowers/plans/2026-09-13-breadth-charts-c1-honest-states.md`](../superpowers/plans/2026-09-13-breadth-charts-c1-honest-states.md);
  decisions D-024 … D-027. Flag-free: every change corrects the tab members already use.
- Commits: `27677f534` plan · `b2491da5f` Eastern session dates · `0f4e78bf2` load-error sentences · `be0f8ac9f` readout
  basis, stale date, Stage labels · `32f480a77` tab wiring · gate records · `2b0b184cd` merge of origin/master (42 commits,
  none touching a C1 file or dependency).
- The fixes and the tests that hold them, each written first and seen failing:

| Fix | Audit | Tests |
|---|---|---|
| A failed load says what failed — sign in, plan, server error, lost connection — never "No data in selected range" | A-01, A-38 | `BreadthCharts.loadError.test.jsx`, `chartLoadError.test.js`, the `jsonFetcher` rail (tab removed from its list) |
| The recorded row is fetched when the close supersedes the live point, and on return to an overdue tab (via `utils/marketSession.expectedLatestDailySessionET`) | A-09 | `BreadthCharts.refresh.test.jsx` |
| A reading older than its cadence shows "last Aug 7" | A-10 | `MetricReadout.test.jsx`, `chartMetrics.cadence.test.js` |
| Eastern Time dates that follow the calendar; "sessions", not "days" | A-35, A-15 | `sessionDates.test.js`; the 9:30 PM ET and next-Monday cases in `BreadthCharts.refresh.test.jsx`; ET fixtures in both existing suites |
| The percentile names its set ("75th of 4 shown"); Stage 2/4 "(MA Stack)" | A-12, A-34 | `MetricReadout.test.jsx`, `BreadthCharts.test.jsx`, `percentile.test.js`, `chartMetrics.cadence.test.js` |

- Mutation proofs, control run first, bytes restored and tree clean after — 7/7 caught: inline fetcher restored · superseded
  check dropped · had-a-live-row check dropped · revisit throttle dropped · retry policy dropped · window on the UTC date ·
  weekly allowance dropped.
- Gate ([`gates.md`](gates.md)): baseline `5091a81cf` 12 failing tests, all master's; C1 `32f480a77` 9 — **none new**. The
  three that did not recur are load timeouts that pass alone on the C1 tree; the reachability, polling-sites and tap-floor
  rails name the same files as the baseline.
- Watch coverage OK (web restart only). Pushed to master with this entry; the web deploy is recorded in the next entry.

> **What members will see.** When Data Charts can't load its history it now says why — an ended session, a plan
> requirement, a server error or a lost connection — with the right button, instead of "No data in selected range." A
> chart left open across the close picks up the day's row on its own. A reading that stopped arriving shows when it was
> last reported, each percentile says how many readings it ranks against, the window counts sessions on Eastern Time,
> and Stage 2/4 read "(MA Stack)" as they do on the Monitor.

## Phase 3 — C1 in production (2026-09-13)

- `d6ac61816` pushed 17:46:40Z; web SUCCESS 17:49:16Z; `/api/health` uptime 22 → 33 → 43 s on the new boot.
- Member check on production (member-smoke; evidence local in `screenshots/after-c1/` and `measurements/after-c1.json`):
  401 "Your session has ended.", 402 "Data Charts is part of the UCT plan.", 500 and a dropped connection "Breadth
  history didn't load." at 1280 and 390 px, no page errors. None of them renders "No data in selected range." any more.

## Phase 3 — C2 chart mechanics — MERGED (2026-09-13)

- Plan [`docs/superpowers/plans/2026-09-13-breadth-charts-c2-chart-mechanics.md`](../superpowers/plans/2026-09-13-breadth-charts-c2-chart-mechanics.md);
  decisions D-028 … D-031.
- Commits: `db61fda59` plan · `b696d9398` axis dates carry their year · `f6fcb3e11` zoom as dates · `8f8b32986` lines belong
  to metrics · `38ee722d0` runtime magnitude rule · `391818e44` tab wiring · `05f809314` merge of origin/master (7 commits,
  none touching a C2 file or dependency).

| Fix | Audit | Tests |
|---|---|---|
| Reference lines belong to metrics, survive a hand edit, and sit on their own family's axis (Volume Thrust's flat line on the net axis) | A-02, A-03 | `chartMetrics.test.js` resolveLines rails incl. every preset; `BreadthCharts.test.jsx` hand-edit and Volume Thrust |
| A series flattened on a shared axis is named ("52W Lows (Close) is 300× smaller than Universe Count on this axis."); the `MAX_ABS` table is gone | A-04 | `chartMagnitude.test.js` (both round-one defects as fixtures; 4.8× and cross-axis controls); `BreadthCharts.mechanics.test.jsx` |
| Axis dates carry their year by visible span; tooltip header "Fri, Sep 11, 2026" | A-06 | `chartTicks.test.js`; mechanics |
| Zoom holds across selection changes and live ticks; a new range drops it | A-07 | `chartZoom.test.js`; mechanics (changed-range control) |
| A hidden series stays hidden through rebuilds; the chart draws once, then updates instantly | A-08 | mechanics |
| Notable Extremes only under MA Breadth | A-22 | mechanics |

- Mutation proofs, control first, bytes restored, tree clean — 9/9 caught: inside-zoom write-back dropped · zoom range
  check dropped · `legend.selected` dropped · first-paint motion dropped · Volume Thrust flat line dropped · every line on
  axis 0 · magnitude limit 1000 · extremes in every group · ticks back to MM/DD.
- One existing test changed meaning with A-03: "ignores a stored metric that no longer exists" compared every series name,
  and VIX now brings its canonical 20 line as a marker series; it compares metric series only.
- Gate ([`gates.md`](gates.md)): C2 `391818e44` fails the same nine tests as C1 — none new, none gone; the reachability,
  polling-sites and tap-floor rails name the same files.
- Watch coverage OK (web restart only). Pushed with this entry.

> **What members will see.** Reference lines stay put when you add or remove a metric, and each sits on its own scale.
> Axis dates carry their year. Zooming in holds while you change metrics or while the chart updates during the session, a
> hidden series stays hidden, and the chart no longer replays its drawing every minute. When one line is too small to read
> beside another on the same axis, the chart says so. Notable Extremes appears only under MA Breadth, where it draws.

- 2026-09-13 15:10 ET — Checkpointed for machine restart at 15:10 ET; see [RESUME.md](RESUME.md).
