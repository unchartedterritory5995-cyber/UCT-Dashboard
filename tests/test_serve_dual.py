"""`api.serve_dual`: the web process can also listen on Railway's private network.

`web` starts uvicorn on `0.0.0.0`, IPv4. This project's private network is IPv6, so no
other service can open a connection to `web` (recorded in `api/flow_worker_main.py` and
`api/schwab_token_replica.py`: a private pull from `web` was deployed and disproved).

Changing the bind to `::` is not the fix: on this platform that made a listener
IPv6-ONLY, and `web`'s public traffic arrives over IPv4. So the public socket stays
exactly as it is and a SECOND socket is added, behind `WEB_PRIVATE_LISTEN_ENABLED=1`.
With the switch unset, the image runs the same uvicorn command line it always has.

Mutation proof (run before calling these done):
    1. swap the two sockets' order            -> test_ipv4_socket_is_first... RED
    2. drop IPV6_V6ONLY                       -> test_ipv6_socket_is_v6only RED
    3. let an IPv6 failure propagate          -> test_ipv6_failure_leaves_ipv4_serving RED
    4. change timeout_graceful_shutdown to 6  -> test_config_matches_the_command_line_flags RED
"""
from __future__ import annotations

import http.client
import os
import re
import socket
import threading
import time

import pytest

from api import serve_dual

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: The command line `web` has always run. Pinned as a literal: the default branch of the
#: image's CMD must keep running exactly this.
UVICORN_LINE = ("exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8080} "
                "--proxy-headers --forwarded-allow-ips='*' --timeout-graceful-shutdown 5")


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _has_ipv6_loopback() -> bool:
    try:
        s = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        s.bind(("::1", 0))
        s.close()
        return True
    except OSError:
        return False


def _close(socks):
    for s in socks:
        try:
            s.close()
        except OSError:
            pass


def _cmd_line() -> str:
    """The final CMD line of Dockerfile.web (comments above it are prose, not the command)."""
    with open(os.path.join(ROOT, "Dockerfile.web"), encoding="utf-8") as f:
        lines = [ln.rstrip("\n") for ln in f]
    cmds = [ln for ln in lines if ln.startswith("CMD ")]
    assert len(cmds) == 1, cmds
    return cmds[0]


# ── the sockets ───────────────────────────────────────────────────────────────

def test_ipv4_socket_is_first_and_bound_to_all_interfaces():
    port = _free_port()
    socks = serve_dual.build_sockets(port)
    try:
        assert socks[0].family == socket.AF_INET
        assert socks[0].getsockname() == ("0.0.0.0", port)
    finally:
        _close(socks)


@pytest.mark.skipif(not _has_ipv6_loopback(), reason="this machine has no IPv6 loopback")
def test_ipv6_socket_is_v6only(monkeypatch):
    """The code must SET IPV6_V6ONLY itself, and before it binds.

    Reading the option back is not enough: Windows sockets are v6-only by default, so
    `getsockopt` answers 1 there whether or not the code set it, while Linux (production)
    defaults to dual stack, where an unset option lets the IPv6 wildcard claim the IPv4
    port too. A first version of this test only read the option back, and deleting the
    `setsockopt` line left it green on this machine. So the calls are recorded.
    """
    calls = []
    real = socket.socket

    class Recording(real):
        def setsockopt(self, *a):
            calls.append((self.family, "setsockopt", a))
            return super().setsockopt(*a)

        def bind(self, addr):
            calls.append((self.family, "bind", addr))
            return super().bind(addr)

    monkeypatch.setattr(serve_dual.socket, "socket", Recording)
    port = _free_port()
    socks = serve_dual.build_sockets(port)
    try:
        assert len(socks) == 2
        assert socks[1].family == socket.AF_INET6
        assert socks[1].getsockname()[1] == port
        assert socks[1].getsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY) == 1
        v6 = [c for c in calls if c[0] == socket.AF_INET6]
        wanted = (socket.AF_INET6, "setsockopt", (socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1))
        assert wanted in v6, "the IPv6 socket was never told to be v6-only"
        bind_at = next(i for i, c in enumerate(v6) if c[1] == "bind")
        assert v6.index(wanted) < bind_at, "v6-only must be set before the bind"
        # and the public IPv4 socket is never given an IPv6 option
        assert not [c for c in calls if c[0] == socket.AF_INET and c[1] == "setsockopt"
                    and c[2][0] == socket.IPPROTO_IPV6]
    finally:
        _close(socks)


def test_ipv6_failure_leaves_ipv4_serving(monkeypatch):
    """The public path must never depend on IPv6 being available."""
    real = socket.socket

    def fake(family=socket.AF_INET, *a, **kw):
        if family == socket.AF_INET6:
            raise OSError("Address family not supported by protocol")
        return real(family, *a, **kw)

    monkeypatch.setattr(serve_dual.socket, "socket", fake)
    port = _free_port()
    socks = serve_dual.build_sockets(port)
    try:
        assert len(socks) == 1
        assert socks[0].family == socket.AF_INET
        assert socks[0].getsockname() == ("0.0.0.0", port)
    finally:
        _close(socks)


