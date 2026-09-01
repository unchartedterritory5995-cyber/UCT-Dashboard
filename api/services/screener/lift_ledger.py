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

✅ TWO LIMITATIONS FOUND ON THE FIRST RUN AND SINCE FIXED. Both had made the
published interval optimistically narrow; both are now closed, and the
weaker versions are kept only as the reason the stronger ones exist:

  1. **Observations cluster by ticker.** One name in a long consolidation
     contributes several anchors that share a regime, so treating them as
     independent understates the variance. The CI is now a CLUSTER BOOTSTRAP —
     tickers are resampled with replacement and the whole lift is recomputed,
     so within-ticker correlation is carried rather than assumed away.
     `_normal_ci` survives only as the naive comparison a test pins as wider.
  2. **A plain return shuffle destroys volatility clustering.** A detector that
     selects a quiet regime would then show lift the null cannot reproduce, and
     that lift would be a volatility effect wearing a structural edge's
     clothes. The null is now a MOVING-BLOCK bootstrap: contiguous blocks of
     returns are resampled, so local volatility structure survives and only the
     long-range order is destroyed.

⚠️ THE NULL IS THE PART MOST IMPLEMENTATIONS SKIP. Osler found average
simulated profits negative ~80% of the time on data where the pattern is
meaningless by construction; without that control a purely mechanical drag
reads as signal with the wrong sign. Here the null re-runs the IDENTICAL
detector over MOVING-BLOCK resampled series: contiguous blocks of returns are
drawn with replacement, so the marginal distribution AND local volatility
clustering survive while the long-range order is destroyed. Any lift the
detector still shows is an artifact of the detector, not of the market.
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

#: Base seed for the null. Trial k uses `NULL_SEED + k`, so a run of N trials
#: consumes seeds [NULL_SEED, NULL_SEED+N). That arithmetic is the reason the
#: expensive 30-trial escalation can be split across processes and recombined
#: EXACTLY: three 10-trial chunks at offsets 0/10/20 draw the same 30 seeds a
#: single sequential run would. ⛔ It is also the trap — two chunks given
#: overlapping seed ranges would count one trial twice and UNDERSTATE the null
#: maximum, which is the direction that wrongly PUBLISHES. Any caller that
#: recombines chunks must assert the ranges are disjoint and contiguous.
NULL_SEED = 20260830

#: A PUBLISHED row must have been graded against this many null trials. The
#: 5-trial setting is a SCREEN and nothing more: the gate compares the CI's
#: lower bound to the null's MAXIMUM, and a maximum can only grow with more
#: draws, so a small trial count is a strictly easier bar. Leaving that as a
#: procedural rule -- "remember to escalate" -- put the whole discipline in a
#: test that runs after the artifact is already written. It belongs in the
#: gate, so a screening run can screen and cannot publish.
ESCALATED_NULL_TRIALS = 30

#: Resamples for the cluster bootstrap CI. origin: uct.
BOOTSTRAP_TRIALS = 400

#: Moving-block length for the null, in bars. origin: uct — long enough to carry
#: a volatility episode (a quiet stretch or a shock runs days, not hours), short
#: enough that many blocks fit in a series and the long-range order is still
#: destroyed. ~1 trading month.
NULL_BLOCK_BARS = 21


def outcome(bars: List[dict], i: int, horizon: int = HORIZON_BARS,
            target: float = TARGET_PCT, stop: float = STOP_PCT,
            direction: str = "long") -> Optional[bool]:
    """Did the target come before the stop, starting from bar `i`?

    `True` target-first · `False` stop-first or neither · `None` not evaluable
    (no room left in the series, or an unusable anchor bar).

    ⚠️ `False` deliberately merges stop-first with neither-resolved. The
    question a member asks is "did this work", and an unresolved trade did not.
    Splitting them is a different, also-valid metric; mixing the two
    definitions between the conditional and the baseline would not be.

    ⭐⭐ `direction` MAKES "LIFT" MEAN THE SAME THING FOR EVERY STRUCTURE. The
    metric was a LONG outcome applied to all of them regardless of bias, and
    that made a bearish structure's number read backwards: `stage-4-breakdown`
    published +7.30pp, which under a long metric says price resolved UPWARD
    more often after a breakdown than baseline -- an oversold-bounce reading,
    and the exact opposite of what a reader seeing "Stage 4 Breakdown: +7.30pp"
    would assume. A number that requires a footnote to avoid being read as its
    own negation is not a number worth publishing.

    With `direction="short"` the same test runs mirrored: the target is a FALL
    of `target`, the stop a RISE of `stop`. A positive lift then means the same
    thing on both sides -- the structure resolved in ITS OWN direction more
    often than its pattern-free baseline did.

    ⛔ The baseline is measured with the SAME direction as the conditional
    half; comparing a short-side rate against a long-side baseline would be
    the definition mixing this docstring already warns about, one level up.
    """
    if i < 0 or i + horizon >= len(bars):
        return None
    entry = bars[i].get("c") or 0
    if entry <= 0:
        return None
    if direction == "short":
        hit, miss = entry * (1 - target), entry * (1 + stop)
        for j in range(i + 1, i + 1 + horizon):
            b = bars[j]
            lo, hi = b.get("l") or 0, b.get("h") or 0
            if lo <= 0 or hi <= 0:
                continue
            if hi >= miss:
                return False
            if lo <= hit:
                return True
        return False

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


