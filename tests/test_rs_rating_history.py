"""Rails for ``api/services/screener/rs_history.py`` (UCT RS Phase 2a, unit 2a-03).

Plan §7 items 17-20 pin the arithmetic; map §2.1/§2.2 pin the placement and the
population rule. Everything here runs against a ``screener.db`` in ``tmp_path``
(``SCREENER_DB_PATH``), injected bar readers and an injected session clock: no
network, no real ``DATA_DIR``, no ``bars.db``.
"""
from __future__ import annotations

import ast
import os
import pathlib
import sqlite3
from datetime import date, datetime, timedelta

import pytest

from api.services.screener import rs_history as rh
from api.services.screener import snapshot_db

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE = ROOT / "api" / "services" / "screener" / "rs_history.py"


# ───────────────────────── fixtures and synthetic series ─────────────────────

@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    """Point ``snapshot_db.connect()`` at a fresh file for one test."""
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    assert snapshot_db.get_db_path() == str(path)
    return path


def _ramp(anchors, step):
    """Linear path through ``anchors`` with ``step`` bars between neighbours; every
    anchor lands exactly, so the term reads are exact and no one-bar ratio is large."""
    out = []
    for a, b in zip(anchors, anchors[1:]):
        for k in range(step):
            out.append(a + (b - a) * k / step)
    out.append(float(anchors[-1]))
    return out


def _flat_then(bump_pct, n=253):
    """``n`` closes at 100 with the LAST one at ``100 * (1 + bump_pct/100)``: every
    quarter ratio equals ``1 + bump_pct/100`` so the score is exactly that number."""
    return [100.0] * (n - 1) + [100.0 * (1.0 + bump_pct / 100.0)]


def _weekdays_ending(end: date, n: int) -> list:
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return sorted(out)


def _ymd(d: date) -> int:
    return int(d.strftime("%Y%m%d"))


def make_reader(series: dict, end: date):
    """A ``bars_reader(ticker, n, to_key)`` over per-ticker close lists laid on the
    weekdays ending at ``end`` (newest close on ``end``), the ``get_bars_before``
    contract: rows ``(ts, o, h, l, c, v)`` with ``ts <= to_key``, newest ``n``, oldest first."""
    rows_by_ticker = {}
    for t, closes in series.items():
        days = _weekdays_ending(end, len(closes))
        rows_by_ticker[t.upper()] = [(_ymd(d), c, c, c, c, 1000) for d, c in zip(days, closes)]

    def reader(ticker, n, to_key):
        rows = [r for r in rows_by_ticker.get(ticker.upper(), []) if r[0] <= int(to_key)]
        return rows[-int(n):]
    return reader


def _query(path, sql, params=()):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


# ───────────────────────── the formula (plan §7 item 17) ─────────────────────

def test_formula_arithmetic_for_one_ticker():
    """C=200, C-63=100, C-126=160, C-189=80, C-252=50:
    0.40*2.0 + 0.20*1.25 + 0.20*2.5 + 0.20*4.0 = 0.8 + 0.25 + 0.5 + 0.8 = 2.35."""
    closes = _ramp([50, 80, 160, 100, 200], 63)
    assert len(closes) == 253
    assert (closes[-1], closes[-64], closes[-127], closes[-190], closes[-253]) == (200, 100, 160, 80, 50)
    assert rh.ibd_score(closes) == pytest.approx(2.35)
    out = rh.compute_ratings({"AAA": closes}, set())
    assert out["AAA"]["score"] == pytest.approx(2.35)
    assert out["AAA"]["bars"] == 253
    assert out["AAA"]["ibd"] == 99, "the only ranked name is the top of its own distribution"


def test_a_missing_term_is_dropped_and_the_weights_renormalised():
    """190 closes: the 252-bar term is absent. (0.4*2.0 + 0.2*1.25 + 0.2*2.5) / 0.8 = 1.9375
    - NOT 1.55 (the missing term treated as zero) and NOT 1.95 (treated as flat, ratio 1)."""
    closes = _ramp([80, 160, 100, 200], 63)
    assert len(closes) == 190
    assert rh.ibd_score(closes) == pytest.approx(1.9375)
    assert rh.ibd_score(closes) != pytest.approx(1.55)
    assert rh.ibd_score(closes) != pytest.approx(0.4 * 2.0 + 0.2 * 1.25 + 0.2 * 2.5 + 0.2 * 1.0)


