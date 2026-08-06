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

    def fake_year(ticker, year, fresh=False):
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


def _realistic_year(eps_by_q):
    """fake get_year_earnings: {year: {q: (eps, rev)}} → reported rows."""
    def fake_year(ticker, year, fresh=False):
        return [{"label": None, "quarter": q, "year": year, "date": None,
                 "eps_actual": eps, "eps_estimate": eps, "eps_surprise_pct": 0.0,
                 "revenue_actual": rev, "revenue_estimate": rev, "revenue_surprise_pct": 0.0}
                for q, (eps, rev) in eps_by_q.get(year, {}).items()]
    return fake_year


def test_label_from_period_end():
    import api.services.earnings_table as et
    # Calendar filers: period-end quarter boundaries map straight through.
    assert et._label_from_period_end("2026-06-30") == "2026 Q2"
    assert et._label_from_period_end("2026-09-30") == "2026 Q3"
    assert et._label_from_period_end("2026-12-31") == "2026 Q4"
    assert et._label_from_period_end("2027-03-31") == "2027 Q1"
    # Non-calendar filers, consistent with _fiscal_q_from_report's report-month
    # scheme (report ≈ period end + 1 month): NVDA Jan-end → Q4 of prior label
    # year; AAPL Sep-end → Q3; NKE May-end → Q1.
    assert et._label_from_period_end("2026-01-25") == "2025 Q4"
    assert et._label_from_period_end("2025-09-27") == "2025 Q3"
    assert et._label_from_period_end("2026-05-31") == "2026 Q1"
    assert et._label_from_period_end(None) is None
    assert et._label_from_period_end("garbage") is None


def test_forward_includes_ended_but_unreported_quarter(monkeypatch, tmp_path):
    # THE 2026-07-02 MXL bug: two days after the Jun-30 quarter END (weeks
    # before its REPORT), the old `period_end < today` filter dropped the
    # Jun-quarter estimate row and the blind-sequential labels pinned the
    # Sep-quarter numbers under the "2026 Q2" label — all four forward cards
    # shifted one quarter, and every YoY % compared the wrong quarters.
    et = _mod(monkeypatch, tmp_path)
    import api.services.earnings_table as etmod

    fake_year = _realistic_year({
        2025: {1: (0.10, 1.0e8), 2: (0.20, 1.2e8), 3: (0.30, 1.4e8), 4: (0.40, 1.6e8)},
        2026: {1: (0.22, 1.37e8)},          # only Q1 reported as of early July
    })

    def fake_fmp(path, params, timeout=10):
        if "analyst-estimates" in path:
            return [
                {"date": "2026-03-31", "epsAvg": 0.18, "revenueAvg": 1.35e8},  # reported → skip
                {"date": "2026-06-30", "epsAvg": 0.30, "revenueAvg": 1.60e8},  # ended, unreported → KEEP
                {"date": "2026-09-30", "epsAvg": 0.38, "revenueAvg": 1.74e8},
                {"date": "2026-12-31", "epsAvg": 0.41, "revenueAvg": 1.81e8},
                {"date": "2027-03-31", "epsAvg": 0.38, "revenueAvg": 1.78e8},
                {"date": "2027-06-30", "epsAvg": 0.44, "revenueAvg": 1.92e8},
            ]
        if "stable/earnings" in path:   # the next scheduled report
            return [{"date": "2026-07-28", "epsActual": None, "revenueActual": None}]
        return None

    monkeypatch.setenv("FUNDAMENTALS_FMP_ANALYST_ESTIMATES", "1")
    monkeypatch.setattr(etmod.ee, "get_year_earnings", fake_year)
    monkeypatch.setattr(etmod.ee, "_fmp_get", fake_fmp)
    import calendar, time
    now = calendar.timegm(time.strptime("2026-07-02", "%Y-%m-%d"))
    q = et._build_quarterly("ZZMXL", now)
    fwd = [r for r in q if not r["reported"]]
    assert [r["label"] for r in fwd] == ["2026 Q2", "2026 Q3", "2026 Q4", "2027 Q1"]
    assert fwd[0]["eps_estimate"] == 0.30           # the JUN-quarter consensus, not Sep's
    assert fwd[0]["period_end"] == "2026-06-30"
    assert fwd[0]["report_date"] == "2026-07-28"    # real scheduled report date
    assert fwd[1]["eps_estimate"] == 0.38
    assert fwd[1]["period_end"] == "2026-09-30"
    assert fwd[1]["report_date"] is None
    # YoY vs the CORRECT year-ago quarter: Q2 est 0.30 vs 2025 Q2 actual 0.20 → +50%
    assert fwd[0]["eps_est_chg_pct"] == 50.0


