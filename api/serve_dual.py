"""Start the web server on TWO listening sockets: the public one, plus the private network.

Why this exists. `web` has always started as

    uvicorn api.main:app --host 0.0.0.0 --port $PORT --proxy-headers \
        --forwarded-allow-ips='*' --timeout-graceful-shutdown 5

`0.0.0.0` is IPv4. Railway's private network in this project is IPv6, so no other service
can open a connection to `web` (`api/flow_worker_main.py` and `api/schwab_token_replica.py`
both record a private pull from `web` that was deployed and disproved).

Changing `--host` to `::` is not the fix. On this platform that produced an IPv6-ONLY
listener (the chart renderer), and `web`'s public traffic arrives over IPv4: the change
that makes `web` reachable privately could make it unreachable publicly. So nothing about
the public socket changes here. It is created first, exactly as uvicorn creates it, and a
second, IPv6-only socket is added beside it. Both are handed to one uvicorn server, one
application, one event loop.

Off by default. The image's CMD runs this module only when `WEB_PRIVATE_LISTEN_ENABLED=1`;
otherwise it runs the command line above, byte for byte. To turn it back off: unset the
variable and redeploy.

If the IPv6 socket cannot be created or bound, that is logged in one line and the server
starts on the public socket alone. If the PUBLIC socket cannot be bound, the error is
raised: a process with no public listener must fail its start, not serve nobody.
"""
from __future__ import annotations

import os
import socket
import sys

APP = "api.main:app"
DEFAULT_PORT = 8080


def enabled() -> bool:
    """Whether the second listener is switched on: true for exactly "1" and nothing else.

    The image's CMD applies the same test in shell before it ever starts this module, so
    this is the one place Python states the rule. `tests/test_serve_dual.py` reads both
    and fails if they stop agreeing.
    """
    return os.environ.get("WEB_PRIVATE_LISTEN_ENABLED", "0") == "1"


def listen_port() -> int:
    """`$PORT`, else 8080: the same default as the uvicorn command line."""
    return int(os.environ.get("PORT") or DEFAULT_PORT)


def _bound(family: int, host: str, port: int, *, v6only: bool = False) -> socket.socket:
    """A bound, not yet listening, stream socket (uvicorn listens when it starts serving)."""
    sock = socket.socket(family, socket.SOCK_STREAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if v6only:
            # Without this an IPv6 wildcard socket may also claim the IPv4 port (dual stack),
            # and the two sockets would then fight over it.
            sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        sock.bind((host, port))
        sock.set_inheritable(True)
    except BaseException:
        sock.close()
        raise
    return sock


def build_sockets(port: int) -> list[socket.socket]:
    """The public IPv4 socket first, then the private IPv6 one when it can be had."""
    socks = [_bound(socket.AF_INET, "0.0.0.0", port)]
    try:
        socks.append(_bound(socket.AF_INET6, "::", port, v6only=True))
    except OSError as exc:
        print(f"[serve-dual] no IPv6 listener ({exc!r}); serving on IPv4 only", file=sys.stderr, flush=True)
    return socks


def build_config():
    """The same settings the uvicorn command line passes. `tests/test_serve_dual.py`
    parses the image's CMD and compares, so the two cannot drift apart."""
    import uvicorn

    return uvicorn.Config(
        APP,
        proxy_headers=True,
        forwarded_allow_ips="*",
        timeout_graceful_shutdown=5,
    )


def main() -> None:
    import uvicorn

    if not enabled():
        # Reached only by running the module by hand; the image's CMD checks first.
        print("[serve-dual] started without WEB_PRIVATE_LISTEN_ENABLED=1", file=sys.stderr, flush=True)
    port = listen_port()
    socks = build_sockets(port)
    families = "+".join("ipv6" if s.family == socket.AF_INET6 else "ipv4" for s in socks)
    print(f"[serve-dual] listening on port {port} ({families})", file=sys.stderr, flush=True)
    uvicorn.Server(build_config()).run(sockets=socks)


if __name__ == "__main__":
    main()
