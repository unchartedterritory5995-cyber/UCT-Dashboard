# W2b — the first OI-44 attribution attempt with REAL log coverage

**Why this is different from every prior W2b attempt:** `UCT-D14-LogTail` (D-18 addendum item 1)
has been running continuously since ~11:22Z today. For the first time, a set of real production
stalls fall entirely inside a captured log window — no race to grab logs before the pod cycled
out. 12 stalls, 2026-09-18 11:38Z–13:05Z, all aligned against `evidence/logs/web-2026091{8}-{11,
12,13}.log` (74,425 timestamped lines) via `oi44_align.align()`.

⛔⛔ **CANDIDATES, NEVER A CAUSE — the tool's own words, and this doc keeps them.** A blocked loop
cannot log; a stall is a silence bounded by two ordinary lines, and every job running across it is
*consistent* with it, not *proven* to be it.

## The honest correction, kept because it is the lesson

The first pass at this doc read the tool's truncated `during` sample (6 lines, "127 more line(s)
inside the window") and reported `ticker_meta` disk-write failures as a leading candidate for the
11:51:56Z/22.9s stall, because that was what the truncated sample happened to show first. A full
count of the window (133 lines) found `api.routers.calendar` dominant (50 lines), `ticker_meta`
only 10. **This is the "read the call site, not the wire" mistake, caught before publishing it** —
the tool's truncated display is for a human skimming, not a distribution.

## What the FULL window counts actually show

| stall (at, ms) | window lines | dominant logger(s) |
|---|---|---|
| 11:38:47Z, 25,647.8ms (largest single-cycle) | 237 | `apscheduler.executors.default` **170/237** — see below, REFUTED as a candidate |
| 13:04:40Z, 26,687.4ms (largest) | 99 | `apscheduler.executors.default` 50/99 — see below, REFUTED as a candidate |
| 11:51:56Z, 22,946.3ms | 133 | `api.routers.calendar` 50/133, `apscheduler` 22/133 |
| 11:52:03Z, 4,018.0ms | ~373 | not fully broken down — `catalyst.engine`/`curator` prominent |
| 12:11:04Z, 3,114.1ms (PAGED) | small | `apscheduler` job entries, ends near a 54,948-row `data_sync` delta |
| 12:11:31Z, 1,214.7ms | small | `massive_ws_worker`/`liveflow_worker_threaded` **stop()**, `Scheduler has been shut down` — this is a DEPLOY/shutdown sequence, not a live-traffic stall |
| all others (5680/3471/2122/1002/4413ms) | small | apscheduler cron-boundary lines in `before`, no single dominant service |

## The apscheduler hypothesis — RAISED, then KILLED by its own control

