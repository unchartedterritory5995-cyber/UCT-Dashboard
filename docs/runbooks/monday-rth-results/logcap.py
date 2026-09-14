"""Periodic flow-worker log capture.

`railway logs` returns a CAPPED buffer -- measured 2026-09-14: 500 lines,
spanning ~61 minutes. Items 5 and 7 both need log evidence over the whole
session, so the buffer must be drained repeatedly or it rolls away. This
appends new lines (deduped by timestamp+message) to a single JSONL file.

Read-only.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "flowworker-log-stream.jsonl")
STOP = os.path.join(HERE, "STOP-POLLER")
ET = datetime.timezone(datetime.timedelta(hours=-4))
INTERVAL = float(os.environ.get("LOGCAP_INTERVAL", "240"))

# `subprocess` cannot resolve a Windows .cmd/.exe shim without which(); a bare
# name yields FileNotFoundError forty times and then exit 0 (deploy_watch v1).
RAILWAY = shutil.which("railway")


def main():
    if not RAILWAY:
        print("INCONCLUSIVE: railway CLI not resolvable on PATH")
        return 2
    deadline = time.time() + float(sys.argv[1]) if len(sys.argv) > 1 else None
    seen = set()
    if os.path.exists(OUT):
        for line in open(OUT, encoding="utf-8", errors="replace"):
            try:
                seen.add(json.loads(line)["_h"])
            except Exception:                                 # noqa: BLE001
                pass
    cycles = 0
    while True:
        if os.path.exists(STOP) or (deadline and time.time() > deadline):
            break
        try:
            p = subprocess.run([RAILWAY, "logs", "--service", "flow-worker",
                                "--json"],
                               capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=180)
            new = 0
            with open(OUT, "a", encoding="utf-8") as f:
                for line in (p.stdout or "").splitlines():
                    try:
                        o = json.loads(line)
                    except Exception:                          # noqa: BLE001
                        continue
                    h = hashlib.sha1(
                        (str(o.get("timestamp")) + str(o.get("message"))
                         ).encode("utf-8", "replace")).hexdigest()[:16]
                    if h in seen:
                        continue
                    seen.add(h)
                    o["_h"] = h
                    o["_captured_et"] = datetime.datetime.now(
                        datetime.timezone.utc).astimezone(ET).isoformat()
                    f.write(json.dumps(o, default=str) + "\n")
                    new += 1
            print("cycle %d: +%d new (total seen %d) rc=%s"
                  % (cycles, new, len(seen), p.returncode), flush=True)
        except Exception as e:                                 # noqa: BLE001
            print("cycle %d ERROR %r" % (cycles, e), flush=True)
        cycles += 1
        time.sleep(INTERVAL)
    return 0


if __name__ == "__main__":
    sys.exit(main())
