# OPS-SPEED: tooling that makes lanes faster and stops rework

All in `docs/pine/parity-programme/scripts/`. Existing call signatures are unchanged. Source `env-desktop.sh` first.
Self-tests below were run on the desktop, branch `ops/pine-tooling-speed`.

## 1. measure-pair BASE CACHE (`measure-pair.sh`)
The base side (2nd pair argument) is reused when the cache key matches. Cache: `$UCT_RESUME/mp-cache/<key>/`.
Key = base commit SHA + side name + runtime lane + census flag + node version + sha256 of every measuring input:
the audit test, probe test, the harness corpus test, `app/node_modules/.package-lock.json` and `vitest/package.json` (the
installed toolchain, since node_modules is a junction into pine-base), `app/package-lock.json`, any `app/.env*`, and with
census on `run_census.py` + `ref_rebuilt.json` + the whole pine-sample listing; with `REV_DIR` the reviewer test + `probes*.json`.
NO KEY (a miss, nothing filled) when any of these hold, with the reason printed (`cache: no key (...)`):
- an output-changing environment variable is set, even to an empty value (r1 B1). The list, grepped from `audit/zz*.js`,
  `run_census.py`, `vendorHarness/*.js` and the engine's `import.meta.env` / `process.env` reads, is the regex `MP_ENV_RE` at
  the top of the cache section: `AUDIT_C18_*` (LIMIT, ONLY, NORT, OUT), `VENDOR_*`, `VITE_*` (`VITE_PINE_MEMBER_PANE_ENABLED`,
  `VITE_VOLUME_NUMERIC_PANE_ENABLED`, `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED`), `PINE_*`, `RUNTIME_*`, `OOS_*`, `COVERAGE_*`,
  `RT<digit>*`, `UIE_*`, `RF_*`, `F4_*`, `O1_*`, `B1_*`, `CAP3_*`, `CAPABILITY_*`, `TS_CORPUS*`, `VAR_*`, `BOOL_*`, `HISTORY_*`,
  `EXECUTION_*`, `FORMULA_*`, `MULTI_*`, `PARAM_*`, `PERIOD_*`, `SESSION_*`, `SCREENER_*`, `P3_*`, `H1_*`, `C46_*`, `BAR_INDEX*`,
  `NODE_OPTIONS`, `NODE_ENV`, `MODE`, `GUARD`, `REV_PROBES`, `REV_OUT`. Add more per machine with `MP_CACHE_EXTRA_ENV` (a regex).
  `AUDIT_SRC`, `AUDIT_FILE` and `REV_DIR` are the script's own and are keyed by content instead.
- the base tree has ANY change: tracked, staged, or untracked (the audit lists `corpus/` and `tests/fixtures/` directories), or an
  ignored file under `corpus/`, `tests/fixtures/` or `app/src` (r1 B2).
- an input is unreadable, an entry has no `COMPLETE`/`MANIFEST`, or its manifest does not verify (r1 B3, B4).
A miss runs as before. The base side's old outputs are deleted first (`side_clean`), so anything present afterwards was written
by this run. The cache is FILLED only when HEAD did not move, the tree is still clean, and every step line reported `rc=0`
(all steps present: audit, probe, harness, plus census / six rev probes when on). The entry stores a sha256 MANIFEST of every
file; restore verifies it (and that no unlisted file exists) before copying, else it is a miss. Written to a temp dir, then renamed.
A hit prints `BASE CACHE HIT <key>`, restores the files, replays the recorded rc lines, and skips the side. `MP_CACHE=0` disables.
The tip side is never cached. `BASE_HEAD <sha> <time> before|after <side>` lines are printed around each side; if HEAD moved the
script prints `BASE_HEAD MOVED`, does not fill the cache, and exits 4. `MP_SOURCE_ONLY=1` sources the functions without running (self-tests).

## 2. final-tip.sh
- Refuses a tree with tracked changes OR untracked files (except `.uct-session-owner`; the `app/node_modules` junction is
  gitignored): prints them, exit 5, nothing written (r1 B7).
