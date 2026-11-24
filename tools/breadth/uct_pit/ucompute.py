"""Up Vol / HVC / >7xATR for us / nasdaq / nyse: production's breadth engine (the same one the UCT
PIT rebuild used: compute.py) over each universe's rebuilt membership (umem.py).
argv: LO HI. Writes /data/_audit/uct_pit/uout/rows_<lo>_<hi>.jsonl. Prints counts only."""
import json, os, sys, time
sys.path.insert(0, "/data/_audit/uct_pit/code")
import compute as C
M, recon = C.M, C.recon
KEEP = ("up_vol_ratio", "hvc_52w", "up_on_volume", "down_on_volume")
CHECK = ("universe_count", "advancing", "declining", "pct_above_50sma", "new_52w_highs")
lo, hi = sys.argv[1], sys.argv[2]
ss = M.sessions()
i0 = max(0, next(i for i, d in enumerate(ss) if d >= lo) - 330)
span = [d for d in ss[i0:] if d <= hi]
t0 = time.time()
frame, tickers = C.build_frame(span)
print("frame", len(tickers), "x", len(span), "secs", round(time.time() - t0), flush=True)
os.makedirs("/data/_audit/uct_pit/uout", exist_ok=True)
out = open(f"/data/_audit/uct_pit/uout/rows_{lo}_{hi}.jsonl", "w")
n = 0
for d in span:
    if d < lo: continue
    p = f"/data/_audit/uct_pit/umem/{d}.json"
    if not os.path.exists(p): continue
    mem_all = json.load(open(p))
    row = {"date": d}
    for u, names in mem_all.items():
        if not names: continue
        mem = {M.norm(t) for t in names}
        r = recon.recompute_from_frame(frame, tickers, d, members=mem)
        if not r.get("ok"):
            row[u] = {"ok": False, "reason": r.get("reason")}; continue
        m = r["metrics"]
        v = {k: m.get(k) for k in KEEP + CHECK}
        v["atr_ext_7"] = C.atr_ext(frame, frame["date_pos"][d], mem)
        v["members"] = len(mem)
        row[u] = v
    out.write(json.dumps(row) + "\n"); n += 1
    if n % 100 == 0: print("sessions", n, "at", d, "secs", round(time.time() - t0), flush=True)
out.close()
print("DONE", n, "secs", round(time.time() - t0), flush=True)
