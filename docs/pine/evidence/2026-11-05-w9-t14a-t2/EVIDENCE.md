# W9-T14a + W9-T2 evidence

Branch `feat/pine-w9-t14a-t2`. Tested-on-master (merge-base): `04b49bd61e`. TIP (last non-docs commit, final-tip target): `876e677f56`.
Machine: desktop. Design: `docs/pine/W9-STRATEGY-DESIGN.md` r3 @59bf931484, review GO-WITH-NOTES. Rulings R10, R13 and the T2 pin-ledger, grading and floor rulings bind.

## Commits

| lane | commit | what |
|---|---|---|
| T14a | `b6115e9b4d` | `api/services/bars_window.py` (`HISTORY_WINDOW_BARS = 5000`); consumers read it; `tests/test_history_window_one_authority.py` |
| T2 | `2844ce3b54` | pin ledger (`brokerPins.json` / `.resolved.json` / `.lock.json` / `brokerPins.js` / `brokerPinsLock.js`), resolve step in `evidence_engine.py` (`pins`), `gradeStrategy` in `compare.mjs`, rails |
| T2 | `876e677f56` | the lock and freshness rails read a CRLF autocrlf checkout as the LF blob |

Engine bump: **NO.** T14a changes no value (5000 stays 5000) and touches no JS. T2 is dark: `pinned()` has no caller, and the lock's genesis entry `17` is the sha of the empty ledger. I did not edit `SCRIPT_ENGINE_VERSION`. The first real pin landing takes the coordinator's bump and a new lock entry plus the `COMMITTED_OLDER_DIGEST` constant in `brokerPinsLock.test.js`.

## T14a: one authority for the history window

Consumers of the window constant (all import `HISTORY_WINDOW_BARS` from `api.services.bars_window`, none holds the integer):

