"""TIDEH catch-up (gap audit R1 / P4): a session the three after-close tries all missed is re-read
later from the tape, one day at a time, and stored only when the read is whole.

`api/services/options_analytics/tide_history.py` (`find_gaps`, `catch_up`, `run_startup_job`) +
the `market_tide_history_catchup_boot` job. The store is a temporary SQLite file (DATA_DIR points
at tmp_path); the one-day tape read (`tide_history._read_day`) is a stand-in that serves invented
rows, so nothing here reads the tape or the network. Every number is invented.
"""
from __future__ import annotations

import ast
import datetime as dt
import os
import pathlib
import sqlite3
import sys
from zoneinfo import ZoneInfo

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services.options_analytics import market_tide as mt  # noqa: E402
from api.services.options_analytics import tide_history as th  # noqa: E402

ET = ZoneInfo("America/New_York")
FLAG = "OPTIONS_MARKET_TIDE_ENABLED"
FRI, MON, TUE, WED, THU = "2026-11-13", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"
FRI2 = "2026-11-20"


def at(day, hh, mm):
    y, m, d = (int(x) for x in day.split("-"))
    return dt.datetime(y, m, d, hh, mm, tzinfo=ET)


def mdy(iso):
    y, m, d = iso.split("-")
    return f"{int(m)}/{int(d)}/{y}"


def prints(day, *, through="15:58", calls=3, puts=2, premium=100_000, unreadable=0):
    """A day's tape rows for one partition: `calls` calls bought at the ask, `puts` puts sold at the
    bid (both add to the net), the last print at `through`."""
    h, m = (int(x) for x in through.split(":"))
    rows = [{"CreatedDate": mdy(day), "CreatedTime": "09:31:00", "Premium": str(premium),
             "CallPut": "CALL", "Side": "A"} for _ in range(calls - 1)]
    rows += [{"CreatedDate": mdy(day), "CreatedTime": "10:15:00", "Premium": str(premium),
              "CallPut": "PUT", "Side": "B"} for _ in range(puts)]
    rows.append({"CreatedDate": mdy(day), "CreatedTime": f"{h:02d}:{m:02d}:30", "Premium": str(premium),
                 "CallPut": "CALL", "Side": "A"})
    rows += [{"CreatedDate": mdy(day), "CreatedTime": "", "Premium": "x", "CallPut": "?", "Side": ""}
             for _ in range(unreadable)]
    return rows


class DayTape:
    """The stand-in for the one-day read: `{(partition, day): rows | "fail"}`; a day it does not
    hold answers ok with no rows, as the route does (a bare header)."""

    def __init__(self):
        self.days = {}
        self.reads = []

    def hold(self, day, rows=None, parts=("stocks", "etfs")):
        for part in parts:
            self.days[(part, day)] = prints(day) if rows is None else rows

    def read(self, path, day, add):
        part = next(k for k, v in mt.SOURCES.items() if v == path)
        self.reads.append((part, day))
        got = self.days.get((part, day), [])
        if got == "fail":
            return False, None
        for r in got:
            add(dict(r))
        return True, f"v-{part}-{day}"


