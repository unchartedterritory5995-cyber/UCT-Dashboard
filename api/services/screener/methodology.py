"""How the composite columns are computed — published, in the product.

WHY THIS MODULE EXISTS
======================
Benchmark metric 552, in family 32 (honesty / transparency) — the family we
finished LAST of thirteen in. Zacks publishes a definition, a measured
"Reasonable Range" and the universe average on all 136 of its criteria; Stock
Rover ships a 182-page metric reference and an in-product Metric Browser; Koyfin
publishes a formula-level data dictionary. We ship `uct_composite`, `rs_rank`,
`accdis`, `sponsorship` and four rating components and publish the method for
none of them.

⭐ THE SCORECARD'S SHARPEST LINE ABOUT US IS ABOUT THESE COLUMNS: *"the
composites the benchmark already scored LACKS for having no published
methodology are ALSO the ones we cannot check — a member must simply trust them,
and so must we."* This is the first half of that debt.

⛔ EVERYTHING NUMERIC HERE IS READ FROM THE COMPUTATION AT CALL TIME, NEVER
RETYPED AND NEVER BOUND AT IMPORT. `_COMPOSITE_WEIGHTS`, `_RS_BANDS`,
`_EPS_BANDS` and `_GROWTH_BANDS` are reached through the `ratings` MODULE on
every request, so a re-weighting moves the published document on the same
deploy that moves the computation. A published methodology that could drift
from the code it describes is worse than none: it is a claim the member CAN
check, that is wrong. That is this repo's most repeated defect, and it would be
especially cruel in the one file whose entire purpose is telling the truth
about a number. `test_the_published_weights_ARE_the_live_constant` proves it by
MOVING the real constant and watching this document follow.

WHAT IT DELIBERATELY DOES NOT DO
================================
⚠️ It does not claim the composite is comparable across tickers. It is not, and
`ratings._coverage` says why in its own docstring: the weighted mean is
renormalised over the components that EXIST, so a name missing its EPS rating —
one in five, sampled live — renders a score built on 75% of the intended basis,
typeset identically to a fully-informed one. That caveat is published here as a
first-class field rather than a footnote, because it is the single most
important thing a member can know about the number.
"""
from __future__ import annotations

from api.services.research import ratings as _ratings

# ⛔ THE CONSTANTS ARE READ AT CALL TIME, NEVER BOUND AT IMPORT. A
# `from ... import _COMPOSITE_WEIGHTS` here would capture the tuple as it stood
# when this module first loaded, so a re-weighting would move the computation
# and leave the PUBLISHED document showing the old split — the exact drift this
# file exists to make impossible, in the one file that exists to prevent it.
# `scan_store`'s header states the same rule about database paths.


def _weights():
    return _ratings._COMPOSITE_WEIGHTS

#: What each composite component MEASURES, in a member's words. ⛔ Prose only —
#: every number beside it is read from the computation above. Keyed by the same
#: component keys `_COMPOSITE_WEIGHTS` uses, so a component added there without
#: a description here is a KeyError at build time rather than a silent blank.
#:
#: 🔴 CORRECTED 2026-10-18 (screener column audit). Three of these said "mapped
#: through a fixed band table". Measured on the prod snapshot, 178 of 2,482
#: `rating_eps` values and 234 of 3,273 `rating_growth` values sit on a band
#: score — the other ~93% are universe PERCENTILES, because
#: `enrich.ratings_fields` ranks against the ratings store's distribution first
#: and reaches for the band table only when no distribution exists. The prose
#: now says what the code does; `test_the_ratings_are_percentiles_first` holds
#: the claim against the computation.
_COMPONENT_PROSE = {
    "eps": ("EPS rating",
            "Earnings growth — the latest reported quarter against the same "
            "quarter a year earlier — ranked as a 1-99 percentile against the "
            "rated universe. Higher is faster earnings growth."),
    "rs": ("Relative strength",
           "Price performance against the rest of the universe, as a 1-99 "
           "rank. 80 means the stock outperformed 80% of the market. ⚠️ It "
           "is ranked from the ratings store's own copy of the weighted "
           "return, refreshed on a rolling cycle of up to six days, so it can "
           "sit a few points away from the RS Rank column."),
    "growth": ("Growth rating",
               "Earnings growth (60%) and revenue growth (40%) blended — the "
               "Blend Gr column — ranked as a 1-99 percentile against the "
               "rated universe."),
    "smr": ("Sales / Margins / Return",
            "The average of three 1-99 percentiles — revenue growth, operating "
            "margin and return on equity — the quality of the growth rather "
            "than its speed. ⚠️ The margin and return inputs come from the "
            "ratings store's provider (Yahoo), not from the Op Mgn and ROE "
            "columns, which are FMP's, so they can rank differently."),
    "accdis": ("Accumulation / distribution",
               "Whether the stock is being bought or sold on volume, graded "
               "A through E. A means accumulation."),
    "value": ("Value rating",
              "Valuation against the universe: Yahoo's trailing PEG ranked "
              "as an inverted 1-99 percentile (lower PEG scores higher), or a "
              "forward-P/E band when the PEG is not positive. ⚠️ That PEG is "
              "NOT the PEG column, which is FMP's — the two can disagree. It "
              "carries the SMALLEST weight of the six, deliberately — this is "
              "a momentum-first composite and cheapness is a tiebreaker in it, "
              "not a thesis."),
}


