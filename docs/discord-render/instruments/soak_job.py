"""Step 3.4 — a long, low-rate soak that watches for DRIFT, not for failure.

⚠️ BUILT NOW, RUN LATER, OUTSIDE RTH. Lane A schedules it. `--self-check` runs today.

    python -u docs/discord-render/instruments/soak_job.py --self-check
    python -u docs/discord-render/instruments/soak_job.py --minutes 90 --rate 0.2 --state soak.json
    python -u docs/discord-render/instruments/soak_job.py --minutes 90 --state soak.json   # resumes

A load run asks "does it break under pressure". A soak asks the different question that the
8.4-minute median pod has never let anyone ask: **does anything grow?** Four things are watched,
because these are the four that cost a member something on a pod that lives for hours:

  * **queue depth** rising — jobs arriving faster than they retire, which ends as `queue_full`;
  * **threads** rising — a leak in the dedicated pools, which ends as C-02 in a new shape;
  * **RSS** rising — the renderer's own recycle ceiling exists for this, and `web` has none;
  * **unclosed leases** — a row still `running` past `lease_until`, which is a job nobody owns and
    nobody will answer (S7's "zero non-terminal at 60 s") and the seed of a double-delivery.

⛔ IT REPORTS ITS OWN SAMPLE COUNT, and a run below `--min-samples` is **INCONCLUSIVE**, not clean.
A soak that sampled twice and saw no drift has not seen anything; the one failure mode that makes a
soak worthless is that a run which did nothing reads exactly like a run that found nothing.

⛔ AN UNMEASURABLE METRIC IS NOT A PASSING METRIC. `psutil` is not installed here, so RSS may be
unavailable — that metric then reports `unmeasured` and the run is INCONCLUSIVE, naming it. A
harness that silently drops the metric it cannot read is the saturated-instrument defect.

⛔ EXIT CODES ARE THREE: 0 no drift · 1 measured drift · 2 could-not-measure.
⛔ A run with no totals line is not a run.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import statistics
import sys
import tempfile
import threading
import time

PASS, FAIL, INCONCLUSIVE = 0, 1, 2
SHARED_ROOTS = ("/data", "c:\\data", "c:/data")

#: Drift thresholds. A metric must grow by BOTH an absolute and a relative amount to be called
#: drift — either alone fires on noise (a 1-thread wobble is 50 % on a base of 2).
THRESHOLDS = {
    "queue_depth": {"abs": 4.0, "rel": 0.50, "unit": "jobs"},
    "threads": {"abs": 6.0, "rel": 0.25, "unit": "threads"},
    "rss_mb": {"abs": 64.0, "rel": 0.25, "unit": "MB"},
}
#: Not a trend — any value above zero at the end is a defect on its own.
ABSOLUTE_ZERO = ("stale_leases", "stuck_jobs")


def _repo_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parents[3]


def _sandbox(tmp: pathlib.Path) -> pathlib.Path:
    tmp.mkdir(parents=True, exist_ok=True)
    db = tmp / "soak_jobs.db"
    os.environ["DISCORD_RENDER_DB_PATH"] = str(db)
    os.environ["DISCORD_RENDER_CACHE_DIR"] = str(tmp / "cache")
    low = str(db.resolve()).lower().replace("\\", "/")
    if any(low.startswith(r.replace("\\", "/")) for r in SHARED_ROOTS):
        raise SystemExit(f"refusing to run: the jobs db resolves into the shared data root ({db})")
    return db


# ── the metrics ─────────────────────────────────────────────────────────────

def rss_mb() -> float | None:
    """Resident set size, or None. ⛔ None is reported as `unmeasured`, never as 0 — a zero here
    would read as "no memory growth" and is the saturated-instrument shape."""
    try:
        import psutil                                   # not installed on this box; may be on the pod
        return psutil.Process().memory_info().rss / (1024 * 1024)
    except Exception:  # noqa: BLE001
        pass
    try:                                                # Linux, no dependency
        with open("/proc/self/statm", encoding="utf-8") as fh:
            pages = int(fh.read().split()[1])
        return pages * os.sysconf("SC_PAGE_SIZE") / (1024 * 1024)
    except Exception:  # noqa: BLE001
        pass
    try:                                                # Windows, no dependency
        import ctypes
        from ctypes import wintypes

        class _PMC(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                        ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                        ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]

        counters = _PMC()
        counters.cb = ctypes.sizeof(_PMC)
        # ⛔ `restype` MUST be set. The default is `c_int`, which truncates the 64-bit pseudo-handle
        # and makes the call return 0 — a metric that reads as "unmeasured" for a reason that is
        # entirely ours. Measured on this box before the fix.
        get_proc = ctypes.windll.kernel32.GetCurrentProcess
        get_proc.restype = ctypes.c_void_p
        if ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.c_void_p(get_proc()),
                                                    ctypes.byref(counters), counters.cb):
            return counters.WorkingSetSize / (1024 * 1024)
    except Exception:  # noqa: BLE001
        pass
    return None


def sample(rt, store) -> dict:
    depth = rt.depth() if rt is not None else {}
    stale, stuck = 0, 0
    if store is not None:
        now = time.time()
        try:
            rows = store._conn.execute(
                "SELECT state, lease_until FROM discord_render_jobs "
                "WHERE state IN ('queued','running')").fetchall()
            stale = sum(1 for r in rows if (r["lease_until"] or 0) and r["lease_until"] < now
                        and r["state"] == "running")
            stuck = len(store.stuck(60.0))
        except Exception:  # noqa: BLE001 — an unreadable store is reported, not assumed healthy
            stale = stuck = -1
    return {"t": time.time(),
            "queue_depth": float((depth.get("interactive") or 0) + (depth.get("background") or 0)
                                 + (depth.get("active") or 0)),
            "threads": float(threading.active_count()),
            "rss_mb": rss_mb(),
            "stale_leases": stale,
            "stuck_jobs": stuck}


# ── drift ───────────────────────────────────────────────────────────────────

def analyse(samples: list[dict], *, min_samples: int) -> tuple[int, dict, list[str]]:
    """Compare the last third against the first third. ⛔ INCONCLUSIVE is decided first."""
    per: dict[str, dict] = {}
    if len(samples) < min_samples:
        return INCONCLUSIVE, per, [f"only {len(samples)} samples (need {min_samples}) — "
                                   "a soak that sampled nothing has not seen anything"]

    third = max(1, len(samples) // 3)
    head, tail = samples[:third], samples[-third:]
    reasons, unmeasured = [], []

    for metric, rule in THRESHOLDS.items():
        h = [s[metric] for s in head if s.get(metric) is not None]
        t = [s[metric] for s in tail if s.get(metric) is not None]
        if not h or not t:
            per[metric] = {"state": "unmeasured"}
            unmeasured.append(f"{metric} was never readable on this host")
            continue
        first, last = statistics.median(h), statistics.median(t)
        grew = last - first
        rel = grew / first if first else float("inf")
        drifted = grew >= rule["abs"] and rel >= rule["rel"]
        per[metric] = {"state": "drift" if drifted else "ok", "first": round(first, 2),
                       "last": round(last, 2), "delta": round(grew, 2)}
        if drifted:
            reasons.append(f"{metric} rose {grew:+.1f} {rule['unit']} ({first:.1f} → {last:.1f})")

    for metric in ABSOLUTE_ZERO:
        # ⛔⛔ MUST BE `tail`, NEVER `samples` — the exact "sums across all history, one bad
        # entry poisons it forever" defect this repo names repeatedly (check_smoke's own
        # documented bug is the same shape), found here 2026-09-19 after the resume_pending()
        # fix landed and STILL read FAIL. Root cause traced with the real state file: exactly
        # ONE sample in a 5000-sample window (a single transient stale-lease blip, ~26h old)
        # was keeping every tick FAIL, while every sample from the actually-fixed run (the
        # most recent ~60) read clean 0/0. `samples` here can span days of accumulated
        # cross-tick history (state.json persists via --state; only the JobsStore's own DB is
        # fresh per tick, not the sample window) -- a single ancient blip that self-resolved
        # hours ago should not out-vote hours of subsequent clean readings. The module's own
        # docstring already said "any value above zero AT THE END is a defect on its own" and
        # "Not a trend" -- `tail` (the same last-third slice THRESHOLDS already compares
        # against) is what "at the end" actually means; `samples` was never-ending history.
        values = [s.get(metric) for s in tail if s.get(metric) is not None]
        if not values:
            per[metric] = {"state": "unmeasured"}
            unmeasured.append(f"{metric} was never readable")
            continue
        if any(v < 0 for v in values):
            per[metric] = {"state": "unmeasured"}
            unmeasured.append(f"{metric}: the jobs store could not be read")
            continue
        worst = max(values)
        per[metric] = {"state": "drift" if worst > 0 else "ok", "max": worst}
        if worst > 0:
            reasons.append(f"{metric} reached {worst} — a job nobody owns and nobody will answer (S7)")

    if unmeasured:
        # A metric nobody could read must not be counted as a clean one.
        return INCONCLUSIVE, per, unmeasured + reasons
    return (FAIL if reasons else PASS), per, reasons


# ── state (bounded + resumable) ─────────────────────────────────────────────

def load_state(path: str) -> dict:
    if not path or not pathlib.Path(path).exists():
        return {"samples": [], "runs": 0}
    try:
        data = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("samples"), list):
            return data
    except Exception:  # noqa: BLE001
        pass
    return {"samples": [], "runs": 0}


def save_state(path: str, state: dict, *, max_samples: int) -> None:
    if not path:
        return
    state["samples"] = state["samples"][-max_samples:]          # bounded: a soak cannot grow a file forever
    tmp = pathlib.Path(path + ".tmp")
    tmp.write_text(json.dumps(state, indent=1), encoding="utf-8")
    os.replace(tmp, path)


# ── the run ─────────────────────────────────────────────────────────────────

class _NoopDelivery:
    """⛔⛔ NOTHING IN THIS INSTRUMENT MAY REACH DISCORD. `commands.get_runtime()` wires `edit_fn`
    to `di.edit_original` and `delivery` to the real module, so a soak driven through it would
    POST to discord.com once per synthetic job, with a fake token, for an hour. The runtime is
    therefore built here with its Discord seams stubbed — the queue, the workers, the writer
    thread, the lease heartbeat and the store are the real ones, which is what drifts."""

    def edit_text(self, app_id, token, *, content, components=None, client=None):
        from api.services.discord_render.delivery import DeliveryResult
        return DeliveryResult(True, 200)

    def followup(self, app_id, token, *, content, components=None, ephemeral=True, client=None):
        from api.services.discord_render.delivery import DeliveryResult
        return DeliveryResult(True, 200)

    def edit_fn(self, app_id, token, **kw):
        return {"id": "soak", "attachments": [{"id": 0}]}


def soak(minutes: float, rate: float, sample_s: float, state: dict, *, max_samples: int,
         state_path: str, work_ms: float = 20.0) -> dict:
    from api.services.discord_render.jobs_store import JobsStore
    from api.services.discord_render.runtime import Job, JobRuntime

    def _work(ctx):
        time.sleep(work_ms / 1000.0)
        ctx.edit(ctx.job.app_id, ctx.job.token, content=ctx.job.label,
                 png=b"\x89PNG\r\n\x1a\n", filename="soak.png")
        return "ok"

    stub = _NoopDelivery()
    store = JobsStore(os.environ["DISCORD_RENDER_DB_PATH"])
    rt = JobRuntime(store=store, handlers={"chart": _work}, edit_fn=stub.edit_fn, delivery=stub,
                    owner="soak-pod").start()
    # ⛔⛔ WITHOUT THIS, A JOB IN-FLIGHT AT ANY PRIOR TICK'S `stop()` BOUNDARY IS STUCK FOREVER.
    # `stop()` -> `store.release_all(owner)` clears `lease_until` but leaves `state='running'`
    # unchanged (by design -- release_all's own contract is "next pod resumes AT ONCE", not
    # "mark it done"). Every OTHER real caller of JobRuntime in this codebase --
    # `commands.py:140` (production boot), `chaos_scenarios.py`, `oi40_producer_probe.py`, and
    # the test suite -- calls `resume_pending()` right after `.start()` for exactly this reason:
    # it re-queues resumable rows and `finish()`-terminates expired ones, which is the ONLY thing
    # that ever clears a released-but-not-finished row out of ('queued','running'). This soak
    # restarts JobRuntime fresh every ~13-minute tick (Task Scheduler cadence), and every restart
    # is a `stop()` boundary a job can be caught mid-flight at -- so omitting this call is not a
    # cosmetic gap, it is a permanent, non-clearing false-FAIL generator: `stale_leases`/
    # `stuck_jobs` accumulate a small residue at a restart boundary and then read non-zero on
    # EVERY subsequent tick forever, because nothing between here and `sample()` ever reclaims
    # them. Measured 2026-09-19 against the real soak log: 147 consecutive FAIL ticks, all
    # reporting the identical `stale_leases=2, stuck_jobs=1` -- a frozen residue, not growing
    # drift, exactly the shape this fix predicts and clears.
    rt.resume_pending()
    offered = refused = 0
    started = time.time()
    next_offer = started
    next_sample = started
    n = len(state["samples"])
    try:
        while time.time() - started < minutes * 60.0:
            now = time.time()
            if rate > 0 and now >= next_offer:
                job = Job(corr_id=f"soak{n:04d}{int(now) % 10000:04d}", command="chart",
                          app_id="soak", token=f"soak-token-{n}", args={"ticker": "NVDA"},
                          label="/chart NVDA", user_id=f"soak-member-{n % 32}",
                          interaction_id=f"soak-{n}")
                verdict, _ = rt.offer(job)
                offered += 1
                refused += int(verdict != "queued")
                next_offer = now + 1.0 / rate
                n += 1
            if now >= next_sample:
                state["samples"].append(sample(rt, store))
                save_state(state_path, state, max_samples=max_samples)
                next_sample = now + sample_s
            time.sleep(min(0.25, sample_s / 4.0))
    finally:
        try:
            rt.stop()
        except Exception:  # noqa: BLE001
            pass
    # One last sample AFTER shutdown: a lease the shutdown hook failed to hand back is the
    # difference between "the next pod resumes at once" and "a job nobody owns" (03 §3.3).
    state["samples"].append(sample(rt, store))
    save_state(state_path, state, max_samples=max_samples)
    try:
        store.close()
    except Exception:  # noqa: BLE001
        pass
    return {"offered": offered, "refused": refused, "elapsed_s": time.time() - started}


def totals_line(code: int, samples: int, resumed: int, per: dict, reasons: list[str], meta: dict) -> str:
    label = {PASS: "PASS", FAIL: "FAIL", INCONCLUSIVE: "INCONCLUSIVE"}[code]
    states = ",".join(f"{k}={v.get('state')}" for k, v in sorted(per.items())) or "none"
    return (f"TOTALS soak_job {label} samples={samples} resumed_from={resumed} "
            f"minutes={meta.get('minutes')} rate={meta.get('rate')}/s offered={meta.get('offered')} "
            f"refused={meta.get('refused')} mode=in_process delivery=noop metrics[{states}]"
            + (f" reasons={' | '.join(reasons)}" if reasons else ""))


# ── self-check ──────────────────────────────────────────────────────────────

def _series(**series) -> list[dict]:
    n = max(len(v) for v in series.values())
    return [{"t": float(i), **{k: v[i] for k, v in series.items()}} for i in range(n)]


def self_check() -> int:
    """⛔ PROVE EACH VERDICT CAN BE REACHED, and that they are four different verdicts."""
    cases: list[tuple[str, bool]] = []
    flat = [2.0] * 12

    ok = _series(queue_depth=flat, threads=[40.0] * 12, rss_mb=[300.0] * 12,
                 stale_leases=[0] * 12, stuck_jobs=[0] * 12)
    code, per, _ = analyse(ok, min_samples=6)
    cases.append(("a flat soak PASSES", code == PASS and all(v["state"] == "ok" for v in per.values())))

    leaking = _series(queue_depth=flat, threads=[40.0, 41, 42, 44, 46, 48, 50, 52, 55, 58, 60, 64],
                      rss_mb=[300.0] * 12, stale_leases=[0] * 12, stuck_jobs=[0] * 12)
    code, per, reasons = analyse(leaking, min_samples=6)
    cases.append(("a thread leak is a measured FAIL",
                  code == FAIL and per["threads"]["state"] == "drift" and any("threads" in r for r in reasons)))

    growing = _series(queue_depth=flat, threads=[40.0] * 12, stale_leases=[0] * 12, stuck_jobs=[0] * 12,
                      rss_mb=[300.0, 310, 320, 340, 360, 380, 400, 420, 450, 480, 510, 560])
    code, _, _ = analyse(growing, min_samples=6)
    cases.append(("memory growth is a measured FAIL", code == FAIL))

    backing_up = _series(threads=[40.0] * 12, rss_mb=[300.0] * 12, stale_leases=[0] * 12,
                         stuck_jobs=[0] * 12,
                         queue_depth=[1.0, 1, 2, 2, 3, 4, 5, 7, 9, 11, 13, 16])
    cases.append(("a rising queue is a measured FAIL", analyse(backing_up, min_samples=6)[0] == FAIL))

    leased = _series(queue_depth=flat, threads=[40.0] * 12, rss_mb=[300.0] * 12,
                     stale_leases=[0] * 10 + [1, 1], stuck_jobs=[0] * 12)
    code, _, reasons = analyse(leased, min_samples=6)
    cases.append(("one unclosed lease is a FAIL on its own, not a trend",
                  code == FAIL and any("nobody owns" in r for r in reasons)))

    # ⛔⛔ Measured 2026-09-19 against the real soak-state.json: a single stale-lease sample
    # ~26h old, buried in the HEAD of a 5000-sample window, kept every subsequent tick FAIL
    # for a full day even though the resume_pending() fix (above) had made every sample since
    # genuinely clean 0/0 -- `max(values)` over the WHOLE window, not just `tail`, is the
    # exact "sums across all history, one bad entry poisons it forever" shape this repo names
    # repeatedly elsewhere. An old blip that already self-resolved must not out-vote hours of
    # clean readings after it.
    old_blip_healed = _series(queue_depth=flat, threads=[40.0] * 12, rss_mb=[300.0] * 12,
                              stale_leases=[2] + [0] * 11, stuck_jobs=[0] * 12)
    code, per, _ = analyse(old_blip_healed, min_samples=6)
    cases.append(("an old, already-healed stale-lease blip in the HEAD does not poison a clean tail",
                  code == PASS and per["stale_leases"]["state"] == "ok"))

    cases.append(("too few samples is INCONCLUSIVE, never a pass",
                  analyse(ok[:3], min_samples=6)[0] == INCONCLUSIVE))
    cases.append(("no samples at all is INCONCLUSIVE",
                  analyse([], min_samples=6)[0] == INCONCLUSIVE))

    blind = _series(queue_depth=flat, threads=[40.0] * 12, rss_mb=[None] * 12,
                    stale_leases=[0] * 12, stuck_jobs=[0] * 12)
    code, per, reasons = analyse(blind, min_samples=6)
    cases.append(("an unreadable metric is INCONCLUSIVE and NAMED, never a silent pass",
                  code == INCONCLUSIVE and per["rss_mb"]["state"] == "unmeasured"
                  and any("rss_mb" in r for r in reasons)))

    unreadable = _series(queue_depth=flat, threads=[40.0] * 12, rss_mb=[300.0] * 12,
                         stale_leases=[-1] * 12, stuck_jobs=[0] * 12)
    cases.append(("an unreadable jobs store is INCONCLUSIVE, not zero leases",
                  analyse(unreadable, min_samples=6)[0] == INCONCLUSIVE))

    # …noise must NOT fire: a metric needs both an absolute and a relative move.
    wobble = _series(queue_depth=flat, threads=[40.0, 41, 40, 42, 41, 43, 41, 42, 40, 43, 42, 43],
                     rss_mb=[300.0] * 12, stale_leases=[0] * 12, stuck_jobs=[0] * 12)
    cases.append(("ordinary wobble is not reported as drift", analyse(wobble, min_samples=6)[0] == PASS))

    # …and the state file round-trips, bounded, so a resumed run continues rather than restarting.
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="drender-soak-sc-")) / "state.json"
    st = {"samples": [{"t": float(i), "queue_depth": 1.0} for i in range(50)], "runs": 1}
    save_state(str(tmp), st, max_samples=20)
    back = load_state(str(tmp))
    cases.append(("state is bounded and resumable",
                  len(back["samples"]) == 20 and back["samples"][-1]["t"] == 49.0))
    cases.append(("a missing state file resumes from empty, not from a crash",
                  load_state(str(tmp.parent / "nope.json")) == {"samples": [], "runs": 0}))

    # …and `soak()` actually calls `resume_pending()` after `.start()`. Derived from the real
    # source, never a comment: a job in-flight at any prior tick's `stop()` boundary is left in
    # `state='running'` (release_all clears the lease, not the state -- by design, so "the next
    # pod resumes AT ONCE"), and `resume_pending()` is the ONLY thing that ever reclaims or
    # terminally-finishes such a row. Every other real JobRuntime caller in this codebase
    # (production's commands.py:140, chaos_scenarios.py, oi40_producer_probe.py, the test suite)
    # calls it; this soak restarts JobRuntime fresh every ~13-minute tick, so a call missing here
    # is not cosmetic -- it is a permanent, non-clearing false-FAIL generator (measured
    # 2026-09-19: 147 consecutive real FAIL ticks, frozen at the identical stale_leases=2,
    # stuck_jobs=1, because nothing between `.start()` and the offer loop ever reclaimed the
    # residue). `resume_pending()`'s OWN correctness is tested elsewhere
    # (tests/test_discord_render_v2_core.py) -- this only proves the call site exists, matching
    # this repo's "derive from source, never a comment" convention.
    # ⛔ AST, never a text search — this file's OWN comment above contains the literal string
    # "resume_pending()" (explaining why the call matters), so a bare `"resume_pending()" in
    # source` check matches the comment and passes even with the call deleted. Measured: the
    # first version of this case did exactly that and stayed green through the mutation it
    # exists to catch. Parse the real syntax tree and look for an actual method-call node.
    import ast
    import inspect
    _soak_tree = ast.parse(inspect.getsource(soak))
    _calls = [n.func.attr for n in ast.walk(_soak_tree)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
    cases.append(("soak() calls resume_pending() after start() -- a stuck-job leak otherwise",
                  "start" in _calls and "resume_pending" in _calls))

    for name, ok_ in cases:
        print(f"  {'ok  ' if ok_ else 'FAIL'} {name}")
    failed = [n for n, ok_ in cases if not ok_]
    print(f"TOTALS soak_job --self-check {'PASS' if not failed else 'FAIL'} "
          f"cases={len(cases)} failed={len(failed)}"
          + (f" reasons={'; '.join(failed)}" if failed else ""))
    return PASS if not failed else FAIL


# ── entry ───────────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--minutes", type=float, default=60.0)
    ap.add_argument("--rate", type=float, default=0.2, help="jobs offered per second (LOW on purpose)")
    ap.add_argument("--sample-s", type=float, default=15.0)
    ap.add_argument("--min-samples", type=int, default=6)
    ap.add_argument("--max-samples", type=int, default=5000, help="bound on the state file")
    ap.add_argument("--state", default="", help="JSON file: the run resumes from it and appends")
    ap.add_argument("--out", default="")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)

    if args.self_check:
        return self_check()

    sys.path.insert(0, str(_repo_root()))
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="drender-soak-"))
    state = load_state(args.state)
    resumed = len(state["samples"])
    state["runs"] = int(state.get("runs") or 0) + 1
    meta = {"minutes": args.minutes, "rate": args.rate, "offered": 0, "refused": 0}
    per: dict = {}
    try:
        _sandbox(tmp)
        out = soak(args.minutes, args.rate, args.sample_s, state,
                   max_samples=args.max_samples, state_path=args.state)
        meta.update(out)
        code, per, reasons = analyse(state["samples"], min_samples=args.min_samples)
        if args.out:
            pathlib.Path(args.out).write_text(json.dumps(
                {"meta": meta, "per_metric": per, "samples": state["samples"]}, indent=2),
                encoding="utf-8")
        for metric, verdict in sorted(per.items()):
            print(f"  {str(verdict.get('state')).upper():13} {metric:14} {verdict}")
    except Exception as e:  # noqa: BLE001
        code, reasons = INCONCLUSIVE, [f"the run did not complete: {type(e).__name__}: {e}"]
    print(totals_line(code, len(state["samples"]), resumed, per, reasons, meta))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
