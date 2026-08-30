"""Measured LIFT for a named structure — the evidence layer.

⭐⭐ WHY LIFT AND NEVER A HIT RATE. A structure that resolves 57% of the time
sounds like an edge and is a NEGATIVE signal if the universe resolves 57.8% of
the time unconditionally. Measured in the corpus, that is not hypothetical:
head-and-shoulders came in at 42.0% against a 42.0% pattern-free baseline
(n=2,795) and double bottom at 56.9% against 57.8% (n=6,692). Publishing the
raw rate would have shipped both as wins. So this module publishes
`lift = conditional - pattern_free`, and the raw rate never reaches a member
on its own.

⭐ AND THE BASELINE IS PER-YEAR, BECAUSE IT DRIFTS. Measured over 3,705 real
tickers: target-first ran 17.1% in 2018 and 35.7% in 2020. A structure that
happened to fire mostly in 2020 would show a huge "edge" against a pooled
constant. Every comparison here is against the baseline of the SAME years the
structure actually fired in.

⛔ THREE GATES, AND A FAILURE EMITS NO KEY AT ALL.
  1. the lift's 95% CI excludes zero
  2. the lift exceeds the structure's OWN random-data null
  3. n is whatever (1) requires — DERIVED, never a typed `n >= 30`

`pattern_join.py` already documents what happens when a gate is `is not None`
instead: a synthetic 0.0 shipped to members as a measurement across 46 of 79
rows. An unmeasured structure here has NO lift key. `0.0` would mean "measured,
and it is exactly break-even", which is a different and much rarer fact.

⛔ NON-OVERLAPPING WINDOWS. Anchors are stepped by the full horizon, so no two
observations share a forward window. Overlapping windows inflate n and shrink
the CI without adding information — the fastest way to manufacture a
significant result from noise.

⚠️ THE NULL IS THE PART MOST IMPLEMENTATIONS SKIP. Osler found average
simulated profits negative ~80% of the time on data where the pattern is
meaningless by construction; without that control a purely mechanical drag
reads as signal with the wrong sign. Here the null re-runs the IDENTICAL
detector over return-shuffled series: the marginal return distribution is
preserved and the temporal structure is destroyed, so any lift the detector
still shows is an artifact of the detector, not of the market.
"""
from __future__ import annotations

import math
import random
from typing import Callable, Dict, List, Optional

#: The tradeable question, and the same one the universe baseline was measured
#: on: does a 10%-target / 8%-stop trade reach its target before its stop
#: within 20 sessions? Measured unconditionally over 3,705 tickers x 10 years:
#: 27.51% target-first, 33.41% stop-first, 39.08% neither.
HORIZON_BARS = 20
TARGET_PCT = 0.10
STOP_PCT = 0.08

#: 95% two-sided.
Z = 1.959964

#: Trials for the random-data null. origin: uct — enough to place the observed
#: lift against a spread rather than a single draw, bounded by the fact that
#: each trial re-runs the detector over the whole sample.
NULL_TRIALS = 12


def outcome(bars: List[dict], i: int, horizon: int = HORIZON_BARS,
            target: float = TARGET_PCT, stop: float = STOP_PCT) -> Optional[bool]:
    """Did the target come before the stop, starting from bar `i`?

    `True` target-first · `False` stop-first or neither · `None` not evaluable
    (no room left in the series, or an unusable anchor bar).

    ⚠️ `False` deliberately merges stop-first with neither-resolved. The
    question a member asks is "did this work", and an unresolved trade did not.
    Splitting them is a different, also-valid metric; mixing the two
    definitions between the conditional and the baseline would not be.
    """
    if i < 0 or i + horizon >= len(bars):
        return None
    entry = bars[i].get("c") or 0
    if entry <= 0:
        return None
    up, dn = entry * (1 + target), entry * (1 - stop)
    for j in range(i + 1, i + 1 + horizon):
        b = bars[j]
        lo, hi = b.get("l") or 0, b.get("h") or 0
        if lo <= 0 or hi <= 0:
            continue
        if lo <= dn:
            return False
        if hi >= up:
            return True
    return False


