"""disk_watchdog.py — volume-level disk monitor for the /data Railway volumes.

THE PROBLEM (2026-07-23): the options tape spool paused itself on a disk budget
and gap capture stayed dead for three trading days. Nobody noticed, because the
only thing watching disk was the spool's OWN budget check — a per-feature guard
that alerts about ITSELF, in ITS OWN terms ("spool 4.0GB / free 6.2GB"). It said
nothing about the actual cause, which was 33GB of unpruned gap-fill backups in a
sibling directory quietly squeezing everything else off a 46GB volume.

So the incident had two failures, and fixing the spool only addressed the first:
  1. a specific retention sweep was unreachable  → fixed in flow_tape_spool.py
  2. NOTHING watched the volume as a whole       → this module

This is the detector for the CLASS. It doesn't know or care which subsystem is
misbehaving: it watches total usage, and when the volume crosses a threshold it
names the TOP CONSUMERS by size and how much each grew since the last check. A
future runaway — in a sweep nobody has audited, or a directory that doesn't exist
yet — surfaces the same way, with the culprit already identified, days before it
starves a neighbour.

Design notes, all learned from the incident:
  - Threshold CROSSINGS alert, and a still-over state RE-alerts on a cadence.
    A one-shot edge is what let the spool sit silent for three days; worse, every
    restart re-fired the same edge, so a stuck state read as a fresh transient one.
  - Recovery is announced. "No news" must never be the only evidence of health.
  - Best-effort throughout: a watchdog that can crash the pod it watches is worse
    than no watchdog. Every public entry point swallows its exceptions.
  - Read-only. It never deletes anything — deciding what is expendable belongs to
    the subsystem that wrote it, not to a monitor.
"""
import os
import shutil
import threading
import time

DATA_DIR = os.environ.get("DATA_DIR", "/data")
ENABLED = os.environ.get("DISK_WATCHDOG_ENABLED", "1").lower() in ("1", "true", "yes")
CHECK_SECONDS = int(os.environ.get("DISK_WATCHDOG_CHECK_SECONDS", "1800"))     # 30 min
WARN_PCT = float(os.environ.get("DISK_WATCHDOG_WARN_PCT", "75"))
CRIT_PCT = float(os.environ.get("DISK_WATCHDOG_CRIT_PCT", "90"))
REALERT_SECONDS = int(os.environ.get("DISK_WATCHDOG_REALERT_SECONDS", str(6 * 3600)))
TOP_N = int(os.environ.get("DISK_WATCHDOG_TOP_N", "6"))
# A consumer that jumps this much between checks is worth naming even when the
# volume is still comfortable — that is the early warning the incident lacked.
GROWTH_ALERT_GB = float(os.environ.get("DISK_WATCHDOG_GROWTH_ALERT_GB", "5"))
SERVICE = (os.environ.get("RAILWAY_SERVICE_NAME")
           or os.environ.get("SERVICE_NAME") or "unknown")

_GB = float(1 << 30)
_lock = threading.Lock()
_thread = None
_started = False
_state = {
    "level": "ok",              # ok | warn | crit
    "last_alert_at": 0.0,
    "last_check_at": 0.0,
    "last_sizes": {},           # path -> bytes, from the previous check
    "last_report": None,
    "checks": 0,
    "alerts_sent": 0,
}


def _human(n: float) -> str:
    return f"{n / _GB:.1f}GB"


def _dir_size(path: str) -> int:
    """Recursive size. Symlinks are NOT followed — a link into another tree would
    otherwise be double-counted, or worse, walked into a cycle."""
    total = 0
    try:
        with os.scandir(path) as it:
            for entry in it:
                try:
                    if entry.is_symlink():
                        continue
                    if entry.is_file(follow_symlinks=False):
                        total += entry.stat(follow_symlinks=False).st_size
                    elif entry.is_dir(follow_symlinks=False):
                        total += _dir_size(entry.path)
                except OSError:
                    continue
    except OSError:
        pass
    return total


def top_consumers(limit: int = TOP_N) -> list:
    """[(name, bytes)] for the largest immediate children of DATA_DIR, largest
    first. Immediate children only: this is a 'who do I go look at' signal, and
    a full recursive ranking would cost far more walking for no extra clarity."""
    out = []
    try:
        with os.scandir(DATA_DIR) as it:
            for entry in it:
                try:
                    if entry.is_symlink():
                        continue
                    if entry.is_dir(follow_symlinks=False):
                        out.append((entry.name, _dir_size(entry.path)))
                    elif entry.is_file(follow_symlinks=False):
                        out.append((entry.name, entry.stat(follow_symlinks=False).st_size))
                except OSError:
                    continue
    except OSError:
        return []
    out.sort(key=lambda e: e[1], reverse=True)
    return out[:limit]


