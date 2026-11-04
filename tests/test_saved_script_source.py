"""SAVED-SCRIPT AUTO-UPGRADE — the store keeps a script document's Pine BESIDE it.

The browser re-translates a saved script when its engine is newer than the
document's stamp (`app/src/components/chart/builder/memberPane/savedScriptUpgrade.js`)
and writes the new translation back through the ordinary revision-guarded PUT.
None of that works unless the store:

  * persists the script a script door sent (`pine_source`), in its OWN column,
    size-capped, and never logs it;
  * never carries a script onto a version whose save did not send one (a hand
    edit must never be re-translated away);
  * serves the script ONLY to a browser whose engine is newer than the stamp
    (`GET ?engine=N`) or to the owner who asks for it (`GET /{id}?source=1`);
  * keeps the script through a fork and a tombstone, and NEVER copies it to a
    share recipient (privacy-safe default);
  * and makes the written-back document THE document every server lane reads.
"""

from __future__ import annotations

import json
import logging
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import alert_rev_migration as rev
from api.services import indicator_alert_service as ias
from api.services import user_definitions as svc

SCRIPT = (
    "//@version=5\n"
    "indicator('Secret Sauce 7f3a', overlay=true)\n"
    "plot(ta.sma(close, 20))\n"
)


def _ast_sma(period: int) -> dict:
    return {"type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"},
        {"type": "num", "value": period},
    ]}


def defn(period: int = 20, *, def_id: str = "u_000000000001", engine=None,
         name: str = "My Script") -> dict:
    meta = {"name": name, "shortName": "MS", "repaint": "non-repainting",
            "recurrenceOrigin": "pine"}
    if engine is not None:
        meta["engineVersion"] = engine
    return {
        "schemaVersion": 1, "id": def_id, "version": 1, "meta": meta,
        "compute": {"kind": "ast", "ast": _ast_sma(period)},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    return tmp_path


def _raw_rows(tmp_path, def_id):
    c = sqlite3.connect(str(tmp_path / "user_definitions.db"))
    c.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in c.execute(
            "SELECT version, rev, pine_source, deleted_at FROM user_definitions "
            "WHERE def_id=? ORDER BY version", (def_id,))]
    finally:
        c.close()


# ─── the column ──────────────────────────────────────────────────────────────

def test_an_OLD_database_gains_the_column_and_its_rows_read_as_sourceless(tmp_path, monkeypatch):
    """A store created before the column: `_migrate` adds it (idempotently), every
    existing row reads `has_pine_source: False`, and nothing is rewritten."""
    path = tmp_path / "old.db"
    c = sqlite3.connect(str(path))
    c.executescript(svc._SCHEMA.replace("pine_source", "pine_source_never"))
    c.execute("ALTER TABLE user_definitions ADD COLUMN requirements TEXT NOT NULL DEFAULT '[]'")
    c.execute(
        "INSERT INTO user_definitions (user_id, def_id, version, rev, ast_hash, definition, "
        "repaint, deleted_at, created_at) VALUES ('u1','u_000000000001',1,1,'h',?,'{}',NULL,1)",
        (json.dumps(defn()),))
    c.commit()
    have = {r[1] for r in c.execute("PRAGMA table_info(user_definitions)")}
    assert "pine_source" not in have, "the fixture must start WITHOUT the column"
    c.close()
    monkeypatch.setattr(svc, "_DB_PATH", str(path))
    svc._init_db()
    svc._init_db()  # twice: a deploy re-runs it on every boot
    rows = svc.list_for_user("u1", source_below=99)
    assert len(rows) == 1
    assert rows[0]["has_pine_source"] is False
    assert "pine_source" not in rows[0]


def test_a_script_save_STORES_the_source_and_the_ordinary_reads_never_serve_it(store):
    out = svc.save("u1", "u_000000000001", defn(engine=1), pine_source=SCRIPT)
    assert out["pine_source_stored"] is True
    assert _raw_rows(store, "u_000000000001")[0]["pine_source"] == SCRIPT
    # Every ordinary reader (the sweep, alerts, the record) arrives via `_row_to_dict`
    # and sees WHETHER, never WHAT.
    for row in (svc.get("u1", "u_000000000001"), svc.list_for_user("u1")[0],
                svc.live_definitions()[0], svc.history("u1", "u_000000000001")[0]):
        assert row["has_pine_source"] is True
        assert "pine_source" not in row
    # The owner's explicit read is the one door that serves it.
    assert svc.get("u1", "u_000000000001", with_source=True)["pine_source"] == SCRIPT


