r"""R31 — the boot-to-minute-25 loop trace, with the durable record beside it.

⛔⛔ **THE LOOP READING MUST COME OVER HTTP, FROM THE UVICORN PROCESS.** `loopwatch`'s
trailing window is IN-PROCESS module state. A `railway ssh` probe is a *different*
process on the same pod: importing `loopwatch` there yields a fresh, never-started
watcher, and `loopwatch.snapshot()` answers `{"running": false, "samples": 0,
"max_ms": null}` — every single time, on a perfectly healthy pod.

⚰️ **MEASURED, 2026-09-17.** The first version of this trace did exactly that and wrote
19 rows of `running: false, samples: 0` while `d14_monitor.py`, polling the SAME pod over
HTTP in the SAME minute, recorded `running: true, samples: 600, max_ms: 507.1`. Two
instruments, one pod, one minute, opposite answers — and the ssh one reads like a
finding ("the loop watcher is dead!") rather than like a blank. That is this programme's
standing failure class one more time: **an instrument reporting a property of ITSELF as a
property of what it measured.** Every `loop` block in `r31-trace.jsonl` before
`loop_src: "http"` appears is VACUOUS and must not be scored.

⭐ **The durable halves are the opposite case and are read the opposite way.** The stall
record and the token-slot counters live on the VOLUME, so any process on the pod reads
the same bytes — which is exactly why W1 made them durable (`web` restarts ~20x/day and
in-memory counters answer "since the last deploy, twenty minutes ago"). Reading them
through the module import is correct AND is the only route available today, because
OI-47 drops `stall_record` / `token_slot_counts` from the health payload on the
no-jobs-database early return.

⛔ Every field therefore carries its SOURCE (`loop_src`, `slots_src`). A reading whose
provenance is not stated is a reading nobody can re-derive.

Usage:
    python docs/discord-render/instruments/r31_boot_trace.py --minutes 240 --interval 60
    python docs/discord-render/instruments/r31_boot_trace.py --self-check
"""
from __future__ import annotations

import argparse
import base64
import datetime
import json
import pathlib
import shutil
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT_DIR = ROOT / "docs" / "discord-render" / "evidence" / "d14-monitor"
OUT_FILE = OUT_DIR / "r31-trace.jsonl"

PROBE = r'''
import os, sys, json, datetime, urllib.request
sys.path.insert(0, "/app"); os.chdir("/app")
port = os.environ.get("PORT", "8080")
def g(p, auth=False):
    # The bearer is read from the POD's own env and never leaves it (C-13).
    h = {"Authorization": "Bearer " + os.environ.get("PUSH_SECRET", "")} if auth else {}
    with urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:%s%s" % (port, p), headers=h), timeout=25) as r:
        return json.loads(r.read().decode())
o = {"t": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
     "sha": os.environ.get("RAILWAY_GIT_COMMIT_SHA", "?")[:12]}
try:
    o["uptime_s"] = g("/api/health").get("uptime_seconds")
except Exception as e:
    o["health_err"] = repr(e)[:80]
# IN-PROCESS state -> HTTP. Importing loopwatch here would report THIS process.
try:
    o["loop"] = g("/api/discord/render-health", True).get("loop")
    o["loop_src"] = "http"
except Exception as e:
    o["loop_err"] = repr(e)[:80]
# VOLUME-BACKED state -> import. Same bytes from any process on the pod.
try:
    from api.services.discord_render import stall_record, token_slots
    sr = stall_record.snapshot()
    o["lifetime_max_ms"] = sr.get("lifetime_max_ms")
    o["lifetime_count"] = sr.get("lifetime_count")
    o["below_floor"] = sr.get("below_floor_count")
    o["recorded"] = sr.get("total_recorded")
    o["events"] = sr.get("recent", [])[-5:]
    ts = token_slots.snapshot()
    o["slots"] = {k: (v or {}).get("count") for k, v in (ts.get("slots") or {}).items()}
    o["slots_since"] = ts.get("since")
    o["slots_unreadable"] = bool(ts.get("unreadable"))
    o["slots_src"] = "volume"
except Exception as e:
    o["err"] = repr(e)[:120]
print(json.dumps(o))
'''


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def poll_once(railway: str) -> dict:
    """One probe. A failure is a RECORDED gap, never a crash and never a silence."""
    payload = base64.b64encode(PROBE.encode()).decode()
    cmd = [railway, "ssh", "--service", "web",
           "echo %s | base64 -d > /tmp/r31p.py && /opt/venv/bin/python /tmp/r31p.py" % payload]
    try:
        # ⛔⛔ cwd=ROOT IS LOAD-BEARING. The Railway CLI resolves its linked project from the
        # WORKING DIRECTORY; run anywhere else and every call answers "No linked project
        # found" — rc=1, no JSON, a `gap` every poll, while the file keeps growing.
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=180,
                           encoding="utf-8", errors="replace", cwd=str(ROOT))
    except Exception as e:  # noqa: BLE001
        return {"t": _now(), "gap": "probe_exception", "detail": repr(e)[:120]}
    for line in (p.stdout or "").splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except ValueError:
                continue
    return {"t": _now(), "gap": "probe_no_json", "rc": p.returncode}


def _write(rec: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(rec) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=240.0)
    ap.add_argument("--interval", type=float, default=60.0)
    ap.add_argument("--self-check", action="store_true",
                    help="prove a failed probe RECORDS a gap rather than writing nothing")
    a = ap.parse_args()

    if a.self_check:
        rec = poll_once("definitely-not-a-real-binary-xyz")
        ok = "gap" in rec
        print(f"self-check: unresolvable binary -> {'GAP RECORDED' if ok else 'NO GAP (BAD)'}: {rec}")
        return 0 if ok else 1

    railway = shutil.which("railway")
    if not railway:
        print("railway CLI not on PATH", file=sys.stderr)
        return 2
    deadline = time.time() + a.minutes * 60.0
    while time.time() < deadline:
        _write(poll_once(railway))
        time.sleep(a.interval)
    return 0


if __name__ == "__main__":
    sys.exit(main())
