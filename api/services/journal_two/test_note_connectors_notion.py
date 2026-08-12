"""Tests for the Notion provider — `note_connectors.oauth` +
`note_connectors.providers.notion` + `note_connectors.convert.notion_blocks`.

No live calls anywhere: every HTTP interaction goes through
`httpx.AsyncClient(transport=httpx.MockTransport(handler))`, mirroring
`test_note_connectors_craft.py`'s convention exactly. `pytest.ini`'s
`asyncio_mode = auto` means `async def test_*` needs no explicit marker.

The six required areas from the task brief, each its own section below:
  1. dispatch-table fixture page covering ALL mapped block types (snapshot-
     style structural assertions, not brittle full-equality).
  2. traversal recursion (ONLY where has_children) + pagination
     (children AND search).
  3. token refresh race — two concurrent expired-token calls -> exactly one
     token POST.
  4. incremental sync minute-overlap (stop-at-cursor-2min, early pagination
     stop proven by call-count, not just result filtering).
  5. trash sweep (`list_deleted`) marks deletions.
  6. unconfigured-inert (oauth.py AND providers/notion.py import/construct
     cleanly with no env set).

Plus the self-review items named in the task brief: S3 downloads carry NO
Authorization header (asserted from the CAPTURED request, not inferred);
the refresh lock actually serializes; adjacent bulleted items group into
ONE bulletList.
"""

from __future__ import annotations

import asyncio
import importlib
import json

import httpx
import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import errors
from api.services.journal_two.note_connectors.providers import base as base_module
from api.services.journal_two.note_connectors.providers.base import RemoteRef
from api.services.journal_two.note_connectors.providers.notion import NotionProvider

_API_HOST = "api.notion.com"


# ── small fixture builders ───────────────────────────────────────────────────

def _rt(text: str, *, bold=False, italic=False, strike=False, code=False, href=None) -> dict:
    return {
        "type": "text",
        "text": {"content": text, "link": {"url": href} if href else None},
        "annotations": {
            "bold": bold, "italic": italic, "strikethrough": strike,
            "underline": False, "code": code, "color": "default",
        },
        "plain_text": text,
        "href": href,
    }


def _block(block_id: str, block_type: str, data: dict, *, has_children: bool = False) -> dict:
    return {"object": "block", "id": block_id, "type": block_type, "has_children": has_children, block_type: data}


def _title_prop(text: str) -> dict:
    return {"type": "title", "title": [_rt(text)]}


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


def _all_marks(node, mark_type):
    marks = []

    def walk(n):
        if not isinstance(n, dict):
            return
        for m in n.get("marks") or []:
            if m.get("type") == mark_type:
                marks.append(m)
        for child in n.get("content") or []:
            walk(child)

    walk(node)
    return marks


async def _fake_resolve_host(addrs: list[str]) -> list[str]:
    """Stand-in for `base._resolve_host` -- keeps `assert_public_https`'s
    hostname-resolution branch hermetic (no live DNS lookup, per this
    file's own "no live calls anywhere" module docstring) while still
    exercising its real IP-range check on whatever address list is handed
    in."""
    return addrs


@pytest.fixture(autouse=True)
def _stub_dns_resolution(monkeypatch):
    """Final-review Item D added an SSRF guard (`assert_public_https`) to
    both of this provider's media-download paths (`fetch_media`'s external
    URL, `_get_media_bytes`'s internal S3 url). Neither
    `s3.notion-static.com` nor `cdn.example.com` (this file's fixture
    hostnames) is a real, resolvable domain, so unguarded they'd fail a
    REAL DNS lookup rather than exercising the fixtures' actual HTTP
    behavior through the mocked transport. Autouse rather than per-test
    because the vast majority of this file's ~40 tests touch one of these
    two hostnames somewhere in a page traversal; the dedicated SSRF-refusal
    tests below use literal IPs, which never reach this resolver at all."""
    monkeypatch.setattr(base_module, "_resolve_host", lambda host: _fake_resolve_host(["142.250.0.1"]))


def _make_provider(handler, *, rate_limiter=None, sleep_fn=None) -> NotionProvider:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    if rate_limiter is None:
        # Generous by default so functional tests never hit a real/fake
        # sleep — dedicated rate-limit tests inject a deliberately tight one.
        from api.services.journal_two.broker.rate_limit import AsyncRateLimiter
        rate_limiter = AsyncRateLimiter(1000.0)
    return NotionProvider(client=client, rate_limiter=rate_limiter, sleep_fn=sleep_fn)


TOKEN = "notion-secret-token"
CREDS = {"accessToken": TOKEN, "workspaceName": "My Workspace"}


# ---------------------------------------------------------------------------
# 1. Dispatch-table fixture: ONE page exercising every mapped block type.
# ---------------------------------------------------------------------------

PAGE_ID = "page-root"
CHILD_PAGE_ID = "page-child"
LINK_TARGET_ID = "page-link-target"
SYNCED_ORIGINAL_ID = "block-synced-original"
DB_SMALL_ID = "db-small"
DATA_SOURCE_SMALL_ID = "ds-small"

S3_IMAGE_URL = "https://s3.notion-static.com/internal/image.png?X-Amz-Signature=abc"
S3_VIDEO_URL = "https://s3.notion-static.com/internal/video.mp4?X-Amz-Signature=def"
S3_AUDIO_URL = "https://s3.notion-static.com/internal/memo.mp3?X-Amz-Signature=ghi"
EXTERNAL_IMAGE_URL = "https://cdn.example.com/pic.png"

_PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"fakepngdata"
_MP4_BYTES = b"fakemp4videodata"
_MP3_BYTES = b"fakemp3audiodata"


