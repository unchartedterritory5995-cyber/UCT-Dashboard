"""The Leader score: one pure function over a list of row dicts.

Plan: ``2026-11-14-uct-rs-screens-plan-v2.md`` section 8 (rebuilt on the quant review).
Unit U9. Computed nightly, stored (``rs_leader_shadow``) and SHOWN TO NOBODY until it
passes its pre-registered test (``api.services.rs_leader_test``).

    Leader score = 0.40 Strength + 0.25 Steady + 0.20 High + 0.15 Group

Each part is 0 to 100 and the score is blank when any part is. The reference set L is
the RS liquid floor WITHOUT the full-year test (``rs_post_pass.on_liquid_floor(row,
full_year=False)``): a stock off the floor has no score and stands in nobody's ranking.

* Strength: the percentile, within L, of the unrounded rating score.
* Steady: the percentile, within L, of ``rs_steady``.
* High: the mean of ``near(px_below_high_pct)`` and ``near(rs_line_below_high_pct)``,
  ``near(p) = 100 x clip(1 + p / 25, 0, 1)``: 100 at the high, 0 at 25% under it.
* Group: the stock's INDUSTRY, the stock itself left out. With the other liquid
  members of the industry, ``x = 0.5 x (their mean Strength percentile) + 0.5 x (the
  percentile, among industries, of their median 1-month change)``. An industry with
  fewer than 8 liquid members (the stock included) is replaced by the sector, computed
  the same way. Then it is shrunk toward the sector, ``g = (m x x_industry + 10 x
  x_sector) / (m + 10)`` with ``m`` the members counted, and the part is the
  percentile of ``g`` within L.

A PERCENTILE here is the mid-rank one: ``100 x (values below + half the values equal,
itself included) / values``. It is 50 for a lone value and for every member of an
all-equal set, never 0 or 100, and two stocks with one value share one percentile.

PURE: no I/O, no clock, no environment. The harness and the nightly pass call the same
function, so the score that is tested is the score that is stored.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from typing import Callable, Dict, Iterable, Optional

from . import rs_post_pass

# ── PRE-REGISTERED 2026-11-14 ────────────────────────────────────────────────
# The recipe below is the one the test record of that date is about. It must not
# change in place: a different weight, floor or constant is a NEW dated constant
# set beside this one, with its own test record (owner decision D1; the default
# for every part is KEEP, and the harness never changes a weight).
PREREGISTERED = "2026-11-14"
#: ``(part, weight)`` in the plan's order. The weights sum to 1.
WEIGHTS = (("strength", 0.40), ("steady", 0.25), ("high", 0.20), ("group", 0.15))
PARTS = tuple(name for name, _w in WEIGHTS)
#: ``near`` is 0 at this many percent under the high.
NEAR_ZERO_AT_PCT = 25.0
#: An industry (or a sector) needs this many liquid members, the stock included.
GROUP_MIN_MEMBERS = 8
#: The shrinkage's prior weight, in members: ``g = (m x + 10 x_sector) / (m + 10)``.
GROUP_SHRINK_MEMBERS = 10
#: The two halves of a group's value.
GROUP_RATING_SHARE = 0.5
GROUP_CHANGE_SHARE = 0.5

#: The row keys the function reads (a caller's SELECT list).
INPUT_KEYS = ("ticker", "is_etf", "price", "dollar_vol_30d", "rs_rating_score", "rs_steady",
              "px_below_high_pct", "rs_line_below_high_pct", "industry", "sector", "chg_pct_1m")
#: ``(level, row key)``: the industry is the group, the sector what it is shrunk toward.
_LEVELS = (("industry", "industry"), ("sector", "sector"))


def _num(v) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def _name(v) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def percentile_in(value: float, sorted_values: list) -> float:
    """The mid-rank percentile (module docstring) of ``value`` in a sorted list that
    already holds it."""
    below = bisect_left(sorted_values, value)
    equal = bisect_right(sorted_values, value) - below
    return 100.0 * (below + 0.5 * equal) / len(sorted_values)


def percentiles(values: Dict[str, object]) -> Dict[str, float]:
    """``{key: percentile}`` over the keys whose value is a number; the rest are left
    out (a stock with no value has no percentile and is not in the count)."""
    held = {k: f for k, f in ((k, _num(v)) for k, v in values.items()) if f is not None}
    ordered = sorted(held.values())
    return {k: percentile_in(f, ordered) for k, f in held.items()}


def near(pct) -> Optional[float]:
    """``100 x clip(1 + pct / 25, 0, 1)`` for a percent at or under zero: 100 at the
    high, 50 at 12.5% under it, 0 at 25% under it and beyond."""
    p = _num(pct)
    if p is None:
        return None
    return 100.0 * min(1.0, max(0.0, 1.0 + p / NEAR_ZERO_AT_PCT))


def _median_sorted(vals: list, skip: Optional[int] = None) -> Optional[float]:
    """The median of a sorted list, optionally without the element at ``skip``."""
    n = len(vals) - (1 if skip is not None else 0)
    if n <= 0:
        return None

    def at(i):
        return vals[i + 1] if skip is not None and i >= skip else vals[i]
    mid = n // 2
    return at(mid) if n % 2 else (at(mid - 1) + at(mid)) / 2.0


class _Level:
    """One grouping (industry or sector) over the reference set: who is in each group,
    and what each group looks like with one member left out."""

    def __init__(self, floor_rows: list, key: str, strength: Dict[str, float]):
        self.of: Dict[str, str] = {}
        members: Dict[str, list] = {}
        for r in floor_rows:
            g = _name(r.get(key))
            if g is not None:
                self.of[r["ticker"]] = g
                members.setdefault(g, []).append(r)
        self.strength = strength
        self.change = {r["ticker"]: _num(r.get("chg_pct_1m")) for r in floor_rows}
        self.groups = {}
        for g, rows in members.items():
            if len(rows) < GROUP_MIN_MEMBERS:
                continue                     # under the floor: no value at this level
            rated = [strength[r["ticker"]] for r in rows if r["ticker"] in strength]
            changes = sorted(c for c in (self.change[r["ticker"]] for r in rows) if c is not None)
            self.groups[g] = {"rated_sum": sum(rated), "rated_n": len(rated),
                              "changes": changes, "median": _median_sorted(changes)}

    def value(self, ticker: str):
        """``(x, m)`` for this stock's group with the stock left out, or ``None`` when
        the group is under the floor, has no other rated member or no other member with
        a 1-month change. ``m`` is the other members whose Strength was averaged."""
        g = self.of.get(ticker)
        info = self.groups.get(g) if g is not None else None
        if info is None:
            return None
        own = self.strength.get(ticker)
        m = info["rated_n"] - (1 if own is not None else 0)
        if m <= 0:
            return None
        mean_others = (info["rated_sum"] - (own or 0.0)) / m
        own_change = self.change.get(ticker)
        skip = bisect_left(info["changes"], own_change) if own_change is not None else None
        median_others = _median_sorted(info["changes"], skip)
        if median_others is None:
            return None
        # Against every OTHER group's whole median: the stock is in none of them.
        field = sorted([v["median"] for h, v in self.groups.items()
                        if h != g and v["median"] is not None] + [median_others])
        x = (GROUP_RATING_SHARE * mean_others
             + GROUP_CHANGE_SHARE * percentile_in(median_others, field))
        return x, m


def group_values(floor_rows: list, strength: Dict[str, float]) -> Dict[str, float]:
    """``{ticker: g}``: the shrunk group value BEFORE its percentile, for the rows of
    the reference set. A stock with no sector value has none (there is nothing to
    shrink toward, and nothing to fall back on)."""
    industry, sector = (_Level(floor_rows, key, strength) for _lvl, key in _LEVELS)
    out: Dict[str, float] = {}
    for r in floor_rows:
        t = r["ticker"]
        sec = sector.value(t)
        if sec is None:
            continue
        ind = industry.value(t)
        if ind is None:
            out[t] = sec[0]                  # under the industry floor: the sector, the same way
        else:
            x, m = ind
            out[t] = (m * x + GROUP_SHRINK_MEMBERS * sec[0]) / (m + GROUP_SHRINK_MEMBERS)
    return out


def combine(parts: dict, without: Optional[str] = None) -> Optional[float]:
    """The weighted sum of the parts, blank when any part read is blank. ``without``
    leaves one part out and rescales the other three weights to sum to 1 (the
    harness's leave-one-out report; the nightly never passes it)."""
    total = weight = 0.0
    for name, w in WEIGHTS:
        if name == without:
            continue
        v = parts.get(name)
        if v is None:
            return None
        total += w * v
        weight += w
    return total / weight if weight else None


def score_rows(rows: Iterable[dict], *,
               in_floor: Optional[Callable[[dict], bool]] = None) -> Dict[str, dict]:
    """``{ticker: {"score", "strength", "steady", "high", "group"}}`` for every row
    handed in. A row off the reference set holds ``None`` in all five; a row on it
    holds each part it has the inputs for, and a score only when it has all four.

    ``rows`` carry :data:`INPUT_KEYS`. ``in_floor`` decides the reference set; the
    default is the RS liquid floor without the full-year test. The harness, which
    builds the floor itself from bars as of each date, passes its own."""
    if in_floor is None:
        def in_floor(r):                                     # noqa: E306
            return rs_post_pass.on_liquid_floor(r, full_year=False)
    rows = [r for r in rows if r.get("ticker") is not None]
    out = {r["ticker"]: {"score": None, **{p: None for p in PARTS}} for r in rows}
    floor_rows = [r for r in rows if in_floor(r)]
    if not floor_rows:
        return out
    strength = percentiles({r["ticker"]: r.get("rs_rating_score") for r in floor_rows})
    steady = percentiles({r["ticker"]: r.get("rs_steady") for r in floor_rows})
    group = percentiles(group_values(floor_rows, strength))
    for r in floor_rows:
        t = r["ticker"]
        px, line = near(r.get("px_below_high_pct")), near(r.get("rs_line_below_high_pct"))
        parts = {"strength": strength.get(t), "steady": steady.get(t),
                 "high": None if px is None or line is None else (px + line) / 2.0,
                 "group": group.get(t)}
        out[t] = {"score": combine(parts), **parts}
    return out
