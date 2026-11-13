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

#: Simplify pass 2 (A3): the folder a NEW member's daily notes go in. An existing member's "Daily" is still used.
DAILY = "Daily notes"
LEGACY = "Daily"


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
    daily = [f for f in _folders(client) if f["name"] == DAILY]
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
    assert len([f for f in _folders(client) if f["name"] == DAILY]) == 1


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
    daily = [f for f in _folders(client) if f["name"] == DAILY]
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


def test_a_daily_note_from_a_template_holds_no_block_placeholder(app, client):
    # W11-R77 (review n-1): no member note ever holds raw `{{block:...}}` text. A daily template that is also a
    # style's outline holds placeholder lines; the daily note places no block, and the server has no block names,
    # so each placeholder line is dropped (at any depth; a container keeps one empty paragraph). Words AROUND a
    # placeholder, and a heading, are the member's text and stay.
    _login_as(app, "u1")
    para = lambda t: {"type": "paragraph", "content": [{"type": "text", "text": t}]}   # noqa: E731
    body = {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Plan"}]},
        para("{{block:prepWire}}"), para("see {{block:chart}} here"),
        {"type": "bulletList", "content": [{"type": "listItem", "content": [para("{{block:routine_a}}")]}]},
        para("Size my risk")]}
    src = client.post("/api/j2/notes", json={"title": "Prep", "bodyJson": body}).json()["note"]
    tid = client.post("/api/j2/note-templates", json={"noteId": src["id"], "name": "Prep"}).json()["template"]["id"]
    note = _today(client, templateId=tid).json()["note"]
    import json as _json
    raw = _json.dumps(note["bodyJson"])
    assert "{{block:prepWire}}" not in raw and "{{block:routine_a}}" not in raw
    assert "see {{block:chart}} here" in raw and "Size my risk" in raw and "Plan" in raw
    assert note["bodyJson"]["content"][2] == {"type": "bulletList", "content": [
        {"type": "listItem", "content": [{"type": "paragraph"}]}]}


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


# ── A3 (simplify pass 2): new members get "Daily notes"; an existing "Daily" is still found and never renamed ──

def test_A3_the_names_are_the_ones_the_spec_gives():
    from api.services.journal_two import note_daily
    assert note_daily.DAILY_FOLDER_NAME == DAILY
    assert note_daily.LEGACY_DAILY_FOLDER_NAMES == (LEGACY,)


def test_A3_a_member_with_a_daily_folder_keeps_using_it_and_gets_no_daily_notes_folder(app, client):
    _login_as(app, "u1")
    mine = client.post("/api/j2/note-folders", json={"name": LEGACY}).json()["folder"]["id"]
    a = _today(client, "2026-09-24").json()["note"]
    b = _today(client, "2026-09-25").json()["note"]
    assert a["folderId"] == mine and b["folderId"] == mine
    names = [f["name"] for f in _folders(client)]
    assert names.count(LEGACY) == 1, "the member's folder was never renamed"
    assert DAILY not in names, "no second folder was made beside it"


def test_A3_a_member_with_neither_gets_a_daily_notes_folder(app, client):
    _login_as(app, "u1")
    note = _today(client).json()["note"]
    roots = [f for f in _folders(client) if f["parentId"] is None]
    assert [f["name"] for f in roots] == [DAILY]
    assert note["folderId"] == roots[0]["id"]


def test_A3_a_daily_notes_folder_already_there_is_used_not_doubled(app, client):
    _login_as(app, "u1")
    mine = client.post("/api/j2/note-folders", json={"name": DAILY}).json()["folder"]["id"]
    assert _today(client).json()["note"]["folderId"] == mine
    assert [f["name"] for f in _folders(client)] == [DAILY]


def test_A3_a_member_with_both_names_gets_notes_in_daily_never_split(app, client):
    # "Daily notes" made FIRST (older), so "oldest folder wins" alone would pick it: the legacy name must win.
    _login_as(app, "u1")
    newer_name = client.post("/api/j2/note-folders", json={"name": DAILY}).json()["folder"]["id"]
    legacy = client.post("/api/j2/note-folders", json={"name": LEGACY}).json()["folder"]["id"]
    assert newer_name != legacy
    days = ["2026-09-24", "2026-09-25", "2026-09-26"]
    assert {_today(client, d).json()["note"]["folderId"] for d in days} == {legacy}
    assert len(_folders(client)) == 2, "nothing was made, nothing was renamed"


