"""Route-level rail for GET /api/j2/notes/export (Task 8).

Mirrors test_export.py's `route_client` fixture (the sibling `/trades/export`
route test) -- the observable here is the DOWNLOAD RESPONSE itself: status,
Content-Type, Content-Disposition, auth enforcement, and that the response is
scoped to the caller's own notes. `build_export_zip` already has its own
thorough unit coverage in test_notes_export.py; this file only proves the
route wires it up correctly.
"""
import gc
import io
import os
import sqlite3
import tempfile
import time
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


# ── Wave C: single-note export route ─────────────────────────────────────────
# build_single_note_export itself has thorough unit coverage in
# test_notes_export.py; this only proves the route wires it up correctly.


def test_single_note_export_returns_a_markdown_attachment(route_client):
    r = route_client.get("/api/j2/notes/n1/export")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    cd = r.headers["content-disposition"]
    assert cd.startswith("attachment; filename=")
    assert cd.endswith('.md"')
    assert b"Cup and handle" in r.content


def test_single_note_export_404s_for_a_nonexistent_note(route_client):
    r = route_client.get("/api/j2/notes/does-not-exist/export")
    assert r.status_code == 404


def test_single_note_export_404s_for_another_users_note(route_client):
    """n2 belongs to u2; the route caller is u1 -- must 404, never leak
    another member's note through a guessed id."""
    r = route_client.get("/api/j2/notes/n2/export")
    assert r.status_code == 404


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


# ── Disconnect-cancellation leak (adversarial audit, CRITICAL) ───────────────
#
# The test this replaced cancelled INSIDE `agen.__anext__()` via a bare
# `anyio.CancelScope` -- a shape a real client can never produce. Starlette's
# `StreamingResponse.__call__` (starlette/responses.py) races two tasks: the
# body-streaming loop and a `listen_for_disconnect()` loop polling `receive()`
# for `{"type": "http.disconnect"}`; whichever finishes first cancels the
# other's cancel scope. On a real disconnect, the streaming task is almost
# always cancelled while it is suspended INSIDE `await send(...)` (mid
# backpressure) -- never while awaiting `agen.__anext__()` itself, because
# `send()` is called from OUTSIDE the generator, in `stream_response()`'s own
# frame. That means our generator is left parked at its `yield`, and nothing
# ever throws into it -- `stream_export_file`'s `finally`, shield included,
# is simply never entered. The old test's cancel-inside-`__anext__` shape
# instead delivers the cancellation FROM INSIDE the generator, which the
# shield genuinely protects against -- so that test could pass while the real
# bug (this section) still leaked on every real disconnect. A rail that
# proves a shape reality cannot produce is worse than no rail: it reads as
# coverage. `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`.
#
# Both tests below drive the REAL `starlette.responses.StreamingResponse`
# with a `receive()` that emits `http.disconnect` -- the only honest
# reproduction, because that message is literally what Starlette turns a
# socket disconnect into.


class _FakeMonotonic:
    """Deterministic stand-in for `time.monotonic()`, swapped in for
    `notes_export.time` (notes_export's ONLY use of the `time` module is
    `time.monotonic()` in `acquire_export_slot`) so a lease TTL can be
    proven to expire without a real sleep."""

    def __init__(self, start: float = 0.0):
        self._now = start

    def monotonic(self) -> float:
        return self._now

    def advance(self, secs: float) -> None:
        self._now += secs


async def _drive_disconnect_after_first_chunk(agen):
    """Feeds `agen` through the real `StreamingResponse.__call__` and forces
    a disconnect immediately after the first chunk is handed to `send()` --
    the realistic case (audit: "client takes a chunk, then disconnects
    mid-stream"). `send()` blocking on the chunk (rather than returning) is
    what a real zero-buffer ASGI transport does under backpressure; it is
    also the ONLY way to guarantee the cancellation below lands inside
    `send()` and not inside the generator, matching the audit's finding that
    a real disconnect never reaches `agen.__anext__()` directly."""
    from starlette.responses import StreamingResponse

    response = StreamingResponse(agen, media_type="application/zip")
    first_chunk_sent = anyio.Event()

    async def receive():
        await first_chunk_sent.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        if message["type"] == "http.response.body" and message.get("body"):
            first_chunk_sent.set()
            await anyio.sleep_forever()

    scope = {"type": "http", "method": "GET", "path": "/x", "headers": []}
    await response(scope, receive, send)  # returns normally -- the
    # cancellation above is absorbed inside StreamingResponse's own task
    # group, exactly as it is on a real Starlette request.


