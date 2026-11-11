"""Meter every Claude API call made by a Python process on the owner's PC.

The website records its own Claude spend (api/services/llm_usage.py). The PC runs
dozens of scheduled jobs (Morning Wire, the brain, the wire critic, market monitor,
X news, clips, recaps, Sunday Scan, ...) whose calls the website never sees, and
they bill their own API keys. This module closes that gap without touching any of
those repos: `install.py` puts it in the user site-packages with a one-line .pth,
so every Python process loads it at startup.

What it does, and what it costs a process:
  * At startup: registers one import hook. It does NOT import anthropic, so a
    script that never uses Claude pays nothing measurable.
  * When a process imports `anthropic`: hooks the SDK once (the same hook points
    the website's ledger uses on anthropic 0.83: `_process_response` for a whole
    Message, `Stream.__stream__` for streamed usage).
  * When a process imports `requests`: hooks `Session.send` for POSTs to
    api.anthropic.com/v1/messages. Morning Wire calls Claude this way (raw HTTP:
    the engine, mover_why, the Substack steps), which no SDK hook can see. The SDK
    itself rides httpx, so a call is never counted by both hooks.
  * Each Messages call becomes one row: door = the job's entry script, relative to
    its repo (e.g. `morning-wire/pipeline.py`), func = the file and function that
    made the call, plus model and token counts. The website prices it.
  * Rows are sent to the website's ledger (`/api/internal/llm-usage/ingest`, the
    PUSH_SECRET bearer) every 60 s and at exit. A failed send never raises and
    never changes the call's result.

Never active under pytest, inside the website's own process (which has its own
ledger), or with UCT_LLM_METER=0. Uninstall: `python install.py --uninstall`.
"""
from __future__ import annotations

import atexit
import os
import sys
import threading
import time

__all__ = ["install", "install_requests", "flush", "active"]

ENDPOINT_PATH = "/api/internal/llm-usage/ingest"
DEFAULT_DASHBOARD = "https://web-production-05cb6.up.railway.app"
FLUSH_EVERY_S = 60.0
MAX_BUFFER = 5000

_lock = threading.Lock()
_rows: list = []
_installed = False
_flusher_started = False
_HOME = os.path.normcase(os.path.expanduser("~"))
_SELF = os.path.normcase(os.path.abspath(__file__))
_settings_cache: dict = {}


# ── switches ───────────────────────────────────────────────────────────────────

def _disabled() -> bool:
    if os.environ.get("UCT_LLM_METER", "1").strip().lower() in ("0", "false", "no", "off"):
        return True
    if os.environ.get("PYTEST_CURRENT_TEST") or "pytest" in sys.modules:
        return not os.environ.get("UCT_LLM_METER_TEST")
    return False


def _site_ledger_active() -> bool:
    """The website's own ledger is hooked in this process: it records, we don't."""
    mod = sys.modules.get("api.services.llm_usage")
    return bool(mod is not None and getattr(mod, "_installed", False))


def active() -> bool:
    return (_installed or _requests_installed) and not _disabled()


# ── attribution ────────────────────────────────────────────────────────────────

def _rel(path: str) -> str | None:
    """`repo/sub/file.py` for a file under the home directory, else None."""
    try:
        p = os.path.normcase(os.path.abspath(path))
    except (TypeError, ValueError):
        return None
    if not p.startswith(_HOME + os.sep) or p == _SELF:
        return None
    rel = p[len(_HOME) + 1:]
    low = rel.lower()
    if "site-packages" in low or low.startswith(("appdata" + os.sep, ".")) or (os.sep + ".venv" + os.sep) in low:
        return None
    return rel.replace(os.sep, "/")


def _entry() -> str:
    main = sys.modules.get("__main__")
    f = getattr(main, "__file__", None) or (sys.argv[0] if sys.argv and sys.argv[0] not in ("", "-c") else None)
    if f:
        r = _rel(f)
        if r:
            return r
    return ""


def _callsite(frame) -> tuple[str, str]:
    while frame is not None:
        r = _rel(frame.f_code.co_filename)
        if r:
            return r, frame.f_code.co_name
        frame = frame.f_back
    return "", ""


def attribute(frame) -> tuple[str, str]:
    """(door, func): door is the job (entry script); func is where the call was made."""
    site, fn = _callsite(frame)
    entry = _entry()
    door = entry or site or "pc/unattributed"
    func = f"{site}:{fn}" if site else fn
    return door[:300], func[:200]


# ── rows ───────────────────────────────────────────────────────────────────────

