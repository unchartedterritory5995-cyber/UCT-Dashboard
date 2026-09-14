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

## Phase 3 — C2 in production (2026-09-13)

- `0148ef52d` pushed 18:49:34Z; web SUCCESS 18:52:51Z; `/api/health` uptime 26 → 41 → 56 s on the new boot, `wire_date`
  2026-09-11. (A `null` `wire_date` read moments before the push belonged to another session's boot of `d32d14d60` and
  had recovered by the time C2 was live.)

## Post-restart (2026-09-13, from 15:10 ET)

- Re-oriented against [`RESUME.md`](RESUME.md): worktree, branch, `0c4086287` on top of WIP `3cbf9a391`, clean tree,
  branch level with origin. master had moved 19 commits (discord-render, catalyst, canonical indicator, notebook docs)
  touching **nothing** under `app/`; merged as `0af0f66f0`, no conflicts.
- **Gate wrapper provenance.** The Phase 0 baseline and the C1 and C2 gates ran on the pre-`eddea6a92`
  `scripts/gate_shards.py`; `eddea6a92` ("four faults in how tonight's Sunday gate READS the log") arrived through a
  master merge and changed how the wrapper PARSES shard logs, not what the suite runs. The failing set was identical
  across both wrapper versions, so the comparison holds. C3 runs on the C2 version. Any C3 result that differs from C2 in
  a way the wrapper could explain is called out as such in [`gates.md`](gates.md) rather than absorbed into a count.
- **D-001 ratified by the owner** after the resume brief re-stated `docs/frontend_feature_flags.json`: the V2 build flag
  stays in `docs/feature_flags.json` → `build_flags`. Every breadth doc already names that file; the only mentions of the
  non-existent one are inside D-001, where they are the record of the correction. The `Dockerfile.web` build-arg
  requirement and the `VITE_` CI check are unchanged.
- **The original brief was recovered verbatim** from this session's transcript and mapped line by line in
  [`COVERAGE.md`](COVERAGE.md): all eleven known defects (a)–(k), the phases, the standing rules, and the brief's own
  Phase-3 test list. Three obligations had no home and now do — a "null never becomes 0" rail (V2-3), request
  dedup/cancellation (V2-1), and rig assertions with thresholds (Phase 4). ⚠️ A first extraction globbed every transcript
  in the projects folder and matched ANOTHER program's brief (the Wisdom Loop session, which mentions breadth metrics and
  names this tab's files as off-limits to it); the search is scoped to this session's id and nothing from that brief was
  acted on.

## Phase 3 — C3 touch & ARIA — MERGED (2026-09-13)

- Plan [`…c3-touch-aria.md`](../superpowers/plans/2026-09-13-breadth-charts-c3-touch-aria.md); decisions D-032, D-033,
  and D-036 for the one test fixed outside this tab.
- Commits: `16baf13f0` More as a disclosure of buttons · `4dd8486da` group toggles and Notable Extremes state ·
  `add4afeaa` touch tier · `3512348c5` the AuthContext sampling race (test-only, not this tab — D-036) · `166c161dd`
  COVERAGE and post-restart provenance · three master merges as it moved (`0af0f66f0`, `47109cc47`, `9e2a30706`).

| Fix | Audit | Tests |
|---|---|---|
| More is a list of buttons that opens and closes — no `listbox`/`option` role it cannot honour; the active preset is `aria-pressed`; Escape returns focus to More | A-24 | `PresetRow.test.jsx` (9); `BreadthCharts.test.jsx` finds grouped presets as buttons; the rig's preset helpers follow |
| Metric group toggles carry `aria-expanded` + `aria-controls`; Notable Extremes carries `aria-pressed` | A-24 | `BreadthCharts.a11y.test.jsx` (2) |
| Every finger target reaches `--tap-min` at ≤ 1024 px — group toggles, Notable Extremes, metric rows, dates, FTD, readout chips, preset pills and More items, the load-problem action | A-19 | `breadth/tapTier.test.js` (12, reads the stylesheets, control included) |

- Mutation proofs, control first, bytes restored, tree clean — 6/6 caught: `aria-expanded` dropped · `aria-pressed`
  dropped · Escape focus return dropped · `role="listbox"` restored · `.metricItem` touch rule dropped · MetricReadout
  `.item` touch rule dropped.
