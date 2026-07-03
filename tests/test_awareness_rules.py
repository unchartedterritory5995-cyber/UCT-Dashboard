"""Tests for api/services/awareness/rules.py — pure rule functions + the
deterministic relevance-score formula. (Task 1 covers only the score
formula + InsightCandidate; stop/regime/earnings rule tests are appended
in Tasks 2, 4, 5.)"""
from __future__ import annotations

from datetime import date

from api.services.awareness.rules import (
    InsightCandidate,
    compute_relevance_score,
)


# ── compute_relevance_score ─────────────────────────────────────────────────

def test_relevance_score_baseline_is_midpoint():
    assert compute_relevance_score(0.5, 1.0, 1.0) == 5


def test_relevance_score_clamps_to_ten():
    assert compute_relevance_score(1.0, 2.0, 2.0) == 10


def test_relevance_score_clamps_to_one():
    assert compute_relevance_score(0.01, 0.5, 0.5) == 1


def test_relevance_score_rounds_to_nearest_int():
    # 0.37 * 1.0 * 1.0 * 10 = 3.7 -> rounds to 4
    assert compute_relevance_score(0.37, 1.0, 1.0) == 4


def test_insight_candidate_is_a_plain_frozen_record():
    c = InsightCandidate(
        kind="stop_hit", symbol="NVDA", headline="h", body="b",
        base_signal=1.0, personal_multiplier=1.0, urgency=1.0, dedup_key="NVDA",
    )
    assert c.kind == "stop_hit"
    assert c.symbol == "NVDA"