#: Module-level tally of anchors where the detector RAISED. Reset by
#: `measure`; read by it to refuse a run that is mostly exceptions.
_SCAN_ERRORS = [0]


def scan_series(detect: Callable, bars: List[dict], *, step: int = HORIZON_BARS,
                window: int = 400, min_history: int = 260,
                horizon: int = HORIZON_BARS,
                direction: str = "long") -> List[tuple]:
    """Walk one ticker and return `(year, fired, outcome)` per anchor.

    ⛔ The detector only ever sees `bars[:i+1]` — never a bar after the anchor.
    A look-ahead here would not fail loudly; it would quietly produce a
    spectacular lift.
    """
    out = []
    n = len(bars)
    for i in range(min_history, n - horizon - 1, step):
        res = outcome(bars, i, horizon=horizon, direction=direction)
        if res is None:
            continue
        lo = max(0, i + 1 - window)
        try:
            fired = bool(detect(bars[lo:i + 1]))
        except Exception:
            # ⛔ COUNTED, NOT MERELY SKIPPED. A detector that raises on EVERY
            # anchor produced an identical result to one that simply never
            # fired — n=0 — and that is how a broken adapter shipped a
            # confident "no detections" for a structure the live coverage
            # check found on 21 symbols. `errors` makes the two
            # distinguishable, and `measure` refuses when they dominate.
            _SCAN_ERRORS[0] += 1
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


#: Per-structure swallowed-exception counts for a shared scan. The single
#: `_SCAN_ERRORS` counter cannot serve a multi-detector pass: one broken
#: detector would poison every structure's refusal check in the same run.
_SCAN_ERRORS_BY: Dict[str, int] = {}


def scan_series_many(detectors: Dict[str, Callable], bars: List[dict], *,
                     prepare: Optional[Callable] = None,
                     step: int = HORIZON_BARS, window: int = 400,
                     min_history: int = 260,
                     horizon: int = HORIZON_BARS,
                     direction: str = "long") -> Dict[str, List[tuple]]:
    """`scan_series` for several detectors at once, over ONE pass.

    ⭐⭐ WHY THIS EXISTS. Every detector was re-deriving the same thing. The
    runner's per-anchor work is `bases._context(w, w)`, which runs the
    volatility-scaled zigzag: 2.28 ms against detectors costing 0.25-0.5 ms.
    Measuring fourteen structures separately therefore segmented the same
    window fourteen times, and a full-universe pass would have taken ~20
    hours. Sharing the context makes it one segmentation per anchor for the
    whole group.

    `prepare` turns the raw window into whatever the detectors consume (here,
    a `BaseCtx`). It is called ONCE per anchor.

    ⛔ THE DETECTORS MUST NOT MUTATE what `prepare` returns. They share the
    object, so a detector that wrote to it would silently change what every
    later detector in the same anchor sees — a class of bug that would not
    raise and would not be visible in any single-structure test. The
    equivalence rail below is what makes that assumption checkable: it asserts
    the shared pass returns exactly what fourteen separate passes would.
    """
    out: Dict[str, List[tuple]] = {k: [] for k in detectors}
    for k in detectors:
        _SCAN_ERRORS_BY[k] = 0
    n = len(bars)
    for i in range(min_history, n - horizon - 1, step):
        res = outcome(bars, i, horizon=horizon, direction=direction)
        if res is None:
            continue
        lo = max(0, i + 1 - window)
        w = bars[lo:i + 1]
        shared = prepare(w) if prepare is not None else w
        year = _year_of(bars[i].get("t"))
        for key, det in detectors.items():
            try:
                fired = bool(det(shared))
            except Exception:
                _SCAN_ERRORS_BY[key] += 1
                continue
            out[key].append((year, fired, res))
    return out


def measure_many(detectors: Dict[str, Callable],
                 bars_by_ticker: Dict[str, List[dict]], *,
                 prepare: Optional[Callable] = None,
                 bootstrap: int = BOOTSTRAP_TRIALS,
                 seed: int = 20260830, **kw) -> Dict[str, dict]:
    """`measure` for several detectors sharing one pass per ticker.

    Returns the same result dict per key that `measure` would return alone.
    """
    rows_by_key: Dict[str, Dict[str, List[tuple]]] = {k: {} for k in detectors}
    errors: Dict[str, int] = {k: 0 for k in detectors}
    for sym, bars in bars_by_ticker.items():
        got = scan_series_many(detectors, bars, prepare=prepare, **kw)
        for key, rows in got.items():
            if rows:
                rows_by_key[key][sym] = rows
            errors[key] += _SCAN_ERRORS_BY.get(key, 0)

    out: Dict[str, dict] = {}
    for key in detectors:
        out[key] = _finish(rows_by_key[key], errors[key], bootstrap, seed)
    return out


