import pytest

from api.services.catalyst.filters import quality_gate, is_real_catalyst


def _c(**overrides):
    """A candidate that PASSES the gate by default (liquid mid-cap)."""
    defaults = {
        "ticker": "TEST",
        "price": 50.0,
        "avg_volume_30d": 2_000_000,   # 50 * 2M = $100M/day
        "today_volume": 3_000_000,
        "market_cap": 5_000_000_000,   # $5B
    }
    defaults.update(overrides)
    return defaults


def test_clean_name_passes():
    passed, reason = quality_gate(_c())
    assert passed is True
    assert reason is None


# ── Price ────────────────────────────────────────────────────────────────
def test_zero_price_excluded():
    passed, reason = quality_gate(_c(price=0.0))
    assert passed is False
    assert "no price" in reason.lower()


def test_missing_price_excluded():
    passed, reason = quality_gate(_c(price=None))
    assert passed is False
    assert "no price" in reason.lower()


def test_below_price_floor_excluded():
    passed, reason = quality_gate(_c(price=2.40))
    assert passed is False
    assert "$3" in reason


def test_exactly_at_floor_passes():
    # $3.00 is the floor — >= floor passes (only strictly below is excluded).
    passed, _ = quality_gate(_c(price=3.0))
    assert passed is True


def test_just_above_floor_passes():
    passed, _ = quality_gate(_c(price=3.01))
    assert passed is True


# ── Dollar volume ────────────────────────────────────────────────────────
def test_illiquid_excluded():
    # $4 * 500K = $2M/day < $5M floor
    passed, reason = quality_gate(_c(price=4.0, avg_volume_30d=500_000,
                                     today_volume=500_000))
    assert passed is False
    assert "liquidity" in reason.lower()


def test_liquid_enough_passes():
    # $4 * 2M = $8M/day > $5M floor
    passed, _ = quality_gate(_c(price=4.0, avg_volume_30d=2_000_000,
                                today_volume=2_000_000, market_cap=1_000_000_000))
    assert passed is True


def test_today_volume_fallback_when_adv_missing():
    # No ADV, but today's volume is huge → use it, passes.
    passed, _ = quality_gate(_c(price=10.0, avg_volume_30d=None,
                                today_volume=5_000_000))
    assert passed is True


def test_adv_preferred_over_spike():
    # Catalyst-day spike (today_volume) is huge but the 30d avg is thin →
    # ADV is preferred, so this illiquid name is still excluded.
    passed, reason = quality_gate(_c(price=4.0, avg_volume_30d=100_000,
                                     today_volume=50_000_000))
    assert passed is False
    assert "liquidity" in reason.lower()


def test_no_volume_data_fails_open():
    # No volume info at all → liquidity check skipped (fail-open). Cap still ok.
    passed, _ = quality_gate(_c(price=10.0, avg_volume_30d=None,
                                today_volume=None))
    assert passed is True


# ── Market cap ───────────────────────────────────────────────────────────
def test_microcap_excluded():
    passed, reason = quality_gate(_c(market_cap=50_000_000))  # $50M < $300M
    assert passed is False
    assert "market cap" in reason.lower()


def test_missing_market_cap_fails_open():
    passed, _ = quality_gate(_c(market_cap=None))
    assert passed is True


def test_cap_at_floor_passes():
    passed, _ = quality_gate(_c(market_cap=300_000_000))
    assert passed is True


# ── Env tunability ───────────────────────────────────────────────────────
def test_env_overrides_price_floor(monkeypatch):
    monkeypatch.setenv("CATALYST_MIN_PRICE", "10")
    passed, reason = quality_gate(_c(price=5.0))
    assert passed is False
    assert "$10" in reason


def test_env_overrides_dollar_vol(monkeypatch):
    monkeypatch.setenv("CATALYST_MIN_DOLLAR_VOL", "50000000")  # $50M
    # $50 * 2M = $100M passes default but... still passes $50M. Make it fail:
    passed, reason = quality_gate(_c(price=10.0, avg_volume_30d=2_000_000))  # $20M
    assert passed is False
    assert "liquidity" in reason.lower()


def test_env_overrides_market_cap(monkeypatch):
    monkeypatch.setenv("CATALYST_MIN_MARKET_CAP", "2000000000")  # $2B
    passed, reason = quality_gate(_c(market_cap=1_000_000_000))  # $1B < $2B
    assert passed is False
    assert "market cap" in reason.lower()


def test_garbage_env_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("CATALYST_MIN_PRICE", "not-a-number")
    passed, _ = quality_gate(_c(price=4.0))  # default floor 3.0 → 4.0 passes
    assert passed is True


# ── Activity gate (is_real_catalyst) ─────────────────────────────────────
def _a(**overrides):
    """A candidate that FAILS the activity gate by default (flat, no signal)."""
    defaults = {
        "ticker": "TEST", "gap_pct": 0.5, "vol_x": 1.0,
        "earnings_just_reported": False, "scanner_setup": None,
    }
    defaults.update(overrides)
    return defaults


def test_flat_no_signal_dropped():
    # The PAR / MEDP / FTRE failure mode: tiny move, normal volume, no hard sig.
    passed, reason = is_real_catalyst(_a(gap_pct=1.43, vol_x=0.97))
    assert passed is False
    assert "no real move" in reason.lower()


def test_par_example_dropped():
    passed, _ = is_real_catalyst(_a(gap_pct=1.43, vol_x=0.97))
    assert passed is False


def test_ftre_example_dropped():
    # +2.60% < 3% threshold, 1.2× < 2× threshold → dropped.
    passed, _ = is_real_catalyst(_a(gap_pct=2.60, vol_x=1.2))
    assert passed is False


def test_medp_example_dropped():
    passed, _ = is_real_catalyst(_a(gap_pct=-0.23, vol_x=1.57))
    assert passed is False


def test_big_move_no_news_kept_as_momentum():
    # User's momentum point: a big pre-market gap with no fresh news SURVIVES.
    passed, reason = is_real_catalyst(_a(gap_pct=12.0, vol_x=1.0))
    assert passed is True
    assert reason is None


def test_big_negative_move_kept():
    passed, _ = is_real_catalyst(_a(gap_pct=-8.0, vol_x=1.0))
    assert passed is True


def test_volume_surge_kept():
    passed, _ = is_real_catalyst(_a(gap_pct=0.5, vol_x=3.0))
    assert passed is True


def test_earnings_kept_even_when_flat():
    passed, _ = is_real_catalyst(_a(gap_pct=0.1, vol_x=1.0, earnings_just_reported=True))
    assert passed is True


def test_scanner_setup_kept_even_when_flat():
    passed, _ = is_real_catalyst(_a(gap_pct=0.1, vol_x=1.0, scanner_setup={"setup_type": "PB"}))
    assert passed is True


def test_activity_thresholds_env_tunable(monkeypatch):
    monkeypatch.setenv("CATALYST_MIN_MOVE_PCT", "5")
    monkeypatch.setenv("CATALYST_MIN_VOLX", "3")
    # 4% move now fails (threshold 5%), 2.5× vol fails (threshold 3×)
    passed, _ = is_real_catalyst(_a(gap_pct=4.0, vol_x=2.5))
    assert passed is False
    passed, _ = is_real_catalyst(_a(gap_pct=6.0, vol_x=1.0))
    assert passed is True
