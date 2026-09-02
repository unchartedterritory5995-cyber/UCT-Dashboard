"""Notebook export: markdown fidelity and archive shape.

Fidelity matters more than prettiness here. An export is a trust artifact --
a member checks whether their notes survived, and silently dropping a table
or a task list is the failure that makes them keep paying for the old app.
"""
import io
import sqlite3
import zipfile

from api.services.journal_two.db import ensure_schema
from api.services.journal_two.notes_export import (
    build_export_zip, tiptap_to_markdown,
)


def _doc(*content):
    return {"type": "doc", "content": list(content)}


def _para(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def test_headings_and_paragraphs():
    md = tiptap_to_markdown(_doc(
        {"type": "heading", "attrs": {"level": 2},
         "content": [{"type": "text", "text": "Thesis"}]},
        _para("NVDA broke out."),
    ))
    assert md == "## Thesis\n\nNVDA broke out."


def test_marks_render_as_markdown():
    md = tiptap_to_markdown(_doc({"type": "paragraph", "content": [
        {"type": "text", "text": "bold", "marks": [{"type": "bold"}]},
        {"type": "text", "text": " and "},
        {"type": "text", "text": "italic", "marks": [{"type": "italic"}]},
    ]}))
    assert md == "**bold** and *italic*"


def test_link_mark_renders_with_href():
    md = tiptap_to_markdown(_doc({"type": "paragraph", "content": [
        {"type": "text", "text": "chart",
         "marks": [{"type": "link", "attrs": {"href": "https://example.com"}}]},
    ]}))
    assert md == "[chart](https://example.com)"


def test_task_list_uses_checkbox_syntax():
    md = tiptap_to_markdown(_doc({"type": "taskList", "content": [
        {"type": "taskItem", "attrs": {"checked": True}, "content": [_para("done")]},
        {"type": "taskItem", "attrs": {"checked": False}, "content": [_para("open")]},
    ]}))
    assert md == "- [x] done\n- [ ] open"


def test_table_renders_as_a_markdown_table():
    cell = lambda t: {"type": "tableCell", "content": [_para(t)]}
    head = lambda t: {"type": "tableHeader", "content": [_para(t)]}
    md = tiptap_to_markdown(_doc({"type": "table", "content": [
        {"type": "tableRow", "content": [head("Sym"), head("R")]},
        {"type": "tableRow", "content": [cell("NVDA"), cell("2.1")]},
    ]}))
    assert md == "| Sym | R |\n| --- | --- |\n| NVDA | 2.1 |"


def test_widget_embed_exports_its_search_text_not_an_empty_line():
    """A live chart cannot exist in markdown, but silently exporting nothing
    would make the note look like it lost content. The widget's own
    searchText is the honest textual stand-in."""
    md = tiptap_to_markdown(_doc({
        "type": "widgetEmbed",
        "attrs": {"searchText": "Chart NVDA 1D", "widgetId": "chart"},
    }))
    assert "Chart NVDA 1D" in md


def test_unknown_node_does_not_crash_and_keeps_descendant_text():
    """Export must never fail on a node type added after it was written --
    a future editor block should degrade to its text, not 500 the download."""
    md = tiptap_to_markdown(_doc({
        "type": "someFutureBlock",
        "content": [_para("still mine")],
    }))
    assert "still mine" in md


def test_zip_contains_one_markdown_file_per_note_with_front_matter():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain,"
        " tags, ticker, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        ("n1", "u1", "Cup and handle",
         '{"type":"doc","content":[{"type":"paragraph","content":'
         '[{"type":"text","text":"NVDA base"}]}]}',
         "NVDA base", '["setup"]', "NVDA",
         "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
    )
    c.commit()

    blob, filename = build_export_zip("u1", conn=c)
    assert filename.endswith(".zip")
    zf = zipfile.ZipFile(io.BytesIO(blob))
    names = zf.namelist()
    md_files = [n for n in names if n.endswith(".md")]
    assert len(md_files) == 1
    body = zf.read(md_files[0]).decode("utf-8")
    assert "title: Cup and handle" in body
    assert "ticker: NVDA" in body
    assert "NVDA base" in body


def test_export_is_scoped_to_the_requesting_user():
    """Cross-tenant leakage in an export is the worst possible bug class here
    -- it hands one member another member's entire notebook in one file."""
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    for nid, uid in (("n1", "u1"), ("n2", "u2")):
        c.execute(
            "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain,"
            " tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (nid, uid, f"note-{nid}", '{"type":"doc","content":[]}', "",
             "[]", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
        )
    c.commit()
    blob, _ = build_export_zip("u1", conn=c)
    names = zipfile.ZipFile(io.BytesIO(blob)).namelist()
    assert not any("n2" in n for n in names)
    assert any("n1" in n for n in names)


def test_nested_folders_export_as_nested_directories():
    """j2_note_folders is a real tree (parent_id, TEXT sentinel '' for roots).
    A note inside a sub-sub-folder must land at the FULL nested path in the
    zip, not just its immediate parent's name -- otherwise a member with a
    deep folder library silently loses structure on every export, and the
    round trip back through the importer (whose own folderPath is a full
    segment list) would not reproduce their layout."""
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    c.execute(
        "INSERT INTO j2_note_folders (id, user_id, name, parent_id, created_at)"
        " VALUES (?,?,?,?,?)", ("f1", "u1", "Trading", "", "2026-09-01T00:00:00Z"))
    c.execute(
        "INSERT INTO j2_note_folders (id, user_id, name, parent_id, created_at)"
        " VALUES (?,?,?,?,?)", ("f2", "u1", "Setups", "f1", "2026-09-01T00:00:00Z"))
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain,"
        " tags, folder_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        ("n1", "u1", "Cup and handle", '{"type":"doc","content":[]}', "",
         "[]", "f2", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
    )
    c.commit()

    blob, _ = build_export_zip("u1", conn=c)
    names = zipfile.ZipFile(io.BytesIO(blob)).namelist()
    assert "Trading/Setups/Cup and handle.md" in names


