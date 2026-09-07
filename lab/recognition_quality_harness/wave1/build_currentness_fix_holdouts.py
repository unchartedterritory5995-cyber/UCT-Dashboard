"""Fresh, disjoint Tier-1 holdout corpora for the 4 detectors that received the
shared post-trigger currentness fix (shooting_star, hanging_man,
bearish_engulfing, pullback_to_50sma). New seeds -- does NOT reuse the
Wave-1 adjudicated corpora, which are now regression sets. Built against the
FIXED detector code, so `detector_fired` in each answer key already reflects
the corrected behavior.

Intentionally NOT self-judged -- the coordinator dispatches a separate,
zero-context judge against these corpora, per the owner's explicit
independence requirement for this remediation pass.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from api.services.pattern_engine.primitives.context import build_context

from api.services.pattern_engine.detectors.candlestick.shooting_star import detect_shooting_star
from api.services.pattern_engine.detectors.candlestick.hanging_man import detect_hanging_man
from api.services.pattern_engine.detectors.candlestick.bearish_engulfing import detect_bearish_engulfing
from api.services.pattern_engine.detectors.uct.pullback_to_50sma import detect_pullback_to_50sma

from lab.recognition_quality_harness.corpus_builder import CorpusSpec, build_corpus
from lab.recognition_quality_harness.renderer_profiles import CANDLE_MORPHOLOGY, MA_CONTEXT

OUT_ROOT = Path(__file__).resolve().parent / "holdouts_currentness_fix"

# New, disjoint seeds (Wave-1 used 910101/910105/910106/910121) and disjoint
# as_of_offsets sets from the originals.
DETECTORS = [
    ("shooting_star", detect_shooting_star, CANDLE_MORPHOLOGY, 920201, (5, 55, 105, 175, 255), 900, 3, 4),
    ("hanging_man", detect_hanging_man, CANDLE_MORPHOLOGY, 920206, (5, 55, 105, 175, 255), 900, 3, 4),
    ("bearish_engulfing", detect_bearish_engulfing, CANDLE_MORPHOLOGY, 920205, (5, 55, 105, 175, 255), 900, 3, 4),
    ("pullback_to_50sma", detect_pullback_to_50sma, MA_CONTEXT, 920221, (10, 75, 145, 235), 900, 3, 4),
]


def main():
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    for det_id, fn, profile, seed, offsets, universe, tgt_fired, tgt_not in DETECTORS:
        spec = CorpusSpec(
            detector_id=det_id,
            detector_fn=fn,
            context_fn=build_context,
            render_profile=profile,
            out_dir=OUT_ROOT / det_id,
            seed=seed,
            as_of_offsets=offsets,
            universe_sample_size=universe,
            target_fired=tgt_fired,
            target_not_fired=tgt_not,
            repo_root=REPO_ROOT,
        )
        result = build_corpus(spec, verbose=True)
        print(f"[{det_id}] built {result}")


if __name__ == "__main__":
    main()
