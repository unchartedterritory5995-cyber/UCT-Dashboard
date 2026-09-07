"""The REAL, complete, currently-registered detector set -- measured, not assumed.

Step 1 of the mission: prior work (this same repo's history) has quoted 82,
87, and "~103 (mission brief's own estimate, uncounted)" for the registry
size at different times. None of those is trusted here. This module imports
`api.routers.patterns` (via `voice_tool_impls._ensure_pattern_detectors_loaded`,
the same production entrypoint Compass's pattern tools use to guarantee the
registry is populated before reading it -- see that module's own docstring:
"registry is empty until api.routers.patterns is imported") and reads the
answer back from `detectors/registry.py`'s live `list_pattern_ids()`.

Measured 2026-09-06, in THIS worktree, on branch
`local/pullback-history-reachability` (built on top of the already-landed
`e4f7ce432` fetch-depth fix): **85 registered pattern_ids.** See
`_probe_registry.py`'s captured output / `full_registry_result.json`'s
`"registered_pattern_ids"` for the full list.

Unlike the prior two lab passes (`cohort.py`'s 6-family sample,
`wide_cohort.py`'s 22-family sample), this module does NOT hand-pick a
subset and does NOT hand-import individual detector modules by name -- it
runs the ENTIRE live registry, generically, via `registry.get_detector(pid)`
for every `pid` the registry reports. There is nothing to keep in sync with
the detector source tree as new detectors are added or removed: this file
reads the registry, it does not restate it.
"""
from __future__ import annotations

import json
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

LAB_DIR = os.path.dirname(os.path.abspath(__file__))
if LAB_DIR not in sys.path:
    sys.path.insert(0, LAB_DIR)

# Sandboxes every /data-resolving env pin (AST-derived, repo-root conftest.py)
# before any other product import -- paths are captured at module import, so
# this MUST come first. Importing `api.routers.patterns` below pulls in
# `api.middleware.auth_middleware` and every detector module; none of them is
# known to touch disk at import time, but this repo's own lab tooling
# (tools/measure_logspace_impact.py, tools/two_engine_agreement.py) always
# pays this one-line cost before a registry-loading import rather than
# proving a negative for every transitive import, and this module follows
# the same discipline.
import conftest  # noqa: E402,F401

from api.services.voice_tool_impls import _ensure_pattern_detectors_loaded  # noqa: E402
from api.services.pattern_engine.detectors.registry import (  # noqa: E402
    get_detector, list_pattern_ids,
)

_ensure_pattern_detectors_loaded()

#: The live, measured, full registry -- sorted, exactly as
#: `list_pattern_ids()` returns it. Re-derive this by re-running
#: `_probe_registry.py` rather than trusting this comment if the detector
#: source tree has changed since 2026-09-06.
FULL_REGISTRY_PATTERN_IDS: list[str] = list_pattern_ids()

#: Direct function handles for every registered detector, keyed by
#: pattern_id -- built generically from the registry itself (no hand-typed
#: import list to drift out of sync). Bypasses `detect_all`'s
#: swallow-and-log-a-warning exception handling so a per-detector benchmark
#: pass can observe + record a real failure instead of it disappearing into
#: a logger.
DETECTOR_FNS: dict = {pid: get_detector(pid) for pid in FULL_REGISTRY_PATTERN_IDS}