- Gate ([`gates.md`](gates.md)): per-shard deltas empty against the C2 baseline, union 9 vs 9. Two reds appeared during
  C3 and each was run to ground before any edit — `AuthContext` fixed as a misplaced assertion, `ArticlesSection`
  recorded as starvation with its `waitFor` already given 16× the headroom it needed.
- Watch coverage OK — `app/**` and `docs/**` only, flow-worker not on path, web restart only.

> **What members will see.** On tablets, Data Charts' buttons, date fields, checkboxes and readout chips are now
> finger-sized, as they already were on phones. Screen readers hear More as a list of buttons that opens and closes,
> metric groups say whether they are expanded, and Notable Extremes says whether it is on; Escape returns you to the
> More button.
>
> Test-only, and not part of the Data Charts tab: `3512348c5` — `AuthContext.test.jsx` "503 on a refetch", the
> `authTransient` read moved into the existing `waitFor` (React 19 late flush under load). No product code changed.

## Phase 3 — C3 in production, and the member pass (2026-09-13)

- Merge commit `a9290e7f4` (parents `9087bc196` master, `9d0512297` branch — a real merge, so the five C3 commits stay
  individually visible). Pushed 21:39:56Z / **17:39:56 ET**; Railway web deploy `a442266e-b30d-4042-8c67-5530181a368b`
  **SUCCESS 21:42:25Z / 17:42:25 ET**; `/api/health` uptime 16 → 28 → 40 s on the new boot.
- **Post-deploy smoke** (member-smoke, 1280): the tab renders with no placeholder, four presets apply, the readout
  populates, **zero console errors**, **exactly one** `/api/breadth-monitor?days=365` on the tab switch and **zero**
  further data calls across 13 interactions, CLS 0.0 (0.0001 on a date change). Frames local, gitignored:
  `screenshots/deploys/a9290e7f4/`.
- **A-19 measured on the live build** (`00-discovery.md` §7, manifests in `screenshots/after-c3/<width>/`):

| width | controls under 44 px, default state | picker expanded |
|---|---|---|
| 390 | 4 → **1** | 65 → **30** |
| 768 | 14 → **1** | 77 → **30** |

  17 of 17 states improved at each width, none regressed. Every residual is an 18 × 18 native checkbox glyph inside a
  `<label>` row that now carries `min-height: var(--tap-min)` — the member's tap target is the 44 px row, so this is a
  residual, not a failure.
- ⚠️ **Out of scope, raised for the Monitor owner:** at 768 the Breadth page lands on Monitor, whose Time Navigator fires
  32 sequential `days=150&end=…` requests back to 2008 on page load — 66 API calls before a member can reach Data Charts.
  Pre-existing (identical in `before.json`), not caused by this program, and it cost this pass one capture: the tab's own
  call missed a 45 s wait while the pod was busy, and 768 had to be re-run alone.

## Phase 3 — R1 Task 1 (2026-09-13)

- `0dd21c248` — `app/src/pages/breadth/heatmapRegistry.golden.{test.js,json}`. The golden pins what the heatmap
  registry is today, before R1 moves it under `chartMetrics.js`: 53 rows (46 tiles, 16 drill keys), the treemap's 29
  items, the 5 forward-filled keys and the 29 percentile keys, serialised field by field with `getTier`/`getFmt` by
  source so an object rebuilt elsewhere still compares equal only if every field matches.
- Generated once with `WRITE_HM_GOLDEN=1` on the pre-move tree, then re-run without it — 7 passed. Five controls prove
  the comparison can fail (renamed label, dropped drill key, reordered list, changed tier function, nudged treemap
  weight) plus a size floor so an empty serialisation cannot satisfy an empty golden.
- `src/pages/breadth` green: 90 files, 1,007 tests. ⚠️ "Run its shard alone" is not addressable — Vitest partitions by
  hashing spec paths and `vitest list` ignores `--shard` — so the directory was run instead, which is the superset.
- Next: R1 Task 2 (`METRIC_META`), then Task 3 (the heatmap reads the registry), then gate and merge.

## Security — member-smoke credential rotated (2026-09-13 18:50 ET / 22:50 UTC)

