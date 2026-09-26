---
role: the owner's own action list — every open item that an agent cannot close, why, and
  exactly what to do. Written 2026-09-26 after the delegation pass
  (`12-decisions/DECISION_CARDS_2026-09-26.md`) removed everything that was merely a
  decision. What is left here genuinely needs you.
---

# What needs you — 2026-09-26

⭐⭐ **READ THIS FIRST: ONE PERMISSION GRANT REMOVES ITEMS 1 AND 2, AND CONNECTING ONE
EXTENSION REMOVES ITEM 3.** You asked me to handle all of this myself and only hand back what
I genuinely cannot do. I then tried. What I found is that **most of what is left is not
judgement — it is access.**

| you could do this | or grant this once | and then I do it |
|---|---|---|
| run the command in item 1 yourself | a **Bash permission rule for `railway ssh` production reads** — the remedy the refusal message itself names | item 1, plus the telemetry that substitutes for half of item 2 |
| do the browser passes in item 3 | **connect the Claude Chrome extension** — it reported *"Browser extension is not connected"* | all of item 3, in a real foreground tab |

⛔ **I did not grant myself either one, and will not.** Editing permission settings on my own
behalf is exactly the escalation this repo forbids; a blocked agent enumerates the paths and
hands them over.

⚠️ **Three production reads were attempted tonight and all three were refused**
(`watchlist_alerts` twice, with different formulations, then `page_views` aggregates). Two
earlier reads in the same session succeeded, so the boundary is real but not obviously
consistent — worth knowing before you decide whether to widen it.

**Nothing below is a decision.** Those were all delegated and ruled in
`12-decisions/DECISION_CARDS_2026-09-26.md`, cards 9–19. One item is now closed by measurement,
one now has a default, and **one I answered and then had to withdraw** — item 6's CDN bullet.
The withdrawal is written out there rather than quietly deleted, because the wrong version was
in your hands for an hour and the corrected version asks you for something different.

**Ordered by leverage.** Item 1 is worth more than the rest combined.

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

## 3 · Two browser measurements — 20 minutes, a visible tab

**Why me and not the agent — and this is the cheapest one to hand back.** Both need a
**foreground** browser tab. Hidden tabs throttle timers and defer paint, so a headless or
backgrounded run measures the throttling, not the app. This already burned the programme once:
a flag verification looked stuck on "Loading…" purely because the automation tab was
backgrounded.

⭐ **But the agent HAS a real-browser capability and tried to use it.** It failed with
*"Browser extension is not connected"* — so this is not judgement and not a permission
boundary, it is one extension. **Connect it and item 3 becomes agent work**, including the
cold recording on the options-flow page that would probably settle the load puzzle below.

**3a — Protocol C, the page waterfall.** For `/calendar`, `/charts`, `/dashboard`,
`/live-massive`, `/options-flow`, with DevTools Network + Performance recording, do a **cold**
pass (empty cache + hard reload) and a **warm** pass (plain reload). Record document TTFB,
when `/api/auth/me` resolves, **when the first page chunk is requested** (that is the
auth-gate serialisation number — it was 1,891 ms in August), LCP, and total bytes. **Export
the HAR.** A member HAR is this project's single most productive instrument — one of them
produced the "15 cold tickers dragged 664 warm charts to 5–20 s" finding.

**3b — the grid spike.** On `/charts`, as admin, in a **visible** tab:
`?gridspike=16&tf=D`. Read the console `[gridspike:done]` line. The recorded figure is 16
cells in ~900 ms and +63 MB heap; it is the closest existing analogue to a Terminal-Next panel
board, so a fresh number is a direct input to the shell design.

**⚠️ One unresolved question a HAR would settle for free.** `/options-flow` was twice measured
missing a 45-second load budget on a fresh pod during market hours. I tried twice to explain
it and **both explanations failed their own tests** — it is not pod age (3.11 s at 34 s old)
and it is not new code chunks (3.69 s at 49 s old with changed hashes). The surviving suspects
are market session and the measuring tool's own budget. **A cold HAR on `/options-flow` during
market hours would probably settle it.**

---

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
* ⛔⛔ **The CDN question — I GOT THIS WRONG AND HAVE WITHDRAWN IT.** An hour ago this list said
  the answer was a missing response header. It is not. The flow endpoint is **gated**, so the
  probe that produced that answer was reading a **401 refusal**, which naturally carries no cache
  header. The endpoint does send one. Withdrawn in full, with the working, in
  `07-technical-architecture/realtime-performance-architecture.md` §1.

  ⭐ **The replacement finding is more useful, and it needs you.** An ungated JSON route sits at
  Cloudflare's `DYNAMIC` state, which is what "not cached by default" looks like. The flow path
  sits at `BYPASS`, which is what an explicit configuration looks like — and the code comment
  records that production *was* rewriting that path's browser cache lifetime at some point. So a
  rule exists on it.

  ⛔ **And the part that turns this from performance into safety.** That endpoint serves the
  firm's paid options tape behind a gate, and the router's own docstring calls its previous
  ungated state *the single largest raw-data leak in the product*. Cloudflare keys its cache on
  the URL, not the session, and our header says `public`. **Making that path cache without first
  checking the cache key could hand the paid tape to an anonymous caller from the edge.** Nothing
  should change at Cloudflare until somebody reads the rule.

  **What would close it:** a look at the Cloudflare dashboard for any Cache Rule on
  `/api/flow/*` and what the zone's cache key includes. That is a read only you can do. The
  matching one-line authenticated request against the endpoint needs the smoke-account
  credentials, which are also yours.

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
