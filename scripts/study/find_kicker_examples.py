"""Kicker examples, pass 2 (read-only on the pod): score the SETUP behind the candle.

Owner, 2026-10-24: ETON 2024-01-08 was the best of the first batch "because it is
technically already giving a good setup"; the rest were "all average". So this
pass keeps the firm's detector (uct_kicker.evaluate) as the gate and ranks hits
by the context BEFORE the kicker: above the 200 and 50, flat-or-rising
averages, converged MAs, a tight base, the red day pulling into the MAs, and
the kicker breaking out of that base. Full cap universe. Reads bars.db only.
Prints JSON: {scanned, raw_hits, existing: [...], picks: [...]}.
"""
import json, os, sys, time, sqlite3
from datetime import date

REPO = os.getcwd()
sys.path.insert(0, REPO)
from api.services import bars_sqlite  # noqa
from api.services.pattern_engine.detectors.uct import uct_setups_common as U  # noqa
from api.services.pattern_engine.detectors.uct import uct_kicker  # noqa
from scripts.study.find_candle_examples import ALL_CANDIDATES  # noqa

BARS = 1500
WINDOW, FORWARD = 120, 20
MIN_GAP = 40
EXISTING = {("SHOP", "2021-11-12"), ("AFRM", "2022-01-28"), ("AVAV", "2022-02-28"), ("FUTU", "2022-04-04"),
            ("COIN", "2023-01-04"), ("INTA", "2023-02-07"), ("MSTR", "2023-03-13"), ("ETON", "2024-01-08"),
            ("SMCI", "2024-02-22"), ("PINS", "2024-05-01")}


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


def kicker_facts(bars, S, i):
    """Candle facts + the setup behind it. Returns (ok, score, facts)."""
    b, p = bars[i], bars[i - 1]
    cc, hh = S["c"], S["h"]
    rng = b["h"] - b["l"]
    v50 = S["v50"][i - 1]
    f = {"prior_red": p["c"] < p["o"], "gap_pct": round(pct(b["o"], p["c"]), 2), "day_pct": round(pct(b["c"], p["c"]), 2),
         "green": b["c"] > b["o"], "close_above_prior_high": b["c"] > p["h"],
         "close_pos": round((b["c"] - b["l"]) / rng, 2) if rng else 0,
         "rvol": round(b["v"] / v50, 2) if v50 else None}
    cand = (f["prior_red"] and f["gap_pct"] >= 1.5 and f["green"] and f["close_above_prior_high"]
            and f["close_pos"] >= 0.7 and f["day_pct"] >= 4.0 and (f["rvol"] or 0) >= 1.5)
    j = i - 1
    s50, s200, e8, e21 = S["s50"][j], S["s200"][j], S["e8"][j], S["e21"][j]
    atr = S["atr"][j] or rng or 1e-9
    if not (s50 and s200 and e8 and e21):
        return False, 0, f
    s50_prev, s200_prev = S["s50"][j - 20], S["s200"][j - 20]
    f["above_200"] = p["c"] > s200
    f["above_50"] = p["c"] > s50
    f["sma50_rising"] = bool(s50_prev) and s50 >= s50_prev * 0.995
    f["sma200_rising"] = bool(s200_prev) and s200 >= s200_prev * 0.995
    vals = [e8, e21, s50]
    f["ma_spread_pct"] = round((max(vals) - min(vals)) / p["c"] * 100, 2)
    base20 = cc[i - 20:i]; base30 = cc[i - 30:i]
    f["base20_range_pct"] = round((max(base20) - min(base20)) / p["c"] * 100, 1)
    f["base30_range_pct"] = round((max(base30) - min(base30)) / p["c"] * 100, 1)
    f["pullback_to_ma"] = min(abs(p["c"] - e21), abs(p["c"] - s50)) / atr <= 1.5
    f["breakout10"] = b["c"] > max(hh[i - 10:i])
    f["breakout20"] = b["c"] > max(hh[i - 20:i])
    f["ext_vs_sma50_pct"] = round(pct(b["c"], s50), 1)
    f["downtrend"] = (p["c"] < s200) and not f["sma50_rising"]
    sc = 0
    sc += 2 if f["above_200"] else 0
    sc += 1 if f["above_50"] else 0
    sc += 1 if f["sma50_rising"] else 0
    sc += 1 if f["sma200_rising"] else 0
    sc += 2 if f["ma_spread_pct"] <= 5 else (1 if f["ma_spread_pct"] <= 8 else 0)
    sc += 2 if f["base20_range_pct"] <= 15 else (1 if f["base20_range_pct"] <= 25 else 0)
    sc += 1 if f["pullback_to_ma"] else 0
    sc += 2 if f["breakout20"] else (1 if f["breakout10"] else 0)
    sc += 1 if f["ext_vs_sma50_pct"] <= 15 else 0
    sc += 1 if f["close_pos"] >= 0.85 else 0
    sc += 1 if f["day_pct"] >= 6 else 0
    sc += 1 if (f["rvol"] or 0) >= 2.5 else 0
    f["setup_score"] = sc
    ok = cand and not f["downtrend"] and f["ext_vs_sma50_pct"] <= 30 and sc >= 10
    return ok, sc, f


