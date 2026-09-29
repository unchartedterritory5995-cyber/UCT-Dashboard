"""Lane SK proof run: one real sandbox boot on a FRESH data dir, held ~60 s past healthy,
stopped gracefully, port release proven. Writes the raw console to sandbox-boot.log and a
machine-readable run record to boot-run.json. It interprets NOTHING -- that is done after
the raw files are committed (R-RAW).

    python docs/notebook/proof/w10-sk/run_boot.py
"""
import importlib.util
import json
import os
import pathlib
import socket
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[3]
DATA_DIR = r"C:\data-w10sk"
PORT = 8233
HOLD_S = 60
LOG = HERE / "sandbox-boot.log"
RECORD = HERE / "boot-run.json"


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


def main():
    rec = {"data_dir": DATA_DIR, "port": PORT, "hold_s": HOLD_S}
    if os.path.exists(DATA_DIR):
        print(f"REFUSED: {DATA_DIR} exists; the proof needs a FRESH data dir")
        return 3
    if listening(PORT):
        print(f"REFUSED: port {PORT} already has a listener; nothing was killed")
        return 3
    perf = _load("perf", "tools/notebook_perf_harness.py")
    why = perf.refuse_shared_root(DATA_DIR)
    if why:
        print(f"REFUSED: {why}")
        return 3
    perf.BOOT_SCRIPT = HERE / "boot_launcher.py"
    sb = perf.Sandbox(DATA_DIR, PORT, LOG)
    rec["started"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    sb.start()
    base = f"http://127.0.0.1:{PORT}"
    healthy = sb.wait_healthy(base, 240)
    rec["healthy"] = healthy
    rec["healthy_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    if healthy:
        time.sleep(HOLD_S)
        rec["alive_after_hold"] = sb.alive()
        rec["healthy_after_hold"] = sb.wait_healthy(base, 10)
    rec["stop_how"] = sb.stop()
    rec["stopped_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    released = False
    for _ in range(20):
        if not listening(PORT):
            released = True
            break
        time.sleep(0.5)
    rec["port_released"] = released
    rec["exit_code"] = sb.proc.returncode if sb.proc else None
    rec["integrity_log"] = sb.integrity_path()
    RECORD.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(rec, indent=2))
    return 0 if (healthy and released) else 1


if __name__ == "__main__":
    sys.exit(main())
