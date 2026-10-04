"""Lane R -- the Research notices under the header: D-9 member-interest line (flag only),
D-11 rename notice, D-12 metric disagreement.

Every store is a tmp file; nothing sends a network request (the research-snapshot
background rebuild is replaced by a recorder in every D-12 test).
"""
from __future__ import annotations

import inspect
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services import entity_rename_notice as ren  # noqa: E402
from api.services import metric_disagreement as md  # noqa: E402
from api.services.entity_master import api as em_api  # noqa: E402
from api.services.entity_master import schema as em_schema  # noqa: E402
from api.services.entity_master import store as em_store  # noqa: E402


# ── D-11 rename notice ──────────────────────────────────────────────────────

def _reset_em():
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False


@pytest.fixture
def em(tmp_path, monkeypatch):
    monkeypatch.setattr(em_schema, "DB_PATH", str(tmp_path / "em" / "entity_master.db"))
    _reset_em()
    yield
    _reset_em()


def _ok(r):
    assert r.accepted, r.reason
    return r.entity_id


def _new(alias, frm, key):
    return _ok(em_api.apply_event("new_entity", {"entity_type": "equity", "initial_alias": alias,
                                                 "initial_alias_valid_from": frm},
                                  dedup_key=key, source="admin_manual"))


@pytest.fixture
def history(em):
    """META renamed from FB on 2022-06-09 (one entity, two eras). Old GM held GM until
    2009-06-01 then was delisted; a DIFFERENT entity took GM on 2010-11-18."""
    meta = _new("FB", "2012-05-18", "fx:fb")
    assert em_api.apply_event("renamed", {"entity_id": meta, "old_alias": "FB", "old_alias_valid_to": "2022-06-09",
                                          "new_alias": "META", "new_alias_valid_from": "2022-06-09"},
                              dedup_key="fx:fb:rename", source="admin_manual").accepted
    old_gm = _new("GM", "1990-01-01", "fx:old-gm")
    assert em_api.apply_event("alias_retired", {"entity_id": old_gm, "alias": "GM", "valid_to": "2009-06-01"},
                              dedup_key="fx:old-gm:close", source="admin_manual").accepted
    assert em_api.apply_event("delisted", {"entity_id": old_gm, "lifecycle_since": "2009-06-01"},
                              dedup_key="fx:old-gm:delist", source="admin_manual").accepted
    new_gm = _new("GM", "2010-11-18", "fx:new-gm")
    plain = _new("NVDA", "1999-01-22", "fx:nvda")
    return {"meta": meta, "old_gm": old_gm, "new_gm": new_gm, "nvda": plain}


def test_rename_the_current_holder_says_what_it_was_formerly(history):
    r = ren.notice_for("meta")
    assert r["state"] == "ok"
    assert r["current"]["entity_id"] == history["meta"]
    assert r["current"]["formerly"] == [{"alias": "FB", "valid_from": "2012-05-18", "valid_to": "2022-06-09"}]
    assert r["previous_holders"] == []


def test_rename_an_old_ticker_says_what_it_trades_as_now(history):
    r = ren.notice_for("FB")
    assert r["state"] == "ok" and r["current"] is None
    [p] = r["previous_holders"]
    assert p["entity_id"] == history["meta"]
    assert (p["held_from"], p["held_to"]) == ("2012-05-18", "2022-06-09")
    assert p["now_trades_as"] == [{"alias": "META", "valid_from": "2022-06-09"}]


def test_rename_a_reused_ticker_names_both_and_never_joins_them(history):
    r = ren.notice_for("GM")
    assert r["current"]["entity_id"] == history["new_gm"]
    assert r["current"]["formerly"] == []
    [p] = r["previous_holders"]
    # The old GM is reported as ITSELF: delisted, trading as nothing -- never as the new GM.
    assert p["entity_id"] == history["old_gm"]
    assert p["now_trades_as"] == []
    assert (p["lifecycle_state"], p["lifecycle_since"]) == ("delisted", "2009-06-01")


def test_rename_nothing_to_say_and_not_in_store_are_different_states(history):
    plain = ren.notice_for("NVDA")
    assert plain["state"] == "ok" and plain["current"]["formerly"] == [] and plain["previous_holders"] == []
    assert ren.notice_for("ZZZZ")["state"] == "not_in_store"


