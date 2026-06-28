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


def test_get_earnings_table_shape(monkeypatch, tmp_path):
    et = _mod(monkeypatch, tmp_path)
    monkeypatch.setattr(et, "_build_quarterly", lambda t, now: [{"label": "2025 Q4", "reported": True}])
    monkeypatch.setattr(et, "get_annual_financials_fn", lambda t, now: [{"year": 2025, "estimate": False}])
    monkeypatch.setattr(et, "_choose_ttl", lambda t, now: 60)
    out = et.get_earnings_table("ZZTBL", now=1_760_000_000.0, debug=True)
    assert out["ticker"] == "ZZTBL"
    assert out["annual"] and out["quarterly"]
    assert "_sources" in out
