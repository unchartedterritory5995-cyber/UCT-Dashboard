"""R102 (session 27) — the $0 pre-extraction filter, built and tested, NOT enabled.

⛔⛔ `WISDOM_EXTRACT_PRESCREEN_ENABLED` must default OFF, and `pending_segments`'s behaviour with
it unset must be BYTE-IDENTICAL to before R102 existed — every R100 test in
`test_wisdom_extract_priority_selection.py` already pins that shape without knowing this module
exists, which is itself part of the proof.
"""
from __future__ import annotations

import pytest

from api.services.wisdom.core import store
from api.services.wisdom.extract import batch, config, prescreen, segmenter


def test_disabled_by_default(monkeypatch):
    monkeypatch.delenv(prescreen.PRESCREEN_ENV, raising=False)
    assert prescreen.prescreen_enabled() is False


@pytest.mark.parametrize("raw,want", [("1", True), ("0", False), ("", False), ("true", False),
                                      ("yes", False)])
def test_only_the_exact_literal_1_enables_it(monkeypatch, raw, want):
    """⛔ Not a truthy-string parse — a typo'd "true"/"yes" must not silently arm a coverage-
    affecting filter. Only the documented literal does."""
    monkeypatch.setenv(prescreen.PRESCREEN_ENV, raw)
    assert prescreen.prescreen_enabled() is want


def test_is_candidate_matches_the_shared_screen():
    from tools.wisdom.null_screens import any_screen_fires

    for text in ("$NVDA breakout", "always cut your losses", "nothing here at all"):
        assert prescreen.is_candidate(text) == any_screen_fires(text)


# ── wiring into pending_segments ──────────────────────────────────────────────

@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.delenv(prescreen.PRESCREEN_ENV, raising=False)
    monkeypatch.delenv(config.CATEGORY_PRIORITY_ENV, raising=False)
    store.init_db()


def _seed(conn, source_id, *, text):
    conn.execute(
        "INSERT INTO wisdom_sources (source_id, stream, external_ref, version, raw_sha256, "
        "published_at_et, ingest_version, ingested_at) VALUES (?, 'education', ?, 1, 'x', "
        "'2026-09-18T09:00:00-04:00', 'test', '2026-09-18T09:00:00-04:00')",
        (source_id, f"edu_videos:{source_id}"))
    seg = segmenter.Segment(ordinal=0, kind="section", text=text, char_start=0, char_end=len(text),
                            path="INTRO", author_id="tsdr", speaker_confidence="medium")
    segmenter.write_segments(conn, source_id, 1, [seg])
    return seg.segment_id(source_id, 1)


def test_disabled_prescreen_never_excludes_anything(env):
    """The control every R100 test already relies on without saying so."""
    with store.write() as conn:
        narration = _seed(conn, "src_narration", text="thanks for joining everyone today")
        candidate = _seed(conn, "src_candidate", text="watching $NVDA here")
        got = {s["segment_id"] for s in batch.pending_segments(conn, "v0", 10)}
    assert got == {narration, candidate}


def test_enabled_prescreen_drops_a_pure_narration_segment(env, monkeypatch):
    monkeypatch.setenv(prescreen.PRESCREEN_ENV, "1")
    with store.write() as conn:
        _seed(conn, "src_narration", text="thanks for joining everyone today, let's get started")
        candidate = _seed(conn, "src_candidate", text="watching $NVDA here")
        got = {s["segment_id"] for s in batch.pending_segments(conn, "v0", 10)}
    assert got == {candidate}, "the pure-narration segment must be screened out when enabled"


def test_enabled_prescreen_keeps_a_segment_with_only_principle_vocabulary(env, monkeypatch):
    """Non-vacuity for the instrument-only framing above: the lexicon screens must also count."""
    monkeypatch.setenv(prescreen.PRESCREEN_ENV, "1")
    with store.write() as conn:
        principle = _seed(conn, "src_principle", text="always cut your losses, discipline matters")
        _seed(conn, "src_narration", text="thanks everyone for joining today")
        got = {s["segment_id"] for s in batch.pending_segments(conn, "v0", 10)}
    assert got == {principle}


def test_the_screen_never_widens_the_NOT_EXISTS_pool(env, monkeypatch):
    """A segment already requested at this version must stay excluded whether or not the
    prescreen is on — the screen narrows a pool, it never reopens one the version guard closed."""
    monkeypatch.setenv(prescreen.PRESCREEN_ENV, "1")
    with store.write() as conn:
        seg_id = _seed(conn, "src_x", text="watching $NVDA here")
        conn.execute(
            "INSERT INTO wisdom_extract_requests (custom_id, source_id, source_version, "
            "segment_ids_json, extractor_version, attempt, status, segment_id, purpose, model, "
            "created_at, updated_at) VALUES ('cid1', 'src_x', 1, '[]', 'v0', 1, 'submitted', ?, "
            "'extract', 'claude-opus-5', 'x', 'x')", (seg_id,))
        got = batch.pending_segments(conn, "v0", 10)
    assert got == []
