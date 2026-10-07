"""Ruling R3 -- the ONE home of sample-size wording and its range (wave 13, lane 13B).

Every surface that shows a rate or a mean over a member's own trades words it by its sample:

    n < 10      "too few to judge"   the number rides along for a reveal, never shown plainly
    10 <= n < 25 "thin sample"       shown WITH a range (95%)
    n >= 25     normal               shown plainly

The range of a RATE is a Wilson score interval; the range of a MEAN (avg R) is a Student-t
interval. Both are deterministic arithmetic on the member's own numbers: no model, no p-value.

⛔ TWO FILES, ONE FACT. `app/src/pages/journal-2-0/lib/sampleSize.js` is the client's copy and
`tests/test_notebook_sample_size.py` runs BOTH implementations over the same grid (node, not a
restatement) so they cannot drift. Change a constant here and the rail reds until the JS moves too.

⛔ ROUNDING IS HALF-UP in both files (`_round`), never Python's banker's `round()`: the two
languages disagree on an exact tie under `round()`, and a parity rail that ignored ties would pass
by luck. Every operation below is written in the same order as its JS twin so the IEEE doubles
match bit for bit.

Consumers: 13A's discipline record (`plan_grading`, which imports from here -- decision 6 moved
it), 13B's playbook (`playbook_stats` uncertainty fields), and later 13F and 13I.
"""
from __future__ import annotations

import math
from typing import Any

#: R3: below this many, "too few to judge".
TOO_FEW_BELOW = 10
#: R3: from this many, normal.
NORMAL_FROM = 25
#: The z of the 95% Wilson interval.
RANGE_Z = 1.96

#: The wording per band. `normal` carries no qualifier.
WORDING = {"too_few": "too few to judge", "thin": "thin sample", "normal": None}

#: Two-sided 95% Student-t critical values, t(0.975, df), df = 1..30. Past 30 the normal z is used.
#: Only df 9..23 can reach a range (the thin band), the rest is here so the table is complete.
T975 = (
    12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
    2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
    2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
)


def _plain_sum(values: list[float]) -> float:
    """Left-to-right sum. ⛔ NOT the builtin `sum()`: since CPython 3.12 it compensates (Neumaier),
    and the JS twin's plain loop would then differ in the last bit."""
    total = 0.0
    for v in values:
        total += v
    return total


def _round(x: float, dp: int) -> float:
    """Half-up rounding, identical to the JS `Math.floor(x * 10**dp + 0.5) / 10**dp`."""
    f = 10 ** dp
    return math.floor(x * f + 0.5) / f


def band(n: int) -> str:
    """'too_few' | 'thin' | 'normal' for a sample of n."""
    if n < TOO_FEW_BELOW:
        return "too_few"
    if n < NORMAL_FROM:
        return "thin"
    return "normal"


def sample(n: int) -> dict[str, Any]:
    """The bare sample label: {n, band, wording}."""
    b = band(n)
    return {"n": n, "band": b, "wording": WORDING[b]}


def wilson(k: int, n: int, z: float | None = None) -> tuple[float, float] | None:
    """The Wilson score interval for k successes in n, rounded to 3 places; None for n <= 0."""
    if n <= 0:
        return None
    z = RANGE_Z if z is None else z
    p = k / n
    zz = z * z
    denom = 1 + zz / n
    center = (p + zz / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + zz / (4 * n * n)) / denom
    return (_round(max(0.0, center - half), 3), _round(min(1.0, center + half), 3))


def t_crit(df: int) -> float:
    """t(0.975, df) from the table; the normal z past it."""
    if df < 1:
        return float("nan")
    if df <= len(T975):
        return T975[df - 1]
    return RANGE_Z


def t_interval(values: list[float]) -> tuple[float, float] | None:
    """The 95% Student-t interval of the mean of `values`, rounded to 3 places; None below n=2."""
    n = len(values)
    if n < 2:
        return None
    mean = _plain_sum(values) / n
    ss = 0.0
    for v in values:
        d = v - mean
        ss += d * d
    sd = math.sqrt(ss / (n - 1))
    half = t_crit(n - 1) * sd / math.sqrt(n)
    return (_round(mean - half, 3), _round(mean + half, 3))


def rate_stat(k: int, n: int) -> dict[str, Any]:
    """A rate worded by its sample: under 10 "too few to judge" (the rate rides along for a
    reveal), 10-24 "thin sample" with a Wilson range, 25+ normal."""
    b = band(n)
    return {"k": k, "n": n, "rate": _round(k / n, 4) if n else None, "band": b,
            "wording": WORDING[b], "range": list(wilson(k, n)) if b == "thin" else None}


def mean_stat(values: list[float]) -> dict[str, Any]:
    """A mean worded by its sample: as `rate_stat`, with a Student-t range in the thin band."""
    n = len(values)
    b = band(n)
    rng = t_interval(values) if b == "thin" else None
    return {"n": n, "mean": _round(_plain_sum(values) / n, 4) if n else None, "band": b,
            "wording": WORDING[b], "range": list(rng) if rng is not None else None}


def constants() -> dict[str, Any]:
    """Everything a client needs to word a number the server did not word for it."""
    return {"tooFewBelow": TOO_FEW_BELOW, "normalFrom": NORMAL_FROM, "rangeZ": RANGE_Z,
            "wording": dict(WORDING)}
