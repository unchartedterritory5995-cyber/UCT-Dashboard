---
id: d5-cp5-build-record
unit: CP5
packet: d5-reference-corp-actions-pre-implementation-gate
merges-after: d5-cp4-build-record
status: SIGNED (CP5, fingerprint b448dd7b3)
---

# D5 CP5 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-18)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  b448dd7b3
SCOPE APPROVED:   CP5 ONLY -- the checkpoint(s) named here and nothing else in the packet.
```

> **D5 CP5 — `source='d5'` for two event types.** Named explicitly by the
> owner's session prompt as one of "the six" units to build this session, in
> dependency order after CP4. The gate's own table declares CP5's scope: *"A
> producer emits `delisted` + `new_entity` through
> `entity_master.api.apply_event` with `source='d5'`, compared on the same
> run against the interim job's proposals. Retires DEC-15 clauses 1-3 for
> those two types only."* Size **M**. Inert-strand risk: **no, provided the
> producer is a new module that adds no import to `entity_master/**`** (which
> flow-worker RUNS) — this build record's own tests prove that precondition
> both directions (see §2).
>
> **Unblocked this session:** the packet's own evidence ceiling named
> `entity_master.db`'s seeded-or-empty state as unknown and CP5-affecting.
> Confirmed seeded earlier this session: 32,651 entities, 44,780 events, 0
> relations.

## 0 · The data source, and why it is genuinely "confirmed"

The packet does not name CP5's own data source — the ambiguity is real, and
this is the design decision that fills it. `entity_master.reconciliation`
(the "interim job") already proposes `new_entity`/`delisted` by DIFFING a
live Massive symbol list against the store's open aliases — a pure
presence/absence INFERENCE, and its own header says so plainly: *"It is
explicitly NOT a substitute for D5."* A delisting it proposes carries no
vendor-declared date at all; it stamps `lifecycle_since` as the run's own
`today()`, an approximation.

`massive.list_reference_tickers` already returns two per-ticker fields
reconciliation.py never reads: `delisted_utc` and `list_date` — the vendor's
OWN declared facts, exactly the "a vendor's own reference feed IS the
confirmation" grounding D5 CP3 already established for splits. CP5's producer
reads those fields directly, so a delisting it proposes carries the date the
vendor actually declared, not the date a job happened to run. That is the one
genuine improvement CP5 offers over the interim job, and it is why `source`
needs to be a separate value at all rather than reconciliation.py just adding
two fields.

## 1 · What this builds

**`api/services/entity_master_d5_producer.py`** (new module):

- `run_d5_producer(dry_run=True, db_path=None, max_pages=60,
  compare_to_reconciliation=True)` — computes `proposed_creates` (from
  `list_reference_tickers(active=True)` rows carrying a `list_date`, for
  symbols `entity_master.api.resolve()` reports `not_found`) and
  `proposed_delists` (from `active=False` rows carrying a `delisted_utc`, for
  symbols resolving to an `active`-lifecycle entity) — independently, same
  rename-exclusion boundary as reconciliation.py (never reads one list while
  computing the other).
- When `compare_to_reconciliation` (default True), also runs
  `reconciliation.run_reconciliation(dry_run=True)` and logs a named
  agree/d5-only/reconciliation-only comparison per event type — this is the
  packet's own "compared on the same run against the interim job's proposals"
  requirement.
- `dry_run=False` applies each proposal via `apply_event(..., source="d5")`,
  same collision guard, idempotency (`dedup_key=f"d5:{event}:{key}:{date}"`,
  namespaced apart from reconciliation's own `reconcile:` prefix so the two
  producers can never collide on one dedup key), and audit trail as every
  other caller.
- **Not wired into APScheduler** — same "ship dark" discipline as
  `reconciliation.py` itself: written, tested, dry-run-verified; activation is
  a separate decision this checkpoint does not make.

**Placement is the inert-strand answer, not an afterthought.** The packet's
own precondition — "no import to `entity_master/**`" — means the module lives
*outside* that package (a sibling of `entity_master_admin.py`'s own
placement pattern in `api/routers/`), and `test_no_file_under_entity_master_
imports_this_producer_back` proves nothing under `entity_master/**` imports
it either. Without that second half, "the producer imports nothing into
entity_master" would be true and irrelevant if entity_master imported the
producer back — the AST check on `test_reconciliation.py`'s own precedent
(`test_never_imports_delisted_registry`) only checks the FIRST direction;
this checkpoint needed the second too, since it's the one that actually
determines whether flow-worker's reachability of `entity_master/**` gains a
new edge into this module's own `massive.py` network call.

## 2 · Controls

```
python -m pytest tests/test_entity_master_d5_producer.py -q
                                                          13 passed, 0 failed
python -m pytest api/services/entity_master/test_entity_master.py
                  api/services/entity_master/test_reconciliation.py
                  api/services/entity_master/test_adversarial_checkpoint8.py
                  tests/test_entity_master_admin.py
                  tests/test_entity_master_seed.py
                  tests/test_entity_master_d5_producer.py -q
                                                         110 passed, 0 failed
```

13 new tests: 2 structural AST checks (delisted_registry never imported;
`entity_master/**` never imports this producer back), 3 for `new_entity`
proposal logic (proposes for an unknown ticker with a list_date; skips an
already-known symbol; skips a row with no list_date), 3 for `delisted`
proposal logic (proposes for an active entity the vendor declares delisted,
carrying the vendor's date; never proposes for an unknown symbol; never
re-proposes for an already-delisted entity), 2 for the `dry_run` contract
(`dry_run=True` calls `apply_event` zero times; `dry_run=False` applies with
`source='d5'` — asserted directly against the `entity_events` row, not just
the return value), 1 idempotency check (a second run against unchanged live
data proposes nothing), 1 comparison-logic check (two independently seeded
event classes produce the correctly-partitioned agree/only sets), and the
mutation-proved date-grounding guarantee below.

**Mutation, run this turn:** replaced `lifecycle_since`'s vendor-sourced
`str(delisted_utc)[:10]` with `datetime.datetime.now(datetime.UTC).date().
isoformat()` (i.e. reconciliation.py's own approximation) →
`test_MUTATION_lifecycle_since_comes_from_the_vendors_delisted_utc_not_todays_date`
went RED. Reverted; reverified green (13/13, then 110/110 on the full
entity_master suite).

## 3 · Files

```
api/services/entity_master_d5_producer.py   new, ~165 lines
tests/test_entity_master_d5_producer.py     new, 13 tests incl. 1 mutation proof
```

## 4 · Validators

```
ast.parse both files                                              OK
scoped pytest, this checkpoint's own file                          13 passed, 0 failed
scoped pytest, full entity_master + this checkpoint                110 passed, 0 failed
mutation ladder (1 arm, load-bearing)                               confirmed RED then restored
inert-strand precondition, both directions                          proven by test, not asserted
```

## 5 · Drafted ledger row — NOT written

| 128 | `<this commit>` | 2026-09-18 | BACKEND | 1 | D5 CP5: `source='d5'` producer for `delisted` + `new_entity`, grounded in Massive's own per-ticker `delisted_utc`/`list_date` fields rather than `reconciliation.py`'s presence/absence inference. New module deliberately placed outside `entity_master/**` (proven both directions: it adds no import there, and nothing there imports it back), so flow-worker's reachability gains no new edge. Compared on every run against the interim job's own proposals, logging named agree/only sets. Not wired into any scheduler -- ship dark, same discipline as `reconciliation.py`. |
