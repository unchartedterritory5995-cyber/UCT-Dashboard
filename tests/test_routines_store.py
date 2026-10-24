"""Task 9.4 - the routine store: CRUD, schedules, ticks, skips and the batched day read.

Real auth.db schema (db.ensure_schema through auth_db.init_db) in a tmp dir and an injected
`now`: nothing sleeps. Dates are real 2026 sessions (ET).
"""
from __future__ import annotations

import importlib
import json
import threading
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

A, B = "u-routine-a", "u-routine-b"


def at(day: str, hour_utc: int = 17) -> datetime:
    """Noon-ish ET on `day` (17:00 UTC is 12:00 or 13:00 ET)."""
    y, m, d = (int(x) for x in day.split("-"))
    return datetime(y, m, d, hour_utc, 0, tzinfo=timezone.utc)


@pytest.fixture
def R(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.journal_two import routines
    yield routines
    importlib.reload(auth_db)


def _conn():
    from api.services import auth_db
    return auth_db.get_connection()


ITEMS = [{"text": "Read the wire"}, {"text": "Set max loss"}]
EVERY = {"kind": "every"}


def make(R, user=A, *, day="2026-11-02", items=None, schedule=None, **kw):
    return R.create(user, name=kw.pop("name", "Morning"), items=items or ITEMS,
                    schedule=schedule or EVERY, now=at(day), **kw)


def ids(r):
    return [i["id"] for i in r["items"]]


# ── CRUD ───────────────────────────────────────────────────────────────────────────────────────

def test_create_get_owned_only(R):
    r = make(R)
    assert r["name"] == "Morning" and [i["text"] for i in r["items"]] == ["Read the wire",
                                                                        "Set max loss"]
    assert all(uuid.UUID(i) for i in ids(r))
    assert r["schedule"] == EVERY and r["createdDay"] == "2026-11-02"
    assert r["settings"] == {"done_share": 1.0, "strict": False, "reminder": None}
    assert r["etag"] == 1 and r["usedIn"] == 0 and r["archived"] is False
    got = R.get(A, r["id"], now=at("2026-11-03"))
    assert got["id"] == r["id"]
    assert R.get(B, r["id"]) is None
    assert R.get(A, "nope") is None
    with _conn() as c:
        items = json.loads(c.execute("SELECT items_json FROM j2_routines WHERE id = ?",
                                     (r["id"],)).fetchone()[0])
        assert {i["from"] for i in items} == {"2026-11-02"} and {i["to"] for i in items} == {None}
        rows = c.execute("SELECT effective_from, schedule_json FROM j2_routine_schedules"
                         " WHERE routine_id = ?", (r["id"],)).fetchall()
    assert [(x[0], json.loads(x[1])) for x in rows] == [("2026-11-02", EVERY)]


def test_cap_30_sentence(R):
    for i in range(30):
        make(R, name=f"R{i}")
    with pytest.raises(R.RoutineError) as e:
        make(R, name="one more")
    assert e.value.sentence == "You have 30 routines. Archive one in My tools to make room."
    # archived ones do not count
    first = R.list_routines(A)[0]
    R.archive(A, first["id"], now=at("2026-11-02"))
    make(R, name="fits now")


@pytest.mark.parametrize("kw, sentence", [
    ({"name": "x" * 81}, "A name can be at most 80 characters."),
    ({"name": "  "}, "Give the routine a name."),
    ({"items": [{"text": "y" * 201}]}, "An item can be at most 200 characters."),
    ({"items": [{"text": f"i{n}"} for n in range(26)]}, "A routine can hold up to 25 items."),
    ({"items": []}, "Add at least one item."),
    ({"items": [{"text": "   "}]}, "Add at least one item."),
    ({"schedule": {"kind": "monthly"}}, "Pick when this routine runs."),
    ({"schedule": {"kind": "weekdays", "days": [5]}}, "Pick when this routine runs."),
    ({"settings": {"reminder": {"on": True, "time_et": "09:07"}}},
     "Pick a reminder time in 5-minute steps."),
    ({"settings": {"done_share": 0.6}}, "Pick how much of the routine counts as done."),
])
def test_field_caps(R, kw, sentence):
    args = {"name": "Ok", "items": ITEMS, "schedule": EVERY, **kw}
    with pytest.raises(R.RoutineError) as e:
        R.create(A, now=at("2026-11-02"), **args)
    assert e.value.sentence == sentence
    assert R.list_routines(A) == []


def test_field_caps_accept_the_edges(R):
    r = R.create(A, name="n" * 80, items=[{"text": "t" * 200}] * 25,
                 schedule={"kind": "weekdays", "days": [4, 0, 2, 0]},
                 settings={"done_share": 0.75, "reminder": {"on": True, "time_et": "09:05"}},
                 now=at("2026-11-02"))
    assert len(r["items"]) == 25 and r["schedule"] == {"kind": "weekdays", "days": [0, 2, 4]}
    assert r["settings"]["reminder"] == {"on": True, "time_et": "09:05"}


def test_template_key_create_is_idempotent(R):
    one = make(R, source_template_key="premarket")
    two = make(R, source_template_key="premarket", name="Other")
    assert two["id"] == one["id"] and two["name"] == "Morning"
    with _conn() as c:
        assert c.execute("SELECT COUNT(*) FROM j2_routines WHERE user_id = ?",
                         (A,)).fetchone()[0] == 1
    assert make(R, B, source_template_key="premarket")["id"] != one["id"]


def test_update_if_match_conflict_and_etag_bumps(R):
    r = make(R)
    with pytest.raises(R.Conflict) as e:
        R.update(A, r["id"], if_match=99, name="New", now=at("2026-11-03"))
    assert e.value.sentence == "Changed in another tab. Reload to see the newer version."
    assert R.get(A, r["id"])["name"] == "Morning"
    u = R.update(A, r["id"], if_match=1, name="New", now=at("2026-11-03"))
    assert u["etag"] == 2 and u["name"] == "New"
    with pytest.raises(R.Conflict):
        R.update(A, r["id"], if_match=1, name="Stale", now=at("2026-11-03"))
    with pytest.raises(R.NotFound):
        R.update(B, r["id"], if_match=2, name="Theirs", now=at("2026-11-03"))


def test_rename_item_keeps_history_remove_applies_from_today(R):
    r = make(R, day="2026-10-19")
    x, y = ids(r)
    R.set_tick(A, r["id"], "2026-10-20", x, True, now=at("2026-10-20"))
    R.set_tick(A, r["id"], "2026-10-20", y, True, now=at("2026-10-20"))
    u = R.update(A, r["id"], if_match=1, now=at("2026-10-22"),
                 items=[{"id": y, "text": "Set max loss (renamed)"}, {"text": "New one"}])
    assert ids(u)[0] == y and u["items"][0]["text"] == "Set max loss (renamed)"
    out = R.read_days(A, [r["id"]], ["2026-10-20", "2026-10-22"], now=at("2026-10-22"))
    d20 = out["routines"][r["id"]]["days"]["2026-10-20"]
    d22 = out["routines"][r["id"]]["days"]["2026-10-22"]
    assert {i["id"] for i in d20["items"]} == {x, y}
    assert d20["ticked"] == {x: True, y: True} and d20["state"] == "done"
    assert x not in {i["id"] for i in d22["items"]} and y in {i["id"] for i in d22["items"]}
    new_id = ids(u)[1]
    assert new_id not in {i["id"] for i in d20["items"]}
    with pytest.raises(R.RoutineError) as e:
        R.set_tick(A, r["id"], "2026-10-22", x, True, now=at("2026-10-22"))
    assert e.value.sentence == "That item isn't in this routine."
    R.set_tick(A, r["id"], "2026-10-21", x, True, now=at("2026-10-22"))   # still valid then


def test_schedule_change_never_rewrites_past_days(R):
    r = make(R, day="2026-10-01")
    R.update(A, r["id"], if_match=1, schedule={"kind": "weekdays", "days": [0, 2, 4]},
             now=at("2026-10-14"))
    out = R.read_days(A, [r["id"]], ["2026-10-13", "2026-10-20", "2026-10-21"],
                      now=at("2026-10-22"))["routines"][r["id"]]["days"]
    assert out["2026-10-13"]["state"] != "off"         # Tue, before the change
    assert out["2026-10-20"]["state"] == "off"         # Tue, after it
    assert out["2026-10-21"]["state"] == "not_done"    # Wed
    # same-day change replaces that day's row; nothing earlier moves
    R.update(A, r["id"], if_match=2, schedule={"kind": "weekdays", "days": [1]},
             now=at("2026-10-14", 20))
    with _conn() as c:
        rows = c.execute("SELECT effective_from, schedule_json FROM j2_routine_schedules"
                         " WHERE routine_id = ? ORDER BY effective_from", (r["id"],)).fetchall()
    assert [(x[0], json.loads(x[1])) for x in rows] == [
        ("2026-10-01", EVERY), ("2026-10-14", {"kind": "weekdays", "days": [1]})]


def test_tick_window_refuses_eighth_session_back_and_two_sessions_ahead(R):
    r = make(R, day="2026-11-02")
    item = ids(r)[0]
    now = at("2026-12-01")
    R.set_tick(A, r["id"], "2026-11-19", item, True, now=now)
    R.set_tick(A, r["id"], "2026-12-02", item, True, now=now)
    for bad in ("2026-11-18", "2026-12-03"):
        with pytest.raises(R.OutsideWindow) as e:
            R.set_tick(A, r["id"], bad, item, True, now=now)
        assert e.value.sentence == "Ticks can be added up to 7 trading days back."
        with pytest.raises(R.OutsideWindow):
            R.set_skipped(A, r["id"], bad, True, now=now)
    with pytest.raises(R.RoutineError) as e:
        R.set_tick(A, r["id"], "2026/12/01", item, True, now=now)
    assert e.value.sentence == "Dates need to look like 2026-10-24."


def test_tick_on_a_past_off_day_is_refused_but_today_of_a_traded_schedule_is_not(R):
    r = make(R, day="2026-11-02", schedule={"kind": "traded"})
    item = ids(r)[0]
    with pytest.raises(R.RoutineError) as e:   # no trade on 11-30: a past off day
        R.set_tick(A, r["id"], "2026-11-30", item, True, now=at("2026-12-01"))
    assert e.value.sentence == "This routine didn't run that day."
    R.set_tick(A, r["id"], "2026-12-01", item, True, now=at("2026-12-01"))   # W9-R8
    R.set_tick(A, r["id"], "2026-12-02", item, True, now=at("2026-12-01"))


def test_concurrent_ticks_both_survive(R):
    r = make(R, day="2026-11-02")
    a, b = ids(r)
    now = at("2026-11-03")
    barrier = threading.Barrier(2)
    errors: list = []

    def tick(item):
        try:
            barrier.wait()
            R.set_tick(A, r["id"], "2026-11-03", item, True, now=now)
        except Exception as e:      # pragma: no cover - the assertion reports it
            errors.append(e)

    ts = [threading.Thread(target=tick, args=(i,)) for i in (a, b)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert errors == []
    day = R.read_days(A, [r["id"]], ["2026-11-03"], now=now)["routines"][r["id"]]["days"][
        "2026-11-03"]
    assert day["ticked"] == {a: True, b: True} and day["state"] == "done"


def test_tick_returns_merged_day(R):
    r = make(R, day="2026-11-02")
    a, b = ids(r)
    now = at("2026-11-04")
    R.set_tick(A, r["id"], "2026-11-03", a, True, now=now)
    got = R.set_tick(A, r["id"], "2026-11-03", b, True, now=now)
    read = R.read_days(A, [r["id"]], ["2026-11-03"], now=now)["routines"][r["id"]]["days"][
        "2026-11-03"]
    assert got == read and got["state"] == "done" and got["partial"] == "2 of 2"
    off = R.set_tick(A, r["id"], "2026-11-03", b, False, now=now)
    assert off["ticked"] == {a: True, b: False} and off["partial"] == "1 of 2"
    assert off["state"] == "not_done" and off["label"] == "Not done"
    sk = R.set_skipped(A, r["id"], "2026-11-03", True, now=now)
    assert sk["state"] == "skipped" and sk["skipped"] is True
    assert sk == R.read_days(A, [r["id"]], ["2026-11-03"], now=now)["routines"][r["id"]][
        "days"]["2026-11-03"]


def test_archived_is_read_only(R):
    r = make(R, day="2026-11-02")
    R.archive(A, r["id"], now=at("2026-11-03"))
    for call in (lambda: R.set_tick(A, r["id"], "2026-11-03", ids(r)[0], True,
                                    now=at("2026-11-03")),
                 lambda: R.set_skipped(A, r["id"], "2026-11-03", True, now=at("2026-11-03")),
                 lambda: R.update(A, r["id"], if_match=1, name="x", now=at("2026-11-03"))):
        with pytest.raises(R.ReadOnly) as e:
            call()
        assert e.value.sentence == "Archived routine, history only"
    read = R.read_days(A, [r["id"]], ["2026-11-03"], now=at("2026-11-03"))["routines"][r["id"]]
    assert read["routine"]["archived"] is True and read["days"]["2026-11-03"]["writable"] is False
    assert R.unarchive(A, r["id"], now=at("2026-11-03"))["archived"] is False


def test_today_token_resolves_to_next_session_on_saturday(R):
    r = make(R, day="2026-11-02")
    out = R.read_days(A, [r["id"]], ["today"], now=at("2026-11-28"))
    assert out["resolved"] == {"today": "2026-11-30"}
    assert list(out["routines"][r["id"]]["days"]) == ["2026-11-30"]
    assert out["routines"][r["id"]]["days"]["2026-11-30"]["state"] == "open"
    # late on a Wednesday ET (04:30 UTC Thursday) is still Wednesday
    late = R.read_days(A, [r["id"]], ["today"], now=datetime(2026, 11, 19, 4, 30,
                                                             tzinfo=timezone.utc))
    assert late["resolved"] == {"today": "2026-11-18"}


def test_consistency_and_run_lines_as_of_the_bound_day(R):
    r = make(R, day="2026-11-02")
    for d in ("2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"):
        for i in ids(r):
            R.set_tick(A, r["id"], d, i, True, now=at(d))
    days = R.read_days(A, [r["id"]], ["2026-11-03", "2026-11-04", "2026-11-06"],
                       now=at("2026-11-09"))["routines"][r["id"]]["days"]
    assert days["2026-11-03"]["consistency"] == "2 of the last 2 trading days"
    assert days["2026-11-03"]["run"] == {"line": None, "milestone": False, "best": None}
    assert days["2026-11-04"]["consistency"] == "3 of the last 3 trading days"
    assert days["2026-11-04"]["run"]["line"] == "3 sessions in a row"
    assert days["2026-11-06"]["consistency"] == "5 of the last 5 trading days"
    assert days["2026-11-06"]["rate"] == 1.0
    assert days["2026-11-06"]["run"]["line"] == "5 sessions in a row"
    # a missed Monday ends the run; the best run shows once none is
    nine = R.read_days(A, [r["id"]], ["2026-11-10"], now=at("2026-11-11"))["routines"][
        r["id"]]["days"]["2026-11-10"]
    assert nine["consistency"] == "5 of the last 7 trading days"
    assert nine["run"] == {"line": None, "milestone": False, "best": "Best run: 5 sessions"}


def test_new_routine_has_no_consistency_or_run_line(R):
    r = make(R, day="2026-11-02")
    day = R.read_days(A, [r["id"]], ["2026-11-02"], now=at("2026-11-02"))["routines"][r["id"]][
        "days"]["2026-11-02"]
    assert day["consistency"] is None and day["rate"] is None
    assert day["run"] == {"line": None, "milestone": False, "best": None}
    assert day["partial"] is None and day["state"] == "open"
    # a not-done day with no ticks never reads "0 of 2"
    later = R.read_days(A, [r["id"]], ["2026-11-02"], now=at("2026-11-03"))["routines"][
        r["id"]]["days"]["2026-11-02"]
    assert later["state"] == "not_done" and later["partial"] is None
    assert later["consistency"] is None


def test_read_days_caps_and_absent_ids(R):
    r = make(R, day="2026-11-02")
    with pytest.raises(R.RoutineError):
        R.read_days(A, [f"x{i}" for i in range(31)], ["today"], now=at("2026-11-03"))
    with pytest.raises(R.RoutineError):
        R.read_days(A, [r["id"]], [(date(2026, 10, 1) + timedelta(days=i)).isoformat()
                                   for i in range(32)], now=at("2026-11-03"))
    with pytest.raises(R.RoutineError) as e:
        R.read_days(A, [r["id"]], ["tomorrow"], now=at("2026-11-03"))
    assert e.value.sentence == "Dates need to look like 2026-10-24."
    out = R.read_days(A, [r["id"], "unknown"], ["2026-11-03"], now=at("2026-11-03"))
    assert list(out["routines"]) == [r["id"]] and "resolved" not in out
    routine = out["routines"][r["id"]]["routine"]
    assert set(routine) == {"id", "name", "items", "settings", "archived", "scheduleKind"}
    assert routine["scheduleKind"] == "every"
    entry = out["routines"][r["id"]]["days"]["2026-11-03"]
    assert set(entry) == {"day", "state", "label", "ticked", "skipped", "partial", "items",
                          "writable", "beyondNote", "consistency", "rate", "run"}


def test_beyond_horizon_day_carries_the_quiet_note(R):
    from api.services import session_calendar
    hz = session_calendar.horizon()
    r = make(R, day="2026-11-02")
    past = (hz + timedelta(days=10)).isoformat()
    late = (hz - timedelta(days=20)).isoformat()      # today within 366 days of `past`
    day = R.read_days(A, [r["id"]], [past], now=at(late))["routines"][r["id"]]["days"][past]
    assert day["beyondNote"] and day["beyondNote"].startswith(
        "Market calendar not available past")
    near = R.read_days(A, [r["id"]], ["2026-11-03"], now=at("2026-11-03"))["routines"][
        r["id"]]["days"]["2026-11-03"]
    assert near["beyondNote"] is None


# ── traded days ────────────────────────────────────────────────────────────────────────────────

def _trade(c, user, *, entry, exit_, flagged=0, position_id=None):
    tid = str(uuid.uuid4())
    c.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price,"
        " entry_date, exit_price, exit_date, original_stop, pnl_dollar, pnl_percent, hold_days,"
        " result, context_at_entry, created_at, analytics_excluded)"
        " VALUES (?, ?, ?, 'NVDA', 'Long', 10, 100, ?, 110, ?, 95, 100, 0.1, 1, 'Win', '{}', ?, ?)",
        (tid, user, position_id or str(uuid.uuid4()), entry, exit_, exit_, flagged))


def _position(c, user, *, entry, estimated=0, closed=None):
    pid = str(uuid.uuid4())
    c.execute(
        "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares, original_shares,"
        " entry_price, stop_price, context_at_entry, created_at, updated_at, closed_at,"
        " entry_estimated) VALUES (?, ?, 'AMD', 'Long', ?, 5, 5, 100, 100, '{}', ?, ?, ?, ?)",
        (pid, user, entry, entry, entry, closed, estimated))
    return pid


def test_traded_days_excludes_estimated_entries_and_flagged_trades(R):
    with _conn() as c:
        _trade(c, A, entry="2026-11-02T15:00:00Z", exit_="2026-11-03")
        _trade(c, A, entry="2026-11-04T15:00:00Z", exit_="2026-11-04", flagged=1)
        est = _position(c, A, entry="2026-11-09", estimated=1, closed="2026-11-12")
        _trade(c, A, entry="2026-11-09", exit_="2026-11-12", position_id=est)
        _position(c, A, entry="2026-11-20", estimated=1)      # nothing else covers 11-20
        _position(c, A, entry="2026-11-06T02:30:00Z")          # 21:30 ET on 11-05
        _position(c, B, entry="2026-11-10")
        c.execute(
            "INSERT INTO j2_option_strategies (id, user_id, underlying, strategy_type, direction,"
            " net_entry, entry_date, status, closed_at, trading_day_et, created_at, updated_at)"
            " VALUES ('s1', ?, 'SPY', 'long_call', 'bullish', 100, '2026-11-16', 'closed',"
            " '2026-11-17T18:00:00Z', '2026-11-17', '2026-11-16', '2026-11-17')", (A,))
        c.commit()
        got = R.traded_days(c, A, "2026-11-01", "2026-11-30")
    assert got == frozenset({"2026-11-02", "2026-11-03", "2026-11-05", "2026-11-12",
                             "2026-11-16", "2026-11-17"})
    with _conn() as c:
        assert R.traded_days(c, A, "2026-11-03", "2026-11-05") == frozenset(
            {"2026-11-03", "2026-11-05"})


def test_traded_schedule_reads_trade_days_only(R):
    r = make(R, day="2026-11-02", schedule={"kind": "traded"})
    with _conn() as c:
        _trade(c, A, entry="2026-11-03", exit_="2026-11-03")
        c.commit()
    days = R.read_days(A, [r["id"]], ["2026-11-03", "2026-11-04"], now=at("2026-11-05"))[
        "routines"][r["id"]]["days"]
    assert days["2026-11-03"]["state"] == "not_done"
    assert days["2026-11-04"]["state"] == "off"
    for i in ids(r):
        R.set_tick(A, r["id"], "2026-11-03", i, True, now=at("2026-11-05"))
    d = R.read_days(A, [r["id"]], ["2026-11-04"], now=at("2026-11-05"))["routines"][r["id"]][
        "days"]["2026-11-04"]
    assert d["consistency"] == "1 of the last 1 day you traded"


# ── import, starters ───────────────────────────────────────────────────────────────────────────

def _day_note(c, user, day, rules, updated):
    c.execute("INSERT INTO j2_day_notes (id, user_id, date, rules, created_at, updated_at)"
              " VALUES (?, ?, ?, ?, ?, ?)", (str(uuid.uuid4()), user, day, json.dumps(rules),
                                             updated, updated))


def test_import_day_rules_newest_non_empty_dedup(R):
    with _conn() as c:
        _day_note(c, A, "2026-11-01", [{"id": "1", "label": "Old rule", "checked": True}], "a")
        _day_note(c, A, "2026-11-02", [{"id": "1", "label": " Stop first ", "checked": False},
                                       {"id": "2", "label": "stop first", "checked": True},
                                       {"id": "3", "label": "  ", "checked": True},
                                       {"id": "4", "label": "Size small", "checked": True}], "b")
        _day_note(c, A, "2026-11-03", [], "c")
        _day_note(c, B, "2026-11-04", [{"id": "1", "label": "Not mine", "checked": True}], "d")
        c.commit()
    assert R.import_day_rules(A) == ["Stop first", "Size small"]
    with _conn() as c:
        _day_note(c, A, "2026-11-05", [{"id": str(i), "label": f"R{i}", "checked": False}
                                       for i in range(40)], "e")
        c.commit()
    assert R.import_day_rules(A) == [f"R{i}" for i in range(25)]
    assert R.import_day_rules("nobody") == []


def test_starters_exact_text(R):
    s = {x["key"]: x for x in R.starters()}
    assert list(s) == ["premarket", "preentry", "eod", "rules"]
    assert s["premarket"]["name"] == "Pre-market routine"
    assert [i["text"] for i in s["premarket"]["items"]] == [
        "Read the morning wire", "Check today's economic calendar",
        "Review open positions and stops", "Mark key levels on my watchlist",
        "Set my max loss for today"]
    assert s["preentry"]["name"] == "Pre-entry checks"
    assert [i["text"] for i in s["preentry"]["items"]] == [
        "The setup is in my playbook", "My stop is set before entry",
        "Size fits my risk per trade", "The market is not against the trade"]
    assert s["eod"]["name"] == "End-of-day review"
    assert [i["text"] for i in s["eod"]["items"]] == [
        "Log every trade", "Tag setups and mistakes",
        "Save a screenshot of my best and worst trade", "Write one lesson",
        "Build tomorrow's watchlist"]
    assert s["rules"]["name"] == "Rules I keep"
    assert [(i["text"], i["negative"], i["suggest"]) for i in s["rules"]["items"]] == [
        ("Stop on every trade", False, {"rule": "stop_every_trade"}),
        ("Max 3 trades", False, {"rule": "max_trades", "n": 3}),
        ("Stayed under my daily loss limit", False, {"rule": "under_daily_loss_limit"}),
        ("No trade within 10 min of a loss", True, {"rule": "no_trade_after_loss", "n": 10}),
        ("No revenge trades", True, {"rule": "no_revenge"})]
    assert all(not i["negative"] and i["suggest"] is None
               for k in ("premarket", "preentry", "eod") for i in s[k]["items"])
    # a starter creates as a routine with its suggestion rules kept
    st = s["rules"]
    r = R.create(A, name=st["name"], items=st["items"], schedule=EVERY,
                 source_template_key="rules", now=at("2026-11-02"))
    assert r["items"][3]["negative"] is True
    assert r["items"][3]["suggest"] == {"rule": "no_trade_after_loss", "n": 10}


# ── delete, purge, duplicate ───────────────────────────────────────────────────────────────────

def test_soft_delete_needs_archive_and_typed_name(R):
    r = make(R)
    with pytest.raises(R.RoutineError) as e:
        R.soft_delete(A, r["id"], typed_name="Morning", now=at("2026-11-03"))
    assert e.value.sentence == "Archive this routine before deleting it."
    R.archive(A, r["id"], now=at("2026-11-03"))
    with pytest.raises(R.RoutineError) as e:
        R.soft_delete(A, r["id"], typed_name="morning", now=at("2026-11-03"))
    assert e.value.sentence == "Type the routine's name exactly to delete it."
    with pytest.raises(R.NotFound):
        R.soft_delete(B, r["id"], typed_name="Morning", now=at("2026-11-03"))
    R.soft_delete(A, r["id"], typed_name="Morning", now=at("2026-11-03"))
    assert R.get(A, r["id"]) is None
    assert R.read_days(A, [r["id"]], ["2026-11-03"], now=at("2026-11-03"))["routines"] == {}
    assert [x["id"] for x in R.list_routines(A, filter="deleted", now=at("2026-11-04"))] == [
        r["id"]]
    back = R.undelete(A, r["id"], now=at("2026-11-20"))
    assert back["archived"] is True and back["deleted"] is False


def test_deleted_purged_after_30_days_with_children(R):
    r = make(R, day="2026-11-02")
    keep = make(R, day="2026-11-02", name="Keep")
    R.set_tick(A, r["id"], "2026-11-02", ids(r)[0], True, now=at("2026-11-02"))
    R.set_skipped(A, r["id"], "2026-11-03", True, now=at("2026-11-03"))
    R.set_tick(A, keep["id"], "2026-11-02", ids(keep)[0], True, now=at("2026-11-02"))
    with _conn() as c:
        c.execute("INSERT INTO j2_routine_reminder_claims VALUES (?, ?, '2026-11-02', 'x')",
                  (A, r["id"]))
        c.commit()
    R.archive(A, r["id"], now=at("2026-11-03"))
    R.soft_delete(A, r["id"], typed_name="Morning", now=at("2026-11-03"))
    R.list_routines(A, now=at("2026-12-02"))                    # 29 days: kept
    with _conn() as c:
        assert c.execute("SELECT COUNT(*) FROM j2_routines WHERE id = ?",
                         (r["id"],)).fetchone()[0] == 1
    R.list_routines(A, now=at("2026-12-04"))                    # 31 days: gone
    with pytest.raises(R.NotFound):
        R.undelete(A, r["id"], now=at("2026-12-04"))
    with _conn() as c:
        for t in ("j2_routines", "j2_routine_schedules", "j2_routine_ticks",
                  "j2_routine_days", "j2_routine_reminder_claims"):
            col = "id" if t == "j2_routines" else "routine_id"
            assert c.execute(f"SELECT COUNT(*) FROM {t} WHERE {col} = ?",
                             (r["id"],)).fetchone()[0] == 0, t
        assert c.execute("SELECT COUNT(*) FROM j2_routine_ticks WHERE routine_id = ?",
                         (keep["id"],)).fetchone()[0] == 1


def test_duplicate_copies_items_not_history(R):
    r = make(R, day="2026-11-02", source_template_key="premarket",
             settings={"done_share": 0.5})
    R.set_tick(A, r["id"], "2026-11-02", ids(r)[0], True, now=at("2026-11-02"))
    d = R.duplicate(A, r["id"], now=at("2026-11-04"))
    assert d["name"] == "Morning copy" and d["id"] != r["id"]
    assert [i["text"] for i in d["items"]] == [i["text"] for i in r["items"]]
    assert set(ids(d)).isdisjoint(ids(r))
    assert d["createdDay"] == "2026-11-04" and d["settings"]["done_share"] == 0.5
    assert d["sourceTemplateKey"] is None
    with _conn() as c:
        assert c.execute("SELECT COUNT(*) FROM j2_routine_ticks WHERE routine_id = ?",
                         (d["id"],)).fetchone()[0] == 0
    with pytest.raises(R.NotFound):
        R.duplicate(B, r["id"], now=at("2026-11-04"))


def test_list_filters(R):
    a = make(R, name="Active")
    b = make(R, name="Arch")
    R.archive(A, b["id"], now=at("2026-11-03"))
    assert [x["name"] for x in R.list_routines(A, now=at("2026-11-03"))] == ["Active"]
    assert [x["name"] for x in R.list_routines(A, filter="archived", now=at("2026-11-03"))] == [
        "Arch"]
    assert R.list_routines(B, now=at("2026-11-03")) == []
    with pytest.raises(R.RoutineError):
        R.list_routines(A, filter="all")
    assert a["id"]


# ── no note writes ─────────────────────────────────────────────────────────────────────────────

def test_no_j2_notes_write(R):
    c = _conn()
    seen: list[str] = []
    c.set_trace_callback(seen.append)
    try:
        r = R.create(A, name="Traced", items=ITEMS, schedule=EVERY, now=at("2026-11-02"),
                     conn=c)
        R.update(A, r["id"], if_match=1, name="Traced 2", items=ITEMS, now=at("2026-11-02"),
                 conn=c)
        item = R.get(A, r["id"], now=at("2026-11-02"), conn=c)["items"][0]["id"]
        R.set_tick(A, r["id"], "2026-11-02", item, True, now=at("2026-11-02"), conn=c)
        R.set_skipped(A, r["id"], "2026-11-02", True, now=at("2026-11-02"), conn=c)
        R.read_days(A, [r["id"]], ["today", "2026-11-02"], now=at("2026-11-02"), conn=c)
    finally:
        c.set_trace_callback(None)
        c.close()
    assert any("j2_routine_ticks" in s for s in seen)       # the trace saw the work
    assert not [s for s in seen if "j2_notes" in s]


# ── fix round 1 ────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", ["9999-12-31", "1900-01-01", "2090-06-01", "1989-12-31",
                                 "2026-W45-1", "2026-11-3", "20261103"])
