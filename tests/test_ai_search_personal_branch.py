"""Router personal-branch privacy invariants (Task 5).

These drive the module-level personal generator/collector directly (not through
FastAPI routing) so the 4 load-bearing privacy invariants are asserted
structurally:

  1. A prior PERSONAL answer in `history` never reaches the Perplexity payload.
  2. The personal branch NEVER logs (branch-keyed, not first_person-regex-keyed).
  3. The synthesized personal answer is never written to a shared/query cache.
  4. Over-cap / synthesis-error degrade to the PUBLIC draft in-band (never raise,
     never null), and the synth reservation is refunded on failure.
"""
import asyncio
import json

from api.routers import ai_search as r


# ── helpers ──────────────────────────────────────────────────────────────────
def _paid(monkeypatch):
    monkeypatch.setattr(r, "_is_paid_server", lambda u: True)
    monkeypatch.setattr(r.ai_search_personal, "has_data", lambda uid: True)
    monkeypatch.setattr(r.ai_search_personal, "resolve_account", lambda uid, tks: "acctA")
    monkeypatch.setattr(
        r.ai_search_personal, "assemble",
        lambda uid, aid, q, tks: "YOUR POSITIONS: NVDA entry $100, +12%, stop $90")
    monkeypatch.setattr(r.ai_search_personal, "reserve_synth", lambda uid: True)
    monkeypatch.setattr(r.ai_search_personal, "refund_synth", lambda uid: None)


def _run_personal_stream(mod, query, history=None):
    """Drive the async personal SSE generator to completion, returning the parsed
    events. Resolves the account through the (monkeypatched) resolver so that leg
    is exercised, then streams `_personal_gen` directly."""
    body = mod.AiSearchIn(query=query, history=history)
    uid = "u1"
    account_id = mod.ai_search_personal.resolve_account(uid, [])
    meta = mod._empty_meta()
    meta["question_type"] = None
    gen = mod._personal_gen(body, uid, account_id, "PUBLIC SYSTEM (no personal data)", "", meta)
    events = []

    async def go():
        async for chunk in gen:
            for line in chunk.splitlines():
                line = line.strip()
                if line.startswith("data:"):
                    events.append(json.loads(line[5:].strip()))

    asyncio.run(go())
    return events


def _run_personal_single(mod, query, history=None):
    body = mod.AiSearchIn(query=query, history=history)
    uid = "u1"
    account_id = mod.ai_search_personal.resolve_account(uid, [])
    meta = mod._empty_meta()
    meta["question_type"] = None
    return asyncio.run(
        mod._personal_single(body, uid, account_id, "PUBLIC SYSTEM (no personal data)", "", meta))


# ── invariant 1: no personal history to Perplexity ───────────────────────────
def test_invariant1_no_personal_history_to_perplexity(monkeypatch):
    """A prior PERSONAL answer in history must never reach the Perplexity payload."""
    _paid(monkeypatch)
    captured = {}

    async def fake_stream_search(query, system=None, history=None, **kw):
        captured["history"] = history
        captured["system"] = system
        yield {"type": "final", "answer": "public draft", "citations": []}

    monkeypatch.setattr(r.perplexity_search, "stream_search", fake_stream_search)

    async def fake_synth(q, draft, pb, live, hist):
        yield "personalized answer"

    monkeypatch.setattr(r.ai_search_personal, "synthesize", fake_synth)
    hist = [{"q": "how's my nvda", "a": "Your NVDA entry $100, +12%, stop $90 — up nicely"}]
    events = _run_personal_stream(r, "should i add given the news", history=hist)
    # Perplexity got NO history at all on the personal branch.
    assert captured.get("history") in (None, [])
    # ...and nothing from the personal prior answer is in the system prompt.
    assert "entry $100" not in (captured.get("system") or "")
    # The member still got a personalized final answer.
    final = [e for e in events if e.get("type") == "final"][-1]
    assert final["answer"] == "personalized answer"
    assert final["personal"] is True


def test_invariant1_holds_for_nonpersonal_followup(monkeypatch):
    """Even when the CURRENT query isn't self-state, the personal branch still
    strips history from the Perplexity leg."""
    _paid(monkeypatch)
    captured = {}

    async def fake_stream_search(query, system=None, history=None, **kw):
        captured["history"] = history
        yield {"type": "final", "answer": "public draft", "citations": []}

    monkeypatch.setattr(r.perplexity_search, "stream_search", fake_stream_search)

    async def fake_synth(q, draft, pb, live, hist):
        yield "answer"

    monkeypatch.setattr(r.ai_search_personal, "synthesize", fake_synth)
    hist = [{"q": "how's my book", "a": "You hold NVDA +12%, stop $90, heat 6%"}]
    _run_personal_stream(r, "should i add to my nvda given the news", history=hist)
    assert captured.get("history") in (None, [])


