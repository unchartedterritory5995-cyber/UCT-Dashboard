---
id: PRD-D2-CANONICAL-DATA-MODEL
title: D2 — Canonical Data Model & Metric Address Book — Product Requirements Document
role: Phase 3 deliverable — PRD for a LOCKED system (product-architecture.md D2; capability-infrastructure-matrix.md D2 row). Docs only; nothing in this document authorizes code.
phase: 3
group: product-strategy
category: prd
scope: >
  Specification, not implementation, of D2 — the Canonical Data Model and Metric Address Book.
  Covers the canonical address scheme (metric, symbol, timeframe, provider, as-of), the mapping
  from every provider field D1 serves onto an address, which stores are authoritative and which
  are derived, the checkable condition DEC-14 needs in order to self-expire, what
  indicator-condition alerts need from the address book, and the migration posture with its first
  three consumers named. Does not specify S3 (Entity Master, shipped), D1 (Provider Abstraction,
  shipped), S8 (Provenance & Freshness, shipped) or S7 (Alerts, in build) — each is named only
  where D2 is its direct dependency.
confidence: >
  🟢 on every statement about what the application code does today — each was read from source
  this pass, at `origin/master @ ee9c96fa1`, and the file and line are named. 🟢 on every count in
  Appendix A, which was produced by a script over 3,898 files rather than typed. 🟡 wherever this
  document composes two accepted artifacts into one requirement, or proposes a shape. 🔴 on nothing
  proposed without a measurement behind it, and on nothing that would need a vendor contract
  (OI-03) or an observed desk morning (OI-06) to settle.
evidence_ceiling: >
  Inherits every ceiling of product-architecture.md, data-architecture.md and
  capability-infrastructure-matrix.md unchanged (no observed desk morning — OI-06; no vendor
  contract seen — OI-03; no production telemetry). ⛔ ADDS ONE NEW CEILING THIS PASS, and it is
  load-bearing: **a read-only probe of production `/data/catalysts.db` was attempted and refused by
  tooling policy**, so no statement in this document rests on the DISTRIBUTION of values in a
  production table. Everything is derived from source and from the local manifest. Where that gap
  changes a recommendation, it is said at the point of the recommendation (§9, §12) rather than
  only here.
sources: >
  Application source read this pass — `app/src/components/chart/engine/ast/closedTable.json` (via
  `api/services/ast_lint.py`), `api/services/screener/scan_evaluator.py`,
  `api/services/screener/scan_store.py`, `api/services/signature/ledger.py`,
  `api/services/signature/registry_defs.py`, `api/services/indicator_alert_evaluator.py`,
  `api/routers/definition_record.py`, `api/services/provider_errors.py`,
  `api/services/fmp_client.py`, `api/services/massive.py`, `api/services/engine.py`,
  `api/services/breadth_live.py`, `api/services/auth_service.py`,
  `api/services/ticker_tag_service.py`, `api/services/alert_taxonomy/predicates.py`,
  `app/src/components/provenance/*`, `app/src/components/chart/drawingLabels.js`,
  `app/src/pages/charts/grid/GridChartCell.jsx`, `tools/fmp_guard_census.py` ·
  program artifacts — product-architecture.md (D2 block), data-architecture.md (§4, §5, §26),
  capability-infrastructure-matrix.md (D2 row, §143), ARCHITECTURAL_DECISION_REGISTER.md (DEC-14),
  provider-abstraction-prd.md (§0b, §105-109), alerts-monitoring-prd.md (§5.1, §10, §17),
  provenance-freshness-spec.md (§4.5, §19), entity-master-prd.md (§6.4)
status: SPEC ONLY — NOT BUILT, NOT AUTHORIZED. Wave 3 (2026-09-12) asked for "a full Phase-3-style pass, docs only". The gate packet's approval block is EMPTY.
date: 2026-09-12
measured_against: origin/master @ ee9c96fa1
provisional_markers: >
  OI-03 (bears on §7's licensing column only — whether a canonical address may carry a
  member-visible vendor attribution is a contract question, and D2 stores the class rather than
  deciding it) · OI-06 (bears on nothing here — D2 has no command-grammar or workspace dependency)
---

# D2 — Canonical Data Model & Metric Address Book — PRD

## 0. How to read this document

**Three sentences first, because they change what the rest of it is.**

1. **The canonical form already exists in this codebase, in four pieces, and it works.** D2's job
   is to RATIFY it — give it one name, one home and one derivation — not to design a second one.
   §6 names the four pieces and where each lives today.
2. **The problem is not that the codebase has no canonical form. It is that it has one canonical
   form and several un-canonical neighbours,** and nothing tells a reader which is which.
   Appendix A is the measured inventory of every place two modules name one thing differently.
3. **Nothing here is authorized.** The gate packet is unsigned and the approval block is empty.

⛔ **DO NOT READ THIS AS A REWRITE PROPOSAL.** §10's migration posture is additive-only, and the
reason is in §10.1: three live readers of the implicit canonical form are already correct, and the
fastest way to lose D2 is to make them worse first.

---

## 1. The required traceability chain

