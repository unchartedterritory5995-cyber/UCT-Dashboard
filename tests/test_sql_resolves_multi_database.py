"""The rail under `tools/sql_resolves.py` — and the case it exists for is case 2.

⚰️ **F-OI21-1.** A check resolved four telemetry queries against `auth.db` alone and
reported two of their tables as absent from the product. Both exist, in other files
(`ai_search_log.db`, `calendar_alerts.db`). It was filed as a finding, and the work it
implied was to annotate two sound S6 decisions "UNSIZED until re-measured."

⛔ **A single-database resolver passes almost every test anyone would write for this
tool.** `test_a_single_database_resolver_would_get_this_wrong` is the discriminator:
it rebuilds the defect and asserts the defect's answer differs, so this file cannot
go green for the wrong reason.

⛔ Nothing here touches `/data` or any real database. Every fixture is `:memory:`.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sqlite3
import subprocess
import sys

import pytest

_TOOL = pathlib.Path(__file__).resolve().parents[1] / "tools" / "sql_resolves.py"


def _load():
    spec = importlib.util.spec_from_file_location("sql_resolves_rail", str(_TOOL))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R = _load()

#: Two databases. The interesting table is in the SECOND one, which is the whole point.
FIRST = ["CREATE TABLE page_views (user_id TEXT, path TEXT)"]
SECOND = ["CREATE TABLE ai_search_log (id INTEGER, q TEXT)"]


@pytest.fixture()
def conns():
    c, _ = R.replicas({"auth.db": FIRST, "ai_search_log.db": SECOND})
    yield c
    for con in c.values():
        con.close()


# ── the population, before any assertion about it ───────────────────────────

def test_the_fixture_has_more_than_one_database(conns):
    """⛔ NON-VACUITY. Every case below is meaningless against a one-database fixture,
    and a one-database fixture is exactly what the defect looked like."""
    assert len(conns) == 2
    assert any(con.execute(
        "SELECT name FROM sqlite_master WHERE name='ai_search_log'").fetchone()
        for con in conns.values())


# ── case 1: it resolves, and it says where ──────────────────────────────────

def test_a_table_in_the_second_database_resolves_and_is_attributed(conns):
    r = R.resolve_one("SELECT COUNT(*) FROM ai_search_log", conns)
    assert r["verdict"] == R.RESOLVES, r
    assert r["db"] == "ai_search_log.db", "the answer must NAME the file, not just say yes"


# ── case 2: the discriminator ───────────────────────────────────────────────

def test_a_single_database_resolver_would_get_this_wrong(conns):
    """⭐ THE CASE THIS FILE EXISTS FOR.

    Rebuild the defect — consult only the first database — and assert it answers
    differently. If this ever stops being true, either the fixture has collapsed to
    one database or `resolve_one` has stopped consulting more than one, and every
    other assertion here is passing for free.
    """
    only_first = dict(list(conns.items())[:1])
    defective = R.resolve_one("SELECT COUNT(*) FROM ai_search_log", only_first)
    correct = R.resolve_one("SELECT COUNT(*) FROM ai_search_log", conns)
    assert defective["verdict"] == R.MISSING
    assert correct["verdict"] == R.RESOLVES
    assert defective["verdict"] != correct["verdict"]


# ── case 3: a real absence is still reported, by name ───────────────────────

def test_a_table_in_no_database_is_missing_and_is_named(conns):
    r = R.resolve_one("SELECT * FROM a_table_nothing_has", conns)
    assert r["verdict"] == R.MISSING
    assert r["detail"] == "a_table_nothing_has"


def test_a_missing_column_of_a_real_table_is_caught_at_prepare_time(conns):
    assert R.resolve_one("SELECT nope FROM page_views", conns)["verdict"] == R.MISSING


# ── case 4: the third state ─────────────────────────────────────────────────

def test_unpreparable_is_never_reported_as_missing(conns):
    """⛔ 'we could not check it' and 'it is broken' are different facts. Collapsing
    them is how the last finding got filed."""
    r = R.resolve_one("SELECT FROM WHERE ((", conns)
    assert r["verdict"] == R.UNPREPARABLE
    assert r["verdict"] != R.MISSING


def test_zero_schemas_is_unpreparable_and_says_so():
    r = R.resolve_one("SELECT 1 FROM page_views", {})
    assert r["verdict"] == R.UNPREPARABLE
    assert "no schemas" in r["detail"]


# ── case 5: a pre-migration copy is not evidence that a table is live ───────

def test_a_live_file_beats_a_backup_in_attribution():
    c, _ = R.replicas({"auth.db": FIRST,
                       "backups/auth-2026-09-12-pre-smoke.db": FIRST + SECOND})
    assert R.resolve_one("SELECT COUNT(*) FROM page_views", c)["db"] == "auth.db"


def test_a_table_only_in_a_backup_is_its_own_verdict():
    c, _ = R.replicas({"auth.db": FIRST,
                       "backups/auth-2026-09-12-pre-smoke.db": FIRST + SECOND})
    r = R.resolve_one("SELECT COUNT(*) FROM ai_search_log", c)
    assert r["verdict"] == R.BACKUP_ONLY, "a snapshot taken before a migration is not " \
                                          "evidence that a table is still live"
    assert r["db"].startswith("backups/")


@pytest.mark.parametrize("key,expect", [
    ("auth.db", False),
    ("calendar_alerts.db", False),
    ("brain/data/uct_intelligence.db", False),
    ("backups/auth-2026-09-12-pre-smoke-account.db", True),
    ("education.pre-taxonomy-20260726.db", True),
    ("user_definitions.pre-requirements.20260909T032141Z.db", True),
])
def test_the_backup_classifier_answers_in_both_directions(key, expect):
    """⛔ A classifier that answered 'backup' to everything would pass the two cases
    above. It has to be wrong about a live file for those to mean anything."""
    assert R.is_backup(key) is expect


# ── case 6: extraction cannot see what it never looks for ───────────────────

def test_english_with_is_not_mistaken_for_a_cte(tmp_path):
    """`WITH` is a preposition. Eight prose lines came back UNPREPARABLE before this
    test existed, and an 'unchecked' column full of prose gets an instrument muted."""
    d = tmp_path / "docs"
    d.mkdir()
    (d / "a.md").write_text(
        "Ships `with a partial result set from the sweep` today.\n\n"
        "```sql\nWITH recent AS (SELECT id FROM users) SELECT * FROM recent\n```\n",
        encoding="utf-8")
    found = R.queries_in(d)
    assert len(found) == 1, found
    assert found[0]["sql"].lower().startswith("with recent as")


def test_a_query_outside_a_sql_fence_is_still_found(tmp_path):
    """⛔ AN ABSENCE IS ONLY EVIDENCE IF THE INSTRUMENT COULD HAVE SEEN A PRESENCE.
    Of 241 fenced blocks in the research corpus, 171 carry no language tag and 8 say
    `sql`. Reading `sql` fences alone found ONE query in the whole corpus."""
    d = tmp_path / "docs"
    d.mkdir()
    (d / "b.md").write_text(
        "The probe runs `SELECT pref_key FROM user_preferences WHERE user_id = ?`.\n\n"
        "```\nSELECT id FROM users\n```\n", encoding="utf-8")
    srcs = sorted(q["src"] for q in R.queries_in(d))
    assert srcs == ["fence:untagged", "inline"], srcs


def test_select_the_english_verb_is_not_a_query(tmp_path):
    d = tmp_path / "docs"
    d.mkdir()
    (d / "c.md").write_text(
        "Do not `select the most complicated architecture available`.\n", encoding="utf-8")
    assert R.queries_in(d) == []


# ── case 6b: the tool must not read its OWN report as a query ───────────────

def test_a_quoted_report_from_this_tool_is_skipped_and_the_skip_is_named(tmp_path):
    """⚰️ THE FIFTH INSTRUMENT-SELF-REFERENCE INSTANCE IN TWO DAYS, and it happened
    inside the packet documenting the fourth: `packet-b-schema-resolution-gate.md`
    quotes a run of this tool, and the extractor read the quoted verdict lines as a
    candidate query. The fix is the instrument, never the prose that explains it."""
    d = tmp_path / "docs"
    d.mkdir()
    (d / "packet.md").write_text(
        "The run:\n\n```\n"
        "[sql-resolves] databases: 73\n"
        "RESOLVES     docs/x.md:12 [inline]  -> auth.db\n"
        "             SELECT id FROM users\n"
        "```\n", encoding="utf-8")
    assert R.queries_in(d) == []
    skipped = R.R_SKIPPED()
    assert len(skipped) == 1 and "packet.md" in skipped[0], skipped


def test_the_skip_does_not_swallow_a_block_that_merely_says_MISSING(tmp_path):
    """⛔ THE OTHER DIRECTION, and it is the one that bites. An untightened guard
    skipped a block in `packet-c-...-gate.md` whose control line reads
    "MISSING file -> exit 2 ok" — a different tool's output. A skip that is too eager
    hides real queries, and hiding them is exactly the failure this file is about."""
    d = tmp_path / "docs"
    d.mkdir()
    (d / "other.md").write_text(
        "```\n"
        "MISSING file      -> exit 2 ok\n"
        "SELECT id FROM users\n"
        "```\n", encoding="utf-8")
    found = R.queries_in(d)
    assert [q["sql"] for q in found] == ["SELECT id FROM users"], found
    assert R.R_SKIPPED() == []


# ── case 7: nothing here reads a real database ──────────────────────────────

def _executed_sql(src: str, fn_name: str) -> list:
    """Every string literal this function hands to `.execute(...)`, via the AST.

    ⛔ CODE, NEVER PROSE. v1 of this check searched the function's TEXT for "DROP" and
    matched the word "dropped" in the comment `unreadable is RECORDED, never dropped
    silently` — refusing a correct implementation because of a sentence explaining it.
    Six instances of exactly that shape are recorded in this repo's CLAUDE.md. An AST
    excludes comments by construction.
    """
    import ast
    tree = ast.parse(src)
    out = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.FunctionDef) and node.name == fn_name):
            continue
        for sub in ast.walk(node):
            if (isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute)
                    and sub.func.attr == "execute"):
                for arg in sub.args[:1]:
                    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                        out.append(arg.value)
    return out


def test_the_schema_reader_only_ever_executes_a_read_of_sqlite_master():
    """The pod half must not be ABLE to write. Checked on what it executes, not on
    what its comments say."""
    src = _TOOL.read_text(encoding="utf-8")
    stmts = _executed_sql(src, "read_schema_manifest")
    assert stmts, "control: the probe found no executed SQL at all, so it proves nothing"
    for sql in stmts:
        assert sql.strip().upper().startswith("SELECT"), sql
        assert "sqlite_master" in sql, sql
    assert "?mode=ro" in src[src.index("def read_schema_manifest"):
                             src.index("def replicas")]


def test_the_ast_probe_can_still_see_a_write():
    """⛔ POSITIVE CONTROL. A probe that finds nothing passes the case above for free."""
    dirty = (
        "def read_schema_manifest(root):\n"
        "    con = None\n"
        "    con.execute('DELETE FROM users')\n"
    )
    stmts = _executed_sql(dirty, "read_schema_manifest")
    assert stmts == ["DELETE FROM users"]
    assert not stmts[0].strip().upper().startswith("SELECT")


def test_the_ast_probe_is_not_fooled_by_a_comment():
    """⛔ THE NEGATIVE CONTROL FOR THE SAME THING: prose naming a write is not a write."""
    clean = (
        "def read_schema_manifest(root):\n"
        "    # never DELETE, never DROP, never INSERT\n"
        "    con = None\n"
        "    con.execute('SELECT sql FROM sqlite_master')\n"
    )
    assert _executed_sql(clean, "read_schema_manifest") == ["SELECT sql FROM sqlite_master"]


def test_the_tools_own_self_check_passes():
    """⛔ A check nobody runs is not a check. This is the one that puts the tool's
    controls on the same schedule as the suite."""
    out = subprocess.run([sys.executable, str(_TOOL), "--self-check"],
                         capture_output=True, text=True, encoding="utf-8",
                         errors="replace")
    assert out.returncode == 0, out.stdout + out.stderr
    assert "SELF-CHECK: PASS" in out.stdout
    assert "WRONG" not in out.stdout


def test_sqlite3_is_the_thing_actually_asked(conns):
    """A sanity control on the mechanism itself: EXPLAIN really does fail at prepare
    time for a missing name, so the verdicts above are SQLite's opinion, not ours."""
    con = sqlite3.connect(":memory:")
    with pytest.raises(sqlite3.OperationalError):
        con.execute("EXPLAIN SELECT * FROM definitely_not_here")
    con.close()
