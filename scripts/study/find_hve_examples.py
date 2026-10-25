"""High Volume Edge pass 4 (read-only on the pod): the owner's definition, confirmed 2026-10-25. An HVE is a volume
day that DWARFS everything before it (>= 10x the 50-day average or >= 2.5x the prior-year record), often on a
lesser-known name, the start of a new story; earnings days CAN count when the volume is truly massive; the HVE close
is a LEVEL (price may trade below it later, so there is NO must-work gate; the forward facts are recorded only).
Excluded: monthly OPEX (third Friday) and month-end sessions (rebalance volume), down closes, closes under $5,
< $5M/day names. The firm detector uct_hve needs 190 prior sessions and so misses recent IPOs (NAVN); this scan
also admits a bar with >= 60 prior sessions whose volume beats every prior session. Prints the two owner
references (NAVN 2026-03-26, MRNA 2026-08-19) with the same facts, plus a broad ranked list."""
import json, os, sys, time, calendar, datetime as dt
from datetime import date
REPO = os.getcwd(); sys.path.insert(0, REPO)
from api.services import bars_sqlite  # noqa
from api.services.pattern_engine.detectors.uct import uct_setups_common as U  # noqa
from api.services.pattern_engine.detectors.uct import uct_hve  # noqa
from scripts.study.find_candle_examples import ALL_CANDIDATES  # noqa
BARS, WINDOW, FORWARD, MIN_GAP = 1500, 120, 20, 60
KNOWN = set(ALL_CANDIDATES)
SEEN = {"ROKU", "SOFI", "CRWD", "HPK", "ELF", "BBIO", "RIOT", "SMCI", "HIMS", "IREN",
        "RCL", "CPNG", "NTRS", "KNX", "LRCX", "COMP", "CVX", "CIEN", "AAPL", "HOOD", "ASML", "ORCL", "RL", "DUOL", "GM", "AXON"}
REFS = [("NAVN", 20260326), ("MRNA", 20260819)]
def key_to_iso(k): s=str(int(k)); return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
def rows_to_bars(rows): return [{"t":int(r[0]),"o":float(r[1]),"h":float(r[2]),"l":float(r[3]),"c":float(r[4]),"v":float(r[5])} for r in rows]
def pct(a,b): return (a/b-1)*100 if b else 0.0
def _date(k): s=str(int(k)); return dt.date(int(s[:4]),int(s[4:6]),int(s[6:8]))
def dcr(b): r=b["h"]-b["l"]; return (b["c"]-b["l"])/r if r>0 else 0.5
def is_opex(d):
    fr=[w[4] for w in calendar.monthcalendar(d.year,d.month) if w[4]]; return d.day==fr[2]
def is_month_end(d, nxt):
    return nxt is None or nxt.month!=d.month
def clean_window(bars,i,window=WINDOW,forward=FORWARD):
    lo,hi=max(0,i-window+1),min(len(bars)-1,i+forward)
    if bars[i]["t"]<20190101: return False
    if (_date(bars[hi]["t"])-_date(bars[lo]["t"])).days>(hi-lo)*1.9+10: return False
    for k in range(lo+1,hi+1):
        a,b=bars[k-1],bars[k]
        if a["c"]<=0 or abs(b["c"]/a["c"]-1)>0.80: return False
    return True
def liquid(bars,i,window=WINDOW):
    w=bars[max(0,i-window+1):i+1]; dv=sum(x["c"]*x["v"] for x in w)/len(w); return bars[i]["c"]>=5.0 and dv>=5_000_000, dv
def forward(bars,i,hvc):
    b=bars[i]; fwd=bars[i+1:i+21]
    if not fwd: return {}
    above=sum(1 for x in fwd if x["c"]>=hvc)
    reclaim=None
    below=False
    for k,x in enumerate(fwd):
        if x["c"]<hvc: below=True
        elif below and x["c"]>=hvc: reclaim=k+1; break
    f={"fwd_sessions":len(fwd),"fwd_min_close_vs_hvc_pct":round(pct(min(x["c"] for x in fwd),hvc),1),"fwd_closes_above_hvc":above,
       "fwd_reclaim_session":reclaim,"fwd_max_gain_pct":round(pct(max(x["h"] for x in fwd),b["c"]),1)}
    for n in (5,10,20):
        if i+n<len(bars): f[f"fwd_{n}d_pct"]=round(pct(bars[i+n]["c"],b["c"]),1)
    return f
