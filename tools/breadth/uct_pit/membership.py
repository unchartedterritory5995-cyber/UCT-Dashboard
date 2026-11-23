"""UCT PIT rebuild, stage 3/4: the UCT list for each session from the live rule, using only
the previous session's bar, and its grade against the real lists (ledger). Value-free output.
Rule (collector): CS/ADRC; D-1 close >= $2; D-1 volume >= 200k; market cap >= $300M; trades on D."""
import bisect, gzip, json, os, sys, time
from collections import defaultdict, Counter
ROOT = "/data/_audit/uct_pit"
PRICE_MIN, VOL_MIN, CAP_MIN = 2.0, 200_000, 300e6
BACKFILL_DAYS = int(os.environ.get("BACKFILL_DAYS", "400"))

def norm(t): return t.replace("-", ".").replace("/", ".").upper()

def load(p): return json.load(gzip.open(p, "rt"))

import re
_NOT_COMMON = re.compile(r"\b(warrants?|wts?|wt|units?|rights?|rts?|preferred|prf|pref|pfd|cum|cumulative|"
                         r"perpetual|notes?|nts|debentures?|bonds?|secs|ctfs|certificates?|fund|fd|fds|etf|etfs|etn|"
                         r"etns|index|portfolio|port|ishares|proshares|spdr|powershares|direxion|invesco db|"
                         r"exchange[- ]traded|when[- ]issued|subordinated|senior|trust units|subscription|"
                         r"capital trust|fing tr|tr pfd|fixed[- ]to[- ]floating|series [a-z]\b.*(pfd|preferred|notes?))\b|%", re.I)
_ADR = re.compile(r"\b(american depositary|ads|adr|adrs|sponsored adr)\b", re.I)

def infer_type(name, ticker):
    """A delisted record with no provider type: classified from its name. Anything that reads like a
    warrant, unit, preferred, note or fund is NOT common; an ADR name is ADRC; else common stock.
    `None` stays unknown (no name at all)."""
    if not name: return None
    if _NOT_COMMON.search(name): return "OTHER"
    if _ADR.search(name): return "ADRC"
    return "CS"

class Ref:
    def __init__(self):
        self.by = defaultdict(list)
        for f, active in (("ref_active", True), ("ref_inactive", False)):
            for r in load(f"{ROOT}/{f}.json.gz"):
                if r.get("market") not in (None, "stocks"): continue
                dl = (r.get("delisted_utc") or "")[:10] or ("9999-12-31" if active else None)
                if dl is None: continue
                typ = r.get("type")
                if not typ:
                    g = infer_type(r.get("name") or "", r["ticker"])
                    typ = (g + "~") if g in ("CS", "ADRC") else g   # "~": inferred from the name
                self.by[norm(r["ticker"])].append((dl, (r.get("list_date") or "")[:10], typ, (r.get("cik") or "").lstrip("0")))
        for v in self.by.values(): v.sort()
    def at(self, t, d):
        """The record listed at d: the earliest delisting on or after d, listed by d."""
        for dl, ld, typ, cik in self.by.get(t, ()):
            if dl >= d and (not ld or ld <= d):
                return typ, cik
        return None

class Splits:
    def __init__(self):
        self.by = defaultdict(list)
        for s in load(f"{ROOT}/splits.json.gz"):
            try: r = float(s["split_to"]) / float(s["split_from"])
            except Exception: continue
            if r > 0: self.by[norm(s["ticker"])].append((s["execution_date"], r))
        for v in self.by.values(): v.sort()
    def factor(self, t, a, b):
        """Shares as of `a` restated to the basis of `b` (a < b: splits executed in (a, b])."""
        f = 1.0
        lo, hi, inv = (a, b, False) if a <= b else (b, a, True)
        for ex, r in self.by.get(t, ()):
            if lo < ex <= hi: f *= r
        return 1.0 / f if inv else f

