"""The head-ticker lane for the Search product (2026-10-11).

NVDA (465,358 rows / 65.8 MB) can never be derived inside the member budget, so it was always
"too big" -- a 15 s 503 on a cold pod. The heavy lane derives the SAME product behind the
member, one at a time, under a larger budget, and keeps the symbol's last good product (memory
+ disk). These go through the real endpoint, like the member-lane rails beside them.
"""
import gzip
import json
import threading
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import flow_router as fr
from api.flow_admin_auth import require_flow_user


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(fr.flow_router)
    app.dependency_overrides[require_flow_user] = lambda: {"via": "test"}
    return TestClient(app, raise_server_exceptions=False)


class _FakeDB:
    def __init__(self, chunks):
        self.chunks = chunks
        self.streams = 0

    def stream_csv_symbol(self, sym, source="stocks", columns=None, dates=None):
        self.streams += 1
        for c in self.chunks:
            yield c


class _Node:
    """A stand-in for the bundle whose product is a pure function of its stdin, so 'same input
    bytes' and 'same product' are the same claim."""
    def __init__(self):
        self.inputs = []

    def __call__(self, argv, input=None, capture_output=True, timeout=None):
        self.inputs.append(input)

        class P:
            returncode = 0
            stderr = b""
            stdout = json.dumps({"product": {"all_directional": [{"n": len(input)}],
                                             "TICKER_DB": [input.decode()[:40]]},
                                 "rows": input.count(b"\n")}).encode()
        return P()


@pytest.fixture(autouse=True)
def _isolate(monkeypatch, tmp_path):
    cache = {}
    version = {"v": "100.0"}
    monkeypatch.setenv("FLOW_PRODUCT_PERSIST_DIR", str(tmp_path / "products"))
    monkeypatch.setattr(fr.flow_aggregate, "available", lambda: True)
    monkeypatch.setattr(fr, "_search_product_cache_get", lambda k: cache.get(k))
    monkeypatch.setattr(fr, "_search_product_cache_put", lambda k, v: cache.__setitem__(k, v))
    monkeypatch.setattr(fr, "_search_freshness", lambda sym, src: version["v"])
    node = _Node()
    monkeypatch.setattr(fr.subprocess, "run", node)
    rows = [b"Symbol,Premium\n"] + [b"NVDA,%d\n" % i for i in range(400)]
    fake = _FakeDB(rows)
    monkeypatch.setattr(fr, "db", fake)
    monkeypatch.setattr(fr, "_SEARCH_CSV_MAX_BYTES", 1024)        # NVDA is "too big" for members
    monkeypatch.setattr(fr, "_HEAVY_CSV_MAX_BYTES", 1024 * 1024)  # and fits the heavy lane

    def _clear():
        with fr._TOO_BIG_LOCK:
            fr._TOO_BIG_UNTIL.clear()
        with fr._SEARCH_WARMING_LOCK:
            fr._SEARCH_WARMING.clear()
            fr._WARM_FAILED_UNTIL.clear()
        with fr._HEAVY_GUARD:
            fr._HEAVY_INFLIGHT.clear()
            fr._HEAVY_LAST_START.clear()
            fr._HEAVY_TOO_BIG_UNTIL.clear()
        with fr._LAST_GOOD_LOCK:
            fr._LAST_GOOD.clear()
            fr._LAST_GOOD_DISK_MISS.clear()
    _clear()
    yield {"cache": cache, "version": version, "node": node, "db": fake}
    _clear()


def _wait(pred, s=5.0):
    t = time.time()
    while time.time() - t < s:
        if pred():
            return True
        time.sleep(0.01)
    return False


def test_the_heavy_product_is_byte_for_byte_the_member_product(monkeypatch, _isolate):
    """PARITY: same rows in, same body out. Built once by the member lane under a budget that
    admits it, once by the heavy lane, and compared decoded."""
    monkeypatch.setattr(fr, "_SEARCH_CSV_MAX_BYTES", 1024 * 1024)
    st = fr._Stages("t")
    key = ("NVDA", "stocks", "100.0")
    member_gz, err = fr._build_search_product("NVDA", "stocks", key, "100.0", st)
    assert err is None
    _isolate["cache"].clear()
    with fr._LAST_GOOD_LOCK:
        fr._LAST_GOOD.clear()
    assert fr._heavy_build_now("NVDA", "stocks") == "built"
    heavy_gz = _isolate["cache"][key]
    assert gzip.decompress(heavy_gz) == gzip.decompress(member_gz)
    assert _isolate["node"].inputs[0] == _isolate["node"].inputs[1]


def test_an_over_budget_head_ticker_gets_its_full_product_after_the_heavy_lane_runs(client, _isolate):
    r = client.get("/api/flow/ticker-product/NVDA?source=stocks")
    assert r.status_code == 503 and "budget" in r.json()["error"]
    assert _wait(lambda: ("NVDA", "stocks", "100.0") in _isolate["cache"])
    r = client.get("/api/flow/ticker-product/NVDA?source=stocks")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sym"] == "NVDA" and body["version"] == r.headers["X-Flow-Version"] == "100.0"
    assert body["rows"] == 401 and "X-Flow-Window" not in r.headers