@pytest.fixture
def tape(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    t = DayTape()
    monkeypatch.setattr(th, "_read_day", t.read)

    def no_build(*a, **k):
        raise AssertionError("the catch-up built a live tide; it reads one day by date range only")
    monkeypatch.setattr(mt, "build", no_build)
    return t


def put_row(day, scope="all", source=th.SOURCE_CAPTURE, net=1_000_000):
    """A stored session, written through the store's own code (as a capture would)."""
    tide = {"session": day, "data_through": "16:14", "prints_counted": 300, "prints_unsigned": 0,
            "prints_unreadable": 0, "minutes": [{"t": "09:31"}],
            "totals": {"net_call_premium": net, "net_put_premium": 0, "net_premium": net}}
    import contextlib
    with contextlib.closing(th._connect()) as conn:
        conn.isolation_level = None
        return th._store(conn, scope, tide, "2026-11-01T00:00:00+00:00", source=source)


def seed(days, scopes=mt.SCOPES):
    for d in days:
        for s in scopes:
            put_row(d, s)


def stored(scope="all"):
    return {r["session"]: r for r in th.history(scope, 250)["sessions"]}


# ── the gap finder ──────────────────────────────────────────────────────────────

def test_no_store_is_no_gap_and_creates_nothing(tape):
    assert th.find_gaps(at(THU, 16, 33)) == []
    assert th.catch_up(at(THU, 16, 33)) == {"gaps": 0, "tried": [], "left": 0}
    assert not os.path.exists(th._db_path()) and tape.reads == []


def test_a_session_missing_inside_the_history_is_found_newest_first(tape):
    seed([FRI, TUE])
    assert th.find_gaps(at(THU, 16, 33)) == [{"session": WED, "scopes": list(mt.SCOPES)},
                                             {"session": MON, "scopes": list(mt.SCOPES)}]


def test_today_is_the_captures_job_unless_asked_and_finished(tape):
    seed([TUE])
    assert [g["session"] for g in th.find_gaps(at(THU, 16, 33))] == [WED]
    assert [g["session"] for g in th.find_gaps(at(THU, 16, 33), include_today=True)] == [THU, WED]
    assert [g["session"] for g in th.find_gaps(at(THU, 16, 10), include_today=True)] == [WED]


def test_never_before_the_first_stored_day_and_never_a_closed_day(tape):
    # Thanksgiving (Thu 26) and the weekends were never sessions; nothing before WED is asked for.
    seed([WED])
    gaps = [g["session"] for g in th.find_gaps(at("2026-11-30", 17, 0))]
    assert gaps == ["2026-11-27", "2026-11-25", "2026-11-24", "2026-11-23", FRI2, THU]


def test_only_the_scopes_with_no_row_are_asked_for(tape):
    seed([MON, WED])
    put_row(TUE, "stocks")
    assert th.find_gaps(at(THU, 16, 33)) == [{"session": TUE, "scopes": ["all", "etfs"]}]


def test_the_window_is_bounded(tape, monkeypatch):
    seed([FRI])
    monkeypatch.setattr(th, "CATCHUP_WINDOW", 2)
    assert [g["session"] for g in th.find_gaps(at(FRI2, 16, 33))] == [THU, WED]


# ── recovering a day ────────────────────────────────────────────────────────────

def test_a_missed_session_is_recovered_with_two_reads_and_marked_recovered(tape):
    seed([MON, WED])
    tape.hold(TUE)
    out = th.catch_up(at(THU, 16, 33))
    assert out["gaps"] == 1 and out["left"] == 0
    assert all(r["stored"] for r in out["tried"][0]["scopes"].values())
    assert sorted(tape.reads) == [("etfs", TUE), ("stocks", TUE)]       # once per partition
    one = 3 * 100_000 + 2 * 100_000                                       # 3 calls at ask + 2 puts at bid
    row = stored("all")[TUE]
    assert row["source"] == th.SOURCE_CATCHUP == "catchup"
    assert (row["net_call_premium"], row["net_put_premium"]) == (2 * 300_000, -2 * 200_000)
    assert row["net_premium"] == 2 * one and row["prints_counted"] == 10 and row["data_through"] == "15:58"
    assert stored("stocks")[TUE]["net_premium"] == one == stored("etfs")[TUE]["net_premium"]
    h = th.history("all", 60)
    assert h["recovered_sessions"] == [TUE] and h["missing_sessions"] == [] and h["missing_for_good"] == []
    assert "read again from the tape later" in h["stored_note"]


def test_the_catch_up_is_idempotent(tape):
    seed([MON, WED])
    tape.hold(TUE)
    th.catch_up(at(THU, 16, 33))
    before = stored("all")[TUE]
    reads = len(tape.reads)
    again = th.catch_up(at(THU, 20, 33))
    assert again == {"gaps": 0, "tried": [], "left": 0}
    assert len(tape.reads) == reads and stored("all")[TUE] == before


def test_a_catch_up_never_replaces_a_stored_row(tape):
    put_row(TUE, net=7)
    out = put_row(TUE, source=th.SOURCE_CATCHUP, net=999)
    assert out["stored"] is False and "already stored" in out["reason"]
    assert stored("all")[TUE]["net_premium"] == 7 and stored("all")[TUE]["source"] == "capture"


def test_a_capture_later_still_replaces_a_recovered_row(tape):
    put_row(TUE, source=th.SOURCE_CATCHUP, net=5)
    assert put_row(TUE, net=6)["stored"] is True
    assert stored("all")[TUE]["source"] == "capture"


def test_at_most_max_days_per_run_newest_first(tape, monkeypatch):
    seed([FRI, FRI2])
    for d in (MON, TUE, WED, THU):
        tape.hold(d)
    monkeypatch.setattr(th, "CATCHUP_MAX_DAYS", 2)
    out = th.catch_up(at("2026-11-23", 17, 0))
    assert [t["session"] for t in out["tried"]] == [THU, WED] and out["left"] == 2
    assert len(tape.reads) == 4
    out2 = th.catch_up(at("2026-11-23", 20, 33))
    assert [t["session"] for t in out2["tried"]] == [TUE, MON] and out2["left"] == 0


# ── never a partial day ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("setup, refused, kept, why", [
    (lambda t: (t.hold(TUE, parts=("stocks",)), t.days.update({("etfs", TUE): "fail"})),
     ["all", "etfs"], ["stocks"], "The etfs tape could not be read for 2026-11-17"),
    (lambda t: t.hold(TUE, parts=("stocks",)),
     ["all", "etfs"], ["stocks"], "The tape holds no etfs prints for 2026-11-17"),
    (lambda t: t.hold(TUE, rows=prints(TUE, through="14:02")),
     ["all", "stocks", "etfs"], [], "runs only to 14:02 ET, short of 15:55 ET"),
    (lambda t: t.hold(TUE, rows=prints(TUE) + prints(MON)),
     ["all", "stocks", "etfs"], [], "answered with other days than 2026-11-17"),
    (lambda t: t.hold(TUE, rows=prints(TUE, unreadable=1)),
     ["all", "stocks", "etfs"], [], "partial, so it is not stored"),
])
def test_an_incomplete_day_is_never_stored_and_says_why(tape, setup, refused, kept, why):
    seed([MON, WED])
    setup(tape)
    out = th.catch_up(at(THU, 16, 33))["tried"][0]["scopes"]
    for s in refused:
        assert out[s]["stored"] is False and why in out[s]["reason"] and out[s]["tries"] == 1
        assert TUE not in stored(s)
    for s in kept:
        assert out[s]["stored"] is True and stored(s)[TUE]["source"] == "catchup"


