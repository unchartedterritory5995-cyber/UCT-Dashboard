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
    """⛔⛔ THE CLAIM THE BACKFILL RESTS ON — AND ITS FIRST PROOF HAS EXPIRED.

    ⚰️ THIS TEST USED TO PROVE THE DEFAULT FROM THE TABLE: no tagged call was
    DECLARED, so no stored definition could carry a tag, so `'[]'` was true of
    every pre-existing row. Its own words were *"if a future tag names a builtin
    that already ships, this test fails and whoever added it owes a backfill pass
    instead of a default"*. On 2026-09-09 `cum` was declared under owner Ruling D
    and this went red exactly as designed. That is the rail working.

    ⭐⭐ AND THE ANSWER IS NOT A BACKFILL, WHICH IS WHY THE PROOF IS REPLACED
    RATHER THAN THE PASS BEING WRITTEN. A backfill exists to repair rows that were
    stored WITHOUT a tag they should have had. No such row can exist:

      1. `save()` stamps `requirements` on EVERY append, by static analysis, in
         the same transaction as the row — asserted below, end to end.
      2. A row written BEFORE `cum` was declared cannot CONTAIN `cum`. `save()`
         runs `lint_verdict` -> `ast_lint`, which resolves every name against the
         shipped table; an undeclared name is refused at the door. So history is
         not under-tagged, it is tag-FREE, and `'[]'` is its true value.

    ⛔ SO THE INVARIANT MOVED FROM "no tagged call is declared" — a fact about the
    TABLE, which was always going to expire — to "no row is stored unstamped", a
    fact about the WRITE PATH, which is the thing that actually has to hold. The
    new proof is strictly stronger: it drives a real `cum` definition through the
    real `save()`, which the old one could not do because the name did not exist.

    ⚠️ WHAT WOULD STILL OWE A BACKFILL: a tag added to a call that has been
    callable for a while. Then rows predating the TAG carry `'[]'` and should not,
    and (2) above does not save you. The direction to check is the tag's age
    against the call's, not the call against the table.
    """
    from api.services import ast_table
    from api.services.user_definitions import requirement_tags

    # ⛔ THE FIXTURE'S `ud`, NOT A FRESH IMPORT. It is the module with `_DB_PATH`
    # monkeypatched at the sandbox; importing again here would reach the module's
    # own default, which on this box resolves under the shared root.
    _path, ud = db
    ud._init_db()

    tagged = set()
    for spec in (ast_table.TABLE.get("_requirement_tags") or {}).values():
        if hasattr(spec, "get"):
            tagged |= set(spec.get("calls") or ())
    assert tagged, "the manifest must declare at least one tagged call"

    # ── (1) every append is stamped, driven through the real write path ──────
    name = sorted(tagged)[0]
    tree = {"type": "call", "name": name,
            "args": [{"type": "series", "name": "volume"}]}
    doc = {"schemaVersion": 1, "id": "u_0000000000cc", "version": 1,
           "meta": {"name": "Tagged", "shortName": "TAG"},
           "compute": {"kind": "ast", "ast": tree},
           "placement": {"target": "separate"},
           "plots": [{"key": "value", "style": "line", "role": "primary"}],
           "inputs": []}
    row = ud.save("u1", "u_0000000000cc", doc)
    assert row["requirements"] == [name_tag(ast_table.TABLE, name)], (
        "save() did not stamp the tag on a definition that calls a tagged name — "
        "which is the ONLY thing standing between history and an under-tagged row")

    # ⛔ AND THE ROW ON DISK, not just the return value. A stamp computed and not
    # written is the failure this whole column exists to prevent, and the two are
    # separate facts.
    assert ud.get("u1", "u_0000000000cc")["requirements"] == row["requirements"]

    # ── the control: an untagged formula still stamps empty ──────────────────
    plain = dict(doc, id="u_0000000000dd")
    plain["compute"] = {"kind": "ast", "ast": {
        "type": "call", "name": "sma", "args": [
            {"type": "series", "name": "close"}, {"type": "num", "value": 20}]}}
    assert ud.save("u1", "u_0000000000dd", plain)["requirements"] == [], (
        "everything is being tagged — a stamp that fires on every definition "
        "proves nothing about the one that needs it")

    # ── (2) the mechanism is live at the pure-function level too ─────────────
    assert requirement_tags({"compute": {"ast": tree}}) != []


def name_tag(table, call_name):
    """The tag a given call sets, read off the manifest."""
    for tag, spec in (table.get("_requirement_tags") or {}).items():
        if hasattr(spec, "get") and call_name in (spec.get("calls") or ()):
            return tag
    raise AssertionError(f"no tag names {call_name!r}")
