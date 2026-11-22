# W5-INT: service integration (evidence)

Lane W5-INT, desktop, opened under owner delegation. Branch `feat/pine-w5-int-service`.
It closes the cross-lane gaps that the independent reviews W5-T6, T7, T7b, T8, T9 and T10 found
where the W5 service lanes meet.

- **Code tip:** `c61ac94bd1`. Everything after it is docs-only (this file).
- **Base:** `d8a0ff1033`, the final merge commit. It was built as follows:
  - start from `origin/feat/pine-w5-t7b-result-integrity` at `e13d282eae` (T1 -> T6 -> T7 + T3 -> T4 r0 -> T7b);
  - `merge --no-ff origin/feat/pine-w5-t8-cache` at `51e62a3c22`, which gave `4453859413` (clean);
  - `merge --no-ff origin/feat/pine-w5-t9-canary` at `c169b1ce16`, which gave `c06c424c18`
    (one conflict, `server.mjs` run() tail, resolved per W5-T9.md; see below);
  - `merge --no-ff origin/feat/pine-w5-t10-image` at `a1523b3897`, which gave `d8a0ff1033` (clean).
- **Tested-on-master:** `5d95103c8a` (`git merge-base HEAD origin/master`).
- **Engine bump:** NO. No translator or VM output changed. `serverEntry.js` re-exports two more T3
  codec functions, which moves only the bundle's own sha. HP-1 uses the artifact-neutral sha.
  `SCRIPT_ENGINE_VERSION` is untouched.
- **Member reach:** none. This adds no flag, sets up no Railway service and adds no web caller.
- **No licence-held text.**

## Merge resolution (T9 into T7b)
`services/pine_runtime/server.mjs` run() tail: keep T7b's `sealRunResults`; call
`metrics.answered(checked.request.profile, sealed.results)`; send `sealed.results`; keep T9's
counting `refuse` wrapper. `wellFormedResults` is absent (T7b deleted it).

Found at the merge and fixed in the W5-INT commit: T9's `metrics.test.mjs` runner fixture predated
the seal. Its results had no `warmup` and no refusal `sentence`. On the merged base every run in
that file was therefore a 500, so the rail "a signed GET answers 200 ..." was RED on the base. The
fixture now uses the sealed schema.

## Items 1-9

