"""stream-ingest PR4a: the dark skeleton (feed server + entrypoint), no vendor socket."""
from __future__ import annotations

import asyncio
import json
import socket
import subprocess
import sys
from pathlib import Path

import pytest

from api.services import feed_protocol as fp
from api.services import ingest_feed_server as ifs

ROOT = Path(__file__).resolve().parents[1]
SECRET = "test-secret-not-real"


# ── helpers ────────────────────────────────────────────────────────────────────

class FakeConn:
    """Scripted client connection: `inbox` feeds recv(); send()/close() are recorded."""

    def __init__(self, messages=(), hang=False):
        self.inbox: asyncio.Queue = asyncio.Queue()
        for m in messages:
            self.inbox.put_nowait(m)
        self.hang = hang
        self.sent: list = []
        self.closed = None
        self._closed_evt = asyncio.Event()

    async def recv(self):
        if self.closed is not None:
            raise ConnectionError("closed")
        get = asyncio.ensure_future(self.inbox.get())
        closed = asyncio.ensure_future(self._closed_evt.wait())
        done, pending = await asyncio.wait({get, closed}, return_when=asyncio.FIRST_COMPLETED)
        for p in pending:
            p.cancel()
        if get in done:
            m = get.result()
            if m is EOFError:
                raise ConnectionError("eof")
            return m
        raise ConnectionError("closed")

    async def send(self, data):
        if self.closed is not None:
            raise ConnectionError("closed")
        self.sent.append(fp.decode(data))

    async def close(self, code=1000, reason=""):
        if self.closed is None:
            self.closed = (code, reason)
            self._closed_evt.set()
        # A real websockets close() awaits the closing handshake: yield like it does,
        # so other handlers run in between (the supersede race needs this to show).
        for _ in range(3):
            await asyncio.sleep(0)


def enc(msg) -> bytes:
    return fp.encode(msg)


def hello(cid="web-1", gen=1):
    return enc(fp.Hello(client_id=cid, gen=gen))


def desired(gen=1, owners=None, keys=frozenset()):
    return enc(fp.Desired(gen=gen, owners=owners or {}, keys=keys))


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def make_server(**kw):
    deltas = []
    clock = Clock()
    srv = ifs.IngestFeedServer(secret=SECRET, lease_s=kw.pop("lease_s", 30.0), epoch=7,
                               monotonic=clock, on_delta=deltas.append, **kw)
    return srv, deltas, clock


@pytest.fixture(autouse=True)
def fast_intervals(monkeypatch):
    monkeypatch.setattr(ifs, "BATCH_INTERVAL_S", 0.005)
    monkeypatch.setattr(ifs, "HELLO_TIMEOUT_S", 0.2)


async def run_until(conn, srv, cond, timeout=2.0):
    task = asyncio.create_task(srv.handle(conn))
    deadline = asyncio.get_running_loop().time() + timeout
    while not cond():
        if asyncio.get_running_loop().time() > deadline:
            break
        await asyncio.sleep(0.005)
    return task


# ── auth ───────────────────────────────────────────────────────────────────────

def test_bearer_check_is_exact_and_fails_closed():
    assert ifs.bearer_ok(f"Bearer {SECRET}", SECRET)
    assert not ifs.bearer_ok(f"Bearer {SECRET}x", SECRET)
    assert not ifs.bearer_ok(SECRET, SECRET)
    assert not ifs.bearer_ok(None, SECRET)
    assert not ifs.bearer_ok("Bearer ", "")          # no secret configured: nothing authenticates


# ── protocol over a fake connection ────────────────────────────────────────────

def test_hello_then_desired_reaches_the_union_and_heartbeats_flow():
    async def go():
        srv, deltas, clock = make_server()
        conn = FakeConn([hello(), desired(owners={"bars": {"AAAA": frozenset({"AM", "T"})}},
                                          keys=frozenset({("AAAA", "1")}))])
        task = await run_until(conn, srv, lambda: len(conn.sent) >= 1)
        clock.t += ifs.STATUS_INTERVAL_S + 0.1          # next heartbeat is due
        for _ in range(200):
            if len(conn.sent) >= 2:
                break
            await asyncio.sleep(0.005)
        assert srv.union.channels() == {"AAAA": frozenset({"AM", "T"})}
        assert deltas and deltas[-1].subscribe.get("AAAA") == frozenset({"AM", "T"})
        batches = [m for m in conn.sent if isinstance(m, fp.Batch)]
        assert batches[0].epoch == 7 and [b.seq for b in batches[:2]] == [1, 2]
        assert batches[0].status["connect"] is False       # dark: never claims a vendor socket
        conn.inbox.put_nowait(EOFError)
        await asyncio.wait_for(task, 2)
    asyncio.run(go())


