# tests/test_news_classify.py
import pytest


def test_classify_earnings():
    from api.services.engine import _classify_category
    item = {"topics": [{"topic": "Earnings", "relevance_score": "0.9"}]}
    assert _classify_category(item, "NVDA beats Q4 estimates") == "EARN"


def test_classify_ma():
    from api.services.engine import _classify_category
    item = {"topics": [{"topic": "Mergers & Acquisitions", "relevance_score": "0.8"}]}
    assert _classify_category(item, "Firm acquires rival for $2B") == "M&A"


def test_classify_upgrade_from_headline():
    from api.services.engine import _classify_category
    item = {"topics": [{"topic": "Finance", "relevance_score": "0.5"}]}
    assert _classify_category(item, "Goldman upgrades to Buy, raises price target to $500") == "UPGRADE"


def test_classify_downgrade_from_headline():
    from api.services.engine import _classify_category
    item = {"topics": []}
    assert _classify_category(item, "JPMorgan downgrades to Sell on margin concerns") == "DOWNGRADE"


def test_classify_bio():
    from api.services.engine import _classify_category
    item = {"topics": [{"topic": "Life Sciences", "relevance_score": "0.7"}]}
    assert _classify_category(item, "Phase 3 trial results announced") == "BIO"


def test_classify_general_fallback():
    from api.services.engine import _classify_category
    item = {"topics": [{"topic": "Technology", "relevance_score": "0.6"}]}
    assert _classify_category(item, "Company announces new office lease") == "GENERAL"


def test_map_sentiment_bullish():
    from api.services.engine import _map_sentiment
    assert _map_sentiment("Bullish") == "bullish"
    assert _map_sentiment("Somewhat-Bullish") == "bullish"


def test_map_sentiment_bearish():
    from api.services.engine import _map_sentiment
    assert _map_sentiment("Bearish") == "bearish"
    assert _map_sentiment("Somewhat-Bearish") == "bearish"


def test_map_sentiment_neutral():
    from api.services.engine import _map_sentiment
    assert _map_sentiment("Neutral") == "neutral"
    assert _map_sentiment("") == "neutral"
    assert _map_sentiment(None) == "neutral"
