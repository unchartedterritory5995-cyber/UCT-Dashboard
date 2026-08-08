"""Tests for the IPO-in-last-1-year scan (api/services/scan_ipo.py)."""
from api.services import scan_ipo as si
from api.services.cache import cache


def _reset():
    cache.delete_prefix("scan_ipo1y")
    with si._LOCK:
        si._state.update(date=None, map=None, building=False, built_at=0.0)


def test_ipo_scan_reports_computing_before_set(monkeypatch):
    _reset()
    monkeypatch.setattr(si, "_listing_starts", lambda: {})
    out = si.get_ipo_last_1y()
    assert out["status"] == "computing"
    assert out["results"] == []
    _reset()


def test_build_ipo_set_filters_current_listings_to_the_window(monkeypatch):
    # Reuse-aware + no cap-universe restriction: keyed on the CURRENT listing start, and
    # anything whose current listing began before the 1-year window is dropped.
    monkeypatch.setattr(si, "_listing_starts",
                        lambda: {"AAA": 20260101, "CBRS": 20260528, "OLD": 20200101})
    out = si._build_ipo_set()
    assert "AAA" in out and "CBRS" in out
    assert "OLD" not in out          # current listing > 1 year ago → not a recent IPO


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

    out = si.get_ipo_last_1y()
    assert out["status"] == "ok"
    assert out["count"] == 2
    # Most recent IPO first: BBB (2026-03-01) then AAA (2025-10-01).
    assert [r["sym"] for r in out["results"]] == ["BBB", "AAA"]
    assert out["results"][0]["change_pct"] == -20.0
    _reset()
