# Capacity at 500 concurrent members, full quality (2026-11-28)

**Owner ruling, 2026-11-28:** *"I would rather upgrade our infrastructure than downgrade the quality and speed."* A later message added: *"whatever it takes ... get it all done ASAP."*

> ⚠️ **This runbook describes PR #2962 (`BARS_API_WORKERS`, bars-api in several processes), which is NOT yet live.** Production runs ONE bars-api process. Every multi-process number below is from a local replay of #2962's topology, not from Railway.

So every member gets the full client:
- k=3 typed candidates on the linked timeframes;
- all-timeframe dwell warms at 300 ms;
- ±6 neighbour warms;
- hidden panes with full live data (A.* + T.*);
- a fast rollout of the local store.

The infrastructure is sized to carry that. The origin budget from `PLAN.md` C is an **alert, not a cap** (see Alarms). The guards that cost members nothing stay: cancellation, single-flight, background jitter, and no global cache wipes.

Harness: `tools/capacity_replay/` (README there). Plan: `C:/uct-runs/zero-network-20261128/PLAN.md` section C.

## 1. What 500 members at full quality ask the origin (measured)

The member model is in `tools/capacity_replay/replay_members.py`. Each member has:
- a board of 2-4 widgets on linked timeframes;
- 1-3 watchlists of 40-150 names, drawn by dollar-volume rank (Zipf 1.05) over the 4,298 daily tickers of a real store.

Members spend their time like this:

| Activity | Share | Detail |
|---|---|---|
| Scan bursts | 55% | arrow every 250-600 ms, 5-25 presses, then a 1.5-8 s rest |
| Typed searches | 25% | 150 ms per key, then Enter |
| Timeframe changes | 10% | |
| List switches | 5% | |
| Reading | 5% | |

This is the **market-open peak**: every member is active at once. The plan's "200 of 500 active" is the typical case.

The rates below come from `--dry`: the stream is recorded and nothing is contacted. They are origin requests per second at 500 members, measured over 60 s after a 20 s ramp:

