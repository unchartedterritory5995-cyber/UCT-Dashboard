"""Task 9.8 -- routine history and tracker history as builder sources (wave 9), with fix round 1.

Seeded through `auth_db.init_db` on a temp sqlite file (the Task 8.5 `conn` fixture), with routines
and trackers written through their own stores (`routines.create` / `set_tick` / `set_skipped`,
`trackers.create` / `set_value`) at injected times. Nothing here reaches `C:\\data`.

The sessions used are real 2026 sessions: 2026-10-05 .. 2026-10-23 (no holiday), today 2026-10-24
(a Saturday), so every day in range is a finished day unless a test says otherwise.
"""
from __future__ import annotations

import os
import time
import tracemalloc
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two import routines, tracker_days, trackers, trading_days
from api.services.journal_two.widget_engine import aggregate, drill, payload, plan, run, sources
from api.services.journal_two.widget_engine import compile as wcompile
from tests.test_widget_sources import (  # noqa: F401 -- `conn` is a fixture used by name
    UID, add_account, add_checkin, add_note, add_position, add_trade, add_user, conn, raw_plan,
)

TODAY = date(2026, 10, 24)
NOW = datetime(2026, 10, 24, 15, 30, tzinfo=timezone.utc)
OTHER = "u-wtool-other"
WEEK = ("2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23")
RANGE = {"from": "2026-10-05", "to": "2026-10-23"}
WEEK_RANGE = {"from": WEEK[0], "to": WEEK[-1]}


@pytest.fixture(autouse=True)
def _fresh_state(monkeypatch):
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-wtool-test",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    run._reset_state()
    yield
    run._reset_state()


def at(day: str, hour_utc: int = 17) -> datetime:
    y, m, d = (int(x) for x in day.split("-"))
    return datetime(y, m, d, hour_utc, 0, tzinfo=timezone.utc)


def sessions(lo: str, hi: str) -> list[str]:
    return [d.isoformat() for d in
            trading_days.sessions(date.fromisoformat(lo), date.fromisoformat(hi)).days]


def make_routine(uid=UID, *, created="2026-10-05", items=("Plan the day",), schedule=None,
                 strict=False, name="Morning"):
    r = routines.create(uid, name=name, items=list(items),
                        schedule=schedule or {"kind": "every"},
                        settings={"strict": strict}, now=at(created))
    return r["id"], [it["id"] for it in r["items"]]


def tick(rid, day, item, uid=UID, on=True):
    routines.set_tick(uid, rid, day, item, on, now=at(day))


def skip(rid, day, uid=UID, on=True):
    routines.set_skipped(uid, rid, day, on, now=at(day))


def scan(c, raw, uid=UID, today=TODAY):
    p = plan.validate_plan(raw, sources.CATALOG)
    rng = plan.resolve_range(p["range"], today)
    sc = sources.scan(c, p, {}, rng, uid, today=today)
    return p, sc, aggregate.evaluate(sc.rows, p, sources.CATALOG)


def rplan(measures=("routine_days_done",), **kw):
    kw.setdefault("range", RANGE)
    return raw_plan(source="routine_history", measures=measures, **kw)


def tplan(measures=("tracker_entries",), **kw):
    kw.setdefault("range", RANGE)
    return raw_plan(source="tracker_history", measures=measures, **kw)


def dplan(**kw):
    kw.setdefault("range", WEEK_RANGE)
    return raw_plan(source="trading_days", measures=kw.pop("measures", ("avg_day_pnl",)), **kw)


# ── routine history ──────────────────────────────────────────────────────────────────────────

def test_routine_history_rows_scheduled_days_only_newest_first(conn):
    rid, (item,) = make_routine(schedule={"kind": "weekdays", "days": [0, 2, 4]})  # Mon Wed Fri
    for d in ("2026-10-05", "2026-10-09", "2026-10-21"):
        tick(rid, d, item)
    _p, sc, res = scan(conn, rplan(split={"by": "state"}))
    expected = [d for d in sessions("2026-10-05", "2026-10-23")
                if date.fromisoformat(d).weekday() in (0, 2, 4)]
    assert [r["day"] for r in sc.rows] == sorted(expected, reverse=True)
    states = {r["day"]: r["state"] for r in sc.rows}
    # W9-R21: the row holds the stored CODE; the label is only how a group reads
    assert states["2026-10-21"] == "done" and states["2026-10-19"] == "not_done"
    assert [g.label for g in res.groups] == ["Done", "Not done"]
    assert {r["routine"] for r in sc.rows} == {rid} and sc.rows[0]["label"] == "Morning"
    assert sc.capped is False and sc.earliest_day == "2026-10-05"
    assert res.total.cells[0].value == 3.0


def test_state_filters_store_codes_never_labels(conn):
    with pytest.raises(plan.PlanError) as e:
        plan.validate_plan(rplan(filters=[{"field": "state", "op": "in", "values": ["Done"]}]),
                           sources.CATALOG)
    assert e.value.sentence == plan.S_FILTER_VALUE_TYPE
    with pytest.raises(plan.PlanError):
        plan.validate_plan(dplan(filters=[{"field": "routine_done", "op": "in",
                                            "values": ["Not done"], "ref": str(uuid.uuid4())}]),
                           sources.CATALOG)
    rid, (item,) = make_routine()
    tick(rid, "2026-10-20", item)
    _p, _sc, res = scan(conn, rplan(filters=[{"field": "state", "op": "in", "values": ["done"]}]))
    assert res.count == 1 and _p["filters"][0]["values"] == ["done"]


def test_days_before_a_routine_existed_are_excluded_and_today_reads_open(conn):
    rid, (item,) = make_routine(created="2026-10-14")
    tick(rid, "2026-10-14", item)
    friday = date(2026, 10, 23)                       # today is a session, nothing ticked yet
    _p, sc, res = scan(conn, rplan(range={"from": "2026-10-05", "to": "2026-10-23"},
                                   split={"by": "state"}), today=friday)
    assert [r["day"] for r in sc.rows] == sessions("2026-10-14", "2026-10-23")[::-1]
    assert sc.rows[0]["state"] == "open" and "Not yet" in [g.label for g in res.groups]
    # trading days: before it existed is not an off day; it is left out of the split, counted
    _p, sc2, res2 = scan(conn, dplan(split={"by": "routine_done", "ref": rid},
                                     range={"from": "2026-10-12", "to": "2026-10-23"}),
                         today=friday)
    by_day = {r["day"]: r["routine_done"] for r in sc2.rows}
    assert by_day["2026-10-13"] is None and by_day["2026-10-14"] == "done"
    assert by_day["2026-10-23"] == "open"
    assert "2 days have no routine yet and are not in this split." in res2.footnotes


def test_split_by_item_expands_rows(conn):
    rid, (a, b) = make_routine(items=("Plan", "Review"))
    tick(rid, "2026-10-21", a)                                 # one of two: the day is not done
    tick(rid, "2026-10-22", a)
    tick(rid, "2026-10-22", b)                                 # both: done
    skip(rid, "2026-10-23")
    raw = rplan(measures=("routine_days_done",), split={"by": "item"},
                range={"from": "2026-10-21", "to": "2026-10-23"})
    _p, sc, res = scan(conn, raw)
    assert len(sc.rows) == 3 * 2                               # one row per item per day
    got = {(r["day"], r["item_text"]): r["state"] for r in sc.rows}
    assert got == {("2026-10-21", "Plan"): "done", ("2026-10-21", "Review"): "not_done",
                   ("2026-10-22", "Plan"): "done", ("2026-10-22", "Review"): "done",
                   ("2026-10-23", "Plan"): "skipped", ("2026-10-23", "Review"): "skipped"}
    by = {g.label: g.values.cells[0].value for g in res.groups}
    assert by == {"Plan": 2.0, "Review": 1.0}
    _p, sc2, _ = scan(conn, rplan(range={"from": "2026-10-21", "to": "2026-10-23"}))
    assert [r["state"] for r in sc2.rows] == ["skipped", "done", "not_done"]


def test_item_is_split_only():
    with pytest.raises(plan.PlanError) as e:
        plan.validate_plan(rplan(filters=[{"field": "item", "op": "in", "values": ["x"]}]),
                           sources.CATALOG)
    assert e.value.sentence == plan.S_NOT_A_FILTER