def _usage_fields(usage) -> dict:
    def g(obj, name):
        if obj is None:
            return 0
        v = obj.get(name) if isinstance(obj, dict) else getattr(obj, name, 0)
        try:
            return int(v or 0)
        except (TypeError, ValueError):
            return 0
    stu = usage.get("server_tool_use") if isinstance(usage, dict) else getattr(usage, "server_tool_use", None)
    return {"input_tokens": g(usage, "input_tokens"), "output_tokens": g(usage, "output_tokens"),
            "cache_read_tokens": g(usage, "cache_read_input_tokens"),
            "cache_write_tokens": g(usage, "cache_creation_input_tokens"),
            "web_searches": g(stu, "web_search_requests")}


def record(*, door: str, func: str, model: str, kind: str = "sync", ok: bool = True,
           request_id: str = "", **usage) -> None:
    if _disabled() or _site_ledger_active():
        return
    row = {"door": door, "func": func, "model": model[:100], "kind": kind, "service": "pc",
           "at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()), "ok": bool(ok),
           "request_id": request_id[:120], **usage}
    with _lock:
        if len(_rows) < MAX_BUFFER:
            _rows.append(row)
    _start_flusher()


def _record_message(msg, door: str, func: str) -> None:
    record(door=door, func=func, model=str(getattr(msg, "model", "") or ""),
           request_id=str(getattr(msg, "id", "") or ""), **_usage_fields(getattr(msg, "usage", None)))


class _StreamTally:
    __slots__ = ("door", "func", "model", "rid", "u", "done")

    def __init__(self, door, func):
        self.door, self.func, self.model, self.rid, self.done = door, func, "", "", False
        self.u = {"input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0,
                  "cache_write_tokens": 0, "web_searches": 0}

    def see(self, ev) -> None:
        t = getattr(ev, "type", None)
        if t == "message_start":
            msg = getattr(ev, "message", None)
            self.model = str(getattr(msg, "model", "") or "")
            self.rid = str(getattr(msg, "id", "") or "")
            self._merge(getattr(msg, "usage", None))
        elif t == "message_delta":
            self._merge(getattr(ev, "usage", None))

    def _merge(self, usage) -> None:
        if usage is None:
            return
        for k, v in _usage_fields(usage).items():
            if v:
                self.u[k] = max(self.u[k], v)

    def finish(self, ok: bool) -> None:
        if self.done:
            return
        self.done = True
        if self.model or any(self.u.values()):
            record(door=self.door, func=self.func, model=self.model, kind="stream", ok=ok,
                   request_id=self.rid, **self.u)


# ── sending ────────────────────────────────────────────────────────────────────

def _setting(key: str) -> str:
    if os.environ.get(key):
        return os.environ[key].strip()
    if key in _settings_cache:
        return _settings_cache[key]
    val = ""
    for env_file in (os.path.join(_HOME, "morning-wire", ".env"), os.path.join(_HOME, "uct-intelligence", ".env")):
        try:
            with open(env_file, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    if line.startswith(key + "="):
                        val = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except OSError:
            continue
        if val:
            break
    _settings_cache[key] = val
    return val


def _post(rows: list) -> bool:
    secret = _setting("PUSH_SECRET")
    if not secret:
        return False
    import json
    import urllib.request
    url = (_setting("DASHBOARD_URL") or DEFAULT_DASHBOARD).rstrip("/") + ENDPOINT_PATH
    req = urllib.request.Request(url, data=json.dumps({"rows": rows}).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "UCT-llm-meter/1.0",
                                          "Authorization": f"Bearer {secret}"})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return 200 <= r.status < 300
    except Exception:  # noqa: BLE001 -- metering never breaks the job
        return False


def flush() -> int:
    """Send buffered rows. Rows that fail to send are kept for the next try (bounded)."""
    with _lock:
        rows, _rows[:] = list(_rows), []
    if not rows:
        return 0
    if _post(rows):
        return len(rows)
    with _lock:
        _rows[:0] = rows[: max(0, MAX_BUFFER - len(_rows))]
    return 0


def _start_flusher() -> None:
    global _flusher_started
    if _flusher_started:
        return
    with _lock:
        if _flusher_started:
            return
        _flusher_started = True

    def loop():
        while True:
            time.sleep(FLUSH_EVERY_S)
            try:
                flush()
            except Exception:  # noqa: BLE001
                pass

    threading.Thread(target=loop, name="uct-llm-meter", daemon=True).start()
    atexit.register(flush)


# ── the SDK hook ───────────────────────────────────────────────────────────────

def _is_messages_url(options) -> bool:
    path = str(getattr(options, "url", "") or "").split("?", 1)[0].rstrip("/")
    return path.endswith("/messages") and "/batches" not in path and "count_tokens" not in path


