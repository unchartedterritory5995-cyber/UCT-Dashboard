"""The last two daily-bar readers apply the listing-break rule (`api.services.listing_break`).

The store keeps a recycled or renamed symbol's earlier security in front of its own
bars. The rating window and the screener build already read the current listing only;
these are the two readers that did not: the script-scan engine's `_read_bars` and the RS
evidence job's ticker loop.
"""
from __future__ import annotations

from datetime import date, timedelta

from api.services import bars_sqlite, listing_break
from api.services.rs_evidence import job as ev_job
from api.services.screener import scan_evaluator


def _ymd(d: date) -> int:
    return int(d.strftime("%Y%m%d"))


def _recycled_rows():
    """40 bars of a $10 fund, 200 calendar days of nothing, then 30 bars of a $140 stock."""
    rows, d = [], date(2025, 1, 2)
    for i in range(40):
        rows.append((_ymd(d + timedelta(days=i)), 10.0, 10.2, 9.8, 10.0 + i * 0.01, 1000))
    start = d + timedelta(days=40 + 200)
    for i in range(30):
        rows.append((_ymd(start + timedelta(days=i)), 140.0, 141.0, 139.0, 140.0 + i * 0.1, 5000))
    return rows, _ymd(start)


def _continuous_rows():
    d = date(2025, 1, 2)
    return [(_ymd(d + timedelta(days=i)), 50.0, 51.0, 49.0, 50.0 + i * 0.05, 2000) for i in range(70)]


def test_the_script_scan_reads_the_current_listing_only(monkeypatch):
    rows, start = _recycled_rows()
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda sym, tf, want: rows)
    bars = scan_evaluator._read_bars("X", scan_evaluator.DEFAULT_TF, 400)
    assert len(bars) == 30 and bars[0]["t"] == start
    assert min(b["c"] for b in bars) >= 140.0, "no bar of the earlier security"


def test_the_script_scan_hands_a_continuous_series_on_whole(monkeypatch):
    rows = _continuous_rows()
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda sym, tf, want: rows)
    bars = scan_evaluator._read_bars("X", scan_evaluator.DEFAULT_TF, 400)
    assert [b["t"] for b in bars] == [r[0] for r in rows]


def test_the_script_scan_leaves_every_other_timeframe_as_stored(monkeypatch):
    """Only the daily store carries the YYYYMMDD keys the rule reads. An intraday series
    with the same numbers in it is handed on untouched, and the rule is never asked."""
    rows, _ = _recycled_rows()
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda sym, tf, want: rows)

    def never(_bars):
        raise AssertionError("the listing rule was applied to a non-daily series")

    monkeypatch.setattr(listing_break, "current_listing", never)
    for tf in ("5", "30", "60", "W"):
        assert len(scan_evaluator._read_bars("X", tf, 400)) == len(rows)


def test_the_evidence_job_measures_the_current_listing_only(monkeypatch):
    rows, start = _recycled_rows()
    seen = {}

    def columns(bars, bench_bars, signals):
        seen["ts"] = [b["t"] for b in bars]
        return {}

    monkeypatch.setattr(ev_job, "compute_signal_columns", columns)
    monkeypatch.setattr(ev_job, "benchmark_aligned", lambda bars, bench: ([None] * len(bars), [None] * len(bars)))
    monkeypatch.setattr(ev_job, "rows_for_ticker", lambda *a, **k: [])
    stats = ev_job.collect(["X"], lambda t, n, to_key: rows, asof_ymd=20261231, depth=400, bench_bars=[],
                           wanted={}, signals={}, horizons=(5,), sink=lambda t, r: None, log_every=0)
    assert stats["tickers"] == 1
    assert len(seen["ts"]) == 30 and seen["ts"][0] == start


def test_the_evidence_job_keeps_a_continuous_series_whole(monkeypatch):
    rows = _continuous_rows()
    seen = {}
    monkeypatch.setattr(ev_job, "compute_signal_columns",
                        lambda bars, bench, signals: seen.setdefault("n", len(bars)) and {})
    monkeypatch.setattr(ev_job, "benchmark_aligned", lambda bars, bench: ([None] * len(bars), [None] * len(bars)))
    monkeypatch.setattr(ev_job, "rows_for_ticker", lambda *a, **k: [])
    ev_job.collect(["X"], lambda t, n, to_key: rows, asof_ymd=20261231, depth=400, bench_bars=[],
                   wanted={}, signals={}, horizons=(5,), sink=lambda t, r: None, log_every=0)
    assert seen["n"] == len(rows)
