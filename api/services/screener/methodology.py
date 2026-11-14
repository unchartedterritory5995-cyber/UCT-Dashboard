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
    # The sector floor is read from the code that applies it, never typed.
    from api.services.research import ratings_db as _rdb   # noqa: PLC0415
    fill = {"sector_min": _rdb.SECTOR_MIN_SAMPLE}
    out = []
    for m in _OTHER:
        m = dict(m)
        if isinstance(m.get("caveat"), str) and "{sector_min}" in m["caveat"]:
            m["caveat"] = m["caveat"].format(**fill)
        out.append(m)
    return [_rs_rank_method(), *out]


def _rs_rank_method() -> dict:
    """The RS Rank method, READ FROM THE FLAG that decides which rating the
    column carries (RS split unit U5a). Off: the hourly weighted-return
    percentile, as before. On (``RS_RANK_IBD_ENABLED``): the column is the
    nightly IBD-style RS Rating, the same number as the RS Rating column and
    the chart's UCT RS, with the hourly rank only where a name has no stored
    rating; the prose says so, and says the number moves once a night."""
    from api.services import rs_ranking as _rsr                 # noqa: PLC0415
    if _rsr.rs_rank_ibd_enabled():
        p = _rs_params()
        return {
            "column": "rs_rank", "label": "RS Rank",
            "one_line": "The nightly IBD-style RS Rating, 1-99: one number, the same as "
                        "the chart's UCT RS and the RS Rating column.",
            "scale": f"1-{p['max']}, higher is stronger",
            "how": (f"Since the two were unified, this column IS the RS Rating: over the "
                    f"stock's daily closes, {_ibd_formula_prose(p)}, ranked as a percentile "
                    f"across {_RATED_POPULATION}. It is written once a night by "
                    f"the 04:15 ET rating job and does not move during the session. Where a "
                    f"name has no stored rating for the newest session, the hourly weighted "
                    f"return rank (" + _rs_terms_prose() + ") stands in and the row's "
                    f"source says so."),
            "caveat": ("Ranked against every stock we hold a recent daily price for, about "
                       "6,000 names including warrants, rights, units and thin stocks, as "
                       "Deepvue's rank does; ETFs are not ranked. IBD-style and our own "
                       "calculation, not MarketSurge's number. RS Ret is still the hourly "
                       "weighted return, so this column is no longer its percentile; read RS "
                       "Rating and RS Rank as one number."),
        }
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
        "how": "The RS Ret column, ranked against the other names in the "
               "same sector that we screen rather than the whole universe. It "
               "is recomputed after every nightly build, so within a sector it "
               "always orders names the same way RS Ret does.",
        "caveat": "A high sector rank in a weak sector is still a weak stock "
                  "in absolute terms — read it beside rs_rank, not instead. A "
                  "sector with fewer than {sector_min} ranked names gets no "
                  "Sector RS.",
    },
]


# ── UCT Relative Strength columns (Phase 2a, unit 2a-08) ─────────────────────
# ⛔ THE SAME RULE AS THE COMPOSITE: every number below is READ from the
# collector and the maths at call time — `rs_columns` (the lookback, the EMA
# length, the Mansfield length, the green-on-red window, the slope window, the
# rounding), `relative_strength` (the price tolerance, the red-day threshold),
# `rs_weighted_return` (the IBD-style term table) and `rs_history` (the rating
# ceiling) — so a re-tuned window moves this document on the same deploy.
# `test_the_rs_methods_are_read_from_the_collector` proves it by MOVING one.

#: The measured difference between our IBD-style rating and MarketSurge's,
#: from fixture set 2 (plan §7 item 17: "the measured difference to MarketSurge
#: from fixture set 2 is printed once known"). ⛔ `None` until it is MEASURED;
#: the prose says "not yet measured" rather than quoting the field's "±3-5
#: points", which the audit struck from member copy (plan §6.12).
RS_RATING_VS_MARKETSURGE: str | None = None

RS_FAMILY = "uct_relative_strength"


def _rs_params() -> dict:
    from api.services import relative_strength as _rs           # noqa: PLC0415
    from api.services import rs_weighted_return as _rsw         # noqa: PLC0415
    from api.services.screener import rs_columns as _rsc        # noqa: PLC0415
    from api.services.screener import rs_history as _rsh        # noqa: PLC0415
    return {
        "lookback": _rsc.LOOKBACK, "ma": _rsc.MA_LENGTH, "ma_type": _rsc.MA_TYPE,
        "mansfield": _rsc.MANSFIELD_LENGTH, "window": _rsc.GREEN_ON_RED_WINDOW,
        "agree": _rsc.AGREE_WINDOW, "dp": _rsc.MANSFIELD_DP,
        "tol": _rs.DEFAULT_PRICE_TOLERANCE_PCT, "red": abs(_rs.DEFAULT_RED_DAY_PCT),
        "terms": _rsw.IBD_TERMS, "components": _rsw.IBD_COMPONENTS,
        "long_terms": dict(_rsw.IBD_STYLE_COMPONENT_TERMS),
        "equal_terms": dict(_rsw.EQUAL_WEIGHT_COMPONENT_TERMS),
        "required": _rsw.IBD_REQUIRED_TERM, "max": _rsh.RATING_MAX,
    }


def _long_blend_prose(terms) -> str:
    """The recency weighting of a long component rank in words, READ FROM
    `rs_weighted_return.IBD_STYLE_COMPONENT_TERMS` (one row of it): "the close
    over the close 63 sessions earlier (weight 2) and 126 sessions earlier (weight 1)"."""
    parts = [f"{n} sessions earlier (weight {w})" for n, w in terms]
    if len(parts) == 1:
        return "the close over the close " + parts[0]
    return "the close over the close " + ", ".join(parts[:-1]) + " and " + parts[-1]


def _equal_blend_prose(terms) -> str:
    """The equal weighting of the 3M component rank in words, READ FROM
    `rs_weighted_return.EQUAL_WEIGHT_COMPONENT_TERMS` (its row): "the close over the
    close 21, 42 and 63 sessions earlier"."""
    bars = sorted(n for n, _w in terms)
    parts = [str(n) for n in bars]
    joined = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]
    return f"the close over the close {joined} sessions earlier"


def _ibd_formula_prose(p: dict) -> str:
    parts = [f"{round(100 * w)}% of the close over the close {n} sessions earlier"
             for _label, n, w in p["terms"]]
    required = next(n for label, n, _w in p["terms"] if label == p["required"])
    return (", ".join(parts) + f"; a term the history cannot supply is dropped and "
            f"the surviving weights rescaled, and the {required}-session term is "
            f"required (without it there is no rating)")


_RS_BAR_NOTE = ("Daily bars only, measured at the last completed session, from the same "
                "`relative_strength` functions the chart's UCT RS line draws, so a scan and a "
                "chart dot never disagree. Blank, never 0, when the window is short, SPY has no "
                "bar at the row's date, or a hole sits inside the lookback.")
#: Who the nightly rating is ranked against (2026-11-12, owner: "everything"): every stock
#: holding a recent daily price, ETFs excluded (about 6,000 names), NOT the 3,418-name cap
#: universe the hourly RS Rank still ranks. Warrants, rights, units and thin names stay in,
#: as they do in Deepvue's rank: against 61 of its readings this population sits 0.1
#: points from it on average, the cap universe sat 5 to 8 points below.
_RATED_POPULATION = "every stock with a recent daily price, ETFs excluded"

_RS_RATING_NOTE = ("Written by the 04:15 ET rating job AFTER the 03:00 ET screener build and "
                   "read by the NEXT build, so the row carries the rating as of the session "
                   "before its bars date. Blank when the job has not rated the name: a dark "
                   "job, a name outside the rated population, or too few stored sessions.")


#: Unit 3-11: what every Phase 3 entry says about when it fills.
_RS_PHASE3_NOTE = ("Empty until the nightly build fills it: the 03:00 ET build writes this column "
                   "only while its Phase 3 step is switched on, and until then every row is blank "
                   "and the screener does not offer the control. Computed from the same daily bars "
                   "and the same `relative_strength` functions the chart uses.")


def _rs_phase3_params() -> dict:
    from api.services import relative_strength as _rs           # noqa: PLC0415
    from api.services.screener import rs_columns as _rsc        # noqa: PLC0415
    return {
        "ratio": _rsc.RRG_RATIO_LEN, "mom": _rsc.RRG_MOM_LEN,
        "quadrants": tuple(_rs.RRG_QUADRANT_NAMES),
        "clenow": _rsc.CLENOW_WINDOW, "clenow_dp": _rsc.CLENOW_DP,
        "annual": _rs.CLENOW_ANNUALISATION_BARS,
        "atr": _rs.DEFAULT_ATR_LENGTH, "vars_look": _rs.DEFAULT_VARS_LOOKBACK,
        "vars_ma": _rs.DEFAULT_VARS_MA_LENGTH, "states": tuple(_rsc.VARS_STATE_NAMES),
        "min": dict(_rsc.PHASE3_MIN_BARS),
    }


def _rrg_formula_prose(q: dict) -> str:
    """Decision D1: the Terminal's formula, printed (`relative_strength.rrg_columns`)."""
    return (f"RS = 100 x C / B; RS-Ratio = 100 x RS / SMA(RS, {q['ratio']}); RS-Momentum = "
            f"100 x RS-Ratio / SMA(RS-Ratio, {q['mom']}); the quadrants split at 100 on both axes")


