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
