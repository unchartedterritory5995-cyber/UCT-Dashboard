"""The options tape's spot read: `spot_fetch_manager` in api/massive_ws_worker.py.

The manager drains a queue of underlyings every 10 seconds (30 a cycle) and caches one
price per symbol; that price fills the SPOT and in/out-of-the-money columns of the tape.

What these tests hold:
  * the queue, the 30-a-cycle cap, the cache shape, the 60 s freshness window;
  * stocks and ETFs read ONE Massive batch snapshot per cycle first, in the regular session
    only, and a row is used only when its own last trade is a fresh regular-session print
    for that symbol; anything else, and any snapshot failure, falls through to Yahoo;
  * the Yahoo chart read (the caret symbol of each index root, the regular-session price
    first, the last close second, nothing stored on a failed read);
  * the stranded-row backfill keeps its print-time read (1-minute bars of that day).

TEST SAFETY. Nothing here opens a socket. The manager lives inside `_run_session`, so each
test runs one session against a fake socket with ONLY the spot task started (the other ten
session tasks open flow.db and fetch the earnings calendar); `httpx` is a fake module,
`urllib.request.urlopen` is a fake, and `socket.create_connection` / `socket.getaddrinfo`
raise.
"""
from __future__ import annotations

import asyncio
import json
import logging
import socket
import sqlite3
import sys
import threading
import time as _real_time
import types
import urllib.error
import urllib.request
from datetime import datetime, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from api import massive_ws_worker as mww

ET = ZoneInfo("America/New_York")
TICK = 0.01
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/"
SNAPSHOT = "https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers"
INDEX_ROOTS = {
    "SPX": "^GSPC", "SPXW": "^GSPC", "XSP": "^GSPC",
    "NDX": "^NDX", "DJX": "^DJI", "RUT": "^RUT", "VIX": "^VIX",
}


def _et(y, mo, d, h, mi, s=0):
    return datetime(y, mo, d, h, mi, s, tzinfo=ET).timestamp()


REGULAR = _et(2026, 11, 18, 11, 0)      # a Wednesday, mid-session
PRE_MARKET = _et(2026, 11, 18, 8, 0)
AFTER_HOURS = _et(2026, 11, 18, 17, 0)
SATURDAY = _et(2026, 11, 21, 11, 0)


# --- stand-ins ---------------------------------------------------------------

class _Clock:
    """The module's `time` name: `time()` is ours, everything else is the real module."""

    def __init__(self, now):
        self.now = now

    def time(self):
        return self.now

    def __getattr__(self, name):
        return getattr(_real_time, name)


class _Loop:
    """The module's `asyncio` name. Starts `spot_fetch_manager` and no other session task,
    and shortens the manager's 10 s drain wait to TICK. Everything else is real asyncio."""

    def __init__(self):
        self.waits = []          # every timeout the module asked `wait_for` for
        self.ticks = 0           # drain waits started
        self.short = {}          # other timeouts a test wants shortened

    def __getattr__(self, name):
        return getattr(asyncio, name)

    def create_task(self, coro, **kw):
        if coro.cr_code.co_name == "spot_fetch_manager":
            return asyncio.create_task(coro, **kw)
        coro.close()
        done = asyncio.get_running_loop().create_future()
        done.set_result(None)
        return done

    async def wait_for(self, aw, timeout=None):
        self.waits.append(timeout)
        if timeout == 10.0:
            self.ticks += 1
            timeout = TICK
        timeout = self.short.get(timeout, timeout)
        return await asyncio.wait_for(aw, timeout)


class _WS:
    """A socket that says nothing until the test ends the session."""

    def __init__(self):
        self.entered = asyncio.Event()
        self.done = asyncio.Event()

    def __aiter__(self):
        return self

    async def __anext__(self):
        self.entered.set()
        await self.done.wait()
        raise StopAsyncIteration

    async def send(self, _msg):
        raise AssertionError("these tests send nothing")


class _Resp:
    def __init__(self, status=200, body=None, bad_json=False):
        self.status_code = status
        self._body = body
        self._bad = bad_json

    def json(self):
        if self._bad:
            raise ValueError("not json")
        return self._body


def _chart(price=None, closes=None, meta=None):
    m = dict(meta or {})
    if price is not None:
        m["regularMarketPrice"] = price
    return _Resp(200, {"chart": {"result": [{
        "meta": m, "indicators": {"quote": [{"close": list(closes or [])}]}}]}})


class _Yahoo:
    """A fake `httpx` module. `answers[yahoo_symbol]` is a `_Resp`, an exception to raise,
    or absent (a 404)."""

    def __init__(self):
        self.calls = []
        self.clients = []
        self.answers = {}
        self.boom = None

    def symbols(self):
        return [c["url"][len(YAHOO):] for c in self.calls]

    def module(self):
        y = self

        class AsyncClient:
            def __init__(self, **kw):
                if y.boom is not None:
                    raise y.boom
                y.clients.append(kw)

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def get(self, url, params=None, headers=None):
                assert url.startswith(YAHOO), "an unexpected address: %s" % url.split("?")[0]
                y.calls.append({"url": url, "params": params, "headers": headers})
                ans = y.answers.get(url[len(YAHOO):])
                if isinstance(ans, Exception):
                    raise ans
                return ans if ans is not None else _Resp(404, {})

        mod = types.ModuleType("httpx")
        mod.AsyncClient = AsyncClient
        return mod


class _Body:
    def __init__(self, status, raw):
        self.status = status
        self._raw = raw

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self._raw


