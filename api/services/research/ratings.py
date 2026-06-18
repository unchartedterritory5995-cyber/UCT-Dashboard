"""UCT Ratings for the research page.

A Composite 0-99 + component ratings (EPS, Relative Strength, Growth, Value,
SMR, Accumulation/Distribution, Sponsorship) + a "Stock Checkup" pass/fail
checklist, computed on-demand per ticker from data we already fetch
(get_fundamentals + get_ownership + 1y price/volume history).

**v1 scoring is threshold-calibrated (absolute), not universe-percentile.**
The design's nightly cap_universe percentile job + peer-rank is a future
optimization; this ships a working, useful Ratings tab now. Scores map metric
values to 0-99 via hand-calibrated bands documented inline. Cached 12h.
"""
from __future__ import annotations

import logging

from api.services.cache import cache
from api.services.fundamentals import get_fundamentals
from api.services.research.ownership import get_ownership
from api.services.research import ratings_db
from api.services.yfinance_pool import fetch_history

_logger = logging.getLogger(__name__)

_CACHE_TTL = 43_200  # 12h
_METHOD_ABSOLUTE = "Threshold-calibrated v1 — absolute scoring; universe-percentile ranking is a future enhancement."


def _method_percentile(n) -> str:
    return f"Percentile rank vs {n:,}-stock universe (IBD-style; 1-99, higher is stronger)."

_LETTER_NUM = {"A": 85, "B": 68, "C": 50, "D": 32, "E": 15}

# Bands: (min_value, score) sorted DESCENDING by threshold; first match wins.
_EPS_BANDS = [(50, 98), (30, 90), (20, 80), (10, 68), (0, 50), (-15, 30), (-1e9, 12)]
_RS_BANDS = [(40, 96), (25, 88), (15, 80), (8, 70), (0, 55), (-10, 35), (-1e9, 15)]
_GROWTH_BANDS = [(40, 95), (25, 86), (15, 76), (8, 64), (0, 50), (-10, 30), (-1e9, 14)]
_MARGIN_BANDS = [(25, 95), (15, 82), (8, 68), (3, 52), (0, 38), (-1e9, 18)]
_ROE_BANDS = [(30, 96), (20, 86), (15, 76), (10, 62), (5, 46), (0, 30), (-1e9, 14)]


def _band(value, bands, default=None):
    if value is None:
        return default
    for thr, sc in bands:
        if value >= thr:
            return sc
    return bands[-1][1]


def _letter(score):
    if score is None:
        return None
    if score >= 80:
        return "A"
    if score >= 60:
        return "B"
    if score >= 40:
        return "C"
    if score >= 20:
        return "D"
    return "E"


def _blend_growth(rev, eps):
    if rev is None and eps is None:
        return None
    if rev is None:
        return eps
    if eps is None:
        return rev
    return eps * 0.6 + rev * 0.4


def _value_score(peg, pe_fwd):
    if peg is not None and peg > 0:
        if peg <= 1:
            return 92
        if peg <= 1.5:
            return 78
        if peg <= 2:
            return 64
        if peg <= 3:
            return 48
        if peg <= 5:
            return 32
        return 16
    if pe_fwd is not None and pe_fwd > 0:
        if pe_fwd <= 12:
            return 90
        if pe_fwd <= 18:
            return 76
        if pe_fwd <= 25:
            return 62
        if pe_fwd <= 35:
            return 46
        if pe_fwd <= 50:
            return 30
        return 16
    return None


def _smr(rev_growth, op_margin, roe):
    parts = []
    if rev_growth is not None:
        parts.append(_band(rev_growth, _GROWTH_BANDS))
    if op_margin is not None:
        parts.append(_band(op_margin, _MARGIN_BANDS))
    if roe is not None:
        parts.append(_band(roe, _ROE_BANDS))
    if not parts:
        return None, None
    s = round(sum(parts) / len(parts))
    return s, _letter(s)


