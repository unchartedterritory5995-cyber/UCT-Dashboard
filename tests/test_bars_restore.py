"""Worker boot repair for a bars.db SQLite cannot open.

2026-11-08: /data/bars.db on the worker answered "file is not a database", so
init_db raised, main() exited 1, and every deploy failed its healthcheck. The
file is the R2 snapshot source of truth, so the repair has hard edges: never
delete the bad file, and never fall through to an empty database that could
later ship as the fleet's snapshot.

Files here are real SQLite databases and real garbage. Mocking sqlite3 would
assert only what the author believed it raises.
"""
from __future__ import annotations

import ast
import os
import pathlib
import socket
import sqlite3
import tempfile
import urllib.request
from types import SimpleNamespace

import pytest

from api.services import bars_restore as br
from api.services import data_sync

GARBAGE = b"this is not a sqlite file at all" * 64


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(tempfile, "tempdir", tempfile.tempdir)
    return tmp_path


def _db(data_dir):
    return data_dir / "bars.db"


def _make_valid(path):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE ohlcv (ticker TEXT)")
    c.execute("INSERT INTO ohlcv VALUES ('SPY')")
    c.commit()
    c.close()


def _script_snapshots(monkeypatch, data_dir, outcomes):
    """outcomes maps snapshot ts -> True (installs a valid db) or False."""
    tried = []

    def fake_download(ts):
        tried.append(ts)
        if outcomes[ts]:
            _make_valid(_db(data_dir))
        return outcomes[ts]

    monkeypatch.setattr(br, "_install_snapshot", fake_download)
    monkeypatch.setattr(data_sync, "get_latest_snapshot_ts", lambda: next(iter(outcomes), None))
    monkeypatch.setattr(data_sync, "_list_snapshot_ts_desc", lambda: list(outcomes))
    return tried


# -- detection -----------------------------------------------------------------

def test_garbage_is_unreadable(data_dir):
    _db(data_dir).write_bytes(GARBAGE)
    assert br.is_unreadable(str(_db(data_dir)))


def test_a_valid_database_is_readable(data_dir):
    _make_valid(_db(data_dir))
    assert not br.is_unreadable(str(_db(data_dir)))


def test_an_empty_file_is_not_unreadable(data_dir):
    """SQLite treats a zero-byte file as a new database; that is a different
    fault with its own existing handling."""
    _db(data_dir).write_bytes(b"")
    assert not br.is_unreadable(str(_db(data_dir)))


def test_a_missing_file_is_not_unreadable(data_dir):
    assert not br.is_unreadable(str(_db(data_dir)))


def test_only_notadb_counts_as_unreadable(data_dir, monkeypatch):
    """A locked or busy database holds good data and must never be moved."""
    _make_valid(_db(data_dir))

    def locked(*_a, **_k):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(br.sqlite3, "connect", locked)
    assert not br.is_unreadable(str(_db(data_dir)))


def test_restore_needed_for_an_unreadable_file(data_dir):
    _db(data_dir).write_bytes(GARBAGE)
    assert br.restore_needed()


def test_restore_not_needed_for_a_healthy_file(data_dir):
    _make_valid(_db(data_dir))
    assert not br.restore_needed()


def test_restore_not_needed_on_a_fresh_volume(data_dir):
    assert not br.restore_needed()


def test_an_interrupted_restore_resumes(data_dir):
    """A redeploy can kill the restore after the bad file moved aside. The next
    boot must finish the job, not build an empty database."""
    (data_dir / "bars.db.unreadable.100").write_bytes(GARBAGE)
    assert br.restore_needed()


# -- quarantine ----------------------------------------------------------------

def test_the_bad_file_is_kept_byte_for_byte(data_dir, monkeypatch):
    _db(data_dir).write_bytes(GARBAGE)
    _script_snapshots(monkeypatch, data_dir, {"200": True})
    assert br.restore()
    kept = list(data_dir.glob("bars.db.unreadable.*"))
    assert len(kept) == 1 and kept[0].read_bytes() == GARBAGE