class _Massive:
    """A fake `urllib.request.urlopen`. Answers a batch snapshot with the rows it holds for
    the tickers the URL names (plus `extra` rows nobody asked for)."""

    def __init__(self):
        self.calls = []
        self.rows = {}
        self.extra = []
        self.fail = None
        self.status = 200
        self.raw = None
        self.hold = None

    def tickers(self, i=-1):
        url = self.calls[i]["url"]
        return url.split("tickers=", 1)[1].split("&", 1)[0].split(",")

    def urlopen(self, url, *args, timeout=None, **kw):
        target = url if isinstance(url, str) else url.full_url
        self.calls.append({"url": target, "timeout": timeout,
                           "on_main_thread": threading.current_thread() is threading.main_thread()})
        if self.hold is not None:
            self.hold.wait(5)
        if self.fail is not None:
            raise self.fail
        if self.raw is not None:
            return _Body(self.status, self.raw)
        rows = [self.rows[s] for s in self.tickers() if s in self.rows] + list(self.extra)
        return _Body(self.status, json.dumps({"status": "OK", "tickers": rows}).encode("utf-8"))


def _no_network(*a, **k):
    raise AssertionError("TEST SAFETY: a test tried to reach the network")


@pytest.fixture()
def tape(monkeypatch):
    saved_cache = dict(mww._SPOT_CACHE)
    saved_state = dict(mww._state)
    t = SimpleNamespace(yahoo=_Yahoo(), massive=_Massive(), clock=_Clock(REGULAR), loop=_Loop())
    monkeypatch.setitem(sys.modules, "httpx", t.yahoo.module())
    monkeypatch.setattr(urllib.request, "urlopen", t.massive.urlopen)
    monkeypatch.setattr(socket, "create_connection", _no_network)
    monkeypatch.setattr(socket, "getaddrinfo", _no_network)
    monkeypatch.setattr(mww, "MASSIVE_API_KEY", "test-key-not-prod")
    monkeypatch.setattr(mww, "asyncio", t.loop)
    monkeypatch.setattr(mww, "time", t.clock)
    monkeypatch.setattr(mww, "_build_warm_start_contracts", lambda limit=950: [])
    mww._SPOT_CACHE.clear()
    mww._spot_fetch_queue.clear()
    mww._spot_fetch_seen.clear()
    yield t
    mww._SPOT_CACHE.clear()
    mww._SPOT_CACHE.update(saved_cache)
    mww._spot_fetch_queue.clear()
    mww._spot_fetch_seen.clear()
    mww._state.clear()
    mww._state.update(saved_state)


def _drain(tape, *batches, extra_ticks=0, between=None):
    """One session. Each batch is queued the way `_load_spot_for_events` queues it, then the
    session waits until the manager has drained it (two more drain waits started, which is
    always past the cycle that took the batch) before the next batch is queued."""

    async def main():
        ws = _WS()
        session = asyncio.create_task(mww._run_session(ws))
        await asyncio.wait_for(ws.entered.wait(), 5)
        try:
            for i, batch in enumerate(batches):
                if i and between is not None:
                    between(i)
                want = tape.loop.ticks + 2 + extra_ticks
                mww._spot_fetch_queue.extend(batch)
                mww._spot_fetch_seen.update(batch)
                deadline = _real_time.monotonic() + 10
                while tape.loop.ticks < want:
                    assert _real_time.monotonic() < deadline, "the spot manager never drained"
                    await asyncio.sleep(TICK / 2)
        finally:
            ws.done.set()
            await asyncio.wait_for(session, 10)

    asyncio.run(main())


# --- the drain ---------------------------------------------------------------

def test_the_manager_waits_ten_seconds_between_drains(tape):
    _drain(tape, [])
    assert 10.0 in tape.loop.waits and tape.loop.ticks >= 2


def test_an_empty_queue_reads_nothing(tape):
    _drain(tape, [])
    assert tape.yahoo.clients == [] and tape.yahoo.calls == [] and tape.massive.calls == []
    assert mww._SPOT_CACHE == {}


def test_a_cycle_takes_thirty_symbols_and_leaves_the_rest_queued(tape):
    tape.clock.now = AFTER_HOURS
    syms = ["S%02d" % i for i in range(35)]
    seen_after_first = {}

    def snapshot(_i):
        seen_after_first["queue"] = list(mww._spot_fetch_queue)

    for s in syms:
        tape.yahoo.answers[s] = _chart(10.0)
    # One batch of 35, then an empty batch whose only job is to wait one more cycle.
    orig_get = tape.yahoo.calls
    _drain(tape, syms, [], between=snapshot)
    assert tape.yahoo.symbols()[:30] == syms[:30], "the first cycle reads the first thirty, in order"
    assert sorted(tape.yahoo.symbols()) == sorted(syms), "the overflow is read on a later cycle"
    assert len(tape.yahoo.clients) == 2, "two cycles, one client each"
    assert set(mww._SPOT_CACHE) == set(syms)
    assert orig_get is tape.yahoo.calls


def test_the_overflow_stays_marked_as_queued(tape):
    """The five left over must stay in the seen-set, or the next flush queues them twice."""
    tape.clock.now = AFTER_HOURS
    syms = ["S%02d" % i for i in range(35)]
    state = {}
    real_gather = asyncio.gather

    def gather(*aws, **kw):
        if "queue" not in state:
            state["queue"] = list(mww._spot_fetch_queue)
            state["seen"] = set(mww._spot_fetch_seen)
            state["size"] = mww._state.get("spot_fetch_queue_size")
        return real_gather(*aws, **kw)

    tape.loop.gather = gather
    _drain(tape, syms, [])
    assert state["queue"] == syms[30:]
    assert state["seen"] == set(syms[30:])
    assert state["size"] == 5


