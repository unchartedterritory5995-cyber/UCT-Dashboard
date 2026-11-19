"""ERNS, the Terminal's earnings season screen (`api/services/earnings_season.py` and
`GET /api/calendar/earnings-season`).

What is held here:
  * the answer is assembled ONLY from what the server already holds: no provider call for a past
    or a coming day, at most ONE batch snapshot for today, and never a read per reporter;
  * a missing number is never 0: a priced move from a chain this screen does not show is withheld
    and counted, a stock with no model held has no past moves, a move that is not held is "not held";
  * a report within 20 days of the day shown is that day's own, never a past report, and a report
    whose next session has not closed is not a reaction yet;
  * beat / miss / mixed is the engine's own rule;
  * nothing is built on the request: one background build per day, a short wait, then `computing`;
    the last good answer is served, marked `refreshing`, while its replacement is built;
  * the route sits behind the Calendar's paid gate.
"""
from __future__ import annotations

import threading
import time
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import calendar as calendar_route
from api.services import earnings_season as es
from api.services import implied_store

TODAY = date(2026, 11, 17)          # a Tuesday
DS = "2026-11-17"
TOMORROW = "2026-11-18"
YESTERDAY = "2026-11-16"


def entry(sym, **over):
    return {"sym": sym, "name": f"{sym} Corp", "eps_est": 1.0, "eps_act": None, "rev_est": 100.0, "rev_act": None,
            "mc_b": 10.0, "ew": 0, **over}


def week(days: dict, source="live", as_of="2026-11-17T14:00:00+00:00"):
    full = {}
    for ds in ("2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"):
        full[ds] = {"bmo": [], "amc": [], "tbd": [], **(days.get(ds) or {})}
    return {"week_start": "2026-11-16", "week_end": "2026-11-20", "days": full, "source": source, "as_of": as_of}


def capture(sym, pct=6.2, dollar=12.4, source="massive-chain", **over):
    return {"sym": sym, "report_date": DS, "captured_at": "2026-11-16T16:35:04-05:00", "pct": pct, "dollar": dollar,
            "expiry": "2026-11-20", "spot": 200.0, "source": source, **over}


def intel(*events):
    """A held earnings model: `events` are (report_date, reaction_pct), newest LAST, as the service sends them."""
    return {"quarters": [{"label": "Q"}],
            "reaction": {"events": [{"quarter": d, "report_date": d, "reaction_pct": p} for d, p in events],
                         "avg_abs_move_pct": 1.0, "n_quarters": len(events)}}


FOUR = intel(("2025-11-18", -1.25), ("2026-02-17", 8.4), ("2026-05-19", -2.0), ("2026-08-18", 3.1))


class World:
    """Everything the service reads, stood in for; every read is counted."""

    def __init__(self, monkeypatch):
        self.weeks = {date(2026, 11, 16): week({})}
        self.priced = {}
        self.intel = {}
        self.held_moves = {}
        self.live = {}
        self.calls = {"week": [], "priced": [], "intel": [], "held_moves": [], "live": []}
        self.threads = {"week": set()}
        self.week_delay = 0.0
        self.fail = set()
        monkeypatch.setattr(es, "today_et", lambda: TODAY)
        monkeypatch.setattr(calendar_route, "_today_et", lambda: TODAY)
        monkeypatch.setattr(es, "read_week", self.read_week)
        monkeypatch.setattr(es, "read_priced", self.read_priced)
        monkeypatch.setattr(es, "read_held_intel", self.read_held_intel)
        monkeypatch.setattr(es, "read_held_moves", self.read_held_moves)
        monkeypatch.setattr(es, "read_live_moves", self.read_live_moves)

    def read_week(self, monday):
        self.calls["week"].append(monday)
        self.threads["week"].add(threading.get_ident())
        if self.week_delay:
            time.sleep(self.week_delay)
        if "week" in self.fail:
            raise RuntimeError("calendar down")
        return self.weeks.get(monday)

    def read_priced(self, ds):
        self.calls["priced"].append(ds)
        if "priced" in self.fail:
            raise RuntimeError("store down")
        return {implied_store.canonical_symbol(k): v for k, v in (self.priced.get(ds) or {}).items()}

    def read_held_intel(self, sym):
        self.calls["intel"].append(sym)
        if sym in self.fail:
            raise RuntimeError("snapshot unreadable")
        return self.intel.get(sym)

    def read_held_moves(self, ds):
        self.calls["held_moves"].append(ds)
        return self.held_moves.get(ds)

    def read_live_moves(self, ds, syms):
        self.calls["live"].append((ds, list(syms)))
        if "live" in self.fail:
            raise RuntimeError("snapshot down")
        return dict(self.live)


