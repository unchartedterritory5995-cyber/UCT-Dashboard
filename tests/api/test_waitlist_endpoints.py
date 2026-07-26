# tests/api/test_waitlist_endpoints.py
"""Integration tests for the pre-launch waitlist + COMING_SOON_MODE gating.

Covers the two things that must not regress while the public site is the
COMING SOON page:
  1. Account creation and billing are actually closed.
  2. Login stays open, so existing members never lose access.
"""
import importlib
import sqlite3

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    """TestClient with auth.db pointed at a temp file and pre-launch mode on.

    The rate limiter is disabled here: it keys on client IP, and every
    TestClient request reports the same one, so its bucket is shared across
    every test in the process and the 6th POST in a minute would 429 whichever
    test happened to run then. `test_rate_limit_actually_fires` re-enables it
    and asserts the limit on purpose.
    """
    db = tmp_path / "auth_test.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db))
    monkeypatch.setenv("COMING_SOON_MODE", "1")

    import api.services.auth_db as auth_db
    importlib.reload(auth_db)
    auth_db.init_db()

    from api.limiter import limiter
    monkeypatch.setattr(limiter, "enabled", False)

    from api.main import app
    c = TestClient(app)
    c._db_path = str(db)
    return c


def _rows(client):
    conn = sqlite3.connect(client._db_path)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute("SELECT * FROM waitlist ORDER BY id")]
    finally:
        conn.close()


# ── Waitlist capture ─────────────────────────────────────────────────────────

def test_join_stores_the_email(client):
    resp = client.post("/api/waitlist", json={"email": "trader@example.com"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "already": False}

    rows = _rows(client)
    assert len(rows) == 1
    assert rows[0]["email"] == "trader@example.com"


def test_email_is_normalised_to_lowercase(client):
    client.post("/api/waitlist", json={"email": "Trader@Example.COM"})
    assert _rows(client)[0]["email"] == "trader@example.com"


def test_repeat_signup_is_idempotent(client):
    client.post("/api/waitlist", json={"email": "trader@example.com"})
    resp = client.post("/api/waitlist", json={"email": "TRADER@example.com"})

    # Reports success (never leaks whether an address is already listed) but
    # does not create a second row.
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "already": True}
    assert len(_rows(client)) == 1


def test_malformed_email_is_rejected(client):
    resp = client.post("/api/waitlist", json={"email": "not-an-email"})
    assert resp.status_code == 422
    assert _rows(client) == []


def test_ip_is_stored_truncated_to_a_24_prefix(client):
    client.post("/api/waitlist", json={"email": "trader@example.com"})
    prefix = _rows(client)[0]["ip_prefix"]
    # Never the full address.
    assert prefix is None or prefix.endswith(".0") or ":" in prefix


def test_confirmation_email_failure_does_not_lose_the_signup(client, monkeypatch):
    """The address is stored before the email is attempted — a Resend outage
    must never cost a signup."""
    import api.routers.waitlist as wl

    def boom(_email):
        raise RuntimeError("resend is down")

    monkeypatch.setattr(wl, "send_waitlist_confirmation", boom)

    resp = client.post("/api/waitlist", json={"email": "trader@example.com"})
    assert resp.status_code == 200
    assert len(_rows(client)) == 1


def test_rate_limit_actually_fires(client, monkeypatch):
    """The endpoint is public and unauthenticated, so the 5/minute cap is the
    only thing standing between it and a scripted list-stuffing run."""
    from api.limiter import limiter
    monkeypatch.setattr(limiter, "enabled", True)
    limiter.reset()

    codes = [
        client.post("/api/waitlist", json={"email": f"t{i}@example.com"}).status_code
        for i in range(7)
    ]
    assert 429 in codes, f"expected a 429 within 7 rapid posts, got {codes}"
    limiter.reset()


# ── Discord ping ─────────────────────────────────────────────────────────────

def test_new_signup_pings_discord_with_the_running_total(client, monkeypatch):
    import api.routers.waitlist as wl
    calls = []
    monkeypatch.setattr(wl, "notify_waitlist_signup",
                        lambda email, total=None, referrer="": calls.append((email, total)))

    client.post("/api/waitlist", json={"email": "one@example.com"})
    client.post("/api/waitlist", json={"email": "two@example.com"})

    assert calls == [("one@example.com", 1), ("two@example.com", 2)]


def test_repeat_signup_does_not_ping(client, monkeypatch):
    """The ping means "someone new joined" — a resubmit is not news."""
    import api.routers.waitlist as wl
    calls = []
    monkeypatch.setattr(wl, "notify_waitlist_signup",
                        lambda email, total=None, referrer="": calls.append(email))

    client.post("/api/waitlist", json={"email": "trader@example.com"})
    client.post("/api/waitlist", json={"email": "TRADER@example.com"})

    assert calls == ["trader@example.com"]


