"""INDEPENDENT ORACLE v3 = oracle v2 + its OWN dividend-adjusted basis (F4).

Independence: no import of breadth_dividend_basis (or any module the correction changed).
The dividend events are rebuilt here from the provider ledger by the documented rule:
  r_e = 1 − Σ_type cash_e / RAW_close(last session before e, within 5), ex mapped to the
  next session ≥ e; applied to frame columns strictly before sess(e) when
  frame_first < sess(e) ≤ frame_last. Several distinct amounts on one ex-date are separate
  distributions and ADD; unprovable events (non-USD / missing currency, one amount twice under
  one symbol, same-type amounts < 2 % apart, no prior close, r ≤ 0.5) withhold the name while
  a frame contains them. Concatenated share-class spellings (BFB) resolve to the traded one.
Inputs are the one-vintage acquisition `inputs_<TAG>` / `grouped_closes_<TAG>`.
"""
import bisect, collections, json, math, os
import numpy as np
import oracle2

TAG = os.environ.get("V2C2_TAG", "v20260923b")
oracle2.G = "/data/grouped_closes_" + TAG
oracle2.IN = "/data/_audit/v2cc/inputs_" + TAG
oracle2.CAL = sorted(f[:-7] for f in os.listdir(oracle2.G) if f.endswith("_1.json"))
oracle2._F.clear()
CAL = oracle2.CAL


def _usd_rate(fxr, cur, iso):
    # own implementation: ECB publishes CUR per EUR; USD per CUR = (USD/EUR)/(CUR/EUR), latest
    # ECB day <= iso, both observations no older than 5 calendar days
    import datetime
    floor = (datetime.date.fromisoformat(iso) - datetime.timedelta(days=5)).isoformat()

    def at(c):
        obs = fxr.get(c) or {}
        ok = [d for d in obs if floor <= d <= iso]
        return obs[max(ok)] if ok else None
    u = at("USD")
    c = 1.0 if cur == "EUR" else at(cur)
    return (u / c) if (u and c) else None


