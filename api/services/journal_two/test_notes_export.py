"""Notebook export: markdown fidelity and archive shape.

Fidelity matters more than prettiness here. An export is a trust artifact --
a member checks whether their notes survived, and silently dropping a table
or a task list is the failure that makes them keep paying for the old app.
"""
import io
import os
import subprocess
import sqlite3
import zipfile

import pytest

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


def test_callout_exports_as_an_aside_with_the_emoji_inline():
    """Round-trips through the SAME shape the importer reads (calloutNode.js /
    importer/convert.js) -- Notion's own classic export shape."""
    md = tiptap_to_markdown(_doc({
        "type": "callout", "attrs": {"emoji": "\U0001F4A1"},
        "content": [_para("tip the reader should not miss")],
    }))
    assert md == "<aside>\n\U0001F4A1 tip the reader should not miss\n</aside>"


def test_callout_defaults_the_emoji_when_missing():
    md = tiptap_to_markdown(_doc({"type": "callout", "content": [_para("x")]}))
    assert md.startswith("<aside>\n\U0001F4A1 x")


def test_callout_never_puts_a_blank_line_inside_the_aside_block():
    """<aside> is a CommonMark type-6 HTML block, which terminates at the
    FIRST blank line. A blank line between multiple paragraphs would leave
    `</aside>` outside the block on re-import, surfacing as literal text."""
    md = tiptap_to_markdown(_doc({
        "type": "callout", "attrs": {"emoji": "⚠️"},
        "content": [_para("line one"), _para("line two")],
    }))
    body = md[len("<aside>\n"):-len("\n</aside>")]
    assert "\n\n" not in body


def test_toggle_exports_as_details_summary_open_by_default_in_the_editor():
    md = tiptap_to_markdown(_doc({
        "type": "toggle", "attrs": {"open": True},
        "content": [
            {"type": "toggleSummary", "content": [{"type": "text", "text": "More detail"}]},
            {"type": "toggleContent", "content": [_para("Hidden until expanded.")]},
        ],
    }))
    assert md == "<details>\n<summary>More detail</summary>\nHidden until expanded.\n</details>"


def test_toggle_never_puts_a_blank_line_inside_the_details_block():
    """<details>/<summary> are BOTH CommonMark type-6 html-block tags."""
    md = tiptap_to_markdown(_doc({
        "type": "toggle",
        "content": [
            {"type": "toggleSummary", "content": [{"type": "text", "text": "s"}]},
            {"type": "toggleContent", "content": [_para("line one"), _para("line two")]},
        ],
    }))
    body = md[len("<details>\n"):-len("\n</details>")]
    assert "\n\n" not in body


def test_toggle_survives_a_missing_or_reordered_child_without_raising():
    """Never raise on a future/older client's node shape (module docstring)."""
    md = tiptap_to_markdown(_doc({"type": "toggle", "content": [
        {"type": "toggleContent", "content": [_para("body only, no summary")]},
    ]}))
    assert "body only, no summary" in md


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


# ── Task 8: attachment bundling ──────────────────────────────────────────────
# Task 3 shipped markdown whose image/attachment links still point at our own
# authenticated `/api/j2/notes/attachments/...` route -- dead the moment a
# member's account goes away. These tests plant real files under a temp
# attachment root (mirroring exactly what notes.py::save_note_image_bytes /
# save_note_attachment_bytes write) and assert the zip carries the bytes with
# every markdown link rewritten to a portable relative path.

def _image_node(src, alt=""):
    return {"type": "image", "attrs": {"src": src, "alt": alt}}


def _chip_node(href, name="file.pdf"):
    return {"type": "attachmentChip", "attrs": {"href": href, "name": name}}


def _plant(root, user_id, note_id, sub, filename, data=b"fake-bytes"):
    p = root / user_id / "notes" / note_id / sub / filename
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


@pytest.fixture
def attach_root(tmp_path, monkeypatch):
    root = tmp_path / "j2_attachments"
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(root))
    return root


