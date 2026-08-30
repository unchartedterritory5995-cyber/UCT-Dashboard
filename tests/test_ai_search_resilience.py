"""Wave-1 hardening rails (2026-08-27) — the failure ladder a provider outage
walks: masked errors → one bounded retry → stale shadow → desk-only degraded
synthesis → honest error. Plus the durable daily-cap ledger and the
stream-error/single-fallback log dedupe.

Born from a real incident: Perplexity credits ran out and members saw
'request failed: 401 Client Error: Unauthorized for url:
https://api.perplexity.ai/chat/completions' verbatim in the widget.
"""
import pytest
import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.ai_search as ai
import api.services.perplexity_search as pplx
from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
)


@pytest.fixture(autouse=True)
def _hermetic():
    """Every test gets a clean router + shadow cache — the shadow is now the
    correctness surface (allow_stale / history separation), and pollution
    between tests would go undetected until an ordered rerun."""
    _reset()
    yield
    _reset()


def _client(user_id=1, role="user", plan="pro"):
    app = FastAPI()
    app.include_router(ai.router)
    who = {"id": user_id, "role": role, "plan": plan}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who)
    return TestClient(app)


def _reset():
    # Flush the async ledger writer so a pending +1 from an earlier test
    # doesn't seed this test's counters.
    try:
        ai._USAGE_IO.submit(lambda: None).result(timeout=5)
    except Exception:
        pass
    ai._usage_day = ""
    ai._usage_by_user = {}
    ai._usage_global = 0
    ai._usage_seeded_day = None   # let the ledger re-seed next roll
    ai._stats = ai._fresh_stats()
    # The durable ledger persists across tests when they share
    # AI_SEARCH_LOG_DB_PATH — wipe today's rows so the seed doesn't inherit
    # another test's units. Guard aggressively: some sibling suites hand this
    # module a tmp path that no longer exists by the time our fixture fires.
    try:
        import contextlib, os
        import api.services.ai_search_log as _ail
        _ail._reset_for_tests()   # forces _ensure_init to run against the CURRENT env path
        db = _ail._db_path()
        d = os.path.dirname(db) or "."
        if os.path.isdir(d):
            _ail._ensure_init()
            with contextlib.closing(_ail._connect()) as _c:
                _c.execute("DELETE FROM ai_search_usage")
                _c.commit()
    except Exception:
        pass
    try:
        pplx._SEARCH_CACHE._data.clear()
    except Exception:
        pass
    try:
        pplx._LAST_AUTH_ALERT = 0.0
    except Exception:
        pass


class _FakeResp:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self._payload = payload or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            err = requests.HTTPError(
                f"{self.status_code} Client Error: Unauthorized for url: "
                "https://api.perplexity.ai/chat/completions")
            err.response = self
            raise err

    def json(self):
        return self._payload


# ── error masking ────────────────────────────────────────────────────────────
def test_single_shot_401_is_masked_no_provider_url(monkeypatch):
    """The incident bug: str(HTTPError) carries the provider URL; members must
    only ever see a status-only string, matching the stream path's format."""
    _reset()
    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(401))
    out = pplx.web_search("why is CRM moving today x1")
    assert out["error"] == "request failed (401)"
    assert "api.perplexity.ai" not in out["error"]
    assert "Unauthorized" not in out["error"]


def test_network_error_is_masked(monkeypatch):
    _reset()
    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")

    def _boom(*a, **k):
        raise requests.ConnectionError("getaddrinfo failed for api.perplexity.ai")

    monkeypatch.setattr(pplx.requests, "post", _boom)
    out = pplx.web_search("why is CRM moving today x2")
    assert out["error"] == "request failed (network)"
    assert "api.perplexity.ai" not in out["error"]


