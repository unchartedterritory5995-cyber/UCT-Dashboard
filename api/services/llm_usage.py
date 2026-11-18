"""ONE ledger of every Anthropic call the app makes: which feature, which model,
how many tokens of each kind, and what it cost.

WHY THIS EXISTS. On 2026-11-10 the org was spending ~$80/day on Claude API
tokens (it was ~$16.60/day on 2026-08-24) and nothing in the app could say
where. The Console groups by API key, and the whole dashboard runs on ONE key,
so the invoice reads "railway: $X" for 76 modules. The per-surface guards that
do exist (narrative_cost_guard, daily_counters, catalyst cost_guard,
uct_agent/budget, note_ask, theme_engine/store ...) each meter their own slice,
several on flat ESTIMATES, two days of history at most, and none of them sum.

THE SHAPE. `install()` hooks the Anthropic SDK at its two choke points, once per
process, so no call site has to change and a NEW call site is metered the day
it lands:

  * `SyncAPIClient._process_response` / `AsyncAPIClient._process_response` --
    every HTTP response the SDK parses. A non-streamed `/v1/messages` reply is a
    Message carrying `usage`; it is recorded here. A streamed reply is a Stream
    object; it is TAGGED here with the door that opened it.
  * `Stream.__stream__` / `AsyncStream.__stream__` -- every SSE stream, raw
    `create(stream=True)` and `messages.stream()` alike (MessageStream reads a
    raw Stream underneath). `message_start` carries the input-side usage,
    `message_delta` the output side; the row is written when the stream ends,
    however it ends.

THE DOOR. The module that called the SDK, read from the stack at response time:
the innermost frame under `api/` that is not this file -- exactly the unit
`tools/ai_door_census.py` uses, so every row joins to `ai_doors.DOORS` by path
and the admin page can name the feature. The function name rides along, because
one module (engine.py) hosts several features. `door("label")` overrides it for
a block where the stack would mislead (a thread pool hop, a shared helper).

BATCH. Message Batches results never pass through `_process_response` as a
Message; their consumers call `record_message(..., batch=True)`, which prices at
the 50% batch rate.

FAIL DIRECTIONS, chosen deliberately:
  * ⛔ NEVER raises into a model call and NEVER blocks one. `record` is a
    `put_nowait` onto a bounded queue; a daemon thread writes. A full queue drops
    the row and counts the drop (`stats()`), it does not wait.
  * The ledger is its OWN SQLite file (`$DATA_DIR/llm_usage.db`), never auth.db:
    a metering write must not contend with the login path.
  * Off under pytest and with `LLM_USAGE_LEDGER=0`.
  * Price is DERIVED from `narrative_cost_guard.estimate_cost` (the cache-aware
    table every dollar cap already uses), never restated here.
"""
from __future__ import annotations

import contextlib
import contextvars
import json
import logging
import os
import queue
import sqlite3
import sys
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")
_HERE = os.path.abspath(__file__)
_REPO = os.path.dirname(os.path.dirname(os.path.dirname(_HERE)))
KEEP_DAYS = 120
_QUEUE_MAX = 5000
_FLUSH_EVERY_S = 2.0

_door_override: contextvars.ContextVar[str | None] = contextvars.ContextVar("llm_usage_door", default=None)

_q: "queue.Queue[dict]" = queue.Queue(maxsize=_QUEUE_MAX)
_lock = threading.Lock()
_installed = False
_writer: threading.Thread | None = None
_stats = {"recorded": 0, "dropped": 0, "write_errors": 0, "forward_errors": 0}

COLUMNS = ("at", "day", "service", "door", "func", "model", "kind", "input_tokens",
           "cache_read_tokens", "cache_write_tokens", "output_tokens", "web_searches",
           "cost_usd", "ok", "request_id")

_DDL = """
CREATE TABLE IF NOT EXISTS llm_usage_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  day TEXT NOT NULL,
  service TEXT NOT NULL DEFAULT '',
  door TEXT NOT NULL,
  func TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'sync',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  web_searches INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1,
  request_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_llm_usage_day ON llm_usage_calls(day);
CREATE INDEX IF NOT EXISTS ix_llm_usage_door_day ON llm_usage_calls(door, day);
"""


# ── configuration ────────────────────────────────────────────────────────────

def db_path() -> str:
    explicit = os.environ.get("LLM_USAGE_DB_PATH")
    if explicit:
        return explicit
    data = os.environ.get("DATA_DIR", "/data")
    if not os.path.isdir(data):
        data = os.path.join(_REPO, "data")
    return os.path.join(data, "llm_usage.db")


def enabled() -> bool:
    if os.environ.get("PYTEST_CURRENT_TEST") and os.environ.get("LLM_USAGE_LEDGER") != "1":
        return False
    return (os.environ.get("LLM_USAGE_LEDGER", "1").strip() or "1") != "0"


