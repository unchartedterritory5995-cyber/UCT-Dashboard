"""Measure first-frame seed pack sizes for a universe, from data on this PC (no network, no upload).

    python tools/ffseed_measure.py --lake D:/uct-history/packs-7 --bars-db C:/data/bars.db \
        --asof 2026-11-18 --out <dir> [--symbols AAPL,MSFT] [--comp gzip,raw]

Sources, both READ-ONLY:
  * intraday (1 5 15 30 60): the history lake's packs (tools/history_lake, the vendor's minute
    files rolled up on the server's bucket grid, 60 = the 09:30-anchored 'rth' grid), brought to
    the store's grain the way the store writes a vendor bar (`bars_fetch._px`: prices rounded to 4
    decimals; `_safe_volume`: whole shares). Lake bars are RAW: a split inside a window is not
    adjusted here, which moves a handful of symbols' values and not the size.
  * D: a bars.db (opened `mode=ro`), each series formatted by the REAL serve formatter
    `bars_fetch._fmt_sqlite_bars(rows, "D", sym)` at the chart's first-paint row count.

Then the builder's own selection (`ffseed.seed_window`: regular session, as-of cut, newest N) and
encoder, exactly as the worker runs them. Writes <out>/<comp>/<tf>.ffs and prints one table.
DATA_DIR is pointed at <out> so nothing under the production data directory is opened for write.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sqlite3
import sys
import time
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import conftest  # noqa: E402,F401 -- the census and the tripwire, before any api.* import (every *_DB_PATH -> a sandbox; --bars-db stays explicit)

LAKE_PERIODS = {"1": ["2026-10", "2026-11"], "5": ["2026Q3", "2026Q4"], "15": ["2026"],
                "30": ["2026"], "60": ["2025", "2026"]}
TAIL_ROWS = {"1": 3000, "5": 2400, "15": 2400, "30": 2400, "60": 6000}


def lake_reader(lake_root: Path):
    from tools.history_lake import pack, piece
    readers = {}

    def read(sym: str, tf: str, count: int):
        vendor = sym.replace("-", ".")
        parts = []
        for period in LAKE_PERIODS[tf]:
            key = (tf, period)
            if key not in readers:
                readers[key] = pack.PackReader.open(lake_root, tf, period)
            r = readers[key]
            blob = r.get(vendor) if r else None
            if blob:
                d = piece.decode_piece(blob)
                f = piece.bars_to_floats(d)
                parts.append(f)
        if not parts:
            return [], 0
        import numpy as np
        cols = {k: np.concatenate([p[k] for p in parts]) for k in ("t", "o", "h", "l", "c", "v")}
        n = cols["t"].size
        lo = max(0, n - max(count, TAIL_ROWS[tf]))
        out = [{"t": int(cols["t"][i]), "o": round(float(cols["o"][i]), 4), "h": round(float(cols["h"][i]), 4),
                "l": round(float(cols["l"][i]), 4), "c": round(float(cols["c"][i]), 4), "v": int(cols["v"][i])}
               for i in range(lo, n)]
        out = [b for b in out if b["o"] > 0 and b["h"] > 0 and b["l"] > 0 and b["c"] > 0]
        return out[-count:], min(count, len(out))

    return read


def store_reader(db_path: str):
    from api.services import bars_fetch, bars_sanitize
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
    sql = ("SELECT ts,o,h,l,c,v FROM (SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf=? "
           "ORDER BY ts DESC LIMIT ?) ORDER BY ts ASC")

    def read(sym: str, tf: str, count: int):
        rows = con.execute(sql, (sym.upper(), tf, count)).fetchall()
        if not rows:
            return [], 0
        with bars_sanitize.suppress_meta_warm():
            return bars_fetch._fmt_sqlite_bars(rows, tf, sym), len(rows)

    return read


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lake", type=Path, required=True)
    ap.add_argument("--bars-db", required=True)
    ap.add_argument("--asof", required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--symbols", default=None)
    ap.add_argument("--tfs", default="1,5,15,30,60,D")
    ap.add_argument("--comp", default="gzip")
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    os.environ["DATA_DIR"] = str(a.out)          # before any app import: nothing opens C:\data for write
    from api.services import ffseed

    syms = a.symbols.split(",") if a.symbols else ffseed.universe()
    asof = date.fromisoformat(a.asof)
    lake, store = lake_reader(a.lake), store_reader(a.bars_db)
    rows = []
    for comp in a.comp.split(","):
        (a.out / comp).mkdir(exist_ok=True)
        for tf in a.tfs.split(","):
            t0 = time.time()
            data, st = ffseed.build_tf(tf, syms, asof, "measure", comp=comp, read=store if tf == "D" else lake)
            (a.out / comp / f"{tf}.ffs").write_bytes(data)
            tr_len = int.from_bytes(data[-16:-8], "little")
            from api.services import ffseed_format as fmt
            bodies = sum(e[7] for e in fmt.read_trailer(data)["symbols"].values())
            rows.append({"comp": comp, "tf": tf, "symbols": st["symbols"], "bars": st["bars"], "bytes": len(data),
                         "raw_bodies": bodies,
                         "trailer": tr_len, "gzip_whole_file": len(gzip.compress(data, 6)),
                         "bytes_per_bar": round((len(data) - tr_len) / max(1, st["bars"]), 2),
                         "skipped": {k: st[k] for k in ("no_bars", "stale", "inexact", "error")},
                         "short": st["short"], "secs": round(time.time() - t0, 1)})
            print(json.dumps(rows[-1]), flush=True)
    (a.out / "sizes.json").write_text(json.dumps(rows, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