async def test_disconnect_mid_stream_leaves_the_slot_held_until_self_heal_reclaims_it(
    tmp_path, monkeypatch,
):
    """Must go RED against the pre-fix code (verified by reverting the fix --
    see the report): a real mid-stream disconnect leaves BOTH the temp file
    and the concurrency slot held immediately afterward (the audit's measured
    `slots_free() == 0`), with nothing that ever explicitly releases it. The
    fix does not make that instant leak disappear -- it cannot, since the
    generator's cleanup genuinely never runs on this path -- it bounds it: a
    lease TTL reclaims the slot on its own, verified here with NO explicit
    release call anywhere in this test."""
    from api.services.journal_two import notes_export

    clock = _FakeMonotonic()
    monkeypatch.setattr(notes_export, "time", clock, raising=False)
    monkeypatch.setenv("NOTE_EXPORT_LEASE_TTL_SECONDS", "60")

    path = tmp_path / "disconnect-mid-stream.zip"
    path.write_bytes(b"x" * (2 * notes_export._EXPORT_STREAM_CHUNK_BYTES))

    assert notes_export.acquire_export_slot()
    agen = notes_export.stream_export_file(path)
    await _drive_disconnect_after_first_chunk(agen)

    assert path.exists(), (
        "test setup drifted -- the file should still be on disk immediately "
        "after a disconnect that never enters stream_export_file's finally"
    )
    assert not notes_export.acquire_export_slot(), (
        "the slot should still read as HELD immediately after the "
        "disconnect -- this is the audit's measured slots_free() == 0, not "
        "something this fix can or should make instantaneous"
    )

    # Self-heal: advance past the lease TTL with NOTHING having explicitly
    # released the slot (the generator is still parked at its yield, never
    # resumed, never garbage-collected in this test).
    clock.advance(61)
    assert notes_export.acquire_export_slot(), (
        "the slot never came back on its own -- a self-healing lease is the "
        "whole point of this fix; without it this is the original bug, "
        "wedged until an operator redeploys the pod"
    )
    notes_export.release_export_slot()

    try:
        path.unlink(missing_ok=True)
    except OSError:
        # The leaked file handle (Windows locks an open file against
        # deletion) is part of the measured defect, not a flaw in this
        # teardown -- never let it mask the assertions above.
        pass


async def test_disconnect_before_first_chunk_leaves_the_slot_held_until_self_heal_reclaims_it(
    tmp_path, monkeypatch,
):
    """The other reproduced shape: cancellation lands before the generator's
    first `__anext__` (e.g. the request is torn down while
    `build_export_zip_to_tempfile` still runs in the threadpool, before any
    `StreamingResponse` exists). Modeled directly and honestly: the generator
    is created and then closed without ever being iterated -- `aclose()` on
    a never-started async generator is a documented Python no-op, so nothing
    in `stream_export_file`, including its `finally`, ever runs. Per the
    audit this variant is PERMANENT pre-fix (survives 5x `gc.collect()`); the
    self-healing lease is the only thing that ever recovers it."""
    from api.services.journal_two import notes_export

    clock = _FakeMonotonic()
    monkeypatch.setattr(notes_export, "time", clock, raising=False)
    monkeypatch.setenv("NOTE_EXPORT_LEASE_TTL_SECONDS", "60")

    path = tmp_path / "disconnect-before-first-chunk.zip"
    path.write_bytes(b"y" * 128)

    assert notes_export.acquire_export_slot()
    agen = notes_export.stream_export_file(path)
    await agen.aclose()  # never call __anext__ -- the request never started
    del agen
    for _ in range(5):
        gc.collect()

    assert not notes_export.acquire_export_slot(), (
        "the slot should still read as HELD -- aclose() on a never-started "
        "generator runs none of its body, including the finally that would "
        "release it, and 5x gc.collect() does not change that"
    )

    clock.advance(61)
    assert notes_export.acquire_export_slot(), (
        "the slot never came back on its own -- pre-fix this variant is "
        "PERMANENT (no gc pass, no amount of waiting, ever frees it); the "
        "self-healing lease is what turns it into a bounded, operator-"
        "invisible recovery instead"
    )
    notes_export.release_export_slot()

    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


