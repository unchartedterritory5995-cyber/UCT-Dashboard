"""Detect phantom/misprint bars in what the BACKEND serves (not frontend).

For DDOG + a random sample, fetch intraday and find any bar whose
close is wildly off its neighbours (the 100x / dropped-decimal class).
Tells us if corruption is in the data pipeline vs frontend/IDB.
"""
import json, urllib.request, random, collections
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://uctintelligence.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36"

def fetch(t, tf):
    u = f"{BASE}/api/bars/{t}?tf={tf}&bars=5000"
    try:
        req = urllib.request.Request(u, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=90) as r:
            return (json.loads(r.read().decode()).get("bars") or [])
    except Exception as e:
        return {"_err": f"{type(e).__name__}:{str(e)[:60]}"}

def worst(bars):
    """Return (ratio, idx, prevc, c) for the most extreme adjacent close jump."""
    w = (1.0, -1, 0, 0)
    cs = [b.get("c") for b in bars if b.get("c")]
    for i in range(1, len(cs)):
        p, c = cs[i-1], cs[i]
        if p and c:
            r = max(c/p, p/c)
            if r > w[0]:
                w = (r, i, p, c)
    return w

def main():
    import os
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    uni = [t.upper() for t in json.load(open("api/data/cap_universe.json")) if t]
    random.seed(7)
    sample = ["DDOG", "LBRDK", "BRK-B", "AAPL", "NVDA", "TSLA"] + random.sample(uni, 60)
    jobs = [(t, tf) for t in dict.fromkeys(sample) for tf in ("5", "15", "30", "60")]
    print(f"phantom-scan: {len(jobs)} series")
    flagged = []
    errs = empties = 0
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(fetch, t, tf): (t, tf) for t, tf in jobs}
        for fu in as_completed(futs):
            t, tf = futs[fu]
            res = fu.result()
            if isinstance(res, dict):
                errs += 1; continue
            if not res:
                empties += 1; continue
            ratio, idx, pc, c = worst(res)
            # >5x adjacent close = not a normal move; phantom/decimal class
            if ratio > 5:
                last = res[-1]
                flagged.append((t, tf, round(ratio, 1), idx, pc, c,
                                f"lastC={last.get('c')}"))
    print(f"errors={errs} empties={empties} flagged={len(flagged)} "
          f"of {len(jobs)}")
    flagged.sort(key=lambda x: -x[2])
    for t, tf, r, idx, pc, c, last in flagged[:60]:
        print(f"  {t}/{tf}: {r}x jump @bar{idx} {pc} -> {c}  ({last})")

if __name__ == "__main__":
    main()
