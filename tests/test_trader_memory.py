"""
Phase 2-A — trader_memory adapter tests.

Verifies the unified read/write surface for Compass trader_profile +
voice atomic facts.
"""

import uuid
import pytest

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import trader_memory as tm


def _user():
    init_db()
    return create_user(f"tm_{uuid.uuid4()}@x.com", "p")["id"]


# ── Account resolution ────────────────────────────────────────────────────

def test_default_account_returns_id():
    uid = _user()
    aid = tm.get_default_account_id(uid)
    assert aid
    assert isinstance(aid, str)


def test_default_account_idempotent():
    uid = _user()
    a1 = tm.get_default_account_id(uid)
    a2 = tm.get_default_account_id(uid)
    assert a1 == a2


def test_default_account_empty_user():
    assert tm.get_default_account_id("") is None
    assert tm.get_default_account_id(None) is None


# ── Trader profile (Compass-side) ─────────────────────────────────────────

def test_get_profile_empty_by_default():
    uid = _user()
    assert tm.get_trader_profile(uid) == ""


def test_update_and_read_profile_roundtrip():
    uid = _user()
    text = "# Trader Profile\n\nSwing-only. Bull Flag specialist."
    ok = tm.update_trader_profile(uid, text)
    assert ok is True
    assert tm.get_trader_profile(uid) == text


def test_update_profile_strips_whitespace():
    uid = _user()
    ok = tm.update_trader_profile(uid, "   trades ES \n  ")
    assert ok is True
    assert tm.get_trader_profile(uid) == "trades ES"


def test_update_profile_rejects_empty():
    uid = _user()
    assert tm.update_trader_profile(uid, "") is False
    assert tm.update_trader_profile(uid, "   ") is False


# ── Voice facts (atomic) ──────────────────────────────────────────────────

def test_add_and_list_facts():
    uid = _user()
    fid = tm.add_fact(uid, "I trade NQ intraday", category="style")
    assert fid is not None and fid > 0
    facts = tm.list_facts(uid)
    assert len(facts) == 1
    assert facts[0]["text"] == "I trade NQ intraday"
    assert facts[0]["category"] == "style"


def test_add_fact_rejects_empty():
    uid = _user()
    assert tm.add_fact(uid, "") is None
    assert tm.add_fact(uid, "   ") is None


def test_delete_facts_matching():
    uid = _user()
    tm.add_fact(uid, "I trade NQ intraday", category="style")
    tm.add_fact(uid, "I risk 0.5% per trade", category="preference")
    n = tm.delete_facts_matching(uid, "NQ")
    assert n >= 1
    remaining = tm.list_facts(uid)
    assert all("NQ" not in (f.get("text") or "") for f in remaining)


# ── Unified memory context ────────────────────────────────────────────────

def test_unified_context_empty_user():
    uid = _user()
    assert tm.build_unified_memory_context(uid) == ""


def test_unified_context_with_facts_only():
    uid = _user()
    tm.add_fact(uid, "I trade swing setups", category="style")
    tm.add_fact(uid, "I risk 1% per trade", category="preference")
    ctx = tm.build_unified_memory_context(uid)
    assert "Saved facts" in ctx
    assert "swing" in ctx
    assert "1%" in ctx
    # Profile section should NOT appear when profile is empty
    assert "Trader Profile (narrative)" not in ctx


def test_unified_context_with_profile_only():
    uid = _user()
    tm.update_trader_profile(uid, "## Style\n\nDay trader.\n\n## Edge\n\nGap-and-go.")
    ctx = tm.build_unified_memory_context(uid)
    assert "Trader Profile" in ctx
    assert "Day trader" in ctx
    assert "Gap-and-go" in ctx
    # Facts section should NOT appear when no facts
    assert "Saved facts" not in ctx


def test_unified_context_with_both():
    uid = _user()
    tm.update_trader_profile(uid, "## Style\n\nSwing trader.")
    tm.add_fact(uid, "I prefer evening review", category="preference")
    ctx = tm.build_unified_memory_context(uid)
    assert "Trader Profile" in ctx
    assert "Swing trader" in ctx
    assert "Saved facts" in ctx
    assert "evening review" in ctx


def test_unified_context_truncates_long_profile():
    uid = _user()
    long_profile = "x" * 5000
    tm.update_trader_profile(uid, long_profile)
    ctx = tm.build_unified_memory_context(uid, profile_max_chars=200)
    assert "profile truncated" in ctx
    assert len(ctx) < 1000


def test_unified_context_groups_facts_by_category():
    uid = _user()
    tm.add_fact(uid, "I trade ES", category="style")
    tm.add_fact(uid, "I size 1%", category="preference")
    tm.add_fact(uid, "My main account is Alpha", category="account_alias")
    ctx = tm.build_unified_memory_context(uid)
    # Each category header should appear (using voice_memory's allowed
    # categories: preference, account_alias, style, fact, general)
    for cat in ("style", "preference", "account_alias"):
        assert f"### {cat}" in ctx


# ── Migration helper ──────────────────────────────────────────────────────

def test_import_fact_from_profile_blob_no_op_when_facts_exist():
    uid = _user()
    tm.add_fact(uid, "existing fact", category="general")
    tm.update_trader_profile(uid, "Some profile text")
    n = tm.import_fact_from_profile_blob(uid)
    assert n == 0


def test_import_fact_from_profile_blob_seeds_when_empty():
    uid = _user()
    tm.update_trader_profile(uid, "I trade momentum setups exclusively in tech")
    n = tm.import_fact_from_profile_blob(uid)
    assert n == 1
    facts = tm.list_facts(uid)
    assert any("Trader profile summary" in f["text"] for f in facts)
