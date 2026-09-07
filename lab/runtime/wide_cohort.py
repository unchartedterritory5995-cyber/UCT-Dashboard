"""A wider, harder 22-detector cohort for the "does scale hold?" follow-up.

The prior pass (`cohort.py`, see RESULTS.md) benchmarked a bounded 6-family
cohort chosen for being easy to benchmark: hammer, bull_flag, vcp,
pullback_to_50sma, power_earnings_gap, stage_analysis. That pass explicitly
flagged the ~84 unmeasured detectors as an open question, singling out
"classical multi-pivot fitters like head_shoulders/triple_top" as likely
EXPENSIVE and unmeasured.

This module selects 22 detectors (of the ~103 registered surfaces total, per
`api/services/pattern_engine/detectors/registry.py`'s single shared dict —
counted by importing the full registrant set is out of scope here; the ~103
figure is the mission brief's own estimate) spanning every family the mission
brief asked for, deliberately including the previously-skipped heavy ones:

  - candlestick (single-candle):     hammer                 (existing cohort)
  - candlestick (multi-candle):      bearish_engulfing, morning_star,
                                      three_black_crows
  - structural:                      stage_analysis (existing), swing_pivots,
                                      support_resistance, major_trendlines,
                                      volume_profile_nodes
  - EXPENSIVE (read from source,
    see RESULTS_WIDE.md for why):    head_shoulders, triple_top, cup_handle
                                      — each does an O(k^3) combinatorial
                                      enumeration over the most recent 8-12
                                      swing pivots (triple nested loop), unlike
                                      the original cohort's detectors which are
                                      all O(n) single passes.
  - moving-average setups:           pullback_to_50sma (existing),
                                      pullback_to_10ema, golden_cross
  - momentum / breakout:             donchian_breakout, macd_bullish_cross,
                                      rsi_bullish_divergence, ascending_triangle
  - event / gap:                     power_earnings_gap (existing),
                                      episodic_pivot
  - growth / base:                   vcp (existing)

Importing each detector module registers ONLY these 22 pattern_ids (plus, as
an unavoidable side effect of importing `cohort` for its symbol-pool loader,
the two 6-family-cohort ids this list does not use: `bull_flag` is registered
but never included in WIDE_COHORT_PATTERN_IDS, so `detect_all(..., pattern_ids=
WIDE_COHORT_PATTERN_IDS)` never invokes it).
"""
from __future__ import annotations

import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

LAB_DIR = os.path.dirname(os.path.abspath(__file__))
if LAB_DIR not in sys.path:
    sys.path.insert(0, LAB_DIR)

# Reuse the prior pass's cohort module for its symbol-pool loader AND to pick
# up its 6 already-registered, already-characterized detectors (hammer, vcp,
# pullback_to_50sma, power_earnings_gap, stage_analysis are reused directly
# below; bull_flag registers as a side effect but is not part of this cohort).
import cohort  # noqa: E402

# ---- New detector registrations (16 beyond the 5 reused from cohort.py) ----
from api.services.pattern_engine.detectors.candlestick import bearish_engulfing  # noqa: E402,F401
from api.services.pattern_engine.detectors.candlestick import morning_star  # noqa: E402,F401
from api.services.pattern_engine.detectors.candlestick import three_black_crows  # noqa: E402,F401
from api.services.pattern_engine.detectors.structure import swing_pivots  # noqa: E402,F401
from api.services.pattern_engine.detectors.structure import support_resistance  # noqa: E402,F401
from api.services.pattern_engine.detectors.structure import major_trendlines  # noqa: E402,F401
from api.services.pattern_engine.detectors.structure import volume_profile_nodes  # noqa: E402,F401
from api.services.pattern_engine.detectors.classical import head_shoulders  # noqa: E402,F401
from api.services.pattern_engine.detectors.classical import triple_top  # noqa: E402,F401
from api.services.pattern_engine.detectors.classical import cup_handle  # noqa: E402,F401
from api.services.pattern_engine.detectors.uct import pullback_to_10ema  # noqa: E402,F401
from api.services.pattern_engine.detectors.classical import golden_cross  # noqa: E402,F401
from api.services.pattern_engine.detectors.classical import donchian_breakout  # noqa: E402,F401
from api.services.pattern_engine.detectors.classical import macd_bullish_cross  # noqa: E402,F401
from api.services.pattern_engine.detectors.classical import rsi_bullish_divergence  # noqa: E402,F401
from api.services.pattern_engine.detectors.classical import ascending_triangle  # noqa: E402,F401
from api.services.pattern_engine.detectors.uct import episodic_pivot  # noqa: E402,F401


