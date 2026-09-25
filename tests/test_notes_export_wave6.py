"""Wave 6 (editor lane D) -- Markdown export of the new editor content.

One section per item, added with the item. The export is a trust artifact
(`notes_export.py` module docstring): a member checks whether their notes
survived, so every new block must come out as something a Markdown reader
shows, and a member's words must never be dropped.
"""
from __future__ import annotations

import pytest

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


def test_a_cell_spanning_rows_keeps_the_cells_below_it_in_their_columns():
    # M8 (wave 6 fix round 1): a `rowspan` cell occupies its column in the rows
    # below too. GFM cannot merge vertically, so the covered slot is blank --
    # and the row's own cells stay under their headers. ⚰️ They shifted left.
    md = tiptap_to_markdown(_doc(_table(
        _row(_cell(_para("A"), kind="tableHeader"), _cell(_para("B"), kind="tableHeader"),
             _cell(_para("C"), kind="tableHeader")),
        _row(_cell(_para("tall"), rowspan=2), _cell(_para("b1")), _cell(_para("c1"))),
        _row(_cell(_para("b2")), _cell(_para("c2"))),
        _row(_cell(_para("a3")), _cell(_para("big"), rowspan=2, colspan=2)),
        _row(_cell(_para("a4"))),
    )))
    lines = md.split("\n")
    assert lines[2] == "| tall | b1 | c1 |"
    assert lines[3] == "|  | b2 | c2 |"
    assert lines[4] == "| a3 | big |  |"
    assert lines[5] == "| a4 |  |  |"


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


_CODE_WITH_A_BLANK_LINE = {"type": "codeBlock", "attrs": {"language": "python"},
                           "content": [{"type": "text", "text": "entry = 120\n\nstop = 114"}]}


@pytest.mark.parametrize("attrs", [{"variant": "warning"}, {"emoji": "\U0001F4A1"}],
                         ids=["styled", "emoji-control"])
def test_a_callout_holding_a_blank_line_is_ONE_html_block_to_a_commonmark_reader(attrs):
    """\u26d4 Wave 6 whole-branch review I-4. `<aside>` opens a CommonMark type-6 HTML
    block, which ENDS AT THE FIRST BLANK LINE; `_html_island` turns every blank
    line inside the island into `<br>`. The styled branch skipped it, so a code
    block with an empty line inside a styled callout -- and every callout wave 6
    creates is styled -- parsed as html_block, paragraph, fence: the tail and
    `</aside>` escaped into Markdown and `</aside>` re-imported as a code block.
    Read by the reader (markdown-it, CommonMark), never by a regex."""
    from markdown_it import MarkdownIt

    md = tiptap_to_markdown(_doc(_callout(attrs, _para("Plan:"), _CODE_WITH_A_BLANK_LINE)))
    blocks = [t.type for t in MarkdownIt("commonmark").parse(md) if t.level == 0]
    assert blocks == ["html_block"], f"{blocks} -- the callout broke out of its HTML island:\n{md}"
    assert "stop = 114" in md and md.rstrip().endswith("</aside>")    # nothing was dropped to get there


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


# ── item 6: a preview card and an embed export as links ─────────────────────

def _card(**attrs):
    return {"type": "linkPreview", "attrs": attrs}


def test_a_preview_card_exports_as_its_titled_link_with_its_description_quoted():
    md = tiptap_to_markdown(_doc(_card(
        url="https://news.example.com/a", title="NVDA prints a record quarter",
        description="Data-centre  revenue\nbeat.", domain="news.example.com", image="https://x.example.com/i.png")))
    assert md == "[NVDA prints a record quarter](https://news.example.com/a)\n\n> Data-centre revenue beat."


def test_a_card_without_a_title_falls_back_to_its_domain_then_its_url():
    assert tiptap_to_markdown(_doc(_card(url="https://example.com/p", domain="example.com"))) == \
        "[example.com](https://example.com/p)"
    assert tiptap_to_markdown(_doc(_card(url="https://example.com/p"))) == \
        "[https://example.com/p](https://example.com/p)"


