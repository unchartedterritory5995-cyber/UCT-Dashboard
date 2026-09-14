# RESUME — Breadth → Data Charts overhaul

Checkpointed for a machine restart on 2026-09-13 at 15:10 ET.

- **Worktree:** `C:/Users/Patrick/uct-worktrees/breadth-charts`
- **Branch:** `feat/breadth-charts`
- **WIP commit:** `3cbf9a391` (`wip(breadth): checkpoint before restart 2026-09-13 15:10 ET`). This file is committed immediately after it.
- **Pushed:** yes. The branch is pushed to `origin/feat/breadth-charts` with this file. C3 is **not** on master.
- **Where we are:** Phase 3 (implementation), merge **C3 touch & ARIA**. All three tasks are committed and their mutation proofs pass. The six-shard gate was stopped at shard 2 of 6 for the restart.

## Done

1. **C1 honest states** is merged and live as `d6ac61816`. Web reached SUCCESS at 17:49:16Z. A member rig run on production confirmed the 401, 402, 500 and network sentences at 1280 and 390 px.
2. **C2 chart mechanics** is merged and live as `0148ef52d`. Web reached SUCCESS at 18:52:51Z, with uptime reset and `wire_date` at 2026-09-11. Its mutation proofs caught 9 of 9, and its gate failing set was identical to C1's.
3. Plans and decisions for C3, R1 and B1 are committed in `0148ef52d`:
   - `docs/superpowers/plans/2026-09-13-breadth-charts-{c3-touch-aria,r1-one-registry,b1-series-endpoint}.md`
   - D-032 to D-035.
4. **C3 Task 1** `16baf13f0`: More is a disclosure of buttons with Escape returning focus. It touched:
   - `app/src/pages/breadth/PresetRow.jsx`, `PresetRow.test.jsx`
   - the `clickPreset` helper in `BreadthCharts.test.jsx`
   - the preset helpers in `tools/breadth_charts_rig.py`
5. **C3 Task 2** `4dd8486da`: group toggles got `aria-expanded`/`aria-controls` and Notable Extremes got `aria-pressed`. Files: `BreadthCharts.jsx`, `BreadthCharts.a11y.test.jsx`.
6. **C3 Task 3** `add4afeaa`: finger targets now sit on the ≤1024 px tier with `var(--tap-min)`. Files:
   - `BreadthCharts.module.css`, `breadth/MetricReadout.module.css`, `breadth/PresetRow.module.css`
   - new rail `breadth/tapTier.test.js`
7. **C3 mutation proofs caught 6 of 6.** The control run was green, bytes were restored and the tree was clean. Each mutation and the test that failed:
   - `aria-expanded` dropped → a11y "say whether their list is open"
   - `aria-pressed` dropped → a11y "says whether it is on"
   - Escape focus return dropped → PresetRow Escape test
   - `role="listbox"` put back → "claims no listbox or option role"
   - `.metricItem` touch rule dropped → tapTier
   - MetricReadout `.item` touch rule dropped → tapTier
8. Pre-merge green run for C3:
   - PresetRow 9/9, BreadthCharts 27/27, mechanics 8/8, a11y 2/2, tapTier 12/12, chartWrapLayout and tokens.
   - The app-wide `tapFloor` still names only the baseline's `CaptureDialog.module.css: .actions`.
9. `docs/breadth/gates.md` holds the baseline, C1 and C2 sections. `docs/breadth/STATUS.md` has entries through "C2 merged" plus the checkpoint line.

## In progress

- **C3 gate**, stopped for the restart, on `add4afeaa`:
  - shard 1: 3 failed / 218 passed files
  - shard 2: 1 failed / 219 passed / 1 skipped
  - both consistent with C2
  - shards 3–6 never ran
  - partial logs live in the session scratchpad and are **not** valid evidence
