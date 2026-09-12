---
id: GATE-D2-CANONICAL-DATA-MODEL
title: D2 — Canonical Data Model & Metric Address Book — pre-implementation gate
role: the approval packet. Nothing builds until an approval line is signed, and nothing builds past the scope that line names.
status: ✅ CP1 APPROVED 2026-09-12 and BUILT (`b9783d509`). CP2+ need new lines.
date: 2026-09-12
measured_against: origin/master @ ee9c96fa1
pairs_with: PRD-D2-CANONICAL-DATA-MODEL · SPEC-D2-CANONICAL-DATA-MODEL
---

# ✅ CP1 APPROVED — D2 pre-implementation gate

## ⛔ APPROVAL — CP1 ONLY

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-12
APPROVED AT SHA:  1a0adb471
SCOPE APPROVED:   CP1 - inert canonical address data (the ratified form written
                  down as data, not read by any product path) + the derivation
                  rail that fails when a scalar name, store, cadence, or grain
                  diverges from closedTable.json. Fix the scan_evaluator.py
                  "54 scalars" comment to derive from the table, per its own last
                  line. No reader migrated, no schema change on live stores.

                  CP2+ NEED NEW LINES.
```

**Delivered:** `b9783d509` on `origin/master`, 2026-09-12. **ADDITIVE** - 5 files, zero in
flow-worker's 154-file import closure, confirmed with `reachable_paths()`. No marker bump.

⚠️ **THE SCOPE LINE NAMES A CHECKPOINT, NOT "D2", AND THAT WAS THE POINT.** The PRD's §8 argues
that *"D2 ships"* is not a checkable condition; an approval reading "build D2" would have
reproduced that defect inside the approval itself.

### The four rulings, as given

| | question | ruling |
|---|---|---|
| **D2-A** | ratify-and-widen vs design | **A - ratify** `closedTable.json` + `resolve_entity_scope` + `ProvenanceRecord` + the timeframe map, and widen. No second model |
| **D2-B** | DEC-14's expiry | **YES** - replace *"the day D2 ships"* with the three-clause per-call-site condition over the census, written into the decision register verbatim and citing the census rail by test name |
| **D2-C** | the ad-hoc metric key | **A - kill it.** `indicator-condition` waits on D2 CP1 **plus the first non-screener store**; the dependency is recorded in the S7 plan |
| **D2-D** | first consumer | **YES - S7.** Dark, weekly vocabulary, lowest blast radius |

### What CP1 actually shipped

| | |
|---|---|
| `api/data/canonical_address_book.json` | **137 metrics**, derived; `git add -f` (see below) |
| `tools/build_canonical_address_book.py` | the derivation, with `--check` |
| `tests/test_canonical_address_book.py` | 12 tests - the four-field rail, the axis report, the inertness rail |
| `api/services/screener/scan_evaluator.py` | the "54 scalars" comment fixed, retired sentence kept verbatim |
| `.gitignore` | one comment; see §2b |

**Mutation record, each restored by re-deriving or by edit:**

| # | mutation | result |
|---|---|---|
| H | a metric's **cadence** diverges from the table | **2 RED** |
| I | a scalar **name** the table declares is missing | **8 RED** |
| J | a **product path** references the book | **1 RED** - the inertness rail, by name |

## 2b. ⚠️ TWO THINGS THE RAILS CAUGHT WHILE BEING WRITTEN

**1. The book would not have been committed.** `.gitignore`'s `data/` excludes `api/data/`, so the
file needs `git add -f`. ⛔ A generated file nobody can diff in review is a second authority with
extra steps, and the rail that asks git whether the file is tracked is what caught it.

**2. ⚰️ AND THE NEGATION THAT LOOKS LIKE THE FIX CANNOT WORK.** Git cannot re-include a file whose
PARENT DIRECTORY is excluded, so a `!api/data/<file>` line reads like a working mechanism and does
nothing. ⚠️ **That is also true of the existing `!api/data/voice_kb/**` lines** - those files are
tracked because they were force-added, not because of the negation. Recorded in `.gitignore`, not
fixed; they are not this program's.

---

## 1. What is being asked for, in one paragraph

Ratify the canonical form the codebase already has — four axes, three of them live and correct —
as one derived manifest with one resolver, so that S7 predicates, S8's recursive `<Cited>` and
DEC-14's expiry condition each have something to point at. **No member-visible change. No rewrite
of any live reader. Revertible at every phase by deleting rows from a manifest.**

---

## 2. ⛔ THE FINDING THAT SHOULD DECIDE THE SHAPE OF THE ANSWER

> **The owner's instruction was "find the implicit canonical form; the spec ratifies it rather than
> inventing a second." It was found, and it is better than expected.**

`app/src/components/chart/engine/ast/closedTable.json` is a genuinely closed, 137-entry manifest
with unanimous axes — one store, one cadence, one grain — read by both the JS parser and the Python
evaluator, with **zero** entries whose canonical name differs from their column, and with
`cadence_ceiling(tree)` already DERIVING a scheduling decision from it rather than from a hand
list. Three separate modules correctly derive the timeframe map from its declared authority instead
of retyping it.

⭐ **This codebase does not need to be taught the idea. It has the idea, in production, working.**
What it does not have is that idea applied past one store — `closedTable.json` can address a
nightly screener column and nothing else: not a bar, not a quote, not a fundamental.

⛔ **THE CONSEQUENCE FOR THIS GATE: a proposal that designed a new address book from first
principles would be the wrong answer to a measured question.** The spec's §2.1 schema change is
exactly one field.

---

## 3. The four decisions this packet asks the owner to make

### D2-A — Is the scope "ratify and widen", or "design"?

**Recommended: RATIFY AND WIDEN.** §2. The alternative is a second authority over a form that
already works, which is the defect this whole programme keeps paying for.

### D2-B — DEC-14's expiry condition

**Recommended: replace "the day D2 ships" with the three-clause, per-call-site condition of PRD
§8.1, and make the programme-level expiry a query over the census.**

⛔ **This is the one item in the packet that changes an existing accepted decision**, so it is
called out rather than buried. The current wording is not checkable in either direction: the
exception either expires while most call sites have nothing to point at, or never expires because
"D2 shipped" is arguable forever.

⭐ **The instrument already exists and is GREEN.** `tools/fmp_guard_census.py`, measured this pass:
0 unquarantined literals, 0 unquarantined `_fmp_get`-shaped definitions, 11 quarantine entries each
carrying its own reason. ⚠️ One of those eleven — `api/services/news/adapters/fmp_news.py` — carries
the G5 ruling of 2026-09-12 saying it must **never** migrate. **So the condition must distinguish
"not yet addressed" from "deliberately outside", or it can never reach zero.**

### D2-C — `indicator-condition`: kill the ad-hoc metric key, or keep it with a sunset?

**Recommended: KILL IT.** PRD §9. The argument is measured, not aesthetic: this codebase has run
the ad-hoc-key-with-good-intentions experiment twice and **both keys are still live** —
`_LEDGER_TIMEFRAME` (an ad-hoc copy of an authoritative map, shipped with a comment explaining why
it is dangerous) and `pct_above_50ma` (an ad-hoc spelling of a metric that already had one, now in
five files including a live regime classifier).

⛔ **THE HONEST COST, STATED: `indicator-condition` WAITS.** It is sequenced after the address book
has its first axis populated. That is a real delay to a real trigger type and it is the owner's
call, not this packet's.

### D2-D — Does the first consumer have to be S7?

**Recommended: YES.** PRD §10.2. S7 is the only consumer minting new vocabulary every week — three
trigger types registered, each carrying a private parameter set — and it is dark, so a wrong address
costs nothing a member can see. `alerts-monitoring-prd.md` §10 already instructs exactly this.

---

## 4. Proposed checkpoints, so an approval line can name one

| CP | scope | strands anything? | size |
|---|---|---|---|
| **CP1** | The manifest schema + the derivation + the axis-report rail. **Declarations only — no resolver, no consumer.** | no — inert data | **S** |
| **CP2** | The resolver with its five statuses and the non-vacuity contract, plus S7's next trigger type reading through an address in a dark path with a forward-only comparison. | no — dark | **M** |
| **CP3** | Retire the timeframe duplicates onto the declared map (three call sites, one of them frontend). | ⚠️ **YES** — `indicator_alert_evaluator.py` is in flow-worker's import closure and must be classified before it merges | **S/M** |

⛔ **CP3 IS THE ONLY ONE THAT CAN STRAND**, and it is named here rather than discovered at merge
time. `tools/flow_worker_watch_coverage.py` decides it; if it is BEHAVIOUR-CHANGING it needs a
marker bump and an after-hours window.

⛔ **AND NOTHING ABOUT `pct_above_50ma` IS IN ANY CHECKPOINT.** It is the most quotable finding in
the PRD and it is deliberately excluded: it is the one row in the inventory that is member-visible
on **both** sides (the morning wire and the breadth monitor both render it), so reconciling it is a
product decision about which number is right. **D2 makes the divergence nameable; it does not get to
resolve it.**

---

## 5. ⛔ The four mandatory §2a checklist items, answered in advance

The S7 completion plan's checklist was written for trigger types. Three of its four items generalise
to D2 exactly, and the answers belong in the packet rather than being rediscovered.

### 1. PIN EVERY SHAPE AT REGISTRATION, INCLUDING THE ONES NOTHING POPULATES YET

**Answered in SPEC §1.2.** `as_of` is an INSTANT although all 137 current scalars are `grain: date`;
`provider` is optional and its absence is meaningful; `authority` is declared per metric even though
it could be derived per store.

⭐ Each is the same call F-S7-2 made for `trendline` and F-S7-CM-1 made for `catalyst_types`: pin the
wider shape, populate the narrow one, and do not let a schema teach the next engineer that the
narrow shape is the whole shape.

### 2. THE COMPARISON IS FORWARD-ONLY, AND SHIPS WITH THE REPORT THAT READS IT

**Answered in PRD §8.3 and SPEC §5.** DEC-14 clause 2 and CP2's consumer comparison are both
forward-only, four outcomes, never a pass rate. ⛔ **The refusal of replay here has the same root as
the three S7 types': a provider's answer for a past instant is not recoverable.**

### 3. NAME THE THING THAT CALLS THE RESOLVER, AND THE RAIL THAT ASSERTS THE CALL SITE EXISTS

> **At CP1 the answer is: NOTHING CALLS IT, because CP1 ships no resolver.** The manifest is inert
> data and the rail asserts that no consumer reads it yet.
>
> **At CP2: S7's next trigger type calls it, from its dark evaluator, and the rail asserts that
> exact call site** — the same shape as `catalyst-match`'s
> `test_the_harness_is_the_only_caller_of_would_fire`, which exists because `price-level` merged
> with eighteen green tests and nothing calling its evaluator.

⛔ **REGISTRATION IS NOT ACTIVATION.** A declared metric is not an addressable one, and an
addressable one is not a migrated call site.

### 4. A LIVENESS STAMP, NOT JUST A RESULT STORE

⚠️ **THIS ONE DOES NOT APPLY AT CP1 AND SAYING SO IS THE HONEST ANSWER.** There is no sweep, no
tick and no dark run — the manifest is data. It applies at CP2, where the consumer's comparison
harness needs the same heartbeat every S7 harness carries: a monotonic tick count and a wall-clock
stamp written on **every** tick including the quiet ones.

⛔ Marking it "satisfied" at CP1 would be the worse answer. *A checklist item declared met where it
does not apply is how a checklist stops being read.*

---

## 6. What this packet does NOT ask for

- **No column renames.** 75 tables key on a ticker string in three spellings; D2 addresses values,
  it does not rename columns.
- **No migration of Massive's 21 untyped public functions.** Named in PRD §6.3 as the lopsided
  axis — 37 typed FMP functions against 2 typed Massive methods — and sizing it needs its own pass.
- **No resolution of any divergence in the inventory.** §4.
- **No member-visible change of any kind, at any checkpoint.**
- **No point-in-time restatement model.** `data-architecture.md` §26's ceiling stands.

---

## 7. ⚠️ The evidence gap in this packet, stated where it bites

A read-only probe of production `/data/catalysts.db` was attempted this pass and **refused by
tooling policy**. Nothing in the PRD or spec rests on the DISTRIBUTION of values in a production
table, and every count in Appendix A comes from a script over 3,898 source files.

⛔ **Where it would have mattered:** `catalysts.db` is one of the two stores PRD §7 classifies as
authoritative AND not recomputable, and its `catalyst_type` column is unvalidated model output. A
histogram of that column would have told us whether an address for an LLM-graded value can rely on
a stable vocabulary. **It cannot be assumed, and this packet does not assume it** — which is why
`catalyst-match`'s own schema pins that vocabulary OPEN.

⭐ If the owner wants that measurement before signing, it is one read-only query and it is the only
thing in this packet that needs a permission this session did not have.

---

## 8. Recommendation

**Sign CP1 alone, or sign nothing yet.**

CP1 is inert data with a derivation rail — the smallest thing that makes the codebase's existing
canonical form say its own name out loud. It strands nothing, it changes no reader, and it is
revertible by deleting a file.

⛔ **And CP1 carries the one correction that should not wait**, PRD §12 item 6: `scan_evaluator.py`
describes the codebase's own best address book as having **54** entries when it has **137**.
Shipping D2 while that sentence stands would be this programme's most expensive irony.
