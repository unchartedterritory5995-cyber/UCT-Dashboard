"""Tests for broker-sync orchestration (connect / refresh / disconnect / status).

Exercises the real client wrapper with an injected fake SDK + a temp-file
DB — no network, no credentials.
"""

from __future__ import annotations

import uuid

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import snaptrade_client as snap
from snaptrade_client.exceptions import ApiException


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


class FakeSDK:
    """Records calls so tests can assert register/delete happened."""
    def __init__(self):
        self.register_calls = 0
        self.delete_calls = 0
        self._accounts = [
            {"id": "S1", "name": "Schwab Ind", "number": "111122223333",
             "institution_name": "Charles Schwab", "type": "margin",
             "balance": {"total": {"amount": 1000, "currency": "USD"}}},
        ]

        def register(**kw):
            self.register_calls += 1
            return _Resp({"userId": kw["user_id"], "userSecret": f"sek-{self.register_calls}"})

        def login(**kw):
            return _Resp({"redirectURI": "https://app.snaptrade.com/portal/xyz"})

        def delete(**kw):
            self.delete_calls += 1
            return _Resp({})

        def list_accounts(**kw):
            return _Resp(self._accounts)

        self.authentication = _Group(
            register_snap_trade_user=register,
            login_snap_trade_user=login,
            delete_snap_trade_user=delete,
        )
        self.account_information = _Group(
            list_user_accounts=list_accounts,
        )


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("SNAPTRADE_CLIENT_ID", "cid")
    monkeypatch.setenv("SNAPTRADE_CONSUMER_KEY", "ckey")
    fake = FakeSDK()
    snap.configure(fake)
    snap.set_limiter(_NoThrottle())
    yield fake
    snap.reset()


@pytest.mark.asyncio
async def test_connect_registers_once_then_reuses(env):
    from api.services.journal_two.broker import service
    r1 = await service.connect("u1", custom_redirect="https://uct/return")
    assert r1["redirectUri"].startswith("https://app.snaptrade.com/")
    assert env.register_calls == 1
    # Second connect must reuse the stored identity (no re-register).
    await service.connect("u1")
    assert env.register_calls == 1


@pytest.mark.asyncio
async def test_connect_reregisters_when_secret_undecryptable(env, monkeypatch):
    from api.services.journal_two.broker import service
    await service.connect("u1")
    assert env.register_calls == 1
    # Rotate the encryption key WITHOUT registering the old one → the stored
    # secret can't be decrypted → connect must re-register.
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    await service.connect("u1")
    assert env.register_calls == 2


@pytest.mark.asyncio
async def test_connect_reregisters_when_secret_invalid_at_snaptrade(env):
    """API-key swap (test→prod) / rotation: the stored secret DECRYPTS fine but
    SnapTrade rejects it. Connect must transparently re-register under the
    current key + retry — no manual Disconnect first."""
    from api.services.journal_two.broker import service
    await service.connect("u1")
    assert env.register_calls == 1

    # Next login: stale secret rejected once, then OK after the re-register.
    calls = {"n": 0}
    orig_login = env.authentication.login_snap_trade_user

    def login(**kw):
        calls["n"] += 1
        if calls["n"] == 1:
            raise snap.SnapUserSecretInvalid("stale secret", status=401, code="1076")
        return orig_login(**kw)

    env.authentication.login_snap_trade_user = login

    r = await service.connect("u1")
    assert r["redirectUri"].startswith("https://app.snaptrade.com/")
    assert env.register_calls == 2   # re-registered under the current key
    assert env.delete_calls >= 1     # best-effort cleared the stale prior identity


@pytest.mark.asyncio
async def test_refresh_accounts_maps(env):
    from api.services.journal_two.broker import service, connections
    await service.connect("u1")
    mapped = await service.refresh_accounts("u1")
    assert len(mapped) == 1
    assert mapped[0]["brokerageName"] == "Charles Schwab"
    assert mapped[0]["accountNumberMasked"] == "••3333"
    # Persisted.
    assert len(connections.list_broker_accounts("u1")) == 1


