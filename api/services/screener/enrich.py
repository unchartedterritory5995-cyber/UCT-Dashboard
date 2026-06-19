"""Map stored ratings metrics -> screener snapshot columns, and compute the
UCT composite + RS rank the same way the research page does — but from the
nightly-stored ``research_ratings.db`` values, so the screener needs NO yfinance.
"""
from api.services.research import ratings_db
from api.services.research.ratings import (
    _band, _value_score, _smr, _accdis_letter, _letter, _composite,
    _RS_BANDS, _EPS_BANDS, _GROWTH_BANDS,
)


def load_distributions():
    try:
        return ratings_db.get_distributions() or {}
    except Exception:
        return {}


def ratings_fields(metrics: dict | None, dists: dict | None) -> dict:
    """Given one ticker's stored raw metrics (+ universe distributions), return
    a dict keyed by snapshot columns, including computed uct_composite/rs_rank.
    Returns {} when nothing is available."""
    if not metrics:
        return {}
    dists = dists or {}

    def _pct(metric, val, invert=False):
        if val is None or not dists:
            return None
        return ratings_db.percentile(metric, val, dists, invert=invert)

    out = {}
    # passthrough raw metrics -> snapshot columns
    direct = {
        "eps_growth": "earnings_growth", "rev_growth": "rev_growth",
        "peg": "peg", "pe_fwd": "pe_fwd", "op_margin": "op_margin",
        "roe": "roe", "inst_pct": "inst_pct", "rs_return": "rs_return",
        "sector": "sector",
    }
    for col, src in direct.items():
        if metrics.get(src) is not None:
            out[col] = metrics[src]

    # ── composite (mirrors ratings.get_ratings percentile path) ──
    rs_ret = metrics.get("rs_return")
    rs = _pct("rs_return", rs_ret) or (_band(rs_ret, _RS_BANDS) if rs_ret is not None else None)

    eps_g = metrics.get("earnings_growth")
    eps = _pct("earnings_growth", eps_g) or (_band(eps_g, _EPS_BANDS) if eps_g is not None else None)

    gro = metrics.get("blended_growth")
    growth = _pct("blended_growth", gro) or (_band(gro, _GROWTH_BANDS) if gro is not None else None)

    peg = metrics.get("peg")
    value = _pct("peg", peg, invert=True) if (peg is not None and peg > 0) else None
    if value is None:
        value = _value_score(peg, metrics.get("pe_fwd"))

    rev_g, op_m, roe = metrics.get("rev_growth"), metrics.get("op_margin"), metrics.get("roe")
    smr_parts = [p for p in (_pct("rev_growth", rev_g), _pct("op_margin", op_m),
                             _pct("roe", roe)) if p is not None]
    if smr_parts:
        smr_n = round(sum(smr_parts) / len(smr_parts))
    else:
        smr_n, _ = _smr(rev_g, op_m, roe)

    ad_r = metrics.get("accdis_ratio")
    ad_pct = _pct("accdis_ratio", ad_r)
    accdis = _letter(ad_pct) if ad_pct is not None else _accdis_letter(ad_r)
    if accdis is not None:
        out["accdis"] = accdis

    if rs is not None:
        out["rs_rank"] = int(rs)
    composite = _composite(eps, rs, growth, value, smr_n, accdis)
    if composite is not None:
        out["uct_composite"] = composite
    return out
