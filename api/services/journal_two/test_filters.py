"""FilterSpec v1 — WHERE-fragment compiler + pagination + additive envelope.

Covers spec §6: the single place j2_trades filter params are parsed. Three
layers: (1) trades_where() SQL fragment against a real in-memory j2_trades,
(2) list_trades_for_user's dual-shape return (plain list when spec=None for
every internal caller; (trades, total) tuple when a spec is passed),
(3) the GET /api/j2/trades additive envelope via a minimal FastAPI app.
"""
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services.journal_two import db as j2db
from api.services.journal_two import trades as trades_service
from api.services.journal_two.filters import FilterSpec, parse_filter_query, trades_where


# ── fixtures ─────────────────────────────────────────────────────────────────

# NOTE: j2_trades has NOT NULL columns (pnl_dollar/pnl_percent/hold_days/
# result/context_at_entry) beyond the brief's sketch — supplied here so the
# INSERT actually satisfies the live schema.
def _insert(conn, tid, sym, side, setup, day):
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,"
        " entry_price, entry_date, exit_price, exit_date, original_stop,"
        " pnl_dollar, pnl_percent, hold_days, result, context_at_entry,"
        " created_at, setup, trading_day_et) VALUES"
        " (?, 'u1', 'p', ?, ?, 10, 100, ?, 110, ?, 95,"
        " 100, 10, 1, 'Win', '{}', '2026-01-01', ?, ?)",
        (tid, sym, side, day, day + "T15:00:00Z", setup, day),
    )


def _conn_with_trades():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    rows = [
        ("t1", "NVDA", "Long", "VCP", "2026-04-19"),
        ("t2", "TSLA", "Short", "PEG", "2026-04-20"),
        ("t3", "NVAX", "Long", "VCP", "2026-04-21"),
    ]
    for tid, sym, side, setup, day in rows:
        _insert(conn, tid, sym, side, setup, day)
    conn.commit()
    return conn


def _ids(conn, spec):
    frag, params = trades_where(spec)
    sql = f"SELECT id FROM j2_trades WHERE user_id = ? {frag} ORDER BY id"
    return [r["id"] for r in conn.execute(sql, ["u1", *params])]


# ── trades_where() fragment ──────────────────────────────────────────────────

def test_date_range_uses_spine():
    conn = _conn_with_trades()
    assert _ids(conn, FilterSpec(date_from="2026-04-20", date_to="2026-04-21")) == ["t2", "t3"]


def test_symbol_prefix_and_sides_and_setups():
    conn = _conn_with_trades()
    assert _ids(conn, FilterSpec(symbol="NV")) == ["t1", "t3"]
    assert _ids(conn, FilterSpec(sides=["Short"])) == ["t2"]
    assert _ids(conn, FilterSpec(setups=["VCP"])) == ["t1", "t3"]


def test_empty_spec_matches_all():
    conn = _conn_with_trades()
    assert _ids(conn, FilterSpec()) == ["t1", "t2", "t3"]


def test_date_spine_falls_back_to_exit_date():
    # No trading_day_et → COALESCE uses substr(exit_date,1,10).
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,"
        " entry_price, entry_date, exit_price, exit_date, original_stop,"
        " pnl_dollar, pnl_percent, hold_days, result, context_at_entry, created_at)"
        " VALUES ('x1','u1','p','AMD','Long',10,100,'2026-05-01',110,"
        " '2026-05-02T15:00:00Z',95,100,10,1,'Win','{}','2026-01-01')",
    )
    conn.commit()
    assert _ids(conn, FilterSpec(date_from="2026-05-02", date_to="2026-05-02")) == ["x1"]
    assert _ids(conn, FilterSpec(date_from="2026-05-03")) == []


# ── FilterSpec clamps ────────────────────────────────────────────────────────

def test_limit_clamps():
    assert FilterSpec(limit=99999).limit == 2000
    assert FilterSpec(limit=0).limit == 1


def test_offset_clamps_negative_to_zero():
    assert FilterSpec(offset=-5).offset == 0
    assert FilterSpec(offset=17).offset == 17


# ── parse_filter_query dependency ────────────────────────────────────────────

def test_parse_splits_comma_sets_and_unquotes_members():
    spec = parse_filter_query(sides="Long,Short", setups="VCP,Flag%2C tight")
    assert spec.sides == ["Long", "Short"]
    # A comma inside a setup name survives as %2C then decodes to a literal comma.
    assert spec.setups == ["VCP", "Flag, tight"]