@pytest.fixture(autouse=True)
def _clean():
    for store in (es._done, es._old, es._inflight, es._events_memo):
        store.clear()
    yield
    for store in (es._done, es._old, es._inflight, es._events_memo):
        store.clear()


@pytest.fixture
def world(monkeypatch):
    return World(monkeypatch)


def rows_of(out, session):
    return {r["sym"]: r for r in out["sessions"][session]}


class Clock:
    """Stands in for the service's `time` module, so a test can move its clock without moving the real one."""

    def __init__(self):
        self.now = time.time()

    def time(self):
        return self.now


def wait_until(check, seconds=5.0):
    deadline = time.time() + seconds
    while not check():
        assert time.time() < deadline, "timed out"
        time.sleep(0.02)


# ── who reports, and in what order ───────────────────────────────────────────────────────────

def test_reporters_are_grouped_by_session_biggest_company_first_and_listed_once(world):
    world.weeks[date(2026, 11, 16)] = week({DS: {
        "bmo": [entry("SML", mc_b=2.0), entry("BIG", mc_b=900.0), entry("NOCAP", mc_b=None), entry("MID", mc_b=50.0)],
        "amc": [entry("TIEB", mc_b=5.0, ew=3), entry("TIEA", mc_b=5.0, ew=9), entry("BIG", mc_b=900.0)],
        "tbd": [entry("LATE", mc_b=1.0), "not an entry", {"sym": ""}],
    }})
    out = es.build_day(DS)
    assert out["status"] == "ok" and out["date"] == DS and out["day_kind"] == "today" and out["default"] is False
    assert [r["sym"] for r in out["sessions"]["bmo"]] == ["BIG", "MID", "SML", "NOCAP"]     # no market cap goes last
    assert [r["sym"] for r in out["sessions"]["amc"]] == ["TIEA", "TIEB"]                 # BIG is listed once, under bmo
    assert [r["sym"] for r in out["sessions"]["tbd"]] == ["LATE"]
    assert out["counts"]["scheduled"] == 7
    assert out["calendar_as_of"] == "2026-11-17T14:00:00+00:00"
    assert out["capture"] == {"hour_et": implied_store.CAPTURE_HOUR_ET, "minute_et": implied_store.CAPTURE_MINUTE_ET}
    assert "ew" not in out["sessions"]["amc"][0]


# ── the priced move ──────────────────────────────────────────────────────────────────────────

def test_a_priced_move_is_the_stored_capture_and_an_unlicensed_or_empty_one_is_withheld_never_zero(world):
    world.weeks[date(2026, 11, 16)] = week({DS: {"amc": [entry("AAA"), entry("BBB"), entry("CCC"), entry("DDD"), entry("BRK.B")]}})
    world.priced[DS] = {
        "AAA": capture("AAA", pct=6.234, dollar=12.449),
        "BBB": capture("BBB", source="yfinance"),             # a chain this screen does not show
        "CCC": capture("CCC", pct=0.0),                       # no usable percent
        "BRK.B": capture("BRK-B", pct=2.0, dollar=None, source="massive-backfill"),
    }
    out = es.build_day(DS)
    r = rows_of(out, "amc")
    assert r["AAA"]["priced"] == {"pct": 6.23, "dollar": 12.45, "captured_at": "2026-11-16T16:35:04-05:00", "expiry": "2026-11-20"}
    assert r["BBB"]["priced"] is None and r["CCC"]["priced"] is None and r["DDD"]["priced"] is None
    assert r["BRK.B"]["priced"]["pct"] == 2.0 and r["BRK.B"]["priced"]["dollar"] is None      # the store keys BRK-B
    assert out["counts"]["priced"] == 2 and out["counts"]["priced_withheld"] == 2
    assert out["priced_state"] == "read"
    assert world.calls["priced"] == [DS]                      # ONE read for the whole day


