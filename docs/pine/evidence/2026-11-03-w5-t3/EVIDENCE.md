# W5-T3 canonical column codec - evidence (final-tip, desktop)

- Branch: feat/pine-w5-t3-codec
- Tip judged: cd61d6741d (this evidence file is committed on top; it changes no code)
- Tested on master: 0afa7645dd216d861f2b0d3618d1c29eacc509f9 (merge-base with origin/master at run time)
- Engine bump: NO. The branch adds only columnDigest.js (new, called by nothing yet), pine_runtime_codec.py, their tests, the fixture and the design doc. No existing engine source is touched. SCRIPT_ENGINE_VERSION is unchanged (5 on this tree).
- Where it ran: desktop, heavy-lock lane 3 (heavy-final3.lock), label w5t3-final, in parallel with other heavy jobs on other lanes. Held 48.0 min. Logs: _resume-2026-11-01/runs/w5t3-final/ (gate.log, hyg.log, py.log, js.log).

## Command
bash docs/pine/parity-programme/scripts/final-tip.sh pine-dsk-w5t3 w5t3-final tests/test_pine_runtime_codec.py

## Numbers
| Check | Result |
|---|---|
| Deploy-gate pytest (4 files) | rc=0, 46 passed |
| Hygiene | rc=0, clean (34597 tracked files) |
| tests/test_pine_runtime_codec.py | rc=0, 211 passed |
| Full vitest chart+hooks | Test Files 1 failed / 1334 passed / 27 skipped (1362); Tests 1 failed / 22505 passed / 118 skipped (22624) |

Desktop baseline is exactly 1 failed vitest file, src/hooks/pollingSites.rail.test.js. The single failure is that file ("no NEW bare polling site..."). Nothing else failed, so no per-file re-run was needed. columnDigest.test.js passed inside the full run.

## Review round 2 fixes and their proof
Fixture tests/fixtures/pine_runtime/codec_parity.json (63 cases, 50 refuse inputs, 10 decode_refuse, 5 decode_accept, 13 equal groups) is read by both halves.
1. Design 2.3/3.2 byte layout matches the code: rail "the layout, hand-assembled from the header comment" (JS) and test_the_layout_hand_assembled_from_the_module_header (Py); engine block / runtime_language: "the fixture's engine block is accepted and is exactly the identity fields" (JS), test_fixture_is_shaped_as_the_js_half_reads_it and test_the_engine_identity_can_be_read_from_the_module_that_declares_it (Py).
2. Containers: only plain objects: "containers: only plain objects are accepted (a Map is refused, not read as empty)" (JS), test_only_plain_dicts_are_containers (Py); plus the fixture refuse list.
3. Column types accepted identically: "refuses what is not a number, an Array or a Float64Array" and "a hole in an Array is na" (JS), test_the_column_types_python_accepts_are_the_ones_js_accepts (Py).
4. rows: null = not given, non-negative integer only, bool is not one: "rows: null and undefined both mean not given..." and "rows, when given, is held against every column" (JS), test_rows_none_is_not_given_and_a_bool_is_not_a_row_count (Py).
5. bundle_sha256 must be a string: "bundle_sha256 must be a string..." (JS), test_bundle_sha256_must_be_a_string (Py).
6. Python takes a JSON integer past 2**53 only when exactly a double: test_an_integer_is_the_double_of_the_same_value_only_when_it_is_exactly_one (Py).
7. hexToBytes/bytesToHex moved to the test file (strict hex): not in the production module; exercised by every fixture-driven case in columnDigest.test.js.
8. Fixture writer fills only new cases and refuses in CI; decode_accept: "accepts every byte string the fixture lists as decodable, and re-encodes it to the same bytes" (JS) and its Py twin; refusal-list size guards test_the_refusal_list_is_not_trivially_short / test_the_decode_refusal_list_is_not_trivially_short; controls "the cases fall into exactly the declared equal groups" and "the check itself rejects a fixture that cannot distinguish".

Mutation proof from round 1 (laptop): JS 55 run / 54 killed / 1 equivalent-removed; Python 57/57. Not re-run on desktop; the round 2 delta has not been re-mutated here.

## Open items
- Delta review of round 2 (review file was not on origin/ops/pine-coord when this was written; fixes mapped from the round 2 commit message).
- Nothing calls the codec yet; no runtime behaviour changes.
