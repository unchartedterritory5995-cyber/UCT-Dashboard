"""Tests for the broker cash-flow ledger (deposits/withdrawals/dividends/
interest/fees) — capture, classification, idempotency, corrections-heal."""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    acct = accounts_service.create_account(
        "u1", {"name": "Broker", "color": "blue", "startingBalance": 1.0}
    )
    return {"ba": {"id": "ba1", "j2AccountId": acct["id"]}, "acct_id": acct["id"]}


def _act(aid, typ, amount, date="2026-05-01", cur="USD"):
    return {"id": aid, "type": typ, "amount": amount, "trade_date": date, "currency": cur}


# ── Schema ─────────────────────────────────────────────────────────────────

def test_cash_flows_table_exists(env):
    conn = auth_db.get_connection()
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(j2_broker_cash_flows)")}
    finally:
        conn.close()
    assert {"id", "user_id", "account_id", "broker_account_id", "external_id",
            "flow_date", "flow_type", "amount", "is_external", "currency",
            "source", "created_at"} <= cols
