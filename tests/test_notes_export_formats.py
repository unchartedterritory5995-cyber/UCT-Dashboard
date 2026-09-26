"""Wave 8 lane 8C (C4) -- the HTML, JSON and Word export formats, and the archive seam.

Two halves, and they fail for different reasons:

* THE MARKDOWN EXPORT STAYS BYTE-IDENTICAL. The archive writer grew a `fmt=` seam
  (`notes_export._write_notes_archive`); a Markdown export must not move by one byte. The
  entries of four Markdown exports of ONE fixed library -- the whole notebook, a
  selection, a single note with attachments, a single note without -- were captured BEFORE
  the seam existed (`09220eedf`, the lane's start) and are pinned below as one digest per
  export. Mutation: write the manifest's `"format"` key unconditionally and two of the four
  go red. C5 (the fidelity carry-overs) then changed the Markdown ON PURPOSE in exactly two
  lines of this library; the digests were re-captured after it, the two lines are named and
  pinned beside them, and every other byte is the lane-start byte.
* THE NEW FORMATS. Each serializer, the sanitizer, the docx package and the archive seam,
  asserted on what a reader of the file would see.

⛔ The library is built in an in-memory SQLite database with the real schema, and its
attachments live under `tmp_path` (`J2_ATTACHMENT_ROOT`) -- nothing here reaches `C:\\data`.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import sqlite3
import zipfile
from datetime import datetime as _real_datetime, timezone

import pytest

from api.services.journal_two import notes_export
from api.services.journal_two.db import ensure_schema

USER = "u1"
STAMP = "2026-09-01T00:00:00Z"
FROZEN_NOW = _real_datetime(2026, 9, 26, 12, 0, 0, tzinfo=timezone.utc)

# A 4x2 PNG, as bytes that cannot move with a Pillow upgrade.
PNG_4x2 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAFElEQVR4nGM8ISfHAANMcBYDAwMAGVgBCNdbWuMAAAAASUVORK5CYII=")
PDF_BYTES = b"%PDF-1.4\n% a tiny stand-in, never opened\n"


def _att(nid, sub, name):
    return f"/api/j2/notes/attachments/{USER}/{nid}/{sub}/{name}"


def _doc(*content):
    return {"type": "doc", "content": list(content)}


def _t(text, *marks):
    node = {"type": "text", "text": text}
    if marks:
        node["marks"] = [m if isinstance(m, dict) else {"type": m} for m in marks]
    return node


def _p(*inline):
    return {"type": "paragraph", "content": [i if isinstance(i, dict) else _t(i) for i in inline]}


def _h(level, text):
    return {"type": "heading", "attrs": {"level": level}, "content": [_t(text)]}


def _link(nid):
    return _p({"type": "noteLink", "attrs": {"noteId": nid}})


def _cell(text, kind="tableCell"):
    return {"type": kind, "content": [_p(text)]}


RICH_DOC = _doc(
    _h(1, "Setup: the reclaim"),
    _p("Plain, ", _t("bold", "bold"), ", ", _t("italic", "italic"), ", ", _t("code $5", "code"),
       ", ", _t("under", "underline"), ", ", _t("struck", "strike"), ", ",
       _t("lit", "highlight"), ", ",
       _t("a link", {"type": "link", "attrs": {"href": "https://example.com/a?b=1"}}),
       ", cost $5-$10 and \\*literal\\*."),
    _p({"type": "inlineMath", "attrs": {"latex": "x^2 + y"}}, " inline math."),
    {"type": "blockMath", "attrs": {"latex": "\\int_0^1 x\\,dx"}},
    {"type": "table", "content": [
        {"type": "tableRow", "content": [_cell("Sym", "tableHeader"), _cell("R", "tableHeader")]},
        {"type": "tableRow", "content": [_cell("NVDA"), _cell("2.1")]},
    ]},
    {"type": "callout", "attrs": {"variant": "warning"},
     "content": [_p("Mind the ", _t("gap", "bold")),
                 {"type": "codeBlock", "attrs": {"language": "py"}, "content": [_t("x = $1\n\ny = 2")]}]},
    {"type": "toggle", "content": [
        {"type": "toggleSummary", "content": [_t("More")]},
        {"type": "toggleContent", "content": [_p("Hidden words.")]},
    ]},
    {"type": "bulletList", "content": [
        {"type": "listItem", "content": [_p("one"), {"type": "orderedList", "content": [
            {"type": "listItem", "content": [_p("nested")]}]}]},
        {"type": "listItem", "content": [_p("two")]},
    ]},
    {"type": "taskList", "content": [
        {"type": "taskItem", "attrs": {"checked": True}, "content": [_p("done")]},
        {"type": "taskItem", "attrs": {"checked": False}, "content": [_p("open")]},
    ]},
    {"type": "blockquote", "content": [_p("A quote.")]},
    {"type": "codeBlock", "attrs": {"language": ""}, "content": [_t("plain $code$")]},
    {"type": "horizontalRule"},
    {"type": "image", "attrs": {"src": _att("a", "inline", "img1.png"), "alt": "chart *one* & $5"}},
    {"type": "image", "attrs": {"src": _att("a", "inline", "missing.png"), "alt": "gone"}},
    _p({"type": "attachmentChip", "attrs": {"href": _att("a", "file", "report.pdf"), "name": "report.pdf"}}),
    _link("b"),
    _link("c"),
    {"type": "askInsert", "attrs": {"question": "What changed?", "insertedAt": "2026-09-02T10:00:00Z"},
     "content": [_p("Margins rose ", {"type": "askCitation", "attrs": {"n": 1, "label": "Q2 note"}})]},
    _p("Due ", {"type": "dateMention", "attrs": {"date": "2026-10-01"}}),
    {"type": "columns", "content": [
        {"type": "column", "content": [_p("left")]},
        {"type": "column", "content": [_p("right")]},
    ]},
    {"type": "imageFigure", "content": [
        {"type": "image", "attrs": {"src": _att("a", "inline", "img1.png"), "alt": "fig"}},
        {"type": "imageCaption", "content": [_t("A caption")]},
    ]},
    {"type": "linkPreview", "attrs": {"url": "https://example.com/p", "title": "Preview", "description": "Desc"}},
    {"type": "webEmbed", "attrs": {"url": "https://www.youtube.com/watch?v=abc", "provider": "youtube"}},
    {"type": "tableOfContents"},
    {"type": "widgetEmbed", "attrs": {"widgetId": "chart", "searchText": "Chart: a widget"}},
    _p({"type": "videoTimestamp", "attrs": {"seconds": 75}}),
)


def _conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    return c


def build_library(att_root):
    """The fixed library every rail in this file exports. Returns an open connection."""
    for sub, name, data in (("inline", "img1.png", PNG_4x2), ("hero", "h1.png", PNG_4x2),
                            ("file", "report.pdf", PDF_BYTES)):
        d = att_root / USER / "notes" / "a" / sub
        d.mkdir(parents=True, exist_ok=True)
        (d / name).write_bytes(data)
    c = _conn()
    for fid, name, parent in (("f1", "Trading", ""), ("f2", "Setups", "f1"), ("f3", "Research", "")):
        c.execute("INSERT INTO j2_note_folders (id, user_id, name, parent_id, created_at) VALUES (?,?,?,?,?)",
                  (fid, USER, name, parent, STAMP))
    for pid, name, ptype, options in (
        ("p1", "Thesis", "text", None),
        ("p2", "Stage", "select", [{"id": "o1", "label": "Base", "color": "gray"}]),
        ("p3", "Reviewed", "checkbox", None),
    ):
        c.execute("INSERT INTO j2_note_properties (id, user_id, name, type, options_json, sort_order,"
                  " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                  (pid, USER, name, ptype, json.dumps(options) if options else None, 0, STAMP, STAMP))

    def note(nid, title, doc, *, folder=None, uid=USER, deleted=None, tags=(), ticker=None,
             subtitle=None, hero=None, props=None, updated=STAMP):
        c.execute(
            "INSERT INTO j2_notes (id, user_id, folder_id, title, subtitle, body_json, body_plain, tags,"
            " ticker, hero_image_url, properties_json, created_at, updated_at, deleted_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (nid, uid, folder, title, subtitle, json.dumps(doc), "", json.dumps(list(tags)), ticker, hero,
             json.dumps(props) if props else None, STAMP, updated, deleted))

    note("a", "Cup and handle: the reclaim", RICH_DOC, folder="f2", tags=("swing", "reclaim, tight"),
         subtitle="A setup", hero=_att("a", "hero", "h1.png"),
         props={"p1": "Breakout", "p2": "o1", "p3": True}, updated="2026-09-03T00:00:00Z")
    note("b", "NVDA", _doc(_p("B."), _link("a")), folder="f3", ticker="NVDA", updated="2026-09-02T00:00:00Z")
    note("c", "Not selected", _doc(_p("C.")), folder="f3")
    note("d", "Root note", _doc(_link("b")))
    note("x", "Theirs", _doc(_p("X.")), uid="u2")
    note("t", "Trashed", _doc(_p("T.")), deleted="2026-09-02T00:00:00Z")
    c.commit()
    return c


class _FrozenDatetime(_real_datetime):
    @classmethod
    def now(cls, tz=None):
        return FROZEN_NOW if tz is not None else FROZEN_NOW.replace(tzinfo=None)


@pytest.fixture()
def library(tmp_path, monkeypatch):
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(tmp_path / "att"))
    monkeypatch.setattr(notes_export, "datetime", _FrozenDatetime)
    c = build_library(tmp_path / "att")
    yield c
    c.close()


def _entries(zip_bytes: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        return {n: zf.read(n) for n in zf.namelist()}


def _digest(files: dict[str, bytes]) -> str:
    """One sha256 over every entry's name and bytes, in name order."""
    h = hashlib.sha256()
    for name in sorted(files):
        h.update(name.encode("utf-8") + b"\0" + hashlib.sha256(files[name]).digest())
    return h.hexdigest()


