# REAL-MODEL cap proof: a hard $8 aggregate for one bounded production canary run

Status: written by pl-auto, 2026-11-10. **No paid call was made to produce this document.** Nothing here writes or reads
the owner's `C:/UCT/agent-autotest-authorization.json`. The only files the owner writes are the two in section 1.

Harness commits on `agent/pl/autotest-2`: `86d446a3f9` (atomic ceilings, §3) and `5ad6acf02d` (AUDIT F1 scratch-world
rail §2a, F2 post-reply naming call §5). The commit that adds this revision changes only `docs/`. The set hashes below were
recomputed at `86d446a3f9` and at the doc commit, and they match: no request file changed.

## 0. Summary

| Question | Answer | Evidence |
|---|---|---|
| Is there one global cumulative ledger? | Yes, one SQLite file per machine: `C:/UCT/agent-eval-ledger.db`. Every paid tool reserves in it before the call. | §2 |
| Is reserve atomic across processes? | The ledger's own cap: **yes** (`BEGIN IMMEDIATE`). The autotest's $8 program and stage ceilings: **no, before `86d446a3f9`**. A race granted $9.25 against $8. **Fixed**: those ceilings are now summed inside the same transaction. | §3 |
| Are SDK retries off? Do harness retries reserve? | Yes, `max_retries=0`, and the ledger refuses any other client. Every harness-level retry makes new model calls, and each call reserves. | §4 |
| Is a failed or timed-out call settled at the worst case? | Yes. The only release is an HTTP error status (nothing is billed). | §4 |
| Is the production per-request cost bounded? | Yes: $0.25 per turn on the server, reserved per turn in the ledger, settled from the `spentToday` delta, else at the worst case. A request over its reservation writes the STOP file before the next call. | §5 |
| Is there a read-only total? | `python tools/agent_autotest_cap_status.py` | §6 |

**The binding number for this authorization is the canary stage's $0.50, not $8.** The authorization names only
`stages: ["canary"]`. That stage's budget is `STAGES["canary"] = 0.50` (`tools/agent_autotest_gate.py`, pinned to
`stages.mjs`), so the run cannot commit more than $0.50, even with $8 authorized. $8 stays as the program-wide hard backstop.

## 1. The owner's files (exact text)

### 1a. `C:/UCT/agent-autotest-authorization.json`

```json
{
  "approved_by": "owner",
  "max_usd": 8,
  "expires": "2026-11-12",
  "targets": ["production"],
  "stages": ["canary"],
  "public_set_sha256": "6846cf3d6b04afb8eba2f8b1b7c846ff6a77ae4848b305a00f9fa87ffb6db8f5",
  "heldout_sha256": "8ac6a1ed4e8323aee42a2bbf9a5b54f071ca71a208dbdbf54d54389641ced48f",
  "production_ack": "I accept that production runs on my account, against a disposable AUTOTEST layout only, and spends my production Agent budget."
}
```

- The hashes come from `cd app && node src/testing/agent/autotest/run.mjs --lint` at `86d446a3f9`, with `lintErrors 0`:
  - `publicHash` = public_set_sha256 (246 requests, 270 turns).
  - `heldout.sha256` = heldout_sha256 (the encrypted blob: 68 requests, 81 turns; key absent on this machine).
- If any request file changes, the hash changes and both guards refuse ("a different public request set"). In that case,
  re-run `--lint` on the commit that will actually run.
- `production_ack` must match byte for byte. It is the `PRODUCTION_ACK` constant in both `realGuard.mjs` and `agent_autotest_gate.py`.
- Expiry: `realGuard.mjs` allows the run until 2026-11-12T23:59:59Z. The gate allows it until local midnight ending 11-12.
  Both must agree, so the earlier one wins. Since `86d446a3f9`, expiry is re-checked on **every** production reservation.

### 1b. `C:/UCT/agent-eval-cap.json` (also required; it is absent today)

```json
{"cap_usd": 8.0}
```

The ledger refuses every reservation while this file is missing (`read_cap` → `LedgerRefused("cap_file")`). Writing it at
8.0 rather than 21.0 puts a **second, independent** $8 cap on the ledger itself. That cap covers every paid tool on the
machine, not only the autotest, so the $8 holds even if a gate ceiling had a bug. The file can only lower the code
constant `CUMULATIVE_CAP_USD = 21.0`; it can never raise it.

State today (from the read-only command in §6): the ledger, cap file, authorization and STOP files are all absent from
`C:/UCT`. No paid reservation exists on this machine yet.

## 2. The cap is global: one ledger, every caller

