"""Per-catalyst owner NOTES: partial-merge storage + curator steer.

The load-bearing rule (learned the hard way on the Morning Wire feedback): a
note must never clobber an earlier thumb, and a thumb must never clobber an
earlier note.
"""
import pytest

from api.services.catalyst import store, curator


@pytest.fixture(autouse=True)
def _tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_DB_PATH", str(tmp_path / "catalysts.db"))
    store._init_db()
    yield


def _fb(**kw):
    base = dict(user_id="u1", market_date="2026-07-23", ticker="NVDA")
    base.update(kw)
    store.record_feedback(**base)


# ── partial merge ───────────────────────────────────────────────────────
def test_note_only_save_stores_blank_verdict():
    _fb(note="too much sector noise here")
    got = store.get_user_feedback("u1", "2026-07-23")["NVDA"]
    assert got["note"] == "too much sector noise here"
    assert got["verdict"] is None          # '' normalizes to None on read


def test_note_does_not_clobber_existing_thumb():
    _fb(verdict="bad")
    _fb(note="explain why this is weak")
    got = store.get_user_feedback("u1", "2026-07-23")["NVDA"]
    assert got["verdict"] == "bad"         # thumb survived the note-only save
    assert got["note"] == "explain why this is weak"


def test_thumb_does_not_clobber_existing_note():
    _fb(note="keep more big-cap news movers")
    _fb(verdict="good")
    got = store.get_user_feedback("u1", "2026-07-23")["NVDA"]
    assert got["note"] == "keep more big-cap news movers"   # note survived
    assert got["verdict"] == "good"


def test_empty_note_clears_it():
    _fb(note="never mind")
    _fb(note="")
    assert store.get_user_feedback("u1", "2026-07-23")["NVDA"]["note"] == ""


def test_note_can_be_updated():
    _fb(note="first")
    _fb(note="second")
    assert store.get_user_feedback("u1", "2026-07-23")["NVDA"]["note"] == "second"


# ── notes reader ────────────────────────────────────────────────────────
def test_get_recent_notes_returns_only_noted_rows():
    _fb(ticker="NVDA", note="this one is great")
    _fb(ticker="AMD", verdict="bad")             # thumb only, no note
    notes = store.get_recent_notes(days=14, limit=20)
    assert [n["ticker"] for n in notes] == ["NVDA"]


def test_get_recent_notes_respects_limit():
    for i, t in enumerate(["AAA", "BBB", "CCC"]):
        _fb(ticker=t, note=f"note {i}")
    assert len(store.get_recent_notes(days=14, limit=2)) == 2


# ── curator steer ───────────────────────────────────────────────────────
def test_notes_block_empty_when_no_notes(monkeypatch):
    monkeypatch.setenv("CATALYST_NOTES_STEER", "1")
    assert curator._owner_notes_block() == ""


def test_notes_block_renders_directives(monkeypatch):
    monkeypatch.setenv("CATALYST_NOTES_STEER", "1")
    _fb(ticker="WEX", note="stop showing me sleepy payment processors")
    block = curator._owner_notes_block()
    assert "OWNER NOTES" in block
    assert "$WEX" in block
    assert "sleepy payment processors" in block
    assert "OUTWEIGH" in block          # notes beat the generic rubric


def test_notes_steer_can_be_disabled(monkeypatch):
    monkeypatch.setenv("CATALYST_NOTES_STEER", "0")
    _fb(ticker="WEX", note="stop showing me these")
    assert curator._owner_notes_block() == ""


def test_new_note_changes_pool_hash(monkeypatch):
    """A note you just wrote must force a re-curation — otherwise it does
    nothing until the pool happens to shift."""
    monkeypatch.setenv("CATALYST_NOTES_STEER", "1")
    pool = [{"ticker": "NVDA", "gap_pct": 5.0, "vol_x": 2.0, "tag": "Catalyst"}]
    before = curator._pool_hash(pool)
    _fb(ticker="WEX", note="cut the payment processors")
    after = curator._pool_hash(pool)
    assert before != after
