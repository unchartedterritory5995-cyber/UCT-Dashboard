"""INDEPENDENT ORACLE for the V2c2 corrected specification.

Independent of `breadth_corrected_pass` and every module it changed: nothing here imports
breadth_ticker / breadth_calendar / breadth_adjusted_guard / breadth_identity /
breadth_grouped_history / breadth_wick_recon / breadth_live. Shared are INPUTS only (vintage
grouped files, minute files, split ledger, PIT UCT ledger, identity ledger + change points,
reference map for PIT membership) and the metric arithmetic of oracle.py (already proven
cell-exact against V2c).

Spec implemented here from the correction's documentation:
  canonical ticker  '-' → '.'
  session window    NYSE rules (calendar_geometry.nyse_holidays/early_closes), 09:30..close−1,
                    per universe = minutes in which a member printed
  guard             withhold name if a non-REAL boundary E has frame_first < E ≤ D
                    (boundaries from guard_oracle.py — itself independent)
  identity          ledger rules PIT_MATCH / EVENT_COVER / REORG / HANDOVER / CHANGEPOINT /
                    LATEST_LINEAGE / EXCLUDED re-implemented below
  EMA               pandas adjust=False
  ratios            Σup/Σdn over today + N−1 prior sessions of THIS oracle's own closes
"""
from __future__ import annotations

import bisect
import collections
import json
import math
import os

import numpy as np
import pandas as pd

import oracle as O
from calendar_geometry import early_closes, nyse_holidays

G = "/data/grouped_closes_v20260923"
IN = "/data/_audit/v2cc/inputs"
canon = lambda t: t.replace("-", ".")
CAL = sorted(f[:-7] for f in os.listdir(G) if f.endswith("_1.json"))
_F = {}


def gfile(iso, adj):
    k = (iso, adj)
    if k not in _F:
        try:
            d = json.load(open("%s/%s_%d.json" % (G, iso, 1 if adj else 0)))
        except OSError:
            d = {}
        _F[k] = {canon(t): float(v) for t, v in d.items() if isinstance(v, (int, float)) and v > 0}
        if len(_F) > 1000:
            for kk in list(_F)[:300]:
                _F.pop(kk)
    return _F[k]


def last_bar(iso):
    import datetime as dt
    d = dt.date.fromisoformat(iso)
    if d in nyse_holidays(d.year) or d.weekday() >= 5:
        return None
    return 12 * 60 + 59 if d in early_closes(d.year) else 15 * 60 + 59


# ── identity (re-implemented from the documented rule) ────────────────────────
def identity_allowed_fn():
    L = json.load(open(IN + "/uct_identity_ledger.json"))["identity"]
    CP = json.load(open(IN + "/uct_identity_changepoints.json"))["changepoints"]

    def cont(t, E, lst, s0):
        i = bisect.bisect_left(CAL, E)
        p = CAL[i - 1] if i > 0 else None
        r1, r0 = gfile(E, False).get(t), gfile(p, False).get(t) if p else None
        return bool(r0 and r1) and abs(math.log(r1 / r0)) < math.log(1.25) and bool(lst) and lst <= s0

    table = {}
    for t, v in L.items():
        cur = v.get("current") or {}
        ev = sorted((e["date"], (e.get("ticker_change") or {}).get("ticker"))
                    for e in ((v.get("events") or {}).get("events") or []) if e.get("type") == "ticker_change")
        iv = [(d, ev[i + 1][0] if i + 1 < len(ev) else "9999") for i, (d, tk) in enumerate(ev) if tk == t]
        rows = []
        for s0, s1 in v.get("segments") or []:
            a = (v.get("asof_at_segment_start") or {}).get(s0)
            same = bool(a) and ((cur.get("cik") and a.get("cik") == cur.get("cik")) or
                                (cur.get("composite_figi") and a.get("composite_figi") == cur.get("composite_figi")))
            contra = bool(a) and not same and bool(a.get("cik") or a.get("composite_figi"))
            ins = sorted(b for b, _ in iv if s0 < b <= s1)
            cp = ((CP.get(t) or {}).get(s0) or {}).get("changepoint")
            if same or any(b <= s0 < e for b, e in iv):
                frm = s0
            elif ins:
                frm = s0 if cont(t, ins[0], cur.get("list_date"), s0) else ins[0]
            elif cp:
                frm = s0 if cont(t, cp, cur.get("list_date"), s0) else cp
            elif s1 >= "2026-09-11" and not contra and cur.get("list_date"):
                frm = max(s0, cur["list_date"])
            else:
                frm = None
            rows.append((s0, s1, frm))
        table[canon(t)] = rows

    def allowed(t, d):
        for s0, s1, frm in table.get(t, ()):
            if s0 <= d <= s1:
                return frm is not None and d >= frm
        return False
    return allowed


