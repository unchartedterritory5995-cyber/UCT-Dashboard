---
id: GATE-S12-ROLLOUT
title: S12 — Rollout cohorts — pre-implementation gate (first migration)
role: the approval packet for S12's first migration. Nothing builds past the scope on the approval line.
status: ✅ APPROVED 2026-09-12 — first migration only. BUILT AND MERGED the same day (`56df6803f`).
date: 2026-09-12
measured_against: origin/master @ 9e4d9381b
pairs_with: SPEC-S12-ROLLOUT
---

# ✅ APPROVED — the first migration, and nothing else

## ⛔ APPROVAL

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-12
APPROVED AT SHA:  afdd4adf5
SCOPE APPROVED:   first migration only - both S7 projections' _cohort_user_ids()
                  become one SQL predicate over user_tags; CP4's all-members flag
                  becomes a tag assignment, not a code path (keep the flag test
                  asserting "unset changes nothing" until the flag is deleted in
                  a later line).

RULING:           an empty cohort tag means NO members, never a fallback to
                  admins. Seed existing admins in the swap commit so the swap is
                  a no-op by construction, with a test asserting the projected
                  cohort is identical before and after.
```

**Delivered:** `56df6803f` on `origin/master`, 2026-09-12. **ADDITIVE** — 7 files, zero in
flow-worker's 154-file import closure, confirmed with `reachable_paths()`. No marker bump.

---

## 1. What this was, in one line

**A rollout gate written as a role check** — `SELECT id FROM users WHERE role = 'admin'` — in two
modules, with a third copy already scheduled for `catalyst-match` CP3.

⛔ It was wrong in three ways it had already started to pay for: joining a dark run meant **becoming
an administrator of the whole product**; the cohort **could not shrink** (there was no way to cover
three of the admins, which is what a first canary wants); and the decision had **two authorities**.

---

## 2. ⛔⛔ THE RULING, AND WHY THE COMFORTABLE ANSWER IS THE DANGEROUS ONE

> **An empty cohort means NO members. Never a fallback to admins.**

"Empty ⇒ fall back to admins" needs no seeding step and preserves today's behaviour for free. ⛔ And
it puts a **SECOND AUTHORITY** on who is in a cohort, so the day somebody emptied the tag
deliberately the system would silently re-cover every admin. **Fail closed.**

⚠️ **FAILING CLOSED HAS A REAL COST AND IT IS PAID BY SEEDING, NOT BY HOPING.** An unseeded swap
covers zero people, and **five sessions of "agreement" over an empty set reads exactly like five
sessions of agreement** — the `NO DATA` / `QUIET` confusion the S7 comparison harnesses exist to
prevent, one layer down.

---

## 3. The swap is a no-op, MEASURED

Run in a **sandboxed `auth.db`** with the census pins applied before any `api.**` import — the
remedy CLAUDE.md itself names — so **no write touched a shared data root**:

| | |
|---|---|
| BEFORE (the retired role rule) | **15 projected** |
| AFTER, **unseeded** | **0** — the ruling, demonstrated rather than described |
| seeded | **5 tag rows** |
| AFTER, seeded | **15 projected, IDENTICAL ROW IDS** |
| members with alerts | 7, **none projected either way** |

⭐ **Identical ROW IDS, not an identical count.** A count going from 15 to 15 is compatible with one
row entering and another leaving — the same discrimination the smoke-account provisioning used when
it asserted a set difference rather than a row count.

### ⛔ AND THE DRY RUN AGAINST FRIDAY'S BARS COULD NOT VERIFY THIS, WHICH IS THE FINDING

```
projected .......... 0 rows     (price-level, 2026-09-11)
projected .......... 0 predicates (event-proximity, 2026-09-11)
```

**Before AND after.** The dev box's `auth.db` has **116 admin accounts and ZERO active admin
alerts**, read live and read-only. So the dry run's `0 == 0` here is the **NO DATA case wearing the
QUIET case's clothes**, and banking it as verification is precisely what the four comparison
outcomes exist to prevent. ⭐ **The sandboxed proof above is what actually verifies the swap; the
dry run is reported because it ran, not because it decided anything.** Both dry runs re-ran clean
and `--self-check` PASSED, so the scratch guard still bites.

⚠️ **Production's projected count is not measurable from here** — a read of production `auth.db`
was not attempted, and the price-level dark run's own Monday report is the instrument for that.

---

## 4. Where the seed lives, and why not where you would expect

`api/main.py`'s lifespan, beside the alert-taxonomy registration. **NOT `auth_db.init_db()`.**

⛔ `api/services/auth_db.py` is **inside flow-worker's import closure and is NOT on its watch
list**, so editing it would strand flow-worker on stale code for a change it runs. Measured with
`tools/flow_worker_watch_coverage.py`, not assumed. `api/main.py` is not in that closure.

**The seed is `INSERT OR IGNORE` against `UNIQUE(user_id, tag)` and NEVER removes**, which matters
in two directions: a member added to the cohort by hand survives a restart, and **a member whose
ROLE changed is not silently dropped out of a running dark comparison.**

---

## 5. CP4's flag is no longer a code path

Widening the dark run to all members is a **tag assignment**. `CP4_ALL_MEMBERS_FLAG` and
`all_members_enabled()` stay **declared and uncalled** until a later line deletes them, and the
flag's rail now asserts the stronger thing that is true by construction:

> **unset changes nothing, AND SO DOES SET.**

⭐ The test ends by adding a TAG and watching the cohort widen with no variable at all — which is
the migration, demonstrated.

---

## 6. Mutation record

| # | mutation | result |
|---|---|---|
| — | an untagged cohort with three admins present | **projects 0**, control proves the admins are really there |
| — | admin seed present | **before == after, identical row ids** |
| — | the cohort gate replaced with `role_user_ids('member') \| cohort_user_ids(...)` in BOTH projections' real source | member rows **LEAK**, in both |
| — | a tag left behind by a deleted account | **not projected** — the `users` join is load-bearing |

Two retired tests rewritten in place with the retired body kept verbatim: **a ROLE change no longer
moves a row** (a TAG does), and **the CP4 flag no longer widens**.

**Measured:** 65 passed across `test_rollout.py` + both projection suites, PYTEST_EXIT=0.

---

## 7. What a future S12 line would need to name

1. **`catalyst-match` CP3's cohort** — the third copy this migration exists to prevent.
2. **An admin UI for the `rollout:` prefix.** The existing tag box works; it is ugly and it does
   not distinguish a cohort from a note.
3. **Tag expiry and per-cohort audit.** Neither blocks anything, and each is a reason to delay the
   first migration if allowed to.
4. **Deleting `CP4_ALL_MEMBERS_FLAG`** once its rail has been green for a while.
5. **Whether a member may see which rollouts they are in.** A product question, not a modelling one.
