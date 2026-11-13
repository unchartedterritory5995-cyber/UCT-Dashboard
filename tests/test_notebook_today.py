"""The Today home's one read -- `GET /api/j2/notes/today` (audit 2026-11-05, S15 / S18).

What these pin:
  * the SHAPE: every section key, the session, and a `reasons` map;
  * today's note is made through the daily note door on the first open of the ET day and opened (never made
    again) after that -- two tabs at once still make ONE note;
  * MEMBER SCOPING: one member's notes, tasks, "on this day" and names never reach another member;
  * EACH SECTION DEGRADES ON ITS OWN: a section that raises is null with a reason, and the rest still answer;
  * the setups section is the board's (a paid surface): a member without a paid plan gets null + `paid_plan`;
  * S18's tomorrow's plan is written into the note only when this read MAKES it, from held figures;
  * no vendor call is reachable: the live-price, calendar-walk and implied-move vendors are never called.
"""
from __future__ import annotations

import importlib
import sqlite3
import json
import os
import tempfile
import threading
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services.journal_two.timeutil import ET

NOW = datetime(2026, 11, 5, 8, 15, tzinfo=ET)          # a Thursday, pre-market
DAY = "2026-11-05"


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
def today(monkeypatch, db_path):
    """The module, with its clock pinned and the outside world held still: no names, no market, no buzz file."""
    from api.services.journal_two import notebook_today as mod
    monkeypatch.setattr(mod, "_now_et", lambda now=None: NOW if now is None else now)
    # Fix round 1 (I5): the names card reads the member's own lists directly; a test that calls this would be
    # reading the four-source union the card no longer needs.
    from api.services import calendar_personalization

    def _no_union(uid):
        raise AssertionError("Today read member_interest's four-source union")

    monkeypatch.setattr(calendar_personalization, "get_user_ticker_sets", _no_union)
    from api.services import engine
    monkeypatch.setattr(engine, "get_breadth", lambda held_only=False: None)
    monkeypatch.setenv("BUZZ_DB_PATH", os.path.join(os.path.dirname(db_path), "no-such-buzz.db"))
    return mod


@pytest.fixture
def app(today):
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _login_as(app, user_id, plan="pro"):
    user = {"id": user_id, "role": "member", "plan": plan, "subscription_status": "active"}
    app.dependency_overrides[authmw.get_current_user] = lambda: user
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: user


def _task_doc(*items, title_text=None):
    """A doc of task items; each item is (text, checked, due-or-None)."""
    tasks = []
    for text, checked, due in items:
        para = [{"type": "text", "text": text}]
        if due:
            para.append({"type": "dateMention", "attrs": {"date": due}})
        tasks.append({"type": "taskItem", "attrs": {"checked": checked},
                      "content": [{"type": "paragraph", "content": para}]})
    content = [{"type": "taskList", "content": tasks}]
    if title_text:
        content.insert(0, {"type": "paragraph", "content": [{"type": "text", "text": title_text}]})
    return {"type": "doc", "content": content}


def _set_created(note_id, stamp):
    from api.services.auth_db import get_connection
    c = get_connection()
    c.execute("UPDATE j2_notes SET created_at = ? WHERE id = ?", (stamp, note_id))
    c.commit()
    c.close()


# ── shape ───────────────────────────────────────────────────────────────────────────────────

def test_the_shape_every_section_the_session_and_reasons(app, client, today):
    _login_as(app, "u1")
    r = client.get("/api/j2/notes/today")
    assert r.status_code == 200, r.text
    body = r.json()
    for key in today.SECTIONS:
        assert key in body, key
    assert body["day"] == DAY
    assert body["session"] == {"day": DAY, "weekday": "Thursday", "phase": "premarket",
                               "minutesToOpen": 75, "recap": False, "recapFrom": "16:05"}
    assert isinstance(body["reasons"], dict)
    note = body["todayNote"]
    assert note["created"] is True and note["title"] == "2026-11-05 · Thursday"
    assert body["names"] == {"count": 0, "rows": [], "more": 0, "earningsUnknown": False, "earningsWithheld": False,
                             "buzzKnown": False, "reportingToday": [], "first": []}
    assert body["setups"]["count"] == 0 and body["setups"]["rows"] == []
    assert body["openFromYesterday"]["items"] == [] and body["onThisDay"]["items"] == []
    assert body["market"]["held"] is False and body["market"]["regime"] is None


