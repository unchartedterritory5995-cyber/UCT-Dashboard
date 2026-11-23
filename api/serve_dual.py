"""Start the web server on TWO listening sockets: the public one, plus the private network.

Why this exists. `web` has always started as

    uvicorn api.main:app --host 0.0.0.0 --port $PORT --proxy-headers \
        --forwarded-allow-ips='*' --timeout-graceful-shutdown 5

`0.0.0.0` is IPv4. Railway's private network in this project is IPv6, so no other service
can open a connection to `web` (`api/flow_worker_main.py` and the retired `api/schwab_token_replica.py`
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

The process ENDS when the server has shut down (`exit_after_shutdown`). Measured
2026-11-22: after Railway's SIGTERM, uvicorn finished its shutdown (the lifespan saved
the cache snapshot and stopped the scheduler) and `main()` returned, but the interpreter
then waited on a non-daemon thread (a scheduler job still running) until Railway killed
it at drainingSeconds=30. `web` has a volume, so the next pod cannot start until this
one is gone: about 24 s of every deploy's member hold was a process with nothing left to
do. uvicorn's own way out (re-raising the SIGTERM it caught) does nothing here, because
this process is PID 1 and the kernel ignores a default-action signal sent to PID 1.
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time

APP = "api.main:app"
DEFAULT_PORT = 8080

#: The total time, across all leftover non-daemon threads, that the process waits for
#: them after the server's shutdown, before it exits anyway.
THREAD_JOIN_SECONDS = 5.0

#: The exit code when the server never started: uvicorn's own (`uvicorn.main.STARTUP_FAILURE`),
#: what the plain command line exits with.
STARTUP_FAILURE = 3


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


def exit_after_shutdown(code: int, *, budget: float | None = None,
                        signalled_at: float | None = None) -> None:
    """End the process after the server's shutdown, without waiting on stragglers forever.

    Called only once `uvicorn.Server.run()` has RETURNED, which is after the lifespan
    shutdown has run to its end. Each leftover non-daemon thread is joined against ONE
    shared deadline (`THREAD_JOIN_SECONDS` in total, never per thread); any still alive
    after it is named in one log line. stdio is flushed, then `os._exit`: no further
    interpreter shutdown, so nothing can hold the pod past this point.

    ⭐ ALWAYS ONE `[serve-dual] exit after` LINE (track 6, 2026-11-22), so a swap's hold can be
    split from the pod's own log: the seconds from the shutdown signal (``signalled_at``, the
    monotonic instant `main` saw SIGTERM/SIGINT) to this exit, the server's own shutdown
    (the graceful drain and the lifespan) and the thread join. Without a signal (run by hand,
    or a server told to stop in-process) the line says so and still names the join.
    """
    budget = THREAD_JOIN_SECONDS if budget is None else budget
    joined_from = time.monotonic()
    deadline = joined_from + budget
    skip = {threading.current_thread(), threading.main_thread()}
    for t in threading.enumerate():
        if t in skip or t.daemon:
            continue
        t.join(max(0.0, deadline - time.monotonic()))
    alive = [t.name for t in threading.enumerate() if t not in skip and not t.daemon and t.is_alive()]
    if alive:
        print(f"[serve-dual] exiting with {len(alive)} non-daemon thread(s) still running after "
              f"{budget:g}s: {', '.join(alive)}", file=sys.stderr, flush=True)
    now = time.monotonic()
    join = now - joined_from
    if signalled_at is not None:
        print(f"[serve-dual] exit after {now - signalled_at:.1f}s from the shutdown signal "
              f"(the server's shutdown {joined_from - signalled_at:.1f}s, the thread join {join:.2f}s, "
              f"{len(alive)} thread(s) left)", file=sys.stderr, flush=True)
    else:
        print(f"[serve-dual] exit after the thread join {join:.2f}s ({len(alive)} thread(s) left; "
              f"no shutdown signal was seen)", file=sys.stderr, flush=True)
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.flush()
        except Exception:  # noqa: BLE001 - a closed stream never blocks the exit
            pass
    os._exit(code)


def main() -> None:
    import uvicorn

    if not enabled():
        # Reached only by running the module by hand; the image's CMD checks first.
        print("[serve-dual] started without WEB_PRIVATE_LISTEN_ENABLED=1", file=sys.stderr, flush=True)
    port = listen_port()
    socks = build_sockets(port)
    families = "+".join("ipv6" if s.family == socket.AF_INET6 else "ipv4" for s in socks)
    print(f"[serve-dual] listening on port {port} ({families})", file=sys.stderr, flush=True)
    server = uvicorn.Server(build_config())
    # The first shutdown signal's instant, for the always-on exit line. uvicorn installs
    # `self.handle_exit` as the signal handler when `run()` starts, so wrapping the bound
    # method on the instance (before `run()`) sees every signal it handles.
    signalled: list = []
    handle_exit = server.handle_exit

    def _timed_handle_exit(sig, frame):
        if not signalled:
            signalled.append(time.monotonic())
        handle_exit(sig, frame)

    server.handle_exit = _timed_handle_exit
    server.run(sockets=socks)
    # run() has returned, so the lifespan shutdown is over (snapshot saved, scheduler
    # stopped). If run() raised instead, the exception propagates as before: no hard exit
    # from a shutdown that may not have finished.
    exit_after_shutdown(0 if server.started else STARTUP_FAILURE,
                        signalled_at=signalled[0] if signalled else None)


if __name__ == "__main__":
    main()