def null_lifts_many(detectors: Dict[str, Callable],
                    bars_by_ticker: Dict[str, List[dict]], *,
                    prepare: Optional[Callable] = None,
                    trials: int = NULL_TRIALS, seed: int = NULL_SEED,
                    **kw) -> Dict[str, List[float]]:
    """Null lifts for several detectors over the SAME shuffled series.

    ⭐ The shuffle is per (trial, ticker) and is reused across detectors, so a
    group's null costs one set of resamples rather than one per structure.
    Each trial still uses `seed + k`, so a group run and a single-structure run
    draw the identical series — which is what lets the two be compared.
    """
    out: Dict[str, List[float]] = {k: [] for k in detectors}
    for t in range(trials):
        rng = random.Random(seed + t)
        shuffled = {}
        for sym, bars in bars_by_ticker.items():
            sh = shuffle_returns(bars, rng)
            if sh:
                shuffled[sym] = sh
        got = measure_many(detectors, shuffled, prepare=prepare,
                           bootstrap=0, **kw)
        for key, r in got.items():
            if r["lift"] is not None:
                out[key].append(r["lift"])
    return out


def measure(detect: Callable, bars_by_ticker: Dict[str, List[dict]],
            *, bootstrap: int = BOOTSTRAP_TRIALS, seed: int = 20260830,
            **kw) -> dict:
    """Conditional rate, pattern-free baseline over the same years, and lift.

    ⛔ THE CI IS A CLUSTER BOOTSTRAP OVER TICKERS, NOT A TWO-PROPORTION FORMULA.
    Detections are not independent draws: one name in a long consolidation
    contributes many anchors that share a regime, so the textbook standard
    error understates the variance and every interval comes out too narrow.
    Resampling TICKERS with replacement carries that correlation instead of
    assuming it away.
    """
    _SCAN_ERRORS[0] = 0
    rows_by_ticker: Dict[str, List[tuple]] = {}
    for sym, bars in bars_by_ticker.items():
        r = scan_series(detect, bars, **kw)
        if r:
            rows_by_ticker[sym] = r

    return _finish(rows_by_ticker, _SCAN_ERRORS[0], bootstrap, seed)


def _finish(rows_by_ticker: Dict[str, List[tuple]], errors: int,
            bootstrap: int, seed: int) -> dict:
    """The statistics half of `measure`, shared with the multi-detector path.

    ⛔ ONE IMPLEMENTATION, NOT TWO. A second copy of the tally, the baseline
    restriction and the cluster bootstrap would be a second authority over
    every published number, and the two would drift the first time either was
    touched.
    """
    flat = [row for rows in rows_by_ticker.values() for row in rows]
    t = _tally(flat)
    t["scan_errors"] = errors
    n, free_n = t["n"], t["free_n"]
    # ⛔ A RUN THAT IS MOSTLY EXCEPTIONS IS NOT A MEASUREMENT. Without this a
    # broken adapter reports n=0 and reads as "the structure never fired".
    if errors and errors > len(flat):
        return {**t, "rate": None, "baseline": None, "lift": None,
                "ci_low": None, "ci_high": None, "anchors": len(flat),
                "ci_method": None, "naive_ci": None,
                "refused": f"the detector raised on {errors} anchors"}
    if n == 0 or free_n == 0:
        return {**t, "rate": None, "baseline": None, "lift": None,
                "ci_low": None, "ci_high": None, "anchors": len(flat),
                "ci_method": None, "naive_ci": None}

    p_c = t["wins"] / n
    p_b = t["free_wins"] / free_n
    lift = p_c - p_b

    naive_se = math.sqrt(_wilson_se(p_c, n) ** 2 + _wilson_se(p_b, free_n) ** 2)
    naive = (lift - Z * naive_se, lift + Z * naive_se)

    # ⚡ `bootstrap=0` SKIPS THE CI ENTIRELY. The null trials read only the
    # POINT estimate, so a 400-draw cluster interval per trial is work nothing
    # looks at.
    #
    # ⚠️ AND IT IS A SMALL WIN, NOT THE BIG ONE. I wrote "a large share of the
    # runtime" here before measuring, then measured: 23.5s with the bootstrap
    # vs 20.7s without, over 1,985 anchors — **12% of a pass**, roughly 5-6
    # minutes off a 46-minute structure. Worth keeping because it is free, but
    # the dominant cost is the DETECTOR SCAN itself, so the real lever on Wave
    # E's runtime is the null TRIAL COUNT (screen at 5, escalate to 30 only on
    # a pass), not this.
    if bootstrap <= 0:
        lo = hi = None
    else:
        lo, hi = _cluster_bootstrap_ci(rows_by_ticker, bootstrap, seed)
    return {**t, "rate": p_c, "baseline": p_b, "lift": lift,
            "ci_low": lo, "ci_high": hi, "anchors": len(flat),
            "ci_method": "cluster-bootstrap", "naive_ci": naive,
            "tickers": len(rows_by_ticker)}


