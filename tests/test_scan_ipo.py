"""Tests for the IPO-in-last-1-year scan (api/services/scan_ipo.py)."""
from api.services import scan_ipo as si
from api.services.cache import cache


def _reset():
    cache.delete_prefix("scan_ipo1y")
    cache.delete_prefix("scan_full_market_snapshot")  # shared 30s snapshot cache
    with si._LOCK:
        si._state.update(date=None, map=None, building=False, built_at=0.0)


def test_ipo_scan_reports_computing_before_set(monkeypatch):
    _reset()
    monkeypatch.setattr(si._sqlite, "recent_first_trade", lambda since: {})
    monkeypatch.setattr(si, "_recent_relistings", lambda since: {})
    monkeypatch.setattr(si, "_whole_market_ipos", lambda since: {})
    out = si.get_ipo_last_1y()
    assert out["status"] == "computing"
    assert out["results"] == []
    _reset()


def test_build_ipo_set_returns_recent_first_trades(monkeypatch):
    # No cap-universe restriction — recent IPOs (e.g. CBRS) aren't in that static list.
    monkeypatch.setattr(si._sqlite, "recent_first_trade",
                        lambda since: {"AAA": 20260101, "CBRS": 20260528})
    monkeypatch.setattr(si, "_recent_relistings", lambda since: {})
    monkeypatch.setattr(si, "_whole_market_ipos", lambda since: {})
    assert si._build_ipo_set() == {"AAA": 20260101, "CBRS": 20260528}


def test_build_ipo_set_merges_all_overlays(monkeypatch):
    # Base (bars.db) + reuse overlay (SPCX) + whole-market overlay (AIB, not charted). The
    # whole-market list_date wins for a ticker known to both (exact IPO date > first bar).
    monkeypatch.setattr(si._sqlite, "recent_first_trade",
                        lambda since: {"CBRS": 20260528, "AIB": 20260610})
    monkeypatch.setattr(si, "_recent_relistings", lambda since: {"SPCX": 20260615})
    monkeypatch.setattr(si, "_whole_market_ipos", lambda since: {"AIB": 20260605, "APMD": 20260701})
    assert si._build_ipo_set() == {
        "CBRS": 20260528, "SPCX": 20260615, "AIB": 20260605, "APMD": 20260701,
    }  # AIB uses the whole-market list_date (20260605), not the bars.db first bar (20260610)


def test_whole_market_ipos_surfaces_common_stock_not_in_bars_db(monkeypatch):
    calls = []

    def _fake_near(d):
        calls.append(d)
        return {"AIB", "APMD", "ANCHOR"} if len(calls) == 1 else {"ANCHOR"}   # now vs ~1y ago

    monkeypatch.setattr(si, "_grouped_symbols_near", _fake_near)
    monkeypatch.setattr(si, "_common_stock_symbols", lambda: {"AIB", "APMD"})
    monkeypatch.setattr(si, "_list_date", lambda t: {"AIB": 20260601, "APMD": 20260701}.get(t))
    out = si._whole_market_ipos(20250807)
    assert out == {"AIB": 20260601, "APMD": 20260701}


def test_whole_market_ipos_filters_non_cs_and_old_listings(monkeypatch):
    calls = []

    def _fake_near(d):
        calls.append(d)
        return {"AIB", "WARR", "OLDIPO", "ANCHOR"} if len(calls) == 1 else {"ANCHOR"}

    monkeypatch.setattr(si, "_grouped_symbols_near", _fake_near)
    monkeypatch.setattr(si, "_common_stock_symbols", lambda: {"AIB", "OLDIPO"})  # WARR not CS
    monkeypatch.setattr(si, "_list_date", lambda t: {"AIB": 20260601, "OLDIPO": 20240101}.get(t))
    out = si._whole_market_ipos(20250807)
    assert out == {"AIB": 20260601}     # WARR excluded (not CS); OLDIPO listed before the window


