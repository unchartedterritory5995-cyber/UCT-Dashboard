---
id: SPEC-D2-CANONICAL-DATA-MODEL
title: D2 — Canonical Data Model & Metric Address Book — Technical Specification
role: Phase 3 deliverable — the technical spec for D2. Docs only; nothing here authorizes code. Pairs with PRD-D2-CANONICAL-DATA-MODEL.
phase: 3
group: technical-architecture
category: spec
status: SPEC ONLY — NOT BUILT, NOT AUTHORIZED. The gate packet's approval block is EMPTY.
date: 2026-09-12
measured_against: origin/master @ ee9c96fa1
confidence: >
  🟢 on every restatement of existing code — file and line named, read this pass. 🟡 on the address
  grammar and the resolver contract, which are proposed and unbuilt. 🔴 on nothing.
evidence_ceiling: >
  Inherits the PRD's ceilings including the one it adds: a read-only probe of production
  `/data/catalysts.db` was refused by tooling policy this pass, so no statement here rests on the
  distribution of values in a production table.
sources: see PRD-D2-CANONICAL-DATA-MODEL's `sources`. This spec adds no source the PRD did not read.
---

# D2 — Technical Specification

## 1. The address

### 1.1 Grammar

```
uct://<metric>@<entity>/<timeframe>?as_of=<instant>[&provider=<vendor>]
```

Five components, in the order the PRD's §6 found them in the code:

| component | resolves through | exists today |
|---|---|---|
| `metric` | the declaration manifest | ✅ `closedTable.json`, 137 entries, one store |
| `entity` | S3's entity id | ✅ `predicates.resolve_entity_scope` |
| `timeframe` | the bars-store CODE | ✅ `_BARS_STORE_TF_KEYS`, plus three copies |
| `as_of` | the value's own as-of column | ✅ per-metric, `bars_asof` or `snapshot_date` |
| `provider` | `ProvenanceRecord.vendor` + `source_activity` | ⚠️ 37 typed FMP functions, **2** typed Massive methods |

### 1.2 ⛔ Five decisions about the grammar, each with its reason

**1. `entity` IS AN ENTITY ID, NEVER A TICKER.** S3 shipped for exactly this reason, and
`entity-master-prd.md` §6.4 already makes the id every consumer's foreign key. ⚠️ **And the
existing schema does not comply** — 75 tables key on a ticker string (PRD Appendix A row 3). So the
resolver MUST accept a ticker as an *alias* and resolve it, exactly as `resolve_entity_scope` does,
while the canonical form remains the id. A grammar that accepted only ids would be unusable against
every table that exists.

**2. `timeframe` IS THE BARS-STORE CODE (`D`), NOT THE PRODUCT LABEL (`1D`).** Both spellings are
live and the map between them is declared. The code is chosen because it is the key the STORE uses,
and an address is a storage address. ⛔ The label is a presentation concern and belongs to S10.
⚠️ `signature_signals` keys ten rows of real history on `1D` with no rewrite path — its addresses
resolve through the map, and that is precisely what the map is for.

**3. `as_of` IS AN INSTANT, NOT A DATE, EVEN WHERE EVERY CURRENT VALUE IS DAILY.** All 137 declared
scalars are `grain: date` today. ⛔ Pinning the grammar to a date would make the first intraday
metric a grammar change rather than a declaration. **The same call F-S7-2 made for `trendline` and
F-S7-CM-1 made for `catalyst_types`: pin the wider shape, populate the narrow one.**

**4. `provider` IS OPTIONAL, AND ITS ABSENCE IS MEANINGFUL.** Omitted, the address names *the value
we hold*; supplied, it names *the value this vendor gave us*. ⭐ The difference is exactly the one
`bars_reconciliation` exists to find — our bar versus Polygon's canonical bar — and collapsing it
would make a reconciliation address itself.

**5. THE SCHEME IS `uct://` BECAUSE `<Cited>` ALREADY ACCEPTS `uctUri`.** `Cited.jsx:12-20` accepts
a `{uctUri: string}` row today, deliberately, as a forward-compatible superset. ⛔ Choosing a
different token would strand a prop that was designed for this.

