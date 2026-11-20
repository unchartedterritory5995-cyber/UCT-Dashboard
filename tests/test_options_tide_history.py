"""TIDEH: each finished session's Market Tide, stored once after the close, and its history.

`api/services/options_analytics/tide_history.py` + `GET /api/options/market-tide/history` + the
`market_tide_history_capture` job. The store is a temporary SQLite file (DATA_DIR points at
tmp_path); `market_tide.build` is a stand-in, so nothing here reads the tape or the network.
Every number is invented.

The route is mounted on a bare app (the router alone), so this file never imports `api.main`;
the job's registration is read from `api/main.py` as text, like `test_market_tide_rth_warm.py`.
"""
from __future__ import annotations

import ast
import datetime as dt
import logging
import os
import pathlib
import sqlite3
import sys
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.middleware.auth_middleware import get_current_user_with_plan  # noqa: E402
from api.routers import options_analytics as router_mod  # noqa: E402
from api.services import session_calendar  # noqa: E402
from api.services.options_analytics import market_tide as mt  # noqa: E402
from api.services.options_analytics import tide_history as th  # noqa: E402

ET = ZoneInfo("America/New_York")
FLAG = "OPTIONS_MARKET_TIDE_ENABLED"
FASTAPI_404 = b'{"detail":"Not Found"}'
PAID = {"id": "paid-test", "email": "paid@example.test", "role": "member", "plan": "pro"}
FREE = {"id": "free-test", "email": "free@example.test", "role": "member", "plan": "free"}
FRI, MON, TUE, WED, THU = "2026-11-13", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"
HALF = "2026-11-27"                    # the day after Thanksgiving: the calendar closes it at 13:00
URL = "/api/options/market-tide/history"


def at(day, hh, mm):
    y, m, d = (int(x) for x in day.split("-"))
    return dt.datetime(y, m, d, hh, mm, tzinfo=ET)


def tide(session=WED, *, call=4_200_000, put=1_500_000, prints=310, unsigned=40,
         through="16:14", minutes=3, **over):
    """A whole session as `market_tide.build` returns it (the fields the store reads)."""
    out = {
        "session": session,
        "minutes": [{"t": f"09:{31 + i:02d}"} for i in range(minutes)],
        "prints_counted": prints, "prints_unsigned": unsigned, "prints_unreadable": 0,
        "data_through": through,
        "totals": {"net_call_premium": call, "net_put_premium": put, "net_premium": call - put},
        "tape_behind": False, "partial": False, "partial_reasons": [],
        "tape_versions": {"stocks": "v-invented-1"},
    }
    out.update(over)
    return out


class Tape:
    """The stand-in for `market_tide.build`: one answer (or one failure) per scope."""

    def __init__(self):
        self.by_scope = {}
        self.asked = []

    def set(self, value, scopes=mt.SCOPES):
        for s in scopes:
            self.by_scope[s] = value

    def build(self, scope, now=None):
        self.asked.append(scope)
        v = self.by_scope[scope]
        if isinstance(v, Exception):
            raise v
        return dict(v)