class Shares:
    """Per CIK, one series per source family: OUT (cover / balance-sheet outstanding) and AVG
    (weighted-average basic, US GAAP or IFRS). The count used at d is the LARGER of the two
    families' latest as-of values: a two-class issuer often reports one class's outstanding count
    without a class tag, while its weighted average covers every class; for a single-class issuer
    the two are within a few percent, which a $300M cutoff does not notice."""
    def __init__(self):
        raw = load(f"{ROOT}/shares.json.gz")
        # cover-page counts from filings before an issuer's XBRL facts (stage 2b), when present
        for fn in os.environ.get("TEXT_SHARES", "text_shares_clean.json.gz,text_shares_b_clean.json.gz").split(","):
            tp = f"{ROOT}/{fn}"
            if not os.path.exists(tp) or os.environ.get("NO_TEXT_SHARES"): continue
            for cik, obs in load(tp).items():
                raw.setdefault(str(cik).lstrip("0"), []).extend(obs)
        self.by = {}
        for cik, obs in raw.items():
            fam = {"out": {}, "avg": {}}
            for end, filed, v, src in obs:
                f = "out" if src in ("cover", "bs", "text") else "avg"
                cur = fam[f].get(end)
                if cur is None or (src == "cover") or v > cur:
                    fam[f][end] = v
            self.by[cik] = {k: (sorted(d), [d[e] for e in sorted(d)]) for k, d in fam.items() if d}
    def _one(self, series, d):
        ends, vals = series
        i = bisect.bisect_right(ends, d) - 1
        from datetime import date
        if i >= 0:
            if (date.fromisoformat(d) - date.fromisoformat(ends[i])).days <= 500:
                return ends[i], vals[i], "asof"
            return None
        f = ends[0]
        if (date.fromisoformat(f) - date.fromisoformat(d)).days <= BACKFILL_DAYS: return f, vals[0], "backfill"
        return None
    def at(self, cik, d):
        e = self.by.get(cik)
        if not e: return None
        got = [x for x in (self._one(s, d) for s in e.values()) if x]
        if not got: return None
        return max(got, key=lambda x: x[1])

def sessions():
    return sorted(f[:10] for f in os.listdir(f"{ROOT}/grouped") if f.endswith(".json.gz"))

def bars(d, _c={}):
    if d not in _c:
        if len(_c) > 4: _c.pop(next(iter(_c)))
        _c[d] = {norm(k): v for k, v in load(f"{ROOT}/grouped/{d}.json.gz").items()}
    return _c[d]

def members(d, prev, ref, spl, sh, why=None):
    """The rebuilt list for session d (bars of `prev` only). A ticker whose type was INFERRED from
    its name ("CS~") is kept only when no provider-typed ticker of the same company (CIK) qualifies
    that day, and then only the most traded one: a preferred, note or trust certificate of a
    company carries the company's CIK and would otherwise borrow its share count."""
    pb, db = bars(prev), bars(d)
    keep, inferred = set(), {}
    typed_ciks = set()
    for t, b in pb.items():
        def no(r):
            if why is not None: why[t] = r
        c, v = b[3], b[4]
        if c is None or c < PRICE_MIN: no("price"); continue
        if v is None or v < VOL_MIN: no("volume"); continue
        if t not in db: no("not_traded_D"); continue
        rec = ref.at(t, prev)
        if rec is None: no("no_reference"); continue
        typ, cik = rec
        if typ not in ("CS", "ADRC", "CS~", "ADRC~"): no(f"type_{typ}"); continue
        if not cik: no("no_cik"); continue
        s = sh.at(cik, prev)
        if s is None: no("no_shares"); continue
        end, val, how = s
        cap = c * val * spl.factor(t, end, prev)
        if cap < CAP_MIN: no("cap_below"); continue
        if typ.endswith("~"):
            inferred.setdefault(cik, []).append((c * v, t))
        else:
            keep.add(t); typed_ciks.add(cik)
    for cik, cands in inferred.items():
        if cik in typed_ciks:
            for _dv, t in cands:
                if why is not None: why[t] = "inferred_dup"
            continue
        cands.sort(reverse=True)
        keep.add(cands[0][1])
        for _dv, t in cands[1:]:
            if why is not None: why[t] = "inferred_dup"
    return keep

def grade(ledger_path, dates=None):
    L = json.load(open(ledger_path))["dates"]
    ref, spl, sh = Ref(), Splits(), Shares()
    ss = sessions()
    rows = []
    miss_r, extra_r = Counter(), Counter()
    for d in sorted(L):
        if dates and d not in dates: continue
        if d not in ss: continue
        i = ss.index(d)
        why = {}
        pred = members(d, ss[i - 1], ref, spl, sh, why)
        true = {norm(t) for t in L[d]["tickers"]}
        inter = len(pred & true)
        j = inter / max(1, len(pred | true))
        for t in true - pred: miss_r[why.get(t, "not_in_prev_bars")] += 1
        for t in pred - true: extra_r["extra"] += 1
        rows.append((d, len(true), len(pred), round(j, 4)))
    js = sorted(r[3] for r in rows)
    print("sessions", len(rows), "jaccard median", js[len(js)//2] if js else None, "min", js[0] if js else None, "p10", js[len(js)//10] if js else None)
    tot = sum(miss_r.values()) or 1
    print("missed reasons (share of all misses):", {k: round(v / tot, 3) for k, v in miss_r.most_common(12)})
    print("avg true", round(sum(r[1] for r in rows)/max(1,len(rows))), "avg pred", round(sum(r[2] for r in rows)/max(1,len(rows))), "avg missed/day", round(sum(miss_r.values())/max(1,len(rows)),1), "avg extra/day", round(extra_r['extra']/max(1,len(rows)),1))
    return rows

if __name__ == "__main__":
    grade(sys.argv[1])
