"""OI-P3b-13 -- `GET /api/j2/notes?excludeSample=1` leaves the sample notebook's notes out.

The example picker (`lib/styleLibrary.js::exampleCandidatesKey`) reads the shared notes list,
and a list row cannot say whether a note is a sample one -- so a member who added the sample
was offered its notes, and picking one got the refusal sentence. The param is OPT-IN and
ADDITIVE: a request that omits it gets exactly the answer it got before.

Same standalone-FastAPI-app + temp-auth.db pattern as test_journal_two_properties_router.py.
"""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services.journal_two import sample_marker

U = "u-oi-p3b-13"


@pytest.fixture
def client(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": U, "role": "member"}
    yield TestClient(fa)
    fa.dependency_overrides.clear()
    os.unlink(tmp.name)


def _note(client, title):
    r = client.post("/api/j2/notes", json={"title": title})
    assert r.status_code == 200
    return r.json()["note"]["id"]


def _mark_sample(note_id):
    from api.services.journal_two import notes
    c = notes.get_connection()
    try:
        c.execute("UPDATE j2_notes SET import_source = ? WHERE id = ?", (sample_marker.SAMPLE_SOURCE, note_id))
        c.commit()
    finally:
        c.close()


@pytest.fixture
def two_notes(client):
    real = _note(client, "My own plan")
    sample = _note(client, "Sample plan")
    _mark_sample(sample)
    return real, sample


def _ids(r):
    assert r.status_code == 200, r.text
    return {n["id"] for n in r.json()["notes"]}


def test_control_without_the_param_the_sample_note_IS_listed(client, two_notes):
    # Non-vacuity: the seeded sample note really is in the list the picker used to read,
    # so its absence below is the param's doing, not a fixture that never listed it.
    real, sample = two_notes
    r = client.get("/api/j2/notes")
    assert _ids(r) == {real, sample}
    assert r.json()["total"] == 2


def test_excludeSample_leaves_the_sample_note_out_of_the_page_and_its_total(client, two_notes):
    real, sample = two_notes
    r = client.get("/api/j2/notes?excludeSample=1")
    assert _ids(r) == {real}
    assert r.json()["total"] == 1


def test_the_picker_shape_with_excludeSample_leaves_it_out(client, two_notes):
    # The exact query the example picker sends, minus the kind filter (no kind is set here).
    real, _ = two_notes
    r = client.get("/api/j2/notes?sort=created&limit=200&excludeSample=1")
    assert _ids(r) == {real}


def test_omitting_the_param_answers_byte_identically_to_excludeSample_0(client, two_notes):
    # Opt-in and additive: callers that omit it get the same response as an explicit false.
    a = client.get("/api/j2/notes")
    b = client.get("/api/j2/notes?excludeSample=0")
    assert a.status_code == b.status_code == 200
    assert a.content == b.content
    assert set(a.json()) == {"notes", "total", "limit", "offset"}


def test_the_service_predicate_adds_nothing_when_off():
    # The WHERE text for an ordinary list is unchanged by the new parameter.
    from api.services.journal_two import notes
    off, _ = notes._notes_filter_sql("u")
    on, _ = notes._notes_filter_sql("u", exclude_sample=True)
    assert "import_source" not in off
    assert sample_marker.not_sample_sql() in on