def _insert_note(conn, nid, uid, title, doc, *, hero_image_url=None):
    import json as _json
    conn.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain,"
        " tags, hero_image_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (nid, uid, title, _json.dumps(doc), "", "[]", hero_image_url,
         "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
    )


def test_inline_image_is_bundled_and_link_rewritten(attach_root):
    _plant(attach_root, "u1", "n1", "inline", "abc.png")
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    _insert_note(c, "n1", "u1", "Cup and handle", _doc(
        _image_node("/api/j2/notes/attachments/u1/n1/inline/abc.png")))
    c.commit()

    blob, _ = build_export_zip("u1", conn=c)
    zf = zipfile.ZipFile(io.BytesIO(blob))
    assert "attachments/u1/n1/inline/abc.png" in zf.namelist()
    body = zf.read("Cup and handle.md").decode("utf-8")
    # Rewritten to a relative path -- no more authenticated server URL.
    assert "/api/j2/notes/attachments/" not in body
    assert "attachments/u1/n1/inline/abc.png" in body
    assert zf.read("attachments/u1/n1/inline/abc.png") == b"fake-bytes"


def test_attachment_chip_file_is_bundled(attach_root):
    _plant(attach_root, "u1", "n1", "file", "report.pdf", b"%PDF-fake")
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    _insert_note(c, "n1", "u1", "Notes", _doc(
        _para("see attached"),
        _chip_node("/api/j2/notes/attachments/u1/n1/file/report.pdf"),
    ))
    c.commit()

    blob, _ = build_export_zip("u1", conn=c)
    zf = zipfile.ZipFile(io.BytesIO(blob))
    assert "attachments/u1/n1/file/report.pdf" in zf.namelist()
    body = zf.read("Notes.md").decode("utf-8")
    assert "attachments/u1/n1/file/report.pdf" in body


def test_hero_image_is_bundled_and_front_matter_rewritten(attach_root):
    _plant(attach_root, "u1", "n1", "hero", "hero.jpg")
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    _insert_note(
        c, "n1", "u1", "Cup and handle", _doc(_para("body")),
        hero_image_url="/api/j2/notes/attachments/u1/n1/hero/hero.jpg",
    )
    c.commit()

    blob, _ = build_export_zip("u1", conn=c)
    zf = zipfile.ZipFile(io.BytesIO(blob))
    assert "attachments/u1/n1/hero/hero.jpg" in zf.namelist()
    body = zf.read("Cup and handle.md").decode("utf-8")
    assert "hero_image: attachments/u1/n1/hero/hero.jpg" in body


def test_external_image_url_is_left_completely_untouched(attach_root):
    """A URL that is not our own attachments route (e.g. a pasted external
    image) must round-trip byte-identical -- no bundling attempt, no crash,
    no dependency on the file existing anywhere."""
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    _insert_note(c, "n1", "u1", "External pic", _doc(
        _image_node("https://cdn.example.com/chart.png")))
    c.commit()

    blob, _ = build_export_zip("u1", conn=c)
    body = zipfile.ZipFile(io.BytesIO(blob)).read("External pic.md").decode("utf-8")
    assert "https://cdn.example.com/chart.png" in body


def test_missing_attachment_file_is_skipped_not_fatal_and_reported(attach_root):
    """A member whose volume lost one image must still get every other note
    -- and this note's own text -- plus a named reason in the manifest, never
    a broken/blank archive."""
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    _insert_note(c, "n1", "u1", "Missing pic", _doc(
        _para("text survives"),
        _image_node("/api/j2/notes/attachments/u1/n1/inline/gone.png"),
    ))
    c.commit()

    blob, _ = build_export_zip("u1", conn=c)  # must not raise
    zf = zipfile.ZipFile(io.BytesIO(blob))
    body = zf.read("Missing pic.md").decode("utf-8")
    assert "text survives" in body
    # Original URL kept (nothing to link to locally) -- disclosed, not hidden.
    assert "/api/j2/notes/attachments/u1/n1/inline/gone.png" in body
    assert "EXPORT_ISSUES.txt" in zf.namelist()
    issues = zf.read("EXPORT_ISSUES.txt").decode("utf-8")
    assert "gone.png" in issues
    assert "Missing pic" in issues


