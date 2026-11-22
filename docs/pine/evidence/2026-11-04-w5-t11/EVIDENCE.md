# W5-T11 client + lane adapter: evidence

Lane: W5-T11 (docs/pine/SERVER-RUNTIME-DESIGN.md section 7, P2 T11), desktop machine.
Branch `feat/pine-w5-t11-client`, stacked on W5-T3's tip `409456ee36` (T3 not merged yet; merge
origin/master in once it is). Tested on master `0afa7645dd` (merge-base with origin/master).
Code tip checked: `7b55c7d344`. Local only: no Railway, no flags, no network in any rail (every request
goes to the in-process fake), fixture secrets only.

## What is new
- `api/services/pine_runtime_client.py`, THE ONE DOOR. `PineRuntimeClient.run(def_id, version, doc,
  owner_id, profile, jobs, cache)` returns one `JobResult` per job, in order, and never raises for a
  failed run. It signs (`X-Pine-Runtime-Signature: t=<unix>,v1=HMAC-SHA256(secret, "<t>." +
  sha256hex(body))`, first comma-separated secret), sends the T6 closed schema (doc as canonical JSON
  text, bars as T3 canonical base64, `bars.sha256` = T6's `barsSha256`), decodes with the T3 codec
  (`pine_runtime_codec.decode_column(rows=n)`, `b64_to_bytes`), verifies length, finiteness and the
  T3 digest, and maps every failure to a 3.7 guard. Batch API: sweep is chunked by 50, other
  profiles by `scan_run.MAX_RUN_SYMBOLS` (read); one failed chunk or job withholds only itself.
  `RunCache` is the per-cycle caller cache keyed on identity, doc sha, symbol, tf, ctx, BARS HASH,
  want and profile; it never keeps a `runtime:server-*` or `runtime:time-budget` result.
  `caller_identity()` reads the 5 identity fields from `scriptEngineVersion.js` (through
  `user_definitions.read_script_engine_version`), `pineRuntimeFrontend.js`, `ir.js` and the sha256
  of `app/dist-server/pine-runtime.mjs`; any part missing means every run is withheld by name.
  `client_from_env()` reads the variable NAMES from W5-T12 (`runtime_definitions.SERVICE_URL_ENV`,
  `SERVICE_SECRET_ENV`) through the module, never retyped.
- `api/services/runtime_server_lane.py`: `runtime_column_fn(row, plot_key, lane)` returns
  `fn(bars, params, *, tf, ticker, exchange="", history_from_listing=False) -> column`. On EVERY
  call, before any service call and before the cache, it asks `user_definitions.engine_withheld_reason`
  (5.2 step 2, guard `withheld`) and then `runtime_definitions.server_lane_refusal(row, lane=)`
  (step 4, W5-T12's, through a call-time `getattr` seam: absent, raising or malformed answers refuse).
  A refusal RAISES `ServerLaneWithheld(guard, sentence)`; it never returns an empty column.
- `tests/fakes/pine_runtime_fake.py`: an in-process `Transport` that re-derives T6's door
  independently (signature, replay set, closed top level, engine, doc and bars hashes) and answers in
  T7's job-result shape plus the 3.2 `digest`, with named fault injection.

Engine bump: **NO**. No engine or app code changed (Python only, plus tests and evidence).

## Against W5-T6's real door (not a rail: T6 is not on this base)
`python -B docs/pine/evidence/2026-11-04-w5-t11/t6_door_check.py 94b46f55b1` builds a request with the
client (non-ASCII source, inputs, 7 bars) and feeds it to T6's own `auth.mjs` / `protocol.mjs` (read
with `git show`, never copied): `signature verified: true | parse ok: true n=7 | moved engine: 409
runtime:server-engine-mismatch`, rc 0. The rails also pin two vectors computed by T6's JS:
`signHeader` and `barsSha256` (`test_signature_matches_t6_auth_vector`,
`test_bars_hash_matches_t6_protocol_vector`).

## Schema findings (for the coordinator)
1. (closed in r1 by W5-T7b) **T7's job results carry no `digest`** (`job.mjs::encodeResult` on `feat/pine-w5-t7-pool`), but
   design 3.2 puts one on every result and T11 must "verify length and digest". The client REQUIRES
   it on an `ok` result (verifies it on `withheld` when present), so until T7/T8 adds
   `digest = column_digest(service identity, decoded columns, refusals)` every T7 `ok` answer is
   withheld `runtime:server-integrity`. That is fail-closed; one side must move before T13.
2. Design 3.2 shows a 4-field `engine` and `doc` as an object; T3/T6 use 5 fields (with
   `runtime_language`) and `doc` as JSON text. The client follows T6.
3. 3.7 row 10 says a non-finite value is integrity, while T3's codec carries +/-Infinity as values.
   The client refuses +/-Infinity (NaN is na and passes). If the runtime can emit Infinity for a
   value TradingView shows, this needs a ruling.
4. T6's replay set refuses an identical body signed in the same second. Two identical runs (two
   alerts on one plot in a cycle, a 429 resend) would collide, so the client signs a repeated body
   with a later second (`signing_time`, process-wide). Two web replicas sending byte-identical bodies
   in one second can still collide (one is withheld `runtime:server-auth`, by name).
