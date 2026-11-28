"""A SYNTHETIC bars.db for the capacity replay on machines without the dev box's store (GitHub runners): the real
schema (`bars_sqlite.init_db`), realistic rows per ticker and timeframe, random-walk OHLCV. NO production or vendor
data: tickers are generated names (`S0001`...), prices are a seeded random walk.

What is realistic and what is not:
  * row COUNTS and KEYS are the production shapes the serve path reads: D keyed YYYYMMDD on NYSE trading days, W/M
    built by the app's own resamplers (`bars_fetch._resample_weekly_iso` / `_resample_monthly_iso`: Friday-keyed weeks),
    intraday unix-second buckets inside each trading day's RTH window (`bars_fetch._session_window`, half-day aware);
  * a serve's CPU depends on how many rows it reads and formats, not on their values, so a random walk costs what real
    bars cost; dollar-volume RANK (which the member model draws from, Zipf) is set by a per-ticker scale;
  * NOT realistic: splits, gaps, provider quirks, the long tail of very short histories, the store's size on disk
    (the production store is ~3-20 GB; this one is ~1 GB), so the OS page cache is warmer than production's.

Usage: python synth_store.py <out_dir> [--daily N] [--intraday N] [--days-d N] [--days-i N] [--seed N]
Writes <out_dir>/bars.db and prints a summary line.
"""
import argparse
import os
import random
import sqlite3
import sys
import time
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
INTRA = {"1": 60, "5": 300, "15": 900, "30": 1800, "60": 3600}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--daily", type=int, default=1500, help="tickers with daily history")
    ap.add_argument("--intraday", type=int, default=400, help="of those, tickers with intraday history")
    ap.add_argument("--days-d", type=int, default=4300, help="daily rows per ticker (~17 years: 200+ monthly bars)")
    ap.add_argument("--rows-i", type=int, default=1400, help="intraday rows per ticker per tf (a first paint asks 1,199)")
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    os.environ["DATA_DIR"] = a.out
    os.environ.setdefault("BARS_API_ENABLED", "1")
    sys.path.insert(0, REPO)
    from api.services import bars_sqlite as bs
    from api.services import bars_fetch as bf
    bs._DB_PATH = os.path.join(a.out, "bars.db")
    bs.init_db()
    t0 = time.time()
    rng = random.Random(a.seed)

    today = date.today()
    days = []
    d = today - timedelta(days=1)
    while len(days) < a.days_d:
        if bf._is_trading_day_ymd(d):
            days.append(d)
        d -= timedelta(days=1)
    days.reverse()
    per_day = {tf: max(1, 23400 // step) for tf, step in INTRA.items()}
    idays = {tf: days[-min(len(days), -(-a.rows_i // per_day[tf])):] for tf in INTRA}

    c = sqlite3.connect(bs._DB_PATH)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=OFF")
    ins = "INSERT OR REPLACE INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)"
    n_rows = 0
    for i in range(a.daily):
        sym = "S%04d" % (i + 1)
        scale = 1.0 / ((i + 1) ** 1.05)                      # dollar-volume rank: S0001 the most liquid
        px = rng.uniform(5, 400)
        vol0 = int(2e5 + 5e7 * scale)
        daily, rows = [], []
        for dd in days:
            o = px
            px = max(0.5, px * (1 + rng.gauss(0.0004, 0.02)))
            h, lo = max(o, px) * (1 + abs(rng.gauss(0, 0.006))), min(o, px) * (1 - abs(rng.gauss(0, 0.006)))
            v = int(vol0 * rng.uniform(0.5, 1.8))
            ymd = dd.year * 10000 + dd.month * 100 + dd.day
            rows.append((sym, "D", ymd, round(o, 2), round(h, 2), round(lo, 2), round(px, 2), v))
            daily.append({"t": dd.isoformat(), "o": round(o, 2), "h": round(h, 2), "l": round(lo, 2),
                          "c": round(px, 2), "v": v})
        for tf, fn in (("W", bf._resample_weekly_iso), ("M", bf._resample_monthly_iso)):
            for b in fn(daily):
                rows.append((sym, tf, int(str(b["t"])[:10].replace("-", "")), b["o"], b["h"], b["l"], b["c"],
                             int(b.get("v") or 0)))
        if i < a.intraday:
            for tf, step in INTRA.items():
                p = px
                for dd in idays[tf]:
                    op, cl = bf._session_window(dd, "rth")
                    for ts in range(op, cl, step):
                        o = p
                        p = max(0.5, p * (1 + rng.gauss(0, 0.002 * (step / 300) ** 0.5)))
                        rows.append((sym, tf, ts, round(o, 2), round(max(o, p) * 1.001, 2),
                                     round(min(o, p) * 0.999, 2), round(p, 2), int(vol0 * step / 23400 *
                                                                                 rng.uniform(0.3, 2.0))))
        c.executemany(ins, rows)
        n_rows += len(rows)
        if i % 100 == 99:
            c.commit()
    c.commit()
    c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    c.close()
    size = os.path.getsize(bs._DB_PATH)
    print("synthetic store: %d tickers (%d intraday), %d rows, %.0f MB, %.0f s -> %s"
          % (a.daily, a.intraday, n_rows, size / 1e6, time.time() - t0, bs._DB_PATH), flush=True)


if __name__ == "__main__":
    main()