def test_cross_tenant_attachment_reference_is_never_bundled(attach_root):
    """A note body is member-authored JSON. A crafted src naming ANOTHER
    account's user_id must never be read or served, even though the file
    genuinely exists on disk and export is read-only."""
    _plant(attach_root, "u2", "n2", "inline", "secret.png", b"u2-private-bytes")
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    _insert_note(c, "n1", "u1", "Snooping note", _doc(
        _image_node("/api/j2/notes/attachments/u2/n2/inline/secret.png")))
    c.commit()

    blob, _ = build_export_zip("u1", conn=c)
    zf = zipfile.ZipFile(io.BytesIO(blob))
    # u2's file must not appear anywhere in u1's export, by name or by bytes.
    assert not any("secret.png" in n for n in zf.namelist())
    assert not any(zf.read(n) == b"u2-private-bytes" for n in zf.namelist())
    body = zf.read("Snooping note.md").decode("utf-8")
    # Left unresolved -- the original (inert to this member) URL is kept.
    assert "/api/j2/notes/attachments/u2/n2/inline/secret.png" in body


def test_path_traversal_via_dotdot_note_id_is_rejected(attach_root, tmp_path):
    """A crafted src with `..` standing in for note_id collapses (once
    resolved) to `attachment_root()/u1/inline/gone.png` -- one level OUTSIDE
    where any real note's files live but still INSIDE the attachment root.
    It must resolve to nothing (no such file), never be treated as a hit,
    and never crash the export."""
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    _insert_note(c, "n1", "u1", "Traversal via note_id", _doc(_image_node(
        "/api/j2/notes/attachments/u1/../inline/gone.png"
    )))
    c.commit()

    blob, _ = build_export_zip("u1", conn=c)  # must not raise
    zf = zipfile.ZipFile(io.BytesIO(blob))
    assert not any(n.startswith("attachments/") for n in zf.namelist())
    body = zf.read("Traversal via note_id.md").decode("utf-8")
    assert "/api/j2/notes/attachments/u1/../inline/gone.png" in body


def test_path_traversal_via_dotdot_filename_is_rejected(attach_root, tmp_path):
    """`..` as the whole filename segment must be rejected before any
    filesystem access is attempted, even though it can never coincide with a
    real stored attachment (uploads are content-hash/uuid named)."""
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    _insert_note(c, "n1", "u1", "Traversal via filename", _doc(_image_node(
        "/api/j2/notes/attachments/u1/n1/inline/.."
    )))
    c.commit()

    blob, _ = build_export_zip("u1", conn=c)  # must not raise
    zf = zipfile.ZipFile(io.BytesIO(blob))
    assert not any(n.startswith("attachments/") for n in zf.namelist())


def _make_escape_link(link_path, target_dir):
    """Point `link_path` (a normal-looking, single path segment -- no `..`,
    no `/`, no `\\`) AT `target_dir`, which lives OUTSIDE the attachment
    root. This is the one realistic way a single clean segment can still
    resolve outside its parent: the belt checks in
    `_resolve_attachment_path` reject '..'/'/'/'\\' by string content, and
    those are the ONLY string-level tricks that exist -- a Windows
    drive-relative segment like "C:evil" was verified (by hand, not in this
    suite) to NOT trigger pathlib's absolute-path override the way
    "C:\\evil" does, and "C:\\evil" already contains a rejected backslash.
    So the only way left to defeat resolve-then-containment is a real
    filesystem redirect. Tries a symlink first (works unprivileged on POSIX,
    and on Windows with Developer Mode/admin), then a Windows directory
    junction via `mklink /J` (no elevation required). Returns True on
    success."""
    link_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.symlink(str(target_dir), str(link_path), target_is_directory=True)
        return True
    except OSError:
        pass
    if os.name == "nt":
        r = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link_path), str(target_dir)],
            capture_output=True, text=True,
        )
        return r.returncode == 0 and link_path.exists()
    return False


