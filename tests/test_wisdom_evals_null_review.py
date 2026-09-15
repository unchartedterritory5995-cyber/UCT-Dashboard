"""RQ-v11-001 — a NULL false positive on PRINCIPLE/MARKET_SIGNAL is a review item, not a verdict.

⛔ The load-bearing property is a SPLIT: two types produce an item, four produce nothing. A test
that only checked "items are produced" would pass just as happily if every type produced one,
which is the exact failure the ruling exists to prevent — letting the weakest screen in the set
decide the extractor's verdict.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services.wisdom.evals import null_review


def _db() -> sqlite3.Connection:
    """The review queue's REAL DDL, lifted from the contract — not a relaxed stand-in that would
    accept a `tab` the production CHECK constraint refuses."""
    import pathlib
    import re

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    sql = (pathlib.Path(__file__).resolve().parents[1] / "docs" / "wisdom" / "contracts"
           / "wisdom-db-v0.sql").read_text(encoding="utf-8")
    match = re.search(r"CREATE TABLE IF NOT EXISTS wisdom_review_queue \(.*?\n\);", sql, re.S)
    assert match, "the review-queue DDL moved; this fixture must follow it"
    conn.execute(match.group(0))
    assert null_review.REVIEW_TAB in match.group(0), (
        f"{null_review.REVIEW_TAB!r} is not an allowed review tab — enqueue would be refused in production")
    return conn


NULL_ROW = {
    "gid": "g-null-1",
    "locator": "wisdom:srcX#segX@0-40",
    "status": "provisional",
    "verification": "lexicon_screen+read",
    "verified_by": "owner",
    "evidence": {"null_checks": {"principle_lexicon": [], "signal_lexicon": [],
                                 "cashtags": [], "prices": []}},
}


# ── the split ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("rtype", null_review.JUDGEMENT_TYPES)
def test_one_item_per_null_per_judgement_type(rtype):
    items = null_review.items_for_segment("seg-1", {rtype: 2}, null_row=NULL_ROW, run_id="ev-1")
    assert len(items) == 1
    item = items[0]
    assert item["subject_ref"] == f"null_segment:seg-1#{rtype}"
    assert item["new"]["reason"] == "RQ-v11-001"
    assert item["new"]["record_type"] == rtype and item["new"]["false_positives"] == 2
    assert item["new"]["run_id"] == "ev-1"
    assert item["new"]["human_read"]["status"] == "provisional"
    assert item["evidence"]["screen"] == "lexicon_screen+read"


@pytest.mark.parametrize("rtype", null_review.MECHANICAL_TYPES)
def test_no_item_is_emitted_for_a_mechanical_type(rtype):
    """⛔ THE RULING. These four rest on a mechanical screen, so their false positives are
    MEASUREMENTS and must produce nothing here, however many there are."""
    assert null_review.items_for_segment("seg-1", {rtype: 9}, null_row=NULL_ROW) == []


def test_the_split_is_exactly_two_of_six():
    """Non-vacuity: a module that emitted for everything, or nothing, would pass a one-sided test."""
    every_type = {t: 1 for t in (*null_review.JUDGEMENT_TYPES, *null_review.MECHANICAL_TYPES)}
    items = null_review.items_for_segment("seg-1", every_type, null_row=NULL_ROW)
    assert {i["new"]["record_type"] for i in items} == set(null_review.JUDGEMENT_TYPES)
    assert len(items) == 2
    assert len(every_type) == 6, "control: all six types really were offered"


def test_a_zero_count_emits_nothing():
    assert null_review.items_for_segment("seg-1", {"PRINCIPLE": 0, "MARKET_SIGNAL": 0},
                                         null_row=NULL_ROW) == []
    assert null_review.items_for_segment("seg-1", {}, null_row=NULL_ROW) == []


# ── evidence is real, not asserted ───────────────────────────────────────────

def test_lexicon_hits_come_from_the_rows_stored_screen():
    row = {**NULL_ROW, "evidence": {"null_checks": {"principle_lexicon": ["always", "never"],
                                                    "signal_lexicon": ["breadth"]}}}
    [p] = null_review.items_for_segment("s", {"PRINCIPLE": 1}, null_row=row)
    [m] = null_review.items_for_segment("s", {"MARKET_SIGNAL": 1}, null_row=row)
    assert p["new"]["lexicon_hits"] == ["always", "never"]
    assert m["new"]["lexicon_hits"] == ["breadth"]


def test_a_missing_screen_is_reported_as_empty_not_invented():
    [item] = null_review.items_for_segment("s", {"PRINCIPLE": 1}, null_row={"gid": "g"})
    assert item["new"]["lexicon_hits"] == []
    assert item["new"]["human_read"] == {"status": None, "verification": None, "verified_by": None}


# ── enqueue + idempotence ────────────────────────────────────────────────────

SCORES = {
    "seg-a": {"null_fp": {"PRINCIPLE": 1, "CALL": 3}},          # 1 item (CALL suppressed)
    "seg-b": {"null_fp": {"MARKET_SIGNAL": 2, "LEVEL": 1}},     # 1 item (LEVEL suppressed)
    "seg-c": {"null_fp": {"MENTION": 5}},                       # 0 items
    "seg-d": {"null_fp": {}},                                   # 0 items
}


def test_enqueue_writes_one_row_per_segment_per_judgement_type():
    conn = _db()
    out = null_review.enqueue_for_run(conn, SCORES, null_rows={"seg-a": NULL_ROW}, run_id="ev-9")
    assert out["emitted"] == 2 and out["created"] == 2
    refs = [r[0] for r in conn.execute("SELECT subject_ref FROM wisdom_review_queue ORDER BY subject_ref")]
    assert refs == ["null_segment:seg-a#PRINCIPLE", "null_segment:seg-b#MARKET_SIGNAL"]
    # the mechanical types were present in the input and produced nothing
    assert not any("CALL" in r or "LEVEL" in r or "MENTION" in r for r in refs)


def test_rerunning_does_not_duplicate_a_row():
    """⛔ review.item_id_for keys on (tab, subject_ref, new), so a daily re-run is one row."""
    conn = _db()
    first = null_review.enqueue_for_run(conn, SCORES, run_id="ev-9")
    second = null_review.enqueue_for_run(conn, SCORES, run_id="ev-9")
    assert first["created"] == 2 and second["created"] == 0
    assert conn.execute("SELECT COUNT(*) FROM wisdom_review_queue").fetchone()[0] == 2


def test_every_enqueued_row_carries_the_reason_code_and_the_type():
    conn = _db()
    null_review.enqueue_for_run(conn, SCORES, run_id="ev-9")
    for row in conn.execute("SELECT summary, new_json, evidence_json FROM wisdom_review_queue"):
        assert "RQ-v11-001" in row["summary"]
        assert "RQ-v11-001" in row["new_json"]
        assert "lexicon_screen+read" in row["evidence_json"]
        assert "review item, not a verdict" in row["summary"]


# ── the numbers are untouched ────────────────────────────────────────────────

def test_this_module_computes_no_score_and_imports_no_scorer():
    """⛔ 3d: the NULL false-positive figure stays a MEASUREMENT with a queue beside it.

    `golden.score` owns those counts (golden.py:453-485). If this module ever imported it to
    adjust them, the weakest screen in the set would start deciding the extractor's verdict.
    """
    import ast
    import pathlib

    src = (pathlib.Path(__file__).resolve().parents[1] / "api" / "services" / "wisdom" / "evals"
           / "null_review.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    called = {n.func.attr for n in ast.walk(tree)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    assert "score" not in called
    assert "record_eval" not in called
    # it may READ golden for its kind constant, but must not write an eval or rescore
    assert "decide_gate" not in called


# ── chain wiring ─────────────────────────────────────────────────────────────

def test_the_step_runs_after_evals_and_before_the_publication_floor():
    from api.services.wisdom.publish import chain

    names = [s.name for s in chain.DAILY]
    assert "rq_v11_001" in names, names
    assert names.index("evals") < names.index("rq_v11_001") < names.index("publication_floor")
    step = next(s for s in chain.DAILY if s.name == "rq_v11_001")
    assert ("api.services.wisdom.evals.null_review", "score_silently") in step.targets
    assert step.gate is None, "a queue that can be switched off is a queue nobody trusts"


def test_the_daily_entry_point_is_a_no_op_with_no_gate_run(adapters_db):  # noqa: F811
    from api.services.wisdom.evals import null_review as nr

    out = nr.score_silently(object())
    assert out["created"] == 0 and out["skipped"] == "no gate run recorded"


from tests.test_wisdom_publish_adapters_store import adapters_db  # noqa: E402,F401