def test_a_read_that_raises_is_a_try_not_a_crash(tape, monkeypatch):
    seed([MON, WED])
    monkeypatch.setattr(th, "_read_day", lambda *a: (_ for _ in ()).throw(OSError("down")))
    out = th.catch_up(at(THU, 16, 33))
    assert all("failed: OSError" in r["reason"] for r in out["tried"][0]["scopes"].values())


def test_after_max_tries_a_day_is_missing_for_good_and_read_no_more(tape):
    seed([MON, WED])
    for n in range(1, th.CATCHUP_MAX_TRIES + 1):
        out = th.catch_up(at(THU, 16, 33))["tried"][0]["scopes"]["all"]
        assert out["tries"] == n and out["given_up"] is (n == th.CATCHUP_MAX_TRIES)
    reads = len(tape.reads)
    assert th.catch_up(at(THU, 20, 33)) == {"gaps": 0, "tried": [], "left": 0}
    assert len(tape.reads) == reads
    h = th.history("all", 60)
    assert h["missing_sessions"] == [TUE]
    assert h["missing_for_good"] == [{"session": TUE, "reason": (
        "The tape holds no stocks prints for 2026-11-17 (it no longer holds that day, or never did), "
        "so it is not stored.")}]
    assert th.CATCHUP_MAX_TRIES == 3


def test_a_tried_day_that_recovers_is_no_longer_missing_for_good(tape):
    seed([MON, WED])
    th.catch_up(at(THU, 16, 33))                     # one failed try
    tape.hold(TUE)
    th.catch_up(at(THU, 17, 33))
    h = th.history("all", 60)
    assert h["recovered_sessions"] == [TUE] and h["missing_for_good"] == []
    con = sqlite3.connect(th._db_path())
    assert con.execute("SELECT tries, given_up FROM tide_gaps WHERE session = ? AND scope = 'all'",
                       (TUE,)).fetchone() == (1, 0)                  # its try stays as history
    con.close()


# ── the jobs ────────────────────────────────────────────────────────────────────