def test_a_resolved_price_is_cached_as_price_and_time(tape):
    tape.yahoo.answers["^GSPC"] = _chart(6012.5)
    before = dict(mww._state)
    _drain(tape, ["SPX"])
    assert mww._SPOT_CACHE == {"SPX": (6012.5, REGULAR)}
    price, at = mww._SPOT_CACHE["SPX"]
    assert isinstance(price, float) and at == REGULAR
    assert mww._state["spot_fetches_sent"] == before.get("spot_fetches_sent", 0) + 1
    assert mww._state["spot_symbols_resolved"] == before.get("spot_symbols_resolved", 0) + 1


def test_the_cycle_uses_one_client_with_an_eight_second_timeout(tape):
    tape.yahoo.answers["^GSPC"] = _chart(6012.5)
    tape.yahoo.answers["^VIX"] = _chart(17.2)
    _drain(tape, ["SPX", "VIX"])
    assert tape.yahoo.clients == [{"timeout": 8.0}]


# --- the Yahoo read ----------------------------------------------------------

@pytest.mark.parametrize("root,caret", sorted(INDEX_ROOTS.items()))
def test_an_index_root_reads_yahoo_under_its_caret_symbol(tape, root, caret):
    tape.yahoo.answers[caret] = _chart(123.45)
    _drain(tape, [root])
    assert tape.yahoo.symbols() == [caret]
    call = tape.yahoo.calls[0]
    assert call["params"] == {"interval": "1d", "range": "5d", "includePrePost": "false"}
    assert call["headers"]["User-Agent"].startswith("Mozilla/5.0")
    assert mww._SPOT_CACHE[root] == (123.45, REGULAR)
    assert tape.massive.calls == [], "an index root is never sent to the stock snapshot"


def test_the_regular_session_price_wins_over_the_closes(tape):
    tape.yahoo.answers["^GSPC"] = _chart(6012.5, closes=[5990.0, 6001.0])
    _drain(tape, ["SPX"])
    assert mww._SPOT_CACHE["SPX"][0] == 6012.5


@pytest.mark.parametrize("meta_price", [None, 0, -4.0, "6012.5"])
def test_without_a_usable_session_price_the_last_positive_close_is_used(tape, meta_price):
    meta = {} if meta_price is None else {"regularMarketPrice": meta_price}
    tape.yahoo.answers["^GSPC"] = _chart(closes=[5990.0, 6001.0, None, 0], meta=meta)
    _drain(tape, ["SPX"])
    assert mww._SPOT_CACHE["SPX"][0] == 6001.0


@pytest.mark.parametrize("answer", [
    _Resp(500, {}),
    _Resp(429, {}),
    _Resp(200, {"chart": {"result": None}}),
    _Resp(200, {"chart": {"result": []}}),
    _Resp(200, None, bad_json=True),
    _chart(closes=[None, 0, -1]),
    RuntimeError("connection reset"),
])
def test_a_failed_yahoo_read_stores_nothing_and_spares_the_others(tape, answer):
    tape.yahoo.answers["^GSPC"] = answer
    tape.yahoo.answers["^VIX"] = _chart(17.2)
    before = mww._state.get("spot_symbols_resolved", 0)
    _drain(tape, ["SPX", "VIX"])
    assert "SPX" not in mww._SPOT_CACHE, "a failed read is never stored, not even as 0"
    assert mww._SPOT_CACHE["VIX"] == (17.2, REGULAR)
    assert mww._state["spot_symbols_resolved"] == before + 1


def test_a_cycle_that_blows_up_frees_its_symbols_and_the_next_cycle_runs(tape):
    tape.yahoo.boom = RuntimeError("no client")
    tape.yahoo.answers["^GSPC"] = _chart(6012.5)
    state = {}

    def heal(_i):
        state["seen"] = set(mww._spot_fetch_seen)
        state["cache"] = dict(mww._SPOT_CACHE)
        tape.yahoo.boom = None

    _drain(tape, ["SPX"], ["SPX"], between=heal)
    assert state["cache"] == {}, "nothing is stored by a cycle that failed"
    assert state["seen"] == set(), "a failed cycle's symbols can be queued again"
    assert mww._SPOT_CACHE["SPX"] == (6012.5, REGULAR), "the manager is still running"


# --- the queue the manager drains (`_load_spot_for_events`) --------------------

def _ev(root):
    return SimpleNamespace(root=root)


def test_the_freshness_window_is_sixty_seconds():
    assert mww._SPOT_TTL_SEC == 60


def test_an_unknown_symbol_is_queued_once_and_left_out(tape):
    out = mww._load_spot_for_events([_ev("AAPL"), _ev("AAPL"), _ev("MSFT")])
    assert out == {}
    assert mww._spot_fetch_queue == ["AAPL", "MSFT"]
    assert mww._spot_fetch_seen == {"AAPL", "MSFT"}
    mww._load_spot_for_events([_ev("AAPL")])
    assert mww._spot_fetch_queue == ["AAPL", "MSFT"], "already queued this cycle"


def test_a_fresh_cached_price_is_used_and_not_queued(tape):
    mww._SPOT_CACHE["AAPL"] = (231.5, REGULAR - 59)
    assert mww._load_spot_for_events([_ev("AAPL")]) == {"AAPL": 231.5}
    assert mww._spot_fetch_queue == []


def test_a_price_past_the_window_is_still_used_and_queued_for_refresh(tape):
    mww._SPOT_CACHE["AAPL"] = (231.5, REGULAR - 60)
    assert mww._load_spot_for_events([_ev("AAPL")]) == {"AAPL": 231.5}
    assert mww._spot_fetch_queue == ["AAPL"]


