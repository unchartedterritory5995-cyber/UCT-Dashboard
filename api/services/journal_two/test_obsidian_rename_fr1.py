"""L2 fix round 1 (review of 9af3fae84a): the rename re-key's holes, each a failing scenario first.

1. Edit, then rename, with no sync between. Staging paired the new path with the old path's
   latest STAGED body, the note was re-keyed, the old path's remote-index row was deleted, and
   `import_confirm` then CREATED an untracked ghost at the old key holding the Obsidian edit; on a
   member-edited note the stamped revision also hid the real conflict. Now a rename applies only
   when the note was last imported from the old path's current staged state; otherwise it falls
   back (the old note takes the edit or its conflict, stays tracked, and is tagged after two
   strikes). When a rename DOES apply and the old path is in the same chunk, that RemoteNote is
   dropped, so nothing is created at the vacated key.
2. Trivial bodies: an empty note deleted plus a new empty one created were paired, moving a
   member's thesis onto an unrelated new note. Bodies under RENAME_MIN_BODY_CHARS non-whitespace
   characters, or shared by another path of the manifest (a template), are never paired.
4. A member-trashed old note is re-keyed too, so the new key routes into the kept-in-trash path
   instead of a live copy coming back.
5. The old note's conflict sibling `<old key>#remote` moves with it.
Plus: an edited note's revision is no longer stamped by the re-key (the conflict gate decides).
"""

from __future__ import annotations

import json

from api.services import auth_db
from api.services.journal_two.note_connectors import engine as sync_engine
from api.services.journal_two.note_connectors import obsidian_staging
from api.services.journal_two.test_obsidian_rename import (  # noqa: F401 -- fixture
    BODY, USER, _connect, _key, _live_rows, _push, _renames, _sync, client, notes_svc,
)

EDITED = BODY + "\n\nOBSIDIAN EDIT LINE."
UCT_DOC = {"type": "doc", "content": [
    {"type": "paragraph", "content": [{"type": "text", "text": "My own UCT words."}]}]}


def _index(src: str) -> set[str]:
    conn = auth_db.get_connection()
    try:
        return {r[0] for r in conn.execute(
            "SELECT remote_id FROM j2_note_remote_index WHERE source_id = ?", (src,))}
    finally:
        conn.close()


def _all_rows() -> dict[str, dict]:
    conn = auth_db.get_connection()
    try:
        return {r["import_key"]: dict(r) for r in conn.execute(
            "SELECT id, import_key, body_json, tags, deleted_at FROM j2_notes WHERE user_id = ?",
            (USER,)).fetchall()}
    finally:
        conn.close()


async def _two_full_passes(src: str, monkeypatch) -> None:
    monkeypatch.setattr(sync_engine, "MEMBER_FULL_PASS_MIN_INTERVAL_S", 0)
    for _ in range(2):
        await _sync(src, full=True)


def _assert_no_untracked_ghost(src: str) -> None:
    """Every live note of this vault is either tracked by a remote-index row or a conflict
    sibling of one that is: nothing sits at a key delete detection can never see."""
    tracked = {f"obsidian:vault-rename/{rid}" for rid in _index(src)}
    for key in _live_rows():
        assert key in tracked or key.endswith("#remote") and key[:-len("#remote")] in tracked, key


# ── 1. edit, then rename, no sync between ──────────────────────────────────────────────────────

async def test_edit_then_rename_of_an_unedited_note_keeps_the_edit_and_leaves_no_ghost(client, monkeypatch):
    token, src = _connect(client)
    _push(client, token, {"Probe.md": BODY}, ["Probe.md"])
    await _sync(src)
    note_id = _live_rows()[_key("Probe.md")]["id"]
    _push(client, token, {"Probe.md": EDITED}, ["Probe.md"], updated_at="2026-11-02T00:00:00Z")
    _push(client, token, {"Renamed.md": EDITED}, ["Renamed.md"], updated_at="2026-11-02T00:00:00Z")
    await _sync(src)
    rows = _live_rows()
    # Falls back: the rename did not match what UCT last imported for Probe.md.
    assert rows[_key("Probe.md")]["id"] == note_id
    assert "OBSIDIAN EDIT LINE" in rows[_key("Probe.md")]["body_json"]      # the edit landed
    assert "OBSIDIAN EDIT LINE" in rows[_key("Renamed.md")]["body_json"]
    assert len([k for k in rows if not k.endswith("#remote")]) == 2
    _assert_no_untracked_ghost(src)
    await _two_full_passes(src, monkeypatch)
    rows = _live_rows()
    assert "source-deleted" in json.loads(rows[_key("Probe.md")]["tags"])  # tracked, then tagged
    assert "source-deleted" not in json.loads(rows[_key("Renamed.md")]["tags"])