5. `server_lane_refusal` and the `SERVICE_*_ENV` names are on origin/master (T12 merged) but not on
   this base; on this branch every lane call is refused `runtime:server-unavailable`, by design.

## Commands and totals
- Rails (direct, tip 7b55c7d344): `python -B -m pytest -q tests/test_pine_runtime_client.py tests/test_runtime_server_lane.py` -> 126 passed (`runs/w5t11-mut/tip2.log`).
- T6 door check: as above, rc 0.
- Pre-existing, not this lane: `tests/test_test_discovery_coverage.py::test_no_production_module_is_wearing_a_test_name` is red on this base (7 `tests/pattern_engine/detectors/test_uct_*.py` files hold no test); no file of this lane is named.

## Rails red on base, green on tip
`python -B docs/pine/evidence/2026-11-04-w5-t11/redbase.py tests/test_pine_runtime_client.py
tests/test_runtime_server_lane.py` removes the three new modules (as on base 409456ee36), runs
pytest, restores byte-exact: base rc=2, "2 errors" (ImportError: cannot import name `pine_runtime_client`), restored byte-exact (`runs/w5t11-mut/redbase2.log`). Every test in both files is red on base (collection
ImportError) and green on the tip (126 passed).

One rail per 3.7 row (test names in `tests/test_pine_runtime_client.py`):
| 3.7 row | rails |
|---|---|
| 1 URL unset | `test_row1_url_unset_withholds_unavailable_and_sends_nothing`, `test_row1_no_secret_or_no_identity_is_unavailable_too`, `test_row1_client_from_env_reads_t12_names_and_fails_closed_without_them` |
| 2 connect/DNS/timeout/5xx | `test_row2_transport_errors_are_unavailable[3]`, `test_row2_5xx_is_unavailable[500,502,503,504]`, `test_row2_t6_not_ready_503_is_unavailable`, `test_row2_transport_gets_the_remaining_deadline` |
| 3 401/403 | `test_row3_a_wrong_secret_is_auth_and_never_retried`, `test_row3_401_403_is_auth[2]` |
| 4 engine identity | `test_row4_service_409_engine_is_engine_mismatch`, `test_row4_a_reply_from_another_engine_is_engine_mismatch`, `test_row4_an_integer_and_its_decimal_string_are_one_identity` |
| 5 doc/bars hash | `test_row5_bars_hash_mismatch_is_integrity`, `test_row5_doc_hash_mismatch_is_integrity`, `test_row5_integrity_is_logged_loudly_without_the_owner_or_source`, `test_row5_a_request_the_service_calls_malformed_is_integrity[2]` |
| 6 429 | `test_row6_alert_retries_once_then_withholds_busy`, `test_row6_alert_busy_then_ok_is_ok`, `test_row6_resending_the_same_body_needs_a_later_timestamp`, `test_row6_scan_chunk_retries_three_times_with_backoff`, `test_row6_backtest_does_not_retry`, `test_row6_no_retry_past_the_deadline` |
| 7 worker OOM/crash/kill | `test_row7_worker_stops_keep_their_guard_and_are_never_cached[oom,failed,time-budget]`, `test_row7_pool_failure_500_withholds_every_job_as_failed` |
| 8 run-wide refusal | `test_row8_run_wide_refusal_is_the_guard_itself_with_its_sentence[3]`, `test_row8_a_deterministic_run_refusal_may_be_cached`, `test_row8_an_ok_result_carrying_a_run_wide_refusal_is_integrity`, `test_row8_withheld_with_values_or_without_a_reason_is_integrity` |
| 9 per-output refusal | `test_row9_per_output_refusal_withholds_that_plot_only`, `test_row9_a_wanted_key_neither_served_nor_refused_is_integrity`, `test_row9_a_key_both_served_and_refused_or_unasked_is_integrity` |
| 10 length / non-finite | `test_row10_never_partial_a_short_column_is_integrity`, `..._a_long_column_...`, `..._an_infinite_value_...[2]`, `..._na_is_a_value_not_a_failure`, `..._a_non_canonical_nan_...`, `..._a_digest_that_does_not_match_...`, `..._an_ok_result_without_a_digest_...`, `..._a_digest_over_another_engine_...`, `..._one_bad_job_withholds_that_job_only`, `..._a_reply_not_answering_every_job_once_in_order_withholds_the_chunk[4]`, `..._not_protocol_1_...[4]`, `..._an_unknown_result_key_...` |
| never stale | `test_never_stale_a_bars_change_is_a_cache_miss`, `test_never_stale_every_key_part_misses[6]`, `..._profile_and_document_are_in_the_key`, `..._the_engine_identity_is_in_the_key`, `..._a_client_withhold_is_never_cached`, `..._without_a_cache_every_call_runs` |
| never partial | `test_row10_never_partial_a_short_column_is_integrity`, `test_row10_one_bad_job_withholds_that_job_only`, lane `test_never_partial_through_the_lane_a_short_column_raises_integrity` |
Lane rails (`tests/test_runtime_server_lane.py`): both questions on every call, a kill reaches the
next call with the cache warm and makes no service call, a new verdict reaches the next call, verdict
before admission, every admission guard raised by name, absent/raising/malformed admission refuses,
an unreadable verdict withholds, run-wide and per-output refusals raise, transport failure raises,
never partial and never stale through the lane, params become `ctx.runtimeInputs`, the client is
built per call.

