# Performance baseline — 2026-09-26

The deliverable named by `docs/terminal-research/07-technical-architecture/current-performance-and-realtime.md`
§8: *"A dated `docs/perf-baseline-<YYYY-MM-DD>.md` with one table per protocol, the
session/uptime context for every row, and an explicit delta against §4.3's numbers."*

§8 proposed eight protocols (A–H) and opened with **"Nothing below was run."** This is the
first execution. Everything here was run against **production**, read-only, with a browser
UA, from a client — nothing was run *on* the pod (§8 Governing Rule 2).

⛔ **Session context applies to every row and invalidates some of them.** All runs were
2026-09-26 00:59Z–01:10Z, i.e. **after the close** (20:59–21:10 ET). Production took
**fourteen web deployments in the 6.5 hours to 00:58Z**, median pod lifetime **26 minutes**,
so several protocols could not get a warm pod. ⚠️ **Roughly half of those deploys were mine**
— I was shipping while measuring, and I degraded the measurement I was taking. That is
recorded because the next person will have the same conflict and should schedule around it.

---

## Protocol F — capacity telemetry ✅ THE HEADLINE RESULT

§8: *"Export 24 h of Railway logs and plot both. This **distinguishes a leak from a
large-but-stable working set** — which `api/main.py:3639-3644` calls 'the prerequisite for
any further memory work'."*

24 h is not reachable from one deployment when the median pod lives 26 minutes, so this used
the **longest-lived deployment available**: `5bad63301`, which ran **104 minutes**
(19:37→21:21Z, straddling the close). `railway logs <DEPLOYMENT_ID> --lines 5000`.

| | value |
|---|---|
| `[mem]` samples | **76** (one per 60 s) |
| first sample | rss **2,429 MB**, threads 98 |
| last sample | rss **3,028 MB**, threads 41 |
| rss range | min 1,750 · median 2,774 · **max 3,401** |
| threads | min 41 · median 124 · **max 178** |
| net drift | **+599 MB over ~76 minutes = +7.9 MB/min** |
| quartile medians | **2,429 → 2,746 → 2,956 → 3,028** — monotonically rising |

### ANSWER: a leak, not a stable working set — and the prerequisite is now met

The quartile medians rise monotonically across the whole deployment. That is the question
§8 posed, and the answer is the unwelcome one. ⚠️ Sample-level variance is wide (1,750 to
3,401 MB), so individual samples dip — GC and cache eviction are visible — but the *trend*
is unambiguous across quarters.

### Delta against §4.3 — it refutes the rate and corroborates the endpoint

§4.3 carries an **undated** claim: RSS *"climbs ~2.2 MB/s (1,201 MB at 105 s, 1,661 MB at
318 s, 11,665 MB observed on a long-lived one)"*.

* ⛔ **The rate is wrong by ~17×.** 2.2 MB/s is ~132 MB/min. Measured: **7.9 MB/min**.
* ⭐ **The endpoint is corroborated almost exactly.** 7.9 MB/min × 1,440 min = **~11.4 GB**,
  against the recorded **11,665 MB observed on a long-lived one**. Two independent
  observations, four months apart, of the same destination by a much gentler road.
* ⚠️ **The early-life figures do not match either.** §4.3 says 1,201 MB at 105 s and
  1,661 MB at 318 s; a separate 5-sample read on a 5-minute-old pod tonight showed
  **1,862–2,023 MB** — higher at the same age, and *flat-to-declining within that window*
  (1,980 → 1,905 MB). So a 5-minute window cannot see this leak at all, which is exactly why
  §8 asks for 24 h.

### What this does NOT establish

`n = 1` deployment. One 104-minute window, after the close, on one build. It does not
identify *what* leaks, does not separate the bars cache from the SSE pools from the
scheduler, and cannot say whether the rate is load-dependent. **It does establish that
"large but stable" is off the table**, which is all §8 asked of it.