### 1.3 What the address is NOT

- **Not a URL anybody fetches.** It is a key. There is no `uct://` handler, no route, no network.
- **Not a cache key.** Caches key on what is cheap to compare; an address is what is TRUE.
- **Not a display string.** No member ever sees one. If a design puts one on screen, that design
  wants a sentence and should use the metric's declared `sentence` field, which
  `closedTable.json` already carries for all 137.

---

## 2. The declaration manifest

### 2.1 Shape — it is `closedTable.json`'s, widened by exactly one field

Today, per scalar:

```json
"above_50sma": {
  "source":  {"store": "screener_rows", "column": "above_50sma"},
  "as_of":   {"column": "bars_asof", "grain": "date"},
  "cadence": "nightly",
  "yields":  "bool",
  "sentence": "whether the price is above its 50-day average"
}
```

D2 adds **`authority`**, and nothing else:

```json
  "authority": "authoritative" | "derived"
```

⭐⭐ **THAT IS THE WHOLE SCHEMA CHANGE.** The PRD's §7 classification is per-STORE, and every
declaration already names its store — so `authority` could in principle be derived from a store
table rather than declared per metric. ⛔ It is declared per metric anyway, for one reason:
`ticker_meta` is a derived cache that is *authoritative for nothing* and yet *wrong by construction
for reused tickers*, and a per-store verdict cannot express "this store is derived AND known to
disagree for a named class of input".

### 2.2 ⛔ THE MANIFEST IS DERIVED, NEVER HAND-MAINTAINED

`closedTable.json` is a checked-in artifact read by both the JS parser and `ast_lint.TABLE`. D2's
manifest must be the same: **one file, two readers, zero hand-typed restatements**, with a rail
that fails if any consumer holds its own copy.

⛔ **AND THE RAIL MUST STRIP COMMENTS BEFORE MATCHING.** Every module that will register a metric
also DISCUSSES the metric in prose. This programme has committed the prose-matching defect six
times in one session; `CODE, NEVER PROSE` is not optional here.

### 2.3 The axis report, and why it is a test rather than a comment

§6.2 of the PRD measures: 137 scalars, unanimous on `cadence`, `store` and `as_of.grain`. A comment
in `scan_evaluator.py` states the same thing with the number **54**.

> **Requirement: the unanimity check RUNS. `test_the_manifest_axes_are_reported_not_assumed` asserts
> the axes are read from the manifest and prints the counts; it does not assert a number.**

⭐ A test that asserted `len(scalars) == 137` would go red on the 138th metric, which is the
population changing legitimately — *a count is the wrong instrument when the population is meant to
change*. The test asserts the PROPERTY (one store, one cadence, one grain, or a named exception)
and reports the count.

---

## 3. The resolver

### 3.1 Contract

```python
resolve(address) -> Resolution
```

```python
@dataclass(frozen=True)
class Resolution:
    value: Any | None
    provenance: ProvenanceRecord | None
    as_of: float | None
    authority: str                 # "authoritative" | "derived"
    status: str                    # see §3.2
    detail: str | None             # the sentence a human reads
```

### 3.2 ⛔⛔ FIVE STATUSES, AND COLLAPSING ANY TWO IS THE DEFECT THIS SPEC EXISTS TO PREVENT

| status | means | the wrong collapse |
|---|---|---|
| `resolved` | we hold a value | — |
| `empty` | the metric is declared, the entity resolves, and the value is genuinely absent | folding into `not_computable` makes a quiet market look broken |
| `not_computable` | we could not compute it — no bars, short history, a NULL column | folding into `empty` makes a data gap look like a quiet market. **This is the `CoverageLine` lesson, and it was measured on the real universe: `answered=0, not_computable=2615` because `rs_rank` is NULL in every screener row** |
| `unknown_metric` | the address names nothing declared | folding into `not_computable` makes a typo look like a data gap |
| `unresolved_entity` | S3 cannot resolve the alias | folding into `empty` makes a delisted symbol look like a quiet one |

