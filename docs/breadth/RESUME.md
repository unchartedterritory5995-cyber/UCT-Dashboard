# RESUME — Breadth → Data Charts overhaul

Updated 2026-09-13, 18:0x ET, after C3 reached production and R1 Task 1 landed.

- **Worktree:** `C:/Users/Patrick/uct-worktrees/breadth-charts`
- **Branch:** `feat/breadth-charts`
- **HEAD:** `0dd21c248` (R1 Task 1). Pushed through `f67b25917`; `0dd21c248` is **local only** until the next push.
- **master:** C3 is merged as `a9290e7f4` and live. R1 is NOT on master.
- **Where we are:** Phase 3, merge **R1 — one registry**, Task 1 of 4 done.

## Done

1. **C1 honest states** — merged `d6ac61816`, web SUCCESS 17:49:16 ET. Member-verified on production.
2. **C2 chart mechanics** — merged `0148ef52d`, web SUCCESS 18:52:51 ET (UTC that day; see STATUS for both stamps).
3. **C3 touch & ARIA** — merge commit `a9290e7f4` (parents `9087bc196`, `9d0512297`), pushed 17:39:56 ET, deploy
   `a442266e-b30d-4042-8c67-5530181a368b` **SUCCESS 17:42:25 ET**. Commits `16baf13f0`, `4dd8486da`, `add4afeaa`.
4. **`3512348c5`** — test-only, outside this tab: `AuthContext.test.jsx`'s `authTransient` read moved into the existing
   `waitFor` (D-036). Not folded into a product commit; named on its own line in the C3 merge summary.
5. **Post-deploy smoke** (1280, member-smoke): renders, four presets apply, readout populates, zero console errors,
   exactly one `days=365` and zero further data calls across 13 interactions, CLS ≈ 0.
6. **Post-C3 member pass at 390 and 768** — A-19 measured live: default 4 → 1 and 14 → 1, picker 65 → 30 and 77 → 30,
   17 of 17 states better at each width, none worse. Residuals are 18 px checkbox glyphs inside 44 px label rows.
   `00-discovery.md` §7; manifests in `screenshots/after-c3/<width>/` (gitignored).
7. **`COVERAGE.md`** — the original brief recovered verbatim and mapped line by line: defects (a)–(k), phases, standing
   rules, and the brief's own Phase-3 test list, with three owed items given homes (V2-1, V2-3, Phase 4).
8. **R1 Task 1** — `0dd21c248`: `heatmapRegistry.golden.{test.js,json}` pins 53 rows (46 tiles, 16 drill keys), the
   treemap's 29 items, 5 forward-filled keys, 29 percentile keys. Five controls prove the comparison can fail, plus a
   size floor. `src/pages/breadth` green: 90 files, 1,007 tests.

## In progress

Nothing is half-written. The tree is clean at `0dd21c248`.

## Next

1. **R1 Task 2 — `METRIC_META` in `chartMetrics.js`**, exactly as written in
   `docs/superpowers/plans/2026-09-13-breadth-charts-r1-one-registry.md`. Failing test first
   (`chartMetrics.registry.test.js`), then the table, then `shortOf` / `drillKeyOf` / `cadenceOf` / `isChartable` and
   `WEEKLY_METRICS` derived from cadence. Own commit. Do not start Task 3 in it.
2. **R1 Task 3 — `heatmapMetrics.js` reads the registry.** The golden is the failing-test guard; add the
   "writes no label or drill key of its own" rail. Mutation-proof: change a `short`, drop a `drillKey`, type a label back.
3. **R1 Task 4 — gate, merge, verify.** Full six-shard gate (see the gates.md standing notes on partitioning and on the
   master-delta rule), then merge per the protocol: Railway idle check → push branch → merge commit to master (no ff, no
   rebase, no squash) carrying the member summary → watch web to SUCCESS → record hash, deploy ID, UTC + ET in STATUS
   and gates.md → post-deploy smoke. R1 is member-invisible, so its summary says so plainly.

After R1: **B1** (dark series endpoint) per its plan, then V2-1 … V2-5, then Phase 4 before/after, Phase 5 flip packet,
Phase 6 manual list.

