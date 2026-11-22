"""How long every request waits, and what it waits ON (speed and reliability plan, item 1).

WHY THIS EXISTS. On 2026-11-13 Cloudflare timed `/api/delisted/{sym}` at 1.3 s at the median. The
handler is a dictionary lookup. The time is spent before the handler runs, and until now nothing in
this process could say where: waiting for one of the thread limiter's tokens (every `def` route and
every `def` dependency borrows one), or holding a token and waiting for the interpreter lock behind
the background threads. Those two have different fixes, so this module measures both, all day.

WHAT IT RECORDS
  * per request: time from arrival to the first response byte, by route class and status class;
  * once a second: the thread limiter's borrowed and waiting counts, how late the event loop woke,
    and how long a do-nothing call takes to go through the thread pool and come back (the "hop").
    A slow hop while tasks are waiting for a token is starvation. A slow hop with tokens free is
    the interpreter lock.

NO MEMBER IDENTIFIERS. A path is reduced to a route class before it is stored (`/api/bars/NVDA` ->
`/api/bars/:sym`); the query string is never read. No user id, session, cookie or address.

IT CAN NEVER BREAK OR DELAY A REQUEST. It is a pure ASGI layer: it watches the first response
message go by and passes every message on untouched, so a stream is never buffered. Every recording
step swallows its own errors. Disk writes happen on their own thread, never on the event loop and
never through the limiter being measured.

Storage: one line per finished minute in `<DATA_DIR>/request_timing/YYYY-MM-DD.jsonl`, kept
RETENTION_DAYS. It lives on disk because `web` restarts many times a day and a trading session must
survive them. Read with `summary(hours)` (admin route `GET /api/admin/request-timing`).

Kill switch: `REQUEST_TIMING_ENABLED`. Unset or anything but 0/false/no/off means ON; OFF makes the
layer a plain pass-through (no header, no record, no sampler) and deletes nothing.
"""
from __future__ import annotations

import asyncio
import json
import os
import queue
import re
import threading
import time
from typing import Any

KILL_SWITCH = "REQUEST_TIMING_ENABLED"
_OFF_VALUES = frozenset({"0", "false", "no", "off"})

#: Upper bounds in ms; one more bucket after the last holds everything slower.
BUCKETS_MS = (5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000)
_NB = len(BUCKETS_MS) + 1
MAX_CLASSES = 400
RETENTION_DAYS = 7
SAMPLE_EVERY_S = 1.0
#: A hop slower than this is counted as slow, and attributed by whether tasks were waiting.
SLOW_HOP_MS = 100.0
OTHER = "(other)"
PAGES = "(pages and files)"

_SYMBOL = re.compile(r"^[A-Z0-9.^$%:\-]{1,12}$")
_WORD = re.compile(r"^[a-z][a-z0-9_\-]{0,23}$")
_lock = threading.Lock()
_BOOT = time.time()

# ── pure helpers ──────────────────────────────────────────────────────────────


def enabled() -> bool:
    return (os.environ.get(KILL_SWITCH) or "1").strip().lower() not in _OFF_VALUES


def path_class(path: str) -> str:
    """`/api/bars/NVDA` -> `/api/bars/:sym`. Tickers, ids and tokens never reach a record."""
    parts = [p for p in (path or "").split("?")[0].split("/") if p]
    if not parts or parts[0] != "api":
        return PAGES
    out = []
    for part in parts[:4]:
        if part.isdigit() or len(part) > 24:
            out.append(":id")
        elif _SYMBOL.match(part) and part.upper() == part:
            out.append(":sym")
        elif _WORD.match(part):
            out.append(part)
        else:
            out.append(":id")
    return "/" + "/".join(out)


def bucket(ms: float) -> int:
    for i, bound in enumerate(BUCKETS_MS):
        if ms <= bound:
            return i
    return _NB - 1


def new_hist() -> list:
    """[count, total ms, slowest ms, server errors, *bucket counts]."""
    return [0, 0.0, 0.0, 0] + [0] * _NB


def add(h: list, ms: float, error: bool = False) -> None:
    h[0] += 1
    h[1] += ms
    if ms > h[2]:
        h[2] = ms
    if error:
        h[3] += 1
    h[4 + bucket(ms)] += 1


def merge(into: list, other: list) -> None:
    into[0] += other[0]
    into[1] += other[1]
    into[2] = max(into[2], other[2])
    into[3] += other[3]
    for i in range(_NB):
        into[4 + i] += other[4 + i]


def quantile(h: list, q: float) -> float | None:
    """The upper bound of the bucket holding the q-th request; the slowest seen for the last bucket."""
    n = h[0]
    if not n:
        return None
    need, seen = q * n, 0
    for i in range(_NB):
        seen += h[4 + i]
        if seen >= need:
            return float(BUCKETS_MS[i]) if i < len(BUCKETS_MS) else round(h[2], 1)
    return round(h[2], 1)


