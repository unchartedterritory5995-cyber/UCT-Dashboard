# Arming packet: the per-bar Pine runtime lane, stage 1 (admins only), W2, 2026-11-02

> **Round 3, 2026-11-04 (desktop).** The interim banner is gone: the final-tree rails, the harness re-run and P11 are in (sections 2, 3.3, 10). Round-3 logs: `round3/`. Nothing was applied.

Branch `feat/pine-w2-arming`. **Facts and measurements only. Nothing in this packet was applied**: no Railway variable was read or set, no flag changed, nothing deployed, no production endpoint called. The decision is the owner's. The rulings D1 to D6 and R1 to R4 (`docs/pine/PHASE3-RUNTIME-PLAN.md` 4.6) stand as ruled and are not re-opened here.

## 0. The tree, the machine, the words

- **Tree.** `feat/pine-w2-arming`. `origin/master` was merged **twice**, because it moved while this ran: `67a6dada10` at `6363a05d80`, then `8fbf76c6ee` at `d2235ec4b0` (67 more commits: PR 701, the indicators batch, and PR 703, connector fidelity). Round 3 re-pinned production (2026-11-04, `git ls-remote`): `origin/production` and `origin/master` are both `edd353fc06`. The round-3 rails ran on a throwaway merge of `origin/production` `e26130c7f6` into this branch (`d107aafbf3`, made with `git merge-tree`, not committed to the branch and not pushed); `git diff e26130c7f6..edd353fc06` touches no file on the lane's path (no `pine`, `runtime`, `chart/engine`, `user_definitions` or `feature_flags` file). Earlier: at 2026-11-02 20:59 production was `8fbf76c6ee`; at 20:17 `30bdc91367`. The rails in sections 2 and 3 were run again on the second merge's tree (`c78d553af2`); round 3 re-ran them on the production-merged tree `d107aafbf3` (section 3.3); the census, the build and the probes ran on the first, and section 11 says which log ran on which tree. The harness lane diff was first taken on the branch base `6272ed7fa3`; sections 3.2, 3.3 and 10 say what carries.
- **Machine.** The owner's laptop (Windows 11). Every heavy job ran alone under the machine-wide heavy lock (`hl`), after waiting its turn behind other sessions' jobs. Free RAM, read by `hl` before each job, ran from 989 to 4,736 MB.
- **Evidence.** `docs/pine/evidence/w2-arming-2026-11-02/` (the table in section 12). Raw logs are in `C:\Users\pgosz\uct-worktrees\_resume-laptop\runs\w2\`.
- **PASS** means the evidence named was read or run on this tree at write time and agrees. **FAIL** means a measurement missed its budget. **OPEN** means not measured here, or not mine to decide. Script text is never quoted; names, hashes (12 hex), ids and counts are.


## 1. The answer in one screen

- **What stage 1 would serve: one script, `adx-and-di-for-v4`** (sha256 `d0853c47...0499`). It is the only script R1 admits today (the real `pine_runtime_admission` returns no reason), it has two committed MATCH captures through the runtime lane, and the new allowlist rail re-grades both on this tree with the committed list latched: MATCH, 4 of 4 tests passed, and the latch is mutation-proved (3 of 3 mutations killed, the control going red alone under the one the task named). Section 6.
- **Section 4.1, safety S1 to S8, and the cohort stage:** S1 to S3 and S4, S5, S6, S7, the cohort stage **PASS** (S1 is a point-in-time grep, not a standing rail); **NOT RUN (environment)**: S8, three mount rails that need a dependency the laptop venv lacks (section 2, S8). Section 2.
- **Budgets for that script** (section 5): B1 PASS (16.8 ms; the plan's budget is 1 frame, 16.7 ms, and 16.8 ms is frame jitter by the plan's own 17 ms MET precedent, not a new 20 ms bar); B2 PASS (p95 48.5 ms at x4, on the stand-in); B3 PASS (62 ms at 32,000 five-minute bars); B4 PASS (358,185 B gzip); B5 PASS on the desktop (tick p95 19.4 ms) and 52.3 ms at x4 against 50 on the throttled-page stand-in; the coordinator accepts this x4 miss for the adx-only stage 1 under the owner's 2026-11-02 autonomy grant. Section 5.
- **P11 (full suite on a whole install), round 3:** the six-shard gate on `93efdb607f` failed 25 of 4,112 files. Each file was re-run alone on the branch, on `origin/master` (`03a42b201a`) and on the branch's merge-base with master (`0afa7645dd`): **0 branch-caused**; 17 fail alone on all three trees (pre-existing on master), 8 pass alone on the branch (flaky or load-sensitive in the sharded run, or master-side). Classification and evidence in section 10, item 1. Stage 1's own gate to leave is a 14-day watch with the checks in section 8.
- **Found while measuring, not in the plan:**
  1. The J4 census failed on its own assertion and wrote nothing: it required a budget stop to be `runtime:time-budget` even when a VM limit fires first. Fixed in the instrument (`4a884aff97`), with the first failure kept as proof (section 4).
  2. The census detector and the lane answer "is this arm per-bar?" differently, which is the only reason deadband and fibonacci are withheld (section 9a).
  3. Stage 2's exit gate ("time-budget stop rate under 2% of runs") cannot be computed from the S8 telemetry as built: it records stops, never runs (section 8.4).
  4. The runtime-only set is 22 scripts now (the plan counted 16). Two of the 22 stop by name at every length (`linear-regression-channel`, `order-blocks`), `delta-rsi-oscillator-strategy` is over the 1,000 ms budget at every length, `machine-learning-knn-based-strategy` at three of four (section 4).
  5. Stale texts: the plan's S6 ("PARTIAL") and S7 ("NOT MET") are met on master; `vendorHarness.h4Loops.test.js`'s header says no TradingView capture of a loop script exists, and the two `vw-h4-loops` captures postdate it.
  6. Master moved 67 commits while this ran, and production followed in two steps: at 20:17 `origin/production` was `30bdc91367` (PR 701, the indicators batch) and 67 commits behind master `8fbf76c6ee` (PR 703); by 2026-11-02 20:59 it was `8fbf76c6ee` (production is 1 commits behind master). PR 701 changed server and client files on the lane's path (line identity beside every served definition; `bbMiddle`, `bbUpper`, `bbLower` expansions). The packet is re-pinned to the merged tree and says what it covers (7.2, 10.4, 11).
- **Decisions this leaves to the owner:** go or no-go for stage 1 with this one script, and whether P11 is waived; whether the save door (`PINE_RUNTIME_SAVE_ENABLED`) opens at stage 1 (7.4); whether joint evidence suffices for new registry rows (9c); whether the census detector learns the input-selected arm (9a); whether the renko captures are worth rig time (9b).
- **Nothing was applied.**

## 2. The section-4 preconditions, one by one

Line numbers were read from the second merge's tree at write time (a `file:line` is a dated claim); section 11 says which tree each verdict's log ran on. The second merge moved the ones in `api/routers/user_definitions.py` (line identity added about 28 lines above `resolve_shared`) and `docs/feature_flags.json` (a flag row above the two knobs), and they are re-pinned here. "J2" is the vitest run in `j2-vitest.log` (8 files, 93 tests, all passed, first-merge tree, and again inside `final-vitest.log` on the final tree (25 files, 430 tests: all passed)); "pytest rails" is `pytest-rails.log` (`final-pytest-rails.log`, 7 files, 199 passed, 3 errors, tree `c78d553af2`).

### 2.1 Safety (4.1)

| # | requires | evidence | verdict |
|---|---|---|---|
| S1 | member logic runs only in the member's own browser worker; no eval, no network, the server never executes it | a point-in-time search of the lane's sources and of the server modules; details under the table. The one network call on the lane's path is the main-thread stop beacon, `runtime/runtimeAsync.js:124` | **PASS** (a grep, not a standing rail: section 10, item 9) |
| S2 | memory: strings counted in `MEMORY`; a worker-OOM path that names the stop | `runtime/vm.js:749` (`OP.CONCAT`): `budget.peak('MEMORY', ... + 2 * (x.length + y.length))` at `:771`, before the concatenation, so a doubling loop stops by name at the 64 MiB estimate. Rail `runtimeStringMemory.test.js`: J2, 5 of 5 passed. The 67,111,344 B figure in the plan was measured by WS-H on 2026-10-31 and is not re-measured here | **PASS** |
| S3 | CPU: every stop named, watchdog, 3 starts per tab, a run never moves to the main thread after a hang | named guards: `runtimeColumns.js:223` (`runtime:time-budget`), `:226` (`runtime:limit`), `:229` (`runtime:failed`), `runtimeAsync.js:49,50` (`runtime:worker-unresponsive`, `runtime:worker-failed`), `nativeRegistry.js:3006` (`runtime:load-failed`). Watchdog `runtimeAsync.js:41` (`RUNTIME_WORKER_WATCHDOG_MS = 20000`), starts `:46` (`RUNTIME_WORKER_MAX_STARTS = 3`). Rail `runtimePaneSafety.test.jsx`: J2, 19 of 19 passed, including a worker that dies (`:254`), the start cap "still never on this thread" (`:269`), the watchdog (`:289`) and a lane chunk that fails to load (`:347`) | **PASS** |
| S4 | every serving path stamps kill and allowlist state, including `GET /shared/{token}` | `api/routers/user_definitions.py:886-904` (`resolve_shared`) returns the definition through `runtime_definitions.stamp_served`, keyed on the origin definition's id; the other serving paths stamp at `:311`, `:621`, `:800`. `stamp_served` is `runtime_definitions.py:382`. Rail `tests/test_pine_runtime_shared_stamp.py`: pytest rails | **PASS** (`test_pine_runtime_shared_stamp.py`: 4 of 4 passed) |
| S5 | the kill levers exist | `PINE_RUNTIME_STAGE` (`runtime_definitions.py:146`, read per call, unset or unrecognised is `off`), `PINE_RUNTIME_KILL_LIST` (`:135`), the allowlist (`:222`, committed JSON plus `PINE_RUNTIME_ALLOWLIST`), `PINE_RUNTIME_SAVE_ENABLED` (`:130`). Rails: `tests/test_pine_runtime_switch_on.py` (pytest rails) and `runtimeKillSwitch.test.js` (3), `runtimeSwitchOn.test.js` (15) in J2 | **PASS** (`test_pine_runtime_switch_on.py`: 65 of 65 passed; client rails in J2: `runtimeKillSwitch` 3, `runtimeSwitchOn` 15) |
| S6 | a switch-off reaches an open tab | client: `app/src/lib/runtimePanePermission.js:36` (`RUNTIME_PERMISSION_RECHECK_MS = 60000`), `:59` (a revocation is applied), `:100` (`runtimePanePermitted` re-asks once stale); `engine/runtimeKill.js:50` (the lists re-read every 60 s, `maybeRefreshRuntimeLists` at `:54`); every run re-asks the permission and the kill list (`nativeRegistry.js:3027`, `:3033`). Server: with the stage `off` every served runtime row is stamped (`runtime_definitions.py:395-397`, the `STAGE_OFF` branch of `stamp_served`). Rails: `runtimePaneRevocation.test.js` (10) and `runtimeRunGate.test.js` (6) in J2; `test_WSI_S6_*` in `test_pine_runtime_switch_on.py` (pytest rails). The plan's "PARTIAL" is superseded by WS-I | **PASS** (`test_WSI_S6_*`: 2 of 2 passed; client rails in J2: `runtimePaneRevocation` 10, `runtimeRunGate` 6) |
| S7 | ledger rows for `PINE_RUNTIME_KILL_LIST` and `PINE_RUNTIME_ALLOWLIST` | `docs/feature_flags.json:3697` and `:3708` (`knobs`), each with `read_at`, `default`, `owner_decision`, `note`. Rail `test_WSI_S7_the_kill_list_and_allowlist_have_ledger_rows` (`tests/test_pine_runtime_switch_on.py`, pytest rails). The plan's "NOT MET" is superseded by WS-I | **PASS** (`test_WSI_S7_*`: 2 of 2 passed) |
| S8 | the operator can see stops by guard, per script hash, without reading a member's screen | client: `runtimeAsync.js:115-139` (a keepalive `fetch`, once per script and stop per tab, at most 32 a tab, `:76` and `:134-139`). Server: `api/routers/pine_runtime_telemetry.py` (`StopBody` with `extra="forbid"` at `:104-105`, caps 5,000 a day and 200 a member at `:72-73`, `POST /stop` at `:162`, admin `GET /stops` at `:222`), mounted at `api/main.py:10408-10409`. Rails: `runtimeStopBeacon.test.js` (7) in J2; `tests/test_pine_runtime_stop_telemetry.py` (pytest rails). The beacon is pseudonymous, not anonymous (a 12-hex script hash can be joined to stored definitions by an operator) | **PASS** (`test_pine_runtime_stop_telemetry.py`: every test passed with `linkify-it-py` supplied; round 3 on the production-merged tree: the seven pytest rails, 202 passed); client rail in J2: `runtimeStopBeacon` 7 |
| cohort stage | a cohort between admins and all, with its own kill | `api/services/rollout_gate.py:453` (`PINE_RUNTIME_COHORT = "pine-runtime-pane"`), `:456-465` (the stage itself is the switch, read first, per call), `:468` (`pine_runtime_cohort_enabled_for`); `runtime_definitions.py:78-79` (the ladder `off`, `admins`, `cohort`, `all`) and `:155-170` (`pane_permitted`). Operator door `tools/rollout_cohort.py add --cohort pine-runtime-pane --user <id>`: prints the diff, writes only with `--apply`, ids only. Rails `test_WSI_R2_*` (`tests/test_pine_runtime_switch_on.py`, pytest rails). Not needed for stage 1 | **PASS** (`test_WSI_R2_*`: 14 of 14 passed) |

**S1 detail.** The search is `s1-grep.sh`; its output is `s1-grep.txt` (the first line names the tree it ran on). A grep finds text, not behaviour: it is the evidence S1 has, and section 10, item 9 says what it is not.
- Lane code: a search of `app/src/components/chart/engine/runtime/` (tests excluded) for `eval(`, `new Function`, `Function(`, `importScripts`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `fetch(`, `navigator.` and a dynamic `import(` finds only `runtimeAsync.js:115` (a comment) and `:124`, the `fetch` of the stop beacon (`RUNTIME_STOP_BEACON_URL`, `:75`). The worker file touches only `self.onmessage` and `self.postMessage` (`runtimeWorker.js:21,30,33`).
- Across the whole engine directory (tests excluded) the only hit for `eval(`, `new Function` or a call of `Function(` is a comment at `ast/interpret.js:14` explaining why the interpreter never does that.
- Two more `fetch` calls sit on this path outside the lane's directory, both main-thread reads that never run in a worker: the permission re-check (`app/src/lib/runtimePanePermission.js:86`) and the list re-read (`app/src/components/chart/engine/runtimeKill.js:61`).
- Server: `api/services/runtime_definitions.py` and `api/routers/pine_runtime_telemetry.py` contain no `eval(`, `exec(`, `subprocess`, `__import__` or `importlib`; `compile(` appears only as three `re.compile` calls on id, hash and plot-key patterns (`runtime_definitions.py:119-121`). The mentions of the lane's code under `api/` are docstrings and comments that name it, and `api/services/runtime_repaint.py:26-28`, which reads the rules file `runtimeRepaint.json` as data. No `api/` module runs `node` as a subprocess (search 6).

## 3. Parity evidence (4.2) and the harness lane diff

### 3.1 The P items

| # | requires | evidence | verdict |
|---|---|---|---|
| P1 | every script the lane serves is graded MATCH on a TradingView capture with the pane on (ruling D6) | The allowlist serves one script, `adx-and-di-for-v4`, with two captures, `adx-and-di-for-v4-rddt-1d-2026-09-27` and `adx-and-di-for-v4-spy-1d-2026-10-03`: INCONCLUSIVE with the pane dark, MATCH ("all 4 items agree") with it on (lane diff). The rail written in `880b4758fd`, `runtimeAllowlistParity.test.js`, was run for the first time here: it latches the committed list (not the suites' allow-every override), turns both panes on, permits the member, and for each listed capture requires that the runtime lane drew it and that every vendor plot compared MATCH. `parity-run.log`: Test Files 1 passed, Tests 4 passed. Its control: a runtime-only script that is not on the list (`cc-yata-rddt-1d-2026-09-27`) is declined by the gate, by name (`runtime:not-yet-graded`), and is a runtime-lane script when every script is allowed. Three mutations, all killed (`parity-mutations.json`): (a) latch `[]` instead of the listed hashes: the gate-state rail and both capture rails red; (b) the allowlist latch line in `runtimeKill.runtimeNotGradedOf` (`runtimeKill.js:154`) broken: the control, and only the control, red; (c) `normaliseAllowList` dropping every entry: the same three as (a). Files restored from saved bytes and checked against `git cat-file blob HEAD:<path>` | **PASS** |
| P2 | the graph-vs-runtime differential rail is green | `graphRuntimeDifferential.test.js`, in J2: 28 of 28 passed | **PASS** |
| P3 | the conditional-`ta.*` divergence is fixed, or refused on every lane, before anything beyond the allowlist is served | On the runtime lane (what stage 1 arms) WS-C served exactly `ta.sma`, `ta.ema`, `ta.rma` per call site and refuses every other conditional shape by name, `runtime:conditional-history` (`pineRuntimeFrontend.js:1827-1843`, `SERVED_COND` at `:2158`); rails `conditionalCallSite.test.js` (23), `conditionalArmsParams.test.js` (15), `conditionalReviewFollowups.test.js` (34): `lane-rails.log`, 16 files and 333 tests passed; the lane diff records 3 captures declined by that code. The host lane was not examined here. The registry row stays `divergent` (`api/data/pine_runtime_allowlist.json`), which withholds four corpus scripts at R1 (section 6). The served script uses neither the row nor any conditional `ta.*` | **PASS** for the runtime lane; not triggered at stage 1 |
| P4 | the vendor harness has a runtime-on mode, so the verdict with the pane on is re-measured on every change | The mode is committed and env-gated (`VENDOR_HARNESS_RUNTIME_ON`, `vendorHarness.corpus.test.js`) and was run twice (3.2). The default suite does not run it. What re-measures the served set on every tree is the P1 rail | **PASS** for the served set; the whole-corpus run stays opt-in |
| P5 | the allowlist can grow faster than one capture per script | Policy ruled 2026-10-31 (R1, per-capability conformance). What exists to grow on is in sections 6 and 9c: the rows each next script needs and the evidence on file | **OPEN** (rows not built) |

### 3.2 The harness lane diff

`docs/pine/evidence/w2-arming-2026-11-02/harness-lane-diff.json`: `vendorHarness.corpus.test.js` run twice over `tests/fixtures/vendor/harness` (336 captures) on `6272ed7fa3`, with `VENDOR_HARNESS_RUNTIME_ON=0` and `=1`. The runtime-on lane turns on both panes as a permitted member **with every script graded**, so it is an upper bound: the server's allowlist is not applied there. The with-allowlist measurement is the P1 rail, for the served set.


| | MATCH | DIVERGE | INCONCLUSIVE | total |
|---|---:|---:|---:|---:|
| production lane (objects-only pane on, runtime pane dark) | 93 | 103 | 140 | 336 |
| runtime-on lane (both panes on, every script graded) | 110 | 107 | 119 | 336 |

22 captures change verdict, every one from INCONCLUSIVE: 18 to MATCH and 4 to DIVERGE. No capture that is MATCH in the production lane stops matching with the runtime pane on (0 regressions).

Lane evidence for the runtime-on run (`laneEvidence.runtimeOn`): the gate was open, the runtime lane was reached for 112 captures, drew 55, declined 57 by name, and 112 were refused by the host lane first. The decline codes, by count: `pine:function` 14, `pine:builtin` 13, `lower-tf:store-unmeasured` 5, `runtime:library` 5, `runtime:conditional-history` 3, `runtime:request` 3, `lower-tf:unwitnessed` 2, `pine:arity` 2, `pine:collection` 2, `pine:colour-value` 2, `runtime:loop` 2, `pine:drawing` 1, `runtime:call-undeclared-builtin-state` 1, `runtime:colour` 1, `runtime:history-expression` 1.

The 18 changes to MATCH (the only runtime-lane evidence there is):

| capture | reason |
|---|---|
| `adx-and-di-for-v4-rddt-1d-2026-09-27` | all 4 items agree |
| `adx-and-di-for-v4-spy-1d-2026-10-03` | all 4 items agree |
| `deadband-hysteresis-filter-backquant-rddt-1d-2026-10-03` | all 3 items agree |
| `delta-rsi-oscillator-strategy-rddt-1d-2026-10-02` | all 5 items agree |
| `fibonacci-dolphintradebot-rddt-1d-2026-10-02` | all 3 items agree |
| `fibonacci-dolphintradebot-spy-1d-2026-10-02` | all 3 items agree |
| `h3-alma-v4-rddt-1d-2026-10-02` | all 9 items agree |
| `inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat-rddt-1d-2026-09-28` | all 4 items agree |
| `kalman-price-filter-backquant-rddt-1d-2026-10-03` | all 3 items agree |
| `parabolic-sar-rddt-1d-2026-10-03` | all 2 items agree |
| `r1-strategy-draws-indicator-rddt-1d-2026-10-02` | all 6 items agree |
| `renko-candles-overlay-rddt-1d-2026-10-03` | all 2 items agree |
| `vw-clock-close-tfchange-spy-1d-2026-09-28` | all 19 items agree |
| `vw-h4-loops-rddt-1d-2026-10-03` | all 5 items agree |
| `vw-h4-loops-spy-1d-2026-10-03` | all 5 items agree |
| `vw-var-seed-spy-1d-2026-09-28` | all 8 items agree |
| `wyckoff-accumulation-distribution-rddt-1d-2026-10-02` | all 10 items agree |
| `wyckoff-accumulation-distribution-spy-1d-2026-10-02` | all 10 items agree |

The 4 changes to DIVERGE:

| capture | reason |
|---|---|
| `inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat-spy-1d-2026-10-03` | 1 of 4 compared items diverge |
| `r1-strategy-draws-rddt-1d-2026-10-02` | 4 of 6 compared items diverge |
| `trend-targets-algoalpha-rddt-1d-2026-10-02` | 1 of 7 compared items diverge |
| `vw-deadband-ticks-brk-a-1d-2026-09-28` | 1 of 7 compared items diverge |


What this supports: with the runtime pane on, 17 captures become MATCH that the host lane could not grade, and nothing that matched stops matching. What it does not support: it grades with every script allowed, so a MATCH here says the lane draws that script exactly, not that the server would serve it. Which scripts the server serves is `pine_runtime_admission`'s answer over the committed JSON (section 6).

Readings that moved since the plan's table 2.4 (taken at `b09a6bcee6`, MATCH 92 to 109, DIVERGE 98 to 103): this tree reads MATCH 93 to 110 and DIVERGE 103 to 107, `wyckoff-accumulation-distribution` is MATCH on both RDDT and SPY (the plan had SPY DIVERGE on a `barcolor` paint not carried), and the DIVERGE list is `inside-bar...` SPY, `r1-strategy-draws` RDDT, `trend-targets-algoalpha` RDDT and `vw-deadband-ticks` BRK.A. The plan's causes for those four (an early-bar `na`, last-bar strategy values, a real value defect, a paint not carried) were not re-derived here.

Merge carry: the lane diff was first taken on `6272ed7fa3`. It was re-run in round 2 (tree `93efdb607f`) and round 3 (production-merged `d107aafbf3`): section 3.3.




### 3.3 Round 3: the harness re-run on the production-merged tree (J3a, J3b)

Tree `d107aafbf3` (this branch plus `origin/production` `e26130c7f6`, throwaway, not pushed; production has not moved on the lane's path since, section 0). Command: `VENDOR_HARNESS_RUNTIME_ON=1` (J3a) and `=0` (J3b) on `vendorHarness.corpus.test.js`; logs `round3/j3a.tail.log`, `round3/j3b.tail.log`, script `round3/round3-job-desktop.sh`.

- **J3a runtime-on: MATCH 110 / DIVERGE 107 / INCONCLUSIVE 119 of 336.** **J3b production: MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140.** `adx-and-di-for-v4` is MATCH on both captures (rddt, spy) in the runtime-on lane.
- Against the pre-W1 tree (111/107/118) exactly one capture changed: `delta-rsi-oscillator-strategy-rddt-1d-2026-10-02` MATCH to INCONCLUSIVE ("computeFor returned no column"). It is not a stage-1 candidate (R1 withholds it, over budget). The 21 changes are classified in `round2/harness-lane-diff-round2.json`; the round-3 totals equal the round-2 totals on the unmerged tree, so merging production changed no verdict.

## 4. The readiness census (J4)

`runtimePaneReadiness.measure.test.js` (opt-in; `RF_READINESS=1`), `readiness.json` and `census-run.log`. It takes every committed corpus script (266) that the member door draws **only** through the runtime lane (refused with the runtime pane off, attached with it on): **22 scripts**. For each it times the door (`memberPaneDefinition`, on the main thread, on every edit), the run (`computeRuntimeColumns`, the one computation the worker runs) at 5,000 and 11,534 daily bars and at 20,208 and 32,000 five-minute bars (median of 3 in node, ms), and re-runs under the shipped 1,000 ms budget any length whose slowest run passed 800 ms, which must stop **by name**. It asserts no timing (a wall clock is the machine's).

Median of 3, ms. A parenthesis names how the unbudgeted run ended: `limit` is `runtime:limit`, `failed` is `runtime:failed`, `budget` is `runtime:time-budget`, `text` is `interpret:bind-time-text`.


| script | plots | door (warm, ms) | D 5000 | D 11,534 | 5m 20,208 | 5m 32,000 | stops under the 1,000 ms budget |
|---|---:|---:|---|---|---|---|---|
| adx-and-di-for-v4 | 3 | 22 | 21.1 | 35.1 | 48.6 | 62.2 | none |
| atr-stepped-pdf-ma-loxx | 1 | 36 | 7.6 | 19.9 | 45.9 | 34.6 | 5m 20208: time-budget |
| cc-yata | 54 | 4672 | 18.5 | 44.9 | 120 | 1074 | none |
| deadband-hysteresis-filter-backquant | 1 | 46 | 11.6 (text) | 18.7 (text) | 30.6 (text) | 39.2 (text) | none |
| delta-rsi-oscillator-strategy | 4 | 65 | 3485 (limit) | 3013 (limit) | 2891 (limit) | 3017 (limit) | D 5000: time-budget; D 11534: time-budget; 5m 20208: time-budget; 5m 32000: time-budget |
| fair-value-gap | 1 | 59 | 13 | 1138 (limit) | 230 (text) | 282 (text) | D 11534: time-budget |
| fibonacci-dolphintradebot | 2 | 840 | 77.6 | 129 | 149 | 302 | D 11534: time-budget; 5m 20208: time-budget |
| fvg-trend | 1 | 38 | 16.4 | 24.6 | 32.3 | 44.7 | none |
| inside-bar-boxes | 2 | 40 | 12.9 (text) | 23.8 (text) | 41.2 (text) | 58.3 (text) | none |
| inside-bar-range-mother-candle-breakoutbr... | 2 | 11 | 5.4 | 10.4 | 18.8 | 29.6 | none |
| kalman-price-filter-backquant | 1 | 14 | 1.3 | 3.4 | 4.8 | 15.1 | none |
| linear-regression-channel | 1 | 54 | 153 (failed) | 230 (failed) | 275 (failed) | 338 (failed) | none |
| macd-with-filter-visual-backtest-module-s... | 8 | 128 | 77.1 (text) | 186 (text) | 278 (text) | 420 (text) | none |
| machine-learning-knn-based-strategy | 1 | 58 | 3751 (budget) | 176 (failed) | 5204 (limit) | 5434 (budget) | D 5000: time-budget; 5m 20208: time-budget; 5m 32000: time-budget |
| nadaraya-watson-rational-quadratic-kernel... | 1 | 114 | 2.1 | 2.5 | 4 | 7.5 | none |
| order-block-finder | 10 | 55 | 14 | 19.3 | 34.9 | 52.5 | none |
| order-blocks | 1 | 73 | 71 (failed) | 97.2 (failed) | 180 (failed) | 309 (failed) | none |
| parabolic-sar | 1 | 109 | 59.9 | 82.3 | 135 | 284 | none |
| renko-candles-overlay | 1 | 272 | 19.5 (text) | 27.5 (text) | 32.6 (text) | 39.1 (text) | none |
| trend-targets-algoalpha | 5 | 392 | 17 | 38.4 | 57.1 | 221 | none |
| williams-fractal-trailing-stops | 6 | 63 | 6.9 | 14.6 | 21.7 | 59.6 | none |
| wyckoff-accumulation-distribution | 8 | 206 | 8.2 | 7.2 | 8.3 | 7.3 | none |


What it says:
- **The allowlisted script is cheap.** `adx-and-di-for-v4` runs in 21 ms at 5,000 daily bars and 62 ms at 32,000 five-minute bars; its door costs 22 ms. (The worker probe, section 5, is the instrument for budgets.)
- **Four scripts stop on `interpret:bind-time-text`** (`deadband`, `inside-bar-boxes`, `macd-with-filter...`, `renko`; `fair-value-gap` at the two intraday lengths). That is an artifact of this census, which hands the run no symbol, so a script that reads `syminfo.*` stops at bind time in about the time it takes to refuse; those timings are not run costs. The probe passes `--symbol AAPL:NASDAQ`.
- **Named failures at every length:** `linear-regression-channel` and `order-blocks` answer `runtime:failed`.
- **Over the 1,000 ms budget, by name:** `delta-rsi-oscillator-strategy` at every length (about 3 s to its `runtime:limit` unbudgeted; stopped by `runtime:time-budget` after bar 1,054 of 5,000 under the budget), `machine-learning-knn-based-strategy` at three of four lengths (and `runtime:failed` at 11,534 daily bars), `fair-value-gap` at 11,534 daily bars (1,138 ms to its limit; stopped by the budget at bar 10,006). `cc-yata` needs 1,075 ms median at 32,000 five-minute bars (slowest 1,163) and completed inside the budget when re-run.
- **Three slow outliers are not steady-state costs.** `atr-stepped-pdf-ma-loxx`, `fibonacci-dolphintradebot` and `nadaraya-watson...` each show a slowest run of 0.8 to 5.0 s against medians of 8 to 300 ms. The cause is not established (a cold first run, a GC pause and contention on a shared machine are all possible), but their budget stops follow the outlier, not the median; the 11-run p95 in section 5 is the reading to use for them.
- **The door.** Median warm door cost across the 22 is 63 ms. The costly ones: `cc-yata` 4,672 ms (the host translation, which is 5,037 ms with the runtime pane off; the runtime lane's own share, its compile probe, is 53 ms), `fibonacci-dolphintradebot` 840 ms, `trend-targets-algoalpha` 392 ms, `renko-candles-overlay` 272 ms, `wyckoff...` 207 ms.
- **B3** (a 32,768-bar intraday run in 1,000 ms or a named stop): at 32,000 five-minute bars 13 scripts complete (median 52 ms, slowest `cc-yata` 1,075 ms), and every other one ends in a named guard (`limit`, `failed`, `budget`, or the `text` artifact). No run hung.

The slowest-of-3 rows over 800 ms:


| script | length | median of 3 (ms) | slowest of 3 (ms) | unbudgeted run ended with | re-run under the 1,000 ms budget |
|---|---|---:|---:|---|---|
| atr-stepped-pdf-ma-loxx | D 11534 | 19.9 | 841 | completed | completed |
| atr-stepped-pdf-ma-loxx | 5m 20208 | 45.9 | 2508 | completed | runtime:time-budget |
| atr-stepped-pdf-ma-loxx | 5m 32000 | 34.6 | 2970 | completed | completed |
| cc-yata | 5m 32000 | 1074 | 1163 | completed | completed |
| delta-rsi-oscillator-strategy | D 5000 | 3485 | 3547 | runtime:limit | runtime:time-budget |
| delta-rsi-oscillator-strategy | D 11534 | 3013 | 3671 | runtime:limit | runtime:time-budget |
| delta-rsi-oscillator-strategy | 5m 20208 | 2891 | 4733 | runtime:limit | runtime:time-budget |
| delta-rsi-oscillator-strategy | 5m 32000 | 3017 | 3041 | runtime:limit | runtime:time-budget |
| fair-value-gap | D 11534 | 1138 | 1391 | runtime:limit | runtime:time-budget |
| fibonacci-dolphintradebot | D 5000 | 77.6 | 1184 | completed | completed |
| fibonacci-dolphintradebot | D 11534 | 129 | 2290 | completed | runtime:time-budget |
| fibonacci-dolphintradebot | 5m 20208 | 149 | 3172 | completed | runtime:time-budget |
| fibonacci-dolphintradebot | 5m 32000 | 302 | 4988 | completed | completed |
| machine-learning-knn-based-strategy | D 5000 | 3751 | 5057 | runtime:time-budget | runtime:time-budget |
| machine-learning-knn-based-strategy | 5m 20208 | 5204 | 5407 | runtime:limit | runtime:time-budget |
| machine-learning-knn-based-strategy | 5m 32000 | 5434 | 5462 | runtime:time-budget | runtime:time-budget |
| nadaraya-watson-rational-quadratic-ke... | 5m 32000 | 7.5 | 890 | completed | completed |

## 5. The budgets (4.3), B1 to B5

The instruments are the worker probe (`tools/runtime_pane_worker_probe.py`) and the census (section 4). The probe loads the real built `runtimeWorker-*.js` into a headless Chromium that the tool launches itself (Playwright, a fake origin `rf-probe.invalid`, no network, no profile; none of the owner's browsers), posts each census script's document and bars as `runtimeAsync.workerRunner` does, and records the worker's turnaround and the main thread's largest gap between animation frames while it works. The probe ran with `--runs 11 --lengths "D 5000" --symbol AAPL:NASDAQ --checkpoint 20` and `--cpu-throttle 4` (one invocation: the desktop phase first, then the throttled page) over the 22 runtime-only documents the census minted; p50 and p95 are over the 10 warm attempts (attempt 1 also fetches and compiles the bundle). The bundle is the one built for B4 below, from the first-merge tree (section 11).

### 5.1 The controls ran first and are read here

- **Frame-gap control** (desktop run): a deliberate 400 ms main-thread block must be seen as a gap of at least 350 ms. It read **400 ms** (`probe-x4.json`, `control`); verdict of the run: `OFF-MAIN-THREAD`.
- **Throttle control** (x4 run): a fixed busy loop timed in the stand-in page unthrottled and throttled: **256 ms to 1763 ms, a ratio of x6.88** for the x4 asked (the floor is half of it). Verdict: `MEASURED`.
  - The busy-loop control is a noisy floor test on a loaded machine (its unthrottled loop took 256 ms), so its ratio is not used to correct any number. The better calibration is the work the scripts do: the x4 p50 over the desktop p50 for the 14 scripts that answer `ok` on both profiles has a median of **x3.46** (range x0.82 to x5.83), the stage-1 script x3.72. The profile ran at about the rate asked on real work.
- **The x4 profile is a stand-in, not a device.** Chromium refuses a CPU throttle on a worker target ("only supported for pages"), so the low-end profile runs the same bundle's handler on a throttled **page**, on the page's thread. B1 therefore reads the desktop run only (a handler run on the page blocks the page by construction).
- The desktop figures are the first phase of the x4 invocation (`probe-x4.json`: the real worker runs first, then the throttled page). The separate desktop-only run did not get the heavy lock in time, so there is no second desktop measurement to compare.

### 5.2 The stage-1 script, budget by budget

| budget | requires | `adx-and-di-for-v4` | verdict |
|---|---|---|---|
| B1 | main-thread frame gap of at most 1 frame during a worker run (one 60 Hz frame is 16.7 ms; the plan read 17 ms as met) | worst gap while this script ran, desktop: **16.8 ms** over runs of 2 to 11 frames. Worst over all 22 scripts: 16.8 ms | **PASS** |
| B2 | p95 at most 1,000 ms at 5,000 daily bars on a low-end profile, for every allowlisted script | x4: p50 **40.2** ms, p95 **48.5** ms (ok); desktop p50 10.8, p95 33.1 ms | **PASS** (on the stand-in) |
| B3 | a 32,768-bar run in at most 1,000 ms or a named stop | census, node: 62 ms at 32,000 five-minute bars, 49 ms at 20,208; every one of the 22 scripts ends in a completion or a named guard (section 4) | **PASS** |
| B4 | worker chunk at most 450 KB gzip, fetched only when a runtime pane computes | **358,185 B gzip -9** (1,142,621 B raw), one self-contained file; the plan's 2026-10-31 reading was 330,012 B (+8.5%) | **PASS** |
| B5 | realtime rerun from a checkpoint at most 50 ms per tick at 5,000 daily bars | tick p95: desktop **19.4 ms**, x4 **52.3 ms** (full run first: 43.5 ms desktop, 166 ms x4) | **PASS** desktop; x4 misses on the stand-in, accepted by the coordinator for the adx-only stage 1 (owner's 2026-11-02 autonomy grant) |

Which budgets gate what (PHASE3-RUNTIME-PLAN 4.5): B1 is part of the stage-0 exit, so it gates stage 1. B2 gates stage 3 ("B2 met on the low-end profile"); B4 and B5 are arming prerequisites in the plan's WS-H and do not name a stage. B5 does not stop stage 1: its only miss is the x4 stand-in, accepted as above. B3 is a named-stop rule, not a gate.

### 5.3 Every census script, for reference (D 5000)

| script | desktop p50 / p95 (ms) | answer | x4 p50 / p95 (ms) | answer | desktop tick p95 (ms) | x4 tick p95 (ms) | tick answer |
|---|---|---|---|---|---|---|---|
| adx-and-di-for-v4 | 10.8 / 33.1 | ok | 40.2 / 48.5 | ok | 19.4 | 52.3 | ok |
| atr-stepped-pdf-ma-loxx | 6.7 / 14.5 | ok | 1097 / 1190 | time-budget | 11.4 | 30.7 | ok |
| cc-yata | 30.8 / 37.3 | ok | 122 / 1614 | ok/time-budget | 41.0 | 139 | ok |
| deadband-hysteresis-filter-backquant | 6.0 / 9.8 | ok | 19.5 / 37.0 | ok | 9.4 | 18.5 | ok |
| delta-rsi-oscillator-strategy | 1019 / 1038 | time-budget | 1170 / 1263 | time-budget | 1034 | 1156 | time-budget |
| fair-value-gap | 9.0 / 20.4 | ok | 1256 / 1451 | time-budget | 13.3 | 1286 | ok |
| fibonacci-dolphintradebot | 12.2 / 17.4 | ok | 81.8 / 1856 | ok/time-budget | 15.5 | 68.1 | ok |
| fvg-trend | 6.1 / 11.9 | ok | 31.5 / 45.2 | ok | 14.0 | 28.3 | ok |
| inside-bar-boxes | 9.0 / 18.9 | ok | 52.5 / 95.5 | ok | 17.1 | 47.7 | ok |
| inside-bar-range-mother-candle-breakout... | 7.5 / 10.7 | ok | 31.9 / 78.1 | ok | 13.7 | 34.4 | ok |
| kalman-price-filter-backquant | 5.2 / 16.5 | ok | 13.3 / 28.3 | ok | 10.9 | 9.9 | ok |
| linear-regression-channel | 36.0 / 64.5 | failed | 190 / 424 | failed | 76.5 | 279 | failed |
| macd-with-filter-visual-backtest-module... | 67.6 / 76.0 | ok | 277 / 439 | ok | 124 | 643 | ok |
| machine-learning-knn-based-strategy | 1052 / 1090 | time-budget | 1249 / 1549 | time-budget | 1153 | 1526 | time-budget |
| nadaraya-watson-rational-quadratic-kern... | 6.7 / 11.4 | ok | 5.5 / 10.0 | ok | 16.6 | 1059 | ok |
| order-block-finder | 20.1 / 28.5 | ok | 41.8 / 67.6 | ok | 37.4 | 88.4 | ok |
| order-blocks | 58.3 / 72.6 | failed | 272 / 622 | failed | 204 | 555 | failed |
| parabolic-sar | 9.9 / 19.3 | ok | 40.7 / 67.5 | ok | 63.5 | 77.3 | ok |
| renko-candles-overlay | 12.1 / 20.3 | ok | 26.8 / 32.3 | ok | 54.6 | 69.4 | ok |
| trend-targets-algoalpha | 10.9 / 23.4 | ok | 39.9 / 66.6 | ok | 118 | 70.3 | ok |
| williams-fractal-trailing-stops | 9.3 / 14.1 | ok | 19.7 / 27.3 | ok | 31.5 | 40.8 | ok |
| wyckoff-accumulation-distribution | 7.4 / 12.5 | ok | 15.0 / 28.6 | ok | 19.1 | 19.1 | ok |

### 5.4 Reading

- **The stage-1 script against the budgets above**: inside B3, B4, B1, B2, B5 on the desktop; **misses** B5 at x4: tick p95 52.3 ms against 50 (2.3 ms over). The stand-in profile is not a device, and the figure is one draw on a loaded machine (5.1). The coordinator accepts the miss for the adx-only stage 1 under the owner's 2026-11-02 autonomy grant.
- **B2 on the stand-in**: 8 of 22 scripts miss the 1,000 ms p95 or do not answer `ok` at x4 (`atr-stepped-pdf-ma-loxx`, `cc-yata`, `delta-rsi-oscillator-strategy`, `fair-value-gap`, `fibonacci-dolphintradebot`, `linear-regression-channel`, `machine-learning-knn-based-strategy`, `order-blocks`). Only the allowlisted script is bound by B2 today.
- **B5**: 8 of 22 scripts miss 50 ms or do not answer `ok` on the desktop tick (`delta-rsi-oscillator-strategy`, `linear-regression-channel`, `macd-with-filter-visual-backtest-module-sample`, `machine-learning-knn-based-strategy`, `order-blocks`, `parabolic-sar`, `renko-candles-overlay`, `trend-targets-algoalpha`); 14 of 22 at x4 (`adx-and-di-for-v4`, `cc-yata`, `delta-rsi-oscillator-strategy`, `fair-value-gap`, `fibonacci-dolphintradebot`, `linear-regression-channel`, `macd-with-filter-visual-backtest-module-sample`, `machine-learning-knn-based-strategy`, `nadaraya-watson-rational-quadratic-kernel-non-repainting`, `order-block-finder`, `order-blocks`, `parabolic-sar`, `renko-candles-overlay`, `trend-targets-algoalpha`). The tick has the same checkpoint path for every script; only the allowlisted script is bound by it today.
- **Earlier readings, for the record** (PHASE3-RUNTIME-PLAN 4.3, WS-H 2026-10-31): B1 17 ms; B2 for the allowlist p95 112 ms at x4; B4 330,012 B gzip; B5 desktop tick p95 for this script 19 ms. This section re-measures them on the merged tree.

## 6. The candidate stage-1 allowlist

### 6.1 The rule applied

A script is a candidate only when all of these hold:
1. **R1-clean.** The real `api/services/rollout_gate.py::pine_runtime_admission`, given the committed registry (`reassign` and `ternary` conformant with evidence, `conditional-ta` divergent) and the script's census capabilities, returns no reason. `candidates.py` calls that function itself (lifted from the file by AST), so the verdict is the gate's, not a copy.
2. **At least one committed MATCH capture through the runtime lane.** A capture the pane-off run did not already grade MATCH, graded MATCH with the pane on (`harness-lane-diff.json`).
3. **With the server's list latched.** The runtime-on harness lane grades with every script allowed, so it cannot show this; the P1 rail does, for any script on the committed list.
4. **No DIVERGE capture of the same script** in the runtime-on lane (a W2 addition; the reviewer may overrule it).
5. **Within the budgets** that apply (B2, B5; section 5).

### 6.2 The stage-1 allowlist is one script: `adx-and-di-for-v4`


| | |
|---|---|
| script | `adx-and-di-for-v4`, `corpus/committed/adx-and-di-for-v4__932.pine` |
| allowlist key | sha256 `d0853c4724651a1d3c63542a2ae767861030137cb1c75ea57a376c53a1630499`, **already** in the committed `api/data/pine_runtime_allowlist.json` (`scripts[0]`), so serving it at stage 1 needs no commit |
| census capabilities | `reassign`, `ternary`; the registry holds both as `conformant`, evidence the two captures below (`capabilities.reassign`, `capabilities.ternary`) |
| R1, from the real `pine_runtime_admission` | no reason: **admitted** |
| captures through the runtime lane | `adx-and-di-for-v4-rddt-1d-2026-09-27` and `adx-and-di-for-v4-spy-1d-2026-10-03`: INCONCLUSIVE with the pane dark, **MATCH** ("all 4 items agree") with it on |
| a DIVERGE capture of this script | none |
| with the server's list latched | the allowlist rail `runtimeAllowlistParity.test.js`: 4 of 4 passed (`parity-run.log`, first-merge tree); final tree: 4 of 4 (`final-vitest.log`); its latch is mutation-proved, 3 of 3 mutations killed (`parity-mutations.json`) |
| cost, census (node) | door 22.5 ms (warm); run 21.1 ms at 5,000 daily bars, 35.1 at 11,534, 48.6 at 20,208 five-minute bars, 62.2 at 32,000 |
| cost, worker probe | desktop: p50 10.8 / p95 33.1 ms (ok), tick p95 19.4 ms; x4 stand-in: p50 40.2 / p95 48.5 ms (ok), tick p95 52.3 ms |


### 6.3 What an admin sees for any other script at stage 1

The lane draws nothing for it. The member door declines it with the host lane's own sentence and the tag `runtime:not-yet-graded` (`runtimeKill.js:149-158`, `runtimeNotGradedOf`). The P1 rail's control proves this against the real latch (`cc-yata-rddt-1d-2026-09-27`, a runtime-only script that is not on the list, declined by the gate and drawn by the runtime lane once every script is allowed). A stored runtime row of an ungraded script is served stamped `meta.runtimeNotGraded`, never rewritten and never deleted (`runtime_definitions.py` `stamp_served`).


### 6.4 Everything else with a runtime-lane MATCH, and why it is not a stage-1 candidate

14 scripts have at least one runtime-lane MATCH capture (`stage1-candidates.json`, `runtimeLaneMatchScripts`); three more have a runtime-lane DIVERGE and no MATCH. Only the first passes rule 1.

**A. Not stage-1 candidates: R1 withholds them only for rows that do not exist yet** (no `divergent` row). These are the next in line.

| script | captures (runtime lane) | R1 reasons | census cost, median ms (section 4) | worker probe (section 5) |
|---|---|---|---|---|
| `parabolic-sar` | RDDT 1d MATCH | no registry row for `if-block` | door 109; D 5000 59.9; 5m 32000 284 | desktop: D 5000 p95 19.3 ms (ok), tick p95 63.5 ms; x4: D 5000 p95 67.5 ms (ok), tick p95 77.3 ms |
| `kalman-price-filter-backquant` | RDDT 1d MATCH | no registry row for `fn-multi`, `fn-single`, `for`, `if-block`, `typed-array`, `var` | door 14.4; D 5000 1.3; 5m 32000 15.1 | desktop: D 5000 p95 16.5 ms (ok), tick p95 10.9 ms; x4: D 5000 p95 28.3 ms (ok), tick p95 9.9 ms |
| `wyckoff-accumulation-distribution` | RDDT 1d MATCH, SPY 1d MATCH | no registry row for `fn-multi`, `fn-single`, `for`, `history-expr`, `if-block`, `var` | door 206; D 5000 8.2; 5m 32000 7.3 | desktop: D 5000 p95 12.5 ms (ok), tick p95 19.1 ms; x4: D 5000 p95 28.6 ms (ok), tick p95 19.1 ms |

**B. Withheld by `conditional-ta` (and the rows they lack).** The census names these scripts `conditional-ta`; the registry row is `divergent`. 9a is the case for deadband and fibonacci; 9b is renko.

| script | captures (runtime lane) | R1 reasons | census cost, median ms (section 4) | worker probe (section 5) |
|---|---|---|---|---|
| `deadband-hysteresis-filter-backquant` | RDDT 1d MATCH | `conditional-ta` is divergent; no registry row for `compound-assign`, `fn-multi`, `fn-single`, `if-block`, `var` | door 46.5; D 5000 11.6 (bind-time-text); 5m 32000 39.2 (bind-time-text) | desktop: D 5000 p95 9.8 ms (ok), tick p95 9.4 ms; x4: D 5000 p95 37.0 ms (ok), tick p95 18.5 ms |
| `fibonacci-dolphintradebot` | RDDT 1d MATCH, SPY 1d MATCH | `conditional-ta` is divergent; no registry row for `fn-multi`, `fn-single`, `if-block`, `max_bars_back`, `switch`, `var` | door 840; D 5000 77.6; 5m 32000 302 | desktop: D 5000 p95 17.4 ms (ok), tick p95 15.5 ms; x4: D 5000 p95 1856 ms (ok/runtime:time-budget), tick p95 68.1 ms |
| `renko-candles-overlay` | RDDT 1d MATCH, SPY 1d INCONCLUSIVE | `conditional-ta` is divergent; no registry row for `compound-assign`, `fn-multi`, `fn-single`, `for`, `if-block`, `max_bars_back`, `var`, `while` | door 272; D 5000 19.5 (bind-time-text); 5m 32000 39.1 (bind-time-text) | desktop: D 5000 p95 20.3 ms (ok), tick p95 54.6 ms; x4: D 5000 p95 32.3 ms (ok), tick p95 69.4 ms |

**C. Withheld by their captures or their cost.**

| script | captures (runtime lane) | R1 reasons | census cost, median ms (section 4) | worker probe (section 5) |
|---|---|---|---|---|
| `inside-bar-range-mother-candle-breakoutbr...` | RDDT 1d MATCH, SPY 1d DIVERGE | no registry row for `fn-multi`, `fn-single`, `if-block`, `var` | door 11.1; D 5000 5.4; 5m 32000 29.6 | desktop: D 5000 p95 10.7 ms (ok), tick p95 13.7 ms; x4: D 5000 p95 78.1 ms (ok), tick p95 34.4 ms |
| `delta-rsi-oscillator-strategy` | RDDT 1d MATCH, SPY 1d INCONCLUSIVE | no registry row for `fn-multi`, `fn-single`, `for`, `history-expr`, `if-block`, `tuple-destructure`, `var` | door 64.9; D 5000 3485 (limit); 5m 32000 3017 (limit) | desktop: D 5000 p95 1038 ms (runtime:time-budget), tick p95 1034 ms; x4: D 5000 p95 1263 ms (runtime:time-budget), tick p95 1156 ms |

`trend-targets-algoalpha` has a runtime-lane DIVERGE on RDDT and no MATCH (INCONCLUSIVE on SPY); it also carries `conditional-ta`. The plan records the RDDT difference as "`Baseline` is `na` here on 82 scattered bars (140 to 221) where TradingView has a value", to diagnose before it is allowlisted (PHASE3-RUNTIME-PLAN 2.4, at `b09a6bcee6`; not re-derived here).

**D. The programme's own witness scripts** (`tools/visual_conformance/probes/*.pine`; each has a committed source and a runtime-lane MATCH, and each is a probe built to isolate a construct, not a script a member runs). They are not stage-1 candidates because R1 needs rows for what they use, and because nothing is gained by serving a probe. Their value is as row evidence (9c).

| script | captures (runtime lane) | R1 reasons | census cost, median ms (section 4) | worker probe (section 5) |
|---|---|---|---|---|
| `h3-alma-v4` | RDDT 1d MATCH, SPY 1d INCONCLUSIVE | no registry row for `fn-multi`, `fn-single`, `for` | not in the census | not in the census, so not probed |
| `r1-strategy-draws-indicator` | RDDT 1d MATCH | no registry row for `compound-assign`, `if-block`, `var` | not in the census | not in the census, so not probed |
| `vw-clock-close-tfchange` | SPY 1d MATCH, SPY 1w INCONCLUSIVE | no registry row for `fn-single` | not in the census | not in the census, so not probed |
| `vw-h4-loops` | RDDT 1d MATCH, SPY 1d MATCH | no registry row for `fn-multi`, `fn-single`, `for`, `if-block`, `typed-array`, `var` | not in the census | not in the census, so not probed |
| `vw-var-seed` | SPY 1d MATCH | no registry row for `var` | not in the census | not in the census, so not probed |

The three DIVERGE-only captures are `trend-targets-algoalpha-rddt-1d-2026-10-02`, `r1-strategy-draws-rddt-1d-2026-10-02` (last-bar strategy values, per the plan) and `vw-deadband-ticks-brk-a-1d-2026-09-28` (the `barcolor` paint not carried, per the plan).

## 7. The exact Railway variable changes, for stage 1 and for rollback

Nothing below was run, and Railway was not read either. The states quoted are the repo ledger's (`docs/feature_flags.json`), which records intent and cannot see Railway. Read the live values first (7.1).

### 7.1 What the ledger says, and the read to take before step 1

| name | kind | ledger state |
|---|---|---|
| `VITE_PINE_RUNTIME_PANE_ENABLED` | build variable on `web` | `railway_value`: "UNSET on every service"; `baked_value`: "undefined (never set)"; status `dark` (`build_flags`) |
| `PINE_RUNTIME_STAGE` | `web`, read per request | status `dark`, `where: []`, default `off`, values `off`, `admins`, `cohort`, `all` |
| `PINE_RUNTIME_SAVE_ENABLED` | `web`, read per call | status `dark`, `where: []` |
| `PINE_RUNTIME_KILL_LIST` | `web`, read per call | status `dark`, default "unset (empty list: no script killed)" |
| `PINE_RUNTIME_ALLOWLIST` | `web`, read per call | status `dark`, default "unset (only the committed `api/data/pine_runtime_allowlist.json` counts: adx-and-di-for-v4 today)" |
| `VITE_PINE_MEMBER_PANE_ENABLED` | build variable on `web` | expected `'1'` (a read-only check before step 1) |
| `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED` | build variable on `web` | status `armed`, "1 on web, READ LIVE 2026-09-30" (the harness's production lane assumes it on) |

The read (changes nothing): `railway variables --service web --kv`, and look at those seven names only. Do not paste the rest of the output: it holds secrets. The ledger is the artifact most likely to be stale (`CLAUDE.md`, "`railway variables --set` measured both ways").

### 7.2 No code deploy is needed to arm, and one thing to know about production

`origin/production` is `edd353fc06` and equals `origin/master` (`git ls-remote`, 2026-11-04). Production was `8fbf76c6ee` in the round-1 packet and `e26130c7f6` when the round-3 rails ran. It contains `67a6dada10`, the commit this branch first merged (`git merge-base --is-ancestor`: yes). So everything the arming steps rely on is on production: `api/services/rollout_gate.py` (R1 admission and the cohort stage), `api/services/runtime_definitions.py` (the stage ladder), `api/routers/pine_runtime_telemetry.py` (mounted at `api/main.py:10408-10409`), `api/data/pine_runtime_allowlist.json`, `tools/runtime_pane_smoke.py`, `app/src/lib/runtimePanePermission.js`, and `Dockerfile.web:114` (`ARG VITE_PINE_RUNTIME_PANE_ENABLED`) with `:139` (the `ENV` that passes it into the build). This branch adds tests, docs and evidence only (and one edit to a measurement test, `runtimePaneReadiness.measure.test.js`); it is not a precondition of arming.

**What changed on the lane's path while this ran, and where it is.** PR 701 (`30bdc91367`) changed these files on the lane's path against `67a6dada10`: `api/routers/user_definitions.py`, `api/services/user_definitions.py`, `app/src/components/chart/engine/ast/callExpansions.js`, `app/src/components/chart/engine/ast/closedTable.json`, `app/src/components/chart/engine/binder.js`. PR 703 (`8fbf76c6ee`) changes, against PR 701: `docs/feature_flags.json`. The server files are the line-identity feature (`plot_identities` is served beside the stored definition and never inside it, which the rails that pin "served equals stored" depend on); the client files add three native-formula expansions and one source-reference check. Round 3 re-ran the vitest rails, J3a/J3b, the seven pytest rails (202 passed) and the deploy gate (82 passed) on a tree with production merged (section 3.3), so the rails describe the code production runs. Since `8fbf76c6ee`, production also gained `api/services/runtime_definitions.py` (W5 T12 server-stage admission, called by nothing), `api/main.py` (chart_iq), `docs/feature_flags.json`, and the W1 client lane files (identical blobs to this branch).


### 7.3 Stage 1, in order (the GT operator steps, `docs/pine/runtime-pane-switch-on-plan.md`, "GT operator steps")

| # | change | command | rebuild? | reach | proof before the next step |
|---|---|---|---|---|---|
| 1 | stage off, explicitly, so "off on purpose" differs from "unset" | `railway variables --service web --set "PINE_RUNTIME_STAGE=off"` | no (runtime variable) | the next request | a NEW boot (`/api/health` `uptime_seconds` reset) |
| 2 | the build flag on | `railway variables --service web --set "VITE_PINE_RUNTIME_PANE_ENABLED=1"` | **yes**: a build variable, so `web` rebuilds from `Dockerfile.web:114,139`; the rebuild is the deploy | a deploy (an `/api/*` blip, `docs/runbooks/deploy-windows.md` Tier 1); an open tab keeps its old bundle until reload | a NEW boot, and the flag in the served bundle (the smoke's check 1) |
| 3 | nothing changed for anyone | none | n/a | | `python tools/runtime_pane_smoke.py --auth --expect-pane off` and `python tools/hub_nav_smoke.py --auth`, both exit 0 |
| 4 | stage admins | `railway variables --service web --set "PINE_RUNTIME_STAGE=admins"` | no | each admin's next authenticated request or reload (the client latches the first answer per tab) | read the value in the running process over `railway ssh` (the GT doc's step 3 gives the exact form) |
| 5 | smoke as the synthetic admin | `python tools/runtime_pane_smoke.py --auth --expect-pane on` and `python tools/hub_nav_smoke.py --auth` | | | both exit 0 |
| 6 | record each flip | `docs/feature_flags.json`: `PINE_RUNTIME_STAGE` and `VITE_PINE_RUNTIME_PANE_ENABLED` to `armed`, `where: ["web"]`, the flip time in the note, in the same docs push | | | the ledger, not memory |

`railway variables --set` has been measured both to stage and to redeploy (`CLAUDE.md`); either way verify a new boot and read the value in the process, never from `--kv` alone. Setting steps 1 and 2 in one command (two `--set` flags) would be one deploy instead of two; that form was not measured, and the plan uses two commands.

### 7.4 What stays unset, on purpose

- `PINE_RUNTIME_ALLOWLIST`: unset. The allowlist value in force is the committed JSON, which serves exactly one script: `adx-and-di-for-v4`, sha256 `d0853c4724651a1d3c63542a2ae767861030137cb1c75ea57a376c53a1630499`. Were the variable used instead, that hash would be its whole value; it is not recommended, because the variable is additive and ungraded. The ledger's own words: "Keep this variable UNSET in production: its entries carry no evidence, so a set value serves a script outside R1". A script is added by a commit to the JSON with its evidence.
- `PINE_RUNTIME_KILL_LIST`: unset (empty list, nothing killed). It is the per-script lever for rollback.
- `PINE_RUNTIME_SAVE_ENABLED`: unset at stage 1, so the pane is preview only and no runtime document can be saved (ledger: "Unset refuses every runtime document with a sentence the member door renders"; the plan lists the save door as an optional step 3b). Setting it is a separate owner decision: it lets an admin save a runtime document, which is then served stamped by the kill list and the stage, and from then on a stored row exists for the kill list and the stage-off stamp to act on.


### 7.5 Rollback (every lever is a variable or a list entry; none deletes a saved definition)

| scope | lever | cost | reach |
|---|---|---|---|
| everyone, admins included | `railway variables --service web --set "PINE_RUNTIME_STAGE=off"` | no code deploy; the set itself may restart `web` | the next authenticated request. An open tab that holds a yes re-asks `/api/auth/me` once its answer is 60 s old and applies the no (`app/src/lib/runtimePanePermission.js:36,59`), and every run of a loaded pane re-asks (`nativeRegistry.js:3027`), so a drawing pane stops on its next run with `runtime:switched-off` |
| one script | `railway variables --service web --set "PINE_RUNTIME_KILL_LIST=<sha256 or u_ id>"` | no deploy | the next definitions read; an open tab re-reads the list once it is 60 s old (`runtimeKill.js:50`) and its next run answers `runtime:killed`. Kill wins over the allowlist |
| one allowlist entry | remove its object from `api/data/pine_runtime_allowlist.json` (commit and deploy), or kill it by hash (faster) | | |
| the saving door | `railway variable delete PINE_RUNTIME_SAVE_ENABLED --service web`, then `railway redeploy --service web --yes` | a delete does not restart `web` by itself | saved rows stay and are still served |
| the bundle | `railway variable delete VITE_PINE_RUNTIME_PANE_ENABLED --service web`, then `railway redeploy --service web --yes` | a deploy (rebuild); a delete does not restart on its own | an open tab keeps its bundle until reload |

The trigger is the smoke's exit code (H15): 1 is a measured break, roll back first and diagnose after; 2 is inconclusive and never a rollback trigger. Confirm any rollback in the running process over `railway ssh`, not from `--kv`.

## 8. The watch period, and the checks that must pass before widening to the cohort

### 8.1 What the plan says (PHASE3-RUNTIME-PLAN 4.5)

- Stage 1 (owner-only), gate to leave: "2 weeks, with zero `worker-failed`/`load-failed`, no H14 (repaint loop) report, and the smoke green on each deploy".
- Stage 2 (cohort tag), gate to enter: "needs code: WS-I". That code is built and railed (section 2, last row). Its gate to leave, for stage 3: "allowlist >= 25 graded scripts; P3 met; telemetry shows the time-budget stop rate under 2% of runs".

### 8.2 The window

Fourteen days from the first successful step-5 smoke after `PINE_RUNTIME_STAGE=admins` (7.3), not from the `--set`.

### 8.3 Checks inside the window (all read-only)

| check | how | pass |
|---|---|---|
| the smoke on every `web` deploy | `python tools/runtime_pane_smoke.py --auth --expect-pane on` and `python tools/hub_nav_smoke.py --auth` | exit 0 from both. Exit 1: roll back first (H15). Exit 2: inconclusive, run again, never a rollback trigger |
| the stop telemetry | `GET /api/pine-runtime-telemetry/stops?days=7`, signed in as an admin (`api/routers/pine_runtime_telemetry.py:222`) | `by_guard` holds no `runtime:worker-failed` and no `runtime:load-failed`; every other guard is read per script hash in `by_script` |
| H14, in the live build | open the member pane as an admin in a real browser with the allowlisted script and let it settle. A repaint loop shows in a browser, never in `/api/health` | a bounded number of renders, navigation still works |
| the kill lever works once | early in the window put the allowlisted script's sha256 on `PINE_RUNTIME_KILL_LIST`, confirm a loaded tab's next run answers `runtime:killed` within about 60 s, take it off (a W2 suggestion, not in the plan) | the pane stops and comes back |
| the allowlist is still graded | on the tree being deployed, `runtimeAllowlistParity.test.js` and `tests/test_pine_runtime_switch_on.py` are green | totals lines read, not exit codes |

### 8.4 Before widening to the cohort

All of 8.3 held for the whole window, and:
1. The rails in section 2 are re-run on the master being deployed: the 8 J2 vitest files, the 7 pytest files and the parity rail (`jobs-laptop.sh` lists them).
2. P11, a full-suite run on a whole install: classified in round 3, 0 branch-caused failures (section 10, item 1). Closing it needs the owner to accept that classification, or a rerun of the gate on a quiet machine.
3. The cohort is written with `tools/rollout_cohort.py add --cohort pine-runtime-pane --user <id>` (it prints the diff and writes only with `--apply`; ids only), run where `auth.db` is, then `PINE_RUNTIME_STAGE=cohort`. Rollback is the stage itself: any other value answers without opening `auth.db` or reading a tag, so `admins` or `off` withdraws every tagged member and touches no tag (`api/services/rollout_gate.py:456-465`, rails `test_WSI_R2_*`).
4. A gap in stage 2's exit gate, found while writing this: "the time-budget stop rate under 2% of runs" cannot be computed from S8 as built. The beacon reports stops, once per (script, stop) per tab and at most 32 a tab (`runtimeAsync.js:76,134-139`), and the server counts stops only (`stop_report`: `stops`, `by_guard`, `by_script`). No run count is recorded anywhere, so there is no denominator.

## 9. Owner items, facts only (the reviewer and the coordinator decide)

Nothing in this section is implemented.

### 9a. deadband and fibonacci: a conditional `ta.*` in an input-selected arm

**What the scripts do.** Both are MATCH in the runtime lane, and both are withheld by R1 only because the census names them `conditional-ta`.

| script | where the `ta.*` sits | what selects the arm |
|---|---|---|
| `corpus/committed/deadband-hysteresis-filter-backquant__3fb3d09595.pine` | `getBaseTau(mode, src)` (line 35): `if mode == "ATR"` (line 37) holds `base := ta.atr(atrLen) * atrMult` (line 38) | `mode` is the parameter. The only call site (line 52, `getBaseTau(thrMode, pricesource)`) passes `thrMode`, an `input.string` (line 17) |
| `corpus/committed/fibonacci-dolphintradebot__d93b208611.pine` | `bool Cross_con = switch alert_tpye` (line 165), arms `ta.crossover`, `ta.crossunder`, `ta.cross` (lines 166 to 169) | `alert_tpye` is an `input.string` (line 37) |

In both, the arm taken is the same on every bar for a given input, so the call's history is the bar's history.

**Where the two answers live.**
- The census detector is a regex over comment- and string-stripped code, made block-aware by indentation (`tools/pine_coverage/coverage_map.py`, `COND_TA_RX` and the `conditional-ta` row of `FEATURES`). It asks whether a `ta.*` call is written inside an `if` / `else` / `switch` arm, a `for` / `while` body or a function body. It never looks at the header's condition.
- The runtime front end already does. `pineRuntimeFrontend.js` lines 1655 to 1664 (comment: an arm whose test reads no per-bar value "runs on EVERY bar or on NONE, so its history is the bar's and it does not count here") and `invariantTest` (line 1693): literals, names bound by an input (`inputName`), pointwise operators over them; it fails closed; in a function body a parameter fixed by the call site is its constant (`frameConsts`).
- Rails on that, all green in this packet (`lane-rails.log`: 16 files, 333 tests): `conditionalCallSite.test.js` (an `if` on an input keeps the every-bar column; a `switch` on an input with block arms; a function-body `if` on a text input is the call site's every call), `conditionalArmsParams.test.js` (a test fixed before bar 0 takes one arm on every bar; a value `switch` on an `input.string`; a call passing an input text compiles its own copy; a per-bar argument is refused by name, naming the parameter; a branch on a body local stays refused), `conditionalReviewFollowups.test.js`.
- Lane evidence: deadband RDDT MATCH, fibonacci RDDT and SPY MATCH (`harness-lane-diff.json`).
- The registry row of the same name (`api/data/pine_runtime_allowlist.json`, `capabilities."conditional-ta"`, status `divergent`) is keyed on the census, so R1 (`rollout_gate.pine_runtime_admission`) withholds every script the census names.

So one fact (is this arm per-bar?) is held twice, by a regex and by an AST pass, with two answers.

**The refinement that would treat such an arm as unconditional (census side).** Judge the block header, not only the block:
1. A header is *invariant* when every name in its condition (an `if` or `else if` test, a `switch` subject) is (i) a literal, or (ii) a name bound once at the top level by `input.<kind>(...)` and never reassigned (`:=`, `+=` and the other compound forms) anywhere, with `input.source` excluded (the choice is fixed, the value is a series), or (iii) built from those by pointwise operators (`==`, `!=`, comparisons, `and`, `or`, `not`, arithmetic).
2. A function body's header on a parameter is invariant when every call site of that function passes an argument that satisfies 1 for that parameter. The front end compiles a copy per call site; a regex cannot, so it must require all call sites.
3. An arm under an invariant header does not count toward `conditional-ta`. A `for` or `while` body always counts. Everything else stays conditional: `na(x)` of a series, `bar_index`, `barstate.*`, anything derived from `close`, `input.source`, a name that is reassigned.
4. Left out on purpose: `timeframe.*` and `syminfo.*`, which the front end treats as constant for one binding (`BIND_TIME_CLOCK`); the census has no binding.

What it does **not** do: it does not admit either script. After it, deadband still needs rows for `compound-assign`, `fn-multi`, `fn-single`, `if-block`, `var`, and fibonacci for `fn-multi`, `fn-single`, `if-block`, `max_bars_back`, `switch`, `var` (none has a row today; `stage1-candidates.json`). And it relaxes the only automatic guard against under-declaring: `tests/test_pine_runtime_switch_on.py::test_WSI_R1_a_script_can_never_UNDER_declare_its_census_capabilities` reads the same detector, so a wrong "invariant" would let a per-bar conditional script lose its `conditional-ta` declaration. The lane would still refuse it by name at build time (`runtime:conditional-history`), which is why the direction to prove is the safe one.

**The rails and mutations that would prove it (not built).**
- R-a. `tests/test_pine_coverage_conditional_ta.py`: add to `NEGATIVE` (not found) the deadband shape, the fibonacci shape, an `if` on an `input.bool`, an `if len > 5` on an `input.int`. Add to `POSITIVE` (found) `if close > open` (already there), `if useX and close > open`, an `if` on an `input.source` comparison, an input name reassigned somewhere, a function whose parameter is fixed by an input at one call site and by `close > open` at another, `if na(x)`, `if barstate.islast`, `if bar_index % 2 == 0`, and a `for` body.
- R-b. One shared table of snippets and their expected answer (`conditional` or `invariant`), read by the Python census test and by a vitest that runs `buildRuntimeIr` and expects `runtime:conditional-history` for exactly the `conditional` rows (use a stateful call the lane refuses, not `ta.sma` / `ta.ema` / `ta.rma`, which it serves per call site). The rule it enforces: the census may over-report, never under-report, relative to the lane.
- R-c. A corpus sweep (opt-in, like the census): over the 266 `corpus/committed` scripts the refined census set contains every script the lane refuses with `runtime:conditional-history` (3 in the lane diff).
- R-d. The lane's drawn values are untouched: deadband RDDT and fibonacci RDDT and SPY stay MATCH in the runtime-on harness.
- Mutations, each applied then restored from saved bytes: (M1) the invariance predicate always true: the R-a POSITIVE rows, R-b and R-c go red (the dangerous direction). (M2) always false: the new NEGATIVE rows go red. (M3) drop the never-reassigned check: the reassigned-input row goes red. (M4) treat `input.source` as an input: its row goes red. (M5) judge only the first call site of a function: the mixed-call-site row goes red. (M6) ignore the `switch` subject (any `switch` invariant): a per-bar-subject `switch` row goes red.


### 9b. renko: a data-dependent arm, stays withheld

`corpus/committed/renko-candles-overlay__d76a18d49e.pine`, lines 26 to 36: `float ret = value`, `if na(ret)`, `ret := ta.tr(true)`; called with `ta.atr(modevalue)` (lines 39 to 41). The test reads a per-bar value, so it is not an input-selected arm and the refinement in 9a does not touch it. It stays `conditional-ta`, so R1 withholds it, and it would also need eight rows that have no registry row (`compound-assign`, `fn-multi`, `fn-single`, `for`, `if-block`, `max_bars_back`, `var`, `while`).

On file: RDDT 1D MATCH in the runtime lane (all 2 items agree); SPY 1D INCONCLUSIVE ("1 of 2 items could not be compared"; the cause is not recorded in `harness-lane-diff.json`).

Capture-queue rows are in `docs/pine/capture-queue-2026-11-02-w2.md`: Q-W2R1 (NASDAQ:CRWV 1D from the listing), Q-W2R2 (NYSE:RDDT 1W from the listing), Q-W2R3 (an optional `ta.tr(true)` call-site probe on RDDT and SPY 1D). They are for the owner's rig; none was run.

### 9c. kalman and parabolic-sar: the capability rows each needs, and the evidence on file

Registry today (`api/data/pine_runtime_allowlist.json`): `reassign` conformant and `ternary` conformant (evidence: the two adx captures), `conditional-ta` divergent. Neither script uses `conditional-ta`. The R1 reasons come from the real `pine_runtime_admission` (`stage1-candidates.json`, produced by `candidates.py`).

"Evidence" below means what the registry means by it: a capture graded MATCH with the runtime pane on, by the runtime lane (a capture the pane-off run did not already grade MATCH). "Isolating" means every other capability of that script is already conformant, so its MATCH can only be about that row.

**parabolic-sar** (`corpus/committed/parabolic-sar__xoeoPMOWGJ.pine`; census `if-block`, `reassign`, `ternary`). One capture: `parabolic-sar-rddt-1d-2026-10-03`, MATCH (all 2 items agree). **It needs one row: `if-block`.**

| row | committed evidence | isolating | counter-evidence | rails (behavioural, written from Pine's semantics, not TradingView captures) |
|---|---|---|---|---|
| `if-block` | runtime-lane MATCH in 10 scripts, 13 captures (`stage1-candidates.json`, `capabilityMatrix`) | yes, but only parabolic-sar's own capture: the script to admit is the row's only isolating evidence | `inside-bar-range-mother-candle` SPY DIVERGE (that script also uses `fn-multi`, `fn-single`, `var`); the plan records its cause as one early bar, `plotshape` at bar 2, vendor 1, ours `na` (PHASE3-RUNTIME-PLAN 2.4, measured at `b09a6bcee6`; not re-derived here) | `elseIfChain.test.js` (14), `elseGuardShape.test.js` (8), `blockValuedBinding.test.js` (11), `functionBodyBlockValue.test.js` (9), `conditionalCallSite.test.js` (23): all green in `lane-rails.log` |

**kalman** (`corpus/committed/kalman-price-filter-backquant__47a601e4bc.pine`; census `fn-multi`, `fn-single`, `for`, `if-block`, `reassign`, `ternary`, `typed-array`, `var`). One capture: `kalman-price-filter-backquant-rddt-1d-2026-10-03`, MATCH (all 3 items agree). **It needs six rows: `fn-multi`, `fn-single`, `for`, `if-block`, `typed-array`, `var`.**

| row | committed evidence besides kalman's own capture | isolating | notes |
|---|---|---|---|
| `var` | `vw-var-seed-spy-1d-2026-09-28` MATCH (probe `tools/visual_conformance/probes/vw-var-seed.pine`; census `reassign`, `ternary`, `var`) | yes | the only isolating capture for `var`; `vw-h4-loops` (RDDT, SPY) and 7 more scripts also use it. Rail: `declarationPersistence.test.js` (8). (`ast/listingSeed.test.js` is the columnar lane's `var`, not the VM's) |
| `for`, `typed-array`, `fn-multi`, `fn-single` | `vw-h4-loops-rddt-1d-2026-10-03` and `-spy-1d-2026-10-03`, both MATCH: a witness whose census set equals kalman's exactly (`fn-multi`, `fn-single`, `for`, `if-block`, `reassign`, `ternary`, `typed-array`, `var`). Probe `tools/visual_conformance/probes/vw-h4-loops.pine`, rows L1 (weighted running total over a call-site length `a + b`), L2 (a state array seeded by a helper that ends in `if` around a `for`, the shape of kalman's `f_init`), L3 (a running total bounded by `array.size(array.from(...))`) | no: it exercises the four together | `h3-alma-v4-rddt-1d-2026-10-02` MATCH (probe `h3-alma-v4.pine`) adds `fn-multi`, `fn-single`, `for` without arrays. `vw-clock-close-tfchange-spy-1d-2026-09-28` MATCH (probe `vw-clock-close-tfchange.pine`) is isolating for `fn-single` alone. `typed-array` has evidence only in `vw-h4-loops` (3 captures with kalman's). Rails: `loops.test.js` (18), `c18WhileAndLastBar.test.js` (25), `arrays.test.js` (22), `functionBodyBlockValue.test.js` (9), `functionGlobalReads.test.js` (11), `callForEffect.test.js` (15), `vendorHarness.h4Loops.test.js` (14), all green. Stale text: that last file's header says no TradingView capture of a loop script exists; the two `vw-h4-loops` captures (2026-10-03) postdate it |
| `if-block` | as for parabolic-sar | only parabolic-sar's | as for parabolic-sar |

What the registry would need is the same question for both. The first script that needs a row is also that row's only isolating capture (`if-block`), and four of kalman's six rows have joint, not isolating, evidence. R1 says "names evidence"; it does not say "isolating". Whether joint evidence suffices is the reviewer's call. Nothing in this packet adds a row.

Neither script is in the stage-1 allowlist below, because R1 withholds both until those rows exist.

## 10. What this packet does not establish

1. **P11, a full-suite run on a whole install: run, classified, 0 branch-caused.** The six-shard gate (`round2/gate-summary.md`, tree `93efdb607f`) failed 25 of 4,112 test files (33 tests). Round 3 re-ran each of the 25 files alone (`vitest run <file> --maxWorkers=2`) on three trees: this branch (`1a8dddb408`), `origin/master` (`03a42b201a`) and the branch's merge-base with master (`0afa7645dd`) (`round3/p11-rerun-results.txt`; script `round3/round3-job-desktop.sh`). Classification:
   - **Pre-existing on master, 17 files** (fail alone on the branch, on master and on the merge-base): `StockChart.firstVisitFraming`, `StockChart.focusWarmStep`, `provenance/freshnessAge`, `provenance/panelAdoption.ratchet`, `screener/reachable`, `hooks/pollingSites.rail` (the known baseline file), `symbolLinkChannels`, `handRolledFormatters.census`, `swallowedFetch.census`, `noRegexLookbehind`, `offlineNeverStoresComputed`, `iteratorGlobalFloor`, `offline/doorEnumeration`, `rawErrorSurface`, `terminalReachableContrast`, `themeColours.rail`, `surfaces/manifest`. These are census and ratchet rails that are red on master itself (for example `surfaces/manifest`: "routes with no manifest row: /admin/rare-preview").
   - **Pass alone on the branch, 8 files** (so flaky or load-sensitive in the sharded run, or master-side): `targetScriptReport.measure`, `presentationSingleFormatter`, `TradeExchangeNewsWidget.saved` (pass on all three trees alone); `guardProbe.measure`, `objectLaneCensus.measure`, `objectLaneDrawerCensus.measure` (pass on the branch, fail on master and the merge-base: instrument-sensitive, not ours); `objectLaneCallSites.measure` (fails on the merge-base only); `ChartPlanPanel.asOfDay` (fails on master only).
   - **Branch-caused: 0.** No file passes on master or the merge-base and fails on the branch alone.
   - Caveat: the desktop's recorded vitest baseline is 1 failed file (`pollingSites.rail`); the 16 other pre-existing files fail identically on master and the merge-base on this desktop, so they are not caused by this branch whichever baseline is right. The merge-base check was required because the branch is about 100 commits behind master. Whether the owner waives the remainder, or re-runs the shard gate on a quiet machine, is the owner's call.
2. **The x4 profile is not a device.** Chromium cannot throttle a worker (`Emulation.setCPUThrottlingRate` on a worker target: "only supported for pages"), so the low-end profile runs the same bundle's handler on a throttled page. The probe's own control reads the ratio actually reached (section 5.1).
3. **Railway and production were not read or touched.** Section 7 quotes the repo ledger, which cannot see Railway.
4. **The harness lane diff is an upper bound, not a gate.** The runtime-on lane grades with every script allowed, so the server's allowlist is not applied (`vendorHarness.corpus.test.js`, the lanes comment); the with-allowlist measurement is the parity rail, for the served set only. The diff was first taken on the branch base `6272ed7fa3`; it was re-run in round 3 on the production-merged tree (section 3.3). The earlier closure argument (`closure-report.txt`) is kept as history.
5. **How often a member's pasted copy equals a corpus script byte for byte is not measured** (`docs/pine/runtime-pane-switch-on-plan.md`, "Widening the allowlist"; plan 4.2 P5). Identity is the sha256 of the source as written, so a copy that differs by one byte declines `runtime:not-yet-graded`.
6. **No browser run of the member pane against production.** The smoke is the post-flip instrument (section 8).
7. **No real low-end device, no Safari or Firefox worker, no real touch device**: the probe is headless Chromium.
8. **The stage-2 and stage-3 exit gates** (allowlist of at least 25, time-budget stop rate under 2%) are not evaluated. The rate has no denominator (8.4).
9. **S1 is a point-in-time grep.** No standing rail scans the lane's sources for `eval`, `new Function` or network calls.

## 11. How every number here was taken

Heavy jobs ran one at a time under the machine-wide heavy lock (`hl`, `C:/Users/pgosz/uct-tools/heavy_lock.py`), on the owner's laptop (Windows 11), from the worktree `C:\Users\pgosz\uct-worktrees\pine-w2`. `jobs-laptop.sh` in the evidence directory holds the exact commands of the first set; `round2/round3-job.sh` is the laptop round-3 script, which was not run as written. Round 3 ran on the owner's desktop through `round3/round3-job-desktop.sh` (mappings: laptop `pine-w2` to `C:/Users/Patrick/uct-worktrees/pine-dsk-w2`; the master and merge-base trees to throwaway detached worktrees `pine-dsk-w2-mst` and `-mb`; the production-merged tree to `-mrg`; `env-laptop.sh` to `env-desktop.sh`; `hl` to `heavy_lock.py run --path .../dsk/heavy-final3.lock`; no `pydeps` path). The merge step was replaced by a throwaway merge commit that is not on the branch. No step touched flags, Railway or production. Logs were written to `C:\Users\pgosz\uct-worktrees\_resume-laptop\runs\w2\`; the evidence directory holds trimmed copies (colour codes removed).

**Which tree each number ran on.** The branch has two master merges (section 0). The first-merge tree is `6363a05d80` and the docs and test commits after it up to `5a9c104570`; the final tree is `d2235ec4b0` and the docs-only commits after it. `c78d553af2` is the commit the final job recorded at its start (`final.status`); that job had not finished when this was written.

| item | tree | log in the evidence directory |
|---|---|---|
| the allowlist rail and its three mutations | first merge | `parity-run.log`, `parity-mutations.json` |
| the same rail, with the J2 and lane rails, in one vitest run | final | `final-vitest.log` |
| the 8 J2 files, the 16 lane files | first merge | `j2-vitest.log`, `lane-rails.log` |
| the 7 pytest rails (S4 to S8, the cohort stage, R1) | final | `final-pytest-rails.log` |
| the deploy-gate pytest and the census-detector pytest | first merge, then final | `deploy-gate.log`, `pytest-condta.log`, then `final-deploy-gate.log` |
| the readiness census (J4) | first merge | `census-run.log`, `readiness.json` |
| the build (B4) and the worker probes (B1, B2, B5) | first merge | `build-summary.txt`, `probe-x4.json` |
| the harness lane diff | the branch base `6272ed7fa3`, then (3.3) final | `harness-lane-diff.json`, then the verdict files named in 3.3 |

**Gates.** The deploy-gate pytest (the five files `master-deploy-gate.yml` runs): 52 passed on the first-merge tree (`deploy-gate.log`); on the final tree the same five files plus the census-detector rail: 78 passed (`final-deploy-gate.log`). `tools/check_repo_hygiene.py` ran before every commit on this branch: the staged check (the one that governs a commit) was clean each time. The default working-tree check was clean too, except once: right after the second merge it listed 68 files that master added, as CRLF checkouts of LF blobs (`core.autocrlf`), with the staged check clean; it was clean again once the merge was committed.

Two things differ from the plan of record: the census (J4) ran twice (the first attempt failed on its own assertion and wrote nothing; `census-first-run.log`, then the fix in commit `4a884aff97`, then `census-run.log`), and the J2 rails and the lane rails were re-run on a merged tree so that their logs exist on this machine.

**What the second merge changes on the lane's path** (the carry argument for the census, the build and the probes, which were not repeated). `closure.py` (output `closure-report.txt`) lists the 205 files master changed since `67a6dada10` and asks which fall inside the runtime lane's forward import closure. In the runtime worker's closure (87 files) and the main thread's door (88 files) it finds two: `app/src/components/chart/engine/ast/callExpansions.js` (three added expansions, `bbMiddle`, `bbUpper`, `bbLower`, for the native formula language; a Pine script reaches the same trees through `pine.js`, unchanged) and `app/src/components/chart/engine/ast/closedTable.json` (reason strings only). Both enter through `parse.js`. The wider surface the member door and the harness import (593 to 603 files, through `BuilderSheet.jsx` and `ourSide.js`) holds 26 changed files: the builder, the chart, line identity (`binder.js`, `sourceRef.js`, `lineIdentity.js`, `infoValues.js`, `instanceControls.js`). An import is not an execution, and those changes concern the source references between indicator instances and the lines a saved definition keeps; but the repo's own carry-over rule asks for an import-edge check, this one finds edges, and so the rails and the harness are being re-run on the final tree rather than carried (they were queued behind the heavy lock when this was written). The census, the build and the probes were not (a re-run of the build alone is the heaviest job on this machine); the two files together grew by 3,194 bytes (`callExpansions.js` +1,761, `closedTable.json` +1,433), which is at most that much more in a 1,142,621 B bundle, against a B4 margin of about 92 KB gzip.


## 12. The evidence directory

`docs/pine/evidence/w2-arming-2026-11-02/`:

| file | what it is |
|---|---|
| `build-summary.txt` | J5: the vite build's worker chunk, raw and gzip -9 bytes (B4) |
| `candidates.py` | the tool that writes `stage1-candidates.json` |
| `census-first-run.log` | J4, first attempt: failed on its own assertion and wrote nothing (the proof the old assertion can fail) |
| `census-run.log` | J4, second attempt after the instrument fix: passed |
| `closure-report.txt` | its output for the second merge: 205 files changed, 2 inside the lane closure, 26 inside the wide test and builder surface (section 11) |
| `closure.py` | which of the files master changed sit on the runtime lane import path (stdlib; git and the tree only) |
| `deploy-gate.log` | the five deploy-gate pytest files, 52 passed |
| `final-deploy-gate.log` | the final-tree run of the 5 deploy-gate files and the census-detector rail, one line per test |
| `final-pytest-rails.log` | the final-tree run of the 7 pytest rails (S4 to S8, the cohort stage, R1), one line per test |
| `final-vitest.log` | the final-tree vitest run: 25 files (the parity rail, the 8 J2 files, the 16 lane files) |
| `final.status` | the final job progress lines: the tree it started on, free RAM, the exit code of each command |
| `harness-lane-diff.json` | the vendor harness run twice on `6272ed7fa3` (production lane, runtime-on lane); 336 captures; 22 changes (section 3) |
| `j2-vitest.log` | J2: 8 files, 93 tests |
| `jobs-laptop.sh` | the laptop version: the exact commands behind this directory (section 11) |
| `jobs.sh` | the earlier session's job list, desktop paths, kept as written |
| `lane-rails.log` | 16 vitest files the owner items cite, 333 tests |
| `parity-mutations.json` | J1b: the three mutations, all killed, with the failing rails by name |
| `parity-run.log` | J1: the allowlist re-grade rail, Test Files 1 passed, Tests 4 passed |
| `probe-run.log` | the probe's console output, desktop run |
| `probe-x4-run.log` | the probe console output, both phases (desktop, then the throttled page) |
| `probe-x4.json` | J6: the worker probe, one invocation with --cpu-throttle 4: the desktop phase first (B1, B2, B5 on the desktop), then the throttled page (the low-end stand-in) |
| `pytest-condta.log` | the census-detector rail (`conditional-ta`) |
| `readiness.json` | J4 output: 22 runtime-only scripts at four lengths (section 4) |
| `s1-grep.sh` | the S1 point-in-time search (section 2, S1 detail); a grep, not a standing rail |
| `s1-grep.txt` | its output, the first line names the tree |
| `smoke-self-check.log` | `tools/runtime_pane_smoke.py --self-check` on this tree |
| `stage1-candidates.json` | `candidates.py` output: every script with a runtime-lane MATCH, its census capabilities, the real R1 verdict, the capability matrix, and the readiness and probe numbers joined |