def test_a_store_that_cannot_be_read_is_said_and_no_row_is_priced(world):
    world.weeks[date(2026, 11, 16)] = week({DS: {"amc": [entry("AAA")]}})
    world.fail.add("priced")
    out = es.build_day(DS)
    assert out["status"] == "ok" and out["priced_state"] == "failed"
    assert rows_of(out, "amc")["AAA"]["priced"] is None and out["counts"]["priced"] == 0


def test_the_licensed_sources_are_the_two_the_store_writes():
    from api.services import implied_backfill, implied_move
    assert implied_backfill.SOURCE in es.LICENSED_PRICED_SOURCES
    assert "massive-chain" in es.LICENSED_PRICED_SOURCES and len(es.LICENSED_PRICED_SOURCES) == 2
    assert '"source": "massive-chain"' in open(implied_move.__file__, encoding="utf-8").read()


def test_the_store_read_returns_every_field_for_one_day_only(tmp_path, monkeypatch):
    monkeypatch.setattr(implied_store, "DB_PATH", str(tmp_path / "implied.db"))
    payload = {"pct": 6.2, "dollar": 12.4, "expiry": "2026-11-20", "strike": 200.0, "spot": 199.5, "iv_atm": 0.8,
               "source": "massive-chain"}
    implied_store.record_implied("brk.b", DS, payload, "2026-11-16T16:35:04-05:00", fiscal_year=2026, fiscal_quarter=3)
    implied_store.record_implied("AAA", TOMORROW, payload, "2026-11-17T16:35:04-05:00", fiscal_year=2026, fiscal_quarter=3)
    rows = implied_store.get_implied_rows_for_date(DS)
    assert rows == [{"sym": "BRK-B", "report_date": DS, "captured_at": "2026-11-16T16:35:04-05:00", "pct": 6.2,
                     "dollar": 12.4, "expiry": "2026-11-20", "spot": 199.5, "source": "massive-chain"}]
    assert implied_store.get_implied_rows_for_date("") == []
    assert {r["sym"]: r["pct"] for r in rows} == implied_store.get_implied_for_date(DS)      # the same rows as the Calendar reads
    assert implied_store.canonical_symbol(" brk.b ") == "BRK-B"


# ── past reports ─────────────────────────────────────────────────────────────────────────────

def test_past_reports_are_the_held_measured_moves_newest_first_with_the_average_of_those_listed(world):
    world.weeks[date(2026, 11, 16)] = week({DS: {"amc": [entry("AAA"), entry("NONE"), entry("THIN"), entry("BAD")]}})
    world.intel = {"AAA": FOUR, "THIN": {"quarters": [{}], "reaction": None}}
    world.fail.add("BAD")
    out = es.build_day(DS)
    r = rows_of(out, "amc")
    assert r["AAA"]["past"] == {
        "moves": [{"date": "2026-08-18", "pct": 3.1}, {"date": "2026-05-19", "pct": -2.0},
                  {"date": "2026-02-17", "pct": 8.4}, {"date": "2025-11-18", "pct": -1.25}],
        "avg_abs": 3.69, "n": 4}
    assert r["AAA"]["past_state"] == "ok"
    assert (r["NONE"]["past"], r["NONE"]["past_state"]) == (None, "not_held")        # no model held: never a build
    assert (r["THIN"]["past"], r["THIN"]["past_state"]) == (None, "not_measured")    # held, too few measured
    assert (r["BAD"]["past"], r["BAD"]["past_state"]) == (None, "not_held")          # one bad stock is not a failed day
    assert out["counts"]["with_past"] == 1 and out["counts"]["past_not_held"] == 2
    assert sorted(world.calls["intel"]) == ["AAA", "BAD", "NONE", "THIN"]


