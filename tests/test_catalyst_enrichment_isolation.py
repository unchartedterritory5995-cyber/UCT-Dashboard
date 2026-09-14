"""F-CAT-1 — one best-effort enrichment must never cost a whole refresh.

⚰️ **THE OUTAGE THIS REPRODUCES (2026-09-08 → 2026-09-11, four trading days).**
`engine.run_refresh` billed the curator LLM 31–52 times a day and wrote **zero
rows** — not even the unranked backfill. Measured in production:

  * 09-08 12:47Z was the last per-ticker synthesis call, ever.
  * 09-09/10/11: 118 billed `_CURATOR` calls, **0** per-ticker synthesis calls,
    **0** persisted rows, while the gate logged 13,577 rejections on 09-11 and
    the curator prompt was a healthy 8,436 tokens (a full 40-name pool).

So the pipeline was intact right up to and including curation, and the abort was
in `engine.py`'s span between `curator.curate()` returning and the first
`store.upsert_catalyst()` — **eight consecutive unguarded calls**. Every one of
those enrichments documents itself as "best-effort" / "never raises", but the
SPAN was not wired that way: an exception escaped `run_refresh` (whose own
docstring claims "Never raises — all errors swallowed + logged"), skipping BOTH
the synthesis loop AND the unranked backfill.

⭐ **The defect is the span, not any one enrichment.** That is why these tests
parametrise over EVERY stage rather than pinning the one that happened to fail:
the next unguarded call added to that block is caught here by name, and the
specific exception never has to be identified to be survived.

⛔ **A run that spends money must leave a record of why it wrote nothing.**
`summary["errors"]` was logged and never persisted, which is the sole reason
four days of this cost could not be diagnosed after the fact. The receipt
assertions below are that lesson as a rail.
"""
import os
import tempfile
from unittest.mock import patch

import pytest

from api.services.catalyst import engine, store


# Every call in the unguarded span, with its arity. Derived list: if a new
# enrichment joins the block without a guard, add it here and the rail proves
# it survives — or fails by name if it does not.
ENRICHMENT_STAGES = [
    "_enrich_with_twitter_search",
    "_enrich_with_analyst_actions",
    "_enrich_with_rating_changes",
    "_enrich_with_ticker_news",
    "_enrich_with_perplexity",
    "_enrich_earnings_with_perplexity",
    "_enrich_top_movers_deep_context",
]


@pytest.fixture
def s(monkeypatch):
    monkeypatch.setenv("CATALYST_IGNORE_MARKET_CALENDAR", "1")
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(store, "_DB_PATH", os.path.join(d, "catalysts.db"))
        store._init_db()
        yield


def _candidate(ticker, gap_pct=5.0, vol_x=2.0):
    return {
        "ticker": ticker, "company": ticker, "price": 50.0,
        "gap_pct": gap_pct, "vol_x": vol_x, "market_cap": 1_000_000_000,
        "sector": "Tech",
        "tweets": [{"id": ticker, "text": "x", "author_handle": "h", "url": "u"},
                   {"id": ticker + "b", "text": "y", "author_handle": "h", "url": "u"}],
        "rss": [], "earnings_meta": None,
        "earnings_reported_recently": False, "earnings_just_reported": False,
        "tweet_mention_count": 2, "rss_headline_count": 0,
        "scanner_setup": None, "sector_momentum_count": 0,
    }


_FAKE_THESIS = {
    "thesis_text": "test thesis", "thesis_model": "claude-sonnet-4-6",
    "thesis_at": 1000, "thesis_sources": "[]", "signals_hash": "hash",
    "grade": "A", "catalyst_type": "news",
    "was_cached": False, "input_tokens": 100, "output_tokens": 50,
}


def _cands(n=12):
    return [_candidate(f"CAT{i}", gap_pct=10 + i) for i in range(n)]


def _run(stage_to_break=None):
    """Run one refresh, optionally with `stage_to_break` raising."""
    patches = [
        patch("api.services.catalyst.engine.sources.collect_all", return_value=_cands()),
        patch("api.services.catalyst.engine.synthesize.synthesize_ticker",
              return_value=dict(_FAKE_THESIS)),
    ]
    if stage_to_break:
        def _boom(*a, **k):
            raise RuntimeError(f"{stage_to_break} exploded")
        # The stub must impersonate the real function: the receipt derives the
        # stage name from `fn.__name__`, so a stub called "_boom" would prove
        # the rail works while reporting a name no operator could act on.
        _boom.__name__ = stage_to_break
        patches.append(patch.object(engine, stage_to_break, _boom))
    for p in patches:
        p.start()
    try:
        return engine.run_refresh()
    finally:
        for p in reversed(patches):
            p.stop()


# ---------------------------------------------------------------- the control

def test_control_a_clean_run_writes_rows(s):
    """NON-VACUITY. If this ever stops writing rows, every assertion below
    passes for the wrong reason — a broken fixture would 'prove' resilience."""
    summary = _run()
    rows = store.get_for_date(engine._today_market_date())
    assert len(rows) == 12, f"fixture is broken: clean run wrote {len(rows)} rows"
    assert summary["synthesized"] == 12
    assert not summary["errors"], f"clean run reported errors: {summary['errors']}"


# ------------------------------------------------------- the outage, per stage

@pytest.mark.parametrize("stage", ENRICHMENT_STAGES)
def test_a_raising_enrichment_still_persists_the_run(s, stage):
    """THE REPRODUCTION. A best-effort enrichment that raises must not cost the
    curator+hunter spend the run already paid for. Before the fix this raises
    RuntimeError out of run_refresh and writes nothing."""
    summary = _run(stage_to_break=stage)

    rows = store.get_for_date(engine._today_market_date())
    assert rows, (
        f"{stage} raised and the ENTIRE refresh was lost — this is the "
        f"2026-09-09 outage: LLM spend billed, zero rows persisted"
    )
    assert len(rows) == 12
    assert summary["synthesized"] == 12


@pytest.mark.parametrize("stage", ENRICHMENT_STAGES)
def test_a_raising_enrichment_names_itself_in_the_receipt(s, stage):
    """A swallowed failure that leaves no record is how four days of spend went
    undiagnosed. The stage must name itself, with its exception."""
    summary = _run(stage_to_break=stage)

    blob = " ".join(summary["errors"])
    assert stage in blob, f"the receipt does not name the failing stage: {summary['errors']}"
    assert "RuntimeError" in blob, f"the receipt drops the exception type: {summary['errors']}"


def test_the_span_between_curation_and_upsert_is_fully_guarded(s):
    """Belt and braces: break EVERY enrichment at once. The run still has to
    produce a complete, ranked, persisted result."""
    def _make_boom(st):
        def _boom(*a, **k):
            raise RuntimeError(f"{st} exploded")
        _boom.__name__ = st
        return _boom

    patches = [patch.object(engine, st, _make_boom(st)) for st in ENRICHMENT_STAGES]
    patches += [
        patch("api.services.catalyst.engine.sources.collect_all", return_value=_cands()),
        patch("api.services.catalyst.engine.synthesize.synthesize_ticker",
              return_value=dict(_FAKE_THESIS)),
    ]
    for p in patches:
        p.start()
    try:
        summary = engine.run_refresh()
    finally:
        for p in reversed(patches):
            p.stop()

    rows = store.get_for_date(engine._today_market_date())
    assert len(rows) == 12
    assert len([r for r in rows if r["rank"] is not None]) == 12
    assert len(summary["errors"]) == len(ENRICHMENT_STAGES)
