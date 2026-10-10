"""TERM-018: the two wisdom pages, fired for real through the wisdom job table (G-30, G-31).

Both run the way production runs them: `registry.run_job(<job id>)` looks the job up in
the JobSpec table (`registry.job_specs()` over every package's `jobs.JOBS`) and calls its
`fn`. Only the edges are replaced: the R2 client, the Anthropic client, the dataset list
and the sink.

* G-30 `capture/health.py::page`: a capture slot whose dataset reads ZERO rows on a trading
  day pages `wisdom_capture_p1:<dataset>` at `critical`; a dataset with rows, and a dataset
  that declares it does not page on that state, page nobody.
* G-31 `extract/batch.py::_page`: the scheduled reap tick requeues an extraction request that
  no batch carries once it is past the give-up window, and pages
  `wisdom_extract_orphans_requeued` at `critical`; a younger orphan only waits and pages nobody.
"""
from __future__ import annotations

from datetime import timedelta

import pytest

from api.services import chart_health_alerts
from api.services.wisdom import registry
from api.services.wisdom.capture import families, health
from api.services.wisdom.core import store, timeutil
from api.services.wisdom.extract import batch, prompt, segmenter
from tests.test_wisdom_capture_runner import NOW, FakeR2, _dataset, _only, _reader
from tests.test_wisdom_extract_batch import TEXTS, FakeClient


@pytest.fixture
def pages(monkeypatch):
    sent: list = []
    monkeypatch.setattr(chart_health_alerts, "emit",
                        lambda key, severity, message, metadata=None: sent.append((key, severity)) or True)
    return sent


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    from api.services.wisdom.core import r2
    fake = FakeR2()
    monkeypatch.setattr(r2, "_client_and_bucket", lambda: (fake, "bucket"))
    return fake


# ── G-30: the capture slot ──────────────────────────────────────────────────

def test_a_capture_slot_that_reads_zero_rows_on_a_trading_day_pages_critical(wisdom_db, pages, monkeypatch):
    _only(monkeypatch, _dataset("catalysts", _reader("catalysts", [])))
    out = registry.run_job(families.JOB_EOD, force=True, now=NOW)
    assert out["status"] == "ok", out
    assert pages == [(f"{health.PAGE_KEY_PREFIX}catalysts", "critical")]


def test_CONTROL_a_capture_slot_with_rows_pages_nobody(wisdom_db, pages, monkeypatch):
    _only(monkeypatch, _dataset("catalysts", _reader("catalysts", [{"t": "AAA"}])))
    out = registry.run_job(families.JOB_EOD, force=True, now=NOW)
    assert out["status"] == "ok", out
    assert pages == []


def test_CONTROL_a_dataset_that_does_not_page_on_zero_pages_nobody(wisdom_db, pages, monkeypatch):
    _only(monkeypatch, _dataset("tweets", _reader("tweets", []), pages=frozenset({"missing"})))
    registry.run_job(families.JOB_EOD, force=True, now=NOW)
    assert pages == []


# ── G-31: the extraction reap ───────────────────────────────────────────────

@pytest.fixture
def extract_env(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setenv("WISDOM_INGEST_ENABLED", "1")
    monkeypatch.setenv("WISDOM_EXTRACT_ENABLED", "1")
    monkeypatch.setenv("WISDOM_EXTRACT_PASSES", "1")
    monkeypatch.delenv("WISDOM_EXTRACT_BUDGET_USD", raising=False)
    store.init_db()
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_sources (source_id, stream, external_ref, version, raw_sha256, "
                     "published_at_et, ingest_version, ingested_at) VALUES ('src1', 'sunday_scans', 'test:1', 1, "
                     "'x', '2026-09-06T08:00:00-04:00', 't', '2026-09-06T09:00:00-04:00')")
        segs = [segmenter.Segment(ordinal=i, kind="section", text=t, char_start=0, char_end=len(t),
                                  path="INTRO", author_id="tsdr", speaker_confidence="medium")
                for i, t in enumerate(TEXTS)]
        segmenter.write_segments(conn, "src1", 1, segs)
    client = FakeClient()
    monkeypatch.setattr(batch, "make_client", lambda: client)
    return [s.segment_id("src1", 1) for s in segs]


def _orphan(segment_id, age):
    stamp = timeutil.iso_et(timeutil.now_et() - age)
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_extract_requests (custom_id, source_id, source_version, segment_ids_json, "
                     "extractor_version, attempt, status, segment_id, purpose, model, est_cost_usd, created_at, "
                     "updated_at) VALUES ('wx_orphan_t18', 'src1', 1, '[]', ?, 1, 'submitting', ?, 'extract', "
                     "'claude-opus-5', 0.08, ?, ?)", (prompt.extractor_version(), segment_id, stamp, stamp))


def test_the_reap_job_pages_critical_when_it_requeues_an_orphan_no_batch_carries(extract_env, pages):
    _orphan(extract_env[0], timedelta(hours=7))
    out = registry.run_job("wisdom_extract_reap")
    assert out["status"] == "ok", out
    assert out["result"]["orphans"]["orphans_requeued"] == 1
    assert pages == [("wisdom_extract_orphans_requeued", "critical")]


def test_CONTROL_a_young_orphan_waits_and_pages_nobody(extract_env, pages):
    _orphan(extract_env[0], timedelta(hours=1))
    out = registry.run_job("wisdom_extract_reap")
    assert out["result"]["orphans"]["orphans_waiting"] == 1
    assert pages == []