- Prints and writes `TIP <sha> <time>` to `<outdir>/TIP` at the start (stale TIP/FINAL_DONE deleted first).
- Writes `<outdir>/FINAL_DONE` at the end: line 1 `TIP <sha> done`, then `scope=.. shards=.. parallel=..`,
  `rc gate=.. hyg=.. py=.. js=..` (py is NA with no extra pytest files), `shard_rcs=..`, `totals=ok|missing|na`,
  `jsfail=<failing test files>|none`, `integrity=ok|...` (r1 B5). Before writing it re-checks that HEAD still equals the TIP sha
  and the tree is clean; otherwise `integrity` says what moved.
- Exit 6 (INCOMPLETE) when a vitest run or any shard reported no `Tests` totals line (an OOM-killed shard), or integrity failed
  (r1 B6, B7). Test failures alone still exit 0; ready-check judges them.
- `FINAL_TIP_SCOPE=affected`: gate pytest + hygiene + extra pytest as before, then vitest `--changed <FINAL_TIP_BASE>`
  (default `merge-base HEAD origin/master`, `--passWithNoTests`) plus `FINAL_TIP_RAILS` (space-separated vitest paths
  relative to `app/`). FINAL_DONE says `scope=affected`, and ready-check REFUSES it. Default `full` is unchanged.
- `FINAL_TIP_SHARDS=N`: the full vitest runs as `--shard=i/N`, sequentially, or all at once when `FINAL_TIP_PARALLEL=1`.
  Per-shard logs `js-shard<i>.log`; `AGG Test Files` / `AGG Tests` sums the counts and `AGG INCOMPLETE` is printed when a shard
  reported none. `FINAL_TIP_WORKERS` (default 2) is `--maxWorkers` PER process, so parallel shards use N x that many workers.

## 3. ready-check.sh `<worktree> <outdir>`
One-line verdict, exit 0 PASS / 1 FAIL. PASS needs: local branch == `origin/<branch>` (after a fetch); no tracked changes and
no untracked files other than `.uct-session-owner`; `<outdir>/TIP` and `FINAL_DONE` present and naming the same sha; that
sha is the last commit touching a non-docs path or a later one, an ancestor of HEAD, with only `docs/` changed since; AND the
FINAL_DONE record shows `scope=full` (shards allowed; affected never passes), `integrity=ok`, `totals=ok`, gate and hygiene
rc 0, py rc 0 or NA, and js rc 0 or ONLY failures in the named baseline allowlist `BASELINE_FAIL_RE`
(`pollingSites.rail`, `settingsScope.rail` test files, by name). A js rc != 0 with no named failing file (a crash) fails.
An old-format FINAL_DONE (no `integrity=`) fails. The PASS line carries scope, rcs and the baseline failures it tolerated.

## 4. lane_env `<lane>` (env-desktop.sh)
Sets `RUN=$UCT_RESUME/runs/<lane>/` (created) and `LOCK_MUT LOCK_MP2 LOCK_MP3 LOCK_FINAL2 LOCK_FINAL3` =
`$UCT_RESUME/dsk/heavy-<kind>-<lane>.lock`. Use: `"$UCT_PY" "$HEAVY_LOCK" run --path "$LOCK_FINAL2" -- bash $RUN/job.sh`.
Prints an error and returns 1 (exports nothing, creates nothing) if the lane name is unsafe or any path resolves under
`C:/Users/Patrick/.claude/` (case-insensitive, Windows or POSIX spelling).
`ram_gate` (waits until free RAM >= 6000 MB, `RAM_GATE_MB` overrides; gives up after `RAM_GATE_MAX_WAIT`, default 6 h, so it
always ends) runs before every lock acquisition: `hl` calls it, and `lock_run <LOCKVAR> <label> -- cmd...` is the lane-lock
equivalent (`lock_run LOCK_FINAL2 mylane-final -- bash $RUN/job.sh`). Prefer `lock_run` over raw `heavy_lock.py run`.
`hl` now also waits for (or, after the cap, refuses below) 6000 MB free: a behaviour change for existing callers.
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
- measure-pair BASE CACHE (pine-dsk-mpbase2 at b8e86984, HEAD identical before and after every side, runtime 1, census 0):
  run 1 = MISS then FILLED, base side 465 s (22:04:17 to 22:12:02); run 2 = `BASE CACHE HIT b8e869840657-rt1-cen0-base-3be8c27fca46f109`,
  base side 2 s. Saving 463 s per base side (whole run 835 s to 562 s; the remainder is the tip side). Cached out-base.json,
  probe-base.json and harness-base are byte-identical to the fresh run's.
