"""D-18 addendum (Friday) item 1 — the log-tail daemon `oi44_align.py` was built for.

⛔ WHY THIS EXISTS. `oi44_align.py` correlates the durable stall record against a captured
`web` log slice, but a captured slice has always been a one-off, and `web` redeploys ~20x/day
(sometimes several times in one hour) -- the pod that stalled is usually gone by the time
anyone thinks to capture its logs. This runs continuously so a slice always exists.

⛔ WHY A SCHEDULED TASK AND NOT A BACKGROUND SHELL. Same reason as `d14_monitor.py`: a
poller started from inside a session dies with the session. This runs from Windows Task
Scheduler as the logged-in user, on a "restart if not running" trigger every 5 minutes.

⛔ MEMORY: WRITE-AND-FLUSH PER LINE, NEVER BUFFER. `railway logs --service X` is an
unbounded live stream; accumulating it in a Python list/string before writing is how a
"log tail" becomes a memory leak. Each line is written and flushed to its rotating file the
moment it arrives -- there is no in-memory buffer to measure, by construction. The `--minutes`
window still records one RSS reading at the 10-minute mark (`rss_check` event) as the proof
that construction held, not as the mechanism that keeps it low.

⛔ `shutil.which`, never a bare name -- the `deploy_watch.py` lesson (a scheduled task's PATH
is not the interactive shell's PATH; a bare "railway" resolves to nothing and looks like 40
back-to-back failures with exit 0, not a missing binary).

Usage:
    python docs/discord-render/instruments/d14_logtail.py --minutes 6
    python docs/discord-render/instruments/d14_logtail.py --self-check
"""
from __future__ import annotations

import argparse
import ctypes
import datetime
import json
import pathlib
import shutil
import subprocess
import sys
import threading
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
LOG_DIR = ROOT / "docs" / "discord-render" / "evidence" / "logs"
EVENTS = LOG_DIR / "logtail-events.jsonl"
LOCK = LOG_DIR / ".logtail.lock"
LOCK_STALE_S = 600

#: ⛔⛔ FOUND 2026-09-18 reading the daemon's own output: the "web" and "flow-worker" TailWorker
#: threads both append to EVENTS with no lock. On Windows, two threads' `open(...).write(...)`
#: calls can interleave mid-line -- measured directly: a captured line read back as
#: `{"t": "...", "gap": "spawn_failed", ...` immediately followed on the SAME line by a second
#: JSON object's tail with no newline between them, corrupting one JSONL record. A resilient
#: parser can recover (skip the byte, resync), but the committed evidence file should not need
#: one. One process-wide lock around every write closes this without adding cross-process
#: coordination (each daemon invocation already holds LOCK for that purpose).
_EVENTS_WRITE_LOCK = threading.Lock()

SERVICES = ("web", "flow-worker")
RETAIN_HOURS = 72
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB hard cap, oldest deleted first
RSS_WARN_MB = 150.0
RECONNECT_BACKOFF_S = 30.0
#: ⛔ MEASURED 2026-09-18: `railway logs --service X` with no --lines/--since/--until does NOT
#: block-and-follow under a piped stdout (this daemon's Popen) the way its own --help text
#: implies -- it dumps its current buffer (~1 MB/service observed) and exits rc=0 within
#: 2-7 s, every time. So this is REALLY a poll-and-append loop, not a true tail -f, and the
#: backoff is the polling interval, not just a reconnect delay. Widened from an initial 5 s
#: (which produced ~1 MB/service/5 s = tens of GB/day, hitting MAX_TOTAL_BYTES within the hour)
#: to keep steady-state volume inside the retention budget while still re-polling often enough
#: that a stall's window is very unlikely to fall entirely inside one gap.


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _write_event(rec: dict) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with _EVENTS_WRITE_LOCK:
        with open(EVENTS, "a", encoding="utf-8", newline="\n") as fh:
            fh.write(json.dumps(rec) + "\n")


