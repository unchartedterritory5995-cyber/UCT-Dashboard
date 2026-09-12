---
id: PLAN-S7-COMPLETION
title: S7 Alerts — completion plan (Wave 2, PLAN ONLY)
role: plan for finishing S7 Alerts against SPEC-S7. Written 2026-09-11 under owner ruling 2. NOT authorized to build — the owner authorizes trigger types individually from this plan.
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
| **1** | **`price-level`** | The highest-volume existing alert path (`watchlist_alerts`, the AlertBell, email + Discord delivery). It is the type that proves the taxonomy can *absorb* a shipped subsystem rather than sit beside it — and until one absorption is proven, S7 is a sixth alert system, which is the exact defect it exists to remove. Member value and consolidation value coincide. | **M** |
| **2** | **`event-proximity`** | `calendar_alerts.py` already ships pre-report alerts on a scheduler with its own dedup table. Second absorption, and it shares the earnings/economic evidence the A5 work just modernized onto D1/S8. | **M** |
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
- **Absorption is a product decision, not a refactor.** Each of orders 1–5 retires or duplicates an
  existing member-visible alert path. ⛔ **Whether the old path is switched off, and when, is the
  owner's call per type** — shipping S7's version alongside the old one means members get two alerts
  for one event.

## 5. Estimated sizes

`regime-change` **S** · `scan-membership-change` **S** · `catalyst-match` **S–M** ·
`price-level` **M** · `event-proximity` **M** · `position-risk` **M** · `indicator-condition` **L**.

Plus the §2 parity test, **S**, once — and it must land before the first of them.

## 6. What the owner authorizes

Individually, per trigger type. The recommended first authorization is **the §2 parity test alone**,
so the protection exists before anything is built on top of it.
