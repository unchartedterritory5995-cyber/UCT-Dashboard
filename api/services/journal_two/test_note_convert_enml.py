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


# ---- I1: the client's `unambiguousPairs` (a hash-mismatched en-media pairs only when it cannot
# be a guess) ---------------------------------------------------------------------------------

PNG2 = _res(PNG2_HASH, "image/png", "second.png")
WRONG = "f" * 32
WRONG2 = "e" * 32


def test_lone_mismatched_image_pairs_with_the_lone_uncited_image_in_place():
    out = _convert(f'<div>before<en-media hash="{WRONG}" type="image/png"/>after</div>', [IMG])
    assert [b["type"] for b in _blocks(out)] == ["paragraph", "image", "paragraph"]
    assert _blocks(out)[1]["attrs"]["src"] == f"import-ref://{_ref(IMG_HASH)}"
    assert not _of_type(out, "importNotice")
    assert [m["ref"] for m in out["media"]] == [_ref(IMG_HASH)]


def test_lone_untyped_mismatch_pairs_with_the_lone_uncited_resource():
    out = _convert(f'<en-media hash="{WRONG}"/>', [PDF])
    assert [b["type"] for b in _blocks(out)] == ["attachmentChip"]
    assert not _of_type(out, "importNotice")


def test_one_exact_citation_plus_one_mismatch_pairs_the_mismatch():
    out = _convert(f'<en-media hash="{IMG_HASH}" type="image/png"/>'
                   f'<en-media hash="{WRONG}" type="image/png"/>', [IMG, PNG2])
    srcs = [n["attrs"]["src"] for n in _of_type(out, "image")]
    assert srcs == [f"import-ref://{_ref(IMG_HASH)}", f"import-ref://{_ref(PNG2_HASH)}"]
    assert not _of_type(out, "importNotice")


@pytest.mark.parametrize("resources", [[IMG, PNG2], [PNG2, IMG]], ids=["order", "swapped"])
def test_two_mismatches_and_two_uncited_resources_are_notices_never_a_guess(resources):
    out = _convert(f'<en-media hash="{WRONG}" type="image/png"/>'
                   f'<en-media hash="{WRONG2}" type="image/png"/>', resources)
    types = [b["type"] for b in _blocks(out)]
    assert types == ["importNotice", "importNotice", "image", "image"]  # both appended at the end


def test_a_typed_mismatch_does_not_pair_while_an_untyped_mismatch_exists():
    out = _convert(f'<en-media hash="{WRONG}" type="image/png"/><en-media hash="{WRONG2}"/>', [IMG])
    assert [b["type"] for b in _blocks(out)] == ["importNotice", "importNotice", "image"]


def test_a_mismatch_of_another_kind_does_not_pair():
    out = _convert(f'<en-media hash="{WRONG}" type="application/pdf"/>', [IMG])
    assert [b["type"] for b in _blocks(out)] == ["importNotice", "image"]


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
    # Review m1: Evernote's empty line keeps the client's shape, a paragraph holding a line break.
    assert paras[2]["content"] == [{"type": "hardBreak"}]


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


def test_todo_inside_a_list_item_takes_the_client_shape():
    # Review m4, probed on the client: the task list leaves the list, the item keeps a paragraph.
    out = _convert('<ul><li><div><en-todo checked="true"/>a</div></li></ul>')
    blocks = _blocks(out)
    assert [b["type"] for b in blocks] == ["bulletList", "taskList"]
    assert blocks[0]["content"] == [{"type": "listItem", "content": [{"type": "paragraph", "content": []}]}]
    (item,) = blocks[1]["content"]
    assert item["attrs"]["checked"] is True and _text(item) == "a"


def _shape(node: Any) -> Any:
    """Types only, nested: `(type, [children...])`, text nodes as their text."""
    if node.get("type") == "text":
        return node["text"]
    return (node["type"], [_shape(c) for c in node.get("content") or []])


