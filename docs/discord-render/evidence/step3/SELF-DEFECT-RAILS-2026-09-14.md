# D-02 Part C — the three self-defects, turned into rails

> ⛔ **THE POINT IS NOT THAT THE DEFECTS WERE FIXED — THEY WERE FIXED THE DAY THEY WERE FOUND. The
> point is that each one was invisible to every check that existed, so each needs a control that
> goes RED when the fix is removed.** A fix without that control is a fix that lasts until the next
> refactor.
>
> ⭐ All three are the same disease in three organs: **an instrument reporting a property of itself
> as a property of what it measured.**

---

## D1 · Fifteen cases counted, five evaluated

**What happened.** `load_harness.self_check` built a list of cases and evaluated it in a loop that
sat **in the middle of the appends**. Fifteen cases were appended after that loop; they were counted
by `len(cases)` and never checked:

```
TOTALS load_harness --self-check PASS cases=20 failed=0     ← five were evaluated
```

⭐ **The count rose and the checking did not** — the flip-gate defect one level down.

**Why "put the loop last" is not a rail.** It was already true, and it stopped being true. Nothing
enforced it, and the next person adding a case at the bottom of a 600-line function restores the bug
with every totals line still reading PASS.

**The rail — `docs/discord-render/instruments/selfcheck.py`.** A collector that **seals**: once the
results have been read, a further `add()` raises `SealedCases`. The totals line prints three
separate numbers, because a tool that reports two of them can hide the third:

```
TOTALS load_harness --self-check PASS declared=48 evaluated=48 failed=0
```

**RED / GREEN** (`python docs/discord-render/instruments/selfcheck.py`, 6/6):

| control | proves |
|---|---|
| a case added after the results were read **RAISES** | the 2026-09-14 defect is now a crash, not a quieter number |
| adding before the read still works | ⛔ the control above is not just "add always raises" |
| an **EMPTY** case set is a FAILURE | a self-check that evaluated nothing proved nothing |
| a failing case is reported as a failure | the collector can still go red at all |
| the triple is printed with all three numbers | `declared=2 evaluated=2 failed=1` appears verbatim |
| a truthy **non-bool** is refused | a case returning `"yes"` or a dict passes for the wrong reason |

---

## D2 · An upper bound cannot see a blind gauge

**What happened.** The in-flight rail asserted `peak <= N`. A mutation setting `peak = 0` left it
**green**: an upper bound cannot distinguish *"never exceeded N"* from *"never saw anything"*.

**The rail — bounded on BOTH sides, with a broken-variant control** (`load_harness.self_check`):

| case | bound |
|---|---|
| `closed loop reaches EXACTLY N in flight, never more` | `peak == 4` — equality, not `<=` |
| `closed loop actually HOLDS N in flight under saturation` | `mean >= 3.0` — the non-zero-sample half |
| `releasing before completion is CAUGHT by the mean` | a deliberately broken client must break the lower bound, or the row above passes for a loop that never held anything |

**⚠️ AND THE SAME DISEASE WAS FOUND AGAIN, IN A SECOND INSTRUMENT, WHILE WRITING THIS.** The
`--real` driver's queue-depth gauge samples on a 0.5 s loop. In a 21-second shake-out it produced
**four samples**. Its "max interactive depth: 1" therefore means *the gauge caught 1*, not *the
depth was 1* — and nothing in the artifact said the gauge had been starved.

**The second rail** — the artifact now carries the gauge's own coverage
(`expected` vs `actual` samples and a `starved` flag), and a depth claim made over a starved gauge
is refused rather than quoted. ⭐ It is the same fix as D1 wearing different clothes: **publish the
denominator, not just the number.**

---

## D3 · A load model that did not model the load

**What happened.** The first closed loop resolved refusals with no delay, so thirty clients
hammering the per-member limit produced **521,654 attempts in 20 seconds** and **six acks over
3 s** — a completely plausible S1 FAIL that was entirely the harness. A real member told "slow down"
does not retry twenty-six thousand times a second.

⭐ OI-37's own mistake in miniature.

**The rail.** `--think-time` is explicit, parameterised, recorded in the artifact — and now
**asserted**: a closed loop's offered rate cannot exceed what `concurrency / think_time` allows.
A run that spins is **INCONCLUSIVE** (2), never a FAIL (1): the harness measured itself, and
collapsing "we measured a breach" into "we could not measure" is the exit-code defect this whole
instrument exists to avoid.

| case | proves |
|---|---|
| a spinning loop is caught by the offered-rate ceiling | the 2026-09-14 run would now refuse instead of publishing six acks over 3 s |
| a healthy loop at the same concurrency is NOT caught | ⛔ non-vacuity — a ceiling that fires on the good case gets raised until it fires on nothing |
| a spin is INCONCLUSIVE, never FAIL | 1 and 2 are different facts about the run |

---

## ⛔ What this part did NOT do

**It did not add a rail for OI-40** (`queue_full` recorded while the queue held 1 of 48 slots). That
is a product question about an overloaded failure class, not a harness self-defect, and asserting a
rail before the cause is confirmed would pin the wrong behaviour. Filed with its evidence in
`SIZING-INVENTORY-2026-09-14.md` §D2.