def snapshot() -> dict:
    """Current usage + ranked consumers. Safe to call from a request handler."""
    usage = shutil.disk_usage(DATA_DIR)
    pct = (usage.used / usage.total * 100.0) if usage.total else 0.0
    consumers = top_consumers()
    return {
        "service": SERVICE,
        "data_dir": DATA_DIR,
        "total_bytes": usage.total,
        "used_bytes": usage.used,
        "free_bytes": usage.free,
        "used_pct": round(pct, 1),
        "level": _level_for(pct),
        "top_consumers": [{"name": n, "bytes": b, "human": _human(b)} for n, b in consumers],
    }


def _level_for(pct: float) -> str:
    if pct >= CRIT_PCT:
        return "crit"
    if pct >= WARN_PCT:
        return "warn"
    return "ok"


def _post(msg: str) -> None:
    try:
        from api.flow_gap_autofill import _post_discord
        _post_discord(msg)
    except Exception:
        pass


def _growth_lines(consumers: list) -> list:
    """Name anything that grew by more than GROWTH_ALERT_GB since the last check.
    Size alone says who is big; growth says who is RUNNING AWAY, which is the
    thing you actually want to catch before it matters."""
    prev = _state.get("last_sizes") or {}
    lines = []
    for name, size in consumers:
        was = prev.get(name)
        if was is None:
            continue
        delta = size - was
        if delta >= GROWTH_ALERT_GB * _GB:
            lines.append(f"  ↑ {name} grew +{_human(delta)} since last check")
    return lines


def check_once() -> dict:
    """One measurement + alert decision. Returns the snapshot (never raises)."""
    try:
        snap = snapshot()
    except Exception:
        return {}

    consumers = [(c["name"], c["bytes"]) for c in snap["top_consumers"]]
    growth = _growth_lines(consumers)
    level = snap["level"]
    now = time.time()

    with _lock:
        prev_level = _state["level"]
        last_alert = _state["last_alert_at"]
        _state["level"] = level
        _state["last_check_at"] = now
        _state["last_report"] = snap
        _state["checks"] += 1
        _state["last_sizes"] = {n: b for n, b in consumers}

        worsened = (level != "ok" and level != prev_level)
        stale = (level != "ok" and (now - last_alert) > REALERT_SECONDS)
        recovered = (level == "ok" and prev_level != "ok")
        should_alert = worsened or stale or recovered or bool(growth)
        if should_alert:
            _state["last_alert_at"] = now
            _state["alerts_sent"] += 1

    if not should_alert:
        return snap

    listing = "\n".join(
        f"  {c['human']:>8}  {c['name']}" for c in snap["top_consumers"])
    head = (f"{_human(snap['used_bytes'])} / {_human(snap['total_bytes'])} used "
            f"({snap['used_pct']}%), {_human(snap['free_bytes'])} free")

    if recovered:
        _post(f"✅ DISK OK on `{SERVICE}` — {head}")
    elif level != "ok":
        icon = "🔴" if level == "crit" else "⚠️"
        _post(f"{icon} DISK {level.upper()} on `{SERVICE}` ({DATA_DIR}) — {head}\n"
              f"Top consumers:\n{listing}"
              + ("\n" + "\n".join(growth) if growth else ""))
    elif growth:
        _post(f"📈 DISK growth on `{SERVICE}` — {head}\n" + "\n".join(growth)
              + f"\nTop consumers:\n{listing}")
    return snap


def _loop() -> None:
    # Let the pod finish booting; a cold start has better things to do than walk
    # the volume, and the first reading is more honest once caches settle.
    time.sleep(float(os.environ.get("DISK_WATCHDOG_STARTUP_DELAY", "120")))
    while True:
        try:
            check_once()
        except Exception:
            pass
        time.sleep(max(60, CHECK_SECONDS))


def start() -> bool:
    """Idempotent. Returns True if this call started the watchdog."""
    global _thread, _started
    if not ENABLED:
        return False
    with _lock:
        if _started:
            return False
        _thread = threading.Thread(target=_loop, daemon=True, name="disk-watchdog")
        _thread.start()
        _started = True
    return True


def get_status() -> dict:
    with _lock:
        return {
            "enabled": ENABLED,
            "running": bool(_thread and _thread.is_alive()),
            "service": SERVICE,
            "data_dir": DATA_DIR,
            "warn_pct": WARN_PCT,
            "crit_pct": CRIT_PCT,
            "check_seconds": CHECK_SECONDS,
            "level": _state["level"],
            "checks": _state["checks"],
            "alerts_sent": _state["alerts_sent"],
            "last_check_at": _state["last_check_at"],
            "last_report": _state["last_report"],
        }
