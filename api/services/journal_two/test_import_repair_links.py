"""Plan F Task 3: link repair over stored bodies, reusing the live resolvers.

Real schema (`ensure_schema` on a temp auth.db); notes are created through the file importer's
own `notes.import_confirm`, so their `import_key` / `import_source` are the shapes the live
client stores (`obsidian:${vfile.path}`, `notion:<id-stripped path>`, `file:${vfile.path}`).
"""
from __future__ import annotations

import copy
from pathlib import Path

import pytest

from api.services import auth_db
from api.services.journal_two import import_repair
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.import_repair import links
from api.services.journal_two.note_connectors.convert import LINK_PREFIX, linkify
from api.services.journal_two.note_connectors.convert.test_linkify import (
    VECTORS, _links, _vector_doc,
)
from api.services.journal_two.note_connectors.providers.obsidian import (
    _build_basename_map, resolve_pending_target,
)

USER = "u1"
HEX = "0123456789abcdef0123456789abcdef"
HEX2 = "fedcba9876543210fedcba9876543210"
DASHED = "01234567-89ab-cdef-0123-456789abcdef"


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    return tmp_path


def _para(*inline):
    return {"type": "paragraph", "content": list(inline)}


def _t(text, *marks):
    node = {"type": "text", "text": text}
    if marks:
        node["marks"] = [dict(m) for m in marks]
    return node


def _link(href):
    return {"type": "link", "attrs": {"href": href}}


BOLD = {"type": "bold"}


def _doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


def _import(source, key, title="t", user=USER):
    out = notes_svc.import_confirm(user, {"source": source, "destFolderId": None, "notes": [{
        "importKey": key, "title": title, "bodyJson": _doc(_para(_t(title))),
        "tags": [], "folderPath": [], "updatedAt": "2026-08-01T00:00:00+00:00"}]})
    return (out["created"] + out["updated"])[0]["id"]


def _note_href(note_id):
    return f"/journal?j2tab=notebook&note={note_id}"


def _repair(doc, *, import_key, import_source, note_class=import_repair.FILE, user=USER):
    conn = auth_db.get_connection()
    try:
        index = links.build_file_key_index(conn, user)
        return links.repair_links(doc, note_class=note_class, import_key=import_key,
                                  import_source=import_source, index=index, conn=conn, user_id=user)
    finally:
        conn.close()


def _index(user=USER):
    conn = auth_db.get_connection()
    try:
        return links.build_file_key_index(conn, user)
    finally:
        conn.close()


def _hrefs(doc):
    return [h for _, h in _links(doc)]


# ── Obsidian (file import: `obsidian:<vault>/<path>`, C9) ─────────────────────

def test_relative_obsidian_link_becomes_a_note_link(db):
    target = _import("Obsidian", "obsidian:Vault/Notes/Other note.md", "Other note")
    up = _import("Obsidian", "obsidian:Vault/Archive/Old.md", "Old")
    here_key = "obsidian:Vault/Notes/Here.md"
    _import("Obsidian", here_key, "Here")
    doc = _doc(_para(_t("x", _link("Other%20note.md"))),
               _para(_t("old", _link("../Archive/Old.md#Heading"))))
    before = copy.deepcopy(doc)
    out, actions = _repair(doc, import_key=here_key, import_source="Obsidian")
    assert _hrefs(out) == [_note_href(target), _note_href(up)]
    assert actions == ["relative_to_note", "link_resolved:2"]
    assert doc == before  # never mutates its input


def test_relative_obsidian_key_carries_the_vault_segment(db):
    """C9: the index is built per vault with the vault segment stripped, and the key written
    back is `obsidian:<vault>/<path>`, the same shape as the target's real importKey."""
    _import("Obsidian", "obsidian:Vault/Notes/Other.md")
    _import("Obsidian", "obsidian:Work/Notes/Other.md")  # another vault, same inner path
    index = _index()
    assert set(index.obsidian) == {"Vault", "Work"}
    assert "Notes/Other.md" in index.obsidian["Vault"].paths
    key = links.relative_target_key("Other.md", import_key="obsidian:Vault/Notes/Here.md",
                                    import_source="Obsidian", index=index)
    assert key == "obsidian:Vault/Notes/Other.md"
    key = links.relative_target_key("Other.md", import_key="obsidian:Work/Notes/Here.md",
                                    import_source="Obsidian", index=index)
    assert key == "obsidian:Work/Notes/Other.md"


def test_a_relative_link_to_a_non_note_file_is_not_a_note(db):
    """The live provider resolves a relative link only when it is a `.md` path:
    `report.pdf` must never open the note `report.md`."""
    _import("Obsidian", "obsidian:Vault/report.md")
    index = _index()
    assert links.relative_target_key("report.pdf", import_key="obsidian:Vault/Here.md",
                                     import_source="Obsidian", index=index) is None


