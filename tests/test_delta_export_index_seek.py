"""The delta must be cheap to build and must carry the date-keyed bars.

2026-11-09: seven of the eight per-timeframe delta queries filtered on `tf`
alone, which cannot use the (ticker, tf, ts) key, so one delta read the 40 GB
table seven times and took about two hours. The boot purge read it once more
before the uploader could start. A master merge restarts the worker more often
than that, so nothing shipped.

The same queries compared `D`/`W`/`M` keys (YYYYMMDD, about 2e7) with a
unix-seconds cutoff (about 1.8e9), so no delta ever held a daily, weekly or
monthly bar.
"""
import sqlite3

import pytest

from api.services import bars_sqlite, data_sync

NOW = 1_794_240_000  # 2026-11-09 11:00 ET
DAILY_CUT = 20261030  # NOW minus 10 days
SLOW_CUT = 20260925  # NOW minus 45 days
RECENT_5M = NOW - 3600


def _seed(path, rows):
    c = sqlite3.connect(path)
    c.execute(
        "CREATE TABLE IF NOT EXISTS ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, "
        "ts INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v INTEGER, "
        "PRIMARY KEY (ticker, tf, ts))"
    )
    c.executemany(
        "INSERT OR REPLACE INTO ohlcv VALUES (?,?,?,1,1,1,1,1)", rows
    )
    c.commit()
    c.close()


def _export(tmp_path, monkeypatch, rows):
    _seed(str(tmp_path / "bars.db"), rows)
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(tmp_path))
    out = str(tmp_path / "delta.db")
    n = data_sync._export_delta_db(out, now=NOW)
    c = sqlite3.connect(out)
    got = set(c.execute("SELECT ticker,tf,ts FROM ohlcv").fetchall())
    c.close()
    assert n == len(got)
    return got


class _PlanSpy:
    """Records the query plan of every SELECT run on the wrapped connection."""

    def __init__(self, real, plans):
        self._real = real
        self._plans = plans

    def execute(self, sql, *args):
        if sql.lstrip().upper().startswith("SELECT"):
            for row in self._real.execute("EXPLAIN QUERY PLAN " + sql, *args):
                self._plans.append(row[3])
        return self._real.execute(sql, *args)

    def __getattr__(self, name):
        return getattr(self._real, name)


def _assert_no_scan(plans):
    assert plans, "the spy saw no SELECT, so this check proved nothing"
    scans = [p for p in plans if p.upper().startswith("SCAN")]
    assert not scans, f"a query walks the whole table or index: {scans}"


@pytest.mark.parametrize(
    "tf,key,included",
    [
        ("D", 20261106, True),
        ("D", DAILY_CUT, True),
        ("D", DAILY_CUT - 1, False),
        ("W", 20261106, True),
        ("W", SLOW_CUT, True),
        ("W", SLOW_CUT - 1, False),
        ("M", 20261001, True),
        ("M", 20260901, False),
    ],
)
def test_date_keyed_bars_use_a_date_cutoff(tmp_path, monkeypatch, tf, key, included):
    got = _export(tmp_path, monkeypatch, [("AAPL", tf, key)])
    assert (("AAPL", tf, key) in got) is included


def test_a_unix_seconds_key_on_a_date_timeframe_is_not_shipped(tmp_path, monkeypatch):
    assert _export(tmp_path, monkeypatch, [("AAPL", "D", NOW - 3600)]) == set()


def test_intraday_window_is_still_unix_seconds(tmp_path, monkeypatch):
    inside = NOW - 6 * 86400
    outside = NOW - 8 * 86400
    got = _export(
        tmp_path, monkeypatch, [("AAPL", "5", inside), ("AAPL", "5", outside)]
    )
    assert got == {("AAPL", "5", inside)}


def test_every_ticker_is_exported(tmp_path, monkeypatch):
    tickers = ["A", "AA", "BRK.B", "MSFT", "ZZZZ"]
    got = _export(tmp_path, monkeypatch, [(t, "5", RECENT_5M) for t in tickers])
    assert got == {(t, "5", RECENT_5M) for t in tickers}


