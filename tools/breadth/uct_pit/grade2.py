"""Grade the rebuilt list by what matters: the breadth readings it produces. For each session,
the same readings over the rebuilt list and over the real list, from the same bars. Prints only
differences (percentage points of the universe), never a reading."""
import sys, json
sys.path.insert(0, "/data/_audit/uct_pit/code")
import membership as M
L = json.load(open(sys.argv[1]))["dates"]
ref, spl, sh = M.Ref(), M.Splits(), M.Shares()
ss = M.sessions()
def readings(names, b0, b1):
    ch = [(b0[t][3] / b1[t][3] - 1) for t in names if t in b0 and t in b1 and b0[t][3] and b1[t][3]]
    n = len(ch) or 1
    return {"adv": 100 * sum(c > 0 for c in ch) / n, "up4": 100 * sum(c >= 0.04 for c in ch) / n,
            "dn4": 100 * sum(c <= -0.04 for c in ch) / n}
diffs = {"all": {}, "rule": {}}
js = {"all": [], "rule": []}
for d in sorted(L):
    i = ss.index(d); prev = ss[i-1]; why = {}
    pred = M.members(d, prev, ref, spl, sh, why)
    true = {M.norm(t) for t in L[d]["tickers"]}
    rule = sum(1 for t in true - pred if why.get(t) == "volume") <= 60
    b0, b1 = M.bars(d), M.bars(prev)
    rp, rt = readings(pred, b0, b1), readings(true, b0, b1)
    for grp in (["all", "rule"] if rule else ["all"]):
        js[grp].append(len(pred & true) / len(pred | true))
        for k in rp: diffs[grp].setdefault(k, []).append(abs(rp[k] - rt[k]))
for grp in ("rule", "all"):
    j = sorted(js[grp])
    print(grp, "days", len(j), "list overlap median", round(j[len(j)//2], 4), "p10", round(j[len(j)//10], 4))
    for k, v in diffs[grp].items():
        v = sorted(v); print("  ", k, "abs diff pp: median", round(v[len(v)//2], 2), "p90", round(v[int(len(v)*.9)], 2), "max", round(v[-1], 2))
