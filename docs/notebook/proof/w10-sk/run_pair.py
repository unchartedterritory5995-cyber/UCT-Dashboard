"""Lane SK matched pair (fix round 1, item I1): one boot per call.

    python docs/notebook/proof/w10-sk/run_pair.py control
    python docs/notebook/proof/w10-sk/run_pair.py blanked

Each boot gets a FRESH data dir under C:\\data-w10sk, port 8233 (never C:\\data or
8077), and is held -- by polling its own console, never by a fixed sleep -- until
BOTH calendar-enrichment warms have logged their completion line and the
earnings-previews warm has logged its own:

    [dashboard-warm] enrichment ok|failed
    [calendar-enrich-warm] current week ...|failed
    [dashboard-warm] earnings-previews ok|failed

A boot that never logs them within CEILING_S is recorded as NOT COMPLETE, never
as a clean zero. Writes the raw console (pair-<mode>.log) and a run record
(pair-<mode>.json). It interprets NOTHING (R-RAW).
"""
import importlib.util
import json
import os
import pathlib
import re
import socket
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[3]
PORT = 8233
CEILING_S = 1500
MARKERS = {
    "dashboard-warm enrichment": re.compile(r"\[dashboard-warm\] enrichment (ok|failed)"),
    "calendar-enrich-warm": re.compile(r"\[calendar-enrich-warm\] (current week|failed)"),
    "dashboard-warm earnings-previews": re.compile(r"\[dashboard-warm\] earnings-previews (ok|failed)"),
}


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, str(REPO / rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def listening(port):
    s = socket.socket()
    s.settimeout(1.0)
    try:
        return s.connect_ex(("127.0.0.1", port)) == 0
    finally:
        s.close()


def main(mode):
    if mode not in ("control", "blanked"):
        print("usage: run_pair.py control|blanked")
        return 3
    data_dir = rf"C:\data-w10sk\pair-{mode}"
    log = HERE / f"pair-{mode}.log"
    record_path = HERE / f"pair-{mode}.json"
    rec = {"mode": mode, "data_dir": data_dir, "port": PORT, "ceiling_s": CEILING_S}
    if os.path.exists(data_dir):
        print(f"REFUSED: {data_dir} exists; the pair needs FRESH data dirs")
        return 3
    if listening(PORT):
        print(f"REFUSED: port {PORT} already has a listener; nothing was killed")
        return 3
    perf = _load("perf", "tools/notebook_perf_harness.py")
    why = perf.refuse_shared_root(data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    os.environ["W10SK_MODE"] = mode                     # read by pair_launcher.py
    perf.BOOT_SCRIPT = HERE / "pair_launcher.py"
    sb = perf.Sandbox(data_dir, PORT, log)
    t0 = time.time()
    rec["started"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    sb.start()
    rec["healthy"] = sb.wait_healthy(f"http://127.0.0.1:{PORT}", 240)
    rec["healthy_after_s"] = round(time.time() - t0, 1)
    seen = {}
    while rec["healthy"] and sb.alive() and time.time() - t0 < CEILING_S:
        text = log.read_text(encoding="utf-8", errors="replace")
        for name, rx in MARKERS.items():
            if name not in seen:
                m = rx.search(text)
                if m:
                    seen[name] = {"line": m.group(0), "after_s": round(time.time() - t0, 1)}
        if len(seen) == len(MARKERS):
            break
        time.sleep(2)
    rec["markers_seen"] = seen
    rec["complete"] = len(seen) == len(MARKERS)
    rec["alive_at_stop"] = sb.alive()
    rec["stop_how"] = sb.stop()
    rec["stopped_after_s"] = round(time.time() - t0, 1)
    released = False
    for _ in range(20):
        if not listening(PORT):
            released = True
            break
        time.sleep(0.5)
    rec["port_released"] = released
    rec["exit_code"] = sb.proc.returncode if sb.proc else None
    rec["integrity_log"] = sb.integrity_path()
    record_path.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(rec, indent=2))
    return 0 if (rec["complete"] and released) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else ""))