def _rs_phase3_methods() -> list:
    """Unit 3-11: the three Phase 3 columns (`rs_columns.PHASE3_COLUMNS`), every
    number read from the writer so the page cannot drift from it."""
    q = _rs_phase3_params()
    lead, weak, lag, imp = q["quadrants"]
    s_rise, s_fade, w_imp, w_fall = q["states"]
    return [
        {"column": "rrg_quadrant", "label": "Rotation Quadrant vs SPY (weekly)",
         "one_line": "Which of the four rotation quadrants the stock sits in against SPY, on weekly bars.",
         "scale": " | ".join(q["quadrants"]),
         "how": (f"RRG-style, UCT's formula, the one the Terminal's rotation graph draws, on WEEKLY "
                 f"bars resampled from the daily closes (SPY resampled the same way). With C the "
                 f"stock's weekly close and B SPY's for the same week: {_rrg_formula_prose(q)}, "
                 f"and 100 itself counts as the upper side. {lead}: RS-Ratio and "
                 f"RS-Momentum both at or above 100. {weak}: RS-Ratio at or above 100, RS-Momentum "
                 f"below. {lag}: both below 100. {imp}: RS-Ratio below 100, RS-Momentum at or "
                 f"above. Only weeks both series have are compared. Blank until "
                 f"{q['min']['rrg_quadrant']} joined weeks exist. " + _RS_PHASE3_NOTE),
         "caveat": ("RRG-style, not StockCharts' Relative Rotation Graph: its JdK RS-Ratio and "
                    "RS-Momentum use a normalisation that is not published, so the same stock can "
                    "sit in a different quadrant there. The quadrant describes the past weeks' "
                    "rotation against SPY, not the next one.")},
        {"column": "clenow_score", "label": "Clenow Trend Score (90 days)",
         "one_line": (f"How fast and how steadily price has trended over the last {q['clenow']} "
                      f"trading days, in one number."),
         "scale": (f"a fraction, signed, {q['clenow_dp']} places (0.50 is a 50%-a-year pace after "
                   f"the R-squared discount)"),
         "how": (f"Clenow-style, {q['clenow']} trading days: a straight line is fitted through the "
                 f"natural log of the last {q['clenow']} daily closes (least squares on the bar "
                 f"number). Its slope b is compounded to a yearly rate, (1 + b)^{q['annual']} - 1, "
                 f"and multiplied by the fit's R-squared (0 to 1, how closely the closes follow the "
                 f"line): score = annualised slope x R-squared, a FRACTION rounded to "
                 f"{q['clenow_dp']} places, negative when the line slopes down. Blank until "
                 f"{q['min']['clenow_score']} closes exist, or when the window is perfectly flat "
                 f"(no R-squared exists). " + _RS_PHASE3_NOTE),
         "caveat": ("Clenow-style: our own computation of the score from Andreas Clenow's Stocks on "
                    "the Move. His method also applies rules this column does not (an index "
                    "filter, a 100-day average, a check for a gap over 15%). A high score describes "
                    "the last 90 sessions' trend; it says nothing about the next session, and it "
                    "can sit on a stock that is already extended.")},
        {"column": "vars_state", "label": "Volatility-Adjusted RS State",
         "one_line": ("Whether the stock has out-moved SPY once each day's move is scaled by its "
                      "own volatility, and which way that reading is heading."),
         "scale": " | ".join(q["states"]),
         "how": (f"VARS-style (OANDA's volatility-adjusted relative strength), on DAILY bars against "
                 f"SPY: each session's change is divided by that series' own {q['atr']}-session "
                 f"Wilder ATR (SPY's change by SPY's ATR), and VARS is the stock's sum minus SPY's "
                 f"sum over the last {q['vars_look']} sessions both have. The state compares VARS "
                 f"with its own {q['vars_ma']}-session simple average. {s_rise}: VARS above 0 and "
                 f"above its average. {s_fade}: above 0, at or below its average. {w_imp}: below "
                 f"0, above its average. {w_fall}: below 0, at or below its average. A VARS of "
                 f"exactly 0 has no state. Blank until {q['min']['vars_state']} sessions exist. "
                 + _RS_PHASE3_NOTE),
         "caveat": (f"VARS-style: our own computation of OANDA's published form. The "
                    f"{q['vars_look']}-session lookback is UCT's setting and the "
                    f"{q['vars_ma']}-session average follows OANDA's case studies, so another "
                    f"tool's VARS can differ. Strong and weak describe the past against SPY, not "
                    f"a forecast.")},
    ]


#: RS Exit Warnings (2026-11-13): what every entry says about where the warning comes from.
_RS_EXIT_NOTE = ("Mike Webster's method, our reading of it: the same rules and the same "
                 "`relative_strength` functions the chart's UCT RS Exit Warnings draw, on daily "
                 "bars against SPY, closed bars only. A warning is a prompt to review the "
                 "position, not an order to sell. " + _RS_BAR_NOTE)


def _rs_exit_params() -> dict:
    from api.services import relative_strength as _rs           # noqa: PLC0415
    from api.services.screener import rs_columns as _rsc        # noqa: PLC0415
    return {"fast": _rsc.EXIT_FAST, "slow": _rsc.EXIT_SLOW, "min": _rsc.EXIT_MIN_BARS,
            "names": tuple(_rsc.EXIT_NAMES),
            "worst_first": tuple(_rs.RS_EXIT_LABELS[k] for k in _rs.RS_EXIT_SEVERITY)}


def _rs_exit_methods() -> list:
    """The five RS Exit Warning columns (`rs_columns.EXIT_COLUMNS`), every number and
    name read from the writer so the page cannot drift from it."""
    e = _rs_exit_params()
    quick, sand, dead = e["names"]
    f, sl = e["fast"], e["slow"]
    age = "sessions, 0 = the last session"
    rules = (f"{quick}: the RS line closes below its {f}-session simple average after "
             f"closing at or above it. {sand}: later in the same dip (before the RS line closes "
             f"back at or above its {f}-session average), the RS line closes below its value on "
             f"the {quick} session; once per dip. {dead}: the RS line closes below its "
             f"{sl}-session simple average after closing at or above it; it needs no {quick} "
             f"first. The averages are simple averages of the RS line itself, not of price.")
    return [
        {"column": "rs_exit_last", "label": "RS Exit Warning (latest)",
         "one_line": "The newest of Mike Webster's three RS-line exit warnings the stock has flashed.",
         "scale": " | ".join(e["names"]),
         "how": (f"{rules} This column names the newest warning in the window; when two fire on "
                 f"the same session the worse one is named (worst first: "
                 f"{', '.join(e['worst_first'])}). Blank when none has fired, or until {e['min']} "
                 f"sessions exist. " + _RS_EXIT_NOTE),
         "caveat": ("The newest warning hides an older one: a Grateful Dead Break yesterday is "
                    "named even if a Quicksand came three sessions ago. Screen a single warning "
                    "with its own age column.")},
        {"column": "rs_exit_bars_ago", "label": "RS Exit Warning Age (sessions)",
         "one_line": "Sessions since the newest RS-line exit warning, whichever it was.",
         "scale": age,
         "how": (f"0 on the session the newest Quick Break, Quicksand or Grateful Dead Break "
                 f"fired, one more on every session after; blank when none has fired or until "
                 f"{e['min']} sessions exist. \"Any exit warning in the last 10 sessions\" is "
                 f"this column from 0 to 9. " + _RS_EXIT_NOTE),
         "caveat": ("The count keeps running after the RS line recovers above its averages, so "
                    "an old warning the line has since repaired still carries an age.")},
        {"column": "rs_quick_break_bars_ago", "label": "Quick Break Age (sessions)",
         "one_line": f"Sessions since the RS line last broke below its {f}-day average.",
         "scale": age,
         "how": (f"0 on the session of the last {quick}, one more on every session after; "
                 f"blank when none has fired or until {e['min']} sessions exist. {rules} "
                 + _RS_EXIT_NOTE),
         "caveat": "The first and mildest warning; many are repaired within days."},
        {"column": "rs_quicksand_bars_ago", "label": "Quicksand Age (sessions)",
         "one_line": "Sessions since the RS line last undercut its own Quick Break level.",
         "scale": age,
         "how": (f"0 on the session of the last {sand}, one more on every session after; blank "
                 f"when none has fired or until {e['min']} sessions exist. \"{sand} in the last "
                 f"5 sessions\" is this column from 0 to 4. {rules} " + _RS_EXIT_NOTE),
         "caveat": (f"A {sand} needs a {quick} before it in the same dip; a dip that began "
                    f"before the window or across a missing benchmark bar has none to measure "
                    f"from, so a warning can be missed, never invented.")},
        {"column": "rs_dead_break_bars_ago", "label": "Grateful Dead Break Age (sessions)",
         "one_line": f"Sessions since the RS line last broke below its {sl}-day average.",
         "scale": age,
         "how": (f"0 on the session of the last {dead}, one more on every session after; blank "
                 f"when none has fired or until {e['min']} sessions exist. {rules} "
                 + _RS_EXIT_NOTE),
         "caveat": "The most serious of the three, and still a warning about the past, not a forecast."},
    ]