def _lift_of(flat: List[tuple]) -> Optional[float]:
    t = _tally(flat)
    if t["n"] == 0 or t["free_n"] == 0:
        return None
    return t["wins"] / t["n"] - t["free_wins"] / t["free_n"]


def _cluster_bootstrap_ci(rows_by_ticker: Dict[str, List[tuple]],
                          trials: int, seed: int):
    """Percentile CI from resampling TICKERS with replacement.

    Each draw rebuilds the whole lift from a resampled set of symbols, so a
    ticker that contributed 40 correlated anchors moves in or out as ONE unit —
    which is exactly the dependence the naive formula ignores.
    """
    syms = list(rows_by_ticker)
    if len(syms) < 2:
        return (float("-inf"), float("inf"))
    rng = random.Random(seed)
    lifts = []
    for _ in range(trials):
        pick = [syms[rng.randrange(len(syms))] for _ in range(len(syms))]
        flat = [row for s in pick for row in rows_by_ticker[s]]
        v = _lift_of(flat)
        if v is not None:
            lifts.append(v)
    if len(lifts) < 20:
        return (float("-inf"), float("inf"))
    lifts.sort()
    lo = lifts[int(0.025 * (len(lifts) - 1))]
    hi = lifts[int(0.975 * (len(lifts) - 1))]
    return (lo, hi)


