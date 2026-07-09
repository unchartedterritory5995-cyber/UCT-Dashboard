"""trading_day_et / hour_et semantics — the ET spine's contract."""
from api.services.journal_two.timeutil import compute_trading_day_et, compute_hour_et


def test_blank_and_none():
    assert compute_trading_day_et(None) is None
    assert compute_trading_day_et("") is None
    assert compute_hour_et(None) is None


def test_bare_date_passes_through_verbatim():
    assert compute_trading_day_et("2026-04-19") == "2026-04-19"
    assert compute_hour_et("2026-04-19") is None


def test_utc_midnight_means_date_only_intent():
    # Manual/CSV date-only entries are stored as T00:00:00Z; the user meant
    # THAT calendar day, not 8 PM ET the night before.
    assert compute_trading_day_et("2026-04-19T00:00:00Z") == "2026-04-19"
    assert compute_trading_day_et("2026-04-19T00:00:00+00:00") == "2026-04-19"
    assert compute_hour_et("2026-04-19T00:00:00Z") is None


def test_real_timestamps_bucket_in_et():
    # 14:30Z = 10:30 ET same day
    assert compute_trading_day_et("2026-04-19T14:30:00Z") == "2026-04-19"
    assert compute_hour_et("2026-04-19T14:30:00Z") == 10
    # After-hours 23:00Z = 19:00 ET same day
    assert compute_trading_day_et("2026-04-19T23:00:00Z") == "2026-04-19"
    # Overnight 01:00Z = 21:00 ET PREVIOUS day (matches to_et_date semantics)
    assert compute_trading_day_et("2026-04-20T01:00:00Z") == "2026-04-19"
    # Past midnight ET rolls forward (EDT boundary = 04:00Z)
    assert compute_trading_day_et("2026-04-20T05:00:00Z") == "2026-04-20"


def test_naive_timestamp_treated_as_utc():
    assert compute_trading_day_et("2026-04-19T14:30:00") == "2026-04-19"
    assert compute_hour_et("2026-04-19T14:30:00") == 10


def test_unparseable_returns_none():
    assert compute_trading_day_et("garbage") is None
    assert compute_hour_et("garbage") is None
