"""SEASB: the seasonality board (index funds and sector funds, month by month).

`api/services/seasonality_board.py` + `GET /api/research/seasonality-board`. The daily read
(`api.routers.seasonality._daily_bars`) is a stand-in in every test, so nothing here reads the bar
store or the network, and the route is mounted on a bare app (the router alone), so this file never
imports `api.main`. Every number is invented.
"""
from __future__ import annotations

import datetime as dt
import inspect
import os
import pathlib
import sys
import threading
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.middleware.auth_middleware import get_current_user_with_plan  # noqa: E402
from api.routers import seasonality as route  # noqa: E402
from api.services import seasonality as svc  # noqa: E402
from api.services import seasonality_board as sb  # noqa: E402
from api.services import sector_strength  # noqa: E402
from api.services import session_calendar  # noqa: E402

FLAG = "SEASONALITY_ENABLED"
URL = "/api/research/seasonality-board"
FASTAPI_404 = b'{"detail":"Not Found"}'
PAID = {"id": "paid-test", "email": "paid@example.test", "role": "member", "plan": "pro"}
FREE = {"id": "free-test", "email": "free@example.test", "role": "member", "plan": "free"}
NOV = dt.date(2026, 11, 20)
INDEX = ["SPY", "QQQ", "IWM", "DIA"]
MONTH_KEYS = {"month", "label", "n", "avg_pct", "median_pct", "pct_up", "thin"}


def series(years, start=2015, march=None):
    """Two bars a month (the 15th and the 28th, the month end) for `years` whole years.

    Month over month: February +10% every year, March `march[i]`% in year i (default +1%), every
    other month flat. So the hand-checked answers are: Feb median 10.0 with every year up, and
    March whatever `march` says."""
    out, close = [], 100.0
    for i in range(years):
        for m in range(1, 13):
            if m == 2:
                close *= 1.10
            elif m == 3:
                close *= 1 + (march[i] if march else 1.0) / 100
            out.append({"t": f"{start + i:04d}-{m:02d}-15", "c": close * 0.99})
            out.append({"t": f"{start + i:04d}-{m:02d}-28", "c": close})
    return out


EIGHT = series(8, march=[3, 3, 3, -1, -1, -1, -1, -1])      # 2015..2022
THREE = series(3)                                           # 2015..2017: every month thin


class Reads:
    """Stands in for `_daily_bars`: answers per symbol, and records what was asked."""

    def __init__(self, default=EIGHT, **by_sym):
        self.default, self.by_sym, self.asked = default, dict(by_sym), []

    def __call__(self, sym):
        self.asked.append(sym)
        hit = self.by_sym.get(sym, self.default)
        if isinstance(hit, BaseException):
            raise hit
        return hit


@pytest.fixture(autouse=True)
def _fresh(tmp_path, monkeypatch):
    # no disk copy unless a test asks for one (the `disk` fixture): a folder that does not exist
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "no-data-dir"))
    sb.reset()
    yield
    sb.drain(10)
    sb.reset()


@pytest.fixture
def reads(monkeypatch):
    def install(default=EIGHT, **by_sym):
        r = Reads(default, **by_sym)
        monkeypatch.setattr(route, "_daily_bars", r)
        return r
    return install


def by_symbol(board):
    return {f["symbol"]: f for f in board["funds"]}


# ── the fund list ────────────────────────────────────────────────────────────────────────────

def test_the_funds_are_the_four_index_funds_then_the_sector_funds_in_their_own_order():
    rows = sb.funds()
    assert [r["symbol"] for r in rows[:4]] == INDEX
    assert [(r["name"], r["kind"]) for r in rows[:4]] == [
        ("S&P 500", "index"), ("Nasdaq 100", "index"), ("Russell 2000", "index"), ("Dow 30", "index")]
    # the sector funds are whatever sector_strength lists, in its order, with its names
    assert [(r["name"], r["symbol"]) for r in rows[4:]] == list(sector_strength.SECTOR_ETFS.items())
    assert all(r["kind"] == "sector" for r in rows[4:])
    assert len(sector_strength.SECTOR_ETFS) == 11 and len(rows) == 15
    assert len({r["symbol"] for r in rows}) == 15


