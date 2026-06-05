"""Model Book year-earnings: the report-history window must scale to how far
back the book year is, or older years drop their early quarters (the 2016
'only Q3/Q4' bug — limit=40 reached only late-2016 reports when viewed years
later, cutting off Q1/Q2)."""
from api.services import earnings_estimates as ee


def test_history_limit_scales_with_age():
    # An older book year must pull MORE history than a recent one.
    assert ee._history_limit(2016) > ee._history_limit(2024)
    # And enough to reach all four quarters of a decade-old year: a quarter is
    # ~4 reports/yr, plus a year for Q4 landing in year+1, plus dedup headroom.
    assert ee._history_limit(2016) >= 48
    # Bounded so it never balloons.
    assert ee._history_limit(1900) <= 400


def _fmp_row(date, eps_a, eps_e, rev_a, rev_e):
    return {"date": date, "epsActual": eps_a, "epsEstimated": eps_e,
            "revenueActual": rev_a, "revenueEstimated": rev_e}


def test_all_four_quarters_returned_for_old_year(monkeypatch):
    # Reports spanning Apr-2016 → Feb-2017 map to fiscal Q1-Q4 of 2016. Q1/Q2 are
    # the OLDEST reports — they used to fall outside the fixed window.
    fmp_rows = [
        _fmp_row("2016-02-01", 0.10, 0.12, 500e6, 510e6),   # → Q4 2015 (excluded)
        _fmp_row("2016-04-28", -0.02, -0.05, 553.3e6, 560e6),  # → Q1 2016
        _fmp_row("2016-07-21", 0.11, 0.08, 600e6, 590e6),   # → Q2 2016
        _fmp_row("2016-10-25", 0.34, 0.23, 754e6, 700e6),   # → Q3 2016
        _fmp_row("2017-02-10", 0.41, 0.39, 800e6, 790e6),   # → Q4 2016
    ]

    def fake_fmp(path, params, timeout=10):
        assert path == "/stable/earnings"
        return fmp_rows

    monkeypatch.setattr(ee, "_fmp_get", fake_fmp)
    rows = ee.get_year_earnings("ZZTESTCLF", 2016)

    quarters = [r["quarter"] for r in rows]
    assert quarters == [1, 2, 3, 4]  # all four, sorted Q1→Q4 — no Q4-2015 bleed-in
    assert all(r["year"] == 2016 for r in rows)
    # Revenue + surprise carried through (FMP path, not the EPS-only fallback).
    q3 = next(r for r in rows if r["quarter"] == 3)
    assert q3["revenue_actual"] == 754e6
    assert q3["eps_surprise_pct"] is not None


def _eps_row(quarter, year, eps_a):
    return {"date": f"{year}-0{quarter+1}-15", "quarter": quarter, "year": year,
            "eps_actual": eps_a, "eps_estimate": eps_a, "eps_surprise_pct": 0.0,
            "revenue_actual": None, "revenue_estimate": None, "revenue_surprise_pct": None}


def test_sources_merge_fills_missing_quarters(monkeypatch):
    # FMP has a GAP (only Q1, with revenue — the JKS 2013 symptom). Finnhub fills
    # Q2, AlphaVantage fills Q3+Q4. Result must be all four, FMP's revenue kept.
    fmp_q1 = {"date": "2013-05-15", "quarter": 1, "year": 2013,
              "eps_actual": -5.06, "eps_estimate": -1.3, "eps_surprise_pct": -286.0,
              "revenue_actual": 187.26e6, "revenue_estimate": 29.7e6,
              "revenue_surprise_pct": 529.0}
    monkeypatch.setattr(ee, "_year_earnings_from_fmp", lambda t, y: [fmp_q1])
    monkeypatch.setattr(ee, "_year_earnings_from_stock", lambda t, y: [_eps_row(2, 2013, 1.0)])
    monkeypatch.setattr(ee, "_year_earnings_from_av",
                        lambda t, y: [_eps_row(3, 2013, 4.45), _eps_row(4, 2013, 3.77)])

    rows = ee.get_year_earnings("ZZJKS", 2013)
    assert [r["quarter"] for r in rows] == [1, 2, 3, 4]
    q1 = next(r for r in rows if r["quarter"] == 1)
    assert q1["revenue_actual"] == 187.26e6  # FMP's revenue preserved
    # Gap-filled quarters are EPS-only (no revenue available from those sources).
    assert next(r for r in rows if r["quarter"] == 2)["revenue_actual"] is None
    assert next(r for r in rows if r["quarter"] == 4)["eps_actual"] == 3.77


def test_merge_stops_early_when_fmp_complete(monkeypatch):
    # When FMP already returns 4 quarters, the EPS-only fills must NOT run (no
    # wasted Finnhub/AV calls, and FMP revenue stays on every row).
    fmp_all = [{"date": f"2013-0{q}-15", "quarter": q, "year": 2013, "eps_actual": q,
                "eps_estimate": q, "eps_surprise_pct": 0.0, "revenue_actual": 100e6 * q,
                "revenue_estimate": 100e6 * q, "revenue_surprise_pct": 0.0}
               for q in (1, 2, 3, 4)]
    monkeypatch.setattr(ee, "_year_earnings_from_fmp", lambda t, y: fmp_all)

    def _boom(t, y):
        raise AssertionError("fill source must not be called when FMP is complete")
    monkeypatch.setattr(ee, "_year_earnings_from_stock", _boom)
    monkeypatch.setattr(ee, "_year_earnings_from_av", _boom)

    rows = ee.get_year_earnings("ZZCOMPLETE", 2013)
    assert [r["quarter"] for r in rows] == [1, 2, 3, 4]
    assert all(r["revenue_actual"] is not None for r in rows)
