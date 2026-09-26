"""Wave 8 lane 8C (C4) -- the export-format routes, `api/routers/notebook_export.py`.

Asked of the router over a TestClient with `get_current_user` overridden and the service
database pointed at a temp file (the shape `test_notes_export_route.py` uses for the
Markdown route). What a member sees on the wire: status, the file's name and type, whose
notes are in it, and that the ONE export slot is taken, refused and given back correctly.
"""
from __future__ import annotations

import io
import json
import sqlite3
import threading
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services.journal_two import db as j2db
from api.services.journal_two import notes_export
from api.services.journal_two.notes_export_formats import DOCX_MEDIA_TYPE, UNKNOWN_FORMAT_SENTENCE

STAMP = "2026-09-01T00:00:00Z"


def _note(conn, nid, uid, title, *, deleted=None, text="body"):
    conn.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at, updated_at,"
        " deleted_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (nid, uid, title, json.dumps({"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": text}]}]}),
         text, "[]", STAMP, STAMP, deleted))


@pytest.fixture
def client(monkeypatch, tmp_path):
    from api.middleware.auth_middleware import get_current_user
    from api.routers import journal_two, notebook_export
    from api.services import auth_db

    db_path = str(tmp_path / "export_router.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    _note(conn, "n1", "u1", "Cup and handle")
    _note(conn, "n2", "u2", "Someone else's note")
    _note(conn, "n3", "u1", "In the trash", deleted="2026-09-02T00:00:00Z")
    _note(conn, "n4", "u1", "Plan — NVDA’s reclaim \U0001F680")    # not Latin-1
    conn.commit()
    conn.close()
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(tmp_path / "att"))

    app = FastAPI()
    app.include_router(journal_two.router)
    app.include_router(notebook_export.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1"}
    # A clean slot table for every test: the lease list is module state.
    monkeypatch.setattr(notes_export, "_EXPORT_LEASES", [])
    # ...and so are the single-note slots (I-2).
    monkeypatch.setattr(notebook_export, "_SINGLE_NOTE_SLOTS",
                        threading.BoundedSemaphore(notebook_export.SINGLE_NOTE_CONCURRENCY))
    return TestClient(app)


def _zip(r):
    return zipfile.ZipFile(io.BytesIO(r.content))


@pytest.mark.parametrize("fmt, ext", [("md", ".md"), ("html", ".html"), ("json", ".json"), ("docx", ".docx")])
def test_the_whole_notebook_in_each_format_holds_only_the_callers_active_notes(client, fmt, ext):
    r = client.get(f"/api/j2/export/notebook?format={fmt}")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    assert r.headers["content-disposition"].startswith('attachment; filename="uct-notebook-export-')
    names = _zip(r).namelist()
    assert f"Cup and handle{ext}" in names
    assert not any("Someone else" in n for n in names)       # tenant scope
    assert not any("In the trash" in n for n in names)       # the trash is not the notebook
    manifest = json.loads(_zip(r).read("UCT_NOTEBOOK_EXPORT.json"))
    assert manifest.get("format") == (None if fmt == "md" else fmt)


def test_no_format_is_markdown(client):
    r = client.get("/api/j2/export/notebook")
    assert r.status_code == 200 and "Cup and handle.md" in _zip(r).namelist()


@pytest.mark.parametrize("path", ["/api/j2/export/notebook?format=pdf", "/api/j2/export/notes/n1?format=pdf",
                                  "/api/j2/export/notes/n1?format=word"])
def test_an_unknown_format_is_a_422_with_a_sentence_and_takes_no_slot(client, monkeypatch, path):
    taken = []
    monkeypatch.setattr(notes_export, "acquire_export_slot", lambda: taken.append(1) or True)
    r = client.get(path)
    assert r.status_code == 422
    assert r.json() == {"detail": UNKNOWN_FORMAT_SENTENCE}
    assert taken == []


def test_a_second_export_while_one_runs_is_a_429_with_the_existing_sentence(client, monkeypatch):
    monkeypatch.setattr(notes_export, "acquire_export_slot", lambda: False)
    r = client.get("/api/j2/export/notebook?format=html")
    assert r.status_code == 429
    assert r.json() == {"detail": "An export is already running. Please wait a moment and try again."}


def test_the_slot_is_given_back_when_the_builder_raises(client, monkeypatch):
    released = []
    real_release = notes_export.release_export_slot
    monkeypatch.setattr(notes_export, "release_export_slot", lambda: (released.append(1), real_release()))

    def boom(*a, **k):
        raise RuntimeError("builder failed")

    monkeypatch.setattr(notes_export, "build_export_zip_to_tempfile", boom)
    with pytest.raises(RuntimeError):
        client.get("/api/j2/export/notebook?format=docx")
    assert released == [1]
    assert notes_export._EXPORT_LEASES == []                  # nothing left holding the slot


def test_the_slot_is_given_back_after_a_successful_stream(client, monkeypatch):
    released = []
    real_release = notes_export.release_export_slot
    monkeypatch.setattr(notes_export, "release_export_slot", lambda: (released.append(1), real_release()))
    r = client.get("/api/j2/export/notebook?format=json")
    assert r.status_code == 200
    assert released == [1] and notes_export._EXPORT_LEASES == []


@pytest.mark.parametrize("fmt, media, ext", [
    ("html", "text/html; charset=utf-8", ".html"), ("json", "application/json", ".json"),
    ("docx", DOCX_MEDIA_TYPE, ".docx"),
])
def test_one_note_in_each_format(client, fmt, media, ext):
    r = client.get(f"/api/j2/export/notes/n1?format={fmt}")
    assert r.status_code == 200
    assert r.headers["content-type"] == media
    assert f'filename="Cup and handle-' in r.headers["content-disposition"]
    assert r.headers["content-disposition"].split(";")[1].strip().endswith(f'{ext}"')


@pytest.mark.parametrize("nid", ["n2", "n3", "nope"])
def test_a_foreign_trashed_or_missing_note_is_404_in_every_format(client, nid):
    for fmt in ("md", "html", "json", "docx"):
        r = client.get(f"/api/j2/export/notes/{nid}?format={fmt}")
        assert r.status_code == 404, (nid, fmt)
        assert r.json() == {"detail": "Not found"}


def test_markdown_through_the_new_door_is_byte_identical_to_the_old_door(client):
    old = client.get("/api/j2/notes/n1/export")
    new = client.get("/api/j2/export/notes/n1?format=md")
    assert old.status_code == new.status_code == 200
    assert new.content == old.content
    assert new.headers["content-type"] == old.headers["content-type"]


def test_a_title_outside_latin_1_downloads_with_its_real_name(client):
    for fmt in ("md", "html", "docx"):
        r = client.get(f"/api/j2/export/notes/n4?format={fmt}")
        assert r.status_code == 200, fmt
        cd = r.headers["content-disposition"]
        assert "filename*=UTF-8''Plan%20%E2%80%94%20NVDA%E2%80%99s%20reclaim%20%F0%9F%9A%80" in cd, cd
        assert 'filename="Plan _ NVDA_s reclaim _-' in cd, cd     # the ASCII fallback


def test_the_routes_are_mounted_on_the_real_app_exactly_once():
    from api.main import app

    seen = [(tuple(sorted(r.methods)), r.path) for r in app.router.routes
            if getattr(r, "path", "").startswith("/api/j2/export/")]
    assert seen.count((("GET",), "/api/j2/export/notebook")) == 1
    assert seen.count((("GET",), "/api/j2/export/notes/{note_id}")) == 1


# ── I-2: the single-note door is bounded in concurrency (wave-8 final review) ───────────
#
# "Bounded by one note" bounds ONE build. The formats ship ungated (D-C5), a Word build
# decodes images and holds its embedded blobs until the document is zipped, and the door took
# no slot at all -- so nothing bounded how many ran at once on a single-process pod.

BUSY = "An export is already running. Please wait a moment and try again."


def _hold_all_slots():
    from api.routers import notebook_export
    for _ in range(notebook_export.SINGLE_NOTE_CONCURRENCY):
        assert notebook_export._SINGLE_NOTE_SLOTS.acquire(blocking=False)


def _free_all_slots():
    from api.routers import notebook_export
    for _ in range(notebook_export.SINGLE_NOTE_CONCURRENCY):
        notebook_export._SINGLE_NOTE_SLOTS.release()


def test_I2_the_single_note_door_is_bounded_one_more_build_is_a_429_and_never_runs(client, monkeypatch):
    """Every slot held by builds in flight: one more request is refused with the export
    slot's own sentence and never reaches the builder; a slot coming back serves it."""
    from api.routers import notebook_export
    assert 1 <= notebook_export.SINGLE_NOTE_CONCURRENCY <= 4, "a SMALL bound"
    built = []
    real = notes_export.build_single_note_export
    monkeypatch.setattr(notes_export, "build_single_note_export",
                        lambda *a, **k: built.append(k.get("fmt")) or real(*a, **k))
    _hold_all_slots()
    try:
        for fmt in ("docx", "md", "html", "json"):
            r = client.get(f"/api/j2/export/notes/n1?format={fmt}")
            assert r.status_code == 429 and r.json() == {"detail": BUSY}, (fmt, r.status_code, r.text)
        assert built == [], "a refused request reached the builder"
    finally:
        _free_all_slots()
    r = client.get("/api/j2/export/notes/n1?format=docx")
    assert r.status_code == 200 and built == ["docx"]


def test_I2_concurrent_builds_beyond_the_bound_are_refused(client, monkeypatch):
    """Real concurrency: the builds that got a slot are held INSIDE the builder; the next
    request is a 429 while they run, and all of them finish once released."""
    from api.routers import notebook_export
    n = notebook_export.SINGLE_NOTE_CONCURRENCY
    # The fixture creates this database in rollback-journal mode, and every
    # `auth_db.get_connection()` issues `PRAGMA journal_mode=WAL`, which needs the database to
    # itself: two builds converting it at once can meet "database is locked". One build
    # first converts it (WAL persists), so the concurrent part measures the SLOTS only.
    assert client.get("/api/j2/export/notes/n1?format=docx").status_code == 200
    inside = threading.Semaphore(0)
    release = threading.Event()
    real = notes_export.build_single_note_export

    def held(*a, **k):
        inside.release()
        assert release.wait(timeout=20)
        return real(*a, **k)

    monkeypatch.setattr(notes_export, "build_single_note_export", held)
    results: list[int] = []
    threads = [threading.Thread(target=lambda: results.append(
        client.get("/api/j2/export/notes/n1?format=docx").status_code)) for _ in range(n)]
    for t in threads:
        t.start()
    for _ in range(n):
        assert inside.acquire(timeout=20), "a build never started"
    try:
        extra = client.get("/api/j2/export/notes/n1?format=docx")
        assert extra.status_code == 429 and extra.json() == {"detail": BUSY}
    finally:
        release.set()
        for t in threads:
            t.join(timeout=30)
    assert results == [200] * n, results
    assert client.get("/api/j2/export/notes/n1?format=docx").status_code == 200    # all slots back


def test_I2_a_build_that_raises_gives_its_slot_back(client, monkeypatch):
    """More failing builds than there are slots: each one gave its slot back, or the next
    would be a 429 instead of the builder's own error -- and a real build still runs."""
    from api.routers import notebook_export
    real = notes_export.build_single_note_export

    def boom(*a, **k):
        raise RuntimeError("builder failed")

    monkeypatch.setattr(notes_export, "build_single_note_export", boom)
    for _ in range(notebook_export.SINGLE_NOTE_CONCURRENCY + 1):
        with pytest.raises(RuntimeError):
            client.get("/api/j2/export/notes/n1?format=docx")
    monkeypatch.setattr(notes_export, "build_single_note_export", real)
    assert client.get("/api/j2/export/notes/n1?format=docx").status_code == 200


def test_I2_an_unknown_format_and_a_missing_note_take_no_single_note_slot(client):
    _hold_all_slots()
    try:
        r = client.get("/api/j2/export/notes/n1?format=pdf")
        assert r.status_code == 422 and r.json() == {"detail": UNKNOWN_FORMAT_SENTENCE}   # decided first
    finally:
        _free_all_slots()
    for _ in range(3):
        assert client.get("/api/j2/export/notes/nope?format=docx").status_code == 404
    assert client.get("/api/j2/export/notes/n1?format=docx").status_code == 200        # none leaked
