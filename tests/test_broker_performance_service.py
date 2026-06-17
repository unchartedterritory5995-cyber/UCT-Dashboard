"""Tests for performance_service.account_performance — assembling the equity
series (forward snapshots + estimated pre-snapshot history) + external flows
and running them through the pure engine."""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.broker import cashflow_reconstruct as cf
from api.services.journal_two.broker import performance_service as svc


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
    j2 = acct["id"]
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO j2_broker_accounts (id, user_id, snaptrade_account_id, "
        "j2_account_id, created_at, updated_at) VALUES "
        "('bk1', 'u1', 'S1', ?, '2026-01-01', '2026-01-01')",
        (j2,),
    )
    conn.commit()
    conn.close()
    return {"ba": {"id": "bk1", "j2AccountId": j2}, "j2": j2}


def _snap(date, equity):
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_broker_equity_snapshots (user_id, broker_account_id, "
            "snapshot_date, total_equity, cash, market_value, synced_at) VALUES "
            "('u1', 'bk1', ?, ?, 0, ?, '2026-01-01')",
            (date, equity, equity),
        )
        conn.commit()
    finally:
        conn.close()


def _dep(aid, amount, date):
    return {"id": aid, "type": "CONTRIBUTION", "amount": amount, "currency": "USD",
            "trade_date": date}


def test_account_performance_twr_with_deposit(env):
    _snap("2026-05-01", 10000.0)
    _snap("2026-05-02", 15000.0)
    cf.reconcile_cash_flows("u1", env["ba"], [_dep("c1", 5000, "2026-05-02")])
    out = svc.account_performance("u1", env["j2"], "ALL")
    assert out["timeWeighted"] == pytest.approx(0.0)        # deposit ≠ gain
    assert out["netDeposits"] == 5000.0
    dates = [p["date"] for p in out["equitySeries"]]
    assert dates == ["2026-05-01", "2026-05-02"]
    assert all(p["estimated"] is False for p in out["equitySeries"])
    assert out["estimated"] is False


def test_account_performance_prepends_estimated_history(env):
    # Only one real snapshot. A deposit predates it → an estimated point is
    # walked back (first_snap − external flows after that date), flagged.
    _snap("2026-05-10", 12000.0)
    cf.reconcile_cash_flows("u1", env["ba"], [_dep("c1", 2000, "2026-05-05")])
    out = svc.account_performance("u1", env["j2"], "ALL")
    est_points = [p for p in out["equitySeries"] if p["estimated"]]
    assert len(est_points) >= 1
    assert est_points[0]["date"] == "2026-05-05"
    # equity_est(05-05) = 12000 − (flows strictly after 05-05) = 12000 − 2000 = 10000
    assert est_points[0]["value"] == pytest.approx(10000.0)
    assert out["estimated"] is True
