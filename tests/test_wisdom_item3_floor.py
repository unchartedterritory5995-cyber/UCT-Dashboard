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
    assert floor.passes(rtype, 0.667, 3) is False
    assert floor.passes(rtype, 0.0, 3) is False


@pytest.mark.parametrize("rtype", floor.FLOORED_TYPES)
def test_2_at_floor_passes(rtype):
    assert floor.passes(rtype, 1.0, floor.MIN_RUNS) is True
    assert floor.passes(rtype, FLOOR, floor.MIN_RUNS) is True


@pytest.mark.parametrize("rtype", floor.FLOORED_TYPES)
def test_3_missing_score_blocks(rtype):
    """⛔ The only case that exists today: every stored record has stability NULL."""
    assert floor.passes(rtype, None, 3) is False
    assert floor.passes(rtype, "", 3) is False
    assert floor.passes(rtype, "not a number", 3) is False


def test_6_an_unfloored_record_type_is_unaffected_at_any_value():
    """⚰️ This looped over CALL, NEGATIVE_CALL, MENTION and LEVEL until R89 (2026-09-17) floored
    the first three. It is kept, narrowed to `floor.UNFLOORED_TYPES`, because the property it
    pins — an unfloored type passes at EVERY (stability, runs) combination, including NULL — is
    what makes `passes()` a type-scoped predicate rather than a blanket one.

    ⛔ It reads the tuple instead of naming LEVEL, so the day a type leaves `FLOORED_TYPES` this
    covers it without an edit, and the day `UNFLOORED_TYPES` empties the guard below fires rather
    than the loop passing over nothing.
    """
    assert floor.UNFLOORED_TYPES, "non-vacuity: with no unfloored type this test asserts nothing"
    for rtype in floor.UNFLOORED_TYPES:
        for value in (None, 0.0, 0.333, 0.667, 1.0):
            for runs in (None, 1, 3, 5):
                assert floor.passes(rtype, value, runs) is True, (rtype, value, runs)


# ── R89: CALL is floored, on the same predicate ──────────────────────────────
#
# ⛔⛔ WHY THESE ARE HERE AND NOT IN A NEW MODULE. R89 changes ONE tuple. If it had needed a new
# predicate, a new call site or a second spelling of "below the floor", that would itself be the
# finding — `lesson_a_guard_repeated_is_a_guard_unproved`. Everything below therefore re-uses the
# existing machinery deliberately, and the mutation proof is that removing CALL from
# `FLOORED_TYPES` reds these by name.

R89_TYPES = ("CALL", "NEGATIVE_CALL", "MENTION")


@pytest.mark.parametrize("rtype", R89_TYPES)
def test_r89_the_ruling_types_are_floored_with_identical_semantics(rtype):
    """PENDING below MIN_RUNS · BLOCK below the floor · PUBLISH otherwise — the same three."""
    assert rtype in floor.FLOORED_TYPES
    # below STABILITY_FLOOR over enough runs -> blocked
    assert floor.passes(rtype, 2 / 5, 5) is False, "2 of 5 must not publish"
    assert floor.passes(rtype, 0.667, floor.MIN_RUNS) is False
    # measured over too few runs -> blocked, whatever the score says
    assert floor.passes(rtype, 1.0, floor.MIN_RUNS - 1) is False
    assert floor.passes(rtype, 1.0, None) is False
    # never measured -> blocked
    assert floor.passes(rtype, None, None) is False
    # at or above the floor over at least MIN_RUNS -> publishes (the control)
    assert floor.passes(rtype, 4 / 5, 5) is True, "4 of 5 must publish"
    assert floor.passes(rtype, FLOOR, floor.MIN_RUNS) is True
    assert floor.passes(rtype, 1.0, floor.MIN_RUNS) is True


def test_r89_the_boundary_for_CALL_is_the_same_object_not_a_near_neighbour():
    """⛔ Mutation vii's lesson, applied to the new type: probe strictly BETWEEN candidates."""
    f = floor.floor_value()
    assert floor.passes("CALL", f - 0.005, floor.MIN_RUNS) is False
    assert floor.passes("CALL", f, floor.MIN_RUNS) is True
    assert floor.passes("CALL", f + 0.005, floor.MIN_RUNS) is True


def test_r89_the_sql_clause_and_the_python_predicate_agree_about_CALL():
    """The two spellings must move together for the NEW types as well as the old ones."""
    conn = _db()
    cases = [("c_null", "CALL", None, None), ("c_low", "CALL", 0.4, 5), ("c_ok", "CALL", 1.0, 3),
             ("c_pending", "CALL", 1.0, 2), ("c_five", "CALL", 0.8, 5),
             ("n_low", "NEGATIVE_CALL", 0.667, 3), ("n_ok", "NEGATIVE_CALL", 1.0, 3),
             ("m_low", "MENTION", None, 3), ("m_ok", "MENTION", 1.0, 3),
             ("l_null", "LEVEL", None, None)]
    conn.executemany(
        "INSERT INTO wisdom_records (record_id, record_type, stability, stability_runs) VALUES (?,?,?,?)", cases)
    got = set(_rows(conn))
    assert got == {rid for rid, rtype, stab, runs in cases if floor.passes(rtype, stab, runs)}
    assert got == {"c_ok", "c_five", "n_ok", "m_ok", "l_null"}
    # non-vacuity in both directions
    assert got and len(got) < len(cases)