def test_sidecars_move_with_the_bad_file(data_dir, monkeypatch):
    """A stale WAL left beside a restored main file can corrupt it."""
    _db(data_dir).write_bytes(GARBAGE)
    (data_dir / "bars.db-wal").write_bytes(b"wal")
    (data_dir / "bars.db-shm").write_bytes(b"shm")
    _script_snapshots(monkeypatch, data_dir, {"200": False})
    br.restore()
    assert not (data_dir / "bars.db-wal").exists()
    assert not (data_dir / "bars.db-shm").exists()
    assert len(list(data_dir.glob("bars.db.unreadable.*-wal"))) == 1


def test_a_full_quarantine_refuses_and_leaves_the_file(data_dir, monkeypatch):
    """Each copy is ~38 GB, so repeats must stop for a person."""
    _db(data_dir).write_bytes(GARBAGE)
    (data_dir / "bars.db.unreadable.1").write_bytes(b"a")
    (data_dir / "bars.db.unreadable.2").write_bytes(b"b")
    tried = _script_snapshots(monkeypatch, data_dir, {"200": True})
    assert not br.restore()
    assert tried == [] and _db(data_dir).read_bytes() == GARBAGE


def test_sidecars_do_not_count_toward_the_quarantine_limit(data_dir, monkeypatch):
    _db(data_dir).write_bytes(GARBAGE)
    (data_dir / "bars.db.unreadable.1").write_bytes(b"a")
    (data_dir / "bars.db.unreadable.1-wal").write_bytes(b"w")
    (data_dir / "bars.db.unreadable.1-shm").write_bytes(b"s")
    _script_snapshots(monkeypatch, data_dir, {"200": True})
    assert br.restore()


# -- restore -------------------------------------------------------------------

def test_restore_installs_the_newest_snapshot(data_dir, monkeypatch):
    _db(data_dir).write_bytes(GARBAGE)
    tried = _script_snapshots(monkeypatch, data_dir, {"300": True, "200": True})
    assert br.restore()
    assert tried == ["300"] and not br.is_unreadable(str(_db(data_dir)))


def test_restore_falls_back_to_an_older_snapshot(data_dir, monkeypatch):
    _db(data_dir).write_bytes(GARBAGE)
    tried = _script_snapshots(monkeypatch, data_dir, {"300": False, "200": True})
    assert br.restore() and tried == ["300", "200"]


def test_restore_gives_up_after_four_candidates(data_dir, monkeypatch):
    _db(data_dir).write_bytes(GARBAGE)
    tried = _script_snapshots(monkeypatch, data_dir, {str(n): False for n in range(9, 0, -1)})
    assert not br.restore() and len(tried) == 4


def test_a_failed_restore_never_leaves_an_empty_database(data_dir, monkeypatch):
    """An empty store that accumulates a few rows could pass the snapshot floor
    and replace the fleet's truth."""
    _db(data_dir).write_bytes(GARBAGE)
    _script_snapshots(monkeypatch, data_dir, {"300": False})
    assert not br.restore()
    assert not _db(data_dir).exists()


def test_no_snapshots_at_all_fails_without_creating_a_database(data_dir, monkeypatch):
    _db(data_dir).write_bytes(GARBAGE)
    _script_snapshots(monkeypatch, data_dir, {})
    assert not br.restore() and not _db(data_dir).exists()


def test_restore_extracts_onto_the_volume(data_dir, monkeypatch):
    """/tmp is small and on another filesystem; a stale partial is 40 GB."""
    _db(data_dir).write_bytes(GARBAGE)
    stale = data_dir / "tmp" / "data_sync_old"
    stale.mkdir(parents=True)
    (stale / "partial").write_bytes(b"x")
    seen = {}

    def fake_download(ts):
        seen["tmp"] = tempfile.gettempdir()
        seen["stale_present"] = stale.exists()
        _make_valid(_db(data_dir))
        return True

    monkeypatch.setattr(br, "_install_snapshot", fake_download)
    monkeypatch.setattr(data_sync, "get_latest_snapshot_ts", lambda: "300")
    monkeypatch.setattr(data_sync, "_list_snapshot_ts_desc", lambda: ["300"])
    assert br.restore()
    assert seen["stale_present"] is False