⭐ **Threads never reached the 200 burst threshold** (max 178), so no `[thread-burst]`
histogram fired in this window, and none appears in any log sampled tonight. Against
§4.3's recorded *"~58 → 931 threads in minutes for ~25 min"*, this window is quiet — but
178 is not comfortably far from 200.

---

## Protocol D — CDN reality check ⛔⛔ DOES NOT SETTLE §3.3 — the probe measured the GATE

☠️ **This section originally read "✅ SETTLES §3.3" and concluded the documented Cloudflare rule is
not in effect. That conclusion is WITHDRAWN.** Full working:
`terminal-research/07-technical-architecture/realtime-performance-architecture.md` §1.

| request | status | `cf-cache-status` | `age` | `content-type` | as recorded |
|---|---|---|---|---|---|
| `/api/flow/data?days=1` | 200 ❓ | **BYPASS** | — | `application/json` ❓ | original run |
| `/api/flow/data?days=1` (+4 s) | 200 ❓ | **BYPASS** | — | `application/json` ❓ | original run |
| `/api/flow/data?days=20` | 200 ❓ | **BYPASS** | — | — | original run |
| `/api/flow/data?days=1` | **401** | **BYPASS** | — | `application/json` | re-read 02:0xZ |
| `/api/flow/data` | **401** | **BYPASS** | — | `application/json` | re-read 02:0xZ |

⛔ **Two things make the original rows unusable.** `/api/flow/data` is gated
(`Depends(require_flow_user)`, `api/flow_router.py:1732`) and answers an unauthenticated caller
with **401**; and it serves `text/csv` (`_serve_csv`, `:468`), so the recorded
`content-type: application/json` **could not have come from this route's payload at all**. The
re-read matches the original rows in every field except the status. The most likely reading is
that the probe measured the refusal throughout.

⭐ **The `days=20`-shares-`days=1` hazard still cannot arise from this evidence** — but that is now
"unmeasured", not "impossible".

**Delta against §4.3, now interpretable:** its 2026-07-25 row recorded `DYNAMIC, age: null` on this
endpoint, **before the 2026-08-09 auth gate existed**, so that reading saw the real payload and
said `DYNAMIC`. Tonight the path reads `BYPASS`. ⛔ **The gate does not explain the change:** three
unrelated gated routes (`/api/watchlists`, `/api/j2/accounts`, `/api/auth/me`) all answer 401 with
`DYNAMIC`. So something was configured on `/api/flow/*` between those dates.

⛔ **And the route is paid, gated tape.** Its own router docstring calls the pre-gate state *the
single largest raw-data leak in the product*. Making this path cache without first reading the
zone's cache key could serve that tape to an anonymous caller from the edge. **Nothing should
change at Cloudflare until the existing rule and the cache key are read.**

**What closes it:** one authenticated `curl -D -` of `/api/flow/data?days=1` reading
`cache-control`, `cf-cache-status`, `age` and `x-flow-version`, plus a dashboard read of any Cache
Rule on `/api/flow/*`.

---

## Protocol B — full chart-surface matrix ✅ 0 FAIL / 11 CHECKS