def markdown_digests(conn) -> dict[str, str]:
    """The four Markdown exports of the library, as one digest each (the byte-identity rail)."""
    whole, whole_name = notes_export.build_export_zip(USER, conn=conn)
    path, sel_name, _n, _s = notes_export.build_selection_export_to_tempfile(USER, ["a", "b", "d"], conn=conn)
    try:
        selection = path.read_bytes()
    finally:
        path.unlink(missing_ok=True)
    single_a, name_a, media_a = notes_export.build_single_note_export(USER, "a", conn=conn)
    single_c, name_c, media_c = notes_export.build_single_note_export(USER, "c", conn=conn)
    return {
        "whole": f"{whole_name}|{_digest(_entries(whole))}",
        "selection": f"{sel_name}|{_digest(_entries(selection))}",
        "single_attachments": f"{name_a}|{media_a}|{_digest(_entries(single_a))}",
        "single_bare": f"{name_c}|{media_c}|{hashlib.sha256(single_c).hexdigest()}",
    }


# Captured at 09220eedf, BEFORE the `fmt=` seam existed (lane 8C's start) -- see the header.
MARKDOWN_AT_START = {
    "whole": "uct-notebook-export-20260926.zip|b77224e732e8086b92977b8295619deddef9d6bcfd811abc25335376eb431ad4",
    "selection": "uct-notebook-selection-20260926.zip|bbe780c3966e28dead3b9df386454afc881695a5cadf992b691a029d356e7bb1",
    "single_attachments": "Cup and handle- the reclaim-20260926.zip|application/zip|"
                          "bee41cdc3ec6e969e0c5fed15dd5d94df1697cb286ba06bafacac064b77fde67",
    "single_bare": "Not selected-20260926.md|text/markdown|"
                   "33ba62beb0dd2cb6830f4a834710f452a53d0350e67e046db787fe438aefa58f",
}


