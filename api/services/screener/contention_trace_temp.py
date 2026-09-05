"""
TEMPORARY diagnostic -- natural-load contention attribution for the
screener scan endpoint (owner-authorized package, 2026-09-05).

Question being answered: what else is running when a normally ~1-5ms
SQLite read on screener.db expands to 100-500+ms in production? Prior
packages ruled out connection lifecycle and storage-medium identity in
isolation; this pass observes NATURAL production load (never manufactured)
and correlates slow scanner requests against which APScheduler jobs were
actually running at that instant, plus cheap process/WAL-state context.

Logs ONLY:
  - a scanner request whose total latency >= SLOW_THRESHOLD_MS, and
  - a heavily rate-limited fast-control sample (<= FAST_SAMPLE_MAX_MS,
    at most one per FAST_SAMPLE_MIN_INTERVAL_S) for comparison.

No request/response payloads, no PII, no auth tokens, no scanner result
rows, no Railway variable values -- only timings, job IDs, and cheap
process/file-existence metadata.

`instrument_scheduler` mirrors `memory_probe.instrument_scheduler`'s proven
wrap-add_job technique (same file, same session) rather than inventing a
second way to observe "what's currently running" -- never changes add_job's
return value, never swallows a job's exception, and a failure in the
tracking itself is always discarded so it can never break a scheduled job.

Remove this file + its three call sites (api/main.py, api/routers/
screener.py, api/services/screener/query.py) once the natural-load
observation window has produced enough evidence. Not a permanent feature.
"""
import contextvars
import os
import threading
import time

try:
    import resource as _resource
except ImportError:  # Windows local dev -- prod is Linux
    _resource = None

_stage_times: contextvars.ContextVar = contextvars.ContextVar(
    "_contention_trace_stage_times", default=None
)

_active_jobs: dict = {}
_active_jobs_lock = threading.Lock()

_last_fast_log_at = 0.0
_fast_log_lock = threading.Lock()

SLOW_THRESHOLD_MS = 300.0
FAST_SAMPLE_MAX_MS = 10.0
FAST_SAMPLE_MIN_INTERVAL_S = 60.0

# A small, pre-identified set -- NOT every /data file. screener.db is the
# subject; bars.db/patterns.db/darkpool.db are the largest same-volume
# files with the most frequent scheduled writers (see continuity
# checkpoint's job/DB inventory).
_WATCHED_DB_PATHS = {
    "screener": "/data/screener.db",
    "bars": "/data/bars.db",
    "patterns": "/data/patterns.db",
    "darkpool": "/data/darkpool.db",
}


def reset_stages() -> None:
    _stage_times.set({})


def pop_stages() -> dict:
    d = _stage_times.get()
    if d is None:
        return {}
    _stage_times.set(None)
    return d


class stage:
    """Context manager: records elapsed ms into the current context's stage
    dict under `name`. A no-op if reset_stages() was never called on this
    context/thread -- never raises."""

    def __init__(self, name: str):
        self.name = name

    def __enter__(self):
        self._t0 = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc, tb):
        d = _stage_times.get()
        if d is not None:
            d[self.name] = round((time.perf_counter() - self._t0) * 1000, 3)
        return False


def instrument_scheduler(scheduler) -> None:
    """Wrap `scheduler.add_job` so EVERY job's actual execution window is
    tracked in `_active_jobs`. Must be called BEFORE any add_job (mirrors
    `memory_probe.instrument_scheduler`'s own docstring warning, same
    reason: jobs registered first are the heavy startup ones)."""
    original = scheduler.add_job

    def add_job(func=None, *args, **kwargs):
        job_id = kwargs.get("id") or getattr(func, "__name__", None) or "unnamed"

        def wrapped(*fa, **fkw):
            with _active_jobs_lock:
                _active_jobs[job_id] = time.time()
            try:
                return func(*fa, **fkw)
            finally:
                with _active_jobs_lock:
                    _active_jobs.pop(job_id, None)

        try:
            wrapped.__name__ = getattr(func, "__name__", "job")
            wrapped.__doc__ = getattr(func, "__doc__", None)
        except Exception:
            pass
        return original(wrapped, *args, **kwargs)

    scheduler.add_job = add_job


def _active_jobs_snapshot() -> str:
    now = time.time()
    with _active_jobs_lock:
        items = sorted(_active_jobs.items())
    if not items:
        return "none"
    return ",".join(f"{jid}:{round(now - t0, 1)}s" for jid, t0 in items)


def _wal_state() -> str:
    parts = []
    for label, path in _WATCHED_DB_PATHS.items():
        wal = path + "-wal"
        try:
            exists = os.path.exists(wal)
            size = os.path.getsize(wal) if exists else 0
        except OSError:
            exists, size = False, 0
        parts.append(f"{label}_wal={1 if exists else 0}:{size}")
    return " ".join(parts)


def _process_context() -> str:
    rss_kb = nvcsw = nivcsw = -1
    if _resource is not None:
        try:
            ru = _resource.getrusage(_resource.RUSAGE_SELF)
            rss_kb, nvcsw, nivcsw = ru.ru_maxrss, ru.ru_nvcsw, ru.ru_nivcsw
        except Exception:
            pass
    return (
        f"pid={os.getpid()} tid={threading.get_ident()} "
        f"active_threads={threading.active_count()} rss_kb={rss_kb} "
        f"nvcsw={nvcsw} nivcsw={nivcsw}"
    )


def record(total_request_ms: float, stages: dict) -> None:
    """Called by the router right after run_scan() returns."""
    global _last_fast_log_at
    is_slow = total_request_ms >= SLOW_THRESHOLD_MS
    is_fast_sample = False
    if not is_slow and total_request_ms <= FAST_SAMPLE_MAX_MS:
        now = time.time()
        with _fast_log_lock:
            if now - _last_fast_log_at >= FAST_SAMPLE_MIN_INTERVAL_S:
                _last_fast_log_at = now
                is_fast_sample = True
    if not (is_slow or is_fast_sample):
        return

    try:
        tag = "SLOW" if is_slow else "fast-control"
        stage_str = " ".join(f"{k}_ms={v}" for k, v in sorted(stages.items()))
        print(
            f"[contention-trace] tag={tag} total_ms={round(total_request_ms, 3)} "
            f"{stage_str} active_jobs={_active_jobs_snapshot()} "
            f"{_process_context()} {_wal_state()}"
        )
    except Exception:
        pass
