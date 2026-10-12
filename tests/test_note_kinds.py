"""Kinds of note (spec P1.1/P1.2): built-ins are code constants; a member's own kinds are rows.
ONE FACT IN TWO FILES: note_kinds.BUILTIN_NOTE_KINDS <-> app/src/pages/journal-2-0/lib/noteKinds.js,
pinned by importing the JS module through Node (the notebook_schema guard's method)."""
from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

CLIENT = Path("app/src/pages/journal-2-0/lib/noteKinds.js")


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _client_kinds() -> list[dict]:
    node = shutil.which("node")
    assert node, "node is not on PATH; this rail reads the client list the way the bundle does"
    js = (f"import({json.dumps(CLIENT.resolve().as_uri())}).then((m) => "
          "process.stdout.write(JSON.stringify(m.BUILTIN_NOTE_KINDS)))")
    r = subprocess.run([node, "--input-type=module", "-e", js], capture_output=True, timeout=120)
    assert r.returncode == 0, (r.stderr or b"").decode("utf-8", "replace")[:2000]
    return json.loads(r.stdout.decode("utf-8"))


def test_the_client_list_equals_the_server_list():
    from api.services.journal_two import note_kinds
    client = _client_kinds()
    assert client and len(client) == len(note_kinds.BUILTIN_NOTE_KINDS)   # non-vacuity, cannot drift
    assert client == [dict(k) for k in note_kinds.BUILTIN_NOTE_KINDS]


def test_the_client_property_id_equals_the_server_property_id():
    """lib/noteKinds.js is the one client copy of the property id; kindOfNoteOffer.js imports it."""
    from api.services.journal_two import note_kinds
    node = shutil.which("node")
    js = (f"import({json.dumps(CLIENT.resolve().as_uri())}).then((m) => "
          "process.stdout.write(JSON.stringify(m.NOTE_KIND_PROPERTY)))")
    r = subprocess.run([node, "--input-type=module", "-e", js], capture_output=True, timeout=120)
    assert r.returncode == 0, (r.stderr or b"").decode("utf-8", "replace")[:2000]
    assert json.loads(r.stdout.decode("utf-8")) == note_kinds.NOTE_KIND_PROPERTY


def test_no_builtin_id_can_collide_with_a_member_id():
    from api.services.journal_two import note_kinds
    assert not any(k["id"].startswith(note_kinds.MEMBER_KIND_PREFIX) for k in note_kinds.BUILTIN_NOTE_KINDS)


def test_list_create_rename_delete(db_path):
    from api.services.journal_two import note_kinds as nk
    k = nk.create_kind("u1", "  Gap and go ", "bolt")
    assert k["id"].startswith("k_") and k["name"] == "Gap and go" and k["builtin"] is False
    ids = [x["id"] for x in nk.list_kinds("u1")]
    assert ids[:8] == [b["id"] for b in nk.BUILTIN_NOTE_KINDS] and ids[-1] == k["id"]
    assert nk.update_kind("u1", k["id"], name="Gap & go")["name"] == "Gap & go"
    assert nk.list_kinds("u2")[-1]["id"] == "watchlist_note"           # another member sees none of it
    assert nk.delete_kind("u1", k["id"])
    assert nk.get_kind("u1", k["id"]) is None


def test_names_are_unique_against_builtins_and_each_other(db_path):
    from api.services.journal_two import note_kinds as nk
    with pytest.raises(nk.KindValidationError):
        nk.create_kind("u1", "trade PLAN")
    nk.create_kind("u1", "Swing")
    with pytest.raises(nk.KindValidationError):
        nk.create_kind("u1", "swing")
    with pytest.raises(nk.KindValidationError):
        nk.update_kind("u1", "trade_plan", name="Mine")


def test_a_kind_in_use_cannot_be_deleted(db_path):
    from api.services.journal_two import note_kinds as nk
    from api.services.journal_two import notes
    k = nk.create_kind("u1", "Swing")
    notes.create_note("u1", {"title": "x"}, properties={nk.NOTE_KIND_PROPERTY: k["id"]})
    with pytest.raises(nk.KindInUse) as e:
        nk.delete_kind("u1", k["id"])
    assert "1 note" in str(e.value)