def test_a_card_whose_stored_url_is_not_a_web_link_exports_its_title_as_plain_text():
    assert tiptap_to_markdown(_doc(_card(url="javascript:alert(1)", title="Click me"))) == "Click me"
    assert tiptap_to_markdown(_doc(_card())) == ""


def test_an_embed_exports_as_a_link_to_what_it_plays_never_its_player_address():
    md = tiptap_to_markdown(_doc(
        {"type": "webEmbed", "attrs": {"provider": "youtube", "ref": "dQw4w9WgXcQ", "url": "https://youtu.be/dQw4w9WgXcQ"}},
        {"type": "webEmbed", "attrs": {"provider": "tradingview", "ref": "NASDAQ:AAPL",
                                       "url": "https://www.tradingview.com/symbols/NASDAQ-AAPL/"}},
        {"type": "webEmbed", "attrs": {"provider": "youtube", "ref": "x", "url": "javascript:alert(1)"}},
    ))
    assert md == ("[YouTube video](https://youtu.be/dQw4w9WgXcQ)\n\n"
                  "[TradingView chart](https://www.tradingview.com/symbols/NASDAQ-AAPL/)")
    assert "nocookie" not in md and "widgetembed" not in md


# ── item 7: a date mention exports as its absolute date ──────────────────────

def test_a_date_mention_exports_as_its_iso_date_inside_the_sentence_and_the_task():
    mention = {"type": "dateMention", "attrs": {"date": "2026-10-02"}}
    md = tiptap_to_markdown(_doc(
        _para("Earnings ", mention, {"type": "text", "text": " after the close."}),
        {"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": False}, "content": [
            _para("Prep ", mention)]}]},
    ))
    assert md == "Earnings 2026-10-02 after the close.\n\n- [ ] Prep 2026-10-02"


def test_a_date_mention_without_a_valid_date_exports_nothing_and_never_raises():
    for bad in (None, "tomorrow", "2026-1-2", 20261002, ["2026-10-02"]):
        md = tiptap_to_markdown(_doc(_para("a ", {"type": "dateMention", "attrs": {"date": bad}},
                                           {"type": "text", "text": " b"})))
        assert md == "a  b", bad


# ── item 10: a SELECTION export keeps folders and links ─────────────────────

import io as _io
import json as _json
import sqlite3 as _sqlite3
import zipfile as _zipfile

import pytest

from api.services.journal_two.db import ensure_schema
from api.services.journal_two.notes_export import (
    build_export_zip, build_selection_export_to_tempfile,
)


def _conn():
    c = _sqlite3.connect(":memory:")
    c.row_factory = _sqlite3.Row
    ensure_schema(c)
    return c


def _folder(c, fid, name, parent="", uid="u1"):
    c.execute("INSERT INTO j2_note_folders (id, user_id, name, parent_id, created_at) VALUES (?,?,?,?,?)",
              (fid, uid, name, parent, "2026-09-01T00:00:00Z"))


def _note(c, nid, title, doc, folder=None, uid="u1", updated="2026-09-01T00:00:00Z", deleted=None):
    c.execute("INSERT INTO j2_notes (id, user_id, folder_id, title, body_json, body_plain, tags,"
              " created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
              (nid, uid, folder, title, _json.dumps(doc), "", "[]", updated, updated, deleted))


def _link(nid):
    return {"type": "paragraph", "content": [{"type": "noteLink", "attrs": {"noteId": nid}}]}


@pytest.fixture()
def library():
    c = _conn()
    _folder(c, "f1", "Trading")
    _folder(c, "f2", "Setups", parent="f1")
    _folder(c, "f3", "Research")
    _note(c, "a", "Cup and handle", _doc(_para("A."), _link("b"), _link("c")), folder="f2")
    _note(c, "b", "NVDA", _doc(_para("B."), _link("a")), folder="f3")
    _note(c, "c", "Not selected", _doc(_para("C.")), folder="f3")
    _note(c, "d", "Root note", _doc(_link("b")))
    _note(c, "x", "Theirs", _doc(_para("X.")), uid="u2")
    _note(c, "t", "Trashed", _doc(_para("T.")), deleted="2026-09-02T00:00:00Z")
    c.commit()
    return c