def test_the_sector_funds_are_read_from_sector_strength_not_retyped(monkeypatch):
    # the control: a sector added to the one list appears on the board, with no edit here
    monkeypatch.setitem(sector_strength.SECTOR_ETFS, "Invented Sector", "XZZ")
    assert sb.funds()[-1] == {"symbol": "XZZ", "name": "Invented Sector", "kind": "sector"}
    monkeypatch.delitem(sector_strength.SECTOR_ETFS, "Technology")
    assert "XLK" not in [r["symbol"] for r in sb.funds()]
    # and the module's own text names no sector fund at all
    src = pathlib.Path(sb.__file__).read_text(encoding="utf-8")
    for sym in ("XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLB", "XLRE", "XLU", "XLC"):
        assert f'"{sym}"' not in src, sym


# ── pure helpers ─────────────────────────────────────────────────────────────────────────────

def test_month_fields_across_a_year_end():
    assert sb.month_fields(dt.date(2026, 11, 20)) == {"this_month": 11, "next_month": 12}
    assert sb.month_fields(dt.date(2026, 12, 31)) == {"this_month": 12, "next_month": 1}
    assert sb.month_fields(dt.date(2027, 1, 1)) == {"this_month": 1, "next_month": 2}


def test_a_fund_row_carries_twelve_months_and_its_window_and_nothing_else():
    fund = {"symbol": "ABC", "name": "Invented Fund", "kind": "sector"}
    row = sb.fund_row(fund, svc.compute(EIGHT))
    assert set(row) == {"symbol", "name", "kind", "status", "months", "covered_from", "covered_to", "full_months"}
    assert row["status"] == "ok" and (row["symbol"], row["name"], row["kind"]) == ("ABC", "Invented Fund", "sector")
    assert [m["month"] for m in row["months"]] == list(range(1, 13))
    assert all(set(m) == MONTH_KEYS for m in row["months"])
    assert (row["covered_from"], row["covered_to"]) == ("2015-01-15", "2022-12-28")
    assert row["full_months"] == 94                 # 96 months held: the first is a base, the last is not counted


def test_a_read_with_no_full_month_is_too_short_never_twelve_empty_cells():
    fund = {"symbol": "ABC", "name": "Invented Fund", "kind": "sector"}
    for computed in (svc.compute([{"t": "2026-11-02", "c": 10}, {"t": "2026-11-03", "c": 11}]), svc.compute([]), None, {}):
        row = sb.fund_row(fund, computed)
        assert row == {"symbol": "ABC", "name": "Invented Fund", "kind": "sector",
                       "status": "unavailable", "reason": "too_short"}
        assert "months" not in row


def test_which_funds_could_heal():
    f = {"symbol": "ABC", "name": "x", "kind": "index"}
    assert sb.heals(sb.fund_without(f, "pending")) is True
    assert sb.heals(sb.fund_without(f, "unavailable", "transient")) is True
    assert sb.heals(sb.fund_without(f, "unavailable", "RuntimeError")) is True
    assert sb.heals(sb.fund_without(f, "unavailable", "too_short")) is False
    assert sb.heals(sb.fund_without(f, "not_held")) is False
    assert sb.heals(sb.fund_row(f, svc.compute(EIGHT))) is False


def test_assemble_says_complete_only_when_every_fund_has_numbers():
    f = {"symbol": "ABC", "name": "x", "kind": "index"}
    ok = sb.fund_row(f, svc.compute(EIGHT))
    newer = dict(ok, covered_to="2023-01-31")
    full = sb.assemble([ok, newer], NOV, "2026-11-20T09:00:00-05:00")
    assert full["complete"] is True and full["settled"] is True
    assert full["data_through"] == "2023-01-31"            # the newest bar any fund was computed through
    assert (full["this_month"], full["next_month"], full["et_date"]) == (11, 12, "2026-11-20")
    assert full["min_years"] == svc.MIN_YEARS == 5
    assert full["source"] == "UCT daily bar store, close to close"
    assert full["as_of"] == "2026-11-20T09:00:00-05:00"
    some = sb.assemble([ok, sb.fund_without(f, "pending")], NOV, "x")
    assert some["complete"] is False and some["settled"] is False
    gone = sb.assemble([ok, sb.fund_without(f, "not_held")], NOV, "x")
    assert gone["complete"] is False and gone["settled"] is True
    none = sb.assemble([sb.fund_without(f, "pending")], NOV, "x")
    assert none["complete"] is False and none["data_through"] is None
    assert sb.assemble([], NOV, "x")["complete"] is False   # no funds is not "every fund has numbers"


