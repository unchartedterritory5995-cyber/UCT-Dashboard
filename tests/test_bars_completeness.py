from api.services import bars_completeness


def test_complete_session_no_gaps():
    # 390 bars at 60-second intervals, RTH 9:30 ET
    base = 1746105000  # 2026-05-01 09:30 ET roughly
    bars = [{"t": base + i * 60} for i in range(390)]
    missing = bars_completeness.find_missing_minutes(bars)
    assert missing == []


def test_detects_missing_minute_in_session():
    base = 1746105000
    bars = [{"t": base + i * 60} for i in range(390) if i != 100]
    missing = bars_completeness.find_missing_minutes(bars)
    assert (base + 100 * 60) in missing


def test_does_not_flag_pre_or_post_market_gaps():
    """Bars don't span 24h continuously - the 16:00 -> 9:30 next day is not a gap."""
    base = 1746105000
    today = [{"t": base + i * 60} for i in range(390)]
    tomorrow_base = base + 86400
    tomorrow = [{"t": tomorrow_base + i * 60} for i in range(390)]
    bars = today + tomorrow
    missing = bars_completeness.find_missing_minutes(bars)
    assert missing == []


def test_handles_empty_or_single_bar():
    assert bars_completeness.find_missing_minutes([]) == []
    assert bars_completeness.find_missing_minutes([{"t": 1746105000}]) == []


def test_unsorted_bars_handled():
    base = 1746105000
    # Pass bars out of order - function should sort internally
    bars = [{"t": base + 120}, {"t": base}, {"t": base + 60}]
    missing = bars_completeness.find_missing_minutes(bars)
    assert missing == []  # consecutive minutes, no gaps
