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
        pytest.skip("no privilege to create a symlink/junction on this host")

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
