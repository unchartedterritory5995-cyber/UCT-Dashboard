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

  * ⛔⛔ A FOLLOWER NEVER WRITES THE STORE AND NEVER STARTS PROVIDER WORK (review of #2962, H1/M1). Every swap guard
    (`bars_sqlite._WRITE_LOCK`, `DB_SWAP_LOCK`, write tracking) is a per-process object, so a follower's commit
    between the leader's TRUNCATE checkpoint and its `os.replace` would leave WAL frames beside the new file
    ("database disk image is malformed", the 2026-11-13 class) and an adoption would lose its untracked rows; and
    every "global" cap (`_cold_fetch_sem` 3, `_deepfill_sem` 2, the `_inflight` single-flight...) would be N times
    larger. So in a follower the store write lock, those caps, the single-flight maps and the provider fetches are
    LEADER-ONLY (`LeaderOnlyLock` / `LeaderOnlySemaphore` / `LeaderOnlyDict` / `LeaderOnlySet` / `leader_only`):
    the first step that would write or ask a provider raises `LeaderOnly` (a BaseException, so no
    `except Exception` on the way can swallow it), the bars routes catch it and hand the WHOLE request to the
    leader (`proxy_to_leader`), which answers it exactly as the single process would, under its own caps. The
    follower's SQLite connections are `query_only` too, so a write no guard names still cannot reach the file.
  * ⛔ THE STORE SWAP BARRIER (`store_swap_barrier`, leader; `follower_read_scope`, followers). A follower holds a
    SHARED lock on `<DATA_DIR>/.bars-store-swap.lock` for each read and re-checks the file's identity under it; the
    leader announces a swap (`.bars-store-swap.pending`), takes the lock EXCLUSIVE (it waits for in-flight follower
    reads; no new one starts: a follower that sees the announcement hands its request to the leader), and only
    then checkpoints and replaces. A replaced file's floor is persisted before the barrier opens again, so no
    follower serves the new file at the old file's revisions.

  * ⛔ BEST-EFFORT KICKS NEVER HAND THE REQUEST OFF (review of #2962, round 2). A fire-and-forget refresh (deep
    fill, SWR delta, since-tail heal, cold fetch, tail gap-fill, snapshot warm, W/M write) is not part of the answer,
    so a follower SKIPS it and asks the leader to replay the request in the background (`defer_to_leader`: deduped,
    async, a small separate cap on the leader), then answers from what it read. Only work the ANSWER waits on
    (a bounded delta, an interactive heal, a deep fetch) hands the whole request to the leader.
  * Per-process on purpose: `_warm_serve_sem` (it caps how many of THIS process's request threads a best-effort warm
    may hold, not a shared resource), the in-memory caches.

`BARS_API_WORKERS` unset or 1 = exactly the single process of before (role "solo", nothing here runs). The ONE
authority on "several processes" is `multiprocess()` (from `workers()`, memory-clamped): `bars_sqlite` asks it too.
"""
from __future__ import annotations

import json
import logging
import os
import pickle
import secrets
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Optional

_log = logging.getLogger("uvicorn.error")

#: ⛔ (review of #2962, L2) MEMORY, NOT vCPU, BOUNDS THE PROCESS COUNT. Each process holds its own Python heap, page
#: caches and in-memory bar caches: the replay measured ~1.2-2 GB private per process, so 24 processes cannot live in
#: a 32 GB container. `workers()` never exceeds the container's memory limit / `PROC_BUDGET_MB` (cgroup
#: `memory.max` when there is one) and never `MAX_WORKERS`.
MAX_WORKERS = 14
PROC_BUDGET_MB = int(os.environ.get("BARS_API_PROC_BUDGET_MB", "2048") or 2048)
#: The leader's loopback-only port for what followers hand it (pushes, repair wants, status).
LEADER_PORT = int(os.environ.get("BARS_API_LEADER_PORT", "18999") or 18999)
PUBLISH_EVERY_S = float(os.environ.get("BARS_API_VIEW_EVERY_S", "0.5") or 0.5)
VIEW_CHECK_S = float(os.environ.get("BARS_API_VIEW_CHECK_S", "0.05") or 0.05)
PROMOTE_EVERY_S = float(os.environ.get("BARS_API_PROMOTE_S", "2") or 2)
RELOAD_EVERY_S = float(os.environ.get("BARS_API_RELOAD_S", "5") or 5)
WANT_DEDUP_S = 2.0
FORWARD_TIMEOUT_S = 15.0
#: A follower request handed to the leader must still answer inside the edge's 8 s abort
#: (edge/bars-edge-router BARS_TIMEOUT_MS): the hand-off waits at most this minus what the follower already spent.
ESCALATE_DEADLINE_S = 7.5
#: How many handed-off requests the leader serves at once (each holds one of its hand-off threads); past it the
#: follower answers 503 + Retry-After, the same shed the single process gives under the same load.
ESCALATE_MAX = int(os.environ.get("BARS_API_ESCALATE_MAX", "96") or 96)
_escalate_sem = threading.BoundedSemaphore(max(1, ESCALATE_MAX))
#: ⛔ A hand-off shed must be one the EDGE reads as deliberate (edge/bars-edge-router/tail.js isDeliberateTierShed: 503
#: + Retry-After + X-Bars-Shed in {warming, warm-shed}). Any other tag is a tier FAILURE there: the read goes to web
#: (another store) and opens the 20 s breaker that sends every read to web. The reason travels in its own header.
SHED_HEADERS = [("Content-Type", "application/json"), ("Retry-After", "2"), ("X-Bars-Shed", "warm-shed")]
#: Background replays a follower asks for (`defer_to_leader`): their own small cap, never the hand-off slots.
DEFER_MAX = 8
DEFER_DEDUP_S = 3.0
_defer_sem = threading.BoundedSemaphore(DEFER_MAX)

_role = "solo"
_lock_fh = None
_lock_guard = threading.Lock()


_mem_limit_cache: list = []


def _container_memory_bytes() -> Optional[int]:
    """The container's memory limit (cgroup v2 `memory.max`, v1 `memory.limit_in_bytes`), or None. Read once per
    process (`bars_sqlite` asks `multiprocess()` on every connection use)."""
    if _mem_limit_cache:
        return _mem_limit_cache[0]
    _mem_limit_cache.append(_read_container_memory_bytes())
    return _mem_limit_cache[0]


def _read_container_memory_bytes() -> Optional[int]:
    for p in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        try:
            with open(p) as f:
                raw = f.read().strip()
        except OSError:
            continue
        if raw.isdigit() and int(raw) < (1 << 50):         # "max" / a huge v1 number = no limit
            return int(raw)
    return None


def memory_ceiling() -> int:
    """How many processes the container's memory carries (MAX_WORKERS when no limit is visible)."""
    lim = _container_memory_bytes()
    if lim is None or PROC_BUDGET_MB <= 0:
        return MAX_WORKERS
    return max(1, min(MAX_WORKERS, lim // (PROC_BUDGET_MB << 20)))


def workers() -> int:
    """`BARS_API_WORKERS`, clamped to 1..memory_ceiling() (unset, blank or junk = 1: the single process)."""
    try:
        n = int(str(os.environ.get("BARS_API_WORKERS", "1")).strip() or 1)
    except ValueError:
        n = 1
    return max(1, min(memory_ceiling(), n))


def multiprocess() -> bool:
    return workers() > 1


def role() -> str:
    return _role


def is_follower() -> bool:
    return _role == "follower"


# ── leader-only work (review of #2962, H1 + M1) ─────────────────────────────────────────────────────────────

class LeaderOnly(BaseException):
    """A follower reached work only the leader may do (a store write, a provider fetch, a capped job). A
    BaseException on purpose: the bars core is full of `except Exception` fallbacks, and swallowing this one would
    turn "hand the request to the leader" into "skip the write and serve on", the very drift it exists to stop.
    Caught by the bars routes (`bars_api_main`), which hand the whole request to the leader."""

    def __init__(self, what: str = ""):
        super().__init__(what)
        self.what = what


def leader_only(what: str) -> None:
    """Raise `LeaderOnly` in a follower; nothing in the leader or the single process."""
    if _role == "follower":
        raise LeaderOnly(what)


class LeaderOnlyLock:
    """`threading.Lock` whose acquisition is leader-only (the store's write lock)."""

    def __init__(self, what: str):
        self._lk = threading.Lock()
        self._what = what

    def acquire(self, blocking: bool = True, timeout: float = -1) -> bool:
        leader_only(self._what)
        return self._lk.acquire(blocking, timeout)

    def release(self) -> None:
        self._lk.release()

    def locked(self) -> bool:
        return self._lk.locked()

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *exc):
        self._lk.release()
        return False


class LeaderOnlySemaphore(threading.Semaphore):
    """A process-wide cap that, with several processes, exists ONCE: in the leader. In a follower every
    acquisition (blocking or not) raises `LeaderOnly`, so the work it caps runs in the leader under the
    single-process limit, never N times over (review of #2962, M1)."""

    def __init__(self, value: int = 1, what: str = "capped job"):
        super().__init__(value)
        self._what = what

    def acquire(self, blocking: bool = True, timeout: Optional[float] = None) -> bool:
        leader_only(self._what)
        return super().acquire(blocking, timeout)

    def __enter__(self):
        return self.acquire()


class LeaderOnlyBoundedSemaphore(threading.BoundedSemaphore):
    def __init__(self, value: int = 1, what: str = "capped job"):
        super().__init__(value)
        self._what = what

    def acquire(self, blocking: bool = True, timeout: Optional[float] = None) -> bool:
        leader_only(self._what)
        return super().acquire(blocking, timeout)

    def __enter__(self):
        return self.acquire()


class LeaderOnlyDict(dict):
    """A single-flight map (`bars_fetch._inflight`): claiming a key starts work, so in a follower it is
    leader-only. Reads, pops and membership tests are unchanged."""

    def __init__(self, *a, what: str = "single-flight job", **kw):
        super().__init__(*a, **kw)
        self._what = what

    def __setitem__(self, k, v):
        leader_only(self._what)
        super().__setitem__(k, v)

    def setdefault(self, k, default=None):
        if k not in self:
            leader_only(self._what)
        return super().setdefault(k, default)


class LeaderOnlySet(set):
    def __init__(self, *a, what: str = "single-flight job"):
        super().__init__(*a)
        self._what = what

    def add(self, x):
        leader_only(self._what)
        super().add(x)


# ── the store swap barrier (review of #2962, H1) ────────────────────────────────────────────────────────────

SWAP_BARRIER_WAIT_S = float(os.environ.get("BARS_API_SWAP_BARRIER_S", "12") or 12)
_tls = threading.local()


#: Refused swaps since start (`/api/health` reports it; the barrier logs each at ERROR).
SWAP_REFUSALS = [0]


class held:
    """`with held(barrier):` for a barrier already ENTERED by hand: only its exit runs here."""

    def __init__(self, barrier):
        self._b = barrier

    def __enter__(self):
        return self._b

    def __exit__(self, *exc):
        return self._b.__exit__(*exc)


class SwapBarrierBusy(RuntimeError):
    """The leader could not close the barrier in time (a follower read outlived it): the swap is refused and the
    old store kept, exactly like a busy checkpoint."""


def _swap_lock_path() -> str:
    return os.path.join(data_dir(), ".bars-store-swap.lock")


def _swap_pending_path() -> str:
    return os.path.join(data_dir(), ".bars-store-swap.pending")


def _flock(fd: int, mode: str, block: bool) -> bool:
    if os.name == "nt":                        # dev boxes: no shared flock (the leader fails closed, see below)
        return True
    import fcntl
    op = {"sh": fcntl.LOCK_SH, "ex": fcntl.LOCK_EX, "un": fcntl.LOCK_UN}[mode]
    if mode != "un" and not block:
        op |= fcntl.LOCK_NB
    try:
        fcntl.flock(fd, op)
        return True
    except OSError:
        return False


def _thread_lock_fd() -> int:
    """This thread's own descriptor on the barrier file (flock belongs to an open file: threads must not share
    one, or one thread's unlock would drop another's hold)."""
    fd = getattr(_tls, "fd", None)
    if fd is None or getattr(_tls, "fd_dir", None) != data_dir():
        os.makedirs(data_dir(), exist_ok=True)
        fd = os.open(_swap_lock_path(), os.O_RDWR | os.O_CREAT, 0o600)
        _tls.fd, _tls.fd_dir = fd, data_dir()
    return fd


class follower_read_scope:
    """A follower request's hold on the store: no swap can start while it reads, and its connections follow a
    replaced file BEFORE it reads (`bars_sqlite.follow_store_identity`). A swap announced or in progress hands
    the request to the leader (`LeaderOnly`) instead of waiting. A no-op in the leader and the single process."""

    def __init__(self, own_fd: bool = False):
        self._own = own_fd
        self._held = None

    def __enter__(self):
        self._held = None
        if _role != "follower":
            return self
        if os.path.exists(_swap_pending_path()):
            raise LeaderOnly("store swap in progress")
        if self._own:
            os.makedirs(data_dir(), exist_ok=True)
            fd = os.open(_swap_lock_path(), os.O_RDWR | os.O_CREAT, 0o600)
        else:
            fd = _thread_lock_fd()
        self._fd = fd
        if not _flock(fd, "sh", block=False):
            self._close_own()
            raise LeaderOnly("store swap in progress")
        self._held = fd
        try:
            if os.path.exists(_swap_pending_path()):      # announced between the check and the lock
                raise LeaderOnly("store swap in progress")
            from api.services import bars_sqlite
            bars_sqlite.follow_store_identity()
        except BaseException:
            _flock(fd, "un", block=True)
            self._held = None
            self._close_own()
            raise
        return self

    def _close_own(self):
        if self._own and getattr(self, "_fd", None) is not None:
            try:
                os.close(self._fd)
            except OSError:
                pass
            self._fd = None

    def __exit__(self, *exc):
        if self._held is not None:
            _flock(self._held, "un", block=True)
            self._held = None
        self._close_own()
        return False


class store_swap_barrier:
    """Held by the leader around a store FILE replace (install, adoption, deferred boot swap): announce, then take
    the barrier exclusive, so no follower is reading or opening a connection across the replace. A replaced
    file's store floor is persisted before the barrier opens, so no follower serves the new file at the old
    file's revisions. A no-op with one process.

    ⛔ Take it BEFORE `_WRITE_LOCK` / `DB_SWAP_LOCK` (leftmost in the `with`): it may wait for follower reads, and
    a follower request handed to the leader can be waiting on the write lock, so no lock may be held meanwhile.
    ⛔ No shared flock on Windows: there a replace under live followers cannot be proved safe, so it is REFUSED
    (fail closed, `SwapBarrierBusy`); production runs on Linux."""

    def __init__(self, wait_s: Optional[float] = None, reason: str = "store replaced"):
        self._wait = SWAP_BARRIER_WAIT_S if wait_s is None else wait_s
        self._reason = reason
        self._fd = None
        self._ident0 = None

    def _ident(self):
        try:
            st = os.stat(os.path.join(data_dir(), "bars.db"))
            return (st.st_dev, st.st_ino)
        except OSError:
            return None

    def __enter__(self):
        if not multiprocess():
            return self
        if getattr(_tls, "barrier_depth", 0) > 0:        # nested in this thread's own barrier: already held
            _tls.barrier_depth += 1
            self._nested = True
            return self
        self._nested = False
        if os.name == "nt":
            raise SwapBarrierBusy("store replace refused: several processes and no cross-process barrier here")
        os.makedirs(data_dir(), exist_ok=True)
        with open(_swap_pending_path(), "w") as f:
            f.write(str(os.getpid()))
        fd = os.open(_swap_lock_path(), os.O_RDWR | os.O_CREAT, 0o600)
        t_end = time.monotonic() + self._wait
        while not _flock(fd, "ex", block=False):
            if time.monotonic() >= t_end:
                os.close(fd)
                self._clear_pending()
                SWAP_REFUSALS[0] += 1
                # ⛔ (review of #2962, L5) an ALERT, not a quiet skip: a refused swap leaves the old store serving.
                _log.error("[bars-api] STORE SWAP REFUSED (%s): followers still reading after %.1f s; old store "
                           "kept [metric bars_api_swap_refused_total=%d]", self._reason, self._wait, SWAP_REFUSALS[0])
                raise SwapBarrierBusy("followers still reading after %.1f s; store kept" % self._wait)
            time.sleep(0.005)
        self._fd = fd
        self._ident0 = self._ident()
        _tls.barrier_depth = 1
        return self

    def _clear_pending(self) -> None:
        try:
            os.remove(_swap_pending_path())
        except OSError:
            pass

    def __exit__(self, *exc):
        if getattr(self, "_nested", False):
            _tls.barrier_depth -= 1
            return False
        if self._fd is None:
            return False
        _tls.barrier_depth = 0
        try:
            if self._ident() != self._ident0:
                try:
                    from api.services import bars_sqlite
                    bars_sqlite.bump_store_floor(self._reason, persist=True)
                except Exception as e:  # noqa: BLE001
                    _log.warning("[bars-api] floor persist at the swap barrier failed: %s", e)
        finally:
            self._clear_pending()
            _flock(self._fd, "un", block=True)
            os.close(self._fd)
            self._fd = None
        return False


def data_dir() -> str:
    return os.environ.get("DATA_DIR", "/data")


def _lock_path() -> str:
    return os.path.join(data_dir(), ".bars-api-leader.lock")


def view_path() -> str:
    return os.path.join(data_dir(), ".bars-live-view.pkl")


def _token_path() -> str:
    return os.path.join(data_dir(), ".bars-api-leader.token")


_token_cache: dict = {}


def leader_token() -> str:
    """The per-container secret the leader writes at start (0600 on the volume): followers present it on the
    loopback hand-off, so the hand-off never depends on PUSH_SECRET being set."""
    p = _token_path()
    try:
        m = os.stat(p).st_mtime_ns
    except OSError:
        return ""
    hit = _token_cache.get(p)
    if hit and hit[0] == m:
        return hit[1]
    try:
        with open(p) as f:
            tok = f.read().strip()
    except OSError:
        return ""
    _token_cache[p] = (m, tok)
    return tok


def _write_leader_token() -> None:
    tok = secrets.token_hex(24)
    tmp = "%s.%d.tmp" % (_token_path(), os.getpid())
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(tok)
    os.replace(tmp, _token_path())


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
        _clear_stale_swap_marker()
        return True


def _clear_stale_swap_marker() -> None:
    """A NEW leader (election or promotion) removes a swap announcement left by a leader that died mid-swap (review
    of #2962, round 2 M1). Only the lock holder ever writes it, and the lock passing to us proves its writer is gone;
    left in place, every follower request would be handed to the leader forever, across promotions and redeploys."""
    try:
        p = os.path.join(data_dir(), ".bars-store-swap.pending")
        if os.path.exists(p):
            os.remove(p)
            _log.warning("[bars-api] removed a stale store-swap announcement (its leader died mid-swap)")
    except OSError as e:
        _log.warning("[bars-api] stale store-swap announcement NOT removed: %s", e)


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
        tok = self.headers.get("X-Bars-Leader-Token", "")
        if tok and secrets.compare_digest(tok, leader_token() or "\0"):
            return True
        from api.flow_admin_auth import _push_secret_ok
        return _push_secret_ok(self.headers.get("Authorization", ""))

    def _reply_raw(self, code: int, headers: list, body: bytes) -> None:
        self.send_response(code)
        for k, v in headers:
            if k.lower() not in ("content-length", "transfer-encoding", "connection", "date", "server"):
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
        path = self.path.split("?")[0]
        if self.headers.get("X-Bars-Background") == "1" and path.startswith("/api/bars/"):
            # A follower skipped a best-effort refresh: replay the request here, off this thread, answer at once.
            if not _defer_sem.acquire(blocking=False):
                return self._reply(429, {"detail": "background replays full"})
            pq = self.path

            def _bg():
                try:
                    from api import bars_api_main
                    bars_api_main.serve_for_follower(pq, 0.0)
                except BaseException as e:  # noqa: BLE001 - background
                    _log.info("[bars-api] background replay %s failed: %s", pq.split("?")[0], e)
                finally:
                    _defer_sem.release()
            threading.Thread(target=_bg, daemon=True, name="bars-api-bg-replay").start()
            return self._reply(202, {"ok": True})
        if path.startswith("/api/bars/") or path.startswith("/api/bars-history/"):
            # A follower's request that needs leader-only work (`LeaderOnly`): answered here, in full, exactly as
            # the single process answers it.
            if not _escalate_sem.acquire(blocking=False):
                return self._reply_raw(503, SHED_HEADERS + [("X-Bars-Shed-Reason", "leader-busy")],
                                       b'{"detail":"bars-api busy"}')
            try:
                from api import bars_api_main
                try:
                    spent = float(self.headers.get("X-Bars-Spent-S") or 0.0)
                except ValueError:
                    spent = 0.0
                code, headers, body = bars_api_main.serve_for_follower(
                    self.path, spent, self.headers.get("Accept-Encoding", ""))
            finally:
                _escalate_sem.release()
            return self._reply_raw(code, headers, body)
        if path == "/internal/live-status":
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
        if path == "/internal/kick":
            # A follower's best-effort kick, run HERE by the function itself, so the LEADER's own throttle governs
            # (its marker, its semaphore): never a whole-request replay (review of the round-2 fix, F1).
            fn = _KICKS.get(str(payload.get("kind") or ""))
            if fn is None:
                return self._reply(404, {"detail": "unknown kick"})
            try:
                fn(*list(payload.get("args") or []))
            except Exception as e:  # noqa: BLE001 - best effort
                _log.info("[bars-api] kick %s failed: %s", payload.get("kind"), e)
            return self._reply(200, {"ok": True})
        if path == "/internal/index-refresh":
            # A follower served a stale cash-index copy (stale-while-revalidate): the refresh is the leader's.
            from api import index_bars
            index_bars._kick_bg_refresh(str(payload.get("sym") or ""), str(payload.get("tf") or ""))
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
        _write_leader_token()
    except OSError as e:
        _log.warning("[bars-api] leader token not written (followers fall back to PUSH_SECRET): %s", e)
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
                                                         "X-Bars-Leader-Token": leader_token(),
                                                         "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=FORWARD_TIMEOUT_S) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # noqa: BLE001 - the leader is restarting or promoting
        return 503, json.dumps({"detail": "bars-api leader unavailable: %s" % type(e).__name__}).encode()


def proxy_to_leader(path_qs: str, spent_s: float = 0.0, accept_encoding: str = "") -> tuple[int, list, bytes]:
    """A follower's bars request answered by the leader: (status, headers, body). It waits at most what is left of
    the edge's budget; an unreachable or slow leader answers 503 + Retry-After (the client re-polls, the edge
    never sees a hang)."""
    left = max(0.5, ESCALATE_DEADLINE_S - max(0.0, float(spent_s)))
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (LEADER_PORT, path_qs), method="GET",
                                 headers={"X-Bars-Leader-Token": leader_token(),
                                          "X-Bars-Spent-S": "%.3f" % max(0.0, float(spent_s)),
                                          "Accept-Encoding": accept_encoding or "identity"})
    try:
        with urllib.request.urlopen(req, timeout=left) as r:
            return r.status, list(r.getheaders()), r.read()
    except urllib.error.HTTPError as e:
        return e.code, list(e.headers.items()), e.read()
    except Exception as e:  # noqa: BLE001 - the leader is restarting, promoting or past the budget
        return 503, SHED_HEADERS + [("X-Bars-Shed-Reason", "leader-unreachable")], \
            json.dumps({"detail": "bars-api leader unavailable: %s" % type(e).__name__}).encode()


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
            item = _want_q.pop(0)
            if item[0] == "BG":
                _replay_in_background(item[1])
                continue
            if item[0] == "KICK":
                forward_to_leader("POST", "/internal/kick", json.dumps({"kind": item[1], "args": item[2]}).encode(),
                                  bars_service_headers().get("Authorization", ""))
                continue
            path, (sym, tf) = (item[0], item[1:]) if len(item) == 3 else ("/internal/live-want", item)
            forward_to_leader("POST", path, json.dumps({"sym": sym, "tf": tf}).encode(),
                              bars_service_headers().get("Authorization", ""))


def _replay_in_background(path_qs: str) -> None:
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (LEADER_PORT, path_qs), method="GET",
                                 headers={"X-Bars-Leader-Token": leader_token(), "X-Bars-Background": "1"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            r.read()
    except Exception:  # noqa: BLE001 - best effort: the next read asks again
        pass


def _send_async(item: tuple) -> None:
    global _want_thread
    if _want_thread is None:
        _want_thread = threading.Thread(target=_want_loop, daemon=True, name="bars-api-want")
        _want_thread.start()
    if len(_want_q) < 5000:
        _want_q.append(item)
    _want_ev.set()


def _send_want_async(sym: str, tf: str) -> None:
    _send_async((sym, tf))


_req_tls = threading.local()
_deferred: dict = {}


def _kick_deepfill(ticker, tf, bars):
    from api.services import bars_fetch
    bars_fetch._maybe_kick_deepfill(str(ticker), str(tf), int(bars))


#: The kicks a follower may ask the leader to run directly (`send_kick`). Allowlist: a name, never a callable.
_KICKS = {"deepfill": _kick_deepfill}


def send_kick(kind: str, *args) -> None:
    """Ask the leader to run best-effort kick `kind` itself (`/internal/kick`), async, deduped DEFER_DEDUP_S."""
    k, t = ("kick", kind) + tuple(args), time.monotonic()
    if _deferred.get(k, -1e9) > t - DEFER_DEDUP_S:
        return
    _deferred[k] = t
    if len(_deferred) > 20000:
        _deferred.clear()
    _send_async(("KICK", kind, list(args)))


def set_current_request(path_qs: Optional[str]) -> None:
    """The follower request this thread is serving (`bars_api_main._served_here_or_by_leader`), or None."""
    _req_tls.path_qs = path_qs


def defer_to_leader(what: str, key: str = "") -> bool:
    """A best-effort refresh a FOLLOWER skips: ask the leader to replay the request this thread is serving, in the
    background (deduped per `what`+`key` for DEFER_DEDUP_S, async, answered 202 at once). True when this process is a
    follower (the caller then skips its kick and serves on), False in the leader and the single process (the caller
    runs its kick as before). Never raises."""
    if _role != "follower":
        return False
    pq = getattr(_req_tls, "path_qs", None)
    if not pq:
        return True                       # not a bars request thread: nothing to replay, the kick is skipped
    k, t = (what, key or pq.split("?")[0]), time.monotonic()
    if _deferred.get(k, -1e9) > t - DEFER_DEDUP_S:
        return True
    _deferred[k] = t
    if len(_deferred) > 20000:
        _deferred.clear()
    _send_async(("BG", pq))
    return True


_index_wanted: dict = {}


def send_index_refresh(sym: str, tf: str) -> None:
    """A follower's stale-while-revalidate kick for a cash index (`index_bars._kick_bg_refresh`): the refresh runs
    in the leader (one vendor caller, one writer of the shared disk copy), off this request, deduped."""
    k, t = (sym, tf), time.monotonic()
    if _index_wanted.get(k, -1e9) > t - WANT_DEDUP_S:
        return
    _index_wanted[k] = t
    if len(_index_wanted) > 5000:
        _index_wanted.clear()
    _send_async(("/internal/index-refresh", sym, tf))


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
                try:                 # every connection re-opens WITHOUT the follower's query_only
                    from api.services import bars_sqlite
                    bars_sqlite.bump_db_epoch()
                except Exception:  # noqa: BLE001
                    pass
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