def test_the_list_serves_the_source_ONLY_to_an_engine_newer_than_the_stamp(store):
    svc.save("u1", "u_000000000001", defn(engine=1, def_id="u_000000000001"), pine_source=SCRIPT)
    svc.save("u1", "u_000000000002", defn(def_id="u_000000000002"), pine_source=SCRIPT)      # unstamped
    svc.save("u1", "u_000000000003", defn(engine=1, def_id="u_000000000003"))               # no source
    by = lambda rows: {r["def_id"]: r for r in rows}  # noqa: E731
    same = by(svc.list_for_user("u1", source_below=1))
    assert "pine_source" not in same["u_000000000001"], "a CURRENT row must cost no byte"
    assert same["u_000000000002"]["pine_source"] == SCRIPT, "an UNSTAMPED row is older than any engine"
    assert "pine_source" not in same["u_000000000003"]
    newer = by(svc.list_for_user("u1", source_below=2))
    assert newer["u_000000000001"]["pine_source"] == SCRIPT
    assert newer["u_000000000002"]["pine_source"] == SCRIPT
    assert "pine_source" not in newer["u_000000000003"], "no source stored, none served"
    old_bundle = by(svc.list_for_user("u1"))
    assert all("pine_source" not in r for r in old_bundle.values()), "an old bundle asks nothing"


def test_a_save_WITHOUT_a_source_does_not_carry_the_predecessors(store):
    """A Formula-tab edit sends no script. Carrying the old one would let the next
    engine re-translate the script and silently undo the member's hand edit."""
    svc.save("u1", "u_000000000001", defn(20, engine=1), pine_source=SCRIPT)
    out = svc.save("u1", "u_000000000001", defn(21))
    assert out["appended"] is True and out["pine_source_stored"] is False
    rows = _raw_rows(store, "u_000000000001")
    assert [r["pine_source"] for r in rows] == [SCRIPT, None]
    assert svc.get("u1", "u_000000000001")["has_pine_source"] is False


def test_a_byte_identical_resave_appends_nothing_UNLESS_it_brings_a_script_the_row_lacks(store):
    first = svc.save("u1", "u_000000000001", defn(engine=1))
    assert first["pine_source_stored"] is False
    same = svc.save("u1", "u_000000000001", defn(engine=1))
    assert same["appended"] is False
    brought = svc.save("u1", "u_000000000001", defn(engine=1), pine_source=SCRIPT)
    assert brought["appended"] is True, "the script is what lets the next fix reach it"
    assert brought["rev"] == first["rev"] and brought["rev_bumped"] is False
    again = svc.save("u1", "u_000000000001", defn(engine=1), pine_source=SCRIPT)
    assert again["appended"] is False and again["pine_source_stored"] is True
    keep = svc.save("u1", "u_000000000001", defn(engine=1))
    assert keep["appended"] is False, "an identical save with no script keeps the stored row"
    assert svc.get("u1", "u_000000000001", with_source=True)["pine_source"] == SCRIPT


def test_an_oversized_source_is_DROPPED_not_refused_and_never_logged(store, caplog):
    huge = "// " + ("secret-sauce-" * 30000)
    assert len(huge.encode("utf-8")) > svc.MAX_PINE_SOURCE_BYTES
    with caplog.at_level(logging.DEBUG):
        out = svc.save("u1", "u_000000000001", defn(engine=1), pine_source=huge)
    assert out["appended"] is True, "a save that works today must keep working"
    assert out["pine_source_stored"] is False and out.get("pine_source_dropped") is True
    assert _raw_rows(store, "u_000000000001")[0]["pine_source"] is None
    assert "secret-sauce" not in caplog.text
    # …and the ordinary path logs nothing of a stored script either
    caplog.clear()
    with caplog.at_level(logging.DEBUG):
        svc.save("u1", "u_000000000002", defn(def_id="u_000000000002"), pine_source=SCRIPT)
    assert "Secret Sauce 7f3a" not in caplog.text


def test_a_TOMBSTONE_and_a_FORK_keep_the_script(store):
    svc.save("u1", "u_000000000001", defn(engine=1), pine_source=SCRIPT)
    forked = svc.fork("u1", "u_000000000001")
    assert forked["pine_source_stored"] is True
    assert svc.get("u1", forked["def_id"], with_source=True)["pine_source"] == SCRIPT
    assert svc.soft_delete("u1", "u_000000000001") is True
    assert [r["pine_source"] for r in _raw_rows(store, "u_000000000001")] == [SCRIPT, SCRIPT]


