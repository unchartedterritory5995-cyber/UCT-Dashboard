# W5-T7 pool + sandbox: evidence

Lane: W5-T7 (docs/pine/SERVER-RUNTIME-DESIGN.md section 7, P1 T7), desktop machine.
Branch `feat/pine-w5-t7-pool`, stacked on W5-T6's tip `94b46f55b1` (T6 is itself on W5-T1; neither is
merged yet, so merge origin/master in once they land). Tested on master `5d95103c8a` (the merge-base
with origin/master). Code tip checked: `cc76515bb6`. Local only: no Railway, no flags, no secrets.
HMAC keys in the rails come from T6's `helpers.mjs` (env `PINE_RUNTIME_TEST_SECRET` or the OS RNG).
Lanes used: mutations on `_resume-2026-11-01/dsk/heavy-mut.lock` (label `w5t7-mut`); final-tip on
`_resume-2026-11-01/dsk/heavy-final3.lock` (label `w5t7-final`).

## What is new
- `services/pine_runtime/pool.mjs`: `createPool({ bundle, workers })`, the runner `server.mjs` calls.
  - One job per worker at a time.
  - Priority: alert > on-demand > backtest > record > sweep, FIFO inside a profile. `PRIORITY` is held equal to `protocol.PROFILES` by a rail.
  - Per-owner in-flight cap: `{ 'on-demand': 4 }`, keyed on the request's owner HMAC. A capped owner's next job waits, and other owners pass it.
  - Queue depth: 2000. A request that does not fit is refused WHOLE with `BusyError` (429 `runtime:server-busy`), and none of its jobs is queued.
  - Per-profile deadlines: alert 15 s, on-demand 60 s, backtest 60 s, record 60 s (my choice; design 3.4 names none), sweep 120 s. A job still QUEUED at its deadline is withheld `runtime:server-busy`. A dispatched job answers by its run.
  - Hard kill: 10 s through `worker.terminate()`. The job is withheld `runtime:time-budget`, the guard read from the bundle. A killed worker is never reused and is replaced.
  - `resourceLimits` 256/32/4. A heap overrun is `runtime:server-worker-oom`; any other exit while busy is `runtime:server-worker-failed`.
  - Recycle after 500 jobs or 30 min of age, checked after each job.
  - Boot runs the L1 scan, optionally the L4 self-test (`requireL4`), and waits for every worker to load the bundle. A failure refuses the pool and stops what it started.
  - `close()` answers queued jobs as stops and waits for every worker's exit.
- `services/pine_runtime/sandbox.mjs`: the worker entry plus the main-thread checks.
  - L3 `applyPreamble()` runs in the worker BEFORE the bundle's dynamic `import()`. It deletes `REMOVED_GLOBALS` (fetch/Request/Response/Headers/FormData/WebSocket/EventSource/XMLHttpRequest, the event and channel classes, WebAssembly, navigator, crypto, every timer and `queueMicrotask`) and `process.{binding,_linkedBinding,dlopen,kill,_kill}`. It then materialises Node's lazy globals and freezes `globalThis`. Workers start with `env: {}`.
  - L1 `scanBundle()` reads the design's token list. `fs`/`net`/`http` are read as quoted module specifiers, and `fetch(`/`WebSocket(` etc. are added. Lines are allowlisted only on their exact trimmed text. An allowlist entry matching nothing is reported as stale, and the rail is red on it.
  - L4 `selfTestL4()` runs inside a worker. It tries a file write (default target in the temp dir, the one place a read-only root still allows, so only the permission model can stop it), `spawnSync` and code generation from a string.
- `services/pine_runtime/job.mjs`: the host adapter, run in the worker.
  - `runArgs` builds `(def, rows, ctx)` as `runtimeAsync.js::messageOf` does.
  - One `computeRuntimeColumns(def, rows, ctx, { budgetMs: rt.RUNTIME_PANE_TIME_BUDGET_MS, incremental: false })` call, then `resetRuntimeSessions()` + `resetRuntimeLedgers()` in a `finally` (H6).
  - A column that reports `resumedFrom` is refused `runtime:server-integrity`.
  - Canonical Float64 columns; named run-wide and per-output refusals.
  - `runtimeVersionRefusal` is NOT called a second time: the run calls it itself (`runtimeColumns.js:1256`), on the full document meta the adapter passes (one authority).
