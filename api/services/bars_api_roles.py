"""bars-api in SEVERAL PROCESSES on one volume (capacity-500, 2026-11-28): one LEADER, the rest FOLLOWERS.

⭐ WHY. Every bar read here is a row-by-row SQLite read plus a JSON encode, all under ONE GIL, so the single
uvicorn process this tier ran tops out near one core (~100 member asks a second, measured by the 500-member
replay, `docs/runbooks/capacity-500.md`) while its container has 32 vCPU. SQLite in WAL mode lets any number
of processes READ one file at once, so `BARS_API_WORKERS=N` (uvicorn `workers=N`, one listening socket,
the kernel spreads connections) multiplies the read capacity. A volume cannot be mounted by a second replica,
so processes inside the one container are how this tier scales up.

⛔ WHAT MUST STAY SINGLE. The background work of this tier was written for one process: the R2 puller and
the clustered-store adoption (they REPLACE the file), the WAL checkpointer, the pack ingest, the hot-set push,
the universe live store (`bars_live_store`: the web pod's 5m/1m pushes, the backfill, the whole-market daily
poll, its checkpoint), the cash-index warm loop (vendor calls), the rebuilt-history and corrections syncs (R2
pulls), the off-grid sweep. Run N times, each would multiply vendor calls and SQLite writers, and the live
store's coverage (who is current, in MEMORY) would be split across processes, so most reads would see "not
covered" and fall to a provider fetch. So:

  * ELECTION: the first process to take an exclusive lock on `<DATA_DIR>/.bars-api-leader.lock` is the
    LEADER and runs everything the single process ran. The others are FOLLOWERS: they serve /api/bars and
    /api/bars-history only. A follower retries the lock every `PROMOTE_EVERY_S`; if the leader dies (the lock
    is released by the kernel with its process), one follower PROMOTES itself and starts the leader's work.
  * THE LIVE STORE'S COVERAGE is published by the leader to `<DATA_DIR>/.bars-live-view.pkl` (atomic
    replace) after every push it applies and every `PUBLISH_EVERY_S`; a follower answers `covered()`,
    `proven_through_s()`, `history_complete()` and the alive checks from that view (re-read when the file
    changes, checked at most every `VIEW_CHECK_S`), so a follower's read is fresh exactly when the leader's
    would be. A follower that finds a ticker uncovered asks the leader to repair it (`/internal/live-want`),
    off the request thread, deduped.
  * THE WEB POD'S PUSH (`POST /internal/live-bars`) can land on any process (one socket). A follower forwards
    the body verbatim to the leader's loopback port (`LEADER_PORT`) and returns the leader's answer; an
    unreachable leader answers 503 and the web pod's flusher re-queues (`bars_live_ingest.requeue`).
  * REBUILT HISTORY / CORRECTIONS: a follower loads the leader's synced local copy and re-loads it when its
    manifest file changes (`RELOAD_EVERY_S`).
  * THE STORE FILE: a follower's SQLite connections re-open when the file's identity changes (the leader
    replaced it: install, adoption, legacy replace-pull), see `bars_sqlite._conn` (`file_identity_check`).

`BARS_API_WORKERS` unset or 1 = exactly the single process of before (role "solo", nothing here runs).
"""
from __future__ import annotations

import json
import logging
import os
import pickle
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Optional

_log = logging.getLogger("uvicorn.error")

MAX_WORKERS = 64
#: The leader's loopback-only port for what followers hand it (pushes, repair wants, status).
LEADER_PORT = int(os.environ.get("BARS_API_LEADER_PORT", "18999") or 18999)
PUBLISH_EVERY_S = float(os.environ.get("BARS_API_VIEW_PUBLISH_S", "0.5") or 0.5)
VIEW_CHECK_S = float(os.environ.get("BARS_API_VIEW_CHECK_S", "0.05") or 0.05)
PROMOTE_EVERY_S = float(os.environ.get("BARS_API_PROMOTE_S", "2") or 2)
RELOAD_EVERY_S = float(os.environ.get("BARS_API_RELOAD_S", "5") or 5)
WANT_DEDUP_S = 2.0
FORWARD_TIMEOUT_S = 15.0

_role = "solo"
_lock_fh = None
_lock_guard = threading.Lock()


def workers() -> int:
    """`BARS_API_WORKERS`, clamped to 1..MAX_WORKERS (unset, blank or junk = 1: the single process)."""
    try:
        n = int(str(os.environ.get("BARS_API_WORKERS", "1")).strip() or 1)
    except ValueError:
        n = 1
    return max(1, min(MAX_WORKERS, n))


def multiprocess() -> bool:
    return workers() > 1


def role() -> str:
    return _role


def data_dir() -> str:
    return os.environ.get("DATA_DIR", "/data")


def _lock_path() -> str:
    return os.path.join(data_dir(), ".bars-api-leader.lock")


def view_path() -> str:
    return os.path.join(data_dir(), ".bars-live-view.pkl")


