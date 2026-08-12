"""Tests for the Craft provider — `note_connectors.providers.craft`.

No live calls anywhere: every provider test builds an `httpx.AsyncClient` on
`httpx.MockTransport`, so a request only ever reaches the in-process handler
function defined in each test. `pytest.ini`'s `asyncio_mode = auto` means the
`async def test_*` functions below need no explicit marker.

The four required cases from the task brief:
  1. fixture list+blocks -> a correct `RemoteNote` (title/doc/folder).
  2. modified-since filter applied WITH the 1h overlap.
  3. bad token -> `NoteConnAuthError`.
  4. rate limiter actually engaged — proven via an injectable-clock
     `AsyncRateLimiter` (a fake clock/sleep, not a real wall-clock wait).

Plus the pasted-URL normalization cases (`parse_capability_url`) and the
self-review points named in the brief: empty `documents` array is NOT an
error, `validate()`'s `/connection` -> `/documents` fallback, folder
resolution, `fetch_media` sends the Bearer header, and the defensive
nextCursor-follow / fetch-without-prior-list_changed paths.

Also covers the code-review fix pass (2026-08-12):
  - CRITICAL: `fetch_media` must NOT send the Bearer to an attacker-controlled
    host smuggled into a document's markdown — only `connect.craft.do`/
    `*.craft.do` gets the credential; any other https host is fetched with NO
    auth headers; a non-https ref is refused outright with no request sent.
  - IMPORTANT: a 200-JSON response to a markdown `GET /blocks` call must raise
    loudly (`NoteConnTransient`) rather than silently becoming the note body.
  - minors: case-insensitive HOST matching in `parse_capability_url` (path
    stays case-sensitive) + a bounded/cycle-guarded defensive pagination loop.
"""

from __future__ import annotations

import httpx
import pytest

from api.services.journal_two.broker.rate_limit import AsyncRateLimiter
from api.services.journal_two.note_connectors.errors import (
    NoteConnAuthError,
    NoteConnRateLimited,
    NoteConnTransient,
    NoteConnUnsupported,
)
from api.services.journal_two.note_connectors.providers.base import RemoteRef
from api.services.journal_two.note_connectors.providers.craft import (
    CraftProvider,
    parse_capability_url,
)

LINK_ID = "abc123XYZ"
BASE_URL = f"https://connect.craft.do/links/{LINK_ID}/api/v1"
BEARER = "craft-bearer-key-secret"
CREDS = {"capabilityUrl": BASE_URL, "bearer": BEARER}

DOC_1 = "doc-1-id"
DOC_2 = "doc-2-id"
FOLDER_1 = "folder-1-id"

DOC_1_MD = "# Trading Notes\n\nReview ![chart](https://cdn.craft.do/assets/chart.png) before open.\n"
DOC_2_MD = "# Setup Library\n\nFlat doc, no folder.\n"

DOCUMENTS_PAYLOAD = {
    "documents": [
        {
            "id": DOC_1,
            "title": "Trading Notes",
            "folderId": FOLDER_1,
            "createdDate": "2026-08-01T00:00:00Z",
            "lastModifiedDate": "2026-08-10T12:00:00Z",
        },
        {
            "id": DOC_2,
            "title": "Setup Library",
            "createdDate": "2026-08-02T00:00:00Z",
            "lastModifiedDate": "2026-08-05T09:00:00Z",
        },
    ],
}

FOLDERS_PAYLOAD = {"folders": [{"id": FOLDER_1, "name": "Trading"}]}


def _blocks_for(doc_id: str) -> str:
    return {DOC_1: DOC_1_MD, DOC_2: DOC_2_MD}[doc_id]


