"""Tests for the server-side markdown -> TipTap converter (`mddoc.py`) and the
placeholder-rewrite pass (`rewrite.py`).

`mddoc.md_to_tiptap` is the Python port of the wizard's browser pipeline
(markdown-it -> generateJSON), emitting TipTap JSON DIRECTLY via a
markdown-it-py token walk (no DOM/HTML step, since background sync jobs have
no browser). `rewrite.rewrite_body` is a pure port of
`app/src/pages/journal-2-0/lib/importer/commit.js`'s `rewriteBody` — read that
file in full before touching this one; its semantics are the behavioral
contract this file pins.

Node vocabulary under test (must stay inside `tiptap.js::buildExtensions`):
doc/paragraph/heading(1-3)/bulletList/orderedList/listItem/taskList/
taskItem(checked)/table/tableRow/tableHeader/tableCell/codeBlock(language)/
blockquote/horizontalRule/hardBreak/image(src)/attachmentChip(href,name,size)/
text with marks bold/italic/strike/code/link(href).
"""

from __future__ import annotations

import copy
import json

from api.services.journal_two.note_connectors.convert.mddoc import md_to_tiptap
from api.services.journal_two.note_connectors.convert.rewrite import rewrite_body


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _types(nodes):
    return [n["type"] for n in nodes]


def _plain_text(node):
    """Concatenate every text node under `node`, depth-first — a convenience
    for asserting on rendered text without hand-writing every mark-split run."""
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
# md_to_tiptap — empty input
# ---------------------------------------------------------------------------


def test_empty_markdown_produces_a_valid_empty_doc():
    result = md_to_tiptap("")
    assert result["doc"] == {"type": "doc", "content": []}
    assert result["media"] == []
    assert result["links"] == []


def test_none_and_whitespace_only_markdown_also_produce_an_empty_doc():
    assert md_to_tiptap(None)["doc"] == {"type": "doc", "content": []}
    assert md_to_tiptap("   \n\n  ")["doc"] == {"type": "doc", "content": []}


# ---------------------------------------------------------------------------
# The golden fixture — one document exercising every construct in the brief.
# ---------------------------------------------------------------------------

GOLDEN_MD = """\
# Title One

## Section Two

### Sub Three

##### Should Clamp

Some *italic*, **bold**, ~~strikethrough~~, and `inline code` text.

- Fruit
  - Apple
  - Banana
- Veggie

1. First
2. Second

- [x] Done thing
- [ ] Todo thing

| Col A | Col B |
| --- | --- |
| one | two |
| three | four |

```python
print("hello")
```

> A quoted line
> continues here

![Chart](images/chart.png)

Read the [design doc](https://example.com/design) for details.

Linked via [another note](import-link://obsidian:Vault/Other.md).

---

End of note.
"""


def test_golden_fixture_top_level_block_sequence():
    result = md_to_tiptap(GOLDEN_MD)
    top = result["doc"]["content"]
    assert _types(top) == [
        "heading",  # Title One
        "heading",  # Section Two
        "heading",  # Sub Three
        "heading",  # Should Clamp (clamped from h5)
        "paragraph",  # marks paragraph
        "bulletList",
        "orderedList",
        "taskList",
        "table",
        "codeBlock",
        "blockquote",
        "image",  # hoisted out of its own paragraph
        "paragraph",  # design doc link
        "paragraph",  # import-link:// link
        "horizontalRule",
        "paragraph",  # End of note.
    ]


def test_golden_fixture_heading_levels_clamp_4_to_6_down_to_3():
    result = md_to_tiptap(GOLDEN_MD)
    headings = [n for n in result["doc"]["content"] if n["type"] == "heading"]
    assert [h["attrs"]["level"] for h in headings] == [1, 2, 3, 3]
    assert [_plain_text(h) for h in headings] == [
        "Title One", "Section Two", "Sub Three", "Should Clamp",
    ]