def test_an_adjusted_root_is_never_queued(tape):
    assert mww._load_spot_for_events([_ev("AAPL1")]) == {}
    assert mww._spot_fetch_queue == []


# --- one snapshot row: when its price means what the Yahoo price means ----------

def _row(sym="AAPL", price=231.5, at=REGULAR - 2, day_close=230.0, **over):
    """A snapshot row whose last trade printed at epoch second `at`."""
    row = {
        "ticker": sym,
        "lastTrade": {"p": price, "t": int(at) * 10**9},
        "day": {"c": day_close},
        "updated": int(at) * 10**9,
    }
    row.update(over)
    return row


def test_a_fresh_regular_session_trade_is_the_spot():
    spot = mww._spot_from_snapshot_row(_row(), "AAPL", REGULAR)
    assert spot == 231.5 and isinstance(spot, float)


def test_a_whole_number_price_comes_back_as_a_float():
    spot = mww._spot_from_snapshot_row(_row(price=231), "AAPL", REGULAR)
    assert spot == 231.0 and isinstance(spot, float)


@pytest.mark.parametrize("row", [
    None, [], "AAPL", {},
    _row(sym="MSFT"),
    _row(sym="aapl"),
    {"ticker": "AAPL"},
    {"ticker": "AAPL", "day": {"c": 230.0}, "prevDay": {"c": 229.0}, "min": {"c": 231.0}},
    _row(lastTrade=None),
    _row(lastTrade=[231.5]),
    _row(lastTrade={}),
])
def test_a_row_without_this_symbols_last_trade_is_not_usable(row):
    assert mww._spot_from_snapshot_row(row, "AAPL", REGULAR) is None


@pytest.mark.parametrize("price", [0, 0.0, -1.0, None, "231.5", True, float("nan"), float("inf")])
def test_a_price_that_is_not_a_positive_finite_number_is_not_usable(price):
    assert mww._spot_from_snapshot_row(_row(price=price), "AAPL", REGULAR) is None


@pytest.mark.parametrize("price", [0, 0.0, -1.0, -231.5])
@pytest.mark.parametrize("day", [None, {}, {"c": None}, {"c": 0}])
def test_a_zero_or_negative_price_is_not_usable_when_the_row_has_no_day_close(price, day):
    """The day-close bound cannot stand in for the price check: a row with no day
    close has nothing to compare against, and its price must still be positive."""
    assert mww._spot_from_snapshot_row(_row(price=price, day=day), "AAPL", REGULAR) is None


@pytest.mark.parametrize("stamp", [
    None, 0, -1, True, "1795017600000000000",
    int(REGULAR - 2) * 1000,            # milliseconds, not nanoseconds
    int(REGULAR - 2),                   # seconds
])
def test_a_trade_without_a_nanosecond_stamp_is_not_usable(stamp):
    last = {"p": 231.5} if stamp is None else {"p": 231.5, "t": stamp}
    assert mww._spot_from_snapshot_row(_row(lastTrade=last), "AAPL", REGULAR) is None


@pytest.mark.parametrize("age,usable", [
    (0, True), (30, True), (59, True),
    (61, False), (600, False), (3600, False),
    (-3, True),                         # a little clock skew is tolerated
    (-10, False),                       # a trade from the future is not
])
def test_the_trade_must_be_inside_the_freshness_window(age, usable):
    spot = mww._spot_from_snapshot_row(_row(at=REGULAR - age), "AAPL", REGULAR)
    assert (spot == 231.5) if usable else (spot is None)


def test_the_freshness_window_of_a_snapshot_trade_is_the_caches_own():
    assert mww._SPOT_SNAPSHOT_MAX_AGE_SEC == mww._SPOT_TTL_SEC == 60


@pytest.mark.parametrize("label,traded,usable", [
    ("two seconds before the open", _et(2026, 11, 18, 9, 29, 58), False),
    ("one second after the open", _et(2026, 11, 18, 9, 30, 1), True),
    ("mid-session", _et(2026, 11, 18, 11, 0), True),
    ("three seconds before the close", _et(2026, 11, 18, 15, 59, 57), True),
    ("one second after the close", _et(2026, 11, 18, 16, 0, 1), False),
    ("pre-market", _et(2026, 11, 18, 8, 0), False),
    ("after hours", _et(2026, 11, 18, 17, 0), False),
    ("a Saturday", _et(2026, 11, 21, 11, 0), False),
    ("a market holiday", _et(2026, 11, 26, 11, 0), False),
    ("a half-day morning", _et(2026, 11, 27, 12, 30), True),
    ("a half-day, one second after the 1pm close", _et(2026, 11, 27, 13, 0, 1), False),
    ("a half-day afternoon", _et(2026, 11, 27, 14, 0), False),
])
def test_only_a_trade_printed_in_the_regular_session_is_usable(label, traded, usable):
    """A pre-market or after-hours print is fresh and real, and still not the regular-session
    price the tape stores."""
    spot = mww._spot_from_snapshot_row(_row(at=traded), "AAPL", traded + 2)
    assert (spot == 231.5) if usable else (spot is None), label


def test_the_closing_print_is_still_usable_just_after_the_bell():
    traded = _et(2026, 11, 18, 15, 59, 50)
    assert mww._spot_from_snapshot_row(_row(at=traded), "AAPL", traded + 30) == 231.5


@pytest.mark.parametrize("price,day_close,usable", [
    (231.5, 230.0, True),
    (149.0, 100.0, True),
    (151.0, 100.0, False),              # more than 50% above the day's close
    (51.0, 100.0, True),
    (49.0, 100.0, False),               # more than 50% below it
    (231.5, 0, True),                   # no day close yet: nothing to compare with
    (231.5, None, True),
    (231.5, "230", True),
    (231.5, True, True),
])
def test_a_price_far_from_the_rows_own_day_close_is_not_usable(price, day_close, usable):
    spot = mww._spot_from_snapshot_row(_row(price=price, day_close=day_close), "AAPL", REGULAR)
    assert (spot == price) if usable else (spot is None)