## Mutation table
Lock `_resume-2026-11-01/dsk/heavy-mut.lock`. Command, from the repo root:
`python -B docs/pine/evidence/2026-11-04-w5-t11/mutate_pytest.py docs/pine/evidence/2026-11-04-w5-t11/muts.json tests/test_pine_runtime_client.py tests/test_runtime_server_lane.py`
(`mutate_pytest.py` = the programme's `mutate.py` apply/byte-exact restore/assert with pytest as the
runner; `python -B`, PYTHONDONTWRITEBYTECODE=1 and the mutated module's pyc deleted before each run,
so a same-length mutation cannot be defeated by `__pycache__`. `mkmuts.py` regenerates `muts.json`
and asserts each `old` occurs once.) Round 2 (`runs/w5t11-mut/mut2.log`, code = 7b55c7d344): **TOTAL 63, KILLED 62, SURVIVED 1 = the no-op control**, as it must. No equivalent survivors.

Round 1 (`runs/w5t11-mut/mut.log`) left 3 survivors besides the control, all masked by a SECOND
check rather than unguarded: C02 (no URL: the transport call still failed inside the `try`, so the
withhold was right for the wrong reason; the rail now asserts the sentence names the URL), C17 (the
column length was checked twice, by the decode and again by the digest's `rows=n`; the digest no
longer re-checks rows, so the decode is the one length authority), C23 (a withheld result with no
reason also broke its digest; the rail now re-digests honestly). Round 2 re-ran all 63.

