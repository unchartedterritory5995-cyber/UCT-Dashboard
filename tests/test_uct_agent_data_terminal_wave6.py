"""MD-1 kinds of terminal data wave 6: `seasonality.stock`, `seasonality.board`, `options.tideHistory`,
`options.oiChange`, `rates.treasury` — the Agent half of the SEAS, SEASB, TIDEH, OIC and RATES terminal panels.

No network and no real store: the bar store, the board's daily read, the options log and the Treasury's website are
stand-ins, and every held answer is put where its service keeps it BY the service (the board's own `serve`, the tide
store's own `_store`, the open-interest pair's own build, the yields' own `assemble`). Every number is invented.
Pinned per kind: an ok read (envelope conformance, every number the service's own, the data's own date as `as_of`
with the read time beside it), a missing number null and never 0, the cut stated and from which end, `unavailable`
kept apart from a healthy answer with each state said in its own note, a malformed request refused before any read,
a failing service answered `unavailable`, and THE BUDGET RULE: no read starts a build, a fetch, a capture or a thread
or reaches a vendor, with the member route's own reader shown to do exactly that in the same state (so the rail can
fail). For all five: registered dark, model-isolated, dormant until armed one by one. The cross-file facts (the
services' own constants, the panels' own row counts) are read from the other file rather than retyped. And the
contract: MD-1 §4.15 quotes every note these adapters emit, verbatim.
"""
from __future__ import annotations

import contextlib
import datetime as dt
import gzip
import csv
import os
import re
import shutil
import threading
import time
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from api.routers import bars as bars_router
from api.routers import live_prices
from api.routers import seasonality as seas_route
from api.services import bars_fetch, bars_sanitize, bars_sqlite, massive, massive_adapter
from api.services import options_universe_log as oplog
from api.services import seasonality as seas
from api.services import seasonality_board as sb
from api.services import treasury_yields as ty
from api.services.options_analytics import market_tide as mt
from api.services.options_analytics import oi_change as oic
from api.services.options_analytics import tide_history as th
from api.services.research import options_screener as osc
from api.services.uct_agent import turn as agent_turn
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import oi_change_read as oi
from api.services.uct_agent.marketdata import seasonality_board_read as sbr
from api.services.uct_agent.marketdata import seasonality_stock as ss
from api.services.uct_agent.marketdata import sessions
from api.services.uct_agent.marketdata import tide_history_read as tr
from api.services.uct_agent.marketdata import treasury_read as trs

#: the member route's own daily-bar reader, kept before any fixture replaces it (the contrast rail calls the real one)
ROUTE_DAILY_BARS = seas_route._daily_bars

REPO = Path(__file__).resolve().parents[1]
MODULES = (ss, sbr, tr, oi, trs)
KINDS = tuple(m.KIND for m in MODULES)
#: this wave's isolation decisions (ADR-005): all five. A kind leaving this set is an owner decision.
ISOLATED = set(KINDS)
GOOD = {ss.KIND: {"symbol": "AAA"}, sbr.KIND: {}, tr.KIND: {}, oi.KIND: {"symbol": "AAA"}, trs.KIND: {}}
ACTIONS = {"stock.seasonality", "stock.seasonalityBoard", "stock.tideHistory", "stock.oiChange", "stock.treasuryYields"}
PANELS = REPO / "app/src/pages/terminal/panels"
DOC = REPO / "docs/agent/program/contracts/MD-1-market-data.md"
REGISTER = REPO / "docs/terminal-research/09-security-licensing-cost/licensing-register.md"
ET = ZoneInfo("America/New_York")
LAST = 20261118                                         # the newest completed session (a Wednesday)
LAST_DAY, PRIOR_DAY, TODAY = "2026-11-18", "2026-11-17", dt.date(2026, 11, 19)
NOW_ET = dt.datetime(2026, 11, 19, 10, 0, tzinfo=ET)   # Thursday morning: Wednesday is the newest completed session
#: the threads the member routes start when they hold nothing (the services' own thread names)
BUILD_THREADS = ("options-oi-change", "rates-data-build", "seasonality-board-build")
#: every module that holds a provider client under its own name
PROVIDER_DOORS = (massive, bars_fetch, live_prices)
#: what a turn must never reach, per service: every builder, job starter, fetch, capture and route reader
FORBIDDEN = {
    bars_fetch: ("_get_bars_inner", "fetch_with_validation", "_fetch_daily", "_maybe_kick_deepfill", "_kick_cold_fetch",
                 "kick_snapshot_warm", "warm_bars_async", "_record_intraday_request"),
    bars_sanitize: ("_fetch_meta",),
    bars_router: ("serve_bars",),
    seas_route: ("_daily_bars",),
    sb: ("serve", "build", "read_fund", "placeholder"),
    th: ("capture", "run_capture_job", "_store"),
    mt: ("build", "get"),
    oic: ("oi_change", "_pair", "_build_bg", "prepare", "_drop_held", "_mirror_earlier"),
    ty: ("get_yields", "_start_job", "_build_bg", "build", "fetch_period", "_http_get"),
}
READS = [(ss.KIND, {"symbol": "AAA"}), (sbr.KIND, {}), (tr.KIND, {}), (tr.KIND, {"scope": "etfs", "rows": 3}),
         (oi.KIND, {"symbol": "AAA"}), (oi.KIND, {"symbol": "AAA", "side": "put", "rows": 1}), (trs.KIND, {})]


# ── the bar store (seasonality.stock) ────────────────────────────────────────────────────────────────────────────────
def _weekdays(first: dt.date, last: dt.date):
    d = first
    while d <= last:
        if d.weekday() < 5:
            yield d
        d += dt.timedelta(days=1)


def _bar_rows(first: str, last: str = LAST_DAY, feb=1.10):
    """One row per weekday as the store keeps it, (yyyymmdd, o, h, l, c, v). The close is flat except that it is
    multiplied by `feb` on the first weekday of every February: so February's month return is +10% every year and
    every other month's is 0, by hand."""
    out, close, month = [], 100.0, None
    for d in _weekdays(dt.date.fromisoformat(first), dt.date.fromisoformat(last)):
        if d.month == 2 and month != 2:
            close *= feb
        month = d.month
        out.append((int(d.strftime("%Y%m%d")), close, close, close, close, 1_000_000))
    return out


class Store:
    """Stands where `bars_sqlite.get_bars_before` stands, and records every read."""

    def __init__(self):
        self.rows: dict = {}
        self.calls: list = []
        self.complete: set = set()                     # symbols carrying the "this is all there is" marker
        self.fail = None

    def get_bars_before(self, ticker, tf, max_bars, to_key):
        self.calls.append((ticker, tf, max_bars, to_key))
        if self.fail is not None:
            raise self.fail
        return [r for r in self.rows.get(ticker, []) if r[0] <= to_key][-max_bars:]


# ── the board's daily read (seasonality.board) ───────────────────────────────────────────────────────────────────────
def _fund_series(years, start=2015, march=None):
    """Two bars a month for `years` whole years: February +10% every year, March `march[i]`% (default +1%), every
    other month flat (the board's own test series)."""
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


EIGHT, THREE = _fund_series(8), _fund_series(3)


class FundReads:
    """Stands where the board's daily read (`_daily_bars`) stands."""

    def __init__(self):
        self.default, self.by_sym, self.asked = EIGHT, {}, []

    def __call__(self, sym):
        self.asked.append(sym)
        hit = self.by_sym.get(sym, self.default)
        if isinstance(hit, BaseException):
            raise hit
        return hit


# ── the options log (options.oiChange) ───────────────────────────────────────────────────────────────────────────────
NEAR, FAR = "2026-11-20", "2026-12-18"


def _c(und, typ, strike, exp, *, oi_=1000, vol=100):
    occ = f"O:{und}{exp.replace('-', '')[2:]}{typ[0].upper()}{int(strike * 1000):08d}"
    return {"contract": occ, "underlying": und, "expiration": exp, "strike": strike, "type": typ, "open_interest": oi_,
            "iv": 0.5, "delta": 0.3, "gamma": 0.01, "theta": -0.02, "vega": 0.1, "bid": 1.0, "ask": 1.1, "last": 1.05,
            "volume": vol, "vwap": 1.05, "underlying_price": 100.0}


class Log:
    """A seeded local copy of the options log, its screen files made by the SAME `build_session` the job runs."""

    def __init__(self, root):
        self.root = str(root)
        self.store = osc.LocalStore(self.root)

    def day(self, session, rows):
        ydir = os.path.join(self.root, "options_log", session[:4])
        os.makedirs(ydir, exist_ok=True)
        src = os.path.join(ydir, f"{session}.contracts.csv.gz")
        with gzip.open(src, "wt", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=oplog.CONTRACT_FIELDS)
            w.writeheader()
            for r in rows:
                w.writerow(r)
        tmp = os.path.join(self.root, f"_build_{session}")
        os.makedirs(tmp, exist_ok=True)
        rec = osc.build_session(src, dt.date.fromisoformat(session), tmp)
        shutil.move(rec["screen_path"], os.path.join(ydir, f"{session}.screen.sqlite.gz"))
        shutil.rmtree(tmp)