| artifact | what it fixes for D2 | status |
|---|---|---|
| `product-architecture.md` — D2 system block | D2 exists, is LOCKED, is infrastructure not a feature | accepted |
| `capability-infrastructure-matrix.md` D2 row | *"None new — addresses values already computed elsewhere"* | accepted, and **this PRD is the first artifact to test that claim against source** — §6 confirms it |
| `data-architecture.md` §4, §5, §26 | canonical contracts; the Symbol/Security/Entity Master; point-in-time retention's own ceiling | accepted |
| `ARCHITECTURAL_DECISION_REGISTER.md` DEC-14 | the self-expiring exception D2 releases | RECOMMENDED, REVERSIBLE, **still in force** |
| `provider-abstraction-prd.md` §0b | D1 shipped; adoption partial; *"DEC-14 has NOT self-expired (D2 unshipped)"* | accepted |
| `alerts-monitoring-prd.md` §5.1, §10 | S7 predicates read *"values from D2/D3/D4"*; §10 says migrate onto D2 addresses **as each metric is registered**, not after D2 fully exists | accepted — and §9 of this PRD is the first time that instruction has a mechanism |
| `provenance-freshness-spec.md` §4.5, §19 Step 4 | S8's full recursive `<Cited>` is D2-gated; the narrow bar form shipped | accepted |
| `entity-master-prd.md` §6.4 | every consumer's foreign key is the entity id, ticker retained only as a label | SHIPPED |

⛔ **ONE INHERITED CLAIM IS CORRECTED BY THIS PASS AND IT IS NOT COSMETIC.** Appendix B row 9:
`scan_evaluator.py` states *"all 54 declared scalars are unanimous"* and warns about *"a
fifty-fifth scalar with a different cadence"*. The manifest declares **137**. The unanimity claim
is **still true** at 137 — measured this pass, all three axes — and the derivation the comment
describes (`cadence_ceiling` reading the manifest rather than a hand list) is exactly right. What
drifted is the number beside the list, which is this repo's most-repeated defect and is being
committed *inside the comment that warns against it*.

---

## 2. Who this system is for

D2 has **no member-facing surface of its own**, which is the first thing to say about it, because
a system with no screen is the one most likely to be argued into having one.

| audience | what they get |
|---|---|
| **S8 (Provenance & Freshness)** | the thing `<Cited>` clicks THROUGH to. Today `<Cited>` renders one level deep against `bar_provenance`'s shape and says so in its own header; the recursive inputs graph needs an address per input |
| **S7 (Alerts)** | a stable name a predicate can be written against, so an alert survives a metric being recomputed by a different module |
| **I1 / the AI layer** | a citation that points at exactly one value. Today an AI answer can name a number and a source; it cannot name the ADDRESS |
| **D1's call sites** | the re-point target DEC-14 promises |
| **the next engineer** | the answer to *"is `pct_above_50ma` the same number as `pct_above_50sma`?"*, which today requires reading two subsystems |

⛔ **NOT FOR: a member.** D2 never renders. If a D2 requirement starts describing pixels, it has
become S8's job or S10's.

---

## 3. The problem being solved

### 3.1 Stated as one measurement

> **A metric in this codebase has no name that is true across modules.**

Appendix A is that sentence with counts. The headline rows:

- `pct_above_50sma` (190 references, 64 files) and `pct_above_50ma` (11 references, 5 files) are
  **the same concept, computed twice, named twice**, on two sides of the app that both render it.
- The timeframe code→label mapping exists **four times**, three of them hand-typed copies of the
  one that declares itself the authority.
- The entity key is spelled `ticker` in 33 tables, `symbol` in 26 and `sym` in 16 — and one table,
  `live_alerts`, carries more than one spelling at once.
- Two functions named `get_user_tags` return different things about different subjects.
- Two functions named `formatPrice` return different shapes with different absent sentinels, and
  one of them has claimed in-file to be *"the one place in the app that knows how a price is
  rendered"* for as long as the other has existed.

### 3.2 Why each of those is a cost, not an aesthetic

**A second name is a second authority.** This program has paid for that shape at least five times
in artifacts it has had to correct — the writer-index `FOUR` beside six writers, the COT router's
"4 routes" beside five, the setup catalog's "24" beside 26, the taxonomy's `111 themes` beside
112, and the IDB cache version that read `4` while the constant had read `5` for three weeks. ⭐
**Every one of those was a hand-typed restatement of something the code already knew.** D2 is the
same lesson applied to values instead of counts.

**And it is about to be paid again, in a place that matters more.** S7's alert predicates are
being written NOW, one trigger type per weekend. Three are registered. `alerts-monitoring-prd.md`
§10 already says predicates should *"migrate onto D2 addresses as each metric is registered,
rather than waiting for D2 to fully exist"* — and there is no address to migrate onto, so each
type is pinning its own parameter vocabulary instead. §9 is what that instruction needs to become
executable.

### 3.3 ⛔ What the problem is NOT

- **Not "the codebase is a mess".** It is not. `closedTable.json` is a genuinely closed, derived,
  137-entry manifest with unanimous axes, read by both the JS parser and the Python evaluator, and
  three separate modules correctly DERIVE the timeframe map from `_BARS_STORE_TF_KEYS` instead of
  retyping it. **The right instincts are already present and already load-bearing.**
- **Not a migration.** §10.
- **Not a naming police action.** Renaming `sym` to `ticker` in 16 tables would be a large,
  risky, member-visible change that buys nothing. D2 addresses values; it does not rename columns.

---

## 4. Primary workflows

