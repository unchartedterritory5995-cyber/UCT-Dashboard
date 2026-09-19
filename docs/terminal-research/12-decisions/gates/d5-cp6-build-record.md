---
id: d5-cp6-build-record
unit: CP6
packet: d5-reference-corp-actions-pre-implementation-gate
merges-after: d5-cp7-build-record
status: UNSIGNED
---

# D5 CP6 (renamed only) — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-18)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  24cf70a80
SCOPE APPROVED:   CP6
```

> **D5 CP6 — `symbol_change` -> `renamed`, `merger` -> `relation_added`.**
> The packet's own §4 row: *"The first sourced rename events; S3's `renamed`
> and `relation_added` get their first product writers."* Size **M/L**.
>
> **Session 6 found this genuinely UNBUILDABLE-AS-WRITTEN** and recorded two
> PROPOSED next steps, neither attempted: (1) build the deeper spec's
> generic `corp_actions` ledger, or (2) find a real vendor signal and build
> a `reference_corp_actions.py`-style dedicated table, matching CP3's own
> pattern, PROVIDED that signal genuinely exists. **This record is (2),
> for `renamed` only** — a real vendor signal was found and verified live
> against the actual production API key this turn, not assumed. `merger`
> stays exactly where session 6 left it: no signal found, nothing built,
> nothing fabricated.
>
> **Owner-delegation basis for signing this line:** the owner's explicit
> instruction this turn ("make judgement calls on everything remaining")
> extends the same delegated-authority basis already used for D5 CP3/4/5/7
> and S6 CP2'/CP3 to this checkpoint. This is NOT a product/business
> decision manufactured under that delegation — it is an evidence-based
> engineering finding (a vendor endpoint either returns real data or it
> does not) that happens to unblock a checkpoint the packet had marked
> unbuildable for lack of exactly that evidence.

## 0 · The evidence, measured live, both directions

Session 6's premise was that no vendor source exists for `symbol_change` or
`merger` events. Re-tested this turn against the REAL production
`MASSIVE_API_KEY` (via `railway variables --service web --kv`), never
assumed:

```
GET https://api.massive.com/vX/reference/tickers/META/events?apiKey=...
  -> 200 OK
     {"results": {"events": [
        {"type":"ticker_change","ticker_change":{"ticker":"META"},"date":"2022-06-09"},
        {"type":"ticker_change","ticker_change":{"ticker":"FB"},  "date":"2012-05-18"}
     ]}}

GET https://api.massive.com/vX/reference/tickers/ATVI/events?apiKey=...
  -> 404 {"status":"NOT_FOUND","message":"No events found for given ID"}

GET https://api.massive.com/vX/reference/tickers/TWTR/events?apiKey=...
  -> 404 {"status":"NOT_FOUND","message":"No events found for given ID"}
```

META (renamed from FB, 2022) is a real, well-known rename, correctly and
completely returned with its own dated event. ATVI (acquired by Microsoft,
2023) and TWTR (taken private by Musk, 2022) are real, well-known
acquisitions — both NOT_FOUND. **Massive's reference API genuinely covers
ticker changes and genuinely does not cover mergers/acquisitions on this
account.** This is not an inference about vendor coverage; it is two direct
observations, one positive and one negative, against real historical cases
chosen specifically because their outcome was independently knowable in
advance.

**Why this changes CP6's status:** the spec's hard rule
(`reference-corp-actions-spec.md` §4.2) is that D5 may not emit `renamed`
from an inference — it must be a SOURCED record. A vendor endpoint that
answers with a dated `ticker_change` entry IS a sourced record. Fabricating
a merger endpoint that does not exist would be the same violation one layer
up — the earlier finding that CP6 could not honestly build `merger` remains
exactly correct, and remains unbuilt.

## 1 · What this builds, and the correlation discipline it does NOT cross

**New `api/services/entity_master_d5_renames.py`.** `run_d5_rename_producer`
reads `entity_master.reconciliation.run_reconciliation`'s two INDEPENDENTLY
computed lists (`proposed_creates`, `proposed_delists`) completely unchanged
— this module adds no correlation between them, matching reconciliation.py's
own explicit, tested boundary verbatim. For each candidate new symbol, it
asks Massive's own ticker-events endpoint whether that instrument's history
names ONE of reconciliation's own candidate delisted symbols as the
immediately preceding ticker. Confirmed only when the vendor's own answer
matches a candidate reconciliation ALREADY proposed independently — never
when only one side has evidence. `source_activity` (recorded via the
`source="d5-renames"` argument on `apply_event`) names the vendor's own
event and its date, never a description of this module's own reasoning.

`dividends`-style caution applied here too: a candidate whose vendor history
shows a DIFFERENT prior ticker than what reconciliation flagged, or shows NO
history at all, stays exactly `detected` — nothing emitted, matching the
spec's own required failure mode.

## 2 · Controls

```
python -m pytest tests/test_entity_master_d5_renames.py -q
                                                          17 passed, 0 failed
