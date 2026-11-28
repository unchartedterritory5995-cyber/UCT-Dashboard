"""PEER's licensed peers (gap audit D7): the nightly held build of Massive related companies
(api/services/related_peers.py), the read order in groups.resolve_peers, the fallback, the source
label, the route's `prefer` switch and the dark switch. No vendor is called: the fetch is a stand-in.
"""
from __future__ import annotations

import json
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import groups
from api.services import related_peers as rp
from api.services.massive import _ERR

DAY = 86400.0
T0 = 1_800_000_000.0


class Clock:
    def __init__(self, t=T0):
        self.t = t

    def __call__(self):
        return self.t


class Vendor:
    """Answers by ticker: a list of tickers, or an exception (one per call when a list of them)."""

    def __init__(self, answers=None, default=None):
        self.answers = dict(answers or {})
        self.default = default if default is not None else ["MSFT", "GOOGL", "AMZN", "META"]
        self.calls = []

    def __call__(self, sym):
        self.calls.append(sym)
        a = self.answers.get(sym, self.default)
        if isinstance(a, list) and a and isinstance(a[0], Exception):
            exc = a.pop(0)
            if not a:
                self.answers[sym] = self.default
            raise exc
        if isinstance(a, Exception):
            raise a
        return {"status": "OK", "stock_symbol": sym, "results": [{"ticker": t} for t in a]}


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    rp._reset_for_tests()
    yield tmp_path
    rp._reset_for_tests()


def _held(tmp_path):
    with open(os.path.join(tmp_path, "related_peers", "peers_v1.json"), encoding="utf-8") as fh:
        return json.load(fh)


def _run(vendor, syms, clock=None, sleeps=None, **kw):
    sleeps = [] if sleeps is None else sleeps
    return rp.build(fetch=vendor, sleep=sleeps.append, now=clock or Clock(), syms=syms, **kw)


# ── parsing and the vendor path ──────────────────────────────────────────────────────────────

def test_parse_keeps_vendor_order_drops_self_dupes_and_junk():
    data = {"results": [{"ticker": "MSFT"}, {"ticker": "AAPL"}, {"ticker": "brk.b"}, {"ticker": "MSFT"},
                        {"ticker": ""}, {"nope": 1}, {"ticker": "X:BTCUSD"}]}
    assert rp.parse("AAPL", data) == ["MSFT", "BRK-B"]


def test_parse_shapes():
    assert rp.parse("AAPL", {"status": "OK"}) == []          # answered, nothing listed
    assert rp.parse("AAPL", {"results": "x"}) is None        # not the shape this code reads
    assert rp.parse("AAPL", None) is None


def test_vendor_path_uses_dot_class_shares_and_the_reference_class(monkeypatch):
    seen = {}

    class R:
        value = {"results": []}

    def fake_get(path, **kw):
        seen.update(path=path, **kw)
        return R()

    from api.services import massive_adapter
    monkeypatch.setattr(massive_adapter, "get", fake_get)
    rp._vendor_get("BRK-B")
    assert seen["path"] == "/v1/related-companies/BRK.B"
    assert seen["data_class"] == "reference"


# ── the nightly build ────────────────────────────────────────────────────────────────────────

def test_build_holds_every_stock_paced_and_counted(store):
    v, sleeps = Vendor(), []
    rec = _run(v, ["AAPL", "NVDA", "BRK-B"], sleeps=sleeps)
    assert rec["state"] == "done" and rec["calls"] == 3 and rec["ok"] == 3 and rec["held"] == 3
    assert v.calls == ["AAPL", "NVDA", "BRK-B"]
    assert sleeps == [rp.PACE_S, rp.PACE_S]                  # paced between stocks, not before the first
    held = _held(store)
    assert held["peers"]["AAPL"]["peers"] == ["MSFT", "GOOGL", "AMZN", "META"]
    assert held["last_run"]["calls"] == 3


def test_build_respects_the_nightly_cap_and_resumes_next_night(store):
    v, clock = Vendor(), Clock()
    syms = ["A1", "A2", "A3", "A4", "A5"]
    first = _run(v, syms, clock=clock, limit=2)
    assert first["calls"] == 2 and first["due"] == 5
    clock.t += DAY                                            # next night: only the three not yet held
    second = _run(v, syms, clock=clock, limit=10)
    assert second["calls"] == 3 and second["due"] == 3
    assert v.calls[2:] == ["A3", "A4", "A5"]
    clock.t += DAY                                            # nothing due inside the refresh age
    assert _run(v, syms, clock=clock)["calls"] == 0


