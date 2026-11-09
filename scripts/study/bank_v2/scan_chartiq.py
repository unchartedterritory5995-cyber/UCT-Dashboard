"""BANK V2: every Chart IQ cycle stage and named trade event in the deep history, for the Study question library.

Owner 2026-11-06: "add the number of setups/patterns/drawings, cycle of price action, use the chart IQ as well as our VAST
KNOWLEDGE AND SKILL AND BRAIN". Chart IQ (api/services/chart_iq, the dashboard's pattern recognition) already reads two
things from the bars alone that the bank did not teach:

- the CYCLE OF PRICE ACTION (engine/v44_read.cycle_events): Reversal extension, Wedge pop, EMA crossback, Base n' break,
  Exhaustion extension, Wedge drop, each judged on its own bar from the bars up to it (the 10 and 20-day EMA, ATR, volume);
- the named TRADE EVENTS of a bar (v44_read.candle_events): UnR, Pocket pivot, 20EMA tap, Inside bar break, MA remount,
  Higher low, Outside reversal, HVC, Kicker, Oops reversal, ER gap, and the bearish marks (Failed breakout, Breakdown,
  Bearish engulfing, Reversal off highs, Heavy volume closed weak ...), each read from that bar and the ones before it.

This runs both over every stock's full daily history in the bars database (the same universe and clean-window guard as
scan_history.py), keeps the events a member could judge from the chart, and stores for each: Chart IQ's own words for it,
a 20-session confirmation (did it hold: a buy event's low not closed under, a bear event's high not closed over, a
Reversal extension cleared by a close over its high within 10 sessions before its low breaks, as the engine confirms it),
the market context, the culmination, and the point-in-time liquidity rank. A cycle stage is also re-read the way Chart IQ
reads it on a member's chart (the 300 bars up to the day, a 200-bar look) and kept only when that reading names the same
stage on the same bar: the cycle is a running state, and the full-history pass alone could carry an older leg into it.

  python -X utf8 scripts/study/bank_v2/scan_chartiq.py --bars <bars.db> --out <events.jsonl.gz>
"""
from __future__ import annotations

import argparse
import gzip
import json
import pathlib
import sqlite3
import sys
import time
from collections import Counter

import numpy as np

REPO = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

from api.services.chart_iq.engine import v44_read as R  # noqa: E402
from api.services.pattern_engine.detectors.uct import uct_setups_common as U  # noqa: E402
from scripts.study.bank_v2 import scan_history as SH  # noqa: E402

CYCLE = set(R.CYCLE)
QUIET = {"Inside day", "Tight closes", "Quiet day"}          # states, not events: not questions
BEAR = tuple(R.BEAR_MARKS)
CONFIRM = 20
START = 220                                                 # the 200-day and the cycle's 200-bar look need history


def base(name: str) -> str:
    return name.split(" ·")[0]


def confirm(bars, k, name, bear):
    """Did it hold over the next 20 sessions (a Reversal extension: the engine's own 10-session confirmation)."""
    fwd = bars[k + 1:k + 1 + CONFIRM]
    x = bars[k]
    if name == "Reversal extension":
        for y in fwd[:10]:
            if y["l"] < x["l"]:
                return False
            if y["c"] > x["h"]:
                return True
        return False
    if bear:
        return not any(y["c"] > x["h"] for y in fwd)
    return not any(y["c"] < x["l"] for y in fwd)


def pit_stage(bars, k):
    """Chart IQ's own reading on a member's chart that day: the 300 bars up to it, a 200-bar look."""
    w = bars[max(0, k - 299):k + 1]
    ev = R.cycle_events(w, look=200)
    if ev and ev[-1][0] == len(w) - 1:
        return ev[-1][1], ev[-1][2]
    return None, None


ERAS = [(1995, 1999), (2000, 2004), (2005, 2009), (2010, 2014), (2015, 2019), (2020, 2026)]
PER_ERA = 2          # per stock, per event name, per era: the library needs breadth, not every 20EMA tap since 1995
_W = {}


def era_of(t):
    y = int(str(t)[:4])
    return next((f"{a}-{str(b)[2:]}" for a, b in ERAS if a <= y <= b), "other")


def _load(c, sym):
    rows = c.execute("SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' ORDER BY ts", (sym,)).fetchall()
    bars = [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": float(r[5] or 0)}
            for r in rows]
    return [b for b in bars if b["c"] > 0 and b["h"] >= b["l"] and b["o"] > 0]


def _dv50(bars):
    dvs = np.array([b["c"] * b["v"] for b in bars], dtype=np.float64)
    return np.median(np.lib.stride_tricks.sliding_window_view(dvs, 50), axis=1)   # [k - 49] = the 50 sessions to k


def _init(db, thr, spy):
    _W["c"] = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    _W["thr"], _W["spy"] = thr, spy


