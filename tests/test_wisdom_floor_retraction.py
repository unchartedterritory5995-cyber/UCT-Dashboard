"""R47 — a floor-block review item RESOLVES when its record later passes, and is never deleted.

⛔⛔ WHY THIS MATTERS AND WHY IT IS DELICATE. `enqueue_blocked` was one-way: a record that later
cleared the floor kept its open row forever, so the owner's queue drifted away from what is
actually blocked. Measured 2026-09-15 after R43 moved MARKET_SIGNAL's identity: **103 records
blocked, 153 open rows**.

The fix touches somebody's INBOX, so the failure modes are the ones to guard:
  * resolving an item for a record that is still blocked — the owner loses a real signal;
  * resolving somebody ELSE's item — `extract/writer.py:667-670` enqueues an inferred-ticker item
    with the identical `record:{record_id}` subject_ref on a different tab;
  * reopening or re-resolving an item a PERSON already decided;
  * DELETING rather than resolving, which destroys the record of what was once blocked.

⭐ Every fixture writes a real store through the real schema; nothing here stubs the queue.
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))


@pytest.fixture()
def store_conn(tmp_path, monkeypatch):
    """A real wisdom store on a temp path, migrated by the real runner."""
    import conftest as root_conftest

    sandbox = tmp_path / "sandbox"
    sandbox.mkdir()
    _, pins, _ = root_conftest.shared_data_root_census()
    for env, literal in pins.items():
        monkeypatch.setenv(env, literal.replace("/data", str(sandbox)))
    db = tmp_path / "wisdom.db"
    monkeypatch.setenv("DATA_DIR", str(sandbox))
    monkeypatch.setenv("WISDOM_DB_PATH", str(db))

    from api.services.wisdom.core import store

    store.init_db(str(db))
    return store


def _segment(conn, segment_id="seg-1"):
    conn.execute("INSERT OR IGNORE INTO wisdom_sources (source_id, stream, external_ref, version, "
                 "guest_names_json, raw_sha256, incomplete, ingest_version, ingested_at) "
                 "VALUES ('src-1','zoom_live','test:1',1,'[]','x',0,'test','2026-09-15')")
    conn.execute("INSERT OR IGNORE INTO wisdom_segments (segment_id, source_id, source_version, "
                 "ordinal, kind, text, text_sha256, normalizer_version) "
                 "VALUES (?, 'src-1', 1, 0, 'section', 't', 'h', 'test')", (segment_id,))


def _record(conn, record_id, *, rtype="PRINCIPLE", stability=None, runs=None):
    _segment(conn)
    conn.execute(
        "INSERT OR REPLACE INTO wisdom_records (record_id, record_type, segment_id, source_id, "
        "source_version, extractor_version, record_hash, status, has_private, created_at, "
        "extraction_confidence, stability, stability_runs) "
        "VALUES (?,?,?,'src-1',1,'v0',?,'provisional',0,'2026-09-15','high',?,?)",
        (record_id, rtype, "seg-1", record_id, stability, runs))


def _open_floor_rows(conn, record_id):
    return conn.execute(
        "SELECT item_id, status FROM wisdom_review_queue WHERE tab='contradictions' "
        "AND subject_ref = ? AND json_extract(new_json,'$.reason')='below_publication_floor'",
        (f"record:{record_id}",)).fetchall()


# ── the behaviour ────────────────────────────────────────────────────────────

def test_a_record_that_starts_passing_has_its_item_resolved(store_conn):
    from api.services.wisdom.publish import floor

    with store_conn.write() as conn:
        _record(conn, "r-passes", stability=0.3333, runs=3)
        first = floor.enqueue_blocked(conn)
        assert first["enqueued"] == 1, "the fixture did not actually enqueue — nothing to retract"
        # the record now clears the floor
        conn.execute("UPDATE wisdom_records SET stability = 1.0 WHERE record_id = 'r-passes'")
        out = floor.retract_passed(conn)
        assert out["retracted"] == 1, out
        rows = _open_floor_rows(conn, "r-passes")
        assert len(rows) == 1, "the item was DELETED, not resolved"
        assert rows[0]["status"] == "resolved"


def test_a_record_still_blocked_keeps_its_item_open(store_conn):
    """⛔ The owner must not lose a live signal."""
    from api.services.wisdom.publish import floor

    with store_conn.write() as conn:
        _record(conn, "r-blocked", stability=0.6667, runs=3)
        floor.enqueue_blocked(conn)
        out = floor.retract_passed(conn)
        assert out["retracted"] == 0, out
        rows = _open_floor_rows(conn, "r-blocked")
        assert len(rows) == 1 and rows[0]["status"] == "open"


def test_a_record_that_always_passed_has_no_item_at_all(store_conn):
    from api.services.wisdom.publish import floor

    with store_conn.write() as conn:
        _record(conn, "r-clean", stability=1.0, runs=3)
        assert floor.enqueue_blocked(conn)["enqueued"] == 0
        assert floor.retract_passed(conn)["retracted"] == 0
        assert _open_floor_rows(conn, "r-clean") == []


def test_an_item_a_person_resolved_is_never_touched(store_conn):
    """⭐ Free, because review.act refuses anything not open — but pinned, because 'free' is a
    property of another module that could change."""
    from api.services.wisdom.publish import floor, review

    with store_conn.write() as conn:
        _record(conn, "r-hand", stability=0.3333, runs=3)
        floor.enqueue_blocked(conn)
        item_id = _open_floor_rows(conn, "r-hand")[0]["item_id"]
        review.act(conn, item_id, action="veto", actor="patrick", note="mine")
        conn.execute("UPDATE wisdom_records SET stability = 1.0 WHERE record_id = 'r-hand'")
        out = floor.retract_passed(conn)
        assert out["retracted"] == 0, "the floor overwrote a decision a person had made"
        row = conn.execute("SELECT status, resolved_by FROM wisdom_review_queue WHERE item_id = ?",
                           (item_id,)).fetchone()
        assert row["status"] == "vetoed" and row["resolved_by"] == "patrick"


def test_it_never_touches_another_tabs_item_with_the_same_subject_ref(store_conn):
    """⛔ writer.py:667-670 uses the SAME `record:{id}` subject_ref on `extraction_audit`."""
    from api.services.wisdom.publish import floor, review

    with store_conn.write() as conn:
        _record(conn, "r-shared", stability=1.0, runs=3)
        review.enqueue(conn, tab="extraction_audit", subject_ref="record:r-shared",
                       summary="an inferred ticker needs a look", new={"reason": "inferred_ticker"})
        out = floor.retract_passed(conn)
        assert out["retracted"] == 0
        row = conn.execute("SELECT status FROM wisdom_review_queue WHERE tab='extraction_audit'").fetchone()
        assert row["status"] == "open", "a different tab's item was resolved"


def test_the_resolution_note_carries_no_text_field(store_conn):
    """⛔ §0.4f — counts and identifiers only."""
    from api.services.wisdom.publish import floor

    note = floor.retraction_note("PRINCIPLE", 1.0, 3, identity="MERGED_J05", today="2026-09-15")
    assert "PRINCIPLE" in note and "1.0" in note and "MERGED_J05" in note
    for banned in ("quote", "statement", "name="):
        assert banned not in note.lower()
    assert floor.RETRACTION_ACTOR in note


def test_the_actor_is_not_a_person(store_conn):
    """An automatic resolution must be distinguishable from a human one in the action log."""
    from api.services.wisdom.publish import floor

    with store_conn.write() as conn:
        _record(conn, "r-actor", stability=0.3333, runs=3)
        floor.enqueue_blocked(conn)
        conn.execute("UPDATE wisdom_records SET stability = 1.0 WHERE record_id = 'r-actor'")
        floor.retract_passed(conn)
        row = conn.execute("SELECT resolved_by FROM wisdom_review_queue WHERE subject_ref='record:r-actor'").fetchone()
        assert row["resolved_by"] == floor.RETRACTION_ACTOR != "patrick"


def test_the_chain_step_enqueues_before_it_retracts():
    """⛔ Order is load-bearing: retracting first would fight the enqueue and churn the queue."""
    src = (REPO / "api" / "services" / "wisdom" / "publish" / "floor.py").read_text(encoding="utf-8")
    body = src.split("def score_silently", 1)[1]
    assert body.index("enqueue_blocked(conn)") < body.index("retract_passed(conn)")


def test_a_second_run_changes_nothing(store_conn):
    from api.services.wisdom.publish import floor

    with store_conn.write() as conn:
        _record(conn, "r-idem", stability=0.3333, runs=3)
        floor.enqueue_blocked(conn)
        conn.execute("UPDATE wisdom_records SET stability = 1.0 WHERE record_id = 'r-idem'")
        assert floor.retract_passed(conn)["retracted"] == 1
        assert floor.retract_passed(conn)["retracted"] == 0
        assert floor.enqueue_blocked(conn)["enqueued"] == 0
