"""Study -- what a course chart actually shows on its last visible bar, computed from real bars.

WHY (REVIEW_LEARNINGS rules 33 and 35, the owner on the 2026-11-17 localhost review): "Need to give it a better answer.
I mean technically the 200SMA is alittle bit down there and price is a tad extended." / "I dont see a box but clearly
its right around $60 give or take. That most recent hammer on the most recent candle is a very good look and a
possible buy day imo." An explanation must read the chart on the screen, so a writer gets these numbers for every
chart before rewriting a word: how far price sits from the 9 and 20 EMA and the 50 and 200 SMA, which way each line
points, what the last candle is, where the recent high (the pivot he would mark) sits, and how deep the range is.

    python -m scripts.study.chart_facts --bars <bars.db copy> [--unit SET.07 ...] --out <dir>   (one <UNIT>.json each)

Reads the bars exactly as check_course_charts does (the same resolve: the window plus the averages' warm-up, split
adjusted, as the drill shows them). Index and intraday charts without local bars are listed with "no_local_bars".
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sqlite3
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from scripts.study.check_course_charts import resolve  # noqa: E402


def _sma(xs, n):
    return sum(xs[-n:]) / n if len(xs) >= n else None


def _ema(xs, n):
    if len(xs) < n:
        return None
    k = 2 / (n + 1)
    e = sum(xs[:n]) / n
    for v in xs[n:]:
        e = v * k + e * (1 - k)
    return e


def _pct(a, b):
    return None if a is None or b in (None, 0) else round((a / b - 1) * 100, 1)


def _slope(xs, n, back):
    """The line's change over the last `back` bars, in percent: up, down or flat as he would see it."""
    now, then = _sma(xs, n), _sma(xs[:-back], n) if len(xs) > back else None
    ch = _pct(now, then)
    return {"pct": ch, "way": None if ch is None else "up" if ch > 0.5 else "down" if ch < -0.5 else "flat"}


def candle(o, h, l, c, prev=None) -> dict:
    """The last candle as a trader names it: body and shadows as a share of the range, and a name when it is one."""
    rng = h - l
    if rng <= 0:
        return {"name": "no range"}
    body, upper, lower = abs(c - o) / rng, (h - max(o, c)) / rng, (min(o, c) - l) / rng
    name = []
    if body <= 0.1:
        name.append("doji")
    elif lower >= 0.55 and upper <= 0.15:
        name.append("hammer (long lower wick, closed near the high)")
    elif upper >= 0.55 and lower <= 0.15:
        name.append("shooting star / long upper wick")
    if prev:
        ph, pl = prev[2], prev[3]
        if h <= ph and l >= pl:
            name.append("inside day")
        elif h > ph and l < pl:
            name.append("outside day")
    return {"color": "green" if c >= o else "red", "body_pct": round(body * 100), "upper_wick_pct": round(upper * 100),
            "lower_wick_pct": round(lower * 100), "close_in_range_pct": round((c - l) / rng * 100),
            "name": ", ".join(name) or "ordinary"}


def facts_for(c, chart: dict) -> dict:
    r = resolve(c, chart, None)
    if r is None or not r.get("visible"):
        return {"no_local_bars": True}
    rows = r["visible"]
    closes = [float(x[4]) for x in rows]
    t, o, h, l, cl, v = rows[-1][:6]
    o, h, l, cl, v = float(o), float(h), float(l), float(cl), float(v or 0)
    vols = [float(x[5] or 0) for x in rows]
    win = int(chart.get("window", 120))
    shown = rows[-win:]
    hi20 = max(float(x[2]) for x in rows[-20:])
    hi50 = max(float(x[2]) for x in rows[-50:]) if len(rows) >= 50 else None
    lo20 = min(float(x[3]) for x in rows[-20:])
    vol50 = _sma(vols, 50)
    out = {
        "last_bar": {"t": t, "open": round(o, 2), "high": round(h, 2), "low": round(l, 2), "close": round(cl, 2),
                     "volume_vs_50d_avg": None if not vol50 else round(v / vol50, 2)},
        "last_candle": candle(o, h, l, cl, rows[-2] if len(rows) > 1 else None),
        "vs_9ema_pct": _pct(cl, _ema(closes, 9)), "vs_20ema_pct": _pct(cl, _ema(closes, 20)),
        "vs_50sma_pct": _pct(cl, _sma(closes, 50)), "vs_200sma_pct": _pct(cl, _sma(closes, 200)),
        "sma50": {"value": None if _sma(closes, 50) is None else round(_sma(closes, 50), 2), **_slope(closes, 50, 20)},
        "sma200": {"value": None if _sma(closes, 200) is None else round(_sma(closes, 200), 2), **_slope(closes, 200, 20)},
        "sma50_over_sma200": None if _sma(closes, 200) is None else _sma(closes, 50) > _sma(closes, 200),
        "high_20d": round(hi20, 2), "high_50d": None if hi50 is None else round(hi50, 2), "low_20d": round(lo20, 2),
        "close_below_20d_high_pct": _pct(hi20, cl),
        "range_20d_depth_pct": round((hi20 - lo20) / hi20 * 100, 1),
        "visible_bars": len(shown), "visible_from": shown[0][0] if shown else None,
    }
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bars", required=True)
    ap.add_argument("--unit", nargs="*")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    c = sqlite3.connect(f"file:{pathlib.Path(a.bars).as_posix()}?mode=ro", uri=True)
    out_dir = pathlib.Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    n = 0
    for path in sorted((REPO / "docs/study/courses").glob("*/*.json")):
        d = json.loads(path.read_bytes().decode("utf-8"))
        if a.unit and d.get("unit") not in a.unit:
            continue
        live = {k for k, v in (d.get("verify") or {}).items() if (v or {}).get("status") == "pass"}
        res = {}
        for q in d.get("questions") or []:
            if q.get("chart") and q["key"] in live:
                res[q["key"]] = {"chart": q["chart"], **facts_for(c, q["chart"])}
        for w in d.get("walkthroughs") or []:
            if w.get("chart") and w["key"] in live:
                res[w["key"]] = {"chart": w["chart"], **facts_for(c, {"forward": 0, **w["chart"]})}
        if res:
            (out_dir / f"{d['unit']}.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
            n += len(res)
    print(json.dumps({"charts": n, "out": str(out_dir)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