def test_due_orders_missing_first_then_oldest(store):
    held = {"peers": {"OLD": {"at": T0 - 30 * DAY}, "OLDER": {"at": T0 - 40 * DAY}, "FRESH": {"at": T0 - DAY}}}
    assert rp.due(held, ["FRESH", "NEW", "OLD", "OLDER"], T0) == ["NEW", "OLDER", "OLD"]


def test_build_retries_a_transient_failure_then_holds_the_answer(store):
    v, sleeps = Vendor({"AAPL": [_ERR.transient("blip"), _ERR.rate_limited("slow", status=429)]}), []
    rec = _run(v, ["AAPL"], sleeps=sleeps)
    assert rec["ok"] == 1 and rec["failed"] == 0
    assert v.calls == ["AAPL", "AAPL", "AAPL"]
    assert sleeps == list(rp.RETRY_WAIT_S)


def test_build_gives_up_after_the_retries_and_keeps_the_old_answer(store):
    clock = Clock()
    _run(Vendor(), ["AAPL"], clock=clock)
    clock.t += 8 * DAY
    v = Vendor({"AAPL": _ERR.transient("down")})
    rec = _run(v, ["AAPL"], clock=clock)
    assert rec["failed"] == 1 and len(v.calls) == rp.RETRIES + 1
    assert _held(store)["peers"]["AAPL"]["at"] == T0          # the old answer is kept, still first in line


def test_build_stops_at_once_on_a_refused_key(store):
    v = Vendor({"A2": _ERR.auth_error("no", status=403)})
    rec = _run(v, ["A1", "A2", "A3"])
    assert rec["state"] == "stopped" and rec["reason"] == "refused" and rec["status"] == 403
    assert v.calls == ["A1", "A2"]
    assert _held(store)["last_run"]["reason"] == "refused"   # the reason survives a restart


def test_build_stops_when_the_route_is_not_there(store, monkeypatch):
    monkeypatch.setattr(rp, "NOT_FOUND_STOP", 3)
    v = Vendor(default=_ERR.not_found("404"))
    rec = _run(v, [f"S{i}" for i in range(10)])
    assert rec["reason"] == "route_not_found" and rec["calls"] == 3


def test_one_not_found_after_the_route_answered_is_held_as_none_listed(store, monkeypatch):
    monkeypatch.setattr(rp, "NOT_FOUND_STOP", 1)
    v = Vendor({"B": _ERR.not_found("404")})
    rec = _run(v, ["A", "B", "C"])
    assert rec["state"] == "done" and rec["not_found"] == 1 and rec["ok"] == 2
    assert _held(store)["peers"]["B"]["peers"] == []


def test_build_stops_after_failures_in_a_row(store, monkeypatch):
    monkeypatch.setattr(rp, "FAIL_STOP", 2)
    v = Vendor(default=_ERR.transient("down"))
    rec = _run(v, ["A", "B", "C", "D"])
    assert rec["reason"] == "failures_in_a_row" and rec["failed"] == 2


def test_build_drops_stocks_that_left_the_universe(store):
    clock = Clock()
    _run(Vendor(), ["AAPL", "GONE"], clock=clock)
    clock.t += 8 * DAY
    _run(Vendor(), ["AAPL"], clock=clock)
    assert set(_held(store)["peers"]) == {"AAPL"}


def test_build_writes_progress_as_it_goes(store, monkeypatch):
    monkeypatch.setattr(rp, "SAVE_EVERY", 2)
    writes = []
    real = rp._save
    monkeypatch.setattr(rp, "_save", lambda held, keep=None: (writes.append(len(held["peers"])), real(held, keep)))
    _run(Vendor(), ["A", "B", "C", "D", "E"])
    assert writes == [2, 4, 5]


# ── the dark switch ──────────────────────────────────────────────────────────────────────────

class FakeScheduler:
    def __init__(self):
        self.jobs = []

    def add_job(self, fn, **kw):
        self.jobs.append(kw["id"])


def test_switch_off_registers_nothing_and_runs_nothing(store, monkeypatch):
    monkeypatch.delenv(rp.FLAG, raising=False)
    s = FakeScheduler()
    assert rp.register(s) is False and s.jobs == []
    monkeypatch.setattr(rp, "build", lambda **kw: pytest.fail("built while switched off"))
    assert rp.run_nightly() == {"state": "skipped", "reason": "switched_off"}


def test_switch_on_registers_one_job(store, monkeypatch):
    monkeypatch.setenv(rp.FLAG, "1")
    s = FakeScheduler()
    assert rp.register(s) is True and s.jobs == ["related_peers_nightly"]


# ── the reader ───────────────────────────────────────────────────────────────────────────────