### UC-1 — S8's `<Cited>` clicks through to an input, and the input has a name

**Today:** `<Cited row={{ticker, tf, bar_time, source, validated_at, verified_at}} />` renders one
level. Its own header says the recursive form is *"genuinely blocked — D2/the Canonical Data Model
does not exist"*.

**With D2:** the row carries `uctUri` (the prop is already accepted and forward-compatible, by
design). Clicking an input resolves that address to another addressed value, and the graph
terminates at a provider fetch with a `ProvenanceRecord`.

⛔ **The terminating condition is the requirement, not the recursion.** A citation graph with no
defined leaf is a loop a member can fall into.

### UC-2 — A member asks the AI layer "where did that number come from" and gets one answer

**Today** an answer can say *"FMP, fetched 9:32"*. **With D2** it says *which* value: the metric,
the entity, the timeframe, the as-of. ⭐ The difference is whether two people reading the same
answer can check the same number.

### UC-3 — An alert predicate outlives the module that computed its metric

**Today** `price-level`'s predicate carries `target_price` and `level_kind`; `catalyst-match`'s
carries `catalyst_types` and `min_grade`; `event-proximity`'s carries `event_kind` and
`lead_days`. Each is a private vocabulary, correct for its own absorption and meaningless to the
next. **With D2** a predicate names an ADDRESS and a comparison; the type-specific parameters stay
for the things that are genuinely type-specific.

⚠️ **This use case is the reason §10's first consumer is S7 and not S8.** S7 is the only consumer
actively minting new vocabulary every week.

### UC-4 — A DEC-14-exempted call site is re-pointed, and somebody can tell

**Today** DEC-14 says every exempted call site *"is tracked and re-pointed at D2 once it ships"*,
and the tracking is a census of files (`tools/fmp_guard_census.py`, currently GREEN with 11
quarantine entries). **With D2** the condition becomes checkable — §8.

### UC-5 — Two modules compute the same metric and the disagreement is visible

**Today** `engine._normalize_breadth` and the breadth collector both produce a "% above the
50-day"; CLAUDE.md records that they *"reconcile to within a point"*, which is a sentence somebody
had to write after checking by hand. **With D2** both register against one address, and two
registrations for one address at one as-of is a detectable condition.

⛔ **DETECTABLE, NOT FORBIDDEN.** Two computations of one concept is sometimes correct — one is
intraday-derivable and one is not. The requirement is that the divergence has a name.

### UC-6 — A new metric is added and joins the address book on the day it lands

The address book is **derived from declarations**, not maintained by hand. A metric that declares
itself is addressable; one that does not is visibly absent. ⭐ This is precisely how
`closedTable.json` already behaves, and it is why §6 ratifies it rather than replacing it.

---

## 5. System boundary

### 5.1 Responsibility

D2 owns **the address of a value and the record of where that value came from**. It owns no
computation, no fetch, no cache, no render.

### 5.2 Inputs and outputs

| | |
|---|---|
| **inputs** | metric declarations from the modules that compute values; `ProvenanceRecord`s from D1; entity ids from S3; timeframe keys from the bars-store map |
| **outputs** | a resolvable address; the provenance for an addressed value; the authoritative-vs-derived verdict for a store |

### 5.3 Dependencies (who D2 calls)

**S3** for entity resolution, **D1** for provenance shape. ⛔ **And nothing else.** A D2 that
called a provider would be D1; a D2 that computed a value would be the application.

### 5.4 Callers (who calls D2)

S7, S8, I1, and D1's own call sites at re-point time. ⚠️ **Not the screener.** The screener already
has `closedTable.json` and reads it correctly; D2 ratifies that table, so the screener's callers
do not change.

### 5.5 Must NOT own

- **Presentation.** S10 shipped 2026-09-12 and owns how a number is rendered. D2 says what the
  number IS.
- **Freshness rendering.** S8's `freshnessContract.js` maps D1's FreshnessClass to a tier. D2
  stores the class; it does not map it.
- **The session model.** S11 owns market sessions.
- **Column names.** §3.3.

---

## 6. ⭐ THE CANONICAL FORM ALREADY EXISTS — the four pieces, measured

> **The owner's instruction was: "The codebase already has an implicit canonical form somewhere —
> find it; the spec ratifies it rather than inventing a second." It was found. It is in four
> pieces, three of them load-bearing today, and one of them is a genuinely closed manifest.**

### 6.1 ENTITY — `entity_scope {kind, id, asOf}`

`api/services/alert_taxonomy/predicates.py::resolve_entity_scope(alias, *, vendor, as_of)`
resolves through S3's Entity Master and reports `entity_status` honestly when it cannot. SPEC-S7
§5.2 fixes the shape. **S3 shipped 2026-09-02.**

⭐ This piece is finished. D2 restates it; it does not redesign it.

### 6.2 METRIC — `closedTable.json`, and it is closed for real

`app/src/components/chart/engine/ast/closedTable.json`, loaded as `api/services/ast_lint.TABLE`.
Measured this pass:

| | |
|---|---|
| declared scalars | **137** |
| `source.store` | `screener_rows` — **all 137** |
| `cadence` | `nightly` — **all 137** |
| `as_of.grain` | `date` — **all 137** |
| `as_of.column` | `bars_asof` **58** · `snapshot_date` **79** |
| scalars whose canonical NAME differs from their column | **0** |
| `yields` | `num` 115 · `bool` 22 |

