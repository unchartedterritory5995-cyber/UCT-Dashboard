"""Live Flow's last saved tape, kept on flow-worker's disk across restarts (L11, 2026-10-08).

WHY. `/api/live/massive/recent` keeps its snapshots in process memory
(`live_massive_router._recent_cache` / `_recent_last_good`). A flow-worker restart empties both,
so until the warmer's first curated scan lands (~70 s at mid-session, after the boot work ahead of
it) every Live Flow load gets the `warming` stub: `alerts: []`. The page then sits on 0 alerts.

WHAT. The flow-worker warmer (`flow_worker_main._start_recent_cache_warmer`) calls `save_due()`
after each pass: the canonical keys' last-good payloads go to one gzipped JSON file next to
flow.db (throttled; atomic replace). On boot `seed()` reads it back into `_recent_last_good` --
ONLY for today's ET session, never another day's tape. The router's own cold path already serves
`_recent_last_good` marked `warming: True` while the fresh fill runs, so a member sees the last
saved tape, labelled (`status.restored_from_disk`, `status.snapshot_saved_at`), instead of nothing.
The first real fill replaces it as before.

This module only reads and writes the router's two module-level dicts; it does not change the
router (partner-owned) or its fill/lease logic.
"""
from __future__ import annotations

import gzip
import json
import logging
import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)
ET = ZoneInfo("America/New_York")

ENABLED_ENV = "LIVE_RECENT_SNAPSHOT_ENABLED"
#: At most one write per this many seconds (a 10k-alert payload is several MB of JSON).
SAVE_EVERY_S = float(os.environ.get("LIVE_RECENT_SNAPSHOT_EVERY_S") or 120.0)
#: A file older than this is not served even on the same day (a worker down for hours).
MAX_AGE_S = float(os.environ.get("LIVE_RECENT_SNAPSHOT_MAX_AGE_S") or 6 * 3600.0)
FILE_NAME = "live_recent_snapshot.json.gz"
_FORMAT = 1

_lock = threading.Lock()
_last_save = 0.0


def enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "1") == "1"


def snapshot_path() -> str:
    d = os.environ.get("LIVE_RECENT_SNAPSHOT_DIR")
    if not d:
        from api.flow_db import _DEFAULT_DB_PATH
        d = os.path.dirname(os.path.abspath(_DEFAULT_DB_PATH))
    return os.path.join(d, FILE_NAME)


def _today_mdyyyy() -> str:
    """The router's own session key, so a saved key and a request key can never disagree."""
    from api import live_massive_router as lmr
    return lmr._today_mdyyyy()


def save(keys, path: str | None = None) -> int:
    """Write today's last-good payload for each key in `keys` (router cache-key tuples).
    Returns how many keys were written; 0 (and no file change) when none has a payload."""
    from api import live_massive_router as lmr
    today = _today_mdyyyy()
    entries = []
    for ck in keys:
        if not ck or ck[0] != today:
            continue
        payload = lmr._recent_last_good.get(tuple(ck))
        if not payload or not payload.get("alerts"):
            continue                       # never persist an empty tape over a real one
        entries.append({"key": list(ck), "payload": payload})
    if not entries:
        return 0
    path = path or snapshot_path()
    body = {"format": _FORMAT, "saved_at": time.time(), "session": today, "entries": entries}
    tmp = f"{path}.tmp-{os.getpid()}"
    with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=1) as f:
        json.dump(body, f, separators=(",", ":"), default=str)
    os.replace(tmp, path)
    return len(entries)


def save_due(keys, path: str | None = None, now: float | None = None) -> int:
    """`save()` at most once per SAVE_EVERY_S; never raises (the warmer must keep running)."""
    global _last_save
    if not enabled():
        return 0
    now = time.monotonic() if now is None else now
    with _lock:
        if now - _last_save < SAVE_EVERY_S:
            return 0
        _last_save = now
    try:
        return save(keys, path)
    except Exception as e:  # noqa: BLE001
        log.warning("[recent-snapshot] save failed: %s", e)
        return 0


def seed(path: str | None = None) -> int:
    """Load the saved tape into the router's `_recent_last_good` for keys that are still cold.
    Only today's session and only a file younger than MAX_AGE_S. Returns keys seeded."""
    if not enabled():
        return 0
    from api import live_massive_router as lmr
    path = path or snapshot_path()
    try:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            body = json.load(f)
    except FileNotFoundError:
        return 0
    except Exception as e:  # noqa: BLE001 -- a torn/old file is skipped, never fatal
        log.warning("[recent-snapshot] unreadable %s: %s", path, e)
        return 0
    today = _today_mdyyyy()
    saved_at = float(body.get("saved_at") or 0)
    if body.get("format") != _FORMAT or body.get("session") != today:
        log.info("[recent-snapshot] not seeding: saved for %s, today is %s", body.get("session"), today)
        return 0
    if time.time() - saved_at > MAX_AGE_S:
        log.info("[recent-snapshot] not seeding: saved %.0fs ago", time.time() - saved_at)
        return 0
    saved_iso = datetime.fromtimestamp(saved_at, ET).isoformat(timespec="seconds")
    n = 0
    for e in body.get("entries") or []:
        ck = tuple(e.get("key") or ())
        payload = e.get("payload") or {}
        if len(ck) != 6 or ck[0] != today or not payload.get("alerts"):
            continue
        if ck in lmr._recent_last_good or ck in lmr._recent_cache:
            continue                       # a real fill got there first: never overwrite it
        status = dict(payload.get("status") or {})
        status.update({"restored_from_disk": True, "snapshot_saved_at": saved_iso})
        lmr._recent_last_good[ck] = {**payload, "status": status}
        n += 1
    if n:
        log.info("[recent-snapshot] seeded %d Live Flow key(s) from %s (saved %s)", n, path, saved_iso)
    return n