| mutation | result | first killing rail |
|---|---|---|
| CONTROL no-op comment | SURVIVED | `(control: no-op)` |
| C01 unconfigured: secret/identity not required | KILLED | `test_row1_no_secret_or_no_identity_is_unavailable_too` |
| C02 unconfigured: url not required | KILLED | `test_row1_url_unset_withholds_unavailable_and_sends_nothing` |
| C03 transport errors not mapped | KILLED | `test_row2_transport_errors_are_unavailable[fault0]` |
| C04 403 not auth | KILLED | `test_row3_401_403_is_auth[403]` |
| C05 429 not busy | KILLED | `test_row6_alert_retries_once_then_withholds_busy` |
| C06 one retry too many | KILLED | `test_row6_alert_retries_once_then_withholds_busy` |
| C07 retry ignores the deadline | KILLED | `test_row6_no_retry_past_the_deadline` |
| C08 no exponential backoff | KILLED | `test_row6_scan_chunk_retries_three_times_with_backoff` |
| C09 409 engine not mapped | KILLED | `ERROR` |
| C10 500 pool failure not mapped | KILLED | `test_row7_pool_failure_500_withholds_every_job_as_failed` |
| C11 5xx mapped to integrity | KILLED | `ERROR` |
| C12 400 not integrity | KILLED | `test_row5_a_request_the_service_calls_malformed_is_integrity[400-runtime:server-schema]` |
| C13 reply engine not compared | KILLED | `test_row4_a_reply_from_another_engine_is_engine_mismatch` |
| C14 identity compared without T3 int==str rule | KILLED | `test_row4_an_integer_and_its_decimal_string_are_one_identity` |
| C15 results not matched by job id | KILLED | `test_row10_a_reply_not_answering_every_job_once_in_order_withholds_the_chunk[<lambda>1]` |
| C16 results count not checked | KILLED | `test_row10_a_reply_not_answering_every_job_once_in_order_withholds_the_chunk[<lambda>0]` |
| C17 column length not checked | KILLED | `test_row10_never_partial_a_short_column_is_integrity` |
| C18 infinite value admitted | KILLED | `test_row10_an_infinite_value_is_integrity[inf]` |
| C19 digest not recomputed | KILLED | `test_row10_a_digest_that_does_not_match_the_columns_is_integrity` |
| C20 wanted key may vanish | KILLED | `test_row9_a_wanted_key_neither_served_nor_refused_is_integrity` |
| C21 key served and refused | KILLED | `test_row9_a_key_both_served_and_refused_or_unasked_is_integrity` |
| C22 unasked key served | KILLED | `ERROR` |
| C23 withheld without a reason | KILLED | `ERROR` |
| C24 ok and withheld at once | KILLED | `test_row8_an_ok_result_carrying_a_run_wide_refusal_is_integrity` |
| C25 result keys not closed | KILLED | `test_row10_an_unknown_result_key_is_integrity` |
| C26 reply protocol not checked | KILLED | `test_row10_a_reply_that_is_not_protocol_1_is_integrity[{"protocol":` |
| C27 time-budget cached | KILLED | `test_row7_worker_stops_keep_their_guard_and_are_never_cached[runtime:time-budget]` |
| C28 server-* cached | KILLED | `test_row7_worker_stops_keep_their_guard_and_are_never_cached[runtime:server-worker-oom]` |
| C29 bars hash not in cache key | KILLED | `test_never_stale_a_bars_change_is_a_cache_miss` |
| C30 want not in cache key | KILLED | `test_never_stale_every_key_part_misses[change2]` |
| C31 profile not in cache key | KILLED | `test_never_stale_profile_and_document_are_in_the_key` |
| C32 symbol/tf not in cache key | KILLED | `test_never_stale_every_key_part_misses[change0]` |
| C33 ctx not in cache key | KILLED | `test_never_stale_every_key_part_misses[change3]` |
| C34 doc not in cache key | KILLED | `test_never_stale_profile_and_document_are_in_the_key` |
| C35 identity not in cache key | KILLED | `test_never_stale_the_engine_identity_is_in_the_key` |
| C36 non-finite bar sent | KILLED | `test_batch_a_bar_that_is_not_a_finite_number_is_refused_before_sending[nan]` |
| C37 unsorted bars sent | KILLED | `test_batch_bad_input_is_refused_before_sending_that_job_only` |
| C38 repeated job id sent | KILLED | `test_batch_bad_input_is_refused_before_sending_that_job_only` |
| C39 bad ticker sent | KILLED | `test_batch_a_symbol_or_timeframe_the_service_refuses_is_refused_before_sending[kw0]` |
| C40 bad inputs sent | KILLED | `test_batch_inputs_the_service_refuses_are_refused_before_sending[inputs0]` |
| C41 bad def id sent | KILLED | `test_batch_bad_definition_withholds_without_sending` |
| C42 bad version sent | KILLED | `ERROR` |
| C43 non-object doc sent | KILLED | `ERROR` |
| C44 same body signed twice in one second | KILLED | `test_row6_resending_the_same_body_needs_a_later_timestamp` |
| C45 signature message drifts from auth.mjs | KILLED | `test_ok_run_returns_the_full_verified_column` |
| C46 bars hash drifts from protocol.mjs | KILLED | `ERROR` |
| C47 doc text not canonical | KILLED | `test_request_is_the_closed_schema_t6_parses` |
| C48 sweep not chunked | KILLED | `test_batch_sweep_is_sent_in_chunks_of_50_and_a_failed_chunk_withholds_only_its_jobs` |
| C49 env secret not first entry | KILLED | `test_row1_client_from_env_reads_t12_names_and_fails_closed_without_them` |
| C50 caller identity reads no bundle | KILLED | `test_caller_identity_reads_the_declaring_modules` |
| C51 ambiguous declaration admitted | KILLED | `test_caller_identity_is_none_without_a_bundle_or_with_an_ambiguous_declaration` |
| C52 integrity logged at warning | KILLED | `test_row5_integrity_is_logged_loudly_without_the_owner_or_source` |
| L01 verdict not asked | KILLED | `test_a_stored_verdict_reaches_the_next_call` |
| L02 admission not asked | KILLED | `test_a_kill_reaches_the_next_call_even_with_the_cache_warm` |
| L03 absent admission admits | KILLED | `test_a_build_without_server_lane_refusal_refuses_every_call` |
| L04 raising admission admits | KILLED | `ERROR` |
| L05 malformed admission answer passed through | KILLED | `test_a_malformed_admission_answer_refuses[answer0]` |
| L06 unreadable verdict admits | KILLED | `ERROR` |
| L07 admission asked before verdict | KILLED | `test_admitted_call_returns_the_plot_column` |
| L08 a refused plot returns no raise | KILLED | `test_a_run_refusal_is_raised_never_an_empty_column` |
| L09 unknown lane accepted | KILLED | `test_an_unknown_lane_is_a_programming_error` |
| L10 client built once, not per call | KILLED | `test_the_default_client_is_read_per_call` |

