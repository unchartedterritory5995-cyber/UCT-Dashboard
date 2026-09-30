"""Production-safety rails added at integration: the daily econ.db backup, and SINGLE scheduler
ownership (only api/econ_main may start the econ service/scheduler; no other boot imports them)."""
from __future__ import annotations

import ast
import os
import pathlib
import sqlite3

import pytest

from api.services.econ import backup, store as S

REPO = pathlib.Path(__file__).resolve().parents[2]


def _seed(path):
    st = S.connect(path)
    rid = st.upsert_release("t:1", "x", "backfill", None, None)
    st.write_observations("USX", rid, [("2026-01-01", "2026-01-31", 1.0, "", 1_790_000_000, "rule", "L", None, None)])
    return st


def test_backup_is_consistent_verified_and_rotated(tmp_path, monkeypatch):
    db = str(tmp_path / "econ.db")
    st = _seed(db)
    monkeypatch.setenv("ECON_BACKUP_KEEP", "2")
    days = [1_790_000_000 + i * 86400 for i in range(4)]
    for d in days:
        r = backup.run_backup(db, d)
        assert r["ok"] and r["bytes"] > 0
    files = sorted(os.listdir(backup.backup_dir(db)))
    assert len([f for f in files if f.endswith(".db")]) == 2          # rotated to KEEP
    assert not [f for f in files if f.endswith(("-wal", "-shm", ".partial"))], files   # ONE self-contained file
    c = sqlite3.connect(os.path.join(backup.backup_dir(db), files[-1]))
    assert c.execute("select count(*) from observation").fetchone()[0] == 1
    with pytest.raises(sqlite3.DatabaseError):                         # append-only survives the backup
        c.execute("update observation set value=2")
    st.conn.close()


def test_backup_refuses_a_copy_without_append_only_triggers(tmp_path):
    db = str(tmp_path / "plain.db")
    c = sqlite3.connect(db)
    c.execute("create table observation(series_id text, value real)")
    c.commit(); c.close()
    r = backup.run_backup(db, 1_790_000_000)
    assert r["ok"] is False and any("append-only" in x for x in r["reasons"])   # NEGATIVE CONTROL


def test_backup_upload_uses_only_the_econ_prefix(tmp_path):
    db = str(tmp_path / "econ.db"); _seed(db).conn.close()
    seen = {}
    r = backup.run_backup(db, 1_790_000_000, upload=lambda k, data: seen.setdefault(k, len(data)) or True)
    assert r["uploaded"] is True and list(seen) == [f"econ/v1/backup/econ-{r['day']}.db.gz"]


def _imports(path: pathlib.Path) -> set[str]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (SyntaxError, UnicodeDecodeError):
        return set()
    out = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom) and n.module:
            out.add(n.module)
            out.update(f"{n.module}.{a.name}" for a in n.names)
        elif isinstance(n, ast.Import):
            out.update(a.name for a in n.names)
    return out


RUNNERS = ("api.services.econ.service", "api.services.econ.scheduler")


def test_only_econ_main_can_start_the_econ_scheduler():
    """SINGLE WRITER: the econ scheduler/service may be imported only by econ's own package and
    api/econ_main.py. web (api/main.py + routers), worker, bars-api, flow-worker and every other
    module must never import them -- so no other Railway service can become a second writer."""
    offenders = []
    for py in (REPO / "api").rglob("*.py"):
        rel = py.relative_to(REPO).as_posix()
        if rel.startswith("api/services/econ/") or rel == "api/econ_main.py":
            continue
        if any(m == r or m.startswith(r + ".") or m.endswith(".econ.service") or m.endswith(".econ.scheduler")
               for m in _imports(py) for r in RUNNERS):
            offenders.append(rel)
    assert offenders == [], offenders


def test_the_web_router_path_never_imports_the_writer():
    for rel in ("api/routers/econ.py", "api/services/econ/serving.py", "api/services/econ/publish.py"):
        mods = _imports(REPO / rel)
        assert not any(m.endswith(("econ.scheduler", "econ.service", "econ.ingest")) or m in (".scheduler", ".service", ".ingest")
                       for m in mods), (rel, mods)


def test_only_railway_econ_json_starts_econ_main():
    for cfg in REPO.glob("railway*.json"):
        txt = cfg.read_text(encoding="utf-8")
        assert ("api.econ_main" in txt) == (cfg.name == "railway.econ.json"), cfg.name