@pytest.mark.parametrize("hm,phase,recap", [
    ((9, 29), "premarket", False), ((9, 30), "open", False), ((15, 59), "open", False),
    ((16, 0), "after_close", False), ((16, 4), "after_close", False), ((16, 5), "after_close", True),
    ((21, 0), "after_close", True),
])
def test_the_session_clock_is_ET(today, hm, phase, recap):
    s = today.session_of(datetime(2026, 11, 5, *hm, tzinfo=ET))
    assert (s["phase"], s["recap"]) == (phase, recap)


def test_a_weekend_is_closed_and_offers_no_recap(today):
    s = today.session_of(datetime(2026, 11, 7, 17, 0, tzinfo=ET))
    assert s["phase"] == "closed" and s["recap"] is False and s["minutesToOpen"] is None


# ── today's note: made once ─────────────────────────────────────────────────────────────────

def test_the_first_open_makes_the_note_and_the_second_opens_it(app, client):
    _login_as(app, "u1")
    first = client.get("/api/j2/notes/today").json()["todayNote"]
    again = client.get("/api/j2/notes/today").json()["todayNote"]
    assert first["created"] is True and again["created"] is False
    assert again["id"] == first["id"]
    assert again["updatedAt"] == first["updatedAt"], "opening Today again is not a write"
    from api.services.auth_db import get_connection
    c = get_connection()
    n = c.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = 'u1' AND daily_date = ?", (DAY,)).fetchone()[0]
    c.close()
    assert n == 1