| # | Item | Done | Change (file) | Rail(s) |
|---|---|---|---|---|
| 1 | T8 caches wired into the run path | yes | `cache.mjs` `createResultLane`, `cacheKeyOf`; `server.mjs` (both caches ON by default); `protocol.mjs` `parseRunRequest(body, door, docs)` | `test/cachewire.test.mjs` (8 rails) |
| 1a | Cached objects are never shared | yes | A hit is `structuredClone(stored)` with THIS request's `job` and `cache:'hit'`, and carries no `ms`. A store is a deep copy minus `ms`/`cache`. `doc:null` gets `structuredClone(held)`. | "no shared objects...", "doc: null ... fresh copy" |
| 1b | Never cache a wall-clock stop or `runtime:server-*` | yes | T8's `cacheable()` (unchanged), applied only after the seal accepted the whole reply | "never stored: ...", "a reply the seal refuses stores nothing" |
| 1c | The 1,000 ms budget is explicit | yes | `job.mjs` `budgetOf(rt)`. The worker REFUSES to boot on a bundle without a positive finite `RUNTIME_PANE_TIME_BUDGET_MS` (`sandbox.mjs`, one guard at boot; a module namespace cannot change after import). The call site still passes `rt.RUNTIME_PANE_TIME_BUDGET_MS`, which HP-7 reads by name. | pool "boot: a bundle with no explicit wall budget...", job "the wall budget is explicit", job "a wall-clock stop on the REAL bundle is runtime:time-budget ... never cacheable" (real bundle, injected run clock) |
| 1d | Never cache on the canary's all-zero hashes | yes | `cacheKeyOf` returns null for a `0`x64 `doc_sha256` or `bars.sha256`, so nothing is read or written for such a job. The canary also calls `pool.run` directly, below the lane. | "the canary all-zero hashes are never a key" |
| 2 | Closed result schema widened for `cache` | yes | `protocol.mjs` `RUNNER_RESULT_FIELDS.*.optional = ['ms','cache']`, `CACHE_STATES = ['hit','miss']`. Any other value is refused. `instructions` is NOT admitted, because T9 metrics do not need it (it stays an unknown-key refusal). | seal "W5-INT: the closed schema admits cache ...", "the schema stays CLOSED" (updated) |
| 3 | Image copies the canary's inputs; named allowlist; watchPatterns | yes | Dockerfile COPYs `cache.mjs`, `canary.mjs`, `metrics.mjs`, `tools/pine_runtime_host_parity.mjs`, `runtime/columnDigest.js`, the `hostParity` fixture dir, and `app/package.json` (`"type":"module"`; without it Node 20 reads `columnDigest.js` as CommonJS). `railway.json` watches the tool. | `test_pine_runtime_dockerfile.py`: `IMAGE_EXTRA_COPIES` named allowlist; `test_the_image_file_set_loads_the_server_and_the_canary_inputs` (stages the image's file set, imports server.mjs and runs `loadCanaryInputs()` under `--no-experimental-detect-module` = Node 20 rules); control `test_the_staged_boot_can_fail_without_a_named_input` |
| 4 | SECRETS: no web VITE_* value in the service bundle | yes | `build-pine-runtime.mjs` `SERVER_BUNDLE_VITE_NAMES` = `VITE_PINE_LOWER_TF_ENABLED`, `VITE_PINE_RUNTIME_PANE_ENABLED` (the only names the closure reads). `defineOf()` = those plus vite's 4 mode constants. Dockerfile ARG/ENV narrowed to exactly these. `ENV_ALLOWLIST` admits them. Runbook `docs/runbooks/pine-runtime-service-build-args.md`. | vitest `serverBundle.rail.test.js`: "bakes no VITE_* off its allowlist..." (builds with web's secret names set to a marker, then greps) and "the allowlist is exactly the VITE_* names the bundle reads". pytest: ARG set == allowlist (read through node) and within web's; no secret-shaped ARG/ENV; `ENV_ALLOWLIST` VITE_ names == allowlist |
| 5 | Sandbox: `process.getBuiltinModule` | yes | Added to `REMOVED_PROCESS` | `sandbox.test.mjs` L3 probe: named assertion that the host has it and the job does not |
| 6 | One column encoder | yes | `job.mjs` `encodeColumn(rt, col, n)` = `rt.encodeColumn` + `rt.bytesToB64` (T3, exported by `serverEntry.js`). The own copy is deleted. | job "one authority: ... byte-identical to the encoding it replaced" (the old encoder kept IN THE TEST as reference; NaN payloads, -0, +-Inf, subnormals, 9,000 rows over a b64 chunk; refusals agree) |
| 7 | HP-7: one value, one authority | yes | The tool's `ADAPTER_FILES` = worker + node only; its budgetMs exemption is for its measurement host only. job.mjs's one HP-7 rail is `services/pine_runtime/test/adapter.test.mjs` (budgetMs = the worker's), now RUN BY THE GATE pytest. | `test_pine_runtime_engine_identity.py::test_hp7_the_service_adapter_has_one_rail_and_the_gate_runs_it`; hostParity.rail asserts `ADAPTER_FILES` keys |
| 8 | T7b e2e bar times | yes | `_bars()` stamps `indicator_compute.bar_open_instant(date,'D')`: unix SECONDS of 09:30 New York | `test_the_fixture_bars_follow_the_one_daily_time_rule` (both EST and EDT offsets) |
| 9 | Pool respawn | yes | After start, a replacement whose boot fails is retried after `respawnBaseMs` (1 s), doubling to `respawnMaxMs` (60 s). `ready()` is FALSE from the first failure until a replacement loads, even with another live worker, so `/ready` answers 503 (main's readiness already reads `pool.ready()`). A first-boot failure still refuses the pool. | pool "respawn: a replacement that fails to boot makes the pool NOT ready, is retried with backoff, and recovers" (2 workers) |

`/v1/metrics` `cache` is now the lane's own counts (hits, misses, stored, entries, bytes) and stays
null without a result cache.

## Secrets check
On the base, a build with `VITE_CHART_RENDER_TOKEN=SECRETMARKER123` put the marker into
`pine-runtime.mjs`, and the manifest listed `VITE_CHART_RENDER_TOKEN`. On the tip the same build
carries no marker, and the only VITE_ names in the bundle are the two allowlisted flags. Both rails
are red on the base (below).

## Red on the base, green on the tip
The tip's rail files were run over the base's code: a `git archive d8a0ff1033` of the service, app
and tool, with the shared `node_modules` junctioned. The tree was removed afterwards. Logs:
`runs/w5int/redbase-node.log`, `redbase-vitest.log`.
- node: 31 tests, 7 failed. Failing at file level on missing tip exports: `cachewire.test.mjs`,
  `job.test.mjs`, `seal.test.mjs`. Failing as tests:
  - L3 getBuiltinModule;
  - the metrics GET (the T9 fixture vs the T7b seal);
  - boot with no explicit wall budget;
  - respawn.
- vitest `serverBundle.rail.test.js`: 5 failed. Four are ours: the secret marker, the allowlist,
  the export list, and the VITE value list. The fifth, "runs a Pine document ... under bare node",
  is an archive artifact (the partial archive holds no `tests/fixtures`). It passes on the tip.
- pytest rails: proven by the mutation rows `img:*`, `env:*`, `railway:*`, `hp7:*` and `e2e:*`,
  each of which restores a base state.

## Mutations: 41/41 killed, 3/3 controls survived, tree clean after
Harness: `$S/mutate.py` unchanged. node:test goes through T8's `mutate_node.py`; pytest goes
through `runs/w5int/mutate_py.py` (the same wrapper pattern). Lock `dsk/heavy-mut.lock`, 5.5 min.
Logs: `runs/w5int/mut-node.log`, `mut-vitest.log`, `mut-py.log`, `mut-job.out`.

| mutation | killed by |
|---|---|
| cache:lane-off-by-default | cachewire "on by default...", "only the misses..." |
| cache:hit-shares-stored | cachewire "no shared objects..." |
| cache:store-shares-runner | cachewire "no shared objects..." |
| cache:job-id-not-overwritten | cachewire "on by default..." (seal refuses) |
| cache:canary-zero-hash-keyed | cachewire "the canary all-zero hashes..." |
| cache:store-before-seal | cachewire "a reply the seal refuses stores nothing" |
| cache:time-budget-cacheable | cachewire "never stored...", job "a wall-clock stop on the REAL bundle..." |
| cache:full-request-to-runner | cachewire "only the misses..." |
| doc:no-clone-on-read | cachewire "doc: null ... fresh copy" |
| doc:never-put | cachewire "doc: null ... fresh copy" |
| seal:cache-any-value | seal "W5-INT: the closed schema admits cache..." |
| seal:instructions-admitted | seal "the schema stays CLOSED...", "W5-INT: ..." |
| metrics:cache-null | metrics "a signed GET answers 200..." |
| sb:getBuiltinModule-kept | sandbox "L3: inside a job..." |
| job:budget-boot-check-off | pool "boot: a bundle with no explicit wall budget..." |
| job:budgetOf-accepts-zero | job "the wall budget is explicit..." |
| job:budget-dropped-at-call | job "runJob calls the run ONCE...", "a wall-clock stop on the REAL bundle..." |
| job:own-encoder | job "encodeColumn: canonical NaN...", "one authority: ... byte-identical..." |
| job:length-unchecked | job "encodeColumn...", "never partial..." |
| pool:post-start-failure-breaks | pool "respawn..." |
| pool:ready-ignores-failing | pool "respawn..." |
| pool:no-retry | pool "respawn..." |
| secrets:bake-every-vite | serverBundle "bakes import.meta.env once...", "bakes no VITE_* off its allowlist..." |
| secrets:allowlist-stale-entry | serverBundle "the allowlist is exactly the VITE_* names..." |
| secrets:define-extra-key | serverBundle "bakes no VITE_* off its allowlist..." |
| entry:no-encoder-export | serverBundle "exports the entry surface..." |
| img:no-canary-copy / no-cache-copy / no-package-json / no-fixtures / no-tool (5) | dockerfile `test_every_service_module_is_copied_individually`, `test_the_image_file_set_loads_...` |
| img:unlisted-extra-copy | dockerfile `test_every_service_module_is_copied_individually` |
| img:secret-arg | dockerfile `test_vite_arg_set_is_the_bundles_allowlist...`, `test_no_secret_build_arg...` |
| img:arg-missing | dockerfile `test_vite_arg_set_is_the_bundles_allowlist...`, env block |
| env:vite-allowlist-drift | dockerfile `test_env_allowlist_admits_exactly_the_bundles_build_args` |
| railway:no-tool-watch | dockerfile `test_railway_json_points_at_the_image_and_watches_the_closure` |
| hp7:tool-reads-job | engine_identity `test_hp7_the_adapters_build_the_same_call`, `test_hp7_the_service_adapter_has_one_rail...` |
| hp7:service-budget-drift | engine_identity `test_hp7_the_service_adapter_has_one_rail_and_the_gate_runs_it` |
| e2e:bars-in-ms, e2e:utc-midnight | e2e `test_the_fixture_bars_follow_the_one_daily_time_rule` |

No equivalent survivors.

## Checks on the code tip c61ac94bd1 (tested-on-master 5d95103c8a)
One job, lock `dsk/heavy-final3.lock` (53.4 min, `runs/w5int/final-job.out`), local Node v24.13.1.
| check | command | totals |
|---|---|---|
| service node rails | `node --test services/pine_runtime/test/*.test.mjs` | 125 tests, 125 pass, 0 fail (`final-node.log`) |
| HP-1 on the integrated bundle | `node tools/pine_runtime_host_parity.mjs --host node --check` (fresh bundle) | `HP-1 GREEN: 166/166 cases equal the committed digests` (`hp1.log`) |
| T7b e2e (T11 decoder, read-only) | in the rails pytest below, `PINE_RUNTIME_T11_CLIENT=runs/w5int/t11/pine_runtime_client.py` | 6/6 pass (5 T7b + the new time-rule rail) |
| final-tip gate pytest | `bash $S/final-tip.sh pine-dsk-w5int dsk-w5int-final <10 pytest files>` | 46 passed |
| hygiene | `python tools/check_repo_hygiene.py` | clean (34793 files) |
| rails pytest | the 8 `tests/test_pine_runtime_*.py` + `test_script_engine_version_gate.py` + `test_dockerfile_vite_build_args.py` | 372 passed |
| full chart+hooks vitest | final-tip | Test Files 1 failed / 1336 passed / 27 skipped; Tests 1 failed / 22538 passed / 118 skipped. The one failure is `src/hooks/pollingSites.rail.test.js`, the known baseline. |
No app/dist or dist-server left behind.

## Open notes (out of scope, recorded)
1. **Replay record is per process.** A replay to another replica, or after a restart, inside 60 s
   is admitted (W5-T6 note 2). It needs a shared store, or replica count 1, before T20 scales out.
2. **16 MiB pre-HMAC buffer** (W5-T6 note 1). A smaller pre-auth cap is NOT trivial. The HMAC is
   over the whole body, and a legitimate 500-job request can approach 16 MiB, so any cap below the
   body cap refuses real requests. The proper fix is to stream the sha256 while reading and verify
   before parsing; buffering stays bounded by the same cap. Proposal for T20: keep 16 MiB, add a
   per-source concurrent-unauthenticated-body limit (for example 2 in flight). Not built.
3. **`availableParallelism()` vs the cgroup** (W5-T7 note 2). Node 20 ignores a CPU quota.
   `main()` should take an explicit worker count from the service config at T20. Not built.
4. **Design 3.3 vs drawings.** T8's `cacheable()` refuses ANY `runtime:server-*` guard, including
   the deterministic per-output `runtime:server-drawings` and `runtime:server-output-absent`. A
   script that draws, or a job asking for an absent output, is therefore never cached. That fails
   closed (lower hit rate only). Narrowing it is a design-3.3 decision for the coordinator.
5. `instructions` (design 3.2) stays off the wire until a run counts it.
6. The T11 client was used READ-ONLY from `git show 1e384edbfe:api/services/pine_runtime_client.py`
   (sha256 `14ec35e641778e60...`), via `PINE_RUNTIME_T11_CLIENT`. That tip names `warmup` and
   `cache`, so the e2e passes unmodified replies. No T11 file was edited.
7. Image still never built (no Docker here): libstdc++6, L4 under `--experimental-permission` on
   Linux, and Railway-injected variables are unproven (W5-T10 note 3, unchanged).

## Logs (desktop)
`C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/w5int/` (mut-job.out, mut-*.log,
redbase-*.log, final-job.out, final-node.log, hp1.log, t1..t5.log, py1.log) and
`runs/dsk-w5int-final/` (final-tip).
