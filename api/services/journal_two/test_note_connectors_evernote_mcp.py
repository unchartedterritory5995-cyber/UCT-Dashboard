"""Tests for the Evernote MCP client -- `note_connectors.evernote_mcp` (Plan E Task 1).

No network anywhere: every test builds an `httpx.AsyncClient` on `httpx.MockTransport`, so a
request only ever reaches the in-process handler defined here. The tool names and read-only
annotations come from the MEASURED `tools/list` capture of 2026-11-02, read from disk, never a
typed copy: the allow-list rail is only as good as the schema it is checked against.

The key rule is the read-only allow-list: a tool name outside `READ_TOOLS` is refused before any
I/O, and `tools/call` is the only place a tool name is sent.
"""

from __future__ import annotations

import asyncio
import json
import pathlib

import httpx
import pytest

from api.services.journal_two.note_connectors import errors, evernote_mcp

REPO = pathlib.Path(__file__).resolve().parents[3]
PROBE_TOOLS = REPO / "docs/notebook-connectors/evernote-probe-2026-11-02/tools_list.json"

TOKEN = "tok-SECRET-abc123"
SESSION = "sess-1"


def _probe_tools() -> list[dict]:
    return json.loads(PROBE_TOOLS.read_text(encoding="utf-8"))["result"]["tools"]


def _ok(structured: dict, *, is_error: bool = False, text: str = "summary") -> dict:
    """A `tools/call` result body (without the JSON-RPC envelope)."""
    result = {"content": [{"type": "text", "text": text}], "structuredContent": structured}
    if is_error:
        result["isError"] = True
    return result


def _rpc(req: httpx.Request) -> dict:
    return json.loads(req.content.decode("utf-8"))


class Server:
    """A scripted MCP endpoint. `on_call` answers each `tools/call` with an httpx.Response
    (or a result dict, wrapped as a JSON 200). The handshake is answered automatically."""

    def __init__(self, on_call=None, *, session_id: str | None = SESSION, on_init=None,
                 on_notify=None):
        self.requests: list[httpx.Request] = []
        self.on_call = on_call or (lambda req, body: _ok({"ok": True}))
        self.session_id = session_id
        self.inits = 0
        self.on_init = on_init  # optional: (req) -> httpx.Response | None (None = normal reply)
        self.on_notify = on_notify  # optional: (req) -> httpx.Response

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        body = _rpc(req)
        method = body.get("method")
        if method == "initialize":
            if self.on_init is not None:
                override = self.on_init(req)
                if override is not None:
                    return override
            self.inits += 1
            headers = {"content-type": "application/json"}
            if self.session_id:
                headers["mcp-session-id"] = f"{self.session_id}-{self.inits}"
            return httpx.Response(200, headers=headers, json={
                "jsonrpc": "2.0", "id": body["id"],
                "result": {"protocolVersion": evernote_mcp.PROTOCOL_VERSION,
                           "capabilities": {"tools": {}},
                           "serverInfo": {"name": "evernote", "version": "x"}}})
        if method == "notifications/initialized":
            if self.on_notify is not None:
                return self.on_notify(req)
            return httpx.Response(202)
        assert method == "tools/call", method
        out = self.on_call(req, body)
        if isinstance(out, httpx.Response):
            return out
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": out})

    def calls(self) -> list[httpx.Request]:
        return [r for r in self.requests if _rpc(r).get("method") == "tools/call"]


def _client(handler=None, *, server: Server | None = None, sleeps: list | None = None,
            clock=None, on_unauthorized=None):
    if handler is not None and server is None:
        server = Server(lambda req, body: handler(req))
    server = server or Server()
    sleeps = sleeps if sleeps is not None else []

    async def fake_sleep(s: float) -> None:
        sleeps.append(s)

    http = httpx.AsyncClient(transport=httpx.MockTransport(server))
    client = evernote_mcp.EvernoteMcpClient(
        TOKEN, http=http, on_unauthorized=on_unauthorized, sleep=fake_sleep,
        clock=clock or (lambda: 1000.0), jitter=lambda: 1.0)
    client._test_server = server  # for assertions
    return client


# --------------------------------------------------------------------------- allow-list


def test_every_write_tool_in_the_probed_schema_is_refused_before_the_network():
    tools = _probe_tools()
    writes = {t["name"] for t in tools if not t["annotations"]["readOnlyHint"]}
    assert writes >= {"create_note", "edit_note", "delete_note", "update_note_tags", "move_notes"}
    assert not (writes & evernote_mcp.READ_TOOLS)
    sent = []
    client = _client(handler=lambda req: sent.append(req) or _ok({}))
    for name in sorted(writes):
        with pytest.raises(evernote_mcp.WriteToolRefused):
            asyncio.run(client.call_tool(name, {}))
    # Nothing at all reached the transport: not even the initialize handshake.
    assert sent == [] and client.tool_calls == []
    assert client._test_server.requests == []


def test_every_read_tool_is_annotated_read_only_in_the_probed_schema():
    by_name = {t["name"]: t for t in _probe_tools()}
    assert evernote_mcp.READ_TOOLS == frozenset(
        {"search_notes", "get_note", "get_attachment", "search_notebooks", "search_tags"})
    for name in evernote_mcp.READ_TOOLS:
        assert name in by_name, name
        assert by_name[name]["annotations"]["readOnlyHint"] is True, name


