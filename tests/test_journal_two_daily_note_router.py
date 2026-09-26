"""Daily note — wave 6, lane E, item 4.

What these pin:
  * `POST /api/j2/notes/daily {date}` opens the member's note for that ET date
    (the client sends `todayET()`), creating it the first time: titled
    `YYYY-MM-DD · Weekday`, in a root `Daily` folder created on first use;
  * ⛔⛔ EXACTLY ONE PER MEMBER PER DAY, ENFORCED SERVER-SIDE: a unique index on
    `(user_id, daily_date)`, so the database refuses a second note for a day even
    if two requests race past every check — and two tabs pressing Today at once
    still produce one note (and one Daily folder);
  * the date is strict (`YYYY-MM-DD`, a real day);
  * a trashed daily note gives up its day: Today makes a fresh one, and the old
    one, restored, is an ordinary note — never a second note for that day;
  * the member's daily template (a preference the client sends as `templateId`)
    seeds body + properties at creation only; a template deleted since yields a
    plain daily note and says so (`templateMissing`), because Today must work.
"""
from __future__ import annotations

import importlib
import os
import sqlite3
import tempfile
import threading

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


def _today(client, date="2026-09-24", **extra):
    return client.post("/api/j2/notes/daily", json={"date": date, **extra})


def _folders(client):
    return client.get("/api/j2/note-folders").json()["folders"]


def _doc(text):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def test_today_creates_the_days_note_in_a_daily_folder(app, client):
    _login_as(app, "u1")
    r = _today(client)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] is True
    note = body["note"]
    assert note["title"] == "2026-09-24 · Thursday"
    assert note["dailyDate"] == "2026-09-24"
    daily = [f for f in _folders(client) if f["name"] == "Daily"]
    assert len(daily) == 1 and daily[0]["parentId"] is None
    assert note["folderId"] == daily[0]["id"]


def test_today_again_opens_the_same_note(app, client):
    _login_as(app, "u1")
    first = _today(client).json()["note"]
    again = _today(client).json()
    assert again["created"] is False
    assert again["note"]["id"] == first["id"]
    assert again["note"]["updatedAt"] == first["updatedAt"], "opening is not a write"


def test_another_day_is_another_note_in_the_same_folder(app, client):
    _login_as(app, "u1")
    a = _today(client, "2026-09-24").json()["note"]
    b = _today(client, "2026-09-25").json()["note"]
    assert b["id"] != a["id"]
    assert b["title"] == "2026-09-25 · Friday"
    assert b["folderId"] == a["folderId"]
    assert len([f for f in _folders(client) if f["name"] == "Daily"]) == 1


@pytest.mark.parametrize("bad", ["2026-02-30", "2026-9-24", "24/09/2026", "", None, 20260924, "2026-09-24T10:00"])
def test_the_date_is_strict(app, client, bad):
    _login_as(app, "u1")
    assert client.post("/api/j2/notes/daily", json={"date": bad}).status_code == 400


def test_the_database_itself_refuses_a_second_note_for_a_day(app, client):
    # ⛔ The guarantee is the INDEX, not the check before it: bypass the route.
    from api.services.journal_two import notes as notes_service
    notes_service.create_note("u1", {"title": "one"}, daily_date="2026-09-24")
    with pytest.raises(sqlite3.IntegrityError):
        notes_service.create_note("u1", {"title": "two"}, daily_date="2026-09-24")
    # …per member: another member's same day is theirs.
    notes_service.create_note("u2", {"title": "theirs"}, daily_date="2026-09-24")