# Task 4: measured on the client (the editor parser's list-item repair); replaces Task 3 m4's
# "after the outermost list" guess, which held for one level only.
@pytest.mark.parametrize("body,shape", [
    ('<ul><li>outer<ul><li><div><en-todo/>deep</div></li></ul></li><li>second</li></ul>',
     [("bulletList", [("listItem", [("paragraph", ["outer"]),
                                    ("bulletList", [("listItem", [("paragraph", [])])]),
                                    ("taskList", [("taskItem", [("paragraph", ["deep"])])])]),
                      ("listItem", [("paragraph", ["second"])])])]),
    ('<ul><li>text<div><en-todo checked="true"/>a</div></li><li>z</li></ul>',
     [("bulletList", [("listItem", [("paragraph", ["text"]),
                                    ("taskList", [("taskItem", [("paragraph", ["a"])])])]),
                      ("listItem", [("paragraph", ["z"])])])]),
    ('<ul><li><ul><li><div><en-todo/>deep</div></li></ul></li></ul>',
     [("bulletList", [("listItem", [("paragraph", [])])]),
      ("bulletList", [("listItem", [("paragraph", [])])]),
      ("taskList", [("taskItem", [("paragraph", ["deep"])])])]),
    ('<ol><li><div><en-todo/>a</div></li><li>b</li></ol>',
     [("orderedList", [("listItem", [("paragraph", [])])]),
      ("taskList", [("taskItem", [("paragraph", ["a"])])]),
      ("bulletList", [("listItem", [("paragraph", ["b"])])])]),
])
def test_todo_placement_in_lists_matches_the_client(body, shape):
    assert [_shape(b) for b in _blocks(_convert(body))] == shape


@pytest.mark.parametrize("value,checked", [("true", True), ("TRUE", False), ("True", False),
                                           ("false", False), ("", False)])
def test_en_todo_checked_is_exactly_true_as_on_the_client(value, checked):
    out = _convert(f'<div><en-todo checked="{value}"/>t</div>')
    (item,) = _of_type(out, "taskItem")
    assert item["attrs"]["checked"] is checked


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


# ---- m3: formatting the client keeps (TipTap's Bold/Italic/Underline/Strike parse rules) ------


def _marks_of(out: dict, text: str) -> list[str]:
    (node,) = [t for t in _of_type(out, "text") if t["text"] == text]
    return sorted(m["type"] for m in node.get("marks") or [])


@pytest.mark.parametrize("html,text,marks", [
    ("<u>u</u>", "u", ["underline"]),
    ('<span style="font-weight: bold;">B</span>', "B", ["bold"]),
    ('<span style="font-weight:700">B</span>', "B", ["bold"]),
    ('<span style="font-weight: bolder">B</span>', "B", ["bold"]),
    ('<span style="font-weight:400">N</span>', "N", []),
    ('<span style="font-weight:normal">N</span>', "N", []),
    ('<span style="text-decoration: underline;">U</span>', "U", ["underline"]),
    ('<span style="text-decoration:underline line-through">X</span>', "X", ["strike", "underline"]),
    ('<span style="font-style: italic">I</span>', "I", ["italic"]),
    ('<span style="text-decoration: line-through">S</span>', "S", ["strike"]),
    ('<span style="color: red">C</span>', "C", []),
    ('<font color="red">C</font>', "C", []),
    ('<b style="font-weight: normal">n</b>', "n", []),
    ('<i style="font-style: normal">n</i>', "n", []),
    ('<span style="font-weight:bold"><b>bb</b></span>', "bb", ["bold"]),
    ('<span style="font-weight:bold;font-style:italic;text-decoration:underline">all</span>', "all",
     ["bold", "italic", "underline"]),
])
def test_style_and_tag_formatting_matches_the_client(html, text, marks):
    assert _marks_of(_convert(f"<div>{html}</div>"), text) == marks


def test_a_styled_block_marks_the_text_of_every_line_inside_it():
    out = _convert('<div style="font-weight:bold"><div>a</div><div>b</div></div>')
    assert [b["type"] for b in _blocks(out)] == ["paragraph", "paragraph"]
    assert _marks_of(out, "a") == ["bold"] and _marks_of(out, "b") == ["bold"]