class Oracle2:
    def __init__(self):
        from api.services import breadth_pit_frame as bpf          # membership definition
        from api.services import breadth_universes as bu
        self.bpf, self.bu = bpf, bu
        self.ref = bpf.reference_map()
        self.pit = json.load(open(IN + "/pit_uct_ledger.json"))
        self.pinned = [canon(t) for t in json.load(open(IN + "/uct_identity_ledger.json"))["identity"]]
        self.allowed = identity_allowed_fn()
        gb = json.load(open("/data/_audit/validation/v2c_final/out/guard_oracle_boundaries.json"))
        self.bound = {t: sorted(v) for t, v in gb.items()}
        self.closes = {}                                  # (u, date) -> {metric: c}
        self.s3 = O.s3()

    def withheld(self, t, f0, d):
        xs = self.bound.get(t)
        if not xs:
            return False
        j = bisect.bisect_right(xs, f0)
        return j < len(xs) and xs[j] <= d

    def members(self, D, traded):
        out = {}
        e = self.pit["dates"].get(D) if D >= self.pit["live_from"] else None
        if e:
            out["uct"] = sorted({canon(t) for t in e["tickers"]} & traded)
        out["uct_backtest"] = sorted(t for t in self.pinned if t in traded and self.allowed(t, D))
        for u in ("us", "nasdaq", "nyse"):
            if D >= ("2008-01-02" if u == "us" else "2011-01-03"):
                out[u] = []
        for t in traded:
            rec = self.bpf.resolve(self.ref.get(t), D)
            if rec is None or rec.get("type") not in self.bpf.COMMON_TYPES:
                continue
            ex = (rec.get("primary_exchange") or "").upper()
            for u in ("us", "nasdaq", "nyse"):
                if u in out and ex and ex in self.bu.venues(u):
                    out[u].append(t)
        return out

    def levels(self, names, D):
        i = bisect.bisect_left(CAL, D)
        dates = CAL[max(0, i - 380):i]
        C = np.ascontiguousarray(np.array([[gfile(d, True).get(t, np.nan) for t in names] for d in dates]).T)
        wh = np.array([self.withheld(t, dates[0], D) for t in names])
        C[wh, :] = np.nan
        L = {"prev": C[:, -1]}
        for w in O.SMA:
            tail = C[:, -(w - 1):]
            L["ok%d" % w] = ~np.isnan(tail).any(axis=1)
            L["sum%d" % w] = np.nansum(tail, axis=1)
        L["ema"] = pd.DataFrame(C.T).ewm(alpha=2.0 / 21, adjust=False, ignore_na=False).mean().iloc[-1].to_numpy()
        for b in (1, 5, 21, 34, 65):
            L["back%d" % b] = C[:, -b]
        for nm, w in (("52", 251), ("20", 19)):
            tail = C[:, -w:]
            ok = ~np.isnan(tail).any(axis=1)
            L["max" + nm] = np.where(ok, np.max(np.where(np.isnan(tail), -np.inf, tail), axis=1), np.nan)
            L["min" + nm] = np.where(ok, np.min(np.where(np.isnan(tail), np.inf, tail), axis=1), np.nan)
            L["ok" + nm] = ok
        win = C[:, -220:-20]
        L["s200b21"] = np.where(~np.isnan(win).any(axis=1), win.sum(axis=1) / 200.0, np.nan)
        comp = np.zeros(len(names), bool)
        for k in ("ok52", "ok20") + tuple("ok%d" % w for w in O.SMA):
            comp |= L[k]
        comp |= np.isfinite(L["prev"]) & (L["prev"] > 0)
        comp |= np.isfinite(L["ema"]) & (L["ema"] > 0)
        L["comparable"] = comp
        return L, wh, dates[0]

    def prior(self, u, D):
        i = bisect.bisect_left(CAL, D)
        prev = CAL[max(0, i - 9):i]
        out = {}
        for n in (5, 10):
            w = prev[-(n - 1):] if len(prev) >= n - 1 else None
            if not w or any((u, d) not in self.closes for d in w):
                continue
            out[n] = (sum(self.closes[(u, d)]["up_4pct_today"] for d in w),
                      sum(self.closes[(u, d)]["down_4pct_today"] for d in w))
        return out

    def day(self, D, universes):
        lb = last_bar(D)
        if lb is None:
            return None
        df = O.load_minutes(D, self.s3)
        traded = set(df["ticker"].unique())
        mem = self.members(D, traded)
        union = sorted({t for u in universes for t in mem.get(u, [])})
        L, wh, f0 = self.levels(union, D)
        idx = {t: i for i, t in enumerate(union)}
        adj, raw = gfile(D, True), gfile(D, False)
        fac = {t: adj[t] / raw[t] for t in union if t in adj and t in raw and not wh[idx[t]]}
        res = {}
        for u in universes:
            names = mem.get(u)
            if not names:
                continue
            rows = np.array([idx[t] for t in names])
            dfu = df[df["ticker"].isin(set(names)) & (df["m"] >= 570) & (df["m"] <= lb)]
            mins = sorted(int(m) for m in dfu["m"].unique())
            col = {m: j for j, m in enumerate(mins)}
            rel = {t: k for k, t in enumerate(names)}
            R = np.full((len(names), len(mins)), np.nan)
            R[dfu["ticker"].map(rel).to_numpy(), dfu["m"].map(col).to_numpy()] = dfu["close"].to_numpy()
            Lu = {k: (v[rows] if isinstance(v, np.ndarray) and v.shape[:1] == (len(union),) else v) for k, v in L.items()}
            f = np.array([fac.get(t, np.nan) for t in names])
            nofac, cmp_ = np.isnan(f), Lu["comparable"]
            S = np.where(np.isfinite(Lu["prev"]) & (Lu["prev"] > 0), Lu["prev"], np.nan)
            Q = np.where(np.isfinite(R), R * np.where(nofac, 1.0, f)[:, None], np.nan)
            P = pd.DataFrame(np.concatenate([S[:, None], Q], axis=1)).ffill(axis=1).to_numpy()[:, 1:].copy()
            for k in np.where(nofac & cmp_)[0]:
                pr = np.where(np.isfinite(R[k]))[0]
                stop = pr[0] if len(pr) else R.shape[1]
                P[k, :] = np.nan
                P[k, :stop] = S[k]
            path = O.metrics_matrix(Lu, P)
            cpx = np.array([adj.get(t, np.nan) if (not nofac[k] or not cmp_[k]) else np.nan for k, t in enumerate(names)])
            close = {m: v[0] for m, v in O.metrics_matrix(Lu, cpx[:, None]).items()}
            pri = self.prior(u, D)
            for key, n in (("ratio_5day", 5), ("ratio_10day", 10)):
                if n in pri:
                    su, sd = pri[n]
                    path[key] = [(round((su + a) / (sd + b), 2) if (a is not None and b is not None and sd + b > 0) else None)
                                 for a, b in zip(path["up_4pct_today"], path["down_4pct_today"])]
                    cu, cd = close.get("up_4pct_today"), close.get("down_4pct_today")
                    close[key] = round((su + cu) / (sd + cd), 2) if (cu is not None and cd is not None and sd + cd > 0) else None
            pop = np.isfinite(P).sum(axis=0)
            pjf = (np.abs(np.diff(pop)).max() / max(pop.max(), 1)) if len(pop) > 1 else 0.0
            out = {}
            for m, ser in path.items():
                vals = [v for v in ser if v is not None]
                c = close.get(m)
                if not vals or c is None:
                    continue
                o, h, l = vals[0], max(vals), min(vals)
                h, l = max(h, o, c), min(l, o, c)
                mj, t3 = O.path_quality(ser, pjf)
                rng = h - l
                body = (pjf > O.RULE["pop_jump_frac"]) or (rng > 0 and mj / rng > O.RULE["max_jump_frac"] and mj >= O.RULE["min_abs_jump"]) \
                    or (rng > 0 and t3 / rng > O.RULE["top3_jump_frac"] and rng >= O.RULE["min_range"])
                out[m] = ({"o": round(c, 4), "h": round(c, 4), "l": round(c, 4), "c": round(c, 4), "src": "body"} if body
                          else {"o": round(o, 4), "h": round(h, 4), "l": round(l, 4), "c": round(c, 4), "src": "path"})
            self.closes[(u, D)] = {m: close.get(m) for m in ("up_4pct_today", "down_4pct_today")}
            out["_meta"] = {"members": len(names), "withheld": int(wh[rows].sum()), "buckets": len(mins),
                            "dual_class": sum(1 for t in names if "." in t)}
            res[u] = out
        return res
