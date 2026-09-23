"""CANONICAL DIVIDEND-ADJUSTED PRICE BASIS for historical breadth levels (V2c2, F4).

⭐⭐ WHAT "DIVIDEND-ADJUSTED" MEANS HERE — the collector's economic basis, restated so that
it is REPRODUCIBLE from recorded inputs instead of borrowed from a mutable third-party
response (yfinance `auto_adjust=True`):

  inputs  S(t,d)  provider grouped ADJUSTED close — split-adjusted to the input vintage
          R(t,d)  provider grouped RAW close — as traded on d
          cash_e  provider `cash_amount` for ex-date e, as DECLARED (per share, on the share
                  count of its own date, i.e. the same units as R(t, e−1))
  ratio   r_e = 1 − cash_e / R(t, prev(e))
          prev(e) = the last session strictly before e on which t has a raw close
          (dimensionless; computed in RAW units so a later split cannot distort it)
  level   A_D(t,d) = S(t,d) · Π{ e : d < sess(e) ≤ D−1 } r_e        for d in D's frame
          sess(e) = e if e is a session, else the next session ≥ e
  today   the price compared against the levels is S(t,D)·(path lift) — never adjusted

  chronology  a dividend with sess(e) = D (going ex on the measured session) is NOT applied
              to D's frame; the frame's last bar D−1 is therefore always unadjusted. This is
              the collector's EFFECTIVE semantics (yfinance has not re-based history for a
              same-day ex-date at the 4:15 collection) and live `breadth_dividends.factors`
              measured it (adv_decline 7.2 → 12.0 when same-day ex-dates were applied).
  splits      split and dividend factors are both dimensionless multipliers on S, so their
              order on a shared day is immaterial; units are kept consistent by taking the
              dividend ratio against the RAW close of the prior session.

⛔ DIFFERENCES FROM LIVE `breadth_dividends` — each is a live defect, not a methodology:
  * live divides the DECLARED cash by a SPLIT-ADJUSTED-TO-TODAY close → a dividend paid
    before a later split is over-weighted by the split factor (e.g. WMT 3:1 2024);
  * live keys dividends by (ticker, ex_date) with upsert → a regular + special on one ex-date
    keeps only one;
  * live keys `BRK.B` against a collector list spelled `BRK-B` → dual-class names are never
    adjusted;
  * live SKIPS (fails open) an event yielding > 25 % — yfinance adjusts for it.

⛔⛔ DUAL-CLASS SPELLING (v2). The provider's DIVIDEND ledger spells share classes
CONCATENATED (`BFB`, `HEIA`, `MOGA`, `LENB`, `GEFB`, `CWENA`, `UHALB`, `STZB`, `KELYA`, `WSOB`)
while its PRICE files spell them dotted (`BF.B`, `HEI.A` …) — v1 silently never adjusted a
dual-class name. A ledger ticker X (no dot) is RESOLVED against what actually traded in the
sessions before its ex-session: X traded → X; only Y = X[:-1] + "." + X[-1] traded → Y; both
traded → AMBIGUOUS and BOTH are withheld at that session (whose dividend it is cannot be
proven); neither → X (no series, no effect). Dotted and concatenated records for one resolved
name on one ex-date merge.

⭐⭐ SEVERAL DISTRIBUTIONS ON ONE EX-DATE (v3). The ledger publishes a regular + a special /
supplemental / variable dividend on one ex-date as SEPARATE records, usually both typed `CD`
(LYB $0.25 + $4.50, BAH $0.10 + $1.00, VNOM base + variable, CSWC/HTGC/ARCC supplementals).
v2 treated them as a conflict and withheld the name for a whole 380-session frame — a
systematic bias against live, not a safe failure. The economic basis (and Yahoo, measured:
80 sum vs 4 one-of in a split-adjusted common-stock sample) is the SUM. So, per resolved name
and ex-date:
  * distinct amounts are SUMMED (within and across types);
  * the same amount published once under each of two ledger spellings (WSO.B / WSOB) is one
    distribution and collapses;
  * WITHHELD (unprovable): one amount published twice under ONE spelling (duplicate or two
    equal payments — Yahoo measured 17 collapse vs 23 sum), or two distinct amounts of one
    type within RESTATEMENT_GAP of each other (a restated figure, e.g. ASR 3.358778/3.396091).

⛔⛔ A DIVIDEND THE PROVIDER ALREADY ADJUSTED FOR (v4). Scrip / stock-dividend programmes (BP
2015-2020, HSBC, AEG, PHG, BCS, TEF, NGG, SAN, BBVA, RDS.A) are published as a cash dividend AND
the provider's split-adjusted series carries the same distribution as a small split on the
ex-session (BP 2018-11-08: adj/raw 0.9548 → 0.9692 = 1/r). Applying r again counts it twice.
When the provider's factor step f = (adj/raw)_ex / (adj/raw)_prev is significant (> 0.1 % and
beyond one raw tick) and equals the dividend (|ln f + ln r| ≤ ¼|ln r|), the event is
ABSORBED_BY_PROVIDER: applied once (by the provider), not twice. Any OTHER ledger split in
(prev, ex-session] makes the declared cash's share units ambiguous; it is applied only when the
ambiguity (1 − r)·|1 − 1/K| ≤ UNIT_AMBIGUITY (CBSH's 5 % stock dividend beside a 0.6 % cash
dividend: 0.03 %), else WITHHELD.

⛔ FAIL CLOSED, NEVER GUESSED. An event is WITHHELD — the name gets no levels while a frame
straddles it, exactly like an adjusted-series defect — when: the currency is not USD; the same
currency is missing; an amount is ambiguous (above); there is no raw prior close within 5
sessions; or cash ≥ 50 % of the prior raw close (r ≤ 0.5, liquidating-size — yfinance would
apply it, but a vendor error of that size would poison a year of levels).
"""
from __future__ import annotations

