"""W and M stay as current as the live daily (2026-11-25 wide sweep, the paint builder's findings).

On 23 of 30 W/M presses the answer came from the stored W/M table, DAYS behind (Server-Timing `bars(stale-swr)`; in the
sweep's W2 board every one of the 69 W/M answers served from the store was `stale-swr`, the rest from the memory cache),
with an old close (-6..-10%). The stale-while-revalidate refresh re-asks the provider for recent dailies in the
background, and under load it did not land. The daily itself is kept current by the live store's whole-market snapshot
(`bars_live_store.covered(t, "D")`: alive, seen, CONTIGUOUS), so a W/M series is derived from the STORED daily on read:
the periods from the one holding the stored W/M tail are rebuilt from the daily rows and written when they differ, and
`_needs_fresh` reads a W/M tail that holds exactly that derivation as fresh. No provider call. All data synthetic.
"""
import json
from datetime import date, timedelta

import pytest

from api.services import bars_fetch, bars_live_store as bls, bars_sqlite


def _sessions(n):
    """The last `n` weekdays through the most recent NYSE session (the store's own clock), oldest first."""
    last = bars_fetch._last_weekday_yyyymmdd()
    d = date(last // 10000, last // 100 % 100, last % 100)
    out = []
    while len(out) < n:
        if d.weekday() < 5 and bars_fetch._is_trading_day_ymd(d):
            out.append(d)
        d -= timedelta(days=1)
    return out[::-1]


@pytest.fixture
def store(monkeypatch, tmp_path):
    monkeypatch.setenv("BARS_LIVE_COVERAGE_ENABLED", "1")
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite._drop_local_conn()
    bars_sqlite.init_db()
    bls._reset_for_tests()

    def _no_provider(*a, **k):
        raise AssertionError("a W/M read on a live daily must not reach a provider")
    for name in ("_recent_daily_iso", "_delta_weekly", "_delta_monthly", "_fetch_daily_full"):
        if hasattr(bars_fetch, name):
            monkeypatch.setattr(bars_fetch, name, _no_provider)
    bars_fetch.cache.delete_prefix("bars_AAA_")
    yield
    bars_sqlite._drop_local_conn()
    bls._reset_for_tests()


def _seed(tf, stale_close=None, live=True, monkeypatch=None):
    days = _sessions(130)
    daily = [{"t": d.isoformat(), "o": 100 + i, "h": 101 + i, "l": 99 + i, "c": 100.5 + i, "v": 1000 + i}
             for i, d in enumerate(days)]
    bars_sqlite.put_bars("AAA", "D", daily, date_tf=True)
    periods = (bars_fetch._resample_weekly_iso(daily) if tf == "W" else bars_fetch._resample_monthly_iso(daily))
    stored = [dict(p) for p in periods]
    if stale_close is not None:
        stored[-1]["c"] = stale_close                          # the current period, stored days ago
    bars_sqlite.put_bars("AAA", tf, stored, date_tf=True)
    monkeypatch.setattr(bls, "covered", lambda t, k: live and k == "D")
    return daily, periods


@pytest.mark.parametrize("tf", ["W", "M"])
def test_a_stale_current_period_on_a_live_daily_is_served_current_from_the_store(store, monkeypatch, tf):
    daily, periods = _seed(tf, stale_close=1.0, monkeypatch=monkeypatch)
    n = len(periods)
    resp = bars_fetch._get_bars_inner("AAA", tf, n)
    body = json.loads(resp.body)
    assert body["bars"][-1]["c"] == daily[-1]["c"], "the current period kept its days-old close"
    assert bars_fetch.get_serve_layer() == "sqlite", bars_fetch.get_serve_layer()


@pytest.mark.parametrize("tf", ["W", "M"])
def test_a_period_holding_the_derivation_is_fresh(store, monkeypatch, tf):
    daily, periods = _seed(tf, monkeypatch=monkeypatch)
    last = int(periods[-1]["t"].replace("-", ""))
    assert bars_fetch._needs_fresh(last, tf, "AAA") is False


def test_control_without_a_live_daily_nothing_changes(store, monkeypatch):
    daily, periods = _seed("W", stale_close=1.0, live=False, monkeypatch=monkeypatch)
    last = int(periods[-1]["t"].replace("-", ""))
    assert bars_fetch._needs_fresh(last, "W", "AAA") is True
    assert bars_fetch._needs_fresh(last, "W") is True            # no ticker: the old rule, unchanged