def _dispatch_children_map() -> dict[str, list[dict]]:
    return {
        PAGE_ID: [
            _block("b-para-1", "paragraph", {"rich_text": [
                _rt("Plain "), _rt("bold", bold=True), _rt(" and "), _rt("code", code=True),
            ]}),
            _block("b-para-children", "paragraph", {"rich_text": [_rt("Parent para")]}, has_children=True),
            _block("b-h1", "heading_1", {"rich_text": [_rt("Overview")]}),
            _block("b-h2-toggle", "heading_2", {
                "rich_text": [_rt("Toggle Heading")], "is_toggleable": True,
            }, has_children=True),
            _block("b-bullet-1", "bulleted_list_item", {"rich_text": [_rt("Bullet one")]}),
            _block("b-bullet-2", "bulleted_list_item", {"rich_text": [_rt("Bullet two")]}),
            _block("b-interrupt", "paragraph", {"rich_text": [_rt("Interrupt paragraph")]}),
            _block("b-num-1", "numbered_list_item", {"rich_text": [_rt("Number one")]}),
            _block("b-num-2", "numbered_list_item", {"rich_text": [_rt("Number two")]}),
            _block("b-todo", "to_do", {"rich_text": [_rt("Buy milk")], "checked": True}),
            _block("b-toggle", "toggle", {"rich_text": [_rt("Toggle title")]}, has_children=True),
            _block("b-callout", "callout", {
                "rich_text": [_rt("Note this")], "icon": {"type": "emoji", "emoji": "\U0001F4A1"},
            }),
            _block("b-quote", "quote", {"rich_text": [_rt("Wise words")]}),
            _block("b-code", "code", {
                "rich_text": [_rt("print('hi')")], "language": "python", "caption": [_rt("sample")],
            }),
            _block("b-divider", "divider", {}),
            _block("b-table", "table", {"table_width": 2, "has_column_header": True}, has_children=True),
            _block(DB_SMALL_ID, "child_database", {"title": "Trades"}),
            _block(CHILD_PAGE_ID, "child_page", {"title": "Child Page Title"}),
            _block("b-link-to-page", "link_to_page", {"type": "page_id", "page_id": LINK_TARGET_ID}),
            _block("b-synced-ref-1", "synced_block", {"synced_from": {"block_id": SYNCED_ORIGINAL_ID}}),
            _block("b-synced-ref-2", "synced_block", {"synced_from": {"block_id": SYNCED_ORIGINAL_ID}}),
            _block("b-column-list", "column_list", {}, has_children=True),
            _block("b-equation", "equation", {"expression": "E=mc^2"}),
            _block("b-image-external", "image", {
                "type": "external", "external": {"url": EXTERNAL_IMAGE_URL}, "caption": [_rt("External pic")],
            }),
            _block("b-image-internal", "image", {"type": "file", "file": {"url": S3_IMAGE_URL}, "caption": []}),
            _block("b-video-internal", "video", {"type": "file", "file": {"url": S3_VIDEO_URL}}),
            _block("b-audio-internal", "audio", {"type": "file", "file": {"url": S3_AUDIO_URL}}),
            _block("b-bookmark", "bookmark", {"url": "https://example.com", "caption": [_rt("Example Site")]}),
            _block("b-toc", "table_of_contents", {}),
            _block("b-breadcrumb", "breadcrumb", {}),
            _block("b-unsupported", "unsupported", {}),
            _block("b-future-type", "audio_stream_v2", {}),
            _block("b-template", "template", {"rich_text": [_rt("Click me")]}),
        ],
        "b-para-children": [_block("b-para-children-child-1", "paragraph", {"rich_text": [_rt("Nested content")]})],
        "b-h2-toggle": [_block("b-h2-toggle-child-1", "paragraph", {"rich_text": [_rt("Hidden under toggle")]})],
        "b-toggle": [_block("b-toggle-child-1", "paragraph", {"rich_text": [_rt("hidden content")]})],
        "b-table": [
            _block("b-table-row-1", "table_row", {"cells": [[_rt("Header A")], [_rt("Header B")]]}),
            _block("b-table-row-2", "table_row", {"cells": [[_rt("Val A")], [_rt("Val B")]]}),
        ],
        SYNCED_ORIGINAL_ID: [_block("b-synced-content", "paragraph", {"rich_text": [_rt("Synced content")]})],
        "b-column-list": [
            _block("b-column-1", "column", {}, has_children=True),
            _block("b-column-2", "column", {}, has_children=True),
        ],
        "b-column-1": [_block("b-col1-para", "paragraph", {"rich_text": [_rt("Column one text")]})],
        "b-column-2": [_block("b-col2-para", "paragraph", {"rich_text": [_rt("Column two text")]})],
    }


_DB_SMALL_ROWS = [
    {"object": "page", "id": "row-1", "properties": {
        "Name": _title_prop("Trade A"), "Status": {"type": "select", "select": {"name": "Open"}},
    }},
    {"object": "page", "id": "row-2", "properties": {
        "Name": _title_prop("Trade B"), "Status": {"type": "select", "select": {"name": "Closed"}},
    }},
]


def _dispatch_handler():
    children_map = _dispatch_children_map()
    call_log: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        call_log.append(request)
        host = request.url.host
        path = request.url.path
        method = request.method

        if host != _API_HOST:
            if str(request.url) == S3_IMAGE_URL:
                return httpx.Response(200, content=_PNG_BYTES, headers={"content-type": "image/png"})
            if str(request.url) == S3_VIDEO_URL:
                return httpx.Response(200, content=_MP4_BYTES, headers={"content-type": "video/mp4"})
            if str(request.url) == S3_AUDIO_URL:
                return httpx.Response(200, content=_MP3_BYTES, headers={"content-type": "audio/mpeg"})
            if str(request.url) == EXTERNAL_IMAGE_URL:
                return httpx.Response(200, content=_PNG_BYTES, headers={"content-type": "image/png"})
            return httpx.Response(404)

        if path == f"/v1/pages/{PAGE_ID}" and method == "GET":
            return httpx.Response(200, json={
                "id": PAGE_ID, "created_time": "2026-08-01T00:00:00.000Z",
                "last_edited_time": "2026-08-10T12:00:00.000Z",
                "properties": {"title": _title_prop("Root Page")},
            })

        if path.startswith("/v1/blocks/") and path.endswith("/children") and method == "GET":
            block_id = path[len("/v1/blocks/"):-len("/children")]
            return httpx.Response(200, json={
                "results": children_map.get(block_id, []), "has_more": False, "next_cursor": None,
            })

        if path == f"/v1/databases/{DB_SMALL_ID}" and method == "GET":
            return httpx.Response(200, json={"data_sources": [{"id": DATA_SOURCE_SMALL_ID}]})

        if path == f"/v1/data_sources/{DATA_SOURCE_SMALL_ID}/query" and method == "POST":
            return httpx.Response(200, json={"results": _DB_SMALL_ROWS, "has_more": False, "next_cursor": None})

        return httpx.Response(404)

    return handler, call_log