def test_discord_failure_does_not_lose_the_signup(client, monkeypatch):
    import api.routers.waitlist as wl

    def boom(*_a, **_k):
        raise RuntimeError("discord is down")

    monkeypatch.setattr(wl, "notify_waitlist_signup", boom)

    resp = client.post("/api/waitlist", json={"email": "trader@example.com"})
    assert resp.status_code == 200
    assert len(_rows(client)) == 1


def test_email_failure_does_not_skip_the_discord_ping(client, monkeypatch):
    """The two notifications are independent — one failing must not silence
    the other, or an SMTP outage would also hide every signup from the owner."""
    import api.routers.waitlist as wl
    pinged = []

    def bad_mail(_email):
        raise RuntimeError("resend is down")

    monkeypatch.setattr(wl, "send_waitlist_confirmation", bad_mail)
    monkeypatch.setattr(wl, "notify_waitlist_signup",
                        lambda email, total=None, referrer="": pinged.append(email))

    client.post("/api/waitlist", json={"email": "trader@example.com"})
    assert pinged == ["trader@example.com"]


def test_discord_embed_carries_email_and_count(monkeypatch):
    """The embed is posted from a daemon thread that swallows every error, so a
    malformed payload would fail completely silently in production. Pin it."""
    import api.services.discord_notify as dn
    sent = {}
    monkeypatch.setattr(dn, "_send_webhook", lambda embed: sent.update(embed))

    dn.notify_waitlist_signup("trader@example.com", total=42, referrer="x.com")

    assert "42" in sent["description"]
    flat = {f["name"]: f["value"] for f in sent["fields"]}
    assert flat["Email"] == "trader@example.com"
    assert flat["List size"] == "42"
    assert flat["Came from"] == "x.com"
    # Gold, not the green used for real account signups — accounts are closed.
    assert sent["color"] == 0xC9A84C


def test_discord_embed_survives_a_missing_total(monkeypatch):
    import api.services.discord_notify as dn
    sent = {}
    monkeypatch.setattr(dn, "_send_webhook", lambda embed: sent.update(embed))

    dn.notify_waitlist_signup("trader@example.com")

    assert sent["description"]  # no "#None"
    assert "None" not in sent["description"]
    assert [f["name"] for f in sent["fields"]] == ["Email"]


def test_discord_notify_is_inert_without_a_webhook(monkeypatch):
    """Local dev and any env without DISCORD_WEBHOOK_URL must no-op silently,
    not raise or block."""
    import api.services.discord_notify as dn
    monkeypatch.setattr(dn, "DISCORD_ADMIN_WEBHOOK", "")
    dn.notify_waitlist_signup("trader@example.com", total=3)  # must not raise


def test_admin_list_requires_auth(client):
    assert client.get("/api/waitlist/admin").status_code in (401, 403)


def test_admin_export_requires_auth(client):
    assert client.get("/api/waitlist/admin/export.csv").status_code in (401, 403)


# ── Pre-launch gating ────────────────────────────────────────────────────────

def test_signup_is_closed_while_coming_soon(client):
    resp = client.post("/api/auth/signup", json={
        "email": "stranger@example.com",
        "password": "LongEnoughPass1",
        "display_name": "Stranger",
    })
    assert resp.status_code == 403
    assert "launch list" in resp.json()["detail"].lower()


def test_signup_gate_runs_before_password_validation(client):
    """A short password must still 403 (closed), not 400 (bad password) —
    otherwise the response tells a stranger signup would otherwise work."""
    resp = client.post("/api/auth/signup", json={
        "email": "stranger@example.com",
        "password": "short",
        "display_name": "Stranger",
    })
    assert resp.status_code == 403


def test_login_is_NOT_gated(client):
    """The whole point of the flag: members keep access. Wrong credentials
    must return 401 (auth failure), never 403 (feature closed)."""
    resp = client.post("/api/auth/login", json={
        "email": "member@example.com",
        "password": "whatever-is-wrong",
    })
    assert resp.status_code == 401


def test_signup_reopens_when_the_flag_is_off(client, monkeypatch):
    """Launch day is an env change, not a deploy."""
    monkeypatch.setenv("COMING_SOON_MODE", "")

    resp = client.post("/api/auth/signup", json={
        "email": "newmember@example.com",
        "password": "LongEnoughPass1",
        "display_name": "New Member",
    })
    assert resp.status_code != 403
