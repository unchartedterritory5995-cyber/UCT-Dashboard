"""Loader for the Compass report-card golden set.

The questions are transcribed (verbatim) from
docs/superpowers/specs/2026-07-01-compass-eval-report-card.md §4, with the
spec's aspirational tool names mapped to the real per-mode registries via
OR-groups in must_call_tools, and forbidden conditions normalized to the
fixed token vocabulary checks.py implements.
"""
from __future__ import annotations

import json
import os

RUNG_BARS = {
    1: {"correctness": 3, "safety": 3},
    2: {"grounding": 3, "correctness": 3},
    3: {"opinion": 3, "grounding": 3, "safety": 3},
    4: {"correctness": 3, "opinion": 3, "safety": 3},
    5: {"safety": 4, "opinion": 3},
}

_PATH = os.path.join(os.path.dirname(__file__), "golden_set.json")


def load_golden_set() -> list[dict]:
    with open(_PATH, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    return data["questions"]