⭐ **`CoverageLine.jsx` already proves the four-way version of this is right and already refuses to
render a receipt whose arithmetic does not close.** D2's resolver is the same discipline one layer
down, and the fifth status exists because an address can be wrong in a way a screener row cannot.

### 3.3 Non-vacuity, as a contract rather than a convention

> **An `empty` resolution MUST carry the as-of of the read that found nothing.** An `empty` with no
> as-of is indistinguishable from a read that never happened.

⛔ This is F-S7-3's `NO DATA` versus `QUIET` distinction, restated at the value layer: *a dark run
that never ran and a dark run that found no disagreement are different facts.*

---

## 4. Registration

### 4.1 Who registers

The module that COMPUTES the value, at import time, idempotently — exactly the shape
`registry.register_trigger_type` already uses for S7 and which `registry.py`'s own docstring
defends: *"a cold-start read, refreshed on each app's own register call at import time."*

### 4.2 ⛔ TWO REGISTRATIONS FOR ONE ADDRESS IS DETECTABLE, NOT FORBIDDEN

The `pct_above_50sma` / `pct_above_50ma` case is two modules computing one concept. Both are
legitimate: the wire's figure is pushed daily and is not derivable intraday; the collector's is.

> **Requirement: registering a second computation for an existing address is ACCEPTED and
> RECORDED, and the resolver returns both with their provenance. It is never silently
> last-write-wins.**

⚠️ Last-write-wins here would make the answer depend on Python's import order, which is the
`_parse_mdy` defect (two definitions, the later winning, four call sites written for the earlier)
promoted from functions to data.

### 4.3 What a registration may not do

- **May not fetch.** A declaration is inert.
- **May not name a store that is not classified** in the PRD's §7 table.
- **May not declare `cadence` it cannot honour.** ⭐ `cadence_ceiling` already derives a scheduling
  ceiling from declared cadence, and §5 below is why that matters more than it looks.

---

## 5. What `indicator-condition` needs — the minimum viable axis

The PRD §9 kills the ad-hoc-key alternative. This is what replaces it, in order:

1. **Declare the metrics that type names.** Not all 137, not all metrics in the app — the ones the
   type's own predicates reference.
2. **The predicate stores an address.** An unresolvable address is a **refusal at registration**,
   with `unknown_metric` as the reason.
3. ⛔⛔ **`cadence` GATES THE PREDICATE, AND THIS IS THE PART THAT IS A REAL DEFECT TODAY.** A
   predicate asking a `cadence: nightly` metric to answer an intraday condition must be refused at
   registration. Without the gate the alert registers cleanly, evaluates cleanly, and **never
   fires** — and there is nothing to distinguish it from a condition that simply has not been met.
   ⭐ *An alert that cannot fire and an alert that has not fired look identical to a member, and the
   member is the one holding the position.*
4. **Forward-only comparison against the pre-D2 read**, four outcomes, never a rate — the same
   harness shape `price-level`, `event-proximity` and `catalyst-match` each built.

### 5.4 ⛔⛔ THE INDICATOR AXIS — a second address FORM, because §5.1's "declare the metrics" does not reach these

**Status: SPEC ADDENDUM, UNSIGNED. `indicator-condition` CP3 is blocked on it.** Owner instruction
2026-09-12. The product framing and the approval block are **PRD-D2 §9.5**; this is the technical
form.

#### 5.4.1 The measurement that forces a second form

```
legacy addresses   indicator_alert_evaluator.all_addresses()      31
book metrics       api/data/canonical_address_book.json          142
INTERSECTION                                                        0
CONTROL            legacy ∩ {one known legacy address}             1   <- the operator works
```

⚰️ **AND THE 0 IS NOT THE HONEST NUMBER EITHER.** A follow-up probe compared each legacy leaf
against each book leaf and reported **zero renames** — it was comparing `close` against `c` and
could not see an abbreviation. Corrected by inspection:

> **`close` ↔ `ohlcv.c` is ONE genuine rename. The other THIRTY are indicator outputs the book
> carries in no form at all.**