def test_a_SHARE_INSTALL_never_hands_the_recipient_the_authors_script(store):
    """Privacy-safe default: a share has always handed over the translated document
    and nothing else. The recipient's copy holds NO script — not in its column, not
    on any read, not to a newer engine — and still installs and draws."""
    svc.save("u1", "u_000000000001", defn(20, engine=1), pine_source=SCRIPT)
    token = svc.share("u1", "u_000000000001")["token"]
    out = svc.install_share("u2", token)
    assert out["appended"] is True
    assert out["pine_source_stored"] is False
    assert [r["pine_source"] for r in _raw_rows(store, out["def_id"])] == [None]
    got = svc.get("u2", out["def_id"], with_source=True)
    assert got["has_pine_source"] is False and "pine_source" not in got
    listed = svc.list_for_user("u2", source_below=99)
    assert len(listed) == 1 and "pine_source" not in listed[0]
    assert listed[0]["definition"]["origin"]["def_id"] == "u_000000000001",         "the copy carries `origin`, the marker the browser reads to suppress the legend row"
    # a fork of the recipient's copy cannot launder the script back in
    forked = svc.fork("u2", out["def_id"])
    assert forked["pine_source_stored"] is False
    # the author's own row is untouched
    assert svc.get("u1", "u_000000000001", with_source=True)["pine_source"] == SCRIPT


def test_the_WRITTEN_BACK_document_is_what_every_server_lane_reads(store):
    """The browser's write-back is an ordinary PUT: after it, the scan sweep's door
    (`live_definitions`), the backtest/alert door (`get`) and the owner's list all
    read the new document, and a maths change bumps `rev`."""
    svc.save("u1", "u_000000000001", defn(20), pine_source=SCRIPT)          # pre-engine
    up = svc.save("u1", "u_000000000001", defn(25, engine=1), pine_source=SCRIPT,
                  expected_version=1)
    assert up["appended"] is True and up["rev_bumped"] is True
    for row in (svc.live_definitions()[0], svc.get("u1", "u_000000000001"),
                svc.list_for_user("u1")[0]):
        assert row["definition"]["compute"]["ast"] == _ast_sma(25)
        assert row["definition"]["meta"]["engineVersion"] == 1


def test_a_STALE_write_back_is_refused_and_writes_nothing(store):
    svc.save("u1", "u_000000000001", defn(20), pine_source=SCRIPT)
    svc.save("u1", "u_000000000001", defn(21))                              # a newer revision
    with pytest.raises(svc.SaveConflict):
        svc.save("u1", "u_000000000001", defn(25, engine=1), pine_source=SCRIPT,
                 expected_version=1)
    rows = _raw_rows(store, "u_000000000001")
    assert len(rows) == 2 and rows[-1]["pine_source"] is None


# ─── the router ──────────────────────────────────────────────────────────────

@pytest.fixture
def client(store):
    a = FastAPI()
    a.include_router(router_mod.router)
    a.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": "u1", "role": "user", "plan": "pro", "subscription_status": "active"}
    return TestClient(a)


def test_the_router_persists_serves_and_guards_the_script(client, monkeypatch):
    monkeypatch.setattr(router_mod, "is_paid_user", lambda u: True)
    r = client.post("/api/user-definitions", json={"definition": defn(), "pine_source": SCRIPT})
    assert r.status_code == 200, r.text
    def_id = r.json()["def_id"]
    assert r.json()["pine_source_stored"] is True
    plain = client.get(f"/api/user-definitions/{def_id}").json()
    assert plain["has_pine_source"] is True and "pine_source" not in plain
    assert client.get(f"/api/user-definitions/{def_id}?source=1").json()["pine_source"] == SCRIPT
    listed = client.get("/api/user-definitions?graph=1&engine=1").json()["definitions"]
    assert listed[0]["pine_source"] == SCRIPT, "an unstamped row is served its script"
    assert "pine_source" not in client.get("/api/user-definitions").json()["definitions"][0]
    # the write-back: PUT with base_version and the script
    put = client.put(f"/api/user-definitions/{def_id}",
                     json={"definition": defn(25, engine=1), "pine_source": SCRIPT, "base_version": 1})
    assert put.status_code == 200, put.text
    assert put.json()["version"] == 2
    assert put.json()["pine_source_stored"] is True
    assert client.get(f"/api/user-definitions/{def_id}?source=1").json()["pine_source"] == SCRIPT,         "the write-back's script must reach the new version"
    stale = client.put(f"/api/user-definitions/{def_id}",
                       json={"definition": defn(26, engine=1), "pine_source": SCRIPT, "base_version": 1})
    assert stale.status_code == 409
    current = client.get("/api/user-definitions?engine=1").json()["definitions"][0]
    assert "pine_source" not in current, "a current row costs no byte"
    assert current["definition"]["compute"]["ast"] == _ast_sma(25)
