---
id: d5-cp7-build-record
unit: CP7
packet: d5-reference-corp-actions-pre-implementation-gate
merges-after: d5-cp5-build-record
status: UNSIGNED
---

# D5 CP7 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-18)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  de099a452
SCOPE APPROVED:   CP7
```

> **D5 CP7 — the adjustment-basis label.** Named explicitly by the owner's session
> prompt as one of "the six" units to build this session, the last of them in
> dependency order after CP3/CP4/CP5 (CP6 was investigated and found genuinely
> unbuildable-as-written; see `d5-cp6-build-record.md` if signed, or the session
> report). The gate's own §4 table declares CP7's scope: *"`AdjustmentBasis`
> written where the adjustment is decided, carried on the served payload,
> rendered by S8. ⛔ The first member-visible change in the programme and the
> first that needs its own explicit line."* Size **L**. Inert-strand risk:
> **YES per the packet's own table** — touches `bars_split_repair.py` and
> `bars_sanitize.py`, both flagged INERT STRAND. See §2 below for the traced
> (not assumed) resolution.

## Approval-line checklist items this record answers (packet §"approval-line checklist")

**Item 3 — the INERT STRAND statement, for BOTH files CP7 touches:**

> **`bars_sanitize.py`'s reachability from flow-worker is INCIDENTAL. No marker
> bump.** Traced (not assumed), reusing the exact chain D5 CP4's build record
> already established and re-verified this checkpoint: `flow_worker_main →
> flow_gap_autofill → liveflow_monitor → bars_fetch → bars_sanitize` exists only
> because `liveflow_monitor.py` pulls ONE CONSTANT (`_NYSE_HOLIDAYS_YYYYMMDD`)
> from `bars_fetch.py`, which in turn imports `bars_sanitize` at module top
> level. `bars_sanitize`'s real entry points — `_meta_cached` (CP7's own read
> path) and `unadjusted_splits` (the function CP7 calls to detect a boundary) —
> are never called by anything flow-worker's real code path reaches. CP7 adds
> **zero new imports** into `bars_sanitize.py` and **zero new call sites**
> inside it; `adjustment_basis.py` calls `bars_sanitize._meta_cached` and
> `bars_sanitize.unadjusted_splits` from OUTSIDE that file, the same way CP4's
> own dual-compute code already did, so CP7 introduces no new reachability edge
> that did not already exist under CP4's already-accepted INCIDENTAL finding.
>
> **`bars_split_repair.py`'s reachability from flow-worker is also INCIDENTAL.
> No marker bump.** Same reasoning as CP4's build record: `bars_split_repair`
> is reached transitively only via `bars_sanitize.sanitize_daily_bars`'s own
> function-local import inside `_schedule_store_repair`, which is itself only
> called from `sanitize_daily_bars` — already established as never-called by
> flow-worker's real path. `api/main.py` (where `bars_split_repair`'s own
> scheduler registration lives) is not in flow-worker's import closure at all
> (confirmed: `flow_worker_main.py` does not import `api.main`). CP7 calls
> `bars_split_repair.enabled()` — a single, side-effect-free boolean read of
> the module's own env-derived flag — and adds no import of `bars_split_repair`
> anywhere flow-worker's real path reaches.
>
> **Independently corroborating evidence:** `BARS_SPLIT_REPAIR_ENABLED=0` in
> live production (confirmed via `railway variables --service web --kv`,
> 2026-09-18) — the mechanism CP7 asks about is not even running in the
> deployed system today, so even a hypothetical reachability edge would be
> reading a disabled feature's static default.

**Item 5 — the member-facing sentence, EXPLICITLY DEFERRED to S8/S10:**

> **CP7 ships with NO member-facing rendering, and none is built here.**
> `data-architecture.md:550`'s proposed literal strings (`"split-adjusted,
> 2026-09-02"` / `"as reported"`) are NOT implemented by this checkpoint. The
> new `GET /api/bars/{ticker}/adjustment-basis` endpoint returns the raw typed
> payload (`splits`/`dividends`/`as_of`/`applied_by`) for a future consumer to
> render into a sentence — that consumer, and the exact wording a member would
> see, is explicitly S8 or S10's decision, per the packet's own item 5. Nothing
> in the frontend calls this endpoint. This is the same "ships dark" discipline
> every other D5 checkpoint this session has followed.

## 0 · The design decision this checkpoint had to make

The packet's own item 5 leaves two live options for what "the adjustment-basis
label" concretely is: (a) the deeper, UNAUTHORIZED `reference-corp-actions-spec.md`
proposes inlining the label as new metadata on the existing `/api/bars/{ticker}`
response — invasive plumbing across `bars_fetch.py`'s several internal layers,
on the hottest, most invariant-laden read path in the codebase; or (b) a
brand-new, additive sibling endpoint that computes the label from data already
at rest, touching nothing on the hot path.