def _scan(sym):
    c, thr, spy = _W["c"], _W["thr"], _W["spy"]
    bars = _load(c, sym)
    if len(bars) < SH.MIN_HISTORY:
        return []
    med = _dv50(bars)
    last_n = len(bars) - 1 - CONFIRM
    liquid = lambda k: k >= 49 and med[k - 49] >= thr.get(bars[k]["t"], float("inf"))
    found = []
    try:
        for k, st, why in R.cycle_events(bars, look=len(bars)):
            if st in CYCLE and START <= k <= last_n and liquid(k):
                found.append(("cycle", k, st, why))
    except Exception:  # noqa: BLE001  one stock never stops the scan
        pass
    try:
        X = R.ctx(bars)
        for k, nm, why, _at in R.candle_events(bars, X, look=len(bars)):
            if base(nm) not in QUIET and START <= k <= last_n and liquid(k):
                found.append(("event", k, nm, why))
    except Exception:  # noqa: BLE001
        pass
    found.sort(key=lambda e: e[1])
    S, kept, slots = None, [], Counter()
    for kind, k, nm, why in found:
        bear = nm in ("Wedge drop", "Exhaustion extension") or nm.startswith(BEAR)
        held = confirm(bars, k, nm, bear)
        key = (kind, base(nm), era_of(bars[k]["t"]))
        # a held example first in each slot; a failed one only fills a slot nothing held for
        if slots[key + (True,)] >= PER_ERA or (not held and slots[key + (False,)] + slots[key + (True,)] >= PER_ERA):
            continue
        if not SH.clean_window(bars, k):
            continue
        if kind == "cycle":
            st, pwhy = pit_stage(bars, k)
            if st != nm:
                continue
            why = pwhy
        if S is None:
            S = U.series(bars)
        slots[key + (held,)] += 1
        kept.append({"kind": kind, "name": nm, "base": base(nm), "why": why, "sym": sym, "t": bars[k]["t"],
                     "close": bars[k]["c"], "bear": bear, "held": held, "ctx": SH.context(bars, S, k, spy),
                     "out": SH.outcome(bars, k, bear), "dv": float(med[k - 49])})
    return kept


def _scan_one(sym):
    return sym, _scan(sym)


def main(argv=None) -> int:
    import multiprocessing as mp
    ap = argparse.ArgumentParser()
    ap.add_argument("--bars", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--top", type=int, default=1000, help="keep events only in the top N stocks by dollar volume that day")
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args(argv)
    c = sqlite3.connect(f"file:{a.bars}?mode=ro", uri=True)
    etfs = set(json.loads((REPO / "api/data/prebuilt_etfs.json").read_text(encoding="utf-8")))
    syms = [r[0] for r in c.execute("SELECT ticker FROM ohlcv WHERE tf='D' GROUP BY ticker HAVING count(*) >= ?",
                                    (SH.MIN_HISTORY,))]
    syms = [s for s in syms if s not in etfs and s.isalpha()]
    if a.limit:
        syms = syms[:a.limit]
    spy = SH.spy_table(c)
    dates = sorted(spy)
    didx = {t: k for k, t in enumerate(dates)}
    dv50 = np.full((len(dates), len(syms)), np.nan, dtype=np.float32)
    t0 = time.time()
    for n, sym in enumerate(syms):                       # pass 1: the liquidity table, cheap
        bars = _load(c, sym)
        if len(bars) < 50:
            continue
        med = _dv50(bars)
        rows_j = np.array([didx.get(b["t"], -1) for b in bars[49:]])
        ok = rows_j >= 0
        dv50[rows_j[ok], n] = med[ok]
    thr = {}
    for j, t in enumerate(dates):
        row = dv50[j][~np.isnan(dv50[j])]
        if row.size:
            thr[t] = float(np.sort(row)[::-1][min(a.top, row.size) - 1])
    print(f"pass 1: liquidity for {len(syms)} stocks in {time.time() - t0:.0f}s", flush=True)
    # pass 2 writes each stock as it finishes to <out>.part (one "done" line per stock), so a run stopped midway
    # (the low-memory guard stopped the first one at 2,000 of 2,789 stocks, 2026-11-06) resumes where it was
    part = pathlib.Path(a.out + ".part")
    done = set()
    if part.exists():
        for line in part.read_text(encoding="utf-8").splitlines():
            if line.startswith('{"done":'):
                done.add(json.loads(line)["done"])
    todo = [s for s in syms if s not in done]
    print(f"pass 2: {len(todo)} stocks to scan ({len(done)} already in {part.name})", flush=True)
    with open(part, "a", encoding="utf-8") as fh,             mp.Pool(a.workers, initializer=_init, initargs=(a.bars, thr, spy)) as pool:   # pass 2: the events
        for n, (sym, kept) in enumerate(pool.imap_unordered(_scan_one, todo, chunksize=2)):
            for h_ in kept:
                fh.write(json.dumps(h_, default=str) + chr(10))
            fh.write(json.dumps({"done": sym}) + chr(10))
            fh.flush()
            if (n + 1) % 100 == 0:
                print(f"  {n + 1}/{len(todo)} stocks, {time.time() - t0:.0f}s", flush=True)
    hits = [json.loads(line) for line in part.read_text(encoding="utf-8").splitlines() if not line.startswith('{"done":')]
    col = {s: k for k, s in enumerate(syms)}
    for h in hits:
        j = didx.get(h["t"])
        if j is None:
            continue
        row = dv50[j]
        mine = row[col[h["sym"]]]
        if not np.isnan(mine):
            valid = row[~np.isnan(row)]
            h["liq_rank"] = int((valid > mine).sum()) + 1
            h["liq_universe"] = int(valid.size)
    with gzip.open(a.out, "wt", encoding="utf-8") as fh:
        for h in hits:
            fh.write(json.dumps(h, default=str) + chr(10))
    part.unlink()
    print(f"scanned {len(syms)} stocks in {time.time() - t0:.0f}s; {len(hits)} events")
    for key, v in Counter((h["kind"], h["base"], h["held"]) for h in hits).most_common():
        print(f"  {key[0]:5} {key[1]:28} held={key[2]!s:5} {v:7d}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
