"""GET /api/user-definitions reads the LIVE definitions only, never a tombstone's stored document.

The store is append-only: a delete writes a TOMBSTONE version that carries the whole document and the
member's Pine script (`soft_delete`). `list_for_user` used to SELECT every definition's newest row,
tombstones included, and drop the tombstones in Python, so every list read paid for every indicator
the member had ever deleted: each one's document (~70 KB for Fred RS) and script (~22 KB) were read
and turned into Python strings, then thrown away. Measured locally on a Fred RS copy: 1 live + 299
deleted, the list handler took 71 ms against 4 ms for 1 live alone; the rows query alone, 30 live +
270 deleted, 67 ms -> 6.6 ms with the tombstones filtered in SQL.

What this pins:
  * the answer is the one it always was (the same definitions, versions and order), and
  * the database hands back ONLY live rows to Python (a tombstone is filtered in SQL).
"""

from __future__ import annotations

import sqlite3

import pytest

from api.services import alert_rev_migration as rev
from api.services import indicator_alert_service as ias
from api.services import user_definitions as svc

USER = "u-live-only"
OTHER = "u-someone-else"


def _ast_sma(period: int) -> dict:
    return {"type": "call", "name": "sma",
            "args": [{"type": "series", "name": "close"}, {"type": "num", "value": period}]}


def defn(def_id: str, period: int = 20, name: str = "My Average") -> dict:
    return {
        "schemaVersion": 1,
        "id": def_id,
        "version": 1,
        "meta": {"name": name, "shortName": "MA", "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": _ast_sma(period)},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    return tmp_path


def _new(user: str, period: int = 20) -> str:
    def_id = svc.new_def_id()
    svc.save(user, def_id, defn(def_id, period))
    return def_id


@pytest.fixture
def history(store):
    """Every shape a member's rows can take: live, edited, deleted, deleted and saved again, and
    another member's rows beside them."""
    live = _new(USER)
    gone = [_new(USER, 10 + i) for i in range(4)]
    for d in gone:
        assert svc.soft_delete(USER, d)
    edited = _new(USER, 30)
    svc.save(USER, edited, defn(edited, 31))
    svc.save(USER, edited, defn(edited, 32))
    back = _new(USER, 40)
    assert svc.soft_delete(USER, back)
    svc.save(USER, back, defn(back, 41))            # a resurrect: saved over its tombstone
    theirs = _new(OTHER, 50)
    their_gone = _new(OTHER, 51)
    assert svc.soft_delete(OTHER, their_gone)
    return {"live": [live, edited, back], "gone": gone, "theirs": [theirs]}


def test_the_list_is_the_live_definitions_newest_version_in_creation_order(history):
    rows = svc.list_for_user(USER)
    assert [r["def_id"] for r in rows] == history["live"]
    # each is exactly what the single read serves as the live newest version
    for r in rows:
        one = svc.get(USER, r["def_id"])
        assert r == one
        assert r["deleted_at"] is None
    assert [r["version"] for r in rows] == [1, 3, 3]
    assert [r["def_id"] for r in svc.list_for_user(OTHER)] == history["theirs"]


def test_a_member_with_only_deleted_definitions_lists_none(store):
    for d in [_new(USER), _new(USER)]:
        assert svc.soft_delete(USER, d)
    assert svc.list_for_user(USER) == []


class _Cursor(sqlite3.Cursor):
    def fetchall(self):
        rows = super().fetchall()
        if "MAX(version)" in getattr(self, "sql", ""):
            _FETCHED.append(len(rows))
        return rows


class _Conn(sqlite3.Connection):
    def execute(self, sql, params=()):
        cur = self.cursor(_Cursor)
        cur.sql = sql
        return cur.execute(sql, params)


_FETCHED: list = []


def test_a_tombstone_never_leaves_the_database(history, monkeypatch):
    """The rows the list query hands to Python are the live ones only: a deleted definition's
    stored document and script are never read into the process."""
    real = sqlite3.connect
    monkeypatch.setattr(svc.sqlite3, "connect", lambda *a, **k: real(*a, factory=_Conn, **k))
    _FETCHED.clear()
    rows = svc.list_for_user(USER)
    assert [r["def_id"] for r in rows] == history["live"]
    assert _FETCHED == [len(history["live"])], (
        f"the list query fetched {_FETCHED} rows for {len(history['live'])} live definitions: "
        "tombstones are being read into Python")
