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
    rule_regime_flip,
    rule_earnings_proximity,
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
    assert out[0].dedup_key == "NVDA:stop_hit"
    assert out[0].base_signal == 1.0


def test_stop_watch_fires_stop_proximity_when_near():
    # stop=90, price=91.5 -> distance = (91.5-90)/91.5 = 1.64% < 3% threshold
    user_ctx = {"positions": [{"symbol": "NVDA", "side": "Long",
                                "entry_price": 100.0, "stop_price": 90.0,
                                "source": None}], "watch_syms": set()}
    out = rule_stop_watch(_scan({"NVDA": 91.5}), user_ctx)
    assert len(out) == 1
    assert out[0].kind == "stop_proximity"
    # Separate cooldown namespace from stop_hit -- a proximity warning must
    # never start the 6h cooldown that would swallow the escalation.
    assert out[0].dedup_key == "NVDA:stop_near"


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


# ── rule_regime_flip (R4) ────────────────────────────────────────────────────

def test_regime_flip_fires_when_label_changed_and_user_has_positions():
    scan_ctx = {"live_prices": {}, "earnings_by_symbol": {}, "today": date(2026, 7, 2),
                "regime": {"label": "bear_trend", "prev_label": "bull_trend",
                           "confidence": 0.7}}
    user_ctx = {"positions": [{"symbol": "NVDA", "side": "Long",
                                "entry_price": 100.0, "stop_price": 90.0,
                                "source": None}], "watch_syms": set()}
    out = rule_regime_flip(scan_ctx, user_ctx)
    assert len(out) == 1
    assert out[0].kind == "regime_flip"
    assert out[0].dedup_key == "REGIME:bear_trend"


def test_regime_flip_silent_when_label_unchanged():
    scan_ctx = {"live_prices": {}, "earnings_by_symbol": {}, "today": date(2026, 7, 2),
                "regime": {"label": "bull_trend", "prev_label": "bull_trend",
                           "confidence": 0.7}}
    user_ctx = {"positions": [{"symbol": "NVDA", "side": "Long",
                                "entry_price": 100.0, "stop_price": 90.0,
                                "source": None}], "watch_syms": set()}
    assert rule_regime_flip(scan_ctx, user_ctx) == []


def test_regime_flip_silent_for_user_with_nothing_at_stake():
    scan_ctx = {"live_prices": {}, "earnings_by_symbol": {}, "today": date(2026, 7, 2),
                "regime": {"label": "bear_trend", "prev_label": "bull_trend",
                           "confidence": 0.7}}
    user_ctx = {"positions": [], "watch_syms": set()}
    assert rule_regime_flip(scan_ctx, user_ctx) == []


def test_regime_flip_silent_when_no_prior_label():
    # First-ever scan (empty regime_snapshots ledger) -- nothing to compare.
    scan_ctx = {"live_prices": {}, "earnings_by_symbol": {}, "today": date(2026, 7, 2),
                "regime": {"label": "bull_trend", "prev_label": None,
                           "confidence": 0.7}}
    user_ctx = {"positions": [{"symbol": "NVDA", "side": "Long",
                                "entry_price": 100.0, "stop_price": 90.0,
                                "source": None}], "watch_syms": set()}
    assert rule_regime_flip(scan_ctx, user_ctx) == []


def test_regime_flip_honors_explicit_zero_confidence():
    # confidence=0.0 is a legitimate low-confidence reading, NOT missing --
    # it must not collapse to the 0.5 default (base_signal = 0.5 + 0.5*0.0).
    scan_ctx = {"live_prices": {}, "earnings_by_symbol": {}, "today": date(2026, 7, 2),
                "regime": {"label": "bear_trend", "prev_label": "bull_trend",
                           "confidence": 0.0}}
    user_ctx = {"positions": [{"symbol": "NVDA", "side": "Long",
                                "entry_price": 100.0, "stop_price": 90.0,
                                "source": None}], "watch_syms": set()}
    out = rule_regime_flip(scan_ctx, user_ctx)
    assert len(out) == 1
    assert out[0].base_signal == 0.5


# ── rule_earnings_proximity (R5) ─────────────────────────────────────────────

def test_earnings_proximity_fires_for_owned_symbol_today():
    scan_ctx = {"live_prices": {}, "regime": {}, "today": date(2026, 7, 2),
                "earnings_by_symbol": {"AAPL": "2026-07-02"}}
    user_ctx = {"positions": [{"symbol": "AAPL", "side": "Long",
                                "entry_price": 190.0, "stop_price": 180.0,
                                "source": None}], "watch_syms": set()}
    out = rule_earnings_proximity(scan_ctx, user_ctx)
    assert len(out) == 1
    assert out[0].kind == "earnings_proximity"
    assert out[0].dedup_key == "AAPL:earnings"
    assert out[0].personal_multiplier == 1.4  # owned boost


def test_earnings_proximity_fires_for_watched_symbol_within_window():
    scan_ctx = {"live_prices": {}, "regime": {}, "today": date(2026, 7, 2),
                "earnings_by_symbol": {"MSFT": "2026-07-04"}}  # +2 days
    user_ctx = {"positions": [], "watch_syms": {"MSFT"}}
    out = rule_earnings_proximity(scan_ctx, user_ctx)
    assert len(out) == 1
    assert out[0].personal_multiplier == 1.0  # watched, not owned


def test_earnings_proximity_silent_outside_window():
    scan_ctx = {"live_prices": {}, "regime": {}, "today": date(2026, 7, 2),
                "earnings_by_symbol": {"MSFT": "2026-07-10"}}  # +8 days, past default 3-day window
    user_ctx = {"positions": [], "watch_syms": {"MSFT"}}
    assert rule_earnings_proximity(scan_ctx, user_ctx) == []


def test_earnings_proximity_honors_scan_ctx_window_days():
    # A widened window (engine sets earnings_window_days from
    # AWARENESS_EARNINGS_PROXIMITY_DAYS) must reach past the default cutoff:
    # +5 days is outside the default 3-day window but inside window=5.
    scan_ctx = {"live_prices": {}, "regime": {}, "today": date(2026, 7, 2),
                "earnings_by_symbol": {"MSFT": "2026-07-07"},  # +5 days
                "earnings_window_days": 5}
    user_ctx = {"positions": [], "watch_syms": {"MSFT"}}
    out = rule_earnings_proximity(scan_ctx, user_ctx)
    assert len(out) == 1
    assert out[0].kind == "earnings_proximity"


def test_earnings_proximity_silent_for_untracked_symbol():
    scan_ctx = {"live_prices": {}, "regime": {}, "today": date(2026, 7, 2),
                "earnings_by_symbol": {"GOOG": "2026-07-02"}}
    user_ctx = {"positions": [], "watch_syms": {"MSFT"}}  # GOOG not owned/watched
    assert rule_earnings_proximity(scan_ctx, user_ctx) == []


def test_earnings_proximity_fires_at_day_3_boundary():
    # days_out == EARNINGS_PROXIMITY_DEFAULT_DAYS (3) is INCLUSIVE -- fires.
    scan_ctx = {"live_prices": {}, "regime": {}, "today": date(2026, 7, 2),
                "earnings_by_symbol": {"MSFT": "2026-07-05"}}  # exactly +3 days
    user_ctx = {"positions": [], "watch_syms": {"MSFT"}}
    out = rule_earnings_proximity(scan_ctx, user_ctx)
    assert len(out) == 1
    assert out[0].kind == "earnings_proximity"