def _move_to(client, note_id, folder_id):
    r = client.put(f"/api/j2/notes/{note_id}", json={"folderId": folder_id})
    assert r.status_code == 200, r.text


def test_I2_days_in_daily_notes_stay_there_when_a_root_daily_folder_appears_later(app, client):
    # Final fix I2: a new member starts on "Daily notes"; a root "Daily" made later (a vault import, or their own) must
    # not take every later day away from the folder their days already live in.
    _login_as(app, "u1")
    first = _today(client, "2026-09-24").json()["note"]
    home = [f for f in _folders(client) if f["name"] == DAILY][0]["id"]
    assert first["folderId"] == home
    client.post("/api/j2/note-folders", json={"name": LEGACY})
    nxt = _today(client, "2026-09-25").json()["note"]
    assert nxt["folderId"] == home, "the next day joined the days already in 'Daily notes'"
    assert len(_folders(client)) == 2, "nothing was made, nothing was renamed"


def test_I2_the_mirror_days_in_daily_stay_there_when_daily_notes_appears_later(app, client):
    _login_as(app, "u1")
    legacy = client.post("/api/j2/note-folders", json={"name": LEGACY}).json()["folder"]["id"]
    assert _today(client, "2026-09-24").json()["note"]["folderId"] == legacy
    client.post("/api/j2/note-folders", json={"name": DAILY})
    assert _today(client, "2026-09-25").json()["note"]["folderId"] == legacy


def test_I2_the_most_recent_days_folder_wins_in_any_casing(app, client):
    # The candidate names match case-insensitively, as the name lookup does ("Daily Notes" from Roam is adopted).
    _login_as(app, "u1")
    roam = client.post("/api/j2/note-folders", json={"name": "DAILY NOTES"}).json()["folder"]["id"]
    assert _today(client, "2026-09-24").json()["note"]["folderId"] == roam
    client.post("/api/j2/note-folders", json={"name": LEGACY})
    assert _today(client, "2026-09-25").json()["note"]["folderId"] == roam


def test_I2_a_most_recent_day_in_a_renamed_folder_falls_back_to_the_name_order(app, client):
    # The member renamed the folder their days live in ("Journal"): that folder is theirs to name, not the daily
    # folder any more, so the next day follows the usual order (a root "Daily", else "Daily notes", else a new one).
    _login_as(app, "u1")
    first = _today(client, "2026-09-24").json()["note"]
    r = client.put(f"/api/j2/note-folders/{first['folderId']}", json={"name": "Journal"})
    assert r.status_code == 200, r.text
    legacy = client.post("/api/j2/note-folders", json={"name": LEGACY}).json()["folder"]["id"]
    assert _today(client, "2026-09-25").json()["note"]["folderId"] == legacy


def test_I2_a_trashed_most_recent_day_does_not_choose_the_folder(app, client):
    # Only a LIVE daily note counts: the most recent day trashed, the next live one's folder is used.
    _login_as(app, "u1")
    legacy = client.post("/api/j2/note-folders", json={"name": LEGACY}).json()["folder"]["id"]
    a = _today(client, "2026-09-24").json()["note"]
    newer = client.post("/api/j2/note-folders", json={"name": DAILY}).json()["folder"]["id"]
    b = _today(client, "2026-09-25").json()["note"]
    _move_to(client, b["id"], newer)
    assert client.delete(f"/api/j2/notes/{b['id']}").status_code == 200
    assert a["folderId"] == legacy
    assert _today(client, "2026-09-26").json()["note"]["folderId"] == legacy


def test_I2_a_most_recent_day_moved_into_daily_notes_takes_the_next_day_with_it(app, client):
    # CONTROL for the trashed case above: the same moved note, live, is the most recent day and its folder wins over
    # the legacy name (so the trashed case can tell "live only" from "never looks at the notes").
    _login_as(app, "u1")
    client.post("/api/j2/note-folders", json={"name": LEGACY})
    _today(client, "2026-09-24")
    newer = client.post("/api/j2/note-folders", json={"name": DAILY}).json()["folder"]["id"]
    b = _today(client, "2026-09-25").json()["note"]
    _move_to(client, b["id"], newer)
    assert _today(client, "2026-09-26").json()["note"]["folderId"] == newer


