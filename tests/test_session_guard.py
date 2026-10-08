"""One person per subscription: the device limit and the login-sharing alarm.

Owner ruling 2026-10-08: 2 devices at once, and an account that looks shared is
signed out everywhere else and reported. Every case drives the real
``auth_service.create_session`` so the rail covers the one call site every
sign-in door goes through.
"""
from __future__ import annotations

import uuid

import pytest

from api.services import auth_db, auth_service, session_guard


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    auth_db.init_db()
    sent: list[str] = []
    monkeypatch.setattr(session_guard, "_post_owner_alert", sent.append)

    class _NoThread:
        def __init__(self, target, args=(), daemon=None):
            self._t, self._a = target, args

        def start(self):
            self._t(*self._a)

    monkeypatch.setattr(session_guard.threading, "Thread", _NoThread)
    for k in ("SESSION_DEVICE_LIMIT", "SESSION_SHARING_GUARD_ENABLED",
              "SESSION_SHARING_MIN_LOGINS", "SESSION_SHARING_MIN_NETWORKS"):
        monkeypatch.delenv(k, raising=False)
    return sent


def _user(email=None):
    u = auth_service.create_user(email or f"m{uuid.uuid4().hex[:8]}@example.com", "pw-123456!")
    return u["id"]


def _tokens(uid):
    conn = auth_db.get_connection()
    try:
        return {r[0] for r in conn.execute("SELECT token FROM sessions WHERE user_id = ?", (uid,))}
    finally:
        conn.close()


def _login(uid, ip):
    auth_service.log_activity(uid, "login", ip_address=ip)
    return auth_service.create_session(uid, user_agent="ua", ip_address=ip)


def _age_sessions(uid):
    """Push every existing session back in time so the next one is clearly newest."""
    conn = auth_db.get_connection()
    try:
        conn.execute("UPDATE sessions SET last_seen_at = datetime(COALESCE(last_seen_at, created_at), '-1 hour') "
                     "WHERE user_id = ?", (uid,))
        conn.commit()
    finally:
        conn.close()


def test_a_third_device_signs_out_the_least_recently_used(db):
    uid = _user()
    t1 = auth_service.create_session(uid, ip_address="10.0.0.1")
    _age_sessions(uid)
    t2 = auth_service.create_session(uid, ip_address="10.0.0.1")
    assert _tokens(uid) == {t1, t2}
    _age_sessions(uid)
    t3 = auth_service.create_session(uid, ip_address="10.0.0.1")
    assert _tokens(uid) == {t2, t3}, "the oldest device must be the one signed out"


def test_two_devices_are_untouched(db):
    uid = _user()
    t1 = auth_service.create_session(uid)
    t2 = auth_service.create_session(uid)
    assert _tokens(uid) == {t1, t2}


def test_the_limit_is_per_account(db):
    a, b = _user(), _user()
    for _ in range(2):
        auth_service.create_session(a)
    tb = auth_service.create_session(b)
    assert len(_tokens(a)) == 2 and _tokens(b) == {tb}


def test_limit_zero_turns_it_off(db, monkeypatch):
    monkeypatch.setenv("SESSION_DEVICE_LIMIT", "0")
    uid = _user()
    for _ in range(4):
        auth_service.create_session(uid)
    assert len(_tokens(uid)) == 4


def test_synthetic_accounts_are_exempt(db):
    uid = _user(f"smoke{uuid.uuid4().hex[:6]}@uctintelligence.internal")
    for _ in range(4):
        auth_service.create_session(uid)
    assert len(_tokens(uid)) == 4


def test_many_logins_from_many_networks_signs_out_and_alerts_once(db, monkeypatch):
    monkeypatch.setenv("SESSION_DEVICE_LIMIT", "0")  # isolate the alarm from the limit
    uid = _user("shared@example.com")
    ips = ["1.1.1.5", "2.2.2.5", "3.3.3.5", "1.1.1.9"]
    for ip in ips:
        _login(uid, ip)
    assert db == [], "four logins is under the threshold"
    last = _login(uid, "4.4.4.4")
    assert _tokens(uid) == {last}, "every other device must be signed out"
    assert len(db) == 1 and "shared@example.com" in db[0] and "4 different networks" in db[0]
    # A sixth login inside the same 24 hours must not alert again.
    _login(uid, "5.5.5.5")
    assert len(db) == 1


def test_many_logins_from_one_network_is_not_sharing(db, monkeypatch):
    monkeypatch.setenv("SESSION_DEVICE_LIMIT", "0")
    uid = _user()
    for i in range(8):
        _login(uid, f"9.9.9.{i + 1}")  # one /24: a phone hopping inside its carrier block
    assert db == [] and len(_tokens(uid)) == 8


def test_the_alarm_has_a_kill_switch(db, monkeypatch):
    monkeypatch.setenv("SESSION_DEVICE_LIMIT", "0")
    monkeypatch.setenv("SESSION_SHARING_GUARD_ENABLED", "0")
    uid = _user()
    for ip in ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4", "5.5.5.5"]:
        _login(uid, ip)
    assert db == [] and len(_tokens(uid)) == 5


def test_a_guard_failure_never_costs_the_sign_in(db, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("guard broke")
    monkeypatch.setattr(session_guard, "enforce_device_limit", boom)
    uid = _user()
    tok = auth_service.create_session(uid)
    assert tok in _tokens(uid)


@pytest.mark.parametrize("ip,net", [
    ("203.0.113.77", "203.0.113.0/24"),
    ("2001:db8:abcd:12::1", "2001:db8:abcd::/48"),
    ("::ffff:198.51.100.4", "198.51.100.0/24"),
    ("", None), ("not-an-ip", None),
])
def test_network_of(ip, net):
    assert session_guard.network_of(ip) == net