def service_name() -> str:
    return (os.environ.get("RAILWAY_SERVICE_NAME") or os.environ.get("LLM_USAGE_SERVICE") or "local").strip()


def _forward_url() -> str:
    return (os.environ.get("LLM_USAGE_FORWARD_URL") or "").strip()


# ── pricing (derived, never restated) ────────────────────────────────────────

def price(model: str, input_tokens: int, output_tokens: int, cache_read: int = 0,
          cache_write: int = 0, web_searches: int = 0, batch: bool = False) -> float:
    from api.services import narrative_cost_guard as ncg
    usd = ncg.estimate_cost(model, input_tokens, output_tokens, web_searches,
                            cache_read_tokens=cache_read, cache_creation_tokens=cache_write)
    if batch:  # Batch API: 50% off every token; web searches are not discounted
        usd = (usd - web_searches * ncg._WEB_SEARCH_USD_EACH) * 0.5 + web_searches * ncg._WEB_SEARCH_USD_EACH
    return round(usd, 6)


# ── door attribution ─────────────────────────────────────────────────────────

@contextlib.contextmanager
def door(label: str):
    """Attribute every model call in this block to `label` (e.g. a module path)."""
    tok = _door_override.set(label)
    try:
        yield
    finally:
        _door_override.reset(tok)


def _rel(path: str) -> str | None:
    p = os.path.abspath(path)
    if not p.startswith(_REPO):
        return None
    rel = p[len(_REPO):].lstrip("\\/").replace("\\", "/")
    return rel


def attribute(start=None) -> tuple[str, str]:
    """(door, func): the innermost repo frame under api/ that is not this file."""
    override = _door_override.get()
    f = start or sys._getframe(1)
    fallback: tuple[str, str] | None = None
    while f is not None:
        fn = f.f_code.co_filename
        if fn != _HERE:
            rel = _rel(fn)
            if rel and rel.endswith(".py") and "site-packages" not in rel:
                if rel.startswith("api/"):
                    return (override or rel), f.f_code.co_name
                if fallback is None and not rel.startswith(("tests/", "conftest")):
                    fallback = (rel, f.f_code.co_name)
        f = f.f_back
    if override:
        return override, ""
    return fallback or ("unattributed", "")


# ── recording ────────────────────────────────────────────────────────────────

def _usage_fields(usage: Any) -> dict:
    def g(obj, name):
        if obj is None:
            return 0
        v = obj.get(name) if isinstance(obj, dict) else getattr(obj, name, 0)
        try:
            return int(v or 0)
        except (TypeError, ValueError):
            return 0
    stu = usage.get("server_tool_use") if isinstance(usage, dict) else getattr(usage, "server_tool_use", None)
    return {
        "input_tokens": g(usage, "input_tokens"),
        "output_tokens": g(usage, "output_tokens"),
        "cache_read_tokens": g(usage, "cache_read_input_tokens"),
        "cache_write_tokens": g(usage, "cache_creation_input_tokens"),
        "web_searches": g(stu, "web_search_requests"),
    }


def record(*, door: str, func: str = "", model: str = "", kind: str = "sync",
           input_tokens: int = 0, output_tokens: int = 0, cache_read_tokens: int = 0,
           cache_write_tokens: int = 0, web_searches: int = 0, ok: bool = True,
           request_id: str = "", cost_usd: float | None = None, service: str | None = None,
           at: str | None = None) -> None:
    """Queue one row. Never raises, never blocks."""
    try:
        if not enabled():
            return
        _ensure_writer()
        now = datetime.now(timezone.utc)
        if at:
            try:
                now = datetime.fromisoformat(at.replace("Z", "+00:00"))
            except ValueError:
                pass
        if cost_usd is None and not model:
            cost_usd = 0.0
        if cost_usd is None:
            cost_usd = price(model, input_tokens, output_tokens, cache_read_tokens,
                             cache_write_tokens, web_searches, batch=(kind == "batch"))
        row = {
            "at": now.astimezone(timezone.utc).isoformat(timespec="seconds"),
            "day": now.astimezone(_ET).date().isoformat(),
            "service": service if service is not None else service_name(),
            "door": door or "unattributed", "func": func or "", "model": model or "",
            "kind": kind, "input_tokens": int(input_tokens), "cache_read_tokens": int(cache_read_tokens),
            "cache_write_tokens": int(cache_write_tokens), "output_tokens": int(output_tokens),
            "web_searches": int(web_searches), "cost_usd": float(cost_usd), "ok": 1 if ok else 0,
            "request_id": request_id or "",
        }
        _q.put_nowait(row)
        _stats["recorded"] += 1
    except queue.Full:
        _stats["dropped"] += 1
    except Exception:  # noqa: BLE001 -- metering must never break a model call
        log.debug("[llm_usage] record failed", exc_info=True)