def install() -> bool:
    """Hook the Anthropic SDK in this process. Idempotent; never raises."""
    global _installed
    if _installed:
        return True
    if _disabled():
        return False
    try:
        from anthropic import _base_client as bc
        from anthropic import _streaming as st
    except Exception:  # noqa: BLE001
        return False
    with _lock:
        if _installed:
            return True
        orig_sync = bc.SyncAPIClient._process_response
        orig_async = bc.AsyncAPIClient._process_response

        def _after(result, options):
            if not _is_messages_url(options):
                return result
            door, func = attribute(sys._getframe(2))
            if isinstance(result, (st.Stream, st.AsyncStream)):
                try:
                    result._uct_meter = _StreamTally(door, func)
                except Exception:  # noqa: BLE001
                    pass
            elif getattr(result, "usage", None) is not None:
                _record_message(result, door, func)
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
            tally = getattr(self, "_uct_meter", None)
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
            tally = getattr(self, "_uct_meter", None)
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

        bc.SyncAPIClient._process_response = sync_process
        bc.AsyncAPIClient._process_response = async_process
        st.Stream.__stream__ = sync_stream
        st.AsyncStream.__stream__ = async_stream
        _installed = True
    return True


def _is_raw_messages_call(request) -> bool:
    url = str(getattr(request, "url", "") or "")
    if "api.anthropic.com" not in url or str(getattr(request, "method", "")).upper() != "POST":
        return False
    path = url.split("?", 1)[0].rstrip("/")
    return path.endswith("/v1/messages")


_requests_installed = False


def install_requests() -> bool:
    """Hook `requests` for raw-HTTP Messages calls. Idempotent; never raises."""
    global _requests_installed
    if _requests_installed:
        return True
    if _disabled():
        return False
    try:
        from requests import sessions
    except Exception:  # noqa: BLE001
        return False
    with _lock:
        if _requests_installed:
            return True
        orig_send = sessions.Session.send

        def send(self, request, **kw):
            resp = orig_send(self, request, **kw)
            try:
                if _is_raw_messages_call(request) and not kw.get("stream"):
                    door, func = attribute(sys._getframe(1))
                    body = {}
                    try:
                        import json as _json
                        raw = request.body
                        body = _json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw or "{}")
                    except Exception:  # noqa: BLE001
                        body = {}
                    data = None
                    if "json" in str(resp.headers.get("content-type", "")).lower():
                        try:
                            data = resp.json()
                        except Exception:  # noqa: BLE001
                            data = None
                    if isinstance(data, dict) and data.get("usage"):
                        record(door=door, func=func, model=str(data.get("model") or body.get("model") or ""),
                               request_id=str(data.get("id") or ""), **_usage_fields(data["usage"]))
                    elif resp.status_code >= 400:
                        # an error response bills nothing, but the attempt is worth seeing
                        record(door=door, func=func, model=str(body.get("model") or ""), ok=False,
                               request_id=str(resp.headers.get("request-id") or ""), **_usage_fields(None))
            except Exception:  # noqa: BLE001 -- metering never touches the response
                pass
            return resp

        sessions.Session.send = send
        _requests_installed = True
    return True


# ── load-time: wait for `anthropic` / `requests` without importing them ───────

_HOOKS = {"anthropic": install, "requests": install_requests}


class _AnthropicWatcher:
    """A meta-path finder that steps aside for every module except the ones in
    `_HOOKS`, and for those wraps the loader so the hook runs right after load."""

    def __init__(self):
        self.pending = set(_HOOKS)

    def find_spec(self, name, path=None, target=None):
        if name not in self.pending:
            return None
        import importlib.util
        self.pending.discard(name)
        try:
            sys.meta_path.remove(self)
        except ValueError:
            pass
        try:
            spec = importlib.util.find_spec(name)
        finally:
            if self.pending and self not in sys.meta_path:
                sys.meta_path.insert(0, self)
        loader = getattr(spec, "loader", None)
        if loader is None or not hasattr(loader, "exec_module"):
            return spec
        orig_exec = loader.exec_module
        hook = _HOOKS[name]

        def exec_module(module):
            orig_exec(module)
            try:
                hook()
            except Exception:  # noqa: BLE001
                pass

        loader.exec_module = exec_module
        return spec


def _arm() -> None:
    """Called from the .pth at interpreter start. Must stay cheap and never raise."""
    try:
        if _disabled():
            return
        watcher = _AnthropicWatcher()
        for name, hook in _HOOKS.items():
            if name in sys.modules:
                hook()
                watcher.pending.discard(name)
        if watcher.pending and not any(isinstance(f, _AnthropicWatcher) for f in sys.meta_path):
            sys.meta_path.insert(0, watcher)
    except Exception:  # noqa: BLE001
        pass
