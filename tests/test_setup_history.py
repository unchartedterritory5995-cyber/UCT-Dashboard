"""SETH, the held half and the routes (`api/services/setup_history.py`, `api/routers/setup_history.py`):
the weekly build (one stock's bars at a time, inside the quiet span, held in memory and on disk), the
one-stock read, and the two paid routes.

Every bar, symbol and episode here is INVENTED; no test reads a real store or calls a vendor.
"""
from __future__ import annotations

import gc
import inspect
import pathlib
import random
import weakref
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import setup_history as route
from api.services import setup_history as S
from api.services import setup_history_calc as C
from api.services.market_intel import price_reads

ROOT = pathlib.Path(__file__).resolve().parents[1]
FREE_USER = {"id": "seh-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "seh-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}

def _et(y, m, d, hh=12, mm=0):
    from api.services.market_history import ET as _ET
    return datetime(y, m, d, hh, mm, tzinfo=_ET)


SATURDAY = _et(2031, 6, 7, 10)          # a Saturday: quiet all day
TUESDAY_NOON = _et(2031, 6, 10, 12)     # a weekday in the busy span
TUESDAY_NIGHT = _et(2031, 6, 10, 21)    # a weekday evening in the quiet span


def _weekdays(n, start=date(2029, 1, 1)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


DAYS = _weekdays(900)
KEY = DAYS[-1]


def _rows(seed, n=900):
    """`price_reads.daily_bars` rows `(day, open, high, low, close, volume)`, invented."""
    rng = random.Random(seed)
    out, c = [], 30.0
    for i, d in enumerate(DAYS[-n:]):
        g = rng.gauss(0, 0.006) + (rng.choice((-1, 1)) * 0.06 if i % 17 == 16 else 0.0)
        o = c * (1 + g)
        cl = max(o * (1 + rng.gauss(0.0006, 0.02)), 0.5)
        out.append((d, round(o, 4), round(max(o, cl) * 1.01, 4), round(min(o, cl) * 0.99, 4), round(cl, 4),
                    float(rng.randint(5, 60) * 1000)))
        c = cl
    return out


def _market(status="ok"):
    if status != "ok":
        return {"status": status}
    eps = [{"peak": {"date": DAYS[600], "close": 100.0}, "trough": {"date": DAYS[640], "close": 85.0}},
           {"peak": {"date": DAYS[300], "close": 90.0}, "trough": {"date": DAYS[360], "close": 70.0}}]
    return {"status": "ok", "built_at": "2031-06-06T00:20:00+00:00", "definition": {"text": "Invented definition."},
            "indexes": {"SPX": {"state": "ok", "first": DAYS[0], "last": KEY, "episodes": eps}}}


SYMS = ["QZSA", "QZSB", "QZSC"]


@pytest.fixture(autouse=True)
def _fresh(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    S.reset_for_tests()
    monkeypatch.setattr(S, "_universe", lambda: list(SYMS))
    monkeypatch.setattr(S, "_market", lambda wait_s: _market())
    monkeypatch.setattr(S, "evening_key", lambda now: KEY)
    monkeypatch.setattr(S, "now_et", lambda: SATURDAY)
    monkeypatch.setattr(S, "HISTORY_YEARS", 2)
    yield
    S._STUDY.drain(10)
    S._STOCK.drain(10)
    S.reset_for_tests()


def _reader(seen=None):
    def read(sym, max_bars=None):
        if seen is not None:
            seen.append((sym, max_bars))
        if sym.endswith("X"):
            return {"status": "unavailable", "reason": "no_price_history", "symbol": sym}
        rows = _rows(SYMS.index(sym) + 1 if sym in SYMS else 9)
        return {"status": "ok", "symbol": sym, "bars": rows[-max_bars:] if max_bars else rows}
    return read


# ── the clock ──────────────────────────────────────────────────────────────────────────────────

def test_the_week_starts_on_saturday_new_york_time():
    assert S.week_key(_et(2031, 6, 7, 0, 1)) == "2031-06-07"     # Saturday
    assert S.week_key(_et(2031, 6, 8, 23)) == "2031-06-07"       # Sunday
    assert S.week_key(_et(2031, 6, 13, 21)) == "2031-06-07"      # the Friday after
    assert S.week_key(_et(2031, 6, 6, 23, 59)) == "2031-05-31"   # the Friday before


def test_a_build_may_start_only_inside_the_quiet_span_with_room_left():
    assert S.build_window_open(SATURDAY)
    assert S.build_window_open(TUESDAY_NIGHT)
    assert not S.build_window_open(TUESDAY_NOON)
    assert not S.build_window_open(_et(2031, 6, 10, 6, 30))       # quiet now, busy within the margin
    assert S.build_window_open(_et(2031, 6, 10, 5, 30))


def test_the_window_and_the_bounded_read_cover_the_years_and_the_longest_warm_up():
    assert S.window_start("2031-06-06", 10) == "2021-06-06"
    assert S.read_sessions(10) == 10 * 262 + max(s.warmup for s in C.LIBRARY) + 20


# ── the build ──────────────────────────────────────────────────────────────────────────────────

def test_the_build_reads_every_stock_once_through_the_bounded_read_and_says_what_it_rests_on(monkeypatch):
    seen = []
    monkeypatch.setattr(S, "_read_bars", _reader(seen))
    pauses = []
    ans, note = S.build_study(symbols=SYMS + ["QZSX"], pause=pauses.append)
    assert [s for s, _m in seen] == SYMS + ["QZSX"]
    assert {m for _s, m in seen} == {S.read_sessions()}
    assert pauses == [S.YIELD_S] * 4                              # one sleep per stock, quiet span
    assert ans["status"] == "ok" and ans["built_for"] == "2031-06-07" and ans["session"] == KEY
    assert ans["universe"]["caveat"] == C.bt._SURVIVORSHIP and ans["universe"]["survivorship_bias"] is True
    assert ans["universe"]["symbols_read"] == 3 and ans["universe"]["symbols_not_held"] == 1
    assert ans["method"]["phase"] == S.HINDSIGHT and "hindsight" in ans["phases"]["hindsight"]
    assert ans["method"]["one_signal_per_run"] == S.ONE_PER_RUN and ans["method"]["fill"] == "next_bar_open"
    assert ans["window"]["from"] == S.window_start(KEY) and ans["window"]["years"] == 2
    assert [s["id"] for s in ans["setups"]] == [s.id for s in C.LIBRARY]
    for s in ans["setups"]:
        assert [g["phase"] for g in s["groups"]] == list(C.GROUPS)
        for g in s["groups"]:
            for h in ("5", "20", "60"):
                assert isinstance(g["horizons"][h]["n"], int)     # every number says what it rests on
    assert ans["dropped"] and all(d["why"] for d in ans["dropped"])
    assert "symbols=4" in note


def test_the_build_never_holds_two_stocks_bars_at_once(monkeypatch):
    """⛔ THE MEMORY RULE (the live web process sits near 2.8 GB): a stock's bars, as read and as handed
    to the evaluator, are let go before the next stock is read."""
    alive = []

    class Rows(list):
        pass

    class Bars(list):
        pass

    read = _reader()

    def tracked_read(sym, max_bars=None):
        gc.collect()
        still = [r for r in alive if r() is not None]
        assert not still, f"{len(still)} earlier stock(s) still held when {sym} was read"
        got = read(sym, max_bars)
        if got.get("bars"):
            got["bars"] = Rows(got["bars"])
            alive.append(weakref.ref(got["bars"]))
        return got

    real_dicts = S.bar_dicts

    def tracked_dicts(rows, key):
        out = Bars(real_dicts(rows, key))
        alive.append(weakref.ref(out))
        return out

    monkeypatch.setattr(S, "_read_bars", tracked_read)
    monkeypatch.setattr(S, "bar_dicts", tracked_dicts)
    ans, _note = S.build_study(symbols=SYMS * 3, pause=lambda s: None)
    assert ans["universe"]["symbols_read"] == 9
    assert len(alive) == 18                                     # both shapes were tracked for every stock


def test_with_no_index_declines_held_the_build_stops_and_says_so(monkeypatch):
    monkeypatch.setattr(S, "_read_bars", _reader())
    monkeypatch.setattr(S, "_market", lambda wait_s: _market("computing"))
    with pytest.raises(S.held_build.Stop) as stop:
        S.build_study(symbols=SYMS, pause=lambda s: None)
    assert stop.value.state == "unavailable" and stop.value.reason == "index_not_held"


def test_a_build_that_runs_into_the_trading_day_sleeps_longer(monkeypatch):
    monkeypatch.setattr(S, "_read_bars", _reader())
    clock = iter([SATURDAY, TUESDAY_NOON, TUESDAY_NOON, TUESDAY_NOON, TUESDAY_NOON])
    monkeypatch.setattr(S, "now_et", lambda: next(clock))
    pauses = []
    S.build_study(symbols=SYMS, pause=pauses.append)
    assert pauses == [S.YIELD_BUSY_S] * 3


# ── held, weekly, never built on the request ──────────────────────────────────────────────────

def test_outside_the_quiet_span_with_nothing_held_the_answer_is_waiting_and_nothing_builds(monkeypatch):
    calls = []
    monkeypatch.setattr(S, "_read_bars", lambda *a, **k: calls.append(a) or {"status": "unavailable"})
    monkeypatch.setattr(S, "now_et", lambda: TUESDAY_NOON)
    ans = S.get_study()
    assert ans["status"] == "waiting" and "20:15" in ans["detail"]
    S._STUDY.drain(2)
    assert calls == [] and S.held_study() is None


def test_in_the_quiet_span_the_first_request_answers_computing_and_the_one_build_fills_it(monkeypatch):
    monkeypatch.setattr(S, "_read_bars", _reader())
    first = S.get_study()
    assert first["status"] == "computing"
    S._STUDY.drain(30)
    held = S.get_study()
    assert held["status"] == "ok" and held["refreshing"] is False and held["built_for"] == "2031-06-07"


def test_a_held_study_is_rebuilt_once_a_week_and_only_in_the_quiet_span(monkeypatch, tmp_path):
    monkeypatch.setattr(S, "_read_bars", _reader())
    S.get_study()
    S._STUDY.drain(30)
    built = []
    monkeypatch.setattr(S, "build_study", lambda previous=None, **k: built.append(1) or (S.held_study(), "again"))
    monkeypatch.setattr(S, "now_et", lambda: SATURDAY + timedelta(days=2))     # the Monday after: same week
    assert S.get_study()["status"] == "ok"
    S._STUDY.drain(5)
    monkeypatch.setattr(S, "now_et", lambda: _et(2031, 6, 16, 12))             # next week, trading hours
    assert S.get_study()["built_for"] == "2031-06-07"
    S._STUDY.drain(5)
    assert built == []
    monkeypatch.setattr(S, "now_et", lambda: _et(2031, 6, 16, 21))             # next week, evening
    assert S.get_study()["status"] == "ok"                                     # the held answer, at once
    S._STUDY.drain(5)
    assert built == [1]


def test_the_study_survives_a_restart_from_disk_and_a_changed_library_is_not_served(monkeypatch, tmp_path):
    monkeypatch.setattr(S, "_read_bars", _reader())
    S.get_study()
    S._STUDY.drain(30)
    assert (tmp_path / "setup_history" / "setup_history_v1.json").exists()
    S.reset_for_tests()
    monkeypatch.setattr(S, "now_et", lambda: TUESDAY_NOON)
    assert S.get_study()["status"] == "ok"                                     # from disk, in trading hours
    S.reset_for_tests()
    monkeypatch.setattr(S, "library_version", lambda: "another")
    assert S.get_study()["status"] == "waiting"                               # not served as if it were this one


# ── one stock ──────────────────────────────────────────────────────────────────────────────────

def test_one_stock_lists_its_signals_newest_first_and_attaches_the_universe_line(monkeypatch):
    monkeypatch.setattr(S, "_read_bars", _reader())
    S.get_study()
    S._STUDY.drain(30)
    ans = S.get_stock("QZSA")
    if ans["status"] == "computing":
        S._STOCK.drain(10)
        ans = S.get_stock("QZSA")
    assert ans["status"] == "ok" and ans["symbol"] == "QZSA" and ans["session"] == KEY
    rows = ans["signals"]
    assert rows and rows[0]["date"] >= rows[-1]["date"]
    assert ans["phases"]["state"] == "ok" and ans["phases"]["hindsight"] == S.HINDSIGHT
    u = ans["universe"]
    assert u["state"] == "ok" and u["note"] == C.bt._SURVIVORSHIP
    for r in rows:
        assert f"{r['setup']}|{r['phase'] or 'all'}" in u["lines"]


def test_one_stocks_list_is_cut_from_the_oldest_end_and_says_so(monkeypatch):
    monkeypatch.setattr(S, "_read_bars", _reader())
    monkeypatch.setattr(S, "STOCK_MAX_ROWS", 3)
    ans = S.get_stock("QZSB")
    if ans["status"] == "computing":
        S._STOCK.drain(10)
        ans = S.get_stock("QZSB")
    assert ans["total"] > 3 and ans["shown"] == 3 and ans["cut"] == "oldest" and len(ans["signals"]) == 3
    newest = C.stock_signals(S.bar_dicts(_rows(2), KEY), S.phase_source(_market())["map"], DAYS[0], KEY)["signals"][:3]
    assert ans["signals"] == newest                                            # the newest three, never the oldest
    assert ans["universe"]["state"] in ("computing", "ok")


def test_a_stock_with_no_prices_says_not_held_and_its_read_is_held_for_the_session(monkeypatch):
    seen = []
    monkeypatch.setattr(S, "_read_bars", _reader(seen))
    ans = S.get_stock("QZSX")
    if ans["status"] == "computing":
        S._STOCK.drain(10)
        ans = S.get_stock("QZSX")
    assert ans["status"] == "not_held" and "QZSX" in ans["detail"]
    S.get_stock("QZSX")
    assert [s for s, _m in seen] == ["QZSX"]
    assert seen[0][1] is None                                                  # one stock: its whole history


def test_outside_the_quiet_span_the_universe_line_waits_while_the_stock_answers(monkeypatch):
    monkeypatch.setattr(S, "_read_bars", _reader())
    monkeypatch.setattr(S, "now_et", lambda: TUESDAY_NOON)
    ans = S.get_stock("QZSC", now=TUESDAY_NOON)
    if ans["status"] == "computing":
        S._STOCK.drain(10)
        ans = S.get_stock("QZSC", now=TUESDAY_NOON)
    assert ans["status"] == "ok" and ans["universe"]["state"] == "waiting"


# ── the bounded read ───────────────────────────────────────────────────────────────────────────

def test_daily_bars_reads_only_the_newest_rows_when_asked_and_all_by_default(monkeypatch):
    asked = []
    raw = [{"t": d, "o": 10.0, "h": 11.0, "l": 9.0, "c": 10.0, "v": 5.0} for d in DAYS[:5]]
    monkeypatch.setattr(price_reads, "_load_bars", lambda s, n=price_reads.MAX_BARS: asked.append(n) or raw[-n:])
    assert len(price_reads.daily_bars("QZSA")["bars"]) == 5
    assert len(price_reads.daily_bars("QZSA", max_bars=2)["bars"]) == 2
    price_reads.daily_bars("QZSA", max_bars=10 ** 9)
    assert asked == [price_reads.MAX_BARS, 2, price_reads.MAX_BARS]


# ── the routes ─────────────────────────────────────────────────────────────────────────────────

def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_two_routes_are_paid_gets_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    asked = []
    monkeypatch.setattr(S, "get_study", lambda: asked.append("study") or {"status": "ok"})
    monkeypatch.setattr(S, "get_stock", lambda sym: asked.append(sym) or {"status": "ok", "symbol": sym})
    assert sorted(r.path for r in route.router.routes) == ["/api/research/setup-history",
                                                           "/api/research/setup-history/{ticker}"]
    for r in route.router.routes:
        assert r.methods == {"GET"} and route.require_paid in {d.call for d in r.dependant.dependencies}
    assert route.require_paid.__module__ == "api.routers.setup_history"
    for path in ("/api/research/setup-history", "/api/research/setup-history/NVDA"):
        assert _client(None).get(path).status_code == 401
        refused = _client(FREE_USER).get(path)
        assert refused.status_code == 402 and refused.json() == {"detail": "How setups acted requires a paid plan"}
    assert asked == []
    assert _client(PAID_USER).get("/api/research/setup-history").json() == {"status": "ok"}
    assert _client(PAID_USER).get("/api/research/setup-history/nvda").json() == {"status": "ok", "symbol": "NVDA"}
    assert _client(PAID_USER).get("/api/research/setup-history/$$$").status_code == 400
    assert asked == ["study", "NVDA"]


def test_the_handlers_are_plain_defs_and_the_router_is_mounted():
    assert not inspect.iscoroutinefunction(route.get_setup_history)
    assert not inspect.iscoroutinefunction(route.get_setup_history_stock)
    main = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    assert "from api.routers import setup_history as setup_history_router" in main
    assert "app.include_router(setup_history_router.router)" in main
