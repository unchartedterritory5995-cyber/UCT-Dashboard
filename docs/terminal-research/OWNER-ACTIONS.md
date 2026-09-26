# What needs you — 2026-09-26, third revision of the night

✅✅ **ALMOST NOTHING. Read the table and stop.** You granted the permission, moved a Chrome
window to the front, and delegated the three decisions. All three are ruled, item 3 is measured
and closed, and item 6 is closed. **One action is left that only you can do, and it is a
thirty-second Cloudflare edit that nothing is waiting on.**

| # | item | state |
|---|---|---|
| 1 | identify the one alert | ⭐ **mostly answered without you.** Three of four fields came from the app's own admin report. The remaining read is optional |
| 2 | watch yourself work one morning | ⛔ still yours. An observation, not a decision, and nothing is held for it |
| 3 | two browser measurements | ✅ **DONE.** You brought the window forward; both are measured and written up |
| 4 | one contract answer, OI-04 | ⛔ still yours. From outside the company |
| 5 | tiers | ✅ **YOU RULED IT: one paid tier.** My two-tier default is struck |
| 6 | the CDN question | ✅ **DONE**, and it produced one small edit for you |
| **NEW** | **turn off a four-hour browser cache at Cloudflare** | ⛔ **yours, 30 seconds, nothing waiting on it** |

⭐ **The single action, if you want it.** A Cloudflare rule is overriding your own code's
`max-age=0` on the flow endpoint and replacing it with four hours of browser caching on a live
options tape. Your code comment predicted that exact override. Keep the edge cache, which is
doing real work at sixty seconds. Stop the rule rewriting the browser lifetime. Reasoning in
`12-decisions/DECISION_CARDS_2026-09-26.md` CARD 20.

⭐ **And one ruling I made for you that you may want to look at.** The S7 flip bar was requiring a
counter to reach zero that a *correct* fix makes non-zero. I re-cut it (CARD 21) so the safety
clause is the one that matters — no member ever gets an EXTRA alert, which has held on four
consecutive reads — and disagreements only block on predicates that are still live, with every
excluded one named and explained. An unexplained exclusion still blocks the flip.

⛔ **What I did NOT do with your authority.** I did not grant myself a permission, did not edit
settings, and did not change CARD 1 itself until you delegated it. The pod-read boundary is
unchanged and I stopped at it four times rather than routing around it.

⚠️ **Three things I got wrong tonight, all corrected in place, because you should not have to
find them.** The CDN answer twice, in opposite directions, before the measurement settled it. A
line citation. And a delegated file committed mid-write, which I caught by comparing its author's
reported line count against the commit.

---

## 1 · Identify one alert — 60 seconds, one command ⭐ HIGHEST LEVERAGE

**Why.** Across all seven S7 alert types and **181 predicates**, there is exactly **one**
disagreement between the current alert rules and the new ones: predicate
`legacy:08d68edb-d4b` carries **2,344 `legacy_only`** ticks, meaning the old rule fired and
the new one did not. Every other predicate is clean, and `new_only` is **0 everywhere** — so
no alert type would send members an *extra* alert after a flip. **The entire risk of the S7
programme sits on this one predicate**, and nobody knows whose alert it is.

**Why me and not the agent.** This session's permission classifier refused the read
("Production Reads"). That is a tool boundary, not a judgement call — you saying "you decide"
cannot lift it, and working around it would be exactly the kind of permission laundering the
repo forbids.

**It is read-only and masks the member id.** Paste this in a terminal in the repo:

```sh
MSYS_NO_PATHCONV=1 railway ssh --service web -- echo $(printf '%s' 'import sqlite3,json
c=sqlite3.connect("file:/data/auth.db?mode=ro",uri=True)
cols=[d[1] for d in c.execute("PRAGMA table_info(watchlist_alerts)")]
r=c.execute("SELECT * FROM watchlist_alerts WHERE id LIKE \"08d68edb%\"").fetchone()
d=dict(zip(cols,r)) if r else None
d and d.update(user_id=str(d["user_id"])[:8]+"-masked")
print(json.dumps(d,default=str))' | base64 -w0) "|" base64 -d "|" /opt/venv/bin/python
```