def test_mapping_offer_and_apply(db_path):
    from api.services.journal_two import note_kinds as nk
    from api.services.journal_two import notes
    a = notes.create_note("u1", {"title": "a"}, properties={"builtin:research_type": "earnings_play"})
    b = notes.create_note("u1", {"title": "b"}, properties={"builtin:research_type": "sector_note"})
    c = notes.create_note("u1", {"title": "c"}, properties={"builtin:research_type": "long_thesis"})
    offer = nk.mapping_offer("u1")
    assert offer["total"] == 3
    assert {r["researchType"]: r["kindId"] for r in offer["rows"]}["earnings_play"] == "earnings"
    assert {r["researchType"]: r["createsKind"] for r in offer["rows"]}["sector_note"] is True
    done = nk.apply_mapping("u1", exclude_note_ids=[c["id"]])
    assert {d["id"] for d in done} == {a["id"], b["id"]}
    assert notes.get_note("u1", a["id"])["propertiesJson"][nk.NOTE_KIND_PROPERTY] == "earnings"
    sector = [k for k in nk.list_kinds("u1") if k["name"] == nk.SECTOR_KIND_NAME]
    assert len(sector) == 1
    assert notes.get_note("u1", b["id"])["propertiesJson"][nk.NOTE_KIND_PROPERTY] == sector[0]["id"]
    assert nk.mapping_offer("u1")["total"] == 1                         # c was excluded, still offered


# -- round 2 (review I1, M2, M3, M4) --------------------------------------------

NOTE_KIND = "builtin:note_kind"


def test_a_kind_held_by_a_trashed_note_cannot_be_deleted(db_path):
    """I1: Trash is a hold, not a use-free state: restoring the note must never bring back a dead id."""
    from api.services.journal_two import note_kinds as nk
    from api.services.journal_two import notes
    k = nk.create_kind("u1", "Swing")
    n = notes.create_note("u1", {"title": "x"}, properties={nk.NOTE_KIND_PROPERTY: k["id"]})
    assert notes.delete_note("u1", n["id"]) is True
    with pytest.raises(nk.KindInUse) as e:
        nk.delete_kind("u1", k["id"])
    assert "1 note" in str(e.value) and "Trash" in str(e.value)
    assert "Restore or empty" in str(e.value) and "another kind" in str(e.value)
    notes.restore_note("u1", n["id"])
    assert notes.get_note("u1", n["id"])["propertiesJson"][nk.NOTE_KIND_PROPERTY] == k["id"]


def _styles_table():
    """Since the lane A2 merge, init_db creates the REAL j2_journal_styles (journal_styles.py), so this
    is a no-op kept for the tests that call it; `_insert_style` writes the real table's NOT NULL columns."""
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        c.execute("CREATE TABLE IF NOT EXISTS j2_journal_styles (id TEXT PRIMARY KEY, user_id TEXT NOT NULL,"
                  " kind_id TEXT, deleted_at TEXT)")
        c.commit()
    finally:
        c.close()


def _insert_style(sid, user_id, kind_id, deleted_at=None):
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        c.execute("INSERT INTO j2_journal_styles (id, user_id, name, kind_id, deleted_at, created_at, updated_at)"
                  " VALUES (?,?,?,?,?,?,?)",
                  (sid, user_id, f"style {sid}", kind_id, deleted_at, "2026-10-11T00:00:00+00:00",
                   "2026-10-11T00:00:00+00:00"))
        c.commit()
    finally:
        c.close()


def _style_ids():
    from api.services.auth_db import get_connection
    c = get_connection()
    try:
        return sorted(r["id"] for r in c.execute("SELECT id FROM j2_journal_styles"))
    finally:
        c.close()


def test_a_kind_held_by_a_live_style_cannot_be_deleted(db_path):
    from api.services.journal_two import note_kinds as nk
    _styles_table()
    k = nk.create_kind("u1", "Swing")
    _insert_style("s-live", "u1", k["id"])
    with pytest.raises(nk.KindInUse) as e:
        nk.delete_kind("u1", k["id"])
    assert "1 style" in str(e.value)
    assert _style_ids() == ["s-live"]                     # nothing was purged by the refused delete
    assert nk.get_kind("u1", k["id"]) is not None