def test_golden_fixture_marks_paragraph_text_and_marks():
    result = md_to_tiptap(GOLDEN_MD)
    para = result["doc"]["content"][4]
    assert para["type"] == "paragraph"
    assert _plain_text(para) == "Some italic, bold, strikethrough, and inline code text."

    by_text = {n["text"]: n.get("marks", []) for n in para["content"] if n["type"] == "text"}
    assert by_text["italic"] == [{"type": "italic"}]
    assert by_text["bold"] == [{"type": "bold"}]
    assert by_text["strikethrough"] == [{"type": "strike"}]
    assert by_text["inline code"] == [{"type": "code"}]


def test_golden_fixture_nested_list_shape_paragraph_then_nested_list():
    result = md_to_tiptap(GOLDEN_MD)
    bullet_list = result["doc"]["content"][5]
    assert bullet_list["type"] == "bulletList"
    items = bullet_list["content"]
    assert len(items) == 2
    fruit_item, veggie_item = items
    assert fruit_item["type"] == "listItem"
    # listItem content: paragraph FIRST, then the nested list.
    assert _types(fruit_item["content"]) == ["paragraph", "bulletList"]
    assert _plain_text(fruit_item["content"][0]) == "Fruit"
    nested = fruit_item["content"][1]
    assert nested["type"] == "bulletList"
    nested_items = nested["content"]
    assert [i["type"] for i in nested_items] == ["listItem", "listItem"]
    assert [_plain_text(i) for i in nested_items] == ["Apple", "Banana"]
    # nested items are NOT task items and carry no `attrs`
    assert "attrs" not in nested_items[0]

    assert veggie_item["type"] == "listItem"
    assert _types(veggie_item["content"]) == ["paragraph"]
    assert _plain_text(veggie_item) == "Veggie"


def test_golden_fixture_ordered_list():
    result = md_to_tiptap(GOLDEN_MD)
    ordered = result["doc"]["content"][6]
    assert ordered["type"] == "orderedList"
    assert ordered["attrs"]["start"] == 1
    assert [i["type"] for i in ordered["content"]] == ["listItem", "listItem"]
    assert [_plain_text(i) for i in ordered["content"]] == ["First", "Second"]


def test_golden_fixture_task_list_checked_states():
    result = md_to_tiptap(GOLDEN_MD)
    task_list = result["doc"]["content"][7]
    assert task_list["type"] == "taskList"
    items = task_list["content"]
    assert [i["type"] for i in items] == ["taskItem", "taskItem"]
    assert [i["attrs"]["checked"] for i in items] == [True, False]
    assert [_plain_text(i) for i in items] == ["Done thing", "Todo thing"]
    # Each taskItem wraps its text in a paragraph, per the editor's shape.
    for item in items:
        assert _types(item["content"]) == ["paragraph"]


def test_golden_fixture_table_shape_header_row_then_data_rows():
    result = md_to_tiptap(GOLDEN_MD)
    table = result["doc"]["content"][8]
    assert table["type"] == "table"
    rows = table["content"]
    assert len(rows) == 3
    assert all(r["type"] == "tableRow" for r in rows)

    header_row, row1, row2 = rows
    assert [c["type"] for c in header_row["content"]] == ["tableHeader", "tableHeader"]
    assert [_plain_text(c) for c in header_row["content"]] == ["Col A", "Col B"]
    # every header/data cell wraps its text in a paragraph
    assert _types(header_row["content"][0]["content"]) == ["paragraph"]

    assert [c["type"] for c in row1["content"]] == ["tableCell", "tableCell"]
    assert [_plain_text(c) for c in row1["content"]] == ["one", "two"]
    assert [_plain_text(c) for c in row2["content"]] == ["three", "four"]


def test_golden_fixture_fenced_code_block_with_language():
    result = md_to_tiptap(GOLDEN_MD)
    code = result["doc"]["content"][9]
    assert code["type"] == "codeBlock"
    assert code["attrs"]["language"] == "python"
    assert _plain_text(code) == 'print("hello")'


