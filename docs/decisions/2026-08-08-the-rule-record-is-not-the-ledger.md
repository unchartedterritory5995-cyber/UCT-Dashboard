# Decision: the signal ledger cannot back a rule-performance claim, and E6 builds the store that can

**Status:** 🟢 **ACCEPTED — the ledger is a NOTIFICATION record. Eleven conditions
produce a right rule and an empty ledger, and five of them are member behaviour.**

**Date:** 2026-08-08 · **Phase:** E (task E6) · **Measurement:** `.superpowers/sdd/phase-e/ground-truth.md` §3.4
**Implements:** `docs/superpowers/specs/2026-08-08-phase-e-screener-toolkits-design.md` §E6 + AMENDMENT 2 §A2.3
**Code:** `api/services/definition_record.py` · **Rails:** `tests/test_definition_record.py`
**Runbook:** `docs/runbooks/definition-record.md`

---

## 1. The eleven conditions under which a rule fires and no ledger row is written

| # | condition | evidence | member behaviour? |
|---|---|---|---|
| 1 | `active = 0` | `indicator_alert_service.py:437` — `list_active()` is `WHERE active=1` | 🔴 **yes** |
| 2 | snoozed | `indicator_alert_service.py:686-687` → `record_trigger` returns False **before the fire log is touched** → the receipt gate `if recorded:` never fires | 🔴 **yes** |
| 3 | level condition, same armed episode | `fire_key` is `ep:<arm_epoch>` (`indicator_alert_evaluator.py:2314-2316`) — one receipt per EPISODE, not per bar | 🔴 **yes** |
| 4 | re-delivery of one fire | a released lease retried on a later cycle returns False from `record_trigger` | no |
| 5 | user-authored (`ast` lane) | `admit_alert_fire:1741` — refused **FIRST, in every mode** | 🔴 **yes** (nothing a member authors can ever accrue) |
| 6 | `ALERT_EVAL_MODE != "closed"` | `:1750-1756`. Committed default is `"closed"`, so this is inert unless a Railway override is in play | no |
| 7 | `value is None` | `:1788`, `_run_one_cycle:2287` — `ichimoku.chikou` can never fire closed-bar | no |
| 8 | `compute.rev` migration suppression | `_rev.consume_if_suppressed` (`:2282-2284`) — the **entire first cycle** after a migration | 🔴 **yes** (a consequence of an edit the member made) |
| 9 | bars fetch failure for a `(sym, tf)` group | `:2274-2278` — the whole group skipped, and **no coverage row says so** | no |
| 10 | any per-alert exception | `:2328-2332` | no |
| 11 | bar not closed / bad `bar_index` / non-product `tf` | `:1758`, `:1775`, `:1766` | no |

⛔ **Therefore ledger row count is a LOWER BOUND BIASED BY WHO ARMED AND WHO
SNOOZED.** Publishing it as accuracy is spec §1.6's *"unmeasured accuracy claims"*
trap reached by **arithmetic** rather than by intent — and that is the more
dangerous route, because every number in it is true.

⚠️ One correction to the obvious reading, from the ground truth: a receipt is
written on a fire that produced a **new fire-log row** — NOT on a fire that
reached anybody. `_dispatch_delivery` is called unconditionally (`:2307`) and
`_delivery_failed` (`:1875`) is *"ALWAYS FALSE on the return value"*, so a Resend
429 and a clean send are byte-identical to this store.

### The five are measured, not asserted

`tests/test_definition_record.py` drives a **real alert** through a **real
`_run_one_cycle`** in each of the five member-behaviour states, proves the rule
was right (the fire is asserted to exist before it is asserted to be invisible),
and then asserts the ledger is empty while the record holds the evaluation —
both tables in **one database file**, so the difference cannot be attributed to a
fixture.

| # | test |
|---|---|
| 1 | `test_BLIND_SPOT_1_active_zero_is_never_evaluated_yet_the_record_has_it` |
| 2 | `test_BLIND_SPOT_2_a_SNOOZED_alert_accrues_nothing_yet_the_record_has_it` |
| 3 | `test_BLIND_SPOT_3_a_LEVEL_condition_accrues_ONE_receipt_for_MANY_TRUE_BARS` |
| 5 | `test_BLIND_SPOT_4_a_USER_AUTHORED_fire_is_refused_FIRST_yet_the_record_has_it` |
| 8 | `test_BLIND_SPOT_5_a_rev_MIGRATION_eats_the_whole_first_cycle_yet_the_record_has_it` |

⭐ Case 3 is the one where **both stores have rows and they disagree on the
number** — the ledger records one receipt for an armed episode while the record
counts every bar the rule was true on. That is the clearest statement of what the
two stores are for.

---

## 2. And it cannot be `alert_shadow_fires` either

Keyed on `alert_id` — still a record of **a member's row**. Default off
(`ALERT_SHADOW_ENABLED=1`, read per call). Its own docstring says it exists for
the per-address **diff between lanes**, not as a performance log. Measured
**53.0 bytes/row**; at 10,000 alerts, **279 GB/yr**. `alert_shadow_log.py` has
since grown `prune_shadow` (`:253`) and a throttled `_maybe_prune` (`:275`) — a
prune-by-age, one `DELETE … WHERE recorded_at < ?`. **That prune shape is the one
E6 copies; the keying is the one it refuses.**

