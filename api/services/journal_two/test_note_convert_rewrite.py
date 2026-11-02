"""`rewrite_body`'s `notices` argument (Plan A Task 6, spec I-7).

Without `notices` an unresolvable media placeholder is DROPPED, byte-for-byte the
JS twin's (`commit.js` `rewriteBody`) one-shot behaviour. With `notices`, a
placeholder whose ref has a notice is REPLACED by that `importNotice` node, in the
place the placeholder stood: an image that could not be copied never vanishes.
"""
from __future__ import annotations

import copy

from api.services.journal_two import import_notice
from api.services.journal_two.note_connectors.convert import rewrite_body


def _table_doc() -> dict:
    """An image and a file chip inside a table cell, between two paragraphs."""
    return {"type": "doc", "content": [
        {"type": "table", "content": [{"type": "tableRow", "content": [
            {"type": "tableCell", "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "before"}]},
                {"type": "image", "attrs": {"src": "import-ref://a.png"}},
                {"type": "attachmentChip", "attrs": {"href": "import-ref://b.pdf", "name": "b.pdf"}},
                {"type": "paragraph", "content": [{"type": "text", "text": "after"}]},
            ]},
        ]}]},
    ]}


def _cell(body: dict) -> list:
    return body["content"][0]["content"][0]["content"][0]["content"]


def test_rewrite_without_notices_still_drops_for_js_parity():
    doc = _table_doc()
    original = copy.deepcopy(doc)
    body, dropped = rewrite_body(doc, {}, {})
    assert [n["type"] for n in _cell(body)] == ["paragraph", "paragraph"]
    assert dropped == ["a.png", "b.pdf"]
    assert doc == original  # pure
    # `notices=None` is the default: an explicit None is the same answer.
    assert rewrite_body(doc, {}, {}, notices=None) == (body, dropped)


def test_rewrite_replaces_placeholder_with_notice_in_place():
    doc = _table_doc()
    original = copy.deepcopy(doc)
    notice_a = import_notice.notice_node(
        "fetch_failed", name="a.png", source_url=None, ref="a.png", attempts=1)
    notice_b = import_notice.notice_node(
        "unsupported", name="b.pdf", source_url=None, ref="b.pdf", attempts=1)
    body, dropped = rewrite_body(doc, {}, {}, notices={"a.png": notice_a, "b.pdf": notice_b})
    cell = _cell(body)
    assert [n["type"] for n in cell] == ["paragraph", "importNotice", "importNotice", "paragraph"]
    assert cell[1] == notice_a and cell[2] == notice_b
    assert dropped == []
    assert doc == original  # pure
    # the caller's notice dict is never aliased into the body
    cell[1]["attrs"]["attempts"] = 99
    assert notice_a["attrs"]["attempts"] == 1


def test_rewrite_with_notices_resolves_what_uploaded_and_drops_what_has_no_notice():
    doc = _table_doc()
    notice_a = import_notice.notice_node(
        "fetch_failed", name="a.png", source_url=None, ref="a.png", attempts=1)
    body, dropped = rewrite_body(doc, {"b.pdf": "/api/x/b.pdf"}, {}, notices={"a.png": notice_a})
    cell = _cell(body)
    assert [n["type"] for n in cell] == ["paragraph", "importNotice", "attachmentChip", "paragraph"]
    assert cell[2]["attrs"]["href"] == "/api/x/b.pdf"
    assert dropped == []
    # a ref with neither a URL nor a notice is still reported as dropped
    body2, dropped2 = rewrite_body(doc, {}, {}, notices={"a.png": notice_a})
    assert dropped2 == ["b.pdf"]


# ── `resolved` (Plan A Task 8): what the media policy stored for each ref ────

def _stored(kind, url, name, size, original=None):
    from api.services.journal_two.media_policy import StoredMedia
    return StoredMedia(kind=kind, url=url, name=name, size=size, mime="x/y", width=None,
                       height=None, original=original)


def test_resolved_image_becomes_an_image_then_its_kept_original_as_a_chip():
    doc = _table_doc()
    original = copy.deepcopy(doc)
    heic = _stored("file", "/att/IMG.heic", "IMG.heic", 900)
    body, dropped = rewrite_body(doc, {}, {}, resolved={
        "a.png": _stored("image", "/att/IMG.jpg", "IMG.jpg", 300, original=heic),
        "b.pdf": _stored("file", "/att/b.pdf", "b.pdf", 42)})
    cell = _cell(body)
    assert [n["type"] for n in cell] == ["paragraph", "image", "attachmentChip", "attachmentChip", "paragraph"]
    assert cell[1]["attrs"]["src"] == "/att/IMG.jpg"
    assert cell[2]["attrs"] == {"href": "/att/IMG.heic", "name": "IMG.heic", "size": 900}
    assert cell[3]["attrs"] == {"href": "/att/b.pdf", "name": "b.pdf", "size": 42}
    assert dropped == [] and doc == original


def test_an_image_placeholder_stored_as_a_file_becomes_a_chip():
    body, _ = rewrite_body(_table_doc(), {}, {}, resolved={
        "a.png": _stored("file", "/att/logo.svg", "logo.svg", 77)}, notices={})
    cell = _cell(body)
    assert cell[1] == {"type": "attachmentChip",
                       "attrs": {"href": "/att/logo.svg", "name": "logo.svg", "size": 77}}
    assert [n["type"] for n in cell] == ["paragraph", "attachmentChip", "paragraph"]   # b: no notice, dropped
