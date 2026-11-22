"""Request timing: api/services/request_timing.py + its admin route."""
from __future__ import annotations

import asyncio
import json
import threading
import time

import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.routers import request_timing as rt_router
from api.services import request_timing as rt


@pytest.fixture(autouse=True)
def clean(tmp_path, monkeypatch):
    monkeypatch.setenv("REQUEST_TIMING_DIR", str(tmp_path / "rt"))
    monkeypatch.delenv(rt.KILL_SWITCH, raising=False)
    # No background writer in these tests: tests that need a minute on disk drain the queue
    # themselves. A writer thread left running by an earlier test raced that drain and took a
    # minute first (1 run in 4 failed test_minutes_just_after_a_restart_are_reported_apart).
    monkeypatch.setattr(rt, "_writer_started", True)
    rt._reset_for_tests()
    yield
    rt._reset_for_tests()


def _app() -> FastAPI:
    app = FastAPI()

    @app.get("/api/bars/{sym}")
    def bars(sym: str):
        return {"sym": sym}

    @app.get("/api/boom")
    def boom():
        raise RuntimeError("no")

    @app.get("/api/stream/prices")
    def stream():
        def gen():
            yield b"data: 1\n\n"
            yield b"data: 2\n\n"
        return StreamingResponse(gen(), media_type="text/event-stream")

    app.include_router(rt_router.router)
    app.dependency_overrides[authmw.require_admin] = lambda: {"id": 1, "role": "admin"}
    app.add_middleware(rt.RequestTimingMiddleware)
    return app


# ── what a path becomes ───────────────────────────────────────────────────────

def test_a_ticker_an_id_and_a_query_never_reach_a_record():
    assert rt.path_class("/api/bars/NVDA?tf=D") == "/api/bars/:sym"
    assert rt.path_class("/api/bars/$IDX:hydrogen") == "/api/bars/:id"
    assert rt.path_class("/api/x/Mixed.Case") == "/api/x/:id"
    assert rt.path_class("/api/j2/notes/12345") == "/api/j2/notes/:id"
    assert rt.path_class("/api/share/n/abcdefghijklmnopqrstuvwxyz0123") == "/api/share/n/:id"
    assert rt.path_class("/api/auth/me") == "/api/auth/me"
    assert rt.path_class("/charts") == rt.PAGES
    assert rt.path_class("") == rt.PAGES


def test_quantiles_come_from_the_buckets_and_the_slowest_from_the_last():
    h = rt.new_hist()
    for ms in [3] * 90 + [400] * 9 + [45000]:
        rt.add(h, ms)
    assert rt.quantile(h, 0.50) == 5.0
    assert rt.quantile(h, 0.95) == 500.0
    assert rt.quantile(h, 1.0) == 45000.0
    assert rt.quantile(rt.new_hist(), 0.5) is None


# ── the layer ─────────────────────────────────────────────────────────────────

def test_a_request_is_recorded_by_class_and_answers_with_server_timing():
    client = TestClient(_app())
    r = client.get("/api/bars/NVDA?tf=D")
    assert r.status_code == 200 and r.json() == {"sym": "NVDA"}
    assert r.headers["server-timing"].startswith("app;dur=")
    s = rt.summary(1)
    assert [x["route"] for x in s["routes"]] == ["/api/bars/:sym"]
    assert s["all"]["requests"] == 1 and s["all"]["errors_5xx"] == 0
    assert "NVDA" not in json.dumps(s)


def test_a_handler_that_raises_is_counted_as_a_server_error():
    client = TestClient(_app(), raise_server_exceptions=False)
    assert client.get("/api/boom").status_code == 500
    s = rt.summary(1)
    assert s["all"]["requests"] == 1 and s["all"]["errors_5xx"] == 1


def test_a_stream_passes_through_message_by_message():
    """Driven as raw ASGI: every body message must reach `send` as its own message, in order, with
    the first one arriving before the app has finished. A layer that buffered would send one."""
    sent: list[tuple[str, bytes, bool]] = []
    finished = [False]

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"text/event-stream")]})
        await send({"type": "http.response.body", "body": b"data: 1\n\n", "more_body": True})
        await send({"type": "http.response.body", "body": b"data: 2\n\n", "more_body": False})
        finished[0] = True

    async def send(message):
        sent.append((message["type"], message.get("body", b""), finished[0]))

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    asyncio.run(rt.RequestTimingMiddleware(app)({"type": "http", "path": "/api/stream/prices", "method": "GET"}, receive, send))
    assert [(t, b) for t, b, _ in sent] == [("http.response.start", b""), ("http.response.body", b"data: 1\n\n"),
                                           ("http.response.body", b"data: 2\n\n")]
    assert not any(done for _, _, done in sent)
    assert rt.summary(1)["routes"][0]["route"] == "/api/stream/prices"