def test_two_tabs_opening_today_at_once_make_one_note(today, monkeypatch):
    # ⛔ A FORCED race: both reads pass "is there a note yet?" before either writes. Only the door's unique index
    # (and its answer-the-loser-with-the-winner catch) can keep it to one.
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
            barrier.wait()
        return got

    monkeypatch.setattr(notes_service, "find_daily_note_id", racing_find)
    results, errors = [], []

    def open_today():
        try:
            results.append(today.get_today("u1"))
        except Exception as e:  # noqa: BLE001 -- the rail reports it
            errors.append(e)

    threads = [threading.Thread(target=open_today) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    notes = [r["todayNote"] for r in results]
    assert all(n is not None for n in notes), [r["reasons"] for r in results]
    assert len({n["id"] for n in notes}) == 1
    assert sum(1 for n in notes if n["created"]) == 1


def test_the_note_uses_the_members_daily_template(app, client, monkeypatch):
    _login_as(app, "u1")
    from api.services.journal_two import note_templates
    from api.services.journal_two import notes as notes_service
    src = notes_service.create_note("u1", {"title": "source",
                                           "bodyJson": _task_doc(("Write one rule for today", False, None))})
    tpl = note_templates.create_from_note("u1", src["id"], "Daily prep")
    from api.services.journal_two import note_personal_api
    monkeypatch.setattr(note_personal_api, "_daily_template_id", lambda uid: tpl["id"] if uid == "u1" else None)
    note = client.get("/api/j2/notes/today").json()["todayNote"]
    assert note["templateName"] == "Daily prep"
    assert [i["text"] for i in note["items"]] == ["Write one rule for today"]
    assert note["openCount"] == 1


# ── helpers: the member's own lists ─────────────────────────────────────────────────────────

def _add_names(uid, symbols, *, list_name="My names"):
    """A user row (the lists reference it) and one own list holding `symbols`, in that order."""
    import uuid
    from api.services.auth_db import get_connection
    c = get_connection()
    c.execute("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", (uid, f"{uid}@t.local"))
    wl = uuid.uuid4().hex
    c.execute("INSERT INTO watchlists (id, user_id, name) VALUES (?, ?, ?)", (wl, uid, list_name))
    for i, sym in enumerate(symbols):
        c.execute("INSERT INTO watchlist_items (id, watchlist_id, sym, sort_order) VALUES (?, ?, ?, ?)",
                  (uuid.uuid4().hex, wl, sym, i))
    c.commit()
    c.close()


# ── S18: tomorrow's plan, made at the first open ────────────────────────────────────────────

def test_the_first_open_starts_the_note_with_a_plan_from_held_figures(app, client, today, monkeypatch):
    _login_as(app, "u1")
    monkeypatch.setattr(today, "market_section", lambda ctx: {
        "held": True, "regime": "green", "regimeWord": "Green", "pctAbove50": 61.0})
    monkeypatch.setattr(today, "setups_section", lambda ctx: {
        "count": 3, "nearCount": 2, "rows": [], "more": 0, "triggered": [], "belowStop": ["ANET"]})
    monkeypatch.setattr(today, "names_section", lambda ctx: {
        "count": 2, "rows": [{"symbol": "AMD", "earnings": {"date": DAY, "timing": "amc"}}, {"symbol": "NVDA"}],
        "reportingToday": ["AMD"], "first": ["AMD", "NVDA"]})
    note = client.get("/api/j2/notes/today").json()["todayNote"]
    lines = [i["text"] for i in note["items"]]
    assert lines == [
        "Check the market: Green regime, 61% above the 50-day",
        "Review the 2 setups within 3% of entry",
        "Review ANET: below stop",
        "Prep $AMD earnings (after the close)",
        "Check your names: AMD, NVDA",
    ]
    assert all(today.is_seed_line(t) for t in lines)
    # Opening again never writes it a second time.
    again = client.get("/api/j2/notes/today").json()["todayNote"]
    assert again["itemCount"] == 5 and again["updatedAt"] == note["updatedAt"]


def test_an_existing_daily_note_is_never_seeded(app, client, today, monkeypatch):
    _login_as(app, "u1")
    from api.services.journal_two import note_daily
    made = note_daily.open_daily_note("u1", DAY)["note"]          # Ctrl+Alt+D made it first
    monkeypatch.setattr(today, "market_section", lambda ctx: {"held": True, "regimeWord": "Green", "pctAbove50": 61})
    note = client.get("/api/j2/notes/today").json()["todayNote"]
    assert note["id"] == made["id"] and note["created"] is False and note["itemCount"] == 0


def test_nothing_held_means_no_seed(app, client):
    _login_as(app, "u1")
    note = client.get("/api/j2/notes/today").json()["todayNote"]
    assert note["itemCount"] == 0


def test_M9_a_template_with_its_own_plan_heading_gets_the_lines_under_it(app, client, today, monkeypatch):
    _login_as(app, "u1")
    from api.services.journal_two import note_personal_api, note_templates
    from api.services.journal_two import notes as notes_service
    body = {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Today's plan"}]},
        _task_doc(("One rule for today", False, None))["content"][0]]}
    src = notes_service.create_note("u1", {"title": "src", "bodyJson": body})
    tpl = note_templates.create_from_note("u1", src["id"], "Daily prep")
    monkeypatch.setattr(note_personal_api, "_daily_template_id", lambda uid: tpl["id"])
    monkeypatch.setattr(today, "market_section", lambda ctx: {"held": True, "regimeWord": "Green", "pctAbove50": 61})
    made = client.get("/api/j2/notes/today").json()["todayNote"]
    note = notes_service.get_note("u1", made["id"])
    heads = [n for n in note["bodyJson"]["content"] if n.get("type") == "heading"]
    assert len(heads) == 1, "one Today's plan heading, never two"
    assert [i["text"] for i in made["items"]] == ["Check the market: Green regime, 61% above the 50-day",
                                                  "One rule for today"]


# ── I3: a trashed day's note is never replaced by a page view ───────────────────────────────

def _count_notes(uid):
    from api.services.auth_db import get_connection
    c = get_connection()
    n = c.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ?", (uid,)).fetchone()[0]
    c.close()
    return n


