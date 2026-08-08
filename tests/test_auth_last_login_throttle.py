r"""Regression test for the 2026-07-01 event-loop/threadpool-exhaustion incident.

`validate_session()` runs on EVERY authenticated request. It used to issue an
`UPDATE users SET last_login_at ... ` + commit on every call — a serialized SQLite
write on the universal auth path that, under concurrent load, held anyio threadpool
threads through a write-lock contention and starved the whole app (Cloudflare 524s).

The fix throttles that write to at most once per user per `_LAST_LOGIN_MIN_INTERVAL`
seconds via an in-process guard. `last_login_at` is display-only, so coarse
granularity is fine. These tests pin the throttle behavior so it can't regress.

⛔ THIS FILE DELIBERATELY DOES NOT SET `AUTH_DB_PATH`, AND THAT IS THE FIX.

It used to open with

    _TMP_DB = os.path.join(tempfile.gettempdir(), "uct_test_auth_last_login.db")
    os.environ["AUTH_DB_PATH"] = _TMP_DB

at MODULE level, unrestored. The reason was real — `auth_db` reads the path once,
at import, so a fixture `setenv` reaches nothing — but the remedy was global: the
six product modules that capture `AUTH_DB_PATH` at import bind to whichever
assignment pytest imported FIRST, so this line decided the whole session's auth
store whenever this file happened to be collected before `api.services.auth_db`.
It never leaked to the shared `C:\data\auth.db` (its target was a temp file), but
it is why the isolation rail could only assert "never the SHARED store" instead of
the stronger "always MY store": demanding one file made the rail pass in one
collection order and fail in the other.

The repo-root `conftest.py` (`5479acb4`) now mints ONE isolated store and sets
`AUTH_DB_PATH` at conftest import — before any test module is imported, therefore
before any of those six can capture anything. So this file has nothing left to do,
and `tests/test_shared_state_landmines.py::
test_the_connection_the_product_opens_is_ALWAYS_the_sessions_own_store` is now the
stronger rail that removing this comment's advice would break.
"""


def test_should_write_last_login_throttles_within_window():
    from api.services import auth_service as a

    a._LAST_LOGIN_WRITE.clear()
    uid = "user-123"
    t0 = 1_000_000.0

    # First call for a user always writes.
    assert a._should_write_last_login(uid, now=t0) is True
    # A second call inside the interval is throttled (no write).
    assert a._should_write_last_login(uid, now=t0 + 1.0) is False
    assert a._should_write_last_login(uid, now=t0 + a._LAST_LOGIN_MIN_INTERVAL - 1) is False
    # Once the interval elapses, we write again.
    assert a._should_write_last_login(uid, now=t0 + a._LAST_LOGIN_MIN_INTERVAL + 1) is True


def test_should_write_last_login_is_per_user():
    from api.services import auth_service as a

    a._LAST_LOGIN_WRITE.clear()
    t0 = 2_000_000.0
    assert a._should_write_last_login("user-A", now=t0) is True
    # A different user is independent — first write for them still happens.
    assert a._should_write_last_login("user-B", now=t0 + 1.0) is True
    # ...but the first user is still throttled.
    assert a._should_write_last_login("user-A", now=t0 + 1.0) is False


def test_validate_session_writes_last_login_at_most_once_per_window():
    """End-to-end: repeated validate_session calls issue exactly ONE last_login write."""
    from api.services.auth_db import init_db, get_connection
    from api.services import auth_service as a

    init_db()
    a._LAST_LOGIN_WRITE.clear()

    user = a.create_user(f"throttle_{__import__('uuid').uuid4()}@example.com", "password123")
    token = a.create_session(user["id"])

    # Count how many last_login UPDATEs actually reach SQLite.
    writes = {"n": 0}
    real_get_conn = a.get_connection

    class _CountingConn:
        def __init__(self, inner):
            self._inner = inner

        def execute(self, sql, *args, **kwargs):
            if "last_login_at" in sql:
                writes["n"] += 1
            return self._inner.execute(sql, *args, **kwargs)

        def __getattr__(self, name):
            return getattr(self._inner, name)

    def _patched_get_conn():
        return _CountingConn(real_get_conn())

    a.get_connection = _patched_get_conn
    try:
        for _ in range(5):
            result = a.validate_session(token)
            assert result is not None
            assert result["id"] == user["id"]
    finally:
        a.get_connection = real_get_conn

    assert writes["n"] == 1, f"expected exactly 1 last_login write across 5 calls, got {writes['n']}"
