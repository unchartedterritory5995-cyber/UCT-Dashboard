"""Detector registry.

Detectors register themselves with `register("pattern_id", fn)`. The engine
entrypoint (`detect_all`) iterates the registry; consumers can scope a single
detector via `detect_one`.
"""
from __future__ import annotations

from typing import Callable, Dict


DetectorFn = Callable[[list, dict], list[dict]]


_REGISTRY: Dict[str, DetectorFn] = {}


def register(pattern_id: str, fn: DetectorFn) -> None:
    """Add a detector to the registry. Overwrites if already present."""
    _REGISTRY[pattern_id] = fn


def get_detector(pattern_id: str) -> DetectorFn:
    """Return the detector function for `pattern_id`. Raises KeyError if missing."""
    if pattern_id not in _REGISTRY:
        raise KeyError(f"no detector registered for pattern_id={pattern_id!r}")
    return _REGISTRY[pattern_id]


def list_pattern_ids() -> list[str]:
    """Return all registered pattern_ids, sorted."""
    return sorted(_REGISTRY.keys())