async def test_dispatch_table_covers_every_mapped_block_type():
    handler, _log = _dispatch_handler()
    provider = _make_provider(handler)

    note = await provider.fetch(CREDS, RemoteRef(remote_id=PAGE_ID, updated_at="2026-08-10T12:00:00+00:00"))
    doc = note.doc

    assert note.title == "Root Page"

    # paragraph with composed marks
    paras = _find_all(doc, "paragraph")
    plain_para = next(p for p in paras if "Plain " in _plain_text(p))
    assert any(m for t in plain_para["content"] if t.get("text") == "bold" for m in t.get("marks", []) if m["type"] == "bold")

    # paragraph-with-children hoists the child as a sibling paragraph
    assert any(_plain_text(p) == "Nested content" for p in paras)

    # heading_1 (non-toggleable)
    headings = _find_all(doc, "heading")
    h1 = next(h for h in headings if h["attrs"]["level"] == 1)
    assert _plain_text(h1) == "Overview"

    # toggleable heading -> blockquote + bold first line + children
    blockquotes = _find_all(doc, "blockquote")
    toggle_heading_bq = next(bq for bq in blockquotes if "Toggle Heading" in _plain_text(bq))
    first_para = toggle_heading_bq["content"][0]
    assert any(m["type"] == "bold" for t in first_para["content"] for m in t.get("marks", []))
    assert "Hidden under toggle" in _plain_text(toggle_heading_bq)

    # adjacent bulleted items -> ONE bulletList (list grouping, self-review item)
    bullet_lists = _find_all(doc, "bulletList")
    bullet_texts = [_plain_text(bl) for bl in bullet_lists]
    combined_bullet_list = next(bl for bl in bullet_lists if "Bullet one" in _plain_text(bl) and "Bullet two" in _plain_text(bl))
    assert len(combined_bullet_list["content"]) == 2, "adjacent bulleted items must group into ONE bulletList"
    # every OTHER bulletList text is unrelated (proves we didn't just grep — there is exactly one list carrying both)
    assert sum(1 for t in bullet_texts if "Bullet one" in t and "Bullet two" in t) == 1

    # numbered items grouped separately (interrupted by a paragraph in between)
    ordered_lists = _find_all(doc, "orderedList")
    combined_ordered = next(ol for ol in ordered_lists if "Number one" in _plain_text(ol) and "Number two" in _plain_text(ol))
    assert len(combined_ordered["content"]) == 2
    assert combined_ordered["attrs"]["start"] == 1

    # to_do -> taskItem, checked
    task_lists = _find_all(doc, "taskList")
    todo_item = next(ti for tl in task_lists for ti in tl["content"] if "Buy milk" in _plain_text(ti))
    assert todo_item["attrs"]["checked"] is True

    # toggle -> blockquote + bold title + children (self-review: bold FIRST line)
    toggle_bq = next(bq for bq in blockquotes if "Toggle title" in _plain_text(bq))
    assert any(m["type"] == "bold" for t in toggle_bq["content"][0]["content"] for m in t.get("marks", []))
    assert "hidden content" in _plain_text(toggle_bq)

    # callout -> blockquote + bold + emoji prefix
    callout_bq = next(bq for bq in blockquotes if "Note this" in _plain_text(bq))
    assert "\U0001F4A1" in _plain_text(callout_bq)
    assert any(m["type"] == "bold" for t in callout_bq["content"][0]["content"] for m in t.get("marks", []))

    # quote -> blockquote, NOT bold
    quote_bq = next(bq for bq in blockquotes if "Wise words" in _plain_text(bq))
    assert not any(m["type"] == "bold" for t in quote_bq["content"][0]["content"] for m in t.get("marks", []))

    # code + caption
    code_blocks = _find_all(doc, "codeBlock")
    code_node = next(c for c in code_blocks if "print" in _plain_text(c))
    assert code_node["attrs"]["language"] == "python"
    assert any("sample" in _plain_text(p) for p in paras)

    # divider
    assert _find_all(doc, "horizontalRule")

    # table (from the Notion `table` block, WITH header)
    tables = _find_all(doc, "table")
    notion_table = next(t for t in tables if "Header A" in _plain_text(t))
    assert _find_all(notion_table, "tableHeader")
    assert "Val A" in _plain_text(notion_table)

    # child_database (<=50 rows) -> inline table
    db_table = next(t for t in tables if "Trade A" in _plain_text(t))
    assert "Trade B" in _plain_text(db_table)
    assert any("Trades" in _plain_text(h) for h in headings)

    # child_page -> import-link
    child_page_links = _all_marks(doc, "link")
    assert any(
        m["attrs"]["href"] == f"import-link://notion:{CHILD_PAGE_ID}" for m in child_page_links
    )

    # link_to_page -> import-link
    assert any(m["attrs"]["href"] == f"import-link://notion:{LINK_TARGET_ID}" for m in child_page_links)

    # synced_block: TWO references to the same original -> content appears
    # twice but children fetched for the original only ONCE (asserted below)
    assert _plain_text(doc).count("Synced content") == 2

    # column_list -> sequential (both columns' text present, no wrapper node)
    plain_whole = _plain_text(doc)
    assert "Column one text" in plain_whole
    assert "Column two text" in plain_whole

    # equation -> codeBlock-styled text
    assert any(c["attrs"]["language"] is None and "E=mc^2" in _plain_text(c) for c in code_blocks)

    # media: external image deferred (no data_uri), internal image/video/audio
    # downloaded now
    assert len(note.media) == 4  # external image, internal image, internal video, internal audio
    external_entry = next(m for m in note.media if m["ref"] == EXTERNAL_IMAGE_URL)
    assert "data_uri" not in external_entry
    internal_image_entry = next(m for m in note.media if m["ref"] == "notion:b-image-internal")
    assert internal_image_entry["data_uri"].startswith("data:image/png;base64,")
    internal_video_entry = next(m for m in note.media if m["ref"] == "notion:b-video-internal")
    assert internal_video_entry["kind"] == "file"
    internal_audio_entry = next(m for m in note.media if m["ref"] == "notion:b-audio-internal")
    assert internal_audio_entry["kind"] == "file"
    assert internal_audio_entry["data_uri"].startswith("data:audio/mpeg;base64,")
    images = _find_all(doc, "image")
    assert any(i["attrs"]["src"] == f"import-ref://{EXTERNAL_IMAGE_URL}" for i in images)
    assert any(i["attrs"]["src"] == "import-ref://notion:b-image-internal" for i in images)
    attachment_chips = _find_all(doc, "attachmentChip")
    assert any(a["attrs"]["href"] == "import-ref://notion:b-video-internal" for a in attachment_chips)
    assert any(a["attrs"]["href"] == "import-ref://notion:b-audio-internal" for a in attachment_chips), (
        "a real Notion `audio` block must route through the media dispatch table "
        "(attachmentChip), not fall through to a generic unsupported-block marker"
    )
    assert "[unsupported block: audio]" not in plain_whole

    # bookmark -> plain external link (NOT import-link)
    bookmark_marks = [m for m in child_page_links if m["attrs"]["href"] == "https://example.com"]
    assert bookmark_marks

    # table_of_contents / breadcrumb -> silently dropped (no marker, no stray content)
    assert "[unsupported block: table_of_contents]" not in plain_whole
    assert "[unsupported block: breadcrumb]" not in plain_whole

    # unsupported (Notion's own literal type) + unknown future type + template
    # -> ALWAYS a visible marker, never silent
    assert "[unsupported block: unsupported]" in plain_whole
    assert "[unsupported block: audio_stream_v2]" in plain_whole
    assert "[unsupported block: template]" in plain_whole

    # sanity: the whole doc is a valid, size-bounded TipTap doc per the
    # existing note-service validator (best pytest-side proxy available for
    # the JS schema rail — see task report for why the rail itself isn't wired)
    from api.services.journal_two import notes as notes_svc
    validated = notes_svc._validate_body_json(doc)
    assert validated["type"] == "doc"


async def test_synced_block_original_fetched_only_once_across_two_references():
    handler, call_log = _dispatch_handler()
    provider = _make_provider(handler)
    await provider.fetch(CREDS, RemoteRef(remote_id=PAGE_ID, updated_at="x"))

    synced_children_calls = [
        r for r in call_log
        if r.url.path == f"/v1/blocks/{SYNCED_ORIGINAL_ID}/children"
    ]
    assert len(synced_children_calls) == 1, "the original must be resolved ONCE, cached for the second reference"