def _two_days(log, newer=LAST_DAY, earlier=PRIOR_DAY):
    """AAA: a call up 600, a put down 500, a call unchanged, a put newly listed, a call that dropped out. BBB flat."""
    log.day(earlier, [_c("AAA", "call", 100, NEAR, oi_=1000, vol=700), _c("AAA", "put", 90, NEAR, oi_=2000, vol=450),
                      _c("AAA", "call", 110, FAR, oi_=300, vol=5), _c("AAA", "call", 120, "2026-11-17", oi_=40, vol=2),
                      _c("BBB", "call", 50, NEAR, oi_=10, vol=1)])
    log.day(newer, [_c("AAA", "call", 100, NEAR, oi_=1600, vol=11), _c("AAA", "put", 90, NEAR, oi_=1500, vol=22),
                    _c("AAA", "call", 110, FAR, oi_=300, vol=33), _c("AAA", "put", 80, FAR, oi_=250, vol=44),
                    _c("BBB", "call", 50, NEAR, oi_=10, vol=44)])


# ── the Treasury's website (rates.treasury) ──────────────────────────────────────────────────────────────────────────
BASE_YIELDS = {"1m": 4.35, "3m": 4.50, "6m": 4.20, "1y": 4.00, "2y": 3.70, "3y": 3.72, "5y": 3.80, "7y": 3.95,
               "10y": 4.10, "20y": 4.60, "30y": 4.70}
READ_AT = "2026-11-18T23:20:00+00:00"


def _curve_rows(newest=dt.date(2026, 11, 18), **newest_over):
    """Two years of weekday rows as the feed parser returns them, oldest first; `newest_over` changes the newest day."""
    rows = [{"date": d.isoformat(), "y": dict(BASE_YIELDS)} for d in _weekdays(dt.date(2024, 11, 1), newest)]
    rows[-1]["y"].update(newest_over)
    return rows


class Site:
    """Stands where the one reader of the Treasury's website stands. Any request is recorded, and fails."""

    def __init__(self):
        self.calls: list = []

    def get(self, params):
        self.calls.append(dict(params))
        raise AssertionError("the Treasury's website was asked")


# ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def _drain(timeout=10.0):
    """Wait for every background build a service started."""
    end = time.time() + timeout
    while time.time() < end:
        if not [t for t in threading.enumerate() if t.name in BUILD_THREADS and t.is_alive()]:
            return
        time.sleep(0.01)
    raise AssertionError("a background build did not finish")


class World:
    pass


@pytest.fixture(autouse=True)
def world(monkeypatch, tmp_path):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.setenv(gw.ISOLATED_ENV, "1")
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    w = World()
    # the calendar: Wednesday 2026-11-18 is the newest completed session, read on Thursday morning
    last = lambda now=None: LAST                                        # noqa: E731
    monkeypatch.setattr(sessions, "last_completed_session", last)
    monkeypatch.setattr(bars_fetch, "_last_closed_session_yyyymmdd", last)
    # the bar store
    w.store = Store()
    monkeypatch.setattr(bars_sqlite, "get_bars_before", w.store.get_bars_before)
    monkeypatch.setattr(bars_fetch, "_history_complete", lambda t, tf, bars=None: t in w.store.complete)
    # the board
    w.funds = FundReads()
    monkeypatch.setattr(seas_route, "_daily_bars", w.funds)
    monkeypatch.setattr(sb, "_now_et", lambda: NOW_ET)
    sb.reset()
    # the options log
    w.log = Log(tmp_path / "log")
    monkeypatch.setattr(osc, "_store_override", w.log.store)
    oic.reset()
    # the Treasury's website
    w.site = Site()
    monkeypatch.setattr(ty, "_http_get", w.site.get)
    monkeypatch.setattr(ty, "_pause", lambda s: None)
    monkeypatch.setattr(ty, "now_et", lambda: NOW_ET)
    ty.reset_for_tests()
    gw._reset_for_test(None)
    yield w
    _drain()
    sb.reset()
    oic.reset()
    ty.reset_for_tests()
    gw._reset_for_test(None)


@pytest.fixture
def work(monkeypatch):
    """Counts the work a turn must never cause: every provider client asked for, every request to the vendor adapter,
    and every thread started (by name)."""
    seen = {"provider": 0, "threads": []}
    real_start = threading.Thread.start

    def start(self):
        seen["threads"].append(self.name)
        return real_start(self)

    def client(*a, **kw):
        seen["provider"] += 1
        raise AssertionError("a provider client was asked for inside a turn")
    monkeypatch.setattr(threading.Thread, "start", start)
    for door in PROVIDER_DOORS:
        monkeypatch.setattr(door, "_get_client", client)
    for name in ("get", "get_pages"):
        monkeypatch.setattr(massive_adapter, name, client)
    return seen


def _close(world, work):
    """From here on a store read, a fund read, a website request, a provider client or a thread is the read's doing."""
    _drain()
    world.funds.asked.clear()
    world.site.calls.clear()
    work["threads"].clear()


def _quiet(world, work) -> bool:
    return world.funds.asked == [] and world.site.calls == [] and work == {"provider": 0, "threads": []}


def _hold_bars(world, sym="AAA", first="2014-11-03", last=LAST_DAY, complete=False):
    world.store.rows[sym] = _bar_rows(first, last)
    if complete:
        world.store.complete.add(sym)


def _hold_board(world, **by_sym):
    world.funds.by_sym = dict(by_sym)
    return sb.serve(wait_s=10)                                          # the route answers at once; this waits for its build


def _tide(session, i, unreadable=0):
    call, put = 4_000_000 + 100_000 * i, 1_500_000 + 250_000 * i
    return {"session": session, "minutes": [{"t": "09:31"}, {"t": "09:32"}], "prints_counted": 300 + i,
            "prints_unsigned": 40 + i, "prints_unreadable": unreadable, "data_through": "15:59",
            "totals": {"net_call_premium": call, "net_put_premium": put, "net_premium": call - put},
            "tape_versions": {"stocks": "v-invented-1"}}


def _hold_tide(days, scopes=mt.SCOPES, unreadable=()):
    """Store one row per day (oldest first) for each scope, through the store's own writer."""
    with contextlib.closing(th._connect()) as conn:
        conn.isolation_level = None
        for scope in scopes:
            for i, day in enumerate(days):
                stamp = f"{day}T21:31:{i % 60:02d}+00:00"
                assert th._store(conn, scope, _tide(day, i, 7 if day in unreadable else 0), stamp)["stored"]


TIDE_DAYS = [d.isoformat() for d in _weekdays(dt.date(2026, 10, 12), dt.date(2026, 11, 18))]      # 28 weekdays


def _hold_pair(world):
    _two_days(world.log)
    out = oic.oi_change("AAA", wait_s=10)
    _drain()
    assert out["status"] == "ok"
    return out


def _hold_curve(rows=None, check=None):
    """The yields answer, built by the service's own `assemble` and held where the service holds it."""
    held = ty.assemble(rows or _curve_rows(), read_at=READ_AT)
    with ty._lock:
        ty._state.update({"held": held, "loaded": True, "check": check})
    return held


_turn = iter(range(100_000))


def _read(kind, params=None, purpose="answer"):
    return gw.read(kind, GOOD[kind] if params is None else params, user_id=1, turn_id=f"w6-{next(_turn)}", purpose=purpose)


def _conforms(out, kind):
    assert env.validate_envelope(out) == [], out
    assert out["kind"] == kind
    assert out["provider_calls"] == 0                                # no kind of this wave ever spends a provider call
    if out["status"] in ("ok", "partial"):
        # MD-1 §3: a read may be LESS fresh than its kind declares, never fresher
        assert env.FRESHNESS.index(out["freshness"]) >= env.FRESHNESS.index(gw.registry().get(kind).freshness)
        assert out["freshness"] == "historical"
        assert out["as_of"] is not None
        assert not out["as_of"].startswith(TODAY.isoformat())           # the data's own date, never today
        assert out["isolated"] is True and out["data"]["isolated"] is True     # ADR-005 L2, stamped by the gateway
    else:
        assert out["data"] is None and out["notes"]


def _plain(v):
    """A read's data without the gateway's isolation stamps."""
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items() if k != "isolated"}
    return [_plain(x) for x in v] if isinstance(v, list) else v


def _made_from(template):
    """A pattern for the notes a template makes: its fixed text, with anything where a placeholder stands."""
    return re.compile(".+?".join(re.escape(p) for p in re.split(r"\{\w+\}", template)), re.S)


