# CP-05 §8 protocol — first execution, 2026-09-26 ~00:59Z (20:59 ET, after close)

`07-technical-architecture/current-performance-and-realtime.md` §8 proposes six protocols
(A–F) for measuring Terminal-Current's baseline, and opens with *"This is a protocol for a
later role to execute. **Nothing below was run.**"* This is the first execution.

⛔ **CP-05's status cell said "no load model yet", which is true but reads as "nothing
exists".** What exists is a complete six-part protocol (§8, ~110 lines, existing tools only,
read-only, no new dependencies) that had never been run. The gap was **execution**, not
authorship — a distinction worth making before anyone writes a second protocol beside the
first.

Run against **production**, read-only, browser UA, after the close. Nothing was run *on* the
pod (§8 Governing Rule 2).

---

## Protocol D — CDN reality check ✅ EXECUTED, AND IT SETTLES §3.3

§8 called this *"the cheapest high-value measurement here"* and said it *"settles §3.3's open
question — whether the documented Cloudflare rule was ever applied"*. Three requests:

| request | `cf-cache-status` | `age` | `content-type` |
|---|---|---|---|
| `/api/flow/data?days=1` (1st) | **BYPASS** | — | `application/json` |
| `/api/flow/data?days=1` (2nd, +4 s) | **BYPASS** | — | `application/json` |
| `/api/flow/data?days=20` | **BYPASS** | — | — |

**ANSWER: the documented edge-cache rule is NOT in effect on this endpoint.** §8 defined the
success signal as `MISS → HIT` with a non-null `age`; what came back was `BYPASS` on every
request, which is neither. Nothing is being served from Cloudflare's cache here, so the
`days=20`-shares-the-`days=1`-entry hazard §8 worried about **cannot arise** — there is no
entry to share.

⚠️ **What this does NOT say.** `BYPASS` does not distinguish *"a Cloudflare rule explicitly
bypasses this path"* from *"the origin sends `Cache-Control: private/no-store` and Cloudflare
is obeying it"*. Both produce this header. Which one it is decides whether the fix is a
dashboard rule or a response header, and that is one `curl -D -` on the origin's own
`cache-control` away — not attempted here because §8 Rule 4 says to probe this endpoint
sparingly.

⭐ Also incidentally confirmed: `content-type` is `application/json` with a 200, so this was
a real response and not the `retry-after: 60` HTML challenge §8 Rule 4 warns about.

---

## Protocol A — bars warm/cold ratio ⛔ RUN, AND INVALID BY THE PROTOCOL'S OWN RULE

§8 calls this *"the highest-value single number in the whole protocol and it is one
command"*, with the instant-origin plan's definition of done at **≥ 99 % served
`mem`/`sqlite`**.

**First attempt, 00:59Z — pod `uptime_seconds` = 112.**

| tf | warm | layers | cold p50 |
|---|---|---|---|
| D | **0 / 40 = 0 %** | `fetch` × 40 | 155 ms (max 1,037 ms) |
| 5 | 2 / 40 = 5 % | `miss` × 34, `fetch` × 4, `sqlite` × 2 | 141 ms (max 257 ms) |

⛔⛔ **THIS RESULT IS VOID, AND REPORTING IT AS A FINDING WOULD HAVE BEEN THE ERROR THE
PROTOCOL EXISTS TO PREVENT.** §8's Governing Rule 1 says in its own words: *"An uptime under
~300 s invalidates a warm measurement."* The pod was **112 seconds old**. The bars cache's
hot tier is an in-process `TTLCache` that resets on every redeploy, and the boot warmers had
not finished — so `0 % warm` measures *a pod that had just booted*, not the serving layer.

⭐ **A 0 % warm ratio against a 99 % definition of done is exactly the kind of number that
would have travelled**: it is alarming, it is quotable, and it is an artifact. The protocol
anticipated it, and the protocol caught it. **A re-run at uptime ≥ 900 s is in flight; only
that number may be quoted.** The table above is retained solely as the record of an invalid
run, which is itself a finding about how narrow the valid window is on a pod that redeploys
several times a day.

⚠️ **And it makes a structural point for CP-05 rather than a defect claim:** this measurement
is only meaningful in the gaps between deploys, and tonight there were four deploys in about
ninety minutes. A capacity protocol whose headline number is invalidated by any deploy in the
preceding five minutes needs its window stated as a precondition, which §8 does — and the
first person to run it still tripped over it.

---

## Protocol B — full chart-surface matrix ✅ EXECUTED, 0 FAIL / 11 checks

`tools/market_open_chart_check.py`, 01:02Z, after close — which §8 calls *"the weekend-safe
baseline it was written against"*. Pod uptime 85 s.

| check | result |
|---|---|
| health | PASS — 200 in **136 ms**, `wire_date=2026-09-25` |
| latency: all 200 | PASS — 8/8 |
| latency: warm server-compute | PASS — warm max **12.6 ms**; layers seen `fetch, mem, miss` |
| weekly dedup MSTR / AAPL | PASS — 200 bars each, **0 dup-weeks, 0 non-Friday keys** |
| bar sanity AAPL/D, NVDA/5 | PASS — 300 bars each, **0 bad-OHLC, 0 future-dated** |
| live-bar liveness | ⚠️ **WARN — skipped, market closed.** The tool says run again during RTH |
| push-stream (Phase C) | PASS — `ws_connected=True`, subscribers 0, emitted 0, drops 0 (correct with the market shut) |
| accuracy: daily drift monitor | PASS — `detect_only_drift_count=0`, healed 0 |
| deep intraday (20k bars) | PASS — 200, `layer=sqlite`, server **407.9 ms**, total **590 ms**, 1.42 MB |

