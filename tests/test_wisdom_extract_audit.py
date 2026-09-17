"""Weekly extraction audit rails (stream S-D).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. an audit sample that is not reproducible for a week, or re-audits a segment;
2. a disagreement that does not reach the review queue, an agreement that does;
3. an audit pass that writes records, or a review item carrying a private value;
4. the audit running with its flag off, or at the same effort as extraction.
"""
from __future__ import annotations

import json
from datetime import timedelta

import pytest

from api.services.wisdom import registry
from api.services.wisdom.core import store, timeutil
from api.services.wisdom.extract import audit, batch, prompt, segmenter, writer
from tests.test_wisdom_extract_batch import FakeClient, output_for, succeeded

TEXTS = [f"Passed on YYYT, too thin, number {i}." for i in range(8)]


def ctx(**kw):
    base = dict(job_id="wisdom_test", now_et=timeutil.now_et(), due_key=None, force=False, dry_run=False,
                run_id="r")
    base.update(kw)
    return registry.JobContext(**base)


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setenv("WISDOM_EXTRACT_AUDIT_ENABLED", "1")
    monkeypatch.setattr(batch, "_page", lambda *a: None)
    store.init_db()
    version = prompt.extractor_version()
    now = timeutil.iso_et(timeutil.now_et())
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_sources (source_id, stream, external_ref, version, raw_sha256, ingest_version, "
                     "ingested_at) VALUES ('src1', 'sunday_scans', 'test:1', 1, 'x', 't', 't')")
        segs = [segmenter.Segment(ordinal=i, kind="section", text=t, char_start=0, char_end=len(t),
                                  author_id="tsdr", speaker_confidence="medium") for i, t in enumerate(TEXTS)]
        segmenter.write_segments(conn, "src1", 1, segs)
        for seg in segs:
            sid = seg.segment_id("src1", 1)
            conn.execute("INSERT INTO wisdom_extract_requests (custom_id, source_id, source_version, segment_ids_json, "
                         "extractor_version, attempt, status, segment_id, purpose, created_at, updated_at) "
                         "VALUES (?, 'src1', 1, '[]', ?, 1, 'done', ?, 'extract', ?, ?)",
                         (f"wx_done_{seg.ordinal}", version, sid, now, now))
    return [s.segment_id("src1", 1) for s in segs]


def test_the_sample_is_seeded_by_week_and_never_repeats_a_segment(env):
    week = audit.week_key(timeutil.now_et())
    with store.read() as conn:
        first = [s["segment_id"] for s in audit.select_segments(conn, prompt.extractor_version(), week, n=5)]
        again = [s["segment_id"] for s in audit.select_segments(conn, prompt.extractor_version(), week, n=5)]
        other = [s["segment_id"] for s in audit.select_segments(conn, prompt.extractor_version(), "1999-W01", n=5)]
    assert first == again and len(first) == 5 and set(first) <= set(env)
    assert other != first  # a different week draws a different sample
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_extract_requests (custom_id, source_id, source_version, segment_ids_json, "
                     "extractor_version, status, segment_id, purpose, created_at, updated_at) VALUES "
                     "('wa_x', 'src1', 1, '[]', ?, 'submitted', ?, 'audit', 't', 't')",
                     (prompt.extractor_version(), first[0]))
    with store.read() as conn:
        assert first[0] not in [s["segment_id"] for s in audit.select_segments(conn, prompt.extractor_version(), week, n=8)]


def test_only_a_disagreement_reaches_the_review_queue_and_no_record_is_written(env):
    with store.read() as conn:
        seg = writer.load_segment(conn, env[0])
        src = writer.load_source(conn, "src1", 1)
    stored = output_for(TEXTS[0], "NEGATIVE_CALL", "YYYT", stance="passed")
    version = prompt.extractor_version()
    with store.write() as conn:
        writer.write_output(conn, segment=seg, source=src, output=stored, extractor_version=version)
        agree = audit.compare_and_queue(conn, segment=seg, source=src, output=stored, extractor_version=version,
                                        custom_id="wa_1")
        differ = audit.compare_and_queue(
            conn, segment=seg, source=src, extractor_version=version, custom_id="wa_2",
            output=output_for(TEXTS[0], "CALL", "YYYT", direction="long", stance="in_it", entry=4321.5,
                              size_shares=8765))
    assert agree["agreement"] is True and "review_item_id" not in agree
    assert differ["agreement"] is False and differ["only_stored"] == 1 and differ["only_audit"] == 1
    with store.read() as conn:
        items = [dict(r) for r in conn.execute("SELECT * FROM wisdom_review_queue")]
        n_records = conn.execute("SELECT COUNT(*) FROM wisdom_records").fetchone()[0]
    assert len(items) == 1 and items[0]["tab"] == "extraction_audit" and n_records == 1
    blob = json.dumps(items)
    assert "8765" not in blob and "4321.5" not in blob
    assert json.loads(items[0]["old_json"]) == [["NEGATIVE_CALL", "YYYT", "passed", None]]


