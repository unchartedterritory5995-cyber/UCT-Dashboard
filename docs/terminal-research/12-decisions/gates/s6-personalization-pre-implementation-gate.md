---
id: GATE-S6-PERSONALIZATION
title: S6 — Personalization — pre-implementation gate
role: the approval packet. Nothing builds until an approval line is signed, and nothing builds past the scope that line names.
status: ✅ CP1 SIGNED 2026-09-13. CP2–CP5 are RULING-BLOCKED and say which ruling.
date: 2026-09-13
measured_against: origin/master @ f34ce660b
pairs_with: SPEC-S6-PERSONALIZATION · PRD-S6-PERSONALIZATION
---

# ✅ APPROVED — **CP1 only**, the source-vocabulary rail. Everything else is ruling-blocked.

## ⛔ APPROVAL — CP1

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-13
APPROVED AT SHA:      b3073c67c
SCOPE APPROVED:   CP1 - THE SOURCE-VOCABULARY RAIL. The member-interest source
                  vocabulary is DECLARED once and all three of its current
                  implementations are DERIVED from source and asserted to agree,
                  with a non-vacuity control and a mutation proof.

                  ⛔ NO PRODUCT CODE CHANGES. No resolver, no endpoint, no edit
                     to calendar_personalization.py, importance.js or
                     Calendar.jsx. This checkpoint is a test.

                  ⛔ IT DECIDES NOTHING ABOUT SET vs WEIGHTED SET. It measures
                     what the three copies say TODAY so the migration can later
                     be proved a no-op.
