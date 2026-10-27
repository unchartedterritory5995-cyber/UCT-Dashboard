"""trade-exchange-news-receiver entrypoint: one DUAL-STACK listener, access log OFF.

⭐ Dual-stack for the reason ``services/chart_renderer/serve.py`` documents at
length: Railway's healthcheck probes over IPv4, peers may arrive over IPv6, and
``--host ::`` is IPv6-ONLY under CPython (asyncio forces IPV6_V6ONLY). One
AF_INET6 socket with IPV6_V6ONLY off, handed to uvicorn pre-bound.

⛔ ``access_log=False`` IS A SECURITY SETTING HERE, NOT A NOISE SETTING. The
webhook's path segment is its credential and uvicorn's access log prints every
path. ``txn_redaction.PathSecretFilter`` is the backstop, not the plan.
"""
from __future__ import annotations

import os
import socket

import uvicorn

DEFAULT_PORT = 8080


def listen_port() -> int:
    try:
        port = int((os.environ.get("PORT") or "").strip())
    except (TypeError, ValueError):
        return DEFAULT_PORT
    return port if 0 < port < 65536 else DEFAULT_PORT


def build_listener(port: int | None = None) -> socket.socket:
    port = listen_port() if port is None else port
    if not socket.has_dualstack_ipv6():
        raise RuntimeError("dual-stack IPv6 is unavailable on this platform")
    sock = socket.create_server(("::", port), family=socket.AF_INET6, dualstack_ipv6=True)
    if sock.getsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY):
        sock.close()
        raise RuntimeError("listener came up IPv6-ONLY; the IPv4 healthcheck could never reach it")
    return sock


def main() -> None:
    sock = build_listener()
    config = uvicorn.Config("txn_app:_boot_app", factory=True, access_log=False,
                            proxy_headers=True, forwarded_allow_ips="*",
                            timeout_graceful_shutdown=5)
    uvicorn.Server(config).run(sockets=[sock])


if __name__ == "__main__":
    main()
