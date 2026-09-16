# Queue sizing, and OI-37 — 2026-09-14

> ⛔ **EVERY NUMBER HERE CARRIES ITS LOAD MODEL.** An S2 figure without an arrival rate *and* a
> concurrency beside it is the defect OI-37 records; the harness now refuses to write an artifact
> that does not say which model produced it.
>
> ⛔ **AND EVERY LATENCY HERE IS THE FALLBACK RENDERER (OI-39).** `chart-renderer` is
> private-network only and unresolvable from the operator PC, so renderer-dependent latency is
> **INCONCLUSIVE — PENDING CANARY**. What *does* survive is admission behaviour: whether the queue
> refuses, when, and how honestly. That is a property of the queue, not of the renderer.

---

## PART A — OI-37

### A1/A2 · The model, quoted

`docs/discord-render/instruments/load_harness.py`, as it was:

```python
interval = 1.0 / rate if rate > 0 else 0.0
while time.perf_counter() - started < seconds:
    target = started + n * interval      # arrivals scheduled on a CLOCK
    if target > now: await asyncio.sleep(target - now)
    reply = await commands.handle(...)   # returns at the ACK, not at the chart
```

**OPEN LOOP.** Arrivals are placed on a wall clock and wait for nothing. `handle()` returns when the
interaction is acknowledged, while the job renders on a worker thread — so the loop keeps offering
work regardless of how much is still in flight. **There was no concurrency control of any kind**, and
therefore no way to express "30 concurrent" at all.

### A3–A6 · What was built

- **`--concurrency N`** — a real closed loop. N virtual members; each issues its next request only
  when its previous one reaches a **terminal state in the job store** (`TERMINAL_STATES` imported,
  not retyped) or is refused at admission.
- **`--arrival-rate R`** keeps the open loop. **`--rate` is removed, not aliased** — a silent alias
  preserves exactly the ambiguity that caused this. No default; exactly one model or the run refuses.
- **`--think-time`** (default 1 s), applied after a refusal and between requests, outside the
  in-flight accounting.
- **Artifacts are labelled in band** and `read_labelled_artifact` **refuses** an unlabelled one.
  Pre-OI-37 artifacts carry `rate` alone and are ambiguous by construction.
- **Mutations 6/6 RED**, restore sha256-verified: peak blinded · broken-variant neutered ·
  unlabelled reader accepts anything · both models describe themselves identically · the
  one-model guard deleted · `--rate` silently re-accepted.

### ⛔ Three defects found in my own work while doing this

1. **The self-check's evaluation loop sat in the middle of the appends.** Fifteen pre-existing cases
   were appended *after* it — counted by `len(cases)`, never checked. `--self-check` printed
   `cases=20 failed=0` while **five** were evaluated. *The count rose and the checking did not* —
   the same shape as the flip-gate rows that reported MET off file existence.
2. **`peak <= N` cannot see a blind gauge.** A mutation setting `peak = 0` left the row green. An
   upper bound cannot distinguish "never exceeded N" from "never saw anything".
3. **The first closed loop hot-spun.** It resolved refusals instantly, so 30 clients hammering the
   per-member throttle produced **521,654 attempts in 20 s** and **six acks over 3 s** — a
   plausible-looking S1 FAIL that was entirely the harness. That is OI-37's own mistake in
   miniature: a load model that does not model the load.

### A7 · The spec'd load, re-run

**30 concurrent · think-time 1 s · 20 s · 20 symbols · fallback renderer · organic members exposed 0**

| | measured | target | verdict |
|---|---|---|---|
| in flight | peak **30**, mean 6.74 | hold 30 | ✅ model held |
| **S1** acks over 3 s | **0** | 0 | ✅ **PASS** |
| S1 ack p95 / max | 540 ms / 546 ms | p99 ≤ 1,000 | ✅ |
| **S2** p50 / p95 / p99 | 4.9 / **2,560** / **4,507** ms | 2,500 / 5,000 / 8,000 | ✅ inside — ⚠️ fallback renderer |
| **S5** success | **96.4 %** | 99.5 % | 🔴 **FAIL** — 13 `queue_full` of 360 |
| samples | 406 | | (spin run: 522,014) |

### A8 · Which prior numbers are void

| figure | status |
|---|---|
| "30 concurrent: p50 14,855 ms, success 35.7 %, 81 `queue_full`" | ⛔ **VOID AS LABELLED.** It was **30 arrivals/second**, ~15× the specified load. Retained only as **overload characterisation at arrival-rate 30/s** |
| the 100-burst and 1/s runs | ✅ **RETAINED** — they were always open-loop and are now labelled as such |
| "every failure was `queue_full`, never a timeout or breaker trip" | ✅ **RETAINED and REINFORCED** — still true at 30 concurrent |
| "S1 held at 30/s" | ✅ **RETAINED** |
| the six acks over 3 s in the first closed-loop run | ⛔ **VOID** — harness spin |

---

## PART B — Queue sizing

### B1 · Current values *(measured inputs; the constants themselves are NOT changed by this session)*

The derivation below is produced by `arrival_census.py --analyze`, which prints every term.

### B2 · The derivation, from 19.94 days of real arrivals