# ── invariant 2: personal answers never logged (branch-keyed) ─────────────────
def test_invariant2_personal_answer_never_logged(monkeypatch):
    _paid(monkeypatch)
    logged = []
    from api.services import ai_search_log
    monkeypatch.setattr(ai_search_log, "log", lambda **kw: logged.append(kw))

    async def fake_stream_search(query, system=None, history=None, **kw):
        yield {"type": "final", "answer": "draft", "citations": []}

    monkeypatch.setattr(r.perplexity_search, "stream_search", fake_stream_search)

    async def fake_synth(q, draft, pb, live, hist):
        yield "personal"

    monkeypatch.setattr(r.ai_search_personal, "synthesize", fake_synth)
    # "am i overexposed" is a false negative for the first_person regex — so the
    # no-log guarantee cannot be regex-keyed; it must be branch-keyed.
    _run_personal_stream(r, "am i overexposed", history=None)
    assert logged == []


def test_invariant2_single_shot_never_logged(monkeypatch):
    _paid(monkeypatch)
    logged = []
    from api.services import ai_search_log
    monkeypatch.setattr(ai_search_log, "log", lambda **kw: logged.append(kw))

    async def fake_synth(q, draft, pb, live, hist):
        yield "personal"

    monkeypatch.setattr(r.ai_search_personal, "synthesize", fake_synth)
    out = _run_personal_single(r, "am i overexposed", history=None)
    assert logged == []
    assert out["personal"] is True
    assert out["answer"] == "personal"


# ── pure self-state skips Perplexity ─────────────────────────────────────────
def test_pure_portfolio_skips_perplexity(monkeypatch):
    _paid(monkeypatch)
    called = {"perp": 0}

    async def fake_stream_search(*a, **k):
        called["perp"] += 1
        yield {"type": "final", "answer": "draft", "citations": []}

    monkeypatch.setattr(r.perplexity_search, "stream_search", fake_stream_search)

    async def fake_synth(q, draft, pb, live, hist):
        yield "personal"

    monkeypatch.setattr(r.ai_search_personal, "synthesize", fake_synth)
    _run_personal_stream(r, "am i overexposed", history=None)
    assert called["perp"] == 0   # no web hop for pure self-state


def test_research_component_hits_perplexity(monkeypatch):
    _paid(monkeypatch)
    called = {"perp": 0}

    async def fake_stream_search(query, system=None, history=None, **k):
        called["perp"] += 1
        yield {"type": "final", "answer": "draft", "citations": []}

    monkeypatch.setattr(r.perplexity_search, "stream_search", fake_stream_search)

    async def fake_synth(q, draft, pb, live, hist):
        yield "personal"

    monkeypatch.setattr(r.ai_search_personal, "synthesize", fake_synth)
    _run_personal_stream(r, "should i add to my nvda given the news", history=None)
    assert called["perp"] == 1


# ── invariant 4: cost-cap + error degrade to public draft in-band + refund ───
def test_cost_cap_falls_back_to_public_draft(monkeypatch):
    _paid(monkeypatch)
    monkeypatch.setattr(r.ai_search_personal, "reserve_synth", lambda uid: False)   # over cap

    async def fake_stream_search(*a, **k):
        yield {"type": "final", "answer": "PUBLIC DRAFT", "citations": []}

    monkeypatch.setattr(r.perplexity_search, "stream_search", fake_stream_search)
    ev = _run_personal_stream(r, "should i add to my nvda given the news", history=None)
    final = [e for e in ev if e.get("type") == "final"][-1]
    assert "PUBLIC DRAFT" in final["answer"]
    assert final.get("personalization_paused") is True
    assert final["personal"] is True


