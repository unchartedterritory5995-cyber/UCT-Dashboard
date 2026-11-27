"""tools/layout_crosswrite_scan.py: the read-only cross-write scan, on synthetic stores.

  * a member's two rows holding one arrangement are found; distinct rows, empty rows and another member's identical
    row are not;
  * a 'save' version that jumped to another of the member's layouts' arrangement is found; a save that kept its own
    arrangement, a restore, and a member's first version are not;
  * the output names members by hash and layouts by id, with widget ids only: no layout name, no ticker, no raw
    member id;
  * the stores are opened read-only (mode=ro, query_only): a scan leaves both files byte-identical, and a write
    through its connection is refused;
  * --count reports what a scan would read (rows, payload bytes, an estimated peak) without reading it.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3

import pytest

from tools import layout_crosswrite_scan as scan

SECRET_NAME = "Secret Layout Name"
TICKER = "ZZZQ"


def _layout(*ids):
    return json.dumps({"widgets": [{"id": i, "type": "chart", "opts": {"sym": TICKER}} for i in ids], "cols": 24})


@pytest.fixture
def stores(tmp_path):
    ldb = tmp_path / "charts_layouts.db"
    vdb = tmp_path / "workspace_docs.db"
    c = sqlite3.connect(ldb)
    c.execute("CREATE TABLE charts_layouts (id INTEGER PRIMARY KEY, scope TEXT, user_id INTEGER, name TEXT, "
              "layout_json TEXT, groups_json TEXT, created_by TEXT, sort_order INTEGER, created_at INTEGER, "
              "updated_at INTEGER)")
    rows = [
        # member 501: 10 and 11 hold the same board (the cross-write), 12 is its own
        (10, "user", 501, SECRET_NAME, _layout("a1", "a2", "wl"), 100, 950),
        (11, "user", 501, "B", _layout("a1", "a2", "wl"), 100, 2000),
        (12, "user", 501, "C", _layout("c1"), 100, 970),
        # member 502: distinct rows, one EMPTY board twice (never a finding)
        (20, "user", 502, "A", _layout("x1"), 100, 100),
        (21, "user", 502, "E1", json.dumps({"widgets": [], "cols": 24}), 100, 100),
        (22, "user", 502, "E2", json.dumps({"widgets": [], "cols": 24}), 100, 100),
        # member 503 has 501's arrangement: another member, never a finding
        (30, "user", 503, "A", _layout("a1", "a2", "wl"), 100, 100),
        # a prebuilt (global) with the same arrangement: not a member's own row
        (40, "global", 0, "Prebuilt", _layout("a1", "a2", "wl"), 100, 100),
    ]
    c.executemany("INSERT INTO charts_layouts (id, scope, user_id, name, layout_json, created_at, updated_at) "
                  "VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
    c.commit()
    c.close()
    v = sqlite3.connect(vdb)
    v.execute("CREATE TABLE artifact_versions (id INTEGER PRIMARY KEY, schema_version INTEGER, user_id TEXT, kind TEXT, "
              "artifact_id TEXT, version INTEGER, source TEXT, label TEXT, payload_json TEXT, content_sha256 TEXT, "
              "restored_from INTEGER, created_at INTEGER)")
    pay = lambda *ids: json.dumps({"layout_json": _layout(*ids), "groups_json": None})
    vers = [
        # 501's layout 11: its own board, then the JUMP to 10's board (the finding)
        ("501", "layout", "11", 1, "save", pay("b1"), 1000),
        ("501", "layout", "11", 2, "save", pay("a1", "a2", "wl"), 2000),
        # 501's layout 10: saves of its own board, never a finding
        ("501", "layout", "10", 1, "save", pay("a1", "a2"), 900),
        ("501", "layout", "10", 2, "save", pay("a1", "a2", "wl"), 950),
        # 501's layout 12: a RESTORE to 10's board is a member's choice, not a jump
        ("501", "layout", "12", 1, "save", pay("c1"), 900),
        ("501", "layout", "12", 2, "restore", pay("a1", "a2", "wl"), 960),
        ("501", "layout", "12", 3, "save", pay("c1"), 970),
        # 502's layout 20: its first version is its own
        ("502", "layout", "20", 1, "save", pay("x1"), 900),
        # a screen's version is not a layout
        ("501", "screen", "11", 1, "save", pay("a1", "a2", "wl"), 2000),
    ]
    v.executemany("INSERT INTO artifact_versions (user_id, kind, artifact_id, version, source, payload_json, "
                  "created_at, schema_version, content_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'x')", vers)
    v.commit()
    v.close()
    return str(ldb), str(vdb)


def test_rows_sharing_an_arrangement(stores):
    ldb, _ = stores
    found = scan.scan_rows(scan.load_rows(ldb))
    assert [(f["member"], f["layout_ids"]) for f in found] == [(scan.member_hash(501), [10, 11])]
    assert found[0]["widget_ids"] == ["a1", "a2", "wl"]


def test_a_save_that_jumped_to_another_layout(stores):
    ldb, vdb = stores
    rows = scan.load_rows(ldb)
    found = scan.scan_history(rows, vdb)
    # 11 jumped to 10's board (10 held it from 950; 12 briefly, by a restore at 960). 10's own growth (v2 at 950) came
    # first, so it is not a jump; a restore is a member's choice; 12's return to its own board is its own.
    assert [(f["layout_id"], f["version"], f["matches_layout_ids"]) for f in found] == [(11, 2, [10, 12])]
    # --since leaves out what came before it
    assert scan.scan_history(rows, vdb, since=2001) == []


def test_output_holds_no_content_and_no_raw_member_id(stores, capsys):
    ldb, vdb = stores
    assert scan.main(["--layouts-db", ldb, "--versions-db", vdb]) == 0
    text = capsys.readouterr().out
    assert "member " + scan.member_hash(501) in text
    assert SECRET_NAME not in text and TICKER not in text
    assert " 501" not in text and "'501'" not in text
    assert scan.main(["--layouts-db", ldb, "--versions-db", vdb, "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert len(data["rows"]) == 1 and len(data["history"]) == 1
    assert hashlib.sha256(b"501").hexdigest()[:12] == data["rows"][0]["member"]


def test_the_scan_writes_nothing(stores):
    ldb, vdb = stores
    before = (open(ldb, "rb").read(), open(vdb, "rb").read())
    rows = scan.load_rows(ldb)
    scan.scan_rows(rows)
    scan.scan_history(rows, vdb)
    assert (open(ldb, "rb").read(), open(vdb, "rb").read()) == before
    # and a store that is not there is never created
    missing = ldb + ".absent"
    assert scan.main(["--layouts-db", missing, "--versions-db", vdb]) == 2
    import os
    assert not os.path.exists(missing)


def test_a_write_through_the_scan_connection_is_refused(stores):
    ldb, _ = stores
    conn = scan._open_ro(ldb)
    try:
        with pytest.raises(sqlite3.OperationalError):
            conn.execute("INSERT INTO charts_layouts (id, scope, user_id, name, layout_json, created_at) "
                         "VALUES (99, 'user', 1, 'x', '{}', 1)")
    finally:
        conn.close()


def test_count_reports_what_a_scan_would_read(stores, capsys):
    ldb, vdb = stores
    c = scan.count(ldb, vdb)
    assert c["layout_rows"] == 7 and c["versions"] == 8          # own rows only; layout versions only
    assert c["layout_json_bytes"] > 0 and c["payload_json_bytes"] > 0
    assert c["estimated_peak_mb"] >= 0
    assert scan.main(["--layouts-db", ldb, "--versions-db", vdb, "--count"]) == 0
    out = capsys.readouterr().out
    assert "layout_rows=7" in out and "estimated_peak_mb=" in out
    assert SECRET_NAME not in out and TICKER not in out
