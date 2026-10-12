"""Time & Sales (COV-08 / FT-077, the T&S half) -- the tape, its load rules and its stream.

NO NETWORK. The Massive stream is never started: every seam into bar_stream / bar_broadcaster
(`_feed_ready`, `_add_interest`, `_remove_interest`, `_add_listener`, `_remove_listener`) is
stubbed per test, and prints are fed by calling the listener exactly as bar_stream's WS thread
would. One test uses bar_stream's REAL listener list (pure in-memory) to prove the listener is
registered only while somebody watches.
"""
import ast
import asyncio
import datetime as dt
import json
import pathlib
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from api.middleware import auth_middleware
from api.routers import time_and_sales as router_mod
from api.services import time_and_sales as tas

ET = ZoneInfo("America/New_York")
ROOT = pathlib.Path(__file__).resolve().parent.parent


class _Seams:
    def __init__(self):
        self.calls = []

    def install(self, monkeypatch, feed=True):
        monkeypatch.setattr(tas, "_feed_ready", lambda: feed)
        monkeypatch.setattr(tas, "_add_interest", lambda s: self.calls.append(("add_interest", s)))
        monkeypatch.setattr(tas, "_remove_interest", lambda s: self.calls.append(("remove_interest", s)))
        monkeypatch.setattr(tas, "_add_listener", lambda fn: self.calls.append(("add_listener", fn)))
        monkeypatch.setattr(tas, "_remove_listener", lambda fn: self.calls.append(("remove_listener", fn)))
        return self

    def kinds(self):
        return [c[0] for c in self.calls]


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    tas._reset_for_tests()
    monkeypatch.delenv("TIME_AND_SALES_ENABLED", raising=False)
    yield
    tas._reset_for_tests()


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("TIME_AND_SALES_ENABLED", "1")


@pytest.fixture
def seams(monkeypatch):
    return _Seams().install(monkeypatch)


def _trade(p, s, t=1_760_000_000_000, c=None):
    return {"p": p, "s": s, "t": t, "c": c}


# ── pure helpers ─────────────────────────────────────────────────────────────────────────


def test_tick_test_classifies_up_down_and_zero_ticks():
    assert tas.classify_tick(None, "", 10.0) == ""
    assert tas.classify_tick(10.0, "", 10.01) == "up"
    assert tas.classify_tick(10.01, "up", 10.0) == "down"
    assert tas.classify_tick(10.0, "down", 10.0) == "zdown"
    assert tas.classify_tick(10.0, "zdown", 10.0) == "zdown"
    assert tas.classify_tick(10.0, "up", 10.0) == "zup"
    assert tas.classify_tick(10.0, "zup", 10.0) == "zup"
    assert tas.classify_tick(10.0, "", 10.0) == ""


def test_size_tier_marks_large_and_block_prints():
    assert tas.size_tier(10.0, 100) == 0
    assert tas.size_tier(10.0, tas.LARGE_SHARES) == 1          # 10,000 shares
    assert tas.size_tier(250.0, 800) == 1                       # $200k notional
    assert tas.size_tier(250.0, 799) == 0
    assert tas.size_tier(500.0, 2000) == 2                      # $1M notional
    assert tas.size_tier(5.0, 300_000) == 2


def test_session_state_by_eastern_clock():
    mon = dt.datetime(2026, 10, 12, tzinfo=ET)                  # a Monday
    at = lambda h, m: mon.replace(hour=h, minute=m)             # noqa: E731
    assert tas.session_state(at(3, 59)) == "closed"
    assert tas.session_state(at(4, 0)) == "pre"
    assert tas.session_state(at(9, 29)) == "pre"
    assert tas.session_state(at(9, 30)) == "regular"
    assert tas.session_state(at(15, 59)) == "regular"
    assert tas.session_state(at(16, 0)) == "post"
    assert tas.session_state(at(20, 0)) == "closed"
    assert tas.session_state(dt.datetime(2026, 10, 11, 12, 0, tzinfo=ET)) == "closed"   # Sunday


def test_symbols_are_normalised_to_the_upstream_form():
    assert tas.normalize_symbol(" brk-b ") == "BRK.B"
    assert tas.normalize_symbol("nvda") == "NVDA"