def test_path_traversal_via_directory_junction_is_rejected(attach_root, tmp_path):
    """The '..'/'/'/'\\' belt checks cannot catch THIS escape: `note_id`
    here (`escape_link`) is a perfectly ordinary single path segment with
    none of those characters, so it sails past the belt exactly like a
    legitimate note_id would. It only fails to resolve inside the
    attachment root because `escape_link` is a directory junction pointing
    OUTSIDE the root -- which only the resolve-then-`relative_to` check (the
    suspenders) can catch. A real file is planted at the resolved-but-
    escaped location so this test can only pass because that check actually
    ran, not because the input looked suspicious on its face."""
    outside = tmp_path / "outside_vault"
    (outside / "inline").mkdir(parents=True)
    (outside / "inline" / "secret.png").write_bytes(b"escaped-bytes")

    link = attach_root / "u1" / "notes" / "escape_link"
    if not _make_escape_link(link, outside):
        pytest.skip(
            "attachment path-traversal containment was NOT exercised on this "
            "host: no privilege to create a symlink/junction, so the "
            "filesystem-redirect escape this test proves against could not "
            "be constructed here"
        )

    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    _insert_note(c, "n1", "u1", "Junction escape", _doc(_image_node(
        "/api/j2/notes/attachments/u1/escape_link/inline/secret.png"
    )))
    c.commit()

    blob, _ = build_export_zip("u1", conn=c)  # must not raise
    zf = zipfile.ZipFile(io.BytesIO(blob))
    assert not any(zf.read(n) == b"escaped-bytes" for n in zf.namelist())
    assert not any(n.startswith("attachments/") for n in zf.namelist())
    body = zf.read("Junction escape.md").decode("utf-8")
    assert "/api/j2/notes/attachments/u1/escape_link/inline/secret.png" in body


def test_same_attachment_referenced_twice_is_bundled_once(attach_root):
    """One file referenced by two notes is stored once in the archive."""
    _plant(attach_root, "u1", "n1", "inline", "shared.png")
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    url = "/api/j2/notes/attachments/u1/n1/inline/shared.png"
    _insert_note(c, "n1", "u1", "First", _doc(_image_node(url)))
    _insert_note(c, "n2", "u1", "Second", _doc(_para("also links it"),
                                                _image_node(url)))
    c.commit()

    blob, _ = build_export_zip("u1", conn=c)
    names = zipfile.ZipFile(io.BytesIO(blob)).namelist()
    assert names.count("attachments/u1/n1/inline/shared.png") == 1


def test_attachment_size_cap_leaves_extra_files_out_and_reports_it(
        attach_root, monkeypatch):
    """The cap is env-overridable and never silently truncates -- exceeding
    it still returns the complete markdown, with the left-out file named in
    EXPORT_ISSUES.txt and its original (now-broken-once-they-leave) link kept
    rather than a dangling local reference."""
    _plant(attach_root, "u1", "n1", "inline", "first.png", b"x" * 50)
    _plant(attach_root, "u1", "n1", "inline", "second.png", b"y" * 50)
    monkeypatch.setenv("NOTE_EXPORT_MAX_ATTACHMENT_BYTES", "60")
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    _insert_note(c, "n1", "u1", "Two images", _doc(
        _image_node("/api/j2/notes/attachments/u1/n1/inline/first.png"),
        _image_node("/api/j2/notes/attachments/u1/n1/inline/second.png"),
    ))
    c.commit()

    blob, _ = build_export_zip("u1", conn=c)
    zf = zipfile.ZipFile(io.BytesIO(blob))
    names = zf.namelist()
    bundled = [n for n in names if n.startswith("attachments/")]
    assert len(bundled) == 1  # only the first fit under the 60-byte cap
    body = zf.read("Two images.md").decode("utf-8")
    assert "attachments/u1/n1/inline/first.png" in body
    assert "/api/j2/notes/attachments/u1/n1/inline/second.png" in body  # left as-is
    issues = zf.read("EXPORT_ISSUES.txt").decode("utf-8")
    assert "second.png" in issues
    assert "cap" in issues.lower()


