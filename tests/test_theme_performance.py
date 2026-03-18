# tests/test_theme_performance.py
import pytest
from unittest.mock import patch, MagicMock


# ── Task 1 tests ──────────────────────────────────────────────────────────────

def test_get_agg_bars_returns_results():
    """get_agg_bars returns a list of bar dicts on success."""
    mock_response = {
        "status": "OK",
        "results": [
            {"t": 1700000000000, "o": 10.0, "h": 11.0, "l": 9.5, "c": 10.5, "v": 100000},
            {"t": 1700086400000, "o": 10.5, "h": 12.0, "l": 10.0, "c": 11.0, "v": 120000},
        ]
    }
    with patch("api.services.massive._get_client") as mock_client_fn:
        mock_client = MagicMock()
        mock_client._get.return_value = mock_response
        mock_client_fn.return_value = mock_client

        from api.services.massive import get_agg_bars
        bars = get_agg_bars("RKLB", "2025-01-01", "2026-03-18")

    assert len(bars) == 2
    assert bars[0]["c"] == 10.5


def test_get_agg_bars_returns_empty_on_error():
    """get_agg_bars returns [] on any exception (graceful degradation)."""
    with patch("api.services.massive._get_client") as mock_client_fn:
        mock_client_fn.side_effect = RuntimeError("Massive unavailable")

        from api.services.massive import get_agg_bars
        bars = get_agg_bars("RKLB", "2025-01-01", "2026-03-18")

    assert bars == []
