"""Curator = the swing-trader/news-desk selection brain. These cover the
mechanical scaffolding (flag gating, compact keep/cut parsing, mapping,
ordering, cap, skip-if-stable, truncation guard, the LOUD never-break fallback,
and the `curator_ran` signal). The LLM call itself is always mocked."""
import json

import pytest

from api.services.catalyst import curator


MD = "2026-07-23"


@pytest.fixture(autouse=True)
def _clean_state(monkeypatch):
    # Isolate module-level per-date caches between tests.
    curator._CURATION_BY_DATE.clear()
    curator._RAN_BY_DATE.clear()
    curator._LAST_FALLBACK_REASON.clear()
    curator._POOL_HASH_BY_DATE.clear()
    curator._ORDER_BY_DATE.clear()
    # Never touch the real cost store / cap in unit tests.
    monkeypatch.setattr(curator.cost_guard, "may_synthesize", lambda md: True)
    monkeypatch.setattr(curator.cost_guard, "record", lambda *a, **k: 0.0)
    yield


def _c(ticker, score=10.0, tag="Catalyst", **kw):
    d = {"ticker": ticker, "score": score, "tag": tag,
         "gap_pct": kw.pop("gap_pct", 4.0), "vol_x": kw.pop("vol_x", 2.0)}
    d.update(kw)
    return d


def _mock_call(monkeypatch, keep, cut=None, stop_reason="end_turn"):
    """Patch the LLM call to return a compact keep/cut payload. Returns a
    counter list whose [0] is the number of times the LLM was invoked."""
    calls = [0]
    payload = json.dumps({"keep": keep, "cut": cut or []})

    def fake(model, prompt):
        calls[0] += 1
        return payload, 100, 50, stop_reason

    monkeypatch.setattr(curator, "_call", fake)
    return calls


# ── Flag gating + fallback ───────────────────────────────────────────────
def test_flag_off_uses_mechanical_selection(monkeypatch):
    monkeypatch.delenv("CATALYST_CURATOR_ENABLED", raising=False)
    calls = _mock_call(monkeypatch, ["AAA"])
    pool = [_c("AAA"), _c("BBB")]
    out = curator.curate(pool, market_date=MD)
    assert calls[0] == 0                      # LLM never called when flag off
    assert {c["ticker"] for c in out} == {"AAA", "BBB"}   # mechanical kept both
    assert curator.curator_ran(MD) is False


def test_empty_pool_returns_empty(monkeypatch):
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    calls = _mock_call(monkeypatch, [])
    assert curator.curate([], market_date=MD) == []
    assert calls[0] == 0


def test_cost_cap_falls_back(monkeypatch):
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    monkeypatch.setattr(curator.cost_guard, "may_synthesize", lambda md: False)
    calls = _mock_call(monkeypatch, ["AAA"])
    out = curator.curate([_c("AAA"), _c("BBB")], market_date=MD)
    assert calls[0] == 0                      # cost cap → no LLM
    assert len(out) == 2                       # mechanical fallback still returns
    assert curator.curator_ran(MD) is False


def test_bad_json_falls_back(monkeypatch):
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    monkeypatch.setattr(curator, "_call",
                        lambda m, p: ("not json at all", 10, 5, "end_turn"))
    out = curator.curate([_c("AAA"), _c("BBB")], market_date=MD)
    assert {c["ticker"] for c in out} == {"AAA", "BBB"}   # fell back, didn't break
    assert curator.curator_ran(MD) is False


def test_truncation_falls_back(monkeypatch):
    # A response cut off at max_tokens must fall back LOUDLY, not silently.
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    monkeypatch.setattr(curator, "_call",
                        lambda m, p: ('{"keep": ["AA', 10, 3000, "max_tokens"))
    out = curator.curate([_c("AAA"), _c("BBB")], market_date=MD)
    assert len(out) == 2
    assert curator.curator_ran(MD) is False


def test_llm_exception_falls_back(monkeypatch):
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")

    def boom(m, p):
        raise RuntimeError("api down")
    monkeypatch.setattr(curator, "_call", boom)
    out = curator.curate([_c("AAA")], market_date=MD)
    assert [c["ticker"] for c in out] == ["AAA"]          # never raises


