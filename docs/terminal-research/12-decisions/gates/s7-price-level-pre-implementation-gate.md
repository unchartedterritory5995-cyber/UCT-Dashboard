---
id: GATE-S7-PRICE-LEVEL
title: S7 Alerts — `price-level` trigger type — Pre-Implementation Gate
role: gates the FIRST ABSORPTION. `document-arrival` is already live and is NOT gated by this packet.
status: ✅ APPROVED 2026-09-12 for CHECKPOINTS 1-2 only. CP3+ needs a new approval line.
pairs_with: PRD-S7, SPEC-S7, s7-alerts-completion-plan.md
date: 2026-09-12
---

# S7 `price-level` — Pre-Implementation Gate

## ⛔ APPROVAL — this block is filled in by the OWNER, not the author

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-12
APPROVED AT SHA:  123a30054   (this packet as it stood at approval)
SCOPE APPROVED:   [ ] all of §4   [x] only: CHECKPOINTS 1-2.

                  CP1 — as shipped: type registration, both shapes pinned, no evaluator,
                        no delivery, legacy byte-identical.
                  CP2 — dark evaluator + FORWARD-ONLY comparison harness, per the F-S7-3
                        ruling in §3a. No delivery, no flip, no legacy switch-off, and no
                        migration of member predicates.

                  ⛔ CP3+ NEEDS A NEW APPROVAL LINE. Shadowing real member
                     `watchlist_alerts` rows is CP3 and is NOT approved here.
