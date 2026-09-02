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


# ── Fix round 2 (review): memory shape + concurrency guard ──────────────────


def test_export_streams_from_a_temp_file_never_the_in_memory_builder(
        route_client, monkeypatch):
    """The route must never build the whole archive as one in-memory `bytes`
    object and hand it to `Response(content=...)` -- that two-copies-in-RAM
    shape (a BytesIO backing array, doubled again by `.getvalue()`) is what
    turns a rare, member-initiated export into a 400+MiB peak on a
    single-replica pod with documented OOM history. Honest about what a unit
    test CAN prove: this asserts the SHAPE -- the disk-backed builder is used
    and its temp file is gone once the download finishes, and the
    bytes-returning builder is never called by the route -- not measured
    peak RSS, which nothing at this level can observe."""
    from api.services.journal_two import notes_export

    captured = []
    real_to_tempfile = notes_export.build_export_zip_to_tempfile

    def spy(*a, **k):
        path, filename = real_to_tempfile(*a, **k)
        captured.append(path)
        return path, filename

    monkeypatch.setattr(notes_export, "build_export_zip_to_tempfile", spy)

    def _must_not_be_called(*a, **k):
        raise AssertionError(
            "route must not materialize the whole archive in memory via "
            "build_export_zip() -- that is exactly the two-copies-in-RAM "
            "shape this fix removes"
        )
    monkeypatch.setattr(notes_export, "build_export_zip", _must_not_be_called)

    r = route_client.get("/api/j2/notes/export")
    assert r.status_code == 200
    zipfile.ZipFile(io.BytesIO(r.content))  # still a valid, complete archive

    assert len(captured) == 1
    # The temp file backing the download is cleaned up once fully streamed --
    # by the time TestClient's synchronous .get() returns, the response
    # generator has already run to completion.
    assert not captured[0].exists()


def test_second_concurrent_export_is_refused_with_429(route_client):
    """Concurrency guard: a small process-wide semaphore (default 1) refuses
    a second concurrent export rather than letting exports stack on a
    single-replica pod with documented OOM history. Simulates "one export
    already running" by holding the real slot directly."""
    from api.services.journal_two import notes_export

    assert notes_export.acquire_export_slot()
    try:
        r = route_client.get("/api/j2/notes/export")
        assert r.status_code == 429
    finally:
        notes_export.release_export_slot()

    # The slot is free again -- a subsequent export is not permanently wedged.
    r2 = route_client.get("/api/j2/notes/export")
    assert r2.status_code == 200