def test_golden_fixture_blockquote_wraps_a_paragraph():
    result = md_to_tiptap(GOLDEN_MD)
    quote = result["doc"]["content"][10]
    assert quote["type"] == "blockquote"
    assert _types(quote["content"]) == ["paragraph"]
    # a soft line break inside the quote reads as a space, matching default
    # (non-`breaks`) markdown-it rendering
    assert _plain_text(quote) == "A quoted line continues here"


def test_golden_fixture_image_hoisted_to_block_level_with_media_entry():
    result = md_to_tiptap(GOLDEN_MD)
    image = result["doc"]["content"][11]
    assert image == {"type": "image", "attrs": {"src": "import-ref://images/chart.png"}}
    assert result["media"] == [{"ref": "images/chart.png", "kind": "image", "name": "chart.png"}]


def test_golden_fixture_plain_link_passes_href_through_as_a_mark():
    result = md_to_tiptap(GOLDEN_MD)
    para = result["doc"]["content"][12]
    assert _plain_text(para) == "Read the design doc for details."
    link_text = next(n for n in para["content"] if n["text"] == "design doc")
    assert link_text["marks"] == [{"type": "link", "attrs": {"href": "https://example.com/design"}}]


def test_golden_fixture_import_link_href_passes_through_and_is_recorded():
    result = md_to_tiptap(GOLDEN_MD)
    para = result["doc"]["content"][13]
    assert _plain_text(para) == "Linked via another note."
    link_text = next(n for n in para["content"] if n["text"] == "another note")
    assert link_text["marks"] == [
        {"type": "link", "attrs": {"href": "import-link://obsidian:Vault/Other.md"}}
    ]
    assert result["links"] == ["obsidian:Vault/Other.md"]


def test_golden_fixture_horizontal_rule_and_trailing_paragraph():
    result = md_to_tiptap(GOLDEN_MD)
    assert result["doc"]["content"][14] == {"type": "horizontalRule"}
    trailer = result["doc"]["content"][15]
    assert trailer["type"] == "paragraph"
    assert _plain_text(trailer) == "End of note."


# ---------------------------------------------------------------------------
# Focused edge cases not worth folding into the golden fixture
# ---------------------------------------------------------------------------


def test_hard_break_inside_a_paragraph():
    result = md_to_tiptap("line one\\\nline two\n")
    para = result["doc"]["content"][0]
    assert _types(para["content"]) == ["text", "hardBreak", "text"]
    assert [n.get("text") for n in para["content"] if n["type"] == "text"] == ["line one", "line two"]


def test_bold_and_link_marks_compose_on_one_text_run():
    result = md_to_tiptap("[**bold link**](https://example.com)\n")
    para = result["doc"]["content"][0]
    text_node = next(n for n in para["content"] if n["text"] == "bold link")
    marks_by_type = {m["type"] for m in text_node["marks"]}
    assert marks_by_type == {"bold", "link"}
    link_mark = next(m for m in text_node["marks"] if m["type"] == "link")
    assert link_mark["attrs"]["href"] == "https://example.com"


def test_ordered_list_custom_start_is_preserved():
    result = md_to_tiptap("5. five\n6. six\n")
    ordered = result["doc"]["content"][0]
    assert ordered["type"] == "orderedList"
    assert ordered["attrs"]["start"] == 5


def test_image_mid_paragraph_splits_surrounding_text_into_separate_paragraphs():
    # TipTap's Image node is block-level (`inline: false` in tiptap.js), so an
    # image mid-sentence must be hoisted out, not nested inside a paragraph's
    # inline content (which would be schema-invalid in the real editor).
    result = md_to_tiptap("before text ![alt](pic.png) after text\n")
    top = result["doc"]["content"]
    assert _types(top) == ["paragraph", "image", "paragraph"]
    # the source-adjacent whitespace around the image is preserved verbatim,
    # not trimmed
    assert _plain_text(top[0]) == "before text "
    assert top[1]["attrs"]["src"] == "import-ref://pic.png"
    assert _plain_text(top[2]) == " after text"