async def test_synced_block_cycle_is_guarded_not_infinite():
    # top -> resolve original "orig-1" -> its children reference original
    # "orig-2" -> its children reference original "orig-1" again, closing
    # the loop while "orig-1" is STILL being resolved (on the call stack).
    cyclic_children = {
        "page-cycle": [_block("top", "synced_block", {"synced_from": {"block_id": "orig-1"}})],
        "orig-1": [_block("inner-1", "synced_block", {"synced_from": {"block_id": "orig-2"}})],
        "orig-2": [_block("inner-2", "synced_block", {"synced_from": {"block_id": "orig-1"}})],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host != _API_HOST:
            return httpx.Response(404)
        path = request.url.path
        if path == "/v1/pages/page-cycle":
            return httpx.Response(200, json={"id": "page-cycle", "properties": {"title": _title_prop("Cycle")}})
        if path.startswith("/v1/blocks/") and path.endswith("/children"):
            block_id = path[len("/v1/blocks/"):-len("/children")]
            return httpx.Response(200, json={"results": cyclic_children.get(block_id, []), "has_more": False})
        return httpx.Response(404)

    provider = _make_provider(handler)
    # Must complete (not hang/recurse forever) and degrade to a visible marker.
    note = await asyncio.wait_for(
        provider.fetch(CREDS, RemoteRef(remote_id="page-cycle", updated_at="x")), timeout=5,
    )
    assert "cycle detected" in json.dumps(note.doc)


async def test_database_over_fifty_rows_becomes_per_row_pages():
    rows = [
        {
            "object": "page", "id": f"row-{i}",
            "created_time": "2026-08-01T00:00:00.000Z", "last_edited_time": "2026-08-09T00:00:00.000Z",
            "properties": {"Name": _title_prop(f"Row {i}"), "Qty": {"type": "number", "number": i}},
        }
        for i in range(51)
    ]
    row_children = {f"row-{i}": [_block(f"row-{i}-body", "paragraph", {"rich_text": [_rt(f"Body {i}")]})] for i in range(51)}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host != _API_HOST:
            return httpx.Response(404)
        path, method = request.url.path, request.method
        if path == "/v1/pages/page-with-big-db" and method == "GET":
            return httpx.Response(200, json={"id": "page-with-big-db", "properties": {"title": _title_prop("Has Big DB")}})
        if path == "/v1/blocks/page-with-big-db/children" and method == "GET":
            return httpx.Response(200, json={"results": [_block("b-big-db", "child_database", {"title": "Big DB"})], "has_more": False})
        if path == "/v1/databases/db-big" and method == "GET":
            return httpx.Response(200, json={"data_sources": [{"id": "ds-big"}]})
        if path == "/v1/data_sources/ds-big/query" and method == "POST":
            return httpx.Response(200, json={"results": rows, "has_more": False, "next_cursor": None})
        if path.startswith("/v1/blocks/") and path.endswith("/children") and method == "GET":
            block_id = path[len("/v1/blocks/"):-len("/children")]
            if block_id == "b-big-db":
                return httpx.Response(200, json={"results": [], "has_more": False})
            return httpx.Response(200, json={"results": row_children.get(block_id, []), "has_more": False})
        return httpx.Response(404)

    # child_database's block id IS the database id (matching child_page's
    # own precedent, where the block's own id is the real target id) — the
    # earlier stub above used a distinct "b-big-db" id, so patch the top-
    # level children response to use "db-big" directly instead.
    def handler2(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/blocks/page-with-big-db/children" and request.method == "GET":
            return httpx.Response(200, json={"results": [_block("db-big", "child_database", {"title": "Big DB"})], "has_more": False})
        return handler(request)

    provider = _make_provider(handler2)
    notes = await provider.fetch_many(CREDS, [RemoteRef(remote_id="page-with-big-db", updated_at="x")])

    assert len(notes) == 1 + 51, "the parent page + 51 per-row notes"
    parent = notes[0]
    row_notes = notes[1:]
    assert {n.remote_id for n in row_notes} == {f"row-{i}" for i in range(51)}
    sample = next(n for n in row_notes if n.remote_id == "row-0")
    assert sample.title == "Row 0"
    assert "Body 0" in json.dumps(sample.doc)
    assert "Qty: 0" in _plain_text(sample.doc)  # properties preamble (bold label + value, adjacent text nodes)
    # the parent references the overflow rows via import-link, never drops them
    assert f"import-link://notion:row-0" in json.dumps(parent.doc)
    assert "51 rows" in json.dumps(parent.doc)


# ---------------------------------------------------------------------------
# 2. Traversal recursion (ONLY where has_children) + pagination.
# ---------------------------------------------------------------------------

async def test_recursion_happens_only_where_has_children_is_true():
    requested_children_for: list[str] = []

    children_map = {
        "page-r": [
            _block("has-kids", "paragraph", {"rich_text": [_rt("parent")]}, has_children=True),
            _block("no-kids", "paragraph", {"rich_text": [_rt("leaf")]}, has_children=False),
        ],
        "has-kids": [_block("kid-1", "paragraph", {"rich_text": [_rt("child")]})],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host != _API_HOST:
            return httpx.Response(404)
        path, method = request.url.path, request.method
        if path == "/v1/pages/page-r" and method == "GET":
            return httpx.Response(200, json={"id": "page-r", "properties": {"title": _title_prop("R")}})
        if path.startswith("/v1/blocks/") and path.endswith("/children") and method == "GET":
            block_id = path[len("/v1/blocks/"):-len("/children")]
            requested_children_for.append(block_id)
            return httpx.Response(200, json={"results": children_map.get(block_id, []), "has_more": False})
        return httpx.Response(404)

    provider = _make_provider(handler)
    note = await provider.fetch(CREDS, RemoteRef(remote_id="page-r", updated_at="x"))

    assert "page-r" in requested_children_for  # the page's own top-level children
    assert "has-kids" in requested_children_for
    assert "no-kids" not in requested_children_for, "has_children=False must never trigger a children fetch"
    assert "child" in json.dumps(note.doc)


async def test_children_pagination_follows_has_more_and_next_cursor():
    page1 = [_block(f"item-{i}", "paragraph", {"rich_text": [_rt(f"Item {i}")]}) for i in range(3)]
    page2 = [_block(f"item-{i}", "paragraph", {"rich_text": [_rt(f"Item {i}")]}) for i in range(3, 5)]
    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host != _API_HOST:
            return httpx.Response(404)
        path, method = request.url.path, request.method
        if path == "/v1/pages/page-pag" and method == "GET":
            return httpx.Response(200, json={"id": "page-pag", "properties": {"title": _title_prop("Paginated")}})
        if path == "/v1/blocks/page-pag/children" and method == "GET":
            call_count["n"] += 1
            cursor = request.url.params.get("start_cursor")
            if cursor is None:
                return httpx.Response(200, json={"results": page1, "has_more": True, "next_cursor": "cursor-2"})
            assert cursor == "cursor-2"
            return httpx.Response(200, json={"results": page2, "has_more": False, "next_cursor": None})
        return httpx.Response(404)

    provider = _make_provider(handler)
    note = await provider.fetch(CREDS, RemoteRef(remote_id="page-pag", updated_at="x"))

    assert call_count["n"] == 2
    plain = json.dumps(note.doc)
    for i in range(5):
        assert f"Item {i}" in plain


async def test_search_pagination_follows_has_more_and_next_cursor():
    page1 = [{
        "object": "page", "id": "s-1", "in_trash": False, "last_edited_time": "2026-08-10T12:00:00.000Z",
        "properties": {"title": _title_prop("S1")},
    }]
    page2 = [{
        "object": "page", "id": "s-2", "in_trash": False, "last_edited_time": "2026-08-09T12:00:00.000Z",
        "properties": {"title": _title_prop("S2")},
    }]
    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host != _API_HOST or request.url.path != "/v1/search":
            return httpx.Response(404)
        call_count["n"] += 1
        body = json.loads(request.content or b"{}")
        if not body.get("start_cursor"):
            return httpx.Response(200, json={"results": page1, "has_more": True, "next_cursor": "cursor-2"})
        assert body["start_cursor"] == "cursor-2"
        return httpx.Response(200, json={"results": page2, "has_more": False, "next_cursor": None})

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)

    assert call_count["n"] == 2
    assert {r.remote_id for r in refs} == {"s-1", "s-2"}


async def test_children_pagination_exhausting_the_cap_raises_named_transient():
    """A workspace whose block-children pagination never resolves
    `has_more: false` within `_MAX_CHILDREN_PAGES` must fail LOUDLY (a
    named `NoteConnTransient` naming the block id + page count) rather than
    silently returning a truncated block list while the sync reports
    success — the house silent-truncation bug class, mirrored from
    `providers/craft.py`'s own pagination-cap precedent."""
    from api.services.journal_two.note_connectors.providers.notion import _MAX_CHILDREN_PAGES

    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host != _API_HOST:
            return httpx.Response(404)
        path, method = request.url.path, request.method
        if path == "/v1/pages/page-forever" and method == "GET":
            return httpx.Response(200, json={"id": "page-forever", "properties": {"title": _title_prop("F")}})
        if path == "/v1/blocks/page-forever/children" and method == "GET":
            call_count["n"] += 1
            # ALWAYS has_more -> a genuinely runaway/misbehaving workspace.
            return httpx.Response(200, json={
                "results": [_block(f"item-{call_count['n']}", "paragraph", {"rich_text": [_rt("x")]})],
                "has_more": True, "next_cursor": f"cursor-{call_count['n']}",
            })
        return httpx.Response(404)

    provider = _make_provider(handler)
    with pytest.raises(errors.NoteConnTransient, match="pagination exceeded"):
        await provider.fetch(CREDS, RemoteRef(remote_id="page-forever", updated_at="x"))

    assert call_count["n"] == _MAX_CHILDREN_PAGES, "the cap must actually stop it, not merely eventually raise"


# ---------------------------------------------------------------------------
# 3. Token refresh race (oauth.py).
# ---------------------------------------------------------------------------

@pytest.fixture
def db(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("NOTION_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "test-client-secret")
    import api.services.crypto_box as cb
    importlib.reload(cb)
    import api.services.journal_two.note_connectors.connections as conns
    importlib.reload(conns)
    import api.services.journal_two.note_connectors.oauth as oauth_mod
    importlib.reload(oauth_mod)
    # oauth.py holds module-level per-(user,provider) locks; a stale lock
    # object from a PRIOR test's reload would be a different asyncio event
    # loop's lock — reload clears it, matching engine.py's own precedent of
    # module-level lock dicts being test-scoped via reload/monkeypatch.
    oauth_mod._refresh_locks.clear()
    return conns, oauth_mod


def _stored_token(*, expires_in=None, refresh_token="refresh-abc"):
    tok = {"accessToken": "access-1", "refreshToken": refresh_token, "botId": "bot-1"}
    if expires_in is not None:
        from datetime import datetime, timedelta, timezone
        tok["expiresAt"] = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()
    return tok


async def test_two_concurrent_refresh_calls_on_an_expired_token_post_exactly_once(db):
    conns, oauth_mod = db
    conns.upsert_connector("u1", "notion", _stored_token(expires_in=-30))  # already expired

    post_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        post_count["n"] += 1
        assert request.url.host == _API_HOST
        body = json.loads(request.content or b"{}")
        assert body["grant_type"] == "refresh_token"
        assert body["refresh_token"] == "refresh-abc"
        assert request.headers["notion-version"] == oauth_mod.NOTION_VERSION
        return httpx.Response(200, json={
            "access_token": "access-2", "refresh_token": "refresh-def", "bot_id": "bot-1",
        })

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    results = await asyncio.gather(
        oauth_mod.refresh_if_needed("u1", "notion", client=client),
        oauth_mod.refresh_if_needed("u1", "notion", client=client),
    )

    assert post_count["n"] == 1, "concurrent refreshes on the SAME expired token must POST exactly once"
    assert results[0]["accessToken"] == "access-2"
    assert results[1]["accessToken"] == "access-2"
    # persisted for future calls too
    assert conns.get_token("u1", "notion")["accessToken"] == "access-2"
    assert conns.get_token("u1", "notion")["refreshToken"] == "refresh-def"


async def test_refresh_for_different_users_does_not_serialize(db):
    """Fold-in (reviewer probe): the lock is keyed per (user_id, provider) —
    two DIFFERENT users refreshing at the same time must run CONCURRENTLY,
    not queue behind one shared lock. Proven via mutual deadlock rather than
    a wall-clock timing threshold: each handler waits for the OTHER user's
    request to have STARTED before it will return. If the two
    `refresh_if_needed` calls were serialized behind a single lock (e.g. a
    bug keying the lock on provider alone, ignoring user_id), u2's handler
    would never start until u1's whole call — POST included — finished, so
    u1's handler would wait forever for a signal that never comes and the
    outer `asyncio.wait_for` would time out and fail the test."""
    conns, oauth_mod = db
    conns.upsert_connector("u1", "notion", _stored_token(expires_in=-10, refresh_token="r1"))
    conns.upsert_connector("u2", "notion", _stored_token(expires_in=-10, refresh_token="r2"))

    started = {"u1": asyncio.Event(), "u2": asyncio.Event()}

    async def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        who = "u1" if body["refresh_token"] == "r1" else "u2"
        other = "u2" if who == "u1" else "u1"
        started[who].set()
        await asyncio.wait_for(started[other].wait(), timeout=2)
        return httpx.Response(200, json={"access_token": f"access-{who}", "refresh_token": f"{who}-new"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    results = await asyncio.wait_for(
        asyncio.gather(
            oauth_mod.refresh_if_needed("u1", "notion", client=client),
            oauth_mod.refresh_if_needed("u2", "notion", client=client),
        ),
        timeout=5,
    )

    assert results[0]["accessToken"] == "access-u1"
    assert results[1]["accessToken"] == "access-u2"


async def test_refresh_preserves_workspace_fields_when_response_omits_them(db):
    """Fold-in (reviewer probe): a refresh-grant response commonly returns
    only access_token/refresh_token (no workspace_name/workspace_id/
    workspace_icon/bot_id — those were only ever on the INITIAL exchange).
    Since `upsert_connector` REPLACES the whole stored blob, the refreshed
    credential must fall back to whatever was already stored for any field
    the fresh response left out — mirroring the existing refreshToken
    fallback — so a routine refresh can never blank the connected-account
    label the UI shows."""
    conns, oauth_mod = db
    conns.upsert_connector("u1", "notion", {
        "accessToken": "access-1", "refreshToken": "refresh-abc", "botId": "bot-1",
        "workspaceId": "ws-1", "workspaceName": "Acme Trading", "workspaceIcon": "https://icon.example/a.png",
        "expiresAt": _stored_token(expires_in=-10)["expiresAt"],
    })

    def handler(request: httpx.Request) -> httpx.Response:
        # Deliberately omits bot_id/workspace_* -- only the minimal refresh
        # response shape a real provider commonly sends.
        return httpx.Response(200, json={"access_token": "access-2", "refresh_token": "refresh-def"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await oauth_mod.refresh_if_needed("u1", "notion", client=client)

    assert result["accessToken"] == "access-2"  # the fresh value wins
    assert result["botId"] == "bot-1"  # preserved from the prior stored blob
    assert result["workspaceId"] == "ws-1"
    assert result["workspaceName"] == "Acme Trading"
    assert result["workspaceIcon"] == "https://icon.example/a.png"
    # persisted, not just returned -- the NEXT read must also see them
    stored = conns.get_token("u1", "notion")
    assert stored["workspaceName"] == "Acme Trading"
    assert stored["botId"] == "bot-1"


async def test_refresh_not_needed_makes_no_network_call(db):
    conns, oauth_mod = db
    conns.upsert_connector("u1", "notion", _stored_token(expires_in=3600))  # not expired

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("must not make a network call when the token isn't near expiry")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await oauth_mod.refresh_if_needed("u1", "notion", client=client)
    assert result["accessToken"] == "access-1"


async def test_refresh_with_no_expires_at_is_treated_as_non_expiring(db):
    conns, oauth_mod = db
    conns.upsert_connector("u1", "notion", _stored_token())  # no expiresAt at all

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no expiresAt -> treated as non-expiring, no refresh attempted")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await oauth_mod.refresh_if_needed("u1", "notion", client=client)
    assert result["accessToken"] == "access-1"


async def test_refresh_returns_none_when_no_connector_exists(db):
    _conns, oauth_mod = db
    assert await oauth_mod.refresh_if_needed("u1", "notion") is None


async def test_refresh_invalid_grant_raises_token_expired(db):
    conns, oauth_mod = db
    conns.upsert_connector("u1", "notion", _stored_token(expires_in=-10))

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "invalid_grant", "message": "refresh token invalid"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(errors.NoteConnTokenExpired):
        await oauth_mod.refresh_if_needed("u1", "notion", client=client)


# ---------------------------------------------------------------------------
# 4. Incremental sync minute-overlap.
# ---------------------------------------------------------------------------

async def test_incremental_search_stops_at_two_minute_overlap_threshold():
    """cursor=12:05 -> threshold=12:03. A(12:10, newer) and B(12:04, inside
    the overlap window) must be included; C(12:02, older than threshold)
    must be excluded AND must stop pagination before it ever reaches the
    SECOND search page (asserted via call count, not just result filtering
    — proving the early break, not merely post-hoc filtering)."""
    results_page_1 = [
        {"object": "page", "id": "A", "in_trash": False, "last_edited_time": "2026-08-10T12:10:00.000Z",
         "properties": {"title": _title_prop("A")}},
        {"object": "page", "id": "B", "in_trash": False, "last_edited_time": "2026-08-10T12:04:00.000Z",
         "properties": {"title": _title_prop("B")}},
        {"object": "page", "id": "C", "in_trash": False, "last_edited_time": "2026-08-10T12:02:00.000Z",
         "properties": {"title": _title_prop("C")}},
    ]
    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != "/v1/search":
            return httpx.Response(404)
        call_count["n"] += 1
        if call_count["n"] > 1:
            raise AssertionError("must have stopped pagination after hitting the overlap threshold on page 1")
        return httpx.Response(200, json={
            "results": results_page_1, "has_more": True, "next_cursor": "page-2-should-never-be-fetched",
        })

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS, cursor="2026-08-10T12:05:30+00:00")

    assert {r.remote_id for r in refs} == {"A", "B"}
    assert call_count["n"] == 1


async def test_full_sync_with_no_cursor_applies_no_threshold():
    results = [
        {"object": "page", "id": "OLD", "in_trash": False, "last_edited_time": "2020-01-01T00:00:00.000Z",
         "properties": {"title": _title_prop("Old")}},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != "/v1/search":
            return httpx.Response(404)
        return httpx.Response(200, json={"results": results, "has_more": False, "next_cursor": None})

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS, cursor=None)
    assert {r.remote_id for r in refs} == {"OLD"}


# ---------------------------------------------------------------------------
# 5. Trash sweep — list_deleted() marks deletions.
# ---------------------------------------------------------------------------

async def test_list_deleted_returns_only_in_trash_pages():
    results = [
        {"object": "page", "id": "live-1", "in_trash": False, "last_edited_time": "2026-08-10T00:00:00.000Z",
         "properties": {"title": _title_prop("Live")}},
        {"object": "page", "id": "trashed-1", "in_trash": True, "last_edited_time": "2026-08-09T00:00:00.000Z",
         "properties": {"title": _title_prop("Gone 1")}},
        {"object": "page", "id": "trashed-2", "in_trash": True, "last_edited_time": "2026-08-08T00:00:00.000Z",
         "properties": {"title": _title_prop("Gone 2")}},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != "/v1/search":
            return httpx.Response(404)
        return httpx.Response(200, json={"results": results, "has_more": False, "next_cursor": None})

    provider = _make_provider(handler)

    deleted = await provider.list_deleted(CREDS)
    assert {r.remote_id for r in deleted} == {"trashed-1", "trashed-2"}

    changed = await provider.list_changed(CREDS)
    assert {r.remote_id for r in changed} == {"live-1"}, "list_changed must exclude in_trash pages"


# ---------------------------------------------------------------------------
# 6. Unconfigured-inert.
# ---------------------------------------------------------------------------

def test_providers_notion_module_imports_and_constructs_with_no_env(monkeypatch):
    monkeypatch.delenv("NOTION_CLIENT_ID", raising=False)
    monkeypatch.delenv("NOTION_CLIENT_SECRET", raising=False)
    import api.services.journal_two.note_connectors.providers.notion as notion_mod
    importlib.reload(notion_mod)  # must not raise
    provider = notion_mod.NotionProvider()  # must not raise
    assert provider.name == "notion"


def test_oauth_module_imports_cleanly_with_no_env(monkeypatch):
    monkeypatch.delenv("NOTION_CLIENT_ID", raising=False)
    monkeypatch.delenv("NOTION_CLIENT_SECRET", raising=False)
    import api.services.journal_two.note_connectors.oauth as oauth_mod
    importlib.reload(oauth_mod)  # must not raise
    assert oauth_mod.configured("notion") is False


def test_authorize_url_raises_not_configured_when_env_missing(monkeypatch):
    monkeypatch.delenv("NOTION_CLIENT_ID", raising=False)
    monkeypatch.delenv("NOTION_CLIENT_SECRET", raising=False)
    from api.services.journal_two.note_connectors import oauth as oauth_mod
    with pytest.raises(errors.NoteConnNotConfigured):
        oauth_mod.authorize_url("notion", "some-state")


async def test_exchange_code_raises_not_configured_when_env_missing(monkeypatch):
    monkeypatch.delenv("NOTION_CLIENT_ID", raising=False)
    monkeypatch.delenv("NOTION_CLIENT_SECRET", raising=False)
    from api.services.journal_two.note_connectors import oauth as oauth_mod
    with pytest.raises(errors.NoteConnNotConfigured):
        await oauth_mod.exchange_code("notion", "some-code")


async def test_refresh_if_needed_raises_not_configured_when_env_missing_but_connector_exists(db, monkeypatch):
    conns, oauth_mod = db
    conns.upsert_connector("u1", "notion", _stored_token(expires_in=-10))
    monkeypatch.delenv("NOTION_CLIENT_ID", raising=False)
    monkeypatch.delenv("NOTION_CLIENT_SECRET", raising=False)
    with pytest.raises(errors.NoteConnNotConfigured):
        await oauth_mod.refresh_if_needed("u1", "notion")


def test_configured_true_once_both_env_vars_are_set(monkeypatch):
    monkeypatch.setenv("NOTION_CLIENT_ID", "x")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "y")
    from api.services.journal_two.note_connectors import oauth as oauth_mod
    assert oauth_mod.configured("notion") is True
    assert oauth_mod.configured("dropbox") is False  # not registered by this task
    assert oauth_mod.configured("unknown-provider") is False


# ---------------------------------------------------------------------------
# OAuth mechanics: authorize_url shape, exchange_code, headers.
# ---------------------------------------------------------------------------

def test_authorize_url_shape(monkeypatch):
    monkeypatch.setenv("NOTION_CLIENT_ID", "the-client-id")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "the-secret")
    monkeypatch.setenv("DASHBOARD_URL", "https://example.test")
    from api.services.journal_two.note_connectors import oauth as oauth_mod
    url = oauth_mod.authorize_url("notion", "signed-state-xyz")
    assert url.startswith("https://api.notion.com/v1/oauth/authorize?")
    assert "client_id=the-client-id" in url
    assert "state=signed-state-xyz" in url
    assert "response_type=code" in url
    from urllib.parse import unquote
    assert unquote(url).count(
        "redirect_uri=https://example.test/api/j2/notes/connectors/notion/callback"
    ) == 1


async def test_exchange_code_happy_path_uses_basic_auth_and_notion_version(monkeypatch):
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    from api.services.journal_two.note_connectors import oauth as oauth_mod
    import base64 as b64mod

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        seen["notion_version"] = request.headers.get("notion-version")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={
            "access_token": "tok-1", "refresh_token": "ref-1", "bot_id": "bot-1",
            "workspace_name": "Acme", "workspace_id": "ws-1",
        })

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    creds = await oauth_mod.exchange_code("notion", "auth-code-1", client=client)

    expected_basic = "Basic " + b64mod.b64encode(b"cid:csecret").decode()
    assert seen["auth"] == expected_basic
    assert seen["notion_version"] == oauth_mod.NOTION_VERSION
    assert seen["body"]["grant_type"] == "authorization_code"
    assert seen["body"]["code"] == "auth-code-1"
    assert creds == {
        "accessToken": "tok-1", "refreshToken": "ref-1", "botId": "bot-1",
        "workspaceId": "ws-1", "workspaceName": "Acme",
    }


async def test_exchange_code_bad_code_raises_auth_error(monkeypatch):
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    from api.services.journal_two.note_connectors import oauth as oauth_mod

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "invalid_grant", "message": "bad code"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(errors.NoteConnAuthError):
        await oauth_mod.exchange_code("notion", "bad-code", client=client)


# ---------------------------------------------------------------------------
# Credential boundary: media downloads carry NO Authorization header, and
# never touch the Notion token — proven from the CAPTURED request.
# ---------------------------------------------------------------------------

async def test_internal_media_download_carries_no_auth_header_and_becomes_data_uri():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        if request.url.host == _API_HOST:
            if request.url.path == "/v1/pages/page-m" and request.method == "GET":
                return httpx.Response(200, json={"id": "page-m", "properties": {"title": _title_prop("M")}})
            if request.url.path == "/v1/blocks/page-m/children" and request.method == "GET":
                return httpx.Response(200, json={
                    "results": [_block("img-1", "image", {"type": "file", "file": {"url": S3_IMAGE_URL}})],
                    "has_more": False,
                })
            return httpx.Response(404)
        if str(request.url) == S3_IMAGE_URL:
            return httpx.Response(200, content=_PNG_BYTES, headers={"content-type": "image/png"})
        return httpx.Response(404)

    provider = _make_provider(handler)
    note = await provider.fetch(CREDS, RemoteRef(remote_id="page-m", updated_at="x"))

    s3_requests = [r for r in captured if str(r.url) == S3_IMAGE_URL]
    assert len(s3_requests) == 1
    assert "authorization" not in {k.lower() for k in s3_requests[0].headers.keys()}
    assert note.media[0]["data_uri"].startswith("data:image/png;base64,")


async def test_external_media_fetch_media_carries_no_auth_header():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=_PNG_BYTES, headers={"content-type": "image/png"})

    provider = _make_provider(handler)
    captured: list[httpx.Request] = []

    def spy_handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return handler(request)

    provider = _make_provider(spy_handler)
    data, content_type = await provider.fetch_media(CREDS, EXTERNAL_IMAGE_URL)

    assert data == _PNG_BYTES
    assert content_type == "image/png"
    assert len(captured) == 1
    assert "authorization" not in {k.lower() for k in captured[0].headers.keys()}


# ---------------------------------------------------------------------------
# fetch_media SSRF guard (final-review Item D) — `external`-type media is an
# arbitrary permanent host from document content; `fetch_media` had no
# scheme/host validation at all.
# ---------------------------------------------------------------------------


async def test_fetch_media_refuses_a_plain_http_url_without_making_a_request():
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("must never issue a request for a non-https ref")

    provider = _make_provider(handler)
    with pytest.raises(errors.NoteConnUnsupported):
        await provider.fetch_media(CREDS, "http://example.com/img.png")


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1/img.png",
        "https://10.1.2.3/img.png",
        "https://169.254.169.254/latest/meta-data/",  # cloud metadata endpoint
        "https://[::1]/img.png",
    ],
)
async def test_fetch_media_refuses_loopback_private_and_link_local_hosts(url):
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("must never issue a request to a private/internal host")

    provider = _make_provider(handler)
    with pytest.raises(errors.NoteConnUnsupported):
        await provider.fetch_media(CREDS, url)


async def test_fetch_media_https_public_host_passes():
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == EXTERNAL_IMAGE_URL
        return httpx.Response(200, content=_PNG_BYTES, headers={"content-type": "image/png"})

    provider = _make_provider(handler)
    data, content_type = await provider.fetch_media(CREDS, EXTERNAL_IMAGE_URL)
    assert data == _PNG_BYTES
    assert content_type == "image/png"


async def test_internal_media_download_from_a_private_host_yields_a_missing_marker_not_a_crash():
    """`_get_media_bytes` (the `file`-type internal download, at traversal
    time) never raises for a bad url by contract -- it degrades to "this
    media just isn't available," same as any other download failure. This
    proves the SSRF guard applied there folds into that SAME contract
    rather than becoming a surprise unhandled raise mid-traversal."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == _API_HOST:
            if request.url.path == "/v1/pages/page-priv" and request.method == "GET":
                return httpx.Response(200, json={"id": "page-priv", "properties": {"title": _title_prop("P")}})
            if request.url.path == "/v1/blocks/page-priv/children" and request.method == "GET":
                return httpx.Response(200, json={
                    "results": [_block(
                        "img-priv", "image",
                        {"type": "file", "file": {"url": "https://169.254.169.254/latest/meta-data/"}, "caption": []},
                    )],
                    "has_more": False,
                })
            return httpx.Response(404)
        raise AssertionError(f"must never issue a request to a private host, got {request.url}")

    provider = _make_provider(handler)
    note = await provider.fetch(CREDS, RemoteRef(remote_id="page-priv", updated_at="x"))
    assert note.media == []
    assert "[image unavailable" in json.dumps(note.doc)


async def test_media_403_refetches_block_once_and_retries():
    attempts = {"n": 0}
    fresh_url = S3_IMAGE_URL + "&fresh=1"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == _API_HOST:
            if request.url.path == "/v1/pages/page-403" and request.method == "GET":
                return httpx.Response(200, json={"id": "page-403", "properties": {"title": _title_prop("P")}})
            if request.url.path == "/v1/blocks/page-403/children" and request.method == "GET":
                return httpx.Response(200, json={
                    "results": [_block("img-403", "image", {"type": "file", "file": {"url": S3_IMAGE_URL}})],
                    "has_more": False,
                })
            if request.url.path == "/v1/blocks/img-403" and request.method == "GET":
                # Refetch returns a FRESH url.
                return httpx.Response(200, json=_block("img-403", "image", {"type": "file", "file": {"url": fresh_url}}))
            return httpx.Response(404)
        if str(request.url) == S3_IMAGE_URL:
            attempts["n"] += 1
            return httpx.Response(403)
        if str(request.url) == fresh_url:
            attempts["n"] += 1
            return httpx.Response(200, content=_PNG_BYTES, headers={"content-type": "image/png"})
        return httpx.Response(404)

    provider = _make_provider(handler)
    note = await provider.fetch(CREDS, RemoteRef(remote_id="page-403", updated_at="x"))

    assert attempts["n"] == 2, "one failed attempt at the stale url, one successful retry at the fresh url"
    assert note.media[0]["data_uri"].startswith("data:image/png;base64,")


async def test_media_permanent_failure_degrades_to_visible_marker_not_a_crash():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == _API_HOST:
            if request.url.path == "/v1/pages/page-fail" and request.method == "GET":
                return httpx.Response(200, json={"id": "page-fail", "properties": {"title": _title_prop("F")}})
            if request.url.path == "/v1/blocks/page-fail/children" and request.method == "GET":
                return httpx.Response(200, json={
                    "results": [_block("img-fail", "image", {"type": "file", "file": {"url": S3_IMAGE_URL}, "caption": []})],
                    "has_more": False,
                })
            if request.url.path == "/v1/blocks/img-fail" and request.method == "GET":
                return httpx.Response(500)
            return httpx.Response(404)
        return httpx.Response(500)  # media host always fails

    provider = _make_provider(handler)
    note = await provider.fetch(CREDS, RemoteRef(remote_id="page-fail", updated_at="x"))

    assert note.media == []
    assert "[image unavailable" in json.dumps(note.doc)


async def test_internal_media_exceeding_content_length_cap_yields_too_large_marker():
    """The size guard on the synchronous download+embed path (review
    finding #3): a `file`-type media block whose server-declared
    `Content-Length` already exceeds notes.py's own image persistence cap
    (`_MAX_IMAGE_BYTES`, 5MB) must be refused BEFORE the body is consumed —
    proven here by returning a response whose (small, harmless) ACTUAL body
    would otherwise have downloaded fine; the guard must still refuse it
    purely off the declared length, not off what actually arrives."""
    from api.services.journal_two.notes import _MAX_IMAGE_BYTES

    oversized_declared_length = _MAX_IMAGE_BYTES + (1024 * 1024)  # 1MB over the 5MB cap

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == _API_HOST:
            if request.url.path == "/v1/pages/page-big-media" and request.method == "GET":
                return httpx.Response(200, json={"id": "page-big-media", "properties": {"title": _title_prop("Big Media")}})
            if request.url.path == "/v1/blocks/page-big-media/children" and request.method == "GET":
                return httpx.Response(200, json={
                    "results": [_block("img-huge", "image", {"type": "file", "file": {"url": S3_IMAGE_URL}, "caption": []})],
                    "has_more": False,
                })
            return httpx.Response(404)
        if str(request.url) == S3_IMAGE_URL:
            # Body is deliberately tiny (a real oversized fixture would bloat
            # the test) -- the guard must trip on the DECLARED length alone.
            return httpx.Response(200, content=_PNG_BYTES, headers={
                "content-length": str(oversized_declared_length), "content-type": "image/png",
            })
        return httpx.Response(404)

    provider = _make_provider(handler)
    note = await provider.fetch(CREDS, RemoteRef(remote_id="page-big-media", updated_at="x"))

    assert note.media == [], "an over-cap media item must never be registered/embedded"
    assert "[media too large: " in json.dumps(note.doc)
    assert "[image unavailable" not in json.dumps(note.doc), "too-large is a DISTINCT failure from a download error"


# ---------------------------------------------------------------------------
# Rate limiting: self-imposed 3rps + honor 429/529 Retry-After.
# ---------------------------------------------------------------------------

async def test_rate_limiter_is_invoked_on_multi_request_calls():
    """Mirrors the Craft precedent: capacity=1 + a frozen fake clock forces
    every request past the first to hit `sleep`."""
    sleep_calls: list[float] = []
    clock_time = [1000.0]

    def fake_clock() -> float:
        return clock_time[0]

    async def advancing_sleep(seconds: float) -> None:
        sleep_calls.append(seconds)
        clock_time[0] += 1.0

    from api.services.journal_two.broker.rate_limit import AsyncRateLimiter
    limiter = AsyncRateLimiter(3.0, capacity=1.0, clock=fake_clock, sleep=advancing_sleep)

    page1 = [{"object": "page", "id": "s-1", "in_trash": False, "last_edited_time": "2026-08-10T12:00:00.000Z",
              "properties": {"title": _title_prop("S1")}}]

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        if not body.get("start_cursor"):
            return httpx.Response(200, json={"results": page1, "has_more": True, "next_cursor": "p2"})
        return httpx.Response(200, json={"results": [], "has_more": False, "next_cursor": None})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = NotionProvider(client=client, rate_limiter=limiter)

    await provider.list_changed(CREDS)  # 2 requests -> capacity-1 forces a wait on the 2nd

    assert sleep_calls, "expected the rate limiter to actually throttle a request"


async def test_429_is_retried_honoring_retry_after_then_succeeds():
    sleep_calls: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleep_calls.append(seconds)

    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] == 1:
            return httpx.Response(429, headers={"retry-after": "7"})
        return httpx.Response(200, json={"id": "bot-1", "name": "Bot"})

    provider = _make_provider(handler, sleep_fn=fake_sleep)
    info = await provider.validate(CREDS)

    assert attempts["n"] == 2
    assert sleep_calls == [7.0]
    assert info.raw["bot_id"] == "bot-1"


async def test_529_retries_exhausted_raises_rate_limited():
    async def fake_sleep(seconds: float) -> None:
        return None

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(529, headers={"retry-after": "3"})

    provider = _make_provider(handler, sleep_fn=fake_sleep)
    with pytest.raises(errors.NoteConnRateLimited) as exc_info:
        await provider.validate(CREDS)
    assert exc_info.value.retry_after == 3.0


# ---------------------------------------------------------------------------
# Misc: import_key, validate(), bad token.
# ---------------------------------------------------------------------------

def test_import_key_is_flat_notion_page_id_with_no_source_component():
    provider = NotionProvider()
    assert provider.import_key("some-source-remote-id", "page-xyz") == "notion:page-xyz"


async def test_validate_bad_token_raises_auth_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"message": "unauthorized"})

    provider = _make_provider(handler)
    with pytest.raises(errors.NoteConnAuthError):
        await provider.validate(CREDS)


async def test_validate_missing_access_token_raises_without_a_request():
    provider = NotionProvider()
    with pytest.raises(errors.NoteConnAuthError):
        await provider.validate({})


async def test_server_error_raises_transient():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    provider = _make_provider(handler)
    with pytest.raises(errors.NoteConnTransient):
        await provider.validate(CREDS)