Each entry is `{source: {store, column}, as_of: {column, grain}, cadence, yields, sentence}`.

⭐⭐ **THAT IS A METRIC ADDRESS BOOK. It has 137 entries, one store, a per-metric as-of column, a
declared cadence, a declared type and a human sentence — and `cadence_ceiling(tree)` already
DERIVES a scheduling decision from it rather than from a hand list.** D2's metric axis is this
table, widened past one store. It is not a new design.

⚠️ **Its one real limitation is the thing D2 must fix:** every entry is `store: screener_rows`, so
the table can address a nightly screener column and nothing else — not a bar, not a quote, not a
fundamental, not a breadth series. The *shape* generalises; the *population* does not.

### 6.3 PROVIDER + AS-OF — `ProvenanceRecord`

`api/services/provider_errors.py:199`:

```python
vendor: str
source_activity: str          # e.g. "fmp_client.get_key_metrics_ttm"
fetched_at: float
tie_break: Optional[str]
source_observed_at: Optional[float]
```

⭐ **`source_activity` IS ALREADY A PROVIDER-SCOPED ADDRESS**, and the split between `fetched_at`
(when we asked) and `source_observed_at` (when the vendor says it was true) is exactly the as-of
axis D2 needs. Referenced in 13 files, 75 times.

⛔ **AND THE COVERAGE IS LOPSIDED, WHICH IS A D2 REQUIREMENT AND NOT A D1 COMPLAINT.** Measured:

| adapter | typed, provenance-bearing surface |
|---|---|
| `fmp_client.py` | **37 public typed functions** (36 with a typed `timeout`), every one returning `ProviderResult` with a `ProvenanceRecord` |
| `massive.py` | **2** — `_MassiveRestClient.get_quote` and `.get_batch_quotes`. All **21** public module-level functions are untyped |

Massive is the primary source for bars, movers, snapshots and grouped daily closes. **The axis
that would let D2 address a bar is the one that is 2-of-23 built.**

### 6.4 TIMEFRAME — `_BARS_STORE_TF_KEYS`, and three copies of it

`api/services/signature/ledger.py:86` declares:

```python
_BARS_STORE_TF_KEYS = {"1": "1m", "5": "5m", "15": "15m", "30": "30m",
                       "60": "1h", "D": "1D", "W": "1W", "M": "1M"}
```

Three modules **derive** from it and are correct: `scan_store.py:99`, `scan_evaluator.py:242`,
`definition_record.py:93`. Three more **hand-type it**:

| file | shape |
|---|---|
| `api/services/indicator_alert_evaluator.py:1694` `_LEDGER_TIMEFRAME` | a full 8-entry duplicate |
| `api/services/signature/registry_defs.py:83` `LEDGER_TF_FOR` | a 2-entry partial, `{"1D":"1D","D":"1D"}` |
| `app/src/pages/charts/grid/GridChartCell.jsx:38` | the frontend copy |

⭐ **AND THE DUPLICATE KNOWS IT IS ONE.** `_LEDGER_TIMEFRAME`'s own comment reads *"TWO VOCABULARIES
FOR ONE TIMEFRAME, AND THE LEDGER OWNS THE OTHER ONE … Passing the field we already hold is the
natural mistake and it is SILENT: the row lands and simply orphans itself."* The engineer who
wrote the second copy documented exactly why it should not exist.

---

## 7. Authoritative vs derived — every store D2 must classify

Read from source this pass. ⛔ **"Authoritative" means: if this store and another disagree, this
one is right and the other is a cache or a projection.**

| store | holds | verdict | why |
|---|---|---|---|
| `entity_master.db` (S3) | canonical entity ids, aliases, delisting | **AUTHORITATIVE** — the only one for entity identity | shipped 2026-09-02; `entity-master-prd.md` §6.4 makes it every consumer's foreign key |
| `bars.db` (`bars_sqlite`) | OHLCV per (ticker, tf, ts) | **AUTHORITATIVE for bars**, with a locked invariant: *newest bar wins per (ticker, tf, ts) on EVERY path* | the 2026-05-16/17 overhaul; `bars_reconciliation` diffs it against Polygon canonical and surgically deletes divergent rows |
| `bars_disk_cache` + browser IDB | the same bars | **DERIVED** | TTL'd copies; IDB carries `CACHE_LOGIC_VERSION` precisely so it can be invalidated wholesale |
| `screener_rows` | the 137 declared scalars | **AUTHORITATIVE for those 137**, at `cadence: nightly` | `closedTable.json` names it as every scalar's store |
| `ticker_meta` cache | sector/industry/company name | **DERIVED**, 24h TTL — ⚠️ and it is WRONG for reused tickers by construction (`SQ`, `WTW`), which is why Model Book carries curated overrides | |
| `fundamentals` (`earnings_table`, the two `FUNDAMENTALS_*_DB_PATH` stores) | quarterly EPS/revenue strips | **DERIVED**, and the provider is authoritative — which the fundamentals monitor learned the hard way: `stale_reported` is only a defect when SEC EDGAR shows a filing we lack | |
| `breadth_monitor.db` | the 40+ daily breadth metrics | **AUTHORITATIVE for a recorded day**; the live intraday row is **DERIVED** and is hidden once `superseded` | |
| `wire_data.json` / cache | the morning wire's push | **AUTHORITATIVE for wire-pushed values**, and they are *not derivable intraday by construction* (the Exposure Rating) | |
| `catalysts.db` | the daily catalyst rows | **AUTHORITATIVE**, and uniquely so: `thesis_text` and `grade` are paid LLM output behind a cost cap and cannot be recomputed | |
| `cot.db` | CFTC positioning | **DERIVED** from a public source that can be re-downloaded | |
| `flow.db` | the OPRA tape | **AUTHORITATIVE and irreproducible within the session** — Massive does not replay; a gap is permanent until the T+1 flat file | |
| `auth.db` | members, sessions, subscriptions, `user_tags` | **AUTHORITATIVE** | |
| `signature_signals` (ledger) | indicator signal history | **AUTHORITATIVE**, keyed on the PRODUCT label `1D` | the source of the timeframe collision in §6.4 |

