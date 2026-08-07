"""Tests for the volume scans (api/services/scan_volume.py) — 1-year + all-time."""
from api.services import scan_volume as sv
from api.services.cache import cache


def _reset():
    cache.delete_prefix("scan_hv")
    with sv._ref_lock:
        sv._ref_states.clear()


def test_ref_max_vol_excludes_today_and_takes_prior_max(monkeypatch):
    today = sv._today_yyyymmdd()
    rows = [
        (20260601, 1, 1, 1, 1, 100),
        (20260602, 1, 1, 1, 1, 500),      # the trailing max
        (20260603, 1, 1, 1, 1, 300),
        (today,    1, 1, 1, 1, 9_999_999),  # today's evolving bar — MUST be dropped
    ]
    monkeypatch.setattr(sv._sqlite, "get_bars", lambda t, tf, n: rows)
    assert sv._ref_max_vol("AAA") == 500


def test_ref_max_vol_needs_min_prior_sessions(monkeypatch):
    today = sv._today_yyyymmdd()
    monkeypatch.setattr(sv._sqlite, "get_bars", lambda t, tf, n: [(today, 1, 1, 1, 1, 100)])
    assert sv._ref_max_vol("AAA") is None   # only today's bar → nothing to compare against


def test_scan_reports_computing_until_reference_ready(monkeypatch):
    _reset()
    monkeypatch.setattr(sv, "_universe", lambda: [])
    monkeypatch.setattr(sv._sqlite, "max_daily_volume_in_range", lambda *a, **k: {})
    out = sv.get_highest_volume_1y()
    assert out["status"] == "computing"
    assert out["results"] == []
    _reset()


def test_build_reference_uses_sql_and_intersects_universe(monkeypatch):
    # The whole reference comes from ONE aggregate query; restrict to the cap universe.
    monkeypatch.setattr(sv._sqlite, "max_daily_volume_in_range",
                        lambda *a, **k: {"AAA": 1000, "BBB": 2000, "ZZZ": 50})
    ref = sv._build_reference(365, {"AAA", "BBB"})   # ZZZ outside the universe → dropped
    assert ref == {"AAA": 1000, "BBB": 2000}


def test_build_reference_all_time_queries_from_zero(monkeypatch):
    # days=None (all-time) queries from_ymd=0 (since inception), not a trailing window.
    seen = {}

    def _fake(from_ymd, to_ymd, min_sessions):
        seen["from_ymd"] = from_ymd
        return {"AAA": 42}

    monkeypatch.setattr(sv._sqlite, "max_daily_volume_in_range", _fake)
    sv._build_reference(None, {"AAA"})
    assert seen["from_ymd"] == 0


def test_scan_returns_only_qualifiers_sorted_by_ratio(monkeypatch):
    _reset()
    with sv._ref_lock:
        sv._state("1y").update(date=sv._session_date(),
                               map={"AAA": 1000, "BBB": 2000, "CCC": 5000},
                               building=False)
    snap = {
        "AAA": {"today_vol": 3000, "last_price": 11.0, "prev_close": 10.0},  # 3.00x, +10%
        "BBB": {"today_vol": 2500, "last_price": 20.0, "prev_close": 20.0},  # 1.25x
        "CCC": {"today_vol": 1000, "last_price": 5.0,  "prev_close": 5.0},   # 0.20x → excluded
    }

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(sv.massive, "_get_client", lambda: _Client())

    out = sv.get_highest_volume_1y()
    assert out["status"] == "ok"
    assert [r["sym"] for r in out["results"]] == ["AAA", "BBB"]  # CCC excluded; ratio desc
    assert out["count"] == 2
    assert out["results"][0]["ratio"] == 3.0
    assert out["results"][0]["change_pct"] == 10.0
    _reset()


def test_all_time_scan_uses_its_own_reference(monkeypatch):
    _reset()
    with sv._ref_lock:
        sv._state("ever").update(date=sv._session_date(), map={"AAA": 1000}, building=False)
    snap = {"AAA": {"today_vol": 4000, "last_price": 6.0, "prev_close": 5.0}}

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(sv.massive, "_get_client", lambda: _Client())

    out = sv.get_highest_volume_ever()
    assert [r["sym"] for r in out["results"]] == ["AAA"]
    assert out["results"][0]["ratio"] == 4.0
    _reset()


def test_scan_maps_class_share_symbology(monkeypatch):
    """Universe is app-form (BRK-B); snapshot is provider-form (BRK.B)."""
    _reset()
    with sv._ref_lock:
        sv._state("1y").update(date=sv._session_date(), map={"BRK-B": 100}, building=False)
    snap = {"BRK.B": {"today_vol": 250, "last_price": 4.0, "prev_close": 4.0}}

    class _Client:
        def get_full_market_snapshot(self):
            return snap

    monkeypatch.setattr(sv.massive, "_get_client", lambda: _Client())
    monkeypatch.setattr(sv.massive, "to_polygon_symbol", lambda s: s.replace("-", "."))

    out = sv.get_highest_volume_1y()
    assert [r["sym"] for r in out["results"]] == ["BRK-B"]
    _reset()
