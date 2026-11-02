"""Tests for the server-side ENML -> TipTap converter (Plan E Task 3), `convert/enml.py`.

ENML is the body `get_note` returns in `structuredContent.content`; `resources` is the note's
`structuredContent.resources` (measured keys `id, hash, mime, name, sizeBytes`; `null` on a note
without attachments). The rules port the `.enex` adapter (`adapters/evernote.js`).
"""

from __future__ import annotations

from typing import Any

import pytest

from api.services.journal_two.note_connectors.convert import enml

GUID = "4f1c2a3b-0000-4a4a-9b9b-0123456789ab"
IMG_HASH = "a" * 32
PDF_HASH = "b" * 32
PNG2_HASH = "c" * 32
PROLOG = ('<?xml version="1.0" encoding="UTF-8"?>'
          '<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">')


def _res(hash_: str, mime: str, name: str | None, rid: str = "r") -> dict:
    return {"id": f"{rid}-{hash_[:4]}", "hash": hash_, "mime": mime, "name": name, "sizeBytes": 10}


IMG = _res(IMG_HASH, "image/png", "chart.png")
PDF = _res(PDF_HASH, "application/pdf", "report.pdf")


def _note(body: str) -> str:
    return f"{PROLOG}<en-note>{body}</en-note>"


def _convert(body: str, resources=None, **kw) -> dict:
    return enml.enml_to_tiptap(_note(body), resources, note_guid=GUID, **kw)


def _blocks(out: dict) -> list[dict]:
    return out["doc"]["content"]


def _walk(node: Any):
    if isinstance(node, dict):
        yield node
        for child in node.get("content") or []:
            yield from _walk(child)


def _of_type(out: dict, type_: str) -> list[dict]:
    return [n for n in _walk(out["doc"]) if n.get("type") == type_]


def _text(node: Any) -> str:
    return "".join(n.get("text", "") for n in _walk(node) if n.get("type") == "text")


def _ref(hash_: str) -> str:
    return f"evernote-res://{GUID}/{hash_}"


# --------------------------------------------------------------------------- keys + hrefs


def test_live_key_and_file_key_spaces_cannot_collide():
    key = enml.live_import_key("0a1b-2c3d")
    assert key == "evernote:guid:0a1b-2c3d" and "/" not in key
    assert key.startswith(enml.LIVE_KEY_PREFIX) and enml.LIVE_KEY_PREFIX == "evernote:guid:"
    # A .enex key always carries two slashes: evernote:<notebook>/<title>/<created>.
    enex_key = "evernote:Trading/My note/20240101T000000Z"
    assert enex_key.count("/") >= 2 and not enex_key.startswith(enml.LIVE_KEY_PREFIX)
    assert enml.EVERNOTE_RES_SCHEME == "evernote-res://"


@pytest.mark.parametrize("href,guid", [
    ("evernote:///view/123/s1/aaaa-bb/aaaa-bb/", "aaaa-bb"),
    ("evernote://view/123/s1/aaaa-bb/aaaa-bb/", "aaaa-bb"),
    ("EVERNOTE:///VIEW/123/s1/aaaa-bb/aaaa-bb/", "aaaa-bb"),
    ("https://www.evernote.com/shard/s1/nl/123/aaaa-bb/", "aaaa-bb"),
    ("https://evernote.com/shard/s1/nl/123/aaaa-bb", "aaaa-bb"),
    ("https://www.evernote.com/l/AbCd", None),
    ("https://share.evernote.com/note/xyz", None),
    ("https://www.evernote.com/shard/s1/sh/aaaa-bb/key", None),
    ("https://www.evernote.com/pricing", None),
    ("evernote:///view/123/", None),
    ("", None),
])
def test_note_guid_from_href(href, guid):
    assert enml.note_guid_from_href(href) == guid


# --------------------------------------------------------------------------- media


def test_image_media_becomes_import_ref_with_declared_mime():
    out = _convert(f'<div>Hi</div><en-media hash="{IMG_HASH}" type="image/png"/>', [IMG])
    (img,) = _of_type(out, "image")
    assert img["attrs"]["src"] == f"import-ref://{_ref(IMG_HASH)}"
    assert out["media"] == [{"ref": _ref(IMG_HASH), "kind": "image", "name": "chart.png",
                             "mime": "image/png"}]


