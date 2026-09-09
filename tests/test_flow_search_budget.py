"""The Search materialisation budget: a heavy ticker must not own the lane.

⛔ THE PRODUCTION MEASUREMENT THAT FORCED THIS (2026-09-08, during RTH):
`BUILD_TIMEOUT_S` bounds the node subprocess. NOTHING bounded the SQLite -> CSV
materialisation that runs before it. One NVDA warm held the single search lane
for 7.5+ MINUTES and never reached node at all, while pod RSS climbed from
3.4 GB to 11.2 GB. While it ran, no other ticker could warm -- which is exactly
the starvation Slice 1 exists to remove, and it turned out to be job DURATION,
not lane count.

⛔ AND IT CHANGES NO SEMANTICS. Exceeding the budget is a DECLINE: the member is
already on the legacy raw-tape path and sees the same answer they see today. The
ticker cools off instead of holding the lane. Nothing about what Options Flow
computes is touched.

These go through the real endpoint. The three production defects this session
were all invisible to helper-level tests.
"""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import flow_router as fr
from api.flow_admin_auth import require_flow_user


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(fr.flow_router)          # already carries prefix=/api/flow
    app.dependency_overrides[require_flow_user] = lambda: {"via": "test"}
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(fr.flow_aggregate, "available", lambda: True)
    monkeypatch.setattr(fr, "_search_product_cache_get", lambda k: None)
    monkeypatch.setattr(fr, "_search_freshness", lambda sym, src: "1.0")
    with fr._SEARCH_WARMING_LOCK:
        fr._SEARCH_WARMING.clear()
        fr._WARM_FAILED_UNTIL.clear()
    yield
    with fr._SEARCH_WARMING_LOCK:
        fr._SEARCH_WARMING.clear()
        fr._WARM_FAILED_UNTIL.clear()


class _FakeDB:
    def __init__(self, chunks):
        self.chunks = chunks
        self.streamed = 0

    def stream_csv_symbol(self, sym, source="stocks", columns=None):
        for c in self.chunks:
            self.streamed += len(c)
            yield c


def _no_subprocess(monkeypatch):
    """Fail loudly if the build reaches node — a bounded miss must not."""
    def boom(*a, **k):
        raise AssertionError("spawned node despite exceeding the budget")
    monkeypatch.setattr(fr.subprocess, "run", boom)


def test_a_ticker_over_the_BYTE_budget_declines_without_spawning_node(client, monkeypatch):
    monkeypatch.setattr(fr, "_SEARCH_CSV_MAX_BYTES", 1024)
    fake = _FakeDB([b"x" * 512] * 20)           # 10 KB against a 1 KB ceiling
    monkeypatch.setattr(fr, "db", fake)
    _no_subprocess(monkeypatch)

    r = client.get("/api/flow/ticker-product/MU?source=stocks")

    assert r.status_code == 503
    assert "budget" in r.json()["error"]
    # ⛔ It must STOP streaming, not read everything and then complain.
    assert fake.streamed <= 1024 + 512, (
        f"kept materialising past the ceiling ({fake.streamed} bytes) -- the "
        "budget bounds nothing if it is only checked at the end")


def test_a_ticker_over_the_TIME_budget_declines(client, monkeypatch):
    monkeypatch.setattr(fr, "_SEARCH_CSV_DEADLINE_S", 0.0)   # everything overruns
    monkeypatch.setattr(fr, "db", _FakeDB([b"row\n", b"row\n"]))
    _no_subprocess(monkeypatch)

    r = client.get("/api/flow/ticker-product/NVDA?source=stocks")
    assert r.status_code == 503


def test_CONTROL_a_normal_ticker_still_builds(client, monkeypatch):
    """Without this, the two tests above would pass on an endpoint that declines
    everything — which would silently disable the whole product."""
    monkeypatch.setattr(fr, "db", _FakeDB([b"h\n", b"a,b\n"]))

    class _Proc:
        returncode = 0
        stdout = json.dumps({"product": {"all_directional": [], "TICKER_DB": []},
                             "rows": 1}).encode()
        stderr = b""
    monkeypatch.setattr(fr.subprocess, "run", lambda *a, **k: _Proc())

    r = client.get("/api/flow/ticker-product/ALIT?source=stocks")
    assert r.status_code == 200, r.text
    # httpx already transparently decodes Content-Encoding, so r.content is
    # the JSON — gunzipping it again is a test bug, not a product one.
    body = json.loads(r.content)
    assert body["ok"] is True and body["sym"] == "ALIT"


def test_the_lane_is_RELEASED_after_an_over_budget_decline(client, monkeypatch):
    """⛔ THE WHOLE POINT. If the budget returned while still holding the lock,
    it would trade a slow monopoly for a permanent one."""
    monkeypatch.setattr(fr, "_SEARCH_CSV_MAX_BYTES", 16)
    monkeypatch.setattr(fr, "db", _FakeDB([b"x" * 64]))
    _no_subprocess(monkeypatch)

    client.get("/api/flow/ticker-product/MU?source=stocks")
    assert fr._SEARCH_BUILD_LOCK.locked() is False, "the over-budget path leaked the lane"


def test_an_over_budget_WARM_puts_the_ticker_in_cooldown(monkeypatch):
    """So a member repeatedly searching a head ticker cannot re-enter the lane
    every time — which is how one symbol starved every other."""
    import threading
    monkeypatch.setattr(fr, "_SEARCH_CSV_MAX_BYTES", 16)
    monkeypatch.setattr(fr, "db", _FakeDB([b"x" * 64]))
    monkeypatch.setattr(fr.subprocess, "run",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("spawned node")))

    assert fr._spawn_search_warm("MU", "stocks", ("MU", "stocks", "1.0"), "1.0") is True
    for _ in range(200):
        with fr._SEARCH_WARMING_LOCK:
            if "MU" not in fr._SEARCH_WARMING:
                break
        threading.Event().wait(0.02)

    assert "MU" in fr.search_warm_state()["cooling_off"]
    assert fr._spawn_search_warm("MU", "stocks", ("MU", "stocks", "1.0"), "1.0") is False
