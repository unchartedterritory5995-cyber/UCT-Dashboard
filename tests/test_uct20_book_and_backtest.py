"""The two UCT20 payloads the dashboard serves, and what each is allowed to be.

`get_uct20_backtest_data` has always been the LIVE no-stops tracker re-sliced
into analytics -- monthly returns, drawdown series, streaks. Useful, but not a
backtest of anything, despite the name. It now carries a `harness` section
that IS one: the measured 1,119-session A/B.

`get_uct20_book_data` is the live risk-managed Book. It may legitimately be
empty (flag off, never run) and it may legitimately be present but
UNPUBLISHABLE -- short of a usable sample -- and the client has to be able to
tell those two apart.
"""

from unittest.mock import patch

from api.services import engine
from api.services.cache import cache


def _clear():
    for k in ("uct20_book", "uct20_harness_backtest", "uct20_backtest",
              "uct20_portfolio"):
        try:
            cache.delete(k)
        except Exception:
            cache.set(k, None, ttl=0)


# ── the Book ────────────────────────────────────────────────────────────────

def test_book_prefers_the_pushed_wire_payload():
    _clear()
    payload = {"kind": "live_book", "record_status": "recording",
               "stats_published": False, "sessions": 14}
    with patch.object(engine, "_load_wire_data",
                      return_value={"uct20_book": payload}):
        assert engine.get_uct20_book_data() == payload


def test_book_absent_is_an_empty_dict_not_a_crash():
    """Flag off, or never run. The tile must get {} and render nothing --
    NOT a zeroed payload that reads as a flat track record."""
    _clear()
    with patch.object(engine, "_load_wire_data", return_value={}), \
         patch.object(engine, "UCT_INTEL_PATH", "/nonexistent-path-for-test"):
        assert engine.get_uct20_book_data() == {}


def test_a_short_book_is_served_but_marked_unpublishable():
    """The distinction the client depends on: present, but not yet a record."""
    _clear()
    payload = {"kind": "live_book", "stats_published": False,
               "record_status": "recording", "closed_trades_min_arm": 2,
               "min_trades_for_stats": 30,
               "variant": {"expectancy_pct": -11.5607}}
    with patch.object(engine, "_load_wire_data",
                      return_value={"uct20_book": payload}):
        out = engine.get_uct20_book_data()
    assert out["stats_published"] is False
    assert out["closed_trades_min_arm"] < out["min_trades_for_stats"]
    # The numbers are CARRIED -- the gate is a flag, not censorship -- so the
    # client is what must honour it.
    assert out["variant"]["expectancy_pct"] == -11.5607


# ── the measured backtest ───────────────────────────────────────────────────

def test_harness_backtest_prefers_the_pushed_payload():
    _clear()
    payload = {"kind": "backtest", "window": {"sessions": 1119}}
    with patch.object(engine, "_load_wire_data",
                      return_value={"uct20_backtest": payload}):
        assert engine.get_uct20_harness_backtest_data() == payload


def test_the_backtest_tile_carries_the_measured_run_alongside():
    """The tile named 'backtest' must be able to show a real one."""
    _clear()
    harness = {"kind": "backtest", "window": {"sessions": 1119},
               "variant": {"total_return_pct": 404.4844},
               "control": {"total_return_pct": 263.9933}}
    portfolio = {"equity_curve": [{"date": "2026-07-01", "value": 50000},
                                  {"date": "2026-07-02", "value": 51000}],
                 "trades": [], "account_size": 50000, "qqq_curve": []}
    with patch.object(engine, "get_uct20_portfolio_data", return_value=portfolio), \
         patch.object(engine, "get_uct20_harness_backtest_data", return_value=harness):
        out = engine.get_uct20_backtest_data()
    assert out["harness"]["window"]["sessions"] == 1119
    # Both arms travel together: quoting the stopped arm without the control
    # is quoting a number with nothing to compare it to.
    assert out["harness"]["variant"]["total_return_pct"] == 404.4844
    assert out["harness"]["control"]["total_return_pct"] == 263.9933


def test_a_missing_manifest_does_not_break_the_backtest_tile():
    _clear()
    portfolio = {"equity_curve": [{"date": "2026-07-01", "value": 50000}],
                 "trades": [], "account_size": 50000, "qqq_curve": []}
    with patch.object(engine, "get_uct20_portfolio_data", return_value=portfolio), \
         patch.object(engine, "get_uct20_harness_backtest_data", return_value={}):
        out = engine.get_uct20_backtest_data()
    assert out["harness"] == {}
    assert "monthly_returns" in out          # the rest of the tile survives