def _accdis_letter(ratio):
    if ratio is None:
        return None
    if ratio >= 1.3:
        return "A"
    if ratio >= 1.1:
        return "B"
    if ratio >= 0.9:
        return "C"
    if ratio >= 0.75:
        return "D"
    return "E"


def _sponsorship_letter(pct):
    if pct is None:
        return None
    if pct >= 70:
        return "A"
    if pct >= 50:
        return "B"
    if pct >= 30:
        return "C"
    if pct >= 12:
        return "D"
    return "E"


def _composite(eps, rs, growth, value, smr_n, accdis_letter):
    weighted = []
    for score, weight in [
        (eps, 0.25), (rs, 0.25), (growth, 0.20), (smr_n, 0.15),
        (_LETTER_NUM.get(accdis_letter), 0.10), (value, 0.05),
    ]:
        if score is not None:
            weighted.append((score, weight))
    if not weighted:
        return None
    tot = sum(w for _, w in weighted)
    return round(sum(s * w for s, w in weighted) / tot)


def _weighted_rs_return(closes):
    if closes is None or len(closes) < 63:
        return None

    def ret(n):
        if len(closes) <= n:
            return None
        a, b = closes[-1], closes[-1 - n]
        if not b:
            return None
        return (a - b) / b * 100

    r3m = ret(63)
    if r3m is None:
        return None
    parts = [(r3m, 0.4)]
    for v, w in [(ret(126), 0.2), (ret(21), 0.2), (ret(5), 0.2)]:
        if v is not None:
            parts.append((v, w))
    tot = sum(w for _, w in parts)
    return sum(v * w for v, w in parts) / tot


def _accdis_ratio(closes, vols, lookback=65):
    if closes is None or vols is None or len(closes) < lookback + 1:
        return None
    up = down = 0.0
    for i in range(len(closes) - lookback, len(closes)):
        if i <= 0:
            continue
        ch = closes[i] - closes[i - 1]
        if ch > 0:
            up += vols[i] or 0
        elif ch < 0:
            down += vols[i] or 0
    if down == 0:
        return 2.0 if up > 0 else None
    return up / down


def _chk(label, ok, value):
    status = "neutral" if ok is None else ("pass" if ok else "fail")
    return {"label": label, "status": status, "value": value}


def _checkup(fund, rs, last_close, inst_pct):
    eg = fund.get("earnings_growth_pct")
    sg = fund.get("revenue_growth_pct")
    roe = fund.get("roe_pct")
    om = fund.get("operating_margin_pct")
    de = fund.get("debt_to_equity")
    high = fund.get("fifty_two_week_high")
    near_high = (last_close is not None and high) and last_close >= high * 0.85
    return [
        _chk("EPS growth ≥ 25%", (eg >= 25) if eg is not None else None, f"{eg:+.0f}%" if eg is not None else "—"),
        _chk("Sales growth ≥ 20%", (sg >= 20) if sg is not None else None, f"{sg:+.0f}%" if sg is not None else "—"),
        _chk("ROE ≥ 17%", (roe >= 17) if roe is not None else None, f"{roe:.0f}%" if roe is not None else "—"),
        _chk("Relative strength ≥ 80", (rs >= 80) if rs is not None else None, str(rs) if rs is not None else "—"),
        _chk("Within 15% of 52-wk high", near_high if (last_close and high) else None,
             f"{last_close / high * 100:.0f}% of high" if (last_close and high) else "—"),
        _chk("Operating margin positive", (om > 0) if om is not None else None, f"{om:.1f}%" if om is not None else "—"),
        _chk("Debt/equity < 1.5x", (de < 150) if de is not None else None, f"{de / 100:.2f}x" if de is not None else "—"),
        _chk("Institutional sponsorship ≥ 40%", (inst_pct >= 40) if inst_pct is not None else None,
             f"{inst_pct:.0f}%" if inst_pct is not None else "—"),
    ]