#: RS screens (unit U1, 2026-11-14): what every entry says about when it fills.
_RS_SCREENS_NOTE = ("Empty until the RS screens are switched on: only then does a pass after "
                    "each screener build, and again after the 04:15 ET rating job, fill this "
                    "column, and until then every row is blank and the screener does not offer "
                    "the control.")


#: RS screens (unit U4): the same statement for the thirteen columns the nightly
#: build itself writes (`snapshot_builder.build_row`), not the pass.
_RS_SCREENS_BUILD_NOTE = ("Empty until the RS screens are switched on: only then does the nightly "
                          "screener build fill this column, and until then every row is blank and "
                          "the screener does not offer the control.")


def _money_words(v: float) -> str:
    """`20000000.0` -> `$20M`, `10.0` -> `$10`: a floor read from its constant, in words."""
    v = float(v)
    if v >= 1_000_000:
        return f"${v / 1_000_000:g}M"
    return f"${v:g}"


def _rs_screens_params() -> dict:
    from api.services.screener import rs_post_pass as _pp       # noqa: PLC0415
    return {"price": _money_words(_pp.LIQUID_FLOOR["price_min"]),
            "dollar_vol": _money_words(_pp.LIQUID_FLOOR["dollar_vol_30d_min"]),
            "prev": _pp.PREV_SESSIONS, "keep": _pp.POS_KEEP_SESSIONS,
            "periods": tuple(col for col, _v in _pp.PERIOD_PLACES)}


def _rs_screens_methods() -> list:
    """The RS screens columns: the ten the rating pass writes
    (`rs_post_pass.OWNED_COLUMNS`) and the thirteen the build writes
    (`rs_columns.SCREEN_COLUMNS`, `snapshot_builder.RS_SETUP_COLUMNS`). The floor, the
    windows and every threshold are read from the writer so the page cannot drift."""
    s = _rs_screens_params()
    liquid = (f"not a fund, price {s['price']} or more, {s['dollar_vol']} or more traded a day "
              f"on a 30-day average")
    floor = f"{liquid}, and a full year of price history"
    place = "a place, 1 = the strongest"
    ties = ("Stocks with the same value are ordered by their 3-month value, then by dollar "
            "volume, then alphabetically, so no two share a place.")
    not_forecast = ("A place is a rank of past return, not a forecast, and it can change when "
                    "other stocks move even if this one does not.")
    out = [
        {"column": "rs_rating_session", "label": "Ratings as of",
         "one_line": "The market session the RS Rating columns on this row describe.",
         "scale": "a date",
         "how": ("The rating job scores each completed session at 04:15 ET the next morning. "
                 "Once that session is stored, the RS Rating, its 5- and 20-session change and "
                 "the 1, 3, 6, 9 and 12-month ranks on every row are refreshed to it, and this "
                 "column shows its date. Blank when the stock has no rating for that session, "
                 "and between the 03:00 ET build and the rating job on a row whose ratings "
                 "cannot be matched to a stored session. " + _RS_SCREENS_NOTE),
         "caveat": ("It dates the rating columns only. Price and the columns computed from "
                    "daily bars carry the row's own bar date.")},
        {"column": "rs_rating_score", "label": "RS Rating score",
         "one_line": "The unrounded weighted return the RS Rating is a rank of.",
         "scale": "a ratio, 1.00 = no change over the weighted year",
         "how": ("The same weighted close ratio the IBD-style RS Rating ranks, kept to six "
                 "decimal places for the session named in Ratings as of. Dozens of stocks share "
                 "each rating from 1 to 99; this is the number that tells them apart. Blank "
                 "when the stock has no rating. " + _RS_SCREENS_NOTE),
         "caveat": ("It orders stocks, it is not a return to quote: the windows overlap and "
                    "the newest quarter counts double. A higher score is a stronger past year, "
                    "not a forecast.")},
        {"column": "rs_rating_pos", "label": "RS Rating place",
         "one_line": ("Where this stock ranks by RS Rating among liquid stocks: 1 is the "
                      "strongest."),
         "scale": place,
         "how": (f"Liquid stocks ({floor}) are ordered by the RS Rating score, highest first. "
                 f"{ties} Blank for a stock that is off that list or has no rating for the "
                 f"session. " + _RS_SCREENS_NOTE),
         "caveat": not_forecast},
        {"column": "rs_rating_pos_n", "label": "Stocks ranked",
         "one_line": "How many liquid stocks the RS Rating place is out of.",
         "scale": "a count of stocks",
         "how": (f"The number of stocks ranked for the session: {floor}. The same number on "
                 f"every ranked row, so a place reads as \"14 of 1,931\". Blank on a row with "
                 f"no place. " + _RS_SCREENS_NOTE),
         "caveat": ("It changes a little each session as stocks cross the price and volume "
                    "floors, so the same place can mean a slightly different share of the "
                    "list.")},
        {"column": "rs_rating_pos_prev20", "label": "Place a month ago",
         "one_line": (f"The stock's RS Rating place {s['prev']} stored sessions earlier."),
         "scale": place,
         "how": (f"Each session's places are kept ({s['keep']} sessions of them), and this "
                 f"column reads the place stored {s['prev']} sessions before the one named in "
                 f"Ratings as of. Blank until {s['prev']} earlier sessions are stored, and for "
                 f"a stock that was off the liquid list that day or is off it now. "
                 + _RS_SCREENS_NOTE),
         "caveat": ("The list itself was a different size that day, so compare places with "
                    "care near the bottom. A climb is partly stocks bouncing back, so it is a "
                    "list to study, not a signal.")},
    ]
    words = {"rs_pos_1m": ("1M place", "1-month", "1M Return Rank"),
             "rs_pos_3m": ("3M place", "3-month", "3M Return Rank"),
             "rs_pos_6m": ("6M place", "6-month", "6M Return Rank"),
             "rs_pos_12m": ("12M place", "12-month", "12M Return Rank")}
    for col in s["periods"]:
        label, span, rank = words[col]
        out.append({
            "column": col, "label": label,
            "one_line": (f"Where this stock ranks on its {span} return among liquid stocks: "
                         f"1 is the strongest."),
            "scale": place,
            "how": (f"Liquid stocks ({liquid}) are ordered by the value the {rank} is taken "
                    f"over, highest first. Unlike the RS Rating place this list does not need a "
                    f"full year of price history, so a newer listing is ranked here and the "
                    f"list can be longer than Stocks ranked. {ties} Blank for a stock off that "
                    f"list, for one with no value for the window, and for a session stored "
                    f"before these values were kept. " + _RS_SCREENS_NOTE),
            "caveat": ("A single-window place reacts faster and flips more often than the "
                       "overall one. " + not_forecast)})
    out.extend(_rs_screens_build_methods(s))
    return out


