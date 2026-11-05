VERDICT: GO-WITH-NOTES @e13d282eae

Lane W5-T7b result digest + warm-up. Own diff f526d609e4..e13d282eae (3 commits; code tip f8726b84f4, e13d282eae docs-only).
f526d609e4 = merge of W5-T7 5e6c63e24e and W5-T4 eb922686fe. Reviewer: independent desktop Opus, 2026-11-04, read-only.

## Evidence ownership
docs/pine/evidence/2026-11-04-w5-t7b/EVIDENCE.md is genuinely this lane's: branch feat/pine-w5-t7b-result-integrity, tips f8726b84f4/
e13d282eae, file list = the diff, mutation ids seal:/server:/job:warmup/sandbox:warmup/entry:, logs runs/w5t7b-mut + runs/dsk-w5t7b-final,
which reference only worktree pine-dsk-w5t7b. No collision with W5-T7.

## Checks against the brief
- Closed response schema stays closed: protocol.mjs sealOne (:~312-350) checks each runner result with closed() against
  RUNNER_RESULT_FIELDS, then BUILDS the wire object from named fields only; REFUSAL_FIELDS and WARMUP_FIELDS closed; a runner-supplied
  `digest` is refused (seal.test.mjs:191). The reply envelope is {protocol, engine, results} (server.mjs). OK.
- Digest is T3's, one implementation: loadBundle requires the bundle's columnDigest/decodeColumn and the seal uses only door.codec
  (server.mjs loadBundle; protocol.mjs sealOne). No hashing of columns anywhere else in services/. Digest is over the DECODED wire bytes
  with the service identity, so the caller verifies what it received. OK.
- Warm-up is the run's own: job.mjs encodeResult calls rt.runtimeWarmupOf(cols), the same function runtimeWorker.js:31 posts; only
  withheldBars crosses; null -> 0; the worker refuses a bundle without it (sandbox.mjs:137). withheldBars = `from` (runtimeColumns.js:621),
  an integer <= n, so the seal's [0,n] check holds. OK.
- e2e is real: tests/test_pine_runtime_result_integrity.py builds a fresh bundle, boots the real main() with the real pool, drives T11's
  PineRuntimeClient over loopback, recomputes the digest client-side (test 1), flips one mantissa bit (test 2), drops the digest (test 3),
  checks warm-up bars are na (test 4) and pins the T11 `warmup` key mismatch (test 5). Red-on-base 4/5 as claimed.
- Daily bar-time claim VERIFIED: indicators.js:1609-1627 barOpenInstant (number verbatim :1610 with floor VWAP_MIN_INSTANT :302; ISO date
  -> etWallInstant(day, 09:30) :1626); vm.js:630 READ_CLOCK and :648-652 SESSION read etClockAt(barTimes[bar]) on raw seconds. UTC-midnight
  seconds therefore read 19:00/20:00 ET the previous day, as stated. The W5-T15 finding stands.
- Engine bump: NO (serverEntry.js re-exports only; HP-1 uses ARTIFACT_NEUTRAL_SHA so digests do not move). No member reach, no flag, no
  secret. Merges clean onto origin/master.

## Notes (non-blocking)
1. MEDIUM, one authority: job.mjs:69-87 still carries its own canonical encoder (NAN_HI retyped) beside T3's encodeColumn/bytesToB64 that is
   now in this base. The seal's strict T3 decode bounds drift to a 500 for NaN/length errors, and job.test pins -0, but it is still two
   copies of the 2.3 encoding (T7's own open item). Follow-up: job.mjs should call rt.encodeColumn + rt.bytesToB64.
2. MEDIUM, two HP-7 rails now coexist in this base: tools/pine_runtime_host_parity.mjs --adapters (T4; exempts budgetMs) and
   services/pine_runtime/test/adapter.test.mjs (T7; requires budgetMs equal to the worker's). Both green, but they encode different
   rules for one agreement; the coordinator should keep one (T7's is the stronger parse).
3. LOW, a seal failure on ANY one result 500s the whole request (server.mjs step 6), where design 3.7 rule 2 wants per-job withholding.
   Today only a runner bug can reach it (job.mjs cannot emit an out-of-schema result; err.bar is passed unclamped at job.mjs refusalOf but no
   engine stop carries a negative bar). Consider per-job `runtime:server-integrity` instead, before T14's 50-symbol chunks depend on it.
4. LOW, the e2e fixture sends bars.t = 1.6e12 + i*86.4e6 (MILLISECONDS) - the very spelling this lane's own rule says is read as far-future
   seconds. Harmless for an EMA, but the fixture should use 09:30 ET open seconds so it models the rule it documents.
5. LOW, the e2e SKIPS without T11 on the tree; until T11 merges, the gate's proof is the node seal/result rails only.
6. INFO, `warmup` is outside the digest preimage (stated in EVIDENCE); private network only, so acceptable for v1.
7. INFO, seal digests on the supervisor thread (~1.3 ms/job, ~0.7 s per 500-job request) - for T9 capacity.

## Merge hazards / order
T1 -> T6 -> T7 -> T3 -> T4 -> T7b (base f526d609e4 needs both T7 and T4 merged first).
- T11 must add `warmup` to _RESULT_KEYS and carry it to JobResult (MISMATCH 1); T11's lane adapter must expose .warmup for T16 (MISMATCH 2).
- T11 expects optional `cache`/`instructions`; T7b's closed schema refuses them, so T8/T9 must widen RESULT_FIELDS when they land.
- T9 textual conflict in server.mjs::run (metrics.answered should take sealed.results); T8 must cache `warmup` with columns.