# ── I3 (final fix): the plan seed is built only for a note this press MAKES, and a failed build never blocks it ──

def _spy_seed(monkeypatch, *, raises=False, lines=("Check your names: NVDA",)):
    from api.services.journal_two import notebook_today
    calls = []

    def fake(user_id, *, paid, now=None):
        calls.append(user_id)
        if raises:
            raise RuntimeError("the seed's reads failed")
        return [{"type": "taskList", "content": [
            {"type": "taskItem", "attrs": {"checked": False},
             "content": [{"type": "paragraph", "content": [{"type": "text", "text": t}]}]} for t in lines]}]

    monkeypatch.setattr(notebook_today, "plan_seed_for", fake)
    return calls


def test_I3_an_existing_note_opens_without_building_the_seed(app, client, monkeypatch):
    _login_as(app, "u1")
    made = _today(client).json()["note"]
    calls = _spy_seed(monkeypatch)
    again = _today(client, seedToday=True)
    assert again.status_code == 200, again.text
    assert again.json()["created"] is False and again.json()["note"]["id"] == made["id"]
    assert calls == [], "the seed was built for a note that already existed"


def test_I3_a_seed_build_that_raises_still_makes_the_note_without_plan_lines(app, client, monkeypatch):
    _login_as(app, "u1")
    calls = _spy_seed(monkeypatch, raises=True)
    r = _today(client, seedToday=True)
    assert r.status_code == 200, r.text
    assert r.json()["created"] is True and calls == ["u1"]
    assert "Check your names" not in str(r.json()["note"]["bodyJson"])


def test_I3_with_no_note_the_seed_is_built_once_and_its_lines_land(app, client, monkeypatch):
    _login_as(app, "u1")
    calls = _spy_seed(monkeypatch)
    r = _today(client, seedToday=True)
    assert r.status_code == 200, r.text
    assert r.json()["created"] is True and calls == ["u1"]
    assert "Check your names: NVDA" in str(r.json()["note"]["bodyJson"])


def test_I3_a_bad_date_with_the_seed_is_still_a_400(app, client, monkeypatch):
    _login_as(app, "u1")
    calls = _spy_seed(monkeypatch)
    assert _today(client, date="2026-02-30", seedToday=True).status_code == 400
    assert calls == []


def test_A3_a_daily_folder_inside_another_folder_is_not_the_daily_folder(app, client):
    _login_as(app, "u1")
    parent = client.post("/api/j2/note-folders", json={"name": "Trading"}).json()["folder"]["id"]
    client.post("/api/j2/note-folders", json={"name": LEGACY, "parentId": parent})
    note = _today(client).json()["note"]
    root_daily = [f for f in _folders(client) if f["parentId"] is None and f["name"] == DAILY]
    assert len(root_daily) == 1 and note["folderId"] == root_daily[0]["id"]


def test_each_member_has_their_own_day(app, client):
    _login_as(app, "u1")
    a = _today(client).json()["note"]
    _login_as(app, "u2")
    b = _today(client).json()
    assert b["created"] is True and b["note"]["id"] != a["id"]


def test_a_daily_note_from_a_template_ends_on_the_paragraph_the_editor_would_add(app, client):
    """W11-R79 follow-up 4a: a daily template ending on a block that is not a paragraph (here a list, or once its last
    placeholder line is dropped, a heading) made a daily note TipTap's TrailingNode appends a paragraph to as it opens.
    The daily note stores it (`journal_styles.with_trailing_paragraph`, the one authority styled creates use)."""
    _login_as(app, "u1")
    para = lambda t: {"type": "paragraph", "content": [{"type": "text", "text": t}]}   # noqa: E731
    heading = {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Plan"}]}
    body = {"type": "doc", "content": [para("Intro"), heading, para("{{block:prepWire}}")]}
    src = client.post("/api/j2/notes", json={"title": "Prep", "bodyJson": body}).json()["note"]
    tid = client.post("/api/j2/note-templates", json={"noteId": src["id"], "name": "Prep"}).json()["template"]["id"]
    note = _today(client, templateId=tid).json()["note"]
    assert note["bodyJson"]["content"] == [para("Intro"), heading, {"type": "paragraph"}]