A re-count against the exact log timestamps (not the tool's abbreviated sample) found
`apscheduler.executors.default` dominant in the two largest stalls' windows: **170/237 lines**
(11:38:21–47Z) and **50/99 lines** (13:04:13–40Z) — roughly 50–70% of everything logged in each
window. Before writing that up as a candidate, the required control (named as missing in the first
version of this doc) was run: the SAME logger-distribution count against **five ordinary,
non-stall 26-second windows**, spread across the whole captured span:

| window (26s) | total lines | apscheduler lines | apscheduler share |
|---|---|---|---|
| 11:25:00–26 | 209 | 132 | 63% |
| 11:45:00–26 | 213 | 118 | 55% |
| 12:00:00–26 | 564 | 198 | 35% |
| 12:30:00–26 | 948 | 423 | 45% |
| 12:50:00–26 | 448 | 178 | 40% |

**The control refutes the hypothesis.** apscheduler is the dominant logger in ordinary,
non-stall traffic too, at the same 35–65% share the stall windows showed. This is what a busy
pod's log stream looks like all the time, not a signal that correlates with a stall. ⛔ **This is
exactly the trap `oi44_align.py`'s own caution names** — every job running across a stall window
"is consistent with it," and the control is what turns "consistent with" from a candidate into
nothing. apscheduler-dispatch-as-cause is retracted, not softened.

## A real, separate finding: APSCHEDULER'S JOB NAMES HAVE BEEN INDISTINGUISHABLE SINCE 2026-08-29

While building the control above, every single apscheduler log line — across all 12 stalls and
every control window — named the SAME job: `"instrument_scheduler.<locals>.add_job.<locals>.wrapped
(trigger: ...)"`. That is not one very busy job; it is every scheduled job in the process (~135 of
them, per `memory_probe.py`'s own comment) reporting under one identical, generic name.

**Root cause, traced to source, not guessed:** `api/services/memory_probe.py::instrument_scheduler`
(shipped 2026-08-29, still live, `api/main.py:4992`) wraps `scheduler.add_job` so every job's RSS
delta can be attributed. Its inner `wrapped` function resets `wrapped.__name__` to the real job's
name (`memory_probe.py:183`) — but **APScheduler's own `get_callable_name` (`apscheduler/util.py`)
reads `func.__qualname__`, never `__name__`**, for a plain function. `__qualname__` is never reset,
so it stays whatever Python assigned a function nested three scopes deep:
`instrument_scheduler.<locals>.add_job.<locals>.wrapped` — identical for every job, forever, since
the day this instrumentation shipped. `api/services/screener/contention_trace_temp.py`'s own
`instrument_scheduler` (added 2026-09-05, wraps `add_job` a second time) has the exact same bug,
compounding the effect rather than fixing it.

**Why this matters here and is worth recording rather than silently working around:** it is the
literal reason "drill into the specific apscheduler job name" — the natural next step after the
control above — is not answerable from these logs at all. Every apscheduler `Running job` / `Job
... executed successfully` line in this repo's logs, since 2026-08-29, carries the SAME name
regardless of which of ~135 registered jobs actually ran; only the `trigger:` clause (interval vs.
cron, and the cron's own hour/day-of-week spec) distinguishes anything, and several distinct jobs
share the same trigger shape. **Not fixed here** — `memory_probe.py` and `contention_trace_temp.py`
are both live, shared, actively-used diagnostic tools with their own owners and their own explicit
scope (one is a documented-temporary screener probe with its own removal note); this doc records
the mechanism precisely so whoever next needs per-job attribution from these logs does not spend an
hour rediscovering it. The one-line fix, for whoever picks this up, is `wrapped.__qualname__ =
getattr(func, "__qualname__", "job")` beside the existing `__name__` reset, in both files.

**One stall (12:11:31Z) is very likely NOT a live-traffic loop stall at all** — its surrounding
lines (`massive_ws_worker: stop()`, `liveflow_worker_threaded: stop()`, `Scheduler has been shut
down`, `cache_snapshot saved`) are a clean deploy/shutdown sequence. A 1.2s "stall" recorded during
process teardown is a different class of event than one recorded mid-session, and future counts
of "stalls/day" should consider excluding shutdown-adjacent ones or tagging them separately.

## What this does NOT settle

- Whether apscheduler job dispatch is EVER the actual cause of the loop being blocked in some OTHER
  window not sampled here — the control tested 5 windows, not all of them; but "dominant in the two
  biggest stalls" is no longer evidence for it, since it is equally dominant off-stall.
- The `api.routers.calendar` / catalyst-engine prominence in two mid-sized stalls — UNTESTED against
  a control, unlike apscheduler. Do not treat it as more credible than apscheduler was before its
  control ran.
- Anything about `flow-worker`'s side, not analyzed in this pass (this correlation used only the
  `web` log; flow-worker's OPRA-tape stalls are a structurally different question).

## Next, if this thread continues

- **The apscheduler thread is closed** — its own control killed it (above). Do not re-open it
  without a new mechanism to test, not just a bigger sample of the same count.
- **Fix the qualname bug first**, if per-job attribution ever matters again — one line in each of
  `memory_probe.py` and `contention_trace_temp.py` (above), and every future stall's `during` window
  would name the actual job instead of a generic wrapper.
- Re-run this alignment over a LARGER sample once more stalls accumulate under continuous log-tail
  coverage (the daemon is still running) — with the qualname fix in place, a per-job (not
  per-trigger-shape) distribution becomes possible for the first time.
- Anything about `flow-worker`'s side, not analyzed in this pass (this correlation used only the
  `web` log; flow-worker's OPRA-tape stalls are a structurally different question).

## 2026-09-19 — `api.routers.calendar` / `catalyst.engine` control-tested. It SURVIVES.

The honest next candidate named above has now been run through the same control discipline that
killed apscheduler — with a stronger control than the original, using data that accumulated under
continuous `UCT-D14-LogTail` coverage since this doc was first written (11:22Z 2026-09-18 through
04:07Z 2026-09-19, 805,876 timestamped `web` log lines, 16.8 hours).

**The apscheduler control used 5 hand-picked windows.** That is fine when the candidate is common
(apscheduler dominates ordinary traffic too, so 5 samples reliably land on representative ground).
It is NOT fine here: a first pass at 5 hand-picked 22.9s/4.0s windows found **zero** occurrences of
either logger in all five — which looked like a stronger refutation than apscheduler even got, but
turned out to be a coincidence of sample size, not a real baseline. `api.routers.calendar` is
**bursty**: 90% of its own inter-arrival gaps are 0.0s (it logs in rapid clusters), and it occupies
only **12.9% of all 30-second buckets** across the full 16.8-hour span. Five discrete samples had
roughly a 50% chance of hitting zero purely by that burst structure, independent of any real
correlation with stalls.

**The real control: a full sliding-window scan, not discrete samples.** Every 22.9s window across
the whole capture (12,062 windows, 5s stride) was scanned for `api.routers.calendar` share:

| | value |
|---|---|
| windows containing ANY `api.routers.calendar` line | 1,197 / 12,062 (9.9%) |
| median share, when present | 12.7% |
| windows reaching the stall's own share (37.6% = 50/133) | **110 / 12,062 (0.9%)** |

Same treatment for `catalyst.engine` at 4.0s width (21,088 windows, 2s stride, **restricted to its
own documented active hours** 11:22Z–23:05Z — it goes fully silent after 23:04Z, matching the
"5min burst pre-market + open + close + AMC" schedule this repo's own CLAUDE.md already documents,
so scanning past that would be comparing against a period the logger cannot fire in at all, which
would make it look rarer than it honestly is):

| | value |
|---|---|
| windows containing ANY `catalyst.engine` line | 199 / 21,088 (0.9%) |
| median share, when present | 40.9% |
| windows reaching the stall's own share (48.0% = 179/373) | **95 / 21,088 (0.5%)** |

**Both candidates reach the stall's own dominance in under 1% of all sampled windows across the
full day — the opposite of apscheduler's 35–65% everywhere-baseline.** This is not "consistent
with, like everything else" (the tool's own caveat about every job running across a stall window);
it is specifically rare, and the stall windows are two of the rare hits.

⛔⛔ **THE HONEST CAVEAT THAT KEEPS THIS A CANDIDATE, NOT A FINDING.** The two "mid-sized stalls"
this whole analysis rests on — 11:51:56Z (22,946.3ms) and 11:52:03Z (4,018.0ms) — are **~7 seconds
apart**: the second stall's window (11:51:58.982Z→11:52:03Z) starts barely 3 seconds after the
first one ends. These are almost certainly ONE underlying episode recorded as two consecutive
watcher samples, not two independent events. **This candidate currently rests on n=1 independent
episode, not n=2** — a single rare coincidence, even at a well-measured <1% base rate, is not proof
of correlation on its own. `api.routers.calendar`/`catalyst.engine` survives a real control in a
way apscheduler never did, which makes it the honest next candidate to carry forward — but it must
not be reported as more than that until a temporally-SEPARATE stall (not adjacent to this one)
shows the same pattern. The current live `r31-trace.jsonl` record's newest `events` array holds
only five 2026-09-17 stalls, outside this pass's captured log window (`web-2026091{8,9}-*.log`
starts 11:22Z 9/18) — **no log coverage for them, and they cannot be used to test independence.**
The next real test needs either a fresh stall inside the still-running log-tail window, or a wider
capture reaching back to 9/17.

**A mechanism exists, and it is not a new one for this codebase.** Neither `api/routers/calendar.py`
nor `api/services/catalyst/engine.py` shows blocking I/O at the lines grepped in this pass — the
actual external calls (yfinance, Twitter search, RSS, Perplexity, Anthropic synthesis) live one
layer down, in `catalyst/sources.py` and `catalyst/synthesize.py`, not traced in this pass. But this
repo's own CLAUDE.md already documents the exact outage CLASS this would be if traced further:
*"Unbounded external calls pin threadpool workers"* — the 2026-07-01 524 outage's root cause,
already fixed for `fundamentals.get_fundamentals`'s `.info` call and `dividends_calendar.get_events`
via `yf_util.bounded_call`, but not stated anywhere as fixed for catalyst-engine's own 8-source pull
(`sources.py`) or its Perplexity/Twitter enrichment calls. If catalyst-engine's refresh cycle and
calendar's enrichment path share the same anyio threadpool as everything else on this single-process
pod, a burst of unbounded external calls from either would be mechanistically capable of starving
whatever else needs a threadpool slot at that moment — a far more plausible mechanism than
apscheduler's own dispatch overhead, which is exactly why apscheduler died on contact with a control
and this candidate has not.

**Concrete next steps, in order:**
1. Wait for the still-running log-tail daemon to capture a temporally-separated stall (ideally hours
   away from 11:51–11:52Z, on a different UTC hour) and re-run this same sliding-window check against
   it. One more genuinely independent hit at <1% base rate would move this from "candidate" toward
   "credible."
2. Trace `catalyst/sources.py` and `catalyst/synthesize.py` for any external call NOT already routed
   through `yf_util.bounded_call` or an equivalent bounded/threadpool-safe pattern, and separately
   check `api/routers/calendar.py`'s own enrichment path for the same. Confirmed-unbounded call sites
   would upgrade this from "plausible mechanism" to "named cause."
3. Fix the qualname bug (above) first if either of these traces needs per-job log attribution rather
   than per-trigger-shape — right now every apscheduler dispatch line for EITHER job still reads the
   same generic wrapper name.