def _default_handler(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path.endswith("/connection"):
        return httpx.Response(200, json={"name": "My Craft Space"})
    if path.endswith("/folders"):
        return httpx.Response(200, json=FOLDERS_PAYLOAD)
    if path.endswith("/documents"):
        return httpx.Response(200, json=DOCUMENTS_PAYLOAD)
    if path.endswith("/blocks"):
        doc_id = request.url.params.get("id")
        return httpx.Response(200, text=_blocks_for(doc_id))
    return httpx.Response(404)


def _make_provider(handler=_default_handler, rate_limiter=None) -> CraftProvider:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return CraftProvider(client=client, rate_limiter=rate_limiter)


def _find_all(doc, node_type: str) -> list[dict]:
    out = []

    def walk(node):
        if not isinstance(node, dict):
            return
        if node.get("type") == node_type:
            out.append(node)
        for child in node.get("content") or []:
            walk(child)

    walk(doc)
    return out


def _plain_text(node) -> str:
    out = []

    def walk(n):
        if not isinstance(n, dict):
            return
        if n.get("type") == "text":
            out.append(n.get("text", ""))
        for child in n.get("content") or []:
            walk(child)

    walk(node)
    return "".join(out)


# ---------------------------------------------------------------------------
# 1. list+blocks fixture -> correct RemoteNotes (title/doc/folder)
# ---------------------------------------------------------------------------


async def test_list_changed_and_fetch_produce_correct_remote_notes():
    provider = _make_provider()

    refs = await provider.list_changed(CREDS)
    assert {r.remote_id for r in refs} == {DOC_1, DOC_2}
    ref_by_id = {r.remote_id: r for r in refs}
    assert ref_by_id[DOC_1].updated_at == "2026-08-10T12:00:00Z"

    note1 = await provider.fetch(CREDS, ref_by_id[DOC_1])
    assert note1.remote_id == DOC_1
    assert note1.title == "Trading Notes"
    assert note1.folder_path == ["Trading"]  # resolved via GET /folders
    assert note1.created_at == "2026-08-01T00:00:00Z"
    assert note1.updated_at == "2026-08-10T12:00:00Z"
    headings = _find_all(note1.doc, "heading")
    assert any("Trading Notes" in _plain_text(h) for h in headings)
    images = _find_all(note1.doc, "image")
    assert len(images) == 1
    assert images[0]["attrs"]["src"].startswith("import-ref://")
    assert note1.media == [
        {"ref": "https://cdn.craft.do/assets/chart.png", "kind": "image", "name": "chart.png"}
    ]

    note2 = await provider.fetch(CREDS, ref_by_id[DOC_2])
    assert note2.title == "Setup Library"
    assert note2.folder_path == []  # no folderId on doc 2 -> flat


def test_import_key_matches_craft_link_id_doc_id_format():
    provider = CraftProvider()
    assert provider.import_key(LINK_ID, DOC_1) == f"craft:{LINK_ID}/{DOC_1}"


async def test_fetch_without_prior_list_changed_rebuilds_metadata_defensively():
    provider = _make_provider()
    note = await provider.fetch(CREDS, RemoteRef(remote_id=DOC_1, updated_at="whatever"))
    assert note.title == "Trading Notes"
    assert note.folder_path == ["Trading"]


async def test_empty_documents_array_is_not_an_error():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/folders"):
            return httpx.Response(404)  # this space has no folders either
        if request.url.path.endswith("/documents"):
            return httpx.Response(200, json={"documents": []})
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    assert refs == []  # empty, not raised


# ---------------------------------------------------------------------------
# 2. modified-since filter applied WITH the 1h overlap
# ---------------------------------------------------------------------------


async def test_incremental_list_changed_applies_one_hour_overlap():
    seen_params: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/folders"):
            return httpx.Response(200, json=FOLDERS_PAYLOAD)
        if path.endswith("/documents"):
            seen_params.update(dict(request.url.params))
            return httpx.Response(200, json=DOCUMENTS_PAYLOAD)
        return httpx.Response(404)

    provider = _make_provider(handler)
    cursor = "2026-08-10T12:00:00+00:00"
    await provider.list_changed(CREDS, cursor=cursor)

    assert seen_params["fetchMetadata"] == "true"
    # 1h EARLIER than the cursor, not the cursor itself.
    assert seen_params["lastModifiedDateGte"] == "2026-08-10T11:00:00+00:00"


async def test_no_cursor_means_full_pull_with_no_gte_param():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/folders"):
            return httpx.Response(200, json=FOLDERS_PAYLOAD)
        if request.url.path.endswith("/documents"):
            seen["params"] = dict(request.url.params)
            return httpx.Response(200, json=DOCUMENTS_PAYLOAD)
        return httpx.Response(404)

    provider = _make_provider(handler)
    await provider.list_changed(CREDS, cursor=None)
    assert "lastModifiedDateGte" not in seen["params"]
    assert seen["params"]["fetchMetadata"] == "true"


async def test_list_changed_follows_a_defensive_next_cursor():
    """No documented pagination exists, but IF a response ever carries a
    nextCursor-shaped field, list_changed must follow it rather than
    silently truncating the listing."""
    page_2_url = f"{BASE_URL}/documents?page=2"

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/folders"):
            return httpx.Response(200, json=FOLDERS_PAYLOAD)
        if str(request.url) == page_2_url:
            return httpx.Response(200, json={"documents": [{"id": DOC_2, "title": "Page 2 doc"}]})
        if path.endswith("/documents"):
            return httpx.Response(
                200,
                json={"documents": [{"id": DOC_1, "title": "Page 1 doc"}], "nextCursor": page_2_url},
            )
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    assert {r.remote_id for r in refs} == {DOC_1, DOC_2}


# ---------------------------------------------------------------------------
# 3. bad token -> NoteConnAuthError
# ---------------------------------------------------------------------------


async def test_bad_token_raises_auth_error_on_validate():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "invalid token"})

    provider = _make_provider(handler)
    with pytest.raises(NoteConnAuthError):
        await provider.validate(CREDS)