**What to send back.** The whole JSON line. The fields that matter are `direction`,
`target_price`, `is_active`, and whether it is a trendline.

**What it unblocks.** It tells us whether 2,344 is 2,344 *lost member alerts* or 2,344
*evaluation ticks of a one-shot alert that only ever delivered once* — the two readings differ
by three orders of magnitude, and CARD 1's `legacy_only == 0` clause cannot be evaluated until
we know which. ⚠️ Nothing is blocked *today*: CARD 1's bar cannot be met before ~2026-10-01
regardless.

⭐⭐ **THIS GOT SUBSTANTIALLY LESS URGENT OVERNIGHT, AND YOU SHOULD READ WHY BEFORE SPENDING THE
SIXTY SECONDS.** The 02:30Z daily read establishes that **this predicate is dormant, not merely
stale.** It carried 5 sessions at 17:05 ET and still carries exactly 5 at 22:30 ET, with
Thursday's full session having opened and closed in between — and it has gained none of the
five trading sessions since its span ends on 09-18. **It is not being evaluated any more, so
the 2,344 is a closed historical number that cannot grow.**

That is also consistent with the benign one of the two readings: ≈469 ticks per session across
five sessions, then nothing, is what a one-shot alert does after it fires or is switched off.
The alarming reading would require a single alert to have delivered 469 times in one day, which
nothing in this product does. **So the question has changed from *"are we losing thousands of
member alerts?"* to *"confirm this is the dead alert it looks like"*** — still worth one
command, no longer worth interrupting anything for. Working:
`10-roadmap/evidence/2026-09-26-s7-daily-read-0230Z/results.md` §2.

✅✅ **AND THEN I GOT MOST OF IT WITHOUT YOU.** The pod read stayed refused, so I asked the app's
own admin report instead, and it carries the record:

* **not a trendline** — `is_trendline: false`, `level_kinds: ["price"]`. A plain price level.
* **one span**, and the span is enumerated as exactly five consecutive sessions, **09-14 to
  09-18**. So the dormancy is now read, not inferred.
* `agreed: 0` across all five of those sessions.

⭐⭐ **`spans: 1` is what settles it.** One span means the 2,344 is **one alert's evaluations**,
not many alerts added up. That is ≈469 per session — a tick cadence, not a delivery rate.
Nothing sends a member 469 alerts in a day.

⛔⛔ **And read with `agreed: 0`, it inverts what the counter's name implies.** For five straight
days the old rule said "fire" on essentially every tick and the new rule never did. That is a
stale alert sitting on the wrong side of its own level, re-firing forever. **So this is not
2,344 alerts a member loses. It is 2,344 they would have been spammed with, which the new rule
correctly refuses to send.** On this predicate, "lost" is the outcome you want.

**What is left for you is three fields** — `direction`, `target_price`, `is_active` — and they
would only confirm the above. The command still works if you want certainty; it is no longer
load-bearing.

⛔ **The real item for you is now a ruling, not a read.** CARD 1's flip clause turns on
`legacy_only == 0` across the population. On this reading that clause is **measuring the wrong
direction**: a rule that correctly stops a spam loop will always show `legacy_only > 0`. A bar
that treats correct suppression as a defect can never be satisfied, and it will be waived the
first time somebody needs to ship — exactly how the retired warm-ratio gate failed earlier in
this programme. **I have not changed CARD 1. That is yours.**

---

## 2 · Watch yourself work for one morning ⭐ THE LAST THING GATING THE WORKSPACE DECISION

**Why.** `06-ux-and-information-architecture/fixed-modular-hybrid.md` locks the Terminal-Next
shell as **hybrid** — fixed pages for market-wide questions, one composable board for
portfolio-specific ones. The lock is **provisional**, and after tonight exactly one signal
could overturn it: *a desk-observed morning showing the desk wants a fully modular surface.*