def test_the_63_day_term_is_required():
    assert rh.ibd_score([100.0] * 63) is None, "63 closes cannot reach C-63"
    assert rh.ibd_score([100.0] * 64) is not None
    out = rh.compute_ratings({"SHORT": [100.0] * 40, "LONG": _flat_then(5)}, set())
    assert out["SHORT"]["ibd"] is None and out["SHORT"]["score"] is None
    assert out["SHORT"]["bars"] == 40, "short history is counted, not confused with the split guard"
    assert out["SHORT"]["m1"] is not None, "the 21-bar component still exists on 40 closes"
    assert out["LONG"]["ibd"] == 99


def test_the_weights_are_the_plan_table():
    assert rh.IBD_TERMS == (("q1", 63, 0.40), ("q2", 126, 0.20), ("q3", 189, 0.20), ("q4", 252, 0.20))
    assert sum(w for _l, _n, w in rh.IBD_TERMS) == pytest.approx(1.0)
    assert rh.REQUIRED_TERM == "q1"
    assert rh.COMPONENTS == (("m1", 21), ("m3", 63), ("m6", 126), ("m12", 252))


# ───────────────────────── percentiles ───────────────────────────────────────

def test_percentile_edges_are_1_and_99():
    universe = {f"S{i:03d}": _flat_then((i + 1) / 10.0) for i in range(100)}
    out = rh.compute_ratings(universe, set())
    assert out["S000"]["ibd"] == 1, "pct 1/100 -> ceil(0.99) = 1"
    assert out["S099"]["ibd"] == 99, "pct 1.0 -> ceil(99) = 99"
    assert out["S049"]["ibd"] == 50, "rank 50 of 100 -> ceil(49.5) = 50"
    assert all(1 <= r["ibd"] <= 99 for r in out.values())
    assert rh.rating_from_pct(1.0) == 99 and rh.rating_from_pct(0.0) == 1


def test_ties_share_the_average_rank():
    bumps = [1, 2, 3, 3, 5, 6, 7, 8, 9, 10]
    out = rh.compute_ratings({f"T{i}": _flat_then(b / 10.0) for i, b in enumerate(bumps)}, set())
    assert out["T2"]["score"] == out["T3"]["score"]
    assert out["T2"]["ibd"] == out["T3"]["ibd"] == 35, "positions 3 and 4 -> avg 3.5 / 10 -> ceil(34.65)"
    assert out["T0"]["ibd"] == 10 and out["T9"]["ibd"] == 99
    assert rh.percentile_ranks({"a": 1, "b": 2, "c": 2}) == {"a": 1 / 3, "b": 2.5 / 3, "c": 2.5 / 3}


def test_etfs_are_rated_by_interpolation_but_never_ranked():
    stocks = {f"S{i:03d}": _flat_then((i + 1) / 10.0) for i in range(100)}
    without = rh.compute_ratings(stocks, set())
    etfs = {"SPY": _flat_then(5.05), "HIGH": _flat_then(50.0), "LOW": _flat_then(0.05)}
    with_etfs = rh.compute_ratings({**stocks, **etfs}, {"SPY", "HIGH", "LOW"})
    for t in stocks:
        assert with_etfs[t]["ibd"] == without[t]["ibd"], f"{t} moved because an ETF joined"
        for col in ("m1", "m3", "m6", "m12"):
            assert with_etfs[t][col] == without[t][col]
    assert with_etfs["SPY"]["ibd"] == 50, "score between S049 (pct .50) and S050 (pct .51) -> pct .505 -> 50"
    assert with_etfs["HIGH"]["ibd"] == 99, "above every stock -> the top percentile"
    assert with_etfs["LOW"]["ibd"] == 1, "below every stock -> the bottom percentile"
    assert with_etfs["SPY"]["score"] == pytest.approx(1.0505)


def test_an_etf_alone_has_no_distribution_to_read():
    out = rh.compute_ratings({"SPY": _flat_then(5)}, {"SPY"})
    assert out["SPY"]["ibd"] is None and out["SPY"]["score"] == pytest.approx(1.05)


