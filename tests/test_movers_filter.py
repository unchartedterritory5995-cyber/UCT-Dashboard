import pytest
from unittest.mock import patch, MagicMock


def _make_mover(ticker, change_pct):
    return {"ticker": ticker, "change_pct": change_pct}


def test_gap_filter_excludes_sub_3pct():
    """Stocks moving less than 3% in either direction are excluded."""
    from api.services.massive import get_movers
    from api.services.cache import cache
    cache.invalidate("movers")

    mock_client = MagicMock()
    mock_client.get_top_movers.side_effect = lambda direction, limit: (
        [
            _make_mover("NVDA", 5.2),
            _make_mover("AAPL", 1.5),   # < 3% — should be excluded
            _make_mover("TSLA", 3.0),
        ] if direction == "gainers" else [
            _make_mover("META", -4.1),
            _make_mover("AMZN", -2.9),  # < 3% — should be excluded
            _make_mover("GOOG", -3.5),
        ]
    )

    with patch("api.services.massive._get_client", return_value=mock_client):
        result = get_movers()

    ripping_syms = [r["sym"] for r in result["ripping"]]
    drilling_syms = [r["sym"] for r in result["drilling"]]

    assert "NVDA" in ripping_syms
    assert "TSLA" in ripping_syms
    assert "AAPL" not in ripping_syms       # 1.5% excluded

    assert "META" in drilling_syms
    assert "GOOG" in drilling_syms
    assert "AMZN" not in drilling_syms      # 2.9% excluded


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

    with patch("api.services.massive._get_client", return_value=mock_client):
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

    with patch("api.services.massive._get_client", return_value=mock_client):
        result = get_movers()

    assert result["ripping"] == []
    assert result["drilling"] == []
