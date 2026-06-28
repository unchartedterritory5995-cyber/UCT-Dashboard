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
