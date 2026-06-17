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


# ── Classification ───────────────────────────────────────────────────────────

def test_classifies_external_and_internal_flows():
    from api.services.journal_two.broker import cashflow_reconstruct as cf
    dep = cf.to_cash_flow(_act("c1", "CONTRIBUTION", 5000), "ba1")
    assert dep["flowType"] == "deposit" and dep["isExternal"] == 1 and dep["amount"] == 5000.0
    wd = cf.to_cash_flow(_act("c2", "WITHDRAWAL", 2000), "ba1")
    assert wd["flowType"] == "withdrawal" and wd["isExternal"] == 1 and wd["amount"] == -2000.0
    div = cf.to_cash_flow(_act("c3", "DIVIDEND", 12.5), "ba1")
    assert div["flowType"] == "dividend" and div["isExternal"] == 0 and div["amount"] == 12.5
    fee = cf.to_cash_flow(_act("c4", "FEE", 1.0), "ba1")
    assert fee["flowType"] == "fee" and fee["isExternal"] == 0 and fee["amount"] == -1.0


def test_margin_interest_negative_amount_preserved():
    # A broker that reports margin interest as a negative INTEREST amount must
    # NOT be re-negated — it stays a cost.
    from api.services.journal_two.broker import cashflow_reconstruct as cf
    mi = cf.to_cash_flow(_act("c6", "INTEREST", -8.0), "ba1")
    assert mi["flowType"] == "interest" and mi["amount"] == -8.0 and mi["isExternal"] == 0


def test_skips_non_usd():
    from api.services.journal_two.broker import cashflow_reconstruct as cf
    assert cf.to_cash_flow(_act("c5", "CONTRIBUTION", 100, cur="CAD"), "ba1") is None


def test_skips_unknown_type():
    from api.services.journal_two.broker import cashflow_reconstruct as cf
    assert cf.to_cash_flow(_act("c7", "BUY", 100), "ba1") is None


# ── Persistence / idempotency / heal / store ─────────────────────────────────

def test_reconcile_imports_then_idempotent_and_heals(env):
    from api.services.journal_two.broker import cashflow_reconstruct as cf
    acts = [
        _act("c1", "CONTRIBUTION", 5000, "2026-05-01"),
        _act("c2", "DIVIDEND", 10, "2026-05-02"),
        _act("c3", "WITHDRAWAL", 1000, "2026-05-03"),
    ]
    r1 = cf.reconcile_cash_flows("u1", env["ba"], acts)
    assert r1["imported"] == 3
    r2 = cf.reconcile_cash_flows("u1", env["ba"], acts)        # re-sync
    assert r2["imported"] == 0 and r2["pruned"] == 0
    r3 = cf.reconcile_cash_flows("u1", env["ba"], [acts[0], acts[2]])  # c2 voided
    assert r3["pruned"] == 1


def test_store_sums_and_series(env):
    from api.services.journal_two.broker import cashflow_reconstruct as cf
    from api.services.journal_two.broker import cashflow_store as store
    cf.reconcile_cash_flows("u1", env["ba"], [
        _act("c1", "CONTRIBUTION", 5000, "2026-05-01"),
        _act("c2", "DIVIDEND", 10, "2026-05-02"),
        _act("c3", "WITHDRAWAL", 1000, "2026-05-03"),
    ])
    assert store.sum_flows("u1", env["acct_id"], external_only=True) == 4000.0   # 5000 - 1000
    assert store.sum_flows("u1", env["acct_id"], external_only=False) == 4010.0  # + dividend
    series = store.external_flow_series("u1", env["acct_id"])
    assert series == [("2026-05-01", 5000.0), ("2026-05-03", -1000.0)]
    flows = store.list_flows("u1", env["acct_id"])
    assert len(flows) == 3 and flows[0]["type"] == "deposit"