def _selection(c, ids):
    path, fname, exported, skipped = build_selection_export_to_tempfile("u1", ids, conn=c)
    try:
        with _zipfile.ZipFile(path) as zf:
            files = {n: zf.read(n).decode("utf-8") for n in zf.namelist()}
    finally:
        path.unlink()
    return files, fname, exported, skipped


def test_a_selection_keeps_each_notes_folder_path(library):
    files, fname, exported, skipped = _selection(library, ["a", "b", "d"])
    assert {"Trading/Setups/Cup and handle.md", "Research/NVDA.md", "Root note.md"} <= set(files)
    assert "Research/Not selected.md" not in files
    assert (exported, skipped) == (3, [])
    assert fname.startswith("uct-notebook-selection-")
    manifest = _json.loads(files["UCT_NOTEBOOK_EXPORT.json"])
    assert manifest["selection"] is True and manifest["note_count"] == 3


def test_links_between_selected_notes_are_relative_md_paths_from_the_linking_notes_folder(library):
    files, *_ = _selection(library, ["a", "b", "d"])
    assert "[NVDA](../../Research/NVDA.md)" in files["Trading/Setups/Cup and handle.md"]
    # ⛔ I2 (wave 6 fix round 1): PERCENT-ENCODED. This line pinned
    # `(../Trading/Setups/Cup and handle.md)`, which no CommonMark reader --
    # our own importer included -- parses as a link: a bare destination cannot
    # hold a space, so the whole thing rendered as literal text.
    assert "[Cup and handle](../Trading/Setups/Cup%20and%20handle.md)" in files["Research/NVDA.md"]
    assert "[NVDA](Research/NVDA.md)" in files["Root note.md"]


def test_a_link_to_a_note_NOT_selected_stays_the_honest_not_bundled_reference(library):
    files, *_ = _selection(library, ["a", "b"])
    assert "[Not selected](uct-note:///notebook?note=c)" in files["Trading/Setups/Cup and handle.md"]


def test_a_foreign_or_trashed_or_unknown_id_is_skipped_and_named_never_exported(library):
    files, _f, exported, skipped = _selection(library, ["a", "x", "t", "nope", "a", "nope"])
    assert exported == 1
    assert skipped == ["x", "t", "nope"]
    assert not any("Theirs" in n or "Trashed" in n for n in files)
    issues = files["EXPORT_ISSUES.txt"]
    assert "- x" in issues and "- t" in issues and "- nope" in issues


def test_the_whole_notebook_export_links_relatively_too(library):
    blob, _ = build_export_zip("u1", conn=library)
    zf = _zipfile.ZipFile(_io.BytesIO(blob))
    assert "[NVDA](../../Research/NVDA.md)" in zf.read("Trading/Setups/Cup and handle.md").decode("utf-8")
    assert "selection" not in _json.loads(zf.read("UCT_NOTEBOOK_EXPORT.json"))


# ── item 13: a table of contents exports as a list of heading links ─────────

def _h(level, text):
    return {"type": "heading", "attrs": {"level": level}, "content": [{"type": "text", "text": text}]}


def test_a_toc_exports_as_a_nested_list_of_anchor_links_to_every_heading():
    md = tiptap_to_markdown(_doc(
        {"type": "tableOfContents"},
        _h(2, "Plan"), _para("x"), _h(3, "Entry & exit"), _h(2, "Plan"),
        {"type": "callout", "attrs": {"variant": "note"}, "content": [_h(4, "Inside a callout")]},
    ))
    toc = md.split("\n\n")[0]
    assert toc == ("- [Plan](#plan)\n"
                   "  - [Entry & exit](#entry--exit)\n"
                   "- [Plan](#plan-1)\n"
                   "    - [Inside a callout](#inside-a-callout)")


