---
id: GATE-S7-CATALYST-MATCH
title: S7 trigger type 3 — `catalyst-match` pre-implementation gate
role: the approval packet for the THIRD absorption. Nothing builds past the scope on the approval line.
status: ✅ APPROVED 2026-09-12 — CP1–CP2 only. BUILT AND MERGED the same day. CP3 needs a new line.
date: 2026-09-12
measured_against: origin/master @ faaa30146
---

# ✅ APPROVED — CHECKPOINTS 1 AND 2. Dark, harness-armed predicates only.

## ⛔ APPROVAL

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-12
APPROVED AT SHA:  6a7c6e710   (git hash-object of this packet
                  as it stood at approval, with this field blank)
SCOPE APPROVED:   CP1–CP2 ONLY.
                  CP1 = registration + schema, pinned to EVERY shape the legacy
                        path actually supports.
                  CP2 = dark evaluator + forward-only comparison harness against
                        HARNESS-ARMED predicates, with a non-vacuity control,
                        and the "what calls this evaluator" rail.
                  No delivery import. No projection of member rows. No legacy
                  change.

                  ⛔ CP3 NEEDS A NEW LINE.
```

**Delivered:** CP1 `faaa30146`, CP2 `d9631afa5`, both on `origin/master`, 2026-09-12. Both
**ADDITIVE** — zero changed files in flow-worker's 154-file import closure, confirmed with
`reachable_paths()`. No marker bump. Parity **20/20** throughout.

---

## 1. What this absorbs — read from the code, not from the type's name

`api/services/catalyst/engine.py`. ⛔ **And the first finding is that it is TWO firing rules sharing
ONE dedup table**, which the type's name does not suggest and a schema built on the obvious reading
would have missed entirely.

| | rule A — watchlist | rule B — must-know |
|---|---|---|
| function | `_fire_catalyst_alerts` | `_fire_mustknow_alerts` |
| gate | `CATALYST_ALERTS_ENABLED`, default **ON** | `CATALYST_MUSTKNOW_ALERTS_ENABLED`, default **OFF** |
| cohort | every user with a watchlist row | **admins only** (`_collect_admin_user_ids`, `role='admin'`) |
| condition | the displayed ticker is on the member's watchlist | the row's `grade` is in `CATALYST_MUSTKNOW_GRADES` (default `A,B`) |
| needs a watchlist? | yes | **no — that is its entire point** |
| delivery | `watchlist_alert_service.deliver_alert_payload` | the same function |
| dedup | `catalyst_alerts_fired`, PK `(user_id, ticker, market_date)`, in `/data/catalysts.db` | **the same table, the same key** |

Both are called from `engine.run()`, rule A first (`engine.py:1216`), rule B second.
`store.try_record_alert` is an `INSERT` + `IntegrityError`, so the dedup is atomic rather than
check-then-write.

---

## 2. ⛔⛔ F-S7-CM-1 — THE FIVE SHAPES, AND THREE ARE SURPRISES

*The owner's instruction was to report what was found before pinning the schema. This is that
report; §3 is what was pinned because of it.*

### 2.1 THE TWO RULES SUPPRESS EACH OTHER

They share `(user_id, ticker, market_date)` and rule A runs first. **So for an ADMIN who also
WATCHES the name, the watchlist alert wins and the must-know alert is silently skipped that day** —
that member gets the *watchlist* wording for a grade-A catalyst.

⚠️ **That is not a bug to fix during a migration; it is behaviour to REPRODUCE.** A dark rule that
fired both would report `new_only` on every admin's watchlist, and the comparison would be measuring
the fix instead of the migration.

### 2.2 THE CANDIDATE SET IS `displayed`, NOT `top_12`

Both call sites pass `displayed` — ranked, grade-C excluded. The legacy comment above them says why
in the code's own words: *"a grade-C row hidden from the table shouldn't trigger an alert"*. A rule
built against the SELECTION output rather than the DISPLAY output would alert on names no member can
see.

### 2.3 ⛔⛔ `catalyst_type` IS UNCONSTRAINED MODEL OUTPUT. THERE IS NO CLOSED VOCABULARY, ONLY A PROMPT.

`synthesize.py`'s prompt asks for one of fifteen labels — Earnings, M&A, FDA, Analyst, Contract,
Guidance, Product, Legal, Insider, Index, Offering, Momentum, Sector-wide, Flow, None. And then the
parser does, at `synthesize.py:537`:

```python
"catalyst_type": (parsed.get("catalyst_type") or None),
```

**with no normalisation at all** — two lines under a `grade` that DOES get `_normalize_grade`
(`synthesize.py:342`, coercing to the first character and refusing anything outside `{A,B,C}`).

⭐ **This is the `line`-alert_type discovery of F-S7-4 one level up.** The tempting reading is
*"fifteen types, pin them as an enum"*, and it would have been wrong the first time a model returned
`FDA Approval` instead of `FDA`, or lower-cased one. ⛔ So `catalyst_types` is pinned as an **OPEN**
list of strings matched case-insensitively, and the fifteen are recorded as `CATALYST_TYPE_CONVENTION`
— **derived from the prompt by a test**, so editing the prompt goes red rather than silently
diverging.

### 2.4 `tag` IS closed and deterministic, and is a DIFFERENT AXIS from `grade`

`tagging.py` assigns exactly one of `Earnings > Catalyst > Gapper > News` by rule, never by model.
⭐ Pinning one axis as an enum and its neighbour as an open list, in the same schema, with the reason
stated for each, is the whole point of this checkpoint.

### 2.5 THE MEMBER SET IS `watchlists JOIN watchlist_items` AND NOTHING ELSE

`_collect_user_watchlist_tickers`'s own docstring says *"any watchlist or flagged ticker"*. The
flagged list IS a `watchlists` row (`is_flagged_list`), so that half is true.

⚠️ **But the seven colour-tag auto-lists (`ticker_tags`) are not in that query**, nor are J2
positions, nor UCT20. **A member who tags a name gold and never adds it to a list is invisible to
this alert.** `member_set` pins all four values so the narrowing is DETECTABLE rather than assumed.

---

## 3. What CP1 pinned, and the F-S7-2 call behind each

| param | pinned | why |
|---|---|---|
| `match_rule` | `watchlist` \| `grade` | §2.1 — both rules, not just the obvious one |
| `member_set` | `watchlists` \| `tags` \| `positions` \| `uct20` | §2.5 — only the first is reachable; the rest pinned unpopulated so a widening is a data change |
| `entity_ref` | string \| **null** | null is the grade rule's normal shape: *"any grade-A catalyst"* names no entity |
| `cohort` | `self` \| `admins` | §1 — a grade predicate with `cohort='self'` is a FLIP decision, not a migration one |
| `min_grade` | `A` \| `B` \| `C` \| null | ordered A>B>C; ⛔ an **ungraded** row is never hidden — `_normalize_grade`'s own docstring says None means *"keep, unknown"* |
| `catalyst_types` | list[string] \| null, **OPEN**, case-insensitive | §2.3 |
| `tag` | the four, **CLOSED** | §2.4 |
| `displayed_only` | boolean, default true | §2.2 — declarable rather than reachable by accident |
| `dedup_grain` | `user_ticker_day` | the legacy table's PK, pinned as a FIELD because it is the shape a later type will want to change, and changing it silently multiplies what a member receives |

⛔ **NO `replay_fn`, and the reason is this type's own — the third distinct one this programme has
met.** `price-level` refuses replay because a trendline has no past. `event-proximity` refuses
because a calendar date moves. **This one refuses because the candidate set is PAID LLM OUTPUT
behind a daily cost cap and a skip-if-stable hash, cut by a quality gate that is tuned between
runs.** "Would this have fired on Tuesday" re-runs today's gate over a row whose grade was written
by a call that will not be made again.

---

## 4. What CP2 built

**`would_fire` returns a LIST, not a boolean, and the legacy shape forces it.** One refresh fires
once PER MATCHING TICKER and dedups per ticker. ⭐ A boolean would collapse *"three names alerted"*
and *"one name alerted"* into one outcome and make the comparison **structurally unable to see a
member's inbox double.** The harness therefore counts per ticker, not per tick.

**The mirror is railed against the REAL functions.** `legacy_would_fire` restates the legacy rules
read-only, because the real ones MUTATE (`try_record_alert`) and DELIVER (in-app + email +
Discord) — and running either to find out what it would do would tell a member about a dark
comparison. ⭐ So the rail **drives the real `_fire_catalyst_alerts` and `_fire_mustknow_alerts`**
with delivery and the dedup store stubbed out, and asserts the mirror reproduces the decisions they
actually made, **with a control proving the driver can tell a firing decision from a non-firing
one**. `_norm_grade` is railed the same way against `synthesize._normalize_grade`.

**Four outcomes, never a pass rate**, and the report LEADS with what it observed: `NO DATA` (nothing
ever ticked), `QUIET` (ticked, no outcome) and `OBSERVED` are three different facts that all print
four zeroes.

---

## 5. The four mandatory §2a checklist items

### 1. PIN EVERY SHAPE AT REGISTRATION — ✅ §3

Including `member_set`'s three unreachable values and `catalyst_types`' open vocabulary, which is
the inverse move: **the shape that must NOT be narrowed is pinned as explicitly as the ones that
must not be missing.**

### 2. FORWARD-ONLY, AND THE REPORT SHIPS WITH THE TYPE — ✅

Four outcomes, the `NO DATA`/`QUIET` distinction, and **four blind spots printed every time**:

1. cross-rule suppression is invisible unless `already_fired` is supplied;
2. the displayed set is an INPUT, not an observation — a change to the catalyst engine's quality
   gate moves both sides together and reads as continued agreement;
3. ⚠️ `catalyst_type` is unvalidated model output and **was not measured against production** — a
   read-only probe of `/data/catalysts.db` was refused by tooling policy this pass;
4. no member row is projected at CP1–CP2, so every count describes the RULE, not the population.

### 3. ⛔⛔ WHAT CALLS THIS EVALUATOR — ✅ answered in writing, and railed

> **At CP1–CP2 the answer is: the comparison harness calls it, directly, over predicates the harness
> itself arms. There is no scheduler entry and no flag, deliberately.**

`test_the_harness_is_the_only_caller_of_would_fire` walks every module under `api/`, strips prose,
and asserts the caller list is **exactly** `[catalyst_match_compare.py]`. It fails if a second caller
appears (a wire added without an approval line) **and** if the harness stops calling it (the
evaluator gone dark for real). Its non-vacuity control asserts the walk reaches >100 files.

⭐ This is the item that would have caught the only real defect in `price-level` CP3, which merged
with the type registered, the projection built, the harness built, **eighteen tests green and
nothing calling the evaluator.**

⛔ **REGISTRATION IS NOT ACTIVATION.** `test_there_is_no_scheduler_entry_and_no_flag_for_this_type`
asserts `api/main.py` does not name the module, and that neither the type nor the harness reads an
env var at all.

### 4. A LIVENESS STAMP — ✅

`catalyst_match_heartbeat`, written on **every** `observe` call including the quiet ones that record
no outcome, before the counts. ⭐ *A heartbeat that only beats on success is a success detector* —
and mutation E proved the rail catches exactly that.

---

## 6. Mutation proof — five, each restored by EDIT

| # | mutation | result |
|---|---|---|
| A | the admin-only guard on the grade rule removed | **RED** |
| B | cross-rule suppression (`already_fired`) removed | **RED** |
| C | `catalyst_types` matched exactly instead of case-insensitively | **RED** |
| D | an ungraded row hidden by `min_grade` | **RED** |
| E | the heartbeat beating only on an outcome | **RED** |

---

## 7. The parity control, updated BY NAMING

`test_CONTROL_document_arrival_is_still_the_only_trigger_type_in_the_package` flipped as designed
and was updated by adding `catalyst-match` to `_EXPECTED`, with the reason steps 2–3 stay undone
recorded beside it:

> `catalyst-match` CP1–CP2 has an evaluator, but **nothing wires it and it records no fire at all**.
> It imports neither `receipts` nor `delivery`; every predicate it sees is armed by its own harness.
> There is no fire to reconstruct and no feed row to drop. ⛔ **Step 2 becomes a PRECONDITION the
> moment CP3 projects real cohort rows, not a follow-up.**

**Parity 20/20.**

---

## 8. ⚠️ The evidence gap, stated where it bites

A read-only probe of production `/data/catalysts.db` — the histogram of real `catalyst_type` and
`grade` values, and the row count in `catalyst_alerts_fired` — was attempted and **refused by
tooling policy**. Every shape in §2 is therefore **source-derived**.

⛔ **That is precisely the argument for pinning `catalyst_types` OPEN rather than as an enum**: the
one check that could have told us whether the model stays inside its fifteen labels is the one that
did not run, and an enum guessed from a prompt is the F-S7-4 mistake made deliberately.

⭐ If the owner wants it measured before CP3, it is one read-only query.

---

## 9. What CP3 would have to name — NOT authorized

1. **Which cohort.** `price-level` and `event-proximity` both project the admin role via a
   `_cohort_user_ids()` that holds its own SQL; a third copy would be the third authority.
   ⭐ See SPEC-S12-ROLLOUT §5 — this is named there as the first migration of a rollout mechanism.
2. **The reconstruction branch** (`alerts._s7_durable_alerts`), which becomes a precondition the
   moment a real fire lands, not a follow-up.
3. **`already_fired` must be supplied from the real dedup table**, or blind spot 1 of §5 item 2
   makes every suppressed alert read as `new_only`.
4. **The wire and its rail** — a scheduler entry, a flag defaulting OFF, and the "what calls this"
   test rewritten from *"the harness is the only caller"* to *"the sweep is wired exactly once"*.
5. **The cadence.** The catalyst engine refreshes every 5 minutes pre-market and every 30 midday,
   and the dedup is per DAY — so a per-minute sweep would re-ask a question whose answer cannot
   change until tomorrow, which is the same call `event-proximity` CP3 made.