- **File:** `tools/agent_eval_ledger.py` holds `WINDOWS_LEDGER = C:\UCT\agent-eval-ledger.db`. The cap file is the sibling
  `agent-eval-cap.json`. There is no fallback path (not HOME, not the repo), so no worktree or session can start its own ledger.
- **No relocation, part 1:** the `UCT_AGENT_EVAL_LEDGER` override is honoured only when `PYTEST_CURRENT_TEST` is set. Anywhere else it
  raises `LedgerRefused("unavailable")`. An explicit `Ledger(path)` is refused outside pytest unless it is `readonly=True`,
  and a read-only handle refuses `reserve`.
- **No relocation, part 2 (AUDIT F1, `5ad6acf02d`): see §2a.**
- **Every paid caller goes through it.** The audit was a grep of `Anthropic(` across `tools/*.py` at `86d446a3f9`:
  - `agent_autotest_gate.py` (serve → `Session.caller` → `guarded_call`; production → `reserve_turn` → `reserve`)
  - `agent_eval_run.py`, `agent_live_batch.py`, `agent_latency_probe.py`, `agent_live_chain.py` and `agent_smoke_context_breadth.py`:
    each calls `preflight(...)` and `guarded_call(...)`, and builds its client with `max_retries=0`.
  - The two other hits are not calls. `_mutate_partner_fixes.py` holds string patterns and `llm_timeout_census.py` is a static census.
- **Node side:** `realGuard.authorize` → `python tools/agent_autotest_gate.py check` → the ledger. `realRelay.mjs` (local)
  only talks to `gate serve`, which holds the key and meters each call. `productionTarget.mjs` calls `gate reserve` before each
  request and `gate settle` after it. `isGranted()` WeakSet: neither relay can be built without the grant object.
- **Scope:** the ledger is global per machine. CI and other machines have no `C:/UCT/agent-autotest-authorization.json`
  (on POSIX the Windows `AUTH_PATH` is never a file), so the gate refuses there and no autotest paid run can happen anywhere else.

## 2a. AUDIT F1: a scratch ledger can never carry a paid call

**The hole.** `under_pytest()` is only `bool(PYTEST_CURRENT_TEST)`, so any plain process can set it. It can then point
`UCT_AGENT_EVAL_LEDGER` at a new file. The cap file is that file's sibling, and `UCT_AGENT_AUTOTEST_AUTH` / `_STOP` move the
authorization and STOP file the same way. The result is a fresh ledger with a fresh cap.

