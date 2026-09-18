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
- `api.routers.calendar` / catalyst-engine prominence in the mid-sized stalls (11:51:56Z, 11:52:03Z)
  has NOT been control-tested the way apscheduler was — that is the honest next candidate, not
  apscheduler.
- Anything about `flow-worker`'s side, not analyzed in this pass (this correlation used only the
  `web` log; flow-worker's OPRA-tape stalls are a structurally different question).