def test_the_days_own_report_and_a_report_too_recent_to_measure_are_not_past_reports():
    events, state = es.measured_events(intel(("2026-08-18", 3.1), ("2026-11-03", 9.9), ("2026-11-17", 5.0), ("2026-05-19", None)))
    assert state == "ok" and [m["date"] for m in events] == ["2026-11-17", "2026-11-03", "2026-08-18"]
    past, why = es.past_reports(events, state, DS, DS)
    assert why == "ok" and past == {"moves": [{"date": "2026-08-18", "pct": 3.1}], "avg_abs": 3.1, "n": 1}
    # a past day: the report on that very day is the result, not history
    past, _ = es.past_reports(events, state, "2026-11-03", DS)
    assert [m["date"] for m in past["moves"]] == ["2026-08-18"]
    # the gap is a constant, and exactly at it a report counts
    assert es.PAST_REPORT_MIN_GAP_DAYS == 20
    edge, _ = es.measured_events(intel(("2026-10-28", 1.0)))
    assert es.past_reports(edge, "ok", DS, DS)[0]["n"] == 1
    assert es.past_reports(es.measured_events(intel(("2026-10-29", 1.0)))[0], "ok", DS, DS) == (None, "not_measured")
    # settled: the session AFTER the report day has closed
    assert es.settled("2026-11-13", "2026-11-17") is True      # Friday; Monday closed before Tuesday
    assert es.settled("2026-11-13", "2026-11-16") is False     # Monday is the next session and is not over
    assert es.settled("bad", "2026-11-17") is False
    assert es.past_reports(None, "not_held", DS, DS) == (None, "not_held")


def test_at_most_eight_past_reports_are_listed():
    many = intel(*[(f"20{y:02d}-0{m}-15", 1.0 + m) for y in (23, 24, 25) for m in (2, 5, 8)])
    events, state = es.measured_events(many)
    past, _ = es.past_reports(events, state, DS, DS)
    assert past["n"] == es.PAST_MOVES_SHOWN == 8 and past["moves"][0]["date"] == "2025-08-15"


def test_a_stocks_past_reports_are_read_once_and_remembered_between_builds(world):
    world.weeks[date(2026, 11, 16)] = week({DS: {"amc": [entry("AAA")]}})
    world.intel = {"AAA": FOUR}
    es.build_day(DS)
    es.build_day(DS)
    assert world.calls["intel"] == ["AAA"]


# ── the result ───────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("over, verdict", [
    ({"eps_act": 1.2, "rev_act": 110.0}, "beat"),
    ({"eps_act": 0.8, "rev_act": 90.0}, "miss"),
    ({"eps_act": 1.2, "rev_act": 90.0}, "mixed"),
    ({"eps_act": 1.0, "rev_act": None}, "beat"),               # the engine's rule: at or above the estimate
    ({"eps_act": 0.9, "rev_est": None, "rev_act": 90.0}, "miss"),
    ({"eps_act": 1.2, "eps_est": None}, None),                 # no estimate to set it against
    ({"eps_act": None}, None),                                 # not reported
])
def test_the_verdict_is_the_engines_own_rule(over, verdict):
    e = entry("AAA", **over)
    assert es.verdict_of(e) == verdict
    if verdict:
        from api.services.engine import _build_earnings_entry
        word = _build_earnings_entry({"symbol": "AAA", "eps_actual": e["eps_act"], "eps_estimate": e["eps_est"],
                                      "rev_actual": e["rev_act"], "rev_estimate": e["rev_est"]})["verdict"]
        assert word.lower() == verdict


# ── the move, and the cost rule ──────────────────────────────────────────────────────────────

def test_today_one_batch_read_for_the_reports_before_the_open_and_none_for_a_report_after_the_close(world):
    world.weeks[date(2026, 11, 16)] = week({DS: {
        "bmo": [entry("OPEN1", eps_act=1.2), entry("OPEN2", eps_act=0.8), entry("WAIT")],
        "amc": [entry("CLOSE1", eps_act=1.2)],
        "tbd": [entry("TBD1", eps_act=1.1)],
    }})
    world.live = {"open1": 8.123, "TBD1": -1.5, "CLOSE1": 99.0}
    out = es.build_day(DS)
    assert world.calls["live"] == [(DS, ["OPEN1", "OPEN2", "TBD1"])]           # ONE call; the after-close name is not in it
    assert world.calls["held_moves"] == []
    bmo, amc, tbd = rows_of(out, "bmo"), rows_of(out, "amc"), rows_of(out, "tbd")
    assert (bmo["OPEN1"]["move"], bmo["OPEN1"]["move_state"]) == (8.12, "live")
    assert (bmo["OPEN2"]["move"], bmo["OPEN2"]["move_state"]) == (None, "none")   # nothing came back: never 0
    assert (bmo["WAIT"]["move"], bmo["WAIT"]["move_state"]) == (None, None)       # not reported
    assert (amc["CLOSE1"]["move"], amc["CLOSE1"]["move_state"]) == (None, "next_close")
    assert (tbd["TBD1"]["move"], tbd["TBD1"]["move_state"]) == (-1.5, "live")
    assert out["moves_state"] == "live" and out["counts"] == {**out["counts"], "reported": 4, "moved": 2}