```

> ⛔⛔ **CP2–CP5 ARE NOT AUTHORIZED AND EACH NAMES ITS BLOCKER.** SPEC-S6 §7 is explicit: the first
> migration *"would need its own approval line naming the §2 ruling and the three rulings in §5.1."*
> Those rulings are the owner's and are not made here.

---

## 1. ⛔ WHY THIS PACKET EXISTS AT ALL, AND WHAT IT IS NOT

**S6 had no gate packet, by instruction** (SPEC-S6 §7). A missing packet and an unsigned one are
different states: an unsigned packet is something the owner can read and rule on; a missing one is
work this programme owes first. This is that work.

⛔ **AND THE SPEC STOPS ITSELF.** SPEC-S6 §2 ends with *"it is a ruling, and the spec stops here
until it is made."* This packet does not restart it. What it does is separate the part of S6 that
**depends on the ruling** from the part that **does not** — and there is exactly one of the latter.

---

## 2. ⛔⛔ THE FINDING THIS CHECKPOINT EXISTS FOR — THREE AUTHORITIES, NOT TWO

SPEC-S6 §2 names the defect and calls it two implementations. **Measured on `f34ce660b`, it is
THREE**, and the third is the one that bites:

| # | where | how the vocabulary is written | what it is for |
|---|---|---|---|
| 1 | `api/services/calendar_personalization.py` `get_user_ticker_sets` | the four **dict keys** it returns — `watchlist`, `flagged`, `positions`, `uct20` (+ the derived `all_mine`) | the authority. Each source has its own helper, each returning `set()` on exception |
| 2 | `app/src/pages/Calendar.jsx:77` | `const ALL_SOURCES = ['watchlist', 'flagged', 'positions', 'uct20']` — a **hand-typed array literal** | the source picker's universe, and the default when the member has no preference |
| 3 | `app/src/pages/calendar/importance.js` `impEff` | a **hand-typed if-chain**: `positions` +3.0, `watchlist` OR `flagged` +2.0, `uct20` +1.0 | the personalization BOOST applied to ranking |

⭐ **THE FAILURE IS SILENT AND IT IS DOUBLE.** Add a fifth source server-side and:

* `ALL_SOURCES` does not contain it, so `mySources` never selects it and `_sources` never carries
  it — **the picker cannot offer it and the member cannot turn it on**;
* `impEff` does not name it, so even if it arrived it would add **a boost of exactly 0.0** — the
  member's strongest new signal silently ranked as if it were not theirs at all.

Neither produces an error, a log line, or a failing test. ⛔ The comment at `importance.js:74` says
*"mirrors the my-sets join"* — **a comment claiming agreement is a record that nobody wired them
together** (`lesson_a_comment_claiming_agreement_is_not_agreement`), and this one has been
accurate-and-fragile since it was written.

⭐ **AND THE NEAR MISS IS ALREADY IN THE FILE.** `Calendar.jsx:270-274` carries a ⚰️ comment
recording that `_sources` once used `ALL_SOURCES` instead of the member's active picker, *"boosting
names via a source the user disabled (a phantom position weighting the ranking)."* Same vocabulary,
same class of bug, already shipped once.

---

## 3. ⛔ WHY THIS IS BUILDABLE WITHOUT THE §2 RULING — the test that matters

The SET-vs-WEIGHTED ruling decides **what the resolver returns**. It does not change the fact that
three places today enumerate the same four names by hand.

* If the ruling is **SET**, the rail still holds: the vocabulary is still one list in three places.
* If the ruling is **WEIGHTED SET**, the rail is the precondition: §5 promises the migration *"can
  be provably a no-op"*, and **nothing today can prove that**, because there is no artifact saying
  what the three copies agree on now.

⭐ **So CP1 is worth building under either answer, which is the test for whether a checkpoint is
genuinely ruling-independent.** A checkpoint that is only correct under one answer is that answer
smuggled in as engineering.

---

## 4. Proposed checkpoints, so an approval line can name one

| CP | scope | strands? | member-visible? | size | blocked on |
|---|---|---|---|---|---|
| **CP1** | **The source-vocabulary rail.** One DECLARED vocabulary; all three implementations derived from source (server dict keys by AST, `ALL_SOURCES` by AST, `impEff`'s branches by AST) and asserted to agree; a non-vacuity control; fails BY NAME on a fifth source or a dropped one. **No product code.** | no | no | **S/M** | — ✅ **SIGNED** |
| **CP2** | **The first migration** (SPEC §5): `get_user_ticker_sets` → `member_interest.interest_for`, Calendar the only caller, signature unchanged, provably a no-op against CP1's baseline. | ⚠️ measure at build | no | **M** | ⛔ SPEC §2 (SET vs WEIGHTED SET) |
| **CP3** | **`importance.js`'s boost DERIVES from the resolver** instead of mirroring it. | no | ⚠️ ranking could shift — must be proved identical | **M** | ⛔ SPEC §5.1 item 2 |
| **CP4** | `GET /api/member/interest` + the shared per-member cache key. | measure at build | no | **S/M** | ⛔ SPEC §2, and the paid-gating question SPEC §5.1 leaves open |
| **CP5** | **May the resolver read `personal_edge`?** Shape-3 reaching into shape-1 — where personalization stops being *"things the member did"* and becomes *"things we concluded about them."* | no | ⚠️ yes, eventually | **ruling** | ⛔ SPEC §5.1 item 3 |

⛔ **CP2 THROUGH CP5 ARE SPEC-BLOCKED, NOT MERELY UNSIGNED**, and the difference matters for the
audit: an unsigned checkpoint waits on the owner **reading this packet**; a spec-blocked one waits
on a **product ruling the spec says it cannot make**. Four rulings close them: SET-vs-WEIGHTED,
derive-vs-mirror, `personal_edge`, and whether the endpoint is paid-gated.

---

## 5. ⚠️ What CP1 deliberately does NOT do

- **It does not unify the three copies.** Unifying means editing `Calendar.jsx` and
  `importance.js`, which is CP3's scope and needs the derive-vs-mirror ruling. CP1 makes the
  divergence **loud**; CP3 makes it **impossible**.
- **It does not touch the weights.** `+3.0 / +2.0 / +1.0` are a product judgement about how much a
  position outranks a flag. CP1 asserts the *names* agree, never the numbers.
- **It does not read production.** The vocabulary is a property of the SOURCE, and a rail that
  needed a member's data to run would be a rail nobody runs.

---

## 6. ⚠️ The evidence gaps in this packet, stated where they bite

1. **The member count was not re-measured this pass.** SPEC §6 flags that OI-21's queries are
   existence checks rather than distributions if production really holds ~26 members. CP1 does not
   depend on it; **CP2's value does**, and the spec says so.
2. **`_sources` has a fourth consumer** — `filterLogic.js:20` filters by `f.audience` against
   `_sources`. It is a READ of the vocabulary, not a second declaration of it, so CP1 rails the
   three declarations and records this one. ⚠️ If `audience` values and source names are the same
   namespace, that is a fifth authority waiting to happen and CP3 should settle it.

---

## 7. Recommendation

⭐ **Sign CP1, rule on §2 when convenient, and do not let CP1 wait for it.** The rail is the only
part of S6 that is correct under every answer, it costs one test file, and it is the artifact that
makes the eventual migration's "provably a no-op" claim checkable rather than asserted.
