"""Tests verifying that fetch_with_validation is wired into the production fetch path.

Plan 2 Task 3: the production `_get_bars_inner` cache-miss path must call
`fetch_with_validation` so corrupt primary payloads automatically fall through
to FMP/yfinance instead of being persisted to SQLite.
"""
from unittest.mock import patch, MagicMock
import pytest

from api.services import bars_fetch, bar_quarantine


@pytest.fixture
def fresh_quarantine(tmp_path, monkeypatch):
    db_path = tmp_path / "auth.db"
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(db_path))
    bar_quarantine.init_schema()


@pytest.fixture
def isolated_caches(tmp_path, monkeypatch):
    """Force cache miss for every test — no leftover SQLite/disk/in-memory state."""
    from api.services import bars_sqlite, bars_disk_cache
    from api.services.cache import cache as _cache

    # Point SQLite at a fresh temp file so get_last_ts/get_bars return empty.
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    # Bump epoch so every thread-local connection drops its cached handle and
    # reopens against the new path.
    bars_sqlite.bump_db_epoch()
    # Initialize schema in the new DB.
    bars_sqlite.init_db()

    # Point disk cache at an empty dir.
    disk_dir = tmp_path / "disk"
    disk_dir.mkdir(exist_ok=True)
    monkeypatch.setattr(bars_disk_cache, "_CACHE_DIR", str(disk_dir))

    # Clear the in-memory TTL cache.
    try:
        if hasattr(_cache, "_store"):
            _cache._store.clear()
        elif hasattr(_cache, "clear"):
            _cache.clear()
    except Exception:
        pass

    # Clear inflight tracking.
    bars_fetch._inflight.clear()

    yield

    # Bump again on teardown so subsequent tests using the real DB path also reset.
    bars_sqlite.bump_db_epoch()


def test_production_path_falls_through_when_primary_corrupt(fresh_quarantine):
    """Verify fetch_with_validation runs the Massive → FMP fallback when Massive
    returns a corrupt payload.  This is the public guarantee of fetch_with_validation
    that the wiring depends on."""
    massive_corrupt = [
        {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000},
        # The QQQ 6.55 phantom: huge deviation + low volume → fails validation
        {"t": 1715080900, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56},
    ]
    fmp_clean = [
        {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000},
        {"t": 1715080900, "o": 702, "h": 707, "l": 701, "c": 706, "v": 1100000},
    ]

    with patch.object(bars_fetch, "_fetch_intraday_massive", return_value=massive_corrupt) as mm, \
         patch.object(bars_fetch, "_fetch_intraday_fmp", return_value=fmp_clean) as mf:
        result = bars_fetch.fetch_with_validation("QQQ", "30", 100, prior_close=702.0)

    # Result should contain FMP's clean bars, not Massive's corrupt
    assert result is not None
    bars = result if isinstance(result, list) else result.get("bars", [])
    closes = [b.get("c") for b in bars]
    assert 6.55 not in closes  # corrupt was filtered out
    assert mm.called
    # FMP should have been called as fallback
    assert mf.called


def test_production_inner_invokes_fetch_with_validation_on_cold_fetch(
    fresh_quarantine, isolated_caches
):
    """Verify that the production cache-miss path actually routes through
    fetch_with_validation (the wiring being added in this task).

    With every cache layer empty and a cold ticker, _get_bars_inner must
    eventually call fetch_with_validation. We mock fetch_with_validation
    itself to assert the call site is wired up.
    """
    clean_bars = [
        {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000},
        {"t": 1715080900, "o": 702, "h": 707, "l": 701, "c": 706, "v": 1100000},
    ]

    # Patch fetch_with_validation in the bars_fetch module — that's what
    # _get_bars_inner calls (the wiring we're verifying).
    with patch.object(bars_fetch, "fetch_with_validation", return_value=clean_bars) as mock_fwv:
        bars_fetch._get_bars_inner("QQQ", "5", 100)

    # The cold-fetch path must have routed through fetch_with_validation
    # for an intraday timeframe.
    assert mock_fwv.called, "fetch_with_validation was not invoked from production fetch path"
    # First positional arg should be ticker (uppercase), second should be tf.
    call_args = mock_fwv.call_args
    args, kwargs = call_args
    # Signature: fetch_with_validation(ticker, tf, bars, prior_close=...)
    # Be tolerant: ticker may be either positional or kw.
    if args:
        assert args[0] == "QQQ"
        assert args[1] == "5"
    else:
        assert kwargs.get("ticker") == "QQQ"
        assert kwargs.get("tf") == "5"


def test_production_path_returns_empty_when_all_sources_corrupt(fresh_quarantine):
    """When fetch_with_validation rejects every source, _fetch_intraday returns []
    (NOT raw Massive — that would defeat Plan 1's validation gate).

    Staleness checks last-bar age, not OHLC validity, so a corrupt-but-recent
    payload (e.g. QQQ 6.55 phantom bar at today's timestamp) would silently
    get persisted to SQLite and the in-memory cache if we fell back to raw
    Massive. Returning [] forces the caller to handle the failure explicitly.
    """
    corrupt_bars = [
        {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000},
        {"t": 1715080900, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56},
    ]

    with patch.object(bars_fetch, "_fetch_intraday_massive", return_value=corrupt_bars), \
         patch.object(bars_fetch, "_fetch_intraday_fmp", return_value=corrupt_bars), \
         patch.object(bars_fetch, "_fetch_intraday_yfinance", return_value=corrupt_bars), \
         patch.object(bars_fetch, "_last_known_close", return_value=702.0):
        result = bars_fetch._fetch_intraday("QQQ", "30", 100)

    # Should return empty, NOT the corrupt raw payload
    assert result == [], f"Expected [], got {len(result)} corrupt bars"


def test_production_path_returns_empty_when_all_sources_corrupt_tf60(fresh_quarantine):
    """Same guarantee but for the tf=60 branch — when the 30-min source chain
    fails validation, the resampled hourly path must NOT fall back to raw Massive.
    """
    corrupt_bars = [
        {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000},
        {"t": 1715080900, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56},
    ]

    with patch.object(bars_fetch, "_fetch_intraday_massive", return_value=corrupt_bars), \
         patch.object(bars_fetch, "_fetch_intraday_fmp", return_value=corrupt_bars), \
         patch.object(bars_fetch, "_fetch_intraday_yfinance", return_value=corrupt_bars), \
         patch.object(bars_fetch, "_last_known_close", return_value=702.0):
        result = bars_fetch._fetch_intraday("QQQ", "60", 100)

    assert result == [], f"Expected [], got {len(result)} corrupt bars from tf=60 path"
