# D-12 field findings — Q6, and the rotation that was already half-done

> ⚰️⚰️ **SECTION 1'S VERDICT IS SUPERSEDED. READ `OI-44-STALL-CENSUS.md` INSTEAD.**
> Q6 concluded **STARTUP-CLASS** from seven trailing windows on ONE pod over 30 minutes.
> The D-14 monitor then collected **34 pods over 33.9 hours** and found **42 stalls ≥ 1,000 ms
> (29.7/day), of which 27 are provably past the 900 s floor**, including blocks of 80 s, 20 s
> and 14 s on a pod up for 40–58 minutes. **Stalls are not startup-only; they are continuous.**
> The verdict below was applied honestly against its rule — the clean post-minute-15 window
> really was observed — but it was a verdict about one pod, and a one-pod sample cannot
> support a claim about a fleet that restarts ~20 times a day.
> ⭐ Kept, not rewritten: the reasoning is sound and the correction is the point.
> Section 2 (OI-13) is UNAFFECTED and still current.

**2026-09-15 evening ET. Two findings, both of which change a premise the directive was written against.**

---

## 1. Q6 — the 3.2 s stall is STARTUP-CLASS, and the instrument has a 5-minute memory

⛔⛔ **FIRST, THE INSTRUMENT'S LIMIT, because every prior reading in this programme was quoted
without it.** `loopwatch.WINDOW = 600` samples at `INTERVAL_S = 0.5` — `snapshot()["max_ms"]` is the
maximum over the **trailing ~5.2 minutes**, NOT over the pod's life. A stall older than that is gone
from the reading entirely. So D-11's *"max_ms 3224.9 at uptime 538 s"* was never a pod-lifetime
maximum either, and no reading in this programme has ever been one.

### The measurement

21 readings on ONE pod (`7eef82ec2ed8`, boot 00:08:45 UTC), uptime 90 s → 1796 s, **no deploy in
between**, plus 2 readings on its predecessor. Recorded in
`evidence/loop-baseline/d12-q6-series.jsonl`.

| uptime | min | max_ms | p95_ms | stalls/600 |
|---|---|---|---|---|
| 90 | 1.5 | **2669.3** | 92.1 | 8 |
| 404 | 6.7 | 504.7 | 103.4 | 49 |
| 698 | 11.6 | 522.7 | 45.7 | 29 |
| 773 | 12.9 | **1097.9** | 45.7 | 29 |
| 957 | 15.9 | 1097.9 | 107.7 | 45 |
| 1143 | 19.1 | 575.7 | 120.0 | 58 |
| **1235** | **20.6** | **430.9** | 117.8 | 54 |
| 1327 | 22.1 | 484.9 | 84.1 | 40 |
| 1419 | 23.6 | 492.3 | 89.8 | 41 |
| 1511 | 25.2 | 492.3 | 73.1 | 38 |
| 1604 | 26.7 | 492.3 | 66.7 | 37 |
| 1699 | 28.3 | 469.7 | 61.8 | 34 |
| 1796 | 29.9 | 469.7 | 27.8 | 27 |

### The verdict, against the owner's own decision rule

> *"A max >= 1000 ms after minute 15 with no deploy in between = steady-state stall; a clean window
> after minute 15 = startup remains the best explanation."*

The window spans ~310 s, so a reading's window lies entirely past minute 15 once uptime >= ~1220 s.
**SEVEN consecutive such windows** (uptime 1235 → 1796) cover minute 15.4 through 29.9 continuously.
The largest stall in ANY of them is **492.3 ms**. Not one reading reaches 1000 ms.

⭐ **VERDICT: STARTUP.** The clean post-minute-15 window was observed, seven times, on one pod.

### Where the >= 1 s events actually fell — and why "startup" is a poor name for it

Bracketed by when each value entered and left the trailing window:

- **2669.3 ms** — present in the very first reading (150 samples), gone by uptime 404. Occurred in
  the first ~90 s. A boot event.
- **1097.9 ms** — ABSENT at uptime 698, PRESENT at 773. Occurred between those, i.e. **minute
  11.6–12.9**.
- On the previous pod, the **20,446.6 ms** reading at uptime 1007 (window ~[11.2, 16.8] min) was
  absent from the window ~[14.9, 20.1], so it fell in **minute 11.2–14.9**.