# ── Lease retirement order ───────────────────────────────────────────────────
# The self-healing lease (A3 corrective) made the slot recoverable, but left
# `release_export_slot()` retiring the NEWEST lease (`list.pop()`). Leases are
# fungible only for COUNTING; for EXPIRY they are not, and the direction
# matters. Retiring the newest keeps the SHORTEST-lived entry behind, so every
# still-running export ends up represented by a lease that expires before its
# own would have -- and the reclaim then frees a slot while its export is
# still streaming. Retiring the SOONEST-expiring entry is the safe direction:
# whatever is still running is always covered by a lease at least as long as
# its own.
#
# Invisible at the default limit of 1 (one lease at a time), which is exactly
# why it needs a rail: `NOTE_EXPORT_MAX_CONCURRENT` exists to be raised.


@pytest.fixture(autouse=True)
def _clear_export_leases():
    """Lease state is module-global. Every test here happened to release what
    it acquired, so the file was independent by luck rather than by design;
    one early return would have leaked a lease into every later test."""
    from api.services.journal_two import notes_export

    notes_export._EXPORT_LEASES.clear()
    yield
    notes_export._EXPORT_LEASES.clear()


def test_releasing_one_of_two_slots_retires_the_soonest_expiring_lease(
    monkeypatch,
):
    """A release must never shorten the cover of an export still streaming."""
    from api.services.journal_two import notes_export

    clock = _FakeMonotonic()
    monkeypatch.setattr(notes_export, "time", clock, raising=False)
    monkeypatch.setenv("NOTE_EXPORT_MAX_CONCURRENT", "2")
    monkeypatch.setenv("NOTE_EXPORT_LEASE_TTL_SECONDS", "1000")

    assert notes_export.acquire_export_slot()      # export A, expires t=1000
    clock.advance(100)
    assert notes_export.acquire_export_slot()      # export B, expires t=1100

    # A finishes and releases; B is still streaming.
    notes_export.release_export_slot()

    assert notes_export._EXPORT_LEASES == [1100.0], (
        "release retired the wrong lease: the entry left behind must be the "
        "LONGEST-lived one, since the export still running is covered by it. "
        f"got {notes_export._EXPORT_LEASES!r}"
    )

    # The consequence, stated on observable behaviour rather than internals:
    # at t=1001 the retired lease's expiry has passed but B's has not, so
    # exactly ONE of the two slots may be handed out.
    clock.advance(901)                             # now t=1001
    assert notes_export.acquire_export_slot(), (
        "the free slot should still be available -- A really did finish"
    )
    assert not notes_export.acquire_export_slot(), (
        "B's slot was reclaimed while B is still streaming: the limit of 2 "
        "is now serving 3 concurrent exports on a single-replica pod with "
        "OOM history, which is the failure the limit exists to prevent"
    )


# ── Abandoned temp archives ──────────────────────────────────────────────────
# The slot self-heals; the FILE did not. `build_export_zip_to_tempfile`
# mkstemp's a zip, and only `stream_export_file`'s finally deletes it -- the
# finally the audit proved never runs on a real disconnect. So every cancelled
# download left its archive behind until the next redeploy, and a member's
# library can be hundreds of MB. Same self-heal idiom as the lease: swept on
# next demand, no background thread.


def test_acquire_sweeps_abandoned_export_archives(monkeypatch, tmp_path):
    from api.services.journal_two import notes_export

    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path), raising=False)
    monkeypatch.setenv("NOTE_EXPORT_LEASE_TTL_SECONDS", "1000")

    stale = tmp_path / "j2-notes-export-abandoned.zip"
    stale.write_bytes(b"PK\x05\x06" + b"\0" * 18)
    os.utime(stale, (0, time.time() - 5000))       # long past the TTL

    fresh = tmp_path / "j2-notes-export-inflight.zip"
    fresh.write_bytes(b"PK\x05\x06" + b"\0" * 18)  # mtime = now

    unrelated = tmp_path / "someone-elses-file.zip"
    unrelated.write_bytes(b"PK\x05\x06" + b"\0" * 18)
    os.utime(unrelated, (0, time.time() - 5000))

    assert notes_export.acquire_export_slot()
    notes_export.release_export_slot()

    assert not stale.exists(), (
        "an export archive abandoned by a disconnect was never swept -- it "
        "sits on the pod's disk until the next redeploy"
    )
    assert fresh.exists(), (
        "the sweep took an archive that is still being streamed; only "
        "entries older than the lease TTL may be reclaimed"
    )
    assert unrelated.exists(), (
        "the sweep reached beyond our own mkstemp prefix -- it must never "
        "delete a file this module did not create"
    )