def record_message(message: Any, *, door: str | None = None, func: str = "", kind: str = "sync") -> None:
    """Record a parsed Message (or a dict shaped like one). For batch results pass kind='batch'."""
    try:
        if door is None:
            door, func = attribute(sys._getframe(1))
        usage = message.get("usage") if isinstance(message, dict) else getattr(message, "usage", None)
        model = message.get("model") if isinstance(message, dict) else getattr(message, "model", "")
        rid = message.get("id") if isinstance(message, dict) else getattr(message, "id", "")
        record(door=door, func=func, model=str(model or ""), kind=kind, request_id=str(rid or ""),
               **_usage_fields(usage))
    except Exception:  # noqa: BLE001
        log.debug("[llm_usage] record_message failed", exc_info=True)


# ── the SDK hooks ────────────────────────────────────────────────────────────

def _is_messages_url(options: Any) -> bool:
    url = str(getattr(options, "url", "") or "")
    path = url.split("?", 1)[0].rstrip("/")
    return path.endswith("/messages") and "/batches" not in path and "count_tokens" not in path


class _StreamTally:
    __slots__ = ("door", "func", "model", "rid", "u", "done")

    def __init__(self, door: str, func: str):
        self.door, self.func, self.model, self.rid, self.done = door, func, "", "", False
        self.u = {"input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0,
                  "cache_write_tokens": 0, "web_searches": 0}

    def see(self, ev: Any) -> None:
        t = getattr(ev, "type", None)
        if t == "message_start":
            msg = getattr(ev, "message", None)
            self.model = str(getattr(msg, "model", "") or "")
            self.rid = str(getattr(msg, "id", "") or "")
            self._merge(getattr(msg, "usage", None))
        elif t == "message_delta":
            self._merge(getattr(ev, "usage", None))

    def _merge(self, usage: Any) -> None:
        if usage is None:
            return
        for k, v in _usage_fields(usage).items():
            if v:  # message_delta usage is cumulative; never let a 0 erase a real count
                self.u[k] = max(self.u[k], v)

    def finish(self, ok: bool) -> None:
        if self.done:
            return
        self.done = True
        if not (self.model or any(self.u.values())):
            return
        record(door=self.door, func=self.func, model=self.model, kind="stream",
               ok=ok, request_id=self.rid, **self.u)


def install() -> bool:
    """Hook the Anthropic SDK once per process. Returns True if hooks are active."""
    global _installed
    if not enabled():
        return False
    with _lock:
        if _installed:
            return True
        try:
            from anthropic import _base_client as bc
            from anthropic import _streaming as st
        except Exception:  # noqa: BLE001
            log.warning("[llm_usage] anthropic SDK not importable; ledger inactive")
            return False

        orig_sync = bc.SyncAPIClient._process_response
        orig_async = bc.AsyncAPIClient._process_response

        def _after(result, options):
            if not _is_messages_url(options):
                return result
            d, fn = attribute(sys._getframe(2))
            if isinstance(result, (st.Stream, st.AsyncStream)):
                try:
                    result._uct_tally = _StreamTally(d, fn)
                except Exception:  # noqa: BLE001
                    pass
            elif getattr(result, "usage", None) is not None:
                record_message(result, door=d, func=fn)
            return result

        def sync_process(self, *a, **kw):
            result = orig_sync(self, *a, **kw)
            try:
                return _after(result, kw.get("options"))
            except Exception:  # noqa: BLE001
                return result

        async def async_process(self, *a, **kw):
            result = await orig_async(self, *a, **kw)
            try:
                return _after(result, kw.get("options"))
            except Exception:  # noqa: BLE001
                return result

        orig_sstream = st.Stream.__stream__
        orig_astream = st.AsyncStream.__stream__

        def sync_stream(self):
            tally = getattr(self, "_uct_tally", None)
            ok = False
            try:
                for ev in orig_sstream(self):
                    if tally is not None:
                        try:
                            tally.see(ev)
                        except Exception:  # noqa: BLE001
                            pass
                    yield ev
                ok = True
            finally:
                if tally is not None:
                    tally.finish(ok)

        async def async_stream(self):
            tally = getattr(self, "_uct_tally", None)
            ok = False
            try:
                async for ev in orig_astream(self):
                    if tally is not None:
                        try:
                            tally.see(ev)
                        except Exception:  # noqa: BLE001
                            pass
                    yield ev
                ok = True
            finally:
                if tally is not None:
                    tally.finish(ok)

        # Budget gate: a feature whose block-mode daily budget is spent is refused
        # BEFORE the request is sent (api/services/llm_budget.py). Never raises
        # for any other reason; a gate fault allows the call.
        orig_req = bc.SyncAPIClient.request
        orig_areq = bc.AsyncAPIClient.request

        def _gate(options):
            if options is None or not _is_messages_url(options):
                return
            if str(getattr(options, "method", "post")).lower() != "post":
                return
            from api.services import llm_budget
            d, _fn = attribute(sys._getframe(2))
            llm_budget.enforce(d)

        def sync_request(self, cast_to, options, *a, **kw):
            try:
                _gate(options)
            except Exception as e:  # noqa: BLE001
                if type(e).__name__ == "LLMBudgetExceeded":
                    raise
            return orig_req(self, cast_to, options, *a, **kw)

        async def async_request(self, cast_to, options, *a, **kw):
            try:
                _gate(options)
            except Exception as e:  # noqa: BLE001
                if type(e).__name__ == "LLMBudgetExceeded":
                    raise
            return await orig_areq(self, cast_to, options, *a, **kw)

        bc.SyncAPIClient.request = sync_request
        bc.AsyncAPIClient.request = async_request
        bc.SyncAPIClient._process_response = sync_process
        bc.AsyncAPIClient._process_response = async_process
        st.Stream.__stream__ = sync_stream
        st.AsyncStream.__stream__ = async_stream
        _installed = True
        log.info("[llm_usage] Anthropic SDK hooked; ledger at %s (service=%s, forward=%s)",
                 db_path(), service_name(), bool(_forward_url()))
        return True


