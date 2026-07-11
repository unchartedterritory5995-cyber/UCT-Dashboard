"""j2_trade_adherence side table + store — upsert/get/list/existing_refs, plus
the router-level resolve trade_id → trade_ref path (P5-A3).

Uses the `:memory:` + `ensure_schema(conn)` fixture pattern (mirrors
test_excursions_store.py); the store's `conn` param keeps every store test off
the real auth.db. Adherence keys on the STABLE trade_ref (`ext:<external_id>`
broker / `id:<row id>` manual), never raw external_id.
"""
import sqlite3

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two.adherence_store import (
    upsert_adherence, get_adherence, list_adherence_for_user, existing_refs,
)


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    return conn


# ── Store: upsert/get round-trip + pct math ─────────────────────────────────

def test_upsert_get_roundtrip_camelcase():
    conn = _conn()
    rec = upsert_adherence("u1", "id:t1", "VCP", ["r1", "r2"], 4, conn)
    # returned record is camelCase and complete
    assert rec["tradeRef"] == "id:t1"
    assert rec["setup"] == "VCP"
    assert rec["checkedRuleIds"] == ["r1", "r2"]
    assert rec["totalRules"] == 4
    assert rec["adherencePct"] == 0.5  # 2 of 4
    assert rec["updatedAt"]

    out = get_adherence("u1", "id:t1", conn)
    assert out is not None
    assert out["tradeRef"] == "id:t1"
    assert out["setup"] == "VCP"
    assert out["checkedRuleIds"] == ["r1", "r2"]
    assert out["totalRules"] == 4
    assert out["adherencePct"] == 0.5
    assert out["updatedAt"]


def test_adherence_pct_computed():
    conn = _conn()
    rec = upsert_adherence("u1", "id:t2", "Flag", ["a", "b", "c"], 4, conn)
    assert rec["adherencePct"] == 0.75  # 3 of 4
    assert get_adherence("u1", "id:t2", conn)["adherencePct"] == 0.75


def test_total_rules_zero_no_divide_error():
    conn = _conn()
    rec = upsert_adherence("u1", "id:zero", None, [], 0, conn)
    assert rec["adherencePct"] == 0.0
    assert rec["totalRules"] == 0
    out = get_adherence("u1", "id:zero", conn)
    assert out["adherencePct"] == 0.0
    assert out["setup"] is None
    assert out["checkedRuleIds"] == []


def test_adherence_pct_clamped_when_checked_longer_than_total():
    """A client posting MORE checkedRuleIds than totalRules must store
    adherence_pct == 1.0 (clamped), never > 100%."""
    conn = _conn()
    rec = upsert_adherence("u1", "id:over", "VCP", ["a", "b", "c", "d", "e"], 3, conn)
    assert rec["adherencePct"] == 1.0  # 5/3 clamped to 1.0
    out = get_adherence("u1", "id:over", conn)
    assert out["adherencePct"] == 1.0
    assert out["totalRules"] == 3


def test_get_missing_returns_none():
    conn = _conn()
    assert get_adherence("u1", "id:nope", conn) is None


# ── Store: INSERT OR REPLACE idempotency ────────────────────────────────────

def test_upsert_twice_replaces_single_row():
    conn = _conn()
    upsert_adherence("u1", "id:t1", "VCP", ["r1"], 4, conn)
    upsert_adherence("u1", "id:t1", "Flag", ["r1", "r2", "r3"], 3, conn)
    n = conn.execute(
        "SELECT COUNT(*) FROM j2_trade_adherence "
        "WHERE user_id='u1' AND trade_ref='id:t1'"
    ).fetchone()[0]
    assert n == 1  # replaced, not duplicated
    out = get_adherence("u1", "id:t1", conn)
    assert out["setup"] == "Flag"
    assert out["checkedRuleIds"] == ["r1", "r2", "r3"]
    assert out["totalRules"] == 3
    assert out["adherencePct"] == 1.0  # 3 of 3


# ── Store: list keyed by ref + multi-user isolation ─────────────────────────

def test_list_adherence_for_user_ref_keyed_map():
    conn = _conn()
    upsert_adherence("u1", "id:t1", "VCP", ["r1", "r2"], 4, conn)
    upsert_adherence("u1", "ext:bk:abc", "Flag", ["x"], 2, conn)
    upsert_adherence("u2", "id:other", "VCP", ["r1"], 1, conn)  # other user, excluded
    m = list_adherence_for_user("u1", conn)
    assert set(m.keys()) == {"id:t1", "ext:bk:abc"}
    assert m["id:t1"]["setup"] == "VCP"
    assert m["id:t1"]["adherencePct"] == 0.5
    assert m["ext:bk:abc"]["setup"] == "Flag"
    assert m["ext:bk:abc"]["adherencePct"] == 0.5


def test_multi_user_isolation_on_get():
    conn = _conn()
    upsert_adherence("u1", "id:t1", "VCP", ["r1"], 2, conn)
    # user B never sees user A's record even for the same ref string
    assert get_adherence("u2", "id:t1", conn) is None
    assert list_adherence_for_user("u2", conn) == {}


# ── Store: existing_refs idempotency helper ─────────────────────────────────

