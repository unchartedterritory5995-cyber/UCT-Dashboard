from datetime import datetime, timezone, timedelta

from api.services.auth_db import get_connection, init_db
from api.services.journal_two.broker import connections


def _iso(dt):
    return dt.isoformat()


def _make_account(conn, *, user_id="u1"):
    # Mirror map_snaptrade_account's row shape with a minimal direct insert.
    import uuid
    from api.services.journal_two import accounts as accounts_service
    j2 = accounts_service.create_account(
        user_id, {"name": f"RH {uuid.uuid4().hex[:8]}", "color": "blue", "startingBalance": 1.0}, conn=conn)
    ba_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO j2_broker_accounts
           (id, user_id, snaptrade_account_id, brokerage_name, j2_account_id,
            sync_enabled, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?)""",
        (ba_id, user_id, f"snap-acct-{ba_id[:8]}", "Robinhood", j2["id"], now, now),
    )
    conn.commit()
    return ba_id


def test_set_and_clear_warming_roundtrip():
    init_db()
    conn = get_connection()
    try:
        ba_id = _make_account(conn)
        future = _iso(datetime.now(timezone.utc) + timedelta(hours=2))
        assert connections.set_warming("u1", ba_id, future, conn=conn) is True
        acct = connections.get_broker_account("u1", ba_id, conn=conn)
        assert acct["warming"] is True
        assert acct["warmingStableTicks"] == 0

        assert connections.clear_warming("u1", ba_id, conn=conn) is True
        acct = connections.get_broker_account("u1", ba_id, conn=conn)
        assert acct["warming"] is False
        assert acct["warmingUntil"] is None
    finally:
        conn.close()


def test_list_warming_accounts_only_future_active():
    init_db()
    conn = get_connection()
    try:
        ba_id = _make_account(conn, user_id="u2")
        past = _iso(datetime.now(timezone.utc) - timedelta(minutes=1))
        future = _iso(datetime.now(timezone.utc) + timedelta(hours=1))
        now = _iso(datetime.now(timezone.utc))

        connections.set_warming("u2", ba_id, past, conn=conn)
        assert all(a["id"] != ba_id for a in connections.list_warming_accounts(now, conn=conn))

        connections.set_warming("u2", ba_id, future, conn=conn)
        assert any(a["id"] == ba_id for a in connections.list_warming_accounts(now, conn=conn))
    finally:
        conn.close()


def test_bump_warming_state_persists_counters():
    init_db()
    conn = get_connection()
    try:
        ba_id = _make_account(conn, user_id="u3")
        connections.set_warming("u3", ba_id,
                                _iso(datetime.now(timezone.utc) + timedelta(hours=1)), conn=conn)
        connections.bump_warming_state("u3", ba_id, activity_count=42, stable_ticks=1, conn=conn)
        acct = connections.get_broker_account("u3", ba_id, conn=conn)
        assert acct["warmingLastActivityCount"] == 42
        assert acct["warmingStableTicks"] == 1
    finally:
        conn.close()