def test_unknown_tool_name_is_refused():
    by_name = {t["name"]: t for t in _probe_tools()}
    # Read-only in the schema, but NOT allow-listed: refused all the same.
    assert by_name["semantic_search"]["annotations"]["readOnlyHint"] is True
    client = _client()
    # Case and whitespace variants of an allowed name are refused too: membership is exact on the
    # raw string, and a future "normalise the name" helper must turn this red (review m1).
    for name in ("semantic_search", "not_a_tool", "", "GET_NOTE", " get_note", "get_note ",
                 "Get_Note", "get_note\n", "get_note​"):
        with pytest.raises(evernote_mcp.WriteToolRefused):
            asyncio.run(client.call_tool(name, {}))
    assert client._test_server.requests == [] and client.tool_calls == []


def test_write_tool_refused_is_an_unsupported_error():
    assert issubclass(evernote_mcp.WriteToolRefused, errors.NoteConnUnsupported)


# --------------------------------------------------------------------------- session


async def test_initialize_then_initialized_then_call_carries_session_id():
    client = _client(server=Server(lambda req, body: _ok({"hits": []})))
    out = await client.call_tool("search_notes", {"query": ""})
    assert out == {"hits": []}
    reqs = client._test_server.requests
    assert len(reqs) == 3
    init, notif, call = (_rpc(r) for r in reqs)

    assert init["method"] == "initialize"
    assert init["params"]["protocolVersion"] == "2025-06-18"
    assert init["params"]["clientInfo"] == {"name": "uct-notebook-sync", "version": "1.0"}
    assert init["params"]["capabilities"] == {}
    assert "mcp-session-id" not in reqs[0].headers

    assert notif["method"] == "notifications/initialized" and "id" not in notif
    assert reqs[1].headers["mcp-session-id"] == "sess-1-1"

    assert call["method"] == "tools/call"
    assert call["params"] == {"name": "search_notes", "arguments": {"query": ""}}
    assert reqs[2].headers["mcp-session-id"] == "sess-1-1"
    assert reqs[2].headers["mcp-protocol-version"] == "2025-06-18"
    for r in reqs:
        # Review m2: the version header on EVERY request, initialize included, as the probe sent
        # it, and the same User-Agent as our media fetches.
        assert r.headers["mcp-protocol-version"] == "2025-06-18"
        assert r.headers["user-agent"] == "UCTIntelligenceNotebook/1.0 (+https://uctintelligence.com)"
        assert r.url == httpx.URL(evernote_mcp.MCP_URL)
        assert r.method == "POST"
        assert r.headers["authorization"] == f"Bearer {TOKEN}"
        assert "text/event-stream" in r.headers["accept"]
        assert "application/json" in r.headers["accept"]
    assert client.tool_calls == ["search_notes"]

    # A second call reuses the session: no second handshake.
    await client.call_tool("get_note", {"noteId": "n1"})
    assert len(client._test_server.requests) == 4
    assert client.tool_calls == ["search_notes", "get_note"]


async def test_sse_response_is_parsed_by_matching_jsonrpc_id():
    def on_call(req, body):
        rid = body["id"]
        stream = (
            "event: message\n"
            'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}\n'
            "\n"
            "event: message\n"
            f'data: {{"jsonrpc":"2.0","id":"{rid}-other","result":{{"structuredContent":{{"wrong":1}}}}}}\n'
            "\n"
            "event: message\n"
            f"data: {json.dumps({'jsonrpc': '2.0', 'id': rid, 'result': _ok({'right': 2})})}\n"
            "\n"
        )
        return httpx.Response(200, headers={"content-type": "text/event-stream"},
                              content=stream.encode("utf-8"))

    client = _client(server=Server(on_call))
    assert await client.call_tool("get_note", {"noteId": "n1"}) == {"right": 2}


async def test_404_on_a_session_reinitialises_once():
    n = {"calls": 0}

    def on_call(req, body):
        n["calls"] += 1
        if n["calls"] == 1:
            return httpx.Response(404, text="session not found")
        return _ok({"after": req.headers["mcp-session-id"]})

    client = _client(server=Server(on_call))
    out = await client.call_tool("get_note", {"noteId": "n1"})
    assert out == {"after": "sess-1-2"}
    assert client._test_server.inits == 2


async def test_404_twice_raises_transient():
    client = _client(server=Server(lambda req, body: httpx.Response(404)))
    with pytest.raises(errors.NoteConnTransient):
        await client.call_tool("get_note", {"noteId": "n1"})
    assert client._test_server.inits == 2


# --------------------------------------------------------------------------- retries


async def test_429_honours_retry_after_then_succeeds():
    n = {"calls": 0}

    def on_call(req, body):
        n["calls"] += 1
        if n["calls"] == 1:
            return httpx.Response(429, headers={"retry-after": "5"})
        return _ok({"ok": 1})

    sleeps: list[float] = []
    client = _client(server=Server(on_call), sleeps=sleeps)
    assert await client.call_tool("search_tags", {"query": ""}) == {"ok": 1}
    assert sleeps == [5.0]