def test_import_ref_prefixed_image_src_passes_through_untouched_no_new_media_entry():
    result = md_to_tiptap("![already placeholder](import-ref://v/existing.png)\n")
    image = result["doc"]["content"][0]
    assert image == {"type": "image", "attrs": {"src": "import-ref://v/existing.png"}}
    # already-prefixed -> connector already registered this media; mddoc must
    # not double-wrap the src or add a second media entry for it.
    assert result["media"] == []


def test_indented_code_block_has_no_language():
    result = md_to_tiptap("    indented code\n    line two\n")
    code = result["doc"]["content"][0]
    assert code["type"] == "codeBlock"
    assert code["attrs"]["language"] is None
    assert _plain_text(code) == "indented code\nline two"


def test_html_block_degrades_to_a_visible_paragraph_not_dropped_or_crashed():
    result = md_to_tiptap("<div>raw html block</div>\n")
    top = result["doc"]["content"]
    assert len(top) == 1
    assert top[0]["type"] == "paragraph"
    assert "raw html block" in _plain_text(top[0])


# ---------------------------------------------------------------------------
# rewrite_body — pure port of commit.js's rewriteBody. Two describe-block
# cases mirrored verbatim from commit.test.js, plus attachmentChip coverage
# (not shown in the JS spec file, but load-bearing per the task brief) and an
# explicit no-mutation check.
# ---------------------------------------------------------------------------


def _doc(content):
    return {"type": "doc", "content": content}


def _img(src):
    return {"type": "image", "attrs": {"src": src}}


def test_rewrite_body_swaps_media_resolves_links_drops_failed_media_by_name():
    body = _doc([
        _img("import-ref://v/a.png"),
        {
            "type": "paragraph",
            "content": [{
                "type": "text", "text": "go",
                "marks": [{"type": "link", "attrs": {"href": "import-link://obsidian:v/b.md"}}],
            }],
        },
        _img("import-ref://v/missing.png"),
    ])

    out, dropped_media = rewrite_body(
        body,
        media_urls={"v/a.png": "/api/j2/notes/attachments/u/n/inline/x.png"},
        id_by_key={"obsidian:v/b.md": "note42"},
    )

    assert out["content"][0]["attrs"]["src"] == "/api/j2/notes/attachments/u/n/inline/x.png"
    assert out["content"][1]["content"][0]["marks"][0]["attrs"]["href"] == \
        "/journal?j2tab=notebook&note=note42"
    # the resolved image survives (swapped src); the missing one is dropped
    assert [n for n in out["content"] if n["type"] == "image"] == [
        {"type": "image", "attrs": {"src": "/api/j2/notes/attachments/u/n/inline/x.png"}},
    ]
    assert dropped_media == ["v/missing.png"]


def test_rewrite_body_removes_unresolved_link_mark_but_keeps_the_text():
    body = _doc([{
        "type": "paragraph",
        "content": [{
            "type": "text", "text": "ghost",
            "marks": [{"type": "link", "attrs": {"href": "import-link://obsidian:gone.md"}}],
        }],
    }])

    out, dropped_media = rewrite_body(body, media_urls={}, id_by_key={})

    text_node = out["content"][0]["content"][0]
    assert text_node.get("marks", []) == []
    assert text_node["text"] == "ghost"
    assert dropped_media == []


def test_rewrite_body_swaps_attachment_chip_href_and_drops_missing_by_name():
    body = _doc([
        {"type": "attachmentChip", "attrs": {"href": "import-ref://book.xlsx", "name": "book.xlsx", "size": None}},
        {"type": "attachmentChip", "attrs": {"href": "import-ref://missing.pdf", "name": "missing.pdf", "size": None}},
    ])

    out, dropped_media = rewrite_body(
        body,
        media_urls={"book.xlsx": "/files/1"},
        id_by_key={},
    )

    chips = out["content"]
    assert chips[0]["attrs"]["href"] == "/files/1"
    assert chips[0]["attrs"]["name"] == "book.xlsx"  # untouched sibling attr
    assert dropped_media == ["missing.pdf"]
    # the unresolved chip is dropped from its parent's content entirely
    assert len(chips) == 1


