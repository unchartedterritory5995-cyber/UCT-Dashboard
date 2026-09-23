"""The command palette's quick switcher — GET /api/j2/notes/switcher.

Title search over the member's WHOLE library (the palette used to reach only
favourites and recents). Same standalone-FastAPI-app + temp-auth.db pattern as
tests/test_journal_two_notes_favorites_recents_router.py.

What each test pins, because a switcher that "returns something" can still be
wrong in every way that matters:
  * auth + ownership — another member's titles never appear;
  * trash — a note that cannot be opened is never offered;
  * the ranking tiers, one test per boundary, so reordering any two tiers reds
    a named test rather than a vague "order changed";
  * the recents boost is INSIDE a tier, never across one;
  * `%` / `_` in the query are text, not wildcards;
  * folder / ticker context and the limit/hasMore contract.
"""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def app(db_path):
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _login_as(app, user_id):
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": user_id, "role": "member"}


def _note(client, title, **extra):
    r = client.post("/api/j2/notes", json={"title": title, **extra})
    assert r.status_code == 200, r.text
    return r.json()["note"]["id"]


def _search(client, q, **params):
    r = client.get("/api/j2/notes/switcher", params={"q": q, **params})
    assert r.status_code == 200, r.text
    return r.json()


def _titles(body):
    return [n["title"] for n in body["notes"]]


# ── auth + ownership ─────────────────────────────────────────────────────────

def test_requires_a_signed_in_member(client):
    # No dependency override: the real cookie check runs and refuses.
    r = client.get("/api/j2/notes/switcher", params={"q": "x"})
    assert r.status_code == 401


def test_never_offers_another_members_notes(app, client):
    _login_as(app, "owner")
    _note(client, "Semis thesis")
    _login_as(app, "intruder")
    _note(client, "Semis — my own")
    body = _search(client, "semis")
    assert _titles(body) == ["Semis — my own"]


def test_a_trashed_note_is_never_offered(app, client):
    _login_as(app, "u1")
    keep = _note(client, "Energy plan")
    gone = _note(client, "Energy old")
    assert client.delete(f"/api/j2/notes/{gone}").status_code == 200
    body = _search(client, "energy")
    assert [n["id"] for n in body["notes"]] == [keep]


def test_blank_query_is_an_empty_answer_not_an_error(app, client):
    _login_as(app, "u1")
    _note(client, "Anything")
    assert _search(client, "") == {"notes": [], "hasMore": False}
    assert _search(client, "   ") == {"notes": [], "hasMore": False}


# ── ranking tiers ────────────────────────────────────────────────────────────

def test_exact_title_beats_prefix(app, client):
    _login_as(app, "u1")
    _note(client, "Semis outlook")
    _note(client, "Semis")
    body = _search(client, "semis")
    assert _titles(body) == ["Semis", "Semis outlook"]
    assert [n["matchTier"] for n in body["notes"]] == [0, 1]


def test_prefix_beats_word_start(app, client):
    _login_as(app, "u1")
    _note(client, "The semis rotation")
    _note(client, "Semis rotation")
    assert _titles(_search(client, "semis")) == ["Semis rotation", "The semis rotation"]


def test_word_start_beats_substring(app, client):
    _login_as(app, "u1")
    _note(client, "Antisemis note")      # substring only
    _note(client, "Big semis week")      # a word starts with it
    body = _search(client, "semis")
    assert _titles(body) == ["Big semis week", "Antisemis note"]
    assert [n["matchTier"] for n in body["notes"]] == [2, 4]


def test_a_word_break_character_starts_a_word(app, client):
    _login_as(app, "u1")
    _note(client, "NVDA-Q3 earnings")
    _note(client, "Aq3 misc")            # substring only
    body = _search(client, "q3")
    assert _titles(body) == ["NVDA-Q3 earnings", "Aq3 misc"]


def test_every_typed_word_must_appear(app, client):
    _login_as(app, "u1")
    _note(client, "Q3 NVDA thesis")
    _note(client, "Q3 AMD thesis")
    body = _search(client, "nvda thesis")
    assert _titles(body) == ["Q3 NVDA thesis"]