def test_r89_a_blocked_CALL_is_enqueued_and_a_passing_one_is_not(wisdom_review_db):
    """⛔ The block and the enqueue are PAIRED, or a blocked CALL vanishes instead of surfacing."""
    conn = wisdom_review_db
    conn.executemany(
        "INSERT INTO wisdom_records (record_id, record_type, stability, stability_runs, segment_id, author_id) "
        "VALUES (?,?,?,?,?,?)",
        [("c_block", "CALL", 2 / 5, 5, "seg-1", "tsdr"),
         ("c_pass", "CALL", 4 / 5, 5, "seg-1", "tsdr"),
         ("l_null", "LEVEL", None, None, "seg-1", "tsdr")])
    out = floor.enqueue_blocked(conn)
    refs = {r[0] for r in conn.execute("SELECT subject_ref FROM wisdom_review_queue")}
    assert "record:c_block" in refs, "a blocked CALL must surface in the admin review queue"
    assert "record:c_pass" not in refs, "non-vacuity: a passing CALL must never be enqueued"
    assert "record:l_null" not in refs, "an unfloored type is not the floor's business"
    assert out["blocked"] == 1 and out["enqueued"] == 1
    # the reason names the type, the value and the floor — an admin can act on it
    summary = conn.execute(
        "SELECT summary FROM wisdom_review_queue WHERE subject_ref = 'record:c_block'").fetchone()[0]
    assert "CALL" in summary and f"{FLOOR:.3f}" in summary and "5 run(s)" in summary


def test_r89_a_CALL_below_MIN_RUNS_is_pending_and_is_NOT_queued_like_a_PRINCIPLE(wisdom_review_db):
    """⚰️⚰️ THIS TEST USED TO ASSERT THE OPPOSITE, AND SAID SO IN ITS OWN NAME AND BODY —
    "…is_pending_and_is_queued_exactly_like_a_PRINCIPLE". That was R89's own documented, deliberate
    choice at the time: the brief asked for PENDING to stay out of the queue, the implementer
    overrode it on the reasoning that Q17's motivating case (1.0 over one run) is the most
    confident-looking number the pipeline can produce for the least evidence, and the test's own
    closing warning read *"If the owner does want PENDING to stay out of the queue, that is a
    change to `enqueue_blocked` for EVERY floored type … not a branch on `record_type`."*

    **R79 (owner ruling, 2026-09-18) is exactly that change, made for exactly that reason stated in
    advance.** CALL and PRINCIPLE are still treated identically — that half of R89 stands — but the
    identical treatment is now PENDING-never-enqueues, for every floored type, with no branch on
    `record_type`. `floor.status()` is where PENDING and BLOCK are told apart now; before this
    ruling they differed only in wording inside one shared queue reason.
    """
    conn = wisdom_review_db
    conn.executemany(
        "INSERT INTO wisdom_records (record_id, record_type, stability, stability_runs, segment_id, author_id) "
        "VALUES (?,?,?,?,?,?)",
        [("c_pending", "CALL", 1.0, floor.MIN_RUNS - 1, "seg-1", "tsdr"),
         ("p_pending", "PRINCIPLE", 1.0, floor.MIN_RUNS - 1, "seg-1", "tsdr"),
         ("c_pass", "CALL", 1.0, floor.MIN_RUNS, "seg-1", "tsdr")])
    assert floor.passes("CALL", 1.0, floor.MIN_RUNS - 1) is False, "PENDING must not publish"
    assert floor.status("CALL", 1.0, floor.MIN_RUNS - 1) == floor.STATUS_PENDING
    assert floor.status("PRINCIPLE", 1.0, floor.MIN_RUNS - 1) == floor.STATUS_PENDING
    out = floor.enqueue_blocked(conn)
    rows = {r["subject_ref"]: r["summary"] for r in conn.execute(
        "SELECT subject_ref, summary FROM wisdom_review_queue")}
    assert rows == {}, ("CALL and PRINCIPLE must be treated identically — neither PENDING record "
                        f"belongs in the queue, whatever it wrote: {rows}")
    assert out["blocked"] == 0 and out["enqueued"] == 0
    assert out["records_pending"] == 2, "both PENDING rows must still be COUNTED, just not queued"