def _note(out, template):
    """The one note of `out` made from `template`."""
    hits = [n for n in out["notes"] if _made_from(template).fullmatch(n)]
    assert len(hits) == 1, (template, out["notes"])
    return hits[0]


def _lacks(out, template):
    return not [n for n in out["notes"] if _made_from(template).fullmatch(n)]


def _formed(world, sym="AAA"):
    """The store's rows for `sym` as the serve path's own normaliser forms them (it drops what it does not serve)."""
    with bars_sanitize.suppress_meta_warm():
        return bars_fetch._fmt_sqlite_bars(list(world.store.rows[sym]), "D", sym)


def _zeros(v, path=""):
    """Every place in `v` holding a number equal to 0 (not a bool)."""
    if isinstance(v, dict):
        return [p for k, x in v.items() for p in _zeros(x, f"{path}.{k}")]
    if isinstance(v, list):
        return [p for i, x in enumerate(v) for p in _zeros(x, f"{path}[{i}]")]
    return [path] if isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0 else []


# ── registration, dark by default, isolation ─────────────────────────────────────────────────────────────────────────
def test_all_five_kinds_are_registered_once_by_their_modules_and_all_five_are_isolated():
    r = gw.registry()
    for m in MODULES:
        k = r.get(m.KIND)
        assert k is not None and k.owner == "terminal-data" and k.category == "market", m.KIND
        assert k.validate is m.validate and k.description
        assert k.model_isolated is True, m.KIND
        assert "Shown to the member only" in k.description and "never today" in k.description, m.KIND
    assert {r.get(k).freshness for k in KINDS} == {"periodic"}       # none is ever declared live or delayed
    assert [r.get(k).max_symbols for k in KINDS] == [1, 0, 0, 1, 0]
    assert KINDS == ("seasonality.stock", "seasonality.board", "options.tideHistory", "options.oiChange", "rates.treasury")
    assert [m.SOURCE for m in MODULES] == ["uct-bars", "uct-bars", "uct-flow-tape", "uct-options-log", "us-treasury-par-curve"]
    # the five capabilities that read them are local-only on the server, by name
    assert ACTIONS <= set(agent_turn.LOCAL_ONLY_ACTIONS)


def test_dark_unless_the_gateway_is_on_and_the_kind_is_named(world, monkeypatch):
    ran = []
    monkeypatch.setattr(ss, "held_bars", lambda sym: ran.append("ss") or ([], LAST, False))
    monkeypatch.setattr(sbr, "held_answer", lambda: ran.append("sbr"))
    monkeypatch.setattr(tr, "held_answer", lambda scope, rows: ran.append("tr") or {})
    monkeypatch.setattr(oi, "held_answer", lambda sym, side: ran.append("oi") or (None, "not_held"))
    monkeypatch.setattr(trs, "held_answer", lambda: ran.append("trs") or (None, "not_held"))
    monkeypatch.setenv(gw.KINDS_ENV, "quote,themes,bars.daily,short.interest,short.list")
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0], kind
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS))
    monkeypatch.delenv(gw.DATA_ENV)
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind
    assert ran == []


def test_isolated_kinds_are_dormant_until_armed_by_name_and_answer_the_member_only(world, monkeypatch):
    _hold_curve()
    _hold_tide(TIDE_DAYS)
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, "")                       # listed in DATA_KINDS, not armed
    for kind in KINDS:
        out = _read(kind)
        assert out["status"] == "refused" and _plain(out["data"]) is None, kind
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, trs.KIND)                 # arming ONE arms one
    assert _read(trs.KIND)["status"] == "ok"
    for kind in KINDS[:-1]:
        assert _read(kind)["status"] == "refused", kind
    for purpose in ("research", "scan"):                                # never for a model's research
        assert _read(trs.KIND, purpose=purpose)["status"] == "refused"
    monkeypatch.setenv(gw.ISOLATED_KINDS_ENV, ",".join(sorted(ISOLATED)))
    assert _read(tr.KIND)["status"] == "ok"
    monkeypatch.delenv(gw.ISOLATED_ENV)                                 # the master switch turns all five off
    for kind in KINDS:
        assert _read(kind)["status"] == "refused", kind


def test_the_words_bounds_and_fields_are_the_services_and_the_panels_own():
    assert tr.SCOPES == mt.SCOPES and set(tr.SCOPE_WORDS) == set(mt.SCOPES)
    assert tr.MAX_ROWS == th.MAX_SESSIONS and tr.ROW_FIELDS == th._COLUMNS
    assert oi.SIDES == oic.SIDES and set(oi.SIDE_WORDS) == set(oic.SIDES) and oi.MAX_ROWS == oic.MAX_ROWS
    assert trs.HORIZONS == ty.HORIZONS and set(trs.HORIZON_WORDS) == set(ty.HORIZONS)
    assert ss.MONTH_FIELDS == sbr.MONTH_FIELDS == sb._MONTH_KEYS
    assert set(sbr.WITHOUT_WORDS) == {sb.PENDING, sb.NOT_HELD, sb.UNAVAILABLE}
    assert ss.VENDOR_FLOOR_YMD == 20030910
    # the default row counts are the panels' own first screens, read from the panel models
    tide_js = (PANELS / "tideHistoryModel.js").read_text(encoding="utf-8")
    oi_js = (PANELS / "oiChangeModel.js").read_text(encoding="utf-8")
    assert int(re.search(r"export const TIDE_ROWS_SHOWN = (\d+)", tide_js).group(1)) == tr.DEFAULT_ROWS
    assert int(re.search(r"export const OI_ROWS_SHOWN = (\d+)", oi_js).group(1)) == oi.DEFAULT_ROWS
    # each accessor this wave reads through says, in its own words, that it never builds
    for fn in (sb.held, oic.held_change, ty.held_answer):
        assert "READ ONLY" in fn.__doc__, fn.__name__
    assert "Reads the store only" in th.history.__doc__


# ── seasonality.stock ────────────────────────────────────────────────────────────────────────────────────────────────
def test_stock_reads_the_held_bars_with_every_number_the_services_own(world, work):
    _hold_bars(world)                                                   # 2014-11-03 .. 2026-11-18: twelve years
    world.store.rows["AAA"].append((20261119, 500.0, 500.0, 500.0, 500.0, 1))      # a session still trading
    _close(world, work)
    out = _read(ss.KIND, {"symbol": "$aaa"})
    _conforms(out, ss.KIND)
    assert out["status"] == "ok" and out["stale"] is False and _quiet(world, work)
    assert world.store.calls == [("AAA", "D", seas_route.DAILY_BARS, LAST)]        # one store read, up to the last close
    d = _plain(out["data"])
    with bars_sanitize.suppress_meta_warm():                           # the serve path's own normaliser, over the same rows
        bars = bars_fetch._fmt_sqlite_bars(world.store.rows["AAA"][:-1], "D", "AAA")
    assert 2900 < len(bars) <= len(world.store.rows["AAA"]) - 1
    own = seas.compute(bars)                                           # the service's own answer over the same bars
    assert d["months"] == [{k: m[k] for k in ss.MONTH_FIELDS} for m in own["months"]]
    assert d["weekdays"] == [{k: w[k] for k in ss.WEEKDAY_FIELDS} for w in own["weekdays"]]
    assert (d["covered_from"], d["covered_to"], d["full_months"], d["min_years"]) == (
        "2014-11-03", LAST_DAY, own["full_months"], seas.MIN_YEARS)
    feb = d["months"][1]                                               # by hand: +10% every February, twelve of them
    assert (feb["label"], feb["n"], feb["avg_pct"], feb["median_pct"], feb["pct_up"], feb["thin"]) == ("Feb", 12, 10.0, 10.0, 100, False)
    assert d["months"][10]["n"] == 11                                  # November 2026 is still running: not counted
    assert (d["ticker"], d["sessions"], d["first_bar"], d["last_bar"]) == ("AAA", len(bars), "2014-11-03", LAST_DAY)
    assert d["latest_completed_session"] == LAST_DAY and d["pre_vendor_floor"] is False
    # the data's own time, with the read time beside it
    assert out["as_of"] == "2026-11-18T21:00:00Z"                       # the 16:00 ET close of the newest bar
    assert d["read_at"] == out["fetched_at"] or d["read_at"][:16] == out["fetched_at"][:16]
    assert d["read_at"] != out["as_of"] and LAST_DAY in _note(out, ss.NOTE_AS_OF)
    assert _note(out, ss.NOTE_WHAT).startswith("AAA by calendar month") and ss.NOTE_COMPLETED in out["notes"]
    assert _lacks(out, ss.NOTE_THIN) and _lacks(out, ss.NOTE_EMPTY) and _lacks(out, ss.NOTE_PRE_FLOOR)
    assert out["coverage"] == {"evaluated": 12, "answered": 12, "dropped": 0, "not_computable": 0}