# ── bounded retry ────────────────────────────────────────────────────────────
def test_transient_5xx_retries_once_then_succeeds(monkeypatch):
    _reset()
    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    monkeypatch.setattr(pplx.time, "sleep", lambda s: None)
    calls = {"n": 0}
    ok = {"choices": [{"message": {"content": "answer text"}}], "citations": []}

    def flaky(*a, **k):
        calls["n"] += 1
        return _FakeResp(503) if calls["n"] == 1 else _FakeResp(200, ok)

    monkeypatch.setattr(pplx.requests, "post", flaky)
    out = pplx.web_search("retry probe q x3")
    assert out["answer"] == "answer text"
    assert calls["n"] == 2


def test_auth_401_never_retries(monkeypatch):
    _reset()
    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    calls = {"n": 0}

    def dead(*a, **k):
        calls["n"] += 1
        return _FakeResp(401)

    monkeypatch.setattr(pplx.requests, "post", dead)
    out = pplx.web_search("auth probe q x4")
    assert out["error"] == "request failed (401)"
    assert calls["n"] == 1, "an auth failure must not be retried"


def test_401_pages_the_admin_channel(monkeypatch):
    _reset()
    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    monkeypatch.setattr(pplx, "_LAST_AUTH_ALERT", 0.0)
    fired = {}
    import api.services.chart_health_alerts as cha

    def fake_emit(key, severity, message, metadata=None):
        fired.update({"key": key, "severity": severity})
        return True

    monkeypatch.setattr(cha, "emit", fake_emit)
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(401))
    pplx.web_search("alert probe q x5")
    assert fired.get("key") == "perplexity_auth_failure"
    assert fired.get("severity") == "critical"


# ── stale shadow ─────────────────────────────────────────────────────────────
def test_outage_serves_last_known_good_flagged_stale(monkeypatch):
    """A finished answer must survive the salted cache's freshness buckets so
    an outage can serve it — flagged stale, billed as a cache hit (free).
    Serving is OPT-IN (allow_stale) — ai_search labels stale answers; nobody
    else does."""
    _reset()
    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    q = "shadow probe question x6"
    ok = {"choices": [{"message": {"content": "yesterday's good answer"}}], "citations": []}
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(200, ok))
    first = pplx.web_search(q, cache_salt="saltA")
    assert first["answer"] and not first.get("stale")
    # provider dies; the SALT changed (new 5-min bucket) so the answer cache misses
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(401))
    out = pplx.web_search(q, cache_salt="saltB-different-bucket", allow_stale=True)
    assert out["answer"] == "yesterday's good answer"
    assert out["stale"] is True and out["cached"] is True


def test_stale_serving_is_opt_in(monkeypatch):
    """CONTRACT RAIL: every consumer outside ai_search (catalyst engine,
    news_catalysts, morning briefings, voice) gates on error/empty and would
    treat a silently-served day-old answer as FRESH — the default must be an
    honest error, never the shadow."""
    _reset()
    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    q = "shadow optin probe x7"
    ok = {"choices": [{"message": {"content": "an old answer"}}], "citations": []}
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(200, ok))
    pplx.web_search(q)
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(401))
    out = pplx.web_search(q, cache_salt="different")   # default: allow_stale=False
    assert out.get("error") == "request failed (401)" and not out.get("answer")


def test_threaded_answers_never_touch_the_shadow(monkeypatch):
    """PRIVACY/CORRECTNESS RAIL: 'what about its earnings?' means a different
    company in every conversation. A history-shaped answer must be neither
    SAVED under the bare query hash (it would leak one member's thread context
    to another member) nor SERVED to a threaded ask."""
    _reset()
    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    q = "what about its earnings? x8"
    hist = [{"q": "tell me about NVDA", "a": "NVDA is a chipmaker."}]
    ok = {"choices": [{"message": {"content": "NVDA earnings were strong"}}], "citations": []}
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(200, ok))
    pplx.web_search(q, history=hist, cache_salt="threadA")   # must NOT save a shadow
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(401))
    # history-less ask for the same text: no shadow may exist
    out = pplx.web_search(q, cache_salt="other", allow_stale=True)
    assert not out.get("answer"), "a history-shaped answer leaked through the shadow"
    # and a THREADED ask never reads the shadow even when one exists
    ok2 = {"choices": [{"message": {"content": "standalone answer"}}], "citations": []}
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(200, ok2))
    pplx.web_search(q, cache_salt="plain")                   # saves a shadow (no history)
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(401))
    out2 = pplx.web_search(q, history=hist, cache_salt="threadB", allow_stale=True)
    assert not out2.get("answer"), "a threaded ask was served another context's answer"