async def test_retry_after_is_capped():
    n = {"calls": 0}

    def on_call(req, body):
        n["calls"] += 1
        if n["calls"] == 1:
            return httpx.Response(429, headers={"retry-after": "3600"})
        return _ok({})

    sleeps: list[float] = []
    client = _client(server=Server(on_call), sleeps=sleeps)
    await client.call_tool("search_tags", {"query": ""})
    assert sleeps == [evernote_mcp.MAX_RETRY_AFTER_S]


async def test_5xx_backs_off_on_the_ladder_then_raises_transient():
    sleeps: list[float] = []
    client = _client(server=Server(lambda req, body: httpx.Response(503)), sleeps=sleeps)
    with pytest.raises(errors.NoteConnTransient):
        await client.call_tool("search_notes", {"query": ""})
    assert len(client._test_server.calls()) == 6
    assert tuple(sleeps) == evernote_mcp.RETRY_DELAYS_S


async def test_transport_error_backs_off_then_raises_transient_without_the_token():
    def on_call(req, body):
        raise httpx.ConnectError(f"boom Authorization: Bearer {TOKEN}", request=req)

    sleeps: list[float] = []
    client = _client(server=Server(on_call), sleeps=sleeps)
    with pytest.raises(errors.NoteConnTransient) as ei:
        await client.call_tool("search_notes", {"query": ""})
    assert tuple(sleeps) == evernote_mcp.RETRY_DELAYS_S
    assert TOKEN not in str(ei.value)


async def test_429_exhausted_raises_rate_limited_with_retry_after():
    client = _client(server=Server(
        lambda req, body: httpx.Response(429, headers={"retry-after": "7"})))
    with pytest.raises(errors.NoteConnRateLimited) as ei:
        await client.call_tool("search_notes", {"query": ""})
    assert ei.value.retry_after == 7.0
    assert len(client._test_server.calls()) == 6


async def test_401_calls_on_unauthorized_once_and_retries_with_the_new_token():
    refreshed = []

    async def on_unauthorized() -> str:
        refreshed.append(1)
        return "tok-NEW"

    def on_call(req, body):
        if req.headers["authorization"] == f"Bearer {TOKEN}":
            return httpx.Response(401)
        return _ok({"auth": req.headers["authorization"]})

    client = _client(server=Server(on_call), on_unauthorized=on_unauthorized)
    assert await client.call_tool("get_note", {"noteId": "n"}) == {"auth": "Bearer tok-NEW"}
    assert refreshed == [1]


async def test_second_401_raises_auth_error():
    refreshed = []

    async def on_unauthorized() -> str:
        refreshed.append(1)
        return "tok-NEW"

    client = _client(server=Server(lambda req, body: httpx.Response(401)),
                     on_unauthorized=on_unauthorized)
    with pytest.raises(errors.NoteConnAuthError) as ei:
        await client.call_tool("get_note", {"noteId": "n"})
    assert refreshed == [1]
    assert TOKEN not in str(ei.value) and "tok-NEW" not in str(ei.value)


async def test_401_without_a_refresher_raises_auth_error():
    client = _client(server=Server(lambda req, body: httpx.Response(401)))
    with pytest.raises(errors.NoteConnAuthError):
        await client.call_tool("get_note", {"noteId": "n"})


async def test_403_raises_auth_error_with_the_forbidden_code():
    client = _client(server=Server(lambda req, body: httpx.Response(403)))
    with pytest.raises(errors.NoteConnAuthError) as ei:
        await client.call_tool("get_note", {"noteId": "n"})
    assert ei.value.code == "evernote_forbidden"
    assert len(client._test_server.calls()) == 1


# --------------------------------------------------------------------------- results


async def test_is_error_result_raises_unsupported_with_the_tool_text():
    client = _client(server=Server(
        lambda req, body: _ok({}, is_error=True, text="Note not found: n1")))
    with pytest.raises(errors.NoteConnUnsupported) as ei:
        await client.call_tool("get_note", {"noteId": "n1"})
    assert not isinstance(ei.value, evernote_mcp.WriteToolRefused)
    assert "Note not found: n1" in str(ei.value)
    assert ei.value.reason == "Note not found: n1"


async def test_jsonrpc_error_raises_unsupported():
    client = _client(server=Server(lambda req, body: httpx.Response(200, json={
        "jsonrpc": "2.0", "id": body["id"],
        "error": {"code": -32602, "message": "Invalid params"}})))
    with pytest.raises(errors.NoteConnUnsupported) as ei:
        await client.call_tool("get_note", {})
    assert "Invalid params" in str(ei.value)


async def test_response_over_cap_raises_too_large(monkeypatch):
    monkeypatch.setattr(evernote_mcp, "MAX_RESPONSE_BYTES", 1024)
    big = {"content": "x" * 5000}
    client = _client(server=Server(lambda req, body: _ok(big)))
    with pytest.raises(errors.NoteConnTooLarge):
        await client.call_tool("get_note", {"noteId": "n"})


def test_response_cap_is_16_mib():
    assert evernote_mcp.MAX_RESPONSE_BYTES == 16 * 1024 * 1024