@pytest.mark.parametrize("day", [None, [], "x"])
def test_a_row_without_a_day_bar_is_judged_on_its_trade_alone(day):
    assert mww._spot_from_snapshot_row(_row(day=day), "AAPL", REGULAR) == 231.5


def test_when_the_calendar_cannot_answer_no_snapshot_price_is_usable(monkeypatch):
    from api.services import session_calendar

    def boom(*a, **k):
        raise RuntimeError("no calendar")

    assert mww._spot_in_regular_session(REGULAR) is True
    monkeypatch.setattr(session_calendar, "session_at", boom)
    assert mww._spot_in_regular_session(REGULAR) is False
    assert mww._spot_from_snapshot_row(_row(), "AAPL", REGULAR) is None


# --- the snapshot call itself ----------------------------------------------------

def test_the_snapshot_read_is_one_bounded_call_for_all_symbols(tape):
    tape.massive.rows = {"AAPL": _row("AAPL"), "MSFT": _row("MSFT", 410.0, day_close=409.0)}
    out = mww._fetch_spot_snapshot_blocking(["AAPL", "MSFT"])
    assert set(out) == {"AAPL", "MSFT"} and out["MSFT"]["lastTrade"]["p"] == 410.0
    assert len(tape.massive.calls) == 1
    call = tape.massive.calls[0]
    assert call["url"] == SNAPSHOT + "?tickers=AAPL,MSFT&apiKey=test-key-not-prod"
    assert call["timeout"] == 3.0


def test_rows_are_keyed_by_the_ticker_each_row_names(tape):
    tape.massive.raw = json.dumps({"tickers": [
        _row("MSFT", 410.0), "junk", {"no": "ticker"}, {"ticker": 5}, None,
    ]}).encode("utf-8")
    assert set(mww._fetch_spot_snapshot_blocking(["AAPL"])) == {"MSFT"}


def _break_the_snapshot(tape, how):
    m = tape.massive
    if how == "timeout":
        m.fail = TimeoutError("timed out")
    elif how == "refused":
        m.fail = urllib.error.URLError("refused " + SNAPSHOT + "?apiKey=test-key-not-prod")
    elif how == "http 500":
        m.fail = urllib.error.HTTPError(SNAPSHOT + "?apiKey=test-key-not-prod", 500, "boom", {}, None)
    elif how == "http 429":
        m.fail = urllib.error.HTTPError(SNAPSHOT + "?apiKey=test-key-not-prod", 429, "slow down", {}, None)
    elif how == "status 500 with a body":
        m.status = 500
    elif how == "not json":
        m.raw = b"<html>bad gateway</html>"
    elif how == "a list":
        m.raw = b"[]"
    elif how == "tickers is a number":
        m.raw = b'{"tickers": 5}'
    else:
        raise AssertionError(how)


BROKEN = ["timeout", "refused", "http 500", "http 429", "status 500 with a body",
          "not json", "a list", "tickers is a number"]


@pytest.mark.parametrize("how", BROKEN)
def test_a_failed_snapshot_read_returns_nothing_and_never_raises(tape, how):
    tape.massive.rows["AAPL"] = _row("AAPL")
    _break_the_snapshot(tape, how)
    assert mww._fetch_spot_snapshot_blocking(["AAPL"]) == {}
    assert len(tape.massive.calls) == 1, "one attempt, no retry"


# --- the cycle: snapshot first, Yahoo for the rest --------------------------------

def test_a_stock_in_the_regular_session_reads_the_snapshot_and_not_yahoo(tape):
    tape.massive.rows["AAPL"] = _row("AAPL", 231.5)
    tape.yahoo.answers["AAPL"] = _chart(999.0)
    before = dict(mww._state)
    _drain(tape, ["AAPL"])
    assert mww._SPOT_CACHE == {"AAPL": (231.5, REGULAR)}, "same cache shape: (price, time)"
    assert isinstance(mww._SPOT_CACHE["AAPL"][0], float)
    assert len(tape.massive.calls) == 1 and tape.massive.tickers(0) == ["AAPL"]
    assert tape.yahoo.calls == []
    assert mww._state["spot_fetches_sent"] == before.get("spot_fetches_sent", 0) + 1
    assert mww._state["spot_symbols_resolved"] == before.get("spot_symbols_resolved", 0) + 1


def test_one_snapshot_call_carries_every_stock_and_etf_of_the_cycle(tape):
    syms = ["AAPL", "MSFT", "NVDA", "SPY", "QQQ"]
    for i, s in enumerate(syms):
        tape.massive.rows[s] = _row(s, 100.0 + i, day_close=100.0)
    _drain(tape, syms)
    assert len(tape.massive.calls) == 1, "one call for the cycle, not one per symbol"
    assert tape.massive.tickers(0) == syms
    assert tape.yahoo.calls == []
    assert mww._SPOT_CACHE == {s: (100.0 + i, REGULAR) for i, s in enumerate(syms)}


def test_the_snapshot_call_runs_off_the_event_loop_thread(tape):
    tape.massive.rows["AAPL"] = _row("AAPL")
    _drain(tape, ["AAPL"])
    assert tape.massive.calls[0]["on_main_thread"] is False


