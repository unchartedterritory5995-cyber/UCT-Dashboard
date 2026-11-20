"""Standing check (F3, 2026-11-20): rescale artifacts and declined split heals in a bars store. READ-ONLY.

  python tools/bars_rescale_check.py --db <bars.db> [--splits declared.json] [--out report.json]

1. RESCALE ARTIFACTS. Daily rows with 0 < close <= PINNED_MAX_CLOSE and volume >= INFLATED_MIN_VOLUME.
   `bars_sanitize.scale_bar` rounds prices to 4 dp and multiplies volume. So a compounded false rescale pins
   a close at 0.0001-0.0002 while its volume keeps growing.
   ⚰️ Measured on the production store 2026-11-20: CBSH served 9,001 such bars (1980..2015, volumes up to
   1.68e14), after about 26 passes of its declared 5% stock dividends in 2026-08. A genuine sub-penny
   listing has ordinary volume and is not reported.
2. DECLINED AND PENDING HEALS (with --splits: {"TICKER": [["YYYY-MM-DD", ratio], ...]}). The ONE detector
   (`bars_sanitize.unadjusted_splits`) runs over each listed ticker's daily rows and reports:
   - what it would still heal;
   - what F3b' declined (a step inside the old 15% band but not the size of the split).
   A missed real small split then shows up by name instead of silently.

Exit: 0 nothing found, 1 findings, 2 could not run. Opens the store with mode=ro and writes nothing but --out.
NOT a serve-time guard: the serve path keeps its one authority. This reads the artifact after the fact.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

#: A close this small is at scale_bar's 4-dp floor (0.0001 / 1.05 rounds back to 0.0001).
PINNED_MAX_CLOSE = 0.0002
#: ... and this much volume on it is a multiplied volume, not a sub-penny listing's.
INFLATED_MIN_VOLUME = 1_000_000_000


def _connect(db: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{Path(db).as_posix()}?mode=ro", uri=True)


def rescale_artifacts(con: sqlite3.Connection) -> list[dict]:
    rows = con.execute(
        "SELECT ticker, COUNT(*), MIN(ts), MAX(ts), MAX(v) FROM ohlcv "
        "WHERE tf='D' AND c > 0 AND c <= ? AND v >= ? GROUP BY ticker ORDER BY COUNT(*) DESC",
        (PINNED_MAX_CLOSE, INFLATED_MIN_VOLUME)).fetchall()
    return [{"ticker": t, "rows": n, "from": lo, "to": hi, "max_volume": mv} for t, n, lo, hi, mv in rows]


def _daily(con: sqlite3.Connection, ticker: str) -> list[dict]:
    out = []
    for ts, o, h, l, c, v in con.execute(
            "SELECT ts, o, h, l, c, v FROM ohlcv WHERE ticker=? AND tf='D' ORDER BY ts", (ticker,)):
        s = str(ts)
        out.append({"t": f"{s[:4]}-{s[4:6]}-{s[6:8]}", "o": o, "h": h, "l": l, "c": c, "v": v})
    return out


def split_heals(con: sqlite3.Connection, declared: dict) -> dict:
    from api.services import bars_sanitize as S
    pending, declined = [], []
    for ticker, splits in sorted((declared or {}).items()):
        bars = _daily(con, str(ticker).upper())
        if not bars:
            continue
        sp = [(str(d)[:10], float(r)) for d, r in splits]
        got: list = []
        for boundary, ratio in S.unadjusted_splits(bars, sp, declined=got):
            pending.append({"ticker": ticker, "boundary": boundary.isoformat(), "ratio": ratio})
        declined.extend({"ticker": ticker, **d} for d in got)
    return {"pending": pending, "declined": declined}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--db", required=True)
    ap.add_argument("--splits", help="JSON {TICKER: [[date, ratio], ...]}: also report pending/declined heals")
    ap.add_argument("--out", help="write the report here as JSON")
    a = ap.parse_args(argv)
    if not os.path.exists(a.db):
        print(f"bars_rescale_check: no store at {a.db}")
        return 2
    try:
        con = _connect(a.db)
        report = {"rescale_artifacts": rescale_artifacts(con)}
        if a.splits:
            report.update(split_heals(con, json.loads(Path(a.splits).read_text(encoding="utf-8"))))
    except (sqlite3.Error, OSError, ValueError) as e:
        print(f"bars_rescale_check: could not run: {type(e).__name__}: {e}")
        return 2
    if a.out:
        Path(a.out).write_text(json.dumps(report, indent=1), encoding="utf-8")
    art = report["rescale_artifacts"]
    print(f"rescale artifacts: {len(art)} tickers" + (": " + ", ".join(
        f"{r['ticker']} {r['rows']}" for r in art[:40]) if art else ""))
    for k in ("pending", "declined"):
        if k in report:
            print(f"{k} heals: {len(report[k])}" + (": " + ", ".join(
                f"{r['ticker']} {r.get('boundary') or r.get('at')}" for r in report[k][:40]) if report[k] else ""))
    found = bool(art) or bool(report.get("declined")) or bool(report.get("pending"))
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