def test_r79_a_genuine_BLOCK_still_enqueues_beside_the_uncounted_PENDING(wisdom_review_db):
    """Non-vacuity for the test above, and the transition R79 names explicitly: a CALL measured
    over MIN_RUNS and below the floor is a verdict, not a pending measurement, and still surfaces."""
    conn = wisdom_review_db
    conn.executemany(
        "INSERT INTO wisdom_records (record_id, record_type, stability, stability_runs, segment_id, author_id) "
        "VALUES (?,?,?,?,?,?)",
        [("c_pending", "CALL", 1.0, floor.MIN_RUNS - 1, "seg-1", "tsdr"),
         ("c_block", "CALL", 2 / 5, 5, "seg-1", "tsdr")])
    assert floor.status("CALL", 2 / 5, 5) == floor.STATUS_BLOCK
    out = floor.enqueue_blocked(conn)
    refs = {r[0] for r in conn.execute("SELECT subject_ref FROM wisdom_review_queue")}
    assert refs == {"record:c_block"}, "the PENDING row must not ride in beside the real BLOCK"
    assert out == {"blocked": 1, "enqueued": 1, "records_pending": 1, "floor": floor.floor_value()}


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
    conn.execute("CREATE TABLE wisdom_principles (principle_key TEXT PRIMARY KEY, stability REAL, "
                 "stability_runs INTEGER)")
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
    # the whole grid of (type, stability, runs), so SQL and Python cannot drift. Q17 added
    # the runs dimension and this is where the two spellings are cross-checked.
    cases = [("a", "PRINCIPLE", None, None), ("b", "PRINCIPLE", 0.667, 3), ("c", "PRINCIPLE", 1.0, 3),
             ("d", "MARKET_SIGNAL", None, 3), ("e", "MARKET_SIGNAL", 1.0, 3),
             ("f", "CALL", None, None), ("g", "MENTION", 0.1, 1),
             ("h", "PRINCIPLE", 1.0, 1), ("i", "PRINCIPLE", 1.0, None),
             ("j", "PRINCIPLE", 0.8, 5), ("k", "PRINCIPLE", 0.6, 5),
             ("l", "MARKET_SIGNAL", 1.0, 2), ("m", "MARKET_SIGNAL", 0.8, 5)]
    conn.executemany(
        "INSERT INTO wisdom_records (record_id, record_type, stability, stability_runs) VALUES (?,?,?,?)",
        cases)
    got = set(_rows(conn))
    expected = {rid for rid, rtype, stab, runs in cases if floor.passes(rtype, stab, runs)}
    assert got == expected
    # non-vacuity: it must let SOMETHING through and hold SOMETHING back
    assert got and len(got) < len(cases)


def test_the_sql_clause_refuses_a_non_identifier_alias():
    with pytest.raises(ValueError):
        floor.sql_clause("r; DROP TABLE wisdom_records --")


# ── R79: status() and its two SQL halves ─────────────────────────────────────

_R79_CASES = [
    # (record_type,     stability, runs,  expected status)
    ("LEVEL",           None,      None,  floor.STATUS_PUBLISH),   # unfloored: always publishes
    ("LEVEL",           0.1,       1,     floor.STATUS_PUBLISH),
    ("PRINCIPLE",       None,      None,  floor.STATUS_PENDING),   # never measured
    ("PRINCIPLE",       None,      3,     floor.STATUS_PENDING),   # stability unrecorded
    ("PRINCIPLE",       1.0,       None,  floor.STATUS_PENDING),   # runs unrecorded
    ("PRINCIPLE",       1.0,       1,     floor.STATUS_PENDING),   # Q17's motivating case
    ("PRINCIPLE",       1.0,       2,     floor.STATUS_PENDING),   # one short of MIN_RUNS
    ("PRINCIPLE",       "junk",    3,     floor.STATUS_PENDING),   # unparseable stability
    ("PRINCIPLE",       1.0,       "junk", floor.STATUS_PENDING),  # unparseable runs
    ("MARKET_SIGNAL",   0.6,       5,     floor.STATUS_BLOCK),     # measured, below floor
    ("CALL",            0.667,     3,     floor.STATUS_BLOCK),     # measured, below floor
    ("NEGATIVE_CALL",   0.0,       3,     floor.STATUS_BLOCK),
    ("MENTION",         1.0,       3,     floor.STATUS_PUBLISH),   # measured, AT the floor
    ("PRINCIPLE",       0.8,       5,     floor.STATUS_PUBLISH),   # measured, above the floor
]


@pytest.mark.parametrize("rtype,stability,runs,want", _R79_CASES)
def test_status_classifies_publish_pending_and_block(rtype, stability, runs, want):
    assert floor.status(rtype, stability, runs) == want


def test_status_and_passes_agree_on_every_case():
    """⛔ `status() == STATUS_PUBLISH` must be exactly `passes()`. If these ever disagreed, a
    record `passes()` would let through could still read as PENDING or BLOCK somewhere else, or
    vice versa — two authorities over one publish/don't-publish fact."""
    for rtype, stability, runs, _ in _R79_CASES:
        assert (floor.status(rtype, stability, runs) == floor.STATUS_PUBLISH) == floor.passes(
            rtype, stability, runs), (rtype, stability, runs)


