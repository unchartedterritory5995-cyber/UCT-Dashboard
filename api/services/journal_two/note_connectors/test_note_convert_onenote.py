"""Tests for the OneNote HTML pre-pass + delegate converter (Task 5,
note-connectors): `convert/onenote_html.py::onenote_html_to_tiptap` and
`convert/mddoc.py::html_to_tiptap`'s ONE additive taskList branch
(`_html_list_or_tasklist`, gated on `<li data-uct-task="0"|"1">`).

Two things this file exists to prove, per the task-5 brief:
  1. `onenote_html_to_tiptap`'s three pre-pass rules (to-do tags, resource
     images, file attachments) + the free position:absolute div unwrap all
     produce correct TipTap output.
  2. The mddoc.py taskList branch is INERT for every caller that never emits
     `data-uct-task` — Dropbox's `.html` path and any generic HTML import.
     `test_note_convert_mddoc.py`'s existing `html_to_tiptap` suite (marker-
     free throughout) already covers this by construction — every one of
     those tests still passes unmodified after this task's change (verified
     directly: `python -m pytest api/services/journal_two/
     test_note_convert_mddoc.py -q` before and after, byte-identical
     results) — but the explicit test below is the direct, named proof the
     brief asks for.
"""

from __future__ import annotations

from typing import Any

from api.services.journal_two.note_connectors.convert.mddoc import html_to_tiptap
from api.services.journal_two.note_connectors.convert.onenote_html import onenote_html_to_tiptap


# ---------------------------------------------------------------------------
# helpers (each converter test file in this package keeps its own small
# copies rather than sharing a cross-file import — matches
# test_note_connectors_{notion,roam,craft}.py's existing convention)
# ---------------------------------------------------------------------------


def _types(nodes: list[dict[str, Any]]) -> list[str]:
    return [n["type"] for n in nodes]


def _plain_text(node: Any) -> str:
    out: list[str] = []

    def walk(n: Any) -> None:
        if not isinstance(n, dict):
            return
        if n.get("type") == "text":
            out.append(n.get("text", ""))
        for child in n.get("content") or []:
            walk(child)

    walk(node)
    return "".join(out)


def _find_all(node: Any, node_type: str) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []

    def walk(n: Any) -> None:
        if not isinstance(n, dict):
            return
        if n.get("type") == node_type:
            found.append(n)
        for child in n.get("content") or []:
            walk(child)

    walk(node)
    return found


_TIPTAP_NODE_VOCAB = {
    "doc", "paragraph", "heading", "bulletList", "orderedList", "listItem",
    "taskList", "taskItem", "table", "tableRow", "tableHeader", "tableCell",
    "codeBlock", "blockquote", "horizontalRule", "hardBreak", "image",
    "attachmentChip", "text",
}
_TIPTAP_MARK_VOCAB = {"bold", "italic", "strike", "code", "link"}


def _assert_in_vocabulary(node: Any) -> None:
    if not isinstance(node, dict):
        return
    node_type = node.get("type")
    if node_type is not None:
        assert node_type in _TIPTAP_NODE_VOCAB, f"foreign node type: {node_type!r}"
    for mark in node.get("marks") or []:
        assert mark.get("type") in _TIPTAP_MARK_VOCAB, f"foreign mark type: {mark.get('type')!r}"
    for child in node.get("content") or []:
        _assert_in_vocabulary(child)


# ---------------------------------------------------------------------------
# empty / None input
# ---------------------------------------------------------------------------


def test_empty_and_none_input_produce_an_empty_doc():
    for value in ("", None, "   \n\t  "):
        result = onenote_html_to_tiptap(value)
        assert result["doc"] == {"type": "doc", "content": []}
        assert result["media"] == []
        assert result["links"] == []


# ---------------------------------------------------------------------------
# to-do paragraph (checked + unchecked) -> taskList/taskItem(checked)
# ---------------------------------------------------------------------------


