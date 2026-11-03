"""Plan F Task 3: link repair over stored bodies, reusing the live resolvers.

Real schema (`ensure_schema` on a temp auth.db); notes are created through the file importer's
own `notes.import_confirm`, so their `import_key` / `import_source` are the shapes the live
client stores (`obsidian:${vfile.path}`, `notion:<id-stripped path>`, `file:${vfile.path}`).
"""
from __future__ import annotations

import copy
import unicodedata
from pathlib import Path
from urllib.parse import quote

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


def test_multi_vault_drop_never_opens_another_vaults_note(db):
    """C-1 (review P1a/P1b): `Obsidian/Work` and `Obsidian/Personal` are two vaults to the
    client (`.obsidian/` roots), but the stored keys only show the first segment `Obsidian`.
    A name match is taken only when it is the ONE candidate in the C9 vault AND it sits in the
    linking note's own first folder; anything else is left as written and counted."""
    here = "obsidian:Obsidian/Work/Notes/Here.md"
    _import("Obsidian", here)
    _import("Obsidian", "obsidian:Obsidian/Work/Projects/Plan.md")
    _import("Obsidian", "obsidian:Obsidian/Personal/Plan.md")
    _import("Obsidian", "obsidian:Obsidian/Personal/Budget.md")
    # P1a: two Plans, one per vault -> never chosen between
    doc = _doc(_para(_t("p", _link("Plan.md"))))
    out, actions = _repair(doc, import_key=here, import_source="Obsidian")
    assert out == doc and actions == ["relative_ambiguous"]
    # P1b: the only Budget is in the OTHER vault -> never crossed into
    doc = _doc(_para(_t("b", _link("Budget.md"))))
    out, actions = _repair(doc, import_key=here, import_source="Obsidian")
    assert out == doc and actions == ["relative_unresolved"]


def test_a_unique_name_match_in_the_notes_own_folder_is_counted_apart(db):
    """C-1: the one name match the repair takes (single candidate, same first folder) is a
    write under its own code, so the dry run shows how many links resolved by name."""
    target = _import("Obsidian", "obsidian:Vault/Notes/Deep/Plan.md")
    here = "obsidian:Vault/Notes/Here.md"
    _import("Obsidian", here)
    doc = _doc(_para(_t("p", _link("Plan.md"))), _para(_t("q", _link("Deep2/Plan.md"))))
    out, actions = _repair(doc, import_key=here, import_source="Obsidian")
    assert _hrefs(out) == [_note_href(target), "Deep2/Plan.md"]
    assert actions == ["relative_by_name", "relative_unresolved", "link_resolved:1"]
    # a path-qualified name (suffix) follows the same rule
    out, actions = _repair(_doc(_para(_t("p", _link("Deep/Plan.md")))), import_key="obsidian:Vault/Notes/X/Here.md",
                           import_source="Obsidian")
    assert _hrefs(out) == [_note_href(target)] and actions == ["relative_by_name", "link_resolved:1"]


@pytest.mark.parametrize("from_key,href,target_key", [
    ("obsidian:Notes/a.md", "../b.md", "obsidian:b.md"),                       # P7a
    ("obsidian:Notes/a.md", "../Archive/Old.md", "obsidian:Archive/Old.md"),   # P7b
    ("obsidian:b.md", "Notes/a.md", "obsidian:Notes/a.md"),                    # P7c
])
def test_a_drop_without_a_vault_folder_resolves_exact_paths_across_it(db, from_key, href, target_key):
    """I-4: when the member dropped the vault's CONTENTS, the first segment is a folder, not a
    vault. An exact relative path is what the member wrote, so it is retried over every Obsidian
    file path of the member (exact only, never the name rule)."""
    ids = {k: _import("Obsidian", k) for k in ("obsidian:Notes/a.md", "obsidian:b.md",
                                                "obsidian:Archive/Old.md")}
    doc = _doc(_para(_t("x", _link(href))))
    out, actions = _repair(doc, import_key=from_key, import_source="Obsidian")
    assert _hrefs(out) == [_note_href(ids[target_key])]
    assert actions == ["relative_to_note", "link_resolved:1"]


