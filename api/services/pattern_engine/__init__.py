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
    get_detector, list_pattern_ids,
)


def detect_all(
    bars: list,
    context: dict,
    pattern_ids: Optional[list[str]] = None,
) -> list[dict]:
    """Run all registered detectors (or a filtered subset) on the given bars.

    Args:
      bars: OHLCV list, sorted by t ascending.
      context: Context dict from `primitives.context.build_context()`.
      pattern_ids: optional whitelist. If None, all registered detectors run.

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
        try:
            results.extend(fn(bars, context))
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
    return results


def detect_one(bars: list, context: dict, pattern_id: str) -> list[dict]:
    """Run a single detector by id. Raises KeyError if not registered."""
    fn = get_detector(pattern_id)
    return fn(bars, context)
