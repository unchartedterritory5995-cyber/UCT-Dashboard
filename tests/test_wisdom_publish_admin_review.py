"""Wisdom review queue (stream S-F): CRUD, owner actions, golden-set growth,
contradictions and the file loader.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. the tab / status vocabulary drifting from the contract DDL's CHECK lists.
2. a decided question being asked again when a job re-enqueues it.
3. one item decided twice (double click, two tabs) or an action landing twice.
4. golden growth from the wrong tabs, or with the wrong label standing.
5. a contradiction resolved without the ruling written down.
6. the loader stopping on a bad line, or echoing a line's content in its report.

All data is synthetic. Every store is a tmp_path wisdom.db.
"""
from __future__ import annotations

import json
import pathlib
import re
from datetime import datetime

import pytest

from api.services.wisdom.core import store, timeutil
from api.services.wisdom.publish import review, schema

REPO = pathlib.Path(__file__).resolve().parents[1]
NOW = datetime(2026, 9, 14, 19, 0, tzinfo=timeutil.ET)


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    applied = store.init_db()
    assert {name for name, _ in schema.OWN_MIGRATIONS} <= set(applied)
    return tmp_path / "wisdom.db"


def _check_list(ddl: str, table: str, column: str) -> tuple:
    body = re.search(rf"CREATE TABLE IF NOT EXISTS {table} \((.*?)\n\);", ddl, re.S).group(1)
    line = next(ln for ln in body.splitlines() if ln.strip().startswith(column))
    return tuple(re.findall(r"'([a-z_]+)'", line.split("CHECK", 1)[1]))


def _golden_item(conn, subject="golden:G-900", new=None, old=None, tab="golden"):
    return review.enqueue(conn, tab=tab, subject_ref=subject, summary="label check",
                          old=old, new=new if new is not None else {"record_type": "CALL", "ticker": "ZZZT"},
                          evidence={"locator": "src-1#seg-2"}, now=NOW)


# ── 1. vocabulary is derived from the contract, not restated ────────────────

def test_tabs_and_statuses_match_the_contract_check_constraints():
    ddl = (REPO / "docs" / "wisdom" / "contracts" / "wisdom-db-v0.sql").read_text(encoding="utf-8")
    assert _check_list(ddl, "wisdom_review_queue", "tab") == review.TABS
    assert _check_list(ddl, "wisdom_review_queue", "status") == review.STATUSES
    # non-vacuity: the parser really reads a CHECK list (nine tabs, four statuses)
    assert len(review.TABS) == 9 and set(review.ACTIONS.values()) == set(review.STATUSES) - {"open"}


def test_every_own_migration_is_publish_prefixed_unique_and_additive():
    names = [name for name, _ in schema.OWN_MIGRATIONS]
    assert len(names) == len(set(names)) and all(n.startswith("publish_") for n in names)
    for _, sql in schema.OWN_MIGRATIONS:
        assert not re.search(r"\b(DROP|DELETE|ALTER TABLE \w+ DROP)\b", sql, re.I)


def test_adapter_migrations_are_appended_and_a_duplicate_name_is_skipped():
    own = [("publish_001_reports", "SELECT 1;")]
    adapters = [("publish_101_kb_rows", "SELECT 2;"), ("publish_001_reports", "SELECT 3;")]
    assert schema.compose(own, adapters) == [("publish_001_reports", "SELECT 1;"),
                                              ("publish_101_kb_rows", "SELECT 2;")]
    # the adapters package does not exist on this base: its absence is not an error
    assert schema.module_available("api.services.wisdom.publish.adapters.schema") in (True, False)
    assert schema.module_available("api.services.wisdom.no_such_pkg.schema") is False


# ── 2. enqueue ───────────────────────────────────────────────────────────────

def test_enqueue_is_idempotent_and_never_reopens_a_decided_item(db):
    with store.write() as conn:
        first = _golden_item(conn)
        again = _golden_item(conn)
    assert first["created"] is True and again == {**first, "created": False}
    with store.write() as conn:
        review.act(conn, first["item_id"], action="veto", actor="owner@example.test", now=NOW)
    with store.write() as conn:
        after = _golden_item(conn)
        other = _golden_item(conn, new={"record_type": "MENTION", "ticker": "ZZZT"})
    assert after == {"item_id": first["item_id"], "created": False, "status": "vetoed"}
    assert other["created"] is True and other["item_id"] != first["item_id"]
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_review_queue").fetchone()[0] == 2


def test_enqueue_refuses_unknown_tabs_and_empty_subjects(db):
    with store.write() as conn:
        with pytest.raises(review.InvalidReviewInput):
            review.enqueue(conn, tab="journal", subject_ref="x", summary="y")
        with pytest.raises(review.InvalidReviewInput):
            review.enqueue(conn, tab="golden", subject_ref="  ", summary="y")