⛔⛔ **TWO STORES ARE AUTHORITATIVE AND NOT RECOMPUTABLE, AND D2 MUST TREAT THEM DIFFERENTLY FROM
EVERY OTHER ROW:** `catalysts.db`'s LLM output and `flow.db`'s tape. For every other authoritative
store, "we lost it" costs a re-fetch. For these two it costs money or the data itself. **An address
scheme that implies any addressed value can be re-derived on demand is wrong for both.**

---

## 8. ⛔ WHAT DEC-14 NEEDS TO SELF-EXPIRE, AS A CHECKABLE CONDITION

DEC-14's own text: *"new application call sites may call a named D1 adapter module directly (never
construct a raw vendor URL) during this window; **every such call site is tracked and re-pointed at
D2 once it ships**."*

`provider-abstraction-prd.md` §105 restates the trigger as *"reverts automatically **the day D2
ships**"*.

⛔⛔ **"THE DAY D2 SHIPS" IS NOT A CHECKABLE CONDITION AND MUST NOT BE THE TRIGGER.** D2 is not a
thing that ships on a day — it is a manifest that gains entries. Under that wording the exception
either expires while most call sites have no address to point at (breaking them), or never expires
because "D2 shipped" is arguable forever. ⭐ **Both failure modes are the same defect: a condition
nobody can evaluate.** `lesson_an_arming_condition_that_names_a_test_expires` is the near relative.

### 8.1 The proposed condition — three clauses, each measurable by a script

> **DEC-14 expires for a CALL SITE, not for the programme, on the day all three hold for it:**
>
> 1. **the value it fetches has a D2 address** — the metric is declared in the address book and
>    resolves; and
> 2. **the address returns the same value the direct call returns**, proved forward-only against
>    live traffic for a stated window, not by replay; and
> 3. **the call site reads through the address** and `tools/fmp_guard_census.py`'s successor
>    reports it as migrated rather than quarantined.
>
> **The programme-level exception expires when the census reports zero call sites for which
> clause 1 is false.** Not when a document says D2 shipped.

### 8.2 Why per-call-site rather than programme-wide

Because the census already works that way and is already GREEN. Measured this pass:

```
UNQUARANTINED financialmodelingprep.com literals outside fmp_client.py:  0
UNQUARANTINED _fmp_get-shaped function definitions outside fmp_client.py: 0
QUARANTINE: 11 entries, each carrying its own reason
```

⭐ **The instrument DEC-14 needs already exists and is green.** Its 11 quarantine entries are the
exact population clause 1 must be evaluated against, and one of them
(`api/services/news/adapters/fmp_news.py`) already carries a reason that says it must NEVER
migrate — the G5 contract-mismatch ruling of 2026-09-12. ⛔ **So the expiry condition must
distinguish "not yet addressed" from "deliberately outside", or it can never reach zero**, and a
condition that can never be satisfied is the same as no condition at all.

### 8.3 What clause 2 must not be

⛔ **NOT A REPLAY.** The S7 programme has now refused replay three times for three different
reasons — a trendline has no past; a calendar date moves; an LLM-graded row cannot be
re-synthesised. The same refusal applies here: a provider's answer for a past instant is not
recoverable, so "does the address return what the direct call returned" is a FORWARD-ONLY
question, answered by running both on the same tick. **F-S7-3's four outcomes, never a pass rate.**

---

## 9. What indicator-condition alerts need — and the ad-hoc-key alternative is KILLED

### 9.1 The S7 plan's alternative, restated

The S7 trigger-type plan carried, for the `indicator-condition` type, an alternative: *ship an
ad-hoc metric key with a sunset date, rather than blocking on D2's address book.*

### 9.2 ⛔ RECOMMENDATION: KILL IT. The reason is measured, not aesthetic.

**Kill it, and the argument is that this codebase has run the experiment already — twice — and
both ad-hoc keys are still live.**

- **`_LEDGER_TIMEFRAME`** (§6.4) is an ad-hoc copy of an authoritative map, written with a comment
  explaining why it is dangerous. It has not been sunset.
- **`pct_above_50ma`** (Appendix A row 1) is an ad-hoc spelling of a metric that already had one.
  It is in 5 files including a live regime classifier. It has not been sunset.

⭐ **A sunset date is a promise made by the person who benefits from not keeping it.** Every
instance of this shape in this repo's history — the `/api/tweets/tape` route kept "one deploy
cycle", the `j2_playbook_entries` table kept "~30d", `trades.py` kept as "a rollback backup" — is
still present. ⛔ **The pattern is not that people are careless; it is that a dated promise has no
mechanism, and this programme's own standing rule is that an arming condition naming a date
expires into fiction.**

