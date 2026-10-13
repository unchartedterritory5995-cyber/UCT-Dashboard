"""A cold Breadth read must not hand thousands of rows back to Python.

2026-10-13: cold Monitor reads took 35-128 s on web while the same read took
0.1-0.45 s in a separate process on the same pod. Each row a sqlite cursor
returns to Python costs a GIL hand-off, and with CPU-bound threads running each
hand-off waits out the switch interval (reproduced locally: 4,700 rows took 9 ms
idle, 15-20 s beside three busy threads, 4.2 ms a row). The reconstructed fetch
measured ~7 ms a row on web. Three reads fetched whole histories to use a little
of them:

* `distinct_dates()`: 4,725 rows, uncached in `next_trading_day` (route_tail 6-16 s);
* the 20/150-SMA overlay: 2 x 4,723 rows to fill ~200 dates (the reader residual);
* the deep cumulative-A/D seed: ~4,400 rows to compute one sum (adv_seed 12.8-16.9 s).

These rails pin that each now fetches only what it uses, and answers exactly what
the old read answered.
"""
from __future__ import annotations

import pytest

from api.services import breadth_daily_ohlc as ohlc
from api.services import breadth_monitor as bm
from api.services import breadth_sentiment_history as sent


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(bm, "_db_path", lambda: str(tmp_path / "monitor.db"))
    monkeypatch.setattr(ohlc, "_db_path", lambda: str(tmp_path / "ohlc.db"))
    monkeypatch.setattr(sent, "_db_path", lambda: str(tmp_path / "sent.db"))
    monkeypatch.setattr(ohlc, "_INIT_DONE", False)
    monkeypatch.setattr(sent, "_INIT_DONE", False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    class _NoCache:
        def get(self, *_a, **_k):
            return None

        def set(self, *_a, **_k):
            pass

        def delete_prefix(self, *_a, **_k):
            pass

    import api.services.cache as cache_mod
    monkeypatch.setattr(cache_mod, "cache", _NoCache())
    bm.init_db()
    ohlc._ensure_init()
    yield tmp_path


# ── a row counter on the OHLC store's connections ─────────────────────────────

class _Rows:
    n = 0


class _Cur:
    def __init__(self, cur):
        self._cur = cur

    def fetchall(self):
        out = self._cur.fetchall()
        _Rows.n += len(out)
        return out

    def fetchone(self):
        out = self._cur.fetchone()
        _Rows.n += out is not None
        return out

    def __iter__(self):
        for r in self._cur:
            _Rows.n += 1
            yield r


class _Conn:
    def __init__(self, conn):
        self._conn = conn

    def execute(self, *a, **k):
        return _Cur(self._conn.execute(*a, **k))

    def __enter__(self):
        self._conn.__enter__()
        return self

    def __exit__(self, *exc):
        return self._conn.__exit__(*exc)

    def __getattr__(self, name):
        return getattr(self._conn, name)


@pytest.fixture
def counted(monkeypatch):
    real = ohlc._conn
    monkeypatch.setattr(ohlc, "_conn", lambda: _Conn(real()))
    _Rows.n = 0
    return _Rows


# ── seeds ─────────────────────────────────────────────────────────────────────

def _sessions(n, start=(2010, 1, 4)):
    import datetime as dt
    d, out = dt.date(*start), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


DEEP = _sessions(600)


def _seed_recon(dates):
    rows = []
    for i, d in enumerate(dates):
        ad = float((i * 37) % 900 - 450)                   # whole numbers, as stored
        rows += [(d, "adv_decline", ad, ad, ad, ad),
                 (d, "pct_above_20sma", 40 + i * 0.013, 0, 0, 40 + i * 0.013),
                 (d, "pct_above_150sma", 55 - i * 0.007, 0, 0, 55 - i * 0.007)]
    ohlc.write_bulk(rows, source="close_recon")


def _old_distinct_dates():
    with ohlc._conn() as c:
        return [r[0] for r in c.execute(
            "SELECT date FROM breadth_reconstructed_daily ORDER BY date ASC").fetchall()]


def _old_seed(oldest):
    coll = {}
    with bm._conn() as c:
        for (d, v) in bm._adv_decline_rows(c, "<", oldest):
            if v is not None:
                coll[d] = v
    merged = {**ohlc.metric_before("adv_decline", oldest), **coll}
    return sum(v for v in merged.values() if v is not None)


# ── distinct_dates ────────────────────────────────────────────────────────────

def test_distinct_dates_answers_the_old_list_from_one_row(counted):
    _seed_recon(DEEP)
    old = _old_distinct_dates()
    counted.n = 0
    new = ohlc.distinct_dates()
    assert new == old == sorted(DEEP)
    assert counted.n <= 1, f"{counted.n} rows fetched for one list"


def test_distinct_dates_still_falls_back_to_the_scan_on_an_empty_table(counted):
    _seed_recon(DEEP[:5])
    with ohlc._conn() as c:
        c.execute("DELETE FROM breadth_reconstructed_daily")
        c.commit()
    assert ohlc.distinct_dates() == ohlc.distinct_dates_by_scan() == DEEP[:5]


def test_next_trading_day_reads_one_row_not_the_whole_timeline(counted):
    _seed_recon(DEEP)
    counted.n = 0
    assert bm.next_trading_day(DEEP[100]) == DEEP[101]
    assert counted.n <= 2, f"{counted.n} rows fetched to find one date"


# ── the 20/150-SMA overlay ────────────────────────────────────────────────────

def test_history_stored_since_is_the_unbounded_read_cut_at_the_date():
    _seed_recon(DEEP)
    for k in ("pct_above_20sma", "pct_above_150sma"):
        full = ohlc._history_stored(k, limit=8000)
        cut = ohlc._history_stored(k, limit=8000, since=DEEP[450])
        assert cut == {d: v for d, v in full.items() if d >= DEEP[450]}
        assert list(cut) == [d for d in full if d >= DEEP[450]], "order kept (newest first)"


def test_history_stored_since_never_reaches_past_the_limit():
    _seed_recon(DEEP)
    full = ohlc._history_stored("pct_above_20sma", limit=50)
    cut = ohlc._history_stored("pct_above_20sma", limit=50, since=DEEP[0])
    assert cut == full and len(cut) == 50


def test_the_ma_overlay_fills_the_same_values_from_window_rows_only(counted):
    _seed_recon(DEEP)
    window = DEEP[-150:]
    rows_old = [{"date": d} for d in window]
    rows_new = [{"date": d} for d in window]
    for k in bm._EXTRA_MA:                                  # the old fill, by hand
        hist = ohlc._history_stored(k, limit=8000)
        for r in rows_old:
            r[k] = (hist.get(r["date"]) or {}).get("c")
    counted.n = 0
    bm._apply_extra_ma(rows_new)
    assert rows_new == rows_old
    assert counted.n <= 2 * len(window), f"{counted.n} rows fetched for {len(window)} dates"


# ── the deep cumulative-A/D seed ──────────────────────────────────────────────

def test_the_deep_seed_equals_the_merged_sum_with_the_collector_winning(counted):
    _seed_recon(DEEP)
    # collector rows overlap the reconstructed tail: they must win on those dates,
    # and a collector date with no adv_decline must leave the reconstructed value in.
    for i, d in enumerate(DEEP[500:540]):
        m = {"adv_decline": 10_000 + i, "up_4pct_today": i}
        if i == 3:
            m.pop("adv_decline")
        bm.store_snapshot(d, m)
    for oldest in (DEEP[0], DEEP[1], DEEP[300], DEEP[510], DEEP[539], DEEP[599]):
        expected = _old_seed(oldest)
        counted.n = 0
        got = bm._adv_decline_seed_before(oldest)
        assert got == expected, oldest
        assert type(got) is type(expected), oldest
        assert counted.n <= 2, f"{counted.n} reconstructed rows fetched for one sum"


def test_the_deep_seed_falls_back_when_the_exclusion_list_is_too_long(monkeypatch):
    _seed_recon(DEEP)
    monkeypatch.setattr(ohlc, "metric_sum_before", lambda *a, **k: None)
    assert bm._adv_decline_seed_before(DEEP[400]) == _old_seed(DEEP[400])


def test_a_deep_window_reads_the_same_rows_as_before():
    _seed_recon(DEEP)
    for i, d in enumerate(DEEP[560:]):
        bm.store_snapshot(d, {"adv_decline": 100 + i, "pct_above_50sma": 50.0})
    rows = bm.get_history_deep(120, end=DEEP[580], anchor="le")
    assert rows and rows[0]["date"] == DEEP[580]
    assert {"pct_above_20sma", "pct_above_150sma"} <= set(rows[-1])
