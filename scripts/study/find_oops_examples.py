"""Oops Reversal examples, pass 2 (read-only on the pod): score the SETUP behind the day.

Owner rulings 2026-10-23: scanner Oops = open < prior close, low < prior low,
close > prior close (all detector positives stay); Williams Oops = opens below
the prior LOW and rallies back above it; Super Oops = any Oops that closes above
the prior HIGH. Owner 2026-10-24 on Kickers: the best example "is technically
already giving a good setup", so this pass keeps uct_oops_reversal.evaluate as
the gate and ranks hits by the context: an uptrend (above the 200, 50 rising),
a pullback into the 21/50-day or a prior swing low, the Oops day reclaiming the
short averages on volume. Full cap universe. Prints JSON {scanned, raw, existing,
existing_ids, picks}. Reads bars.db only.
"""
import json, os, sys, time, sqlite3
from datetime import date

REPO = os.getcwd()
sys.path.insert(0, REPO)
from api.services import bars_sqlite  # noqa
from api.services.pattern_engine.detectors.uct import uct_setups_common as U  # noqa
from api.services.pattern_engine.detectors.uct import uct_oops_reversal  # noqa
from scripts.study.find_candle_examples import ALL_CANDIDATES  # noqa

BARS = 1500
WINDOW, FORWARD = 120, 20
MIN_GAP = 40
PER_VARIANT = 6
TARGET = 18


def key_to_iso(k):
    s = str(int(k)); return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def rows_to_bars(rows):
    return [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": float(r[5])}
            for r in rows]


def pct(a, b):
    return (a / b - 1) * 100 if b else 0.0


def _days(k):
    import datetime as _d
    s = str(int(k)); return _d.date(int(s[:4]), int(s[4:6]), int(s[6:8])).toordinal()


def legible(bars, i, n=20, frac=0.8):
    hist = bars[i - n:i]
    avg = sum(x["h"] - x["l"] for x in hist) / n
    return avg > 0 and (bars[i]["h"] - bars[i]["l"]) >= frac * avg


def clean_window(bars, i, window=WINDOW, forward=FORWARD):
    lo, hi = i - window + 1, i + forward
    if lo < 0 or hi >= len(bars) or bars[i]["t"] < 20190101:
        return False
    if _days(bars[hi]["t"]) - _days(bars[lo]["t"]) > (window + forward) * 1.9:
        return False
    for k in range(lo + 1, hi + 1):
        a, b = bars[k - 1], bars[k]
        if a["c"] <= 0 or abs(b["c"] / a["c"] - 1) > 0.60:
            return False
        body = max(b["o"], b["c"]) - min(b["o"], b["c"])
        rng = b["h"] - b["l"]
        if rng > 0 and body > 0 and rng > 12 * body and rng / b["c"] > 0.25:
            return False
    return True


def window_liquid(bars, i, window=WINDOW):
    w = bars[i - window + 1:i + 1]
    return bars[i]["c"] >= 5.0 and (sum(x["v"] for x in w) / len(w)) >= 300_000


def oops_facts(bars, S, i):
    b, p = bars[i], bars[i - 1]
    cc, hh, ll = S["c"], S["h"], [x["l"] for x in bars]
    rng = b["h"] - b["l"]
    v50 = S["v50"][i - 1]
    f = {"scanner": b["o"] < p["c"] and b["l"] < p["l"] and b["c"] > p["c"],
         "williams": b["o"] < p["l"], "super": b["c"] > p["h"],
         "open_vs_prior_low_pct": round(pct(b["o"], p["l"]), 2), "day_pct": round(pct(b["c"], p["c"]), 2),
         "close_pos": round((b["c"] - b["l"]) / rng, 2) if rng else 0,
         "rvol": round(b["v"] / v50, 2) if v50 else None}
    f["variant"] = "super" if f["super"] else ("williams+scanner" if f["williams"] else "scanner")
    cand = f["scanner"] and f["day_pct"] >= 1.5 and f["close_pos"] >= 0.6
    j = i - 1
    s50, s200, e8, e21 = S["s50"][j], S["s200"][j], S["e8"][j], S["e21"][j]
    atr = S["atr"][j] or rng or 1e-9
    if not (s50 and s200 and e8 and e21):
        return False, 0, f
    s50_prev, s200_prev = S["s50"][j - 20], S["s200"][j - 20]
    f["above_200"] = p["c"] > s200
    f["sma50_rising"] = bool(s50_prev) and s50 >= s50_prev * 0.995
    f["sma200_rising"] = bool(s200_prev) and s200 >= s200_prev * 0.995
    hi20 = max(hh[i - 20:i]); hi60 = max(hh[i - 60:i])
    f["pullback_from_20d_high_pct"] = round(pct(p["c"], hi20), 1)
    f["pullback_from_60d_high_pct"] = round(pct(p["c"], hi60), 1)
    # the dip tested a level: the 21/50-day, or a prior swing low from the last 60 sessions
    f["low_near_ma"] = min(abs(b["l"] - e21), abs(b["l"] - s50)) / atr <= 1.0
    swing_lows = [ll[k] for k in range(i - 60, i - 5) if ll[k] <= min(ll[k - 3:k + 4])]
    f["low_near_swing_low"] = any(abs(b["l"] - sl) / atr <= 1.0 for sl in swing_lows)
    f["reclaims_e8"] = b["c"] > S["e8"][i] if S["e8"][i] else False
    f["reclaims_e21"] = b["c"] > S["e21"][i] if S["e21"][i] else False
    f["ext_vs_sma50_pct"] = round(pct(b["c"], s50), 1)
    f["downtrend"] = (p["c"] < s200) and not f["sma50_rising"]
    pb = -f["pullback_from_20d_high_pct"]
    sc = 0
    sc += 2 if f["above_200"] else 0
    sc += 1 if f["sma50_rising"] else 0
    sc += 1 if f["sma200_rising"] else 0
    sc += 2 if 3 <= pb <= 15 else (1 if 1.5 <= pb <= 25 else 0)
    sc += 2 if f["low_near_ma"] else 0
    sc += 1 if f["low_near_swing_low"] else 0
    sc += 1 if f["reclaims_e8"] else 0
    sc += 1 if f["reclaims_e21"] else 0
    sc += 1 if f["close_pos"] >= 0.8 else 0
    sc += 1 if f["day_pct"] >= 3 else 0
    sc += 1 if (f["rvol"] or 0) >= 1.5 else 0
    sc += 1 if f["super"] else 0
    f["setup_score"] = sc
    ok = cand and not f["downtrend"] and -5 <= f["ext_vs_sma50_pct"] <= 20 and sc >= 9
    return ok, sc, f