def _rs_screens_build_methods(s: dict) -> list:
    """The rating a month ago, and the thirteen columns the build writes (unit U4)."""
    from api.services.screener import filters as _f                 # noqa: PLC0415
    from api.services.screener import rs_columns as _rc             # noqa: PLC0415
    from api.services.screener import rs_setup as _st               # noqa: PLC0415
    from api.services.screener import snapshot_builder as _sb       # noqa: PLC0415
    p = _rs_params()
    lb, red, tol = p["lookback"], p["red"], p["tol"]
    count_win, nhbp_win = _rc.SCREEN_NH_COUNT_WINDOW, _rc.SCREEN_NHBP_WINDOW
    prev = s["prev"]
    rules = _rs_setup_rules()
    note, pass_note = _RS_SCREENS_BUILD_NOTE, _RS_SCREENS_NOTE
    flag = "0 or 1 (1 = yes)"
    age = "sessions, 0 = the last session"
    high = "52-week high"
    contradicts = "for a stock whose price history contradicts itself"

    def label(key):
        return _f.FILTERS[key]["label"]

    out = [
        {"column": "rs_rating_prev20",
         "one_line": f"The stock's RS Rating {prev} stored sessions earlier.",
         "scale": f"1-{p['max']}, higher is stronger",
         "how": (f"The RS Rating for the session named in Ratings as of, minus its change over "
                 f"{prev} stored sessions: the rating that was stored {prev} sessions before. "
                 f"Blank until {prev + 1} sessions of ratings are stored, and for a stock with no "
                 f"rating on either day. " + pass_note),
         "caveat": ("A rating that climbed means the stock passed other stocks, not that its "
                    "price rose. A climb is partly stocks bouncing back.")},
        {"column": "rs_nh_count_20",
         "one_line": (f"On how many of the last {count_win} sessions the RS line against SPY "
                      f"closed at a {high}."),
         "scale": f"a count, 0 to {count_win}",
         "how": (f"Counts the sessions, among the last {count_win}, on which the RS line (the "
                 f"close divided by SPY's close) closed above its highest close of the prior {lb} "
                 f"sessions, the same RS new high the chart's dot marks. Blank until the stock "
                 f"has the {lb + 1} daily bars the first such test needs, and when SPY has no bar "
                 f"for the newest session. " + note),
         "caveat": ("A count of past sessions. Several highs in a month say the stock kept "
                    "outpacing the index. They do not say it will.")},
        {"column": "rs_nh_quiet",
         "one_line": f"Sessions between the newest RS line {high} and the one before it.",
         "scale": "sessions, 1 = highs on back-to-back sessions",
         "how": (f"Finds the newest session the RS line closed at a {high} and counts back to "
                 f"the one before it. A large number means the newest high was the first in a "
                 f"long while. Blank when the bars read hold fewer than two such highs, and when "
                 f"a session in between could not be judged. " + note),
         "caveat": ("It does not say how long ago the newest high was. Read it beside RS New "
                    "High Age.")},
        {"column": "rs_nh_red_bars_ago",
         "one_line": (f"Sessions since the RS line last closed at a {high} on a market down "
                      f"day."),
         "scale": age,
         "how": (f"A market down day is a session SPY closed down {red:g}% or more. This is the "
                 f"age of the newest session that was both an RS line {high} and a market down "
                 f"day, 0 on that session. Blank when the bars read hold no such session. "
                 + note),
         "caveat": ("Holding up on a weak day is a house reading with no published test, and "
                    "one session is one observation.")},
        {"column": "rs_nhbp_age",
         "one_line": f"Sessions since an RS line {high} that price has not yet followed.",
         "scale": age,
         "how": (f"The age of the newest RS line {high} since which price has not closed within "
                 f"{tol:g}% of its own {lb}-session closing high, 0 on the session of that RS "
                 f"high. Blank once price reaches its high, when no such RS high came in the "
                 f"last {nhbp_win} sessions, and when a session in between could not be judged. "
                 + note),
         "caveat": ("The RS line leading price is a trader's rule with no published test. Price "
                    "may never follow.")},
        {"column": "rs_nh_span",
         "one_line": f"On a session the RS line is at a {high}: how long a high it is.",
         "scale": "sessions",
         "how": (f"Only when the newest session is an RS line {high}: the number of sessions "
                 f"back to the nearest earlier close of the RS line at or above today's, over "
                 f"the {_sb.RS_WINDOW_BARS} sessions the build reads. When none is that high it "
                 f"equals the number of bars read, and then means at least that long. Blank on "
                 f"every other session. " + note),
         "caveat": "It is capped by the bars read, so a very long high reads as the cap."},
        {"column": "px_below_high_pct",
         "one_line": (f"The last close against the stock's highest close of the past {lb} "
                      f"sessions."),
         "scale": "a percent, 0 at the high and negative below it",
         "how": (f"(close / highest close of the last {lb} sessions, today included, minus 1) x "
                 f"100, to {_rc.PX_BELOW_HIGH_DP} decimals. Closing prices only, so it can differ "
                 f"from Dist from 52W High. Blank until {lb} closes exist, when a close in the "
                 f"window is missing, and {contradicts}. " + note),
         "caveat": ("Closeness to a high is a description. A stock 3% under its high can as "
                    "easily be rolling over as setting up.")},
        {"column": "rs_setup",
         "one_line": "Where price sits against its own averages, as one of six labels.",
         "scale": "; ".join(x["label"] for x in rules["labels"]),
         "how": (rules["order"] + " " + rules["atr"] + " "
                 + " ".join(f"{x['label']}: {x['rule']}" for x in rules["labels"])
                 + f" Blank when a measure the rules need cannot be computed, and {contradicts}; "
                 f"a blank is never replaced by the next label down. " + note),
         "caveat": ("A label describes the chart at the last close. It is not a recommendation, "
                    "and the house thresholds in it have no published test.")},
        {"column": "rs_tight",
         "one_line": "The Setup label's second tag: the recent closes sit in a tight range.",
         "scale": flag,
         "how": ("A copy of the Tight Consolidation column as the Setup label read it on the "
                 f"same build. Blank when that column is blank, and {contradicts}. " + note),
         "caveat": ("Tight is measured against the stock's own recent closes. It says nothing "
                    "about direction.")},
        {"column": "rs_flag",
         "one_line": "A caution beside the Setup label, the first that applies.",
         "scale": "; ".join(x["label"] for x in rules["flags"]),
         "how": (" ".join(f"{x['label']}: {x['rule']}" for x in rules["flags"])
                 + f" Blank when none applies, and {contradicts}. " + note),
         "caveat": ("Buyout pending is read from price alone, with no news behind it, so a "
                    "quiet stock after a large one-day jump can carry it. A flag is a prompt to "
                    "look at the chart.")},
        {"column": "rs_near_buy",
         "one_line": ("Yes when the Setup label is At pivot or a Pullback, or the range is "
                      "tight, with no caution against it."),
         "scale": flag,
         "how": (rules["near"] + " Blank when the stock has no Setup label. " + note),
         "caveat": ("It describes where price sits against its own averages. It is not a "
                    "recommendation.")},
        {"column": "atr_ext_ema21",
         "one_line": "How many ATRs the last close is above the 21-day EMA.",
         "scale": "ATRs, negative below the average",
         "how": ("(close minus the 21-day EMA) divided by the 14-session ATR, to two decimals, "
                 "over the same 400 sessions the other averages read. Blank until both exist, "
                 f"when the stock has no daily range to measure, and {contradicts}. " + note),
         "caveat": (f"The Setup label reads Extended at {_st.EXTENDED_ATR_EMA21:g} or more, a "
                    f"house threshold with no published test.")},
    ]
    for col, n, speed in (("pct_vs_ema8", 8, "reacts within a few sessions, so this number "
                                             "moves quickly"),
                          ("pct_vs_ema21", 21, "is the slower of the two averages the Setup "
                                               "label reads a pullback against")):
        out.append({
            "column": col,
            "one_line": f"The last close against the {n}-day EMA, in percent.",
            "scale": "a percent, positive above the average",
            "how": (f"(close minus the {n}-day EMA) divided by the EMA, x 100, to two decimals. "
                    f"Blank until the average exists, and {contradicts}. " + note),
            "caveat": f"The {n}-day EMA {speed}."})
    for m in out:
        m["label"] = label(m["column"])
    return out


def _pct_words(fraction: float) -> str:
    """`0.05` -> `5%`: a threshold stored as a fraction, in words."""
    return f"{fraction * 100:g}%"


def rs_screens_section() -> dict:
    """The five Relative Strength screens in plain words (RS screens unit U4): each
    screen's rule, the Setup label's rules with their numbers and where each number
    comes from, the liquidity floor, what "Ratings as of" means, and the sentence that
    our RS Rating is our own calculation.

    ⛔ EVERY NUMBER IS READ FROM THE CODE THAT APPLIES IT (`rs_screens`' windows,
    `rs_setup`'s thresholds, `rs_post_pass.LIQUID_FLOOR`, `technicals`' windows), so
    this page cannot state a rule the screens do not run.
    ⛔ NO SUCCESS RATE IS CLAIMED for any screen or label: none has been measured
    (plan section 12), and the Evidence subsection is where a measured number prints.
    Served by `all_methods()` only while RS_SCREENS_ENABLED is on."""
    from api.services.screener import rs_screens as _sc            # noqa: PLC0415
    s = _rs_screens_params()
    week, month, down = _sc.WEEK_AGE + 1, _sc.MONTH_AGE + 1, _sc.DOWN_DAY_AGE + 1
    near, far = -_sc.BELOW_HIGH_NEAR, -_sc.BELOW_HIGH_FAR
    cap = _money_words(_sc.LEADERS_MIN_MARKET_CAP)
    screens = [
        {"id": "starter_rs_top_rating", "name": "Top RS Rating",
         "rule": (
             "Every stock on the liquidity floor that holds an RS Rating place, strongest "
             "first. The order is the unrounded score behind the rating, so stocks that "
             "share a rating are told apart and no two share a place. The overall list needs "
             "a full year of price history. The 1, 3, 6 and 12-month lists need only a value "
             "for that window, so a newer listing appears on the shorter lists."),
         "controls": (
             f"Rank by chooses the list: overall, one window, or Rising fastest (the largest "
             f"gain in RS Rating over 20 stored sessions, among stocks above their 50-day "
             f"line). Show narrows it to RS Rating {_sc.TOP_RATING_LINE} and up, or to stocks "
             f"at {_sc.TOP_RATING_LINE} or higher now that were under {_sc.TOP_RATING_LINE} "
             f"20 stored sessions ago."),
         "caveat": (
             "A rating is a rank of past return, not a forecast. Rising fastest is partly "
             "stocks bouncing back, so read it as a list to study.")},
        {"id": "starter_rs_new_high", "name": "RS New Highs",
         "rule": (
             f"The RS line (the stock's price divided by SPY's, daily closes) closed above "
             f"its highest close of the prior {_pp_lookback()} sessions within the last "
             f"{week} sessions, and the stock closed above its 200-day average. Newest first; "
             f"stocks whose RS high came on the same session are ordered by RS Rating score."),
         "controls": (
             f"When: today, the last {week} sessions, or the last {month}. Min RS Rating. "
             f"Market: Down days only keeps a stock whose RS line made that high within the "
             f"last {down} sessions on a day SPY closed down {_red_day_words()} or more."),
         "caveat": (
             "An RS line can rise while the stock falls, when SPY falls faster. The market "
             "down day reading is a house method with no published test.")},
        {"id": "starter_rs_nh_before_price", "name": "RS New High Before Price",
         "rule": (
             f"The RS line made a 52-week high within the last {week} sessions and price has "
             f"not made its own 52-week closing high since, the stock closed {near}% to "
             f"{far}% below that high, and above its 200-day average. Closest to its high "
             f"first. A stock leaves the list once price makes its high."),
         "controls": (
             f"When: today, the last {week} sessions, or the last {month}. Below its high by: "
             f"at least {', '.join(f'{n}%' for n in _sc.BELOW_HIGH_CHOICES[:-1])} or "
             f"{_sc.BELOW_HIGH_CHOICES[-1]}%. Min RS Rating."),
         "caveat": (
             "The RS line leading price is a trader's rule with no published test. An empty "
             "list is normal in a weak market.")},
        {"id": "starter_rs_leaders", "name": "UCT RS Leaders",
         "rule": (
             f"Stocks on the liquidity floor with an average daily range of "
             f"{_sc.LEADERS_MIN_ADR_PCT}% or more, a market value of {cap} or more, RS Rating "
             f"{_sc.LEADERS_MIN_RATING} or higher, the RS line above its 21-day average, a "
             f"close above a rising 200-day average, and price within "
             f"{-_sc.LEADERS_MAX_BELOW_HIGH}% of its 52-week high. The {_sc.LEADERS_TOP_N} "
             f"with the highest RS Rating score are shown, strongest first."),
         "controls": (
             "Show: all, only stocks near a buy point, or everything except Extended and "
             "Below its 50-day line. Min RS Rating: "
             f"{', '.join(str(n) for n in _sc.LEADERS_RATING_CHOICES)}."),
         "caveat": (
             f"RS Rating {_sc.LEADERS_MIN_RATING} is a convention, not a tested threshold. "
             "The list says which stocks to study, and the Setup label says where each one "
             "sits against its own averages.")},
        {"id": "starter_rs_exit_warning_5", "name": "RS exit warnings",
         "rule": (
             f"The RS line against SPY flashed a Quick Break, a Quicksand or a Grateful Dead "
             f"Break (Mike Webster's warnings, our reading of them) within the last "
             f"{_sc.EXIT_AGE + 1} sessions. Newest first."),
         "controls": "Type keeps one kind of warning.",
         "caveat": "A warning is a prompt to review a position, not an order to sell."},
    ]
    # The setup flags the list screens leave out (unit U6): said on each screen that
    # carries the clause, from the clause's own values and the flag's own words.
    left_out = _left_out_words()
    for screen in screens:
        if left_out and screen["id"] in _sc.NO_BUYOUT_SCREENS:
            screen["rule"] = f"{screen['rule']} {left_out}"
    return {
        "label": "Relative Strength screens",
        "screens": screens,
        "setup": _rs_setup_rules(),
        "floor": (f"Every screen here is stocks only, no funds, with a price of {s['price']} "
                  f"or more and {s['dollar_vol']} or more traded a day on a 30-day average. "
                  f"The benchmark is SPY, on daily closing prices."),
        "ratings_as_of": (
            "Ratings as of names the market session the RS Rating numbers on a row describe. "
            "The rating job scores each completed session at 04:15 ET the next morning. "
            "Between the 03:00 ET screener build and that job the screens keep the previous "
            "session's ratings and places, and this date says so."),
        "rating_note": ("Our RS Rating is our own calculation. It follows IBD's published "
                        "method and can differ from IBD's number by a few points."),
        "honesty": ("Every screen and label here describes the past. Each one says which "
                    "stocks to study, not what will happen next, and none of them is a "
                    "forecast or a recommendation."),
    }


