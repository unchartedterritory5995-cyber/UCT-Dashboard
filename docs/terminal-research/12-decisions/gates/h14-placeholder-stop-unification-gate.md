---
id: GATE-H14-PLACEHOLDER-STOP
title: H14 — one placeholder-stop detector — approval packet
role: the approval packet for the H14 unification. Nothing builds past the scope on the approval line.
status: ✅ APPROVED 2026-09-13 and BUILT. One PROVISIONAL reading, recorded in §2.
date: 2026-09-13
measured_against: origin/master @ 664a28a61
pairs_with: the four S7 gate packets, which surfaced the class
---

# ✅ APPROVED — one detector, five call sites

## ⛔ APPROVAL

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-13
APPROVED AT SHA:  4486f5cbc   (git hash-object of this packet as it stood at
                  approval, with this field blank)
SCOPE APPROVED:   one detector in awareness/engine.py (or wherever the strictest
                  currently lives), tolerance = the strictest of the three after
                  you show me the three values; the other two call sites import
                  it. A rail asserts only one definition exists. Test: a stop
                  drifted by float epsilon from entry is still classified
                  placeholder; a stop $0.01 away is real. Mutation: restore the
                  weakest tolerance -> RED. Then in-pod read-only: re-run the
                  17-position check against the unified detector and report.
                  BEHAVIOUR-CHANGING if awareness is in flow-worker's closure -
                  check, merge, bump if so, both artifacts. Member-visible only
                  in the sense that a false alert stops being possible; flag it
                  anyway.
