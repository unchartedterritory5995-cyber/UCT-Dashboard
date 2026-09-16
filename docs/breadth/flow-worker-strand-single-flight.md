# Watch-coverage classification — breadth history single-flight (2026-09-14)

`python tools/flow_worker_watch_coverage.py` is **RED** on this change. Per
`docs/runbooks/deploy-windows.md` ("Interpretation — what a red from the coverage rail
requires") a red is a **review gate**, not a block, and it requires a written
classification before the push. This is that classification.

```
[watch-coverage] base=origin/master reachable=155 watched=24 changed=3
[watch-coverage] FAIL — flow-worker RUNS these files but will NOT redeploy for them:
    api/services/breadth_monitor.py
    api/services/single_flight.py
```

## The reach, traced rather than assumed

Derived with the coverage tool's OWN closure walk, so this cannot disagree with the rail
that raised the flag:

```
api.flow_worker_main → api.flow_gap_autofill → api.services.liveflow_monitor
                     → api.services.bars_fetch → api.services.breadth_monitor
                                               → api.services.single_flight
```

**Four hops, and the last one carries exactly one symbol.** `bars_fetch.py:2466` is the
only reference to the module in flow-worker's closure, and it calls **`get_latest()`** —
which is `get_history(1)` — while building the bars prewarmer's priority ticker list.
Nothing in the closure calls `get_history_deep` at all.

## Tier: BEHAVIOUR-CHANGING by the letter, measurably inert at that call site

⛔ **Not filed as ADDITIVE, even though the diff deletes nothing** (`git diff
<merge-base>..HEAD -- api/ | grep -cE '^-[^-]'` → **0**). The runbook's own warning applies:
*"'additive' is a claim about the diff, so check the diff, not the intent."* Zero deletions
is true here and still not the point — `get_history` no longer runs its body inline, and
flow-worker executes `get_history`. That is the definition of behaviour-changing.

⭐ **And the measured divergence at the one call site is nil.** `get_latest()` is a single
caller asking for a one-row window. Under the new code that is: cache miss → become the
leader → run the same body → return the same value. Single-flight only changes what
happens when a SECOND caller arrives for the same key while the first is still working,
and there is no such second caller on flow-worker.

So the estate divergence this tier exists to make visible is, precisely: **flow-worker
keeps doing exactly what it does today, lacking a de-duplication that would never fire
there.**

## Decision — merge, DO NOT discharge

- **Merged without a marker bump.** Discharging a strand means forcing a flow-worker
  redeploy, and a flow-worker restart drops the Massive OPRA socket: the tape gap is
  **permanent** until the T+1 flat file. Paying that for zero behavioural difference at
  the only reachable call site is the trade the narrow watch list exists to refuse.
- **Open for the owner:** bump the deploy marker at a weekend/after-hours window if and
  when flow-worker is being redeployed for something that matters anyway. There is no
  deadline; the stale state is the current state.

⭐ **There is no partial-deploy hazard, which is the obvious thing to fear here.** The new
`breadth_monitor.py` imports a brand-new module, so a deploy carrying one without the other
would be an `ImportError` at first use. Railway's watch list decides **whether** a service
rebuilds, never **which files** it receives — a rebuild takes the tree at master's tip. When
flow-worker next deploys for any reason it gets both files together.

⚠️ The rail is reporting the truth and must stay red on this diff. Neither the watch list
nor flow-worker's own files were touched to make it green — the runbook forbids exactly
that, and a rail edited to agree with a change it was raised against is worth nothing.