---

## 3. What E6 builds instead

`signature_coverage` (`api/services/signature/ledger.py:115`) is the right shape —
append-only, one row per *(rule, version, symbol, timeframe, evaluated window)* —
and E6 **generalises** it to any definition as a **sibling table in the same
database**, `definition_evaluations`, keyed by `def_hash` + `rev`, with **no
member column of any kind**.

⛔ **Not by widening `signature_coverage`.** Its key is `(indicator, version, …)`
where `indicator` is a Signature rule address or the alert lane's canonical
address; putting a `def_hash` in that column gives it two meanings and makes
`latest_coverage()` answer across two namespaces.

### Two columns the design did not specify, and why they are here

`signature_coverage` certifies **evaluation** only. A record that can say *"we
looked"* but not *"here is what it said"* cannot answer the one question this
task exists for — *"how has this done since I made it"* — and the only remaining
answer would be the ledger's biased count. So each row also carries:

* **`bars_evaluated`** — the denominator, stated rather than inferred
  (`lesson_a_renormalized_score_hides_its_own_basis`: a rate whose basis is
  implicit hides it).
* **`bars_true`** — the numerator: on how many of those bars the rule said yes,
  under the scan semantics `<ast> != 0` (E-A1).

Bars the tree could not compute are counted in **neither**. The warm-up pad is
`ast_interpret.max_lookback(ast) - 1`, read from the tree rather than spotted in
the output, because a **comparison** over an incomputable operand returns `0.0`
(`x > NaN` is `False` in both lanes by IEEE) — so `close > sma(close,50)` answers
"no" on its first 49 bars and every one of those noes would otherwise land in the
denominator.

---

## 4. The three properties that make a claim honest

### 4.1 Member-independence is STRUCTURAL

* the column set is asserted out of `sqlite_master`, never off a docstring, with
  a synthetic member-keyed control proving the probe can find one;
* an **import-graph rail** (AST, plus string constants so a SQL join is caught)
  proves `claim_for`, `record_pass` and `record_evaluation` cannot reach
  `signature_signals`, `record_signal`, `get_signals`, `list_active`,
  `record_trigger`, `admit_alert_fire`, `indicator_alert_fires` or
  `alert_shadow_fires`. Three synthetic offenders — direct, via a helper, and
  hidden in SQL — are each reported by name;
* 🔴 and the headline: **the record is byte-identical across three real member
  states.** `test_the_record_is_IDENTICAL_across_nobody_snoozed_and_armed_while
  _the_LEDGER_is_NOT` runs three whole worlds (own auth db, own ledger file) —
  nobody armed it · armed and snoozed · armed and active — and requires the same
  record bytes while the ledger differs `(0, 0, 1)` and the fire log with it.

### 4.2 Forward-only from creation, enforced rather than promised

§1.6 forbids backtest inflation, so `record_evaluation` **refuses** a window that
starts before the record's own origin (the earliest window start on file for that
`def_hash` + `rev`). Nothing can reach backwards and fill in *"what it would have
done"*.

⛔ **A hypothetical may never share a surface with a real receipt, and may never
be summed with one.** There is no column here that could hold one — no
`simulated`, no `backfilled`, no `source`. A store that cannot represent a
hypothetical cannot accidentally publish one.

**The record is empty on day one, and says so plainly:** `coverage: "unproven"`,
`hits: None`, `hit_rate: None`, and a `refusal` sentence. An **edited** definition
starts a new record for free — `def_hash` is derived from the tree, so different
maths is a different key.

### 4.3 Retention is a HORIZON that makes the claim REFUSE, not shrink

A prune-by-age on a coverage table silently converts *"proven over 400 bars"*
into *"proven over 28"*, and a hit rate recomputed over the survivors is a
smaller, confident, **wrong** number — §1.6's trap reached by arithmetic, which is
the ledger's own defect with a different table underneath.

So a claim is proven by **containment in a single surviving row**, never by
summing whatever is left. When the row that contained the window is pruned the
answer becomes `unproven` with `hit_rate: None` — *"not enough record"*, not a
smaller number. A claim **inside** the horizon still answers with a real number,
which is what keeps the refusal from being mere uselessness.

---

## 5. What this decision does NOT settle

* 🟡 **§8.3 — what a published record CLAIMS — remains the owner's.** E6 builds
  the record and a surface that can refuse. Whether a member sees *"this rule
  fired 340 times, 61% followed through"* or *"members were notified 340 times"*
  is not this task's call, and §1.6 forbids selling the second as the first.
  **E6 ships no public copy.**
* 🟡 **§8.2 — sharing with attribution is publishing**, and §12 gates publishing
  *"until the ledger can hold publishers accountable"*. E6 is the prerequisite it
  names; the sharing task is separate and comes after the §12 amendment.
* ⏳ **There is no production writer yet.** The nightly sweep that will call
  `record_pass` is E3's, and E3 has not been dispatched. `test_the_record_has_NO
  _PRODUCTION_WRITER_YET_and_the_ZERO_is_ASSERTED` asserts the zero by `==` on a
  derived set, exactly as `admit_alert_fire`'s census did for eight tasks. **When
  the sweep lands, that number becomes one and the test is edited to say so** —
  deleting it instead is how a second writer arrives unnoticed.