# Re-captured AFTER C5 (the fidelity carry-overs), which changes the Markdown ON PURPOSE in
# exactly two lines of this library -- measured by unzipping the whole export before and after
# and diffing every member file (the lane report carries the diff):
#   - the member's `\*literal\*` was written `\*literal\*` (it re-imported as `*literal*`) and
#     is now `\\\*literal\\\*`;
#   - the alt `chart *one* & $5` was written raw (it re-imported as "chart one & $5") and is
#     now `chart \*one\* & \$5`.
# Every other byte of all four exports is unchanged; `single_bare` did not move at all.
# `test_the_c5_lines_are_the_only_reason_the_digests_moved` pins the two lines themselves.
MARKDOWN_AFTER_C5 = {
    "whole": "uct-notebook-export-20260926.zip|3786a4954dec41f6042633453391cb46dbb79a7c1ae3a5c008551e116ad8ac71",
    "selection": "uct-notebook-selection-20260926.zip|e9e6fad3b49f6703d57a4b0946a360b339c792601b08d3da132ed3040295bf01",
    "single_attachments": "Cup and handle- the reclaim-20260926.zip|application/zip|"
                          "fd8d0f12f2d75bd6e62ba53daa85ca9197dbe4e0ee7226e6aef76f55faf4314d",
    "single_bare": MARKDOWN_AT_START["single_bare"],
}