def test_todo_paragraphs_checked_and_unchecked_become_task_lists():
    html = (
        '<p data-tag="to-do">Buy milk</p>'
        '<p data-tag="to-do:completed">Buy eggs</p>'
    )
    result = onenote_html_to_tiptap(html)
    top = result["doc"]["content"]
    assert _types(top) == ["taskList", "taskList"]

    unchecked_item = top[0]["content"][0]
    assert unchecked_item["type"] == "taskItem"
    assert unchecked_item["attrs"]["checked"] is False
    assert _plain_text(unchecked_item) == "Buy milk"

    checked_item = top[1]["content"][0]
    assert checked_item["type"] == "taskItem"
    assert checked_item["attrs"]["checked"] is True
    assert _plain_text(checked_item) == "Buy eggs"


def test_todo_on_an_existing_li_rewrites_in_place_and_splits_the_run():
    # The "(and the same on <li>)" case: OneNote's data-tag lands directly on
    # an <li> that's already inside a real <ul> alongside a plain item --
    # this is what actually exercises mddoc.py's run-splitting branch with
    # more than one item (a standalone <p> to-do always becomes its own
    # single-item <ul>; see the module docstring's documented simplification).
    html = (
        "<ul>"
        '<li data-tag="to-do">In-list task</li>'
        "<li>Plain reminder</li>"
        '<li data-tag="to-do:completed">Second task</li>'
        "</ul>"
    )
    result = onenote_html_to_tiptap(html)
    top = result["doc"]["content"]
    assert _types(top) == ["taskList", "bulletList", "taskList"]

    assert top[0]["content"][0]["attrs"]["checked"] is False
    assert _plain_text(top[0]) == "In-list task"
    assert top[1]["content"][0]["type"] == "listItem"
    assert _plain_text(top[1]) == "Plain reminder"
    assert top[2]["content"][0]["attrs"]["checked"] is True
    assert _plain_text(top[2]) == "Second task"


def test_a_data_tag_value_other_than_to_do_is_left_untouched():
    html = '<p data-tag="important">Remember this</p>'
    result = onenote_html_to_tiptap(html)
    top = result["doc"]["content"]
    assert _types(top) == ["paragraph"]
    assert _plain_text(top[0]) == "Remember this"


def test_todo_inside_an_absolute_div_still_rewrites():
    # Proves the string-level to-do regex works regardless of surrounding
    # div wrapping -- it operates before html_to_tiptap's tree builder ever
    # sees the div.
    html = (
        '<div style="position:absolute;left:10px;top:20px;">'
        '<p data-tag="to-do">Wrapped task</p>'
        "</div>"
    )
    result = onenote_html_to_tiptap(html)
    top = result["doc"]["content"]
    assert _types(top) == ["taskList"]
    assert top[0]["content"][0]["attrs"]["checked"] is False
    assert _plain_text(top[0]) == "Wrapped task"


# ---------------------------------------------------------------------------
# resource <img> -> image node with import-ref://onenote-res://{id} + media
# ---------------------------------------------------------------------------


def test_resource_image_prefers_the_fullres_id_and_registers_media():
    html = (
        '<img src="https://graph.microsoft.com/v1.0/me/onenote/resources/'
        '0-lowres!1-a/$value" '
        'data-fullres-src="https://graph.microsoft.com/v1.0/me/onenote/resources/'
        '0-fullres!1-b/$value?fullSize=true">'
    )
    result = onenote_html_to_tiptap(html)
    image = result["doc"]["content"][0]
    assert image == {"type": "image", "attrs": {"src": "import-ref://onenote-res://0-fullres!1-b"}}
    assert result["media"] == [{"ref": "onenote-res://0-fullres!1-b", "kind": "image", "name": "0-fullres!1-b"}]


def test_resource_image_without_fullres_uses_the_src_id():
    html = (
        '<img src="https://graph.microsoft.com/v1.0/me/onenote/resources/'
        '0-onlysrc!1-c/$value">'
    )
    result = onenote_html_to_tiptap(html)
    image = result["doc"]["content"][0]
    assert image["attrs"]["src"] == "import-ref://onenote-res://0-onlysrc!1-c"
    assert result["media"] == [{"ref": "onenote-res://0-onlysrc!1-c", "kind": "image", "name": "0-onlysrc!1-c"}]