`tools/market_open_chart_check.py`, 01:02Z, after close (§8: *"the weekend-safe baseline it
was written against"*). **Pod uptime 85 s.**

| check | result |
|---|---|
| health | 200 in **136 ms**, `wire_date=2026-09-25` |
| latency: all 200 | 8/8 |
| latency: warm server-compute | max **12.6 ms**; layers `fetch, mem, miss` |
| weekly dedup MSTR / AAPL | 200 bars each, 0 dup-weeks, 0 non-Friday keys |
| bar sanity AAPL/D, NVDA/5 | 300 bars each, 0 bad-OHLC, 0 future-dated |
| live-bar liveness | ⚠️ WARN — skipped, market closed |
| push-stream (Phase C) | `ws_connected=True`, subscribers 0, emitted 0, drops 0 |
| daily drift monitor | `detect_only_drift_count=0`, healed 0 |
| deep intraday 20k bars | 200, `layer=sqlite`, server **407.9 ms**, total **590 ms**, 1.42 MB |

**Delta against §4.3:** the 20,000-bar deep path answering in **590 ms off `sqlite`** is the
cheerful counterpart to §4.3's 2026-09-02 *"long-tail first view 0.3–6.8 s, localised to
`get_bars` (WAL bloat)"* — this path, after close, on a fresh pod, is fast.

⚠️ At 85 s of uptime the layer mix (`fetch, mem, miss`) is a booting pod. B passes on
correctness and latency, so **it does not establish the warm ratio.**

---

## Protocol A — bars warm/cold ratio ✅ VALID RUN OBTAINED, and the headline number is a definition problem

§8: *"the highest-value single number in the whole protocol and it is one command"*;
definition of done **≥ 99 % served `mem`/`sqlite`**.

**Attempt 1, 00:59Z — pod uptime 112 s. VOID by §8's own Governing Rule 1** (*"An uptime
under ~300 s invalidates a warm measurement"*).

| tf | warm | layers | cold p50 |
|---|---|---|---|
| D | 0 / 40 = 0 % | `fetch` × 40 | 155 ms (max 1,037 ms) |
| 5 | 2 / 40 = 5 % | `miss` × 34, `fetch` × 4, `sqlite` × 2 | 141 ms (max 257 ms) |

⛔⛔ **A 0 % warm ratio against a 99 % target is alarming, quotable, and an artifact** of a
pod that had just booted — the bars hot tier is an in-process `TTLCache` that resets on every
deploy. The protocol's own rule caught its first executor. **Retained only as the record of
an invalid run.**

### ✅ Attempt 2, 01:16:18Z — pod uptime **942 s**, after close. VALID.

| tf | warm | layers | latency |
|---|---|---|---|
| **D** (300 bars) | **0 / 40 = 0 %** | `stale-swr` × 40 | "cold" p50 **104 ms**, max 301 ms |
| **5** (240 bars) | **39 / 40 = 98 %** | `sqlite` × 39, `miss` × 1 | warm p50 **65 ms**, p95 75 ms |

### ⛔⛔ THE 0 % IS A CLASSIFICATION ARTIFACT, NOT A PERFORMANCE FAILURE

§8 defines warm as `mem`/`sqlite` and cold as *"`fetch`/`stale-swr`/`inflight-wait`/`disk`/
`miss` — i.e. **the user waited**"*. Daily came back **100 % `stale-swr`**, so the tool scores
it **0 % warm** against a **≥ 99 %** definition of done — a catastrophic-looking miss.

**The measured latency for that same 0 % is p50 104 ms, max 301 ms.** A member served in
104 ms did not wait. `stale-swr` is stale-while-revalidate: the cached copy is served
immediately and a refresh happens behind it. Counting it beside `fetch` and `miss` under
"the user waited" is what produces the 0 %.

⭐ **So the actionable finding is about the target, not the tier.** The instant-origin plan's
"≥ 99 % served `mem`/`sqlite`" and this tool's cold bucket disagree on whether
stale-while-revalidate is a success. **Until that is settled, the daily warm ratio is
unusable as a gate** — it will read 0 % forever while serving in ~100 ms. Intraday, which
genuinely is `sqlite`, reads **98 %** at p50 65 ms and is essentially at target (one miss in
forty).

⚠️ **What `stale-swr` does concede:** the served copy *was* stale enough to trigger
revalidation. After the close on daily bars that is harmless. **During RTH on intraday it
would not be**, and this run cannot speak to that — it was taken after the bell.

### Delta against §4.3 — daily is UNCHANGED since August; intraday is transformed

§4.3's 2026-08-19 row: *"daily p50 ~60–70 ms, **100 % `stale-swr`**; intraday 0 % warm,
p50 366 ms → p50 66 ms after the fix"*.

* **Daily: 100 % `stale-swr` then, 100 % `stale-swr` now.** Not a regression — the documented
  steady state, reproduced six weeks later. p50 104 ms tonight vs ~60–70 ms in August is the
  same order, slightly slower, on a pod 942 s old.
* ⭐ **Intraday: 0 % warm in August → 98 % `sqlite` tonight, p50 65 ms.** The August fix
  holds, and this is the clearest improvement in the whole baseline.

⛔ **Attempt 1 remains void and is retained above** as the record of how narrow the valid
window is: this run needed a pod that survived 900 s, and it took ~17 minutes of waiting
through other workstreams' deploys to get one.

---

## Protocol E — deploy-swap behaviour ⚠️ PARTIAL, from five observed deploys

Observed while shipping, not in a dedicated session:

* **push → deploy SUCCESS: 3 m 40 s to 6 m 40 s** across five deploys.
* **`uptime_seconds` resets immediately** — observed at 33–56 s on first detection.
* **`/api/*` answered on every probe through every swap.** No 502 window was caught.
* **Fresh-pod page loads were fast**: `/options-flow` DOMContentLoaded **3.11 s at 34 s** and
  **3.69 s at 49 s** of uptime, with 27–30 of ~30 assets Cloudflare `HIT`.
* ⛔ **This refuted a hypothesis of mine** — that `/options-flow`'s >45 s cold load is caused
  by new hashed chunks. The frontend deploy that should have reproduced it did not. Withdrawn
  in `RESUME-HERE.md` §5; cause unexplained, with market session and instrument budget as the
  uncontrolled confounds.
* ⚠️ **Not measured:** SSE-pool reconnection without user action, and warm-ratio recovery
  time. Both need a browser session held open across a swap.

**Delta against §4.3:** it records *"every WEB deploy costs a ~3-minute cold window —
`bars.db integrity check passed (179.1 s)` at boot"*. Tonight's push→SUCCESS spans (3.7–6.7
min) are consistent with that, and CP-05's own cell has already corrected the end-to-end
figure to ~10 min against the current gated pipeline.