def _bands(table):
    """A band table as `[{threshold, score}]`, newest-first as stored.

    ⚠️ Rendered as pairs rather than prose because the pairs ARE the rule: a
    sentence like "roughly 40% growth scores in the high nineties" is an
    approximation of a table that is exact, and approximating our own arithmetic
    to a member is how a published methodology stops being checkable.
    """
    return [{"at_least": float(t), "score": int(s)} for t, s in table]


def composite_method() -> dict:
    """`uct_composite` — the weights, the bands and the renormalisation."""
    weights = _weights()
    total = sum(w for _k, w in weights)
    components = []
    for key, weight in weights:
        label, what = _COMPONENT_PROSE[key]
        components.append({
            "key": key,
            "label": label,
            "measures": what,
            "weight": weight,
            # The share is DERIVED from the live weights, so a re-weighting
            # moves the published percentage on the same deploy.
            "share_pct": round(100.0 * weight / total, 1),
        })
    return {
        "column": "uct_composite",
        "label": "UCT Composite",
        "one_line": "A weighted 1-99 blend of six ratings, momentum-first.",
        "scale": "1-99, higher is stronger",
        "components": components,
        "bands": {"rs": _bands(_ratings._RS_BANDS),
                  "eps": _bands(_ratings._EPS_BANDS),
                  "growth": _bands(_ratings._GROWTH_BANDS)},
        # 🔴 THE CAVEAT IS A FIELD, NOT A FOOTNOTE.
        "caveat": (
            "The blend is renormalised over the components a company actually "
            "has, so a missing input is NOT scored as a zero — a company with "
            "no EPS figure is not a company with the worst earnings growth. "
            "The cost of that choice is that the score is computed on a "
            "different basis per company: sampled live across 40 liquid names, "
            "one in five had no EPS rating at all, and EPS carries the "
            "joint-largest weight. Two scores of 72 are therefore not always "
            "the same measurement."),
        "not_claimed": [
            "It is not a price target, a forecast, or a recommendation.",
            "It is not comparable across companies whose basis differs — see "
            "the caveat.",
            "It is recomputed nightly from the 03:00 ET snapshot and is not "
            "an intraday reading.",
        ],
    }


#: The other published composites, each stated as what it IS and what it is NOT.
#: ⚠️ These are DESCRIBED rather than derived because their inputs are not a
#: weight table this module can read — and where that is true it is said so,
#: rather than a formula being invented to look rigorous.
def _rs_terms_prose() -> str:
    """The RS weighting in words, READ FROM `rs_weighted_return.RS_TERMS` at
    call time — the module's own rule, applied to the one formula this file
    used to paraphrase as "trailing return"."""
    from api.services import rs_weighted_return as _rsw   # noqa: PLC0415
    parts = [f"{round(100 * w)}% {label}" for label, _n, w in _rsw.RS_TERMS]
    return ", ".join(parts)


def _percentile_scale() -> str:
    """The bounds `ratings_db._rank` actually emits, measured off the function
    rather than typed: the lowest and highest value in a population."""
    from api.services.research import ratings_db as _rdb   # noqa: PLC0415
    vals = [float(i) for i in range(100)]
    return f"{_rdb._rank(vals, -1.0)}-{_rdb._rank(vals, 1e9)}"