def test_the_markdown_exports_are_byte_identical_to_before_the_format_seam(library):
    # The format seam (C4) moved no byte; C5 moved exactly the two lines named above.
    assert markdown_digests(library) == MARKDOWN_AFTER_C5


def test_the_c5_lines_are_the_only_reason_the_digests_moved(library):
    whole, _ = notes_export.build_export_zip(USER, conn=library)
    with zipfile.ZipFile(io.BytesIO(whole)) as zf:
        md = zf.read("Trading/Setups/Cup and handle- the reclaim.md").decode("utf-8")
    assert "cost \\$5-\\$10 and \\\\\\*literal\\\\\\*." in md
    assert "![chart \\*one\\* & \\$5](../../attachments/u1/a/inline/img1.png)" in md


# ── the format names ─────────────────────────────────────────────────────────

from api.services.journal_two import notes_export_formats as F  # noqa: E402
from api.services.journal_two.document_extraction import extract_docx_pages  # noqa: E402


def test_the_format_names_and_their_one_refusal():
    assert F.FORMATS == ("md", "html", "json", "docx")
    assert F.normalize_format(None) == "md" and F.normalize_format("") == "md"
    assert F.normalize_format(" HTML ") == "html" and F.normalize_format("Docx") == "docx"
    for bad in ("pdf", "word", "markdown", "md;rm", "../md"):
        assert F.normalize_format(bad) is None, bad
    # the seam refuses a format it has no serializer for, rather than guessing Markdown
    with pytest.raises(ValueError):
        notes_export._write_notes_archive(None, USER, _conn(), fmt="pdf")


# ── HTML ─────────────────────────────────────────────────────────────────────

def test_the_web_page_is_the_markdown_writer_rendered_headings_lists_tables_marks_math():
    html = F.markdown_to_html(notes_export.tiptap_to_markdown(RICH_DOC))
    assert '<h1 id="setup-the-reclaim">Setup: the reclaim</h1>' in html
    assert "<strong>bold</strong>" in html and "<em>italic</em>" in html and "<s>struck</s>" in html
    assert "<mark>lit</mark>" in html
    assert '<a href="https://example.com/a?b=1" rel="noopener noreferrer">a link</a>' in html
    assert '<code class="math">x^2 + y</code>' in html                   # inline math, TeX kept
    assert '<pre><code class="math">\\int_0^1 x\\,dx</code></pre>' in html  # display math
    assert "<code>code $5</code>" in html                                  # code: never math
    assert "cost $5-$10" in html                                           # an escaped $ is a $
    assert "<th>Sym</th>" in html and "<td>NVDA</td>" in html
    assert '<input checked disabled type="checkbox"> done' in html          # a task, not a control
    assert '<aside data-variant="warning">' in html and "Mind the <strong>gap</strong>" in html
    assert '<code class="language-py">x = $1\n\ny = 2\n</code>' in html     # the island's blank line
    assert "<summary>More</summary>" in html and "<p>Hidden words.</p>" in html
    assert '<a href="#setup-the-reclaim">Setup: the reclaim</a>' in html    # the TOC jumps


def test_a_web_page_is_a_standalone_document_with_its_styles_inline():
    page = F.html_document(title='Plan <b>"A"</b> — NVDA', body_html="<p>x</p>", subtitle="s & t",
                           tags=["swing"], ticker="NVDA", updated_at="2026-09-03T00:00:00Z")
    assert page.startswith('<!doctype html>\n<html lang="en">')
    assert '<meta charset="utf-8">' in page
    assert "<title>Plan &lt;b&gt;&quot;A&quot;&lt;/b&gt; — NVDA</title>" in page
    assert "<style>" in page and "<link" not in page and "<script" not in page
    assert '<p class="uct-note-subtitle">s &amp; t</p>' in page
    assert "NVDA · swing · Updated 2026-09-03" in page