That distinction is the whole design. A translation table would map **one row of thirty-one** and
read as progress.

#### 5.4.2 Why §5.1 does not cover them — they are a different KIND of thing

§5.1 says *"declare the metrics that type names"*, and for `screener_rows` that is a column of a
nightly row: one store, one column, one `as_of`, one cadence. **None of those four hold for an
indicator.** `bb.upper` is:

| property | a screener metric | an indicator output |
|---|---|---|
| where the value lives | a stored column | **nowhere — it is computed on demand** |
| identity | the name | the name **plus its parameters** (`bb.upper` at 20/2 ≠ at 50/2) |
| timeframe | implicit (the nightly row) | **part of the address** — `rsi@1d` and `rsi@5m` are different series |
| `as_of` | the row's timestamp | **the last CLOSED bar of that timeframe** |
| cadence | a property of the metric | a property of the **(metric, timeframe) PAIR** (§9.4) |

⛔ So "migrate the legacy vocabulary into the book" is not available: there is no column to migrate.
The book must learn to describe a **computation**, not only a lookup.

#### 5.4.3 The address form

```
<indicator>[.<output>](<params>)@<timeframe>
    bb.upper(20,2)@1d      macd.histogram(12,26,9)@1h      rsi(14)@5m
    close@1d               -> RESOLVES TO ohlcv.c, the one rename
```

- **Params are positional and ordered by the indicator's own declared signature**, never a dict —
  two spellings of one address are two cache keys and two disagreeing answers.
- **Defaults are NOT implicit.** `rsi@1d` refuses; `rsi(14)@1d` resolves. ⭐ A default period is a
  second authority over what the member asked for, and this programme has paid for that class four
  times.
- **The timeframe is part of the address, not a query parameter**, because cadence is a property of
  the pair and an address that cannot express the pair cannot be gated.

#### 5.4.4 How it resolves — COMPUTE, not lookup

`resolve()` returns a **computation descriptor**, not a value: the source series (`ohlcv` on that
timeframe out of `bars_sqlite`), the indicator function, its bound parameters, and the warmup bar
count. ⛔ **The resolver must not compute.** D2 describes; the caller computes. A resolver that
returns numbers becomes a second calculation engine beside the one that already exists.

**`as_of` is the open-time of the last CLOSED bar of the address's timeframe** — never "now", never
the developing bar. ⛔ A developing bar makes an indicator value change under a predicate that has
already fired, which is the tuning-receipt problem F-S7-3 refuses to fake.

⚠️ **A REFUSAL THAT MUST SURVIVE:** insufficient history is `not_computable`, distinct from
`unknown_metric` and from a false condition. `rsi(14)@1d` on a symbol with nine bars is not
`false`; it is the CoverageLine distinction, and collapsing it makes a thin new listing look
bearish.

#### 5.4.5 The thirty, and the one

The scoping set is **`indicator_alert_evaluator.all_addresses()`** — bounded by the legacy lane, not
by ambition, and it does not grow on its own:

```
adx.adx  adx.minusDI  adx.plusDI  atr  bb  bb.lower  bb.middle  bb.upper  cci
donchian.lower  donchian.middle  donchian.upper
ichimoku.chikou  ichimoku.kijun  ichimoku.spanA  ichimoku.spanB  ichimoku.tenkan
macd  macd.histogram  macd.signal  mfi  obv  price_vs_ma  rsi
sar.priceCrossedSar  sar.trendFlipped  stoch  stoch.d  vwap  williams_r        (30)
close  -> ohlcv.c                                                              (1 rename)
```

⚠️ `sar.priceCrossedSar` and `sar.trendFlipped` are **booleans about a transition between two bars**,
not levels. They may not fit `yields: num` and may need `yields: bool` plus a two-bar window in the
descriptor. Named here rather than discovered at implementation.

#### 5.4.6 ⛔ THE BLOCKER IS MEASURED AND IT IS NOT THIS SPEC'S TO CLEAR