WIDE_COHORT_PATTERN_IDS = [
    # reused from the 6-family cohort (bull_flag deliberately excluded)
    "hammer",
    "vcp",
    "pullback_to_50sma",
    "power_earnings_gap",
    "stage_analysis",
    # new: candlestick, multi-candle
    "bearish_engulfing",
    "morning_star",
    "three_black_crows",
    # new: structural
    "swing_pivots",
    "support_resistance",
    "major_trendlines",
    "volume_profile_nodes",
    # new: expensive classical multi-pivot fitters
    "head_shoulders",
    "triple_top",
    "cup_handle",
    # new: moving-average setups
    "pullback_to_10ema",
    "golden_cross",
    # new: momentum / breakout
    "donchian_breakout",
    "macd_bullish_cross",
    "rsi_bullish_divergence",
    "ascending_triangle",
    # new: event/gap
    "episodic_pivot",
]

assert len(WIDE_COHORT_PATTERN_IDS) == 22, len(WIDE_COHORT_PATTERN_IDS)

# Direct function handles for per-family timing (bypasses detect_all's
# dict-lookup + swallow-exceptions wrapper, so per-family wall clock is the
# pure detector cost) — same technique as cohort.py.
DETECTOR_FNS = {
    "hammer": cohort.DETECTOR_FNS["hammer"],
    "vcp": cohort.DETECTOR_FNS["vcp"],
    "pullback_to_50sma": cohort.DETECTOR_FNS["pullback_to_50sma"],
    "power_earnings_gap": cohort.DETECTOR_FNS["power_earnings_gap"],
    "stage_analysis": cohort.DETECTOR_FNS["stage_analysis"],
    "bearish_engulfing": bearish_engulfing.detect_bearish_engulfing,
    "morning_star": morning_star.detect_morning_star,
    "three_black_crows": three_black_crows.detect_three_black_crows,
    "swing_pivots": swing_pivots.detect_swing_pivots,
    "support_resistance": support_resistance.detect_support_resistance,
    "major_trendlines": major_trendlines.detect_major_trendlines,
    "volume_profile_nodes": volume_profile_nodes.detect_volume_profile_nodes,
    "head_shoulders": head_shoulders.detect_head_shoulders,
    "triple_top": triple_top.detect_triple_top,
    "cup_handle": cup_handle.detect_cup_handle,
    "pullback_to_10ema": pullback_to_10ema.detect_pullback_to_10ema,
    "golden_cross": golden_cross.detect_golden_cross,
    "donchian_breakout": donchian_breakout.detect_donchian_breakout,
    "macd_bullish_cross": macd_bullish_cross.detect_macd_bullish_cross,
    "rsi_bullish_divergence": rsi_bullish_divergence.detect_rsi_bullish_divergence,
    "ascending_triangle": ascending_triangle.detect_ascending_triangle,
    "episodic_pivot": episodic_pivot.detect_episodic_pivot,
}

assert set(DETECTOR_FNS) == set(WIDE_COHORT_PATTERN_IDS)

# Detectors in this cohort that independently call
# `detect_pivots(bars, window=3)` on the raw bars — verified by reading each
# file's imports + body (see RESULTS_WIDE.md). build_context() (the ONE
# shared per-symbol pass) never calls detect_pivots at all, so NONE of this
# cost is amortized anywhere — each call below is a fully independent O(n)
# fractal sweep over the same input.
PIVOT_CALLING_DETECTORS = [
    "vcp",
    "swing_pivots",
    "support_resistance",
    "major_trendlines",
    "head_shoulders",
    "triple_top",
    "cup_handle",
    "ascending_triangle",
]


def load_symbol_pool() -> list[str]:
    """Reuse cohort.py's confirmed real-symbol pool (>=220 stored daily bars)."""
    return cohort.load_symbol_pool()
