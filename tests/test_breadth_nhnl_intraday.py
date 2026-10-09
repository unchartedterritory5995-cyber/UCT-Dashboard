"""Intraday-basis new highs / lows (`breadth_nhnl_intraday`)."""
import json
import os

import numpy as np
import pytest

from api.services import breadth_nhnl_intraday as nhi


@pytest.fixture
def tmpdata(tmp_path, monkeypatch):
    monkeypatch.setattr(nhi, "SERIES_PATH", str(tmp_path / "series.json"))
    monkeypatch.setattr(nhi, "STATE_PATH", str(tmp_path / "state.npz"))
    monkeypatch.setattr(nhi, "_restore_from_r2", lambda: os.path.exists(nhi.SERIES_PATH))
    nhi._view.clear()
    nhi._live_ring.clear()
    yield tmp_path
    nhi._view.clear()
    nhi._live_ring.clear()


class _Cls:
    """Every ticker is NYSE common stock; UCT = {AAA}."""

    def classify(self, sym, d):
        return ("us", "nyse")

    def uct(self, d):
        return {"AAA"}


def _frame(h, l, c=None, v=1000):
    return {t: {"h": h[t], "l": l[t], "c": (c or h)[t], "v": v} for t in h}


def _sessions(n):
    return ["2025-%02d-%02d" % (1 + i // 28, 1 + i % 28) for i in range(n)]


def _run(ring, days, frames):
    out = None
    for d, f in zip(days, frames):
        out = nhi.measure(ring, d, f, _Cls())
    return out


def test_intraday_high_breaks_prior_high_even_when_close_does_not():
    ring = nhi.Ring()
    days = _sessions(253)
    flat = [_frame({"AAA": 10.0, "BBB": 10.0}, {"AAA": 9.0, "BBB": 9.0}, {"AAA": 9.5, "BBB": 9.5})] * 252
    # D: AAA trades to 10.5 (new intraday high) but closes 9.6 — a new high on the exchange
    # convention, not on a closing basis. BBB trades down to 8.5 and recovers to 9.9.
    last = _frame({"AAA": 10.5, "BBB": 9.9}, {"AAA": 9.2, "BBB": 8.5}, {"AAA": 9.6, "BBB": 9.9})
    out = _run(ring, days, flat + [last])
    nh, nl, nh20, nl20, n, valid = out["nyse"][:6]
    assert (nh, nl, nh20, nl20, n, valid) == (1, 1, 1, 1, 2, 2)
    assert out["uct"][:2] == [1, 0]                    # UCT holds AAA only


def test_equal_to_prior_extreme_is_not_new_and_short_history_does_not_count():
    ring = nhi.Ring()
    days = _sessions(253)
    frames = [_frame({"AAA": 10.0}, {"AAA": 9.0})] * 252 + [_frame({"AAA": 10.0, "NEW": 50.0},
                                                                    {"AAA": 9.0, "NEW": 40.0})]
    out = _run(ring, days, frames)
    assert out["nyse"][:2] == [0, 0]                   # ties are not new extremes
    assert out["nyse"][4:6] == [2, 1]                  # NEW has no complete window


def test_window_is_251_prior_sessions():
    ring = nhi.Ring()
    days = _sessions(260)
    # an old high of 20 on session 0, then 10s; on session 252 the 20 is 252 sessions back
    frames = ([_frame({"AAA": 20.0}, {"AAA": 9.0})] + [_frame({"AAA": 10.0}, {"AAA": 9.0})] * 251
              + [_frame({"AAA": 15.0}, {"AAA": 9.5})])
    out = _run(ring, days, frames)
    assert out["nyse"][0] == 1                         # 20 has rolled out of the window


def test_a_gap_in_the_window_still_counts_the_name():
    ring = nhi.Ring()
    days = _sessions(253)
    frames = [_frame({"AAA": 10.0, "BBB": 10.0}, {"AAA": 9.0, "BBB": 9.0})] * 252
    frames[100] = _frame({"AAA": 10.0}, {"AAA": 9.0})  # BBB absent one session
    frames = frames + [_frame({"AAA": 11.0, "BBB": 11.0}, {"AAA": 9.0, "BBB": 9.0})]
    out = _run(ring, days, frames)
    assert out["nyse"][0] == 2 and out["nyse"][5] == 2      # the diary rule: listed, not complete


def test_zero_volume_rows_are_not_traded():
    ring = nhi.Ring()
    f = {"AAA": {"h": 10.0, "l": 9.0, "c": 9.5, "v": 0}}
    out = nhi.measure(ring, "2025-01-02", f, _Cls())
    assert out == {}


def test_ring_save_load_compact_roundtrip(tmpdata):
    ring = nhi.Ring()
    days = _sessions(30)
    frames = [_frame({"AAA": 10.0 + i, "OLD": 5.0}, {"AAA": 9.0, "OLD": 4.0}) for i in range(5)]
    frames += [_frame({"AAA": 10.0}, {"AAA": 9.0})] * 25
    _run(ring, days, frames)
    ring.save(nhi.STATE_PATH, {"version": nhi.VERSION})
    r2, meta = nhi.Ring.load(nhi.STATE_PATH)
    assert r2.n == 30 and r2.dates[-1] == days[-1] and meta["version"] == nhi.VERSION
    assert set(r2.tickers) == {"AAA", "OLD"}
    rows = r2.rows_for(["AAA"])
    assert r2.prior(rows, 19)[0][0] == pytest.approx(10.0)


def test_sma_check_counts_close_above_average():
    ring = nhi.Ring()
    days = _sessions(60)
    frames = [_frame({"AAA": 10.0, "BBB": 10.0}, {"AAA": 9.0, "BBB": 9.0}, {"AAA": 10.0, "BBB": 10.0})] * 59
    frames.append(_frame({"AAA": 12.0, "BBB": 10.0}, {"AAA": 9.0, "BBB": 8.0}, {"AAA": 12.0, "BBB": 8.0}))
    out = _run(ring, days, frames)
    assert out["nyse"][6] == 50.0 and out["nyse"][7] is None


def _install(tmpdata, rows, through="2026-10-08"):
    with open(nhi.SERIES_PATH, "w") as fh:
        json.dump({"version": nhi.VERSION, "rows": rows, "through": through}, fh)
    nhi._view.clear()


def test_serving_is_dark_by_default_and_follows_the_switch(tmpdata, monkeypatch):
    _install(tmpdata, {"nyse": {"2026-10-08": [37, 268, 50, 300, 1900, 1800, 25.0, 40.0]}})
    monkeypatch.delenv("BREADTH_NHNL_BASIS", raising=False)
    assert nhi.DEFAULT_BASIS in ("close", "intraday")
    monkeypatch.setenv("BREADTH_NHNL_BASIS", "close")
    assert not nhi.active() and nhi.token() == "" and nhi.values("nyse", "2026-10-08") is None
    monkeypatch.setenv("BREADTH_NHNL_BASIS", "intraday")
    assert nhi.active() and nhi.token().startswith(":nhnl-")
    v = nhi.values("nyse", "2026-10-08")
    assert v["new_52w_highs"] == 37 and v["net_new_high_low"] == -231
    assert v["hi_ratio"] == round(37 / 1900 * 100, 2)


def test_override_history_replaces_covered_sessions_as_bodies(tmpdata, monkeypatch):
    monkeypatch.setenv("BREADTH_NHNL_BASIS", "intraday")
    _install(tmpdata, {"us": {"2026-10-08": [78, 500, 1, 2, 5400, 5000, 1, 1]}})
    hist = {"2026-10-07": {"o": 1, "h": 2, "l": 0, "c": 1},
            "2026-10-08": {"o": 70, "h": 90, "l": 60, "c": 78}}
    out = nhi.override_history("new_52w_lows", "us", hist, with_source=True)
    assert out["2026-10-08"] == {"o": None, "h": None, "l": None, "c": 500, "src": nhi.VERSION}
    assert out["2026-10-07"] == hist["2026-10-07"]
    assert nhi.override_history("pct_above_50sma", "us", hist) is hist
    net = nhi.override_history("net_new_high_low", "us", hist)
    assert net["2026-10-08"]["c"] == -422


def test_override_v2_rows(tmpdata, monkeypatch):
    monkeypatch.setenv("BREADTH_NHNL_BASIS", "intraday")
    _install(tmpdata, {"uct": {"2026-10-08": [10, 20, 30, 40, 2000, 1900, 1, 1]}})
    rows = {"new_52w_highs": (1, 2, 0, 1, "v2_live"), "advancing": (1, 1, 1, 1, "v2_live")}
    out = nhi.override_v2_rows("uct", "2026-10-08", rows)
    assert out["new_52w_highs"] == (None, None, None, 10, nhi.VERSION)
    assert out["advancing"] == rows["advancing"]
    assert out["new_52w_lows"][3] == 20


def test_live_counts_needs_the_previous_session_in_the_ring(tmpdata, monkeypatch):
    monkeypatch.setenv("BREADTH_NHNL_BASIS", "intraday")
    _install(tmpdata, {"nyse": {"2026-10-07": [1, 1, 1, 1, 2, 2, 1, 1]}}, through="2026-10-07")
    ring = nhi.Ring()
    from datetime import date, timedelta
    d0 = date(2025, 6, 1)
    days = []
    d = d0
    from api.services import session_calendar as sc
    while d.isoformat() <= "2026-10-07":
        if sc.is_trading_day(d):
            days.append(d.isoformat())
        d += timedelta(days=1)
    days = days[-252:]
    assert days[-1] == "2026-10-07"
    frames = [_frame({"AAA": 10.0, "BBB": 10.0}, {"AAA": 9.0, "BBB": 9.0})] * 252
    _run(ring, days, frames)
    ring.save(nhi.STATE_PATH, {"version": nhi.VERSION})
    v = nhi.live_counts("nyse", {"AAA": 10.5, "BBB": 9.9}, {"AAA": 9.5, "BBB": 8.0},
                        ["AAA", "BBB", "CCC"], "2026-10-08", lists=True)
    assert (v["new_52w_highs"], v["new_52w_lows"], v["net_new_high_low"]) == (1, 1, 0)
    assert v["_lists"]["new_52w_highs"] == ["AAA"] and v["_lists"]["new_52w_lows"] == ["BBB"]
    # a settled session answers from the series, not the snapshot
    assert nhi.live_counts("nyse", {}, {}, [], "2026-10-07")["new_52w_highs"] == 1
    # a stale ring (two sessions behind) refuses
    assert nhi.live_counts("nyse", {"AAA": 11.0}, {"AAA": 9.5}, ["AAA"], "2026-10-09") is None


def test_sessions_after_skips_holidays_and_settles_after_close():
    s = nhi._sessions_after("2026-07-02", "2026-07-07")
    assert s == ["2026-07-06", "2026-07-07"]          # 07-03 observed holiday, weekend


def test_history_wrapper_applies_override(tmpdata, monkeypatch):
    from api.services import breadth_daily_ohlc as bdo
    monkeypatch.setenv("BREADTH_NHNL_BASIS", "intraday")
    _install(tmpdata, {"nasdaq": {"2026-10-08": [63, 441, 1, 1, 3300, 3200, 1, 1]}})
    monkeypatch.setattr(bdo, "_history_stored", lambda m, limit=6000, universe="uct", with_source=False:
                        {"2026-10-08": {"o": 1, "h": 1, "l": 1, "c": 25}})
    assert bdo.history("new_52w_highs", universe="nasdaq")["2026-10-08"]["c"] == 63
    assert bdo.history("advancing", universe="nasdaq")["2026-10-08"]["c"] == 25


def test_monitor_rows_take_the_intraday_basis_after_the_derive_pass(tmpdata, monkeypatch):
    from api.services import breadth_monitor as bm
    monkeypatch.setenv("BREADTH_NHNL_BASIS", "intraday")
    _install(tmpdata, {"uct": {"2026-10-08": [5, 50, 6, 60, 1000, 990, 1, 1]}})
    rows = [{"date": "2026-10-08", "new_52w_highs": 9, "new_52w_lows": 1, "universe_count": 1000,
             "_v2_direct": True, "hi_ratio": 0.9, "lo_ratio": 0.1, "net_new_high_low": 8}]
    bm._apply_nhnl(rows, "counts")
    assert rows[0]["new_52w_highs"] == 5 and rows[0]["new_20d_lows"] == 60
    bm._apply_nhnl(rows, "derived")
    assert rows[0]["net_new_high_low"] == -45 and rows[0]["lo_ratio"] == 5.0


def test_population_diagnostic_splits_by_venue_and_type(tmpdata, monkeypatch):
    from api.services import breadth_pit_frame as bpf
    ring = nhi.Ring()
    days = _sessions(253)
    frames = [_frame({"AAA": 10.0, "PRF": 25.0}, {"AAA": 9.0, "PRF": 24.0})] * 252
    frames.append(_frame({"AAA": 10.0, "PRF": 25.0}, {"AAA": 9.5, "PRF": 23.0}))
    _run(ring, days, frames)
    ring.save(nhi.STATE_PATH, {"version": nhi.VERSION})
    rec = lambda t: [{"type": t, "primary_exchange": "XNYS", "list_date": None, "delisted_utc": None}]
    monkeypatch.setattr(bpf, "reference_map", lambda: {"AAA": rec("CS"), "PRF": rec("PFD")})
    out = nhi.diagnose_population()
    assert out["ok"] and out["session"] == days[-1]
    assert out["by_venue_type"]["XNYS|PFD"]["complete_nl_intraday"] == 1
    assert out["by_venue_type"]["XNYS|CS"]["complete_nl_intraday"] == 0


def test_young_issue_counts_against_its_history_since_listing():
    ring = nhi.Ring()
    days = _sessions(260)
    frames = [_frame({"AAA": 10.0}, {"AAA": 9.0})] * 250
    frames += [_frame({"AAA": 10.0, "IPO": 20.0}, {"AAA": 9.0, "IPO": 18.0})] * 9
    frames.append(_frame({"AAA": 10.0, "IPO": 21.0}, {"AAA": 9.0, "IPO": 19.0}))
    out = _run(ring, days, frames)
    assert out["nyse"][0] == 1                              # IPO above every price since listing


def test_all_issues_population_and_switch(tmpdata, monkeypatch):
    from api.services import breadth_pit_frame as bpf
    rec = lambda t, ex: [{"type": t, "primary_exchange": ex, "list_date": None, "delisted_utc": None}]
    cls = nhi.Classifier({"AAA": rec("CS", "XNYS"), "PRF": rec("PFD", "XNYS"), "QQQ": rec("ETF", "XNAS")})
    assert set(cls.classify("AAA", "2026-10-08")) == {"us", "nyse", "us:all", "nyse:all"}
    assert set(cls.classify("PRF", "2026-10-08")) == {"us:all", "nyse:all"}
    assert set(cls.classify("QQQ", "2026-10-08")) == {"us:all", "nasdaq:all"}
    monkeypatch.setenv("BREADTH_NHNL_BASIS", "intraday")
    _install(tmpdata, {"nyse": {"2026-10-08": [29, 96, 1, 1, 1900, 1800, 1, 1]},
                       "nyse:all": {"2026-10-08": [34, 265, 1, 1, 2778, 2700, 1, 1]}})
    monkeypatch.delenv("BREADTH_NHNL_POPULATION", raising=False)
    assert nhi.values("nyse", "2026-10-08")["new_52w_lows"] == 96
    t_common = nhi.token()
    monkeypatch.setenv("BREADTH_NHNL_POPULATION", "all")
    assert nhi.values("nyse", "2026-10-08")["new_52w_lows"] == 265
    assert nhi.values("uct", "2026-10-08") is None
    assert nhi.token() != t_common and nhi.token().endswith("-all")