HOSTILE_DOC = _doc(
    _p("<script>alert(1)</script> and <img src=x onerror=alert(2)> and <iframe src=//evil></iframe>"),
    _p(_t("click", {"type": "link", "attrs": {"href": "javascript:alert(3)"}}), " ",
       _t("data", {"type": "link", "attrs": {"href": "data:text/html,<script>alert(4)</script>"}}), " ",
       _t("tab", {"type": "link", "attrs": {"href": "java\tscript:alert(5)"}})),
    {"type": "image", "attrs": {"src": "https://example.com/i.png", "alt": 'x" onerror="alert(6)'}},
    {"type": "image", "attrs": {"src": "javascript:alert(7)", "alt": "js"}},
    _p("javascript:alert(8) typed as text, and onclick=alert(9) too"),
    {"type": "callout", "attrs": {"variant": "note"},
     "content": [_p("<svg onload=alert(10)>"), _p('<a href="javascript:alert(11)">x</a>')]},
)


def _assert_inert(html: str):
    low = html.lower()
    assert "<script" not in low, html
    assert "javascript:" not in low, html
    assert "onerror=" not in low and "onload=" not in low and "onclick=" not in low, html
    assert "<iframe" not in low and "<svg" not in low, html


def test_HOSTILE_input_leaves_no_script_no_javascript_and_no_event_handler_in_the_web_page():
    page = F.note_html(HOSTILE_DOC, resolver=None, title="<script>t</script>")
    _assert_inert(page)
    # ...and the member's words are still there, as text. (A tag the allowlist KEEPS -- the
    # typed `<img src=x onerror=...>` -- keeps its tag and loses the handler; that is the one
    # place typed text does not survive, and it is the Markdown writer's own behaviour:
    # member text reaches Markdown unescaped, so every Markdown reader renders it as HTML.)
    assert "alert(1)" in page and "alert(8)" in page and "alert(10)" in page
    assert "&lt;script&gt;" in page                            # the literal text they typed
    assert 'alt="x&quot; onerror&#61;&quot;alert(6)"' in page  # the alt kept, inert
    assert "click" in page and ">click</a>" not in page       # the javascript: link lost its href


def test_the_sanitizer_is_an_allowlist():
    s = F.sanitize_html
    assert s('<p onclick="x()" class="k" style="color:red">t</p>') == "<p>t</p>"
    assert s('<td style="text-align: RIGHT">1</td>') == '<td style="text-align:right">1</td>'
    assert s('<td style="text-align:right;color:red">1</td>') == "<td>1</td>"
    assert s('<input type="text" value="x"><input type="checkbox" checked>') == \
        '<input type="checkbox" checked disabled>'
    assert s('<a href="attachments/u1/a/file/r.pdf">r</a>') == '<a href="attachments/u1/a/file/r.pdf">r</a>'
    assert s('<a href="#top">t</a>') == '<a href="#top">t</a>'
    assert s('<a href="mailto:a@b.c">m</a>') == '<a href="mailto:a@b.c" rel="noopener noreferrer">m</a>'
    assert s('<img src="mailto:a@b.c" alt="m">') == '<img alt="m">'
    for bad in ("//evil.example/x", "/api/j2/notes/attachments/u1/a/inline/x.png", "java&#x73;cript:alert(1)",
                "JAVASCRIPT:alert(1)", " javascript:alert(1)", "vbscript:x", "data:image/png;base64,AAA",
                "uct-note:///notebook?note=a", "file:///etc/passwd"):
        assert "href" not in s(f'<a href="{bad}">x</a>'), bad
    assert s("<div><span>kept</span></div>") == "kept"               # the renderer's wrappers
    assert s("<p>unclosed <b>bold") == "<p>unclosed <b>bold</b></p>"   # always balanced
    assert s("</p>stray") == "stray"
    assert s("<!-- c --><p>x</p>") == "<p>x</p>"


# ── JSON ─────────────────────────────────────────────────────────────────────

def _archive(conn, fmt):
    blob, name = notes_export.build_export_zip(USER, conn=conn, fmt=fmt)
    return _entries(blob), name


