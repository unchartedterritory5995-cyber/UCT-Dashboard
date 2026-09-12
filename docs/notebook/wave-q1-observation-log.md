# Wave Q1 — observation log

Appended by `tools/nb_observe.py`, every 2 hours, unattended. **Numbers, not
hypotheses.** One row per run; a run that could not take the rig profile writes a
SKIPPED row with its reason, so a gap in this log is never silent.

⛔ **Outbox stuck >5 min is not observable fleet-wide and the rig runs opted out.
It is covered only by real-door canary runs (rig, layer on) and by member
reports. A canary any time this weekend fills that datapoint; the sampler does
not.**

⭐ **Member vs rig.** `opt-in (member)` subtracts the rig's pre-flip baseline of
20 events, all of which were the canary opting itself in and out. The rig never
opts in during a sampler run, so it cannot inflate this.

| at (ET) | opt-in (member) | opt-in (total) | blocked-baseline | sync-conflict notes | outbox (rig only, layer off — structurally 0) | console errors (rig) | flag |
|---|---|---|---|---|---|---|---|
| 2026-09-12 01:20 ET | 0 | 20 | 0 | 3 | 0 | 0 | OK |