def shuffle_returns(bars: List[dict], rng: random.Random,
                    block: int = NULL_BLOCK_BARS) -> List[dict]:
    """A series with the same return distribution and no long-range structure.

    ⭐ MOVING-BLOCK, NOT IID. An independent shuffle destroys volatility
    clustering along with the order, and that matters here: a structure like a
    Darvas box SELECTS a quiet stretch, so against an iid null it would show
    lift that is really a volatility effect wearing a structural edge's
    clothes. Drawing contiguous `block`-length runs keeps quiet stretches quiet
    and shocks bunched, so the null a detector is measured against has the same
    volatility texture as the market — and only the long-range order, which is
    the thing the detector claims to read, is gone.

    Blocks are drawn with replacement from all overlapping start positions (the
    standard moving-block bootstrap). The bar's own high/low/open ride along as
    fixed proportions of its close so range geometry stays realistic.
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
    if not rets:
        return []
    if block <= 1 or len(rets) <= block:
        rng.shuffle(rets)
    else:
        drawn: List[float] = []
        last_start = len(rets) - block
        while len(drawn) < len(rets):
            st = rng.randint(0, last_start)
            drawn.extend(rets[st:st + block])
        rets = drawn[:len(rets)]

    out, c = [], closes[0]
    for i, (o_r, h_r, l_r, v, t) in enumerate(shape):
        if i:
            c = c * rets[i - 1]
        out.append({"t": t, "o": c * o_r, "h": c * h_r, "l": c * l_r,
                    "c": c, "v": v})
    return out


def null_lifts(detect: Callable, bars_by_ticker: Dict[str, List[dict]],
               trials: int = NULL_TRIALS, seed: int = NULL_SEED, **kw) -> List[float]:
    """The lift this detector produces on data where it CANNOT be right."""
    out = []
    for k in range(trials):
        rng = random.Random(seed + k)
        shuffled = {}
        for sym, bars in bars_by_ticker.items():
            s = shuffle_returns(bars, rng)
            if s:
                shuffled[sym] = s
        r = measure(detect, shuffled, bootstrap=0, **kw)
        if r["lift"] is not None:
            out.append(r["lift"])
    return out


def directions_for_bias(bias: str) -> List[str]:
    """EVERY metric direction a structure of this bias may be graded on.

    ⛔ ONE DEFINITION, READ BY THE RUNNER, THE RE-ADJUDICATION AND THE RAIL.
    A second copy of this mapping is how a row ends up graded one way and
    checked another.

    ⛔⛔ AND THAT IS EXACTLY WHAT HAPPENED. `run_lift_ledger._directions_of`
    grew its own copy mapping neutral -> ["long", "short"], while this module
    mapped neutral -> "long" alone -- under the docstring above, in the runner
    it names. The consequence was not cosmetic: `direction_is_wrong` would have
    flagged a neutral structure published on the short side, so the runner's
    documented "a neutral structure is graded BOTH ways" could not produce an
    artifact that passed the suite. The list lives here now and the runner
    reads it.

    ⭐ A NEUTRAL STRUCTURE IS GRADED BOTH WAYS because grading it long is a
    directional claim made on its behalf. A box is a range; its author
    describes a frame, not a forecast. Measured both ways, a structure positive
    on ONE side marks direction and one positive on BOTH marks volatility --
    price left the range either way, which is a different and still useful fact.
    """
    if bias == "bearish":
        return ["short"]
    if bias == "neutral":
        return ["long", "short"]
    return ["long"]


def direction_for_bias(bias: str) -> str:
    """The single direction a row is PUBLISHED on. Derived, never restated."""
    return directions_for_bias(bias)[0]


def direction_is_wrong(key: str, row: dict) -> bool:
    """Is this row graded on a metric that answers its structure's question?

    A bearish structure graded LONG produces a number that reads as its own
    negation: `stage-4-breakdown` published +7.30pp, which on a long metric
    says price resolved UPWARD after a breakdown. Publishing that is worse
    than publishing nothing, so a mismatch is a refusal rather than a note.
    """
    from api.services.screener import base_catalog as _bc

    st = _bc.by_key(key)
    if st is None or row.get("direction") is None:
        return False
    # ⛔ MEMBERSHIP, NOT EQUALITY. A neutral structure is legitimately graded
    # both ways, so testing against a single direction would refuse a correct
    # short measurement of `darvas-box` or `square-box`. What makes a row wrong
    # is being graded on a metric its structure does not ask -- a BEARISH
    # structure on the long metric -- not being graded on the second of two
    # legitimate ones.
    return row["direction"] not in directions_for_bias(getattr(st, "bias", ""))


#: The date the same-date clustering was measured. A published row's interval
#: is only honest relative to a clustering measurement, so this stamps when the
#: rho behind every `cluster_deff` in the ledger was taken.
CLUSTER_MEASURED_AT = "2026-09-01"


def clustered_bounds(lift: float, ci_low: float, ci_high: float,
                     deff: float) -> tuple:
    """Widen a bootstrap interval for MEASURED same-date correlation.

    ⛔⛔ THE HOLE THIS CLOSES, AND WHY IT WAS INVISIBLE. Every interval in
    this ledger comes from a cluster bootstrap that resamples TICKERS. That is
    correct for one axis -- one ticker's anchors are not independent of each
    other -- and it is silent about the other: a structure that fires on
    hundreds of DIFFERENT names on the SAME DAY has, on that day, one market
    event and not hundreds of observations. Nothing in the bootstrap can see
    that, so the interval it returns is too NARROW, and every gate below reads
    an interval's bound.

    ⭐ IT IS MEASURED, NOT ASSUMED. The tempting move is to bracket a plausible
    correlation and publish a range. The outcomes are on file, so instead the
    within-date intra-class correlation of the win/loss outcome is computed
    directly (one-way random effects, unequal clusters) and

        deff = 1 + (m_eff - 1) * rho

    is the factor by which the true variance exceeds the bootstrap's. An
    interval's half-width scales with its square root. Measured
    2026-09-01 over 650 tickers, rho ran 0.129 to 0.351 across the
    published rows -- large enough that two of the seven no longer clear their
    gates.

    ⛔ THE WIDENING IS ABOUT THE POINT ESTIMATE, NOT THE INTERVAL'S MIDPOINT.
    A bootstrap interval is not symmetric about `lift`, and re-centring it here
    would move the estimate as a side effect of a variance correction.
    """
    w = math.sqrt(deff)
    return lift - (lift - ci_low) * w, lift + (ci_high - lift) * w


def synthetic_nulls(row: dict) -> list:
    """The null vector `adjudicate` needs, rebuilt from a stored row.

    ⭐ EXACT, NOT APPROXIMATE. `adjudicate` reads exactly two things off the
    null list -- `max(...)` for gate 2 and `len(...)` for the trial-count gate
    -- so a list of `null_trials` copies of `null_max` produces byte-identical
    verdicts to the original draws. That is what lets a row be re-adjudicated
    under a new gate without re-measuring the whole library, and it is why this
    returns a list rather than the two scalars: the ONE gate function stays the
    only place the gates are written down.
    """
    if row.get("null_lifts"):
        return list(row["null_lifts"])
    nmax, trials = row.get("null_max"), row.get("null_trials")
    if nmax is None or not trials:
        return []
    return [nmax] * int(trials)


def readjudicate(row: dict, deff: Optional[float]) -> dict:
    """Re-run the gates over a STORED row, adding the clustering correction."""
    result = {k: row.get(k) for k in
              ("lift", "ci_low", "ci_high", "n", "rate", "baseline", "years")}
    return adjudicate(result, synthetic_nulls(row), deff=deff)


def adjudicate(result: dict, nulls: List[float],
               deff: Optional[float] = None) -> dict:
    """Apply the gates. A failure emits NO lift key.

    ⛔⛔ GATES 1 AND 2 TEST THE CLUSTERED BOUND, NOT THE BOOTSTRAP'S.
    `deff` is the measured same-date design effect (see `clustered_bounds`).
    Without it the interval understates its own width, so a row that has
    never had its clustering measured is REFUSED rather than published on
    the narrow bound -- a published number is a claim about noise, and
    half the noise term missing is not a smaller claim, it is an unfounded
    one. Refused rows need no `deff`: their bound is not load-bearing.

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

    if deff is None:
        reasons.append(
            "the same-date clustering of this structure's anchors has not "
            "been measured, so its interval is the ticker-only bootstrap's "
            "and is known to be too narrow by an unknown factor "
            "(`clustered_bounds`)")
        lo, hi = result["ci_low"], result["ci_high"]
    else:
        lo, hi = clustered_bounds(lift, result["ci_low"],
                                  result["ci_high"], deff)

    if not (lo > 0 or hi < 0):
        reasons.append(
            f"95% CI [{lo:+.4f}, {hi:+.4f}] includes zero at "
            f"n={result['n']} (widened for a measured same-date design "
            f"effect of {deff:.2f})" if deff is not None else
            f"95% CI [{lo:+.4f}, {hi:+.4f}] includes zero at "
            f"n={result['n']}")

    # ⛔⛔ GATE ZERO: THE LIFT MUST BE POSITIVE. This was missing, and it is not
    # a theoretical hole -- it FIRED. `cheat-3c` measured -1.10pp with a CI of
    # [-2.16, -0.09] against a null max of -3.91pp, and PUBLISHED: its interval
    # excludes zero (both bounds negative) and its lower bound does clear a
    # null that is even more negative. A structure that reliably UNDERPERFORMS
    # its own baseline was therefore surfaced to members through
    # `filters._structure_evidence` as a measured edge.
    #
    # ⚠️ I described this exact hole while comparing ALTERNATIVE gates -- "any
    # relaxation needs a sign condition or it publishes losers" -- and did not
    # notice the shipped gate had it. It never fired only because no structure
    # had yet landed with a negative lift sitting above a more-negative null.
    #
    # A negative result is a FINDING and belongs in the artifact with its
    # reasons. It is not a lift to put in front of a member.
    if lift <= 0:
        reasons.append(
            f"the measured lift {lift:+.4f} is not positive: the structure "
            f"resolved no better than its own pattern-free baseline, so there "
            f"is no edge to publish (the result is kept as a finding)")

    if nulls and len(nulls) < ESCALATED_NULL_TRIALS:
        reasons.append(
            f"graded against only {len(nulls)} null trials; a published row "
            f"requires {ESCALATED_NULL_TRIALS}, because the null's maximum "
            f"can only grow with more draws and a smaller count is a strictly "
            f"easier bar (re-run with --null-trials {ESCALATED_NULL_TRIALS})")

    if nulls:
        worst = max(nulls)
        # ⛔⛔ COMPARE THE CI's LOWER BOUND TO THE NULL, NOT THE POINT ESTIMATE.
        # Measured 2026-08-30 on the first real run: the Power Play produced a
        # +32.97pp lift on n=13 with a CI of [+6.52, +59.43], while its own null
        # reached +13.80pp on 5 trials. The point estimate cleared the null
        # easily and the structure "published" — but the pessimistic end of its
        # own interval sat BELOW the null, i.e. the result was entirely
        # consistent with the detector's mechanical drag on random data.
        # Comparing the lower bound asks the right question: does even the
        # unfavourable reading of our estimate beat noise? Darvas passes it
        # (+5.78 vs +2.31); the Power Play does not, and should not.
        # ⛔ THE FLOOR IS THE CLUSTERED ONE. Comparing the bootstrap's
        # narrower bound to the null asks whether an interval we know is
        # too tight clears noise -- which is how `low-cheat` passed by
        # 0.43pp on a bound that the measured design effect widens past
        # its own null.
        floor = lo
        if floor <= worst:
            reasons.append(
                f"the lift's CI lower bound {floor:+.4f}"
                + (f" (widened for a measured same-date design effect of "
                   f"{deff:.2f})" if deff is not None else "")
                + f" does not exceed the random-data null (max of "
                  f"{len(nulls)} trials = {worst:+.4f}) at n={result['n']}")
    else:
        reasons.append("no random-data null could be computed")

    if reasons:
        return {"published": False, "reasons": reasons, "n": result["n"]}
    return {"published": True, "lift": lift, "n": result["n"],
            "ci_low": result["ci_low"], "ci_high": result["ci_high"],
            "rate": result["rate"], "baseline": result["baseline"],
            "years": result["years"]}