def test_a_toc_with_no_headings_exports_nothing_and_escapes_what_it_links():
    assert tiptap_to_markdown(_doc({"type": "tableOfContents"}, _para("text"))) == "text"
    md = tiptap_to_markdown(_doc({"type": "tableOfContents"}, _h(2, "Cost [est] $5")))
    assert md.split("\n\n")[0] == r"- [Cost \[est\] \$5](#cost-est-5)"


# ── wave 6 fix round 1: I2 + item 10 -- every link in a foldered selection is a
#    REAL Markdown link, and it resolves to a file in the same archive ──────────

import posixpath as _posixpath
from urllib.parse import unquote as _unquote

from markdown_it import MarkdownIt as _MarkdownIt


def _links(md_text):
    """Every (text, href) CommonMark itself sees in `md_text` -- the reader, not a regex."""
    out = []
    for tok in _MarkdownIt("commonmark").parse(md_text):
        for child in tok.children or []:
            if child.type == "link_open":
                out.append(child.attrGet("href"))
    return out


def _resolves_to(from_file, href):
    """Where a relative href points from `from_file`, as the importer reads it
    (lib/importer/adapters/generic.js resolvePath: decode, then resolve against
    the linking doc's own directory)."""
    base = _posixpath.dirname(from_file)
    return _posixpath.normpath(_posixpath.join(base, _unquote(href.split("#")[0].split("?")[0])))


@pytest.fixture()
def awkward_library():
    """Titles and folders a member really writes: spaces, a hash, a percent,
    parentheses, a non-ASCII letter, an ampersand."""
    c = _conn()
    _folder(c, "f1", "Trading Ideas")
    _folder(c, "f2", "Setups (2026)", parent="f1")
    _folder(c, "f3", "Café & Research")
    _note(c, "a", "Cup and handle #3", _doc(_para("A."), _link("b"), _link("c")), folder="f2")
    _note(c, "b", "NVDA up 50% (Q3)", _doc(_para("B."), _link("a")), folder="f3")
    _note(c, "c", "Root note", _doc(_link("a"), _link("b")))
    c.commit()
    return c


def test_every_link_between_selected_notes_is_a_markdown_link_that_resolves_inside_the_archive(awkward_library):
    files, _f, exported, skipped = _selection(awkward_library, ["a", "b", "c"])
    assert (exported, skipped) == (3, [])
    notes = {name for name in files if name.endswith(".md")}
    # ⭐ Item 10: the FOLDERS are kept, nested, with the member's own names.
    assert notes == {
        "Trading Ideas/Setups (2026)/Cup and handle #3.md",
        "Café & Research/NVDA up 50% (Q3).md",
        "Root note.md",
    }
    expected = {
        "Trading Ideas/Setups (2026)/Cup and handle #3.md": {"Café & Research/NVDA up 50% (Q3).md", "Root note.md"},
        "Café & Research/NVDA up 50% (Q3).md": {"Trading Ideas/Setups (2026)/Cup and handle #3.md"},
        "Root note.md": {"Trading Ideas/Setups (2026)/Cup and handle #3.md", "Café & Research/NVDA up 50% (Q3).md"},
    }
    for name, targets in expected.items():
        hrefs = [h for h in _links(files[name]) if h.endswith(".md")]
        # ⛔ CommonMark must SEE each one as a link: an unencoded space, a raw
        # "#" (a fragment) or an unbalanced ")" would each lose it.
        assert len(hrefs) == len(targets), (name, files[name])
        assert {_resolves_to(name, h) for h in hrefs} == targets, (name, hrefs)
        assert all(" " not in h and "#" not in h for h in hrefs)