def existing_ids():
    out = []
    try:
        db = os.environ.get("STUDY_DB_PATH") or "/data/study.db"
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        cols = [r[1] for r in con.execute("pragma table_info(study_items)")]
        rows = con.execute("select * from study_items where skill_id='setup.family3.kicker' and review_status='draft'").fetchall()
        for r in rows:
            d = dict(zip(cols, r))
            src = d.get("source_ref") or d.get("source") or ""
            if "setup_examples.json" in str(src):
                out.append({"id": d.get("id"), "sym": d.get("sym"), "asof": d.get("asof"), "source_ref": src})
    except Exception as e:  # noqa
        out.append({"error": repr(e)})
    return out


def main():
    t0 = time.time()
    uni = json.load(open(os.path.join(REPO, "api/data/cap_universe.json"), encoding="utf-8"))
    syms = list(dict.fromkeys(ALL_CANDIDATES + uni))
    today = int(date.today().strftime("%Y%m%d"))
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
            is_old = (sym, asof) in EXISTING
            if i - last_i < MIN_GAP and not is_old:
                continue
            try:
                c = uct_kicker.evaluate(bars, S, i)
            except Exception:
                c = None
            if not c:
                continue
            raw += 1
            ok, sc, f = kicker_facts(bars, S, i)
            if is_old:
                existing.append({"sym": sym, "asof": asof, "setup_score": sc, "facts": f})
                continue
            if not ok or not legible(bars, i) or not clean_window(bars, i) or not window_liquid(bars, i):
                continue
            hits.append({"setup": "Kicker Candle", "sym": sym, "asof": asof, "year": int(asof[:4]), "close": bars[i]["c"],
                         "facts": f, "q": sc + min(f["day_pct"], 15) / 100.0})
            last_i = i
    import datetime as _dt
    def dnum(a): return _dt.date.fromisoformat(a).toordinal()
    rows = sorted(hits, key=lambda r: (-r["q"], r["asof"]))
    picked, per_sym, per_year = [], {}, {}
    for r in rows:
        if per_sym.get(r["sym"], 0) >= 1 or per_year.get(r["year"], 0) >= 5:
            continue
        if any(abs(dnum(r["asof"]) - dnum(p["asof"])) < 20 for p in picked):
            continue
        picked.append(r); per_sym[r["sym"]] = 1; per_year[r["year"]] = per_year.get(r["year"], 0) + 1
        if len(picked) >= 24:
            break
    print(json.dumps({"generated": date.today().isoformat(), "scanned": scanned, "candidates": len(syms), "raw_detector_hits": raw,
                      "passing": len(hits), "seconds": round(time.time() - t0), "existing": existing,
                      "existing_ids": existing_ids(), "picks": picked}, indent=1))


if __name__ == "__main__":
    main()