def test_default_export_without_resolver_is_unaffected(attach_root):
    """tiptap_to_markdown called the OLD way (no attachment_resolver kwarg)
    renders image/attachmentChip URLs byte-identically to before bundling
    existed -- callers outside build_export_zip see no behavior change."""
    md = tiptap_to_markdown(_doc(_image_node("/api/j2/notes/attachments/u1/n1/inline/x.png")))
    assert md == "![](/api/j2/notes/attachments/u1/n1/inline/x.png)"


# ── Fix round 2 (review): hero-image resolver crash + unescaped YAML ────────


def test_unreadable_hero_image_does_not_abort_the_archive(attach_root, monkeypatch):
    """The hero-image resolver call used to sit OUTSIDE the per-note
    try/except that shields the body walk (`notes_export.py:128`'s
    `is_file()` was outside its `except (OSError, ValueError)`; `:201`'s
    `writestr()` was outside its `except OSError`). One EACCES on a hero
    image used to 500 the ENTIRE archive -- the exact failure shape already
    fixed for the body path. Simulates a permission error on the resolved
    hero path (real-world: an EACCES mount) via `Path.is_file`, and asserts
    the archive still comes back with every note intact and the failure
    recorded in EXPORT_ISSUES.txt, never a raise."""
    _plant(attach_root, "u1", "n1", "hero", "hero.jpg")

    import pathlib
    real_is_file = pathlib.Path.is_file

    def flaky_is_file(self, *a, **k):
        if self.name == "hero.jpg":
            raise OSError(13, "Permission denied")
        return real_is_file(self, *a, **k)

    monkeypatch.setattr(pathlib.Path, "is_file", flaky_is_file)

    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    _insert_note(
        c, "n1", "u1", "Cup and handle", _doc(_para("body text survives")),
        hero_image_url="/api/j2/notes/attachments/u1/n1/hero/hero.jpg",
    )
    _insert_note(c, "n2", "u1", "Second note", _doc(_para("also survives")))
    c.commit()

    blob, _ = build_export_zip("u1", conn=c)  # must not raise
    zf = zipfile.ZipFile(io.BytesIO(blob))
    names = zf.namelist()
    assert "Cup and handle.md" in names
    assert "Second note.md" in names

    body1 = zf.read("Cup and handle.md").decode("utf-8")
    assert "body text survives" in body1  # body untouched by the hero failure
    # Hero fell back to the original (now-broken-once-they-leave) URL rather
    # than blanking or crashing.
    assert "hero_image:" in body1

    body2 = zf.read("Second note.md").decode("utf-8")
    assert "also survives" in body2  # the OTHER note is completely unaffected

    assert "EXPORT_ISSUES.txt" in names
    issues = zf.read("EXPORT_ISSUES.txt").decode("utf-8")
    assert "hero.jpg" in issues


def test_attachment_write_failure_is_recorded_not_fatal(attach_root, monkeypatch):
    """The second understated defect at the same line-pair: `writestr()`
    inside the attachment resolver's write path used to sit outside its own
    `except OSError`. A write failure for one attachment (disk error, a torn
    handle) must be skipped and reported, exactly like a read failure
    already is -- never abort the archive."""
    _plant(attach_root, "u1", "n1", "inline", "abc.png")
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    _insert_note(c, "n1", "u1", "Cup and handle", _doc(
        _para("text survives"),
        _image_node("/api/j2/notes/attachments/u1/n1/inline/abc.png")))
    c.commit()

    real_writestr = zipfile.ZipFile.writestr

    def flaky_writestr(self, zinfo_or_arcname, data, *a, **k):
        name = zinfo_or_arcname if isinstance(zinfo_or_arcname, str) else zinfo_or_arcname.filename
        if name.startswith("attachments/"):
            raise OSError(28, "No space left on device")
        return real_writestr(self, zinfo_or_arcname, data, *a, **k)

    monkeypatch.setattr(zipfile.ZipFile, "writestr", flaky_writestr)

    blob, _ = build_export_zip("u1", conn=c)  # must not raise
    zf = zipfile.ZipFile(io.BytesIO(blob))
    names = zf.namelist()
    assert "Cup and handle.md" in names
    assert not any(n.startswith("attachments/") for n in names)
    body = zf.read("Cup and handle.md").decode("utf-8")
    assert "text survives" in body
    issues = zf.read("EXPORT_ISSUES.txt").decode("utf-8")
    assert "abc.png" in issues