async def test_bad_token_raises_auth_error_on_list_changed():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/folders"):
            return httpx.Response(401)
        return httpx.Response(403, json={"error": "forbidden"})

    provider = _make_provider(handler)
    with pytest.raises(NoteConnAuthError):
        await provider.list_changed(CREDS)


async def test_rate_limited_raises_note_conn_rate_limited():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"retry-after": "12"})

    provider = _make_provider(handler)
    with pytest.raises(NoteConnRateLimited) as exc_info:
        await provider.validate(CREDS)
    assert exc_info.value.retry_after == 12.0


async def test_server_error_raises_transient():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    provider = _make_provider(handler)
    with pytest.raises(NoteConnTransient):
        await provider.validate(CREDS)


# ---------------------------------------------------------------------------
# validate(): GET /connection -> fallback GET /documents probe
# ---------------------------------------------------------------------------


async def test_validate_uses_connection_endpoint_when_available():
    provider = _make_provider()
    info = await provider.validate(CREDS)
    assert info.label == "My Craft Space"


async def test_validate_falls_back_to_documents_probe_when_connection_404s():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/connection"):
            return httpx.Response(404)
        if path.endswith("/documents"):
            assert request.url.params.get("fetchMetadata") == "true"
            return httpx.Response(200, json=DOCUMENTS_PAYLOAD)
        return httpx.Response(404)

    provider = _make_provider(handler)
    info = await provider.validate(CREDS)
    assert LINK_ID in info.label
    assert info.raw == {"document_count": 2}


async def test_validate_raises_auth_error_when_both_endpoints_404():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    provider = _make_provider(handler)
    with pytest.raises(NoteConnAuthError):
        await provider.validate(CREDS)


# ---------------------------------------------------------------------------
# 4. rate limiter actually engaged (injectable clock/sleep)
# ---------------------------------------------------------------------------


