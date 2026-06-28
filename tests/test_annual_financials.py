import importlib


def _mod(monkeypatch, tmp_path):
    monkeypatch.setenv("FUNDAMENTALS_ESTIMATES_DB_PATH", str(tmp_path / "est.db"))
    import api.services.fundamentals_estimates_store as s
    importlib.reload(s)
    import api.services.annual_financials as af
    importlib.reload(af)
    return af, s


def test_yoy_pct_and_estimate_rows(monkeypatch, tmp_path):
    af, _ = _mod(monkeypatch, tmp_path)
    # 2024 actual, 2025 actual, plus 2026e + 2027e estimates.
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {
        2024: {"eps": 2.00, "sales": 6.0e9},
        2025: {"eps": 2.50, "sales": 6.9e9},
    })
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {})
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now: [
        {"year": 2026, "eps": 3.00, "sales": 7.8e9},
        {"year": 2027, "eps": 3.30, "sales": 8.6e9},
    ])
    rows = af.get_annual_financials("ZZTKR", years_back=6, now=1_782_000_000.0)
    years = [r["year"] for r in rows]
    assert years == [2024, 2025, 2026, 2027]
    r25 = next(r for r in rows if r["year"] == 2025)
    assert r25["eps_chg_pct"] == 25  # (2.50-2.00)/2.00 = +25%
    assert r25["estimate"] is False
    r26 = next(r for r in rows if r["year"] == 2026)
    assert r26["estimate"] is True
    assert r26["eps_chg_pct"] == 20  # (3.00-2.50)/2.50 = +20%


def test_fmp_falls_back_to_rollup(monkeypatch, tmp_path):
    af, _ = _mod(monkeypatch, tmp_path)
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {})
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {})
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {
        2024: {"eps": 1.0, "sales": 1.0e9},
        2025: {"eps": 1.2, "sales": 1.1e9},
    })
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now: [])
    rows = af.get_annual_financials("ZZROLL", now=1_782_000_000.0)
    assert [r["year"] for r in rows] == [2024, 2025]
    assert rows[0]["_source"] == "rollup"


def test_estimate_revision_marker(monkeypatch, tmp_path):
    af, s = _mod(monkeypatch, tmp_path)
    day = 86400.0
    base = 1_782_000_000.0
    # A 31-day-old snapshot at a LOWER estimate → current read should mark "up".
    s.record_snapshot("ZZREV", 2026, eps_est=2.80, sales_est=7.0e9, now=base - 31 * day)
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {2025: {"eps": 2.5, "sales": 6.9e9}})
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {})
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now: [{"year": 2026, "eps": 3.00, "sales": 7.8e9}])
    rows = af.get_annual_financials("ZZREV", now=base)
    r26 = next(r for r in rows if r["year"] == 2026)
    assert r26["eps_revision"] == "up"


def test_empty_returns_empty(monkeypatch, tmp_path):
    af, _ = _mod(monkeypatch, tmp_path)
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {})
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {})
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now: [])
    assert af.get_annual_financials("ZZNADA", now=1_782_000_000.0) == []


def test_contiguity_drops_orphan_year_and_gap(monkeypatch, tmp_path):
    # yfinance often returns a sparse far-back year (eps only, no sales) PLUS a
    # gap (e.g. AAPL: 2020 alone, 2021 missing, then 2022-2025). The table must
    # show only the longest contiguous run ending at the latest year — no orphan
    # 2020, no 2021 hole, and YoY computed only between adjacent years.
    af, _ = _mod(monkeypatch, tmp_path)
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {})
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {
        2020: {"eps": 3.7, "sales": None},   # orphan (gap at 2021)
        2022: {"eps": 6.11, "sales": 394e9},
        2023: {"eps": 6.13, "sales": 383e9},
        2024: {"eps": 6.08, "sales": 391e9},
        2025: {"eps": 7.46, "sales": 416e9},
    })
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now: [])
    rows = af.get_annual_financials("ZZGAP", now=1_782_000_000.0)
    years = [r["year"] for r in rows]
    assert years == [2022, 2023, 2024, 2025]   # 2020 orphan dropped, no 2021 hole
    # First row's YoY is None (no prior contiguous year), NOT a 2-year jump.
    assert rows[0]["eps_chg_pct"] is None
    # 2023 YoY is vs 2022 (adjacent), correct.
    assert rows[1]["eps_chg_pct"] == 0  # (6.13-6.11)/6.11 ≈ 0%


def test_non_december_fiscal_keeps_latest_actual_and_labels_forward_fiscally(monkeypatch, tmp_path):
    # NVDA-style (Jan fiscal year-end): the most-recent fiscal actual (2026) was
    # already reported, so it must stay an ACTUAL — not be dropped and replaced
    # by a calendar-mislabeled estimate. Forward estimates must be labeled
    # last_actual+1 / +2 (2027e, 2028e), NOT the calendar year (2026/2027).
    af, _ = _mod(monkeypatch, tmp_path)
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {})
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {
        2023: {"eps": 0.17, "sales": 27e9},
        2024: {"eps": 1.19, "sales": 60e9},
        2025: {"eps": 2.94, "sales": 130e9},
        2026: {"eps": 4.90, "sales": 200e9},   # latest fiscal actual (FY ended Jan 2026)
    })
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {})
    # Forward helper returns 0y, +1y values; provisional 'year' is ignored.
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now: [
        {"year": 2026, "eps": 8.96, "sales": 390e9},
        {"year": 2027, "eps": 12.73, "sales": 550e9},
    ])
    rows = af.get_annual_financials("ZZNVDA", now=1_782_000_000.0)  # now = mid-2026
    years = [(r["year"], r["estimate"]) for r in rows]
    assert years == [(2023, False), (2024, False), (2025, False),
                     (2026, False), (2027, True), (2028, True)]
    # The 2026 actual is the real $4.90, NOT the $8.96 estimate.
    r2026 = next(r for r in rows if r["year"] == 2026)
    assert r2026["eps"] == 4.90 and r2026["estimate"] is False
    # Forward estimate values map onto the fiscal forward years in order.
    r2027 = next(r for r in rows if r["year"] == 2027)
    assert r2027["eps"] == 8.96 and r2027["estimate"] is True
