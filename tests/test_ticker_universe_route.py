"""`/api/ticker-universe`: the cap universe the chart's symbol search knows at the keystroke (2026-11-27).

The list `/api/ticker-search` scans, open to every caller like that route, never UCT's breadth rows, and versioned so a
client cache of an older list is replaced.
"""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import ticker_search


def _client():
    app = FastAPI()
    app.include_router(ticker_search.router)
    return TestClient(app)


def test_the_universe_is_the_list_ticker_search_scans_sorted_and_versioned():
    r = _client().get("/api/ticker-universe")
    assert r.status_code == 200
    body = r.json()
    assert body["symbols"] == ticker_search._UNIVERSE
    assert body["symbols"] == sorted(body["symbols"])
    assert len(body["symbols"]) > 1000
    assert isinstance(body["v"], str) and len(body["v"]) == 12
    assert "public" in r.headers.get("cache-control", "")


def test_no_breadth_measures_in_the_universe():
    syms = _client().get("/api/ticker-universe").json()["symbols"]
    assert not [s for s in syms if s.startswith("UCTA")], "UCT breadth rows must never reach the open list"


def test_the_version_names_the_list():
    a = ticker_search._universe_version()
    saved = ticker_search._UNIVERSE_VERSION
    try:
        ticker_search._UNIVERSE_VERSION = None
        ticker_search._UNIVERSE.append("ZZZZTEST")
        assert ticker_search._universe_version() != a, "a changed list kept its version: a client would keep the old one"
    finally:
        ticker_search._UNIVERSE.remove("ZZZZTEST")
        ticker_search._UNIVERSE_VERSION = saved