# ── degraded desk-only synthesis ─────────────────────────────────────────────
def test_desk_only_answer_needs_ctx_and_flags_itself(monkeypatch):
    class _Blk:
        type = "text"
        text = "Working from desk data only right now — CRM is up 22% on earnings."

    class _Msgs:
        def create(self, **kw):
            assert "WEB SEARCH IS TEMPORARILY UNAVAILABLE" in kw["system"]
            return type("R", (), {"content": [_Blk()]})()

    class _Client:
        def with_options(self, **kw):
            return self

        messages = _Msgs()

    import api.services.engine as engine
    monkeypatch.setattr(engine, "_get_anthropic_client", lambda: _Client(), raising=False)
    meta = {"ctx_block": "CRM: last $252.05, up 22% today"}
    out = ai._desk_only_answer("talk about CRM", "SYSTEM", meta, [])
    assert out["degraded"] is True and out["mode"] == "degraded"
    assert out["answer"].startswith("Working from desk data")
    # no desk context → no degraded answer (an honest error beats a hallucination)
    assert ai._desk_only_answer("q", "SYSTEM", {"ctx_block": ""}, []) is None


def test_single_shot_degrades_in_band_when_provider_down(monkeypatch):
    _reset()
    monkeypatch.setattr(ai.perplexity_search, "web_search",
                        lambda *a, **k: {"answer": "", "error": "request failed (401)"})
    monkeypatch.setattr(ai, "_desk_only_answer",
                        lambda q, s, m, h: {"answer": "desk-only read", "citations": [],
                                            "related_questions": [], "model": "claude-sonnet-5",
                                            "mode": "degraded", "degraded": True, "cached": False})
    r = _client().post("/api/ai-search", json={"query": "why is NVDA moving today"})
    assert r.status_code == 200
    d = r.json()
    assert d["answer"] == "desk-only read" and d.get("degraded") is True
    assert ai._usage_global == 1   # degraded answers bill exactly one unit


def test_single_shot_honest_error_when_no_desk_context(monkeypatch):
    _reset()
    monkeypatch.setattr(ai.perplexity_search, "web_search",
                        lambda *a, **k: {"answer": "", "error": "request failed (401)"})
    monkeypatch.setattr(ai, "_desk_only_answer", lambda q, s, m, h: None)
    r = _client().post("/api/ai-search", json={"query": "why is NVDA moving today"})
    assert r.status_code == 200
    d = r.json()
    assert d["error"] == "request failed (401)" and not d.get("answer")
    assert ai._usage_global == 0   # failed ask fully refunded


def test_stream_emits_degraded_final_on_provider_error(monkeypatch):
    _reset()

    async def dead_stream(query, **kw):
        yield {"type": "error", "error": "request failed (401)"}

    monkeypatch.setattr(ai.perplexity_search, "stream_search", dead_stream)
    # web_search fallback (step 1 of the ladder) is also down
    monkeypatch.setattr(ai.perplexity_search, "web_search",
                        lambda *a, **k: {"answer": "", "error": "request failed (401)"})
    monkeypatch.setattr(ai, "_desk_only_answer",
                        lambda q, s, m, h: {"answer": "desk-only stream read", "citations": [],
                                            "related_questions": [], "model": "claude-sonnet-5",
                                            "mode": "degraded", "degraded": True, "cached": False})
    r = _client().post("/api/ai-search/stream", json={"query": "why is NVDA moving today"})
    assert r.status_code == 200
    import json as _json
    events = [_json.loads(b[5:]) for b in r.text.split("\n\n")
              if b.strip().startswith("data:")]
    finals = [e for e in events if e.get("type") == "final"]
    assert finals and finals[-1]["answer"] == "desk-only stream read"
    assert finals[-1].get("degraded") is True
    assert not any(e.get("type") == "error" for e in events)


