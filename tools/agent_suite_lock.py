"""UCT Agent program — machine-wide limit on concurrent FULL Agent test suites.

  python tools/agent_suite_lock.py run --who agent-md -- <command …>   # wait for a slot, run, release
  python tools/agent_suite_lock.py status

Why: several Claude sessions share one PC and one node_modules. Three concurrent gate runs once used
~11.8 GB and broke the shared install (CLAUDE.md). At most SLOTS full suites run at once; the rest wait.

Slots are files in C:\\UCT\\.agent-suite-locks (UCT_AGENT_SUITE_LOCK_DIR overrides), created atomically.
A slot whose process is gone, or older than STALE_S, is reclaimed. Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

LOCK_DIR = Path(os.environ.get("UCT_AGENT_SUITE_LOCK_DIR") or r"C:\UCT\.agent-suite-locks")
SLOTS = int(os.environ.get("UCT_AGENT_SUITE_SLOTS") or 2)
STALE_S = 2 * 3600
WAIT_S = 15
TIMEOUT_S = 90 * 60


def _alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes
        k = ctypes.windll.kernel32
        h = k.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        code = ctypes.c_ulong()
        k.GetExitCodeProcess(h, ctypes.byref(code))
        k.CloseHandle(h)
        return code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _read(p: Path) -> dict:
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _reclaim() -> None:
    for p in LOCK_DIR.glob("slot-*.json"):
        d = _read(p)
        if not d or not _alive(int(d.get("pid", 0))) or time.time() - float(d.get("at", 0)) > STALE_S:
            try:
                p.unlink()
            except OSError:
                pass


def acquire(who: str) -> Path:
    LOCK_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    while True:
        _reclaim()
        for i in range(SLOTS):
            p = LOCK_DIR / f"slot-{i}.json"
            try:
                fd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                continue
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump({"who": who, "pid": os.getpid(), "at": time.time(), "cwd": os.getcwd()}, f)
            return p
        if time.time() - t0 > TIMEOUT_S:
            raise SystemExit("timed out waiting for an Agent suite slot")
        holders = ", ".join(_read(p).get("who", "?") for p in LOCK_DIR.glob("slot-*.json"))
        print(f"[suite-lock] all {SLOTS} slots busy ({holders}); waiting {WAIT_S}s", flush=True)
        time.sleep(WAIT_S)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--who", required=True)
    r.add_argument("command", nargs=argparse.REMAINDER)
    sub.add_parser("status")
    a = ap.parse_args(argv)
    if a.cmd == "status":
        LOCK_DIR.mkdir(parents=True, exist_ok=True)
        _reclaim()
        held = [_read(p) for p in sorted(LOCK_DIR.glob("slot-*.json"))]
        print(f"{len(held)}/{SLOTS} slots in use" + "".join(f"\n  {d.get('who')} pid={d.get('pid')} since {time.strftime('%H:%M:%S', time.localtime(d.get('at', 0)))}" for d in held))
        return 0
    cmd = a.command[1:] if a.command[:1] == ["--"] else a.command
    if not cmd:
        ap.error("run needs a command after --")
    # Windows: `npx`/`npm` are .cmd scripts CreateProcess cannot start by bare name — resolve, and run
    # .cmd/.bat through cmd /c (arguments stay a list, no shell string is built)
    exe = shutil.which(cmd[0]) or cmd[0]
    cmd = (["cmd", "/c", exe] if os.name == "nt" and exe.lower().endswith((".cmd", ".bat")) else [exe]) + cmd[1:]
    slot = acquire(a.who)
    try:
        return subprocess.call(cmd)
    finally:
        try:
            slot.unlink()
        except OSError:
            pass


if __name__ == "__main__":
    sys.exit(main())