def test_existing_refs_returns_set():
    conn = _conn()
    upsert_adherence("u1", "id:t1", "VCP", ["r1"], 2, conn)
    upsert_adherence("u1", "ext:bk:abc", "Flag", [], 0, conn)
    upsert_adherence("u2", "id:other", "VCP", ["r1"], 1, conn)
    refs = existing_refs("u1", conn)
    assert refs == {"id:t1", "ext:bk:abc"}
    assert isinstance(refs, set)


# ── Router: resolve trade_id → trade_ref (mirrors test_trade_detail seeding) ─
# The route resolves via trades_service.get_trade_detail (which returns a
# `tradeRef`), then reads/writes the store keyed on that ref. We stub the
# service + store so the router's own resolve/validation logic is under test
# (the store is verified directly above).

def test_route_get_resolves_ref_and_returns_record(monkeypatch):
    from api.routers import journal_two as r

    monkeypatch.setattr(
        r.trades_service, "get_trade_detail",
        lambda uid, tid: {"tradeRef": "id:t1"} if tid == "t1" else None,
    )
    captured = {}
    from api.services.journal_two import adherence_store

    def fake_get(user_id, trade_ref, conn=None):
        captured["args"] = (user_id, trade_ref)
        return {"tradeRef": trade_ref, "setup": "VCP", "adherencePct": 0.5}

    monkeypatch.setattr(adherence_store, "get_adherence", fake_get)

    out = r.get_trade_adherence_route(trade_id="t1", user={"id": "u1"})
    assert out["adherencePct"] == 0.5
    assert captured["args"] == ("u1", "id:t1")  # resolved ref, not raw id


def test_route_get_404_when_trade_missing(monkeypatch):
    from fastapi import HTTPException
    from api.routers import journal_two as r

    monkeypatch.setattr(
        r.trades_service, "get_trade_detail", lambda uid, tid: None)

    with pytest.raises(HTTPException) as ei:
        r.get_trade_adherence_route(trade_id="gone", user={"id": "u1"})
    assert ei.value.status_code == 404


def test_route_put_resolves_ref_and_upserts(monkeypatch):
    from api.routers import journal_two as r

    monkeypatch.setattr(
        r.trades_service, "get_trade_detail",
        lambda uid, tid: {"tradeRef": "ext:bk:z"} if tid == "t1" else None,
    )
    from api.services.journal_two import adherence_store
    captured = {}

    def fake_upsert(user_id, trade_ref, setup, checked, total):
        captured["args"] = (user_id, trade_ref, setup, checked, total)
        return {"tradeRef": trade_ref, "setup": setup, "adherencePct": 1.0}

    monkeypatch.setattr(adherence_store, "upsert_adherence", fake_upsert)

    out = r.put_trade_adherence_route(
        trade_id="t1",
        payload={"setup": "VCP", "checkedRuleIds": ["r1", "r2"], "totalRules": 2},
        user={"id": "u1"},
    )
    assert out["adherencePct"] == 1.0
    assert captured["args"] == ("u1", "ext:bk:z", "VCP", ["r1", "r2"], 2)


def test_route_put_404_when_trade_missing(monkeypatch):
    from fastapi import HTTPException
    from api.routers import journal_two as r

    monkeypatch.setattr(
        r.trades_service, "get_trade_detail", lambda uid, tid: None)

    with pytest.raises(HTTPException) as ei:
        r.put_trade_adherence_route(
            trade_id="gone",
            payload={"setup": "VCP", "checkedRuleIds": [], "totalRules": 0},
            user={"id": "u1"},
        )
    assert ei.value.status_code == 404


def test_route_put_validates_body(monkeypatch):
    from fastapi import HTTPException
    from api.routers import journal_two as r

    monkeypatch.setattr(
        r.trades_service, "get_trade_detail",
        lambda uid, tid: {"tradeRef": "id:t1"},
    )

    # checkedRuleIds not a list of strings
    with pytest.raises(HTTPException) as ei:
        r.put_trade_adherence_route(
            trade_id="t1",
            payload={"setup": "VCP", "checkedRuleIds": [1, 2], "totalRules": 2},
            user={"id": "u1"},
        )
    assert ei.value.status_code == 400

    # totalRules negative
    with pytest.raises(HTTPException) as ei:
        r.put_trade_adherence_route(
            trade_id="t1",
            payload={"setup": "VCP", "checkedRuleIds": [], "totalRules": -1},
            user={"id": "u1"},
        )
    assert ei.value.status_code == 400

    # setup not a string
    with pytest.raises(HTTPException) as ei:
        r.put_trade_adherence_route(
            trade_id="t1",
            payload={"setup": 123, "checkedRuleIds": [], "totalRules": 0},
            user={"id": "u1"},
        )
    assert ei.value.status_code == 400


# ── Route registration (no shadowing) ───────────────────────────────────────

def test_adherence_routes_registered():
    from api.routers.journal_two import router
    paths = {(r.path, tuple(sorted(r.methods))) for r in router.routes if hasattr(r, "methods")}
    assert ("/api/j2/trades/{trade_id}/adherence", ("GET",)) in paths
    assert ("/api/j2/trades/{trade_id}/adherence", ("PUT",)) in paths
