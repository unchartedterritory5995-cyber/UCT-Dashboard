"""LCQ-02 — GEX's chain source: Schwab by default, Massive in Schwab's own shape, parity first."""
from __future__ import annotations

import asyncio
from datetime import date, timedelta

from api import gex_service as g

TODAY = date.today()
EXP = (TODAY + timedelta(days=3)).isoformat()


def _massive_rows():
    rows = []
    for strike, typ, oi, gamma, delta in [(100, "call", 500, 0.05, 0.55), (105, "call", 300, 0.03, 0.30),
                                          (95, "put", 400, 0.04, -0.40), (100, "put", 200, 0.05, -0.45)]:
        rows.append({"details": {"expiration_date": EXP, "strike_price": strike, "contract_type": typ},
                     "greeks": {"gamma": gamma, "delta": delta}, "open_interest": oi})
    return rows


def _schwab_equivalent():
    key = f"{EXP}:3"
    return {"underlyingPrice": 101.0,
            "callExpDateMap": {key: {"100.0": [{"openInterest": 500, "gamma": 0.05, "delta": 0.55}],
                                     "105.0": [{"openInterest": 300, "gamma": 0.03, "delta": 0.30}]}},
            "putExpDateMap": {key: {"95.0": [{"openInterest": 400, "gamma": 0.04, "delta": -0.40}],
                                    "100.0": [{"openInterest": 200, "gamma": 0.05, "delta": -0.45}]}}}


def test_the_default_source_is_schwab_and_unknown_values_fall_back(monkeypatch):
    monkeypatch.delenv(g.GEX_SOURCE_ENV, raising=False)
    assert g.chain_source() == "schwab"
    monkeypatch.setenv(g.GEX_SOURCE_ENV, "yfinance")
    assert g.chain_source() == "schwab"
    monkeypatch.setenv(g.GEX_SOURCE_ENV, "Massive")
    assert g.chain_source() == "massive"


def test_massive_rows_become_schwabs_shape():
    shaped = g.to_schwab_shape(_massive_rows(), 101.0, TODAY)
    assert shaped == _schwab_equivalent()


def test_the_same_contracts_give_the_same_gex_from_either_source(monkeypatch):
    """The whole point of the shape: identical contracts -> identical GEX, walls and zero gamma."""
    async def fake_schwab(t, f, to):
        return _schwab_equivalent(), None

    async def fake_massive(t, f, to):
        d = g.to_schwab_shape(_massive_rows(), 101.0, TODAY)
        d.update(massive_contracts=4, massive_pages=1, massive_truncated=False)
        return d, None

    monkeypatch.setattr(g, "_fetch_chain_schwab", fake_schwab)
    monkeypatch.setattr(g, "_fetch_chain_massive", fake_massive)
    a = asyncio.run(g.get_gex_data("TEST", "week", source="schwab"))
    b = asyncio.run(g.get_gex_data("TEST", "week", source="massive"))
    assert "error" not in a and "error" not in b
    assert a["chainSource"] == "schwab" and b["chainSource"] == "massive"
    for k in ("totalGex", "callGex", "putGex", "zeroGamma", "netDelta", "callWall", "putWall", "strikes"):
        assert a[k] == b[k], k


def test_a_source_error_is_named_not_empty(monkeypatch):
    async def down(t, f, to):
        return None, "Massive API error: 503"
    monkeypatch.setattr(g, "_fetch_chain_massive", down)
    out = asyncio.run(g.get_gex_data("SPY", "week", source="massive"))
    assert out == {"error": "Massive API error: 503", "chain_source": "massive"}


def test_parity_reports_agreement_between_sources(monkeypatch):
    async def fake_schwab(t, f, to):
        return _schwab_equivalent(), None

    async def fake_massive(t, f, to):
        return g.to_schwab_shape(_massive_rows(), 101.0, TODAY), None

    monkeypatch.setattr(g, "_fetch_chain_schwab", fake_schwab)
    monkeypatch.setattr(g, "_fetch_chain_massive", fake_massive)
    p = asyncio.run(g.get_gex_source_parity("TEST", "week"))
    assert p["sign_agreement"] == 1.0 and p["total_gex_ratio"] == 1.0
    assert p["same_call_wall"] and p["same_put_wall"] and p["strikes_common"] == 3



def test_parity_still_reports_massive_when_schwab_is_down(monkeypatch):
    """2026-09-30: Schwab unauthenticated in production and the endpoint returned only the
    error fields, so Massive's numbers -- the source under review -- were unreadable."""
    async def down(t, f, to):
        return None, "Schwab not authenticated"

    async def fake_massive(t, f, to):
        return g.to_schwab_shape(_massive_rows(), 101.0, TODAY), None

    monkeypatch.setattr(g, "_fetch_chain_schwab", down)
    monkeypatch.setattr(g, "_fetch_chain_massive", fake_massive)
    p = asyncio.run(g.get_gex_source_parity("TEST", "week"))
    assert p["schwab_error"] == "Schwab not authenticated" and "schwab" not in p
    assert p["massive"]["spot"] == 101.0 and p["massive"]["strikes"] == 3
    assert "sign_agreement" not in p          # no comparison is claimed from one side

def test_the_massive_walk_follows_the_cursor_url_unchanged(monkeypatch):
    """Measured 2026-09-29: passing `params=` with a next_url REPLACED the cursor's own query in
    httpx (15 rows/page, filters gone, truncated after 48 pages on one expiration). A cursor page
    must be requested with its own query intact plus the key."""
    import httpx
    from api.services import polygon_options as po
    monkeypatch.setattr(po, "_api_key", lambda: "KEY")
    seen = []
    page2 = "https://api.massive.com/v3/snapshot/options/SPY?cursor=abc&limit=250&strike_price.gte=85"
    row = {"details": {"expiration_date": EXP, "strike_price": 100, "contract_type": "call"},
           "greeks": {"gamma": 0.05, "delta": 0.5}, "open_interest": 10,
           "underlying_asset": {"price": 100.0}}

    class Resp:
        def __init__(self, body):
            self.status_code, self._b = 200, body

        def json(self):
            return self._b

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, params=None):
            seen.append((url, params))
            if params and params.get("limit") == 1:
                return Resp({"results": [row]})
            if url == page2 or url.startswith(page2):
                return Resp({"results": [row]})
            return Resp({"results": [row], "next_url": page2})

    monkeypatch.setattr(httpx, "AsyncClient", Client)
    data, err = asyncio.run(g._fetch_chain_massive("SPY", TODAY.isoformat(), EXP))
    assert err is None and data["massive_contracts"] == 2 and data["massive_truncated"] is False
    cursor_calls = [(u, p) for u, p in seen if "cursor=abc" in u]
    assert cursor_calls == [(page2 + "&apiKey=KEY", None)]      # own query intact, no params override