# ── 3. acting ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("verb,status", [("accept", "accepted"), ("veto", "vetoed"), ("resolve", "resolved")])
def test_each_action_moves_the_item_and_writes_one_action_row(db, verb, status):
    with store.write() as conn:
        item = review.enqueue(conn, tab="sources", subject_ref="source:abc", summary="coverage", now=NOW)
    with store.write() as conn:
        out = review.act(conn, item["item_id"], action=verb.upper(), actor="owner@example.test",
                         note="checked", now=NOW)
    assert out["status"] == status and out["golden_candidate_id"] is None
    with store.read() as conn:
        got = review.get_item(conn, item["item_id"])
    assert got["status"] == status and got["resolved_by"] == "owner@example.test"
    assert [(a["action"], a["note"]) for a in got["actions"]] == [(verb, "checked")]


def test_an_item_is_decided_once_and_the_second_answer_conflicts(db):
    with store.write() as conn:
        item = _golden_item(conn)
    with store.write() as conn:
        review.act(conn, item["item_id"], action="accept", actor="owner@example.test", now=NOW)
    with pytest.raises(review.ItemNotOpen):
        with store.write() as conn:
            review.act(conn, item["item_id"], action="veto", actor="owner@example.test", now=NOW)
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_review_actions").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM wisdom_golden_candidates").fetchone()[0] == 1
        assert review.get_item(conn, item["item_id"])["status"] == "accepted"


def test_unknown_actions_and_items_are_refused(db):
    with store.write() as conn:
        item = _golden_item(conn)
        with pytest.raises(review.InvalidReviewInput):
            review.act(conn, item["item_id"], action="delete", actor="owner@example.test")
        with pytest.raises(review.ItemNotFound):
            review.act(conn, "0" * 24, action="accept", actor="owner@example.test")
        with pytest.raises(review.InvalidReviewInput):
            review.act(conn, item["item_id"], action="accept", actor="owner@example.test", note="x" * 5000)


def test_resolving_a_contradiction_needs_the_ruling_written_down(db):
    with store.write() as conn:
        item = review.enqueue(conn, tab="contradictions", subject_ref="principle:p|record:r", summary="pair")
    with pytest.raises(review.InvalidReviewInput):
        with store.write() as conn:
            review.act(conn, item["item_id"], action="resolve", actor="owner@example.test", note="  ")
    with store.write() as conn:  # control: accept needs no note; resolve with a ruling succeeds elsewhere
        assert review.act(conn, item["item_id"], action="accept", actor="owner@example.test")["status"] == "accepted"


# ── 4. golden-set growth ─────────────────────────────────────────────────────

def test_accepting_a_golden_item_records_the_new_label_as_a_candidate(db):
    with store.write() as conn:
        item = _golden_item(conn, old={"record_type": "MENTION"}, new={"record_type": "CALL", "author_id": "tsdr"})
        out = review.act(conn, item["item_id"], action="accept", actor="owner@example.test",
                         actor_is_owner=True, now=NOW)
    with store.read() as conn:
        (cand,) = review.golden_candidates(conn)
    assert cand["candidate_id"] == out["golden_candidate_id"]
    assert cand["verdict"] == "accepted" and cand["verified_by"] == "owner"
    assert cand["expected"] == {"record_type": "CALL", "author_id": "tsdr"}
    assert cand["rejected"] == {"record_type": "MENTION"}
    assert (cand["record_type"], cand["author_id"], cand["locator"]) == ("CALL", "tsdr", "src-1#seg-2")
    assert cand["split"] in ("dev", "test")


def test_vetoing_an_extraction_with_no_prior_label_records_no_record_as_the_truth(db):
    with store.write() as conn:
        item = _golden_item(conn, tab="extraction_audit", subject="record:r-1")
        review.act(conn, item["item_id"], action="veto", actor="second@example.test", now=NOW)
    with store.read() as conn:
        (cand,) = review.golden_candidates(conn)
    assert cand["expected"] == {"no_record": True} and cand["verified_by"] == "reviewer"
    assert cand["rejected"]["record_type"] == "CALL"


@pytest.mark.parametrize("tab,verb", [("vocabulary", "accept"), ("capture", "veto"), ("golden", "resolve")])
def test_non_extraction_tabs_and_resolve_never_grow_the_golden_set(db, tab, verb):
    with store.write() as conn:
        item = review.enqueue(conn, tab=tab, subject_ref=f"{tab}:1", summary="s", new={"x": 1})
        review.act(conn, item["item_id"], action=verb, actor="owner@example.test", note="n")
    with store.read() as conn:
        assert review.golden_candidates(conn) == []


def test_the_fallback_split_is_deterministic_and_uses_both_halves():
    splits = {review.split_for(f"k{i}") for i in range(40)}
    assert splits == {"dev", "test"}
    assert review.split_for("k7") == review.split_for("k7")


# ── reading ──────────────────────────────────────────────────────────────────