def test_the_reuse_rule():
    f = {"symbol": "ABC", "name": "x", "kind": "index"}
    done = sb.assemble([sb.fund_row(f, svc.compute(EIGHT))], NOV, "x")
    part = sb.assemble([sb.fund_without(f, "pending")], NOV, "x")
    tomorrow = NOV + dt.timedelta(days=1)
    assert sb.reusable(None, NOV, 0.0) is None
    # a settled answer: the rest of that New York day, however long that is; never the next day
    assert sb.reusable((NOV, 100.0, done), NOV, 100.0 + 20 * 3600) is done
    assert sb.reusable((NOV, 100.0, done), tomorrow, 101.0) is None
    # an answer with a fund pending: one minute
    assert sb.INCOMPLETE_REUSE_S == 60.0
    assert sb.reusable((NOV, 100.0, part), NOV, 159.9) is part
    assert sb.reusable((NOV, 100.0, part), NOV, 160.0) is None
    assert sb.reusable((NOV, 100.0, part), tomorrow, 101.0) is None


# ── build: every per-fund outcome ────────────────────────────────────────────────────────────

def test_every_fund_with_numbers_is_a_complete_board_with_the_hand_checked_figures(reads):
    r = reads()
    board = sb.build(NOV)
    assert r.asked == [f["symbol"] for f in sb.funds()]          # one read per fund, in order
    assert board["complete"] is True and board["settled"] is True
    assert [f["symbol"] for f in board["funds"]] == r.asked
    spy = by_symbol(board)["SPY"]
    feb, mar, jan, dec, apr = (spy["months"][i] for i in (1, 2, 0, 11, 3))
    # February: +10% in each of the eight years
    assert (feb["n"], feb["pct_up"], feb["thin"]) == (8, 100, False)
    assert feb["median_pct"] == pytest.approx(10.0) and feb["avg_pct"] == pytest.approx(10.0)
    # March: +3, +3, +3, -1, -1, -1, -1, -1: the average is +0.5, the median -1, three of eight up
    assert (mar["n"], mar["pct_up"]) == (8, 38)
    assert mar["avg_pct"] == pytest.approx(0.5) and mar["median_pct"] == pytest.approx(-1.0)
    # the first January is only a base and the last December is not counted: seven each
    assert (jan["n"], dec["n"]) == (7, 7)
    assert (apr["n"], apr["median_pct"], apr["pct_up"]) == (8, pytest.approx(0.0), 0)
    assert board["data_through"] == "2022-12-28"
    assert "weekdays" not in spy


def test_a_fund_without_numbers_is_listed_with_its_reason_never_dropped_never_zeros(reads):
    r = reads(
        QQQ=route.HistoryPending("QQQ"),
        IWM=route.NoDailyHistory("IWM"),
        DIA=route.BarsUnavailable("transient"),
        XLK=RuntimeError("the store fell over"),
        XLF=[],
        XLE=[{"t": "2026-11-02", "c": 10}, {"t": "2026-11-03", "c": 11}],
        XLV=route.BarsUnavailable(""),
    )
    board = sb.build(NOV)
    assert len(board["funds"]) == 15 and [f["symbol"] for f in board["funds"]] == r.asked
    got = by_symbol(board)
    assert (got["QQQ"]["status"], got["QQQ"]["reason"]) == ("pending", None)
    assert (got["IWM"]["status"], got["IWM"]["reason"]) == ("not_held", None)
    assert (got["DIA"]["status"], got["DIA"]["reason"]) == ("unavailable", "transient")
    assert (got["XLK"]["status"], got["XLK"]["reason"]) == ("unavailable", "RuntimeError")
    assert (got["XLF"]["status"], got["XLF"]["reason"]) == ("unavailable", "empty_read")
    assert (got["XLE"]["status"], got["XLE"]["reason"]) == ("unavailable", "too_short")
    assert (got["XLV"]["status"], got["XLV"]["reason"]) == ("unavailable", "BarsUnavailable")
    for sym in ("QQQ", "IWM", "DIA", "XLK", "XLF", "XLE", "XLV"):
        assert "months" not in got[sym] and "covered_from" not in got[sym], sym
        assert (got[sym]["name"], got[sym]["kind"]) != (None, None)
    # the funds that did read keep their numbers
    assert got["SPY"]["status"] == "ok" and got["XLU"]["months"][1]["median_pct"] == pytest.approx(10.0)
    assert board["complete"] is False and board["settled"] is False


def test_every_fund_pending_is_still_a_board(reads):
    reads(default=route.HistoryPending("x"))
    board = sb.build(NOV)
    assert [f["status"] for f in board["funds"]] == ["pending"] * 15
    assert board["complete"] is False and board["settled"] is False and board["data_through"] is None
    assert (board["this_month"], board["next_month"]) == (11, 12)


