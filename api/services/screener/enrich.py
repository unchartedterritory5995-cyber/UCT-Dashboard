"""Map stored ratings metrics -> screener snapshot columns, and compute the
UCT composite the same way the research page does — but from the nightly-stored
``research_ratings.db`` values, so the screener needs NO yfinance.

🔴 THIS MODULE DOES NOT WRITE ``rs_rank`` OR ``rs_return``, AND THAT IS THE
POINT. It used to. So did ``rs_ranking``, over the same cap universe, with the
same 40/20/20/20 weighted-return formula (compare
``research.ratings._weighted_rs_return`` with ``rs_ranking._compute_returns``) —
two independent computations of ONE value, which is this repo's most repeated
defect. They could not be checked against each other because only one of them
ever ran: ``research_ratings.db`` on this box is **0 bytes** (its only writer,
``ratings_universe.nightly_job``, is registered only under
``RATINGS_PERCENTILE_ENABLED``, default ``0``), so ``rs_rank`` was NULL on
3,708/3,708 rows while ``rs_ranking`` held a live rank for the same names.
The day that flag is flipped, the two would have started disagreeing silently.

⭐ ``rs_ranking`` IS THE AUTHORITY — it is already the ONLY authority for
``groups_gates`` (see its module docstring), it is warmed every 50 min, and
``snapshot_builder`` now reads it. ⛔ Do not reintroduce either key here; a rail
in ``tests/test_scalar_population_rail.py`` asserts this function cannot emit
them even when handed a fully-populated metrics dict.

⚠️ ``rs`` IS STILL COMPUTED BELOW, and must be: it is an INPUT to
``uct_composite``. What changed is that it is no longer also an OUTPUT.

──────────────────────────────────────────────────────────────────────────────
🔴 AND ON 2026-08-09, THREE MORE COLUMNS LEFT BY THE SAME DOOR: ``op_margin``,
``roe``, ``peg``.
──────────────────────────────────────────────────────────────────────────────
This was a LIVE conflict, not the dormant one above. ``fundamentals_bulk`` gets
all three off files it already downloads — ``operatingProfitMarginTTM``,
``returnOnEquityTTM``, ``priceToEarningsGrowthRatioTTM`` — at zero extra
provider cost and for 3,679 of 3,742 names a night. This function claimed the
same three columns from ``research_ratings.db``, and
``RATINGS_PERCENTILE_ENABLED=1`` **on Railway**, so both writers would have run
in production with nothing but the merge order in ``build_row`` deciding which
one a member reads (``ratings_row`` is merged after ``bulk_row``, so THIS path
would have silently won wherever it had a value, and lost wherever it did not —
a column sourced from two providers row by row).

⭐ ``fundamentals_bulk`` IS THE AUTHORITY. Its reasoning is written out there;
the short version is whole-universe nightly coverage, one accounting basis
across ``gross_margin``/``net_margin``/``roa``/``op_margin``/``roe``, and a
paid provider rather than yfinance.

⚠️ ALL THREE ARE STILL READ BELOW, and must be: ``op_margin`` and ``roe`` are
two of the three SMR legs and ``peg`` is the Value leg. ⛔ THEY ARE READ FROM
``metrics`` — the ratings store — NOT from the snapshot row, so nothing about
``uct_composite`` changes. Exactly as with ``rs``: still an input, no longer an
output. ⛔ Do not re-add them to ``direct``;
``test_no_two_screener_sources_write_the_same_column`` derives every source's
key set by RUNNING it and goes red on the overlap.
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
    # ⛔ `rs_return` is DELIBERATELY ABSENT from this map — see the module
    # docstring. `rs_ranking.rs_score` is the same weighted return and is the
    # single authority the builder reads.
    # ⛔ `op_margin`, `roe` and `peg` are DELIBERATELY ABSENT — see the module
    # docstring. They are still READ below, because the SMR and Value legs of
    # the composite are computed from them; they are simply no longer also
    # written as columns. `fundamentals_bulk` is their authority.
    direct = {
        "eps_growth": "earnings_growth", "rev_growth": "rev_growth",
        "pe_fwd": "pe_fwd", "inst_pct": "inst_pct",
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

    # ⛔ NO `out["rs_rank"] = ...` HERE. `rs` feeds the composite and nothing
    # else; the column belongs to `rs_ranking`. See the module docstring.
    composite = _composite(eps, rs, growth, value, smr_n, accdis)
    if composite is not None:
        out["uct_composite"] = composite
    return out