def test_resource_image_referenced_twice_dedupes_to_one_media_entry():
    tag = (
        '<img src="https://graph.microsoft.com/v1.0/me/onenote/resources/'
        '0-dup!1-d/$value">'
    )
    result = onenote_html_to_tiptap(tag + tag)
    images = [n for n in result["doc"]["content"] if n["type"] == "image"]
    assert len(images) == 2
    assert all(i["attrs"]["src"] == "import-ref://onenote-res://0-dup!1-d" for i in images)
    assert len(result["media"]) == 1


# ---------------------------------------------------------------------------
# _attr_value attribute-name-collision robustness (review round, task-5):
# a bare regex word boundary (\b) treats `-` as a boundary too, so a naive
# lookup for "src" could match the TAIL of "data-fullres-src" when that
# attribute happens to appear first in the tag -- pure luck of check-ordering
# (`_rewrite_resource_images` checks fullres before src) hid the bug, and
# real Microsoft Graph attribute ordering was unverified. `_attr_value` must
# require an actual attribute boundary before the name it's looking for.
# ---------------------------------------------------------------------------


def test_attr_value_with_reversed_attribute_order_does_not_collide():
    from api.services.journal_two.note_connectors.convert.onenote_html import _attr_value

    tag = (
        '<img data-fullres-src="https://graph.microsoft.com/v1.0/me/onenote/'
        'resources/0-FULL!1-x/$value" '
        'src="https://graph.microsoft.com/v1.0/me/onenote/resources/'
        '0-THUMB!1-y/$value">'
    )
    assert _attr_value(tag, "src") == (
        "https://graph.microsoft.com/v1.0/me/onenote/resources/0-THUMB!1-y/$value"
    )
    assert _attr_value(tag, "data-fullres-src") == (
        "https://graph.microsoft.com/v1.0/me/onenote/resources/0-FULL!1-x/$value"
    )


def test_resource_image_with_reversed_attribute_order_still_prefers_fullres():
    # End-to-end: even with data-fullres-src appearing BEFORE src in the tag
    # (the case pure check-ordering luck was hiding), resource-id extraction
    # still resolves to the fullres id, not the thumbnail's.
    html = (
        '<img data-fullres-src="https://graph.microsoft.com/v1.0/me/onenote/'
        'resources/0-FULL!1-x/$value?fullSize=true" '
        'src="https://graph.microsoft.com/v1.0/me/onenote/resources/'
        '0-THUMB!1-y/$value">'
    )
    result = onenote_html_to_tiptap(html)
    image = result["doc"]["content"][0]
    assert image["attrs"]["src"] == "import-ref://onenote-res://0-FULL!1-x"
    assert result["media"] == [{"ref": "onenote-res://0-FULL!1-x", "kind": "image", "name": "0-FULL!1-x"}]


# ---------------------------------------------------------------------------
# external <img src="https://…"> (not a onenote resource) stays a plain
# image ref -- never gets the onenote-res:// prefix
# ---------------------------------------------------------------------------


def test_external_image_is_left_as_a_plain_image_ref_no_onenote_res_prefix():
    html = '<img src="https://example.com/chart.png">'
    result = onenote_html_to_tiptap(html)
    image = result["doc"]["content"][0]
    assert image == {"type": "image", "attrs": {"src": "import-ref://https://example.com/chart.png"}}
    assert result["media"] == [
        {"ref": "https://example.com/chart.png", "kind": "image", "name": "chart.png"},
    ]
    assert "onenote-res://" not in image["attrs"]["src"]


def test_image_with_a_fullres_src_that_is_not_a_onenote_resource_url_is_also_external():
    # Defensive: data-fullres-src present but neither it nor src resolves to
    # a /onenote/resources/{id}/ path -- must not crash or half-apply the
    # onenote-res:// rewrite.
    html = '<img src="https://cdn.example.com/a.png" data-fullres-src="https://cdn.example.com/a-full.png">'
    result = onenote_html_to_tiptap(html)
    image = result["doc"]["content"][0]
    assert image["attrs"]["src"] == "import-ref://https://cdn.example.com/a.png"


# ---------------------------------------------------------------------------
# <object> attachment -> attachmentChip
# ---------------------------------------------------------------------------