# ── the flag ─────────────────────────────────────────────────────────────────────────────


def test_flag_is_off_by_default_and_read_per_call(monkeypatch):
    assert tas.enabled() is False
    monkeypatch.setenv("TIME_AND_SALES_ENABLED", "1")
    assert tas.enabled() is True
    monkeypatch.setenv("TIME_AND_SALES_ENABLED", "0")
    assert tas.enabled() is False


def test_flag_off_watch_subscribes_and_registers_nothing(seams):
    ok, reason = tas.watch("NVDA", "u1")
    assert (ok, reason) == (False, "off")
    assert seams.calls == []
    assert tas.status()["streams_open"] == 0


# ── watch / unwatch: subscribe only while watched ────────────────────────────────────────


def test_first_watcher_subscribes_last_watcher_releases(on, seams):
    assert tas.watch("NVDA", "u1") == (True, "")
    assert tas.watch("NVDA", "u2") == (True, "")
    assert seams.kinds() == ["add_listener", "add_interest"]       # once each, not per stream
    tas.unwatch("NVDA", "u1")
    assert seams.kinds() == ["add_listener", "add_interest"]       # still one watcher
    tas.unwatch("NVDA", "u2")
    assert seams.kinds() == ["add_listener", "add_interest", "remove_interest", "remove_listener"]
    st = tas.status()
    assert st["streams_open"] == 0 and st["symbols_watched"] == 0 and st["listener_registered"] is False


def test_listener_stays_while_another_symbol_is_watched(on, seams):
    tas.watch("NVDA", "u1")
    tas.watch("AAPL", "u1")
    tas.unwatch("NVDA", "u1")
    assert "remove_listener" not in seams.kinds()
    assert ("remove_interest", "NVDA") in seams.calls
    tas.unwatch("AAPL", "u1")
    assert seams.kinds()[-1] == "remove_listener"


def test_an_unmatched_unwatch_is_a_no_op(on, seams):
    tas.unwatch("NVDA", "u1")
    assert seams.calls == [] and tas.status()["streams_open"] == 0


def test_no_feed_refuses_without_subscribing(on, monkeypatch):
    s = _Seams().install(monkeypatch, feed=False)
    assert tas.watch("NVDA", "u1") == (False, "feed_off")
    assert s.calls == []


def test_the_real_bar_stream_listener_list_holds_us_only_while_watched(on, monkeypatch):
    from api.services import bar_stream
    monkeypatch.setattr(tas, "_feed_ready", lambda: True)
    monkeypatch.setattr(tas, "_add_interest", lambda s: None)
    monkeypatch.setattr(tas, "_remove_interest", lambda s: None)
    before = list(bar_stream._trade_listeners)
    assert tas.on_trade not in before
    tas.watch("NVDA", "u1")
    assert tas.on_trade in bar_stream._trade_listeners
    tas.unwatch("NVDA", "u1")
    assert bar_stream._trade_listeners == before


# ── caps ─────────────────────────────────────────────────────────────────────────────────


def test_symbol_cap(on, seams, monkeypatch):
    monkeypatch.setattr(tas, "MAX_SYMBOLS", 2)
    assert tas.watch("A", "u1")[0] and tas.watch("B", "u2")[0]
    n = len(seams.calls)
    assert tas.watch("C", "u3") == (False, "symbol_cap")
    assert len(seams.calls) == n
    assert tas.watch("A", "u4") == (True, "")          # an already-watched symbol still admits


def test_stream_cap_and_per_member_cap(on, seams, monkeypatch):
    monkeypatch.setattr(tas, "MAX_STREAMS_PER_USER", 2)
    assert tas.watch("A", "u1")[0] and tas.watch("B", "u1")[0]
    assert tas.watch("C", "u1") == (False, "user_cap")
    monkeypatch.setattr(tas, "MAX_STREAMS", 3)
    assert tas.watch("C", "u2")[0]
    assert tas.watch("D", "u3") == (False, "at_capacity")
    assert tas.status()["refused_total"] == 2


# ── the ring ─────────────────────────────────────────────────────────────────────────────


def test_prints_for_unwatched_symbols_are_ignored(on, seams):
    tas.on_trade("NVDA", _trade(100.0, 10))
    assert tas.prints_since("NVDA") == ([], 0)