**Why me and not the agent.** It is an observation, not a decision. The two things that could
have substituted both fell short: OI-06 is answered (you open thinkorswim, TradingView, Finviz
and Unusual Whales by hand every day) and it **supports** hybrid without separating it from
modular; and the telemetry — 17 of 29 accounts hold a board, none empty, modal 5 panels — is a
**staff cohort**, since production is still in coming-soon mode. Neither can speak for a desk
at 9:30.

**What to do.** One trading morning, note: do you want *one* arrangeable surface and nothing
else (→ modular), or do you want fixed pages you navigate *plus* a board you compose
(→ hybrid, the current lock)? The tell is whether you ever want a market-wide page to *stop*
being arrangeable.

**⛔ Do not hold anything for this.** Every commitment in that document is true under both
shapes, so building continues either way. Only the shell shape is waiting.

---

## 3 · ✅ DONE — you brought the window forward and both measurements are in

Written up in `10-roadmap/evidence/2026-09-26-protocol-c-and-gridspike/results.md`.

⛔ **Why the foreground mattered, concretely.** Twenty minutes earlier the tab reported itself
hidden, and I abandoned the attempt without taking a number rather than publish one, because a
hidden tab throttles frames and defers paint. Your one click is the difference between a
measurement and an artifact.

**What the 16-panel grid cost, against the figure this programme has been quoting for months:**

| | quoted everywhere | measured |
|---|---|---|
| time to frame 16 cells | ~900 ms | **2,582 ms** |
| heap | +63 MB | **+218 MB at peak, +45 MB retained after idle** |

⭐ Per-cell framing is fast, 28 ms median. The 2.6 seconds is data, not drawing. And the board is
**quiet once settled** — two long tasks in sixty seconds — which is the reassuring half and the
first time that has been measured on a whole board rather than one chart.

⭐⭐ **And the options-flow slow-load mystery is solved, after two earlier explanations failed.**
The page itself paints in 140 milliseconds. Then a cold visit pulls **31 MB** of data packs, and
the first two of those take eight to eleven seconds of *server* time each, which stalls every
other request on the page behind them. I proved it is the server and not the browser, and I
proved it is cold-cache only by loading the page a second time, where everything came back under
half a second.

⛔ **One defect reproduced on both loads and is worth your attention.** A single call on that
page's load path takes **7.5 seconds warm, and took 20.8 seconds cold, to return one kilobyte**.
It is the slowest thing on the page both times and it is not explained by the packs. That is a
real, isolated, actionable defect rather than a research finding.

⚠️ Not done: a true cold pass with caching disabled, the other four surfaces, and the hover
sweep, which the harness correctly refused to score because no mouse moved.

## 4 · One contract answer — OI-04

CP-02 (the provider ledger) is the last Tier-1 question still amber, and it now needs exactly
one thing: **OI-04**. OI-03 is answered and confirmed. Until OI-04 lands, the ledger stays
drafted at 48 rows. Nothing else in the programme waits on it.

---

## 5 · ✅ Tiers now has a DEFAULT — veto it in one word, or ignore it (CARD 17)

**DEFAULT SET: two paid tiers, no free tier, Terminal-Next entirely inside the existing paid
boundary.** Reasoned from what already ships rather than from preference: the free-page
whitelist is **one page**, everything else is already paid-gated server-side, and A14's own
shipped door is paid-gated the normal way. A free Terminal tier would be a *new* commercial
posture, not a continuation of this one.

⛔ **It sets no price, no trial length and no seat model.** Those are revenue decisions with no
engineering dependency, and nothing in the programme is blocked by them. **"Free tier" or
"three tiers" or "seats" reopens this in one word**, and the entitlement architecture is being
written to express *a* tier boundary rather than a specific count, so a veto costs a
paragraph and not a rewrite.

⚠️ The one thing still genuinely yours: A14 past the shipped door stays closed until you lift
D8 in writing. That is a scope ruling you made, not a gap.

---

## 6 · One closed, one REOPENED by my own error — and the reopened one needs a dashboard read

