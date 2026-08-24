"""A member's OWN weighted composite over the screened set.

WHY THIS MODULE EXISTS
======================
Benchmark metrics 432-435. Stock Rover ships "Quant" and Stockopedia ships
"StockRanks" — both let a member put their own weights on their own criteria and
get a ranked, top-N list back. We shipped `uct_composite`, which is the HOUSE's
weighting and cannot be anything else.

⭐ THIS IS THE ONE THING `uct_composite` STRUCTURALLY CANNOT GIVE: a member who
believes growth matters twice as much as value can say so, and see the board
re-order. It is pure SQL over the snapshot — no new data, no new job.

HOW A SCORE IS BUILT
====================
Each criterion becomes a PERCENTILE within the screened set (`PERCENT_RANK`),
not a raw value, because raw values do not add: a P/E of 12 and an ROE of 31 are
not on the same scale and weighting them directly is arithmetic on units that do
not exist. Percentiles are unitless and bounded [0, 1], so a weighted sum of
them is meaningful and the result reads 0-100.

`ascending: true` means LOWER IS BETTER (P/E, PEG, debt) and inverts that
criterion's percentile. ⛔ There is no default guess about direction per column —
a screener that assumed "high is good" would silently rank the most expensive
names first on a value criterion, which is exactly the shape of the audit's
worst finding (`peg` publishing distress as cheapness).

⛔ THE PERCENTILE IS OVER THE SCREENED SET, NOT THE UNIVERSE, and that is a
deliberate difference from `distribution.py` beside it. That module answers
"where does this value sit among all 3,700 names" — a fixed, citable fact about
our data. This one answers "where does this name sit among THE ONES YOU ASKED
FOR", which is what a rank is for: filtering to 40 growth names and ranking them
should spread those 40 across the scale, not squash them into the top decile of
a universe they were already selected out of.

AN INCOMPLETE ROW IS EXCLUDED AND COUNTED, NEVER SCORED
=======================================================
🔴 A row missing one of the weighted criteria is dropped from a ranked screen and
reported in the receipt. Both alternatives are worse and both are defects this
codebase has already paid for:

  * Scoring it as a 0 percentile is the FABRICATED ZERO — the row sorts last as
    if it were measurably the worst, when the truth is we never measured it.
  * Renormalising over the criteria it does have makes scores incomparable: a
    name holding 1 of 3 criteria could score 100 and outrank a name that
    genuinely leads on all three.

So the honest answer is that it cannot be ranked, said out loud with a count.
"""
from __future__ import annotations

from . import filters

#: Weighted criteria in one rank. A ceiling rather than a taste: every extra
#: criterion is another window function over the screened set, and past a handful
#: the weights stop being something a person can reason about.
MAX_CRITERIA = 8

#: Rows a ranked screen may return before paging. Mirrors the rivals' own top-N
#: caps and keeps the CTE bounded.
MAX_TOP_N = 500


class RankSpecError(ValueError):
    """A rank request that cannot be honoured. Never a silent fallback."""


def parse(raw):
    """Validate a client rank spec into `(criteria, top_n)`, or return `None`.

    ⛔ REFUSES RATHER THAN FALLING BACK. A malformed rank that quietly degraded
    to "no ranking" would hand the member a plain list they did not ask for,
    ordered by something they did not choose, with nothing on screen to say so.
    """
    if not raw:
        return None
    if not isinstance(raw, dict):
        raise RankSpecError("rank must be an object")
    crit_raw = raw.get("criteria")
    if not isinstance(crit_raw, list) or not crit_raw:
        raise RankSpecError("rank needs at least one criterion")
    if len(crit_raw) > MAX_CRITERIA:
        raise RankSpecError(
            f"rank takes at most {MAX_CRITERIA} criteria, got {len(crit_raw)}")

    allowed = set(filters.comparable_keys())
    seen, criteria = set(), []
    for c in crit_raw:
        if not isinstance(c, dict):
            raise RankSpecError("each rank criterion must be an object")
        key = c.get("key")
        # ⛔ A FILTER KEY, resolved through the registry — never a column name off
        # the request. The registry is the only thing that may name a column.
        if key not in allowed:
            raise RankSpecError(f"cannot rank by {key!r}")
        if key in seen:
            raise RankSpecError(f"duplicate rank criterion {key!r}")
        seen.add(key)
        try:
            weight = float(c.get("weight", 1))
        except (TypeError, ValueError):
            raise RankSpecError(f"bad weight for {key!r}") from None
        if not (weight > 0) or weight != weight or weight in (float("inf"),):
            raise RankSpecError(f"weight for {key!r} must be a positive number")
        criteria.append({
            "key": key,
            "column": filters.column_for(key),
            "label": filters.FILTERS[key]["label"],
            "weight": weight,
            "ascending": bool(c.get("ascending")),
        })

    top_n = raw.get("top_n")
    if top_n is not None:
        try:
            top_n = int(top_n)
        except (TypeError, ValueError):
            raise RankSpecError("top_n must be a whole number") from None
        if top_n < 1:
            raise RankSpecError("top_n must be at least 1")
        top_n = min(top_n, MAX_TOP_N)
    return {"criteria": criteria, "top_n": top_n}


def completeness_clauses(rank, col_expr):
    """`NOT NULL` fragments for every weighted column — the exclusion, in SQL.

    See the module docstring for why an incomplete row is dropped rather than
    scored. `col_expr` is the overlay's, so a criterion reads the SAME value the
    member is shown.
    """
    return [f"{col_expr(c['column'])} IS NOT NULL" for c in rank["criteria"]]


def score_expr(rank, col_expr):
    """The 0-100 weighted-percentile expression.

    ⚠️ `PERCENT_RANK()` yields 0 for the single lowest row and 1 for the highest,
    so a one-row result scores 0 on every criterion. That is arithmetic, not a
    bug — a rank within a set of one has no information — and the receipt's row
    count is what tells the member so.
    """
    total = sum(c["weight"] for c in rank["criteria"])
    parts = []
    for c in rank["criteria"]:
        col = col_expr(c["column"])
        # ⛔ DIRECTION IS PER CRITERION AND NEVER GUESSED. `ascending` means
        # lower is better, so the percentile is inverted rather than the sort.
        pr = f"PERCENT_RANK() OVER (ORDER BY {col} ASC)"
        if c["ascending"]:
            pr = f"(1.0 - {pr})"
        parts.append(f"{c['weight']} * {pr}")
    return f"ROUND(100.0 * ({' + '.join(parts)}) / {total}, 2)"


def receipt(rank, matched, ranked):
    """What the response says about the rank it just applied.

    ⭐ `excluded_incomplete` IS THE POINT. A ranked screen returns fewer rows
    than the same filters unranked, and without this the member reads that as a
    quieter market rather than as missing data.
    """
    return {
        "criteria": [
            {"key": c["key"], "label": c["label"], "weight": c["weight"],
             "ascending": c["ascending"],
             # The share of the score this criterion carries, so the UI never
             # has to renormalise the weights itself and reach a different total.
             "share_pct": round(
                 100.0 * c["weight"] / sum(x["weight"] for x in rank["criteria"]), 1)}
            for c in rank["criteria"]],
        "top_n": rank["top_n"],
        "matched_filters": matched,
        "ranked": ranked,
        "excluded_incomplete": max(matched - ranked, 0),
    }
