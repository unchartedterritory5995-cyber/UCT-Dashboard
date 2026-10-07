"""A flag armed on a database where another feature's table does not exist yet.

`j2_note_levels` is created by its owner, `note_levels.ensure_schema`, and before this fix the
only caller of that on a running pod was the resurfacing pass inside the awareness scan. Thesis
chips reads the table. So arming NOTEBOOK_THESIS_CHIPS_ENABLED before one resurfacing scan had
run answered 500 on every call (flags review R5, finding I4).

The older tests in tests/test_notebook_thesis_chips.py could not see this: their `_conn` helper
calls `note_levels.ensure_schema` itself. Nothing here does.
"""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

FLAG = "NOTEBOOK_THESIS_CHIPS_ENABLED"


@pytest.fixture
def fresh_db(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    for name in ("AWARENESS_NOTE_RESURFACE_ENABLED", "AWARENESS_ENGINE_ENABLED"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv(FLAG, "1")
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = auth_db.get_connection()
    conn.execute("INSERT INTO users (id, email, password_hash, display_name, role)"
                 " VALUES ('u1', 'u1@example.com', 'x', 'u1', 'member')")
    conn.commit()
    conn.close()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


def _tables(path):
    from api.services import auth_db
    c = auth_db.get_connection()
    try:
        return {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    finally:
        c.close()


def test_thesis_chips_answers_on_a_database_no_resurfacing_scan_has_touched(fresh_db):
    assert "j2_note_levels" not in _tables(fresh_db), (
        "the fixture already has the table, so this test cannot see the defect")
    from api.routers import notebook_thesis_chips as r
    app = FastAPI()
    app.include_router(r.router)
    user = {"id": "u1", "role": "member", "plan": "pro"}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)
    client = TestClient(app, raise_server_exceptions=False)

    resp = client.post("/api/j2/thesis-chips", json={"symbols": ["NVDA", "AMD"]})

    assert resp.status_code == 200, f"{resp.status_code}: {resp.text[:200]}"
    assert resp.json() == {}


def test_batch_chips_itself_is_safe_without_the_table(fresh_db):
    from api.services import auth_db
    from api.services.journal_two import thesis_chips
    conn = auth_db.get_connection()
    try:
        assert thesis_chips.batch_chips(conn, "u1", ["NVDA"]) == {}
    finally:
        conn.close()