def test_stream_error_prefers_web_fallback_over_degraded(monkeypatch):
    """Ladder order: a one-off stream blip must get the REAL web answer (with
    citations, via the retrying single-shot path) before desk-only synthesis."""
    _reset()

    async def dead_stream(query, **kw):
        yield {"type": "error", "error": "request failed (502)"}

    monkeypatch.setattr(ai.perplexity_search, "stream_search", dead_stream)
    monkeypatch.setattr(ai.perplexity_search, "web_search",
                        lambda *a, **k: {"answer": "fresh web answer", "citations": ["https://x"],
                                         "related_questions": [], "cached": False})
    monkeypatch.setattr(ai, "_desk_only_answer",
                        lambda q, s, m, h: (_ for _ in ()).throw(AssertionError("degraded ran")))
    r = _client().post("/api/ai-search/stream", json={"query": "why is NVDA moving today"})
    assert r.status_code == 200
    import json as _json
    events = [_json.loads(b[5:]) for b in r.text.split("\n\n")
              if b.strip().startswith("data:")]
    finals = [e for e in events if e.get("type") == "final"]
    assert finals and finals[-1]["answer"] == "fresh web answer"
    assert not finals[-1].get("degraded")
    assert ai._usage_global == 1   # billed once for the successful fallback


# ── durable caps ─────────────────────────────────────────────────────────────
def test_usage_ledger_round_trip(monkeypatch, tmp_path):
    import api.services.ai_search_log as ail
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "log.db"))
    ail._reset_for_tests()
    ail.bump_usage("2026-08-27", "bucketA", 3)
    ail.bump_usage("2026-08-27", "bucketA", 2)
    ail.bump_usage("2026-08-27", "__global__", 5)
    ail.bump_usage("2026-08-27", "bucketA", -1)
    loaded = ail.load_usage("2026-08-27")
    assert loaded["bucketA"] == 4 and loaded["__global__"] == 5
    assert ail.load_usage("2026-08-28") == {}
    # floors at zero — a refund can never make a bucket negative
    ail.bump_usage("2026-08-27", "bucketB", -9)
    assert ail.load_usage("2026-08-27").get("bucketB", 0) == 0


def test_caps_reseed_from_ledger_after_redeploy(monkeypatch, tmp_path):
    """The redeploy hole: in-memory counters vanished on every deploy, and
    several ship per day — each one silently re-granted the whole budget."""
    _reset()
    import api.services.ai_search_log as ail
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "log.db"))
    ail._reset_for_tests()
    monkeypatch.setattr(ai.perplexity_search, "web_search",
                        lambda *a, **k: {"answer": "x", "citations": [],
                                         "related_questions": [], "cached": False})
    monkeypatch.setenv("AI_SEARCH_DAILY_LIMIT", "2")
    c = _client(user_id=42)
    assert c.post("/api/ai-search", json={"query": "a"}).status_code == 200
    assert c.post("/api/ai-search", json={"query": "b"}).status_code == 200
    ai._USAGE_IO.submit(lambda: None).result()   # flush the async write-through
    # simulate a redeploy: wipe every in-memory counter AND the seed guard
    ai._usage_day = ""
    ai._usage_by_user = {}
    ai._usage_global = 0
    ai._usage_seeded_day = None
    r = c.post("/api/ai-search", json={"query": "c"})
    assert r.status_code == 429, "the ledger must survive the redeploy"


