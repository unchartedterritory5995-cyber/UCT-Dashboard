"""TERM-042 parity (2026-10-11): SPY/QQQ's MA flags are computed on the SAME price basis as
the universe frame they accompany.

Measured on production: with `BREADTH_DIVIDEND_BASIS=1` the universe frame was put on the
collector's dividend-adjusted basis while the SPY series feeding `spy_above_*sma` stayed raw.
SPY went ex $1.89 on 2026-09-18; on 09-29 the raw 20-day mean sat above the close and the
adjusted one (the collector's `auto_adjust` series) below it, so the server row said
`spy_above_20sma = 0` against the collector's 1 (and `spy_above_50sma` the same on 09-30).
An "exact" metric failed twice in sixteen sessions on a basis mismatch, not on data.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services import breadth_dividends as bdiv
from api.services import breadth_live as bl

#: 25 sessions; 6 of the last 19 before the target sit before a $2 ex-date.
_DATES = [20260801 + i for i in range(25)]
_EX = _DATES[12]
_CLOSES = [100.0] * 12 + [99.0] * 13
_TODAY = 99.0          # raw 20-day mean 99.3 > 99.0; adjusted 98.7 < 99.0


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, c REAL)")
    c.executemany("INSERT INTO ohlcv VALUES ('SPY','D',?,?)", zip(_DATES, _CLOSES))
    yield c
    c.close()


@pytest.fixture
def spy_dividend(monkeypatch):
    monkeypatch.setattr(bdiv, "_load", lambda tickers, lo, hi: (
        {"SPY": [(_EX, 2.0)]} if "SPY" in {t.upper() for t in tickers} else {}))


def test_the_default_series_is_RAW(conn, spy_dividend):
    s = bl._load_index_series(conn, _DATES[-1], _DATES[0])
    assert s["SPY"] == _CLOSES
    assert s["QQQ"] == []


def test_the_adjusted_series_scales_only_the_bars_before_the_ex_date(conn, spy_dividend):
    s = bl._load_index_series(conn, _DATES[-1], _DATES[0], dividend_basis=True)["SPY"]
    assert s[:12] == pytest.approx([98.0] * 12)      # 1 - 2/100
    assert s[12:] == pytest.approx([99.0] * 13)
    assert s[-1] == _CLOSES[-1], "the last bar stays RAW, as the universe frame's does"


def test_the_basis_decides_the_flag_the_collector_reports(conn, spy_dividend):
    """The production case in miniature: raw says below the 20-day, adjusted says above."""
    raw = bl.build_index_levels(bl._load_index_series(conn, _DATES[-1], _DATES[0]))
    adj = bl.build_index_levels(bl._load_index_series(conn, _DATES[-1], _DATES[0],
                                                      dividend_basis=True))
    assert bl.compute_index_metrics(raw, {"SPY": _TODAY})["spy_above_20sma"] == 0
    assert bl.compute_index_metrics(adj, {"SPY": _TODAY})["spy_above_20sma"] == 1


def test_an_explicit_False_and_an_off_flag_both_stay_raw(conn, spy_dividend, monkeypatch):
    monkeypatch.setenv("BREADTH_DIVIDEND_BASIS", "0")
    assert bl._load_index_series(conn, _DATES[-1], _DATES[0], dividend_basis=False)["SPY"] \
        == _CLOSES
    assert bl._load_index_series(conn, _DATES[-1], _DATES[0], dividend_basis=None)["SPY"] \
        == _CLOSES, "None follows the flag, and the flag is off"
    monkeypatch.setenv("BREADTH_DIVIDEND_BASIS", "1")
    assert bl._load_index_series(conn, _DATES[-1], _DATES[0],
                                 dividend_basis=None)["SPY"][0] == pytest.approx(98.0)


class _Stop(Exception):
    pass


class _Conn:
    def execute(self, *_a):
        class _R:
            def fetchone(self):
                return (20260930,)
        return _R()


@pytest.mark.parametrize("arg,expected", [(None, None), (True, True), (False, False)])
def test_metrics_at_close_hands_the_frames_basis_to_the_index_series(monkeypatch, arg,
                                                                      expected):
    """The EOD row, `reconcile` and the parity run all go through `_metrics_at_close`; the
    index read must receive the same basis argument the frame did."""
    seen = {}
    monkeypatch.setattr(bl, "_session_dates", lambda conn, a, b: list(range(240)))
    monkeypatch.setattr(bl, "_load_frame", lambda conn, t, d: (None, None))
    monkeypatch.setattr(bl, "_apply_dividend_basis", lambda t, d, c, m, *a: c)
    monkeypatch.setattr(bl, "build_levels", lambda *a, **k: {})

    def _record(conn, end, start, **kw):
        seen.update(kw)
        raise _Stop

    monkeypatch.setattr(bl, "_load_index_series", _record)
    with pytest.raises(_Stop):
        bl._metrics_at_close(_Conn(), ["AAA"], 20261001, dividend_basis=arg)
    assert seen["dividend_basis"] is expected
    assert seen["measured_ts"] == 20261001