def test_object_attachment_becomes_an_attachment_chip_with_the_real_name():
    html = (
        '<object data-attachment="Trip Notes.docx" '
        'data="https://graph.microsoft.com/v1.0/me/onenote/resources/0-att!1-x/$value" '
        'type="application/vnd.openxmlformats-officedocument.wordprocessingml.document" />'
    )
    result = onenote_html_to_tiptap(html)
    chips = _find_all(result["doc"], "attachmentChip")
    assert len(chips) == 1
    chip = chips[0]
    assert chip["attrs"]["href"] == "import-ref://onenote-res://0-att!1-x"
    # The real filename, NOT the opaque resource id mddoc.py's generic
    # basename-of-ref rule would otherwise have produced.
    assert chip["attrs"]["name"] == "Trip Notes.docx"

    assert result["media"] == [
        {"ref": "onenote-res://0-att!1-x", "kind": "file", "name": "Trip Notes.docx"},
    ]


def test_object_attachment_non_self_closing_form_also_works():
    html = (
        '<object data-attachment="report.pdf" '
        'data="https://graph.microsoft.com/v1.0/me/onenote/resources/0-att!1-y/$value">'
        "</object>"
    )
    result = onenote_html_to_tiptap(html)
    chip = _find_all(result["doc"], "attachmentChip")[0]
    assert chip["attrs"]["name"] == "report.pdf"
    assert chip["attrs"]["href"] == "import-ref://onenote-res://0-att!1-y"


def test_object_attachment_name_with_html_entity_is_decoded():
    html = (
        '<object data-attachment="Q&amp;A.pdf" '
        'data="https://graph.microsoft.com/v1.0/me/onenote/resources/0-att!1-z/$value" />'
    )
    result = onenote_html_to_tiptap(html)
    chip = _find_all(result["doc"], "attachmentChip")[0]
    assert chip["attrs"]["name"] == "Q&A.pdf"
    assert result["media"][0]["name"] == "Q&A.pdf"


def test_object_missing_data_attachment_or_data_is_left_untouched():
    # Not a recognized onenote attachment shape -- no attachmentChip should
    # appear, and nothing should crash.
    html = '<object data="https://graph.microsoft.com/v1.0/me/onenote/resources/0-x/$value"></object>'
    result = onenote_html_to_tiptap(html)
    assert _find_all(result["doc"], "attachmentChip") == []


# ---------------------------------------------------------------------------
# absolute-div unwrapped to its children
# ---------------------------------------------------------------------------


def test_position_absolute_wrapper_div_unwraps_to_its_children():
    html = (
        '<div style="position:absolute;left:96px;top:120px;width:400px;">'
        "<p>Hello wrapped</p>"
        "</div>"
    )
    result = onenote_html_to_tiptap(html)
    top = result["doc"]["content"]
    assert _types(top) == ["paragraph"]
    assert _plain_text(top[0]) == "Hello wrapped"


def test_nested_absolute_divs_all_unwrap():
    html = (
        '<div style="position:absolute;left:0px;top:0px;">'
        '<div style="position:absolute;left:10px;top:10px;">'
        "<p>Deeply wrapped</p>"
        "</div>"
        "</div>"
    )
    result = onenote_html_to_tiptap(html)
    top = result["doc"]["content"]
    assert _types(top) == ["paragraph"]
    assert _plain_text(top[0]) == "Deeply wrapped"


# ---------------------------------------------------------------------------
# a plain OneNote page (headings/lists/table/links) -> correct TipTap
# ---------------------------------------------------------------------------

PLAIN_ONENOTE_PAGE = """\
<html>
<head><title>Trading Journal — Week 12</title></head>
<body style="font-family:Calibri;">
<div style="position:absolute;left:48px;top:36px;">
<h1 style="font-size:22pt;">Week 12 Recap</h1>
<p>Overall a <b>solid</b> week, watch the <i>NVDA</i> setup closely.</p>
<ul>
<li>Reviewed the playbook</li>
<li>Flagged three setups</li>
</ul>
<ol start="1">
<li>Check premarket gappers</li>
<li>Update the watchlist</li>
</ol>
<table>
<tr><th>Symbol</th><th>Result</th></tr>
<tr><td>NVDA</td><td>+2.3R</td></tr>
</table>
<p>See the <a href="https://example.com/journal/week-11">prior week</a> for context.</p>
</div>
</body>
</html>
"""