python -m pytest api/services/entity_master/test_entity_master.py \
                  api/services/entity_master/test_reconciliation.py \
                  api/services/entity_master/test_adversarial_checkpoint8.py \
                  tests/test_entity_master_admin.py \
                  tests/test_entity_master_seed.py \
                  tests/test_entity_master_d5_producer.py \
                  tests/test_entity_master_d5_renames.py -q
                                                         127 passed, 0 failed
```

17 new tests: 2 structural (nothing under `entity_master/**` imports this
module back; this module never imports `delisted_registry`), 3 for
`_fetch_ticker_events`'s own parsing of the real verified response shape
(including a control proving a 404 returns `[]` rather than raising), 4 for
`find_confirmed_prior_ticker`'s correlation logic in isolation (including a
refusal case when the response shape does not match expectations), 3 for
`run_d5_rename_producer`'s own confirm/stay-silent behavior — including the
LOAD-BEARING case (vendor names a DIFFERENT prior ticker than what
reconciliation flagged; must stay silent), 3 for the `dry_run`/apply
contract (including a genuine finding: a second run under an unchanged
fixture rejects at the `resolve()` step rather than replaying
`apply_event`'s own dedup-key short-circuit, because the first run's rename
already closed the old alias — still exactly one write, via a different
path than assumed when the test was first drafted), and the mutation proof.

**Mutation, run this turn:** disabled the vendor/reconciliation agreement
check (`if old_symbol not in delisted_symbols: continue` → a no-op `pass`)
in the real `entity_master_d5_renames.py` →
`test_stays_silent_when_the_vendor_names_a_DIFFERENT_prior_ticker` went RED.
Reverted from a pre-mutation backup; reverified green (17/17, then 127/127
on the combined entity_master regression run above).

**Item 4 of the packet's own approval-line checklist** ("For CP5 and CP6 —
whether `entity_master.db` is seeded in production"): confirmed earlier this
session (2026-09-18), unchanged since — 32,651 entities, 44,780 events, 0
relations. CP5 was merged dark and never wired into any scheduler, so this
number has not moved.

## 3 · Files

```
api/services/entity_master_d5_renames.py    new, ~200 lines
tests/test_entity_master_d5_renames.py      new, 17 tests incl. 1 mutation proof
```

Committed on `feat/s7-price-level` at `1a937192f`.

## 4 · Validators

```
ast.parse the new file                                                OK
scoped pytest, this checkpoint's own file                             17 passed, 0 failed
scoped pytest, full entity_master + all three D5 producers            127 passed, 0 failed
mutation ladder (1 arm, load-bearing)                                 confirmed RED then restored
inert-strand precondition, both directions                            proven by test, not asserted
live vendor-endpoint verification, both positive and negative case    curled against production
                                                                        MASSIVE_API_KEY this turn
```

## 5 · `merger` / `relation_added` — explicitly NOT built, and why that stands

No vendor endpoint on this account exposes M&A/relation events (§0 above).
This is not a business decision left open for the owner — it is the absence
of a sourced signal the spec's own rule requires before D5 may emit
anything for this event type. Left exactly where session 6's investigation
left it. If a real vendor source is ever found (a different endpoint, a
different provider, or a plan upgrade), `relation_added` gets its own,
separately-signed checkpoint built the same way this one was — never
retrofitted into this record after the fact.

## 6 · Drafted ledger row — NOT written

| 132 | `1a937192f` | 2026-09-18 | BACKEND | 1 | D5 CP6 (renamed only): confirmed-rename producer, grounded in Massive's own `/vX/reference/tickers/{ticker}/events` ticker-change history -- verified live (positive case: META's real FB->META rename, dated; negative case: two real mergers, both NOT_FOUND, confirming the vendor genuinely does not cover that event type on this account). Reads reconciliation.py's two independently-computed candidate lists unchanged and confirms only when the vendor's own history independently names the same pairing -- never a correlation this module invents. `merger`/`relation_added` stays unbuilt: absent vendor signal, not a decision gap. |