def existing_ids():
    out = []
    try:
        db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        cols = [r[1] for r in con.execute("pragma table_info(study_items)")]
        rows = con.execute("select * from study_items where skill_id in ('setup.family4.oops','setup.family3.kicker')").fetchall()
        for r in rows:
            d = dict(zip(cols, r))
            src = str(d.get("source_ref") or "")
            if "setup_examples.json" in src:
                out.append({"id": d.get("id"), "skill": d.get("skill_id"), "sym": d.get("sym"), "asof": d.get("asof"),
                            "status": d.get("review_status")})
    except Exception as e:  # noqa
        out.append({"error": repr(e)})
    return out


def main():
    t0 = time.time()
    uni = json.load(open(os.path.join(REPO, "api/data/cap_universe.json"), encoding="utf-8"))
    syms = list(dict.fromkeys(ALL_CANDIDATES + uni))
    today = int(date.today().strftime("%Y%m%d"))
    ex_rows = existing_ids()
    existing_keys = {(r.get("sym"), r.get("asof")) for r in ex_rows if r.get("skill") == "setup.family4.oops"}
    hits, existing, scanned, raw = [], [], 0, 0
    for sym in syms:
        try:
            rows = bars_sqlite.get_bars_before(sym, "D", BARS, today)
        except Exception:
            continue
        if len(rows) < 400:
            continue
        bars = rows_to_bars(rows)
        if bars[-1]["t"] < today - 100:
            continue
        scanned += 1
        S = U.series(bars)
        last_i = -10_000
        for i in range(260, len(bars) - FORWARD - 1):
            asof = key_to_iso(bars[i]["t"])
            is_old = (sym, asof) in existing_keys
            if i - last_i < MIN_GAP and not is_old:
                continue
            try:
                c = uct_oops_reversal.evaluate(bars, S, i)
            except Exception:
                c = None
            if not c:
                continue
            raw += 1
            ok, sc, f = oops_facts(bars, S, i)
            if is_old:
                existing.append({"sym": sym, "asof": asof, "setup_score": sc, "facts": f})
                continue
            if not ok or not legible(bars, i) or not clean_window(bars, i) or not window_liquid(bars, i):
                continue
            hits.append({"setup": "Oops Reversal", "sym": sym, "asof": asof, "year": int(asof[:4]), "close": bars[i]["c"],
                         "facts": f, "q": sc + min(f["day_pct"], 10) / 100.0})
            last_i = i
    import datetime as _dt
    def dnum(a): return _dt.date.fromisoformat(a).toordinal()
    rows = sorted(hits, key=lambda r: (-r["q"], r["asof"]))
    picked, per_sym, per_year, per_var = [], {}, {}, {}
    for r in rows:
        var = r["facts"]["variant"]
        if per_sym.get(r["sym"], 0) >= 1 or per_year.get(r["year"], 0) >= 5 or per_var.get(var, 0) >= PER_VARIANT:
            continue
        if any(abs(dnum(r["asof"]) - dnum(p["asof"])) < 20 for p in picked):
            continue
        picked.append(r); per_sym[r["sym"]] = 1
        per_year[r["year"]] = per_year.get(r["year"], 0) + 1; per_var[var] = per_var.get(var, 0) + 1
        if len(picked) >= 30:
            break
    print(json.dumps({"generated": date.today().isoformat(), "scanned": scanned, "candidates": len(syms), "raw_detector_hits": raw,
                      "passing": len(hits), "seconds": round(time.time() - t0), "existing": existing,
                      "existing_ids": ex_rows, "picks": picked}, indent=1))


if __name__ == "__main__":
    main()