def test_a_short_record_keeps_its_thin_marks_and_its_own_window(reads):
    reads(XLC=THREE)
    got = by_symbol(sb.build(NOV))
    assert got["XLC"]["status"] == "ok" and got["XLC"]["covered_from"] == "2015-01-15"
    assert got["XLC"]["covered_to"] == "2017-12-28" and got["SPY"]["covered_to"] == "2022-12-28"
    assert all(m["thin"] for m in got["XLC"]["months"]) and got["XLC"]["months"][1]["n"] == 3
    assert not any(m["thin"] for m in got["SPY"]["months"])


def test_build_reads_through_the_routers_own_daily_read(monkeypatch):
    # not a copy: the stand-in is put on the router after this module was imported, and is seen
    seen = []
    monkeypatch.setattr(route, "_daily_bars", lambda s: seen.append(s) or EIGHT)
    sb.build(NOV)
    assert len(seen) == 15
    src = pathlib.Path(sb.__file__).read_text(encoding="utf-8")
    assert "serve_bars" not in src and "route._daily_bars(" in src


def test_the_months_are_by_the_new_york_date_not_the_servers(reads, monkeypatch):
    reads()
    # 03:00 UTC on Jan 1 2027 is 22:00 on Dec 31 2026 in New York
    instant = dt.datetime(2027, 1, 1, 3, 0, tzinfo=dt.timezone.utc)

    class Fixed(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return instant.astimezone(tz) if tz else instant.replace(tzinfo=None)

    monkeypatch.setattr(sb, "datetime", Fixed)
    board = sb.build()
    assert (board["this_month"], board["next_month"], board["et_date"]) == (12, 1, "2026-12-31")
    assert board["as_of"] == "2026-12-31T22:00:00-05:00"
    assert sb.serve()["et_date"] == "2026-12-31"
    assert session_calendar.ET.key == "America/New_York"


def test_a_given_day_decides_the_months(reads):
    reads()
    assert sb.build(dt.date(2026, 12, 15))["next_month"] == 1
    assert sb.build(dt.date(2026, 2, 28))["this_month"] == 2


# ── the one held answer ──────────────────────────────────────────────────────────────────────

def test_a_complete_answer_is_reused_for_the_rest_of_the_day_and_rebuilt_the_next(reads, monkeypatch):
    r = reads()
    clock = {"t": 1000.0}
    monkeypatch.setattr(sb, "_clock", lambda: clock["t"])
    first = sb.serve(NOV, wait_s=10)
    assert first["complete"] is True and len(r.asked) == 15
    clock["t"] += 9 * 3600
    assert sb.serve(NOV) is first and len(r.asked) == 15          # nine hours later, the same answer
    nxt = sb.serve(NOV + dt.timedelta(days=1), wait_s=10)
    assert nxt is not first and len(r.asked) == 30 and nxt["et_date"] == "2026-11-21"
    assert sb.serve(NOV + dt.timedelta(days=1)) is nxt and len(r.asked) == 30


def test_an_answer_with_a_fund_pending_is_reused_for_a_minute_then_rebuilt(reads, monkeypatch):
    r = reads(XLC=route.HistoryPending("XLC"))
    clock = {"t": 500.0}
    monkeypatch.setattr(sb, "_clock", lambda: clock["t"])
    first = sb.serve(NOV, wait_s=10)
    assert first["complete"] is False and len(r.asked) == 15
    clock["t"] += 59.0
    assert sb.serve(NOV) is first and len(r.asked) == 15
    r.by_sym.pop("XLC")                                           # the full history has arrived
    clock["t"] += 1.5
    healed = sb.serve(NOV, wait_s=10)
    assert healed is not first and len(r.asked) == 30 and healed["complete"] is True
    clock["t"] += 3600
    assert sb.serve(NOV) is healed and len(r.asked) == 30


def test_a_failed_fund_heals_the_same_way_and_a_fund_not_held_does_not_keep_rebuilding(reads, monkeypatch):
    r = reads(XLE=route.BarsUnavailable("transient"))
    clock = {"t": 0.0}
    monkeypatch.setattr(sb, "_clock", lambda: clock["t"])
    sb.serve(NOV, wait_s=10)
    clock["t"] += 61
    sb.serve(NOV, wait_s=10)
    assert len(r.asked) == 30                                     # unavailable: asked again after a minute
    sb.reset()
    r2 = reads(XLE=route.NoDailyHistory("XLE"))
    held = sb.serve(NOV, wait_s=10)
    clock["t"] += 7200
    assert sb.serve(NOV) is held and len(r2.asked) == 15          # not held: settled for the day
    assert held["complete"] is False and held["settled"] is True


def test_two_callers_during_a_build_make_one_build_and_get_the_same_answer(monkeypatch):
    started, release, asked, out = threading.Event(), threading.Event(), [], {}

    def slow(sym):
        asked.append(sym)
        if len(asked) == 1:
            started.set()
            assert release.wait(10)
        return EIGHT

    monkeypatch.setattr(route, "_daily_bars", slow)
    a = threading.Thread(target=lambda: out.__setitem__("a", sb.serve(NOV, wait_s=10)))
    a.start()
    assert started.wait(10)
    b = threading.Thread(target=lambda: out.__setitem__("b", sb.serve(NOV, wait_s=10)))
    b.start()
    time.sleep(0.3)
    assert "b" not in out and len(asked) == 1                    # the second caller waits; it reads nothing
    release.set()
    a.join(10)
    b.join(10)
    assert len(asked) == 15
    assert out["a"] is out["b"] and out["a"]["complete"] is True


def test_the_wait_is_bounded_a_caller_who_runs_out_is_told_it_is_still_being_read(monkeypatch):
    started, release = threading.Event(), threading.Event()

    def slow(sym):
        started.set()
        assert release.wait(10)
        return EIGHT

    monkeypatch.setattr(route, "_daily_bars", slow)
    t0 = time.monotonic()
    waited = sb.serve(NOV, wait_s=0.05)                           # nothing is held yet for today
    assert time.monotonic() - t0 < 2.0 and started.wait(10)
    assert [f["status"] for f in waited["funds"]] == ["pending"] * 15
    assert waited["building"] is True and waited["complete"] is False and waited["settled"] is False
    assert (waited["this_month"], waited["next_month"]) == (11, 12)
    release.set()
    sb.drain(10)
    built = sb.serve(NOV)
    assert built["complete"] is True and sb.serve(NOV) is built   # the placeholder was never held


def test_a_caller_who_runs_out_gets_what_is_held_for_today_when_there_is_something(reads, monkeypatch):
    r = reads(XLC=route.HistoryPending("XLC"))
    clock = {"t": 0.0}
    monkeypatch.setattr(sb, "_clock", lambda: clock["t"])
    stale = sb.serve(NOV, wait_s=10)
    clock["t"] += 120                                             # past its minute: the next caller would rebuild
    release = threading.Event()

    def slow(sym):
        assert release.wait(10)
        return EIGHT

    monkeypatch.setattr(route, "_daily_bars", slow)
    try:
        assert sb.serve(NOV) is stale and len(r.asked) == 15      # today's last board at once; a build runs
        other_day = sb.serve(NOV + dt.timedelta(days=1))          # held, but for another day: not served
        assert other_day["building"] is True and other_day["et_date"] == "2026-11-21"
    finally:
        release.set()


def test_the_answer_is_held_in_this_module_not_the_shared_cache(reads, monkeypatch):
    from api.services.cache import cache
    calls = []
    monkeypatch.setattr(cache, "set", lambda *a, **k: calls.append(("set", a)))
    monkeypatch.setattr(cache, "get", lambda *a, **k: calls.append(("get", a)))
    reads()
    first = sb.serve(NOV, wait_s=10)
    assert sb.serve(NOV) is first and calls == []
    assert sb._held[0] == NOV and sb._held[2] is first


# ── the route ────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(route.router)
    who = {"user": PAID}
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who["user"])
    c = TestClient(app, raise_server_exceptions=False)
    c.who = who
    return c


