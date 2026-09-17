# The web-swap `/api/*` blip, measured against a NAMED deploy

Everything this programme has costed — R64's daily line above all — uses the runbook's
*"~1 min `/api/*` blip"*. That number has no measurement behind it in any artifact I can find.
This is one.

## The run

Deploy `4c78692c0` (the D-18 tooling merge: `tools/`, `tests/`, two docs — a **web-only**
restart, nothing on flow-worker's watch list). Poller: 20 s cadence, keyed on the **commit**,
reading `/api/health` through Cloudflare with a browser UA, started before the push.

```
23:08:15  push
23:11:48  deploy record appears          BUILDING    /api/health 200     <- 3m33s of lag
23:13:34                                 BUILDING    /api/health 200
23:13:57                                 DEPLOYING   /api/health 502
23:14:18                                 DEPLOYING   /api/health 502
23:14:39                                 DEPLOYING   /api/health 502
23:15:19                                 DEPLOYING   /api/health 502
23:15:56                                 SUCCESS     /api/health 200     uptime_seconds 94
```

**Contiguous 502: 23:13:57 → 23:15:19 = 82 s confirmed, bounded above by 119 s** (the gap to the
next 200). Against a documented *"~1 min"*, the measured cost of one ordinary web swap is
**1.4× to 2× the figure every estimate in this programme has used.**

⚠️ **n = 1.** One deploy, one pod, one moment. It bounds nothing; it is a single honest
observation replacing a number with no observation at all. R64's line should carry it as
*"82–119 s measured once"*, not as a new constant.

## A third sample for the record lag, and it widens the range

`3m33s` from push to the deploy record appearing. The two prior measurements were **2m38s** and
**3m25s**. ⛔ **This is the third point and it moved the top of the range**, which is the
argument against ever calibrating a wait on it: a settle threshold fitted to the samples so far
would already have been wrong tonight, and it would have been wrong **silently** — you would
read a quiet queue and believe it.

## What it says about the two 502s in the incident, and what it does NOT

⭐ **The shapes are different, and that is the only conclusion available.** This swap produced a
**contiguous run of four 502 samples over 82 s**. The 2026-09-17 22:15Z incident produced **two
isolated single samples, 234 s apart, each with 200s on both sides** at the same 30 s cadence.

⛔ **That does not identify a cause and must not be written up as if it did.** A swap whose
DEPLOYING phase lands between two polls would produce exactly one isolated sample, and two swaps
would produce two. So the incident's shape is *compatible* with two ordinary swaps sampled
sparsely, and *also* compatible with something that is not a swap at all. One measurement of one
swap cannot distinguish those, and the deploy list cannot either — `REMOVED` is every superseded
deploy's terminal state, which is the reasoning already struck from the incident record.

**What is now known:** an ordinary web swap costs members 82–119 s of 502, measured once,
attributable to a named deploy. **What is still unknown, and is recorded as unknown:** which
swap, if either, produced the two isolated 502s at 22:16:50Z and 22:20:44Z.