async def test_calls_are_paced_by_min_interval():
    now = {"t": 100.0}
    sleeps: list[float] = []
    client = _client(sleeps=sleeps, clock=lambda: now["t"])
    await client.call_tool("search_notes", {"query": ""})
    assert sleeps == []
    now["t"] += 0.05
    await client.call_tool("get_note", {"noteId": "n"})
    assert sleeps == [pytest.approx(0.15)]
    now["t"] += 5.0
    await client.call_tool("get_note", {"noteId": "n"})
    assert sleeps == [pytest.approx(0.15)]


def test_constants():
    assert evernote_mcp.MCP_URL == "https://mcp.evernote.com/mcp"
    assert evernote_mcp.PROTOCOL_VERSION == "2025-06-18"
    assert evernote_mcp.RETRY_DELAYS_S == (1.0, 2.0, 4.0, 8.0, 16.0)
    assert evernote_mcp.MAX_RETRY_AFTER_S == 60.0
    assert evernote_mcp.MIN_CALL_INTERVAL_S == 0.2
    assert evernote_mcp.TIMEOUT == httpx.Timeout(60.0, connect=10.0)


async def test_aclose_closes_an_owned_client_only():
    http = httpx.AsyncClient(transport=httpx.MockTransport(Server()))
    client = evernote_mcp.EvernoteMcpClient(TOKEN, http=http)
    await client.aclose()
    assert not http.is_closed  # borrowed: the caller owns it
    await http.aclose()

    owned = evernote_mcp.EvernoteMcpClient(TOKEN)
    inner = owned._http
    await owned.aclose()
    assert inner.is_closed


# --------------------------------------------------------------------------- fix round 1


async def test_404_on_notifications_initialized_surfaces_as_transient():
    # Review m3: the handshake's own 404 must never leak the internal _SessionLost.
    server = Server(on_notify=lambda req: httpx.Response(404))
    client = _client(server=server)
    with pytest.raises(errors.NoteConnTransient) as ei:
        await client.call_tool("get_note", {"noteId": "n"})
    assert type(ei.value).__name__ != "_SessionLost"
    assert server.inits == 2  # re-initialised once, then gave up
    assert server.calls() == [] and client.tool_calls == []


async def test_404_once_on_notifications_initialized_reinitialises_and_succeeds():
    n = {"notify": 0}

    def on_notify(req):
        n["notify"] += 1
        return httpx.Response(404 if n["notify"] == 1 else 202)

    server = Server(lambda req, body: _ok({"ok": 1}), on_notify=on_notify)
    client = _client(server=server)
    assert await client.call_tool("get_note", {"noteId": "n"}) == {"ok": 1}
    assert server.inits == 2


async def test_at_most_one_on_unauthorized_per_call_tool():
    # Review m4: a refresh rotates the refresh token (Task 2), so one call_tool may refresh once:
    # initialize 401s on the old token -> refresh; the tools/call then 401s again -> auth error,
    # NOT a second refresh.
    refreshed = []

    async def on_unauthorized() -> str:
        refreshed.append(1)
        return f"tok-NEW-{len(refreshed)}"

    def on_init(req):
        if req.headers["authorization"] == f"Bearer {TOKEN}":
            return httpx.Response(401)
        return None

    server = Server(lambda req, body: httpx.Response(401), on_init=on_init)
    client = _client(server=server, on_unauthorized=on_unauthorized)
    with pytest.raises(errors.NoteConnAuthError):
        await client.call_tool("get_note", {"noteId": "n"})
    assert refreshed == [1]

    # The budget is per call_tool, not per client: the next call may refresh once again.
    with pytest.raises(errors.NoteConnAuthError):
        await client.call_tool("get_note", {"noteId": "n"})
    assert refreshed == [1, 1]


def _sse_event(obj: dict) -> bytes:
    return f"event: message\ndata: {json.dumps(obj)}\n\n".encode("utf-8")


async def test_sse_read_stops_at_the_matching_reply_without_waiting_for_eof():
    # Review m5: the server keeps the stream open with keep-alives after the reply; the client must
    # return as soon as the reply with its id has been parsed.
    after = {"chunks": 0}

    def on_call(req, body):
        rid = body["id"]

        async def stream():
            yield b": keep-alive\n\n"
            yield _sse_event({"jsonrpc": "2.0", "id": rid, "result": _ok({"done": 1})})
            while True:  # never EOF
                after["chunks"] += 1
                yield b": keep-alive\n\n"
                await asyncio.sleep(0)

        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=stream())

    client = _client(server=Server(on_call))
    out = await asyncio.wait_for(client.call_tool("get_note", {"noteId": "n"}), timeout=5)
    assert out == {"done": 1}
    assert after["chunks"] <= 1


async def test_sse_keepalives_forever_hit_the_request_deadline(monkeypatch):
    # Review m5: a stream that only ever sends keep-alives is ended by the per-request wall-clock
    # deadline (each chunk would otherwise reset httpx's read timeout forever).
    monkeypatch.setattr(evernote_mcp, "REQUEST_DEADLINE_S", 0.05)

    def on_call(req, body):
        async def stream():
            while True:
                yield b": keep-alive\n\n"
                await asyncio.sleep(0.001)

        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=stream())

    sleeps: list[float] = []
    client = _client(server=Server(on_call), sleeps=sleeps)
    with pytest.raises(errors.NoteConnTransient):
        await asyncio.wait_for(client.call_tool("get_note", {"noteId": "n"}), timeout=10)
    assert tuple(sleeps) == evernote_mcp.RETRY_DELAYS_S  # deadline is retried like a timeout