| Client | origin req/s | per member | mix |
|---|---|---|---|
| **old** (today's client: press + legacy ±6 on the front tf) | **1,591** | 3.18/s | press 1,320 (57% are `since=` tails), neighbour 271 |
| **full, today's routing** (nothing answered at the edge) | **3,233** | 6.47/s | press 1,320, dwell 1,105, neighbour 618, typed 101, deep D 89 |
| **full, after PR 1.7 / edge-first** (neighbour, dwell, typed 2-3 and hidden fills from device/edge, 10% miss to origin) | **1,503** | 3.01/s | press 1,293 (86% tails), dwell 108, neighbour 57, typed 33, deep 12 |
| the same, with press tails also answered at the edge (edge tail, single-flight) | **216** | 0.43/s | the non-tail asks only |

- ⭐ **The press tail is the largest origin cost in every mode.** A press asks a `since=` tail for every linked timeframe it already holds. PLAN C item (11) still needs that verified in the client. Once tails are edge-served (one fill per key per second, shared by every member), the origin load at 500 drops about 7x.
- ⚠️ The shipped plan's origin budget (≤30 req/s sustained, ≤60 peak) only holds if tails, warms and candidates are all answered by device/edge. Under this model, even edge-first plus edge tails is 216 req/s at the peak. So the budget is kept **as an alert** (section 5), and the origin is sized for 1,503 req/s with headroom.

## 2. What one bars-api process carries (measured)

**Serve CPU per ask.** The real serve core, in process, on a single thread (`cost_model.py`): 1,200 asks sampled from each recorded stream, on a local copy of the real store. The store is opened read-only, the vendor is refused, and stored series are pinned "current" as the live store keeps them in production.

| class | mean | p95 |
|---|---|---|
| full first-paint ask (600 D / 1,199 intraday rows) | 15-22 ms | 80-110 ms |
| `since=` tail | 0.3-0.5 ms | 0.9 ms |
| deep D history (`/api/bars-history`, 60k) | 33 ms | 87 ms |
| cold **W/M** (resamples the whole daily history) | 170-300 ms before #2963, -40% after | |
| memory-cache hit, 1,199 rows | ~2.5 ms (`bar_contract._reconcile_tail` ~1.8 ms, re-run on every hit) | |
| mix means | old 8.2 ms · full 10.6 ms · edge-first 2.8 ms | |

**HTTP overhead** (`micro.py`, closed loop, 16 in flight, one process):

| request | throughput |
|---|---|
| `/api/health` | 2,516 req/s |
| D tail | 1,599 req/s |
| D 600 (memory hit) | 1,467 req/s |
| 5m 1,199 (memory hit) | 312 req/s |

That is about 0.4-0.6 ms per request of uvicorn/starlette time.

**One process, local (i9-12900K P-core):**

| mix | ceiling |
|---|---|
| old | ~115 req/s |
| full | ~90 req/s |
| edge-first | ~300 req/s |

**Production per-ask times are slower.** A handful of GETs on 2026-11-28 ~02:25Z (calibration, not load) compared prod with local:

| ask | prod | local |
|---|---|---|
| SQLite 5m 1,199 | 10.6-13 ms | ~10 ms |
| cold W | 209 ms | 80-140 ms |
| memory hit | **5-6 ms, first hits 27-30 ms** | 0.8 ms |

Production's single process shares one GIL with about 20 background threads; `/api/health` reported `threads: 24`. The memory-hit gap is that contention, which followers do not have.

**For sizing, a Railway process = local / 2** (an assumption from the calibration above, not a measurement under load):

| mix | ceiling per Railway process |
|---|---|
| old | 57 req/s |
| full | 45 req/s |
| edge-first | 150 req/s |

**Memory:** production RSS for the single process is 1.1 GB (`/api/health` `rss_mb`). The local private set after load is 1.2 GB per process.

⛔ **Everything in this section is ONE process with a warm cache.** Nothing here measured #2962's topology (one leader, followers handing leader-only work to it). Section 7 says what the topology replay has and has not measured.

## 3. The upgrade

### 3.1 bars-api: N processes in one container (PR #2962)

Railway already gives every big service the plan's per-replica maximum:

| service | `serviceInstanceLimits` |
|---|---|
| bars-api, web, stream-edge, stream-ingest, worker | 32 vCPU / 32 GB |
| web-front | 2 vCPU / 2 GB |

So **"more vCPU/RAM" cannot be bought on Pro.** The tier used about 1 of its 32 cores: CPU p95 0.26, max 0.92 over 3 days.

A volume cannot be mounted by a second replica. So the tier scales up with processes:
- **`BARS_API_WORKERS=N`** runs uvicorn `workers=N` on one socket. Unset = the single process, unchanged.
- One **leader** (it holds an flock) runs all the background work the single process ran.
- **Followers** serve reads. They answer live-store coverage from the leader's published view, and forward the web pod's push to the leader. Without a leader they return 503, and the web pod re-queues.
- ⛔ **Followers never write the store and never call a provider** (review of #2962, H1/M1). In a follower the store write lock, the proof queues, every provider fetch, the caps (`_cold_fetch_sem` 3, `_deepfill_sem` 2, `_bg_delta_sem` 6, ...) and the single-flight maps raise `LeaderOnly`; the route then hands the **whole request** to the leader over its loopback port, which answers it exactly as the single process does, under the one set of caps. Follower connections are `query_only`. So the caps stay what they are with one process (not N times larger), and no follower frame can land in the store the leader swaps.
- **The store swap barrier.** A follower holds a shared flock per read; the leader announces a file replace (install, adoption, deferred boot swap), takes the flock exclusive (it waits for in-flight follower reads; a read that starts meanwhile is handed to the leader), replaces, and persists the new file's floor before followers read again. Followers re-open their connections on the new file before reading. Connections never checkpoint on close. `force_resync` is refused with several processes.
- Followers follow the leader's synced copies; the cash-index refresh is the leader's (followers re-read its disk copy).
- A follower promotes itself if the leader dies.
- The process count is bounded by memory: `workers() <= min(14, container memory / 2 GB)`.

Rails and mutants: see #2962 (`tests/test_bars_api_follower_never_writes.py`, `tests/test_bars_api_multiproc.py`). The design notes are in `api/services/bars_api_roles.py`. Windows' shared-socket `listen` drops workers (WinError 10022); production is Linux, and the replay (section 7) gives each process its own port instead.

⛔⛔ **THE SIZING BELOW IS UNVALIDATED.** It multiplies ONE process's warm-cache ceiling (section 2, local / 2) by the process count. It has not been measured on #2962's leader/follower topology, where every request that needs leader-only work (a cold fetch, a delta, a W/M write, a proof) is answered by the ONE leader, so the leader's share of the load, not the follower count, can set the ceiling. The earlier `run_matrix` passes launched N INDEPENDENT single processes (each its own leader), which is not #2962's topology. Treat every number in this table as a forecast until section 7 holds the topology measurement.

**Memory bounds the process count** (review of #2962, L2): each process holds its own heap, page caches and bar caches, ~1.2 GB measured locally and up to ~2 GB under load, so #2962 caps `workers()` at `min(14, container memory / 2 GB)` = **14 in a 32 GB container**, never 24.

**Recommended size for 500 members: `BARS_API_WORKERS=12`** (leaves ~4-8 GB of the 32 GB for the OS page cache that every process's SQLite reads lean on), the container at the plan maximum (32 vCPU / 32 GB, already set).

| workers | memory (1.2-2 GB each) | forecast ceiling, edge-first mix (150/s per process) | 500-member edge-first peak (1,503 req/s) | 2 x peak (3,006 req/s) |
|---|---|---|---|---|
| 12 | ~14-24 GB | ~1,800 req/s | 84% | **does not fit** |
| 14 (the cap) | ~17-28 GB | ~2,100 req/s | 72% | **does not fit** |

So even on the forecast, **one container does not carry 2 x the 500-member peak**: the target headroom needs section 6 step 1 (edge tails: 216 req/s at 500, 12% of a 12-worker box) before 500 members, or a second service (step 2).

The **old** client at 500 (1,591 req/s at 57 per process) needs 28 processes, and the **full-today's-routing** client (3,233 req/s) needs about 72. Neither fits one container: they need section 6.

### 3.2 bars-api: CPU per ask (PR #2963, and next)

- **#2963:** the W/M resample stops paying `strptime` for 8k rows. That is -40% of a cold W/M serve, and the dwell warm asks W and M on every rest.
- **Next, not yet built** (each is pure CPU, cost-free to members):
  - Cache the `bar_contract.compute` result with the memory-cache entry. It is ~70% of a memory hit, and is re-run on every hit.
  - Cache the encoded body, not the dict.

### 3.3 web

Web was not replayed: members' `/api/bars` goes edge → bars-api, and web gets it only on a hedge or breaker. Two facts:
1. **Web memory is at its ceiling with ~0 members.** p95 26.4 GB, hourly peaks 35-44 GB against the 32 GB limit (11-22, 11-23, 11-25). Web cannot take replicas (volume) and cannot grow (plan maximum). This is the largest unsized risk for 500 members. It needs its own investigation before launch: what holds 26 GB?
2. **The edge's safety net lands on web.** A bars-api ask slower than 1.2 s (history) or 2.5 s (bars) is also sent to web. A failure opens a 20 s breaker that sends **every** read to web (`edge/bars-edge-router/worker.js`). An overloaded bars-api therefore moves its whole load onto the single web process, which also runs auth, the notebook and the live stream for non-canary members. Size bars-api so this never fires, and alarm on it (section 5).

### 3.4 stream-ingest and stream-edge (full live data: A.* + T.* for front, hidden and candidate panes)

Union of desired symbols, simulated from the member model:

| members | symbols each (avg / max) | union | A.*+T.* subscriptions |
|---|---|---|---|
| 200 | 7.0 / 12 | 553 | 1,107 |
| 500 | 7.1 / 12 | **1,065** | **2,131** |
| 1,000 | 7.1 / 12 | 1,656 | 3,313 |

Each member has front, ±1 hidden, 1-3 kept boards and, while typing, 3 candidates. At 500, the union holds **~81% of the market's dollar volume**, so T.* on the union is close to the whole market's trade tape at the open (tens of thousands of trades a second).

- **stream-ingest** holds the one vendor socket. It stays one replica: a second socket on the key kicks the first. It is one asyncio process, using 0.42 vCPU max over 3 days today. ⛔ Its CPU at the open with T.* on ~1,065 symbols has **not been measured**. Read `python -m api.stream_ingest_main --status` (per-minute event counts and lag histograms, `bar_stream._ing_cur`) at the first open after the client ships hidden-pane T.*. If one core passes 70%, move frame parsing to a second process. It is not resized now.
- **stream-edge** is stateless: no volume, and the feed client id is `RAILWAY_REPLICA_ID`. Today it serves only the canary (`uct_stream_edge=1` or the Worker's `STREAM_EDGE_ALL`), so **members' live stream still runs on web**, which is the 1.5-5 s delivery pauses `api/stream_edge_main.py` was built to remove. For 500 members:
  1. Set `STREAM_EDGE_ALL=1` on the Worker (owner step, Cloudflare dashboard).
  2. Run stream-edge with **3 replicas** (~1-1.5k SSE connections). Each idle replica is ~0.1 GB, about $1-3/month.
  Replicas are not set yet: today they would carry nothing.

## 4. Monthly cost at 500 (usage-billed; list prices, 2026-11)

Railway Pro list prices: $20 per vCPU-month, $10 per GB-month of RAM, $0.05 per GB egress, $0.15 per GB-month of volume.

| line | today | at 500 (edge-first client) | how |
|---|---|---|---|
| bars-api RAM | ~$19 | **$150-250** | 12 processes × 1.2-2 GB, always resident |
| bars-api CPU | ~$1 | **$25-40** | ~10 vCPU busy at the peak, ~0.5 of peak over 136 market hours/month |
| bars-api egress (gzip) | ~$0 | **$40** (old client $100, full-today $275) | ~2 KB gz/ask edge-first, 50% of peak over market hours |
| bars-api volume | $7.5 | $7.5 | 50 GB |
| stream-edge × 3 | ~$1 | ~$5 | |
| Cloudflare Workers + R2 | ~$5 | **$150-250** | ~2,000 req/s peak through the Worker (~0.5 B requests/month at $0.30/M) + CPU ms + R2 class-B reads ($0.36/M) |
| Massive | current plan | **see section 8 (owner)** | |
| **total, infrastructure** | | **~$400-600/month** | before any second bars-api service (section 6) |

## 5. Alarms (the origin budget is an alert, not a cap)

Each alarm needs a data source that already exists. They are not wired into a pager in this PR; wiring them is the follow-up.

| alarm | fire when | source |
|---|---|---|
| origin budget | bars-api asks > **0.06 per member-second** (30/s at 500) for 15 min: info (the plan's budget, kept as a signal) | Railway HTTP logs for `bars-api`, or the edge `X-Bars-Edge: tier` count |
| origin overload | bars-api asks > **1,950/s** (1.3 x the planned 1,503/s peak, so the planned peak itself never pages) for 5 min, OR above 85% of the topology ceiling once section 7 measures it: page | the same |
| hand-off share | followers' requests answered by the leader (`X-Bars-Served-By: leader`) > 20% of asks for 5 min: the ONE leader is carrying the tier | edge / Railway logs |
| origin latency | server-timing `bars;dur` p99 > 250 ms for 5 min | `[bars-slow]` lines + Railway HTTP logs |
| shed | 503 `warming` / `warm-shed` > 0.5% of asks for 5 min | edge `X-Bars-Shed` |
| **cascade to web** | edge `X-Bars-Edge: web-hedge` or `web-breaker` > 1% of `/api/bars` for 5 min | Worker logs |
| no leader | `/api/health` on bars-api shows no `role: leader` in 20 calls, or the coverage view `<DATA_DIR>/.bars-live-view.pkl` is older than 5 s while the stream is alive | `/api/health`; `stat` via Railway SSH |
| memory | bars-api container > **29 GB** (above the planned 12 x 2 GB = 24 GB, below the 32 GB limit), or web > 28 GB | Railway metrics `MEMORY_USAGE_GB` |
| vendor | any member-path `fetch` / `cold-bg` serve layer > 1% of asks | server-timing `desc` |

## 6. At 1,000 members (and for the old / full-today clients at 500)

Edge-first at 1,000 is 3,006 req/s at the peak, about 34 Railway processes at 60% on the forecast: more than one container's memory (14 at most). Members' tails dominate, so in order:

1. **Edge tails** (lane E). The Worker answers `since=` tails from a per-key edge fill, single-flight, refreshed each second. Origin falls to ~430 req/s at 1,000 (2 x the 216/s recorded at 500), **24%** of the 12-worker forecast ceiling (1,800 req/s), 18% of a 16-worker one; a forecast, like section 3.1. This is the cheapest step and needs no member-facing compromise: the stream still delivers every trade.
2. **A second bars-api service** (`bars-api-2`): its own 50 GB volume, its own R2 install, the same env. The Worker gives every symbol ONE home service by symbol hash (`BARS_ORIGINS`), so each service's memory cache sees its own half of the universe. Cost is about +$230/month per service.
   ⛔ **Never fall back across stores.** `history_rev` / `series_rev` are comparable only within ONE store (`edge/bars-edge-router/worker.js` keys its copies per store; 70 of 70 series compared differed between the web and bars-api stores). An answer from the other service would be compared by the client against a rev from the home store, and could be taken as "nothing changed" or "history rewritten" when neither is true. So when a symbol's home service fails, the Worker answers 503 + Retry-After (the client keeps its copy and re-polls) rather than asking the other service. Moving a symbol's home on purpose (a service retired, the hash re-spread) must be a STORE CHANGE the client sees: the answer carries the serving store's identity and the client re-validates the whole series, never a rev comparison. That store identity on the wire does not exist yet; until it does, the two services need a fixed home per symbol and no failover. (Today's edge already hedges and breaks to WEB, a different store: the same hazard, tracked under section 3.3.) The Worker change belongs to the edge lane.
3. **stream-edge: 6 replicas.** stream-ingest: measure first (section 3.4). Union ~1,656 symbols.
4. **web:** the memory investigation of 3.3 must be finished first; at 1,000 members a 32 GB single process is not credible.
5. **Cloudflare:** costs scale linearly (~$300-500).

If Railway offers Enterprise per-replica sizes above 32 GB, more processes fit in one container instead of step 2.

## 7. Replay results: #2962's topology

**Harness.** `tools/capacity_replay/run_topology.py` runs #2962's REAL topology: N processes on one `DATA_DIR` with `BARS_API_WORKERS=N` (one elects leader; followers hand leader-only work to it over the loopback port), sandboxed (read-only immutable copy of a real store, loopback-only sockets, no vendor), the member model of section 1, members swept per case, a fresh `DATA_DIR` and fresh processes per case, a free-commit-memory floor, and the share of requests the leader answered for a follower (`X-Bars-Served-By`). On Windows each process has its own port and the clients round-robin (uvicorn's shared `listen` fails there); production shares one socket.

**Measured 2026-11-28 on a GitHub runner** (`tests/test_capacity_replay_ci.py` via `remote_tests.py`, Actions run 46137497499, the harness of
this PR with its gate forced on in a throwaway commit): 8 vCPU / 31 GB (`vars.FAST_RUNNER`), #2962's REAL Linux shape
(`uvicorn workers=N` on one socket, `BARS_API_WORKERS=N`), a SYNTHETIC store (`synth_store.py`: 1,500 tickers, 400 with
intraday, 11.0 M rows, 0.7 GB; the real schema and keys, random-walk prices, no production data), the `edge` member
model, 10 s ramp + 30 s measured per case, the load generator ON THE SAME RUNNER (4 aiohttp processes).

| processes | members | offered req/s | OK req/s | p50 ms | p95 ms | p99 ms | timeouts | 503 sheds | handed to leader | RSS per bars-api process |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 (solo) | 40 | 111 | 111 | 3 | 27 | 64 | 0 | 0 | - | 0.6 GB |
| 1 | 70 | 208 | 207 | 5 | 55 | **113** | 0 | 3 | - | 0.9 GB |
| 1 | 100 | 297 | 297 | 474 | 1,415 | 1,746 | 0 | 4 | - | 1.3 GB |
| 2 (leader + 1) | 80 | 238 | 238 | 3 | 24 | 48 | 0 | 0 | 0.0% | 0.6 GB |
| 2 | 140 | 421 | 421 | 6 | 356 | **557** | 0 | 5 | 0.0% | 0.9-1.0 GB |
| 2 | 200 | 607 | 594 | 7,331 | 8,051 | 8,290 | 364 | 27 | 0.0% | 1.3 GB |
| 4 (leader + 3) | 160 | 487 | 487 | 2 | 26 | **48** | 0 | 0 | 0.0% | 0.6-0.8 GB |
| 4 | 280 | 849 | 849 | 1,203 | 2,186 | 2,348 | 0 | 11 | 0.0% | 1.0-1.1 GB |
| 4 | 400 | 1,242 | 216 | 6,859 | 8,410 | 8,772 | 30,987 | 2 | 0.0% | 1.2-1.3 GB |

What it says:
- **The topology works and scales close to linearly** on this runner: ~210-300 req/s per process at the knee (1 process
  clean at 207, collapsing at ~300; 2 processes clean at 421 with p99 557 ms; 4 processes clean at 487, saturated by 849
  with p99 2.3 s). Past the knee a case COLLAPSES (queues, 8 s timeouts, OK req/s falls): there is no graceful plateau,
  which is why the alarms page at the planned peak x 1.3, far below the knee of the size chosen.
- **The leader carried nothing extra (0.0% handed off)** in this steady state: every series stored and current, no
  holes, no cold tickers, and best-effort kicks go to the leader as kicks, not requests. The hand-off share under COLD
  load (first views, holes, a swap) is NOT measured here.
- **RSS grows with load**, 0.6 GB idle to 1.3 GB per process at saturation, on a 0.7 GB store; the production store and
  caches are larger, so #2962's 2 GB-a-process budget stands.

⛔ **What one runner cannot show.** The 4 load-generator processes and the bars-api processes share 8 vCPUs, so at 4
processes the runner, not bars-api, is the ceiling; it cannot drive a 500-member peak (~1,500 req/s edge-first). A
separate load-generator machine is not possible in this lane: it is ONE job, and GitHub-hosted runners accept no
inbound connection from another job (a self-hosted runner pair, or the load generator on the dev box against a
cloud host, would be needed). The synthetic store is 0.7 GB, so the OS page cache is warmer than production's.

**What it means for the sizing (still a forecast for Railway):** ~200-250 req/s per process clean on an 8-vCPU runner
puts 12 processes at ~2,400-3,000 req/s IF the 32-vCPU container scales the same and a Railway process is no slower
(section 2 assumed local / 2: on that assumption, ~1,200-1,500). The 500-member edge-first peak is 1,503 req/s, so 12
processes carry it on the optimistic reading and only just on the conservative one; 2 x the peak needs edge tails or a
second service either way (section 3.1 stands). `BARS_API_WORKERS` stays unset until a Railway-side measurement.

The dev-box replay (`run_topology.py` on the real store copy) is still queued under `heavy_lock run --solo` as the
fallback: it adds the real store's shapes and the 16-core box.

**What the harness has shown (a smoke, not a measurement):** 2 processes, `edge` mode, 20 members, 10 s: roles `leader` + `follower`, 67.8 req/s offered, 65.3 OK, **6.8% of requests answered by the leader for the follower** (a cold start: every series is new to the follower's memory cache), 13 sheds (503 `warming`), private memory 1.0 / 1.3 GB per process.

**Discarded:** the earlier `run_matrix` cases (`old:500:1`, `old:500:6`, `edge:200:1/2`, `edge:500:1`) offered 600-1,500 req/s to 1-6 independent processes and answered almost nothing (`ok_rps` 0-120, tens of thousands of timeouts): they measured an overloaded box, not a ceiling, and are not used anywhere above.

When the topology run lands, record here per case: offered / OK req/s, p50 / p95 / p99, sheds, timeouts, the hand-off share, peak private MB per process; then the ceiling = the highest OK rate with p99 under 250 ms and no timeouts, per process count, and replace the forecast in section 3.1.

## 8. Needs the owner

1. **Massive licence for 500 members.** `massive.com/pricing` lists Stocks Advanced at $199/month as **"Individual use only"**. Showing real-time data to paying members is redistribution. `massive.com/business` lists **Stocks Business at $2,499/month** (billed monthly; annual saves 20%): "Unlimited API Calls", "Real-time Fair Market Value", "Streaming FMV & Minute Aggregates", "No Exchange Fees or Approvals". **Enterprise** is custom ("Exchange Feeds Tailored for Your Use Case", SLAs). The business page does not say whether Business carries per-trade `T.*` and per-second `A.*` for display; raw exchange feeds are add-ons (Nasdaq Basic $1,999/month, Cboe EDGX $1,999/month, IEX $499/month). **Ask Massive sales which tier licenses display of T.* and A.* to ~500-1,000 subscribers, and how many concurrent sockets it allows.** Today the code assumes one socket per key. Nothing was changed in the vendor account.
2. Set `STREAM_EDGE_ALL=1` on the Worker when ready (3.4).
3. Web memory (3.3) before launch.

## 9. Changes made, and how to undo each

| when (UTC) | change | undo |
|---|---|---|
| (after #2962 merges AND section 7 measures the topology) | `railway variables --service bars-api --set BARS_API_WORKERS=12`. This restarts bars-api for ~10-20 s, during which the edge serves from web. Do it outside market hours, then verify the boot: `/api/health` on the bars-api service ×20 shows one `role: leader`, several `pid`s, and `workers` = the value set. | `railway variables --service bars-api --set BARS_API_WORKERS=1` (restart). A delete does not restart: redeploy after it. |

No Railway resource or replica change was made by this work. The limits are already at the plan maximum, and the processes change needs #2962 on master first.