def test_pct_keyed_obsidian_link_resolves_after_one_decode(db):
    target = _import("Obsidian", "obsidian:Vault/Target Note.md")
    doc = _doc(_para(_t("x", _link(LINK_PREFIX + "obsidian:Vault/Target%20Note.md"))))
    out, actions = _repair(doc, import_key="obsidian:Vault/Here.md", import_source="Obsidian")
    assert _hrefs(out) == [_note_href(target)]
    assert actions == ["pct_key_decoded", "link_resolved:1"]


def test_pct_key_whose_target_is_not_here_yet_is_decoded_and_kept_pending(db):
    doc = _doc(_para(_t("x", _link(LINK_PREFIX + "name:obsidian:v1/ghost%20note"))))
    out, actions = _repair(doc, import_key="obsidian:Vault/Here.md", import_source="Obsidian")
    assert _hrefs(out) == [LINK_PREFIX + "name:obsidian:v1/ghost note"]
    assert actions == ["pct_key_decoded"]


def test_a_pct_key_is_never_decoded_twice(db):
    """A name with a literal `%xx` after its one decode (`50%25AB` -> `50%AB`) that names a note
    is left alone, so a second run cannot decode it again into a different name."""
    target = _import("Obsidian", "obsidian:Vault/50%AB.md")
    doc = _doc(_para(_t("x", _link(LINK_PREFIX + "obsidian:Vault/50%25AB.md"))))
    out, actions = _repair(doc, import_key="obsidian:Vault/Here.md", import_source="Obsidian")
    assert _hrefs(out) == [_note_href(target)] and actions[0] == "pct_key_decoded"
    # a decoded key that still holds %xx and names nothing is not decoded at all
    doc = _doc(_para(_t("x", _link(LINK_PREFIX + "obsidian:Vault/99%2541.md"))))
    out, actions = _repair(doc, import_key="obsidian:Vault/Here.md", import_source="Obsidian")
    assert _hrefs(out) == [LINK_PREFIX + "obsidian:Vault/99%2541.md"] and actions == []


# ── Notion (file import: `notion:<id-stripped path>`) ─────────────────────────

def test_notion_zip_relative_link_resolves_by_stripped_path(db):
    plan = _import("Notion", "notion:Export/Plan.md", "Plan")
    child = _import("Notion", "notion:Export/Home/Child.md", "Child")
    home_key = "notion:Export/Home.md"
    _import("Notion", home_key, "Home")
    doc = _doc(_para(_t("plan", _link(f"Plan%20{HEX}.md"))),
               _para(_t("child", _link(f"Home%20{HEX2}/Child%20{HEX}.md#block"))))
    out, actions = _repair(doc, import_key=home_key, import_source="Notion")
    assert _hrefs(out) == [_note_href(plan), _note_href(child)]
    assert actions == ["relative_to_note", "link_resolved:2"]


def test_notion_collision_key_is_the_raw_path(db):
    """Two pages that strip to one key get their RAW path as the key (notion.js)."""
    raw = _import("Notion", f"notion:Export/Untitled {HEX}.md")
    _import("Notion", f"notion:Export/Untitled {HEX2}.md")
    doc = _doc(_para(_t("u", _link(f"Untitled%20{HEX}.md"))))
    out, _ = _repair(doc, import_key="notion:Export/Home.md", import_source="Notion")
    assert _hrefs(out) == [_note_href(raw)]


def test_notion_page_outside_the_export_keeps_a_working_key(db):
    doc = _doc(_para(_t("elsewhere", _link(f"Elsewhere%20{HEX}.md"))))
    out, actions = _repair(doc, import_key="notion:Export/Home.md", import_source="Notion")
    assert _hrefs(out) == [LINK_PREFIX + "notion:" + DASHED]
    assert LINK_PREFIX + linkify.notion_note_key(HEX) == _hrefs(out)[0]
    assert actions == ["relative_to_note"]


# ── generic files (`file:<path>`) ─────────────────────────────────────────────

def test_file_key_relative_link(db):
    target = _import("Files (2)", "file:docs/b.md")
    doc = _doc(_para(_t("b", _link("../docs/b.md"))))
    out, _ = _repair(doc, import_key="file:notes/a.md", import_source="Files (2)")
    assert _hrefs(out) == [_note_href(target)]


# ── what cannot resolve ───────────────────────────────────────────────────────

def test_unresolvable_relative_href_becomes_plain_text(db):
    doc = _doc(_para(_t("before "), _t("Missing", BOLD, _link("Missing.md")), _t(" after")))
    out, actions = _repair(doc, import_key="obsidian:Vault/Here.md", import_source="Obsidian")
    assert out == _doc(_para(_t("before "), _t("Missing", BOLD), _t(" after")))
    assert actions == ["relative_to_text"]
    # an unknown source, a key of no known kind, a missing vault: text, never a guess
    for key, source in (("keep:a.json", "Google Keep"), ("obsidian:Nowhere/Here.md", "Obsidian"),
                        ("evernote:nb/t/1", "Evernote")):
        out, actions = _repair(_doc(_para(_t("m", _link("Missing.md")))), import_key=key,
                               import_source=source)
        assert out == _doc(_para(_t("m"))) and actions == ["relative_to_text"], key