import bisect
import collections
import hashlib
import json
import math
import os

DIVIDEND_BASIS_VERSION = "div-basis-v4"
#: two distinct amounts of one type closer than this are a RESTATEMENT signature, not two
#: distributions (measured, common stock 2006-2026: 1,653 of 1,734 multi-amount groups are >= 10 %
#: apart and Yahoo SUMS them; below 2 % Yahoo is split between sum and one-of)
RESTATEMENT_GAP = 0.02
#: an adjusted price is quoted to the cent (the guard's one-raw-tick rule)
TICK = 0.0101
#: a cash dividend on a split session is applied only when the unit ambiguity of its declared
#: amount (pre- vs post-split shares) moves the level by at most this much: (1 − r)·|1 − 1/K|
UNIT_AMBIGUITY = 0.001
MAX_PRIOR_GAP_SESSIONS = 5
MIN_RATIO = 0.5


def build_events(dividends: list, calendar: list, raw_close, canon=lambda t: t,
                 last_session: str = None, adj_close=None, splits=None) -> dict:
    """Classify every dividend record once. `raw_close(iso, t)` / `adj_close(iso, t)` read the
    vintage raw / adjusted files; `splits` is the provider split ledger (v4 interaction rules)."""
    split_ix = collections.defaultdict(list)       # canonical price key -> [(execution_date, K)]
    for sp in splits or ():
        try:
            K = float(sp["split_to"]) / float(sp["split_from"])
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            continue
        b = canon(sp["ticker"])
        for n in {b} | ({b[:-1] + "." + b[-1]} if "." not in b and len(b) >= 2 else set()):
            split_ix[n].append((sp.get("execution_date") or "", K))
    absorbed = collections.defaultdict(list)
    applied = collections.defaultdict(list)       # t -> [(session, ratio)]
    withheld = collections.defaultdict(list)      # t -> [session]
    log = collections.Counter()
    detail = []
    respelled = collections.Counter()

    def traded_before(t, j):
        return any(raw_close(calendar[k], t) for k in range(j - 1, max(-1, j - 1 - MAX_PRIOR_GAP_SESSIONS), -1))

    groups = collections.defaultdict(list)
    resolved = {}
    for d in dividends:
        t, ex, cash = d.get("ticker"), d.get("ex_dividend_date"), d.get("cash_amount")
        if not t or not ex or cash is None:
            continue
        if last_session and ex > last_session:
            continue
        t = canon(t)
        src = t
        if "." not in t and len(t) >= 2:
            key = (t, ex)
            if key not in resolved:
                j = bisect.bisect_left(calendar, ex)
                y = t[:-1] + "." + t[-1]
                lit = j < len(calendar) and traded_before(t, j)
                dot = j < len(calendar) and traded_before(y, j)
                resolved[key] = (None, y) if (lit and dot) else (y if dot else t, None)
            name, amb = resolved[key]
            if amb is not None:
                j = bisect.bisect_left(calendar, ex)
                for n in (t, amb):
                    if calendar[j] not in withheld[n]:
                        withheld[n].append(calendar[j])
                        detail.append({"t": n, "ex": ex, "session": calendar[j],
                                       "reason": "ambiguous spelling %s vs %s: both traded" % (t, amb)})
                log["ambiguous_spelling"] += 1
                continue
            if name != t:
                respelled[(t, name)] += 1
            t = name
        groups[(t, ex)].append((src, d))
    log["respelled_records"] = sum(respelled.values())
    for (t, ex), recs in sorted(groups.items(), key=lambda kv: kv[0][1]):     # ex-date order
        j = bisect.bisect_left(calendar, ex)
        if j >= len(calendar):
            continue
        sess = calendar[j]
        cur = {(r.get("currency") or "").upper() for _s, r in recs}
        per_spelling = collections.Counter()           # (type, amount, spelling) -> records
        by_type = collections.defaultdict(set)
        for src, r in recs:
            try:
                c = float(r["cash_amount"])
            except (TypeError, ValueError):
                continue
            if c > 0:
                ty = r.get("dividend_type") or "?"
                by_type[ty].add(round(c, 10))
                per_spelling[(ty, round(c, 10), src)] += 1
        reason = None
        if cur != {"USD"}:
            reason = "non-USD or missing currency %s" % sorted(cur)
        elif any(n > 1 for n in per_spelling.values()):
            reason = "ambiguous: one amount published twice under one symbol"
        elif any(b - a < RESTATEMENT_GAP * b for v in by_type.values() for a, b in zip(sorted(v), sorted(v)[1:])):
            reason = "ambiguous: near-identical amounts (restatement signature)"
        elif not by_type:
            continue
        cash = sum(sum(v) for v in by_type.values())
        if sum(len(v) for v in by_type.values()) > len(by_type):
            log["multi_amount_summed"] += 1
        prev = None
        if reason is None:
            k = j - 1
            while k >= 0 and j - k <= MAX_PRIOR_GAP_SESSIONS:
                p = raw_close(calendar[k], t)
                if p:
                    prev = p
                    break
                k -= 1
            if prev is None:
                reason = "no raw prior close within %d sessions" % MAX_PRIOR_GAP_SESSIONS
        if reason is None:
            r = 1.0 - cash / prev
            if r <= MIN_RATIO:
                reason = "cash %.4f is >= %.0f%% of prior raw close %.4f" % (cash, (1 - MIN_RATIO) * 100, prev)
        if reason is None and adj_close is not None:
            a0, a1, r1 = adj_close(calendar[k], t), adj_close(sess, t), raw_close(sess, t)
            if a0 and a1 and r1:
                lf = math.log((a1 / r1) / (a0 / prev))
                if abs(lf) > 1e-3 and abs(a1 / (a0 / prev) - r1) > TICK                         and abs(lf + math.log(r)) <= 0.25 * abs(math.log(r)):
                    absorbed[t].append((sess, r, round(math.exp(lf), 6)))
                    log["absorbed_by_provider"] += 1
                    continue
            Ks = [K for (e, K) in split_ix.get(t, ()) if calendar[k] < e <= sess and K > 0]
            if Ks:
                K = math.prod(Ks)
                bound = (1.0 - r) * abs(1.0 - 1.0 / K)
                if bound > UNIT_AMBIGUITY:
                    reason = "dividend on a split session (K=%.4f): cash units unprovable, bound %.4f" % (K, bound)
                else:
                    log["split_session_units_immaterial"] += 1
        if reason:
            withheld[t].append(sess)
            log["withheld"] += 1
            detail.append({"t": t, "ex": ex, "session": sess, "reason": reason})
            continue
        applied[t].append((sess, r))
        log["applied"] += 1
        if len(by_type) > 1:
            log["multi_type_summed"] += 1
    for t in applied:
        applied[t].sort()
    for t in withheld:
        withheld[t] = sorted(set(withheld[t]))
    return {"version": DIVIDEND_BASIS_VERSION, "applied": dict(applied),
            "withheld_boundaries": dict(withheld), "counts": dict(log), "withheld_detail": detail,
            "respelled": {"%s->%s" % k: v for k, v in sorted(respelled.items())},
            "absorbed_by_provider": {t: sorted(v) for t, v in absorbed.items()}}