# ---- R1 (round 2): a mark tag around blocks keeps the blocks and marks their text. Fixed in the
# SHARED HTML walker (`mddoc.html_to_tiptap`), so OneNote and Dropbox HTML get it too ------------

_MARK_TAG_CASES = [("b", "bold"), ("strong", "bold"), ("i", "italic"), ("em", "italic"),
                   ("u", "underline"), ("s", "strike"), ("strike", "strike"), ("del", "strike")]


def _paragraph_marks(doc: dict) -> list[tuple[str, tuple]]:
    out = []
    for block in doc["content"]:
        assert block["type"] == "paragraph", block
        (text,) = block["content"]
        out.append((text["text"], tuple(m["type"] for m in text.get("marks") or [])))
    return out


@pytest.mark.parametrize("tag,mark", _MARK_TAG_CASES)
def test_mark_tag_around_lines_keeps_two_marked_paragraphs_in_enml(tag, mark):
    out = _convert(f"<{tag}><div>a</div><div>b</div></{tag}>")
    assert _paragraph_marks(out["doc"]) == [("a", (mark,)), ("b", (mark,))]


@pytest.mark.parametrize("tag,mark", _MARK_TAG_CASES)
def test_mark_tag_around_paragraphs_in_the_shared_html_walker(tag, mark):
    from api.services.journal_two.note_connectors.convert.mddoc import html_to_tiptap
    out = html_to_tiptap(f"<{tag}><p>a</p><p>b</p></{tag}>")
    assert _paragraph_marks(out["doc"]) == [("a", (mark,)), ("b", (mark,))]


def test_nested_mark_tags_around_blocks_combine_without_doubling():
    from api.services.journal_two.note_connectors.convert.mddoc import html_to_tiptap
    out = html_to_tiptap("<b><i><p>a</p><p><b>b</b></p></i></b>")
    assert _paragraph_marks(out["doc"]) == [("a", ("italic", "bold")), ("b", ("bold", "italic"))]


def test_mark_tag_around_blocks_keeps_lists_and_leaves_code_unmarked():
    from api.services.journal_two.note_connectors.convert.mddoc import html_to_tiptap
    out = html_to_tiptap("<b><ul><li>x</li></ul><pre><code>c</code></pre>tail</b>")
    types = [b["type"] for b in out["doc"]["content"]]
    assert types == ["bulletList", "codeBlock", "paragraph"]
    assert _marks_of({"doc": out["doc"]}, "x") == ["bold"]
    assert _marks_of({"doc": out["doc"]}, "tail") == ["bold"]
    (code_text,) = _of_type({"doc": out["doc"]["content"][1]}, "text")
    assert not code_text.get("marks")


def test_mark_tag_with_only_inline_content_is_unchanged():
    from api.services.journal_two.note_connectors.convert.mddoc import html_to_tiptap
    out = html_to_tiptap("<p>x <b>y</b> z</p>")
    assert [(t["text"], [m["type"] for m in t.get("marks") or []])
            for t in out["doc"]["content"][0]["content"]] == [("x ", []), ("y", ["bold"]), (" z", [])]


# ---- R2 (round 2): our internal attributes written in the member's ENML mean nothing ----------


def test_a_members_data_uct_task_li_stays_a_bullet():
    out = _convert('<ul><li data-uct-task="1">x</li><li data-uct-task="0">y</li></ul>')
    assert [b["type"] for b in _blocks(out)] == ["bulletList"]
    assert not _of_type(out, "taskList")


def test_a_members_data_uct_chip_link_still_goes_through_the_link_policy():
    out = _convert('<div><a href="/chart" data-uct-chip="1">x</a></div>')
    (text,) = _of_type(out, "text")
    assert text["text"] == "x" and not text.get("marks")


