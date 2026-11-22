# W9-T14 Server-side strategy backtests: evidence (2026-11-07)

Branch `feat/pine-w9-t14-server-backtests`, based on origin/master `d0a29bbf24` (engine 30 lineage, T1 + T14a + T11 + W5 lanes on it).
Spec: `docs/pine/W9-STRATEGY-DESIGN.md` (branch `docs/pine-w9-strategy-design`) sections 2, 3.1, 3.2, 3.4, 4 T14, 6.
Delegated rulings used: D5 (separate route, the screener backtest's plan gate, multi-symbol capped like `max_cells`), D2 (state the start).
Light phase only: no mutate.py, no measure-pair, no final-tip, no heavy lock. Built DARK; no flag, env var or Railway setting touched.

## What changed

| file | change |
|---|---|
| `services/pine_runtime/protocol.mjs` | `STRATEGY_WANT = '#strategy'`, `STRATEGY_PROFILE = 'backtest'`. A job naming `#strategy` under any other profile is a 400 schema refusal. Ok results may carry `strategy` (JSON text); the seal checks it with the bundle's ONE shape check (`strategyRecordShapeErrors`), refuses not-asked / both-served-and-refused / neither / not JSON / not an object / lone surrogate / a bundle with no checker / `#strategy` as a column, and adds `strategy_sha256`. The T3 digest, codec, codec-parity fixture and HP-6 are unchanged. |
| `services/pine_runtime/job.mjs` | `#strategy` is never a column. The run's own record (`rt.runtimeStrategyOf`) is written as JSON text; no record = `{key:'#strategy', guard:'runtime:server-output-absent'}`; a record holding NaN / Infinity / undefined (which JSON.stringify would turn into null or drop) withholds the job as `runtime:server-integrity`, naming the path. |
| `services/pine_runtime/server.mjs` | `loadBundle` hands the seal the bundle's `strategyRecordShapeErrors` (null if absent: the seal then refuses any record; boot unchanged). |
| `app/.../runtime/serverEntry.js` | re-exports `runtimeStrategyOf`, `strategyRecordShapeErrors`, `STRATEGY_RECORD_SCHEMA` (no logic). The broker gate is NOT registered on the service. |
| `api/services/pine_runtime_codec.py` | the record codec: `STRATEGY_WANT`, `STRATEGY_RECORD_SCHEMA`, `STRATEGY_WINDOW_HISTORY`, `STRATEGY_START_GUARD` (mirrors, railed against the JS sources), `strategy_record_sha256`, `decode_strategy_record` (hash over the received bytes first, NaN/Infinity refused, object + schema tag). |
| `api/services/pine_runtime_client.py` | `Job.history_window_bars` (sent only when stated, positive int, never defaulted: every existing body and cache key byte-unchanged); results may carry `strategy` + `strategy_sha256`, verified, else integrity; `JobResult.strategy`; `refusal_for('#strategy')`. |
| `api/routers/pine_strategy_backtest.py` (new) | `POST /api/pine/strategy-backtest`. Window = `bars_window.HISTORY_WINDOW_BARS` (imported). Reuses W5-T15's admission, status map, bar-time rule and `max_cells`. `historyFromListing` always false (nothing proves bars.db reaches a listing); every answer states its window start and D2's sentence. Per-symbol record or refusal by name; transport refusals mapped by W5-T15's table; a record describing another window = 500. |
| `api/main.py` | mounts the router unconditionally (so E-3 walks it); dark inside. |
| `api/routers/screener_backtest.py` | W5-T15's descriptor path refuses a strategy-stamped document `runtime:strategy-start` (409) after admission, before plot questions. |
| tests | `services/pine_runtime/test/strategy.test.mjs` (8), `runtime/__tests__/w9T14ServerRecord.test.js` (4), `tests/test_pine_strategy_backtest.py` (~40), fixture `tests/fixtures/pine_runtime/w9t14_strategy_result.json`; `seal.test.mjs` and `serverBundle.rail.test.js` updated for the intended closed-set / export-surface change; `test_history_window_one_authority.py` now lists the route. |

## Served vs refused by name

- Served: the run's own `strategy` record, verbatim, with its window. In practice today nothing serves:
  - the service's broker gate is off: a strategy document refuses `pine:strategy-call` (real-bundle rail);
  - with the gate on, the route's window is never proven to reach the listing, so the broker refuses `runtime:strategy-unsettled` (Q-S1n), with the start stated;
  - with the listing proven, the empty pin ledger stops the run `runtime:strategy-unpinned`.
- T14 decides no sizing, cost or fill (T4-T8). Settings the broker does not serve stay `null` in the record, named in `unserved`.
- Route refusals: 404 dark (server stage admits nobody), 401, 402 `Strategy backtesting requires a paid plan`, 404 unknown def, 409 `runtime:not-runtime` / `runtime:not-strategy` / admission guards, 413 the D5 cap, per symbol `runtime:strategy-no-bars`, and every script refusal by its own guard. 503/500/409 for transport, per W5-T15.

## Dark

- `_require_open` answers 404 to anyone `runtime_definitions.server_permitted` does not admit. With `PINE_RUNTIME_SERVER_STAGE` / `PINE_RUNTIME_STAGE` unset that is everyone, admins included (rail without monkeypatching the stage). That happens before the plan gate and before any read.
- Past that come the owner admission chain (kill list, graded allowlist, both stages, service configured) and the service's broker gate (off).
- Rail: no `services/pine_runtime/*.mjs` names `registerStrategyBrokerGate` / `strategyBrokerEnabled` / `VITE_PINE_STRATEGY_BROKER_ENABLED`, and the bundle exports no setter.

## Results

- Service suite, Node 24.13.1: `node --test --test-reporter=tap "services/pine_runtime/test/**/*.mjs"` gives 139/139 pass, HP-7 included (6 HP-7 lines ok).
- `node tools/pine_runtime_host_parity.mjs --host node --check`: `HP-1 GREEN: 166/166 cases equal the committed digests`.
- `node tools/pine_runtime_closure.mjs --check`: host-neutral, 0 findings.
- Vitest, Node 20.20.2, `--maxWorkers=1`:
  - targeted: w9T14ServerRecord 4/4; serverBundle.rail + hostNeutralClosure 22/22.
  - full `src/components/chart/engine/runtime`: 3279 pass, 6 fail. One failure was the intended export-list change in `serverBundle.rail`, now updated and green. The other five are `*.measure.test.js` corpus harnesses (guardProbe, objectLaneCallSites, objectLaneCensus x2, objectLaneDrawerCensus) timing out at 15 s; they are measurement harnesses and touch nothing this lane changed.
- Host parity of the record, from the real server surface:
  - `job.mjs` on `serverEntry.js` serves exactly the browser run's record (deep-equal and byte-equal JSON);
  - the sealed answer equals the committed fixture byte for byte;
  - the Python client decodes the fixture to the same record, and one changed byte is integrity;
  - an off-listing window refuses by the same guard and sentence on both hosts.
  - The fixture's record comes from a test-only all-pinned ledger (vi.mock in `__tests__`, as W9-T11 does); no product code takes a pin set.
- E-3: the census walks 1981 handlers (master 1980), and the new handler `api.routers.pine_strategy_backtest::run_strategy_backtest` is among them and cannot reach the sweep (railed).
  - The E-3 gate test itself is red on master and here with the same two offenders, `/api/indicator-alerts` and `/api/indicator-alerts/current-value`. Neither belongs to this lane.
- Pytest touched and neighbouring files: 1048 pass, 10 fail. All 10 reproduce on a clean origin/master worktree, so they are baseline, not this lane:
  - E-3 gate (indicator_alerts);
  - `require_paid` distinct sentences (duplicate "The screener requires a paid plan");
  - `async_routes_do_not_block` (`_massive_card_logo`, chart_iq, trade_exchange_news);
  - 5 `rate_limit_policy` census tests (chart-iq, brand routes);
  - `auth_surface_reads` (brand / catalysts reads).
  - The new route raises none of them: `/api/pine/*` is covered by a declared family, and its 402 sentence is unique.
- `tests/test_pine_strategy_backtest.py` + `test_history_window_one_authority.py`: 44 pass.

## Hand mutations

Method: copy, mutate, run, restore by copy, cmp. 22 of 22 killed; the control survived; cmp ok each time; the tree is clean afterwards. Log: `_resume-2026-11-01/runs/w9-t14/mut.log`.

| id | mutation | result |
|---|---|---|
| C0 | comment edit (control) | SURVIVED |
| P1 | route reads `get_bars(..., 5000)` literal | KILLED |
| P2 | route sends no window | KILLED |
| P3 | route claims listing when bars < window | KILLED |
| P4 | dark gate removed | KILLED |
| P5 | transport refusal served as a per-symbol answer | KILLED |
| P6 | window one-authority check removed | KILLED |
| P7 | D5 cap ignores max_cells | KILLED |
| P8 | strategy stamp check removed | KILLED |
| P9 | descriptor-path strategy-start refusal removed | KILLED |
| P10 | codec hash check removed | KILLED |
| P11 | codec admits NaN | KILLED |
| P12 | client accepts a record not asked for | KILLED |
| P13 | client accepts a bad window value | KILLED |
| P14 | guard mirror drifts from broker.js | KILLED |
| S1 | protocol lets any profile ask for `#strategy` | KILLED |
| S2 | seal skips the shape check | KILLED |
| S3 | seal accepts asked-but-neither | KILLED |
| S4 | seal hashes the wrong bytes | KILLED |
| S5 | adapter serves a NaN record | KILLED |
| S6 | `#strategy` treated as a column | KILLED |
| S7 | adapter skips the value-fault walk | KILLED |
| S8 | seal accepts a record not asked for | KILLED |

## Engine bump: no

- Translator output and door outcomes are unchanged.
- The pin ledger is untouched.
- HP-1 is 166/166 against the committed digests.
- The bundle bytes move only by the three re-exports, so `bundle_sha256` moves as it does for any service change.

## Open, for the coordinator / owner (not decided here)

1. **How the service learns the broker flag at arming.**
   - W9-T11's review N6 proposed registering the gate in the server bundle and adding `VITE_PINE_STRATEGY_BROKER_ENABLED` to `SERVER_BUNDLE_VITE_NAMES` / `ENV_ALLOWLIST`.
   - That contradicts W5-T2 H3 and its rails: `serverBundle.rail` requires the bundle to read no `VITE_*` name, and `pine_runtime_closure` forbids build gates in the closure.
   - T14 therefore keeps the service dark by construction. The arming mechanism (for example a door-side reader at worker boot) is a decision for when arming happens (D6).
2. **`historyFromListing` on the server.**
   - Nothing proves bars.db reaches a listing (design section 9, item 5), so the route always sends false.
   - The broker then refuses Q-S1n by name until that capture rules or a listing proof exists.
3. **Background receipts are not wired.**
   - v1 is inline only, capped at `min(INLINE_MAX_SYMBOLS, max_cells() // HISTORY_WINDOW_BARS)` (50 at the defaults).
   - The screener receipt cache is shared across members, so reusing it for per-member strategy records needs its own privacy ruling.
4. **The guard `runtime:strategy-no-bars` is new.** It is honest-none for a symbol with no stored bars.

## r1 (2026-11-07, review `reviews/W9-T14.md` GO-WITH-NOTES @f8f0363276)

Rails added (tests only; no product file changed):

- **N1 / G3:** `test_r1_G3_the_REAL_stage_is_asked_with_the_callers_own_role_and_id`. This uses the real `server_permitted` (no stand-in) at `admins`/`admins`. A member gets 404 and reads no bars; an admin passes.
- **N2 / W1:** `test_r1_W1_a_record_starting_on_another_bar_is_a_500`, parametrised with start shifts of +1 day, -1 day and +1 s. Each gives a 500 `runtime:server-integrity`.
- **Coordinator item 2 / N3:** `test_r1_arming_the_shared_server_stage_does_not_make_a_strategy_run`. Setup:
  - both stages at `all`, the script graded and the service configured;
  - the REAL admission chain and the REAL client;
  - a transport replaying the service's REAL sealed gate-off reply, `tests/fixtures/pine_runtime/w9t14_dark_result.json`. It is written and byte-checked by a new case in `w9T14ServerRecord.test.js` from `serverEntry.js` over the route's own ctx (no listing, window 5000).

  Result: the route answers `pine:strategy-call` by name, with the start stated and no record. The one request it sent asked for `#strategy` over `HISTORY_WINDOW_BARS` with `historyFromListing: false`.

Mutants (copy, mutate, run, restore by copy, cmp; log `runs/w9-t14/mut-r1.log`):

| id | mutation | result |
|---|---|---|
| C0 | comment (control) | SURVIVED |
| G3 | the gate passes `"admin"` instead of the caller's role (the reviewer's) | KILLED |
| W1 | the window check drops the `startTime` compare (the reviewer's) | KILLED |
| D1 | `pine:strategy-call` treated as a transport refusal | KILLED |

Results on tip (origin/master `d0a29bbf24` merged; already up to date):

- Service suite, Node 24.13.1, glob form: 139/139, HP-7 ok.
- `pine_runtime_host_parity.mjs --host node --check`: HP-1 GREEN 166/166.
- Router and codec pytest (strategy backtest, one-authority, client, codec, result integrity, screener backtest runtime, server lane): 462 passed.
- Vitest `src/components/chart/engine/runtime` (Node 20.20.2, `--maxWorkers=1`): 3282 pass, 4 fail. The 4 failures are only the `*.measure.test.js` corpus harnesses timing out at 15 s, as in r0. `w9T14ServerRecord` is 5/5.

Engine bump: no.

## Heavy steps (2026-11-07, on code tip b9dfa37d0d)

### mutate.py

- Run under `dsk/heavy-mut.lock`: free at launch, not queued, RAM 16.8 GB. Released after 66 s.
- Muts file: `runs/w9-t14/muts.json`. Tests: `w9T14ServerRecord.test.js` and `serverBundle.rail.test.js`.
- Result: 8/8 killed; the control V0 survived.

| id | mutation | result |
|---|---|---|
| V1 | the record reader is not exported | KILLED |
| V2 | the shape check is not exported | KILLED |
| V3 | the record text is not compact | KILLED |
| V4 | the seal hashes the wrong bytes | KILLED |
| V5 | `#strategy` is treated as a column | KILLED |
| V6 | no record is written | KILLED |
| V7 | the seal checks `{}` instead of the record | KILLED |
| V8 | `want` is ignored | KILLED |

- Worktree HEAD unchanged and clean afterwards.

### measure-pair

- Run under `dsk/heavy-mp3.lock` with `ram_gate`, 71.8 min; logs in `runs/w9-t14/mpr/`.
- Base `pine-dsk-mpbase3` was clean and was detached at the merge-base `d0a29bbf24` inside the lock.
- HEADs were asserted before and after each side, and none moved.

| runtime | captures (tip = base) | C18 out | probe | harness | census |
|---|---|---|---|---|---|
| rt0 | MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140 | 395 rows, 0 differ | 69 rows, 0 differ | identical | 967 rows, 2 differ |
| rt1 | MATCH 112 / DIVERGE 107 / INCONCLUSIVE 117 | 395 rows, 0 differ | 69 rows, 0 differ | identical | 967 rows, 1 differ |

### Census movers (3 rows, 0 unintended)

All three are NOISE: each row's differing field is a `pine:timeout` translation-budget stop, which is wall-clock. Runtime attach is unchanged on both sides (`attached: false`, same guard).

- rt0, `ai-supertrend-x-pivot-percentile-strategy-presenttrading`: peel `stuck pine:roundtrip` vs reached. The row carries `pine:timeout` budget stops on both sides.
- rt0, `volatility-coil-edge-bullbyte`: dropHeads ordering from `pine:timeout`. This is the known timeout jitter, already seen in W4-T14.
- rt1, `multi-timeframe-trend-indicator`: a `pine:timeout` refusal at line 158 vs null; the budget stop landed at a different point.

### After the heavy steps

- origin/master has not moved (`d0a29bbf24`); the merge is a no-op.
- Service suite (Node 24, glob form): 139/139.
- Router and codec pytest: 49 passed.
- Vitest `w9T14ServerRecord` + `serverBundle.rail`: 13/13.