def test_block_and_pending_sql_clauses_partition_NOT_sql_clause_with_no_overlap():
    """⛔ `block_sql_clause() OR pending_sql_clause()` must equal `NOT sql_clause()`, and the two
    must never both match the same row — the SQL mirror of `status()` returning exactly one of
    three values. Cross-checked over the whole R79 case grid, not trusted from having been written
    together."""
    conn = _db()
    # ⛔ SQLite has no separate "unparseable" state the way Python's int()/float() casts do — a
    # TEXT value in a REAL/INTEGER-affinity column is stored as given and compared lexically,
    # which is not what status() does for "junk". Those two rows are Python-only data-defect
    # guards (see test_status_classifies_publish_pending_and_block) and are excluded here.
    rows = [(f"r{i}", rtype, stability, runs) for i, (rtype, stability, runs, _) in enumerate(_R79_CASES)
            if stability != "junk" and runs != "junk"]
    conn.executemany(
        "INSERT INTO wisdom_records (record_id, record_type, stability, stability_runs) VALUES (?,?,?,?)", rows)

    block_clause, block_params = floor.block_sql_clause("r")
    pending_clause, pending_params = floor.pending_sql_clause("r")
    publish_clause, publish_params = floor.sql_clause("r")

    block_ids = {r[0] for r in conn.execute(f"SELECT record_id FROM wisdom_records r WHERE {block_clause}",
                                             block_params)}
    pending_ids = {r[0] for r in conn.execute(f"SELECT record_id FROM wisdom_records r WHERE {pending_clause}",
                                              pending_params)}
    publish_ids = {r[0] for r in conn.execute(f"SELECT record_id FROM wisdom_records r WHERE {publish_clause}",
                                              publish_params)}
    all_ids = {r[0] for r in rows}

    assert not (block_ids & pending_ids), "a row can never be both BLOCK and PENDING"
    assert block_ids | pending_ids == all_ids - publish_ids
    expected_block = {rid for rid, rtype, stab, runs in rows
                      if floor.status(rtype, stab, runs) == floor.STATUS_BLOCK}
    expected_pending = {rid for rid, rtype, stab, runs in rows
                        if floor.status(rtype, stab, runs) == floor.STATUS_PENDING}
    assert block_ids == expected_block
    assert pending_ids == expected_pending
    # non-vacuity: this grid must produce at least one of each of the three states
    assert block_ids and pending_ids and publish_ids


def test_records_pending_count_is_per_type_and_never_includes_block_or_publish():
    conn = _db()
    conn.executemany(
        "INSERT INTO wisdom_records (record_id, record_type, stability, stability_runs) VALUES (?,?,?,?)",
        [("p1", "PRINCIPLE", None, None), ("p2", "PRINCIPLE", 1.0, 1),
         ("c1", "CALL", 1.0, 2), ("m1", "MARKET_SIGNAL", 0.6, 5), ("ok", "PRINCIPLE", 1.0, 3)])
    out = floor.records_pending_count(conn)
    assert out == {"records_pending": 3, "records_pending_by_type": {"PRINCIPLE": 2, "CALL": 1}}


def test_the_principles_clause_blocks_null_and_below_and_passes_at_floor():
    conn = _db()
    conn.executemany(
        "INSERT INTO wisdom_principles (principle_key, stability, stability_runs) VALUES (?,?,?)",
        [("p_null", None, 3), ("p_low", 0.667, 3), ("p_ok", 1.0, 3),
         ("p_one_run", 1.0, 1), ("p_no_runs", 1.0, None), ("p_five", 0.8, 5)])
    clause, params = floor.principles_clause("p")
    got = {r[0] for r in conn.execute(f"SELECT principle_key FROM wisdom_principles p WHERE {clause}", params)}
    assert got == {"p_ok", "p_five"}, "Q17: 1.0 over one run blocks; 0.8 over five passes"


# ── 7: status interaction ────────────────────────────────────────────────────

def test_7_status_and_stability_are_ANDed_not_ORed():
    """A stable record that is `rejected` must still be blocked by the status filter, and a
    `confirmed` record below the floor must still be blocked by the floor. Neither rescues the
    other."""
    from api.services.wisdom.publish.adapters import common

    assert floor.passes("PRINCIPLE", 1.0, floor.MIN_RUNS) is True
    assert "rejected" not in common.ELIGIBLE_STATUSES
    # the floor never widens the status set, and the status set never widens the floor
    clause, _ = floor.sql_clause("r")
    assert "status" not in clause


# ── 4 + 5: the paired enqueue ────────────────────────────────────────────────