def test_switched_off_the_board_is_a_plain_404_before_identity(client, monkeypatch, reads):
    r = reads()
    client.app.dependency_overrides[get_current_user_with_plan] = lambda: (_ for _ in ()).throw(
        AssertionError("identity read"))
    for value in (None, "0", "true"):
        if value is None:
            monkeypatch.delenv(FLAG, raising=False)
        else:
            monkeypatch.setenv(FLAG, value)
        resp = client.get(URL)
        assert resp.status_code == 404 and resp.content == FASTAPI_404, value
    assert r.asked == []


def test_switched_on_the_board_is_paid_only(client, monkeypatch, reads):
    r = reads()
    monkeypatch.setenv(FLAG, "1")
    client.who["user"] = FREE
    resp = client.get(URL)
    assert resp.status_code == 402 and resp.json()["detail"] == "Seasonality requires a paid plan"
    assert r.asked == []                                          # a free plan costs no read
    client.who["user"] = PAID
    resp = client.get(URL)
    assert resp.status_code == 200                                # at once; the build runs behind it
    sb.drain(10)
    resp = client.get(URL)
    assert resp.status_code == 200
    body = resp.json()
    assert body["complete"] is True and [f["symbol"] for f in body["funds"]][:4] == INDEX
    assert len(body["funds"]) == 15 and body["source"] == "UCT daily bar store, close to close"
    assert set(body) == {"funds", "this_month", "next_month", "et_date", "min_years", "source", "as_of",
                         "data_through", "complete", "settled"}


