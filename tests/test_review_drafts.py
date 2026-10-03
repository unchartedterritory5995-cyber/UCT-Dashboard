"""Wave 13 lane 13F -- the review-drafts router + orchestrator (DB-backed).

`tests/test_leak_finder.py` already pins every detector against fixtures with known
n and dollars; this file proves the WIRING: real rows in `j2_trades` flow through
`review_drafts.py` into a payload whose numbers equal their authority's own field,
member-scoped, gated by `NOTEBOOK_REVIEW_DRAFTS_ENABLED`.
"""
from __future__ import annotations

import importlib
import os
import tempfile
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

FLAG = "NOTEBOOK_REVIEW_DRAFTS_ENABLED"
U, OTHER = "user-rd-a", "user-rd-b"
ACCOUNT = "acc-rd-1"


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = auth_db.get_connection()
    for uid in (U, OTHER):
        conn.execute(
            "INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
            (uid, f"{uid}@example.com", "x", uid, "member"),
        )
    conn.execute(
        "INSERT INTO j2_accounts (id, user_id, name, color, starting_balance, account_size,"
        " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        (ACCOUNT, U, "Main", "#fff", 10000.0, 10000.0, "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"),
    )
    conn.commit()
    conn.close()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture
def conn(db_path):
    from api.services.auth_db import get_connection
    c = get_connection()
    yield c
    c.close()


@pytest.fixture
def client(db_path, monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    from api.routers import notebook_review_drafts
    fa = FastAPI()
    fa.include_router(notebook_review_drafts.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": U, "role": "member"}
    yield TestClient(fa)
    fa.dependency_overrides.clear()


def add_trade(conn, *, symbol, entry_date, exit_date, entry_price, exit_price, shares=100.0,
             stop=90.0, setup=None, r=None, result=None, pnl=None, fees=0.0, hour_et=10,
             trading_day_et=None, user=U, account=ACCOUNT, tid=None, context_at_entry="{}"):
    tid = tid or f"t-{uuid.uuid4().hex[:10]}"
    pnl = pnl if pnl is not None else round((exit_price - entry_price) * shares, 2)
    r = r if r is not None else round((exit_price - entry_price) / (entry_price - stop), 4)
    result = result or ("Win" if pnl > 0 else "Loss" if pnl < 0 else "BE")
    trading_day_et = trading_day_et or exit_date[:10]
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
        " exit_price, exit_date, original_stop, setup, notes, pnl_dollar, pnl_percent, r_multiple, hold_days,"
        " result, context_at_entry, created_at, account_id, fees, hour_et, trading_day_et)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,1,?,?,?,?,?,?,?)",
        (tid, user, f"pos-{tid}", symbol, "Long", shares, entry_price, entry_date, exit_price, exit_date,
         stop, setup, pnl, pnl / (entry_price * shares), r, result, context_at_entry, exit_date, account,
         fees, hour_et, trading_day_et),
    )
    conn.commit()
    return tid


def test_the_gate_is_a_router_dependency(db_path, monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    from api.routers import notebook_review_drafts
    fa = FastAPI()
    fa.include_router(notebook_review_drafts.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": U, "role": "member"}
    c = TestClient(fa)
    assert c.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30"}).status_code == 404
    assert c.get("/api/j2/review-drafts/weekly", params={"weekStart": "2026-09-28"}).status_code == 404
    assert c.get("/api/j2/review-drafts/monthly", params={"month": "2026-09"}).status_code == 404
    fa.dependency_overrides.clear()


def test_daily_aggregates_equal_coach_data_assemblers_own_field(conn, client):
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:30:00+00:00",
             exit_date="2026-09-30T19:00:00+00:00", entry_price=100.0, exit_price=102.0)
    add_trade(conn, symbol="AAPL", entry_date="2026-09-30T14:00:00+00:00",
             exit_date="2026-09-30T19:30:00+00:00", entry_price=200.0, exit_price=195.0)

    from api.services.journal_two import coach_data_assembler
    authority = coach_data_assembler.assemble_day(user_id=U, account_id=ACCOUNT, day_iso="2026-09-30", conn=conn)

    r = client.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30", "accountId": ACCOUNT})
    assert r.status_code == 200
    payload = r.json()
    assert payload["aggregates"] == authority["today"]["aggregates"]
    assert payload["tradeCount"] == 2


def test_weekly_tradecount_matches_the_periods_own_raw_fetch(conn, client):
    for i, day in enumerate(["2026-09-28", "2026-09-29", "2026-09-30"]):
        add_trade(conn, symbol="NVDA", entry_date=f"{day}T13:30:00+00:00",
                 exit_date=f"{day}T19:00:00+00:00", entry_price=100.0, exit_price=101.0 + i, tid=f"w{i}")
    # outside the window (the following Monday)
    add_trade(conn, symbol="NVDA", entry_date="2026-10-05T13:30:00+00:00",
             exit_date="2026-10-05T19:00:00+00:00", entry_price=100.0, exit_price=101.0, tid="out1")

    r = client.get("/api/j2/review-drafts/weekly", params={"weekStart": "2026-09-28", "accountId": ACCOUNT})
    assert r.status_code == 200
    payload = r.json()
    assert payload["tradeCount"] == 3
    assert payload["range"] == {"start": "2026-09-28", "end": "2026-10-02"}


def test_monthly_uses_the_shared_primitives_and_the_numbers_still_close(conn, client):
    add_trade(conn, symbol="NVDA", entry_date="2026-09-03T13:30:00+00:00",
             exit_date="2026-09-03T19:00:00+00:00", entry_price=100.0, exit_price=110.0, tid="m1")
    add_trade(conn, symbol="AAPL", entry_date="2026-09-20T13:30:00+00:00",
             exit_date="2026-09-20T19:00:00+00:00", entry_price=200.0, exit_price=190.0, tid="m2")
    # a different month, must not leak in
    add_trade(conn, symbol="NVDA", entry_date="2026-10-01T13:30:00+00:00",
             exit_date="2026-10-01T19:00:00+00:00", entry_price=100.0, exit_price=120.0, tid="m3")

    r = client.get("/api/j2/review-drafts/monthly", params={"month": "2026-09", "accountId": ACCOUNT})
    assert r.status_code == 200
    payload = r.json()
    assert payload["tradeCount"] == 2
    assert payload["aggregates"]["trade_count"] == 2
    expected_net = round((110.0 - 100.0) * 100 + (190.0 - 200.0) * 100, 2)
    assert payload["aggregates"]["net_pnl_dollar"] == expected_net


def test_member_scoping_another_members_trades_never_appear(conn, client):
    other_account = "acc-rd-other"
    conn.execute(
        "INSERT INTO j2_accounts (id, user_id, name, color, starting_balance, account_size,"
        " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        (other_account, OTHER, "Main", "#fff", 10000.0, 10000.0, "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"),
    )
    conn.commit()
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:30:00+00:00",
             exit_date="2026-09-30T19:00:00+00:00", entry_price=100.0, exit_price=101.0,
             user=OTHER, account=other_account, tid="other1")
    add_trade(conn, symbol="AAPL", entry_date="2026-09-30T13:30:00+00:00",
             exit_date="2026-09-30T19:00:00+00:00", entry_price=50.0, exit_price=51.0,
             user=U, account=ACCOUNT, tid="mine1")

    r = client.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30", "accountId": ACCOUNT})
    payload = r.json()
    assert payload["tradeCount"] == 1
    assert payload["bestTrade"]["symbol"] == "AAPL"


def test_best_and_worst_trade_are_the_actual_extremes_and_cite_their_exit(conn, client):
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:30:00+00:00",
             exit_date="2026-09-30T19:00:00+00:00", entry_price=100.0, exit_price=120.0,
             stop=90.0, tid="best1")  # r = 2.0
    add_trade(conn, symbol="TSLA", entry_date="2026-09-30T13:30:00+00:00",
             exit_date="2026-09-30T20:00:00+00:00", entry_price=200.0, exit_price=180.0,
             stop=190.0, tid="worst1")  # r = (180-200)/(200-190) = -2.0

    r = client.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30", "accountId": ACCOUNT})
    payload = r.json()
    assert payload["bestTrade"]["symbol"] == "NVDA"
    assert payload["bestTrade"]["id"] == "best1"
    assert payload["worstTrade"]["symbol"] == "TSLA"
    assert payload["worstTrade"]["id"] == "worst1"