def test_no_keepers_falls_back(monkeypatch):
    # If the curator keeps nothing, don't show a blank list — fall back.
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    _mock_call(monkeypatch, [], cut=["AAA", "BBB"])
    out = curator.curate([_c("AAA"), _c("BBB")], market_date=MD)
    assert len(out) == 2                       # mechanical fallback
    assert curator.curator_ran(MD) is False


# ── Happy path: curate + rank + cut ──────────────────────────────────────
def test_curate_ranks_and_cuts(monkeypatch):
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    _mock_call(monkeypatch, keep=["CCC", "AAA"], cut=["BBB"])
    pool = [_c("AAA", score=30), _c("BBB", score=20), _c("CCC", score=10)]
    out = curator.curate(pool, market_date=MD)
    # BBB cut; CCC ranked above AAA per the curator (NOT by raw score).
    assert [c["ticker"] for c in out] == ["CCC", "AAA"]
    assert out[0]["curator_rank"] == 1
    assert curator.curator_ran(MD) is True


def test_unmentioned_name_kept_as_safety_net(monkeypatch):
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    # Curator lists only AAA (keep); ZZZ appears in neither list → NOT dropped.
    _mock_call(monkeypatch, keep=["AAA"], cut=[])
    out = curator.curate([_c("AAA"), _c("ZZZ")], market_date=MD)
    assert {c["ticker"] for c in out} == {"AAA", "ZZZ"}
    assert out[0]["ticker"] == "AAA"           # ranked name leads the safety net


def test_explicit_cut_is_dropped(monkeypatch):
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    _mock_call(monkeypatch, keep=["AAA"], cut=["BBB"])
    out = curator.curate([_c("AAA"), _c("BBB")], market_date=MD)
    assert [c["ticker"] for c in out] == ["AAA"]
    assert curator.get_curation(MD)["BBB"]["keep"] is False


def test_object_items_tolerated(monkeypatch):
    # The model may return objects instead of bare ticker strings — tolerate it.
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    _mock_call(monkeypatch, keep=[{"ticker": "AAA"}], cut=[{"t": "BBB"}])
    out = curator.curate([_c("AAA"), _c("BBB")], market_date=MD)
    assert [c["ticker"] for c in out] == ["AAA"]


def test_target_cap_truncates(monkeypatch):
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    monkeypatch.setenv("CATALYST_CURATOR_TARGET", "3")
    keep = [f"T{i}" for i in range(1, 9)]
    _mock_call(monkeypatch, keep=keep)
    pool = [_c(f"T{i}", score=100 - i) for i in range(1, 9)]
    out = curator.curate(pool, market_date=MD)
    assert len(out) == 3
    assert [c["ticker"] for c in out] == ["T1", "T2", "T3"]


# ── Skip-if-stable ───────────────────────────────────────────────────────
def test_stable_pool_skips_rebill(monkeypatch):
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    calls = _mock_call(monkeypatch, keep=["AAA", "BBB"])
    curator.curate([_c("AAA"), _c("BBB")], market_date=MD)
    assert calls[0] == 1
    # Fresh candidate objects, identical signal fingerprint → reuse, no re-bill.
    out = curator.curate([_c("AAA"), _c("BBB")], market_date=MD)
    assert calls[0] == 1                       # LLM NOT called again
    assert [c["ticker"] for c in out] == ["AAA", "BBB"]
    assert curator.curator_ran(MD) is True


def test_changed_pool_rebills(monkeypatch):
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    calls = _mock_call(monkeypatch, keep=["AAA"])
    curator.curate([_c("AAA", gap_pct=4.0)], market_date=MD)
    assert calls[0] == 1
    # gap moved materially → fingerprint changes → re-curate.
    curator.curate([_c("AAA", gap_pct=9.0)], market_date=MD)
    assert calls[0] == 2


# ── Explain verdict surface ──────────────────────────────────────────────
def test_get_curation_exposes_verdicts(monkeypatch):
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    _mock_call(monkeypatch, keep=["AAA"], cut=["BBB"])
    curator.curate([_c("AAA"), _c("BBB")], market_date=MD)
    verdicts = curator.get_curation(MD)
    assert verdicts["AAA"]["keep"] is True
    assert verdicts["AAA"]["rank"] == 1
    assert verdicts["BBB"]["keep"] is False
