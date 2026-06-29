import importlib


def _mod(monkeypatch, tmp_path):
    monkeypatch.setenv("FUNDAMENTALS_ESTIMATES_DB_PATH", str(tmp_path / "est.db"))
    import api.services.earnings_table as et
    importlib.reload(et)
    return et


def test_in_window_pre_and_post(monkeypatch, tmp_path):
    et = _mod(monkeypatch, tmp_path)
    # base = 2026-08-05 00:00 UTC
    import calendar, time
    base = calendar.timegm(time.strptime("2026-08-05", "%Y-%m-%d"))
    assert et._in_earnings_window("2026-08-05", None, base) is True        # day-of
    assert et._in_earnings_window("2026-08-06", None, base) is True        # day before
    assert et._in_earnings_window("2026-09-20", None, base) is False       # far future
    assert et._in_earnings_window(None, "2026-08-04", base) is True        # day after report
    assert et._in_earnings_window(None, "2026-07-01", base) is False       # old report


def test_choose_ttl(monkeypatch, tmp_path):
    et = _mod(monkeypatch, tmp_path)
    import calendar, time
    base = calendar.timegm(time.strptime("2026-08-05", "%Y-%m-%d"))
    monkeypatch.setattr(et, "_next_earnings", lambda t: {"date": "2026-08-05", "eps_estimate": 0.58, "rev_estimate": 1.85e9})
    monkeypatch.setattr(et, "_last_report_date", lambda t: None)
    assert et._choose_ttl("ZZW", base) == et._FAST_TTL
    monkeypatch.setattr(et, "_next_earnings", lambda t: {"date": "2026-12-01", "eps_estimate": None, "rev_estimate": None})
    assert et._choose_ttl("ZZW", base) == et._SLOW_TTL


def test_build_quarterly_takes_last_five_plus_next(monkeypatch, tmp_path):
    et = _mod(monkeypatch, tmp_path)
    import api.services.earnings_table as etmod

    def fake_year(ticker, year):
        # Return 4 reported quarters per requested year.
        return [{"label": None, "quarter": q, "year": year, "date": f"{year}-0{q}-15",
                 "eps_actual": q + 0.0, "eps_estimate": q - 0.1, "eps_surprise_pct": 5.0,
                 "revenue_actual": 1e9 * q, "revenue_estimate": 0.9e9 * q, "revenue_surprise_pct": 4.0}
                for q in (1, 2, 3, 4)]

    monkeypatch.setattr(etmod.ee, "get_year_earnings", fake_year)
    # No FMP nor yfinance forward source → falls back to single Finnhub next-earnings.
    monkeypatch.setattr(etmod.ee, "_fmp_get", lambda *a, **k: None)
    monkeypatch.setattr(etmod, "_yf_forward_quarters", lambda t, limit: [])
    monkeypatch.setattr(etmod, "_next_earnings", lambda t: {"date": "2026-08-05", "eps_estimate": 0.58, "rev_estimate": 1.85e9})
    import calendar, time
    now = calendar.timegm(time.strptime("2026-07-01", "%Y-%m-%d"))
    q = et._build_quarterly("ZZQ", now)
    reported = [r for r in q if r["reported"]]
    nxt = [r for r in q if not r["reported"]]
    assert len(reported) == 5      # last 5 of the 8 returned
    assert len(nxt) == 1
    assert nxt[0]["report_date"] == "2026-08-05"
    assert reported[-1]["label"]   # labels are filled, e.g. "2026 Q2"
    # The next-earnings row's label must be the increment of the last reported
    # quarter (no duplicate label that collides with a reported one).
    labels = [r["label"] for r in reported]
    assert nxt[0]["label"] not in labels
    assert nxt[0]["label"] == "2027 Q1"   # last reported is 2026 Q4 -> roll to 2027 Q1


