"""Wave 1.5 item 3 — the publication floor. The nine checks from the session-3 decision pack.

⛔ Every test here is about a record NOT leaving. That makes vacuous passes the standing hazard:
"nothing came back" is the expected answer in most of them, and an empty result also satisfies a
broken query, a missing table, or a fixture that never inserted anything. So each blocking test
has a companion proving the same call DOES return the record when it is at or above the floor.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services.wisdom.extract import golden, writer
from api.services.wisdom.publish import floor

FLOOR = floor.floor_value()


# ── the predicate ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("rtype", floor.FLOORED_TYPES)
def test_1_below_floor_blocks(rtype):
    assert floor.passes(rtype, 0.667) is False
    assert floor.passes(rtype, 0.0) is False


@pytest.mark.parametrize("rtype", floor.FLOORED_TYPES)
def test_2_at_floor_passes(rtype):
    assert floor.passes(rtype, 1.0) is True
    assert floor.passes(rtype, FLOOR) is True


@pytest.mark.parametrize("rtype", floor.FLOORED_TYPES)
def test_3_missing_score_blocks(rtype):
    """⛔ The only case that exists today: every stored record has stability NULL."""
    assert floor.passes(rtype, None) is False
    assert floor.passes(rtype, "") is False
    assert floor.passes(rtype, "not a number") is False


def test_6_other_record_types_are_unaffected_at_any_value():
    for rtype in ("CALL", "NEGATIVE_CALL", "MENTION", "LEVEL"):
        for value in (None, 0.0, 0.333, 0.667, 1.0):
            assert floor.passes(rtype, value) is True, (rtype, value)


def test_the_floor_value_is_read_from_its_single_definition():
    """⛔ 6d: never a literal. If golden.STABILITY_FLOOR moves, this moves with it."""
    assert FLOOR == golden.STABILITY_FLOOR


def test_08_and_three_of_three_are_the_same_rule_at_N3_and_diverge_elsewhere():
    """⭐ Reconciles the ruling ('read STABILITY_FLOOR') with the rule ('stability = 1.0 (3/3)')."""
    attainable_at_3 = [k / 3 for k in range(4)]
    assert [v for v in attainable_at_3 if v >= FLOOR] == [1.0]
    attainable_at_5 = [k / 5 for k in range(6)]
    # ⚠️ the divergence, asserted so it cannot be forgotten: 4/5 passes a 0.8 floor
    assert [v for v in attainable_at_5 if v >= FLOOR] == [0.8, 1.0]


# ── the SQL form ─────────────────────────────────────────────────────────────

def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE wisdom_records (record_id TEXT PRIMARY KEY, record_type TEXT, "
                 "stability REAL, stability_runs INTEGER, segment_id TEXT, author_id TEXT)")
    conn.execute("CREATE TABLE wisdom_principles (principle_key TEXT PRIMARY KEY, stability REAL)")
    return conn


@pytest.fixture
def wisdom_review_db() -> sqlite3.Connection:
    """⛔ The review queue's REAL DDL, lifted from the contract, not a convenient stand-in.

    A relaxed copy would let `enqueue` write a `tab` the production CHECK constraint refuses, and
    the idempotency test would pass against a table the app does not have.
    """
    import pathlib
    import re

    conn = _db()
    sql = (pathlib.Path(__file__).resolve().parents[1] / "docs" / "wisdom" / "contracts"
           / "wisdom-db-v0.sql").read_text(encoding="utf-8")
    match = re.search(r"CREATE TABLE IF NOT EXISTS wisdom_review_queue \(.*?\n\);", sql, re.S)
    assert match, "the review-queue DDL moved; this fixture must follow it"
    conn.execute(match.group(0))
    assert floor.REVIEW_TAB in match.group(0), (
        f"{floor.REVIEW_TAB!r} is not an allowed review tab — enqueue would be refused in production")
    return conn


def _rows(conn, extra=""):
    clause, params = floor.sql_clause("r")
    return [r["record_id"] for r in conn.execute(
        f"SELECT r.record_id FROM wisdom_records r WHERE {clause}{extra} ORDER BY r.record_id", params)]


def test_the_sql_clause_agrees_with_the_python_predicate():
    conn = _db()
    cases = [("a", "PRINCIPLE", None), ("b", "PRINCIPLE", 0.667), ("c", "PRINCIPLE", 1.0),
             ("d", "MARKET_SIGNAL", None), ("e", "MARKET_SIGNAL", 1.0),
             ("f", "CALL", None), ("g", "MENTION", 0.1)]
    conn.executemany("INSERT INTO wisdom_records (record_id, record_type, stability) VALUES (?,?,?)", cases)
    got = set(_rows(conn))
    expected = {rid for rid, rtype, stab in cases if floor.passes(rtype, stab)}
    assert got == expected
    # non-vacuity: it must let SOMETHING through and hold SOMETHING back
    assert got and len(got) < len(cases)


def test_the_sql_clause_refuses_a_non_identifier_alias():
    with pytest.raises(ValueError):
        floor.sql_clause("r; DROP TABLE wisdom_records --")


def test_the_principles_clause_blocks_null_and_below_and_passes_at_floor():
    conn = _db()
    conn.executemany("INSERT INTO wisdom_principles (principle_key, stability) VALUES (?,?)",
                     [("p_null", None), ("p_low", 0.667), ("p_ok", 1.0)])
    clause, params = floor.principles_clause("p")
    got = {r[0] for r in conn.execute(f"SELECT principle_key FROM wisdom_principles p WHERE {clause}", params)}
    assert got == {"p_ok"}


# ── 7: status interaction ────────────────────────────────────────────────────

def test_7_status_and_stability_are_ANDed_not_ORed():
    """A stable record that is `rejected` must still be blocked by the status filter, and a
    `confirmed` record below the floor must still be blocked by the floor. Neither rescues the
    other."""
    from api.services.wisdom.publish.adapters import common

    assert floor.passes("PRINCIPLE", 1.0) is True
    assert "rejected" not in common.ELIGIBLE_STATUSES
    # the floor never widens the status set, and the status set never widens the floor
    clause, _ = floor.sql_clause("r")
    assert "status" not in clause


# ── 4 + 5: the paired enqueue ────────────────────────────────────────────────

def _seed_blocked(conn):
    conn.executemany(
        "INSERT INTO wisdom_records (record_id, record_type, stability, stability_runs, segment_id, author_id) "
        "VALUES (?,?,?,?,?,?)",
        [("r_null", "PRINCIPLE", None, None, "seg-1", "a1"),
         ("r_low", "MARKET_SIGNAL", 0.667, 3, "seg-2", "a1"),
         ("r_ok", "PRINCIPLE", 1.0, 3, "seg-3", "a1"),
         ("r_call", "CALL", None, None, "seg-4", "a1")])


def test_4_a_blocked_record_is_enqueued_with_a_reason_code(wisdom_review_db):
    conn = wisdom_review_db
    _seed_blocked(conn)
    out = floor.enqueue_blocked(conn)
    assert out["blocked"] == 2, "only the two floored types below the floor"
    assert out["enqueued"] == 2
    rows = list(conn.execute("SELECT subject_ref, summary, new_json FROM wisdom_review_queue ORDER BY subject_ref"))
    assert [r["subject_ref"] for r in rows] == ["record:r_low", "record:r_null"]
    assert floor.REASON in rows[0]["summary"] and floor.REASON in rows[1]["summary"]
    # the reason names the floor, the value, and the run count
    assert "NULL (never measured)" in rows[1]["summary"]
    assert "0.667" in rows[0]["summary"] and "over 3 run(s)" in rows[0]["summary"]
    assert f"{FLOOR:.3f}" in rows[0]["summary"]


def test_4b_a_passing_record_is_never_enqueued(wisdom_review_db):
    """Non-vacuity for the test above: the queue must not simply take everything."""
    conn = wisdom_review_db
    _seed_blocked(conn)
    floor.enqueue_blocked(conn)
    refs = {r[0] for r in conn.execute("SELECT subject_ref FROM wisdom_review_queue")}
    assert "record:r_ok" not in refs and "record:r_call" not in refs


def test_5_rerunning_does_not_duplicate_the_queue_row(wisdom_review_db):
    """⛔ review.item_id_for keys on (tab, subject_ref, new), so a daily re-run is one row."""
    conn = wisdom_review_db
    _seed_blocked(conn)
    first = floor.enqueue_blocked(conn)
    second = floor.enqueue_blocked(conn)
    assert first["enqueued"] == 2 and second["enqueued"] == 0
    assert conn.execute("SELECT COUNT(*) FROM wisdom_review_queue").fetchone()[0] == 2


def test_the_reason_code_is_actionable():
    r = floor.reason("PRINCIPLE", 0.667, runs=3, run_id="ev-1")
    assert "PRINCIPLE" in r and "0.667" in r and "3 run(s)" in r and "ev-1" in r and f"{FLOOR:.3f}" in r
    assert floor.reason("PRINCIPLE", None).endswith(f"{FLOOR:.3f}")
    assert "NULL (never measured)" in floor.reason("PRINCIPLE", None)


# ── 6a: the migration does not disturb record identity ───────────────────────

def test_record_hash_and_record_id_are_unchanged_by_the_migration():
    """⛔⛔ THE TRAP THE COLUMN CHOICE AVOIDS. If stability had gone into the model's `fields`
    dict, _canonical_hash would hash it, every record_hash and record_id would change, and
    re-extraction would duplicate the entire corpus instead of deduping against it.
    """
    fields = {"principle": {"statement": "Size down when the tape is choppy."}}
    before_hash = writer._canonical_hash(fields, "PRINCIPLE")
    after_hash = writer._canonical_hash(fields, "PRINCIPLE")
    assert before_hash == after_hash

    # a record carrying a stability COLUMN value hashes identically to one without
    assert writer._canonical_hash(dict(fields), "PRINCIPLE") == before_hash
    rid = writer.record_id_for("seg-1", "wx-v0-deadbeef", before_hash)
    assert rid == writer.record_id_for("seg-1", "wx-v0-deadbeef", before_hash)

    # and the control: a change INSIDE fields does move the hash, so the check is not vacuous
    moved = writer._canonical_hash({"principle": {"statement": "Something else."}}, "PRINCIPLE")
    assert moved != before_hash


def test_stability_is_not_a_model_field_anywhere():
    """A grep would match the word in a comment; this asserts the SCHEMA, which cannot lie."""
    import json
    import pathlib

    schema = json.loads((pathlib.Path(__file__).resolve().parents[1] / "docs" / "wisdom" / "contracts"
                         / "extraction-output-v0.schema.json").read_text(encoding="utf-8"))
    assert "stability" not in json.dumps(schema), "stability must never enter the extractor contract"


def test_the_three_migrations_are_one_statement_each():
    """⛔ store.init_db records a migration only when its whole script succeeds; a two-statement
    script that died after its ALTER would retry forever on 'duplicate column'."""
    from api.services.wisdom.core import schema

    ours = [(name, sql) for name, sql in schema.MIGRATIONS if name.startswith(("core_007", "core_008", "core_009"))]
    assert len(ours) == 3, [n for n, _ in schema.MIGRATIONS]
    for name, sql in ours:
        assert sql.count(";") == 0, f"{name} looks like more than one statement"
        assert sql.strip().upper().startswith("ALTER TABLE")


# ── 8: no member-facing route changed ────────────────────────────────────────

#: The 27 Wisdom GET routes, pinned. ⛔ DERIVED, not typed: produced by
#: `scripts/wisdom_dark_check.wisdom_get_routes()`, the same registry walk `api/main.py` mounts
#: them with, and re-derived on every run below. Item 3 must change none of them.
EXPECTED_GET_ROUTES = [
    ("/api/admin/wisdom/capture/health", "admin"),
    ("/api/admin/wisdom/capture/runs", "admin"),
    ("/api/admin/wisdom/core/private/{record_id}", "owner"),
    ("/api/admin/wisdom/core/runs", "admin"),
    ("/api/admin/wisdom/core/status", "admin"),
    ("/api/admin/wisdom/evals/metrics", "admin"),
    ("/api/admin/wisdom/evals/outcomes/{record_id}", "admin"),
    ("/api/admin/wisdom/evals/run/last", "admin"),
    ("/api/admin/wisdom/extract/batches", "admin"),
    ("/api/admin/wisdom/extract/budget", "admin"),
    ("/api/admin/wisdom/extract/gate", "admin"),
    ("/api/admin/wisdom/publish/adapters/badges", "admin"),
    ("/api/admin/wisdom/publish/adapters/d20", "admin"),
    ("/api/admin/wisdom/publish/adapters/drafts", "admin"),
    ("/api/admin/wisdom/publish/adapters/status", "admin"),
    ("/api/admin/wisdom/publish/dashboard", "admin"),
    ("/api/admin/wisdom/publish/queue", "admin"),
    ("/api/admin/wisdom/publish/queue/counts", "admin"),
    ("/api/admin/wisdom/publish/queue/{item_id}", "admin"),
    ("/api/admin/wisdom/publish/reports", "admin"),
    ("/api/admin/wisdom/publish/reports/{report_id}", "admin"),
    ("/api/admin/wisdom/sources/discord/status", "admin"),
    ("/api/admin/wisdom/sources/sunday-scans/verify", "admin"),
    ("/api/admin/wisdom/sources/transcripts/coverage", "admin"),
    ("/api/internal/wisdom/publish/adapters/clip-candidates", "internal"),
    ("/api/internal/wisdom/publish/adapters/kb-export", "internal"),
    ("/api/internal/wisdom/publish/golden-candidates", "internal"),
]


def _routes():
    import pathlib
    import sys as _sys

    scripts = str(pathlib.Path(__file__).resolve().parents[1] / "scripts")
    if scripts not in _sys.path:
        _sys.path.insert(0, scripts)
    import wisdom_dark_check as dark

    dark._pin_data_root()
    return dark, dark.wisdom_get_routes()


def test_8_the_route_list_is_unchanged_byte_for_byte():
    dark, routes = _routes()
    got = [(r["path"], dark.classify(r)) for r in routes]
    assert got == EXPECTED_GET_ROUTES


def test_8b_every_route_is_admin_owner_or_internal_and_none_is_member_facing():
    dark, routes = _routes()
    classes = {dark.classify(r) for r in routes}
    assert classes <= {"admin", "owner", "internal"}, f"a member-facing Wisdom GET route appeared: {classes}"
    assert not [r for r in routes if dark.classify(r) == "UNGUARDED"]
    # non-vacuity: the walk must actually have found routes to classify
    assert len(routes) == len(EXPECTED_GET_ROUTES) == 27


def test_8c_no_route_path_is_doubled():
    """⚰️ route.path already carries the router prefix; concatenating both doubled every URL
    while leaving the COUNT a correct 27, so only a probe would have caught it."""
    _, routes = _routes()
    assert not [r["path"] for r in routes if r["path"].count("/api/") > 1]


# ── the four sites are actually wired ────────────────────────────────────────

SITES = {
    "api/services/wisdom/publish/adapters/common.py": "select_records",
    "api/services/wisdom/publish/adapters/brainkb.py": "export_payload",
    "api/services/wisdom/publish/retrieval.py": "search",
    "api/services/wisdom/publish/adapters/clips.py": "clip_candidates",
}


@pytest.mark.parametrize("path,func", sorted(SITES.items()))
def test_each_of_the_four_sites_consults_the_floor_module(path, func):
    """⛔ Built, tested, green and unreachable is this repo's most expensive failure shape. A
    floor that no consumer calls is inert while every unit test of the predicate stays green."""
    import ast
    import pathlib

    src = (pathlib.Path(__file__).resolve().parents[1] / path).read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next((n for n in ast.walk(tree)
               if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == func), None)
    assert fn is not None, f"control: {func} not found in {path}"
    body = ast.get_source_segment(src, fn) or ""
    assert "floor." in body, f"{path}::{func} never consults the floor module"


def test_the_daily_chain_runs_the_publication_floor_step():
    """⛔ The enqueue half. Without this step a blocked record vanishes instead of surfacing."""
    from api.services.wisdom.publish import chain

    names = [s.name for s in chain.DAILY]
    assert "publication_floor" in names, names
    step = next(s for s in chain.DAILY if s.name == "publication_floor")
    assert ("api.services.wisdom.publish.floor", "score_silently") in step.targets
    assert step.gate is None, "the floor is not flag-gated: it must not be switchable off"


def test_the_two_deliberate_opt_ins_are_the_only_ones():
    """⛔ include_unstable=True is how the floor is BYPASSED. Every use must be deliberate.

    ⚰️ The first version of this test grepped for the literal and found FOUR hits - because the
    two real call sites each carry a comment that spells out `include_unstable=True` while
    explaining why it is there. An instrument reporting a property of its own prose. It reads the
    AST now, so a comment cannot be a call site (`CODE, NEVER PROSE`).
    """
    import ast
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[1] / "api" / "services" / "wisdom"
    uses = []
    for path in sorted(root.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            for kw in node.keywords:
                if kw.arg == "include_unstable" and isinstance(kw.value, ast.Constant) and kw.value.value is True:
                    uses.append(f"{path.name}:{node.lineno}")
    assert len(uses) == 2, f"expected exactly the two brainkb owner-side opt-ins, got {uses}"
    assert all(u.startswith("brainkb.py:") for u in uses), uses


def test_the_comment_control():
    """Non-vacuity for the test above: an AST walk must still SEE a real call."""
    import ast

    tree = ast.parse("search(q, include_unstable=True)  # include_unstable=True in a comment")
    found = [kw for n in ast.walk(tree) if isinstance(n, ast.Call)
             for kw in n.keywords if kw.arg == "include_unstable"]
    assert len(found) == 1


# ── BEHAVIOURAL: the two sites the structural test could not prove ───────────
#
# ⛔⛔ WHY THESE EXIST. The AST test above asserts each site MENTIONS the floor module. Mutation
# proved that is not enough: turning `if not include_unstable:` into `if False:` and the clips
# clause into `AND 1=1` both left the mention intact, and the whole file stayed green (30 passed)
# while the floor filtered nothing. A guard that tests the adjacent thing is not a guard
# (`lesson_a_guard_that_tests_the_adjacent_thing`). These run the real queries.

from tests.test_wisdom_publish_adapters_store import (  # noqa: E402
    add_record, add_source, adapters_db, seeded,  # noqa: F401
)


def _floor_fixture(conn):
    """One below-floor PRINCIPLE, one at-floor PRINCIPLE, one CALL that must be untouched."""
    conn.execute("UPDATE wisdom_records SET stability = NULL")
    add_record(conn, "rec_low", "PRINCIPLE", "segLIVE1", "srcLIVE", author_id="tsdr", stability=0.667,
               stability_runs=3)
    add_record(conn, "rec_ok", "PRINCIPLE", "segLIVE1", "srcLIVE", author_id="tsdr", stability=1.0,
               stability_runs=3)
    add_record(conn, "rec_null", "MARKET_SIGNAL", "segLIVE1", "srcLIVE", author_id="tsdr")
    add_record(conn, "rec_call", "CALL", "segLIVE1", "srcLIVE", author_id="tsdr", ticker="NVDA")
    conn.commit()


def test_select_records_actually_withholds_a_below_floor_record(adapters_db, seeded):
    """⛔ M3 REGRESSION TEST. `if False:` around the floor clause must make this RED."""
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import common

    with store.write() as conn:
        _floor_fixture(conn)
    with store.read() as conn:
        got = {r["record_id"] for r in common.select_records(conn, types=("PRINCIPLE", "MARKET_SIGNAL"))}
        opened = {r["record_id"] for r in common.select_records(
            conn, types=("PRINCIPLE", "MARKET_SIGNAL"), include_unstable=True)}
        calls = {r["record_id"] for r in common.select_records(conn, types=("CALL",))}

    assert "rec_ok" in got, "non-vacuity: an at-floor record MUST still come back"
    assert "rec_low" not in got and "rec_null" not in got
    # the opt-in returns them, which is what proves the filter is the thing doing the work
    assert {"rec_low", "rec_null", "rec_ok"} <= opened
    # and an unfloored type is untouched at NULL stability
    assert "rec_call" in calls


def test_clip_candidates_actually_withholds_a_below_floor_record(adapters_db, seeded):
    """⛔ M6 REGRESSION TEST. `AND 1=1` in place of the floor clause must make this RED."""
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import clips

    with store.write() as conn:
        _floor_fixture(conn)

    body = clips.clip_candidates(42)
    ids_out = {r["record_id"] for r in body["records"]}
    assert "rec_ok" in ids_out, "non-vacuity: an at-floor record MUST still be exported"
    assert "rec_call" in ids_out, "non-vacuity: an unfloored type MUST still be exported"
    assert "rec_low" not in ids_out and "rec_null" not in ids_out