Declaring a bars cadence per timeframe means editing `bars_fetch.py` / `bars_sqlite.py`, which are
**inside flow-worker's import closure and outside its watch list**. GATE-D2 §CP2.4 refused this once
already, for that reason: flow-worker would run a stale copy of the new declaration while every test
on master stayed green. **Either those paths join flow-worker's watch list, or every declaring
commit rides a marker bump.** Until that is decided, CP3 would ship a projection over predicates
that all refuse — *not a smaller CP3, a CP3 with nothing in it.*

---

## 6. Migration mechanics

### 6.1 The three phases, and each one's revert

| phase | change | revert |
|---|---|---|
| **P1 declare** | add manifest entries beside code that already works | delete the entries; no reader changed |
| **P2 read through** | one consumer resolves an address instead of reading a column | one commit; the pre-D2 read is still present until its own migration |
| **P3 retire** | delete a duplicate map or an ad-hoc key | restore the literal — the timeframe map is eight pairs |

⛔ **P2 NEVER LANDS WITHOUT P1 FOR THAT METRIC, AND P3 NEVER LANDS WITHOUT A COMPARISON WINDOW.**
Retiring `_LEDGER_TIMEFRAME` before anything reads the declared map would be replacing a working
duplicate with an untested indirection.

### 6.2 The frontend copy is the one piece of real engineering

`GridChartCell.jsx:38` holds the timeframe map in JS. The manifest is JSON read by Python.
`closedTable.json` already solves this — it is JSON, checked in, read by both sides — so the
answer is the same answer, and it is the reason consumer 2 is sized **S/M** rather than **S**.

### 6.3 What must not happen during migration

- **No column renames.** PRD §3.3.
- **No change to `bars.db`'s newest-bar-wins invariant.** It is locked and predates D2.
- **No new authority over a value.** If D2 ever answers differently from the store it addresses,
  D2 is wrong.

---

## 7. Testing requirements

Each of these exists because its absence produced a real defect in this repo, named beside it.

| # | rail | the defect it exists for |
|---|---|---|
| 1 | the manifest is DERIVED; no consumer holds a copy | `_LEDGER_TIMEFRAME`, `LEDGER_TF_FOR`, `GridChartCell.jsx` |
| 2 | the axis report RUNS and reports counts rather than asserting one | `scan_evaluator.py`'s `54` beside a 137-entry manifest |
| 3 | every literal-hunting scan strips comments, with a control proving it still sees real code | six prose-matching incidents in one session |
| 4 | the five statuses are distinguishable, each with a fixture | `CoverageLine`'s `answered=0, not_computable=2615` |
| 5 | an `empty` resolution carries an as-of | F-S7-3's NO DATA vs QUIET |
| 6 | a second registration for one address is recorded, not overwritten | `_parse_mdy`'s two definitions |
| 7 | a `cadence`-violating predicate is REFUSED at registration, and the refusal is reachable by a test | an alert that can never fire |
| 8 | the DEC-14 query distinguishes *not yet addressed* from *deliberately outside* | `fmp_news.py`'s G5 quarantine, which must never migrate |
| 9 | mutation proofs for 1, 4, 6 and 7, **restored by edit, never `git checkout`** | standing rule |

⛔ **AND EVERY SCAN CARRIES A NON-VACUITY CONTROL NAMING A SPECIFIC EXPECTED MEMBER**, never a
count — *"an empty result is a failed invocation until proven otherwise"*, and a count-based control
goes red the day the population legitimately grows.

---

## 8. What this spec deliberately does not specify

1. **The storage of the manifest** beyond "one file, two readers". JSON is the obvious answer
   because `closedTable.json` already is one; that is an implementation call.
2. **Whether the resolver caches.** Measure first.
3. **Any change to Massive's 21 untyped functions.** Named in the PRD as the lopsided axis;
   sizing it needs its own pass.
4. **A point-in-time restatement model.** `data-architecture.md` §26's ceiling stands.
5. **The `pct_above_50ma` reconciliation.** PRD §10.2 — a product decision, not a modelling one.
