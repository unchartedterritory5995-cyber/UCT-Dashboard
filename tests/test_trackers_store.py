"""Task 9.5 - the tracker store: CRUD, range-checked values, the window, and check-ins as two
read-only trackers.

Real auth.db schema (db.ensure_schema through auth_db.init_db) in a tmp dir and an injected
`now`: nothing sleeps. Dates are real 2026 sessions (ET). NOW is Friday 2026-11-06, noon ET:
the write window runs from Wed 2026-10-28 (7th session back) to Mon 2026-11-09.
"""
from __future__ import annotations

import importlib
import math
import re
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

A, B = "u-tracker-a", "u-tracker-b"
NOW = datetime(2026, 11, 6, 17, tzinfo=timezone.utc)


def at(day: str, hour_utc: int = 17) -> datetime:
    y, m, d = (int(x) for x in day.split("-"))
    return datetime(y, m, d, hour_utc, 0, tzinfo=timezone.utc)


@pytest.fixture
def T(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.journal_two import trackers
    yield trackers
    importlib.reload(auth_db)


def _conn():
    from api.services import auth_db
    return auth_db.get_connection()


def _count(table: str, user: str = A) -> int:
    c = _conn()
    try:
        return c.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (user,)).fetchone()[0]
    finally:
        c.close()


def make(T, user=A, *, name="Sleep", kind="duration", **kw):
    return T.create(user, name=name, kind=kind, now=kw.pop("now", NOW), **kw)


def _note(user: str, note_id: str, updated_at: str, *, deleted: bool = False,
          sample: bool = False) -> None:
    c = _conn()
    try:
        c.execute("INSERT INTO j2_notes (id, user_id, created_at, updated_at, deleted_at,"
                  " import_source) VALUES (?, ?, ?, ?, ?, ?)",
                  (note_id, user, "2026-11-01T00:00:00+00:00", updated_at,
                   "2026-11-06T00:00:00+00:00" if deleted else None,
                   "sample" if sample else None))
        c.commit()
    finally:
        c.close()


