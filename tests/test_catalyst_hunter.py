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


# ---- cost-reduction behaviors (2026-07-02) ---------------------------------

def _fake_client_capturing(captured, payload=None, usage=None):
    payload = payload or json.dumps({"hits": []})
    msg = types.SimpleNamespace(
        content=[types.SimpleNamespace(text=payload)],
        usage=usage or types.SimpleNamespace(input_tokens=10, output_tokens=20),
        stop_reason="end_turn",
    )

    def create(**kw):
        captured.append(kw)
        return msg

    return types.SimpleNamespace(messages=types.SimpleNamespace(create=create))


def test_deep_hunt_caches_prompt_and_caps_searches(monkeypatch):
    monkeypatch.setenv("CATALYST_HUNTER_ENABLED", "1")
    captured = []
    import api.services.engine as eng
    monkeypatch.setattr(eng, "_get_anthropic_client",
                        lambda: _fake_client_capturing(captured))

    hunter.run_hunt("deep")

    kw = captured[0]
    assert kw["cache_control"] == {"type": "ephemeral"}
    assert kw["tools"][0]["max_uses"] == 12
    assert kw["model"] == "claude-opus-4-8"


def test_light_hunt_uses_cheaper_model_and_fewer_searches(monkeypatch):
    monkeypatch.setenv("CATALYST_HUNTER_ENABLED", "1")
    monkeypatch.delenv("CATALYST_HUNTER_LIGHT_MODEL", raising=False)
    captured = []
    import api.services.engine as eng
    monkeypatch.setattr(eng, "_get_anthropic_client",
                        lambda: _fake_client_capturing(captured))

    hunter.run_hunt("light", existing_tickers={"AAPL"})

    kw = captured[0]
    assert kw["model"] == "claude-sonnet-5"
    assert kw["tools"][0]["max_uses"] == 4


def test_hunt_skipped_when_daily_cap_tripped(monkeypatch):
    monkeypatch.setenv("CATALYST_HUNTER_ENABLED", "1")
    from api.services.catalyst import cost_guard
    monkeypatch.setattr(cost_guard, "may_synthesize", lambda md: False)

    captured = []
    import api.services.engine as eng
    monkeypatch.setattr(eng, "_get_anthropic_client",
                        lambda: _fake_client_capturing(captured))

    assert hunter.run_hunt("deep") == []
    assert captured == []  # no model call may be made once the cap is tripped


def test_hunt_records_web_search_fees(monkeypatch):
    monkeypatch.setenv("CATALYST_HUNTER_ENABLED", "1")
    usage = types.SimpleNamespace(
        input_tokens=100, output_tokens=50,
        server_tool_use=types.SimpleNamespace(web_search_requests=7),
    )
    captured = []
    import api.services.engine as eng
    monkeypatch.setattr(eng, "_get_anthropic_client",
                        lambda: _fake_client_capturing(captured, usage=usage))

    recorded = {}
    from api.services.catalyst import cost_guard

    def fake_record(md, ticker, model, itok, otok, was_cached=False,
                    search_requests=0, **kw):
        # **kw so a new cost field (e.g. the 2026-08-28 cache tokens) doesn't
        # make the real call raise into hunter's swallowing try/except and
        # leave this assertion reading an EMPTY dict instead of failing loudly
        recorded.update(ticker=ticker, search_requests=search_requests, **kw)
        return 0.0

    monkeypatch.setattr(cost_guard, "record", fake_record)

    hunter.run_hunt("deep")
    assert recorded["ticker"] == "__hunter__"
    assert recorded["search_requests"] == 7