def test_request_deadline_constant():
    assert evernote_mcp.REQUEST_DEADLINE_S == 120.0


async def test_running_byte_cap_on_a_chunked_sse_reply_without_content_length(monkeypatch):
    # Review m6: no Content-Length, so only the running count can stop it.
    monkeypatch.setattr(evernote_mcp, "MAX_RESPONSE_BYTES", 1024)
    seen = {}

    def on_call(req, body):
        async def stream():
            for _ in range(100):
                yield b": " + b"x" * 98 + b"\n\n"

        resp = httpx.Response(200, headers={"content-type": "text/event-stream"}, content=stream())
        seen["content-length"] = resp.headers.get("content-length")
        return resp

    client = _client(server=Server(on_call))
    with pytest.raises(errors.NoteConnTooLarge):
        await client.call_tool("get_note", {"noteId": "n"})
    assert seen["content-length"] is None


@pytest.mark.parametrize("value", ["nan", "-3", "inf", "soon"])
async def test_bad_retry_after_falls_back_to_the_ladder(value):
    n = {"calls": 0}

    def on_call(req, body):
        n["calls"] += 1
        if n["calls"] == 1:
            return httpx.Response(429, headers={"retry-after": value})
        return _ok({})

    sleeps: list[float] = []
    client = _client(server=Server(on_call), sleeps=sleeps)
    await client.call_tool("search_tags", {"query": ""})
    assert sleeps == [evernote_mcp.RETRY_DELAYS_S[0]]


async def test_retry_after_is_honoured_on_503():
    n = {"calls": 0}

    def on_call(req, body):
        n["calls"] += 1
        if n["calls"] == 1:
            return httpx.Response(503, headers={"retry-after": "5"})
        return _ok({})

    sleeps: list[float] = []
    client = _client(server=Server(on_call), sleeps=sleeps)
    await client.call_tool("search_tags", {"query": ""})
    assert sleeps == [5.0]


@pytest.mark.parametrize("ahead_s, expected", [(30, 30.0), (3600, 60.0)])
async def test_http_date_retry_after_is_parsed_and_capped(ahead_s, expected):
    import datetime as dt
    from email.utils import format_datetime

    when = format_datetime(dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=ahead_s),
                           usegmt=True)
    n = {"calls": 0}

    def on_call(req, body):
        n["calls"] += 1
        if n["calls"] == 1:
            return httpx.Response(429, headers={"retry-after": when})
        return _ok({})

    sleeps: list[float] = []
    client = _client(server=Server(on_call), sleeps=sleeps)
    await client.call_tool("search_tags", {"query": ""})
    assert len(sleeps) == 1 and abs(sleeps[0] - expected) <= 2.0


async def test_http_date_retry_after_in_the_past_falls_back_to_the_ladder():
    n = {"calls": 0}

    def on_call(req, body):
        n["calls"] += 1
        if n["calls"] == 1:
            return httpx.Response(429, headers={"retry-after": "Wed, 21 Oct 2015 07:28:00 GMT"})
        return _ok({})

    sleeps: list[float] = []
    client = _client(server=Server(on_call), sleeps=sleeps)
    await client.call_tool("search_tags", {"query": ""})
    assert sleeps == [evernote_mcp.RETRY_DELAYS_S[0]]


def test_sse_data_strips_exactly_one_leading_space():
    assert evernote_mcp._sse_event_data("data:  two\n") == " two"
    assert evernote_mcp._sse_event_data("data: one") == "one"
    assert evernote_mcp._sse_event_data("data:none") == "none"
    assert evernote_mcp._sse_event_data("event: message\ndata: a\ndata:  b") == "a\n b"
    assert evernote_mcp._sse_event_data(": keep-alive") is None


# --------------------------------------------------------------------------- final review I1(a)
# The SSE reader must be LINEAR in the reply: a `get_note` reply is ONE event, so nothing is
# consumed until it ends, and rescanning the whole buffer on every chunk made a 16 MB reply cost
# seconds of CPU on the event loop.


def _chunked(data: bytes, size: int):
    async def stream():
        for i in range(0, len(data), size):
            yield data[i:i + size]
    return stream()


def _big_reply_client(n_bytes: int, chunk: int):
    def on_call(req, body):
        event = _sse_event({"jsonrpc": "2.0", "id": body["id"], "result": _ok({"blob": "x" * n_bytes})})
        return httpx.Response(200, headers={"content-type": "text/event-stream"},
                              content=_chunked(event, chunk))
    return _client(server=Server(on_call))


def _parse_seconds(n_bytes: int, runs: int = 3) -> float:
    import time
    best = float("inf")
    for _ in range(runs):
        client = _big_reply_client(n_bytes, 4096)
        t0 = time.perf_counter()
        out = asyncio.run(client.call_tool("get_note", {"noteId": "n"}))
        best = min(best, time.perf_counter() - t0)
        assert len(out["blob"]) == n_bytes
    return best