def test_the_board_path_is_never_read_as_a_symbol_and_the_symbol_route_still_answers(client, monkeypatch, reads):
    r = reads()
    monkeypatch.setenv(FLAG, "1")
    assert client.get(URL).status_code == 200
    sb.drain(10)
    assert r.asked == [f["symbol"] for f in sb.funds()]           # fifteen funds; nothing called "SEASONALITY-BOARD"
    assert not any("BOARD" in s.upper() for s in r.asked)
    r.asked.clear()
    one = client.get("/api/research/seasonality/SPY")
    assert one.status_code == 200 and r.asked == ["SPY"]
    body = one.json()
    assert body["ticker"] == "SPY" and body["source"] == "UCT daily bar store, close to close"
    assert len(body["months"]) == 12 and len(body["weekdays"]) == 5 and "funds" not in body
    # the two are two routes, matched by their own paths
    paths = {rt.path: rt.endpoint.__name__ for rt in route.router.routes}
    assert paths == {"/api/research/seasonality/{sym}": "seasonality",
                     "/api/research/seasonality-board": "seasonality_board"}
    for rt in route.router.routes:
        assert (rt.path_regex.match(URL) is not None) == (rt.path == URL)
        assert (rt.path_regex.match("/api/research/seasonality/SPY") is not None) == (rt.path != URL)


def test_the_board_takes_no_parameters_and_is_a_plain_def(client, monkeypatch, reads):
    reads()
    monkeypatch.setenv(FLAG, "1")
    board = next(rt for rt in route.router.routes if rt.path == URL)
    assert board.methods == {"GET"}
    assert board.dependant.query_params == [] and board.dependant.path_params == []
    assert not inspect.iscoroutinefunction(route.seasonality_board)
    assert client.get(URL + "?sym=NVDA&today=2020-01-01").json()["et_date"] == client.get(URL).json()["et_date"]


def test_a_cold_board_is_a_200_that_says_pending_never_a_503(client, monkeypatch, reads):
    reads(default=route.HistoryPending("x"))
    monkeypatch.setenv(FLAG, "1")
    resp = client.get(URL)
    assert resp.status_code == 200
    body = resp.json()
    assert body["complete"] is False and {f["status"] for f in body["funds"]} == {"pending"}
    assert all("months" not in f for f in body["funds"])


# ── held(): the read-only accessor (the UCT Agent's read; it never builds) ────────────────────

def test_held_is_none_until_the_route_has_built_and_never_builds_itself(reads, monkeypatch):
    r = reads()
    built = []
    real = sb.build
    monkeypatch.setattr(sb, "build", lambda day=None: built.append(day) or real(day))
    assert sb.held(NOV) is None and built == [] and r.asked == []      # nothing held: said, not built, nothing read
    board = sb.serve(NOV, wait_s=10)
    assert built == [NOV] and sb.held(NOV) is board                    # the very answer the route serves
    assert built == [NOV] and len(r.asked) == 15


def test_held_never_takes_the_build_lock(reads):
    reads()
    board = sb.serve(NOV, wait_s=10)
    assert sb._build_lock.acquire(timeout=1)                           # a build is "running"
    try:
        done = []
        t = threading.Thread(target=lambda: done.append(sb.held(NOV)), daemon=True)
        t.start()
        t.join(2)
        assert done == [board]                                         # answered at once, lock or no lock
    finally:
        sb._build_lock.release()


def test_held_follows_the_reuse_rule_another_day_or_a_stale_unfinished_board_is_nothing_held(reads, monkeypatch):
    r = reads(XLK=route.HistoryPending("XLK"))
    clock = {"t": 1000.0}
    monkeypatch.setattr(sb, "_clock", lambda: clock["t"])
    board = sb.serve(NOV, wait_s=10)
    assert board["settled"] is False and sb.held(NOV) is board
    clock["t"] += sb.INCOMPLETE_REUSE_S + 1                            # the route would rebuild it now
    assert sb.held(NOV) is None and len(r.asked) == 15                 # held() says nothing held, and reads nothing
    r.by_sym.pop("XLK")
    settled = sb.serve(NOV, wait_s=10)
    clock["t"] += 6 * 3600
    assert settled["settled"] is True and sb.held(NOV) is settled      # a settled board is held all day
    assert sb.held(NOV + dt.timedelta(days=1)) is None                 # and it is not the next day's board
    assert len(r.asked) == 30