def test_interpolation_lands_an_equal_score_on_the_stock_percentile():
    dist = [(1.0, 0.25), (2.0, 0.5), (3.0, 0.75), (4.0, 1.0)]
    assert rh.interpolate_pct(2.0, dist) == 0.5
    assert rh.interpolate_pct(2.5, dist) == pytest.approx(0.625)
    assert rh.interpolate_pct(0.5, dist) == 0.25 and rh.interpolate_pct(9.0, dist) == 1.0
    assert rh.interpolate_pct(1.0, []) is None


def test_components_are_percentiles_of_the_plain_returns():
    """A ran a quarter ago and sat flat (high score, zero 1-month return); B jumped on
    the last bar (modest score, the best 1-month return); C barely moved."""
    a = [100.0] * 231 + [150.0] * 22
    b = [100.0] * 252 + [110.0]
    c = [100.0] * 252 + [101.0]
    out = rh.compute_ratings({"A": a, "B": b, "C": c}, set())
    assert out["A"]["ibd"] > out["B"]["ibd"] > out["C"]["ibd"]
    assert out["B"]["m1"] > out["C"]["m1"] > out["A"]["m1"]
    assert (out["A"]["ibd"], out["B"]["ibd"], out["C"]["ibd"]) == (99, 66, 33)
    assert (out["B"]["m1"], out["C"]["m1"], out["A"]["m1"]) == (99, 66, 33)
    assert rh.plain_returns(b)["m1"] == pytest.approx(10.0)
    assert rh.plain_returns(b)["m12"] == pytest.approx(10.0)
    assert rh.plain_returns([100.0] * 30)["m3"] is None


# ───────────────────────── the split guard ───────────────────────────────────

def test_split_guard_skips_a_straddled_split_and_writes_no_row(tmp_db):
    straddle = [100.0] * 200 + [25.0] * 53            # an unadjusted 4:1 inside the window
    clean = _flat_then(5)
    out = rh.compute_ratings({"SPLT": straddle, "OK": clean}, set())
    assert out["SPLT"] == {"ibd": None, "m1": None, "m3": None, "m6": None, "m12": None,
                           "score": None, "bars": 0, "reason": "unadjusted_split"}
    assert out["OK"]["ibd"] == 99, "the skipped name never enters the distribution"
    assert rh.store_rows("2026-11-05", out) == 1
    rows = _query(tmp_db, f"SELECT ticker FROM {rh.TABLE}")
    assert [r["ticker"] for r in rows] == ["OK"]


def test_split_guard_threshold_is_the_constant():
    assert rh.SPLIT_GUARD_PCT == 60.0
    assert rh.split_suspect([100.0] * 10 + [25.0] * 5)            # 4:1 forward: ratio 0.25
    assert rh.split_suspect([100.0] * 10 + [33.0] * 5)            # 3:1 forward: ratio 0.33
    assert rh.split_suspect([10.0] * 10 + [20.0] * 5)             # 1:2 reverse: ratio 2.0
    assert not rh.split_suspect([100.0] * 10 + [50.0] * 5), "a 2:1 (-50%) passes at 60; stated in the docstring"
    assert rh.split_suspect([100.0] * 10 + [50.0] * 5, pct=40.0), "tightening the constant catches it"
    assert not rh.split_suspect([100.0, 0.0, 100.0]), "a zero close is not a ratio"


# ───────────────────────── sessions and windows ──────────────────────────────

def test_session_key_accepts_every_shape_the_store_meets():
    assert rh.session_key(date(2026, 11, 5)) == "2026-11-05"
    assert rh.session_key(datetime(2026, 11, 5, 3, 0)) == "2026-11-05"
    assert rh.session_key("2026-11-05") == "2026-11-05"
    assert rh.session_key("20261105") == "2026-11-05"
    assert rh.session_key(20261105) == "2026-11-05"
    assert rh.session_ymd("2026-11-05") == 20261105


def test_window_at_slices_point_in_time_and_refuses_a_lagging_name():
    days = _weekdays_ending(date(2026, 11, 5), 300)
    ts = [_ymd(d) for d in days]
    closes = [float(i) for i in range(300)]
    win = rh.window_at(ts, closes, 20261105)
    assert len(win) == rh.READ_BARS and win[-1] == 299.0
    earlier = rh.window_at(ts, closes, _ymd(days[-3]))
    assert earlier[-1] == 297.0, "the window ends at the session asked for, not the newest bar"
    assert rh.window_at(ts, closes, 20261120) is None, "15 days behind the session: stale, not rated"
    assert rh.window_at(ts, closes, 20261109) is not None, "4 calendar days (a weekend) is within the lag"
    assert rh.window_at(ts, closes, 20200101) is None


