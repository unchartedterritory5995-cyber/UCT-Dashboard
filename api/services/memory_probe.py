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