def test_consistency_and_completion_measures_differ_on_skips(conn):
    rid, (item,) = make_routine(created="2026-10-19")         # no earlier day in the rolling rate
    tick(rid, "2026-10-19", item)
    tick(rid, "2026-10-20", item)
    skip(rid, "2026-10-22")                                    # 10-21 and 10-23 not done
    raw = rplan(measures=("routine_consistency", "routine_completion_pct", "routine_days_done"),
                range=WEEK_RANGE)
    _p, sc, res = scan(conn, raw)
    cons, comp, done = (c.value for c in res.total.cells)
    assert cons == pytest.approx(2 / 4) and comp == pytest.approx(2 / 5) and done == 2.0
    rate = {r["day"]: r["consistency"] for r in sc.rows}
    assert rate["2026-10-20"] == pytest.approx(2 / 2) and rate["2026-10-22"] == pytest.approx(2 / 3)


def test_rolling_consistency_reads_the_days_before_the_range(conn):
    rid, (item,) = make_routine(created="2026-10-05")
    for d in sessions("2026-10-05", "2026-10-16"):             # ten done days before the range
        tick(rid, d, item)
    _p, sc, _ = scan(conn, rplan(range=WEEK_RANGE))
    rate = {r["day"]: r["consistency"] for r in sc.rows}
    assert rate["2026-10-19"] == pytest.approx(10 / 11)        # history starts before `since`


def test_routine_measures_never_show_zero(conn):
    make_routine()
    raw = rplan(measures=("routine_consistency", "routine_completion_pct", "routine_days_done"),
                range=WEEK_RANGE)
    _p, sc, res = scan(conn, raw)
    assert len(sc.rows) == 5 and all(r["state"] == "not_done" for r in sc.rows)
    assert [c.value for c in res.total.cells] == [None, None, None]     # W9-R7


def test_archiving_ends_the_routines_scheduled_days(conn):
    """W9-R20: archived on 10/14, no not done row (or day) exists after it, anywhere."""
    rid, (item,) = make_routine()
    tick(rid, "2026-10-13", item)
    routines.archive(UID, rid, now=at("2026-10-14"))
    _p, sc, _ = scan(conn, rplan())
    assert max(r["day"] for r in sc.rows) == "2026-10-14"
    assert not [r for r in sc.rows if r["day"] > "2026-10-14"]
    # the store's own read agrees: a day after the archive is off, not not done
    got = routines.read_days(UID, [rid], ["2026-10-20"], now=NOW)["routines"][rid]
    assert got["days"]["2026-10-20"]["state"] == "off"
    h = routines.history_for(conn, UID, rid, date(2026, 10, 23), TODAY)[rid]
    assert h.archived_at == date(2026, 10, 14) and max(s.day for s in h.states) == "2026-10-14"
    # a trading-days split reads the days after it as off days, not not done
    for d in WEEK:
        add_trade(conn, UID, day=d, pnl=10.0)
    _p, sc2, _ = scan(conn, dplan(split={"by": "routine_done", "ref": rid}))
    assert {r["routine_done"] for r in sc2.rows} == {"off"}


def test_routine_history_counts_estimated_entries_on_a_traded_schedule(conn):
    rid, (item,) = make_routine(schedule={"kind": "traded"})
    add_trade(conn, UID, day="2026-10-20", pnl=10.0)
    add_position(conn, UID, entry_iso="2026-10-21T14:00:00Z", estimated=1)   # left out, counted
    add_position(conn, UID, entry_iso="2026-10-22T14:00:00Z", estimated=1)
    tick(rid, "2026-10-20", item)
    _p, sc, _ = scan(conn, rplan(range=WEEK_RANGE))
    assert [r["day"] for r in sc.rows] == ["2026-10-20"]       # only the day traded
    note = sources.ESTIMATED_ENTRIES.format(n=2, positions="positions", is_="are")
    assert note in sc.footnotes
    # only when the plan's own routine is traded: a widget on another routine says nothing
    other, _ = make_routine(name="Every day")
    _p, sc2, _ = scan(conn, rplan(range=WEEK_RANGE, filters=[
        {"field": "routine", "op": "in", "values": [other]}]))
    assert sc2.rows and not any("estimated" in f for f in sc2.footnotes)
    _p, sc3, _ = scan(conn, dplan(split={"by": "routine_done", "ref": other}))
    assert not any("estimated" in f for f in sc3.footnotes)
    _p, sc4, _ = scan(conn, dplan(split={"by": "routine_done", "ref": rid}))
    assert note in sc4.footnotes


def test_at_most_60_routines_most_recently_used(conn, monkeypatch):
    monkeypatch.setattr(sources, "MAX_ROUTINES", 2)
    old, (oi,) = make_routine(name="Oldest", created="2026-10-05")
    mid, _ = make_routine(name="Middle", created="2026-10-06")
    new, _ = make_routine(name="Newest", created="2026-10-07")
    tick(old, "2026-10-23", oi)                                # the oldest is used last
    _p, sc, _ = scan(conn, rplan())
    assert {r["routine"] for r in sc.rows} == {old, new}
    assert sources.S_MORE_ROUTINES.format(n=2) in sc.footnotes
    assert sources.S_MORE_ROUTINES == "Showing your {n} most recently used routines."
    assert sources.MAX_ROUTINES == 2 and mid


def test_the_python_loop_checks_the_deadline(conn):
    make_routine()
    p = plan.validate_plan(rplan(), sources.CATALOG)
    rng = plan.resolve_range(p["range"], TODAY)
    with wcompile.python_deadline(lambda: True):
        with pytest.raises(wcompile.ScanTooLong):
            sources.scan(conn, p, {}, rng, UID, today=TODAY)
    with pytest.raises(run.EngineTooLong):                     # run.deadline maps it
        with run.deadline(conn, seconds=-1):
            with wcompile.python_deadline(lambda: True):
                sources.scan_routines(conn, p, {}, rng, UID, today=TODAY)


def _seed_heavy(c, n_routines=30, n_items=25, years=4):
    """30 every-day routines of 25 items each, created `years` ago, every item ticked every
    session: written straight into the tables (the stores' write window is 7 sessions)."""
    import json
    start = TODAY - timedelta(days=365 * years)
    days = sessions(start.isoformat(), "2026-10-23")
    ts = "2026-10-23T12:00:00Z"
    for i in range(n_routines):
        rid = str(uuid.uuid4())
        items = [{"id": str(uuid.uuid4()), "text": f"item {k}", "negative": False,
                  "suggest": None, "from": start.isoformat(), "to": None}
                 for k in range(n_items)]
        c.execute("INSERT INTO j2_routines (id, user_id, name, items_json, settings_json,"
                  " created_at, updated_at, save_seq) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
                  (rid, UID, f"R{i:02d}", json.dumps(items),
                   json.dumps({"done_share": 1.0, "strict": False, "reminder": None}),
                   start.isoformat() + "T15:00:00Z", ts))
        c.execute("INSERT INTO j2_routine_schedules (user_id, routine_id, effective_from,"
                  " schedule_json) VALUES (?, ?, ?, ?)",
                  (UID, rid, start.isoformat(), json.dumps({"kind": "every"})))
        c.executemany("INSERT INTO j2_routine_ticks (user_id, routine_id, day, item_id, ticked,"
                      " updated_at) VALUES (?, ?, ?, ?, 1, ?)",
                      [(UID, rid, d, it["id"], ts) for d in days for it in items])
    c.commit()
    return start


def test_scan_routines_is_bounded_at_4_years_30_routines_25_items(conn):
    """W9-R17 rail: the worst shape a member can build (4 years x 30 routines x 25 items, every
    item ticked every session), split by item, over one year and over all time. Rows stay at the
    cap and the memory a scan allocates is bounded. W9-R24: the hard rail is the deterministic
    expansion count (`test_item_expansion_stops_at_the_cap`); this wall-clock bound (measured ~0.5 s
    on this box) is loose on purpose so a loaded runner does not flap it."""
    start = _seed_heavy(conn)
    for rng_ in ({"from": "2025-10-24", "to": "2026-10-23"}, {"token": "all"}):
        for split in ({"by": "item"}, None):
            kw = {"split": split} if split else {}
            p = plan.validate_plan(rplan(range=rng_, **kw), sources.CATALOG)
            rr = plan.resolve_range(p["range"], TODAY)
            t0 = time.perf_counter()
            sc = sources.scan(conn, p, {}, rr, UID, today=TODAY)
            took = time.perf_counter() - t0
            assert sc.capped is True and len(sc.rows) == wcompile.SCAN_ROWS
            assert sc.rows[0]["day"] == "2026-10-23"
            assert took < 3.0, (rng_, split, took)
    p = plan.validate_plan(rplan(split={"by": "item"}, range={"token": "all"}), sources.CATALOG)
    rr = plan.resolve_range(p["range"], TODAY)
    tracemalloc.start()
    sources.scan(conn, p, {}, rr, UID, today=TODAY)
    _cur, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert peak < 150 * 1024 * 1024, peak                  # far from the 1.6 GB extrapolated
    assert start.year == 2022


