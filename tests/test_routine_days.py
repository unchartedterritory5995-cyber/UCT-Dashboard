"""Task 9.3: routine day states, consistency and runs, derived over the trading-days spine.

Dates are real 2026 sessions: Thanksgiving is Thursday 2026-11-26 and the day after it, Friday
2026-11-27, is a half day (a session).
"""
from datetime import date, timedelta

import pytest

from api.services import session_calendar
from api.services.journal_two import measures as shared_measures
from api.services.journal_two import routine_days as rd
from api.services.journal_two import trading_days as td

NONE = frozenset()


def _item(iid, frm="2026-01-01", to=None, text=None, negative=False, suggest=None):
    return {"id": iid, "text": text or f"Item {iid}", "negative": negative,
            "suggest": suggest, "from": frm, "to": to}


def _items(*raw):
    return rd.parse_items(list(raw))


EVERY = {"kind": "every"}
ITEMS_ONE = _items(_item("a"))


def _state(day, *, items=ITEMS_ONE, schedule=EVERY, ticks=None, skipped=False,
           today=date(2026, 12, 31), created=date(2026, 1, 1), traded=NONE, done_share=1.0):
    return rd.day_state(items=items, schedule=schedule, ticks=ticks or {}, skipped=skipped,
                        day=day, today=today, created=created, traded=traded,
                        done_share=done_share)


def _hist(lo, hi, *, items=ITEMS_ONE, schedules=None, ticks_by_day=None, skipped_days=NONE,
          today=date(2026, 12, 31), traded=NONE, done_share=1.0):
    return rd.history(items=items, schedules=schedules or [("2026-01-01", EVERY)],
                      ticks_by_day=ticks_by_day or {}, skipped_days=skipped_days,
                      created=lo, upto=hi, today=today, traded=traded, done_share=done_share)


def _ds(state, day="2026-11-02"):
    return rd.DayState(day=day, state=state, ticked=0, of=1)


# ── constants ──────────────────────────────────────────────────────────────────────────────────

def test_constants_are_the_briefs_values():
    assert rd.WINDOW_SESSIONS == 7
    assert rd.CONSISTENCY_WINDOW == 20
    assert rd.RUN_SHOWN_FROM == 3
    assert rd.MILESTONES == (7, 21, 50, 100)
    assert rd.DONE_SHARES == (1.0, 0.75, 0.5)
    assert rd.SCHEDULE_KINDS == ("every", "weekdays", "traded")
    assert rd.STATE_LABELS == {"done": "Done", "not_done": "Not done", "skipped": "Skipped",
                               "off": "Off day", "open": ""}
    assert rd.S_WINDOW == "Ticks can be added up to 7 trading days back."


def test_history_bound_matches_the_trading_days_widget_bound():
    # R-8 parity. Restated (not imported) because widget_engine.sources will import this module;
    # this rail is what keeps the two from drifting.
    from api.services.journal_two.widget_engine import sources
    assert rd.MAX_HISTORY_SESSIONS == sources.MAX_SESSIONS == 3700


# ── calendar edges ─────────────────────────────────────────────────────────────────────────────

def test_weekend_and_thanksgiving_are_off():
    lo, hi = date(2026, 11, 23), date(2026, 11, 29)
    by_day = {lo + timedelta(days=i): _state(lo + timedelta(days=i)).state for i in range(7)}
    assert by_day[date(2026, 11, 26)] == "off"   # Thanksgiving
    assert by_day[date(2026, 11, 28)] == "off"   # Saturday
    assert by_day[date(2026, 11, 29)] == "off"   # Sunday
    assert by_day[date(2026, 11, 23)] == "not_done"
    # history lists sessions only, so an off calendar day is never counted at all.
    days = [s.day for s in _hist(lo, hi)]
    assert days == ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-27"]


def test_half_day_is_scheduled():
    assert _state(date(2026, 11, 27)).state != "off"
    assert rd.is_scheduled(EVERY, date(2026, 11, 27), NONE) is True
    assert "2026-11-27" in [s.day for s in _hist(date(2026, 11, 23), date(2026, 11, 29))]


