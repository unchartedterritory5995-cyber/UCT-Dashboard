"""Name what is holding the pod's memory, instead of inferring it from RSS.

WHY
---
The web pod's RSS climbs steadily — measured 2026-08-29: 1201 MB at 105 s uptime,
1661 MB at 318 s (~2.2 MB/s), and 11,665 MB observed on a long-lived pod. Nothing
in the existing diagnostics answers "held by what": `/api/health` reports the
total, `/api/health/threads` counts threads (64, flat — not a thread leak), and
`/api/health/cache` is about bars R2 sync, not process memory.

So every discussion of the growth so far has been a guess. This is the
measurement. It is the memory analogue of the thread histogram that already
exists for exactly the same reason.

DERIVED, NOT ENUMERATED
-----------------------
Caches are discovered by walking `sys.modules` for live `TTLCache` instances
rather than from a hand-written roster. There are at least four (`services.cache`,
`routers.live_prices`, `services.discord_relay`, `services.fred_economic`) and a
typed list would omit the next one — which, being new, is exactly the one most
likely to be leaking. Anything found without a module-level name is still
reported, as `<unnamed>`.

COST
----
The default response is cheap: RSS, cache occupancy, GC generation counts. The
expensive parts — a GC type histogram and per-cache byte estimates — are behind
`deep=True`, because `gc.get_objects()` on a multi-GB process both takes real
time and allocates while it runs. Admin-only, called by hand, never on a timer.

Byte figures are ESTIMATES from a bounded sample, and are labelled as such in the
payload. An exact walk of a 1,000-entry cache holding MB-scale bars payloads
would itself be a memory event.
"""
from __future__ import annotations

import gc
import json
import random
import sys
import threading
import time
from collections import Counter

# How many entries to serialize when estimating a cache's footprint.
_SAMPLE_ENTRIES = 24
# Give up on a single value past this; it is counted at the cap rather than
# fully measured, so one huge payload cannot stall the probe.
_VALUE_CAP_BYTES = 4 * 1024 * 1024


def _rss_mb() -> float | None:
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024, 1)
    except Exception:
        pass
    try:  # non-Linux dev boxes
        import resource
        return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)
    except Exception:
        return None


def _find_caches() -> list[tuple[str, object]]:
    """Every live TTLCache reachable as a module attribute, named by where it lives."""
    try:
        from api.services.cache import TTLCache
    except Exception:
        return []
    found: list[tuple[str, object]] = []
    seen: set[int] = set()
    # list(...) — sys.modules can mutate under a lazy import on another thread.
    for mod_name, mod in list(sys.modules.items()):
        if not mod_name.startswith("api.") or mod is None:
            continue
        try:
            attrs = vars(mod)
        except Exception:
            continue
        for attr, val in list(attrs.items()):
            if isinstance(val, TTLCache) and id(val) not in seen:
                seen.add(id(val))
                found.append((f"{mod_name}.{attr}", val))
    return found


def _estimate_bytes(cache) -> dict:
    """Sampled footprint estimate for one cache. Never raises."""
    out = {"sampled": 0, "sample_bytes": 0, "estimated_bytes": None, "largest_value_bytes": 0}
    try:
        items = cache.items_with_expiry()
    except Exception:
        return out
    n = len(items)
    if not n:
        return out
    sample = items if n <= _SAMPLE_ENTRIES else random.sample(items, _SAMPLE_ENTRIES)
    total = 0
    for key, value, _exp in sample:
        try:
            blob = json.dumps(value, separators=(",", ":"), default=str)
            size = min(len(blob), _VALUE_CAP_BYTES)
        except Exception:
            size = sys.getsizeof(value)
        total += size + len(key)
        out["largest_value_bytes"] = max(out["largest_value_bytes"], size)
    out["sampled"] = len(sample)
    out["sample_bytes"] = total
    # Extrapolate the sample mean across the whole cache.
    out["estimated_bytes"] = int(total / len(sample) * n)
    return out


# ─── Per-job memory attribution ──────────────────────────────────────────────
# Prod 2026-08-29: RSS jumped 1497.5 -> 6134 MB between two 30s samples — ~4.6 GB
# in one step, on the pod that serves members. That is not the slow arena
# fragmentation `malloc_trim` addresses (which released 120.9 MB in the same
# window); it is one job allocating enormously. The scheduler runs 135 of them,
# and the logs only narrow it to whichever cluster happened to be running.
#
# So every job records its own RSS delta. DERIVED, not enumerated: `add_job` is
# wrapped once, so all 135 are covered and so is the 136th.
_JOB_MEM: dict[str, dict] = {}
_JOB_MEM_LOCK = threading.Lock()


def record_job(job_id: str, before, after, seconds: float) -> None:
    """Record one job execution's RSS delta. Never raises."""
    try:
        if before is None or after is None:
            return
        d = round(after - before, 1)
        with _JOB_MEM_LOCK:
            row = _JOB_MEM.setdefault(job_id, {
                "calls": 0, "last_delta_mb": 0.0, "max_delta_mb": 0.0,
                "total_delta_mb": 0.0, "max_seconds": 0.0,
            })
            row["calls"] += 1
            row["last_delta_mb"] = d
            row["max_delta_mb"] = max(row["max_delta_mb"], d)
            row["total_delta_mb"] = round(row["total_delta_mb"] + d, 1)
            row["max_seconds"] = round(max(row["max_seconds"], seconds), 2)
    except Exception:
        pass