def test_held_peers_cuts_to_chartable_and_n_in_vendor_order(store):
    _run(Vendor(default=["MSFT", "OTCQ", "GOOGL", "AMZN", "META"]), ["AAPL"])
    ok = {"MSFT", "GOOGL", "AMZN", "META"}
    out = rp.held_peers("AAPL", 3, chartable=ok.__contains__, now=T0)
    assert out == {"peers": ["MSFT", "GOOGL", "AMZN"], "as_of": rp._iso(T0)}


def test_held_peers_none_when_too_few_too_old_or_absent(store):
    _run(Vendor(default=["MSFT", "GOOGL"]), ["AAPL"])
    assert rp.held_peers("AAPL", 12, now=T0) is None                         # fewer than MIN_PEERS
    _run(Vendor(), ["NVDA"])
    assert rp.held_peers("NVDA", 12, now=T0 + rp.MAX_SERVE_AGE_S + 1) is None  # too old to serve
    assert rp.held_peers("ZZZZ", 12, now=T0) is None                          # nothing held


def test_held_peers_reads_a_file_another_process_wrote(store):
    _run(Vendor(), ["AAPL"])
    rp._reset_for_tests()                                                      # a fresh process
    assert rp.held_peers("AAPL", 12, now=T0)["peers"][0] == "MSFT"


# ── read order in groups.resolve_peers ───────────────────────────────────────────────────────

AI_ANSWER = {"seed": "SNDK", "group_id": None, "peers": ["WDC", "STX"], "source": "ai"}


@pytest.fixture
def engine(monkeypatch):
    monkeypatch.setattr(groups, "resolve_primary_theme", lambda s: None)
    monkeypatch.setattr(groups, "_etf_theme_map", lambda: {})
    monkeypatch.setattr(groups, "_macro_peers", lambda seed, n: None)
    monkeypatch.setattr(groups, "_industry_peers", lambda seed, n: None)
    monkeypatch.setattr(groups, "_ai_peers", lambda seed, n: ["WDC", "STX"])
    monkeypatch.setattr(groups, "cap_universe_set", lambda: {"WDC", "STX", "MU", "INTC", "SNDK"})


def test_prefer_licensed_reads_the_held_set_first_and_names_the_source(store, engine, monkeypatch):
    _run(Vendor(default=["WDC", "MU", "STX", "INTC"]), ["SNDK"])
    monkeypatch.setattr(rp, "MAX_SERVE_AGE_S", 1e12)          # the test clock is in the future
    out = groups.resolve_peers("SNDK", 3, prefer_licensed=True)
    assert out == {"seed": "SNDK", "group_id": None, "group_name": "Related companies",
                   "peers": ["WDC", "MU", "STX"], "source": "licensed",
                   "source_name": "Massive related companies", "as_of": rp._iso(T0)}


def test_without_prefer_the_held_set_is_never_read(store, engine, monkeypatch):
    _run(Vendor(default=["WDC", "MU", "STX", "INTC"]), ["SNDK"])
    monkeypatch.setattr(rp, "MAX_SERVE_AGE_S", 1e12)          # the test clock is in the future
    assert groups.resolve_peers("SNDK", 3) == AI_ANSWER


def test_no_held_peers_falls_back_unchanged(store, engine):
    assert groups.resolve_peers("SNDK", 3, prefer_licensed=True) == groups.resolve_peers("SNDK", 3) == AI_ANSWER


def test_a_broken_store_falls_back_unchanged(store, engine, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("disk")
    monkeypatch.setattr(rp, "held_peers", boom)
    assert groups.resolve_peers("SNDK", 3, prefer_licensed=True) == AI_ANSWER


# ── the route's prefer switch ────────────────────────────────────────────────────────────────

@pytest.fixture
def route(monkeypatch):
    from api.routers import groups as gr
    app = FastAPI()
    app.include_router(gr.router)
    app.dependency_overrides[gr.require_paid] = lambda: {"plan": "pro"}
    seen = []

    def fake(sym, n, **kw):
        seen.append(kw)
        return {"seed": sym, "peers": [], "source": "none"}

    monkeypatch.setattr(gr.svc, "resolve_peers", fake)
    return TestClient(app), seen


def test_route_passes_prefer_licensed_only_when_asked(route):
    client, seen = route
    assert client.get("/api/groups/peers?sym=AAPL&n=12&prefer=licensed").status_code == 200
    assert client.get("/api/groups/peers?sym=AAPL&n=12").status_code == 200
    assert client.get("/api/groups/peers?sym=AAPL&n=12&prefer=other").status_code == 200
    assert seen == [{"prefer_licensed": True}, {}, {}]