def test_rewrite_body_leaves_a_non_placeholder_image_src_untouched():
    body = _doc([_img("https://cdn.example.com/already-real.png")])
    out, dropped_media = rewrite_body(body, media_urls={}, id_by_key={})
    assert out["content"][0]["attrs"]["src"] == "https://cdn.example.com/already-real.png"
    assert dropped_media == []


def test_rewrite_body_deep_walks_tables_and_lists():
    body = _doc([{
        "type": "table",
        "content": [{
            "type": "tableRow",
            "content": [{
                "type": "tableCell",
                "content": [{
                    "type": "paragraph",
                    "content": [_img("import-ref://cell.png")],
                }],
            }],
        }],
    }])
    out, dropped_media = rewrite_body(body, media_urls={"cell.png": "/u/cell.png"}, id_by_key={})
    cell_para = out["content"][0]["content"][0]["content"][0]["content"][0]
    assert cell_para["content"][0]["attrs"]["src"] == "/u/cell.png"
    assert dropped_media == []


def test_rewrite_body_is_pure_never_mutates_its_input():
    body = _doc([
        _img("import-ref://v/a.png"),
        {
            "type": "paragraph",
            "content": [{
                "type": "text", "text": "go",
                "marks": [{"type": "link", "attrs": {"href": "import-link://k"}}],
            }],
        },
    ])
    snapshot = json.dumps(body, sort_keys=True)

    out, _dropped = rewrite_body(
        body, media_urls={"v/a.png": "/x.png"}, id_by_key={"k": "note1"},
    )

    # input is byte-identical after the call...
    assert json.dumps(body, sort_keys=True) == snapshot

    # ...and mutating the OUTPUT must not reach back into the input (no
    # aliased sub-dicts/lists left over from a shallow copy).
    out["content"][0]["attrs"]["src"] = "MUTATED"
    out["content"].append({"type": "horizontalRule"})
    del out["content"][1]["content"][0]["text"]
    assert json.dumps(body, sort_keys=True) == snapshot


def test_rewrite_body_on_an_empty_doc_is_a_no_op():
    body = {"type": "doc", "content": []}
    out, dropped_media = rewrite_body(body, media_urls={}, id_by_key={})
    assert out == {"type": "doc", "content": []}
    assert dropped_media == []


def test_rewrite_body_defaults_media_urls_and_id_by_key_to_empty():
    body = _doc([_img("import-ref://x.png")])
    out, dropped_media = rewrite_body(body)
    assert dropped_media == ["x.png"]
    assert [n for n in out["content"] if n["type"] == "image"] == []


# ---------------------------------------------------------------------------
# Fix-round findings (code review): 2 Criticals + 2 Importants + 2 minors.
# Verified against the installed @tiptap/extension-{heading,table,list}
# source (not assumed): Heading content = `inline*` (no block image child
# allowed), TableCell/TableHeader content = `block+` (an image CAN sit as a
# paragraph's sibling inside a cell), TaskList content = `taskItem+` and
# BulletList/OrderedList content = `listItem+` (mixing is schema-invalid).
# ---------------------------------------------------------------------------


def test_image_inside_a_heading_is_hoisted_out_not_embedded():
    # Critical 1a. Heading's content model is inline-only; an Image node
    # (block-level) inside heading.content would be schema-invalid.
    result = md_to_tiptap("# Title ![i](x.png)\n")
    top = result["doc"]["content"]
    assert _types(top) == ["heading", "image"]
    heading = top[0]
    assert all(n.get("type") != "image" for n in heading["content"])
    assert _plain_text(heading) == "Title "
    assert top[1]["attrs"]["src"] == "import-ref://x.png"