def test_the_json_document_is_the_stored_body_verbatim_but_for_attachment_paths(library):
    files, name = _archive(library, "json")
    assert name == "uct-notebook-export-20260926-json.zip"
    manifest = json.loads(files["UCT_NOTEBOOK_EXPORT.json"])
    assert manifest["format"] == "json" and manifest["note_count"] == 4
    doc = json.loads(files["Trading/Setups/Cup and handle- the reclaim.json"])
    assert doc["format"] == "uct-notebook-note" and doc["version"] == 1
    note = doc["note"]
    assert note["id"] == "a" and note["title"] == "Cup and handle: the reclaim"
    assert note["folderPath"] == ["Trading", "Setups"]                     # real names, not safe ones
    assert note["tags"] == ["swing", "reclaim, tight"] and note["subtitle"] == "A setup"
    assert note["properties"] == [
        {"name": "Thesis", "type": "text", "value": "Breakout"},
        {"name": "Stage", "type": "select", "value": "Base"},
        {"name": "Reviewed", "type": "checkbox", "value": "Yes"},
    ]
    assert (note["createdAt"], note["updatedAt"]) == (STAMP, "2026-09-03T00:00:00Z")
    assert note["schemaLevel"] == 2                     # the body holds wave-6 types
    assert note["heroImage"] == "../../attachments/u1/a/hero/h1.png"
    # verbatim: put the in-app addresses back and it IS the stored document
    back = json.loads(json.dumps(note["bodyJson"]).replace(
        "../../attachments/u1/a/", "/api/j2/notes/attachments/u1/a/"))
    assert back == RICH_DOC
    assert "attachments/u1/a/inline/img1.png" in files and "attachments/u1/a/file/report.pdf" in files
    # a missing attachment keeps its stored address and is named in EXPORT_ISSUES.txt
    assert _att("a", "inline", "missing.png") in json.dumps(note["bodyJson"])
    assert "missing.png" in files["EXPORT_ISSUES.txt"].decode("utf-8")


def test_a_json_note_carries_what_the_markdown_front_matter_carries():
    class _Row(dict):
        pass

    row = _Row(id="n", title="T", subtitle=None, tags="[]", ticker="NVDA", created_at="c",
               updated_at="u", import_source="notion", imported_at="i")
    doc = F.note_json(row, body_json={"type": "doc", "content": []}, folder_names=[], properties=[],
                      hero=None, extra={"favorite": True, "related_tickers": ["AMD"],
                                        "thesis_reviews": [{"completedAt": "d"}]})
    assert doc["note"]["extras"] == {"favorite": True, "relatedTickers": ["AMD"],
                                     "thesisReviews": [{"completedAt": "d"}],
                                     "importSource": "notion", "importedAt": "i"}
    assert doc["note"]["schemaLevel"] == 0


# ── Word ─────────────────────────────────────────────────────────────────────

import xml.etree.ElementTree as ET  # noqa: E402

_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def validate_docx(blob: bytes) -> dict[str, bytes]:
    """The package a Word reader needs: every part present, every XML part well-formed,
    every relationship's internal target a part that exists, every media type declared."""
    parts = _entries(blob)
    for need in ("[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml",
                 "word/numbering.xml", "word/_rels/document.xml.rels"):
        assert need in parts, need
    for name, data in parts.items():
        if name.endswith((".xml", ".rels")):
            ET.fromstring(data)
    rels = ET.fromstring(parts["word/_rels/document.xml.rels"])
    for rel in rels.iter(f"{_REL}Relationship"):
        if rel.get("TargetMode") != "External":
            assert f"word/{rel.get('Target')}" in parts, rel.get("Target")
    types = parts["[Content_Types].xml"].decode("utf-8")
    for name in parts:
        if name.startswith("word/media/"):
            assert f'Extension="{name.rsplit(".", 1)[1]}"' in types, name
    return parts


def _external_targets(parts) -> list[str]:
    rels = ET.fromstring(parts["word/_rels/document.xml.rels"])
    return [r.get("Target") for r in rels.iter(f"{_REL}Relationship") if r.get("TargetMode") == "External"]


def _texts_in_order(doc) -> list[str]:
    out = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "text" and n.get("text"):
                out.append(" ".join(n["text"].split()))
            for c in n.get("content") or []:
                walk(c)
    walk(doc)
    return [t for t in out if t]


