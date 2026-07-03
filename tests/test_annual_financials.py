import importlib
import sys
import types


def _mod(monkeypatch, tmp_path):
    monkeypatch.setenv("FUNDAMENTALS_ESTIMATES_DB_PATH", str(tmp_path / "est.db"))
    import api.services.fundamentals_estimates_store as s
    importlib.reload(s)
    import api.services.annual_financials as af
    importlib.reload(af)
    return af, s


class _FakeSeries:
    def __init__(self, avg):
        self._avg = avg

    def get(self, k, default=None):
        return self._avg if k == "avg" else default


class _FakeDF:
    """Minimal stand-in for a yfinance estimate DataFrame: has .index and
    .loc[idx].get('avg')."""
    def __init__(self, avg, idxs):
        self.index = list(idxs)
        self.loc = {i: _FakeSeries(avg) for i in idxs}
        self.empty = False


def test_annual_forward_yf_nan_becomes_none(monkeypatch, tmp_path):
    # yfinance returns NaN in the '+1y'/'0y' 'avg' cell for thin names. A raw
    # float(NaN) sails through and poisons the JSON payload (Starlette
    # allow_nan=False → HTTP 500). The helper must normalize NaN → None, and a
    # row with no finite value contributes nothing.
    af, _ = _mod(monkeypatch, tmp_path)
    df = _FakeDF(float("nan"), ["0y", "+1y"])
    monkeypatch.setitem(sys.modules, "yfinance", types.SimpleNamespace(
        Ticker=lambda tk: types.SimpleNamespace(earnings_estimate=df, revenue_estimate=df)))
    monkeypatch.setattr(af.yf_util, "bounded_call", lambda fn, default, timeout=12.0: fn())
    out = af._forward_estimates_yf("ZZNAN", now=1_782_000_000.0)
    assert out == []   # both cells NaN → nothing emitted (no nan values)


def test_rollup_excludes_in_progress_year(monkeypatch, tmp_path):
    # When BOTH annual statement sources are empty, the last-resort quarter
    # rollup must NOT surface a partial CURRENT year as a full-year actual.
    from datetime import datetime, timezone
    af, _ = _mod(monkeypatch, tmp_path)
    now = 1_782_000_000.0
    cur_y = datetime.fromtimestamp(now, tz=timezone.utc).year  # 2026
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {})
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now, last_actual_year=None: [])

    def fake_rollup(ticker, years):
        # The rollup would return a partial for cur_y IF it were asked for it.
        out = {}
        for y in years:
            out[y] = {"eps": 1.0 if y == cur_y else 4.0, "sales": 1e9 if y == cur_y else 4e9}
        return out

    monkeypatch.setattr(af, "_annual_rollup_from_quarters", fake_rollup)
    rows = af.get_annual_financials("ZZROLL", years_back=8, now=now)
    years = [r["year"] for r in rows]
    assert cur_y not in years        # in-progress year not shown as a full-year actual
    assert (cur_y - 1) in years      # closed years still roll up


def test_annual_cur_year_uses_et_not_utc(monkeypatch, tmp_path):
    # cur_y drives which years' actuals/labels are computed; on Dec-31 evening ET
    # it must follow ET, not the already-rolled-over UTC year.
    af, _ = _mod(monkeypatch, tmp_path)
    import calendar, time
    now = calendar.timegm(time.strptime("2027-01-01 04:30", "%Y-%m-%d %H:%M"))  # 23:30 ET Dec 31 2026
    seen = {}
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {})
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now, last_actual_year=None: [])

    def fake_rollup(ticker, years):
        seen["years"] = list(years)
        return {}

    monkeypatch.setattr(af, "_annual_rollup_from_quarters", fake_rollup)
    af.get_annual_financials("ZZTZ", years_back=8, now=now)
    # ET year is 2026 → rollup window ends before 2026 (excludes in-progress);
    # newest requested year is 2025 (2026 is in-progress and excluded), NOT 2026/2027.
    assert max(seen["years"]) == 2025


def test_annual_yf_income_stmt_is_bounded(monkeypatch, tmp_path):
    # The yfinance annual income_stmt access MUST run under yf_util.bounded_call
    # (hard wall-clock timeout) so a hung Yahoo response can't pin a request
    # thread — the 2026-07-01 thread-exhaustion / 524 class.
    af, _ = _mod(monkeypatch, tmp_path)
    monkeypatch.setitem(sys.modules, "yfinance",
                        types.SimpleNamespace(Ticker=lambda tk: types.SimpleNamespace(income_stmt=None)))
    seen = {"n": 0}

    def spy(fn, default, timeout=12.0):
        seen["n"] += 1
        return fn()   # actually exercise the wrapped access

    monkeypatch.setattr(af.yf_util, "bounded_call", spy)
    out = af._annual_actuals_from_yf("ZZBND")
    assert seen["n"] >= 1        # yfinance access routed through the timeout guard
    assert out == {}             # income_stmt None → no rows