def test_a_large_sse_event_parses_in_linear_time(monkeypatch):
    """4x the bytes must cost about 4x the time, never about 16x. A ratio, not a wall clock, so a
    busy box does not decide it (best of three runs each)."""
    monkeypatch.setattr(evernote_mcp, "MAX_RESPONSE_BYTES", 64 * 1024 * 1024)
    small = _parse_seconds(4 * 1024 * 1024)
    large = _parse_seconds(16 * 1024 * 1024)
    assert large / small < 8.0, (small, large)


def _events(rid: str) -> bytes:
    """Keep-alives, an event for another id, then ours, CRLF throughout, with a multibyte payload."""
    other = json.dumps({"jsonrpc": "2.0", "id": "other", "result": _ok({"x": 1})})
    ours = json.dumps({"jsonrpc": "2.0", "id": rid, "result": _ok({"title": "Café ☕ plan"})},
                      ensure_ascii=False)
    return (": keep-alive\r\n\r\n"
            f"event: message\r\ndata: {other}\r\n\r\n"
            ": another\r\n\r\n"
            f"event: message\r\ndata: {ours}\r\n\r\n").encode("utf-8")


@pytest.mark.parametrize("chunk", range(1, 10))
async def test_sse_events_split_at_every_boundary_parse_the_same(chunk):
    """Every chunk size cuts a CRLF pair, a blank-line pair or a multibyte character somewhere."""
    def on_call(req, body):
        return httpx.Response(200, headers={"content-type": "text/event-stream"},
                              content=_chunked(_events(body["id"]), chunk))
    client = _client(server=Server(on_call))
    assert await client.call_tool("get_note", {"noteId": "n"}) == {"title": "Café ☕ plan"}


@pytest.mark.parametrize("chunk", [1, 2, 3, 5])
async def test_a_chunked_json_reply_with_multibyte_text_parses(chunk):
    def on_call(req, body):
        data = json.dumps({"jsonrpc": "2.0", "id": body["id"], "result": _ok({"t": "Café ☕"})},
                          ensure_ascii=False).encode("utf-8")
        return httpx.Response(200, headers={"content-type": "application/json"}, content=_chunked(data, chunk))
    client = _client(server=Server(on_call))
    assert await client.call_tool("get_note", {"noteId": "n"}) == {"t": "Café ☕"}


async def test_an_sse_reply_whose_last_event_has_no_blank_line_is_still_read():
    def on_call(req, body):
        data = f"event: message\ndata: {json.dumps({'jsonrpc': '2.0', 'id': body['id'], 'result': _ok({'k': 1})})}\r"
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=_chunked(data.encode(), 7))
    client = _client(server=Server(on_call))
    assert await client.call_tool("get_note", {"noteId": "n"}) == {"k": 1}


def test_the_splitter_equals_the_whole_buffer_split_for_any_chunking():
    """Property: for random bodies of `\r`, `\n` and text, cut at random places, the linear
    splitter yields exactly the old whole-buffer split (`replace("\r\n", "\n").split("\n\n")`),
    empty events aside (an empty event carries no message either way)."""
    import random
    rnd = random.Random(20261103)
    for _ in range(2000):
        body = "".join(rnd.choice(["\r\n", "\n", "a", "b", ":", " ", "\r\n\r\n", "\n\n"])
                       for _ in range(rnd.randint(0, 40)))
        cuts = sorted(rnd.sample(range(len(body) + 1), k=min(len(body) + 1, rnd.randint(0, 8))))
        pieces = [body[i:j] for i, j in zip([0, *cuts], [*cuts, len(body)])]
        splitter = evernote_mcp._SseSplitter()
        got = [e for piece in pieces for e in splitter.feed(piece)] + splitter.finish()
        want = body.replace("\r\n", "\n").split("\n\n")
        assert [e for e in got if e] == [e for e in want if e], (body, pieces)


# --------------------------------------------------------------------------- tool-level rate limit
#
# Live gate 2026-11-03: the owner's first Evernote pass created 75 of 215 notes; the other 140
# failed with `get_note: Rate limit exceeded: "get_note" is being called faster than allowed. Wait
# about 60 second(s)...`. Evernote's hosted MCP server reports its per-minute limit as a TOOL-LEVEL
# error (`isError: true` and that text), not an HTTP 429, so it used to be a final
# `NoteConnUnsupported` and every remaining `get_note` in the pass failed fast.

def _limited(seconds: int | None = 60, tool: str = "get_note") -> dict:
    """Evernote's measured wording (production log 2026-11-03)."""
    text = f'Rate limit exceeded: "{tool}" is being called faster than allowed.'
    if seconds is not None:
        text += f" Wait about {seconds} second(s) before trying again."
    return _ok({}, is_error=True, text=text)


class FakeTime:
    """A clock that only moves when the client sleeps or the fake server says a call took time.
    Nothing ever really sleeps."""

    def __init__(self, t: float = 5000.0) -> None:
        self.t = t
        self.sleeps: list[float] = []

    def clock(self) -> float:
        return self.t

    async def sleep(self, s: float) -> None:
        self.sleeps.append(s)
        self.t += s


