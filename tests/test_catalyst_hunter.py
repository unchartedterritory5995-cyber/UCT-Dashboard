"""Tests for the Catalyst Hunter (pure parsing/validation + gated run_hunt)."""
import json
import types

import pytest

from api.services.catalyst import hunter


def test_coerce_drops_bad_tickers_and_coerces_type():
    raw = {"hits": [
        {"ticker": "AAPL", "catalyst_type": "Analyst", "headline": "PT raised", "moving_yet": False},
        {"ticker": "toolong6x", "catalyst_type": "M&A", "headline": "deal"},          # bad ticker
        {"ticker": "NWco", "catalyst_type": "Weird", "headline": "news", "moving_yet": 1},  # type→News, bool cast
        {"ticker": "NOHEAD", "catalyst_type": "FDA", "headline": ""},                  # no headline
        {"ticker": "BRK.B", "catalyst_type": "Guidance", "headline": "raised FY"},     # dot-class ok
    ]}
    out = hunter._coerce_hits(raw)
    tickers = {h["ticker"] for h in out}
    assert tickers == {"AAPL", "NWCO", "BRK.B"}
    nwco = next(h for h in out if h["ticker"] == "NWCO")
    assert nwco["catalyst_type"] == "News"      # unknown coerced
    assert nwco["moving_yet"] is True           # 1 → True


def test_coerce_accepts_bare_list_and_dedupes():
    raw = [
        {"ticker": "X", "catalyst_type": "News", "headline": "a"},
        {"ticker": "x", "catalyst_type": "News", "headline": "dup"},  # same ticker, dropped
    ]
    out = hunter._coerce_hits(raw)
    assert len(out) == 1 and out[0]["ticker"] == "X"


def test_run_hunt_disabled_returns_empty(monkeypatch):
    monkeypatch.delenv("CATALYST_HUNTER_ENABLED", raising=False)
    assert hunter.run_hunt("deep") == []


def test_run_hunt_happy_path(monkeypatch):
    monkeypatch.setenv("CATALYST_HUNTER_ENABLED", "1")

    payload = json.dumps({"hits": [
        {"ticker": "NVDA", "catalyst_type": "Analyst", "headline": "Upgraded to Buy",
         "source_url": "https://x", "when": "pre-market", "moving_yet": False},
    ]})
    fake_msg = types.SimpleNamespace(
        content=[types.SimpleNamespace(text=payload)],
        usage=types.SimpleNamespace(input_tokens=10, output_tokens=20),
        stop_reason="end_turn",
    )
    fake_client = types.SimpleNamespace(
        messages=types.SimpleNamespace(create=lambda **kw: fake_msg))

    import api.services.engine as eng
    monkeypatch.setattr(eng, "_get_anthropic_client", lambda: fake_client)

    hits = hunter.run_hunt("deep")
    assert len(hits) == 1
    assert hits[0]["ticker"] == "NVDA"
    assert hits[0]["catalyst_type"] == "Analyst"
    assert hits[0]["moving_yet"] is False