def test_closes_from_rows_reads_the_bars_store_projection():
    rows = [(20261103, 1, 2, 0.5, 10.0, 7), (20261104, 1, 2, 0.5, None, 7),
            (20261105, 1, 2, 0.5, 0.0, 7), (20261106, 1, 2, 0.5, "12.5", 7)]
    assert rh.closes_from_rows(rows) == ([20261103, 20261106], [10.0, 12.5])
    assert rh.closes_from_rows(None) == ([], [])


def test_trading_sessions_ending_uses_the_exchange_calendar():
    got = rh.trading_sessions_ending(date(2026, 11, 8), 4)          # a Sunday
    assert got == [date(2026, 11, 3), date(2026, 11, 4), date(2026, 11, 5), date(2026, 11, 6)]


# ───────────────────────── the nightly ───────────────────────────────────────

def _universe_series():
    return {"AAA": _flat_then(8), "BBB": _flat_then(6), "CCC": _flat_then(4),
            "DDD": _flat_then(2), "EEE": _flat_then(1), "SPY": _flat_then(5)}


def test_nightly_job_is_idempotent_for_one_session(tmp_db):
    end = date(2026, 11, 5)
    reader = make_reader(_universe_series(), end)
    fast = {"AAA": {"ticker": "AAA", "rs_rank": 77}, "BBB": 55}
    r1 = rh.nightly_job(end, universe=["AAA", "BBB", "CCC", "DDD", "EEE"], etf_tickers={"SPY"},
                        bars_reader=reader, fast_map=fast)
    assert r1["ok"] is True and r1["session"] == "2026-11-05"
    assert (r1["universe"], r1["targets"], r1["excluded_etfs"]) == (5, 6, 1)
    assert r1["rated"] == 6 and r1["rows"] == 6 and r1["short_history"] == 0
    assert r1["fast_filled"] == 2 and r1["note"]["etfs_rated"] == 1
    assert r1["backfill"]["present"] is False

    rows = {r["ticker"]: r for r in _query(tmp_db, f"SELECT * FROM {rh.TABLE}")}
    assert len(rows) == 6
    assert rows["AAA"]["ibd"] == 99 and rows["AAA"]["fast"] == 77
    assert rows["BBB"]["fast"] == 55 and rows["CCC"]["fast"] is None
    assert rows["EEE"]["ibd"] == 20, "rank 1 of 5 -> pct .2 -> ceil(19.8)"
    assert rows["SPY"]["ibd"] == 70, "score 1.05 sits between CCC (1.04, pct .6) and BBB (1.06, pct .8) -> .7 -> ceil(69.3)"
    assert all(r["session"] == "2026-11-05" for r in rows.values())

    r2 = rh.nightly_job(end, universe=["AAA", "BBB", "CCC", "DDD", "EEE"], etf_tickers={"SPY"},
                        bars_reader=reader, fast_map=fast)
    assert r2["ok"] and r2["rows"] == 6
    assert _query(tmp_db, f"SELECT COUNT(*) AS n FROM {rh.TABLE}")[0]["n"] == 6, "INSERT OR REPLACE: same rows"
    assert _query(tmp_db, f"SELECT COUNT(*) AS n FROM {rh.RUNS_TABLE}")[0]["n"] == 2, "a receipt per run"


def test_nightly_job_counts_stale_and_missing_names_instead_of_rating_them(tmp_db):
    end = date(2026, 11, 5)
    series = {"AAA": _flat_then(8), "BBB": _flat_then(6), "OLD": _flat_then(9)}
    fresh = make_reader({k: v for k, v in series.items() if k != "OLD"}, end)
    stale = make_reader({"OLD": series["OLD"]}, end - timedelta(days=10))

    def reader(t, n, to_key):
        return stale(t, n, to_key) if t == "OLD" else fresh(t, n, to_key)

    r = rh.nightly_job(end, universe=["AAA", "BBB", "OLD", "NONE"], etf_tickers=set(),
                       bars_reader=reader, fast_map={})
    assert r["ok"] and r["rated"] == 2 and r["rows"] == 2
    assert r["stale"] == 1 and r["no_bars"] == 1 and r["fast_filled"] == 0
    tickers = {x["ticker"] for x in _query(tmp_db, f"SELECT ticker FROM {rh.TABLE}")}
    assert tickers == {"AAA", "BBB"}