def _seed_blocked(conn):
    # ⚰️ `r_call` was a NULL-stability CALL standing for "an unfloored type the floor must not
    # touch". R89 floored CALL, so the unfloored control is now `r_level` — a LEVEL, the one type
    # `floor.UNFLOORED_TYPES` still names. The row was swapped rather than dropped: without an
    # unfloored row in the fixture, `test_4b` degenerates into "the queue did not take a record
    # that is not there".
    conn.executemany(
        "INSERT INTO wisdom_records (record_id, record_type, stability, stability_runs, segment_id, author_id) "
        "VALUES (?,?,?,?,?,?)",
        [("r_null", "PRINCIPLE", None, None, "seg-1", "a1"),
         ("r_low", "MARKET_SIGNAL", 0.667, 3, "seg-2", "a1"),
         ("r_ok", "PRINCIPLE", 1.0, 3, "seg-3", "a1"),
         ("r_level", "LEVEL", None, None, "seg-4", "a1"),
         ("r_one_run", "PRINCIPLE", 1.0, 1, "seg-5", "a1")])


def test_4_a_blocked_record_is_enqueued_with_a_reason_code(wisdom_review_db):
    """⚰️ R79 (2026-09-18) narrowed this from 3 enqueued to 1: `r_null` (never measured) and
    `r_one_run` (1.0 over one run) are PENDING under R79, not verdicts, and no longer queue —
    see `records_pending` and `test_4c` below for where they went instead."""
    conn = wisdom_review_db
    _seed_blocked(conn)
    out = floor.enqueue_blocked(conn)
    assert out["blocked"] == 1, "only r_low is measured AND below the floor — a real verdict"
    assert out["enqueued"] == 1
    rows = list(conn.execute("SELECT subject_ref, summary, new_json FROM wisdom_review_queue ORDER BY subject_ref"))
    assert [r["subject_ref"] for r in rows] == ["record:r_low"]
    assert floor.REASON in rows[0]["summary"]
    # the reason names the floor, the value, and the run count
    assert "0.667" in rows[0]["summary"] and "over 3 run(s)" in rows[0]["summary"]
    assert f"{FLOOR:.3f}" in rows[0]["summary"]


def test_4b_a_passing_record_is_never_enqueued(wisdom_review_db):
    """Non-vacuity for the test above: the queue must not simply take everything."""
    conn = wisdom_review_db
    _seed_blocked(conn)
    floor.enqueue_blocked(conn)
    refs = {r[0] for r in conn.execute("SELECT subject_ref FROM wisdom_review_queue")}
    assert "record:r_ok" not in refs and "record:r_level" not in refs


def test_4c_pending_records_are_counted_but_never_queued(wisdom_review_db):
    """R79: `r_null` (never measured) and `r_one_run` (1.0 over one run — Q17's own motivating
    case) are both PENDING, not BLOCK. Neither belongs to the owner's inbox; both must still be
    visible somewhere, which is `records_pending`."""
    conn = wisdom_review_db
    _seed_blocked(conn)
    assert floor.status("PRINCIPLE", None, None) == floor.STATUS_PENDING
    assert floor.status("PRINCIPLE", 1.0, 1) == floor.STATUS_PENDING
    out = floor.enqueue_blocked(conn)
    refs = {r[0] for r in conn.execute("SELECT subject_ref FROM wisdom_review_queue")}
    assert "record:r_null" not in refs and "record:r_one_run" not in refs, (
        "a PENDING record must never reach the queue — that is the whole ruling")
    assert out["records_pending"] == 2, "r_null and r_one_run, and nothing else, are PENDING here"


def test_5_rerunning_does_not_duplicate_the_queue_row(wisdom_review_db):
    """⛔ review.item_id_for keys on (tab, subject_ref, new), so a daily re-run is one row."""
    conn = wisdom_review_db
    _seed_blocked(conn)
    first = floor.enqueue_blocked(conn)
    second = floor.enqueue_blocked(conn)
    assert first["enqueued"] == 1 and second["enqueued"] == 0
    assert conn.execute("SELECT COUNT(*) FROM wisdom_review_queue").fetchone()[0] == 1
    # ⭐ PENDING is recounted fresh every call, not remembered — it is a live gauge, not a ledger
    assert first["records_pending"] == second["records_pending"] == 2