def test_hash_match_is_case_insensitive():
    out = _convert(f'<en-media hash="{IMG_HASH.upper()}" type="image/png"/>', [IMG])
    assert [m["ref"] for m in out["media"]] == [_ref(IMG_HASH)]
    assert not _of_type(out, "importNotice")


def test_pdf_media_becomes_attachment_chip_named_from_resource():
    out = _convert(f'<div>See <en-media hash="{PDF_HASH}" type="application/pdf"/></div>', [PDF])
    (chip,) = _of_type(out, "attachmentChip")
    assert chip["attrs"] == {"href": f"import-ref://{_ref(PDF_HASH)}", "name": "report.pdf"}
    assert out["media"] == [{"ref": _ref(PDF_HASH), "kind": "file", "name": "report.pdf",
                             "mime": "application/pdf"}]


def test_resource_without_a_name_gets_one_from_its_mime():
    out = _convert(f'<en-media hash="{PDF_HASH}" type="application/pdf"/>',
                   [_res(PDF_HASH, "application/pdf", None)])
    assert out["media"][0]["name"] == "attachment.pdf"
    assert _of_type(out, "attachmentChip")[0]["attrs"]["name"] == "attachment.pdf"


def test_missing_resource_is_a_notice_in_place_never_dropped():
    out = _convert(f'<div>before</div><en-media hash="{"d" * 32}" type="image/png"/>'
                   f'<div>after</div>', [])
    blocks = _blocks(out)
    assert [b["type"] for b in blocks] == ["paragraph", "importNotice", "paragraph"]
    assert _text(blocks[0]) == "before" and _text(blocks[2]) == "after"
    assert blocks[1]["attrs"]["reason"] == "missing_resource"
    assert out["media"] == []
    assert not _of_type(out, "image")


def test_unreferenced_resource_is_appended():
    out = _convert(f'<div>body</div><en-media hash="{IMG_HASH}" type="image/png"/>', [IMG, PDF])
    blocks = _blocks(out)
    assert blocks[-1]["type"] == "attachmentChip"
    assert blocks[-1]["attrs"]["name"] == "report.pdf"
    assert [m["ref"] for m in out["media"]] == [_ref(IMG_HASH), _ref(PDF_HASH)]


def test_duplicate_hash_resources_collapse_first_wins():
    first = _res(IMG_HASH, "image/png", "first.png", rid="r1")
    second = _res(IMG_HASH, "image/png", "second.png", rid="r2")
    out = _convert(f'<en-media hash="{IMG_HASH}" type="image/png"/>', [first, second])
    assert out["media"] == [{"ref": _ref(IMG_HASH), "kind": "image", "name": "first.png",
                             "mime": "image/png"}]
    assert len(_of_type(out, "image")) == 1  # not appended again as unreferenced


def test_text_after_self_closing_en_media_is_kept():
    out = _convert(f'<div><en-media hash="{IMG_HASH}" type="image/png"/>caption text</div>', [IMG])
    types = [b["type"] for b in _blocks(out)]
    assert types == ["image", "paragraph"]
    assert _text(_blocks(out)[1]) == "caption text"


def test_content_nested_inside_a_non_self_closed_en_media_is_unwrapped_after_it():
    out = _convert(f'<div><en-media hash="{IMG_HASH}" type="image/png">inside</en-media>'
                   f'tail</div>', [IMG])
    assert [b["type"] for b in _blocks(out)] == ["image", "paragraph"]
    assert _text(_blocks(out)[1]) == "insidetail"


def test_null_resources_is_read_as_no_resources():
    body = f'<div>x</div><en-media hash="{IMG_HASH}" type="image/png"/>'
    assert _convert(body, None) == _convert(body, [])
    out = _convert(body, None)
    assert _of_type(out, "importNotice")[0]["attrs"]["reason"] == "missing_resource"


# --------------------------------------------------------------------------- structure


def test_div_lines_become_separate_paragraphs():
    out = _convert("<div>line one</div><div>line two</div><div><br/></div><div>three</div>")
    paras = [b for b in _blocks(out) if b["type"] == "paragraph"]
    assert [_text(p) for p in paras] == ["line one", "line two", "", "three"]


