"""chart-renderer entrypoint — a DUAL-STACK listener.

⚰️⚰️ WHY THIS FILE EXISTS, AND WHY `--host ::` WAS NOT ENOUGH.
The Dockerfile used to start `uvicorn app:app --host ::`, on the correct
reasoning that Railway's private network is IPv6 and a `0.0.0.0` listener is
unreachable from web (this repo proved that the hard way — see the note in
`api/flow_worker_main.py`: "connections were REFUSED on 8080/8000/80 over both
families"). That reasoning was right and the implementation was still wrong:

    `--host ::` IS NOT DUAL-STACK. IT IS IPv6-ONLY.

CPython's `asyncio.BaseEventLoop.create_server` explicitly does

    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, True)

on every AF_INET6 server socket, so the listener refuses IPv4 outright.

⛔ THE COST WAS A DEPLOY THAT COULD NEVER SUCCEED. Railway's healthcheck probe
arrives over IPv4. Against an IPv6-only socket it cannot connect, so the check
failed 11 times over 5 minutes while the application was up, healthy, and had
already rendered its warm page. The give-away was the absence of evidence: this
app logs an access line for every request, and the failed deployments contained
ZERO `GET /health` lines. Nothing was rejected — nothing ever arrived.

⭐ THE CONTROLS THAT PROVED IT, all in this same project: `worker` and
`flow-worker` are private-only too, both bind `0.0.0.0` (IPv4-only), and both
pass the identical healthcheck. The one service bound IPv6-only is the one that
fails. And the currently-live renderer deployment predates the healthcheck being
configured at all (`healthcheckPath: null`), which is why this never surfaced
until a GitHub deploy first exercised it.

⭐ SO THE FIX IS BOTH FAMILIES, NOT THE OTHER ONE. Switching to `0.0.0.0` would
trade a broken healthcheck for broken renders: this service really does receive
its peer traffic over IPv6 (`fd12:…` sources in its own access log). It needs
IPv6 for web and IPv4 for the prober, so it listens for both — one AF_INET6
socket with `IPV6_V6ONLY` turned OFF, handed to uvicorn pre-bound.
"""
from __future__ import annotations

import os
import socket

import uvicorn

#: Railway injects PORT; 8080 matches the Dockerfile default so a bare
#: `python serve.py` behaves the same locally.
DEFAULT_PORT = 8080


def listen_port() -> int:
    raw = (os.environ.get("PORT") or "").strip()
    try:
        port = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_PORT
    return port if 0 < port < 65536 else DEFAULT_PORT


def build_listener(port: int | None = None) -> socket.socket:
    """A bound, listening, DUAL-STACK socket — IPv6 and IPv4 on one fd.

    ⛔ FAILS LOUDLY IF DUAL-STACK IS UNAVAILABLE. A silent fallback to IPv6-only
    would reproduce exactly the bug this file exists to fix, and it would do it
    invisibly: the app would look perfectly healthy while the healthcheck it
    must answer could never reach it.

    ⭐ `IPV6_V6ONLY == 0` is asserted here rather than trusted, because that
    single sockopt IS the fix. `tests/test_chart_renderer_dualstack.py` asserts
    it again from the outside, and connects over both families to prove it.
    """
    port = listen_port() if port is None else port
    if not socket.has_dualstack_ipv6():
        raise RuntimeError(
            "dual-stack IPv6 is unavailable on this platform; chart-renderer "
            "needs IPv6 for Railway peer traffic AND IPv4 for the healthcheck")

    sock = socket.create_server(("::", port), family=socket.AF_INET6,
                                dualstack_ipv6=True)
    v6only = sock.getsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY)
    if v6only:
        sock.close()
        raise RuntimeError(
            f"listener came up IPv6-ONLY (IPV6_V6ONLY={v6only}) — the Railway "
            "healthcheck arrives over IPv4 and could never reach it")
    return sock


def main() -> None:
    """Serve `app:app` on the dual-stack socket.

    ⚰️ NOT `uvicorn.run(..., fd=sock.fileno())`, WHICH LOOKS RIGHT AND IS NOT.
    That option is built for systemd socket activation and hardcodes the family:

        sock = socket.fromfd(config.fd, socket.AF_UNIX, socket.SOCK_STREAM)

    Handing it our AF_INET6 listener makes uvicorn reinterpret a TCP socket as a
    unix socket. Local proof caught it before it shipped — the server never came
    up and both probes timed out, which in production would have looked exactly
    like the IPv6-only bug this file exists to fix.

    ⭐ `sockets=[...]` IS the supported pre-bound path (it is what gunicorn's
    uvicorn worker uses): uvicorn serves the socket as given and never creates
    one of its own.
    """
    sock = build_listener()
    server = uvicorn.Server(uvicorn.Config("app:app"))
    server.run(sockets=[sock])


if __name__ == "__main__":
    main()
