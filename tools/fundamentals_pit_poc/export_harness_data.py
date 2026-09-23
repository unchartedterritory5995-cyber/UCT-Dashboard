"""Export LOCAL data for the fundamentals ChartWidget harness (dev only).

Reads a scratch PIT store (built by the backfill against the SEC bulk archives)
and the local bars.db READ-ONLY, and writes the exact payloads the product's
routes return, so the harness can answer `/api/*` without any backend:

    <out>/catalog.json                      == GET /api/fundamentals/pit/catalog
    <out>/fundamentals_pit/v<N>/tickers.json  == publish.index_key()
    <out>/fundamentals_pit/v<N>/cik/<cik>.json == publish.key_for(cik)   (via publish_company)
    <out>/fundamentals_pit/current.json      {version: N}  (harness-only)
    <out>/beta/<SYM>.json                   == the worker-precomputed Beta points (beta_store)
    <out>/bars/<SYM>_<TF>.json              == GET /api/bars/<SYM>?tf=<TF>  (shape: {ticker, tf, bars})

    python tools/fundamentals_pit_poc/export_harness_data.py --db <pit.db> \
        --bars C:/data/bars.db --out app/src/testing/fundamentals/.data AAPL NVDA JPM ...
"""
import argparse
import json
import os
import sqlite3
import sys
from datetime import date

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from api.services.fundamentals_pit import beta_store as B, catalog as C, derive as D, publish as P, store as S  # noqa: E402

KEEP = {"D": 1600, "W": 520, "M": 240, "5": 1600, "60": 800}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--bars", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("symbols", nargs="+")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    conn = S.connect(a.db)
    bars = sqlite3.connect(f"file:{a.bars}?mode=ro", uri=True)

    with open(os.path.join(a.out, "catalog.json"), "w") as f:
        json.dump(C.payload(), f)
    P.publish_index(conn, local_root=a.out)
    # The harness reads the version from here rather than hard-coding a path.
    with open(os.path.join(a.out, "fundamentals_pit", "current.json"), "w") as f:
        json.dump({"version": D.DERIVATION_VERSION}, f)

    def closes(sym):
        rows = bars.execute("SELECT ts, c FROM ohlcv WHERE ticker=? AND tf='D' ORDER BY ts", (sym,)).fetchall()
        return [(date(ts // 10000, ts // 100 % 100, ts % 100), c) for ts, c in rows if c]

    os.makedirs(os.path.join(a.out, "beta"), exist_ok=True)
    os.makedirs(os.path.join(a.out, "bars"), exist_ok=True)
    for sym in [s.upper() for s in a.symbols] + ["SPY"]:
        cik = S.cik_for_ticker(conn, sym)
        if cik is not None:
            print(sym, P.publish_company(conn, cik, local_root=a.out))
        # Beta the way production gets it: precomputed (beta_store), then read.
        doc = None
        if cik is not None:
            B.refresh(conn, [cik], closes_fn=closes)
            doc = B.read(conn, cik)
        with open(os.path.join(a.out, "beta", f"{sym}.json"), "w") as f:
            json.dump((doc or {}).get("points") or [], f)
        for tf, keep in KEEP.items():
            rows = bars.execute("SELECT ts, o, h, l, c, v FROM ohlcv WHERE ticker=? AND tf=? ORDER BY ts DESC LIMIT ?",
                                (sym, tf, keep)).fetchall()[::-1]
            out = []
            for ts, o, h, l, c, v in rows:
                t = (f"{ts // 10000:04d}-{ts // 100 % 100:02d}-{ts % 100:02d}" if tf in ("D", "W", "M") else int(ts))
                out.append({"t": t, "o": o, "h": h, "l": l, "c": c, "v": v})
            with open(os.path.join(a.out, "bars", f"{sym}_{tf}.json"), "w") as f:
                json.dump({"ticker": sym, "tf": tf, "bars": out, "sealed": False}, f)
    print("wrote", a.out)


if __name__ == "__main__":
    main()