* **Arming the event-loop killer — RULED NOT YET** (CARD 18). Observe mode measures max lag at
  **14.9 ms** against a **30-second** wedge threshold, with no missed checks. That is three
  orders of magnitude of headroom, and it is not an argument for arming: it says **nothing is
  currently wedging**, so arming buys no protection today while adding a process that can kill
  the member-facing pod outright. **The condition to arm is named:** one observation window
  spanning a market open *and* a heavy-job window. Every sample so far is after the close.
  ⛔ And the runbook's "three to five times the observed maximum" heuristic must not be applied
  to a 27-minute after-hours sample — that would set the threshold near 60 ms, vastly more
  aggressive than the 30 seconds it ships with.
* ✅ **The CDN question — DONE, because you granted the permission. And I was wrong twice on
  the way to it, which you should know.** First I said the answer was a missing response header.
  Then I said the question was open and raised a possible data-exposure risk. **The measurement
  settles it and contradicts both.**

  **The edge IS caching.** Two authenticated requests in a row gave a miss and then a hit, on
  5.3 MB of tape. That is the exact success signal the protocol defined, so the Cloudflare rule
  you already have is in effect, and always was.

  ✅ **And there is no exposure.** I tested the risk I had raised, immediately, with zero
  cookies, twice, after the cache was populated. Both times: refused, 401, thirty bytes. The edge
  does not hand the cached tape to a caller without the credential.

  ⭐⭐ **What is actually left is a freshness decision, and it is genuinely yours.** A Cloudflare
  rule is overriding your code's deliberate "do not cache in the browser" instruction and
  replacing it with **four hours**. Your own code comment predicted that exact override, and the
  wire now confirms it. The edge revalidates every sixty seconds. A member's browser does not,
  for four hours, on a live options tape.

  **One dashboard question:** do you want a four-hour browser lifetime on flow data, or should
  the rule stop rewriting it? Nobody in this programme chose it, so it is worth thirty seconds.
  Nothing is broken either way, and your code already stamps a version on the payload so the
  client can tell when it is holding something old.
---

## What you do NOT need to do

Recorded so none of it comes back as a question:

| | |
|---|---|
| Decide the next S7 increment | **Ruled:** `catalyst-match`, 58/58 verdict-ready, zero disagreements (CARD 10) |
| Re-cut the scan-membership bar | **Ruled** to what the instrument can actually observe (CARD 11) |
| Flip the D2 dual-compute reader | **Done** 01:29Z, verified in-process, ledger updated (CARD 12) |
| Rule on CP-10's licensing question | **Ruled 🟢** — it cited a row that was already resolved (CARD 14) |
| Pick a load-test target | **Ruled:** the local sandbox, and an absolute production capacity number is out of scope (CARD 15) |
| Fix the 0 % warm ratio | **Not broken.** The *metric* was: it counted a 104 ms cache hit as "the user waited". Gate replaced (CARD 16) |
| Chase the workspace data-loss path | Measured: **0 of 17** live boards are corrupt, and every board now carries a schema version so the risky geometry guess can no longer fire |
| Worry about the error-boundary gap | Already shipped 2026-09-21, live — including the close control outside the boundary and a mount cap |

---

## One thing you should know that is not an action

**The web pod leaks.** Measured over the longest-lived deployment available (104 minutes, 76
samples): RSS climbs **+7.9 MB/min**, monotonic across quartiles, 2,429 → 3,028 MB. That
**refutes** the recorded 2.2 MB/s figure by seventeen times and **corroborates** the 11.7 GB
seen on a long-lived pod almost exactly. The code itself calls distinguishing a leak from a
large-but-stable working set *"the prerequisite for any further memory work"* — that
prerequisite is now met, and memory work is unblocked whenever you want it prioritised.

⚠️ It is `n = 1` deployment and does not identify *what* leaks. And the reason it took the
longest deployment available is that production took **fourteen deploys in six and a half
hours** tonight, median pod life 26 minutes — **roughly half of them mine.** A capacity
measurement needs a quiet window, and I was the one denying it.