- final-tip FULL, FINAL_TIP_SHARDS=2 FINAL_TIP_PARALLEL=1 (--maxWorkers=2 each, so 4 workers) on a docs tree: vitest phase
  22:33:55 to 23:01:47 (28 min; gate pytest alone is 4 min). `AGG Test Files 2 failed | 1321 passed | 27 skipped`,
  `AGG Tests 2 failed | 22230 passed | 118 skipped | 1 todo`; the two failures are the known baseline pair
  (pollingSites.rail, vendorHarness coverage audit) on this older-master tree. RAM: free fell from 9.3 GB to a 2.7 GB minimum
  (about 6.5 GB for two parallel shards; other sessions were running too, so treat it as an upper bound). Sequential shards
  need the RAM of one. With the box under 6 GB free, use sequential shards or none.
- final-tip AFFECTED (`FINAL_TIP_BASE=HEAD~1`, a made-up rails path): the mode ran and wrote TIP/FINAL_DONE (scope=affected);
  `--changed` hit an unhandled `@picovoice/web-voice-processor` resolve error because this worktree borrows pine-base's
  node_modules (older tree), and the fake rails path reported "No test files found". That is the environment, not the
  script; use it on a lane worktree with its own matching node_modules. Total 438 s, nearly all of it the 4 min gate pytest.
- ready-check dogfood: this branch passes it against the opsspeed-shard TIP.
- ram_gate / lock_run: gate passes at a low threshold, gives up (rc 1) when the wait cap is 0, and lock_run ran an echo under
  a lane lock.

## Review r1 fixes: self-tests, OLD (36bc5aa) vs NEW (run through `lock_run` after `ram_gate`; scripts in `_resume-2026-11-01/dsk/opsspeed-r1/t_mp.sh`, `t_ft.sh`)
- B1 key with `AUDIT_C18_LIMIT=20`: OLD key identical to the full run's (truncated base would be served); NEW no key. Same for `VITE_PINE_MEMBER_PANE_ENABLED`, `AUDIT_C18_NORT`.
- B2 untracked `tests/fixtures/pine/*.pine` and an ignored `corpus/` file: OLD key unchanged; NEW no key.
- B3 changed `app/node_modules/.package-lock.json`: OLD key unchanged; NEW different key.
- B4 a run whose steps reported `rc=1` with stale outputs present: OLD FILLED the cache; NEW refused. A cache entry whose file was altered: OLD restored it; NEW manifest check refused it (miss). `side_clean` removes stale outputs before the side runs.
- B5/B6 on a fake repo with a stub vitest (FINAL_DONE records, then ready-check): OLD printed `READY-CHECK PASS` for affected scope, a non-baseline js failure, a js crash with no totals, and a dead shard. NEW: affected FAIL (scope), non-baseline failure FAIL (named file), crash FAIL (totals=missing, final-tip exit 6), dead shard FAIL (exit 6, `shard_rcs=0,137`), baseline-only `pollingSites.rail` failure PASS, clean full and 2 parallel shards PASS.
- B7 untracked file: OLD ran and wrote FINAL_DONE; NEW exit 5. HEAD moved during the run: NEW `integrity=HEAD-moved-to-..`, exit 6, ready-check FAIL. File written during the run: NEW `integrity=tree-changed-during-run`, exit 6.
- Not re-run end to end on pine-dsk-mpbase2 after r1: `heavy-mp2.lock` was held by another lane for over 70 min and the queued job was cancelled. The pre-r1 end-to-end result above (miss 465 s, hit 2 s, byte-identical outputs) used the old key format; the r1 key, fill and restore logic is covered by the function-level tests above.
- r2 B8: FINAL_DONE also records `errors=N` (vitest `Errors  N error` summary lines, summed) and `shard_errors=` per shard; ready-check FAILs on any non-zero (an unhandled error has no FAIL line, so it could hide beside a baseline failure). Fixture (baseline pollingSites FAIL + `Errors  1 error`): OLD ready-check PASS, NEW FAIL `errors=1`; baseline-only and clean runs still PASS.
