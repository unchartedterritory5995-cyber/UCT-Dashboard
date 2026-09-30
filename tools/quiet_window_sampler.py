"""TERM-007 quiet-window sampler — one reading per minute of the live web pod.

Owner ruling 2026-09-29: the quiet window is 2026-09-30 09:30-10:30 ET (no master pushes).
This records, per minute, the pod's own answers -- `/api/health` (uptime, threads, RSS),
`/api/health/memory` (RSS split into RssAnon/RssFile/RssShmem + the per-job RSS ledger), and
`/api/watchdog/status` (event-loop lag) -- as JSON lines, RAW, before anything summarises
them (R-RAW). A reading that fails is written as an error row, never skipped: a hole in the
series must stay visible. `uptime_seconds` going DOWN between rows marks a deploy inside the
window, which is what `deployments_sampled` in TERM-014 counts.

Usage (sign-in from SMOKE_EMAIL / SMOKE_PASSWORD, the synthetic admin account):
    python tools/quiet_window_sampler.py --out <dir> --start 13:25 --end 14:35   # UTC
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import time
from datetime import datetime, timezone

import httpx

BASE = "https://uctintelligence.com"
HEADERS = {"User-Agent": "Mozilla/5.0 (uct quiet-window sampler)"}


def _utc_today_at(hhmm: str) -> float:
    h, m = (int(x) for x in hhmm.split(":"))
    now = datetime.now(timezone.utc)
    return now.replace(hour=h, minute=m, second=0, microsecond=0).timestamp()


def _login(c: httpx.Client) -> None:
    r = c.post("/api/auth/login", json={"email": os.environ["SMOKE_EMAIL"],
                                        "password": os.environ["SMOKE_PASSWORD"]})
    r.raise_for_status()


def _get(c: httpx.Client, path: str):
    try:
        r = c.get(path)
        if r.status_code == 401:
            _login(c)
            r = c.get(path)
        return {"status": r.status_code, "body": r.json() if r.status_code == 200 else r.text[:300]}
    except Exception as e:  # noqa: BLE001 -- a failed read is a row, never a skip
        return {"status": None, "error": f"{type(e).__name__}: {e}"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--start", required=True, help="UTC HH:MM")
    ap.add_argument("--end", required=True, help="UTC HH:MM")
    ap.add_argument("--every", type=int, default=60)
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    raw = out / "raw.jsonl"
    start, end = _utc_today_at(a.start), _utc_today_at(a.end)
    while time.time() < start:
        time.sleep(min(30, start - time.time()))
    c = httpx.Client(base_url=BASE, headers=HEADERS, timeout=60)
    try:
        _login(c)
    except Exception as e:  # noqa: BLE001
        with raw.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"ts": time.time(), "login_error": str(e)}) + "\n")
    n = 0
    while time.time() < end:
        t0 = time.time()
        row = {"ts": t0, "utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "health": _get(c, "/api/health"),
               "memory": _get(c, "/api/health/memory"),
               "watchdog": _get(c, "/api/watchdog/status")}
        with raw.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, default=str) + "\n")
        n += 1
        time.sleep(max(1, a.every - (time.time() - t0)))
    print(f"[quiet-window] {n} rows -> {raw}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