def _year_of(t) -> str:
    v = int(t)
    return str(v // 10000) if 10_000_000 <= v <= 99_999_999 else "?"


def _wilson_se(p: float, n: int) -> float:
    return math.sqrt(p * (1 - p) / n) if n > 0 else float("inf")


def scan_series(detect: Callable, bars: List[dict], *, step: int = HORIZON_BARS,
                window: int = 400, min_history: int = 260,
                horizon: int = HORIZON_BARS) -> List[tuple]:
    """Walk one ticker and return `(year, fired, outcome)` per anchor.

    ⛔ The detector only ever sees `bars[:i+1]` — never a bar after the anchor.
    A look-ahead here would not fail loudly; it would quietly produce a
    spectacular lift.
    """
    out = []
    n = len(bars)
    for i in range(min_history, n - horizon - 1, step):
        res = outcome(bars, i, horizon=horizon)
        if res is None:
            continue
        lo = max(0, i + 1 - window)
        try:
            fired = bool(detect(bars[lo:i + 1]))
        except Exception:
            continue
        out.append((_year_of(bars[i].get("t")), fired, res))
    return out


def _tally(rows: List[tuple]) -> dict:
    """Conditional vs PATTERN-FREE rate, the pattern-free half restricted to
    the years the structure actually fired in."""
    hit_n = hit_w = 0
    by_year_fired: Dict[str, int] = {}
    for year, fired, res in rows:
        if fired:
            hit_n += 1
            hit_w += 1 if res else 0
            by_year_fired[year] = by_year_fired.get(year, 0) + 1

    free_n = free_w = 0
    for year, fired, res in rows:
        if not fired and year in by_year_fired:
            free_n += 1
            free_w += 1 if res else 0
    return {"n": hit_n, "wins": hit_w, "free_n": free_n, "free_wins": free_w,
            "years": sorted(by_year_fired)}


def measure(detect: Callable, bars_by_ticker: Dict[str, List[dict]], **kw) -> dict:
    """Conditional rate, pattern-free baseline over the same years, and lift."""
    rows: List[tuple] = []
    for bars in bars_by_ticker.values():
        rows.extend(scan_series(detect, bars, **kw))
    t = _tally(rows)
    n, free_n = t["n"], t["free_n"]
    if n == 0 or free_n == 0:
        return {**t, "rate": None, "baseline": None, "lift": None,
                "ci_low": None, "ci_high": None, "anchors": len(rows)}
    p_c = t["wins"] / n
    p_b = t["free_wins"] / free_n
    lift = p_c - p_b
    se = math.sqrt(_wilson_se(p_c, n) ** 2 + _wilson_se(p_b, free_n) ** 2)
    return {**t, "rate": p_c, "baseline": p_b, "lift": lift,
            "ci_low": lift - Z * se, "ci_high": lift + Z * se,
            "anchors": len(rows)}


def shuffle_returns(bars: List[dict], rng: random.Random) -> List[dict]:
    """A series with the SAME return distribution and NO temporal structure.

    Close-to-close returns are shuffled and replayed from the original first
    close; the bar's own high/low/open are carried as fixed proportions of its
    close so range geometry stays realistic. What is destroyed is the ORDER —
    which is exactly the thing every structure detector claims to read.
    """
    closes = [b.get("c") or 0 for b in bars]
    rets, shape = [], []
    for i, b in enumerate(bars):
        c = closes[i]
        if c <= 0:
            return []
        shape.append(((b.get("o") or c) / c, (b.get("h") or c) / c,
                      (b.get("l") or c) / c, b.get("v") or 0, b.get("t")))
        if i:
            prev = closes[i - 1]
            rets.append(c / prev if prev > 0 else 1.0)
    rng.shuffle(rets)

    out, c = [], closes[0]
    for i, (o_r, h_r, l_r, v, t) in enumerate(shape):
        if i:
            c = c * rets[i - 1]
        out.append({"t": t, "o": c * o_r, "h": c * h_r, "l": c * l_r,
                    "c": c, "v": v})
    return out


def null_lifts(detect: Callable, bars_by_ticker: Dict[str, List[dict]],
               trials: int = NULL_TRIALS, seed: int = 20260830, **kw) -> List[float]:
    """The lift this detector produces on data where it CANNOT be right."""
    out = []
    for k in range(trials):
        rng = random.Random(seed + k)
        shuffled = {}
        for sym, bars in bars_by_ticker.items():
            s = shuffle_returns(bars, rng)
            if s:
                shuffled[sym] = s
        r = measure(detect, shuffled, **kw)
        if r["lift"] is not None:
            out.append(r["lift"])
    return out


def adjudicate(result: dict, nulls: List[float]) -> dict:
    """Apply the three gates. A failure emits NO lift key.

    ⛔ The return value carries `lift` ONLY when every gate passes. Callers must
    render a missing key as "not measured" and must never substitute 0.0 —
    `pattern_join` shipped a synthetic breakeven to members across 46 of 79
    rows by treating absence as zero.
    """
    reasons = []
    lift = result.get("lift")
    if lift is None:
        reasons.append("no detections, or no pattern-free anchors in the same years")
        return {"published": False, "reasons": reasons, "n": result.get("n", 0)}

    if not (result["ci_low"] > 0 or result["ci_high"] < 0):
        reasons.append(
            f"95% CI [{result['ci_low']:+.4f}, {result['ci_high']:+.4f}] "
            f"includes zero at n={result['n']}")

    if nulls:
        worst = max(nulls)
        if lift <= worst:
            reasons.append(
                f"lift {lift:+.4f} does not exceed the random-data null "
                f"(max of {len(nulls)} trials = {worst:+.4f})")
    else:
        reasons.append("no random-data null could be computed")

    if reasons:
        return {"published": False, "reasons": reasons, "n": result["n"]}
    return {"published": True, "lift": lift, "n": result["n"],
            "ci_low": result["ci_low"], "ci_high": result["ci_high"],
            "rate": result["rate"], "baseline": result["baseline"],
            "years": result["years"]}
