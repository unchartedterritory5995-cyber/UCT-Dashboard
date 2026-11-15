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

@pytest.fixture(autouse=True)
def provider(monkeypatch):
    """No test here reaches the corporate-action provider. The default split-list
    reader's fetch is this stub (it refuses unless a test loads an answer into
    ``answers``), and its brake is a local no-op, so nothing shared is touched."""
    from api.services import declared_splits as ds
    state = {"answers": {}, "asked": []}

    def fetch(ticker):
        state["asked"].append(ticker)
        if ticker in state["answers"]:
            return {"ipo": None, "splits": state["answers"][ticker]}
        raise RuntimeError("no provider in tests")
    monkeypatch.setattr(ds, "_default_fetch", fetch)
    monkeypatch.setattr(ds, "_default_gate", lambda: (lambda: True, lambda: 0.0, lambda: None))
    monkeypatch.setattr(ds, "_default_cache_get", lambda t: None)
    monkeypatch.setattr(ds, "_default_cache_set", lambda t, meta: None)
    monkeypatch.setattr(ds, "FETCH_PAUSE_S", 0)
    return state


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
    end = date(2026, 11, 5)
    days = _weekdays_ending(end, 253)
    ts = [_ymd(d) for d in days]
    straddle = [100.0] * 200 + [25.0] * 53            # an unadjusted 4:1 inside the window
    clean = _flat_then(5)
    declared = [(days[200].isoformat(), 4.0)]
    marked = {t for t, c in (("SPLT", straddle), ("OK", clean))
              if rh.window_split_suspect(ts, c, declared if t == "SPLT" else [])}
    assert marked == {"SPLT"}, "the one detector marks the declared, still-unadjusted split"
    out = rh.compute_ratings({"SPLT": straddle, "OK": clean}, set(), suspects=marked)
    # Pin moved 2026-11-14 (RS screens U1): the five values behind the ranks, None with them.
    assert out["SPLT"] == {"ibd": None, "m1": None, "m3": None, "m6": None, "m9": None, "m12": None,
                           "v1": None, "v3": None, "v6": None, "v9": None, "v12": None,
                           "score": None, "bars": 0, "reason": "unadjusted_split"}
    assert out["OK"]["ibd"] == 99, "the skipped name never enters the distribution"
    assert rh.store_rows("2026-11-05", out) == 1
    rows = _query(tmp_db, f"SELECT ticker FROM {rh.TABLE}")
    assert [r["ticker"] for r in rows] == ["OK"]


def test_a_two_for_one_split_is_caught_and_a_real_fifty_percent_day_is_rated(tmp_db):
    """N4's two cases, both of which the +/-60 % threshold got wrong: a declared,
    unadjusted 2:1 split (-50 % on the closes) is left unrated and counted, and a
    real -50 % biotech day with nothing declared is rated."""
    end = date(2026, 11, 5)
    days = _weekdays_ending(end, 270)
    series = {"SPLIT2": [100.0] * 220 + [50.0] * 50, "BIO": [100.0] * 220 + [50.0] * 50,
              "OK": [100.0] * 270}
    declared = {"SPLIT2": [(days[220].isoformat(), 2.0)], "BIO": [], "OK": []}
    r = rh.nightly_job(end, universe=list(series), etf_tickers=set(),
                       bars_reader=make_reader(series, end), fast_map={},
                       splits_reader=lambda t: declared.get(t))
    assert r["ok"] and r["split_guard"] == 1 and r["note"]["counts"]["split_guard"] == 1
    assert {x["ticker"] for x in _query(tmp_db, f"SELECT ticker FROM {rh.TABLE}")} == {"BIO", "OK"}


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


def _recycled_ticker(old_bars=200, new_bars=150, gap_days=104, end=date(2026, 11, 12)):
    """A symbol's two lives in one store: ``old_bars`` closes near 10 from an earlier
    security, a ``gap_days`` calendar break, then ``new_bars`` closes near 150 from the
    stock that carries the symbol now (BNY on production, 2026-11-12: a fund at $10
    until February, the bank at $139 from May)."""
    new_days = _weekdays_ending(end, new_bars)
    old_days = _weekdays_ending(new_days[0] - timedelta(days=gap_days), old_bars)
    ts = [_ymd(d) for d in old_days + new_days]
    closes = [10.0 + 0.001 * i for i in range(old_bars)] + [140.0 + 0.05 * i for i in range(new_bars)]
    return ts, closes