# ── tracker history ──────────────────────────────────────────────────────────────────────────

def test_tracker_history_includes_checkin_builtins(conn):
    t = trackers.create(UID, name="Sleep", kind="duration", now=at("2026-10-19"))
    trackers.set_value(UID, t["id"], "2026-10-20", 420, now=at("2026-10-20"))
    trackers.set_value(UID, t["id"], "2026-10-21", 480, now=at("2026-10-21"))
    note = add_note(conn, UID, updated_at="2026-10-21T10:00:00Z")
    add_checkin(conn, UID, note, day="2026-10-21", mood=4, focus=2)
    _p, sc, res = scan(conn, tplan(measures=("tracker_entries", "tracker_avg"),
                                   split={"by": "tracker"}))
    assert {(r["tracker"], r["day"], r["value"]) for r in sc.rows} == {
        (t["id"], "2026-10-20", 420.0), (t["id"], "2026-10-21", 480.0),
        ("checkin:mood", "2026-10-21", 4.0), ("checkin:focus", "2026-10-21", 2.0)}
    labels = {g.label: (g.values.cells[0].value, g.values.cells[1].value) for g in res.groups}
    assert labels == {"Sleep": (2.0, 450.0), "Check-in mood": (1.0, 4.0),
                      "Check-in focus": (1.0, 2.0)}
    assert next(r for r in sc.rows if r["day"] == "2026-10-20")["text"] == "7h"


def test_tracker_history_is_as_of_the_range_end(conn):
    t = trackers.create(UID, name="Weight", kind="number", unit="lb", now=at("2026-10-19"))
    for d, v in (("2026-10-19", 180), ("2026-10-21", 181), ("2026-10-23", 179)):
        trackers.set_value(UID, t["id"], d, v, now=at(d))
    _p, sc, res = scan(conn, tplan(measures=("tracker_latest",),
                                   range={"from": "2026-10-19", "to": "2026-10-21"}))
    assert res.total.cells[0].value == 181.0                   # W9-R13: never the later 179


# ── the trading-days fields that name a routine or a tracker ─────────────────────────────────

def test_trading_days_split_by_routine_done_shows_off_days(conn):
    rid, (item,) = make_routine(schedule={"kind": "weekdays", "days": [0, 2, 4]})
    tick(rid, "2026-10-19", item)
    tick(rid, "2026-10-23", item)                              # Wed 10-21 not done
    for d in WEEK:
        add_trade(conn, UID, day=d, pnl=100.0 if d != "2026-10-21" else -50.0)
    p, sc, res = scan(conn, dplan(split={"by": "routine_done", "ref": rid}))
    assert p["v"] == 2
    assert [(g.label, g.values.cells[0].value) for g in res.groups] == [
        ("Done", 100.0), ("Not done", -50.0), ("Off day", 100.0)]
    assert not any("not in this split" in f for f in res.footnotes)   # every day has a state
    assert {r["day"]: r["routine_done"] for r in sc.rows}["2026-10-20"] == "off"


def test_tracker_bucket_split_matches_vs_pnl_buckets_in_bucket_order(conn):
    t = trackers.create(UID, name="Sleep", kind="duration", now=at("2026-10-19"))
    # the highest values make the BEST days, so measure order (largest first) would reverse them
    values = dict(zip(WEEK, (300, 360, 420, 480, 540)))
    for d, v in values.items():
        trackers.set_value(UID, t["id"], d, v, now=at(d))
        add_trade(conn, UID, day=d, pnl=v / 10)
    _p, sc, res = scan(conn, dplan(split={"by": "tracker_bucket", "ref": t["id"]}))
    bs = tracker_days.buckets("duration", list(map(float, values.values())), None)
    assert [g.label for g in res.groups] == [b.label for b in bs]      # low to high
    for r in sc.rows:
        assert r["tracker_bucket"] == tracker_days.bucket_of(bs, values[r["day"]])
    _p, _sc, res2 = scan(conn, dplan(filters=[{"field": "tracker_value", "op": "gte",
                                               "values": [420], "ref": t["id"]}]))
    assert res2.count == 3


def test_builtin_tracker_ref_reads_checkins(conn):
    note = add_note(conn, UID, updated_at="2026-10-20T10:00:00Z")
    add_checkin(conn, UID, note, day="2026-10-20", mood=5)
    add_trade(conn, UID, day="2026-10-20", pnl=10.0)
    _p, sc, res = scan(conn, dplan(split={"by": "tracker_bucket", "ref": "checkin:mood"}))
    assert [g.label for g in res.groups] == ["4-5"]


def _unavailable_cases(conn):
    add_user(conn, OTHER)
    rid_b, _ = make_routine(uid=OTHER)
    tb = trackers.create(OTHER, name="Theirs", kind="number", now=at("2026-10-19"))
    rid_gone, _ = make_routine(name="Gone")
    routines.archive(UID, rid_gone, now=at("2026-10-19"))
    routines.soft_delete(UID, rid_gone, typed_name="Gone", now=at("2026-10-19"))
    tg = trackers.create(UID, name="Gone", kind="number", now=at("2026-10-19"))
    trackers.archive(UID, tg["id"], now=at("2026-10-19"))
    trackers.soft_delete(UID, tg["id"], typed_name="Gone", now=at("2026-10-19"))
    return {"foreign": (rid_b, tb["id"]), "deleted": (rid_gone, tg["id"])}


def test_unavailable_ref_is_one_notice_and_no_footnote(conn):
    """W9-R18: foreign and deleted read the same: one notice, no off-day or no-value footnote."""
    for d in WEEK:
        add_trade(conn, UID, day=d, pnl=10.0)
    answers = {}
    for case, (rid, tid) in _unavailable_cases(conn).items():
        out = run.run_plan(UID, dplan(split={"by": "routine_done", "ref": rid},
                                      filters=[{"field": "tracker_value", "op": "gte",
                                                "values": [0], "ref": tid}]),
                           {}, lane="run", now=NOW)
        assert out["notice"] == "That routine isn't available. That tracker isn't available."
        assert not any("not in this split" in f or "left out" in f for f in out["footnotes"])
        assert out["rows"] == [] and out["count"] == 0
        answers[case] = (out["notice"], out["footnotes"], out["count"])
        out = run.run_plan(UID, dplan(split={"by": "tracker_bucket", "ref": tid}), {},
                           lane="run", now=NOW)
        assert out["notice"] == sources.S_TRACKER_GONE == "That tracker isn't available."
    assert answers["foreign"] == answers["deleted"]            # indistinguishable
    assert sources.S_ROUTINE_GONE == "That routine isn't available."


def test_foreign_ref_leaves_columns_empty_and_own_ref_fills_them(conn):
    add_user(conn, OTHER)
    rid_b, (item_b,) = make_routine(uid=OTHER)
    tick(rid_b, "2026-10-20", item_b, uid=OTHER)
    for d in WEEK:
        add_trade(conn, UID, day=d, pnl=10.0)
    _p, sc, res = scan(conn, dplan(split={"by": "routine_done", "ref": rid_b}))
    assert all(r["routine_done"] is None for r in sc.rows) and res.groups == []
    assert sc.notices == [sources.S_ROUTINE_GONE]
    rid_a, (item_a,) = make_routine()
    tick(rid_a, "2026-10-20", item_a)
    _p, sc2, _ = scan(conn, dplan(split={"by": "routine_done", "ref": rid_a}))
    assert {r["day"]: r["routine_done"] for r in sc2.rows}["2026-10-20"] == "done"
    assert sc2.notices == []


# ── accounts, payload, sample book, data stamp, drill ────────────────────────────────────────

def test_viewer_account_is_ignored_for_tool_sources(conn):
    """W9-R19: a viewer's account (foreign or the member's own) reads as all, never a refusal."""
    rid, (item,) = make_routine()
    tick(rid, "2026-10-20", item)
    mine = add_account(conn, UID, "Swing")
    for acc in ("acct-not-mine", mine):
        out = run.run_plan(UID, rplan(range=WEEK_RANGE), {"accountId": acc}, lane="run", now=NOW)
        assert out["value"]["v1"] == 1.0 and out["notice"] is None
        assert out["accountId"] is None and out["scopeLabel"] == payload.S_ALL_ACCOUNTS
        got = drill.drill(UID, rplan(range=WEEK_RANGE), {"accountId": acc}, {}, now=NOW)
        assert got["count"] == 5 and got["note"] is None


