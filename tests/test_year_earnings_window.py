"""Model Book year-earnings: the report-history window must scale to how far
back the book year is, or older years drop their early quarters (the 2016
'only Q3/Q4' bug — limit=40 reached only late-2016 reports when viewed years
later, cutting off Q1/Q2)."""
from api.services import earnings_estimates as ee


def test_av_earnings_leg_removed():
    """Locks in the 2026-08-05 removal (data-dependability migration plan,
    Phase 3 Task 12) -- AlphaVantage's EARNINGS leg is gone, along with its
    inability to tell a rate-limit from a genuine no-data year."""
    assert not hasattr(ee, "_year_earnings_from_av")
    assert not hasattr(ee, "_av_num")


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
    # Q2. Result: FMP's revenue kept on Q1, Q2 gap-filled EPS-only, Q3/Q4 stay
    # genuine placeholders — AlphaVantage's EARNINGS leg (which used to fill
    # deep gaps like this for old ADR years) was removed 2026-08-05 (data-
    # dependability migration plan, Phase 3 Task 12): its free tier is 25
    # requests/day, already exhausted on every observation, and it could not
    # tell a rate-limit from "this stock never reported" (same `[]` either
    # way). A genuinely-unfilled quarter must render as an honest "—"
    # placeholder, never a fabricated/guessed row.
    fmp_q1 = {"date": "2013-05-15", "quarter": 1, "year": 2013,
              "eps_actual": -5.06, "eps_estimate": -1.3, "eps_surprise_pct": -286.0,
              "revenue_actual": 187.26e6, "revenue_estimate": 29.7e6,
              "revenue_surprise_pct": 529.0}
    monkeypatch.setattr(ee, "_year_earnings_from_fmp", lambda t, y: [fmp_q1])
    monkeypatch.setattr(ee, "_year_earnings_from_stock", lambda t, y: [_eps_row(2, 2013, 1.0)])

    rows = ee.get_year_earnings("ZZJKS", 2013)
    assert [r["quarter"] for r in rows] == [1, 2, 3, 4]   # all 4 slots always present
    q1 = next(r for r in rows if r["quarter"] == 1)
    assert q1["revenue_actual"] == 187.26e6  # FMP's revenue preserved
    # Gap-filled quarter is EPS-only (no revenue available from Finnhub).
    assert next(r for r in rows if r["quarter"] == 2)["revenue_actual"] is None
    assert next(r for r in rows if r["quarter"] == 2)["eps_actual"] == 1.0
    # Q3/Q4 have no source at all now — genuine placeholders, not fabricated.
    q4 = next(r for r in rows if r["quarter"] == 4)
    assert q4["eps_actual"] is None
    assert q4["date"] is None


def test_get_year_earnings_fresh_caps_incomplete_year_ttl(monkeypatch):
    # During an earnings window, a fresh=True read of an INCOMPLETE (in-progress)
    # year must cache with the short fast-path TTL so a just-reported quarter
    # flips in ~15 min — not the 6h slow TTL that otherwise pins the inner cache.
    captured = {}
    monkeypatch.setattr(ee.cache, "get", lambda k: None)
    monkeypatch.setattr(ee.cache, "set", lambda k, v, ttl=None: captured.__setitem__("ttl", ttl))
    monkeypatch.setattr(ee, "_year_earnings_from_fmp", lambda t, y: [
        {"date": "2026-05-01", "quarter": 1, "year": y, "eps_actual": 1.0,
         "eps_estimate": 0.9, "eps_surprise_pct": 11.0, "revenue_actual": 1e9,
         "revenue_estimate": 0.9e9, "revenue_surprise_pct": 11.0}])
    monkeypatch.setattr(ee, "_year_earnings_from_stock", lambda t, y: [])
    from datetime import datetime, timezone
    cur_y = datetime.now(timezone.utc).year
    ee.get_year_earnings("ZZFRESH", cur_y, fresh=True)
    assert captured["ttl"] == ee._FRESH_TTL
    ee.get_year_earnings("ZZFRESH2", cur_y, fresh=False)
    assert captured["ttl"] == ee._CACHE_TTL   # unchanged when not in a window


