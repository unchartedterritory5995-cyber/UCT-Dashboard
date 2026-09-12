---
id: PLAN-S7-COMPLETION
title: S7 Alerts — completion plan (Wave 2, PLAN ONLY)
role: plan for finishing S7 Alerts against SPEC-S7. Written 2026-09-11 under owner ruling 2; §2a added 2026-09-12 from what price-level CP1–CP3 taught. NOT authorized to build — the owner authorizes trigger types individually from this plan.
status: PLAN ONLY — no S7 code authorized
date: 2026-09-11
---

# S7 Alerts — completion plan

⛔ **PLAN ONLY. Nothing here is authorized.** The owner authorizes trigger types individually.

## 0. Where S7 Alerts actually is

**One of eight trigger types is built** — `document-arrival` (`e994f5337`). The substrate is
generic and real: `registry.py` (implements SPEC-S7 §5.1 by name), `predicates.py`, `delivery.py`,
`receipts.py`, `db.py`, `document_arrival.py`, and `api/routers/alert_taxonomy.py`.

⭐ **This is "finish", not "start."** Each remaining type is a predicate evaluator plus a registry
entry on a working spine — not new architecture.

⛔ **And the spine has a protected consumer.** The convergence program's **filing watch** is
implemented inside this package and is live to members. Ownership is Terminal-Next's (owner ruling,
2026-09-11); filing watch is a protected consumer. §2 is therefore a precondition for **every** item
below, not a step in one of them.

## 0a. The consolidation premise, measured (2026-09-11, `origin/master` @ `7fce88bd2`)

S7's premise is "one taxonomy replacing five-plus independently-built alert paths." That is not an
estimate — **six distinct alert-state tables are referenced in `api/**/*.py` today**, and every
legacy service the plan proposes absorbing exists:

| table | references | owning service (all verified present) |
|---|---|---|
| `indicator_alert_fires` | 35 | `api/services/indicator_alert_service.py` |
| `alert_fired_log` | 31 | shared delivery seam |
| `watchlist_alerts` | 27 | `api/services/watchlist_alert_service.py` |
| **`alert_fires`** | 27 | **S7 Alerts / `alert_taxonomy` — the durable row** |
| `user_alerts` | 11 | legacy ⛔ **never the durable S7 row; standing owner ruling** |
| `catalyst_alerts_fired` | 3 | catalyst engine |

Also present: `calendar_alerts.py` (pre-report), `awareness/rules.py` (R1/R2 stop-watch, R4
regime-flip, R5 earnings-proximity), `scan_evaluator.py` (nightly sweep), `alert_shadow_log.py`.

⭐ **Six tables is the argument for ordering by consolidation.** Each absorption removes one; adding
a trigger type that absorbs nothing makes it seven.

## 1. Recommended order, and the reasoning

Two orderings compete. **SPEC-S7's own sequencing** put document-arrival first because it "needs
engineering only." **Member value** points elsewhere. Where they disagree, the tiebreak used here is
*which type retires an existing duplicated subsystem* — S7's whole premise is one taxonomy replacing
five-plus independently-built alert paths.

| order | trigger type | why here | size |
|---|---|---|---|
| **1 ✅** | **`price-level`** — CP1–CP3 MERGED, dark, armed 2026-09-12; verdict gate five sessions | The highest-volume existing alert path (`watchlist_alerts`, the AlertBell, email + Discord delivery). It is the type that proves the taxonomy can *absorb* a shipped subsystem rather than sit beside it — and until one absorption is proven, S7 is a sixth alert system, which is the exact defect it exists to remove. Member value and consolidation value coincide. | **M** |
| **2 ✅** | **`event-proximity`** — CP1+CP2 MERGED 2026-09-12, dark, harness-armed only; CP3 needs a new line | `calendar_alerts.py` already ships pre-report alerts on a scheduler with its own dedup table. Second absorption, and it shares the earnings/economic evidence the A5 work just modernized onto D1/S8. | **M** |
| **3** | **`indicator-condition`** | Absorbs `indicator_alert_service` / `indicator_alert_fires`. Higher evaluation cost (a computed value per cycle) and it wants D2's metric address book to be done properly — see §4. | **L** |
| **4** | **`catalyst-match`** | `catalyst_alerts_fired` exists with a three-column dedup PK. Mostly a re-homing; its scoring stays in the catalyst engine. | **S–M** |
| **5** | **`position-risk`** | Overlaps the Awareness Engine's R1/R2 stop-watch rules, which already handle the broker-placeholder-stop trap. ⛔ Absorbing it means inheriting that trap — a placeholder stop (`stop == entry`) counted as real would fire "at stop" on every broker import. Needs care, not size. | **M** |
| **6** | **`scan-membership-change`** | `scan_evaluator`'s nightly sweep already computes result sets; this is a diff between two cycles. Cheap, but low member urgency. | **S** |
| **7** | **`regime-change`** | Smallest — the regime authority is settled (DEC-13: `voice_regime_classifier`), and the Awareness Engine's R4 already keeps a durable snapshot ledger to diff against. ⚠️ Currently in-app delivery only, deliberately, to avoid mass-emailing every holder on every flip. | **S** |

