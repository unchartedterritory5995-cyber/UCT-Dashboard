"""Tests for the OneDrive delta-sync provider —
`note_connectors.providers.onedrive` (+ its shared base,
`note_connectors.providers.msgraph_base`).

No live calls anywhere: every test builds an `httpx.AsyncClient` on
`httpx.MockTransport`, so a request only ever reaches the in-process handler
function defined in each test. `pytest.ini`'s `asyncio_mode = auto` means the
`async def test_*` functions below need no explicit marker.

The task-2 brief's required areas:
  1. delta drain: `@odata.nextLink` pagination aggregates across pages, and
     the FINAL page's `@odata.deltaLink` is published as `opaque_cursor`.
  2. a second `list_changed(cursor=<deltaLink>)` call continues from exactly
     that URL (no re-derivation).
  3. the per-tick page BUDGET (`MSGRAPH_ONEDRIVE_PAGES_PER_TICK`) publishes
     the interim `@odata.nextLink` when hit mid-drain, not the deltaLink.
  4. a `"deleted"`-faceted item is excluded from `list_changed`'s refs and
     exposed via `list_deleted()` instead (the engine's full-pass channel).
  5. `410 Gone` on a stored cursor -> a full re-list from the folder root,
     never a crash.
  6. folder scoping: `list_changed` hits `/me/drive/items/{folderId}/delta`
     for exactly the folder id the provider was constructed with.
  7. content download follows the `/content` endpoint's `302` to the
     pre-authenticated URL WITH NO `Authorization` header on that second hop
     (the credential-boundary regression) — the first (Graph) hop IS
     authenticated.
  8. extension routing: `.md`/`.html`/`.txt` -> the matching shared
     converter; `.docx` -> a NAMED `NoteConnUnsupported` (never silently
     dropped from enumeration).
  9. `429` retries, both with and without `Retry-After`, eventually succeed.
  10. a rejected token -> `NoteConnAuthError`.

Plus: relative media/attachment resolution against the delta-enumerated item
index (Dropbox's approach, adapted for Graph's id-addressed items), the
folder picker, and `import_key`'s base-default shape.
"""

from __future__ import annotations

import httpx
import pytest

from api.services.journal_two.note_connectors.convert import html_to_tiptap, md_to_tiptap, txt_to_tiptap
from api.services.journal_two.note_connectors.errors import (
    NoteConnAuthError,
    NoteConnTokenExpired,
    NoteConnTransient,
    NoteConnUnsupported,
)
from api.services.journal_two.note_connectors.providers.base import AccountInfo
from api.services.journal_two.note_connectors.providers.msgraph_base import GRAPH_API_BASE
from api.services.journal_two.note_connectors.providers.onedrive import OneDriveProvider
from api.services.journal_two.notes import _MAX_FILE_BYTES

ACCESS_TOKEN = "graph-access-token-abc"
FOLDER_ID = "FOLDER-ID-1"
CREDS = {"accessToken": ACCESS_TOKEN}

# ---------------------------------------------------------------------------
# Fixture content for the "comprehensive full listing" used by most
# fetch/relative-resolution/extension-routing tests.
# ---------------------------------------------------------------------------

PLAIN_MD_TEXT = "# Plain\n\nHello world.\n"
PLAIN_HTML_TEXT = "<p>Hello <b>World</b></p>"
SCRATCH_TXT_TEXT = "line one\nline two\n\nsecond paragraph"
SETUP_MD_TEXT = (
    "# Setup\n\nSee ![chart](../assets/chart.png) for reference.\n\n"
    "Also see [report](../report.docx) for details.\n"
)
PAGE_HTML_TEXT = '<p>Hello</p><img src="assets/chart.png">'
CHART_PNG_BYTES = b"\x89PNG\r\n\x1a\n"
DOCX_BYTES = b"PK\x03\x04fake-docx-bytes"

FILE_CONTENTS = {
    "item-plain-md": PLAIN_MD_TEXT.encode("utf-8"),
    "item-plain-html": PLAIN_HTML_TEXT.encode("utf-8"),
    "item-scratch-txt": SCRATCH_TXT_TEXT.encode("utf-8"),
    "item-setup-md": SETUP_MD_TEXT.encode("utf-8"),
    "item-page-html": PAGE_HTML_TEXT.encode("utf-8"),
    "item-chart-png": CHART_PNG_BYTES,
    "item-report-docx": DOCX_BYTES,
}

