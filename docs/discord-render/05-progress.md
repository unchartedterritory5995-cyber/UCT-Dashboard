# 05 — Progress: numbers after every merge

One section per master merge: what shipped, the gate on the merged tree, the deploy as measured,
and the bench before → after. "Before" for every row is `02-baseline.md` (in-pod, closed market,
2026-09-13). A row with the V2 flag unset has no member-path latency change by construction; its
bench column says so rather than printing a re-run that measures the same code.

---

## Merge 1 — Phase 0 + dark 2.1 · `740b79ad5` · 2026-09-13 (Sunday)

**Shipped (dark):** program docs `00`–`03`, `LEDGER`; tools `discord_render_bench.py`,
`discord_render_forensics.py`, `railway_env_logs.py`; `api/services/discord_render/`
(ids, contract, jobs store, delivery, runtime, commands); router V2 branch; lifespan resume/release;
`fail_fn` hooks on the chart/flow jobs; 7 stale tests corrected; activity-row truncation fix.

**Gate on the merged tree** (`7f230fbe9`, after merging 29 master commits): 17 scoped files,
**494 passed, 1 failed** — the failure (`test_every_off_by_default_gate_is_declared`, four
`ALERT_TAXONOMY_*_DARK_ENABLED` gates) reproduced identically on a clean checkout of master's tip
`506eeee6d`: **inherited, 0 new**. flow-worker watch coverage `OK` (reachable 154, watched 24,
changed 26). Mutation proofs: 18 across three harnesses, all red, restores sha-verified.

**Deploy, measured:**