async def test_rate_limiter_is_invoked_on_every_outbound_request():
    """Proves `acquire()` actually gates each HTTP call, not merely that a
    limiter object exists: capacity=1 with a FAKE clock that never advances
    forces every request past the first to hit `sleep`, and we assert sleep
    fired the expected number of times (a spy, not a real wall-clock wait)."""
    sleep_calls: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleep_calls.append(seconds)

    # Clock frozen at a constant -> capacity never refills, so every request
    # beyond the first must wait (and re-check) instead of firing instantly.
    # We break the "wait forever" loop by having sleep ADVANCE the clock by
    # a full second once, which is enough headroom (rate=3/s) for the next
    # acquire() to succeed on its re-check.
    clock_time = [1000.0]

    def fake_clock() -> float:
        return clock_time[0]

    async def advancing_sleep(seconds: float) -> None:
        sleep_calls.append(seconds)
        clock_time[0] += 1.0

    limiter = AsyncRateLimiter(3.0, capacity=1.0, clock=fake_clock, sleep=advancing_sleep)
    provider = _make_provider(rate_limiter=limiter)

    await provider.list_changed(CREDS)  # >= 2 requests (folders + documents)

    assert sleep_calls, "expected the rate limiter to actually throttle a request"


async def test_rate_limiter_not_invoked_beyond_capacity_when_under_it():
    """Control for the test above: a generously-capacitied limiter never
    sleeps, proving the previous test's sleeps came from real contention,
    not from acquire() sleeping unconditionally."""
    sleep_calls: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleep_calls.append(seconds)

    limiter = AsyncRateLimiter(3.0, capacity=10.0, clock=lambda: 1000.0, sleep=fake_sleep)
    provider = _make_provider(rate_limiter=limiter)

    await provider.list_changed(CREDS)

    assert sleep_calls == []
    assert limiter.available_tokens < 10.0  # tokens WERE consumed


# ---------------------------------------------------------------------------
# fetch_media — Bearer-authenticated download, but ONLY to a trusted Craft
# host. This is the CRITICAL fix: a media `ref` comes from DOCUMENT CONTENT
# (mddoc registers the raw image `src` as the ref), not from Craft itself —
# an attacker who gets a foreign URL into a synced note's markdown must never
# receive our token.
# ---------------------------------------------------------------------------


async def test_fetch_media_attaches_bearer_for_the_connect_craft_do_host():
    seen_headers = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_headers.update(dict(request.headers))
        return httpx.Response(200, content=b"\x89PNG\r\n", headers={"content-type": "image/png"})

    provider = _make_provider(handler)
    data, content_type = await provider.fetch_media(
        CREDS, f"https://connect.craft.do/links/{LINK_ID}/assets/chart.png",
    )

    assert data == b"\x89PNG\r\n"
    assert content_type == "image/png"
    assert seen_headers.get("authorization") == f"Bearer {BEARER}"


async def test_fetch_media_attaches_bearer_for_a_craft_do_asset_subdomain():
    seen_headers = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_headers.update(dict(request.headers))
        return httpx.Response(200, content=b"\x89PNG\r\n", headers={"content-type": "image/png"})

    provider = _make_provider(handler)
    data, content_type = await provider.fetch_media(CREDS, "https://cdn.craft.do/assets/chart.png")

    assert data == b"\x89PNG\r\n"
    assert content_type == "image/png"
    assert seen_headers.get("authorization") == f"Bearer {BEARER}"


async def test_fetch_media_probe_attacker_host_receives_no_authorization_header():
    """The load-bearing security probe: an attacker-controlled URL smuggled
    into a document's markdown (e.g. via a malicious/compromised note) must
    NEVER receive the Bearer key — captured via the actual outbound request,
    not merely inferred from the response."""
    captured_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(request)
        return httpx.Response(200, content=b"stolen?", headers={"content-type": "image/png"})

    provider = _make_provider(handler)
    data, _content_type = await provider.fetch_media(CREDS, "https://evil.example.com/steal.png")

    assert len(captured_requests) == 1
    assert "authorization" not in {k.lower() for k in captured_requests[0].headers.keys()}
    assert data == b"stolen?"  # the (harmless, unauthenticated) fetch itself still works