def test_I3_a_trashed_days_note_is_not_remade_by_the_read(app, client):
    _login_as(app, "u1")
    first = client.get("/api/j2/notes/today").json()["todayNote"]
    assert client.delete(f"/api/j2/notes/{first['id']}").status_code == 200
    for _ in range(2):
        again = client.get("/api/j2/notes/today").json()["todayNote"]
        assert again["trashed"] is True and again["id"] == first["id"] and again["created"] is False
    assert _count_notes("u1") == 1, "no new note was made"
    # "Start a fresh one" is the POST door, on that press: then there is one live note again.
    fresh = client.post("/api/j2/notes/daily", json={"date": DAY, "seedToday": True}).json()
    assert fresh["created"] is True and fresh["note"]["id"] != first["id"]
    now = client.get("/api/j2/notes/today").json()["todayNote"]
    assert now["id"] == fresh["note"]["id"] and now["trashed"] is False


def test_I3_restore_brings_back_the_same_note(app, client):
    _login_as(app, "u1")
    first = client.get("/api/j2/notes/today").json()["todayNote"]
    client.delete(f"/api/j2/notes/{first['id']}")
    assert client.post(f"/api/j2/notes/{first['id']}/restore").status_code == 200
    back = client.get("/api/j2/notes/today").json()["todayNote"]
    assert back["id"] == first["id"] and back["trashed"] is False and back["created"] is False


# ── I9: the first run pending -- nothing is made, then Build makes it with the names ─────────

def test_I9_make_0_never_makes_the_note(app, client):
    _login_as(app, "u1")
    got = client.get("/api/j2/notes/today", params={"make": 0}).json()["todayNote"]
    assert got["missing"] is True and got["id"] is None
    assert _count_notes("u1") == 0


def _count_rows(table, uid):
    from api.services.auth_db import get_connection
    c = get_connection()
    n = c.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (uid,)).fetchone()[0]  # noqa: S608
    c.close()
    return n


def test_B1_get_today_make_false_makes_neither_note_nor_folder(today):
    """Simplify pass 2 (B1): the Daily brief reads with `make=False` on every open. For a member with no note it
    answers `missing: true` and writes nothing -- no note and no Daily folder (row counts before and after)."""
    before = (_count_rows("j2_notes", "u1"), _count_rows("j2_note_folders", "u1"))
    out = today.get_today("u1", paid=True, make=False)
    assert out["todayNote"]["missing"] is True and out["todayNote"]["id"] is None
    assert out["todayNote"]["created"] is False
    assert (_count_rows("j2_notes", "u1"), _count_rows("j2_note_folders", "u1")) == before == (0, 0)
    # CONTROL: the same read allowed to make does write both, so the counts above can move.
    made = today.get_today("u1", paid=True, make=True)
    assert made["todayNote"]["created"] is True
    assert (_count_rows("j2_notes", "u1"), _count_rows("j2_note_folders", "u1")) == (1, 1)


def test_B1_make_false_on_an_existing_note_opens_it_and_on_a_trashed_one_never_remakes_it(app, client):
    _login_as(app, "u1")
    made = client.post("/api/j2/notes/daily", json={"date": DAY, "seedToday": True}).json()["note"]
    got = client.get("/api/j2/notes/today", params={"make": 0}).json()["todayNote"]
    assert got["id"] == made["id"] and got["missing"] is False and got["created"] is False
    client.delete(f"/api/j2/notes/{made['id']}")
    for _ in range(2):
        again = client.get("/api/j2/notes/today", params={"make": 0}).json()["todayNote"]
        assert again["trashed"] is True and again["id"] == made["id"]
    assert _count_notes("u1") == 1


def test_I9_build_makes_the_note_with_the_names_just_typed(app, client):
    _login_as(app, "u1")
    client.get("/api/j2/notes/today", params={"make": 0})               # Today, under the first-run sheet
    _add_names("u1", ["NVDA", "AMD", "TSLA"])                            # Build writes "My names" first
    made = client.post("/api/j2/notes/daily", json={"date": DAY, "seedToday": True}).json()
    assert made["created"] is True
    after = client.get("/api/j2/notes/today").json()["todayNote"]
    assert after["id"] == made["note"]["id"] and after["created"] is False
    assert "Check your names: NVDA, AMD, TSLA" in [i["text"] for i in after["items"]]


