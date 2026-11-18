"""The test's arithmetic: quintiles, the bootstrap, the pass rule. Pure functions over
plain numbers, so each one is checked against a case worked by hand.
"""
from __future__ import annotations

import math
import random
from statistics import median
from typing import Dict, List, Optional, Sequence

from . import spec


def mean(values) -> Optional[float]:
    vals = [v for v in values if v is not None]
    return sum(vals) / len(vals) if vals else None


def med(values) -> Optional[float]:
    vals = [v for v in values if v is not None]
    return median(vals) if vals else None


def share(flags) -> Optional[float]:
    """The share of ``True`` among the flags that are not ``None``."""
    vals = [bool(f) for f in flags if f is not None]
    return sum(vals) / len(vals) if vals else None


def quantile_of(rank: int, n: int, quantiles: int = spec.QUANTILES) -> int:
    """The quantile (1 = bottom, ``quantiles`` = top) of the stock ``rank`` places from
    the bottom (0 = lowest) among ``n``: ``floor(rank x quantiles / n) + 1``. With 25
    stocks each quintile holds 5; with 27 they hold 6, 5, 6, 5, 5."""
    return rank * quantiles // n + 1


def quintiles(scores: Dict[str, float]) -> Dict[str, int]:
    """``{ticker: quintile}``, 5 = the highest scores. Ties are ordered by ticker so the
    split never depends on dict order."""
    ordered = sorted(scores, key=lambda t: (scores[t], t))
    n = len(ordered)
    return {t: quantile_of(r, n) for r, t in enumerate(ordered)}


def top(scores: Dict[str, float], n: int = spec.TOP_N) -> List[str]:
    """The ``n`` highest, best first; ties by ticker."""
    return sorted(scores, key=lambda t: (-scores[t], t))[:n]


def spearman(xs: Sequence[float], ys: Sequence[float]) -> Optional[float]:
    """Spearman's rank correlation (ties share the mean rank); ``None`` when a side is
    constant or the lengths differ or are under 2."""
    if len(xs) != len(ys) or len(xs) < 2:
        return None

    def ranks(vals):
        order = sorted(range(len(vals)), key=lambda i: vals[i])
        out = [0.0] * len(vals)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and vals[order[j + 1]] == vals[order[i]]:
                j += 1
            for k in range(i, j + 1):
                out[order[k]] = (i + j) / 2.0 + 1.0
            i = j + 1
        return out
    rx, ry = ranks(list(xs)), ranks(list(ys))
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    sxx = sum((a - mx) ** 2 for a in rx)
    syy = sum((b - my) ** 2 for b in ry)
    if sxx == 0 or syy == 0:
        return None
    return sum((a - mx) * (b - my) for a, b in zip(rx, ry)) / math.sqrt(sxx * syy)


def block_bootstrap(values: Sequence[float], *, block: int = spec.BOOTSTRAP_BLOCK_DATES,
                    draws: int = spec.BOOTSTRAP_DRAWS, interval: float = spec.BOOTSTRAP_INTERVAL,
                    seed: int = spec.BOOTSTRAP_SEED) -> Optional[dict]:
    """A moving-block bootstrap of the mean of ``values`` (one per formation date, in
    date order). Each draw glues ``ceil(n / block)`` blocks of ``block`` consecutive
    values, each starting at a uniformly chosen position, cuts the result to ``n``
    values and takes its mean. The interval is the percentile one: with 2,000 draws and
    90%, the 101st and the 1,900th of the sorted means.

    ``None`` when there are fewer values than one block: no interval can be formed, and
    the pass rule then fails rather than reading a short series as a clean one."""
    vals = list(values)
    n = len(vals)
    if n < block or block <= 0 or draws <= 0:
        return None
    rng = random.Random(seed)
    starts = n - block + 1
    need = math.ceil(n / block)
    means = []
    for _ in range(draws):
        total, count = 0.0, 0
        for _b in range(need):
            s = rng.randrange(starts)
            take = min(block, n - count)
            total += sum(vals[s:s + take])
            count += take
        means.append(total / n)
    means.sort()
    # Rounded, not floored: (1 - 0.9) / 2 x 2000 is 99.99999999999997 in floating point.
    cut = int(round((1.0 - interval) / 2.0 * draws))
    lo, hi = means[cut], means[draws - cut - 1]
    return {"low": lo, "high": hi, "draws": draws, "block_dates": block, "seed": seed,
            "interval": interval, "values": n}


def independent_blocks(session_indexes: Sequence[int],
                       span: int = spec.PRIMARY_HORIZON) -> int:
    """How many formation dates can be picked, oldest first, so that each is at least
    ``span`` sessions after the one before: the count of non-overlapping windows the
    result stands on (five dates a month share most of their 21 sessions)."""
    count, last = 0, None
    for k in sorted(session_indexes):
        if last is None or k - last >= span:
            count += 1
            last = k
    return count


def by_year(dated: Sequence[tuple]) -> Dict[int, List[float]]:
    """``{year: [values]}`` from ``(YYYYMMDD, value)`` pairs with a value."""
    out: Dict[int, List[float]] = {}
    for day, v in dated:
        if v is not None:
            out.setdefault(int(day) // 10000, []).append(v)
    return out


def years_compared(per_year: Dict[int, List[float]]) -> List[int]:
    """The ``spec.YEARS_COMPARED`` most recent calendar years holding at least
    ``spec.YEAR_MIN_FORMATION_DATES`` values, oldest first (fewer when fewer exist)."""
    ok = sorted(y for y, vals in per_year.items() if len(vals) >= spec.YEAR_MIN_FORMATION_DATES)
    return ok[-spec.YEARS_COMPARED:]


def year_rule(per_year: Dict[int, List[float]]) -> dict:
    """Criterion 2: positive in at least 3 of the 4 most recent eligible years. With
    fewer than 4 eligible years the rule cannot be asked and is NOT met."""
    years = years_compared(per_year)
    means = {y: sum(per_year[y]) / len(per_year[y]) for y in years}
    positive = sum(1 for m in means.values() if m > 0)
    enough = len(years) == spec.YEARS_COMPARED
    return {"years": {str(y): {"mean": means[y], "dates": len(per_year[y])} for y in years},
            "positive": positive, "eligible_years": len(years),
            "met": bool(enough and positive >= spec.YEARS_POSITIVE_MIN),
            "reason": None if enough else
            f"needs {spec.YEARS_COMPARED} calendar years with "
            f"{spec.YEAR_MIN_FORMATION_DATES}+ formation dates, found {len(years)}"}


def leave_one_out_rule(full: Dict[int, List[float]], without: Dict[int, List[float]]) -> dict:
    """Did removing a part raise the primary spread by ``LEAVE_ONE_OUT_MIN_GAIN_PCT``
    points or more in at least ``LEAVE_ONE_OUT_YEARS_MIN`` of the years compared?
    A REPORT: the decision stays KEEP, and nothing here changes a weight."""
    years = years_compared(full)
    gains = {}
    for y in years:
        if without.get(y):
            gains[y] = sum(without[y]) / len(without[y]) - sum(full[y]) / len(full[y])
    improved = sum(1 for g in gains.values() if g >= spec.LEAVE_ONE_OUT_MIN_GAIN_PCT)
    helps = len(years) == spec.YEARS_COMPARED and improved >= spec.LEAVE_ONE_OUT_YEARS_MIN
    return {"gain_by_year": {str(y): g for y, g in gains.items()},
            "years_improved": improved, "years_compared": len(years),
            "removal_helps": bool(helps), "decision": "KEEP"}