# ── log dedupe ───────────────────────────────────────────────────────────────
def test_single_fallback_supersedes_stream_error_row(monkeypatch, tmp_path):
    import api.services.ai_search_log as ail
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "log.db"))
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "1")
    ail._reset_for_tests()
    ail.log(user_id="u", answer_id="A1", endpoint="stream", query="q",
            answer="", answer_kind="error", conversation_id="conv1", turn_index=4)
    ail.log(user_id="u", answer_id="A2", endpoint="single", query="q",
            answer="real answer", answer_kind="ok", conversation_id="conv1", turn_index=4)
    rows = ail._all_rows_for_test()
    assert len(rows) == 1 and rows[0]["answer_kind"] == "ok"
    # distinct turns never collapse
    ail.log(user_id="u", answer_id="A3", endpoint="single", query="q2",
            answer="another", answer_kind="ok", conversation_id="conv1", turn_index=5)
    assert len(ail._all_rows_for_test()) == 2
    # an ok row never deletes a PRIOR ok row for the same turn (repeat ask)
    ail.log(user_id="u", answer_id="A4", endpoint="single", query="q",
            answer="rerun", answer_kind="ok", conversation_id="conv1", turn_index=4)
    assert len(ail._all_rows_for_test()) == 3


# ── cost ledger ──────────────────────────────────────────────────────────────
def test_perplexity_cost_recorded_with_override(monkeypatch):
    recorded = {}
    import api.services.narrative_cost_guard as guard

    def fake_record(surface, model, input_tokens=0, output_tokens=0,
                    web_searches=0, cost_usd=None):
        recorded.update(dict(surface=surface, model=model, tin=input_tokens,
                             tout=output_tokens, cost=cost_usd))
        return cost_usd or 0.0

    monkeypatch.setattr(guard, "record", fake_record)
    pplx._record_cost("sonar-pro", {"prompt_tokens": 1000, "completion_tokens": 500},
                      "ai_search")
    assert recorded["surface"] == "pplx:ai_search"
    assert recorded["model"] == "sonar-pro"
    assert recorded["tin"] == 1000 and recorded["tout"] == 500
    # 1000 in @ $3/M + 500 out @ $15/M + $0.006 request fee
    assert abs(recorded["cost"] - (0.003 + 0.0075 + 0.006)) < 1e-9


def test_cost_guard_honors_override():
    import api.services.narrative_cost_guard as guard
    assert guard.record("test_surface_override", "sonar-pro", 10, 10,
                        cost_usd=0.0123) == 0.0123


# ── a slow upstream call must not be a dead ask (2026-08-29) ───────────────
def test_the_fast_timeout_allows_for_the_raised_answer_budget():
    """max_tokens went 700 -> 1800 on 2026-08-29, so an answer takes longer to
    GENERATE. The 18s ceiling was sized for the old stub budget and started
    killing one question in every exam run — for a member, a dead ask."""
    assert pplx._TIMEOUTS["fast"] >= 30, pplx._TIMEOUTS


def test_a_timeout_retries_once_then_succeeds(monkeypatch):
    """One slow call should not cost the whole answer."""
    calls = {"n": 0}

    def _flaky(*a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            raise requests.Timeout("too slow")
        return _FakeResp(200, {"choices": [{"message": {"content": "ok"}}],
                               "citations": []})

    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    monkeypatch.setattr(pplx.time, "sleep", lambda s: None)
    monkeypatch.setattr(pplx.requests, "post", _flaky)
    pplx._SEARCH_CACHE.clear()
    out = pplx.web_search("nvda", cache_salt="t-timeout-1")
    assert out.get("answer") == "ok"
    assert calls["n"] == 2, calls


def test_two_timeouts_still_surface_an_honest_error(monkeypatch):
    """CONTROL — the retry is BOUNDED. An unbounded retry on a blocking call is
    the threadpool-exhaustion surface behind the 524 outage."""
    calls = {"n": 0}

    def _dead(*a, **k):
        calls["n"] += 1
        raise requests.Timeout("too slow")

    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    monkeypatch.setattr(pplx.time, "sleep", lambda s: None)
    monkeypatch.setattr(pplx.requests, "post", _dead)
    pplx._SEARCH_CACHE.clear()
    out = pplx.web_search("nvda", cache_salt="t-timeout-2")
    assert not out.get("answer")
    assert "timeout" in (out.get("error") or "").lower()
    assert calls["n"] == 2, calls
