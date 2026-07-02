"""The research snapshot surfaces the company About blurb (yfinance
longBusinessSummary) delivered by get_fundamentals — Phase 3 of the
Robinhood-style Journal (per-stock detail page About section)."""
from __future__ import annotations

import api.services.research.snapshot as snap


def _clear_cache(sym):
    from api.services.cache import cache
    cache.set(f"research_snapshot::{sym}", None, 0)


def test_snapshot_passes_about_through(monkeypatch):
    _clear_cache("ABT")
    monkeypatch.setattr(snap, "get_fundamentals", lambda s: {
        "name": "AboutCo",
        "sector": "Tech",
        "about": "AboutCo builds widgets for the widget economy.",
    })
    monkeypatch.setattr(snap, "get_ratings", lambda s: {})

    out = snap.get_snapshot("ABT")
    assert out["about"] == "AboutCo builds widgets for the widget economy."


def test_snapshot_about_none_when_absent(monkeypatch):
    _clear_cache("NOB")
    monkeypatch.setattr(snap, "get_fundamentals", lambda s: {"name": "NoBlurb"})
    monkeypatch.setattr(snap, "get_ratings", lambda s: {})

    out = snap.get_snapshot("NOB")
    assert out["about"] is None