def test_empty_sentences_and_summaries(conn):
    assert payload.S_EMPTY["routine_history"] == (
        "Start ticking your routine; history shows here from day one.")
    assert payload.S_EMPTY["tracker_history"] == "Log your first value; the chart starts with it."
    out = run.run_plan(UID, rplan(range={"token": "last_30d"}), {}, lane="run", now=NOW)
    assert out["count"] == 0 and out["empty"] == payload.S_EMPTY["routine_history"]
    assert out["summary"].endswith(" No days yet.") and " 0 days." not in out["summary"]
    out = run.run_plan(UID, tplan(range={"token": "last_30d"}), {}, lane="run", now=NOW)
    assert out["empty"] == payload.S_EMPTY["tracker_history"]
    assert out["summary"].endswith(" No entries yet.") and " 0 entries." not in out["summary"]
    # a wave 8 source keeps its count
    out = run.run_plan(UID, raw_plan(range={"token": "last_30d"}), {}, lane="run", now=NOW)
    assert out["summary"].endswith(" 0 trades.")


def test_tool_sources_never_sample(conn):
    rid, (item,) = make_routine()
    for d in sessions("2026-10-05", "2026-10-23")[:10]:
        tick(rid, d, item)
    assert run.wants_sample(conn, UID) is True                # 0 trades: the book would answer
    out = run.run_plan(UID, rplan(range={"token": "last_30d"}), {}, lane="preview", now=NOW,
                       sample=True)
    assert out["sample"] is False and out["value"]["v1"] == 10.0
    for key in plan.TOOL_SOURCES:
        with pytest.raises(ValueError):
            run.sample_rows(key)
    out = run.run_plan(UID, dplan(split={"by": "routine_done", "ref": rid},
                                  range={"token": "last_30d"}),
                       {}, lane="preview", now=NOW, sample=True)
    assert out["sample"] is False


def _stamps(c, ref_plan):
    return {"routine_history": run.data_stamp(c, UID, "routine_history"),
            "tracker_history": run.data_stamp(c, UID, "tracker_history"),
            "days_plain": run.data_stamp(c, UID, "trading_days", dplan()),
            "days_ref": run.data_stamp(c, UID, "trading_days", ref_plan)}


def test_stamp_busts_on_tick_value_skip_schedule_and_rename(conn):
    rid, (item,) = make_routine()
    t = trackers.create(UID, name="Sleep", kind="number", now=at("2026-10-19"))
    ref = dplan(split={"by": "routine_done", "ref": rid})
    s0 = _stamps(conn, ref)
    tick(rid, "2026-10-20", item)
    s1 = _stamps(conn, ref)
    assert s1["routine_history"] != s0["routine_history"] and s1["days_ref"] != s0["days_ref"]
    assert s1["tracker_history"] == s0["tracker_history"]
    assert s1["days_plain"] == s0["days_plain"]                # a plain widget's cache keeps
    routines.set_tick(UID, rid, "2026-10-20", item, False, now=at("2026-10-20"))   # same second
    s2 = _stamps(conn, ref)
    assert s2["routine_history"] != s1["routine_history"]
    trackers.set_value(UID, t["id"], "2026-10-20", 7, now=at("2026-10-20"))
    s3 = _stamps(conn, ref)
    assert s3["tracker_history"] != s2["tracker_history"] and s3["days_ref"] != s2["days_ref"]
    assert s3["routine_history"] == s2["routine_history"]
    skip(rid, "2026-10-21")
    s4 = _stamps(conn, ref)
    assert s4["routine_history"] != s3["routine_history"]
    skip(rid, "2026-10-21", on=False)                          # an unskip, same second
    s5 = _stamps(conn, ref)
    assert s5["routine_history"] != s4["routine_history"]
    etag = routines.get(UID, rid, now=NOW)["etag"]
    routines.update(UID, rid, if_match=etag, schedule={"kind": "weekdays", "days": [0]}, now=NOW)
    s6 = _stamps(conn, ref)
    assert s6["routine_history"] != s5["routine_history"]
    etag = routines.get(UID, rid, now=NOW)["etag"]
    routines.update(UID, rid, if_match=etag, name="Renamed", now=NOW)
    assert _stamps(conn, ref)["routine_history"] != s6["routine_history"]


def test_the_checkins_stamp_is_read_once(conn, monkeypatch):
    seen = []
    real = run._one

    def spy(c, sql, uid):
        seen.append(sql)
        return real(c, sql, uid)
    monkeypatch.setattr(run, "_one", spy)
    run.data_stamp(conn, UID, "trading_days", dplan(split={"by": "tracker_bucket",
                                                           "ref": "checkin:mood"}))
    assert seen.count(run._CHECKINS_STAMP) == 1


def test_cached_result_busts_when_a_tick_lands(conn):
    rid, (item,) = make_routine()
    raw = rplan(range={"token": "last_30d"})
    assert run.run_plan(UID, raw, {}, lane="run", now=NOW)["value"]["v1"] is None
    tick(rid, "2026-10-23", item)
    assert run.run_plan(UID, raw, {}, lane="run", now=NOW)["value"]["v1"] == 1.0


def test_drill_rows_for_both_sources(conn):
    rid, (a, b) = make_routine(items=("Plan", "Review"))
    tick(rid, "2026-10-22", a)
    t = trackers.create(UID, name="Sleep", kind="duration", now=at("2026-10-19"))
    trackers.set_value(UID, t["id"], "2026-10-22", 450, now=at("2026-10-22"))
    rng = {"from": "2026-10-22", "to": "2026-10-22"}
    out = drill.drill(UID, rplan(split={"by": "item"}, range=rng), {}, {"label": "Plan"}, now=NOW)
    assert out["rows"] == [{"day": "2026-10-22", "label": "Morning", "label2": "Plan",
                            "state": "done", "stateLabel": "Done"}]
    out = drill.drill(UID, rplan(split={"by": "state"}, range=rng), {}, {"label": "Not done"},
                      now=NOW)
    assert out["rows"] == [{"day": "2026-10-22", "label": "Morning", "label2": None,
                            "state": "not_done", "stateLabel": "Not done"}]
    out = drill.drill(UID, tplan(split={"by": "tracker"}, range=rng), {}, {"label": "Sleep"},
                      now=NOW)
    assert out["rows"] == [{"day": "2026-10-22", "label": "Sleep", "value": 450.0,
                            "text": "7h 30m"}]


def test_every_tool_measure_has_a_format_and_a_source():
    for key in plan.TOOL_SOURCES:
        ms = sources.CATALOG.measures_for(key)
        assert ms and all(m in payload.MEASURE_FMT for m in ms), key
        assert key in payload._CAP_ROWS and key in payload._CAP_UNIT


def test_sources_reach_routines_only_through_the_public_door():
    """W9-R15: the widget engine reads routines through `routines.history_for`, never the store's
    private helpers (an AST over the engine's files, not a grep of prose)."""
    import ast
    import pathlib
    root = pathlib.Path(sources.__file__).parent
    seen = []
    for f in sorted(root.glob("*.py")):
        tree = ast.parse(f.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if (isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name)
                    and node.value.id in ("j2_routines", "routines")):
                seen.append((f.name, node.attr))
    assert ("sources.py", "history_for") in seen                  # control: the walk sees it
    assert all(not attr.startswith("_") for _f, attr in seen), seen


def test_item_expansion_stops_at_the_cap(conn, monkeypatch):
    """W9-R17: items are expanded for the newest SCAN_ROWS + 1 rows only, never for every day."""
    _seed_heavy(conn, n_routines=30, n_items=25, years=2)

    class Counting:
        calls = 0

        def __getattr__(self, name):
            return getattr(real, name)

        def items_on(self, items, day):
            Counting.calls += 1
            return real.items_on(items, day)
    real = sources.routine_days
    monkeypatch.setattr(sources, "routine_days", Counting())
    p = plan.validate_plan(rplan(split={"by": "item"}, range={"token": "all"}), sources.CATALOG)
    sc = sources.scan(conn, p, {}, plan.resolve_range(p["range"], TODAY), UID, today=TODAY)
    assert sc.capped is True and len(sc.rows) == wcompile.SCAN_ROWS
    # 25 rows per routine-day: about 5,001 / 25 days are expanded, never the 5,000+ read
    assert Counting.calls <= (wcompile.SCAN_ROWS + 1) // 25 + 2, Counting.calls


# ── fix round 2 ──────────────────────────────────────────────────────────────────────────────

def _seed_ticks(c, rid, item, days):
    c.executemany("INSERT INTO j2_routine_ticks (user_id, routine_id, day, item_id, ticked,"
                  " updated_at) VALUES (?, ?, ?, ?, 1, '2026-10-23T12:00:00Z')",
                  [(UID, rid, d, item) for d in days])
    c.commit()