# ── the artifact ───────────────────────────────────────────────────────────
# ⛔ A MEASUREMENT NOBODY CAN READ IS NOT A MEASUREMENT. `lesson_built_tested_
# green_and_unreachable` is the repo's own name for this: a module that
# computes the right answer and is wired to no surface has shipped nothing.
# The ledger's results are therefore PERSISTED as a dated artifact and read
# back by `base_catalog.meta()`, so the number a member sees and the number the
# harness produced are the same object.
#
# ⛔ THE LEDGER IS THE ONLY AUTHORITY ON LIFT. `Structure` deliberately has no
# `lift` field — copying the number onto the catalog entry would put a second
# authority on one value, which is this repo's most repeated defect. The
# catalog says what a structure IS; the ledger says what it has been measured
# to do, and it may say "nothing yet".

import json
import os

LEDGER_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))),
    "docs", "base_lift_ledger.json")

_CACHE: Optional[dict] = None


def load(path: str = None) -> dict:
    """The measured ledger, or an empty one. Never raises.

    A missing or malformed artifact reads as "nothing has been measured" —
    which is the honest state, and the one every consumer already handles.
    """
    global _CACHE
    if _CACHE is not None and path is None:
        return _CACHE
    p = path or LEDGER_PATH
    try:
        with open(p, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}
    if path is None:
        _CACHE = data
    return data


