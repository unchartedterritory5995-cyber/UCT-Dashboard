"""The bounded 6-detector cohort this lab benchmarks, and the symbol pool.

Cohort selection (chosen from api/services/pattern_engine/detectors/ — could
not coordinate with a parallel "quality lab" workstream, so this is a
reasonable bounded set picked independently, matching the mission brief's
suggested shape):
  - candlestick:        hammer                  (detectors/candlestick/hammer.py)
  - structural/flag:    bull_flag               (detectors/classical/bull_flag.py)
  - growth/base:        vcp                     (detectors/uct/vcp.py)
  - MA-pullback:        pullback_to_50sma       (detectors/uct/pullback_to_50sma.py)
  - event/gap:          power_earnings_gap      (detectors/uct/power_earnings_gap.py)
  - structure/regime:   stage_analysis          (detectors/structure/stage_analysis.py)

Importing each detector module (not the whole `api.routers.patterns`
package) registers ONLY these six pattern_ids in the shared registry, so
`detect_all(bars, ctx, pattern_ids=COHORT_PATTERN_IDS)` runs exactly this
cohort — not all ~90 registered detectors in the full engine.
"""
from __future__ import annotations

import json
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

LAB_DIR = os.path.dirname(os.path.abspath(__file__))

# Importing these registers each pattern_id via detectors/registry.py's
# module-level `register(...)` call.
from api.services.pattern_engine.detectors.candlestick import hammer  # noqa: E402,F401
from api.services.pattern_engine.detectors.classical import bull_flag  # noqa: E402,F401
from api.services.pattern_engine.detectors.uct import vcp  # noqa: E402,F401
from api.services.pattern_engine.detectors.uct import pullback_to_50sma  # noqa: E402,F401
from api.services.pattern_engine.detectors.uct import power_earnings_gap  # noqa: E402,F401
from api.services.pattern_engine.detectors.structure import stage_analysis  # noqa: E402,F401

COHORT_PATTERN_IDS = [
    "hammer",
    "bull_flag",
    "vcp",
    "pullback_to_50sma",
    "power_earnings_gap",
    "stage_analysis",
]

# Detector function handles, for per-family timing (bypasses the registry
# dict-lookup + swallow-exceptions wrapper detect_all uses, so per-family
# wall clock is the pure detector cost).
DETECTOR_FNS = {
    "hammer": hammer.detect_hammer,
    "bull_flag": bull_flag.detect_bull_flag,
    "vcp": vcp.detect_vcp,
    "pullback_to_50sma": pullback_to_50sma.detect_pullback_to_50sma,
    "power_earnings_gap": power_earnings_gap.detect_power_earnings_gap,
    "stage_analysis": stage_analysis.detect_stage_analysis,
}


def load_symbol_pool() -> list[str]:
    """Real tickers confirmed (read-only probe, check_universe_coverage.py)
    to have >=220 stored daily bars in the local bars.db, ranked by bar
    count descending."""
    path = os.path.join(LAB_DIR, "coverage_result.json")
    with open(path) as f:
        data = json.load(f)
    return [t for t, _n in data["tickers_by_bar_count_desc"]]