**The rail.** `ledger.refuse_paid_in_scratch(path, production=...)` (in `tools/agent_eval_ledger.py`) checks whether ANY
override is in force: one of `OVERRIDE_ENVS` = (`UCT_AGENT_EVAL_LEDGER`, `UCT_AGENT_AUTOTEST_AUTH`, `UCT_AGENT_AUTOTEST_STOP`),
or a ledger handle on a file other than the pinned one. If so:
- `Ledger.guarded_call` (every metered SDK call of every paid tool, and the gate's local `serve`) raises
  `LedgerRefused("unavailable")` **before reserving or calling** when `UCT_AGENT_EVAL_API_KEY` or `ANTHROPIC_API_KEY` is
  present. It checks presence only and never reads the value into anything.
- `gate.reserve_turn` (production, which is the `reserve` CLI) raises `Refused` **always**, with or without a key.
- `PYTEST_CURRENT_TEST` plays no part in either check. A scratch ledger is only ever used with a fake client and no key, and
  the pytest fixtures (`led`, `env`) now delete both key variables.

**Rail test:** `bypass()` in `tests/test_agent_autotest_cap_race.py`. It is a plain `python -c` subprocess, not under
pytest, that fakes `PYTEST_CURRENT_TEST`, sets all three overrides to a temp dir and sets a real-looking
`UCT_AGENT_EVAL_API_KEY`. The fake client raises without touching the network.

| case | guarded_call | reserve_turn (production) | fake client reached |
|---|---|---|---|
| rail in place, key set | refused | refused | 0 |
| rail in place, no key (control) | allowed | refused | 1 |
| **mutation:** both rail calls removed, key set | **ALLOWED** | **ALLOWED** | **1** → rail FAILS |

The mutation was run by editing the two call sites out, running the rail, then `git checkout --` the files. The no-key
control shows that the fake client is reachable, so the refusal in row 1 can only come from the rail.

## 3. Concurrency: atomic reserve

**Ledger cap (atomic before and after the fix).** `Ledger.reserve` runs `BEGIN IMMEDIATE`, takes SQLite's RESERVED write
lock (cross-process), sums open reservations plus settled actuals, compares the result with the cap, then INSERTs and
COMMITs, all in one transaction. `busy_timeout` is 30 s. Any other exception fails closed.

**The gap (now fixed).** The autotest's own ceilings, `max_usd` (program) and `STAGES[stage]`, lived in
`Ceilings.refuse()`. That was a `spent()` read **before** the reserve transaction. Two processes could both read
$7.80 and both reserve $0.25. Measured on the unfixed code (tree `70b3420a53` + the new test):

| race: 40 processes × $0.25 | ceiling | granted | committed |
|---|---|---|---|
| ledger cap file = 8.0 | $8.00 | 32 | $8.00 ✅ |
| program `max_usd` 8 (stage lifted to 8) | $8.00 | **37** | **$9.25** ❌ |
| canary stage (real) | $0.50 | **29** | **$7.25** ❌ |

**The fix (`86d446a3f9`, minimal):**
- `Ledger.reserve(..., limits=((prefix, usd), ...))`: inside the same `BEGIN IMMEDIATE`, each limit sums the rows whose
  `run_id` starts with `prefix` (exact `substr` match, not `LIKE`) and refuses with `run_cap`.
- `Ceilings.limits()` = `(("autotest-", max_usd), ("autotest-<stage>-", stage_usd))`. It is passed by `Session.caller`
  (via `guarded_call`) and by `reserve_turn`. `refuse()` stays as the fast pre-check and still holds the per-turn cap.

After the fix:

| race | granted | committed |
|---|---|---|
| ledger cap 8.0 | 32 | $8.00 ✅ |
| program 8 | 32 | $8.00 ✅ |
| canary stage | 2 | $0.50 ✅ |

**Test:** `tests/test_agent_autotest_cap_race.py`. There is no SDK, no key and no network. The scratch ledger, auth and stop
files are in a temp dir, and the children spin on a start file so they reserve at the same instant.
- Run it with `python tests/test_agent_autotest_cap_race.py`, which prints the three rows plus the overrun check, then `PASS`.
  It also collects under pytest as four `test_*` functions.

## 4. Retries and failures

- **SDK retries are off.** `agent_autotest_gate.serve` builds `anthropic.Anthropic(api_key=key, max_retries=0, timeout=30.0)`.
  `ledger.check_model` raises `LedgerRefused("unavailable")` if `client.max_retries != 0`, so a client with retries cannot be used.
- **Harness-level retries reserve.** The only harness retry is `run.mjs` / `selectionRun.mjs` re-running a request after
  "chrome did not come up". That happens in the browser before any turn, and a retried request's turns are new model calls.
  - **Local target:** each new call goes through `guarded_call` → `reserve` (worst case).
  - **Production target:** `runProduction` has no retry. Each request does `gate reserve`, then the request, then `gate settle`.
  - The server's own planner calls (at most `max_calls()` = 2 per request) are metered by the server's ledger and bounded
    by its `turn_cap_usd()` = $0.25.
- **A failed or timed-out call settles at the worst case.** In `guarded_call`, any exception except
  `anthropic.APIStatusError` (an HTTP error status: nothing generated, nothing billed) leads to
  `settle(rid, None, None, outcome="worst_case")`, which charges the full reservation. A missing `usage` also charges the
  worst case (`no_usage`), and the gate STOPs on it.
  - If a settle itself fails, the row stays `reserved`, which still counts at the worst case.
  - A crashed run's reservation is never auto-released; only the owner can release it, with `release --confirm`.
- **Three API errors in a row** (`after_error`) and **two refusal/max_tokens stops** also STOP.

## 5. The production target

- **AUDIT F2: calls after the reply.** Yes, there is one. When a chat is still unnamed and the turn gave no title, the
  router queues `background.add_task(_name_unnamed, uid, cid, request_id)` (`api/routers/uct_agent.py:675`). It runs AFTER
  the response is sent and makes one naming model call (`turn.name_conversation` → `meter.call(..., "title", ...)`,
  `api/services/uct_agent/turn.py:1852-1870`) through `budget.Meter(user_id, request_id)` (`budget.py:490`, `reserve` at
  `budget.py:360`).
  - That call belongs to the SAME request: it sits inside the request's $0.25 turn cap and its 2-call ceiling, both checked
    in the reserve transaction (`budget.py` header).
  - The other post-reply tasks (`_set_title`, `record_telemetry`) make no model call.
  - **Fix (`5ad6acf02d`):** after the b1 read, `productionTarget` waits `SETTLE_DELAY_MS` (10 s), reads b2 and settles at
    `max(b1 − b0, b2 − b0)`. A missing b2, or b2 < b1, settles at the worst case.
  - Because the server counts an open reservation in `committed_usd`, a naming call that has started by b2 is counted at its
    worst case even if it has not finished.
  - Residual: a naming call that has not even reserved 10 s after the reply would be missed. That miss is bounded by the
    request's own $0.25 turn cap, which is the harness's reservation, and any such miss is also covered by the server's own
    daily cap.
- **Per-request bound.** The server caps each turn at `DEFAULT_TURN_USD = 0.25` with at most 2 calls (`api/services/uct_agent/budget.py`).
  The harness reserves `0.25 × turns` per request in the eval ledger (`86d446a3f9`; it was a flat $0.25, which under-reserved
  multi-turn requests). Every canary request is single-turn: 12 requests, all with 1 turn.
- **Settle.** The harness reads `/api/agent/budget` `committed_usd` before and after the request. That value is the server's
  settled actuals plus its OPEN reservations, so an in-flight call counts at its worst case. The request settles at `b1 − b0`.
  It settles at the **worst case** (the reservation) when:
  - either read failed, or
  - the delta is negative (the server's ET day rolled over; previously `Math.max(0, …)` settled this at $0), or
  - the request crashed or timed out (previously a timed-out turn could still be spending after the second read).
- **A turn over its reservation, or over the anomaly line.** `gate settle` records the real figure (a ledger settle over
  the reservation is flagged `over_worst_case`, never clipped). If the charge is over `ANOMALY_TURN_USD = 0.10`, it writes
  `C:/UCT/agent-autotest-STOP.json` and exits 2.
  - `productionTarget` breaks the loop on a non-zero settle. Every later `reserve`, `check` and `serve` refuses while the
    STOP file exists, and only the owner deletes it.
  - Because the reservation is $0.25, any request over its reservation is also over $0.10, so **the run stops before the next call**.
  - Shown by the test: settle $0.30 → rc 2 → STOP file exists → next reserve rc 2 "a stop is in force".
- **Worst-case exposure of this authorization:** min($8 program, $0.50 canary stage, ledger cap $8).
  - The real stop comes earlier: at about $0.02 per turn, 12 requests are about $0.24.
  - One request settled at the worst case ($0.25 > $0.10) STOPs the run, so the most that can be committed is the requests
    before it plus $0.25, within $0.50.
  - Overshoot past a ceiling is impossible at reservation time. After the fact, it is bounded by one request's server-side
    cost over its reservation, and the server caps that at $0.25 per turn.
- **Note:** a crash or timeout now settles at the worst case and so STOPs the canary. That is deliberate (fail closed), but a
  flaky Chrome start will end the run early.

- **AUDIT F3 (accepted):** the STOP-file check runs before the reserve transaction, not inside it. A reservation already
  in flight when a STOP is written is still bounded by the atomic ceilings of §3.

## 6. Read-only total

```
python tools/agent_autotest_cap_status.py
```

- Opens the ledger with sqlite `mode=ro`. A missing file is reported, never created. (By contrast, `agent_eval_ledger.py status`
  and `agent_autotest_gate.py status` create the ledger file and schema if it is absent.)
- Prints: total committed (open + settled), program committed (`autotest-*`), per-stage committed, cap file value, code cap,
  `ledger_remaining_usd`, `program_remaining_usd`, the authorization's `max_usd` / `expires` / `targets` / `stages`
  (never the hashes or the ack), and whether a STOP is in force.
- Dollars and counts only. It writes nothing and makes no call.

## 7. Not done (deliberately)

- No paid call. No `C:/UCT` file was written.
- pytest was not run under this worker's rules. The new test was run directly at `5ad6acf02d`:
  `python tests/test_agent_autotest_cap_race.py` → race 32 / 32 / 2, overrun STOP, bypass rail, then PASS.
- Existing pytest files edited without running them:
  - Fixtures `led` (`tests/test_uct_agent_eval_ledger.py`) and `env` (`tests/test_agent_autotest_gate.py`) now delete the
    key variables.
  - `test_production_reservation_holds_a_whole_turn...` now books through `Ledger.reserve(limits=Ceilings.limits())`,
    because `reserve_turn` refuses in a scratch world.
  - New `test_production_never_books_into_a_scratch_ledger`.
  - The env-read rail (`PROD_KEY_ENV` read once) still holds: the new presence check reads through a loop variable over
    `KEY_ENVS`. **AUDIT should run these pytest files.**