def test_stock_a_history_held_only_in_part_is_unavailable_never_a_short_record(world, work):
    _hold_bars(world, first="2024-11-01")                               # two years, no "this is all there is" marker
    _close(world, work)
    out = _read(ss.KIND)
    _conforms(out, ss.KIND)
    assert out["status"] == "unavailable" and _quiet(world, work)
    assert out["notes"] == [ss.NOTE_PARTIAL.format(symbol="AAA", first="2024-11-01", last=LAST_DAY,
                                                   sessions=len(_formed(world)))]
    # the rule is the member route's own function, asked with the same bars: the two cannot disagree
    asked = []
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(seas_route, "_history_is_partial", lambda sym, bars: asked.append((sym, len(bars))) or False)
        assert _read(ss.KIND)["status"] == "ok"
    assert asked == [("AAA", len(_formed(world)))] and len(_formed(world)) > 400
    # ten years of span is a real record with or without the marker (the route's rule)
    _hold_bars(world, first="2016-11-01")
    assert _read(ss.KIND)["status"] == "ok"


def test_stock_a_young_listing_keeps_its_thin_flags_and_an_empty_month_is_null_never_zero(world, work):
    _hold_bars(world, first="2026-04-01", complete=True)                # its whole history: May..October are full months
    _close(world, work)
    out = _read(ss.KIND)
    _conforms(out, ss.KIND)
    d = _plain(out["data"])
    assert out["status"] == "ok" and d["full_months"] == 6
    counted = [m for m in d["months"] if m["n"]]
    empty = [m for m in d["months"] if not m["n"]]
    assert [m["month"] for m in counted] == [5, 6, 7, 8, 9, 10] and all(m["thin"] is True and m["n"] == 1 for m in counted)
    assert len(empty) == 6 and all(m["thin"] is True for m in empty)
    for m in empty:                                                     # nothing counted: no figure, never a 0
        assert (m["avg_pct"], m["median_pct"], m["pct_up"]) == (None, None, None), m
    assert _note(out, ss.NOTE_THIN) == ss.NOTE_THIN.format(n=6, min_years=seas.MIN_YEARS)
    assert _note(out, ss.NOTE_EMPTY) == ss.NOTE_EMPTY.format(n=6)
    assert out["coverage"] == {"evaluated": 12, "answered": 6, "dropped": 0, "not_computable": 6}
    # less than one full month: nothing to state
    _hold_bars(world, first="2026-11-02", complete=True)
    out = _read(ss.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [ss.NOTE_TOO_SHORT.format(symbol="AAA")]


def test_stock_nothing_held_is_unavailable_and_no_fetch_is_started_the_routes_reader_starts_one(world, work, monkeypatch):
    served = []

    class Warming:
        status_code, body = 503, b'{"warming": true, "error": "warming"}'
    monkeypatch.setattr(bars_router, "serve_bars", lambda *a: served.append(a) or Warming())
    _close(world, work)
    out = _read(ss.KIND)
    _conforms(out, ss.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [ss.NOTE_NOT_HELD.format(symbol="AAA")]
    assert served == [] and _quiet(world, work)
    # the member route's own reader, in the same state, DOES go to the bar serve (which starts the deep fetch)
    assert ROUTE_DAILY_BARS is not seas_route._daily_bars              # the fixture's stand-in is not what is called here
    with pytest.raises(seas_route.HistoryPending):
        ROUTE_DAILY_BARS("AAA")
    assert [a[:3] for a in served] == [("AAA", "D", seas_route.DAILY_BARS)]


def test_stock_an_old_newest_bar_is_stale_and_bars_before_the_vendor_floor_are_said(world, work):
    _hold_bars(world, first="2001-01-02", last="2026-11-13")            # the newest bar is three sessions old
    _close(world, work)
    out = _read(ss.KIND)
    _conforms(out, ss.KIND)
    assert out["status"] == "ok" and out["stale"] is True
    assert _note(out, ss.NOTE_STALE) == ss.NOTE_STALE.format(last="2026-11-13", expected=LAST_DAY)
    assert out["as_of"] == "2026-11-13T21:00:00Z"                       # still the data's own date
    assert ss.NOTE_PRE_FLOOR in out["notes"] and _plain(out["data"])["pre_vendor_floor"] is True and _quiet(world, work)


def test_stock_bad_requests_are_refused_before_any_read_and_a_failing_store_is_unavailable(world, work):
    _hold_bars(world)
    for bad in ({}, {"symbol": ""}, {"symbol": "A B"}, {"symbol": 7}, {"symbol": "TOOLONGSYMBOL"}):
        out = _read(ss.KIND, bad)
        assert out["status"] in ("refused", "unavailable") and _plain(out["data"]) is None, bad
    assert world.store.calls == []
    world.store.fail = RuntimeError("the store is locked")
    out = _read(ss.KIND)
    _conforms(out, ss.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [ss.NOTE_FAILED]


# ── seasonality.board ────────────────────────────────────────────────────────────────────────────────────────────────
def test_board_reads_the_held_board_with_every_number_the_services_own(world, work):
    board = _hold_board(world)
    before = repr(board)
    _close(world, work)
    out = _read(sbr.KIND)
    _conforms(out, sbr.KIND)
    assert out["status"] == "ok" and out["stale"] is False and _quiet(world, work)
    d = _plain(out["data"])
    assert d["funds"] == board["funds"] and len(d["funds"]) == 15       # every fund, every month, the board's own
    assert d["funds"] is not board["funds"] and repr(board) == before   # copied: the held board is not changed
    assert (d["this_month"], d["next_month"], d["et_date"], d["min_years"]) == (11, 12, "2026-11-19", seas.MIN_YEARS)
    assert (d["complete"], d["settled"], d["data_through"], d["source"]) == (True, True, "2022-12-28", sb.SOURCE)
    feb = d["funds"][0]["months"][1]
    assert (d["funds"][0]["symbol"], feb["n"], feb["median_pct"], feb["pct_up"], feb["thin"]) == ("SPY", 8, 10.0, 100, False)
    # `as_of` is the newest bar the board covers; the day it was BUILT rides beside it and is never the as-of
    assert out["as_of"] == "2022-12-28T05:00:00Z"
    assert d["built_at"] == board["as_of"] and d["built_at"].startswith("2026-11-19")
    assert d["read_at"] == "2026-11-19T15:00:00Z" and "as_of" not in d
    assert _note(out, sbr.NOTE_AS_OF) == sbr.NOTE_AS_OF.format(day="2022-12-28", at=board["as_of"], et_date="2026-11-19")
    assert _note(out, sbr.NOTE_WHAT) == sbr.NOTE_WHAT.format(funds=15, answered=15)
    assert _lacks(out, sbr.NOTE_WITHOUT) and _lacks(out, sbr.NOTE_THIN) and sbr.NOTE_UNSETTLED not in out["notes"]
    assert out["coverage"] == {"evaluated": 15, "answered": 15, "dropped": 0, "not_computable": 0}


def test_board_a_fund_without_numbers_keeps_its_reason_and_a_thin_month_keeps_its_flag(world, work):
    board = _hold_board(world, XLK=seas_route.HistoryPending("XLK"), XLF=seas_route.NoDailyHistory("XLF"), QQQ=THREE)
    _close(world, work)
    out = _read(sbr.KIND)
    _conforms(out, sbr.KIND)
    assert out["status"] == "partial" and _quiet(world, work)
    by = {f["symbol"]: f for f in _plain(out["data"])["funds"]}
    held = {f["symbol"]: f for f in board["funds"]}
    for sym, status in (("XLK", sb.PENDING), ("XLF", sb.NOT_HELD)):
        assert by[sym]["status"] == status and by[sym]["reason"] == held[sym]["reason"], sym
        assert "months" not in by[sym] and _zeros(by[sym]) == []        # no months at all, never twelve zeros
    assert all(m["thin"] is True for m in by["QQQ"]["months"]) and by["QQQ"]["months"][1]["n"] == 3
    assert (_plain(out["data"])["complete"], _plain(out["data"])["settled"]) == (False, False)
    note = _note(out, sbr.NOTE_WITHOUT)
    assert note.startswith("2 of 15 funds have no numbers") and "XLK (its history is still being read" in note
    assert "XLF (the bar store does not carry it" in note
    assert _note(out, sbr.NOTE_THIN) == sbr.NOTE_THIN.format(n=12, min_years=seas.MIN_YEARS)
    assert sbr.NOTE_UNSETTLED in out["notes"]
    assert out["coverage"] == {"evaluated": 15, "answered": 13, "dropped": 0, "not_computable": 2}


def test_board_nothing_held_is_unavailable_and_no_build_is_started_serve_builds_one(world, work, monkeypatch):
    _close(world, work)
    out = _read(sbr.KIND)
    _conforms(out, sbr.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [sbr.NOTE_NOT_HELD] and _quiet(world, work)
    assert sb._held is None
    # an unfinished board past the service's reuse window, and yesterday's board: nothing held, and nothing rebuilt
    clock = {"t": 1000.0}
    monkeypatch.setattr(sb, "_clock", lambda: clock["t"])
    _hold_board(world, XLK=seas_route.HistoryPending("XLK"))
    assert _read(sbr.KIND)["status"] == "partial"
    clock["t"] += sb.INCOMPLETE_REUSE_S + 1
    world.funds.asked.clear()
    assert _read(sbr.KIND)["notes"] == [sbr.NOTE_NOT_HELD] and world.funds.asked == []
    world.funds.by_sym = {}
    sb.reset()
    sb.serve(wait_s=10)
    assert _read(sbr.KIND)["status"] == "ok"
    monkeypatch.setattr(sb, "_now_et", lambda: NOW_ET + dt.timedelta(days=1))
    world.funds.asked.clear()
    assert _read(sbr.KIND)["notes"] == [sbr.NOTE_NOT_HELD] and world.funds.asked == []
    # the member route's own reader, in the same state, DOES build (fifteen daily reads, off the request)
    sb.serve(wait_s=10)
    assert len(world.funds.asked) == 15


def test_board_with_no_fund_ready_is_unavailable_with_each_reason_and_a_failing_read_is_said(world, work, monkeypatch):
    world.funds.default = seas_route.HistoryPending("x")
    _hold_board(world)
    _close(world, work)
    out = _read(sbr.KIND)
    _conforms(out, sbr.KIND)
    assert out["status"] == "unavailable" and len(out["notes"]) == 1 and _quiet(world, work)
    assert out["notes"][0].startswith("the seasonality board held on this server has no fund with numbers yet (SPY (its history is still being read")
    monkeypatch.setattr(sbr, "held_answer", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    out = _read(sbr.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [sbr.NOTE_FAILED]
    assert _read(sbr.KIND, {"anything": 1})["status"] == "unavailable"  # the held read still answers; no argument is read


# ── options.tideHistory ──────────────────────────────────────────────────────────────────────────────────────────────
def test_tide_reads_the_stored_sessions_with_every_number_the_stores_own(world, work):
    _hold_tide(TIDE_DAYS)
    own = th.history("all", tr.DEFAULT_ROWS)
    _close(world, work)
    out = _read(tr.KIND)
    _conforms(out, tr.KIND)
    assert out["status"] == "ok" and out["stale"] is False and _quiet(world, work)
    d = _plain(out["data"])
    assert d["sessions"] == own["sessions"] and len(d["sessions"]) == tr.DEFAULT_ROWS      # newest first, the store's rows
    assert d["sessions"][0]["session"] == LAST_DAY and set(d["sessions"][0]) == set(tr.ROW_FIELDS)
    newest = d["sessions"][0]
    i = len(TIDE_DAYS) - 1
    assert (newest["net_call_premium"], newest["net_put_premium"], newest["net_premium"], newest["prints_counted"]) == (
        4_000_000 + 100_000 * i, 1_500_000 + 250_000 * i, 2_500_000 - 150_000 * i, 300 + i)
    assert (d["scope"], d["sessions_stored"], d["sessions_asked"], d["sessions_left_out"]) == ("all", 28, 20, 8)
    assert (d["history_began"], d["latest_session"], d["missing_sessions"], d["backfill"]) == ("2026-10-12", LAST_DAY, [], False)
    assert (d["stored_note"], d["filters"], d["method"], d["label"]) == (th.STORED_NOTE, mt.TAPE_FILTERS, mt.METHOD, "computed")
    # the newest STORED session is the as-of, with when it was stored beside it
    assert out["as_of"] == "2026-11-18T05:00:00Z" and d["read_at"] == "2026-11-18T21:31:27Z"
    assert _note(out, tr.NOTE_AS_OF) == tr.NOTE_AS_OF.format(day=LAST_DAY, at=newest["stored_at"])
    assert _note(out, tr.NOTE_WHAT) == tr.NOTE_WHAT.format(scope="the whole tape", stored=28, began="2026-10-12")
    # the cut is stated, and from the OLD end
    assert _note(out, tr.NOTE_CUT) == tr.NOTE_CUT.format(shown=20, stored=28, left=8)
    assert d["sessions"][-1]["session"] == TIDE_DAYS[8]
    assert _note(out, tr.NOTE_NO_BACKFILL) == tr.NOTE_NO_BACKFILL.format(began="2026-10-12")
    assert out["coverage"] == {"evaluated": 28, "answered": 20, "dropped": 8, "not_computable": 0}
    # asking for every row leaves nothing out and says nothing about a cut
    full = _read(tr.KIND, {"rows": tr.MAX_ROWS})
    assert len(full["data"]["sessions"]) == 28 and _lacks(full, tr.NOTE_CUT) and full["data"]["sessions_left_out"] == 0


def test_tide_the_scope_is_the_services_own_and_a_scope_with_no_row_is_unavailable_never_an_empty_tide(world, work):
    _hold_tide(TIDE_DAYS[-3:], scopes=("etfs",))
    _close(world, work)
    out = _read(tr.KIND, {"scope": "etfs", "rows": 2})
    _conforms(out, tr.KIND)
    assert out["status"] == "ok" and [r["session"] for r in _plain(out["data"])["sessions"]] == [LAST_DAY, PRIOR_DAY]
    assert "funds only" in _note(out, tr.NOTE_WHAT)
    for scope, words in (("all", "the whole tape"), ("stocks", "stocks only")):
        out = _read(tr.KIND, {"scope": scope})
        _conforms(out, tr.KIND)
        assert out["status"] == "unavailable" and out["notes"] == [tr.NOTE_NONE.format(scope=words)], scope
    assert _quiet(world, work)


def test_tide_a_store_that_does_not_exist_is_unavailable_and_is_not_created(world, work, tmp_path):
    _close(world, work)
    out = _read(tr.KIND)
    _conforms(out, tr.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [tr.NOTE_NONE.format(scope="the whole tape")]
    assert not os.path.exists(th._db_path()) and _quiet(world, work)


def test_tide_missing_sessions_are_named_unreadable_prints_are_said_and_an_old_newest_session_is_stale(world, work):
    days = [d for d in TIDE_DAYS if d not in ("2026-10-21", "2026-11-05")][:-2]      # two holes; the newest is 11-16
    _hold_tide(days, unreadable=("2026-11-13",))
    _close(world, work)
    out = _read(tr.KIND, {"rows": 5})
    _conforms(out, tr.KIND)
    d = _plain(out["data"])
    assert out["status"] == "ok" and out["stale"] is True and _quiet(world, work)
    assert d["missing_sessions"] == ["2026-10-21", "2026-11-05"] and d["missing_total"] == 2
    assert _note(out, tr.NOTE_MISSING) == tr.NOTE_MISSING.format(n=2, began="2026-10-12", latest="2026-11-16")
    assert _note(out, tr.NOTE_UNREADABLE) == tr.NOTE_UNREADABLE.format(n=1)
    assert [r["prints_unreadable"] for r in d["sessions"]][:2] == [0, 7]
    assert out["as_of"] == "2026-11-16T05:00:00Z"                       # the newest STORED session, never today
    assert _note(out, tr.NOTE_STALE) == tr.NOTE_STALE.format(day="2026-11-16", expected=LAST_DAY)


def test_tide_a_figure_that_is_not_a_number_is_null_never_zero_and_many_missing_days_are_cut_from_the_old_end(world, monkeypatch):
    rows = [{"session": LAST_DAY, "net_call_premium": None, "net_put_premium": "x", "net_premium": float("nan"),
             "prints_counted": None, "prints_unsigned": -3, "prints_unreadable": None, "data_through": None,
             "stored_at": None, "source": None}]
    missing = [d.isoformat() for d in _weekdays(dt.date(2026, 7, 1), dt.date(2026, 11, 13))]
    monkeypatch.setattr(tr, "held_answer", lambda scope, n: {
        "scope": scope, "sessions": rows, "sessions_stored": 1, "sessions_asked": n, "history_began": "2026-06-30",
        "latest_session": LAST_DAY, "missing_sessions": missing, "missing_checked_through": LAST_DAY, "backfill": False})
    out = _read(tr.KIND)
    _conforms(out, tr.KIND)
    row = _plain(out["data"])["sessions"][0]
    assert {k: row[k] for k in tr.ROW_FIELDS if k != "session"} == {k: None for k in tr.ROW_FIELDS if k != "session"}
    assert _zeros(row) == []
    assert _plain(out["data"])["missing_sessions"] == missing[-tr.MAX_MISSING:] and _plain(out["data"])["missing_total"] == len(missing)
    assert _note(out, tr.NOTE_MISSING_CUT) == tr.NOTE_MISSING_CUT.format(
        n=len(missing), shown=tr.MAX_MISSING, left=len(missing) - tr.MAX_MISSING)
    assert "a time it did not record" in _note(out, tr.NOTE_AS_OF) and _plain(out["data"])["read_at"] is None


def test_tide_bad_requests_are_refused_before_any_read_and_a_failing_store_is_unavailable(world, monkeypatch):
    ran = []
    monkeypatch.setattr(tr, "held_answer", lambda scope, n: ran.append(scope) or (_ for _ in ()).throw(RuntimeError("x")))
    for bad in ({"scope": "everything"}, {"scope": "STOCKS"}, {"rows": 0}, {"rows": tr.MAX_ROWS + 1}, {"rows": "5"}, {"rows": True}):
        out = _read(tr.KIND, bad)
        assert out["status"] in ("refused", "unavailable") and _plain(out["data"]) is None, bad
    assert ran == []
    out = _read(tr.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [tr.NOTE_FAILED] and ran == ["all"]


# ── options.oiChange ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_oi_reads_the_held_pair_with_every_number_the_services_own(world, work):
    _hold_pair(world)
    own = oic.oi_change("AAA", wait_s=10)                               # the route's own answer from the same pair
    _close(world, work)
    started = oic.builds_started
    out = _read(oi.KIND, {"symbol": "aaa"})
    _conforms(out, oi.KIND)
    assert out["status"] == "ok" and out["stale"] is False and _quiet(world, work) and oic.builds_started == started
    d = _plain(out["data"])
    assert d["rows"] == own["rows"] and [set(r) for r in d["rows"]] == [set(oi.ROW_FIELDS)] * 3
    assert [(r["type"], r["strike"], r["kind"], r["oi"], r["prior_oi"], r["change"], r["change_pct"], r["volume"]) for r in d["rows"]] == [
        ("call", 100.0, "change", 1600, 1000, 600, 60.0, 700),          # the volume is the EARLIER session's own
        ("put", 90.0, "change", 1500, 2000, -500, -25.0, 450),
        ("put", 80.0, "new", 250, None, None, None, None)]              # newly listed: no change, no percent, never 0
    for key in ("session", "prior_session", "skipped_sessions", "known", "has_symbol", "prior_has_symbol", "matched",
                "shown", "summary", "new", "gone", "not_reported", "volume_present", "volume_session", "built_at",
                "source", "coverage", "max_rows"):
        assert d[key] == own[key], key
    assert (d["session"], d["prior_session"], d["side"], d["left_out"]) == (LAST_DAY, PRIOR_DAY, "any", 0)
    assert d["summary"]["call"] == {"contracts": 2, "oi": 1900, "prior_oi": 1300, "change": 600}
    assert (d["new"], d["gone"]) == ({"contracts": 1, "oi": 250}, {"contracts": 1, "prior_oi": 40, "expired": 1})
    # the newer file's date is the as-of, with when that file was built beside it
    assert out["as_of"] == "2026-11-18T05:00:00Z" and d["read_at"] == env.utc_iso(dt.datetime.fromisoformat(own["built_at"]))
    assert _note(out, oi.NOTE_AS_OF) == oi.NOTE_AS_OF.format(session=LAST_DAY, prior=PRIOR_DAY, at=own["built_at"])
    assert _note(out, oi.NOTE_WHAT) == oi.NOTE_WHAT.format(symbol="AAA", side="calls and puts", session=LAST_DAY, prior=PRIOR_DAY)
    assert _note(out, oi.NOTE_NEW) == oi.NOTE_NEW.format(n=1) and _note(out, oi.NOTE_GONE) == oi.NOTE_GONE.format(n=1, expired=1)
    assert _lacks(out, oi.NOTE_CUT) and _lacks(out, oi.NOTE_SKIPPED) and _lacks(out, oi.NOTE_UNKNOWN) and oi.NOTE_NO_VOLUME not in out["notes"]
    assert out["coverage"] == {"evaluated": 3, "answered": 3, "dropped": 0, "not_computable": 0}


def test_oi_the_side_is_the_services_own_and_a_cut_names_the_small_end(world, work):
    _hold_pair(world)
    _close(world, work)
    out = _read(oi.KIND, {"symbol": "AAA", "side": "put", "rows": 1})
    _conforms(out, oi.KIND)
    d = _plain(out["data"])
    assert [(r["type"], r["change"]) for r in d["rows"]] == [("put", -500)] and (d["matched"], d["shown"], d["left_out"]) == (2, 1, 1)
    assert _note(out, oi.NOTE_CUT) == oi.NOTE_CUT.format(shown=1, matched=2, left=1)
    assert "puts only" in _note(out, oi.NOTE_WHAT)
    assert out["coverage"] == {"evaluated": 2, "answered": 1, "dropped": 1, "not_computable": 0}
    calls = _read(oi.KIND, {"symbol": "AAA", "side": "call"})
    assert [(r["type"], r["change"]) for r in calls["data"]["rows"]] == [("call", 600)] and _lacks(calls, oi.NOTE_CUT)
    assert _quiet(world, work)


def test_oi_a_pair_that_is_not_prepared_is_unavailable_never_an_empty_change_the_route_starts_the_build(world, work):
    _two_days(world.log)                                                # the files exist; nothing has prepared the pair
    _close(world, work)
    out = _read(oi.KIND)
    _conforms(out, oi.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [oi.NOTE_NOT_HELD]
    assert oic.builds_started == 0 and oic._held is None and _quiet(world, work)
    # the member route's own reader, in the same state, DOES start the background build
    assert oic.oi_change("AAA", wait_s=0)["status"] in ("computing", "ok")
    assert oic.builds_started == 1 and work["threads"] == ["options-oi-change"]
    _drain()


def test_oi_a_failed_build_a_lost_file_and_a_log_with_one_session_or_none_are_each_said(world, work):
    class Broken(osc.LocalStore):
        def screen_sessions(self):
            raise RuntimeError("no storage")
    assert oic.oi_change("AAA", store=Broken("x"), wait_s=10)["status"] == "unavailable"
    _close(world, work)
    out = _read(oi.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [oi.NOTE_BUILD_FAILED.format(error="RuntimeError")]
    assert oic.builds_started == 1 and _quiet(world, work)             # said, and not tried again
    oic.reset()
    assert oic.oi_change("AAA", wait_s=10)["status"] == "no_sessions"   # an empty log
    _close(world, work)
    assert _read(oi.KIND)["notes"] == [oi.NOTE_NO_SESSIONS]
    oic.reset()
    world.log.day(LAST_DAY, [_c("AAA", "call", 100, NEAR)])
    assert oic.oi_change("AAA", wait_s=10)["status"] == "one_session"
    _close(world, work)
    assert _read(oi.KIND)["notes"] == [oi.NOTE_ONE_SESSION.format(session=LAST_DAY)]
    oic.reset()
    world.log.day(PRIOR_DAY, [_c("AAA", "call", 100, NEAR, oi_=5)])
    assert oic.oi_change("BBB", wait_s=10)["status"] == "ok"
    with oic._lock:
        oic._held = {**oic._held, "path": os.path.join(world.log.root, "gone.screen.sqlite")}
    _close(world, work)
    started = oic.builds_started
    out = _read(oi.KIND)
    _conforms(out, oi.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [oi.NOTE_FILE_GONE]
    assert oic.builds_started == started and _quiet(world, work)
    for o in (out,):
        assert "no change" in o["notes"][0]                             # each says it is not "no change"


def test_oi_a_stock_in_neither_file_is_a_healthy_answer_that_says_so_and_an_old_pair_is_stale(world, work):
    _two_days(world.log, newer="2026-11-13", earlier="2026-11-11")      # an old pair, with 11-12 skipped
    assert oic.oi_change("AAA", wait_s=10)["status"] == "ok"
    _close(world, work)
    out = _read(oi.KIND, {"symbol": "ZZZ"})
    _conforms(out, oi.KIND)
    d = _plain(out["data"])
    assert out["status"] == "ok" and d["known"] is False and d["rows"] == [] and (d["matched"], d["shown"]) == (0, 0)
    assert _note(out, oi.NOTE_UNKNOWN) == oi.NOTE_UNKNOWN.format(symbol="ZZZ", session="2026-11-13", prior="2026-11-11")
    assert out["stale"] is True and _note(out, oi.NOTE_STALE) == oi.NOTE_STALE.format(session="2026-11-13", expected=LAST_DAY)
    assert out["as_of"] == "2026-11-13T05:00:00Z"                       # the newer file's date, never today
    assert d["skipped_sessions"] == ["2026-11-12"] and _note(out, oi.NOTE_SKIPPED) == oi.NOTE_SKIPPED.format(list="2026-11-12")
    assert _quiet(world, work)


def test_oi_a_missing_figure_is_null_never_zero(world, monkeypatch):
    row = {"contract": "O:AAA261120C00100000", "expiration": NEAR, "strike": 100.0, "type": "call", "oi": 900,
           "kind": "change", "prior_oi": 0, "change": 900, "change_pct": None, "volume": None}
    got = {"status": "ok", "session": LAST_DAY, "prior_session": PRIOR_DAY, "skipped_sessions": [], "known": True,
           "has_symbol": True, "prior_has_symbol": True, "rows": [row], "matched": 1, "shown": 1,
           "summary": {"call": {"contracts": 1, "oi": 900, "prior_oi": 0, "change": 900}, "put": None},
           "new": {"contracts": 0, "oi": 0}, "gone": None, "not_reported": 4, "volume_present": False, "built_at": None}
    monkeypatch.setattr(oi, "held_answer", lambda sym, side: (got, "held"))
    out = _read(oi.KIND)
    _conforms(out, oi.KIND)
    d = _plain(out["data"])
    assert (d["rows"][0]["change_pct"], d["rows"][0]["volume"]) == (None, None)       # nothing to divide by; no volume recorded
    assert d["summary"]["put"] == {"contracts": None, "oi": None, "prior_oi": None, "change": None}
    assert d["gone"] == {"contracts": None, "prior_oi": None, "expired": None} and d["read_at"] is None
    assert oi.NOTE_NO_VOLUME in out["notes"] and _note(out, oi.NOTE_NOT_REPORTED) == oi.NOTE_NOT_REPORTED.format(n=4)
    assert "a time it did not record" in _note(out, oi.NOTE_AS_OF)


def test_oi_bad_requests_are_refused_before_any_read_and_a_failing_service_is_unavailable(world, monkeypatch):
    ran = []
    monkeypatch.setattr(oi, "held_answer", lambda sym, side: ran.append(sym) or (_ for _ in ()).throw(RuntimeError("x")))
    for bad in ({}, {"symbol": "A B"}, {"symbol": "AAA", "side": "both"}, {"symbol": "AAA", "side": "CALL"},
                {"symbol": "AAA", "rows": 0}, {"symbol": "AAA", "rows": oi.MAX_ROWS + 1}, {"symbol": "AAA", "rows": 2.5}):
        out = _read(oi.KIND, bad)
        assert out["status"] in ("refused", "unavailable") and _plain(out["data"]) is None, bad
    assert ran == []
    out = _read(oi.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [oi.NOTE_FAILED] and ran == ["AAA"]


# ── rates.treasury ───────────────────────────────────────────────────────────────────────────────────────────────────
def test_treasury_reads_the_held_answer_with_every_number_the_services_own(world, work):
    held = _hold_curve(_curve_rows(**{"10y": 4.12}))
    _close(world, work)
    out = _read(trs.KIND)
    _conforms(out, trs.KIND)
    assert out["status"] == "ok" and out["stale"] is False and _quiet(world, work)
    d = _plain(out["data"])
    assert d["maturities"] == held["maturities"] and d["spreads"] == held["spreads"] and d["ref_dates"] == held["ref_dates"]
    assert [m["key"] for m in d["maturities"]] == [k for k, _f, _l, _m in ty.MATURITIES]
    ten = next(m for m in d["maturities"] if m["key"] == "10y")
    assert (ten["yield"], ten["was"]["d1"], ten["change_bp"]["d1"]) == (4.12, 4.10, 2.0)
    assert (d["as_of"], d["rows"], d["basis"], d["units"], d["source"], d["check"]) == (
        LAST_DAY, held["rows"], "end_of_day", held["units"], ty.SOURCE, None)
    # the long daily columns are left out, and the read says so
    assert d["history"] == {"from": held["history"]["from"], "to": LAST_DAY, "points": held["history"]["points"],
                            "years": ty.HISTORY_YEARS, "columns_left_out": True}
    assert _note(out, trs.NOTE_HISTORY_CUT) == trs.NOTE_HISTORY_CUT.format(
        points=held["history"]["points"], first=held["history"]["from"], last=LAST_DAY)
    # the curve's own date is the as-of, with when the site read it beside it
    assert out["as_of"] == "2026-11-18T05:00:00Z" and d["read_at"] == "2026-11-18T23:20:00Z"
    assert _note(out, trs.NOTE_AS_OF) == trs.NOTE_AS_OF.format(day=LAST_DAY, at=READ_AT) and trs.NOTE_WHAT in out["notes"]
    assert _lacks(out, trs.NOTE_MISSING) and _lacks(out, trs.NOTE_STALE) and _lacks(out, trs.NOTE_CHECK)
    assert out["coverage"] == {"evaluated": 11, "answered": 11, "dropped": 0, "not_computable": 0}


def test_treasury_a_maturity_with_no_figure_and_a_change_with_no_reference_are_null_never_zero(world, work):
    rows = _curve_rows(**{"1m": None})
    rows = [r for r in rows if not ("2025-11-05" <= r["date"] <= "2025-11-28")]       # a hole where "one year earlier" falls
    held = _hold_curve(rows)
    _close(world, work)
    out = _read(trs.KIND)
    _conforms(out, trs.KIND)
    d = _plain(out["data"])
    one = d["maturities"][0]
    assert one["key"] == "1m" and one["yield"] is None and set(one["change_bp"].values()) == {None}
    assert held["ref_dates"]["y1"] is None and d["ref_dates"]["y1"] is None
    assert all(m["was"]["y1"] is None and m["change_bp"]["y1"] is None for m in d["maturities"])
    assert _note(out, trs.NOTE_MISSING) == trs.NOTE_MISSING.format(n=1, day=LAST_DAY, list="1-month")
    assert _note(out, trs.NOTE_NO_REFERENCE) == trs.NOTE_NO_REFERENCE.format(list="one year")
    assert out["coverage"] == {"evaluated": 11, "answered": 10, "dropped": 0, "not_computable": 1} and _quiet(world, work)


def test_treasury_nothing_held_is_unavailable_and_no_build_is_started_get_yields_starts_one(world, work):
    _close(world, work)
    out = _read(trs.KIND)
    _conforms(out, trs.KIND)
    assert out["status"] == "unavailable" and out["notes"] == [trs.NOTE_NOT_HELD] and _quiet(world, work)
    with ty._lock:
        assert ty._state["inflight"] is None and ty._state["held"] is None
    # the member route's own reader, in the same state, DOES start the build (and the build asks the website)
    assert ty.get_yields(wait_s=5)["status"] != "ok"
    _drain()
    assert work["threads"] == ["rates-data-build"] and world.site.calls


def test_treasury_a_curve_that_is_behind_or_a_look_that_went_badly_is_stale_and_no_look_is_started(world, work):
    _hold_curve(_curve_rows(newest=dt.date(2026, 11, 13)))             # Friday's curve, read on Thursday: behind
    _close(world, work)
    out = _read(trs.KIND)
    _conforms(out, trs.KIND)
    assert out["status"] == "ok" and out["stale"] is True and _quiet(world, work)
    assert out["as_of"] == "2026-11-13T05:00:00Z"                       # the curve's own date, never today
    assert _note(out, trs.NOTE_STALE) == trs.NOTE_STALE.format(day="2026-11-13", expected=LAST_DAY)
    # the last look for a newer figure did not go well: the held figures are the last good ones
    _hold_curve(check={"state": "failed", "reason": "timeout", "http_status": None, "at": "2026-11-19T14:00:00+00:00"})
    out = _read(trs.KIND)
    _conforms(out, trs.KIND)
    assert out["stale"] is True and _lacks(out, trs.NOTE_STALE)
    assert _note(out, trs.NOTE_CHECK) == trs.NOTE_CHECK.format(at="2026-11-19T14:00:00+00:00", why=trs.CHECK_WORDS["timeout"])
    assert _plain(out["data"])["check"] == {"state": "failed", "reason": "timeout", "http_status": None, "at": "2026-11-19T14:00:00+00:00"}
    assert _quiet(world, work)


def test_treasury_an_answer_held_only_on_disk_is_read_and_the_website_is_not_asked(world, work):
    rows = _curve_rows()
    held = ty.assemble(rows, read_at=READ_AT)
    ty._save_disk(held, {r["date"]: r["y"] for r in rows}, time.time())
    ty.reset_for_tests()
    _close(world, work)
    out = _read(trs.KIND)
    _conforms(out, trs.KIND)
    assert out["status"] == "ok" and _plain(out["data"])["as_of"] == LAST_DAY and _quiet(world, work)


def test_treasury_a_failing_service_or_an_answer_that_is_not_the_curve_is_unavailable(world, monkeypatch):
    for got in ((_ for _ in ()), ({"status": "ok", "as_of": "soon", "maturities": []}, "held"),
                ({"status": "ok", "as_of": LAST_DAY, "maturities": [{"key": "10y", "yield": None}]}, "held")):
        monkeypatch.setattr(trs, "held_answer", lambda g=got: g if isinstance(g, tuple) else (_ for _ in ()).throw(RuntimeError("x")))
        out = _read(trs.KIND)
        _conforms(out, trs.KIND)
        assert out["status"] == "unavailable" and out["notes"] == [trs.NOTE_FAILED]


# ── THE BUDGET RULE ──────────────────────────────────────────────────────────────────────────────────────────────────
def test_no_read_of_this_wave_reaches_a_builder_a_fetch_a_capture_or_a_thread_held_or_not(world, work):
    """Every entry point that can cause work is replaced by one that fails and counts, named per service: the bar
    fetchers and the bar serve, the board's builder, the tide capture and the live tide, the open-interest route
    reader and its build, the yields route reader, its build and its one website reader."""
    reached = []

    def forbid(mp):
        for mod, names in FORBIDDEN.items():
            for name in names:
                assert callable(getattr(mod, name)), (mod.__name__, name)       # a rename fails here, by name
                mp.setattr(mod, name, lambda *a, _n=f"{mod.__name__}.{name}", **kw:
                           reached.append(_n) or (_ for _ in ()).throw(AssertionError(_n)))
        # a cold metadata miss would SCHEDULE its vendor read on this pool: scheduling one is already a failure
        mp.setattr(bars_sanitize._warm_pool, "submit",
                   lambda *a, **kw: reached.append("bars_sanitize._warm_pool.submit"))
    with pytest.MonkeyPatch.context() as mp:                            # nothing held anywhere
        forbid(mp)
        _close(world, work)
        for kind, params in READS:
            out = _read(kind, params)
            _conforms(out, kind)
            assert out["status"] == "unavailable", (kind, params)
        assert reached == [] and _quiet(world, work)
    _hold_bars(world)
    _hold_board(world)
    _hold_tide(TIDE_DAYS)
    _hold_pair(world)
    _hold_curve()
    oic._held_at = time.monotonic() - oic.RECHECK_S - 5                 # the pair is due a look: the route would list again
    with ty._lock:
        ty._state["checked"] = 0.0                                      # the yields are due a refresh: the route would start one
    started = oic.builds_started
    with pytest.MonkeyPatch.context() as mp:                            # everything held, every rebuild and look due
        forbid(mp)
        _close(world, work)
        for kind, params in READS:
            out = _read(kind, params)
            _conforms(out, kind)
            assert out["status"] == "ok", (kind, params, out["notes"])
        assert reached == [] and _quiet(world, work)
        assert oic.builds_started == started and oic._inflight is None
        with ty._lock:
            assert ty._state["inflight"] is None


# ── the licensing record the isolation rests on ──────────────────────────────────────────────────────────────────────
def test_the_licensing_register_rows_the_isolation_cites_say_what_the_adapters_say_they_say():
    register = REGISTER.read_text(encoding="utf-8")
    row = lambda r: next(ln for ln in register.splitlines() if ln.startswith(f"| {r} |"))      # noqa: E731
    assert row("T-04").startswith("| T-04 | Member display — D/W/M history")
    assert row("T-09").startswith("| T-09 | Storage — `bars.db`")
    assert "the pre-2003 D/W/M tail" in row("T-71") and "| **X** |" in row("T-71")
    assert row("T-25").startswith("| T-25 | Storage — `flow.db` full-tape OPRA archive")
    assert row("T-26").startswith("| T-26 | Derived analytics") and "Keep member-gated; never public" in row("T-26")
    assert row("T-28").startswith("| T-28 | Member display — options chain")
    assert row("T-14").startswith("| T-14 | AI processing") and "| **R** |" in row("T-14")
    t95 = row("T-95")
    assert "US Treasury par yields" in t95 and "| **A** |" in t95
    assert "Nothing else reads it (no AI lane, no export, no external publication)" in t95
    # no row names what four of these kinds serve, so none can be read as clearing it
    table = "\n".join(ln for ln in register.splitlines() if re.match(r"\| [TN]-\d+ \|", ln)).lower()
    for words in ("seasonality", "market tide", "open-interest change", "options log"):
        assert words not in table, words
    cites = {ss: ("T-04", "T-09", "T-71", "T-14"), sbr: ("T-04", "T-09", "T-71", "T-14"), tr: ("T-25", "T-26", "T-14"),
             oi: ("T-28", "T-14"), trs: ("T-95",)}
    for m, rows in cites.items():                                      # each adapter says which rows, and claims no more
        doc = " ".join(m.__doc__.split())
        assert "licensing-register.md" in doc and "MODEL-ISOLATED (ADR-005; when in doubt, isolate)" in doc, m.KIND
        assert all(r in doc for r in rows), m.KIND
        assert "for a model provider" in doc and "Shown to the member only; the capability is local-only." in doc, m.KIND
        assert "no row clears" in doc or "no other row does" in doc, m.KIND


# ── the contract (MD-1 v1.12 §4.15) ──────────────────────────────────────────────────────────────────────────────────
def test_the_contract_doc_states_section_4_15_and_every_note_the_adapters_emit():
    """MD-1 §4.15 quotes each note verbatim; QA pins fixtures to the doc, so the two must not drift."""
    doc = DOC.read_text(encoding="utf-8")
    head = ("### 4.15 Terminal data wave 6: `seasonality.stock`, `seasonality.board`, `options.tideHistory`, "
            "`options.oiChange`, `rates.treasury` (v1.12, terminal-data)")
    assert head in doc
    section = doc[doc.index(head):doc.index("## 8. Changing this contract")]
    for m in MODULES:
        assert f"`{m.KIND}`" in section and f"`{m.SOURCE}`" in section, m.KIND
        notes = {k: v for k, v in vars(m).items() if k.startswith("NOTE_")}
        assert notes, m.KIND
        for name, text in notes.items():
            assert text in section, f"{m.KIND} {name}"
        assert f"| `{m.KIND}` |" in section, m.KIND                    # its table row
    for words in (list(sbr.WITHOUT_WORDS.values()) + list(tr.SCOPE_WORDS.values()) + list(oi.SIDE_WORDS.values())
                  + list(trs.CHECK_WORDS.values()) + [trs.CHECK_FAILED] + list(trs.HORIZON_WORDS.values())):
        assert words in section, words                                 # the words a note is filled with
    # default OFF, the isolation switch and the never-builds rule are stated where the kinds are documented (the
    # section's prose is wrapped, so a phrase is looked for with the line breaks folded)
    prose = " ".join(section.split())
    for s in ("UCT_AGENT_DATA_KINDS", "UCT_AGENT_ISOLATED_KINDS", "turn.LOCAL_ONLY_ACTIONS", "**Status: dark, not armed.**",
              "**No read of this section starts a build, a fetch, a capture or a vendor request.**",
              "`seasonality_board.held`", "`oi_change.held_change`", "`treasury_yields.held_answer`", "`tide_history.history`",
              "`bars_sqlite.get_bars_before`", "`_history_is_partial`", "rows T-04 and T-09", "row T-71", "rows T-25 and T-26",
              "row T-28", "row T-95", "row T-14", "Nothing else reads it (no AI lane, no export, no external publication)",
              "Keep member-gated; never public", "clears these figures for a model provider", "never today"):
        assert s in prose, s
    # wave 5's section still ends where this one begins
    assert doc.index("### 4.14 Terminal data wave 5") < doc.index(head) < doc.index("## 8. Changing this contract")
    title = re.match(r"# MD-1 — UCT market-data contract \(v1\.(\d+)\)", doc)
    assert title and int(title.group(1)) >= 12
    entry = next(line for line in doc.splitlines() if line.startswith("- **v1.12 addition (2026-11-20, terminal-data, data wave 6):**"))
    assert "owed by a person" in entry and "acknowledged by the owner" not in entry      # §8.1: no acknowledgement is claimed
    assert "has not been sent" in entry and "not acknowledged by anyone" in entry
    assert "**Not armed:**" in entry and "Nothing in this entry or in §4.15 records an owner decision." in entry
    assert doc.index(entry) < doc.index("- **v1.11 addition (2026-11-18, terminal-data, data wave 5):**")
    status = next(line for line in doc.splitlines() if line.startswith("- **Status:** v1."))
    owed = re.search(r"the §8\.1 notices for ([^;)]*?) are owed by a person and are not acknowledged", status)
    assert owed and all(v in owed.group(1) for v in ("v1.9", "v1.10", "v1.11", "v1.12"))
    # nothing in the section or the entry records or implies an owner decision about these kinds
    for text in (section[section.index(head):], entry):
        for claim in ("owner approved", "owner asked", "owner decided", "approved by the owner", "will be armed", "the owner will"):
            assert claim not in text, claim