| consumer | before | after |
|---|---|---|
| `api/services/screener/scan_evaluator.py` (W5-T14's copy) | `_MAX_BARS = 5000` | **removed, not aliased (R10)**; the two `want` sites read `HISTORY_WINDOW_BARS` |
| `api/routers/screener_backtest.py` | `MAX_BARS_PER_SYMBOL = 5000` | `= HISTORY_WINDOW_BARS` (name kept: 15+ readers and tests) |
| `api/services/indicator_alert_evaluator.py` | `BARS_MAX = 5000` | `= HISTORY_WINDOW_BARS` |
| `api/services/alert_user_series.py` | `_SYMBOL_MAX_BARS = 5000`, `RUNTIME_WINDOW_DATE = 5000` | both `= HISTORY_WINDOW_BARS` |

`tests/test_alert_lookback_window.py` read `scan_evaluator._MAX_BARS`; it now reads the constant.
The T14 route does not exist yet; the rail's consumer table is where it gets added.

**R13:** `snapshot_builder.DEEP_BARS` is NOT folded in. It stays `5000` as its own literal; the false "matches the bars API ceiling" comment (the ceiling is 60,000, review N1) is replaced. The rail asserts DEEP_BARS is an int literal, is not imported from `bars_window`, and never names `HISTORY_WINDOW_BARS`.

**No measure-pair:** no JS, translator, runtime, C18 door or harness file changed, and the Python value is identical, so census, C18 and harness outputs cannot move. The proof is value identity (`test_at_runtime_every_consumer_sees_the_one_value`) plus the 330-test regression list below.

**E-3 (`tests/test_scan_evaluator_off_request_path.py`):** red on master `04b49bd61e` BEFORE this work, and red here, with the SAME offender set:
`/api/indicator-alerts -> indicator_alerts::create_alert` and `/api/indicator-alerts/current-value -> ::get_current_value` (via `alert_user_series` lazily importing `scan_evaluator._read_bars`, a W5-T13 landing). Measured by swapping the seven touched files for `git show HEAD:` and restoring byte-exact (`runs/w9t2/e3master.sh`, 1 failed 23 passed on master; 1 failed 23 passed on the tip). T14a adds no new offender. Fixing it is the W5-T13 owner's.

### Mutations (pytest, `muts-t14a.json`, runner `mutate_pytest.py`; log `runs/w9t2/mut14a.out`): 12 run, 11 killed, 1 control survived (expected)

| mutation | killed by |
|---|---|
| CONTROL no-op comment | survived (expected) |
| M01 restore `_MAX_BARS = 5000` in the sweep | `..._consumer_imports_the_window_and_never_restates_the_integer[scan_evaluator]` |
| M02 sweep sizes with a literal | same |
| M03 sweep drops the import | same |
| M04 backtest ceiling a literal | same `[screener_backtest]` |
| M05 backtest ceiling `HISTORY_WINDOW_BARS + 0` | `..._constants_are_bound_to_the_name_not_a_number` |
| M06 `BARS_MAX = 5000` | `[indicator_alert_evaluator]` |
| M07 `RUNTIME_WINDOW_DATE = 5000` | `[alert_user_series]` |
| M08 `_SYMBOL_MAX_BARS = 5000` | `[alert_user_series]` |
| M09 fold `DEEP_BARS` into the window (R13) | `test_DEEP_BARS_is_a_different_quantity_and_keeps_its_own_literal` |
| M10 second assignment in `bars_window.py` | `test_the_window_module_holds_exactly_one_assignment_of_the_literal` |
| M11 `bars_window` value 5001 | same |

(An early DEEP_BARS-drift mutation was dropped by design: DEEP_BARS's value is the screener owner's to move, so the rail pins its shape, not its number.)

## T2: pin ledger, lock and strategy grade

Rails that are new (red on master by absence, green on the tip): `RT/__tests__/brokerPinsLock.test.js` (19), `__tests__/vendorHarness/strategyGrade.test.js` (27), `tests/test_broker_pins_resolve.py` (16). `RT` = `app/src/components/chart/engine/runtime`.

- **Lock rule (`brokerPinsLock.js`, pure):** governing entry = greatest version <= `SCRIPT_ENGINE_VERSION`. Cases 1 (ledger change without a bump: red), 1b (bump without an entry: red), 2 (non-pin bump, no lock edit: green), 3 (pin landing: green), 4a/4b (older entry edited/removed: red), 5 (new entry not above every key, and a duplicate key: red). Key order is read from the file text, because JS objects reorder integer keys. Also: future entry, no governing entry, non-canonical ledger, non-numeric key.
- **Resolve (`evidence_engine.py pins [--check]`):** a rule is kept only when every committed ledger verdict of every one of its fixtures is MATCH. A fixture with no verdict, an empty fixture list or a malformed source is an error. Output is canonical JSON. Freshness rail reproduces the committed `brokerPins.resolved.json` from `brokerPins.json` plus the evidence ledger.
- **`pinned(ruleId, explicitSet)`:** the second argument is test-only. A source scanner (comments and strings stripped) refuses it in every non-test file of `app/src` (real walk, > 100 files).
- **Grade (`compare.mjs gradeStrategy`):** step 0 reads TradingView's captured count alone (floor 5: below it, UNGRADABLE, and `ours.trades` is never read, proven by a getter spy). Reference 6/ours 2 and 6/ours 9: DIVERGE naming the first unmatched fill by time and `rule`. 2/6, 0/0, 4/4: UNGRADABLE. 5/5 equal: MATCH. Expected refusal: EXPECTED-REFUSAL, other refusal: DIVERGE. Bars differ: INCONCLUSIVE. **A script with no literal settings (`strategy-settings:nothing-compared`) is NOT blocked;** a real disagreement or no `strategy()` declaration blocks. Method (b) signal identity, then trades joined on bar time (a fixture offset by 1,000 bar indexes still matches), prices to the tick, quantity exact, currency 1e-9 relative.
- Settings input is the `settingsAgreement` shape from the W9-T3 branch (`strategy_capture.mjs`, not on this base); `gradeStrategy` takes it as data, so T3 merging in either order is fine.

### Mutations (vitest `mutate.py`, pytest `mutate_pytest.py`; logs `runs/w9t2/mut-lock.out`, `mut-lock-s2.out`, `mut-grade.out`, `mut-py.out`)

Lock rail and `pinned()` (`muts-t2-lock.json`, `muts-t2-lock-s2.json`): 14 mutations + 2 controls; all 13 mutations killed, controls survived.
L1 exact-version lookup (case 1b/2 red) · L2 drop sha compare · L3 drop older digest · L4 drop out-of-order check · L5 drop canonical check · L6 drop future check · L7 order from the parsed object · S1 scanner never reports · S2 scanner scans test files (first run SURVIVED: the two skip alternatives overlapped in my fixtures; a `__tests__/helper.js` fixture was added and the rerun KILLED it) · S3 definition counted as a call · P1 `pinned()` ignores the explicit set · P2 a rule appears in the committed ledger without a lock entry (killed by the real-files test).

Grade (`muts-t2-grade.json`): G1 remove the floor, G2 floor applied to our count, G3 our count read in step 0 (spy), G4 join on index, G5 skip bar identity, G6 INCONCLUSIVE warm-up as MATCH, G7 INCONCLUSIVE bars as MATCH, G8 nothing-compared blocks, G9 expected refusal as DIVERGE, G10 skip signal identity, G11 qty not compared, G12 profit not compared: **12/12 killed**, control survived.

Resolve (`muts-t2-py.json`): R1 INCONCLUSIVE as MATCH, R2 missing fixture tolerated, R3 any-fixture pins, R4 non-canonical output, R5 unsorted: **5/5 killed**, control survived.

## final-tip (FULL scope, last, clean tree), TIP `876e677f56`, log dir `C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/w9t2/`

`rc gate=0 hyg=0 py=0 js=1`, `scope=full shards=1`, `totals=ok`, `errors=0`, `integrity=ok`.
- gate pytest: 46 passed. hygiene: clean (35621 files).
- py rails (330 passed): `test_history_window_one_authority`, `test_broker_pins_resolve`, `test_alert_lookback_window`, `test_alert_runtime_lane`, `test_scan_runtime_lane`, `test_scan_evaluator`, `test_screener_backtest_route`, `test_screener_backtest_def_id`, `test_evidence_engine`, `test_script_engine_version_gate`.
- vitest chart+hooks: Test Files 4 failed | 1363 passed | 28 skipped; Tests 4 failed | 23248 passed.
- failing files: `enumerationSites`, `settingsScope.rail`, `pollingSites.rail` (named baselines) and **`controlDoorCensus.test.js`, NOT in the baseline list and NOT ours**: "app/src/agent/guide/slots.js ... is not in BULK_BLOB_SITES". That file arrived with master commit `8b3022ed66` (agent lane), which is an ancestor of this branch's base, and this branch touches nothing under `app/src/agent`. It is master-red. `ready-check.sh` nevertheless printed READY-CHECK PASS at HEAD 13c7a073e4 (its allowlist regex is not what the log names); the owner of the agent lane should still add `slots.js` to BULK_BLOB_SITES. 
- `vendorHarness` did not fail this run. `coverageAudit` passed (no solo rerun needed). `test_vendor_batch_capture` was not in the rail list (its manifest baseline is master-red).
