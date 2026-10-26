"""Notebook widgets phase 2, wave 11, Task 11.6: the routines and trackers a template can make.

`template_tools` is the ONE table of template tool keys: four routine templates DERIVE from `routines.STARTERS`, the
rest are written there item for item; the unique key a template-made tool is created under (W11-R13); and the reuse
question's `best_match`, read only from the member's own rows."""
from __future__ import annotations

import importlib
from datetime import datetime, timezone

import pytest

A, B = "u-tt-a", "u-tt-b"


def at(day: str, hour_utc: int = 17) -> datetime:
    y, m, d = (int(x) for x in day.split("-"))
    return datetime(y, m, d, hour_utc, 0, tzinfo=timezone.utc)


@pytest.fixture
def db(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield
    importlib.reload(auth_db)


def _tt():
    from api.services.journal_two import template_tools
    return template_tools


def _routine(user, name, items, day="2026-11-02"):
    from api.services.journal_two import routines
    return routines.create(user, name=name, items=[{"text": t} for t in items], schedule={"kind": "every"},
                           now=at(day))


def _tracker(user, name, kind, day="2026-11-02"):
    from api.services.journal_two import trackers
    return trackers.create(user, name=name, kind=kind, now=at(day))


# ── the tables ──────────────────────────────────────────────────────────────────────────────────

def test_four_templates_derive_from_starters(monkeypatch):
    from api.services.journal_two import routines
    tt = _tt()
    pairs = {"premarket_routine": "premarket", "preentry_checks": "preentry", "eod_review": "eod",
             "rules_i_keep": "rules"}
    for key, starter in pairs.items():
        assert tt.ROUTINE_TEMPLATES[key] == {"name": routines.STARTERS[starter]["name"],
                                             "items": routines.STARTERS[starter]["items"]}
    # Moving a starter's item moves the template: the four are read from STARTERS, never copied at import.
    moved = dict(routines.STARTERS["premarket"])
    moved["items"] = [routines.STARTERS["premarket"]["items"][1], routines.STARTERS["premarket"]["items"][0],
                      *routines.STARTERS["premarket"]["items"][2:]]
    monkeypatch.setitem(routines.STARTERS, "premarket", moved)
    got = tt.ROUTINE_TEMPLATES["premarket_routine"]["items"]
    assert [i["text"] for i in got[:2]] == ["Check today's economic calendar", "Read the morning wire"]
    # a read is a fresh copy: changing it never changes a starter
    got[0]["text"] = "zzz"
    assert routines.STARTERS["premarket"]["items"][0]["text"] == "Check today's economic calendar"


def test_new_routine_templates_exact():
    tt = _tt()

    def it(text, negative=False, suggest=None):
        return {"text": text, "negative": negative, "suggest": suggest}
    assert tt.ROUTINE_TEMPLATES["night_before"] == {"name": "Night-before prep", "items": [
        it("Build tomorrow's watchlist"), it("Mark levels on my top names"),
        it("Check tomorrow's earnings and economic calendar"), it("Set tomorrow's max loss"),
        it("Write my plan for the open")]}
    assert tt.ROUTINE_TEMPLATES["tilt_reset"] == {"name": "Tilt reset", "items": [
        it("Step away from the screen for 10 minutes"), it("Write what happened in one line"),
        it("Check my room under my daily loss limit"), it("Decide: done for the day, or one A+ setup only")]}
    assert tt.ROUTINE_TEMPLATES["weekly_review_routine"] == {"name": "Weekly review", "items": [
        it("Review every trade of the week"), it("Tag setups and mistakes"), it("Update my playbook"),
        it("Set one goal for next week")]}
    assert tt.ROUTINE_TEMPLATES["swing_weekend"] == {"name": "Weekend swing review", "items": [
        it("Review every open position and its stop"), it("Check earnings dates for my holdings"),
        it("Build next week's watchlist"), it("Set my risk for next week")]}
    assert tt.ROUTINE_TEMPLATES["morning_routine"] == {"name": "Morning routine", "items": [
        it("Up with time to prep before the bell"), it("Exercise or a walk"), it("Read the morning wire"),
        it("Review my rules")]}
    assert tt.ROUTINE_TEMPLATES["consistency_30"] == {"name": "30-day consistency", "items": [
        it("Followed my trading plan"),
        it("Stayed under my daily loss limit", suggest={"rule": "under_daily_loss_limit"}),
        it("Logged every trade"), it("No revenge trades", True, {"rule": "no_revenge"})]}
    assert list(tt.ROUTINE_TEMPLATES) == ["premarket_routine", "preentry_checks", "eod_review", "rules_i_keep",
                                          "night_before", "tilt_reset", "weekly_review_routine", "swing_weekend",
                                          "morning_routine", "consistency_30"]
    assert "premarket" not in tt.ROUTINE_TEMPLATES and "sleep" not in tt.ROUTINE_TEMPLATES
    # every key reads through the store's own item rules (the slot grammar accepts each one)
    from api.services.journal_two import journal_styles as js
    for key in tt.ROUTINE_TEMPLATES:
        assert js._TEMPLATE_KEY_RE.fullmatch(key)


def test_tracker_templates_exact():
    tt = _tt()
    assert dict(tt.TRACKER_TEMPLATES) == {
        "sleep": {"name": "Sleep", "kind": "duration", "unit": None},
        "energy": {"name": "Energy", "kind": "scale"},
        "exercise": {"name": "Exercise", "kind": "yesno"},
        "plan_followed": {"name": "Followed my trading plan", "kind": "yesno"}}
    from api.services.journal_two import tracker_days
    assert all(t["kind"] in tracker_days.KINDS for t in tt.TRACKER_TEMPLATES.values())
    assert tt.S_CHOOSE_ROUTINE == "Choose a routine for each routine in this template."
    assert tt.S_CHOOSE_TRACKER == "Choose a tracker for each tracker in this template."
    from api.services.journal_two.tool_errors import ToolError
    err = tt.LibraryError(tt.S_CHOOSE_ROUTINE)
    assert isinstance(err, ToolError) and err.sentence == tt.S_CHOOSE_ROUTINE and err.status == 400
    assert err.code == "unresolved"


def test_template_key_shape_and_64_cap():
    tt = _tt()
    assert tt.template_key("routine", template="premarket_routine") == "tpl:premarket_routine"
    assert tt.template_key("tracker", template="sleep") == "tpl:sleep"
    gid = "g" * 32
    assert tt.template_key("routine", gallery_id=gid, inline="r1") == f"gal:{gid}:r1"
    # exactly 64 is allowed; one more is refused (the stores would truncate it into another template's key)
    room = 64 - len("gal::r1")
    assert len(tt.template_key("routine", gallery_id="x" * room, inline="r1")) == 64
    with pytest.raises(ValueError):
        tt.template_key("routine", gallery_id="x" * (room + 1), inline="r1")
    for bad in ({"template": "a", "inline": "r1"}, {}, {"gallery_id": gid}, {"inline": "r1"},
                {"template": ""}):
        with pytest.raises(ValueError):
            tt.template_key("routine", **bad)
    with pytest.raises(ValueError):
        tt.template_key("widget", template="sleep")
    from api.services.journal_two import routines, trackers
    assert tt.KEY_MAX == routines._TEMPLATE_KEY_MAX == trackers._TEMPLATE_KEY_MAX


# ── best_match ──────────────────────────────────────────────────────────────────────────────────

def test_best_match_name_and_items_and_ties(db):
    tt = _tt()
    wanted = tt.ROUTINE_TEMPLATES["premarket_routine"]                  # "Pre-market routine"
    assert tt.best_match(A, "routine", wanted) is None                  # nothing of the member's yet
    morning = _routine(A, "Morning routine", ["Coffee"], day="2026-11-02")           # shares "routine": 1
    assert tt.best_match(A, "routine", wanted) == {"id": morning["id"], "name": "Morning routine"}
    prep = _routine(A, "Prep", ["Read the morning wire", "Set my max loss for today"], day="2026-10-01")  # 2 items
    assert tt.best_match(A, "routine", wanted)["id"] == prep["id"]      # items count: 2 beats 1
    # a tie goes to the newest edit
    newer = _routine(A, "Market prep", ["Coffee"], day="2026-11-03")   # "market": 1 ... plus nothing else
    older = _routine(A, "Routine two", ["Coffee"], day="2026-10-02")    # "routine": 1
    got = tt.best_match(A, "routine", {"name": "Market routine", "items": []})
    assert got["id"] in (newer["id"], morning["id"], older["id"])
    assert got["id"] == newer["id"]                                      # 1 each; newest updatedAt wins
    # score 0 is no match
    assert tt.best_match(A, "routine", {"name": "Zebra", "items": [{"text": "Unrelated"}]}) is None
    # an archived routine is never suggested
    from api.services.journal_two import routines
    routines.archive(A, prep["id"], now=at("2026-11-04"))
    assert tt.best_match(A, "routine", wanted)["id"] != prep["id"]
    # trackers: same kind required, names scored the same way
    sleep_tpl = tt.TRACKER_TEMPLATES["sleep"]
    _tracker(A, "Sleep quality", "scale")
    assert tt.best_match(A, "tracker", sleep_tpl) is None               # a scale is not a duration
    hours = _tracker(A, "Hours of sleep", "duration")
    assert tt.best_match(A, "tracker", sleep_tpl) == {"id": hours["id"], "name": "Hours of sleep"}
    # the check-in trackers are never the member's own candidate
    assert all(c["id"].count(":") == 0 for c in tt.candidates(A, "tracker"))


def test_best_match_never_reads_another_member(db):
    tt = _tt()
    other = _routine(B, "Pre-market routine", ["Read the morning wire"])
    _tracker(B, "Sleep", "duration")
    assert tt.best_match(A, "routine", tt.ROUTINE_TEMPLATES["premarket_routine"]) is None
    assert tt.best_match(A, "tracker", tt.TRACKER_TEMPLATES["sleep"]) is None
    # every statement the candidate reads run is bound to the session member only
    from api.services import auth_db
    conn = auth_db.get_connection()
    seen: list[str] = []
    conn.set_trace_callback(seen.append)
    try:
        tt.candidates(A, "routine", conn=conn)
        tt.candidates(A, "tracker", conn=conn)
    finally:
        conn.set_trace_callback(None)
        conn.close()
    reads = [s for s in seen if "j2_routines" in s or "j2_trackers" in s]
    assert len(reads) == 2                                               # one read per family
    assert all(f"'{A}'" in s and B not in s for s in reads), reads
    assert other["id"] not in "".join(seen)