def build_dividends(ref=None):
    led = json.load(open(oracle2.IN + "/dividends_ledger.json"))
    fxr = json.load(open(oracle2.IN + "/fx_ledger.json"))["rates"]
    from api.services import breadth_pit_frame as bpf
    kind = lambda t, iso: (bpf.resolve((ref or {}).get(t), iso) or {}).get("type")
    last = led["ex_date_lte"]
    grp = collections.defaultdict(list)
    app, wh = collections.defaultdict(list), collections.defaultdict(list)
    memo = {}
    # v4: the split ledger, keyed by price key (ledger spelling + dotted share-class reading)
    sx = collections.defaultdict(list)
    for sp in json.load(open(oracle2.IN + "/splits_ledger.json"))["splits"]:
        try:
            kk = float(sp["split_to"]) / float(sp["split_from"])
        except Exception:
            continue
        b = oracle2.canon(sp["ticker"])
        for n in set([b] + ([b[:-1] + "." + b[-1]] if "." not in b and len(b) >= 2 else [])):
            sx[n].append((sp.get("execution_date") or "", kk))

    def spelled(t, ex):
        # the dividend ledger concatenates share classes (BFB); prices dot them (BF.B)
        if "." in t or len(t) < 2:
            return t
        if (t, ex) not in memo:
            j = bisect.bisect_left(CAL, ex)
            before = CAL[max(0, j - 5):j] if j < len(CAL) else []
            dotted = t[:-1] + "." + t[-1]
            a = any(t in oracle2.gfile(x, False) for x in before)
            b = any(dotted in oracle2.gfile(x, False) for x in before)
            memo[(t, ex)] = ("AMBIGUOUS", t, dotted, CAL[j]) if (a and b) else (dotted if b else t)
        return memo[(t, ex)]

    for d in led["dividends"]:
        if d.get("ticker") and d.get("ex_dividend_date") and d.get("cash_amount") is not None \
                and d["ex_dividend_date"] <= last:
            orig = oracle2.canon(d["ticker"])
            nm = spelled(orig, d["ex_dividend_date"])
            if isinstance(nm, tuple):
                for x in nm[1:3]:
                    wh[x].append(nm[3])
                continue
            grp[(nm, d["ex_dividend_date"])].append((orig, d))
    for (t, ex), recs in sorted(grp.items(), key=lambda kv: kv[0][1]):
        j = bisect.bisect_left(CAL, ex)
        if j >= len(CAL):
            continue
        s = CAL[j]
        curs = {(r.get("currency") or "").upper() for _o, r in recs}
        if len(curs) != 1 or "" in curs:
            wh[t].append(s); continue
        cu = curs.pop()
        if cu != "USD" and kind(t, s) != "CS":            # foreign cash on an ADR / other: unprovable
            wh[t].append(s); continue
        seen = collections.Counter()
        bt = collections.defaultdict(set)
        for o, r in recs:
            c = round(float(r["cash_amount"]), 10)
            if c > 0:
                seen[(o, r.get("dividend_type") or "?", c)] += 1
                bt[r.get("dividend_type") or "?"].add(c)
        if not bt:
            continue
        if max(seen.values()) > 1:                       # same amount twice under one symbol
            wh[t].append(s); continue
        near = False
        for v in bt.values():
            xs = sorted(v)
            near |= any((xs[i + 1] - xs[i]) / xs[i + 1] < 0.02 for i in range(len(xs) - 1))
        if near:                                         # restatement signature
            wh[t].append(s); continue
        cash = sum(x for v in bt.values() for x in v)    # distinct distributions add
        pk = next((k for k in range(j - 1, max(-1, j - 6), -1) if oracle2.gfile(CAL[k], False).get(t)), None)
        prev = oracle2.gfile(CAL[pk], False).get(t) if pk is not None else None
        if prev and cu != "USD":
            fxv = _usd_rate(fxr, cu, CAL[pk])
            if fxv is None:
                wh[t].append(s); continue
            cash = cash * fxv
        if not prev or 1 - cash / prev <= 0.5:
            wh[t].append(s); continue
        ratio = 1 - cash / prev
        a0, a1, r1 = oracle2.gfile(CAL[pk], True).get(t), oracle2.gfile(s, True).get(t), oracle2.gfile(s, False).get(t)
        if a0 and a1 and r1:
            step = math.log(a1 / r1) - math.log(a0 / prev)
            if abs(step) > 0.001 and abs(a1 * prev / a0 - r1) > 0.0101                     and abs(step + math.log(ratio)) <= abs(math.log(ratio)) / 4:
                continue                                  # the provider's series already carries it
        big = [kk for e, kk in sx.get(t, ()) if CAL[pk] < e <= s and kk > 0]
        if big and (1 - ratio) * abs(1 - 1 / math.prod(big)) > 0.001:
            wh[t].append(s); continue                     # declared cash units unprovable
        app[t].append((s, ratio))
    return app, {t: sorted(set(v)) for t, v in wh.items()}


class Oracle3(oracle2.Oracle2):
    def __init__(self, dividends=True):
        super().__init__()
        self.pit = json.load(open(oracle2.IN + "/pit_uct_ledger.json"))
        self.ref = json.load(open(oracle2.IN + "/pit_reference.json"))   # the vintage's own reference
        self.div = dividends
        self.dapp, self.dwh = build_dividends(self.ref) if dividends else ({}, {})

    def withheld(self, t, f0, d):
        if super().withheld(t, f0, d):
            return True
        xs = self.dwh.get(t)
        if not xs:
            return False
        j = bisect.bisect_right(xs, f0)
        return j < len(xs) and xs[j] < d

    def levels(self, names, D):
        L, wh, f0 = super().levels(names, D)
        return L, wh, f0

    def _frame(self, names, D):
        i = bisect.bisect_left(CAL, D)
        return CAL[max(0, i - 380):i]


# the dividend factor is applied inside the frame build: override oracle2.Oracle2.levels'
# matrix construction by wrapping gfile-based C with the factor, keeping everything else.
_orig_levels = oracle2.Oracle2.levels


def _levels_with_dividends(self, names, D):
    if not getattr(self, "div", False):
        return _orig_levels(self, names, D)
    import pandas as pd
    i = bisect.bisect_left(CAL, D)
    dates = CAL[max(0, i - 380):i]
    C = np.ascontiguousarray(np.array([[oracle2.gfile(d, True).get(t, np.nan) for t in names] for d in dates]).T)
    pos = {d: k for k, d in enumerate(dates)}
    for r, t in enumerate(names):
        for s, ratio in self.dapp.get(t, ()):
            if dates and dates[0] < s <= dates[-1]:
                C[r, :pos[s]] *= ratio
    wh = np.array([self.withheld(t, dates[0], D) for t in names])
    C[wh, :] = np.nan
    O = oracle2.O
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


Oracle3.levels = _levels_with_dividends