def test_beyond_horizon_counts_weekdays():
    hz = session_calendar.horizon()
    lo, hi = hz - timedelta(days=6), hz + timedelta(days=12)
    states = _hist(lo, hi, today=hi + timedelta(days=1))
    after = [date.fromisoformat(s.day) for s in states if date.fromisoformat(s.day) > hz]
    expected = [hz + timedelta(days=i) for i in range(1, 13) if (hz + timedelta(days=i)).weekday() < 5]
    assert after == expected
    assert all(s.state == "not_done" for s in states)
    sat = next(hz + timedelta(days=i) for i in range(1, 13) if (hz + timedelta(days=i)).weekday() == 5)
    assert rd.is_scheduled(EVERY, sat, NONE) is False
    mon = next(d for d in expected if d.weekday() == 0)
    assert rd.is_scheduled({"kind": "weekdays", "days": [0]}, mon, NONE) is True
    assert rd.is_scheduled({"kind": "weekdays", "days": [1]}, mon, NONE) is False


@pytest.mark.parametrize("day,kind,days,expected", [
    (date(2026, 11, 23), "weekdays", [0], True),        # Monday, chosen
    (date(2026, 11, 24), "weekdays", [0], False),       # Tuesday, not chosen
    (date(2026, 11, 26), "weekdays", [3], False),       # Thanksgiving Thursday: no session
    (date(2026, 11, 27), "weekdays", [4], True),        # half day Friday: a session
    (date(2026, 11, 28), "every", None, False),         # Saturday
    (date(2026, 11, 26), "every", None, False),         # Thanksgiving
])
def test_is_scheduled_table(day, kind, days, expected):
    sched = {"kind": kind} if days is None else {"kind": kind, "days": days}
    assert rd.is_scheduled(sched, day, NONE) is expected


def test_no_schedule_is_never_scheduled():
    assert rd.is_scheduled(None, date(2026, 11, 23), NONE) is False
    assert _state(date(2026, 11, 23), schedule=None).state == "off"


# ── schedule versions ──────────────────────────────────────────────────────────────────────────

def test_schedule_change_applies_from_its_day_only():
    schedules = [("2026-10-01", EVERY), ("2026-10-14", {"kind": "weekdays", "days": [0, 2, 4]})]
    assert rd.schedule_on(schedules, date(2026, 10, 13)) == EVERY
    assert rd.schedule_on(schedules, date(2026, 10, 14))["kind"] == "weekdays"
    assert rd.schedule_on(schedules, date(2026, 9, 30)) is None
    states = {s.day: s.state for s in _hist(date(2026, 10, 1), date(2026, 10, 23),
                                             schedules=schedules)}
    assert states["2026-10-13"] == "not_done"   # Tuesday, under "every"
    assert states["2026-10-20"] == "off"        # Tuesday, under Mon/Wed/Fri
    assert states["2026-10-19"] == "not_done"   # Monday, chosen
    assert states["2026-10-21"] == "not_done"   # Wednesday, chosen


def test_schedule_on_picks_the_greatest_effective_from_regardless_of_order():
    schedules = [("2026-10-14", {"kind": "traded"}), ("2026-10-01", EVERY),
                 ("2026-11-01", {"kind": "weekdays", "days": [1]})]
    assert rd.schedule_on(schedules, date(2026, 10, 20)) == {"kind": "traded"}
    assert rd.schedule_on(schedules, date(2026, 11, 3))["kind"] == "weekdays"


def test_traded_schedule_off_on_a_day_without_trades():
    sched = {"kind": "traded"}
    traded = frozenset({"2026-11-23"})
    assert _state(date(2026, 11, 23), schedule=sched, traded=traded).state == "not_done"
    assert _state(date(2026, 11, 24), schedule=sched, traded=traded).state == "off"


def test_traded_history_adds_a_traded_non_session_day():
    traded = frozenset({"2026-11-24", "2026-11-28"})   # a session and a Saturday
    states = _hist(date(2026, 11, 23), date(2026, 11, 29), schedules=[("2026-01-01", {"kind": "traded"})],
                   traded=traded)
    by_day = {s.day: s.state for s in states}
    assert by_day["2026-11-28"] == "not_done"
    assert by_day["2026-11-24"] == "not_done"
    assert by_day["2026-11-23"] == "off"
    assert [s.day for s in states] == sorted(s.day for s in states)