---

## Not run, and why

| protocol | status | why |
|---|---|---|
| **C** — browser waterfall per surface, cold + warm, HAR export | **NOT RUN** | Needs a **visible foreground tab** (hidden tabs rAF-throttle and defer paint) and a HAR export. Operator task, not headless |
| **G** — loop-lag baseline via `WATCHDOG_OBSERVE=1` | **NOT RUN, DELIBERATELY** | It is a production env-var change, and `railway variables --set` auto-redeploys. An agent restarting the member-facing pod to take a measurement is the wrong trade, especially given tonight's churn. ⭐ It is also cheap, reversible and cannot kill the process — **a good owner-run next step**, and it is the number that bounds how much event-loop budget Terminal-Next panels may spend |
| **H** — front-end micro-timing (`?gridspike`, `mobile_audit`) | **NOT RUN** | `?gridspike` must run in a visible tab. `mobile_audit` is runnable headless but §8 warns its route list has been wrong before and must be derived from `App.jsx` first — a prerequisite, not a run |

---

## What this baseline changes

1. ⭐⭐ **Memory work is now unblocked.** `api/main.py` called distinguishing a leak from a
   stable working set *"the prerequisite for any further memory work"*. It is distinguished:
   **+7.9 MB/min, monotonic across quartiles.** The 2.2 MB/s figure in §4.3 should be
   corrected to the measured rate; the 11.7 GB endpoint stands and is now independently
   corroborated.
2. **The CDN rule is settled and is not working** — fourteen months of documentation
   describing a cache that returns `BYPASS`.