def test_build_quarterly_four_forward_from_fmp(monkeypatch, tmp_path):
    et = _mod(monkeypatch, tmp_path)
    import api.services.earnings_table as etmod

    def fake_year(ticker, year):
        return [{"label": None, "quarter": q, "year": year, "date": f"{year}-0{q}-15",
                 "eps_actual": q + 0.0, "eps_estimate": q - 0.1, "eps_surprise_pct": 5.0,
                 "revenue_actual": 1e9 * q, "revenue_estimate": 0.9e9 * q, "revenue_surprise_pct": 4.0}
                for q in (1, 2, 3, 4)]

    # FMP analyst-estimates: a couple of past quarters (filtered out) + 4 future.
    def fake_fmp(path, params, timeout=10):
        assert "analyst-estimates" in path
        return [
            {"date": "2026-03-31", "epsAvg": 0.50, "revenueAvg": 1.0e9},   # past → dropped
            {"date": "2026-09-30", "epsAvg": 0.60, "revenueAvg": 1.1e9},
            {"date": "2026-12-31", "epsAvg": 0.70, "revenueAvg": 1.2e9},
            {"date": "2027-03-31", "epsAvg": 0.80, "revenueAvg": 1.3e9},
            {"date": "2027-06-30", "epsAvg": 0.90, "revenueAvg": 1.4e9},
            {"date": "2027-09-30", "epsAvg": 1.00, "revenueAvg": 1.5e9},   # 5th → capped
        ]

    monkeypatch.setenv("FUNDAMENTALS_FMP_ANALYST_ESTIMATES", "1")  # opt into the FMP depth path
    monkeypatch.setattr(etmod.ee, "get_year_earnings", fake_year)
    monkeypatch.setattr(etmod.ee, "_fmp_get", fake_fmp)
    import calendar, time
    now = calendar.timegm(time.strptime("2026-08-05", "%Y-%m-%d"))
    q = et._build_quarterly("ZZF", now)
    nxt = [r for r in q if not r["reported"]]
    assert len(nxt) == 4                       # capped at _FWD_QUARTERS
    assert nxt[0]["eps_estimate"] == 0.60      # earliest future quarter first
    assert nxt[0]["rev_estimate"] == 1.1e9
    assert nxt[-1]["eps_estimate"] == 0.90     # past quarter excluded
    # Labels increment fiscally from the last reported (2026 Q4) with no dupes.
    labels = [r["label"] for r in q if r["reported"]]
    fwd_labels = [r["label"] for r in nxt]
    assert fwd_labels == ["2027 Q1", "2027 Q2", "2027 Q3", "2027 Q4"]
    assert not set(fwd_labels) & set(labels)


def test_forward_quarters_have_yoy_growth(monkeypatch, tmp_path):
    # Each forward ESTIMATE quarter should carry YoY growth % = estimate vs the
    # same fiscal quarter one year earlier (a reported actual).
    et = _mod(monkeypatch, tmp_path)
    import api.services.earnings_table as etmod

    def fake_year(ticker, year):
        # 2026 actuals: Q1 eps 1.0/rev 1e9, Q2 2.0/2e9, Q3 3.0/3e9, Q4 4.0/4e9.
        return [{"label": None, "quarter": q, "year": year, "date": f"{year}-0{q}-15",
                 "eps_actual": q + 0.0, "eps_estimate": q - 0.1, "eps_surprise_pct": 5.0,
                 "revenue_actual": 1e9 * q, "revenue_estimate": 0.9e9 * q, "revenue_surprise_pct": 4.0}
                for q in (1, 2, 3, 4)]

    def fake_fmp(path, params, timeout=10):
        return [
            {"date": "2026-09-30", "epsAvg": 0.60, "revenueAvg": 1.1e9},
            {"date": "2026-12-31", "epsAvg": 0.70, "revenueAvg": 1.2e9},
            {"date": "2027-03-31", "epsAvg": 0.80, "revenueAvg": 1.3e9},
            {"date": "2027-06-30", "epsAvg": 0.90, "revenueAvg": 1.4e9},
        ]

    monkeypatch.setenv("FUNDAMENTALS_FMP_ANALYST_ESTIMATES", "1")
    monkeypatch.setattr(etmod.ee, "get_year_earnings", fake_year)
    monkeypatch.setattr(etmod.ee, "_fmp_get", fake_fmp)
    import calendar, time
    now = calendar.timegm(time.strptime("2026-08-05", "%Y-%m-%d"))
    q = et._build_quarterly("ZZYOY", now)
    nxt = [r for r in q if not r["reported"]]
    assert [r["label"] for r in nxt] == ["2027 Q1", "2027 Q2", "2027 Q3", "2027 Q4"]
    # 2027 Q1 est 0.60 vs 2026 Q1 actual 1.0 → (0.60-1.0)/1.0 = -40.0%
    assert nxt[0]["eps_est_chg_pct"] == -40.0
    # rev 1.1e9 vs 1.0e9 → +10.0%
    assert nxt[0]["rev_est_chg_pct"] == 10.0
    # 2027 Q2 est 0.70 vs 2026 Q2 actual 2.0 → -65.0%
    assert nxt[1]["eps_est_chg_pct"] == -65.0


