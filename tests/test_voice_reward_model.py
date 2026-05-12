"""Reward modeling — per-variant feedback aggregation."""

import uuid
import pytest

from api.services.auth_db import init_db, get_connection
from api.services.auth_service import create_user
from api.services import voice_reward_model as vrm
from api.services.voice_session_service import create_session
from api.services.voice_feedback_service import record_feedback


def _user():
    init_db()
    return create_user(f"vrm_{uuid.uuid4()}@x.com", "p")["id"]


def _session(uid: str, ctx: str = "global") -> int:
    return create_session(user_id=uid, mode="c", source="orb", page_context=ctx)


# ── record_variant + get_session_variant ───────────────────────────────────

def test_record_variant_basic():
    uid = _user()
    sid = _session(uid)
    vrm.record_variant(sid, uid, variant_id="v1", agent_ctx="global")
    v = vrm.get_session_variant(sid)
    assert v["variant_id"] == "v1"
    assert v["agent_ctx"] == "global"


def test_record_variant_upserts():
    uid = _user()
    sid = _session(uid)
    vrm.record_variant(sid, uid, variant_id="v1")
    vrm.record_variant(sid, uid, variant_id="v2_test")
    v = vrm.get_session_variant(sid)
    assert v["variant_id"] == "v2_test"


def test_record_variant_handles_missing_session():
    """No exception when session_id is invalid."""
    vrm.record_variant(0, "u", variant_id="v1")  # silent no-op
    vrm.record_variant(99999, "u", variant_id="v1")  # FK fails internally


# ── variant_scoreboard ─────────────────────────────────────────────────────

def test_scoreboard_empty():
    uid = _user()
    assert vrm.variant_scoreboard(uid) == []


def test_scoreboard_aggregates_thumbs():
    uid = _user()
    sid_a = _session(uid)
    sid_b = _session(uid)
    vrm.record_variant(sid_a, uid, variant_id="v1")
    vrm.record_variant(sid_b, uid, variant_id="v1")
    record_feedback(uid, rating="up", session_id=sid_a)
    record_feedback(uid, rating="up", session_id=sid_a)
    record_feedback(uid, rating="down", session_id=sid_b,
                    correction_text="x")
    rows = vrm.variant_scoreboard(uid)
    assert len(rows) == 1
    r = rows[0]
    assert r["variant_id"] == "v1"
    assert r["thumbs_up"] == 2
    assert r["thumbs_down"] == 1
    assert r["corrections"] == 1
    assert r["score"] == pytest.approx(2 / 3, rel=1e-3)
    assert r["total_sessions"] == 2


def test_scoreboard_ranks_higher_score_first():
    uid = _user()
    for _ in range(3):
        sid = _session(uid)
        vrm.record_variant(sid, uid, variant_id="winner")
        record_feedback(uid, rating="up", session_id=sid)
    for _ in range(3):
        sid = _session(uid)
        vrm.record_variant(sid, uid, variant_id="loser")
        record_feedback(uid, rating="down", session_id=sid)
    rows = vrm.variant_scoreboard(uid)
    assert rows[0]["variant_id"] == "winner"
    assert rows[1]["variant_id"] == "loser"


def test_scoreboard_handles_sessions_with_no_feedback():
    uid = _user()
    sid = _session(uid)
    vrm.record_variant(sid, uid, variant_id="quiet")
    rows = vrm.variant_scoreboard(uid)
    assert len(rows) == 1
    assert rows[0]["score"] is None  # no feedback
    assert rows[0]["total_sessions"] == 1


def test_scoreboard_user_isolation():
    a = _user()
    b = _user()
    sid_a = _session(a)
    sid_b = _session(b)
    vrm.record_variant(sid_a, a, variant_id="v1")
    vrm.record_variant(sid_b, b, variant_id="v1")
    record_feedback(a, rating="up", session_id=sid_a)
    record_feedback(b, rating="down", session_id=sid_b)
    rows_a = vrm.variant_scoreboard(a)
    assert rows_a[0]["thumbs_up"] == 1
    assert rows_a[0]["thumbs_down"] == 0


def test_scoreboard_agent_breakdown():
    uid = _user()
    sid_a = _session(uid, ctx="analyst")
    sid_b = _session(uid, ctx="coach")
    vrm.record_variant(sid_a, uid, variant_id="v1", agent_ctx="analyst")
    vrm.record_variant(sid_b, uid, variant_id="v1", agent_ctx="coach")
    record_feedback(uid, rating="up", session_id=sid_a)
    rows = vrm.variant_scoreboard(uid)
    ab = rows[0]["agent_breakdown"]
    assert ab.get("analyst") == 1
    assert ab.get("coach") == 1


# ── best_variant ───────────────────────────────────────────────────────────

def test_best_variant_returns_top_with_enough_feedback():
    uid = _user()
    for _ in range(6):  # min_feedback default 5
        sid = _session(uid)
        vrm.record_variant(sid, uid, variant_id="alpha")
        record_feedback(uid, rating="up", session_id=sid)
    best = vrm.best_variant(uid)
    assert best == "alpha"


def test_best_variant_below_min_returns_none():
    uid = _user()
    sid = _session(uid)
    vrm.record_variant(sid, uid, variant_id="rare")
    record_feedback(uid, rating="up", session_id=sid)
    assert vrm.best_variant(uid, min_feedback=10) is None