```

---

## 1. The three values, shown before the choice was made

| detector | rule | width @ $1 | @ $126.0049 | @ $10,000 |
|---|---|---|---|---|
| `awareness/rules.py:74` | `< 1e-9` **absolute** | 1.0e-9 | 1.0e-9 | 1.0e-9 |
| `portfolio_heat.py:35` | `<= entry × 1e-9` **relative** | 1.0e-9 | 1.3e-7 | 1.0e-5 |
| `broker/balances.py:459` | `<= max(0.001, entry × 1e-5)` | 1.0e-3 | 1.3e-3 | 1.0e-1 |

**Against the row that actually happened** — ORCL, entry `126.0049`, stop `126.005`, drift `1.0e-4`:

| detector | verdict |
|---|---|
| `awareness/rules.py` | **NOT a placeholder** ← gates a member alert |
| `portfolio_heat.py` | **NOT a placeholder** ← its own comment calls itself SAFETY-CRITICAL |
| `broker/balances.py` | placeholder ✅ |

⭐ **Two of the three missed the real case.** `balances.py` is the only one written *after* the
drift was known.

---

## 2. ⛔⛔ "STRICTEST" SPLIT TWO WAYS AND THE TWO READINGS GIVE OPPOSITE CODE — **PROVISIONAL**

> **Read as *narrowest tolerance*, the strictest is `rules.py`'s absolute `1e-9` — the value that
> PRODUCED the defect. Adopting it unifies five call sites onto the bug.**
>
> **Read as *strictest about what counts as a REAL stop*, it is `balances.py`'s wide window.**

**The protective reading was taken.** `PLACEHOLDER_STOP_ABS_TOL = 0.001`,
`PLACEHOLDER_STOP_REL_TOL = 1e-5`. Reversing it is two constants and the rail
`test_the_adopted_tolerance_is_the_WIDEST_of_the_three_not_the_narrowest` fails by name if either
retired value comes back.

⚠️ **The wide window costs something in the other direction, stated rather than buried:** a member
whose genuine stop sits inside the window is read as having set none and stops being watched. The
window is 0.1¢ at $1, 0.13¢ at $126, 10¢ at $10,000 — no deliberate stop sits there, and one that
did would be through the spread before it could be watched. The opposite failure — a false
`stop_hit` **emailed** about a stop nobody set — is louder and more likely.

---

## 3. ⭐⭐ THE SCOPE SAID THREE DETECTORS. THERE WERE FIVE.

The rail found two more, and **neither appears in any prior write-up of this class**:

| # | where | rule | what its failure costs |
|---|---|---|---|
| 4 | `journal_two/tag_suggest.py:61` | `abs(stop − entry) < 1e-9` | a drifted placeholder reads as a real stop, so the member never gets the **`no_stop` suggestion** for a position that has no stop |
| 5 | `journal_two/metrics_registry.py:328` | `abs(stop − entry) > 1e-9` — the **inverse** | ⛔ **the worst of the five: it mislabels the PROVENANCE of a number.** A drifted placeholder contributes a fabricated `drift × shares` of risk to the member's average risk-per-trade **and is booked under `sources["stop"]`** — the metric then claims it derived that risk from a stop the member never set |

⛔ **They were found by matching the ARITHMETIC, not a function name.** The five were called
`_is_placeholder_stop`, `stop_is_placeholder` (twice, inline), nothing at all, and an inverted
condition. What they shared was comparing a stop to an entry against a tolerance.

⚠️ **And the pattern needed the COMPARISON to be right.** `abs(entry − stop)` is also how you
compute risk per share — `metrics_registry.py:329` does exactly that, **one line below** a real
placeholder test. A pattern matching the subtraction alone reports the risk arithmetic as a sixth
detector and gets "fixed" by deleting an exemption, which is how a rail starts lying.

---

## 4. Two defects the tests found in the fix itself

1. **NaN was reported as a REAL stop.** `abs(nan − x) <= y` is `False`, so a NaN fell through every
   comparison. ⭐ The worst answer available: a "real" stop gets watched, and every comparison
   against NaN is also `False`, so the position is silently never alerted on at all. Caught by its
   own test, before merge.
2. **The one-definition rail could not see its own definition.** After `ast.unparse` the shared
   module read `abs(s - e)` — locals named `s`/`e`, invisible to a `stop`/`entry` pattern. The
   non-vacuity control failed exactly as designed; the locals are now `stop_v`/`entry_v`.

---

## 5. The behaviour change, declared rather than absorbed

The unified detector carries `portfolio_heat`'s **unusable** clause (non-positive, unreadable, NaN,
inf). `rule_stop_watch` did not have it. ⛔ **A stop of `0` on a SHORT computes
`(0 − price)/price = −1.0`, which is `≤ 0`, which is `stop_hit` — on every cycle.** After H14 it is
a placeholder and is skipped. Demonstrated in
`test_a_zero_stop_on_a_SHORT_no_longer_fires_every_cycle`, with the pre-H14 arithmetic asserted
alongside so the removed fire is checkable rather than remembered.

**The source gate STAYED at the call site.** `rule_stop_watch` still skips only `source ==
'broker'`; a member's own stop is never discarded for sitting near their entry. Railed end-to-end.

---

## 6. Classification

**ADDITIVE, no marker bump — measured, not assumed.** `reachable_paths()` = 154, `watched_paths()`
= 24. `awareness/rules.py`, `awareness/engine.py`, `portfolio_heat.py`, `broker/balances.py`,
`tag_suggest.py`, `metrics_registry.py` and the new `placeholder_stop.py` are **all
`reachable=False`** — flow-worker runs none of them. The scope's conditional (*"BEHAVIOUR-CHANGING
if awareness is in flow-worker's closure"*) resolves to NO.

⭐ **MEMBER-VISIBLE, flagged as instructed**, and in one direction only: two classes of false
alert — a drifted broker placeholder, and a zero stop on a short — stop being possible. No member
loses an alert they should have, because a genuine stop is unaffected and the source gate is
unchanged.

---

## 7. Mutations

| # | mutation | result |
|---|---|---|
| **A** | restore the weakest tolerance (abs `1e-9`, rel `0`) | **4 RED** |
| **B** | a sixth copy of the arithmetic appears in an unrelated module | **1 RED** |

**Measured:** 82 passed across the H14 rail, awareness rules, portfolio heat, broker balances,
metrics registry and tag suggest; `PYTEST_EXIT=0`.

---

## 8. What a future line would need to name

1. **The `stop_price` NOT NULL constraint itself.** Every one of these five detectors exists
   because the column cannot hold NULL. A nullable stop with a migration would delete the class
   rather than unify it — larger, and a real schema change on a live store.
2. **`sources["stop"]` in `metrics_registry`.** Now correct, but nothing tells a member which of
   their risk figures came from a stop and which from a realised R. That is an S8 provenance
   question.
3. **Whether a placeholder should be VISIBLE to the member** as "no stop set" rather than blanked.
