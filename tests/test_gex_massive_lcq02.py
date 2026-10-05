"""LCQ-02 (2026-10-02) — GEX from Massive's snapshot chain: the one formula against a hand-computed
fixture, missing greeks/OI named per strike (never zero), the server-side cache + single-flight,
and GEX_CHAIN_SOURCE=shadow (serve Schwab, log the per-strike diff).

No network: the Massive walk runs against tests/fixtures/massive_gex/tst_snapshot_options.json
through a stand-in httpx.AsyncClient (read that file's `_provenance` -- it is schema-shaped, not a
live recording)."""
from __future__ import annotations

import asyncio
import json
import logging
import pathlib

import httpx
import pytest

from api import gex_service as g
from api.services import gex_massive
from api.services import polygon_options as po

FIXTURE = json.loads((pathlib.Path(__file__).parent / "fixtures" / "massive_gex"
                      / "tst_snapshot_options.json").read_text(encoding="utf-8"))
PAGE1, PAGE2 = FIXTURE["pages"]

# ── Hand-computed from the fixture, by the one formula gamma * OI * 100 * spot**2 * 0.01 ──────
# spot 101.0 -> 100 * 101**2 * 0.01 = 10,201 per (gamma x OI).
G_100C = 0.05 * 500 * 10_201        # 255,025
G_100P = -(0.05 * 200 * 10_201)     # -102,010
G_105C = 0.03 * 300 * 10_201        # 91,809
G_95P = -(0.04 * 400 * 10_201)      # -163,216
assert (G_100C, G_100P, G_105C, G_95P) == (255_025, -102_010, 91_809, -163_216)


class _Resp:
    def __init__(self, body, status=200):
        self.status_code, self._b = status, body

    def json(self):
        return self._b


def _install_fixture_client(monkeypatch, calls: list, status: int = 200, delay: float = 0.0):
    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, params=None):
            calls.append(url)
            if delay:
                await asyncio.sleep(delay)
            if status != 200:
                return _Resp({}, status)
            if params and params.get("limit") == 1:
                return _Resp({"results": PAGE1["results"][:1]})
            return _Resp(PAGE2 if "cursor=FIXTURECURSOR" in url else PAGE1)

    monkeypatch.setattr(httpx, "AsyncClient", Client)
    monkeypatch.setattr(po, "_api_key", lambda: "KEY")


@pytest.fixture(autouse=True)
def _fresh_cache():
    gex_massive.clear_cache()
    yield
    gex_massive.clear_cache()


def _by_strike(res):
    return {s["strike"]: s for s in res["strikes"]}


def test_the_formula_on_the_massive_chain_matches_the_hand_computation(monkeypatch):
    _install_fixture_client(monkeypatch, [])
    res = asyncio.run(g.get_gex_data("TST", "week", source="massive"))
    assert "error" not in res, res
    assert res["chainSource"] == "massive" and res["spot"] == 101.0
    s = _by_strike(res)
    assert s[100.0]["callGex"] == pytest.approx(G_100C)
    assert s[100.0]["putGex"] == pytest.approx(G_100P)
    assert s[100.0]["gex"] == pytest.approx(G_100C + G_100P)          # 153,015
    assert s[105.0]["gex"] == pytest.approx(G_105C)
    assert s[95.0]["gex"] == pytest.approx(G_95P)
    assert res["totalGex"] == pytest.approx(G_100C + G_100P + G_105C + G_95P)   # 81,608
    assert res["callGex"] == pytest.approx(G_100C + G_105C)
    assert res["putGex"] == pytest.approx(G_100P + G_95P)
    # netDelta = sum(delta * OI * 100) over computable contracts
    assert res["netDelta"] == round(0.55 * 500 * 100 - 0.45 * 200 * 100 + 0.30 * 300 * 100
                                    - 0.40 * 400 * 100)                 # 11,500
    assert res["callWall"] == {"strike": 100.0, "gex": pytest.approx(G_100C)}
    assert res["putWall"] == {"strike": 95.0, "gex": pytest.approx(G_95P)}
    # zero gamma: cumulative crosses between 100 (-10,201) and 105 (+81,608)
    cum100 = G_95P + G_100C + G_100P
    assert res["zeroGamma"] == pytest.approx(100 + 5 * (-cum100) / G_105C)


def test_a_contract_without_greeks_or_oi_is_named_per_strike_never_zero(monkeypatch):
    _install_fixture_client(monkeypatch, [])
    res = asyncio.run(g.get_gex_data("TST", "week", source="massive"))
    s = _by_strike(res)
    # 110: its only contract came back with no greeks -> NOT a zero bar; named instead.
    assert 110.0 not in s
    assert res["strikesUncomputable"] == [
        {"strike": 110.0, "callMissing": 1, "putMissing": 0, "gexStatus": "uncomputable"}]
    # 95: the put is real, the call came back with no open interest -> partial, and says so.
    assert s[95.0]["gexStatus"] == "partial" and s[95.0]["missingContracts"] == 1
    assert s[100.0]["gexStatus"] == "ok" and s[100.0]["missingContracts"] == 0
    # 90: open interest 0 is a TRUE zero -- not flagged as missing, and not drawn.
    assert 90.0 not in s and all(u["strike"] != 90.0 for u in res["strikesUncomputable"])
    assert res["contractsMissingGreeksOrOi"] == 2


