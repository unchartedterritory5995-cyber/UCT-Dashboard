"""Instant-Origin Phase 2 instrument — measure the WEB pod's real warm-vs-cold ratio.

`/api/bars/{ticker}` emits `Server-Timing: bars;desc="<layer>";dur=<ms>` where <layer>
is the tier that served it (mem / sqlite = WARM instant; fetch / stale-swr /
inflight-wait / disk = COLD, the user waited). This samples a stratified spread of the
cap universe across D + 5m and tallies the ratio — the definition-of-done metric
("≥99% served mem/sqlite"). First-touch is honest: it reports what a brand-new user
sees (and incidentally nudges those cold tickers warm).

Usage:
  .venv\\Scripts\\python.exe tools\\bars_warmth_audit.py [--n 40] [--tf D,5]
      [--base https://uctintelligence.com] [--bars-d 300] [--bars-i 240]

Cloudflare 1010-blocks non-browser UAs → we send a browser UA. Read-only + bounded.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import Counter

import httpx

WARM = {"mem", "sqlite", "yf-only"}          # instant local reads
COLD = {"fetch", "stale-swr", "inflight-wait", "disk", "miss", "unknown"}
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def _universe() -> list[str]:
    p = os.path.join(os.path.dirname(__file__), "..", "api", "data", "cap_universe.json")
    with open(p, encoding="utf-8") as f:
        data = json.load(f)
    # cap_universe.json is a list of tickers (or {ticker:...} objects) — tolerate both.
    out = []
    for row in data:
        if isinstance(row, str):
            out.append(row)
        elif isinstance(row, dict):
            t = row.get("ticker") or row.get("symbol")
            if t:
                out.append(t)
    return out


def _stratified(universe: list[str], n: int) -> list[str]:
    """Even spread across the whole file so the deep long-tail (where cold lives) is
    represented, not just the megacaps at the top."""
    if n >= len(universe):
        return universe
    step = len(universe) / n
    return [universe[int(i * step)] for i in range(n)]


def _serve_layer(base: str, sym: str, tf: str, nbars: int, client: httpx.Client):
    t0 = time.perf_counter()
    try:
        r = client.get(f"{base}/api/bars/{sym}", params={"tf": tf, "bars": nbars}, timeout=20)
        wall = (time.perf_counter() - t0) * 1000.0
        st = r.headers.get("Server-Timing", "")
        layer = "unknown"
        if 'desc="' in st:
            layer = st.split('desc="', 1)[1].split('"', 1)[0]
        nb = 0
        try:
            nb = len(r.json().get("bars", []))
        except Exception:
            pass
        return layer, wall, r.status_code, nb
    except Exception as e:
        return f"ERR:{type(e).__name__}", (time.perf_counter() - t0) * 1000.0, 0, 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--tf", default="D,5")
    ap.add_argument("--base", default=os.environ.get("WARMTH_BASE", "https://uctintelligence.com"))
    ap.add_argument("--bars-d", type=int, default=300)
    ap.add_argument("--bars-i", type=int, default=240)
    args = ap.parse_args()

    universe = _universe()
    sample = _stratified(universe, args.n)
    tfs = [t.strip() for t in args.tf.split(",") if t.strip()]
    print(f"[warmth] universe={len(universe)} sample={len(sample)} tfs={tfs} base={args.base}")

    with httpx.Client(headers={"User-Agent": _UA}, follow_redirects=True) as client:
        for tf in tfs:
            nbars = args.bars_d if tf in ("D", "W", "M") else args.bars_i
            layers = Counter()
            warm_ms, cold_ms, cold_syms = [], [], []
            for sym in sample:
                layer, wall, code, nb = _serve_layer(args.base, sym, tf, nbars, client)
                layers[layer] += 1
                if layer in WARM:
                    warm_ms.append(wall)
                else:
                    cold_ms.append(wall)
                    cold_syms.append(f"{sym}({layer},{wall:.0f}ms,{nb}b,{code})")
            total = sum(layers.values())
            warm = sum(v for k, v in layers.items() if k in WARM)
            pct = 100.0 * warm / total if total else 0.0
            print(f"\n=== tf={tf} (bars={nbars}) ===")
            print(f"  WARM {warm}/{total} = {pct:.0f}%   layers={dict(layers)}")
            if warm_ms:
                warm_ms.sort()
                print(f"  warm latency p50={warm_ms[len(warm_ms)//2]:.0f}ms "
                      f"p95={warm_ms[min(len(warm_ms)-1, int(len(warm_ms)*0.95))]:.0f}ms")
            if cold_ms:
                cold_ms.sort()
                print(f"  COLD latency p50={cold_ms[len(cold_ms)//2]:.0f}ms max={cold_ms[-1]:.0f}ms")
                print(f"  cold symbols: {', '.join(cold_syms[:25])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
