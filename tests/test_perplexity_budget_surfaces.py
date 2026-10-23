"""2026-10-22 — why the Perplexity daily budget ran out by the evening.

Prod (2026-10-23 02:45 UTC): `perplexity daily budget EXHAUSTED (502/500
calls today) — refusing call (surface=catalyst)`. Two causes, both railed here:

1. WASTE — the catalyst engine rebuilds every candidate each refresh (~27/day)
   and its per-ticker prompts embed values that drift every tick (the live gap %
   to one decimal; a re-ordered sector ticker list), so a text-keyed cache never
   hit and the same question was re-bought on nearly every tick. Fixed with an
   opt-in `cache_identity` on web_search().
2. ONE POOL — the background surfaces (catalyst, news_catalysts warm backfill)
   could spend the whole global budget and starve member-facing ones
   (ai_search, uct_agent, voice). Fixed with per-surface sub-budgets.

Plus the counter semantics the budget relies on (what one row means).
Ledger reads are mocked; nothing touches the network.
"""
import pytest
import requests

import api.services.narrative_cost_guard as guard
import api.services.perplexity_search as pplx


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    monkeypatch.setattr(pplx.time, "sleep", lambda s: None)
    monkeypatch.delenv("PERPLEXITY_SURFACE_LIMITS", raising=False)
    pplx._SEARCH_CACHE.clear()
    yield
    pplx._SEARCH_CACHE.clear()


class _Resp:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self._payload = payload or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            err = requests.HTTPError(f"{self.status_code} error")
            err.response = self
            raise err

    def json(self):
        return self._payload


_OK = {"choices": [{"message": {"content": "answer text"}}], "citations": [],
       "usage": {"prompt_tokens": 10, "completion_tokens": 5}}


def _counting_post(monkeypatch, responses=None):
    calls = {"n": 0}
    seq = list(responses or [])

    def _post(*a, **k):
        calls["n"] += 1
        return seq.pop(0) if seq else _Resp(200, _OK)

    monkeypatch.setattr(pplx.requests, "post", _post)
    return calls


# ── 1. cache identity ───────────────────────────────────────────────────────
def test_cache_identity_makes_drifting_prompts_share_one_answer(monkeypatch):
    """THE key rail: two prompts that differ only in a drifting number, asked
    under one identity, cost ONE request."""
    calls = _counting_post(monkeypatch)
    a = pplx.web_search("Why is $XYZ up 7.3% today?", cost_surface="catalyst",
                        cache_identity="catalyst:fallback:2026-10-22:XYZ:up")
    b = pplx.web_search("Why is $XYZ up 7.9% today?", cost_surface="catalyst",
                        cache_identity="catalyst:fallback:2026-10-22:XYZ:up")
    assert a["answer"] == b["answer"] == "answer text"
    assert b["cached"] is True
    assert calls["n"] == 1


def test_without_identity_drifting_prompts_each_pay(monkeypatch):
    """Control: the waste the identity removes is real — text keys never repeat."""
    calls = _counting_post(monkeypatch)
    pplx.web_search("Why is $XYZ up 7.3% today?", cost_surface="catalyst")
    pplx.web_search("Why is $XYZ up 7.9% today?", cost_surface="catalyst")
    assert calls["n"] == 2


def test_distinct_identities_do_not_collide(monkeypatch):
    calls = _counting_post(monkeypatch)
    pplx.web_search("q", cache_identity="catalyst:fallback:2026-10-22:XYZ:up")
    pplx.web_search("q", cache_identity="catalyst:fallback:2026-10-22:ABC:up")
    assert calls["n"] == 2


def test_identity_key_differs_from_the_same_string_as_a_query():
    as_query = pplx._cache_key("m", None, "finance", 300, False, None, "abc")
    as_ident = pplx._cache_key("m", None, "finance", 300, False, None, "abc", identity="abc")
    assert as_query != as_ident


# ── 2. per-surface sub-budgets ──────────────────────────────────────────────
def _ledger(monkeypatch, *, total, per_surface):
    monkeypatch.setenv("PERPLEXITY_TEST_ENFORCE_BUDGET", "1")
    monkeypatch.setattr(guard, "calls_today", lambda prefix: total)
    monkeypatch.setattr(guard, "calls_today_for_surface",
                        lambda surface: per_surface.get(surface, 0))


def test_a_spent_background_surface_cannot_starve_ai_search(monkeypatch):
    _ledger(monkeypatch, total=260, per_surface={"pplx:catalyst": 250})
    calls = _counting_post(monkeypatch)
    refused = pplx.web_search("catalyst probe", cost_surface="catalyst")
    assert refused.get("budget_refused") is True and "catalyst" in refused["error"]
    assert calls["n"] == 0
    ok = pplx.web_search("member probe", cost_surface="ai_search")
    assert ok.get("answer") == "answer text"
    assert calls["n"] == 1