def test_the_drop_wide_retry_never_roots_at_the_top_of_another_import(db):
    """Fix round 2, N-1 (re-review R1): the drop-wide retry tries ONLY the path beside the note.
    "From the top" over every Obsidian key the member has would mix separate imports: a bare
    `Plan.md` in `MyVault/Notes/` must not open a loose `Plan.md` from another drop."""
    _import("Obsidian", "obsidian:MyVault/Notes/Here.md")
    _import("Obsidian", "obsidian:MyVault/Archive/Plan.md")
    _import("Obsidian", "obsidian:Plan.md")  # a loose top-level file from ANOTHER import
    doc = _doc(_para(_t("p", _link("Plan.md"))))
    out, actions = _repair(doc, import_key="obsidian:MyVault/Notes/Here.md", import_source="Obsidian")
    assert out == doc and actions == ["relative_unresolved"]


def test_the_drop_wide_retry_is_exact_only(db):
    """I-4: the retry across first folders never uses the name rule (that would be C-1's
    hazard again): `Plan.md` from `Work/Here.md` does not open `Personal/Plan.md`."""
    _import("Obsidian", "obsidian:Personal/Plan.md")
    _import("Obsidian", "obsidian:Work/Here.md")
    doc = _doc(_para(_t("p", _link("Plan.md"))))
    out, actions = _repair(doc, import_key="obsidian:Work/Here.md", import_source="Obsidian")
    assert out == doc and actions == ["relative_unresolved"]


def test_the_drop_wide_retry_respects_a_trashed_target(db):
    """I-4 + I-1: an exact path across first folders that names a trashed note is counted as
    trashed, never resolved and never reported as merely missing."""
    gone = _import("Obsidian", "obsidian:Top/Plan.md")
    _import("Obsidian", "obsidian:Notes/a.md")
    _trash(gone)
    doc = _doc(_para(_t("p", _link("../Top/Plan.md"))))
    out, actions = _repair(doc, import_key="obsidian:Notes/a.md", import_source="Obsidian")
    assert out == doc and actions == ["relative_target_trashed"]


def _trash(note_id):
    conn = auth_db.get_connection()
    try:
        conn.execute("UPDATE j2_notes SET deleted_at = '2026-10-01T00:00:00+00:00' WHERE id = ?", (note_id,))
        conn.commit()
    finally:
        conn.close()


def test_a_trashed_target_is_never_replaced_by_a_same_named_note(db):
    """I-1 (review P2b): the link names `Notes/Plan.md` exactly. When the member trashed that
    note, a same-named note in the same folder tree is NOT what they linked: left as written."""
    beside = _import("Obsidian", "obsidian:V/Notes/Plan.md")
    _import("Obsidian", "obsidian:V/Notes/Archive/Plan.md")
    here = "obsidian:V/Notes/Here.md"
    _import("Obsidian", here)
    doc = _doc(_para(_t("p", _link("Plan.md"))))
    out, actions = _repair(doc, import_key=here, import_source="Obsidian")
    assert _hrefs(out) == [_note_href(beside)]  # present: the exact path wins
    _trash(beside)
    index = _index()
    assert "obsidian:V/Notes/Plan.md" not in index.keys
    out, actions = _repair(doc, import_key=here, import_source="Obsidian")
    assert out == doc and actions == ["relative_target_trashed"]


def test_an_exact_case_trashed_target_beats_a_live_case_twin(db):
    """Fix round 3, N-7 (re-review R12): `other.md` is trashed and `Other.md` is live. The
    link names `other.md` exactly, so it meant the trashed note, not its case twin."""
    _trash(_import("Obsidian", "obsidian:V/other.md"))
    _import("Obsidian", "obsidian:V/Other.md")
    doc = _doc(_para(_t("o", _link("other.md"))))
    out, actions = _repair(doc, import_key="obsidian:V/Here.md", import_source="Obsidian")
    assert out == doc and actions == ["relative_target_trashed"]


def test_a_trashed_same_name_note_counts_toward_ambiguity(db):
    """Fix round 2, N-5 (re-review R6): the name was not unique when the link was written if a
    trashed note carries it too, so the one live match is not taken by name."""
    _import("Obsidian", "obsidian:V/Notes/Here.md")
    _import("Obsidian", "obsidian:V/Notes/Sub/Plan.md")
    _trash(_import("Obsidian", "obsidian:V/Old/Plan.md"))
    doc = _doc(_para(_t("p", _link("Plan.md"))))
    out, actions = _repair(doc, import_key="obsidian:V/Notes/Here.md", import_source="Obsidian")
    assert out == doc and actions == ["relative_ambiguous"]


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


