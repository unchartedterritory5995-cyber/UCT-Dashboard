"""Process entry for the dedicated Breadth V2 producer service (`breadth-v2-runner`).

railway.json dispatches here when `BREADTH_V2_PRODUCER_ENABLED=1`. One process, one flock, one
loop — the ONE scheduler owner of canonical live V2 (no APScheduler job anywhere else produces it).

* serves `/api/health` (the platform healthcheck) and `/` (the producer ledger, read-only)
* `ROOT/HOLD` present → the loop parks (nothing is produced) while health keeps answering
* PARK, never exit: `restartPolicyType: ALWAYS` would turn an exit into a restart loop
* `BREADTH_EXCH_RUNNER_ENABLED=1` → a SECOND thread runs Exchange Breadth V1 (`breadth_exchange_runner`),
  kicked after every producer tick (archive → compute → validate → publish), served at `/exchange`.
  It never runs inside the producer's tick, so it can never fail or delay a US V2 publication.
"""
from __future__ import annotations

import json
import os
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from api.services import breadth_v2_producer as prod

_STATE = {"last_tick": None, "last_result": None, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
          "parked": None}
_EXCH = {"on": os.environ.get("BREADTH_EXCH_RUNNER_ENABLED") == "1"}


class _H(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        try:
            if self.path.startswith("/api/health"):
                body = {"ok": True, "service": "breadth-v2-producer", **{k: _STATE[k] for k in ("started", "last_tick", "parked")},
                        # informational only: health stays 200 (a non-200 would restart the service, and
                        # a blocked prune is exactly the state that must NOT be restarted away)
                        "archive_guard_level": prod._guard_status_safe().get("level")}
            elif self.path.startswith("/exchange"):
                from api.services import breadth_exchange_runner as exr
                body = exr.status()
            else:
                body = {**prod.status(), "loop": _STATE}
            data = json.dumps(body, default=str).encode()
            self.send_response(200)
        except Exception as e:  # noqa: BLE001
            data = json.dumps({"ok": False, "error": repr(e)}).encode()
            self.send_response(500)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        return


def _loop():
    tick_secs = int(os.environ.get("BV2_TICK_SECS", "600"))
    try:
        lock = prod.singleton_lock()
    except OSError:
        _STATE["parked"] = "another producer holds the lock"
        return
    _STATE["lock"] = lock
    while True:
        if os.path.exists(os.path.join(prod.ROOT, "HOLD")):
            _STATE["parked"] = "HOLD"
        else:
            _STATE["parked"] = None
            try:
                _STATE["last_result"] = prod.tick()
            except Exception as e:  # noqa: BLE001 — a tick failure never kills the loop
                _STATE["last_result"] = {"error": "%s: %s" % (type(e).__name__, e),
                                         "trace": traceback.format_exc()[-2000:]}
                print("[bv2-producer] tick error: %s" % _STATE["last_result"]["error"], flush=True)
            _STATE["last_tick"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            if _EXCH["on"]:
                from api.services import breadth_exchange_runner as exr
                exr.kick()                      # AFTER the tick returned: US V2 publication → exchange
        time.sleep(tick_secs)


def main() -> None:
    if os.environ.get("BREADTH_V2_PRODUCER_ENABLED") != "1":
        raise SystemExit("BREADTH_V2_PRODUCER_ENABLED is not 1 — refusing to start the V2 producer")
    threading.Thread(target=_loop, daemon=True, name="bv2-producer-loop").start()
    if _EXCH["on"]:
        from api.services import breadth_exchange_runner as exr
        threading.Thread(target=exr.loop, kwargs={"interval": int(os.environ.get("BREADTH_EXCH_TICK_SECS", "900"))},
                         daemon=True, name="exch-runner-loop").start()
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), _H).serve_forever()


if __name__ == "__main__":
    main()