FULL_LISTING_ITEMS = [
    {
        "id": "item-plain-md", "name": "Plain.md", "file": {"mimeType": "text/markdown"},
        "lastModifiedDateTime": "2026-08-01T00:00:00Z", "createdDateTime": "2026-07-01T00:00:00Z",
        "parentReference": {"id": FOLDER_ID},
    },
    {
        "id": "item-plain-html", "name": "plain.html", "file": {"mimeType": "text/html"},
        "lastModifiedDateTime": "2026-08-01T00:00:00Z", "createdDateTime": "2026-07-01T00:00:00Z",
        "parentReference": {"id": FOLDER_ID},
    },
    {
        "id": "item-scratch-txt", "name": "scratch.txt", "file": {"mimeType": "text/plain"},
        "lastModifiedDateTime": "2026-08-01T00:00:00Z", "createdDateTime": "2026-07-01T00:00:00Z",
        "parentReference": {"id": FOLDER_ID},
    },
    {
        "id": "item-report-docx", "name": "report.docx",
        "file": {"mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
        "lastModifiedDateTime": "2026-08-01T00:00:00Z", "createdDateTime": "2026-07-01T00:00:00Z",
        "parentReference": {"id": FOLDER_ID},
    },
    {
        "id": "item-sub", "name": "sub", "folder": {"childCount": 1},
        "lastModifiedDateTime": "2026-08-01T00:00:00Z", "parentReference": {"id": FOLDER_ID},
    },
    {
        "id": "item-setup-md", "name": "Setup.md", "file": {"mimeType": "text/markdown"},
        "lastModifiedDateTime": "2026-08-02T00:00:00Z", "createdDateTime": "2026-07-02T00:00:00Z",
        "parentReference": {"id": "item-sub"},
    },
    {
        "id": "item-assets", "name": "assets", "folder": {"childCount": 1},
        "lastModifiedDateTime": "2026-08-01T00:00:00Z", "parentReference": {"id": FOLDER_ID},
    },
    {
        "id": "item-chart-png", "name": "chart.png", "file": {"mimeType": "image/png"},
        "lastModifiedDateTime": "2026-08-01T00:00:00Z", "parentReference": {"id": "item-assets"},
    },
    {
        "id": "item-page-html", "name": "page.html", "file": {"mimeType": "text/html"},
        "lastModifiedDateTime": "2026-08-01T00:00:00Z", "createdDateTime": "2026-07-01T00:00:00Z",
        "parentReference": {"id": FOLDER_ID},
    },
    {
        "id": "item-old-note", "deleted": {"state": "softDeleted"},
        "lastModifiedDateTime": "2026-08-03T00:00:00Z",
    },
]

DELTA_LINK_FULL = f"{GRAPH_API_BASE}/me/drive/items/{FOLDER_ID}/delta?token=delta-full-1"


def _make_provider(handler, *, sleep_fn=None, rng=None, folder_path=FOLDER_ID) -> OneDriveProvider:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return OneDriveProvider(client=client, sleep_fn=sleep_fn, rng=rng, folder_path=folder_path)


def _full_listing_handler():
    """Handler serving `FULL_LISTING_ITEMS` as a single-page delta round,
    plus a 302-then-unauthenticated-download chain for every item in
    `FILE_CONTENTS`. `auth_seen` records the Authorization header seen on
    EVERY request (keyed `content:{id}` for the Graph `/content` hop,
    `download:{id}` for the pre-authenticated second hop) — the
    credential-boundary regression check. Also asserts INLINE that every
    `graph.microsoft.com` request carries the bearer (never silently
    skipped)."""
    auth_seen: list[tuple[str, str | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        path = request.url.path

        if host == "graph.microsoft.com":
            assert request.headers.get("authorization") == f"Bearer {ACCESS_TOKEN}", (
                "every graph.microsoft.com request must carry the bearer"
            )
            if path == f"/v1.0/me/drive/items/{FOLDER_ID}/delta" and not request.url.query:
                return httpx.Response(
                    200, json={"value": FULL_LISTING_ITEMS, "@odata.deltaLink": DELTA_LINK_FULL},
                )
            if path.startswith("/v1.0/me/drive/items/") and path.endswith("/content"):
                item_id = path[len("/v1.0/me/drive/items/"):-len("/content")]
                auth_seen.append((f"content:{item_id}", request.headers.get("authorization")))
                if item_id in FILE_CONTENTS:
                    return httpx.Response(302, headers={"location": f"https://8.8.8.8/dl/{item_id}"})
                return httpx.Response(404)
            return httpx.Response(404)

        if host == "8.8.8.8":
            item_id = path.rsplit("/", 1)[-1]
            auth_seen.append((f"download:{item_id}", request.headers.get("authorization")))
            content = FILE_CONTENTS.get(item_id)
            if content is None:
                return httpx.Response(404)
            return httpx.Response(200, content=content)

        return httpx.Response(404)

    return handler, auth_seen


async def _synced_provider():
    handler, auth_seen = _full_listing_handler()
    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    return provider, refs, auth_seen


# ---------------------------------------------------------------------------
# Import-inert / construction.
# ---------------------------------------------------------------------------


def test_import_and_bare_construction_never_raises(monkeypatch):
    monkeypatch.delenv("MSGRAPH_CLIENT_ID", raising=False)
    monkeypatch.delenv("MSGRAPH_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("MSGRAPH_ONEDRIVE_PAGES_PER_TICK", raising=False)
    from api.services.journal_two.note_connectors.providers import onedrive as onedrive_module

    provider = onedrive_module.OneDriveProvider()  # zero args -- must not raise, no client built
    assert provider.name == "onedrive"


def test_import_key_default_shape():
    provider = OneDriveProvider()
    assert provider.import_key(FOLDER_ID, "item-plain-md") == f"onedrive:{FOLDER_ID}/item-plain-md"


# ---------------------------------------------------------------------------
# 1-3. Delta drain: nextLink pagination -> deltaLink opaque_cursor; resumes
#      from a stored deltaLink; per-tick budget publishes an interim nextLink.
# ---------------------------------------------------------------------------

DRAIN_ITEM_A = {
    "id": "item-a", "name": "a.md", "file": {}, "lastModifiedDateTime": "2026-08-01T00:00:00Z",
    "parentReference": {"id": FOLDER_ID},
}
DRAIN_ITEM_B = {
    "id": "item-b", "name": "b.md", "file": {}, "lastModifiedDateTime": "2026-08-02T00:00:00Z",
    "parentReference": {"id": FOLDER_ID},
}
DRAIN_ITEM_C = {
    "id": "item-c", "name": "c.md", "file": {}, "lastModifiedDateTime": "2026-08-03T00:00:00Z",
    "parentReference": {"id": FOLDER_ID},
}
DRAIN_ITEM_D = {
    "id": "item-d", "name": "d.md", "file": {}, "lastModifiedDateTime": "2026-08-04T00:00:00Z",
    "parentReference": {"id": FOLDER_ID},
}

_INITIAL_DELTA_URL = f"{GRAPH_API_BASE}/me/drive/items/{FOLDER_ID}/delta"
NEXT_LINK_1 = f"{_INITIAL_DELTA_URL}?token=next-1"
NEXT_LINK_2 = f"{_INITIAL_DELTA_URL}?token=next-2"
DELTA_LINK_1 = f"{_INITIAL_DELTA_URL}?token=delta-1"
DELTA_LINK_2 = f"{_INITIAL_DELTA_URL}?token=delta-2"


def _drain_handler():
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        calls.append(url)
        if url == _INITIAL_DELTA_URL:
            return httpx.Response(200, json={"value": [DRAIN_ITEM_A], "@odata.nextLink": NEXT_LINK_1})
        if url == NEXT_LINK_1:
            return httpx.Response(200, json={"value": [DRAIN_ITEM_B], "@odata.nextLink": NEXT_LINK_2})
        if url == NEXT_LINK_2:
            return httpx.Response(200, json={"value": [DRAIN_ITEM_C], "@odata.deltaLink": DELTA_LINK_1})
        if url == DELTA_LINK_1:
            return httpx.Response(200, json={"value": [DRAIN_ITEM_D], "@odata.deltaLink": DELTA_LINK_2})
        return httpx.Response(404)

    return handler, calls


async def test_delta_drain_nextlink_to_deltalink_publishes_opaque_cursor():
    handler, calls = _drain_handler()
    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    assert [r.remote_id for r in refs] == ["item-a", "item-b", "item-c"]
    assert provider.opaque_cursor == DELTA_LINK_1
    assert calls == [_INITIAL_DELTA_URL, NEXT_LINK_1, NEXT_LINK_2]


async def test_second_call_continues_from_stored_deltalink():
    handler, calls = _drain_handler()
    provider = _make_provider(handler)
    await provider.list_changed(CREDS)
    calls.clear()

    refs2 = await provider.list_changed(CREDS, cursor=DELTA_LINK_1)
    assert calls == [DELTA_LINK_1]
    assert [r.remote_id for r in refs2] == ["item-d"]
    assert provider.opaque_cursor == DELTA_LINK_2


async def test_budget_hit_mid_drain_publishes_interim_nextlink(monkeypatch):
    monkeypatch.setenv("MSGRAPH_ONEDRIVE_PAGES_PER_TICK", "2")
    handler, calls = _drain_handler()
    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    assert [r.remote_id for r in refs] == ["item-a", "item-b"]
    assert provider.opaque_cursor == NEXT_LINK_2  # interim token, NOT the deltaLink
    assert calls == [_INITIAL_DELTA_URL, NEXT_LINK_1]


# ---------------------------------------------------------------------------
# 4. `deleted` facet -> list_deleted(), excluded from list_changed's refs.
# ---------------------------------------------------------------------------


async def test_deleted_facet_exposed_via_list_deleted_and_excluded_from_refs():
    provider, refs, _ = await _synced_provider()
    assert not any(r.remote_id == "item-old-note" for r in refs)
    deleted = await provider.list_deleted(CREDS)
    assert [r.remote_id for r in deleted] == ["item-old-note"]
    assert deleted[0].updated_at == "2026-08-03T00:00:00Z"


# ---------------------------------------------------------------------------
# 5. 410 Gone -> full re-list from the folder root.
# ---------------------------------------------------------------------------


async def test_410_gone_falls_back_to_full_relist_from_root():
    handler, calls = _drain_handler()
    stale_cursor = f"{_INITIAL_DELTA_URL}?token=stale"

    def handler_with_410(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == stale_cursor:
            calls.append(url)
            return httpx.Response(410, json={"error": {"code": "resyncRequired"}})
        return handler(request)

    provider = _make_provider(handler_with_410)
    refs = await provider.list_changed(CREDS, cursor=stale_cursor)

    assert [r.remote_id for r in refs] == ["item-a", "item-b", "item-c"]
    assert provider.opaque_cursor == DELTA_LINK_1
    assert calls[0] == stale_cursor
    assert calls[1] == _INITIAL_DELTA_URL


# ---------------------------------------------------------------------------
# 6. Folder scoping.
# ---------------------------------------------------------------------------


async def test_folder_scoping_hits_items_folder_id_delta():
    captured: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request.url.path)
        return httpx.Response(200, json={"value": [], "@odata.deltaLink": DELTA_LINK_FULL})

    provider = _make_provider(handler, folder_path=FOLDER_ID)
    await provider.list_changed(CREDS)
    assert captured == [f"/v1.0/me/drive/items/{FOLDER_ID}/delta"]

    other_folder = "OTHER-FOLDER-ID"
    captured2: list[str] = []

    def handler2(request: httpx.Request) -> httpx.Response:
        captured2.append(request.url.path)
        return httpx.Response(200, json={"value": [], "@odata.deltaLink": DELTA_LINK_FULL})

    provider2 = _make_provider(handler2, folder_path=other_folder)
    await provider2.list_changed(CREDS)
    assert captured2 == [f"/v1.0/me/drive/items/{other_folder}/delta"]


async def test_missing_folder_raises_auth_error_not_a_crash():
    provider = OneDriveProvider(folder_path=None)
    with pytest.raises(NoteConnAuthError):
        await provider.list_changed(CREDS)


# ---------------------------------------------------------------------------
# 7. Download follows the 302 with NO Authorization on the second hop.
# ---------------------------------------------------------------------------


async def test_download_follows_302_to_unauthenticated_url():
    provider, refs, auth_seen = await _synced_provider()
    ref = next(r for r in refs if r.remote_id == "item-plain-md")
    await provider.fetch(CREDS, ref)

    seen = dict(auth_seen)
    assert seen["content:item-plain-md"] == f"Bearer {ACCESS_TOKEN}"  # first (Graph) hop IS authenticated
    assert seen["download:item-plain-md"] is None  # second (pre-authenticated URL) hop is NOT


async def test_download_streams_and_rejects_an_over_cap_file_via_content_length():
    """Fix-round-1 Important #2: `_download_content` must STREAM the
    download hop with a Content-Length pre-check, never buffer the whole
    body before checking `_MAX_FILE_BYTES` — proven at the OneDrive
    integration level (the shared primitive itself is unit-tested in
    `test_note_connectors_base.py`). A real over-cap body would be huge;
    the mock body stays small but advertises the true size via
    Content-Length, so a bug that reverted to buffer-then-check would still
    raise here (this alone doesn't prove non-buffering) — the primitive-
    level test file is what proves the early-reject/running-total shape;
    this test proves OneDrive's OWN download path is actually WIRED to it."""
    over_cap_size = _MAX_FILE_BYTES + 1

    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        path = request.url.path
        if host == "graph.microsoft.com":
            if path == f"/v1.0/me/drive/items/{FOLDER_ID}/delta" and not request.url.query:
                return httpx.Response(200, json={"value": FULL_LISTING_ITEMS, "@odata.deltaLink": DELTA_LINK_FULL})
            if path == "/v1.0/me/drive/items/item-plain-md/content":
                return httpx.Response(302, headers={"location": "https://8.8.8.8/dl/item-plain-md"})
            return httpx.Response(404)
        if host == "8.8.8.8":
            return httpx.Response(
                200, content=b"x" * 10, headers={"content-length": str(over_cap_size)},
            )
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == "item-plain-md")
    with pytest.raises(NoteConnUnsupported):
        await provider.fetch(CREDS, ref)


# ---------------------------------------------------------------------------
# 8. Extension routing.
# ---------------------------------------------------------------------------


async def test_extension_routing_md_produces_expected_doc():
    provider, refs, _ = await _synced_provider()
    ref = next(r for r in refs if r.remote_id == "item-plain-md")
    note = await provider.fetch(CREDS, ref)
    assert note.doc == md_to_tiptap(PLAIN_MD_TEXT)["doc"]
    assert note.title == "Plain"
    assert note.folder_path == []
    assert note.updated_at == "2026-08-01T00:00:00Z"


async def test_extension_routing_html_produces_expected_doc():
    provider, refs, _ = await _synced_provider()
    ref = next(r for r in refs if r.remote_id == "item-plain-html")
    note = await provider.fetch(CREDS, ref)
    assert note.doc == html_to_tiptap(PLAIN_HTML_TEXT)["doc"]


async def test_extension_routing_txt_produces_expected_doc():
    provider, refs, _ = await _synced_provider()
    ref = next(r for r in refs if r.remote_id == "item-scratch-txt")
    note = await provider.fetch(CREDS, ref)
    assert note.doc == txt_to_tiptap(SCRATCH_TXT_TEXT)["doc"]


async def test_extension_routing_docx_raises_named_unsupported():
    provider, refs, _ = await _synced_provider()
    ref = next(r for r in refs if r.remote_id == "item-report-docx")
    with pytest.raises(NoteConnUnsupported) as exc_info:
        await provider.fetch(CREDS, ref)
    assert str(exc_info.value) == "docx files sync via the file importer, not the OneDrive connector"


async def test_docx_is_enumerated_not_silently_dropped():
    """A NAMED refusal (the test above) requires the item to have been
    CONSIDERED in the first place -- .docx must appear in list_changed's
    refs, never vanish from the folder listing outright."""
    provider, refs, _ = await _synced_provider()
    assert any(r.remote_id == "item-report-docx" for r in refs)


# ---------------------------------------------------------------------------
# Relative media/attachment resolution against the delta-enumerated index.
# ---------------------------------------------------------------------------


def _flatten(node):
    yield node
    for child in node.get("content") or []:
        yield from _flatten(child)


async def test_relative_media_and_attachment_resolve_against_item_index():
    provider, refs, _ = await _synced_provider()
    ref = next(r for r in refs if r.remote_id == "item-setup-md")
    note = await provider.fetch(CREDS, ref)

    assert note.folder_path == ["sub"]

    media_by_ref = {m["ref"]: m for m in note.media}
    assert media_by_ref["od-md-media:item-chart-png"]["kind"] == "image"
    assert media_by_ref["od-md-attach:item-report-docx"]["kind"] == "file"

    nodes = list(_flatten(note.doc))
    image_nodes = [n for n in nodes if n.get("type") == "image"]
    assert any(
        n["attrs"]["src"] == "import-ref://od-md-media:item-chart-png" for n in image_nodes
    )
    chip_nodes = [n for n in nodes if n.get("type") == "attachmentChip"]
    assert any(n["attrs"]["name"] == "report.docx" for n in chip_nodes)

    img_bytes, img_ct = await provider.fetch_media(CREDS, "od-md-media:item-chart-png")
    assert img_bytes == CHART_PNG_BYTES
    assert img_ct == "image/png"

    file_bytes, _file_ct = await provider.fetch_media(CREDS, "od-md-attach:item-report-docx")
    assert file_bytes == DOCX_BYTES


async def test_html_relative_media_resolves_against_item_index():
    provider, refs, _ = await _synced_provider()
    ref = next(r for r in refs if r.remote_id == "item-page-html")
    note = await provider.fetch(CREDS, ref)

    media_refs = {m["ref"] for m in note.media}
    assert "od-html:item-chart-png" in media_refs

    img_bytes, _ct = await provider.fetch_media(CREDS, "od-html:item-chart-png")
    assert img_bytes == CHART_PNG_BYTES


async def test_fetch_media_external_url_is_unauthenticated_and_ssrf_guarded():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "1.1.1.1":
            assert request.headers.get("authorization") is None
            return httpx.Response(200, content=b"external-bytes", headers={"content-type": "image/jpeg"})
        return httpx.Response(404)

    provider = _make_provider(handler)
    data, ct = await provider.fetch_media(CREDS, "https://1.1.1.1/some/image.jpg")
    assert data == b"external-bytes"
    assert ct == "image/jpeg"


async def test_fetch_media_refuses_non_https_external_ref():
    provider = _make_provider(lambda r: httpx.Response(404))
    with pytest.raises(NoteConnUnsupported):
        await provider.fetch_media(CREDS, "http://example.com/insecure.png")


# ---------------------------------------------------------------------------
# 9. 429 with and without Retry-After, both back off then succeed.
# ---------------------------------------------------------------------------


def _me_success_response() -> httpx.Response:
    return httpx.Response(
        200, json={"displayName": "Jordan Trader", "userPrincipalName": "jordan@example.com", "id": "user-1"},
    )


def _make_429_then_success_handler(*, with_retry_after: bool, fail_times: int):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1.0/me":
            calls["n"] += 1
            if calls["n"] <= fail_times:
                headers = {"retry-after": "3"} if with_retry_after else {}
                return httpx.Response(429, headers=headers)
            return _me_success_response()
        return httpx.Response(404)

    return handler, calls


async def test_429_with_retry_after_backs_off_then_succeeds():
    handler, calls = _make_429_then_success_handler(with_retry_after=True, fail_times=2)
    sleeps: list[float] = []

    async def sleep_fn(seconds):
        sleeps.append(seconds)

    provider = _make_provider(handler, sleep_fn=sleep_fn)
    info = await provider.validate(CREDS)

    assert isinstance(info, AccountInfo)
    assert info.label == "Jordan Trader"
    assert sleeps == [3.0, 3.0]  # honors the header verbatim on both retries
    assert calls["n"] == 3


async def test_429_without_retry_after_backs_off_then_succeeds():
    handler, calls = _make_429_then_success_handler(with_retry_after=False, fail_times=2)
    sleeps: list[float] = []

    async def sleep_fn(seconds):
        sleeps.append(seconds)

    provider = _make_provider(handler, sleep_fn=sleep_fn, rng=lambda: 1.0)  # deterministic full-jitter draw
    info = await provider.validate(CREDS)

    assert info.label == "Jordan Trader"
    # attempt 0: capped = min(20, 1*2**0) = 1 -> delay = 1.0*1 = 1.0
    # attempt 1: capped = min(20, 1*2**1) = 2 -> delay = 1.0*2 = 2.0
    assert sleeps == [1.0, 2.0]
    assert calls["n"] == 3


async def test_429_retries_are_bounded_then_raises_rate_limited():
    from api.services.journal_two.note_connectors.errors import NoteConnRateLimited

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429)

    sleeps: list[float] = []

    async def sleep_fn(seconds):
        sleeps.append(seconds)

    provider = _make_provider(handler, sleep_fn=sleep_fn, rng=lambda: 0.5)
    with pytest.raises(NoteConnRateLimited):
        await provider.validate(CREDS)
    assert len(sleeps) == 4  # _RATE_LIMIT_MAX_RETRIES, then gives up


# ---------------------------------------------------------------------------
# 10. Bad token -> NoteConnAuthError (or its TokenExpired subclass).
# ---------------------------------------------------------------------------


async def test_bad_token_raises_auth_error():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1.0/me":
            return httpx.Response(
                401, json={"error": {"code": "InvalidAuthenticationToken", "message": "Access token is empty."}},
            )
        return httpx.Response(404)

    provider = _make_provider(handler)
    with pytest.raises(NoteConnAuthError):
        await provider.validate(CREDS)


async def test_expired_token_raises_token_expired_subclass():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1.0/me":
            return httpx.Response(
                401,
                json={"error": {"code": "InvalidAuthenticationToken", "message": "Access token has expired."}},
            )
        return httpx.Response(404)

    provider = _make_provider(handler)
    with pytest.raises(NoteConnTokenExpired):
        await provider.validate(CREDS)
    # NoteConnTokenExpired subclasses NoteConnAuthError -- existing `except
    # NoteConnAuthError` handling must still catch this.
    with pytest.raises(NoteConnAuthError):
        await provider.validate(CREDS)


# ---------------------------------------------------------------------------
# Folder picker.
# ---------------------------------------------------------------------------


async def test_list_folders_returns_only_folder_faceted_children():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1.0/me/drive/root/children":
            return httpx.Response(200, json={"value": [
                {"id": "item-sub", "name": "sub", "folder": {"childCount": 1}},
                {"id": "item-assets", "name": "assets", "folder": {"childCount": 1}},
                {"id": "item-plain-md", "name": "Plain.md", "file": {}},
            ]})
        return httpx.Response(404)

    provider = _make_provider(handler)
    folders = await provider.list_folders(CREDS)
    assert folders == [
        {"id": "item-sub", "name": "sub"},
        {"id": "item-assets", "name": "assets"},
    ]


async def test_list_folders_nested_hits_items_id_children():
    captured: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request.url.path)
        return httpx.Response(200, json={"value": []})

    provider = _make_provider(handler)
    await provider.list_folders(CREDS, path="item-sub")
    assert captured == ["/v1.0/me/drive/items/item-sub/children"]


# ---------------------------------------------------------------------------
# JSON parsing guards on 2xx responses (Change 1 security hardening).
# ---------------------------------------------------------------------------


async def test_list_changed_non_json_200_response_raises_transient():
    """A 200 response whose body is NOT valid JSON should raise NoteConnTransient,
    not a raw ValueError."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == f"/v1.0/me/drive/items/{FOLDER_ID}/delta":
            # Return a 200 with HTML instead of JSON (e.g., gateway error)
            return httpx.Response(200, text="<html>gateway error</html>")
        return httpx.Response(404)

    provider = _make_provider(handler)
    with pytest.raises(NoteConnTransient) as exc_info:
        await provider.list_changed(CREDS)
    assert "non-JSON success response" in str(exc_info.value)


async def test_list_folders_non_json_200_response_raises_transient():
    """A 200 response whose body is NOT valid JSON in list_folders should raise
    NoteConnTransient."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1.0/me/drive/root/children":
            # Return a 200 with plain text instead of JSON
            return httpx.Response(200, text="not json")
        return httpx.Response(404)

    provider = _make_provider(handler)
    with pytest.raises(NoteConnTransient) as exc_info:
        await provider.list_folders(CREDS)
    assert "non-JSON success response" in str(exc_info.value)