- **Leak.** `tools/breadth_widget_ab.py` printed a raw Playwright teardown exception; its call log carried a live
  `Cookie:` header, putting a `MEMBER_SMOKE` session token into a run log and the agent's tool output.
- **Rotation** (18:38–18:45 ET): `POST /api/auth/admin/reset-password` → member login with the new value (200) →
  `POST /api/auth/sessions/revoke-others` → **104 revoked**, control re-run **0**. Member-view probe
  `/api/breadth-monitor?days=5` → **200**.
- **Leaked token verified dead**: `/api/auth/me` → **401** (one read-only request, tokens redacted everywhere).
- **Where the value was updated**: the operator's user environment only. All five Railway services swept by key name —
  none carries `MEMBER_SMOKE_PASSWORD`. **No redeploy, no deploy in flight.**
- ⚠️ `setx` does not reach a running agent: shells spawned by this session inherited the pre-rotation environment, so
  rig runs read the value from the registry at run time until the agent restarts.
- **Artifacts**: run logs and task outputs deleted; `git log -S` and `git grep` both clean across every commit and file.
- **Hardening** `7117c87fa` — one shared scrubber (`tools/secret_scrub.py`), `brief(exc)` replaces raw exception
  printing, `tests/test_secret_scrub.py` (6 passed) with a planted-leak non-vacuity control, and
  `docs/runbooks/rig-credential-hygiene.md`. Ledger: D-038.

## Phase 3 — R1 Task 3 (2026-09-13)

- `6d944b8c8` — `heatmapMetrics.js` is a thin adapter: 46 tile heads lost their typed `label`/`drillKey`, 54 entries
  preserved, `HM_METRICS = TILE_DEFS.map(named)`, `FFILL_KEYS = [...WEEKLY_METRICS]`. Section captions (`isHeader`)
  keep their own text — they are the tile taxonomy and name no metric.
- **The Task 1 golden passed 7/7 UNCHANGED and UNREGENERATED**, which is the acceptance criterion for all of R1
  (D-037). One finding it forced: deriving `WEEKLY_METRICS` from `METRIC_META` alone reordered `FFILL_KEYS`
  alphabetically, so the fix went into the source (derive from `ALL_METRICS` catalog order), not the fixture.
- Green: 35 files / 465 tests across the breadth registry rails, the golden and every `/charts` widget.
- **Master moved** `a9290e7f4` → `bd57ffaf7` (4 commits). Delta rule: incoming `app/**` = **0**, overlap = 0, import
  edges = 0 → **Rule 3** — merge (`34f8f9cef`) + one targeted run by explicit file list, **28/28**. No full re-gate owed.

### Section C — the `/charts` Breadth widget, verified across two builds

`tools/breadth_widget_ab.py` (`f1ebc90d8`, corrected through `331df3c56`). The rig only navigates to `/breadth`, and
`/charts` shows a Breadth widget only if `charts_workspace_layout` holds one — neither default layout does.

- **1280px — TEXT IDENTICAL** (752 chars, 99 lines), widget-scoped. Both sides built from the same worktree and the
  same `node_modules`, the two registry files swapped from `origin/master` and restored by bytes with the sha verified.
- **390px — NOT APPLICABLE, and that is a product fact**: below 640px `ChartsWorkspace` bypasses react-grid-layout and
  renders `MobileWorkspace`, which understands chart widgets only ("No chart in this layout yet."). The `/charts`
  Breadth widget **has no phone surface**. Screenshot kept as the evidence.
- **The account was never written to**: the layout is injected into the preferences GET; every preferences POST is
  blocked and counted (`pref_writes_blocked`). `/api/auth/me` through the rewrite = 200 (the non-vacuity control).
- Pixels reported but **not the verdict** — 0.37% at 1280 — because the gold icon shimmer and the voice orb animate.
- ⚠️ Production was mid-churn from an unrelated workstream (5 web deploys in 16 min, `REMOVED`/`BUILDING`): login
  returned an edge 502 in 0.2s while `/api/health` read 200 with a rising uptime. Retried 5xx only, attempts recorded.
- ⛔ **R1's master merge is NOT taken**: a deploy from another session was `BUILDING`, and the standing rule is one
  master merge at a time with `web` SUCCESS before the next push.

## Phase 3 — B1, the dark series endpoint (2026-09-14)