def test_annual_skips_yf_when_fmp_covers_recent_window(monkeypatch, tmp_path):
    # FMP already returned a deep, recent window → the (unbounded, rate-limited)
    # yfinance annual fetch is skipped entirely on the happy path.
    af, _ = _mod(monkeypatch, tmp_path)
    called = {"yf": 0}
    monkeypatch.setattr(af, "_annual_actuals_from_yf",
                        lambda t: called.__setitem__("yf", called["yf"] + 1) or {})
    fmp = {y: {"eps": 2.0, "sales": 6e9} for y in range(2019, 2027)}  # 2019..2026 contiguous, ends 2026
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: fmp)
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now, last_actual_year=None: [])
    af.get_annual_financials("ZZCOV", years_back=8, now=1_782_000_000.0)  # now ≈ mid-2026
    assert called["yf"] == 0


def test_annual_calls_yf_when_fmp_thin(monkeypatch, tmp_path):
    # FMP returned only a couple years (short of the window) → yfinance backstop
    # is still consulted to deepen/fill.
    af, _ = _mod(monkeypatch, tmp_path)
    called = {"yf": 0}
    monkeypatch.setattr(af, "_annual_actuals_from_yf",
                        lambda t: called.__setitem__("yf", called["yf"] + 1) or {})
    monkeypatch.setattr(af, "_annual_actuals_from_fmp",
                        lambda t: {2024: {"eps": 2.0, "sales": 6e9}, 2025: {"eps": 2.5, "sales": 6.9e9}})
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now, last_actual_year=None: [])
    af.get_annual_financials("ZZTHIN", years_back=8, now=1_782_000_000.0)
    assert called["yf"] == 1


def test_annual_calls_yf_when_fmp_deep_but_stale(monkeypatch, tmp_path):
    # FMP has years_back rows but the newest is old (lags the current window) →
    # yfinance IS consulted so a fresher recent year isn't missed.
    af, _ = _mod(monkeypatch, tmp_path)
    called = {"yf": 0}
    monkeypatch.setattr(af, "_annual_actuals_from_yf",
                        lambda t: called.__setitem__("yf", called["yf"] + 1) or {})
    fmp = {y: {"eps": 2.0, "sales": 6e9} for y in range(2015, 2023)}  # 2015..2022, ends 2022 (stale vs 2026)
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: fmp)
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now, last_actual_year=None: [])
    af.get_annual_financials("ZZSTALE", years_back=8, now=1_782_000_000.0)
    assert called["yf"] == 1


def test_yoy_pct_and_estimate_rows(monkeypatch, tmp_path):
    af, _ = _mod(monkeypatch, tmp_path)
    # 2024 actual, 2025 actual, plus 2026e + 2027e estimates.
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {
        2024: {"eps": 2.00, "sales": 6.0e9},
        2025: {"eps": 2.50, "sales": 6.9e9},
    })
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {})
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now, last_actual_year=None: [
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
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now, last_actual_year=None: [])
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
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now, last_actual_year=None: [{"year": 2026, "eps": 3.00, "sales": 7.8e9}])
    rows = af.get_annual_financials("ZZREV", now=base)
    r26 = next(r for r in rows if r["year"] == 2026)
    assert r26["eps_revision"] == "up"