def test_a_members_data_evernote_link_on_a_web_link_is_ignored():
    out = _convert(f'<div><a href="https://e.com/p" data-evernote-link="1">'
                   f'<en-media hash="{IMG_HASH}" type="image/png"/></a></div>', [IMG])
    # A web link emptied by the lift shows its href; a note link would have been unwrapped.
    (text,) = _of_type(out, "text")
    assert text["text"] == "https://e.com/p"


# ---- n2: block-edge whitespace, as the client editor's parser trims it ------------------------


def _inline(out: dict, i: int = 0) -> list[tuple]:
    return [(n.get("type"), n.get("text"), tuple(m["type"] for m in n.get("marks") or []))
            for n in _blocks(out)[i]["content"]]


def test_link_text_at_the_end_of_a_line_loses_its_trailing_space():
    out = _convert(f'<div><a href="https://e.com">see <en-media hash="{PDF_HASH}" '
                   f'type="application/pdf"/></a></div>', [PDF])
    assert _inline(out, 1) == [("text", "see", ("link",))]


def test_link_text_at_the_start_and_end_of_a_line_is_trimmed():
    out = _convert('<div><a href="https://www.evernote.com/l/Ab">  Multi\n  space  title </a></div>')
    assert _inline(out) == [("text", "Multi space title", ("link",))]
    assert out["links"] == ["evernote-title:Multi space title"]


def test_inner_spaces_are_kept_and_a_doubled_space_across_marks_collapses():
    out = _convert("<div>a <b>b</b> c</div><div>x <b> y</b></div>")
    assert _inline(out, 0) == [("text", "a ", ()), ("text", "b", ("bold",)), ("text", " c", ())]
    assert _inline(out, 1) == [("text", "x ", ()), ("text", "y", ("bold",))]


def test_a_space_after_a_line_break_is_dropped_and_nbsp_is_never_trimmed():
    out = _convert("<div>x <br/> y</div><div>&nbsp;z&nbsp;</div>")
    assert _inline(out, 0) == [("text", "x ", ()), ("hardBreak", None, ()), ("text", "y", ())]
    assert _inline(out, 1) == [("text", "\xa0z\xa0", ())]


@pytest.mark.parametrize("body,texts", [
    ("<div>x</div><div> b</div>", ["x", " b"]),          # a later line keeps one leading space
    ("<div> a</div><div>b</div>", ["a", "b"]),            # the first line of a container does not
    ("<div>x</div><div>   b</div>", ["x", " b"]),         # collapsed to one
    ("<div>x</div><div> <b>y</b></div>", ["x", "y"]),     # whitespace-only text before content
    ("<div>x</div><p> p</p>", ["x", "p"]),                # a real <p> always loses it
    ("<ul><li><div> a</div><div> b</div></li></ul>", None),  # per container (checked below)
])
def test_leading_space_on_a_later_line_matches_the_client(body, texts):
    # Task 4 (re-review R4), measured by the ENML parity rail (`11-formatting-and-whitespace`).
    out = _convert(body)
    if body.startswith("<ul>"):
        (item,) = _of_type(out, "listItem")
        assert [_text(p) for p in item["content"]] == ["a", " b"]
        return
    assert [_text(b) for b in _blocks(out)] == texts


def test_code_block_whitespace_is_untouched():
    out = _convert('<div style="-en-codeblock:true"><div>  indented  </div></div>')
    (code,) = _of_type(out, "codeBlock")
    assert _text(code) == "  indented  "


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


def _link_after_image(out: dict) -> tuple[str, str]:
    """The link the lift adds right after an image-only link: (its text, its href)."""
    blocks = _blocks(out)
    assert [b["type"] for b in blocks] == ["image", "paragraph"]
    (text,) = _of_type(out, "text")
    (mark,) = [m for m in text.get("marks") or [] if m["type"] == "link"]
    return text["text"], mark["attrs"]["href"]


# ---- Task 9 fix round 1 (concern 2, ruling): an image inside a link keeps the image and gains a
# link right after it: text = the image's alt when it has one, else the href as authored; the
# href is the same allow-listed one, and a note link stays a heal-able `import-link://` -------


