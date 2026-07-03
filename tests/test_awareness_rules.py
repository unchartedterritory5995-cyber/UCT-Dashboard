"""Tests for api/services/awareness/rules.py — pure rule functions + the
deterministic relevance-score formula. (Task 1 covers only the score
formula + InsightCandidate; stop/regime/earnings rule tests are appended
in Tasks 2, 4, 5.)"""
from __future__ import annotations

from datetime import date

from api.services.awareness.rules import (
    InsightCandidate,
    compute_relevance_score,
    rule_stop_watch,
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


# ── rule_stop_watch (R1/R2) ─────────────────────────────────────────────────

def _scan(prices):
    return {"live_prices": prices, "regime": {}, "earnings_by_symbol": {},
            "today": date(2026, 7, 2)}


def test_stop_watch_fires_stop_hit_when_long_price_at_or_below_stop():
    user_ctx = {"positions": [{"symbol": "NVDA", "side": "Long",
                                "entry_price": 100.0, "stop_price": 90.0,
                                "source": None}], "watch_syms": set()}
    out = rule_stop_watch(_scan({"NVDA": 88.0}), user_ctx)
    assert len(out) == 1
    assert out[0].kind == "stop_hit"
    assert out[0].dedup_key == "NVDA"
    assert out[0].base_signal == 1.0


def test_stop_watch_fires_stop_proximity_when_near():
    # stop=90, price=91.5 -> distance = (91.5-90)/91.5 = 1.64% < 3% threshold
    user_ctx = {"positions": [{"symbol": "NVDA", "side": "Long",
                                "entry_price": 100.0, "stop_price": 90.0,
                                "source": None}], "watch_syms": set()}
    out = rule_stop_watch(_scan({"NVDA": 91.5}), user_ctx)
    assert len(out) == 1
    assert out[0].kind == "stop_proximity"


def test_stop_watch_silent_when_price_far_from_stop():
    user_ctx = {"positions": [{"symbol": "NVDA", "side": "Long",
                                "entry_price": 100.0, "stop_price": 90.0,
                                "source": None}], "watch_syms": set()}
    assert rule_stop_watch(_scan({"NVDA": 110.0}), user_ctx) == []


def test_stop_watch_short_side_at_stop():
    # Short: stop above entry; at/through fires once price >= stop.
    user_ctx = {"positions": [{"symbol": "TSLA", "side": "Short",
                                "entry_price": 200.0, "stop_price": 210.0,
                                "source": None}], "watch_syms": set()}
    out = rule_stop_watch(_scan({"TSLA": 212.0}), user_ctx)
    assert len(out) == 1
    assert out[0].kind == "stop_hit"


def test_stop_watch_skips_broker_placeholder_stop():
    # source='broker' + stop_price == entry_price is a placeholder (no real
    # stop set on the broker's side) -- must be skipped even though the
    # price is well below it.
    user_ctx = {"positions": [{"symbol": "AAPL", "side": "Long",
                                "entry_price": 150.0, "stop_price": 150.0,
                                "source": "broker"}], "watch_syms": set()}
    assert rule_stop_watch(_scan({"AAPL": 140.0}), user_ctx) == []


def test_stop_watch_skips_when_no_live_price_cached():
    user_ctx = {"positions": [{"symbol": "MSFT", "side": "Long",
                                "entry_price": 300.0, "stop_price": 280.0,
                                "source": None}], "watch_syms": set()}
    assert rule_stop_watch(_scan({}), user_ctx) == []  # MSFT not cached this cycle