def test_build_quarterly_yfinance_fallback(monkeypatch, tmp_path):
    et = _mod(monkeypatch, tmp_path)
    import api.services.earnings_table as etmod

    def fake_year(ticker, year):
        return [{"label": None, "quarter": q, "year": year, "date": f"{year}-0{q}-15",
                 "eps_actual": q + 0.0, "eps_estimate": q - 0.1, "eps_surprise_pct": 5.0,
                 "revenue_actual": 1e9 * q, "revenue_estimate": 0.9e9 * q, "revenue_surprise_pct": 4.0}
                for q in (1, 2, 3, 4)]

    monkeypatch.setattr(etmod.ee, "get_year_earnings", fake_year)
    # FMP analyst-estimates gated off (default) → yfinance backstop supplies 2.
    monkeypatch.setattr(etmod, "_yf_forward_quarters",
                        lambda t, limit: [{"date": None, "eps_estimate": 0.60, "rev_estimate": 1.1e9},
                                          {"date": None, "eps_estimate": 0.70, "rev_estimate": 1.2e9}])
    # stable/earnings supplies the nearest quarter's real report date.
    monkeypatch.setattr(etmod, "_next_report_date", lambda t: "2026-08-01")
    import calendar, time
    now = calendar.timegm(time.strptime("2026-08-05", "%Y-%m-%d"))
    q = et._build_quarterly("ZZY", now)
    nxt = [r for r in q if not r["reported"]]
    assert len(nxt) == 2                                  # yfinance gives 2 near quarters
    assert [r["label"] for r in nxt] == ["2027 Q1", "2027 Q2"]
    assert nxt[0]["eps_estimate"] == 0.60
    assert nxt[0]["report_date"] == "2026-08-01"          # nearest quarter stamped with real date
    assert nxt[1]["report_date"] is None                  # only the nearest gets a date


def test_fmp_analyst_estimates_gated_off_by_default(monkeypatch, tmp_path):
    # With the env flag unset, the FMP analyst-estimates call is skipped entirely
    # (no wasted round-trip) even if the endpoint would return data.
    et = _mod(monkeypatch, tmp_path)
    import api.services.earnings_table as etmod
    called = {"n": 0}

    def fake_fmp(path, params, timeout=10):
        called["n"] += 1
        return [{"date": "2099-09-30", "epsAvg": 1.0, "revenueAvg": 1.0e9}]

    monkeypatch.setattr(etmod.ee, "_fmp_get", fake_fmp)
    assert etmod._fmp_forward_quarters("ZZG", 4) == []
    assert called["n"] == 0                                # no HTTP call made


def test_zero_revenue_estimate_normalized_to_missing(monkeypatch, tmp_path):
    # A $0 forward revenue estimate (Yahoo for some utilities) → None, so the
    # strip shows '—' not a misleading '$0'. EPS is kept.
    et = _mod(monkeypatch, tmp_path)
    import api.services.earnings_table as etmod

    def fake_fmp(path, params, timeout=10):
        return [{"date": "2099-09-30", "epsAvg": 0.76, "revenueAvg": 0}]

    monkeypatch.setenv("FUNDAMENTALS_FMP_ANALYST_ESTIMATES", "1")
    monkeypatch.setattr(etmod.ee, "_fmp_get", fake_fmp)
    rows = etmod._fmp_forward_quarters("ZZ0", 4)
    assert rows == [{"date": "2099-09-30", "eps_estimate": 0.76, "rev_estimate": None}]


def test_next_q_label_increment():
    import api.services.earnings_table as et
    assert et._next_q_label("2026 Q3") == "2026 Q4"
    assert et._next_q_label("2026 Q4") == "2027 Q1"
    assert et._next_q_label("2025 Q1") == "2025 Q2"
    assert et._next_q_label(None) is None
    assert et._next_q_label("garbage") is None


def test_get_earnings_table_shape(monkeypatch, tmp_path):
    et = _mod(monkeypatch, tmp_path)
    monkeypatch.setattr(et, "_build_quarterly", lambda t, now: [{"label": "2025 Q4", "reported": True}])
    monkeypatch.setattr(et, "get_annual_financials_fn", lambda t, now: [{"year": 2025, "estimate": False}])
    monkeypatch.setattr(et, "_choose_ttl", lambda t, now: 60)
    out = et.get_earnings_table("ZZTBL", now=1_760_000_000.0, debug=True)
    assert out["ticker"] == "ZZTBL"
    assert out["annual"] and out["quarterly"]
    assert "_sources" in out