def new_sampler() -> dict:
    return {"n": 0, "hop": new_hist(), "lag_max": 0.0, "lag_sum": 0.0, "waiting_max": 0, "borrowed_max": 0,
            "total_tokens": 0, "starved": 0, "lock_like": 0}


def add_sample(s: dict, hop_ms: float | None, lag_ms: float, borrowed: int, waiting: int, total: int) -> None:
    """One second's reading. `starved`: a slow hop while tasks waited for a token. `lock_like`: a slow
    hop with no task waiting, so the wait was for the interpreter, not for a token."""
    s["n"] += 1
    s["lag_sum"] += lag_ms
    s["lag_max"] = max(s["lag_max"], lag_ms)
    s["waiting_max"] = max(s["waiting_max"], waiting)
    s["borrowed_max"] = max(s["borrowed_max"], borrowed)
    s["total_tokens"] = total
    if hop_ms is not None:
        add(s["hop"], hop_ms)
        if hop_ms > SLOW_HOP_MS:
            s["starved" if waiting > 0 else "lock_like"] += 1


def merge_sampler(into: dict, other: dict) -> None:
    into["n"] += other.get("n", 0)
    merge(into["hop"], other.get("hop") or new_hist())
    into["lag_sum"] += other.get("lag_sum", 0.0)
    into["lag_max"] = max(into["lag_max"], other.get("lag_max", 0.0))
    into["waiting_max"] = max(into["waiting_max"], other.get("waiting_max", 0))
    into["borrowed_max"] = max(into["borrowed_max"], other.get("borrowed_max", 0))
    into["total_tokens"] = other.get("total_tokens") or into["total_tokens"]
    into["starved"] += other.get("starved", 0)
    into["lock_like"] += other.get("lock_like", 0)


# ── the current minute ────────────────────────────────────────────────────────

def _new_minute(minute: int) -> dict:
    return {"m": minute, "g": new_hist(), "r": {}, "s": new_sampler()}


_cur: dict = _new_minute(0)


def _roll(now: float) -> None:
    """Under _lock: if the minute changed, hand the finished one to the writer."""
    global _cur
    minute = int(now // 60)
    if _cur["m"] == minute:
        return
    done, _cur = _cur, _new_minute(minute)
    if done["m"] and (done["g"][0] or done["s"]["n"]):
        done["up"] = round(done["m"] * 60 - _BOOT)
        _enqueue(done)


#: A write is its own class (`POST /api/auth/preferences`): a save and a read of one path are
#: different work and were hiding each other's numbers.
_READS = frozenset({"GET", "HEAD", ""})
_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE", "OPTIONS"})
#: Minutes this soon after the process started are reported apart from the settled ones.
AFTER_BOOT_S = 300
#: The same split, finer (2026-11-17): the slow window after a restart measured ~18 minutes, so
#: `settled` (anything past 5 min) mixed minutes 5-18 with the truly settled ones. Lower bounds in s.
UPTIME_BANDS = ((0, "0-5m"), (300, "5-10m"), (600, "10-20m"), (1200, "20m+"))


def record(path: str, status: int, ms: float, now: float | None = None, method: str = "GET") -> None:
    try:
        cls = path_class(path)
        method = (method or "").upper()
        if method not in _READS:
            cls = (method if method in _METHODS else "OTHER") + " " + cls
        error = status >= 500
        with _lock:
            _roll(now if now is not None else time.time())
            add(_cur["g"], ms, error)
            routes = _cur["r"]
            if cls not in routes and len(routes) >= MAX_CLASSES:
                cls = OTHER
            add(routes.setdefault(cls, new_hist()), ms, error)
    except Exception:
        pass


def record_sample(hop_ms: float | None, lag_ms: float, borrowed: int, waiting: int, total: int,
                  now: float | None = None) -> None:
    try:
        with _lock:
            _roll(now if now is not None else time.time())
            add_sample(_cur["s"], hop_ms, lag_ms, borrowed, waiting, total)
    except Exception:
        pass


# ── disk, on its own thread ───────────────────────────────────────────────────

_q: "queue.Queue[dict]" = queue.Queue(maxsize=600)
_writer_started = False


def store_dir() -> str:
    return os.environ.get("REQUEST_TIMING_DIR") or os.path.join(os.environ.get("DATA_DIR") or "/data", "request_timing")


def _day(minute: int) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(minute * 60))