## final-tip
Lock `_resume-2026-11-01/dsk/heavy-final2.lock`, tip `7b55c7d344`, tested on master `0afa7645dd`:
`bash $S/final-tip.sh pine-dsk-w5t11 dsk-w5t11-final tests/test_pine_runtime_client.py tests/test_runtime_server_lane.py tests/test_pine_runtime_codec.py tests/test_script_engine_version_gate.py`.
Log dir `_resume-2026-11-01/runs/dsk-w5t11-final/`.
- gate pytest: 46 passed (rc 0). Hygiene: clean (34609 files).
- rails pytest (the two new files + T3 codec + engine-version gate): 343 passed.
- full chart+hooks vitest: Test Files 1 failed | 1334 passed | 27 skipped (1362); Tests 1 failed | 22505 passed | 118 skipped. The only failure is `src/hooks/pollingSites.rail.test.js`, the known baseline. Nothing new (this lane changes no JS).

## Open items
- T7/T8 must add `digest` to every job result (finding 1) before T13 can get an `ok` answer.
- Infinity ruling (finding 3).
- `t` units: `bars_sqlite` daily `ts` is YYYYMMDD; the client only requires finite, strictly
  increasing numbers. Converting to the runtime's time base is T13/T14's (the lanes own bars).
- The web pod's identity needs `app/dist-server/pine-runtime.mjs` (T1) in the web image; until then
  `caller_identity()` is None and every run is withheld `runtime:server-unavailable`.
- Logs: `_resume-2026-11-01/runs/w5t11-mut/` (tip.log, redbase.log, mut.log, tip2.log, redbase2.log,
  mut2.log) and `_resume-2026-11-01/runs/dsk-w5t11-final/`.

