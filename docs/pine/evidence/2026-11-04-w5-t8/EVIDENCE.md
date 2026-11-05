# W5-T8 document + result caches: evidence

Lane: W5-T8 (docs/pine/SERVER-RUNTIME-DESIGN.md section 7 P1 T8, section 3.3), desktop machine.
Branch `feat/pine-w5-t8-cache`, stacked on W5-T6 tip `94b46f55b1` (T6 not yet merged). Tested on master
`5d95103c8a` (merge-base with origin/master). Code tip checked: `8de4c015d5` (the evidence commit that
follows adds only this file). Local only: no Railway, no flags, no secrets.

## What is new
- `services/pine_runtime/cache.mjs` (the only source file; pool.mjs, job.mjs, sandbox.mjs untouched, and
  NO edit to any T6 file: server.mjs / protocol.mjs / auth.mjs are unchanged, T7 wires the caches in).
  - `DocCache` (2,000 docs / 256 MB LRU, bytes = UTF-8 length of the doc text). `put(docSha256, text)`
    RECOMPUTES sha256 over the text's UTF-8 bytes (T6's wire decision) and REFUSES a mismatch with
    422 `runtime:server-integrity`, storing nothing. A caller's hash is never trusted.
  - `ResultCache` (512 MB LRU) plus `resultKey(request, job)` over the PARSED request that
    `parseRunRequest` returns, and `cacheable(result)`.
  - Key = sha256 over length-prefixed fields: tag, the 5 engine identity fields (as strings, so integer
    and decimal string are one value, T6/T3 rule), `doc_sha256`, canonical ctx (forming, listing, then
    runtimeInputs in sorted-key order with TYPED values, so 1, "1", true, 0 and -0 differ), `bars.sha256`,
    sorted `want`, `profile`. All of these are existing T6 fields; nothing new is on the wire.
  - DEVIATION TO CONFIRM: the key also includes the job's `symbol.ticker`, `symbol.exchange` and `tf`.
    The design row omits them, but scripts read syminfo.* and timeframe.*, so two jobs with identical
    bars on different symbols must not share a result. This can only lower the hit rate, never serve a
    wrong value. Remove them only if the engine is proven not to read them.
  - NEVER cached (`cacheable`): `runtime:time-budget`; any `runtime:server-*` guard; a result flagged
    `crashed` or `timedOut`; any status other than `ok` / `withheld`; a `withheld` that names no guard
    (cannot be proved deterministic, fails closed). Guards are found anywhere in the result, nested too.
    The runner reply shape is T7's; this rule reads only `status` and any `guard` strings.
  - Kill and stage are not in the key (design 3.3): the caller asks `server_lane_refusal` before every use.
- `services/pine_runtime/test/cache.test.mjs`: 10 node:test rails.

Engine bump: **NO**. No compute code and no bundle input changed.

## Commands and totals
- Rails: `node --test --test-force-exit services/pine_runtime/test/*.test.mjs` -> tests 43, pass 43,
  fail 0 (33 from T6 + 10 new).
- Red on base `94b46f55b1` (no cache.mjs): `python docs/pine/evidence/2026-11-04-w5-t8/redbase.py` moves
  cache.mjs aside, runs cache.test.mjs -> `ERR_MODULE_NOT_FOUND`, tests 1, pass 0, fail 1 (the file fails to
  load, so all 10 rails are red); restore asserted byte-exact. Green on the tip: 10/10.
- Rails that fail on base and pass on the tip: all 10 in cache.test.mjs: key stable and ignores noise;
  KEY SENSITIVITY (18 components, each moves the key, no two collide); key equalities; typed inputs never
  collide; same-count want / field-boundary shifts never collide; doc cache refuses a mismatched
  doc_sha256; doc cache LRU by count and bytes; doc cache re-put does not double count; result cache LRU
  by bytes; NEVER cached list.
