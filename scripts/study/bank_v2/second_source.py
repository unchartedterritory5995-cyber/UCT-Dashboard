"""BANK V2: check a drafted chart's bars against Yahoo's daily history today, before it reaches the owner.

WHAT IT CAN AND CANNOT SHOW (measured 2026-11-06). The deep daily history in the dashboard's bars database IS Yahoo's:
five old windows (ASML 1997, T 2000, BB 2004, NEM 2005, XYZ 2020) matched Yahoo's split-adjusted closes to the cent,
which also means the history follows the company through its ticker changes (BB in 2004 is the series Yahoo files under
BB, then traded as RIMM). So this is NOT an independent vendor. It confirms the chart's window still matches Yahoo
today: a split Yahoo applied after the dump, or a series Yahoo has since revised, shows up as a disagreement. An
independent check was tried and could not run: the local FMP and Massive keys are refused (401), Alpha Vantage's free
tier allows 25 calls a day, and Stooq now answers scripts with a browser check (not worked around). A fresh key in the
local .env would let this module grow an independent leg.

The window is the item's own: the 120 sessions it shows, ending on the chart's last bar, plus the 20-session forward
strip the reveal plays, compared close by close with yfinance's closes (auto_adjust off: split-adjusted, not
dividend-adjusted, the same basis as the bars). It passes when Yahoo has at least 90% of the sessions, the median close
differs by 1% or less and 95% of closes are within 3%. Anything else is recorded with its numbers and never drafted.
Answers are cached in docs/study/bank_v2/second_source.json (committed), so a re-run asks Yahoo nothing new.
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import sqlite3
import statistics
import time

REPO = pathlib.Path(__file__).resolve().parents[3]
CACHE = REPO / "docs" / "study" / "bank_v2" / "second_source.json"
WINDOW, FORWARD = 120, 20
MIN_COVER, MAX_MEDIAN, MAX_P95 = 0.90, 1.0, 3.0


def load_cache(path: pathlib.Path = CACHE) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def save_cache(cache: dict, path: pathlib.Path = CACHE) -> None:
    path.write_text(json.dumps(cache, indent=0, sort_keys=True) + "\n", encoding="utf-8")


def window_closes(db: str, sym: str, asof: str) -> dict[str, float]:
    key = int(asof.replace("-", ""))
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        back = con.execute("SELECT ts, c FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? ORDER BY ts DESC LIMIT ?",
                           (sym, key, WINDOW)).fetchall()
        fwd = con.execute("SELECT ts, c FROM ohlcv WHERE ticker=? AND tf='D' AND ts>? ORDER BY ts LIMIT ?",
                          (sym, key, FORWARD)).fetchall()
    finally:
        con.close()
    out = {}
    for ts, c in back + fwd:
        s = str(ts)
        out[f"{s[:4]}-{s[4:6]}-{s[6:8]}"] = float(c)
    return out


def yahoo_closes(sym: str, start: str, end: str) -> dict[str, float]:
    import yfinance as yf
    end_plus = (dt.date.fromisoformat(end) + dt.timedelta(days=3)).isoformat()
    for attempt in range(3):
        try:
            h = yf.Ticker(sym).history(start=start, end=end_plus, auto_adjust=False, actions=False)
            return {d.strftime("%Y-%m-%d"): float(c) for d, c in zip(h.index, h["Close"]) if c == c}
        except Exception:
            time.sleep(2 + 3 * attempt)
    return {}


def check(sym: str, asof: str, db: str, cache: dict) -> dict:
    k = f"{sym}|{asof}"
    if k in cache:
        return cache[k]
    ours = window_closes(db, sym, asof)
    if len(ours) < 30:
        res = {"ok": False, "why": f"only {len(ours)} sessions in the bars database"}
    else:
        days = sorted(ours)
        theirs = yahoo_closes(sym, days[0], days[-1])
        both = [d for d in days if d in theirs and theirs[d] > 0]
        cover = len(both) / len(days)
        diffs = sorted(abs(ours[d] / theirs[d] - 1) * 100 for d in both)
        med = statistics.median(diffs) if diffs else None
        p95 = diffs[min(len(diffs) - 1, int(0.95 * len(diffs)))] if diffs else None
        ok = bool(diffs) and cover >= MIN_COVER and med <= MAX_MEDIAN and p95 <= MAX_P95
        res = {"ok": ok, "sessions": len(days), "yahoo_sessions": len(both), "cover_pct": round(100 * cover, 1),
               "median_close_diff_pct": None if med is None else round(med, 2),
               "p95_close_diff_pct": None if p95 is None else round(p95, 2)}
        if not ok:
            res["why"] = ("Yahoo has no history for this ticker then" if not diffs else
                          f"Yahoo has {round(100 * cover)}% of the sessions" if cover < MIN_COVER else
                          f"closes differ by {round(med, 2)}% median, {round(p95, 2)}% at the 95th percentile")
        time.sleep(0.3)
    cache[k] = res
    return res


PIN_RANGE, PIN_SD = 6.0, 0.8


def after_signal(db: str, sym: str, asof: str, n: int = FORWARD) -> dict | None:
    """The 20 sessions after the chart's last bar: their high-to-low range and the spread of their daily moves.

    A cash takeover pins a stock to the deal price: AVA 2017-07-20 (Hydro One's bid) moved within 2.6% for 20 sessions,
    its daily moves 0.38% apart, against a 17% median range for the High Volume Edge picks around it. Under 6% and under
    0.8% is a pin: the story ended that day instead of starting (owner 2026-10-23: the HVE is "the start of a new story").
    """
    key = int(asof.replace("-", ""))
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        sig = con.execute("SELECT c FROM ohlcv WHERE ticker=? AND tf='D' AND ts=?", (sym, key)).fetchone()
        f = con.execute("SELECT h, l, c FROM ohlcv WHERE ticker=? AND tf='D' AND ts>? ORDER BY ts LIMIT ?",
                        (sym, key, n)).fetchall()
    finally:
        con.close()
    if not sig or len(f) < 10:
        return None
    closes = [sig[0]] + [x[2] for x in f]
    moves = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes))]
    rng = (max(x[0] for x in f) / min(x[1] for x in f) - 1) * 100
    sd = statistics.pstdev(moves) * 100
    return {"sessions": len(f), "range_pct": round(rng, 1), "daily_sd_pct": round(sd, 2),
            "pinned": rng < PIN_RANGE and sd < PIN_SD}