## r1 (FIX r1: the W5-T7b warm-up, the public admission, the Infinity ruling), code tip `a74e273652`
W5-T7b (`origin/feat/pine-w5-t7b-result-integrity` e13d282eae) now sends `digest` on every result
and `warmup: {withheldBars}` on every ok result. T7b's e2e rail showed this client refused that ok
answer because `warmup` was not in its closed `_RESULT_KEYS`. T7b is read only; it is NOT merged here.

What changed:
- `pine_runtime_client.py`: `warmup` joins the closed result keys. On an ok result it is REQUIRED
  and must be an object of exactly `{withheldBars}` holding an integer in [0, n] (not a bool).
  Anything else is `runtime:server-integrity`. A withheld result that reports one is also
  integrity, matching T7b's `RESULT_FIELDS`. Every other key stays closed. The value is kept as
  `JobResult.warmup`. `warmup` is not covered by the digest (the T3 preimage has no field for it),
  so it is checked by shape and range.
- `runtime_server_lane.py`: the column is now a `RuntimeColumn` (a `list` subclass) that carries
  `.warmup = {"withheldBars": k}`, which is what W5-T16's `record_runtime_pass` reads.
- `runtime_server_lane.admission(row, plot_key, lane)` (owner-delegated ruling 1) is PUBLIC. It
  returns `(guard, sentence)` or None from the same 5.2 chain `runtime_column_fn` asks on every
  call (the stored verdict, then `server_lane_refusal`), and it makes no service call. An unnamed
  plot is `runtime:server-integrity` and an unknown lane is a ValueError. `runtime_column_fn` now
  calls `admission` itself, so there is one chain. `_verdict` and `_admission` stay as thin
  aliases for T13-T15.
- Infinity (ruling 2, design 3.7): +Infinity or -Infinity in an ok column is
  `runtime:server-integrity`, and the codec's na (canonical NaN) is a value. This was already the
  r0 behaviour (`test_row10_an_infinite_value_is_integrity[inf,-inf]`,
  `test_row10_na_is_a_value_not_a_failure`). r1 mutation-proves it per sign (I01, I02).
- The fake answers in T7b's shape (an ok result carries `warmup`).
- `tests/fixtures/pine_runtime/t7b_response.json`: a REAL T7b response.
  `t7b_capture.py e13d282eae` reads T7b's own server.mjs, pool.mjs, job.mjs, protocol.mjs,
  auth.mjs, sandbox.mjs, its `test/fixtures/fakeBundle.mjs` and T3's `columnDigest.js` with
  `git show` into a temp tree (never into the repo). It runs T7b's `createPineRuntimeServer` with
  T7b's `createPool` (1 sandboxed worker) on 127.0.0.1, POSTs the request this client builds and
  signs, and stores the request sha256 and the exact response bytes. Result: HTTP 200, 2 ok jobs,
  `warmup {withheldBars: 3}`, sealed digests. Fixture secret only.

Rails (r1, names start `test_r1_`):
- client: `test_r1_an_ok_result_carries_its_warmup`;
  `test_r1_a_warmup_that_is_not_exactly_a_bar_count_is_integrity[11]` (absent, None, [], {}, -1,
  1.5, True, "3", n+1, an extra key, a wrong key); `test_r1_warmup_bounds_are_inclusive` (0 and n);
  `test_r1_a_withheld_result_reporting_a_warmup_is_integrity`;
  `test_r1_still_closed_an_unknown_key_beside_warmup_is_integrity`.
- conformance: `test_r1_conformance_a_real_t7b_response_decodes_and_verifies` checks that the
  client's request sha equals the captured one, both jobs are ok, the columns equal the closes,
  `warmup == {withheldBars: 3}` and the digest is the sealed one.
  `test_r1_conformance_one_flipped_byte_of_the_real_response_is_integrity` flips one byte in job 2:
  job 2 becomes integrity and job 1 stays ok.
- lane: `test_r1_the_lane_column_carries_the_runs_warmup`.
- admission: `test_r1_admission_and_runtime_column_fn_agree[11 states]` covers admitted, a
  verdict, verdict plus kill, killed, not-graded, stage, server-stage, unavailable, a malformed
  answer, absent, and raising. In every state the public answer equals the column function's
  raised (guard, sentence) and no service call is made.
  `test_r1_admission_refuses_an_unnamed_plot_and_rejects_an_unknown_lane` and
  `test_r1_the_underscore_names_stay_as_aliases` cover the rest.