def test_fiscal_q_from_period_end():
    # Same calendar scheme _fiscal_q_from_report uses (report ≈ period-end +1mo),
    # so estimates keyed by period end share ONE numbering with report-dated actuals.
    assert ee._fiscal_q_from_period_end("2026-03-31") == (1, 2026)
    assert ee._fiscal_q_from_period_end("2026-06-30") == (2, 2026)
    assert ee._fiscal_q_from_period_end("2026-09-30") == (3, 2026)
    assert ee._fiscal_q_from_period_end("2026-12-31") == (4, 2026)
    # Offset fiscal quarters ending Jan/Feb belong to the prior label year's Q4
    # (NVDA/WMT Jan-end report in Feb-Mar).
    assert ee._fiscal_q_from_period_end("2026-01-25") == (4, 2025)
    assert ee._fiscal_q_from_period_end("2026-02-28") == (4, 2025)
    assert ee._fiscal_q_from_period_end("garbage") == (None, None)


def test_finnhub_gapfill_uses_calendar_slot_not_finnhub_fiscal(monkeypatch):
    # AAPL-shape offset filer: FMP fills calendar Q1/Q2/Q4 but MISSES the Sep
    # quarter (calendar Q3). Finnhub returns the Sep-2025 period, which Finnhub
    # labels with its TRUE fiscal numbering (quarter=4, year=2025). The gap-fill
    # must re-derive the calendar slot from the period END → land in Q3 2025,
    # NOT trust Finnhub's raw quarter=4 (which would duplicate/overwrite Q4 and
    # drop the Sep quarter).
    fmp_mapped = [
        {"date": "2025-05-01", "quarter": 1, "year": 2025, "eps_actual": 1.5,
         "eps_estimate": 1.4, "eps_surprise_pct": 7.0, "revenue_actual": 90e9,
         "revenue_estimate": 89e9, "revenue_surprise_pct": 1.0},
        {"date": "2025-07-31", "quarter": 2, "year": 2025, "eps_actual": 1.6,
         "eps_estimate": 1.5, "eps_surprise_pct": 6.7, "revenue_actual": 85e9,
         "revenue_estimate": 84e9, "revenue_surprise_pct": 1.2},
        {"date": "2026-01-29", "quarter": 4, "year": 2025, "eps_actual": 2.4,
         "eps_estimate": 2.3, "eps_surprise_pct": 4.3, "revenue_actual": 124e9,
         "revenue_estimate": 123e9, "revenue_surprise_pct": 0.8},
    ]
    monkeypatch.setattr(ee, "_year_earnings_from_fmp", lambda t, y: list(fmp_mapped))
    finnhub_raw = [{"period": "2025-09-27", "year": 2025, "quarter": 4,
                    "actual": 1.85, "estimate": 1.80, "surprisePercent": 2.8}]
    monkeypatch.setattr(ee, "_fh_get", lambda path, params, timeout=None: finnhub_raw)

    rows = ee.get_year_earnings("ZZAAPL", 2025)
    by_q = {r["quarter"]: r for r in rows}
    assert by_q[3]["eps_actual"] == 1.85     # Sep quarter → calendar Q3 slot
    assert by_q[2]["eps_actual"] == 1.6      # Jun (FMP) not overwritten
    assert by_q[4]["eps_actual"] == 2.4      # Dec (FMP) not overwritten by Sep
    assert [r["quarter"] for r in rows] == [1, 2, 3, 4]


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

    rows = ee.get_year_earnings("ZZCOMPLETE", 2013)
    assert [r["quarter"] for r in rows] == [1, 2, 3, 4]
    assert all(r["revenue_actual"] is not None for r in rows)
