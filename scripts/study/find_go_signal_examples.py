"""Go Signal pass 1 (read-only on the pod): the firm's detector uct_go_signal.evaluate is the gate (its DAILY
footprint: a rising 20-day, a recent notable move or tight base, a weak open, a sweep of a nearby support, buyers
stepping in, a strong close), then the universal rules the owner set on 2026-10-24 (liquid and sizable names only,
a clean window, MUST WORK on the forward strip) and a gallery score that prefers what reads best on a daily chart:
red to green, a long lower wick, a close in the top fifth, a named level swept (prior low or an average, not only
the 5-bar low), location by a recent run or a tight base, ordinary range (a technical day, not a news day), the
stock above its 200-day with a rising 50. Owner ruling on the Go Signal definition is PENDING; the real trigger
is intraday and the daily bar is only its footprint, which the lesson says. Prints a ranked candidate list.

  railway ssh ... /opt/venv/bin/python  (via scratchpad run_pod_py.ps1)
"""
import json, os, sys, time
from datetime import date
REPO = os.getcwd(); sys.path.insert(0, REPO)
from api.services import bars_sqlite  # noqa
from api.services.pattern_engine.detectors.uct import uct_setups_common as U  # noqa
from api.services.pattern_engine.detectors.uct import uct_go_signal  # noqa
from scripts.study.find_candle_examples import ALL_CANDIDATES  # noqa
# the shared helpers, inlined so the script runs on the pod's deployed master (find_slingshot_examples.py is not there yet)
BARS, WINDOW, FORWARD, MIN_GAP = 1500, 120, 20, 40
KNOWN = set(ALL_CANDIDATES)
def key_to_iso(k): s=str(int(k)); return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
def rows_to_bars(rows): return [{"t":int(r[0]),"o":float(r[1]),"h":float(r[2]),"l":float(r[3]),"c":float(r[4]),"v":float(r[5])} for r in rows]
def pct(a,b): return (a/b-1)*100 if b else 0.0
def _days(k):
    import datetime as _d; s=str(int(k)); return _d.date(int(s[:4]),int(s[4:6]),int(s[6:8])).toordinal()
def dcr(b): r=b["h"]-b["l"]; return (b["c"]-b["l"])/r if r>0 else 0.5
def clean_window(bars,i,window=WINDOW,forward=FORWARD):
    lo,hi=i-window+1,i+forward
    if lo<0 or hi>=len(bars) or bars[i]["t"]<20190101: return False
    if _days(bars[hi]["t"])-_days(bars[lo]["t"])>(window+forward)*1.9: return False
    for k in range(lo+1,hi+1):
        a,b=bars[k-1],bars[k]
        if a["c"]<=0 or abs(b["c"]/a["c"]-1)>0.60: return False
        body=max(b["o"],b["c"])-min(b["o"],b["c"]); rng=b["h"]-b["l"]
        if rng>0 and body>0 and rng>12*body and rng/b["c"]>0.25: return False
    return True
def liquid(bars,i,window=WINDOW):
    w=bars[i-window+1:i+1]; dv=sum(x["c"]*x["v"] for x in w)/len(w); return bars[i]["c"]>=10.0 and dv>=20_000_000, dv
def works(bars,i):
    b=bars[i]; fwd=bars[i+1:i+21]
    if len(fwd)<20: return False,{}
    min_low=min(x["l"] for x in fwd); max_high=max(x["h"] for x in fwd)
    f={"fwd_min_low_vs_trigger_low_pct":round(pct(min_low,b["l"]),1),"fwd_max_gain_pct":round(pct(max_high,b["c"]),1),
       "fwd_5d_pct":round(pct(bars[i+5]["c"],b["c"]),1),"fwd_10d_pct":round(pct(bars[i+10]["c"],b["c"]),1),"fwd_20d_pct":round(pct(bars[i+20]["c"],b["c"]),1)}
    return (min_low>=b["l"]*1.02 and f["fwd_max_gain_pct"]>=8.0 and f["fwd_5d_pct"]>=3.0 and f["fwd_10d_pct"]>0 and f["fwd_20d_pct"]>0), f