### 9.3 What to do instead — the four-line version

`indicator-condition` does **not** need the whole address book. It needs **one axis of it,
populated for the metrics it names**, which is a much smaller thing:

1. **A metric declares itself or it is not alertable.** The declaration is the same four fields
   `closedTable.json` already uses — `{store, column, as_of, cadence}` — plus `yields`.
2. **The predicate carries the ADDRESS, not the key.** An unresolvable address is a refusal at
   registration time, not a silent no-op at evaluation time.
3. **`cadence` is the gate S7 has been missing.** `cadence_ceiling` already proves the idea:
   a nightly metric cannot answer an intraday alert, and today nothing stops a predicate asking it
   to. ⭐ That is a REAL member-facing defect waiting to happen — an alert that silently never
   fires because its metric only updates at 03:00.
4. **The first metrics registered are the ones `indicator-condition` actually names** — not all
   137, and certainly not all metrics in the app.

⛔ **AND THE HONEST COST OF KILLING THE ALTERNATIVE IS THAT `indicator-condition` WAITS.** That is
the trade, stated plainly: the type is sequenced after the address book has its first axis
populated, instead of shipping now with a key that would never be retired. ⚠️ It is the owner's
call, and this PRD's recommendation is to pay it, because the two live ad-hoc keys measured above
are what the alternative looks like eighteen months later.

---

## 10. Migration posture — additive, never a rewrite of live readers

> **D2 is built by ADDING a declaration beside code that already works, never by changing what a
> live reader reads.** Every phase must be revertible by deleting rows from a manifest.

### 10.1 Why additive is not just caution

Three live readers of the implicit canonical form are **already correct** and must not be
disturbed: `scan_store.py:99`, `scan_evaluator.py:242` and `definition_record.py:93` all derive
the timeframe map from its declared authority. ⭐ **A migration that touched them would be
replacing correct code with new code to prove a point**, and the failure mode is the one
`lesson_built_tested_green_and_unreachable` describes from the other direction: the new thing
works, the old thing still runs, and nobody can tell which answered.

### 10.2 The first three consumers, named, in order

| # | consumer | why it is first | size |
|---|---|---|---|
| **1** | **S7's next trigger type** — whichever is authorized after `catalyst-match` | It is the only consumer minting NEW vocabulary every week. Every weekend that passes without an address is another private parameter set that will need migrating later. It is also **dark** — a wrong address costs nothing a member can see. And `alerts-monitoring-prd.md` §10 already instructs exactly this: migrate as each metric is registered. | **S** — one declaration per metric the type names |
| **2** | **The timeframe axis** — collapse `_LEDGER_TIMEFRAME`, `LEDGER_TF_FOR` and `GridChartCell.jsx`'s copy onto the declared map | The smallest complete axis in the app: eight entries, one authority, three offenders, and three modules already showing how to derive it. It is the proof that D2 can retire a duplicate rather than add a fifth name. ⚠️ The frontend copy needs a build-time export, which is the one piece of real engineering here. | **S/M** |
| **3** | **S8's full `<Cited>`** — the recursive inputs graph | The only one with a member-visible payoff, and it is deliberately third: it needs axes 1 and 2 to exist before it has anything to click through to. `<Cited>` already accepts `uctUri` for exactly this, so the prop surface is a superset and the change is additive by construction. | **M** |

⛔ **WHY NOT `pct_above_50ma` FIRST, WHEN IT IS THE MOST QUOTABLE FINDING?** Because it is the
only row in Appendix A that is **member-visible on both sides** — the morning wire and the breadth
monitor both render it — so reconciling it is a product decision about which number is right,
not a data-modelling one. ⭐ **D2 makes that divergence NAMEABLE; it does not get to resolve it.**
Putting it first would make the first D2 change a behaviour change, which is the opposite of §10's
posture.

### 10.3 What must be revertible, and how

| phase | revert |
|---|---|
| a declaration added | delete the manifest entry; no reader changed |
| a consumer reading through an address | the pre-D2 read is still present until its own migration commit; revert is one commit |
| a duplicate map retired | restore the literal; it is eight key-value pairs |

---

## 11. Non-goals

1. **Renaming database columns.** §3.3.
2. **A universal metric registry covering every value in the app.** The address book grows by
   consumer demand. A registry nobody reads is a second artifact to keep true.
3. **Replacing `closedTable.json`.** It IS the metric axis; D2 widens its store field.
4. **Owning presentation** (S10, shipped) or **freshness mapping** (S8) or **sessions** (S11).
5. **Resolving the `pct_above_50ma` / `pct_above_50sma` divergence.** §10.2.
6. **A point-in-time restatement model.** `data-architecture.md` §26 carries its own evidence
   ceiling for this and D2 does not lift it.

---

## 12. Acceptance criteria

D2's first increment is accepted when all of the following are **measured**, not asserted:

1. The address book is **DERIVED** from declarations — a script reproduces it from source, and a
   rail fails if any entry is hand-typed. (The precedent is `closedTable.json` + `ast_lint.TABLE`.)