def test_consistency_does_not_depend_on_the_widgets_range(conn):
    """W9-R25: a weekly routine's rolling consistency is the same over "all", 9/01-10/23 and the
    last 30 days, and equals the rate the routine's own read reports."""
    rid, (item,) = make_routine(created="2026-06-01", schedule={"kind": "weekdays", "days": [0]})
    mondays = [d for d in sessions("2026-06-01", "2026-10-23")
               if date.fromisoformat(d).weekday() == 0]
    _seed_ticks(conn, rid, item, mondays[::3])                 # every third Monday done
    per_range = {}
    for rng_ in ({"token": "all"}, {"from": "2026-09-01", "to": "2026-10-23"},
                 {"token": "last_30d"}):
        _p, sc, _ = scan(conn, rplan(range=rng_))
        per_range[str(rng_)] = {r["day"]: r["consistency"] for r in sc.rows}
    want_days = [d for d in mondays if d >= "2026-09-25"]       # in all three ranges
    read = routines.read_days(UID, [rid], want_days, now=NOW)["routines"][rid]["days"]
    checked = 0
    for d in want_days:
        got = {k: v[d] for k, v in per_range.items()}
        assert len(set(got.values())) == 1, (d, got)
        # W9-R29: read_days withholds a rate (None) when the window holds no done day, while the
        # widget charts an honest 0.0; equality is checked where the card shows a rate.
        if read[d]["rate"] is None:
            continue
        checked += 1
        assert next(iter(got.values())) == pytest.approx(read[d]["rate"]), d
    assert checked >= 3                                         # control: the rail compared