def _lock_held() -> bool:
    if not LOCK.exists():
        return False
    try:
        age = time.time() - LOCK.stat().st_mtime
    except OSError:
        return False
    return age < LOCK_STALE_S


def _hour_str(t: "datetime.datetime | None" = None) -> str:
    t = t or datetime.datetime.now(datetime.timezone.utc)
    return t.strftime("%Y%m%d-%H")


def _current_log_path(service: str) -> pathlib.Path:
    return LOG_DIR / f"{service}-{_hour_str()}.log"


def _process_rss_mb() -> "float | None":
    """Current process's working-set size in MB. Windows-only (this daemon runs on the
    operator's box, not the Linux pod), dependency-free (no psutil in requirements.txt)."""
    if sys.platform != "win32":
        return None
    try:
        import ctypes.wintypes as wintypes

        class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = PROCESS_MEMORY_COUNTERS()
        counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
        handle = ctypes.windll.kernel32.GetCurrentProcess()
        ok = ctypes.windll.psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb)
        if ok:
            return round(counters.WorkingSetSize / (1024 * 1024), 1)
    except Exception:
        return None
    return None


def _prune(log_dir: "pathlib.Path | None" = None) -> None:
    """Delete rolling log files older than RETAIN_HOURS; if the surviving set still exceeds
    MAX_TOTAL_BYTES, delete oldest-first until it doesn't. Never touches EVENTS or LOCK.
    `log_dir` is injectable (never a module-global mutation) so the self-check can point it
    at a throwaway directory without touching the real one."""
    d = log_dir if log_dir is not None else LOG_DIR
    if not d.exists():
        return
    cutoff = time.time() - RETAIN_HOURS * 3600
    files = sorted(
        (p for p in d.glob("*.log") if p.is_file()),
        key=lambda p: p.stat().st_mtime,
    )
    for p in files:
        try:
            if p.stat().st_mtime < cutoff:
                p.unlink()
        except OSError:
            pass
    files = sorted(
        (p for p in d.glob("*.log") if p.is_file()),
        key=lambda p: p.stat().st_mtime,
    )
    total = sum(p.stat().st_size for p in files)
    i = 0
    while total > MAX_TOTAL_BYTES and i < len(files):
        try:
            sz = files[i].stat().st_size
            files[i].unlink()
            total -= sz
        except OSError:
            pass
        i += 1


class TailWorker(threading.Thread):
    """One `railway logs --service <name>` stream, written line-by-line to the current
    rotating file, reconnecting on stream loss until `stop_event` is set."""

    def __init__(self, service: str, railway_bin: str, stop_event: threading.Event):
        super().__init__(daemon=True, name=f"logtail-{service}")
        self.service = service
        self.railway_bin = railway_bin
        self.stop_event = stop_event

    def run(self) -> None:
        while not self.stop_event.is_set():
            path = _current_log_path(self.service)
            try:
                # cwd=ROOT: the Railway CLI resolves its linked project from the working
                # directory (the d14_monitor lesson) -- a scheduled task has none of its own.
                proc = subprocess.Popen(
                    [self.railway_bin, "logs", "--service", self.service],
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, encoding="utf-8", errors="replace",
                    cwd=str(ROOT), bufsize=1,
                )
            except Exception as e:  # noqa: BLE001 -- a spawn failure is a record, never a crash
                _write_event({"t": _now(), "gap": "spawn_failed", "service": self.service,
                             "detail": repr(e)[:160]})
                time.sleep(RECONNECT_BACKOFF_S)
                continue

            _write_event({"t": _now(), "event": "stream_started", "service": self.service,
                         "pid": proc.pid})
            fh = open(path, "a", encoding="utf-8", newline="\n")
            try:
                for line in proc.stdout:
                    new_path = _current_log_path(self.service)
                    if new_path != path:
                        fh.close()
                        path = new_path
                        fh = open(path, "a", encoding="utf-8", newline="\n")
                    fh.write(line if line.endswith("\n") else line + "\n")
                    fh.flush()  # per-line -- no in-memory buffer to lose or to leak
                    if self.stop_event.is_set():
                        break
            except Exception as e:  # noqa: BLE001
                _write_event({"t": _now(), "gap": "read_exception", "service": self.service,
                             "detail": repr(e)[:160]})
            finally:
                fh.close()
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except Exception:
                    proc.kill()

            rc = proc.poll()
            _write_event({"t": _now(), "gap": "stream_ended", "service": self.service,
                         "returncode": rc})
            if self.stop_event.is_set():
                break
            time.sleep(RECONNECT_BACKOFF_S)