def _try_lock() -> bool:
    """Take the leader lock without waiting; keep its handle open for the life of the process."""
    global _lock_fh
    with _lock_guard:
        if _lock_fh is not None:
            return True
        os.makedirs(data_dir(), exist_ok=True)
        fh = open(_lock_path(), "a+b")
        try:
            if os.name == "nt":                      # dev boxes / CI on Windows
                import msvcrt
                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            fh.close()
            return False
        try:
            fh.seek(0)
            fh.truncate()
            fh.write(str(os.getpid()).encode())
            fh.flush()
        except OSError:
            pass
        _lock_fh = fh
        return True


def elect() -> str:
    """This process's role: "solo" (one process, as before), "leader" or "follower"."""
    global _role
    if not multiprocess():
        _role = "solo"
    else:
        _role = "leader" if _try_lock() else "follower"
    return _role


def _release_for_tests() -> None:
    global _lock_fh, _role
    with _lock_guard:
        if _lock_fh is not None:
            try:
                _lock_fh.close()
            except OSError:
                pass
        _lock_fh = None
    _role = "solo"


# ── the leader's side ────────────────────────────────────────────────────────────────────────────────────────

def _atomic_write(path: str, data: bytes) -> None:
    tmp = "%s.%d.tmp" % (path, os.getpid())
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def publish_view() -> bool:
    """Write the live store's coverage for the followers (leader only; never raises)."""
    if _role not in ("leader",):
        return False
    try:
        from api.services import bars_live_store
        view = bars_live_store.export_view()
        _atomic_write(view_path(), pickle.dumps(view, protocol=pickle.HIGHEST_PROTOCOL))
        return True
    except Exception as e:  # noqa: BLE001 - a publish must never break the leader's push path
        _log.warning("[bars-api] coverage view publish failed (non-fatal): %s", e)
        return False


def _publisher_loop() -> None:
    while _role == "leader":
        publish_view()
        time.sleep(PUBLISH_EVERY_S)


class _LeaderHandler(BaseHTTPRequestHandler):
    """Loopback-only. Every route needs the service bearer the follower was given (the web pod's own header
    for a forwarded push, the follower's PUSH_SECRET for a want)."""
    server_version = "bars-api-leader"

    def log_message(self, *a):  # quiet: these are internal hand-offs, a few a second at most
        pass

    def _authorized(self) -> bool:
        from api.flow_admin_auth import _push_secret_ok
        return _push_secret_ok(self.headers.get("Authorization", ""))

    def _reply(self, code: int, obj) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._authorized():
            return self._reply(401, {"detail": "Not authenticated"})
        if self.path.split("?")[0] == "/internal/live-status":
            from api.services import bars_live_store
            return self._reply(200, bars_live_store.status())
        return self._reply(404, {"detail": "not found"})

    def do_POST(self):
        if not self._authorized():
            return self._reply(401, {"detail": "Not authenticated"})
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        path = self.path.split("?")[0]
        from api.services import bars_live_store
        try:
            payload = json.loads(raw or b"{}")
        except ValueError:
            return self._reply(400, {"detail": "bad json"})
        if path == "/internal/live-bars":
            out = bars_live_store.ingest(payload)
            publish_view()
            return self._reply(200, out)
        if path == "/internal/live-want":
            bars_live_store.want_from_follower(str(payload.get("sym") or ""), str(payload.get("tf") or ""))
            return self._reply(200, {"ok": True})
        return self._reply(404, {"detail": "not found"})


_server: Optional[ThreadingHTTPServer] = None


def start_leader_services() -> None:
    """The leader's hand-off port and the view publisher (the leader's background work itself is started by
    `bars_api_main._lifespan`, exactly as the single process did)."""
    global _server
    if _role != "leader" or _server is not None:
        return
    try:
        _server = ThreadingHTTPServer(("127.0.0.1", LEADER_PORT), _LeaderHandler)
        _server.daemon_threads = True
        threading.Thread(target=_server.serve_forever, daemon=True, name="bars-api-leader-port").start()
    except OSError as e:
        _log.warning("[bars-api] leader port %d not bound (followers cannot hand off): %s", LEADER_PORT, e)
    threading.Thread(target=_publisher_loop, daemon=True, name="bars-api-view-publish").start()
    _log.info("[bars-api] LEADER pid=%d (of %d processes): background work + hand-off port 127.0.0.1:%d",
              os.getpid(), workers(), LEADER_PORT)


# ── the follower's side ──────────────────────────────────────────────────────────────────────────────────────

