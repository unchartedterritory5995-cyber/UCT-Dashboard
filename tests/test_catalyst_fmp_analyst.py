"""FMP analyst source: market-wide rating-change feed → analyst_meta."""
import pytest

from api.services.catalyst import sources


def _rows_response(monkeypatch, rows):
    class _Resp:
        def raise_for_status(self): pass
        def json(self): return rows
    monkeypatch.setattr("requests.get", lambda *a, **k: _Resp())


def test_disabled_returns_empty(monkeypatch):
    monkeypatch.setenv("CATALYST_FMP_ANALYST_ENABLED", "0")
    monkeypatch.setenv("FMP_API_KEY", "k")
    assert sources._pull_fmp_analyst() == {}


def test_no_key_returns_empty(monkeypatch):
    monkeypatch.setenv("CATALYST_FMP_ANALYST_ENABLED", "1")
    monkeypatch.delenv("FMP_API_KEY", raising=False)
    assert sources._pull_fmp_analyst() == {}


def test_failsoft_on_error(monkeypatch):
    monkeypatch.setenv("CATALYST_FMP_ANALYST_ENABLED", "1")
    monkeypatch.setenv("FMP_API_KEY", "k")

    def boom(*a, **k):
        raise RuntimeError("fmp down")
    monkeypatch.setattr("requests.get", boom)
    assert sources._pull_fmp_analyst() == {}


def test_keeps_rating_changes_drops_reiterations(monkeypatch):
    monkeypatch.setenv("CATALYST_FMP_ANALYST_ENABLED", "1")
    monkeypatch.setenv("FMP_API_KEY", "k")
    _rows_response(monkeypatch, [
        {"symbol": "NVDA", "action": "upgrade", "previousGrade": "Hold",
         "newGrade": "Buy", "gradingCompany": "Morgan Stanley",
         "publishedDate": "2026-07-23T10:00:00.000Z"},
        {"symbol": "AAPL", "action": "hold", "previousGrade": "Buy",
         "newGrade": "Buy", "gradingCompany": "Barclays",
         "publishedDate": "2026-07-23T10:05:00.000Z"},   # reiterate → dropped
        {"symbol": "TSLA", "action": "downgrade", "previousGrade": "Buy",
         "newGrade": "Hold", "gradingCompany": "UBS",
         "publishedDate": "2026-07-23T09:30:00.000Z"},
    ])
    out = sources._pull_fmp_analyst()
    assert set(out.keys()) == {"NVDA", "TSLA"}          # AAPL reiterate dropped
    assert out["NVDA"]["action"] == "upgrade"
    assert out["NVDA"]["firm"] == "Morgan Stanley"
    assert out["NVDA"]["from_rating"] == "Hold" and out["NVDA"]["to_rating"] == "Buy"
    assert out["TSLA"]["action"] == "downgrade"


def test_newest_per_symbol_wins(monkeypatch):
    monkeypatch.setenv("CATALYST_FMP_ANALYST_ENABLED", "1")
    monkeypatch.setenv("FMP_API_KEY", "k")
    # rows are newest-first; the first occurrence per symbol is the freshest.
    _rows_response(monkeypatch, [
        {"symbol": "MU", "action": "upgrade", "previousGrade": "Hold",
         "newGrade": "Buy", "gradingCompany": "Citi", "publishedDate": "2026-07-23T11:00:00Z"},
        {"symbol": "mu", "action": "downgrade", "previousGrade": "Buy",
         "newGrade": "Hold", "gradingCompany": "BofA", "publishedDate": "2026-07-23T08:00:00Z"},
    ])
    out = sources._pull_fmp_analyst()
    assert list(out.keys()) == ["MU"]
    assert out["MU"]["action"] == "upgrade" and out["MU"]["firm"] == "Citi"


def test_keeps_grade_change_even_without_action(monkeypatch):
    monkeypatch.setenv("CATALYST_FMP_ANALYST_ENABLED", "1")
    monkeypatch.setenv("FMP_API_KEY", "k")
    _rows_response(monkeypatch, [
        {"symbol": "AMD", "action": "", "previousGrade": "Neutral",
         "newGrade": "Outperform", "gradingCompany": "Mizuho",
         "publishedDate": "2026-07-23T12:00:00Z"},   # grade changed → kept
    ])
    out = sources._pull_fmp_analyst()
    assert "AMD" in out and out["AMD"]["to_rating"] == "Outperform"
