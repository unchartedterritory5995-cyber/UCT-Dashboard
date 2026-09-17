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