def test_I9_without_seedToday_the_post_door_is_unchanged(app, client):
    _login_as(app, "u1")
    _add_names("u1", ["NVDA"])
    made = client.post("/api/j2/notes/daily", json={"date": DAY}).json()
    assert made["created"] is True
    assert "Check your names" not in json.dumps(made["note"]["bodyJson"])


# ── I4: lines Today wrote never come back as "open from yesterday" ──────────────────────────

def test_I4_seeded_lines_are_not_open_from_yesterday_but_an_edited_one_is(app, client):
    _login_as(app, "u1")
    from api.services.journal_two import notes as notes_service
    notes_service.create_note("u1", {"title": "yesterday", "bodyJson": _task_doc(
        ("Check the market: Green regime, 61% above the 50-day", False, None),
        ("Review the 2 setups within 3% of entry", False, None),
        ("Prep " + "$" + "AMD earnings (after the close)", False, None),
        ("Check your names: AMD, NVDA", False, None),
        ("Review the 2 setups within 3% of entry, then size down", False, None),   # edited: the member's now
        ("Call the broker", False, None))}, daily_date="2026-11-04")
    items = client.get("/api/j2/notes/today").json()["openFromYesterday"]["items"]
    assert [i["text"] for i in items] == ["Review the 2 setups within 3% of entry, then size down", "Call the broker"]


# ── member scoping ──────────────────────────────────────────────────────────────────────────

def _seed_member(uid):
    from api.services.journal_two import notes as notes_service
    y = notes_service.create_note(uid, {"title": f"{uid} yesterday",
                                        "bodyJson": _task_doc((f"{uid} open item", False, None),
                                                              (f"{uid} done item", True, None))},
                                  daily_date="2026-11-04")
    due = notes_service.create_note(uid, {"title": f"{uid} tasks",
                                          "bodyJson": _task_doc((f"{uid} due item", False, "2026-11-03"),
                                                                (f"{uid} later item", False, "2026-11-20"))})
    old = notes_service.create_note(uid, {"title": f"{uid} a year ago", "bodyJson": _task_doc(
        (f"{uid} memory", False, None))})
    _set_created(old["id"], "2025-11-05T15:00:00Z")
    _add_names(uid, ["NVDA"])
    return y, due, old


def test_one_member_never_sees_anothers(app, client, today):
    _seed_member("u1")
    _login_as(app, "u2")
    body = client.get("/api/j2/notes/today").json()
    assert body["openFromYesterday"]["items"] == []
    assert body["openFromYesterday"]["priorDaily"] is None
    assert body["onThisDay"]["items"] == []
    assert body["names"]["rows"] == [] and body["names"]["count"] == 0
    assert "u1" not in json.dumps(body)

    _login_as(app, "u1")
    mine = client.get("/api/j2/notes/today").json()
    texts = [i["text"] for i in mine["openFromYesterday"]["items"]]
    assert texts == ["u1 open item", "u1 due item"], texts
    assert [i["from"] for i in mine["openFromYesterday"]["items"]] == ["yesterday", "overdue"]
    assert [i["title"] for i in mine["onThisDay"]["items"]] == ["u1 a year ago"]
    assert mine["onThisDay"]["items"][0]["yearsAgo"] == 1
    assert [r["symbol"] for r in mine["names"]["rows"]] == ["NVDA"]


def test_on_this_day_dates_a_note_in_new_york(app, client):
    from api.services.journal_two import notes as notes_service
    _login_as(app, "u1")
    evening = notes_service.create_note("u1", {"title": "evening of the 5th"})
    _set_created(evening["id"], "2025-11-06T03:00:00Z")      # 22:00 ET on 2025-11-05
    utc_only = notes_service.create_note("u1", {"title": "the 4th in New York"})
    _set_created(utc_only["id"], "2025-11-05T02:00:00Z")     # 21:00 ET on 2025-11-04
    this_year = notes_service.create_note("u1", {"title": "this year"})
    _set_created(this_year["id"], "2026-11-05T15:00:00Z")
    got = client.get("/api/j2/notes/today").json()["onThisDay"]["items"]
    assert [i["title"] for i in got] == ["evening of the 5th"]


