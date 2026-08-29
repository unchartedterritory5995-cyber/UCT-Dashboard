"""Carry the warm cache across a deploy on the /data volume.

THE PROBLEM
-----------
The shared `TTLCache` is in-memory, so every deploy resets it to empty. The pod
then needs ~3.5 minutes to warm (movers/themes/news/breadth/calendar at T+20s,
bars hot tier T+45s, darkpool T+60s, RS rankings T+120s and ~17s of compute),
and during that window every endpoint answers in ~8.5 s because the recomputes
those warmers exist to prevent land on real users instead. Measured on prod
2026-08-29; the owner has reported it as "slow to load" repeatedly since 07-26.

WHY NOT A READINESS GATE
------------------------
The obvious fix — hold traffic until warm — was tried on 2026-07-26 and took the
site down for ~3 minutes: Railway does NOT keep the old pod serving while the new
one healthchecks, so a 503-until-warm probe removes the only pod there is (see
`api/services/readiness.py`). The pod cannot be withheld. So make the warm
UNNECESSARY instead: persist what was already computed, and load it at boot.

WHAT MAKES THIS CORRECT RATHER THAN JUST FAST
---------------------------------------------
`TTLCache` stores an ABSOLUTE `expires_at`, not a duration. A restored entry is
re-inserted with its REMAINING ttl, so it expires at the same wall-clock instant
it would have on the pod that computed it. A deploy therefore does not extend any
value's life by even a second — the snapshot is a carry-over, never a refresh.
An entry whose deadline passed while the pod was down is simply dropped.

WHAT IS PERSISTED — derived, not enumerated
-------------------------------------------
Every live entry that is JSON round-trippable and under `MAX_VALUE_BYTES`. It is
deliberately NOT an allowlist of key names: the warmers call the real production
functions (`get_movers()`, `compute_rs_scores()`, …) which cache under keys this
module never sees, so a hand-typed roster would silently omit the expensive keys
it exists to carry — and would drift the first time a warmer changed
([[lesson_a_gate_list_drifts_like_any_other_artifact]]). Size is the honest
filter: it excludes the MB-scale `bars_*` payloads (which have their own disk
cache already) and includes the small, expensive aggregates.

KNOWN TRADE-OFF, STATED PLAINLY
-------------------------------
A deploy that changes a cached value's SHAPE will, for up to one TTL, serve the
old shape to new code. The blast radius is bounded by the TTL (15 s - 1 h) and by
the fact that these are read-mostly display aggregates. The alternative is a
guaranteed multi-minute cold window on every deploy. `CACHE_SNAPSHOT_ENABLED=0`
turns the whole thing off without a code change if that trade ever goes wrong.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import time

log = logging.getLogger(__name__)


def _data_dir() -> str:
    return os.environ.get("DATA_DIR", "/data")


def snapshot_path() -> str:
    return os.environ.get("CACHE_SNAPSHOT_PATH") or os.path.join(
        _data_dir(), "cache_snapshot.json"
    )


def enabled() -> bool:
    return os.environ.get("CACHE_SNAPSHOT_ENABLED", "1") == "1"


# A single cached value larger than this is skipped. Bars payloads are MB-scale
# and already have `/data/bars_cache` behind them; carrying them here would bloat
# the file and slow the boot read for no gain.
MAX_VALUE_BYTES = 256 * 1024

# Whole-file ceiling. Reached mid-write, the remaining entries are skipped rather
# than the file being truncated — a partial snapshot is strictly better than none,
# and the cap keeps boot-time deserialization bounded.
MAX_TOTAL_BYTES = 24 * 1024 * 1024

# Below this many seconds of life left, carrying an entry is pointless: it would
# expire during the boot it was meant to accelerate.
MIN_REMAINING_SECONDS = 5.0


def save(cache, path: str | None = None) -> dict:
    """Write live, serializable, small cache entries to the volume. Never raises."""
    path = path or snapshot_path()
    stats = {"considered": 0, "written": 0, "skipped_big": 0,
             "skipped_unserializable": 0, "skipped_expiring": 0, "bytes": 0}
    try:
        entries = cache.items_with_expiry()
    except Exception:
        log.exception("[cache-snapshot] could not read cache")
        return stats

    now = time.time()
    out: dict[str, list] = {}
    total = 0
    for key, value, expires_at in entries:
        stats["considered"] += 1
        if expires_at - now < MIN_REMAINING_SECONDS:
            stats["skipped_expiring"] += 1
            continue
        try:
            blob = json.dumps(value, separators=(",", ":"), default=None)
        except (TypeError, ValueError, RecursionError):
            stats["skipped_unserializable"] += 1
            continue
        # `default=None` turns an unserializable LEAF into null rather than
        # raising, so a value that is mostly-JSON does not silently lose its
        # whole entry. A value that becomes all-null is worthless though —
        # round-trip and drop it if nothing survived.
        if blob in ("null", "{}", "[]"):
            stats["skipped_unserializable"] += 1
            continue
        size = len(blob)
        if size > MAX_VALUE_BYTES:
            stats["skipped_big"] += 1
            continue
        if total + size > MAX_TOTAL_BYTES:
            break
        out[key] = [json.loads(blob), expires_at]
        total += size
        stats["written"] += 1

    payload = {
        "version": 1,
        "saved_at": now,
        "entries": out,
    }
    try:
        # ⛔ encode → tmp → os.replace. `open(path, "w")` truncates BEFORE the
        # write can fail, so a crash mid-dump would leave a zero-byte snapshot
        # and the next boot would come up cold with no way to tell why.
        data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d or None, prefix=".cache_snapshot.", suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
        except BaseException:
            # Leave no half-written temp file behind on the volume.
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        stats["bytes"] = len(data)
    except Exception:
        log.exception("[cache-snapshot] save failed")
        return stats

    log.info("[cache-snapshot] saved %d/%d entries (%.1f KB)",
             stats["written"], stats["considered"], stats["bytes"] / 1024)
    return stats


def restore(cache, path: str | None = None) -> dict:
    """Load a snapshot into the cache, preserving each entry's absolute expiry.

    Never raises: a missing, truncated, or unreadable snapshot must degrade to
    exactly today's behaviour (a cold pod), never to a failed boot.
    """
    path = path or snapshot_path()
    stats = {"found": 0, "restored": 0, "expired": 0, "age_seconds": None}
    try:
        with open(path, "rb") as f:
            payload = json.loads(f.read().decode("utf-8"))
    except FileNotFoundError:
        return stats
    except Exception:
        log.exception("[cache-snapshot] unreadable snapshot — booting cold")
        return stats

    if not isinstance(payload, dict) or payload.get("version") != 1:
        log.warning("[cache-snapshot] unknown snapshot version — booting cold")
        return stats

    entries = payload.get("entries")
    if not isinstance(entries, dict):
        return stats

    now = time.time()
    saved_at = payload.get("saved_at")
    if isinstance(saved_at, (int, float)):
        stats["age_seconds"] = int(now - saved_at)

    for key, pair in entries.items():
        stats["found"] += 1
        try:
            value, expires_at = pair
            remaining = float(expires_at) - now
        except (TypeError, ValueError):
            continue
        # The whole correctness claim: re-insert with what is LEFT, so the value
        # dies when it always would have. Never with the original full ttl.
        if remaining <= 0:
            stats["expired"] += 1
            continue
        try:
            cache.set(key, value, ttl=remaining)
            stats["restored"] += 1
        except Exception:
            continue

    log.info("[cache-snapshot] restored %d/%d entries (snapshot age %ss)",
             stats["restored"], stats["found"], stats["age_seconds"])
    return stats