2. Every declaration carries `{store, column, as_of, cadence, yields}` and the manifest's axes are
   **reported, never assumed** — the unanimity check of §6.2 runs as a test, so the day a
   non-nightly metric joins, the answer moves without an edit.
3. ⛔ **A NON-VACUITY CONTROL on the resolver**: an address that resolves to nothing returns a
   REFUSAL distinguishable from an address that resolves to a null value. *"We could not compute
   it"* and *"we computed it and it is empty"* are different facts — the `CoverageLine` rule.
4. The DEC-14 condition of §8.1 is **implemented as a query**, and its output distinguishes
   *not yet addressed* from *deliberately outside* (§8.2).
5. Consumer 1 (S7) reads through an address in a dark path, with a forward-only comparison against
   its pre-D2 read and the four outcomes never collapsed into a rate.
6. **The scalar count in `scan_evaluator.py`'s comment is corrected in the same change**, or the
   comment is rewritten to derive it. Appendix B row 9. ⭐ Shipping D2 while the codebase's own
   best existing address book is described by a drifted count would be the programme's most
   expensive irony.

⛔ **NOT acceptance criteria** (each is a reason to delay that must not be allowed to):
completing all four axes; migrating Massive's 21 untyped functions; retiring any ad-hoc key other
than the timeframe map; any member-visible change at all.

---

# APPENDIX A — THE NAMING INVENTORY