def test_held_reads_the_new_york_date_when_no_day_is_given(reads, monkeypatch):
    reads()
    board = sb.serve(NOV, wait_s=10)
    monkeypatch.setattr(sb, "_now_et", lambda: dt.datetime.combine(NOV, dt.time(9, 0), tzinfo=session_calendar.ET))
    assert sb.held() is board
    monkeypatch.setattr(sb, "_now_et", lambda: dt.datetime.combine(NOV + dt.timedelta(days=1), dt.time(0, 5), tzinfo=session_calendar.ET))
    assert sb.held() is None


# ── speed pass (2026-11-23): the request never waits on the build ─────────────────────────────
# Live, the board took over 30 seconds and a member got nothing: the request ran the build itself
# (fifteen 8,000-bar daily reads, each of which can take the bar store's synchronous full-history
# fetch). The build now runs on ONE background thread; the request answers at once with what is
# held for today, else every fund pending, and the panel asks again.

class SlowReads(Reads):
    """`_daily_bars` that blocks every read until `release` is set (a cold bar store, invented)."""

    def __init__(self, default=EIGHT, **by_sym):
        super().__init__(default, **by_sym)
        self.started, self.release = threading.Event(), threading.Event()

    def __call__(self, sym):
        self.started.set()
        assert self.release.wait(20)
        return super().__call__(sym)


def _build_threads():
    return [t for t in threading.enumerate() if t.name == sb.BUILD_THREAD and t.is_alive()]


def _within(seconds, fn):
    """`fn()` on its own thread, given `seconds`: `(answer, took)`, or a failure at once when it is
    still running then (a request that waits on the build fails here, it never hangs the test)."""
    box = {}
    t0 = time.monotonic()
    t = threading.Thread(target=lambda: box.__setitem__("out", fn()), daemon=True)
    t.start()
    t.join(seconds)
    assert not t.is_alive(), f"the request was still waiting after {seconds} s"
    return box["out"], time.monotonic() - t0


def test_a_cold_board_answers_at_once_and_builds_on_one_background_thread(monkeypatch):
    slow = SlowReads()
    monkeypatch.setattr(route, "_daily_bars", slow)
    try:
        first, took = _within(2.0, lambda: sb.serve(NOV))
        assert took < 0.5, took                                       # the build is far slower than this
        assert first["building"] is True and [f["status"] for f in first["funds"]] == ["pending"] * 15
        assert slow.started.wait(10) and len(_build_threads()) == 1
        again, took = _within(2.0, lambda: sb.serve(NOV))             # a second member, the build still running
        assert took < 0.5 and again["building"] is True
        assert len(_build_threads()) == 1 and slow.asked == []        # one build; nobody read a second time
    finally:
        slow.release.set()
    sb.drain(10)
    built = sb.serve(NOV)
    assert built["complete"] is True and "building" not in built and len(slow.asked) == 15
    assert sb.serve(NOV) is built and len(slow.asked) == 15           # held: nothing read again


def test_the_route_answers_a_cold_board_at_once(client, monkeypatch):
    slow = SlowReads()
    monkeypatch.setattr(route, "_daily_bars", slow)
    monkeypatch.setenv(FLAG, "1")
    try:
        resp, took = _within(3.0, lambda: client.get(URL))
        assert resp.status_code == 200 and took < 2.0, took
        body = resp.json()
        assert body["building"] is True and {f["status"] for f in body["funds"]} == {"pending"}
    finally:
        slow.release.set()
    sb.drain(10)
    assert client.get(URL).json()["complete"] is True


def test_the_board_built_off_the_request_has_the_same_figures_as_a_build_on_the_request(reads, monkeypatch):
    reads(QQQ=THREE, XLK=route.HistoryPending("XLK"), XLF=route.NoDailyHistory("XLF"))
    direct = sb.build(NOV)                                            # what the request used to compute itself
    sb.serve(NOV)
    sb.drain(10)
    served = sb.serve(NOV)
    assert {k: v for k, v in served.items() if k != "as_of"} == {k: v for k, v in direct.items() if k != "as_of"}


def test_a_waiter_given_time_gets_the_built_board(reads):
    reads()
    board = sb.serve(NOV, wait_s=10)
    assert board["complete"] is True and sb.serve(NOV) is board


