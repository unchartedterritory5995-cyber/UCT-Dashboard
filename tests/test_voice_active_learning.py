"""Active learning — knowledge gaps + obsessions + consolidation."""

import uuid
import pytest

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_active_learning as val
from api.services.voice_memory_service import add_fact
from api.services.voice_session_service import create_session, append_transcript


def _user():
    init_db()
    return create_user(f"val_{uuid.uuid4()}@x.com", "p")["id"]


# ── Knowledge gap detection ────────────────────────────────────────────────

def test_detect_gaps_empty_user_returns_all_slots():
    uid = _user()
    gaps = val.detect_knowledge_gaps(uid)
    # All 6 slots should be unfilled
    assert len(gaps) == len(val.KNOWLEDGE_SLOTS)


def test_detect_gaps_fills_slot_when_keyword_in_fact():
    uid = _user()
    add_fact(uid, text="I trade swing setups primarily", category="style")
    gaps = val.detect_knowledge_gaps(uid)
    slot_names = {g["slot"] for g in gaps}
    assert "trading_style" not in slot_names


def test_detect_gaps_partial_fill():
    uid = _user()
    add_fact(uid, text="I day trade ES futures", category="style")
    add_fact(uid, text="I risk 0.75% per trade", category="preference")
    gaps = val.detect_knowledge_gaps(uid)
    slot_names = {g["slot"] for g in gaps}
    assert "trading_style" not in slot_names
    assert "risk_per_trade" not in slot_names
    # Others should still be open
    assert "preferred_setups" in slot_names


def test_build_gap_prompt_empty_when_all_filled():
    uid = _user()
    for slot in val.KNOWLEDGE_SLOTS:
        # Use first keyword as a stand-in fact
        add_fact(uid, text=f"I {slot['keywords'][0]}", category="general")
    assert val.build_gap_prompt_line(uid) == ""


def test_build_gap_prompt_has_top_two_questions():
    uid = _user()
    line = val.build_gap_prompt_line(uid)
    # 6 gaps, top 2 surfaced
    assert "KNOWLEDGE GAPS" in line
    assert line.count("  - ") == 2


# ── Ticker obsessions ──────────────────────────────────────────────────────

def test_detect_obsessions_below_threshold_returns_empty():
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb")
    append_transcript(sid, role="user", text="what's NVDA at")
    append_transcript(sid, role="user", text="quote AMD")
    out = val.detect_ticker_obsessions(uid, min_mentions=8)
    assert out == []


def test_detect_obsessions_above_threshold():
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb")
    for _ in range(10):
        append_transcript(sid, role="user", text="thoughts on NVDA")
    out = val.detect_ticker_obsessions(uid, min_mentions=8)
    syms = {o["symbol"] for o in out}
    assert "NVDA" in syms


def test_detect_obsessions_suppresses_known_tickers():
    """If a ticker already has a saved fact, don't re-ask."""
    uid = _user()
    add_fact(uid, text="NVDA is my biggest swing position", category="fact")
    sid = create_session(user_id=uid, mode="c", source="orb")
    for _ in range(10):
        append_transcript(sid, role="user", text="how's NVDA")
    out = val.detect_ticker_obsessions(uid, min_mentions=8)
    # Should be suppressed
    syms = {o["symbol"] for o in out}
    assert "NVDA" not in syms


def test_detect_obsessions_blacklists_common_tokens():
    """SPY / QQQ / VIX are NOT individual stock obsessions."""
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb")
    for _ in range(15):
        append_transcript(sid, role="user", text="check SPY and QQQ levels")
    out = val.detect_ticker_obsessions(uid, min_mentions=8)
    syms = {o["symbol"] for o in out}
    assert "SPY" not in syms
    assert "QQQ" not in syms


# ── Memory consolidation ──────────────────────────────────────────────────

def test_consolidate_empty_user():
    uid = _user()
    report = val.consolidate_memory(uid)
    assert report["duplicates_merged"] == 0
    assert report["stale_flagged"] == 0
    assert report["summaries_compressed"] == 0


def test_consolidate_returns_shape():
    uid = _user()
    add_fact(uid, text="I swing trade flag setups", category="style")
    add_fact(uid, text="my main account is Alpha", category="account_alias")
    report = val.consolidate_memory(uid)
    assert "duplicates_merged" in report
    assert "stale_flagged" in report
    assert "summaries_compressed" in report
