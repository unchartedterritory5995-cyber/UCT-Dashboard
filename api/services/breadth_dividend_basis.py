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
name on one ex-date merge (identical amounts collapse; different amounts are a conflict).

⛔ FAIL CLOSED, NEVER GUESSED. An event is WITHHELD — the name gets no levels while a frame
straddles it, exactly like an adjusted-series defect — when: the currency is not USD; the same
(ticker, ex_date, type) carries two different amounts; there is no raw prior close within 5
sessions; or cash ≥ 50 % of the prior raw close (r ≤ 0.5, liquidating-size — yfinance would
apply it, but a vendor error of that size would poison a year of levels). Identical duplicate
records collapse to one; different dividend TYPES on one ex-date are summed.
"""
from __future__ import annotations

import bisect
import collections
import hashlib
import json
import math
import os

DIVIDEND_BASIS_VERSION = "div-basis-v2"
MAX_PRIOR_GAP_SESSIONS = 5
MIN_RATIO = 0.5


def build_events(dividends: list, calendar: list, raw_close, canon=lambda t: t,
                 last_session: str = None) -> dict:
    """Classify every dividend record once. `raw_close(iso, t)` reads the vintage raw file."""
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
        groups[(t, ex)].append(d)
    log["respelled_records"] = sum(respelled.values())
    for (t, ex), recs in sorted(groups.items(), key=lambda kv: kv[0][1]):     # ex-date order
        j = bisect.bisect_left(calendar, ex)
        if j >= len(calendar):
            continue
        sess = calendar[j]
        cur = {(r.get("currency") or "USD").upper() for r in recs}
        by_type = collections.defaultdict(set)
        for r in recs:
            try:
                c = float(r["cash_amount"])
            except (TypeError, ValueError):
                continue
            if c > 0:
                by_type[r.get("dividend_type") or "?"].add(round(c, 10))
        reason = None
        if cur != {"USD"}:
            reason = "non-USD currency %s" % sorted(cur)
        elif any(len(v) > 1 for v in by_type.values()):
            reason = "conflicting amounts for one type"
        elif not by_type:
            continue
        cash = sum(next(iter(v)) for v in by_type.values())
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
            "respelled": {"%s->%s" % k: v for k, v in sorted(respelled.items())}}


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
                  last_session: str) -> tuple:
    h = hashlib.sha256()
    with open(dividends_path, "rb") as f:
        h.update(hashlib.sha256(f.read()).digest())
    h.update(("\n".join(calendar) + DIVIDEND_BASIS_VERSION + last_session).encode())
    key = h.hexdigest()
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            t = json.load(f)
        if t.get("input_key") == key:
            return DividendBasis(t), t
    with open(dividends_path) as f:
        divs = json.load(f)["dividends"]
    t = build_events(divs, calendar, raw_close, canon, last_session)
    t["input_key"] = key
    tmp = cache_path + ".partial.%d" % os.getpid()
    with open(tmp, "w") as f:
        json.dump(t, f)
    os.replace(tmp, cache_path)
    return DividendBasis(t), t