Red on r0, green on tip:
- `python -B docs/pine/evidence/2026-11-04-w5-t11/redr0.py 86218da704 <both files>` writes r0's
  client, lane and fake, runs `-k r1`, and restores byte-exact: **28 failed, 4 passed**.
- The 4 that pass on r0 preserve r0 behaviour: withheld-with-warmup, unknown key and the flipped
  byte (r0 refused those answers too), and the underscore aliases (r0 has them).
- The tip passes everything: **157 passed** (`runs/w5t11/r1b-tip.log`).

Mutations (lock `dsk/heavy-mut.lock`; `mutate_pytest.py muts_r1.json`, made by `mkmuts_r1.py`;
log `runs/w5t11/r1b-mut.log`, a run on the final code): **TOTAL 18, KILLED 17, SURVIVED 1, and
the survivor is the no-op control**, as it must be.

| mutation | killed by |
|---|---|
| W01 warmup not a result key | `test_ok_run_returns_the_full_verified_column` |
| W02 extra keys admitted | `test_r1_a_warmup_that_is_not_exactly_a_bar_count_is_integrity[warmup3]` ({}) |
| W03 warmup not required | `...[absent]` |
| W04 bool bar count admitted | `...[warmup6]` (True) |
| W05 non-int bar count admitted | `...[warmup5]` (1.5) |
| W06 negative admitted | `...[warmup4]` (-1) |
| W07 past n admitted | `...[warmup8]` (n+1) |
| W08 withheld may report a warmup | `test_r1_a_withheld_result_reporting_a_warmup_is_integrity` |
| W09 not carried to JobResult | `test_r1_an_ok_result_carries_its_warmup` |
| W10 lane column without the warmup | `test_r1_the_lane_column_carries_the_runs_warmup` |
| A01 admission skips the stored verdict | `test_admitted_call_returns_the_plot_column` (and the agreement rail) |
| A02 admission skips server_lane_refusal | `test_admitted_call_returns_the_plot_column` |
| A03 column fn asks step 4 only | `test_admitted_call_returns_the_plot_column` |
| A04 unnamed plot admitted | `test_r1_admission_refuses_an_unnamed_plot_and_rejects_an_unknown_lane` |
| A05 unknown lane accepted | `test_r1_admission_refuses_an_unnamed_plot_and_rejects_an_unknown_lane` |
| I01 +/-Infinity admitted | `test_row10_an_infinite_value_is_integrity[inf]` |
| I02 only +Infinity refused | `test_row10_an_infinite_value_is_integrity[-inf]` |

r1 final-tip (lock `dsk/heavy-final2.lock`, tip `a74e273652`, tested on master `0afa7645dd`):
`bash $S/final-tip.sh pine-dsk-w5t11 dsk-w5t11r1-final tests/test_pine_runtime_client.py
tests/test_runtime_server_lane.py tests/test_pine_runtime_codec.py tests/test_script_engine_version_gate.py`,
log dir `_resume-2026-11-01/runs/dsk-w5t11r1-final/`.
- gate pytest: 46 passed (rc 0). Hygiene: clean (34615 files).
- rails pytest (both T11 files, T3 codec, engine-version gate): 374 passed.
- full chart+hooks vitest: Test Files 1 failed | 1334 passed | 27 skipped; Tests 1 failed | 22505 passed | 118 skipped. The only failure is `src/hooks/pollingSites.rail.test.js`, the known baseline. Nothing new.
- Engine bump: NO (Python only).

## r2 (review B1: the warm-up curtain is VERIFIED, not masked), code tip `20856aff67`
Finding (`dsk/reviews/W5-T11.md` B1, which the T13, T14 and T15 reviews also hit): r1 checked `warmup`
for shape only, so finite values in bars [0, withheldBars) could reach alerts, scans and backtests.
The ENGINE already blanks those bars to na (runtimeWarmupCurtain.test.js:42 on master), so the
engine stays the one authority. The client now VERIFIES the curtain and does not apply a mask
(coordinator correction; a mask would be a second curtain).