- Mutations (lane `dsk/heavy-mut.lock`, label w5t8-mut): `python docs/pine/evidence/2026-11-04-w5-t8/mutate_node.py
  $S/mutate.py muts.json services/pine_runtime/test/cache.test.mjs` (T6's wrapper over the unchanged
  mutate.py, byte-exact restores). 29 rows: 28 KILLED, 1 SURVIVED = the control (comment-only edit),
  as intended. Two survivors on the first pass (`key:want-dropped`, `key:no-length-prefix`) exposed real
  gaps; the rail `same-count want lists ... field-boundary shifts` was added and both are now killed.

| mutation | result | killing test(s) |
|---|---|---|
| control:noop-comment | SURVIVED | - |
| key:engine-field-dropped | KILLED | KEY SENSITIVITY: each component changes the key |
| key:doc-sha-dropped | KILLED | KEY SENSITIVITY: each component changes the key |
| key:ctx-dropped | KILLED | KEY SENSITIVITY: each component changes the key; typed inputs never collide: 1, "1", true, 0, -0 and field-bo |
| key:forming-dropped | KILLED | KEY SENSITIVITY: each component changes the key |
| key:listing-dropped | KILLED | KEY SENSITIVITY: each component changes the key |
| key:inputs-unsorted | KILLED | key equalities: want order, runtimeInputs order, int vs deci |
| key:inputs-untyped | KILLED | typed inputs never collide: 1, "1", true, 0, -0 and field-bo |
| key:neg-zero | KILLED | typed inputs never collide: 1, "1", true, 0, -0 and field-bo |
| key:bars-dropped | KILLED | KEY SENSITIVITY: each component changes the key |
| key:symbol-dropped | KILLED | KEY SENSITIVITY: each component changes the key; same-count want lists with different names, and field-bounda |
| key:tf-dropped | KILLED | KEY SENSITIVITY: each component changes the key |
| key:want-unsorted | KILLED | key equalities: want order, runtimeInputs order, int vs deci |
| key:want-dropped | KILLED | same-count want lists with different names, and field-bounda |
| key:profile-dropped | KILLED | KEY SENSITIVITY: each component changes the key |
| key:no-length-prefix | KILLED | same-count want lists with different names, and field-bounda |
| doc:hash-check-off | KILLED | doc cache: put recomputes the hash and REFUSES a mismatch; n |
| doc:no-lru-refresh | KILLED | doc cache: LRU by count and by bytes; a hit refreshes recenc; result cache stores deterministic answers and returns them;  |
| lru:count-bound-off | KILLED | doc cache: LRU by count and by bytes; a hit refreshes recenc |
| lru:byte-bound-off | KILLED | doc cache: LRU by count and by bytes; a hit refreshes recenc; result cache stores deterministic answers and returns them;  |
| lru:oversize-kept | KILLED | result cache stores deterministic answers and returns them;  |
| lru:replace-double-count | KILLED | doc cache: re-putting the same document does not double-coun |
| never:time-budget-cached | KILLED | NEVER cached: time-budget, runtime:server-*, crashes, non-an |
| never:server-prefix-cached | KILLED | NEVER cached: time-budget, runtime:server-*, crashes, non-an |
| never:crash-cached | KILLED | NEVER cached: time-budget, runtime:server-*, crashes, non-an |
| never:unnamed-withheld-cached | KILLED | NEVER cached: time-budget, runtime:server-*, crashes, non-an |
| never:status-open | KILLED | NEVER cached: time-budget, runtime:server-*, crashes, non-an |
| never:nested-guard-missed | KILLED | NEVER cached: time-budget, runtime:server-*, crashes, non-an |
| result:put-skips-cacheable | KILLED | NEVER cached: time-budget, runtime:server-*, crashes, non-an |

- final-tip (lane `dsk/heavy-final2.lock`, label w5t8-final; it waited about 40 min behind another
  lane's job, then ran 41.9 min):
  `bash $S/final-tip.sh pine-dsk-w5t8 w5t8-final`. Log dir `_resume-2026-11-01/runs/w5t8-final/`.
  - gate pytest: 46 passed. Hygiene: clean (34686 tracked files).
  - full chart+hooks vitest: Test Files 1 failed | 1334 passed | 27 skipped (1362); Tests 1 failed |
    22366 passed | 118 skipped. The only failure is `src/hooks/pollingSites.rail.test.js`, the desktop
    baseline. Nothing new.
