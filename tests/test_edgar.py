import pytest
from unittest.mock import MagicMock


def test_parse_cik_from_url():
    from api.services.edgar import _parse_cik
    url = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810&type=8-K"
    assert _parse_cik(url) == "1045810"


def test_parse_cik_missing():
    from api.services.edgar import _parse_cik
    assert _parse_cik("https://example.com/no-cik") is None


def test_classify_8k_item():
    from api.services.edgar import _classify_8k
    assert _classify_8k("Item 2.02: Results of Operations and Financial Condition") == "EARN"
    assert _classify_8k("Item 1.01: Entry into a Material Definitive Agreement") == "M&A"
    assert _classify_8k("Item 8.01: Other Events") == "GENERAL"
    assert _classify_8k("Item 5.02: Departure of Directors") == "GENERAL"


def test_fetch_edgar_news_returns_list(monkeypatch):
    from api.services import edgar

    monkeypatch.setattr(edgar, "_fetch_cik_ticker_map", lambda: {"1045810": "AAPL"})

    sample_atom = """<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Apple Inc. - 8-K</title>
        <link href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;CIK=0001045810&amp;type=8-K"/>
        <updated>2026-03-03T07:30:00-05:00</updated>
        <summary>Item 2.02: Results of Operations and Financial Condition</summary>
      </entry>
    </feed>"""

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = sample_atom
    mock_response.raise_for_status = lambda: None

    monkeypatch.setattr(edgar._requests, "get", lambda *a, **kw: mock_response)

    results = edgar.fetch_edgar_news()
    assert len(results) == 1
    assert results[0]["category"] == "EARN"
    assert results[0]["source"] == "SEC EDGAR"
    assert results[0]["tickers"] == ["AAPL"]
    assert results[0]["sentiment"] == "neutral"
