from api.services import bars_volume_baseline


def test_threshold_for_high_volume_ticker():
    """QQQ trades millions per minute — threshold should be much higher than 1000."""
    bars_5m = [{"v": 5_000_000} for _ in range(20)]
    threshold = bars_volume_baseline.compute_low_volume_threshold(bars_5m, tf="5")
    assert threshold >= 10_000


def test_threshold_for_thin_ticker():
    """A ticker with 200 shares/min median should get a much lower threshold."""
    bars = [{"v": 200} for _ in range(20)]
    threshold = bars_volume_baseline.compute_low_volume_threshold(bars, tf="5")
    assert threshold < 100  # don't false-positive on thin names


def test_threshold_with_no_history_falls_back_to_default():
    """Empty history → conservative module default."""
    threshold = bars_volume_baseline.compute_low_volume_threshold([], tf="5")
    assert threshold == bars_volume_baseline._DEFAULT_THRESHOLD


def test_threshold_ignores_zero_volume_bars():
    """Bars with v=0 (e.g. halts) shouldn't drag the median down."""
    bars = [{"v": 0}, {"v": 5_000_000}, {"v": 5_000_000}]
    threshold = bars_volume_baseline.compute_low_volume_threshold(bars, tf="5")
    assert threshold >= 10_000


def test_threshold_handles_non_dict_bars():
    """Sentinel/legacy bars shouldn't crash the function."""
    bars = [1, 2, "x", {"v": 5_000_000}, {"v": 5_000_000}]
    threshold = bars_volume_baseline.compute_low_volume_threshold(bars, tf="5")
    assert threshold >= 10_000
