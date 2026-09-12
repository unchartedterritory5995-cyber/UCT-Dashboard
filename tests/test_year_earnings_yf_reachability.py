"""The yfinance leg of get_year_earnings must be REACHABLE for a US ticker.

`_gather` chains FMP -> Finnhub -> yfinance, but the yfinance leg was gated on
`"." in prov or any(ch.isdigit() for ch in prov)` — a test of the SYMBOL'S SHAPE.
A plain US ticker (`MMC`, `BK`, `HOLX`) satisfies neither, so for every ordinary
US stock the third provider in a three-provider chain could never run at all.

Measured 2026-09-12: 24 of 300 random universe tickers had a reported strip more
than a quarter stale, and the Finnhub gap-fill rescued ZERO of them. The chain
read like defence in depth and was two providers deep for the names members
actually open.

The gate is now about WHEN the gap matters, not what the symbol looks like: a
hole in the current or previous fiscal year is the member-visible strip, and a
hole in a decade-old year is historical trivia not worth a slow call.
"""
import importlib


def _mod(monkeypatch):
    import api.services.earnings_estimates as ee
    importlib.reload(ee)
    monkeypatch.setattr(ee.cache, "get", lambda k: None)
    monkeypatch.setattr(ee.cache, "set", lambda k, v, ttl=None, **kw: None)
    # ⛔ EVERY leg must be stubbed, including the FMP income statement added
    # 2026-09-12. These tests passed only because FMP_API_KEY happened to be
    # absent: with a real key in the environment that leg fills the year for
    # real, `len(by_q)` reaches 4, and the yfinance leg under test never runs —
    # the assertions then fail for a reason that has nothing to do with the gate.
    monkeypatch.setattr(ee, "_year_earnings_from_fmp_income", lambda p, y: [])
    return ee


def _row(q, year):
    return {"date": f"{year}-0{q}-15", "quarter": q, "year": year,
            "eps_actual": 1.0, "eps_estimate": 0.9, "eps_surprise_pct": 11.1,
            "revenue_actual": 5.0e9, "revenue_estimate": 4.8e9, "revenue_surprise_pct": 4.2}


def _wire(monkeypatch, ee, *, fmp, fh, yf_calls, yf_rows=()):
    monkeypatch.setattr(ee, "_year_earnings_from_fmp", lambda p, y: list(fmp))
    monkeypatch.setattr(ee, "_year_earnings_from_stock", lambda p, y: list(fh))

    def _yf(prov, year):
        yf_calls.append((prov, year))
        return list(yf_rows)

    monkeypatch.setattr(ee, "_year_earnings_from_yf", _yf)


def _current_year(ee):
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).year


# ── the defect ────────────────────────────────────────────────────────────────
def test_a_plain_us_ticker_reaches_yfinance_when_the_others_are_short(monkeypatch):
    ee = _mod(monkeypatch)
    year = _current_year(ee)
    calls = []
    # Exactly the MMC state: FMP has nothing for the year, Finnhub has nothing.
    _wire(monkeypatch, ee, fmp=[], fh=[], yf_calls=calls, yf_rows=[_row(1, year)])
    ee.get_year_earnings("MMC", year)
    assert calls == [("MMC", year)], f"yfinance leg never ran for a plain US ticker: {calls}"


def test_the_recovered_quarter_actually_lands_in_the_result(monkeypatch):
    ee = _mod(monkeypatch)
    year = _current_year(ee)
    _wire(monkeypatch, ee, fmp=[], fh=[], yf_calls=[], yf_rows=[_row(2, year)])
    rows = ee.get_year_earnings("MMC", year)
    reported = [r for r in rows if r.get("eps_actual") is not None]
    assert [r["quarter"] for r in reported] == [2]


def test_the_previous_year_still_counts_as_recent(monkeypatch):
    # A Q4 reported in January belongs to the previous fiscal year and is very
    # much still on screen, so the window cannot be the current year alone.
    ee = _mod(monkeypatch)
    year = _current_year(ee) - 1
    calls = []
    _wire(monkeypatch, ee, fmp=[], fh=[], yf_calls=calls, yf_rows=[])
    ee.get_year_earnings("BK", year)
    assert calls == [("BK", year)]


# ── the cost bound the old gate was protecting ────────────────────────────────
def test_an_old_year_does_not_fire_a_yfinance_call_for_a_us_ticker(monkeypatch):
    ee = _mod(monkeypatch)
    calls = []
    _wire(monkeypatch, ee, fmp=[], fh=[], yf_calls=calls, yf_rows=[])
    ee.get_year_earnings("HOLX", 2014)
    assert calls == [], f"a decade-old gap fired a slow provider call: {calls}"


def test_a_complete_year_never_reaches_yfinance(monkeypatch):
    ee = _mod(monkeypatch)
    year = _current_year(ee)
    calls = []
    _wire(monkeypatch, ee,
          fmp=[_row(q, year) for q in (1, 2, 3, 4)], fh=[], yf_calls=calls)
    ee.get_year_earnings("AAPL", year)
    assert calls == [], "yfinance ran even though FMP returned all four quarters"


# ── the behaviour the old gate DID get right, kept ────────────────────────────
def test_a_foreign_shaped_symbol_still_reaches_yfinance_in_an_old_year(monkeypatch):
    # Yahoo is the only source for Korea/Japan listings at any age — the
    # symbol-shape test was correct for that case and must survive.
    ee = _mod(monkeypatch)
    calls = []
    _wire(monkeypatch, ee, fmp=[], fh=[], yf_calls=calls, yf_rows=[])
    ee.get_year_earnings("005930.KS", 2014)
    assert ("005930.KS", 2014) in calls
