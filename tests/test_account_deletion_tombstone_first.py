"""⛔⛔ THE TOMBSTONE IS THE FIRST WRITE OF AN ACCOUNT DELETION, OR NOTHING IS DELETED.

Wave 10, lane 10C, fix round 1 item 2 (ruling R-9). The tombstone used to be recorded
LAST in `purge_user_data`: any exception in the purge before it (a non-OperationalError
in one table's DELETE, a failed commit) skipped it, and both admin endpoints then deleted
the account anyway -- a member deleted with no tombstone, whom every older backup brings
back on restore.

Now, and each clause is a rail below:
  * the tombstone is recorded BEFORE the first delete -- before the broker purge in the
    endpoints, and first in `purge_user_data`;
  * a purge that raises mid-table, or whose commit fails, leaves the tombstone in place
    (a restore's replay then finishes the intended deletion);
  * a tombstone that cannot be recorded deletes NOTHING: `purge_user_data` answers
    `aborted`, and both endpoints answer 500 with a sentence and keep the account.
"""
from __future__ import annotations

import importlib
import sqlite3

import pytest
from fastapi import HTTPException

from api.services import account_tombstones as at

GONE, KEPT = "u-gone-3333", "u-kept-4444"
ADMIN = {"id": "u-admin-0000", "role": "admin"}


@pytest.fixture
def authdb(monkeypatch, tmp_path):
    for v in ("AUTHDB_BACKUP_ENABLED", at.LOCAL_STORE_ENV):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv(at.LOCAL_STORE_ENV, str(tmp_path / "store"))   # a LOCAL fake store
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield auth_db
    importlib.reload(auth_db)