def facts(bars,S,i):
    b,p=bars[i],bars[i-1]; j=i-1
    if b["c"]<=p["c"] or i<60: return None
    v50=S["v50"][j]
    prior=bars[max(0,i-252):i]; prior_max=max(x["v"] for x in prior)
    rvol=b["v"]/v50 if v50 else 0.0; edge=b["v"]/prior_max if prior_max else 0.0
    if not (rvol>=10.0 or edge>=2.5): return None
    if b["v"]<=prior_max: return None          # must be the record of the available lookback
    d=_date(b["t"]); nxt=_date(bars[i+1]["t"]) if i+1<len(bars) else None
    if is_opex(d) or is_month_end(d,nxt): return None
    rng=b["h"]-b["l"]; atr=S["atr"][j] or rng or 1e-9
    s50,s200=S["s50"][j],S["s200"][j]
    cc=S["c"]; hh=S["h"]
    try: det=uct_hve.evaluate(bars,S,i)
    except Exception: det=None
    f={"day_pct":round(pct(b["c"],p["c"]),2),"close_pos":round(dcr(b),2),"gap_pct":round(pct(b["o"],p["c"]),2),
       "rvol":round(rvol,1),"edge_ratio":round(edge,2),"prior_sessions":i,"range_atr":round(rng/atr,2),
       "detector_fires":bool(det),"ever_in_data":b["v"]>max(x["v"] for x in bars[:i]),
       "above_200":bool(s200) and p["c"]>s200,"above_50":bool(s50) and p["c"]>s50,"hvc":round(b["c"],2),"hve_low":round(b["l"],2),
       "base20_range_pct":round((max(cc[i-20:i])-min(cc[i-20:i]))/p["c"]*100,1),
       "run_prior_20d_pct":round(pct(p["c"],cc[i-20]),1),"breakout20":b["c"]>max(hh[i-20:i])}
    sc=0
    sc+=3 if rvol>=20 else (2 if rvol>=15 else 1)
    sc+=2 if edge>=4 else (1 if edge>=2.5 else 0)
    sc+=1 if f["ever_in_data"] else 0
    sc+=1 if 5<=f["day_pct"]<=60 else 0
    sc+=1 if f["close_pos"]>=0.6 else 0
    sc+=1 if f["base20_range_pct"]<=25 else 0
    sc+=1 if f["gap_pct"]<=25 else 0
    f["setup_score"]=sc
    return f
def main():
    t0=time.time(); today=int(date.today().strftime("%Y%m%d"))
    refs=[]
    for sym,key in REFS:
        rows=bars_sqlite.get_bars_before(sym,"D",BARS,today); bars=rows_to_bars(rows); S=U.series(bars)
        idx=[k for k,b in enumerate(bars) if b["t"]==key]
        if idx:
            i=idx[0]; b,p=bars[i],bars[i-1]; v50=S["v50"][i-1] or 1; prior_max=max(x["v"] for x in bars[max(0,i-252):i])
            f={"day_pct":round(pct(b["c"],p["c"]),2),"close_pos":round(dcr(b),2),"gap_pct":round(pct(b["o"],p["c"]),2),"rvol":round(b["v"]/v50,1),
               "edge_ratio":round(b["v"]/prior_max,2),"prior_sessions":i,"hvc":round(b["c"],2),"hve_low":round(b["l"],2),
               "ever_in_data":b["v"]>max(x["v"] for x in bars[:i]),"detector_fires":bool(uct_hve.evaluate(bars,S,i)) if i>=31 else False}
            f.update(forward(bars,i,b["c"])); refs.append({"sym":sym,"asof":key_to_iso(key),"close":b["c"],"facts":f})
    uni=json.load(open(os.path.join(REPO,"api/data/cap_universe.json"),encoding="utf-8"))
    syms=[s for s in dict.fromkeys(ALL_CANDIDATES+uni) if s not in SEEN]
    hits=[]; scanned=0
    for sym in syms:
        try: rows=bars_sqlite.get_bars_before(sym,"D",BARS,today)
        except Exception: continue
        if len(rows)<120: continue
        bars=rows_to_bars(rows)
        if bars[-1]["t"]<today-100: continue
        scanned+=1; S=U.series(bars); last_i=-10_000
        for i in range(60,len(bars)-5):
            if i-last_i<MIN_GAP: continue
            f=facts(bars,S,i)
            if not f: continue
            lq,dv=liquid(bars,i)
            if not lq or not clean_window(bars,i): continue
            f.update(forward(bars,i,bars[i]["c"])); f["avg_dollar_volume_m"]=round(dv/1e6,1); f["known_name"]=sym in KNOWN
            q=f["setup_score"]+min(dv/1e6,50)/50.0+(1 if (f.get("fwd_max_gain_pct") or 0)>=15 else 0)+(1 if (f.get("fwd_closes_above_hvc") or 0)>=12 else 0)
            hits.append({"sym":sym,"asof":key_to_iso(bars[i]["t"]),"year":int(str(bars[i]["t"])[:4]),"close":bars[i]["c"],"facts":f,"q":round(q,2)}); last_i=i
    rows=sorted(hits,key=lambda r:(-r["q"],r["asof"])); picked,per_sym=[],{}
    for r in rows:
        if per_sym.get(r["sym"],0)>=1: continue
        picked.append(r); per_sym[r["sym"]]=1
        if len(picked)>=160: break
    print(json.dumps({"generated":date.today().isoformat(),"scanned":scanned,"passing":len(rows),"seconds":round(time.time()-t0),"references":refs,"picks":picked},indent=1))
if __name__=="__main__": main()