def write_minute(done: dict) -> None:
    """Append one finished minute; drop files older than RETENTION_DAYS when a new day's file starts."""
    d = store_dir()
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, _day(done["m"]) + ".jsonl")
    fresh = not os.path.exists(path)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(done, separators=(",", ":")) + "\n")
    if fresh:
        keep_from = _day(done["m"] - RETENTION_DAYS * 1440)
        for name in os.listdir(d):
            if name.endswith(".jsonl") and name[:-6] < keep_from:
                try:
                    os.remove(os.path.join(d, name))
                except OSError:
                    pass


def _writer() -> None:
    while True:
        done = _q.get()
        try:
            write_minute(done)
        except Exception:
            pass


def _enqueue(done: dict) -> None:
    global _writer_started
    try:
        if not _writer_started:
            _writer_started = True
            threading.Thread(target=_writer, name="request-timing-writer", daemon=True).start()
        _q.put_nowait(done)
    except Exception:
        pass  # a full queue drops a minute; it never blocks a request


# ── the once-a-second sampler ─────────────────────────────────────────────────

_sampler_task: "asyncio.Task | None" = None


def _noop() -> None:
    return None


async def sample_once(state: dict, lag_ms: float) -> None:
    """Read the limiter and time one do-nothing hop through the thread pool.

    A hop still in flight from an earlier second is reported at its current age and no second hop is
    started, so a 10-second stall reads as 10 seconds and costs one token, not ten."""
    import anyio.to_thread

    limiter = anyio.to_thread.current_default_thread_limiter()
    stats = limiter.statistics()
    task = state.get("task")
    hop_ms: float | None
    if task is not None and not task.done():
        hop_ms = (time.perf_counter() - state["t"]) * 1000.0
    else:
        if task is not None:
            state["task"] = None
        hop_ms = state.pop("last", None)

        async def hop() -> None:
            t = time.perf_counter()
            await anyio.to_thread.run_sync(_noop)
            state["last"] = (time.perf_counter() - t) * 1000.0

        state["t"] = time.perf_counter()
        state["task"] = asyncio.ensure_future(hop())
    record_sample(hop_ms, max(0.0, lag_ms), int(stats.borrowed_tokens), int(stats.tasks_waiting),
                  int(stats.total_tokens))


async def _sampler() -> None:
    state: dict = {}
    while True:
        t = time.perf_counter()
        await asyncio.sleep(SAMPLE_EVERY_S)
        lag_ms = (time.perf_counter() - t - SAMPLE_EVERY_S) * 1000.0
        if not enabled():
            continue
        try:
            await sample_once(state, lag_ms)
        except Exception:
            pass


def _ensure_sampler() -> None:
    global _sampler_task
    if _sampler_task is None or _sampler_task.done():
        try:
            _sampler_task = asyncio.ensure_future(_sampler())
        except Exception:
            _sampler_task = None


# ── the ASGI layer ────────────────────────────────────────────────────────────