def test_image_inside_a_table_cell_is_a_sibling_block_not_embedded_in_the_paragraph():
    # Critical 1b. TableCell/TableHeader content is block+, so an image is
    # valid as a SIBLING of the cell's paragraph (not inside it).
    result = md_to_tiptap("| A |\n| --- |\n| ![i](x.png) |\n")
    table = result["doc"]["content"][0]
    assert table["type"] == "table"
    cell = table["content"][1]["content"][0]  # first data row, first cell
    assert cell["type"] == "tableCell"
    assert _types(cell["content"]) == ["image"]
    assert cell["content"][0]["attrs"]["src"] == "import-ref://x.png"
    # never embedded inside the (now-absent, since the cell was ONLY an
    # image) or any other paragraph's content array
    for node in cell["content"]:
        if node["type"] == "paragraph":
            assert all(n.get("type") != "image" for n in node.get("content", []))


def test_image_beside_text_in_a_table_cell_splits_paragraph_then_image():
    result = md_to_tiptap("| A |\n| --- |\n| before ![i](x.png) |\n")
    table = result["doc"]["content"][0]
    cell = table["content"][1]["content"][0]
    assert _types(cell["content"]) == ["paragraph", "image"]
    assert _plain_text(cell["content"][0]) == "before "


def test_mixed_task_and_plain_list_splits_into_adjacent_runs():
    # Critical 2. A single bulletList can't hold both taskItem and listItem
    # children — split into consecutive same-kind runs.
    result = md_to_tiptap("- [ ] a\n- plain\n- [x] b\n")
    top = result["doc"]["content"]
    assert _types(top) == ["taskList", "bulletList", "taskList"]
    assert len(top[0]["content"]) == 1
    assert top[0]["content"][0]["attrs"]["checked"] is False
    assert _plain_text(top[0]) == "a"
    assert len(top[1]["content"]) == 1
    assert top[1]["content"][0]["type"] == "listItem"
    assert _plain_text(top[1]) == "plain"
    assert len(top[2]["content"]) == 1
    assert top[2]["content"][0]["attrs"]["checked"] is True
    assert _plain_text(top[2]) == "b"


def test_mixed_task_and_plain_list_nested_also_splits_into_runs():
    md = (
        "- [ ] Top task\n"
        "  - Nested plain\n"
        "  - [x] Nested task\n"
        "- Plain top\n"
    )
    result = md_to_tiptap(md)
    top = result["doc"]["content"]
    assert _types(top) == ["taskList", "bulletList"]

    top_task_item = top[0]["content"][0]
    assert top_task_item["type"] == "taskItem"
    assert top_task_item["attrs"]["checked"] is False
    # nested content: paragraph("Top task"), then the nested mixed list's
    # own split runs (bulletList, taskList)
    assert _types(top_task_item["content"]) == ["paragraph", "bulletList", "taskList"]
    nested_bullet = top_task_item["content"][1]
    nested_task = top_task_item["content"][2]
    assert _plain_text(nested_bullet) == "Nested plain"
    assert nested_task["content"][0]["attrs"]["checked"] is True
    assert _plain_text(nested_task) == "Nested task"

    assert _plain_text(top[1]) == "Plain top"


def test_ordered_list_run_after_a_task_run_keeps_its_own_marker_number():
    result = md_to_tiptap("5. [ ] a task\n6. plain six\n")
    top = result["doc"]["content"]
    assert _types(top) == ["taskList", "orderedList"]
    assert top[1]["attrs"]["start"] == 6