def test_soft_deleted_styles_are_purged_with_the_kind_and_reported(db_path):
    """Ruling m-a: a soft-deleted style does not block; it is hard-deleted in the same transaction."""
    from api.services.journal_two import note_kinds as nk
    _styles_table()
    k = nk.create_kind("u1", "Swing")
    other = nk.create_kind("u1", "Other")
    _insert_style("s-del-1", "u1", k["id"], "2026-10-01T00:00:00+00:00")
    _insert_style("s-del-2", "u1", k["id"], "2026-10-02T00:00:00+00:00")
    _insert_style("s-other-kind", "u1", other["id"], "2026-10-01T00:00:00+00:00")     # same member, other kind
    _insert_style("s-other-member", "u2", k["id"], "2026-10-01T00:00:00+00:00")       # another member's row
    res = nk.delete_kind("u1", k["id"])
    assert res and res["purgedDeletedStyles"] == 2
    assert nk.get_kind("u1", k["id"]) is None
    assert _style_ids() == ["s-other-kind", "s-other-member"]


def test_a_refused_delete_purges_nothing(db_path):
    """The purge is part of the delete's transaction: a live style (or a note) holding the kind keeps
    the soft-deleted rows too."""
    from api.services.journal_two import note_kinds as nk
    from api.services.journal_two import notes
    _styles_table()
    k = nk.create_kind("u1", "Swing")
    _insert_style("s-del", "u1", k["id"], "2026-10-01T00:00:00+00:00")
    notes.create_note("u1", {"title": "x"}, properties={nk.NOTE_KIND_PROPERTY: k["id"]})
    with pytest.raises(nk.KindInUse):
        nk.delete_kind("u1", k["id"])
    assert _style_ids() == ["s-del"]


def test_a_plain_delete_reports_zero_purged(db_path):
    from api.services.journal_two import note_kinds as nk
    k = nk.create_kind("u1", "Swing")
    res = nk.delete_kind("u1", k["id"])
    assert res == {"purgedDeletedStyles": 0}
    assert nk.delete_kind("u1", k["id"]) is False         # CONTROL: gone now


def test_another_members_use_does_not_block_a_delete(db_path):
    from api.services.journal_two import note_kinds as nk
    from api.services.journal_two import notes
    k = nk.create_kind("u1", "Swing")
    notes.create_note("u2", {"title": "x"}, properties={"builtin:thesis_status": "active"})
    assert nk.delete_kind("u1", k["id"])


def test_delete_checks_and_deletes_under_the_write_lock(db_path, monkeypatch):
    """M2: the in-use read happens inside BEGIN IMMEDIATE, so a write cannot slip between it and the DELETE."""
    from api.services.journal_two import note_kinds as nk
    k = nk.create_kind("u1", "Swing")
    seen = []
    real = nk._uses
    monkeypatch.setattr(nk, "_uses", lambda u, kid, conn: (seen.append(conn.in_transaction), real(u, kid, conn))[1])
    assert nk.delete_kind("u1", k["id"])
    assert seen == [True]


def test_a_note_with_unreadable_properties_does_not_break_delete(db_path):
    from api.services.auth_db import get_connection
    from api.services.journal_two import note_kinds as nk
    from api.services.journal_two import notes
    k = nk.create_kind("u1", "Swing")
    n = notes.create_note("u1", {"title": "x"})
    c = get_connection()
    try:
        c.execute("UPDATE j2_notes SET properties_json = 'not json {' WHERE id = ?", (n["id"],))
        c.commit()
    finally:
        c.close()
    assert nk.delete_kind("u1", k["id"])


def test_a_lost_duplicate_name_race_is_a_validation_error_not_a_500(db_path, monkeypatch):
    """M3: two creates of one name both pass the pre-check; the unique index refuses the second."""
    from api.services.journal_two import note_kinds as nk
    nk.create_kind("u1", "Sector note")
    monkeypatch.setattr(nk, "_taken", lambda *a, **kw: False)       # the racer's stale pre-check
    with pytest.raises(nk.KindValidationError):
        nk.create_kind("u1", "sector NOTE")


def test_apply_mapping_skips_locked_notes_and_says_so(db_path):
    """M4: a locked note is never written to; it is reported as skipped."""
    from api.services.journal_two import note_kinds as nk
    from api.services.journal_two import notes
    a = notes.create_note("u1", {"title": "a"}, properties={"builtin:research_type": "earnings_play"})
    b = notes.create_note("u1", {"title": "b"}, properties={"builtin:research_type": "earnings_play"})
    notes.update_note("u1", b["id"], {"locked": True})
    skipped: list = []
    done = nk.apply_mapping("u1", skipped_out=skipped)
    assert [d["id"] for d in done] == [a["id"]]
    assert [s["id"] for s in skipped] == [b["id"]] and skipped[0]["reason"] == "locked"
    assert NOTE_KIND not in notes.get_note("u1", b["id"])["propertiesJson"]
