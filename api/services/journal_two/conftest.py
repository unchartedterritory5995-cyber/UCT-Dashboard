"""Shared test fixtures for api/services/journal_two/.

Kept minimal on purpose — most test files in this directory build their own
sqlite connection/schema inline rather than sharing a fixture, and that stays
unchanged here. This file exists for exactly ONE cross-cutting concern.
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _no_real_ticker_metadata_calls(monkeypatch):
    """get_symbol_backlinks() (P0-3, Wave 1 Slice 2) calls
    ticker_meta.get_ticker_meta() for its sector/industry/theme enrichment
    whenever a symbol has ≥1 match. Left unmocked, ANY test in this directory
    that reaches that path with a real-looking symbol and count > 0 would
    make a REAL yfinance/FMP/Finnhub network call — slow, flaky, and exactly
    the hidden external dependency this program's test-hygiene discipline
    exists to prevent (discovered when a router-level isolation test for the
    new backlinks enrichment silently made a real network call for "NVDA").

    Autouse at the DIRECTORY level so a new test file can't reintroduce the
    same silent dependency by omission. A test that wants a SPECIFIC return
    value or failure (see test_notes.py's two enrichment-specific tests)
    calls `monkeypatch.setattr` again inside its own body — the later call
    safely overrides this default for that one test only.
    """
    import api.services.ticker_meta as ticker_meta_mod
    monkeypatch.setattr(ticker_meta_mod, "get_ticker_meta", lambda sym: {
        "name": None, "sector": None, "industry": None, "exchange": None, "theme": None,
    })
