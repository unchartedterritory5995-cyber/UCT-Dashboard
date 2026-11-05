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
    from api.services import calendar_personalization
    monkeypatch.setattr(calendar_personalization, "get_user_ticker_sets", lambda uid: {})
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
                               "minutesToOpen": 75, "recap": False}
    assert isinstance(body["reasons"], dict)
    note = body["todayNote"]
    assert note["created"] is True and note["title"] == "2026-11-05 · Thursday"
    assert body["names"] == {"count": 0, "rows": [], "more": 0, "earningsUnknown": False,
                             "buzzKnown": False, "reportingToday": []}
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


# ── S18: tomorrow's plan, made at the first open ────────────────────────────────────────────

def test_the_first_open_starts_the_note_with_a_plan_from_held_figures(app, client, today, monkeypatch):
    _login_as(app, "u1")
    monkeypatch.setattr(today, "market_section", lambda ctx: {
        "held": True, "regime": "green", "regimeWord": "Green", "pctAbove50": 61.0})
    monkeypatch.setattr(today, "setups_section", lambda ctx: {
        "count": 3, "nearCount": 2, "rows": [], "more": 0, "triggered": [], "belowStop": ["ANET"]})
    monkeypatch.setattr(today, "names_section", lambda ctx: {
        "count": 1, "rows": [{"symbol": "AMD"}], "reportingToday": ["AMD"]})
    monkeypatch.setattr(today, "_held_earnings_window",
                        lambda day: ({"AMD": DAY}, {"AMD": "amc"}, False, "now"))
    note = client.get("/api/j2/notes/today").json()["todayNote"]
    assert [i["text"] for i in note["items"]] == [
        "Check the market: Green regime, 61% above the 50-day",
        "Review the 2 setups within 3% of entry",
        "Review ANET: below stop",
        "Prep $AMD earnings (after the close)",
    ]
    # Opening again never writes it a second time.
    again = client.get("/api/j2/notes/today").json()["todayNote"]
    assert again["itemCount"] == 4 and again["updatedAt"] == note["updatedAt"]


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
    return y, due, old


def test_one_member_never_sees_anothers(app, client, today, monkeypatch):
    from api.services import calendar_personalization
    monkeypatch.setattr(calendar_personalization, "get_user_ticker_sets",
                        lambda uid: {"watchlist": {"NVDA"}} if uid == "u1" else {})
    _seed_member("u1")
    _login_as(app, "u2")
    body = client.get("/api/j2/notes/today").json()
    assert body["openFromYesterday"]["items"] == []
    assert body["openFromYesterday"]["priorDaily"] is None
    assert body["onThisDay"]["items"] == []
    assert body["names"]["rows"] == []
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


def test_setups_need_a_paid_plan_and_say_so(app, client):
    _login_as(app, "u1", plan="free")
    from api.services import trial
    body = client.get("/api/j2/notes/today").json()
    if trial.is_paid_or_trial({"id": "u1", "role": "member", "plan": "free"}):
        pytest.skip("a trial window is open in this environment")
    assert body["setups"] is None and body["reasons"]["setups"] == "paid_plan"
    assert body["todayNote"] is not None


# ── no vendor ───────────────────────────────────────────────────────────────────────────────

def test_no_vendor_call_is_reachable(app, client, today, monkeypatch):
    from api.services import calendar_personalization, earnings_enrichment, engine
    from api.routers import live_prices
    from api.services.journal_two import earnings_prep

    def vendor(*a, **k):
        raise AssertionError("a vendor was called from Today")

    monkeypatch.setattr(live_prices, "get_live_prices", vendor)
    monkeypatch.setattr(earnings_prep, "_window", vendor)
    monkeypatch.setattr(earnings_enrichment, "get_implied_move", vendor)
    monkeypatch.setattr(engine, "get_breadth",
                        lambda held_only=False: None if held_only else vendor())
    monkeypatch.setattr(calendar_personalization, "get_user_ticker_sets",
                        lambda uid: {"watchlist": {"AMD", "NVDA"}})
    _login_as(app, "u1")
    body = client.get("/api/j2/notes/today").json()
    assert body["reasons"] == {}, body["reasons"]
    rows = {r["symbol"]: r for r in body["names"]["rows"]}
    assert set(rows) == {"AMD", "NVDA"}
    assert rows["AMD"]["earnings"] is None and body["names"]["earningsUnknown"] is True
