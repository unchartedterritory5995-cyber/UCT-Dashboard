"""`/api/filings/<ticker>` must not 'not found' an S&P 500 company.

⚰️ FOUND IN PRODUCTION 2026-09-12 while proving prod could reach sec.gov:

    GET /api/filings/MMC  ->  {"error": "ticker 'MMC' not found in SEC CIK map"}
    GET /api/filings/BK   ->  same

Both are S&P 500 filers. `_ticker_to_cik` resolves only through
`sec.gov/files/company_tickers.json`, and that file is PARTIAL — 10,426 entries,
missing MMC and BK — so the research/filings surface errors for real companies.
Same root cause as the withdrawn FMP ticket: treating that file's silence as
'this company does not exist'.

Control that makes the bug legible: `/api/filings/AAPL` returns cik 0000320193
and ten filings, so prod reaches SEC fine. The map is the defect, not the
network.

The fix is a FALLBACK, not a replacement: the map is a free in-memory hit for
the ~10k tickers it covers, and only a miss pays for a `browse-edgar` round
trip. Resolution logic is imported from `edgar` rather than copied, so there is
one authority on 'ticker -> CIK'.
"""
import importlib

import pytest


@pytest.fixture()
def sf(monkeypatch):
    import api.services.sec_filings as m
    importlib.reload(m)
    return m


def test_a_ticker_in_the_map_resolves_without_a_network_call(sf, monkeypatch):
    monkeypatch.setattr(sf, "_cik_map", lambda: {"AAPL": "0000320193"})
    calls = []
    monkeypatch.setattr(sf, "_edgar_resolve_cik", lambda t: (calls.append(t), "X")[1])
    assert sf._ticker_to_cik("AAPL") == "0000320193"
    assert calls == [], "spent a browse-edgar round trip on a ticker the map covers"


def test_a_ticker_missing_from_the_partial_map_falls_back(sf, monkeypatch):
    # The real MMC case. The map genuinely lacks it; EDGAR resolves it fine.
    monkeypatch.setattr(sf, "_cik_map", lambda: {"AAPL": "0000320193"})
    monkeypatch.setattr(sf, "_edgar_resolve_cik", lambda t: "0000062709")
    assert sf._ticker_to_cik("MMC") == "0000062709"


def test_an_unresolvable_ticker_is_still_none(sf, monkeypatch):
    monkeypatch.setattr(sf, "_cik_map", lambda: {})
    monkeypatch.setattr(sf, "_edgar_resolve_cik", lambda t: None)
    assert sf._ticker_to_cik("ZZZZ") is None


def test_a_raising_fallback_does_not_break_the_route(sf, monkeypatch):
    """`recent_filings` promises "never raises"; the fallback must not change
    that. An SEC outage should read as 'not found', not as a 500."""
    monkeypatch.setattr(sf, "_cik_map", lambda: {})

    def _boom(t):
        raise RuntimeError("sec.gov down")

    monkeypatch.setattr(sf, "_edgar_resolve_cik", _boom)
    assert sf._ticker_to_cik("MMC") is None


def test_blank_input_never_reaches_the_network(sf, monkeypatch):
    calls = []
    monkeypatch.setattr(sf, "_cik_map", lambda: {})
    monkeypatch.setattr(sf, "_edgar_resolve_cik", lambda t: (calls.append(t), None)[1])
    assert sf._ticker_to_cik("") is None
    assert sf._ticker_to_cik(None) is None
    assert calls == []


def test_resolution_has_one_authority(sf):
    """⛔ The browse-edgar logic must be IMPORTED, not copied. Two copies of
    'ticker -> CIK' is the second-authority-over-one-value defect this repo has
    paid for repeatedly."""
    import api.services.edgar as ed
    assert sf._edgar_resolve_cik is ed.resolve_cik
