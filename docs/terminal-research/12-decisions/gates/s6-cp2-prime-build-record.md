---
id: s6-cp2-prime-build-record
unit: CP2'
packet: s6-personalization-pre-implementation-gate
merges-after: d5-cp7-build-record
status: UNSIGNED
---

# S6 CP2' — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-18)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  952aa032e
SCOPE APPROVED:   CP2'
```

> **S6 CP2' — the first migration.** The packet's own corrected proposal
> (F-S6-1, "PROPOSED — not approved, not scheduled" until this record), §4:
> *"The first migration (SPEC §5): `get_user_ticker_sets` ->
> `member_interest.interest_for`, signature unchanged, proved a no-op at
> EVERY call site enumerated by an AST sweep of `api/**` at build time —
> today Calendar (3 sites), the alert-taxonomy event-proximity projection,
> and `calendar_alerts` — against CP1's baseline."*
>
> **The blocking ruling is resolved, not bypassed.** CP2 (the packet's
> original, unfixed proposal) was blocked on SPEC-S6 §2 — SET vs WEIGHTED
> SET — a ruling the spec explicitly states it cannot make itself. Decision
> Card 1 (`docs/terminal-research/12-decisions/DECISION_CARDS_2026-09-18.md`,
> fork-verified) reclassified this specific question as **DEFAULTABLE**:
> *"the spec already names its own fallback [WEIGHTED SET, with the member's
> own tag semantics as v1] — applying it is not an owner decision unless the
> owner wants to override the spec's stated default."* This record applies
> that default. It is not a new ruling manufactured under delegation; it is
> the spec author's own already-written recommendation, applied because
> nothing overrode it.

## 0 · What this builds, and the F-S6-1 fix it carries

The packet's own audit (F-S6-1, filed 2026-09-15, before any code was
written) found the original CP2 premise false: *"Calendar the only caller."*
There are three modules, five call sites:

```
api/routers/calendar.py:2684                                    <- Calendar
api/routers/calendar.py:3107                                    <- Calendar
api/routers/calendar.py:3768                                    <- Calendar
api/services/alert_taxonomy/event_proximity_projection.py:155   <- NOT Calendar
api/services/calendar_alerts.py:260                              <- NOT Calendar
```

Verified by hand this checkpoint: all five sites consume
`get_user_ticker_sets`'s return value ONLY via `.get("all_mine")` or by
passing the whole dict into `to_payload()` — never any operation that a
shape-preserving migration could break.

**New `api/services/member_interest.py`**: owns the four per-source SQL
reads (moved VERBATIM from `calendar_personalization.py`, same queries, same
fail-soft try/except per source) plus a WEIGHTED SET registry
(`SOURCE_BUCKETS`) applying Decision Card 1's default. `interest_for(user_id)`
returns `{by_source, all_mine, entities}`, where every entity carries its
`weight` and `because[]` (the sources it came from) — SPEC §3.3's own
requirement: *"a resolver that returns a ranked list with no provenance is
unfalsifiable to the person it is about."*

**`calendar_personalization.get_user_ticker_sets`** becomes a thin delegate:
signature and return SHAPE unchanged (five keys, all `set` values), body now
built from `member_interest.interest_for(...)`. This is the "body swap, not
a new endpoint" the spec's §5 table calls for — `/api/calendar/my-sets` and
all five call sites are unaffected because the dict they read is unchanged.

## 1 · The no-op proof, per the corrected CP2' scope

Two complementary proofs, because "no-op" has two ways to be wrong — a
missed call site, and a changed shape:

1. **The AST sweep** (`tests/test_s6_cp2_migration.py`) walks `api/**` at
   test-run time for every call site of `get_user_ticker_sets` (Attribute
   AND Name calls, so an import-alias like `calendar.py`'s `_cp.` prefix is
   not invisible to it — proved by its own control), and fails BY NAME on
   any site outside the three modules F-S6-1 named. **The sweep is the
   enumeration; this record does not carry the count** — a sixth site added
   tomorrow is caught by re-running the sweep, not by trusting "5" written
   here.
2. **The shape proof**: `get_user_ticker_sets` still returns exactly five
   keys (`watchlist`, `flagged`, `positions`, `uct20`, `all_mine`), every
   value a `set`. Since every one of the five known call sites reads this
   dict ONLY through that shape, shape-preservation is sufficient to prove
   all five are no-ops — enumerated OR not-yet-enumerated.

## 2 · Controls

```
python -m pytest tests/test_member_interest.py -q
                                                          14 passed, 0 failed
python -m pytest tests/test_calendar_personalization.py -q
                                                           3 passed, 0 failed
python -m pytest tests/test_s6_cp2_migration.py -q
                                                           4 passed, 0 failed
python -m pytest tests/test_s6_member_interest_source_vocabulary.py -q
                                                          10 passed, 0 failed
python -m pytest tests/test_alert_taxonomy_event_proximity_compare.py \
                 tests/test_alert_taxonomy_event_proximity_projection.py \
                 tests/test_alert_taxonomy_event_proximity_schema.py \
                 tests/test_calendar_alerts.py -q
                                                          70 passed, 0 failed
python -c "from api.routers import calendar; from api.services import \
  calendar_personalization, member_interest; from api.services.alert_taxonomy \
  import event_proximity_projection; from api.services import calendar_alerts"
                                                          imports clean
```

14 new tests for `member_interest.py`: per-source isolation, the
empty-member case, the fail-soft contract (carried over verbatim from
`calendar_personalization.py`'s original "never raises" invariant, and
distinguished via `because[]` from a genuinely-empty source — C5-02 §2's
named anti-pattern *"empty-because-unreadable indistinguishable from
empty-because-new"*), `because[]` provenance, bucket-weight math including
the watchlist/flagged shared-bucket case (a symbol in both counts once, not
twice — the case a naive per-source-additive sum would get wrong).

**Mutation, run this turn:** changed the real `sum(_BUCKET_WEIGHT[b] for b
in touched_buckets)` to `max(..., default=0.0)` in `member_interest.py` →
`test_weights_stack_ACROSS_distinct_buckets` went RED (`1 failed`). Reverted
from a pre-mutation backup; reverified green (14/14, then the full combined
regression above).

**A pre-existing test file broke on this migration, by design and expected:**
`tests/test_s6_member_interest_source_vocabulary.py` (CP1's own signed rail,
fingerprint `b3073c67c`) parsed `get_user_ticker_sets`'s return dict for a
LITERAL `ast.Dict` node — which no longer exists post-migration (the new
body is a comprehension over `member_interest.SOURCES`). Fixed by moving
`server_sources()`'s AST anchor to `member_interest.SOURCE_BUCKETS` (the
genuine new authority) and rewriting the union-key check for the new
subscript-assignment shape. The three-way comparison, non-vacuity control,
and fail-BY-NAME behaviour are unchanged — only the file the server side is
read FROM moved, because the code it describes moved. This is NOT an edit to
the SIGNED packet (`s6-personalization-pre-implementation-gate.md` itself is
untouched) — it is the deliverable test file CP1 required, updated as CP2'
builds, exactly as D5's build records updated D5's own deliverables without
re-signing D5's packet.

## 3 · Files

```
api/services/member_interest.py                    new, ~200 lines
api/services/calendar_personalization.py            modified, thin delegate
tests/test_member_interest.py                       new, 14 tests incl. 1 mutation proof
tests/test_s6_cp2_migration.py                       new, 4 tests (AST sweep + shape proof)
tests/test_calendar_personalization.py               modified, patches moved to member_interest
tests/test_s6_member_interest_source_vocabulary.py   modified, server-side anchor moved
```

Committed on `feat/s7-price-level` at `47e2ad559`.

## 4 · Validators

```
ast.parse every new/modified .py file                                 OK
scoped pytest, this checkpoint's own new files                        18 passed, 0 failed
scoped pytest, CP1's rail + the two non-Calendar call sites' suites    80 passed, 0 failed
mutation ladder (1 arm, load-bearing)                                  confirmed RED then restored
AST sweep non-vacuity + import-alias control                          both pass
```

## 5 · Drafted ledger row — NOT written

| 130 | `47e2ad559` | 2026-09-18 | BACKEND | 1 | S6 CP2': `member_interest.py` subsumes `get_user_ticker_sets` (body swap, signature unchanged), applying WEIGHTED SET per Decision Card 1's DEFAULTABLE ruling (the spec's own stated fallback). Proved a no-op at every call site by an AST sweep re-run at build time, fixing F-S6-1's "Calendar the only caller" premise (actually 3 modules, 5 sites). Updated the already-signed CP1 vocabulary rail's server-side AST anchor to the new authority. |
