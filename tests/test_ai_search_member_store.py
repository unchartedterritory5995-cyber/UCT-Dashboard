"""Wave-3 recollection rails (2026-08-28): the member-keyed thread/saved store
(ai_search_member) + its endpoints, the house-KB grounding gate, and the
dossier distillation lane. The store is CONSENTED and member-scoped — every
test that matters here is an ownership test."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.ai_search as ai
import api.services.ai_search_member as mem
from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
)


def _client(user_id=1, role="user", plan="pro"):
    app = FastAPI()
    app.include_router(ai.router)
    who = {"id": user_id, "role": role, "plan": plan}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who)
    return TestClient(app)


def _fresh(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_SEARCH_MEMBER_DB_PATH", str(tmp_path / "member.db"))
    mem._reset_for_tests()


# ── service round trips ──────────────────────────────────────────────────────
def test_thread_round_trip_and_replace(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    turns = [{"q": "why is CRM up?", "a": "earnings beat", "citations": ["https://x"],
              "answer_id": "A1"},
             {"q": "and the guide?", "a": "raised", "answer_id": "A2"}]
    out = mem.save_thread("u1", "t1", turns, surface="/ai-search")
    assert out == {"ok": True, "thread_id": "t1", "turns": 2}
    got = mem.get_thread("u1", "t1")
    assert got["title"] == "why is CRM up?"
    assert [t["q"] for t in got["turns"]] == ["why is CRM up?", "and the guide?"]
    assert got["turns"][0]["citations"] == ["https://x"]
    # replace semantics: reposting the grown thread never duplicates turns
    mem.save_thread("u1", "t1", turns + [{"q": "q3", "a": "a3"}])
    assert len(mem.get_thread("u1", "t1")["turns"]) == 3
    lst = mem.list_threads("u1")
    assert len(lst) == 1 and lst[0]["turns"] == 3


def test_thread_ownership_is_absolute(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    mem.save_thread("u1", "t1", [{"q": "q", "a": "a"}])
    # another member can neither read, overwrite, nor delete it
    assert mem.get_thread("u2", "t1") is None
    assert mem.save_thread("u2", "t1", [{"q": "hijack", "a": "x"}]) == {"ok": False}
    assert mem.delete_thread("u2", "t1") is False
    assert mem.get_thread("u1", "t1")["turns"][0]["q"] == "q"
    assert mem.delete_thread("u1", "t1") is True
    assert mem.get_thread("u1", "t1") is None


def test_thread_cap_prunes_oldest(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    monkeypatch.setattr(mem, "_MAX_THREADS_PER_USER", 3)
    for i in range(5):
        mem.save_thread("u1", f"t{i}", [{"q": f"q{i}", "a": "a"}])
    ids = {t["thread_id"] for t in mem.list_threads("u1")}
    assert len(ids) == 3 and "t4" in ids


def test_saved_round_trip_dedup_and_cap(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    assert mem.save_answer("u1", {"answer_id": "A1", "q": "q", "answer": "ans",
                                  "citations": ["c1"]})
    assert mem.save_answer("u1", {"answer_id": "A1", "q": "q", "answer": "ans v2"})
    saved = mem.list_saved("u1")
    assert len(saved) == 1 and saved[0]["answer"] == "ans v2"
    assert mem.list_saved("u2") == []          # member-scoped
    assert mem.delete_saved("u2", "A1") is False
    assert mem.delete_saved("u1", "A1") is True
    # empty payloads never save
    assert mem.save_answer("u1", {"answer_id": "", "answer": "x"}) is False
    assert mem.save_answer("u1", {"answer_id": "A2", "answer": ""}) is False


# ── endpoints ────────────────────────────────────────────────────────────────
def test_thread_endpoints_scope_to_session_user(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    c1, c2 = _client(user_id=1), _client(user_id=2)
    r = c1.post("/api/ai-search/threads", json={
        "thread_id": "tt1", "surface": "/ai-search",
        "turns": [{"q": "why is CRM up", "a": "beat", "answer_id": "A1"}]})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert c1.get("/api/ai-search/threads").json()["threads"][0]["thread_id"] == "tt1"
    assert c2.get("/api/ai-search/threads").json()["threads"] == []
    assert c2.get("/api/ai-search/threads/tt1").status_code == 404
    assert c1.get("/api/ai-search/threads/tt1").json()["turns"][0]["q"] == "why is CRM up"
    assert c2.delete("/api/ai-search/threads/tt1").json()["ok"] is False
    assert c1.delete("/api/ai-search/threads/tt1").json()["ok"] is True


def test_saved_endpoints_and_free_gate(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    c = _client(user_id=3)
    r = c.post("/api/ai-search/saved", json={"answer_id": "A9", "q": "q",
                                             "answer": "keep me", "citations": []})
    assert r.status_code == 200
    assert c.get("/api/ai-search/saved").json()["saved"][0]["answer"] == "keep me"
    assert c.delete("/api/ai-search/saved/A9").json()["ok"] is True
    # the whole family is paid-gated like the money route
    free = _client(user_id=4, plan="free")
    assert free.get("/api/ai-search/threads").status_code == 402
    assert free.post("/api/ai-search/saved",
                     json={"answer_id": "A", "answer": "x"}).status_code == 402


# ── house-KB grounding gate ──────────────────────────────────────────────────
def test_brain_context_gates_and_formats(monkeypatch):
    import api.services.brain_kb_service as kb
    monkeypatch.setattr(kb, "search", lambda q, k=3: [
        {"trader": "Qullamaggie", "title": "HTF entries", "score": 0.61,
         "text": "Buy the first orderly flag after a big move."},
        {"trader": None, "title": "Risk rules", "score": 0.35, "text": "Risk 0.5-1%."},
        {"trader": "Minervini", "title": "Low score", "score": 0.20, "text": "nope"},
    ])
    out = ai._brain_context("how do I trade a high tight flag?", "setup-technical", False)
    assert out.startswith("\n\nUCT PLAYBOOK")
    assert "Qullamaggie — HTF entries" in out and "firm KB — Risk rules" in out
    assert "nope" not in out                        # under the score floor
    # ineligible question type, no verdict ask → no KB block
    assert ai._brain_context("why is NVDA up?", "why-move", False) == ""
    # …but an explicit setup/trade ask overrides the type gate
    assert ai._brain_context("find me a trade setup on NVDA", "why-move", True) != ""
    # kill switch
    monkeypatch.setenv("AI_SEARCH_BRAIN_ENABLED", "0")
    assert ai._brain_context("how do I trade a flag?", "setup-technical", False) == ""


def test_brain_block_lands_in_system_prompt(monkeypatch):
    monkeypatch.setattr(ai, "_brain_context",
                        lambda q, t, v: "\n\nUCT PLAYBOOK (test block)")
    system, _salt, meta = ai._grounded_system("what is a VCP pattern?")
    assert "UCT PLAYBOOK (test block)" in system
    assert "playbook" in meta["grounding_sources"]


# ── dossier distillation lane ────────────────────────────────────────────────
def test_dossier_demand_counts_time_sensitive_asks(monkeypatch, tmp_path):
    import api.services.ai_search_dossier as dos
    import api.services.ai_search_log as ail
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "log.db"))
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "1")
    monkeypatch.setenv("AI_SEARCH_DOSSIER_MIN_Q", "3")
    ail._reset_for_tests()
    # three time-sensitive CRM asks — the class the old evergreen-only filter dropped
    for i in range(3):
        ail.log(user_id="u", answer_id=f"A{i}", query=f"why is CRM up today {i}",
                answer="CRM beat", answer_kind="ok", recency="day",
                query_tickers=["CRM"])
    monkeypatch.setattr(dos, "_min_q", lambda: 3)
    # keep the selection hermetic: no leadership seed, no theme joins
    import api.services.engine as engine
    monkeypatch.setattr(engine, "get_leadership", lambda: [])
    ents = dos.select_entities()
    assert ("CRM", "ticker") in ents


def test_dossier_sources_include_labeled_ts_distillation(monkeypatch, tmp_path):
    import api.services.ai_search_dossier as dos
    import api.services.ai_search_log as ail
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "log.db"))
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "1")
    ail._reset_for_tests()
    ail.log(user_id="u", answer_id="A1", query="why is CRM up today",
            answer="Agentforce adoption is inflecting; stock ripped on the beat",
            answer_kind="ok", recency="day", query_tickers=["CRM"])
    out = dos._recent_ts_qa("CRM")
    assert len(out) == 1
    assert out[0].startswith("[RECENT EVENT CONTEXT")
    assert "durable business facts" in out[0]
    assert "Agentforce adoption" in out[0]
