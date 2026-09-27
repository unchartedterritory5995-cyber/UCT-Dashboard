---
id: d5-cp4-build-record
unit: CP4
packet: d5-reference-corp-actions-pre-implementation-gate
merges-after: d5-cp3-build-record
status: SIGNED (CP4, fingerprint 51e4434d0)
---

# D5 CP4 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-18)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  51e4434d0
SCOPE APPROVED:   CP4 ONLY -- the checkpoint(s) named here and nothing else in the packet.
```

> **D5 CP4 — the split list, DARK.** Named explicitly by the owner's session
> prompt as one of "the six" units to build this session, in dependency order
> after CP3. The gate's own table (line 191) declares CP4's scope: *"The split
> list, DARK. `bars_sanitize._fetch_meta`'s FMP call is dual-computed against
> D5's ledger: both computed on every call in test and on a sampled fraction in
> production, log-only, never raising, serving the legacy value."* Size **M**.
>
> ⚠️ **Inert-strand risk — the packet flags this YES, this build record's own
> measurement says NO.** The packet's table (line 191) says *"YES —
> `bars_sanitize.py` is an INERT STRAND (flow-worker RUNS it, does not WATCH
> it). Must be classified live-or-incidental BEFORE merge; if live, a marker
> bump and an after-hours window."* Section 0 below is that classification,
> done by tracing the real import chain rather than trusting the packet's flag
> — and it resolves to **INCIDENTAL**, not live. No marker bump, no after-hours
> window.

## 0 · Inert-strand classification — INCIDENTAL, not LIVE (done before writing code)

`tools/flow_worker_watch_coverage.py`'s own static reachability confirms
`api/services/bars_sanitize.py` is in flow-worker's import closure
(`reachable=True`) but not in its watched-file list (`watched=False`) — the
packet's flag is correct as far as it goes. What it does not say is whether
flow-worker's process ever actually *executes* the code this checkpoint
touches, which is the fact that decides live-vs-incidental.

Traced the real edge, not assumed it:

```
api.flow_worker_main -> api.flow_gap_autofill -> api.services.liveflow_monitor
  -> api.services.bars_fetch -> api.services.bars_sanitize
```

- `flow_gap_autofill.py` is entirely about the OPTIONS FLOW tape (`flow.db`
  gap-healing from T+1 flat files) — unrelated to price bars. It imports
  `liveflow_monitor` for session/calendar helpers.
- `liveflow_monitor.py`'s ONLY reference to `bars_fetch` is
  `from api.services.bars_fetch import _NYSE_HOLIDAYS_YYYYMMDD` — a single
  constant, not a function call. Importing that constant still executes
  `bars_fetch.py`'s own top-level module code (that edge is real), but it does
  **not** reach `bars_sanitize.py` at all, because —
- Both references to `bars_sanitize` inside `bars_fetch.py`
  (`_fmt_sqlite_bars`'s serve-time formatter, and the cold-fetch deep-history
  block) are **function-local** imports
  (`from api.services.bars_sanitize import sanitize_daily_bars`), not top-level
  ones. A function-local import only executes when that specific function is
  called — and `liveflow_monitor.py` never calls either of them; it reads one
  constant and stops.

**Conclusion:** flow-worker's process imports `bars_fetch.py`'s top-level code
(for the holiday constant) but never actually loads `bars_sanitize.py` at all,
because the two call sites that would trigger it are private, chart-serving
functions (`_fmt_sqlite_bars` and the deep-fetch orchestrator) that only
`web`/`bars-api`'s `/api/bars/{ticker}` request path calls — flow-worker does
not serve that route. This checkpoint's change sits entirely inside
`_fetch_meta`, one level further from flow-worker than even those two
call sites. **INCIDENTAL**, per the packet's own vocabulary: reachable by
static analysis, never invoked by flow-worker's real code paths.

## 1 · What this builds

- **`api/services/reference_corp_actions.py::read_confirmed_splits(ticker, *,
  db_path=None)`** — the ledger's first real reader (CP3's own docstring:
  "NOTHING READS THE LEDGER YET... CP4's dual-compute... are later checkpoints
  that will read from here"). Returns `(execution_date, ratio)` tuples, the
  same shape `_fetch_meta` already builds from FMP, so a caller can compare
  like-for-like. Read-only; never raises (a missing ledger, a locked file, or a
  corrupt DB all return `[]`).
- **`api/services/bars_sanitize.py`** — `_dual_compute_outcome(fmp, d5)`: a
  pure, total function mapping any pair of split lists to one of five named
  outcomes (`BOTH_EMPTY` / `AGREE` / `FMP_ONLY` / `D5_ONLY` /
  `PARTIAL_MISMATCH`) — never a rate, per the packet's own scope language.
  `_dual_compute_splits(ticker, fmp_splits)`: best-effort, log-only, called
  from `_fetch_meta` right before it returns. Runs unconditionally under
  pytest (`PYTEST_CURRENT_TEST` in `os.environ`); outside pytest, sampled at
  `D5_CP4_DUAL_COMPUTE_SAMPLE_RATE` (env, default `0.05`) to bound the extra
  SQLite read this adds to a hot serve-time path.
- **`_fetch_meta`'s return value is untouched.** FMP stays the value of record;
  CP7 is the later checkpoint that makes a member-visible call on which source
  wins for the `AdjustmentBasis` label.

## 2 · Controls

```
python -m pytest tests/test_bars_sanitize_d5_cp4_dual_compute.py
                  tests/test_reference_corp_actions.py
                  tests/test_bars_sanitize.py
                  tests/test_bars_sanitize_warm_backoff.py -q
                                                          35 passed, 0 failed