def test_a_file_link_that_leaves_the_drop_names_nothing(db):
    """I-2 (review P15): `file:` keys join by `posixpath.normpath`. A link that climbs above
    the drop is outside it, never folded onto a top-level file the member did not name."""
    _import("Files (2)", "file:x.md")
    doc = _doc(_para(_t("x", _link("../../x.md"))))
    out, actions = _repair(doc, import_key="file:a/b.md", import_source="Files (2)")
    assert out == doc and actions == ["relative_unresolved"]
    # Notion keeps the client's folding (`resolvePath`): a `..` above the top stays at the top
    plan = _import("Notion", "notion:Plan.md")
    out, _ = _repair(_doc(_para(_t("p", _link(f"../../Plan%20{HEX}.md")))),
                     import_key="notion:Export/Home.md", import_source="Notion")
    assert _hrefs(out) == [_note_href(plan)]


@pytest.mark.parametrize("stored_form,href_form", [("NFD", "NFC"), ("NFC", "NFD")])
@pytest.mark.parametrize("source,key_of,here", [
    ("Obsidian", lambda name: f"obsidian:V/{name}.md", "obsidian:V/Here.md"),
    ("Notion", lambda name: f"notion:Export/{name}.md", "notion:Export/Home.md"),
    ("Files (2)", lambda name: f"file:docs/{name}.md", "file:docs/a.md"),
])
def test_unicode_normal_forms_compare_equal(db, stored_form, href_form, source, key_of, here):
    """M-1 (review P6): a macOS export stores names decomposed (NFD); a link may be written
    composed (NFC), or the other way round. Both sides are NFC-normalised for the lookup, and
    the key written back is the one STORED, so `resolve_link_keys` finds it exactly."""
    stored = key_of(unicodedata.normalize(stored_form, "Café Plan"))
    target = _import(source, stored)
    href = quote(unicodedata.normalize(href_form, "Café Plan") + ".md")
    out, actions = _repair(_doc(_para(_t("c", _link(href)))), import_key=here, import_source=source)
    assert _hrefs(out) == [_note_href(target)]
    assert actions == ["relative_to_note", "link_resolved:1"]


@pytest.mark.parametrize("source,key_of,here", [
    ("Obsidian", lambda name: f"obsidian:V/{name}.md", "obsidian:V/Here.md"),
    ("Notion", lambda name: f"notion:Export/{name}.md", "notion:Export/Home.md"),
    ("Files (2)", lambda name: f"file:docs/{name}.md", "file:docs/a.md"),
])
def test_the_exact_string_wins_over_a_unicode_twin(db, source, key_of, here):
    """Fix round 2, N-3 (re-review R7): with an NFC and an NFD note of the same name, each
    link opens the note spelled EXACTLY as it is written; folding is only a fallback."""
    ids = {form: _import(source, key_of(unicodedata.normalize(form, "Café"))) for form in ("NFD", "NFC")}
    for form in ("NFC", "NFD"):
        href = quote(unicodedata.normalize(form, "Café") + ".md")
        out, _ = _repair(_doc(_para(_t("c", _link(href)))), import_key=here, import_source=source)
        assert _hrefs(out) == [_note_href(ids[form])], form


def test_the_exact_case_wins_over_a_case_twin_and_folding_needs_one_candidate(db):
    """N-3 (re-review R5/P5): `other.md` opens `other.md`, `Other.md` opens `Other.md`; an
    href matching neither exactly, with two case twins, names nothing."""
    upper = _import("Obsidian", "obsidian:V/Other.md")
    lower = _import("Obsidian", "obsidian:V/other.md")
    for href, want in (("other.md", lower), ("Other.md", upper)):
        out, _ = _repair(_doc(_para(_t("o", _link(href)))), import_key="obsidian:V/Here.md",
                         import_source="Obsidian")
        assert _hrefs(out) == [_note_href(want)], href
    doc = _doc(_para(_t("o", _link("OTHER.md"))))
    out, actions = _repair(doc, import_key="obsidian:V/Here.md", import_source="Obsidian")
    assert out == doc and actions == ["relative_ambiguous"]
    # one candidate: folding still finds it
    only = _import("Obsidian", "obsidian:V/Solo.md")
    out, _ = _repair(_doc(_para(_t("s", _link("SOLO.md")))), import_key="obsidian:V/Here.md",
                     import_source="Obsidian")
    assert _hrefs(out) == [_note_href(only)]


# ── what cannot resolve ───────────────────────────────────────────────────────

