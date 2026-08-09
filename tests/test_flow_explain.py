"""Tests for api/flow_explain.py — AI Print Explainer (POST /api/flow-explain).

No network: the Anthropic client is monkeypatched at the shared-client getter
(api.services.engine._get_anthropic_client) and engine.get_earnings is stubbed.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.flow_explain as fe
from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
)


# ── Fakes / fixtures ─────────────────────────────────────────────────────────

_GOOD_JSON = json.dumps({
    "explanation": "A large sweep hit the asks. Volume dwarfs open interest, so "
                   "this is likely a new position. The buyer paid up for near-term "
                   "calls. Watch tomorrow's open interest at this strike.",
    "signals": ["Vol 2.9x OI — likely opening", "Paid the ask", "Weekly expiry"],
})


class FakeAnthropic:
    """Stands in for the shared Anthropic client (with_options + messages.create)."""

    def __init__(self, behavior=_GOOD_JSON, input_tokens=500, output_tokens=150):
        self.behavior = behavior
        self.calls: list[dict] = []
        self._usage = SimpleNamespace(input_tokens=input_tokens, output_tokens=output_tokens)
        self.messages = SimpleNamespace(create=self._create)

    def with_options(self, **_kw):
        return self

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.behavior, Exception):
            raise self.behavior
        block = SimpleNamespace(type="text", text=self.behavior)
        return SimpleNamespace(content=[block], usage=self._usage)


@pytest.fixture(autouse=True)
def _isolated_state(tmp_path, monkeypatch):
    """Temp sqlite DB per test + cleared module caches + no-network earnings."""
    monkeypatch.setenv("FLOW_EXPLAIN_DB_PATH", str(tmp_path / "flow_explain.db"))
    monkeypatch.delenv("FLOW_EXPLAIN_MODEL", raising=False)
    monkeypatch.delenv("FLOW_EXPLAIN_DAILY_CAP_USD", raising=False)
    monkeypatch.delenv("FLOW_EXPLAIN_USER_DAILY_CAP", raising=False)
    fe._MEM_CACHE.clear()
    fe._MEM_COSTS.clear()
    fe._MEM_USER_COUNTS.clear()
    fe._init_paths.clear()
    # get_earnings must never hit the network in tests
    import api.services.engine as engine
    monkeypatch.setattr(
        engine, "get_earnings",
        lambda: {"bmo": [], "amc": [], "amc_tonight": []},
    )
    yield
    fe._MEM_CACHE.clear()
    fe._MEM_COSTS.clear()
    fe._MEM_USER_COUNTS.clear()


@pytest.fixture
def fake_llm(monkeypatch):
    fake = FakeAnthropic()
    import api.services.engine as engine
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: fake)
    return fake


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(fe.router)
    paid = {"id": "user-1", "email": "t@example.com", "role": "user", "plan": "pro"}
    # ⚠️ REPAIRED 2026-08-09 — this route became `require_paid`. The override
    # below moved to `get_current_user_with_plan`, the gate's INPUT; the real
    # `require_paid` still runs. Overriding the GATE would mean never running it
    # (`lesson_injected_dependency_hides_the_fetch`), and asserting 200 for a
    # caller who merely has a SESSION is exactly the hole the sweep found —
    # signup is open and free.
    app.dependency_overrides[get_current_user] = lambda: dict(paid)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(paid)
    return TestClient(app)


def _print_body(**over) -> dict:
    body = dict(
        ticker="NVDA", cp="C", strike=190.0, exp="2026-08-21", dte=46,
        premium=525_000.0, volume=3200, oi=1100, side="ASK", spot=178.40,
        order_type="SWEEP", color="green", grade="A", tier="whale",
    )
    body.update(over)
    return body


def _parse(body_over=None) -> fe.FlowPrint:
    return fe.FlowPrint(**_print_body(**(body_over or {})))


# ── Context builder: vol/OI ─────────────────────────────────────────────────

def test_vol_over_oi_is_opening_verdict():
    ctx = fe.build_context(_parse({"volume": 3200, "oi": 1100}))
    voi = ctx["vol_vs_oi"]
    assert voi["verdict"] == "likely OPENING position — volume exceeds existing OI"
    assert voi["bucket"] == "opening"
    assert voi["ratio"] == pytest.approx(2.91, abs=0.01)


def test_vol_under_oi_is_ambiguous():
    ctx = fe.build_context(_parse({"volume": 500, "oi": 5000}))
    assert ctx["vol_vs_oi"]["verdict"] == "could be opening or closing"
    assert ctx["vol_vs_oi"]["bucket"] == "ambiguous"


def test_zero_oi_with_volume_is_opening_with_null_ratio():
    ctx = fe.build_context(_parse({"volume": 100, "oi": 0}))
    assert ctx["vol_vs_oi"]["bucket"] == "opening"
    assert ctx["vol_vs_oi"]["ratio"] is None


# ── Context builder: moneyness (both cp) ────────────────────────────────────

def test_moneyness_call_itm():
    m = fe.build_context(_parse({"cp": "C", "strike": 100.0, "spot": 110.0}))["moneyness"]
    assert m["label"] == "ITM"
    assert m["signed_pct"] == pytest.approx((110 - 100) / 110 * 100, abs=0.01)
    assert m["distance_pct"] == pytest.approx(9.09, abs=0.01)


def test_moneyness_call_otm():
    m = fe.build_context(_parse({"cp": "C", "strike": 110.0, "spot": 100.0}))["moneyness"]
    assert m["label"] == "OTM"
    assert m["signed_pct"] == pytest.approx(-10.0, abs=0.01)
    assert "above spot" in m["description"]


def test_moneyness_put_itm():
    m = fe.build_context(_parse({"cp": "P", "strike": 100.0, "spot": 90.0}))["moneyness"]
    assert m["label"] == "ITM"
    assert m["signed_pct"] == pytest.approx((100 - 90) / 90 * 100, abs=0.01)


def test_moneyness_put_otm():
    m = fe.build_context(_parse({"cp": "P", "strike": 100.0, "spot": 110.0}))["moneyness"]
    assert m["label"] == "OTM"
    assert m["signed_pct"] == pytest.approx(-9.09, abs=0.01)


def test_moneyness_atm_within_one_percent():
    m = fe.build_context(_parse({"cp": "C", "strike": 100.5, "spot": 100.0}))["moneyness"]
    assert m["label"] == "ATM"


# ── Context builder: DTE / premium / aggression ─────────────────────────────

@pytest.mark.parametrize("dte,expected", [
    (0, "0DTE"),
    (5, "weekly (<=7 DTE)"),
    (7, "weekly (<=7 DTE)"),
    (21, "near-term (<=30 DTE)"),
    (90, "medium-term (1-6 months)"),
    (200, "LEAPS (>=180 DTE)"),
])
def test_dte_buckets(dte, expected):
    assert fe.build_context(_parse({"dte": dte}))["dte_bucket"] == expected


@pytest.mark.parametrize("premium,expected", [
    (10_000, "small (<$50K premium)"),
    (60_000, "retail-plus ($50K+ premium)"),
    (300_000, "institutional-sized ($250K+ premium)"),
    (2_000_000, "whale-sized ($1M+ premium)"),
])
def test_premium_buckets(premium, expected):
    assert fe.build_context(_parse({"premium": premium}))["premium_bucket"] == expected


def test_aggression_reads():
    assert "extreme urgency" in fe.build_context(_parse({"side": "ABOVE ASK"}))["aggression"]["read"]
    assert "urgency" in fe.build_context(_parse({"side": "ASK"}))["aggression"]["read"]
    bid = fe.build_context(_parse({"side": "BID"}))["aggression"]["read"]
    assert "closing" in bid or "credit" in bid
    assert "unclear" in fe.build_context(_parse({"side": ""}))["aggression"]["read"]


# ── Context builder: earnings proximity + GEX ───────────────────────────────

def test_earnings_proximity_found_in_bmo(monkeypatch):
    import api.services.engine as engine
    monkeypatch.setattr(engine, "get_earnings", lambda: {
        "bmo": [{"sym": "NVDA"}], "amc": [], "amc_tonight": [],
    })
    ctx = fe.build_context(_parse())
    assert ctx["earnings_proximity"] == "reports today before the open"


def test_earnings_proximity_symbol_key_amc(monkeypatch):
    import api.services.engine as engine
    monkeypatch.setattr(engine, "get_earnings", lambda: {
        "bmo": [], "amc": [{"symbol": "NVDA"}], "amc_tonight": [],
    })
    ctx = fe.build_context(_parse())
    assert ctx["earnings_proximity"] == "reported yesterday after the close"


def test_earnings_proximity_exception_is_unknown(monkeypatch):
    import api.services.engine as engine

    def _boom():
        raise RuntimeError("EW down")

    monkeypatch.setattr(engine, "get_earnings", _boom)
    ctx = fe.build_context(_parse())
    assert ctx["earnings_proximity"] == "unknown"


def test_gex_omitted_when_no_cached_snapshot():
    assert "gex" not in fe.build_context(_parse())


def test_gex_included_from_cached_snapshot(monkeypatch):
    monkeypatch.setattr(fe, "get_cached_gex", lambda t: {
        "regime": "bullish",
        "levels": {"call_wall": {"strike": 200.0, "gex": 1e9, "label": "Ceiling"}},
    })
    ctx = fe.build_context(_parse())
    assert ctx["gex"]["regime"] == "bullish"
    assert ctx["gex"]["call_wall"]["strike"] == 200.0


def test_gex_exception_is_omitted(monkeypatch):
    def _boom(t):
        raise RuntimeError("cache exploded")
    monkeypatch.setattr(fe, "get_cached_gex", _boom)
    assert "gex" not in fe.build_context(_parse())


# ── Cache round-trip (temp sqlite + in-memory layer) ────────────────────────

def test_cache_round_trip(client, fake_llm):
    r1 = client.post("/api/flow-explain", json=_print_body())
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["cached"] is False
    assert d1["model"] == "claude-opus-4-8"
    assert len(fake_llm.calls) == 1

    # Second identical print same day → served from cache, no second LLM call
    r2 = client.post("/api/flow-explain", json=_print_body())
    d2 = r2.json()
    assert d2["cached"] is True
    assert d2["explanation"] == d1["explanation"]
    assert d2["signals"] == d1["signals"]
    assert len(fake_llm.calls) == 1

    # Wipe the in-memory layer → sqlite still serves it
    fe._MEM_CACHE.clear()
    r3 = client.post("/api/flow-explain", json=_print_body())
    assert r3.json()["cached"] is True
    assert len(fake_llm.calls) == 1


def test_cache_key_shape_sensitivity():
    p = _parse()
    date = fe._today_et()
    k_opening = fe._cache_key(p, fe.build_context(p), date)
    p2 = _parse({"volume": 10, "oi": 90_000})  # ambiguous shape
    k_ambiguous = fe._cache_key(p2, fe.build_context(p2), date)
    assert k_opening != k_ambiguous
    p3 = _parse({"side": "BID"})
    assert fe._cache_key(p3, fe.build_context(p3), date) != k_opening


def test_cost_is_recorded(client, fake_llm):
    client.post("/api/flow-explain", json=_print_body())
    spent = fe._spend_today(fe._today_et())
    # 500 in @ $5/M + 150 out @ $25/M
    assert spent == pytest.approx(500 / 1e6 * 5.0 + 150 / 1e6 * 25.0)


# ── Cost cap → deterministic fallback ────────────────────────────────────────

def test_cost_cap_trips_to_deterministic_fallback(client, fake_llm):
    fe._add_cost(fe._today_et(), 99.0)  # blow past the $5 default cap
    r = client.post("/api/flow-explain", json=_print_body())
    assert r.status_code == 200
    d = r.json()
    assert d["model"] == "deterministic-fallback"
    assert d["cached"] is False
    assert "NVDA" in d["explanation"]
    assert "open interest" in d["explanation"]
    assert len(d["signals"]) >= 3
    assert fake_llm.calls == []  # LLM never touched

    # Cap stays tripped all day → the fallback IS cached for identical prints
    r2 = client.post("/api/flow-explain", json=_print_body())
    assert r2.json()["cached"] is True
    assert r2.json()["model"] == "deterministic-fallback"


def test_cost_cap_env_override(client, fake_llm, monkeypatch):
    monkeypatch.setenv("FLOW_EXPLAIN_DAILY_CAP_USD", "0.0")
    r = client.post("/api/flow-explain", json=_print_body())
    assert r.json()["model"] == "deterministic-fallback"
    assert fake_llm.calls == []


# ── LLM failure / parse fallback ─────────────────────────────────────────────

def test_llm_exception_returns_deterministic_fallback_not_500(client, monkeypatch):
    fake = FakeAnthropic(behavior=RuntimeError("overloaded_error"))
    import api.services.engine as engine
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: fake)
    r = client.post("/api/flow-explain", json=_print_body())
    assert r.status_code == 200
    d = r.json()
    assert d["model"] == "deterministic-fallback"
    assert d["cached"] is False
    assert "NVDA" in d["explanation"]
    # Error fallbacks are NOT cached — the next identical print retries the LLM
    assert fe._cache_get(fe._cache_key(_parse(), fe.build_context(_parse()), fe._today_et())) is None


def test_json_parse_fallback_uses_raw_text_and_derived_signals(client, monkeypatch):
    raw = "Someone is loading up on near-term calls here, plain and simple."
    fake = FakeAnthropic(behavior=raw)
    import api.services.engine as engine
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: fake)
    r = client.post("/api/flow-explain", json=_print_body())
    d = r.json()
    assert d["explanation"] == raw
    assert d["model"] == "claude-opus-4-8"
    assert 3 <= len(d["signals"]) <= 4
    assert any("Vol/OI" in s for s in d["signals"])


def test_json_substring_extraction():
    text = "Sure! Here you go:\n" + _GOOD_JSON + "\nHope that helps."
    explanation, signals = fe._parse_llm_output(text, _parse(), fe.build_context(_parse()))
    assert explanation.startswith("A large sweep")
    assert signals == ["Vol 2.9x OI — likely opening", "Paid the ask", "Weekly expiry"]


# ── Per-user rate limit ──────────────────────────────────────────────────────

def test_per_user_daily_rate_limit(client, fake_llm, monkeypatch):
    monkeypatch.setenv("FLOW_EXPLAIN_USER_DAILY_CAP", "2")
    assert client.post("/api/flow-explain", json=_print_body()).status_code == 200
    assert client.post("/api/flow-explain", json=_print_body()).status_code == 200
    r3 = client.post("/api/flow-explain", json=_print_body())
    assert r3.status_code == 429
    assert "limit" in r3.json()["detail"].lower()


# ── Validation ───────────────────────────────────────────────────────────────

def test_invalid_cp_rejected(client, fake_llm):
    r = client.post("/api/flow-explain", json=_print_body(cp="X"))
    assert r.status_code == 422


def test_ticker_normalized_upper(fake_llm):
    p = fe.FlowPrint(**_print_body(ticker="nvda"))
    assert p.ticker == "NVDA"