⛔ **So the label is right and the word is wrong.** These are not boot events; the last one lands at
minute 12–13, and the 20.4 s one at minute 11–15. Whatever produces them runs for the first ~13
minutes of a pod's life — prewarmers, cache warms, the +20 s dashboard warm, the +60 s ticker-names
and logo prewarms, RS, reconciliation. "Startup" here means *startup-adjacent background work*, not
boot.

### Two things the verdict does NOT say

1. ⛔ **The settled loop is not healthy.** After minute 15 the maxima sit at **430–492 ms** with
   p95 62–118 ms and 27–58 of every 600 half-second samples overshooting 50 ms. A 492 ms block is
   **one sixth of the entire 3 s Discord ack budget**, on a pod under no particular load.
2. ⛔ **p95 does not settle monotonically** — it falls to 42.9 ms by minute 14.4, then RISES to
   120.0 ms by minute 19.1, then falls again to 27.8 ms. A single settling curve does not produce
   that. Periodic scheduled work on the one shared event loop does. **That is the hypothesis worth
   testing next**, and it is testable: correlate the humps against the APScheduler job table.

### The number that actually deserves the headline

**20,446.6 ms.** A twenty-second block of the single event loop that serves every member request on
`web`. It is 6.8x the entire ack budget. By the decision rule above it is "startup", because it fell
before minute 15 — but a 20 s loop block is a catastrophic reading whenever it happens, and the
5-minute instrument window means **we do not know how often it happens.** C-02 is about ack and
render failing together; for 20 seconds, everything failed together.

---

## 2. OI-13 — the rotation was ALREADY HALF-DONE, and step 2 would have broken Morning Wire

**Part 2 was STOPPED before setting anything. Nothing was changed.**

The runbook (`OI-13-ROTATION-RUNBOOK.md`) is written for a clean start: step 2 sets
`CHART_RENDER_TOKEN_PREVIOUS` := the current value of `CHART_RENDER_TOKEN`, opening dual acceptance.
That assumes PREVIOUS is empty. Measured on `web`, presence-and-length only:

| variable | present | length |
|---|---|---|
| `CHART_RENDER_TOKEN` | yes | 32 |
| `CHART_RENDER_TOKEN_PREVIOUS` | **yes** | 32 |

Compared in-process without printing either value (salted sha256, truncated to 8 hex):

- `identical: false` — they are **different values**
- `_accepted_tokens()` returns **2 distinct** tokens
- current = `71c5974f`, previous = `6b32b198`

⛔ **Production is running two live render tokens right now.** In the runbook's own words:
*"An uncleared previous is not a rotation, it is two live tokens."* Someone rotated and never ran
step 6.

### The measurement that decides what to do

Morning Wire's local config (`C:\Users\Patrick\morning-wire\.env`), same fingerprint function:

    CHART_RENDER_TOKEN  len=32  fp=71c5974f   ->  the CURRENT token

⭐ **Every identified sender is already on CURRENT.** Web's two senders read env at request time;
the frontend bundle was rebuilt from the current env; Morning Wire matches CURRENT by fingerprint.
`6b32b198` is a leftover held by nobody we can name.

### Why running the directive's steps 1–3 would have been actively harmful

Step 2 would have **overwritten** `CHART_RENDER_TOKEN_PREVIOUS` (`6b32b198`) with the current value.
If any sender still holds `6b32b198` — a browser carrying a pre-rotation bundle is the realistic
case — that write is what breaks it, and it breaks it *silently*, with a 403 at `/r/*`. The dual
acceptance that makes a rotation safe protects the token you are rotating AWAY from; it cannot
protect one you have just deleted.

It would also put Morning Wire one rotation behind, requiring the owner's keyboard at step 4, in
exchange for nothing: the value it holds is already current.

### What is actually left

**Step 6, and only step 6: clear `CHART_RENDER_TOKEN_PREVIOUS`.** That is the step that IS the
rotation. Its single risk is any browser still holding a pre-rotation bundle, which loses `/r/chart`
and `/r/buzz` until it reloads.

⛔ **NOT DONE, and deliberately: that is a member-visible blast radius on a population this session
cannot size,** and it is one env change away at any time. It needs an owner decision, not an agent's.
The C-13 11x4 control (step 7) is unaffected and still pending.
