"""End-to-end tests for the /api/stream/bars SSE endpoint.

⛔ TestClient MAY ONLY BE USED FOR THE REJECTION PATHS (503 / 400).
`TestClient.get()` on a request the endpoint ACCEPTS never returns: httpx's
in-memory ASGI transport buffers the whole body and only completes when the
generator exits, and `stream_bars`' generator is `while True`. That is not a
hypothetical — `test_stream_bars_400_when_60min_only` asserted a 400 for
`AAPL:60` long after the allow-list gained "60" (2026-05-22, canonical
ET-anchored bucket), so the endpoint answered 200 and this FILE HUNG FOREVER,
taking the whole run with it. Any test that expects a 200 goes through the real
uvicorn server in `_serve()` with `stream=True` and a socket timeout.

⚠️ `@pytest.mark.timeout(...)` was decorating two tests here and pytest-timeout
is NOT installed in this repo — an unregistered mark is silently ignored, so
those were a gate that could not fail. They are replaced by
`_hang_watchdog`, a faulthandler-based bound that is real with stdlib only.
"""

import faulthandler
import json
import socket
import threading
import time
from contextlib import contextmanager

import pytest
import requests
import uvicorn
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import stream as stream_router
import api.services.bar_broadcaster as bar_broadcaster


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(stream_router.router)
    return app