@pytest.fixture
def tape(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    t = Tape()
    monkeypatch.setattr(mt, "build", t.build)
    return t


def rows(scope="all"):
    return th.history(scope, 250)["sessions"]


# ── the store ───────────────────────────────────────────────────────────────────

def test_the_store_is_its_own_wal_file_under_data_dir(tape, tmp_path):
    assert th._db_path() == os.path.join(str(tmp_path), "market_tide_history.db")
    conn = th._connect()
    try:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 2000
    finally:
        conn.close()
    assert os.path.exists(os.path.join(str(tmp_path), "market_tide_history.db"))


def test_a_finished_session_is_stored_for_every_scope(tape):
    tape.set(tide(WED, call=4_200_000, put=1_500_000, prints=310, unsigned=40, through="16:14"))
    tape.set(tide(WED, call=900_000, put=1_300_000, prints=120, unsigned=9, through="16:14"), ["etfs"])
    out = th.capture(at(WED, 16, 33))
    assert {s: (o["stored"], o["session"], o["replaced"]) for s, o in out.items()} == {
        s: (True, WED, False) for s in mt.SCOPES}
    assert out["all"]["reason"] == f"Stored {WED} through 16:14 ET, 310 prints."
    (row,) = rows("all")
    assert {k: row[k] for k in ("session", "net_call_premium", "net_put_premium", "net_premium",
                                "prints_counted", "prints_unsigned", "data_through", "source")} == {
        "session": WED, "net_call_premium": 4_200_000, "net_put_premium": 1_500_000,
        "net_premium": 2_700_000, "prints_counted": 310, "prints_unsigned": 40,
        "data_through": "16:14", "source": "capture"}
    assert dt.datetime.fromisoformat(row["stored_at"]).tzinfo is not None
    (etf,) = rows("etfs")
    assert etf["net_premium"] == -400_000 and etf["prints_counted"] == 120
    assert tape.asked == list(mt.SCOPES)


def test_a_prior_session_found_on_the_tape_is_stored_the_next_morning(tape):
    tape.set(tide(TUE))
    out = th.capture(at(WED, 8, 5))
    assert out["all"]["stored"] and rows()[0]["session"] == TUE


# ── each reason a read is refused ───────────────────────────────────────────────

def refused(tape, value, now):
    tape.set(value)
    out = th.capture(now)
    assert all(not o["stored"] and not o["replaced"] for o in out.values())
    assert rows() == [] and rows("stocks") == [] and rows("etfs") == []
    return out["all"]["reason"]


def test_todays_session_is_not_stored_before_1620(tape):
    why = refused(tape, tide(WED), at(WED, 16, 19))
    assert why == f"The {WED} session is not finished: today's session is stored after 4:20 PM ET."
    tape.set(tide(WED))
    assert th.capture(at(WED, 16, 20))["all"]["stored"] is True


def test_a_session_dated_after_today_is_not_stored(tape):
    assert refused(tape, tide(THU), at(WED, 20, 33)) == (
        f"The tape's session {THU} is dated after today, so it is not stored.")


def test_a_tape_running_behind_is_not_stored(tape):
    assert refused(tape, tide(WED, tape_behind=True), at(WED, 16, 33)) == (
        f"The tape is running behind for {WED}, so it is not stored.")


def test_a_partial_read_is_not_stored_and_says_why(tape):
    why = refused(tape, tide(WED, partial=True, partial_reasons=["The ETF tape could not be read."]),
                  at(WED, 16, 33))
    assert why == f"The read of {WED} is partial, so it is not stored: The ETF tape could not be read."


OK_SOURCES = {"stocks": "ok", "etfs": "ok"}
UNREADABLE = "3 prints had no readable time, premium or call/put and are not counted."


def few_unreadable(**over):
    """A whole read but for 3 unreadable prints in 310 (under one in a hundred)."""
    base = dict(prints=310, prints_unreadable=3, partial=True, partial_reasons=[UNREADABLE],
                sources=dict(OK_SOURCES), session_status="today")
    base.update(over)
    return tide(WED, **base)


def test_a_few_unreadable_prints_do_not_cost_the_day(tape):
    tape.set(few_unreadable())
    out = th.capture(at(WED, 16, 33))["all"]
    assert out == {"stored": True, "session": WED, "replaced": False,
                   "reason": f"Stored {WED} through 16:14 ET, 310 prints. 3 unreadable prints were left out."}
    (row,) = rows()
    assert (row["prints_counted"], row["prints_unreadable"]) == (310, 3)
    assert th.UNREADABLE_MAX_SHARE == 0.01


def test_a_whole_read_stores_no_unreadable_prints(tape):
    tape.set(tide(WED))
    th.capture(at(WED, 16, 33))
    assert rows()[0]["prints_unreadable"] == 0


@pytest.mark.parametrize("over, why", [
    (dict(prints_unreadable=4), "more than one print in a hundred"),
    (dict(sources={"stocks": "ok", "etfs": "failed"}), "a source failed"),
    (dict(sources=None), "the sources are not named"),
    (dict(sources={}), "no source is named"),
    (dict(session_status="no_prints_today"), "today's prints are not on the tape"),
    (dict(partial_reasons=[UNREADABLE, "A reason this module does not know."]), "a second reason"),
    (dict(prints_unreadable=0), "the count is not what made the read partial"),
])
def test_unreadable_prints_never_excuse_any_other_shortfall(tape, over, why):
    reason = refused(tape, few_unreadable(**over), at(WED, 16, 33))
    assert reason.startswith(f"The read of {WED} is partial, so it is not stored:"), why


def test_an_unreadable_count_that_is_not_a_number_is_not_stored(tape):
    assert refused(tape, tide(WED, prints_unreadable=None), at(WED, 16, 33)) == (
        f"The totals for {WED} could not be read, so it is not stored.")


def test_a_session_with_no_tided_minute_is_not_stored(tape):
    assert refused(tape, tide(WED, minutes=0), at(WED, 16, 33)) == (
        f"No print was tided for {WED}, so there is nothing to store.")


@pytest.mark.parametrize("through", ["15:54", "13:10", None, "9:31"])
def test_a_tape_that_stops_before_five_to_the_close_is_not_stored(tape, through):
    why = refused(tape, tide(WED, through=through), at(WED, 20, 33))
    assert why == (f"The tape for {WED} runs only to {through or 'no minute'} ET, short of 15:55 ET, "
                   "so the day is not stored as finished.")


def test_five_to_the_close_is_enough(tape):
    tape.set(tide(WED, through="15:55"))
    assert th.capture(at(WED, 16, 33))["all"]["stored"] is True


def test_a_half_day_is_measured_against_its_own_close(tape):
    assert session_calendar.close_time(dt.date.fromisoformat(HALF)).hour == 13
    assert th._floor(HALF) == "12:55" and th._floor(WED) == "15:55"
    why = refused(tape, tide(HALF, through="12:54"), at(HALF, 16, 33))
    assert "short of 12:55 ET" in why
    tape.set(tide(HALF, through="12:58"))
    assert th.capture(at(HALF, 16, 33))["all"]["stored"] is True


@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), "4200000", True])
def test_totals_that_are_not_numbers_are_not_stored(tape, bad):
    t = tide(WED)
    t["totals"] = dict(t["totals"], net_put_premium=bad)
    assert refused(tape, t, at(WED, 16, 33)) == (
        f"The totals for {WED} could not be read, so it is not stored.")