- `ce58497d2` — **not this programme's**: `VITE_CHART_RENDER_TOKEN_PREVIOUS` was read by `app/src/lib/renderToken.js:19`
  (added `4821ec3f2`, OI-19 dual acceptance) with **no `ARG` in `Dockerfile.web`**. Railway drops an undeclared build
  arg silently, so `PREVIOUS` baked as `''` and the dual-acceptance window never existed. Fixed here because it
  reddened a shared rail; one ARG + its ENV mirror, nothing else.
- `6e9c8dcaf` — `VITE_BREADTH_CHARTS_V2_ENABLED` declared as a build ARG ahead of V2-1. Its **ledger row is
  deliberately deferred** to V2-1's first read (`test_no_stale_build_flag_rows` = `declared ⊆ names_read`).
- B1 — `GET /api/breadth-monitor/series`, dark behind `BREADTH_SERIES_ENDPOINT_ENABLED`, ledger row in the same commit.
  Contract: `docs/breadth/api-series.md`. Ruling: D-041.

**Measured cost** (B1's marginal filter + project + encode, 8 keys; the history reader stubbed at full size because
`C:\data\breadth_monitor.db` is 12 KB — schema only — and timing an empty table would flatter):

| span | sessions | payload | cold p50 | cold p95 | warm |
|---|---|---|---|---|---|
| 365d | 252 | 15 KB | 8.8 ms | 11.4 ms | 5.8 ms |
| 5y | 1,260 | 75 KB | 13.1 ms | 14.8 ms | 5.2 ms |
| 2008– (18y) | 4,530 | 270 KB | 30.3 ms | 36.0 ms | 6.5 ms |

→ **Downsampling deferred**: the ~1 s trigger is ~33× away.

### B1 merged and live (2026-09-14 01:24 ET / 2026-09-14T05:24:57Z)

- Merge **`5a0e224f4`** · deploy **`5582d6d4`** SUCCESS 2026-09-14T05:21:36Z · commits `ce58497d2` (render-token
  ARG, not ours), `6e9c8dcaf` (V2 build arg), `256e7dcd2` (B1).
- Gate: **437 passed**, scoped backend suite (backend-only change — the six-shard vitest gate cannot see it).
- Delta rule: **Rule 1** — D was 1 file (`tools/terminal_next_weekly.cmd`), `api/**` 0, tests 0, `app/**` 0,
  overlap 0, nothing the endpoint imports. Merge and push, no re-gate.
- Flow-worker: **not exposed** — watch coverage OK; the router is not in its import closure and `api/services/cache.py`,
  which is, is untouched.
- **Post-deploy dark verification** (evidence: `docs/breadth/screenshots/deploys/5a0e224f4/b1-dark-verification.json`):
  `/api/breadth-monitor/series` → **404 anonymous**, **404 member-smoke (paid)**; `/api/breadth-monitor?days=5` →
  **200, 5 rows**, unaffected. ⚠️ No free-tier smoke account exists on this box, so that caller class is covered by the
  offline rail (`test_flag_unset_is_404_for_every_caller_class[FREE_MEMBER]`) rather than in production.

### B1 cost bound — production upper bound via the monitor endpoint (2026-09-14, off-peak)

`get_history_deep` caches its rows **300 s** (`cache.set(ck, out, ttl=300)`), the same window as B1's byte cache, so
both expire together and the cold path is what matters. Cold was forced by varying `end=`, which changes the server
cache key.

| request | rows | payload | cold | warm |
|---|---|---|---|---|
| `days=90` no `end` | 90 | 146 KB | 1,018 ms | 166 ms |
| `days=8000` no `end` | 4,703 | 4.96 MB | **54,923 ms** | 676 ms |
| `days=365` + `end=` | 365 | 455 KB | 10,498 ms | 1,912 ms |

→ **The ~1 s bound is breached by ~55×.** `bucket=` is NOT implemented because it cannot help: the cost is in producing
the rows, upstream of any bucketing (D-042). **B1 stays dark**; the flag must not be enabled until the reader cost is
addressed. The hazard is pre-existing and live on the shipped monitor route, not introduced by B1.

⚠️ Earlier in the same session three heavy cold reads fired back-to-back all returned ~32–38 s regardless of span —
**that flatness was contention on the single process, not the true per-span cost.** The split measurement above, with
pauses, is the one to trust.