def for_structure(key: str, path: str = None) -> Optional[dict]:
    """The published entry for `key`, or None.

    ⛔ Returns None for BOTH "never measured" and "measured and refused". That
    is deliberate: to a member the two produce the same honest statement — we
    have no number for this — and collapsing them here stops a caller from
    rendering a refusal as a weak positive. The reason is still readable in the
    artifact for anyone auditing it.
    """
    entry = (load(path).get("structures") or {}).get(key)
    if not entry or not entry.get("published"):
        return None
    return entry


def evidence_for_structure(key: str, path: str = None) -> Optional[dict]:
    """What a MEMBER-FACING surface should say about a structure's measurement.

    ⭐ THREE STATES, NOT TWO, AND THE THIRD IS THE INTERESTING ONE.
    `for_structure` deliberately collapses "never measured" and "measured and
    refused" into None, and its reasoning is right as far as it goes: a caller
    must never render a refusal as a weak positive. But those two ARE different
    facts -- "we looked and it did not clear the bar" is the ledger's actual
    work, and hiding it behind the same sentence as "we never looked" throws
    away the part of this project that is worth the most.

    ⛔ SO THE REFUSAL CARRIES NO NUMERIC FIELD. Not `lift`, not the interval,
    not `n` -- only `published: false` and the reasons the gates gave. That is
    what makes rendering it as a weak positive STRUCTURALLY IMPOSSIBLE rather
    than merely discouraged: a caller has nothing to headline. It is the same
    concern `for_structure` documents, satisfied by construction instead of by
    omission.

    ⚠️ BE PRECISE ABOUT WHAT THAT DOES NOT SAY. A reason's PROSE may quote the
    figure -- flat-base's reads "the measured lift -0.1056 is not positive" --
    and that is fine and wanted: the sentence is explicitly a refusal, it reads
    as one, and it cannot be mistaken for a published edge the way a bare
    `lift` field can. The guarantee is about fields a caller can render, not
    about digits never appearing.

    ⛔ `for_structure` IS UNCHANGED. Three other callers depend on its
    contract; this is an additional view for the provenance route, not a
    redefinition of the old one.
    """
    entry = (load(path).get("structures") or {}).get(key)
    if not entry:
        return None
    if entry.get("published"):
        # ⛔⛔ THE MEMBER SEES THE CLUSTERED INTERVAL, DERIVED HERE AND
        # STORED NOWHERE. The artifact keeps only MEASUREMENTS -- the
        # bootstrap's bounds and the design effect -- because a widened
        # bound written back beside its own input is a value that widens
        # again on the next pass. Deriving it at the one surface that
        # renders it makes double-application impossible rather than
        # merely unlikely.
        deff = gate_deff(entry)
        if deff is None or entry.get("lift") is None:
            return entry
        lo, hi = clustered_bounds(entry["lift"], entry["ci_low"],
                                  entry["ci_high"], deff)
        out = dict(entry)
        out["ci_low"], out["ci_high"] = round(lo, 4), round(hi, 4)
        out["ci_basis"] = "clustered"
        return out
    reasons = [r for r in (entry.get("reasons") or []) if isinstance(r, str) and r]
    if not reasons:
        return None
    # ⛔ "WE LOOKED AND IT DID NOT CLEAR THE BAR" AND "WE HAVE NOT LOOKED YET"
    # ARE DIFFERENT CLAIMS, and flattening them puts a false one on screen: the
    # panel labelled a never-run structure "measured, not published", which
    # credits us with work we have not done. The tell is whether the row
    # carries a `lift` at all — a run always writes one, even when every gate
    # refuses it.
    return {"published": False, "reasons": reasons,
            "measured": entry.get("lift") is not None}


