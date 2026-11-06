"""The signals the evidence job measures: five NAMED COLUMNS of
``api/services/relative_strength.py`` at the definition's DEFAULT inputs.

NO MATHS LIVES HERE. Every column is the one the chart draws, the screener
stores and the alert lane reads (`compute_phase1_columns`,
`compute_mansfield_columns`), so the evidence can never describe a different
event from the one a member sees (plan §2.3 principle 5). A test in
``tests/test_rs_evidence_job.py`` reads this package with an AST and fails if a
module imports its maths from anywhere but `relative_strength`.

Plan §9: "signal 3 uses the same 2 % tolerance as the dot" - it does, because
it IS the dot's column. The research base §(c) names RS-rating thresholds,
63/126-day highs, a 5 % price tolerance, negative divergence and
post-breakout confirmation as further signals; they are NOT measured here
(fixed definitions in advance; "no new variants until six months out of
sample") and need their own named columns first.
"""

from __future__ import annotations

from typing import Dict, Sequence

from api.services import relative_strength as rs

PHASE1 = "phase1"
MANSFIELD = "mansfield"

# name -> {column, source, definition}. The definition text is what the artifact
# carries beside each number so a card can say what was measured.
SIGNALS: Dict[str, dict] = {
    "rs_new_high": {
        "column": "rsNH", "source": PHASE1,
        "definition": "rs[t] >= max(rs[t-252 .. t-1]): the RS line (close / benchmark close) at a "
                      "one-year high, ties count; None until 252 prior bars exist without a gap",
    },
    "rs_new_high_before_price": {
        "column": "rsNHbeforePx", "source": PHASE1,
        "definition": "rsNH while price is NOT at its own 252-bar high: close < max(close[t-252 .. t-1]) "
                      "x (1 - 0.02), the gold dot's 2 % tolerance",
    },
    "rs_new_high_red_day": {
        "column": "rsNHred", "source": PHASE1,
        "definition": "rsNH on a red benchmark day: the benchmark close down at least 0.5 % on the bar",
    },
    "rs_cross_up_21ema": {
        "column": "crossUp", "source": PHASE1,
        "definition": "the RS line crosses from below to at-or-above its 21-bar EMA (gaps skipped, "
                      "not zeroed)",
    },
    "mansfield_cross_up": {
        "column": "mansfieldCrossUp", "source": MANSFIELD,
        "definition": "Mansfield RS ((rs x 100) / SMA(rs x 100, 200) - 1) x 100 crosses from below zero "
                      "to at-or-above zero",
    },
}


def inputs_used() -> dict:
    """The resolved inputs every signal column is computed with: the
    definition's defaults, resolved by the same function the route uses."""
    p = rs.resolve_phase1_inputs(None)
    p["mansfieldLength"] = rs.DEFAULT_MANSFIELD_LENGTH
    return p


def compute_signal_columns(bars: Sequence[dict], bench_bars: Sequence[dict],
                           signals: Dict[str, dict] = SIGNALS) -> Dict[str, list]:
    """``{signal name: event column aligned to bars}`` for one ticker, computed
    ONCE over the ticker's whole held history.

    WHY ONE COMPUTE OVER THE FULL SERIES IS STILL POINT-IN-TIME. Every column
    read here is CAUSAL: its value at bar ``t`` is a function of bars ``<= t``
    only, so recomputing over the series truncated at any session ``s`` gives
    the same value at every bar ``<= s`` (``tests/test_rs_evidence_job.py``
    asserts this against a true truncated recompute). Verified against the code,
    column by column:

    * ``rsLine[t] = C[t] / B[t]``, the benchmark joined by bar TIME
      (`indicator_compute.compute_rs_line_raw`) - reads bar ``t`` alone.
    * ``rsMa`` is an EMA over the valid values in order (`rs_moving_average`
      -> `compute_ema`: seed = SMA of the first ``length`` values, then
      ``k = 2 / (length + 1)`` recursion) - each value depends on the values at
      or before it. Its seed is fixed by the window START, which this job holds
      fixed (:data:`job.WARMUP_BARS` bars before the first measured session, so
      the start cannot move a cross: the seed's residual weight after 600 bars
      is ``(20/22)^600``, below 1e-24).
    * ``rsNH`` / ``pxNH``: `rolling_extreme_event` compares ``series[t]`` with
      ``series[t-N .. t-1]``.
    * ``crossUp``: `cross_columns` reads ``above[t]`` and ``above[t-1]``.
    * ``red``: `pct_change` reads ``B[t]`` and ``B[t-1]``.
    * ``mansfield``: an SMA over valid values at or before ``t``
      (`mansfield_column` -> `rs_moving_average(..., "SMA")`); its crosses are
      `cross_columns` again.

    What is NOT causal is the forward return, and that is measured separately
    (``measure.forward_excess``) from bars strictly after ``t``.

    ``short_history=False`` on purpose: the partial-lookback dots are a chart
    courtesy for a young listing, not a signal with a fixed definition.
    """
    bars = list(bars)
    bench = list(bench_bars)
    sources = {k: v["source"] for k, v in signals.items()}
    p1 = rs.compute_phase1_columns(bars, bench, None, short_history=False) if PHASE1 in sources.values() else {}
    p2 = (rs.compute_mansfield_columns(bars, bench, rs.DEFAULT_MANSFIELD_LENGTH)
          if MANSFIELD in sources.values() else {})
    out: Dict[str, list] = {}
    for name, spec in signals.items():
        src = p1 if spec["source"] == PHASE1 else p2
        out[name] = list(src[spec["column"]])
    return out
