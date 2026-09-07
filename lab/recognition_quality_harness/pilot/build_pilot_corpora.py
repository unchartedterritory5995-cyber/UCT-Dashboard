"""Tier-1 pilot: build SMALL real-data corpora (bounded, not Corpus-B-scale)
for 10 representative detectors spanning candlestick / classical-structural /
MA-context / event-gap / momentum-trend / high-value-UCT categories.

Deliberately small per detector (target 3 fired + 4 not-fired = 7 cases) --
this is rapid triage, not a deep per-family loop. Uses the shared harness
(corpus_builder + renderer_profiles) so no per-detector script is
hand-written.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from api.services.pattern_engine.primitives.context import build_context
from api.services.pattern_engine.detectors.candlestick.bullish_engulfing import detect_bullish_engulfing
from api.services.pattern_engine.detectors.candlestick.three_white_soldiers import detect_three_white_soldiers
from api.services.pattern_engine.detectors.classical.cup_handle import detect_cup_handle
from api.services.pattern_engine.detectors.classical.head_shoulders import detect_head_shoulders
from api.services.pattern_engine.detectors.classical.golden_cross import detect_golden_cross
from api.services.pattern_engine.detectors.uct.vcp import detect_vcp
from api.services.pattern_engine.detectors.uct.power_earnings_gap import detect_power_earnings_gap
from api.services.pattern_engine.detectors.uct.episodic_pivot import detect_episodic_pivot
from api.services.pattern_engine.detectors.uct.remount import detect_remount
from api.services.pattern_engine.detectors.uct.wyckoff_spring import detect_wyckoff_spring

from lab.recognition_quality_harness.corpus_builder import CorpusSpec, build_corpus
from lab.recognition_quality_harness.renderer_profiles import (
    CANDLE_MORPHOLOGY, STRUCTURAL, MA_CONTEXT, EVENT_DRIVEN,
)

OUT_ROOT = Path(__file__).resolve().parent

# (detector_id, fn, profile, seed, as_of_offsets, universe_size, target_fired, target_not_fired)
PILOT_DETECTORS = [
    ("bullish_engulfing", detect_bullish_engulfing, CANDLE_MORPHOLOGY, 900101, (0, 40, 90, 160, 240), 900, 3, 4),
    ("three_white_soldiers", detect_three_white_soldiers, CANDLE_MORPHOLOGY, 900102, (0, 40, 90, 160, 240), 900, 3, 4),
    ("cup_handle", detect_cup_handle, STRUCTURAL, 900103, (0, 50, 110, 190), 700, 3, 4),
    ("head_shoulders", detect_head_shoulders, STRUCTURAL, 900104, (0, 50, 110, 190), 700, 3, 4),
    ("golden_cross", detect_golden_cross, MA_CONTEXT, 900105, (0, 60, 130, 220), 900, 3, 4),
    ("vcp", detect_vcp, STRUCTURAL, 900106, (0, 40, 90, 150), 700, 3, 4),
    ("power_earnings_gap", detect_power_earnings_gap, EVENT_DRIVEN, 900107, (0, 30, 70, 120, 200), 900, 3, 4),
    ("episodic_pivot", detect_episodic_pivot, EVENT_DRIVEN, 900108, (0, 30, 70, 120, 200), 900, 3, 4),
    ("remount", detect_remount, STRUCTURAL, 900109, (0, 40, 90, 150), 800, 3, 4),
    ("wyckoff_spring", detect_wyckoff_spring, STRUCTURAL, 900110, (0, 40, 90, 150), 800, 3, 4),
]


def main():
    summaries = []
    for detector_id, fn, profile, seed, offsets, universe, tf, tnf in PILOT_DETECTORS:
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
    print("PILOT CORPUS BUILD SUMMARY")
    print("=" * 70)
    for s in summaries:
        if "error" in s:
            print(f"{s['detector_id']:24s} FAILED: {s['error']}")
        else:
            print(f"{s['detector_id']:24s} fired_pool={s['fired_pool']:4d} "
                  f"not_fired_pool={s['not_fired_pool']:6d} sampled={s['total_cases']:2d} "
                  f"windows={s['windows_evaluated']:5d}")


if __name__ == "__main__":
    main()
