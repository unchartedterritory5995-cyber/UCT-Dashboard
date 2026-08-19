"""Unattended saturation watch for the instant-origin warm rollout.

Samples a few random universe tickers' 5m + D serve latency on a fixed cadence and
prints one compact timestamped line per check, flagging a saturation signal (p50 over
a threshold) loudly. Read-only. Purpose: while the universe 5m warm runs on the worker,
confirm it does NOT starve the web serve pod (the Massive-saturation / AGI-hang class).

Usage: .venv\\Scripts\\python.exe tools\\bars_saturation_monitor.py [--checks 20]
       [--every 60] [--n 6] [--warn-ms 700]
"""
from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone

import httpx

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0"
_BASE = os.environ.get("WARMTH_BASE", "https://uctintelligence.com")


def _sample(client, syms, tf, nbars):
    lat, cold = [], 0
    for s in syms:
        t0 = time.perf_counter()
        try:
            r = client.get(f"{_BASE}/api/bars/{s}", params={"tf": tf, "bars": nbars}, timeout=25)
            ms = (time.perf_counter() - t0) * 1000
            lat.append(ms)
            st = r.headers.get("Server-Timing", "")
            layer = st.split('desc="', 1)[1].split('"', 1)[0] if 'desc="' in st else "?"
            if layer in ("fetch", "inflight-wait", "miss"):
                cold += 1
        except Exception:
            lat.append(25000)
            cold += 1
    lat.sort()
    return (lat[len(lat)//2] if lat else 0), (lat[-1] if lat else 0), cold


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checks", type=int, default=20)
    ap.add_argument("--every", type=int, default=60)
    ap.add_argument("--n", type=int, default=6)
    ap.add_argument("--warn-ms", type=int, default=700)
    args = ap.parse_args()

    cap = os.path.join(os.path.dirname(__file__), "..", "api", "data", "cap_universe.json")
    universe = [t for t in json.load(open(cap, encoding="utf-8")) if isinstance(t, str)]
    # deterministic stride sample, rotated each check so we cover different tickers
    step = max(1, len(universe) // args.n)
    print(f"[sat-monitor] base={_BASE} checks={args.checks} every={args.every}s n={args.n} "
          f"warn>{args.warn_ms}ms  (universe={len(universe)})", flush=True)

    with httpx.Client(headers={"User-Agent": _UA}, follow_redirects=True) as client:
        for i in range(args.checks):
            offset = (i * args.n) % step
            syms = [universe[(offset + k * step) % len(universe)] for k in range(args.n)]
            d_p50, d_max, d_cold = _sample(client, syms, "D", 300)
            i_p50, i_max, i_cold = _sample(client, syms, "5", 240)
            ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
            warn = " <<< SATURATION?" if (d_p50 > args.warn_ms or i_p50 > args.warn_ms) else ""
            print(f"[{ts}] D p50={d_p50:.0f}ms max={d_max:.0f} cold={d_cold}/{args.n} | "
                  f"5m p50={i_p50:.0f}ms max={i_max:.0f} cold={i_cold}/{args.n}{warn}", flush=True)
            if i < args.checks - 1:
                time.sleep(args.every)
    print("[sat-monitor] done", flush=True)


if __name__ == "__main__":
    main()