def test_an_ipv4_failure_is_not_swallowed():
    """No public listener is a failed start, loudly, never a process that serves nobody."""
    holder = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    holder.setsockopt(socket.SOL_SOCKET, getattr(socket, "SO_EXCLUSIVEADDRUSE", socket.SO_REUSEADDR), 1)
    holder.bind(("0.0.0.0", 0))
    holder.listen(1)
    port = holder.getsockname()[1]
    try:
        with pytest.raises(OSError):
            _close(serve_dual.build_sockets(port))
    finally:
        holder.close()


# ── the server settings ───────────────────────────────────────────────────────

def test_config_matches_the_command_line_flags():
    """Both ways of starting the server must mean the same thing."""
    line = _cmd_line()
    assert "--proxy-headers" in line
    allow = re.search(r"--forwarded-allow-ips='([^']*)'", line).group(1)
    grace = int(re.search(r"--timeout-graceful-shutdown (\d+)", line).group(1))
    target = re.search(r"exec uvicorn (\S+)", line).group(1)

    cfg = serve_dual.build_config()
    assert cfg.app == target == "api.main:app"
    assert cfg.proxy_headers is True
    assert cfg.forwarded_allow_ips == allow == "*"
    assert cfg.timeout_graceful_shutdown == grace == 5


def test_the_port_comes_from_PORT_with_the_same_default(monkeypatch):
    monkeypatch.delenv("PORT", raising=False)
    assert serve_dual.listen_port() == 8080
    monkeypatch.setenv("PORT", "9123")
    assert serve_dual.listen_port() == 9123


# ── the image's start command ─────────────────────────────────────────────────

def test_default_command_is_unchanged():
    assert UVICORN_LINE in _cmd_line()


def test_the_second_listener_is_opt_in():
    line = _cmd_line()
    assert 'if [ \\"${WEB_PRIVATE_LISTEN_ENABLED:-0}\\" = \\"1\\" ]; then exec python -m api.serve_dual; else ' in line
    # exactly one way into each branch
    assert line.count("exec python -m api.serve_dual") == 1
    assert line.count("exec uvicorn ") == 1
    assert line.rstrip().endswith('; fi"]')


@pytest.mark.parametrize("value,on", [("1", True), ("0", False), ("", False), ("true", False),
                                      ("on", False), (" 1", False), ("11", False), (None, False)])
def test_python_and_the_cmd_agree_on_what_enabled_means(value, on, monkeypatch):
    """Two readers of one switch, in two languages. Run the CMD's own condition in a real
    shell and compare it with `serve_dual.enabled()` for the same value."""
    import json
    import shutil
    import subprocess

    if value is None:
        monkeypatch.delenv("WEB_PRIVATE_LISTEN_ENABLED", raising=False)
    else:
        monkeypatch.setenv("WEB_PRIVATE_LISTEN_ENABLED", value)
    assert serve_dual.enabled() is on

    sh = shutil.which("sh")
    if not sh:
        pytest.skip("no POSIX shell on this machine to run the CMD's condition")
    script = json.loads(_cmd_line()[len("CMD "):])[2]
    script = script.replace("exec python -m api.serve_dual", "echo dual").replace("exec uvicorn ", "echo uvicorn ")
    env = {k: v for k, v in os.environ.items() if k != "WEB_PRIVATE_LISTEN_ENABLED"}
    if value is not None:
        env["WEB_PRIVATE_LISTEN_ENABLED"] = value
    out = subprocess.run([sh, "-c", script], capture_output=True, text=True, env=env).stdout.split()[0]
    assert (out == "dual") is on, (value, out)


def test_the_command_is_valid_json_exec_form():
    import json

    argv = json.loads(_cmd_line()[len("CMD "):])
    assert argv[:2] == ["sh", "-c"] and len(argv) == 3


# ── both sockets really answer ────────────────────────────────────────────────

async def _tiny_app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            msg = await receive()
            if msg["type"] == "lifespan.startup":
                await send({"type": "lifespan.startup.complete"})
            elif msg["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
    await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"text/plain")]})
    await send({"type": "http.response.body", "body": b"ok"})


@pytest.mark.skipif(not _has_ipv6_loopback(), reason="this machine has no IPv6 loopback")
def test_both_sockets_answer():
    import uvicorn

    port = _free_port()
    socks = serve_dual.build_sockets(port)
    assert len(socks) == 2
    server = uvicorn.Server(uvicorn.Config(_tiny_app, log_level="warning", timeout_graceful_shutdown=1))
    t = threading.Thread(target=lambda: server.run(sockets=socks), daemon=True)
    t.start()
    try:
        deadline = time.time() + 10
        while not server.started and time.time() < deadline:
            time.sleep(0.05)
        assert server.started, "the server did not start"
        for host in ("127.0.0.1", "::1"):
            conn = http.client.HTTPConnection(host, port, timeout=5)
            conn.request("GET", "/")
            resp = conn.getresponse()
            assert (resp.status, resp.read()) == (200, b"ok"), host
            conn.close()
    finally:
        server.should_exit = True
        t.join(timeout=10)
        _close(socks)
