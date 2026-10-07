import json, numpy as np, pandas as pd
raw=json.load(open("daily.json")); P=json.load(open("prod_rel.json"))
S={s:pd.Series({r["d"]:r["c"] for r in rows}).sort_index() for s,rows in raw.items()}
res=[]
def chk(name, ref, prod, tol=1e-9):
    if ref is None or prod is None: ok = ref is None and prod is None
    elif isinstance(ref,(str,bool)): ok = ref==prod
    else: ok = abs(ref-prod) <= tol*max(1,abs(ref))
    res.append((name, ref, prod, "PASS" if ok else "FAIL"))
# A
chk("A unix-seconds index dates == yfinance session dates (774)", "|".join(S["^GSPC"].index), "|".join(P["unixDates"]))
# B
ref=S["NVDA"].rolling(50).mean()
diffs=[abs(a-b) for a,b in zip(ref.values,P["sma50"]) if not np.isnan(a)]
chk("B SMA50 NVDA max |diff| (774 points)", 0.0, max(diffs), 1e-9)
chk("B SMA50 first-defined index", int(ref.first_valid_index() and list(ref.index).index(ref.first_valid_index())), next(i for i,v in enumerate(P["sma50"]) if v is not None))
# C REL
df=pd.concat([S["NVDA"],S["SPY"],S["AMD"]],axis=1,join="inner",keys=["NVDA","SPY","AMD"])
N={"1M":21,"3M":63,"6M":126,"1Y":252,"2Y":504}
for lb in ["1M","3M","6M","1Y","2Y","YTD"]:
    if lb=="YTD":
        yr=df.index[-1][:4]; base=df[df.index< f"{yr}-01-01"].index[-1]; n=len(df)-1-list(df.index).index(base)
    else: n=N[lb]
    w=df.iloc[-1-n:]; p=P["rel"][lb]
    chk(f"C REL {lb} sessions", n, p["sessions"],0)
    chk(f"C REL {lb} base date", w.index[0], p["dates"][0])
    for i,s in enumerate(["NVDA","SPY","AMD"]):
        r=(w[s].iloc[-1]/w[s].iloc[0]-1)*100
        dd=((w[s]/w[s].cummax())-1).min()*100
        row=p["rows"][i]
        chk(f"C REL {lb} {s} return %", r, row["ret"])
        chk(f"C REL {lb} {s} max drawdown %", dd, row["maxDd"])
        if i: chk(f"C REL {lb} {s} excess vs NVDA (pts)", r-((w['NVDA'].iloc[-1]/w['NVDA'].iloc[0]-1)*100), row["excess"])
    ratio=df["NVDA"]/df["SPY"]; avg=ratio.rolling(50).mean()
    chk(f"C REL {lb} NVDA/SPY ratio change %", (ratio.iloc[-1]/ratio.iloc[-1-n]-1)*100, p["ratio"]["change"])
    chk(f"C REL {lb} ratio above 50d avg", bool(ratio.iloc[-1]>avg.iloc[-1]), p["ratio"]["aboveAvg"])
    chk(f"C REL {lb} rebased line last pt == return", (w['AMD'].iloc[-1]/w['AMD'].iloc[0]-1)*100, p["lines"][2]["pct"][-1])
# D RRG daily
def quad(x,y): return ("Leading" if y>=100 else "Weakening") if x>=100 else ("Improving" if y>=100 else "Lagging")
for s in ["XLK","XLE","NVDA","TSM"]:
    d=pd.concat([S[s],S["SPY"]],axis=1,join="inner",keys=["s","b"])
    rs=100*d.s/d.b; ratio=100*rs/rs.rolling(10).mean(); mom=100*ratio/ratio.rolling(5).mean()
    pts=pd.concat([ratio,mom],axis=1,keys=["x","y"]).dropna(); tail=pts.iloc[-8:]
    p=P["rrgD"][s]
    chk(f"D RRG-D {s} RS-Ratio", tail.x.iloc[-1], p["ratio"]); chk(f"D RRG-D {s} RS-Momentum", tail.y.iloc[-1], p["momentum"])
    chk(f"D RRG-D {s} quadrant", quad(tail.x.iloc[-1],tail.y.iloc[-1]), p["quadrant"])
    q=[quad(a,b) for a,b in zip(pts.x,pts.y)]; k=0
    for v in reversed(q):
        if v!=q[-1]: break
        k+=1
    chk(f"D RRG-D {s} periods in quadrant", k, p["inQuadrant"],0)
    f,l=tail.index[0],tail.index[-1]
    chk(f"D RRG-D {s} tail rel return %", ((d.s[l]/d.s[f])/(d.b[l]/d.b[f])-1)*100, p["relRet"])
    chk(f"D RRG-D {s} as-of", l, p["asOf"])
# F CORR
syms=['NVDA','AMD','SPY','XLK','XLE','TSM']
C=pd.concat([S[s] for s in syms],axis=1,join="inner",keys=syms).pct_change().dropna()
for lb,n in N.items():
    ref=C.tail(n).corr(); np_ref=np.corrcoef(C.tail(n).values.T)
    m=P["corr"][lb]["matrix"]; worst=max(abs(ref.iloc[i,j]-m[i][j]["r"]) for i in range(6) for j in range(6))
    worst2=max(abs(np_ref[i,j]-m[i][j]["r"]) for i in range(6) for j in range(6))
    chk(f"F CORR {lb} 6x6 max |r diff| vs pandas", 0.0, worst, 1e-12); chk(f"F CORR {lb} max |r diff| vs numpy.corrcoef", 0.0, worst2,1e-12)
    chk(f"F CORR {lb} n per pair", n, m[0][1]["n"],0)
    tri=[(ref.iloc[i,j],syms[i],syms[j]) for i in range(6) for j in range(i+1,6)]
    mx=max(tri); chk(f"F CORR {lb} most-correlated pair", f"{mx[1]}/{mx[2]}", P["corr"][lb]["most"]["a"]+"/"+P["corr"][lb]["most"]["b"])
    avgs=[(ref.iloc[i].drop(syms[i])).mean() for i in range(6)]
    chk(f"F CORR {lb} avg r NVDA", avgs[0], P["corr"][lb]["avg"][0]["avg"])
# G halt
d=pd.concat([S["NVDA"],S["AMD"].drop("2026-08-14")],axis=1,join="inner",keys=["a","b"]).pct_change().dropna().tail(63)
chk("G CORR with 1 missing AMD session (pairwise-aligned ref)", d.corr().iloc[0,1], P["corrHalt"]["matrix"][0][1]["r"], 1e-12)
chk("G CORR missing-session n", len(d), P["corrHalt"]["matrix"][0][1]["n"],0)
# H edges
e=P["edges"]
chk("H closesFromBars drops 0/NaN/non-numeric; last bar of a date wins; accepts close", json.dumps([{"d":"2026-01-07","c":11},{"d":"2026-01-08","c":12}]), json.dumps(e["zeroNaN"]))
chk("H pearson constant series -> null", None, e["pearsonConst"]["r"]); chk("H pearson n<2 -> null", None, e["pearsonOne"]["r"])
chk("H rebase zero base -> all null", json.dumps([None]*3), json.dumps(e["rebaseZero"]))
chk("H windowSessions with 1 date -> 0", 0, e["windowShort"],0); chk("H REL one common session -> null", None, e["relOneDay"])
json.dump(res,open("res_rel.json","w"),default=str)
for r in res:
    if r[3]!="PASS": print(r)
print(len(res), sum(r[3]=="PASS" for r in res))