def test_synthesis_error_refunds_and_emits_draft(monkeypatch):
    _paid(monkeypatch)
    refunds = {"n": 0}
    monkeypatch.setattr(r.ai_search_personal, "reserve_synth", lambda uid: True)
    monkeypatch.setattr(r.ai_search_personal, "refund_synth",
                        lambda uid: refunds.__setitem__("n", refunds["n"] + 1))

    async def fake_stream_search(*a, **k):
        yield {"type": "final", "answer": "PUBLIC DRAFT", "citations": []}

    monkeypatch.setattr(r.perplexity_search, "stream_search", fake_stream_search)

    async def boom(q, draft, pb, live, hist):
        raise RuntimeError("synthesis timeout")
        yield  # pragma: no cover

    monkeypatch.setattr(r.ai_search_personal, "synthesize", boom)
    ev = _run_personal_stream(r, "should i add to my nvda given the news", history=None)
    final = [e for e in ev if e.get("type") == "final"][-1]
    assert "PUBLIC DRAFT" in final["answer"]        # in-band public draft, never raised
    assert final.get("personalization_paused") is True
    assert refunds["n"] == 1                         # synth reservation refunded on failure


def test_over_cap_does_not_refund(monkeypatch):
    """Over-cap never reserved anything, so nothing is refunded."""
    _paid(monkeypatch)
    refunds = {"n": 0}
    monkeypatch.setattr(r.ai_search_personal, "reserve_synth", lambda uid: False)
    monkeypatch.setattr(r.ai_search_personal, "refund_synth",
                        lambda uid: refunds.__setitem__("n", refunds["n"] + 1))

    async def fake_stream_search(*a, **k):
        yield {"type": "final", "answer": "PUBLIC DRAFT", "citations": []}

    monkeypatch.setattr(r.perplexity_search, "stream_search", fake_stream_search)
    _run_personal_stream(r, "should i add to my nvda given the news", history=None)
    assert refunds["n"] == 0


# ── invariant 3: never written to a shared/query cache ───────────────────────
def test_invariant3_personal_answer_not_cached(monkeypatch):
    """The synthesized personal answer must never be handed to any shared cache.
    Spy every plausible cache-write surface and assert the personal text never
    appears in a write."""
    _paid(monkeypatch)
    writes = []

    def _spy_set(*a, **k):
        writes.append((a, k))

    from api.services import cache as _cache
    monkeypatch.setattr(_cache, "set", _spy_set, raising=False)

    async def fake_stream_search(*a, **k):
        yield {"type": "final", "answer": "public draft", "citations": []}

    monkeypatch.setattr(r.perplexity_search, "stream_search", fake_stream_search)

    async def fake_synth(q, draft, pb, live, hist):
        yield "SECRET PERSONAL ANSWER with NVDA +12%"

    monkeypatch.setattr(r.ai_search_personal, "synthesize", fake_synth)
    ev = _run_personal_stream(r, "should i add to my nvda given the news")
    final = [e for e in ev if e.get("type") == "final"][-1]
    assert "SECRET PERSONAL ANSWER" in final["answer"]
    blob = json.dumps(writes)
    assert "SECRET PERSONAL ANSWER" not in blob


# ── meta event emitted first, before upstream work ───────────────────────────
def test_meta_personal_event_emitted_first(monkeypatch):
    _paid(monkeypatch)

    async def fake_stream_search(*a, **k):
        yield {"type": "final", "answer": "draft", "citations": []}

    monkeypatch.setattr(r.perplexity_search, "stream_search", fake_stream_search)

    async def fake_synth(q, draft, pb, live, hist):
        yield "personal"

    monkeypatch.setattr(r.ai_search_personal, "synthesize", fake_synth)
    ev = _run_personal_stream(r, "should i add to my nvda given the news")
    assert ev[0]["type"] == "meta"
    assert ev[0]["personal"] is True


# ── _needs_web heuristic ─────────────────────────────────────────────────────
def test_needs_web_heuristic():
    assert r._needs_web("am i overexposed") is False
    assert r._needs_web("how's my book") is False
    assert r._needs_web("how's my week") is False
    assert r._needs_web("should i add to my nvda given the news") is True
    assert r._needs_web("should i trim my nvda") is True
    assert r._needs_web("what's the outlook on my AAPL") is True


# ── _personal_enabled flag parsing ───────────────────────────────────────────
def test_personal_enabled_flag(monkeypatch):
    for v in ("1", "true", "TRUE", "yes"):
        monkeypatch.setenv("AI_SEARCH_PERSONAL_ENABLED", v)
        assert r._personal_enabled() is True
    for v in ("0", "", "no", "off"):
        monkeypatch.setenv("AI_SEARCH_PERSONAL_ENABLED", v)
        assert r._personal_enabled() is False
