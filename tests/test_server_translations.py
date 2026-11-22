"""RE-TRANSLATE (b) PR (3a): the store of server translations (`api/services/server_translations.py`).

The coordinator's conditions, each a rail: unique (user_id, def_id, version, engine); never writes
`user_definitions` and never creates a version (AST + a fingerprint of the member's rows); superseded
artifacts are ignored, never deleted; the switch off ignores everything; erased with the member.
"""
from __future__ import annotations

import ast as pyast
import hashlib
import pathlib
import sqlite3

import pytest

from api.services import server_translations as st
from api.services import user_definitions as ud

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE = ROOT / "api" / "services" / "server_translations.py"
USER, DEF_ID = "member-1", "u_0a1b2c3d4e5f"
DOC = {"compute": {"kind": "ast", "ast": {"type": "num", "value": 1}}, "plots": [{"key": "value"}]}


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = tmp_path / "user_definitions.db"
    monkeypatch.setenv("USER_DEFINITIONS_DB_PATH", str(path))
    monkeypatch.setattr(ud, "_DB_PATH", str(path))
    ud._init_db()
    monkeypatch.setenv(st.FLAG_ENV, "on")
    return path


def _row(version=3):
    return {"user_id": USER, "def_id": DEF_ID, "version": version}


def _fingerprint(path) -> str:
    with sqlite3.connect(str(path)) as c:
        rows = c.execute("SELECT * FROM user_definitions ORDER BY id").fetchall()
    return hashlib.sha256(repr(rows).encode()).hexdigest()


def test_one_artifact_per_user_def_version_engine_and_the_first_answer_stands(store):
    assert st.record(USER, DEF_ID, 3, 95, status="accepted", document=DOC, maths_identity="m1") is True
    assert st.record(USER, DEF_ID, 3, 95, status="refused", guard="g", reason="r") is False
    got = st.current_for(_row(), engine=95)
    assert got["status"] == "accepted" and got["document"] == DOC and got["maths_identity"] == "m1"
    with sqlite3.connect(str(store)) as c:
        assert c.execute("SELECT COUNT(*) FROM definition_server_translations").fetchone()[0] == 1
    # mutant S1 (the UNIQUE dropped) -> RED here


def test_a_superseded_artifact_is_ignored_and_never_deleted(store):
    st.record(USER, DEF_ID, 2, 94, status="accepted", document=DOC, maths_identity="old")
    assert st.current_for(_row(version=3), engine=95) is None, "another version: ignored"
    assert st.current_for(_row(version=2), engine=95) is None, "another engine: ignored"
    assert st.current_for(_row(version=2), engine=94)["maths_identity"] == "old"
    st.record(USER, DEF_ID, 3, 95, status="refused", guard="runtime:server-translate-context", reason="needs a chart")
    with sqlite3.connect(str(store)) as c:
        assert c.execute("SELECT COUNT(*) FROM definition_server_translations").fetchone()[0] == 2, \
            "the superseded row is still there"
    assert st.current_for(_row(version=3), engine=95)["status"] == "refused"


def test_the_switch_reads_the_variable_flag_env_names():
    assert st.FLAG_ENV == "PINE_SERVER_RETRANSLATE"


def test_the_switch_off_ignores_every_artifact(store, monkeypatch):
    st.record(USER, DEF_ID, 3, 95, status="accepted", document=DOC, maths_identity="m1")
    monkeypatch.setenv(st.FLAG_ENV, "off")
    assert st.current_for(_row(), engine=95) is None
    monkeypatch.delenv(st.FLAG_ENV)
    assert st.current_for(_row(), engine=95) is None, "unset is off"
    # mutant S2 (the switch not read) -> RED here


def test_it_never_writes_user_definitions_and_never_creates_a_version(store):
    ud.save(USER, DEF_ID, {"schemaVersion": 1, "id": DEF_ID, "version": 1, "meta": {"name": "x"},
                           "compute": {"kind": "ast", "ast": {"type": "num", "value": 1}},
                           "placement": {"target": "pane"}, "plots": [{"key": "value", "style": "line"}],
                           "inputs": []}) if hasattr(ud, "save") else None
    before = _fingerprint(store)
    st.record(USER, DEF_ID, 1, 95, status="accepted", document=DOC, maths_identity="m1")
    st.current_for(_row(version=1), engine=95)
    assert _fingerprint(store) == before
    # ⛔ BY AST: the module's only write is INSERT ... INTO definition_server_translations, and no statement
    # in it names user_definitions or DELETE / UPDATE / REPLACE.
    sql = [n.value for n in pyast.walk(pyast.parse(MODULE.read_text(encoding="utf-8")))
           if isinstance(n, pyast.Constant) and isinstance(n.value, str)
           and n.value.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE", "REPLACE", "SELECT"))]
    joined = " ".join(sql).upper()
    assert "INSERT OR IGNORE INTO DEFINITION_SERVER_TRANSLATIONS" in joined, "the control: the scan sees SQL"
    for banned in ("UPDATE ", "DELETE ", "REPLACE INTO", "INTO USER_DEFINITIONS"):
        assert banned not in joined, f"server_translations issues {banned.strip()}"
    # mutants S3 (a write into user_definitions) and S4 (a DELETE of superseded rows) -> RED here


def test_the_member_erasure_takes_their_translations(store):
    from api.services import user_definitions_erasure as ude
    assert "definition_server_translations" in ude.MEMBER_TABLES
    st.record(USER, DEF_ID, 3, 95, status="accepted", document=DOC, maths_identity="m1")
    st.record("member-2", DEF_ID, 3, 95, status="accepted", document=DOC, maths_identity="m1")
    with sqlite3.connect(str(store)) as c:
        ude.purge_user_rows(USER, c)
        c.commit()
        left = c.execute("SELECT user_id FROM definition_server_translations").fetchall()
    assert left == [("member-2",)]


def test_a_malformed_artifact_is_refused_at_the_door_and_an_unreadable_one_is_none(store):
    with pytest.raises(ValueError):
        st.record(USER, DEF_ID, 3, 95, status="accepted", document=None, maths_identity="m")
    with pytest.raises(ValueError):
        st.record(USER, DEF_ID, 3, 95, status="refused", guard="", reason="r")
    with pytest.raises(ValueError):
        st.record(USER, DEF_ID, 3, 95, status="maybe", guard="g", reason="r")
    assert st.current_for({"user_id": USER}, engine=95) is None, "fail closed"
