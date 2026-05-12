"""Voice feedback service — thumbs, corrections, tool-call audit."""

import uuid
import pytest

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_feedback_service as vfs


def _user():
    init_db()
    return create_user(f"vfs_{uuid.uuid4()}@example.com", "p")["id"]


# ── record_feedback / list_feedback ────────────────────────────────────────

def test_record_thumbs_up():
    uid = _user()
    fb = vfs.record_feedback(uid, rating="up", turn_text="That was great!")
    assert fb["rating"] == "up"
    assert fb["id"] is not None


def test_record_thumbs_down_with_correction():
    uid = _user()
    fb = vfs.record_feedback(
        uid, rating="down", turn_text="Tech themes are flat",
        correction_text="Tech is actually leading today",
    )
    assert fb["correction_text"] == "Tech is actually leading today"
    corrections = vfs.list_corrections(uid)
    assert len(corrections) == 1
    assert corrections[0]["correction_text"] == "Tech is actually leading today"


def test_record_rejects_bad_rating():
    uid = _user()
    with pytest.raises(ValueError):
        vfs.record_feedback(uid, rating="sideways")


def test_list_corrections_excludes_thumbs_up_without_text():
    uid = _user()
    vfs.record_feedback(uid, rating="up")  # no correction
    vfs.record_feedback(uid, rating="down", correction_text="X means Y")
    cs = vfs.list_corrections(uid)
    assert len(cs) == 1


def test_list_corrections_limit():
    uid = _user()
    for i in range(20):
        vfs.record_feedback(uid, rating="down", correction_text=f"Note {i}")
    cs = vfs.list_corrections(uid, limit=5)
    assert len(cs) == 5
    # Most recent first
    assert "Note 19" in cs[0]["correction_text"]


def test_list_feedback_returns_all_ratings():
    uid = _user()
    vfs.record_feedback(uid, rating="up", turn_text="A")
    vfs.record_feedback(uid, rating="down", turn_text="B")
    vfs.record_feedback(uid, rating="up", turn_text="C")
    fb = vfs.list_feedback(uid)
    assert len(fb) == 3


# ── build_corrections_block ────────────────────────────────────────────────

def test_build_corrections_block_empty():
    uid = _user()
    assert vfs.build_corrections_block(uid) == ""


def test_build_corrections_block_includes_all_corrections():
    uid = _user()
    vfs.record_feedback(uid, rating="down", correction_text="Aggressive scaling")
    vfs.record_feedback(uid, rating="down", correction_text="Cite volume on quotes")
    block = vfs.build_corrections_block(uid)
    assert "Aggressive scaling" in block
    assert "Cite volume on quotes" in block
    assert "going forward" in block.lower() or "Corrections" in block


# ── tool-call audit ────────────────────────────────────────────────────────

def test_record_tool_call_success():
    uid = _user()
    vfs.record_tool_call(
        uid, tool_name="get_quote", args={"symbol": "NVDA"},
        ok=True, latency_ms=42,
    )
    stats = vfs.get_tool_call_stats(uid)
    by_tool = {r["tool_name"]: r for r in stats["by_tool"]}
    assert by_tool["get_quote"]["total"] == 1
    assert by_tool["get_quote"]["success"] == 1
    assert stats["recent_failures"] == []


def test_record_tool_call_failure():
    uid = _user()
    vfs.record_tool_call(
        uid, tool_name="flag_ticker", args={"symbol": ""},
        ok=False, error="empty symbol", latency_ms=3,
    )
    stats = vfs.get_tool_call_stats(uid)
    assert len(stats["recent_failures"]) == 1
    assert stats["recent_failures"][0]["tool_name"] == "flag_ticker"
    assert stats["recent_failures"][0]["error"] == "empty symbol"


def test_record_tool_call_handles_unserializable_args():
    """If args contain non-JSON-serializable values, audit still logs (with null args)."""
    uid = _user()
    class Bad:
        pass
    vfs.record_tool_call(
        uid, tool_name="weird", args={"thing": Bad()},
        ok=True,
    )
    stats = vfs.get_tool_call_stats(uid)
    by_tool = {r["tool_name"]: r for r in stats["by_tool"]}
    assert by_tool["weird"]["total"] == 1


# ── Memory injection picks up corrections ───────────────────────────────────

def test_memory_context_injects_corrections():
    """build_memory_context should append corrections so they're injected
    into the next session's system prompt."""
    uid = _user()
    vfs.record_feedback(
        uid, rating="down",
        correction_text="When I ask for themes, always include the period.",
    )
    from api.services.voice_memory_service import build_memory_context
    ctx = build_memory_context(uid)
    assert "always include the period" in ctx