#: Source-verified (grep + read every one of the 85 registered detector
#: files -- see RESULTS.md "shared primitives" section): every detector
#: below independently calls `detect_pivots(bars, window=3)` -- IDENTICAL
#: arguments, on the IDENTICAL `bars` list -- rather than reading a shared
#: precomputed pivot set. `build_context()` (primitives/context.py) never
#: calls `detect_pivots` at all (confirmed by reading the file), so NONE of
#: this cost is amortized anywhere for ANY of them. This is the full-registry
#: superset of the prior 22-family pass's 8-detector list (vcp, swing_pivots,
#: support_resistance, major_trendlines, head_shoulders, triple_top,
#: cup_handle, ascending_triangle) -- every one of those 8 recurs here, plus
#: 21 more the narrower sample never included.
PIVOT_CALLING_DETECTORS: list[str] = [
    "ascending_triangle",
    "bear_flag",
    "bull_flag",
    "channel",
    "cup_handle",
    "cup_handle_uct",
    "descending_triangle",
    "double_bottom",
    "double_top",
    "falling_wedge",
    "head_shoulders",
    "high_tight_flag",
    "higher_low_continuation",
    "inverse_cup_handle",
    "inverse_head_shoulders",
    "major_trendlines",
    "pennant",
    "rectangle",
    "remount",
    "rising_wedge",
    "rounded_base",
    "rounded_top",
    "support_resistance",
    "swing_pivots",
    "symmetrical_triangle",
    "triple_bottom",
    "triple_top",
    "u_and_r",
    "vcp",
]
assert set(PIVOT_CALLING_DETECTORS).issubset(set(FULL_REGISTRY_PATTERN_IDS))

#: Source-verified: these detector files each define + call their OWN local
#: SMA/EMA helper (`_sma`/`_ema`/`_compute_sma`/`_compute_ema`) rather than
#: reading a shared value -- `build_context()` computes SMA10/20/50/150/200
#: internally for its own trend-stage/MA-alignment classification but does
#: NOT expose those values in the returned Context dict, so any detector
#: needing its own MA distance recomputes from raw closes independently.
#: Counted by file (grep), not individually timed -- see RESULTS.md.
SMA_EMA_RECOMPUTING_DETECTORS: list[str] = [
    "bollinger_squeeze",
    "death_cross",
    "golden_cross",
    "holy_grail",
    "liquid_leader_filter",
    "macd_bearish_cross",
    "macd_bullish_cross",
    "pullback_to_10ema",
    "pullback_to_200sma",
    "pullback_to_21ema",
    "pullback_to_50sma",
    "qullamaggie_setup",
    "remount",
    "stage_analysis",
    "u_and_r",
    "vcp",
]
assert set(SMA_EMA_RECOMPUTING_DETECTORS).issubset(set(FULL_REGISTRY_PATTERN_IDS))

#: Source-verified: these detector files each define their own local ATR-
#: style range helper. There is NO shared ATR primitive anywhere under
#: `primitives/` (grepped) -- every one of these 17 is a fully independent
#: implementation, not just an independent CALL to a shared one.
ATR_RECOMPUTING_DETECTORS: list[str] = [
    "avwap_reclaim",
    "death_cross",
    "donchian_breakout",
    "golden_cross",
    "higher_low_continuation",
    "holy_grail",
    "liquid_leader_filter",
    "macd_bearish_cross",
    "macd_bullish_cross",
    "outside_bar",
    "parabolic_short",
    "pullback_to_10ema",
    "pullback_to_200sma",
    "pullback_to_21ema",
    "pullback_to_50sma",
    "qullamaggie_setup",
    "remount",
]
assert set(ATR_RECOMPUTING_DETECTORS).issubset(set(FULL_REGISTRY_PATTERN_IDS))


def load_symbol_pool() -> list[str]:
    """Real tickers confirmed (read-only probe) to have >=220 stored daily
    bars in the local bars.db, ranked by bar count descending.

    Reused verbatim from the sibling lab worktree's discovery (branch
    `pattern-intelligence-lab`, `lab/runtime/coverage_result.json` /
    `check_universe_coverage.py`) rather than re-derived -- that pass's own
    commit timestamp (2026-09-06 19:41) is minutes after this branch's fix
    commit (2026-09-06 19:34), so the data is not stale, and re-running the
    same read-only sweep against the same live bars.db would reproduce the
    same 1,253 tickers to a very close approximation. `coverage_result.json`
    here is a byte-for-byte copy of that file.
    """
    path = os.path.join(LAB_DIR, "coverage_result.json")
    with open(path) as f:
        data = json.load(f)
    return [t for t, _n in data["tickers_by_bar_count_desc"]]