def _left_out_words() -> str:
    """"Stocks flagged Buyout pending are left out." The flags are `rs_screens.
    EXCLUDED_FLAGS` (the values of the screens' own exclude clause) and the words are
    the Setup flag's (`rs_setup.SETUP_LABELS`), so the sentence follows the clause.
    Empty when the screens exclude nothing."""
    from api.services.screener import rs_screens as _sc            # noqa: PLC0415
    from api.services.screener import rs_setup as _st              # noqa: PLC0415
    names = [_st.SETUP_LABELS[k] for k in _sc.EXCLUDED_FLAGS]
    if not names:
        return ""
    return f"Stocks flagged {' or '.join(names)} are left out."


#: The last sentence of both Pullback rules (unit U7): the label is a description.
PULLBACK_IS_A_PLACE = "It marks where the stock is, not what to do."


def _rs_setup_rules() -> dict:
    """The Setup label's rules in plain words, every number read from `rs_setup` and
    `technicals`: one copy for the screens' page and for the `rs_setup`, `rs_flag` and
    `rs_near_buy` column methods."""
    from api.services.screener import rs_setup as _st              # noqa: PLC0415
    from api.services.screener import technicals as _tech          # noqa: PLC0415
    words = _st.SETUP_LABELS
    band = f"{_st.PULLBACK_ATR_BAND:g}"
    zone = _pct_words(_st.IBD_BUY_ZONE)
    # Unit U7 (2026-11-14, polish from the real screens): the plain sentence leads and
    # the numbers follow it. "Pullback to the 8-day" can be read as an instruction, so
    # each of the two rules ends by saying what the label is (`PULLBACK_IS_A_PLACE`).
    pullback = (
        f"The stock made a {_tech.HIGH20_WINDOW}-session high within the last "
        f"{_st.PULLBACK_HIGH_MAX_AGE} sessions and is now trading at its rising {{n}}-day "
        f"average. In numbers: the high is a closing high, and today its low came within "
        f"{band} ATR of a rising {{n}}-day EMA while its close is no more than {band} ATR "
        f"under it. An EMA is rising when it stands above its value "
        f"{_tech.EMA_RISING_SPAN} sessions earlier.")
    return {
        "order": "The first rule that matches names the stock. Tight range is a second tag "
                 "that can sit beside any of them.",
        "atr": "ATR is the 14-session average true range, the stock's typical daily move in "
               "dollars.",
        "labels": [
            {"key": "below_50", "label": words["below_50"],
             "rule": "The close is under the 50-day simple average.",
             "source": "A definition."},
            {"key": "extended", "label": words["extended"],
             "rule": (f"{_st.EXTENDED_ATR_SMA50:g} or more ATRs above the 50-day average, or "
                      f"{_st.EXTENDED_ATR_EMA21:g} or more ATRs above the 21-day EMA, or more "
                      f"than {zone} past a base pivot."),
             "source": (f"The {_st.EXTENDED_ATR_SMA50:g} ATR limit is Jeff Sun's published "
                        f"rule. {_st.EXTENDED_ATR_EMA21:g} ATRs over the 21-day is a house "
                        f"threshold with no published test. {zone} past a pivot is the top "
                        f"of IBD's published range.")},
            {"key": "at_pivot", "label": words["at_pivot"],
             "rule": (f"From {_pct_words(_st.PIVOT_BELOW)} below a base pivot to {zone} above "
                      f"it. The pivot is the one the Base Structure column names for the "
                      f"stock on this build."),
             "source": (f"{zone} above the pivot is IBD's published range. "
                        f"{_pct_words(_st.PIVOT_BELOW)} below is a house threshold.")},
            {"key": "pullback_8", "label": words["pullback_8"],
             "rule": (pullback.format(n=8) + " Named ahead of the 21-day when both hold. "
                      + PULLBACK_IS_A_PLACE),
             "source": "The 8-day and 21-day EMAs are the house teaching averages. The "
                       "half-ATR band is a house threshold with no published test."},
            {"key": "pullback_21", "label": words["pullback_21"],
             "rule": pullback.format(n=21) + " " + PULLBACK_IS_A_PLACE,
             "source": "The same house rule, on the 21-day EMA."},
            {"key": "uptrend", "label": words["uptrend"],
             "rule": "None of the above, with the close at or above the 50-day average.",
             "source": "A definition."},
        ],
        "tight": {"label": words["tight"],
                  "rule": "The Tight Consolidation column reads yes for the stock."},
        "flags": [
            {"key": "buyout_pending", "label": words["buyout_pending"],
             "rule": (f"One session closed {_st.BUYOUT_JUMP_PCT:g}% or more above the prior "
                      f"close within the last {_st.BUYOUT_WINDOW} sessions, at least "
                      f"{_st.BUYOUT_MIN_SESSIONS} sessions ago, and every close since has "
                      f"stayed inside a {_st.BUYOUT_BAND_PCT:g}% range.")},
            {"key": "one_day_move", "label": words["one_day_move"],
             "rule": (f"Over the last {_st.ONE_DAY_WINDOW} sessions the stock is up, and one "
                      f"session's gain was more than half of that rise and at least "
                      f"{_st.ONE_DAY_MIN_PCT:g}% on its own.")},
            {"key": "new_issue", "label": words["new_issue"],
             "rule": f"Fewer than {_st.NEW_ISSUE_BARS} daily bars of price history."},
        ],
        "near": ("Near a buy point means At pivot, a Pullback, or a Tight range. It never "
                 "includes a stock that is Extended, Below its 50-day line, Buyout pending or "
                 "a One-day move. It describes where price sits against its own averages. It "
                 "is not a recommendation."),
        "blank": ("A label is blank when one of the measures it needs cannot be computed, "
                  "and for a stock whose price history contradicts itself. A blank is never "
                  "replaced by the next label down."),
    }


def _pp_lookback() -> int:
    """The RS new-high lookback in sessions (252), from the bar writer."""
    from api.services.screener import rs_columns as _rc            # noqa: PLC0415
    return int(_rc.LOOKBACK)


def _red_day_words() -> str:
    """The market down day threshold (SPY down 0.5% or more), from `relative_strength`."""
    return f"{abs(float(_rs_params()['red'])):g}%"


