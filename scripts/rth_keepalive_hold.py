"""Hold the display and system awake for the RTH window.

SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED) tells
Windows "do not sleep, do not blank the display" for as long as THIS THREAD lives. That
last part is the whole design constraint: the flag dies with the process, so this must be
a living loop, not a one-shot call. A script that sets the flag and exits has done
nothing at all -- and would look exactly like a script that worked.

⛔ IT CANNOT UNLOCK AN ALREADY-LOCKED SCREEN. Nothing in user space can. Keeping a
session from locking and rescuing a locked one are different problems; only the first is
solvable here, which is why the preflight has to fail loudly on the second.

Exits when the stop file appears or the deadline passes, whichever comes first. Both are
belt and braces for the same thing: never hold the machine awake past the window.
"""
from __future__ import annotations

import ctypes
import datetime
import json
import os
import sys
import time

ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001
ES_DISPLAY_REQUIRED = 0x00000002


def main() -> int:
    stop_file = sys.argv[1]
    deadline = datetime.datetime.fromisoformat(sys.argv[2])
    heartbeat = os.path.join(os.path.dirname(stop_file), "keepalive-heartbeat.json")

    ok = ctypes.windll.kernel32.SetThreadExecutionState(
        ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
    if ok == 0:
        print("SetThreadExecutionState FAILED - the machine may sleep", flush=True)
        return 2
    print("execution state held (continuous|system|display); deadline %s, stop file %s"
          % (deadline, stop_file), flush=True)

    try:
        while True:
            now = datetime.datetime.now()
            if os.path.exists(stop_file):
                print("stop file seen at %s - releasing" % now, flush=True)
                return 0
            if now >= deadline:
                print("deadline %s reached - releasing" % deadline, flush=True)
                return 0
            try:
                with open(heartbeat, "w", encoding="utf-8") as fh:
                    json.dump({"held": True, "now": now.isoformat(),
                               "deadline": deadline.isoformat(),
                               "pid": os.getpid()}, fh, indent=1)
            except Exception:                      # a heartbeat must never kill the hold
                pass
            # Re-assert every tick. The flag is per-thread and continuous, so this is
            # belt and braces against anything that clears it out from under us.
            ctypes.windll.kernel32.SetThreadExecutionState(
                ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
            time.sleep(20)
    finally:
        # Release back to normal power behaviour. Without this the machine would stay
        # awake until reboot if the process is killed rather than asked to stop.
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)
        print("execution state released", flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