# ── Fix round 1 covering tests ───────────────────────────────────────────────
# Review findings, all in the one defect class this export exists to prevent:
# silently losing a member's content.


def test_export_survives_a_malformed_node_and_keeps_other_notes_intact():
    """Finding 1 (the worst of the four): tiptap_to_markdown wasn't
    exception-guarded in the export loop, so one malformed node (a non-dict
    entry in a content array) raised uncaught and would 500 the WHOLE
    archive -- denying a member all 4,000 notes for one bad block in one of
    them. The bad note must still export (front matter + a visible marker in
    place of the body) and every OTHER note in the same export must be
    completely unaffected."""
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain,"
        " tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        ("n1", "u1", "Corrupt note",
         # A null entry in "content" -- json.loads turns it into a bare
         # `None`, and the walker calls `.get("type")` on it deep in the
         # recursion, which raised AttributeError before this fix.
         '{"type":"doc","content":[null]}', "",
         "[]", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
    )
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain,"
        " tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        ("n2", "u1", "Healthy note",
         '{"type":"doc","content":[{"type":"paragraph","content":'
         '[{"type":"text","text":"still here"}]}]}',
         "still here", "[]", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
    )
    c.commit()

    # The call itself must not raise -- proving the export SURVIVES, not just
    # that the happy path works.
    blob, _ = build_export_zip("u1", conn=c)

    zf = zipfile.ZipFile(io.BytesIO(blob))
    names = zf.namelist()
    md_files = [n for n in names if n.endswith(".md")]
    assert len(md_files) == 2  # neither note vanished from the archive

    corrupt_body = zf.read("Corrupt note.md").decode("utf-8")
    assert "title: Corrupt note" in corrupt_body  # front matter intact
    assert "could not be converted" in corrupt_body  # visible marker

    healthy_body = zf.read("Healthy note.md").decode("utf-8")
    assert "still here" in healthy_body  # the other note is untouched

    # The archive tells the member what failed, not just the affected file.
    assert "EXPORT_ISSUES.txt" in names
    issues = zf.read("EXPORT_ISSUES.txt").decode("utf-8")
    assert "Corrupt note" in issues


def test_front_matter_includes_subtitle_and_hero_image():
    """Finding 2: hero_image_url and subtitle are real j2_notes columns that
    were never selected or exported. A subtitle is authored text and a hero
    image is the note's headline visual -- dropping either is the kind of
    loss a member notices immediately."""
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, subtitle, body_json,"
        " body_plain, tags, hero_image_url, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?)",
        ("n1", "u1", "Cup and handle", "A clean base-breakout setup",
         '{"type":"doc","content":[]}', "", "[]",
         "https://cdn.example.com/hero.jpg",
         "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
    )
    c.commit()

    blob, _ = build_export_zip("u1", conn=c)
    zf = zipfile.ZipFile(io.BytesIO(blob))
    body = zf.read("Cup and handle.md").decode("utf-8")
    assert "subtitle: A clean base-breakout setup" in body
    assert "hero_image: https://cdn.example.com/hero.jpg" in body


def test_video_timestamp_zero_is_not_treated_as_absent():
    """Finding 3: videoTimestamp only has a `seconds` attr (no `label` --
    see videoTimestampNode.js), and the old `attrs.get('label') or
    attrs.get('seconds') or 'timestamp'` chain swallowed a real 0-second
    timestamp as if it were missing, because 0 is falsy in Python too."""
    md = tiptap_to_markdown(_doc({
        "type": "videoTimestamp", "attrs": {"seconds": 0},
    }))
    assert md == "[0:00]"


def test_video_timestamp_matches_the_apps_own_mmss_format():
    """Finding 3 continued: a nonzero value used to export as a raw int
    (e.g. "[125]") instead of the app's own mm:ss rendering. This mirrors
    app/src/components/video/playerUtils.js::fmtTime exactly -- the same
    helper the editor's node view renders with."""
    md = tiptap_to_markdown(_doc({
        "type": "videoTimestamp", "attrs": {"seconds": 125},
    }))
    assert md == "[2:05]"

    md_hours = tiptap_to_markdown(_doc({
        "type": "videoTimestamp", "attrs": {"seconds": 3661},
    }))
    assert md_hours == "[1:01:01]"


def test_nested_bullet_list_indents_under_its_parent_item():
    """Finding 4: a list nested inside a listItem used to flatten to a
    sibling flat list at the top level -- text survived, but the outline
    hierarchy silently vanished. Outlines are a primary reason people keep
    notes; this asserts the nested item renders INDENTED under its parent,
    which fails outright on the old flattened output."""
    md = tiptap_to_markdown(_doc({
        "type": "bulletList",
        "content": [
            {"type": "listItem", "content": [
                _para("Parent"),
                {"type": "bulletList", "content": [
                    {"type": "listItem", "content": [_para("Child")]},
                ]},
            ]},
            {"type": "listItem", "content": [_para("Sibling")]},
        ],
    }))
    assert md == "- Parent\n  - Child\n- Sibling"
