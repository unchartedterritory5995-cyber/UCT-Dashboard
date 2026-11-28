"""Bare OIC (2026-11-27): the biggest open-interest changes across the whole options log,
`api/services/options_analytics/oi_market.py` + `GET /api/options-screener/oi-change` (no ticker).

Over the same SEEDED local copy of the options log's layout as tests/test_options_oi_change.py (contracts files
written with the logger's own column list, turned into screen files by the SAME `build_session`). Every number is
invented. No network. The route is mounted on a bare app (the router alone).
"""
from __future__ import annotations

import threading
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import options_screener as router_mod
from api.services.options_analytics import oi_change as oic
from api.services.options_analytics import oi_market as oim
from api.services.research import options_screener as osc
from tests.test_options_oi_change import FAR, FREE, NEAR, PAID, TUE, WED, Seed, c

FLAG = "OPTIONS_SCREENER_ENABLED"
URL = "/api/options-screener/oi-change"


@pytest.fixture
def seed(tmp_path, monkeypatch):
    s = Seed(tmp_path)
    monkeypatch.setattr(osc, "_store_override", s.store)
    oic.reset()
    oim.reset()
    yield s
    oic.reset()
    oim.reset()


def two_days(seed):
    """TUE earlier, WED newer. AAA: +600 call, -500 put, one unchanged. BBB: +2,000 call. CCC: a new contract
    only (no earlier figure). DDD: one contract that left the log."""
    seed.day(TUE, [c("AAA", "call", 100, NEAR, oi=1000, vol=700),
                   c("AAA", "put", 90, NEAR, oi=2000, vol=450),
                   c("AAA", "call", 110, FAR, oi=300, vol=5),
                   c("BBB", "call", 50, NEAR, oi=1000, vol=9),
                   c("DDD", "put", 20, NEAR, oi=77, vol=1)])
    seed.day(WED, [c("AAA", "call", 100, NEAR, oi=1600, vol=11),
                   c("AAA", "put", 90, NEAR, oi=1500, vol=22),
                   c("AAA", "call", 110, FAR, oi=300, vol=33),
                   c("BBB", "call", 50, NEAR, oi=3000, vol=44),
                   c("CCC", "call", 10, NEAR, oi=900, vol=1)])


def ready(view=None, side=None):
    """Ask until the one background build is held (the panel asks again the same way)."""
    oic.oi_change("AAA", wait_s=10)                            # the pair, held by the per-stock module
    for _ in range(200):
        out = oim.market_change(view, side)
        if out["status"] != "computing":
            return out
        time.sleep(0.02)
    raise AssertionError("the market build never finished")


class TestTheLists:
    def test_by_stock_ranks_the_net_change_by_its_size_either_sign(self, seed):
        two_days(seed)
        out = ready()
        assert out["status"] == "ok" and out["view"] == "stocks" and out["session"] == WED and out["prior_session"] == TUE
        assert [(r["symbol"], r["change"]) for r in out["rows"]] == [("BBB", 2000), ("AAA", 100)]
        aaa = out["rows"][1]
        assert aaa["call_change"] == 600 and aaa["put_change"] == -500 and aaa["contracts"] == 3
        assert aaa["prior_oi"] == 3300 and aaa["change_pct"] == round(100 / 3300 * 100, 1)
        assert out["matched"] == 2 and out["underlyings"] == 2          # CCC and DDD are in neither file pair

    def test_a_side_ranks_that_sides_own_change(self, seed):
        two_days(seed)
        puts = ready("stocks", "put")
        assert [(r["symbol"], r["change"]) for r in puts["rows"]] == [("AAA", -500)]
        calls = ready("stocks", "call")
        assert [(r["symbol"], r["change"]) for r in calls["rows"]] == [("BBB", 2000), ("AAA", 600)]

    def test_by_contract_the_single_biggest_changes_with_the_earlier_sessions_volume(self, seed):
        two_days(seed)
        out = ready("contracts")
        assert [(r["symbol"], r["type"], r["change"]) for r in out["rows"]] == [
            ("BBB", "call", 2000), ("AAA", "call", 600), ("AAA", "put", -500)]
        assert out["rows"][1]["volume"] == 700 and out["volume_session"] == TUE   # TUE's own volume, never WED's
        assert out["matched"] == 3

    def test_new_and_gone_contracts_are_counted_never_ranked(self, seed):
        two_days(seed)
        out = ready("contracts")
        assert out["new"] == {"contracts": 1, "oi": 900} and out["gone"] == {"contracts": 1, "prior_oi": 77}
        assert "CCC" not in {r["symbol"] for r in out["rows"]} and "DDD" not in {r["symbol"] for r in out["rows"]}

    def test_the_lists_are_capped_and_the_rest_counted(self, seed, monkeypatch):
        monkeypatch.setattr(oim, "MAX_ROWS", 1)
        two_days(seed)
        out = ready("contracts")
        assert len(out["rows"]) == 1 and out["shown"] == 1 and out["matched"] == 3


