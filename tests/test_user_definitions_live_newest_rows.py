"""`_live_newest_rows` (behind `live_definitions` and `held_withholds_census`) reads only LIVE rows, across every member.

The same fault #2839 fixed in `list_for_user`, one function over: the query selected every definition's newest row
for EVERY member, tombstones included, and dropped the tombstones in Python. A tombstone carries the whole document
and the Pine script (`soft_delete`), so the sweep's read paid for every indicator any member ever deleted.

⛔ The filter goes on the OUTER row only. The correlated MAX still runs over ALL versions, so a newer tombstone keeps
hiding an older live version: `MAX(version) ... WHERE deleted_at IS NULL` would resurrect a deleted definition's last
live version, and the equality rail below is red on that spelling.
"""

from __future__ import annotations

import sqlite3

import pytest

from api.services import alert_rev_migration as rev
from api.services import indicator_alert_service as ias
from api.services import user_definitions as svc

A, B = "u-live-a", "u-live-b"


def _ast_sma(period: int) -> dict:
    return {"type": "call", "name": "sma",
            "args": [{"type": "series", "name": "close"}, {"type": "num", "value": period}]}


def defn(def_id: str, period: int = 20) -> dict:
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": "My Average", "shortName": "MA", "repaint": "non-repainting"},
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
def world(store):
    """Two members, every shape: live, edited (3 versions), deleted (a newer tombstone over a live version),
    edited then deleted, and deleted then saved again."""
    live = []
    for user in (A, B):
        keep = _new(user)
        gone = _new(user, 11)
        assert svc.soft_delete(user, gone)
        edited = _new(user, 30)
        svc.save(user, edited, defn(edited, 31))
        svc.save(user, edited, defn(edited, 32))
        edited_gone = _new(user, 40)
        svc.save(user, edited_gone, defn(edited_gone, 41))
        assert svc.soft_delete(user, edited_gone)
        back = _new(user, 50)
        assert svc.soft_delete(user, back)
        svc.save(user, back, defn(back, 51))
        live += [(user, keep), (user, edited), (user, back)]
    return live


def test_live_definitions_is_every_members_live_newest_version_oldest_first(world):
    rows = svc.live_definitions()
    # oldest first by row id: A's rows were all written before B's, in creation order within each member
    assert [(r["user_id"], r["def_id"]) for r in rows] == world
    for r in rows:
        assert r["deleted_at"] is None
        assert r == svc.get(r["user_id"], r["def_id"])        # exactly the live newest version
    # a deleted definition never comes back as its older live version
    assert len(rows) == len(world)


def test_the_census_reads_the_same_live_rows(world, monkeypatch):
    from api.services import held_withholds as hw
    seen = []
    monkeypatch.setattr(hw, "census", lambda rows: seen.extend((r["user_id"], r["def_id"]) for r in rows) or {})
    svc.held_withholds_census()
    assert seen == world


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


def test_a_tombstone_never_leaves_the_database(world, monkeypatch):
    real = sqlite3.connect
    monkeypatch.setattr(svc.sqlite3, "connect", lambda *a, **k: real(*a, factory=_Conn, **k))
    _FETCHED.clear()
    rows = svc.live_definitions()
    assert len(rows) == len(world)
    assert _FETCHED == [len(world)], (
        f"the live-rows query fetched {_FETCHED} rows for {len(world)} live definitions: "
        "tombstones are being read into Python")
