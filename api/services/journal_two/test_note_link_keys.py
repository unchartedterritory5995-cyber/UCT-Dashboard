"""Connector fidelity Plan A Task 4 -- link keys and the link heal pass (spec §5.1).

`link_keys.resolve_link_keys` answers which note a placeholder key names (exact import
keys, and Evernote's title keys); `link_keys.heal_pending_links` rewrites still-pending
`import-link://` marks once their target exists, through `engine._apply_resolved_body`
(timestamp-neutral, optimistic-locked, projected). `POST /api/j2/notes/import/heal-links`
is the member's door to it (Plan B's file importer calls it).

Real schema (`ensure_schema` on a temp auth.db), the real router.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user
from api.services import auth_db
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import link_keys


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    return tmp_path


def _para(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def _link(key, text):
    return {"type": "paragraph", "content": [{
        "type": "text", "text": text,
        "marks": [{"type": "link", "attrs": {"href": f"import-link://{key}"}}]}]}


def _import(user, source, key, title, *content, updated_at="2026-08-01T00:00:00+00:00"):
    out = notes_svc.import_confirm(user, {"source": source, "destFolderId": None, "notes": [{
        "importKey": key, "title": title,
        "bodyJson": {"type": "doc", "content": list(content) or [_para(title)]},
        "tags": [], "folderPath": [], "updatedAt": updated_at}]})
    return (out["created"] + out["updated"])[0]["id"]


def _row(note_id):
    conn = auth_db.get_connection()
    try:
        return dict(conn.execute("SELECT * FROM j2_notes WHERE id = ?", (note_id,)).fetchone())
    finally:
        conn.close()


def _resolve(user, keys):
    conn = auth_db.get_connection()
    try:
        return link_keys.resolve_link_keys(conn, user, keys)
    finally:
        conn.close()


# ── resolve_link_keys ────────────────────────────────────────────────────────

def test_exact_keys_resolve_through_import_check(db):
    target = _import("u1", "fake", "fake:g/p2", "Target")
    assert _resolve("u1", ["fake:g/p2", "fake:g/missing"]) == {"fake:g/p2": target}
    assert _resolve("u2", ["fake:g/p2"]) == {}  # another member's note never answers


def test_evernote_title_key_resolves_only_a_unique_match(db):
    # Controller ruling 1: the client file importer stores 'Evernote', a live connector
    # 'evernote'; both count. Title match is trim + whitespace-collapse on both sides.
    _import("u1", "Evernote", "en:1", "Plan")
    _import("u1", "evernote", "en:2", "Plan")
    plan_b = _import("u1", "Evernote", "en:3", "  Plan   B ")
    lower = _import("u1", "evernote", "en:4", "Lower Case Source")
    trashed = _import("u1", "Evernote", "en:5", "Trashed")
    notes_svc.delete_note("u1", trashed)
    _import("u1", "notion", "n:1", "Not Evernote")
    _import("u2", "Evernote", "en:9", "Other Member")

    got = _resolve("u1", [
        "evernote-title:Plan",            # two matches -> unresolved
        "evernote-title:Plan B",          # one match after normalising both sides
        "evernote-title: Lower  Case Source ",
        "evernote-title:Trashed",         # trashed never matches
        "evernote-title:Not Evernote",    # another source never matches
        "evernote-title:Other Member",    # another member never matches
        "mystery-kind:Plan",              # unknown kinds resolve to nothing
    ])
    assert got == {"evernote-title:Plan B": plan_b,
                   "evernote-title: Lower  Case Source ": lower}


def test_obsidian_name_key_resolves_with_the_conversion_rules(db):
    """Plan A Task 13 (O-4): `name:obsidian:<vault>/<target>` resolves against that vault's
    imported notes with the SAME `_resolve_target` the provider converts with: basename,
    path-qualified, `.md` optional, case-insensitive, shortest of duplicate names."""
    deep = _import("u1", "obsidian", "obsidian:v1/Archive/Old/Plan.md", "Plan old")
    plan = _import("u1", "obsidian", "obsidian:v1/Notes/Plan.md", "Plan")
    vcp = _import("u1", "obsidian", "obsidian:v1/Setups/VCP Base.md", "VCP")
    _import("u1", "obsidian", "obsidian:v2/Only There.md", "Other vault")
    _import("u1", "obsidian", "obsidian:v1x/Prefix Trap.md", "Prefix trap")  # v1x is not v1
    gone = _import("u1", "obsidian", "obsidian:v1/Trashed.md", "Trashed")
    notes_svc.delete_note("u1", gone)
    _import("u2", "obsidian", "obsidian:v1/Theirs.md", "Another member")

    got = _resolve("u1", [
        "name:obsidian:v1/plan",              # two Plans -> the shorter path
        "name:obsidian:v1/archive/old/plan",  # path-qualified
        "name:obsidian:v1/vcp base.md",       # extension written
        "name:obsidian:v1/setups/vcp base",
        "name:obsidian:v1/only there",        # another vault's note
        "name:obsidian:v1/prefix trap",
        "name:obsidian:v1/trashed",
        "name:obsidian:v1/theirs",            # another member's note
        "name:obsidian:v1/",                  # no target
        "name:obsidian:no-slash",
    ])
    assert got == {
        "name:obsidian:v1/plan": plan,
        "name:obsidian:v1/archive/old/plan": deep,
        "name:obsidian:v1/vcp base.md": vcp,
        "name:obsidian:v1/setups/vcp base": vcp,
    }


def _pending_keys_from(body, self_path):
    """The pending keys the REAL Obsidian conversion writes for `body` in an empty vault."""
    from api.services.journal_two.note_connectors.providers.obsidian import (
        ObsidianProvider, _build_basename_map,
    )
    paths = [self_path]
    provider = ObsidianProvider(user_id="u1", vault_id="v1")
    return provider._convert_row(self_path, body, paths, _build_basename_map(paths))["links"]


def test_a_healed_wikilink_prefers_the_linking_notes_folder_like_conversion_does(db):
    """Fix round 1, M-1: conversion resolves a duplicate name to the linking note's folder
    first; the heal must too, not the shortest path."""
    [key] = _pending_keys_from("[[Plan]]", "Notes/Sub/Src.md")
    _import("u1", "obsidian", "obsidian:v1/B/Plan.md", "Shorter")
    beside = _import("u1", "obsidian", "obsidian:v1/Notes/Sub/Plan.md", "Beside")
    assert _resolve("u1", [key]) == {key: beside}


def test_a_healed_relative_link_uses_the_same_rooted_and_name_fallbacks(db):
    """M-1: `[x](Other.md)` in `Notes/Src.md` resolves beside the note, then from the vault
    root, then by name. A pending one heals by that SAME rule."""
    [rooted_key] = _pending_keys_from("[x](Other.md)", "Notes/Src.md")
    [named_key] = _pending_keys_from("[y](Far.md)", "Notes/Src.md")
    root_other = _import("u1", "obsidian", "obsidian:v1/Other.md", "Other")
    far = _import("u1", "obsidian", "obsidian:v1/Archive/Deep/Far.md", "Far")
    assert _resolve("u1", [rooted_key, named_key]) == {rooted_key: root_other, named_key: far}
    # And beside the note wins over the root, as it does at conversion time.
    beside = _import("u1", "obsidian", "obsidian:v1/Notes/Other.md", "Other beside")
    assert _resolve("u1", [rooted_key]) == {rooted_key: beside}


def test_resolving_many_name_keys_over_a_large_vault_is_not_keys_times_paths(db, monkeypatch):
    """Fix round 1, I-2: the engine's final link pass hands every touched note's links to
    `resolve_link_keys`, uncapped. 2,000 keys over a 20,000-note vault resolve with ONE
    index build and in well under a second (a per-key scan of the vault took ~40M path
    comparisons)."""
    import time
    from api.services.journal_two.note_connectors.providers import obsidian as obs

    conn = auth_db.get_connection()
    try:
        conn.executemany(
            "INSERT INTO j2_notes (id, user_id, import_key, created_at, updated_at)"
            " VALUES (?, 'u1', ?, '2026-08-01', '2026-08-01')",
            [(f"n{i}", f"obsidian:v1/F{i % 40}/Sub{i % 7}/Note {i}.md") for i in range(20000)])
        conn.commit()
    finally:
        conn.close()
    keys = []
    for i in range(500):
        j = i * 37
        keys += [f"name:obsidian:v1/note {j}",                            # bare name
                 f"name:obsidian:v1/sub{j % 7}/note {j}|f{i % 40}",        # path-qualified
                 f"name:obsidian:v1/nowhere/missing {i}",                  # unresolvable
                 f"name:obsidian:v1/missing {i}.md|f1|rel"]                # relative, unresolvable
    builds: list[int] = []
    real = obs._build_basename_map
    monkeypatch.setattr(obs, "_build_basename_map", lambda p: builds.append(1) or real(p))

    started = time.perf_counter()
    got = _resolve("u1", keys)
    elapsed = time.perf_counter() - started

    assert len(got) == 1000 and got["name:obsidian:v1/note 37"] == "n37"
    assert builds == [1]
    assert elapsed < 1.0, f"{elapsed:.2f}s for 2,000 keys over 20,000 paths"


# ── heal_pending_links ───────────────────────────────────────────────────────

def test_heal_resolves_a_title_link_timestamp_neutrally_and_projects_it(db):
    src = _import("u1", "Evernote", "en:a", "Source", _link("evernote-title:Target", "Target"))
    assert _row(src)["import_links_pending"] == 1
    before = _row(src)["updated_at"]
    target = _import("u1", "Evernote", "en:b", "Target")

    out = link_keys.heal_pending_links("u1")

    assert (out["healed"], out["checked"], out["unresolved"]) == (1, 1, [])
    row = _row(src)
    assert row["updated_at"] == before
    assert row["import_links_pending"] == 0
    assert f"/journal?j2tab=notebook&note={target}" in row["body_json"]
    conn = auth_db.get_connection()
    try:
        links = [r[0] for r in conn.execute(
            "SELECT target_note_id FROM j2_note_links WHERE note_id = ?", (src,))]
    finally:
        conn.close()
    assert links == [target]


def test_heal_keeps_a_pending_media_placeholder(db):
    src = _import("u1", "fake", "fake:g/a", "Source", _link("fake:g/b", "B"),
                  {"type": "image", "attrs": {"src": "import-ref://img-1"}})
    _import("u1", "fake", "fake:g/b", "B")
    assert link_keys.heal_pending_links("u1")["healed"] == 1
    body = _row(src)["body_json"]
    assert "import-ref://img-1" in body  # never dropped: that is the media path's job
    assert _row(src)["import_media_pending"] == 1


def test_heal_is_bounded_by_limit(db):
    for i in range(3):
        _import("u1", "fake", f"fake:g/{i}", f"N{i}", _link("fake:g/absent", "absent"))
    out = link_keys.heal_pending_links("u1", limit=2)
    assert out["checked"] == 2
    assert out["healed"] == 0


def test_a_named_member_edited_note_is_never_rewritten_and_lists_its_links(db):
    src = _import("u1", "fake", "fake:g/a", "Source", _link("fake:g/b", "Bee"))
    notes_svc.update_note("u1", src, {"title": "member edit"})
    _import("u1", "fake", "fake:g/b", "B")
    before = _row(src)

    out = link_keys.heal_pending_links("u1", note_ids=[src])

    assert out["healed"] == 0
    assert out["unresolved"] == [{"noteId": src, "key": "fake:g/b", "text": "Bee"}]
    after = _row(src)
    assert (after["body_json"], after["updated_at"]) == (before["body_json"], before["updated_at"])


def test_the_sweep_budget_is_not_spent_on_member_edited_notes(db):
    # An edited note can never be healed, so it must not occupy a sweep slot: with
    # limit=1 and the edited note first, the healable one still heals.
    edited = _import("u1", "fake", "fake:g/e", "Edited", _link("fake:g/t", "T"))
    notes_svc.update_note("u1", edited, {"title": "member edit"})
    healable = _import("u1", "fake", "fake:g/h", "Healable", _link("fake:g/t", "T"))
    _import("u1", "fake", "fake:g/t", "T")

    out = link_keys.heal_pending_links("u1", limit=1)

    assert (out["checked"], out["healed"]) == (1, 1)
    assert "import-link://" not in _row(healable)["body_json"]


def test_never_resolvable_notes_cannot_starve_a_healable_one(db):
    # Fix round 1 (I1). More never-resolvable pending notes than the limit, all OLDER
    # (lower rowids) than the healable one, so a sweep in index order returns the same
    # never-resolvable notes every time and the healable note starves.
    for i in range(4):
        _import("u1", "fake", f"fake:g/never{i}", f"Never{i}", _link("fake:g/absent", "absent"))
    healable = _import("u1", "fake", "fake:g/h", "Healable", _link("fake:g/t", "T"))
    _import("u1", "fake", "fake:g/t", "T")

    for _ in range(50):
        if link_keys.heal_pending_links("u1", limit=3)["healed"]:
            break
    assert "import-link://" not in _row(healable)["body_json"]


# ── POST /api/j2/notes/import/heal-links ─────────────────────────────────────

@pytest.fixture
def client(db):
    from api.routers import journal_two
    app = FastAPI()
    app.include_router(journal_two.router)
    who = {"id": "u1"}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    c = TestClient(app)
    c.who = who
    return c


def test_heal_links_route_heals_named_notes_and_lists_the_rest(client):
    a = _import("u1", "Evernote", "en:a", "A", _link("evernote-title:Here", "Here"))
    b = _import("u1", "Evernote", "en:b", "B", _link("evernote-title:Gone", "Gone"))
    _import("u1", "evernote", "en:h", "Here")

    r = client.post("/api/j2/notes/import/heal-links", json={"noteIds": [a, b]})

    assert r.status_code == 200
    assert r.json() == {"healed": 1,
                        "unresolved": [{"noteId": b, "key": "evernote-title:Gone", "text": "Gone"}]}


def test_heal_links_route_also_sweeps_the_members_pending_notes(client):
    swept = _import("u1", "fake", "fake:g/s", "Swept", _link("fake:g/t", "T"))
    _import("u1", "fake", "fake:g/t", "T")
    r = client.post("/api/j2/notes/import/heal-links", json={"noteIds": []})
    assert r.json() == {"healed": 1, "unresolved": []}
    assert "import-link://" not in _row(swept)["body_json"]


def test_heal_links_route_is_member_scoped(client):
    theirs = _import("u2", "fake", "fake:g/a", "Theirs", _link("fake:g/b", "B"))
    _import("u2", "fake", "fake:g/b", "B")
    _import("u1", "fake", "fake:g/b", "Mine")  # the caller CAN resolve the key: scope must stop it
    before = _row(theirs)

    r = client.post("/api/j2/notes/import/heal-links", json={"noteIds": [theirs]})

    assert r.json() == {"healed": 0, "unresolved": []}
    assert _row(theirs)["body_json"] == before["body_json"]  # neither named nor swept


def test_the_sweep_never_reads_another_members_notes(db):
    _import("u2", "fake", "fake:g/a", "Theirs", _link("fake:g/b", "B"))
    _import("u1", "fake", "fake:g/b", "Mine")
    assert link_keys.heal_pending_links("u1")["checked"] == 0


def test_heal_links_route_refuses_a_bad_body(client):
    assert client.post("/api/j2/notes/import/heal-links",
                       json={"noteIds": [f"n{i}" for i in range(501)]}).status_code == 400
    assert client.post("/api/j2/notes/import/heal-links", json={"noteIds": "x"}).status_code == 400
    assert client.post("/api/j2/notes/import/heal-links", json={"noteIds": [1]}).status_code == 400