@pytest.mark.asyncio
async def test_refresh_without_connection_raises(env):
    from api.services.journal_two.broker import service
    with pytest.raises(service.NoBrokerConnection):
        await service.refresh_accounts("nobody")


@pytest.mark.asyncio
async def test_refresh_secret_invalid_marks_broken(env):
    from api.services.journal_two.broker import service, connections
    await service.connect("u1")
    await service.refresh_accounts("u1")  # create an account first

    def boom(**kw):
        e = ApiException(status=401)
        e.body = {"code": "1076", "detail": "user secret invalid"}
        e.headers = {}
        raise e
    env.account_information.list_user_accounts = boom

    with pytest.raises(snap.SnapUserSecretInvalid):
        await service.refresh_accounts("u1")
    accts = connections.list_broker_accounts("u1")
    assert all(a["status"] == "broken" for a in accts)


@pytest.mark.asyncio
async def test_disconnect_revokes_and_purges(env):
    from api.services.journal_two.broker import service, connections
    await service.connect("u1")
    await service.refresh_accounts("u1")

    # Seed one broker-sourced trade and one manual trade.
    conn = auth_db.get_connection()
    base = ("id", "u1", "pos", "AAPL", "Long", 10, 100.0, "2026-01-01T00:00:00Z",
            110.0, "2026-01-02T00:00:00Z", 100.0, None, None, 100.0, 0.1, None, 1,
            "Win", "{}", "2026-01-02T00:00:00Z")
    cols = ("id,user_id,position_id,symbol,side,shares,entry_price,entry_date,"
            "exit_price,exit_date,original_stop,setup,notes,pnl_dollar,pnl_percent,"
            "r_multiple,hold_days,result,context_at_entry,created_at")
    def ins(tid, source):
        vals = list(base); vals[0] = tid
        conn.execute(
            f"INSERT INTO j2_trades ({cols},source) VALUES ({','.join(['?']*20)},?)",
            (*vals, source),
        )
    ins("t-broker", "broker")
    ins("t-manual", None)
    conn.commit(); conn.close()

    out = await service.disconnect("u1", purge_trades=True)
    assert env.delete_calls == 1
    assert out["purged"]["trades"] == 1   # only the broker trade
    assert connections.get_broker_user("u1") is None

    conn = auth_db.get_connection()
    remaining = [r["id"] for r in conn.execute("SELECT id FROM j2_trades WHERE user_id='u1'").fetchall()]
    conn.close()
    assert remaining == ["t-manual"]


def _j2_account_rows(user_id: str) -> list[dict]:
    conn = auth_db.get_connection()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM j2_accounts WHERE user_id = ?", (user_id,)
        ).fetchall()]
    finally:
        conn.close()


@pytest.mark.asyncio
async def test_disconnect_removes_the_broker_created_account_when_empty(env):
    """A broker-created j2_account is an artifact of the connection, not user
    data. With nothing logged against it, disconnect must take it with the
    connection — otherwise it lingers as a phantom account still stamped
    balance_source='broker' with the last synced balances frozen on it, and
    every broker surface keeps rendering a stale net-liq with no broker behind
    it (the '$5,868.63 after disconnect' bug)."""
    from api.services.journal_two.broker import service

    await service.connect("u1")
    await service.refresh_accounts("u1")

    created = _j2_account_rows("u1")
    assert len(created) == 1
    assert created[0]["balance_source"] == "broker"

    await service.disconnect("u1", purge_trades=False)

    assert _j2_account_rows("u1") == []


@pytest.mark.asyncio
async def test_disconnect_moves_coach_history_off_the_removed_account(env):
    """Compass chat is ABOUT an account, not content in it, so it must not keep
    a phantom broker account alive — but deleting that account must not orphan
    the conversation either. It follows the user to their surviving account."""
    from api.services.journal_two.broker import service

    await service.connect("u1")
    await service.refresh_accounts("u1")
    acct_id = _j2_account_rows("u1")[0]["id"]

    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO j2_chat_messages (id, user_id, account_id, role, content, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("m1", "u1", acct_id, "user", "how did I trade today?", "2026-07-25T12:00:00Z"),
    )
    conn.commit()
    conn.close()

    await service.disconnect("u1", purge_trades=False)

    rows = _j2_account_rows("u1")
    assert [r["id"] for r in rows] != [acct_id], "phantom broker account must be gone"

    conn = auth_db.get_connection()
    msg = conn.execute("SELECT account_id FROM j2_chat_messages WHERE id='m1'").fetchone()
    conn.close()
    assert msg is not None, "coach history must survive the disconnect"
    assert msg["account_id"] != acct_id, "must not point at the deleted account"
    assert msg["account_id"] in {r["id"] for r in rows}, "must point at a real account"


