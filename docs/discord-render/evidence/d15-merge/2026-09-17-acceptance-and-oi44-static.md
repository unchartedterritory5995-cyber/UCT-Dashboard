# D-15 — the merge's acceptance test, and R52's static half

## 1 · OI-47 ACCEPTANCE TEST — **PASS**

The D-15 stop condition was: *the health payload on the live V2-dark pod must carry
`stall_record` and `token_slots`; if they are still null the sequence STOPS.*

Read in-process from `/api/discord/render-health` at **2026-09-17T17:07:19Z**, live sha
**`e50c0552d842`** (the merge commit), pod uptime **25 s** — a fresh boot, not a stale reading:

```
token_slots  : {"slots": {"current": {"count": 1067, "first_seen": "2026-09-17T12:23:20Z",
                                      "last_seen": "2026-09-17T16:41:44Z"}, "previous": {...}}}
stall_record : {"lifetime_max_ms": 2244.6, "lifetime_count": 1, "below_floor_count": 1,
                "path": "/data/discord-render/stall-record.json", ...}
```

⭐ **Both keys were `null` in ALL 85 prior trace rows, across THREE commits**
(`d9455a6d64a5` → `26147924dcbd` → `3648792d5a04`). They are populated on the first boot of the
merge commit. The early return no longer swallows them, and the instruments can see the durable
record for the first time since it was built.