def get_ratings(sym):
    sym = (sym or "").upper().strip()
    if not sym:
        return {}

    ck = f"research_rat::{sym}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    fund = {}
    try:
        fund = get_fundamentals(sym) or {}
    except Exception as exc:
        _logger.warning("ratings: fundamentals failed for %s: %s", sym, exc)

    own = {}
    try:
        own = get_ownership(sym) or {}
    except Exception as exc:
        _logger.warning("ratings: ownership failed for %s: %s", sym, exc)

    closes = vols = None
    last_close = None
    try:
        df = fetch_history(sym, period="1y")
        if df is not None and not getattr(df, "empty", True):
            closes = list(df["Close"])
            vols = list(df["Volume"])
            last_close = closes[-1] if closes else None
    except Exception as exc:
        _logger.warning("ratings: history failed for %s: %s", sym, exc)

    # ── Phase 2: rank against the nightly universe distributions when available,
    # else fall back to the absolute threshold bands (cold-start / on-demand
    # tickers / missing metric all degrade gracefully).
    try:
        dists = ratings_db.get_distributions()
    except Exception:
        dists = {}
    _used_pct = {"hit": False}

    def _pctile(metric, val, invert=False):
        p = ratings_db.percentile(metric, val, dists, invert=invert) if dists else None
        if p is not None:
            _used_pct["hit"] = True
        return p

    rev_g = fund.get("revenue_growth_pct")
    eps_g = fund.get("earnings_growth_pct")
    op_m = fund.get("operating_margin_pct")
    roe = fund.get("roe_pct")
    peg = fund.get("peg")

    rs_ret = _weighted_rs_return(closes)
    rs = _pctile("rs_return", rs_ret) or (_band(rs_ret, _RS_BANDS) if rs_ret is not None else None)
    eps = _pctile("earnings_growth", eps_g) or (_band(eps_g, _EPS_BANDS) if eps_g is not None else None)
    growth_in = _blend_growth(rev_g, eps_g)
    growth = _pctile("blended_growth", growth_in) or (_band(growth_in, _GROWTH_BANDS) if growth_in is not None else None)

    # Value: lower PEG = stronger → inverted percentile; fall back to absolute value score.
    value = None
    if peg is not None and peg > 0:
        value = _pctile("peg", peg, invert=True)
    if value is None:
        value = _value_score(peg, fund.get("pe_forward"))

    # SMR: mean of the three sub-metric percentiles when ranked, else absolute composite.
    smr_parts = [p for p in (_pctile("rev_growth", rev_g), _pctile("op_margin", op_m), _pctile("roe", roe)) if p is not None]
    if smr_parts:
        smr_n = round(sum(smr_parts) / len(smr_parts))
        smr = _letter(smr_n)
    else:
        smr_n, smr = _smr(rev_g, op_m, roe)

    # Acc/Dis + Sponsorship: percentile → quintile letter, else absolute letter bands.
    accdis_r = _accdis_ratio(closes, vols)
    ad_pct = _pctile("accdis_ratio", accdis_r)
    accdis = _letter(ad_pct) if ad_pct is not None else _accdis_letter(accdis_r)

    inst_pct = (own.get("institutional") or {}).get("pct_held")
    sp_pct = _pctile("inst_pct", inst_pct)
    sponsorship = _letter(sp_pct) if sp_pct is not None else _sponsorship_letter(inst_pct)

    composite = _composite(eps, rs, growth, value, smr_n, accdis)

    basis = "percentile" if _used_pct["hit"] else "absolute"
    universe_n = (dists.get("rs_return") or {}).get("n") if dists else None
    method = _method_percentile(universe_n) if (basis == "percentile" and universe_n) else _METHOD_ABSOLUTE

    out = {
        "sym": sym,
        "composite": composite,
        "components": {
            "eps": eps, "rs": rs, "growth": growth, "value": value,
            "smr": smr, "accdis": accdis, "sponsorship": sponsorship,
        },
        "checkup": _checkup(fund, rs, last_close, inst_pct),
        "method": method,
        "basis": basis,
        "universe_n": universe_n,
    }
    cache.set(ck, out, _CACHE_TTL)
    return out
