"""Run the candle-label backtest across bars.db and print the edge table.

    python tools/candle_backtest_run.py --workers 16
    python tools/candle_backtest_run.py --tickers 400 --since 20150101

Reads bars.db READ-ONLY and writes nothing. The output is a per-label excess
return over the date-matched universe, date-clustered — see
`api/services/screener/candle_backtest.py` for why every one of those words is
load-bearing.
"""
import argparse
import collections
import json
import os
import sqlite3
import sys
import time
from concurrent.futures import ProcessPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BARS_DB = os.environ.get("BARS_DB_PATH", r"C:\data\bars.db")


def _uri():
    return f"file:{BARS_DB}?mode=ro"


def _worker(args):
    tickers, since, min_price, entry = args
    from api.services.screener import (candle_backtest as bt, candles,
                                       bar_character, candle_catalog)
    conn = sqlite3.connect(_uri(), uri=True)
    lab, uni = {}, {}
    q = ("select ts,o,h,l,c,v from ohlcv where tf='D' and ticker=? "
         + ("and ts >= ? " if since else "") + "order by ts")
    for tk in tickers:
        params = (tk, since) if since else (tk,)
        rows = conn.execute(q, params).fetchall()
        if len(rows) < bt.WINDOW // 2:
            continue
        bars = [{"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}
                for t, o, h, l, c, v in rows]
        if min_price:
            # ⛔ MARK, DON'T DROP. Removing bars would splice unrelated sessions
            # together and manufacture false gaps and false inside bars; the
            # classifier would then be reading a series that never traded.
            for bar in bars:
                if (bar["c"] or 0) < min_price:
                    bar["skip"] = True
        a, b = bt.scan_ticker(bars, candles.single_candle,
                              bar_character.classify,
                              candle_catalog.decode_matches, entry=entry)
        bt.merge(lab, a)
        bt.merge(uni, b)
    conn.close()
    return lab, uni


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 4))
    ap.add_argument("--tickers", type=int, default=0, help="0 = all")
    ap.add_argument("--since", type=int, default=0, help="YYYYMMDD lower bound")
    ap.add_argument("--min-dates", type=int, default=30)
    # ⛔ THE DEFAULT IS `open`, AND THAT IS DELIBERATE. `close` is KNOWN
    # CONTAMINATED: it measures from the labelled bar's own close, which puts
    # that close in both the label and the return denominator, and bid-ask
    # bounce alone then manufactures a wick "finding" (measured 2026-08-25 —
    # 3 of 8 shapes flipped sign once the entry moved). Leaving the broken
    # convention as the default would let the next person re-derive the wrong
    # answer without doing anything wrong. `close` stays available because the
    # COMPARISON between the two is the finding.
    ap.add_argument("--entry", choices=("close", "open"), default="open",
                    help="DEFAULT 'open' measures from the NEXT open — the "
                         "bid-ask-bounce control, and the only entry a member "
                         "could take. 'close' is known contaminated; use it "
                         "only to reproduce that contamination deliberately.")
    ap.add_argument("--min-price", type=float, default=0.0,
                    help="skip bars closing below this — sub-$5 names have "
                         "structurally wider wicks and can carry a wick finding "
                         "on their own")
    ap.add_argument("--out", default="")
    a = ap.parse_args()

    conn = sqlite3.connect(_uri(), uri=True)
    tickers = [r[0] for r in conn.execute(
        "select distinct ticker from ohlcv where tf='D' order by ticker")]
    conn.close()
    if a.tickers:
        tickers = tickers[:a.tickers]
    print(f"tickers: {len(tickers)}  workers: {a.workers}  since: {a.since or 'all'}  "
          f"entry: {a.entry}", flush=True)
    if a.entry == "close":
        print("  ⚠️  ENTRY=CLOSE IS KNOWN CONTAMINATED (bid-ask bounce: the "
              "labelled close sits in both the label and the return "
              "denominator). Use it only for the deliberate comparison.",
              flush=True)

    chunks = [tickers[i::a.workers] for i in range(a.workers)]
    lab, uni = {}, {}
    from api.services.screener import candle_backtest as bt
    t0 = time.perf_counter()
    done = 0
    with ProcessPoolExecutor(max_workers=a.workers) as ex:
        for l2, u2 in ex.map(_worker, [(c, a.since, a.min_price, a.entry) for c in chunks]):
            bt.merge(lab, l2)
            bt.merge(uni, u2)
            done += 1
            print(f"  worker {done}/{a.workers} merged  "
                  f"{time.perf_counter()-t0:.0f}s", flush=True)
    el = time.perf_counter() - t0

    bars_seen = sum(u[0] for u in uni.values())
    print(f"\nscanned {bars_seen:,} labelled bar-observations across "
          f"{len(uni):,} sessions in {el:.0f}s", flush=True)

    rows = bt.summarize(lab, uni, min_dates=a.min_dates)
    print(f"labels meeting the >= {a.min_dates}-session bar: {len(rows)}\n")

    hdr = (f"{'label':34s} {'n_inst':>9s} {'n_days':>7s} "
           f"{'exc1d%':>8s} {'exc5d%':>8s} {'t(5d)':>7s} {'exc10d%':>8s} {'win5d%':>7s}")
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        print(f"{r['label'][:34]:34s} {r['n_instances']:9,d} {r['n_dates']:7,d} "
              f"{r['excess_1d']:8.3f} {r['excess_5d']:8.3f} "
              f"{('inf' if r['t_5d'] == float('inf') else '-inf' if r['t_5d'] == float('-inf') else format(r['t_5d'], '.2f')):>7s} "
              f"{r['excess_10d']:8.3f} {r['excess_winrate_5d']:7.2f}")

    if a.out:
        with open(a.out, "w", encoding="utf-8") as fh:
            json.dump({"scanned": bars_seen, "sessions": len(uni),
                       "seconds": el, "rows": rows}, fh, indent=1)
        print(f"\nwrote {a.out}")


if __name__ == "__main__":
    main()
