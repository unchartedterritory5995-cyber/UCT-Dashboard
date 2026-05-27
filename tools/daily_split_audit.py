"""Split-aware daily-integrity audit.

Resolves the honest open question: of the daily series my crude
">2.5x adjacent" rule flagged, how many are LEGIT (a stock split or
the yfinance->Massive deep-history merge seam — benign, expected) vs
GENUINE single-bar corruption (a spike that reverts — real, fixable)?

Classification of the worst adjacent close jump in each daily series:
  - spike_revert : bar i wildly off, bar i+1 returns near bar i-1
                   => one bad bar (CORRUPTION — matters)
  - level_shift  : persistent step; series stays on the new level
                   => split / merge-seam (BENIGN in adjusted data, or a
                      real split/reverse-split)
  - clean        : no >2.5x adjacent jump
Read-only (GET /api/bars only); changes nothing.
"""
import json, os, random, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://uctintelligence.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36"

def fetch(t):
    u = f"{BASE}/api/bars/{t}?tf=D&bars=8000"
    try:
        with urllib.request.urlopen(
            urllib.request.Request(u, headers={"User-Agent": UA}), timeout=90
        ) as r:
            return json.loads(r.read().decode()).get("bars") or []
    except Exception as e:
        return {"_e": f"{type(e).__name__}:{str(e)[:50]}"}

def classify(bars):
    cs = [b.get("c") for b in bars if b.get("c")]
    if len(cs) < 5:
        return ("thin", None)
    worst = (1.0, -1)
    for i in range(1, len(cs)):
        p, c = cs[i - 1], cs[i]
        if p and c:
            r = max(c / p, p / c)
            if r > worst[0]:
                worst = (r, i)
    ratio, i = worst
    if ratio <= 2.5:
        return ("clean", round(ratio, 2))
    # Compare the level BEFORE the jump (avg of i-3..i-1) to AFTER
    # (avg of i+1..i+3). If the post-jump level reverts close to the
    # pre-jump level => single bad bar that reverted (corruption). If it
    # holds the new level => split / merge seam.
    lo = max(0, i - 3)
    pre = sum(cs[lo:i]) / max(1, len(cs[lo:i]))
    post_slice = cs[i + 1:i + 4]
    if not post_slice:
        return ("edge_spike", round(ratio, 2))   # jump at the very last bar
    post = sum(post_slice) / len(post_slice)
    if pre <= 0:
        return ("level_shift", round(ratio, 2))
    revert = abs(post - pre) / pre
    bad = cs[i]
    bad_dev = abs(bad - pre) / pre
    # bad bar far from pre-level, but series reverts to ~pre afterwards
    if bad_dev > 1.5 and revert < 0.4:
        return ("spike_revert", round(ratio, 2))
    return ("level_shift", round(ratio, 2))

def main():
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    uni = [t.upper() for t in json.load(open("api/data/cap_universe.json")) if t]
    random.seed(11)
    sample = random.sample(uni, 350)
    cnt = {"clean": 0, "level_shift": 0, "spike_revert": 0,
           "edge_spike": 0, "thin": 0, "err": 0}
    spike_ex, edge_ex = [], []
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(fetch, t): t for t in sample}
        for fu in as_completed(futs):
            t = futs[fu]
            res = fu.result()
            if isinstance(res, dict):
                cnt["err"] += 1
                continue
            kind, ratio = classify(res)
            cnt[kind] = cnt.get(kind, 0) + 1
            if kind == "spike_revert" and len(spike_ex) < 40:
                spike_ex.append(f"{t} ratio={ratio}")
            if kind == "edge_spike" and len(edge_ex) < 40:
                edge_ex.append(f"{t} ratio={ratio}")
    print(f"=== DAILY split-aware audit — {len(sample)} random tickers ===")
    print(f"  clean (no >2.5x)        : {cnt['clean']}")
    print(f"  level_shift (split/seam): {cnt['level_shift']}   <- BENIGN")
    print(f"  spike_revert (CORRUPT)  : {cnt['spike_revert']}  <- real bugs")
    print(f"  edge_spike (last bar)   : {cnt['edge_spike']}")
    print(f"  thin / err              : {cnt['thin']} / {cnt['err']}")
    n = len(sample) - cnt["err"] - cnt["thin"]
    if n > 0:
        print(f"  => genuine-corruption rate: "
              f"{cnt['spike_revert']}/{n} = {cnt['spike_revert']*100/n:.2f}%")
    if spike_ex:
        print("  spike_revert examples:", "; ".join(spike_ex))
    if edge_ex:
        print("  edge_spike examples:", "; ".join(edge_ex))

if __name__ == "__main__":
    main()
