import json
import os
import tempfile
from unittest.mock import MagicMock, patch

import pytest

from api.services.catalyst import store, synthesize


@pytest.fixture
def s(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(store, "_DB_PATH", os.path.join(d, "catalysts.db"))
        store._init_db()
        yield


def _candidate(**kw):
    return {
        "ticker": kw.get("ticker", "AAPL"),
        "company": kw.get("company", "Apple Inc"),
        "price": kw.get("price", 150.0),
        "gap_pct": kw.get("gap_pct", 3.5),
        "vol_x": kw.get("vol_x", 2.0),
        "market_cap": kw.get("market_cap", 2_500_000_000_000),
        "sector": kw.get("sector", "Tech"),
        "tweets": kw.get("tweets", []),
        "rss": kw.get("rss", []),
        "earnings_meta": kw.get("earnings_meta"),
        "scanner_setup": kw.get("scanner_setup"),
    }


def _mock_opus_response(text):
    block = MagicMock(); block.text = text
    msg = MagicMock()
    msg.content = [block]
    msg.usage = MagicMock()
    msg.usage.input_tokens = 1000
    msg.usage.output_tokens = 250
    return msg


def test_signals_hash_stable_for_same_inputs():
    c1 = _candidate(tweets=[{"id": "1", "text": "x"}])
    c2 = _candidate(tweets=[{"id": "1", "text": "x"}])
    assert synthesize.compute_signals_hash(c1) == synthesize.compute_signals_hash(c2)


def test_signals_hash_changes_when_inputs_change():
    c1 = _candidate(tweets=[{"id": "1", "text": "x"}])
    c2 = _candidate(tweets=[{"id": "2", "text": "y"}])
    assert synthesize.compute_signals_hash(c1) != synthesize.compute_signals_hash(c2)


def test_skip_if_stable_reuses_prior_thesis(s):
    c = _candidate()
    h = synthesize.compute_signals_hash(c)
    store.upsert_catalyst({
        "market_date": "2026-05-26", "ticker": "AAPL", "rank": 1,
        "score": 50.0, "tag": "Catalyst", "price": 150.0, "gap_pct": 3.5,
        "vol_x": 2.0, "market_cap": 2_500_000_000_000, "sector": "Tech",
        "thesis_text": "Cached thesis", "thesis_model": "claude-opus-4-7",
        "thesis_at": 1000, "thesis_sources": "[]",
        "signals_hash": h, "raw_signals": "{}",
    })
    with patch("api.services.catalyst.synthesize._call_anthropic") as mock_call:
        result = synthesize.synthesize_ticker(c, "2026-05-26")
    mock_call.assert_not_called()
    assert result["thesis_text"] == "Cached thesis"
    assert result["was_cached"] is True


def test_opus_call_on_fresh_input(s):
    # Candidate has sources so no-sources enforcement doesn't trip
    c = _candidate(tweets=[{"id": "1", "text": "AAPL beat", "author_handle": "x", "url": "u"}])
    payload = {"thesis": "**Apple** beat earnings.", "tag": "Earnings",
               "source_urls": ["http://x"]}
    with patch("api.services.catalyst.synthesize._call_anthropic",
               return_value=(_mock_opus_response(json.dumps(payload)), 1000, 250)):
        result = synthesize.synthesize_ticker(c, "2026-05-26")
    assert result["thesis_text"] == payload["thesis"]
    assert result["was_cached"] is False
    assert result["thesis_model"] == "claude-opus-4-7"


def test_falls_back_to_haiku_on_opus_5xx(s):
    # Candidate has sources so no-sources enforcement doesn't trip
    c = _candidate(tweets=[{"id": "1", "text": "x", "author_handle": "h", "url": "u"}])
    payload = {"thesis": "Fallback haiku.", "tag": "News",
               "source_urls": ["http://x"]}
    call_count = {"n": 0}

    def side_effect(model, prompt, system):
        call_count["n"] += 1
        if "opus" in model:
            raise Exception("APIError: 500 Internal Server Error")
        return (_mock_opus_response(json.dumps(payload)), 500, 100)

    with patch("api.services.catalyst.synthesize._call_anthropic",
               side_effect=side_effect):
        result = synthesize.synthesize_ticker(c, "2026-05-26")
    assert result["thesis_model"].startswith("claude-haiku")
    assert "Fallback" in result["thesis_text"]
    assert call_count["n"] == 2


def test_no_sources_synthesis_must_say_no_catalyst(s):
    c = _candidate(tweets=[], rss=[], earnings_meta=None, scanner_setup=None)
    bad_payload = {"thesis": "Apple surged on bullish vibes.", "tag": "Gapper",
                   "source_urls": []}
    good_payload = {"thesis": "No clear catalyst identified. Source pool was thin.",
                    "tag": "Gapper", "source_urls": []}
    responses = iter([
        (_mock_opus_response(json.dumps(bad_payload)), 1000, 100),
        (_mock_opus_response(json.dumps(good_payload)), 1000, 100),
    ])
    with patch("api.services.catalyst.synthesize._call_anthropic",
               side_effect=lambda *a, **kw: next(responses)):
        result = synthesize.synthesize_ticker(c, "2026-05-26")
    assert "no clear catalyst" in result["thesis_text"].lower()


def test_malformed_json_keeps_prior_thesis(s):
    c = _candidate()
    store.upsert_catalyst({
        "market_date": "2026-05-26", "ticker": "AAPL", "rank": 1,
        "score": 50.0, "tag": "Catalyst", "price": 150.0, "gap_pct": 3.5,
        "vol_x": 2.0, "market_cap": 2_500_000_000_000, "sector": "Tech",
        "thesis_text": "Prior good thesis", "thesis_model": "claude-opus-4-7",
        "thesis_at": 1000, "thesis_sources": "[]",
        "signals_hash": "different_hash", "raw_signals": "{}",
    })
    with patch("api.services.catalyst.synthesize._call_anthropic",
               return_value=(_mock_opus_response("not valid json {"), 1000, 100)):
        result = synthesize.synthesize_ticker(c, "2026-05-26")
    assert result["thesis_text"] == "Prior good thesis"


def test_cost_cap_blocks_synthesis(s, monkeypatch):
    monkeypatch.setenv("CATALYST_COST_HARD_CAP", "0.001")
    store.log_cost(market_date="2026-05-26", ticker="X",
                   model="claude-opus-4-7", input_tokens=1000,
                   output_tokens=1000, cost_usd=1.0, was_cached=False)
    c = _candidate()
    with patch("api.services.catalyst.synthesize._call_anthropic") as mock_call:
        result = synthesize.synthesize_ticker(c, "2026-05-26")
    mock_call.assert_not_called()
    assert "cost cap reached" in result["thesis_text"].lower() or result["was_cached"]
