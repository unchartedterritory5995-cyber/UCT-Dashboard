"""⭐⭐ THE `requirements` COLUMN, AND THE THREE THINGS A MIGRATION MUST BE.

SQLite has no `ADD COLUMN IF NOT EXISTS`, and `api/main.py` calls `_init_db()`
on EVERY boot — so a deploy runs this migration again on every restart. It has
to be a no-op the second time, it has to leave existing rows alone, and its
default has to be the TRUE value for history rather than a convenient one.

⛔ THE DEFAULT IS PROVABLE, NOT ASSUMED, and the last case here is what proves
it: the only tag that exists is set by `ta.cum`, and `translatePine` refuses
`ta.cum` in both modes, so no stored definition can carry it. `'[]'` is
therefore correct for every pre-existing row rather than merely harmless. A
future tag whose builtin was ALREADY callable would need a backfill pass, not a
default — the safe direction for this column is MORE tags.
"""

import json
import sqlite3
import time

import pytest


OLD_SHAPE = """
CREATE TABLE user_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, def_id TEXT NOT NULL,
  version INTEGER NOT NULL, rev INTEGER NOT NULL, ast_hash TEXT NOT NULL,
  definition TEXT NOT NULL, repaint TEXT NOT NULL, deleted_at INTEGER,
  created_at INTEGER NOT NULL, UNIQUE(user_id, def_id, version));
"""


def _old_db(path, rows=5):
    c = sqlite3.connect(path)
    c.executescript(OLD_SHAPE)
    now = int(time.time())
    for i in range(rows):
        c.execute(
            "INSERT INTO user_definitions (user_id,def_id,version,rev,ast_hash,"
            "definition,repaint,created_at) VALUES (?,?,?,?,?,?,?,?)",
            (f"u{i}", f"u_{i:012x}", 1, 1, f"hash{i}",
             json.dumps({"compute": {"ast": {"type": "call", "name": "sma", "args": []}}}),
             "{}", now))
    c.commit()
    return c


def _cols(c):
    return [r[1] for r in c.execute("PRAGMA table_info(user_definitions)")]


@pytest.fixture()
def db(tmp_path, monkeypatch):
    """A synthetic database in pytest's own tmp_path.

    ⛔ NEVER THE SHARED ROOT. `C:\\data` exists on the dev box and the repo-root
    conftest's tripwire is what stops a stray write reaching the owner's live
    files; this fixture stays inside `tmp_path` so the tripwire never has to.
    """
    from api.services import user_definitions as ud
    path = str(tmp_path / "user_definitions.db")
    monkeypatch.setattr(ud, "_DB_PATH", path)
    return path, ud


def test_it_ADDS_the_column_to_an_old_database(db):
    path, ud = db
    c = _old_db(path)
    assert "requirements" not in _cols(c)
    before = c.execute("SELECT COUNT(*) FROM user_definitions").fetchone()[0]
    c.close()

    ud._init_db()

    c = sqlite3.connect(path)
    assert "requirements" in _cols(c)
    assert c.execute("SELECT COUNT(*) FROM user_definitions").fetchone()[0] == before


def test_it_is_IDEMPOTENT_because_every_boot_runs_it(db):
    """⛔ `api/main.py` calls `_init_db()` unconditionally at startup, so the
    second run is not hypothetical — it happens on the next restart."""
    path, ud = db
    _old_db(path).close()
    ud._init_db()
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    assert ud._migrate(c) == [], "a second run must add nothing"
    c.close()
    ud._init_db()
    ud._init_db()
    c = sqlite3.connect(path)
    assert _cols(c).count("requirements") == 1


def test_existing_rows_are_UNTOUCHED_apart_from_the_new_default(db):
    path, ud = db
    c = _old_db(path, rows=6)
    before = [tuple(r) for r in c.execute(
        "SELECT id,user_id,def_id,version,rev,ast_hash,definition,repaint,created_at"
        " FROM user_definitions ORDER BY id")]
    c.close()

    ud._init_db()

    c = sqlite3.connect(path)
    after = [tuple(r) for r in c.execute(
        "SELECT id,user_id,def_id,version,rev,ast_hash,definition,repaint,created_at"
        " FROM user_definitions ORDER BY id")]
    assert after == before, "the migration may not rewrite a single existing value"
    assert {r[0] for r in c.execute("SELECT requirements FROM user_definitions")} == {"[]"}


def test_a_FRESH_database_gets_the_column_from_the_schema_not_the_migration(db):
    """⭐ THE OTHER DIRECTION. A new deploy creates the table from `_SCHEMA`; the
    migration exists only for databases that predate the column."""
    path, ud = db
    ud._init_db()
    c = sqlite3.connect(path)
    assert "requirements" in _cols(c)
    c.row_factory = sqlite3.Row
    assert ud._migrate(c) == []


def test_the_EMPTY_DEFAULT_IS_TRUE_FOR_HISTORY_and_here_is_why(db):
    """⛔⛔ THE CLAIM THE BACKFILL RESTS ON, ASSERTED RATHER THAN TRUSTED.

    `'[]'` is only correct because no stored definition CAN carry the one tag
    that exists. That holds while every builtin listed in
    `_requirement_tags` is refused by the translator. If a future tag names a
    builtin that already ships, this test fails and whoever added it owes a
    backfill pass instead of a default.
    """
    from api.services import ast_table
    from api.services.user_definitions import requirement_tags

    tagged = set()
    for spec in (ast_table.TABLE.get("_requirement_tags") or {}).values():
        if hasattr(spec, "get"):
            tagged |= set(spec.get("calls") or ())
    assert tagged, "the manifest must declare at least one tagged call"

    # Every tagged builtin must be absent from the shipped function table — that
    # is what makes it unreachable from a saved definition today.
    declared = set(ast_table.TABLE["functions"])
    leaked = tagged & declared
    assert not leaked, (
        f"{sorted(leaked)} is BOTH tagged as needing containment AND callable "
        "from the shipped table — stored definitions may already contain it, so "
        "the '[]' default is no longer provably correct and this column needs a "
        "backfill pass over history")

    # And a definition using one really would be tagged, so the mechanism is live.
    name = sorted(tagged)[0]
    assert requirement_tags(
        {"compute": {"ast": {"type": "call", "name": name, "args": []}}}) != []