def test_export_never_scans_the_table(tmp_path, monkeypatch):
    _seed(
        str(tmp_path / "bars.db"),
        [("AAPL", "5", RECENT_5M), ("AAPL", "D", 20261106), ("MSFT", "W", 20261106)],
    )
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(tmp_path))
    plans = []
    real_connect = sqlite3.connect

    def spying_connect(target, *args, **kwargs):
        conn = real_connect(target, *args, **kwargs)
        return _PlanSpy(conn, plans) if "mode=ro" in str(target) else conn

    monkeypatch.setattr(data_sync.sqlite3, "connect", spying_connect)
    assert data_sync._export_delta_db(str(tmp_path / "d.db"), now=NOW) == 3
    _assert_no_scan(plans)


def test_iter_tickers_handles_an_empty_table(tmp_path):
    path = str(tmp_path / "bars.db")
    _seed(path, [])
    c = sqlite3.connect(path)
    assert list(bars_sqlite.iter_tickers(c)) == []
    c.close()


def test_iter_tickers_returns_each_ticker_once_in_order(tmp_path):
    path = str(tmp_path / "bars.db")
    _seed(
        path,
        [("MSFT", "D", 20261106), ("AAPL", "D", 20261106), ("AAPL", "5", RECENT_5M)],
    )
    c = sqlite3.connect(path)
    assert list(bars_sqlite.iter_tickers(c)) == ["AAPL", "MSFT"]
    c.close()


def test_date_cutoff_is_the_et_calendar_day():
    # 2026-10-31 02:00 UTC is still 2026-10-30 in New York.
    assert data_sync._delta_cutoffs(now=1_794_276_000)["D"] == 20261030


def test_a_daily_bar_reaches_the_web_through_a_delta(tmp_path, monkeypatch):
    from tests.api.test_delta_snapshot import _FakeS3

    fake = _FakeS3()
    monkeypatch.setattr(data_sync, "_client", lambda: fake)
    monkeypatch.setattr(data_sync, "_bucket", lambda: "b")
    worker = tmp_path / "worker"
    worker.mkdir()
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(worker))
    _seed(str(worker / "bars.db"), [("AAPL", "D", 20261106)])
    delta_ts = data_sync.upload_delta(now=NOW)
    assert delta_ts == str(NOW)

    web = tmp_path / "web"
    web.mkdir()
    _seed(str(web / "bars.db"), [("AAPL", "D", 20261105)])
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(web))
    assert data_sync.apply_delta(delta_ts)
    c = sqlite3.connect(str(web / "bars.db"))
    got = c.execute("SELECT ts FROM ohlcv WHERE tf='D' ORDER BY ts").fetchall()
    c.close()
    assert got == [(20261105,), (20261106,)]


@pytest.fixture
def fresh_bars(tmp_path, monkeypatch):
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    yield
    bars_sqlite.bump_db_epoch()


def _put_weekly(ticker, iso_dates):
    bars_sqlite.put_bars(
        ticker,
        "W",
        [{"t": d, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1} for d in iso_dates],
        date_tf=True,
    )


def test_weekly_purge_never_scans_the_table(fresh_bars, monkeypatch):
    _put_weekly("MSTR", ["2020-10-05", "2020-10-09"])
    plans = []
    real = bars_sqlite._conn()
    monkeypatch.setattr(bars_sqlite, "_conn", lambda: _PlanSpy(real, plans))
    assert bars_sqlite.purge_mis_keyed_weekly_rows() == 1
    _assert_no_scan(plans)


def test_weekly_purge_reaches_every_ticker(fresh_bars):
    _put_weekly("AAPL", ["2020-10-05", "2020-10-09"])
    _put_weekly("ZZZZ", ["2020-10-12", "2020-10-16"])
    assert bars_sqlite.purge_mis_keyed_weekly_rows() == 2
    assert [r[0] for r in bars_sqlite.get_bars("AAPL", "W", 10)] == [20201009]
    assert [r[0] for r in bars_sqlite.get_bars("ZZZZ", "W", 10)] == [20201016]


def test_weekly_purge_removes_a_malformed_key(fresh_bars):
    conn = bars_sqlite._conn()
    conn.execute(
        "INSERT INTO ohlcv VALUES ('AAPL','W',1751457600,1,1,1,1,1)"
    )
    conn.commit()
    assert bars_sqlite.purge_mis_keyed_weekly_rows() == 1
