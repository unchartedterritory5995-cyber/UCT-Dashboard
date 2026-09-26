---
id: RUN-QW-1
title: Quiet measurement window — Tuesday 2026-09-29, 09:15–12:15 ET
role: >
  The run sheet for the first declared quiet window. Owner scheduled it 2026-09-26 after two
  independent gate deliverables (items 17 and 29) both identified "declare a quiet window" as the
  single highest-value thing the owner could supply, because it is a scheduling decision rather
  than work and it sits above several other items.
status: scheduled
---

# Quiet window — Tuesday 2026-09-29, 09:15–12:15 ET

⛔ **NO-DEPLOY BLOCK. Nobody pushes to master in this window, including the agent.** Everything
run inside it is read-only.

⚠️ **Pending: partner notification.** The owner asked for Bracco to be tagged in Discord with the
block and an invitation to propose a different day. Until he has replied or the window has passed
without objection, **treat the date as proposed rather than agreed.**

---

## Why this window exists

The pod's **median life is 26 minutes** (Protocol F, 2026-09-26, 14 deploys in 6.5 hours). Three
measurements are invalid or impossible against that:

| measurement | what it needs | why it failed before |
|---|---|---|
| **Protocol F** — the memory leak | **≥ 2 h of one deployment** | the only usable sample was a 104-minute deployment found by luck; `n = 1` |
| **Protocol A** — cache warm ratio | uptime **≥ 900 s** | first attempt void at 112 s by the protocol's own rule; a valid window took ~17 min of waiting |
| **Protocol C** — the page waterfall | **market hours** | everything measured 2026-09-26 was after the close, so the mechanism is established and its magnitude is not |

⭐ **09:15–12:15 ET covers the open** (for Protocol C and for watching the loop through the
open), **gives Protocol F a deployment well over two hours**, and sits clear of the owner's
06:35 and 07:00 CT morning jobs and well before the 15:15–16:05 CT afternoon cluster.

⛔ **What this window does NOT satisfy.** CARD 18's condition for arming the event-loop watchdog
is *one observation window spanning a market open AND a heavy-job window*. Those are ~6 hours
apart, so this window covers the open half only. **The watchdog stays unarmed and nothing is
blocked by that** — a second, longer window settles it later.

---

## The run sheet

**T−10 min.** Confirm the block is holding: `git fetch origin master` and note the SHA. Read
`/api/health` and record `uptime_seconds`. ⛔ If a deploy landed inside the last 10 minutes, the
window starts late rather than starting invalid.

**T+0 to T+15 (the open).** Protocol C in a **real foreground browser**, signed in as the owner.
⛔ Read `document.visibilityState` FIRST and abort without taking a number if it is not `visible`
— a hidden tab throttles timers and defers paint. Walk `/options-flow`, `/calendar`, `/charts`,
`/dashboard`, `/live-massive`. Record per surface: TTFB, DOMContentLoaded, first contentful
paint, resource count, bytes from network versus cache, and **per-request stall versus server
time**, which is the split that identified the cold-pack mechanism.

⭐ **The specific question this answers:** the 31 MB cold-pack load and its 8.6–10.9 s server-side
shard cost were measured after the close. **Does it get worse during RTH, and by how much?**

**T+15 onward, continuous.** Leave the window alone and let the pod age. This is the whole point;
the measurement is the absence of deploys.

**T+120 or later.** Protocol A at **uptime ≥ 900 s** (it will be far past that). Then Protocol F:
read the `[mem]` samples across the single long deployment and compute the slope.
⭐ **The question: does the +7.9 MB/min leak reproduce, and is it load-dependent?** The first
reading was after the close, so an RTH slope is a different number and a more useful one.

**Throughout.** Record the event-loop watchdog's `max_lag_ms` across the open. Its after-hours
maximum was 14.9 ms against a 30-second threshold; the open is where that would move.

**T+180. Close the window** and post the SHA, so the next person knows what was being measured.

---

## ⛔ Rules that hold inside the window

1. **No push to master by anyone, including the agent.** A deploy invalidates Protocols A and F
   outright and restarts the clock.
2. **No heavy local job.** The box is also the data producer for the scheduled member-facing
   tasks and it is where any gate would run. A six-shard gate takes 46–92 minutes and would
   contend.
3. **Read-only against production.** No flag flip, no variable set, no pod write.
4. ⛔ **A measurement taken outside the declared window is not a window measurement**, and must be
   labelled as an ordinary reading. The whole value here is the stated precondition.

## What gets written afterwards

An evidence file under `10-roadmap/evidence/2026-09-29-quiet-window/`, with each protocol's own
validity context stated per row, and an explicit delta against the 2026-09-26 after-hours
readings. ⭐ **The deltas are the point** — the 09-26 numbers are a control taken with the market
shut, so this is the first chance this programme has to separate "the market is open" from
"the system is loaded".