def test_empty_returns_empty(monkeypatch, tmp_path):
    af, _ = _mod(monkeypatch, tmp_path)
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {})
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {})
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now, last_actual_year=None: [])
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
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now, last_actual_year=None: [])
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
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now, last_actual_year=None: [
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


def test_forward_estimates_fmp_parses_caps_and_filters(monkeypatch, tmp_path):
    # FMP analyst-estimates (annual): past rows dropped, future rows parsed from
    # epsAvg/revenueAvg, 0-revenue normalized to None, capped to _FWD_YEARS.
    af, _ = _mod(monkeypatch, tmp_path)
    monkeypatch.setenv("FUNDAMENTALS_FMP_ANALYST_ESTIMATES", "1")

    def fake_fmp(path, params, timeout=10):
        assert "analyst-estimates" in path and params.get("period") == "annual"
        return [
            {"date": "2025-09-30", "epsAvg": 6.0, "revenueAvg": 400e9},   # past → dropped
            {"date": "2026-09-30", "epsAvg": 7.0, "revenueAvg": 420e9},
            {"date": "2027-09-30", "epsAvg": 8.0, "revenueAvg": 450e9},
            {"date": "2028-09-30", "epsAvg": 9.0, "revenueAvg": 0},        # 0 rev → None
            {"date": "2029-09-30", "epsAvg": 10.0, "revenueAvg": 500e9},
            {"date": "2030-09-30", "epsAvg": 11.0, "revenueAvg": 540e9},   # 5th future → capped
        ]

    monkeypatch.setattr(af.ee, "_fmp_get", fake_fmp)
    out = af._forward_estimates_fmp("ZZF", now=1_782_000_000.0)  # now ≈ mid-2026
    assert len(out) == af._FWD_YEARS == 4          # capped
    # Earliest future first, carrying its authoritative fiscal year (period-end year).
    assert out[0] == {"fiscal_year": 2026, "eps": 7.0, "sales": 420e9}
    assert out[2]["sales"] is None                 # 0 revenue normalized
    assert [e["eps"] for e in out] == [7.0, 8.0, 9.0, 10.0]


def test_annual_fmp_keeps_ended_but_unreported_fiscal_year(monkeypatch, tmp_path):
    # Jan-Feb window bug (annual twin of the quarterly one): a calendar filer's
    # FY2026 ends Dec 31 but reports in Feb. The old `period_end < today` filter
    # dropped its estimate row, so FY2027's numbers rendered under the "2026e"
    # label. Estimate rows for fiscal years NEWER than the last reported actual
    # must be kept regardless of whether their period end has passed.
    af, _ = _mod(monkeypatch, tmp_path)
    monkeypatch.setenv("FUNDAMENTALS_FMP_ANALYST_ESTIMATES", "1")
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {
        2024: {"eps": 2.00, "sales": 6.0e9},
        2025: {"eps": 2.50, "sales": 6.9e9},
    })
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {})
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {})

    def fake_fmp(path, params, timeout=10):
        return [
            {"date": "2025-12-31", "epsAvg": 2.55, "revenueAvg": 7.0e9},   # FY reported → skip
            {"date": "2026-12-31", "epsAvg": 3.00, "revenueAvg": 7.8e9},   # ended, unreported → KEEP
            {"date": "2027-12-31", "epsAvg": 3.30, "revenueAvg": 8.6e9},
            {"date": "2028-12-31", "epsAvg": 3.60, "revenueAvg": 9.4e9},
            {"date": "2029-12-31", "epsAvg": 3.90, "revenueAvg": 10.2e9},
        ]

    monkeypatch.setattr(af.ee, "_fmp_get", fake_fmp)
    import calendar, time
    now = float(calendar.timegm(time.strptime("2027-01-15", "%Y-%m-%d")))
    rows = af.get_annual_financials("ZZJAN", years_back=6, now=now)
    est = [(r["year"], r["eps"]) for r in rows if r["estimate"]]
    # FY2026's own consensus stays on the 2026e row — values not shifted a year.
    assert est == [(2026, 3.00), (2027, 3.30), (2028, 3.60), (2029, 3.90)]


def test_forward_estimates_gated_off_by_default(monkeypatch, tmp_path):
    # Flag unset → FMP analyst-estimates path skipped (no HTTP), yfinance backstop.
    af, _ = _mod(monkeypatch, tmp_path)
    called = {"n": 0}
    monkeypatch.setattr(af.ee, "_fmp_get", lambda *a, **k: called.__setitem__("n", called["n"] + 1) or [])
    assert af._forward_estimates_fmp("ZZG", now=1_782_000_000.0) == []
    assert called["n"] == 0


def test_annual_table_four_forward_years_from_fmp(monkeypatch, tmp_path):
    # End-to-end: FMP analyst-estimates deepens the table to 4 forward fiscal
    # years (2026e–2029e off the 2025 last-actual), preferred over yfinance.
    af, _ = _mod(monkeypatch, tmp_path)
    monkeypatch.setenv("FUNDAMENTALS_FMP_ANALYST_ESTIMATES", "1")
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {
        2024: {"eps": 2.00, "sales": 6.0e9},
        2025: {"eps": 2.50, "sales": 6.9e9},
    })
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {})
    monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, y: {})

    def fake_fmp(path, params, timeout=10):
        return [
            {"date": "2026-12-31", "epsAvg": 3.00, "revenueAvg": 7.8e9},
            {"date": "2027-12-31", "epsAvg": 3.30, "revenueAvg": 8.6e9},
            {"date": "2028-12-31", "epsAvg": 3.60, "revenueAvg": 9.4e9},
            {"date": "2029-12-31", "epsAvg": 3.90, "revenueAvg": 10.2e9},
            {"date": "2030-12-31", "epsAvg": 4.20, "revenueAvg": 11.0e9},  # capped out
        ]

    monkeypatch.setattr(af.ee, "_fmp_get", fake_fmp)
    rows = af.get_annual_financials("ZZF", years_back=6, now=1_782_000_000.0)
    est = [(r["year"], r["eps"]) for r in rows if r["estimate"]]
    assert est == [(2026, 3.00), (2027, 3.30), (2028, 3.60), (2029, 3.90)]