def test_first_message_must_be_hello():
    async def go():
        srv, _, _ = make_server()
        conn = FakeConn([desired()])
        await asyncio.wait_for(srv.handle(conn), 2)
        assert conn.closed[0] == ifs.CLOSE_POLICY and "hello" in conn.closed[1]
        assert srv.counters.protocol_closes == 1 and srv.clients == {}
    asyncio.run(go())


def test_hello_timeout_closes_policy():
    async def go():
        srv, _, _ = make_server()
        conn = FakeConn([])
        await asyncio.wait_for(srv.handle(conn), 2)
        assert conn.closed == (ifs.CLOSE_POLICY, "hello timeout")
        assert srv.counters.hello_timeouts == 1
    asyncio.run(go())


def test_garbage_and_out_of_order_patch_close_policy():
    async def go():
        srv, _, _ = make_server()
        conn = FakeConn([hello(), b"{not json"])
        await asyncio.wait_for(srv.handle(conn), 2)
        assert conn.closed[0] == ifs.CLOSE_POLICY
        srv2, _, _ = make_server()
        patch = enc(fp.Patch(gen=1, seq=1, keys_add=frozenset({("AAAA", "1")})))
        conn2 = FakeConn([hello(), patch])                  # patch before any desired
        await asyncio.wait_for(srv2.handle(conn2), 2)
        assert conn2.closed[0] == ifs.CLOSE_POLICY and "PatchOutOfOrder" in conn2.closed[1]
    asyncio.run(go())


def test_disconnect_holds_the_lease_then_expire_releases():
    async def go():
        srv, deltas, clock = make_server(lease_s=30.0)
        conn = FakeConn([hello(), desired(owners={"bars": {"AAAA": frozenset({"T"})}}), EOFError])
        await asyncio.wait_for(srv.handle(conn), 2)
        assert srv.clients == {}
        assert srv.union.channels() == {"AAAA": frozenset({"T"})}     # held: web deploy keeps the feed warm
        clock.t += 29
        srv.expire()
        assert srv.union.channels() == {"AAAA": frozenset({"T"})}
        clock.t += 2
        srv.expire()
        assert srv.union.channels() == {} and srv.counters.leases_expired == 1
        assert deltas[-1].unsubscribe.get("AAAA") == frozenset({"T"})
    asyncio.run(go())


def test_reconnect_within_lease_reclaims_without_a_resubscribe():
    async def go():
        srv, deltas, clock = make_server()
        owners = {"bars": {"AAAA": frozenset({"T"})}}
        await asyncio.wait_for(srv.handle(FakeConn([hello(gen=1), desired(1, owners), EOFError])), 2)
        n = len(deltas)
        clock.t += 5
        await asyncio.wait_for(srv.handle(FakeConn([hello(gen=2), desired(2, owners), EOFError])), 2)
        assert len(deltas) == n   # same set within the lease: no upstream churn at all
    asyncio.run(go())


def test_newer_connection_for_the_same_client_supersedes_the_old():
    async def go():
        srv, _, _ = make_server()
        old = FakeConn([hello(gen=1), desired(1)])
        t_old = await run_until(old, srv, lambda: "web-1" in srv.clients)
        new = FakeConn([hello(gen=2), desired(2)])
        t_new = await run_until(new, srv, lambda: srv.clients.get("web-1") and srv.clients["web-1"].conn is new)
        await asyncio.wait_for(t_old, 2)
        assert old.closed[0] == ifs.CLOSE_POLICY and "superseded" in old.closed[1]
        assert srv.clients["web-1"].conn is new
        # The old handler's cleanup must NOT have disconnected the new live client.
        assert srv.union.clients()["web-1"]["connected"] is True
        assert srv.union.clients()["web-1"]["lease_until"] is None
        new.inbox.put_nowait(EOFError)
        await asyncio.wait_for(t_new, 2)
    asyncio.run(go())