**The deploy is proven by ANCESTRY, never by uptime** (an uptime you have not tied to a named
deploy can belong to somebody else's pod): `git merge-base --is-ancestor e50c0552d
origin/production` → true, and `origin/production`'s tip IS `e50c0552d`.

### 1a · Two things the same reading settles for free

- **R29 durability, again and stronger.** `current.first_seen` held at **12:23:20Z** across a
  reboot to a *different commit*, with `count` at 1,067 and `last_seen` 16:41:44Z — a span of
  4 h 18 m that survived a deploy. (The R29/OI-13 step-6 SPAN condition is still clock-gated to
  Friday ~08:23 ET by R57; this is evidence accumulating toward it, not the gate closing.)
- **R51 behaving as designed on its first boot.** `lifetime_max_ms` 2,244.6 ms with
  `below_floor_count: 1` — a real stall, recorded and NOT paged, because 2,244.6 < the new
  3,000 ms tier 1. The threshold moved and the pod did not start crying wolf.

---

## 2 · R52 / OI-44 — the STATIC half: what in this process CAN block the loop

`docs/discord-render/instruments/oi44_loop_blockers.py` (`--self-check` 6/6 PASS) walks `api/**`
by AST and reports blocking calls reachable **on the event loop** — i.e. inside an `async def`,
not behind `run_in_threadpool` / `asyncio.to_thread` / `run_in_executor`, and not in a nested
plain `def`.

```
TOTALS oi44_loop_blockers scanned=1374 async_fns_with_blocking=17 route_handlers=17
```

⛔⛔ **A NAME HERE IS A SUSPECT, NOT A CAUSE.** R52 asks what *coincided* with each recorded
stall; that is a correlation and needs the durable record joined to a log slice (`oi44_align.py`).
This narrows the list a correlation has to choose between, and nothing more.

### 2a · The ranking, after checking reachability rather than assuming it

| # | site | gate | on WEB's loop? | confidence as a routine-stall cause |
|---|---|---|---|---|
| 1 | `main.py:9997 _oi_confirmation_map` → `sqlite3.connect` (`:10131`) | `Depends(get_current_user)` — **any signed-in member** | **YES** | **Real candidate.** Member-reachable, opens SQLite on the loop. |
| 2 | 15 × `/api/admin/*` in `main.py` (`_massive_diagnose`, `_flow_plan`, `_oi_create_indexes`, …) | admin | YES | **Low.** Genuine hazards — one of these on a big table stops everything — but they are hand-invoked and rare, so they cannot explain ~46 stalls a day. |
| 3 | `live_massive_router.py:6940 enrich_oi` → `sqlite3.connect` (`:7066`) | `Depends(require_flow_user)` | **NO — PROXIED** | **Withdrawn as a web-loop cause.** |

### 2b · ⚰️ THE CORRECTION, MADE BEFORE IT WAS PUBLISHED

`enrich_oi` looked like the answer and was nearly written up as it: member-reachable, and
`LiveFlowMassive.jsx` POSTs it **in a loop, 400 contracts per chunk** (`:4453`), so opening Live
Flow fires several. A hot member path opening SQLite on the shared loop is exactly the shape
C-02 predicts.

**It does not run on web.** `/api/live/massive` is in `flow_proxy.PROXY_PREFIXES`, and
`FLOW_READS_PROXY_ENABLED=1` is set on `web` (read live). The proxy is registered *before* the
local flow routers, so web forwards the request and the `sqlite3.connect` happens on
**flow-worker's** loop instead. That is still worth knowing — flow-worker has one loop too — but
it says nothing about web's Discord ack.

⭐ **The check that caught it was reading the proxy's prefix list, not the handler.** The handler
is real, reachable-looking, and hot; only the routing table says nobody reaches it here. Same
rule as reading the wire instead of the call site, one layer out.

### 2c · What this half CANNOT see, stated rather than left implicit

- **GIL contention from the threadpool.** A `def` handler runs in the anyio pool, so blocking
  I/O there is genuinely free — but **CPU-bound** work there still contends for the GIL and can
  stall the loop without ever touching it. The breadth-monitor route the directive named is
  exactly this case: **every handler in `api/routers/breadth_monitor.py` is a sync `def`**, so
  its documented 55 s cold path is *not* a direct loop-blocker — and is *not* thereby cleared.
  This tool cannot tell CPU-heavy from I/O-heavy from source.
- **APScheduler jobs**, the warm cycle, the bars adapter, mplfinance renders and large-response
  JSON encoding — all in-process, none of them an `async def` route, none visible here.
- Blocking reached through a helper the handler `await`s — the scan is one function deep by
  design (a deeper walk without call-graph resolution produces confident nonsense).

**So the correlation half is still owed, and it is the half that can name a cause.**

---

## 3 · R52 — the CORRELATION half opens with a strong lead

The merge's own deploy handed us a boot inside log retention, and the durable record — readable
for the first time — caught a stall in it.

**The stall:** `lifetime_max_ms` **2,989.7 ms** at **uptime 117 s**. Pod boot ≈ 17:06:54Z
(uptime 25 s at 17:07:19Z), so the stall ended ≈ **17:08:51Z**.
⭐ Ten milliseconds under the new 3,000 ms tier 1 — recorded, not paged. R51 working, and a
reminder of how close the ordinary boot storm now runs to the ack budget.

**The log across that instant** — note that a blocked loop cannot log, so the stall shows up as a
SILENCE bounded by two ordinary lines. There is one: **17:08:37 → 17:09:00, 23 s of silence**,
and the stall ends inside it.

Every job running across that window is a candidate, and all of them are printed:

| candidate | evidence | confidence |
|---|---|---|
| **`[screener-live]` sweep** | `held_lock_ms=32814.01 duration_ms=33861.42 cols_recomputed=96296 rows_considered=3745`, finishing 17:08:35 | **HIGHEST — see below** |
| `ticker-names-prewarm` | `starting pass over 3742 tickers` 17:08:00 → `done in 36.7s` 17:08:37 | medium |
| `[discord-chart] hot warm` | `hit its 20s budget after 23.1s — 7 chart(s) deferred` 17:08:25 | medium |
| `rs_ranking` | `Computing RS scores for 3696 stocks` 17:09:00 | adjacent, just after |
| `industry_map`, `calendar-enrich-warm`, `darkpool_intraday`, `bars_reconciliation` | all in the same two minutes | low, but present |

### 3a · ⭐⭐ THE SCREENER SWEEP'S OWN SAFETY ARGUMENT HAS MOVED 269×

`api/services/screener/live_tier.py` shares `snapshot_builder._BUILD_LOCK`, and the comment
justifying that says, in the file:

> *"WHY SHARING IT IS SAFE, WITH THE NUMBER (measured 2026-08-23 on a synthetic 3,745-row
> universe, 5 consecutive cycles): held_lock_ms median **122 ms** (121-140) … a ~0.2% duty cycle
> at the 60 s cadence. … `held_lock_ms` is on EVERY receipt so this stays a measurement rather
> than a claim."*

**Measured on production, 2026-09-17: `held_lock_ms = 32,814 ms`.** That is **269× the
documented median**, and a **~55% duty cycle** at the 60 s cadence rather than 0.2%.

⭐ **The file did exactly what it promised** — it put the number on every receipt so the claim
could be falsified, and the receipt falsified it. That is the design working, and it is the first
time anyone has read one.

**Why this is the leading candidate for ROUTINE stalls specifically:** it runs **every 60 s
during RTH**, in-process on web, recomputing ~96k columns. Python holds the GIL, so that CPU work
stalls the event loop *whatever thread it is on* — which is why the sync-vs-async distinction in
§2 does not clear it. A per-minute mechanism is the right shape to explain ~46 stalls a day;
the rare admin routes in §2a are not.

### 3b · ⛔ WHAT THIS IS NOT, YET

- **n = 1.** One stall, one boot window, one receipt. `lesson_two_points_do_not_establish_a_rate`
  applies with one point even harder.
- **A boot is not steady state.** 32.8 s may be a cold-cache artifact of minute two, not what the
  sweep costs at 14:30. **That is the measurement now running** — receipts collected across
  several minutes to get the distribution. Until it lands, "the sweep is the cause of routine
  stalls" is a HYPOTHESIS with one supporting observation.
- **The silence is shared.** `ticker-names-prewarm` (36.7 s) and the chart hot-warm (23.1 s
  against a 20 s budget) span the same seconds. A single-candidate answer from this data would be
  a story, not a finding — `oi44_align.py` exists to refuse exactly that.

**Next:** the receipt distribution, then the same correlation over the ≥3 s events the durable
record already holds, then the fix under R52 (move the sweep's CPU off the loop's GIL — a process
pool, or a readiness barrier for boot work) with the rail R52 specifies.

---

## 4 · ⭐⭐⭐ THE MEASUREMENT LANDED, AND IT IS NOT A BOOT ARTIFACT

Six consecutive `[screener-live]` receipts, collected 17:08–17:15Z. The pod booted 17:06:54Z, so
everything from 17:10 on is **uptime 3–9 minutes: steady state, inside RTH**, not a boot storm.

```
17:08:35  held_lock_ms=32814.01  duration_ms=33861.42
17:10:10  held_lock_ms=68782.07  duration_ms=68784.42
17:11:57  held_lock_ms=55951.43  duration_ms=55954.14
17:12:57  held_lock_ms=56382.78  duration_ms=56382.92
17:14:08  held_lock_ms=66657.58  duration_ms=66658.93
17:15:50  held_lock_ms=49118.76  duration_ms=49118.94
```

| | documented (2026-08-23) | measured (2026-09-17, n=6) |
|---|---|---|
| `held_lock_ms` median | **122 ms** | **≈ 56,200 ms** |
| range | 121–140 ms | 32,814 – 68,782 ms |
| duty cycle at the 60 s cadence | **~0.2%** | **~94%** |
| ratio | — | **≈ 460× the median, up to 564×** |

⛔⛔ **THE SWEEP OVERRUNS ITS OWN CADENCE.** Three of six cycles exceed 60 s (68.8, 66.7 s), and
the scheduler says so out loud in the same window:

```
17:09:00,005 WARNING apscheduler.scheduler: Execution of job "...cron[...minute='*']..."
             skipped: maximum number of running instances reached (1)
```

**So the hypothesis in §3b is resolved.** 32.8 s was not minute-two cold cache — it was the
*fastest* of the six. The screener live-tier sweep holds the shared build lock and burns CPU for
roughly **56 of every 60 seconds, continuously, through the whole session**, in the same process
and under the same GIL as the Discord ack whose budget is 3,000 ms.

⭐ **This is the right SHAPE for OI-44 in a way nothing else on the candidate list is.** The
census found ~46 stalls ≥1 s a day with the ≥1 s population majority *settled-pod* (27/46) —
which is exactly what a near-continuous per-minute CPU job in the settled state produces, and
exactly what a boot-only explanation cannot. The rare admin routes in §2a cannot; the boot storm
cannot; this can.

⚠️ **Still short of proof, and the gap is nameable.** n=6 over eight minutes on one pod is a
strong measurement of the SWEEP; it is not yet a measured *join* between individual sweeps and
individual stall events. The join is the remaining work: the durable record now carries
`recent[]` with wall-clock `at`, and `oi44_align.py` exists to do exactly this against a captured
slice. **What is established:** the sweep's own documented safety argument is false by ~460×, in
steady state, today. **What is not:** that this specific job produced any specific recorded stall.

⛔ **THE FIX NEEDS A MASTER PUSH, AND THIS SESSION'S IS SPENT.** D-14's stop conditions —
carried forward verbatim by D-15 — include *"a second master push"*. The one push was the
owner-directed merge `e50c0552d`. So R52's fix is specified and not shipped:
move the sweep's CPU off the shared GIL (a process pool, or a readiness barrier that keeps it out
of the boot window), with R52's rail — a synthetic run of that work showing no loop block ≥100 ms
on the fixed code and the block present on the pre-fix code — and a mutation that reds when the
fix is removed.

---

## 5 · ⚠️⚠️ CORRECTION TO §3a/§4 — I ARGUED THE GIL, AND THE TIME IS PROBABLY I/O

**What §3a and §4 got right, and it stands:** the sweep's own documented safety argument is false.
`held_lock_ms` is **28,155–68,782 ms across n=9 receipts, median ≈ 56,000 ms**, against a comment
claiming a **122 ms median and a ~0.2% duty cycle**. That is ~460× at the median, the duty cycle
is ~94%, and three of nine cycles exceed the 60 s cadence (APScheduler says so: *"skipped: maximum
number of running instances reached (1)"*). **The sweep holds `snapshot_builder._BUILD_LOCK` for
most of every minute all session.** That is a real defect against a real claim.

**What I got wrong: the mechanism, and therefore the conclusion I drew from it.** I wrote that
this is *"the leading candidate for routine stalls"* because *"Python holds the GIL, so that CPU
work stalls the event loop whatever thread it runs on."* That argument assumes the 56 s is CPU.
Reading the function instead of assuming it:

```
:826   if not snapshot_builder._BUILD_LOCK.acquire(blocking=False):     # the lock is taken here
:873   snap = scan_volume.full_market_snapshot() or {}                  # ...and the FETCH is INSIDE it
```

`full_market_snapshot()` is *"the whole US-market snapshot"* behind a 30 s cache — and the receipt
says `feed_symbols=13226`. The cache TTL (30 s) is **shorter than the sweep's cadence (60 s)**, so
essentially every sweep pays a cold fetch. **A network fetch RELEASES the GIL.** So the dominant
term in those 56 s is very likely I/O, not CPU, and I/O in a worker thread does not stall the
event loop at all.

⛔ **THE LOCK-HOLDING DEFECT AND THE LOOP-STALL CAUSE ARE TWO DIFFERENT CLAIMS, AND I MERGED
THEM.** Holding the build lock for 56 s blocks the nightly builder and an admin `POST
/api/screener/refresh` — the very collision the comment argues is impossible. It does **not**
follow that it blocks the event loop. §3a's table row should read **"HIGHEST confidence as a
LOCK-CONTENTION defect; UNESTABLISHED as a loop-stall cause"**, and §4's *"this is the right SHAPE
for OI-44"* is withdrawn pending the join.

⭐ **What the durable record actually shows now, and why it does not settle it either.** 36 events,
**19 of them ≥3,000 ms**, all `tier=1` under R51, all `paged=False` (the 30-minute cooldown). Two
are unambiguously settled-pod: **7,894.3 ms at uptime 627.8 s** and **3,049.0 ms at uptime
784.9 s**. But the *distributions do not match*: the stalls cluster at **3–9 s** while the sweeps
run **28–69 s**. One event — **33,877.9 ms** — sits within **16 ms** of a measured sweep
`duration_ms` of 33,861.42, which is striking and is **one coincidence, not a join**.

⛔ **AND A RETROSPECTIVE JOIN IS IMPOSSIBLE ON THIS POD.** 500 log lines reach back roughly three
minutes here, so by the time a stall is read out of the record its window has already scrolled
away. The join has to be a **forward** capture — sweep windows recorded as they happen, then
matched against events that arrive afterwards. That is running.

⭐ **The fix this points at is different, cheaper and better than the one I proposed.** Not "move
the sweep's CPU off the GIL" — **hoist the market fetch out of the lock**. The lock exists so the
anchors are not read from a snapshot being rewritten; a network fetch has nothing to do with that
invariant and does not belong inside it. That alone should return `held_lock_ms` to the documented
order of magnitude, and it is a much smaller change than a process pool.

⭐ **And one thing the receipt settles for free: it is NOT a scaling bug.** The comment says the
122 ms was measured *"on a synthetic 3,745-row universe"*; today's receipt says
`rows_considered=3745`. **The input is the same size.** Only three commits have touched
`live_tier.py` since 2026-08-23, so if any of the time is genuinely per-row work the bisect space
is three commits wide — but the more likely reading is that **the 122 ms was measured against a
synthetic feed and never described production at all**, which would make it a fixture that could
not establish the property it was quoted for, rather than a regression.

---

## 6 · ⛔⛔ THE JOIN LANDED AND IT REFUTES THE SWEEP HYPOTHESIS

W2 asked for the join in these words: *"every settled-pod stall ≥ 3 s must land inside a sweep
window or be listed as unexplained; report the count."* Here is the count.

**16 sweep windows** captured forward (receipt timestamp = END, window = `[end − duration_ms, end]`)
against **20 recorded events ≥ 3,000 ms** in the durable record:

```
INSIDE a sweep window:  1
OUTSIDE:               19
```

Of the 19 outside, **four fall inside time the capture actually covers** — so they are genuinely
unexplained by the sweep, not merely unobserved:

```
17:10:37Z  5,894.0 ms  uptime 214.3
17:10:47Z  3,805.0 ms  uptime 224.0
17:17:30Z  7,894.3 ms  uptime 627.8      <- SETTLED pod
18:00:10Z  4,626.9 ms  uptime 653.4      <- SETTLED pod
```

The other fifteen sit in windows the capture does not reach. ⛔ **Those are NO COVERAGE, not
evidence** — an absence is only evidence if the instrument could have seen a presence.

### 6a · What this settles

**THE SCREENER SWEEP IS NOT THE CAUSE OF THE ≥3 s LOOP STALLS.** One event in sixteen windows is
not a mechanism; four events land in covered time and outside every window, including both
settled-pod events, which are the class OI-44's census says dominates. The hypothesis I called
"the leading candidate" in §3a and "the right SHAPE for OI-44" in §4 is **REFUTED**, and the
correction in §5 — that the 56 s is probably I/O and releases the GIL — predicted exactly this.

⭐ **The sweep defect is still real and still worth fixing, on its own terms.** `held_lock_ms`
now measured **n=16, range 28,155–96,658 ms** against a documented 122 ms — up to **790×** — with
the market fetch performed *inside* `_BUILD_LOCK` (`:826` acquire, `:873` fetch). That blocks the
nightly builder and an admin refresh, which is precisely the collision the file's comment argues
cannot happen. It is a lock-contention defect, it should be fixed by hoisting the fetch out of the
lock, and **it is not C-02**.

### 6b · What it does NOT settle, and the honest state of OI-44

C-02's shared-loop half is **still open, with no named cause.** What the join bought is the
elimination of the loudest candidate — which is worth having, because it was about to be fixed as
though it were the answer, and the fix would have shipped, measured clean on its own terms, and
left the stalls exactly where they are.

⭐ **That is the failure this programme keeps paying for, caught one step earlier than usual:** a
plausible mechanism, a real measured defect, and a confident story connecting them. The receipt
distribution was true; the GIL argument was wrong; the join is what told the difference.

**Next candidates, from the same evidence and in order:** the 3–9 s cluster's duration profile
matches neither the sweep (28–97 s) nor the boot storm alone — it wants a per-event join against
a *continuous* log capture, which is the only shape that works on a pod whose 500-line buffer
reaches back ~3 minutes. The remaining named-but-unmeasured in-process work is the warm cycle
(`hot warm hit its 20s budget after 23.1s`), `ticker-names-prewarm` (36.7 s), `rs_ranking` over
3,696 symbols, `bars_reconciliation`, and `darkpool_intraday` — all APScheduler jobs on the same
process, none of them yet joined to a single event.