def test_out_of_range_and_malformed_days_get_the_sentence(R, bad):
    """W9-R9 / M3: never an OverflowError (a 500) and never an ISO week date."""
    r = make(R, day="2026-11-02")
    for call in (lambda: R.read_days(A, [r["id"]], [bad], now=at("2026-11-03")),
                 lambda: R.set_tick(A, r["id"], bad, ids(r)[0], True, now=at("2026-11-03")),
                 lambda: R.set_skipped(A, r["id"], bad, True, now=at("2026-11-03"))):
        with pytest.raises(R.RoutineError) as e:
            call()
        assert e.value.sentence == "Dates need to look like 2026-10-24."


def test_the_range_edges_are_accepted(R):
    r = make(R, day="2026-11-02")
    edge = (date(2026, 11, 3) + timedelta(days=366)).isoformat()
    out = R.read_days(A, [r["id"]], ["1990-01-01", edge], now=at("2026-11-03"))
    days = out["routines"][r["id"]]["days"]
    assert days["1990-01-01"]["state"] == "off"
    assert days[edge]["state"] in ("open", "off")


def test_a_future_day_moves_neither_consistency_nor_runs(R):
    r = make(R, day="2026-11-02")
    for d in ("2026-11-02", "2026-11-03", "2026-11-04"):
        for i in ids(r):
            R.set_tick(A, r["id"], d, i, True, now=at(d))
    out = R.read_days(A, [r["id"]], ["2026-11-04", "2026-11-05", "2027-06-01"],
                      now=at("2026-11-04"))["routines"][r["id"]]["days"]
    for d in ("2026-11-05", "2027-06-01"):
        assert out[d]["state"] == "open"
        assert out[d]["consistency"] == out["2026-11-04"]["consistency"]
        assert out[d]["run"] == out["2026-11-04"]["run"]