def _rs_exit_note() -> str:
    e = _rs_exit_params()
    return (f"The RS Exit Warnings ({', '.join(e['names'])}) are Mike Webster's method, our "
            f"reading of it, on daily bars against SPY with {e['fast']}- and {e['slow']}-session "
            f"simple averages of the RS line, the same maths the chart's UCT RS Exit Warnings "
            f"draw. A warning is a prompt to review the position, not an order to sell.")


def _rs_phase3_note() -> str:
    q = _rs_phase3_params()
    return (f"The rotation quadrant is RRG-style, UCT's formula, read on WEEKLY bars against SPY "
            f"({_rrg_formula_prose(q)}), the formula the Terminal's rotation graph draws, not "
            f"StockCharts'. The Clenow trend score is Clenow-style, {q['clenow']} trading days, "
            f"a fraction rather than a percent. The VARS state is VARS-style, on daily bars "
            f"against SPY. All three are empty until the nightly build fills them.")


def _rs_column_methods() -> list:
    p = _rs_params()
    lb, ma, mt, mn = p["lookback"], p["ma"], p["ma_type"], p["mansfield"]
    win, agree, tol, red, top = p["window"], p["agree"], p["tol"], p["red"], p["max"]
    flag = "0 or 1 (1 = yes)"
    age = "sessions, 0 = the last session"
    rating_scale = f"1-{top}, higher is stronger"
    out = [
        {"column": "rs_new_high", "label": "RS New High (52-week)",
         "one_line": "The RS line against SPY closed the last session at a one-year high.",
         "scale": flag,
         "how": (f"The RS line is the stock's close divided by SPY's close at the same bar "
                 f"date. 1 when the last session's value is at or above the highest of the "
                 f"previous {lb} sessions (ties count), 0 when it is not; blank until {lb} "
                 f"prior sessions exist or when that window has a gap. " + _RS_BAR_NOTE),
         "caveat": ("A new RS high says the stock is outperforming the index by the most it "
                    "has in a year. It is a filter, not a timing signal, and it says nothing "
                    "about price direction on its own: both the stock and the index can be "
                    "falling.")},
        {"column": "rs_nh_before_price", "label": "RS New High Before Price",
         "one_line": "The RS line is at a one-year high while price is not.",
         "scale": flag,
         "how": (f"1 when the RS line is at a {lb}-session high and price is NOT — price "
                 f"counts as at its own high only within {tol:g}% of its {lb}-session high, "
                 f"the same tolerance everywhere the platform draws this dot. 0 when either "
                 f"half fails; blank where the RS high itself is blank. " + _RS_BAR_NOTE),
         "caveat": ("IBD calls it more bullish, not a precondition; no published study "
                    "measures how often it precedes a breakout. The reverse case, price at a "
                    "high while RS is not, is the divergence to distrust.")},
        {"column": "rs_nh_red_day", "label": "RS New High on a Red Day",
         "one_line": "The RS line made a one-year high on a session SPY closed down.",
         "scale": flag,
         "how": (f"1 when the RS line made a {lb}-session high on a session SPY closed down "
                 f"{red:g}% or more against its prior close, the stress-test day; 0 when the "
                 f"high came on any other day; blank where the RS high itself is blank. "
                 + _RS_BAR_NOTE),
         "caveat": ("Strength on a weak day is what the UCT workshops watch for; it has not "
                    "been measured publicly, and a single red day is one observation. Read it beside "
                    "Up on Down Days, which counts them.")},
        {"column": "rs_nh_bars_ago", "label": "RS New High Age (bars)",
         "one_line": "Sessions since the RS line last made a one-year high.",
         "scale": age,
         "how": (f"0 on the session the RS line made a {lb}-session high, one more on every "
                 f"session after it, whatever the line did since; blank until one has been "
                 f"seen inside the stored window. " + _RS_BAR_NOTE),
         "caveat": ("A high hidden inside a data gap can only make the age too LARGE, never "
                    "claim a high that did not happen, which is the safe direction for a scan.")},
        {"column": "green_on_red_20", "label": "Up on Down Days (of 20)",
         "one_line": "How many of the last 20 sessions were SPY down days this stock closed up on.",
         "scale": f"0-{win}",
         "how": (f"A red day is a session SPY closed down {red:g}% or more; the count is how "
                 f"many of the last {win} sessions were red days on which this stock closed "
                 f"above its own prior close. Blank until {win} sessions with a prior bar "
                 f"exist. " + _RS_BAR_NOTE),
         "caveat": (f"The ceiling is the number of red days in the window, not {win}: on a "
                    f"quiet tape with two red days nobody can score above 2. Read the count "
                    f"against the tape, not as a fixed scale.")},
        {"column": "rs_line_above_ma", "label": "RS Line Above 21 EMA",
         "one_line": "The RS line sits above its own moving average.",
         "scale": flag,
         "how": (f"1 when the RS line against SPY is at or above its {ma}-session {mt} on the "
                 f"last session, 0 below it; blank until {ma} sessions exist. The average runs "
                 f"over the valid RS values in order, gaps skipped. " + _RS_BAR_NOTE),
         "caveat": ("Above the average is the curriculum's phase read of the RS line, not a "
                    "statement about price: a stock can sit above its RS average while its "
                    "price falls, if the index falls faster.")},
        {"column": "rs_cross_up_bars_ago", "label": "RS Line Cross-Up Age (bars)",
         "one_line": "Sessions since the RS line last crossed above its moving average.",
         "scale": age,
         "how": (f"0 on the session the RS line crossed from below to above its {ma}-session "
                 f"{mt}, one more on every session after; blank until a cross has been seen. "
                 f"The count keeps running if the line has since fallen back below, so pair "
                 f"it with RS Line Above 21 EMA to require that the cross still holds. "
                 + _RS_BAR_NOTE),
         "caveat": ("An old cross that still holds and a fresh cross that already failed can "
                    "carry the same number; the flag beside it is what tells them apart.")},
        {"column": "mansfield", "label": "Mansfield RS",
         "one_line": "The RS line as a percent above or below its own 200-day average.",
         "scale": "percent, signed, two places",
         "how": (f"Weinstein's Mansfield formula: the RS line times 100, divided by its own "
                 f"{mn}-session simple average, minus 1, as a percent (rounded to {p['dp']} "
                 f"places). Our reading is on {mn} DAILY bars, the curriculum's daily form of "
                 f"his 52-week weekly average, never on weekly bars. Above zero means the RS "
                 f"line against SPY is above its own {mn}-session average; zero is at it; "
                 f"blank until {mn} sessions exist. " + _RS_BAR_NOTE),
         "caveat": ("A daily 200 and a weekly 52 are not the same number for the same stock, "
                    "and neither is Weinstein's own chart service's. Compare it with itself "
                    "over time and with its zero line, not with a figure from another tool.")},
        {"column": "mansfield_cross_bars_ago", "label": "Mansfield Cross Age (bars)",
         "one_line": "Sessions since Mansfield RS last crossed its zero line.",
         "scale": age,
         "how": (f"0 on the session Mansfield RS crossed zero in EITHER direction, one more "
                 f"on every session after; blank on a gap bar or until {mn + 1} sessions "
                 f"exist. Read beside the sign of Mansfield RS to know which way it crossed. "
                 + _RS_BAR_NOTE),
         "caveat": ("The age alone does not say up or down. A screen for \"turned positive\" "
                    "is this age AND Mansfield RS above zero, which is how the starter is "
                    "written.")},
        {"column": "rs_benchmark_agree", "label": "RS Agrees vs SPY and RSP",
         "one_line": "The RS slope has the same sign against the cap-weighted and the equal-weight index.",
         "scale": flag,
         "how": (f"1 when the sign of the {agree}-session least-squares slope of the stock's "
                 f"RS line is the same against SPY and against RSP, the equal-weight S&P 500 "
                 f"(both rising or both falling); 0 when they disagree or either slope is "
                 f"flat; blank until {agree} sessions exist against both. The nightly build "
                 f"reads two benchmarks, SPY and RSP, and not the sector ETF, so this is a "
                 f"TWO-benchmark test. " + _RS_BAR_NOTE),
         "caveat": ("Agreement cuts both ways: two falling slopes agree too. To mean leaders, "
                    "pair it with an RS rank floor or the RS line above its average, as the "
                    "starter does. It answers the denominator question (did the share "
                    "strengthen, or did a few megacaps weaken the index), nothing more.")},
        {"column": "rs_rating_ibd", "label": "RS Rating (IBD-style)",
         "one_line": "An IBD-style 1-99 price-performance rating, our own calculation. "
                     "Once RS Rank is unified with it, RS Rating is the RS column: the "
                     "same number, so this column leaves the picker (saved screens keep it).",
         "scale": rating_scale,
         "how": (f"Over the stock's daily closes: {_ibd_formula_prose(p)}. The score is "
                 f"ranked across {_RATED_POPULATION}, as a percentile with ties "
                 f"sharing the mean position, and the rating is max(1, ceil(percentile x "
                 f"{top})). ETFs receive a rating by interpolating their score into the stock "
                 f"distribution, so SPY or a sector fund can carry a number on the same "
                 f"scale. " + _RS_RATING_NOTE),
         "caveat": (f"IBD-style, our own calculation, not MarketSurge's number: the weighting "
                    f"is the published one, the universe and the data are ours. The "
                    f"population is every stock we hold a recent daily price for, minus ETFs "
                    f"(about 6,000 names, warrants, rights, units and thin stocks included, "
                    f"as in Deepvue's rank), not only the liquid names the hourly RS Rank "
                    f"still ranks. Measured difference to MarketSurge: "
                    f"{RS_RATING_VS_MARKETSURGE or 'not yet measured'}; no figure is claimed "
                    f"until it is.")},
        {"column": "rs_rating_chg_5", "label": "RS Rating Change (5 sessions)",
         "one_line": "The IBD-style rating minus its value five stored sessions ago.",
         "scale": f"-{top - 1} to +{top - 1} points",
         "how": ("The rating minus the rating stored 5 sessions earlier in the rating history, "
                 "computed when read rather than stored, so a corrected session corrects its "
                 "deltas too; blank until 5 earlier sessions exist. " + _RS_RATING_NOTE),
         "caveat": ("A rank moves when the rest of the universe moves: a flat stock can lose "
                    "several points in a week the market rallies. It is a change in position, "
                    "not a return.")},
        {"column": "rs_rating_chg_20", "label": "RS Rating Change (20 sessions)",
         "one_line": "The IBD-style rating minus its value twenty stored sessions ago.",
         "scale": f"-{top - 1} to +{top - 1} points",
         "how": ("The rating minus the rating stored 20 sessions earlier in the rating history, "
                 "computed when read rather than stored; blank until 20 earlier sessions "
                 "exist. " + _RS_RATING_NOTE),
         "caveat": ("A rank moves when the rest of the universe moves; a change in position is "
                    "not a return. The history begins at the job's first run, so the first "
                    "twenty sessions after it fills carry no value here.")},
    ]
    names = {"m1": ("rs_rating_1m", "1M Return Rank", "one-month"),
             "m3": ("rs_rating_3m", "3M Return Rank", "three-month"),
             "m6": ("rs_rating_6m", "6M Return Rank", "six-month"),
             "m12": ("rs_rating_12m", "12M Return Rank", "twelve-month")}
    for key, bars in p["components"]:
        column, label, words = names[key]
        blend = p["long_terms"].get(key)
        equal = p["equal_terms"].get(key)
        if equal is not None:
            out.append({
                "column": column, "label": label,
                "one_line": f"Percentile rank of the equal-weighted average of the one-, two- and "
                            f"three-month returns, 1-{top}.",
                "scale": rating_scale,
                "how": (f"An equally weighted average of three close ratios, each counting once: "
                        f"{_equal_blend_prose(equal)}, ranked across the same stocks as the "
                        f"IBD-style rating ({_RATED_POPULATION}) and scored the same way, max(1, ceil(percentile "
                        f"x {top})). A window the history cannot reach leaves no value: without the "
                        f"{max(n for n, _w in equal)}-session term there is no rank. " + _RS_RATING_NOTE),
                "caveat": ("Not the plain three-month return: until 2026-11-12 this rank was taken over "
                           "the plain 63-session return, so a chart or saved screen from before then "
                           "reads on a different basis. A stock that rose early in the quarter and has "
                           "been flat since ranks below one that rose late, which a plain three-month "
                           "return cannot tell apart. It reacts faster and flips more often than the "
                           "weighted rating; a high short-window rank beside a low long-window one is "
                           "a young move, not a leader yet."),
            })
            continue
        if blend is None:
            out.append({
                "column": column, "label": label,
                "one_line": f"Percentile rank of the plain {words} return, 1-{top}.",
                "scale": rating_scale,
                "how": (f"The close over the close {bars} sessions earlier, ranked across the "
                        f"same stocks as the IBD-style rating ({_RATED_POPULATION}) and scored the same "
                        f"way, max(1, ceil(percentile x {top})). One window alone, where the "
                        f"rating above weights four of them. " + _RS_RATING_NOTE),
                "caveat": ("A single-window rank reacts faster and flips more often than the "
                           "weighted rating; a high short-window rank beside a low long-window one "
                           "is a young move, not a leader yet."),
            })
            continue
        out.append({
            "column": column, "label": label,
            "one_line": f"Percentile rank of the recency-weighted {words} return, 1-{top}.",
            "scale": rating_scale,
            "how": (f"A weighted average of {_long_blend_prose(blend)}, so the newest quarter "
                    f"counts double, ranked across the same stocks as the IBD-style rating "
                    f"({_RATED_POPULATION}) and scored the same way, max(1, ceil(percentile x "
                    f"{top})). A window the history cannot reach is dropped and the weights "
                    f"renormalised; without the first term there is no value. " + _RS_RATING_NOTE),
            "caveat": ("Not the plain {words} return: until 2026-11-11 this rank was taken over "
                       "the plain return, so a chart or saved screen from before then reads on "
                       "a different basis. It reacts faster than the weighted rating; a high "
                       "short-window rank beside a low long-window one is a young move, not a "
                       "leader yet.").replace("{words}", words),
        })
    # S1 (2026-11-10): the ninth-month window. NOT one of the four the rating
    # weights (`IBD_COMPONENTS`), so it gets its own entry and its own sentence.
    from api.services import rs_weighted_return as _rsw9        # noqa: PLC0415
    _label9, bars9 = _rsw9.IBD_M9_COMPONENT
    out.append({
        "column": "rs_rating_9m", "label": "9M Return Rank",
        "one_line": f"Percentile rank of the recency-weighted nine-month return, 1-{top}.",
        "scale": rating_scale,
        "how": (f"A weighted average of {_long_blend_prose(p['long_terms']['m9'])}, so the "
                f"newest quarter counts double, ranked across the same stocks as the "
                f"IBD-style rating ({_RATED_POPULATION}) and scored the same way, max(1, ceil(percentile "
                f"x {top})). It is not one of the rating's own four terms; it sits between the "
                f"six- and twelve-month ranks so a long move can be read in five steps. "
                + _RS_RATING_NOTE),
        "caveat": ("It reacts faster and flips more often than the weighted rating. Blank "
                   "until the rating history carries the nine-month figure for the session, "
                   "which older stored sessions fill by a one-off backfill. Until 2026-11-11 "
                   "this rank was taken over the plain nine-month return."),
    })
    out.extend(_rs_phase3_methods())
    out.extend(_rs_exit_methods())
    out.extend(_rs_screens_methods())
    for m in out:
        m["family"] = RS_FAMILY
    return out