def test_no_session_on_the_tape_is_not_stored(tape):
    assert refused(tape, tide(None), at(WED, 16, 33)) == "The tape holds no session to store."


# ── the file is backed up, and nothing prunes it ───────────────────────────────

def test_the_store_is_in_the_nightly_snapshot_and_is_never_pruned(tape):
    from api.services import store_backup as sb
    from api.services import store_retention as sr
    spec = next(s for s in sb.STORES if s.name == "market_tide_history")
    assert spec.klass == sb.CLASS_RETAINED          # a past session cannot be re-read from the tape
    assert sb.resolve_path("market_tide_history") == th._db_path()
    row = next(r for r in sr.REGISTRY if r.name == "market_tide_history")
    assert (row.file, row.member_data, row.prunes, row.sweeps) == ("market_tide_history.db", sr.NOT_MEMBER, (), ())
    assert row.path == "api.services.options_analytics.tide_history:_db_path"
    source = pathlib.Path(th.__file__).read_text(encoding="utf-8").upper()
    assert "DELETE FROM" not in source and "DROP TABLE" not in source


# ── the replace rule ────────────────────────────────────────────────────────────

def test_a_later_fuller_read_replaces_the_row_and_keeps_the_first_stored_time(tape):
    tape.set(tide(WED, call=4_000_000, put=1_000_000, prints=300, through="16:00"))
    th.capture(at(WED, 16, 33))
    conn = sqlite3.connect(th._db_path())
    conn.execute("UPDATE tide_sessions SET first_stored_at = 'first', stored_at = 'first'")
    conn.commit()
    tape.set(tide(WED, call=4_400_000, put=1_100_000, prints=320, through="16:14"))
    out = th.capture(at(WED, 17, 33))
    assert out["all"] == {"stored": True, "session": WED, "replaced": True,
                          "reason": f"Stored {WED} through 16:14 ET, 320 prints."}
    (row,) = rows()
    assert (row["net_premium"], row["prints_counted"], row["data_through"]) == (3_300_000, 320, "16:14")
    assert row["stored_at"] != "first"
    assert conn.execute("SELECT DISTINCT first_stored_at FROM tide_sessions").fetchall() == [("first",)]
    conn.close()