def _free_port() -> int:
    s = socket.socket()
    s.bind(("", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@contextmanager
def _serve(app: FastAPI):
    """Run `app` on a real TCP port for the duration of the block.

    A real HTTP server is the only way to observe an accepted SSE response
    without buffering the (infinite) body — see the module docstring."""
    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    deadline = time.time() + 3.0
    started = False
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                started = True
                break
        except OSError:
            time.sleep(0.05)
    if not started:
        server.should_exit = True
        pytest.fail("uvicorn did not start within 3s")

    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        # Join so a leaked server can't hold the port (or the loop) into the
        # next test. Bounded: the thread is a daemon, so a stuck one cannot
        # wedge the run either way.
        thread.join(timeout=5.0)


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

# Wall-clock bound per test. Generous — the slowest test here boots uvicorn and
# waits on a pushed bar — but finite, which the removed marker was not.
_HANG_WATCHDOG_SECONDS = 60.0


@pytest.fixture(autouse=True)
def _hang_watchdog():
    """A REAL timeout for a file whose whole failure mode is hanging.

    `faulthandler.dump_traceback_later(..., exit=True)` is stdlib and needs no
    plugin: on expiry it prints every thread's stack (naming exactly what is
    blocked) and kills the process, so a future hang surfaces as a nonzero exit
    with evidence instead of a run that never finishes."""
    faulthandler.dump_traceback_later(_HANG_WATCHDOG_SECONDS, exit=True)
    try:
        yield
    finally:
        faulthandler.cancel_dump_traceback_later()


@pytest.fixture(autouse=True)
def reset_broadcaster():
    """Ensure each test gets a clean broadcaster singleton."""
    bar_broadcaster.reset_broadcaster_for_tests()
    yield
    bar_broadcaster.reset_broadcaster_for_tests()


# ---------------------------------------------------------------------------
# Test 1 — 503 when STREAM_BARS_ENABLED is not set
# ---------------------------------------------------------------------------

def test_stream_bars_503_when_disabled(monkeypatch):
    monkeypatch.delenv("STREAM_BARS_ENABLED", raising=False)
    bar_broadcaster.init_broadcaster()
    app = _make_app()
    client = TestClient(app, raise_server_exceptions=False)

    resp = client.get("/api/stream/bars?bars=AAPL:1")
    assert resp.status_code == 503


# ---------------------------------------------------------------------------
# Test 2 — 400 when no valid sym:tf pairs survive parsing
# ---------------------------------------------------------------------------

def test_stream_bars_400_when_no_valid_pairs(monkeypatch):
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    bar_broadcaster.init_broadcaster()
    app = _make_app()
    client = TestClient(app, raise_server_exceptions=False)

    resp = client.get("/api/stream/bars?bars=invalid")
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Test 3 — the tf allow-list, pinned from BOTH sides
#
# 3a: a well-formed pair with an unsupported tf is still rejected (without this,
#     "60 is accepted" would also pass an endpoint that accepted anything).
# 3b: 60-min IS accepted. It was excluded in v1 and added 2026-05-22 alongside
#     the canonical ET-anchored bucket (bars_fetch.bucket_60_et_unix_seconds);
#     bar_broadcaster.ROLLUP_TFS and StockChart's realtimeTfEligible carry the
#     same "60". The old assertion here (400) had gone stale against a shipped,
#     documented product change — and because a 200 on this route is an infinite
#     stream, the stale assertion did not fail, it HUNG.
# ---------------------------------------------------------------------------

def test_stream_bars_400_for_a_wellformed_pair_with_an_unsupported_tf(monkeypatch):
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    bar_broadcaster.init_broadcaster()
    app = _make_app()
    client = TestClient(app, raise_server_exceptions=False)

    # Safe under TestClient precisely BECAUSE it is rejected — a rejection is a
    # finite JSON body. Never point TestClient at a tf the endpoint accepts.
    resp = client.get("/api/stream/bars?bars=AAPL:7")
    assert resp.status_code == 400


def test_stream_bars_accepts_60min_pairs(monkeypatch):
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    bb = bar_broadcaster.init_broadcaster()
    app = _make_app()

    with _serve(app) as base:
        resp = requests.get(f"{base}/api/stream/bars?bars=AAPL:60", stream=True, timeout=5)
        try:
            assert resp.status_code == 200, (
                "60-min streaming is a shipped invariant (stream.py allow-list, "
                "bar_broadcaster.ROLLUP_TFS, StockChart.realtimeTfEligible)"
            )
            assert "text/event-stream" in resp.headers.get("content-type", "")
            # The endpoint really subscribed — a 200 with no subscription would
            # be an empty pipe that still looks healthy from the outside.
            deadline = time.time() + 3.0
            while time.time() < deadline and bb.get_status()["subscriber_pairs"] < 1:
                time.sleep(0.05)
            assert bb.get_status()["subscriber_pairs"] == 1
        finally:
            resp.close()


# ---------------------------------------------------------------------------
# Test 4 — Full E2E: push a bar and receive it as an SSE event
#
# Uses a real uvicorn server bound to a free TCP port because httpx's in-memory
# ASGI transport (used by TestClient) buffers the entire response body and only
# delivers bytes to the client when the generator finishes — which never happens
# for an infinite SSE generator.  A real HTTP server has no such limitation.
# ---------------------------------------------------------------------------

def test_stream_bars_delivers_pushed_bar_as_sse_event(monkeypatch):
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    bb = bar_broadcaster.init_broadcaster()
    app = _make_app()

    BAR = {"t": 1746468600000, "o": 150.0, "h": 151.0, "l": 149.5, "c": 150.8, "v": 5000}
    received_event = threading.Event()
    result: dict = {}

    def push_after_delay():
        time.sleep(0.3)
        bb.push_minute_bar("AAPL", BAR)

    push_thread = threading.Thread(target=push_after_delay, daemon=True)
    push_thread.start()

    with _serve(app) as base:
        resp = requests.get(f"{base}/api/stream/bars?bars=AAPL:1", stream=True, timeout=8)
        try:
            assert resp.status_code == 200
            assert "text/event-stream" in resp.headers.get("content-type", "")

            # The read timeout above bounds SILENCE, not the loop: a stream that
            # keeps heart-beating could iterate forever without ever delivering a
            # bar. This deadline bounds the loop itself.
            read_deadline = time.time() + 10.0
            lines_buf: list[str] = []
            for raw_line in resp.iter_lines(decode_unicode=True):
                if time.time() > read_deadline:
                    break
                line = raw_line.strip() if raw_line else ""
                lines_buf.append(line)

                # SSE frame ends with a blank line; collect event + data
                if line == "" and len(lines_buf) >= 2:
                    event_line = next((l for l in lines_buf if l.startswith("event:")), None)
                    data_line = next((l for l in lines_buf if l.startswith("data:")), None)
                    if event_line and data_line:
                        result["event"] = event_line.split(":", 1)[1].strip()
                        result["data"] = json.loads(data_line.split(":", 1)[1].strip())
                        received_event.set()
                        break
                    lines_buf.clear()
        finally:
            resp.close()

    assert received_event.is_set(), "No SSE event: bar frame received within timeout"
    assert result["event"] == "bar"
    payload = result["data"]
    assert payload["sym"] == "AAPL"
    assert payload["tf"] == "1"
    assert payload["bar"]["t"] == BAR["t"]
    assert payload["bar"]["o"] == pytest.approx(BAR["o"])
    assert payload["bar"]["v"] == BAR["v"]


# ---------------------------------------------------------------------------
# Test 5 — Connection is capped at 50 pairs (51st pair dropped silently)
# ---------------------------------------------------------------------------

def test_stream_bars_caps_at_50_pairs(monkeypatch):
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    bb = bar_broadcaster.init_broadcaster()
    app = _make_app()

    # Build 51 valid sym:tf pairs
    pairs_param = ",".join(f"T{i}:1" for i in range(1, 52))

    with _serve(app) as base:
        resp = requests.get(
            f"{base}/api/stream/bars?bars={pairs_param}", stream=True, timeout=5
        )
        try:
            assert resp.status_code == 200

            # Wait (bounded) for the endpoint to subscribe rather than sleeping a
            # fixed 0.3s and hoping — a slow box would read 0 and fail the cap.
            deadline = time.time() + 3.0
            while time.time() < deadline and bb.get_status()["subscriber_pairs"] < 50:
                time.sleep(0.05)
            status = bb.get_status()
            assert status["subscriber_pairs"] == 50, (
                f"Expected 50 subscriber pairs (cap), got {status['subscriber_pairs']}"
            )
        finally:
            resp.close()
