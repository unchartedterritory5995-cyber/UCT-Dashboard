"""PHASE 6 — the EMA definition and what changing it does to LIVE breadth.

Canonical (the collector's pandas definition, now `breadth_live._ewm_last`):
    y_0 = x_0 at the first observation; per later session j:
      w ← w·(1−α)                      (every session, observed or not)
      if x_j observed:  y ← (w·y + α·x_j)/(w + α);  w ← 1
    α = 2/21.   Old production kept w ← w + α (pandas' adjust=True rule) after an
    observation, identical only on a gap-free series.

Measured on the LIVE path's own frame source (bars.db on this volume, read-only) for the
UCT population at the last completed session in it, and on every session of a 60-session
window, the close pct_above_20ema under both recursions.
"""
import json, os, sqlite3, sys
import numpy as np
from api.services import breadth_live as bl

A = bl._EMA20_ALPHA
def old_ewm(arr, alpha):
    n, m = arr.shape; out = np.full(n, np.nan); w = np.ones(n)
    for j in range(m):
        col = arr[:, j]; ok = ~np.isnan(col); seed = ok & np.isnan(out)
        out[seed] = col[seed]; w[seed] = 1.0
        step = ~np.isnan(out) & ~seed; w[step] *= (1 - alpha)
        upd = step & ok
        out[upd] = (w[upd] * out[upd] + alpha * col[upd]) / (w[upd] + alpha); w[upd] += alpha
    return out

conn = sqlite3.connect("file:/data/bars.db?mode=ro&immutable=1", uri=True)
bl._bars_conn = lambda: conn
pin = json.load(open("/data/_audit/validation/pinned_uct_universe.json"))["tickers"]
last = conn.execute("SELECT MAX(ts) FROM ohlcv WHERE tf='D' AND ticker='SPY'").fetchone()[0]
sessions = [r[0] for r in conn.execute("SELECT ts FROM ohlcv WHERE tf='D' AND ticker='SPY' AND ts<=? ORDER BY ts DESC LIMIT 61", (last,))][::-1]
dates_all = [r[0] for r in conn.execute("SELECT ts FROM ohlcv WHERE tf='D' AND ticker='SPY' AND ts<=? ORDER BY ts DESC LIMIT 450", (last,))][::-1]
closes, vols = bl._load_frame(conn, pin, dates_all)
res = []
for k in range(1, len(sessions)):
    D = sessions[k]
    j = dates_all.index(D)
    frame = closes[:, max(0, j - 380):j]                   # completed sessions before D
    px = closes[:, j]
    have = np.isfinite(px) & (px > 0)
    e_new = bl._ewm_last(frame, A); e_old = old_ewm(frame, A)
    def pct(e):
        v = have & np.isfinite(e)
        return round(float(((px > e) & v).sum() / v.sum() * 100), 1) if v.sum() else None
    first = np.argmax(~np.isnan(frame), axis=1)
    gaps = np.array([np.isnan(frame[i, first[i]:]).any() for i in range(frame.shape[0])])
    flips = int((have & np.isfinite(e_new) & np.isfinite(e_old) & ((px > e_new) != (px > e_old))).sum())
    res.append({"session": D, "pct_new": pct(e_new), "pct_old": pct(e_old),
                "delta": None if pct(e_new) is None else round(pct(e_new) - pct(e_old), 2),
                "names_with_gap_after_first_obs": int((gaps & have).sum()), "names_priced": int(have.sum()),
                "classification_flips": flips,
                "max_rel_ema_diff": float(np.nanmax(np.abs(e_new - e_old) / np.abs(e_old)))})
d = [r["delta"] for r in res if r["delta"] is not None]
out = {"frame_source": "bars.db (runner volume, read-only)", "population": "pinned UCT 2,689",
       "sessions": len(res), "last_session": sessions[-1],
       "pct_above_20ema_delta": {"mean": round(float(np.mean(d)), 3), "max_abs": round(float(np.max(np.abs(d))), 2),
                                 "sessions_nonzero": sum(1 for x in d if x != 0)},
       "per_session": res}
json.dump(out, open("/data/_audit/v2cc/ema_impact.json", "w"), indent=1)
print(json.dumps({k: v for k, v in out.items() if k != "per_session"}, indent=1))
for r in res[-6:]: print(r)