```

✅ **APPROVED 2026-09-12.** ⭐ The block was left blank in the packet as written, and that was the
point: the author's own directive-transcription is not a signature, and this program's binding
constraint has always been *a second party recording approval*, never date ordering. This line is
that second party.

---

## 1. What is already shipped, and therefore NOT gated here

- **`document-arrival`** — S7's first live trigger type, in production since 2026-09-11 12:07. Not
  touched by this packet.
- **The substrate** — `api/services/alert_taxonomy/{registry,predicates,receipts,delivery,db}.py`.
  Additive by construction; `price-level` is expected to touch `registry.py` plus one new module.
- **The filing-watch parity rail** (`4d7a795a4`) — the §2 precondition of the completion plan. It is
  **already satisfied**; this packet does not re-litigate it. Its control
  (`test_CONTROL_document_arrival_is_still_the_only_trigger_type_in_the_package`) **is expected to
  go red the moment `price-level` registers**, and that red is the rail working, not a regression.
  ⛔ Updating that control is part of Checkpoint 1 and must be done by *naming the new type*, never
  by deleting the assertion.
- **The legacy price-level path** — `watchlist_alert_service.py` + the `watchlist_alerts` table +
  AlertBell + email/Discord delivery. ⛔ **It stays live and untouched** (completion plan §4a).

## 2. Why a gate at all

`price-level` is **the first absorption**. `document-arrival` had no incumbent; this one does, and
the completion plan's §1 tiebreak put it first precisely because *until one absorption is proven, S7
is a sixth alert system, which is the exact defect it exists to remove*.

The risk is therefore not "does it work" but **"does a member get two alerts for one price cross."**
That is governed by the absorption default (§4a): the new type runs **dark**, and the flip plus the
legacy switch-off happen in the **same PR**.

## 3. ⛔ TWO MEASURED FINDINGS THAT CHANGE THE SCOPE

Both measured on `origin/master`, not inferred from the spec. **SPEC-S7 describes `price-level` as a
level comparison. The shipped path is not only that.**

### F-S7-2 — a `price-level` alert can be a TRENDLINE, whose level is a function of TIME

`watchlist_alert_service._alert_level_now` (`:94`) interpolates between two anchors when
`alert_type == "trendline"`, and returns the fixed `target_price` otherwise. The row carries
`alert_type`, `anchor_t1/p1/t2/p2` and `drawing_id`. **A trendline alert's level is linearly
interpolated — and EXTRAPOLATED — at evaluation time.**

⛔ **Consequence for §5.1's `params_schema`:** a schema of `{symbol, target_price, direction}` cannot
represent half the shipped alerts. Either the schema carries the anchor geometry, or the absorption
silently drops trendline alerts — and dropping them is member-visible (an armed alert stops
arming), so it would be a §2b separate-PR change, not a migration detail.

⚠️ **Note the extrapolation.** Past `t2` the line continues indefinitely at the same slope. That is
deliberate and correct for a trendline drawing, and it means a `price-level` predicate has **no
natural expiry** — worth stating because the obvious "is the level in the past?" cleanup sweep would
be wrong here.

### F-S7-3 — §5.6's "would have fired N times" is NOT honestly computable for a bound trendline

`resync_bound_alerts` (`:130`) re-points every alert bound to a drawing when the member moves the
line, **overwriting the anchors in place**. The existing code is careful about the half that matters
most — the `UPDATE` is scoped `WHERE is_active = 1`, with its own comment: *"A TRIGGERED alert is a
historical fact … moving the line on Thursday must not rewrite what Tuesday said."* ⭐ **That guard
is correct and must survive absorption intact.**

But for an **active, not-yet-fired** alert the geometry is overwritten, and:

⛔ **`watchlist_alerts` has no `updated_at` column.** Measured at `auth_db.py:599` — the columns are
`id, user_id, sym, target_price, direction, is_active, triggered_at, created_at, alert_type,
anchor_t1, anchor_p1, anchor_t2, anchor_p2, drawing_id`. `created_at` is the row's birth, not the
geometry's.

**So the geometry's age is unrecoverable.** A replay answering *"this alert would have fired 4 times
in the last 30 days"* would compute against **today's** line as though it had always been in force,
and **nothing in the row can detect that the line moved yesterday.** That is a fabricated receipt of
exactly the kind S8's honest-degraded principle forbids, and it would be *more* convincing than a
blank because it carries a number.

### ⛔ RULING (owner, 2026-09-12) — NO REPLAY, EVER. THE COMPARISON IS FORWARD-ONLY.

The three options the packet recorded (decline · add `geometry_updated_at` · version the geometry)
are **superseded**. The owner's ruling removes the question rather than answering it:

1. ⛔ **No `replay_fn`, ever, for this trigger type.** Not deferred — ruled out. The dark predicate
   and its legacy twin are evaluated **live against the same bars from the moment the dark predicate
   arms**. ⛔ **No backfill over historical bars**, which is what §5.6's "replay against cached bars"
   sentence would otherwise invite.
2. **An anchor rewrite RESETS the comparison clock.** If `resync_bound_alerts` moves a legacy
   trendline mid-window, the dark twin's clock resets at that moment and the **pre-move span is
   marked NOT COMPARABLE** — never counted as agreement, never as disagreement.
3. **The NEW predicate store records `anchors_set_at` and a version counter on every anchor write**,
   so the dark side is auditable even though the legacy side is not. ⛔ **Do NOT add columns to
   `watchlist_alerts`** — the legacy path stays byte-identical.
4. **Dark-period minimum before any verdict is shown: five full trading sessions of forward data.**

⭐ **Why this is stronger than the packet's option 1.** Option 1 declined to replay a line that *had*
moved — which still requires knowing whether it moved, which the legacy row cannot tell you. Ruling
out replay entirely makes the unanswerable question irrelevant: forward-only comparison never needs
the geometry's history, because it only ever compares two things that were both live at the same
instant.

## 4. Checkpoint 1 — APPROVED AND MERGED

**Register the type and pin its schema against BOTH shipped shapes. No evaluator. No delivery.
Nothing member-visible.**

1. `api/services/alert_taxonomy/price_level.py` — `TYPE_ID`, `PARAMS_SCHEMA`, `register()`, mirroring
   `document_arrival.py`'s shape exactly.
2. `PARAMS_SCHEMA` represents **both** shapes F-S7-2 measured — the fixed level and the trendline
   anchors — with the module docstring stating why, citing `_alert_level_now` by line.
3. A rail asserting the schema can represent **every distinct `alert_type` the legacy code path
   handles**, derived by reading `watchlist_alert_service.py`, never hand-typed.
4. Update the parity rail's control by **naming** `price-level` alongside `document-arrival`.
5. F-S7-2 and F-S7-3 recorded in SPEC-S7 at the point of use.

⛔ **Explicitly NOT in Checkpoint 1:** no evaluation loop, no `delivery.py` call, no read of
`watchlist_alerts`, no migration, no change to `watchlist_alert_service.py`, no scheduler entry.

## 4a. Checkpoint 2 — APPROVED. Dark evaluator + FORWARD-ONLY comparison harness

1. **A dark evaluator** that writes `alert_fires` rows and receipts for `price-level` predicates and
   **never calls `delivery`**. The CP1 import-absence rail stays and now guards the evaluator too.
2. **The forward-only comparison harness** implementing §3a: paired evaluation from the moment the
   dark predicate arms, an **anchor-move clock reset**, and a **NOT COMPARABLE** bucket that is
   never folded into agreement or disagreement.
3. **`anchors_set_at` + a version counter on every anchor write, in the NEW store only.**
   ⛔ `watchlist_alerts` gains no columns.
4. **Harness-armed predicates ONLY.** ⛔ CP2 does **not** read or shadow real member
   `watchlist_alerts` rows. That is CP3 and needs its own approval line.

⛔ **Explicitly NOT in Checkpoint 2:** no delivery, no flip, no legacy switch-off, no migration of
member predicates, no shadowing of real member rows, and **no replay of any kind**.

## 5. Conditions

1. **MANDATORY — the approval block in §0 is filled in before anything in §4 merges.**
2. **MANDATORY — the legacy path stays byte-identical.** `git diff` on
   `watchlist_alert_service.py` and `auth_db.py` must be empty for Checkpoint 1.
3. **MANDATORY — the parity control is updated by naming, not by deletion.** Confirm it goes red
   first, then green for the right reason.
4. **MANDATORY — dark by construction, and provable.** `price_level.py` must not import
   `delivery`. ⛔ A rail asserts the absence, because "we did not call it" is a claim about a run
   and the import is a fact about the file.
5. The dark-period comparison is designed **before** any evaluator ships — **in the LEDGER row**,
   which is its single authority. This packet deliberately does not restate it.
6. Branch `feat/s7-price-level`. ⛔ **DO NOT MERGE.**

## 6. Scope exclusions have a rail, not just a sentence

| exclusion | the rail |
|---|---|
| no delivery from the new type | import-absence assertion on `price_level.py` |
| legacy path untouched | empty `git diff` on the two files, asserted in the ledger row |
| no second durable home | `alert_fires` only; **never** `user_alerts` (standing ruling) |
| the `is_active=1` resync guard survives | the guard's own test, re-run and named |

## 7. Final gate

# ✅ APPROVED — IMPLEMENT CHECKPOINTS 1 AND 2. CP1 merges; CP2 is dark, forward-only, harness-armed predicates ONLY.

⛔ **F-S7-3 IS ANSWERED (§3a): no replay, ever; forward-only.** The open question is now CP3 —
shadowing real member `watchlist_alerts` rows — which is explicitly outside this approval.