def test_title_note_link_without_text_or_alt_stays_a_web_link_after_the_image():
    """A `/l/` share link names its note only by title; with neither text nor alt there is no
    title to heal by, so it stays what it is: an https link to the share page."""
    out = _convert(f'<div><a href="https://www.evernote.com/l/AbCd">'
                   f'<en-media hash="{IMG_HASH}" type="image/png"/></a></div>', [IMG])
    assert _link_after_image(out) == ("https://www.evernote.com/l/AbCd", "https://www.evernote.com/l/AbCd")
    assert out["links"] == []


def test_title_note_link_without_text_heals_by_the_images_alt():
    out = _convert(f'<div><a href="https://www.evernote.com/l/AbCd">'
                   f'<en-media hash="{IMG_HASH}" type="image/png" alt="Q3 plan"/></a></div>', [IMG])
    assert _link_after_image(out) == ("Q3 plan", "import-link://evernote-title:Q3 plan")
    assert out["links"] == ["evernote-title:Q3 plan"]


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


@pytest.mark.parametrize("href", ["evernote:///view/1/s1/g-1/g-1/",
                                  "https://www.evernote.com/shard/s1/nl/1/g-1/"])
def test_note_link_emptied_by_the_lift_is_a_linked_note_after_the_image(href):
    """Fix round 2 (concern 5 ruling): with no alt, a note link reads the fixed label, never its
    URL: the URL carries the member's Evernote user id and shard, and a heal never relabels."""
    out = _convert(f'<div><a href="{href}"><en-media hash="{IMG_HASH}" type="image/png"/></a></div>', [IMG])
    assert _link_after_image(out) == (enml.LINKED_NOTE_LABEL, "import-link://evernote:guid:g-1")
    assert enml.LINKED_NOTE_LABEL == "Linked note"
    assert out["links"] == ["evernote:guid:g-1"]
    assert "s1" not in str(out["doc"])


def test_note_link_emptied_by_the_lift_reads_the_images_alt():
    out = _convert(f'<div><a href="https://www.evernote.com/shard/s1/nl/123/g-2/">'
                   f'<en-media hash="{IMG_HASH}" type="image/png" alt="Setup chart"/></a></div>', [IMG])
    assert _link_after_image(out) == ("Setup chart", "import-link://evernote:guid:g-2")


def test_web_link_emptied_by_the_lift_reads_the_images_alt():
    out = _convert('<div><a href="https://example.com/p"><img src="https://cdn.example.com/a.png" alt="A chart"/>'
                   '</a></div>')
    assert _link_after_image(out) == ("A chart", "https://example.com/p")


def test_the_private_alt_attribute_never_reaches_the_stored_doc():
    out = _convert(f'<div><en-media hash="{IMG_HASH}" type="image/png" alt="x"/></div>', [IMG])
    assert "data-uct-alt" not in str(out["doc"])


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


# ---- I2: every web link goes through `linkify.resolve_href` before the lift (the client's
# `resolveWebLinks`): relative against a web clip's source, refused -> its content ----------


@pytest.mark.parametrize("href", ["/chart", "ftp://x.org/f", "notes/a.html", "vbscript:x"])
def test_refused_link_emptied_by_the_lift_never_shows_its_raw_href(href):
    out = _convert(f'<div><a href="{href}"><en-media hash="{IMG_HASH}" type="image/png"/></a></div>',
                   [IMG])
    assert [b["type"] for b in _blocks(out)] == ["image"]
    assert _of_type(out, "text") == []


def test_refused_link_with_text_keeps_only_its_text():
    out = _convert('<div><a href="javascript:alert(1)">click</a> and <a href="/rel">rel</a></div>')
    texts = _of_type(out, "text")
    assert "".join(t["text"] for t in texts) == "click and rel"
    assert all(not t.get("marks") for t in texts)


