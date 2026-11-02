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

    def __init__(self, on_call=None, *, session_id: str | None = SESSION):
        self.requests: list[httpx.Request] = []
        self.on_call = on_call or (lambda req, body: _ok({"ok": True}))
        self.session_id = session_id
        self.inits = 0

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        body = _rpc(req)
        method = body.get("method")
        if method == "initialize":
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
    for name in ("semantic_search", "not_a_tool", ""):
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