def test_surface_under_its_share_is_allowed(monkeypatch):
    _ledger(monkeypatch, total=260, per_surface={"pplx:catalyst": 249})
    _counting_post(monkeypatch)
    assert pplx.web_search("probe", cost_surface="catalyst").get("answer") == "answer text"


def test_global_limit_still_binds_every_surface(monkeypatch):
    _ledger(monkeypatch, total=500, per_surface={})
    _counting_post(monkeypatch)
    out = pplx.web_search("probe", cost_surface="ai_search")
    assert out.get("budget_refused") is True


def test_surface_limits_env_override_and_disable(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_SURFACE_LIMITS", "catalyst=40, ai_search_deep=7,bad,x=notnum")
    assert pplx._surface_limits() == {"catalyst": 40, "ai_search_deep": 7}
    monkeypatch.setenv("PERPLEXITY_SURFACE_LIMITS", "")
    assert pplx._surface_limits() == {}
    _ledger(monkeypatch, total=10, per_surface={"pplx:catalyst": 10_000})
    _counting_post(monkeypatch)
    assert pplx.web_search("probe", cost_surface="catalyst").get("answer") == "answer text"


def test_default_shares_leave_room_for_member_surfaces():
    limits = pplx._surface_limits()
    assert set(limits) == {"catalyst", "news_catalysts"}
    assert sum(limits.values()) <= pplx._DAILY_LIMIT_DEFAULT - 100


def test_uncapped_surface_never_reads_the_per_surface_ledger(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_TEST_ENFORCE_BUDGET", "1")
    monkeypatch.setattr(guard, "calls_today", lambda prefix: 1)

    def _boom(surface):
        raise AssertionError("uncapped surface must not pay a ledger read")

    monkeypatch.setattr(guard, "calls_today_for_surface", _boom)
    assert pplx._check_daily_budget("ai_search") is None


def test_stream_refusal_is_flagged(monkeypatch):
    import asyncio
    _ledger(monkeypatch, total=1, per_surface={"pplx:catalyst": 999})

    async def _go():
        return [ev async for ev in pplx.stream_search("q", cost_surface="catalyst")]

    evs = asyncio.run(_go())
    assert evs == [{"type": "error", "error": evs[0]["error"], "budget_refused": True}]


def test_daily_status_reports_each_share(monkeypatch):
    monkeypatch.setattr(guard, "calls_today", lambda prefix: 300)
    monkeypatch.setattr(guard, "calls_today_for_surface",
                        lambda s: {"pplx:catalyst": 200, "pplx:news_catalysts": 90}.get(s, 0))
    st = pplx.get_daily_status()
    assert st["surfaces"]["catalyst"] == {"calls_today": 200, "limit": 250, "remaining": 50}
    assert st["surfaces"]["news_catalysts"]["remaining"] == 60


def test_exact_surface_count_does_not_prefix_match(monkeypatch, tmp_path):
    """pplx:ai_search must not count pplx:ai_search_deep — exact, not LIKE."""
    import sqlite3
    db = tmp_path / "ledger.db"

    def _conn():
        import contextlib
        c = sqlite3.connect(db)
        return contextlib.closing(c)

    c = sqlite3.connect(db)
    c.execute("CREATE TABLE llm_route_cost_log (surface TEXT, at TEXT)")
    for s in ("pplx:ai_search", "pplx:ai_search_deep", "pplx:ai_search_deep", "pplx:catalyst"):
        c.execute("INSERT INTO llm_route_cost_log VALUES (?, '2999-01-01 00:00:00')", (s,))
    c.commit()
    c.close()
    monkeypatch.setattr(guard, "_init", lambda: None)
    monkeypatch.setattr(guard, "_conn", _conn)
    assert guard.calls_today_for_surface("pplx:ai_search") == 1
    assert guard.calls_today_for_surface("pplx:ai_search_deep") == 2
    assert guard.calls_today("pplx:ai_search") == 3


# ── 3. counter semantics: one ledger row == one COMPLETED request ──────────
def _count_records(monkeypatch):
    rows = []
    monkeypatch.setattr(guard, "record", lambda surface, model, **k: rows.append(surface) or 0.0)
    return rows


def test_retries_then_success_ledger_exactly_one_row(monkeypatch):
    rows = _count_records(monkeypatch)
    calls = _counting_post(monkeypatch, [_Resp(503), _Resp(429), _Resp(200, _OK)])
    out = pplx.web_search("retry probe", cost_surface="catalyst")
    assert out["answer"] == "answer text"
    assert calls["n"] == 3
    assert rows == ["pplx:catalyst"]


def test_exhausted_retries_ledger_nothing(monkeypatch):
    rows = _count_records(monkeypatch)
    calls = _counting_post(monkeypatch, [_Resp(503)] * 4)
    out = pplx.web_search("fail probe", cost_surface="catalyst")
    assert out.get("error")
    assert calls["n"] == 4
    assert rows == []


def test_cache_hit_ledgers_nothing(monkeypatch):
    rows = _count_records(monkeypatch)
    _counting_post(monkeypatch)
    pplx.web_search("hit probe", cost_surface="catalyst")
    pplx.web_search("hit probe", cost_surface="catalyst")
    assert rows == ["pplx:catalyst"]


# ── 4. the catalyst engine's enrichers use stable identities ───────────────
def test_zero_signal_fallback_reuses_answer_across_refreshes(monkeypatch):
    from api.services.catalyst import engine
    monkeypatch.setenv("CATALYST_PERPLEXITY_ENABLED", "1")
    calls = _counting_post(monkeypatch)
    for gap in (6.1, 6.4, 7.0):   # three refreshes, the live gap drifting
        c = [{"ticker": "XYZ", "gap_pct": gap, "tweets": [], "rss": []}]
        engine._enrich_with_perplexity(c)
        assert c[0]["rss"][0]["source"] == "Perplexity"
    assert calls["n"] == 1


def test_sector_context_reuses_answer_when_the_ticker_list_churns(monkeypatch):
    from api.services.catalyst import engine
    monkeypatch.setenv("CATALYST_PERPLEXITY_ENABLED", "1")
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _Resp(200, {
        "choices": [{"message": {"content": "Semis rallied on the NVDA print and a TSMC capex raise."}}],
        "citations": []}))
    calls = {"n": 0}
    real = pplx.web_search

    def _spy(*a, **k):
        r = real(*a, **k)
        calls["n"] += 0 if r.get("cached") else 1
        return r

    monkeypatch.setattr(pplx, "web_search", _spy)
    t1 = [{"ticker": t, "sector": "Technology"} for t in ("AMD", "NVDA", "MU")]
    t2 = [{"ticker": t, "sector": "Technology"} for t in ("MU", "AVGO", "NVDA", "AMD")]
    assert engine._compute_sector_context(t1) and engine._compute_sector_context(t2)
    assert calls["n"] == 1


def test_earnings_enrichment_passes_identity_and_ttl(monkeypatch):
    from api.services.catalyst import engine
    monkeypatch.setenv("CATALYST_PERPLEXITY_ENABLED", "1")
    monkeypatch.setenv("CATALYST_PPLX_ENRICH_TTL_SECONDS", "1800")
    seen = {}

    def _fake(q, **k):
        seen.update(k)
        return {"answer": "Raised FY guide.", "citations": []}

    monkeypatch.setattr(pplx, "web_search", _fake)
    c = [{"ticker": "NVDA", "tag": engine.CATALYST_TAG.EARNINGS,
          "earnings_meta": {"timing": "AMC"}}]
    engine._enrich_earnings_with_perplexity(c)
    assert seen["cache_identity"].startswith("catalyst:earnings:") and "NVDA:AMC" in seen["cache_identity"]
    assert seen["cache_ttl_override"] == 1800


# ── 5. news_catalysts never bakes in unverified dates on a budget refusal ──
def test_news_catalysts_budget_refused_verify_is_a_failed_look(monkeypatch):
    from api.services.news_catalysts import service
    monkeypatch.setenv("NEWS_VERIFY_DATES", "1")
    monkeypatch.setenv("NEWS_WEB_SEARCH_ENABLED", "1")
    bars = [{"t": "2026-03-03", "o": 100.0, "c": 100.0},
            {"t": "2026-03-11", "o": 100.0, "c": 90.0}]

    def fake(q, *a, **k):
        if "JSON" in q:
            return {"answer": '{"catalysts": [{"date": "2026-03-03", "title": "Nvidia investment", '
                              '"description": "NVDA invested $2B.", "direction": "up"}]}',
                    "citations": []}
        return {"answer": "", "error": "perplexity daily budget reached", "budget_refused": True}

    monkeypatch.setattr(pplx, "web_search", fake)
    oc = {}
    items, _ = service._web_catalysts("NBIS", "Nebius", bars, None, outcome=oc)
    assert items is None
    assert oc["kind"] == "error"
