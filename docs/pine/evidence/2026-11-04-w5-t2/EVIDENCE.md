# W5-T11 client + lane adapter: evidence

Lane: W5-T11 (docs/pine/SERVER-RUNTIME-DESIGN.md section 7, P2 T11), desktop machine.
Branch `feat/pine-w5-t11-client`, stacked on W5-T3's tip `409456ee36` (T3 not merged yet; merge
origin/master in once it is). Tested on master `@MASTER@` (merge-base with origin/master).
Code tip checked: `@CODE@`. Local only: no Railway, no flags, no network in any rail (every request
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
1. **T7's job results carry no `digest`** (`job.mjs::encodeResult` on `feat/pine-w5-t7-pool`), but
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
@TOTALS@

## Rails red on base, green on tip
`python -B docs/pine/evidence/2026-11-04-w5-t11/redbase.py tests/test_pine_runtime_client.py
tests/test_runtime_server_lane.py` removes the three new modules (as on base 409456ee36), runs
pytest, restores byte-exact: @REDBASE@. Every test in both files is red on base (collection
ImportError) and green on the tip (@TIPCOUNT@).

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
and asserts each `old` occurs once.) @MUTRESULT@

Round 1 (`runs/w5t11-mut/mut.log`) left 3 survivors besides the control, all masked by a SECOND
check rather than unguarded: C02 (no URL: the transport call still failed inside the `try`, so the
withhold was right for the wrong reason; the rail now asserts the sentence names the URL), C17 (the
column length was checked twice, by the decode and again by the digest's `rows=n`; the digest no
longer re-checks rows, so the decode is the one length authority), C23 (a withheld result with no
reason also broke its digest; the rail now re-digests honestly). Round 2 re-ran all 63.

@MUTROWS@

## final-tip
Command: `bash $S/final-tip.sh pine-dsk-w5t2 dsk-w5t2-final tests/test_script_engine_version_gate.py`, lock
`dsk/heavy-final3.lock`, tip `073806c4b4` (code identical to every later commit; only this file differs), tested on
(T1's) master `5d95103c8a`. Logs `_resume-2026-11-01/runs/dsk-w5t2-final/` and `runs/w5t2/finaljob.log`.
- gate pytest (4 files): 46 passed. `tests/test_script_engine_version_gate.py`: 6 passed. Hygiene: clean (34,676 files).
- full chart+hooks vitest: Test Files 1 failed | 1335 passed | 27 skipped (1363); Tests 1 failed | 22380 passed |
  118 skipped (22499). The only failure is `src/hooks/pollingSites.rail.test.js`, the desktop baseline (96582cd549 is
  not in this tree, so settingsScope is not expected red). Both W5-T2 rails passed inside the run.
- In the same hold: `pine_runtime_closure.mjs --check` 0 findings (64 modules); HP-1 on the final tip's bundle
  (1,829,141 B, 69 modules) **GREEN 166/166** (`runs/w5t2/hp1.log`).
- No `app/dist` or `app/dist-server` was created in the worktree (bundles were built into a scratch dir).

## Open items
- T7/T8 must add `digest` to every job result (finding 1) before T13 can get an `ok` answer.
- Infinity ruling (finding 3).
- `t` units: `bars_sqlite` daily `ts` is YYYYMMDD; the client only requires finite, strictly
  increasing numbers. Converting to the runtime's time base is T13/T14's (the lanes own bars).
- The web pod's identity needs `app/dist-server/pine-runtime.mjs` (T1) in the web image; until then
  `caller_identity()` is None and every run is withheld `runtime:server-unavailable`.
- Logs: `_resume-2026-11-01/runs/w5t11-mut/` (tip.log, redbase.log, mut.log, tip2.log, redbase2.log,
  mut2.log) and `_resume-2026-11-01/runs/dsk-w5t11-final/`.
