# tests/test_news_dedup.py
import pytest


def _make_item(ticker, category, time_str, source="Benzinga", headline="Test"):
    return {
        "headline": headline, "source": source,
        "url": f"http://x.com/{ticker}/{category}/{time_str.replace(' ', '_')}",
        "time": time_str, "category": category, "sentiment": "neutral",
        "tickers": [ticker],
    }


def test_dedup_collapses_same_event():
    from api.services.engine import _deduplicate_news
    items = [
        _make_item("NVDA", "EARN", "2026-03-03 07:00:00", "Reuters"),
        _make_item("NVDA", "EARN", "2026-03-03 07:05:00", "Benzinga"),
        _make_item("NVDA", "EARN", "2026-03-03 07:10:00", "AP"),
    ]
    result = _deduplicate_news(items)
    assert len(result) == 1
    assert "Reuters" in result[0]["source"]


def test_dedup_keeps_different_categories():
    from api.services.engine import _deduplicate_news
    items = [
        _make_item("NVDA", "EARN",    "2026-03-03 07:00:00"),
        _make_item("NVDA", "UPGRADE", "2026-03-03 07:30:00"),
    ]
    result = _deduplicate_news(items)
    assert len(result) == 2


def test_dedup_keeps_different_tickers():
    from api.services.engine import _deduplicate_news
    items = [
        _make_item("NVDA", "EARN", "2026-03-03 07:00:00"),
        _make_item("TSLA", "EARN", "2026-03-03 07:00:00"),
    ]
    result = _deduplicate_news(items)
    assert len(result) == 2


def test_sort_earn_first_standard():
    from api.services.engine import _sort_news
    items = [
        _make_item("X", "GENERAL", "2026-03-03 10:00:00"),
        _make_item("Y", "EARN",    "2026-03-03 09:00:00"),
        _make_item("Z", "UPGRADE", "2026-03-03 10:00:00"),
    ]
    result = _sort_news(items, is_premarket=False)
    assert result[0]["category"] == "EARN"
    assert result[1]["category"] == "UPGRADE"


def test_sort_premarket_pins_earn_ma_bio():
    from api.services.engine import _sort_news
    items = [
        _make_item("A", "GENERAL", "2026-03-03 07:00:00"),
        _make_item("B", "UPGRADE", "2026-03-03 07:01:00"),
        _make_item("C", "EARN",    "2026-03-03 06:00:00"),
        _make_item("D", "BIO",     "2026-03-03 06:30:00"),
    ]
    result = _sort_news(items, is_premarket=True)
    top_cats = {r["category"] for r in result[:2]}
    assert top_cats == {"EARN", "BIO"}