def test_nightly_job_never_raises_and_still_leaves_a_receipt(tmp_db):
    reader = make_reader({"AAA": _flat_then(5)}, date(2026, 11, 5))
    r = rh.nightly_job(date(2026, 11, 5), universe=["AAA"], etf_tickers=set(),
                       bars_reader=reader, fast_map=object())      # no .get -> AttributeError inside
    assert r["ok"] is False
    assert "AttributeError" in r["note"]["error"]
    last = rh.last_run()
    assert last is not None and last["session"] == "2026-11-05"
    assert "AttributeError" in last["note"]["error"]


def test_nightly_job_resolves_the_session_from_the_injected_clock(tmp_db):
    reader = make_reader({"AAA": _flat_then(5), "BBB": _flat_then(3)}, date(2026, 11, 5))
    r = rh.nightly_job(universe=["AAA", "BBB"], etf_tickers=set(), bars_reader=reader, fast_map={},
                       session_fn=lambda now: date(2026, 11, 5))
    assert r["ok"] and r["session"] == "2026-11-05"
    none = rh.nightly_job(universe=["AAA"], etf_tickers=set(), bars_reader=reader, fast_map={},
                          session_fn=lambda now: None)
    assert none["ok"] is False and none["note"]["reason"] == "no_session"


def test_the_default_clock_is_the_screener_builds_settled_session(tmp_db):
    """03:00 ET on Friday 2026-11-06 rates Thursday 2026-11-05 - the build's own clock."""
    from api.services.session_calendar import ET
    reader = make_reader({"AAA": _flat_then(5), "BBB": _flat_then(3)}, date(2026, 11, 5))
    r = rh.nightly_job(universe=["AAA", "BBB"], etf_tickers=set(), bars_reader=reader, fast_map={},
                       now=datetime(2026, 11, 6, 3, 0, tzinfo=ET))
    assert r["ok"] and r["session"] == "2026-11-05"


# ───────────────────────── reads ─────────────────────────────────────────────

def _seed_history(n_sessions=21):
    keys = [f"2026-01-{d:02d}" for d in range(1, n_sessions + 1)]
    for k, key in enumerate(keys):
        ratings = {"AAA": {"ibd": 50 + k, "m1": 1, "m3": 2, "m6": 3, "m12": 4, "score": 1.1, "bars": 253}}
        if k == len(keys) - 1:
            ratings["BBB"] = {"ibd": 10, "m1": 1, "m3": 2, "m6": 3, "m12": None, "score": 1.0, "bars": 200}
        rh.store_rows(key, ratings, {"AAA": 61} if k == len(keys) - 1 else None)
    return keys


def test_read_fields_d5_d20_and_asof(tmp_db, monkeypatch):
    monkeypatch.setattr(rh, "settled_session", lambda now=None: date(2026, 1, 21))
    keys = _seed_history()
    failures = {}
    out = rh.read_fields(["aaa", "BBB", "ZZZ"], failures=failures)
    assert out["AAA"] == {"ibd": 70, "fast": 61, "m1": 1, "m3": 2, "m6": 3, "m12": 4, "score": 1.1,
                          "bars": 253, "d5": 5, "d20": 20, "asof": keys[-1]}
    assert out["BBB"]["ibd"] == 10 and out["BBB"]["d5"] is None and out["BBB"]["d20"] is None
    assert out["BBB"]["m12"] is None and out["BBB"]["asof"] == keys[-1]
    assert out["ZZZ"] == {}, "no row -> an empty dict, never a fabricated None row"
    assert failures == {}, "fresh and present: nothing to note"


def test_read_fields_for_an_earlier_session_uses_that_sessions_history(tmp_db, monkeypatch):
    monkeypatch.setattr(rh, "settled_session", lambda now=None: date(2026, 1, 21))
    _seed_history()
    out = rh.read_fields(["AAA"], session="2026-01-10")
    assert out["AAA"]["ibd"] == 59 and out["AAA"]["d5"] == 5 and out["AAA"]["d20"] is None
    assert out["AAA"]["asof"] == "2026-01-10"
    failures = {}
    assert rh.read_fields(["AAA"], session="2025-12-31", failures=failures) == {}
    assert failures == {"rs_history": {"missing": 1}}, "a session with no rows is missing, not the nearest one"


