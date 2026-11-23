"""UCT PIT rebuild, stage 5: every close-basis breadth column for each session, over the rebuilt
point-in-time UCT list, through PRODUCTION's live engine (breadth_live.build_levels +
compute_metrics via breadth_history_recon.recompute_from_frame). Bars: the provider's day flat
files (every traded ticker, survivorship-free), split-adjusted here for the levels.
Writes /data/_audit/uct_pit/out/rows_<from>_<to>.jsonl. Prints counts only."""
import gzip, importlib.util, json, os, sys, time
import numpy as np
sys.path.insert(0, "/data/_audit/uct_pit/code")
ROOT = "/data/_audit/uct_pit"
DIV_TABLE = os.environ.get("DIV_TABLE", "/data/breadth_v2_producer/vintages/p202611202129/inputs_p202611202129/dividend_basis_table.json")
# production's engine, not the runner's older copy
spec = importlib.util.spec_from_file_location("api.services.breadth_live", f"{ROOT}/code/prod_breadth_live.py")
bl = importlib.util.module_from_spec(spec); sys.modules["api.services.breadth_live"] = bl; spec.loader.exec_module(bl)
import api.services as _svc; _svc.breadth_live = bl
from api.services import breadth_history_recon as recon
import membership as M

def build_frame(sessions):
    tick, cols = {}, []
    for d in sessions:
        cols.append(M.load(f"{ROOT}/grouped/{d}.json.gz"))
        for t in cols[-1]: tick.setdefault(M.norm(t), len(tick))
    T, D = len(tick), len(sessions)
    closes = np.full((T, D), np.nan, dtype=np.float64); vols = np.full((T, D), np.nan)
    highs = np.full((T, D), np.nan, dtype=np.float32); lows = np.full((T, D), np.nan, dtype=np.float32)
    for j, g in enumerate(cols):
        for t, b in g.items():
            i = tick[M.norm(t)]
            if b[3]: closes[i, j] = b[3]
            if b[4]: vols[i, j] = b[4]
            if b[1] is not None and b[2] is not None and b[3] and (b[4] or 0) > 0:
                highs[i, j] = b[1]; lows[i, j] = b[2]
    tickers = [None] * T
    for t, i in tick.items(): tickers[i] = t
    # split adjustment to today's basis: price before an execution date / ratio, volume x ratio
    spl = M.Splits(); pos = {d: j for j, d in enumerate(sessions)}
    import bisect
    for t, evs in spl.by.items():
        i = tick.get(t)
        if i is None: continue
        for ex, r in evs:
            j = bisect.bisect_left(sessions, ex)       # first session on/after the execution date
            if j <= 0 or j > D: continue
            closes[i, :j] /= r; vols[i, :j] *= r; highs[i, :j] /= r; lows[i, :j] /= r
    # dividend basis: the V2 pipeline's canonical table (ratio r = 1 - cash / prior raw close),
    # applied to every close before the ex-session, so the moving averages and 52-week levels
    # are on the same economic basis production measures on
    div = json.load(open(DIV_TABLE))["applied"]
    nd = 0
    for t, evs in div.items():
        i = tick.get(M.norm(t))
        if i is None: continue
        for sess, r in evs:
            j = bisect.bisect_left(sessions, sess)
            if j <= 0 or j > D or not (0 < r <= 1): continue
            closes[i, :j] *= r; nd += 1
    print("dividend events applied", nd, flush=True)
    return {"dates": sessions, "date_pos": pos, "closes": closes, "vols": vols,
            "highs": highs, "lows": lows, "tick": tick}, tickers

W52, W20 = 251, 19
def intraday_nhnl(frame, j, mem):
    """New 52-week / 20-day highs and lows on the INTRADAY basis (breadth_nhnl_intraday's rule):
    the session's high above the prior window's highest high (low below the lowest low), a name
    counted when it traded at least once in that window; split-adjusted, not dividend-adjusted."""
    idx = np.array([frame["tick"][t] for t in mem if t in frame["tick"]], dtype=np.int64)
    H, L = frame["highs"], frame["lows"]
    h, l = H[idx, j], L[idx, j]
    have = ~np.isnan(h)
    out = {}
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        for w, tag in ((W52, "52w"), (W20, "20d")):
            a = max(0, j - w)
            mx = np.nanmax(H[idx, a:j], axis=1); mn = np.nanmin(L[idx, a:j], axis=1)
            ok = have & ~np.isnan(mx)
            out[f"new_{tag}_highs"] = int((ok & (h > mx)).sum())
            out[f"new_{tag}_lows"] = int((ok & (l < mn)).sum())
    return out

if __name__ == "__main__":
    lo, hi = sys.argv[1], sys.argv[2]
    ss = M.sessions()
    i0 = max(0, next(i for i, d in enumerate(ss) if d >= lo) - 330)
    span = [d for d in ss[i0:] if d <= hi]
    t0 = time.time()
    frame, tickers = build_frame(span)
    print("frame", len(tickers), "x", len(span), "secs", round(time.time() - t0), flush=True)
    ref, spl, sh = M.Ref(), M.Splits(), M.Shares()
    ledger = os.environ.get("LEDGER")          # validation: the REAL lists instead of the rebuilt ones
    L = json.load(open(ledger))["dates"] if ledger else None
    os.makedirs(f"{ROOT}/out", exist_ok=True)
    out = open(f"{ROOT}/out/rows_{lo}_{hi}{'_ledger' if L else ''}.jsonl", "w")
    n = 0
    for k, d in enumerate(span):
        if d < lo: continue
        prev = span[k - 1]
        if L is not None:
            if d not in L: continue
            mem = {M.norm(t) for t in L[d]["tickers"]}
        else:
            mem = M.members(d, prev, ref, spl, sh)
        r = recon.recompute_from_frame(frame, tickers, d, members=mem)
        if r.get("ok"):
            m = r["metrics"]
            for k in ("new_52w_highs", "new_52w_lows", "new_20d_highs", "new_20d_lows"):
                m[k + "_close"] = m.get(k)
            m.update(intraday_nhnl(frame, frame["date_pos"][d], mem))
        row = {"date": d, "members": len(mem), "ok": r.get("ok"), "reason": r.get("reason"),
               "metrics": r.get("metrics")}
        out.write(json.dumps(row) + "\n"); n += 1
        if n % 100 == 0: print("sessions", n, "at", d, "secs", round(time.time() - t0), flush=True)
    out.close()
    print("DONE", n, "secs", round(time.time() - t0), flush=True)