def test_M2_a_busy_today_never_crowds_out_the_years_before(app, client):
    from api.services.journal_two import notes as notes_service
    _login_as(app, "u1")
    for i in range(60):                                       # an import today: 60 notes on this very date
        n = notes_service.create_note("u1", {"title": f"today {i}"})
        _set_created(n["id"], "2026-11-05T15:00:00Z")
    for y, title in ((2025, "a year ago"), (2023, "three years ago")):
        n = notes_service.create_note("u1", {"title": title})
        _set_created(n["id"], f"{y}-11-05T15:00:00Z")
    got = client.get("/api/j2/notes/today").json()["onThisDay"]["items"]
    assert [(i["title"], i["yearsAgo"]) for i in got] == [("a year ago", 1), ("three years ago", 3)]


# ── each section degrades on its own ────────────────────────────────────────────────────────

_FN = {"market": "market_section", "setups": "setups_section", "names": "names_section",
       "todayNote": "today_note_section", "openFromYesterday": "open_from_yesterday_section",
       "onThisDay": "on_this_day_section"}


@pytest.mark.parametrize("section", list(_FN))
def test_a_failing_section_is_null_with_a_reason_and_the_rest_answer(app, client, today, monkeypatch, section):
    _login_as(app, "u1")

    def boom(*a, **k):
        raise RuntimeError("store unreadable")

    monkeypatch.setattr(today, _FN[section], boom)
    r = client.get("/api/j2/notes/today")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body[section] is None
    assert body["reasons"] == {section: "error"}
    for other in _FN:
        if other != section:
            assert body[other] is not None, other


def test_M7_a_names_read_that_fails_is_an_error_never_no_names(app, client, today, monkeypatch):
    _login_as(app, "u1")

    def unreadable(conn, uid):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(today, "own_names", unreadable)
    body = client.get("/api/j2/notes/today").json()
    assert body["names"] is None and body["reasons"]["names"] == "error"


# ── I6: paid figures, as their own routers gate them ────────────────────────────────────────

def _breadth(held_only=False):
    return {"exposure": {"score": 80}, "pct_above_50ma": 61}


def test_I6_without_a_paid_plan_the_paid_figures_are_withheld(app, client, today, monkeypatch):
    from api.services import trial
    if trial.is_paid_or_trial({"id": "u1", "role": "member", "plan": "free"}):
        pytest.skip("a trial window is open in this environment")
    _login_as(app, "u1", plan="free")
    _add_names("u1", ["AMD"])
    monkeypatch.setattr(today, "_held_earnings_window", lambda day: ({"AMD": DAY}, {"AMD": "amc"}, False, "now"))
    from api.services import engine
    monkeypatch.setattr(engine, "get_breadth", _breadth)
    body = client.get("/api/j2/notes/today").json()
    assert body["setups"] is None and body["reasons"]["setups"] == "plan"
    assert body["market"] is None and body["reasons"]["market"] == "plan"
    assert body["names"]["rows"][0]["earnings"] is None
    assert body["names"]["earningsWithheld"] is True and body["reasons"]["namesEarnings"] == "plan"
    assert body["todayNote"] is not None
    dumped = json.dumps(body)
    assert "Check the market" not in dumped and "earnings (after the close)" not in dumped


def test_I6_CONTROL_a_paid_member_gets_them(app, client, today, monkeypatch):
    _login_as(app, "u1")
    _add_names("u1", ["AMD"])
    monkeypatch.setattr(today, "_held_earnings_window", lambda day: ({"AMD": DAY}, {"AMD": "amc"}, False, "now"))
    from api.services import engine
    monkeypatch.setattr(engine, "get_breadth", _breadth)
    body = client.get("/api/j2/notes/today").json()
    assert body["names"]["rows"][0]["earnings"]["timing"] == "amc"
    assert "namesEarnings" not in body["reasons"] and body["market"]["pctAbove50"] == 61


# ── I5: names cost what the card shows ──────────────────────────────────────────────────────

