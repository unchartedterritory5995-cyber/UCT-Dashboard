"""Bench + real-data parity check for the setup-tag store (api/services/setup_tags.py).

    python tools/bench_setup_tags.py [--bars-db C:/data/bars.db] [--syms NVDA,AMD,ANF,PLTR]
                                     [--universe] [--asof YYYYMMDD]

Reads bars.db IMMUTABLE (sqlite `immutable=1`: no lock, no journal, nothing written next to it),
opened BEFORE the repo-root conftest is imported, so the census pins every other data path into a
throwaway sandbox and arms the shared-root tripwire for the rest of the run. The tag store goes to
a scratch patterns.db inside that sandbox.

Per symbol it times what a chart open costs:
  live    = bar read + compute_tags (the path before the store)
  served  = bar read + digest + one store row read (the path on a store hit)
and with --universe it records the store for the whole scan universe (leaders first, as the
nightly scan orders it), then asserts every served answer is IDENTICAL to a fresh live
computation and prints the pass's own cost. Exit 1 on any parity mismatch.

Recorded 2026-10-23 on the dev box (bars.db newest daily bar 2026-10-22, as-of 20261022):
  per chart open (bar read included)  live        served
    NVDA                              17.4 ms     3.7 ms
    AMD                               23.6 ms     2.7 ms
    ANF                                5.8 ms     2.8 ms
    PLTR                              23.5 ms     2.8 ms
  universe (3,641 symbols, 5 with no daily bars): store pass 125.3 s single core
  (compute_tags p50 25.7 ms, p90 47.3 ms, p99 79.9 ms, max 130 ms); re-run with nothing
  changed 6.2 s; parity served == live for 3,636 / 3,636. The store-served answers also matched
  tags computed by the code BEFORE the store existed (e8b0d15ec7) for 3,641 / 3,641.
  One-time first-request costs, not per ticker: the bars_fetch import behind the session clock
  ~1.1 s (imported at boot in production), the detector modules ~0.13 s, the first patterns.db
  connection ~20 ms.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bars-db", default="C:/data/bars.db")
    ap.add_argument("--syms", default="NVDA,AMD,ANF,PLTR")
    ap.add_argument("--universe", action="store_true")
    ap.add_argument("--asof", type=int, default=None,
                    help="last completed session YYYYMMDD (default: the newest daily bar held)")
    args = ap.parse_args(argv)

    # 1. the read-only bars connection, opened with the REAL sqlite3.connect before anything
    #    patches it. immutable=1 writes nothing, not even a -shm read mark.
    uri = "file:" + args.bars_db.replace("\\", "/") + "?immutable=1"
    ro = sqlite3.connect(uri, uri=True, check_same_thread=False)
    asof = args.asof or ro.execute("SELECT max(ts) FROM ohlcv WHERE tf='D'").fetchone()[0]

    # 2. the census: every other data path into a sandbox, tripwire armed. Imported here, never at
    #    module level, so importing this file has no side effects.
    sys.path.insert(0, ROOT)
    import conftest  # noqa: F401
    os.environ["AUTO_STRUCTURES_ENABLED"] = "1"
    os.environ["AUTO_STRUCTURES_SETUP_TAGS_ENABLED"] = "1"

    from api.services import barspack, bars_sqlite
    from api.services import setup_tags as st
    bars_sqlite._conn = lambda: ro
    barspack._last_complete_session_ymd = lambda now=None: int(asof)
    st._register_detectors()
    print(f"bars.db {args.bars_db} (immutable)  as-of {asof}  store {os.environ.get('PATTERN_DB_PATH') or 'patterns.db beside the sandboxed auth.db'}")

    def live(sym):
        t = time.perf_counter()
        tags = st.compute_tags(sym, st._completed_daily_bars(sym))
        return tags, time.perf_counter() - t

    def served(sym):
        t = time.perf_counter()
        bars = st._completed_daily_bars(sym)
        tags = st.stored_tags(sym, bars, st.bars_digest(bars))
        return tags, time.perf_counter() - t

    syms = [s.strip().upper() for s in args.syms.split(",") if s.strip()]
    st.record_store(syms)
    print(f"{'sym':6s} {'live ms':>9s} {'served ms':>10s}  tags")
    for s in syms:
        lt, lsec = live(s)
        stt, ssec = served(s)
        same = "IDENTICAL" if stt == lt else "MISMATCH"
        print(f"{s:6s} {lsec * 1000:9.1f} {ssec * 1000:10.1f}  {len(lt)} {same}")

    if not args.universe:
        return 0
    with open(os.path.join(ROOT, "api", "data", "cap_universe.json")) as f:
        d = json.load(f)
    cap = d if isinstance(d, list) else d.get("tickers", [])
    with open(os.path.join(ROOT, "api", "data", "leader_universe.json")) as f:
        lead = json.load(f).get("tickers", [])
    order = list(lead) + [s for s in cap if s not in set(lead)]
    t = time.perf_counter()
    res = st.record_store(order)
    print(f"universe store pass: {len(order)} symbols in {time.perf_counter() - t:.1f}s  {res}")
    t = time.perf_counter()
    res2 = st.record_store(order)
    print(f"re-run, nothing changed: {time.perf_counter() - t:.1f}s  {res2}")
    bad, checked = [], 0
    for s in order:
        bars = st._completed_daily_bars(s)
        if not bars:
            continue
        checked += 1
        if st.stored_tags(s, bars) != st.compute_tags(s, bars):
            bad.append(s)
    print(f"parity: served == live for {checked - len(bad)} / {checked}"
          + (f"  MISMATCH: {bad[:20]}" if bad else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
