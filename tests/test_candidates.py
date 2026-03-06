"""Tests for get_candidates() service function."""
import copy
import json
import pytest
from unittest.mock import patch, MagicMock
from api.services.engine import get_candidates, _EMPTY_CANDIDATES


def _make_candidates(total=5):
    """Return a minimal valid candidates dict."""
    return {
        "generated_at": "2026-03-05 07:00:00 CT",
        "market_date": "2026-03-05",
        "is_premarket_window": True,
        "leading_sectors_used": ["Technology"],
        "leading_sectors_source": "leading_sectors.json",
        "note": "test",
        "candidates": {
            "pullback_ma": [{"ticker": "NVDA", "setup_type": "PULLBACK_MA"}],
            "gapper_news": [],
            "remount": [],
        },
        "counts": {"pullback_ma": 1, "gapper_news": 0, "remount": 0, "total": 1},
        "scan_meta": {"skipped_rows": 0, "deduplicated_tickers": [], "runtime_seconds": 5.0, "errors": []},
    }


def test_returns_cached_value():
    """Returns cached candidates when cache hit."""
    expected = _make_candidates()
    with patch("api.services.engine.cache") as mock_cache:
        mock_cache.get.return_value = expected
        result = get_candidates()
    assert result == expected
    mock_cache.get.assert_called_once_with("candidates")


def test_falls_back_to_wire_data():
    """Falls back to wire_data['candidates'] when cache miss."""
    expected = _make_candidates()
    wire = {"candidates": expected, "themes": {}}
    with patch("api.services.engine.cache") as mock_cache:
        mock_cache.get.side_effect = lambda key: None if key == "candidates" else wire
        result = get_candidates()
    assert result == expected


def test_returns_empty_structure_when_no_data():
    """Returns empty structure when cache and wire_data both miss, no local file."""
    with patch("api.services.engine.cache") as mock_cache:
        mock_cache.get.return_value = None
        with patch("pathlib.Path.exists", return_value=False):
            result = get_candidates()
    assert result["counts"]["total"] == 0
    assert result["candidates"]["pullback_ma"] == []
    assert result["generated_at"] is None


def test_empty_candidates_not_mutated():
    """_EMPTY_CANDIDATES sentinel is not mutated by get_candidates()."""
    original = copy.deepcopy(_EMPTY_CANDIDATES)
    with patch("api.services.engine.cache") as mock_cache:
        mock_cache.get.return_value = None
        with patch("pathlib.Path.exists", return_value=False):
            result = get_candidates()
    result["counts"]["total"] = 999  # mutate the returned copy
    assert _EMPTY_CANDIDATES == original  # sentinel unchanged