def test_a_recorder_that_fails_never_fails_the_request(monkeypatch):
    monkeypatch.setattr(rt, "path_class", lambda p: (_ for _ in ()).throw(ValueError("x")))
    r = TestClient(_app()).get("/api/bars/NVDA")
    assert r.status_code == 200 and r.json() == {"sym": "NVDA"}


def test_the_switch_makes_it_a_plain_pass_through(monkeypatch):
    monkeypatch.setenv(rt.KILL_SWITCH, "0")
    r = TestClient(_app()).get("/api/bars/NVDA")
    assert r.status_code == 200 and "server-timing" not in r.headers
    assert rt.summary(1)["all"]["requests"] == 0 and rt.summary(1)["enabled"] is False


def test_the_class_table_is_bounded():
    for i in range(rt.MAX_CLASSES + 50):
        rt.record(f"/api/x/route{i:04d}", 200, 1.0, now=6000.0)
    s = rt.summary(1, top=1000, now=6000.0)
    assert len(s["routes"]) == rt.MAX_CLASSES + 1
    assert {x["route"]: x["requests"] for x in s["routes"]}[rt.OTHER] == 50


# ── the thread pool reading ───────────────────────────────────────────────────

def test_a_slow_hop_is_starvation_when_tasks_wait_and_the_lock_when_tokens_are_free():
    s = rt.new_sampler()
    rt.add_sample(s, 4.0, 0.2, borrowed=3, waiting=0, total=64)       # healthy
    rt.add_sample(s, 900.0, 1.0, borrowed=64, waiting=12, total=64)   # no token to be had
    rt.add_sample(s, 700.0, 300.0, borrowed=9, waiting=0, total=64)   # tokens free, still slow
    assert (s["starved"], s["lock_like"], s["waiting_max"], s["borrowed_max"]) == (1, 1, 12, 64)


def test_a_starved_limiter_is_seen_by_the_real_probe():
    """One token, held by a thread that will not finish: the probe's hop cannot start, a task is
    waiting, and the reading says starved. Releasing it brings the hop time back."""
    import anyio
    import anyio.to_thread

    release = threading.Event()

    async def run() -> dict:
        limiter = anyio.to_thread.current_default_thread_limiter()
        was = limiter.total_tokens
        limiter.total_tokens = 1
        try:
            holder = asyncio.ensure_future(anyio.to_thread.run_sync(release.wait))
            await asyncio.sleep(0.05)
            state: dict = {}
            await rt.sample_once(state, 0.0)          # starts the hop; it queues behind the holder
            await asyncio.sleep(0.3)
            await rt.sample_once(state, 0.0)          # hop still in flight: reported at its age
            release.set()
            await holder
            await state["task"]
            return state
        finally:
            release.set()
            limiter.total_tokens = was

    state = asyncio.run(run())
    s = rt.summary(1)["threads"]
    assert s["tasks_waiting_max"] >= 1 and s["tokens_total"] == 1
    assert s["hop_max_ms"] >= 250 and s["seconds_starved_for_tokens"] == 1
    assert state["last"] >= 250


def test_the_verdict_follows_the_counters():
    now = 6_000_000.0
    for i in range(30):
        rt.record_sample(800.0, 0.0, 64, 5, 64, now=now)
    assert rt.summary(1, now=now)["verdict"].startswith("token starvation")
    rt._reset_for_tests()
    for i in range(30):
        rt.record_sample(800.0, 0.0, 4, 0, 64, now=now)
    assert rt.summary(1, now=now)["verdict"].startswith("interpreter lock")
    rt._reset_for_tests()
    rt.record_sample(3.0, 0.0, 4, 0, 64, now=now)
    assert rt.summary(1, now=now)["verdict"].startswith("no slow hops")
    rt._reset_for_tests()
    assert rt.summary(1, now=now)["verdict"] == "no samples in this window"


# ── disk ──────────────────────────────────────────────────────────────────────

def test_a_finished_minute_survives_a_restart_and_old_days_are_dropped(tmp_path):
    t = 1_800_000_000.0                      # some minute
    rt.record("/api/auth/me", 200, 40.0, now=t)
    rt.record("/api/auth/me", 502, 15000.0, now=t + 1)
    rt.record("/api/auth/me", 200, 30.0, now=t + 61)   # the minute changed: the first is handed on
    done = rt._q.get_nowait()
    rt.write_minute(done)
    old = dict(done, m=done["m"] - (rt.RETENTION_DAYS + 2) * 1440)
    rt.write_minute(old)                     # an old day's file ...
    empty = {"m": done["m"] + 1440, "g": rt.new_hist(), "r": {}, "s": rt.new_sampler()}
    rt.write_minute(empty)                   # ... is dropped when a new day's file starts
    files = sorted(p.name for p in (tmp_path / "rt").iterdir())
    assert len(files) == 2 and rt._day(old["m"]) + ".jsonl" not in files
    rt._reset_for_tests()                    # "restart": memory is gone
    s = rt.summary(2, now=t + 120)
    row = s["routes"][0]
    assert (row["route"], row["requests"], row["errors_5xx"], row["max_ms"]) == ("/api/auth/me", 2, 1, 15000.0)


