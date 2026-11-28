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


def test_every_search_names_the_universe_version_so_a_browser_copy_can_refresh():
    c = _client()
    v = c.get("/api/ticker-universe").json()["v"]
    r = c.get("/api/ticker-search?q=AAPL&limit=3")
    assert r.status_code == 200
    assert r.headers.get("x-ticker-universe") == v


def test_an_in_process_call_still_works_without_a_response():
    out = ticker_search.ticker_search(q="AAPL", limit=3, type="", uct_session=None)
    assert "results" in out



def test_pop_ranks_each_symbol_by_the_search_index_dollar_volume(monkeypatch):
    """(2026-11-28, zero-network plan 1.4) `pop` is aligned with `symbols`: 1 = the busiest, 0 = no number. The browser
    ranks the typed text's completions by it (lib/tickerUniverse rankedCompletions) to warm the likeliest before Enter."""
    from api.services import ticker_search_index as tsi
    syms = ticker_search._UNIVERSE
    a, b, c = syms[0], syms[1], syms[2]
    monkeypatch.setattr(tsi, "_LIQ", {a: 5.0e6, b: 9.0e9, c: 1.0e8})
    body = _client().get("/api/ticker-universe").json()
    pop = body["pop"]
    assert len(pop) == len(body["symbols"])
    assert dict(zip(body["symbols"], pop))[b] == 1
    assert dict(zip(body["symbols"], pop))[c] == 2
    assert dict(zip(body["symbols"], pop))[a] == 3
    assert sum(1 for r in pop if r) == 3, "a symbol with no dollar volume ranks 0 (unknown), never a made-up rank"


def test_pop_is_additive_without_a_liquidity_map(monkeypatch):
    from api.services import ticker_search_index as tsi
    monkeypatch.setattr(tsi, "_LIQ", {})
    body = _client().get("/api/ticker-universe").json()
    assert body["pop"] == [0] * len(body["symbols"])
    assert body["symbols"] == ticker_search._UNIVERSE