def job_memory_report(limit: int = 15) -> list[dict]:
    """Jobs ranked by the largest single RSS jump they have caused."""
    with _JOB_MEM_LOCK:
        rows = [dict(v, job=k) for k, v in _JOB_MEM.items()]
    rows.sort(key=lambda r: r["max_delta_mb"], reverse=True)
    return rows[:limit]


def instrument_scheduler(scheduler) -> None:
    """Wrap `scheduler.add_job` so EVERY job records its RSS delta.

    ⛔ Must be called BEFORE any add_job, or the jobs registered first — which
    includes the heavy startup ones — are the very ones left unmeasured.

    The wrapper is deliberately paranoid: it never changes the return value,
    never swallows the job's exception (the `finally` records and re-raises),
    and a failure in the recording itself is discarded. A diagnostic that can
    break a scheduled job is worse than no diagnostic.
    """
    original = scheduler.add_job

    def add_job(func=None, *args, **kwargs):
        job_id = kwargs.get("id") or getattr(func, "__name__", None) or "unnamed"

        def wrapped(*fa, **fkw):
            before = _rss_mb()
            t0 = time.monotonic()
            try:
                return func(*fa, **fkw)
            finally:
                record_job(job_id, before, _rss_mb(), time.monotonic() - t0)

        try:
            wrapped.__name__ = getattr(func, "__name__", "job")
            wrapped.__doc__ = getattr(func, "__doc__", None)
        except Exception:
            pass
        return original(wrapped, *args, **kwargs)

    scheduler.add_job = add_job


def malloc_trim() -> dict:
    """Ask glibc to return free heap pages to the OS. Reports RSS either side.

    THIS IS THE DECISIVE TEST for the growth signature this pod shows: RSS climbs
    ~0.27 MB/s while the caches hold ~3 MB and the GC-tracked object count barely
    moves. Memory that is neither live Python objects nor cached data is either
    (a) genuinely in use by a C extension, or (b) FREED but still held by the
    allocator — glibc keeps per-arena free lists and, with ~64 threads, creates
    many arenas that each hoard.

    Those two look identical from outside and are completely different problems.
    `malloc_trim(0)` separates them in one call: if RSS drops materially, the
    memory was (b) — allocator-held free space — and the mitigation is
    MALLOC_ARENA_MAX or a periodic trim. If it does not move, it is (a) and the
    next step is finding the extension holding it.

    Safe: it releases only memory the process has already freed. It is a hint to
    the allocator, not a change to application state. Cost is proportional to
    heap size, which is why it is admin-triggered and never on a timer.

    Returns `available: False` on non-glibc (musl/macOS/Windows) rather than
    pretending a no-op was a measurement.
    """
    before = _rss_mb()
    out = {"available": False, "rss_mb_before": before, "rss_mb_after": before,
           "released_mb": 0.0, "note": ""}
    try:
        import ctypes
        libc = ctypes.CDLL("libc.so.6")
        trim = getattr(libc, "malloc_trim", None)
        if trim is None:
            out["note"] = "libc has no malloc_trim (not glibc) — nothing measured"
            return out
        trim.argtypes = [ctypes.c_size_t]
        trim.restype = ctypes.c_int
        t0 = time.monotonic()
        rc = trim(0)
        elapsed_ms = round((time.monotonic() - t0) * 1000, 1)
        after = _rss_mb()
        out.update({
            "available": True,
            "returned": int(rc),          # glibc: 1 = some memory was released
            "rss_mb_after": after,
            "released_mb": round((before or 0) - (after or 0), 1),
            # Reported because this call takes the allocator's arena locks. It has
            # to stay cheap to be safe on a timer next to live request handling —
            # if this ever grows into the hundreds of ms, the periodic job is the
            # wrong shape and MALLOC_ARENA_MAX is the answer instead.
            "elapsed_ms": elapsed_ms,
        })
        out["note"] = (
            "released_mb materially > 0 ⇒ the growth is allocator-held FREE memory "
            "(arena fragmentation); MALLOC_ARENA_MAX or a periodic trim is the "
            "mitigation. ~0 ⇒ the memory is genuinely in use by a C extension."
        )
    except OSError as e:
        out["note"] = f"libc unavailable ({e}) — nothing measured"
    except Exception as e:  # noqa: BLE001
        out["note"] = f"trim failed ({type(e).__name__}) — nothing measured"
    return out


def snapshot(deep: bool = False) -> dict:
    """Where the memory is. `deep` adds the costly walks — admin, on demand."""
    caches = []
    for name, c in _find_caches():
        row = {"name": name}
        try:
            row["entries"] = len(c)
            row["max_size"] = c.max_size
        except Exception:
            row["entries"] = None
            row["max_size"] = None
        if deep:
            row.update(_estimate_bytes(c))
        caches.append(row)
    caches.sort(key=lambda r: (r.get("estimated_bytes") or 0, r.get("entries") or 0), reverse=True)

    out = {
        "rss_mb": _rss_mb(),
        "gc_counts": list(gc.get_count()),
        "gc_tracked_objects": None,
        "caches": caches,
        # Which scheduled job made RSS jump, ranked by worst single delta. This
        # is what turns "some job allocated 4.6 GB" into a name.
        "jobs_by_rss_delta": job_memory_report(),
        "deep": deep,
        "note": "byte figures are ESTIMATES extrapolated from a bounded sample",
    }

    if deep:
        try:
            objs = gc.get_objects()
            out["gc_tracked_objects"] = len(objs)
            hist = Counter(type(o).__name__ for o in objs)
            out["top_types"] = [{"type": t, "count": n} for t, n in hist.most_common(15)]
            del objs
        except Exception:
            out["top_types"] = []
    return out