# ── UCT Relative Strength evidence (Phase 2b, unit 2b-09) ────────────────────
# ⛔ THE SAME RULE AGAIN. The display floor, the horizon, the honesty sentence,
# the survivorship note and the card-to-signal map are READ from
# `rs_evidence_pull` at call time (it carries the job's `DISPLAY_FLOOR_N` and
# `SURVIVORSHIP_NOTE` and owns `DEFAULT_HORIZON`, `HONESTY_SENTENCE`,
# `CARD_SIGNALS`), so the chart card and this page can never disagree about
# when a measured number prints or what the card says until it does.
# `test_the_measured_number_rule_is_read_from_the_pull_module` proves it by
# MOVING them.

#: The five defensible statements (research base
#: `docs/research/relative-strength/03-evidence.md` §b), each with its source
#: and the chart card that carries it. Prose, so it lives here; the card copy is
#: `nativeRegistry.js`'s, and `tests/test_rs_columns_provider.py` holds the two
#: files' honesty sentence equal.
RS_EVIDENCE_STATEMENTS = (
    {"claim": ("Stocks that have outperformed over the past 6 to 12 months have, on average, "
               "kept outperforming for the next 3 to 12 months across many markets and decades: "
               "about 8% a year long-short, positive in roughly four years of five."),
     "source": ("Jegadeesh and Titman, Returns to Buying Winners and Selling Losers (1993); "
                "Asness, Frazzini, Israel and Moskowitz, Fact, Fiction and Momentum Investing (2014)"),
     "card": "rating"},
    {"claim": ("Relative strength is a tendency, not a guarantee. In backtests it loses roughly "
               "one year in five and reverses hardest at bear-market bottoms (2003, 2009)."),
     "source": ("Daniel and Moskowitz, Momentum Crashes (2016); Dorsey Wright, Point and Figure "
                "Relative Strength Signals (2016)"),
     "card": "regime"},
    {"claim": ("A rising RS line means the stock is beating the benchmark over this window. It can "
               "rise while the stock is falling if the benchmark falls faster."),
     "source": "IBD, Investor's Business Daily (the RS line will rise even if the stock falls)",
     "card": "benchmark"},
    {"claim": ("Which benchmark you compare to matters. In 2023 and 2024, 78% of S&P 500 stocks "
               "underperformed the cap-weighted index; compare to equal-weight or the sector to "
               "isolate stock-specific strength."),
     "source": "Lyrical Asset Management, 2024 US value review letter",
     "card": "sensitivity"},
    {"claim": ("RS confirmed after a breakout has historically been associated with larger "
               "follow-through (an average gain of 41% against 22%); the direction of RS before "
               "the breakout barely mattered."),
     "source": "Bulkowski, thepatternsite.com (15,763 chart patterns, 1,094 stocks from 1991)",
     "card": "beforePrice"},
)


