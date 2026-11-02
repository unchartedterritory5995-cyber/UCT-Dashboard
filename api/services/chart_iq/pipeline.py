"""Chart IQ: one ticker as of one day through the full engine, in memory.

The same stages the engine was tuned with (v3 structure -> the two ported channel / trendline indicators -> the composer), chained
without files or subprocesses, plus the read layers: every candle event, the cycle of price action, buy days at support, unfilled
gaps, what is setting up (trigger and stop) and the market line. Point in time: only bars up to the requested day are read.

``analyze(ticker, asof=None)`` returns a JSON-safe dict. It never raises; a bad ticker or thin history returns ``{"error": ...}``.
"""
import copy
import logging
import time

from .engine import _db
from .engine import _version
from .engine import forward as F
from .engine import markup as MK
from .engine import run_markup as RM
from .engine import v3 as V3
from .engine import v4_compose as VC
from .engine import v44_read as R

logger = logging.getLogger(__name__)

WINDOW = 190          # the chart window the engine's rules were tuned on
PORTS = ("sr_channels_ltb", "tl_auto_dojiemoji")


def _ymd(t):
    s = str(t)
    return "%s-%s-%s" % (s[:4], s[4:6], s[6:8])


def latest_day():
    row = _db.bars().execute("SELECT max(ts) FROM ohlcv WHERE tf='D' AND ticker='SPY'").fetchone()
    return _ymd(row[0]) if row and row[0] else None


def analyze(ticker, asof=None):
    try:
        return _analyze(ticker.upper().strip(), asof)
    except Exception as e:  # noqa: BLE001  one chart never takes the caller down
        logger.exception("chart_iq analyze failed for %s %s", ticker, asof)
        return {"error": "%s: %s" % (ticker, type(e).__name__)}


def _analyze(ticker, asof):
    t0 = time.time()
    asof = asof or latest_day()
    if not asof:
        return {"error": "no daily bars available"}
    rows = _db.bars().execute(
        "SELECT ts,o,h,l,c,v FROM (SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? ORDER BY ts DESC LIMIT 520) ORDER BY ts",
        (ticker, int(asof.replace("-", "")))).fetchall()
    rows = [r for r in rows if r[1] and r[4]]
    if len(rows) < 120:
        return {"error": "%s: not enough daily bars as of %s (%d)" % (ticker, asof, len(rows))}
    last = _ymd(rows[-1][0])
    w = rows[-WINDOW:]
    hi, lo = max(x[2] for x in w), min(x[3] for x in w)
    cid = "L_%s_%s" % (ticker, last.replace("-", ""))
    ent = {"id": cid, "blank": True, "ticker": ticker, "asof": last, "type": "live", "section": "Live",
           "edit": {"img": {"w": 1100, "h": 620}, "plot": {"x0": 49.5, "x1": 907.5, "y0": 83.7, "y1": 474.3},
                    "price": {"top": hi * 1.03, "bottom": lo * 0.97, "log": False}, "bars": {"dates": [_ymd(x[0]) for x in w]}, "objects": []}}
    v3r = V3.markup(ent)
    v3d = {cid: v3r} if v3r else {}
    _, res, _errs = RM.work((ent, list(PORTS), {}, {}))
    ltb = {cid: {"objects": res.get("sr_channels_ltb", [])}}
    dje = {cid: {"objects": res.get("tl_auto_dojiemoji", [])}}
    m = dict(ent)
    b = MK.bars(ticker, last, n=max(80, len(ent["edit"]["bars"]["dates"])))
    if not b:
        return {"error": "%s: no bars" % ticker}
    m["_close"], m["_bars"] = b[-1]["c"], b
    m["_bars_long"] = MK.bars(ticker, last, n=300) or b
    raw = [dict(o, src=o.get("src") or "v3") for o in copy.deepcopy((v3r or {}).get("objects", []))]   # before compose: it annotates objects in place
    raw += [dict(o, src=o.get("src") or "tv_sr_channels_ltb") for o in copy.deepcopy(ltb[cid]["objects"])]
    raw += [dict(o, src=o.get("src") or "tv_tl_auto_dojiemoji") for o in copy.deepcopy(dje[cid]["objects"])]
    clean = VC.compose(cid, m, v3d, ltb, dje)

    b = MK.bars(ticker, last, n=300)
    X = R.ctx(b)
    n = len(b)
    d = lambda k: _ymd(b[k]["t"])
    bear = lambda nm: any(nm.startswith(x) for x in R.BEAR_MARKS)
    candles = [{"d": d(k), "name": nm, "why": tx, "at": at, "bear": bear(nm)} for k, nm, tx, at in R.candle_events(b, X, look=120)]
    cyc = [{"d": d(k), "stage": st, "why": tx, "shown": st in R.SHOW, "bear": st in ("Wedge drop", "Exhaustion extension")}
           for k, st, tx in R.confirmed(b, R.cycle_events(b, look=200))]
    buys, seen = [], set()
    ev = [(k, nm) for k, nm, _, _ in R.candle_events(b, X, look=120)]
    ev += [(k, st) for k, st, _ in R.confirmed(b, R.cycle_events(b, look=150)) if st in ("EMA crossback", "Wedge pop", "Reversal extension")]
    for k, nm in sorted(ev):
        base = nm.split(" ·")[0]
        if (base not in R.BUYFAM and nm not in R.BUYFAM) or k in seen:
            continue
        x = b[k]
        sup = any(mv and abs(x["l"] / mv - 1) <= 0.03 for mv in (X["e9"][k], X["e20"][k], X["s50"][k])) or base in R.STRONG
        if not sup:
            continue
        seen.add(k)
        failed = next((j for j in range(k + 1, n) if b[j]["c"] < x["l"]), None)
        buys.append({"d": d(k), "name": nm, "price": round(x["c"], 2), "low": round(x["l"], 2), "held": failed is None,
                     "failed_on": d(failed) if failed else None,
                     "run": round(100 * ((max(y["h"] for y in b[k + 1:]) / x["c"] - 1) if k < n - 1 else 0), 1)})
    bb = R.best_buy_days(b, X)
    best = {d(max(bb, key=lambda x: x[2])[0])} if bb else set()
    for x in buys:
        x["best"] = x["d"] in best
    gaps = [{"d": d(g["k"]), "up": g["up"], "top": round(g["top"], 2), "bot": round(g["bot"], 2), "state": g["state"], "pct": round(g["pct"], 1),
             "vm": round(g["vm"], 1)} for g in R.drendel_gaps(b)]
    bf = lambda t, dd: MK.bars(t, dd, n=300)
    return {"ticker": ticker, "asof": last, "requested": asof, "window": [_ymd(w[0][0]), last],
            "bars": [{"t": _ymd(r[0]), "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5] or 0} for r in rows],
            "clean": clean.get("objects", []), "card": clean.get("card", []), "thesis": clean.get("thesis", ""),
            "context": clean.get("context", ""), "rs": clean.get("rs") or [],
            "raw": raw, "candles": candles, "cycle": cyc, "buydays": buys, "gaps": gaps,
            "watches": F.watches(b, R), "market": F.market(R, bf, last),
            "version": _version.VERSION, "built_s": round(time.time() - t0, 2)}