def test_a_stalled_buffer_closes_try_again():
    async def go():
        srv, _, _ = make_server(limits=fp.BufferLimits(max_pending_bars=1))
        conn = FakeConn([hello(), desired()])
        task = await run_until(conn, srv, lambda: "web-1" in srv.clients)
        buf = srv.clients["web-1"].buffer
        bar = {"t": 60_000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}
        buf.offer_bar("AAAA", "1", bar, False)
        buf.offer_bar("AAAA", "1", {**bar, "t": 120_000}, False)   # over the cap: STALLED
        await asyncio.wait_for(task, 2)
        assert conn.closed[0] == ifs.CLOSE_TRY_AGAIN and srv.counters.stall_closes == 1
    asyncio.run(go())


def test_shutdown_sends_a_final_batch_and_closes_going_away():
    async def go():
        srv, _, _ = make_server()
        conn = FakeConn([hello(), desired()])
        task = await run_until(conn, srv, lambda: "web-1" in srv.clients)
        n = len(conn.sent)
        await srv.shutdown()
        await asyncio.wait_for(task, 2)
        assert conn.closed[0] == ifs.CLOSE_GOING_AWAY
        assert len(conn.sent) > n and conn.sent[-1].status["closing"] is True
    asyncio.run(go())


def test_a_hello_during_shutdown_is_turned_away_going_away():
    async def go():
        srv, _, _ = make_server()
        await srv.shutdown()
        conn = FakeConn([hello(), desired()])
        await asyncio.wait_for(srv.handle(conn), 2)
        assert conn.closed[0] == ifs.CLOSE_GOING_AWAY and srv.clients == {}
    asyncio.run(go())


def test_shutdown_is_concurrent_and_bounded_by_one_deadline():
    class Hung(FakeConn):
        async def send(self, data):
            await asyncio.sleep(60)          # never drains

        async def close(self, code=1000, reason=""):
            await super().close(code, reason)
            await asyncio.sleep(60)          # never finishes the closing handshake

    async def go():
        srv, _, _ = make_server()
        tasks = []
        for i in range(5):
            c = Hung([hello(f"web-{i}"), desired()])
            tasks.append(await run_until(c, srv, lambda i=i: f"web-{i}" in srv.clients))
        t0 = asyncio.get_running_loop().time()
        await srv.shutdown(deadline_s=0.3)
        assert asyncio.get_running_loop().time() - t0 < 1.5     # not 5 x (send + close) serially
        assert srv.clients == {}
        for t in tasks:
            t.cancel()
    asyncio.run(go())


def test_a_client_dropping_before_hello_is_quiet():
    class Drop(FakeConn):
        async def recv(self):
            raise ConnectionError("gone")

    async def go():
        srv, _, _ = make_server()
        await asyncio.wait_for(srv.handle(Drop()), 2)       # no exception escapes
        assert srv.clients == {} and srv.union.clients() == {}
    asyncio.run(go())


def test_a_crashing_send_loop_closes_the_connection_internal_error(monkeypatch):
    async def go():
        srv, _, _ = make_server()

        async def boom(client, timeout_s=None):
            raise RuntimeError("synthetic")
        monkeypatch.setattr(srv, "flush_client", boom)
        conn = FakeConn([hello(), desired()])
        await asyncio.wait_for(srv.handle(conn), 2)
        assert conn.closed[0] == ifs.CLOSE_INTERNAL
    asyncio.run(go())


def test_status_has_no_secret():
    srv, _, _ = make_server()
    assert SECRET not in json.dumps(srv.status(), default=str)


# ── real socket end to end (websockets server on a free port) ──────────────────