class DividendBasis:
    def __init__(self, table: dict):
        self.version = table["version"]
        self.applied = table["applied"]
        self.withheld = table["withheld_boundaries"]

    def factors(self, names: list, frame_dates: list):
        """(n x m) multipliers A = S · F for a frame ending at D−1 (last column stays 1)."""
        import numpy as np
        n, m = len(names), len(frame_dates)
        F = np.ones((n, m))
        if m == 0:
            return F
        lo, hi = frame_dates[0], frame_dates[-1]
        pos = {d: i for i, d in enumerate(frame_dates)}
        for r, t in enumerate(names):
            for sess, ratio in self.applied.get(t, ()):
                if sess <= lo or sess > hi:
                    continue                      # multiplies nothing in, or is past, the frame
                F[r, :pos[sess]] *= ratio
        return F

    def withheld_in(self, t: str, frame_first: str, day: str) -> bool:
        xs = self.withheld.get(t)
        if not xs:
            return False
        i = bisect.bisect_right(xs, frame_first)
        return i < len(xs) and xs[i] < day          # in-frame only: a same-day ex-date is not applied


def load_or_build(dividends_path: str, calendar: list, raw_close, canon, cache_path: str,
                  last_session: str, adj_close=None, splits_path: str = None) -> tuple:
    h = hashlib.sha256()
    for pth in (dividends_path, splits_path):
        if pth:
            with open(pth, "rb") as f:
                h.update(hashlib.sha256(f.read()).digest())
    h.update(b"adj" if adj_close is not None else b"noadj")
    h.update(("\n".join(calendar) + DIVIDEND_BASIS_VERSION + last_session).encode())
    key = h.hexdigest()
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            t = json.load(f)
        if t.get("input_key") == key:
            return DividendBasis(t), t
    with open(dividends_path) as f:
        divs = json.load(f)["dividends"]
    splits = None
    if splits_path:
        with open(splits_path) as f:
            splits = json.load(f)["splits"]
    t = build_events(divs, calendar, raw_close, canon, last_session, adj_close=adj_close, splits=splits)
    t["input_key"] = key
    tmp = cache_path + ".partial.%d" % os.getpid()
    with open(tmp, "w") as f:
        json.dump(t, f)
    os.replace(tmp, cache_path)
    return DividendBasis(t), t
