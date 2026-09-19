# ⚠️ FOR THE CHART / PINE WORKSTREAM — master is red in `components/chart`

**Not this workstream's code and not this workstream's to fix. Recorded because
nobody else is currently looking at it, and because it is degrading the gate for
everyone.**

## What was measured

A six-shard gate on 2026-09-19 reported **24 NEW failures**, every one under
`src/components/chart/**`, against baseline `1216958ed` (measured **2026-09-14**).
**103 chart commits** have landed on master since that baseline.

⛔ **These are not merely "the baseline is stale".** They were re-run directly, in
a tree whose ONLY non-master content is three files under
`pages/journal-2-0/lib/offline/`, and they fail there too:

```
src/components/chart/engine/ast/paramIds.test.js
    AssertionError: wma: expected null to be truthy

src/components/chart/engine/ast/oosMeasuredBaseline.test.js
    ⛔⛔ NON-VACUITY — the corpus is really here and really translates
    AssertionError: expected 30 to be greater than 50
```

The second is the shape worth looking at first: a **non-vacuity control** is
failing, which means the corpus that rail exists to prove is really present has
roughly halved (30 against a floor of 50). A non-vacuity control going red is the
rail saying *"the thing I measure is no longer here"* — not *"the thing I measure
got worse"*.

## Why this matters beyond the chart area

The gate is shared. While these 24 stand, **every** six-shard run by **every**
workstream reports `VERDICT=NEW_FAILURES exit=1`, and each of those runs has to
be hand-classified by direction before it means anything. That is exactly how a
check stops being read: this session very nearly missed its OWN regression inside
that noise — a NUL-byte corruption caught as
`sourcesAreText > contains no NUL or other C0 control byte`, dismissed as chart
noise because 24 of the 25 were.

⛔ **They were deliberately NOT banked into the baseline by this workstream.**
Banking failures nobody has diagnosed is how a real regression gets a permitted
slot — and a non-vacuity control is precisely the kind that must never be banked.
The classification belongs to whoever owns the corpus.

## The two things that would clear it

1. Diagnose the corpus shrink (`oosMeasuredBaseline`, `paramIds`) — a halved
   corpus is a fixture/data problem, not a threshold to lower.
2. Re-baseline once green, so the shared gate carries signal again.