def test_parse_defaults_are_empty_and_unbounded_page():
    spec = parse_filter_query()
    assert spec.sides == [] and spec.setups == []
    # No limit/offset on the wire = "no paging requested" = unbounded (None),
    # NOT a 500 default. A concrete default silently truncated heavy journals
    # (the FE reads data.trades with no paging).
    assert spec.limit is None and spec.offset is None


# ── list_trades_for_user dual-shape + pagination ─────────────────────────────

def test_no_spec_returns_plain_unbounded_list():
    conn = _conn_with_trades()
    out = trades_service.list_trades_for_user("u1", conn=conn)
    assert isinstance(out, list)
    # newest entry_date first (t3 04-21, t2 04-20, t1 04-19)
    assert [t["id"] for t in out] == ["t3", "t2", "t1"]


def test_spec_returns_trades_total_tuple_preserving_order():
    conn = _conn_with_trades()
    trades, total = trades_service.list_trades_for_user(
        "u1", conn=conn, spec=FilterSpec(limit=2)
    )
    assert total == 3
    assert [t["id"] for t in trades] == ["t3", "t2"]


def test_spec_offset_pages_within_full_total():
    conn = _conn_with_trades()
    trades, total = trades_service.list_trades_for_user(
        "u1", conn=conn, spec=FilterSpec(limit=1, offset=1)
    )
    assert total == 3          # total is the FULL match count, not the page size
    assert [t["id"] for t in trades] == ["t2"]


def test_spec_filter_narrows_total():
    conn = _conn_with_trades()
    trades, total = trades_service.list_trades_for_user(
        "u1", conn=conn, spec=FilterSpec(setups=["VCP"])
    )
    assert total == 2
    assert sorted(t["id"] for t in trades) == ["t1", "t3"]


def test_default_no_limit_returns_all_rows():
    """Regression: the DEFAULT (no limit param) must be UNBOUNDED. The old
    /trades route had no SQL LIMIT and the FE reads data.trades with no paging,
    so a concrete limit-default silently truncates a >cap journal. A default
    parse_filter_query() → spec.limit is None → NO LIMIT/OFFSET emitted; passing
    an explicit limit still pages within the full total."""
    conn = _conn_with_trades()
    spec = parse_filter_query()  # nothing on the wire = no paging requested
    assert spec.limit is None and spec.offset is None
    trades, total = trades_service.list_trades_for_user("u1", conn=conn, spec=spec)
    assert total == 3
    assert [t["id"] for t in trades] == ["t3", "t2", "t1"]  # ALL rows, newest first

    # Opt-in paging: an explicit limit=2 returns exactly 2, total is still the full 3.
    trades2, total2 = trades_service.list_trades_for_user(
        "u1", conn=conn, spec=parse_filter_query(limit=2)
    )
    assert total2 == 3
    assert [t["id"] for t in trades2] == ["t3", "t2"]


# ── GET /api/j2/trades additive envelope ─────────────────────────────────────

@pytest.fixture
def route_client(monkeypatch, tmp_path):
    """Minimal app mounting the real journal_two router, with get_current_user
    overridden and the service DB pointed at a seeded temp file."""
    from api.services import auth_db
    from api.middleware.auth_middleware import get_current_user
    from api.routers import journal_two

    db_path = str(tmp_path / "j2_route.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    for tid, sym, side, setup, day in [
        ("t1", "NVDA", "Long", "VCP", "2026-04-19"),
        ("t2", "TSLA", "Short", "PEG", "2026-04-20"),
        ("t3", "NVAX", "Long", "VCP", "2026-04-21"),
    ]:
        _insert(conn, tid, sym, side, setup, day)
    conn.commit()
    conn.close()

    # get_connection() reads the module-global _DB_PATH at call time.
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)

    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1"}
    return TestClient(app)


def test_route_envelope_is_additive(route_client):
    r = route_client.get("/api/j2/trades")
    assert r.status_code == 200
    body = r.json()
    # Existing consumers read only `trades`; it must still be there + full.
    assert [t["id"] for t in body["trades"]] == ["t3", "t2", "t1"]
    # New additive keys. No paging requested → limit/offset echo as null (unbounded).
    assert body["total"] == 3
    assert body["limit"] is None
    assert body["offset"] is None


def test_route_paginates_and_filters(route_client):
    r = route_client.get("/api/j2/trades?limit=1&offset=1&setups=VCP")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2          # two VCP trades match
    assert body["limit"] == 1 and body["offset"] == 1
    assert [t["id"] for t in body["trades"]] == ["t1"]  # page 2 of [t3, t1]