def test_counts_carry_every_tab_with_zeros_and_real_totals(db):
    with store.write() as conn:
        a = _golden_item(conn)
        review.enqueue(conn, tab="authors", subject_ref="author:guest", summary="fifth author?")
        review.act(conn, a["item_id"], action="accept", actor="owner@example.test")
    with store.read() as conn:
        c = review.counts(conn)
        open_golden = review.list_items(conn, tab="golden", status="open")
        all_golden = review.list_items(conn, tab="golden", status="all")
    assert set(c["tabs"]) == set(review.TABS)
    assert c["tabs"]["golden"] == {"open": 0, "accepted": 1, "vetoed": 0, "resolved": 0, "total": 1}
    assert c["tabs"]["authors"]["open"] == 1 and c["tabs"]["drafts"]["total"] == 0
    assert c["totals"]["total"] == 2
    assert open_golden == [] and [i["status"] for i in all_golden] == ["accepted"]


# ── 5. contradictions ────────────────────────────────────────────────────────

def _seed_contradiction(conn, canonical=None):
    conn.execute("INSERT INTO wisdom_sources (source_id, stream, external_ref, raw_sha256, ingest_version, "
                 "ingested_at) VALUES ('s1', 'zoom_live', 'edu_videos:1', 'h', 'v0', '2026-09-01')")
    conn.execute("INSERT INTO wisdom_segments (segment_id, source_id, source_version, ordinal, kind, text, "
                 "text_sha256, normalizer_version) VALUES ('g1', 's1', 1, 0, 'cue_window', 'synthetic', 'h', 'n0')")
    conn.execute("INSERT INTO wisdom_records (record_id, record_type, segment_id, source_id, source_version, "
                 "extractor_version, record_hash, author_id, stated_at_et, extraction_confidence, created_at) "
                 "VALUES ('r1', 'PRINCIPLE', 'g1', 's1', 1, 'x0', 'rh', 'tsdr', '2026-09-10T10:00:00-04:00', "
                 "'high', '2026-09-10')")
    conn.execute("INSERT INTO wisdom_principles (principle_key, statement, category, author_id, canonical, "
                 "first_seen_at) VALUES ('ma_line', 'synthetic paraphrase', 'risk', 'tsdr', ?, '2026-09-06')",
                 (canonical,))
    conn.execute("INSERT INTO wisdom_principle_support VALUES ('ma_line', 'r1', 'contradicts')")


def test_contradictions_are_queued_side_by_side_with_a_recommendation_once(db):
    with store.write() as conn:
        _seed_contradiction(conn)
        first = review.refresh_contradictions(conn, now=NOW)
        second = review.refresh_contradictions(conn, now=NOW)
    assert first == {"pairs": 1, "enqueued": 1, "refreshed": 0, "already_decided": 0}
    assert second == {"pairs": 1, "enqueued": 0, "refreshed": 1, "already_decided": 0}
    with store.read() as conn:
        (item,) = review.list_items(conn, tab="contradictions")
        detail = review.get_item(conn, item["item_id"])
    left, right = detail["evidence"]["side_by_side"]
    assert left["locator"] == "principle:ma_line" and right["locator"] == "s1#g1"
    assert "2026-09-10" in detail["recommendation"] and "both with dates" in detail["recommendation"]


def test_a_canonical_principle_is_recommended_to_stand(db):
    with store.write() as conn:
        _seed_contradiction(conn, canonical=1)
        review.refresh_contradictions(conn, now=NOW)
        (item,) = review.list_items(conn, tab="contradictions")
    assert item["recommendation"].startswith("Keep the canonical principle")


# ── 6. loader ────────────────────────────────────────────────────────────────

def test_the_loader_imports_rows_reports_bad_lines_by_number_and_is_idempotent(db):
    lines = [
        json.dumps({"gid": "G-031", "record_type": "CALL", "old_label": {"stance": "watching"},
                    "new_label": {"stance": "taking"}, "evidence": {"bars": "text+bars"}}),
        "",
        "{not json SECRET-QUOTE",
        json.dumps({"tab": "journal", "subject_ref": "x", "summary": "y"}),
        json.dumps({"tab": "vocabulary", "subject_ref": "vocab:kill_bar", "summary": "promote?",
                    "new": {"status": "approved"}}),
    ]
    with store.write() as conn:
        first = review.import_queue_rows(conn, lines, now=NOW)
        second = review.import_queue_rows(conn, lines, now=NOW)
    assert (first["rows"], first["created"], first["refreshed"]) == (4, 2, 0)
    assert [e["line"] for e in first["errors"]] == [3, 4]
    assert "SECRET-QUOTE" not in json.dumps(first)
    assert (second["created"], second["refreshed"]) == (0, 2)
    with store.read() as conn:
        golden = review.list_items(conn, tab="golden")
    assert [g["subject_ref"] for g in golden] == ["golden:G-031"]