⭐ **Why not "cheapest first."** `regime-change` is the smallest and is last on purpose: it absorbs
nothing and adds an eighth path if S7 has not yet proven absorption. **Ordering by consolidation
proves the premise; ordering by size defers the only question that matters.**

## 2. ⛔ PRECONDITION FOR EVERY ITEM — the filing-watch parity test

Per owner ruling 2a: **any change to predicate or receipt shape ships with a parity test proving
filing watch's observable behaviour is unchanged, the test lands BEFORE the change, and it must be
seen to fail on regression.**

**Design.**

- **Scope — the three observables, and only these:** (1) **fires** — given a fixture filing event,
  the same predicate set matches and the same fire rows are written; (2) **delivery** — the same
  channels are invoked with the same payload shape; (3) **receipts** — the same receipt rows, same
  read-state transitions, including the dual-write path (`ca9093c00`).
- **Fixture-driven, not live.** A recorded filing-arrival event plus a seeded predicate, against a
  temp DB. ⛔ Never `/data` — `C:\data` on this box is the owner's live files.
- **Golden-shape assertion, not a snapshot blob.** Assert the *fields filing watch reads*, named
  explicitly. A whole-row snapshot fails on every unrelated column addition and gets muted.
- ⛔ **Mutation-proof it before accepting it.** Change the predicate shape, watch it go red, restore.
  Record that you saw it fail. A parity test never observed failing proves nothing
  (`lesson_gate_that_cannot_fail`).
- **Control:** include one assertion that *should* change when S7 adds a type — proving the test is
  scoped to filing watch's behaviour and is not just a pin on the whole module.

**Where it lives:** `tests/test_alert_taxonomy_filing_watch_parity.py`, alongside the existing
`tests/test_alert_taxonomy_predicates.py` / `test_alert_taxonomy_router.py`.

⛔ Per ruling 2b: **any change that alters what a member sees from filing watch is a separate PR,
flagged to the owner by name, never bundled with S7 work.**

## 2a. ⛔⛔ MANDATORY CHECKLIST — every trigger type, no exceptions

**Added 2026-09-12 from what `price-level` CP1–CP3 actually taught.** These are not
recommendations. Each one is here because its absence produced a real defect in the first
absorption, and each is cheap to satisfy and expensive to retrofit.

### 1. PIN EVERY SHAPE IN THE SCHEMA AT REGISTRATION — including the ones nothing populates yet

`price-level` pinned **both** `price` and `trendline` at CP1, before any evaluator existed
(F-S7-2). That looked like over-engineering and was not: a trendline has **no past** — its level is
a function of `now` — so a schema that admitted only fixed levels would have taught the next
engineer that a stale-level cleanup was safe, and it would have killed every bound line.

⚠️ **And read the LEGACY DATA, not just the legacy code.** Production carries a third
`alert_type` value, `line`, that neither F-S7-2 nor the schema anticipated — bound to a drawing,
carrying **no anchors**, evaluated by both sides as a fixed level. It happens to be harmless
because both level functions fall through identically. **That was luck, not design.**

### 2. THE COMPARISON IS FORWARD-ONLY, AND SHIPS WITH THE REPORT THAT READS IT

Both rules evaluated live on the same tick from the moment the dark predicate arms. **No replay,
ever** (F-S7-3). An anchor/parameter rewrite **resets the clock** and the pre-move span is
discarded into `not_comparable` — never counted as agreement.