def test_a_line_cut_short_by_a_restart_is_skipped(tmp_path):
    t = 1_800_000_000.0
    rt.record("/api/auth/me", 200, 40.0, now=t)
    rt.record("/api/auth/me", 200, 40.0, now=t + 61)
    rt.write_minute(rt._q.get_nowait())
    path = next((tmp_path / "rt").iterdir())
    with open(path, "a", encoding="utf-8") as f:
        f.write('{"m": 30000000, "g": [1, 2')
    rt._reset_for_tests()
    assert rt.summary(2, now=t + 120)["all"]["requests"] == 1


# ── the admin door ────────────────────────────────────────────────────────────

def test_the_admin_route_answers_the_summary_and_refuses_without_admin():
    app = _app()
    client = TestClient(app)
    client.get("/api/bars/NVDA")
    body = client.get("/api/admin/request-timing?hours=1").json()
    assert body["hours"] == 1 and body["all"]["requests"] >= 1 and "verdict" in body
    app.dependency_overrides.clear()
    assert client.get("/api/admin/request-timing").status_code in (401, 403)


# ── writes apart from reads, and the minutes after a restart apart from the rest ──────────────

def test_a_write_is_its_own_class_and_a_read_keeps_the_bare_path():
    t = 6_000_000.0
    rt.record("/api/auth/preferences", 200, 10.0, now=t)
    rt.record("/api/auth/preferences", 200, 10.0, now=t, method="HEAD")
    rt.record("/api/auth/preferences", 200, 4000.0, now=t, method="post")
    rt.record("/api/auth/preferences", 200, 5.0, now=t, method="BREW")
    got = {x["route"]: x["requests"] for x in rt.summary(1, now=t)["routes"]}
    assert got == {"/api/auth/preferences": 2, "POST /api/auth/preferences": 1, "OTHER /api/auth/preferences": 1}


def test_the_layer_records_the_requests_own_method():
    app = _app()

    @app.post("/api/save")
    def save():
        return {"ok": True}

    TestClient(app).post("/api/save")
    assert [x["route"] for x in rt.summary(1)["routes"]] == ["POST /api/save"]


def test_minutes_just_after_a_restart_are_reported_apart(monkeypatch):
    boot = 1_800_000_000.0
    monkeypatch.setattr(rt, "_BOOT", boot)
    rt.record("/api/auth/me", 200, 3000.0, now=boot + 30)       # the first minute
    rt.record("/api/auth/me", 200, 2000.0, now=boot + 240)      # still inside the window
    rt.record("/api/auth/me", 200, 20.0, now=boot + 900)        # settled; rolls the earlier minutes
    while not rt._q.empty():
        rt.write_minute(rt._q.get_nowait())
    s = rt.summary(1, now=boot + 960)["since_restart"]
    assert (s["after_boot"]["requests"], s["after_boot"]["minutes"], s["after_boot"]["max_ms"]) == (2, 2, 3000.0)
    assert (s["settled"]["requests"], s["settled"]["max_ms"]) == (1, 20.0)


def test_minutes_since_a_restart_are_also_reported_in_bands(monkeypatch):
    """The slow window after a restart measured ~18 min (2026-11-17), so the 5-minute split alone
    mixed minutes 5-18 into `settled`. The bands keep 5-10 and 10-20 apart from the settled 20+."""
    boot = 1_800_000_000.0
    monkeypatch.setattr(rt, "_BOOT", boot)
    # the boot minute itself: the minute starts before the process did, so its `up` is negative
    rt.record("/api/auth/me", 200, 4000.0, now=boot - 20)
    for up, ms in ((30, 3000.0), (400, 2000.0), (700, 1000.0), (1300, 20.0), (1400, 10.0)):
        rt.record("/api/auth/me", 200, ms, now=boot + up)
    rt.record("/api/auth/me", 200, 5.0, now=boot + 1500)       # rolls the earlier minutes
    while not rt._q.empty():
        rt.write_minute(rt._q.get_nowait())
    b = rt.summary(1, now=boot + 1560)["since_restart_bands"]
    assert {k: v["requests"] for k, v in b.items()} == {"0-5m": 2, "5-10m": 1, "10-20m": 1, "20m+": 3}
    assert b["0-5m"]["max_ms"] == 4000.0
    assert (b["5-10m"]["max_ms"], b["10-20m"]["max_ms"], b["20m+"]["max_ms"]) == (2000.0, 1000.0, 20.0)