def test_build_quarterly_four_forward_from_fmp(monkeypatch, tmp_path):
    et = _mod(monkeypatch, tmp_path)
    import api.services.earnings_table as etmod

    # Realistic mid-August state: 2025 fully reported, 2026 through Q2.
    fake_year = _realistic_year({
        2025: {1: (1.0, 1e9), 2: (2.0, 2e9), 3: (3.0, 3e9), 4: (4.0, 4e9)},
        2026: {1: (5.0, 5e9), 2: (5.5, 5.5e9)},
    })

    # FMP analyst-estimates: reported periods (skipped) + 5 unreported (capped to 4).
    def fake_fmp(path, params, timeout=10):
        if "analyst-estimates" not in path:
            return None
        return [
            {"date": "2026-03-31", "epsAvg": 0.50, "revenueAvg": 1.0e9},   # reported → skip
            {"date": "2026-06-30", "epsAvg": 0.55, "revenueAvg": 1.05e9},  # reported → skip
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
    assert nxt[0]["eps_estimate"] == 0.60      # earliest unreported quarter first
    assert nxt[0]["rev_estimate"] == 1.1e9
    assert nxt[-1]["eps_estimate"] == 0.90     # reported periods excluded, 5th capped
    # Labels derive from each estimate row's fiscal period — no dupes vs reported.
    labels = [r["label"] for r in q if r["reported"]]
    fwd_labels = [r["label"] for r in nxt]
    assert fwd_labels == ["2026 Q3", "2026 Q4", "2027 Q1", "2027 Q2"]
    assert not set(fwd_labels) & set(labels)


def test_forward_quarters_have_yoy_growth(monkeypatch, tmp_path):
    # Each forward ESTIMATE quarter should carry YoY growth % = estimate vs the
    # same fiscal quarter one year earlier (a reported actual).
    et = _mod(monkeypatch, tmp_path)
    import api.services.earnings_table as etmod

    # 2025 fully reported (eps=q, rev=q·1e9); 2026 through Q2.
    fake_year = _realistic_year({
        2025: {1: (1.0, 1e9), 2: (2.0, 2e9), 3: (3.0, 3e9), 4: (4.0, 4e9)},
        2026: {1: (5.0, 5e9), 2: (5.5, 5.5e9)},
    })

    def fake_fmp(path, params, timeout=10):
        if "analyst-estimates" not in path:
            return None
        return [
            {"date": "2026-09-30", "epsAvg": 6.00, "revenueAvg": 4.5e9},
            {"date": "2026-12-31", "epsAvg": 6.00, "revenueAvg": 6.0e9},
            {"date": "2027-03-31", "epsAvg": 7.50, "revenueAvg": 7.5e9},
            {"date": "2027-06-30", "epsAvg": 11.0, "revenueAvg": 8.25e9},
        ]

    monkeypatch.setenv("FUNDAMENTALS_FMP_ANALYST_ESTIMATES", "1")
    monkeypatch.setattr(etmod.ee, "get_year_earnings", fake_year)
    monkeypatch.setattr(etmod.ee, "_fmp_get", fake_fmp)
    import calendar, time
    now = calendar.timegm(time.strptime("2026-08-05", "%Y-%m-%d"))
    q = et._build_quarterly("ZZYOY", now)
    nxt = [r for r in q if not r["reported"]]
    assert [r["label"] for r in nxt] == ["2026 Q3", "2026 Q4", "2027 Q1", "2027 Q2"]
    # 2026 Q3 est 6.0 vs 2025 Q3 actual 3.0 → +100%; rev 4.5e9 vs 3e9 → +50%
    assert nxt[0]["eps_est_chg_pct"] == 100.0
    assert nxt[0]["rev_est_chg_pct"] == 50.0
    # 2026 Q4 est 6.0 vs 2025 Q4 actual 4.0 → +50%
    assert nxt[1]["eps_est_chg_pct"] == 50.0
    # 2027 Q1 est 7.5 vs 2026 Q1 actual 5.0 → +50%
    assert nxt[2]["eps_est_chg_pct"] == 50.0


def test_build_quarterly_yfinance_fallback(monkeypatch, tmp_path):
    et = _mod(monkeypatch, tmp_path)
    import api.services.earnings_table as etmod

    def fake_year(ticker, year, fresh=False):
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
    monkeypatch.setattr(etmod, "_next_report_date", lambda t, now=None: "2026-08-01")
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
    assert rows == [{"period_end": "2099-09-30", "label": "2099 Q3",
                     "eps_estimate": 0.76, "rev_estimate": None}]


class _FakeSeries:
    def __init__(self, avg):
        self._avg = avg

    def get(self, k, default=None):
        return self._avg if k == "avg" else default


class _FakeDF:
    def __init__(self, avg, idxs):
        self.index = list(idxs)
        self.loc = {i: _FakeSeries(avg) for i in idxs}
        self.empty = False


def test_yf_forward_quarters_nan_becomes_none(monkeypatch, tmp_path):
    # A NaN 'avg' from yfinance must normalize to None (not a nan value that
    # would 500 the JSON render), so a fully-NaN row is dropped.
    et = _mod(monkeypatch, tmp_path)
    import sys, types
    df = _FakeDF(float("nan"), ["0q", "+1q"])
    monkeypatch.setitem(sys.modules, "yfinance", types.SimpleNamespace(
        Ticker=lambda tk: types.SimpleNamespace(earnings_estimate=df, revenue_estimate=df)))
    monkeypatch.setattr(et.yf_util, "bounded_call", lambda fn, default, timeout=12.0: fn())
    assert et._yf_forward_quarters("ZZNAN", 2) == []


def test_get_earnings_table_result_is_json_safe(monkeypatch, tmp_path):
    # Belt-and-suspenders: even if a source sneaks a NaN/inf through, the final
    # payload must be renderable by Starlette (json.dumps allow_nan=False).
    et = _mod(monkeypatch, tmp_path)
    import json
    nan = float("nan")
    monkeypatch.setattr(et, "get_annual_financials_fn",
                        lambda t, now: [{"year": 2026, "eps": nan, "sales": nan, "estimate": True}])
    monkeypatch.setattr(et, "_build_quarterly",
                        lambda t, now, fresh=False: [{"label": "2026 Q2", "eps_estimate": nan, "reported": False}])
    monkeypatch.setattr(et, "_choose_ttl", lambda t, now: 60)
    out = et.get_earnings_table("ZZSAN", now=1_760_000_000.0)
    json.dumps(out, allow_nan=False)                 # must not raise
    assert out["annual"][0]["eps"] is None
    assert out["quarterly"][0]["eps_estimate"] is None


def test_yf_forward_quarters_is_bounded(monkeypatch, tmp_path):
    # yfinance earnings_estimate/revenue_estimate access must run under
    # yf_util.bounded_call so a hung Yahoo can't pin a request thread.
    et = _mod(monkeypatch, tmp_path)
    import sys, types
    monkeypatch.setitem(sys.modules, "yfinance",
                        types.SimpleNamespace(Ticker=lambda tk: types.SimpleNamespace(
                            earnings_estimate=None, revenue_estimate=None)))
    seen = {"n": 0}

    def spy(fn, default, timeout=12.0):
        seen["n"] += 1
        return fn()

    monkeypatch.setattr(et.yf_util, "bounded_call", spy)
    out = et._yf_forward_quarters("ZZYFB", 2)
    assert seen["n"] >= 1       # yfinance access routed through the timeout guard
    assert out == []            # both estimate frames None → nothing


def test_next_q_label_increment():
    import api.services.earnings_table as et
    assert et._next_q_label("2026 Q3") == "2026 Q4"
    assert et._next_q_label("2026 Q4") == "2027 Q1"
    assert et._next_q_label("2025 Q1") == "2025 Q2"
    assert et._next_q_label(None) is None
    assert et._next_q_label("garbage") is None


def test_empty_composite_not_cached_long(monkeypatch, tmp_path):
    # A transient total outage yields empty annual+quarterly. That must NOT be
    # cached for the full 6h slow TTL (which would blank the widget for 6h even
    # after the sources recover seconds later) — cap it to a short retry window.
    et = _mod(monkeypatch, tmp_path)
    captured = {}
    monkeypatch.setattr(et, "get_annual_financials_fn", lambda t, now: [])
    monkeypatch.setattr(et, "_build_quarterly", lambda t, now, fresh=False: [])
    monkeypatch.setattr(et, "_is_fresh_window", lambda t, now: False)
    monkeypatch.setattr(et.cache, "get", lambda k: None)
    monkeypatch.setattr(et.cache, "set", lambda k, v, ttl=None: captured.__setitem__("ttl", ttl))
    out = et.get_earnings_table("ZZEMPTY", now=1_760_000_000.0)
    assert out["annual"] == [] and out["quarterly"] == []
    assert et._EMPTY_TTL < et._SLOW_TTL
    assert captured["ttl"] == et._EMPTY_TTL


def test_build_quarterly_cur_year_uses_et_not_utc(monkeypatch, tmp_path):
    # On Dec-31 evening ET the UTC year is already +1; cur_y must follow ET so
    # the strip fetches (this year, last year), not (next year, this year) —
    # otherwise the just-closing year's Q4 is dropped and forward YoY blanks.
    et = _mod(monkeypatch, tmp_path)
    import api.services.earnings_table as etmod
    seen = []
    monkeypatch.setattr(etmod.ee, "get_year_earnings", lambda t, y, fresh=False: seen.append(y) or [])
    monkeypatch.setattr(etmod, "_forward_quarters", lambda t, limit, reported_labels=frozenset(), now=None: [])
    import calendar, time
    now = calendar.timegm(time.strptime("2027-01-01 04:30", "%Y-%m-%d %H:%M"))  # 23:30 ET Dec 31 2026
    et._build_quarterly("ZZTZ", now)
    assert set(seen) == {2025, 2026}   # ET year 2026 → fetch 2025 & 2026, NOT 2027


def test_build_quarterly_threads_fresh_to_year_earnings(monkeypatch, tmp_path):
    # During an earnings window get_earnings_table sets fresh=True; _build_quarterly
    # must thread it to the get_year_earnings fetches so the inner cache freshens.
    et = _mod(monkeypatch, tmp_path)
    import api.services.earnings_table as etmod
    seen = []

    def spy(ticker, year, fresh=False):
        seen.append(fresh)
        return []

    monkeypatch.setattr(etmod.ee, "get_year_earnings", spy)
    monkeypatch.setattr(etmod, "_forward_quarters", lambda t, limit, reported_labels=frozenset(), now=None: [])
    import calendar, time
    now = calendar.timegm(time.strptime("2026-08-05", "%Y-%m-%d"))
    et._build_quarterly("ZZFR", now, fresh=True)
    assert seen and all(f is True for f in seen)   # every year fetch carried fresh


def test_get_earnings_table_shape(monkeypatch, tmp_path):
    et = _mod(monkeypatch, tmp_path)
    monkeypatch.setattr(et, "_build_quarterly", lambda t, now, fresh=False: [{"label": "2025 Q4", "reported": True}])
    monkeypatch.setattr(et, "get_annual_financials_fn", lambda t, now: [{"year": 2025, "estimate": False}])
    monkeypatch.setattr(et, "_is_fresh_window", lambda t, now: False)
    out = et.get_earnings_table("ZZTBL", now=1_760_000_000.0, debug=True)
    assert out["ticker"] == "ZZTBL"
    assert out["annual"] and out["quarterly"]
    assert "_sources" in out


def _ttl_for(monkeypatch, tmp_path, annual, quarterly):
    """Run _build_and_cache with a stubbed _build and report the TTL it cached with."""
    et = _mod(monkeypatch, tmp_path)
    seen = {}
    monkeypatch.setattr(et, "_build",
                        lambda t, now: ({"annual": annual, "quarterly": quarterly}, False))
    monkeypatch.setattr(et.cache, "set",
                        lambda k, v, ttl=None, **kw: seen.__setitem__("ttl", ttl))
    monkeypatch.setattr(et.snap_store, "put",
                        lambda *a, **kw: seen.__setitem__("persisted", True))
    et._build_and_cache("TSTQ", 0.0)
    return et, seen


def test_a_partial_earnings_table_is_not_cached_as_complete(monkeypatch, tmp_path):
    """One leg failing must NOT pin a half-populated table for hours.

    This guard used to read `not annual AND not quarterly`, so only a TOTALLY
    empty payload got the short retry TTL — a single failed leg fell through and
    was cached for up to _SLOW_TTL (6h) AND persisted to the snapshot store,
    where a stale-served partial outlives the outage that caused it. Same class
    as the `get_earnings_intel` partial-cache bug: never cache a failed fetch as
    a value. Found by the 2026-08-05 data-coverage audit.
    """
    # quarterly resolved, annual did not
    et, seen = _ttl_for(monkeypatch, tmp_path, annual=[], quarterly=[{"label": "Q2 26"}])
    assert seen["ttl"] == et._EMPTY_TTL
    assert "persisted" not in seen, "a partial must not reach the snapshot store"

    # ...and the mirror case: annual resolved, quarterly did not
    et, seen = _ttl_for(monkeypatch, tmp_path, annual=[{"label": "FY25"}], quarterly=[])
    assert seen["ttl"] == et._EMPTY_TTL
    assert "persisted" not in seen


def test_a_complete_earnings_table_still_gets_the_full_ttl(monkeypatch, tmp_path):
    """The other direction — a genuinely complete payload must NOT be punished
    with the 2-minute retry TTL, which would re-fetch every visit."""
    et, seen = _ttl_for(monkeypatch, tmp_path,
                        annual=[{"label": "FY25"}], quarterly=[{"label": "Q2 26"}])
    assert seen["ttl"] in (et._FAST_TTL, et._SLOW_TTL)
    assert seen["ttl"] != et._EMPTY_TTL
    assert seen.get("persisted") is True
