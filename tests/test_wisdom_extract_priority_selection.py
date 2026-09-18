"""R100 (owner ruling, 2026-09-18) — priority-to-ceiling segment selection, session 26 Step A2.

`pending_segments` selects fresh segments (zero extract requests at this version) ordered by
`config.category_priority_order()` — category first, unknown categories last — then by source
date descending within a category, then by (source_id, ordinal) for a total order.

⛔ Every ordering test here seeds sources whose PRIORITY and DATE point in OPPOSITE directions
(a lower-priority category with a later date, and vice versa) — otherwise a test that only varies
one axis cannot tell "sorted by category" from "sorted by date" apart, and a broken rank sort
would still pass by accident.
"""
from __future__ import annotations

import pytest

from api.services.wisdom.core import store
from api.services.wisdom.extract import batch, config, segmenter


# ── config.category_priority_order() ─────────────────────────────────────────

def test_unset_is_the_owner_approved_default():
    assert config.category_priority_order() == config.DEFAULT_CATEGORY_PRIORITY
    assert config.DEFAULT_CATEGORY_PRIORITY[0] == "The Mental Game"
    assert config.DEFAULT_CATEGORY_PRIORITY[-1] == "Live Trading Sessions"
    assert len(config.DEFAULT_CATEGORY_PRIORITY) == 15


def test_an_explicit_order_wins(monkeypatch):
    monkeypatch.setenv(config.CATEGORY_PRIORITY_ENV, "Interviews, Sunday Scans")
    assert config.category_priority_order() == ("Interviews", "Sunday Scans")


def test_a_blank_value_is_the_default_not_a_refusal(monkeypatch):
    monkeypatch.setenv(config.CATEGORY_PRIORITY_ENV, "   ")
    assert config.category_priority_order() == config.DEFAULT_CATEGORY_PRIORITY


def test_entries_are_folded_through_R15_normalisation(monkeypatch):
    """⛔ A hand-typed order is folded exactly like the data it will be compared against — the
    typo R15 already knows about, and stray whitespace, must not create a category that can
    never match a real source."""
    monkeypatch.setenv(config.CATEGORY_PRIORITY_ENV, "  live traidng , Interviews  ")
    assert config.category_priority_order() == ("Live Trading Sessions", "Interviews")


def test_a_duplicate_keeps_its_FIRST_position(monkeypatch):
    monkeypatch.setenv(config.CATEGORY_PRIORITY_ENV, "Interviews, Sunday Scans, Interviews")
    assert config.category_priority_order() == ("Interviews", "Sunday Scans")


@pytest.mark.parametrize("raw", [",", " , , ", ",,,"])
def test_a_value_that_parses_to_nothing_REFUSES_and_never_falls_back(monkeypatch, raw):
    monkeypatch.setenv(config.CATEGORY_PRIORITY_ENV, raw)
    with pytest.raises(config.CategoryPriorityUnusable):
        config.category_priority_order()


def test_the_value_is_read_after_import_not_at_it(monkeypatch):
    """⛔ Same requirement as `batch.daily_segment_limit` — a value captured as a default
    argument would freeze at whatever the environment held when the module first imported."""
    import inspect

    sig = inspect.signature(config.category_priority_order)
    assert not sig.parameters, "category_priority_order must take nothing and re-read every call"


# ── pending_segments(): the real end-to-end ordering ─────────────────────────

@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.delenv(config.CATEGORY_PRIORITY_ENV, raising=False)
    store.init_db()


def _seed_source(conn, source_id, *, show, published_at_et, text="segment text"):
    conn.execute(
        "INSERT INTO wisdom_sources (source_id, stream, external_ref, version, raw_sha256, show, "
        "published_at_et, ingest_version, ingested_at) VALUES (?, 'education', ?, 1, 'x', ?, ?, "
        "'test', '2026-09-18T00:00:00-04:00')",
        (source_id, f"edu_videos:{source_id}", show, published_at_et))
    seg = segmenter.Segment(ordinal=0, kind="section", text=text, char_start=0, char_end=len(text),
                            path="INTRO", author_id="tsdr", speaker_confidence="medium")
    segmenter.write_segments(conn, source_id, 1, [seg])
    return seg.segment_id(source_id, 1)