def test_the_audit_is_gated_submits_one_level_deeper_and_reaps_into_the_queue(env, monkeypatch):
    monkeypatch.delenv("WISDOM_EXTRACT_AUDIT_ENABLED")
    fake = FakeClient()
    assert audit.run_audit(ctx(), client=fake)["status"] == "skipped" and fake.messages.batches.created == []
    monkeypatch.setenv("WISDOM_EXTRACT_AUDIT_ENABLED", "1")
    monkeypatch.setenv("WISDOM_EXTRACT_ENABLED", "1")
    out = audit.run_audit(ctx(), client=fake, n=3)
    assert out["status"] == "submitted" and out["effort"] == "xhigh"
    reqs = fake.messages.batches.created[0]["requests"]
    assert len(reqs) == 3 and all(r["custom_id"].startswith("wa_") for r in reqs)
    assert {r["params"]["output_config"]["effort"] for r in reqs} == {"xhigh"}
    bid = fake.messages.batches.created[0]["id"]
    fake.messages.batches.state[bid] = "ended"
    with store.read() as conn:
        seg_by_cid = {r["custom_id"]: r["segment_id"] for r in conn.execute(
            "SELECT custom_id, segment_id FROM wisdom_extract_requests WHERE purpose = 'audit'")}
        texts = {r["segment_id"]: r["text"] for r in conn.execute("SELECT segment_id, text FROM wisdom_segments")}
    fake.messages.batches.results_map[bid] = [
        succeeded(cid, output_for(texts[sid], "MENTION", "YYYT")) for cid, sid in seg_by_cid.items()]
    batch.reap(ctx(), client=fake)
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_review_queue WHERE tab = 'extraction_audit'").fetchone()[0] == 3
        assert conn.execute("SELECT COUNT(*) FROM wisdom_records").fetchone()[0] == 0
        assert {r[0] for r in conn.execute("SELECT kind FROM wisdom_batches")} == {"audit"}


def test_a_forced_audit_no_longer_bypasses_the_switch_that_spends(env, monkeypatch):
    """⛔⛔ R52's THIRD ENTRY POINT, found 2026-09-17.

    `force` may bypass the audit's own SCHEDULING flag. It may not bypass the switch that
    SPENDS. This path reaches `batch.submit_pending`, which has no spend gate of its own — the
    only one lives in `batch.run_daily` — so before this rail a forced weekly chain run
    submitted PAID audit batches with WISDOM_EXTRACT_AUDIT_ENABLED *and*
    WISDOM_EXTRACT_ENABLED both off. It was $0 only because `select_segments` needs recent
    done requests and production had none, which is luck, not a guard.
    """
    monkeypatch.delenv("WISDOM_EXTRACT_AUDIT_ENABLED", raising=False)
    monkeypatch.delenv("WISDOM_EXTRACT_ENABLED", raising=False)
    monkeypatch.delenv(batch.ACCEPT_SPEND_ENV, raising=False)
    fake = FakeClient()

    out = audit.run_audit(ctx(force=True), client=fake, n=3)
    assert out["status"] == "skipped"
    # ⭐ R64 phrasing: the refusal deliberately names NO variable, because none applies.
    assert "force never spends" in out["reason"]
    # ⭐ the load-bearing half: a refusal that still sent the batch would be no refusal at all.
    assert fake.messages.batches.created == []

    # ⚰️ R64 SUPERSEDES THE CONTROL THIS TEST SHIPPED WITH. It used to set the acceptance
    # literal and assert the FORCED run then submitted. That is now the hazard, not the
    # control: force never spends, whatever any variable says.
    monkeypatch.setenv(batch.ACCEPT_SPEND_ENV, batch.ACCEPT_SPEND_VALUE)
    out = audit.run_audit(ctx(force=True), client=fake, n=3)
    assert out["status"] == "skipped", "R64: no literal opens the forced door"
    assert fake.messages.batches.created == []

    # CONTROL — the UNFORCED, switched-on path still submits, so this cannot pass against a
    # gate that refuses everything. (The audit's own scheduling flag is set by the fixture.)
    monkeypatch.setenv("WISDOM_EXTRACT_AUDIT_ENABLED", "1")
    monkeypatch.setenv("WISDOM_EXTRACT_ENABLED", "1")
    out = audit.run_audit(ctx(force=False), client=fake, n=3)
    assert out["status"] == "submitted"
    assert len(fake.messages.batches.created) == 1
