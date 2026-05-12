"""Hallucination audit — numeric claim verification."""

import json
import uuid

import pytest

from api.services.auth_db import init_db, get_connection
from api.services.auth_service import create_user
from api.services import voice_hallucination_audit as vha
from api.services.voice_session_service import create_session, append_transcript
from api.services.voice_feedback_service import record_tool_call


def _user():
    init_db()
    return create_user(f"vha_{uuid.uuid4()}@x.com", "p")["id"]


# ── _extract_numbers ────────────────────────────────────────────────────────

def test_extract_numbers_basic():
    out = vha._extract_numbers("NVDA at $200, up 2.3%")
    nums = {n for n, _ in out}
    assert 200 in nums
    assert 2.3 in nums


def test_extract_numbers_units():
    out = vha._extract_numbers("Stop at $195.50 for 7.2% risk")
    by_unit = {u: n for n, u in out}
    assert by_unit.get("$") in (195.50, 7.2)  # either order
    assert "%" in {u for _, u in out}


def test_extract_numbers_ignores_huge():
    out = vha._extract_numbers("account is 1234567890123 something")
    nums = {n for n, _ in out}
    assert 1234567890123 not in nums


def test_extract_numbers_handles_negatives():
    out = vha._extract_numbers("down -3.5% on the day")
    nums = {n for n, _ in out}
    assert -3.5 in nums


# ── _close_enough ───────────────────────────────────────────────────────────

def test_close_enough_within_tolerance():
    assert vha._close_enough((200.0, "$"), {(199.5, "$")}, tol_pct=0.05)


def test_close_enough_outside_tolerance():
    assert not vha._close_enough((200.0, "$"), {(150.0, "$")}, tol_pct=0.05)


def test_close_enough_exact_integer():
    """Counts always match exactly."""
    assert vha._close_enough((7.0, ""), {(7.0, "")})


def test_close_enough_unit_mismatch_blocks():
    """$200 should not match 200%."""
    assert not vha._close_enough((200.0, "$"), {(200.0, "%")})


# ── _extract_tool_numbers ──────────────────────────────────────────────────

def test_extract_tool_numbers_walks_nested():
    tc = [{"args": {}, "result": {"close": 200.50, "stats": {"high": 205}}}]
    out = vha._extract_tool_numbers(tc)
    assert any(n == 200.5 for n, _ in out)
    assert any(n == 205 for n, _ in out)


def test_extract_tool_numbers_handles_fraction_pct():
    """A 'pct' field with value 0.68 should also surface 68."""
    tc = [{"args": {}, "result": {"win_rate_pct": 0.68}}]
    out = vha._extract_tool_numbers(tc)
    pct_vals = {n for n, u in out if u == "%"}
    assert 0.68 in pct_vals
    assert 68 in pct_vals


# ── End-to-end audit ───────────────────────────────────────────────────────

def test_audit_clean_session_no_flags():
    """Assistant cites a number that matches tool result → no flags."""
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb")
    append_transcript(sid, role="user", text="what's NVDA at")
    append_transcript(sid, role="assistant", text="NVDA at $200, up 2.3%")
    record_tool_call(
        uid, tool_name="get_quote", args={"symbol": "NVDA"}, ok=True,
        result={"symbol": "NVDA", "close": 200.0, "change_pct": 2.3},
        session_id=sid,
    )
    out = vha.audit_session(sid, uid)
    assert out["suspect_count"] == 0


def test_audit_fabricated_number_flagged():
    """Assistant cites a price that no tool returned — flag."""
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb")
    append_transcript(sid, role="user", text="quote NVDA")
    append_transcript(sid, role="assistant", text="NVDA at $250")  # tool said $200
    record_tool_call(
        uid, tool_name="get_quote", args={"symbol": "NVDA"}, ok=True,
        result={"symbol": "NVDA", "close": 200.0},
        session_id=sid,
    )
    out = vha.audit_session(sid, uid)
    assert out["suspect_count"] >= 1
    assert any(f["suspect_number"] == 250.0 for f in out["flagged"])


def test_audit_allows_user_quoted_number():
    """If the user said the number, model parroting it is fine."""
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb")
    append_transcript(sid, role="user", text="if NVDA hits $250 alert me")
    append_transcript(sid, role="assistant", text="Got it — alert at $250.")
    out = vha.audit_session(sid, uid)
    assert out["suspect_count"] == 0


def test_audit_skips_small_integers():
    """Small counts (≤12) are never flagged — too many false positives."""
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb")
    append_transcript(sid, role="user", text="give me top movers")
    append_transcript(sid, role="assistant", text="top 5 movers")  # 5 ≤ 12
    out = vha.audit_session(sid, uid)
    assert out["suspect_count"] == 0


def test_list_recent_flags_user_isolation():
    a = _user()
    b = _user()
    sid_a = create_session(user_id=a, mode="c", source="orb")
    append_transcript(sid_a, role="user", text="quote NVDA")
    append_transcript(sid_a, role="assistant", text="NVDA at $250")
    record_tool_call(a, tool_name="get_quote", args={"symbol": "NVDA"},
                     ok=True, result={"close": 200}, session_id=sid_a)
    vha.audit_session(sid_a, a)
    # B can't see A's flags
    assert vha.list_recent_flags(b) == []
    assert len(vha.list_recent_flags(a)) >= 1


def test_audit_handles_no_transcripts():
    """Empty session — no flags, no crash."""
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb")
    out = vha.audit_session(sid, uid)
    assert out["turns_examined"] == 0
    assert out["suspect_count"] == 0
