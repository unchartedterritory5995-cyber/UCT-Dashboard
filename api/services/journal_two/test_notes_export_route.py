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

import anyio
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


# ── Disconnect-cancellation leak (reviewer finding, CRITICAL) ────────────────
#
# `stream_export_file`'s `finally` opens with
# `await anyio.to_thread.run_sync(f.close)`. Starlette 0.41.3 delivers a
# client disconnect as a live `anyio.get_cancelled_exc_class()` exception at
# EVERY checkpoint reached while the request's anyio CancelScope is still
# cancelled -- including a checkpoint reached from inside a `finally` block.
# The scenario below reproduces that exactly with anyio's own primitives
# (no Starlette/ASGI plumbing needed): consume one chunk normally, cancel the
# enclosing scope (= "the member closed the tab mid-download"), then ask the
# generator for the next chunk while STILL inside that cancelled scope -- the
# same shape Starlette's `StreamingResponse` produces on a real disconnect.


async def test_client_disconnect_mid_download_frees_the_tempfile_and_slot(
    tmp_path,
):
    """Must FAIL against the pre-fix code: the disconnect leaves the temp
    file on disk AND the concurrency slot held, which is the reviewer's
    measured "5/5 leaks at every disconnect >=1ms" -- with the default
    concurrency limit of 1, that one leaked slot wedges the export at 429 for
    every member until redeploy."""
    from api.services.journal_two import notes_export

    path = tmp_path / "disconnect-repro.zip"
    path.write_bytes(b"x" * (2 * notes_export._EXPORT_STREAM_CHUNK_BYTES))

    assert notes_export.acquire_export_slot()  # simulate the route's own acquire
    try:
        agen = notes_export.stream_export_file(path)
        with anyio.CancelScope() as scope:
            first = await agen.__anext__()  # open + first read succeed normally
            assert first  # got real bytes back before the "disconnect"
            scope.cancel()  # the member closes the tab mid-download
            with pytest.raises(anyio.get_cancelled_exc_class()):
                # Still inside the now-cancelled scope: this is exactly
                # where Starlette's own disconnect cancellation lands.
                await agen.__anext__()

        assert not path.exists(), (
            "the temp file leaked -- cleanup was cut short by cancellation"
        )
        assert notes_export.acquire_export_slot(), (
            "the export slot leaked -- release_export_slot() never ran, "
            "which wedges every member's export at 429 until redeploy"
        )
    finally:
        # Leave the module-global semaphore clean for every other test,
        # whichever branch above actually ran (pass or fail).
        try:
            notes_export.release_export_slot()
        except ValueError:
            pass
        try:
            path.unlink(missing_ok=True)
        except OSError:
            # Pre-fix, the leaked file handle (Windows locks an open file
            # against deletion) makes even THIS best-effort cleanup fail --
            # that lock is itself part of the reviewer's "5/5 leaks" finding,
            # not a flaw in the teardown. Never let it mask the real
            # assertion failure above with a second, confusing traceback.
            pass
