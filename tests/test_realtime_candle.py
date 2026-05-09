import pytest
from api.services import realtime_candle as rc


@pytest.fixture(autouse=True)
def reset():
    rc._reset()
    yield
    rc._reset()


def test_apply_tick_creates_new_candle():
    rc.apply_tick("QQQ", price=700.0, ts=1715080800, size=100, tf="1")
    candle = rc.get_current("QQQ", "1")
    assert candle is not None
    assert candle["o"] == 700.0
    assert candle["h"] == 700.0
    assert candle["l"] == 700.0
    assert candle["c"] == 700.0
    assert candle["v"] == 100


def test_apply_tick_updates_high_low_close():
    rc.apply_tick("QQQ", 700.0, 1715080800, 100, "1")
    rc.apply_tick("QQQ", 702.5, 1715080805, 50, "1")
    rc.apply_tick("QQQ", 698.0, 1715080810, 75, "1")
    candle = rc.get_current("QQQ", "1")
    assert candle["o"] == 700.0
    assert candle["h"] == 702.5
    assert candle["l"] == 698.0
    assert candle["c"] == 698.0
    assert candle["v"] == 225


def test_out_of_order_tick_dropped():
    rc.apply_tick("QQQ", 700.0, 1715080800, 100, "1")
    rc.apply_tick("QQQ", 702.5, 1715080805, 50, "1")
    rc.apply_tick("QQQ", 600.0, 1715080790, 999, "1")
    candle = rc.get_current("QQQ", "1")
    assert candle["c"] == 702.5
    assert candle["l"] == 700.0


def test_sanity_check_rejects_extreme_tick():
    rc.apply_tick("QQQ", 700.0, 1715080800, 100, "1")
    rc.apply_tick("QQQ", 1000.0, 1715080805, 50, "1")  # 43% jump - anomaly
    candle = rc.get_current("QQQ", "1")
    assert candle["h"] == 700.0
    assert candle["c"] == 700.0


def test_period_boundary_rolls_candle():
    rc.apply_tick("QQQ", 700.0, 1715080800, 100, "1")
    rc.apply_tick("QQQ", 702.0, 1715080859, 50, "1")
    closed_bars = rc.apply_tick("QQQ", 705.0, 1715080860, 75, "1")
    assert len(closed_bars) == 1
    assert closed_bars[0]["c"] == 702.0
    new = rc.get_current("QQQ", "1")
    assert new["o"] == 705.0
    assert new["t"] == 1715080860


def test_get_current_returns_none_for_unknown():
    assert rc.get_current("ZZZZZ", "1") is None


def test_force_close_returns_and_clears_candle():
    rc.apply_tick("QQQ", 700.0, 1715080800, 100, "1")
    closed = rc.force_close("QQQ", "1")
    assert closed["c"] == 700.0
    assert rc.get_current("QQQ", "1") is None


def test_replace_bar_overrides_state():
    rc.apply_tick("QQQ", 700.0, 1715080800, 100, "1")
    corrected = {"t": 1715080800, "o": 698, "h": 705, "l": 697, "c": 703, "v": 1500000}
    rc.replace_bar("QQQ", "1", corrected)
    new = rc.get_current("QQQ", "1")
    assert new["c"] == 703


def test_all_keys_lists_tracked_pairs():
    rc.apply_tick("QQQ", 700.0, 1715080800, 100, "1")
    rc.apply_tick("SPY", 730.0, 1715080800, 50, "5")
    keys = rc.all_keys()
    assert ("QQQ", "1") in keys
    assert ("SPY", "5") in keys
