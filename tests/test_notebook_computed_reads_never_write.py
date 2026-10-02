"""Wave 11 (lane 11B), controller ruling 2026-10-01: A READ NEVER WRITES.

Formula and rollup values are computed in memory at read time. Every member's
list read would otherwise contend for the single SQLite writer every save
uses. These rails fail if any GET that computes them commits anything:

  * the detector is SQLite's own `PRAGMA data_version`, read on a SEPARATE
    connection -- it changes exactly when another connection commits, so it
    cannot be fooled by which code path did the write;
  * a CONTROL proves the detector sees a write (a property save moves it);
  * the GETs covered: the list (plain, sorted by a formula, sorted by a
    rollup, filtered by each, a saved view with a formula condition), one
    note's properties, and the property definitions.
"""
from __future__ import annotations

import importlib
import json
import os
import sqlite3
import tempfile
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    monkeypatch.setenv("NOTEBOOK_FORMULAS_ENABLED", "1")
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def client(db_path):
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "member"}
    yield TestClient(fa)
    fa.dependency_overrides.clear()


class Watcher:
    """Reads `PRAGMA data_version` on its own connection: it moves only when
    ANOTHER connection commits a change to the database file."""

    def __init__(self, path: str):
        self.conn = sqlite3.connect(path)

    def version(self) -> int:
        return self.conn.execute("PRAGMA data_version").fetchone()[0]


@pytest.fixture
def watcher(db_path):
    w = Watcher(db_path)
    yield w
    w.conn.close()      # Windows cannot unlink the file under an open handle


def _def(client, name, type_, **extra):
    r = client.post("/api/j2/property-defs", json={"name": name, "type": type_, **extra})
    assert r.status_code == 200, r.text
    return r.json()["propertyDef"]["id"]


def _doc_linking(*ids):
    paras = [{"type": "paragraph", "content": [{"type": "noteLink", "attrs": {"noteId": i}}]} for i in ids]
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "x"}]}, *paras]}


@pytest.fixture
def library(client, db_path):
    ids = {n: _def(client, n, "number") for n in ("Entry", "Stop", "Exit")}
    r = _def(client, "R", "formula", config={"expression": "({Exit} - {Entry}) / ({Entry} - {Stop})"})
    kids = []
    for exit_ in (110, 120, 95):
        nid = client.post("/api/j2/notes", json={"title": f"plan {exit_}"}).json()["note"]["id"]
        client.put(f"/api/j2/notes/{nid}", json={"properties": {ids["Entry"]: 100, ids["Stop"]: 95, ids["Exit"]: exit_}})
        kids.append(nid)
    parent = client.post("/api/j2/notes", json={"title": "parent", "bodyJson": _doc_linking(*kids)}).json()["note"]["id"]
    roll = _def(client, "Avg R", "rollup", config={"source": "links_from_this", "aggregate": "avg", "propertyId": r})
    view = client.post("/api/j2/saved-views", json={
        "name": "Winners", "viewType": "table",
        "spec": {"propertyFilter": [{"propertyId": r, "op": "gt", "value": 0}]}}).json()["savedView"]
    vroll = _def(client, "Winners", "rollup", config={"source": "saved_view", "savedViewId": view["id"], "aggregate": "count"})
    from api.services.auth_db import get_connection
    conn = get_connection()
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date, exit_price,"
        " exit_date, original_stop, pnl_dollar, pnl_percent, r_multiple, hold_days, result, context_at_entry, created_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (uuid.uuid4().hex, "u1", "p", "NVDA", "Long", 1, 1, "2026-09-01", 2, "2026-09-02", 0.5, 1, 1, 2, 1, "Win", "{}",
         "2026-09-01"))
    conn.commit()
    conn.close()
    return {"R": r, "roll": roll, "vroll": vroll, "view": view["id"], "parent": parent, "kids": kids}


def _reads(lib):
    return [
        ("GET /notes", "/api/j2/notes", {}),
        ("GET /notes sorted by a formula", "/api/j2/notes",
         {"propertySort": json.dumps({"propertyId": lib["R"], "direction": "desc"})}),
        ("GET /notes sorted by a rollup", "/api/j2/notes",
         {"propertySort": json.dumps({"propertyId": lib["roll"], "direction": "asc"})}),
        ("GET /notes filtered by a formula", "/api/j2/notes",
         {"propertyFilter": json.dumps([{"propertyId": lib["R"], "op": "gt", "value": 1}])}),
        ("GET /notes filtered by a rollup", "/api/j2/notes",
         {"propertyFilter": json.dumps([{"propertyId": lib["roll"], "op": "is_not_empty"}])}),
        ("GET /notes through a saved view with a formula condition", "/api/j2/notes", {"savedViewId": lib["view"]}),
        ("GET one note's properties (formula)", f"/api/j2/notes/{lib['kids'][0]}/properties", {}),
        ("GET one note's properties (rollups)", f"/api/j2/notes/{lib['parent']}/properties", {}),
        ("GET /property-defs", "/api/j2/property-defs", {}),
    ]


def test_CONTROL_the_watcher_sees_a_write(client, library, watcher):
    w = watcher
    before = w.version()
    r = client.put(f"/api/j2/notes/{library['kids'][0]}", json={"title": "changed"})
    assert r.status_code == 200
    assert w.version() != before, "the detector cannot see a commit -- every other rail here is vacuous"


@pytest.mark.parametrize("index", range(9))
def test_a_computed_read_commits_nothing(client, library, watcher, index):
    label, url, params = _reads(library)[index]
    # ⛔ No warm-up call: a cache filled on the FIRST read would write only once,
    # and a warm-up would hide exactly that. The first read is the one measured.
    w = watcher
    before = w.version()
    r = client.get(url, params=params)
    assert r.status_code == 200, (label, r.text)
    assert w.version() == before, f"{label} WROTE to the database"


def test_the_reads_really_computed_something(client, library):
    # NON-VACUITY: the reads above must have exercised the computed path, or
    # "it wrote nothing" would be true of a path that never ran.
    props = {p["name"]: p for p in client.get(f"/api/j2/notes/{library['parent']}/properties").json()["properties"]}
    assert props["Avg R"]["value"] == pytest.approx((2 + 4 - 1) / 3)
    assert props["Winners"]["value"] == 2.0
    rows = client.get("/api/j2/notes", params={
        "propertySort": json.dumps({"propertyId": library["R"], "direction": "desc"})}).json()["notes"]
    assert rows[0]["computed"][library["R"]]["value"] == 4.0