def test_history_is_built_once_per_routine_for_a_31_day_read(R, monkeypatch):
    rs = [make(R, day="2026-10-01", name=f"R{i}") for i in range(3)]
    calls: list = []
    real = R.routine_days.history

    def spy(**kw):
        calls.append(kw["upto"])
        return real(**kw)

    monkeypatch.setattr(R.routine_days, "history", spy)
    days = [(date(2026, 11, 1) + timedelta(days=i)).isoformat() for i in range(31)]
    R.read_days(A, [x["id"] for x in rs], days, now=at("2026-12-10"))
    assert len(calls) == 3
    assert set(calls) == {date(2026, 12, 1)}


def test_batched_read_statement_count_does_not_grow_with_routines(R):
    def count(n):
        rows = [make(R, day="2026-11-02", name=f"N{n}-{i}", schedule={"kind": "traded"})
                for i in range(n)]
        c = _conn()
        seen: list[str] = []
        c.set_trace_callback(seen.append)
        try:
            R.read_days(A, [x["id"] for x in rows], ["2026-11-03", "today"],
                        now=at("2026-11-04"), conn=c)
        finally:
            c.set_trace_callback(None)
            c.close()
        return len(seen)

    one, five = count(1), count(5)
    assert one == five and one > 0


def test_a_past_off_day_is_not_writable(R):
    r = make(R, day="2026-11-02", schedule={"kind": "weekdays", "days": [0]})   # Mondays
    days = R.read_days(A, [r["id"]], ["2026-11-03", "2026-11-09", "2026-11-10"],
                       now=at("2026-11-10"))["routines"][r["id"]]["days"]
    assert days["2026-11-03"]["state"] == "off" and days["2026-11-03"]["writable"] is False
    assert days["2026-11-09"]["writable"] is True
    assert days["2026-11-10"]["writable"] is True        # today: never refused as off