def test_a_snapshot_that_installs_garbage_is_not_accepted(data_dir, monkeypatch):
    _db(data_dir).write_bytes(GARBAGE)

    def bad_install(ts):
        _db(data_dir).write_bytes(GARBAGE)
        return True

    monkeypatch.setattr(br, "_install_snapshot", bad_install)
    monkeypatch.setattr(data_sync, "get_latest_snapshot_ts", lambda: "300")
    monkeypatch.setattr(data_sync, "_list_snapshot_ts_desc", lambda: ["300"])
    assert not br.restore()


# -- boot ----------------------------------------------------------------------

def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_a_healthy_boot_spawns_nothing(data_dir):
    _make_valid(_db(data_dir))

    def explode(*_a, **_k):
        raise AssertionError("restore must not run")

    br.repair_at_boot(_free_port(), run=explode)


def test_health_answers_for_the_whole_restore(data_dir):
    """Railway kills a deploy whose health check fails for 600s, and a 38 GB
    restore can take longer."""
    _db(data_dir).write_bytes(GARBAGE)
    port = _free_port()
    seen = {}

    def fake_run(argv, **_k):
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=5) as r:
            seen["status"] = r.status
        seen["argv"] = argv
        return SimpleNamespace(returncode=0)

    br.repair_at_boot(port, run=fake_run)
    assert seen["status"] == 200
    assert seen["argv"][-1] == "api.services.bars_restore"


def test_the_port_is_free_for_uvicorn_afterwards(data_dir):
    _db(data_dir).write_bytes(GARBAGE)
    port = _free_port()
    br.repair_at_boot(port, run=lambda *_a, **_k: SimpleNamespace(returncode=0))
    with socket.socket() as s:
        s.bind(("0.0.0.0", port))


def test_a_failed_restore_stops_the_boot(data_dir):
    _db(data_dir).write_bytes(GARBAGE)
    with pytest.raises(RuntimeError):
        br.repair_at_boot(_free_port(), run=lambda *_a, **_k: SimpleNamespace(returncode=1))


def test_the_owner_is_told_when_a_repair_starts_and_ends(data_dir):
    _db(data_dir).write_bytes(GARBAGE)
    said = []
    br.repair_at_boot(_free_port(), run=lambda *_a, **_k: SimpleNamespace(returncode=0),
                      notify=said.append)
    assert len(said) == 2


def test_the_owner_is_told_when_a_repair_fails(data_dir):
    _db(data_dir).write_bytes(GARBAGE)
    said = []
    with pytest.raises(RuntimeError):
        br.repair_at_boot(_free_port(), run=lambda *_a, **_k: SimpleNamespace(returncode=1),
                          notify=said.append)
    assert len(said) == 2 and "FAILED" in said[-1]


def test_a_broken_alert_cannot_stop_the_repair(data_dir):
    _db(data_dir).write_bytes(GARBAGE)

    def boom(_msg):
        raise OSError("discord down")

    br.repair_at_boot(_free_port(), run=lambda *_a, **_k: SimpleNamespace(returncode=0), notify=boom)


def test_module_entry_exit_code_reports_the_restore(data_dir, monkeypatch):
    monkeypatch.setattr(br, "restore", lambda: True)
    assert br.main() == 0
    monkeypatch.setattr(br, "restore", lambda: False)
    assert br.main() == 1


def test_worker_repairs_before_it_opens_the_database():
    """init_db on an unreadable file raises and exits, so order is the fix."""
    src = (pathlib.Path(__file__).parent.parent / "api" / "worker_main.py").read_text(encoding="utf8")
    main = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "main")
    calls = [n for n in ast.walk(main) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
    line = {c.func.attr: c.lineno for c in reversed(calls)}
    assert line["repair_at_boot"] < line["init_db"]


def test_module_is_runnable_as_the_subprocess_target():
    assert os.path.basename(br.__file__) == "bars_restore.py"