def self_check() -> int:
    """Controls: the lock holds and releases; a bad railway binary produces a gap record,
    never a crash; pruning deletes what it should and keeps what it should."""
    import tempfile

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    LOCK.write_text(_now(), encoding="utf-8")
    ok_lock = _lock_held()
    LOCK.unlink(missing_ok=True)
    ok_free = not _lock_held()

    stop = threading.Event()
    w = TailWorker("web", "definitely-not-a-real-binary-xyz", stop)
    before = len(list(EVENTS.parent.glob("*")))
    w.start()
    time.sleep(RECONNECT_BACKOFF_S + 2)
    stop.set()
    w.join(timeout=5)
    events_text = EVENTS.read_text(encoding="utf-8") if EVENTS.exists() else ""
    ok_gap = '"gap": "spawn_failed"' in events_text

    with tempfile.TemporaryDirectory() as td:
        tdp = pathlib.Path(td)
        old = tdp / "web-old.log"
        old.write_bytes(b"x" * 100)
        import os as _os
        old_time = time.time() - (RETAIN_HOURS + 1) * 3600
        _os.utime(old, (old_time, old_time))
        keep = tdp / "web-new.log"
        keep.write_bytes(b"y" * 100)
        _prune(log_dir=tdp)
        ok_prune = (not old.exists()) and keep.exists()

    checks = {"lock_holds": ok_lock, "lock_releases": ok_free,
             "gap_on_bad_binary": ok_gap, "prune_deletes_old_keeps_new": ok_prune}
    bad = [k for k, v in checks.items() if not v]
    for k, v in checks.items():
        print(f"  {'ok  ' if v else 'FAIL'} {k}")
    print(f"TOTALS d14_logtail --self-check {'PASS' if not bad else 'FAIL'} "
          f"declared={len(checks)} failed={len(bad)}")
    return 0 if not bad else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=6.0)
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()

    if a.self_check:
        return self_check()

    if _lock_held():
        print("another logtail holds the lock; exiting without a second copy")
        return 0

    railway = shutil.which("railway") or shutil.which("railway.cmd")
    if not railway:
        _write_event({"t": _now(), "gap": "railway_cli_not_on_path"})
        print("railway CLI not resolvable")
        return 2

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    stop_event = threading.Event()
    workers = [TailWorker(s, railway, stop_event) for s in SERVICES]
    for w in workers:
        w.start()

    start = time.time()
    _write_event({"t": _now(), "event": "logtail_started", "services": list(SERVICES)})
    deadline = start + a.minutes * 60.0
    rss_checked = False
    while time.time() < deadline:
        LOCK.write_text(_now(), encoding="utf-8")
        if not rss_checked and time.time() - start > 600:
            rss = _process_rss_mb()
            _write_event({"t": _now(), "event": "rss_check", "rss_mb": rss,
                         "over_threshold": bool(rss is not None and rss > RSS_WARN_MB)})
            rss_checked = True
        _prune()
        time.sleep(15)

    stop_event.set()
    for w in workers:
        w.join(timeout=10)
    _write_event({"t": _now(), "event": "logtail_window_ended"})
    LOCK.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