def test_today_with_no_result_before_the_open_reads_no_price_at_all(world):
    world.weeks[date(2026, 11, 16)] = week({DS: {"bmo": [entry("WAIT")], "amc": [entry("CLOSE1", eps_act=1.2)]}})
    out = es.build_day(DS)
    assert world.calls["live"] == [] and out["moves_state"] is None
    assert rows_of(out, "amc")["CLOSE1"]["move_state"] == "next_close"


def test_a_failed_price_read_today_is_said_as_failed_never_as_no_move(world):
    world.weeks[date(2026, 11, 16)] = week({DS: {"bmo": [entry("OPEN1", eps_act=1.2)]}})
    world.fail.add("live")
    out = es.build_day(DS)
    assert out["status"] == "ok" and out["moves_state"] == "failed"
    assert rows_of(out, "bmo")["OPEN1"]["move_state"] == "failed"
    assert rows_of(out, "bmo")["OPEN1"]["move"] is None


def test_a_past_day_uses_only_the_moves_the_server_already_holds(world):
    world.weeks[date(2026, 11, 16)] = week({YESTERDAY: {"bmo": [entry("AAA", eps_act=1.2), entry("BBB", eps_act=0.7)]}})
    out = es.build_day(YESTERDAY)
    assert out["day_kind"] == "past" and out["moves_state"] == "not_held"
    assert rows_of(out, "bmo")["AAA"]["move"] is None and rows_of(out, "bmo")["AAA"]["move_state"] == "not_held"
    world.held_moves[YESTERDAY] = {"AAA": 4.5}
    out = es.build_day(YESTERDAY)
    assert out["moves_state"] == "held"
    assert (rows_of(out, "bmo")["AAA"]["move"], rows_of(out, "bmo")["AAA"]["move_state"]) == (4.5, "settled")
    assert rows_of(out, "bmo")["BBB"]["move_state"] == "none"
    assert world.calls["live"] == []


def test_a_coming_day_reads_no_price(world):
    world.weeks[date(2026, 11, 16)] = week({TOMORROW: {"bmo": [entry("AAA")], "amc": [entry("BBB")]}})
    out = es.build_day(TOMORROW)
    assert out["day_kind"] == "future" and out["moves_state"] is None
    assert world.calls["live"] == [] and world.calls["held_moves"] == []


def test_no_provider_is_called_for_a_past_or_a_coming_day_and_only_the_batch_for_today(monkeypatch):
    """The REAL readers, with the provider client and the builders replaced by tripwires."""
    monkeypatch.setattr(es, "today_et", lambda: TODAY)
    monkeypatch.setattr(calendar_route, "_today_et", lambda: TODAY)
    monkeypatch.setattr(es, "read_week", lambda monday: week({
        YESTERDAY: {"bmo": [entry("AAA", eps_act=1.2)]},
        DS: {"bmo": [entry("BBB", eps_act=1.2)], "amc": [entry("CCC", eps_act=1.2)]},
        TOMORROW: {"amc": [entry("DDD")]},
    }))
    monkeypatch.setattr(es, "read_priced", lambda ds: {})
    from api.services import earnings_intel, massive
    built = []
    monkeypatch.setattr(earnings_intel, "_build", lambda sym: built.append(sym) or {})
    monkeypatch.setattr(earnings_intel, "_schedule_refresh", lambda sym: built.append(sym))
    monkeypatch.setattr(earnings_intel.snap_store, "get", lambda kind, sym, now=None: None)
    monkeypatch.setattr(calendar_route, "_past_reactions", lambda *a, **k: built.append("past reactions") or {})
    batches = []

    class Client:
        def get_batch_snapshots(self, tickers, **kw):
            batches.append(list(tickers))
            return {"BBB": 3.0}

        def __getattr__(self, name):
            raise AssertionError(f"provider client method {name} was called")

    monkeypatch.setattr(massive, "_get_client", lambda: Client())
    for key in (f"calendar_reactions_{d}" for d in (YESTERDAY, DS, TOMORROW)):
        calendar_route.cache.delete(key) if hasattr(calendar_route.cache, "delete") else None
    assert es.build_day(YESTERDAY)["moves_state"] == "not_held"
    assert es.build_day(TOMORROW)["status"] == "ok"
    assert batches == [] and built == []
    out = es.build_day(DS)
    assert batches == [["BBB"]] and built == []
    assert rows_of(out, "bmo")["BBB"]["move"] == 3.0