def test_I5_a_400_name_list_reads_bars_ticks_buzz_and_moves_for_eight(app, client, today, monkeypatch, tmp_path):
    _login_as(app, "u1")
    syms = [f"S{i:03d}" for i in range(400)]
    _add_names("u1", syms)
    calls = {"bars": [], "tick": [], "buzz": [], "move": []}
    from api.services import bars_sqlite, buzz_store
    from api.services.journal_two import earnings_prep
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda sym, tf, n: calls["bars"].append(sym) or [])
    monkeypatch.setattr(today, "_live_ticks", lambda s: calls["tick"].extend(s) or {})
    buzz_db = tmp_path / "buzz.db"
    buzz_db.write_bytes(b"")
    monkeypatch.setattr(buzz_store, "db_path", lambda: str(buzz_db))
    monkeypatch.setattr(buzz_store, "count", lambda sym, a, b, c: calls["buzz"].append(sym) or 0)
    monkeypatch.setattr(earnings_prep, "_implied_rows", lambda sym: calls["move"].append(sym) or [])
    # S399 reports today: it leads, then list order.
    monkeypatch.setattr(today, "_held_earnings_window", lambda day: ({"S399": DAY}, {}, False, "now"))
    names = client.get("/api/j2/notes/today").json()["names"]
    shown = [r["symbol"] for r in names["rows"]]
    assert shown == ["S399"] + syms[:7]
    assert names["count"] == 400 and names["more"] == 392
    assert sorted(calls["bars"]) == sorted(shown)
    assert sorted(calls["tick"]) == sorted(shown)
    assert sorted(calls["buzz"]) == sorted(shown)
    assert calls["move"] == ["S399"]


# ── I8: no vendor, recorded rather than raised ──────────────────────────────────────────────

def test_I8_no_vendor_call_is_reachable(app, client, today, monkeypatch):
    from api.services import earnings_enrichment, engine
    from api.routers import live_prices
    from api.services.journal_two import earnings_prep
    called = []

    def vendor(name):
        def f(*a, **k):
            called.append(name)
            return None
        return f

    monkeypatch.setattr(live_prices, "get_live_prices", vendor("live_prices"))
    monkeypatch.setattr(earnings_prep, "_window", vendor("earnings_prep._window"))
    monkeypatch.setattr(earnings_enrichment, "get_implied_move", vendor("get_implied_move"))
    default_breadth = vendor("get_breadth(default)")
    monkeypatch.setattr(engine, "get_breadth", lambda held_only=False: None if held_only else default_breadth())
    # A HELD window that gives AMD a report date today, so the expected-move path really runs.
    monkeypatch.setattr(earnings_prep, "cached_window", lambda day: ({"AMD": DAY}, {"AMD": "amc"}, False, "now"))
    moves = []
    real_cell = earnings_prep._expected_move_cell
    monkeypatch.setattr(earnings_prep, "_expected_move_cell",
                        lambda *a, **k: moves.append(a[0]) or real_cell(*a, **k))
    _login_as(app, "u1")
    _add_names("u1", ["AMD", "NVDA"])
    body = client.get("/api/j2/notes/today").json()
    assert moves == ["AMD"], "non-vacuity: the expected-move path ran for the reporting name"
    assert body["names"]["rows"][0]["earnings"]["date"] == DAY
    assert called == [], called


# ── the session clock: half-days and today's recap heading (M6) ─────────────────────────────

def test_M6_a_half_day_closes_at_13_and_offers_the_recap_from_13_05(today):
    from api.services import session_calendar
    half = next((d for d in sorted(session_calendar.calendar().early_closes) if d.year == 2026), None)
    if half is None:
        pytest.skip("no 2026 half-day in the calendar")

    def at(h, m):
        return today.session_of(datetime(half.year, half.month, half.day, h, m, tzinfo=ET))

    assert at(12, 59)["phase"] == "open"
    assert at(13, 0)["phase"] == "after_close" and at(13, 4)["recap"] is False
    assert at(13, 5)["recap"] is True and at(13, 5)["recapFrom"] == "13:05"