- T6 wiring in `server.mjs` (the minimum; nothing else of T6's changed):
  - (a) the runner's `BusyError` becomes 429 `runtime:server-busy` (it was a 500);
  - (b) `main({ pool })` starts the pool on the same bundle, uses it as the runner, prints `workers=N`, and stops it on server close (logging `[pine-runtime] pool stopped`);
  - (c) `SERVICE_POOL_OPTIONS = { requireL4: true }`, which the `isMain` boot passes, so the real service refuses to start without the L4 flags.
- T1 wiring in `serverEntry.js`: re-exports `RUNTIME_PANE_TIME_BUDGET_MS`, `RUNTIME_INCREMENTAL_KEY`, `RUNTIME_TIME_BUDGET_GUARD`, `RUNTIME_FAILED_GUARD` and `RUNTIME_OBJECTS_KEY`, so the adapter and the pool read them from the bundle. T1's rail EXPORTS list and value checks are updated to match.

Engine bump: **NO**. No compute code changed. The bundle gains five re-exports, so its sha256 (identity) moves; output does not. The browser build does not import `serverEntry.js`.

## Decisions later lanes must mirror
- **T11 (client), the wire result:**
  - `status` ok|withheld and `refusals[{key, guard, sentence, bar}]`. `key '*'` means run-wide, with no `columns`.
  - Columns are canonical base64 of n LE Float64, with null/undefined/NaN as `0x7FF8000000000000` and -0 kept. A wrong length or a non-number withholds the whole job (`runtime:server-integrity`); a job is never partial.
  - `want: []` means every enumerable column.
  - New guards:
    - `runtime:server-busy`: 429 for the whole request, or a per-job withhold past its deadline;
    - `runtime:server-worker-oom` and `runtime:server-worker-failed`;
    - `runtime:time-budget` (hard kill);
    - `runtime:server-integrity` (a resumed run or a bad column);
    - per-output `runtime:server-output-absent`;
    - per-output `runtime:server-drawings` on key `__runtimeObjects`.
  - The script's own error is guard `runtime.error`, with its `bar`; an unnamed throw is `runtime:failed`.
  - Results carry `ms`. They do NOT yet carry `digest` (T3), `cache` (T8) or `instructions` (T9).
- **T8 (cache):** never cache a pool-made stop (`server-busy`, `server-worker-oom`, `server-worker-failed`, hard-kill `time-budget`, `server-integrity`). None of them is deterministic.
- **T9 (observability):**
  - `pool.stats()` is `{starts, kills, recycles, ooms, crashes, queued, live}`, and the fingerprint reads `workers=${pool.size}`.
  - `/ready` does NOT consult `pool.ready()` yet: the canary hook is T9's, and it should compose `pool.ready()`. A broken pool still fails closed (run -> 500 `runtime:server-failed`).
- **T10 (image):** run node with `--permission --allow-fs-read=/app --allow-worker --disallow-code-generation-from-strings`. `--disallow-code-generation-from-strings` cannot be set per worker (`ERR_WORKER_INVALID_EXEC_ARGV`); it must be on the process. Node 20.18 spells the permission flag `--experimental-permission`, and Node 22+ spells it `--permission`. The boot self-test refuses to start otherwise.
- **T2 (closure):** the three L1 allowlist entries are the bundle's current `fetch(` lines (serverCompute, runtimeKill, runtimePanePermission). When T2 cuts those edges the entries go stale, and `sandbox.test.mjs` goes red until they are deleted. That is the intended forcing.

## Commands and totals (tip cc76515bb6, tested on master 5d95103c8a)
- Rails: `node --test --test-force-exit --test-concurrency=2 --test-timeout=120000 services/pine_runtime/test/*.test.mjs` gives tests 72, pass 72, fail 0 (T6's 33 plus 39 new). The pools in the rails use 1-3 workers, and every test closes its pool.
- T1 rail + frontend gate (direct): `serverBundle.rail.test.js` + `pineRuntimeFrontendGate.test.js` gives 2 files, 9/9.
- final-tip: lane 3 (`dsk/heavy-final3.lock`), `bash $S/final-tip.sh pine-dsk-w5t7 w5t7-final tests/test_script_engine_version_gate.py` on tip cc76515bb6, log dir `_resume-2026-11-01/runs/w5t7-final/`.
  - gate pytest: 46 passed. `test_script_engine_version_gate.py`: 6 passed. Hygiene: clean (34696 files).
  - full chart+hooks vitest: Test Files 1 failed | 1334 passed | 27 skipped; Tests 1 failed | 22366 passed | 118 skipped.
    The only failure is `src/hooks/pollingSites.rail.test.js`, the desktop baseline. Nothing new.

## Rails red on base, green on tip
Proof script: `redbase.py` (here), with a byte-exact restore. Log: `_resume-2026-11-01/runs/w5t7-mut/redbase.log`.
```
BASE-MODULES rc=1
ℹ tests 5
ℹ pass 0
ℹ fail 5
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\Patrick\uct-worktrees\pine-dsk-w5t7\services\pine_runtime\job.mjs' imported from C:\Users\Patrick\uct-worktrees\pine-dsk-w5t7\services\pine_runtime\test\adapter.test.mjs
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\Patrick\uct-worktrees\pine-dsk-w5t7\services\pine_runtime\pool.mjs' imported from C:\Users\Patrick\uct-worktrees\pine-dsk-w5t7\services\pine_runtime\test\hostile.test.mjs
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\Patrick\uct-worktrees\pine-dsk-w5t7\services\pine_runtime\job.mjs' imported from C:\Users\Patrick\uct-worktrees\pine-dsk-w5t7\services\pine_runtime\test\job.test.mjs
BASE-SERVER hostile.test rc=1
ℹ tests 1
ℹ pass 0
ℹ fail 1
  red: services\pine_runtime\test\hostile.test.mjs
BASE-ENTRY hostile+sandbox rc=1
ℹ tests 16
ℹ pass 11
ℹ fail 5
  red: L6 cross-tenant: job A then job B on one worker answers B exactly as a cold run of B
  red: L7 load: 50 maximal-cost sweep jobs, and one alert completes inside its deadline, ahead of the sweep
  red: hostile corpus: every case ends in a named stop, by the VM and never by the hard kill, and the supervisor stays healthy
  red: wiring: a request the queue cannot hold is 429 runtime:server-busy, and none of its jobs is queued
  red: wiring: main({ pool }) runs the pool on its own bundle and closing the server stops it
BASE-ENTRY serverBundle.rail rc=1
     × exports the entry surface and the identity constants read from their declaring modules 746ms
      Tests  1 failed | 5 passed (6)
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
REDBASE_DONE
```
- Modules absent: every new rail file fails to load (5 of 5 files red).
- `server.mjs` at base: `hostile.test.mjs` is red. It imports `SERVICE_POOL_OPTIONS`, and the 429 / `main({ pool })` wiring is absent.
- `serverEntry.js` at base: 5 real-bundle rails are red (the pool cannot read `RUNTIME_TIME_BUDGET_GUARD` from the bundle), and so is T1's entry-surface rail.

New rail files (all green on the tip):
- `job.test.mjs` (8): the adapter's args, encoding, stops, want, drawings, never-partial and the H6 cold check;
- `adapter.test.mjs` (3): HP-7 agreement, stale declarations, and proof the parse can fail (7 drift edits);
- `pool.test.mjs` (12): priority, owner cap, depth, deadlines, hard kill, OOM, crash, recycle, close, boot and limits;
- `sandbox.test.mjs` (9): L1 on the real bundle, L1 can fail, a tainted bundle refused, L3 at eval and run time, L4 with flags / partial flags / default target / no flags;
- `hostile.test.mjs` (7): the hostile corpus over HTTP, L6 cross-tenant on the real bundle and on the reset counter, L7 load, 429 wiring, the service boot's L4, and `main({ pool })`.

## Hostile corpus (real bundle, through server + pool, 2 workers)
| case | stop (measured) | design expected |
|---|---|---|
| infinite `while` | `runtime:limit` WHILE_ITERATIONS | same |
| `for` to 1e12 | `runtime:limit` INSTRUCTIONS_PER_BAR | same |
| string doubling | `runtime:limit` MEMORY | same (MEMORY_EXCEEDED) |
| array growth | `runtime:limit` ARRAY_ELEMENTS | same |
| deep UDF recursion | `runtime:statement` "Maximum call stack size exceeded" | refused at build |
| 512 KiB + 1 source | door: 400 (doc > 128 KiB); pool: `runtime:limit` PROGRAM_SIZE | PROGRAM_SIZE |
| 200k-node expression | door: 400; pool: `runtime:statement` "Maximum call stack size exceeded" | IR limit |
| `request.security` (other symbol) | `runtime:request` | same |
| `varip` on a calc_bars_count window | `runtime:varip` | same |
Every case is a named stop by the VM (`stats.kills == 0`), and `/health` and a later benign run stay
healthy. The two `runtime:statement` rows are an ENGINE finding, not a T7 one: they are named stops, but
the sentence is a raw JS RangeError, and the design's table says build refusal or IR limit. The
escaped-VM cases (hang, heap exhaustion, thread exit, a capability probe) run on the stand-in bundle
(`test/fixtures/fakeBundle.mjs`) in `pool.test.mjs` / `sandbox.test.mjs`.

## L6 / L7
- L6, real bundle, 1 worker: A (EMA 9) then B (RSI 14, other bars) on the SAME worker gives B equal to a
  cold B in a fresh pool, column for column. A then A+1 bar (resume-eligible) is answered cold (not
  withheld) and equals a cold A+1. The stand-in's session/ledger counters read 1/1 on every job (the reset).
- L7, real bundle, 2 workers: 50 sweep jobs of about 166k instructions a bar x 300 bars (under the cap,
  maximal cost). The alert sent 300 ms later is `ok` inside its 15 s deadline and before the sweep
  finishes, and `/health` answers in under 1 s during the load.

## Mutation table
Lane: `_resume-2026-11-01/dsk/heavy-mut.lock`. Commands, from the repo root:
- `python docs/pine/evidence/2026-11-04-w5-t7/mutate_node.py $S/mutate.py docs/pine/evidence/2026-11-04-w5-t7/muts.json services/pine_runtime/test/*.test.mjs`. This is T6's wrapper, with files 2 at a time and a 120 s test timeout.
- From `app/`: `python $S/mutate.py ../docs/pine/evidence/2026-11-04-w5-t7/muts-vitest.json src/components/chart/engine/runtime/__tests__/serverBundle.rail.test.js`.

Logs: `_resume-2026-11-01/runs/w5t7-mut/{mut.log,mut2.log,mut-vitest.log,redbase.log}`.
**Node rails: 71 of 72 mutations killed** (the no-op control survived, as it must); 1 equivalent survivor, named. **Vitest (serverEntry): 4 of 4 killed.**

Round 1 (`mut.log`, tip c8c175f44b, 74 mutations) left 4 survivors besides the control:
- `sb:l1-allow-any-token`: no rail tied an allowlist entry to its token. A rail was added; now killed.
- `pool:recycle-not-replaced`: the recycle rail did not ask that the next job is answered by a fresh worker. A rail was added; now killed.
- `pool:answer-twice`: an unreachable second guard (every caller first removes the job from its queue or `s.busy`). It was DELETED (one guard), and the mutation was dropped.
- `sb:l4-worker-env-inherited`: equivalent (see the table).

Round 2 (`mut2.log`, tip cc76515bb6) re-ran those survivors.

| mutation | result | killed by (first tests named) |
|---|---|---|
| `control:noop-comment` | SURVIVED | - (control, must survive) |
| `job:incremental-on` | KILLED | HP-7: the service adapter builds the browser worker's (def, rows, ctx, opts), minus now and the declared diffe; HP-7 can fail: drift in any argument of the server adapter is named |
| `job:no-session-reset` | KILLED | L6 cross-tenant: what one job leaves in the bundle's session state is reset before the next; runJob calls the run ONCE with the worker budget and incremental:false, and resets after it |
| `job:no-ledger-reset` | KILLED | L6 cross-tenant: what one job leaves in the bundle's session state is reset before the next; runJob calls the run ONCE with the worker budget and incremental:false, and resets after it |
| `job:reset-only-on-success` | KILLED | the reset runs after a stop too, and every thrown stop is named run-wide |
| `job:budget-dropped` | KILLED | HP-7: the service adapter builds the browser worker's (def, rows, ctx, opts), minus now and the declared diffe; HP-7 can fail: drift in any argument of the server adapter is named |
| `job:resumed-ok` | KILLED | L6 cross-tenant: what one job leaves in the bundle's session state is reset before the next; H6: a run that says it resumed from an earlier run is refused, never served |
| `job:resumed-zero-ok` | KILLED | H6: a run that says it resumed from an earlier run is refused, never served |
| `job:nan-payload-kept` | KILLED | encodeColumn: canonical NaN for na, -0 kept, exact length, numbers only |
| `job:length-unchecked` | KILLED | encodeColumn: canonical NaN for na, -0 kept, exact length, numbers only; never partial: one column of the wrong length withholds the whole job |
| `job:nonnumber-ok` | KILLED | encodeColumn: canonical NaN for na, -0 kept, exact length, numbers only |
| `job:partial-ok` | KILLED | never partial: one column of the wrong length withholds the whole job |
| `job:absent-silent` | KILLED | want: a named output only; a missing one is refused by name and the job stays ok; a non-enumerable record is not an output, and drawings are refused by name |
| `job:enumerable-check-off` | KILLED | a non-enumerable record is not an output, and drawings are refused by name |
| `job:drawings-silent` | KILLED | a non-enumerable record is not an output, and drawings are refused by name |
| `job:want-ignored` | KILLED | want: a named output only; a missing one is refused by name and the job stays ok; a non-enumerable record is not an output, and drawings are refused by name |
| `job:guard-unnamed` | KILLED | hostile corpus: every case ends in a named stop, by the VM and never by the hard kill, and the supervisor stay; the reset runs after a stop too, and every thrown stop is named run-wide |
| `job:script-error-unnamed` | KILLED | the reset runs after a stop too, and every thrown stop is named run-wide |
| `job:bar-dropped` | KILLED | the reset runs after a stop too, and every thrown stop is named run-wide |
| `job:meta-projected` | KILLED | HP-7: the service adapter builds the browser worker's (def, rows, ctx, opts), minus now and the declared diffe; HP-7 can fail: drift in any argument of the server adapter is named |
| `job:inputs-shared` | KILLED | HP-7 can fail: drift in any argument of the server adapter is named; runArgs builds the def, rows and ctx the browser worker builds, from the validated job |
| `job:symbol-dropped` | KILLED | HP-7: the service adapter builds the browser worker's (def, rows, ctx, opts), minus now and the declared diffe; runArgs builds the def, rows and ctx the browser worker builds, from the validated job |
| `job:listing-forced` | KILLED | runArgs builds the def, rows and ctx the browser worker builds, from the validated job |
| `job:forming-forced` | KILLED | runArgs builds the def, rows and ctx the browser worker builds, from the validated job |
| `sb:preamble-off` | KILLED | L3: inside a job, every removed global and process door is absent, at bundle evaluation AND at run time |
| `sb:preamble-after-bundle` | KILLED | L3: inside a job, every removed global and process door is absent, at bundle evaluation AND at run time |
| `sb:no-freeze` | KILLED | L3: inside a job, every removed global and process door is absent, at bundle evaluation AND at run time; L3: applyPreamble removes what it lists and freezes the object it is given |
| `sb:keep-fetch` | KILLED | L3: applyPreamble removes what it lists and freezes the object it is given |
| `sb:keep-timers` | KILLED | L3: applyPreamble removes what it lists and freezes the object it is given |
| `sb:keep-binding` | KILLED | L3: applyPreamble removes what it lists and freezes the object it is given |
| `sb:l1-eval-dropped` | KILLED | L1 can fail: every token is caught, an allowlisted line passes only verbatim, a stale entry is named |
| `sb:l1-network-dropped` | KILLED | L1: the built server bundle holds no capability token outside the allowlist, and no allowlist entry is stale; L1 can fail: every token is caught, an allowlisted line passes only verbatim, a stale entry is named |
| `sb:l1-process-dot-only` | KILLED | L1 can fail: every token is caught, an allowlisted line passes only verbatim, a stale entry is named |
| `sb:l1-allow-substring` | KILLED | L1 can fail: every token is caught, an allowlisted line passes only verbatim, a stale entry is named |
| `sb:l1-allow-any-token` | KILLED | L1 can fail: every token is caught, an allowlisted line passes only verbatim, a stale entry is named |
| `sb:l1-stale-off` | KILLED | L1 can fail: every token is caught, an allowlisted line passes only verbatim, a stale entry is named |
| `sb:l4-codegen-untested` | KILLED | wiring: the service boot runs the pool with the L4 self-test, which refuses this unflagged process; L4: one flag missing is enough to fail the self-test |
| `sb:l4-ok-some` | KILLED | L4: one flag missing is enough to fail the self-test |
| `sb:l4-target-unchecked` | KILLED | L4: the boot's default target is a writable path, so only the flags can make the write throw |
| `sb:l4-worker-env-inherited` | SURVIVED (equivalent) | EQUIVALENT: the L4 probe reads no env; job-worker env isolation is proved by `pool:env-inherited` (killed) |
| `pool:l1-scan-off` | KILLED | L1: the pool refuses to start on a bundle with a capability token, and starts no worker |
| `pool:l4-ignored` | KILLED | wiring: the service boot runs the pool with the L4 self-test, which refuses this unflagged process; L4 can fail: without the flags the self-test names all three, and the production pool refuses to start |
| `pool:time-guard-retyped` | KILLED | hard kill: a job past killMs is withheld runtime:time-budget and its worker is never reused |
| `pool:priority-reversed` | KILLED | the design numbers: limits, kill, recycle, depth, caps, deadlines; PRIORITY names each profile once; priority: alert > on-demand > backtest > record > sweep, FIFO inside a profile |
| `pool:fifo-off` | KILLED | priority: alert > on-demand > backtest > record > sweep, FIFO inside a profile |
| `pool:cap-off` | KILLED | owner cap: one owner holds at most its cap in flight, and another owner passes its waiting jobs |
| `pool:cap-all-profiles` | KILLED | owner cap: one owner holds at most its cap in flight, and another owner passes its waiting jobs |
| `pool:cap-not-per-owner` | KILLED | owner cap: one owner holds at most its cap in flight, and another owner passes its waiting jobs |
| `pool:inflight-no-decrement` | KILLED | owner cap: one owner holds at most its cap in flight, and another owner passes its waiting jobs |
| `pool:depth-off` | KILLED | wiring: a request the queue cannot hold is 429 runtime:server-busy, and none of its jobs is queued; queue depth: a request that does not fit is refused whole (429 runtime:server-busy) and queues nothing |
| `pool:depth-partial` | KILLED | wiring: a request the queue cannot hold is 429 runtime:server-busy, and none of its jobs is queued; queue depth: a request that does not fit is refused whole (429 runtime:server-busy) and queues nothing |
| `pool:deadline-off` | KILLED | deadline: a job still queued past its profile deadline is withheld runtime:server-busy, before the queue moves |
| `pool:deadline-hits-running` | KILLED | deadline: a job still queued past its profile deadline is withheld runtime:server-busy, before the queue moves |
| `pool:kill-off` | KILLED | hard kill: a job past killMs is withheld runtime:time-budget and its worker is never reused |
| `pool:killed-reused` | KILLED | hard kill: a job past killMs is withheld runtime:time-budget and its worker is never reused |
| `pool:killed-not-replaced` | KILLED | hard kill: a job past killMs is withheld runtime:time-budget and its worker is never reused |
| `pool:oom-unnamed` | KILLED | heap cap: a job that exhausts its heap is withheld runtime:server-worker-oom; the pool serves on |
| `pool:crash-not-replaced` | KILLED | heap cap: a job that exhausts its heap is withheld runtime:server-worker-oom; the pool serves on; crash: a worker that exits mid-job is withheld runtime:server-worker-failed; the pool serves on |
| `pool:recycle-jobs-off` | KILLED | recycle: a worker retires after recycleJobs jobs, or once it is recycleMs old |
| `pool:recycle-age-off` | KILLED | recycle: a worker retires after recycleJobs jobs, or once it is recycleMs old |
| `pool:recycle-not-replaced` | KILLED | recycle: a worker retires after recycleJobs jobs, or once it is recycleMs old |
| `pool:limits-dropped` | KILLED | every worker runs under the resourceLimits, and a job is answered once, in order |
| `pool:env-inherited` | KILLED | L3: inside a job, every removed global and process door is absent, at bundle evaluation AND at run time |
| `pool:close-no-drain` | KILLED | close: queued jobs are answered as stops, every worker exits |
| `pool:boot-error-ignored` | KILLED | boot: a bundle that cannot serve refuses the pool, and leaves no worker running |
| `pool:boot-not-awaited` | KILLED | hostile corpus: every case ends in a named stop, by the VM and never by the hard kill, and the supervisor stay; L7 load: 50 maximal-cost sweep jobs, and one alert completes inside its deadline, ahead of the sweep |
| `pool:default-limits` | KILLED | the design numbers: limits, kill, recycle, depth, caps, deadlines; PRIORITY names each profile once |
| `srv:busy-not-429` | KILLED | wiring: a request the queue cannot hold is 429 runtime:server-busy, and none of its jobs is queued |
| `srv:pool-not-closed` | KILLED | wiring: main({ pool }) runs the pool on its own bundle and closing the server stops it |
| `srv:pool-ignored` | KILLED | wiring: the service boot runs the pool with the L4 self-test, which refuses this unflagged process; wiring: main({ pool }) runs the pool on its own bundle and closing the server stops it |
| `srv:pool-other-bundle` | KILLED | wiring: the service boot runs the pool with the L4 self-test, which refuses this unflagged process; wiring: main({ pool }) runs the pool on its own bundle and closing the server stops it |
| `srv:service-l4-off` | KILLED | wiring: the service boot runs the pool with the L4 self-test, which refuses this unflagged process |
| `srv:isMain-no-pool` | KILLED | wiring: the service boot runs the pool with the L4 self-test, which refuses this unflagged process |
| `vitest control:noop-comment` | SURVIVED | - (control, must survive) |
| `vitest entry:drop-budget` | KILLED | exports the entry surface and the identity constants read from their declaring modules 768ms |
| `vitest entry:drop-incremental-key` | KILLED | exports the entry surface and the identity constants read from their declaring modules 741ms |
| `vitest entry:drop-failed-guard` | KILLED | exports the entry surface and the identity constants read from their declaring modules 755ms |
| `vitest entry:drop-objects-key` | KILLED | exports the entry surface and the identity constants read from their declaring modules 769ms |

## Observations for the coordinator (not changed here)
- **The browser worker drops the version facts.** `runtimeAsync.js::messageOf` ships `meta: { runtimeHistory }` only, so in the off-thread browser lane `runtimeVersionRefusal` never sees `runtimeLanguage`/`runtimeFrontend`/`runtimeIr`/`runtimeOutputSignature`. The comment there says "the two meta facts", but the code ships one. The server adapter passes the whole meta (design 3.2), which HP-7 declares as a difference. The server can therefore refuse a stale document that the browser worker draws. This looks like a browser gap; it belongs to the laptop's call.
- **`probeVerdictCache` persists across jobs.** It is the calc_bars `bar_index` verdict cache (`runtimeColumns.js:49`). It is content-keyed, capped and deterministic, like the WeakMap memos. It is not reset per job (only a test reset exists, not in the bundle), and recycling bounds it.

## Open items
- T3 not merged: no `digest` on results, and the column codec here should become T3's `columnDigest.js` (one authority) once it lands.
- The two `runtime:statement` hostile rows (the engine sentence and the design table).
- T6's open items stand. The `PINE_RUNTIME_SERVICE_SECRET` ledger row should also name `server.mjs`.