# ── which day ────────────────────────────────────────────────────────────────────────────────

def test_the_bare_command_is_the_first_day_from_today_that_has_a_reporter(world):
    world.weeks[date(2026, 11, 16)] = week({YESTERDAY: {"bmo": [entry("OLD")]}, "2026-11-19": {"amc": [entry("AAA")]}})
    out = es.build_day(None)
    assert out["status"] == "ok" and out["date"] == "2026-11-19" and out["default"] is True
    world.weeks[date(2026, 11, 16)] = week({DS: {"tbd": [entry("NOW")]}, "2026-11-19": {"amc": [entry("AAA")]}})
    assert es.build_day(None)["date"] == DS
    # nobody this week: it looks into next week (the Calendar's own week reader), skipping the weekend
    world.weeks[date(2026, 11, 16)] = week({})
    nxt = week({})
    nxt["days"] = {"2026-11-23": {"bmo": [entry("MON")], "amc": [], "tbd": []}}
    world.weeks[date(2026, 11, 23)] = nxt
    assert es.build_day(None)["date"] == "2026-11-23"
    # nobody within reach: today, said as it is
    world.weeks[date(2026, 11, 23)] = week({})
    world.weeks[date(2026, 11, 23)]["days"] = {"2026-11-23": {"bmo": [], "amc": [], "tbd": []}}
    out = es.build_day(None)
    assert out["date"] == DS and out["status"] == "ok" and out["counts"]["scheduled"] == 0


@pytest.mark.parametrize("bad", [None, {"days": {}, "source": "live"}, {"days": {DS: {}}, "source": "error"},
                                 {"days": {DS: {}}, "source": "empty"}, {"days": {DS: {}}, "source": "range_error+finviz"}])
def test_a_calendar_that_cannot_be_read_is_unavailable_never_nobody_reporting(world, bad):
    world.weeks[date(2026, 11, 16)] = bad
    for asked in (DS, None):
        out = es.build_day(asked)
        assert out["status"] == "unavailable" and out["reason"] == "calendar"
        assert "sessions" not in out
    world.fail.add("week")
    assert es.build_day(DS)["status"] == "unavailable"


def test_a_day_the_week_does_not_carry_is_no_day_and_a_real_empty_week_is_not_a_failure(world):
    world.weeks[date(2026, 11, 16)] = week({}, source="range_empty")
    out = es.build_day("2026-11-21")                     # a Saturday
    assert out["status"] == "no_day" and out["weekend"] is True
    assert world.calls["week"] == []                     # no calendar week is read to say a weekend is closed
    out = es.build_day(DS)
    assert out["status"] == "ok" and out["counts"]["scheduled"] == 0
    del world.weeks[date(2026, 11, 16)]["days"]["2026-11-19"]
    out = es.build_day("2026-11-19")                     # a weekday the week does not carry
    assert out["status"] == "no_day" and out["weekend"] is False and out["date"] == "2026-11-19"


