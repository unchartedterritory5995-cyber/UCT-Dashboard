---
id: GATE-D5-REFERENCE-CORP-ACTIONS
title: D5 — Reference Data & Corporate Actions — pre-implementation gate
role: the approval packet. Nothing builds until an approval line is signed, and nothing builds past the scope that line names.
status: ✅ CP1 APPROVED 2026-09-12. CP2-CP7 UNSIGNED — each needs its own line.
date: 2026-09-12
measured_against: origin/master @ ffa8102c7
pairs_with: PRD-D5-REFERENCE-CORP-ACTIONS · SPEC-D5-REFERENCE-CORP-ACTIONS
confidence: >
  🟢 on every count and classification below — each was produced this pass by a script over
  prose-stripped source, with controls, and the method is in PRD Appendix A. 🟡 on the
  checkpoint shapes and sizes, which are proposals. 🔴 on nothing.
evidence_ceiling: >
  Inherits PRD-D5-REFERENCE-CORP-ACTIONS's five named ceilings verbatim and adds nothing.
  The two that bear on SIGNING rather than on building are restated at §8, where they bite:
  **no production read of any kind happened this pass** — so `BARS_SPLIT_REPAIR_ENABLED`'s live
  value and whether `entity_master.db` has ever been seeded in production are both UNKNOWN, and
  the second one changes CP5's size.
sources: see PRD-D5-REFERENCE-CORP-ACTIONS's `sources`.
---

# ✅ CP1 APPROVED — the corporate-actions census, and nothing else

## ⛔ APPROVAL — CP1 ONLY

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-12
APPROVED AT SHA:  96fa0e5d4   (git hash-object of this packet as it stood at
                  approval, with this field blank)
