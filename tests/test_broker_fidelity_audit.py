"""Per-account broker fidelity audit — machine verification that our imported
journal reconciles against the broker's OWN reported numbers (the ground
truth SnapTrade already hands us). Catches broker-specific parsing/math
errors automatically, per account, without a member comparing screens:

  • equity_consistency — our derived equity (cash + stock MV + option MV)
    must match the broker-reported account total within tolerance;
  • position_parity — broker position quantities == our imported open rows;
  • unknown_activity_types — the ledger contains no activity types our
    adapter can't classify (a new broker's quirk shows up here first).
"""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import (
    snaptrade_client as snap, connections, sync, fidelity_audit,
)


class _Resp:
    def __init__(self, body):
        self.body = body


class _Group:
    def __init__(self, **m):
        for k, v in m.items():
            setattr(self, k, v)


class _NoThrottle:
    async def acquire(self, n=1):
        return None


def _sdk(*, positions, balances, total, activities=None, options=None):
    return _Group(
        account_information=_Group(
            get_account_activities=lambda **kw: _Resp(
                {"data": activities or [], "pagination": {}}),
            get_user_account_positions=lambda **kw: _Resp(positions),
            get_user_account_balance=lambda **kw: _Resp(balances),
            list_user_accounts=lambda **kw: _Resp(
                [{"id": "S1", "balance": {"total": {"amount": total, "currency": "USD"}}}]),
        ),
        options=_Group(list_option_holdings=lambda **kw: _Resp(options or [])),
    )


POSITIONS = [{"symbol": {"symbol": "NVDA"}, "units": 100, "price": 500,
              "average_purchase_price": 450, "currency": {"code": "USD"}}]
BALANCES = [{"currency": "USD", "cash": 10000, "buying_power": 20000}]


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    auth_db.init_db()
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("SNAPTRADE_CLIENT_ID", "cid")
    monkeypatch.setenv("SNAPTRADE_CONSUMER_KEY", "ck")
    snap.set_limiter(_NoThrottle())
    connections.save_broker_user("u1", "u1-uid", "secret")
    ba = connections.map_snaptrade_account("u1", {
        "id": "S1", "name": "Webull", "number": "1234",
        "institution_name": "Webull",
    })
    yield {"ba_id": ba["id"]}
    snap.reset()


@pytest.mark.asyncio
async def test_consistent_account_passes(env):
    # cash 10000 + 100×500 = 60000 == broker-reported total 60000.
    snap.configure(_sdk(positions=POSITIONS, balances=BALANCES, total=60000))
    await sync.sync_account("u1", env["ba_id"])   # imports the position rows
    out = await fidelity_audit.audit_account("u1", env["ba_id"])
    assert out["ok"] is True
    names = {c["name"]: c for c in out["checks"]}
    assert names["equity_consistency"]["ok"] is True
    assert names["position_parity"]["ok"] is True
    assert names["unknown_activity_types"]["ok"] is True


@pytest.mark.asyncio
async def test_equity_divergence_fails(env):
    # Broker says 75000; our math derives 60000 → 20% off → parsing/math bug
    # for this broker. Must FAIL loudly.
    snap.configure(_sdk(positions=POSITIONS, balances=BALANCES, total=75000))
    await sync.sync_account("u1", env["ba_id"])
    out = await fidelity_audit.audit_account("u1", env["ba_id"])
    check = next(c for c in out["checks"] if c["name"] == "equity_consistency")
    assert check["ok"] is False
    assert out["ok"] is False


@pytest.mark.asyncio
async def test_position_qty_mismatch_fails(env):
    snap.configure(_sdk(positions=POSITIONS, balances=BALANCES, total=60000))
    await sync.sync_account("u1", env["ba_id"])
    # Corrupt our imported row (simulates a reconciliation bug).
    conn = auth_db.get_connection()
    conn.execute("UPDATE j2_positions SET shares = 90 WHERE user_id='u1' AND symbol='NVDA'")
    conn.commit(); conn.close()
    out = await fidelity_audit.audit_account("u1", env["ba_id"])
    check = next(c for c in out["checks"] if c["name"] == "position_parity")
    assert check["ok"] is False
    assert "NVDA" in str(check["detail"])


@pytest.mark.asyncio
async def test_unknown_activity_type_flagged(env):
    acts = [{"id": "x1", "type": "MYSTERY_EVENT", "amount": 5,
             "trade_date": "2026-07-01", "currency": "USD"}]
    snap.configure(_sdk(positions=POSITIONS, balances=BALANCES, total=60000,
                        activities=acts))
    await sync.sync_account("u1", env["ba_id"])
    out = await fidelity_audit.audit_account("u1", env["ba_id"])
    check = next(c for c in out["checks"] if c["name"] == "unknown_activity_types")
    assert check["ok"] is False
    assert "MYSTERY_EVENT" in str(check["detail"])


@pytest.mark.asyncio
async def test_missing_broker_total_is_skipped_not_failed(env):
    snap.configure(_sdk(positions=POSITIONS, balances=BALANCES, total=None))
    await sync.sync_account("u1", env["ba_id"])
    out = await fidelity_audit.audit_account("u1", env["ba_id"])
    check = next(c for c in out["checks"] if c["name"] == "equity_consistency")
    assert check["ok"] is True and check.get("skipped") is True