def _checkin(user: str, note_id: str, day: str, mood, focus, embed: str = "e1") -> None:
    c = _conn()
    try:
        c.execute("INSERT INTO j2_note_checkins (note_id, user_id, embed_id, day, mood, focus,"
                  " created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                  (note_id, user, embed, day, mood, focus, "2026-11-06T00:00:00+00:00"))
        c.commit()
    finally:
        c.close()


# ── constants and sentences ────────────────────────────────────────────────────────────────────

def test_constants_are_the_briefs_values(T):
    assert (T.COUNT_CAP, T.NAME_MAX, T.KIND, T.RECENT_MAX) == (30, 80, "tracker", 30)
    assert T.DAYS_CHOICES == ("trading", "any")
    assert T.BUILTIN == {
        "checkin:mood": {"name": "Check-in mood", "kind": "scale", "readOnly": True},
        "checkin:focus": {"name": "Check-in focus", "kind": "scale", "readOnly": True}}
    assert T.S_CAP == "You have 30 trackers. Archive one in My tools to make room."
    assert T.S_NOT_FOUND == "Not available."
    assert T.S_ARCHIVED == "Archived tracker, history only"
    assert T.S_READ_ONLY == "Mood and focus come from your check-ins."
    assert T.S_TRADING_ONLY == "This tracker logs trading days only."
    assert T.S_KIND_FIXED == "A tracker's type can't change. Make a new tracker instead."
    assert T.S_WINDOW == "Ticks can be added up to 7 trading days back."
    for bid in T.BUILTIN:
        with pytest.raises(ValueError):
            uuid.UUID(bid)
    assert issubclass(T.TrackerError, ValueError)
    for cls, status, code in ((T.TrackerError, 400, "invalid"), (T.NotFound, 404, "not_found"),
                              (T.Conflict, 409, "conflict"), (T.OutsideWindow, 400, "window"),
                              (T.ReadOnly, 409, "read_only")):
        assert issubclass(cls, T.TrackerError) and (cls.status, cls.code) == (status, code)


# ── CRUD ───────────────────────────────────────────────────────────────────────────────────────

def test_create_each_kind_and_cap_30(T):
    made = {}
    for kind in ("yesno", "number", "scale", "duration"):
        t = make(T, name=f"K {kind}", kind=kind, unit="hrs" if kind == "number" else None)
        made[kind] = t
        assert t["kind"] == kind and t["etag"] == 1 and t["readOnly"] is False
        assert t["settings"] == {"days": "trading"} and t["usedIn"] == 0
        assert t["archived"] is False and t["deleted"] is False
        uuid.UUID(t["id"])
    assert made["number"]["unit"] == "hrs"
    assert T.get(A, made["scale"]["id"])["name"] == "K scale"
    with pytest.raises(T.TrackerError) as e:
        make(T, name="Bad", kind="mood")
    assert e.value.sentence == "Pick a tracker type."
    for i in range(26):
        make(T, name=f"T{i}", kind="number")
    assert _count("j2_trackers") == 30
    with pytest.raises(T.TrackerError) as e:
        make(T, name="one more", kind="number")
    assert e.value.sentence == T.S_CAP and e.value.status == 409 and e.value.code == "count_cap"
    assert isinstance(e.value, T.CountCap)
    assert _count("j2_trackers") == 30
    T.archive(A, made["yesno"]["id"], now=NOW)
    make(T, name="fits now", kind="number")
    with pytest.raises(T.TrackerError) as e:     # unarchive is refused at the cap too
        T.unarchive(A, made["yesno"]["id"], now=NOW)
    assert e.value.sentence == T.S_CAP and isinstance(e.value, T.CountCap)
    with pytest.raises(T.CountCap) as e:         # and so is duplicate
        T.duplicate(A, made["number"]["id"], now=NOW)
    assert (e.value.status, e.value.code) == (409, "count_cap")


def test_unit_17_chars_refused(T):
    with pytest.raises(T.TrackerError) as e:
        make(T, kind="number", unit="x" * 17)
    assert e.value.sentence == "A unit can be at most 16 characters."
    assert _count("j2_trackers") == 0
    t = make(T, kind="number", unit="y" * 16)
    assert t["unit"] == "y" * 16
    with pytest.raises(T.TrackerError) as e:
        T.update(A, t["id"], if_match=1, unit="z" * 17, now=NOW)
    assert e.value.sentence == T.S_UNIT
    assert T.get(A, t["id"])["unit"] == "y" * 16 and T.get(A, t["id"])["etag"] == 1
    assert T.update(A, t["id"], if_match=1, unit=None, now=NOW)["unit"] is None


def test_kind_is_fixed(T):
    t = make(T, kind="scale")
    for kind in ("number", "scale"):
        with pytest.raises(T.TrackerError) as e:
            T.update(A, t["id"], if_match=1, kind=kind, now=NOW)
        assert e.value.sentence == "A tracker's type can't change. Make a new tracker instead."
    got = T.get(A, t["id"])
    assert got["kind"] == "scale" and got["etag"] == 1


def test_update_if_match_archived_and_settings(T):
    t = make(T, kind="number", unit="kg")
    with pytest.raises(T.Conflict) as e:
        T.update(A, t["id"], if_match=2, name="Weight", now=NOW)
    assert e.value.status == 409 and T.get(A, t["id"])["name"] == "Sleep"
    with pytest.raises(T.Conflict):
        T.update(A, t["id"], if_match=True, name="Weight", now=NOW)
    u = T.update(A, t["id"], if_match=1, name="Weight", settings={"days": "any"}, now=NOW)
    assert (u["name"], u["unit"], u["settings"], u["etag"]) == ("Weight", "kg", {"days": "any"}, 2)
    with pytest.raises(T.TrackerError) as e:
        T.update(A, t["id"], if_match=2, settings={"days": "weekends"}, now=NOW)
    assert e.value.sentence == T.S_BAD_DAYS
    T.archive(A, t["id"], now=NOW)
    with pytest.raises(T.ReadOnly) as e:
        T.update(A, t["id"], if_match=2, name="Again", now=NOW)
    assert e.value.sentence == "Archived tracker, history only"
    with pytest.raises(T.ReadOnly):
        T.set_value(A, t["id"], "2026-11-06", 70, now=NOW)
    assert _count("j2_tracker_values") == 0


def test_template_key_create_returns_the_existing_row(T):
    a = make(T, kind="yesno", source_template_key="sleep-8h")
    b = make(T, name="Other", kind="number", source_template_key="sleep-8h")
    assert b["id"] == a["id"] and b["kind"] == "yesno" and _count("j2_trackers") == 1
    d = T.duplicate(A, a["id"], now=NOW)
    assert d["name"] == "Sleep copy" and d["kind"] == "yesno" and d["sourceTemplateKey"] is None


def test_recently_deleted_30_days(T):
    t = make(T, kind="number")
    T.set_value(A, t["id"], "2026-11-06", 3, now=NOW)
    with pytest.raises(T.TrackerError) as e:
        T.soft_delete(A, t["id"], typed_name="Sleep", now=NOW)
    assert e.value.sentence == T.S_ARCHIVE_FIRST
    T.archive(A, t["id"], now=NOW)
    with pytest.raises(T.TrackerError) as e:
        T.soft_delete(A, t["id"], typed_name="sleep", now=NOW)
    assert e.value.sentence == T.S_TYPE_NAME
    T.soft_delete(A, t["id"], typed_name="Sleep", now=NOW)
    assert T.get(A, t["id"]) is None
    assert [x["id"] for x in T.list_trackers(A, filter="deleted", now=NOW)] == [t["id"]]
    back = T.undelete(A, t["id"], now=NOW + timedelta(days=29))
    assert back["archived"] is True and back["deleted"] is False
    T.soft_delete(A, t["id"], typed_name="Sleep", now=NOW)
    with pytest.raises(T.NotFound):
        T.undelete(A, t["id"], now=NOW + timedelta(days=31))
    assert _count("j2_tracker_values") == 1
    T.list_trackers(A, now=NOW + timedelta(days=31))     # the purge runs on list
    assert _count("j2_trackers") == 0 and _count("j2_tracker_values") == 0


# ── values ─────────────────────────────────────────────────────────────────────────────────────

HOSTILE = [
    ("number", float("nan"), "Enter a number."),
    ("number", "1e309", "Enter a number."),
    ("number", float("inf"), "Enter a number."),
    ("number", float("-inf"), "Enter a number."),
    ("number", True, "Enter a number."),
    ("number", "5", "Enter a number."),
    ("number", 1e9 + 1, "Enter a number."),
    ("number", [1], "Enter a number."),
    ("scale", 6, "Pick a value from 1 to 5."),
    ("scale", 2.5, "Pick a value from 1 to 5."),
    ("scale", 0, "Pick a value from 1 to 5."),
    ("scale", True, "Pick a value from 1 to 5."),
    ("duration", -5, "A duration can be at most 24 hours."),
    ("duration", 1441, "A duration can be at most 24 hours."),
    ("duration", float("inf"), "Enter a number."),
    ("duration", True, "Enter a number."),
    ("yesno", 2, "Pick yes or no."),
    ("yesno", 0.5, "Pick yes or no."),
    ("yesno", "yes", "Pick yes or no."),
]


def test_hostile_values_refused_and_store_nothing(T):
    by_kind = {k: make(T, name=k, kind=k, settings={"days": "any"})
               for k in ("number", "scale", "duration", "yesno")}
    for kind, raw, sentence in HOSTILE:
        with pytest.raises(T.TrackerError) as e:
            T.set_value(A, by_kind[kind]["id"], "2026-11-06", raw, now=NOW)
        assert e.value.sentence == sentence, (kind, raw)
        assert e.value.status == 400 and e.value.code == "invalid"
    assert _count("j2_tracker_values") == 0
    ok = T.set_value(A, by_kind["duration"]["id"], "2026-11-06", 450, now=NOW)
    assert ok == {"day": "2026-11-06", "value": 450.0, "text": "7h 30m", "writable": True}


def test_null_clears_the_day(T):
    t = make(T, kind="scale")
    assert T.set_value(A, t["id"], "2026-11-05", 4, now=NOW)["text"] == "4"
    T.set_value(A, t["id"], "2026-11-05", 2, now=NOW)       # a second log replaces the first
    assert _count("j2_tracker_values") == 1
    out = T.set_value(A, t["id"], "2026-11-05", None, now=NOW)
    assert out == {"day": "2026-11-05", "value": None, "text": None, "writable": True}
    assert _count("j2_tracker_values") == 0
    day = T.read_days(A, [t["id"]], ["2026-11-05"], now=NOW)["trackers"][t["id"]]
    assert day["days"]["2026-11-05"]["value"] is None and day["n"] is None   # W9-R7
    assert day["latest"] is None and day["average"] is None


def test_trading_tracker_refuses_saturday_any_day_tracker_accepts_it(T):
    trading = make(T, name="Trading", kind="yesno")
    anyday = make(T, name="Any", kind="yesno", settings={"days": "any"})
    with pytest.raises(T.TrackerError) as e:
        T.set_value(A, trading["id"], "2026-11-07", 1, now=NOW)
    assert e.value.sentence == "This tracker logs trading days only."
    assert _count("j2_tracker_values") == 0
    out = T.set_value(A, anyday["id"], "2026-11-07", 1, now=NOW)
    assert out == {"day": "2026-11-07", "value": 1.0, "text": "Yes", "writable": True}
    read = T.read_days(A, [trading["id"], anyday["id"]], ["2026-11-07"], now=NOW)["trackers"]
    assert read[trading["id"]]["days"]["2026-11-07"]["writable"] is False
    assert read[anyday["id"]]["days"]["2026-11-07"]["writable"] is True


def test_window_matches_routines(T):
    from api.services.journal_two import routine_days, routines
    r = routines.create(A, name="Every", items=[{"text": "One"}], schedule={"kind": "every"},
                        now=at("2026-10-01"))
    item = r["items"][0]["id"]
    t = make(T, kind="number", settings={"days": "any"}, now=at("2026-10-01"))
    today = date(2026, 11, 6)
    assert routine_days.write_window(today) == (date(2026, 10, 28), date(2026, 11, 9))
    d = date(2026, 10, 20)
    seen = set()
    while d <= date(2026, 11, 16):
        iso = d.isoformat()
        try:
            routines.set_tick(A, r["id"], iso, item, True, now=NOW)
            routine_out = False
        except routines.OutsideWindow:
            routine_out = True
        except routines.RoutineError:      # an off day inside the window
            routine_out = False
        try:
            T.set_value(A, t["id"], iso, 1, now=NOW)
            tracker_out = False
        except T.OutsideWindow as e:
            assert e.sentence == routines.S_WINDOW
            tracker_out = True
        assert routine_out == tracker_out == (not routine_days.in_window(d, today)), iso
        seen.add(tracker_out)
        d += timedelta(days=1)
    assert seen == {True, False}           # the walk crossed both edges


def test_bad_day_and_unknown_tracker(T):
    t = make(T, kind="number")
    with pytest.raises(T.TrackerError) as e:
        T.set_value(A, t["id"], "2026/11/06", 1, now=NOW)
    assert e.value.sentence == "Dates need to look like 2026-10-24."
    with pytest.raises(T.NotFound) as e:
        T.set_value(A, str(uuid.uuid4()), "2026-11-06", 1, now=NOW)
    assert e.value.status == 404 and e.value.sentence == "Not available."


# ── built-ins ──────────────────────────────────────────────────────────────────────────────────

def test_builtins_listed_first_read_only_and_follow_latest_checkin(T):
    mine = make(T, kind="number")
    listed = T.list_trackers(A, now=NOW)
    assert [x["id"] for x in listed] == ["checkin:mood", "checkin:focus", mine["id"]]
    assert listed[0]["readOnly"] is True and listed[0]["kind"] == "scale"
    assert listed[0]["name"] == "Check-in mood" and listed[1]["name"] == "Check-in focus"
    assert T.list_trackers(A, filter="archived", now=NOW) == []
    assert T.get(A, "checkin:focus")["readOnly"] is True

    # two check-ins on one day: the later NOTE's mood wins (and an older one's focus survives)
    _note(A, "n-old", "2026-11-05T14:00:00+00:00")
    _note(A, "n-new", "2026-11-05T20:00:00+00:00")
    _checkin(A, "n-new", "2026-11-05", 4, None)
    _checkin(A, "n-old", "2026-11-05", 2, 3)
    # a trashed note's check-in is gone; a sample note's is never the member's
    _note(A, "n-trash", "2026-11-04T20:00:00+00:00", deleted=True)
    _checkin(A, "n-trash", "2026-11-04", 5, 5)
    _note(A, "n-sample", "2026-11-03T20:00:00+00:00", sample=True)
    _checkin(A, "n-sample", "2026-11-03", 1, 1)

    out = T.read_days(A, ["checkin:mood", "checkin:focus"],
                      ["2026-11-03", "2026-11-04", "2026-11-05"], now=NOW)["trackers"]
    mood = out["checkin:mood"]
    assert mood["tracker"]["readOnly"] is True
    assert mood["days"]["2026-11-05"] == {"day": "2026-11-05", "value": 4.0, "text": "4",
                                          "writable": False}
    assert mood["days"]["2026-11-04"]["value"] is None
    assert mood["days"]["2026-11-03"]["value"] is None
    assert mood["recent"] == [{"day": "2026-11-05", "value": 4.0}] and mood["n"] == 1
    assert out["checkin:focus"]["days"]["2026-11-05"]["value"] == 3.0

    for call, kw in ((T.set_value, {"day": "2026-11-05", "value": 3}),
                     (T.update, {"if_match": 1, "name": "x"}),
                     (T.archive, {}), (T.unarchive, {}), (T.undelete, {}), (T.duplicate, {}),
                     (T.soft_delete, {"typed_name": "Check-in mood"})):
        with pytest.raises(T.ReadOnly) as e:
            call(A, "checkin:mood", now=NOW, **kw)
        assert e.value.sentence == "Mood and focus come from your check-ins."
        assert e.value.status == 409 and e.value.code == "read_only"
    assert _count("j2_tracker_values") == 0 and _count("j2_trackers") == 1


def test_recent_30_oldest_first_and_average(T):
    t = make(T, kind="number", now=at("2026-09-01"))
    d, logged = date(2026, 9, 1), []
    from api.services.journal_two import trading_days
    while len(logged) < 35:
        if trading_days.is_session(d):
            T.set_value(A, t["id"], d.isoformat(), float(len(logged) + 1),
                        now=at(d.isoformat()))
            logged.append(d.isoformat())
        d += timedelta(days=1)
    today = at(logged[-1])
    out = T.read_days(A, [t["id"]], ["today"], now=today)
    got = out["trackers"][t["id"]]
    assert out["resolved"] == {"today": logged[-1]}
    assert [r["day"] for r in got["recent"]] == logged[-30:]
    assert [r["value"] for r in got["recent"]] == [float(v) for v in range(6, 36)]
    assert got["n"] == 30
    assert math.isclose(got["average"], sum(range(6, 36)) / 30)
    assert got["latest"] == {"day": logged[-1], "value": 35.0}
    assert got["days"][logged[-1]]["value"] == 35.0


def test_read_days_limits(T):
    with pytest.raises(T.TrackerError) as e:
        T.read_days(A, [str(uuid.uuid4()) for _ in range(31)], ["today"], now=NOW)
    assert e.value.sentence == "Ask for at most 30 trackers at once."
    days = [(date(2026, 10, 1) + timedelta(days=i)).isoformat() for i in range(32)]
    with pytest.raises(T.TrackerError) as e:
        T.read_days(A, [], days, now=NOW)
    assert e.value.sentence == "Ask for at most 31 days at once."
    assert T.read_days(A, [], ["today"], now=at("2026-11-07")) == {
        "trackers": {}, "resolved": {"today": "2026-11-09"}}


# ── no note writes ─────────────────────────────────────────────────────────────────────────────

def test_no_j2_notes_write(T):
    _note(A, "n1", "2026-11-05T20:00:00+00:00")
    _checkin(A, "n1", "2026-11-05", 4, 2)
    c = _conn()
    seen: list[str] = []
    c.set_trace_callback(seen.append)
    try:
        t = T.create(A, name="Traced", kind="number", unit="x", now=NOW, conn=c)
        T.update(A, t["id"], if_match=1, name="Traced 2", now=NOW, conn=c)
        T.set_value(A, t["id"], "2026-11-06", 5, now=NOW, conn=c)
        T.set_value(A, t["id"], "2026-11-06", None, now=NOW, conn=c)
        T.list_trackers(A, now=NOW, conn=c)
        out = T.read_days(A, [t["id"], "checkin:mood"], ["today", "2026-11-05"], now=NOW,
                          conn=c)
    finally:
        c.set_trace_callback(None)
        c.close()
    assert out["trackers"]["checkin:mood"]["days"]["2026-11-05"]["value"] == 4.0
    assert any("j2_tracker_values" in s for s in seen)       # the trace saw the work
    assert any("j2_notes" in s for s in seen)                # the built-in READ is allowed
    # A write is a statement that LEADS with a write verb ("updated_at" is not an UPDATE).
    writes = [s for s in seen if "j2_notes" in s and s.lstrip().split(None, 1)[0].upper()
              in ("INSERT", "UPDATE", "DELETE", "REPLACE")]
    assert writes == []
    # And every statement naming the notes table at all is a SELECT.
    assert [s for s in seen if re.search(r"\bj2_notes\b", s)
            and not s.lstrip().upper().startswith("SELECT")] == []


# ── review round 1 ─────────────────────────────────────────────────────────────────────────────

def test_both_stores_refuse_through_one_tool_error_base(T):
    from api.services.journal_two import routines
    from api.services.journal_two.tool_errors import ToolError
    assert issubclass(T.TrackerError, ToolError) and issubclass(routines.RoutineError, ToolError)
    for mod in (T, routines):
        for name in ("NotFound", "Conflict", "OutsideWindow", "ReadOnly"):
            assert issubclass(getattr(mod, name), ToolError)
    e = T.NotFound()
    assert isinstance(e, ToolError) and (e.status, e.code, e.sentence) == (404, "not_found",
                                                                          "Not available.")


@pytest.mark.parametrize("bad", ["2026-W45-5", "2026-11-6", "20261106", "9999-12-31",
                                 "0001-01-01", "1989-12-31"])
def test_bad_days_refused_on_read_and_write(T, bad):
    t = make(T, kind="number", settings={"days": "any"})
    with pytest.raises(T.TrackerError) as e:
        T.set_value(A, t["id"], bad, 1, now=NOW)
    assert e.value.sentence == "Dates need to look like 2026-10-24."
    with pytest.raises(T.TrackerError) as e:
        T.read_days(A, [t["id"]], [bad], now=NOW)
    assert e.value.sentence == "Dates need to look like 2026-10-24."
    assert _count("j2_tracker_values") == 0


def test_day_range_edges_are_read(T):
    t = make(T, kind="number")
    far = (date(2026, 11, 6) + timedelta(days=366)).isoformat()
    out = T.read_days(A, [t["id"]], ["1990-01-01", far], now=NOW)["trackers"][t["id"]]
    assert set(out["days"]) == {"1990-01-01", far}
    with pytest.raises(T.TrackerError):
        T.read_days(A, [t["id"]], [(date(2026, 11, 6) + timedelta(days=367)).isoformat()],
                    now=NOW)


def test_bad_ids_get_a_request_sentence(T):
    for bad in ("x", [1], None):
        with pytest.raises(T.TrackerError) as e:
            T.read_days(A, bad, ["today"], now=NOW)
        assert e.value.sentence == "Pick up to 30 trackers."


def test_non_string_unit_is_the_unit_sentence(T):
    for bad in (5, ["kg"], True):
        with pytest.raises(T.TrackerError) as e:
            make(T, kind="number", unit=bad)
        assert e.value.sentence == "A unit can be at most 16 characters."
    assert _count("j2_trackers") == 0


def _statements(T, ids, days):
    c = _conn()
    seen: list[str] = []
    c.set_trace_callback(seen.append)
    try:
        out = T.read_days(A, ids, days, now=NOW, conn=c)
    finally:
        c.set_trace_callback(None)
        c.close()
    return out, [s for s in seen if s.lstrip().upper().startswith("SELECT")]


def test_batched_read_statement_count_does_not_grow_with_trackers(T):
    _note(A, "n1", "2026-11-05T20:00:00+00:00")
    _checkin(A, "n1", "2026-11-05", 4, 2)
    made = [make(T, name=f"T{i}", kind="number") for i in range(6)]
    for t in made:
        T.set_value(A, t["id"], "2026-11-05", 3, now=NOW)
    days = ["today", "2026-11-05", "2026-11-04"]
    one, few = _statements(T, [made[0]["id"], "checkin:mood"], days)
    six, many = _statements(T, [t["id"] for t in made] + ["checkin:mood", "checkin:focus"],
                            days)
    assert len(six["trackers"]) == 8 and len(one["trackers"]) == 2
    assert len(many) == len(few) == 3          # trackers, values, check-ins
    assert sum("j2_note_checkins" in s for s in many) == 1
    assert sum("j2_tracker_values" in s for s in many) == 1
    assert six["trackers"]["checkin:focus"]["days"]["2026-11-05"]["value"] == 2.0
    assert all(six["trackers"][t["id"]]["days"]["2026-11-05"]["value"] == 3.0 for t in made)


def test_template_key_create_restores_a_deleted_tracker_live(T):
    t = make(T, kind="yesno", source_template_key="slept-8h")
    T.set_value(A, t["id"], "2026-11-05", 1, now=NOW)
    T.archive(A, t["id"], now=NOW)
    T.soft_delete(A, t["id"], typed_name="Sleep", now=NOW)
    back = make(T, name="Other", kind="number", source_template_key="slept-8h",
                now=NOW + timedelta(days=2))
    assert back["id"] == t["id"] and back["deleted"] is False and back["archived"] is False
    assert back["kind"] == "yesno" and T.get(A, t["id"])["deleted"] is False
    assert _count("j2_tracker_values") == 1                       # its history came back too
    # the cap is checked on the way back
    T.archive(A, t["id"], now=NOW)
    T.soft_delete(A, t["id"], typed_name="Sleep", now=NOW)
    fill = [make(T, name=f"F{i}", kind="number") for i in range(30)]
    with pytest.raises(T.TrackerError) as e:
        make(T, kind="yesno", source_template_key="slept-8h", now=NOW + timedelta(days=2))
    assert e.value.sentence == T.S_CAP and isinstance(e.value, T.CountCap)
    assert [x["id"] for x in T.list_trackers(A, filter="deleted", now=NOW)] == [t["id"]]
    # past the 30 days it is gone, and the template starts afresh
    T.archive(A, fill[0]["id"], now=NOW)
    fresh = make(T, kind="yesno", source_template_key="slept-8h", now=NOW + timedelta(days=31))
    assert fresh["id"] != t["id"] and _count("j2_tracker_values") == 0


def test_summary_is_as_of_the_latest_requested_day(T):
    t = make(T, kind="number", now=at("2026-10-01"))
    for day, v in (("2026-10-12", 1), ("2026-10-13", 2), ("2026-10-14", 3), ("2026-10-15", 10),
                   ("2026-10-16", 20)):
        T.set_value(A, t["id"], day, v, now=at(day))
    got = T.read_days(A, [t["id"]], ["2026-10-14"], now=at("2026-10-16"))["trackers"][t["id"]]
    assert [r["day"] for r in got["recent"]] == ["2026-10-12", "2026-10-13", "2026-10-14"]
    assert got["latest"] == {"day": "2026-10-14", "value": 3.0}
    assert got["n"] == 3 and math.isclose(got["average"], 2.0)
    later = T.read_days(A, [t["id"]], ["2026-10-14", "2026-10-16"],
                        now=at("2026-10-16"))["trackers"][t["id"]]
    assert later["n"] == 5 and later["latest"]["value"] == 20.0
    # the built-ins follow the same rule: a check-in after the requested day is not counted
    _note(A, "n-14", "2026-10-14T20:00:00+00:00")
    _note(A, "n-15", "2026-10-15T20:00:00+00:00")
    _checkin(A, "n-14", "2026-10-14", 2, None)
    _checkin(A, "n-15", "2026-10-15", 5, None)
    mood = T.read_days(A, ["checkin:mood"], ["2026-10-14"],
                       now=at("2026-10-16"))["trackers"]["checkin:mood"]
    assert mood["recent"] == [{"day": "2026-10-14", "value": 2.0}] and mood["n"] == 1
    assert mood["latest"] == {"day": "2026-10-14", "value": 2.0}
