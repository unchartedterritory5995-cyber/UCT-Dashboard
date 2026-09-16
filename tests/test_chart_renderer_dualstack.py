"""The chart-renderer listener must answer on BOTH IP families.

⚰️⚰️ THIS FILE EXISTS BECAUSE A DEPLOY FAILED TWICE FOR WANT OF ONE SOCKOPT.
`uvicorn --host ::` looks dual-stack and is not: CPython's asyncio sets
`IPV6_V6ONLY` on every AF_INET6 server socket. Railway's healthcheck probe
arrives over IPv4, so it could never connect — while the application was up,
healthy, and had already rendered its warm page. Eleven failed probes, and not
one `GET /health` line in the logs to show for it, because nothing arrived.

⛔ THE ASSERTIONS ARE THE TWO HALVES OF THE REQUIREMENT, and both must hold:
  * IPv6 — Railway's private network, how `web` actually reaches this service
    (`fd12:…` sources in its own access log). Losing this breaks every render.
  * IPv4 — Railway's healthcheck prober. Losing this makes the service
    undeployable, which is the bug that produced this file.

A test that checked only one of them would have passed happily on the broken
build.
"""
from __future__ import annotations

import os
import socket
import sys

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "services", "chart_renderer"))

from serve import build_listener, listen_port  # noqa: E402


@pytest.fixture
def listener():
    sock = build_listener(0)          # port 0 = let the OS pick; no clash in CI
    try:
        yield sock
    finally:
        sock.close()


def test_the_listener_is_IPv6_and_DUAL_STACK(listener):
    """⛔⛔ THE ONE SOCKOPT. `IPV6_V6ONLY == 0` IS the fix; everything else here
    is a consequence of it."""
    assert listener.family == socket.AF_INET6
    assert listener.getsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY) == 0, (
        "the listener is IPv6-ONLY — Railway's IPv4 healthcheck can never reach it")


def test_IPv4_can_connect(listener):
    """The Railway healthcheck's family. This is the half that was broken."""
    port = listener.getsockname()[1]
    with socket.create_connection(("127.0.0.1", port), timeout=5):
        pass


def test_IPv6_can_connect(listener):
    """Railway's private network — how `web` actually reaches the renderer.
    Losing this would trade a broken healthcheck for broken renders."""
    port = listener.getsockname()[1]
    with socket.create_connection(("::1", port), timeout=5):
        pass


def test_the_listener_is_already_LISTENING(listener):
    """`socket.create_server` listens for us; uvicorn is handed a ready fd and
    must never create a socket of its own — its own `--host ::` is the
    IPv6-only path this file exists to avoid."""
    assert listener.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN) == 1


def test_the_PORT_env_is_respected(monkeypatch):
    monkeypatch.setenv("PORT", "9137")
    assert listen_port() == 9137


@pytest.mark.parametrize("raw", ["", "   ", "abc", "0", "-1", "70000"])
def test_a_NONSENSE_PORT_falls_back_rather_than_crashing(monkeypatch, raw):
    """⚠️ A bad PORT must not take the renderer down at boot; the Dockerfile
    default is the safe answer."""
    monkeypatch.setenv("PORT", raw)
    assert listen_port() == 8080


def test_the_DOCKERFILE_ships_and_runs_this_launcher():
    """⚰️ THE TRAP THIS PROJECT HAS ALREADY HIT ONCE: the renderer's Dockerfile
    copies files INDIVIDUALLY, so a module that is not listed is an ImportError
    at boot. It must both COPY serve.py and actually start it — a launcher that
    ships but is never invoked leaves the IPv6-only bug in place."""
    with open(os.path.join(_ROOT, "services", "chart_renderer", "Dockerfile"),
              encoding="utf-8") as fh:
        raw = fh.read()

    # ⚰️ CODE, NEVER PROSE — a lesson this repo has already paid for twice. The
    # first version of this rail scanned the whole file for `--host ::` and went
    # red on the COMMENT that documents the old invocation, exactly as
    # `tools/pre_push_guard.py` once matched `shell=True` inside its own
    # docstring. Strip the comments, then assert against what actually runs.
    instructions = "\n".join(ln for ln in raw.splitlines()
                             if not ln.lstrip().startswith("#"))

    assert "COPY serve.py ." in instructions, "serve.py is not copied into the image"
    cmd = instructions.split("CMD")[-1]
    assert "serve.py" in cmd, "CMD does not run serve.py"
    assert "--host ::" not in instructions, (
        "the IPv6-ONLY uvicorn invocation is back in an INSTRUCTION — "
        "this is the undeployable bug")


def test_the_handoff_uses_SOCKETS_not_FD():
    """⚰️ `uvicorn.run(..., fd=sock.fileno())` IS THE OBVIOUS CALL AND IT IS WRONG.

    That option exists for systemd socket activation and hardcodes the family:

        sock = socket.fromfd(config.fd, socket.AF_UNIX, socket.SOCK_STREAM)

    Handing it our AF_INET6 listener makes uvicorn reinterpret a TCP socket as a
    unix socket. Local proof caught it before it shipped: the server never
    started and BOTH probes timed out — in production indistinguishable from the
    IPv6-only bug this whole file exists to fix.

    `sockets=[...]` is the supported pre-bound path. This rail keeps a future
    "simplification" from quietly reintroducing the broken one.
    """
    with open(os.path.join(_ROOT, "services", "chart_renderer", "serve.py"),
              encoding="utf-8") as fh:
        src = fh.read()
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("#"))
    body = code.split('"""')[-1]          # past the module docstring
    assert "sockets=[sock]" in body, "the pre-bound socket is not handed to uvicorn"
    assert "fd=sock.fileno()" not in body, (
        "the AF_UNIX `fd=` handoff is back — uvicorn will misread the TCP socket")
