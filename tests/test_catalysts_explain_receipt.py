"""TERM-057 -- GET /api/catalysts/explain/{sym}'s `verdict` field, the machine
answer the "Why isn't X here" receipt (`AbsenceReceipt.jsx`) renders.

Every source, gate, tagger, scorer and curator read is stubbed, so each test
states the exact pool it runs over. The persisted list is a real, ISOLATED
catalysts.db (the history-endpoint test's lesson: a test that does not isolate
this reads the owner's live `C:\\data\\catalysts.db`).

The load-bearing distinction: a name no source surfaced is `not_evaluated`, a
name a gate dropped is `excluded_by_gate` -- two different facts that must never
share a verdict.
"""
import os
import tempfile

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.middleware.auth_middleware import get_current_user
from api.routers import catalysts as catalysts_router
from api.services.catalyst import (
    curator, filters, scoring, selection, sources, store as catalyst_store, tagging,
)

USER = {"id": "explain-1", "email": "explain@example.test", "role": "member", "plan": "pro"}
MD = "2026-09-29"


@pytest.fixture(autouse=True)
def _isolated(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(catalyst_store, "_DB_PATH", os.path.join(d, "catalysts.db"))
        catalyst_store._init_db()
        monkeypatch.setattr(catalysts_router, "_today", lambda: MD)
        monkeypatch.setattr(curator, "get_curation", lambda md: {})
        monkeypatch.setattr(curator, "curator_ran", lambda md: False)
        # L7: the explain answer is cached per (symbol, market date). Each test
        # states its own pool, so each starts with an empty cache.
        catalysts_router._explain_cache.clear()
        catalysts_router._explain_inflight.clear()
        yield
        catalysts_router._explain_cache.clear()


@pytest.fixture
def client():
    app.dependency_overrides[get_current_user] = lambda: dict(USER)
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.pop(get_current_user, None)


def _pool(monkeypatch, cands, *, blocked=None, tags=None):
    """cands: list of (ticker, score). blocked: {ticker: (gate, reason)}.
    tags: {ticker: tag or None}; default tag 'Catalyst'."""
    blocked = blocked or {}
    tags = tags or {}
    monkeypatch.setattr(sources, "collect_all",
                        lambda *a, **k: [{"ticker": t, "_s": s} for t, s in cands])

    def quality(c):
        g = blocked.get(c["ticker"])
        return (False, g[1]) if g and g[0] == "quality" else (True, None)

    def real(c):
        g = blocked.get(c["ticker"])
        return (False, g[1]) if g and g[0] == "real_catalyst" else (True, None)

    monkeypatch.setattr(filters, "quality_gate", quality)
    monkeypatch.setattr(filters, "is_real_catalyst", real)
    monkeypatch.setattr(tagging, "assign_tag", lambda c: tags.get(c["ticker"], "Catalyst"))
    monkeypatch.setattr(scoring, "score", lambda c: float(c["_s"]))


def _seed_listed(ticker, rank):
    catalyst_store.upsert_catalyst({
        "market_date": MD, "ticker": ticker, "rank": rank, "score": 10.0,
        "tag": "Catalyst", "price": 100.0, "gap_pct": 5.0, "vol_x": 2.0,
        "market_cap": 1_000_000_000, "sector": "Tech", "thesis_text": "t",
        "thesis_model": "m", "thesis_at": 1, "thesis_sources": "[]",
        "signals_hash": "h", "catalyst_at": None, "raw_signals": "{}",
    })


def _get(client, sym):
    resp = client.get(f"/api/catalysts/explain/{sym}")
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_every_verdict_is_declared():
    assert set(catalysts_router.EXPLAIN_VERDICTS) == {
        "on_list", "not_evaluated", "excluded_by_gate", "no_qualifying_signal",
        "quota_full", "cut_by_curator", "not_selected", "qualifies_now",
    }


def test_a_name_no_source_surfaced_is_NOT_EVALUATED_never_excluded(client, monkeypatch):
    _pool(monkeypatch, [("AAA", 10)])
    body = _get(client, "ZZZZ")
    assert body["verdict"] == "not_evaluated"
    assert body["found"] is False
    assert "excluded_by_gate" not in body
    assert body["pool_size"] == 1
    assert body["market_date"] == MD


def test_an_empty_pull_is_not_evaluated_with_pool_size_zero(client, monkeypatch):
    _pool(monkeypatch, [])
    body = _get(client, "NVDA")
    assert body["verdict"] == "not_evaluated"
    assert body["pool_size"] == 0


@pytest.mark.parametrize("gate", ["quality", "real_catalyst"])
def test_a_gate_exclusion_names_WHICH_gate_and_its_own_words(client, monkeypatch, gate):
    _pool(monkeypatch, [("PENY", 5)], blocked={"PENY": (gate, "price $1.20 below $3 floor")})
    body = _get(client, "PENY")
    assert body["verdict"] == "excluded_by_gate"
    assert body["gate"] == gate
    assert body["gate_reason"] == "price $1.20 below $3 floor"
    assert body["excluded_by_gate"] is True          # pre-TERM-057 key kept


def test_an_untagged_gate_passer_has_no_qualifying_signal(client, monkeypatch):
    _pool(monkeypatch, [("AAA", 10), ("QUIET", 3)], tags={"QUIET": None})
    body = _get(client, "QUIET")
    assert body["verdict"] == "no_qualifying_signal"


def test_a_name_behind_a_FULL_BUCKET_says_which_bucket(client, monkeypatch):
    # More Gapper names than the Gapper bucket holds, plus enough higher-scored
    # Catalyst names that the selector's "redistribute unfilled slots" pass
    # fills the whole list with Catalysts rather than the tail Gappers.
    slots = selection.quota_for("Gapper")
    total = sum(selection.quota_for(t) for t in selection._DEFAULT_QUOTA)
    names = [(f"G{chr(65 + i)}", 100 - i) for i in range(slots + 4)]
    pad = [(f"C{chr(65 + i // 26)}{chr(65 + i % 26)}", 200 - i) for i in range(total)]
    tag_map = {t: "Gapper" for t, _ in names}
    tag_map.update({t: "Catalyst" for t, _ in pad})
    _pool(monkeypatch, names + pad, tags=tag_map)
    last = names[-1][0]
    body = _get(client, last)
    assert body["verdict"] == "quota_full"
    assert body["quota"]["tag"] == "Gapper"
    assert body["quota"]["slots"] == slots
    assert body["quota"]["rank_in_tag"] == len(names)
    assert body["quota"]["in_tag"] == len(names)
    assert body["quota"]["rank_in_tag"] > body["quota"]["slots"]


def test_a_name_the_selector_would_pick_now_is_qualifies_now(client, monkeypatch):
    _pool(monkeypatch, [("AAA", 10)])
    body = _get(client, "AAA")
    assert body["verdict"] == "qualifies_now"
    assert body["quota"]["tag"] == "Catalyst"


def test_the_persisted_list_wins_over_the_live_check(client, monkeypatch):
    _seed_listed("ONL", 4)
    _pool(monkeypatch, [("AAA", 10)])       # ONL absent from the live pull
    body = _get(client, "ONL")
    assert body["verdict"] == "on_list"
    assert body["list_rank"] == 4


def test_an_unranked_persisted_row_is_NOT_on_the_list(client, monkeypatch):
    _seed_listed("OFF", None)
    _pool(monkeypatch, [("AAA", 10)])
    body = _get(client, "OFF")
    assert body["verdict"] == "not_evaluated"
    assert body["list_rank"] is None


def test_a_curator_cut_is_named(client, monkeypatch):
    _pool(monkeypatch, [("CUT", 10)])
    monkeypatch.setattr(curator, "get_curation", lambda md: {"CUT": {"keep": False, "rank": None}})
    monkeypatch.setattr(curator, "curator_ran", lambda md: True)
    body = _get(client, "CUT")
    assert body["verdict"] == "cut_by_curator"


def test_when_the_curator_ran_no_quota_bucket_is_blamed(client, monkeypatch):
    _pool(monkeypatch, [("AAA", 10), ("BBB", 5)])
    monkeypatch.setattr(curator, "curator_ran", lambda md: True)
    body = _get(client, "BBB")
    assert body["verdict"] == "not_selected"
    assert body["quota"] is None


def test_quota_for_is_the_value_the_selector_fills():
    for tag, n in selection._DEFAULT_QUOTA.items():
        assert selection.quota_for(tag) == selection._quota(tag, n)
    assert selection.quota_for("NotATag") == 0


# ── R6: dual-class tickers ───────────────────────────────────────────────────

@pytest.mark.parametrize("sym", ["BRK.B", "BRK-B", "brk.b"])
def test_a_dual_class_ticker_is_explained_not_refused(client, monkeypatch, sym):
    _pool(monkeypatch, [("BRK.B", 10)])
    body = _get(client, sym)
    assert body["found"] is True and body["verdict"] == "qualifies_now"


@pytest.mark.parametrize("sym", ["BRK..B", "TOOLONGX", "A-BCD", "12AB"])
def test_a_malformed_ticker_is_still_a_400(client, monkeypatch, sym):
    _pool(monkeypatch, [])
    assert client.get(f"/api/catalysts/explain/{sym}").status_code == 400


def test_a_dual_class_name_listed_under_the_other_spelling_is_on_list(client, monkeypatch):
    _seed_listed("BRK-B", 3)
    _pool(monkeypatch, [("AAA", 10)])
    body = _get(client, "BRK.B")
    assert body["verdict"] == "on_list" and body["list_rank"] == 3


# ── L7: cached per (symbol, market date), single-flight ──────────────────────

def test_a_second_request_inside_the_window_does_not_re_pull(client, monkeypatch):
    _pool(monkeypatch, [("AAA", 10)])
    calls = []
    real = sources.collect_all
    monkeypatch.setattr(sources, "collect_all", lambda *a, **k: calls.append(1) or real())
    first = _get(client, "AAA")
    second = _get(client, "AAA")
    assert len(calls) == 1
    assert first["verdict"] == second["verdict"] == "qualifies_now"
    assert first["checked_at"] == second["checked_at"]


def test_the_window_expires(client, monkeypatch):
    _pool(monkeypatch, [("AAA", 10)])
    calls = []
    real = sources.collect_all
    monkeypatch.setattr(sources, "collect_all", lambda *a, **k: calls.append(1) or real())
    _get(client, "AAA")
    key = ("AAA", MD)
    ts, res = catalysts_router._explain_cache[key]
    catalysts_router._explain_cache[key] = (ts - catalysts_router.EXPLAIN_TTL_SECONDS - 1, res)
    _get(client, "AAA")
    assert len(calls) == 2


def test_a_new_market_date_is_a_new_key(client, monkeypatch):
    _pool(monkeypatch, [("AAA", 10)])
    calls = []
    real = sources.collect_all
    monkeypatch.setattr(sources, "collect_all", lambda *a, **k: calls.append(1) or real())
    _get(client, "AAA")
    monkeypatch.setattr(catalysts_router, "_today", lambda: "2026-09-30")
    _get(client, "AAA")
    assert len(calls) == 2


def test_the_list_rank_is_read_LIVE_over_a_cached_answer(client, monkeypatch):
    _pool(monkeypatch, [("AAA", 10)])
    assert _get(client, "AAA")["verdict"] == "qualifies_now"
    _seed_listed("AAA", 2)                       # the refresh put it on the list
    body = _get(client, "AAA")
    assert body["verdict"] == "on_list" and body["list_rank"] == 2


def test_concurrent_misses_share_ONE_pull(monkeypatch):
    import threading
    _pool(monkeypatch, [("AAA", 10)])
    gate, calls = threading.Event(), []
    real = sources.collect_all

    def slow(*a, **k):
        calls.append(1)
        gate.wait(5)
        return real()
    monkeypatch.setattr(sources, "collect_all", slow)
    results = []
    threads = [threading.Thread(target=lambda: results.append(
        catalysts_router._explain_cached("AAA", MD))) for _ in range(4)]
    for t in threads:
        t.start()
    import time as _t
    _t.sleep(0.2)
    gate.set()
    for t in threads:
        t.join(5)
    assert len(calls) == 1 and len(results) == 4
    assert len({r["checked_at"] for r in results}) == 1


def test_a_failed_pull_is_not_cached(client, monkeypatch):
    _pool(monkeypatch, [("AAA", 10)])
    real = sources.collect_all
    state = {"n": 0}

    def flaky(*a, **k):
        state["n"] += 1
        if state["n"] == 1:
            raise RuntimeError("perplexity down")
        return real()
    monkeypatch.setattr(sources, "collect_all", flaky)
    assert client.get("/api/catalysts/explain/AAA").status_code == 500
    assert _get(client, "AAA")["verdict"] == "qualifies_now"
    assert state["n"] == 2