def test_a_chain_with_no_computable_contract_is_an_error_not_an_empty_zero(monkeypatch):
    async def all_missing(t, f, to):
        rows = [r for r in PAGE2["results"] if r["details"]["strike_price"] == 110]
        return g.to_schwab_shape(rows, 101.0, __import__("datetime").date.today()), None
    monkeypatch.setattr(g, "_fetch_chain_massive", all_missing)
    res = asyncio.run(g.get_gex_data("TST", "week", source="massive"))
    assert "not computable" in res["error"] and "strikes" not in res


def test_the_massive_chain_is_cached_and_an_error_is_not(monkeypatch):
    calls = []
    _install_fixture_client(monkeypatch, calls)
    asyncio.run(g.get_gex_data("TST", "week", source="massive"))
    walked = len(calls)
    assert walked == 3                                 # spot probe + 2 pages
    asyncio.run(g.get_gex_data("TST", "week", source="massive"))
    asyncio.run(g.get_gex_data("TST", "week", adjusted=False, source="massive"))
    assert len(calls) == walked                        # served from the server-side cache

    gex_massive.clear_cache()
    bad = []
    _install_fixture_client(monkeypatch, bad, status=503)
    r1 = asyncio.run(g.get_gex_data("TST", "week", source="massive"))
    r2 = asyncio.run(g.get_gex_data("TST", "week", source="massive"))
    assert r1["error"] == r2["error"] == "Massive API error: 503"
    assert len(bad) == 2                               # the failure was retried, not cached


def test_concurrent_requests_share_one_walk(monkeypatch):
    calls = []
    _install_fixture_client(monkeypatch, calls, delay=0.01)

    async def both():
        return await asyncio.gather(*(g.get_gex_data("TST", "week", source="massive") for _ in range(4)))

    results = asyncio.run(both())
    assert len(calls) == 3                             # ONE walk for four callers
    assert len({r["totalGex"] for r in results}) == 1


def test_an_unset_key_is_named_not_sent(monkeypatch):
    monkeypatch.setattr(po, "_api_key", lambda: "")
    data, err = asyncio.run(g._walk_chain_massive("TST", "2026-10-02", "2026-10-09"))
    assert data is None and err == "MASSIVE_API_KEY not set"


def test_shadow_is_a_declared_mode(monkeypatch):
    assert g.GEX_CHAIN_MODE_FLAGS["GEX_CHAIN_SOURCE"] == ("schwab", ("schwab", "massive", "shadow"))
    monkeypatch.setenv(g.GEX_SOURCE_ENV, "shadow")
    assert g.chain_source() == "shadow"


def _schwab_chain():
    key = "2026-10-09:7"
    return {"underlyingPrice": 101.0,
            "callExpDateMap": {key: {"100.0": [{"openInterest": 500, "gamma": 0.05, "delta": 0.55}],
                                     "105.0": [{"openInterest": 300, "gamma": 0.03, "delta": 0.30}],
                                     "110.0": [{"openInterest": 1000, "gamma": 0.004, "delta": 0.05}]}},
            "putExpDateMap": {key: {"95.0": [{"openInterest": 400, "gamma": 0.04, "delta": -0.40}],
                                    "100.0": [{"openInterest": 200, "gamma": 0.05, "delta": -0.45}]}}}


def test_shadow_serves_schwab_and_logs_the_per_strike_diff(monkeypatch, caplog):
    monkeypatch.setenv(g.GEX_SOURCE_ENV, "shadow")
    _install_fixture_client(monkeypatch, [])

    async def fake_schwab(t, f, to):
        return _schwab_chain(), None
    monkeypatch.setattr(g, "_fetch_chain_schwab", fake_schwab)

    async def run():
        served = await g.get_gex_data("TST", "week")
        await asyncio.gather(*list(gex_massive._SHADOW_TASKS))   # let the off-path compare finish
        return served

    with caplog.at_level(logging.INFO, logger="gex"):
        served = asyncio.run(run())
    plain = asyncio.run(g.get_gex_data("TST", "week", source="schwab"))
    assert served["chainSource"] == "schwab" and served["chainMode"] == "shadow"
    assert {k: v for k, v in served.items() if k != "chainMode"} == plain     # Schwab, exactly

    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("[gex-shadow] ")]
    assert len(lines) == 1
    rec = json.loads(lines[0][len("[gex-shadow] "):])
    assert rec["ticker"] == "TST" and rec["schwab_error"] is None and rec["massive_error"] is None
    rows = {r[0]: r for r in rec["strikes"]}
    assert rows[100.0][1] == pytest.approx(G_100C + G_100P) and rows[100.0][2] == pytest.approx(G_100C + G_100P)
    assert rows[100.0][3] == "both"
    # Schwab priced 110; Massive returned it without greeks -> the diff says WHY, not 0.
    assert rows[110.0][2] is None and rows[110.0][3] == "massive_uncomputable"
    assert rec["strikes_common"] == 3 and rec["sign_agreement"] == 1.0


def test_shadow_never_waits_on_massive(monkeypatch):
    monkeypatch.setenv(g.GEX_SOURCE_ENV, "shadow")
    _install_fixture_client(monkeypatch, [], delay=5.0)   # a pathologically slow Massive

    async def fake_schwab(t, f, to):
        return _schwab_chain(), None
    monkeypatch.setattr(g, "_fetch_chain_schwab", fake_schwab)

    async def run():
        served = await asyncio.wait_for(g.get_gex_data("TST", "week"), timeout=1.0)
        for t in list(gex_massive._SHADOW_TASKS):
            t.cancel()
        return served

    served = asyncio.run(run())
    assert served["chainSource"] == "schwab" and "error" not in served