def test_read_fields_notes_missing_and_stale(tmp_db, monkeypatch):
    failures = {}
    assert rh.read_fields(["AAA"], failures=failures) == {}
    assert failures == {"rs_history": {"missing": 1}}
    assert rh.read_fields([], failures=failures) == {}
    monkeypatch.setattr(rh, "settled_session", lambda now=None: date(2026, 1, 30))
    _seed_history()
    failures = {}
    out = rh.read_fields(["AAA"], failures=failures)
    assert out["AAA"]["ibd"] == 70, "stale is served"
    assert failures == {"rs_history": {"stale:9d": 1}}


def test_ticker_history_reads_newest_first(tmp_db):
    keys = _seed_history(3)
    hist = rh.ticker_history("AAA", limit=2)
    assert [h["session"] for h in hist] == [keys[2], keys[1]]
    assert hist[0]["ibd"] == 52
    assert rh.ticker_history("ZZZ") == []


# ───────────────────────── the backfill ──────────────────────────────────────

def _backfill_series():
    base = [100.0] * 297
    return {"AAA": base + [105.0, 105.0, 103.0], "BBB": base + [101.0, 101.0, 104.0]}


def test_backfill_is_point_in_time_keeps_nightly_rows_and_writes_the_marker_once(tmp_db, tmp_path):
    end = date(2026, 11, 5)
    reader = make_reader(_backfill_series(), end)
    sessions = [date(2026, 11, 3), date(2026, 11, 4), end]
    # the nightly already wrote AAA for the newest session, with a fast rating
    rh.store_rows(end, {"AAA": {"ibd": 50, "m1": 1, "m3": 1, "m6": 1, "m12": 1, "score": 1.03, "bars": 270}},
                  {"AAA": 77})
    r = rh.backfill(days=3, universe=["AAA", "BBB"], etf_tickers=set(), bars_reader=reader,
                    sessions=sessions, data_dir=str(tmp_path))
    assert r["ok"] is True and r["session"] == "2026-11-05"
    assert r["note"]["sessions"] == 3 and r["note"]["sessions_rated"] == 3
    assert r["note"]["survivorship_corrected"] is False and r["note"]["point_in_time"] is True
    assert r["note"]["marker_written"] is True
    assert r["rows"] == 5, "3 sessions x 2 names, minus the nightly's AAA row that was kept"

    rows = {(x["session"], x["ticker"]): x for x in _query(tmp_db, f"SELECT * FROM {rh.TABLE}")}
    assert rows[("2026-11-03", "AAA")]["ibd"] == 99 and rows[("2026-11-03", "BBB")]["ibd"] == 50
    assert rows[("2026-11-04", "AAA")]["ibd"] == 99
    assert rows[("2026-11-05", "BBB")]["ibd"] == 99, "on the newest session BBB leads"
    assert rows[("2026-11-05", "AAA")]["fast"] == 77, "INSERT OR IGNORE kept the nightly's row"
    assert rows[("2026-11-03", "AAA")]["fast"] is None, "the fast rating has no history"

    marker = tmp_path / rh.BACKFILL_MARKER
    assert marker.exists() and "survivorship_corrected=False" in marker.read_text()
    again = rh.backfill(days=3, universe=["AAA", "BBB"], etf_tickers=set(), bars_reader=reader,
                        sessions=sessions, data_dir=str(tmp_path))
    assert again == {"ok": True, "skipped": True, "reason": "marker_present", "marker": str(marker)}
    assert _query(tmp_db, f"SELECT COUNT(*) AS n FROM {rh.RUNS_TABLE}")[0]["n"] == 1, "a skip writes no receipt"


def test_backfill_marker_is_not_written_on_failure(tmp_db, tmp_path):
    r = rh.backfill(days=3, universe=["AAA"], etf_tickers=set(), bars_reader=lambda t, n, k: [],
                    sessions=[date(2026, 11, 3), date(2026, 11, 4), date(2026, 11, 5)], data_dir=str(tmp_path))
    assert r["ok"] is False and r["note"]["reason"] == "too_few_sessions_rated"
    assert not (tmp_path / rh.BACKFILL_MARKER).exists()
    assert rh.last_run()["note"]["survivorship_corrected"] is False


