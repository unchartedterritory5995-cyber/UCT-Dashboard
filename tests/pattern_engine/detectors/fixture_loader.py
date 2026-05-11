"""Fixture loader for detector tests.

A fixture file is a JSON document with this shape:
{
  "name": "human-readable name",
  "category": "positive" | "negative" | "edge" | "test",
  "bars": [{"t": int, "o": float, "h": float, "l": float, "c": float, "v": float}, ...],
  "context": {...},   // optional; if absent, context is built from bars
  "expected": {
    "fires": bool,
    "min_confidence": float,         // only when fires=true
    "max_confidence": float,         // only when fires=true; default 100
    "geometry_shape": str,            // optional; expected geometry.shape
    "pivot_count_in_geometry": int    // optional
  }
}
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Optional


_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_FIXTURE_ROOT = os.path.join(_REPO_ROOT, "tests", "fixtures")


@dataclass
class Fixture:
    name: str
    category: str
    bars: list[dict]
    context: Optional[dict]
    expected_fires: bool
    min_confidence: float
    max_confidence: float
    expected_geometry_shape: Optional[str]
    expected_pivot_count: Optional[int]
    source_filename: str


def load_fixture(pattern_id: str, filename: str) -> Fixture:
    """Load a single fixture by pattern_id + filename (e.g. 'bull_flag', 'clean_textbook.json')."""
    path = os.path.join(_FIXTURE_ROOT, pattern_id, filename)
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    expected = data.get("expected", {})
    return Fixture(
        name=data["name"],
        category=data.get("category", "unknown"),
        bars=data["bars"],
        context=data.get("context"),
        expected_fires=expected.get("fires", False),
        min_confidence=expected.get("min_confidence", 0.0),
        max_confidence=expected.get("max_confidence", 100.0),
        expected_geometry_shape=expected.get("geometry_shape"),
        expected_pivot_count=expected.get("pivot_count_in_geometry"),
        source_filename=filename,
    )


def load_all_fixtures(pattern_id: str, include_internal: bool = False) -> list[Fixture]:
    """Load every fixture for a pattern_id.

    Args:
      pattern_id: subdirectory name under tests/fixtures/
      include_internal: include files starting with '_' (loader-test fixtures)

    Returns:
      List of Fixture objects, sorted by filename.
    """
    dirpath = os.path.join(_FIXTURE_ROOT, pattern_id)
    if not os.path.isdir(dirpath):
        return []
    names = sorted(os.listdir(dirpath))
    fixtures = []
    for name in names:
        if not name.endswith(".json"):
            continue
        if name.startswith("_") and not include_internal:
            continue
        fixtures.append(load_fixture(pattern_id, name))
    return fixtures