def test_traded_day_under_an_every_schedule_adds_no_row():
    states = _hist(date(2026, 11, 23), date(2026, 11, 29), traded=frozenset({"2026-11-28"}))
    assert "2026-11-28" not in [s.day for s in states]


# ── items over time ────────────────────────────────────────────────────────────────────────────

def test_item_added_today_does_not_count_yesterday():
    items = _items(_item("a"), _item("b", frm="2026-11-24"))
    yesterday = _state(date(2026, 11, 23), items=items, ticks={"a": True})
    assert (yesterday.state, yesterday.ticked, yesterday.of) == ("done", 1, 1)
    today = _state(date(2026, 11, 24), items=items, ticks={"a": True}, today=date(2026, 11, 24))
    assert (today.state, today.ticked, today.of) == ("open", 1, 2)


def test_removed_item_stops_counting_from_its_removal_day():
    items = _items(_item("a"), _item("b", to="2026-11-24"))
    before = _state(date(2026, 11, 23), items=items, ticks={"a": True})
    assert (before.state, before.of) == ("not_done", 2)
    removal_day = _state(date(2026, 11, 24), items=items, ticks={"a": True})
    assert (removal_day.state, removal_day.ticked, removal_day.of) == ("done", 1, 1)
    # A stray tick of the removed item on its removal day counts for nothing.
    stray = _state(date(2026, 11, 24), items=items, ticks={"b": True})
    assert (stray.state, stray.ticked) == ("not_done", 0)
    assert [i.id for i in rd.items_on(items, date(2026, 11, 24))] == ["a"]


def test_renamed_item_keeps_its_ticks():
    old = _items(_item("a", text="Read the wire"))
    new = _items(_item("a", text="Read the morning wire"))
    ticks = {"a": True}
    assert _state(date(2026, 11, 23), items=old, ticks=ticks).state == "done"
    assert _state(date(2026, 11, 23), items=new, ticks=ticks).state == "done"


def test_parse_items_reads_the_item_json():
    (it,) = _items(_item("x1", frm="2026-10-01", to="2026-11-01", text="No revenge trades",
                         negative=True, suggest={"rule": "revenge", "n": 2}))
    assert it == rd.Item(id="x1", text="No revenge trades", negative=True,
                         suggest={"rule": "revenge", "n": 2},
                         valid_from=date(2026, 10, 1), valid_to=date(2026, 11, 1))
    assert rd.items_on([it], date(2026, 10, 31)) == [it]
    assert rd.items_on([it], date(2026, 11, 1)) == []    # `to` is exclusive
    assert rd.items_on([it], date(2026, 9, 30)) == []


def test_parse_items_refuses_a_bad_date():
    with pytest.raises(ValueError):
        rd.parse_items([_item("a", frm="Oct 1")])


# ── done share ─────────────────────────────────────────────────────────────────────────────────

def test_done_share_three_quarters_of_four_needs_three():
    import math
    assert math.ceil(0.75 * 4) == 3
    items = _items(*[_item(k) for k in "abcd"])
    two = _state(date(2026, 11, 23), items=items, ticks={"a": True, "b": True}, done_share=0.75)
    three = _state(date(2026, 11, 23), items=items, ticks={"a": True, "b": True, "c": True},
                   done_share=0.75)
    assert (two.state, three.state) == ("not_done", "done")


@pytest.mark.parametrize("share,n,needed", [
    (1.0, 5, 5), (0.75, 5, 4), (0.5, 5, 3), (0.5, 4, 2), (0.75, 1, 1), (0.5, 1, 1),
])
def test_done_share_table(share, n, needed):
    items = _items(*[_item(str(i)) for i in range(n)])
    short = {str(i): True for i in range(needed - 1)}
    enough = {str(i): True for i in range(needed)}
    day = date(2026, 11, 23)
    assert _state(day, items=items, ticks=short, done_share=share).state == "not_done"
    assert _state(day, items=items, ticks=enough, done_share=share).state == "done"


def test_a_false_tick_is_not_a_tick():
    assert _state(date(2026, 11, 23), ticks={"a": False}).state == "not_done"