async def test_edit_then_rename_of_a_member_edited_note_raises_the_conflict(client, monkeypatch):
    token, src = _connect(client)
    _push(client, token, {"Probe.md": BODY}, ["Probe.md"])
    await _sync(src)
    note_id = _live_rows()[_key("Probe.md")]["id"]
    notes_svc.update_note(USER, note_id, {"bodyJson": UCT_DOC})
    _push(client, token, {"Probe.md": EDITED}, ["Probe.md"], updated_at="2026-11-02T00:00:00Z")
    _push(client, token, {"Renamed.md": EDITED}, ["Renamed.md"], updated_at="2026-11-02T00:00:00Z")
    r = await _sync(src)
    rows = _live_rows()
    assert rows[_key("Probe.md")]["id"] == note_id
    assert "My own UCT words." in rows[_key("Probe.md")]["body_json"]       # member words kept
    assert r["conflicts"] == 1                                               # the real conflict
    assert "OBSIDIAN EDIT LINE" in rows[_key("Probe.md") + "#remote"]["body_json"]
    _assert_no_untracked_ghost(src)
    await _two_full_passes(src, monkeypatch)
    assert "source-deleted" in json.loads(_live_rows()[_key("Probe.md")]["tags"])


async def test_an_applied_rename_drops_the_old_paths_note_from_the_chunk(client):
    """The old path listed again in the same pass (here: its staged row re-received with the
    same content) must not be confirmed once its note moved: that would create a note at the
    vacated key that nothing tracks."""
    token, src = _connect(client)
    _push(client, token, {"Probe.md": BODY}, ["Probe.md"])
    await _sync(src)
    note_id = _live_rows()[_key("Probe.md")]["id"]
    _push(client, token, {"Renamed.md": BODY}, ["Renamed.md"])
    conn = auth_db.get_connection()
    try:
        conn.execute("UPDATE j2_obsidian_staging SET received_at = '2099-01-01T00:00:00.000000+00:00'"
                     " WHERE vault_path = 'Probe.md'")
        conn.commit()
    finally:
        conn.close()
    await _sync(src)
    rows = _live_rows()
    assert list(rows) == [_key("Renamed.md")]
    assert rows[_key("Renamed.md")]["id"] == note_id
    _assert_no_untracked_ghost(src)


async def test_a_rename_that_moved_the_mtime_of_a_member_edited_note_is_a_conflict(client):
    """The re-key no longer stamps the revision: a moved mtime is a remote change to the conflict
    gate, so the member gets a "(synced copy)" rather than a silent skip."""
    token, src = _connect(client)
    _push(client, token, {"Probe.md": BODY}, ["Probe.md"])
    await _sync(src)
    note_id = _live_rows()[_key("Probe.md")]["id"]
    notes_svc.update_note(USER, note_id, {"bodyJson": UCT_DOC})
    _push(client, token, {"Renamed.md": BODY}, ["Renamed.md"], updated_at="2026-11-02T00:00:00Z")
    r = await _sync(src)
    rows = _live_rows()
    assert rows[_key("Renamed.md")]["id"] == note_id                        # still re-keyed
    assert "My own UCT words." in rows[_key("Renamed.md")]["body_json"]
    assert r["conflicts"] == 1
    assert _key("Renamed.md") + "#remote" in rows


# ── 2. trivial and template bodies ────────────────────────────────────────────────────────────

async def test_an_empty_note_deleted_and_a_new_empty_note_are_not_paired(client, monkeypatch):
    token, src = _connect(client)
    _push(client, token, {"Trade idea.md": "", "Keep.md": "x"}, ["Trade idea.md", "Keep.md"])
    await _sync(src)
    old_id = _live_rows()[_key("Trade idea.md")]["id"]
    notes_svc.update_note(USER, old_id, {"bodyJson": UCT_DOC})
    _push(client, token, {"Untitled.md": ""}, ["Untitled.md", "Keep.md"])
    assert _renames() == []
    await _sync(src)
    rows = _live_rows()
    assert rows[_key("Trade idea.md")]["id"] == old_id                      # not moved
    assert rows[_key("Untitled.md")]["id"] != old_id
    await _two_full_passes(src, monkeypatch)
    assert "source-deleted" in json.loads(_live_rows()[_key("Trade idea.md")]["tags"])


