"""Task 9.8 -- routine history and tracker history as builder sources (wave 9).

Seeded through `auth_db.init_db` on a temp sqlite file (the Task 8.5 `conn` fixture), with routines
and trackers written through their own stores (`routines.create` / `set_tick` / `set_skipped`,
`trackers.create` / `set_value`) at injected times. Nothing here reaches `C:\\data`.

The sessions used are real 2026 sessions: 2026-10-05 .. 2026-10-23 (no holiday), today 2026-10-24
(a Saturday), so every day in range is a finished day.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two import routines, tracker_days, trackers, trading_days
from api.services.journal_two.widget_engine import aggregate, drill, payload, plan, run, sources
from tests.test_widget_sources import (  # noqa: F401 -- `conn` is a fixture used by name
    UID, add_checkin, add_note, add_position, add_trade, add_user, conn, raw_plan,
)

TODAY = date(2026, 10, 24)
NOW = datetime(2026, 10, 24, 15, 30, tzinfo=timezone.utc)
OTHER = "u-wtool-other"
WEEK = ("2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23")
RANGE = {"from": "2026-10-05", "to": "2026-10-23"}


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


def skip(rid, day, uid=UID):
    routines.set_skipped(uid, rid, day, True, now=at(day))


def scan(c, raw, uid=UID):
    p = plan.validate_plan(raw, sources.CATALOG)
    rng = plan.resolve_range(p["range"], TODAY)
    sc = sources.scan(c, p, {}, rng, uid, today=TODAY)
    return p, sc, aggregate.evaluate(sc.rows, p, sources.CATALOG)


def rplan(measures=("routine_days_done",), **kw):
    kw.setdefault("range", RANGE)
    return raw_plan(source="routine_history", measures=measures, **kw)


def tplan(measures=("tracker_entries",), **kw):
    kw.setdefault("range", RANGE)
    return raw_plan(source="tracker_history", measures=measures, **kw)


# ── routine history ──────────────────────────────────────────────────────────────────────────

def test_routine_history_rows_scheduled_days_only_newest_first(conn):
    rid, (item,) = make_routine(schedule={"kind": "weekdays", "days": [0, 2, 4]})  # Mon Wed Fri
    for d in ("2026-10-05", "2026-10-09", "2026-10-21"):
        tick(rid, d, item)
    _p, sc, res = scan(conn, rplan())
    expected = [d for d in sessions("2026-10-05", "2026-10-23")
                if date.fromisoformat(d).weekday() in (0, 2, 4)]
    assert [r["day"] for r in sc.rows] == sorted(expected, reverse=True)
    assert all(date.fromisoformat(r["day"]).weekday() in (0, 2, 4) for r in sc.rows)  # no off day
    states = {r["day"]: r["state"] for r in sc.rows}
    assert states["2026-10-21"] == "Done" and states["2026-10-19"] == "Not done"
    assert {r["routine"] for r in sc.rows} == {rid} and sc.rows[0]["label"] == "Morning"
    assert sc.capped is False and sc.earliest_day == "2026-10-05"
    assert res.total.cells[0].value == 3.0


def test_routine_history_leaves_out_days_before_created_and_after_range(conn):
    rid, (item,) = make_routine(created="2026-10-14")
    tick(rid, "2026-10-14", item)
    _p, sc, _res = scan(conn, rplan(range={"from": "2026-10-05", "to": "2026-10-16"}))
    assert [r["day"] for r in sc.rows] == ["2026-10-16", "2026-10-15", "2026-10-14"]


def test_split_by_item_expands_rows(conn):
    rid, (a, b) = make_routine(items=("Plan", "Review"))
    tick(rid, "2026-10-21", a)                                 # one of two: the day is Not done
    tick(rid, "2026-10-22", a)
    tick(rid, "2026-10-22", b)                                 # both: Done
    skip(rid, "2026-10-23")
    raw = rplan(measures=("routine_days_done",), split={"by": "item"},
                range={"from": "2026-10-21", "to": "2026-10-23"})
    _p, sc, res = scan(conn, raw)
    assert len(sc.rows) == 3 * 2                               # one row per item per day
    got = {(r["day"], r["item_text"]): r["state"] for r in sc.rows}
    assert got == {("2026-10-21", "Plan"): "Done", ("2026-10-21", "Review"): "Not done",
                   ("2026-10-22", "Plan"): "Done", ("2026-10-22", "Review"): "Done",
                   ("2026-10-23", "Plan"): "Skipped", ("2026-10-23", "Review"): "Skipped"}
    by = {g.label: g.values.cells[0].value for g in res.groups}
    assert by == {"Plan": 2.0, "Review": 1.0}
    # without the item split the same days are one row each, the half-ticked day Not done
    _p, sc2, _ = scan(conn, rplan(range={"from": "2026-10-21", "to": "2026-10-23"}))
    assert [r["state"] for r in sc2.rows] == ["Skipped", "Done", "Not done"]


def test_item_is_split_only():
    with pytest.raises(plan.PlanError) as e:
        plan.validate_plan(rplan(filters=[{"field": "item", "op": "in", "values": ["x"]}]),
                           sources.CATALOG)
    assert e.value.sentence == plan.S_NOT_A_FILTER


def test_consistency_and_completion_measures_differ_on_skips(conn):
    rid, (item,) = make_routine(created="2026-10-19")         # no earlier day in the rolling rate
    tick(rid, "2026-10-19", item)
    tick(rid, "2026-10-20", item)
    skip(rid, "2026-10-22")                                    # 10-21 and 10-23 Not done
    raw = rplan(measures=("routine_consistency", "routine_completion_pct", "routine_days_done"),
                range={"from": "2026-10-19", "to": "2026-10-23"})
    _p, sc, res = scan(conn, raw)
    cons, comp, done = (c.value for c in res.total.cells)
    assert cons == pytest.approx(2 / 4) and comp == pytest.approx(2 / 5) and done == 2.0
    assert cons != comp
    # the `consistency` field is the rolling rate as of each day (a skip leaves the denominator)
    rate = {r["day"]: r["consistency"] for r in sc.rows}
    assert rate["2026-10-20"] == pytest.approx(2 / 2) and rate["2026-10-22"] == pytest.approx(2 / 3)
    # strict: a skip counts against
    make_routine(strict=True, name="Strict", created="2026-10-19")
    _p, sc3, _ = scan(conn, rplan(measures=("routine_consistency",), split={"by": "routine"},
                                  range={"from": "2026-10-19", "to": "2026-10-23"}))
    assert any(r["strict"] for r in sc3.rows) and any(not r["strict"] for r in sc3.rows)


def test_routine_measures_never_show_zero(conn):
    make_routine()
    raw = rplan(measures=("routine_consistency", "routine_completion_pct", "routine_days_done"),
                range={"from": "2026-10-19", "to": "2026-10-23"})
    _p, sc, res = scan(conn, raw)
    assert len(sc.rows) == 5 and all(r["state"] == "Not done" for r in sc.rows)
    assert [c.value for c in res.total.cells] == [None, None, None]     # W9-R7


def test_routine_history_counts_estimated_entries_on_a_traded_schedule(conn):
    rid, (item,) = make_routine(schedule={"kind": "traded"})
    add_trade(conn, UID, day="2026-10-20", pnl=10.0)
    add_position(conn, UID, entry_iso="2026-10-21T14:00:00Z", estimated=1)   # left out, counted
    add_position(conn, UID, entry_iso="2026-10-22T14:00:00Z", estimated=1)
    tick(rid, "2026-10-20", item)
    _p, sc, _ = scan(conn, rplan(range={"from": "2026-10-19", "to": "2026-10-23"}))
    assert [r["day"] for r in sc.rows] == ["2026-10-20"]       # only the day traded
    note = sources.ESTIMATED_ENTRIES.format(n=2, positions="positions", is_="are")
    assert note in sc.footnotes
    # an every-day routine carries no such note
    conn.execute("DELETE FROM j2_routines")
    conn.commit()
    make_routine()
    _p, sc2, _ = scan(conn, rplan(range={"from": "2026-10-19", "to": "2026-10-23"}))
    assert not any("estimated" in f for f in sc2.footnotes)


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
    assert [r["day"] for r in sc.rows] == sorted((r["day"] for r in sc.rows), reverse=True)
    labels = {g.label: (g.values.cells[0].value, g.values.cells[1].value) for g in res.groups}
    assert labels == {"Sleep": (2.0, 450.0), "Check-in mood": (1.0, 4.0),
                      "Check-in focus": (1.0, 2.0)}
    sleep = next(r for r in sc.rows if r["day"] == "2026-10-20")
    assert sleep["text"] == "7h"


def test_tracker_history_is_as_of_the_range_end(conn):
    t = trackers.create(UID, name="Weight", kind="number", unit="lb", now=at("2026-10-19"))
    for d, v in (("2026-10-19", 180), ("2026-10-21", 181), ("2026-10-23", 179)):
        trackers.set_value(UID, t["id"], d, v, now=at(d))
    _p, sc, res = scan(conn, tplan(measures=("tracker_latest",),
                                   range={"from": "2026-10-19", "to": "2026-10-21"}))
    assert res.total.cells[0].value == 181.0                   # W9-R13: never the later 179
    assert all(r["day"] <= "2026-10-21" for r in sc.rows)


# ── the trading-days fields that name a routine or a tracker ─────────────────────────────────

def test_trading_days_split_by_routine_done_and_off_day_footnote(conn):
    rid, (item,) = make_routine(schedule={"kind": "weekdays", "days": [0, 2, 4]})
    tick(rid, "2026-10-19", item)
    tick(rid, "2026-10-23", item)                              # Wed 10-21 Not done
    for d in WEEK:
        add_trade(conn, UID, day=d, pnl=100.0 if d != "2026-10-21" else -50.0)
    raw = raw_plan(source="trading_days", measures=("avg_day_pnl",),
                   split={"by": "routine_done", "ref": rid},
                   range={"from": WEEK[0], "to": WEEK[-1]})
    p, sc, res = scan(conn, raw)
    assert p["v"] == 2
    assert {g.label: g.values.cells[0].value for g in res.groups} == {"Done": 100.0,
                                                                      "Not done": -50.0}
    assert "2 days have an off day for this routine and are not in this split." in res.footnotes
    assert {r["day"]: r["routine_done"] for r in sc.rows}["2026-10-20"] is None


def test_tracker_bucket_split_matches_vs_pnl_buckets(conn):
    t = trackers.create(UID, name="Sleep", kind="duration", now=at("2026-10-19"))
    values = dict(zip(WEEK, (300, 360, 420, 480, 540)))
    for d, v in values.items():
        trackers.set_value(UID, t["id"], d, v, now=at(d))
        add_trade(conn, UID, day=d, pnl=v / 10)
    raw = raw_plan(source="trading_days", measures=("avg_day_pnl",),
                   split={"by": "tracker_bucket", "ref": t["id"]},
                   range={"from": WEEK[0], "to": WEEK[-1]})
    _p, sc, res = scan(conn, raw)
    bs = tracker_days.buckets("duration", list(map(float, values.values())), None)
    assert {g.label for g in res.groups} == {b.label for b in bs}
    for r in sc.rows:
        assert r["tracker_bucket"] == tracker_days.bucket_of(bs, values[r["day"]])
        assert r["tracker_value"] == values[r["day"]]
    # a filter on the tracker's value reads the same column
    raw2 = raw_plan(source="trading_days", measures=("avg_day_pnl",),
                    filters=[{"field": "tracker_value", "op": "gte", "values": [420],
                              "ref": t["id"]}], range={"from": WEEK[0], "to": WEEK[-1]})
    _p, _sc, res2 = scan(conn, raw2)
    assert res2.count == 3 and res2.total.cells[0].value == pytest.approx(48.0)


def test_builtin_tracker_ref_reads_checkins(conn):
    note = add_note(conn, UID, updated_at="2026-10-20T10:00:00Z")
    add_checkin(conn, UID, note, day="2026-10-20", mood=5)
    add_trade(conn, UID, day="2026-10-20", pnl=10.0)
    raw = raw_plan(source="trading_days", measures=("avg_day_pnl",),
                   split={"by": "tracker_bucket", "ref": "checkin:mood"},
                   range={"from": WEEK[0], "to": WEEK[-1]})
    _p, sc, res = scan(conn, raw)
    assert [g.label for g in res.groups] == ["4-5"]


def test_foreign_ref_leaves_columns_empty(conn):
    add_user(conn, OTHER)
    rid_b, (item_b,) = make_routine(uid=OTHER)
    tick(rid_b, "2026-10-20", item_b, uid=OTHER)
    tb = trackers.create(OTHER, name="Theirs", kind="number", now=at("2026-10-19"))
    trackers.set_value(OTHER, tb["id"], "2026-10-20", 9, now=at("2026-10-20"))
    for d in WEEK:
        add_trade(conn, UID, day=d, pnl=10.0)
    raw = raw_plan(source="trading_days", measures=("avg_day_pnl",),
                   split={"by": "routine_done", "ref": rid_b},
                   filters=[{"field": "tracker_value", "op": "gte", "values": [0],
                             "ref": tb["id"]}],
                   range={"from": WEEK[0], "to": WEEK[-1]})
    _p, sc, res = scan(conn, raw)
    assert all(r["routine_done"] is None and r["tracker_value"] is None
               and r["tracker_bucket"] is None for r in sc.rows)
    assert res.groups == [] and res.count == 0
    # control: A's own routine on the same plan shape does fill the column
    rid_a, (item_a,) = make_routine()
    tick(rid_a, "2026-10-20", item_a)
    _p, sc2, _ = scan(conn, raw_plan(source="trading_days", measures=("avg_day_pnl",),
                                     split={"by": "routine_done", "ref": rid_a},
                                     range={"from": WEEK[0], "to": WEEK[-1]}))
    assert {r["day"]: r["routine_done"] for r in sc2.rows}["2026-10-20"] == "Done"


# ── payload, sample book, data stamp, drill ──────────────────────────────────────────────────

def test_empty_sentences_exact(conn):
    assert payload.S_EMPTY["routine_history"] == (
        "Start ticking your routine; history shows here from day one.")
    assert payload.S_EMPTY["tracker_history"] == "Log your first value; the chart starts with it."
    out = run.run_plan(UID, rplan(range={"token": "last_30d"}), {}, lane="run", now=NOW)
    assert out["count"] == 0 and out["empty"] == payload.S_EMPTY["routine_history"]
    out = run.run_plan(UID, tplan(range={"token": "last_30d"}), {}, lane="run", now=NOW)
    assert out["count"] == 0 and out["empty"] == payload.S_EMPTY["tracker_history"]
    assert out["summary"].endswith("0 entries.")


def test_tool_sources_never_sample(conn):
    rid, (item,) = make_routine()
    ticked = sessions("2026-10-05", "2026-10-23")[:10]
    for d in ticked:
        tick(rid, d, item)
    assert run.wants_sample(conn, UID) is True                # 0 trades: the book would answer
    out = run.run_plan(UID, rplan(range={"token": "last_30d"}), {}, lane="preview", now=NOW,
                       sample=True)
    assert out["sample"] is False and out["value"]["v1"] == 10.0
    assert run.NO_SAMPLE_SOURCES == plan.TOOL_SOURCES
    for key in plan.TOOL_SOURCES:
        with pytest.raises(ValueError):
            run.sample_rows(key)
    # a trading-days plan that names a routine is read from the member's rows too
    out = run.run_plan(UID, raw_plan(source="trading_days", measures=("avg_day_pnl",),
                                     split={"by": "routine_done", "ref": rid},
                                     range={"token": "last_30d"}),
                       {}, lane="preview", now=NOW, sample=True)
    assert out["sample"] is False


def test_stamp_busts_on_tick_and_value(conn):
    rid, (item,) = make_routine()
    t = trackers.create(UID, name="Sleep", kind="number", now=at("2026-10-19"))
    stamps = lambda: {k: run.data_stamp(conn, UID, k)            # noqa: E731
                      for k in ("routine_history", "tracker_history", "trading_days")}
    s0 = stamps()
    tick(rid, "2026-10-20", item)
    s1 = stamps()
    assert s1["routine_history"] != s0["routine_history"]
    assert s1["trading_days"] != s0["trading_days"]
    assert s1["tracker_history"] == s0["tracker_history"]
    routines.set_tick(UID, rid, "2026-10-20", item, False, now=at("2026-10-20"))   # same second
    s2 = stamps()
    assert s2["routine_history"] != s1["routine_history"]
    trackers.set_value(UID, t["id"], "2026-10-20", 7, now=at("2026-10-20"))
    s3 = stamps()
    assert s3["tracker_history"] != s2["tracker_history"]
    assert s3["trading_days"] != s2["trading_days"]
    assert s3["routine_history"] == s2["routine_history"]
    skip(rid, "2026-10-21")
    assert stamps()["routine_history"] != s3["routine_history"]


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
                            "state": "Done"}]
    out = drill.drill(UID, rplan(range=rng), {}, {}, now=NOW)
    assert out["rows"] == [{"day": "2026-10-22", "label": "Morning", "label2": None,
                            "state": "Not done"}]
    out = drill.drill(UID, tplan(split={"by": "tracker"}, range=rng), {}, {"label": "Sleep"},
                      now=NOW)
    assert out["rows"] == [{"day": "2026-10-22", "label": "Sleep", "value": 450.0,
                            "text": "7h 30m"}]


def test_every_tool_measure_has_a_format_and_a_source():
    for key in plan.TOOL_SOURCES:
        ms = sources.CATALOG.measures_for(key)
        assert ms and all(m in payload.MEASURE_FMT for m in ms), key
        assert key in payload._CAP_ROWS and key in payload._CAP_UNIT
