"""Route-level rail for GET /api/j2/notes/export (Task 8).

Mirrors test_export.py's `route_client` fixture (the sibling `/trades/export`
route test) -- the observable here is the DOWNLOAD RESPONSE itself: status,
Content-Type, Content-Disposition, auth enforcement, and that the response is
scoped to the caller's own notes. `build_export_zip` already has its own
thorough unit coverage in test_notes_export.py; this file only proves the
route wires it up correctly.
"""
import io
import sqlite3
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services.journal_two import db as j2db


def _insert_note(conn, nid, uid, title):
    conn.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain,"
        " tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        (nid, uid, title,
         '{"type":"doc","content":[{"type":"paragraph","content":'
         '[{"type":"text","text":"body"}]}]}',
         "body", "[]", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
    )


@pytest.fixture
def route_client(monkeypatch, tmp_path):
    """Minimal app mounting the real journal_two router, with get_current_user
    overridden and the service DB pointed at a seeded temp file -- same shape
    as test_export.py's fixture for /trades/export."""
    from api.services import auth_db
    from api.middleware.auth_middleware import get_current_user
    from api.routers import journal_two

    db_path = str(tmp_path / "j2_notes_export.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    _insert_note(conn, "n1", "u1", "Cup and handle")
    _insert_note(conn, "n2", "u2", "Someone else's note")
    conn.commit()
    conn.close()

    # get_connection() reads the module-global _DB_PATH at call time.
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)

    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1"}
    return TestClient(app)


def test_export_returns_a_zip_attachment(route_client):
    r = route_client.get("/api/j2/notes/export")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    cd = r.headers["content-disposition"]
    assert cd.startswith('attachment; filename="uct-notebook-export-')
    assert cd.endswith('.zip"')


def test_export_contains_only_the_callers_own_notes(route_client):
    r = route_client.get("/api/j2/notes/export")
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = zf.namelist()
    assert "Cup and handle.md" in names
    assert not any("Someone else" in n for n in names)


def test_export_requires_auth():
    """Without the get_current_user override, the dependency itself decides
    the auth outcome (401/403) -- this just proves the route does not bypass
    the dependency when no override is installed."""
    from api.routers import journal_two

    app = FastAPI()
    app.include_router(journal_two.router)
    client = TestClient(app, raise_server_exceptions=False)
    r = client.get("/api/j2/notes/export")
    assert r.status_code in (401, 403)


def test_export_route_registered_before_dynamic_note_detail():
    """/notes/export must be a distinct static route, not swallowed by the
    dynamic /notes/{note_id} route (same shadowing hazard as /trades/export)."""
    from api.routers.journal_two import router

    paths = [rt.path for rt in router.routes]
    assert "/api/j2/notes/export" in paths
    assert "/api/j2/notes/{note_id}" in paths
    assert paths.index("/api/j2/notes/export") < paths.index(
        "/api/j2/notes/{note_id}")
