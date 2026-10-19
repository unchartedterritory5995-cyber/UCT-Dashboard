"""A Discord breadth chart (UCTA50 & co) is drawn as a LINE, by the house renderer.

🔴 THE MEASUREMENT THIS CLOSES (2026-10-18). Every breadth /chart in
#chart-flow-requests shipped the mplfinance stand-in: candles, an empty volume box
and "Avg Vol(50) 0", beside stock charts drawn by the house renderer. The house
page (/r/chart) loads logged OUT, and `/api/bars/{sym}` is paid-gated since the
2026-09-13 audit. A stock still drew because the edge Worker sends stock symbols to
the bars tier, which is not gated yet; a breadth symbol goes to the web pod and
answered 401 (measured: `/api/bars/UCTA50` 401, `/api/bars/AAPL` 200, anonymous).
The page drew zero bars, the render was discarded, and the stand-in went out.

Two fixes, both pinned here: a token-gated `/api/r/breadth-bars/{sym}` door the
page reads instead, and a stand-in that draws a breadth chart as a line without a
volume pane when it does have to stand in.
"""
from __future__ import annotations

import datetime as _dt

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch):
    from api.routers import render_panels as rp
    monkeypatch.setenv("CHART_RENDER_TOKEN", "rail-token")
    monkeypatch.delenv("CHART_RENDER_TOKEN_PREVIOUS", raising=False)
    rp._RL_BUCKETS.pop("breadth-bars", None)
    app = FastAPI()
    app.include_router(rp.router)
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def built(monkeypatch):
    from api.services import breadth_symbols as bs
    calls = []

    def fake(sym, tf="D", bars=400):
        calls.append((sym, tf, bars))
        return {"ticker": sym, "tf": tf, "bars": [{"t": "2026-10-16", "o": 33, "h": 33, "l": 33, "c": 31.4, "v": 0}]}
    monkeypatch.setattr(bs, "build_breadth_bars", fake)
    return calls


def test_the_door_serves_a_breadth_series_to_the_render_token(client, built):
    r = client.get("/api/r/breadth-bars/UCTA50?token=rail-token&tf=D&bars=5000")
    assert r.status_code == 200
    assert r.json()["bars"][0]["c"] == 31.4
    assert built == [("UCTA50", "D", 5000)]


def test_the_door_refuses_a_missing_or_wrong_token(client, built):
    assert client.get("/api/r/breadth-bars/UCTA50").status_code == 403
    assert client.get("/api/r/breadth-bars/UCTA50?token=wrong").status_code == 403
    assert built == [], "a refused caller must not reach the series build"


def test_the_door_answers_breadth_only_never_a_stock(client, built):
    """It sits beside the paid `/api/bars` gate; it must not become a way around it."""
    r = client.get("/api/r/breadth-bars/AAPL?token=rail-token")
    assert r.status_code == 404
    assert built == []


def test_the_door_clamps_timeframe_and_depth(client, built):
    client.get("/api/r/breadth-bars/UCTA50?token=rail-token&tf=5&bars=999999")
    assert built == [("UCTA50", "D", 5000)]


def _breadth_req():
    from api.services import discord_interactions as di
    return di.ChartRequest("UCTA50", "D", daily_only=True, breadth_name="% of Stocks Above 50-Day MA")


def test_stand_in_style_draws_breadth_as_a_line_without_volume():
    from api.services import discord_interactions as di
    prefs = {**di.prefs_mod.DEFAULTS, "style": "line"}
    assert di.stand_in_style(_breadth_req(), prefs) == {"show_volume": False, "chart_type": "line"}


def test_stand_in_style_leaves_a_stock_chart_exactly_as_it_was():
    """Empty for a default stock request, so `render_fn` is called with the same kwargs
    as before this change."""
    from api.services import discord_interactions as di
    assert di.stand_in_style(di.ChartRequest("NVDA", "D"), dict(di.prefs_mod.DEFAULTS)) == {}


def _daily(n=300):
    return [{"t": (_dt.date(2025, 1, 1) + _dt.timedelta(days=i)).isoformat(),
             "o": 50 + i % 7, "h": 56 + i % 7, "l": 44 + i % 7, "c": 52 + i % 5, "v": 0} for i in range(n)]


def test_an_empty_house_render_falls_back_to_a_LINE_for_breadth():
    from api.services import discord_interactions as di
    from api.services import discord_chart_cache as cc
    cc.clear()
    got = {}

    def render_fn(ticker, tf, bars, **kw):
        got.update(kw)
        return b"MPL"
    di.run_chart_job("1", "tok", _breadth_req(), bars_fn=lambda t, tf, n: _daily(), render_fn=render_fn,
                     edit_fn=lambda *a, **k: None, house_fn=lambda *a: None,
                     prefs={**di.prefs_mod.DEFAULTS, "style": "line", "stats": False})
    assert got.get("chart_type") == "line" and got.get("show_volume") is False


def test_render_chart_png_draws_a_line_chart():
    from api.services.discord_chart_render import render_chart_png
    bars = _daily(120)
    line = render_chart_png("UCTA50", "D", bars, show_volume=False, chart_type="line")
    candle = render_chart_png("UCTA50", "D", bars, show_volume=False)
    assert line.startswith(b"\x89PNG") and candle.startswith(b"\x89PNG")
    assert line != candle, "chart_type='line' drew the same picture as candles"