def test_a_done_share_outside_the_choices_is_refused():
    with pytest.raises(ValueError):
        _state(date(2026, 11, 23), done_share=0.6)


# ── today, created, skipped ────────────────────────────────────────────────────────────────────

def test_today_not_done_is_open_and_not_counted():
    today = date(2026, 11, 25)
    states = _hist(date(2026, 11, 23), today, today=today,
                   ticks_by_day={"2026-11-23": {"a": True}, "2026-11-24": {"a": True}})
    assert [s.state for s in states] == ["done", "done", "open"]
    c = rd.consistency(states, strict=False)
    assert (c.done, c.scheduled, c.skipped) == (2, 2, 0)
    assert rd.runs(states, strict=False) == rd.Runs(current=2, best=2)


def test_today_done_is_done():
    today = date(2026, 11, 25)
    assert _state(today, ticks={"a": True}, today=today).state == "done"


def test_the_next_session_not_done_is_open():
    # A night-before routine binds the next session (ruling W9-R1).
    assert _state(date(2026, 11, 27), today=date(2026, 11, 25)).state == "open"


def test_before_created_is_off():
    created = date(2026, 11, 24)
    assert _state(date(2026, 11, 23), created=created, ticks={"a": True}).state == "off"
    assert _state(date(2026, 11, 24), created=created).state == "not_done"
    states = rd.history(items=ITEMS_ONE, schedules=[("2026-01-01", EVERY)], ticks_by_day={},
                        skipped_days=NONE, created=created, upto=date(2026, 11, 25),
                        today=date(2026, 12, 31), traded=NONE, done_share=1.0)
    assert [s.day for s in states] == ["2026-11-24", "2026-11-25"]


def test_history_before_created_is_empty():
    states = rd.history(items=ITEMS_ONE, schedules=[("2026-01-01", EVERY)], ticks_by_day={},
                        skipped_days=NONE, created=date(2026, 11, 25), upto=date(2026, 11, 24),
                        today=date(2026, 12, 31), traded=NONE, done_share=1.0)
    assert states == []


def test_skipped_day_is_skipped_even_with_ticks():
    s = _state(date(2026, 11, 23), ticks={"a": True}, skipped=True)
    assert s.state == "skipped"


def test_history_is_bounded_by_max_history_sessions():
    upto = date(2026, 11, 25)
    floor = td.nth_session_before(upto + timedelta(days=1), rd.MAX_HISTORY_SESSIONS)
    states = rd.history(items=ITEMS_ONE, schedules=[("2000-01-01", EVERY)], ticks_by_day={},
                        skipped_days=NONE, created=date(2000, 1, 3), upto=upto,
                        today=date(2026, 12, 31), traded=NONE, done_share=1.0)
    assert len(states) == rd.MAX_HISTORY_SESSIONS
    assert states[0].day == floor.isoformat() and states[-1].day == upto.isoformat()


# ── late ticks ─────────────────────────────────────────────────────────────────────────────────

def test_late_tick_changes_only_its_own_day():
    today = date(2026, 12, 1)
    base = {"2026-11-23": {"a": True}, "2026-11-25": {"a": True}}
    late = dict(base, **{"2026-11-24": {"a": True}})
    lo = date(2026, 11, 20)
    before = {s.day: s for s in _hist(lo, today, ticks_by_day=base, today=today)}
    after = {s.day: s for s in _hist(lo, today, ticks_by_day=late, today=today)}
    changed = [d for d in before if before[d] != after[d]]
    assert changed == ["2026-11-24"]
    assert after["2026-11-24"].state == "done"
    assert rd.in_window(date(2026, 11, 24), today) is True


def test_late_tick_can_join_two_runs():
    today = date(2026, 12, 1)
    lo = date(2026, 11, 23)
    ticks = {d: {"a": True} for d in ("2026-11-23", "2026-11-25", "2026-11-27")}
    assert rd.runs(_hist(lo, date(2026, 11, 27), ticks_by_day=ticks, today=today),
                   strict=False) == rd.Runs(current=2, best=2)
    ticks["2026-11-24"] = {"a": True}
    assert rd.runs(_hist(lo, date(2026, 11, 27), ticks_by_day=ticks, today=today),
                   strict=False) == rd.Runs(current=4, best=4)