def test_all_words_starting_beats_words_only_contained(app, client):
    _login_as(app, "u1")
    _note(client, "Xnvda Xthesis")       # both words present, neither starts a word
    _note(client, "Thesis for NVDA")     # both words start title words
    body = _search(client, "nvda thesis")
    assert _titles(body) == ["Thesis for NVDA", "Xnvda Xthesis"]
    assert [n["matchTier"] for n in body["notes"]] == [3, 5]


def test_percent_and_underscore_are_text_not_wildcards(app, client):
    _login_as(app, "u1")
    _note(client, "q3_plan")
    _note(client, "q3Xplan")
    assert _titles(_search(client, "q3_plan")) == ["q3_plan"]
    _note(client, "50% position")
    _note(client, "50X position")
    assert _titles(_search(client, "50%")) == ["50% position"]


def test_matching_is_case_insensitive(app, client):
    _login_as(app, "u1")
    _note(client, "NVDA Thesis")
    assert _titles(_search(client, "nvda THESIS")) == ["NVDA Thesis"]


# ── recents / favourites boost inside a tier ────────────────────────────────

def test_a_recently_opened_note_leads_its_tier(app, client):
    _login_as(app, "u1")
    older = _note(client, "Macro weekly A")
    _note(client, "Macro weekly B")      # edited more recently
    assert client.post(f"/api/j2/notes/{older}/opened").status_code == 200
    body = _search(client, "macro")
    assert _titles(body) == ["Macro weekly A", "Macro weekly B"]
    assert body["notes"][0]["isRecent"] is True
    assert body["notes"][1]["isRecent"] is False


def test_the_recents_boost_never_crosses_a_tier(app, client):
    _login_as(app, "u1")
    opened = _note(client, "Old macro notes")   # word-start tier
    _note(client, "Macro")                      # exact
    assert client.post(f"/api/j2/notes/{opened}/opened").status_code == 200
    assert _titles(_search(client, "macro")) == ["Macro", "Old macro notes"]


def test_a_favourite_leads_equal_non_favourites(app, client):
    _login_as(app, "u1")
    fav = _note(client, "Rates A")
    _note(client, "Rates B")
    assert client.post(f"/api/j2/notes/{fav}/favorite").status_code == 200
    body = _search(client, "rates")
    assert _titles(body) == ["Rates A", "Rates B"]
    assert body["notes"][0]["isFavorite"] is True


# ── context + limits ────────────────────────────────────────────────────────

def test_rows_carry_folder_path_and_ticker(app, client):
    _login_as(app, "u1")
    parent = client.post("/api/j2/note-folders", json={"name": "Research"}).json()["folder"]["id"]
    child = client.post("/api/j2/note-folders",
                        json={"name": "Semis", "parentId": parent}).json()["folder"]["id"]
    _note(client, "NVDA supply chain", folderId=child, ticker="NVDA")
    _note(client, "NVDA unfiled")
    body = _search(client, "nvda")
    rows = {n["title"]: n for n in body["notes"]}
    assert rows["NVDA supply chain"]["folderPath"] == "Research / Semis"
    assert rows["NVDA supply chain"]["ticker"] == "NVDA"
    assert rows["NVDA unfiled"]["folderPath"] is None
    assert rows["NVDA unfiled"]["folderId"] is None


def test_limit_and_has_more(app, client):
    _login_as(app, "u1")
    for i in range(5):
        _note(client, f"Journal {i}")
    body = _search(client, "journal", limit=3)
    assert len(body["notes"]) == 3
    assert body["hasMore"] is True
    body = _search(client, "journal", limit=5)
    assert len(body["notes"]) == 5
    assert body["hasMore"] is False


def test_limit_is_clamped(app, client):
    _login_as(app, "u1")
    for i in range(3):
        _note(client, f"Clamp {i}")
    assert len(_search(client, "clamp", limit=0)["notes"]) == 3   # 0 falls back to the default
    assert len(_search(client, "clamp", limit=10_000)["notes"]) == 3