def _decode_yaml_double_quoted(raw):
    """A minimal, dependency-free decoder for exactly the YAML scalar styles
    `_yaml_scalar` can emit (bare plain scalar, or a double-quoted scalar
    with backslash escapes) -- proving the front matter this export writes
    round-trips through genuine YAML double-quoted-scalar semantics, without
    pulling in a YAML library this repo does not otherwise depend on."""
    if raw.startswith('"') and raw.endswith('"') and len(raw) >= 2:
        inner = raw[1:-1]
        out = []
        i = 0
        while i < len(inner):
            ch = inner[i]
            if ch == "\\" and i + 1 < len(inner):
                nxt = inner[i + 1]
                out.append({"n": "\n", "r": "\r", "t": "\t",
                            '"': '"', "\\": "\\"}.get(nxt, nxt))
                i += 2
            else:
                out.append(ch)
                i += 1
        return "".join(out)
    return raw


def test_title_with_colon_quote_and_newline_round_trips_through_yaml():
    """An ordinary title -- 'Setup: "NVDA" reclaim' is not an edge case --
    used to be interpolated bare into the front matter (`f"title: {title}"`),
    which is not valid YAML the moment it contains a colon, a quote, or a
    literal newline. That breaks the round trip back through the importer,
    which is the export's whole stated reason to exist. Decodes the emitted
    `title:` value with a minimal from-scratch YAML double-quoted-scalar
    decoder (see `_decode_yaml_double_quoted`) AND, when PyYAML happens to be
    importable, cross-checks with a real YAML parser for extra rigor."""
    tricky_title = 'Setup: "NVDA" reclaim\nsecond line'
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain,"
        " tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        ("n1", "u1", tricky_title,
         '{"type":"doc","content":[{"type":"paragraph","content":'
         '[{"type":"text","text":"body"}]}]}',
         "body", "[]", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
    )
    c.commit()

    blob, _ = build_export_zip("u1", conn=c)
    zf = zipfile.ZipFile(io.BytesIO(blob))
    md_files = [n for n in zf.namelist() if n.endswith(".md")]
    assert len(md_files) == 1  # _safe_name sanitizes the FILENAME separately
    text = zf.read(md_files[0]).decode("utf-8")

    lines = text.split("\n")
    assert lines[0] == "---"
    close_idx = lines[1:].index("---") + 1
    front_lines = lines[1:close_idx]
    # The whole title -- colon, quote, embedded newline and all -- must
    # render as ONE front-matter line, never split the block across lines.
    title_lines = [l for l in front_lines if l.startswith("title: ")]
    assert len(title_lines) == 1
    raw_value = title_lines[0][len("title: "):]

    assert _decode_yaml_double_quoted(raw_value) == tricky_title

    try:
        import yaml
    except ImportError:
        yaml = None
    if yaml is not None:
        parsed = yaml.safe_load("\n".join(front_lines))
        assert parsed["title"] == tricky_title


def test_ordinary_title_still_renders_bare_no_gratuitous_quoting():
    """The escaping fix must not start quoting every title -- only the ones
    that actually need it, so the huge existing corpus of plain titles keeps
    rendering byte-identically."""
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain,"
        " tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        ("n1", "u1", "Cup and handle breakout",
         '{"type":"doc","content":[]}', "", "[]",
         "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
    )
    c.commit()
    blob, _ = build_export_zip("u1", conn=c)
    body = zipfile.ZipFile(io.BytesIO(blob)).read(
        "Cup and handle breakout.md").decode("utf-8")
    assert "title: Cup and handle breakout" in body
    assert '"' not in body.split("---")[1]  # front matter block, unquoted
