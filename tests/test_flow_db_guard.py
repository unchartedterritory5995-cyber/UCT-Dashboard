"""Rails for the flow.db WAL guard (2026-11-13 root cause: a live process held a DELETED
flow.db-wal while its other connections used a new one)."""
import ast
import os
import sqlite3

import pytest

from api import flow_db_guard as g

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    monkeypatch.setattr(g, "_ANCHOR", None)
    g._state["restart_requested"] = False
    yield
    if g._ANCHOR is not None:
        g._ANCHOR.close()
    g._state["restart_requested"] = False


def _db(tmp_path):
    p = str(tmp_path / "flow.db")
    c = sqlite3.connect(p)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("CREATE TABLE flow (id INTEGER PRIMARY KEY)")
    c.commit()
    c.close()
    return p


def test_without_an_anchor_the_last_close_deletes_the_wal(tmp_path):
    p = _db(tmp_path)
    w = sqlite3.connect(p)
    w.execute("INSERT INTO flow VALUES (1)")
    w.commit()
    w.close()
    assert not os.path.exists(p + "-wal")       # the hazard this module exists for


def test_the_anchor_keeps_the_wal_when_any_other_connection_closes(tmp_path):
    p = _db(tmp_path)
    assert g.open_anchor(p) is not None
    for i in range(3):
        w = sqlite3.connect(p)
        w.execute("INSERT INTO flow VALUES (?)", (i + 10,))
        w.commit()
        w.close()
        assert os.path.exists(p + "-wal")


def test_stale_handles_names_only_deleted_flow_files(monkeypatch):
    links = {"3": "/data/flow.db", "4": "/data/flow.db-wal (deleted)", "5": "/data/flow.db-wal",
             "6": "/data/oi.db-wal (deleted)", "7": "/data/flow.db-shm (deleted)"}
    monkeypatch.setattr(g.os, "listdir", lambda d: list(links))
    monkeypatch.setattr(g.os, "readlink", lambda p: links[os.path.basename(p)])
    assert sorted(g.stale_handles("/data/flow.db")) == ["/data/flow.db-shm (deleted)",
                                                         "/data/flow.db-wal (deleted)"]


def test_tripwire_restarts_once_and_only_when_stale(monkeypatch):
    kills, shouts = [], []
    monkeypatch.setattr(g.os, "kill", lambda pid, sig: kills.append(sig))
    monkeypatch.setattr(g, "_shout", shouts.append)
    monkeypatch.setattr(g, "stale_handles", lambda db=None, fd_dir=None: [])
    assert g.check_and_heal("/data/flow.db") == [] and not kills
    monkeypatch.setattr(g, "stale_handles", lambda db=None, fd_dir=None: ["/data/flow.db-wal (deleted)"])
    g.check_and_heal("/data/flow.db")
    g.check_and_heal("/data/flow.db")
    assert kills == [g.signal.SIGTERM] and len(shouts) == 1


def test_exit_now_skips_interpreter_teardown(monkeypatch):
    codes = []
    monkeypatch.setattr(g.os, "_exit", codes.append)
    g.exit_now(0)
    assert codes == [0]


def _src(rel):
    return open(os.path.join(ROOT, rel), encoding="utf-8").read()


def test_flow_worker_opens_the_anchor_before_the_consumer_and_exits_without_teardown():
    fn = next(n for n in ast.walk(ast.parse(_src("api/flow_worker_main.py")))
              if isinstance(n, ast.FunctionDef) and n.name == "main")
    body = ast.get_source_segment(_src("api/flow_worker_main.py"), fn)
    assert body.index("open_anchor(") < body.index("_start_consumer()")
    assert body.index("uvicorn.run(") < body.index("exit_now(")


def test_the_canary_tick_runs_the_tripwire():
    fn = next(n for n in ast.walk(ast.parse(_src("api/flow_integrity_canary.py")))
              if isinstance(n, ast.FunctionDef) and n.name == "run_tick")
    assert "check_and_heal(" in ast.get_source_segment(_src("api/flow_integrity_canary.py"), fn)


def test_autorestore_never_reads_the_live_file_with_plain_io():
    src = _src("api/flow_db_autorestore.py")
    fn = next(n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.FunctionDef) and n.name == "reads_cleanly")
    calls = [c.func.id for c in ast.walk(fn) if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)]
    assert "open" not in calls, calls


def test_the_tripwire_has_its_own_30s_job():
    src = _src("api/flow_worker_main.py")
    assert 'id="flow_db_wal_tripwire"' in src and "_guard.check_and_heal" in src


def test_the_anchor_is_opened_before_flowdb_init_in_main():
    src = _src("api/flow_worker_main.py")
    fn = next(n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.FunctionDef) and n.name == "main")
    calls = sorted((c.lineno, getattr(c.func, "attr", getattr(c.func, "id", "")))
                   for c in ast.walk(fn) if isinstance(c, ast.Call))
    names = [n for _, n in calls]
    assert "open_anchor" in names
    first_anchor = names.index("open_anchor")
    assert not [n for n in names[:first_anchor] if n in ("FlowDB", "_FlowDB")], names[:first_anchor]
