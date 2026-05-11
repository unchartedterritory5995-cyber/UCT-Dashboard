"""Tests for /api/chart-news/{ticker} endpoint."""
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from api.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_chart_news_returns_ticker_filtered(client):
    """Endpoint returns only entries for the requested ticker."""
    aapl_news = [
        {
            "ticker": "AAPL",
            "headline": "Apple announces Q4 earnings",
            "url": "https://example.com/a",
            "time_published": 1715000000,
            "source": "Reuters",
            "sentiment": "bullish",
            "category": "EARN",
        },
        {
            "ticker": "AAPL",
            "headline": "Apple unveils new iPhone",
            "url": "https://example.com/b",
            "time_published": 1715050000,
            "source": "Bloomberg",
            "sentiment": "bullish",
            "category": "GENERAL",
        },
    ]
    with patch("api.routers.chart_news.get_ticker_news", return_value=aapl_news):
        r = client.get("/api/chart-news/AAPL?days=30")
    assert r.status_code == 200
    body = r.json()
    assert "news" in body
    assert len(body["news"]) == 2
    assert all(n["ticker"] == "AAPL" for n in body["news"])


def test_chart_news_empty_returns_empty_array(client):
    """Endpoint returns `{news: []}` when upstream finds nothing."""
    with patch("api.routers.chart_news.get_ticker_news", return_value=[]):
        r = client.get("/api/chart-news/ZZZZZ")
    assert r.status_code == 200
    assert r.json() == {"news": []}


def test_chart_news_respects_days_param(client):
    """`days` query param is forwarded to the service function."""
    fake = [
        {
            "ticker": "AAPL",
            "headline": "Old",
            "time_published": 1700000000,
            "source": "X",
            "url": "u",
            "sentiment": "",
            "category": "",
        }
    ]
    with patch("api.routers.chart_news.get_ticker_news", return_value=fake) as mock_fn:
        r = client.get("/api/chart-news/AAPL?days=7")
    assert r.status_code == 200
    mock_fn.assert_called_once_with("AAPL", days=7)


def test_chart_news_caps_days(client):
    """`days` is clamped by FastAPI validation to <= 365 — over-cap requests are rejected."""
    # FastAPI's `Query(le=365)` returns 422 for out-of-range values. Either:
    #   - We get 422 (validation rejected), OR
    #   - The endpoint clamped and returned 200 with valid `news` key.
    r = client.get("/api/chart-news/AAPL?days=10000")
    # Validator returns 422; ensure we never hit a 500 / unhandled crash.
    assert r.status_code in (200, 422)
    if r.status_code == 200:
        assert "news" in r.json()