def test_relative_link_resolves_against_the_web_clip_source():
    out = _convert('<div><a href="/chart">chart</a></div>', source_url="https://site.com/a/b")
    (text,) = [t for t in _of_type(out, "text") if t["text"] == "chart"]
    assert text["marks"] == [{"type": "link", "attrs": {"href": "https://site.com/chart"}}]


def test_relative_link_emptied_by_the_lift_shows_its_resolved_href():
    out = _convert(f'<div><a href="/chart"><en-media hash="{IMG_HASH}" type="image/png"/></a></div>',
                   [IMG], source_url="https://site.com/a/b")
    assert [b["type"] for b in _blocks(out)] == ["paragraph", "image", "paragraph"]
    (text,) = [t for t in _of_type({"doc": _blocks(out)[2]}, "text")]
    assert text["text"] == "https://site.com/chart"
    assert text["marks"] == [{"type": "link", "attrs": {"href": "https://site.com/chart"}}]


def test_converter_uses_no_private_mddoc_link_policy():
    import inspect
    source = inspect.getsource(enml)
    assert "_is_allowed_link_href" not in source
    assert "resolve_href" in source


# ---- I4: an <img> or placeholder written in the ENML is never ours: refused in place ---------


@pytest.mark.parametrize("src", ["javascript:alert(1)", "vbscript:msgbox(1)", " JaVaScRiPt:x",
                                 "data:text/html;base64,PGI+eDwvYj4=", "data:,plain",
                                 "file:///etc/passwd",
                                 "ftp://x.org/a.png", "import-ref://javascript:alert(1)",
                                 f"import-ref://evernote-res://{GUID}/{IMG_HASH}"])
def test_an_unsafe_or_forged_img_src_is_an_unsafe_notice(src):
    out = _convert(f'<div>a</div><img src="{src}"/><div>b</div>', [IMG])
    blocks = _blocks(out)
    assert [b["type"] for b in blocks][:3] == ["paragraph", "importNotice", "paragraph"]
    assert blocks[1]["attrs"]["reason"] == "unsafe"
    assert blocks[1]["attrs"]["sourceUrl"] is None
    assert "javascript" not in str(out["doc"]).lower() and "vbscript" not in str(out["doc"])
    assert all(m["ref"].startswith("evernote-res://") for m in out["media"])
    assert out["media"] == [{"ref": _ref(IMG_HASH), "kind": "image", "name": "chart.png",
                             "mime": "image/png"}]


@pytest.mark.parametrize("src", ["https://e.com/pics/x.png", "http://e.com/pics/x.png",
                                 "HTTPS://e.com/pics/x.png"])
def test_an_external_web_img_is_a_hotlink_image_copied_in(src):
    # Program rule (controller ruling after fix round 1): hotlinked images are copied in through
    # the guarded path other connectors use. The image stays in place; its ref is the URL, which
    # Task 5's fetch_media copies through `guarded_media_get`.
    out = _convert(f'<div>a</div><img src="{src}"/><div>b</div>')
    blocks = _blocks(out)
    assert [b["type"] for b in blocks] == ["paragraph", "image", "paragraph"]
    assert blocks[1]["attrs"]["src"] == f"import-ref://{src}"
    assert out["media"] == [{"ref": src, "kind": "image", "name": "x.png"}]
    assert not _of_type(out, "importNotice")


@pytest.mark.parametrize("href", ["import-attachment-ref://https://evil.example/x.pdf",
                                  "import-ref://https://evil.example/x.png"])
def test_a_forged_placeholder_href_is_its_content_only(href):
    out = _convert(f'<div><a href="{href}">x</a></div>')
    assert not _of_type(out, "attachmentChip")
    assert out["media"] == []
    (text,) = _of_type(out, "text")
    assert text["text"] == "x" and not text.get("marks")