def test_stored_items_are_capped_dropping_the_oldest_ended_first(R):
    r = make(R, day="2026-01-05")
    etag = r["etag"]
    d = date(2026, 1, 6)
    for n in range(10):                                  # 10 x 25 items replaced = 250 ended
        u = R.update(A, r["id"], if_match=etag, now=at(d.isoformat()),
                     items=[{"text": f"g{n}-{k}"} for k in range(25)])
        etag = u["etag"]
        d += timedelta(days=7)
    with _conn() as c:
        stored = json.loads(c.execute("SELECT items_json FROM j2_routines WHERE id = ?",
                                      (r["id"],)).fetchone()[0])
    assert len(stored) == R.STORED_ITEMS_MAX
    current = [i for i in stored if i["to"] is None]
    assert [i["text"] for i in current] == [f"g9-{k}" for k in range(25)]
    ended_texts = {i["text"] for i in stored if i["to"] is not None}
    assert not any(t.startswith(("Read", "Set", "g0-", "g1-")) for t in ended_texts)
    assert all(f"g8-{k}" in ended_texts for k in range(25))


def test_an_identical_schedule_writes_no_row(R):
    r = make(R, day="2026-10-01", schedule={"kind": "weekdays", "days": [0, 2]})
    R.update(A, r["id"], if_match=1, schedule={"kind": "weekdays", "days": [2, 0]},
             now=at("2026-10-14"))
    with _conn() as c:
        rows = c.execute("SELECT effective_from FROM j2_routine_schedules WHERE routine_id = ?",
                         (r["id"],)).fetchall()
    assert [x[0] for x in rows] == ["2026-10-01"]


def test_b_cannot_undelete_as_soft_deleted_routine(R):
    """M7: the undelete door is checked against a routine that IS deleted, so the ownership
    clause is the only thing that can refuse it."""
    r = make(R, day="2026-11-02")
    R.archive(A, r["id"], now=at("2026-11-03"))
    R.soft_delete(A, r["id"], typed_name="Morning", now=at("2026-11-03"))
    with pytest.raises(R.NotFound):
        R.undelete(B, r["id"], now=at("2026-11-04"))
    assert R.get(A, r["id"]) is None
    assert R.undelete(A, r["id"], now=at("2026-11-04"))["deleted"] is False