def _timed_client(server: Server, ft: FakeTime):
    http = httpx.AsyncClient(transport=httpx.MockTransport(server))
    client = evernote_mcp.EvernoteMcpClient(
        TOKEN, http=http, sleep=ft.sleep, clock=ft.clock, jitter=lambda: 1.0)
    client._test_server = server
    return client


def _wait(seconds: float) -> float:
    return min(seconds, evernote_mcp.MAX_RETRY_AFTER_S) + evernote_mcp.RATE_LIMIT_MARGIN_S


async def test_tool_level_rate_limit_is_retried_after_the_parsed_wait():
    ft = FakeTime()
    n = {"calls": 0}

    def on_call(req, body):
        n["calls"] += 1
        return _limited(42) if n["calls"] == 1 else _ok({"title": "back"})

    client = _timed_client(Server(on_call), ft)
    assert await client.call_tool("get_note", {"noteId": "n1"}) == {"title": "back"}
    assert ft.sleeps == [pytest.approx(_wait(42))]
    calls = client._test_server.calls()
    # The SAME call, retried: same tool, same arguments.
    assert [_rpc(r)["params"] for r in calls] == [
        {"name": "get_note", "arguments": {"noteId": "n1"}}] * 2


@pytest.mark.parametrize("text, waited", [
    ('RATE LIMIT EXCEEDED: "get_note". WAIT ABOUT 9 SECOND(S).', 9),
    ('"get_note" is being called faster than allowed. wait about 12 seconds', 12),
    ("Rate limit exceeded.", None),  # no wait in the text: the default
    ('"search_notes" is Being Called Faster Than Allowed', None),
])
async def test_tool_level_rate_limit_matches_case_insensitively(text, waited):
    ft = FakeTime()
    n = {"calls": 0}

    def on_call(req, body):
        n["calls"] += 1
        return _ok({}, is_error=True, text=text) if n["calls"] == 1 else _ok({"ok": 1})

    client = _timed_client(Server(on_call), ft)
    assert await client.call_tool("get_note", {"noteId": "n1"}) == {"ok": 1}
    expected = waited if waited is not None else evernote_mcp.TOOL_RATE_LIMIT_DEFAULT_WAIT_S
    assert ft.sleeps == [pytest.approx(_wait(expected))]


async def test_tool_level_rate_limit_wait_is_capped():
    ft = FakeTime()
    n = {"calls": 0}

    def on_call(req, body):
        n["calls"] += 1
        return _limited(3600) if n["calls"] == 1 else _ok({})

    client = _timed_client(Server(on_call), ft)
    await client.call_tool("get_note", {"noteId": "n1"})
    assert ft.sleeps == [pytest.approx(
        evernote_mcp.MAX_RETRY_AFTER_S + evernote_mcp.RATE_LIMIT_MARGIN_S)]


async def test_tool_level_rate_limit_retries_are_bounded_then_rate_limited():
    ft = FakeTime()
    client = _timed_client(Server(lambda req, body: _limited(20)), ft)
    with pytest.raises(errors.NoteConnRateLimited) as ei:
        await client.call_tool("get_note", {"noteId": "n1"})
    assert not isinstance(ei.value, errors.NoteConnUnsupported)
    assert ei.value.retry_after == 20.0
    assert ei.value.code == "evernote_tool_rate_limited"
    assert len(client._test_server.calls()) == 1 + evernote_mcp.TOOL_RATE_LIMIT_RETRIES
    waits = [s for s in ft.sleeps if s >= _wait(20) - 0.01]
    assert waits == [pytest.approx(_wait(20))] * evernote_mcp.TOOL_RATE_LIMIT_RETRIES


async def test_a_non_rate_limit_tool_error_is_unchanged():
    ft = FakeTime()
    client = _timed_client(Server(
        lambda req, body: _ok({}, is_error=True, text="Note size limit exceeded for n1")), ft)
    with pytest.raises(errors.NoteConnUnsupported) as ei:
        await client.call_tool("get_note", {"noteId": "n1"})
    assert not isinstance(ei.value, errors.NoteConnRateLimited)
    assert ei.value.code == "evernote_tool_error"
    assert ei.value.reason == "Note size limit exceeded for n1"
    assert len(client._test_server.calls()) == 1  # never retried
    assert ft.sleeps == []
    assert client.call_interval_s == evernote_mcp.MIN_CALL_INTERVAL_S  # pacing untouched