def test_prints_are_recorded_classified_and_flagged(on, seams):
    tas.watch("NVDA", "u1")
    tas.on_trade("NVDA", _trade(100.00, 50))                 # odd lot, first print
    tas.on_trade("NVDA", _trade(100.05, 300, c=[14, 41]))     # uptick
    tas.on_trade("NVDA", _trade(100.05, 2_500))               # zero-uptick, $250k = large
    tas.on_trade("NVDA", _trade(99.90, 12_000))               # downtick, $1.2M = block
    rows, seq = tas.prints_since("NVDA")
    assert seq == 4
    assert [r["d"] for r in rows] == ["", "up", "zup", "down"]
    assert [r["b"] for r in rows] == [0, 0, 1, 2]
    assert [r["o"] for r in rows] == [1, 0, 0, 0]
    assert rows[1]["c"] == [14, 41]
    assert tas.prints_since("NVDA", 3)[0] == [rows[3]]


def test_bad_prints_are_dropped_and_never_raise(on, seams):
    tas.watch("NVDA", "u1")
    tas.on_trade("NVDA", {"p": None, "s": 5, "t": 1})
    tas.on_trade("NVDA", {"p": 0, "s": 5, "t": 1})
    tas.on_trade("NVDA", {"p": 1.0, "s": -5, "t": 1})
    tas.on_trade("NVDA", "garbage")
    assert tas.prints_since("NVDA") == ([], 0)


def test_the_ring_is_bounded(on, seams):
    tas.watch("NVDA", "u1")
    for i in range(tas.BUFFER_PRINTS + 50):
        tas.on_trade("NVDA", _trade(100 + i * 0.01, 100, t=i))
    rows, seq = tas.prints_since("NVDA")
    assert seq == tas.BUFFER_PRINTS + 50
    assert len(rows) == tas.BUFFER_PRINTS
    assert rows[0]["seq"] == 51


def test_class_share_prints_match_the_dotted_upstream_name(on, seams):
    tas.watch("BRK-B", "u1")
    tas.on_trade("BRK.B", _trade(470.0, 100))
    assert len(tas.prints_since("BRK-B")[0]) == 1


def test_a_buffer_outlives_its_last_watcher_for_the_closed_market_view(on, seams, monkeypatch):
    tas.watch("NVDA", "u1")
    tas.on_trade("NVDA", _trade(100.0, 100))
    tas.unwatch("NVDA", "u1")
    tas.on_trade("NVDA", _trade(101.0, 100))                 # unwatched: not recorded
    rows, _ = tas.prints_since("NVDA")
    assert [r["p"] for r in rows] == [100.0]
    monkeypatch.setattr(tas, "MAX_RETAINED", 1)
    tas.watch("AAPL", "u1"); tas.unwatch("AAPL", "u1")       # noqa: E702
    assert tas.status()["buffers_held"] == 1                 # NVDA evicted, LRU


# ── the stream (router) ──────────────────────────────────────────────────────────────────


def _app(user=None):
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[router_mod.require_paid] = lambda: user or {"id": "u1"}
    app.dependency_overrides[auth_middleware.require_admin] = lambda: {"id": "admin"}
    return app


def _events(text):
    out = []
    for block in text.strip().split("\n\n"):
        name, data = None, None
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        out.append((name, data))
    return out


def test_routes_are_gated_paid_stream_and_admin_status():
    routes = {r.path: r for r in router_mod.router.routes if isinstance(r, APIRoute)}
    assert set(routes) == {"/api/stream/time-and-sales/{sym}", "/api/time-and-sales/status"}

    def calls(route):
        seen = []

        def walk(dep):
            if dep.call is not None:
                seen.append(dep.call)
            for sub in dep.dependencies:
                walk(sub)
        walk(route.dependant)
        return seen

    assert router_mod.require_paid in calls(routes["/api/stream/time-and-sales/{sym}"])
    assert auth_middleware.require_admin in calls(routes["/api/time-and-sales/status"])


def test_the_stream_path_is_gzip_exempt():
    from api import main
    assert main._is_gzip_exempt("/api/stream/time-and-sales/NVDA")