def test_plain_onenote_page_produces_correct_tiptap():
    result = onenote_html_to_tiptap(PLAIN_ONENOTE_PAGE)
    _assert_in_vocabulary(result["doc"])
    top = result["doc"]["content"]

    # <head>/<title> never leaks in (mddoc.py's existing html_to_tiptap
    # behavior, inherited unchanged by this connector).
    full_text = _plain_text(result["doc"])
    assert "Trading Journal" not in full_text

    heading = next(n for n in top if n["type"] == "heading")
    assert _plain_text(heading) == "Week 12 Recap"

    para = next(n for n in top if n["type"] == "paragraph" and "solid" in _plain_text(n))
    marks_seen = {m["type"] for n in para["content"] for m in n.get("marks", [])}
    assert marks_seen == {"bold", "italic"}

    bullets = next(n for n in top if n["type"] == "bulletList")
    assert [_plain_text(li) for li in bullets["content"]] == ["Reviewed the playbook", "Flagged three setups"]

    ordered = next(n for n in top if n["type"] == "orderedList")
    assert [_plain_text(li) for li in ordered["content"]] == ["Check premarket gappers", "Update the watchlist"]

    table = next(n for n in top if n["type"] == "table")
    header_row, data_row = table["content"]
    assert [_plain_text(c) for c in header_row["content"]] == ["Symbol", "Result"]
    assert [_plain_text(c) for c in data_row["content"]] == ["NVDA", "+2.3R"]

    link_para = next(n for n in top if n["type"] == "paragraph" and "prior week" in _plain_text(n))
    link_text = next(n for n in link_para["content"] if n.get("text") == "prior week")
    assert link_text["marks"] == [{"type": "link", "attrs": {"href": "https://example.com/journal/week-11"}}]

    # No task lists on this page -- confirms the taskList branch stays inert
    # for a page with no data-uct-task marker, even after routing through
    # the full onenote pre-pass (not just raw html_to_tiptap).
    assert _find_all(result["doc"], "taskList") == []


def test_plain_onenote_page_end_to_end_with_a_todo_and_a_resource_image_mixed_in():
    html = PLAIN_ONENOTE_PAGE.replace(
        "</div>\n</body>",
        '<p data-tag="to-do:completed">Review this recap</p>'
        '<img src="https://graph.microsoft.com/v1.0/me/onenote/resources/0-recap!1-a/$value">'
        "</div>\n</body>",
    )
    result = onenote_html_to_tiptap(html)
    _assert_in_vocabulary(result["doc"])

    task_lists = _find_all(result["doc"], "taskList")
    assert len(task_lists) == 1
    assert task_lists[0]["content"][0]["attrs"]["checked"] is True
    assert _plain_text(task_lists[0]) == "Review this recap"

    images = _find_all(result["doc"], "image")
    assert images[-1]["attrs"]["src"] == "import-ref://onenote-res://0-recap!1-a"
    assert {"ref": "onenote-res://0-recap!1-a", "kind": "image", "name": "0-recap!1-a"} in result["media"]


# ---------------------------------------------------------------------------
# INERTNESS: mddoc.py's html_to_tiptap taskList branch must be a no-op for
# every existing caller -- Dropbox's `.html` path and any generic HTML never
# emit `data-uct-task`. A plain <ul><li> with no marker stays a normal
# bulletList.
# ---------------------------------------------------------------------------


def test_marker_free_html_through_html_to_tiptap_never_produces_a_tasklist():
    html = (
        "<h1>Trip Notes</h1>"
        "<p>Some <b>bold</b> and <i>italic</i> text.</p>"
        "<ul>"
        "<li>Fruit"
        "<ul><li>Apple</li><li>Banana</li></ul>"
        "</li>"
        "<li>Veggie</li>"
        "</ul>"
        '<ol start="3"><li>Third</li><li>Fourth</li></ol>'
        "<table><tr><th>Symbol</th><th>Chart</th></tr>"
        '<tr><td>NVDA</td><td><img src="https://example.com/charts/nvda.png"></td></tr></table>'
        '<p>Read the <a href="https://example.com/docs">docs</a> for details.</p>'
    )
    result = html_to_tiptap(html)

    assert _find_all(result["doc"], "taskList") == []
    assert _find_all(result["doc"], "taskItem") == []

    top = result["doc"]["content"]
    assert _types(top) == ["heading", "paragraph", "bulletList", "orderedList", "table", "paragraph"]

    bullets = top[2]
    assert bullets["type"] == "bulletList"
    fruit_item = bullets["content"][0]
    assert fruit_item["type"] == "listItem"
    assert _types(fruit_item["content"]) == ["paragraph", "bulletList"]


