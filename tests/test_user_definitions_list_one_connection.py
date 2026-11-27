"""GET /api/user-definitions makes a handful of database round trips, whatever the number of definitions.

Measured on production after #2883: in a quiet window the list took ~43 ms of server time, but on a busy pod it
reached 2-5 s while /api/auth/me stayed far lower. Each SQLite call releases and re-takes the interpreter lock, and
the list made ~54 of them for 27 definitions (auth/me makes 2): every connection re-ran the schema script (~20
`CREATE ... IF NOT EXISTS` and 4 `PRAGMA table_info`), every row asked its engine status on its own, and the list
opened 2-3 connections.

What this pins:
  * one list request opens ONE connection and makes a constant number of statements (not one per row);
  * the schema runs once per database file per process, and again for a file replaced at the same path or a
    changed schema;
  * the rows, engine statuses included, are exactly what the single-row read serves; the route's answer is
    byte-identical with the round trips made the old way, in every graph x engine variant.
"""

from __future__ import annotations

import contextlib
import json
import os
import sqlite3

import pytest

from api.routers import user_definitions as router_mod
from api.services import alert_rev_migration as rev
from api.services import indicator_alert_service as ias
from api.services import user_definitions as svc

USER = "u-one-conn"
MEMBER = {"id": USER, "role": "member", "plan": "pro"}


def _sma(period: int) -> dict:
    return {"type": "call", "name": "sma",
            "args": [{"type": "series", "name": "close"}, {"type": "num", "value": period}]}


def defn(def_id: str, period: int) -> dict:
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": "Mine", "shortName": "M", "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": _sma(period)},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


def _reset():
    getattr(router_mod, "_reset_list_caches", lambda: None)()
    getattr(svc, "_reset_ensured", lambda: None)()


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    _reset()
    yield tmp_path
    _reset()


def _make(n: int) -> list:
    ids = []
    for i in range(n):
        d = svc.new_def_id()
        svc.save(USER, d, defn(d, 5 + i))
        ids.append(d)
    return ids


def _status(def_id: str, version: int, engine: int, status: str, maths=None):
    c = sqlite3.connect(svc._DB_PATH)
    c.execute("INSERT INTO definition_engine_status (user_id, def_id, version, engine, status, reason, created_at,"
              " refused_maths) VALUES (?,?,?,?,?,?,?,?)",
              (USER, def_id, version, engine, status, f"{status} by {engine}", 0, maths))
    c.commit()
    c.close()


@pytest.fixture
def world(store):
    ids = _make(5)
    edited = ids[4]
    svc.save(USER, edited, defn(edited, 99))           # version 2
    _status(ids[0], 1, 90, "refused", "m0")
    _status(ids[0], 1, 91, "write-failed")             # a write-failed after a refusal rides along
    _status(ids[1], 1, 92, "write-failed")             # a write-failed alone
    _status(ids[2], 1, 90, "refused")                  # a refusal, then a newer refusal
    _status(ids[2], 1, 93, "refused", "m2")
    _status(edited, 1, 90, "refused")                  # an OLDER version's verdict binds nothing on version 2
    return ids


def test_the_rows_are_what_the_single_read_serves_statuses_included(world):
    rows = svc.list_for_user(USER)
    assert [r["def_id"] for r in rows] == world
    for r in rows:
        assert r == svc.get(USER, r["def_id"])
    by = {r["def_id"]: r for r in rows}
    assert by[world[0]]["engine_status"]["status"] == "refused"
    assert by[world[0]]["engine_status"]["write_failed_engine"] == 91
    assert by[world[1]]["engine_status"]["status"] == "write-failed"
    assert by[world[2]]["engine_status"]["engine"] == 93
    assert "engine_status" not in by[world[3]] and "engine_status" not in by[world[4]]


def _route(graph, engine):
    return router_mod.list_definitions(user=dict(MEMBER), graph=graph, engine=engine)


def test_the_route_answers_byte_for_byte_what_the_old_round_trips_answer(world, monkeypatch):
    variants = [(g, e) for g in (True, False) for e in (None, 97)]
    now = {v: json.dumps(_route(*v), sort_keys=True) for v in variants}
    _reset()
    # the old way: a fresh connection for every read, the schema on every connection
    if hasattr(svc, "one_connection"):
        monkeypatch.setattr(svc, "one_connection", contextlib.nullcontext)
        monkeypatch.setattr(svc, "_db_identity", lambda: None)
    old = {v: json.dumps(_route(*v), sort_keys=True) for v in variants}
    assert now == old


class _Conn(sqlite3.Connection):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        _TRACE["conns"] += 1
        self.set_trace_callback(lambda q: _TRACE["stmts"].append(" ".join(q.split())[:80]))


_TRACE: dict = {"conns": 0, "stmts": []}


def _traced_list(monkeypatch):
    real = sqlite3.connect
    monkeypatch.setattr(svc.sqlite3, "connect", lambda *a, **k: real(*a, factory=_Conn, **k))
    _TRACE["conns"], _TRACE["stmts"] = 0, []
    out = _route(True, 97)
    monkeypatch.setattr(svc.sqlite3, "connect", real)
    return out, _TRACE["conns"], list(_TRACE["stmts"])


def test_one_connection_and_a_constant_number_of_statements(store, monkeypatch):
    _make(3)
    _route(True, 97)                                   # first list: the file may be ensured here
    out3, conns3, stmts3 = _traced_list(monkeypatch)
    _make(9)
    _route(True, 97)
    out12, conns12, stmts12 = _traced_list(monkeypatch)
    assert len(out3["definitions"]) == 3 and len(out12["definitions"]) == 12
    assert conns3 == 1 and conns12 == 1, f"connections per list: {conns3}, {conns12}"
    assert len(stmts12) == len(stmts3), f"statements grow with the rows: {len(stmts3)} -> {len(stmts12)}"
    assert len(stmts12) <= 8, stmts12
    assert not any("CREATE" in q or "table_info" in q for q in stmts12), "the schema ran again on an ensured file"


def test_a_file_replaced_at_the_same_path_is_ensured_again(store):
    _make(2)
    assert len(svc.list_for_user(USER)) == 2
    for suffix in ("", "-wal", "-shm"):
        with contextlib.suppress(FileNotFoundError):
            os.remove(svc._DB_PATH + suffix)
    assert svc.list_for_user(USER) == []              # a new, empty file: its tables are created, not assumed


def test_a_changed_schema_is_ensured_again(store, monkeypatch):
    _make(1)
    svc.list_for_user(USER)
    monkeypatch.setattr(svc, "_SCHEMA", svc._SCHEMA + "\nCREATE TABLE IF NOT EXISTS zz_schema_probe (x INTEGER);\n")
    svc.list_for_user(USER)
    c = sqlite3.connect(svc._DB_PATH)
    try:
        assert c.execute("SELECT name FROM sqlite_master WHERE name='zz_schema_probe'").fetchone()
    finally:
        c.close()