⛔ **Four outcomes, never a pass rate.** `legacy_only` is an alert somebody LOSES at the flip;
`new_only` is one they start getting TWICE. Different defects, different members. Collapsing them
into a percentage answers a question nobody asked.

⛔ **The report ships WITH the type, carrying a NON-VACUITY CONTROL.** An empty comparison store
prints four zeroes per predicate and reads exactly like perfect agreement. The report must lead
with what it observed and say `NO DATA` rather than summarise nothing. *A dark run that never ran
and a dark run that found no disagreement are different facts.*

⛔ **And it must state what it CANNOT see.** The price-level projection is structurally blind to
the one-shot/persistent divergence, because the legacy row leaves the projection the moment it
fires. A `new_only` of zero there is not evidence — it is a blind spot, and the report prints that
sentence every time so nobody sizes the next checkpoint against it.

### 3. ⛔⛔ NAME THE THING THAT CALLS THE EVALUATOR, AND THE RAIL THAT ASSERTS THE CALL SITE EXISTS

**This is the item that would have caught the only real defect in CP3.** `price-level` merged with
the type registered, the projection built, the harness built and **eighteen tests green — and
nothing calling the evaluator.** Monday's dark run would have collected zero rows, and a week later
an empty store reads exactly like five sessions of agreement.

Every trigger type's checklist carries this line, answered in writing before merge:

> *What calls this evaluator, on what trigger, and which test fails if that wire is cut?*

⭐ **The rail must assert the WIRE, not the parts.** A suite whose every test invokes the evaluator
directly is **structurally blind** to this — that is precisely why eighteen green tests said
nothing. Assert the scheduler entry, the flag that gates it, and the job body calling the sweep.

⚠️ **Registration is not activation — and putting a DARK evaluator on a tick is not the FLIP.**
Conflating those two is what produced the defect: CP1/CP2's correct *"registration only, no
scheduler entry"* was carried into CP3 by habit and then **enforced by a test**, while CP3's own
approval said the harness *runs*. The flip is **delivery plus the legacy switch-off**, and nothing
else.

### 4. A LIVENESS STAMP, NOT JUST A RESULT STORE

The comparison spans carry no per-tick timestamp, so a sweep that died on its first morning is
**indistinguishable** at the end of the week from one that ran every minute. Every dark run needs a
heartbeat — a monotonic tick count and a wall-clock stamp, written on **every** tick including the
ones that found nothing. *A heartbeat that only beats on success is a success detector.*

## 2b. ⛔⛔ `indicator-condition` IS SEQUENCED BEHIND D2 — the ad-hoc metric key is KILLED

**Owner ruling D2-C, 2026-09-12.** This plan carried, for `indicator-condition`, an alternative:
*ship an ad-hoc metric key with a sunset date rather than blocking on D2's address book.*

⛔ **KILLED. And the argument is measured, not aesthetic: this codebase has run that experiment
twice and BOTH keys are still live.**

| the ad-hoc key | what it was | still live? |
|---|---|---|
| `_LEDGER_TIMEFRAME` (`indicator_alert_evaluator.py:1694`) | a hand-typed copy of `_BARS_STORE_TF_KEYS`, shipped **with a comment explaining why it is dangerous** | **yes** |
| `pct_above_50ma` | an ad-hoc spelling of a metric that already had one (`pct_above_50sma`, 190 refs) | **yes**, in 5 files including a live regime classifier |

⭐ **A sunset date is a promise made by the person who benefits from not keeping it.** Every
instance of the shape in this repo's history — the `/api/tweets/tape` route kept "one deploy cycle",
`j2_playbook_entries` kept "~30d", `trades.py` kept as "a rollback backup" — is still present. The
pattern is not carelessness; it is that **a dated promise has no mechanism.**

### THE DEPENDENCY, RECORDED

> **`indicator-condition` waits on D2 CP1 *plus the first non-screener store*.**

⛔ **CP1 ALONE IS NOT ENOUGH, AND THAT IS THE DEPENDENCY'S WHOLE POINT.** CP1 shipped
(`b9783d509`) with **137 metrics — and every one of them is `store: screener_rows`**, at
`cadence: nightly`. The address book can today address a nightly screener column and **nothing
else**: not a bar, not a quote, not a fundamental. An indicator condition that named a bar-derived
metric would have no address to carry.

**So the gate for `indicator-condition` is:**

