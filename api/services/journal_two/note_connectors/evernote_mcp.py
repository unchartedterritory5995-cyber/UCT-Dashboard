"""Evernote MCP client: streamable-HTTP JSON-RPC to Evernote's hosted MCP server, READ-ONLY.

Plan E Task 1 (`docs/superpowers/plans/2026-11-02-connector-fidelity-e-evernote.md`). Measured
facts: `docs/notebook-connectors/evernote-mcp-probe.md` and the raw `tools/list` capture
`docs/notebook-connectors/evernote-probe-2026-11-02/tools_list.json`.

The SAFETY RULE this module exists to hold: Evernote's `tools/list` advertises WRITE tools
(create/edit/delete/move notes, notebooks, tags, tasks, attachments) under a `read` grant, so the
grant is no protection. `call_tool` therefore checks its tool name against `READ_TOOLS` as its
FIRST statement, before any I/O, and `tools/call` is the only place a tool name is ever sent.
A name outside the allow-list (a write tool, or a read-only tool nobody chose, such as
`semantic_search`) raises `WriteToolRefused` and nothing reaches the network.
`api/services/journal_two/test_note_connectors_evernote_mcp.py` pins it against the measured
schema, not a typed copy (mutation-proved: removing the check, moving it after the handshake, or
adding `semantic_search` each turn the rail red).

Protocol (MCP 2025-06-18, streamable HTTP): every message is a POST to `MCP_URL`; the session is
opened lazily by the first `call_tool` with `initialize` then `notifications/initialized`; the
server's `Mcp-Session-Id` (when it sends one) and `MCP-Protocol-Version` ride every later request.
A reply is either `application/json` or `text/event-stream`; for SSE the reply is the event whose
JSON-RPC `id` matches the request. A 404 on a request carrying a session id means the session
expired: re-initialise once.

Errors outward are only the `errors` taxonomy. The bearer token is never logged and never put in
an error string (transport errors report their exception TYPE only).
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from typing import Any, Awaitable, Callable

import httpx

from . import errors

log = logging.getLogger(__name__)

MCP_URL = "https://mcp.evernote.com/mcp"
PROTOCOL_VERSION = "2025-06-18"

# The ONLY tools this product may call. All five are `readOnlyHint: true` in the probe capture.
READ_TOOLS: frozenset[str] = frozenset(
    {"search_notes", "get_note", "get_attachment", "search_notebooks", "search_tags"})

# Ruling (Plan E Task 1): retry 5 times on the doubling ladder, pace calls 0.2 s apart. Evernote
# publishes no limits; the probe saw none in 80+ calls (slowest 2.5 s).
RETRY_DELAYS_S = (1.0, 2.0, 4.0, 8.0, 16.0)
MAX_RETRY_AFTER_S = 60.0
MIN_CALL_INTERVAL_S = 0.2
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
TIMEOUT = httpx.Timeout(60.0, connect=10.0)

CLIENT_INFO = {"name": "uct-notebook-sync", "version": "1.0"}


class WriteToolRefused(errors.NoteConnUnsupported):
    """A tool name outside `READ_TOOLS` was asked for. Raised before any I/O."""


class _SessionLost(Exception):
    """Internal: 404 on a request that carried a session id."""


def _default_jitter() -> float:
    return random.uniform(0.5, 1.5)


def _retry_after_s(resp: httpx.Response) -> float | None:
    raw = resp.headers.get("retry-after")
    if raw is None:
        return None
    try:
        value = float(raw.strip())
    except ValueError:
        return None
    if value < 0:
        return None
    return min(value, MAX_RETRY_AFTER_S)


class EvernoteMcpClient:
    """One member's MCP session. Not shared between members; calls are serialised."""

    def __init__(
        self,
        access_token: str,
        *,
        http: httpx.AsyncClient | None = None,
        on_unauthorized: Callable[[], Awaitable[str]] | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
        jitter: Callable[[], float] = _default_jitter,
    ) -> None:
        self._token = access_token
        self._owns_http = http is None
        self._http = http if http is not None else httpx.AsyncClient(timeout=TIMEOUT)
        self._on_unauthorized = on_unauthorized
        self._sleep = sleep
        self._clock = clock
        self._jitter = jitter
        self._session_id: str | None = None
        self._initialized = False
        self._next_id = 0
        self._last_call_at: float | None = None
        self._lock = asyncio.Lock()
        # The name of every `tools/call` actually sent (each attempt), kept for rails.
        self.tool_calls: list[str] = []

    # ------------------------------------------------------------------ public

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name not in READ_TOOLS:
            raise WriteToolRefused(
                f"evernote mcp: tool {name!r} is not on the read-only allow-list",
                reason="This connector only reads from Evernote.",
                code="evernote_write_refused")
        async with self._lock:
            await self._pace()
            for attempt in range(2):
                await self._ensure_session()
                try:
                    result = await self._request(
                        "tools/call", {"name": name, "arguments": arguments}, tool=name)
                    break
                except _SessionLost:
                    self._session_id = None
                    self._initialized = False
                    if attempt == 1:
                        raise errors.NoteConnTransient(
                            "evernote mcp: session lost twice in a row", status=404) from None
            return self._structured(name, result)

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    # ------------------------------------------------------------------ session

    async def _pace(self) -> None:
        if self._last_call_at is None:
            return
        wait = MIN_CALL_INTERVAL_S - (self._clock() - self._last_call_at)
        if wait > 0:
            await self._sleep(wait)

    async def _ensure_session(self) -> None:
        if self._initialized:
            return
        self._session_id = None
        await self._request("initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": dict(CLIENT_INFO),
        })
        await self._request("notifications/initialized", None, notification=True)
        self._initialized = True

    # ------------------------------------------------------------------ transport

    def _headers(self, *, handshake: bool) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
        }
        if not handshake:
            headers["MCP-Protocol-Version"] = PROTOCOL_VERSION
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id
        return headers

    async def _request(self, method: str, params: dict | None, *, notification: bool = False,
                       tool: str | None = None) -> Any:
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        rid: str | None = None
        if not notification:
            self._next_id += 1
            rid = f"uct-{self._next_id}"
            payload["id"] = rid
        body = json.dumps(payload).encode("utf-8")
        handshake = method == "initialize"

        refreshed = False
        attempt = 0
        while True:
            headers = self._headers(handshake=handshake)
            had_session = "Mcp-Session-Id" in headers
            if tool is not None:
                self.tool_calls.append(tool)
                self._last_call_at = self._clock()
            try:
                status, resp, raw = await self._send(body, headers)
            except httpx.TransportError as exc:
                if attempt >= len(RETRY_DELAYS_S):
                    raise errors.NoteConnTransient(
                        f"evernote mcp: transport error ({type(exc).__name__}) on {method}"
                    ) from None
                await self._sleep(RETRY_DELAYS_S[attempt] * self._jitter())
                attempt += 1
                continue

            if status == 401:
                if self._on_unauthorized is not None and not refreshed:
                    refreshed = True
                    self._token = await self._on_unauthorized()
                    continue
                raise errors.NoteConnAuthError(
                    "evernote mcp: access token rejected (401)", status=401)
            if status == 403:
                raise errors.NoteConnAuthError(
                    "evernote mcp: access forbidden (403)", status=403,
                    code="evernote_forbidden")
            if status == 404 and had_session and not handshake:
                raise _SessionLost()
            if status == 429:
                retry_after = _retry_after_s(resp)
                if attempt >= len(RETRY_DELAYS_S):
                    raise errors.NoteConnRateLimited(
                        f"evernote mcp: rate limited on {method}", status=429,
                        retry_after=retry_after)
                delay = retry_after if retry_after is not None else (
                    RETRY_DELAYS_S[attempt] * self._jitter())
                await self._sleep(delay)
                attempt += 1
                continue
            if status >= 500:
                if attempt >= len(RETRY_DELAYS_S):
                    raise errors.NoteConnTransient(
                        f"evernote mcp: HTTP {status} on {method}", status=status)
                await self._sleep(RETRY_DELAYS_S[attempt] * self._jitter())
                attempt += 1
                continue
            if status == 404:
                raise errors.NoteConnTransient(
                    f"evernote mcp: HTTP 404 on {method}", status=404)
            if status >= 400:
                raise errors.NoteConnError(
                    f"evernote mcp: HTTP {status} on {method}", status=status)

            if handshake:
                sid = resp.headers.get("mcp-session-id")
                if sid:
                    self._session_id = sid
            if notification:
                return None
            return self._parse(raw, resp.headers.get("content-type", ""), rid, method)

    async def _send(self, body: bytes, headers: dict[str, str]) -> tuple[int, httpx.Response, bytes]:
        """POST and read the body, streamed and capped at `MAX_RESPONSE_BYTES`."""
        async with self._http.stream("POST", MCP_URL, content=body, headers=headers,
                                     timeout=TIMEOUT) as resp:
            declared = resp.headers.get("content-length")
            if declared is not None and declared.isdigit() and int(declared) > MAX_RESPONSE_BYTES:
                raise errors.NoteConnTooLarge(
                    f"evernote mcp: response of {declared} bytes is over the cap")
            chunks: list[bytes] = []
            total = 0
            async for chunk in resp.aiter_bytes():
                total += len(chunk)
                if total > MAX_RESPONSE_BYTES:
                    raise errors.NoteConnTooLarge(
                        "evernote mcp: response is over the cap")
                chunks.append(chunk)
            return resp.status_code, resp, b"".join(chunks)

    # ------------------------------------------------------------------ parsing

    @staticmethod
    def _parse(raw: bytes, content_type: str, rid: str | None, method: str) -> Any:
        messages: list[Any] = []
        try:
            text = raw.decode("utf-8")
            if "text/event-stream" in content_type.lower():
                for event in text.replace("\r\n", "\n").split("\n\n"):
                    data = [line[5:].lstrip(" ") for line in event.split("\n")
                            if line.startswith("data:")]
                    if data:
                        messages.append(json.loads("\n".join(data)))
            else:
                parsed = json.loads(text)
                messages.extend(parsed if isinstance(parsed, list) else [parsed])
        except (UnicodeDecodeError, ValueError):
            raise errors.NoteConnTransient(
                f"evernote mcp: unreadable reply to {method}") from None

        for msg in messages:
            if not isinstance(msg, dict) or msg.get("id") != rid:
                continue
            if "error" in msg:
                err = msg.get("error") or {}
                message = str(err.get("message") or "error") if isinstance(err, dict) else str(err)
                raise errors.NoteConnUnsupported(
                    f"evernote mcp: {method} failed: {message}", reason=message,
                    code="evernote_jsonrpc_error", body=err)
            return msg.get("result")
        raise errors.NoteConnTransient(f"evernote mcp: no reply to {method}")

    @staticmethod
    def _structured(name: str, result: Any) -> dict[str, Any]:
        if not isinstance(result, dict):
            raise errors.NoteConnTransient(f"evernote mcp: {name} returned no result")
        if result.get("isError"):
            text = ""
            for block in result.get("content") or []:
                if isinstance(block, dict) and block.get("type") == "text":
                    text = str(block.get("text") or "")
                    break
            text = text or f"{name} failed"
            raise errors.NoteConnUnsupported(
                f"evernote mcp: {name}: {text}", reason=text, code="evernote_tool_error")
        sc = result.get("structuredContent")
        if not isinstance(sc, dict):
            raise errors.NoteConnUnsupported(
                f"evernote mcp: {name} returned no structuredContent",
                code="evernote_shape")
        return sc