def _rs_evidence_params() -> dict:
    from api.services import rs_evidence_pull as _ep                 # noqa: PLC0415
    return {"floor": _ep.DISPLAY_FLOOR_N, "horizon": _ep.DEFAULT_HORIZON,
            "honesty": _ep.HONESTY_SENTENCE, "survivorship": _ep.SURVIVORSHIP_NOTE,
            "cards": dict(_ep.CARD_SIGNALS), "labels": dict(_ep.SIGNAL_LABELS),
            "key": _ep.ARTIFACT_KEY, "outcome": _ep.outcome_phrase,
            # unit VA3: the span rule and the likely range, read at call time
            "min_dates": _ep.MIN_EVENT_DATES, "confidence": _ep.INTERVAL_CONFIDENCE_PCT,
            "interval_words": _ep.INTERVAL_WORDS, "need": _ep.requirement_phrase,
            "splits": _ep.split_unchecked_phrase}


def rs_evidence_section() -> dict:
    """The Evidence subsection of the RS section: the five defensible statements
    with their sources, the rule a measured number must clear before it prints,
    and the honesty sentence a card carries until then."""
    p = _rs_evidence_params()
    floor, h, surv = p["floor"], p["horizon"], p["survivorship"]
    min_dates, conf, words = p["min_dates"], p["confidence"], p["interval_words"]
    return {
        "label": "Evidence",
        "statements": [dict(s) for s in RS_EVIDENCE_STATEMENTS],
        "measured": {
            "signals": [{"card": card, "signal": name, "label": p["labels"].get(name, name)}
                        for card, name in p["cards"].items()],
            "horizon_bars": h,
            "display_floor_n": floor,
            "min_event_dates": min_dates,
            "interval_confidence_pct": conf,
            "artifact": p["key"],
            "survivorship": surv,
            # The base (owner decision N6, 2026-11-07) is the next session's open: the
            # phrase is the pull module's `outcome_phrase`, the card sentence's own.
            "rule": (
                f"A measured number prints on a chart card only when the nightly backtest counted "
                f"at least {floor} events for that signal, each with a complete {h}-session window "
                f"after it, and those events fell on at least {min_dates} different sessions: events "
                f"on the same day share one market, so many names firing on a few days are a few "
                f"observations, not many. The sentence carries the sample size, the sessions it fell "
                f"on, the window's dates, the share that {p['outcome']('the benchmark', h)} (the hit "
                f"rate) with the range it is {words} ({conf}% confidence, a Wilson interval that counts "
                f"each session once, so it is wider than one over every event), the median excess "
                f"return, the same share for all bars, and the caveats. When the split guard could not "
                f"check some names (their list of past stock splits was not available) the sentence "
                f"says how many, for example: {p['splits'](37)} "
                f"Signals are read point-in-time, from the bars as held on each session, never "
                f"from today's history. The forward return starts at the next session's open, the "
                f"first price a member who sees the dot after the close can act on, and ends at the "
                f"close {h} sessions after the signal; it carries no costs or slippage, so the hit rate "
                f"reads as what the dot was worth from the first price a member could take, not as a "
                f"trade result. A window that holds a stock split the price history has not been "
                f"adjusted for is left out and counted, never measured across two price scales. The "
                f"population is the {surv}: a name delisted since is counted only where its bars are "
                f"still held, which flatters the numbers until the registry correction lands. Under "
                f"the floor or the session rule the card says how many events and sessions were "
                f"measured and that {p['need'](floor, min_dates)}; with no complete window yet it says "
                f"so. Before the first artifact has been pulled, or for a signal the backtest does not "
                f"measure, the card says: {p['honesty']}"),
            "form": (
                f"<count> <signal> on <sessions> sessions, <first date> to <last date>, daily bars: "
                f"<hit rate>% ({words} <low>% and <high>%) {p['outcome']('<benchmark>', h)} "
                f"(<horizon in months>; median <excess>%), against <all-bars hit rate>% for all bars. "
                f"[Stock splits not yet checked for <N> names.] {surv[:1].upper()}{surv[1:]}."),
            "form_withheld": (
                f"UCT measured <count> events on <sessions> sessions, too few to print a hit rate: "
                f"{p['need'](floor, min_dates)}."),
        },
        "honesty": p["honesty"],
        "not_claimed": [
            "A win rate or forward return for an RS new high, before price or on a red day: none is "
            "published, and ours prints only once measured on our own bars, with its sample and dates.",
            "That an RS Rating of 80, 85 or 90 is a validated threshold; IBD itself gives all three.",
            "That IBD's average rating of 87 comes from a defined study with a known sample.",
            "That RS predicts breakouts or is a leading indicator of institutional buying.",
            "Published backtest returns (Clenow, Antonacci, Dorsey Wright, Faber) as live, net of "
            "costs, or applicable to a single swing trade.",
            "A seasonal or frog-in-the-pan edge as settled.",
        ],
    }


def rs_columns_section() -> dict:
    """The shared notes for the twenty UCT Relative Strength columns: what
    runs when, the two readings that differ from the textbook, the honesty
    line, and (2b-09) the Evidence subsection. The per-column entries sit in
    `all_methods()["methods"]` beside the composites; this is the paragraph a
    member reads once."""
    p = _rs_params()
    return {
        "label": "UCT Relative Strength columns",
        "columns": [m["column"] for m in _rs_column_methods()],
        "evidence": rs_evidence_section(),
        "timing": (
            "The ten bar-derived columns (the RS new-high flags and age, the up-on-down-days "
            "count, the RS line against its average and the cross age, Mansfield RS and its "
            "zero-cross age, the benchmark agreement) are computed inside the nightly 03:00 "
            "ET screener build from the daily bars it already holds, SPY and RSP read once "
            "per build. The seven rating columns are written by the 04:15 ET rating job AFTER "
            "that build and read by the NEXT build, so a row carries the rating as of the "
            "session before its bars date: the rating lags the bar columns by one session by "
            "design, and no number here is intraday. The three Phase 3 columns (the rotation "
            "quadrant, the Clenow trend score and the VARS state) are computed in the same "
            "03:00 ET step from the same bars, only while that step's Phase 3 part is switched "
            "on, and are empty until then. The five RS Exit Warning columns (the newest warning, "
            "its age and each warning's own age) are computed in the same 03:00 ET step from "
            "the same bars. Ten RS screens columns (the session the ratings are as of, "
            "the score behind the rating, each liquid stock's exact place overall, by "
            "window and a month ago, and its rating a month ago) are filled by a pass after "
            "each build and again after the 04:15 ET rating job, only while the RS screens are "
            "switched on, and are empty until then; once that pass has run, Ratings as of "
            "names the session the rating columns on a row describe. Thirteen more (six "
            "measures of the RS line's recent highs, the Setup label with its tight tag, flag "
            "and near answer, and three of the label's own inputs) are computed in the same "
            "03:00 ET build from the same bars, only while the RS screens are switched on."),
        "notes": [
            # U9 (RS split): these two notes no longer name a chart Reading. The slim UCT RS
            # Line draws no Mansfield line and no sensitivity row (map §(a) U7); the screener
            # columns are the readings that stay, and this page describes the columns.
            f"Mansfield RS is read on {p['mansfield']} DAILY bars, the curriculum's daily form "
            f"of Weinstein's 52-week weekly average, never on weekly bars.",
            f"RS Agrees vs SPY and RSP is a TWO-benchmark test: the sign of the "
            f"{p['agree']}-session RS slope against SPY and against equal-weight RSP; the "
            f"nightly build does not read the sector ETF.",
            f"The rating is IBD-style, our own calculation, not MarketSurge's: "
            f"{_ibd_formula_prose(p)}; percentile across {_RATED_POPULATION}; "
            f"max(1, ceil(percentile x {p['max']})). Measured difference to MarketSurge: "
            f"{RS_RATING_VS_MARKETSURGE or 'not yet measured'}.",
            "Denominator: the rating ranks every stock we hold a recent daily price for, "
            "minus ETFs (about 6,000 names), which is wider than the liquid cap universe the "
            "hourly RS Rank ranks and close to Deepvue's own population; a name with no recent "
            "price or under a year of history carries no rating or no long-window rank.",
            _rs_phase3_note(),
            _rs_exit_note(),
        ],
        "honesty": (
            "Every column here describes the past. Relative strength says which stocks to "
            "study, not when to buy; a rising RS line can sit on a falling price when the "
            "index falls faster, and a 99 after a parabolic move is often extended, not safe. "
            "None of these columns is a forecast or a recommendation."),
    }


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
    out.extend(_rs_column_methods())
    doc = {
        "methods": out,
        "rs_columns": rs_columns_section(),
        "as_of_note": (
            "Every column here is recomputed by the nightly 03:00 ET build; the "
            "IBD-style RS Rating columns are read by that build from the 04:15 ET "
            "rating job, so they carry the prior session's rating. "
            "None of them is an intraday number."),
    }
    # The five RS screens' own page (unit U4), only while they are served: off, the
    # payload carries no key for it.
    if _rs_screens_served():
        doc["rs_screens"] = rs_screens_section()
    return doc


def _rs_screens_served() -> bool:
    try:
        from api.services.screener import rs_post_pass as _pp      # noqa: PLC0415
        return bool(_pp.enabled())
    except Exception:  # noqa: BLE001 -- an unreadable flag serves nothing new
        return False


def for_column(column):
    """One column's method, or `None` — absence is a real answer."""
    key = str(column or "").strip()
    for m in all_methods()["methods"]:
        if m["column"] == key:
            return m
    return None