**`0 FAIL / 11 checks`.** The one WARN is the market being closed, which is the honest state
of a liveness check after the bell and not a defect.

⚠️ **Read the layer mix, not just the pass.** `layers seen: fetch, mem, miss` at 85 s of
uptime is the same freshly-booted pod that voided Protocol A — B passed because its criteria
are correctness and latency, not warm ratio. **The one thing this run does NOT establish is
the warm ratio**, which remains Protocol A's job.

⭐ Two numbers worth carrying into any performance architecture: the deep-intraday path
answers a 20,000-bar request in **590 ms total off `sqlite`** (§8 expected a slow first
fetch), and warm server-compute is **12.6 ms** at its max across eight surfaces.

## Protocol E — deploy-swap behaviour ✅ OBSERVED ALL EVENING, incidentally

§8 Protocol E asks for an observed deploy: how long `/api/*` is unavailable, whether SSE
pools reconnect, how long until `uptime_seconds` resets, how long until Protocol A's warm
ratio recovers. Four deploys were watched tonight while shipping other work
(`d69ce8adf`, `a700d89f8`, `5bad63301`, `4885dadc2`, `bfac72d61`), and the following is
recorded from those watches rather than from a dedicated session:

* **Deploy record → SUCCESS** ran 3 m 40 s to 6 m 40 s (e.g. `bfac72d61` pushed 00:52:36Z,
  SUCCESS observed by 00:58Z; `d69ce8adf` pushed 19:08:21Z, SUCCESS 19:15:53Z).
* **`uptime_seconds` resets to < 60 s at the swap** and was observed at 33–56 s on first
  detection, so the reset is effectively immediate on SUCCESS.
* **`/api/*` served throughout every watch** — the health probe and the authenticated
  smoke-account reads answered on every attempt; no 502 window was caught on any of the five.
* **Page loads on a fresh pod were fast in all four measured cases** — 3.11 s and 3.69 s
  DOMContentLoaded on `/options-flow` at pod ages 34 s and 49 s. ⛔ This is the measurement
  that **refuted** RESUME-HERE §5's "new hashed chunks" narrowing; see that section for the
  withdrawal.
* ⚠️ **Not measured:** SSE pool reconnection without user action, and warm-ratio recovery
  time. Both need a held-open browser session across a swap, which none of tonight's watches
  had. That is the honest remainder of Protocol E.

---

## What CP-05 still needs, precisely

1. **Protocol A at uptime ≥ 900 s** — in flight. This is the ≥ 99 % number.
2. ✅ **Protocol B is DONE for the after-close half** (0 FAIL / 11, above). What remains is
   the **09:45 ET market-hours pass**, which is the only way to clear its one WARN —
   live-bar liveness, the "frozen chart" regression class — and to read the push-stream
   with real subscribers.
3. **Protocol C** — browser waterfall per surface, cold and warm, with a HAR export. Needs a
   visible foreground tab, so it is an operator task, not a headless one.
4. **Protocol F** — capacity telemetry off the pod's own `[mem] rss_mb=… threads=…` line.
5. ⛔ **A LOAD model remains genuinely absent, and §8 does not provide one by design** — it
   *"generates no load beyond a handful of ordinary page views"*, and the roadmap's Rule 4
   bars running load against production. So CP-05's *"no load model yet"* is accurate, and
   closing it needs a non-production target, which does not exist yet either. **That is the
   real remaining blocker on CP-05, and it is a decision (where to run load), not a
   measurement.**

---

## Protocol F — capacity telemetry ✅ EXECUTED, and it answers the memory question

24 h is unreachable from one deployment when the median pod lives 26 minutes, so this used the
**longest-lived deployment available**: `5bad63301`, 104 minutes (19:37→21:21Z), via
`railway logs <DEPLOYMENT_ID> --lines 5000`.

**76 `[mem]` samples. Quartile medians 2,429 → 2,746 → 2,956 → 3,028 MB. Net +599 MB over
~76 minutes = +7.9 MB/min. Threads min 41 / median 124 / max 178 — the 200 burst threshold
was never reached.**

⭐⭐ **ANSWER: a leak, not a large-but-stable working set** — which `api/main.py:3639-3644`
calls *"the prerequisite for any further memory work"*. It **refutes §4.3's 2.2 MB/s rate by
~17×** and **corroborates its 11,665 MB long-lived endpoint almost exactly** (7.9 MB/min ×
1,440 min ≈ 11.4 GB). ⚠️ `n = 1` deployment, after the close; it does not identify what leaks.

⚠️ A separate 5-sample read on a 5-minute-old pod showed 1,862–2,023 MB and was
**flat-to-declining** (1,980 → 1,905). A 5-minute window cannot see this leak — which is
exactly why §8 asks for 24 h.

⛔ **Two instrument bugs of my own, both in CLAUDE.md already.** The first parse read
`/tmp/podlogs.txt`, which Git Bash and Windows Python resolve differently, so bash found the
file and Python did not. The second piped JSON into a script that was itself a heredoc, so
stdin carried the script and not the data. Both are recorded because each produced a clean,
confident, empty result.

---

## THE DELIVERABLE

§8 names its own output: *"A dated `docs/perf-baseline-<YYYY-MM-DD>.md` with one table per
protocol, the session/uptime context for every row, and an explicit delta against §4.3's
numbers."* Written: **`docs/perf-baseline-2026-09-26.md`**. It carries A, B, D, E and F with
their validity state, the three protocols not run with reasons, and the §4.3 deltas.