def test_the_window_stops_at_a_break_in_the_listing():
    ts, closes = _recycled_ticker()
    win = rh.window_at(ts, closes, 20261112)
    assert len(win) == 150, "only the closes after the break belong to this stock"
    assert min(win) >= 140.0, "no close from the earlier security under the same symbol"
    assert rh._window_bounds(ts, 20261112, closes) == (200, 350)


def test_a_recycled_symbol_is_not_rated_on_the_earlier_securitys_closes():
    ts, closes = _recycled_ticker()
    steady = [100.0 + 0.2 * i for i in range(270)]
    ratings = rh.compute_ratings({"BNY": rh.window_at(ts, closes, 20261112), "OLD": steady, "MID": steady[:269] + [140.0]}, set())
    row = ratings["BNY"]
    assert row["bars"] == 150
    assert row["m9"] is None and row["m12"] is None, "150 bars cover neither the 9M nor the 12M window"
    assert row["score"] < 1.2, "scored on its own 63- and 126-bar ratios, not on 150 / 10"
    unguarded = rh.ibd_score(closes[-rh.READ_BARS:])
    assert unguarded > 5.0, "the reading the guard exists to refuse (a fifteen-fold 'gain')"


def test_a_short_hole_in_the_bars_does_not_cut_the_window():
    days = _weekdays_ending(date(2026, 11, 12), 300)
    hole = [d for d in days if not (date(2026, 8, 8) <= d <= date(2026, 8, 23))]
    ts = [_ymd(d) for d in hole]
    closes = [float(i) for i in range(len(ts))]
    longest = max((b - a).days for a, b in zip(hole, hole[1:]))
    assert rh.MAX_BAR_LAG_DAYS < longest < rh.LISTING_GAP_DAYS, "a 17-day hole, the BSP case"
    assert len(rh.window_at(ts, closes, 20261112)) == rh.READ_BARS


def test_a_session_before_the_break_reads_the_earlier_listing_whole():
    ts, closes = _recycled_ticker()
    last_old = ts[199]
    win = rh.window_at(ts, closes, last_old)
    assert len(win) == 200 and max(win) < 11.0, "point in time: that session saw one continuous listing"


def _two_runs(gap_days, old_close, new_close, old_bars=200, new_bars=150, end=date(2026, 11, 12)):
    new_days = _weekdays_ending(end, new_bars)
    old_days = _weekdays_ending(new_days[0] - timedelta(days=gap_days), old_bars)
    ts = [_ymd(d) for d in old_days + new_days]
    return ts, [float(old_close)] * old_bars + [float(new_close)] * new_bars


def test_a_long_halt_of_the_same_company_keeps_its_history():
    ts, closes = _two_runs(60, 50.0, 55.0)
    assert len(rh.window_at(ts, closes, 20261112)) == rh.READ_BARS, "two months dark at a similar price: one company"
    ts, closes = _two_runs(60, 50.0, 190.0)
    assert len(rh.window_at(ts, closes, 20261112)) == rh.READ_BARS, "under four-fold: not a new listing on the gap alone"


