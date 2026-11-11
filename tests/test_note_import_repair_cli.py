"""Plan F Task 8: `tools/note_import_repair.py`, the pod CLI. Dry run by default.

Exit codes: 0 ok · 2 refused (flag off for --apply, or market hours) · 3 another run holds the
lock · 4 memory ceiling (RepairAborted) · 5 DB missing. Most tests call `main(argv)` in process
against a temp auth.db; the import and lock rails run a real subprocess.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from api.services import auth_db
from api.services.journal_two.import_repair import runner
from api.services.journal_two.test_import_repair_runner import (  # noqa: F401 -- fixture by name
    BARE, REPORT_KEYS, _doc, _link, _note, _para, _t, db,
)

REPO = Path(__file__).resolve().parents[1]
CLI = REPO / "tools" / "note_import_repair.py"


def _cli():
    spec = importlib.util.spec_from_file_location("note_import_repair_cli", CLI)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def cli(db, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(db))
    monkeypatch.delenv(runner.FLAG, raising=False)
    monkeypatch.setattr(runner, "_market_hours", lambda at: False)  # never a function of the hour
    return _cli()


def test_the_dry_run_refuses_market_hours_too(cli, capsys, monkeypatch):
    """Re-review T8-M5: the dry run is the first command run on the pod; it reads every member's
    notes, so it refuses 9:30-16:00 ET on a weekday as `--apply` does (exit 2), unless allowed."""
    _note("u1", "Notion", "notion:Export/A.md", BARE)
    monkeypatch.setattr(runner, "_market_hours", lambda at: True)
    assert _run(cli, [], capsys)[0] == 2
    code, report = _run(cli, ["--allow-market-hours"], capsys)
    assert code == 0 and report["mode"] == "dry-run"


def test_the_dry_run_has_the_memory_watchdog(cli, capsys, monkeypatch):
    """T8-M5: memory over the ceiling during the dry run aborts it with exit 4, as apply does."""
    for i in range(3):
        _note("u1", "Notion", f"notion:Export/{i}.md", BARE)
    rss = iter([100.0, 100.0, 400.0, 400.0, 400.0])
    monkeypatch.setattr(runner, "_rss_mb", lambda: next(rss))
    monkeypatch.setattr(runner, "RSS_CHECK_EVERY", 1)
    assert _run(cli, [], capsys)[0] == 4


def _files_digest(db_path: str) -> tuple:
    """The database file's bytes, and how many bytes its WAL holds. Opening a WAL database
    read-only may create an EMPTY `-wal` (SQLite's own bookkeeping): zero bytes is no write."""
    wal = Path(db_path + "-wal")
    return (hashlib.sha256(Path(db_path).read_bytes()).hexdigest(), wal.stat().st_size if wal.exists() else 0)


def _run(cli, argv, capsys):
    code = cli.main(argv)
    out = capsys.readouterr().out
    return code, (json.loads(out) if out.strip() else None)


def test_dry_run_is_default_and_read_only(cli, capsys):
    _note("u1", "Obsidian", "obsidian:Vault/Other.md", _doc(_para(_t("plain"))))
    _note("u1", "Obsidian", "obsidian:Vault/Here.md", _doc(_para(_t("o", _link("Other.md"))),
                                                          _para(_t("see https://example.com/a"))))
    path = auth_db._DB_PATH
    before = (_files_digest(path), os.path.getmtime(path))
    code, report = _run(cli, [], capsys)
    assert code == 0 and report["mode"] == "dry-run"
    # C13: the read-only connection reads rows by name (the link resolver needs it)
    assert report["totals"]["wouldRepairNotes"] == 1
    assert (_files_digest(path), os.path.getmtime(path)) == before


def test_apply_without_flag_exits_2(cli, capsys):
    note = _note("u1", "Notion", "notion:Export/A.md", BARE)
    code, report = _run(cli, ["--apply", "--allow-market-hours"], capsys)
    assert code == 2 and report is None
    body = auth_db.get_connection().execute("SELECT body_json FROM j2_notes WHERE id = ?", (note,)).fetchone()[0]
    assert json.loads(body) == BARE


def test_apply_in_market_hours_exits_2(cli, capsys, monkeypatch):
    monkeypatch.setenv(runner.FLAG, "1")
    monkeypatch.setattr(runner, "_market_hours", lambda at: True)
    _note("u1", "Notion", "notion:Export/A.md", BARE)
    assert _run(cli, ["--apply"], capsys)[0] == 2
    code, report = _run(cli, ["--apply", "--allow-market-hours"], capsys)
    assert code == 0 and report["repaired"] == 1


def test_apply_writes_and_reports(cli, capsys, monkeypatch, tmp_path):
    monkeypatch.setenv(runner.FLAG, "1")
    _note("u1", "Notion", "notion:Export/A.md", BARE)
    out = tmp_path / "import_repair" / "nested" / "apply-1.json"  # the CLI creates the folder
    code, report = _run(cli, ["--apply", "--allow-market-hours", "--sleep-ms", "0", "--out", str(out)], capsys)
    assert code == 0 and report["mode"] == "apply" and report["repaired"] == 1
    assert json.loads(out.read_text(encoding="utf-8")) == report


def test_the_cli_starts_no_extraction_threads(cli, capsys, monkeypatch):
    """Re-review I-5: a repaired image becomes a `pending` document row; no extraction or OCR
    runs in the CLI's process (the web pod's sweep extracts it)."""
    import threading

    import httpx

    from api.services.journal_two import document_extraction
    from api.services.journal_two.test_import_repair_apply import HOT, PNG
    from api.services.journal_two import hotlink_fetch
    from api.services.journal_two.note_connectors.providers import base as base_module

    async def _public(host):
        return ["142.250.0.1"]

    monkeypatch.setattr(base_module, "_resolve_host", _public)
    monkeypatch.setattr(hotlink_fetch, "default_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, content=PNG, headers={"content-type": "image/png"}))))
    monkeypatch.setenv(runner.FLAG, "1")
    submitted = []
    monkeypatch.setattr(document_extraction._EXTRACTION_POOL, "submit", lambda *a: submitted.append(a))
    note = _note("u1", "Notion", "notion:Export/H.md", _doc({"type": "image", "attrs": {"src": HOT}}))
    code, report = _run(cli, ["--apply", "--allow-market-hours", "--sleep-ms", "0"], capsys)
    assert code == 0 and report["fetched"] == 1
    assert submitted == []
    rows = auth_db.get_connection().execute(
        "SELECT status FROM j2_note_documents WHERE note_id = ?", (note,)).fetchall()
    assert [r[0] for r in rows] == ["pending"]
    assert not [t for t in threading.enumerate() if t.name in ("j2-doc-extract", "j2-doc-ocr")]


def test_report_is_json_with_the_documented_keys(cli, capsys, tmp_path):
    _note("u1", "Notion", "notion:Export/A.md", BARE)
    out = tmp_path / "dry" / "dryrun-1.json"
    code, report = _run(cli, ["--out", str(out), "--member", "u1", "--run-id", "r-9"], capsys)
    assert code == 0 and set(report) == REPORT_KEYS and report["runId"] == "r-9"
    assert json.loads(out.read_text(encoding="utf-8")) == report


def test_the_memory_ceiling_exits_4(cli, capsys, monkeypatch):
    monkeypatch.setenv(runner.FLAG, "1")

    def abort(*a, **k):
        raise runner.RepairAborted("memory grew more than 250 MB during the run")

    monkeypatch.setattr(runner, "apply", abort)
    assert _run(cli, ["--apply", "--allow-market-hours"], capsys)[0] == 4


def test_a_missing_database_exits_5(cli, capsys, monkeypatch, tmp_path):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "nope.db"))
    assert _run(cli, [], capsys)[0] == 5
    assert not (tmp_path / "nope.db").exists()  # a dry run never creates the database


