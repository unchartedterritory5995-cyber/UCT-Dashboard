"""Market-impact marks on Trade Exchange headlines: plain, testable rules, no model.
Synthetic headlines only. Precision over recall: commentary, previews and ordinary
corporate news stay unmarked."""
from __future__ import annotations

import pytest

from api.services.trade_exchange_news import categories as cat
from api.services.trade_exchange_news import pipeline as pl


@pytest.mark.parametrize("source,text,kind", [
    ("TX-News", "ACME HALTED: NEWS PENDING", cat.HALT),
    ("TX-News", "Acme shares resume trading after halt", cat.HALT),
    ("TX-News", "FED HOLDS RATES STEADY AT 4.25%-4.50%", cat.CENTRAL_BANK),
    ("TX-News", "ECB cuts its deposit rate by 25bp", cat.CENTRAL_BANK),
    ("TX-News", "BANK OF JAPAN RAISES POLICY RATE TO 0.75%", cat.CENTRAL_BANK),
    ("TX-News", "FOMC RATE DECISION: 4.00%-4.25% VS 4.00%-4.25% EST", cat.CENTRAL_BANK),
    ("TX-News1", "US CPI (Y/Y) Oct: 3.1% (est 3.0%)", cat.ECON_RELEASE),
    ("TX-News1", "US NONFARM PAYROLLS 175K VS 150K EXPECTED", cat.ECON_RELEASE),
    ("TX-News1", "INITIAL JOBLESS CLAIMS ACTUAL 221K", cat.ECON_RELEASE),
    ("TX-PressRelease", "ACME - Acme Corp. Enters Into Definitive Agreement to Be Acquired by Example Holdings", cat.MNA),
    ("TX-News", "EXAMPLE CO AGREES TO ACQUIRE ACME FOR $5 BILLION", cat.MNA),
    ("TX-News", "Acme Retail files for Chapter 11 bankruptcy protection", cat.BANKRUPTCY),
    ("TX-News", "FDA approves Example Bio's obesity drug", cat.REGULATORY),
    ("TX-PressRelease", "ACME - Acme Reports Q3 Results; Raises Full-Year 2026 Guidance", cat.GUIDANCE),
    ("TX-News", "Acme withdraws its annual outlook", cat.GUIDANCE),
    ("TX-News", "ACME CEO TO STEP DOWN AT YEAR END", cat.LEADERSHIP),
])
def test_plain_market_events_are_marked(source, text, kind):
    assert cat.impact_for(source, text) == kind


@pytest.mark.parametrize("source,text", [
    ("TX-News", "ECB OFFICIALS ARE READY TO RAISE INTEREST RATES IF NEEDED - SOURCES"),   # commentary
    ("TX-News", "Fed's Waller says rate cuts may come later this year"),                   # a speaker's view
    ("TX-News", "What to watch: CPI preview for next week"),                               # no figure
    ("TX-News1", "GDP growth expected to slow, economists say"),                           # no figure
    ("TX-PressRelease", "ACME - Acme Announces Third Quarter 2026 Results"),               # routine earnings
    ("TX-PressRelease", "ACME - Acme Declares Quarterly Dividend"),
    ("TX-News", "Tariff talks resume after a pause - AP"),
    ("TX-News", "GOOGL lows"),
    ("TX-News", "CEO speaks at the 2026 Global Industrial Conference"),
    ("TX-Filings", "FORM 8-K - ACME - Acme agrees to acquire Example"),                    # filings: forms, not prose
    ("TX-News", ""),
])
def test_uncertain_or_routine_news_is_not_marked(source, text):
    assert cat.impact_for(source, text) is None


def test_every_mark_has_a_plain_reason():
    kinds = {k for k, _ in cat._IMPACT_RULES}
    assert kinds == set(cat.IMPACT_REASONS)


def test_the_event_carries_the_impact_kind():
    row = {"seq": 1, "event_id": "E1", "source": "TX-News", "content": "FED HOLDS RATES STEADY",
           "received_at_ms": 1000, "ingested_at_ms": 1000, "repeat_count": 0, "via": "push"}
    assert pl.headline_event(row)["impact"] == cat.CENTRAL_BANK
    assert pl.headline_event({**row, "content": "Markets drift"})["impact"] is None