def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_real_socket_health_auth_and_feed(monkeypatch):
    pytest.importorskip("websockets.asyncio.server")
    import urllib.error
    import urllib.request

    from websockets.asyncio.client import connect

    from api import stream_ingest_main as main

    monkeypatch.setenv("PUSH_SECRET", SECRET)
    port = _free_port()

    async def go():
        srv = main.build_server()
        stop = asyncio.Event()
        task = asyncio.create_task(main.serve_forever(port, srv, stop))
        for _ in range(100):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    break
            except OSError:
                await asyncio.sleep(0.02)

        def http(path, auth=None):
            req = urllib.request.Request(f"http://127.0.0.1:{port}{path}")
            if auth:
                req.add_header("Authorization", auth)
            try:
                with urllib.request.urlopen(req, timeout=3) as r:
                    return r.status, r.read().decode()
            except urllib.error.HTTPError as e:
                return e.code, ""

        loop = asyncio.get_running_loop()
        assert (await loop.run_in_executor(None, http, "/api/health"))[0] == 200
        assert (await loop.run_in_executor(None, http, "/status"))[0] == 401
        code, body = await loop.run_in_executor(None, http, "/status", f"Bearer {SECRET}")
        assert code == 200 and json.loads(body)["stage"] == "pr4a-dark"
        assert SECRET not in body
        assert (await loop.run_in_executor(None, http, "/nope"))[0] == 404

        with pytest.raises(Exception):
            async with connect(f"ws://127.0.0.1:{port}/internal/feed") as ws:   # no auth
                await ws.recv()

        async with connect(f"ws://127.0.0.1:{port}/internal/feed",
                           additional_headers={"Authorization": f"Bearer {SECRET}"}) as ws:
            await ws.send(hello("web-e2e", 1))
            await ws.send(desired(1, {"bars": {"AAAA": frozenset({"AM"})}}))
            b = fp.decode(await asyncio.wait_for(ws.recv(), 3))
            assert isinstance(b, fp.Batch) and b.epoch == srv.epoch and b.seq == 1
            for _ in range(50):
                if srv.union.channels():
                    break
                await asyncio.sleep(0.02)
            assert srv.union.channels() == {"AAAA": frozenset({"AM"})}
            stop.set()
            last = None
            try:
                while True:
                    last = fp.decode(await asyncio.wait_for(ws.recv(), 3))
            except Exception:
                pass
            assert ws.close_code == ifs.CLOSE_GOING_AWAY
            assert last is None or last.status["closing"] is True
        await asyncio.wait_for(task, 5)

    asyncio.run(go())


def test_real_socket_shutdown_does_not_hang_on_a_late_hello(monkeypatch):
    pytest.importorskip("websockets.asyncio.server")
    from websockets.asyncio.client import connect

    from api import stream_ingest_main as main

    monkeypatch.setenv("PUSH_SECRET", SECRET)
    port = _free_port()

    async def go():
        srv = main.build_server()
        stop = asyncio.Event()
        task = asyncio.create_task(main.serve_forever(port, srv, stop))
        for _ in range(100):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    break
            except OSError:
                await asyncio.sleep(0.02)
        async with connect(f"ws://127.0.0.1:{port}/internal/feed",
                           additional_headers={"Authorization": f"Bearer {SECRET}"}) as ws:
            stop.set()                       # shutdown starts BEFORE this client says hello
            await asyncio.sleep(0.05)
            try:
                await ws.send(hello("late", 1))
                await asyncio.wait_for(ws.recv(), 3)
            except Exception:
                pass
            await asyncio.wait_for(task, 8)  # the server finished; it did not hang
            assert ws.close_code == ifs.CLOSE_GOING_AWAY

    asyncio.run(go())


# ── rails ──────────────────────────────────────────────────────────────────────

def test_entrypoint_import_closure_has_no_web_app_and_no_vendor_reader():
    code = ("import sys, api.stream_ingest_main\n"
            "bad = [m for m in ('api.main', 'fastapi', 'api.services.bar_stream',"
            " 'api.services.bar_broadcaster', 'api.services.massive_ws_worker',"
            " 'api.services.realtime_stream') if m in sys.modules]\n"
            "print(','.join(bad))\n")
    out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
    assert out.stdout.strip() == "", f"stream-ingest PR4a must not import: {out.stdout.strip()}"


def test_skeleton_sources_open_no_vendor_socket():
    for rel in ("api/stream_ingest_main.py", "api/services/ingest_feed_server.py"):
        src = (ROOT / rel).read_text(encoding="utf-8")
        code = "\n".join(l for l in src.splitlines() if not l.lstrip().startswith("#"))
        for banned in ("socket.massive.com", "MASSIVE_API_KEY", "bar_stream", "start_stream",
                       "_run_websocket", "websockets.connect", "client import connect"):
            assert banned not in code.split('"""', 2)[-1], f"{rel} references {banned}"


def test_railway_ingest_config_is_its_own_file():
    cfg = json.loads((ROOT / "railway.ingest.json").read_text(encoding="utf-8"))
    assert cfg["deploy"]["startCommand"] == "python -m api.stream_ingest_main"
    assert cfg["deploy"]["healthcheckPath"] == "/api/health"
    shared = (ROOT / "railway.json").read_text(encoding="utf-8")
    assert "stream_ingest" not in shared, "never route the ingest service through the shared railway.json"