**Chosen: (b).** The gate packet's own approval-line checklist item 5 explicitly
permits deferring the member-facing rendering to S8/S10 and does not mandate the
spec's inline-metadata design — and the spec document itself carries the
frontmatter `status: SPEC ONLY — NOT BUILT, NOT AUTHORIZED`, confirming (as D5
CP3/CP4/CP5 already established) that the packet's own per-checkpoint table, not
the deeper spec, is the operative authority. A new sibling route is strictly
additive: it cannot regress `/api/bars/{ticker}`'s serve-path invariants because
it shares no code path with them beyond two read-only lookups.

## 1 · What this builds

**`api/services/adjustment_basis.py`** (new module):

- `AdjustmentBasis` — frozen dataclass: `splits: bool | None`, `dividends: bool
  | None` (ALWAYS `None` — see below), `as_of: str | None`, `applied_by: str |
  None` ∈ `{'vendor', 'bars_sanitize', 'bars_split_repair', None}`.
  `to_dict()` for JSON serialization.
- `UNDETERMINED` — the all-`None` sentinel. Per D2 CP2.4's rule (inherited
  word-for-word by this checkpoint, same as every prior D5 unit): **`None` is a
  real value and is never defaulted to something more confident.** Every
  failure path in `compute_adjustment_basis` — unsupported timeframe, cold meta
  cache miss, no stored bars, a broken meta shape, any unexpected exception —
  returns `UNDETERMINED` rather than guessing `'vendor'` or any other label.
- `compute_adjustment_basis(ticker, tf) -> AdjustmentBasis` — the one public
  entry point. Reads ONLY `bars_sanitize._meta_cached` (cache-only, no network)
  and `bars_sqlite.get_bars` (a local SQLite read) — **no vendor fetch, no
  unbounded external call on a serve path**, the same invariant CLAUDE.md names
  as the 524-outage cause. Five real outcomes: unsupported tf → UNDETERMINED;
  cold meta cache miss → UNDETERMINED; no declared splits → `splits=False,
  applied_by='vendor'`; a declared split already reflected in the stored rows
  (no unadjusted boundary found by `unadjusted_splits`) → `splits=True,
  applied_by='vendor'`; a real gap between declared and stored → `splits=True,
  applied_by='bars_split_repair'` if `bars_split_repair.enabled()` else
  `'bars_sanitize'` (naming whichever mechanism is the CANONICAL fix right now
  — bars_sanitize heals every serve regardless of the flag; bars_split_repair
  would heal the store itself, when enabled).
- `dividends` is **always `None`**, by design, never computed. The gate
  packet's own language: *"NOTHING about the breadth dividend basis is in any
  checkpoint... D5 makes that divergence nameable; it does not get to resolve
  it."* A dividend basis genuinely exists (`breadth_dividends.py` has one) but
  CP7 does not read it, touch it, or guess at it.

**`api/routers/bars.py`** (modified): one new route, `GET
/api/bars/{ticker}/adjustment-basis?tf=D|W|M`, added immediately after the
existing `get_bars` handler. Same auth dependency (`require_bars_access`) as
every other route in the file. Returns
`{"ticker", "tf", "adjustment_basis": {...}}`. **Additive only** — touches no
existing response shape, no existing call site.

## 2 · Controls

```
python -m pytest tests/test_adjustment_basis.py -q
                                                          12 passed, 0 failed
python -m pytest tests/test_bars_sanitize.py tests/test_bars_split_repair.py \
                 tests/test_bars_split_repair_sweep_scheduled.py \
                 tests/test_adjustment_basis.py -q
                                                          59 passed, 0 failed
python -m pytest tests/test_bars_api_main.py -q
                                                           3 passed, 0 failed
python -c "from api.routers import bars"                 imports clean
```

12 new tests: 2 on the dataclass itself (`to_dict` carries all four fields;
`UNDETERMINED` is all-`None`), 1 asserting `dividends` is `None` in BOTH the
no-split and has-split cases, 1 for the intraday-timeframe guard, 1 for a cold
meta-cache miss, 1 for the no-declared-splits/vendor-adjusted outcome, 1 for
no-stored-bars, 1 for a declared split already reflected in the store
(vendor-adjusted), 1 for an unadjusted boundary naming `bars_split_repair` when
enabled, 1 for the same boundary naming `bars_sanitize` when the repair flag is
disabled, 1 for never raising on a broken meta shape, and the mutation proof
below.