# ── write window ───────────────────────────────────────────────────────────────────────────────

def test_write_window_counts_sessions():
    assert rd.write_window(date(2026, 12, 1)) == (date(2026, 11, 19), date(2026, 12, 2))
    assert rd.write_window(date(2026, 11, 28))[1] == date(2026, 11, 30)   # Saturday
    assert rd.write_window(date(2026, 11, 25))[1] == date(2026, 11, 27)   # day before Thanksgiving


@pytest.mark.parametrize("day,ok", [
    (date(2026, 11, 18), False),   # 8th session back
    (date(2026, 11, 19), True),    # 7th session back
    (date(2026, 11, 26), True),    # Thanksgiving: inside the span (the store refuses by schedule)
    (date(2026, 12, 1), True),     # today
    (date(2026, 12, 2), True),     # the next session
    (date(2026, 12, 3), False),    # later than the next session
])
def test_in_window_table(day, ok):
    assert rd.in_window(day, date(2026, 12, 1)) is ok


def test_a_long_weekend_never_shortens_the_window():
    # Seven sessions back from the Monday after Thanksgiving reaches past the holiday.
    lo, _hi = rd.write_window(date(2026, 11, 30))
    assert len(td.sessions(lo, date(2026, 11, 29)).days) == 7


# ── consistency ────────────────────────────────────────────────────────────────────────────────

def test_consistency_sentence_exact():
    c = rd.Consistency(done=18, scheduled=20, skipped=2)
    assert rd.consistency_sentence(c, "trading days") == "18 of the last 20 trading days (2 skipped)"
    assert rd.consistency_sentence(rd.Consistency(5, 6, 0), "trading days") == (
        "5 of the last 6 trading days")
    assert rd.consistency_sentence(rd.Consistency(9, 10, 0), "days you traded") == (
        "9 of the last 10 days you traded")
    # A routine with no past scheduled day: nothing at all, never "0 of 0".
    states = _hist(date(2026, 11, 25), date(2026, 11, 25), today=date(2026, 11, 25))
    assert rd.consistency(states, strict=False) is None
    assert rd.consistency_sentence(None, "trading days") is None


def test_consistency_sentence_never_shows_zero():
    assert rd.consistency_sentence(rd.Consistency(0, 3, 0), "trading days") is None


def test_consistency_reads_the_newest_window():
    states = ([_ds("not_done")] * 5 + [_ds("done")] * 18 + [_ds("skipped")] * 2
              + [_ds("off")] * 3 + [_ds("open")])
    c = rd.consistency(states, strict=False)
    assert (c.done, c.scheduled, c.skipped) == (18, 20, 2)
    assert rd.consistency(states, strict=False, window=5) == rd.Consistency(3, 5, 2)


def test_strict_rate_counts_skips():
    c = rd.Consistency(done=18, scheduled=20, skipped=2)
    assert rd.consistency_rate(c, strict=False) == 1.0
    assert rd.consistency_rate(c, strict=True) == 0.9


def test_consistency_rate_zero_denominator_is_none():
    assert rd.consistency_rate(rd.Consistency(0, 2, 2), strict=False) is None
    assert rd.consistency_rate(rd.Consistency(0, 0, 0), strict=True) is None
    assert rd.consistency_rate(None, strict=True) is None


# ── runs ───────────────────────────────────────────────────────────────────────────────────────

def test_skip_never_breaks_a_run_unless_strict():
    states = [_ds("done"), _ds("skipped"), _ds("done")]
    assert rd.runs(states, strict=False).current == 2
    assert rd.runs(states, strict=True).current == 1


@pytest.mark.parametrize("seq,strict,current,best", [
    ("DDDND", False, 1, 3),
    ("DDOOD", False, 3, 3),     # off days are ignored
    ("DDD_", False, 3, 3),      # open (today) is ignored
    ("DSSD", False, 2, 2),
    ("DSSD", True, 1, 1),
    ("NNN", False, 0, 0),
    ("", False, 0, 0),
])
def test_runs_table(seq, strict, current, best):
    codes = {"D": "done", "N": "not_done", "S": "skipped", "O": "off", "_": "open"}
    assert rd.runs([_ds(codes[c]) for c in seq], strict=strict) == rd.Runs(current, best)