def test_leaks_survive_into_the_full_payload(conn, client):
    # A loss, then a same-symbol re-entry within the window -- the revenge detector's
    # own fixture shape, proven in test_leak_finder.py; here only proving it SURVIVES
    # the full router round trip.
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:00:00+00:00",
             exit_date="2026-09-30T13:30:00+00:00", entry_price=100.0, exit_price=95.0,
             stop=94.0, tid="loss1")
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:45:00+00:00",
             exit_date="2026-09-30T14:15:00+00:00", entry_price=95.0, exit_price=93.0,
             stop=92.0, tid="reentry1")

    r = client.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30", "accountId": ACCOUNT})
    payload = r.json()
    kinds = {f["kind"] for f in payload["leaks"]}
    assert "revenge_reentry" in kinds
    revenge = next(f for f in payload["leaks"] if f["kind"] == "revenge_reentry")
    assert {t["id"] for t in revenge["trades"]} == {"reentry1"}
    # the rail: a finding's trades sum to its dollars
    assert round(sum(t["pnlDollar"] for t in revenge["trades"]), 2) == revenge["dollarImpact"]["netPnl"]


def test_the_sample_constants_ride_the_payload_for_the_client_to_word_anything_itself(conn, client):
    add_trade(conn, symbol="NVDA", entry_date="2026-09-30T13:30:00+00:00",
             exit_date="2026-09-30T19:00:00+00:00", entry_price=100.0, exit_price=101.0)
    r = client.get("/api/j2/review-drafts/daily", params={"day": "2026-09-30", "accountId": ACCOUNT})
    payload = r.json()
    assert payload["sample"]["tooFewBelow"] == 10
    assert payload["sample"]["normalFrom"] == 25