| Check | Result |
|---|---|
| `web` deployment on `740b79ad5` | SUCCESS 17:17:20 UTC (built 17:14:59 → 17:17:20) |
| Running commit, read in-process | `740b79ad52aa…`, then — after another session's push inside the window — `f34ce660b798b6ca5`, which contains `740b79ad5` (ancestor verified) |
| `/api/health` | 200; uptime reset (62 s on this deploy; 166–255 s on the superseding pod) |
| Interactions endpoint, bad signature | `401 invalid request signature` ×3, 0.18–0.43 s (one 502 during the other session's swap) |
| `DISCORD_RENDER_V2_ENABLED` in the running process | absent |
| flow-worker | SKIPPED (no tape gap) |
| `worker`, `bars-api` | rebuilt; superseded by `f34ce660b` SUCCESS |

**Bench before → after:** no change measurable by design — with the flag unset the member path is
the pre-V2 code (railed). The first flag-on bench row belongs to the canary in Phase 3/4.

**Member impact:** none visible (see `LEDGER.md` row 4).

---

## Merge 2 — 2.2 observability, dark · 2026-09-13 (Sunday)

**Shipped (dark):** `api/services/discord_render/observe.py` — scrubbed `drender` events (exceptions
through `observe.exception`, so a failed Discord edit cannot log the interaction token), SLOs from
the durable jobs table (5 min / 30 min / 1 h / 24 h / 7 d), the §3.9 alert rules, and the observer
thread (alerts to `DISCORD_RENDER_ALERT_WEBHOOK` with a durable cooldown recorded only after Discord
accepts, hourly `store.purge()`, a cached renderer reading); `GET /api/discord/render-health`; the
`/renderhealth` handler with a server-side admin check, plus `build_commands(renderhealth=True)` and
`register --renderhealth` (not registered); one stale test corrected.

**Gate on the merged tree** (`72cfddf87`, after merging 22 master commits): 13 scoped files,
**479 passed, 0 failed**. flow-worker watch coverage `OK` (reachable 154, watched 24, changed 14).
Mutation proofs: 18 on the branch tree, all red, restores sha-verified, control green.

**Deploy, measured:**

| Check | Result |
|---|---|
| Push | fast-forward `d6ac61816..6d779dd47`, 18:03:56 UTC; `web` SUCCESS and master 0 ahead immediately before |
| `web` deployment on `6d779dd47` | BUILDING 18:04:21 → DEPLOYING 18:05:48 → SUCCESS 18:06:09 UTC |
| Running commit, read in-process | `6d779dd47d1f` (`/proc/1/environ` of the running process) |
| `/api/health` | 200; uptime 33 s |
| Interactions endpoint, bad signature | `401 invalid request signature` ×3, 0.11–1.80 s |
| `GET /api/discord/render-health`, no bearer | `401 unauthorized` — the new route is live and gated |
| `DISCORD_RENDER_V2_ENABLED` / `DISCORD_RENDER_ALERT_WEBHOOK` in the running process | both absent |
| flow-worker | SKIPPED (no tape gap) |
| `bars-api` · `worker` | SUCCESS · SUCCESS (worker re-read after 18:07 UTC) |

**Bench before → after:** no change measurable by design — the flag is unset.

**Member impact:** none visible (see `LEDGER.md` row 6).

---

## Step 2.3 — chart-renderer, measured against real Chromium (branch, before merge 3)

`scratchpad/renderer_pool_smoke.py` on the owner's box: Playwright 1.58 / Chromium 145, the
service module loaded fresh per config, a **hermetic** `data:` page (a canvas of 200 bars, no
network), 960×500 @1×, 48 renders per config at concurrency 4, first-render costs excluded.
⚠️ Not Railway (Playwright 1.47, Linux, 8 slots) and not `/r/chart` over the network: this
separates the pool's effects from each other; it does not predict production latency. Production
reads come from `/health` (`p95_render_ms`, `pool_hits`) in the Phase 3 canary.

| Config | p50 | p90 | max | Pool hits / misses | Recycles | Boot warm |
|---|---|---|---|---|---|---|
| legacy (pool off) | 537 ms | 865 ms | 1,121 ms | — | — | — |
| pool, no spare contexts, recycle 500 | 534 ms | 816 ms | 914 ms | 0 / 48 | 0 | 1,772 ms |
| **pool, spare contexts, recycle 500** | **440 ms** | 787 ms | 1,249 ms | 16 / 48 | 0 | 1,311 ms |
| pool, recycle every 12 (worst case) | 593 ms | 1,039 ms | 1,565 ms | 0 / 48 | 3 | 1,496 ms |
| legacy again (drift control) | 535 ms | 963 ms | 1,017 ms | — | — | — |

- **Spare contexts: kept** — the one measured latency gain (−97 ms p50 against legacy, whose p50
  moved 2 ms across the run). §3.7 made keeping them conditional on a measured gain.
- **A recycle** costs little once the replacement is launched at retire time: +56 ms p50 at a
  recycle every 12 renders. The first smoke, before that change, launched Chromium on the next
  member's render and measured p50 1,732 ms at a recycle every 8 — the fix came from that number.
- **Background cap** under real concurrency (6 background + 6 member renders, 4 slots, 2
  background): at most **2** background renders at once; all 12 valid.
- **C-13 against a real Playwright error:** navigation to an unresolvable host with a token in the
  URL — the raw error message contained the token (control), `scrub()` output did not.

---

## Merge 3 — 2.3 web half (headers + scrub) · 2026-09-13 (Sunday)

**Shipped:** `ids.bind / background / carry / render_headers`; the V2 runtime binds each job; the
multi-chart pool carries the binding; the warm cycle marks itself background; house and buzz renders
send the headers and scrub the renderer's error body before logging it. `services/chart_renderer/app.py`
is in the commit but deploys separately (row 9).

**Gate** (`a69dfc574`; master had not moved since merge 2, nothing to merge): 25 scoped files,
**724 passed, 0 failed**. Watch coverage `OK` (changed 12). Mutation proofs 22/22 red.

**Deploy, measured:**

| Check | Result |
|---|---|
| Push | fast-forward `6d779dd47..d32d14d60`, 18:44:29 UTC; `web` SUCCESS and master 0 ahead immediately before |
| `web` deployment on `d32d14d60` | BUILDING 18:44:42 → DEPLOYING 18:46:50 → SUCCESS 18:47:11 UTC |
| Running commit, read in-process | `d32d14d604ee` |
| `/api/health` | 200; uptime 61 s |
| Interactions endpoint, bad signature | `401 invalid request signature` ×3, 0.20–0.26 s |
| `GET /api/discord/render-health`, no bearer | `401 unauthorized` |
| V2 flag / alert webhook in the running process | both absent |
| flow-worker | SKIPPED (no tape gap) |
| `worker` · `bars-api` | SUCCESS · SUCCESS (re-read 18:49 UTC) |

**chart-renderer deploy (row 9), measured:**

| Check | Result |
|---|---|
| Payload | `git archive a69dfc574 -- services/chart_renderer` → sha256 = committed blobs, 0 CR; unchanged at master `d32d14d60` |
| Deployment `6090d306` | BUILDING 18:48:34 → DEPLOYING 18:49:16 → SUCCESS 18:49:58 UTC |
| Image | `/app/app.py` 584 lines, 23,944 bytes = payload |
| `/health` (from the web pod) | 19 keys (was 3); `ready: true`, `pool_enabled: false`, `launch_error: null`, `timeouts: 0`, `failures: 0`, `rss_mb: 790.4`, `p95_render_ms: 2300.1` over 7 renders |
| Render log lines | 9 × `render cid=- path=/r/chart status=200 prio=background ready=True` — the warm cycle's header, end to end |
| Unredacted `token=` in the post-deploy log | 0 (no failed render occurred to exercise the scrub) |

---

## Step 2.4a — symbol resolution and the `/flow` partition, measured on production data (branch)

⛔ **Scope, recorded because the plan line said otherwise (owner ruling R-1, 2026-09-13):** 2.4a
shipped symbol resolution and the `/flow` ETF partition. It did **not** ship the freshness
contract — the market clock, the envelope and the STALE rule were built in **2.4b**
(`freshness.py`, `4984e6207`), and the session rule they settle on is `03` §3.8b.

**How:** the branch's `symbols.py` (sha-verified upload to `/tmp`) run by a read-only probe in the
`web` pod as a separate process — the real ticker-search snapshot (26,624 rows), cap universe
(3,742), liquid-ETF list (100), `bars.db`, `entity_master.db`. Cold process: an upper bound. Plus
the live `/api/bars` answer for the same symbols, from outside, 19:05 UTC.

| Symbol | Static authorities (first version) | `/api/bars` (live) | Verdict now |
|---|---|---|---|
| NVDA · SPY · GDX · BRK-B | universe, 0 ms | bars | known |
| UCTA50 | breadth, 0 ms | — | known |
| AEHL · MSFY | search index, 0 ms | — | known |
| TCEHY | bars store, 0.2 ms | — | known |
| BRK.B | entity master, **634 ms** (cold) | — | known via universe as `BRK-B`, 0 ms (share-class alias) |
| ^GSPC | **miss**, 23 ms | 200, 5 bars, 1,465 ms | the bars check exceeds the 0.6 s budget → **fails open** (queued, charts) |
| BTC-USD · FNMA | **miss**, 8–9 ms | 200 `no_data: symbol_not_carried`, 109–239 ms | refused — the same outcome `/chart` gives today, sooner and with suggestions |
| ZZZZQ · QQQQQ · XQZVW | miss, 7–8 ms | 200 `no_data`, 211–310 ms | refused |
| APPL | miss | — | suggestions were `MAPPLNCT, AAPL, AMPL` → now `AAPL, AMPL, APPN` order (prefix, one edit, contains, name) |
| NVDAA | miss | — | suggests `NVDA` |

Three corrections came from this run, before any commit: (1) a static miss alone no longer refuses —
the bars serve path decides, and only its explicit not-carried answer refuses (^GSPC is in no static
authority and charts); (2) suggestions rank one-edit matches above symbols merely containing the
input; (3) a dot share class is tried in the universe's hyphen spelling. And one correction to this
program's own record: the 2026-08-26 note that BTC-USD and FNMA chart is **stale** — `/api/bars`
does not carry them today.

`flow_source` on production's class table: **SPY, QQQ, SMH, IWM, SPX, NDX, GDX, DRAM, TSLL → `etfs`**;
**NVDA, AAPL → `stocks`**; SPCX (a stock the legacy list had as an ETF) → `stocks`.

---

## Merge 4 — 2.4a, dark · 2026-09-13 (Sunday)

**Shipped (dark):** `api/services/discord_render/symbols.py`; the symbol check at the ack for
`/chart`, `/charts` and `/flow` (kill switch `DISCORD_RENDER_V2_SYMBOLS_ENABLED`); the V2 flow handler's
`etfs`/`stocks` partition; `run_flow_card_job(..., source="stocks")` so the pre-V2 path is unchanged.

**Gate on the merged tree** (`cee1b269b`, after merging 14 master commits): 26 scoped files,
**763 passed, 0 failed**. Watch coverage `OK` (changed 8). Mutation proofs 22/22 red (second run;
two rails fixed after the first).

**Deploy, measured** (parked at the 15:30 ET checkpoint, resumed on the owner's close-out; re-merged
master `7bd9c8785` as `2b04c725a`, gate **764 passed, 0 failed** — the inherited flag-ledger red was
fixed on master by its owner):

| Check | Result |
|---|---|
| Push | fast-forward `7bd9c8785..d623baf1d`, 19:48:51 UTC; `web` SUCCESS and master 0 ahead immediately before |
| `web` deployment on `d623baf1d` | BUILDING 19:49:51 → DEPLOYING 19:50:39 → SUCCESS 19:51:10 UTC |
| Running commit, read in-process | `d623baf1d836` |
| `/api/health` · bad signature · render-health without bearer | 200 · 401 · 401 |
| V2 flag / alert webhook in the running process | both absent |

---

## Step 2.4b P2.1 — the provider adapters, and the hot path wired to them (branch)

**What it is:** one module per upstream under `api/services/discord_render/adapters/`, each exposing
`fetch(request) -> Result`. Timeouts, retries, breakers, fallback and the freshness stamp live there
and nowhere else; the V2 handlers bind adapter-backed callables through `bindings.py` with the exact
shapes `produce_chart` already calls, so the render function is unchanged and the pre-V2 path is
untouched. Design and the per-adapter table: `03` §3.8c.

### What reading the call sites found, before a single test ran

Three of these are live defects. None was found by a test — they came from reading what the code
does at the boundary, which is the same discipline as *read the wire, not the call site*.

| # | Measured | Why it matters |
|---|---|---|
| **OI-21** | `discord_chart_house.RENDER_TIMEOUT_S` = **60 s**, over **two** attempts, behind a **15 s** job deadline | The watchdog fires at 15 s and tells the member the render failed; the request keeps a worker for up to another **105 s**. And `breakers.DEFAULTS["renderer"]`, tuned for this exact dependency, had **zero production callers** — built, tested, green and unwired. |
| **OI-25** | `produce_chart._fetch` already retries twice with a **fixed 1.5 s** delay | An adapter retry on top would make **four** bars fetches per chart and sleep ~2.9 s inside a 15 s deadline. Both layers are individually correct; only the composition is wrong. |
| **OI-22** | A quote failure is indistinguishable from "no extended-hours print" — swallowed at **three** layers | A quote outage looks like a quiet overnight, so no breaker can ever see it. The call also had **no timeout of any kind**, on the path that must answer Discord in 3 s. |
| **OI-23** | **Three** unreconciled failure vocabularies (member contract · adapter taxonomy · the `/flow` router's inline classes) | A class in one and not the others renders as a generic apology — C-08 one level up. Closed by `adapters/classes.py`: `(upstream, reason) -> contract class`, total over the cross-product, raising on an unmapped pair rather than quietly becoming `internal`. |
| **OI-24** | `discord-chart-produce` is spawned without `ids.carry` | Every `drender` event from inside a chart production is unattributable — on the one path where a member's complaint has to be traceable to a job. Queued for 2.8 (pre-V2 file). |

### The properties, and the number each one is

- **The ceiling is `min(dependency timeout, the JOB's remaining time)`** — `Job.remaining_s()`,
  measured from `created_at` (the ack), not from when a worker picked the job up, because the queue
  wait is time the member has already spent. §3.8's per-dependency numbers are the other half:
  bars 8 s · quote 1.5 s · flow 10 s (connect 2 s) · renderer **20 s** · entity 0.6 s.
- **A failure is a value with a named class**, never an exception and never a bare `None`. `stale`
  and `cached` are deliberately **not** failures, because a labelled stand-in is a delivery (S8) and
  counting it as one would hide a renderer outage inside a green success rate.
- ⛔⛔ **`unreachable` and `upstream_error` are separate and must stay separate.** "We could not
  reach it" and "it answered with an error" are a different sentence to a member, a different next
  action for us, and they decide whether `/flow`'s in-process fallback runs at all — a 5xx means
  flow-worker *answered*, and `web`'s copy would very likely answer the same. They were one `except`
  for two weeks, which is C-08. ⚠️ **Found by writing the wiring, not by a test:** the first version
  of this layer had them merged and the flow tests still passed, because every case in them happened
  to want the same outcome.
- ⭐ **An empty `/flow` tape is an answer, not a failure** — the same mistake pointed the other way.
  A quiet session is true and useful, the router already has the sentence for it, and classing it as
  a failure would put a correct answer in the failure counters and lose the window phrase the
  sentence needs. It comes back `ok` with `contract_count == 0`. An empty **bars** answer *is* a
  failure (`no_bars`) — there is no chart to draw. Same observation, different meaning, which is why
  `classes.py` maps a **pair** and not a reason.
- **One bounded pool per dependency** (`renderer`/`flow`/`bars` 4, `quote`/`entity` 2). A Python
  thread cannot be cancelled, so a timeout means *we* stopped waiting; the bound is what keeps a
  wedged upstream from consuming anything but its own threads — C-02's lesson, where member jobs and
  the dashboard drained one shared pool of 64. `abandoned_calls()` reports them separately, because
  an abandoned call is not a failure and no success/failure ratio can show it.
- **The vintage is the data's, never the wall clock.** Bars: the newest bar's `t`. Flow:
  `window.end`, **not** `query_date` — a card built from Friday's tape at Sunday noon would otherwise
  stamp itself Sunday and read as live. The renderer has no vintage of its own and is given the
  bars', so the picture is exactly as old as the data drawn in it (§3.10).
- **The `/flow` fallback is conditional and every condition is a reason**: in-process only on a
  transport error or an open breaker; never on a timeout (the budget is gone and the local leg is the
  slower of the two); never after the remote leg *answered*; never below `LOCAL_MIN_S`. A served
  fallback is a **degraded** delivery and carries why the first leg failed.

### Rails

`tests/test_discord_render_result.py` · `tests/test_discord_render_adapters.py` ·
`tests/test_discord_render_failure_classes.py` · `tests/test_discord_render_adapter_boundary.py` —
the boundary rail walks an **AST**, not a grep, and carries both halves: nothing outside `adapters/`
may hold a network client, and the exemption list for the two legitimate transports
(`delivery.py` §3.4, `observe.py` §3.9) must be exactly the modules that still need it.

⭐ **The P2 ground rule is proved STRUCTURALLY, not by a golden.**
`test_the_pre_v2_path_cannot_reach_the_adapters` asserts that neither `discord_interactions.py`
imports the adapters package. A golden diff proves two runs agreed on the inputs somebody chose;
this proves there is no path at all, for every input. The companion rail asserts `commands.py`
*does* import them, so the layer cannot quietly become unwired.

**Kill switch:** `DISCORD_RENDER_V2_ADAPTERS_ENABLED` — under the V2 master, **unset = ON**, read
per call (railed), declared `dark`. Set it to `0` and the handlers bind the raw functions again: a
rollback of P2.1 with no deploy, and a switch rather than a delete.

---

## Master merge 5 — 2.4b part 2 (P2.1–P2.10), dark · 2026-09-13 (Sunday, 20:1x ET)

**Shipped (dark):** the provider adapters and the hot path wired to them; the member-facing stamp;
the breaker and loop-stall alerts; the event-loop probe; shadow mode. Design in `03` §3.8c/§3.8d,
the member-facing surface in `04-visual-spec.md`.

**Gate on the merged tree** (after merging 43 master commits, with overlap on `CLAUDE.md`,
`api/main.py` and `docs/feature_flags.json` — merged, not rebased, per the standing rule): 44 scoped
files, **1,112 passed, 0 failed**. Hygiene gate clean (9,219 tracked files). Watch coverage `OK`
(changed 39, none on flow-worker's list). Mutation proofs **69/69 red**, restores sha-verified,
controls green either side. Secret scan **0 findings** over 39 paths, run by hand because the hook
cannot run it here (OI-26).

**Deploy, measured:**

| Check | Result |
|---|---|
| Push | fast-forward to `5ca4d5db2`; master's own pre-push guard confirmed `web` SUCCESS and 769 s settled first |
| `web` deployment | BUILDING → DEPLOYING → **SUCCESS** on `5ca4d5db2`, ~2 min |
| Running commit, read in-process | **`5ca4d5db2385`** |
| `/api/health` · bad signature · render-health unauthenticated | **200** · **401** · **401** |
| flow-worker | **SKIPPED** on both pushes — the tape was never touched |
| `DISCORD_RENDER_V2_ENABLED` · `RENDER_V2_SHADOW` · the two kill switches | **all absent** in the running process |
| Renderer ceiling, read in-process | **20.0 s** (was effectively 60 s over two attempts behind a 15 s deadline — OI-21) |
| `loopwatch.snapshot()` | `running: false`, `samples: 0`, `max_ms: null` |

⭐ **That last row is the design working, not a defect.** The probe starts inside the V2 lifespan
block, which is dark — so it costs nothing today and says so. `samples: 0` with `max_ms: null` is
deliberately distinguishable from a healthy loop: a probe that never ran must never read as "fine".

**Member impact: none.** Everything new is reachable only from `commands.py`, which runs only when
`DISCORD_RENDER_V2_ENABLED` is set, and it is absent. The one change on the pre-V2 path is the
interactions route delegating to `_dispatch_interaction` and returning its reply **unchanged**; the
shadow beside it is gated on `RENDER_V2_SHADOW`, also absent, and a rail asserts the reply survives
even when the shadow setup raises.

---

## P2.10 bench — what the adapter layer costs, three ways (2026-09-13, 20:3x ET)

`docs/discord-render/instruments/adapter_overhead_bench.py`, 300 calls per case, one upstream
stubbed to a fixed 1 ms so the **only** variable is the layer. `--self-check` first: a deliberately
injected 4 ms showed up as 1.54 → 5.99 ms, so the bench can see a cost before any small number from
it is believed.

| Case | p50 | p95 | max |
|---|---|---|---|
| **raw** (the pre-V2 binding) | 1.520 ms | 1.613 ms | 1.798 ms |
| **adapters** (V2 default) | **1.525 ms** | 1.836 ms | 2.220 ms |
| **switch_0** (`DISCORD_RENDER_V2_ADAPTERS_ENABLED=0`) | **1.520 ms** | 1.643 ms | 1.949 ms |

**Overhead: +0.005 ms at the median, +0.42 ms at the worst** — against an 8 s bars budget and a 20 s
render ceiling. ⭐ **`switch_0` matches `raw` to three decimals**, which is the measured proof that
the kill switch is a real rollback and not a comment: it hands back the raw function, and a bench
case says so rather than a docstring.

⚠️ **This is not the end-to-end bench and does not replace it.** `tools/discord_render_bench.py`
runs in the web pod against the real renderer and bars store; that is what `02-baseline.md` is made
of. This isolates the one question the end-to-end bench cannot answer cleanly because its variance is
dominated by the network: what does wrapping a call in a pool submit, a breaker and a `Result` add?

---

## Wall clock (owner brief §4)

| Merge | Step | Start (ET) | End | Gate | Deploy wait | Active work |
|---|---|---|---|---|---|---|
| 5 | 2.4b P2.1–P2.10 | ~17:10 | 20:07 | 6 m 38 s (1,112 tests) | ~2 min | the balance — authorship + 69 mutation runs |
| 5a | merge-5 record | 20:07 | 20:12 | n/a (docs) | ~2 min | ~3 min |
| 6 | frozen contracts + `07`/`08` | 20:12 | 20:25 | 20 s (166 tests) | ~3 min incl. **one push refused** by master's own pre-push guard (a deploy was in flight — the queue working) | ~10 min |
| 7 | shadow ON + interpretability | 20:25 | 20:40 | 7 s (78 tests) | ~2 min | ~11 min |

⭐ **Where the time actually went, and the fix already applied:** merge 5 spent more wall clock on
gate + deploy than on authorship, which is what the lane plan (`07-execution-plan.md`) exists to
reclaim. Merges 6 and 7 ran with five lanes working in parallel underneath them, so the deploy waits
cost nothing.