**Mutation, run this turn:** hardcoded `applied_by = "bars_split_repair"`
unconditionally in the real-gap branch of `compute_adjustment_basis` (removing
the `if bars_split_repair.enabled() else` conditional entirely) →
`test_MUTATION_applied_by_switches_on_the_repair_flag_not_a_constant` went RED
(`FAILED ... 1 failed`). Reverted from a pre-mutation backup; reverified green
(12/12, then 59/59 on the combined regression run above). This was an EXTERNAL
mutation of the real source file, not merely exercising the test's own
internal branch-flip logic.

**Test-bug found and fixed during this checkpoint (recorded per this session's
error-tracking discipline):** the first version of
`tests/test_adjustment_basis.py::_write_unadjusted_split` hardcoded an
unrelated declared-split date (`"2026-06-24"`) at three call sites while the
synthetic bars used 2024 dates for the actual price-scale step.
`unadjusted_splits()`'s `_SPLIT_BOUNDARY_WINDOW = 7` (sessions either side of
the declared date) could never find the boundary under that mismatch, so
`compute_adjustment_basis` returned `applied_by="vendor"` in three cases where
`"bars_split_repair"`/`"bars_sanitize"` was expected — first run: `3 failed, 9
passed`. Fixed by having `_write_unadjusted_split` compute and RETURN the
properly-nearby declared date (mirroring `test_bars_split_repair.py`'s own
`_STEP_OFFSET=4` idiom) and updating all four affected call sites to seed meta
from that returned value. Final run: 12/12 green.

## 3 · Files

```
api/services/adjustment_basis.py            new, ~55 lines (excl. docstring)
api/routers/bars.py                         modified, +25 lines (one new route)
tests/test_adjustment_basis.py              new, 12 tests incl. 1 mutation proof
tools/corp_actions_census.py                modified, +1 REGISTER row (OUTSIDE)
```

Committed on `feat/s7-price-level` at `8ad9e1d62`.

## 4 · The census row this checkpoint added

D5 CP1's instrument (`tools/corp_actions_census.py`) derives its
`ADJUSTMENT_APPLIED` sites by NAME from call sites of known rescale functions
across `api/**` — a new call site of `bars_sanitize.unadjusted_splits`
therefore reports `UNREGISTERED` until a human classifies it, exactly as the
instrument is designed to do ("a fifth adjuster appears the day it lands").
Running the census after this checkpoint's code landed surfaced exactly that:
`api/services/adjustment_basis.py` flagged UNREGISTERED.

**Classified `OUTSIDE`, not `outstanding`:** `adjustment_basis.py` calls
`unadjusted_splits` READ-ONLY to detect whether a boundary is present — it
never mutates `bars`, never writes the store, never returns a rescaled series.
It returns a LABEL naming which of the two real rescale sites
(`bars_sanitize.py`, `bars_split_repair.py` — both already registered
`outstanding` from CP4) already did the rescaling. The two existing rows
remain the only real rescale sites; this is CP7's reader, not a third one.
Re-ran the census after registering: 0 UNREGISTERED rows.

## 5 · Validators

```
ast.parse both new/modified files                                   OK
scoped pytest, this checkpoint's own file                             12 passed, 0 failed
scoped pytest, this checkpoint + bars_sanitize + bars_split_repair    59 passed, 0 failed
scoped pytest, bars router import + route registration                3 passed, 0 failed
mutation ladder (1 arm, load-bearing)                                 confirmed RED then restored
inert-strand precondition, both files, traced not assumed             see approval-checklist item 3 above
census instrument                                                     0 UNREGISTERED after classification
```

## 6 · Drafted ledger row — NOT written

| 129 | `8ad9e1d62` | 2026-09-18 | BACKEND | 1 | D5 CP7: `AdjustmentBasis` label (splits/dividends/as_of/applied_by) for one (ticker, tf) series, computed cache-and-store-only (no vendor fetch on the serve path). Ships as a brand-new additive sibling endpoint (`GET /api/bars/{ticker}/adjustment-basis`), not inline metadata on the hot `/api/bars/{ticker}` path -- explicitly justified by the gate's own approval-line checklist, which permits deferring the member-facing sentence to S8/S10. `dividends` always `None`, out of scope by the packet's own language. Inert-strand risk on both `bars_sanitize.py` and `bars_split_repair.py` traced INCIDENTAL, reusing CP4's already-accepted chain plus the independent fact that `BARS_SPLIT_REPAIR_ENABLED=0` in production. Mutation-proved `applied_by` branch by external source mutation, confirmed RED, restored, reconfirmed green. |