def test_unresolvable_relative_note_href_is_left_as_written_and_counted(db):
    """Fix round 1, I-3: a repair never makes a note worse. A link it cannot resolve keeps its
    href exactly as written; the code is a count for the dry run, not a write."""
    doc = _doc(_para(_t("before "), _t("Missing", BOLD, _link("Missing.md")), _t(" after")))
    out, actions = _repair(doc, import_key="obsidian:Vault/Here.md", import_source="Obsidian")
    assert out == doc
    assert actions == ["relative_unresolved"]
    # an unknown source, a key of no known kind, a missing vault: as written, never a guess
    for key, source in (("keep:a.json", "Google Keep"), ("obsidian:Nowhere/Here.md", "Obsidian"),
                        ("evernote:nb/t/1", "Evernote"), ("notion:Export/Home.md", "Notion"),
                        ("file:notes/a.md", "Files (2)")):
        doc = _doc(_para(_t("m", _link("Missing.md"))))
        out, actions = _repair(doc, import_key=key, import_source=source)
        assert out == doc and actions == ["relative_unresolved"], key


@pytest.mark.parametrize("href,key,source", [
    ("report.pdf", "obsidian:Vault/Here.md", "Obsidian"),
    ("attachments/x.png", "obsidian:Vault/Here.md", "Obsidian"),
    (f"Home/Budget%20{HEX}.csv", "notion:Export/Home.md", "Notion"),
    ("files/deck.pdf", "file:notes/a.md", "Files (2)"),
    ("Trip.textbundle/assets/a.png", "file:notes/a.md", "Files (2)"),  # a bundle member
    ("deck.mov", "obsidian:Vault/Here.md", "Obsidian"),  # `.mov` is a TLD, still a file
])
def test_a_non_note_file_link_is_left_as_written_and_counted_apart(db, href, key, source):
    """I-3: a link to a file that is not a note is a lost file, counted under its own code so
    T4/T6 can place the visible `missing_from_import` marker for it."""
    doc = _doc(_para(_t("f", _link(href))))
    out, actions = _repair(doc, import_key=key, import_source=source)
    assert out == doc and actions == ["relative_file_unresolved"]


@pytest.mark.parametrize("key,source", [
    ("obsidian:Vault/Here.md", "Obsidian"), ("notion:Export/Home.md", "Notion"),
    ("file:notes/a.md", "Files (2)"),
])
def test_a_host_written_without_a_scheme_is_never_a_lost_file(db, key, source):
    """Fix round 1 follow-up (concern 2): `www.example.com` as an href is a web address the
    member wrote without `https://`, not a file that didn't come over. When linkify's live
    allow-list would link that text, the href becomes linkify's own URL (a write); any other
    host-like href (`example.com/path`, which the allow-list does not link) stays as written
    under its own count, with no `missing_from_import` marker."""
    out, actions = _repair(_doc(_para(_t("site", _link("www.example.com/a?b=1")))),
                           import_key=key, import_source=source)
    assert _hrefs(out) == ["https://www.example.com/a?b=1"]
    assert actions == ["relative_hostlike_linked"]
    assert linkify._matches("www.example.com/a?b=1") == [(0, 21, "https://www.example.com/a?b=1")]
    doc = _doc(_para(_t("site", _link("example.com/path"))))
    out, actions = _repair(doc, import_key=key, import_source=source)
    assert out == doc and actions == ["relative_hostlike"]


@pytest.mark.parametrize("target_key,here,source,href", [
    ("obsidian:V/Clients/acme.io/Meeting.md", "obsidian:V/Clients/Here.md", "Obsidian",
     "acme.io/Meeting.md"),                                                      # R4
    ("obsidian:V/Sites/www.site.com/post.md", "obsidian:V/Sites/Here.md", "Obsidian",
     "www.site.com/post.md"),                                                    # R4b
    ("file:www.blog.com/post.md", "file:Here.md", "Files (1)", "www.blog.com/post.md"),  # R4c
])
def test_a_note_in_a_folder_named_like_a_domain_is_still_a_note(db, target_key, here, source, href):
    """Fix round 2, N-2: note resolution runs FIRST; an href is host-like only when nothing
    resolves. A folder named `acme.io` or `www.site.com` holding the member's note must never
    send the link to the web."""
    target = _import(source, target_key)
    _import(source, here)
    out, actions = _repair(_doc(_para(_t("m", _link(href)))), import_key=here, import_source=source)
    assert _hrefs(out) == [_note_href(target)]
    assert actions == ["relative_to_note", "link_resolved:1"]