def test_backfill_resolves_its_sessions_from_the_calendar_and_the_marker_sits_beside_the_db(tmp_db):
    reader = make_reader(_backfill_series(), date(2026, 11, 5))
    r = rh.backfill(days=3, universe=["AAA", "BBB"], etf_tickers=set(), bars_reader=reader,
                    session_fn=lambda now: date(2026, 11, 5))
    assert r["ok"] and r["note"]["sessions"] == 3
    sessions = [x["session"] for x in _query(tmp_db, f"SELECT DISTINCT session FROM {rh.TABLE} ORDER BY session")]
    assert sessions == ["2026-11-03", "2026-11-04", "2026-11-05"]
    assert r["marker"] == os.path.join(os.path.dirname(str(tmp_db)), rh.BACKFILL_MARKER)
    assert os.path.exists(r["marker"])
    assert rh.status()["backfill"]["present"] is True


# ───────────────────────── status and schema ─────────────────────────────────

def test_status_shape_on_an_empty_store_and_after_a_run(tmp_db):
    empty = rh.status()
    assert empty == {"table": rh.TABLE, "rows": 0, "sessions": 0, "latest_session": None, "last_run": None,
                     "backfill": {"path": os.path.join(os.path.dirname(str(tmp_db)), rh.BACKFILL_MARKER),
                                  "present": False, "content": None}}
    reader = make_reader(_universe_series(), date(2026, 11, 5))
    rh.nightly_job(date(2026, 11, 4), universe=["AAA", "BBB"], etf_tickers=set(), bars_reader=reader, fast_map={})
    rh.nightly_job(date(2026, 11, 5), universe=["AAA", "BBB"], etf_tickers=set(), bars_reader=reader, fast_map={})
    st = rh.status()
    assert (st["rows"], st["sessions"], st["latest_session"]) == (4, 2, "2026-11-05")
    assert st["last_run"]["session"] == "2026-11-05" and st["last_run"]["rated"] == 2
    assert st["last_run"]["note"]["source"] == "nightly" and st["last_run"]["duration_ms"] >= 0
    assert set(st["last_run"]) >= {"id", "session", "started_at", "finished_at", "universe", "rated",
                                   "excluded_etfs", "short_history", "duration_ms", "note"}


def test_ensure_schema_is_idempotent_and_the_table_is_the_declared_one(tmp_db):
    with snapshot_db.connect() as conn:
        rh.ensure_schema(conn)
        rh.ensure_schema(conn)
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({rh.TABLE})")]
        pk = [r[1] for r in conn.execute(f"PRAGMA table_info({rh.TABLE})") if r[5]]
    assert cols == ["session", "ticker", "ibd", "fast", "m1", "m3", "m6", "m12", "score", "bars"]
    assert set(pk) == {"session", "ticker"}


def test_receipts_are_trimmed_to_runs_keep(tmp_db):
    for i in range(rh.RUNS_KEEP + 5):
        rh.record_run({"session": f"s{i}", "note": {"i": i}})
    assert _query(tmp_db, f"SELECT COUNT(*) AS n FROM {rh.RUNS_TABLE}")[0]["n"] == rh.RUNS_KEEP
    assert rh.last_run()["session"] == f"s{rh.RUNS_KEEP + 4}"


# ───────────────────────── the rules this unit was given ─────────────────────

def test_the_module_reads_no_environment_variable():
    """The registrar (2a-04) gates the job; this module must not read a flag or a
    path from the environment. AST, not grep: the docstring says the words."""
    tree = ast.parse(MODULE.read_text(encoding="utf-8"))
    hits = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and node.attr in ("environ", "getenv"):
            hits.append(node.lineno)
        if isinstance(node, ast.Call):
            fn = node.func
            name = fn.attr if isinstance(fn, ast.Attribute) else (fn.id if isinstance(fn, ast.Name) else None)
            if name in ("getenv", "environ"):
                hits.append(node.lineno)
    assert hits == [], f"environment reads at lines {hits}"


def test_fast_map_accepts_the_cached_rank_map_shape_and_bare_ints():
    assert rh._fast_for({"AAA": {"ticker": "AAA", "rs_score": 1.2, "rs_rank": 88}}, "AAA") == 88
    assert rh._fast_for({"AAA": 12}, "AAA") == 12
    assert rh._fast_for({"AAA": {"rs_rank": None}}, "AAA") is None
    assert rh._fast_for({}, "AAA") is None and rh._fast_for(None, "AAA") is None