class TestTheRequestPath:
    def test_a_cold_ask_is_computing_at_once_and_one_build_serves_every_view_and_side(self, seed, monkeypatch):
        two_days(seed)
        oic.oi_change("AAA", wait_s=10)
        gate = threading.Event()
        real = oim.build
        monkeypatch.setattr(oim, "build", lambda pair: (gate.wait(5), real(pair))[1])
        t0 = time.time()
        for view, side in (("stocks", None), ("contracts", "put"), (None, "call")):
            assert oim.market_change(view, side)["status"] == "computing"
        assert time.time() - t0 < 1.0 and oim.builds_started == 1
        gate.set()
        out = ready("contracts", "put")
        assert out["status"] == "ok" and oim.builds_started == 1

    def test_no_pair_yet_and_one_session_say_so(self, seed):
        assert oim.market_change()["status"] in ("computing", "no_sessions")
        for _ in range(100):
            out = oim.market_change()
            if out["status"] != "computing":
                break
            time.sleep(0.02)
        assert out["status"] == "no_sessions"

    def test_a_failed_build_is_said_and_not_retried_on_every_request(self, seed, monkeypatch):
        two_days(seed)
        oic.oi_change("AAA", wait_s=10)
        monkeypatch.setattr(oim, "build", lambda pair: (_ for _ in ()).throw(RuntimeError("bad file")))
        oim.market_change()
        for _ in range(100):
            out = oim.market_change()
            if out["status"] != "computing":
                break
            time.sleep(0.02)
        assert out["status"] == "unavailable" and out["error"] == "RuntimeError"
        oim.market_change()
        assert oim.builds_started == 1

    def test_bad_view_or_side_is_refused(self, seed):
        for view, side in (("tickers", None), (None, "both")):
            with pytest.raises(oic.BadQuery):
                oim.market_change(view, side)


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router_mod.router)
    who = {"user": PAID}
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who["user"])
    c_ = TestClient(app, raise_server_exceptions=False)
    c_.who = who
    return c_


class TestTheRoute:
    def test_off_is_a_404_free_is_a_402_and_paid_reads_the_held_list(self, client, seed, monkeypatch):
        two_days(seed)
        monkeypatch.delenv(FLAG, raising=False)
        assert client.get(URL).status_code == 404
        monkeypatch.setenv(FLAG, "1")
        client.who["user"] = FREE
        assert client.get(URL).status_code == 402
        client.who["user"] = PAID
        assert client.get(URL).json()["status"] in ("computing", "ok")
        ready()
        body = client.get(URL + "?view=contracts&side=call").json()
        assert body["status"] == "ok" and body["rows"][0]["symbol"] == "BBB"
        assert client.get(URL + "?view=tickers").status_code == 422
        assert client.get(URL + "/AAA").json()["status"] in ("computing", "ok")      # the per-stock route is unchanged
