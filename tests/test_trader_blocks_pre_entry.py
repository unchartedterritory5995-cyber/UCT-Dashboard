"""R-P2-7: ticks made in Log Trade for an OPEN position carry to the closed trade's adherence card.

The write is the adherence store under `pos:<position id>` (never a note: see
tests/test_trader_blocks_no_note_door.py). The closed trade's adherence read falls back to it when
the trade has no record of its own. Integrator rulings railed here:
  * V6: the position id is read from detail["trade"]["positionId"] and nowhere else; a trade
    detail without it answers the trade's own record (or null), never a guess.
  * Tenancy: the PUT is paid-gated and user-scoped; another member's position is the SAME 404 as a
    position that does not exist, so a record's existence never leaks.
  * R-W0-1 / R-T3-1: no vendor call anywhere on the write.
"""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

PUT = "/api/j2/trader-blocks/positions/{}/pre-entry"


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _position(user="u1", pid="p1", closed_at=None):
    """A j2_positions row with every NOT NULL column db.py's j2_positions declares."""
    from api.services.auth_db import get_connection
    c = get_connection()
    c.execute("INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares, original_shares,"
              " entry_price, stop_price, context_at_entry, created_at, updated_at, closed_at)"
              " VALUES (?, ?, 'NVDA', 'Long', '2026-10-13', 10, 10, 100, 95, '{}', 'now', 'now', ?)",
              (pid, user, closed_at))
    c.commit()
    c.close()


def _trade(user="u1", tid="t1", position_id="p1"):
    """A real j2_trades row, so the trade detail the fallback reads is the real one (V6)."""
    from api.services.auth_db import get_connection
    c = get_connection()
    c.execute("INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
              " exit_price, exit_date, original_stop, setup, notes, pnl_dollar, pnl_percent, r_multiple,"
              " hold_days, result, context_at_entry, created_at)"
              " VALUES (?, ?, ?, 'NVDA', 'Long', 10, 100, '2026-10-13T14:30:00+00:00', 110,"
              " '2026-10-15T15:00:00+00:00', 95, 'VCP', NULL, 100, 0.1, 2, 2, 'Win', '{}',"
              " '2026-10-15T15:00:00+00:00')", (tid, user, position_id))
    c.commit()
    c.close()


def _app(uid="u1", plan="pro"):
    from api.routers import notebook_journal_styles as r
    app = FastAPI()
    app.include_router(r.router)
    user = {"id": uid, "role": "member", "plan": plan}
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


def _trades_app(uid="u1"):
    from api.routers import journal_two
    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": uid}
    return TestClient(app)


# ── the write ─────────────────────────────────────────────────────────────────────────────

def test_put_stores_under_the_position_ref(db_path):
    from api.services.journal_two import adherence_store, trader_blocks
    _position()
    got = _app().put(PUT.format("p1"), json={"setup": "VCP", "checkedRuleIds": ["r1"], "totalRules": 3})
    assert got.status_code == 200
    assert got.json()["tradeRef"] == trader_blocks.PRE_ENTRY_PREFIX + "p1" == "pos:p1"
    rec = adherence_store.get_adherence("u1", "pos:p1")
    assert rec["checkedRuleIds"] == ["r1"] and rec["totalRules"] == 3 and rec["setup"] == "VCP"


def test_a_second_put_replaces_the_first(db_path):
    from api.services.journal_two import adherence_store
    _position()
    client = _app()
    client.put(PUT.format("p1"), json={"setup": "VCP", "checkedRuleIds": ["r1"], "totalRules": 3})
    client.put(PUT.format("p1"), json={"setup": "VCP", "checkedRuleIds": ["r1", "r2"], "totalRules": 3})
    assert adherence_store.get_adherence("u1", "pos:p1")["checkedRuleIds"] == ["r1", "r2"]


def test_a_missing_position_is_404(db_path):
    got = _app().put(PUT.format("nope"), json={"setup": None, "checkedRuleIds": [], "totalRules": 0})
    assert (got.status_code, got.json()) == (404, {"detail": "Not found"})