def test_two_tabs_pressing_today_at_once_make_one_note(app, client, monkeypatch):
    # ⛔ A REAL race, FORCED: both requests pass the "is there a note yet?" read
    # before either writes (a barrier inside that read). From there only the
    # unique index — and the catch that answers the loser with the winner's
    # note — can keep it to one. (A first version raced two TestClient threads
    # and never actually raced: removing every guard left it green.)
    from api.services.journal_two import note_daily
    from api.services.journal_two import notes as notes_service
    real = notes_service.find_daily_note_id
    barrier = threading.Barrier(2, timeout=10)
    seen, lock = set(), threading.Lock()

    def racing_find(user_id, day, conn):
        got = real(user_id, day, conn)
        with lock:
            first = threading.get_ident() not in seen
            seen.add(threading.get_ident())
        if first:
            barrier.wait()  # both have read "no note yet" before either writes
        return got

    monkeypatch.setattr(notes_service, "find_daily_note_id", racing_find)
    results, errors = [], []

    def press():
        try:
            results.append(note_daily.open_daily_note("u1", "2026-09-24"))
        except Exception as e:  # noqa: BLE001 -- the rail reports it
            errors.append(e)

    threads = [threading.Thread(target=press) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert len(results) == 2
    assert len({r["note"]["id"] for r in results}) == 1
    assert sum(1 for r in results if r["created"]) == 1
    _login_as(app, "u1")
    daily = [f for f in _folders(client) if f["name"] == "Daily"]
    assert len(daily) == 1
    listed = client.get("/api/j2/notes", params={"folder_id": daily[0]["id"]}).json()
    assert listed["total"] == 1


def test_a_trashed_daily_note_gives_up_its_day(app, client):
    _login_as(app, "u1")
    old = _today(client).json()["note"]
    client.put(f"/api/j2/notes/{old['id']}", json={"bodyJson": _doc("old words")})
    assert client.delete(f"/api/j2/notes/{old['id']}").status_code == 200
    fresh = _today(client).json()
    assert fresh["created"] is True
    assert fresh["note"]["id"] != old["id"]
    # Restored, the old note is an ordinary note — never a second one for the day.
    restored = client.post(f"/api/j2/notes/{old['id']}/restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["note"]["dailyDate"] is None
    assert _today(client).json()["note"]["id"] == fresh["note"]["id"]


def test_an_archived_daily_note_still_opens(app, client):
    _login_as(app, "u1")
    n = _today(client).json()["note"]
    client.patch(f"/api/j2/notes/{n['id']}/archive", json={"archived": True})
    again = _today(client).json()
    assert again["created"] is False and again["note"]["id"] == n["id"]


def test_the_daily_template_seeds_body_and_properties_at_creation_only(app, client):
    _login_as(app, "u1")
    src = client.post("/api/j2/notes", json={"title": "Daily plan", "bodyJson": _doc("Plan: ")}).json()["note"]
    client.put(f"/api/j2/notes/{src['id']}", json={"properties": {"builtin:confidence": "high"}})
    tid = client.post("/api/j2/note-templates", json={"noteId": src["id"], "name": "Day"}).json()["template"]["id"]
    body = _today(client, templateId=tid).json()
    assert body["created"] is True and body["templateMissing"] is False
    note = body["note"]
    assert note["title"] == "2026-09-24 · Thursday", "the day's title, not the template's"
    assert note["bodyJson"] == _doc("Plan: ")
    assert note["propertiesJson"] == {"builtin:confidence": "high"}
    # Opening it again never re-applies the template over the member's words.
    client.put(f"/api/j2/notes/{note['id']}", json={"bodyJson": _doc("Plan: NVDA")})
    again = _today(client, templateId=tid).json()["note"]
    assert again["bodyJson"] == _doc("Plan: NVDA")


def test_a_missing_template_still_makes_the_days_note_and_says_so(app, client):
    _login_as(app, "u1")
    body = _today(client, templateId="gone").json()
    assert body["created"] is True
    assert body["templateMissing"] is True
    assert body["note"]["title"] == "2026-09-24 · Thursday"


def test_a_member_made_daily_folder_is_used(app, client):
    _login_as(app, "u1")
    mine = client.post("/api/j2/note-folders", json={"name": "Daily"}).json()["folder"]["id"]
    assert _today(client).json()["note"]["folderId"] == mine
    assert len([f for f in _folders(client) if f["name"] == "Daily"]) == 1


def test_each_member_has_their_own_day(app, client):
    _login_as(app, "u1")
    a = _today(client).json()["note"]
    _login_as(app, "u2")
    b = _today(client).json()
    assert b["created"] is True and b["note"]["id"] != a["id"]