@pytest.mark.parametrize("src,resolved", [
    ("/pics/a.png", "https://site.com/pics/a.png"),
    ("pics/a.png", "https://site.com/articles/pics/a.png"),
    ("//cdn.site.com/a.png", "https://cdn.site.com/a.png"),
])
def test_a_relative_img_in_a_web_clip_resolves_against_its_source_and_is_copied(src, resolved):
    # Controller ruling after Task 4: as the file importer, via the one link policy
    # (`linkify.resolve_href(src, source_url)`), then the same hotlink copy as an absolute src.
    out = _convert(f'<img src="{src}"/>', source_url="https://site.com/articles/today")
    images = _of_type(out, "image")
    assert [i["attrs"]["src"] for i in images] == [f"import-ref://{resolved}"]
    assert out["media"] == [{"ref": resolved, "kind": "image", "name": "a.png"}]


@pytest.mark.parametrize("src", ["/pics/a.png", "pics/a.png", "//cdn.site.com/a.png", "/local.png"])
def test_a_relative_img_without_a_web_clip_source_is_unresolvable_named_by_its_src(src):
    # Task 5 review, concern 2 ruling: not dangerous, just unresolvable -- the product-wide code
    # (the client's `collectRemoteImages`), its src as the name. `unsafe` would say "its address
    # isn't allowed", which is false here.
    out = _convert(f'<img src="{src}"/>')
    (notice,) = _of_type(out, "importNotice")
    assert notice["attrs"]["reason"] == "unresolvable_src"
    assert notice["attrs"]["name"] == src
    assert out["media"] == []


def test_an_unresolvable_src_name_is_bounded_like_the_client():
    src = "/" + "x" * 300 + ".png"
    out = _convert(f'<img src="{src}"/>')
    (notice,) = _of_type(out, "importNotice")
    assert notice["attrs"]["name"] == src[:199] + "…"  # MEDIA_NAME_MAX = 200, as mediaRefs.js


def test_an_empty_img_src_is_unresolvable_with_no_name():
    out = _convert('<img src=""/>')
    (notice,) = _of_type(out, "importNotice")
    assert notice["attrs"]["reason"] == "unresolvable_src" and notice["attrs"]["name"] is None


def test_an_unsafe_img_stays_unsafe_in_a_web_clip():
    out = _convert('<img src="javascript:alert(1)"/>', source_url="https://site.com/a")
    assert [n["attrs"]["reason"] for n in _of_type(out, "importNotice")] == ["unsafe"]


@pytest.mark.parametrize("src,ext", [
    ("data:image/png;base64,iVBORw0KGgo=", "png"),
    ("data:image/jpeg;base64,/9j/4AAQ", "jpg"),
    (" DATA:image/gif;base64,R0lGODlh", "gif"),
])
def test_a_data_image_is_uploaded_like_the_client(src, ext):
    # Controller ruling after Task 4 (content wins): a `data:image/*` <img> is uploaded through
    # mddoc's data-URI path (media_policy caps apply in the engine), as the file importer does.
    out = _convert(f'<div>a</div><img src="{src}"/><div>b</div>')
    blocks = _blocks(out)
    assert [b["type"] for b in blocks] == ["paragraph", "image", "paragraph"]
    assert blocks[1]["attrs"]["src"] == f"import-ref://md-img-1.{ext}"
    # The scheme is written lower-case (mddoc reads `data:` case-sensitively); nothing else changes.
    assert out["media"] == [{"ref": f"md-img-1.{ext}", "kind": "image", "name": f"md-img-1.{ext}",
                             "data_uri": "data:" + src.strip()[5:]}]
    assert not _of_type(out, "importNotice")


def test_every_media_ref_is_an_evernote_resource_or_a_web_hotlink():
    out = _convert(f'<img src="https://e.com/a.png"/><img src="javascript:x"/>'
                   f'<en-media hash="{IMG_HASH}" type="image/png"/>'
                   f'<en-media hash="{PDF_HASH}" type="application/pdf"/>', [IMG, PDF])
    assert [m["ref"] for m in out["media"]] == [_ref(IMG_HASH), _ref(PDF_HASH), "https://e.com/a.png"]


# ---- m2: deep nesting never fails the note ------------------------------------------------------


