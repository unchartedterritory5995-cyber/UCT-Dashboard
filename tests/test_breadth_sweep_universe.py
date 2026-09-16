"""The sweep is ONE algorithm over many universes.

The rails that matter here are architectural: the universe reaches the metric
engine only as a member set, a PIT universe never consults today's UCT ticker
list, and the floors cannot be swept past.
"""
import datetime

import numpy as np
import pytest

from api.services import breadth_history_recon as recon
from api.services import breadth_universes as bu


def _sessions(n=260, start="2014-03-03"):
    """`n` consecutive weekday ISO dates — enough to clear the engine's 221-session
    minimum for a 200-day average and a 52-week extreme."""
    d = datetime.date.fromisoformat(start)
    out = []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += datetime.timedelta(days=1)
    return out


def _frame(tickers, dates, closes):
    """closes: {ticker: [close per date]} -> the frame shape the sweep consumes."""
    arr = np.full((len(tickers), len(dates)), np.nan)
    vol = np.full((len(tickers), len(dates)), 1_000_000.0)
    for i, t in enumerate(tickers):
        for j, v in enumerate(closes[t]):
            arr[i, j] = v
    return {"dates": list(dates), "date_pos": {d: j for j, d in enumerate(dates)},
            "closes": arr, "vols": vol}


def test_members_restricts_the_metric_engine_without_a_second_metric_path():
    """⭐ The architectural claim, asserted: the same frame and the same engine give
    two different universe answers purely from the member set."""
    dates = _sessions()
    # RISERS climb (so they sit above their average), FALLERS decline.
    tickers = ["UP1", "UP2", "DN1", "DN2"]
    closes = {
        "UP1": [10 + 0.1 * j for j in range(len(dates))],
        "UP2": [20 + 0.1 * j for j in range(len(dates))],
        "DN1": [100 - 0.1 * j for j in range(len(dates))],
        "DN2": [200 - 0.1 * j for j in range(len(dates))],
    }
    f = _frame(tickers, dates, closes)
    target = dates[-1]

    everything = recon.recompute_from_frame(f, tickers, target, window=260)
    risers = recon.recompute_from_frame(f, tickers, target, window=260,
                                        members={"UP1", "UP2"})
    fallers = recon.recompute_from_frame(f, tickers, target, window=260,
                                         members={"DN1", "DN2"})
    assert everything["ok"] and risers["ok"] and fallers["ok"]
    assert everything["metrics"]["pct_above_50sma"] == 50.0
    assert risers["metrics"]["pct_above_50sma"] == 100.0
    assert fallers["metrics"]["pct_above_50sma"] == 0.0
    # the member set is the universe, so it also drives the COUNT metrics
    assert risers["metrics"]["universe_count"] == 2
    assert everything["metrics"]["universe_count"] == 4


def test_members_none_is_the_pre_universe_behaviour():
    dates = _sessions()
    tickers = ["A", "B"]
    closes = {"A": [10 + 0.1 * j for j in range(len(dates))],
              "B": [50 - 0.1 * j for j in range(len(dates))]}
    f = _frame(tickers, dates, closes)
    assert (recon.recompute_from_frame(f, tickers, dates[-1], window=260)["metrics"]
            == recon.recompute_from_frame(f, tickers, dates[-1], window=260,
                                          members=None)["metrics"])


def test_a_pit_universe_cannot_be_swept_below_its_floor(monkeypatch):
    called = {"frame": False}

    def _boom(*a, **k):
        called["frame"] = True
        raise AssertionError("must not reach the frame builder")

    monkeypatch.setattr("api.services.breadth_pit_frame.build_frame", _boom)
    for uni, bad in (("nasdaq", "2008-06-02"), ("nyse", "2010-12-31"), ("us", "2007-01-02")):
        with pytest.raises(bu.BelowHistoryFloor):
            recon.sweep_history(bad, bad, universe=uni)
    assert called["frame"] is False       # refused BEFORE any provider work


def test_a_pit_universe_refuses_an_explicit_ticker_list(monkeypatch):
    # ⛔ Passing tickers would reintroduce exactly the survivorship bug this phase
    # exists to avoid: a fixed list projected backwards.
    monkeypatch.setattr("api.services.breadth_pit_frame.build_frame",
                        lambda *a, **k: {"ok": True})
    out = recon.sweep_history("2015-01-02", "2015-01-09", tickers=["AAPL"], universe="us")
    assert out["ok"] is False and "per date" in out["reason"]


def test_the_uct_sweep_never_touches_the_pit_path(monkeypatch):
    monkeypatch.setattr("api.services.breadth_pit_frame.build_frame",
                        lambda *a, **k: (_ for _ in ()).throw(
                            AssertionError("UCT must not build a PIT frame")))
    seen = {}

    def _fake_load(tickers, since=None, **k):
        seen["tickers"] = tickers
        return {"dates": [], "date_pos": {}, "closes": np.zeros((0, 0)),
                "vols": np.zeros((0, 0))}

    monkeypatch.setattr(recon, "load_deep_frame", _fake_load)
    recon.sweep_history("2015-01-02", "2015-01-09", tickers=["AAPL", "MSFT"])
    assert seen["tickers"] == ["AAPL", "MSFT"]


def test_a_pit_sweep_writes_under_its_own_universe(monkeypatch, tmp_path):
    """The sweep's rows must land in the universe that produced them."""
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "o.db"))
    from api.services import breadth_daily_ohlc as store
    store._INIT_DONE = False

    dates = _sessions()
    tickers = ["UP1", "DN1"]
    closes = {"UP1": [10 + 0.1 * j for j in range(len(dates))],
              "DN1": [100 - 0.1 * j for j in range(len(dates))]}
    f = _frame(tickers, dates, closes)
    f.update({"ok": True, "tickers": tickers,
              "eligible": {dates[-1]: {"UP1"}}, "coverage": {dates[-1]: {"frame": 2}},
              "sweep_dates": [dates[-1]]})
    monkeypatch.setattr("api.services.breadth_pit_frame.build_frame", lambda *a, **k: f)

    out = recon.sweep_history(dates[-1], dates[-1], universe="us")
    assert out["ok"] and out["universe"] == "us" and out["rows"] > 0
    assert store.history("pct_above_50sma", universe="us")[dates[-1]]["c"] == 100.0
    assert store.history("pct_above_50sma") == {}          # UCT untouched
    store._INIT_DONE = False


def test_the_default_backfill_loop_can_only_ever_sweep_uct():
    """§10: a normal backfill job must not be able to reach an exchange universe."""
    import inspect
    src = inspect.getsource(recon.backfill_tick)
    assert "universe=" not in src, (
        "backfill_tick gained a universe argument — it must stay UCT-only, or it "
        "needs its own floor clamp before it can walk downward through history")
