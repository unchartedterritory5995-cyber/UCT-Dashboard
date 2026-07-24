"""
Deploy-survival P1 tests: graceful stop() + reconnect discipline for
api/massive_ws_worker.py.

TEST SAFETY — RULE ZERO: these tests must NEVER touch the real Massive WS.
DRY_RUN gates DB writes only, NOT the connection; a real connection with the
prod key consumes the single per-asset-class OPRA slot and causes a live
production outage. Every test runs against a localhost mock server with a
fake key, enforced by a hard assert in the fixture before any start().

Run: python -m pytest tests/test_massive_ws_stop.py -v
"""
import asyncio
import json
import threading
import time

import pytest

from api import massive_ws_worker as mww

# Server->client close frames use whatever code the mode specifies;
# client->server closes arrive as 1000 (legacy impl) or 1011 (websockets>=14
# sends 1011 when the context manager exits under an exception, incl.
# CancelledError). All are REAL close frames — which is all Massive's
# slot accounting needs.
ACCEPTABLE_CLIENT_CLOSE_CODES = {1000, 1001, 1011}


class MockMassiveServer:
    """Local stand-in for Massive's options WS endpoint.

    Modes:
      normal     — hello -> auth_success -> sub-ack -> hold open
      max_conn   — hello contains max_connections (client raises at hello)
      close_1001 — after sub-ack, server closes with code 1001 (clean close,
                   mimics the stale-watchdog / server-side clean close path)
    """

    def __init__(self):
        self.mode = "normal"
        self.accept_times = []      # monotonic timestamp per accepted conn
        self.client_close_codes = []  # close code seen when client disconnects
        self.port = None
        self._loop = None
        self._thread = None
        self._shutdown = None
        self._started = threading.Event()

    async def _handler(self, ws):
        self.accept_times.append(time.monotonic())
        mode = self.mode
        try:
            if mode == "max_conn":
                await ws.send(json.dumps(
                    [{"ev": "status", "status": "max_connections",
                      "message": "Maximum number of connections exceeded."}]))
                await ws.wait_closed()
                return
            # normal / close_1001 handshake
            await ws.send(json.dumps([{"ev": "status", "status": "connected"}]))
            await ws.recv()  # auth
            await ws.send(json.dumps([{"ev": "status", "status": "auth_success"}]))
            await ws.recv()  # subscribe
            await ws.send(json.dumps(
                [{"ev": "status", "status": "success", "message": "subscribed"}]))
            if mode == "close_1001":
                await ws.close(code=1001, reason="server going away")
                return
            await ws.wait_closed()
        finally:
            self.client_close_codes.append(ws.close_code)

    def start(self):
        def _run():
            async def _main():
                import websockets
                async with websockets.serve(self._handler, "127.0.0.1", 0) as server:
                    self.port = server.sockets[0].getsockname()[1]
                    self._shutdown = asyncio.get_running_loop().create_future()
                    self._started.set()
                    try:
                        await self._shutdown  # runs until stop() resolves it
                    except asyncio.CancelledError:
                        pass
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            try:
                self._loop.run_until_complete(_main())
            except Exception:
                pass
            finally:
                self._loop.close()
        self._thread = threading.Thread(target=_run, daemon=True, name="mock-massive")
        self._thread.start()
        assert self._started.wait(5), "mock server failed to start"

    def stop(self):
        # Resolve the shutdown future so _main exits through the server's
        # __aexit__ on a LIVE loop (loop.stop() would strand the close task).
        if self._loop is not None and not self._loop.is_closed():
            def _resolve():
                if self._shutdown is not None and not self._shutdown.done():
                    self._shutdown.set_result(None)
            try:
                self._loop.call_soon_threadsafe(_resolve)
            except RuntimeError:
                pass
        if self._thread is not None:
            self._thread.join(timeout=5)


def _wait_for(predicate, timeout=10.0, interval=0.02):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


def _reset_worker_state():
    mww._state.update({
        "started_at": None, "running": False, "connected": False,
        "thread": None, "loop": None, "root_task": None,
        "stop_requested": False, "maxconn_strikes": 0,
        "last_cooldown_sec": None, "clean_reconnects": 0,
        "last_trade_ts": None, "last_error": None, "reconnect_count": 0,
    })


@pytest.fixture()
def worker(monkeypatch):
    """Fresh mock server + module config per test, restored afterward."""
    server = MockMassiveServer()
    server.start()

    monkeypatch.setattr(mww, "MASSIVE_OPTIONS_WS_URL", f"ws://127.0.0.1:{server.port}")
    monkeypatch.setattr(mww, "MASSIVE_API_KEY", "test-key-not-prod")
    monkeypatch.setattr(mww, "DRY_RUN", True)
    monkeypatch.setattr(mww, "ENABLED", True)
    monkeypatch.setattr(mww, "MIN_RECONNECT_GAP", 1.0)
    monkeypatch.setattr(mww, "MAXCONN_LADDER", (0.2, 0.4, 0.8))
    monkeypatch.setattr(mww, "MAXCONN_YOUNG_UPTIME_SEC", 0.0)  # young-cap off by default
    monkeypatch.setattr(mww, "MAXCONN_YOUNG_CAP_SEC", 60.0)
    monkeypatch.setattr(mww, "_build_warm_start_contracts", lambda limit=950: [])
    _reset_worker_state()

    # HARD SAFETY GUARD — never a real Massive URL, never the prod key.
    assert mww.MASSIVE_OPTIONS_WS_URL.startswith("ws://127.0.0.1"), \
        "TEST SAFETY: refusing to run against a non-localhost WS URL"
    assert "test-key" in mww.MASSIVE_API_KEY

    yield server

    mww.stop(timeout=5.0)
    server.stop()
    _reset_worker_state()


