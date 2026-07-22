"""Tests for AI Search Phase 2 retrieval-memory (api/services/ai_search_memory.py)."""
import hashlib

import pytest

import api.services.ai_search_log as ail
import api.services.ai_search_memory as mem


def _stub_embed(texts):
    """Deterministic bag-of-words hashing embed — word overlap → cosine similarity,
    so search relevance is testable without the real embedding API."""
    vecs = []
    for t in texts:
        v = [0.0] * 64
        for w in (t or "").lower().split():
            v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 64] += 1.0
        vecs.append(v)
    return vecs


@pytest.fixture()
def dbs(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "log.db"))
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "1")
    monkeypatch.setenv("AI_SEARCH_MEMORY_DB", str(tmp_path / "mem.db"))
    monkeypatch.setenv("AI_SEARCH_MEMORY_ENABLED", "1")
    monkeypatch.setenv("AI_SEARCH_MEMORY_INDEX_THROTTLE_S", "30")
    ail._reset_for_tests()
    mem._reset_for_tests()
    return tmp_path


def _seed(query, answer, **kw):
    ail.log(user_id="u", query=query, answer=answer, **kw)


# ── eligibility gate ─────────────────────────────────────────────────────────
def test_only_eligible_rows_indexed(dbs):
    _seed("What is a VCP pattern?", "A VCP is a tightening base before breakout.")           # evergreen ok
    _seed("Why is NVDA up today?", "NVDA is up on AI capex.", recency="day",
          grounded_sources=["quote", "movers"])                                              # time_sensitive
    _seed("Should I sell my 500 NVDA shares?", "Depends on your plan.")                       # first_person
    _seed("Write me a poem", "I'm the UCT research desk — ask me about markets.",
          answer_kind="refused")                                                             # refused
    stats = mem.reindex(embed_fn=_stub_embed)
    assert stats["indexed"] == 1                # only the evergreen VCP answer
    assert stats["total"] == 1


def test_dedup_by_answer_hash(dbs):
    _seed("What is a bull flag?", "A bull flag is a continuation pattern.")
    _seed("Explain the bull flag setup", "A bull flag is a continuation pattern.")  # same answer text → same hash
    stats = mem.reindex(embed_fn=_stub_embed)
    assert stats["indexed"] == 1


def test_excluded_row_removed_on_reindex(dbs):
    _seed("What is a VCP pattern?", "A VCP is a tightening base.", answer_id="aid-1")
    assert mem.reindex(embed_fn=_stub_embed)["indexed"] == 1
    ail.record_signal("aid-1", "exclude")        # owner vetoes it
    stats = mem.reindex(embed_fn=_stub_embed)
    assert stats["removed"] == 1 and stats["total"] == 0


# ── search ───────────────────────────────────────────────────────────────────
def test_search_returns_nearest(dbs):
    _seed("What is a VCP pattern?", "A VCP is a tightening volatility contraction base.")
    _seed("What is a dividend?", "A dividend is a cash payout to shareholders.")
    mem.reindex(embed_fn=_stub_embed)
    hits = mem.search("explain the VCP volatility contraction pattern", embed_fn=_stub_embed)
    assert hits and "VCP" in hits[0]["answer"]


def test_pinned_boosts_rank(dbs):
    # Two rows with the SAME words (→ identical stub embedding, identical raw
    # cosine) but different text (trailing space → different answer_hash, so no
    # dedup). The +0.05 pin boost is then the sole tiebreaker → pinned wins.
    _seed("What is a moat", "moat durable competitive advantage", answer_id="plain")
    _seed("What is a moat", "moat durable competitive advantage ", answer_id="pin-me")
    ail.record_signal("pin-me", "pin")
    mem.reindex(embed_fn=_stub_embed)
    hits = mem.search("moat durable competitive advantage", embed_fn=_stub_embed)
    assert hits[0]["answer_id"] == "pin-me"      # pinned wins purely on the boost


# ── retrieve_context (the blend) ─────────────────────────────────────────────
def test_retrieve_context_flag_off(dbs, monkeypatch):
    _seed("What is a VCP pattern?", "A VCP is a tightening base.")
    mem.reindex(embed_fn=_stub_embed)
    monkeypatch.setenv("AI_SEARCH_MEMORY_ENABLED", "0")
    assert mem.retrieve_context("what is a VCP", "concept-education", embed_fn=_stub_embed) == ""


def test_retrieve_context_ineligible_question_type(dbs):
    _seed("What is a VCP pattern?", "A VCP is a tightening base.")
    mem.reindex(embed_fn=_stub_embed)
    # why-move / options-flow are live-only → no memory injected
    assert mem.retrieve_context("why is NVDA up", "why-move", embed_fn=_stub_embed) == ""


def test_retrieve_context_returns_labeled_block(dbs):
    _seed("What is a VCP pattern?", "A VCP is a tightening volatility contraction base.")
    mem.reindex(embed_fn=_stub_embed)
    block = mem.retrieve_context("explain the VCP volatility contraction pattern",
                                 "concept-education", embed_fn=_stub_embed)
    assert "PRIOR DESK RESEARCH" in block and "may be dated" in block
    assert "authoritative" in block                # live data stays primary


def test_retrieve_context_empty_index(dbs):
    assert mem.retrieve_context("what is a VCP", "concept-education", embed_fn=_stub_embed) == ""


def test_status(dbs):
    _seed("What is a VCP pattern?", "A VCP is a tightening base.")
    mem.reindex(embed_fn=_stub_embed)
    s = mem.status()
    assert s["enabled"] is True and s["indexed"] == 1