def test_en_todo_lines_group_into_one_task_list_with_checked_state():
    out = _convert('<div><en-todo checked="true"/>done</div>'
                   '<div><en-todo checked="false"/>open</div>'
                   '<div><en-todo/>third</div>'
                   '<div>plain after</div>')
    (task_list,) = _of_type(out, "taskList")
    items = task_list["content"]
    assert [i["attrs"]["checked"] for i in items] == [True, False, False]
    assert [_text(i) for i in items] == ["done", "open", "third"]
    assert _text(_blocks(out)[-1]) == "plain after"


def test_text_nested_inside_a_non_self_closed_en_todo_is_kept():
    out = _convert('<div><en-todo checked="true">nested text</en-todo></div>')
    (item,) = _of_type(out, "taskItem")
    assert item["attrs"]["checked"] is True and _text(item) == "nested text"


def test_en_crypt_becomes_visible_placeholder():
    out = _convert("<div>a</div><en-crypt hint=\"h\" cipher=\"AES\">U2FsdGVk</en-crypt>")
    assert [_text(b) for b in _blocks(out)] == ["a", "[encrypted content — cannot be imported]"]
    assert "U2FsdGVk" not in str(out)


def test_codeblock_div_becomes_code_block_verbatim():
    out = _convert('<div style="box-sizing: border-box; -en-codeblock: true; padding: 8px;">'
                   "<div>def f(x):</div><div>    return x &lt; 2</div><div><br/></div>"
                   "<div>  # end</div></div><div>after</div>")
    (code,) = _of_type(out, "codeBlock")
    assert _text(code) == "def f(x):\n    return x < 2\n\n  # end"
    assert _text(_blocks(out)[-1]) == "after"


def test_table_and_nested_lists_survive():
    out = _convert("<table><tbody><tr><th>Sym</th><th>Note</th></tr>"
                   "<tr><td>NVDA</td><td><div>breakout</div></td></tr></tbody></table>"
                   "<ul><li>one<ul><li>inner</li></ul></li><li>two</li></ul>"
                   "<ol start=\"3\"><li>third</li></ol>")
    (table,) = _of_type(out, "table")
    assert len(table["content"]) == 2 and _text(table) == "SymNoteNVDAbreakout"
    bullet = _of_type(out, "bulletList")
    assert len(bullet) == 2 and _text(bullet[0]) == "oneinnertwo"
    (ordered,) = _of_type(out, "orderedList")
    assert ordered["attrs"]["start"] == 3


def test_entities_like_nbsp_do_not_crash():
    out = _convert("<div>a&nbsp;b &mdash; c &amp; d &lt;e&gt; &#39;f&#39; &eacute;</div>")
    assert _text(out["doc"]) == "a\xa0b — c & d <e> 'f' é"


def test_inline_marks_survive():
    out = _convert("<div><b>bold</b> <i>it</i> <s>gone</s></div>")
    texts = [n for n in _of_type(out, "text")]
    assert texts[0]["marks"] == [{"type": "bold"}]
    assert any(t.get("marks") == [{"type": "italic"}] for t in texts)


# --------------------------------------------------------------------------- links


def test_guid_note_link_resolves_to_live_key_and_keeps_bold_child():
    out = _convert('<div>See <a href="evernote:///view/123/s1/g-1/g-1/"><b>Other note</b></a></div>')
    linked = [t for t in _of_type(out, "text") if t["text"] == "Other note"][0]
    assert {"type": "bold"} in linked["marks"]
    assert {"type": "link", "attrs": {"href": "import-link://evernote:guid:g-1"}} in linked["marks"]
    assert out["links"] == ["evernote:guid:g-1"]


def test_web_shard_nl_link_resolves_to_live_key():
    out = _convert('<div><a href="https://www.evernote.com/shard/s1/nl/9/g-2/">x</a></div>')
    assert out["links"] == ["evernote:guid:g-2"]


def test_share_link_falls_back_to_evernote_title_key():
    out = _convert('<div><a href="https://www.evernote.com/l/AbCd">  My \n Trading   Note </a></div>')
    (text,) = [t for t in _of_type(out, "text") if "Note" in t["text"]]
    assert text["marks"] == [{"type": "link", "attrs": {
        "href": "import-link://evernote-title:My Trading Note"}}]
    assert out["links"] == ["evernote-title:My Trading Note"]