def test_a_build_that_blows_up_is_never_held_and_the_next_request_starts_another(reads, monkeypatch):
    reads()
    real = sb.build
    monkeypatch.setattr(sb, "build", lambda *a, **k: (_ for _ in ()).throw(ValueError("invented")))
    out = sb.serve(NOV, wait_s=10)
    assert out["building"] is True and sb._held is None               # said as still being read; nothing held
    sb.drain(10)
    assert not _build_threads() and not sb._build_lock.locked()       # no build left running, the lock free
    monkeypatch.setattr(sb, "build", real)
    assert sb.serve(NOV, wait_s=10)["complete"] is True


# ── the copy on this server's disk (a restart answers at once for the rest of the day) ──────────

@pytest.fixture
def disk(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    return tmp_path / sb.DISK[0] / sb.DISK[1]


def _restart():
    """A new process: memory forgotten, the disk kept."""
    sb.reset()


def test_a_settled_board_is_kept_on_disk_and_served_at_once_after_a_restart_the_same_day(reads, disk):
    r = reads()
    board = sb.serve(NOV, wait_s=10)
    assert disk.exists() and board["settled"] is True
    _restart()
    r.asked.clear()
    t0 = time.monotonic()
    again = sb.serve(NOV)
    assert time.monotonic() - t0 < 0.5
    assert again == board and "building" not in again and r.asked == []
    assert not _build_threads()                                       # settled for the day: nothing rebuilt
    assert sb.held(NOV) == board                                      # the agent's read sees it too


def test_the_disk_copy_is_never_served_for_another_day(reads, disk, monkeypatch):
    r = reads()
    sb.serve(NOV, wait_s=10)
    _restart()
    assert sb.held(NOV + dt.timedelta(days=1)) is None                # the agent's read: nothing held for that day
    slow = SlowReads()
    monkeypatch.setattr(route, "_daily_bars", slow)
    try:
        nxt = sb.serve(NOV + dt.timedelta(days=1))
        assert nxt["building"] is True and nxt["et_date"] == "2026-11-21"
    finally:
        slow.release.set()
    sb.drain(10)
    assert len(slow.asked) == 15 and len(r.asked) == 15
    assert sb.serve(NOV + dt.timedelta(days=1))["et_date"] == "2026-11-21"


def test_an_unsettled_disk_copy_is_served_for_today_while_a_new_build_runs(reads, disk, monkeypatch):
    reads(XLC=route.HistoryPending("XLC"))
    stale = sb.serve(NOV, wait_s=10)
    assert stale["settled"] is False
    _restart()
    assert sb.held(NOV) is None                                       # past its minute: the agent is told nothing held
    slow = SlowReads()                                                # the full history has arrived since; reads are slow
    monkeypatch.setattr(route, "_daily_bars", slow)
    try:
        first = sb.serve(NOV)
        assert first == stale and "building" not in first             # today's board at once, not every fund pending
    finally:
        slow.release.set()
    sb.drain(10)
    healed = sb.serve(NOV)
    assert healed["complete"] is True and len(slow.asked) == 15


def test_a_disk_copy_for_another_fund_list_or_version_or_in_a_bad_shape_is_ignored(reads, disk, monkeypatch):
    import json
    reads()
    board = sb.serve(NOV, wait_s=10)
    doc = json.loads(disk.read_text(encoding="utf-8"))
    assert board["settled"] is True                                   # a good copy WOULD be held all day
    for bad in ({**doc, "v": doc["v"] + 1},
                {**doc, "answer": {**board, "funds": board["funds"][1:]}},
                {**doc, "answer": {**board, "min_years": board["min_years"] + 1}},
                {**doc, "answer": {**board, "et_date": "2026-11-19"}},
                {**doc, "answer": "not a board"},
                ["not", "a", "document"],
                "{ not json"):
        disk.write_text(bad if isinstance(bad, str) else json.dumps(bad), encoding="utf-8")
        _restart()
        assert sb.held(NOV) is None, bad                              # read only: the copy is not taken
    slow = SlowReads()
    monkeypatch.setattr(route, "_daily_bars", slow)
    try:
        assert sb.serve(NOV)["building"] is True                      # so the route answers every fund pending
    finally:
        slow.release.set()


def test_a_failed_build_is_never_written_to_disk(reads, disk, monkeypatch):
    reads()
    monkeypatch.setattr(sb, "build", lambda *a, **k: (_ for _ in ()).throw(ValueError("invented")))
    sb.serve(NOV, wait_s=10)
    sb.drain(10)
    assert not disk.exists() and sb._held is None


def test_the_held_board_is_small(reads):
    import json
    reads()
    board = sb.serve(NOV, wait_s=10)
    assert len(json.dumps(board)) < 64_000                            # one board, about 20 kB of JSON