def test_a_link_to_a_note_not_selected_is_still_the_honest_not_bundled_reference(awkward_library):
    files, *_ = _selection(awkward_library, ["c"])
    hrefs = _links(files["Root note.md"])
    assert hrefs == ["uct-note:///notebook?note=a", "uct-note:///notebook?note=b"]


def test_an_attachment_link_with_a_space_in_its_name_is_a_real_link_too(tmp_path, monkeypatch):
    # The same path helper writes attachment links: one fix, both kinds.
    from api.services.journal_two import notes_export as ne
    assert ne._relative_link("Trading Ideas", "attachments/u1/n1/file/my report (final).pdf") ==         "../attachments/u1/n1/file/my%20report%20%28final%29.pdf"
    assert ne._relative_link("", "Café & Research/NVDA up 50% (Q3).md") ==         "Caf%C3%A9%20%26%20Research/NVDA%20up%2050%25%20%28Q3%29.md"


# ── item 10: the writer's contract, as a router relies on it ────────────────

def test_the_writer_leaves_a_connection_it_was_given_open_and_accepts_ids_in_any_order_or_iterable(library):
    first, *_ = _selection(library, ["d", "b", "a"])
    # the same connection answers again: the writer did not close it
    second, _f, exported, skipped = _selection(library, iter(["a", "b", "d"]))
    assert (exported, skipped) == (3, [])
    strip = lambda files: {k: v for k, v in files.items() if k != "UCT_NOTEBOOK_EXPORT.json"}  # noqa: E731
    assert strip(first) == strip(second)


# ── wave 6 fix round 1: a TOC label goes through `_prose`, the ONE `$` authority ──

def _toc_link_texts(md_text):
    """The link TEXT CommonMark renders for each TOC line -- what a reader sees."""
    import re as _re
    from html import unescape as _unescape
    html_out = _MarkdownIt("commonmark").render(md_text)
    return [_unescape(t) for t in _re.findall(r'<a href="#[^"]*">(.*?)</a>', html_out)]


@pytest.mark.parametrize("heading", [
    r"cost \$5",          # the R2-N4 trap: the member's backslash right before a `$`
    r"cost \\$5",         # two of them
    "Up $5-$10",
    "Cost [est] $5",
    "bid ] ask [ spread",  # UNbalanced: CommonMark allows balanced brackets in link text, not these
    r"a\b and x\[y]",
    "ends in a backslash\\",
    "50% (Q3) & more",
])
def test_a_toc_label_reads_back_as_exactly_the_heading(heading):
    md = tiptap_to_markdown(_doc({"type": "tableOfContents"}, _h(2, heading)))
    toc = md.split("\n\n")[0]
    assert _toc_link_texts(toc) == [heading], toc


def test_the_order_is_prose_first_then_link_text_proved_on_the_trap_heading():
    # `_prose` turns `cost \$5` into `cost \\\$5`: an escaped backslash, then an
    # escaped dollar. Link-text escaping applied AFTER it must leave that run
    # alone -- doubling it again gives six backslashes before the `$`: three
    # literal backslashes and a LIVE `$` a math reader pairs.
    md = tiptap_to_markdown(_doc({"type": "tableOfContents"}, _h(2, r"cost \$5")))
    assert md.split("\n\n")[0] == r"- [cost \\\$5](#cost-5)"


def test_the_toc_label_is_routed_through_prose_the_one_dollar_authority(monkeypatch):
    # ⛔ ONE authority (`lesson_a_guard_repeated_is_a_guard_unproved`): the TOC
    # used to escape `$` itself; a fix to `_prose` would not have reached it.
    from api.services.journal_two import notes_export as ne
    seen = []
    real = ne._prose

    def spy(text):
        seen.append(text)
        return real(text)

    monkeypatch.setattr(ne, "_prose", spy)
    # The TOC alone: the heading block's own text reaches `_prose` too, so a
    # whole-document render could not tell whether the TOC asked.
    assert ne._toc_markdown([(2, "Plan $5")]) == r"- [Plan \$5](#plan-5)"
    assert seen == ["Plan $5"]
