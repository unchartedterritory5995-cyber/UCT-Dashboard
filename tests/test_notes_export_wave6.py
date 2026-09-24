"""Wave 6 (editor lane D) -- Markdown export of the new editor content.

One section per item, added with the item. The export is a trust artifact
(`notes_export.py` module docstring): a member checks whether their notes
survived, so every new block must come out as something a Markdown reader
shows, and a member's words must never be dropped.
"""
from __future__ import annotations

from api.services.journal_two.notes_export import tiptap_to_markdown


def _doc(*content):
    return {"type": "doc", "content": list(content)}


def _para(text=None, *inline):
    if text is None and not inline:
        return {"type": "paragraph"}
    kids = ([{"type": "text", "text": text}] if text else []) + list(inline)
    return {"type": "paragraph", "content": kids}


# ── item 1: tables export as GFM ─────────────────────────────────────────────

def _cell(*blocks, kind="tableCell", **attrs):
    node = {"type": kind, "content": list(blocks) or [_para()]}
    if attrs:
        node["attrs"] = attrs
    return node


def _row(*cells):
    return {"type": "tableRow", "content": list(cells)}


def _table(*rows):
    return {"type": "table", "content": list(rows)}


def test_a_header_row_table_is_a_plain_gfm_table():
    md = tiptap_to_markdown(_doc(_table(
        _row(_cell(_para("Sym"), kind="tableHeader"), _cell(_para("R"), kind="tableHeader")),
        _row(_cell(_para("NVDA")), _cell(_para("2.1"))),
    )))
    assert md == "| Sym | R |\n| --- | --- |\n| NVDA | 2.1 |"


def test_a_table_WITHOUT_a_header_row_gets_a_blank_header_never_a_promoted_data_row():
    md = tiptap_to_markdown(_doc(_table(
        _row(_cell(_para("NVDA")), _cell(_para("2.1"))),
        _row(_cell(_para("AMD")), _cell(_para("1.4"))),
    )))
    lines = md.split("\n")
    assert lines[0] == "|  |  |"
    assert lines[1] == "| --- | --- |"
    assert lines[2:] == ["| NVDA | 2.1 |", "| AMD | 1.4 |"]


def test_a_pipe_in_a_cell_is_escaped_so_it_does_not_split_the_cell():
    md = tiptap_to_markdown(_doc(_table(
        _row(_cell(_para("A"), kind="tableHeader")),
        _row(_cell(_para("long | short"))),
    )))
    assert md.split("\n")[2] == "| long \\| short |"


def test_a_cell_with_two_paragraphs_or_a_line_break_stays_ONE_row():
    br = {"type": "hardBreak"}
    md = tiptap_to_markdown(_doc(_table(
        _row(_cell(_para("H"), kind="tableHeader")),
        _row(_cell(_para("first"), _para("second"))),
        _row(_cell(_para("line one", br, {"type": "text", "text": "line two"}))),
    )))
    lines = md.split("\n")
    assert len(lines) == 4, md
    assert lines[2] == "| first<br>second |"
    assert lines[3] == "| line one<br>line two |"


def test_ragged_rows_are_padded_and_a_merged_cell_keeps_its_neighbours_in_their_columns():
    md = tiptap_to_markdown(_doc(_table(
        _row(_cell(_para("A"), kind="tableHeader"), _cell(_para("B"), kind="tableHeader"),
             _cell(_para("C"), kind="tableHeader")),
        _row(_cell(_para("wide"), colspan=2), _cell(_para("c"))),
        _row(_cell(_para("only"))),
    )))
    lines = md.split("\n")
    assert lines[2] == "| wide |  | c |"
    assert lines[3] == "| only |  |  |"
    assert all(ln.count(" | ") == 2 for ln in lines), md


def test_column_alignment_becomes_the_delimiter_row():
    md = tiptap_to_markdown(_doc(_table(
        _row(_cell(_para("L"), kind="tableHeader", align="left"),
             _cell(_para("C"), kind="tableHeader", align="center"),
             _cell(_para("R"), kind="tableHeader", align="right"),
             _cell(_para("N"), kind="tableHeader")),
        _row(_cell(_para("1")), _cell(_para("2")), _cell(_para("3")), _cell(_para("4"))),
    )))
    assert md.split("\n")[1] == "| :--- | :---: | ---: | --- |"


def test_an_empty_table_and_a_malformed_row_never_raise():
    assert tiptap_to_markdown(_doc(_table())) == ""
    md = tiptap_to_markdown(_doc(_table("not a row", _row("not a cell", _cell(_para("x"))))))
    assert "x" in md


# ── item 2: callout styles round-trip ────────────────────────────────────────