def test_priority_beats_date_and_date_breaks_ties_within_a_category(env):
    """The load-bearing case: `src_setups` is DATED LATER than both Mental Game sources, and a
    date-only sort would put it first — but Setups & Strategies ranks below The Mental Game, so
    it must sort AFTER both, and the newer Mental Game source must still beat the older one."""
    with store.write() as conn:
        mental_old = _seed_source(conn, "src_mental_old", show="The Mental Game",
                                  published_at_et="2026-09-01T09:00:00-04:00")
        mental_new = _seed_source(conn, "src_mental_new", show="The Mental Game",
                                  published_at_et="2026-09-05T09:00:00-04:00")
        setups = _seed_source(conn, "src_setups", show="Setups & Strategies",
                              published_at_et="2026-09-10T09:00:00-04:00")
        live_typo = _seed_source(conn, "src_live_typo", show="LIVE TRAIDNG",
                                 published_at_et="2026-09-15T09:00:00-04:00")
        unknown = _seed_source(conn, "src_unknown", show="Some Category Nobody Ordered",
                               published_at_et="2026-09-20T09:00:00-04:00")
        got = [s["segment_id"] for s in batch.pending_segments(conn, "v0", 10)]
    # unknown is the NEWEST source of all five and still sorts LAST — priority beats date.
    assert got == [mental_new, mental_old, setups, live_typo, unknown]


def test_a_typo_and_the_canonical_spelling_land_in_the_SAME_priority_slot(env):
    """⛔ R15 folding must apply to the DATA, not just the hand-typed order — `LIVE TRAIDNG` and
    `Live Trading Sessions` are the same category and must interleave by date, not sort as two
    different unknown-vs-known buckets."""
    with store.write() as conn:
        typo_new = _seed_source(conn, "src_typo_new", show="LIVE TRAIDNG",
                                published_at_et="2026-09-10T09:00:00-04:00")
        canonical_old = _seed_source(conn, "src_canon_old", show="Live Trading Sessions",
                                     published_at_et="2026-09-01T09:00:00-04:00")
        got = [s["segment_id"] for s in batch.pending_segments(conn, "v0", 10)]
    assert got == [typo_new, canonical_old], "both fold to the same category; date desc decides"


def test_limit_truncates_to_the_highest_priority_slice(env):
    with store.write() as conn:
        first = _seed_source(conn, "src_a", show="The Mental Game",
                             published_at_et="2026-09-01T09:00:00-04:00")
        _seed_source(conn, "src_b", show="Interviews", published_at_et="2026-09-05T09:00:00-04:00")
        _seed_source(conn, "src_c", show="Sunday Scans", published_at_et="2026-09-10T09:00:00-04:00")
        got = [s["segment_id"] for s in batch.pending_segments(conn, "v0", 1)]
    assert got == [first]


def test_an_explicit_env_order_is_honoured(env, monkeypatch):
    monkeypatch.setenv(config.CATEGORY_PRIORITY_ENV, "Sunday Scans, The Mental Game")
    with store.write() as conn:
        mental = _seed_source(conn, "src_mental", show="The Mental Game",
                              published_at_et="2026-09-10T09:00:00-04:00")
        scans = _seed_source(conn, "src_scans", show="Sunday Scans",
                             published_at_et="2026-09-01T09:00:00-04:00")
        got = [s["segment_id"] for s in batch.pending_segments(conn, "v0", 10)]
    # Sunday Scans is ranked FIRST by this override despite the older date — the override, not
    # the default, must be what decided it.
    assert got == [scans, mental]