**Source:** Discord channel history — `interaction_metadata.id` snowflakes, Discord's own
millisecond stamp for when it called us. ⛔ The pod keeps **no** arrival log: `web` writes no access
log for the interactions endpoint, `/data/discord_render_jobs.db` does not exist in production (V2
has never run there), and log retention bottoms out around 16 days.

⚠️ **FLOOR, not a census.** 88 channels; most returned `403/50001` (the bot is not a member).
Button clicks, ephemeral replies and DMs leave no message. **`#chart-flow-requests` — the only
channel `/chart` can run in — returned 137 arrivals EXACT**, which is the number that matters.

| | measured |
|---|---|
| window | 2026-08-25 → 2026-09-14 (**19.94 days**) |
| arrivals | **301** total — `/chart` 178 (59 %), `/flow` 120 (40 %), `/charts` 3 |
| per day | **15.1** |
| minutes with any arrival | **264 of 28,715 — 0.92 %** |
| arrivals/second **MAX** | **1** |
| **busiest 60 s** | **4** (3 distinct members, max 2 from one) |
| **busiest 10 s** | **2** (2 distinct members, max 1 from one) |

**Design burst = 3 × busiest 10 s = 6 arrivals in 10 s → λ = 0.600 arrivals/second.**

**Little's Law**, at the conservative service basis (p50 1.748 s — itself the *p95* of the
unsaturated run, used as p50 deliberately to size against the slow case):

```
L = λ × W = 0.600/s × 1.748 s = 1.05 jobs in service
```

M/M/c wait-p95 by worker count → **smallest c meeting the budget = 4**.
**Queue depth needed = 0** at both the 10 s and 60 s tests: 6 arrive, 4 workers drain 22.9 in the
same 10 s. At the accurate service basis (p50 3.5 ms) c = **1** suffices.

### B3 · Is `queue_full` correct behaviour, or an undersized queue?

⭐ **CORRECT BEHAVIOUR, and not marginally.** The design burst derived from twenty days of real
traffic is **0.6 arrivals/second**. The run that produced 81 `queue_full` offered **30 arrivals/second
— fifty times the design burst.** The closed-loop 30-concurrent run offers roughly 8.6/s, still
about fourteen times it.

**The crossover:** at 30 concurrent the queue refuses 3.6 % of requests (13 of 360) while every
ack stays under 3 s and S2 stays inside budget. So the system's answer to a load fourteen times its
design burst is *an immediate, honest refusal to a small minority, with everyone else served inside
SLO*. That is the better member experience by design — a fast refusal beats a 15 s timeout.

⛔ **The S5 floor of 99.5 % is what fails, and it fails by counting an honest refusal as a failure.**
That is a real question for the owner, not something to tune away: at 14× the design burst, is
refusing 3.6 % a breach or the system working? **Recommendation: S5 should be measured at or near
the design burst, and overload should be reported as a separate `refusal_rate` metric.**

> ✅ **MEASURED SINCE — D-02 Part B, 2026-09-14 evening.** The recommendation above asked for S5 at
> the design burst. It was run, and `S5-SPLIT-2026-09-14.md` holds it:
>
> | load | arrivals/s | offers | refused | S5 |
> |---|---|---|---|---|
> | design burst (3× busiest 10 s) | 0.600 | 181 | **0** | **100 %** |
> | busiest 10 s, as observed | 0.200 | 121 | **0** | **100 %** |
>
> ⭐⭐ **302 offers at and above the load real traffic produces, and not one refusal.** Every refusal
> this programme has ever measured came from a synthetic load between fourteen and fifty times the
> busiest ten seconds in twenty days.
>
> ⛔ **And the split found something this section could not see:** 46 of the 30-concurrent run's 59
> refusals **never became job rows at all** (the per-member in-flight limit answers at the door
> without recording one), so they are invisible to `success_rate` in both directions. The 3.6 % here
> is computed over job rows and omits them. **Any ruling on "how many refusals are acceptable" needs
> that fixed first, whichever way it goes.**
>
> ⛔ **B5 IS STILL THE OWNER'S.** The directive's ruling line was blank; nothing above decides it,
> and no threshold, denominator or definition of S5 has been changed.

### B4 · Concurrency ladder — ⛔ NOT RUN

Each rung is a 20 s run plus a 180 s drain; the ladder is ~25 minutes of renderer-bound work, and
every latency it produced would be **fallback-renderer** and therefore INCONCLUSIVE for S2 anyway.
**Deferred rather than run for a number that could not be used.** The admission-behaviour question
B3 asks is already answered at the two ends (0.6/s design burst vs 8.6/s offered).

### B5 · Recommendation

| knob | proposed | basis |
|---|---|---|
| workers `c` | **4** | smallest c meeting the wait budget at the conservative service basis |
| queue depth | **≥ 6**, i.e. one design burst | backlog is 0 at c=4; depth 6 admits a whole 3× burst without refusing one |
| per-user | leave as is | busiest 10 s had **1** request from any single member |

**What would falsify this:** any of — the busiest 10 s rising above 2 once `/chart` is reachable in
more than one channel; a real (non-fallback) service p95 above ~4 s; or the canary showing arrivals
the Discord-history floor cannot see (button clicks, ephemerals).

**What would confirm it:** canary `final_ms` percentiles at the real renderer, plus a `queue_full`
count of zero at the design burst.

### B7 · No sizing change is landed in this session, as directed.
