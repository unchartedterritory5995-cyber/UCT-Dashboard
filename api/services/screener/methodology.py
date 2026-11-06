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
        "required": _rsw.IBD_REQUIRED_TERM, "max": _rsh.RATING_MAX,
    }


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
_RS_RATING_NOTE = ("Written by the 04:15 ET rating job AFTER the 03:00 ET screener build and "
                   "read by the NEXT build, so the row carries the rating as of the session "
                   "before its bars date. Blank when the job has not rated the name: a dark "
                   "job, a name outside the rated population, or too few stored sessions.")


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
         "caveat": ("Leaders often do this before they break out, which is why it is watched; "
                    "it is not a guarantee that price follows. The reverse case, price at a "
                    "high while RS is not, is the divergence to distrust.")},
        {"column": "rs_nh_red_day", "label": "RS New High on a Red Day",
         "one_line": "The RS line made a one-year high on a session SPY closed down.",
         "scale": flag,
         "how": (f"1 when the RS line made a {lb}-session high on a session SPY closed down "
                 f"{red:g}% or more against its prior close, the stress-test day; 0 when the "
                 f"high came on any other day; blank where the RS high itself is blank. "
                 + _RS_BAR_NOTE),
         "caveat": ("Strength on a weak day is real demand more often than strength on a "
                    "strong one, but a single red day is one observation. Read it beside "
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
                 f"his 52-week weekly average, never on weekly bars. Above zero means the "
                 f"stock is outperforming its own past year against SPY; zero is average; "
                 f"blank until {mn} sessions exist. " + _RS_BAR_NOTE),
         "caveat": ("A daily 200 and a weekly 52 are not the same number for the same stock, "
                    "and neither is Weinstein's own chart service's. Compare it with itself "
                    "over time and with its zero line, not with a figure from another tool.")},
        {"column": "mansfield_cross_bars_ago", "label": "Mansfield Zero-Cross Age (bars)",
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
                 f"flat; blank until {agree} sessions exist against both. The chart's "
                 f"sensitivity read has a third leg, the sector ETF, which the nightly build "
                 f"does not read, so this is a TWO-benchmark test. " + _RS_BAR_NOTE),
         "caveat": ("Agreement cuts both ways: two falling slopes agree too. To mean leaders, "
                    "pair it with an RS rank floor or the RS line above its average, as the "
                    "starter does. It answers the denominator question (did the share "
                    "strengthen, or did a few megacaps weaken the index), nothing more.")},
        {"column": "rs_rating_ibd", "label": "RS Rating (IBD-style)",
         "one_line": "An IBD-style 1-99 price-performance rating, our own calculation.",
         "scale": rating_scale,
         "how": (f"Over the stock's daily closes: {_ibd_formula_prose(p)}. The score is "
                 f"ranked across the cap universe excluding ETFs, as a percentile with ties "
                 f"sharing the mean position, and the rating is max(1, ceil(percentile x "
                 f"{top})). ETFs receive a rating by interpolating their score into the stock "
                 f"distribution, so SPY or a sector fund can carry a number on the same "
                 f"scale. " + _RS_RATING_NOTE),
         "caveat": (f"IBD-style, our own calculation, not MarketSurge's number: the weighting "
                    f"is the published one, the universe and the data are ours. The "
                    f"denominator is the cap universe RS Rank already ranks over, minus ETFs, "
                    f"which is neither the whole market nor every name the screener builds, "
                    f"so the two ratings agree in population and a name outside it carries "
                    f"neither. Measured difference to MarketSurge: "
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
        out.append({
            "column": column, "label": label,
            "one_line": f"Percentile rank of the plain {words} return, 1-{top}.",
            "scale": rating_scale,
            "how": (f"The close over the close {bars} sessions earlier, ranked across the "
                    f"same cap universe minus ETFs as the IBD-style rating and scored the same "
                    f"way, max(1, ceil(percentile x {top})). One window alone, where the "
                    f"rating above weights four of them. " + _RS_RATING_NOTE),
            "caveat": ("A single-window rank reacts faster and flips more often than the "
                       "weighted rating; a high short-window rank beside a low long-window one "
                       "is a young move, not a leader yet."),
        })
    for m in out:
        m["family"] = RS_FAMILY
    return out


def rs_columns_section() -> dict:
    """The shared notes for the seventeen UCT Relative Strength columns: what
    runs when, the two readings that differ from the textbook, and the honesty
    line. The per-column entries sit in `all_methods()["methods"]` beside the
    composites; this is the paragraph a member reads once."""
    p = _rs_params()
    return {
        "label": "UCT Relative Strength columns",
        "columns": [m["column"] for m in _rs_column_methods()],
        "timing": (
            "The ten bar-derived columns (the RS new-high flags and age, the up-on-down-days "
            "count, the RS line against its average and the cross age, Mansfield RS and its "
            "zero-cross age, the benchmark agreement) are computed inside the nightly 03:00 "
            "ET screener build from the daily bars it already holds, SPY and RSP read once "
            "per build. The seven rating columns are written by the 04:15 ET rating job AFTER "
            "that build and read by the NEXT build, so a row carries the rating as of the "
            "session before its bars date: the rating lags the bar columns by one session by "
            "design, and no number here is intraday."),
        "notes": [
            f"Mansfield RS is read on {p['mansfield']} DAILY bars, the curriculum's daily form "
            f"of Weinstein's 52-week weekly average, never on weekly bars; the chart's "
            f"Mansfield plot reads the same series.",
            f"RS Agrees vs SPY and RSP is a TWO-benchmark test: the sign of the "
            f"{p['agree']}-session RS slope against SPY and against equal-weight RSP. The "
            f"chart's sensitivity read adds a third leg, the sector ETF, which the nightly "
            f"build does not read.",
            f"The rating is IBD-style, our own calculation, not MarketSurge's: "
            f"{_ibd_formula_prose(p)}; percentile across the cap universe minus ETFs; "
            f"max(1, ceil(percentile x {p['max']})). Measured difference to MarketSurge: "
            f"{RS_RATING_VS_MARKETSURGE or 'not yet measured'}.",
            "Denominator: the rating ranks the cap universe RS Rank already ranks over, minus "
            "ETFs, so the two ratings describe one population; it is not the whole market and "
            "not every name the screener builds, and a name outside it carries no rating.",
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
    return {
        "methods": out,
        "rs_columns": rs_columns_section(),
        "as_of_note": (
            "Every column here is recomputed by the nightly 03:00 ET build; the "
            "IBD-style RS Rating columns are read by that build from the 04:15 ET "
            "rating job, so they carry the prior session's rating. "
            "None of them is an intraday number."),
    }


def for_column(column):
    """One column's method, or `None` — absence is a real answer."""
    key = str(column or "").strip()
    for m in all_methods()["methods"]:
        if m["column"] == key:
            return m
    return None
