"""MD-1 kinds `quote` / `quotes` (agent-md, Sprint 1 PR 1).

No network: massive's client and session helpers are stubbed. Pins the contract (valid envelopes, honest
as_of, live vs historical, provider_calls) and the one safety rule that matters most here: an Agent price
read never runs the alert check that /api/live-prices runs on a cache miss.
"""
from __future__ import annotations

import ast
import pathlib
import time
from types import SimpleNamespace

import pytest

from api.services import massive
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import quotes as q

_ROOT = pathlib.Path(__file__).resolve().parents[1]
NOW = time.time()


def _tick(sym, price=100.0, observed=NOW - 5, **extra):
    t = {"ticker": sym, "todaysChange": 1.5, "todaysChangePerc": 1.52,
         "day": {"o": 99.0, "h": 101.0, "l": 98.5, "c": price, "v": 123456},
         "prevDay": {"c": 98.5}, "lastTrade": {"p": price}, "_observed_at": observed}
    t.update(extra)
    return t


class _Client:
    def __init__(self, value=None, degraded=None, raises=None):
        self.value, self.degraded, self.raises, self.calls = value, degraded, raises, []

    def get_batch_quotes(self, tickers, *, entity_ids=None):  # noqa: ARG002
        self.calls.append(list(tickers))
        if self.raises:
            raise self.raises
        return SimpleNamespace(value=None if self.degraded else self.value, degraded=self.degraded)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    gw._reset_for_test(None)
    yield
    gw._reset_for_test(None)


def _market(monkeypatch, *, session="regular", trading_day=True, client=None):
    monkeypatch.setattr(massive, "_detect_session", lambda: session)
    monkeypatch.setattr(massive, "_today_et_is_a_trading_day", lambda: trading_day)
    monkeypatch.setattr(massive, "_get_client", lambda: client)
    return client


def _read(kind, params, turn="t1"):
    return gw.read(kind, params, user_id=1, turn_id=turn)


def test_both_kinds_register_with_declared_live_freshness():
    names = {d["kind"]: d for d in gw.describe()}
    assert names["quote"]["freshness"] == "live" and names["quote"]["owner"] == "agent-md"
    assert names["quote"]["max_symbols"] == 1
    assert names["quotes"]["freshness"] == "live" and names["quotes"]["max_symbols"] == gw.MAX_SYMBOLS_PER_READ


def test_quote_in_session_is_live_with_the_vendors_own_time(monkeypatch):
    c = _market(monkeypatch, client=_Client({"AAPL": _tick("AAPL", 187.25)}))
    out = _read("quote", {"symbol": "aapl"})
    assert env.validate_envelope(out) == []
    assert out["status"] == "ok" and out["freshness"] == "live" and out["source"] == "massive"
    assert out["stale"] is False and out["provider_calls"] == 1 and c.calls == [["AAPL"]]
    qd = out["data"]["quote"]
    assert qd["symbol"] == "AAPL" and qd["last"] == 187.25 and qd["prev_close"] == 98.5
    assert out["as_of"] == qd["as_of"] == env.utc_iso(__import__("datetime").datetime.fromtimestamp(
        NOW - 5, __import__("datetime").timezone.utc))
    assert "_observed_at" not in qd and "lastTrade" not in qd   # no raw provider payload


def test_an_old_quote_in_session_is_marked_stale(monkeypatch):
    _market(monkeypatch, client=_Client({"XYZ": _tick("XYZ", observed=NOW - 3600)}))
    out = _read("quote", {"symbol": "XYZ"})
    assert out["freshness"] == "live" and out["stale"] is True


@pytest.mark.parametrize("session,trading_day", [("post_market", True), ("pre_market", True),
                                                 ("regular", False), ("post_market", False)])
def test_outside_the_regular_session_it_is_historical_with_a_note(monkeypatch, session, trading_day):
    _market(monkeypatch, session=session, trading_day=trading_day, client=_Client({"SPY": _tick("SPY")}))
    out = _read("quote", {"symbol": "SPY"})
    assert env.validate_envelope(out) == []
    assert out["freshness"] == "historical" and q.NOTE_CLOSED in out["notes"]
    assert out["stale"] is False


def test_quotes_set_as_of_is_the_oldest_and_partial_names_the_missing(monkeypatch):
    c = _market(monkeypatch, client=_Client({"AAPL": _tick("AAPL", observed=NOW - 2),
                                             "MSFT": _tick("MSFT", observed=NOW - 40)}))
    out = _read("quotes", {"symbols": ["AAPL", "msft", "NOPE", "AAPL", "bad sym!"]})
    assert env.validate_envelope(out) == []
    assert c.calls == [["AAPL", "MSFT", "NOPE"]]                 # de-duplicated, invalid never sent
    assert out["status"] == "partial" and out["provider_calls"] == 1
    assert [r["symbol"] for r in out["data"]["quotes"]] == ["AAPL", "MSFT"]
    assert out["as_of"] == out["data"]["quotes"][1]["as_of"]     # MSFT, the older one
    notes = " | ".join(out["notes"])
    assert "no quote for: NOPE" in notes and "not a ticker symbol" in notes and q.NOTE_SET_AS_OF in notes
    assert out["coverage"] == {"evaluated": 4, "answered": 2, "dropped": 2, "not_computable": 0}


