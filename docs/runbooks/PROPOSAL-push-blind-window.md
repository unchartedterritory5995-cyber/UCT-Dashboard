# PROPOSAL — close the push blind window using git, not Railway

**To:** the deploy programme (owner of `tools/pre_push_guard.py`)
**From:** the breadth-history-reader programme, 2026-09-17
**Status:** PROPOSAL. **No change has been made to `pre_push_guard.py`.**

⛔ **This file proposes; it does not implement.** The guard belongs to another programme and
a cross-programme edit to a shared safety tool is exactly the class of change that should
arrive as an argument, not as a diff.

---

## The hazard, measured twice

`tools/pre_push_guard.py` decides whether master is quiet by reading Railway's **deployment
list**. A deploy record does not exist at push time — Railway creates it some minutes later.
**For that interval a push has happened and is invisible to the guard**, which then answers
"quiet" correctly and insufficiently.

Two independent measurements, both on 2026-09-16, both of this repo's own pushes:

| push | deploy record appeared | lag |
|---|---|---|
| peer's `cc5527f66` | 05:40:58Z | **3m25s** |
| ours `e234b34a1` | 01:18:23 CT | **2m38s** |

⚠️ **The lag is variable, so it cannot be waited out.** Two samples 47 s apart. A rule of the
form "sleep 3m30s then read the queue" would be calibrated on one draw and fail on the longer
ones — and it would make every push slower for a guarantee it does not provide.

### What it cost

2026-09-16, 05:39:49Z. The breadth lander read the queue and got, correctly:

```
[pre-push] web is SUCCESS on 95596c83c, 2400s settled - safe to push.
[pre-push] 2 web deploy(s) in the last 60 min, none inside 600s - master is quiet.
```

All three clauses held. A peer had pushed `cc5527f66` at ~05:37:33Z; its deploy record
appeared at 05:40:58Z, **69 seconds after the guard finished reading**. The breadth deploy
`54abdefeb` was created at 05:43:14Z and marked the peer's `REMOVED` **2.3 minutes into its
build**.

⛔ **This is NOT the gap the 2026-09-14 rule closes.** That rule says *wait when you see
`BUILDING`*. Here there was nothing to see. No polling interval closes it: the checker and
the thing it checks are separated by a delay the checker cannot observe.

---

## The proposal

**Add a fourth clause, derived from git rather than from Railway.**

> Read `origin/master` HEAD. If master's HEAD commit has **no deploy record at all** and is
> **not** the commit of the newest deploy, treat master as **IN-FLIGHT** and refuse.

### Why this works where deploy records cannot

A push's effect on `origin/master` is visible **the instant it lands** — `git ls-remote` sees
it with no lag, because there is no asynchronous system in between. So the state the guard
cannot observe in Railway is fully observable in git, at exactly the moment it matters.

The three cases it distinguishes:

| `origin/master` HEAD | newest deploy's commit | reading |
|---|---|---|
| equals the newest deploy's commit | — | quiet; the queue has caught up |
| has its own deploy record (any status) | older commit | already accounted for by the existing clauses |
| **has no deploy record, and is not the newest deploy's commit** | older commit | **IN-FLIGHT — refuse** |

### What it costs

A single `git ls-remote origin refs/heads/master`, which the guard's caller already has a
working tree for. No new credential, no new service, no added latency worth measuring.

### What it does NOT do

⚠️ **It does not make the guard sufficient, and should not be described as closing the
window.** It narrows it to the interval between a peer's `git push` completing and
`origin/master` advancing — small, but not zero, and two pushes racing inside it still
collide. It is a **large improvement to a client-side check, not a serialisation
mechanism**.

⭐ **The actual serialisation already exists and is not this.** The `master deploy gate`
workflow's `concurrency: master-deploy` group observes **the push itself**, which is the only
thing that can. This proposal makes the client-side guard much harder to fool; it does not
replace the server-side group, and the two should not be confused for one another.

### The non-tooling mitigation, recorded because it is what actually worked

On 2026-09-16 the breadth and Notebook sessions closed the window by **announcing intent to
each other** — *"taking the slot"* / *"clear"* — and holding. That works for a reason no
polling can reproduce: **a session knows its own intent before any record of it exists.**
Two sessions exchanging one message each beat two guards reading a list that is minutes
stale. It costs a message and needs no code.

---

## Rails this would need, if adopted

Written here so the cost is visible up front rather than discovered during implementation:

1. **A non-vacuity control.** `git ls-remote` returning empty must REFUSE, never read as
   "master is quiet" — the failure direction that already bit this repo once, when a
   background job polled `railway` from an unlinked directory and a forgiving parse would
   have read zero deploys as a clear queue.
2. **A fixture where master HEAD equals the newest deploy's commit** — proving the clause can
   stay silent, or it refuses every push and gets bypassed within a day.
3. **A fixture where master HEAD is un-deployed** — proving it can actually fire.
4. **Mutation proof both directions**, since a clause that cannot refuse and a clause that
   always refuses are equally useless and look identical in a green run.

---

**Evidence for everything above:** `docs/runbooks/deploy-windows.md` (the blind-window and
pod-identity sections), `docs/breadth-history-reader/FINAL.md` §14.7 #11.
