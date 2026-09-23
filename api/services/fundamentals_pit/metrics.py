"""Metrics computed from ONE knowledge state (everything public at one instant).

`Book` is the as-known view of a company at an instant: standalone quarters per
flow primitive, instants per balance-sheet primitive, all per-share values on
today's share basis. Every metric below is a pure function of one Book, so a
ratio can never mix numerators and denominators known at different times.

Definitions (the methodology the catalogue promises):
  TTM flow        sum of the 4 contiguous standalone quarters ending at q; if a
                  reported fiscal-year fact ends exactly at q, THAT value (they
                  agree for additive flows; for EPS the reported annual figure
                  is the authority).
  EPS TTM         as above over reported diluted EPS. Quarterly EPS does not add
                  exactly to annual EPS (share counts move), so a TTM crossing a
                  fiscal year is the standard sum-of-four approximation.
  YoY growth      x(q) / x(q-4) - 1, both from the SAME Book; None when the base
                  is <= 0 (a growth rate off a loss is not a number).
  Margin          flow_ttm / revenue_ttm over the SAME four quarters.
  ROE / ROA       NI_ttm / mean(level at q, level at q-4); None without both.
  FCF             operating cash flow - capex, per quarter, then TTM.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from .concepts import FLOW, INSTANT, PER_SHARE, PRIMITIVES, SHARES_INSTANT
from .knowledge import KnownFact, values_equivalent
from .quarters import QUARTER_DAYS, YEAR_DAYS, Quarter, contiguous_window, standalone_quarters

QUARTER_MIN = QUARTER_DAYS[0]
from .splits import Ledger


@dataclass
class Value:
    v: float
    period_end: date
    sources: tuple = ()              # (tag, start, end, accn) of every fact used
    note: str = ""


@dataclass
class Book:
    quarters: dict[str, dict[date, tuple[Quarter, str]]] = field(default_factory=dict)
    fiscal_years: dict[str, dict[date, tuple[float, str, tuple]]] = field(default_factory=dict)
    instants: dict[str, dict[date, tuple[float, str, str]]] = field(default_factory=dict)
    provenance: dict[tuple, str] = field(default_factory=dict)   # (tag,start,end) -> accn
    mixed_tags: list = field(default_factory=list)
    stale: list = field(default_factory=list)
    durations: dict[str, dict[tuple, tuple[float, str]]] = field(default_factory=dict)
    source_tag: dict[tuple, str] = field(default_factory=dict)


def _et_date(k: KnownFact) -> date:
    from .filings import ET
    return k.public_at.astimezone(ET).date()


def _overlaps(s1, e1, s2, e2) -> bool:
    s1 = s1 or e1
    s2 = s2 or e2
    return s1 <= e2 and s2 <= e1


_SAME_CACHE: dict = {}


def _decimals(v: float) -> int:
    r = repr(float(v))
    return 0 if "e" in r or "." not in r else len(r.split(".")[1].rstrip("0"))


def _per_share_same(ledger: Ledger, conv):
    """Equality on ONE share basis (a split re-basing is not a restatement).
    Cached per ledger so Knowledge can cache epochs by comparator identity."""
    key = (id(ledger), conv.__name__)
    if key not in _SAME_CACHE:
        def same(a, b, c=conv):
            # Per-share values are reported to a few decimals: NVDA's pre-split
            # Q1 FY25 EPS 5.98 converts to 0.598 on today's basis, and the
            # post-split comparative reports 0.60. Equal at the reported
            # precision (at least cents) is equal.
            x, y = c(a.fact.val, _et_date(a)), c(b.fact.val, _et_date(b))
            tol = 0.5 * 10 ** -max(2, _decimals(a.fact.val), _decimals(b.fact.val))
            if c is not None and "per_share" in c.__name__:
                tol = max(tol, 0.5 * 10 ** -max(2, _decimals(b.fact.val)))
            return abs(x - y) <= tol + 1e-12 or values_equivalent(a.fact.val, b.fact.val)
        _SAME_CACHE[key] = same
    return _SAME_CACHE[key]


def build_book(state: dict[tuple, KnownFact], ledger: Ledger | None = None,
               kb=None, t=None) -> Book:
    """`kb` + `t` enable the RESTATEMENT-STALENESS rule: a fact known from a
    filing EARLIER than a restatement (public by t) of an OVERLAPPING period of
    the same tag is stale for derivation -- FY(restated) - 9M(original) would
    otherwise manufacture a quarter no filing ever reported. A stale part
    withholds the derived quarter (the series holds its previous value) until
    a later filing re-reports it on the restated basis."""
    ledger = ledger or Ledger()
    book = Book()
    by_tag: dict[str, dict[tuple, KnownFact]] = {}
    for key, k in state.items():
        by_tag.setdefault(key[0], {})[key] = k

    for prim in PRIMITIVES.values():
        if prim.kind in (FLOW, PER_SHARE):
            chosen: dict[date, tuple[Quarter, str]] = {}
            years: dict[date, tuple[float, str, tuple]] = {}
            cum: dict[tuple, tuple[float, str]] = {}
            conv = None
            if prim.kind == PER_SHARE:
                conv = ledger.shares_today if prim.unit == "shares" else ledger.per_share_today
            cand_q: dict[date, list] = {}
            cand_y: dict[date, list] = {}
            per_tag: dict[str, tuple[dict, dict]] = {}
            for tag in prim.tags:
                durs: dict[tuple, float] = {}
                known_at: dict[tuple, object] = {}
                for (_t, unit, s, e), k in by_tag.get(tag, {}).items():
                    if unit != prim.unit or s is None:
                        continue
                    durs[(s, e)] = k.fact.val if conv is None else conv(k.fact.val, _et_date(k))
                    known_at[(s, e)] = (k.public_at, k.fact.accn)
                if durs:
                    per_tag[tag] = (durs, known_at)
            for rank, group in _equivalent_pools(prim.tags, per_tag):
                label = group[0]
                durs: dict[tuple, float] = {}
                known_at: dict[tuple, object] = {}
                for tag in group:                       # most recent disclosure wins
                    d, ka = per_tag[tag]
                    for key, v in d.items():
                        if key not in known_at or ka[key][0] > known_at[key]:
                            durs[key] = v
                            known_at[key] = ka[key][0]
                            book.provenance[(label, key[0], key[1])] = ka[key][1]
                            book.source_tag[(label, key[0], key[1])] = tag
                restated = []
                if kb is not None and t is not None:
                    same = _per_share_same(ledger, conv) if conv is not None else None
                    pool = frozenset(group)
                    restated = [ep for tag in group for ep in kb.restatements(tag, t, same, pool)]
                # Drop stale durations BEFORE any derivation: a stale fact can
                # then never be one half of a subtraction or one leg of a TTM.
                for key in list(durs):
                    if any(known_at[key] < pr and _overlaps(key[0], key[1], rs, re)
                           for (pr, rs, re) in restated):
                        book.stale.append((prim.id, label, key))
                        del durs[key]
                qs, _ = standalone_quarters(durs, tolerance=abs(1e-6))
                for e, q in qs.items():
                    known = max(known_at[p] for p in q.parts)
                    cand_q.setdefault(e, []).append((known, -rank, q, label))
                for (s, e), v in durs.items():
                    if YEAR_DAYS[0] <= (e - s).days + 1 <= YEAR_DAYS[1]:
                        cand_y.setdefault(e, []).append((known_at[(s, e)], -rank, (v, label, (s, e))))
                    cum.setdefault((s, e), (v, label))
            for e, cs in cand_q.items():
                best = _pick(cs, lambda c: c[2].val)
                chosen[e] = (best[2], best[3])
            for e, cs in cand_y.items():
                years[e] = _pick(cs, lambda c: c[2][0])[2]
            book.quarters[prim.id] = chosen
            book.fiscal_years[prim.id] = years
            book.durations[prim.id] = cum
        else:
            lv: dict[date, tuple[float, str, str]] = {}
            cand_i: dict[date, list] = {}
            for rank, tag in enumerate(prim.tags):
                for (_t, unit, s, e), k in by_tag.get(tag, {}).items():
                    if unit != prim.unit or s is not None:
                        continue
                    v = k.fact.val
                    if prim.kind == SHARES_INSTANT:
                        v = ledger.shares_today(v, e)
                    cand_i.setdefault(e, []).append((k.public_at, -rank, (v, tag, k.fact.accn)))
            for e, cs in cand_i.items():
                lv[e] = _pick(cs, lambda c: c[2][0])[2]
            book.instants[prim.id] = lv
    fcf_quarters(book)
    return book


def _equivalent_pools(tags: tuple, per_tag: dict) -> list[tuple[int, list[str]]]:
    """Group candidate tags this ISSUER uses interchangeably: two tags join one
    pool only if they co-report at least one period AND agree on every period
    they co-report. MEASURED: NVDA's FY2021 10-K tagged revenue
    `RevenueFromContract...` while its 10-Qs used `Revenues` -- equal on all 15
    shared periods -- so Q4 = FY - 9M needed both. CAT's `Revenues` (total) and
    `SalesRevenueNet` (machinery only) disagree on 79 of 79 and stay apart.
    Returns [(rank of the pool's best tag, [tags in priority order])]."""
    present = [t for t in tags if t in per_tag]
    parent = {t: t for t in present}

    def find(x):
        while parent[x] != x:
            x = parent[x]
        return x
    for i, a in enumerate(present):
        for b in present[i + 1:]:
            da, db = per_tag[a][0], per_tag[b][0]
            shared = da.keys() & db.keys()
            if shared and all(values_equivalent(da[k], db[k]) or abs(da[k] - db[k]) <= 1e-9 * max(1, abs(da[k]))
                              for k in shared):
                parent[find(b)] = find(a)
    groups: dict[str, list[str]] = {}
    for t in present:
        groups.setdefault(find(t), []).append(t)
    return sorted(((tags.index(g[0]), g) for g in groups.values()), key=lambda x: x[0])


def _pick(cands: list, val):
    """Most recently disclosed candidate; ties to the higher-priority tag. If
    the winner is the exact negative of a higher-priority candidate, that is a
    cross-tag sign error and the higher-priority tag wins instead."""
    best = max(cands, key=lambda c: (c[0], c[1]))
    for c in cands:
        if c[1] > best[1] and val(c) != 0 and val(best) == -val(c):
            return c
    return best


# ── metric functions: (book, q_end) -> Value | None ─────────────────────────
def _src(book: Book, prim: str, qs: list[Quarter], tag: str) -> tuple:
    """(actual tag, start, end, accn) per fact used -- the POOL label resolved
    back to the tag the filing actually used."""
    return tuple((book.source_tag.get((tag, p[0], p[1]), tag), p[0], p[1], book.provenance.get((tag, p[0], p[1])))
                 for q in qs for p in q.parts)


def quarter_value(book: Book, prim: str, q_end: date) -> Value | None:
    hit = book.quarters.get(prim, {}).get(q_end)
    if hit is None:
        return None
    q, tag = hit
    return Value(q.val, q_end, _src(book, prim, [q], tag), q.method)


def ttm(book: Book, prim: str, q_end: date) -> Value | None:
    fy = book.fiscal_years.get(prim, {}).get(q_end)
    if fy is not None:
        v, tag, (s, e) = fy
        return Value(v, q_end, ((book.source_tag.get((tag, s, e), tag), s, e, book.provenance.get((tag, s, e))),),
                     "fiscal_year")
    roll = ytd_roll(book, prim, q_end)
    if roll is not None:
        return roll
    qmap = {e: q for e, (q, _tag) in book.quarters.get(prim, {}).items()}
    win = contiguous_window(qmap, q_end, 4)
    if win is None:
        return None
    tags = {book.quarters[prim][q.end][1] for q in win}
    if len(tags) > 1:
        book.mixed_tags.append((prim, q_end, tuple(sorted(tags))))
    srcs = tuple(s for q in win for s in _src(book, prim, [q], book.quarters[prim][q.end][1]))
    return Value(sum(q.val for q in win), q_end, srcs, "sum_of_4")


def ytd_roll(book: Book, prim: str, q_end: date) -> Value | None:
    """TTM(q) = FY_prev + YTD_cur(q) - YTD_prev(q - 1y), all ONE tag.

    YTD_cur and YTD_prev are normally the current 10-Q's own number and its
    comparative, so they are on the SAME (current) basis even right after a
    restatement -- the method that needs the fewest facts to agree."""
    durs = book.durations.get(prim, {})
    for (s1, e1), (v_cur, tag) in durs.items():
        if e1 != q_end or not (QUARTER_MIN <= (e1 - s1).days + 1 <= 300):
            continue
        e0 = s1 - timedelta(days=1)
        fy = next(((s0, v) for (s0, e), (v, tg) in durs.items()
                   if e == e0 and tg == tag and YEAR_DAYS[0] <= (e - s0).days + 1 <= YEAR_DAYS[1]), None)
        if fy is None:
            continue
        s0, v_fy = fy
        span = (e1 - s1).days
        prev = next(((e, v) for (s, e), (v, tg) in durs.items()
                     if s == s0 and tg == tag and abs((e - s0).days - span) <= 7), None)
        if prev is None:
            continue
        e_p, v_prev = prev
        srcs = tuple((book.source_tag.get((tag, a, b), tag), a, b, book.provenance.get((tag, a, b)))
                     for a, b in ((s0, e0), (s1, e1), (s0, e_p)))
        return Value(v_fy + v_cur - v_prev, q_end, srcs, "ytd_roll")
    return None


def prior_quarter_end(book: Book, prim: str, q_end: date) -> date | None:
    """The quarter end one fiscal year before `q_end` (358-372 days back)."""
    ends = book.quarters.get(prim, {}).keys() | book.fiscal_years.get(prim, {}).keys()
    for e in sorted(ends, reverse=True):
        if 358 <= (q_end - e).days <= 372:
            return e
    return None


def growth(cur: Value | None, base: Value | None) -> Value | None:
    if cur is None or base is None or base.v <= 0:
        return None
    return Value(cur.v / base.v - 1.0, cur.period_end, cur.sources + base.sources, "yoy")


def ratio(num: Value | None, den: Value | None) -> Value | None:
    if num is None or den is None or den.v == 0:
        return None
    return Value(num.v / den.v, num.period_end, num.sources + den.sources, "ratio")


def instant(book: Book, prim: str, on: date) -> Value | None:
    hit = book.instants.get(prim, {}).get(on)
    if hit is None:
        return None
    v, tag, accn = hit
    return Value(v, on, ((tag, None, on, accn),), "instant")


def fcf_quarters(book: Book) -> None:
    """Materialise free cash flow as a derived FLOW primitive inside the Book:
    per quarter, OCF - capex when BOTH exist for the identical quarter."""
    ocf = book.quarters.get("operating_cash_flow", {})
    cap = book.quarters.get("capex", {})
    out = {}
    for e, (qo, to) in ocf.items():
        hc = cap.get(e)
        if hc is None or hc[0].start != qo.start:
            continue
        qc, tc = hc
        out[e] = (Quarter(qo.start, e, qo.val - qc.val, "derived", qo.parts + qc.parts), f"{to}-{tc}")
    book.quarters["fcf"] = out
    fy_o, fy_c = book.fiscal_years.get("operating_cash_flow", {}), book.fiscal_years.get("capex", {})
    book.fiscal_years["fcf"] = {e: (fy_o[e][0] - fy_c[e][0], "fcf", fy_o[e][2])
                                for e in fy_o if e in fy_c and fy_o[e][2] == fy_c[e][2]}


def avg_level(book: Book, prim: str, q_end: date) -> Value | None:
    cur = instant(book, prim, q_end)
    if cur is None:
        return None
    for e in book.instants.get(prim, {}):
        if 358 <= (q_end - e).days <= 372:
            prev = instant(book, prim, e)
            return Value((cur.v + prev.v) / 2.0, q_end, cur.sources + prev.sources, "avg2")
    return None


def latest_instant(book: Book, prim: str) -> Value | None:
    lv = book.instants.get(prim, {})
    if not lv:
        return None
    return instant(book, prim, max(lv))


# ── the catalogue of POC metrics: id -> (fn(book, q_end), anchor primitive) ──
def _ttm_ratio(num: str, den: str):
    return lambda b, q: ratio(ttm(b, num, q), ttm(b, den, q))


def _ttm_growth(prim: str):
    def f(b, q):
        p = prior_quarter_end(b, prim, q)
        return growth(ttm(b, prim, q), ttm(b, prim, p)) if p else None
    return f


def _q_growth(prim: str):
    def f(b, q):
        p = prior_quarter_end(b, prim, q)
        return growth(quarter_value(b, prim, q), quarter_value(b, prim, p)) if p else None
    return f


METRICS = {
    "revenue_q":            (lambda b, q: quarter_value(b, "revenue", q), "revenue"),
    "revenue_ttm":          (lambda b, q: ttm(b, "revenue", q), "revenue"),
    "revenue_growth_yoy_q": (_q_growth("revenue"), "revenue"),
    "revenue_growth_ttm":   (_ttm_growth("revenue"), "revenue"),
    "net_income_q":         (lambda b, q: quarter_value(b, "net_income", q), "net_income"),
    "net_income_ttm":       (lambda b, q: ttm(b, "net_income", q), "net_income"),
    "net_income_growth_ttm": (_ttm_growth("net_income"), "net_income"),
    "eps_diluted_q":        (lambda b, q: quarter_value(b, "eps_diluted", q), "eps_diluted"),
    "eps_diluted_ttm":      (lambda b, q: ttm(b, "eps_diluted", q), "eps_diluted"),
    "eps_growth_ttm":       (_ttm_growth("eps_diluted"), "eps_diluted"),
    "eps_growth_yoy_q":     (_q_growth("eps_diluted"), "eps_diluted"),
    "gross_margin_ttm":     (_ttm_ratio("gross_profit", "revenue"), "revenue"),
    "operating_margin_ttm": (_ttm_ratio("operating_income", "revenue"), "revenue"),
    "net_margin_ttm":       (_ttm_ratio("net_income", "revenue"), "revenue"),
    "operating_cash_flow_ttm": (lambda b, q: ttm(b, "operating_cash_flow", q), "operating_cash_flow"),
    "fcf_ttm":              (lambda b, q: ttm(b, "fcf", q), "fcf"),
    "fcf_margin_ttm":       (_ttm_ratio("fcf", "revenue"), "revenue"),
    "fcf_growth_ttm":       (_ttm_growth("fcf"), "fcf"),
    "cash":                 (lambda b, q: instant(b, "cash", q), "cash"),
    "assets":               (lambda b, q: instant(b, "assets", q), "assets"),
    "liabilities":          (lambda b, q: instant(b, "liabilities", q), "liabilities"),
    "equity":               (lambda b, q: instant(b, "equity", q), "equity"),
    "long_term_debt":       (lambda b, q: instant(b, "long_term_debt", q), "long_term_debt"),
    "debt_to_equity":       (lambda b, q: ratio(instant(b, "long_term_debt", q), instant(b, "equity", q)), "equity"),
    "roe_ttm":              (lambda b, q: ratio(ttm(b, "net_income", q), avg_level(b, "equity", q)), "net_income"),
    "roa_ttm":              (lambda b, q: ratio(ttm(b, "net_income", q), avg_level(b, "assets", q)), "net_income"),
    "dividends_per_share_ttm": (lambda b, q: ttm(b, "dividends_per_share", q), "dividends_per_share"),
    "shares_outstanding":   (lambda b, q: instant(b, "shares_outstanding", q), "shares_outstanding"),
    "shares_diluted_q":     (lambda b, q: quarter_value(b, "shares_diluted_wavg", q), "shares_diluted_wavg"),
}


def anchor_ends(book: Book, anchor: str) -> list[date]:
    ends = set(book.quarters.get(anchor, {})) | set(book.fiscal_years.get(anchor, {})) \
        | set(book.instants.get(anchor, {}))
    return sorted(ends, reverse=True)


def latest(book: Book, metric: str) -> Value | None:
    """The metric for the MOST RECENT period at which it is computable."""
    fn, anchor = METRICS[metric]
    for e in anchor_ends(book, anchor)[:6]:
        v = fn(book, e)
        if v is not None:
            return v
    return None