def test_missing_observation_time_gives_null_as_of_with_a_note_and_stale(monkeypatch):
    _market(monkeypatch, client=_Client({"AAPL": _tick("AAPL", observed=None)}))
    out = _read("quote", {"symbol": "AAPL"})
    assert env.validate_envelope(out) == []
    assert out["as_of"] is None and out["stale"] is True
    assert any("no observation time" in n for n in out["notes"])


@pytest.mark.parametrize("client,calls", [(None, 0),
                                          (_Client(raises=RuntimeError("boom apiKey=SECRET")), 1),
                                          (_Client(degraded="cached_forbidden"), 0),
                                          (_Client({}), 1)])
def test_provider_failures_are_honest_unavailable(monkeypatch, client, calls):
    if client is None:
        monkeypatch.setattr(massive, "_get_client", lambda: (_ for _ in ()).throw(RuntimeError("no key")))
        monkeypatch.setattr(massive, "_detect_session", lambda: "regular")
        monkeypatch.setattr(massive, "_today_et_is_a_trading_day", lambda: True)
    else:
        _market(monkeypatch, client=client)
    out = _read("quote", {"symbol": "AAPL"})
    assert env.validate_envelope(out) == []
    assert out["status"] == "unavailable" and out["data"] is None and out["provider_calls"] == calls
    assert "SECRET" not in " ".join(out["notes"])


def test_bad_params_are_unavailable_without_a_provider_call(monkeypatch):
    c = _market(monkeypatch, client=_Client({}))
    for kind, params in [("quote", {"symbol": ""}), ("quotes", {"symbols": "AAPL"}), ("quotes", {"symbols": []})]:
        out = _read(kind, params)
        assert env.validate_envelope(out) == [] and out["status"] == "unavailable" and out["provider_calls"] == 0
    assert c.calls == []


def test_quote_refuses_more_than_one_symbol_and_quotes_more_than_fifty(monkeypatch):
    _market(monkeypatch, client=_Client({}))
    assert _read("quote", {"symbol": "A", "symbols": ["A", "B"]})["status"] == "refused"
    assert _read("quotes", {"symbols": [f"S{i}" for i in range(51)]})["status"] == "refused"


def test_dark_when_the_flag_is_off(monkeypatch):
    monkeypatch.delenv(gw.DATA_ENV)
    c = _market(monkeypatch, client=_Client({"AAPL": _tick("AAPL")}))
    assert _read("quote", {"symbol": "AAPL"})["status"] == "refused" and c.calls == []


# ── Price reads must never trigger alerts (MD-1 §4, §6.2) ─────────────────────────────────────────────

def test_a_price_read_never_runs_the_alert_check(monkeypatch):
    from api.services import watchlist_alert_service as was
    fired = []
    monkeypatch.setattr(was, "run_alert_check", lambda *a, **k: fired.append(a))
    _market(monkeypatch, client=_Client({"AAPL": _tick("AAPL"), "MSFT": _tick("MSFT")}))
    for i in range(3):
        assert _read("quotes", {"symbols": ["AAPL", "MSFT"]}, turn=f"t{i}")["status"] == "ok"
        assert _read("quote", {"symbol": "AAPL"}, turn=f"t{i}")["status"] == "ok"
    assert fired == []


def test_the_control_proves_the_alert_spy_can_fire(monkeypatch):
    """Non-vacuity: the same spy DOES see the call when something actually makes it."""
    from api.services import watchlist_alert_service as was
    fired = []
    monkeypatch.setattr(was, "run_alert_check", lambda *a, **k: fired.append(a))
    was.run_alert_check({"AAPL": {}})
    assert fired == [({"AAPL": {}},)]


def test_the_adapter_imports_neither_the_live_prices_route_nor_the_alert_service():
    src = (_ROOT / "api/services/uct_agent/marketdata/quotes.py").read_text(encoding="utf-8")
    mods = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.ImportFrom) and node.module:
            mods.add(node.module)
            mods.update(f"{node.module}.{a.name}" for a in node.names)
        elif isinstance(node, ast.Import):
            mods.update(a.name for a in node.names)
    assert "api.services.massive" in mods                     # control: the walk sees real imports
    assert not any("live_prices" in m or "watchlist_alert" in m or "alert" in m.split(".")[-1] for m in mods)
