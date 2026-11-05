VERDICT: GO-WITH-NOTES @50e13ac02a

Lane W5-INT service integration. Branch origin/feat/pine-w5-int-service, tip 50e13ac02a, code tip c61ac94bd1
(50e13ac02a over it = 5 files under docs/pine/evidence/2026-11-05-w5-int/ only; verified by diffstat).
Own diff = d8a0ff1033..50e13ac02a (2 commits, 30 files). Reviewer: independent desktop Opus, 2026-11-05, read-only, no tests run.

EVIDENCE.md is this lane's own: header "W5-INT", branch feat/pine-w5-int-service, code tip c61ac94bd1, base d8a0ff1033,
merge chain 4453859413 / c06c424c18 / d8a0ff1033 (all present in `git log`). Files it lists = files changed.

## Blocking findings
None.

## Merge resolution (T9 into T7b), c06c424c18
server.mjs run() tail at c06c424c18:178-195 keeps T7b's sealRunResults(door.codec, ...), calls
metrics.answered(profile, sealed.results), sends sealed.results and keeps T9's counting `refuse`. There is no wellFormedResults,
and the loadBundle codec (:103-107) is kept. That is exactly what W5-T9.md hazard 3 asked for. The T9 metrics fixture had the
pre-seal shape, so every run in it was a 500 on the merged base. The lane found this and fixed it in c61ac94bd1
(metrics.test.mjs boot()).

## 1. Secrets (strict)
- app/scripts/build-pine-runtime.mjs: SERVER_BUNDLE_VITE_NAMES = [VITE_PINE_LOWER_TF_ENABLED, VITE_PINE_RUNTIME_PANE_ENABLED].
  viteEnvOf filters on this list, not on a VITE_ prefix. defineOf returns those names plus MODE/DEV/PROD/SSR, and it is the
  ONLY define key. OK.
- serverBundle.rail.test.js builds with VITE_CHART_RENDER_TOKEN(_PREVIOUS)/VITE_PICOVOICE_ACCESS_KEY/VITE_WS_HOST set to a marker
  and greps the BUILT bundle text for that marker. It also asserts defineOf's keys, and it holds the set of VITE_ names in the
  built bundle equal to the allowlist, so a real read cannot be missed and a stale entry cannot stay. These rails can fail: the
  evidence shows them red on the base, with the marker present in the bundle.
