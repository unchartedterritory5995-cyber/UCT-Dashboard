"""Wave 1: Tier-1-only small corpora for 24 new detectors (value-weighted
selection spanning candlestick / classical-structural / MA-context /
breakout / momentum / reversal-mirror / volume / UCT-flagship categories).

Excludes all 13 already-evaluated detectors (3 deep-cycle + 10 pilot).
Mirrors pilot/build_pilot_corpora.py exactly -- no per-detector script.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from api.services.pattern_engine.primitives.context import build_context

from api.services.pattern_engine.detectors.candlestick.shooting_star import detect_shooting_star
from api.services.pattern_engine.detectors.candlestick.morning_star import detect_morning_star
from api.services.pattern_engine.detectors.candlestick.three_black_crows import detect_three_black_crows
from api.services.pattern_engine.detectors.candlestick.marubozu import detect_marubozu
from api.services.pattern_engine.detectors.candlestick.bearish_engulfing import detect_bearish_engulfing
from api.services.pattern_engine.detectors.candlestick.hanging_man import detect_hanging_man
from api.services.pattern_engine.detectors.classical.double_bottom import detect_double_bottom
from api.services.pattern_engine.detectors.classical.ascending_triangle import detect_ascending_triangle
from api.services.pattern_engine.detectors.uct.flat_base import detect_flat_base
from api.services.pattern_engine.detectors.classical.rounded_base import detect_rounded_base
from api.services.pattern_engine.detectors.uct.high_tight_flag import detect_high_tight_flag
from api.services.pattern_engine.detectors.uct.u_and_r import detect_u_and_r
from api.services.pattern_engine.detectors.uct.wyckoff_upthrust import detect_wyckoff_upthrust
from api.services.pattern_engine.detectors.classical.bollinger_squeeze import detect_bollinger_squeeze
from api.services.pattern_engine.detectors.classical.rsi_bullish_divergence import detect_rsi_bullish_divergence
from api.services.pattern_engine.detectors.uct.qullamaggie_setup import detect_qullamaggie_setup
from api.services.pattern_engine.detectors.classical.death_cross import detect_death_cross
from api.services.pattern_engine.detectors.uct.pullback_to_50sma import detect_pullback_to_50sma
from api.services.pattern_engine.detectors.structure.stage_analysis import detect_stage_analysis
from api.services.pattern_engine.detectors.uct.opening_range_breakout import detect_opening_range_breakout
from api.services.pattern_engine.detectors.uct.avwap_reclaim import detect_avwap_reclaim
from api.services.pattern_engine.detectors.classical.nr7 import detect_nr7
from api.services.pattern_engine.detectors.classical.vsa_no_supply import detect_vsa_no_supply
from api.services.pattern_engine.detectors.structure.accumulation_distribution import detect_accumulation_distribution

from lab.recognition_quality_harness.corpus_builder import CorpusSpec, build_corpus
from lab.recognition_quality_harness.renderer_profiles import (
    CANDLE_MORPHOLOGY, STRUCTURAL, MA_CONTEXT, EVENT_DRIVEN,
)

OUT_ROOT = Path(__file__).resolve().parent

# (detector_id, fn, profile, seed, as_of_offsets, universe_size, target_fired, target_not_fired)
WAVE1_DETECTORS = [
    # Candlestick / multi-candle
    ("shooting_star", detect_shooting_star, CANDLE_MORPHOLOGY, 910101, (0, 40, 90, 160, 240), 900, 3, 4),
    ("morning_star", detect_morning_star, CANDLE_MORPHOLOGY, 910102, (0, 40, 90, 160, 240), 900, 3, 4),
    ("three_black_crows", detect_three_black_crows, CANDLE_MORPHOLOGY, 910103, (0, 40, 90, 160, 240), 900, 3, 4),
    ("marubozu", detect_marubozu, CANDLE_MORPHOLOGY, 910104, (0, 40, 90, 160, 240), 900, 3, 4),
    ("bearish_engulfing", detect_bearish_engulfing, CANDLE_MORPHOLOGY, 910105, (0, 40, 90, 160, 240), 900, 3, 4),
    ("hanging_man", detect_hanging_man, CANDLE_MORPHOLOGY, 910106, (0, 40, 90, 160, 240), 900, 3, 4),
    ("nr7", detect_nr7, CANDLE_MORPHOLOGY, 910107, (0, 30, 70, 120, 180), 900, 3, 4),
    ("vsa_no_supply", detect_vsa_no_supply, CANDLE_MORPHOLOGY, 910108, (0, 30, 70, 120, 180), 900, 3, 4),
    ("accumulation_distribution", detect_accumulation_distribution, CANDLE_MORPHOLOGY, 910109, (0, 30, 70, 120, 180), 900, 3, 4),
    # Classical structural / UCT structural
    ("double_bottom", detect_double_bottom, STRUCTURAL, 910110, (0, 50, 110, 190), 700, 3, 4),
    ("ascending_triangle", detect_ascending_triangle, STRUCTURAL, 910111, (0, 50, 110, 190), 700, 3, 4),
    ("flat_base", detect_flat_base, STRUCTURAL, 910112, (0, 50, 110, 190), 700, 3, 4),
    ("rounded_base", detect_rounded_base, STRUCTURAL, 910113, (0, 50, 110, 190), 700, 3, 4),
    ("high_tight_flag", detect_high_tight_flag, STRUCTURAL, 910114, (0, 40, 90, 150), 800, 3, 4),
    ("u_and_r", detect_u_and_r, STRUCTURAL, 910115, (0, 40, 90, 150), 800, 3, 4),
    ("wyckoff_upthrust", detect_wyckoff_upthrust, STRUCTURAL, 910116, (0, 40, 90, 150), 800, 3, 4),
    ("bollinger_squeeze", detect_bollinger_squeeze, STRUCTURAL, 910117, (0, 40, 90, 150), 800, 3, 4),
    ("rsi_bullish_divergence", detect_rsi_bullish_divergence, STRUCTURAL, 910118, (0, 40, 90, 150), 800, 3, 4),
    ("qullamaggie_setup", detect_qullamaggie_setup, STRUCTURAL, 910119, (0, 40, 90, 150), 800, 3, 4),
    # MA / context
    ("death_cross", detect_death_cross, MA_CONTEXT, 910120, (0, 60, 130, 220), 900, 3, 4),
    ("pullback_to_50sma", detect_pullback_to_50sma, MA_CONTEXT, 910121, (0, 60, 130, 220), 900, 3, 4),
    ("stage_analysis", detect_stage_analysis, MA_CONTEXT, 910122, (0, 60, 130, 220), 900, 3, 4),
    # Event / breakout
    ("opening_range_breakout", detect_opening_range_breakout, EVENT_DRIVEN, 910123, (0, 30, 70, 120, 200), 900, 3, 4),
    ("avwap_reclaim", detect_avwap_reclaim, EVENT_DRIVEN, 910124, (0, 30, 70, 120, 200), 900, 3, 4),
]


def main():
    summaries = []
    for detector_id, fn, profile, seed, offsets, universe, tf, tnf in WAVE1_DETECTORS:
        spec = CorpusSpec(
            detector_id=detector_id,
            detector_fn=fn,
            context_fn=build_context,
            render_profile=profile,
            out_dir=OUT_ROOT / detector_id,
            seed=seed,
            as_of_offsets=offsets,
            universe_sample_size=universe,
            target_fired=tf,
            target_not_fired=tnf,
            repo_root=REPO_ROOT,
        )
        try:
            summary = build_corpus(spec)
        except Exception as exc:
            print(f"[FAIL] {detector_id}: {exc!r}")
            import traceback; traceback.print_exc()
            summary = {"detector_id": detector_id, "error": repr(exc)}
        summaries.append(summary)
        print()

    print("=" * 70)
    print("WAVE 1 CORPUS BUILD SUMMARY")
    print("=" * 70)
    for s in summaries:
        if "error" in s:
            print(f"{s['detector_id']:28s} FAILED: {s['error']}")
        else:
            print(f"{s['detector_id']:28s} fired_pool={s['fired_pool']:4d} "
                  f"not_fired_pool={s['not_fired_pool']:6d} sampled={s['total_cases']:2d} "
                  f"windows={s['windows_evaluated']:5d}")


if __name__ == "__main__":
    main()