def test_list_date_parses_common_stock_only(monkeypatch):
    cache.delete_prefix("ipo_listdate_")
    details = {
        "AIB": {"type": "CS", "list_date": "2026-06-01"},
        "WARR": {"type": "WARRANT", "list_date": "2026-05-01"},
        "NODATE": {"type": "CS"},
    }
    monkeypatch.setattr(si.massive, "get_ticker_details", lambda t: details.get(t, {}))
    assert si._list_date("AIB") == 20260601
    assert si._list_date("WARR") is None    # not common stock
    assert si._list_date("NODATE") is None  # no list_date
    cache.delete_prefix("ipo_listdate_")


def test_recent_relistings_verifies_candidates_via_sanitize(monkeypatch):
    # Candidate resumes from the reuse-signature scan are confirmed + dated by the chart
    # sanitize; a candidate whose sanitized listing is OUTSIDE the window is dropped.
    monkeypatch.setattr(si._sqlite, "recent_relisting_candidates",
                        lambda since, floor, **k: {"SPCX": 20260610, "FAKE": 20260101})
    monkeypatch.setattr(si, "_sanitized_first_date",
                        lambda t: {"SPCX": 20260615, "FAKE": 20240101}.get(t))
    out = si._recent_relistings(20250807)
    assert out == {"SPCX": 20260615}     # FAKE's sanitized listing (2024) is before `since`


def test_ipo_scan_skips_names_not_in_snapshot(monkeypatch):
    # The market snapshot is the currently-trading filter: a set member absent from
    # it (delisted / not a real equity) is dropped; recent IPOs present in it stay.
    _reset()
    with si._LOCK:
        si._state.update(date=si._session_date(),
                         map={"CBRS": 20260528, "GONE": 20260201}, building=False)
    snap = {"CBRS": {"last_price": 226.0, "prev_close": 211.0}}  # GONE absent → skipped

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(si.massive, "_get_client", lambda: _Client())
    monkeypatch.setattr(si, "_tradable", lambda *a, **k: True)  # filter tested separately
    out = si.get_ipo_last_1y()
    assert [r["sym"] for r in out["results"]] == ["CBRS"]
    _reset()


def test_ipo_scan_excludes_etfs(monkeypatch):
    # ETFs/ETNs/leveraged funds (e.g. SNXX) that first traded in the window must be
    # dropped — the scan is IPO'd STOCKS only.
    _reset()
    with si._LOCK:
        si._state.update(date=si._session_date(),
                         map={"CBRS": 20260528, "SNXX": 20260401}, building=False)
    snap = {
        "CBRS": {"last_price": 226.0, "prev_close": 211.0},
        "SNXX": {"last_price": 30.0, "prev_close": 29.0},
    }

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(si.massive, "_get_client", lambda: _Client())
    monkeypatch.setattr(si, "_tradable", lambda *a, **k: True)  # filter tested separately
    monkeypatch.setattr(si, "_etf_symbols", lambda: {"SNXX"})

    out = si.get_ipo_last_1y()
    assert [r["sym"] for r in out["results"]] == ["CBRS"]  # SNXX excluded as an ETF
    _reset()


def test_ipo_scan_returns_recent_ipos_newest_first(monkeypatch):
    _reset()
    with si._LOCK:
        si._state.update(date=si._session_date(),
                         map={"AAA": 20251001, "BBB": 20260301}, building=False)
    snap = {
        "AAA": {"last_price": 11.0, "prev_close": 10.0},
        "BBB": {"last_price": 20.0, "prev_close": 25.0},
    }

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(si.massive, "_get_client", lambda: _Client())
    monkeypatch.setattr(si, "_tradable", lambda *a, **k: True)  # filter tested separately

    out = si.get_ipo_last_1y()
    assert out["status"] == "ok"
    assert out["count"] == 2
    # Most recent IPO first: BBB (2026-03-01) then AAA (2025-10-01).
    assert [r["sym"] for r in out["results"]] == ["BBB", "AAA"]
    assert out["results"][0]["change_pct"] == -20.0
    _reset()