def test_stop_sends_close_frame_and_joins(worker):
    assert mww.start() is True
    assert _wait_for(lambda: mww._state["connected"]), "never connected to mock"
    t0 = time.monotonic()
    assert mww.stop(timeout=5.0) is True
    assert time.monotonic() - t0 < 5.0
    assert mww._state["running"] is False
    assert _wait_for(lambda: worker.client_close_codes, timeout=5.0)
    assert worker.client_close_codes[-1] in ACCEPTABLE_CLIENT_CLOSE_CODES, \
        f"client did not complete a close handshake: {worker.client_close_codes}"
    # get_status stays JSON-serializable and feature-detects the patch
    status = json.loads(json.dumps(mww.get_status()))
    assert status["graceful_stop"] is True
    assert status["min_reconnect_gap"] == 1.0


def test_stop_during_maxconn_cooldown(worker):
    worker.mode = "max_conn"
    assert mww.start() is True
    assert _wait_for(lambda: mww._state["last_cooldown_sec"] is not None), \
        "never entered a cooldown sleep"
    t0 = time.monotonic()
    assert mww.stop(timeout=5.0) is True
    assert time.monotonic() - t0 < 2.0, "cancel should land inside the ladder sleep"


def test_clean_close_reconnect_gap(worker):
    """The zero-gap bug: a clean close (1001) must wait MIN_RECONNECT_GAP
    before reconnecting — never reconnect instantly into the server's
    session-cleanup window."""
    worker.mode = "close_1001"
    assert mww.start() is True
    assert _wait_for(lambda: len(worker.accept_times) >= 2, timeout=15.0), \
        "no reconnect observed after clean close"
    gap = worker.accept_times[1] - worker.accept_times[0]
    assert gap >= mww.MIN_RECONNECT_GAP - 0.15, \
        f"reconnected {gap:.2f}s after clean close (< MIN_RECONNECT_GAP)"
    assert mww._state["clean_reconnects"] >= 1


def test_maxconn_ladder_progression(worker):
    worker.mode = "max_conn"
    assert mww.start() is True
    assert _wait_for(lambda: len(worker.accept_times) >= 4, timeout=15.0), \
        "ladder never produced 4 attempts"
    gaps = [worker.accept_times[i + 1] - worker.accept_times[i] for i in range(3)]
    # expected ≈ 0.2 / 0.4 / 0.8 (ladder), each within loose tolerance
    for got, want in zip(gaps, (0.2, 0.4, 0.8)):
        assert want - 0.1 <= got <= want + 1.0, f"ladder gaps off: {gaps}"
    assert mww._state["maxconn_strikes"] >= 3


def test_maxconn_strikes_reset_on_auth_success(worker):
    worker.mode = "max_conn"
    assert mww.start() is True
    assert _wait_for(lambda: mww._state["maxconn_strikes"] >= 2, timeout=10.0)
    worker.mode = "normal"
    assert _wait_for(lambda: mww._state["connected"], timeout=10.0), \
        "never recovered after mode flip"
    # Wait on the state actually being asserted, not on `connected` as a proxy.
    # The worker thread sets connected and clears maxconn_strikes at slightly
    # different moments, so a bare read here raced: it passed on an idle machine
    # and failed under full-suite load (observed 2 == 0).
    assert _wait_for(lambda: mww._state["maxconn_strikes"] == 0, timeout=10.0), \
        "strikes must reset on auth_success"


def test_young_process_cap(worker, monkeypatch):
    monkeypatch.setattr(mww, "MAXCONN_YOUNG_UPTIME_SEC", 900.0)
    monkeypatch.setattr(mww, "MAXCONN_YOUNG_CAP_SEC", 0.3)
    monkeypatch.setattr(mww, "MAXCONN_LADDER", (0.2, 5.0, 5.0))
    worker.mode = "max_conn"
    assert mww.start() is True
    assert _wait_for(lambda: len(worker.accept_times) >= 3, timeout=10.0), \
        "young-process cap did not keep probing quickly"
    gap2 = worker.accept_times[2] - worker.accept_times[1]
    assert gap2 <= 1.5, f"second gap {gap2:.2f}s — young cap (0.3s) not applied"


def test_watchdog_anchor_reset_on_session_start(worker):
    mww._state["last_trade_ts"] = time.time() - 999  # poison from a "previous session"
    assert mww.start() is True
    assert _wait_for(lambda: mww._state["connected"]), "never connected"
    assert _wait_for(lambda: mww._state["last_trade_ts"] is None, timeout=5.0), \
        "session-clear did not re-arm the watchdog anchor (last_trade_ts)"


def test_stop_idempotency_and_stop_before_start(worker):
    # stop before start: no thread — must be a clean no-op
    assert mww.stop() is True
    _reset_worker_state()
    mww.ENABLED = True

    assert mww.start() is True
    assert _wait_for(lambda: mww._state["connected"])
    assert mww.stop(timeout=5.0) is True
    assert mww.stop(timeout=1.0) is True  # double-stop: re-join only, no re-cancel


def test_stop_immediately_after_start_no_hang(worker):
    """Race window: stop() right after start(), refs may not be captured yet."""
    for _ in range(10):
        _reset_worker_state()
        mww.ENABLED = True
        assert mww.start() is True
        mww.stop(timeout=5.0)
        assert _wait_for(lambda: not mww._state["running"], timeout=5.0), \
            "thread failed to exit after immediate stop()"