def test_run_line_hidden_under_three_and_never_zero():
    assert rd.run_line(0) is None
    assert rd.run_line(1) is None
    assert rd.run_line(2) is None
    assert rd.run_line(3) == "3 sessions in a row"
    assert rd.run_line(21) == "21 sessions in a row"


def test_milestones_exact():
    hits = [n for n in range(0, 151) if rd.is_milestone(n)]
    assert hits == [7, 21, 50, 100]


def test_best_line_only_after_a_run_ends():
    assert rd.best_line(rd.Runs(current=0, best=5)) == "Best run: 5 sessions"
    assert rd.best_line(rd.Runs(current=2, best=3)) == "Best run: 3 sessions"
    assert rd.best_line(rd.Runs(current=5, best=5)) is None    # the run is still going
    assert rd.best_line(rd.Runs(current=3, best=9)) is None    # the run line shows instead
    assert rd.best_line(rd.Runs(current=0, best=2)) is None
    assert rd.best_line(rd.Runs(current=0, best=0)) is None


# ── partial label ──────────────────────────────────────────────────────────────────────────────

def test_partial_label():
    assert rd.partial_label(rd.DayState("2026-11-23", "not_done", 4, 6)) == "4 of 6"
    assert rd.partial_label(rd.DayState("2026-11-23", "off", 0, 0)) is None


# ── measures ───────────────────────────────────────────────────────────────────────────────────

def _rows(done, skipped, not_done=0, *, strict=False, routine="r1"):
    states = ["done"] * done + ["skipped"] * skipped + ["not_done"] * not_done
    start = date(2026, 1, 5)
    return [{"routine": routine, "day": (start + timedelta(days=i)).isoformat(), "state": s,
             "ticked": 1 if s == "done" else 0, "of": 1, "strict": strict, "consistency": None}
            for i, s in enumerate(states)]


def test_routine_measures_match_their_rates():
    rows = _rows(18, 2)
    cons = rd.ROUTINE_MEASURES["routine_consistency"].fn(rows)
    comp = rd.ROUTINE_MEASURES["routine_completion_pct"].fn(rows)
    assert (cons.value, cons.n) == (1.0, 18)
    assert (comp.value, comp.n) == (0.9, 20)
    c = rd.consistency([_ds(r["state"]) for r in rows], strict=False)
    assert cons.value == rd.consistency_rate(c, strict=False)
    assert comp.value == rd.consistency_rate(c, strict=True)


def test_routine_consistency_strict_rows_count_a_skip_as_not_done():
    cons = rd.ROUTINE_MEASURES["routine_consistency"].fn(_rows(18, 2, strict=True))
    assert (cons.value, cons.n) == (0.9, 20)


def test_routine_measures_ignore_off_and_open_rows():
    rows = _rows(3, 0, 1) + [{"routine": "r1", "day": "2026-02-01", "state": s, "ticked": 0,
                              "of": 1, "strict": False, "consistency": None}
                             for s in ("off", "open")]
    assert rd.ROUTINE_MEASURES["routine_days_done"].fn(rows).value == 3.0
    assert rd.ROUTINE_MEASURES["routine_completion_pct"].fn(rows).value == 0.75


def test_routine_best_run_per_routine_in_day_order():
    a = _rows(4, 0, 1, routine="a")
    b = _rows(6, 0, 0, routine="b")
    rows = list(reversed(a)) + b[::2] + b[1::2]   # out of order on purpose
    assert rd.ROUTINE_MEASURES["routine_best_run"].fn(rows).value == 6.0
    assert rd.ROUTINE_MEASURES["routine_best_run"].fn(_rows(0, 0, 3)).value is None


def test_routine_measures_with_no_scheduled_rows_have_no_value():
    for m in rd.ROUTINE_MEASURES.values():
        assert m.fn([]).value is None, m.key


