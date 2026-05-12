"""Prompt variant registry — A/B testing infrastructure."""

import random
import uuid
import pytest

from api.services import voice_prompt_registry as vpr
from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_reward_model as vrm
from api.services.voice_session_service import create_session
from api.services.voice_feedback_service import record_feedback


def _user():
    init_db()
    return create_user(f"vpr_{uuid.uuid4()}@x.com", "p")["id"]


def test_every_context_has_variants():
    for ctx in ("global", "analyst", "risk_officer", "coach", "scout",
                 "orchestrator", "train_me"):
        assert len(vpr._variants_for(ctx)) >= 1


def test_unknown_context_falls_back_to_global():
    assert vpr._variants_for("janitor") == vpr.VARIANTS["global"]


def test_list_variants_returns_safe_shape():
    out = vpr.list_variants("global")
    for v in out:
        assert set(v.keys()) == {"id", "weight", "description"}


def test_get_prompt_suffix_for_default_is_empty():
    assert vpr.get_prompt_suffix("global", "v1") == ""


def test_get_prompt_suffix_for_concise_has_text():
    s = vpr.get_prompt_suffix("global", "v1_concise")
    assert "STYLE OVERRIDE" in s
    assert "2 sentences" in s


def test_get_prompt_suffix_unknown_variant_returns_empty():
    assert vpr.get_prompt_suffix("global", "made_up_id") == ""


# ── select_variant ──────────────────────────────────────────────────────────

def test_select_variant_single_variant_context_returns_it():
    """scout has only one variant — should always return it."""
    assert vpr.select_variant("scout") == "scout_v1"


def test_select_variant_exploration_returns_valid_id(monkeypatch):
    """When ε hits, must still return a real variant id."""
    monkeypatch.setattr(random, "random", lambda: 0.0)  # always explore
    valid = {v["id"] for v in vpr.VARIANTS["global"]}
    for _ in range(20):
        chosen = vpr.select_variant("global", user_id=None)
        assert chosen in valid


def test_select_variant_exploitation_picks_best_with_volume(monkeypatch):
    """When ε misses AND scoreboard has enough volume, return the winner."""
    uid = _user()
    # Seed v1_concise with 6 thumbs up across 6 sessions
    for _ in range(6):
        sid = create_session(user_id=uid, mode="c", source="orb",
                              page_context="global")
        vrm.record_variant(sid, uid, variant_id="v1_concise",
                            agent_ctx="global")
        record_feedback(uid, rating="up", session_id=sid)
    # Force exploitation
    monkeypatch.setattr(random, "random", lambda: 0.99)
    chosen = vpr.select_variant("global", user_id=uid)
    assert chosen == "v1_concise"


def test_select_variant_no_user_falls_back_to_weighted_random(monkeypatch):
    """No user_id → exploitation path is skipped, falls through to random."""
    monkeypatch.setattr(random, "random", lambda: 0.99)  # avoid epsilon path
    valid = {v["id"] for v in vpr.VARIANTS["global"]}
    chosen = vpr.select_variant("global", user_id=None)
    assert chosen in valid


def test_weighted_random_respects_weights(monkeypatch):
    variants = [
        {"id": "a", "weight": 0.0},
        {"id": "b", "weight": 1.0},
        {"id": "c", "weight": 0.0},
    ]
    monkeypatch.setattr(random, "random", lambda: 0.5)
    assert vpr._weighted_random(variants) == "b"


def test_select_variant_under_min_volume_uses_random(monkeypatch):
    """With only 2 thumbs (below MIN_VOLUME_TO_EXPLOIT=5), fall back."""
    uid = _user()
    for _ in range(2):
        sid = create_session(user_id=uid, mode="c", source="orb",
                              page_context="global")
        vrm.record_variant(sid, uid, variant_id="v1_proactive")
        record_feedback(uid, rating="up", session_id=sid)
    monkeypatch.setattr(random, "random", lambda: 0.99)
    chosen = vpr.select_variant("global", user_id=uid)
    valid = {v["id"] for v in vpr.VARIANTS["global"]}
    assert chosen in valid


def test_variants_per_context_are_disjoint_ids():
    """Each variant id should be unique across the entire registry."""
    seen: set[str] = set()
    for ctx, variants in vpr.VARIANTS.items():
        for v in variants:
            assert v["id"] not in seen, f"duplicate variant id {v['id']!r}"
            seen.add(v["id"])
