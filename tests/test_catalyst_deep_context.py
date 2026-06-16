"""Tests for the DEEP reasoning-mode Perplexity context pass on top movers.

Covers `engine._enrich_top_movers_deep_context`:
- injects a synthetic RSS item for a top mover,
- respects CATALYST_DEEP_CONTEXT_TOP_N,
- per-day per-ticker cache (one web_search call per ticker per day),
- anti-hallucination drop on "No confirmed catalyst.",
- disabled via CATALYST_DEEP_CONTEXT_ENABLED=0,
- source-rich skip.
"""

import pytest

from api.services import perplexity_search
from api.services.catalyst import engine


@pytest.fixture(autouse=True)
def _reset_deep_cache():
    engine._DEEP_CONTEXT_DONE.clear()
    yield
    engine._DEEP_CONTEXT_DONE.clear()


@pytest.fixture(autouse=True)
def _enabled_by_default(monkeypatch):
    # Ensure a clean, enabled config unless a test overrides it.
    monkeypatch.delenv("CATALYST_DEEP_CONTEXT_ENABLED", raising=False)
    monkeypatch.delenv("CATALYST_DEEP_CONTEXT_TOP_N", raising=False)
    monkeypatch.delenv("CATALYST_DEEP_CONTEXT_MODE", raising=False)
    monkeypatch.delenv("CATALYST_SECTOR_STRICT", raising=False)
    yield


def _candidate(ticker, score=10.0, gap_pct=5.0, tweets=None, rss=None):
    return {
        "ticker": ticker,
        "score": score,
        "gap_pct": gap_pct,
        "tweets": tweets or [],
        "rss": rss or [],
        "rss_headline_count": len(rss or []),
    }


class _Stub:
    """Records calls and returns a canned web_search response."""

    def __init__(self, response):
        self.response = response
        self.calls = []

    def __call__(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self.response


def _install_stub(monkeypatch, response):
    stub = _Stub(response)
    # engine imports perplexity_search lazily (`from api.services import
    # perplexity_search`), so patch the source module's attribute.
    monkeypatch.setattr(perplexity_search, "web_search", stub, raising=True)
    return stub


def test_injects_deep_context_rss_item(monkeypatch):
    stub = _install_stub(monkeypatch, {
        "answer": "Beat on EPS, raised guidance; peers up; resistance $50.",
        "citations": ["http://x"],
    })
    c = _candidate("AAA")
    engine._enrich_top_movers_deep_context([c], "2026-06-15")

    assert len(stub.calls) == 1
    items = [r for r in c["rss"] if r["source"] == "Perplexity (deep context)"]
    assert len(items) == 1
    item = items[0]
    assert item["title"].startswith("Beat on EPS")
    assert item["url"] == "http://x"
    assert isinstance(item["time_published"], int)
    assert c["rss_headline_count"] == len(c["rss"])


def test_respects_top_n(monkeypatch):
    monkeypatch.setenv("CATALYST_DEEP_CONTEXT_TOP_N", "1")
    stub = _install_stub(monkeypatch, {"answer": "Confirmed catalyst.", "citations": []})

    high = _candidate("HIGH", score=99.0)
    low = _candidate("LOW", score=1.0)
    engine._enrich_top_movers_deep_context([low, high], "2026-06-15")

    # Only the single highest-scored candidate is enriched.
    assert len(stub.calls) == 1
    assert any(r["source"] == "Perplexity (deep context)" for r in high["rss"])
    assert not any(r["source"] == "Perplexity (deep context)" for r in low["rss"])


def test_per_day_cache_one_call_per_ticker(monkeypatch):
    stub = _install_stub(monkeypatch, {"answer": "Confirmed catalyst.", "citations": []})
    md = "2026-06-15"

    c1 = _candidate("AAA")
    engine._enrich_top_movers_deep_context([c1], md)
    # Second pass same day, same ticker → no new web_search.
    c2 = _candidate("AAA")
    engine._enrich_top_movers_deep_context([c2], md)

    assert len(stub.calls) == 1
    assert not any(r["source"] == "Perplexity (deep context)" for r in c2["rss"])

    # A new market_date pays again.
    c3 = _candidate("AAA")
    engine._enrich_top_movers_deep_context([c3], "2026-06-16")
    assert len(stub.calls) == 2


def test_anti_hallucination_drop(monkeypatch):
    stub = _install_stub(monkeypatch, {"answer": "No confirmed catalyst.", "citations": []})
    c = _candidate("AAA")
    engine._enrich_top_movers_deep_context([c], "2026-06-15")

    assert len(stub.calls) == 1
    assert not any(r["source"] == "Perplexity (deep context)" for r in c["rss"])
    # Still marked done so we don't re-pay.
    assert "AAA" in engine._DEEP_CONTEXT_DONE["2026-06-15"]
    engine._enrich_top_movers_deep_context([c], "2026-06-15")
    assert len(stub.calls) == 1


def test_disabled_never_calls(monkeypatch):
    monkeypatch.setenv("CATALYST_DEEP_CONTEXT_ENABLED", "0")
    stub = _install_stub(monkeypatch, {"answer": "Confirmed.", "citations": []})
    c = _candidate("AAA")
    engine._enrich_top_movers_deep_context([c], "2026-06-15")
    assert len(stub.calls) == 0
    assert not any(r["source"] == "Perplexity (deep context)" for r in c["rss"])


def test_source_rich_skip(monkeypatch):
    stub = _install_stub(monkeypatch, {"answer": "Confirmed.", "citations": []})
    tweets = [{"id": str(i)} for i in range(6)]   # 6 tweets > 5
    rss = [{"title": f"r{i}", "url": f"u{i}"} for i in range(3)]  # 3 rss > 2
    c = _candidate("AAA", tweets=tweets, rss=rss)
    engine._enrich_top_movers_deep_context([c], "2026-06-15")

    assert len(stub.calls) == 0
    assert not any(r.get("source") == "Perplexity (deep context)" for r in c["rss"])
