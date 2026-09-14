"""PC-side Brain KB sync — tools/wisdom/publish_kb_sync.py (D18 step 4).

Every test runs against a synthetic ENGINE-shaped knowledge_base in tmp_path.
The real ENGINE KB is never opened by this file.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a dry run that can write (it must open the file read-only).
2. a commit while the flag is off, or past 20:55 CT, or with a bad export.
3. a DELETE or REPLACE statement anywhere in a sync (sqlite statement trace).
4. an updated row that changes its KB id, or a legacy row with a colliding
   source_ref touched because the sync keyed on source_ref alone.
5. a sync that commits after its deadline passes mid-run, or runs without a backup.
6. legacy (Bonde) rows deactivated without an explicit reviewed plan.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import importlib.util
import pathlib
import re
import sqlite3

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("publish_kb_sync_under_test",
                                               REPO / "tools" / "wisdom" / "publish_kb_sync.py")
sync = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sync)
kbrow = sync.kbrow
CT = sync.CT

_ENGINE_DDL = """
CREATE TABLE knowledge_base (
  id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
  tags TEXT DEFAULT '', trader TEXT DEFAULT '', source_ref TEXT DEFAULT '', regime_context TEXT DEFAULT '',
  priority INTEGER DEFAULT 3, active INTEGER DEFAULT 1, source TEXT DEFAULT 'manual', knowledge_epoch TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""
_WRITE_RE = re.compile(r"^\s*(DELETE|REPLACE|DROP)\b|\bINSERT\s+OR\s+REPLACE\b", re.I)
EARLY = dt.datetime(2026, 9, 14, 19, 30, tzinfo=CT)
LATE = dt.datetime(2026, 9, 14, 20, 56, tzinfo=CT)


#: Every real export row carries the §8c.3 provenance marker in its content — `brainkb`
#: stamps it and `validate_export` refuses a row without one — so a fixture row that
#: lacked it would be a shape production can no longer produce.
MARKED_CONTENT = sync.provenance.stamp_text(
    "Source: wisdom:srcX#segX@1s\nbody", consumer="brainkb", subject_ref="wisdom_principles:x",
    locator="wisdom:srcX#segX@1s", flag_env="WISDOM_BRAINKB_PUBLISH_ENABLED")


def _row(ref, title, content=MARKED_CONTENT, **kw):
    row = {"source_ref": ref, "category": "RULE", "title": title, "content": content, "tags": "wisdom",
           "trader": "TSDR", "knowledge_epoch": "2026", "priority": 3, "regime_context": "", "provisional": 1,
           "source": "wisdom"}
    row.update(kw)
    row["content_sha256"] = kbrow.kb_row_sha(row)
    return row


def _export(rows, *, enabled=True, superseded=()):
    return {"ok": True, "enabled": enabled, "schema": "wisdom-kb-export-v1", "rows": rows,
            "superseded_refs": list(superseded), "generated_at": "2026-09-14T19:00:00-04:00"}


@pytest.fixture
def engine_kb(tmp_path):
    path = tmp_path / "uct_intelligence.db"
    conn = sqlite3.connect(path)
    conn.executescript(_ENGINE_DDL)
    add = ("INSERT INTO knowledge_base(category, title, content, tags, trader, source_ref, priority, active, source, "
           "knowledge_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    for i in range(3):
        conn.execute(add, ("SETUP", f"legacy scan {i}", "legacy", "", "Bonde",
                           "substack_unchartedterritory_sunday_scans_2026-02-21", 3, 1,
                           "intake:substack_unchartedterritory_sunday_scans_2026-02-21", "2024"))
    # a MANUAL row whose free-text source_ref happens to look like a Wisdom key
    conn.execute(add, ("RULE", "collision", "manual", "", "TSDR", "wisdom:principle:keep", 3, 1, "manual", "2024"))
    kept = _row("wisdom:principle:keep", "Keep — old title")
    conn.execute(add, (kept["category"], kept["title"], kept["content"], kept["tags"], kept["trader"],
                       kept["source_ref"], 3, 1, "wisdom", "2026"))
    gone = _row("wisdom:lesson:gone", "Gone")
    conn.execute(add, (gone["category"], gone["title"], gone["content"], gone["tags"], gone["trader"],
                       gone["source_ref"], 3, 1, "wisdom", "2026"))
    back = _row("wisdom:principle:back", "Back")
    conn.execute(add, (back["category"], back["title"], back["content"], back["tags"], back["trader"],
                       back["source_ref"], 3, 0, "wisdom", "2026"))
    conn.commit()
    conn.close()
    return path


def _kb(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        return {r["id"]: dict(r) for r in conn.execute("SELECT * FROM knowledge_base")}
    finally:
        conn.close()


def _standard_export():
    return _export([_row("wisdom:principle:keep", "Keep — NEW title"),   # changed -> UPDATE in place
                    _row("wisdom:principle:back", "Back"),              # unchanged but inactive -> reactivate
                    _row("wisdom:principle:new", "New")])               # new -> INSERT
    # wisdom:lesson:gone is absent -> active=0


def test_a_dry_run_is_read_only_and_reports_the_plan(engine_kb):
    before = hashlib.sha256(engine_kb.read_bytes()).hexdigest()
    seen: list = []
    out = sync.run_sync(str(engine_kb), _standard_export(), trace=seen.append)
    assert out["dry_run"] is True
    assert out["plan"] == {"insert": 1, "update": 1, "reactivate": 1, "unchanged": 0, "deactivate": 1,
                           "legacy_deactivate": 0}
    assert hashlib.sha256(engine_kb.read_bytes()).hexdigest() == before
    assert seen and all(s.lstrip().upper().startswith(("SELECT", "PRAGMA")) for s in seen), seen
    # the read-only open is load-bearing: a write through the same URI must fail
    ro = sqlite3.connect(f"file:{engine_kb.resolve().as_posix()}?mode=ro", uri=True)
    with pytest.raises(sqlite3.OperationalError):
        ro.execute("UPDATE knowledge_base SET active = 0")
    ro.close()


def test_commit_is_refused_while_the_flag_is_off(engine_kb, tmp_path):
    with pytest.raises(sync.SyncAborted, match="off"):
        sync.run_sync(str(engine_kb), _export([_row("wisdom:principle:new", "New")], enabled=False),
                      commit=True, now=EARLY, backup_dir=str(tmp_path / "bk"))
    assert not (tmp_path / "bk").exists()


def test_commit_updates_inserts_deactivates_and_never_deletes(engine_kb, tmp_path):
    before = _kb(engine_kb)
    by_ref = {(r["source"], r["source_ref"]): kb_id for kb_id, r in before.items()}
    seen: list = []
    out = sync.run_sync(str(engine_kb), _standard_export(), commit=True, now=EARLY, clock=lambda: EARLY,
                        backup_dir=str(tmp_path / "bk"), trace=seen.append)
    assert not [s for s in seen if _WRITE_RE.search(s)], [s for s in seen if _WRITE_RE.search(s)]
    # non-vacuity: the trace saw the real writes
    assert any(s.lstrip().upper().startswith("UPDATE") for s in seen)
    assert any(s.lstrip().upper().startswith("INSERT") for s in seen)
    assert [s.strip().upper() for s in seen].count("BEGIN IMMEDIATE") == 1
    after = _kb(engine_kb)
    keep_id = by_ref[("wisdom", "wisdom:principle:keep")]
    assert after[keep_id]["title"] == "Keep — NEW title" and after[keep_id]["active"] == 1   # same id
    assert after[by_ref[("wisdom", "wisdom:lesson:gone")]]["active"] == 0
    assert after[by_ref[("wisdom", "wisdom:lesson:gone")]]["title"] == "Gone"             # row kept
    assert after[by_ref[("wisdom", "wisdom:principle:back")]]["active"] == 1
    new = [r for r in after.values() if r["source_ref"] == "wisdom:principle:new"]
    assert len(new) == 1 and new[0]["priority"] == 3 and new[0]["knowledge_epoch"] == "2026"
    assert new[0]["source"] == "wisdom"
    # the manual row with a colliding source_ref is untouched
    collision = before[by_ref[("manual", "wisdom:principle:keep")]]
    assert after[collision["id"]] == collision
    assert len(after) == len(before) + 1
    backup = pathlib.Path(out["backup"])
    assert backup.exists()
    assert sqlite3.connect(backup).execute("SELECT COUNT(*) FROM knowledge_base").fetchone()[0] == len(before)
    assert out["plan"]["insert"] == 1 and out["after"]["wisdom_active"] == 3


def test_a_run_past_the_deadline_never_starts(engine_kb, tmp_path):
    before = hashlib.sha256(engine_kb.read_bytes()).hexdigest()
    with pytest.raises(sync.SyncAborted, match="20:55"):
        sync.run_sync(str(engine_kb), _standard_export(), commit=True, now=LATE, backup_dir=str(tmp_path / "bk"))
    assert hashlib.sha256(engine_kb.read_bytes()).hexdigest() == before


def test_a_deadline_reached_mid_run_rolls_back(engine_kb, tmp_path):
    before = _kb(engine_kb)
    with pytest.raises(sync.SyncAborted, match="rolled back"):
        sync.run_sync(str(engine_kb), _standard_export(), commit=True, now=EARLY, clock=lambda: LATE,
                      backup_dir=str(tmp_path / "bk"))
    assert _kb(engine_kb) == before


def test_legacy_rows_are_deactivated_only_from_a_reviewed_plan_with_the_flag(engine_kb, tmp_path):
    legacy_ids = [kb_id for kb_id, r in _kb(engine_kb).items() if r["trader"] == "Bonde"]
    out = sync.run_sync(str(engine_kb), _standard_export(), commit=True, now=EARLY, clock=lambda: EARLY,
                        backup_dir=str(tmp_path / "bk"), legacy_ids=legacy_ids)
    assert out["plan"]["legacy_deactivate"] == 0
    assert all(_kb(engine_kb)[i]["active"] == 1 for i in legacy_ids)
    out = sync.run_sync(str(engine_kb), _standard_export(), commit=True, now=EARLY, clock=lambda: EARLY,
                        backup_dir=str(tmp_path / "bk"), legacy_ids=legacy_ids, apply_legacy=True)
    assert out["plan"]["legacy_deactivate"] == 3
    after = _kb(engine_kb)
    assert all(after[i]["active"] == 0 for i in legacy_ids) and len(after) >= 7
    # §8c.3: the ONE write that touches a row Wisdom did not author is marked too, so an
    # audit of the KB can see who retired it — and marked ONCE, not once per re-run.
    for kb_id in legacy_ids:
        found = sync.provenance.find_all(after[kb_id]["content"])
        assert len(found) == 1 and found[0]["ref"] == f"knowledge_base:{kb_id}", after[kb_id]["content"]
    sync.run_sync(str(engine_kb), _standard_export(), commit=True, now=EARLY, clock=lambda: EARLY,
                  backup_dir=str(tmp_path / "bk2"), legacy_ids=legacy_ids, apply_legacy=True)
    again = _kb(engine_kb)
    assert all(len(sync.provenance.find_all(again[i]["content"])) == 1 for i in legacy_ids)


def test_an_export_row_without_a_provenance_marker_is_refused(engine_kb):
    """§8c.3 runtime guard. MUTATION: strip the marker; the whole sync must abort, because a
    KB row with no marker is a row the shape-based audit can never find again."""
    bare = _row("wisdom:principle:new", "New", content="Source: wisdom:srcX#segX@1s\nbody")
    assert not sync.provenance.is_marked(bare["content"])
    with pytest.raises(sync.SyncAborted, match="marker"):
        sync.run_sync(str(engine_kb), _export([bare]))
    # control: the same row WITH the marker is accepted
    assert sync.run_sync(str(engine_kb), _export([_row("wisdom:principle:new", "New")]))["dry_run"] is True


def test_an_export_with_a_bad_hash_or_priority_is_refused(engine_kb):
    bad = _row("wisdom:principle:new", "New")
    bad["title"] = "tampered"
    with pytest.raises(sync.SyncAborted, match="hash"):
        sync.run_sync(str(engine_kb), _export([bad]))
    loud = _row("wisdom:principle:new", "New", priority=1)
    with pytest.raises(sync.SyncAborted, match="priority"):
        sync.run_sync(str(engine_kb), _export([loud]))
    with pytest.raises(sync.SyncAborted, match="source_ref"):
        sync.run_sync(str(engine_kb), _export([_row("principle:new", "No prefix")]))


def test_the_diff_report_is_read_only_and_groups_the_stale_rows(engine_kb):
    before = hashlib.sha256(engine_kb.read_bytes()).hexdigest()
    items = sync.diff_report(str(engine_kb), _standard_export())
    assert [i["subject_ref"] for i in items] == ["engine_kb:sunday_scans_intake:Bonde"]
    assert items[0]["old"]["count"] == 3 and items[0]["tab"] == "attribution"
    assert hashlib.sha256(engine_kb.read_bytes()).hexdigest() == before


def _statements(sql: str) -> str:
    """Executable SQL only: a comment that SAYS "no DELETE" is not a DELETE."""
    return "\n".join(line.split("--", 1)[0] for line in sql.splitlines())


def test_the_archive_plan_is_text_and_contains_no_delete():
    sql = sync.archive_plan_sql([3, 1, 2])
    assert "IN (1, 2, 3)" in sql and "knowledge_base_archive" in sql
    assert not re.search(r"\bDELETE\b|\bDROP\b", _statements(sql))
    # control: the same check does catch a planted statement
    assert re.search(r"\bDELETE\b|\bDROP\b", _statements(sql + "DELETE FROM knowledge_base WHERE id = 1;\n"))