def test_routine_measures_catalog_shape():
    m = rd.ROUTINE_MEASURES
    assert list(m) == ["routine_consistency", "routine_completion_pct", "routine_days_done",
                       "routine_best_run"]
    assert [(x.label, x.kind) for x in m.values()] == [
        ("Consistency", "rate"), ("Completion %", "rate"), ("Days done", "count"),
        ("Best run", "extreme")]
    for x in m.values():
        assert isinstance(x, shared_measures.Measure)
        assert x.theme == "process" and x.unit == "days"
        assert x.sources == frozenset({"routine_history"})
        assert x.min_n == shared_measures.DEFAULT_MIN_N


# ── fix round 1 ────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw_items", [
    [],                                                    # no items at all
    [_item("a", to="2026-11-01"), _item("b", to="2026-11-10")],   # every item removed
    [_item("a", frm="2026-12-01")],                        # an item that starts later
], ids=["no-items", "all-removed", "starts-later"])
def test_a_day_with_no_applicable_item_is_off(raw_items):
    items = _items(*raw_items)
    day = date(2026, 11, 24)
    s = _state(day, items=items, ticks={"a": True, "b": True})
    assert (s.state, s.of) == ("off", 0)
    assert rd.partial_label(s) is None
    # Between two done days it neither breaks the run nor enters consistency.
    done = rd.DayState("2026-11-23", "done", 1, 1)
    after = rd.DayState("2026-11-25", "done", 1, 1)
    with_off = [done, s, after]
    without = [done, after]
    assert rd.runs(with_off, strict=False) == rd.runs(without, strict=False) == rd.Runs(2, 2)
    assert rd.runs(with_off, strict=True) == rd.Runs(2, 2)
    assert rd.consistency(with_off, strict=False) == rd.consistency(without, strict=False)


@pytest.mark.parametrize("value,ticked", [
    (True, True), (1, True), (False, False), (0, False),
    (2, False), (1.0, False), ("1", False), (None, False), ("true", False),
])
def test_tick_values_true_or_integer_one_count(value, ticked):
    s = _state(date(2026, 11, 23), ticks={"a": value})
    assert s.state == ("done" if ticked else "not_done")
    assert s.ticked == (1 if ticked else 0)


def test_traded_schedule_today_and_later_sessions_are_open():
    sched = {"kind": "traded"}
    today = date(2026, 11, 25)
    assert _state(today, schedule=sched, today=today).state == "open"
    assert _state(date(2026, 11, 27), schedule=sched, today=today).state == "open"
    assert _state(today, schedule=sched, today=today, ticks={"a": True}).state == "done"
    # A past session without a trade stays off; a non-session future day stays off.
    assert _state(date(2026, 11, 24), schedule=sched, today=today).state == "off"
    assert _state(date(2026, 11, 26), schedule=sched, today=today).state == "off"
    assert _state(date(2026, 11, 28), schedule=sched, today=today).state == "off"
    states = _hist(date(2026, 11, 23), date(2026, 11, 27), schedules=[("2026-01-01", sched)],
                   today=today, traded=frozenset({"2026-11-23"}))
    assert [(s.day, s.state) for s in states] == [
        ("2026-11-23", "not_done"), ("2026-11-24", "off"), ("2026-11-25", "open"),
        ("2026-11-27", "open")]


def test_an_unticked_negative_item_leaves_the_day_not_done():
    items = _items(_item("n", text="No revenge trades", negative=True))
    assert _state(date(2026, 11, 23), items=items).state == "not_done"
    assert _state(date(2026, 11, 23), items=items, ticks={"n": True}).state == "done"


def test_no_zero_on_the_measure_path():
    none_done = _rows(0, 0, 4)
    assert rd.ROUTINE_MEASURES["routine_consistency"].fn(none_done).value is None
    assert rd.ROUTINE_MEASURES["routine_consistency"].fn(none_done).n == 4
    assert rd.ROUTINE_MEASURES["routine_days_done"].fn(none_done).value is None
    assert rd.ROUTINE_MEASURES["routine_days_done"].fn(_rows(2, 0, 1)).value == 2.0
    # Completion % is not covered by W9-R7 here and keeps its 0.0.
    assert rd.ROUTINE_MEASURES["routine_completion_pct"].fn(none_done).value is None