class RequestTimingMiddleware:
    """Outermost. Watches the first response message; passes every message through untouched."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or not enabled():
            await self.app(scope, receive, send)
            return
        _ensure_sampler()
        t0 = time.perf_counter()
        seen = [False]
        path = scope.get("path") or ""
        method = scope.get("method") or "GET"

        async def timed_send(message):
            if not seen[0] and message.get("type") == "http.response.start":
                seen[0] = True
                try:
                    ms = (time.perf_counter() - t0) * 1000.0
                    record(path, int(message.get("status") or 0), ms, method=method)
                    headers = list(message.get("headers") or [])
                    headers.append((b"server-timing", b"app;dur=%.1f" % ms))
                    message = {**message, "headers": headers}
                except Exception:
                    pass
            await send(message)

        try:
            await self.app(scope, receive, timed_send)
        except Exception:
            if not seen[0]:
                record(path, 500, (time.perf_counter() - t0) * 1000.0, method=method)
            raise


# ── reading it back ───────────────────────────────────────────────────────────

def _minutes(since_minute: int) -> list[dict]:
    out: list[dict] = []
    d = store_dir()
    day = _day(since_minute)
    try:
        names = sorted(n for n in os.listdir(d) if n.endswith(".jsonl") and n[:-6] >= day)
    except OSError:
        names = []
    for name in names:
        try:
            with open(os.path.join(d, name), "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        row = json.loads(line)
                    except ValueError:
                        continue  # a line cut short by a restart
                    if row.get("m", 0) >= since_minute:
                        out.append(row)
        except OSError:
            continue
    with _lock:
        if _cur["m"] >= since_minute and (_cur["g"][0] or _cur["s"]["n"]):
            live = json.loads(json.dumps(_cur))
            live["up"] = round(_cur["m"] * 60 - _BOOT)
            out.append(live)
    return out


def _hist_row(h: list) -> dict:
    n = h[0]
    return {"requests": n, "avg_ms": round(h[1] / n, 1) if n else None, "p50_ms": quantile(h, 0.50),
            "p95_ms": quantile(h, 0.95), "p99_ms": quantile(h, 0.99), "max_ms": round(h[2], 1), "errors_5xx": h[3]}


def _sampler_row(s: dict) -> dict:
    n = s["n"]
    return {"seconds_sampled": n, "hop_p50_ms": quantile(s["hop"], 0.50), "hop_p95_ms": quantile(s["hop"], 0.95),
            "hop_max_ms": round(s["hop"][2], 1), "loop_lag_avg_ms": round(s["lag_sum"] / n, 1) if n else None,
            "loop_lag_max_ms": round(s["lag_max"], 1), "tokens_total": s["total_tokens"],
            "tokens_borrowed_max": s["borrowed_max"], "tasks_waiting_max": s["waiting_max"],
            "seconds_starved_for_tokens": s["starved"], "seconds_slow_with_tokens_free": s["lock_like"]}


def summary(hours: int = 24, top: int = 60, now: float | None = None) -> dict[str, Any]:
    """Per hour and per route class, plus the verdict the two slow-hop counters support."""
    now = now if now is not None else time.time()
    rows = _minutes(int(now // 60) - hours * 60)
    total, total_s = new_hist(), new_sampler()
    by_hour: dict[int, dict] = {}
    routes: dict[str, list] = {}
    restarts = 0
    last_up: float | None = None
    # The minutes just after a restart, apart from the rest: the server is 3 to 6 times slower
    # while its caches warm, and that tail was being read as a property of whole routes.
    phases = {"after_boot": {"g": new_hist(), "s": new_sampler(), "minutes": 0},
              "settled": {"g": new_hist(), "s": new_sampler(), "minutes": 0}}
    bands = {name: {"g": new_hist(), "s": new_sampler(), "minutes": 0} for _, name in UPTIME_BANDS}
    for row in rows:
        merge(total, row["g"])
        merge_sampler(total_s, row.get("s") or new_sampler())
        phase = phases["after_boot" if row.get("up") is not None and row["up"] < AFTER_BOOT_S else "settled"]
        merge(phase["g"], row["g"])
        merge_sampler(phase["s"], row.get("s") or new_sampler())
        phase["minutes"] += 1
        if row.get("up") is not None:
            # the first minute after a boot starts before the process did: its `up` is negative
            band = bands[[name for lo, name in UPTIME_BANDS if max(0, row["up"]) >= lo][-1]]
            merge(band["g"], row["g"])
            merge_sampler(band["s"], row.get("s") or new_sampler())
            band["minutes"] += 1
        hour = by_hour.setdefault(row["m"] // 60, {"g": new_hist(), "s": new_sampler()})
        merge(hour["g"], row["g"])
        merge_sampler(hour["s"], row.get("s") or new_sampler())
        for cls, h in (row.get("r") or {}).items():
            merge(routes.setdefault(cls, new_hist()), h)
        up = row.get("up")
        if up is not None:
            if last_up is not None and up < last_up:
                restarts += 1
            last_up = up
    all_ms = total[1] or 1.0
    ranked = sorted(routes.items(), key=lambda kv: kv[1][1], reverse=True)[:top]
    starved, lock_like = total_s["starved"], total_s["lock_like"]
    if not total_s["n"]:
        verdict = "no samples in this window"
    elif starved + lock_like == 0:
        verdict = "no slow hops: requests are not queueing for threads in this window"
    elif starved >= 3 * max(lock_like, 1):
        verdict = "token starvation: slow seconds had tasks waiting for a thread token"
    elif lock_like >= 3 * max(starved, 1):
        verdict = "interpreter lock: slow seconds had tokens free"
    else:
        verdict = "mixed: both token starvation and interpreter-lock waits are present"
    return {
        "hours": hours, "minutes_with_data": len(rows), "restarts_seen": restarts, "enabled": enabled(),
        "verdict": verdict, "all": _hist_row(total), "threads": _sampler_row(total_s),
        "since_restart": {name: {"minutes": v["minutes"], **_hist_row(v["g"]), **_sampler_row(v["s"])}
                          for name, v in phases.items()},
        "since_restart_bands": {name: {"minutes": v["minutes"], **_hist_row(v["g"]), **_sampler_row(v["s"])}
                                for name, v in bands.items()},
        "by_hour": [{"hour": time.strftime("%Y-%m-%d %H:00", time.gmtime(h * 3600)), **_hist_row(v["g"]),
                     **_sampler_row(v["s"])} for h, v in sorted(by_hour.items())],
        "routes": [{"route": cls, **_hist_row(h), "share_of_time_pct": round(100.0 * h[1] / all_ms, 1)}
                   for cls, h in ranked],
    }


def _reset_for_tests() -> None:
    global _cur
    with _lock:
        _cur = _new_minute(0)
    while not _q.empty():
        try:
            _q.get_nowait()
        except queue.Empty:
            break
