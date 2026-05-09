import time
import pytest

from api.services import bars_liveness


def test_stale_during_rth_returns_true():
    """Bar more than threshold old during RTH = stale.

    Note: spec inconsistency resolved by using tf="1" (threshold 120s) instead
    of tf="5" (threshold 600s). The original spec test used tf="5" with a
    180s-old bar and expected stale=True, which contradicts the 600s threshold
    listed for tf="5". Switched to tf="1" so 180s old correctly registers as
    stale (180 > 120) without altering the documented thresholds.
    """
    now = int(time.time())
    # Pretend RTH
    assert bars_liveness.is_stale(last_bar_time=now - 180, tf="1", market_open=True) is True


def test_fresh_during_rth_returns_false():
    now = int(time.time())
    assert bars_liveness.is_stale(last_bar_time=now - 30, tf="5", market_open=True) is False


def test_stale_outside_rth_returns_false():
    """Outside RTH, stale doesn't matter — no new bars expected."""
    now = int(time.time())
    assert bars_liveness.is_stale(last_bar_time=now - 3600, tf="5", market_open=False) is False


def test_daily_tf_threshold_is_per_session():
    """Daily bars during RTH are stale at 25 hours, not 2 minutes."""
    now = int(time.time())
    assert bars_liveness.is_stale(last_bar_time=now - 600, tf="D", market_open=True) is False
    assert bars_liveness.is_stale(last_bar_time=now - 25 * 3600, tf="D", market_open=True) is True
