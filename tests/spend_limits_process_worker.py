"""A real second OS process for tests/test_uct_agent_limits_two_processes.py. Not a test.

Started with its database paths in the environment, so it shares only the SQLite files with the parent. It waits on a
go-file so the processes race, runs threads, and prints one JSON line. Nothing here reaches a provider.
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))


class Timeout(Exception):
    """Not an HTTP error response: the call may have been billed, so its reservation stands."""


class StubProvider:
    def __init__(self):
        self.calls, self.lock, self.messages = 0, threading.Lock(), self

    def create(self, **_kw):
        with self.lock:
            self.calls += 1
        raise Timeout()


def on_your_marks(go: str, threads: int) -> threading.Barrier:
    print(json.dumps({"ready": True}), flush=True)
    deadline = time.time() + 30
    while not os.path.exists(go):
        if time.time() > deadline:
            sys.exit("no go-file")
        time.sleep(0.005)
    return threading.Barrier(threads)


def run(threads: list) -> None:
    [t.start() for t in threads]
    [t.join() for t in threads]


def init() -> None:
    """The schema a running site already has, so a race measures the limit and not a first open."""
    import contextlib
    from api.services.catalyst import store
    from api.services.uct_agent import budget, limits
    store._init_db()
    for connect in (limits._connect, budget._connect):
        with contextlib.closing(connect()):
            pass


def admit(go: str, members: str, hold_file: str) -> None:
    """Each thread takes one member's slot and keeps it until the parent says stop."""
    from api.services.uct_agent import limits
    limits.RENEW_EVERY_S = float(os.environ.get("SPEND_TEST_RENEW_S") or limits.RENEW_EVERY_S)
    names = members.split(",")
    barrier, got, refused, lock = on_your_marks(go, len(names)), [], [], threading.Lock()

    def one(name):
        barrier.wait()
        try:
            token = limits.admit(name, new_request=False)
        except limits.Refused as e:
            with lock:
                refused.append(e.reason)
            return
        with lock:
            got.append([name, token])

    run([threading.Thread(target=one, args=(n,)) for n in names])
    print(json.dumps({"got": got, "refused": refused}), flush=True)
    deadline = time.time() + 60
    while not os.path.exists(hold_file) and time.time() < deadline:
        time.sleep(0.01)


def vision(go: str, member: str, uploads: str) -> None:
    """The real door: one member's uploads racing, each timing out, so each keeps its worst case."""
    from api.services import indicator_from_image as svc
    n = int(uploads)
    barrier, provider, gates, lock = on_your_marks(go, n), StubProvider(), [], threading.Lock()
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32

    def one():
        barrier.wait()
        out = svc.candidates_from_image(image_bytes=png, media_type="image/png", user_id=member, client=provider)
        with lock:
            gates.append(out.get("gate"))

    run([threading.Thread(target=one) for _ in range(n)])
    print(json.dumps({"calls": provider.calls, "gates": gates}), flush=True)


if __name__ == "__main__":
    {"init": init, "admit": admit, "vision": vision}[sys.argv[1]](*sys.argv[2:])