def test_shared_sh_note_link_falls_back_to_title_key():
    out = _convert('<div><a href="https://www.evernote.com/shard/s1/sh/g-3/k">Plan</a></div>')
    assert out["links"] == ["evernote-title:Plan"]


def test_title_note_link_without_text_keeps_its_content_and_drops_the_link():
    out = _convert(f'<div><a href="https://www.evernote.com/l/AbCd">'
                   f'<en-media hash="{IMG_HASH}" type="image/png"/></a></div>', [IMG])
    assert len(_of_type(out, "image")) == 1
    assert out["links"] == []
    assert not any(m.get("type") == "link" for t in _of_type(out, "text")
                   for m in t.get("marks") or [])


def test_a_plain_web_link_is_left_alone():
    out = _convert('<div><a href="https://example.com/x">site</a></div>')
    (text,) = [t for t in _of_type(out, "text") if t["text"] == "site"]
    assert text["marks"] == [{"type": "link", "attrs": {"href": "https://example.com/x"}}]
    assert out["links"] == []


def test_image_inside_a_note_link_is_lifted_not_erased():
    out = _convert(f'<div><a href="evernote:///view/1/s1/g-1/g-1/">'
                   f'<en-media hash="{IMG_HASH}" type="image/png"/>Label</a></div>', [IMG])
    blocks = _blocks(out)
    assert [b["type"] for b in blocks] == ["image", "paragraph"]
    (label,) = _of_type(out, "text")
    assert label["text"] == "Label"
    assert label["marks"] == [{"type": "link", "attrs": {"href": "import-link://evernote:guid:g-1"}}]


def test_note_link_emptied_by_the_lift_is_unwrapped():
    out = _convert(f'<div><a href="evernote:///view/1/s1/g-1/g-1/">'
                   f'<en-media hash="{IMG_HASH}" type="image/png"/></a></div>', [IMG])
    assert [b["type"] for b in _blocks(out)] == ["image"]
    assert _of_type(out, "text") == []


def test_web_link_emptied_by_the_lift_shows_its_href():
    out = _convert(f'<div><a href="https://example.com/p">'
                   f'<en-media hash="{PDF_HASH}" type="application/pdf"/></a></div>', [PDF])
    blocks = _blocks(out)
    assert [b["type"] for b in blocks] == ["attachmentChip", "paragraph"]
    (text,) = _of_type(out, "text")
    assert text["text"] == "https://example.com/p"
    assert text["marks"] == [{"type": "link", "attrs": {"href": "https://example.com/p"}}]


def test_unsafe_web_link_emptied_by_the_lift_is_unwrapped_not_shown():
    out = _convert(f'<div><a href="javascript:alert(1)">'
                   f'<en-media hash="{IMG_HASH}" type="image/png"/></a></div>', [IMG])
    assert [b["type"] for b in _blocks(out)] == ["image"]
    assert "javascript" not in str(out["doc"])


# --------------------------------------------------------------------------- source line


@pytest.mark.parametrize("url,expected", [
    ("https://example.com/article", True),
    ("http://example.com/a", True),
    ("ftp://example.com/a", False),
    ("javascript:alert(1)", False),
    ("https://uctintelligence.com/x", False),
    ("https://app.uctintelligence.com/x", False),
    ("", False),
    (None, False),
])
def test_source_url_line_only_for_http_urls(url, expected):
    out = _convert("<div>body</div>", source_url=url)
    first = _blocks(out)[0]
    if expected:
        assert _text(first) == f"Source: {url}"
        link_text = [t for t in _of_type({"doc": first}, "text") if t["text"] == url][0]
        assert link_text["marks"] == [{"type": "link", "attrs": {"href": url}}]
    else:
        assert _text(first) == "body"


def test_empty_and_prolog_only_inputs_do_not_crash():
    assert enml.enml_to_tiptap("", None, note_guid=GUID)["doc"]["type"] == "doc"
    assert enml.enml_to_tiptap(PROLOG + "<en-note/>", [], note_guid=GUID)["doc"]["content"] == []
