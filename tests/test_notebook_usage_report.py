"""Follow-up A: tools/notebook_usage_report.py on a temporary database (never production data).

It counts each usage event and each property value over a date range, reads only, refuses a path that is not a
file, and prints only values the server's schema allows (a row holding text it never should is counted as "other").
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from tools import notebook_usage_report as report


def _db(tmp_path: Path) -> Path:
    path = tmp_path / "auth.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE activity_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, "
                 "details TEXT DEFAULT '', ip_address TEXT DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
    rows = [
        ("u1", "j2:menu_row_used", {"menu": "list_more", "row": "export"}, "2026-11-10 14:00:00"),
        ("u1", "j2:menu_row_used", {"menu": "list_more", "row": "export"}, "2026-11-11 14:00:00"),
        ("u2", "j2:menu_row_used", {"menu": "note_more", "row": "history"}, "2026-11-11 15:00:00"),
        # A row that holds text it should never hold (written by hand, not through the door): counted as "other".
        ("u2", "j2:menu_row_used", {"menu": "note_more", "row": "My NVDA thesis"}, "2026-11-12 15:00:00"),
        ("u1", "j2:view_used", {"mode": "board", "via": "link"}, "2026-11-12 09:00:00"),
        ("u3", "j2:today_door_used", {"door": "shortcut", "created": True}, "2026-11-12 09:00:00"),
        # Outside the range, and another event: never counted.
        ("u1", "j2:view_used", {"mode": "table", "via": "menu"}, "2026-10-01 09:00:00"),
        ("u1", "j2:save_success", {"door": "editor"}, "2026-11-11 09:00:00"),
    ]
    for i, (uid, action, details, at) in enumerate(rows):
        conn.execute("INSERT INTO activity_log (id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)",
                     (f"r{i}", uid, action, json.dumps(details), at))
    conn.commit()
    conn.close()
    return path


def test_counts_per_event_and_per_value_over_the_range(tmp_path, capsys):
    db = _db(tmp_path)
    assert report.main(["--db", str(db), "--from", "2026-11-10", "--to", "2026-11-12"]) == 0
    out = capsys.readouterr().out
    assert "menu_row_used: 4 sent by 2 member(s)" in out
    assert "  row = export: 2" in out
    assert "  row = history: 1" in out
    assert "  row = other: 1" in out
    assert "view_used: 1 sent by 1 member(s)" in out          # the October row is outside the range
    assert "  mode = board: 1" in out and "table" not in out
    assert "  created = true: 1" in out
    assert "save_success" not in out                          # not a usage event
    assert "NVDA" not in out                                  # free text never printed


def test_it_reads_only(tmp_path):
    db = _db(tmp_path)
    before = db.read_bytes()
    assert report.main(["--db", str(db)]) == 0
    assert db.read_bytes() == before
    conn = sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True)
    with pytest.raises(sqlite3.OperationalError):
        conn.execute("DELETE FROM activity_log")                # the same open mode the tool uses cannot write
    conn.close()


def test_it_refuses_a_path_that_is_not_a_file(tmp_path, capsys):
    assert report.main(["--db", str(tmp_path)]) == 2          # a directory
    assert report.main(["--db", str(tmp_path / "missing.db")]) == 2
    assert "refused" in capsys.readouterr().err


def test_a_bad_range_is_refused(tmp_path):
    db = _db(tmp_path)
    assert report.main(["--db", str(db), "--from", "2026-11-12", "--to", "2026-11-10"]) == 2
    assert report.main(["--db", str(db), "--from", "yesterday"]) == 2


def test_fix_round_1_m4_no_side_files_and_no_router_import(tmp_path):
    """Opened immutable as well as read-only: a WAL database gains no -wal / -shm file beside it. And the schema
    comes from its small module: the whole router is never imported (checked in a fresh interpreter)."""
    import subprocess
    import sys
    db = _db(tmp_path)
    conn = sqlite3.connect(db)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.close()
    for side in ("-wal", "-shm"):
        Path(str(db) + side).unlink(missing_ok=True)
    assert report.main(["--db", str(db)]) == 0
    assert not Path(str(db) + "-wal").exists() and not Path(str(db) + "-shm").exists()
    code = ("import sys; from tools import notebook_usage_report as r; "
            f"rc = r.main(['--db', {str(db)!r}]); "
            "print('ROUTER', 'api.routers.journal_two' in sys.modules, rc)")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=120,
                         cwd=str(Path(__file__).resolve().parents[1]))
    assert "ROUTER False 0" in out.stdout, out.stdout + out.stderr