def test_the_capture_job_runs_the_catch_up_after_the_capture(tape, monkeypatch):
    seed([MON, TUE])
    monkeypatch.setenv(FLAG, "1")
    calls = []
    monkeypatch.setattr(th, "capture", lambda now=None: calls.append("capture") or {})
    real = th.catch_up
    monkeypatch.setattr(th, "catch_up", lambda now=None, include_today=False:
                        calls.append(("catch_up", include_today)) or real(now, include_today))
    out = th.run_capture_job(at(THU, 16, 33))
    assert calls == ["capture", ("catch_up", False)]
    assert out["catchup"]["tried"][0]["session"] == WED


@pytest.mark.parametrize("hh, mm, runs", [(9, 19, True), (9, 20, False), (16, 14, False), (16, 15, True)])
def test_the_startup_job_never_reads_inside_the_trading_day(tape, monkeypatch, hh, mm, runs):
    seed([MON])
    monkeypatch.setenv(FLAG, "1")
    out = th.run_startup_job(at(WED, hh, mm))
    assert out["ran"] is runs and bool(tape.reads) is runs


def test_the_startup_job_reads_nothing_switched_off(tape, monkeypatch):
    seed([MON])
    monkeypatch.delenv(FLAG, raising=False)
    assert th.run_startup_job(at(WED, 17, 0)) == {"ran": False, "reason": "Market Tide is switched off."}
    assert tape.reads == []


def test_the_startup_job_recovers_today_after_a_restart_across_the_window(tape, monkeypatch):
    seed([TUE])
    tape.hold(WED)
    monkeypatch.setenv(FLAG, "1")
    out = th.run_startup_job(at(WED, 21, 5))
    assert out["ran"] is True and stored("all")[WED]["source"] == "catchup"


def test_the_startup_job_never_raises(tape, monkeypatch):
    from api.services.options_analytics import flags
    monkeypatch.setattr(flags, "is_on", lambda name: (_ for _ in ()).throw(KeyError(name)))
    assert th.run_startup_job(at(WED, 17, 0)) == {"ran": False, "reason": "The catch-up failed: KeyError."}


def test_the_startup_job_is_registered_once_a_few_minutes_after_boot():
    tree = ast.parse(pathlib.Path("api/main.py").read_text(encoding="utf-8"))
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)]
    mine = [n for n in calls for kw in n.keywords if kw.arg == "id" and isinstance(kw.value, ast.Constant)
            and kw.value.value == "market_tide_history_catchup_boot"]
    assert len(mine) == 1
    (call,) = mine
    assert ast.unparse(call.args[0]) == "_tide_history.run_startup_job"
    kw = {k.arg: k.value for k in call.keywords}
    assert ast.literal_eval(kw["trigger"]) == "date"
    assert "CATCHUP_BOOT_DELAY_S" in ast.unparse(kw["run_date"])
    assert 60 <= th.CATCHUP_BOOT_DELAY_S <= 600


# ── the one-day read ────────────────────────────────────────────────────────────

def test_the_default_read_asks_the_tape_for_exactly_one_day(monkeypatch):
    import contextlib

    import httpx
    seen = {}

    class Resp:
        status_code = 200
        headers = {"x-flow-version": "v9"}

        def iter_lines(self):
            yield "CreatedDate,CreatedTime,Premium,CallPut,Side"
            yield "11/17/2026,15:58:00,1000,CALL,A"

    @contextlib.contextmanager
    def stream(method, url, params=None, headers=None, timeout=None):
        seen.update(method=method, url=url, params=params)
        yield Resp()

    monkeypatch.setattr(httpx, "stream", stream)
    got = []
    assert th._default_read_day("/api/flow/data", TUE, got.append) == (True, "v9")
    assert seen["params"] == {"date_from": TUE, "date_to": TUE} and seen["url"].endswith("/api/flow/data")
    assert got == [{"CreatedDate": "11/17/2026", "CreatedTime": "15:58:00", "Premium": "1000",
                    "CallPut": "CALL", "Side": "A"}]

    class Bad(Resp):
        status_code = 503

    @contextlib.contextmanager
    def bad(*a, **k):
        yield Bad()
    monkeypatch.setattr(httpx, "stream", bad)
    assert th._default_read_day("/api/flow/data", TUE, got.append) == (False, None)