> **Produced by a script over 3,898 source files at `origin/master @ ee9c96fa1`, not typed.**
> Script: `d2_inventory.py` (scratch; its logic is reproduced in the spec's §A for re-running).
> Counts are `(references, files)`.

## A.1 The headline table

| # | one concept | the names it has | measured |
|---|---|---|---|
| 1 | % of universe above the N-day average | `pct_above_50sma` vs `pct_above_50ma` | **190 refs / 64 files** vs **11 refs / 5 files** |
| 1b | same, 200-day | `pct_above_200sma` vs `pct_above_200ma` | **77 / 36** vs **11 / 5** |
| 1c | same, 5-day | `pct_above_5sma` vs `pct_above_5ma` | **48 / 25** vs **5 / 3** |
| 2 | bars-store timeframe code → product label | `_BARS_STORE_TF_KEYS`, `_LEDGER_TIMEFRAME`, `LEDGER_TF_FOR`, an inline object | **4 maps in 4 files**; 3 other modules correctly derive from the first |
| 3 | the entity key, as a DDL column | `ticker` / `symbol` / `sym` | **33 / 26 / 16 tables**; `live_alerts` carries more than one |
| 4 | `get_user_tags` | a member's admin labels · a member's ticker colour tags | **2 definitions**, `auth_service.py` and `ticker_tag_service.py` |
| 5 | `formatPrice` | `"$12.50"`, em dash when absent · `"123.46"`, tick-aware, empty string when absent | **2 definitions**, `presentationFormat.js` and `chart/drawingLabels.js` |
| 6 | the as-of column, inside ONE store | `bars_asof` · `snapshot_date` | **58 / 79** of 137 scalars in `screener_rows` |
| 7 | the drill target of a breadth cell | `drillKey` vs the metric key, reconciled by `_DRILL_KEY_ALIASES` | **118 refs / 34 files** |
| 8 | the provider-scoped activity name | `source_activity` | **75 refs / 13 files** — the one axis with a single name |

## A.2 What the counts say, and what they do not

⭐ **The majority spelling wins overwhelmingly in every row, which is the good news.** 190-to-11,
77-to-11, 48-to-5. This is not a codebase with two equal conventions; it is a codebase with one
convention and a handful of un-migrated holdouts, each in a module that predates or sits beside
the mainstream one.

⛔ **AND THE HOLDOUTS ARE NOT WHERE YOU WOULD GUESS.** `pct_above_50ma`'s five files include
`api/services/voice_regime_classifier.py` — a live classifier — and
`app/src/pages/charts/widgets/marketContextModel.js` — a live widget. **These are not dead
corners.** A reader who checked only the mainstream spelling would conclude the metric has one name.

⚠️ **A COUNT IS NOT A SEVERITY.** Row 4 (two `get_user_tags`) is 2 definitions and is the most
dangerous row in the table: the two functions return different TYPES (`list[str]` vs `dict`) about
different SUBJECTS (a member vs their tickers), and an editor's autocomplete resolves the collision
without asking. Row 1 is 314 references and is comparatively safe, because both spellings render
in different subsystems that a single change would not silently join.

## A.3 The divergence that is NOT in the table, and why

The two computations behind row 1 may not be the same number. CLAUDE.md records that the wire's
figure and the collector's *"reconcile to within a point"* — a hand check, recorded in prose, with
no rail. ⛔ **That is a claim about data, and this appendix only measures NAMES.** D2's job is to
make the two registrations visible; deciding which is right is §10.2's product question.

## A.4 One count in the codebase that has already drifted

`api/services/screener/scan_evaluator.py` — the comment above `SWEEP_HOUR_ET`:

> *"Measured over the manifest 2026-08-09, all **54** declared scalars are unanimous: `cadence:
> nightly`, `store: screener_rows`, `grain: date`. … a **fifty-fifth** scalar with a different
> cadence moves the answer with no edit here."*

Measured 2026-09-12: **137 declared scalars**, and **all three unanimity claims still hold**.

⭐ **The mechanism is right and the number is stale**, which is the most instructive possible
version of this defect: the comment's own last line — *"⛔ NOTHING HAND-LISTS WHICH SCALARS ARE
NIGHTLY"* — is true, and the sentence above it hand-lists a count. §12 item 6 makes fixing it an
acceptance criterion of D2's first increment.

---

# APPENDIX B — REUSE-CLAIM TABLE, VERIFIED AGAINST MASTER BY PATH

> Every claim this PRD inherits from an earlier program artifact, re-checked against
> `origin/master @ ee9c96fa1` this pass. **VERIFIED** = true as stated · **MOVED** = true, different
> path · **CHANGED** = the fact moved · **GONE** = no longer true.

| # | claim | source artifact | path checked | verdict |
|---|---|---|---|---|
| 1 | D2 is NOT BUILT and on the critical path | `PROGRAM_STATUS.md:474` | whole repo — no `canonical_data_model`, no metric-address module | **VERIFIED** |
| 2 | DEC-14 has not self-expired | `provider-abstraction-prd.md:37` | `ARCHITECTURAL_DECISION_REGISTER.md:186` — status still RECOMMENDED, REVERSIBLE, self-expiring | **VERIFIED** |
| 3 | S8's full `<Cited>` is D2-gated | `PROGRAM_STATUS.md`, `provenance-freshness-spec.md` §19 Step 4 | `app/src/components/provenance/Cited.jsx` header states it in-file | **VERIFIED** |
| 4 | `<Cited>` accepts a `uctUri`-shaped row for forward-compatibility | `provenance-freshness-spec.md` §4.5 | `Cited.jsx:12-20` — the prop shape and the refusal to fabricate a deeper graph are both present | **VERIFIED** |
| 5 | the provenance DATA MODEL lives in D2; S8 only renders it | `capability-infrastructure-matrix.md` | `provider_errors.py:199` holds `ProvenanceRecord`; S8 renders it | **VERIFIED** |
| 6 | S7 predicates read *"values from D2/D3/D4"* | `alerts-monitoring-prd.md` §5.1 | true as an intent; **no S7 type reads an address today** — all three registered types carry private parameter vocabularies | **CHANGED** — the contract is unmet, and §9 is the mechanism it needs |
| 7 | `capability-infrastructure-matrix` D2 row: *"None new — addresses values already computed elsewhere"* | same | confirmed against §6 — all four axes exist in code today | **VERIFIED**, and this pass is the first to test it |
| 8 | *"register `pct_above_50sma` and siblings in D2's metric address book"* | `capability-infrastructure-matrix.md` | `pct_above_50sma` is real (190 refs) — **and the sibling it does not mention, `pct_above_50ma`, is the finding** | **CHANGED** — the claim named one spelling of a two-spelling metric |
| 9 | *"all 54 declared scalars are unanimous"* | `api/services/screener/scan_evaluator.py` in-code comment | `ast_lint.TABLE['scalars']` → **137**; unanimity holds on all three axes | **CHANGED** — mechanism right, count stale by 83 |
| 10 | D1 shipped; adoption partial — *"18 files on the fmp_client adapter, 35 still calling FMP directly"* | `provider-abstraction-prd.md:37` | `tools/fmp_guard_census.py` now reports **0 unquarantined violations / 11 quarantine entries**, GREEN | **CHANGED** — the census was red when that line was written and is green now; the 18/35 split no longer describes the repo |
| 11 | `symbol` leaks to 41 call sites / 15 modules | `provider-master-ledger` §2.2 row 1 | measured differently this pass (DDL columns, not call sites): `ticker` 33 tables, `symbol` 26, `sym` 16 | **CHANGED** — not contradicted, but measured on a different axis; the original count was not reproducible from the stated method |
| 12 | six independent `_fmp_get` helper implementations share no budget (TD-29) | `capability-infrastructure-matrix.md` | census: **0** `_fmp_get`-shaped definitions outside `fmp_client.py` remain unquarantined | **CHANGED** — D1 + G1 closed this |
| 13 | TD-08: *"one number/percent/date formatter… 118 files define their own today"* | `presentationFormat.js` header, quoting TD-08 | S10 shipped 2026-09-12 (`3c539d011`) for the S8 family only; the 118 is **not re-measured this pass** and stays an inherited, unverified count | **MOVED** — the claim now has a partial remedy; the number itself is uncorroborated |
| 14 | `MobileChartFallback`, `BrokerEquityCurve`, `NHNLModal` etc. are orphaned | CLAUDE.md unreachable table | not re-checked — out of D2's scope | **not checked** (stated rather than claimed) |
| 15 | entity ids are every consumer's foreign key going forward | `entity-master-prd.md` §6.4 | S3 shipped; `predicates.resolve_entity_scope` uses it; ⚠️ but the 75 tables in row 11 above are still keyed by a ticker STRING | **CHANGED** — true of new code, not of the existing schema, and D2 must not pretend otherwise |

⛔ **ROW 10 AND ROW 12 ARE THE SAME CORRECTION SEEN TWICE, AND IT MATTERS FOR SEQUENCING.** Two
program artifacts describe a D1 adoption state that is two weekends stale. D2's sizing must be done
against the census's live output, not against those sentences — **which is exactly the mistake G3's
own sizing caught in September ("blocks `fundamentals_bulk`'s 30–70 MB CSVs" — there are no CSVs)**.