def test_the_reason_code_is_actionable():
    r = floor.reason("PRINCIPLE", 0.667, runs=3, run_id="ev-1")
    assert "PRINCIPLE" in r and "0.667" in r and "3 run(s)" in r and "ev-1" in r and f"{FLOOR:.3f}" in r
    assert "NULL (never measured)" in floor.reason("PRINCIPLE", None, runs=3)
    # Q17: a 1.0 blocked for too-few runs must NOT read "below the floor" — that reads as a
    # contradiction and sends an admin hunting a scoring bug that does not exist.
    few = floor.reason("PRINCIPLE", 1.0, runs=1)
    assert "only 1 run(s)" in few and f"minimum {floor.MIN_RUNS}" in few
    assert "below the floor" not in few
    assert "UNRECORDED" in floor.reason("PRINCIPLE", 1.0, runs=None)


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
    """Below-floor and at-floor rows of a floored type, plus an unfloored row.

    ⚰️ Until R89 the last two rows were a single NULL-stability CALL named `rec_call`, standing
    for "a type the floor must not touch". CALL is floored now, so it becomes a PAIR — one blocked,
    one passing — and LEVEL takes over as the unfloored control.
    """
    conn.execute("UPDATE wisdom_records SET stability = NULL")
    add_record(conn, "rec_low", "PRINCIPLE", "segLIVE1", "srcLIVE", author_id="tsdr", stability=0.667,
               stability_runs=3)
    add_record(conn, "rec_ok", "PRINCIPLE", "segLIVE1", "srcLIVE", author_id="tsdr", stability=1.0,
               stability_runs=3)
    add_record(conn, "rec_null", "MARKET_SIGNAL", "segLIVE1", "srcLIVE", author_id="tsdr")
    add_record(conn, "rec_call_low", "CALL", "segLIVE1", "srcLIVE", author_id="tsdr", ticker="NVDA",
               stability=0.4, stability_runs=5)
    add_record(conn, "rec_call_ok", "CALL", "segLIVE1", "srcLIVE", author_id="tsdr", ticker="NVDA",
               stability=1.0, stability_runs=3)
    add_record(conn, "rec_level", "LEVEL", "segLIVE1", "srcLIVE", author_id="tsdr", ticker="NVDA")
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
        levels = {r["record_id"] for r in common.select_records(conn, types=("LEVEL",))}

    assert "rec_ok" in got, "non-vacuity: an at-floor record MUST still come back"
    assert "rec_low" not in got and "rec_null" not in got
    # the opt-in returns them, which is what proves the filter is the thing doing the work
    assert {"rec_low", "rec_null", "rec_ok"} <= opened
    # R89: the same filter now governs CALL, with its own control
    assert "rec_call_ok" in calls, "non-vacuity: a passing CALL MUST still come back"
    assert "rec_call_low" not in calls, "R89: a below-floor CALL must not leave select_records"
    # and an unfloored type is untouched at NULL stability
    assert "rec_level" in levels


def test_clip_candidates_actually_withholds_a_below_floor_record(adapters_db, seeded):
    """⛔ M6 REGRESSION TEST. `AND 1=1` in place of the floor clause must make this RED."""
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import clips

    with store.write() as conn:
        _floor_fixture(conn)

    body = clips.clip_candidates(42)
    ids_out = {r["record_id"] for r in body["records"]}
    assert "rec_ok" in ids_out, "non-vacuity: an at-floor record MUST still be exported"
    assert "rec_call_ok" in ids_out, "non-vacuity: a passing CALL MUST still be exported"
    assert "rec_level" in ids_out, "non-vacuity: an unfloored type MUST still be exported"
    assert "rec_low" not in ids_out and "rec_null" not in ids_out
    # ⛔ R10 ruled FLOOR for this internal export; R89 added CALL to what that governs. The clause
    # is untyped, so CALL came under it the moment FLOORED_TYPES grew — no edit in clips.py.
    assert "rec_call_low" not in ids_out


# ── Q17 (R17: FLOOR, min runs 3) — BEHAVIOURAL, at all four sites ────────────
#
# ⛔⛔ WHY BEHAVIOURAL AND WHY AT ALL FOUR. Session 4 proved that asserting a site MENTIONS the
# floor module is not a guard: two sites could be bypassed entirely with the mention intact and
# the suite stayed green. Q17 adds a whole new blocking CONDITION, so each site is exercised
# through its real query with a real record.
#
# The case that motivates the ruling: stability = 1.0 over ONE run. It is the most
# confident-looking number the pipeline can produce for the least evidence — one run agreeing
# with itself is not agreement — and before Q17 it sailed through the floor at every site.

Q17_CASES = [
    # (label,            stability, runs, expected_pass)
    ("i_runs2_perfect",        1.0,    2, False),   # (i)   2 runs is below MIN_RUNS -> blocks
    ("ii_runs3_perfect",       1.0,    3, True),    # (ii)  the intended 3/3
    ("iii_runs5_at_floor",     0.8,    5, True),    # (iii) FLOOR semantics: 4/5 passes
    ("iv_runs5_below",         0.6,    5, False),   # (iv)
    ("v_runsnull_perfect",     1.0, None, False),   # (v)   unrecorded denominator -> blocks
    ("vi_runs1_perfect",       1.0,    1, False),   # the ruling's motivating case
]


