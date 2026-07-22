"""Tests for AI Search Phase 3 dossier synthesis (api/services/ai_search_dossier.py)."""
import hashlib

import pytest

import api.services.ai_search_log as ail
import api.services.ai_search_memory as mem
import api.services.ai_search_dossier as dos


def _stub_embed(texts):
    vecs = []
    for t in texts:
        v = [0.0] * 64
        for w in (t or "").lower().split():
            v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 64] += 1.0
        vecs.append(v)
    return vecs


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "log.db"))
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "1")
    monkeypatch.setenv("AI_SEARCH_MEMORY_DB", str(tmp_path / "mem.db"))
    monkeypatch.setenv("AI_SEARCH_MEMORY_ENABLED", "1")
    monkeypatch.setenv("AI_SEARCH_DOSSIER_ENABLED", "1")
    monkeypatch.setenv("AI_SEARCH_DOSSIER_MIN_Q", "2")
    ail._reset_for_tests()
    mem._reset_for_tests()
    dos._reset_for_tests()
    # No external desk data / KB / LLM in tests — stub them all.
    monkeypatch.setattr(dos, "_gather_sources", lambda k, t: (f"sources about {k}", "h-" + k))
    monkeypatch.setattr(dos, "_call_llm",
                        lambda system, prompt: '{"title": "Nvidia", "dossier": "NVDA designs GPUs; wide moat in AI accelerators."}')
    monkeypatch.setattr(dos, "select_entities", lambda: [("NVDA", "ticker")])
    return tmp_path


def _seed_ticker_qa(sym, n):
    for i in range(n):
        ail.log(user_id="u", query=f"what is {sym}'s moat {i}", answer=f"{sym} has a durable moat.",
                query_tickers=[sym])


# ── entity selection (real, not stubbed) ─────────────────────────────────────
def test_select_entities_threshold(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "log.db"))
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "1")
    monkeypatch.setenv("AI_SEARCH_DOSSIER_MIN_Q", "3")
    monkeypatch.setattr("api.services.engine.get_leadership", lambda: [])
    ail._reset_for_tests()
    _seed_ticker_qa("NVDA", 3)     # meets threshold
    _seed_ticker_qa("AMD", 1)      # below
    ents = dict(dos.select_entities())
    assert "NVDA" in ents and "AMD" not in ents


# ── synthesis: skip-if-stable + store + embed ────────────────────────────────
def test_synthesize_stores_and_skips_if_stable(env):
    r1 = dos.synthesize_entity("NVDA", "ticker", embed_fn=_stub_embed)
    assert r1 == "synthesized"
    assert mem.dossier_count() == 1
    d = mem.get_dossier("NVDA")
    assert d["title"] == "Nvidia" and "moat" in d["dossier_text"]
    # Same source hash → no second LLM call.
    r2 = dos.synthesize_entity("NVDA", "ticker", embed_fn=_stub_embed)
    assert r2 == "unchanged" and mem.dossier_count() == 1


def test_resynthesizes_when_source_changes(env, monkeypatch):
    dos.synthesize_entity("NVDA", "ticker", embed_fn=_stub_embed)
    monkeypatch.setattr(dos, "_gather_sources", lambda k, t: ("NEW sources", "h2-" + k))
    r = dos.synthesize_entity("NVDA", "ticker", embed_fn=_stub_embed)
    assert r == "synthesized" and mem.dossier_count() == 1   # replaced, not duplicated


def test_run_batch_flag_off(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_SEARCH_DOSSIER_ENABLED", "0")
    dos._reset_for_tests()
    out = dos.run_batch(embed_fn=_stub_embed)
    assert out["enabled"] is False and out["synthesized"] == 0


def test_cost_cap_halts(env, monkeypatch):
    monkeypatch.setenv("AI_SEARCH_DOSSIER_COST_HARD", "0.00")   # no budget
    r = dos.synthesize_entity("NVDA", "ticker", embed_fn=_stub_embed)
    assert r == "cost-capped" and mem.dossier_count() == 0


# ── retrieval: dossier leads, labeled + firewalled ───────────────────────────
def test_dossier_surfaces_first_in_retrieval(env):
    dos.synthesize_entity("NVDA", "ticker", embed_fn=_stub_embed)
    block = mem.retrieve_context("tell me about NVDA's moat and business",
                                 "concept-education", primary_ticker="NVDA", embed_fn=_stub_embed)
    assert "UCT HOUSE VIEW on Nvidia" in block
    assert "verify any current figure against the live" in block   # freshness firewall
    assert block.index("UCT HOUSE VIEW") >= 0


def test_no_dossier_when_none_exists(env):
    block = mem.retrieve_context("tell me about NVDA", "concept-education",
                                 primary_ticker="NVDA", embed_fn=_stub_embed)
    assert "UCT HOUSE VIEW" not in block   # nothing synthesized yet


def test_status_includes_dossier_count(env):
    dos.synthesize_entity("NVDA", "ticker", embed_fn=_stub_embed)
    assert mem.status()["dossiers"] == 1