- **No file is partially written.** The tree was clean at the checkpoint.
- **Not yet written** (the next session writes them after the gate):
  - the `gates.md` C3 section
  - the STATUS entries "C2 in production" (`0148ef52d`, web SUCCESS 18:52:51Z, uptime 26→41→56 s; the brief `wire_date: null` seen before the push came from another session's boot of `d32d14d60`) and "C3 touch & ARIA — MERGED", with a fix table, mutation line, gate line and this member summary:
    > On tablets, Data Charts' buttons, date fields, checkboxes and readout chips are now finger-sized, as they already were on phones. Screen readers hear More as a list of buttons that opens and closes, metric groups say whether they are expanded, and Notable Extremes says whether it is on; Escape returns you to the More button.

## Next

1. **Re-run the C3 gate** on a clean tree from the worktree root, in the background and alone:
   `python scripts/gate_shards.py --shards 6 --out <scratchpad>/gate-c3`
   - C3 passes if its failing set equals the C2 set in `gates.md` (the same nine tests).
   - Reachability must still name only `lib/context/focusDivergence.js`; polling sites only the four listed files; tap floor only `CaptureDialog.module.css: .actions`.
   - Re-run any differing load-sensitive name alone before classifying it.
2. **Record and ship C3:**
   - Add the `gates.md` C3 section and the two STATUS entries above.
   - `git fetch origin`, then `git merge origin/master` (never rebase), then check overlap with C3's files.
   - Run `python tools/flow_worker_watch_coverage.py`, then commit with named paths.
   - Guard the push:
     - origin/master is an ancestor of HEAD;
     - `git diff --name-only origin/master HEAD` has no png/json/csv, `screenshots/` or `measurements/` except `docs/breadth/mock/renders/*.png`;
     - `railway deployment list --service web --json` shows no BUILDING or DEPLOYING.
   - `git push origin feat/breadth-charts && git push origin feat/breadth-charts:master`
   - Watch web SUCCESS for the SHA, then confirm `/api/health` uptime reset with a browser User-Agent.
3. **Member check at tablet and phone widths**, then start R1:
   - `python tools/breadth_charts_rig.py --widths 768,390 --no-failures --out docs/breadth/screenshots/after-c3 --json docs/breadth/measurements/after-c3.json`
   - Compare controls under 44 px against `docs/breadth/measurements/before.json` → `geometry.default.<width>.under44`: 768 px was 14, 390 px was 4. Strip values from names at the first comma, and never print or commit them.
   - Then start **R1** per `docs/superpowers/plans/2026-09-13-breadth-charts-r1-one-registry.md`, beginning with Task 1 (the golden serialisation of today's `HM_METRICS`).

## Blocked / waiting

- **Deploys:** nothing in flight. C2 web was SUCCESS at 18:52:51Z. No merge is mid-flight.
- **C3:** waiting on its gate (Next 1).
- **Owner (Phase 6), not blocking:**
  - GitHub support purge of exposed commit `b98ce804b` (D-018)
  - the V2 flip decision
  - real-device and BrowserStack passes
  - the collector asks in `docs/breadth/collector-asks.md`

## Background processes to restart

- **None persistent.** This session started no dev server, tunnel, watcher or rig that must be brought back.
- **The only long process** was the C3 six-shard gate, stopped at shard 2. Re-run it as Next 1, from the worktree root:
  `python scripts/gate_shards.py --shards 6 --out <scratchpad>/gate-c3`
- **Unattributed node processes:** `node.exe` processes were visible on the box at the checkpoint, and none could be attributed to this worktree. Do not kill them; they may belong to other sessions.

## Open decisions

- **C3 residual under 44 px:** native checkboxes are 18 px elements inside labels that now reach 44 px. The rig may still count them. Leaning: report them as a residual whose hit target is the 44 px label, not as a failure.
- **B1 docstring:** the `api/routers/breadth_monitor.py` module docstring says `le=3650` while the route has `le=8000`. Leaning: correct the docstring inside B1, since it's the tab's own fetch path.
- **B1 dark behaviour:** the flag check is a dependency declared **before** `require_paid`, so the dark route answers 404 to everyone. FastAPI 0.115.6 resolves dependencies in order (`fastapi/dependencies/utils.py:592`). This is decided and written in the plan.
- **R1:** the nine heatmap-only keys join `METRIC_META`, not the picker. Decided (D-034).

## Ledger state

- **`docs/breadth/STATUS.md`**, last line: `- 2026-09-13 15:10 ET — Checkpointed for machine restart at 15:10 ET; see [RESUME.md](RESUME.md).` The previous section is "Phase 3 — C2 chart mechanics — MERGED (2026-09-13)".
- **`docs/breadth/DECISIONS.md`**, last entry: `### D-035 · The series endpoint is columnar, oldest-first, at most eight keys, cached as bytes under breadth_history_, and dark as a 404`.
- **`docs/breadth/gates.md`**, last section: `## C2 chart mechanics (2026-09-13 13:45)` with verdict "no new failure".
- **Plans:** `docs/superpowers/plans/2026-09-13-breadth-charts-{c1-honest-states,c2-chart-mechanics,c3-touch-aria,r1-one-registry,b1-series-endpoint}.md`.
- **Merge order:** D-017, with C1 ✅ C2 ✅ C3 (gating) → R1 → B1 → V2-1 … V2-5 → Phase 4 before/after → Phase 5 flip packet → Phase 6 manual list.

## Gotchas

- ⛔ **The repo is PUBLIC.** Never commit screenshots, measurement JSON, captured payloads or metric values. `docs/breadth/.gitignore` covers `screenshots/`, `measurements/` and `mock/data/`. Check `git diff --cached --name-only` before every push.
- **One test gate at a time on this machine.** `gate_shards.py` refuses a dirty tree and records HEAD at both ends. Make no edits or commits while it runs, and never merge on an INVALID manifest.
- **Pass = identical failing set.** Master has nine failing tests owned by other sessions; names and owners are in `gates.md`. Load timeouts are re-run alone before classifying: pollingSites "wrapper exempts itself", presentationSingleFormatter, EvidenceTab.doors, importer/convert.
- **One master merge at a time.** Wait for web SUCCESS before the next push. Push with `feat/breadth-charts:master`, never force, never rebase. The push authorization is standing in the program brief.
- **Member checks use `MEMBER_SMOKE_EMAIL` / `MEMBER_SMOKE_PASSWORD`,** never the admin smoke account. The rig logs in once, because of a 5/min limiter.
- **Out of scope:** do not touch `app/src/pages/journal-2-0/`, `lib/offline/`, `OptionsFlow.jsx` or the collector repo.
- **Flags:**
  - `BREADTH_SERIES_ENDPOINT_ENABLED` (B1, dark, per request, unset → 404)
  - `VITE_BREADTH_CHARTS_V2_ENABLED` (V2, a Dockerfile.web build arg registered in `docs/feature_flags.json` → `build_flags` per D-001). Confirm the entry exists before V2-1.
- **Tests:**
  - Run from `app/` with `npx vitest run <files>`. The full suite runs only through `gate_shards.py`.
  - Backend pytest must name its files; never `pytest tests/`.
  - Check the totals line, not the exit code.
- **jsdom component tests** need `<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>`, or SWR's refocus refetch fires. Build fixture dates from `breadth/sessionDates` (`todayET`/`shiftISO`), never `toISOString()`.
- **Mutation proofs** restore by writing saved bytes, never `git checkout`, and a green control run comes first.
- **Tooling on this box:**
  - Bash `cd` persists between calls, so use absolute paths.
  - A heredoc Python script once failed on quoting; write scripts to a file and run it.
  - Railway and `/api/health` need a browser User-Agent for curl (Cloudflare 1010).
- **Owner-facing final message format** (from the program brief): links to `01-audit.md`, `03-before-after.md`, `DECISIONS.md`, `collector-asks.md`, the flip packet and the Phase 6 list, and nothing else.