def test_the_batch_and_relist_options_reach_apply(cli, capsys, monkeypatch):
    monkeypatch.setenv(runner.FLAG, "1")
    seen = {}

    def spy(conn, **kw):
        seen.update(kw)
        return {"runId": kw["run_id"], "mode": "apply"}

    monkeypatch.setattr(runner, "apply", spy)
    code, _ = _run(cli, ["--apply", "--member", "u1", "--member", "u2", "--max-members", "1", "--max-notes", "50",
                         "--max-fetches", "9", "--sleep-ms", "5", "--obsidian-relist", "--allow-market-hours"], capsys)
    assert code == 0
    assert seen == {"run_id": runner.RUN_ID_DEFAULT, "members": ["u1", "u2"], "max_fetches": 9, "sleep_ms": 5,
                    "obsidian_relist": True, "allow_market_hours": True, "max_members": 1, "max_notes": 50}


def test_cli_never_imports_api_main():
    code = ("import importlib.util, sys; "
            f"spec = importlib.util.spec_from_file_location('cli', r'{CLI}'); "
            "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); "
            "assert 'api.main' not in sys.modules, 'api.main imported'; print('ok')")
    done = subprocess.run([sys.executable, "-c", code], cwd=REPO, capture_output=True, text=True, timeout=120)
    assert done.returncode == 0 and done.stdout.strip().endswith("ok"), done.stderr[-2000:]


@pytest.mark.skipif(sys.platform == "win32", reason="fcntl.flock is POSIX-only; the CLI skips the lock on Windows")
def test_second_run_exits_3_while_locked(db, tmp_path):
    import fcntl
    lock = tmp_path / ".note_import_repair.lock"
    env = {**os.environ, "DATA_DIR": str(tmp_path), "AUTH_DB_PATH": auth_db._DB_PATH}
    with open(lock, "w") as held:
        fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
        done = subprocess.run([sys.executable, str(CLI)], cwd=REPO, env=env, capture_output=True, text=True,
                              timeout=120)
    assert done.returncode == 3, done.stderr[-2000:]