async def test_pacing_engages_only_after_a_rate_limit_trip():
    ft = FakeTime()
    state = {"calls": 0, "trip_at": 31}

    def on_call(req, body):
        state["calls"] += 1
        ft.t += 0.5  # each call takes half a second: well over MIN_CALL_INTERVAL_S
        return _limited(30) if state["calls"] == state["trip_at"] else _ok({"ok": 1})

    client = _timed_client(Server(on_call), ft)
    # A healthy pass: 30 calls, no trip, no pacing sleep at all.
    for i in range(30):
        await client.call_tool("get_note", {"noteId": f"n{i}"})
    assert ft.sleeps == []
    assert client.call_interval_s == evernote_mcp.MIN_CALL_INTERVAL_S

    # Call 31 trips. 31 calls went out in the 60 s before it (15.5 s of them), so the session now
    # paces at ADAPTIVE_RATE_FRACTION of that observed rate: 60 / 31 / 0.8.
    await client.call_tool("get_note", {"noteId": "n30"})
    assert ft.sleeps == [pytest.approx(_wait(30))]
    expected = evernote_mcp.RATE_WINDOW_S / 31 / evernote_mcp.ADAPTIVE_RATE_FRACTION
    assert client.call_interval_s == pytest.approx(expected)

    # Every later call in this session waits out the slower interval (minus the call's own 0.5 s).
    ft.sleeps.clear()
    for i in range(3):
        await client.call_tool("get_note", {"noteId": f"m{i}"})
    assert ft.sleeps == [pytest.approx(expected - 0.5)] * 3

    # A NEW session (a new client: the next pass) starts fast again.
    ft2 = FakeTime()
    fresh = _timed_client(Server(lambda req, body: _ok({"ok": 1})), ft2)
    assert fresh.call_interval_s == evernote_mcp.MIN_CALL_INTERVAL_S


async def test_adaptive_interval_is_bounded_above():
    ft = FakeTime()
    plan = {"calls": 0}

    def on_call(req, body):
        plan["calls"] += 1
        ft.t += 0.1
        return _limited(5) if plan["calls"] in (1, 3) else _ok({})

    client = _timed_client(Server(on_call), ft)
    # One call in the window at the first trip: 60 / 1 / 0.8 = 75 s, clamped to the maximum.
    await client.call_tool("get_note", {"noteId": "a"})
    assert client.call_interval_s == evernote_mcp.ADAPTIVE_MAX_INTERVAL_S
    await client.call_tool("get_note", {"noteId": "b"})  # trips again (call 3)
    assert client.call_interval_s == evernote_mcp.ADAPTIVE_MAX_INTERVAL_S  # never above it


async def test_a_second_trip_doubles_the_interval():
    ft = FakeTime()
    plan = {"calls": 0}

    def on_call(req, body):
        plan["calls"] += 1
        ft.t += 0.1
        # 201 fast calls (0.1 s each), the last one trips; then a trip on the 4th call after.
        return _limited(1) if plan["calls"] in (201, 206) else _ok({})

    client = _timed_client(Server(on_call), ft)
    for i in range(201):
        await client.call_tool("get_note", {"noteId": f"n{i}"})
    first = client.call_interval_s
    assert first == evernote_mcp.ADAPTIVE_MIN_INTERVAL_S  # 60 / 201 / 0.8 = 0.37, floored
    for i in range(4):
        await client.call_tool("get_note", {"noteId": f"m{i}"})
    assert client.call_interval_s == pytest.approx(2 * first)


async def test_the_session_wait_budget_bounds_rate_limit_waiting():
    ft = FakeTime()
    client = _timed_client(Server(lambda req, body: _limited(60)), ft)
    for i in range(20):
        with pytest.raises(errors.NoteConnRateLimited):
            await client.call_tool("get_note", {"noteId": f"n{i}"})
    waited = sum(s for s in ft.sleeps if s >= _wait(60) - 0.01)
    assert 0 < waited <= evernote_mcp.RATE_LIMIT_WAIT_BUDGET_S
    # Once the budget is spent a rate-limited call fails fast: one request, no rate-limit wait.
    before = len(client._test_server.calls())
    ft.sleeps.clear()
    with pytest.raises(errors.NoteConnRateLimited):
        await client.call_tool("get_note", {"noteId": "last"})
    assert len(client._test_server.calls()) == before + 1
    assert all(s < _wait(60) - 0.01 for s in ft.sleeps)


def test_rate_limit_constants():
    assert evernote_mcp.TOOL_RATE_LIMIT_RETRIES == 3
    assert evernote_mcp.TOOL_RATE_LIMIT_DEFAULT_WAIT_S == 60.0
    assert evernote_mcp.RATE_LIMIT_MARGIN_S == 1.0
    assert evernote_mcp.RATE_WINDOW_S == 60.0
    assert evernote_mcp.ADAPTIVE_RATE_FRACTION == 0.8
    assert evernote_mcp.ADAPTIVE_MIN_INTERVAL_S == 1.0
    assert evernote_mcp.ADAPTIVE_MAX_INTERVAL_S == 10.0
    assert evernote_mcp.RATE_LIMIT_WAIT_BUDGET_S == 600.0


async def test_only_calls_inside_the_window_set_the_adaptive_interval():
    ft = FakeTime()
    plan = {"calls": 0}

    def on_call(req, body):
        plan["calls"] += 1
        ft.t += 0.1
        return _limited(1) if plan["calls"] == 130 else _ok({})

    client = _timed_client(Server(on_call), ft)
    for i in range(100):
        await client.call_tool("get_note", {"noteId": f"old{i}"})
    ft.t += 120.0  # those 100 calls are now outside the 60 s window
    for i in range(30):
        await client.call_tool("get_note", {"noteId": f"new{i}"})
    # 30 calls in the window (not 130): 60 / 30 / 0.8 = 2.5 s.
    assert client.call_interval_s == pytest.approx(2.5)