def test_a_li_with_a_foreign_data_uct_task_value_is_treated_as_a_plain_item():
    # Defensive: an unrecognized data-uct-task value (never emitted by
    # onenote_html.py's own pre-pass, which only ever writes "0"/"1") must
    # not be treated as a checkbox marker -- it degrades to a plain listItem
    # rather than crashing or silently defaulting to checked/unchecked.
    html = '<ul><li data-uct-task="maybe">Ambiguous</li><li>Plain</li></ul>'
    result = html_to_tiptap(html)
    top = result["doc"]["content"]
    assert _types(top) == ["bulletList"]
    assert [_plain_text(li) for li in top[0]["content"]] == ["Ambiguous", "Plain"]


def test_html_to_tiptap_task_marker_produces_taskitem_directly():
    # Direct unit coverage of the additive branch itself (mirrors the fixture
    # committed at convert/fixtures_in/07-onenote-task-list.html, which
    # exercises this same shape through the cross-language schema rail).
    html = '<ul><li data-uct-task="0">Unchecked</li><li data-uct-task="1">Checked</li></ul>'
    result = html_to_tiptap(html)
    top = result["doc"]["content"]
    assert _types(top) == ["taskList"]
    items = top[0]["content"]
    assert [i["attrs"]["checked"] for i in items] == [False, True]
    assert [_plain_text(i) for i in items] == ["Unchecked", "Checked"]


def test_html_to_tiptap_ordered_task_marker_also_splits_into_runs():
    # Visual-correctness assertion (review round, task-5): the source `<ol>`
    # numbers "Done" as item 5 and "Continue numbering" as item 6 -- the
    # trailing orderedList run must CONTINUE that numbering, not restart at
    # the <ol>'s own start=5. A prior version of this test only asserted the
    # split happened and missed that the second run silently reused start=5,
    # which renders the wrong number on screen for a numbered OneNote list
    # with an embedded checkbox item.
    html = '<ol start="5"><li data-uct-task="1">Done</li><li>Continue numbering</li></ol>'
    result = html_to_tiptap(html)
    top = result["doc"]["content"]
    assert _types(top) == ["taskList", "orderedList"]
    assert top[1]["attrs"]["start"] == 6


def test_html_to_tiptap_ordered_task_marker_numbering_continues_across_multiple_runs():
    # A task run in the MIDDLE of a longer ordered list: A=3 (first run's own
    # start), B is the task item consuming ordinal 4, so the trailing run
    # (C, D) must start at 5 -- accounting for BOTH preceding runs' items,
    # not just the immediately-prior one.
    html = '<ol start="3"><li>A</li><li data-uct-task="0">B</li><li>C</li><li>D</li></ol>'
    result = html_to_tiptap(html)
    top = result["doc"]["content"]
    assert _types(top) == ["orderedList", "taskList", "orderedList"]
    assert top[0]["attrs"]["start"] == 3
    assert [_plain_text(li) for li in top[0]["content"]] == ["A"]
    assert top[2]["attrs"]["start"] == 5
    assert [_plain_text(li) for li in top[2]["content"]] == ["C", "D"]


def test_html_to_tiptap_ordered_list_without_a_task_marker_keeps_its_own_start_unchanged():
    # Regression guard: the numbering-continuation fix touches ONLY the
    # task-marker-present branch of _html_list_or_tasklist -- an ordinary
    # <ol> with no data-uct-task anywhere must still fall straight through to
    # the original, unmodified _html_convert_list (single node, start taken
    # verbatim from the <ol>'s own attribute).
    html = '<ol start="7"><li>One</li><li>Two</li></ol>'
    result = html_to_tiptap(html)
    top = result["doc"]["content"]
    assert _types(top) == ["orderedList"]
    assert top[0]["attrs"]["start"] == 7
