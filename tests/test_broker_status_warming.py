from datetime import datetime, timezone, timedelta

from api.services.auth_db import get_connection, init_db
from api.services.journal_two.broker import connections, service


def _make_account(conn, user_id):
    import uuid
    from api.services.journal_two import accounts as accounts_service
    j2 = accounts_service.create_account(
        user_id, {"name": "RH", "startingBalance": 1.0, "color": "blue"}, conn=conn
    )
    ba_id = str(uuid.uuid4())
    snap_acct_id = "snap-" + uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO j2_broker_accounts
           (id, user_id, snaptrade_account_id, brokerage_name, j2_account_id,
            sync_enabled, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?)""",
        (ba_id, user_id, snap_acct_id, "Robinhood", j2["id"], now, now))
    conn.commit()
    return ba_id


def test_status_exposes_warming_flag():
    init_db()
    import uuid
    user_id = "warm-user-" + uuid.uuid4().hex[:8]
    conn = get_connection()
    try:
        ba_id = _make_account(conn, user_id)
        connections.set_warming(user_id, ba_id,
                                (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
                                conn=conn)
    finally:
        conn.close()
    st = service.status(user_id)
    acct = next(a for a in st["accounts"] if a["id"] == ba_id)
    assert acct["warming"] is True
