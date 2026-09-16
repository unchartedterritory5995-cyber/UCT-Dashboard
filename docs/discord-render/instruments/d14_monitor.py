"""D-14 A5/C1 — the loop + boot-window poller that outlives a Claude Code session.

⛔ WHY A SCHEDULED TASK AND NOT A BACKGROUND SHELL. A poller started from inside a
session dies with the session, so the overnight boot windows — the evidence OI-44/D7
needs across >= 10 pods — are exactly the ones never captured. This runs from Windows
Task Scheduler as the logged-in user.

⛔ A GAP IS NOT A ZERO. Every failed probe writes an explicit `gap` record. A silent
absence would read as "no stall", which is the defect this programme keeps paying for.

⛔ `shutil.which`, never a bare name. A scheduled task's PATH is not the shell's, and
`subprocess` cannot resolve a `.cmd` shim on Windows without it — that is the
`deploy_watch.py` failure (forty FileNotFoundErrors, then exit 0).

Single invocation runs until `--minutes` elapses, holding a lock so the 5-minute
"restart if dead" trigger cannot start a second copy.
"""
from __future__ import annotations

import argparse
import base64
import datetime
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT_DIR = ROOT / "docs" / "discord-render" / "evidence" / "d14-monitor"
LOCK = OUT_DIR / ".poller.lock"
LOCK_STALE_S = 600

PROBE = r'''
import os, json, datetime, urllib.request
port = os.environ.get("PORT", "8080"); sec = os.environ.get("PUSH_SECRET", "")
def g(p, auth=False):
    h = {"Authorization": "Bearer " + sec} if auth else {}
    with urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:%s%s" % (port, p), headers=h), timeout=25) as r:
        return json.loads(r.read().decode())
o = {"t": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
try:
    o["uptime_s"] = g("/api/health").get("uptime_seconds")
    d = g("/api/discord/render-health", True)
    o["loop"] = d.get("loop")
    o["stall_record"] = d.get("stall_record")      # present once W1 commit A is live
    o["token_slots"] = d.get("token_slot_counts")  # present once W1 commit B is live
    o["sha"] = os.environ.get("RAILWAY_GIT_COMMIT_SHA", "?")[:12]
except Exception as e:
    o["err"] = repr(e)[:120]
print(json.dumps(o))
'''


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _write(rec: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_DIR / "loop-boot-windows.jsonl", "a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(rec) + "\n")


def _lock_held() -> bool:
    """True if another copy is alive. A stale lock (older than LOCK_STALE_S) is ours to take."""
    if not LOCK.exists():
        return False
    try:
        age = time.time() - LOCK.stat().st_mtime
    except OSError:
        return False
    return age < LOCK_STALE_S


def poll_once(railway: str) -> dict:
    payload = base64.b64encode(PROBE.encode()).decode()
    cmd = [railway, "ssh", "--service", "web",
           "echo %s | base64 -d > /tmp/d14m.py && /opt/venv/bin/python /tmp/d14m.py" % payload]
    try:
        # ⛔⛔ cwd=ROOT IS LOAD-BEARING, NOT TIDINESS. The Railway CLI resolves its linked
        # project FROM THE WORKING DIRECTORY. A scheduled task has no working directory, so it
        # runs in C:\Windows\System32 and every call answers "No linked project found" -- rc=1,
        # no JSON, a `gap` every poll, while the file keeps growing and the task reads healthy.
        # Measured 2026-09-16: 8 gaps / 7 successes, the successes coming from a DIFFERENT
        # poller that happened to still be alive in a repo cwd. Pin it here rather than in the
        # task definition, so the fix travels with the script -- R49's rollback call depends on
        # the same resolution and would otherwise be handless in production.
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=180,
                           encoding="utf-8", errors="replace", cwd=str(ROOT))
    except Exception as e:  # noqa: BLE001 — a probe failure is a RECORD, never a crash
        return {"t": _now(), "gap": "probe_exception", "detail": repr(e)[:120]}
    for line in (p.stdout or "").splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except ValueError:
                continue
    return {"t": _now(), "gap": "probe_no_json", "rc": p.returncode}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=360.0)
    ap.add_argument("--interval", type=float, default=90.0)
    ap.add_argument("--self-check", action="store_true",
                    help="prove the gap record and the lock work, without touching production")
    a = ap.parse_args()

    if a.self_check:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        rec = poll_once("definitely-not-a-real-binary-xyz")
        ok_gap = "gap" in rec
        LOCK.write_text(_now(), encoding="utf-8")
        ok_lock = _lock_held()
        LOCK.unlink(missing_ok=True)
        ok_free = not _lock_held()
        print("self-check gap_on_failure=%s lock_holds=%s lock_releases=%s" % (ok_gap, ok_lock, ok_free))
        print("TOTALS d14_monitor --self-check %s declared=3 evaluated=3 failed=%d"
              % ("PASS" if (ok_gap and ok_lock and ok_free) else "FAIL",
                 3 - sum([ok_gap, ok_lock, ok_free])))
        return 0 if (ok_gap and ok_lock and ok_free) else 1

    if _lock_held():
        print("another poller holds the lock; exiting without a second copy")
        return 0

    railway = shutil.which("railway") or shutil.which("railway.cmd")
    if not railway:
        _write({"t": _now(), "gap": "railway_cli_not_on_path"})
        print("railway CLI not resolvable")
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + a.minutes * 60.0
    _write({"t": _now(), "event": "poller_started", "pid": os.getpid(), "interval_s": a.interval})
    while time.time() < deadline:
        LOCK.write_text(_now(), encoding="utf-8")
        _write(poll_once(railway))
        time.sleep(a.interval)
    _write({"t": _now(), "event": "poller_window_ended"})
    LOCK.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
