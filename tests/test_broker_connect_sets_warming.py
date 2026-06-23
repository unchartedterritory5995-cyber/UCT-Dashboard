from datetime import datetime, timezone

from api.services.auth_db import get_connection, init_db
from api.services.journal_two.broker import connections
import api.routers.broker_sync as broker_sync_router


def _make_account(conn, user_id):
    import uuid
    from api.services.journal_two import accounts as accounts_service
    j2 = accounts_service.create_account(
        user_id, {"name": "RH", "color": "blue", "startingBalance": 1.0}, conn=conn)
    ba_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO j2_broker_accounts
           (id, user_id, snaptrade_account_id, brokerage_name, j2_account_id,
            sync_enabled, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?)""",
        (ba_id, user_id, "snap-x", "Robinhood", j2["id"], now, now))
    conn.commit()
    return ba_id


def test_begin_warming_marks_all_user_accounts():
    import uuid
    init_db()
    # Unique user id so re-runs against the persistent shared /data/auth.db
    # don't collide (AccountConflictError) on the per-user account name.
    user_id = "uw-" + uuid.uuid4().hex[:8]
    conn = get_connection()
    try:
        ba_id = _make_account(conn, user_id)
    finally:
        conn.close()
    broker_sync_router._begin_warming(user_id)
    acct = connections.get_broker_account(user_id, ba_id)
    assert acct["warming"] is True
