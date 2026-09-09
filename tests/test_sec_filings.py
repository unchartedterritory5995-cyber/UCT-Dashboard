"""Tests for sec_filings.py's 2026-09-03 A6/A7 entity-resolution addition.
Additive only -- CIK identity resolution itself stays SEC's own
company_tickers.json (Entity Master has no CIK-mapping capability); the
error-path shape used by both the research router and S7's document_arrival
predicate is untouched."""
from api.services import sec_filings


def _fake_cik_map(monkeypatch, mapping):
    monkeypatch.setattr(sec_filings, "_cik_map", lambda: mapping)


def test_entity_field_present_on_a_successful_fetch(monkeypatch):
    _fake_cik_map(monkeypatch, {"AAPL": "0000320193"})
    monkeypatch.setattr(sec_filings, "resolve_entity",
                        lambda ticker: ({"status": "resolved", "entityId": "em_aapl"}, ticker))
    monkeypatch.setattr(sec_filings._CACHE, "get", lambda k: {
        "name": "Apple Inc.",
        "filings": {"recent": {"form": ["10-K"], "filingDate": ["2026-01-29"],
                               "accessionNumber": ["0000320193-26-000010"],
                               "primaryDocument": ["aapl-10k.htm"], "reportDate": ["2025-12-31"]}},
    })
    out = sec_filings.recent_filings("AAPL")
    assert out["entity"] == {"status": "resolved", "entityId": "em_aapl"}
    assert out["filings"][0]["period"] == "2025-12-31"


def test_entity_miss_never_blocks_the_fetch(monkeypatch):
    _fake_cik_map(monkeypatch, {"AAPL": "0000320193"})
    monkeypatch.setattr(sec_filings, "resolve_entity",
                        lambda ticker: ({"status": "not_found", "entityId": None}, ticker))
    monkeypatch.setattr(sec_filings._CACHE, "get", lambda k: {
        "name": "Apple Inc.",
        "filings": {"recent": {"form": ["10-K"], "filingDate": ["2026-01-29"],
                               "accessionNumber": [""], "primaryDocument": [""], "reportDate": [""]}},
    })
    out = sec_filings.recent_filings("AAPL")
    assert out["entity"]["status"] == "not_found"
    assert len(out["filings"]) == 1   # the fetch itself is unaffected


def test_unknown_ticker_error_shape_is_unchanged():
    """The exact error shape S7's document_arrival.py (and the research
    router) depend on -- must survive this pass untouched."""
    out = sec_filings.recent_filings("ZZZZNOTATICKER")
    assert out == {"error": "ticker 'ZZZZNOTATICKER' not found in SEC CIK map"}
    assert "entity" not in out
