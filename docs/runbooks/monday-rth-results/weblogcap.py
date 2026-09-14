"""Periodic WEB log capture.

flow-worker sees every /api/flow/* request arriving from ONE source IP -- the
web pod's proxy (FLOW_READS_PROXY_ENABLED). So flow-worker's access log cannot
answer item 7 ("are MEMBERS on parts?"): it cannot tell a member's browser from
the rig from the proxy retrying. Web's own access log is the layer where a
member request first lands, so it is captured too.

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
OUT = os.path.join(HERE, "web-log-stream.jsonl")
STOP = os.path.join(HERE, "STOP-POLLER")
ET = datetime.timezone(datetime.timedelta(hours=-4))
INTERVAL = float(os.environ.get("WEBLOGCAP_INTERVAL", "240"))
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
            except Exception:                                  # noqa: BLE001
                pass
    cycles = 0
    while True:
        if os.path.exists(STOP) or (deadline and time.time() > deadline):
            break
        try:
            p = subprocess.run([RAILWAY, "logs", "--service", "web", "--json"],
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
            print("cycle %d: +%d new (total %d) rc=%s"
                  % (cycles, new, len(seen), p.returncode), flush=True)
        except Exception as e:                                 # noqa: BLE001
            print("cycle %d ERROR %r" % (cycles, e), flush=True)
        cycles += 1
        time.sleep(INTERVAL)
    return 0


if __name__ == "__main__":
    sys.exit(main())