def test_M6_recap_written_is_todays_heading_only(app, client):
    _login_as(app, "u1")
    from api.services.journal_two import note_daily

    def heading(text):
        return {"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": text}]}]}

    note = note_daily.open_daily_note("u1", DAY)["note"]
    r = client.put(f"/api/j2/notes/{note['id']}", json={"bodyJson": heading("Recap — Nov 4"),
                                                        "baseUpdatedAt": note["updatedAt"]})
    assert r.status_code == 200, r.text
    assert client.get("/api/j2/notes/today").json()["todayNote"]["recapWritten"] is False
    note = r.json()["note"]
    r = client.put(f"/api/j2/notes/{note['id']}", json={"bodyJson": heading("Today's recap — Nov 5"),
                                                        "baseUpdatedAt": note["updatedAt"]})
    assert r.status_code == 200, r.text
    assert client.get("/api/j2/notes/today").json()["todayNote"]["recapWritten"] is True


# ── fix round 2 (N3): one table of seed line formats, the writer and the matcher both derived from it ─────────

def test_N3_every_line_shape_the_writer_makes_is_matched(today):
    ctx = {"day": DAY}
    market = {"regimeWord": "Green", "pctAbove50": 61.0}
    setups = {"nearCount": 1, "belowStop": ["ANET"], "triggered": ["CRWD"]}
    names = {"rows": [
        {"symbol": "AMD", "earnings": {"date": DAY, "timing": "amc"}},
        {"symbol": "NVDA", "earnings": {"date": DAY, "timing": "bmo"}},
        {"symbol": "TSLA", "earnings": {"date": DAY, "timing": None}},
        {"symbol": "ORCL", "earnings": {"date": "2026-11-06", "timing": "bmo"}},
    ], "first": ["AMD", "NVDA"]}
    lines = today._plan_lines(ctx, market, setups, names, cap=99)
    lines += today._plan_lines(ctx, {"regimeWord": "Yellow"}, {"nearCount": 2}, None, cap=99)
    lines += today._plan_lines(ctx, {"pctAbove50": 48.5}, None, None, cap=99)
    shapes = {
        "Check the market: Green regime, 61% above the 50-day", "Check the market: Yellow regime",
        "Check the market: 48.5% above the 50-day",
        "Review the 1 setup within 3% of entry", "Review the 2 setups within 3% of entry",
        "Review ANET: below stop", "CRWD triggered: check the entry",
        "Prep $AMD earnings (after the close)", "Prep $NVDA earnings (before the open)", "Prep $TSLA earnings (today)",
        "Prep $ORCL earnings (tomorrow before the open)", "Check your names: AMD, NVDA",
    }
    assert shapes <= set(lines), shapes - set(lines)
    # all 7 kinds of line, each matched
    assert {k for k, _ in today.SEED_FORMATS} == {"market", "near", "below", "triggered", "earnings",
                                                  "earnings_tomorrow", "names"}
    for line in lines:
        assert today.is_seed_line(line), line


@pytest.mark.parametrize("member_line", [
    "Check the market: breadth improving, 61% above the 50-day",     # M1's own Daily prep line
    "Check the market: Green regime, then size down",
    "Check the market: SPY first",
    "Check the market: risk-on regime",                              # a regime word UCT does not use
    "Review ANET: below stop, then cut",
    "Prep $AMD earnings (with the call notes)",
])
def test_N3_a_members_own_line_with_a_seed_prefix_is_theirs(today, member_line):
    assert today.is_seed_line(member_line) is False


# ── fix round 2 (N5): the seed is built BEFORE the daily note door writes ──────────────────────

def test_N5_seedToday_builds_the_seed_before_the_door_takes_its_write_lock(app, client, monkeypatch):
    _login_as(app, "u1")
    _add_names("u1", ["NVDA"])
    from api.services.journal_two import note_daily
    real = note_daily.open_daily_note
    got = {}

    def spy(user_id, raw_date, template_id=None, *, seed_blocks=None):
        got["seed"] = seed_blocks
        return real(user_id, raw_date, template_id, seed_blocks=seed_blocks)

    monkeypatch.setattr(note_daily, "open_daily_note", spy)
    made = client.post("/api/j2/notes/daily", json={"date": DAY, "seedToday": True}).json()
    assert isinstance(got["seed"], list), "a callable would run its reads inside the door's write transaction"
    assert made["created"] is True and "Check your names: NVDA" in json.dumps(made["note"]["bodyJson"])