def test_pre_R100_ordering_is_unaffected_when_no_show_matches_any_category(env):
    """⭐ Backward-compatible by construction: sources with no categorised `show` (NULL, or a
    string the priority order does not name) all rank as 'unknown' together, so the ONLY thing
    left to decide their order is the pre-R100 tie-break — date desc, then (source_id, ordinal).
    This is what every fixture written before R100 exercises."""
    with store.write() as conn:
        old_null = _seed_source(conn, "src_old", show=None, published_at_et="2026-09-01T09:00:00-04:00")
        new_null = _seed_source(conn, "src_new", show=None, published_at_et="2026-09-10T09:00:00-04:00")
        same_day_a = _seed_source(conn, "src_same_a", show="Untracked Category",
                                  published_at_et="2026-09-05T09:00:00-04:00")
        same_day_b = _seed_source(conn, "src_same_b", show="Untracked Category",
                                  published_at_et="2026-09-05T09:00:00-04:00")
        got = [s["segment_id"] for s in batch.pending_segments(conn, "v0", 10)]
    # date desc first (new_null, then the tied same_day pair, then old_null); the tied pair
    # breaks on source_id ascending, exactly as the pre-R100 ORDER BY did.
    assert got == [new_null, same_day_a, same_day_b, old_null]


def test_the_full_segment_row_and_cue_map_survive_the_two_phase_fetch(env):
    """⛔ Phase 1 fetches a lightweight projection to sort; phase 2 must still return the SAME
    shape callers relied on before this rewrite — full segment columns plus `cue_map`."""
    with store.write() as conn:
        _seed_source(conn, "src_full", show="Interviews", published_at_et="2026-09-01T09:00:00-04:00",
                    text="the exact segment text")
        got = batch.pending_segments(conn, "v0", 10)
    assert len(got) == 1
    seg = got[0]
    for key in ("segment_id", "source_id", "source_version", "ordinal", "kind", "text",
               "text_sha256", "normalizer_version", "cue_map"):
        assert key in seg, f"{key} missing from the two-phase result"
    assert seg["text"] == "the exact segment text"
    assert seg["cue_map"] == []


def test_a_zero_or_negative_limit_returns_nothing(env):
    with store.write() as conn:
        _seed_source(conn, "src_x", show="Interviews", published_at_et="2026-09-01T09:00:00-04:00")
        assert batch.pending_segments(conn, "v0", 0) == []
        assert batch.pending_segments(conn, "v0", -3) == []


def test_an_unusable_priority_env_propagates_rather_than_silently_defaulting(env, monkeypatch):
    """⛔ Same refusal shape as `daily_segment_limit` — a garbled env var must surface, not be
    swallowed into the default order that a night's owner never asked for."""
    monkeypatch.setenv(config.CATEGORY_PRIORITY_ENV, " , ")
    with store.write() as conn:
        _seed_source(conn, "src_x", show="Interviews", published_at_et="2026-09-01T09:00:00-04:00")
        with pytest.raises(config.CategoryPriorityUnusable):
            batch.pending_segments(conn, "v0", 10)


def test_a_segment_already_requested_at_this_version_is_never_reselected(env):
    """Non-vacuity: the NOT EXISTS filter that made a segment 'pending' in the first place must
    still hold after the rewrite — the priority sort must not accidentally widen the pool."""
    with store.write() as conn:
        seg_id = _seed_source(conn, "src_x", show="Interviews", published_at_et="2026-09-01T09:00:00-04:00")
        conn.execute(
            "INSERT INTO wisdom_extract_requests (custom_id, source_id, source_version, "
            "segment_ids_json, extractor_version, attempt, status, segment_id, purpose, model, "
            "created_at, updated_at) VALUES ('cid1', 'src_x', 1, '[]', 'v0', 1, 'submitted', ?, "
            "'extract', 'claude-opus-5', 'x', 'x')", (seg_id,))
        got = batch.pending_segments(conn, "v0", 10)
    assert got == []