1. D2 CP1 merged — ✅ done; and
2. the address book's metric axis covers **at least one store that is not `screener_rows`**, with
   that store classified in PRD-D2 §7; and
3. `cadence` GATES THE PREDICATE at registration.

⭐ **Item 3 is the half that is a real member-facing defect today, not a modelling nicety.** A
predicate asking a `cadence: nightly` metric to answer an intraday condition registers cleanly,
evaluates cleanly, and **never fires** — and nothing distinguishes it from a condition that simply
has not been met. *An alert that cannot fire and an alert that has not fired look identical to a
member, and the member is the one holding the position.*

⚠️ **THE HONEST COST, STATED: `indicator-condition` IS DELAYED.** That is the trade the ruling
makes, and it is the owner's to make. The alternative was a key that would never be retired.

---

## 3. What each trigger type needs from the substrate

| component | what a new type adds | shape change to existing types? |
|---|---|---|
| **`registry.py`** | one `register_trigger_type(type_id, params_schema, module)` call at import time | **none** — additive by construction, which is why the substrate holds |
| **`predicates.py`** | a `params_schema` and a matcher; the duplicate-predicate guard (`8ec29b457`) already generalizes | **none expected.** ⛔ If a type needs a new *field* on the predicate row, that is a predicate-shape change → §2 parity test first |
| **evaluator module** | a new `<type>.py` beside `document_arrival.py` — the evaluation loop and its cadence | none |
| **`delivery.py`** | none for in-app/email/Discord; a new channel would be its own change | none |
| **`receipts.py`** | none if the type emits the standard fire receipt | ⛔ any new receipt field → §2 parity test first |
| **`db.py`** | a migration only if the type needs new state | ⛔ `alert_fires` stays the durable row. **Never a `user_alerts` row** — standing owner ruling, and the shipped package already honours it (25 `alert_fires`, zero `user_alerts`) |

⭐ **The expected case is that a new type touches only `registry.py` + a new evaluator module.** A
type that wants to change the predicate or receipt shape should be treated as a design question
first — the substrate's genericness is the asset.

## 4. Dependencies worth naming before authorizing

- **`indicator-condition` (order 3) wants D2.** Without the metric address book it must name computed
  values by an ad-hoc key, which is a second authority over metric identity. Either accept an
  explicit interim key with a sunset condition, or sequence it after D2.
- **`position-risk` (order 5) inherits the placeholder-stop trap.** A broker import stores
  `stop == entry`; counting that as a real stop fires "at stop" on import. The Awareness Engine
  already solves this — reuse its rule, do not re-derive it.
## 4a. ⛔ THE ABSORPTION DEFAULT (owner ruling, 2026-09-11) — binding on every trigger type

**For every absorbed legacy path, the default is:**

1. **The legacy path STAYS LIVE.** It is not touched when the new trigger type ships.
2. **The new trigger type runs DARK — no member delivery** — until the owner flips it, **per type.**
3. ⛔ **The flip and the legacy switch-off happen in the SAME PR.** Never two PRs, never two deploys.

⭐ **Because shipping two alerts for one event is never acceptable.** A member who gets a
`watchlist_alerts` email and an `alert_fires` in-app notification for the same price cross has been
given a worse product by a migration that was supposed to consolidate. The dark period is where the
new type earns trust against the old one on the same events; the single PR is what guarantees there
is no window in which both deliver.

**What "dark" means concretely:** the trigger type evaluates, writes its `alert_fires` rows and its
receipts, and **does not call `delivery.py`.** That makes the dark period directly measurable — the
fires can be diffed against the legacy path's fires for the same window before anything is flipped.

- **Absorption is a product decision, not a refactor.** Each of orders 1–5 retires or duplicates an
  existing member-visible alert path. ⛔ **Whether the old path is switched off, and when, is the
  owner's call per type** — governed by the default above.

## 5. Estimated sizes

`regime-change` **S** · `scan-membership-change` **S** · `catalyst-match` **S–M** ·
`price-level` **M** · `event-proximity` **M** · `position-risk` **M** · `indicator-condition` **L**.

Plus the §2 parity test, **S**, once — and it must land before the first of them.

## 6. What the owner authorizes

Individually, per trigger type. The recommended first authorization is **the §2 parity test alone**,
so the protection exists before anything is built on top of it.