def test_a_gap_with_a_fourfold_price_jump_either_way_is_a_new_listing():
    for old, new in ((10.0, 40.0), (200.0, 50.0)):
        ts, closes = _two_runs(30, old, new)
        assert len(rh.window_at(ts, closes, 20261112)) == 150, (old, new)
    ts, closes = _two_runs(14, 10.0, 150.0)
    widest = max((date(b // 10000, b // 100 % 100, b % 100) - date(a // 10000, a // 100 % 100, a % 100)).days
                 for a, b in zip(ts, ts[1:]))
    assert 10 < widest < rh.LISTING_GAP_DAYS
    assert len(rh.window_at(ts, closes, 20261112)) == rh.READ_BARS, "under 21 days is never a listing break"


def test_a_very_long_gap_is_a_new_listing_whatever_the_price():
    ts, closes = _two_runs(rh.LISTING_GAP_STANDALONE_DAYS + 5, 50.0, 55.0)
    assert len(rh.window_at(ts, closes, 20261112)) == 150


def test_a_dead_reference_close_never_cuts_or_raises():
    ts, closes = _two_runs(60, 0.0, 55.0)
    assert len(rh.window_at(ts, closes, 20261112)) == rh.READ_BARS


def test_the_ratings_listing_break_is_the_shared_one():
    from api.services import listing_break
    assert rh.LISTING_GAP_DAYS == listing_break.GAP_DAYS
    assert rh.LISTING_GAP_STANDALONE_DAYS == listing_break.GAP_STANDALONE_DAYS
    assert rh.LISTING_PRICE_FACTOR == listing_break.PRICE_FACTOR


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
    # Pin moved 2026-11-14 (RS screens U1): the row also carries v1..v12 (None: seeded without them).
    assert out["AAA"] == {"ibd": 70, "fast": 61, "m1": 1, "m3": 2, "m6": 3, "m9": None, "m12": 4, "score": 1.1,
                          "v1": None, "v3": None, "v6": None, "v9": None, "v12": None,
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


def test_backfill_is_point_in_time_skips_stored_sessions_and_is_idempotent(tmp_db, tmp_path):
    end = date(2026, 11, 5)
    reader = make_reader(_backfill_series(), end)
    sessions = [date(2026, 11, 3), date(2026, 11, 4), end]
    # the nightly already wrote the newest session, with a fast rating
    rh.store_rows(end, {"AAA": {"ibd": 50, "m1": 1, "m3": 1, "m6": 1, "m12": 1, "score": 1.03, "bars": 270}},
                  {"AAA": 77})
    r = rh.backfill(days=3, universe=["AAA", "BBB"], etf_tickers=set(), bars_reader=reader,
                    sessions=sessions, data_dir=str(tmp_path))
    assert r["ok"] is True and r["session"] == "2026-11-05"
    note = r["note"]
    assert (note["sessions"], note["sessions_stored"], note["sessions_todo"]) == (3, 1, 2)
    assert (note["sessions_written"], note["sessions_rated"], note["sessions_remaining"]) == (2, 2, 0)
    assert note["survivorship_corrected"] is False and note["point_in_time"] is True
    assert note["marker_written"] is True, "every requested session now holds rows"
    assert r["rows"] == 4, "2 missing sessions x 2 names; the nightly's session is never touched"

    rows = {(x["session"], x["ticker"]): x for x in _query(tmp_db, f"SELECT * FROM {rh.TABLE}")}
    assert rows[("2026-11-03", "AAA")]["ibd"] == 99 and rows[("2026-11-03", "BBB")]["ibd"] == 50
    assert rows[("2026-11-04", "AAA")]["ibd"] == 99
    assert rows[("2026-11-05", "AAA")]["fast"] == 77 and rows[("2026-11-05", "AAA")]["ibd"] == 50, \
        "the nightly's session keeps the nightly's rows"
    assert ("2026-11-05", "BBB") not in rows, "a stored session is skipped whole, not topped up"
    assert rows[("2026-11-03", "AAA")]["fast"] is None, "the fast rating has no history"

    marker = tmp_path / rh.BACKFILL_MARKER
    assert marker.exists() and "survivorship_corrected=False" in marker.read_text()
    before = _query(tmp_db, f"SELECT * FROM {rh.TABLE} ORDER BY session, ticker")
    again = rh.backfill(days=3, universe=["AAA", "BBB"], etf_tickers=set(), bars_reader=reader,
                        sessions=sessions, data_dir=str(tmp_path))
    assert again["ok"] is True and again["note"]["reason"] == "nothing_to_do" and again["rows"] == 0
    assert _query(tmp_db, f"SELECT * FROM {rh.TABLE} ORDER BY session, ticker") == before, "idempotent"


def test_backfill_is_bounded_and_resumes_newest_first(tmp_db, tmp_path):
    end = date(2026, 11, 5)
    reader = make_reader(_backfill_series(), end)
    sessions = [date(2026, 11, 3), date(2026, 11, 4), end]
    kw = dict(days=3, universe=["AAA", "BBB"], etf_tickers=set(), bars_reader=reader,
              sessions=sessions, data_dir=str(tmp_path))
    first = rh.backfill(max_sessions=2, **kw)
    assert first["ok"] and first["note"]["sessions_written"] == 2 and first["note"]["sessions_remaining"] == 1
    assert "marker_written" not in first["note"], "a bounded run that left a session is not done"
    stored = [x["session"] for x in _query(tmp_db, f"SELECT DISTINCT session FROM {rh.TABLE} ORDER BY session")]
    assert stored == ["2026-11-04", "2026-11-05"], "newest first: the chart's recent year fills first"
    second = rh.backfill(**kw)                                # the same command again finishes it
    assert second["ok"] and second["note"]["sessions_stored"] == 2 and second["note"]["sessions_written"] == 1
    assert second["note"]["sessions_remaining"] == 0 and second["note"]["marker_written"] is True


def test_backfill_dry_run_writes_nothing(tmp_db, tmp_path, provider):
    end = date(2026, 11, 5)
    reader = make_reader(_backfill_series(), end)
    provider["answers"]["AAA"] = []
    r = rh.backfill(days=3, universe=["AAA", "BBB"], etf_tickers=set(), bars_reader=reader,
                    sessions=[date(2026, 11, 3), date(2026, 11, 4), end], data_dir=str(tmp_path),
                    dry_run=True)
    assert r["ok"] is True and r["dry_run"] is True
    assert r["rows"] == 6 and r["note"]["sessions_todo"] == 3 and r["note"]["sessions_written"] == 0
    assert provider["asked"] == [], "a dry run makes no provider call by default"
    assert r["note"]["split_lists"]["budget"] == 0
    assert not os.path.exists(tmp_db), "no table, no receipt, no memo: the file is never even created"
    assert not (tmp_path / rh.BACKFILL_MARKER).exists()


def test_backfill_fetches_split_lists_without_a_limit_and_remembers_them(tmp_db, tmp_path, provider):
    end = date(2026, 11, 5)
    reader = make_reader(_backfill_series(), end)
    provider["answers"].update({"AAA": [], "BBB": []})
    r = rh.backfill(days=3, universe=["AAA", "BBB"], etf_tickers=set(), bars_reader=reader,
                    sessions=[date(2026, 11, 3), date(2026, 11, 4), end], data_dir=str(tmp_path))
    assert r["ok"] and sorted(provider["asked"]) == ["AAA", "BBB"]
    assert r["note"]["split_lists"]["fetched"] == 2 and r["note"]["split_lists"]["budget"] is None
    assert r["note"]["split_basis"] == {"declared": 2, "unknown": 0}
    from api.services import declared_splits as ds
    memo = _query(tmp_db, f"SELECT ticker FROM {ds.TABLE} ORDER BY ticker")
    assert [x["ticker"] for x in memo] == ["AAA", "BBB"], "the next nightly reads these, not the provider"


def test_backfill_refuses_a_depth_outside_its_bound(tmp_db):
    for days in (0, rh.BACKFILL_MAX_DAYS + 1):
        r = rh.backfill(days=days, universe=["AAA"], etf_tickers=set(), bars_reader=lambda t, n, k: [])
        assert r["ok"] is False and "days must be" in r["note"]["reason"]
    assert rh.BACKFILL_MAX_DAYS == 5 * rh.BACKFILL_DAYS
    assert not os.path.exists(tmp_db)


def test_the_backfill_command_line(tmp_db, monkeypatch, capsys):
    seen = {}

    def fake(days, **kw):
        seen.update(days=days, **kw)
        return {"ok": True, "dry_run": kw["dry_run"], "rated": 10, "split_guard": 0, "duration_ms": 1.0,
                "note": {"sessions": 252, "sessions_stored": 0, "sessions_todo": 252,
                         "sessions_written": 0, "sessions_remaining": 0}}
    monkeypatch.setattr(rh, "backfill", fake)
    assert rh.main(["--backfill-days", "252", "--dry-run"]) == 0
    assert seen == {"days": 252, "dry_run": True, "max_sessions": None, "split_fetch_budget": rh.AUTO_BUDGET}
    out = capsys.readouterr().out
    assert "(dry run)" in out and "would_write=252" in out and out.strip().splitlines()[-1].startswith("receipt {")
    assert rh.main(["--backfill-days", "252", "--max-sessions", "20", "--split-fetch-budget", "0"]) == 0
    assert seen["max_sessions"] == 20 and seen["split_fetch_budget"] == 0 and seen["dry_run"] is False
    assert rh.main(["--backfill-days", "0"]) == 2
    assert rh.main(["--backfill-days", str(rh.BACKFILL_MAX_DAYS + 1)]) == 2
    assert rh.main(["--backfill-days", "252", "--max-sessions", "0"]) == 2
    assert rh.main([]) == 2, "--backfill-days is required: the command never runs a default depth by accident"


def test_the_backfill_never_runs_on_import_or_on_a_schedule():
    """D2: a one-shot command. Nothing at module level calls it, the CLI runs only
    under ``__main__``, and no scheduler registration in api/main.py names it."""
    tree = ast.parse(MODULE.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            pytest.fail(f"a module-level call at line {node.lineno}")
        if isinstance(node, ast.If):
            test = ast.unparse(node.test)
            assert test == "__name__ == '__main__'", f"a module-level branch at line {node.lineno}: {test}"
    main_src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    for needle in ("rs_history.backfill", "rs_history.main", "backfill_days"):
        assert needle not in main_src, f"api/main.py names {needle}: the backfill is never scheduled"
    worker_src = (ROOT / "api" / "worker_main.py").read_text(encoding="utf-8")
    assert "rs_history" not in worker_src or "rs_history.backfill" not in worker_src


def test_backfill_marker_is_not_written_on_failure(tmp_db, tmp_path):
    r = rh.backfill(days=3, universe=["AAA"], etf_tickers=set(), bars_reader=lambda t, n, k: [],
                    sessions=[date(2026, 11, 3), date(2026, 11, 4), date(2026, 11, 5)], data_dir=str(tmp_path))
    assert r["ok"] is False and r["note"]["reason"] == "too_few_sessions_rated"
    assert not (tmp_path / rh.BACKFILL_MARKER).exists()
    assert rh.last_run()["note"]["survivorship_corrected"] is False


def test_the_nightly_receipt_says_where_each_split_list_came_from(tmp_db, provider):
    end = date(2026, 11, 5)
    provider["answers"]["AAA"] = []
    r = rh.nightly_job(end, universe=["AAA", "BBB"], etf_tickers=set(),
                       bars_reader=make_reader(_universe_series(), end), fast_map={})
    assert r["ok"] and r["rated"] == 2, "an unknown list is rated, not guessed at"
    assert r["note"]["split_basis"] == {"declared": 1, "unknown": 1}
    lists = r["note"]["split_lists"]
    assert (lists["fetched"], lists["fetch_failed"], lists["unknown"]) == (1, 1, 1)
    assert lists["budget"] == rh.default_splits_reader(None).budget
    again = rh.nightly_job(end, universe=["AAA", "BBB"], etf_tickers=set(),
                           bars_reader=make_reader(_universe_series(), end), fast_map={})
    assert again["note"]["split_lists"]["memo"] == 1, "the stored answer is read back, not re-asked"


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
    # `last_attempt` (2026-11-12): the 'started' row a killed run leaves behind; none yet.
    assert empty == {"table": rh.TABLE, "rows": 0, "sessions": 0, "latest_session": None, "last_run": None,
                     "last_attempt": None,
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
    # Pin moved 2026-11-14 (RS screens U1): five REAL value columns after m9.
    assert cols == ["session", "ticker", "ibd", "fast", "m1", "m3", "m6", "m12", "score", "bars", "m9",
                    "v1", "v3", "v6", "v9", "v12"]
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


def test_backfill_writes_nothing_while_too_many_split_lists_are_unknown(tmp_db, tmp_path, provider):
    """Review, 2026-11-07: a written session is never rewritten, so names rated
    without their split list would stay unguarded for good. The run refuses,
    says how many lists are unknown, and is simply run again later."""
    end = date(2026, 11, 5)
    base = [100.0] * 297
    names = [f"N{i}" for i in range(8)]
    reader = make_reader({n: base + [101.0 + i, 102.0, 103.0] for i, n in enumerate(names)}, end)
    r = rh.backfill(days=3, universe=names, etf_tickers=set(), bars_reader=reader,
                    sessions=[date(2026, 11, 3), date(2026, 11, 4), end], data_dir=str(tmp_path))
    assert r["ok"] is False and r["note"]["reason"] == "split_lists_unknown"
    assert r["note"]["split_lists_unknown"] == 8 and r["note"]["split_lists_unknown_allowed"] == 5
    assert r["rows"] == 0 and r["note"]["sessions_written"] == 0
    # answered, the same command writes the year
    provider["answers"].update({n: [] for n in names})
    again = rh.backfill(days=3, universe=names, etf_tickers=set(), bars_reader=reader,
                        sessions=[date(2026, 11, 3), date(2026, 11, 4), end], data_dir=str(tmp_path))
    assert again["ok"] and again["note"]["sessions_written"] == 3