## Blocked / waiting

- Nothing. No deploy of ours is in flight; master was last merged in at `9e2a30706`.
- **Owner (Phase 6), not blocking:** the GitHub purge of `b98ce804b` (D-018), the V2 flip decision, real-device and
  BrowserStack passes, and the collector asks.
- **Raised for another owner, not blocking:** at 768 the Breadth page fires 32 sequential deep-history calls (66 API
  calls) before Data Charts is reachable. Pre-existing, Monitor's, recorded in `00-discovery.md` §7.

## Background processes to restart

None. No dev server, tunnel, watcher or rig runs persistently. Long runs are started on demand:

- Gate: `python scripts/gate_shards.py --shards 6 --out <scratchpad>/gate-<name>` from the worktree root.
- Member rig: `python tools/breadth_charts_rig.py --widths <w> --no-failures --out docs/breadth/screenshots/<name> --json docs/breadth/measurements/<name>.json`.

## Open decisions

- **B1 docstring:** `api/routers/breadth_monitor.py`'s module docstring says `le=3650` while the route has `le=8000`.
  Leaning: correct it inside B1, since it is the tab's own fetch path.
- Everything else in R1 and B1 is decided in the plans and D-034/D-035.

## Ledger state

- **`STATUS.md`** last section: "Phase 3 — C3 in production, and the member pass (2026-09-13)".
- **`DECISIONS.md`** last entry: **D-036** (a flaky assertion in another area is fixed on this branch, in its own commit,
  when it reddens our gate — with the boundary that starvation is recorded, not rewritten).
- **`gates.md`** last section: "C3 touch & ARIA (2026-09-13)", plus standing notes on shard partitioning, the
  master-delta rule, and a table of all twelve baseline failures with their owning session.
- **`COVERAGE.md`**: the brief, mapped.
- **Merge order** (D-017): C1 ✅ C2 ✅ C3 ✅ → **R1 (in progress)** → B1 → V2-1 … V2-5 → Phase 4 → Phase 5 → Phase 6.

## Gotchas

- ⛔ **The repo is PUBLIC.** Never commit screenshots, measurement JSON or metric values. `docs/breadth/.gitignore` covers
  `screenshots/`, `measurements/`, `mock/data/`. Check `git diff --cached --name-only` before every push.
- **One test gate at a time**, and no edits while one runs — `gate_shards.py` records the tree hash at both ends.
- **Pass = no NEW failing test, per shard and in the union.** Twelve master-owned failures are listed with owners in
  `gates.md`; four are load-sensitive and are re-run alone before classification.
- **Shard membership is hash-partitioned and `vitest list` ignores `--shard`** — a per-shard table is worth printing, but
  a failure in a different shard is a MOVE, and "re-gate only the intersecting shards" is not a valid selection.
- **Master moves during a 35-minute gate.** Apply the rule in `gates.md`: no `app/**` and no test file → push; touched but
  no overlap and no import edge → targeted run of our tests plus theirs; overlap → full re-gate; never more than two
  consecutive full gates chasing master.
- **One master merge at a time**, web SUCCESS before the next, merge commit (no ff/rebase/squash) carrying the member
  summary and the flow-worker exposure line.
- **Member checks use `MEMBER_SMOKE_EMAIL` / `MEMBER_SMOKE_PASSWORD`**, never admin smoke. The rig waits for a pod older
  than 120 s, so a capture right after a deploy pauses by design.
- **Timestamps:** Git Bash on Windows ignores `TZ=`; use Python `zoneinfo` for ET or the stamp will be UTC mislabelled.
- **jsdom component tests** need `<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>`,
  and fixture dates from `breadth/sessionDates`, never `toISOString()`.
- **Mutation proofs** restore by writing saved bytes, never `git checkout`, and a green control run comes first.
- **Backend pytest names its files**; never `pytest tests/`. Three wisdom/discord tests error in this worktree because
  they mount the real app and `app/dist` has never been built here — environmental, not code.
- **Out of scope:** `journal-2-0/`, `lib/offline/`, `OptionsFlow.jsx`, the collector repo. Test-only fixes elsewhere are
  allowed when scoped, evidenced and isolated (D-036).