def test_the_reach_is_the_calendars_week_and_one_week_either_side(world):
    first, last = es.week_window(TODAY)
    assert (first, last) == (date(2026, 11, 9), date(2026, 11, 27))
    # on a Saturday the Calendar's week is the one about to start, so the week just ended stays in reach
    assert es.week_window(date(2026, 11, 21)) == (date(2026, 11, 16), date(2026, 12, 4))
    assert es.get_day("2026-11-06") == {"status": "out_of_range", "date": "2026-11-06", "today": DS,
                                        "range": {"from": "2026-11-09", "to": "2026-11-27"}}
    assert es.get_day("2026-11-30")["status"] == "out_of_range"
    for bad in ("2026-02-30", "11/17", "", "2026-11-17T00:00"):
        assert es.get_day(bad) == {"status": "bad_date", "date": None}
    assert world.calls["week"] == []                     # refused before anything is read


# ── one build per day, off the request ───────────────────────────────────────────────────────

def test_the_build_never_runs_on_the_callers_thread_and_the_answer_is_then_held(world):
    world.weeks[date(2026, 11, 16)] = week({DS: {"amc": [entry("AAA")]}})
    out = es.get_day(DS)
    assert out["status"] == "ok" and rows_of(out, "amc")["AAA"]["sym"] == "AAA"
    assert world.threads["week"] and threading.get_ident() not in world.threads["week"]
    assert es.get_day(DS) is out                          # held: no second build
    assert len(world.calls["week"]) == 1


def test_a_slow_build_answers_computing_at_once_and_the_next_ask_has_the_answer(world):
    world.weeks[date(2026, 11, 16)] = week({DS: {"amc": [entry("AAA")]}})
    world.week_delay = 0.4
    started = time.time()
    first = es.get_day(DS, wait_s=0.02)
    assert first == {"status": "computing", "date": DS, "default": False}
    assert time.time() - started < 0.3                    # it did not wait for the build
    again = es.get_day(DS, wait_s=0.02)                   # the same build, not a second one
    assert again["status"] == "computing"
    wait_until(lambda: es.get_day(DS, wait_s=0.5)["status"] == "ok")
    assert len(world.calls["week"]) == 1