def test_data_uri_image_gets_a_bounded_synthetic_ref():
    # Important 3. A tiny 1x1 transparent PNG, base64-encoded.
    tiny_png_b64 = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY"
        "42YAAAAASUVORK5CYII="
    )
    src = f"data:image/png;base64,{tiny_png_b64}"
    result = md_to_tiptap(f"![tiny]({src})\n")
    image = result["doc"]["content"][0]
    assert image["type"] == "image"
    assert image["attrs"]["src"] == "import-ref://md-img-1.png"
    assert len(image["attrs"]["src"]) < 100  # bounded, not the whole payload

    assert len(result["media"]) == 1
    entry = result["media"][0]
    assert entry["ref"] == "md-img-1.png"
    assert entry["kind"] == "image"
    assert entry["name"] == "md-img-1.png"
    assert entry["data_uri"] == src


def test_multiple_data_uri_images_get_distinct_incrementing_refs():
    b64 = "AAAA"
    src1 = f"data:image/png;base64,{b64}"
    src2 = f"data:image/jpeg;base64,{b64}"
    result = md_to_tiptap(f"![a]({src1}) ![b]({src2})\n")
    refs = [n["attrs"]["src"] for n in result["doc"]["content"] if n["type"] == "image"]
    assert refs == ["import-ref://md-img-1.png", "import-ref://md-img-2.jpg"]
    assert [m["ref"] for m in result["media"]] == ["md-img-1.png", "md-img-2.jpg"]


def test_unsupported_data_uri_mime_degrades_image_to_visible_text():
    # An SVG data URI (not in the png/jpeg/gif/webp allowlist) never even
    # reaches _image_node through real markdown parsing: markdown-it-py's
    # OWN image-destination validator (`markdown_it.common.normalize_url`,
    # `GOOD_DATA_RE = r"^data:image\/(gif|png|jpeg|webp);"`) restricts data:
    # image sources to the exact same four MIME types mddoc.py supports —
    # anything else fails to tokenize as an image AT ALL and falls back to
    # literal, unbounded markdown source text (a separate, pre-existing
    # markdown-it-py behavior, out of scope for this fix). So the "unknown
    # mime -> visible text" branch this test covers is exercised directly
    # against the internal helper — defense-in-depth against a future
    # markdown-it-py upgrade loosening that upstream gate, per the review
    # finding's explicit "unknown -> skip image" requirement.
    from api.services.journal_two.note_connectors.convert import mddoc

    ctx = mddoc._Ctx()
    node = mddoc._data_uri_image_node("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", ctx)
    assert node is None
    assert ctx.media == []


def test_non_base64_data_uri_also_degrades_image_to_visible_text():
    # Same reasoning as above: a malformed (non-base64) data URI never
    # reaches an "image" token through real parsing either — tested directly
    # against the internal helper.
    from api.services.journal_two.note_connectors.convert import mddoc

    ctx = mddoc._Ctx()
    node = mddoc._data_uri_image_node("data:image/png,not-base64-at-all", ctx)
    assert node is None
    assert ctx.media == []


def test_data_uri_image_end_to_end_through_inline_nodes_when_unsupported():
    # The PUBLIC-entrypoint-reachable path for the "unknown -> visible text"
    # branch: call `_inline_nodes` directly with a synthetic `image` token
    # whose src is an unsupported data URI (bypassing markdown-it-py's own
    # upstream gate, which a real `![x](data:image/svg+xml;...)` markdown
    # string cannot get past — see the two tests above). This proves
    # `_inline_nodes` degrades to "[unsupported image]" text if it is ever
    # handed such a token by any future caller/plugin change.
    from markdown_it.token import Token

    from api.services.journal_two.note_connectors.convert import mddoc

    ctx = mddoc._Ctx()
    tok = Token("image", "img", 0)
    tok.attrs = {"src": "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="}
    items = mddoc._inline_nodes([tok], ctx)
    assert len(items) == 1
    assert items[0]["type"] == "text"
    assert items[0]["text"] == "[unsupported image]"
    assert ctx.media == []


