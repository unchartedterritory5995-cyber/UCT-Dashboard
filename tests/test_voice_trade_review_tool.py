"""P5-H — get_my_trade_review voice tool tests."""

import uuid
from unittest.mock import patch

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services.voice_tool_impls import _get_my_trade_review


def _user():
    init_db()
    return create_user(f"trv_{uuid.uuid4()}@x.com", "p")["id"]


def test_no_reviews_returns_friendly_message():
    uid = _user()
    with patch("api.services.journal_two.trade_review.list_reviews",
               return_value={"reviews": []}):
        out = _get_my_trade_review(user={"id": uid})
    assert out["ok"] is True
    assert out["count"] == 0
    assert "No trade reviews" in out["narration"]


def test_latest_review_returned_when_no_filter():
    uid = _user()
    fake_reviews = [
        {"id": "r2", "trade_id": "t2", "body": "Newer review", "summary": "Newer summary"},
        {"id": "r1", "trade_id": "t1", "body": "Older",        "summary": "Older s"},
    ]
    with patch("api.services.journal_two.trade_review.list_reviews",
               return_value={"reviews": fake_reviews}):
        out = _get_my_trade_review(user={"id": uid})
    assert out["ok"] is True
    assert out["review_id"] == "r2"
    assert "Newer" in out["narration"]


def test_exact_trade_id_lookup():
    uid = _user()
    fake = [
        {"id": "r1", "trade_id": "t1", "body": "A", "summary": "sumA"},
        {"id": "r2", "trade_id": "t2", "body": "B", "summary": "sumB"},
    ]
    with patch("api.services.journal_two.trade_review.list_reviews",
               return_value={"reviews": fake}):
        out = _get_my_trade_review(user={"id": uid}, trade_id="t2")
    assert out["review_id"] == "r2"


def test_trade_id_not_found_returns_error():
    uid = _user()
    with patch("api.services.journal_two.trade_review.list_reviews",
               return_value={"reviews": [{"id": "r1", "trade_id": "t1", "body": "x"}]}):
        out = _get_my_trade_review(user={"id": uid}, trade_id="ZZZ")
    assert out["ok"] is False
    assert out["error"] == "review_not_found"


def test_symbol_lookup_via_trades():
    uid = _user()
    fake_reviews = [
        {"id": "r1", "trade_id": "t-NVDA", "body": "nvda review", "summary": "nvda s"},
        {"id": "r2", "trade_id": "t-AAPL", "body": "aapl review", "summary": "aapl s"},
    ]
    fake_trades = [
        {"id": "t-NVDA", "symbol": "NVDA"},
        {"id": "t-AAPL", "symbol": "AAPL"},
    ]
    with patch("api.services.journal_two.trade_review.list_reviews",
               return_value={"reviews": fake_reviews}), \
         patch("api.services.journal_two.trades.list_trades_for_user",
               return_value=fake_trades):
        out = _get_my_trade_review(user={"id": uid}, symbol="AAPL")
    assert out["review_id"] == "r2"


def test_symbol_no_match_returns_friendly_fallback():
    uid = _user()
    fake_reviews = [{"id": "r1", "trade_id": "t1", "body": "x", "summary": "s"}]
    fake_trades = [{"id": "t1", "symbol": "MSFT"}]
    with patch("api.services.journal_two.trade_review.list_reviews",
               return_value={"reviews": fake_reviews}), \
         patch("api.services.journal_two.trades.list_trades_for_user",
               return_value=fake_trades):
        out = _get_my_trade_review(user={"id": uid}, symbol="NVDA")
    assert out["ok"] is True
    assert out["count"] == 0
    assert "No post-mortem on file for NVDA" in out["narration"]


def test_tool_in_compass_allowlist():
    import api.services.voice_tool_impls  # noqa: F401
    from api.services.voice_tools import _REGISTRY
    from api.services.voice_agents import get_agent
    assert "get_my_trade_review" in _REGISTRY
    compass = get_agent("compass")
    assert "get_my_trade_review" in compass["tool_allowlist"]