@pytest.mark.parametrize("body", [
    {"checkedRuleIds": "r1", "totalRules": 1},
    {"checkedRuleIds": ["r1", 2], "totalRules": 1},
    {"checkedRuleIds": [], "totalRules": -1},
    {"checkedRuleIds": [], "totalRules": True},
    {"checkedRuleIds": [], "totalRules": 1.5},
    {"setup": 7, "checkedRuleIds": [], "totalRules": 0},
])
def test_bad_body_is_400_and_writes_nothing(db_path, body):
    from api.services.journal_two import adherence_store
    _position()
    got = _app().put(PUT.format("p1"), json=body)
    assert got.status_code == 400
    assert adherence_store.get_adherence("u1", "pos:p1") is None


def test_a_body_that_is_not_an_object_is_422(db_path):
    _position()
    got = _app().put(PUT.format("p1"), json=["r1"])
    assert got.status_code == 422


# ── the gate, the session, the plan (the router's neighbours' order) ──────────────────────

def test_gate_off_is_the_one_404_before_anything(db_path, monkeypatch):
    _position()
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "0")
    got = _app().put(PUT.format("p1"), json={"checkedRuleIds": [], "totalRules": 0})
    assert (got.status_code, got.json()) == (404, {"detail": "Not found"})


def test_signed_out_is_401(db_path):
    from api.routers import notebook_journal_styles as r
    app = FastAPI()
    app.include_router(r.router)
    got = TestClient(app).put(PUT.format("p1"), json={"checkedRuleIds": [], "totalRules": 0})
    assert got.status_code == 401


def test_a_free_plan_is_402_and_writes_nothing(db_path):
    from api.services.journal_two import adherence_store
    _position()
    got = _app(plan="free").put(PUT.format("p1"), json={"checkedRuleIds": ["r1"], "totalRules": 1})
    assert (got.status_code, got.json()["detail"]) == (402, "Journal styles require a paid plan")
    assert adherence_store.get_adherence("u1", "pos:p1") is None


# ── tenancy: 404, never 403, and the existence of a record never leaks ────────────────────

def test_another_members_position_is_the_same_404_as_none(db_path):
    from api.services.journal_two import adherence_store
    _position(user="u1", pid="p1")
    _app("u1").put(PUT.format("p1"), json={"setup": "VCP", "checkedRuleIds": ["r1"], "totalRules": 2})
    body = {"setup": "X", "checkedRuleIds": ["evil"], "totalRules": 9}
    theirs = _app("u2").put(PUT.format("p1"), json=body)
    missing = _app("u2").put(PUT.format("never-existed"), json=body)
    assert theirs.status_code == 404 and (theirs.status_code, theirs.json()) == (missing.status_code, missing.json())
    assert adherence_store.get_adherence("u1", "pos:p1")["checkedRuleIds"] == ["r1"]   # untouched
    assert adherence_store.get_adherence("u2", "pos:p1") is None                         # nothing planted


def test_another_member_cannot_read_the_record_through_a_trade(db_path):
    """u2 cannot reach u1's ticks: not through u1's trade (404, the trade is not theirs), and not
    through a trade of their OWN that names u1's position id (the read is scoped to u2)."""
    _position(user="u1", pid="p1")
    _app("u1").put(PUT.format("p1"), json={"setup": "VCP", "checkedRuleIds": ["r1"], "totalRules": 2})
    _trade(user="u1", tid="t1", position_id="p1")
    _trade(user="u2", tid="t2", position_id="p1")
    assert _trades_app("u2").get("/api/j2/trades/t1/adherence").status_code == 404
    forged = _trades_app("u2").get("/api/j2/trades/t2/adherence")
    assert (forged.status_code, forged.json()) == (200, None)
    assert _trades_app("u1").get("/api/j2/trades/t1/adherence").json()["checkedRuleIds"] == ["r1"]


# ── the closed trade's read falls back to the position's record (V6) ──────────────────────