def test_many_requests_at_once_share_one_build(world):
    world.weeks[date(2026, 11, 16)] = week({DS: {"amc": [entry("AAA")]}})
    world.week_delay = 0.15
    got = []
    threads = [threading.Thread(target=lambda: got.append(es.get_day(DS, wait_s=3)["status"])) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(5)
    assert got == ["ok"] * 8
    assert len(world.calls["week"]) == 1


def test_past_its_freshness_the_last_good_answer_is_served_at_once_marked_refreshing(world, monkeypatch):
    world.weeks[date(2026, 11, 16)] = week({DS: {"amc": [entry("AAA")]}})
    assert es.get_day(DS)["status"] == "ok"
    clock = Clock()
    monkeypatch.setattr(es, "time", clock)
    clock.now += es.FRESH_TODAY_S - 1
    assert "refreshing" not in es.get_day(DS)             # today's answer is fresh for a minute
    clock.now += 2
    world.weeks[date(2026, 11, 16)] = week({DS: {"amc": [entry("AAA"), entry("NEW")]}})
    world.week_delay = 0.2
    stale = es.get_day(DS, wait_s=0.01)
    assert stale["status"] == "ok" and stale["refreshing"] is True and "NEW" not in rows_of(stale, "amc")
    assert len(world.calls["week"]) == 2                  # ONE rebuild was started, behind the answer
    wait_until(lambda: "NEW" in rows_of(es.get_day(DS, wait_s=0.5), "amc"))
    assert "refreshing" not in es.get_day(DS)
    assert len(world.calls["week"]) == 2
    # and past the extra time the old answer is not served at all
    clock.now += es.FRESH_TODAY_S + es.STALE_EXTRA_S + 1
    world.week_delay = 0.4
    assert es.get_day(DS, wait_s=0.01)["status"] == "computing"


def test_another_days_answer_is_fresh_for_longer_than_todays(world, monkeypatch):
    world.weeks[date(2026, 11, 16)] = week({TOMORROW: {"amc": [entry("AAA")]}})
    assert es.get_day(TOMORROW)["status"] == "ok"
    clock = Clock()
    monkeypatch.setattr(es, "time", clock)
    clock.now += es.FRESH_TODAY_S + 5
    assert "refreshing" not in es.get_day(TOMORROW)
    assert es.FRESH_OTHER_S > es.FRESH_TODAY_S


def test_a_failed_build_is_said_briefly_and_never_replaces_the_last_good_answer(world, monkeypatch):
    world.weeks[date(2026, 11, 16)] = week({DS: {"amc": [entry("AAA")]}})
    good = es.get_day(DS)
    assert good["status"] == "ok"
    clock = Clock()
    monkeypatch.setattr(es, "time", clock)
    clock.now += es.FRESH_TODAY_S + 1
    monkeypatch.setattr(es, "build_day", lambda ds: (_ for _ in ()).throw(RuntimeError("boom")))
    es.get_day(DS, wait_s=0.01)
    wait_until(lambda: not es._inflight)
    out = es.get_day(DS, wait_s=0.01)
    assert out["status"] == "ok" and out["refreshing"] is True       # the last good answer, not the failure
    # with nothing good to fall back on, the failure is said
    es._old.clear()
    assert es.get_day(DS, wait_s=0.01) == {"status": "unavailable", "reason": "build", "date": DS, "default": False}


def test_the_bare_commands_answer_is_also_held_under_its_own_date(world):
    world.weeks[date(2026, 11, 16)] = week({TOMORROW: {"amc": [entry("AAA")]}})
    out = es.get_day(None)
    assert out["status"] == "ok" and out["date"] == TOMORROW and out["default"] is True
    builds = len(world.calls["week"])
    dated = es.get_day(TOMORROW)
    assert dated["status"] == "ok" and dated["default"] is False and dated["sessions"] == out["sessions"]
    assert len(world.calls["week"]) == builds              # no second build


# ── the route and its gate ───────────────────────────────────────────────────────────────────

FREE_USER = {"id": "es-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "es-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}


def _client(user):
    app = FastAPI()
    app.include_router(calendar_route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_route_is_behind_the_calendars_paid_gate_and_passes_the_date_through(monkeypatch):
    asked = []
    monkeypatch.setattr(es, "get_day", lambda ds=None: asked.append(ds) or {"status": "ok", "date": ds})
    route = next(r for r in calendar_route.router.routes if r.path == "/api/calendar/earnings-season")
    assert route.methods == {"GET"}
    assert calendar_route.require_paid in {d.call for d in route.dependant.dependencies}
    assert _client(None).get("/api/calendar/earnings-season").status_code == 401
    refused = _client(FREE_USER).get("/api/calendar/earnings-season")
    assert refused.status_code == 402
    assert asked == []                                     # a refused caller never reaches the reader
    ok = _client(PAID_USER).get("/api/calendar/earnings-season", params={"date": DS})
    assert ok.status_code == 200 and ok.json() == {"status": "ok", "date": DS}
    assert _client(PAID_USER).get("/api/calendar/earnings-season").json() == {"status": "ok", "date": None}
    assert asked == [DS, None]


def test_the_real_week_reader_goes_through_the_calendars_own_readers(monkeypatch):
    monkeypatch.setattr(calendar_route, "_today_et", lambda: TODAY)
    seen = []
    monkeypatch.setattr(calendar_route, "_get_calendar_payload", lambda wk=None: seen.append(("current", wk)) or {"days": {}})
    monkeypatch.setattr(calendar_route, "_get_or_build_range_week", lambda monday: seen.append(("range", monday)) or {"days": {}})
    es.read_week(date(2026, 11, 16))
    es.read_week(date(2026, 11, 23))
    assert seen == [("current", None), ("range", date(2026, 11, 23))]


def test_the_real_held_reads_never_work_anything_out(monkeypatch):
    calendar_route.cache.set("calendar_reactions_2026-11-12", {"AAA": 1.5}, ttl=30)
    assert es.read_held_moves("2026-11-12") == {"AAA": 1.5}
    assert es.read_held_moves("2026-11-11") is None
    # today: the route's own held answer is used before any batch read
    from api.services import massive
    monkeypatch.setattr(massive, "_get_client", lambda: (_ for _ in ()).throw(AssertionError("no batch read")))
    assert es.read_live_moves("2026-11-12", ["AAA"]) == {"AAA": 1.5}