SCOPE APPROVED:   CP1 - the corporate-actions census. One DERIVED inventory of
                  every corporate-action provider READ and every adjustment
                  APPLICATION in the repo, three-state (outstanding / migrated /
                  deliberately outside with a written reason), plus a rail that
                  fails BY NAME on a new unregistered one.

                  INSTRUMENT ONLY. No ledger, no producer, no reader migrated,
                  no product module edited, no store touched, no member-visible
                  change. tools/** + tests/** only.

                  CP2-CP7 EACH NEED A NEW LINE.
```

> ⛔⛔ **CP2 THROUGH CP7 ARE NOT AUTHORIZED.** They remain PROPOSALS, and the two that touch an
> INERT STRAND (CP4 and CP7, both reaching `bars_sanitize.py`, which flow-worker RUNS and does
> not WATCH) need their live-or-incidental classification settled on the line that approves
> them, not afterwards.

⚠️ **AND A SIGNED LINE MUST NAME A CHECKPOINT, NOT "D5".** The PRD's §8 argues that *"the day D5
ships"* is not a checkable condition; an approval line reading "build D5" would reproduce that
defect inside the approval itself. This is the same correction the D2 gate recorded at line 32
of its own packet.

---

## 1. What is being asked for, in one paragraph

Give the corporate actions this codebase already handles — in at least nine places, from five
providers, with four independent price-rescaling mechanisms and zero labels — **one authority,
one ledger and one adjustment-basis label**, composed on D2's shipped address grammar and S3's
shipped identity-event contract, inventing neither. **No member-visible change at any proposed
checkpoint. No rewrite of any working reader. No second authority over anything S3 owns.
Revertible at every phase by deleting files or rows.**

---

## 2. ⛔ THE THREE FINDINGS THAT SHOULD DECIDE THE SHAPE OF THE ANSWER

### 2.1 The problem is not a missing feed. It is five feeds and no name.

Measured this pass over prose-stripped source (PRD §6.1):

| provider · endpoint | module | consumers |
|---|---|---|
| **FMP** `/stable/splits` | `bars_sanitize.py:265` | 4 |
| **Massive** `/v3/reference/splits` | `polygon_extras.py:252` | 1 (voice) |
| **Massive** `/v3/reference/dividends` | `polygon_extras.py:204` | 1 (voice) |
| **Massive** `/v3/reference/dividends` | `breadth_dividends.py:60` | 4 |
| **yfinance** `.dividends` / `.splits` / `.calendar` | `dividends_calendar.py:171-189` | 1 |
| **Massive** `/v3/reference/splits` | `massive.py:1557` | ⚰️ **0** |
| **static JSON**, 6 + 6,177 rows | `delisted_registry.py:27-32` | 7 |

⛔ **AND THREE OF THEM ARE ALREADY ON A QUARANTINE LIST WITH A REASON.**
`tools/massive_guard_census.py:57-72` carries `polygon_extras.py`, `breadth_dividends.py` and
`audit.py`, each with *"not part of this build's approved narrow slice"*, pinned exactly by
`tests/test_massive_guard_census.py:31-49`. ⭐ **D1's own instrument already knows this is
outstanding debt. D5's first checkpoint should be shaped by that instrument rather than beside
it.**

⚰️ **This corrects an inherited claim, and the correction matters for sizing.**
`data-architecture.md:568-570` states Massive's reference endpoints *"could plausibly serve
symbol-change events but have never been enumerated."* Two of the three are **already wired to
product code**. What has never been enumerated is `/v3/reference/tickers` **as a symbol-change
signal** — a much smaller job than the sentence implies.

### 2.2 ⭐⭐ THE LOAD-BEARING INSIGHT: S3 ALREADY BUILT D5'S JOIN POINT AND IT HAS ZERO WRITERS

`api/services/entity_master/schema.py:107`, verbatim:

```
source          TEXT NOT NULL,              -- 'd5' | 'reconciliation' | 'admin_manual'
```

Measured over prose-stripped code, whole repo: **the token `d5` occurs in exactly one place — that
DDL string.** No code path anywhere passes `source='d5'`.

And the contract it feeds is finished: six typed event payloads
(`entity-master-spec.md:289-306`), all six implemented and validated
(`entity_master/api.py:233-310`), behind one idempotent, collision-rejecting write gate
(`api.py:186-231`).

> ⭐ **D5 is not a system that needs designing into S3. It is the missing WRITER of a contract
> S3 finished, typed, tested and named after it.**

⛔ **THE CONSEQUENCE FOR THIS GATE: a proposal that designed its own identity model would be the
wrong answer to a measured question**, exactly as D2's gate said of its own address book. The
spec's entire S3 surface is one function call with `source='d5'`.

### 2.3 The absence that is real, and the absence that is not

| claimed absent | measured |
|---|---|
| an M&A / spin-off / rights / buyback event feed | ✅ **GENUINELY ABSENT.** A probe over prose-stripped product code for `merger`, `acquisition`, `takeover`, `spinoff`, `spin_off`, `spin-off`, `rights issue`, `buyback` returns **20 files, every hit an LLM prompt, a news keyword/regex, or a detector explanation.** `spinoff` variants: **0 occurrences anywhere.** **Control:** the identical probe for `delist` over the identical population returned **28 files / 139 occurrences** including real structured handling — the instrument can see a present corporate-action concept |
| a corporate-action feed at all | ⛔ **NOT ABSENT** — §2.1 |
| a place to record a merger | ⚰️ **ONE, AND IT IS PROSE.** `api/data/delisted_tickers.json` holds 6 rows, all 6 with a `reason`; the first reads `"Acquired by Verizon; renamed Altaba"` — an acquisition and a rename in one free-text string, whose successor `AABA` is a separate row in the 6,177-row bulk file (**0** of which carry a reason). S3's `entity_relations` declares exactly the right shape — `CHECK (kind IN ('successor','predecessor','share_class'))`, `schema.py:95` — and has **zero product writers** |

---

## 3. The four decisions this packet asks the owner to make

### D5-A — Is the scope "one ledger + one label", or "ratify the four mechanisms in place"?

**Recommended: ONE LEDGER + ONE LABEL, and move nothing.** PRD §9, §10.1. All four rescaling
mechanisms are correct for their own caller and one of them spans two repositories. ⭐ **The
label is what turns four correct local answers into one answerable global question without
touching any of them.** The alternative — unify the mechanisms first — starts by making three
working things worse to prove a point.

### D5-B — DEC-15's expiry condition

**Recommended: replace *"retire the day D5 ships"* with the three-clause, per-EVENT-TYPE
condition of PRD §8.1, written into the decision register verbatim and citing its census rail by
test name.**

⛔ **This is the one item in the packet that changes an existing accepted decision, so it is
called out rather than buried** — the same courtesy D2-B was given.

⚰️ **AND THE CURRENT WORDING IS WORSE THAN DEC-14's WAS, FOR A MEASURED REASON.** DEC-14's
*"the day D2 ships"* was unevaluable. DEC-15's *"retire the day D5 ships"* is unevaluable **and
describes something that is not happening**: measured this pass, S3's interim reconciliation job
has **no scheduler entry at all** — `entity_master` appears in `api/main.py` exactly twice, at
`:100` (the admin-router import) and `:7950` (its `include_router`), and
`reconciliation.py:44-52` says the omission is deliberate. `entity-master-spec.md:651-653`
describes it as *"registered in `api/main.py`'s existing APScheduler instance."* It is not.
⭐ **An expiry condition phrased as "retire the running thing" reads satisfied and unsatisfied
at the same time when the thing does not run.**

**The proposed replacement's current value is computable today and it is a table** (PRD §8.2):
**0 of 6 event types satisfy clause 1; 2 of 6 have an interim producer to retire.**

### D5-C — Does the split list migrate before or after the adjustment label?

**Recommended: the LABEL waits, the CENSUS goes first, and the SPLIT LIST is second.** PRD
§10.2. The label is the only item in the census that is member-visible
(`data-architecture.md:550` puts the string on the chart), so it is a product decision about
what a member is told. ⛔ **The honest cost, stated: the most quotable finding in the PRD —
four mechanisms, three bases, zero labels — is the LAST thing fixed, not the first.** That is a
real delay to a real member-facing gap and it is the owner's call, not this packet's.

### D5-D — Does D5 own the delisted registry, or seed from it?

**Recommended: SEED FROM IT, and delete nothing.** PRD §7.5. It holds facts S3 cannot
re-derive: 6 curated `reason` strings, and 6,177 rows carrying `provider_symbol`, `first_date`,
`last_date` and `bare_live` — the reused-ticker disambiguation (`delisted_registry.py:52-59`)
that keeps Bear Stearns' `BSC` apart from today's live `BSC` ETN. ⭐ **That is a
corporate-action fact recorded in the only place that has ever recorded it.**

⚠️ **The cost of this recommendation, stated: two delisting authorities keep coexisting for
now**, and `/api/ticker-search` keeps merging both (`ticker_search.py:152` and `:187-196`). D5
makes the divergence nameable; it does not resolve it in any proposed checkpoint.

---

## 4. Proposed checkpoints, so an approval line can name ONE

| CP | scope | strands anything? | size |
|---|---|---|---|
| **CP1** | **The corporate-actions census.** One derived inventory of every corporate-action provider READ and every adjustment APPLICATION in the repo, with a three-state classification (*outstanding · migrated · deliberately outside, with a written reason*) and a rail that fails **by name** on a new unregistered one. **Instrument only — no ledger, no producer, no reader migrated, no product module edited.** | **no — and by construction, not by luck.** `reachable_paths()` returned 154 paths, **all under `api/`**; CP1 lives entirely in `tools/**` + `tests/**` | **S** |
| **CP2** | **The ledger, INERT.** `corp_actions.db` + its one self-declaring `CREATE TABLE` literal + the D2 builder extension that derives its five metrics by AST. Written by nothing, read by nothing; the derivation rail and the axis report extended to the new store. | no — inert data, and the new module is outside flow-worker's closure if it adds no import to `api/services/{bars_*,entity_master}` | **S/M** |
| **CP3** | **One confirmed source.** The Massive `/v3/reference/splits` read moves behind a D1 adapter and WRITES `confirmed` rows. Nothing reads them. `polygon_extras`' quarantine entry is removed rather than a second list added. | no | **M** |
| **CP4** | **The split list, DARK.** `bars_sanitize._fetch_meta`'s FMP call is dual-computed against D5's ledger: both computed on every call in test and on a sampled fraction in production, log-only, never raising, **serving the legacy value**. Four outcomes, never a rate. | ⚠️ **YES — `bars_sanitize.py` is an INERT STRAND** (flow-worker RUNS it, does not WATCH it). Must be classified live-or-incidental BEFORE merge; if live, a marker bump and an after-hours window | **M** |
| **CP5** | **`source='d5'` for two event types.** A producer emits `delisted` + `new_entity` through `entity_master.api.apply_event` with `source='d5'`, compared on the same run against the interim job's proposals. Retires DEC-15 clauses 1-3 for those two types only. | no, **provided the producer is a new module that adds no import to `entity_master/**`** (which flow-worker RUNS) | **M** |
| **CP6** | **`symbol_change` → `renamed`, and `merger` → `relation_added`.** The first sourced rename events; S3's `renamed` and `relation_added` get their first product writers. | no | **M/L** |
| **CP7** | **The adjustment-basis label.** `AdjustmentBasis` written where the adjustment is decided, carried on the served payload, rendered by S8. ⛔ **The first member-visible change in the programme** and the first that needs its own explicit line. | ⚠️ **YES** — touches `bars_split_repair.py` and `bars_sanitize.py`, both INERT STRANDS | **L** |

⛔ **CP4 AND CP7 ARE THE TWO THAT CAN STRAND, AND THEY ARE NAMED HERE RATHER THAN DISCOVERED AT
MERGE TIME.** `tools/flow_worker_watch_coverage.py` decides it; `docs/runbooks/deploy-windows.md`
is the authority on the window, and a red there is a REVIEW GATE, not a block.

⛔ **AND NOTHING ABOUT THE BREADTH DIVIDEND BASIS IS IN ANY CHECKPOINT.** It is deliberately
excluded: the collector that produces the `auto_adjust=True` basis lives in a **different
repository** (`breadth_dividends.py:4-6`), so reconciling it is a two-repo change, and
`product-architecture.md:636` already calls it "its own project". **D5 makes that divergence
nameable; it does not get to resolve it.**

---

## 5. ⭐ THE RECOMMENDATION — SIGN CP1 ALONE, OR SIGN NOTHING YET

### 5.1 Why CP1 is the smallest thing worth having on its own

**Because two corporate-action modules in this repo are built, tested, green and reachable by
nothing, and a script found both this afternoon while nobody had noticed either.**

| module | importers | measured how |
|---|---|---|
| `api/services/massive.py::get_split_tickers` (`:1557`) | **0 — the only occurrence of the name in the repo is its own `def`** | AST over import statements + name occurrences; controls `bars_sqlite` → 106 and `no_such_module_xyz` → 0 |
| `api/services/screener/dividend_join.py` | **0 product importers** — its only importer is `tests/test_screener_dividend_join.py:102` | same |

⭐ **That is `lesson_built_tested_green_and_unreachable`, twice, inside D5's own subject area.**
Both are good code. Neither is reachable. Nothing in the repo reports it. **A census is worth
having on its own because it is the only artifact that would have said so** — and because
DEC-15's replacement expiry condition (PRD §8.1) cites it BY TEST NAME, so without CP1 that
condition is an intention rather than an instrument.

### 5.2 It is revertible by deletion — exactly two files

```
tools/corp_actions_census.py        (new)
tests/test_corp_actions_census.py   (new)
```

**Revert = delete both.** No product module is edited, no store is touched, no schema changes,
no member-visible value moves, and no file in flow-worker's 154-module import closure is in the
diff — measured, not assumed: every reachable path is under `api/`.

### 5.3 What CP1 costs, stated plainly

| | |
|---|---|
| **size** | two files. The population it enumerates is known: **8 provider-read sites, 5 adjustment mechanisms across ~20 call sites, 6 S3 event types, 2 delisting authorities.** The v-next of the scripts that produced PRD Appendix A |
| **member-visible change** | **none.** CP1 ships nothing a member can see, and that is the point |
| **schedule cost** | it delays every other checkpoint by one review cycle. That is the honest trade: nothing is measured twice, but nothing is fixed yet either |
| **the way it can be wrong** | ⛔ **a census that under-enumerates reads as coverage** — the same failure `desk_session_audit` was written against (*"an audit nobody runs is worse than none"*). Mitigated three ways, all mandatory: (a) the non-vacuity control names a **specific expected member** — `bars_sanitize.py`'s FMP read and `polygon_extras.py`'s Massive read must both appear or the rail fails — never a count; (b) a planted-offender test proving a new unregistered read is reported **by name**; (c) a test asserting the census is actually invoked by a test |
| **the way it CANNOT be wrong** | it changes no behaviour. There is no rollback beyond `git rm` |

### 5.4 And CP1 carries the one correction that should not wait

`docs/feature_flags.json` holds **127 flags** and **zero** whose name contains `SPLIT`,
`DIVID`, `SANITIZE`, `ENTITY`, `DELIST` or `RECONCIL` — correctly, because its `_readme` scopes
it to *"every feature GATE that is OFF unless something turns it on"* and
`BARS_SPLIT_REPAIR_ENABLED` defaults **ON** (`bars_split_repair.py:76`).

⛔ **So the one switch that decides whether member-visible prices are being rescaled by a
price-inference detector right now is outside the one instrument that exists to tell "off" from
"off on purpose"** — while two accepted program artifacts (`data-architecture.md:566`,
`product-architecture.md:638`) assert it is `0` on web and this pass could not verify it.
**CP1's census must report every corporate-action gate and its default, so the question is
answerable from the repo rather than from a memory of a Railway read.**

---

## 6. ⛔ The four mandatory §2a checklist items, answered in advance

The S7 completion plan's checklist was written for trigger types; three of its four generalise
to D5 exactly, and the answers belong in the packet rather than being rediscovered.

### 1. PIN EVERY SHAPE AT REGISTRATION, INCLUDING THE ONES NOTHING POPULATES YET

**Answered in SPEC §2.1 and §2.2.** `action_type` is free-text TEXT with **no CHECK**, so
`spinoff` is later a VALUE and not a migration (DEC-08 stays reversible). Three date columns are
declared although only `effective_date` is currently non-null for every type.
`successor_entity_id` is declared although **zero rows will carry it before CP6**.

⭐ Each is the same call F-S7-2 made for `trendline`, F-S7-CM-1 made for `catalyst_types`, and
D2 spec §1.2 made for `as_of`: pin the wider shape, populate the narrow one, and do not let a
schema teach the next engineer that the narrow shape is the whole shape.

⛔ **And the strongest instance is not D5's at all** — `event_proximity.py:75-76` already
declares `DIVIDEND = "dividend"` in `EVENT_KINDS` and `:185` refuses to fire on it. **D5 is what
populates a shape S7 pinned weeks ago.**

### 2. THE COMPARISON IS FORWARD-ONLY, AND SHIPS WITH THE REPORT THAT READS IT

**Answered in PRD §8.3 and SPEC §7 row 10.** CP4's dual-compute and CP5's producer comparison
are both forward-only, four outcomes, never a pass rate.

⛔ **The refusal of replay here has a root the earlier four did not: a corporate-action feed is
a statement about the PRESENT state of a reference universe.** Massive's `active` flag has no
"as of last Tuesday". Asking whether D5 and the interim job agreed about a past instant is not
a question the feed can answer, so they run on the same tick or the comparison is not made.

### 3. NAME THE THING THAT CALLS IT, AND THE RAIL THAT ASSERTS THE CALL SITE EXISTS

> **At CP1 the answer is: NOTHING CALLS IT, because CP1 ships no ledger and no producer.** The
> census is an instrument and its rail asserts that no product path reads it — **and separately
> that a TEST does**, so it cannot become an audit nobody runs.
>
> **At CP4: `bars_sanitize._fetch_meta`'s call site calls it**, and the rail asserts that exact
> call site — the same shape as `catalyst-match`'s
> `test_the_harness_is_the_only_caller_of_would_fire`, which exists because `price-level` merged
> with eighteen green tests and nothing calling its evaluator.
>
> **At CP5: the producer calls `entity_master.api.apply_event` with `source='d5'`**, and the
> rail asserts the literal at the call site — because `schema.py:107` has reserved that value
> since S3 shipped and nothing has ever supplied it.

⛔ **REGISTRATION IS NOT ACTIVATION.** A declared metric is not an addressable one; a ledger row
is not an applied adjustment; and a `detected` row is not a `confirmed` one.

### 4. A LIVENESS STAMP, NOT JUST A RESULT STORE

⚠️ **THIS DOES NOT APPLY AT CP1 AND SAYING SO IS THE HONEST ANSWER.** There is no sweep, no tick
and no dark run — CP1 is a script and a test. It applies at **CP4**, where the dual-compute
harness needs the heartbeat every S7 harness carries: a monotonic tick count and a wall-clock
stamp written on **every** tick including the quiet ones.

⛔ Marking it "satisfied" at CP1 would be the worse answer. *A checklist item declared met where
it does not apply is how a checklist stops being read.*

---

## 7. What this packet does NOT ask for

- **No M&A / spin-off / rights / buyback event calendar.** DEC-08 defers it; §2.3 measures that
  nothing structured exists for any of the four; SPEC §9 item 1 keeps the shape open so the
  deferral stays reversible.
- **No deletion of `delisted_registry`.** D5-D.
- **No column added to `ohlcv`.** It is `(ticker, tf, ts, o, h, l, c, v)`
  (`bars_sqlite.py:138-144`) and 38 product modules read it directly.
- **No column added to `bar_provenance`** without a measurement — SPEC §3.2, and the previous
  `bars_provenance` table held **0 rows with 8 call sites, all 8 in a test file**
  (`bars_sqlite.py:149-158`).
- **No change to `bars.db`'s newest-bar-wins invariant.**
- **No re-implementation of the split detector.** `bars_sanitize.unadjusted_splits` /
  `split_factor` / `scale_bar` stay the only split judgement in the repo, deliberately
  (`bars_split_repair.py:40-44`).
- **No second authority over anything S3 owns.** PRD §7 — and SPEC §7 rail 7 is an AST rail that
  fails by name if a D5 module writes an S3 table directly.
- **No breadth-basis reconciliation** (two repos).
- **No member-visible change of any kind before CP7, and CP7 needs its own line.**

---

## 8. ⚠️ The evidence gaps in this packet, stated where they bite

### 8.1 No production read of any kind happened this pass

- **`BARS_SPLIT_REPAIR_ENABLED`'s live value is UNKNOWN.** Two accepted artifacts say `0` on
  web; the code default is `1`. That variable decides whether mechanism B is rescaling
  member-visible prices right now, and the comment above its call site
  (`bars_sanitize.py:568-585`) records the last time everyone was wrong about it. ⭐ **One
  `railway variables --service web --kv` answers it, and it is the cheapest thing in this
  packet.**
- **Whether `entity_master.db` has ever been seeded in production is UNKNOWN.** ⛔ **This one
  changes CP5's size, not just its confidence:** if the store is empty in production, CP5's
  producer has nothing to emit events against and the seed becomes a prerequisite rather than a
  precondition. `GET /api/admin/entity-master/status` returns row counts plus `last_seed_at` /
  `last_reconcile_at` derived from the event trail (`entity_master_admin.py:179`), and the
  router IS mounted (`api/main.py:7950`). ⭐ **One admin GET. If the owner wants CP5's size
  before signing anything past CP1, that is the read to take.**

### 8.2 The JavaScript half of the repo was not censused

The `ast` stripper is Python-only. Every count in this packet is over `api/**`, `tools/**`,
`scripts/**`, `tests/**`. A corporate-action concept living only in `app/src/**` is invisible
here. ⛔ **CP1's census must state this ceiling in its own output rather than presenting a
Python count as a repository count** — otherwise the instrument reproduces its own blind spot.

### 8.3 No vendor payload was fetched

Every field name attributed to `/v3/reference/{splits,dividends}` in SPEC §2 is read from **this
repo's own parsing code** (`polygon_extras.py:213-222`, `:261-268`; `breadth_dividends.py:132`;
`bars_sanitize.py:272-281`), never from a live response. ⚠️ If a field this schema declares does
not exist on the wire, CP3 finds out — which is one more reason CP3 precedes CP4.

---

## 9. ⭐ WHAT A FUTURE APPROVAL LINE WOULD NEED TO NAME

A line that grants anything past CP1 must supply all of the following, or it is not evaluable
and the checkpoint should not start:

1. **ONE checkpoint id** from §4 — `CP1`, `CP2`, … — and never the word "D5". §Approval.
2. **The SHA it was approved at.** The D2 packet's own convention: `git hash-object` of the
   packet as it stood at approval, with that field blank.
3. **For CP4 and CP7 — an explicit statement about the INERT STRAND.** Both touch
   `bars_sanitize.py`, which flow-worker RUNS and does not WATCH. The line must say either
   *"flow-worker's reachability of `bars_sanitize` is incidental, no marker bump"* or *"marker
   bump, after-hours window"*, and the evidence for whichever it says. ⛔ **A line that is silent
   here authorizes two copies of one split judgement in two processes.**
4. **For CP5 and CP6 — whether `entity_master.db` is seeded in production**, per §8.1. A line
   granting CP5 without that read is granting an unsized checkpoint.
5. **For CP7 — the member-facing SENTENCE**, or an explicit deferral of it to S8/S10. CP7 is the
   first member-visible change in the programme; `data-architecture.md:550` proposes
   `"split-adjusted, 2026-09-02"` and `"as reported"`, and whether a member sees those exact
   words is a product decision this packet does not make.
6. **For D5-B — whether the register is edited in the same commit.** DEC-15's replacement text
   is PRD §8.1 verbatim. ⛔ **If the clause is approved but not written into
   `ARCHITECTURAL_DECISION_REGISTER.md`, the register keeps carrying an unevaluable condition and
   the next reader inherits it** — which is precisely how the current one survived.
7. **What is NOT approved**, in the same block. Every prior line in this programme that ended
   `"CPn+ NEED NEW LINES"` was read correctly; the ones that did not say it were argued about.

⚠️ **And one thing a line must NOT do: authorize a `renamed` event from an inference.**
`reconciliation.py:24-32` refuses to correlate a delisting with a new listing because the
correlation needs a corporate-action signal. ⛔ **D5 supplies the signal; it does not acquire
permission to guess.** A `symbol_change` row whose `source_activity` cannot be named must stay
`detected` and emit nothing, whatever a line says.

---

## 10. Recommendation

**Sign CP1 alone, or sign nothing yet.**

CP1 is two files in `tools/` and `tests/`, revertible by deletion, provably outside flow-worker's
import closure, and it changes no behaviour anywhere. It is the smallest thing that makes this
codebase's corporate-action handling say its own name out loud — and it is the instrument
DEC-15's replacement expiry condition cites by test name, without which that condition is an
intention.

⛔ **And the finding that should make CP1 feel urgent rather than procedural is not the five
providers. It is that a script found two unreachable corporate-action modules in an afternoon,
and neither had been noticed by anyone.** A ledger built on top of a population nobody has
enumerated would be the sixth authority over the same facts.