def test_the_work_done_is_bounded_by_states_built(conn, monkeypatch):
    """I-2: a deterministic count of the day states built (not the clock): about
    (first window + lookback) sessions per routine, never the whole history."""
    import json
    start = TODAY - timedelta(days=730)
    days = sessions(start.isoformat(), "2026-10-23")
    for i in range(30):
        rid = str(uuid.uuid4())
        it = str(uuid.uuid4())
        conn.execute("INSERT INTO j2_routines (id, user_id, name, items_json, settings_json,"
                     " created_at, updated_at, save_seq) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
                     (rid, UID, f"R{i:02d}", json.dumps([{"id": it, "text": "x",
                      "from": start.isoformat(), "to": None}]),
                      json.dumps({"done_share": 1.0, "strict": False, "reminder": None}),
                      start.isoformat() + "T15:00:00Z", "2026-10-23T12:00:00Z"))
        conn.execute("INSERT INTO j2_routine_schedules (user_id, routine_id, effective_from,"
                     " schedule_json) VALUES (?, ?, ?, ?)",
                     (UID, rid, start.isoformat(), json.dumps({"kind": "every"})))
        _seed_ticks(conn, rid, it, days)
    built = {"n": 0}
    real = routines.routine_days.history

    def counting(**kw):
        out = real(**kw)
        built["n"] += len(out)
        return out
    monkeypatch.setattr(routines.routine_days, "history", counting)
    p = plan.validate_plan(rplan(range={"token": "all"}), sources.CATALOG)
    sc = sources.scan(conn, p, {}, plan.resolve_range(p["range"], TODAY), UID, today=TODAY)
    assert sc.capped is True and len(sc.rows) == wcompile.SCAN_ROWS
    k = -(-(wcompile.SCAN_ROWS + 1) // 30)
    bound = (k + 2 * routines.HISTORY_SINCE_LOOKBACK) * 30
    assert 0 < built["n"] <= bound, (built["n"], bound, len(days) * 30)


def test_a_closed_trades_stamp_reads_no_routine_or_tracker_table(conn, monkeypatch):
    """I-3: the tool stamps are built only by the branches that use them."""
    seen: list[str] = []
    real = run._one

    def spy(c, sql, uid):
        seen.append(sql)
        return real(c, sql, uid)
    monkeypatch.setattr(run, "_one", spy)
    tool_sql = set(run._ROUTINE_STAMPS) | set(run._TRACKER_STAMPS)
    for key, p in (("closed_trades", None), ("open_positions", None), ("trading_days", dplan())):
        seen.clear()
        run.data_stamp(conn, UID, key, p)
        assert seen and not (set(seen) & tool_sql), key
    seen.clear()
    run.data_stamp(conn, UID, "trading_days", dplan(split={"by": "routine_done",
                                                           "ref": str(uuid.uuid4())}))
    assert set(run._ROUTINE_STAMPS) <= set(seen)                # control: the branch reads them


def test_future_sessions_are_not_no_routine_yet(conn):
    """M-1: only past days before the routine existed count; sessions still to come leave quietly."""
    rid, _ = make_routine(created="2026-10-21")
    _p, sc, res = scan(conn, dplan(split={"by": "routine_done", "ref": rid},
                                   range={"from": "2026-10-19", "to": "2026-10-30"}))
    assert {r["day"] for r in sc.rows if r["routine_done"] is None} >= {"2026-10-19", "2026-10-26"}
    assert "2 days have no routine yet and are not in this split." in res.footnotes  # 10-19, 10-20


def test_labels_have_one_authority_and_today_reads_not_yet():
    """M-2 / W9-R26."""
    from api.services.journal_two import routine_days
    for code in ("done", "not_done", "skipped", "off"):
        assert sources.STATE_LABELS[code] == routine_days.STATE_LABELS[code]
    assert sources.STATE_LABELS["open"] == "Not yet" and sources.state_label("open") == "Not yet"


def test_group_order_is_read_at_call_time(conn, monkeypatch):
    """M-3: moving the source order moves the group order."""
    rid, (item,) = make_routine()
    tick(rid, "2026-10-20", item)
    skip(rid, "2026-10-21")
    raw = rplan(split={"by": "state"}, range=WEEK_RANGE)
    _p, _sc, res = scan(conn, raw)
    assert [g.label for g in res.groups] == ["Done", "Not done", "Skipped"]
    monkeypatch.setattr(sources, "HISTORY_STATES", ("skipped", "not_done", "done", "open"))
    _p, _sc, res = scan(conn, raw)
    assert [g.label for g in res.groups] == ["Skipped", "Not done", "Done"]



# ── fix round 3 ──────────────────────────────────────────────────────────────────────────────

def _routine_sql(c, name, schedule, start, n_items=1):
    import json
    rid = str(uuid.uuid4())
    items = [{"id": str(uuid.uuid4()), "text": f"i{k}", "from": start.isoformat(), "to": None}
             for k in range(n_items)]
    c.execute("INSERT INTO j2_routines (id, user_id, name, items_json, settings_json,"
              " created_at, updated_at, save_seq) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
              (rid, UID, name, json.dumps(items),
               json.dumps({"done_share": 1.0, "strict": False, "reminder": None}),
               start.isoformat() + "T15:00:00Z", "2026-10-23T12:00:00Z"))
    c.execute("INSERT INTO j2_routine_schedules (user_id, routine_id, effective_from,"
              " schedule_json) VALUES (?, ?, ?, ?)",
              (UID, rid, start.isoformat(), json.dumps(schedule)))
    return rid, [it["id"] for it in items]


def _mixed_seed(c, years, n_daily):
    start = TODAY - timedelta(days=365 * years)
    days = sessions(start.isoformat(), "2026-10-23")
    for i in range(n_daily):
        rid, items = _routine_sql(c, f"D{i:02d}", {"kind": "every"}, start, n_items=2)
        for it in items:
            _seed_ticks(c, rid, it, days)
    _routine_sql(c, "Sparse", {"kind": "traded"}, start)      # never traded: no counted day
    c.commit()
    return days


def test_one_sparse_routine_widens_no_other(conn, monkeypatch):
    """Round 3: each routine has its own floor (`routine_days.window_floor`), found in one pass;
    children load ONCE. 29 daily routines and one never-traded routine: the states built stay at
    the daily routines' window plus the sparse one's own history."""
    _mixed_seed(conn, 2, 29)
    built = {"states": 0, "contexts": 0, "calls": 0}
    real_hist, real_ctx, real_for = (routines.routine_days.history, routines._contexts,
                                     routines.history_for)

    def hist(**kw):
        out = real_hist(**kw)
        built["states"] += len(out)
        return out

    def ctx(*a, **kw):
        built["contexts"] += 1
        return real_ctx(*a, **kw)

    def hfor(*a, **kw):
        built["calls"] += 1
        return real_for(*a, **kw)
    monkeypatch.setattr(routines.routine_days, "history", hist)
    monkeypatch.setattr(routines, "_contexts", ctx)
    monkeypatch.setattr(sources.j2_routines, "history_for", hfor)
    p = plan.validate_plan(rplan(split={"by": "item"}, range={"token": "all"}), sources.CATALOG)
    sc = sources.scan(conn, p, {}, plan.resolve_range(p["range"], TODAY), UID, today=TODAY)
    assert sc.capped is True and len(sc.rows) == wcompile.SCAN_ROWS
    assert built["calls"] == 1 and built["contexts"] == 1          # one pass, one load
    k = -(-(wcompile.SCAN_ROWS + 1) // 30)
    bound = (k + 2 * routines.HISTORY_SINCE_LOOKBACK) * 29 + trading_days_max()
    assert 0 < built["states"] <= bound, (built["states"], bound)


def trading_days_max():
    from api.services.journal_two import routine_days
    return routine_days.MAX_HISTORY_SESSIONS


def test_window_floor_is_per_routine_and_tick_free():
    from api.services.journal_two import routine_days as RD
    items = RD.parse_items([{"id": "i", "text": "x", "from": "2026-01-02"}])
    every = [("2026-01-02", {"kind": "every"})]
    weekly = [("2026-01-02", {"kind": "weekdays", "days": [0]})]
    before, today = date(2026, 10, 19), date(2026, 10, 24)
    kw = dict(items=items, created=date(2026, 1, 2), archived=None, traded=frozenset(),
              before=before, today=today)
    assert RD.window_floor(schedules=every, **kw) == trading_days.nth_session_before(before, 20)
    f = RD.window_floor(schedules=weekly, **kw)
    mondays = [d for d in sessions(f.isoformat(), "2026-10-16")
               if date.fromisoformat(d).weekday() == 0]
    assert f.weekday() == 0 and len(mondays) == 20
    never = [("2026-01-02", {"kind": "traded"})]
    assert RD.window_floor(schedules=never, **kw) == date(2026, 1, 2)   # reaches created


@pytest.mark.skipif(os.environ.get("UCT_WIDGET_W9_10Y") != "1",
                    reason="seeding 10 years x 60 routines is slow; set UCT_WIDGET_W9_10Y=1")
def test_10_years_60_routines_one_sparse_is_well_under_the_deadline(conn):
    days = _mixed_seed(conn, 10, 59)
    for rng_ in ({"token": "all"}, {"from": "2026-09-01", "to": "2026-10-23"},
                 {"token": "last_30d"}):
        p = plan.validate_plan(rplan(range=rng_), sources.CATALOG)
        rr = plan.resolve_range(p["range"], TODAY)
        t0 = time.perf_counter()
        with run.deadline(conn):
            sources.scan(conn, p, {}, rr, UID, today=TODAY)
        took = time.perf_counter() - t0
        print(f"\n10y x 60 ({len(days)} sessions) {rng_}: {took * 1000:.0f} ms")
        assert took < 1.0, (rng_, took)


def test_tracker_future_sessions_are_not_no_value(conn):
    """Round 3 M-1 for trackers: only past days without a value count."""
    t = trackers.create(UID, name="Sleep", kind="number", now=at("2026-10-19"))
    trackers.set_value(UID, t["id"], "2026-10-21", 7, now=at("2026-10-21"))
    _p, sc, res = scan(conn, dplan(split={"by": "tracker_bucket", "ref": t["id"]},
                                   range={"from": "2026-10-19", "to": "2026-10-30"}))
    assert "4 days have no value for this tracker and are not in this split." in res.footnotes
    _p, _sc, res2 = scan(conn, dplan(filters=[{"field": "tracker_value", "op": "gte",
                                               "values": [0], "ref": t["id"]}],
                                     range={"from": "2026-10-19", "to": "2026-10-30"}))
    assert "4 days have no value for this tracker and are left out." in res2.footnotes


def test_day_refs_read_no_consistency_window(conn, monkeypatch):
    """Round 3 M-2: a trading-days ref reads states from the range's start (window=False); it
    builds no lookback, so a long-lived weekly routine costs the range only."""
    rid, _ = make_routine(created="2026-01-05", schedule={"kind": "weekdays", "days": [0]})
    seen = []
    real = sources.j2_routines.history_for

    def spy(*a, **kw):
        seen.append(kw)
        return real(*a, **kw)
    monkeypatch.setattr(sources.j2_routines, "history_for", spy)
    executed: list[str] = []
    conn.set_trace_callback(executed.append)
    try:
        _p, sc, _ = scan(conn, dplan(split={"by": "routine_done", "ref": rid}))
    finally:
        conn.set_trace_callback(None)
    assert len(seen) == 1 and seen[0]["window"] is False
    assert seen[0]["since"] == date.fromisoformat(WEEK[0])
    tick_reads = [q for q in executed if "j2_routine_ticks" in q]
    # one tick read, from the range's own start (the floor bound in the VALUES table)
    assert len(tick_reads) == 1 and "'" + WEEK[0] + "'" in tick_reads[0]
    assert {r["routine_done"] for r in sc.rows} == {"not_done", "off"}


def test_widget_consistency_is_zero_where_the_card_withholds_a_rate(conn):
    """W9-R29: no done day in the window -> the widget charts 0.0 (honest data), read_days gives
    rate None (the card shows no sentence). Both intended; pinned here."""
    rid, _ = make_routine(created="2026-10-05")
    _p, sc, _ = scan(conn, rplan(range=WEEK_RANGE))
    assert {r["consistency"] for r in sc.rows} == {0.0}
    read = routines.read_days(UID, [rid], ["2026-10-21"], now=NOW)["routines"][rid]["days"]
    assert read["2026-10-21"]["rate"] is None and read["2026-10-21"]["consistency"] is None


# ── fix round 4 ──────────────────────────────────────────────────────────────────────────────

class _Recording:
    def __init__(self, c):
        self.c, self.log = c, []

    def execute(self, sql, params=()):
        self.log.append((sql, tuple(params)))
        return self.c.execute(sql, params)


def _seeks_per_routine(plan_rows):
    details = [r[3] for r in plan_rows]
    inner = [d for d in details if d.startswith(("SEARCH t ", "SEARCH s ", "SCAN t", "SCAN s"))]
    outer = details.index("SCAN lo") if "SCAN lo" in details else -1
    return (len(inner) == 1 and "routine_id=?" in inner[0] and "day>?" in inner[0]
            and 0 <= outer < details.index(inner[0]))


def test_per_routine_floor_queries_seek_each_routine(conn):
    """W9-R32: lo stays the outer loop; each routine is one (user, routine, day) range seek.
    60 routines (MAX_ROUTINES): a plain JOIN flips only from 38 VALUES rows."""
    rids = [str(uuid.uuid4()) for _ in range(sources.MAX_ROUTINES)]
    rec = _Recording(conn)
    routines._load_children(rec, UID, rids, date(2026, 10, 24), {r: date(2026, 9, 1) for r in rids})
    q = [(s, p) for s, p in rec.log if s.lstrip().startswith("WITH lo")]
    assert len(q) == 2
    for sql, params in q:
        assert _seeks_per_routine(conn.execute("EXPLAIN QUERY PLAN " + sql, params)), sql
        plain = sql.replace("CROSS JOIN", "JOIN")
        assert plain != sql
        # control: the predicate can fail on this SQLite
        assert not _seeks_per_routine(conn.execute("EXPLAIN QUERY PLAN " + plain, params))


def _has_row_by_history(RD, *, items, schedules, created, archived, traded, lo, hi, today):
    """The oracle: does the full history hold a day that is not off in [lo, hi]?"""
    if hi < created:
        return False
    return any(s.state != "off" and s.day >= lo.isoformat()
               for s in RD.history(items=items, schedules=schedules, ticks_by_day={},
                                   skipped_days=frozenset(), created=created, upto=hi,
                                   today=today, traded=traded, done_share=1.0,
                                   archived=archived))


def test_has_scheduled_day_matches_the_history():
    """W9-R36: the tick-free check says yes exactly when the history has a scheduled day in the
    span (seeded random routines: every / weekdays / traded stretches, item windows, created,
    archived, traded days on and off sessions, today inside the span)."""
    import random
    from api.services.journal_two import routine_days as RD
    rnd = random.Random(9836)
    base, today = date(2026, 6, 1), date(2026, 10, 21)          # today is a Wednesday session
    span = (today - base).days
    yes = no = 0
    for _ in range(400):
        def day(lo_=0, hi_=span):
            return base + timedelta(days=rnd.randint(lo_, hi_))
        scheds = []
        for _k in range(rnd.randint(1, 3)):
            kind = rnd.choice(("every", "weekdays", "traded"))
            s = {"kind": kind}
            if kind == "weekdays":
                s["days"] = rnd.sample(range(5), rnd.randint(0, 2))
            scheds.append((day().isoformat(), s))
        scheds.sort(key=lambda x: x[0])
        raw = []
        for k in range(rnd.randint(1, 2)):
            f = day()
            to = f + timedelta(days=rnd.randint(1, 40)) if rnd.random() < 0.6 else None
            raw.append({"id": f"i{k}", "text": "x", "from": f.isoformat(),
                        "to": to.isoformat() if to else None})
        items = RD.parse_items(raw)
        traded = frozenset(day().isoformat() for _k in range(rnd.randint(0, 4)))
        created = day()
        archived = day() if rnd.random() < 0.3 else None
        lo = day()
        hi = min(today, lo + timedelta(days=rnd.randint(0, 60)))
        kw = dict(items=items, schedules=scheds, created=created, archived=archived,
                  traded=traded, lo=lo, hi=hi, today=today)
        want = _has_row_by_history(RD, **kw)
        assert RD.has_scheduled_day(**kw) is want, kw
        yes, no = yes + want, no + (not want)
    assert yes >= 40 and no >= 40, (yes, no)                    # control: both answers seen


def test_a_routine_without_a_scheduled_day_is_never_built(conn, monkeypatch):
    """W9-R36: 4 years, 20 never-traded routines and one whose only item starts after the range:
    no children are loaded, no state is built, no row is made; the estimated-entries note still
    reads (a traded routine with no row still leaves those days out)."""
    start = TODAY - timedelta(days=4 * 365)
    for i in range(20):
        _routine_sql(conn, f"N{i:02d}", {"kind": "traded"}, start)
    rid, _ = _routine_sql(conn, "Later", {"kind": "every"}, start)
    conn.execute("UPDATE j2_routines SET items_json = ? WHERE id = ?",
                 ('[{"id": "x", "text": "x", "from": "2026-12-01", "to": null}]', rid))
    add_position(conn, UID, entry_iso="2026-10-21T14:00:00Z", estimated=1)
    conn.commit()
    built = {"states": 0, "contexts": 0}
    real_hist, real_ctx = routines.routine_days.history, routines._contexts

    def hist(**kw):
        out = real_hist(**kw)
        built["states"] += len(out)
        return out

    def ctx(*a, **kw):
        built["contexts"] += 1
        return real_ctx(*a, **kw)
    monkeypatch.setattr(routines.routine_days, "history", hist)
    monkeypatch.setattr(routines, "_contexts", ctx)
    note = sources.ESTIMATED_ENTRIES.format(n=1, positions="position", is_="is")
    for rng_ in ({"token": "all"}, RANGE):
        _p, sc, _ = scan(conn, rplan(range=rng_))
        assert sc.rows == [] and built == {"states": 0, "contexts": 0}, (rng_, built)
        assert note in sc.footnotes, sc.footnotes


def test_skipping_unscheduled_routines_changes_no_row(conn, monkeypatch):
    """W9-R36 control: with the check forced to say yes for every routine, the rows are the same
    (the skip only saves work), and that run does build the skipped routines."""
    start = TODAY - timedelta(days=300)
    days = sessions(start.isoformat(), "2026-10-23")
    for i in range(3):
        rid, items = _routine_sql(conn, f"D{i}", {"kind": "every"}, start)
        _seed_ticks(conn, rid, items[0], days[::2])
    for i in range(3):
        _routine_sql(conn, f"N{i}", {"kind": "traded"}, start)
    w, (wi,) = _routine_sql(conn, "Weekly", {"kind": "weekdays", "days": [2]}, start)
    _seed_ticks(conn, w, wi, days[::5])
    raws = [rplan(range={"token": "all"}), rplan(range=RANGE, split={"by": "item"}),
            rplan(range={"token": "last_30d"}, split={"by": "state"})]
    skipped = [scan(conn, raw)[1].rows for raw in raws]
    built = {"n": 0}
    real_hist = routines.routine_days.history

    def hist(**kw):
        built["n"] += 1
        return real_hist(**kw)
    monkeypatch.setattr(routines.routine_days, "history", hist)
    monkeypatch.setattr(routines.routine_days, "has_scheduled_day", lambda **kw: True)
    every = [scan(conn, raw)[1].rows for raw in raws]
    assert every == skipped and all(skipped)
    assert built["n"] >= 3 * 7                                  # the never-traded ones were built


def _monthly_seed(c, years, n):
    start = TODAY - timedelta(days=365 * years)
    firsts, seen = [], set()
    for d in sessions(start.isoformat(), "2026-10-23"):
        if d[:7] not in seen:
            seen.add(d[:7])
            firsts.append(d)
    for d in firsts:
        add_trade(c, UID, day=d, commit=False)
    for i in range(n):
        rid, items = _routine_sql(c, f"M{i:02d}", {"kind": "traded"}, start)
        _seed_ticks(c, rid, items[0], firsts[::2])
    c.commit()
    return firsts


def test_a_window_that_projects_short_of_the_cap_builds_the_whole_range_once(conn, monkeypatch):
    """W9-R38/W9-R39: 30 routines on a traded schedule, the member trading once a month for 4 years
    (about 1,470 rows, far under the cap): the schedule-only bound (about 1,470) is within the cap,
    so the build after the first window is the whole range: two builds, never the doubling's four."""
    firsts = _monthly_seed(conn, 4, 30)
    built = {"states": 0, "calls": 0}
    real_hist, real_for = routines.routine_days.history, routines.history_for

    def hist(**kw):
        out = real_hist(**kw)
        built["states"] += len(out)
        return out

    def hfor(*a, **kw):
        built["calls"] += 1
        return real_for(*a, **kw)
    monkeypatch.setattr(routines.routine_days, "history", hist)
    monkeypatch.setattr(sources.j2_routines, "history_for", hfor)
    _p, sc, _ = scan(conn, rplan(range={"token": "all"}))
    assert sc.capped is False and len(sc.rows) == 30 * len(firsts)
    assert built["calls"] == 2, built
    # the first window (k sessions + each routine's 20 traded months back, ~21 sessions each) and
    # the whole range, once
    k = -(-(wcompile.SCAN_ROWS + 1) // 30)
    span = len(sessions((TODAY - timedelta(days=4 * 365)).isoformat(), "2026-10-23"))
    assert built["states"] <= (k + 21 * 23 + span) * 30, built


def test_a_window_that_projects_past_the_cap_keeps_doubling(conn, monkeypatch):
    """W9-R39 control: 30 Monday routines over 4 years (about 6,200 rows, past the cap): the first
    window holds only about 1,000 and the schedule bound is past the cap, so the window keeps
    doubling and the whole range is built only once doubling reaches it."""
    start = TODAY - timedelta(days=4 * 365)
    for i in range(30):
        _routine_sql(conn, f"W{i:02d}", {"kind": "weekdays", "days": [0]}, start)
    conn.commit()
    calls = {"n": 0}
    real_for = routines.history_for

    def hfor(*a, **kw):
        calls["n"] += 1
        return real_for(*a, **kw)
    monkeypatch.setattr(sources.j2_routines, "history_for", hfor)
    _p, sc, _ = scan(conn, rplan(range={"token": "all"}))
    assert sc.capped is True and len(sc.rows) == wcompile.SCAN_ROWS
    assert calls["n"] == 4, calls                               # k, 2k, 4k, then the whole range

def test_window_floor_reads_the_window_at_call_time(monkeypatch):
    """Minor 2: `window_floor`'s count is late-bound, so a patched CONSISTENCY_WINDOW moves it."""
    from api.services.journal_two import routine_days as RD
    items = RD.parse_items([{"id": "i", "text": "x", "from": "2026-01-02"}])
    before = date(2026, 10, 19)
    kw = dict(items=items, schedules=[("2026-01-02", {"kind": "every"})], created=date(2026, 1, 2),
              archived=None, traded=frozenset(), before=before, today=date(2026, 10, 24))
    assert RD.window_floor(**kw) == trading_days.nth_session_before(before, 20)
    monkeypatch.setattr(RD, "CONSISTENCY_WINDOW", 5)
    assert RD.window_floor(**kw) == trading_days.nth_session_before(before, 5)
    assert RD.window_floor(n=7, **kw) == trading_days.nth_session_before(before, 7)


# ── fix round 5 ──────────────────────────────────────────────────────────────────────────────

def test_scheduled_capacity_is_a_sound_upper_bound():
    """W9-R39: the schedule-only capacity is never below the scheduled days the history holds in
    the span (seeded random routines, the same shapes as the W9-R36 check), and it is exact for a
    plain every-day routine."""
    import random
    from api.services.journal_two import routine_days as RD
    rnd = random.Random(9839)
    base, today = date(2026, 6, 1), date(2026, 10, 21)
    span = (today - base).days
    index = RD.SessionIndex(base, today)
    tight = 0
    for _ in range(400):
        def day(lo_=0, hi_=span):
            return base + timedelta(days=rnd.randint(lo_, hi_))
        scheds = []
        for _k in range(rnd.randint(1, 3)):
            kind = rnd.choice(("every", "weekdays", "traded"))
            s = {"kind": kind}
            if kind == "weekdays":
                s["days"] = rnd.sample(range(7), rnd.randint(0, 3))
            scheds.append((day().isoformat(), s))
        scheds.sort(key=lambda x: x[0])
        items = RD.parse_items([{"id": "i", "text": "x", "from": day().isoformat()}])
        traded = frozenset(day().isoformat() for _k in range(rnd.randint(0, 6)))
        created = day()
        archived = day() if rnd.random() < 0.3 else None
        lo = day()
        hi = min(today, lo + timedelta(days=rnd.randint(0, 90)))
        cap = RD.scheduled_capacity(schedules=scheds, created=created, archived=archived,
                                    traded_sorted=sorted(traded), lo=lo, hi=hi, today=today,
                                    index=index)
        held = 0 if hi < created else sum(
            1 for s in RD.history(items=items, schedules=scheds, ticks_by_day={},
                                  skipped_days=frozenset(), created=created, upto=hi,
                                  today=today, traded=traded, done_share=1.0, archived=archived)
            if s.state != "off" and s.day >= lo.isoformat())
        assert held <= cap, (held, cap, scheds, created, archived, lo, hi, sorted(traded))
        tight += held == cap
    assert tight >= 20                                          # control: often exact, not huge
    every = [("2026-06-01", {"kind": "every"})]
    assert RD.scheduled_capacity(schedules=every, created=base, archived=None, traded_sorted=[],
                                 lo=date(2026, 10, 5), hi=date(2026, 10, 16), today=today,
                                 index=index) == 10


def _scan_counting(c, monkeypatch, raw):
    built = {"states": 0, "calls": 0}
    real_hist, real_for = routines.routine_days.history, routines.history_for

    def hist(**kw):
        out = real_hist(**kw)
        built["states"] += len(out)
        return out

    def hfor(*a, **kw):
        built["calls"] += 1
        return real_for(*a, **kw)
    monkeypatch.setattr(routines.routine_days, "history", hist)
    monkeypatch.setattr(sources.j2_routines, "history_for", hfor)
    p = plan.validate_plan(raw, sources.CATALOG)
    rr = plan.resolve_range(p["range"], TODAY)
    with run.deadline(c):                                       # the answer, under the deadline
        sc = sources.scan(c, p, {}, rr, UID, today=TODAY)
    monkeypatch.setattr(routines.routine_days, "history", real_hist)
    monkeypatch.setattr(sources.j2_routines, "history_for", real_for)
    return sc, built


def test_routines_archived_a_year_ago_keep_doubling(conn, monkeypatch):
    """W9-R39: 60 every-day routines over 10 years, all archived a year ago. The newest window holds
    no row, which a density projection read as "the whole range is small" (round 4: about 136k
    states, too long). The schedule bound is far past the cap, so the window doubles as round 3 did
    (round 3: 3 builds, 8,760 states), and the answer comes under the deadline."""
    start = TODAY - timedelta(days=3650)
    arch = (TODAY - timedelta(days=365)).isoformat() + "T20:00:00Z"
    for i in range(60):
        rid, _ = _routine_sql(conn, f"A{i:02d}", {"kind": "every"}, start)
        conn.execute("UPDATE j2_routines SET archived_at = ? WHERE id = ?", (arch, rid))
    conn.commit()
    for split in (None, {"by": "item"}):
        kw = {"split": split} if split else {}
        sc, built = _scan_counting(conn, monkeypatch, rplan(range={"token": "all"}, **kw))
        assert sc.capped is True and len(sc.rows) == wcompile.SCAN_ROWS
        assert built["calls"] <= 3 and built["states"] <= 8760, (split, built)


def test_routines_switched_to_traded_a_year_ago_keep_doubling(conn, monkeypatch):
    """W9-R39: 60 routines every day for 9 years, then on a traded schedule for the last year with
    no trade. Round 3: 3 builds, 53,520 states; never more than that."""
    start = TODAY - timedelta(days=3650)
    switch = (TODAY - timedelta(days=360)).isoformat()
    for i in range(60):
        rid, _ = _routine_sql(conn, f"E{i:02d}", {"kind": "every"}, start)
        conn.execute("INSERT INTO j2_routine_schedules (user_id, routine_id, effective_from,"
                     " schedule_json) VALUES (?, ?, ?, ?)",
                     (UID, rid, switch, '{"kind": "traded"}'))
    conn.commit()
    sc, built = _scan_counting(conn, monkeypatch, rplan(range={"token": "all"}))
    assert sc.capped is True and len(sc.rows) == wcompile.SCAN_ROWS
    assert built["calls"] <= 3 and built["states"] <= 53520, built


def test_row_capacity_reads_no_tick_and_builds_no_history(conn, monkeypatch):
    """W9-R39: the bound comes from the schedules alone; for the 4-year monthly seed it is the
    traded days (plus today) per routine, about 1,440, within the cap."""
    firsts = _monthly_seed(conn, 4, 30)
    monkeypatch.setattr(routines.routine_days, "history",
                        lambda **kw: (_ for _ in ()).throw(AssertionError("built a history")))
    executed: list[str] = []
    conn.set_trace_callback(executed.append)
    try:
        ids = [r[0] for r in conn.execute("SELECT id FROM j2_routines WHERE user_id = ?", (UID,))]
        n = routines.row_capacity(conn, UID, ids, routines.DAY_MIN, TODAY, TODAY)
    finally:
        conn.set_trace_callback(None)
    assert not [q for q in executed if "j2_routine_ticks" in q or "j2_routine_days" in q]
    assert n == 30 * (len(firsts) + 1) and n <= wcompile.SCAN_ROWS


def test_the_schedule_checks_ask_the_deadline():
    """Round 5 M1: `has_scheduled_day`'s loops and the bound's session index ask
    `wcompile.check_deadline()`, so an expired run stops inside them."""
    from api.services.journal_two import routine_days as RD
    items = RD.parse_items([{"id": "i", "text": "x", "from": "2016-01-04"}])
    far = frozenset((date(2000, 1, 1) + timedelta(days=i)).isoformat() for i in range(2000))
    kw = dict(items=items, schedules=[("2016-01-04", {"kind": "traded"})],
              created=date(2016, 1, 4), archived=None, traded=far, lo=date(2016, 1, 4),
              hi=date(2026, 10, 23), today=TODAY)
    assert RD.has_scheduled_day(**kw) is False                  # control: it runs to the end
    with wcompile.python_deadline(lambda: True):
        with pytest.raises(wcompile.ScanTooLong):
            RD.has_scheduled_day(**kw)
        with pytest.raises(wcompile.ScanTooLong):
            RD.SessionIndex(date(2016, 1, 4), date(2026, 10, 23))
    # an every-day stretch whose items are each valid on one Saturday only: a long walk, no session
    sats = [date(2016, 1, 9) + timedelta(weeks=w) for w in range(600)]
    walk = dict(kw, schedules=[("2016-01-04", {"kind": "every"})], traded=frozenset(),
                items=RD.parse_items([{"id": f"s{w}", "text": "x", "from": d.isoformat(),
                                       "to": (d + timedelta(days=1)).isoformat()}
                                      for w, d in enumerate(sats)]))
    assert RD.has_scheduled_day(**walk) is False                # control: it walks to the end
    with wcompile.python_deadline(lambda: True):
        with pytest.raises(wcompile.ScanTooLong):
            RD.has_scheduled_day(**walk)


def test_row_capacity_counts_one_row_per_item_when_split_by_item(conn):
    """W9-R39: split by item, a day is one row per item, so the bound is times the item count."""
    _routine_sql(conn, "Three", {"kind": "every"}, date(2026, 10, 5), n_items=3)
    conn.commit()
    ids = [r[0] for r in conn.execute("SELECT id FROM j2_routines WHERE user_id = ?", (UID,))]
    lo, hi = date(2026, 10, 5), date(2026, 10, 23)
    one = routines.row_capacity(conn, UID, ids, lo, hi, TODAY)
    assert one == 15 and routines.row_capacity(conn, UID, ids, lo, hi, TODAY, per_item=True) == 45