@pytest.mark.asyncio
async def test_disconnect_reverts_account_to_manual_when_it_still_holds_trades(env):
    """When the user keeps their imported trades (purge_trades=False), the
    account must SURVIVE to hold them — but it must stop impersonating a live
    broker account: balance_source back to 'manual' and every broker_* balance
    column cleared, so no stale equity/cash/buying-power can be rendered."""
    from api.services.journal_two.broker import service

    await service.connect("u1")
    await service.refresh_accounts("u1")
    acct_id = _j2_account_rows("u1")[0]["id"]

    conn = auth_db.get_connection()
    conn.execute(
        """UPDATE j2_accounts
              SET broker_total_equity = 5868.63, broker_cash = -15227.32,
                  broker_buying_power = 9077.15, broker_market_value = 20796.20,
                  broker_balance_synced_at = '2026-07-25T07:40:23Z'
            WHERE id = ?""",
        (acct_id,),
    )
    cols = ("id,user_id,position_id,symbol,side,shares,entry_price,entry_date,"
            "exit_price,exit_date,original_stop,setup,notes,pnl_dollar,pnl_percent,"
            "r_multiple,hold_days,result,context_at_entry,created_at,account_id,source")
    conn.execute(
        f"INSERT INTO j2_trades ({cols}) VALUES ({','.join(['?'] * 22)})",
        ("t-kept", "u1", "pos", "AAPL", "Long", 10, 100.0, "2026-01-01T00:00:00Z",
         110.0, "2026-01-02T00:00:00Z", 100.0, None, None, 100.0, 0.1, None, 1,
         "Win", "{}", "2026-01-02T00:00:00Z", acct_id, "broker"),
    )
    conn.commit()
    conn.close()

    await service.disconnect("u1", purge_trades=False)

    rows = _j2_account_rows("u1")
    assert len(rows) == 1, "an account holding trades must never be deleted"
    row = rows[0]
    assert row["balance_source"] == "manual"
    for col in ("broker_total_equity", "broker_cash", "broker_buying_power",
                "broker_market_value", "broker_balance_synced_at"):
        assert row[col] is None, f"{col} must be cleared on disconnect"


@pytest.mark.asyncio
async def test_status_shapes(env):
    from api.services.journal_two.broker import service
    assert service.status("u1")["connected"] is False
    await service.connect("u1")
    await service.refresh_accounts("u1")
    st = service.status("u1")
    assert st["connected"] is True
    assert len(st["accounts"]) == 1
    assert st["dupFlagsPending"] == 0
    assert st["snaptradeConfigured"] is True


@pytest.mark.asyncio
async def test_status_carries_renamable_account_name(env):
    """Each broker account in /status carries the linked j2 account's display
    name (the user-editable nickname) so the Settings panel can render+edit it."""
    from api.services import auth_db
    from api.services.journal_two.broker import service
    await service.connect("u1")
    await service.refresh_accounts("u1")
    st = service.status("u1")
    ba = st["accounts"][0]
    assert ba["accountName"]  # auto-generated "Brokerage ••1234"-style name

    # Rename the j2 account (what the PUT /accounts/{id} route does) → status
    # reflects the nickname.
    conn = auth_db.get_connection()
    conn.execute("UPDATE j2_accounts SET name = ? WHERE id = ?",
                 ("Day Trading", ba["j2AccountId"]))
    conn.commit(); conn.close()
    st2 = service.status("u1")
    assert st2["accounts"][0]["accountName"] == "Day Trading"
