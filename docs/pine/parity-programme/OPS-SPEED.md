# OPS-SPEED: tooling that makes lanes faster and stops rework

All in `docs/pine/parity-programme/scripts/`. Existing call signatures are unchanged. Source `env-desktop.sh` first.
Self-tests below were run on the desktop, branch `ops/pine-tooling-speed`.

## 1. measure-pair BASE CACHE (`measure-pair.sh`)
The base side (2nd pair argument) is reused when the cache key matches. Cache: `$UCT_RESUME/mp-cache/<key>/`.
Key = base commit SHA + side name + runtime lane + census flag + node version + sha256 of every measuring input copied in
(audit test, probe test, the harness corpus test, `run_census.py` + `ref_rebuilt.json` + the whole pine-sample listing when
census is on, and the reviewer test + `probes*.json` when `REV_DIR` is set). Any doubt is a miss: a dirty tracked base tree,
an unreadable input, an incomplete entry (no `COMPLETE` marker), a moved HEAD. A miss runs as before and fills the cache
(written to a temp dir, then renamed). A hit prints `BASE CACHE HIT <key>`, restores the files into `<outdir>`, replays the
recorded rc lines, and skips the side. `MP_CACHE=0` disables. The tip side is never cached.
`BASE_HEAD <sha> <time> before|after <side>` lines are printed around each side. If HEAD moved, the script prints
`BASE_HEAD MOVED`, does not fill the cache, and exits 4 (no `MEASURE_DONE`).

Self-test (pine-dsk-mpbase2 at `b8e86984`, restored/unchanged after; runtime lane 1, census off, tip and base both that
worktree, under `heavy-mp2.lock`): see Results.

## 2. final-tip.sh
- Refuses a tree with tracked changes (prints them, exit 5, nothing written).
- Prints and writes `TIP <sha> <time>` to `<outdir>/TIP` at the start (a stale TIP/FINAL_DONE is deleted first); writes
  `<outdir>/FINAL_DONE` (`TIP <sha> done scope=.. shards=..`) at the end.
- `FINAL_TIP_SCOPE=affected`: gate pytest + hygiene + extra pytest as before, then vitest `--changed <FINAL_TIP_BASE>`
  (default `merge-base HEAD origin/master`, `--passWithNoTests`) plus `FINAL_TIP_RAILS` (space-separated vitest paths
  relative to `app/`, the lane's named rails). Default `full` is unchanged.
- `FINAL_TIP_SHARDS=N`: the full vitest runs as `--shard=i/N`, sequentially, or all at once when `FINAL_TIP_PARALLEL=1`.
  Per-shard logs `js-shard<i>.log`, concatenated into `js.log`, and an `AGG Test Files` / `AGG Tests` line sums the counts.
  `FINAL_TIP_WORKERS` (default 2) is `--maxWorkers` PER process, so parallel shards use N x that many workers.
  Affected mode is NOT a substitute for the full run on the lane's final tip unless the coordinator says so.

## 3. ready-check.sh `<worktree> <outdir>`
One-line verdict, exit 0 PASS / 1 FAIL. PASS needs: local branch == `origin/<branch>` (after a fetch); no tracked changes and
no untracked files other than `.uct-session-owner`; `<outdir>/TIP` and `FINAL_DONE` present and naming the same sha; that
sha is the last commit touching a non-docs path or a later one; it is an ancestor of HEAD; and `git diff --name-only TIP HEAD`
lists only `docs/` paths. `<outdir>` is the final-tip dir, `$UCT_RESUME/runs/<label>`.

## 4. lane_env `<lane>` (env-desktop.sh)
Sets `RUN=$UCT_RESUME/runs/<lane>/` (created) and `LOCK_MUT LOCK_MP2 LOCK_MP3 LOCK_FINAL2 LOCK_FINAL3` =
`$UCT_RESUME/dsk/heavy-<kind>-<lane>.lock`. Use: `"$UCT_PY" "$HEAVY_LOCK" run --path "$LOCK_FINAL2" -- bash $RUN/job.sh`.
Prints an error and returns 1 (exports nothing, creates nothing) if the lane name is unsafe or any path resolves under
`C:/Users/Patrick/.claude/` (case-insensitive, Windows or POSIX spelling).
Note: lane-scoped lock files do not exclude each other; "one heavy job at a time" across lanes is still on you, so keep
using the machine lock rule in BUILDER-RULES unless the coordinator allows concurrency.

## 5. retire-worktree.sh `<worktree>`
Only if clean (no tracked changes, no untracked files except `.uct-session-owner`) and local == `origin/<branch>`. Unlinks
`app/node_modules` with `cmd /c rmdir` only if it is a junction (REFUSES a real directory), deletes `.uct-session-owner`,
then `git worktree remove` without `--force` from the main worktree. The branch is kept.

## Results (self-tests)
- ready-check: PASS on docs-only-after-TIP; FAIL on a TIP older than the last non-docs commit, a missing FINAL_DONE, a dirty
  tree, an unpushed local commit.
- retire-worktree: refused a real `node_modules` dir and an untracked file; removed a clean junctioned worktree and left the
  junction target (372 entries) intact.
- lane_env: ok for a normal lane; refused a lane name with a space and a `.claude` UCT_RESUME (both spellings).
- final-tip dirty tree: exit 5, no output files.
RESULTS_PLACEHOLDER