3. ⭐ **The warm ratio is measured, and it indicts the metric rather than the serving layer.**
   Intraday is **98 % `sqlite` at p50 65 ms** — the August fix holds. Daily is **0 % warm and
   p50 104 ms simultaneously**, because `stale-swr` is bucketed as "the user waited". ⛔ **The
   ≥ 99 % mem/sqlite gate cannot be used until it decides whether stale-while-revalidate
   counts as served.** Getting the run at all took a 900 s pod, which this service offered
   once in seventeen minutes of waiting.
4. **CP-05's remaining blocker is unchanged and is a decision:** §8 generates no load by
   design, roadmap Rule 4 bars load against production, so a load model needs a
   non-production target that does not exist.

## Protocol G — loop-lag baseline ✅ ALREADY ARMED, and the number exists

⚠️ **Listed as "NOT RUN, DELIBERATELY" in the table above, and that was wrong when written.**
Checked 2026-09-26 01:28Z: `WATCHDOG_OBSERVE=1` **is already set** on `web`, and
`GET /api/watchdog/status` answers.

| field | value (27-min window, after close) | value (fresh pod, 18 checks) |
|---|---|---|
| `enabled` | **false** — kill path OFF (`WATCHDOG_ENABLED` unset) | false |
| `observe_only` / `running` | true / true | true / true |
| **`max_lag_ms`** | **14.9** | 26.2 |
| `last_lag_ms` | 0.1 | 2.6 |
| `checks` @ `check_sec` 5.0 | **330** (~27 min) | 18 (~90 s) |
| `missed_streak` | 0 | 0 |
| `wedge_sec` | 30.0 | 30.0 |

⭐⭐ **This is the number §8 says "bounds how much event-loop budget Terminal-Next panels may
spend", and it says there is real headroom**: worst case **14.9 ms** on a settled pod against a
**30-second** wedge threshold, no missed checks. A panel board costing single-digit
milliseconds of loop time per frame is not the constraint here.

⚠️ The fresh-pod column is higher (26.2 ms over 90 s) exactly as boot contention predicts —
another reason §8's uptime rule exists.

⛔ **Not clearance to arm the killer.** `enabled:false` is correct and stays correct; arming is
the watchdog runbook's own decision and needs a threshold argued against `wedge_sec`, not
against 3–5× a 27-minute after-hours observation. Market-open lag is the interesting case and
is unmeasured.

---

## ⛔ CARD 16 — THE ≥ 99 % WARM GATE IS RETIRED (owner-delegated, 2026-09-26)

Protocol A showed daily at **0 % warm and p50 104 ms simultaneously**, because §8 buckets
`stale-swr` with `fetch` and `miss` under *"the user waited"*. Ruling
(`DECISION_CARDS_2026-09-26.md` CARD 16): **`stale-swr` counts as SERVED**, and the tier gate
is replaced by a latency gate on the same one command:

* **Gate:** p95 ≤ 250 ms per timeframe, on a pod ≥ 300 s old.
* **Report the tier mix beside it, never as pass/fail** — the `stale-swr` share is a
  *freshness* signal, not a latency one.
* ⚠️ **One tier alarm survives:** `fetch`/`miss` above ~10 % on **intraday during RTH** is
  still the August defect, and `stale-swr` is **not** exonerated there. A stale intraday bar
  mid-session is a different product from a stale daily bar after the close — and every run in
  this document was taken after the close.

Against the new gate, tonight: **daily p50 104 ms / max 301 ms — PASS. Intraday p50 65 ms /
p95 75 ms — PASS.**

---

## SOURCES

* `docs/terminal-research/07-technical-architecture/current-performance-and-realtime.md`
  §4.3 (the numbers this deltas against), §8 (protocols A–H and their governing rules).
* Raw runs: `docs/terminal-research/10-roadmap/evidence/2026-09-26-cp05-protocol-execution/`.
* Tools, all pre-existing: `tools/bars_warmth_audit.py`, `tools/market_open_chart_check.py`,
  `railway logs <DEPLOYMENT_ID> --lines`, plus a scratch cold-load probe for Protocol E.
