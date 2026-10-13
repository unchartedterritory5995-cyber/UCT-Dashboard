"""UCT Agent — OPEN CHART targets on breadth cards, and the value-free timing log (owner 2026-10-13).

The breadth registry is the authority for a card's chart: `symbol_for` names the (universe, measure)
series and `resolve` (published only) says /charts can serve it. Pinned:
  · one measure answered → its published series; the overview, a "% at or below" reading, a refusal
    and an unpublished measure → no target (never the opposite measure, never an invented symbol);
  · a history search → the searched measure's series;
  · the target is a NAME, never a value; the overlay's timing log carries no value.
Synthetic world; no network, no model.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services import breadth_symbols as bs
from api.services.uct_agent import breadth_present
from tests.test_uct_agent_breadth_current import ADMIN, BASE, LIVE_LEAKS, live, world  # noqa: F401

PUBLISHED = {("us", "pct_above_50sma"): "US:A50", ("nasdaq", "pct_above_50sma"): "NASDAQ:A50",
             ("nasdaq", "pct_above_200sma"): "NASDAQ:A200"}


@pytest.fixture
def registry(monkeypatch):
    """The registry as production publishes it (BREADTH_LIBRARY_UNIVERSES=us,nyse,nasdaq), minus one
    measure to prove an unpublished series gets no target."""
    monkeypatch.setattr(bs, "symbol_for", lambda u, m: PUBLISHED.get((u, m)) or f"{u.upper()}:UNPUB")
    monkeypatch.setattr(bs, "resolve", lambda sym, published_only=True: None if sym.endswith(":UNPUB") else {"symbol": sym})


@pytest.fixture
def client(world, registry):
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[rx.require_admin_dark] = lambda: ADMIN
    return TestClient(app)


def ask(client, **kw):
    return client.post("/api/agent/breadth", json={**BASE, "mode": "value", "metrics": ["pct_above_50sma"], "side": None, **kw}).json()


def test_CHART_one_measure_gets_its_published_series(client, live):
    assert ask(client)["chart"] == {"symbol": "US:A50", "label": "US:A50"}
    assert ask(client, universe="nasdaq")["chart"] == {"symbol": "NASDAQ:A50", "label": "NASDAQ:A50"}
    assert ask(client, universe="nasdaq", metrics=["pct_above_200sma"])["chart"]["symbol"] == "NASDAQ:A200"


@pytest.mark.parametrize("kw", [
    {"side": "below"},                                         # the share at or below has no series
    {"metrics": []},                                           # the overview is four measures
    {"metrics": ["pct_above_50sma", "adv_decline"]},
    {"metrics": ["pct_above_100sma"]},                         # not published → no invented symbol
    {"universe": "uct"},                                       # refused by MI for the Agent
])
def test_CHART_none_where_no_exact_published_series(client, live, kw):
    assert "chart" not in ask(client, **kw)


def test_CHART_is_a_name_never_a_value(client, live):
    b = ask(client)
    assert not any(s in str(b["chart"]) for s in LIVE_LEAKS)


def test_CHART_history_search_opens_the_searched_measure(client, monkeypatch):
    from api.services.market_intel import breadth_events
    monkeypatch.setattr(breadth_events, "run", lambda body: {"status": "ok"})
    monkeypatch.setattr(breadth_events, "answer", lambda res: {"status": "ok", "text": "t", "table": None})
    req = {"universe": "nasdaq", "metric": "pct_above_200sma", "op": "below", "level": 10, "find": "last",
           "start": None, "end": None, "aggregation": "daily"}
    assert client.post("/api/agent/breadth/history", json=req).json()["chart"]["symbol"] == "NASDAQ:A200"
    monkeypatch.setattr(breadth_events, "answer", lambda res: {"status": "refused", "text": "no", "table": None})
    assert "chart" not in client.post("/api/agent/breadth/history", json=req).json()


def test_CHART_target_helper_never_raises():
    assert breadth_present.chart_target(None, "pct_above_50sma") is None
    assert breadth_present.chart_target("us", None) is None
    assert breadth_present.chart_target("us", "pct_above_50sma", "below") is None


def test_TIMING_the_overlay_logs_reading_ms_and_never_a_value(client, live, caplog):
    with caplog.at_level("INFO"):
        ask(client)
    line = [r.getMessage() for r in caplog.records if "present-tense kinds=" in r.getMessage()]
    assert line and "reading_ms=" in line[0] and "measures=1" in line[0]
    assert not any(s in line[0] for s in LIVE_LEAKS)