def _other_methods() -> list:
    return [_rs_rank_method(), *_OTHER]


def _rs_rank_method() -> dict:
    return {
        "column": "rs_rank", "label": "RS Rank",
        "one_line": "Price performance rank against the whole universe, 1-99.",
        "scale": "1-99, higher is stronger",
        "how": "Each symbol's weighted return — " + _rs_terms_prose() + " — "
               "is ranked against every other symbol in the ranked universe; "
               "the result is the percentile (the RS Ret column is that "
               "weighted return). 80 means it outperformed 80% of the names "
               "we cover. A missing period is dropped and the remaining "
               "weights rescaled; without a 3-month return there is no rank.",
        "caveat": "The universe is our own coverage list, not the whole "
                  "market, so the rank is relative to what we screen.",
    }


#: 🔴 rs_rank moved into `_rs_rank_method()` (2026-10-18) so its weighting is
#: read from the formula; it said "trailing return", which no single window is.
_OTHER = [
    {
        "column": "accdis", "label": "Accumulation / Distribution",
        "one_line": "Whether the stock is being bought or sold on volume.",
        "scale": "A (accumulation) through E (distribution)",
        "how": "An up/down volume ratio is turned into a percentile against "
               "the universe, and the percentile becomes the letter. When no "
               "percentile is available the ratio is graded directly.",
        "caveat": "⚠️ Two paths produce this letter — the percentile one and "
                  "the direct one — and the grade does not say which was used.",
    },
    {
        "column": "sponsorship", "label": "Sponsorship",
        "one_line": "How institutionally owned the company is, as a grade.",
        "scale": "A through E",
        "how": "Institutional ownership percentage, ranked against the "
               "universe and graded on the percentile.",
        "caveat": "It measures HOW MUCH is held, not whether holders are "
                  "adding or trimming.",
    },
    {
        "column": "sector_rs_pct", "label": "Sector RS",
        "one_line": "Relative strength rank WITHIN the company's own sector.",
        # 🔴 CORRECTED 2026-10-18: this said "0-100 percentile". The prod
        # snapshot's range is 1..99 and `ratings_db._rank` clamps to exactly
        # that; the scale is now measured off `_rank` in `all_methods`.
        "scale": None,
        "how": "The symbol's relative-strength return ranked against the other "
               "members of its sector rather than the whole universe.",
        "caveat": "A high sector rank in a weak sector is still a weak stock "
                  "in absolute terms — read it beside rs_rank, not instead. "
                  "⚠️ It ranks the ratings store's own copy of the RS return, "
                  "refreshed on a rolling cycle of up to six days, so within "
                  "one sector it can order two names differently from the RS "
                  "Ret column beside it.",
    },
]


def all_methods() -> dict:
    """Every composite column we publish, with how it is computed.

    ⭐ THE COMPONENT RATINGS ARE INCLUDED AS FIRST-CLASS ENTRIES rather than
    buried inside the composite, because they are their own screener columns —
    a member can filter on `rating_value` without ever looking at
    `uct_composite`, and an explanation they have to go find is one they do not
    read.
    """
    comp = composite_method()
    out = [comp]
    weights = _weights()
    for key, weight in weights:
        if key in ("rs", "accdis"):
            continue          # published in their own right below / above
        label, what = _COMPONENT_PROSE[key]
        out.append({
            "column": f"rating_{key}",
            "label": label,
            "one_line": what,
            "scale": "1-99, higher is stronger",
            "how": "Ranked as a 1-99 percentile against the rated universe; "
                   "the fixed band table is used only when no universe "
                   "distribution is available. Carried into uct_composite at "
                   f"{round(100.0 * weight / sum(w for _k, w in weights), 1)}% "
                   "of the blend.",
            "caveat": "A missing input is left blank rather than scored zero.",
        })
    for m in _other_methods():
        m = dict(m)
        if m.get("scale") is None:
            m["scale"] = f"{_percentile_scale()} percentile within the sector"
        out.append(m)
    return {
        "methods": out,
        "as_of_note": (
            "Every column here is recomputed by the nightly 03:00 ET build. "
            "None of them is an intraday number."),
    }


def for_column(column):
    """One column's method, or `None` — absence is a real answer."""
    key = str(column or "").strip()
    for m in all_methods()["methods"]:
        if m["column"] == key:
            return m
    return None
