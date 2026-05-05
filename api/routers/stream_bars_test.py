"""End-to-end tests for the /api/stream/bars SSE endpoint.

Tests 1-3 and 5 use FastAPI TestClient (sync, non-streaming responses).
Test 4 (E2E SSE roundtrip) requires a real TCP server because httpx's in-memory
ASGI transport buffers the entire response body before delivering it to the
client — it only sets more_body=False when the generator exits, so iter_bytes()
blocks forever on infinite SSE generators. We use uvicorn + requests instead.
"""

import json
import socket
import threading
import time
import os

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


# ---------------------------------------------------------------------------
# Shared fixture
# ---------------------------------------------------------------------------

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
# Test 3 — 400 when the only pair is 60-min (excluded in v1)
# ---------------------------------------------------------------------------

def test_stream_bars_400_when_60min_only(monkeypatch):
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    bar_broadcaster.init_broadcaster()
    app = _make_app()
    client = TestClient(app, raise_server_exceptions=False)

    resp = client.get("/api/stream/bars?bars=AAPL:60")
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Test 4 — Full E2E: push a bar and receive it as an SSE event
#
# Uses a real uvicorn server bound to a free TCP port because httpx's in-memory
# ASGI transport (used by TestClient) buffers the entire response body and only
# delivers bytes to the client when the generator finishes — which never happens
# for an infinite SSE generator.  A real HTTP server has no such limitation.
# ---------------------------------------------------------------------------

@pytest.mark.timeout(10)
def test_stream_bars_delivers_pushed_bar_as_sse_event(monkeypatch):
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    bb = bar_broadcaster.init_broadcaster()
    app = _make_app()

    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()

    # Wait for the server to start accepting connections
    deadline = time.time() + 3.0
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                break
        except OSError:
            time.sleep(0.05)
    else:
        server.should_exit = True
        pytest.fail("uvicorn did not start within 3s")

    BAR = {"t": 1746468600000, "o": 150.0, "h": 151.0, "l": 149.5, "c": 150.8, "v": 5000}
    received_event = threading.Event()
    result: dict = {}

    def push_after_delay():
        time.sleep(0.3)
        bb.push_minute_bar("AAPL", BAR)

    push_thread = threading.Thread(target=push_after_delay, daemon=True)
    push_thread.start()

    try:
        resp = requests.get(
            f"http://127.0.0.1:{port}/api/stream/bars?bars=AAPL:1",
            stream=True,
            timeout=8,
        )
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")

        lines_buf: list[str] = []
        for raw_line in resp.iter_lines(decode_unicode=True):
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

        resp.close()
    finally:
        server.should_exit = True

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

@pytest.mark.timeout(10)
def test_stream_bars_caps_at_50_pairs(monkeypatch):
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    bb = bar_broadcaster.init_broadcaster()
    app = _make_app()

    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()

    # Wait for the server to start
    deadline = time.time() + 3.0
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                break
        except OSError:
            time.sleep(0.05)
    else:
        server.should_exit = True
        pytest.fail("uvicorn did not start within 3s")

    # Build 51 valid sym:tf pairs
    pairs_param = ",".join(f"T{i}:1" for i in range(1, 52))

    try:
        resp = requests.get(
            f"http://127.0.0.1:{port}/api/stream/bars?bars={pairs_param}",
            stream=True,
            timeout=5,
        )
        assert resp.status_code == 200

        # Give the endpoint time to subscribe before we inspect the broadcaster
        time.sleep(0.3)
        status = bb.get_status()
        assert status["subscriber_pairs"] == 50, (
            f"Expected 50 subscriber pairs (cap), got {status['subscriber_pairs']}"
        )
        resp.close()
    finally:
        server.should_exit = True
