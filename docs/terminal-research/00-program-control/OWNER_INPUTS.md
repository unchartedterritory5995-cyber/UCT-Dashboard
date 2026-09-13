---
id: OWNER-INPUTS-FORM
title: Owner inputs — a fill-in form. Pasting it back IS the ruling.
role: every input that blocks a system, and every PROVISIONAL taken without one, as one-line choices
status: awaiting the owner. Nothing here is decided.
date: 2026-09-12
---

# Owner inputs — fill in and paste back

⭐ **HOW TO USE THIS:** replace each `CHOOSE: ____` with a letter or a yes/no and paste the whole
file back. **That is the whole ruling** — no other form is needed, and anything you leave blank
stays blocked rather than silently defaulting.

⛔ **A BLANK IS NOT A DEFAULT.** Every line below has a recommendation, and the recommendation is
what this programme would do; it is not what it *has* done. Nothing here has been acted on.

---

## PART A — the four inputs that block a system today

### A1 · OI-03(a) — the Massive data tier

**Question:** Which Massive tier does UCT hold?
**Why it blocks:** every member-facing data feature; whether cost scales per member.

```
  A) Business / Enterprise  — ToS permits display to Edge Users
  B) Individual tier        — individual use only, no member display
  C) Don't know / need to check the contract

CHOOSE: ____
```
**Recommendation:** **C is an honest answer and unblocks nothing** — if it is C, say so and S9
stays blocked; the programme will not guess. **Unblocks:** S9 Entitlements, A14 Portfolio & Risk.

### A2 · OI-03(b) — the FMP display agreement

**Question:** Does UCT hold an FMP Data Display and Licensing Agreement? (FMP bars multi-user
display without one.)

```
  A) Yes, signed
  B) No
  C) Don't know

CHOOSE: ____
```
**Recommendation:** none — this is a fact about a contract, not a judgement.
**Unblocks:** S9, A14, and the licensing register's FMP rows.

### A3 · OI-06 — the tools the desk actually opens by hand

**Question:** Of thinkorswim, TradingView, Finviz, Market Chameleon, Unusual Whales, SpotGamma —
which do you and the partner open **by hand** on a trading day, and does the desk run any
TradingView alerts?

```
  Opened by hand (list, in order of time spent): ______________________________
  TradingView alerts in use?  YES / NO :  ____
```
**Why it blocks:** S1's surface manifest and S2's keyboard registry both shipped PROVISIONAL
*ahead* of this, and you ruled its findings get diffed against what shipped.
**Recommendation:** answer even if the list is short — **a two-item answer unblocks three
systems.** **Unblocks:** S1, S2, A2.

### A4 · Browser checks — F-I1-2

**Question:** F-I1-2 needs a browser run you perform. Do you want it this week?

```
  A) Yes — I'll run it, keep F-I1-2 open
  B) No  — park it further, and say so in the audit
  C) Close it as EXCLUDED with the reason "not worth the owner's time"

CHOOSE: ____
```
**Recommendation:** **B.** It has been parked once already and nothing depends on it.
**Unblocks:** nothing — this only moves F-I1-2 out of "in progress".

---

## PART B — the PROVISIONALs taken today, for confirm-or-reverse

Each was taken so the day would not stall. **Reversing any of them costs little now and more
later.**

### B1 · The H-prefix collision (F-AUDIT-1, new today)

`H14` is BOTH a hazard rule (*a live hazard is a hard stop*) and a hypothesis in
`hypothesis-register.md`. The whole H1–H35 range overlaps. Same shape for `G`: `G1`–`G5` are D1
provider gaps, `G7`–`G12` are capability-ledger gaps.

```
  A) Rename the HYPOTHESIS register (HY-01…)  — rules keep their ids
  B) Rename the RULES (HR-01…)                — hypotheses keep theirs
  C) Leave both; disambiguate at each mention

CHOOSE: ____
```
**PROVISIONAL taken: A.** The rules are cited in commit messages and code comments across the
estate; the hypotheses are cited only inside `13-executive-synthesis/`. Renaming the smaller blast
radius is cheaper and safer.

### B2 · `650865d5` — the unresolvable deploy citation

Cited six times as the 2026-07-26 healthcheck deploy; matches no git object anywhere. The commit
matching its description exactly is `2908ab227` (reverted same day by `f5fb3e21d`).

```
  A) Keep 2908ab227 — it is the verified commit
  B) Restore 650865d5 and mark it UNRESOLVED (it may be a Railway deploy id)

CHOOSE: ____
```
**PROVISIONAL taken: A**, with the original recorded in the tombstone either way.

### B3 · D2 CP3's gate narrowing

"≥200 rows" is counted as **200 AGREED rows**, because the literal reading passes on 200 rows of
`book_unavailable` — a deleted manifest has zero inequalities.

```
  A) Confirm: 200 AGREED rows
  B) Reverse: 200 rows of any outcome

CHOOSE: ____
```
**PROVISIONAL taken: A.** Already recorded in the D2 gate. **B would let a deleted manifest
certify the book.**

### B4 · D2 §9.5 — the indicator axis

Neither a translation table (maps 1 of 31) nor a migration (nothing to migrate into). The
recommendation is a **second address form** describing a computation.

```
  A) Sign §9.5 as written — declare 30 addresses + (metric, timeframe) cadence
  B) Reject; indicator-condition stays permanently at CP1-CP2
  C) Something else: _______________________________________________

CHOOSE: ____
```
**PROVISIONAL taken: none — this one is genuinely yours.** ⛔ It changes what the address book IS:
today it maps a name to a stored place and computes nothing. **Unblocks:** `indicator-condition`
CP3, whose approval line is already signed and VOID until this merges.

### B5 · F-S7-RC-1 and F-S7-RC-3 — two confirmed regime defects, unfixed

RC-1: the `dedup_key` is built and never read. RC-3: path B has no ledger, so it re-queues the
same unchanged flip until the shared 8/day cap, crowding out `daily_focus`.

```
  A) Fix both now, own PR, member-visible (fewer duplicate insights)
  B) Fix RC-3 only (the one that costs a member their daily_focus)
  C) Record as EXCLUDED — the whole path retires at the S7 flip anyway

CHOOSE: ____
```
**PROVISIONAL taken: C**, on the reasoning that both die at the flip — ⚠️ **but the flip has no
date, and "it retires eventually" has kept two live defects alive before in this estate.** If the
flip is more than a month out, B.

### B6 · The two S7 dark flags have no retirement date

`ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED` and `..._EVENT_PROXIMITY_...` each retire only when
their type flips, and nothing forces that.

```
  A) Set a review date: ____________
  B) Leave them; the dark read decides

CHOOSE: ____
```
**PROVISIONAL taken: B**, ⚠️ with the warning that a dark flag with no retirement date becomes
permanent by default — which is how this estate acquired the flags it now cannot explain.

---

## PART C — the one thing I need that is not a ruling

### C1 · Arming the four new CP3 sweeps

Their approval lines are signed and every flag is **OFF**. Arming is your flip, after the
price-level dark read. **No action needed now** — recorded so it is not forgotten.

---

## What this form unblocks, in order of leverage

| answer | unblocks |
|---|---|
| **A3 (OI-06)** | **S1, S2, A2** — three systems, one answer |
| **A1 + A2 (OI-03)** | **S9, A14** |
| **B4 (D2 §9.5)** | `indicator-condition` CP3 |
| B1, B2, B3, B5, B6 | bookkeeping and two live defects; no system |