@pytest.mark.parametrize("open_tag,close_tag,depth", [
    ("<blockquote>", "</blockquote>", 500),
    ("<div>", "</div>", 2000),
    ("<span>", "</span>", 3000),
    ("<ul><li>", "</li></ul>", 600),
    ("<table><tr><td>", "</td></tr></table>", 400),
])
def test_deep_nesting_converts_and_keeps_the_text(open_tag, close_tag, depth):
    body = open_tag * depth + "deep text" + close_tag * depth + "<div>after</div>"
    out = _convert(body)
    assert "deep text" in _text(out["doc"]) and "after" in _text(out["doc"])


@pytest.mark.parametrize("unclosed", ["<span>", "<div><span>", "<b><i>"])
def test_an_unclosed_tag_past_the_cap_does_not_swallow_the_structure_after_it(unclosed):
    # Round 2 R5: a flattened tag that is never closed must not make every later end tag of a
    # kept element a no-op (everything after would nest under the deepest kept blockquote).
    body = ("<blockquote>" * 150 + unclosed + "deep text" + "</blockquote>" * 150
            + "<p>after</p>")
    out = _convert(body)
    assert "deep text" in _text(out["doc"])
    blocks = _blocks(out)
    assert [b["type"] for b in blocks] == ["blockquote", "paragraph"]
    assert _text(blocks[1]) == "after"


def test_nesting_below_the_cap_is_kept_as_structure():
    out = _convert("<blockquote>" * 3 + "q" + "</blockquote>" * 3)
    node = _blocks(out)[0]
    for _ in range(3):
        assert node["type"] == "blockquote"
        node = node["content"][0]
    assert node["type"] == "paragraph" and _text(node) == "q"


# ---- I3: the lift is linear -------------------------------------------------------------------


def _linked_images(n: int) -> str:
    return "".join(f'<div><a href="https://e.com/{i}"><en-media hash="{IMG_HASH}" type="image/png"/>'
                   f"</a></div>" for i in range(n))


def _best_of(fn, runs: int = 2) -> float:
    import time
    best = float("inf")
    for _ in range(runs):
        t0 = time.perf_counter()
        fn()
        best = min(best, time.perf_counter() - t0)
    return best


def test_4000_linked_images_convert_in_bounded_time():
    # Round 2 R3: a loose ceiling (~0.17 s measured; the quadratic lift took 10.5 s), so a busy box
    # cannot turn it red. The ratio test below is the real rail.
    body = _linked_images(4000)
    elapsed = _best_of(lambda: _convert(body, [IMG]))
    assert elapsed < 5.0, f"4000 linked images took {elapsed:.2f}s"
    out = _convert(body, [IMG])
    assert len(_of_type(out, "image")) == 4000


def test_linked_image_conversion_scales_linearly_not_quadratically():
    small = _best_of(lambda: _convert(_linked_images(1000), [IMG]))
    large = _best_of(lambda: _convert(_linked_images(4000), [IMG]))
    # Linear is ~4x for 4x the input; the quadratic lift measured ~17x (0.33 s -> 5.8 s).
    assert large < small * 8, f"1000: {small:.3f}s, 4000: {large:.3f}s"


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


def test_lists_are_repaired_once_per_note(monkeypatch):
    """Final review M4: `html_to_tiptap` already repairs lists (mddoc's one iterative
    implementation); the ENML lane must not walk the tree a second time."""
    from api.services.journal_two.note_connectors.convert import mddoc
    calls = []
    real = mddoc.repair_list_items

    def counting(node, *args, **kwargs):
        if isinstance(node, dict) and node.get("type") == "doc":  # a whole-doc walk, not its recursion
            calls.append(1)
        return real(node, *args, **kwargs)

    monkeypatch.setattr(mddoc, "repair_list_items", counting)
    if hasattr(enml, "repair_list_items"):
        monkeypatch.setattr(enml, "repair_list_items", counting)
    out = _convert('<ul><li><div><en-todo checked="true"/>a</div></li><li>b</li></ul>')
    assert len(calls) == 1
    assert _of_type(out, "taskItem")
