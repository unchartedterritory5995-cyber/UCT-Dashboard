"""What a rollback of the wave 12-15 landing must never take with it, and why.

The procedure is docs/notebook/landing-12-15-rollback.md; the tool is
tools/notebook_rollback_chain.py (`--landing`). This file is on that landing's keep-list
(KEEP_WITH_LANDING), so it runs unchanged on the tip AND on the rolled-back tree: it imports
nothing the landing added, and creates the tables it needs itself.

Two facts are pinned here, each with the case that would lose member data beside the case
that keeps it.

1. `widgetEmbed.ta` (a chart's setup tag, frozen fingerprint and plan block).
   Established by reading the save path, then measured below:
     * the SERVER stores a note body as it is handed. It does not validate attributes and
       does not strip one it does not know (`test_the_server_stores_an_attribute_it_does_not_know`);
     * the only thing between an older editor and a ta-bearing note is the attribute table in
       notebook_schema.py. A server WITHOUT that table (the pre-landing server, which is what a
       whole-merge revert brings back) answers 200 to a save that no longer carries `ta`, and
       the plan data is gone with no error anywhere
       (`test_a_server_without_the_attribute_table_ACCEPTS_the_save_and_the_plan_data_is_gone`);
     * with the table kept, the same save is refused and the note is byte-identical
       (`test_with_the_table_kept_the_same_save_is_REFUSED_and_the_note_is_byte_identical`).
   The client half (an editor without the attribute drops it at parse time) is pinned in
   app/src/pages/journal-2-0/lib/notebookSchema.rail.test.js.

2. `account_purge.py`. The landing adds twelve tables to the account-deletion list. A revert
   leaves the tables and the rows in the database; a reverted list would leave those rows
   behind when the member deletes their account.

Every assertion over a shell-out or a query has a non-vacuity control.
"""
from __future__ import annotations

import ast
import importlib.util
import json
import shutil
import sqlite3
import subprocess
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import auth_db
from api.services.journal_two import account_purge as ap
from api.services.journal_two import notebook_schema as nbs
from api.services.journal_two.db import ensure_schema as j2_ensure_schema

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "notebook_rollback_chain.py"
SCHEMA_PY = "api/services/journal_two/notebook_schema.py"
HEADER = nbs.NOTEBOOK_SCHEMA_HEADER

TA = {"v": 1, "setupTag": "Breakout", "planBlock": {"shares": 200, "sizedBy": "starter"}}
TA_BODY = {"type": "doc", "content": [
    {"type": "paragraph", "content": [{"type": "text", "text": "NVDA plan"}]},
    {"type": "widgetEmbed", "attrs": {"widgetId": "chart", "params": {"symbol": "NVDA"}, "ta": TA}},
]}


def _without_ta(body: dict) -> dict:
    """What an editor that does not know the attribute saves: the same note, `ta` gone."""
    stripped = json.loads(json.dumps(body))
    stripped["content"][1]["attrs"].pop("ta")
    return stripped


