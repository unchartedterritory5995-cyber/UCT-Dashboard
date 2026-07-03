"""Weekly-bar key integrity — the duplicate-candle bug class.

Weekly candles are keyed to the calendar FRIDAY of their ISO week
(commit e9c75603). Any weekly row at a non-Friday date is a leftover from
the old Monday keying — and because the bar's date IS its SQLite primary
key, old Monday rows + new Friday rows coexist and the chart shows TWO
candles per week (observed product-wide on prod 2026-07-02: 300/300 weeks
duplicated on MSTR).

The original one-shot heal (flag `.weekly_close_date_heal_v1`) only ran in
api.main's lifespan — the WORKER (api/worker_main.py) never runs that, so
its bars.db kept the Monday rows and every R2 snapshot pull re-poisoned the
web pod, with the flag file blocking a re-heal.

Two defenses, both tested here:
  1. `bars_sqlite.purge_mis_keyed_weekly_rows()` — content-based, idempotent
     purge run at EVERY boot on BOTH services + after snapshot restores.
  2. `_fmt_sqlite_bars` serve-time guard — drops non-Friday weekly rows so
     charts render clean even before a purge runs.
"""
import datetime

import pytest

from api.services import bars_sqlite
from api.services.bars_fetch import _fmt_sqlite_bars


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    yield
    bars_sqlite.bump_db_epoch()


def _put(ticker, tf, iso_dates):
    bars = [
        {"t": d, "o": 10.0, "h": 11.0, "l": 9.0, "c": 10.5, "v": 1000}
        for d in iso_dates
    ]
    bars_sqlite.put_bars(ticker, tf, bars, date_tf=True)


class TestPurgeMisKeyedWeeklyRows:
    def test_removes_monday_rows_keeps_friday_rows(self, fresh_db):
        # The observed prod state: one Monday + one Friday row per week.
        _put("MSTR", "W", ["2020-10-05", "2020-10-09", "2020-10-12", "2020-10-16"])
        deleted = bars_sqlite.purge_mis_keyed_weekly_rows()
        assert deleted == 2
        rows = bars_sqlite.get_bars("MSTR", "W", 100)
        assert [r[0] for r in rows] == [20201009, 20201016]

    def test_idempotent_second_run_deletes_nothing(self, fresh_db):
        _put("MSTR", "W", ["2020-10-05", "2020-10-09"])
        assert bars_sqlite.purge_mis_keyed_weekly_rows() == 1
        assert bars_sqlite.purge_mis_keyed_weekly_rows() == 0

    def test_leaves_daily_and_monthly_untouched(self, fresh_db):
        # Daily rows land on every weekday; monthly rows key to day 1.
        _put("AAPL", "D", ["2026-06-29", "2026-06-30", "2026-07-01"])
        _put("AAPL", "M", ["2026-06-01", "2026-07-01"])
        _put("AAPL", "W", ["2026-06-29"])  # Monday-keyed weekly (bad)
        assert bars_sqlite.purge_mis_keyed_weekly_rows() == 1
        assert len(bars_sqlite.get_bars("AAPL", "D", 100)) == 3
        assert len(bars_sqlite.get_bars("AAPL", "M", 100)) == 2
        assert bars_sqlite.get_bars("AAPL", "W", 100) == []

    def test_intraday_unix_timestamps_never_touched(self, fresh_db):
        # Intraday ts are unix seconds — must never be date-interpreted.
        bars_sqlite.put_bars(
            "NVDA", "5",
            [{"t": 1751457600, "o": 1, "h": 2, "l": 1, "c": 2, "v": 10}],
            date_tf=False,
        )
        assert bars_sqlite.purge_mis_keyed_weekly_rows() == 0
        assert len(bars_sqlite.get_bars("NVDA", "5", 100)) == 1

    def test_all_valid_friday_keys_survive(self, fresh_db):
        fridays = ["2026-06-05", "2026-06-12", "2026-06-19", "2026-06-26", "2026-07-03"]
        for d in fridays:
            assert datetime.date.fromisoformat(d).weekday() == 4
        _put("SPY", "W", fridays)
        assert bars_sqlite.purge_mis_keyed_weekly_rows() == 0
        assert len(bars_sqlite.get_bars("SPY", "W", 100)) == 5


class TestFmtSqliteBarsWeeklyGuard:
    def test_drops_non_friday_weekly_rows(self):
        rows = [
            (20201005, 14.77, 16.5, 14.0, 16.47, 4625920),   # Monday — stale key
            (20201009, 14.77, 16.5, 14.0, 16.47, 4625920),   # Friday — canonical
            (20201012, 16.72, 17.0, 16.0, 16.47, 2922610),   # Monday — stale key
            (20201016, 16.72, 17.0, 16.0, 16.47, 2922610),   # Friday — canonical
        ]
        out = _fmt_sqlite_bars(rows, "W")
        assert [b["t"] for b in out] == ["2020-10-09", "2020-10-16"]

    def test_daily_rows_unaffected_by_guard(self):
        rows = [
            (20260629, 10.0, 11.0, 9.5, 10.5, 1000),  # Monday daily — legit
            (20260630, 10.5, 12.0, 10.0, 11.0, 2000),
        ]
        out = _fmt_sqlite_bars(rows, "D")
        assert len(out) == 2

    def test_monthly_rows_unaffected_by_guard(self):
        rows = [(20260601, 10.0, 11.0, 9.5, 10.5, 1000)]  # 1st of month — legit
        out = _fmt_sqlite_bars(rows, "M")
        assert len(out) == 1
