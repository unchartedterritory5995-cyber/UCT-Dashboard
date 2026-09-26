---
role: the owner's own action list — every open item that an agent cannot close, why, and
  exactly what to do. Written 2026-09-26 after the delegation pass
  (`12-decisions/DECISION_CARDS_2026-09-26.md`) removed everything that was merely a
  decision. What is left here genuinely needs you.
---

# What needs you — 2026-09-26

**Nothing here is a decision.** Those were all delegated and ruled. Each item below needs a
permission this session does not have, a browser you are sitting in front of, an observation
only you can make, or an answer from outside the company.

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

**Why me and not the agent.** Both need a **foreground** browser tab. Hidden tabs throttle
timers and defer paint, so a headless or backgrounded run measures the throttling, not the
app. This already burned the programme once: a flag verification looked stuck on "Loading…"
purely because the automation tab was backgrounded.

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

## 5 · A tiers decision, when you want it — S9

A14 (Portfolio & Risk) is out of the current programme by ruling, and everything past the one
shipped door (`/portfolio-heat`) is gated on **S9 entitlements** — which is a business
decision about tiers, not an engineering one. It re-opens on a tiers answer or on D8 being
lifted in writing. **No agent should guess at it**, and none has.

---

## 6 · Optional, cheap, and yours if you want the number

* **Arm the event-loop killer.** Observe mode is already on and has measured max lag at
  **14.9 ms** against a 30-second wedge threshold, with no missed checks — there is real
  headroom. Arming (`WATCHDOG_ENABLED=1`) is the watchdog runbook's own decision and wants a
  threshold argued against `wedge_sec`. ⛔ Not urgent, and I did not do it: `enabled:false` is
  the correct state until someone argues the threshold.
* **One more curl on the CDN.** The flow endpoint returns `BYPASS`, so the documented
  Cloudflare cache rule is not in effect and never has been. `BYPASS` does not say *why* —
  either a Cloudflare rule bypasses it, or the origin sends `Cache-Control: private/no-store`
  and Cloudflare is obeying. Reading the origin's own `cache-control` decides whether the fix
  is a dashboard rule or a response header.

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