- Dockerfile stage 1: ARG/ENV are exactly the two flags (web's 24-name block is removed). The runtime stage copies only
  pine-runtime.mjs from stage 1, so what `COPY . .` brings in never reaches the final image. The rails in
  test_pine_runtime_dockerfile.py check four things: the ARG set equals the build script's list (read through node); it is a
  subset of web's ARGs and of the names the frontend reads; no ARG/ENV matches TOKEN|KEY|SECRET|PASSWORD|PRIVATE, with a
  control that web still declares the three secrets; and ENV_ALLOWLIST's VITE_* names equal the list (server.mjs:65-72). OK.
- Runbook docs/runbooks/pine-runtime-service-build-args.md: the only build args are the two non-secret flags. The only secret
  is PINE_RUNTIME_SERVICE_SECRET, which is a runtime variable, not a build arg. It says never to duplicate the service from
  web. No secret build arg is listed. OK.

## 2. Cache (strict)
- cache.mjs createResultLane: a hit is {...structuredClone(held), job: THIS request's id, cache:'hit'}. The stored value is
  storedOf(), a deep copy minus ms/cache, so a hit carries no ms. A store happens ONLY after seal(merged).ok and goes through
  ResultCache.put, which applies cacheable(). cacheable() refuses runtime:time-budget, any runtime:server-*, a crash and a
  withheld result with no guard. OK.
- Canary: cacheKeyOf returns null when doc_sha256 or bars.sha256 is 64 zeros, so nothing is read or written for that job. The
  canary also calls pool.run directly. The rail asserts 0 entries and 3 computes. OK.
- 1,000 ms budget: job.mjs budgetOf (a positive finite number, or a throw) is checked once at worker boot (sandbox.mjs
  jobWorker). runJob passes rt.RUNTIME_PANE_TIME_BUDGET_MS (job.mjs:154), which HP-7 pins. The real-bundle rail injects a clock
  and gets runtime:time-budget with cacheable false. Its control on the real clock is cacheable. OK.
- Closed schema: RUNNER_RESULT_FIELDS optional = ['ms','cache'] and CACHE_STATES = ['hit','miss']. sealOne refuses any other
  value (protocol.mjs sealOne), and `instructions` stays an unknown-key refusal. The rail covers 8 bad values. OK.
- Doc cache: a document is filed only after the full request has parsed and every hash has been recomputed (protocol.mjs parse,
  docs.put at the end). It is served as a structuredClone. The rail proves that a run which mutates its own copy cannot change
  the document the next request gets. OK.

## 3. Sandbox
'getBuiltinModule' is added to REMOVED_PROCESS (sandbox.mjs:42). The L3 rail names it separately and asserts that the host has
it, so the rail can fail. The new bundle exports, encodeColumn and bytesToB64, are pure functions. No new escape surface found.

## 4. One authority
job.mjs encodeColumn(rt, col, n) = rt.encodeColumn + rt.bytesToB64 (the bundle's T3 codec), and job.mjs's own encoder is
deleted. Worker boot requires both exports. The byte-identity rail compares against the old encoder, kept inside the test, over
special values, NaN payloads, 9,000 rows past a b64 chunk, and the refusal cases. HP-7: ADAPTER_FILES = worker + node only.
adapter.test.mjs (budgetMs = name:RUNTIME_PANE_TIME_BUDGET_MS) is the service's single rail, and the gate pytest now runs it
(pass 3, fail 0). OK.

## 5. Image
The image COPYs cache/canary/metrics.mjs, tools/pine_runtime_host_parity.mjs, app/package.json ("type":"module"), columnDigest.js
and the whole __fixtures__/hostParity dir. IMAGE_EXTRA_COPIES is a named allowlist with exact paths. A boot of the staged file
set under --no-experimental-detect-module loads server.mjs and the 10 canary cases, and a control drops each input in turn and
fails. railway.json watches the tool. The image has never been built (open note 7, carried from W5-T10 note 3). OK.

## 6. Respawn / readiness
pool.mjs: after start, a boot-error or a not-ready exit calls bootFailed(). That increments failing and sets an unref'd timer at
min(respawnMaxMs, respawnBaseMs*2^(failing-1)). ready() is false while failing > 0, even with a live worker. A first-boot
failure still refuses the pool, close() clears the timers, and there is no double spawn (the retired path has wasGone). main()
wires /ready to pool.ready() && canary.ok() (server.mjs:298), so /ready answers 503 and /v1/run answers 503
runtime:server-unavailable. /health stays 200, so Railway does not restart-loop. OK.

## 7. Tested-on-master / final-tip
`git merge-base 50e13ac02a origin/master` = 5d95103c8a (verified). runs/w5int/final-job.out lines 2 and 12 read
"TIP c61ac94bd1...". Results: node 125/125, HP-1 166/166, gate 46 passed, rails 372 passed, vitest 1 failed (the
pollingSites baseline). Mutations: 43 rows are logged (23 node + 15 py + 5 vitest) and all are KILLED in mut-job.out. The
evidence counts the 5 img rows as one family, which gives its 41.

## Notes (non-blocking)
1. LOW: the pool respawn rail asserts "retried >= 3 times" but not the doubling, so a constant-delay mutation would survive.
2. LOW: pool.mjs onMessage 'ready' resets failing=0 when ANY worker becomes ready (for example a recycle replacement). ready()
   can then return true while a failed slot still waits for its retry. The pool serves under capacity; it does not serve wrong
   values.
3. LOW/INFO: the DocCache is keyed by doc_sha256 only and is shared across owners, so a doc:null request that names another
   owner's sha runs that owner's doc. The caller is HMAC-authenticated web. T11/T20 must send doc:null only for a doc the
   requesting owner holds.
4. INFO: these review notes are neither closed nor listed under Open notes. W5-T7b note 3: one bad result 500s the whole
   request, where design 3.7 rule 2 wants per-job withholding. W5-T7 note 6: the probeVerdictCache FNV key. W5-T9 notes: the
   smoke retypes the HMAC; the boot log line re-derives `boot`; the initial /ready 503 is not asserted. Carry them to T19/T20.
5. INFO: /v1/metrics `workers` does not expose the new bootFailures / respawnPending.

## Merge hazards
- Order: T1 -> T6 -> T7 -> T3 -> T4 -> T7b, T8, T9, T10 -> W5-INT. This lane contains all of them, so land it instead of them
  or after them. origin/master has moved 550 commits past 5d95103c8a. `git merge-tree origin/master 50e13ac02a` is CLEAN. The
  only overlap with the paths this lane touches is app/package.json, which gains a "three" dependency and keeps
  "type":"module". After merging master in, re-run the service rails and final-tip.
- Engine bump: NO. Only serverEntry.js's export list changed, SCRIPT_ENGINE_VERSION is untouched, and HP-1 (artifact-neutral)
  is 166/166.
- Member reach: none. No flag, no Railway service and no web caller; master's object door is untouched.