def test_the_same_read_again_replaces_itself(tape):
    tape.set(tide(WED))
    th.capture(at(WED, 16, 33))
    assert th.capture(at(WED, 17, 33))["all"]["replaced"] is True
    assert len(rows()) == 1


@pytest.mark.parametrize("thinner, why", [
    (dict(prints=299, through="16:14"), "fewer prints"),
    (dict(prints=400, through="15:58"), "an earlier last minute"),
])
def test_a_thinner_read_never_replaces_a_fuller_one(tape, thinner, why):
    tape.set(tide(WED, call=4_000_000, put=1_000_000, prints=300, through="16:00"))
    th.capture(at(WED, 16, 33))
    tape.set(tide(WED, call=1, put=1, **thinner))
    out = th.capture(at(WED, 17, 33))["all"]
    assert out["stored"] is False and out["replaced"] is False, why
    assert out["reason"] == (f"A fuller read of {WED} is already stored (through 16:00 ET, 300 prints); "
                             f"this one (through {thinner['through']} ET, {thinner['prints']} prints) "
                             "was not kept.")
    (row,) = rows()
    assert (row["net_premium"], row["prints_counted"], row["data_through"]) == (3_000_000, 300, "16:00")


# ── a failure never leaves the job ──────────────────────────────────────────────

def test_one_scope_failing_is_logged_and_the_others_still_store(tape, caplog):
    tape.set(tide(WED))
    tape.set(RuntimeError("the flow tape could not be read"), ["stocks"])
    with caplog.at_level(logging.WARNING):
        out = th.capture(at(WED, 16, 33))
    assert out["stocks"] == {"stored": False, "session": None, "replaced": False,
                             "reason": "The stocks tide could not be stored: RuntimeError."}
    assert out["all"]["stored"] and out["etfs"]["stored"]
    assert rows("stocks") == [] and len(rows("all")) == 1 and len(rows("etfs")) == 1
    assert any("[tide-history] stocks not stored" in r.getMessage() for r in caplog.records)


def test_a_store_that_cannot_be_written_is_reported_not_raised(tape, monkeypatch):
    tape.set(tide(WED))
    monkeypatch.setattr(th, "_connect", lambda: (_ for _ in ()).throw(sqlite3.OperationalError("disk")))
    out = th.capture(at(WED, 16, 33))
    assert {o["reason"] for o in out.values()} == {
        f"The {s} tide could not be stored: OperationalError." for s in mt.SCOPES}


def test_a_refused_read_is_logged_with_its_reason(tape, caplog):
    tape.set(tide(WED, tape_behind=True))
    with caplog.at_level(logging.WARNING):
        th.capture(at(WED, 16, 33))
    assert any("etfs: The tape is running behind" in r.getMessage() for r in caplog.records)


# ── the job ─────────────────────────────────────────────────────────────────────

def test_switched_off_the_job_reads_nothing(tape, monkeypatch, tmp_path):
    tape.set(tide(WED))
    for off in (None, "0", "off", ""):
        monkeypatch.delenv(FLAG, raising=False) if off is None else monkeypatch.setenv(FLAG, off)
        assert th.run_capture_job(at(WED, 16, 33)) == {"ran": False, "reason": "Market Tide is switched off."}
    assert tape.asked == [] and not os.path.exists(th._db_path())


def test_switched_on_the_job_stores_the_session(tape, monkeypatch):
    tape.set(tide(WED))
    monkeypatch.setenv(FLAG, "1")
    out = th.run_capture_job(at(WED, 16, 33))
    assert out["ran"] is True and all(o["stored"] for o in out["scopes"].values())
    assert rows()[0]["session"] == WED


@pytest.mark.parametrize("hh, mm, runs", [(9, 19, True), (9, 20, False), (12, 0, False),
                                          (16, 14, False), (16, 15, True)])
