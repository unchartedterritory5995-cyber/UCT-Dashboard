# Wave Q1 — observation log

Appended by `tools/nb_observe.py`, every 2 hours, unattended. **Numbers, not
hypotheses.** One row per run; a run that could not take the rig profile writes a
SKIPPED row with its reason, so a gap in this log is never silent.

⛔ **Outbox stuck >5 min is not observable fleet-wide and the rig runs opted out.
It is covered only by real-door canary runs (rig, layer on) and by member
reports. A canary any time this weekend fills that datapoint; the sampler does
not.**

⛔ **`opt-in (windowed)` IS NOT A LIFETIME COUNT.** It reads the last 200
population activity rows, so it can DECREASE as old events roll off — it did,
20 → 19, which is what exposed the original `member = total − 20` column as one
that could only ever say zero. **Read `latest opt-in` instead:** it moves when a
new event arrives regardless of roll-off. Every opt-in up to
`2026-09-12 05:17:56` was the rig opting itself in and out during canary runs;
the rig never opts in during a sampler run, so a latest NEWER than that, with no
canary running, is a REAL MEMBER.


⚰️ **RECOVERED.** These five rows were written under the ORIGINAL schema, whose
second column was `opt-in (member)` — the subtraction that could only say zero.
They were destroyed when the column was corrected (the appender rewrote the file
on a header mismatch) and are restored here from the repo copy. Read column 2
below as the OLD member count, not as `latest opt-in`.

| at (ET) | opt-in (member, OLD schema) | opt-in (windowed) | blocked-baseline | sync-conflict | outbox | console errors | flag |
|---|---|---|---|---|---|---|---|
| 2026-09-12 01:20 ET | 0 | 20 | 0 | 3 | 0 | 0 | OK |
| 2026-09-12 03:00 ET | 0 | 19 | 0 | 3 | 0 | 0 | OK |
| 2026-09-12 05:00 ET | 0 | 19 | 0 | 3 | 0 | 0 | OK |
| 2026-09-12 07:00 ET | 0 | 19 | 0 | 3 | 0 | 0 | OK |
| 2026-09-12 09:00 ET | 0 | 19 | 0 | 3 | 0 | 0 | OK |

| at (ET) | latest opt-in (UTC) | opt-in (windowed) | blocked-baseline | sync-conflict notes | outbox (rig only, layer off — structurally 0) | console errors (rig) | flag |
|---|---|---|---|---|---|---|---|
| 2026-09-12 09:20 ET | 2026-09-12 05:17:56 | 19 | 0 | 3 | 0 | 0 | OK |
| 2026-09-12 09:31 ET | 2026-09-12 05:17:56 | 19 | 0 | 3 | 0 | 0 | OK |