def _norm(text: str) -> str:
    return " ".join(text.split())


def _docx_text(blob: bytes) -> str:
    pages, _count = extract_docx_pages(blob)       # wave 7's stdlib reader, not ours
    return _norm("\n".join(pages))


def test_a_word_document_reads_back_as_the_notes_text_through_the_independent_reader(library):
    files, name = _archive(library, "docx")
    assert name == "uct-notebook-export-20260926-docx.zip"
    assert json.loads(files["UCT_NOTEBOOK_EXPORT.json"])["format"] == "docx"
    blob = files["Trading/Setups/Cup and handle- the reclaim.docx"]
    validate_docx(blob)
    text = _docx_text(blob)
    pos = 0
    for words in _texts_in_order(RICH_DOC):                   # every text run, in document order
        found = text.find(words, pos)
        assert found >= 0, f"{words!r} missing (or out of order) in the Word text"
        pos = found + len(words)
    for atom in ("x^2 + y", "\\int_0^1 x\\,dx", "report.pdf", "NVDA", "Not selected", "[1:15]",
                 "From Ask Notebook · 2026-09-02 · Q: What changed?", "Sources as of insertion: [1] Q2 note",
                 "2026-10-01", "[Chart: a widget]", "☑ done", "☐ open", "Warning"):
        assert atom in text, atom


def test_word_holds_headings_marks_lists_links_tables_code_and_this_notes_images(library):
    files, _ = _archive(library, "docx")
    parts = validate_docx(files["Trading/Setups/Cup and handle- the reclaim.docx"])
    body = parts["word/document.xml"].decode("utf-8")
    assert '<w:pStyle w:val="Title"/>' in body and '<w:pStyle w:val="Heading1"/>' in body
    assert "<w:b/>" in body and "<w:i/>" in body and "<w:strike/>" in body
    assert '<w:u w:val="single"/>' in body and '<w:highlight w:val="yellow"/>' in body
    assert '<w:rStyle w:val="CodeChar"/>' in body and '<w:pStyle w:val="Code"/>' in body
    assert 'x = $1</w:t><w:br/><w:br/><w:t xml:space="preserve">y = 2' in body  # a w:br per line
    assert '<w:numId w:val="1"/>' in body and '<w:numId w:val="3"/>' in body  # bullets, ordered
    assert "<w:tblHeader/>" in body and '<w:pStyle w:val="Quote"/>' in body
    assert body.count("<w:drawing>") == 3                      # hero + inline image + figure image
    assert '<wp:extent cx="38100" cy="19050"/>' in body        # 4x2 px, read from the header
    assert len([n for n in parts if n.startswith("word/media/")]) == 2   # the same image once
    assert _external_targets(parts) == ["https://example.com/a?b=1", "https://example.com/p",
                                        "https://www.youtube.com/watch?v=abc"]
    # the file attachment travels beside the document in the archive, named inside it
    assert "attachments/u1/a/file/report.pdf" in files


def test_HOSTILE_input_gives_a_word_document_whose_only_external_relationships_are_web_links():
    blob = F.note_docx(HOSTILE_DOC, title="t")
    assert _external_targets(validate_docx(blob)) == []      # none of the hostile links is a web link
    good = F.note_docx(_doc(_p(_t("ok", {"type": "link", "attrs": {"href": "https://example.com"}}),
                               _t("m", {"type": "link", "attrs": {"href": "mailto:a@b.c"}}))), title="t")
    assert _external_targets(validate_docx(good)) == ["https://example.com"]
    assert "<script>alert(1)</script>" in _docx_text(blob)   # the member's words, as words


def test_word_never_raises_on_a_node_it_does_not_know_and_keeps_its_words():
    weird = _doc(
        {"type": "futureBlock", "attrs": [], "content": [_p("kept words"), "not a dict", None]},
        {"type": "paragraph", "attrs": "string attrs", "content": [{"type": "mystery", "content": [_t("inline")]}]},
        {"type": "table", "content": ["x", {"type": "tableRow", "content": [None]}]},
        {"type": "image", "attrs": {"src": 5}},
        {"type": "heading", "attrs": {"level": "nope"}, "content": [_t("H")]},
        {"type": "orderedList", "attrs": {"start": "x"}, "content": [None, {"type": "listItem"}]},
        {"type": "text"},
        "garbage",
    )
    blob = F.note_docx(weird, title="t")
    validate_docx(blob)
    text = _docx_text(blob)
    assert "kept words" in text and "inline" in text and "H" in text