# ── storage ──────────────────────────────────────────────────────────────────

def connect() -> sqlite3.Connection:
    path = db_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    c = sqlite3.connect(path, timeout=5)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=3000")
    c.executescript(_DDL)
    return c


def write_rows(rows: Iterable[dict]) -> int:
    rows = list(rows)
    if not rows:
        return 0
    with contextlib.closing(connect()) as c:
        c.executemany(
            f"INSERT INTO llm_usage_calls ({','.join(COLUMNS)}) VALUES ({','.join('?' * len(COLUMNS))})",
            [tuple(r.get(k, 0 if k not in ("at", "day", "service", "door", "func", "model", "kind", "request_id") else "")
                   for k in COLUMNS) for r in rows])
        c.commit()
    return len(rows)


def prune(keep_days: int = KEEP_DAYS) -> int:
    cutoff = (datetime.now(_ET).date() - timedelta(days=keep_days)).isoformat()
    with contextlib.closing(connect()) as c:
        n = c.execute("DELETE FROM llm_usage_calls WHERE day < ?", (cutoff,)).rowcount
        c.commit()
    return n


def _forward(rows: list[dict]) -> bool:
    url, secret = _forward_url(), (os.environ.get("PUSH_SECRET") or "").strip()
    if not (url and secret):
        return False
    try:
        req = urllib.request.Request(url, data=json.dumps({"rows": rows}).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json",
                                              "Authorization": f"Bearer {secret}",
                                              # Cloudflare 1010-blocks the default Python-urllib agent
                                              "User-Agent": "UCT-llm-usage/1.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return 200 <= r.status < 300
    except Exception:  # noqa: BLE001
        _stats["forward_errors"] += 1
        return False


def _drain(max_rows: int = 500) -> list[dict]:
    out: list[dict] = []
    while len(out) < max_rows:
        try:
            out.append(_q.get_nowait())
        except queue.Empty:
            break
    return out


def flush() -> int:
    rows = _drain(_QUEUE_MAX)
    if not rows:
        return 0
    if _forward_url() and _forward(rows):
        return len(rows)
    try:
        return write_rows(rows)
    except Exception:  # noqa: BLE001
        _stats["write_errors"] += 1
        log.warning("[llm_usage] ledger write failed; %d rows lost", len(rows), exc_info=True)
        return 0


def _writer_loop() -> None:
    last_prune = 0.0
    while True:
        time.sleep(_FLUSH_EVERY_S)
        try:
            flush()
            if time.time() - last_prune > 6 * 3600 and not _forward_url():
                prune()
                last_prune = time.time()
        except Exception:  # noqa: BLE001
            log.debug("[llm_usage] writer loop error", exc_info=True)


def _ensure_writer() -> None:
    global _writer
    if _writer is not None and _writer.is_alive():
        return
    with _lock:
        if _writer is not None and _writer.is_alive():
            return
        _writer = threading.Thread(target=_writer_loop, name="llm-usage-writer", daemon=True)
        _writer.start()


def stats() -> dict:
    return {**_stats, "queued": _q.qsize(), "installed": _installed, "db_path": db_path(),
            "service": service_name(), "forwarding": bool(_forward_url())}