def test_rename_an_unreadable_store_is_a_state_with_its_reason(em, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("disk gone")
    monkeypatch.setattr(em_store, "_conn", boom)
    r = ren.notice_for("META")
    assert r["state"] == "store_unavailable" and "disk gone" in r["reason"]


# ── D-12 metric disagreement ────────────────────────────────────────────────

@pytest.fixture
def stores(tmp_path, monkeypatch):
    """A tmp screener snapshot, a tmp fundamentals snapshot store, an empty memory
    cache entry, and a RECORDER in place of the snapshot rebuild (no yfinance)."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.setenv("FUNDAMENTALS_TABLES_DB_PATH", str(tmp_path / "f.db"))
    from api.services.cache import cache
    from api.services.research import snapshot
    from api.services.screener import snapshot_db
    scheduled = []
    monkeypatch.setattr(snapshot, "_schedule_refresh", lambda s: scheduled.append(s))
    snapshot_db.init_db()
    cache.delete_prefix("research_snapshot::")
    yield {"cache": cache, "db": snapshot_db, "scheduled": scheduled}
    cache.delete_prefix("research_snapshot::")


def _row(tk, **kw):
    base = {"ticker": tk, "snapshot_date": "2026-10-01", "bars_asof": "2026-10-01", "built_at": 1}
    base.update(kw)
    return base


def test_md_each_pair_is_judged_against_its_own_declared_tolerance(stores):
    stores["db"].upsert_rows([_row("AAA", market_cap=1.0e12, pe_ttm=30.0, ps=10.0, pb=5.0, beta=1.2,
                                   current_ratio=1.5)])
    stores["cache"].set("research_snapshot::AAA", {"metrics": {
        "market_cap": "$1.02T", "pe_trailing": 36.0, "ps": 10.4, "pb": None, "beta": 1.3, "current_ratio": 1.5}},
        ttl=60)
    r = md.disagreements_for("aaa")
    by = {p["key"]: p for p in r["pairs"]}
    assert by["market_cap"]["research"] == pytest.approx(1.02e12)
    assert by["market_cap"]["verdict"] == "agree"            # 2.0% <= 5%
    assert by["pe_trailing"]["verdict"] == "disagree"        # 16.7% > 10%
    assert by["pe_trailing"]["gap_pct"] == 16.7 and by["pe_trailing"]["tolerance_pct"] == 10.0
    assert by["ps"]["verdict"] == "agree"
    assert by["beta"]["verdict"] == "agree"                  # 7.7% <= 15%
    assert by["pb"]["verdict"] == "cannot_compare" and by["pb"]["missing"] == ["research"]
    assert r["counts"] == {"agree": 4, "disagree": 1, "cannot_compare": 1}
    assert r["sides"]["screener"]["bars_asof"] == "2026-10-01"
    assert stores["scheduled"] == []


def test_md_a_research_miss_never_calls_the_vendor_and_says_not_built(stores):
    stores["db"].upsert_rows([_row("BBB", pe_ttm=20.0)])
    r = md.disagreements_for("BBB")
    assert r["sides"]["research"]["state"] == "not_built"
    assert stores["scheduled"] == ["BBB"]                     # the existing background rebuild, queued
    assert all(p["verdict"] == "cannot_compare" for p in r["pairs"])
    assert r["counts"]["agree"] == 0                          # could-not-compare is never "agree"


def test_md_a_ticker_outside_the_snapshot_is_its_own_state(stores):
    stores["cache"].set("research_snapshot::CCC", {"metrics": {"pe_trailing": 12.0}}, ttl=60)
    r = md.disagreements_for("CCC")
    assert r["sides"]["screener"]["state"] == "not_in_snapshot"
    assert all("screener" in p["missing"] for p in r["pairs"])


def test_md_units_that_differ_are_not_paired():
    keys = {p[0] for p in md.PAIRS}
    assert "debt_to_equity" not in keys and "avg_volume" not in keys


def test_md_parse_number_never_turns_garbage_into_zero():
    assert md.parse_number("$1.23T") == pytest.approx(1.23e12)
    assert md.parse_number("$850M") == pytest.approx(8.5e8)
    assert md.parse_number("n/a") is None and md.parse_number(None) is None and md.parse_number(True) is None
    assert md.parse_number(float("nan")) is None


# ── routes and flags ────────────────────────────────────────────────────────

class TestRoutes:
    @pytest.fixture
    def client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.routers import research_notices as route
        app = FastAPI()
        app.include_router(route.router)
        app.dependency_overrides[route.require_paid] = lambda: {"id": "u1"}
        return route, TestClient(app)

    @pytest.mark.parametrize("env,path", [
        ("ENTITY_RENAME_NOTICE_ENABLED", "/api/research/rename-notice/META"),
        ("METRIC_DISAGREEMENT_ENABLED", "/api/research/metric-disagreement/AAA"),
    ])
    def test_dark_by_default_is_a_404(self, client, monkeypatch, env, path):
        _, c = client
        monkeypatch.delenv(env, raising=False)
        assert c.get(path).status_code == 404

    def test_armed_rename_route_serves_and_refuses_a_non_ticker(self, client, history, monkeypatch):
        _, c = client
        monkeypatch.setenv("ENTITY_RENAME_NOTICE_ENABLED", "1")
        r = c.get("/api/research/rename-notice/fb")
        assert r.status_code == 200 and r.json()["previous_holders"][0]["now_trades_as"][0]["alias"] == "META"
        assert c.get("/api/research/rename-notice/bad$sym").status_code == 400

    def test_armed_disagreement_route_serves(self, client, stores, monkeypatch):
        _, c = client
        monkeypatch.setenv("METRIC_DISAGREEMENT_ENABLED", "1")
        r = c.get("/api/research/metric-disagreement/BBB")
        assert r.status_code == 200 and r.json()["sides"]["research"]["state"] == "not_built"

    def test_handlers_are_sync(self, client):
        route, _ = client
        assert not inspect.iscoroutinefunction(route.rename_notice_route)
        assert not inspect.iscoroutinefunction(route.metric_disagreement_route)

    @pytest.mark.parametrize("env,key", [
        ("MEMBER_INTEREST_LINE_ENABLED", "member_interest_line_enabled"),
        ("ENTITY_RENAME_NOTICE_ENABLED", "entity_rename_notice_enabled"),
        ("METRIC_DISAGREEMENT_ENABLED", "metric_disagreement_enabled"),
    ])
    def test_the_payload_key_rides_only_when_on(self, monkeypatch, env, key):
        from api.routers import auth
        monkeypatch.delenv(env, raising=False)
        assert key not in auth._research_notice_flags()
        monkeypatch.setenv(env, "1")
        assert auth._research_notice_flags()[key] is True
        # ...and it never opens the Depth tab.
        assert key not in auth._research_depth_flags()

    def test_the_js_mirror_lists_every_notice_key(self):
        from api.routers import auth
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        js = open(os.path.join(here, "app", "src", "pages", "research", "notices", "researchNoticeFlags.js"),
                  encoding="utf-8").read()
        for key, _mod in auth._RESEARCH_NOTICE_SURFACES:
            assert f"'{key}'" in js, key