def test_index_roots_stay_on_yahoo_and_are_never_sent_to_the_snapshot(tape):
    batch = ["AAPL", "SPX", "MSFT", "VIX", "SPXW", "NDX", "DJX", "RUT", "XSP"]
    tape.massive.rows = {"AAPL": _row("AAPL", 231.5), "MSFT": _row("MSFT", 410.0, day_close=409.0)}
    for root in INDEX_ROOTS:                       # would answer, if it were ever asked
        tape.massive.rows[root] = _row(root, 1.0, day_close=1.0)
    for caret in set(INDEX_ROOTS.values()):
        tape.yahoo.answers[caret] = _chart(5000.0)
    _drain(tape, batch)
    assert tape.massive.tickers(0) == ["AAPL", "MSFT"]
    assert sorted(tape.yahoo.symbols()) == sorted(INDEX_ROOTS[r] for r in batch if r in INDEX_ROOTS)
    assert mww._SPOT_CACHE["AAPL"] == (231.5, REGULAR) and mww._SPOT_CACHE["MSFT"] == (410.0, REGULAR)
    for root in INDEX_ROOTS:
        assert mww._SPOT_CACHE[root] == (5000.0, REGULAR), root


def test_a_cycle_of_index_roots_only_makes_no_snapshot_call(tape):
    tape.yahoo.answers["^GSPC"] = _chart(6012.5)
    tape.yahoo.answers["^VIX"] = _chart(17.2)
    _drain(tape, ["SPX", "VIX", "SPXW"])
    assert tape.massive.calls == []
    assert set(mww._SPOT_CACHE) == {"SPX", "VIX", "SPXW"}


UNUSABLE = {
    "no row at all": None,
    "a zero price": _row("AAPL", 0),
    "a stale trade": _row("AAPL", 231.5, at=REGULAR - 300),
    "no last trade": {"ticker": "AAPL", "day": {"c": 230.0}, "prevDay": {"c": 229.5}},
    "a price far from the day's close": _row("AAPL", 500.0, day_close=230.0),
}


@pytest.mark.parametrize("why", sorted(UNUSABLE))
def test_a_stock_the_snapshot_cannot_price_falls_through_to_yahoo(tape, why):
    if UNUSABLE[why] is not None:
        tape.massive.rows["AAPL"] = UNUSABLE[why]
    tape.massive.rows["MSFT"] = _row("MSFT", 410.0, day_close=409.0)
    tape.yahoo.answers["AAPL"] = _chart(229.0)
    tape.yahoo.answers["MSFT"] = _chart(999.0)
    _drain(tape, ["AAPL", "MSFT"])
    assert len(tape.massive.calls) == 1
    assert tape.yahoo.symbols() == ["AAPL"], "only the symbol the snapshot could not price"
    assert mww._SPOT_CACHE == {"AAPL": (229.0, REGULAR), "MSFT": (410.0, REGULAR)}


@pytest.mark.parametrize("why", sorted(k for k, v in UNUSABLE.items() if v is not None))
def test_an_unusable_snapshot_price_is_never_stored_even_when_yahoo_fails_too(tape, why):
    tape.massive.rows["AAPL"] = UNUSABLE[why]
    tape.yahoo.answers["AAPL"] = _Resp(500, {})
    _drain(tape, ["AAPL"])
    assert tape.yahoo.symbols() == ["AAPL"]
    assert mww._SPOT_CACHE == {}


def test_a_row_for_a_symbol_nobody_queued_is_not_stored(tape):
    tape.massive.rows["AAPL"] = _row("AAPL", 231.5)
    tape.massive.extra = [_row("TSLA", 300.0, day_close=299.0)]
    _drain(tape, ["AAPL"])
    assert mww._SPOT_CACHE == {"AAPL": (231.5, REGULAR)}


def test_another_symbols_row_is_never_stored_under_the_symbol_asked_for(tape):
    tape.massive.raw = json.dumps({"tickers": [_row("MSFT", 410.0, day_close=409.0)]}).encode("utf-8")
    tape.yahoo.answers["AAPL"] = _chart(229.0)
    _drain(tape, ["AAPL"])
    assert mww._SPOT_CACHE == {"AAPL": (229.0, REGULAR)}


@pytest.mark.parametrize("how", BROKEN)
def test_a_snapshot_failure_sends_the_whole_cycle_to_yahoo(tape, how):
    tape.massive.rows = {"AAPL": _row("AAPL", 231.5), "MSFT": _row("MSFT", 410.0, day_close=409.0)}
    _break_the_snapshot(tape, how)
    tape.yahoo.answers = {"AAPL": _chart(229.0), "MSFT": _chart(408.0), "^GSPC": _chart(6012.5)}
    _drain(tape, ["AAPL", "MSFT", "SPX"])
    assert len(tape.massive.calls) == 1
    assert sorted(tape.yahoo.symbols()) == ["AAPL", "MSFT", "^GSPC"]
    assert mww._SPOT_CACHE == {
        "AAPL": (229.0, REGULAR), "MSFT": (408.0, REGULAR), "SPX": (6012.5, REGULAR)}


def test_the_cycle_after_a_snapshot_failure_reads_the_snapshot_again(tape):
    tape.massive.rows = {"AAPL": _row("AAPL", 231.5), "MSFT": _row("MSFT", 410.0, day_close=409.0)}
    tape.massive.fail = TimeoutError("timed out")
    tape.yahoo.answers["AAPL"] = _chart(229.0)

    def heal(_i):
        tape.massive.fail = None

    _drain(tape, ["AAPL"], ["MSFT"], between=heal)
    assert len(tape.massive.calls) == 2
    assert tape.yahoo.symbols() == ["AAPL"]
    assert mww._SPOT_CACHE == {"AAPL": (229.0, REGULAR), "MSFT": (410.0, REGULAR)}


