"""Voice memory — fact conflict detection (Batch 7e)."""

import uuid
from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_memory_service as vms
from api.services import voice_feedback_service as vfs  # noqa: F401


def _user():
    init_db()
    return create_user(f"vmc_{uuid.uuid4()}@example.com", "p")["id"]


def test_detect_no_facts_no_conflict():
    assert vms._detect_fact_conflicts([]) == []


def test_detect_unrelated_facts_no_conflict():
    facts = [
        {"id": 1, "text": "I trade swing setups", "category": "style"},
        {"id": 2, "text": "My main account is named Alpha", "category": "account_alias"},
    ]
    assert vms._detect_fact_conflicts(facts) == []


def test_detect_swing_vs_day_trade_conflict():
    facts = [
        {"id": 1, "text": "I trade swing setups only", "category": "style"},
        {"id": 2, "text": "I day trade ES futures every morning", "category": "style"},
    ]
    conflicts = vms._detect_fact_conflicts(facts)
    assert len(conflicts) == 1
    assert "swing" in conflicts[0]["fact_a"].lower() or "swing" in conflicts[0]["fact_b"].lower()


def test_detect_aggressive_vs_conservative():
    facts = [
        {"id": 1, "text": "I prefer aggressive scaling on breakouts", "category": "style"},
        {"id": 2, "text": "I'm a conservative trader; small position sizes", "category": "style"},
    ]
    conflicts = vms._detect_fact_conflicts(facts)
    assert len(conflicts) >= 1


def test_detect_dedupes_pair_once():
    """A→B and B→A should be reported as ONE conflict, not two."""
    facts = [
        {"id": 1, "text": "I'm aggressive on entries"},
        {"id": 2, "text": "I prefer a conservative approach"},
    ]
    conflicts = vms._detect_fact_conflicts(facts)
    assert len(conflicts) == 1


def test_memory_context_injects_conflict_warning():
    uid = _user()
    vms.add_fact(uid, text="I trade swing setups only", category="style")
    vms.add_fact(uid, text="I day trade ES futures", category="style")
    ctx = vms.build_memory_context(uid)
    assert "contradiction" in ctx.lower() or "contradictions" in ctx.lower()
    assert "swing" in ctx.lower()
    assert "day trade" in ctx.lower()
