"""
Regression tests for the support-ticket process.

Guards three fixes:
  1. get_all_tickets() must LEFT JOIN users — an orphaned ticket (user row
     missing) must still surface in the admin list, not vanish.
  2. A user reply to a *resolved* ticket reopens it (status → 'open') so it
     resurfaces in the admin's open/in-progress filters.
  3. A user reply to a non-resolved ticket leaves the status unchanged.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.routers.auth import get_current_user
from api.services import auth_db
from api.services.auth_service import (
    create_user,
    create_ticket,
    get_all_tickets,
    get_ticket_thread,
    update_ticket_status,
)


@pytest.fixture()
def temp_auth_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / "auth_test.db")
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)
    auth_db.init_db()
    return db_path


def test_get_all_tickets_returns_orphaned_ticket(temp_auth_db):
    """A ticket whose user row is missing must still appear for admins."""
    # Insert a ticket pointing at a non-existent user, bypassing the FK so we
    # can simulate the orphaned-account state.
    ticket_id = str(uuid.uuid4())
    conn = auth_db.get_connection()
    try:
        conn.execute("PRAGMA foreign_keys=OFF")
        conn.execute(
            "INSERT INTO support_tickets (id, user_id, subject, category) VALUES (?, ?, ?, ?)",
            (ticket_id, "ghost-user-id", "Orphaned ticket", "bug"),
        )
        conn.commit()
    finally:
        conn.close()

    tickets = get_all_tickets()
    ids = [t["id"] for t in tickets]
    assert ticket_id in ids, "INNER JOIN would have dropped the orphaned ticket"
    orphan = next(t for t in tickets if t["id"] == ticket_id)
    assert orphan["email"] is None  # LEFT JOIN yields NULL user columns


def test_get_all_tickets_includes_normal_ticket(temp_auth_db):
    """Positive control — a normal ticket with a valid user is listed."""
    user = create_user("ticketer@example.com", "pw12345")
    res = create_ticket(user["id"], "Normal ticket", "help me", "question")
    tickets = get_all_tickets()
    match = next((t for t in tickets if t["id"] == res["id"]), None)
    assert match is not None
    assert match["email"] == "ticketer@example.com"


# ── Reopen-on-reply behavior (router) ────────────────────────────────────────


@pytest.fixture()
def client_as_user(temp_auth_db):
    """TestClient with get_current_user overridden to a freshly created user.

    Not used as a context manager, so app lifespan/startup never fires — keeps
    the test fast and isolated to the temp DB.
    """
    user = create_user("replier@example.com", "pw12345")
    app.dependency_overrides[get_current_user] = lambda: user
    yield TestClient(app), user
    app.dependency_overrides.clear()


def test_user_reply_reopens_resolved_ticket(client_as_user):
    client, user = client_as_user
    res = create_ticket(user["id"], "Was resolved", "initial", "bug")
    update_ticket_status(res["id"], "resolved")

    r = client.post(f"/api/auth/tickets/{res['id']}/messages", json={"message": "still broken"})
    assert r.status_code == 200

    thread = get_ticket_thread(res["id"])
    assert thread["ticket"]["status"] == "open", "reply to a resolved ticket should reopen it"
    assert any(m["message"] == "still broken" for m in thread["messages"])


def test_user_reply_to_open_ticket_keeps_status(client_as_user):
    client, user = client_as_user
    res = create_ticket(user["id"], "Still open", "initial", "bug")  # defaults to 'open'

    r = client.post(f"/api/auth/tickets/{res['id']}/messages", json={"message": "any update?"})
    assert r.status_code == 200

    thread = get_ticket_thread(res["id"])
    assert thread["ticket"]["status"] == "open"


def test_user_reply_to_in_progress_ticket_keeps_status(client_as_user):
    """In-progress tickets already show in the admin's active view — a reply
    must not bump them back to 'open' and lose the in-progress signal."""
    client, user = client_as_user
    res = create_ticket(user["id"], "Being worked", "initial", "bug")
    update_ticket_status(res["id"], "in_progress")

    r = client.post(f"/api/auth/tickets/{res['id']}/messages", json={"message": "thanks"})
    assert r.status_code == 200

    thread = get_ticket_thread(res["id"])
    assert thread["ticket"]["status"] == "in_progress"