async def test_fetch_media_probe_host_suffix_spoof_receives_no_authorization_header():
    """`evilcraft.do` and `craft.do.evil.com`-shaped hosts must not slip past
    the trust check via a naive substring/`in` test."""
    captured_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(request)
        return httpx.Response(200, content=b"x", headers={"content-type": "image/png"})

    provider = _make_provider(handler)
    for spoof_url in (
        "https://evilcraft.do/img.png",
        "https://craft.do.evil.com/img.png",
        "https://connect.craft.do.evil.com/img.png",
    ):
        await provider.fetch_media(CREDS, spoof_url)

    assert len(captured_requests) == 3
    for req in captured_requests:
        assert "authorization" not in {k.lower() for k in req.headers.keys()}


async def test_fetch_media_rejects_non_https_scheme_without_making_a_request():
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(200)

    provider = _make_provider(handler)
    with pytest.raises(NoteConnUnsupported):
        await provider.fetch_media(CREDS, "http://connect.craft.do/links/x/img.png")

    assert request_count == 0, "a non-https ref must be refused before any request is sent"


async def test_fetch_media_failure_raises_transient():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    provider = _make_provider(handler)
    with pytest.raises(NoteConnTransient):
        await provider.fetch_media(CREDS, "https://cdn.craft.do/assets/chart.png")


# ---------------------------------------------------------------------------
# fetch() — a 200-JSON body handed back despite Accept: text/markdown must
# raise loudly rather than silently becoming the note's rendered content.
# ---------------------------------------------------------------------------


async def test_fetch_raises_when_blocks_returns_json_instead_of_markdown():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/folders"):
            return httpx.Response(200, json=FOLDERS_PAYLOAD)
        if request.url.path.endswith("/documents"):
            return httpx.Response(200, json=DOCUMENTS_PAYLOAD)
        if request.url.path.endswith("/blocks"):
            # Craft answers 200 but with a JSON error/unexpected body instead
            # of the requested markdown.
            return httpx.Response(200, json={"error": "unexpected"})
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == DOC_1)

    with pytest.raises(NoteConnTransient, match="non-markdown"):
        await provider.fetch(CREDS, ref)


async def test_fetch_accepts_normal_markdown_response():
    """Control for the guard above: real markdown responses (content-type
    text/plain, body does not parse as JSON) are unaffected."""
    provider = _make_provider()
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == DOC_1)

    note = await provider.fetch(CREDS, ref)
    assert note.title == "Trading Notes"