def test_a_snapshot_that_hangs_is_abandoned_and_yahoo_answers(tape):
    tape.massive.hold = threading.Event()
    tape.loop.short[4.0] = 0.05
    tape.massive.rows["AAPL"] = _row("AAPL", 231.5)
    tape.yahoo.answers["AAPL"] = _chart(229.0)
    try:
        _drain(tape, ["AAPL"], [], between=lambda _i: tape.massive.hold.set())
    finally:
        tape.massive.hold.set()
    assert 4.0 in tape.loop.waits, "the whole snapshot read is bounded at four seconds"
    assert len(tape.massive.calls) == 1
    assert mww._SPOT_CACHE == {"AAPL": (229.0, REGULAR)}


@pytest.mark.parametrize("label,now", [
    ("pre-market", PRE_MARKET),
    ("after hours", AFTER_HOURS),
    ("thirty seconds after the close", _et(2026, 11, 18, 16, 0, 30)),
    ("a Saturday", SATURDAY),
    ("a market holiday", _et(2026, 11, 26, 11, 0)),
    ("a half-day afternoon", _et(2026, 11, 27, 13, 30)),
])
def test_outside_the_regular_session_the_snapshot_is_not_called(tape, label, now):
    """Pre-market, after hours and closed days keep the Yahoo regular-session price."""
    tape.clock.now = now
    tape.massive.rows["AAPL"] = _row("AAPL", 231.5, at=now - 2)
    tape.yahoo.answers["AAPL"] = _chart(229.0)
    _drain(tape, ["AAPL"])
    assert tape.massive.calls == [], label
    assert mww._SPOT_CACHE == {"AAPL": (229.0, now)}


def test_a_half_day_morning_reads_the_snapshot(tape):
    now = _et(2026, 11, 27, 11, 0)
    tape.clock.now = now
    tape.massive.rows["AAPL"] = _row("AAPL", 231.5, at=now - 2)
    _drain(tape, ["AAPL"])
    assert mww._SPOT_CACHE == {"AAPL": (231.5, now)} and tape.yahoo.calls == []


def test_when_the_calendar_cannot_answer_the_cycle_reads_yahoo(tape, monkeypatch):
    from api.services import session_calendar

    def boom(*a, **k):
        raise RuntimeError("no calendar")

    monkeypatch.setattr(session_calendar, "session_at", boom)
    tape.massive.rows["AAPL"] = _row("AAPL", 231.5)
    tape.yahoo.answers["AAPL"] = _chart(229.0)
    _drain(tape, ["AAPL"])
    assert tape.massive.calls == []
    assert mww._SPOT_CACHE == {"AAPL": (229.0, REGULAR)}


def test_without_a_key_the_snapshot_is_not_called(tape, monkeypatch):
    monkeypatch.setattr(mww, "MASSIVE_API_KEY", "")
    tape.massive.rows["AAPL"] = _row("AAPL", 231.5)
    tape.yahoo.answers["AAPL"] = _chart(229.0)
    _drain(tape, ["AAPL"])
    assert tape.massive.calls == []
    assert mww._SPOT_CACHE == {"AAPL": (229.0, REGULAR)}


def test_thirty_five_stocks_take_one_call_of_thirty_then_one_of_five(tape):
    syms = ["S%02dX" % i for i in range(35)]
    for s in syms:
        tape.massive.rows[s] = _row(s, 50.0, day_close=50.0)
    _drain(tape, syms, [])
    assert [len(tape.massive.tickers(i)) for i in range(len(tape.massive.calls))] == [30, 5]
    assert tape.massive.tickers(0) == syms[:30] and tape.massive.tickers(1) == syms[30:]
    assert tape.yahoo.calls == []
    assert set(mww._SPOT_CACHE) == set(syms)


def test_a_symbol_that_is_not_plain_letters_and_digits_is_never_put_in_the_url(tape):
    batch = ["AAPL", "BRK.B", "A&B", "ÄBC"]
    tape.massive.rows["AAPL"] = _row("AAPL", 231.5)
    _drain(tape, batch)
    assert tape.massive.tickers(0) == ["AAPL"]
    assert tape.massive.calls[0]["url"] == SNAPSHOT + "?tickers=AAPL&apiKey=test-key-not-prod"
    assert sorted(tape.yahoo.symbols()) == sorted(batch[1:]), "they read Yahoo, as before"


def test_the_cycle_log_says_how_many_came_from_the_snapshot(tape, caplog):
    caplog.set_level(logging.DEBUG)
    tape.massive.rows["AAPL"] = _row("AAPL", 231.5)
    tape.yahoo.answers["^GSPC"] = _chart(6012.5)
    _drain(tape, ["AAPL", "SPX"])
    assert "spot fetch: 2 symbols -> 2 resolved (1 from the Massive snapshot)" in caplog.text


@pytest.mark.parametrize("how", BROKEN)
def test_the_key_never_reaches_the_log(tape, caplog, how):
    caplog.set_level(logging.DEBUG)
    tape.massive.rows["AAPL"] = _row("AAPL", 231.5)
    _break_the_snapshot(tape, how)
    tape.yahoo.answers["AAPL"] = _chart(229.0)
    _drain(tape, ["AAPL"])
    assert "spot fetch: 1 symbols -> 1 resolved (0 from the Massive snapshot)" in caplog.text
    assert "test-key-not-prod" not in caplog.text
    assert "apiKey" not in caplog.text


# --- the stranded-row backfill keeps its print-time read -----------------------