def facts(bars, S, i, det):
    b, p = bars[i], bars[i - 1]; j = i - 1
    rng = b["h"] - b["l"]; atr = S["atr"][j] or rng or 1e-9
    high20 = max(x["h"] for x in bars[i - 20:i]); low20 = min(x["l"] for x in bars[i - 20:i])
    f = {"variant": det["variant"], "fired_variants": det["fired_variants"], "swept": det["swept"],
         "red_to_green": bool(det["red_to_green"]), "wick_frac": det["wick_frac"], "dcr": det["dcr"],
         "loc_run": bool(det["loc_run"]), "loc_event": bool(det["loc_event"]), "loc_base": bool(det["loc_base"]),
         "oops_overlap": bool(det["oops_overlap"]), "rvol": det["rvol50"],
         "open_vs_prior_close_pct": round(pct(b["o"], p["c"]), 2), "low_vs_prior_low_pct": round(pct(b["l"], p["l"]), 2),
         "day_pct": round(pct(b["c"], p["c"]), 2), "range_atr": round(rng / atr, 2),
         "run20_pct": round(pct(high20, low20), 1), "pullback_from_20d_high_pct": round(pct(b["l"], high20), 1),
         "above_200": bool(S["s200"][j]) and b["c"] > S["s200"][j],
         "s50_slope10_pct": round(pct(S["s50"][j], S["s50"][j - 10]), 1) if (S["s50"][j] and S["s50"][j - 10]) else None,
         "e20_slope5_pct": round(pct(S["e20"][j], S["e20"][j - 5]), 2) if (S.get("e20") and S["e20"][j] and S["e20"][j - 5]) else None,
         "labels": det["label_variants"], "ma_periods": [9, 20, 50, 200]}
    named = [s for s in (f["swept"] or []) if s != "5bar_low"]
    sc = 0
    sc += 2 if f["red_to_green"] else 0
    sc += 2 if f["wick_frac"] >= 0.5 else (1 if f["wick_frac"] >= 0.4 else 0)
    sc += 2 if f["dcr"] >= 0.8 else (1 if f["dcr"] >= 0.65 else 0)
    sc += 2 if named else 1
    sc += 2 if (f["loc_run"] or f["loc_base"]) else (1 if f["loc_event"] else 0)
    sc += 2 if f["range_atr"] <= 1.8 else (1 if f["range_atr"] <= 2.5 else 0)
    sc += 1 if (f["rvol"] or 0) >= 1.0 else 0
    sc += 1 if f["above_200"] else 0
    sc += 1 if (f["s50_slope10_pct"] or 0) > 0 else 0
    sc += 1 if -12 <= f["pullback_from_20d_high_pct"] <= -2 else 0
    sc += 1 if f["day_pct"] >= 1.0 else 0
    cand = (f["dcr"] >= 0.6 and f["wick_frac"] >= 0.3 and f["range_atr"] <= 3.0 and f["open_vs_prior_close_pct"] <= -0.2
            and f["open_vs_prior_close_pct"] >= -6.0)   # a weak open, not a news gap down
    f["setup_score"] = sc
    return cand and sc >= 11, sc, f


def main():
    t0 = time.time(); today = int(date.today().strftime("%Y%m%d"))
    uni = json.load(open(os.path.join(REPO, "api/data/cap_universe.json"), encoding="utf-8"))
    syms = list(dict.fromkeys(list(KNOWN) + uni))
    hits = []; scanned = 0; fired = 0
    for sym in syms:
        try: rows = bars_sqlite.get_bars_before(sym, "D", BARS, today)
        except Exception: continue
        if len(rows) < 400: continue
        bars = rows_to_bars(rows)
        if bars[-1]["t"] < today - 100: continue
        scanned += 1; S = U.series(bars); last_i = -10_000
        for i in range(260, len(bars) - FORWARD - 1):
            if i - last_i < MIN_GAP: continue
            try: det = uct_go_signal.evaluate(bars, S, i)
            except Exception: det = None
            if not det: continue
            fired += 1
            ok, sc, f = facts(bars, S, i, det)
            if not ok: continue
            lq, dv = liquid(bars, i)
            if not lq or not clean_window(bars, i): continue
            w_ok, wf = works(bars, i)
            if not w_ok: continue
            f.update(wf); f["avg_dollar_volume_m"] = round(dv / 1e6, 1); f["known_name"] = sym in KNOWN
            q = sc + (1.0 if sym in KNOWN else 0) + min(dv / 1e6, 200) / 400.0 + min(f["fwd_5d_pct"], 10) / 20.0 + min(f["fwd_20d_pct"], 30) / 30.0
            hits.append({"sym": sym, "asof": key_to_iso(bars[i]["t"]), "year": int(str(bars[i]["t"])[:4]), "close": bars[i]["c"],
                         "facts": f, "q": round(q, 2)}); last_i = i
    rows = sorted(hits, key=lambda r: (-r["q"], r["asof"])); picked, per_sym = [], {}
    for r in rows:
        if per_sym.get(r["sym"], 0) >= 1: continue
        picked.append(r); per_sym[r["sym"]] = 1
        if len(picked) >= 120: break
    print(json.dumps({"generated": date.today().isoformat(), "scanned": scanned, "detector_fires": fired, "passing": len(rows),
                      "seconds": round(time.time() - t0), "picks": picked}, indent=1))


if __name__ == "__main__": main()
