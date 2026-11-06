# W5-T9 observability + canary + smoke: evidence

Lane: W5-T9 (docs/pine/SERVER-RUNTIME-DESIGN.md section 7 "T9 Observability + canary + smoke", 3.8, and the
first capacity numbers of sections 6 and 9.1), desktop machine. Branch `feat/pine-w5-t9-canary`.
**Base (merge commit, recorded): `f526d609e4`** = origin/feat/pine-w5-t7-pool `5e6c63e24e` (T1 -> T6 -> T7) merged
`--no-ff` with origin/feat/pine-w5-t4-host-parity `eb922686fe` (T1 + T3 + T4). Clean merge, no conflict.
Code tip checked (final-tip ran on it): `becd0756be`. Tested on master `5d95103c8a` (merge-base with origin/master;
origin/master is now `e063a91589`, so this lane is not rebased on it). Local only: no Railway, no flags, no production,
no secrets (HMAC keys are drawn from the OS RNG per run). The T4 r1 builder is changing HP-3: this lane does not touch
T4's files and gates only on the digests T4 commits for Node (HP-1), which it reads, never writes.

Engine bump: **NO**. No engine code changed; SCRIPT_ENGINE_VERSION untouched (5). The bundle is unchanged.

## What is new
- `services/pine_runtime/canary.mjs` (T9): `CANARY_CASES` = 10 host-parity cases (8 computed, 2 withheld by name,
  all on the 1,500-bar `listing` set). `runCanary` sends each through the **service's own pool** (profile `sweep`, the
  lowest, so it never takes a worker from an alert), turns the wire answer into T4's record with T4's own `recordOf`
  (one normalisation; digest by T3's codec on the artifact-neutral identity) and compares status, digest and guards with
  `expected-digests.json`. `createCanary` holds the state: `ok()` is true only after a green run, a red run clears it,
  an **inconclusive** run (pool busy, wall-clock stop; design H5) can neither turn it red nor green. Logs
  `[pine-runtime] CANARY DIVERGED case=<name> field=<f>`. Timer 15 min, unref-ed, runs never overlap. A moved engine
  identity with unregenerated digests is red as `engine-identity`.
- `services/pine_runtime/metrics.mjs` (T9) + `GET /v1/metrics`: jobs by profile and status, refusals by guard (job
  refusals and every door refusal), p50/p95 ms per profile (window 1000, nearest rank), queue depth, worker
  starts/recycles/kills/ooms/crashes, heap, boot block, engine identity, canary status. **`instructions` and `cache`
  are `null`, never 0**: the wire result carries no instruction count (job.mjs is T7's) and T8 is not built.
  Heap is the supervisor's; a worker's heap is capped by resourceLimits and not read.
- `services/pine_runtime/server.mjs` (T6's file; **minimum wiring, named**): two imports; `refuse` renamed
  `refuseResponse` with a local `refuse` wrapper in `createPineRuntimeServer` that counts the guard; the options
  `metrics`, `poolStats`, `canaryStatus`, `boot`; `metrics.answered(...)` after a well-formed answer; the `metricsRoute`
  (signature + clock + replay, over the empty body, same key; GET only); in `main`: the canary (default ON exactly when
  `pool === SERVICE_POOL_OPTIONS`, i.e. the real boot, so T7's wiring rail text is unchanged), readiness
  `pool.ready() && canary.ok()` (T7 left that hook to T9), started after listening so `/health` answers while the
  canary runs and `/ready` is 503 until green.
- `tools/pine_runtime_service_smoke.py` (+ `tests/fixtures/pine_runtime/service_smoke.json`): the four checks of 3.8,
  exit 0/1/2. The committed digest is of `adx-and-di-for-v4` (document read from the existing documents fixture, not
  copied) over a fixed integer-LCG 1,500-bar D series, digested by the Python codec. `--record` rewrites it at an engine
  bump. FAILED beats INCONCLUSIVE. INCONCLUSIVE (never a rollback trigger): no URL/secret, service unreachable from this
  machine, this runner's signed request refused 401 (a stale key proves nothing about the service; one retry with a new
  timestamp first, because a same-second repeat is a replay), 429 busy, canary undecided, web's engine unreadable, or the
  committed digest recorded for another engine.
- `tools/pine_runtime_capacity.mjs`: the local capacity driver (below).

## Decisions a reviewer should check
1. The canary uses T4's tool module as a library (import from `tools/`). **T10: the image must ship
   `tools/pine_runtime_host_parity.mjs`, `runtime/columnDigest.js` and the `__fixtures__/hostParity/` directory**, or the
   service will not boot with the canary. (One authority beats a copy; the alternative was a second corpus loader.)
2. The canary cases use the `listing` bar set only; the 5,000-bar and 32,768-bar sets stay with the CI rail.
3. Smoke 401 on a SIGNED call is INCONCLUSIVE, not FAILED (see above). The unsigned-401 check is the auth check.
4. `/v1/metrics` takes no query and returns no owner, doc id, symbol or source (a rail asserts the strings are absent).

## Rails red on base, green on tip
Base `f526d609e4` in a scratch worktree of my own (removed afterwards), new tests copied in:
- `services/pine_runtime/test/canary.test.mjs` + `metrics.test.mjs`: tests 2, pass 0, fail 2: `ERR_MODULE_NOT_FOUND` for
  `canary.mjs` and `metrics.mjs`.
- `tests/test_pine_runtime_service_smoke.py`: collection error, `cannot import name 'pine_runtime_service_smoke' from 'tools'`.

Tip: `node --test ... services/pine_runtime/test/*.test.mjs` = tests 86, pass 86, fail 0 (T6+T7's 72 plus 14 new);
`pytest tests/test_pine_runtime_service_smoke.py` = 23 passed.

Named rails. Canary: case list; GREEN real bundle; **RED perturbed bundle** (T4's `perturb`: one VM `+` through
`Math.fround`; red on `methods_udt@listing`, field `digest`, logs the line); wrong guard / thrown runner red; engine
identity moved red; inconclusive never a verdict; timer; service `/ready` 503 until green then 200; service on the
perturbed bundle `/ready` stays 503 and `/health` 200. Metrics: percentile, window, signed GET with every 3.8 field,
401 matrix (unsigned, wrong key, stale clock, body-bound, replay), GET only and no leakage. Smoke: exit 0; exit 1 x8
fixtures (engine differs, canary diverged, ready but pool down, wrong digest, withheld, 500, unsigned accepted,
health down); exit 2 x6 (unreachable, key refused, busy, canary undecided, stale fixture, web engine unreadable) plus no
URL / no secret; failed-beats-inconclusive; replay retry; signature; series determinism; committed fixture whole and
equal to this tree's engine; the Python bars hash equals protocol.mjs's `barsSha256` (node subprocess); the document is
not copied into the tool.

Real-service demonstrations (local, scratch launchers, all stopped): smoke against the real service on the real
bundle = exit 0 (`engine 5/1/1`, canary green 1 run, digest `ec3480b56c3e`, unsigned 401); against the **perturbed**
bundle = exit 1 (`canary: DIVERGED on methods_udt@listing; /ready is 503`, `run: HTTP 503 runtime:server-unavailable`).

## Mutation table (41 mutations, 41 KILLED, 0 survivors)
Script `mutate_w5t9.py` + `mutations.json` (this directory); lane `dsk/heavy-mut.lock`, label `w5t9-mut`; log
`_resume-2026-11-01/runs/w5t9-mut/mut.out`. Each mutation applied, run, restored byte-exact (asserted); `git status`
clean after. Killer = first failing test.

| mutation | killed by |
|---|---|
| C1 digest compare removed | RED perturbed bundle; wrong guard/throw |
| C2 inconclusive guards emptied | inconclusive is never a verdict |
| C3 engine identity check removed | engine identity moved red |
| C4 red does not clear ok | RED perturbed bundle |
| C5 never-decided counts as ready | inconclusive is never a verdict |
| C6 canary on profile alert | case list; timer |
| C7 running canary not joined | timer |
| C8 nine cases | case list; GREEN |
| C9 divergence not logged | RED perturbed bundle; service perturbed |
| C10 thrown runner not red | wrong guard / throws |
| C11 status not compared | wrong guard / throws |
| C12 interval 5 min | case list; timer |
| C13 timer not unref-ed | timer |
| S1 readiness ignores canary | service on perturbed bundle |
| S2 metrics signature not verified | 401 matrix |
| S3 metrics replay admitted | 401 matrix |
| S4 metrics clock not checked | 401 matrix (also crashes the route) |
| S5 door refusals not counted | signed GET counts |
| S6 answered jobs not counted | signed GET counts |
| S7 metrics accepts POST | GET only |
| S8 canary not run at boot | service /ready 200 (times out); perturbed |
| M1 percentile floors | signed GET counts |
| M2 instructions reported 0 | signed GET counts |
| M3 latency window unbounded | window |
| M4 withheld counted ok | signed GET counts |
| M5 job refusals not counted | signed GET counts |
| M6 cache reported 0 | signed GET counts |
| P1 engine check removed | exit_1[engine differs] |
| P2 canary red not failed | exit_1[canary diverged] |
| P3 digest compare removed | exit_1[wrong digest] |
| P4 unsigned 200 accepted | exit_1[unsigned accepted] |
| P5 stale fixture not inconclusive | exit_2[fixture for another engine] |
| P6 failed does not beat inconclusive | failed_beats_inconclusive |
| P7 unreachable is a failure | exit_2[unreachable] |
| P8 replay retry removed | replayed signature retried |
| P9 busy is a failure | exit_2[busy] |
| P10 withheld not failed | exit_1[withheld] |
| P11 canary undecided is a pass | exit_2[canary undecided] |
| P12 signature binds no body | signature test |
| P13 series drifts | committed fixture whole (bars hash) |
| P14 no key is a pass | no URL / no secret |

No equivalent survivor.

## Capacity numbers: LOCAL MEASUREMENTS (not Railway, not a container)
Tool `tools/pine_runtime_capacity.mjs`; JSON in `capacity/`; lane `dsk/heavy-final2.lock` (labels `w5t9-cap-trial`,
`w5t9-capacity`, `w5t9-capacity-stride2`); logs `_resume-2026-11-01/runs/w5t9-cap/`. No Docker here, so the "container
capped at 2 vCPU" is the real service (real `main`, real pool, parity canary on) as a separate node v24.13.1 process
**pinned by Windows processor affinity** to N logical CPUs, workers = N, driven over localhost HTTP by a second process.
Differences from the deployed container: no memory cap; affinity pins while a cgroup quota meters; no L4 permission
flags; localhost, not Railway's private network; this desktop's CPU (24 logical). `stride 1` = adjacent logical CPUs,
which are usually **hyperthread siblings** of one core; `stride 2` = one logical CPU per core. A Railway vCPU is itself
usually a hyperthread, so both are shown. Series: distinct seeded 5,000-bar D series (the design's yardstick), 200 per
document, chunks of 20 jobs, profile `sweep`, two requests in flight. CPU = the service process's user+system over all
threads (HTTP, JSON, base64, HMAC and sha256 included).

Per symbol, ms (wall at the pinned workers / service CPU), documents in order adx-and-di-for-v4, ema_macd, bollinger, rsi_stoch:

| pin | wall ms/symbol | service CPU ms/symbol |
|---|---|---|
| 1 cpu | 24.1 / 11.4 / 22.8 / 17.9 | 22.7 / 10.9 / 22.0 / 16.3 |
| 2 cpu stride 2 (run 1) | 16.3 / 7.4 / 20.2 / 9.2 | 26.6 / 12.5 / 35.6 / 16.3 |
| 2 cpu stride 2 (run 2) | 13.6 / 5.4 / 18.7 / 7.9 | 24.6 / 9.5 / 33.2 / 13.2 |
| 2 cpu stride 1 (run 1) | 18.9 / 8.4 / 22.6 / 11.3 | 34.9 / 15.1 / 41.9 / 20.8 |
| 2 cpu stride 1 (run 2) | 22.2 / 8.6 / 26.2 / 13.8 | 37.6 / 15.5 / 45.9 / 22.0 |
| 4 cpu stride 2 | 9.9 / 4.3 / 10.3 / 5.5 | 33.1 / 12.7 / 34.3 / 17.2 |
| 4 cpu stride 1 | 13.2 / 6.6 / 11.7 / 6.6 | 47.7 / 22.0 / 43.5 / 22.4 |

All 200 symbols of every document computed (0 withheld, 0 bad requests). Worker `ms` p50/p95 per job at 2 cpu stride 2:
adx 19-23 / 36-47; ema_macd 5-6 / 11-18; bollinger 26-29 / 59-62; rsi_stoch 10-11 / 25-27. Resident set 230-600 MB
(1 to 4 workers); supervisor heap about 27 MB.

Request overhead (sequential signed requests, RTT minus the job's own `ms`, localhost): a 50-bar job 1.1-1.4 ms p50
(2-3.6 p95); a 5,000-bar job 4.2-4.5 ms p50 (5.5-12 p95; RTT 10 ms p50 against a 6 ms job).

What it means (all local, read as ratios):
- The design estimated about 50 ms and 3 CPU-minutes per document over 3,742 symbols. Measured: **about 11-23 ms CPU
  per symbol on one unshared CPU = 0.7-1.4 CPU-minutes per document**, 2-4x under the estimate. On 2 pinned CPUs the
  service CPU per symbol rises to 9-46 ms (siblings and thread contention make the same work cost more CPU time), so the
  safe planning figure is **2.9 CPU-minutes per document at the worst (bollinger, stride 1)**, about the design's 3.
- Wall for one document over 3,742 symbols at 2 pinned CPUs: **0.3-1.6 minutes** (stride 2: 0.3-1.3; stride 1: 0.5-1.6).
  The Q2 cap of 25 documents is then about **8-40 minutes of wall time on 2 vCPU**, inside the design's 38-minute
  figure at the low end and well before 08:00 ET at the high end. Two CPUs roughly double throughput over one only when
  they sit on different cores; on sibling threads the gain is 1.1-1.3x.
- **Transfer does not dominate** (the design's reopen condition): request handling is about 4.5 ms of a 10 ms request
  for a 5,000-bar job, against 6-35 ms of compute, so the sweep stays a service job. 20-job chunks of 5,000 bars are
  about 6.4 MB bodies against the 16 MiB cap.
- This does not settle the per-member quota (still the design's 3 documents per member).
- Not measured: instructions per job (not on the wire), cache hit rate (T8), worker memory under the 256 MB cap with
  real universe bars, 32,768-bar intraday jobs, a real Railway vCPU. Do these on the first deployed service.

## final-tip (lane `dsk/heavy-final2.lock`, label `w5t9-final`, 52.5 min), on code tip `becd0756be`
Command `bash $S/final-tip.sh pine-dsk-w5t9 dsk-w5t9-final tests/test_script_engine_version_gate.py tests/test_pine_runtime_service_smoke.py`;
logs `_resume-2026-11-01/runs/dsk-w5t9-final/`.
- gate pytest: 46 passed. Hygiene: clean (34770 files). `test_script_engine_version_gate.py` + the smoke rails: 29 passed.
- full chart+hooks vitest: Test Files 1 failed | 1336 passed | 27 skipped; Tests 1 failed | 22536 passed | 118 skipped.
  The only failure is `src/hooks/pollingSites.rail.test.js`, the known baseline on every master. Nothing new.
- The evidence commit that follows touches only docs (this file and `capacity/`), so the pushed tip differs from the
  tested tip by documentation only.

## Open items
- T10 must ship the three canary inputs listed in decision 1, and give the smoke runner `PINE_RUNTIME_SERVICE_SECRET`.
- T4's HP-3 change (concurrent r1 builder) is not in this tree; the canary reads only the Node digests.
- `instructions` p50/p95 need an instruction count on the wire (T7's job.mjs); `cache` waits for T8.
- At an engine bump: `--record` the smoke fixture and `--write` the host-parity digests together.
