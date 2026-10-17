"""Pattern recognition engine — public API.

Detection entrypoints:
  - detect_all(bars, context, pattern_ids=None) -> list[Detection]
  - detect_one(bars, context, pattern_id) -> list[Detection]

Detectors register themselves via `detectors.registry.register()`. To activate
a detector, import its module — registration happens at module import time.
"""
from __future__ import annotations

from typing import Optional

from api.services.pattern_engine.detectors.registry import (
    bars_for, context_for, get_detector, list_pattern_ids,
)


def detect_all(
    bars: list,
    context: dict,
    pattern_ids: Optional[list[str]] = None,
    base_depth: Optional[int] = None,
    sym: Optional[str] = None,
) -> list[dict]:
    """Run all registered detectors (or a filtered subset) on the given bars.

    Args:
      bars: OHLCV list, sorted by t ascending.
      context: Context dict from `primitives.context.build_context()`.
      pattern_ids: optional whitelist. If None, all registered detectors run.
      base_depth: optional. When set, `bars` may be deeper than the caller's
        usual window: each detector receives `registry.bars_for(pid, bars,
        base_depth)` (its declared `min_bars`, else exactly `base_depth`
        trailing bars) and its detections are annotated against that slice.
        None = every detector gets `bars` unchanged (the old behaviour).
      sym: optional ticker. Handed (as `context["sym"]`) only to detectors
        registered with `wants_sym=True`; every other detector receives
        `context` itself.

    Returns:
      Merged list of Detection dicts, sorted by detected_at desc then confidence desc.
    """
    targets = pattern_ids if pattern_ids else list_pattern_ids()
    results: list[dict] = []
    for pid in targets:
        try:
            fn = get_detector(pid)
        except KeyError:
            continue
        own = bars if base_depth is None else bars_for(pid, bars, base_depth)
        try:
            dets = fn(own, context_for(pid, context, sym))
            if base_depth is not None:
                # annotate against the detector's own slice (annotation is
                # per detection, so this equals the single pass below)
                from api.services.pattern_engine import display as _display
                _display.annotate(dets, own)
            results.extend(dets)
        except Exception as e:
            # Detectors should not crash the engine. Swallow + log.
            import logging
            logging.getLogger(__name__).warning(
                "detector %s raised: %s", pid, e, exc_info=True
            )
    results.sort(
        key=lambda d: (d.get("detected_at", 0), d.get("confidence", 0)),
        reverse=True,
    )
    # Display-only: the structure's own last bar + its age (display.annotate
    # never raises and never touches a field a firing decision reads).
    if base_depth is None:
        from api.services.pattern_engine import display as _display
        _display.annotate(results, bars)
    return results


def detect_one(bars: list, context: dict, pattern_id: str) -> list[dict]:
    """Run a single detector by id. Raises KeyError if not registered."""
    fn = get_detector(pattern_id)
    from api.services.pattern_engine import display as _display
    return _display.annotate(fn(bars, context), bars)