def _load_tool():
    spec = importlib.util.spec_from_file_location("nb_rollback_chain_keep", TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── the keep-list itself ──────────────────────────────────────────────────────

NEVER_REVERT = (
    "api/services/journal_two/notebook_schema.py",
    "app/src/pages/journal-2-0/lib/notebookSchema.js",
    "tests/test_notebook_schema_guard.py",
    "app/src/pages/journal-2-0/lib/notebookSchema.rail.test.js",
)
KEPT_WITH_THIS_LANDING = (
    "api/services/journal_two/account_purge.py",
    "tests/test_journal_two_account_purge.py",
    "tests/test_notebook_rollback_never_revert.py",
)


def test_the_tool_keeps_both_schema_files_their_two_rails_and_the_purge_list():
    tool = _load_tool()
    assert set(NEVER_REVERT) <= set(tool.KEEP_AT_TIP), sorted(set(NEVER_REVERT) - set(tool.KEEP_AT_TIP))
    kept = tool.KEEP_WITH_LANDING[tool.LANDING_12_15]
    assert set(KEPT_WITH_THIS_LANDING) <= set(kept), sorted(set(KEPT_WITH_THIS_LANDING) - set(kept))
    # A typed path that names no file keeps nothing, and reads as coverage.
    missing = [p for p in (*tool.KEEP_AT_TIP, *kept) if not (ROOT / p).is_file()]
    assert not missing, f"the keep-list names files that do not exist: {missing}"


# ── 1. `widgetEmbed.ta` through the real note door ─────────────────────────────

@pytest.fixture
def client(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    conn = auth_db.get_connection()
    j2_ensure_schema(conn)
    conn.close()
    from api.routers import journal_two as j2_router
    fa = FastAPI()
    fa.include_router(j2_router.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "member"}
    yield TestClient(fa)
    fa.dependency_overrides.clear()


def _note(client, body):
    r = client.post("/api/j2/notes", json={"title": "NVDA plan", "bodyJson": body})
    assert r.status_code == 200, r.text
    return r.json()["note"]


def _stored(note_id: str) -> str:
    conn = auth_db.get_connection()
    try:
        return conn.execute("SELECT body_json FROM j2_notes WHERE id = ?", (note_id,)).fetchone()[0]
    finally:
        conn.close()


def _stored_embed_attrs(note_id: str) -> dict:
    return json.loads(_stored(note_id))["content"][1]["attrs"]


def test_the_server_stores_an_attribute_it_does_not_know(client):
    """KEEP, on the server: the body is stored as handed. No validator drops or refuses an
    attribute the server has no row for -- so nothing on the server alone protects `ta`."""
    body = json.loads(json.dumps(TA_BODY))
    body["content"][1]["attrs"]["notARealAttribute"] = {"kept": True}
    note = _note(client, body)
    attrs = _stored_embed_attrs(note["id"])
    assert attrs["notARealAttribute"] == {"kept": True}
    assert attrs["ta"] == TA


def test_with_the_table_kept_the_same_save_is_REFUSED_and_the_note_is_byte_identical(client):
    """The rolled-back tree with the keep-list kept. Its editor does not know `ta`, so it
    declares 3 and sends the note without it; the kept table makes the server refuse."""
    assert nbs.NOTEBOOK_ATTR_SCHEMA.get("widgetEmbed.ta") == 4
    note = _note(client, TA_BODY)
    before = _stored(note["id"])
    assert json.loads(before)["content"][1]["attrs"]["ta"] == TA            # non-vacuity
    for declared in (None, "3"):
        r = client.put(f"/api/j2/notes/{note['id']}", headers={HEADER: declared} if declared else {},
                       json={"bodyJson": _without_ta(TA_BODY), "baseUpdatedAt": note["updatedAt"]})
        assert r.status_code == 409, (declared, r.text)
        assert r.json()["detail"] == nbs.REFUSAL_DETAIL
    assert _stored(note["id"]) == before


def test_a_server_without_the_attribute_table_ACCEPTS_the_save_and_the_plan_data_is_gone(client, monkeypatch):
    """⛔ The whole-merge revert, measured at the door. Take the attribute rows away (that is
    the entire difference between the pre-landing validator and this one: see the test below,
    which runs the pre-landing file itself) and the SAME request is answered 200. The note no
    longer holds the member's setup tag or plan block, and nothing reported an error."""
    note = _note(client, TA_BODY)
    assert _stored_embed_attrs(note["id"])["ta"] == TA                      # non-vacuity
    monkeypatch.setattr(nbs, "_ATTRS_BY_TYPE", {})
    assert nbs.required_schema(TA_BODY) <= 3
    r = client.put(f"/api/j2/notes/{note['id']}", headers={HEADER: "3"},
                   json={"bodyJson": _without_ta(TA_BODY), "baseUpdatedAt": note["updatedAt"]})
    assert r.status_code == 200, r.text
    assert "ta" not in _stored_embed_attrs(note["id"])


def _pre_landing_schema_source() -> str | None:
    """notebook_schema.py as it was before the commit that added the attribute table, read from
    git. None when this clone cannot answer (no git, or a clone cut above that commit)."""
    git = shutil.which("git")
    if not git:
        return None
    log = subprocess.run([git, "-C", str(ROOT), "log", "--format=%H", "-SNOTEBOOK_ATTR_SCHEMA", "--", SCHEMA_PY],
                         capture_output=True, text=True, encoding="utf-8")
    shas = log.stdout.split()
    if log.returncode != 0 or not shas:
        return None
    first = shas[-1]                                    # oldest commit that changed its count
    show = subprocess.run([git, "-C", str(ROOT), "show", f"{first}^:{SCHEMA_PY}"],
                          capture_output=True, text=True, encoding="utf-8")
    return show.stdout if show.returncode == 0 and show.stdout.strip() else None


def test_the_PRE_LANDING_validator_itself_does_not_refuse_a_level_3_write_to_a_ta_note():
    """Not a stand-in: the file a whole revert restores, executed. It has no attribute table,
    so it asks nothing newer than 3 of a ta-bearing note and lets a level-3 client overwrite it."""
    src = _pre_landing_schema_source()
    if src is None:
        pytest.skip("git history before the attribute table is not in this clone "
                    "(the door test above measures the same behaviour without it)")
    old: dict = {"__name__": "pre_landing_notebook_schema"}
    exec(compile(src, "pre_landing_notebook_schema.py", "exec"), old)   # noqa: S102 -- our own file
    assert "NOTEBOOK_ATTR_SCHEMA" not in old, "this is not the pre-landing file"
    assert "tradeCanvas" in old["NOTEBOOK_TYPE_SCHEMA"]                    # non-vacuity: a real table
    stored = json.dumps(TA_BODY)
    assert old["required_schema"](stored) <= 3 < nbs.required_schema(stored) == 4
    old["check_body_write"](stored, 3)                                    # does not raise
    with pytest.raises(nbs.NotebookSchemaTooOld):
        nbs.check_body_write(stored, 3)


# ── 2. the account-deletion list ───────────────────────────────────────────────

LANDING_TABLES = (
    "j2_trade_plan_links",
    "j2_template_gallery", "j2_template_gallery_reports", "j2_template_gallery_uses",
    "j2_chart_blocks", "j2_chart_fingerprints",
    "j2_entry_context", "j2_entry_context_bell_log",
    "j2_passed_setups",
    "j2_note_levels", "j2_note_resurface_fires",
    "j2_similar_matches",
)


GALLERY_CHILD_TABLES = ("j2_template_gallery_reports", "j2_template_gallery_uses")


def _db_with_the_landing_tables() -> sqlite3.Connection:
    """The database a rollback leaves behind: the twelve tables exist and hold rows, whatever
    the code that created them looks like now. Minimal DDL on purpose -- the purge keys on
    `user_id`, and this file must not import the landing's modules. The one other column it
    reads is `gallery_id` on the two gallery child tables: the security lane's M-7 also removes
    what OTHER members recorded about the leaving member's templates, by that column
    (account_purge.py, "about_their_templates"). Left NULL here, so that pass matches nothing
    and every count below is still the direct `user_id` pass."""
    conn = sqlite3.connect(":memory:")
    for table in LANDING_TABLES:
        extra = ", gallery_id TEXT" if table in GALLERY_CHILD_TABLES else ""
        conn.execute(f'CREATE TABLE "{table}" (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, v TEXT{extra})')
        conn.executemany(f'INSERT INTO "{table}" (user_id, v) VALUES (?, ?)',
                         [("member-leaving", "theirs"), ("member-staying", "not theirs")])
    conn.commit()
    return conn


def _rows(conn, user_id: str) -> dict[str, int]:
    return {t: conn.execute(f'SELECT COUNT(*) FROM "{t}" WHERE user_id = ?', (user_id,)).fetchone()[0]
            for t in LANDING_TABLES}


def test_the_deletion_list_names_all_twelve_tables_the_landing_added():
    assert len(set(LANDING_TABLES)) == 12
    missing = [t for t in LANDING_TABLES if t not in ap._DIRECT_USER_TABLES]
    assert not missing, f"account deletion no longer clears: {missing}"


def test_a_deleted_members_rows_leave_all_twelve_tables_and_nobody_elses_do():
    conn = _db_with_the_landing_tables()
    assert set(_rows(conn, "member-leaving").values()) == {1}                # non-vacuity
    report = ap.purge_user_rows("member-leaving", conn)
    assert report["errors"] == [], report["errors"]
    assert set(_rows(conn, "member-leaving").values()) == {0}, _rows(conn, "member-leaving")
    assert set(_rows(conn, "member-staying").values()) == {1}, _rows(conn, "member-staying")
    assert all(report["rows_deleted"][t] == 1 for t in LANDING_TABLES)


def test_a_list_without_those_rows_leaves_the_members_data_behind(monkeypatch):
    """⛔ What a reverted account_purge.py does on a database the landing has written to."""
    conn = _db_with_the_landing_tables()
    monkeypatch.setattr(ap, "_DIRECT_USER_TABLES",
                        tuple(t for t in ap._DIRECT_USER_TABLES if t not in LANDING_TABLES))
    report = ap.purge_user_rows("member-leaving", conn)
    assert report["errors"] == []
    assert set(_rows(conn, "member-leaving").values()) == {1}


def test_a_pod_that_never_created_those_tables_is_a_quiet_no_op():
    """The other half of keeping the list: on a database where a table was never created
    (the gallery tables on a pod that booted only reverted code), naming it must not fail."""
    conn = sqlite3.connect(":memory:")
    report = ap.purge_user_rows("member-leaving", conn)
    assert report["errors"] == [], report["errors"]
    assert all(report["rows_deleted"][t] == 0 for t in LANDING_TABLES)


def test_every_module_the_kept_purge_imports_exists_in_this_tree():
    """A file kept at the tip while its neighbours are reverted may import a module the revert
    removed. Read the imports off the file (never a typed list) and resolve each one here --
    on the rolled-back tree this is the proof that keeping it is safe."""
    src = (ROOT / "api/services/journal_two/account_purge.py").read_text(encoding="utf-8")
    wanted: list[str] = []
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("api."):
            for alias in node.names:
                child = f"{node.module}.{alias.name}"
                wanted.append(child if importlib.util.find_spec(node.module) is not None
                              and _is_module(child) else node.module)
        elif isinstance(node, ast.Import):
            wanted += [a.name for a in node.names if a.name.startswith("api.")]
    assert len(wanted) >= 3, f"non-vacuity: the purge's own imports were not found ({wanted})"
    absent = sorted({m for m in wanted if importlib.util.find_spec(m) is None})
    assert not absent, f"account_purge.py imports modules this tree does not have: {absent}"


def _is_module(dotted: str) -> bool:
    try:
        return importlib.util.find_spec(dotted) is not None
    except (ImportError, ValueError):
        return False