def gate_deff(entry: dict) -> Optional[float]:
    """The design effect a GATE should widen by: rho's UPPER bound, not its point.

    ⛔⛔ THE INCONSISTENCY THIS CLOSES WAS MINE. Gate 2 in this module
    already refuses to compare a POINT estimate to the null -- it reads the CI's
    lower bound, on the reasoning that the pessimistic end is the honest one.
    Gate 4 then corrected for clustering using the POINT estimate of rho, which
    understates the variance half the time. Exactly the same mistake, one level
    up, written by the same hand a few hours later.

    ⭐ IT CHANGED NO VERDICT, and that is the finding rather than a reason to
    skip it: measured 2026-09-01, every published row clears its null on rho's
    upper bound too, and both refused rows stay refused. The library is robust to
    the estimate; the gate is now principled regardless.

    Falls back to the point estimate for a row measured before rho carried an
    interval -- a weaker bar, but a recorded one, and better than refusing a row
    for the absence of a field its measurement predates.
    """
    for field in ("cluster_deff_conservative", "cluster_deff"):
        v = entry.get(field)
        if isinstance(v, (int, float)):
            return float(v)
    return None


def stored_deff(key: str, path: str = None) -> Optional[float]:
    """The measured same-date design effect for one structure, or None.

    ⛔ A RE-RUN MUST NOT SILENTLY RELAX ITS OWN GATE. `adjudicate` refuses
    a row with no `deff`, so a runner that simply omitted it would unpublish
    the whole library on the next pass and read as a measurement result.
    The clustering is a property of the anchors' distribution in time, so
    the value already in the artifact remains the right input until the
    clustering itself is re-measured.
    """
    return gate_deff((load(path).get("structures") or {}).get(key) or {})


#: How long a measurement may stand before it must be re-taken. origin: uct —
#: what this measures (whether a multi-week structure beats the market's own
#: base rate) moves on a quarterly timescale, not a nightly one, so a quarter
#: plus a month of slack is the bound. Shorter would cry wolf; much longer and
#: a number could outlive the market regime that produced it.
MAX_LEDGER_AGE_DAYS = 120


def row_measured_at(key: str, path: str = None):
    """When THIS row was measured -- not when the file was last written.

    ⭐@@STAR@ WHY THIS EXISTS. `measured_at()` reads ONE header field, and
    `tools/run_lift_ledger.py` rewrites it on every run including a `--only`
    re-measure of a single structure. So measuring one row stamped today's date
    on all of them, and `is_stale()` reported the whole ledger fresh while rows
    measured weeks earlier sat untouched. That is precisely the defect already
    fixed for `sample` -- whose rail says in its own words "The size is a
    property of the row" -- left standing for its twin, the date.

    ⛔ THE FALLBACK IS EXPLICIT, NEVER SILENT. Rows written before the
    runner started stamping dates have none. Returning the header date for them
    would rebuild the very lie this function exists to end, so the caller is
    told the value was INHERITED and can decide what to do about it.

    Returns `(date_or_None, inherited: bool)`.
    """
    data = load(path)
    row = (data.get("structures") or {}).get(key) or {}
    own = row.get("measured_at")
    if own:
        return _parse_day(own), False
    return _parse_day(data.get("measured_at")), True


def stale_rows(max_age_days: int = None, path: str = None, today=None):
    """Every row whose OWN measurement is older than the bound.

    ⛔ A row with no date of its own is reported as UNKNOWN rather than
    assumed fresh -- absence of evidence is not evidence of freshness, and this
    artifact's numbers are shown to paying members.
    """
    import datetime as _dt
    max_age_days = MAX_LEDGER_AGE_DAYS if max_age_days is None else max_age_days
    today = today or _dt.date.today()
    out = {"stale": [], "unknown": [], "fresh": []}
    for key in (load(path).get("structures") or {}):
        when, inherited = row_measured_at(key, path)
        if when is None or inherited:
            out["unknown"].append(key)
        elif (today - when).days > max_age_days:
            out["stale"].append(key)
        else:
            out["fresh"].append(key)
    return out


def _parse_day(raw):
    import datetime as _dt
    if not raw:
        return None
    try:
        return _dt.date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def measured_at(path: str = None):
    """The artifact's own date, or None if it does not record one."""
    import datetime as _dt
    raw = load(path).get("measured_at")
    try:
        return _dt.date.fromisoformat(str(raw))
    except Exception:
        return None


def age_days(path: str = None, today=None) -> Optional[int]:
    import datetime as _dt
    when = measured_at(path)
    if when is None:
        return None
    return ((today or _dt.date.today()) - when).days


def is_stale(max_age_days: int = MAX_LEDGER_AGE_DAYS, path: str = None,
             today=None) -> bool:
    """⛔ A MEASUREMENT WITH NO REFRESH GOES WRONG SILENTLY.

    This is the other half of the pair with `tools/run_lift_ledger.py`. The
    harness is a deliberate tool rather than a cron job (the web pod already
    carries ~135 jobs and cannot shed them), which means nothing re-runs it on
    its own — so the freshness guarantee has to be a rail that goes RED. A job
    that silently stops running is invisible; a failing test is not.

    An artifact with NO date is stale by definition: an undated number cannot
    be known to be current.
    """
    age = age_days(path, today=today)
    return True if age is None else age > max_age_days