def _seed_q17(conn):
    """One record per Q17 case, plus an UNFLOORED control that must survive every combination.

    ⚰️ The control was `q17_call`, a NULL-stability CALL, until R89 floored CALL — at which point
    a control asserting "this still comes back" would have been asserting the opposite of the new
    ruling. It is a LEVEL now; the CALL cases moved into the R89 section above, where they are
    seeded with real scores instead of standing for "unfloored".
    """
    for label, stab, runs, _ in Q17_CASES:
        add_record(conn, f"q17_{label}", "PRINCIPLE", "segLIVE1", "srcLIVE", author_id="tsdr",
                   stability=stab, stability_runs=runs)
    add_record(conn, "q17_level", "LEVEL", "segLIVE1", "srcLIVE", author_id="tsdr", ticker="NVDA")
    conn.commit()


def _expected_pass_ids():
    return {f"q17_{label}" for label, _, _, ok in Q17_CASES if ok}


def _expected_block_ids():
    return {f"q17_{label}" for label, _, _, ok in Q17_CASES if not ok}


def _expected_true_block_ids():
    """R79: of the non-publishing Q17 cases, only the ones MEASURED and below the floor — never
    the ones still waiting on more passes."""
    return {f"q17_{label}" for label, stab, runs, ok in Q17_CASES
            if not ok and runs is not None and int(runs) >= floor.MIN_RUNS}


def _expected_pending_ids():
    return _expected_block_ids() - _expected_true_block_ids()


def test_q17_site1_select_records(adapters_db, seeded):
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import common

    with store.write() as conn:
        _seed_q17(conn)
    with store.read() as conn:
        got = {r["record_id"] for r in common.select_records(conn, types=("PRINCIPLE",))
               if r["record_id"].startswith("q17_")}
        levels = {r["record_id"] for r in common.select_records(conn, types=("LEVEL",))}
    assert _expected_pass_ids() <= got, "non-vacuity: the passing cases MUST come back"
    assert not (_expected_block_ids() & got)
    assert "q17_level" in levels, "an unfloored type is untouched by the runs condition"


def test_q17_site4_clip_candidates(adapters_db, seeded):
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import clips

    with store.write() as conn:
        _seed_q17(conn)
    out = {r["record_id"] for r in clips.clip_candidates(42)["records"]}
    assert _expected_pass_ids() <= out
    assert not (_expected_block_ids() & out)
    assert "q17_level" in out


def test_q17_site2_brainkb_export(adapters_db, seeded, monkeypatch):
    """The Brain KB lane reads wisdom_principles directly, so its runs column is the one tested."""
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import brainkb

    with store.write() as conn:
        # a 1.0 over ONE run — the case Q17 exists for
        conn.execute("UPDATE wisdom_principles SET stability = 1.0, stability_runs = 1")
        brainkb.stage(conn, brainkb.build_rows(conn))
    monkeypatch.setenv("WISDOM_BRAINKB_PUBLISH_ENABLED", "1")
    blocked = brainkb.export_payload()
    assert len(blocked["below_floor_dropped"]) == 1, "1.0 over one run must NOT publish"

    with store.write() as conn:
        conn.execute("UPDATE wisdom_principles SET stability_runs = ?", (floor.MIN_RUNS,))
    passing = brainkb.export_payload()
    assert passing["below_floor_dropped"] == [], "non-vacuity: at MIN_RUNS the same row publishes"


def test_q17_site3_retrieval_search(adapters_db, seeded, monkeypatch):
    """Ask-AI reaches PRINCIPLE through the FTS index; the floor joins on the pr: doc-id prefix."""
    from api.services.wisdom.core import store
    from api.services.wisdom.publish import retrieval

    monkeypatch.setenv("WISDOM_RETRIEVAL_INDEX_ENABLED", "1")
    with store.write() as conn:
        conn.execute("UPDATE wisdom_principles SET stability = 1.0, stability_runs = 1")
    retrieval.refresh()
    with store.read() as conn:
        statement = conn.execute("SELECT statement FROM wisdom_principles LIMIT 1").fetchone()
    query = " ".join(str(statement[0]).split()[:6])

    blocked = [h for h in retrieval.search(query, limit=20, for_request=False)
               if str(h["doc_id"]).startswith("pr:")]
    assert blocked == [], "1.0 over one run must not be retrievable as a principle doc"
    # the owner-sourcing lane still sees it, which is what proves the filter and not an empty index
    opened = [h for h in retrieval.search(query, limit=20, for_request=False, include_unstable=True)
              if str(h["doc_id"]).startswith("pr:")]
    assert opened, "non-vacuity: the principle doc IS in the index"

    with store.write() as conn:
        conn.execute("UPDATE wisdom_principles SET stability_runs = ?", (floor.MIN_RUNS,))
    now_ok = [h for h in retrieval.search(query, limit=20, for_request=False)
              if str(h["doc_id"]).startswith("pr:")]
    assert now_ok, "non-vacuity: at MIN_RUNS the same doc is retrievable again"