def test_the_closed_trade_reads_the_position_record_when_it_has_none(db_path):
    from api.services.journal_two import adherence_store
    _position(pid="p1")
    _trade(tid="t1", position_id="p1")
    adherence_store.upsert_adherence("u1", "pos:p1", "VCP", ["r1"], 2)
    client = _trades_app()
    assert client.get("/api/j2/trades/t1/adherence").json()["checkedRuleIds"] == ["r1"]
    adherence_store.upsert_adherence("u1", "id:t1", "VCP", ["r1", "r2"], 2)
    assert client.get("/api/j2/trades/t1/adherence").json()["checkedRuleIds"] == ["r1", "r2"]


def test_the_fallback_reads_the_position_id_from_the_trade_object_only(db_path, monkeypatch):
    """V6: positionId lives at detail["trade"]["positionId"]. A top-level positionId (where the
    plan first put it) is NOT read, and a detail with no trade or no position id answers the
    trade's own record (here none: null), never a guess and never a 500."""
    from api.routers import journal_two
    from api.services.journal_two import adherence_store
    adherence_store.upsert_adherence("u1", "pos:p1", "VCP", ["r1"], 2)
    client = _trades_app()
    for detail in ({"tradeRef": "id:t1", "positionId": "p1"},
                   {"tradeRef": "id:t1"},
                   {"tradeRef": "id:t1", "trade": None},
                   {"tradeRef": "id:t1", "trade": {}},
                   {"tradeRef": "id:t1", "trade": {"positionId": None}},
                   {"tradeRef": "id:t1", "trade": {"positionId": ""}},
                   {"tradeRef": "id:t1", "trade": {"positionId": 7}}):
        monkeypatch.setattr(journal_two.trades_service, "get_trade_detail", lambda uid, tid, _d=detail: _d)
        got = client.get("/api/j2/trades/t1/adherence")
        assert (got.status_code, got.json()) == (200, None), detail
    # control: the same patch, with the id where V6 says it lives, does read the record
    monkeypatch.setattr(journal_two.trades_service, "get_trade_detail",
                        lambda uid, tid: {"tradeRef": "id:t1", "trade": {"positionId": "p1"}})
    assert client.get("/api/j2/trades/t1/adherence").json()["checkedRuleIds"] == ["r1"]


def test_a_manual_trades_sentinel_position_reads_nothing(db_path):
    """A manual trade carries positionId 'manual-<uuid>' (trades.py), which no j2_positions row has,
    so save_pre_entry can never have written its pos: record: the read answers null."""
    _trade(tid="t9", position_id="manual-0000")
    got = _trades_app().get("/api/j2/trades/t9/adherence")
    assert (got.status_code, got.json()) == (200, None)


# ── R-W0-1 / R-T3-1: no vendor call on the write ──────────────────────────────────────────

def test_the_write_asks_no_vendor(db_path, monkeypatch):
    """Every market door trader_blocks knows is made to explode; the write still lands."""
    from api.routers import live_prices
    from api.services import bars_sqlite, engine
    from api.services.journal_two import regime

    def boom(*_a, **_k):
        raise AssertionError("a vendor/market door was asked on the pre-entry write")
    for mod, name in ((engine, "get_breadth"), (live_prices, "get_live_prices"),
                      (bars_sqlite, "get_bars"), (regime, "get_current_regime")):
        monkeypatch.setattr(mod, name, boom)
    _position()
    got = _app().put(PUT.format("p1"), json={"setup": "VCP", "checkedRuleIds": ["r1"], "totalRules": 1})
    assert got.status_code == 200


def test_save_pre_entry_is_none_for_a_foreign_position(db_path):
    from api.services.journal_two import trader_blocks
    _position(user="u2", pid="p9")
    assert trader_blocks.save_pre_entry("u1", "p9", None, [], 0) is None
    assert trader_blocks.save_pre_entry("u2", "p9", None, ["a"], 1)["tradeRef"] == "pos:p9"