def test_the_job_never_reads_the_tape_inside_the_trading_day(tape, monkeypatch, hh, mm, runs):
    tape.set(tide(TUE))
    monkeypatch.setenv(FLAG, "1")
    out = th.run_capture_job(at(WED, hh, mm))
    assert out["ran"] is runs
    assert bool(tape.asked) is runs
    if not runs:
        assert out["reason"] == "The session is still trading; a session is stored after its close."


def test_the_job_never_raises(tape, monkeypatch):
    from api.services.options_analytics import flags
    monkeypatch.setattr(flags, "is_on", lambda name: (_ for _ in ()).throw(KeyError(name)))
    assert th.run_capture_job(at(WED, 16, 33)) == {"ran": False, "reason": "The capture failed: KeyError."}


def _capture_job_call():
    tree = ast.parse(pathlib.Path("api/main.py").read_text(encoding="utf-8"))
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)]
    ids = [kw.value.value for n in calls for kw in n.keywords
           if kw.arg == "id" and isinstance(kw.value, ast.Constant)]
    mine = [n for n in calls for kw in n.keywords
            if kw.arg == "id" and isinstance(kw.value, ast.Constant)
            and kw.value.value == "market_tide_history_capture"]
    return ids, mine


def test_the_job_is_registered_once_for_three_tries_after_the_close():
    ids, mine = _capture_job_call()
    assert "market_tide_rth_warm" in ids                 # control: the walk sees the neighbour
    assert len(mine) == 1
    (call,) = mine
    assert ast.unparse(call.args[0]) == "_tide_history.run_capture_job"
    kw = {k.arg: k.value for k in call.keywords}
    assert ast.literal_eval(kw["max_instances"]) == 1
    trig = {k.arg: (ast.literal_eval(k.value) if isinstance(k.value, ast.Constant) else ast.unparse(k.value))
            for k in kw["trigger"].keywords}
    assert trig == {"day_of_week": "mon-fri", "hour": "16,17,20", "minute": 33, "timezone": "_ET"}
    for hour in (int(h) for h in trig["hour"].split(",")):
        assert not (th.QUIET_FROM <= (hour, trig["minute"]) < th.QUIET_TO)
        assert (hour, trig["minute"]) >= th.FINISHED_AFTER


# ── the history ─────────────────────────────────────────────────────────────────

def seed(tape, days, scopes=mt.SCOPES, **kw):
    for i, day in enumerate(days):
        tape.set(tide(day, call=1_000_000 * (i + 2), put=500_000 * (i + 1), **kw), scopes)
        th.capture(at(day, 16, 33))


def test_no_store_yet_is_an_empty_history_and_creates_nothing(tape):
    out = th.history("all", 60)
    assert out["sessions"] == [] and out["sessions_stored"] == 0
    assert out["history_began"] is None and out["latest_session"] is None
    assert out["missing_sessions"] == [] and out["missing_checked_through"] is None
    assert not os.path.exists(th._db_path())


def test_history_is_newest_first_with_where_it_began(tape):
    seed(tape, [FRI, MON, TUE, WED])
    out = th.history("all", 60)
    assert [r["session"] for r in out["sessions"]] == [WED, TUE, MON, FRI]
    assert out["history_began"] == FRI and out["latest_session"] == WED
    assert out["sessions_stored"] == 4 and out["missing_sessions"] == []
    assert out["missing_checked_through"] == WED
    assert out["scope"] == "all" and out["label"] == "computed" and out["backfill"] is False
    assert out["filters"] == mt.TAPE_FILTERS and out["method"] == mt.METHOD
    assert out["stored_note"] == th.STORED_NOTE and "cannot be recovered" in out["stored_note"]
    assert "tape_versions" not in out["sessions"][0]


def test_sessions_is_clamped_and_the_count_stays_whole(tape):
    seed(tape, [FRI, MON, TUE, WED])
    two = th.history("all", 2)
    assert [r["session"] for r in two["sessions"]] == [WED, TUE]
    assert two["sessions_stored"] == 4 and two["history_began"] == FRI and two["sessions_asked"] == 2
    assert th.history("all", 0)["sessions_asked"] == 1 and len(th.history("all", -5)["sessions"]) == 1
    assert th.history("all", 9999)["sessions_asked"] == 250 == th.MAX_SESSIONS
    assert th.history("all", "x")["sessions_asked"] == 60 == th.DEFAULT_SESSIONS


