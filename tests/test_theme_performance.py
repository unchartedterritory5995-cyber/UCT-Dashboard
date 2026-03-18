# tests/test_theme_performance.py
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from api.main import app


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


# ── Task 2 tests ──────────────────────────────────────────────────────────────

def test_compute_returns_all_periods():
    """_compute_returns returns correct values for all 6 periods."""
    from api.services.theme_performance import _compute_returns

    # Build fake bars: 300 daily bars, closing prices 1..300
    from datetime import datetime, timedelta

    base_ms = int(datetime(2025, 1, 2).timestamp() * 1000)
    day_ms = 86400 * 1000
    bars = [
        {"t": base_ms + i * day_ms, "c": float(i + 1)}
        for i in range(300)
    ]

    result = _compute_returns(bars)

    # Last close = 300, prev close = 299 → 1D ≈ +0.33%
    assert result["1d"] == pytest.approx((300 - 299) / 299 * 100, abs=0.01)
    # 5 sessions ago = bar[294] = close 295 → 1W ≈ +1.69%
    assert result["1w"] == pytest.approx((300 - 295) / 295 * 100, abs=0.01)
    # All periods are floats (not None)
    for key in ("1d", "1w", "1m", "3m", "1y", "ytd"):
        assert result[key] is not None


def test_compute_returns_handles_sparse_bars():
    """_compute_returns returns available periods when bars < full history."""
    from api.services.theme_performance import _compute_returns

    # Only 3 bars — can compute 1D, but not 1W/1M/etc (falls back to first bar)
    bars = [
        {"t": 1700000000000, "c": 100.0},
        {"t": 1700086400000, "c": 105.0},
        {"t": 1700172800000, "c": 110.0},
    ]
    result = _compute_returns(bars)
    assert result["1d"] == pytest.approx((110 - 105) / 105 * 100, abs=0.01)
    # When not enough bars, falls back to first bar close (100.0)
    assert result["1w"] == pytest.approx((110 - 100) / 100 * 100, abs=0.01)


def test_compute_returns_empty_bars():
    """_compute_returns returns all None for empty bar list."""
    from api.services.theme_performance import _compute_returns

    result = _compute_returns([])
    for key in ("1d", "1w", "1m", "3m", "1y", "ytd"):
        assert result[key] is None


def test_build_theme_performance_shape():
    """get_theme_performance returns correct shape with mocked data."""
    MOCK_WIRE = {
        "themes": {
            "UFO": {
                "name": "Space",
                "etf_name": "Procure Space ETF",
                "holdings": [
                    {"sym": "RKLB", "name": "Rocket Lab", "pct": 8.5},
                    {"sym": "ASTS", "name": "AST SpaceMobile", "pct": 6.1},
                ],
                "intl_holdings": [],
                "1W": 5.2, "1M": 12.3, "3M": 30.1,
            }
        }
    }
    FAKE_BARS = [{"t": 1700000000000 + i * 86400000, "c": float(100 + i)} for i in range(300)]

    with patch("api.services.theme_performance._load_wire_data", return_value=MOCK_WIRE), \
         patch("api.services.theme_performance.get_agg_bars", return_value=FAKE_BARS), \
         patch("api.services.theme_performance.cache") as mock_cache:
        mock_cache.get.return_value = None  # no cached value

        from api.services.theme_performance import get_theme_performance
        result = get_theme_performance()

    assert "themes" in result
    assert len(result["themes"]) == 1
    theme = result["themes"][0]
    assert theme["name"] == "Space"
    assert theme["ticker"] == "UFO"
    assert len(theme["holdings"]) == 2
    holding = theme["holdings"][0]
    assert holding["sym"] == "RKLB"
    assert "returns" in holding
    for period in ("1d", "1w", "1m", "3m", "1y", "ytd"):
        assert period in holding["returns"]


def test_build_theme_performance_no_wire_data():
    """get_theme_performance returns empty themes when wire_data unavailable."""
    with patch("api.services.theme_performance._load_wire_data", return_value=None), \
         patch("api.services.theme_performance.cache") as mock_cache:
        mock_cache.get.return_value = None

        from api.services.theme_performance import get_theme_performance
        result = get_theme_performance()

    assert result["themes"] == []


# ── Task 3 tests ──────────────────────────────────────────────────────────────

def test_theme_performance_endpoint_returns_200():
    """GET /api/theme-performance returns 200 with correct shape."""
    MOCK_RESULT = {
        "themes": [{"name": "Space", "ticker": "UFO", "etf_name": "Procure Space ETF", "holdings": []}],
        "generated_at": "2026-03-18T09:00:00",
    }

    # Patch at the service level (not the router alias) so the mock is reliable
    # even when api.main is already cached in sys.modules from prior test imports.
    with patch("api.services.theme_performance.get_theme_performance", return_value=MOCK_RESULT):
        client = TestClient(app)
        resp = client.get("/api/theme-performance")

    assert resp.status_code == 200
    data = resp.json()
    assert "themes" in data
    assert "generated_at" in data