```

9 new tests in `tests/test_bars_sanitize_d5_cp4_dual_compute.py` (five pure
`_dual_compute_outcome` category tests + two `_dual_compute_splits` never-raise
/ swallow tests + one sample-rate test + one value-integrity test) plus 3 new
tests in `tests/test_reference_corp_actions.py` for `read_confirmed_splits`.

Two mutation proofs, both run this turn:
- **Never-changes-the-served-value** — patched `_fetch_meta` to let a
  disagreeing D5 answer override the returned `splits` list →
  `test_fetch_meta_return_value_is_unaffected_by_what_d5_says` went RED.
  Reverted; reverified green.
- **The sampling gate is real, not a no-op** — replaced the
  `PYTEST_CURRENT_TEST`-or-sampled guard with `if False: return` (i.e. always
  proceed) → `test_dual_compute_splits_is_sampled_outside_pytest` went RED
  (the ledger read ran when the test asserted it must not). Reverted;
  reverified green.

Census re-verified with these changes present:
`PYTHONIOENCODING=utf-8 python tools/corp_actions_census.py` → exit 0, `OK —
every corporate-action site is registered with a state.` No new unregistered
site — `bars_sanitize.py` was already registered (PROVIDER_READ +
ADJUSTMENT_APPLIED) under CP1's census, and the new read targets D5's own
internal ledger, not a new external vendor URL.

## 3 · Files

```
api/services/reference_corp_actions.py                +36 lines: read_confirmed_splits()
api/services/bars_sanitize.py                          +46 lines: dual-compute + wiring
tests/test_reference_corp_actions.py                   +27 lines: 3 new tests
tests/test_bars_sanitize_d5_cp4_dual_compute.py         new, 9 tests incl. 2 mutation proofs
```

## 4 · Validators

```
ast.parse all changed .py files                                   OK
scoped pytest, 4 files                                             35 passed, 0 failed
mutation ladder (2 arms, both load-bearing)                        both confirmed RED then restored
census self-check (PYTHONIOENCODING=utf-8 tools/corp_actions_census.py)   exit 0
inert-strand classification (tools/flow_worker_watch_coverage.py + traced import chain)  INCIDENTAL
```

## 5 · Drafted ledger row — NOT written

| 127 | `<this commit>` | 2026-09-18 | BACKEND | 1 | D5 CP4: the split list, DARK. `bars_sanitize._fetch_meta`'s FMP splits fetch is dual-computed against D5 CP3's confirmed-splits ledger via a new `read_confirmed_splits()` -- the ledger's first real reader. Log-only, five named outcomes, never changes what is served (FMP stays the value of record). Runs every call in test, sampled 5% in production. Inert-strand risk re-classified from the packet's flagged YES to a traced INCIDENTAL: flow-worker's only edge to `bars_fetch.py` is one unrelated constant pull, never reaching the function-local imports that pull in `bars_sanitize` at all. |
