"""Admin per-user broker debug bundle — DB state + live SnapTrade probes.

Built for member-support triage ("member says connect isn't working"):
one admin call answers where in the chain the connection died — our DB
identity, SnapTrade registration, brokerage authorizations (incl. the
`disabled` flag), live accounts, and recent sync attempts.
"""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import (
    snaptrade_client as snap, connections, service as broker_service,
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
    connections.save_broker_user("u1", "u1", "secret")
    ba = connections.map_snaptrade_account("u1", {
        "id": "S1", "name": "Robinhood", "number": "1234",
        "institution_name": "Robinhood", "type": "margin",
    })
    snap.configure(_Group(
        authentication=_Group(
            list_snap_trade_users=lambda **kw: _Resp(["u1", "other-user"]),
        ),
        connections=_Group(
            list_brokerage_authorizations=lambda **kw: _Resp([{
                "id": "auth-1", "disabled": True, "disabled_date": "2026-07-14",
                "created_date": "2026-07-13",
                "brokerage": {"name": "Robinhood"},
            }]),
        ),
        account_information=_Group(
            list_user_accounts=lambda **kw: _Resp([{"id": "S1", "name": "Robinhood"}]),
        ),
    ))
    yield {"ba_id": ba["id"]}
    snap.reset()


@pytest.mark.asyncio
async def test_admin_user_debug_bundles_db_and_snaptrade_state(env):
    out = await broker_service.admin_user_debug("u1")
    assert out["userId"] == "u1"
    assert out["dbIdentity"] is True
    assert out["accounts"][0]["brokerageName"] == "Robinhood"
    assert out["snaptradeRegistered"] is True
    auths = out["authorizations"]
    assert auths[0]["id"] == "auth-1"
    assert auths[0]["disabled"] is True          # the classic silent-failure flag
    assert auths[0]["brokerage"] == "Robinhood"
    assert out["liveAccounts"] == 1
    assert isinstance(out["recentSyncs"], list)


@pytest.mark.asyncio
async def test_admin_user_debug_handles_user_with_no_connection(env):
    # A user with NO broker identity (e.g. just disconnected): DB flags False,
    # SnapTrade probes skipped/absent, and the call never raises.
    out = await broker_service.admin_user_debug("ghost-user")
    assert out["dbIdentity"] is False
    assert out["accounts"] == []
    assert out["snaptradeRegistered"] is False
    assert out["authorizations"] == []