async def test_fetch_accepts_markdown_that_happens_to_start_with_a_bracket():
    """A markdown doc opening with `[link](url)` starts with `[` too — the
    guard must not flag it just because it LOOKS json-shaped; it must also
    fail to actually PARSE as JSON before raising."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/folders"):
            return httpx.Response(200, json=FOLDERS_PAYLOAD)
        if request.url.path.endswith("/documents"):
            return httpx.Response(200, json=DOCUMENTS_PAYLOAD)
        if request.url.path.endswith("/blocks"):
            return httpx.Response(200, text="[a link](https://example.com) leads a note")
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == DOC_1)

    note = await provider.fetch(CREDS, ref)  # must NOT raise
    assert note.remote_id == DOC_1


# ---------------------------------------------------------------------------
# list_changed — bounded/cycle-guarded defensive pagination
# ---------------------------------------------------------------------------


async def test_list_changed_pagination_cap_stops_a_runaway_next_cursor():
    """No real Craft response is expected to paginate at all, but if a
    future/malformed response kept handing back a NEW nextCursor forever,
    the loop must give up loudly rather than hang."""
    call_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        if request.url.path.endswith("/folders"):
            return httpx.Response(200, json=FOLDERS_PAYLOAD)
        call_count += 1
        next_url = f"{BASE_URL}/documents?page={call_count + 1}"
        return httpx.Response(200, json={"documents": [], "nextCursor": next_url})

    provider = _make_provider(handler)
    with pytest.raises(NoteConnTransient, match="pagination exceeded"):
        await provider.list_changed(CREDS)

    # The cap actually stopped it well short of "forever."
    assert call_count <= 51


async def test_list_changed_pagination_cycle_guard_stops_a_repeated_cursor():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/folders"):
            return httpx.Response(200, json=FOLDERS_PAYLOAD)
        page_2_url = f"{BASE_URL}/documents?page=2"
        if str(request.url) == page_2_url:
            # Cycle: page 2 points back to the already-visited page 1 URL.
            return httpx.Response(
                200, json={"documents": [{"id": DOC_2, "title": "p2"}], "nextCursor": f"{BASE_URL}/documents"},
            )
        if request.url.path.endswith("/documents"):
            return httpx.Response(
                200, json={"documents": [{"id": DOC_1, "title": "p1"}], "nextCursor": page_2_url},
            )
        return httpx.Response(404)

    provider = _make_provider(handler)
    with pytest.raises(NoteConnTransient, match="cycle"):
        await provider.list_changed(CREDS)


# ---------------------------------------------------------------------------
# pasted-URL normalization (parse_capability_url)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw_url",
    [
        f"https://connect.craft.do/links/{LINK_ID}/api/v1",
        f"https://connect.craft.do/links/{LINK_ID}/api/v1/",
        f"https://connect.craft.do/links/{LINK_ID}/api/v1//",
        f"  https://connect.craft.do/links/{LINK_ID}/api/v1  ",
        f"\nhttps://connect.craft.do/links/{LINK_ID}/api/v1\n",
    ],
)
def test_parse_capability_url_tolerates_trailing_slashes_and_whitespace(raw_url):
    base_url, link_id = parse_capability_url(raw_url)
    assert base_url == f"https://connect.craft.do/links/{LINK_ID}/api/v1"
    assert link_id == LINK_ID


@pytest.mark.parametrize(
    "raw_url",
    [
        f"HTTPS://CONNECT.CRAFT.DO/links/{LINK_ID}/api/v1",
        f"https://Connect.Craft.Do/links/{LINK_ID}/api/v1",
        f"https://CONNECT.craft.DO/links/{LINK_ID}/api/v1",
    ],
)
def test_parse_capability_url_is_case_insensitive_on_host_only(raw_url):
    """The HOST normalizes regardless of casing, but the `{LINK_ID}` PATH
    segment is preserved byte-for-byte — Craft link ids may be
    case-significant, so lowercasing the whole URL would corrupt one."""
    base_url, link_id = parse_capability_url(raw_url)
    assert base_url == f"https://connect.craft.do/links/{LINK_ID}/api/v1"
    assert link_id == LINK_ID  # exact case preserved, NOT lowercased


@pytest.mark.parametrize(
    "raw_url",
    [
        "",
        None,
        "not a url at all",
        "https://evil.com/links/abc123/api/v1",  # wrong host
        "http://connect.craft.do/links/abc123/api/v1",  # http, not https
        "https://connect.craft.do/links/abc123",  # missing /api/v1
        "https://connect.craft.do/api/v1",  # missing /links/{id}
        "https://connect.craft.do.evil.com/links/abc123/api/v1",  # host suffix trick
        "https://connect.craft.do/links/abc123/api/v1/documents",  # extra path segment
    ],
)
def test_parse_capability_url_rejects_bad_urls_with_exact_message(raw_url):
    with pytest.raises(NoteConnAuthError, match=r"that doesn't look like a Craft API URL"):
        parse_capability_url(raw_url)


def test_creds_raises_auth_error_when_capability_url_or_bearer_missing():
    provider = CraftProvider()
    with pytest.raises(NoteConnAuthError):
        provider._creds({"bearer": BEARER})
    with pytest.raises(NoteConnAuthError):
        provider._creds({"capabilityUrl": BASE_URL})
