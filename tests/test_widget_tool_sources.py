"""Task 9.8 -- routine history and tracker history as builder sources (wave 9), with fix round 1.

Seeded through `auth_db.init_db` on a temp sqlite file (the Task 8.5 `conn` fixture), with routines
and trackers written through their own stores (`routines.create` / `set_tick` / `set_skipped`,
`trackers.create` / `set_value`) at injected times. Nothing here reaches `C:\\data`.

The sessions used are real 2026 sessions: 2026-10-05 .. 2026-10-23 (no holiday), today 2026-10-24
(a Saturday), so every day in range is a finished day unless a test says otherwise.
"""
from __future__ import annotations

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
    assert sc.rows[0]["state"] == "open" and "Open" in [g.label for g in res.groups]
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
    cap, wall time stays well under the 1.5 s run deadline on this box (measured ~0.5 s), and the
    memory a scan allocates is bounded."""
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
            assert took < 1.0, (rng_, split, took)
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
                            "state": "done"}]
    out = drill.drill(UID, rplan(split={"by": "state"}, range=rng), {}, {"label": "Not done"},
                      now=NOW)
    assert out["rows"] == [{"day": "2026-10-22", "label": "Morning", "label2": None,
                            "state": "not_done"}]
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