def _callout(attrs, *blocks):
    return {"type": "callout", "attrs": attrs, "content": list(blocks) or [_para("x")]}


def test_a_styled_callout_exports_its_variant_and_no_emoji():
    md = tiptap_to_markdown(_doc(_callout({"variant": "warning", "emoji": "\U0001F4A1"},
                                          _para("Gap fill below 120."))))
    assert md == '<aside data-variant="warning">\nGap fill below 120.\n</aside>'


def test_a_styled_callout_keeps_the_no_blank_line_rule_of_its_html_island():
    md = tiptap_to_markdown(_doc(_callout({"variant": "info"}, _para("one"), _para("two"))))
    body = md[len('<aside data-variant="info">\n'):-len("\n</aside>")]
    assert "\n\n" not in body


def test_an_emoji_callout_exports_exactly_as_before():
    md = tiptap_to_markdown(_doc(_callout({"emoji": "\U0001F525"}, _para("hot"))))
    assert md == "<aside>\n\U0001F525 hot\n</aside>"


def test_an_unknown_or_malformed_variant_is_an_emoji_callout_and_never_raises():
    for bad in ("purple", ["warning"], {"v": 1}, 7, None):
        md = tiptap_to_markdown(_doc(_callout({"variant": bad, "emoji": "\u2705"}, _para("ok"))))
        assert md == "<aside>\n\u2705 ok\n</aside>", bad


# ── item 3: an image caption is text; alignment is style ─────────────────────

def _img(**attrs):
    return {"type": "image", "attrs": {"src": "https://x.test/a.png", "alt": "NVDA daily", **attrs}}


def _figure(caption_nodes, image=None):
    return {"type": "imageFigure",
            "content": [image or _img(), {"type": "imageCaption", "content": caption_nodes}]}


def test_a_captioned_image_exports_the_image_and_an_italic_caption_line():
    md = tiptap_to_markdown(_doc(_figure([{"type": "text", "text": "Breakout day 3"}])))
    assert md == "![NVDA daily](https://x.test/a.png)\n*Breakout day 3*"


def test_a_caption_line_break_stays_one_line_and_its_marks_travel():
    md = tiptap_to_markdown(_doc(_figure([
        {"type": "text", "text": "line one"}, {"type": "hardBreak"},
        {"type": "text", "text": "bold", "marks": [{"type": "bold"}]},
    ])))
    assert md.split("\n") == ["![NVDA daily](https://x.test/a.png)", "*line one **bold***"]


def test_an_empty_caption_exports_the_bare_image():
    md = tiptap_to_markdown(_doc(_figure([])))
    assert md == "![NVDA daily](https://x.test/a.png)"


def test_alignment_is_style_and_does_not_change_the_markdown():
    md = tiptap_to_markdown(_doc(_img(align="center")))
    assert md == "![NVDA daily](https://x.test/a.png)"


def test_a_figure_read_by_name_never_raises_on_a_missing_or_reordered_child():
    no_image = {"type": "imageFigure", "content": [
        {"type": "imageCaption", "content": [{"type": "text", "text": "words kept"}]}]}
    assert tiptap_to_markdown(_doc(no_image)) == "*words kept*"
    reordered = {"type": "imageFigure", "content": [
        {"type": "imageCaption", "content": [{"type": "text", "text": "cap"}]}, _img()]}
    assert tiptap_to_markdown(_doc(reordered)) == "![NVDA daily](https://x.test/a.png)\n*cap*"
    assert tiptap_to_markdown(_doc({"type": "imageFigure"})) == ""


# ── item 5: columns export as sequential sections ────────────────────────────

def _col(*blocks):
    return {"type": "column", "content": list(blocks)}


def test_columns_export_as_sequential_sections_in_column_order_every_block_kept():
    md = tiptap_to_markdown(_doc(
        _para("Intro."),
        {"type": "columns", "content": [
            _col(_para("Bull case."), _para("Margins widen.")),
            _col(_para("Bear case.")),
            _col({"type": "heading", "attrs": {"level": 3}, "content": [{"type": "text", "text": "Plan"}]}),
        ]},
        _para("After."),
    ))
    assert md == "Intro.\n\nBull case.\n\nMargins widen.\n\nBear case.\n\n### Plan\n\nAfter."


def test_an_empty_or_malformed_column_never_raises_and_drops_no_words():
    md = tiptap_to_markdown(_doc({"type": "columns", "content": [
        _col(_para()), "junk", _col(_para("kept")), {"type": "column"}]}))
    assert md == "kept"
    # An empty column BETWEEN two full ones leaves no hole in the prose.
    md = tiptap_to_markdown(_doc({"type": "columns", "content": [
        _col(_para("left")), _col(_para()), _col(_para("right"))]}))
    assert md == "left\n\nright"