@pytest.mark.asyncio
async def test_include_raw_returns_broker_payloads(env):
    # Diagnosing a divergence needs the RAW SnapTrade payloads (admin-only).
    snap.configure(_sdk(positions=POSITIONS, balances=BALANCES, total=60000))
    await sync.sync_account("u1", env["ba_id"])
    out = await fidelity_audit.audit_account("u1", env["ba_id"], include_raw=True)
    assert out["raw"]["balances"] == BALANCES
    assert out["raw"]["account"]["balance"]["total"]["amount"] == 60000
    assert out["raw"]["positions"] == POSITIONS
    # Default stays lean — no raw payloads.
    out2 = await fidelity_audit.audit_account("u1", env["ba_id"])
    assert "raw" not in out2


@pytest.mark.asyncio
async def test_option_fetch_failure_skips_equity_check(env):
    # A failed option-holdings fetch must NOT silently value options at $0 —
    # that fabricates an equity divergence (or masks one). Skip the equity
    # check with an explicit reason instead.
    sdk = _sdk(positions=POSITIONS, balances=BALANCES, total=60000)

    def boom(**kw):
        raise RuntimeError("options endpoint down")
    sdk.options.list_option_holdings = boom
    snap.configure(sdk)
    await sync.sync_account("u1", env["ba_id"])
    out = await fidelity_audit.audit_account("u1", env["ba_id"])
    check = next(c for c in out["checks"] if c["name"] == "equity_consistency")
    assert check["ok"] is True and check.get("skipped") is True
    assert "option" in check["detail"].lower()


@pytest.mark.asyncio
async def test_stale_holdings_snapshot_skips_equity_check(env):
    # Real Webull finding (2026-07-16): SnapTrade refreshes HOLDINGS nightly
    # but balances move intraday. Comparing a live total against an 11pm
    # holdings snapshot fabricates divergence — mixed-freshness audits must
    # SKIP with the snapshot age as the reason, not fail.
    sdk = _sdk(positions=[], balances=BALANCES, total=10200)
    sdk.account_information.list_user_accounts = lambda **kw: _Resp([{
        "id": "S1",
        "balance": {"total": {"amount": 10200, "currency": "USD"}},
        "sync_status": {"holdings": {
            "last_successful_sync": "2026-01-01T03:16:23.162210+00:00",
            "initial_sync_completed": True,
        }},
    }])
    snap.configure(sdk)
    await sync.sync_account("u1", env["ba_id"])
    out = await fidelity_audit.audit_account("u1", env["ba_id"])
    check = next(c for c in out["checks"] if c["name"] == "equity_consistency")
    assert check["ok"] is True and check.get("skipped") is True
    assert "2026-01-01" in check["detail"]


def test_nightly_runner_syncs_before_auditing(env, monkeypatch):
    # NOTE: deliberately a sync test — the runner owns its own event loop
    # (asyncio.run), which cannot start inside pytest-asyncio's loop.
    # Parity vs a journal synced up to 20min ago false-flags mid-window
    # trades (real LCID sell, 2026-07-16). The nightly runner must sync each
    # account FIRST so it audits settled, same-moment data.
    snap.configure(_sdk(positions=POSITIONS, balances=BALANCES, total=60000))
    conn = auth_db.get_connection()
    conn.execute("INSERT OR REPLACE INTO users (id, email, password_hash, role) "
                 "VALUES ('u1', 'u1@x.com', 'x', 'admin')")
    conn.execute("UPDATE j2_broker_accounts SET sync_enabled=1, status='active' "
                 "WHERE id=?", (env["ba_id"],))
    conn.commit(); conn.close()
    order = []

    async def fake_sync(user_id, account_id, **kw):
        order.append(("sync", account_id))
        return {}

    async def fake_audit(user_id, account_id, **kw):
        order.append(("audit", account_id))
        return {"accountId": account_id, "ok": True, "checks": []}

    monkeypatch.setattr(sync, "sync_account", fake_sync)
    monkeypatch.setattr(fidelity_audit, "audit_account", fake_audit)
    fidelity_audit.run_fidelity_audits_blocking()
    assert order == [("sync", env["ba_id"]), ("audit", env["ba_id"])]


def test_balance_history_check_flags_divergence(tmp_path, monkeypatch):
    """SnapTrade balanceHistory oracle vs our stored equity snapshots."""
    from api.services import auth_db
    from api.services.journal_two.db import ensure_schema
    from api.services.journal_two.broker import fidelity_audit
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection(); ensure_schema(conn)
    conn.execute(
        "INSERT INTO j2_broker_equity_snapshots "
        "(user_id, broker_account_id, snapshot_date, total_equity, cash, "
        " market_value, synced_at) "
        "VALUES ('u1','ba1','2026-07-15', 1000.0, 100, 900, '2026-07-15')")
    conn.commit(); conn.close()

    # Agreeing history → ok
    ok_check = fidelity_audit._balance_history_check("u1", "ba1", [
        {"date": "2026-07-15", "total": {"amount": 1001.0}}])
    assert ok_check["ok"] is True and not ok_check.get("skipped")

    # Diverging history → flagged
    bad_check = fidelity_audit._balance_history_check("u1", "ba1", [
        {"date": "2026-07-15", "total": {"amount": 1500.0}}])
    assert bad_check["ok"] is False

    # No overlap → skipped, never a false alarm
    skip_check = fidelity_audit._balance_history_check("u1", "ba1", [
        {"date": "2026-01-01", "amount": 5.0}])
    assert skip_check["ok"] is True and skip_check.get("skipped")
