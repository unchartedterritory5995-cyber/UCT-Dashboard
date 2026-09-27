---
id: SPEC-D5-REFERENCE-CORP-ACTIONS
title: D5 — Reference Data & Corporate Actions — Technical Specification
role: Phase 3 deliverable — the technical spec for D5. Docs only; nothing here authorizes code. Pairs with PRD-D5-REFERENCE-CORP-ACTIONS.
phase: 3
group: technical-architecture
category: spec
status: SPEC ONLY — NOT BUILT, NOT AUTHORIZED. The gate packet's approval block is EMPTY.
date: 2026-09-12
measured_against: origin/master @ ffa8102c7
confidence: >
  🟢 on every restatement of existing code — file and line named, read this pass from
  prose-stripped source. 🟡 on the ledger schema, the label contract and the producer
  contract, which are proposed and unbuilt. 🔴 on nothing.
evidence_ceiling: >
  Inherits every ceiling of PRD-D5-REFERENCE-CORP-ACTIONS verbatim, including its five named
  gaps: no production read of any kind (so `BARS_SPLIT_REPAIR_ENABLED`'s live value and
  `entity_master.db`'s row counts are both UNKNOWN); `breadth_dividends.db`'s contents not
  measured; the JavaScript half of the repo not prose-stripped; and `ffa8102c7` recorded as
  given rather than verified by git. ⛔ ADDS ONE OF ITS OWN: **no Massive or FMP response body
  was fetched this pass**, so every field name this spec attributes to
  `/v3/reference/{splits,dividends}` is read from THIS REPO'S OWN PARSING CODE
  (`polygon_extras.py:213-222`, `:261-268`; `breadth_dividends.py:132`;
  `bars_sanitize.py:272-281`), never from a live payload. Where a vendor field is named, the
  citation is to the line in our code that reads it.
sources: see PRD-D5-REFERENCE-CORP-ACTIONS's `sources`. This spec adds no source the PRD did not read.
---

# D5 — Technical Specification

## 0. The one-line contract

> **D5 turns a provider's corporate-action record into (a) a confirmed, addressable ledger row,
> (b) a typed identity event S3 already knows how to accept, and (c) an adjustment-basis label
> on a series. It owns nothing else, and it invents no grammar.**

---

## 1. Composition — three contracts D5 must target, none of which it may redesign

### 1.1 D2's address grammar, used as-is

`canonical-data-model-spec.md` §1.1, and it is live in the shipped book
(`api/data/canonical_address_book.json`, key `address_grammar`, read this pass):

```
uct://<metric>@<entity>/<timeframe>?as_of=<instant>[&provider=<vendor>]
```

⛔ **D5 declares metrics INTO that grammar; it does not extend it.** The five decisions in D2
spec §1.2 all hold for D5's metrics without modification, and two of them are load-bearing here:

- **`entity` IS AN ENTITY ID, NEVER A TICKER** — and D5 is the system that makes that
  affordable, because a corporate action is precisely the moment a ticker stops identifying one
  thing. A split row keyed by ticker string is a row that lies the day the ticker is reused.
- **`as_of` IS AN INSTANT, NOT A DATE** — every current D2 scalar is `grain: date` and the book
  records `grains {date: 137, (undeclared): 5}`. A corporate action has **three** distinct
  dates (declaration, ex, pay/execution) and pinning the grammar to one would make the second
  one a grammar change. §2.2.

### 1.2 ⛔ THE MANIFEST IS DERIVED, AND D5'S COLUMNS MUST BE DERIVABLE THE SAME WAY

D2 CP2's load-bearing property, in the gate's own words: *"NOT ONE VALUE IS TYPED HERE. If a
number or a name appears in the output, it was read from one of those four."* `bars_sqlite`
could join the book because it declares itself in a `CREATE TABLE` literal the builder parses
(`d2-…-gate.md:97-113`).

> **Requirement: D5's ledger must declare itself in one `CREATE TABLE` literal in one module,
> so `tools/build_canonical_address_book.py` can derive its metrics by AST exactly as it derives
> `ohlcv`'s — never by a hand-typed block in the builder.**

⛔ **This is not a style preference; it is the F-D2-1 refusal applied before the fact.** The D2
gate declined to address `fundamentals` because doing so meant typing ten metric names and
seven as-of names into the builder, *"which turns the address book from a ratification of the
codebase's existing form into a second authority over it"* (`d2-…-gate.md:91-95`). ⭐ **A D5
ledger designed without a declaration would be the second store that cannot be addressed, and
it would be new — which is worse than `fundamentals`, which is at least old.**

### 1.3 S3's typed event contract, used as-is

`entity-master-spec.md:289-306` — six payloads, all six implemented and validated in
`entity_master/api.py:233-310`:

```
new_entity:      {entity_type, initial_alias, initial_alias_valid_from, cik?, composite_figi?}
alias_added:     {entity_id, alias, valid_from}
alias_retired:   {entity_id, alias, valid_to}
delisted:        {entity_id, lifecycle_since}
renamed:         {entity_id, old_alias, old_alias_valid_to, new_alias, new_alias_valid_from}
relation_added:  {entity_id, related_entity_id, kind}
```

⛔ **D5 adds no seventh event type.** Every corporate action it can detect maps onto these six,
and the mapping is §4.2. `_VALID_EVENT_TYPES` (`api.py:180-182`) rejects anything else by name.

---

## 2. The ledger

### 2.1 Shape

One new SQLite database, `<DATA_DIR>/corp_actions.db`, WAL — following the per-domain-database
convention `entity_master/schema.py:3-6` already names (`bars.db` / `cot.db` /
`catalysts.db` / `entity_master.db`; ⛔ never a table added to `auth.db`).

```sql
CREATE TABLE IF NOT EXISTS corp_actions (
    action_id       TEXT PRIMARY KEY,        -- ca_<ULID>, minted here
    entity_id       TEXT NOT NULL,           -- S3's id. NEVER a ticker.
    action_type     TEXT NOT NULL,           -- 'split' | 'dividend' | 'delisting'
                                             --   | 'symbol_change' | 'merger'
    state           TEXT NOT NULL,           -- 'detected' | 'confirmed' | 'applied'
    declared_date   TEXT,                    -- ISO date, NULL when the source omits it
    effective_date  TEXT NOT NULL,           -- ex-date / execution date / delisting date
    pay_date        TEXT,                    -- dividends only; NULL otherwise
    numerator       REAL,                    -- splits only
    denominator     REAL,                    -- splits only
    cash_amount     REAL,                    -- dividends only
    currency        TEXT,                    -- dividends only
    successor_entity_id TEXT,                -- symbol_change / merger only
    source_vendor   TEXT NOT NULL,           -- D1 adapter key
    source_activity TEXT NOT NULL,           -- ProvenanceRecord's own field name
    observed_at     REAL NOT NULL,           -- when WE saw it
    source_observed_at REAL,                 -- when the VENDOR says it was true
    dedup_key       TEXT NOT NULL UNIQUE,    -- idempotency, S3's own discipline
    superseded_by   TEXT,                    -- action_id of a correcting row; never UPDATE
    rejected_reason TEXT                     -- non-NULL when a proposal was refused
);
```

⛔⛔ **FIVE PROPERTIES OF THAT DDL ARE NOT NEGOTIABLE, EACH BECAUSE OF A MEASURED DEFECT.**

1. **`entity_id`, never a ticker.** PRD Appendix A row 3 of the D2 inventory measured 75 tables
   keyed on a ticker string in three spellings. D5 is the one system that must not join that
   population, because a corporate action is the event that breaks a ticker key.
2. **`source_vendor` + `source_activity` + `observed_at` + `source_observed_at` are the four
   fields of `ProvenanceRecord`** (`provider_errors.py:199`, per D2 PRD §6.3), **not four new
   names.** ⭐ The split between `fetched_at` and `source_observed_at` is exactly the as-of
   distinction a corporate action needs: a vendor that publishes a split three days late is a
   different fact from a split that happened three days ago.
3. **`dedup_key UNIQUE`** — copied from `entity_events.dedup_key`
   (`entity_master/schema.py:102`) and for the same reason: re-ingesting an overlapping window
   must be a no-op, not a duplicate.
4. **`superseded_by`, never an UPDATE.** A vendor correcting a ratio is a new fact about the
   world, not a correction of our record of it. ⭐ Overwriting is how you lose the ability to
   answer *"what did we believe when we adjusted those rows?"* — which is the question a member
   ticket about a chart jump actually asks (`data-architecture.md:517`).
5. **`rejected_reason`, never a silent drop** — the shape `apply_event` already uses
   (`entity_master/api.py:219-222`, and `schema.py:109`: *"non-NULL when the write was
   refused"*).

### 2.2 ⛔ THREE DATES, AND COLLAPSING THEM IS A DEFECT

Our own parsing code reads all three from the vendor today:
`polygon_extras.py:217-220` pulls `declaration_date`, `ex_dividend_date`, `record_date` and
`pay_date` out of one `/v3/reference/dividends` row. `breadth_dividends.py:132` keeps **only**
`ex_dividend_date` — correctly, for a back-adjustment store.

> **Requirement: the ledger stores `declared_date`, `effective_date` and `pay_date` separately,
> and a consumer projects the one it needs.** `record_date` is deliberately NOT stored (no
> consumer in the repo reads it; adding a column nobody reads is a field that will be wrong and
> unnoticed).

⚠️ **`effective_date` is one column carrying three vendor names** — `ex_dividend_date` for a
dividend, `execution_date` for a split (`massive.py:1570`, `polygon_extras.py:243`),
`delisted_date` for a delisting (`delisted_registry.py:63`). That is a deliberate normalization
and it is the ONLY one in this schema. Every other field keeps the vendor's own noun.

### 2.3 The three states — `detected → confirmed → applied`

`data-architecture.md:536-546` designs this and names the precedent
(`calendar_date_integrity`'s admin-visible date-drift ledger). The measured content of each
state in THIS codebase:

| state | what it means here | what exists today |
|---|---|---|
| `detected` | something looks anomalous | `bars_sanitize.unadjusted_splits` (`:384`) — a close-ratio match within `_SPLIT_TOL` (`:153`). ⛔ **A measurement of PRICE standing in for a measurement of an EVENT**, and it has fired wrongly in production (`bars_sanitize.py:568-585`) |
| `confirmed` | a structured source states the action with a ratio and a date | the FMP/Massive reads of PRD §6.1 — **already happening, in four places, none of which records that it happened** |
| `applied` | the adjustment is live in what renders | mechanisms B and C of PRD §6.2 — **already happening, with no record of which basis resulted** |

⭐ **All three states already occur. What does not exist is a row that says which one a given
(entity, action) is in.** That is why D5 is *"New, small"* in `product-architecture.md:637`
rather than a new pipeline: the pipeline runs; nobody writes it down.

⛔ **`confirmed` IS NOT REACHED BY A PRICE OBSERVATION.** A `detected` row whose only evidence
is a close-ratio match stays `detected` forever unless a structured source confirms it. The
2026-08 false-positive incident is the whole argument: rows were rescaled on a detection that
no source had confirmed.

---

## 3. Adjustment as a labelled policy

### 3.1 The label

```python
@dataclass(frozen=True)
class AdjustmentBasis:
    splits:    bool | None      # None = we could not determine it
    dividends: bool | None
    as_of:     str | None       # ISO date of the newest action folded in
    applied_by: str | None      # 'vendor' | 'bars_sanitize' | 'bars_split_repair'
                                #   | 'breadth_dividends' | None
```

⛔⛔ **`None` IS A REAL VALUE AND MUST NEVER BE DEFAULTED.** This is D2 CP2.4's rule inherited
word for word (`d2-…-gate.md:157-166`): *"`cadence`, `as_of.grain` and `sentence` are declared
for all 137 screener scalars and for none of the five bars metrics. The book writes `null`."*

Applied here: **`splits=True` and `splits=None` are different facts.** A payload that defaults
to `"split-adjusted"` would render the same sentence for a bar Massive adjusted, a bar
`bars_split_repair` rewrote, and a bar nobody has ever examined. ⭐ **The third case is the
common one and it is the one a member's "why did the chart jump" ticket is about.**

### 3.2 Where the label is written, and where it is NOT

| | |
|---|---|
| **written** | at the point the adjustment is DECIDED — the D1 adapter that set `?adjusted=true`, or `bars_split_repair` when it rewrites rows, or `breadth_dividends.adjust` when it scales a frame |
| **carried** | on the SERVED payload's metadata, beside the bars, per `data-architecture.md:548-552` |
| **NOT written** | ⛔ **into `ohlcv`.** Measured: the DDL is `(ticker, tf, ts, o, h, l, c, v)` (`bars_sqlite.py:138-144`) and it is the store 38 product modules read directly (PRD Appendix A.4). Adding a column there is a live-schema change on the busiest store in the product and is explicitly outside CP1-CP3 |
| **NOT written** | ⛔ **into `bar_provenance`** without a measurement. It is PER-BAR (`bar_provenance.py:16-24`) and an adjustment basis is per-SERIES; a per-bar column would be N copies of one fact, and this repo has already paid for `bars_provenance` once — `bars_sqlite.py:149-158` records the previous table holding **0 rows with 8 call sites, all 8 in a test file** |

### 3.3 ⭐ The label is what makes the four mechanisms safe to leave alone

PRD §10.1 argues each of the four is correct for its own caller. The label is what turns four
correct local answers into one answerable global question, **without moving any of them**. That
is the whole reason the label is sequenced before any unification.

---

## 4. The producer contracts

### 4.1 D5 → D2 — the metrics D5 declares

| address | source column | as-of | yields | authority |
|---|---|---|---|---|
| `corp_actions.numerator` | `numerator` | `effective_date` | `num` | `authoritative` |
| `corp_actions.denominator` | `denominator` | `effective_date` | `num` | `authoritative` |
| `corp_actions.cash_amount` | `cash_amount` | `effective_date` | `num` | `authoritative` |
| `corp_actions.effective_date` | `effective_date` | `effective_date` | `date` | `authoritative` |
| `corp_actions.state` | `state` | `observed_at` | `str` | `authoritative` |

⚠️ **`yields: "date"` and `yields: "str"` do not exist in the book today** — measured,
`yields {num: 120, bool: 22}`. Adding a third and fourth value is a genuine widening of D2's
declared vocabulary and belongs in D5's own checkpoint, stated out loud rather than slipped in.

⛔ **AND `authority: "authoritative"` IS A CLAIM THAT MUST SURVIVE ONE QUESTION:** if D5's
ledger and the vendor disagree, who is right? **The vendor is** — a corporate action is the
issuer's fact, relayed. So the ledger is authoritative *for what we were told and when*, which
is exactly what `source_observed_at` records, and `superseded_by` is how a correction lands.
⭐ **That is a narrower claim than `bars.db`'s and the schema is what makes it honest.**

### 4.2 D5 → S3 — the event map

| D5 `action_type` | S3 event(s), in order | payload source |
|---|---|---|
| `delisting` | `delisted` | `{entity_id, lifecycle_since: effective_date}` |
| `symbol_change` | `renamed` | `{entity_id, old_alias, old_alias_valid_to: effective_date, new_alias, new_alias_valid_from: effective_date}` |
| `merger` (successor known) | `relation_added` (`kind='successor'`), then `delisted` on the predecessor | `{entity_id, related_entity_id: successor_entity_id, kind: 'successor'}` |
| a new listing | `new_entity` | S3's own shape |
| `split`, `dividend` | ⛔ **none** — a split is not an identity change | — |

⛔⛔ **EVERY ONE OF THESE IS EMITTED WITH `source='d5'` THROUGH
`entity_master.api.apply_event`, AND BY NO OTHER PATH.** `schema.py:107` already reserves the
value; measured this pass, **no code anywhere passes it**. D5 supplies the first writer.

⛔ **AND D5 MAY NOT EMIT `renamed` FROM AN INFERENCE.** `reconciliation.py:24-32` refuses to
correlate a delisting with a new listing because *"distinguishing them requires a
corporate-action signal this job does not have — that is explicitly D5's job."* ⭐ **D5's
answer to that is a SOURCED record, not a better correlation.** A `symbol_change` row whose
`source_activity` cannot be named is a row that must stay `detected` and emit nothing.

### 4.3 D5 → the bars lane

One function, replacing one call site:

```python
def declared_splits(entity_id: str, *, as_of: str | None = None) -> list[tuple[str, float]] | None
```

Returns the same `[(iso_date, ratio)]` shape `bars_sanitize._fetch_meta` returns today
(`bars_sanitize.py:272-281`), so `unadjusted_splits`, `split_factor`, `scale_bar` and
`bars_split_repair` are untouched.

⛔⛔ **`None` MUST BE DISTINGUISHABLE FROM `[]`, AND THIS IS THE ONE PLACE THE SPEC INSISTS
HARDEST.** `bars_sanitize.py:233-257` already carries the whole argument, and it is the best
existing statement of the rule in this repo:

> *"🔴 'NO SPLITS DECLARED' AND 'THE PROVIDER WOULD NOT SAY' ARE DIFFERENT FACTS, AND `_fmp_get`
> COLLAPSES THEM. … a **429 used to arrive here as `{"splits": []}`** — indistinguishable from
> a ticker with no corporate actions. … Measured on 2026-08-09: during one universe sweep, **72
> requests 429'd across 38 tickers**, each silently marked clean."*

`MetaUnavailable` (`:229`) is the class that fixed it. **D5 keeps it, by name.** A D5 read that
cannot answer raises; it never returns an empty list.

---

## 5. The provider layer — D1, and the quarantine that already exists

D5 makes **no vendor call of its own** (`product-architecture.md:766`). Every read goes through
a D1 adapter.

⭐ **AND THE MIGRATION LIST IS ALREADY WRITTEN, BY A CENSUS THAT ALREADY RUNS.**
`tools/massive_guard_census.py:57-72` quarantines, with the identical reason string *"not part
of this build's approved narrow slice"*:

- `api/services/polygon_extras.py` — the `/v3/reference/{splits,dividends}` reads
- `api/services/breadth_dividends.py` — the `/v3/reference/dividends` ex-date sweep
- `api/services/audit.py` — the `?adjusted=true` canonical fetch

and `tests/test_massive_guard_census.py:31-49` pins the set exactly, with
`assert why.strip(), f"QUARANTINE entry {path!r} has no reason recorded"`.

> **Requirement: D5's migration of those three reads is recorded by REMOVING their quarantine
> entries, not by adding a second list.** ⛔ A D5-owned list of "modules I have migrated" beside
> a D1-owned list of "modules not yet migrated" is a second authority over one value, and this
> programme's own register (DEC-14) already had to be rewritten once for exactly that.

⚠️ `bars_sanitize`'s FMP read is governed by the OTHER census — `tools/fmp_guard_census.py`,
which DEC-14's replacement expiry cites by test name. D5 touches both censuses and must not
merge them.

---

## 6. ⛔ FLOW-WORKER — the classification, and what it constrains

Measured this pass by importing `reachable_paths(root)` and `watched_paths(root)` from
`tools/flow_worker_watch_coverage.py` with an explicit root: **154 reachable · 24 watched · 133
reachable-but-unwatched. All 154 reachable paths are under `api/`.**

| D5-relevant module | RUNS | WATCHES | classification |
|---|---|---|---|
| `bars_sanitize.py` · `bars_split_repair.py` · `bars_sqlite.py` · `bars_fetch.py` · `massive.py` · `delisted_registry.py` · `entity_master/{api,store,schema}.py` · `research/entity_resolution.py` · `earnings_estimates.py` · `bar_validation.py` | **YES** | **no** | ⛔ **INERT STRAND** |
| `bars_reconciliation.py` · `audit.py` · `dividends_calendar.py` · `breadth_dividends.py` · `screener/dividend_join.py` · `polygon_extras.py` · `entity_master/reconciliation.py` · `routers/{delisted,entity_master_admin}.py` · `canonical/address_book.py` | no | no | outside the closure |
| anything under `tools/**` or `tests/**` | **no, by construction** | n/a | outside the closure |

**What each strand constrains, named rather than discovered at merge time:**

- ⛔ **`bars_sanitize.py` constrains the split-list checkpoint.** Changing `_fetch_meta`'s
  source leaves flow-worker running the previous split judgement — two copies of one
  corporate-action decision in two processes, which is the defect D5 exists to end, committed
  by D5. **That checkpoint must state whether flow-worker's reachability of `bars_sanitize` is
  live or incidental before it merges; if live, it needs a marker bump and an after-hours
  window** (`docs/runbooks/deploy-windows.md` is the authority, and a red there is a REVIEW
  GATE, not a block).
- ⛔ **`entity_master/api.py` constrains the `source='d5'` checkpoint** only if that checkpoint
  EDITS it. Adding a producer that CALLS it does not. **So the D5 producer must live in a new
  module and add no import to `entity_master/**`.**
- ⛔ **`delisted_registry.py` constrains any registry→S3 reconciliation**, for the same reason.
- ✅ **A census checkpoint confined to `tools/**` + `tests/**` strands nothing, by
  construction** — zero non-`api/` paths appear in the reachable set, so this is a property of
  the closure and not a lucky measurement.

---

## 7. Testing requirements

Each exists because its absence produced a real defect in this repo, named beside it.

| # | rail | the defect it exists for |
|---|---|---|
| 1 | the census is DERIVED from source with prose stripped, and carries a control proving the stripper still sees real code | the six prose-matching incidents D2 spec §7 row 3 names; and this pass's own two-sided control (`unadjusted_splits` survives / `MNST` does not) |
| 2 | a NON-VACUITY control naming a **specific expected member**, never a count | `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`; a count-based control goes red the day the population legitimately grows |
| 3 | `declared_splits` returning `None` (provider silent) is distinguishable from `[]` (no splits), with a fixture for each | `bars_sanitize.py:233-257` — 72 requests 429'd across 38 tickers, each silently marked clean |
| 4 | `AdjustmentBasis` fields default to nothing; a builder that substitutes `True` for `None` fails | D2 CP2.4's invented-default rail |
| 5 | a `detected` row cannot reach `confirmed` without a `source_activity` | the 2026-08 rescale-on-a-detection incident (`bars_sanitize.py:568-585`) |
| 6 | a second `corp_actions` row for one `dedup_key` is REJECTED with a reason, not overwritten | `entity_master/api.py:219-222`'s own discipline; and `_parse_mdy`'s two definitions |
| 7 | **no D5 code path writes `entities`, `entity_aliases`, `entity_relations` or `entity_vendor_symbols` directly** — an AST rail over D5's modules, failing by name | ⛔ the second-authority-over-S3 defect this whole spec exists to avoid |
| 8 | every S3 event D5 emits carries `source='d5'`, asserted at the call site | `schema.py:107` reserves it and nothing supplies it |
| 9 | the DEC-15 query distinguishes *not yet supplied* from *deliberately outside* | `fmp_news.py`'s G5 quarantine, which must never migrate (`ARCHITECTURAL_DECISION_REGISTER.md:227-232`) |
| 10 | the forward-only comparison reports **four outcomes**, and a test asserts the reporter cannot emit a single rate | F-S7-3, and DEC-14 clause 2 |
| 11 | mutation proofs for 1, 3, 4, 5, 7 and 8 — **restored by edit, never `git checkout`** | standing rule |

⛔ **AND ONE RAIL THAT IS NOT ABOUT D5's CODE AT ALL:** a test asserting that
`tools/corp_actions_census.py` is invoked by a test, so the census cannot become an instrument
nobody runs. ⭐ *"An audit nobody runs is worse than none: it reads as coverage"* — and this
pipeline's own history is the example, the insights pass having been *"written, documented as
scheduled, wired into no scheduler"* for weeks.

---

## 8. Sequencing constraints, stated as dependencies rather than dates

| this cannot start before | because |
|---|---|
| the split-list migration ← the census | the population of readers is not enumerable by hand; §6.1 of the PRD found two nobody knew about (`get_split_tickers`, `dividend_join`) |
| `source='d5'` events ← the ledger | an event with no confirmed row behind it is the inference `reconciliation.py:24-32` refuses |
| `renamed` events ← a sourced `symbol_change` row | §4.2 |
| the adjustment label rendering ← the label being written | S8 renders; D5 writes; a renderer with nothing to render is the `<Cited>` situation one system over |
| ANY member-visible change ← an approval line that names it | the gate packet's approval block is empty |

---

## 9. What this spec deliberately does not specify

1. **The M&A / spin-off / rights / buyback event calendar.** DEC-08 defers it. ⭐ The ledger's
   `action_type` column is deliberately a free-text TEXT with no CHECK, so adding `spinoff`
   later is a value, not a migration — the same "pin the wider shape, populate the narrow one"
   call D2 spec §1.2 item 3 made for `as_of`.
2. **Whether `corp_actions.db` is one database or a table in an existing one.** The per-domain
   convention says its own; that is an implementation call and the checkpoint that builds it
   should state which and why.
3. **Any change to Massive's 21 untyped public functions.** D2's gate names this as the lopsided
   axis and says sizing it needs its own pass; D5 inherits that unchanged.
4. **The breadth dividend-adjustment basis reconciliation.** Two repos
   (`product-architecture.md:636`).
5. **Whether the resolver caches.** Measure first — D2 spec §8 item 2, inherited.
6. **A point-in-time restatement model.** `data-architecture.md` §26's ceiling stands.
7. **What a member is told.** S8 renders the label; S10 formats the sentence; D5 supplies the
   fact.
