# Runbook — the rule record (`definition_evaluations`)

**Module:** `api/services/definition_record.py` · **Rails:** `tests/test_definition_record.py`
**Decision:** `docs/decisions/2026-08-08-the-rule-record-is-not-the-ledger.md`
**Lives in:** the signal ledger's own file — `SIGNAL_LEDGER_DB_PATH`, default
`/data/signal_ledger.db` — as a **sibling table** beside `signature_signals` and
`signature_coverage`.

---

## 1. What it is, in one sentence

*For definition **D** at revision **rev**, on symbol **S** and timeframe **tf**,
across the inclusive bar window `[first, through]`: the rule was evaluated on
`bars_evaluated` bars and said **yes** on `bars_true` of them.*

⭐ **And it says that regardless of whether anybody armed an alert on D, snoozed
it, or left it switched off.** That independence is the whole product claim:

> **"Every number we show you accrued after you asked for it."**

⛔ It is **not** the signal ledger, and the ledger cannot be substituted for it.
See the decision record: eleven conditions produce a right rule and an empty
ledger, five of them member behaviour.

---

## 2. Reading a claim

```python
from api.services import definition_record as rec

rec.claim_for(def_hash, rev, "1D",
              first_bar_time=20260101, through_bar_time=20260808,
              syms=None)          # None = every symbol this record knows
```

```python
{
  "coverage": "proven" | "partial" | "unproven",
  "window":   (20260101, 20260808),
  "symbols":  {"requested": 3742, "proven": 3701, "unproven": ["…", …]},
  "evaluated": 555_150,        # bar-evaluations that ARE proven
  "hits":      None | 34_112,  # None unless coverage == "proven"
  "hit_rate":  None | 0.0614,  # None unless coverage == "proven"
  "refusal":   None | "<a sentence>",
  "horizon":   {...},
}
```

### What each answer means

| `coverage` | meaning | what to show a member |
|---|---|---|
| `proven` | every symbol in the claim has a **single** recorded evaluation containing the whole window | the number |
| `partial` | some symbols do, some do not — `symbols.unproven` names them | *"we can't answer that yet"* + the coverage line (§6.3: a screen states its own coverage) |
| `unproven` | none do. **This is also what day one looks like.** | *"this record starts when you created the scan — nothing has accrued yet"* |

### The refusal sentences

| constant | when |
|---|---|
| `NO_RECORD_YET` | nothing has ever been recorded for this `def_hash` + `rev` |
| `NOT_ENOUGH_RECORD` | rows exist, but none contains the requested window (a prune, or a window wider than anything swept) |
| `PARTIAL_RECORD` | some symbols proven, some not |
| `REFUSALS["backwards"]` | the caller asked with `through < first` |

⛔ **`hits` and `hit_rate` are `None`, never `0`, unless coverage is `proven`.**
A `hit_rate` of `0.0` is a NUMBER and a number gets formatted into a sentence;
`None` cannot be, by accident. `evaluated` is still reported on a refusal because
it is a *coverage* fact, and with `hits` withheld there is no arithmetic a caller
can do with it.

---

## 3. Writing to it

```python
rec.record_pass(rev, "1D", "AAPL", ast=tree, bars=bars, at=None)
```

* **`def_hash` is DERIVED from the tree** — there is deliberately no parameter for
  it. An edited definition therefore starts a fresh record automatically.
* Warm-up bars (`ast_interpret.max_lookback(ast) - 1` of them) are counted in
  neither the numerator nor the denominator.
* A pass where nothing was computable writes **no row** and returns
  `{"recorded": False, "skipped": "..."}`. A sweep must count that symbol into
  its own `dropped` — ⛔ never into a silent nothing (§6.3; the measured
  anti-patterns are `bars_prewarm`, which counts a failure into neither `warmed`
  nor `skipped`, and `scan_volume`, where a failed reference is indistinguishable
  from an empty market).
* A `TableRefusal` from the interpreter **propagates**. A tree the closed table
  refuses is refused for every symbol; swallowing it per symbol would turn one
  loud authoring error into a universe of quietly dropped rows.

The low-level door, if a caller already has its own tally:

```python
rec.record_evaluation(def_hash, rev, tf, sym, first_bar_time, through_bar_time,
                      bars_evaluated=..., bars_true=..., at=None)
```

`True` = a new row landed. `False` means **exactly one thing**: this window was
already recorded. Every other problem raises `ValueError`.

### Refusals (all `ValueError`, all pairwise distinct, all rail-covered)

| guard | it means |
|---|---|
| `key_slot` | an empty / non-string `def_hash`, `tf` or `sym` |
| `def_hash_shape` | not a canonical `sha256:<64 hex>` |
| `rev_shape` | a revision must be a whole number ≥ 0 (a `bool` is refused first) |
| `timeframe` | not one of the eight product labels — the message names the bars-store code you probably meant (`"D"` → `"1D"`) |
| `backwards` | `through < first`; a containment test is satisfied by an inverted row for **any** probe between the two ends |
| `empty_window` | `bars_evaluated == 0` — a receipt covering everything by covering nothing |
| `count_shape` | a negative tally |
| `more_true` | `bars_true > bars_evaluated` |
| `stamp` | a non-finite `at` |
| `before_origin` | 🔴 the window reaches back before this record's origin — **the forward-only guard** |
| `negative_horizon` | `prune(older_than_days=-1)` |