@pytest.mark.parametrize("href,here,source", [
    ("www.site.com/post.md", "obsidian:V/Here.md", "Obsidian"),   # R13: a `.md` href is a note
    ("www.site.md", "obsidian:V/Here.md", "Obsidian"),            # R13b: `.md` is also a TLD
    ("www.blog.com/p.html", "file:Here.html", "Files (1)"),       # R17: a generic note file
])
def test_a_missing_note_link_is_never_sent_to_the_web(db, href, here, source):
    """Fix round 3, N-6: host-like applies ONLY where the source's rule says the href is not a
    note (`relative_file_unresolved`). A note link whose note did not arrive stays as written
    and is counted: a later import can still heal it, a rewrite to https could not."""
    doc = _doc(_para(_t("s", _link(href))))
    out, actions = _repair(doc, import_key=here, import_source=source)
    assert out == doc and actions == ["relative_unresolved"]


def test_a_textbundle_text_link_opens_the_bundle_note(db):
    """Concern 3: the generic importer keys a TextBundle as ONE note, `file:<bundle dir>`, and
    maps its `text.md` to that key (`generic.js` keyByPath). The repair does the same."""
    bundle = _import("Files (2)", "file:notes/Trip.textbundle")
    doc = _doc(_para(_t("trip", _link("Trip.textbundle/text.md"))),
               _para(_t("trip2", _link("../notes/Trip.TEXTBUNDLE/Text.md"))))
    out, actions = _repair(doc, import_key="file:notes/a.md", import_source="Files (2)")
    assert _hrefs(out) == [_note_href(bundle), "../notes/Trip.TEXTBUNDLE/Text.md"]
    assert actions == ["relative_to_note", "relative_unresolved", "link_resolved:1"]
    # a bundle that was not imported is a missing NOTE, not a lost file
    doc = _doc(_para(_t("gone", _link("Gone.textbundle/text.md"))))
    out, actions = _repair(doc, import_key="file:notes/a.md", import_source="Files (2)")
    assert out == doc and actions == ["relative_unresolved"]


def test_action_codes_split_into_writes_and_counts():
    assert links.COUNT_ONLY_ACTIONS == frozenset({
        "relative_ambiguous", "relative_target_trashed", "relative_unresolved",
        "relative_file_unresolved", "relative_hostlike"})


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
    """C10 + fix round 1 C-1: the exact path the member wrote agrees with the LIVE resolver;
    where the live resolver would CHOOSE between two notes by name (shortest path), the repair
    refuses: it cannot see vault roots, so a choice could open another vault's note."""
    paths = ["A/Plan.md", "B/Sub/Plan.md", "C/Here.md", "B/Sub/Here.md"]
    for p in paths:
        _import("Obsidian", f"obsidian:Vault/{p}")
    live = _build_basename_map(sorted(paths))
    index = _index()
    assert resolve_pending_target("Plan.md|B/Sub|rel", live) == "B/Sub/Plan.md"
    assert links.relative_target("Plan.md", import_key="obsidian:Vault/B/Sub/Here.md",
                                 import_source="Obsidian", index=index) == (
        "obsidian:Vault/B/Sub/Plan.md", "relative_to_note")
    assert resolve_pending_target("Plan.md|C|rel", live) == "A/Plan.md"  # live: shortest
    assert links.relative_target("Plan.md", import_key="obsidian:Vault/C/Here.md",
                                 import_source="Obsidian", index=index) == (None, "relative_ambiguous")
    doc = _doc(_para(_t("p", _link("Plan.md"))))
    out, actions = _repair(doc, import_key="obsidian:Vault/C/Here.md", import_source="Obsidian")
    assert out == doc and actions == ["relative_ambiguous"]
    # Notion: two pages named Plan collide, so both carry their raw path; an id-less href
    # names neither and is never guessed (left as written, counted).
    _import("Notion", f"notion:Export/Plan {HEX}.md")
    _import("Notion", f"notion:Export/Plan {HEX2}.md")
    doc = _doc(_para(_t("p", _link("Plan.md"))))
    out, actions = _repair(doc, import_key="notion:Export/Home.md", import_source="Notion")
    assert out == doc and actions == ["relative_unresolved"]


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
    assert actions == ["pct_key_decoded", "relative_to_note", "relative_unresolved", "linkified",
                       "link_resolved:1"]
    assert _note_href(target) in _hrefs(once)
    assert LINK_PREFIX + "obsidian:Vault/Ghost.md" in _hrefs(once)  # unresolved stays pending
    assert "Missing.md" in _hrefs(once)  # an unresolvable relative link stays as written
    assert once["content"][-1] == doc["content"][-1]  # a pending media ref is never dropped
    twice, again = _repair(once, import_key="obsidian:Vault/Here.md", import_source="Obsidian")
    # the second run writes nothing: only the counts of what is still left as written recur
    assert twice == once and again == ["relative_unresolved"]
    assert set(again) <= links.COUNT_ONLY_ACTIONS


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