def test_after_a_restart_the_persisted_copy_answers_and_nothing_rebuilds(client, _isolate):
    assert fr._heavy_build_now("NVDA", "stocks") == "built"
    builds = len(_isolate["node"].inputs)
    _isolate["cache"].clear()                       # a redeploy: memory gone, disk kept
    with fr._LAST_GOOD_LOCK:
        fr._LAST_GOOD.clear()
        fr._LAST_GOOD_DISK_MISS.clear()
    r = client.get("/api/flow/ticker-product/NVDA?source=stocks&warm_only=1")
    assert r.status_code == 200 and r.headers["X-Flow-Cache"] == "hit"
    assert r.json()["version"] == "100.0"
    assert len(_isolate["node"].inputs) == builds


def test_a_head_ticker_that_printed_is_served_its_last_build_LABELLED(client, _isolate):
    assert fr._heavy_build_now("NVDA", "stocks") == "built"
    built = fr._LAST_GOOD[("NVDA", "stocks")]["built_at"]
    _isolate["version"]["v"] = "101.0"              # NVDA printed: the version moved
    with fr._HEAVY_GUARD:
        fr._HEAVY_LAST_START.clear()
    r = client.get("/api/flow/ticker-product/NVDA?source=stocks&warm_only=1&recent=1")
    assert r.status_code == 200
    assert r.headers["X-Flow-Cache"] == "stale-full"
    assert r.headers["X-Flow-Version"] == r.json()["version"] == "100.0"   # it says what it is
    assert abs(float(r.headers["X-Flow-Basis-As-Of"]) - built) < 2
    assert "X-Flow-Window" not in r.headers
    assert _wait(lambda: ("NVDA", "stocks", "101.0") in _isolate["cache"]), "no rebuild behind it"


def test_a_last_build_past_the_stale_limit_is_not_served(client, _isolate, monkeypatch):
    assert fr._heavy_build_now("NVDA", "stocks") == "built"
    fr._LAST_GOOD[("NVDA", "stocks")]["built_at"] -= fr._HEAVY_STALE_MAX_S + 5
    _isolate["version"]["v"] = "101.0"
    monkeypatch.setattr(fr, "_spawn_heavy_build", lambda sym, src: False)
    r = client.get("/api/flow/ticker-product/NVDA?source=stocks")
    assert r.headers.get("X-Flow-Cache") != "stale-full"


def test_CONTROL_a_member_buildable_ticker_never_gets_a_stale_answer(client, _isolate, monkeypatch):
    """Its persisted copy answers only while the version still matches."""
    monkeypatch.setattr(fr, "_SEARCH_CSV_MAX_BYTES", 1024 * 1024)
    monkeypatch.setattr(fr, "_PERSIST_MIN_BUILD_MS", 0)
    r = client.get("/api/flow/ticker-product/AMD?source=stocks")
    assert r.status_code == 200 and fr._LAST_GOOD[("AMD", "stocks")]["heavy"] is False
    _isolate["version"]["v"] = "101.0"
    _isolate["cache"].clear()
    r = client.get("/api/flow/ticker-product/AMD?source=stocks&warm_only=1")
    assert r.status_code == 503 and r.json()["error"] == "not warm"


def test_a_torn_persisted_copy_is_ignored(_isolate):
    assert fr._heavy_build_now("NVDA", "stocks") == "built"
    gz_path, meta_path = fr._persist_paths("NVDA", "stocks")
    with open(gz_path, "ab") as f:
        f.write(b"x")
    with fr._LAST_GOOD_LOCK:
        fr._LAST_GOOD.clear()
        fr._LAST_GOOD_DISK_MISS.clear()
    assert fr._last_good_get("NVDA", "stocks") is None


def test_the_heavy_lane_starts_one_build_per_symbol_per_refresh_window(_isolate, monkeypatch):
    release = threading.Event()
    real = fr._heavy_build_now
    monkeypatch.setattr(fr, "_heavy_build_now", lambda s, src: (release.wait(5), real(s, src)))
    assert fr._spawn_heavy_build("NVDA", "stocks") is True
    assert fr._spawn_heavy_build("NVDA", "stocks") is False        # in flight
    release.set()
    assert _wait(lambda: not fr._HEAVY_INFLIGHT)
    assert fr._spawn_heavy_build("NVDA", "stocks") is False        # inside the refresh window
    with fr._HEAVY_GUARD:
        fr._HEAVY_LAST_START.clear()
    assert fr._spawn_heavy_build("NVDA", "stocks") is True


def test_a_symbol_over_even_the_heavy_budget_sits_out(_isolate, monkeypatch):
    monkeypatch.setattr(fr, "_HEAVY_CSV_MAX_BYTES", 512)
    assert fr._heavy_build_now("NVDA", "stocks") == "failed"
    assert _isolate["node"].inputs == []
    with fr._HEAVY_GUARD:
        fr._HEAVY_LAST_START.clear()
    assert fr._spawn_heavy_build("NVDA", "stocks") is False


def test_the_handler_stays_a_plain_def():
    """It does blocking SQLite + subprocess work; an `async def` would run it on the loop."""
    import inspect
    assert not inspect.iscoroutinefunction(fr.get_flow_ticker_product)


def test_a_symbol_over_the_row_ceiling_is_refused_before_any_read(_isolate, monkeypatch):
    monkeypatch.setattr(fr, "_symbol_session_counts", lambda sym: [("10/9/2026", fr._HEAVY_MAX_ROWS + 1)])
    assert fr._heavy_build_now("SPXW", "stocks") == "failed"
    assert _isolate["db"].streams == 0 and _isolate["node"].inputs == []