def test_link_with_a_default_allowed_scheme_keeps_its_mark():
    # Important 4. The real editor's protocols:['https'] config APPENDS to
    # (never replaces) tiptap's built-in default allowlist, which already
    # includes http/https/ftp/ftps/mailto/tel/callto/sms/cid/xmpp — verified
    # against the installed @tiptap/extension-link@3.23.6 source. So a plain
    # http:// link is, in fact, allowed by the real editor.
    for href in (
        "http://example.com",
        "https://example.com",
        "ftp://example.com/file",
        "mailto:a@example.com",
    ):
        result = md_to_tiptap(f"[text]({href})\n")
        para = result["doc"]["content"][0]
        text_node = next(n for n in para["content"] if n["text"] == "text")
        assert text_node.get("marks") == [{"type": "link", "attrs": {"href": href}}], href


def test_link_with_a_disallowed_scheme_strips_the_mark_keeps_the_text():
    # `whatsapp://...` is the reachable case: markdown-it-py's OWN link
    # validator (`normalize_url.BAD_PROTO_RE = ^(vbscript|javascript|file|
    # data):`) only blocks those four prefixes, so an arbitrary custom
    # scheme like this one DOES become a link_open token (verified) — unlike
    # `javascript:`, which markdown-it-py's parser refuses to tokenize as a
    # link AT ALL (falls back to raw literal source text, a layer earlier
    # than mddoc.py's own `_is_allowed_link_href` ever runs). This is the
    # case that actually exercises the Tiptap-allowlist check.
    result = md_to_tiptap("[text](whatsapp://send?text=hi)\n")
    para = result["doc"]["content"][0]
    assert _plain_text(para) == "text"
    for n in para["content"]:
        if n.get("type") == "text":
            assert n.get("marks", []) == []


def test_javascript_scheme_link_never_becomes_a_mark_either_markdown_it_blocks_it_first():
    # Documents the OTHER defense layer: markdown-it-py's own parser already
    # refuses to tokenize a `javascript:` destination as a link at all (same
    # BAD_PROTO_RE gate noted above), so this never even reaches
    # `_is_allowed_link_href`. End result is the same (no link mark reaches
    # the doc) via a different mechanism — raw source text, unparsed.
    result = md_to_tiptap("[text](javascript:alert(1))\n")
    para = result["doc"]["content"][0]
    assert "javascript:" in _plain_text(para)
    for n in para["content"]:
        if n.get("type") == "text":
            assert n.get("marks", []) == []


def test_relative_and_journal_and_import_link_hrefs_still_allowed():
    for href in ("/journal?j2tab=notebook&note=1", "import-link://obsidian:x.md", "#anchor"):
        result = md_to_tiptap(f"[text]({href})\n")
        para = result["doc"]["content"][0]
        text_node = next(n for n in para["content"] if n["text"] == "text")
        assert text_node["marks"][0]["attrs"]["href"] == href


def test_media_dedup_by_ref_minor():
    # Minor: the SAME image src referenced twice must not produce two media
    # entries (JS parity, `dedupeMedia`) — both occurrences still carry the
    # placeholder pointing at the one registered ref.
    result = md_to_tiptap("![a](shared.png)\n\n![b](shared.png)\n")
    assert len(result["media"]) == 1
    assert result["media"][0]["ref"] == "shared.png"
    images = [n for n in result["doc"]["content"] if n["type"] == "image"]
    assert [img["attrs"]["src"] for img in images] == [
        "import-ref://shared.png", "import-ref://shared.png",
    ]


def test_ref_and_link_prefix_constants_are_the_single_package_authority():
    # Minor: both modules now import the SAME constants from the package
    # __init__ rather than each defining their own copy.
    from api.services.journal_two.note_connectors import convert as convert_pkg
    from api.services.journal_two.note_connectors.convert import mddoc, rewrite

    assert mddoc.REF_PREFIX is convert_pkg.REF_PREFIX
    assert mddoc.LINK_PREFIX is convert_pkg.LINK_PREFIX
    assert rewrite.REF_PREFIX is convert_pkg.REF_PREFIX
    assert rewrite.LINK_PREFIX is convert_pkg.LINK_PREFIX