def test_q17_a_blocked_single_run_record_is_enqueued_once(adapters_db, seeded):
    """⚰️⚰️ R79 (2026-09-18) REVERSES THIS TEST'S OWN HEADLINE CLAIM. It used to assert that
    `vi_runs1_perfect` — Q17's motivating case, 1.0 stability over ONE run — both blocks AND
    enqueues. It still blocks (that half of Q17 is untouched: `passes()` is unchanged). **It no
    longer enqueues.** Under R79 a record measured over fewer than MIN_RUNS passes is PENDING —
    an unfinished measurement, not a verdict — and only `iv_runs5_below` (0.6 over 5 runs: measured
    AND below the floor) is a genuine BLOCK that belongs in the owner's queue.
    """
    from api.services.wisdom.core import store

    with store.write() as conn:
        _seed_q17(conn)
        first = floor.enqueue_blocked(conn)
        second = floor.enqueue_blocked(conn)
        refs = {r[0] for r in conn.execute(
            "SELECT subject_ref FROM wisdom_review_queue WHERE subject_ref LIKE 'record:q17_%'")}
    assert refs == {f"record:{rid}" for rid in _expected_true_block_ids()}
    assert refs == {"record:q17_iv_runs5_below"}, "the ONLY Q17 case that is a real verdict"
    assert not (refs & {f"record:{rid}" for rid in _expected_pending_ids()}), (
        "a PENDING Q17 case reached the queue — that is exactly what R79 forbids")
    # ⚠️ NOT compared to len(_expected_true_block_ids()): the seeded corpus carries its own
    # NULL-stability PRINCIPLE, so the run legitimately enqueues more than the Q17 fixtures.
    # What must hold is that the real Q17 blocker is there, none of the passers or pendings is,
    # and a second run adds nothing.
    assert first["enqueued"] >= len(_expected_true_block_ids())
    assert second["enqueued"] == 0
    assert not (refs & {f"record:{rid}" for rid in _expected_pass_ids()})
    assert first["records_pending"] >= len(_expected_pending_ids()), (
        "i, v and vi must still be COUNTED even though none of them queues")


def test_q17_min_runs_has_one_definition_and_no_env_override():
    """⛔ A publication floor that can be lowered from the environment is not a floor."""
    import ast
    import pathlib

    src = (pathlib.Path(__file__).resolve().parents[1] / "api" / "services" / "wisdom"
           / "publish" / "floor.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    assigns = [n for n in tree.body if isinstance(n, ast.Assign)
               and any(getattr(t, "id", None) == "MIN_RUNS" for t in n.targets)]
    assert len(assigns) == 1, "MIN_RUNS must be bound exactly once"
    assert isinstance(assigns[0].value, ast.Constant), "MIN_RUNS must be a literal, not a lookup"
    assert "environ" not in src.split("MIN_RUNS")[1][:400]


def test_the_floor_boundary_is_exactly_STABILITY_FLOOR_not_merely_near_it():
    """⛔⛔ MUTATION vii CAUGHT THIS FILE OUT. Replacing `floor_value()` with the literal 0.79
    passed all 38 tests, because every fixture value (1.0, 0.8, 0.667, 0.6, 0.0) lands on the
    same side of 0.79 as it does of 0.8. A suite that cannot distinguish the real threshold from
    a near neighbour is not pinning the threshold at all — it is pinning the fixtures.

    ⭐ The fix is a probe placed strictly BETWEEN the two candidates, so the two spellings
    disagree about it. This is the general shape: to pin a boundary you need a value that only
    the correct boundary classifies correctly.
    """
    f = floor.floor_value()
    just_below = f - 0.005          # 0.795 against a 0.8 floor
    just_above = f + 0.005
    assert floor.passes("PRINCIPLE", just_below, floor.MIN_RUNS) is False, (
        f"a score of {just_below} must NOT clear a floor of {f}; a 0.79 literal would pass it")
    assert floor.passes("PRINCIPLE", f, floor.MIN_RUNS) is True, "the floor itself must pass"
    assert floor.passes("PRINCIPLE", just_above, floor.MIN_RUNS) is True

    # and the SQL spelling must agree on the same probe, or the two can still drift apart
    conn = _db()
    conn.executemany(
        "INSERT INTO wisdom_records (record_id, record_type, stability, stability_runs) VALUES (?,?,?,?)",
        [("below", "PRINCIPLE", just_below, floor.MIN_RUNS),
         ("at", "PRINCIPLE", f, floor.MIN_RUNS),
         ("above", "PRINCIPLE", just_above, floor.MIN_RUNS)])
    assert set(_rows(conn)) == {"at", "above"}


def test_the_min_runs_boundary_is_exact_too():
    """Same argument, the other axis: MIN_RUNS-1 must block and MIN_RUNS must pass."""
    assert floor.passes("PRINCIPLE", 1.0, floor.MIN_RUNS - 1) is False
    assert floor.passes("PRINCIPLE", 1.0, floor.MIN_RUNS) is True
    assert floor.passes("PRINCIPLE", 1.0, floor.MIN_RUNS + 1) is True