What changed:
- `pine_runtime_client._result`: after the decode and the digest check, if any served column holds
  a non-NaN value at an index below `withheldBars`, the result is `runtime:server-integrity`
  ("serves output `k` with a value inside its own warm-up"). The digest is still verified over the
  received bytes. NaN warm-up bars are na and pass through unchanged. `.warmup` stays on
  `JobResult` and on the lane column.
- `tests/fakes/pine_runtime_fake.py` answers as the engine does: NaN on bars [0, withheld_bars) in
  every column.
- Real T7b captures (`t7b_capture.py e13d282eae SOURCE OUT`, read-only `git show`, T7b's own server
  and pool):
  - `tests/fixtures/pine_runtime/t7b_response_echo.json` (stand-in bundle `echo`, withheldBars 0)
    is the POSITIVE conformance rail.
  - `t7b_response.json` (`warmup:3`: the stand-in bundle reports 3 withheld bars over FINITE
    closes) is now a NEGATIVE rail, and both jobs are integrity.
  - It was not recaptured from the real bundle, because that needs T7b's full tree and the T1
    build. The negative rail pins exactly the B1 shape.

Rails (`test_r2_*`):
- client: `a_finite_value_inside_the_warmup_is_integrity` (bar k-1);
  `batch_a_finite_warmup_value_withholds_that_job_only`;
  `any_served_column_is_checked_not_only_the_first`;
  `a_nan_warmup_is_accepted_and_finite_from_withheld_bars_on`; `withheld_bars_n_all_nan_is_accepted`;
  `withheld_bars_zero_needs_no_nan`;
  `conformance_a_real_t7b_response_with_finite_warmup_values_is_integrity`.
- lane: `the_lane_column_is_nan_on_its_warmup`; `a_finite_warmup_value_is_raised_never_returned`.

Red on r1, green on tip:
- `RED_K=r2 python -B redr0.py 1e384edbfe <both files>` writes r1's client, lane and fake, and
  restores byte-exact: **8 failed, 1 passed**. The pass is `withheld_bars_zero`, which r1 also
  satisfied.
- Tip: **166 passed** (`runs/w5t11r2/r2-tip.log`).

Mutations (lock `dsk/heavy-mut.lock`, `muts_r2.json` from `mkmuts_r2.py`, log
`runs/w5t11r2/r2-mut.log`): **TOTAL 5, KILLED 4, SURVIVED 1, and the survivor is the no-op
control**.

| mutation | killed by |
|---|---|
| V01 curtain not checked | `test_r2_conformance_a_real_t7b_response_with_finite_warmup_values_is_integrity` |
| V02 curtain checks one bar short | `test_ok_run_returns_the_full_verified_column` (and the k-1 rail) |
| V03 first column only | `test_r2_any_served_column_is_checked_not_only_the_first` |
| V04 curtain over-reaches one bar | `test_ok_run_returns_the_full_verified_column` |

Review notes N1-N6 are non-blocking and not changed in r2: the fake does not enforce the tf set, the
body size is unbounded per chunk, the owner key is shared with the service, a cache hit returns the
first caller's `.job`, the identity is re-read per call, and no rail drives the real T12 function.

r2 final-tip (lock `dsk/heavy-final2.lock`, tip `20856aff67`, tested on master `0afa7645dd`):
`bash $S/final-tip.sh pine-dsk-w5t11 dsk-w5t11r2-final tests/test_pine_runtime_client.py
tests/test_runtime_server_lane.py tests/test_pine_runtime_codec.py tests/test_script_engine_version_gate.py`,
log dir `_resume-2026-11-01/runs/dsk-w5t11r2-final/`.
- gate pytest: 46 passed (rc 0). Hygiene: clean (34618 files).
- rails pytest (both T11 files, T3 codec, engine-version gate): 383 passed.
- full chart+hooks vitest: Test Files 1 failed | 1334 passed | 27 skipped; Tests 1 failed | 22505 passed | 118 skipped. The only failure is `src/hooks/pollingSites.rail.test.js`, the known baseline.
- Engine bump: NO (Python only).

