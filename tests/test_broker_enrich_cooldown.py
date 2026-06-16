"""Batch D backend: per-account sync cooldown + imported-trade enrichment."""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service, trades as trades_service
from api.services.journal_two.broker import snaptrade_client as snap, connections, sync


class _Resp:
    def __init__(self, body): self.body = body
class _Group:
    def __init__(self, **m):
        for k, v in m.items(): setattr(self, k, v)
class _NoThrottle:
    async def acquire(self, n=1): return None


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection(); ensure_schema(conn); conn.close()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("SNAPTRADE_CLIENT_ID", "cid"); monkeypatch.setenv("SNAPTRADE_CONSUMER_KEY", "ck")
    snap.set_limiter(_NoThrottle())
    calls = {"n": 0}
    def activities(**kw):
        calls["n"] += 1
        return _Resp({"data": [], "pagination": {}})
    snap.configure(_Group(account_information=_Group(
        get_account_activities=activities,
        get_user_account_positions=lambda **kw: _Resp([]),
        get_user_account_balance=lambda **kw: _Resp([]),
    )))
    connections.save_broker_user("u1", "uid", "secret")
    ba = connections.map_snaptrade_account("u1", {"id": "S1", "number": "1", "institution_name": "Schwab"})
    yield {"ba_id": ba["id"], "j2": ba["j2AccountId"], "calls": calls}
    snap.reset()


# ── cooldown ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cooldown_skips_recent_sync(env):
    await sync.sync_account("u1", env["ba_id"])           # 1st: hits broker
    n_after_first = env["calls"]["n"]
    out = await sync.sync_account("u1", env["ba_id"], cooldown_seconds=300)
    assert out.get("skipped") == "cooldown"
    assert env["calls"]["n"] == n_after_first             # no extra broker call


@pytest.mark.asyncio
async def test_cooldown_zero_always_syncs(env):
    await sync.sync_account("u1", env["ba_id"])
    n = env["calls"]["n"]
    await sync.sync_account("u1", env["ba_id"], cooldown_seconds=0)
    assert env["calls"]["n"] > n


@pytest.mark.asyncio
async def test_full_bypasses_cooldown(env):
    await sync.sync_account("u1", env["ba_id"])
    n = env["calls"]["n"]
    await sync.sync_account("u1", env["ba_id"], full=True, cooldown_seconds=300)
    assert env["calls"]["n"] > n


# ── enrichment ───────────────────────────────────────────────────────────────

def _seed_broker_trade(env):
    conn = auth_db.get_connection()
    cols = ("id,user_id,position_id,symbol,side,shares,entry_price,entry_date,"
            "exit_price,exit_date,original_stop,pnl_dollar,pnl_percent,hold_days,"
            "result,context_at_entry,created_at,account_id,source")
    conn.execute(
        f"INSERT INTO j2_trades ({cols}) VALUES ({','.join(['?']*19)})",
        ("t1", "u1", "p", "AAPL", "Long", 10, 100.0, "2026-04-01T00:00:00Z",
         110.0, "2026-04-03T00:00:00Z", 100.0, 100.0, 0.1, 2, "Win", "{}",
         "2026-04-03T00:00:00Z", env["j2"], "broker"),
    )
    conn.commit(); conn.close()


def test_enrich_adds_stop_and_computes_r(env):
    _seed_broker_trade(env)
    settings = accounts_service.get_account_settings("u1", env["j2"])
    # No stop initially (== entry) → R null. Add a stop at 95 → R computes.
    out = trades_service.update_trade("u1", "t1", {"originalStop": 95.0, "setup": "VCP"}, settings)
    assert out["originalStop"] == 95.0 and out["setup"] == "VCP"
    # R = (exit-entry)/(entry-stop) = (110-100)/(100-95) = 2.0
    assert out["rMultiple"] == pytest.approx(2.0, abs=1e-6)


def test_enrich_rejects_bad_stop(env):
    _seed_broker_trade(env)
    settings = accounts_service.get_account_settings("u1", env["j2"])
    with pytest.raises(trades_service.ManualTradeValidationError):
        trades_service.update_trade("u1", "t1", {"originalStop": 120.0}, settings)  # >= entry for Long


def test_enrich_missing_trade_returns_none(env):
    settings = accounts_service.get_account_settings("u1", env["j2"])
    assert trades_service.update_trade("u1", "nope", {"setup": "x"}, settings) is None
