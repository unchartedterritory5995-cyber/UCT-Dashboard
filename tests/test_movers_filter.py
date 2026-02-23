import pytest
from unittest.mock import patch, MagicMock


def _make_mover(ticker, change_pct, close=50.0, volume=500_000):
    """Build a mover row matching the shape get_top_movers() returns."""
    return {"ticker": ticker, "change_pct": change_pct, "close": close, "volume": volume}


def _dvol_pass(tickers):
    """Mock _get_avg_dollar_vol: every ticker passes the $10M floor."""
    return {t: 50_000_000 for t in tickers}


def _dvol_fail(tickers):
    """Mock _get_avg_dollar_vol: every ticker fails the $10M floor."""
    return {t: 1_000_000 for t in tickers}


# ── Gap filter ─────────────────────────────────────────────────────────────────

def test_gap_filter_excludes_sub_3pct():
    """Stocks moving less than 3% in either direction are excluded."""
    from api.services.massive import get_movers
    from api.services.cache import cache
    cache.invalidate("movers")

    mock_client = MagicMock()
    mock_client.get_top_movers.side_effect = lambda direction, limit: (
        [
            _make_mover("NVDA", 5.2),
            _make_mover("AAPL", 1.5),   # < 3% — excluded
            _make_mover("TSLA", 3.0),
        ] if direction == "gainers" else [
            _make_mover("META", -4.1),
            _make_mover("AMZN", -2.9),  # < 3% — excluded
            _make_mover("GOOG", -3.5),
        ]
    )

    with patch("api.services.massive._get_client", return_value=mock_client), \
         patch("api.services.massive._get_avg_dollar_vol", _dvol_pass):
        result = get_movers()

    ripping_syms  = [r["sym"] for r in result["ripping"]]
    drilling_syms = [r["sym"] for r in result["drilling"]]

    assert "NVDA" in ripping_syms
    assert "TSLA" in ripping_syms
    assert "AAPL" not in ripping_syms

    assert "META" in drilling_syms
    assert "GOOG" in drilling_syms
    assert "AMZN" not in drilling_syms


def test_gap_filter_includes_exactly_3pct():
    """Stocks at exactly 3.0% are included (boundary condition)."""
    from api.services.massive import get_movers
    from api.services.cache import cache
    cache.invalidate("movers")

    mock_client = MagicMock()
    mock_client.get_top_movers.side_effect = lambda direction, limit: (
        [_make_mover("TICK", 3.0)] if direction == "gainers" else
        [_make_mover("TOCK", -3.0)]
    )

    with patch("api.services.massive._get_client", return_value=mock_client), \
         patch("api.services.massive._get_avg_dollar_vol", _dvol_pass):
        result = get_movers()

    assert any(r["sym"] == "TICK" for r in result["ripping"])
    assert any(r["sym"] == "TOCK" for r in result["drilling"])


def test_gap_filter_empty_when_nothing_qualifies():
    """Returns empty lists when no stock meets the 3% threshold."""
    from api.services.massive import get_movers
    from api.services.cache import cache
    cache.invalidate("movers")

    mock_client = MagicMock()
    mock_client.get_top_movers.side_effect = lambda direction, limit: (
        [_make_mover("AAPL", 0.5), _make_mover("MSFT", 1.2)]
        if direction == "gainers" else
        [_make_mover("GOOG", -0.3), _make_mover("META", -2.9)]
    )

    with patch("api.services.massive._get_client", return_value=mock_client), \
         patch("api.services.massive._get_avg_dollar_vol", _dvol_pass):
        result = get_movers()

    assert result["ripping"] == []
    assert result["drilling"] == []


# ── Price filter ───────────────────────────────────────────────────────────────

def test_price_filter_excludes_at_or_below_2():
    """Stocks at or below $2 are excluded regardless of gap size."""
    from api.services.massive import get_movers
    from api.services.cache import cache
    cache.invalidate("movers")

    mock_client = MagicMock()
    mock_client.get_top_movers.side_effect = lambda direction, limit: (
        [
            _make_mover("GOOD",  5.0, close=10.00),
            _make_mover("CHEAP", 8.0, close=1.50),  # $1.50 — excluded
            _make_mover("EXACT", 4.0, close=2.00),  # exactly $2 — excluded (not > $2)
        ] if direction == "gainers" else []
    )

    with patch("api.services.massive._get_client", return_value=mock_client), \
         patch("api.services.massive._get_avg_dollar_vol", _dvol_pass):
        result = get_movers()

    syms = [r["sym"] for r in result["ripping"]]
    assert "GOOD"  in syms
    assert "CHEAP" not in syms
    assert "EXACT" not in syms


# ── Pre-market volume filter ───────────────────────────────────────────────────

def test_volume_filter_excludes_below_50k():
    """Stocks with fewer than 50K shares traded are excluded."""
    from api.services.massive import get_movers
    from api.services.cache import cache
    cache.invalidate("movers")

    mock_client = MagicMock()
    mock_client.get_top_movers.side_effect = lambda direction, limit: (
        [
            _make_mover("LIQUID", 4.0, volume=500_000),
            _make_mover("THIN",   5.0, volume=30_000),  # < 50K — excluded
            _make_mover("EDGE",   3.5, volume=50_000),  # exactly 50K — included
        ] if direction == "gainers" else []
    )

    with patch("api.services.massive._get_client", return_value=mock_client), \
         patch("api.services.massive._get_avg_dollar_vol", _dvol_pass):
        result = get_movers()

    syms = [r["sym"] for r in result["ripping"]]
    assert "LIQUID" in syms
    assert "EDGE"   in syms
    assert "THIN"   not in syms


# ── Avg dollar volume filter ───────────────────────────────────────────────────

def test_avg_dvol_filter_excludes_illiquid():
    """Stocks with avg 5-day dollar volume below $10M are excluded."""
    from api.services.massive import get_movers
    from api.services.cache import cache
    cache.invalidate("movers")

    mock_client = MagicMock()
    mock_client.get_top_movers.side_effect = lambda direction, limit: (
        [
            _make_mover("BIGLIQ",  4.0),
            _make_mover("THINLIQ", 5.0),
        ] if direction == "gainers" else []
    )

    def mock_dvol(tickers):
        return {"BIGLIQ": 50_000_000, "THINLIQ": 5_000_000}  # THINLIQ < $10M

    with patch("api.services.massive._get_client", return_value=mock_client), \
         patch("api.services.massive._get_avg_dollar_vol", mock_dvol):
        result = get_movers()

    syms = [r["sym"] for r in result["ripping"]]
    assert "BIGLIQ"  in syms
    assert "THINLIQ" not in syms


def test_avg_dvol_unknown_ticker_passes():
    """If yfinance can't fetch history (returns inf), ticker is not filtered out."""
    from api.services.massive import get_movers
    from api.services.cache import cache
    cache.invalidate("movers")

    mock_client = MagicMock()
    mock_client.get_top_movers.side_effect = lambda direction, limit: (
        [_make_mover("UNKNOWN", 4.0)] if direction == "gainers" else []
    )

    def mock_dvol(tickers):
        return {t: float("inf") for t in tickers}  # simulates yfinance failure

    with patch("api.services.massive._get_client", return_value=mock_client), \
         patch("api.services.massive._get_avg_dollar_vol", mock_dvol):
        result = get_movers()

    assert any(r["sym"] == "UNKNOWN" for r in result["ripping"])