def test_relative_hrefs_are_repaired_in_file_notes_only(db):
    """Step 2 is FILE-only (plan + C11): a connector note's relative href is counted by the
    detector, never rewritten here."""
    _import("Obsidian", "obsidian:Vault/Other.md")
    doc = _doc(_para(_t("x", _link("Other.md"))))
    for note_class in (import_repair.CONNECTOR_ORPHANED, import_repair.CONNECTOR_RELIST):
        out, actions = _repair(doc, import_key="obsidian:Vault/Here.md", import_source="Obsidian",
                               note_class=note_class)
        assert out == doc and actions == [], note_class


def test_ambiguous_relative_targets(db):
    """C10: the expected answer is the LIVE resolver's on the same fixture, never a hard-coded
    order. Same-folder wins; else the shortest path; a duplicate Notion name is text."""
    paths = ["A/Plan.md", "B/Sub/Plan.md", "C/Here.md", "B/Sub/Here.md"]
    for p in paths:
        _import("Obsidian", f"obsidian:Vault/{p}")
    live = _build_basename_map(sorted(paths))
    index = _index()
    for from_dir, want in (("B/Sub", "B/Sub/Plan.md"), ("C", "A/Plan.md")):
        assert resolve_pending_target(f"Plan.md|{from_dir}|rel", live) == want
        got = links.relative_target_key("Plan.md", import_key=f"obsidian:Vault/{from_dir}/Here.md",
                                        import_source="Obsidian", index=index)
        assert got == f"obsidian:Vault/{want}"
    # Notion: two pages named Plan collide, so both carry their raw path; an id-less href
    # names neither and is never guessed.
    _import("Notion", f"notion:Export/Plan {HEX}.md")
    _import("Notion", f"notion:Export/Plan {HEX2}.md")
    out, actions = _repair(_doc(_para(_t("p", _link("Plan.md")))), import_key="notion:Export/Home.md",
                           import_source="Notion")
    assert out == _doc(_para(_t("p"))) and actions == ["relative_to_text"]


# ── linkify and the fixed point ───────────────────────────────────────────────

@pytest.mark.parametrize("v", VECTORS, ids=[v["name"] for v in VECTORS])
def test_linkify_obeys_the_live_allow_list(db, v):
    doc = _vector_doc(v["context"], v["text"])
    out, actions = _repair(doc, import_key="obsidian:Vault/Here.md", import_source="Obsidian")
    assert out == linkify.linkify_doc(doc)
    if v["context"] == "plain":
        assert _links(out) == [(x["text"], x["href"]) for x in v["links"]]
    assert actions == (["linkified"] if out != doc else [])


def test_a_live_connector_note_is_never_linkified(db):
    doc = _doc(_para(_t("read https://example.com/post")))
    out, actions = _repair(doc, import_key="notion:" + DASHED, import_source="notion",
                           note_class=import_repair.CONNECTOR_LIVE)
    assert out == doc and actions == []


def test_repair_links_is_a_fixed_point(db):
    target = _import("Obsidian", "obsidian:Vault/Other note.md")
    doc = _doc(
        _para(_t("rel", _link("Other%20note.md"))),
        _para(_t("pct", _link(LINK_PREFIX + "obsidian:Vault/Other%20note.md"))),
        _para(_t("gone", BOLD, _link("Missing.md"))),
        _para(_t("see https://example.com/a now")),
        _para(_t("ghost", _link(LINK_PREFIX + "obsidian:Vault/Ghost.md"))),
        {"type": "image", "attrs": {"src": "import-ref://pending.png"}},
    )
    once, actions = _repair(doc, import_key="obsidian:Vault/Here.md", import_source="Obsidian")
    assert actions == ["pct_key_decoded", "relative_to_note", "relative_to_text", "linkified",
                       "link_resolved:1"]
    assert _note_href(target) in _hrefs(once)
    assert LINK_PREFIX + "obsidian:Vault/Ghost.md" in _hrefs(once)  # unresolved stays pending
    assert once["content"][-1] == doc["content"][-1]  # a pending media ref is never dropped
    twice, again = _repair(once, import_key="obsidian:Vault/Here.md", import_source="Obsidian")
    assert twice == once and again == []


# ── the client's id-strip rule ────────────────────────────────────────────────

def test_strip_id_pattern_matches_the_client():
    src = Path("app/src/pages/journal-2-0/lib/importer/adapters/notion.js").read_text(encoding="utf-8")
    assert f"const STRIP_ID_RE = /{links.STRIP_ID_PATTERN}/i" in src


@pytest.mark.parametrize("path,want", [
    (f"Export {HEX}/Plan {HEX2}.md", "Export/Plan.md"),
    (f"Export/Plan {HEX.upper()}.html", "Export/Plan.html"),
    (f"Export/Plan {HEX}x.md", f"Export/Plan {HEX}x.md"),  # not at the end of the segment
    ("Export/Plan.md", "Export/Plan.md"),
])
def test_strip_notion_id_path(path, want):
    assert links.strip_notion_id_path(path) == want