def test_scopes_keep_their_own_histories(tape):
    seed(tape, [MON, TUE])
    seed(tape, [WED], scopes=["etfs"])
    assert [r["session"] for r in rows("etfs")] == [WED, TUE, MON]
    assert [r["session"] for r in rows("stocks")] == [TUE, MON]
    with pytest.raises(ValueError):
        th.history("crypto")


def test_trading_sessions_with_no_row_are_named_and_closed_days_are_not(tape):
    seed(tape, [FRI, TUE, "2026-11-30"])
    out = th.history("all", 60)
    # Mon 16 and Wed 18 to Wed 25 and the Fri 27 half-day are missing. The weekends and
    # Thanksgiving (Thu 26) were never sessions, so they are not named.
    assert out["missing_sessions"] == [MON, WED, THU, "2026-11-20", "2026-11-23", "2026-11-24",
                                       "2026-11-25", "2026-11-27"]
    assert out["missing_checked_through"] == "2026-11-30"
    assert len(out["sessions"]) == 3 and all(r["net_premium"] != 0 for r in out["sessions"])
    assert th.history("all", 1)["missing_sessions"] == out["missing_sessions"]


def test_past_the_calendars_end_no_day_is_named_missing(tape, monkeypatch):
    seed(tape, [FRI, WED])
    monkeypatch.setattr(session_calendar, "covers", lambda d: d <= dt.date.fromisoformat(MON))
    out = th.history("all", 60)
    assert out["missing_sessions"] == [MON] and out["missing_checked_through"] == MON


# ── the route ───────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router_mod.router)
    who = {"user": PAID}
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who["user"])
    c_ = TestClient(app, raise_server_exceptions=False)
    c_.who = who
    return c_


def test_switched_off_the_route_is_a_plain_404_before_identity(client, monkeypatch, tape):
    seed(tape, [WED])
    monkeypatch.delenv(FLAG, raising=False)
    client.app.dependency_overrides[get_current_user_with_plan] = lambda: (_ for _ in ()).throw(
        AssertionError("identity read"))
    r = client.get(URL)
    assert r.status_code == 404 and r.content == FASTAPI_404


def test_switched_on_it_is_paid_only(client, monkeypatch, tape):
    seed(tape, [TUE, WED])
    monkeypatch.setenv(FLAG, "1")
    client.who["user"] = FREE
    r = client.get(URL)
    assert r.status_code == 402 and r.json()["detail"] == "Options analytics require a paid plan"
    client.who["user"] = PAID
    r = client.get(URL + "?scope=etfs")
    assert r.status_code == 200
    body = r.json()
    assert body["scope"] == "etfs" and [s["session"] for s in body["sessions"]] == [WED, TUE]
    assert client.get(URL + "?scope=crypto").status_code == 422
    assert client.get(URL + "?sessions=many").status_code == 422


def test_the_route_clamps_sessions(client, monkeypatch, tape):
    seed(tape, [MON, TUE, WED])
    monkeypatch.setenv(FLAG, "1")
    assert client.get(URL).json()["sessions_asked"] == 60
    assert client.get(URL + "?sessions=9999").json()["sessions_asked"] == 250
    low = client.get(URL + "?sessions=0").json()
    assert low["sessions_asked"] == 1 and [s["session"] for s in low["sessions"]] == [WED]
    assert low["sessions_stored"] == 3


def test_the_route_reads_the_store_only(client, monkeypatch, tape):
    seed(tape, [WED])
    monkeypatch.setenv(FLAG, "1")

    def never(*a, **k):
        raise AssertionError("the history route built a tide or read the tape")

    for name in ("build", "get", "_read", "extras"):
        monkeypatch.setattr(mt, name, never)
    r = client.get(URL)
    assert r.status_code == 200 and r.json()["sessions"][0]["session"] == WED
