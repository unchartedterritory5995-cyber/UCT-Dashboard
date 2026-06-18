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


def test_account_performance_twr_with_deposit(env, monkeypatch):
    # Fallback path: reconstruction stubbed empty → snapshot + estimated series.
    from api.services.journal_two.broker import historical_equity
    monkeypatch.setattr(historical_equity, "reconstruct_daily_equity", lambda *a, **k: [])
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


def test_account_performance_is_snapshots_only_no_estimated(env):
    # Default curve = broker's reported daily snapshots only — exact, never
    # fabricated. A pre-snapshot deposit does NOT inject an estimated point.
    _snap("2026-05-10", 12000.0)
    cf.reconcile_cash_flows("u1", env["ba"], [_dep("c1", 2000, "2026-05-05")])
    out = svc.account_performance("u1", env["j2"], "ALL")
    assert all(p["estimated"] is False for p in out["equitySeries"])
    assert out["estimated"] is False
    assert [p["date"] for p in out["equitySeries"]] == ["2026-05-10"]  # only the real snapshot


def test_comparison_uses_twr_for_broker_account(env):
    # +20% market move, no flows → TWR 20%. Naive (no trades) would be 0% —
    # so 0.20 proves comparison() sources the broker return from the engine.
    _snap("2026-05-01", 10000.0)
    _snap("2026-05-02", 12000.0)
    conn = auth_db.get_connection()
    conn.execute(
        "UPDATE j2_accounts SET balance_source = 'broker', broker_total_equity = 12000 "
        "WHERE id = ?", (env["j2"],))
    conn.commit()
    conn.close()
    comp = accounts_service.comparison("u1")
    row = next(r for r in comp["accounts"] if r["id"] == env["j2"])
    assert row["totalReturn"] == pytest.approx(0.20)


def test_portfolio_performance_sums_across_brokers(env):
    # Two broker accounts; portfolio curve = SUM of each broker's reported total
    # per day (the accurate all-brokers equity curve).
    acct2 = accounts_service.create_account(
        "u1", {"name": "B2", "color": "blue", "startingBalance": 1.0})
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO j2_broker_accounts (id, user_id, snaptrade_account_id, "
        "j2_account_id, created_at, updated_at) VALUES "
        "('bk2', 'u1', 'S2', ?, '2026-01-02', '2026-01-02')", (acct2["id"],))
    # bk1 (env): 2026-05-01 → 10000, 2026-05-02 → 12000
    for d, eq in [("2026-05-01", 10000.0), ("2026-05-02", 12000.0)]:
        conn.execute("INSERT INTO j2_broker_equity_snapshots (user_id, broker_account_id, "
                     "snapshot_date, total_equity, cash, market_value, synced_at) VALUES "
                     "('u1', 'bk1', ?, ?, 0, ?, 'x')", (d, eq, eq))
    # bk2: same days → 5000, 6000
    for d, eq in [("2026-05-01", 5000.0), ("2026-05-02", 6000.0)]:
        conn.execute("INSERT INTO j2_broker_equity_snapshots (user_id, broker_account_id, "
                     "snapshot_date, total_equity, cash, market_value, synced_at) VALUES "
                     "('u1', 'bk2', ?, ?, 0, ?, 'x')", (d, eq, eq))
    conn.commit()
    conn.close()
    out = svc.portfolio_performance("u1", "ALL")
    assert out["brokerCount"] == 2
    series = {p["date"]: p["value"] for p in out["equitySeries"]}
    assert series["2026-05-01"] == 15000.0     # 10000 + 5000
    assert series["2026-05-02"] == 18000.0     # 12000 + 6000
    assert all(p["estimated"] is False for p in out["equitySeries"])


def test_account_performance_prefers_reconstruction(env, monkeypatch):
    from api.services.journal_two.broker import historical_equity
    monkeypatch.setenv("BROKER_RECON_HISTORY", "1")   # opt-in path
    monkeypatch.setattr(
        historical_equity, "reconstruct_daily_equity",
        lambda user_id, account_id, **kw: [
            {"date": "2026-05-01", "equity": 10000.0, "estimated": False, "partial": False},
            {"date": "2026-05-02", "equity": 12000.0, "estimated": False, "partial": False},
        ])
    out = svc.account_performance("u1", env["j2"], "ALL")
    assert [p["date"] for p in out["equitySeries"]] == ["2026-05-01", "2026-05-02"]
    assert all(p["estimated"] is False for p in out["equitySeries"])
    assert out["estimated"] is False
    assert out["timeWeighted"] == pytest.approx(0.20)   # 10000 → 12000, no flows


def test_account_performance_falls_back_when_reconstruction_empty(env, monkeypatch):
    # Reconstruction yields nothing → keep the snapshot/estimated path.
    from api.services.journal_two.broker import historical_equity
    monkeypatch.setattr(historical_equity, "reconstruct_daily_equity",
                        lambda user_id, account_id, **kw: [])
    _snap("2026-05-01", 10000.0)
    _snap("2026-05-02", 12000.0)
    out = svc.account_performance("u1", env["j2"], "ALL")
    assert [p["date"] for p in out["equitySeries"]] == ["2026-05-01", "2026-05-02"]
    assert out["timeWeighted"] == pytest.approx(0.20)