---

## 4. The retention horizon — how to move it, and what it costs

```
DEFINITION_RECORD_RETENTION_DAYS      # env, default 540
```

⚠️ **This is the only place the number lives**, and a rail asserts it
(`test_the_HORIZON_has_exactly_ONE_authority`). A horizon with two authorities is
not a horizon: the prune deletes on one number and the claim refuses on the other,
and the gap between them is a window that reads as proven while its rows are gone.

🔴 **Beyond the horizon a claim REFUSES; it does not shrink.** This is not a
policy, it is the containment rule: a claim is proven by a **single** row that
contains the whole window, so when that row is pruned no combination of survivors
can substitute for it. A design that summed the survivors would publish a
smaller, confident, wrong number over a period nobody proved.

```python
rec.prune()                       # uses RETENTION_DAYS
rec.prune(older_than_days=90, now=None)
rec.horizon()                     # {'retention_days', 'oldest_recorded_at',
                                  #  'oldest_proven', 'newest_proven'}
```

There is **no scheduler wiring yet** — the prune is called by the sweep that
writes, and that sweep is E3's. Until then this store is empty in production.

### Measured growth — 2026-08-08, on this box

Measured, not estimated (the ground truth's 53.0 B/row is `alert_shadow_fires`'
schema, not this one). Universe size **read** from `api/data/cap_universe.json`.

```
rows=50,000  bytes=12,095,488  per_row=241.9  insert=141 rows/s
universe = 3,742 tickers (READ, not typed)
```

| definitions | **daily grain** (1 row / symbol / session) | **monthly grain** (1 row / symbol / month) |
|---|---|---|
| 1 | 0.23 GB/yr | 0.01 GB/yr |
| 10 | 2.28 GB/yr | 0.11 GB/yr |
| 100 | 22.8 GB/yr | 1.09 GB/yr |
| 500 | **114 GB/yr** | 5.43 GB/yr |

🔴 **THE OWNER GETS A NUMBER, NOT A WORRY.** At the daily grain this store does
not fit a Railway volume past ~10 popular definitions, and the 540-day horizon
makes it worse by ~1.5×. Three levers, in order of preference:

1. **The row GRAIN is the sweep's choice, not the store's.** A row is a *window*
   with a tally, of any length — so a nightly sweep that folds a month of
   sessions into one row costs 21× less and answers every month-or-longer
   question identically. It loses the ability to prove a *single day*, which is
   a real trade and the owner's to make. **This is the recommended default.**
2. **Lower `DEFINITION_RECORD_RETENTION_DAYS`** — linear, and it makes older
   claims refuse rather than shrink, which is the safe direction.
3. **Narrow the symbol set per definition** — a toolkit cap (E7) does this
   already, at the point breadth is produced.

⚠️ **~241.9 B/row is dominated by the 71-character `def_hash`**, stored once in
the row and once in the UNIQUE index. Dropping a redundant second index moved
this from 352.8 → 241.9 B/row (−31%); a further reduction would mean interning
the hash, which is a second table and was **not** taken.

⚠️ **Write throughput is ~141 rows/s** (each `record_evaluation` is its own
connection + commit). One universe sweep of one definition is **~27 s of insert**;
100 definitions is ~45 min a night. If E3's sweep needs better, the fix is a
batching door on this module — ⛔ **not** a caller that opens its own connection
to this table.

---

## 5. Isolation, and the `C:\data` trap

`definition_record` **captures no path at import.** `db_path()` reads
`ledger._DB_PATH` at call time, following `alert_rev_migration.db_path()`'s
precedent, so:

* there is nothing here to go stale, and no second setting for "the same
  database" to disagree about;
* the repo's existing `_isolate_signal_ledger` autouse fixture already isolates
  this table — no new conftest entry was needed;
* ⚠️ `C:\data` **exists on the dev box and is not production**. A test that
  reached the default path would append to a real append-only store with no
  rewrite path. `test_the_record_NEVER_TOUCHES_the_real_ledger_file_and_the
  _ARTIFACT_says_so` asserts the **artifact** — the unisolated file's size, mtime
  and table list, unchanged across a full drive of every write path — and derives
  that path by reading `ledger.py`'s own default out of its AST rather than
  typing it.

A test wanting its own store must move **both** `SIGNAL_LEDGER_DB_PATH` and
`ledger._DB_PATH`, reset `ledger._INITED`, and clear `definition_record._INITED`
(a **set of paths**, not a bool — a bool would remember "inited" for whichever
file was opened first).

---

## 6. Gates

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_definition_record.py -q
```

Read the exit code **bare, never through a pipe**: a no-match `-k` exits **5** and
a usage error exits **4** with no `passed` token, and both look like silence at
the end of a pipeline.

Neighbouring rails this task must leave unmoved:

```bash
python tools/alert_replay.py --check                          # FIRE LOG MATCHES, exit 0
python tools/alert_replay.py --diff --mode-a forming --mode-b closed
python tools/ast_conformance.py --check
python tools/ast_conformance.py --escapes                     # CLOSED, with a live control
git diff --stat HEAD -- api/services/signature/               # empty: the ledger is untouched
```
