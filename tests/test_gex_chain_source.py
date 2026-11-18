"""LCQ-02 — GEX's chain source: Massive, and only Massive (Schwab was retired from the product on
2026-11-17 by the owner's instruction). The walk builds the chain in the shape the arithmetic was
written against, which still carries the old vendor's name (`to_schwab_shape`)."""
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
            "callExpDateMap": {key: {"100.0": [{"openInterest": 500, "gamma": 0.05, "delta": 0.55, "totalVolume": None}],
                                     "105.0": [{"openInterest": 300, "gamma": 0.03, "delta": 0.30, "totalVolume": None}]}},
            "putExpDateMap": {key: {"95.0": [{"openInterest": 400, "gamma": 0.04, "delta": -0.40, "totalVolume": None}],
                                    "100.0": [{"openInterest": 200, "gamma": 0.05, "delta": -0.45, "totalVolume": None}]}}}


def test_the_chain_source_is_massive_whatever_the_retired_variable_says(monkeypatch):
    """GEX_CHAIN_SOURCE is retired: production still carries `massive`, and a stale `schwab` or
    `shadow` must not send anyone looking for a chain that no longer exists."""
    for value in (None, "schwab", "shadow", "massive", "yfinance"):
        if value is None:
            monkeypatch.delenv("GEX_CHAIN_SOURCE", raising=False)
        else:
            monkeypatch.setenv("GEX_CHAIN_SOURCE", value)
        assert g.chain_source() == "massive", value


def test_the_schwab_read_the_modes_and_the_parity_route_are_gone():
    import inspect
    from api import gex_router
    for name in ("_fetch_chain_" + "schwab", "_get_gex_shadow", "get_gex_source_parity", "GEX_CHAIN_MODE_FLAGS",
                 "GEX_SOURCE_ENV", "GEX_MODES", "CHAINS_URL", "schwab"):
        assert not hasattr(g, name), name
    assert "source" not in inspect.signature(g.get_gex_data).parameters
    paths = {r.path for r in gex_router.router.routes}
    assert paths == {"/api/gex/data", "/api/gex/compare"}


def test_massive_rows_become_schwabs_shape():
    shaped = g.to_schwab_shape(_massive_rows(), 101.0, TODAY)
    assert shaped == _schwab_equivalent()


def test_the_sessions_contract_volume_rides_under_schwabs_key():
    """NOPE (api/services/options_analytics/positioning.py) reads `totalVolume`; a contract the
    snapshot sent no `day` block for stays None, never 0."""
    rows = _massive_rows()
    rows[0]["day"] = {"volume": 1234}
    shaped = g.to_schwab_shape(rows, 101.0, TODAY)
    call100 = shaped["callExpDateMap"][f"{EXP}:3"]["100.0"][0]
    put95 = shaped["putExpDateMap"][f"{EXP}:3"]["95.0"][0]
    assert call100["totalVolume"] == 1234 and put95["totalVolume"] is None


def test_the_converted_massive_rows_give_the_gex_of_the_hand_written_chain(monkeypatch):
    """The whole point of the shape: the converted Massive rows and the same contracts written by
    hand in the chain shape -> identical GEX, walls and zero gamma. (Until 2026-11-17 the
    hand-written side stood in for a Schwab response.)"""
    async def by_hand(t, f, to):
        return _schwab_equivalent(), None

    async def converted(t, f, to):
        d = g.to_schwab_shape(_massive_rows(), 101.0, TODAY)
        d.update(massive_contracts=4, massive_pages=1, massive_truncated=False)
        return d, None

    monkeypatch.setattr(g, "_fetch_chain_massive", by_hand)
    a = asyncio.run(g.get_gex_data("TEST", "week"))
    monkeypatch.setattr(g, "_fetch_chain_massive", converted)
    b = asyncio.run(g.get_gex_data("TEST", "week"))
    assert "error" not in a and "error" not in b
    assert a["chainSource"] == "massive" and b["chainSource"] == "massive"
    assert "chainMode" not in a and "chainMode" not in b
    assert a["totalGex"] != 0 and len(a["strikes"]) == 3
    for k in ("totalGex", "callGex", "putGex", "zeroGamma", "netDelta", "callWall", "putWall", "strikes"):
        assert a[k] == b[k], k


def test_a_source_error_is_named_not_empty(monkeypatch):
    async def down(t, f, to):
        return None, "Massive API error: 503"
    monkeypatch.setattr(g, "_fetch_chain_massive", down)
    out = asyncio.run(g.get_gex_data("SPY", "week"))
    assert out == {"error": "Massive API error: 503", "chain_source": "massive"}


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


# ── O5: zero gamma names how it was found ─────────────────────────────────────────────────────

def _fake_chain_with(monkeypatch, chain):
    async def fake(t, f, to):
        return chain, None
    monkeypatch.setattr(g, "_fetch_chain_massive", fake)


def test_zero_gamma_says_which_method_found_it(monkeypatch):
    _fake_chain_with(monkeypatch, _schwab_equivalent())
    out = asyncio.run(g.get_gex_data("TEST", "week"))
    assert out["zeroGammaMethod"] in ("cumulative_flip", "cumulative_flip_from_top",
                                      "first_negative_strike_below_spot",
                                      "below_1pct_of_call_wall", "put_wall_fallback")
    assert out["zeroGammaIsFlip"] == (out["zeroGammaMethod"] in ("cumulative_flip",
                                                                 "cumulative_flip_from_top"))


def test_an_all_positive_chain_does_not_pass_a_fallback_off_as_a_flip(monkeypatch):
    """Calls only: cumulative gamma never changes sign, so whatever level comes back is a
    stand-in -- and the payload must say so instead of calling it Zero Gamma silently."""
    key = f"{EXP}:3"
    chain = {"underlyingPrice": 101.0,
             "callExpDateMap": {key: {"100.0": [{"openInterest": 500, "gamma": 0.05, "delta": 0.55}],
                                      "105.0": [{"openInterest": 300, "gamma": 0.03, "delta": 0.30}]}},
             "putExpDateMap": {}}
    _fake_chain_with(monkeypatch, chain)
    out = asyncio.run(g.get_gex_data("TEST", "week"))
    assert out["zeroGammaIsFlip"] is False
    if out["zeroGamma"] is not None:
        assert out["zeroGammaMethod"] not in ("cumulative_flip", "cumulative_flip_from_top")


# ── O10: the expiry window is the ET trading date ─────────────────────────────────────────────

def test_the_expiry_window_starts_on_the_et_date_not_utc(monkeypatch):
    """At 21:00 ET it is already tomorrow in UTC; the window must still start today (ET)."""
    import datetime as _dt
    seen = {}

    class _Late(_dt.datetime):
        @classmethod
        def now(cls, tz=None):
            utc = _dt.datetime(2026, 10, 6, 1, 0, tzinfo=_dt.timezone.utc)   # 21:00 ET on 10-05
            return utc.astimezone(tz) if tz else utc.replace(tzinfo=None)

    async def fake(t, f, to):
        seen["from"] = f
        return _schwab_equivalent(), None

    monkeypatch.setattr(_dt, "datetime", _Late)
    monkeypatch.setattr(g, "_fetch_chain_massive", fake)
    asyncio.run(g.get_gex_data("TEST", "week"))
    assert seen["from"] == "2026-10-05"