def test_word_images_count_against_the_export_byte_cap(library, monkeypatch):
    monkeypatch.setenv("NOTE_EXPORT_MAX_ATTACHMENT_BYTES", str(len(PNG_4x2) + 1))   # room for ONE
    files, _ = _archive(library, "docx")
    body = validate_docx(files["Trading/Setups/Cup and handle- the reclaim.docx"])["word/document.xml"]
    assert body.decode("utf-8").count("<w:drawing>") == 1                   # the hero took the cap
    assert "left out: export attachment size cap reached" in files["EXPORT_ISSUES.txt"].decode("utf-8")


# ── the archive seam ─────────────────────────────────────────────────────────

def test_a_web_page_archive_links_its_notes_to_each_other_as_web_pages(library):
    files, name = _archive(library, "html")
    assert name == "uct-notebook-export-20260926-html.zip"
    assert {"Trading/Setups/Cup and handle- the reclaim.html", "Research/NVDA.html",
            "Research/Not selected.html", "Root note.html"} <= set(files)
    assert not any(n.endswith(".md") for n in files)
    a = files["Trading/Setups/Cup and handle- the reclaim.html"].decode("utf-8")
    assert '<a href="../../Research/NVDA.html">NVDA</a>' in a
    assert 'src="../../attachments/u1/a/inline/img1.png"' in a
    assert '<img class="uct-note-hero" src="../../attachments/u1/a/hero/h1.png" alt="">' in a
    _assert_inert(a)
    assert json.loads(files["UCT_NOTEBOOK_EXPORT.json"])["format"] == "html"


def test_the_collision_set_is_judged_on_the_files_actually_written():
    rows = [{"id": "aaaaaaaa1", "title": "Same", "folder_id": None},
            {"id": "bbbbbbbb2", "title": "Same", "folder_id": None}]
    for fmt in ("md", "html", "json", "docx"):
        paths = notes_export._compute_note_export_paths(rows, {}, fmt)
        assert paths == {"aaaaaaaa1": "Same", "bbbbbbbb2": "Same-bbbbbbbb"}, fmt


def test_one_note_as_a_web_page_or_json_is_a_bare_file_without_attachments_and_a_zip_with_them(library):
    for fmt, media, ext in (("html", "text/html; charset=utf-8", ".html"),
                            ("json", "application/json", ".json")):
        bare, name, got = notes_export.build_single_note_export(USER, "c", conn=library, fmt=fmt)
        assert (name, got) == (f"Not selected-20260926{ext}", media)
        if fmt == "json":
            assert json.loads(bare)["note"]["folderPath"] == ["Research"]
        else:
            assert bare.decode("utf-8").startswith("<!doctype html>")
        zipped, name, got = notes_export.build_single_note_export(USER, "a", conn=library, fmt=fmt)
        assert (name, got) == ("Cup and handle- the reclaim-20260926.zip", "application/zip")
        files = _entries(zipped)
        assert f"Cup and handle- the reclaim{ext}" in files
        assert "attachments/u1/a/inline/img1.png" in files and "EXPORT_ISSUES.txt" in files


def test_one_note_as_word_is_always_one_docx_that_names_what_it_could_not_hold(library):
    blob, name, media = notes_export.build_single_note_export(USER, "a", conn=library, fmt="docx")
    assert (name, media) == ("Cup and handle- the reclaim-20260926.docx", F.DOCX_MEDIA_TYPE)
    validate_docx(blob)
    text = _docx_text(blob)
    assert "Not included in this export" in text
    assert "missing.png -- file missing on the attachment volume" in text
    assert "report.pdf -- a file attachment" in text
    plain, name, _ = notes_export.build_single_note_export(USER, "c", conn=library, fmt="docx")
    assert name.endswith(".docx") and "Not included" not in _docx_text(plain)
    assert notes_export.build_single_note_export(USER, "x", conn=library, fmt="docx") is None   # foreign
    assert notes_export.build_single_note_export(USER, "t", conn=library, fmt="html") is None   # trashed
