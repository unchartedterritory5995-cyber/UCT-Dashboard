"""stream-gateway (api/stream_gateway_main.py): web's own bar stream route, in its own process,
entitled by the signed chart cookie instead of web's member database.

Accepted streams are read from a REAL uvicorn server (an in-memory TestClient never returns from
an infinite SSE body: api/routers/stream_bars_test.py's module docstring); refusals use TestClient.
"""
import asyncio
import json
import socket
import threading
import time
from contextlib import contextmanager

import pytest
import requests
import uvicorn
from fastapi.testclient import TestClient

from api import chart_edge_token as cet
from api.services import bar_broadcaster, feed_client, feed_protocol as fp

SECRET = "test-edge-secret-not-real"
T0 = 1794493800000


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("CHART_EDGE_SECRET", SECRET)
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    monkeypatch.setattr(bar_broadcaster, "_default_seed_fetcher", lambda sym: [], raising=False)
    bar_broadcaster.reset_broadcaster_for_tests()      # each served app's lifespan installs its own
    yield
    bar_broadcaster.reset_broadcaster_for_tests()
    feed_client._client = feed_client._task = feed_client._stop = None


def _app():
    import importlib
    import api.stream_gateway_main as gw
    importlib.reload(gw)
    return gw


def test_without_a_valid_member_cookie_the_bar_stream_is_refused():
    gw = _app()
    c = TestClient(gw.create_app())          # not entered: no lifespan, no feed
    url = "/api/stream/bars?bars=AAPL:1"
    now = int(time.time())
    expired = cet.mint(now=now - 10_000)
    service_as_cookie = cet.mint_service()
    for cookies in ({}, {cet.COOKIE_NAME: "v1.e30.AAAA"}, {cet.COOKIE_NAME: expired},
                    {cet.COOKIE_NAME: service_as_cookie}, {"uct_session": "a-real-looking-session"}):
        r = c.get(url, cookies=cookies)
        assert r.status_code == 401, (cookies, r.status_code, r.text)
    # the service header takes a SERVICE token only; a member token there is refused too
    assert c.get(url, headers={"x-chart-edge-token": cet.mint()}).status_code == 401


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


@contextmanager
def _serve(app):
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    th = threading.Thread(target=server.run, daemon=True)
    th.start()
    deadline = time.time() + 5
    while time.time() < deadline and not server.started:
        time.sleep(0.02)
    assert server.started, "the gateway did not start"
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        th.join(5)


def test_a_valid_member_cookie_gets_the_real_bar_stream(monkeypatch):
    """The lifespan starts the feed (here a stand-in that never touches the network and, once a chart
    subscribes, hands the broadcaster one batch ON THE SERVER'S LOOP); the member's cookie opens the
    exact route web serves, and the bar arrives as an SSE `bar` event."""
    seen = {}

    async def fake_run(self, stop):
        seen["client_id"] = self.client_id
        seen["side"] = self.side
        self.connected = True
        rb = self.rb
        for _ in range(500):
            if rb.desired_keys():
                break
            await asyncio.sleep(0.01)
        rb.apply_batch(fp.Batch(epoch=1, seq=1, bars=(
            fp.BarUpdate("ZZA", "1", {"t": T0 // 1000, "o": 10.0, "h": 10.5, "l": 9.9, "c": 10.25, "v": 100}, False),),
            prices={}))
        await stop.wait()

    monkeypatch.setattr(feed_client.FeedClient, "run", fake_run)
    gw = _app()
    with _serve(gw.create_app()) as base:
        h = requests.get(base + "/api/health", timeout=5).json()
        assert h["service"] == "stream-gateway"
        r = requests.get(base + "/api/stream/bars?bars=ZZA:1", cookies={cet.COOKIE_NAME: cet.mint()},
                         stream=True, timeout=5)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        event, data = None, None
        deadline = time.time() + 5
        for raw in r.iter_lines(decode_unicode=True):
            if raw.startswith("event: "):
                event = raw[7:]
            elif raw.startswith("data: ") and event == "bar":
                data = json.loads(raw[6:])
                break
            if time.time() > deadline:
                break
        r.close()
    assert data is not None, "no bar event reached the member"
    assert data["sym"] == "ZZA" and data["bar"]["c"] == 10.25
    # the gateway is its own client of ingest, with none of web's side feeds
    assert seen["client_id"].startswith("gw-")
    assert seen["side"] is None


def test_while_its_own_feed_is_not_connected_the_gateway_answers_503(monkeypatch):
    """The edge then sends the member to web instead of opening a stream that would stay silent."""
    async def never_connects(self, stop):
        await stop.wait()

    monkeypatch.setattr(feed_client.FeedClient, "run", never_connects)
    gw = _app()
    with _serve(gw.create_app()) as base:
        r = requests.get(base + "/api/stream/bars?bars=ZZA:1", cookies={cet.COOKIE_NAME: cet.mint()}, timeout=5)
        assert r.status_code == 503
        assert requests.get(base + "/api/health", timeout=5).json()["feed_connected"] is False


def test_web_still_starts_its_side_feeds_by_default():
    """Only the gateway opts out: web's call site passes nothing, and the default keeps the side feeds."""
    import inspect
    import pathlib
    sig = inspect.signature(feed_client.start_remote)
    assert sig.parameters["side_feeds"].default is True
    assert sig.parameters["client_id"].default is None
    main_src = (pathlib.Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    assert "_feed_client.start_remote()" in main_src