def test_flag_off_stream_answers_one_unavailable_event_and_touches_nothing(seams):
    with TestClient(_app()) as c:
        r = c.get("/api/stream/time-and-sales/NVDA")
    assert r.status_code == 200
    assert _events(r.text) == [("unavailable", {"reason": "off"})]
    assert seams.calls == []


def test_a_refused_watch_streams_its_reason(on, seams, monkeypatch):
    monkeypatch.setattr(tas, "MAX_STREAMS", 0)
    with TestClient(_app()) as c:
        r = c.get("/api/stream/time-and-sales/NVDA")
    assert _events(r.text) == [("unavailable", {"reason": "at_capacity"})]
    assert seams.calls == []


def test_a_bad_symbol_is_a_400(on, seams):
    with TestClient(_app()) as c:
        assert c.get("/api/stream/time-and-sales/1$$").status_code == 400


def test_status_reports_counters(on, seams):
    with TestClient(_app()) as c:
        body = c.get("/api/time-and-sales/status").json()
    assert body["enabled"] is True and body["streams_open"] == 0
    assert body["caps"]["buffer_prints"] == tas.BUFFER_PRINTS


class _FakeRequest:
    """Reports a disconnect after `alive` checks, like Starlette's is_disconnected."""

    def __init__(self, alive, on_check=None):
        self.alive = alive
        self.on_check = on_check
        self.checks = 0

    async def is_disconnected(self):
        self.checks += 1
        if self.on_check:
            self.on_check(self.checks)
        return self.checks > self.alive


async def _drain(response):
    out = []
    async for chunk in response.body_iterator:
        out.append(chunk if isinstance(chunk, str) else chunk.decode())
    return "".join(out)


def test_stream_sends_snapshot_then_batched_prints_and_always_unwatches(on, seams, monkeypatch):
    monkeypatch.setattr(router_mod, "PUSH_INTERVAL_S", 0)
    tas_watch = tas.watch
    tas.watch("NVDA", "seed")                                # buffer with history
    tas.on_trade("NVDA", _trade(100.0, 100))

    def feed(n):
        if n == 1:                                           # three prints land between pushes
            for p in (100.1, 100.2, 100.15):
                tas.on_trade("NVDA", _trade(p, 200))

    req = _FakeRequest(alive=3, on_check=feed)
    resp = asyncio.run(router_mod.time_and_sales_stream("nvda", req, {"id": "u1"}))
    text = asyncio.run(_drain(resp))
    ev = _events(text)
    assert ev[0][0] == "snapshot"
    assert ev[0][1]["sym"] == "NVDA" and ev[0][1]["method"] == "tick"
    assert [p["p"] for p in ev[0][1]["prints"]] == [100.0]
    batched = [d for n, d in ev[1:] if n is None]
    assert len(batched) == 1                                 # ONE event for three prints
    assert [p["p"] for p in batched[0]["prints"]] == [100.1, 100.2, 100.15]
    assert tas.status()["streams_open"] == 1                 # only the seed watcher remains
    assert tas.status()["pushes_total"] == 1
    assert tas_watch is tas.watch


def test_switching_the_flag_off_ends_an_open_stream(on, seams, monkeypatch):
    monkeypatch.setattr(router_mod, "PUSH_INTERVAL_S", 0)
    monkeypatch.setattr(router_mod, "FLAG_RECHECK_S", 0)

    def flip(n):
        if n == 2:
            monkeypatch.setenv("TIME_AND_SALES_ENABLED", "0")

    req = _FakeRequest(alive=1000, on_check=flip)
    resp = asyncio.run(router_mod.time_and_sales_stream("NVDA", req, {"id": "u1"}))
    ev = _events(asyncio.run(_drain(resp)))
    assert ev[-1] == ("unavailable", {"reason": "off"})
    assert req.checks < 10
    assert tas.status()["streams_open"] == 0
    assert seams.kinds()[-2:] == ["remove_interest", "remove_listener"]


# ── no database, no new upstream connection ──────────────────────────────────────────────


@pytest.mark.parametrize("rel", ["api/services/time_and_sales.py", "api/routers/time_and_sales.py"])
def test_no_database_and_no_socket_of_its_own(rel):
    tree = ast.parse((ROOT / rel).read_text(encoding="utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert not imported & {"sqlite3", "websockets", "websocket", "httpx", "requests", "aiohttp"}