async def test_a_short_body_is_not_paired(client):
    short = "Buy NVDA on the pullback."                                     # 21 non-whitespace
    assert len("".join(short.split())) < obsidian_staging.RENAME_MIN_BODY_CHARS
    token, src = _connect(client)
    _push(client, token, {"a.md": short}, ["a.md"])
    await _sync(src)
    _push(client, token, {"b.md": short}, ["b.md"])
    assert _renames() == []


async def test_template_identical_notes_are_not_paired(client):
    template = "## Pre-market plan\n\n- Bias:\n- Levels to watch:\n- Risk for the day:\n"
    assert len("".join(template.split())) >= obsidian_staging.RENAME_MIN_BODY_CHARS
    token, src = _connect(client)
    _push(client, token, {"Mon.md": template, "Tue.md": template}, ["Mon.md", "Tue.md"])
    await _sync(src)
    mon_id = _live_rows()[_key("Mon.md")]["id"]
    # Mon.md deleted and Wed.md made from the same template, Tue.md still there.
    _push(client, token, {"Wed.md": template}, ["Tue.md", "Wed.md"])
    assert _renames() == []
    await _sync(src)
    assert _live_rows()[_key("Mon.md")]["id"] == mon_id


def test_the_threshold_is_32():
    assert obsidian_staging.RENAME_MIN_BODY_CHARS == 32


# ── 4. a trashed old note, 5. its conflict sibling ────────────────────────────────────────────

async def test_a_member_trashed_note_is_rekeyed_into_the_trash_not_resurrected(client):
    token, src = _connect(client)
    _push(client, token, {"Probe.md": BODY}, ["Probe.md"])
    await _sync(src)
    note_id = _live_rows()[_key("Probe.md")]["id"]
    notes_svc.delete_note(USER, note_id)
    _push(client, token, {"Renamed.md": BODY}, ["Renamed.md"])
    await _sync(src)
    assert _live_rows() == {}                                               # no live copy
    rows = _all_rows()
    assert rows[_key("Renamed.md")]["id"] == note_id
    assert rows[_key("Renamed.md")]["deleted_at"] is not None


async def test_the_conflict_sibling_moves_with_the_note(client):
    token, src = _connect(client)
    _push(client, token, {"Probe.md": BODY}, ["Probe.md"])
    await _sync(src)
    note_id = _live_rows()[_key("Probe.md")]["id"]
    notes_svc.update_note(USER, note_id, {"bodyJson": UCT_DOC})
    _push(client, token, {"Probe.md": EDITED}, ["Probe.md"], updated_at="2026-11-02T00:00:00Z")
    await _sync(src)                                                        # conflict -> sibling
    sibling_id = _live_rows()[_key("Probe.md") + "#remote"]["id"]
    _push(client, token, {"Renamed.md": EDITED}, ["Renamed.md"], updated_at="2026-11-02T00:00:00Z")
    r = await _sync(src)
    rows = _live_rows()
    assert set(rows) == {_key("Renamed.md"), _key("Renamed.md") + "#remote"}
    assert rows[_key("Renamed.md")]["id"] == note_id
    assert rows[_key("Renamed.md") + "#remote"]["id"] == sibling_id
    assert r["conflicts"] == 0


# ── L1 through the real Obsidian provider ─────────────────────────────────────────────────────

async def test_a_three_note_obsidian_vault_confirms_a_rename_plus_deletes(client, monkeypatch):
    """The probe's shape on the real provider ("1 of 3 previously-known items (<50%)"): a.md
    renamed to b.md, c.md and d.md deleted. Obsidian's listing is authoritative, so the <50%
    guard does not refuse it: the moved note stays, the deleted ones are tagged after 2 strikes."""
    token, src = _connect(client)
    c_body = "A different note about risk sizing and the stop placement."
    d_body = "A third note: the weekly review of what worked and what did not."
    _push(client, token, {"a.md": BODY, "c.md": c_body, "d.md": d_body}, ["a.md", "c.md", "d.md"])
    await _sync(src)
    a_id = _live_rows()[_key("a.md")]["id"]
    _push(client, token, {"b.md": BODY}, ["b.md"])
    await _sync(src)
    await _two_full_passes(src, monkeypatch)
    rows = _live_rows()
    assert rows[_key("b.md")]["id"] == a_id
    assert "source-deleted" not in json.loads(rows[_key("b.md")]["tags"])
    assert "source-deleted" in json.loads(rows[_key("c.md")]["tags"])
    assert "source-deleted" in json.loads(rows[_key("d.md")]["tags"])
