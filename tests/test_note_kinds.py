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
    assert len(client) == 8                                            # non-vacuity
    assert client == [dict(k) for k in note_kinds.BUILTIN_NOTE_KINDS]


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
    assert nk.delete_kind("u1", k["id"]) is True
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
