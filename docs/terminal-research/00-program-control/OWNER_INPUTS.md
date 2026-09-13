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


### B4-PLAIN · D2 §9.5, the indicator axis — five plain lines, as asked

1. **What the metric address book is today.** One file listing 142 metrics, each saying *where a
   value is already stored* — a table and a column, nothing more. It computes nothing, so it can
   never be wrong about a number; it can only be wrong about a location.

2. **What the indicator axis adds.** Thirty more addresses that have **no stored location** —
   `bb.upper`, `rsi`, `macd` and the rest are calculated on demand from bars, differ per
   timeframe, and change meaning with their parameters. The book would start describing *work to
   be done* instead of *a place to look*.

3. **What signing it lets happen.** `indicator-condition` becomes buildable. Today every predicate
   a member could write in the legacy alert lane **refuses** — measured: 31 legacy addresses, 142
   book metrics, exactly one shared (`close` ↔ `ohlcv.c`). Signing unblocks that type's CP3, whose
   approval line is already written and void until this merges.

4. **What it risks.** The book stops being a pure lookup, which is the property that makes it safe
   — a wrong entry today points at the wrong column and is caught; a wrong entry then computes a
   wrong number and looks authoritative. It also needs `bars_fetch`/`bars_sqlite` edits, and those
   sit inside flow-worker's closure, so declaring the cadence costs either a tape gap or a change
   to what flow-worker watches.

5. **Recommendation.** ⚠️ **Not yet — and not never.** The unblock is one alert type; the cost is
   the book's defining property plus a flow-worker decision nobody has made. **Settle the
   flow-worker watch-list question first** (that is a small, reversible call), and sign §9.5 after.
   If you want `indicator-condition` sooner than that, sign it — but sign the watch-list change
   with it, because building one without the other ships a declaration the worker computes against
   a stale copy of.

---

## PART B-2 — ⚰️ ANSWERED BY ACTION SINCE THIS FORM WAS WRITTEN (2026-09-12)

Left in place rather than deleted, so a returned form cannot contradict what shipped.

| item | state now |
|---|---|
| **B4 / B4-PLAIN** · D2 §9.5, the indicator axis | ✅ **SIGNED AND MERGED** as **GATE-D2 CP4**, fingerprint `3257cc319`, merge `404b808c5`. §4 was re-numbered in the signing commit because §9.5's scope matched none of CP1/CP2/CP3. **This CHOOSE is moot** — answer it only if you want the decision reversed. |
| **C1** · arming the four new CP3 sweeps | ✅ **DONE 2026-09-13**, plus a fifth: `indicator-condition` armed 20:48:30 UTC. **Seven** dark sweeps are now armed, not four. |
| **B6** · the S7 dark flags have no retirement date | ⚠️ **STILL OPEN AND NOW WIDER** — it said *"the two S7 dark flags"*; there are **seven**. |

---

## PART D — PROVISIONALs taken 2026-09-13, awaiting confirm-or-reverse

### D1 · F-S7-PL-2 — per-sweep windows NARROW what `--ticking` calls a stall

Generalising `--ticking` over the sweep table gave each sweep its own window. A sweep that dies
**mid-window** and is only checked **after** the close now reports exit `0`, where the single
global window would have reported a stall.

```
  A) KEEP the narrowing — a windowed sweep that stopped at its window's close has done nothing
     wrong, and flagging it every weekend gets the command muted
  B) REVERSE it — a stale heartbeat is a stall whatever the clock says

CHOOSE: ____
```
**Recommendation: A.** The Monday 09:05 ET check is inside every window, so it is not a gap today.
**Unblocks:** nothing — it settles whether the instrument is measuring the right thing.

### D2 · F-GATE-1 — two approval-fingerprint conventions, and one duplicated pin

27 of 33 approval lines are `git hash-object` content fingerprints; **6 are commit SHAs**. Both pin
bytes. ⛔ But `s7-event-proximity`'s **two** lines carry the **same** value, and that commit
contained only the first block.

```
  A) Content fingerprint is the one convention; re-pin the 6 (needs 6 new signatures)
  B) Both conventions are acceptable; re-pin ONLY event-proximity line 2 (1 new signature)
  C) Record and leave — the bytes are recoverable either way

CHOOSE: ____
```
**Recommendation: B.** A is six signatures for a property `git show` already gives; C leaves one
line pinning a state in which it did not exist. **Unblocks:** nothing — it closes F-GATE-1.

### D3 · F-S7-IC-1 — thirty indicator outputs the book carries in no form

CP3 now reports them **NOT COMPARABLE per predicate**, which is honest. Closing the finding needs a
book form for the thirty — **thirty declarations plus a warmup contract**, and it is blocked on the
`bars_fetch`/`bars_sqlite` watch-list decision you already ruled (the list is NOT widened).

```
  A) Declare the thirty later, after the flow-worker watch-list question is reopened
  B) EXCLUDE the thirty permanently — the legacy indicator lane keeps its own vocabulary
  C) Leave OPEN, unscheduled

CHOOSE: ____
```
**Recommendation: C for now.** The dark read will show whether any member predicate is affected;
deciding before that data is guessing. **Unblocks:** the indicator-condition FLIP, eventually.

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