def forward_to_leader(method: str, path: str, body: bytes, authorization: str) -> tuple[int, bytes]:
    """(status, body) of the same request on the leader's loopback port; 503 when it cannot be reached."""
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (LEADER_PORT, path), data=body if method == "POST" else None,
                                 method=method, headers={"Authorization": authorization or "",
                                                         "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=FORWARD_TIMEOUT_S) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # noqa: BLE001 - the leader is restarting or promoting
        return 503, json.dumps({"detail": "bars-api leader unavailable: %s" % type(e).__name__}).encode()


class FollowerView:
    """The leader's published coverage, read the way `bars_live_store` reads its own state."""

    def __init__(self, path: Optional[str] = None, now_wall: Callable[[], float] = time.time,
                 want_sender: Optional[Callable[[str, str], None]] = None):
        self.path = path or view_path()
        self._now = now_wall
        self._v: dict = {}
        self._mtime = None
        self._checked = 0.0
        self._lk = threading.Lock()
        self._wanted: dict = {}
        self._send = want_sender or _send_want_async

    def _fresh(self) -> dict:
        t = time.monotonic()
        if t - self._checked < VIEW_CHECK_S:
            return self._v
        with self._lk:
            if t - self._checked < VIEW_CHECK_S:
                return self._v
            self._checked = t
            try:
                m = os.stat(self.path).st_mtime_ns
            except OSError:
                return self._v
            if m != self._mtime:
                try:
                    with open(self.path, "rb") as f:
                        self._v = pickle.load(f)
                    self._mtime = m
                except Exception:  # noqa: BLE001 - a torn read: keep the last good view, retry next check
                    pass
        return self._v

    def _age_ok(self, key: str, limit: float) -> bool:
        t = self._fresh().get(key)
        return t is not None and (self._now() - t) <= limit

    def stream_alive(self) -> bool:
        v = self._fresh()
        return self._age_ok("last_push_wall", v.get("stream_alive_s", 30.0))

    def m1_alive(self) -> bool:
        v = self._fresh()
        return self._age_ok("m1_last_push_wall", v.get("stream_alive_s", 30.0))

    def daily_alive(self) -> bool:
        v = self._fresh()
        return self._age_ok("daily_last_ok_wall", v.get("daily_alive_s", 45.0))

    def want(self, sym: str, tf: str) -> None:
        k = (sym, tf)
        t = time.monotonic()
        if self._wanted.get(k, -1e9) > t - WANT_DEDUP_S:
            return
        self._wanted[k] = t
        if len(self._wanted) > 20000:
            self._wanted.clear()
        self._send(sym, tf)

    def view(self) -> dict:
        return self._fresh()


_want_q: list = []
_want_ev = threading.Event()
_want_thread: Optional[threading.Thread] = None


def _want_loop() -> None:
    from api.bars_auth import bars_service_headers
    while True:
        _want_ev.wait(1.0)
        _want_ev.clear()
        while _want_q:
            sym, tf = _want_q.pop(0)
            forward_to_leader("POST", "/internal/live-want", json.dumps({"sym": sym, "tf": tf}).encode(),
                              bars_service_headers().get("Authorization", ""))


def _send_want_async(sym: str, tf: str) -> None:
    global _want_thread
    if _want_thread is None:
        _want_thread = threading.Thread(target=_want_loop, daemon=True, name="bars-api-want")
        _want_thread.start()
    if len(_want_q) < 5000:
        _want_q.append((sym, tf))
    _want_ev.set()


def _reload_loop() -> None:
    """Follow the leader's synced rebuilt-history and corrections copies (they live on the shared volume)."""
    from api.services import bars_corrections, bars_rebuild
    seen: dict = {}
    while _role == "follower":
        for mod in (bars_rebuild, bars_corrections):
            try:
                if not mod.enabled():
                    continue
                p = os.path.join(str(mod.local_dir()), "manifest.json")
                m = os.stat(p).st_mtime_ns
                if seen.get(mod.__name__) != m:
                    if mod.load_local():
                        seen[mod.__name__] = m
            except OSError:
                pass
            except Exception as e:  # noqa: BLE001
                _log.warning("[bars-api] follower reload of %s failed (non-fatal): %s", mod.__name__, e)
        time.sleep(RELOAD_EVERY_S)


def start_follower_services(promote: Callable[[], None]) -> None:
    """A follower reads the leader's coverage, follows its synced copies, and takes over if the leader dies."""
    from api.services import bars_live_store
    bars_live_store.install_view(FollowerView())
    threading.Thread(target=_reload_loop, daemon=True, name="bars-api-follow-copies").start()

    def _watch():
        global _role
        while _role == "follower":
            time.sleep(PROMOTE_EVERY_S)
            if _try_lock():
                _role = "leader"
                bars_live_store.install_view(None)
                _log.warning("[bars-api] the leader is gone: pid=%d PROMOTED itself to leader", os.getpid())
                try:
                    promote()
                except Exception as e:  # noqa: BLE001
                    _log.warning("[bars-api] promotion start failed: %s", e)
                start_leader_services()
                return

    threading.Thread(target=_watch, daemon=True, name="bars-api-promote-watch").start()
    _log.info("[bars-api] FOLLOWER pid=%d (of %d processes): serving reads; coverage from %s",
              os.getpid(), workers(), view_path())