def _seed(auth_db, uid: str) -> None:
    from api.services.journal_two import notes as notes_svc
    c = auth_db.get_connection()
    try:
        c.execute("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", (uid, f"{uid}@example.com"))
        c.commit()
        notes_svc.create_note(uid, {"title": f"thesis of {uid}", "bodyJson": {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": f"words of {uid}"}]}]}}, conn=c)
    finally:
        c.close()


def _state(auth_db, uid: str) -> dict:
    c = sqlite3.connect(auth_db._DB_PATH)
    try:
        has_tomb = bool(c.execute("SELECT name FROM sqlite_master WHERE name = ?", (at.TABLE,)).fetchone())
        return {
            "user": bool(c.execute("SELECT 1 FROM users WHERE id = ?", (uid,)).fetchone()),
            "notes": c.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ?", (uid,)).fetchone()[0],
            "tombstone": bool(has_tomb and c.execute(
                f"SELECT 1 FROM {at.TABLE} WHERE user_id = ?", (uid,)).fetchone()),
        }
    finally:
        c.close()


class _Breaking:
    """A connection that raises on one chosen statement or commit -- never an
    OperationalError, which the purge's per-table guard would swallow."""

    def __init__(self, real, *, on_sql: str | None = None, on_commit_after_delete: bool = False):
        self._real, self._on_sql, self._on_commit = real, on_sql, on_commit_after_delete
        self.deleted_something = False
        self.fired = False

    def __getattr__(self, name):
        return getattr(self._real, name)

    def execute(self, sql, params=()):
        if self._on_sql and sql.startswith(self._on_sql):
            self.fired = True
            raise sqlite3.IntegrityError("planted: a table the purge cannot delete from")
        if sql.lstrip().upper().startswith("DELETE"):
            self.deleted_something = True
        return self._real.execute(sql, params)

    def commit(self):
        if self._on_commit and self.deleted_something:
            self.fired = True
            raise sqlite3.DatabaseError("planted: the purge's commit failed")
        return self._real.commit()


# ── purge_user_data ─────────────────────────────────────────────────────────────────────

def test_a_purge_that_raises_mid_table_leaves_the_tombstone(authdb):
    from api.services.journal_two import account_purge
    _seed(authdb, GONE)
    real = authdb.get_connection()
    conn = _Breaking(real, on_sql="DELETE FROM j2_notes")
    try:
        with pytest.raises(sqlite3.IntegrityError):
            account_purge.purge_user_data(GONE, conn)
    finally:
        real.close()
    assert conn.fired, "the planted failure never fired -- the purge was not exercised"
    assert _state(authdb, GONE)["tombstone"], (
        "⛔ the purge failed and the TOMBSTONE is missing -- a deletion that goes ahead now "
        "has no record, and every older backup brings the member back")


def test_a_purge_whose_commit_fails_leaves_the_tombstone(authdb):
    from api.services.journal_two import account_purge
    _seed(authdb, GONE)
    real = authdb.get_connection()
    conn = _Breaking(real, on_commit_after_delete=True)
    try:
        with pytest.raises(sqlite3.DatabaseError):
            account_purge.purge_user_data(GONE, conn)
    finally:
        real.close()
    assert conn.fired and conn.deleted_something
    assert _state(authdb, GONE)["tombstone"]


def test_no_tombstone_means_the_purge_deletes_nothing(authdb, monkeypatch):
    from api.services.journal_two import account_purge
    _seed(authdb, GONE)
    monkeypatch.setattr(at, "record_tombstone",
                        lambda uid, conn, **k: {"recorded": False, "offsite": False, "why": "planted"})
    c = authdb.get_connection()
    try:
        report = account_purge.purge_user_data(GONE, c)
    finally:
        c.close()
    assert report["aborted"] is True and report["ok"] is False
    assert "tombstone" in report["errors"][0] and "nothing was deleted" in report["errors"][0]
    s = _state(authdb, GONE)
    assert s["notes"] == 1 and s["user"], "⛔ the purge deleted rows although no tombstone was recorded"


# ── the two admin endpoints ─────────────────────────────────────────────────────────────

def _call(which: str, uid: str):
    from api.routers import auth
    if which == "by-id":
        return auth.admin_delete_user_by_id(uid, ADMIN)
    return auth.admin_delete_user(auth.DeleteUserRequest(email=f"{uid}@example.com"), ADMIN)


@pytest.mark.parametrize("which", ["by-id", "by-email"])
def test_the_endpoint_records_the_tombstone_before_its_first_delete(authdb, monkeypatch, which):
    """The broker purge is a delete too, and it runs first: the tombstone must already
    be on disk when it starts."""
    from api.services.journal_two.broker import service as broker
    seen = {}

    def spy(uid, conn):
        seen["tombstone_at_broker_purge"] = _state(authdb, uid)["tombstone"]
        return {}
    monkeypatch.setattr(broker, "purge_on_account_deletion", spy)
    _seed(authdb, GONE)
    _seed(authdb, KEPT)
    out = _call(which, GONE)
    assert out["deleted"] is True
    assert seen == {"tombstone_at_broker_purge": True}, (
        "⛔ the broker purge ran before the tombstone was recorded")
    gone, kept = _state(authdb, GONE), _state(authdb, KEPT)
    assert (gone["user"], gone["notes"], gone["tombstone"]) == (False, 0, True)
    assert (kept["user"], kept["notes"], kept["tombstone"]) == (True, 1, False)


@pytest.mark.parametrize("which", ["by-id", "by-email"])
def test_the_endpoint_deletes_NOTHING_when_the_tombstone_cannot_be_recorded(authdb, monkeypatch, which):
    from api.routers import auth
    from api.services.journal_two.broker import service as broker
    purged = []
    monkeypatch.setattr(broker, "purge_on_account_deletion", lambda uid, conn: purged.append(uid) or {})
    monkeypatch.setattr(at, "record_tombstone",
                        lambda uid, conn, **k: {"recorded": False, "offsite": False, "why": "planted"})
    _seed(authdb, GONE)
    with pytest.raises(HTTPException) as e:
        _call(which, GONE)
    assert e.value.status_code == 500 and e.value.detail == auth.TOMBSTONE_REFUSED_DETAIL
    assert "Nothing was deleted" in e.value.detail
    assert purged == [], "⛔ the broker purge ran although the deletion was refused"
    s = _state(authdb, GONE)
    assert s["user"] and s["notes"] == 1, "⛔ the account was deleted with no tombstone"


def test_a_purge_that_fails_after_the_tombstone_still_deletes_the_account(authdb, monkeypatch):
    """Tombstone recorded, then the Journal purge raises: the endpoint proceeds (non-fatal,
    as before) -- and that is correct now, because the tombstone makes every restore finish
    the deletion."""
    from api.services.journal_two import account_purge
    from api.services.journal_two.broker import service as broker
    monkeypatch.setattr(broker, "purge_on_account_deletion", lambda uid, conn: {})

    def boom(uid, conn, **k):
        raise sqlite3.IntegrityError("planted")
    monkeypatch.setattr(account_purge, "purge_user_data", boom)
    _seed(authdb, GONE)
    out = _call("by-id", GONE)
    assert out["deleted"] is True and out["journal_two_purge"]["ok"] is False
    s = _state(authdb, GONE)
    assert (s["user"], s["tombstone"]) == (False, True)
