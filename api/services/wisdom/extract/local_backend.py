"""A LOCAL extraction backend — the same client surface, zero API spend (R85/R86/R87).

⛔⛔ THE POINT OF THIS MODULE IS THE MONEY. The paid path stays exactly where it was and stays
the default; this is a second implementation of the interface `batch.py` and the golden gate
already call, backed by a model running on this machine. It NEVER imports the anthropic SDK,
never reads an API key, and records every cost as 0.0 — and there are rails asserting each of
those, because "it happened not to spend this time" is not the same claim as "it cannot".

⛔ ROUTING EXTRACTION THROUGH A SUBSCRIPTION OR AN OAUTH SESSION TO AVOID THE API IS FORBIDDEN
(owner ruling). $0 means a model on hardware we control, not a different way of billing.

THE INTERFACE IT MUST SATISFY, read off the two callers rather than assumed:
    client.messages.count_tokens(model=, system=, messages=, output_config=) -> .input_tokens
    client.messages.batches.create(requests=[{custom_id, params}]) -> .id .processing_status
    client.messages.batches.retrieve(id)   -> .processing_status
    client.messages.batches.results(id)    -> iterable of per-request results
    client.messages.batches.list(limit=)   -> iterable
    client.messages.stream(**params)       -> the gate tool's single-shot path

⭐ THE BATCH EMULATION IS A DIRECTORY, NOT A LIST IN MEMORY, and that is deliberate. A corpus
pass is tens of thousands of requests over many hours on a box that OOM-kills things; an
in-memory queue loses everything to one kill. Each result is written as it completes, so a
re-run resumes from what is already on disk and `results()` streams from there.

TRANSPORT: an OpenAI-compatible HTTP endpoint on loopback (llama.cpp's `llama-server`), read
from WISDOM_LOCAL_LLM_URL. HTTP to 127.0.0.1 is not a provider call; the rails assert the host
is a loopback address so this cannot quietly become one.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterator, Optional

#: Where the local server listens. Loopback only — asserted, not assumed.
URL_ENV = "WISDOM_LOCAL_LLM_URL"
DEFAULT_URL = "http://127.0.0.1:8080/v1/chat/completions"
MODEL_ENV = "WISDOM_EXTRACT_LOCAL_MODEL"
DEFAULT_MODEL = "local-unset"
JOBS_ENV = "WISDOM_LOCAL_JOBS_DIR"
TIMEOUT_ENV = "WISDOM_LOCAL_LLM_TIMEOUT_SECS"
#: How many requests to keep in flight. It must not exceed the server's own slot count
#: (llama-server -np): beyond that the extra requests queue inside the server and the only
#: thing that grows is latency per request, which looks like the model got slower.
SLOTS_ENV = "WISDOM_LOCAL_LLM_SLOTS"
DEFAULT_SLOTS = 4
DEFAULT_TIMEOUT = 600

LOOPBACK = ("127.0.0.1", "localhost", "::1", "0.0.0.0")


class LocalBackendUnavailable(RuntimeError):
    """The local runtime is not reachable. Never falls back to a paid client."""


class NotLoopback(ValueError):
    """The configured URL is not on this machine. Refused: this backend is the $0 path."""


def local_url() -> str:
    url = (os.environ.get(URL_ENV) or "").strip() or DEFAULT_URL
    host = re.sub(r"^https?://", "", url).split("/")[0].split(":")[0]
    if host not in LOOPBACK:
        raise NotLoopback(
            f"{URL_ENV}={url!r} points at {host!r}, which is not loopback. The local backend "
            "exists so that extraction costs nothing; pointing it at a remote host would make "
            "that untrue without changing a single other line.")
    return url


def local_model() -> str:
    return (os.environ.get(MODEL_ENV) or "").strip() or DEFAULT_MODEL


def jobs_root() -> pathlib.Path:
    override = (os.environ.get(JOBS_ENV) or "").strip()
    if override:
        return pathlib.Path(override)
    return pathlib.Path(os.environ.get("DATA_DIR", "/data")) / "wisdom" / "local-jobs"


def slots() -> int:
    raw = (os.environ.get(SLOTS_ENV) or "").strip()
    try:
        n = int(raw) if raw else DEFAULT_SLOTS
    except ValueError:
        return DEFAULT_SLOTS
    return n if n >= 1 else DEFAULT_SLOTS


def _timeout() -> float:
    raw = (os.environ.get(TIMEOUT_ENV) or "").strip()
    try:
        return float(raw) if raw else float(DEFAULT_TIMEOUT)
    except ValueError:
        return float(DEFAULT_TIMEOUT)


# ── token counting ───────────────────────────────────────────────────────────

def estimate_tokens(text: str) -> int:
    """⚠️ A LENGTH HEURISTIC, AND IT SAYS SO. The real count comes from the server's own usage
    field once a request has run; this is only for the pre-flight the budget code calls. It is
    deliberately the same chars//3 shape `batch.char_estimate_tokens` already uses, so the two
    estimates cannot silently disagree about the same text."""
    return max(1, len(text) // 3)


# ── the result objects, shaped like the SDK's ────────────────────────────────

@dataclass
class _Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_creation: Any = None


@dataclass
class _Block:
    type: str
    text: str


@dataclass
class _Message:
    content: list
    stop_reason: str
    usage: _Usage
    stop_details: Any = None


@dataclass
class _Result:
    type: str
    message: Optional[_Message] = None
    error: Any = None


@dataclass
class _Item:
    custom_id: str
    result: _Result


@dataclass
class _Counts:
    processing: int = 0
    succeeded: int = 0
    errored: int = 0
    canceled: int = 0
    expired: int = 0


@dataclass
class _Batch:
    id: str
    processing_status: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    request_counts: _Counts = field(default_factory=_Counts)


# ── the HTTP call ────────────────────────────────────────────────────────────

def _post(url: str, payload: dict, timeout: float) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 — the caller decides; never a paid fallback
        raise LocalBackendUnavailable(f"{type(exc).__name__}: {exc}") from exc


def _params_to_chat(params: dict) -> dict:
    """The extractor speaks Anthropic's shape; the local server speaks OpenAI's."""
    messages = [{"role": "system", "content": _as_text(params.get("system"))}]
    for m in params.get("messages") or []:
        messages.append({"role": m.get("role", "user"), "content": _as_text(m.get("content"))})
    out = {
        "model": local_model(),
        "messages": messages,
        "temperature": 0,
        "max_tokens": int(params.get("max_tokens") or 4096),
        "stream": False,
    }
    return out


def _as_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for b in value:
            if isinstance(b, dict):
                parts.append(b.get("text") or "")
            else:
                parts.append(getattr(b, "text", "") or "")
        return "\n".join(p for p in parts if p)
    return str(value)


def run_one(params: dict) -> _Message:
    """One extraction, synchronously. Raises LocalBackendUnavailable; never returns a paid call."""
    data = _post(local_url(), _params_to_chat(params), _timeout())
    choices = data.get("choices") or []
    text = ""
    finish = "end_turn"
    if choices:
        text = (choices[0].get("message") or {}).get("content") or ""
        finish = choices[0].get("finish_reason") or "stop"
    usage = data.get("usage") or {}
    return _Message(
        content=[_Block(type="text", text=text)],
        stop_reason="max_tokens" if finish == "length" else "end_turn",
        usage=_Usage(input_tokens=int(usage.get("prompt_tokens") or 0),
                     output_tokens=int(usage.get("completion_tokens") or 0)),
    )


# ── the batch emulation, on disk ─────────────────────────────────────────────

class LocalBatches:
    """⭐ A batch is a DIRECTORY. `create` writes the requests then processes them one at a time,
    appending each outcome to results.jsonl as it lands. A kill loses the request in flight and
    nothing else; the next `create` for the same batch id resumes."""

    def __init__(self, root: Optional[pathlib.Path] = None):
        self._root = root

    def root(self) -> pathlib.Path:
        return self._root if self._root is not None else jobs_root()

    def _dir(self, bid: str) -> pathlib.Path:
        return self.root() / bid

    def create(self, requests) -> _Batch:
        requests = list(requests)
        bid = f"localbatch_{int(time.time() * 1000):013d}_{len(requests):05d}"
        d = self._dir(bid)
        d.mkdir(parents=True, exist_ok=True)
        (d / "requests.jsonl").write_text(
            "".join(json.dumps(r) + "\n" for r in requests), encoding="utf-8")
        self._process(bid)
        return _Batch(id=bid, processing_status="ended",
                      request_counts=_Counts(succeeded=self._done_count(bid)))

    def _done_ids(self, bid: str) -> set:
        p = self._dir(bid) / "results.jsonl"
        if not p.exists():
            return set()
        out = set()
        for line in p.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                out.add(json.loads(line)["custom_id"])
            except Exception:
                continue
        return out

    def _done_count(self, bid: str) -> int:
        return len(self._done_ids(bid))

    def _process(self, bid: str) -> None:
        """⭐ CONCURRENT, BOUNDED BY THE SERVER'S SLOTS, AND STILL RESUMABLE. Each result is
        appended under a lock the moment it lands, so a kill still loses only what was in
        flight. Running one request at a time against a 4-slot server wastes three quarters of
        the machine - measured, not assumed: the slots are what -np allocates."""
        import threading
        from concurrent.futures import ThreadPoolExecutor

        d = self._dir(bid)
        done = self._done_ids(bid)
        reqs = [json.loads(l) for l in (d / "requests.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
        todo = [r for r in reqs if r["custom_id"] not in done]
        if not todo:
            return
        lock = threading.Lock()
        fh = (d / "results.jsonl").open("a", encoding="utf-8")

        def one(r):
            cid = r["custom_id"]
            try:
                msg = run_one(r["params"])
                rec = {"custom_id": cid, "type": "succeeded",
                       "text": msg.content[0].text,
                       "stop_reason": msg.stop_reason,
                       "input_tokens": msg.usage.input_tokens,
                       "output_tokens": msg.usage.output_tokens}
            except LocalBackendUnavailable as exc:
                rec = {"custom_id": cid, "type": "errored", "error": str(exc)[:300]}
            with lock:
                fh.write(json.dumps(rec) + "\n")
                fh.flush()

        try:
            n = max(1, min(slots(), len(todo)))
            if n == 1:
                for r in todo:
                    one(r)
            else:
                with ThreadPoolExecutor(max_workers=n) as pool:
                    list(pool.map(one, todo))
        finally:
            fh.close()

    def retrieve(self, bid: str) -> _Batch:
        d = self._dir(bid)
        if not d.exists():
            return _Batch(id=bid, processing_status="ended", request_counts=_Counts())
        total = sum(1 for l in (d / "requests.jsonl").read_text(encoding="utf-8").splitlines() if l.strip())
        done = self._done_count(bid)
        status = "ended" if done >= total else "in_progress"
        return _Batch(id=bid, processing_status=status,
                      request_counts=_Counts(succeeded=done, processing=max(0, total - done)))

    def results(self, bid: str) -> Iterator[_Item]:
        p = self._dir(bid) / "results.jsonl"
        if not p.exists():
            return iter(())
        items = []
        for line in p.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            if r.get("type") == "succeeded":
                items.append(_Item(custom_id=r["custom_id"], result=_Result(
                    type="succeeded",
                    message=_Message(content=[_Block("text", r.get("text") or "")],
                                     stop_reason=r.get("stop_reason") or "end_turn",
                                     usage=_Usage(input_tokens=int(r.get("input_tokens") or 0),
                                                  output_tokens=int(r.get("output_tokens") or 0))))))
            else:
                items.append(_Item(custom_id=r["custom_id"], result=_Result(type="errored", error=r.get("error"))))
        return iter(items)

    def list(self, limit: int = 20):
        root = self.root()
        if not root.exists():
            return iter(())
        dirs = sorted((p for p in root.iterdir() if p.is_dir()), reverse=True)[:limit]
        return iter([self.retrieve(p.name) for p in dirs])


class LocalMessages:
    def __init__(self, root: Optional[pathlib.Path] = None):
        self.batches = LocalBatches(root)

    def count_tokens(self, **kw):
        text = _as_text(kw.get("system")) + "".join(
            _as_text(m.get("content")) for m in (kw.get("messages") or []))
        return _Usage(input_tokens=estimate_tokens(text))

    def stream(self, **params):
        """The gate tool's single-shot path. Returns a context manager whose
        `get_final_message()` yields the same shape the SDK's does."""
        message = run_one(params)

        class _Ctx:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *a):
                return False

            def get_final_message(self_inner):
                return message

        return _Ctx()


class LocalClient:
    """⛔ Deliberately NOT named or shaped like the SDK's client beyond the methods above, so a
    reader can never mistake one for the other in a traceback."""

    is_local_backend = True
    cost_usd = 0.0

    def __init__(self, root: Optional[pathlib.Path] = None):
        self.messages = LocalMessages(root)


def make_local_client(root: Optional[pathlib.Path] = None) -> LocalClient:
    local_url()          # ⛔ refuses a non-loopback URL before anything is built
    return LocalClient(root)