def test_the_backfill_writes_the_minute_bar_of_the_print_not_a_current_price(tape, tmp_path, monkeypatch):
    import api.flow_db as flow_db

    db = tmp_path / "flow.db"
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE flow (id INTEGER PRIMARY KEY, Symbol TEXT, CreatedTime TEXT, "
                     "CreatedDate TEXT, source TEXT, Spot TEXT)")
        conn.execute("INSERT INTO flow VALUES (1, 'AAPL', '11:47:22 AM', '7/8/2026', 'stocks', '')")
        conn.execute("INSERT INTO flow VALUES (2, 'AAPL', '11:47:59 AM', '7/8/2026', 'stocks', '0')")
        conn.execute("INSERT INTO flow VALUES (3, 'AAPL', '2:05:00 PM', '7/8/2026', 'stocks', '212.10')")
        conn.commit()
    monkeypatch.setattr(flow_db, "FlowDB", lambda *a, **k: SimpleNamespace(db_path=str(db)))

    def bar(h, m):
        return int(datetime(2026, 7, 8, h, m, tzinfo=ET).astimezone(timezone.utc).timestamp())

    tape.yahoo.answers["AAPL"] = _Resp(200, {"chart": {"result": [{
        "timestamp": [bar(11, 46), bar(11, 47), bar(11, 48)],
        "meta": {"regularMarketPrice": 250.0},
        "indicators": {"quote": [{"close": [209.0, 210.25, 211.0]}]}}]}})

    result = mww.backfill_stranded_spots("7/8/2026")

    assert result["rows_updated"] == 2
    call = tape.yahoo.calls[0]
    assert call["url"] == YAHOO + "AAPL" and call["params"]["interval"] == "1m"
    assert {"period1", "period2"} <= set(call["params"]), "a read of that day, not of now"
    with sqlite3.connect(db) as conn:
        spots = dict(conn.execute("SELECT id, Spot FROM flow").fetchall())
    assert spots == {1: "210.25", 2: "210.25", 3: "212.10"}, "the 11:47 bar, never the current 250.00"
    assert tape.massive.calls == []
    assert mww._SPOT_CACHE == {}, "historical closes never enter the live cache"


# --- the backfill's clock is Eastern time, summer and winter --------------------

def _stranded_db(tmp_path, monkeypatch, rows):
    import api.flow_db as flow_db

    db = tmp_path / "flow.db"
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE flow (id INTEGER PRIMARY KEY, Symbol TEXT, CreatedTime TEXT, "
                     "CreatedDate TEXT, source TEXT, Spot TEXT)")
        conn.executemany("INSERT INTO flow VALUES (?, ?, ?, ?, ?, ?)", rows)
        conn.commit()
    monkeypatch.setattr(flow_db, "FlowDB", lambda *a, **k: SimpleNamespace(db_path=str(db)))
    return db


def _minute_bars(y, mo, d, bars):
    """A Yahoo 1-minute answer: `bars` is [(hour, minute, close)] on the Eastern clock."""
    return _Resp(200, {"chart": {"result": [{
        "timestamp": [int(_et(y, mo, d, h, m)) for h, m, _ in bars],
        "meta": {"regularMarketPrice": 999.0},
        "indicators": {"quote": [{"close": [c for _, _, c in bars]}]}}]}})


@pytest.mark.parametrize("label,y,mo,d", [
    ("summer (UTC-4)", 2026, 7, 8),
    ("winter (UTC-5)", 2026, 12, 9),
    ("the Monday after the clocks go back", 2026, 11, 2),
    ("the Monday after the clocks go forward", 2027, 3, 15),
])
def test_the_backfill_reads_eastern_time_in_both_halves_of_the_year(tape, tmp_path, monkeypatch,
                                                                    label, y, mo, d):
    """A print at 11:47 gets the 11:47 bar, never the bar an hour before or after it."""
    day = "%d/%d/%d" % (mo, d, y)
    db = _stranded_db(tmp_path, monkeypatch, [(1, "AAPL", "11:47:22 AM", day, "stocks", "")])
    tape.yahoo.answers["AAPL"] = _minute_bars(y, mo, d, [
        (10, 47, 100.0), (11, 47, 210.25), (12, 47, 300.0)])

    result = mww.backfill_stranded_spots(day)

    assert result["rows_updated"] == 1, label
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT Spot FROM flow").fetchone()[0] == "210.25", label


@pytest.mark.parametrize("y,mo,d", [(2026, 7, 8), (2026, 12, 9)])
def test_the_backfill_asks_for_eight_to_five_eastern_of_that_day(tape, tmp_path, monkeypatch, y, mo, d):
    day = "%d/%d/%d" % (mo, d, y)
    _stranded_db(tmp_path, monkeypatch, [(1, "AAPL", "11:47:22 AM", day, "stocks", "")])

    mww.backfill_stranded_spots(day)

    params = tape.yahoo.calls[0]["params"]
    assert params["period1"] == str(int(_et(y, mo, d, 8, 0)))
    assert params["period2"] == str(int(_et(y, mo, d, 17, 0)))


@pytest.mark.parametrize("label,now,expected", [
    ("a winter evening, already tomorrow four hours west of UTC",
     _et(2026, 12, 9, 23, 30), "12/9/2026"),
    ("a summer evening", _et(2026, 7, 8, 23, 30), "7/8/2026"),
    ("just after midnight Eastern, winter", _et(2026, 12, 10, 0, 5), "12/10/2026"),
    ("just after midnight Eastern, summer", _et(2026, 7, 9, 0, 5), "7/9/2026"),
])
def test_with_no_date_given_the_backfill_takes_today_on_the_eastern_clock(tape, tmp_path, monkeypatch,
                                                                          label, now, expected):
    _stranded_db(tmp_path, monkeypatch, [])
    tape.clock.now = now

    assert mww.backfill_stranded_spots()["target_date"] == expected, label
