"""Rails for `api/services/rs_evidence/` - the Phase 2b (unit 2b-01) evidence job
(plan §9; research base 03-evidence.md §(b)/(c); engineering map §2.1, §3 row
2b-01).

Every rail states the clause it pins, and every statistic is hand-derived in
the test body (the `test_relative_strength_columns.py` style) so a module change
that moves a value is red here with the numbers in hand. No bars.db, no server,
no data directory: every run goes through a synthetic reader.
"""
from __future__ import annotations

import ast
import json
import math
import pathlib
import random
import sqlite3
from datetime import date, timedelta

import pytest

from api.services import relative_strength as rs
from api.services import rs_evidence as ev
from api.services.rs_evidence import job as J
from api.services.rs_evidence import store as S
from api.services.rs_evidence.__main__ import main

ROOT = pathlib.Path(__file__).resolve().parents[1]
PKG = ROOT / "api" / "services" / "rs_evidence"


@pytest.fixture(autouse=True)
def provider(monkeypatch):
    """No test here reaches the corporate-action provider. The split guard's
    default reader fetches through this stub (it refuses unless a test loads an
    answer into ``answers``), its brake is a local no-op and its cache is empty."""
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


# --------------------------------------------------------------------------- #
# synthetic bars and a reader in the `get_bars_before` shape
# --------------------------------------------------------------------------- #

def _weekdays(n: int, start: date = date(2020, 1, 2)) -> list:
    """``n`` weekday sessions from ``start`` as YYYYMMDD ints, oldest first."""
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d += timedelta(days=1)
    return out


def _bars(closes, ts):
    return [{"t": t, "o": c, "h": c, "l": c, "c": c, "v": 1} for t, c in zip(ts, closes)]


def _walk(seed: int, n: int, start: float = 100.0, drift: float = 0.0, vol: float = 0.01) -> list:
    rng = random.Random(seed)
    out, c = [], start
    for _ in range(n):
        c = c * (1.0 + drift + rng.gauss(0.0, vol))
        out.append(round(max(c, 1.0), 4))
    return out


def make_reader(series: dict, ts: list):
    """``bars_reader(ticker, n, to_key)``: rows ``(ts, o, h, l, c, v)`` with
    ``ts <= to_key``, newest ``n``, oldest first - the `rs_history` seam shape."""
    rows_by_ticker = {t.upper(): [(k, c, c, c, c, 1000) for k, c in zip(ts, closes)]
                      for t, closes in series.items()}

    def reader(ticker, n, to_key):
        rows = [r for r in rows_by_ticker.get(ticker.upper(), []) if r[0] <= int(to_key)]
        return rows[-int(n):]
    return reader


def _universe_500(seed: int = 7):
    ts = _weekdays(500)
    series = {
        "SPY": _walk(seed, 500, 300.0, drift=0.0003),
        "A": _walk(seed + 1, 500, 50.0, drift=0.0012),
        "B": _walk(seed + 2, 500, 80.0, drift=-0.0004),
        "C": _walk(seed + 3, 500, 20.0, drift=0.0005, vol=0.02),
    }
    return ts, series


def _query(path, sql, params=()):
    conn = sqlite3.connect(str(path))
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


class _Spy:
    def __init__(self, ok=True):
        self.calls = []
        self.ok = ok

    def __call__(self, key, data, content_type):
        self.calls.append((key, data, content_type))
        return self.ok


# --------------------------------------------------------------------------- #
# the statistics, hand-derived (research base §(c): median, mean, hit, N, dates)
# --------------------------------------------------------------------------- #

def test_measure_hand_derived_on_a_constructed_universe():
    """SPY flat at 100 (benchmark return 0, so excess = the stock's own return).
    A = 100 + 0.5 i (always up), B = 200 - 0.25 i (always down), C = 100 (flat);
    400 bars, each opening at its own close. Signal ``x`` placed by construction:
    A at 10, 50, 390; B at 100; C at 150.

    The base is the NEXT bar's open (N6, 2026-11-07), so excess = C[t+h] / O[t+1] - 1:
    h = 21:  A10  (100+0.5*31)/(100+0.5*11) - 1 = 115.5/105.5 - 1 = +9.479 %
             A50  135.5/125.5 - 1                              = +7.968 %
             B100 (200-0.25*121)/(200-0.25*101) - 1 = 169.75/174.75 - 1 = -2.861 %
             C150 0
             A390 390+21 >= 400 -> incomplete
             n = 4, incomplete = 1 (share 0.2), hit 2/4 = 0.5,
             median of [-2.861, 0, 7.968, 9.479] = 3.984, mean = 14.586/4 = 3.646
    (the signal-close base read +10 % / +8.4 % / -3 % here: the overnight step
    the member could not buy.) h = 63 and h = 126 follow the same formula.
    baseline h = 21: every bar i <= 378 of each ticker -> 3 x 379 = 1137 complete,
             3 x 21 = 63 incomplete; hits = A's 379 only -> 379/1137; the sorted
             values are 379 negatives, 379 zeros, 379 positives -> median 0.
    """
    ts = _weekdays(400)
    spy = _bars([100.0] * 400, ts)
    bars = {"A": _bars([100 + 0.5 * i for i in range(400)], ts),
            "B": _bars([200 - 0.25 * i for i in range(400)], ts),
            "C": _bars([100.0] * 400, ts)}

    def col(events):
        c = [0.0] * 400
        for i in events:
            c[i] = 1.0
        return c
    signals = {"A": {"x": col([10, 50, 390])}, "B": {"x": col([100])}, "C": {"x": col([150])}}

    out = ev.measure(signals, bars, spy)
    assert out["horizons"] == [21, 63, 126] and out["rows"] == 1200
    sig = out["per_signal"]["x"]
    assert (sig["n_signals"], sig["dates"], sig["tickers"]) == (5, 5, 3)

    def a(i):
        return 100 + 0.5 * i

    def b(i):
        return 200 - 0.25 * i
    expect = {}
    for h in (21, 63, 126):
        vals = sorted([(a(10 + h) / a(11) - 1) * 100, (a(50 + h) / a(51) - 1) * 100,
                       (b(100 + h) / b(101) - 1) * 100, 0.0])
        expect[str(h)] = ((vals[1] + vals[2]) / 2, sum(vals) / 4)
    assert expect["21"] == (pytest.approx(3.98406, abs=1e-4), pytest.approx(3.64639, abs=1e-4))
    for h, (med, mean) in expect.items():
        st = sig["horizons"][h]
        assert st["n"] == 4 and st["incomplete"] == 1
        assert st["incomplete_share"] == pytest.approx(0.2)
        assert st["hit_rate"] == pytest.approx(0.5)
        assert st["median_excess"] == pytest.approx(med)
        assert st["mean_excess"] == pytest.approx(mean)
    base = out["baseline"]["21"]
    assert base["n"] == 1137 and base["incomplete"] == 63
    assert base["hit_rate"] == pytest.approx(379 / 1137)
    assert base["median_excess"] == pytest.approx(0.0)
    assert base["mean_excess"] > 0, "A's gains outweigh B's losses in the mean, not the median"


def test_summarise_values_hand_derived_and_never_invents_a_value():
    st = ev.summarise_values([10.0, 8.4, -3.0, 0.0, None])
    assert st == {"n": 4, "incomplete": 1, "incomplete_share": pytest.approx(0.2), "hit_rate": pytest.approx(0.5),
                  "median_excess": pytest.approx(4.2), "mean_excess": pytest.approx(3.85)}
    assert ev.summarise_values([]) == {"n": 0, "incomplete": 0, "incomplete_share": None, "hit_rate": None,
                                       "median_excess": None, "mean_excess": None}
    only_open = ev.summarise_values([None, None])
    assert only_open["n"] == 0 and only_open["incomplete"] == 2 and only_open["incomplete_share"] == 1.0
    assert only_open["hit_rate"] is None and only_open["median_excess"] is None


def test_forward_excess_is_the_documented_formula_and_a_hit_is_strictly_positive():
    """N6 (2026-11-07): from the NEXT bar's open to the close h bars after the signal.
    Bar 0 closes at 100; bar 1 GAPS to open 105 and closes 110; bar 2 closes 121.
    The benchmark opens bar 1 at 52 and closes bar 2 at 55."""
    opens = [99.0, 105.0, 118.0]
    closes = [100.0, 110.0, 121.0]
    b_opens = [49.0, 52.0, 54.0]
    b_closes = [50.0, 55.0, 55.0]
    want = ((121 / 105 - 1) - (55 / 52 - 1)) * 100          # +15.24 % - 5.77 % = +9.47 %
    assert ev.forward_excess(opens, closes, b_opens, b_closes, 0, 2) == pytest.approx(want)
    old_base = ((121 / 100 - 1) - (55 / 50 - 1)) * 100      # +11 %: the signal-close base
    assert ev.forward_excess(opens, closes, b_opens, b_closes, 0, 2) != pytest.approx(old_base), \
        "the overnight gap the member could not buy is no longer counted"
    assert ev.forward_excess(opens, closes, b_opens, b_closes, 0, 1) == pytest.approx(
        ((110 / 105 - 1) - (55 / 52 - 1)) * 100), "h = 1 is the next session's open to its close"
    assert ev.forward_excess(opens, closes, b_opens, b_closes, 1, 2) is None, "runs past the series"
    assert ev.forward_excess(opens, [100.0, None, 121.0], b_opens, b_closes, 0, 2) == pytest.approx(want), \
        "a hole inside the window does not matter: only its two ends are read"
    assert ev.forward_excess([99.0, None, 118.0], closes, b_opens, b_closes, 0, 2) is None, \
        "no open at t+1 -> incomplete"
    assert ev.forward_excess(opens, [100.0, 110.0, None], b_opens, b_closes, 0, 2) is None, \
        "no close at the end -> incomplete"
    assert ev.forward_excess(opens, closes, [49.0, None, 54.0], b_closes, 0, 2) is None, \
        "no benchmark open at t+1 -> incomplete"
    assert ev.forward_excess(opens, closes, b_opens, [50.0, 55.0, None], 0, 2) is None, \
        "no benchmark close at the end -> incomplete"
    assert ev.forward_excess(opens, closes, b_opens, b_closes, 0, 0) is None
    assert ev.summarise_values([0.0])["hit_rate"] == 0.0, "zero excess is not a hit"


def test_the_benchmark_open_and_close_are_joined_by_bar_time():
    ts = _weekdays(4)
    bars = [{"t": ts[i], "o": 10.0, "c": 10.0} for i in (0, 1, 3)]          # the stock skips ts[2]
    bench = [{"t": t, "o": 100.0 + i, "c": 200.0 + i} for i, t in enumerate(ts)]
    opens, closes = ev.benchmark_aligned(bars, bench)
    assert opens == [100.0, 101.0, 103.0] and closes == [200.0, 201.0, 203.0]
    assert closes == rs.benchmark_closes_aligned(bars, bench), "the one join the RS line uses"


# --------------------------------------------------------------------------- #
# the split guard (N5, 2026-11-07)
# --------------------------------------------------------------------------- #

def test_a_row_whose_window_holds_an_unadjusted_split_is_not_counted():
    """A 2:1 split at bar 100 that was never adjusted. Rows at bar i with
    i + 1 < 100 <= i + 126 are left out; a boundary AT i + 1 is fine (the base
    open is already on the new scale), and the rows after it are measured."""
    ts = _weekdays(300)
    closes = [100.0] * 100 + [50.0] * 200
    bars = _bars(closes, ts)
    bench = [100.0] * 300
    splits = ev.split_indexes(bars, [ts[100]])
    assert splits == [100]
    rows = ev.rows_for_ticker("A", bars, bench, bench, {"x": [1.0] * 300}, splits=splits)
    by = {(r[0], r[1]): r[3] for r in rows}
    skipped = [i for i in range(300) if by[(ts[i], ev.BASELINE_KEY)] is None]
    assert skipped == list(range(0, 99)), "every bar from 0 to 98 has the split inside its window"
    assert by[(ts[99], ev.BASELINE_KEY)] is not None, "boundary at t+1: measured, base is post-split"
    assert by[(ts[99], ev.BASELINE_KEY)][0] == pytest.approx(0.0)
    assert all(by[(ts[i], "x")] is None for i in range(99)), "signal rows follow the same rule"
    out = ev.summarise(rows)
    assert out["split_skipped"] == {ev.BASELINE_KEY: 99, "x": 99}
    assert out["rows"] == 201 and out["per_signal"]["x"]["n_signals"] == 201
    assert out["baseline"]["21"]["median_excess"] == pytest.approx(0.0), \
        "without the guard the 2:1 split reads as a -50 % trade"
    unguarded = ev.summarise(ev.rows_for_ticker("A", bars, bench, bench, {"x": [1.0] * 300}))
    assert unguarded["baseline"]["21"]["mean_excess"] < -1.0 and unguarded["split_skipped"] == {}


def test_the_job_finds_split_boundaries_with_the_one_detector():
    ts = _weekdays(60)
    bars = _bars([100.0] * 30 + [25.0] * 30, ts)
    declared_at = J.ymd_to_iso(ts[28])                     # the provider's date can be off by days
    assert J.split_boundary_times(bars, [(declared_at, 4.0)]) == [ts[30]]
    assert J.split_boundary_times(_bars([25.0] * 60, ts), [(declared_at, 4.0)]) == [], "already adjusted"
    assert J.split_boundary_times(bars, []) == [] and J.split_boundary_times(bars, None) == [], \
        "nothing declared, or nothing known: nothing guessed"


def test_store_summary_agrees_with_the_in_memory_summary_on_the_same_rows(tmp_path):
    """ONE statistic, two row sources (measure.py header)."""
    rows = [
        (20200102, ev.BASELINE_KEY, "A", (1.0, -2.0, None)),
        (20200103, ev.BASELINE_KEY, "A", (0.5, None, None)),
        (20200102, ev.BASELINE_KEY, "B", (-1.0, 3.0, 4.0)),
        (20200102, "x", "A", (1.0, -2.0, None)),
        (20200103, "x", "A", (0.5, None, None)),
        (20200102, "y", "B", (-1.0, 3.0, 4.0)),
        (20200106, ev.BASELINE_KEY, "B", None),             # split-guarded: stored, never measured
        (20200106, "y", "B", None),
    ]
    mem = ev.summarise(rows)
    conn = S.open_store(str(tmp_path / "ev.db"))
    S.write_rows(conn, rows)
    conn.commit()
    got = S.summary(conn)
    assert S.window(conn)["to"] == 20200103, "a guarded row is not a measured session"
    conn.close()
    assert got == mem
    assert mem["rows"] == 3 and mem["per_signal"]["x"]["n_signals"] == 2
    assert mem["split_skipped"] == {ev.BASELINE_KEY: 1, "y": 1} and mem["per_signal"]["y"]["n_signals"] == 1
    # Pin moved 2026-11-07 (unit VA3): each horizon also counts the sessions with a
    # COMPLETE window there (x: 2 sessions with an event, 1 with a complete 63 window).
    assert mem["per_signal"]["x"]["horizons"]["63"] == {"n": 1, "incomplete": 1, "incomplete_share": 0.5,
                                                        "hit_rate": 0.0, "median_excess": -2.0, "mean_excess": -2.0,
                                                        "dates": 1}
    assert mem["per_signal"]["x"]["dates"] == 2 and mem["per_signal"]["x"]["horizons"]["21"]["dates"] == 2


# --------------------------------------------------------------------------- #
# the signals: five named columns, nothing re-implemented
# --------------------------------------------------------------------------- #

def test_signals_are_the_five_named_columns_of_relative_strength():
    assert set(ev.SIGNALS) == {"rs_new_high", "rs_new_high_before_price", "rs_new_high_red_day",
                               "rs_cross_up_21ema", "mansfield_cross_up"}
    want = {"rs_new_high": "rsNH", "rs_new_high_before_price": "rsNHbeforePx", "rs_new_high_red_day": "rsNHred",
            "rs_cross_up_21ema": "crossUp", "mansfield_cross_up": "mansfieldCrossUp"}
    for name, col in want.items():
        assert ev.SIGNALS[name]["column"] == col
        assert col in rs.PHASE1_COLUMNS or col in rs.PHASE2A_COLUMNS
        assert ev.SIGNALS[name]["definition"]
    assert ev.inputs_used() == {"lookback": 252, "maLength": 21, "maType": "EMA", "priceTolerance": 2.0,
                                "redDayThreshold": -0.5, "mansfieldLength": 200}


def test_signal_columns_are_exactly_the_compute_functions_output():
    ts, series = _universe_500()
    bars, bench = _bars(series["A"], ts), _bars(series["SPY"], ts)
    got = ev.compute_signal_columns(bars, bench)
    p1 = rs.compute_phase1_columns(bars, bench, None, short_history=False)
    p2 = rs.compute_mansfield_columns(bars, bench, rs.DEFAULT_MANSFIELD_LENGTH)
    assert got["rs_new_high"] == p1["rsNH"]
    assert got["rs_new_high_before_price"] == p1["rsNHbeforePx"]
    assert got["rs_new_high_red_day"] == p1["rsNHred"]
    assert got["rs_cross_up_21ema"] == p1["crossUp"]
    assert got["mansfield_cross_up"] == p2["mansfieldCrossUp"]
    assert all(v in (0.0, 1.0, None) for col in got.values() for v in col)


def test_point_in_time_full_series_equals_truncated_recompute_on_random_sessions():
    """signals.compute_signal_columns: every measured column at bar t reads only
    bars <= t, so computing once over the whole history IS point-in-time. Five
    random sessions, a true truncated recompute (same window START, END cut at
    the session), every signal column identical up to the session."""
    ts, series = _universe_500(seed=11)
    bench = _bars(series["SPY"], ts)
    rng = random.Random(2026)
    checked = 0
    for ticker in ("A", "B", "C"):
        bars = _bars(series[ticker], ts)
        full = ev.compute_signal_columns(bars, bench)
        full_p1 = rs.compute_phase1_columns(bars, bench, None, short_history=False)
        full_mrs = rs.compute_mansfield_columns(bars, bench)["mansfield"]
        for idx in rng.sample(range(300, 500), 5):
            tb, tn = bars[:idx + 1], bench[:idx + 1]
            trunc = ev.compute_signal_columns(tb, tn)
            for name in ev.SIGNALS:
                assert trunc[name] == full[name][:idx + 1], (ticker, idx, name)
            t_p1 = rs.compute_phase1_columns(tb, tn, None, short_history=False)
            t_mrs = rs.compute_mansfield_columns(tb, tn)["mansfield"]
            for a, b in zip(t_p1["rsMa"], full_p1["rsMa"][:idx + 1]):
                assert (a is None and b is None) or math.isclose(a, b, rel_tol=1e-12), (ticker, idx, "rsMa")
            for a, b in zip(t_mrs, full_mrs[:idx + 1]):
                assert (a is None and b is None) or math.isclose(a, b, rel_tol=1e-12), (ticker, idx, "mansfield")
            checked += 1
    assert checked == 15
    # not vacuous: the series actually fire the signals
    fired = {name: any(v == 1.0 for v in ev.compute_signal_columns(_bars(series["A"], ts), bench)[name])
             for name in ev.SIGNALS}
    assert fired["rs_new_high"] and fired["rs_cross_up_21ema"], fired


def test_forward_window_is_not_point_in_time_and_is_measured_from_bars_after_the_signal():
    """The one thing that reads the future is the forward return, and it reads
    bars strictly after the signal bar (from the next bar's open, N6); a signal
    in the last 21 bars has no 21-bar answer."""
    ts = _weekdays(60)
    bars = _bars([float(100 + i) for i in range(60)], ts)
    bench = [100.0] * 60
    rows = ev.rows_for_ticker("A", bars, bench, bench, {"x": [1.0] * 60}, horizons=(21,))
    ex = {s: e[0] for s, k, t, e in rows if k == "x"}
    assert ex[ts[0]] == pytest.approx((121 / 101 - 1) * 100), "bar 1's open to bar 21's close"
    assert ex[ts[38]] == pytest.approx((159 / 139 - 1) * 100)
    assert ex[ts[39]] is None and ex[ts[59]] is None


# --------------------------------------------------------------------------- #
# the run: checkpoint resume, (session, signal) granularity, open sessions
# --------------------------------------------------------------------------- #

def test_checkpoint_resume_second_run_measures_only_new_and_open_sessions(tmp_path):
    """500 held sessions, --sessions 300 -> ts[200..499]. The longest horizon is
    126, so a session is done when idx + 126 <= 499 -> ts[200..373] = 174 done,
    ts[374..499] = 126 open. Keys = 5 signals + baseline = 6."""
    ts, series = _universe_500()
    reader = make_reader(series, ts)
    db = tmp_path / "ev.db"
    kw = dict(bars_reader=reader, universe=["A", "B", "C"], put_bytes=_Spy(), delisted_fn=lambda a, b: 7)

    r1 = ev.run(db=str(db), sessions=300, **kw)
    assert r1["ok"] and r1["asof"] == J.ymd_to_iso(ts[-1]) and r1["sessions_held"] == 500
    assert (r1["sessions_requested"], r1["sessions_measured"], r1["sessions_skipped"]) == (300, 300, 0)
    assert (r1["pairs_measured"], r1["pairs_done"], r1["pairs_open"], r1["pairs_skipped"]) == (1800, 1044, 756, 0)
    assert r1["universe"] == 3 and r1["artifact"]["rows"] == 900 and r1["artifact"]["sessions"] == 300
    assert r1["artifact"]["sessions_open"] == 126 and r1["artifact"]["delisted_count"] == 7
    assert r1["publish"] is None
    assert _query(db, f"SELECT COUNT(*) FROM {S.ROWS_TABLE} WHERE signal = ?", (ev.BASELINE_KEY,))[0][0] == 900
    done_rows_before = _query(db, f"SELECT COUNT(*) FROM {S.ROWS_TABLE} WHERE session <= ?", (ts[373],))[0][0]

    r2 = ev.run(db=str(db), sessions=300, **kw)
    assert r2["ok"]
    assert (r2["sessions_requested"], r2["sessions_measured"], r2["sessions_skipped"]) == (300, 126, 174)
    assert (r2["pairs_measured"], r2["pairs_done"], r2["pairs_open"], r2["pairs_skipped"]) == (756, 0, 756, 1044)
    assert _query(db, f"SELECT COUNT(*) FROM {S.ROWS_TABLE} WHERE session <= ?", (ts[373],))[0][0] == done_rows_before
    assert r2["artifact"]["rows"] == 900, "the artifact is rebuilt from the WHOLE store"

    r3 = ev.run(db=str(db), sessions=320, **kw)
    assert (r3["sessions_requested"], r3["sessions_measured"], r3["sessions_skipped"]) == (320, 146, 174)
    assert (r3["pairs_done"], r3["pairs_open"]) == (120, 756)
    assert r3["artifact"]["rows"] == 960 and r3["artifact"]["sessions"] == 320
    assert _query(db, f"SELECT COUNT(*) FROM {S.RUNS_TABLE}")[0][0] == 3, "a receipt per run"


def test_checkpoint_is_per_session_and_signal_so_a_new_signal_backfills_only_itself(tmp_path):
    ts, series = _universe_500()
    reader = make_reader(series, ts)
    db = tmp_path / "ev.db"
    kw = dict(bars_reader=reader, universe=["A", "B", "C"], delisted_fn=lambda a, b: None)
    one = {"rs_new_high": ev.SIGNALS["rs_new_high"]}
    r1 = ev.run(db=str(db), sessions=300, signals=one, **kw)
    assert (r1["pairs_measured"], r1["pairs_done"], r1["pairs_open"]) == (600, 348, 252)
    r2 = ev.run(db=str(db), sessions=300, **kw)
    # done sessions (174) need the 4 new signals; open sessions (126) need all 6
    assert r2["pairs_measured"] == 174 * 4 + 126 * 6 == 1452
    assert r2["pairs_skipped"] == 174 * 2 == 348
    assert (r2["pairs_done"], r2["pairs_open"]) == (174 * 4, 126 * 6)
    assert _query(db, f"SELECT COUNT(*) FROM {S.ROWS_TABLE} WHERE signal = ?", (ev.BASELINE_KEY,))[0][0] == 900
    assert set(r2["artifact"]["per_signal"]) == set(ev.SIGNALS)


def test_open_sessions_are_re_measured_and_closed_once_the_history_reaches_them(tmp_path):
    """asof = ts[400], 50 sessions -> ts[351..400], none completable (idx + 126 > 400)
    -> all open. Next run at ts[499] with a 50-session window still re-measures
    them: ts[351..373] close (idx <= 373), ts[374..400] stay open, ts[450..499] open."""
    ts, series = _universe_500()
    reader = make_reader(series, ts)
    db = tmp_path / "ev.db"
    kw = dict(bars_reader=reader, universe=["A", "B", "C"], delisted_fn=lambda a, b: None)
    r1 = ev.run(db=str(db), sessions=50, asof=J.ymd_to_iso(ts[400]), **kw)
    assert r1["asof"] == J.ymd_to_iso(ts[400]) and r1["sessions_held"] == 401
    assert (r1["pairs_done"], r1["pairs_open"]) == (0, 300)
    r2 = ev.run(db=str(db), sessions=50, **kw)
    assert r2["sessions_requested"] == 100 and r2["sessions_measured"] == 100
    assert (r2["pairs_done"], r2["pairs_open"]) == (23 * 6, 77 * 6)
    assert r2["artifact"]["sessions"] == 100 and r2["artifact"]["sessions_open"] == 77


def test_run_refuses_without_a_store_path_and_the_benchmark_is_never_measured(tmp_path):
    ts, series = _universe_500()
    reader = make_reader(series, ts)
    with pytest.raises(ev.UsageError):
        ev.run(db="", bars_reader=reader, universe=["A"])
    with pytest.raises(S.StoreRefused):
        S.open_store("")
    r = ev.run(db=str(tmp_path / "ev.db"), sessions=10, bars_reader=reader, universe=["A", "SPY"],
               delisted_fn=lambda a, b: None)
    assert r["universe_requested"] == 2 and r["universe"] == 1, "SPY vs SPY is 1.0 on every bar: a daily 'new high'"
    none = ev.run(db=str(tmp_path / "ev2.db"), sessions=10, bars_reader=reader, universe=["A"], benchmark="QQQ")
    assert none["ok"] is False and "QQQ" in none["error"]


def test_rows_to_bars_drops_rows_without_a_positive_close():
    rows = [(20200102, 1, 1, 1, 10.0, 5), (20200103, 1, 1, 1, None, 5), (20200106, 1, 1, 1, 0, 5),
            (20200107, 1, 1, 1, "x", 5), (20200108, 1, 1, 1, 11.5, 5)]
    assert [b["t"] for b in J.rows_to_bars(rows)] == [20200102, 20200108]
    assert J.rows_to_bars(None) == []


def test_the_run_leaves_split_windows_out_and_counts_them_in_the_artifact(tmp_path, provider):
    """N5 end to end: B carries an unadjusted 3:1 split at ts[450] that its
    declared list names; every B row in ts[324..448] is left out, counted in the
    receipt and in the artifact's split_guard block, and A is measured whole."""
    ts, series = _universe_500()
    series["B"] = [c if i < 450 else c / 3.0 for i, c in enumerate(series["B"])]
    reader = make_reader(series, ts)
    provider["answers"].update({"A": [], "B": [(J.ymd_to_iso(ts[450]), 3.0)]})
    db = tmp_path / "ev.db"
    r = ev.run(db=str(db), sessions=300, bars_reader=reader, universe=["A", "B"], delisted_fn=lambda a, b: None)
    assert r["ok"] and sorted(provider["asked"]) == ["A", "B"]
    assert (r["split_tickers"], r["split_unchecked"]) == (1, 0)
    lo = 450 - 126                                           # the first row whose window reaches the split
    skipped_b_baseline = 448 - lo + 1
    store = S.open_store(str(db))
    guard = J.build_artifact(S.summary(store), asof_ymd=None, benchmark="SPY", window_from=None,
                             window_to=None, sessions=0, sessions_open=0, universe=0,
                             universe_requested=0)["split_guard"]
    store.close()
    assert guard["skipped"][ev.BASELINE_KEY] == skipped_b_baseline
    assert r["artifact"]["split_skipped"] == guard["skipped"] and r["split_skipped"] >= skipped_b_baseline
    assert r["artifact"]["rows"] == 600 - skipped_b_baseline, "A's 300 rows, B's 300 minus the guarded ones"
    stored = {s for (s,) in _query(db, f"SELECT session FROM {S.ROWS_TABLE} WHERE ticker = 'B' AND skip = 1 "
                                       f"AND signal = ?", (ev.BASELINE_KEY,))}
    assert stored == set(ts[lo:449])
    assert _query(db, f"SELECT COUNT(*) FROM declared_split_lists")[0][0] == 2, "answers kept for the next night"


def test_an_unknown_split_list_is_measured_as_held_and_counted(tmp_path, provider):
    ts, series = _universe_500()
    r = ev.run(db=str(tmp_path / "ev.db"), sessions=50, bars_reader=make_reader(series, ts), universe=["A", "B"],
               delisted_fn=lambda a, b: None)
    assert r["ok"] and r["split_unchecked"] == 2 and r["split_skipped"] == 0
    assert r["split_lists"]["fetch_failed"] == 2 and r["split_lists"]["unknown"] == 2


def test_a_dry_run_asks_no_provider_by_default(tmp_path, provider):
    ts, series = _universe_500()
    provider["answers"]["A"] = []
    r = ev.run(db=str(tmp_path / "missing.db"), dry_run=True, sessions=20, bars_reader=make_reader(series, ts),
               universe=["A"], delisted_fn=lambda a, b: None)
    assert r["ok"] and provider["asked"] == [] and r["split_lists"]["budget"] == 0
    assert not (tmp_path / "missing.db").exists()


def test_a_version_one_store_is_rebuilt_so_no_signal_close_row_survives(tmp_path):
    """N6 changes what a row means, so SCHEMA_VERSION 2 drops every version-1 row
    (derived data: the next run re-measures it) and keeps the split-list answers."""
    path = tmp_path / "ev.db"
    conn = sqlite3.connect(str(path))
    conn.executescript(f"""
        CREATE TABLE {S.META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO {S.META_TABLE} VALUES ('version', '1'), ('horizons', '[21, 63, 126]');
        CREATE TABLE {S.ROWS_TABLE} (session INTEGER, signal TEXT, ticker TEXT, ex_21 REAL, ex_63 REAL,
                                     ex_126 REAL, PRIMARY KEY (session, signal, ticker));
        INSERT INTO {S.ROWS_TABLE} VALUES (20200102, 'all_bars', 'A', 1.0, 2.0, 3.0);
        CREATE TABLE {S.CHECKPOINT_TABLE} (session INTEGER, signal TEXT, status TEXT, rows INTEGER, at TEXT,
                                           PRIMARY KEY (session, signal));
        INSERT INTO {S.CHECKPOINT_TABLE} VALUES (20200102, 'all_bars', 'done', 1, 'x');
        CREATE TABLE declared_split_lists (ticker TEXT PRIMARY KEY, splits TEXT NOT NULL, fetched_at REAL);
        INSERT INTO declared_split_lists VALUES ('A', '[]', 1.0);
    """)
    conn.commit()
    conn.close()
    with pytest.raises(S.StoreRefused):
        S.open_store(str(path), read_only=True)
    store = S.open_store(str(path))
    assert S.checkpoints(store) == {} and S.summary(store)["rows"] == 0
    cols = [r[1] for r in store.execute(f"PRAGMA table_info({S.ROWS_TABLE})")]
    assert "skip" in cols and S.SCHEMA_VERSION == 2
    assert store.execute("SELECT COUNT(*) FROM declared_split_lists").fetchone()[0] == 1
    store.close()


# --------------------------------------------------------------------------- #
# the artifact and the publish gate
# --------------------------------------------------------------------------- #

def _summary_with_rows(n):
    return {"per_signal": {}, "baseline": {str(h): ev.summarise_values([]) for h in ev.HORIZONS}, "rows": n}


def test_row_floor_refuses_to_publish_and_put_bytes_is_never_called():
    assert ev.MIN_ROWS == 1000, "the floor is documented in job.py; change both together"
    spy = _Spy()
    art = ev.build_artifact(_summary_with_rows(ev.MIN_ROWS - 1), asof_ymd=20200131, benchmark="SPY",
                            window_from=20200102, window_to=20200131, sessions=1, sessions_open=0, universe=999,
                            universe_requested=999, delisted_fn=lambda a, b: 0)
    receipt = ev.publish(art, dest="rs/evidence.json", put_bytes=spy)
    assert receipt["published"] is False and receipt["reason"] == "row_floor"
    assert receipt["rows"] == ev.MIN_ROWS - 1 and receipt["floor"] == ev.MIN_ROWS
    assert spy.calls == []
    with pytest.raises(ev.UsageError):
        ev.publish(art, dest="", put_bytes=spy)


def test_put_bytes_receives_the_exact_bytes_once_at_the_floor():
    spy = _Spy()
    art = ev.build_artifact(_summary_with_rows(ev.MIN_ROWS), asof_ymd=20200131, benchmark="SPY",
                            window_from=20200102, window_to=20200131, sessions=1, sessions_open=0, universe=1000,
                            universe_requested=1000, delisted_fn=lambda a, b: 3)
    receipt = ev.publish(art, dest="rs/evidence.json", put_bytes=spy)
    assert receipt["published"] is True and receipt["reason"] is None
    assert len(spy.calls) == 1
    key, data, ctype = spy.calls[0]
    assert key == "rs/evidence.json" and ctype == "application/json"
    assert data == ev.artifact_bytes(art) == json.dumps(art, sort_keys=True, separators=(",", ":")).encode("utf-8")
    assert json.loads(data) == art and receipt["bytes"] == len(data)
    assert json.loads(data)["delisted_count"] == 3
    failed = ev.publish(art, dest="rs/evidence.json", put_bytes=_Spy(ok=False))
    assert failed["published"] is False and failed["reason"] == "put_bytes_false"


def test_artifact_shape_is_the_documented_one():
    art = ev.build_artifact(_summary_with_rows(5), asof_ymd=20200131, benchmark="SPY", window_from=20200102,
                            window_to=20200131, sessions=2, sessions_open=1, universe=3, universe_requested=4,
                            delisted_fn=lambda a, b: 1)
    assert set(art) == {"version", "asof", "generated_at", "benchmark", "window", "sessions", "sessions_open",
                        "universe", "universe_requested", "delisted_count", "survivorship", "horizons", "rows",
                        "per_signal", "baseline", "split_guard", "method"}
    # 2 since 2026-11-07: the next-open base (N6) and the split guard (N5) changed what
    # the numbers measure, so the pull refuses a version-1 artifact.
    assert art["version"] == ev.ARTIFACT_VERSION == 2 and art["asof"] == "2020-01-31"
    assert art["split_guard"]["skipped"] == {**{name: 0 for name in ev.SIGNALS}, ev.BASELINE_KEY: 0}
    assert "unadjusted split" in art["split_guard"]["rule"] and "t+126" in art["split_guard"]["rule"]
    assert art["window"] == {"from": "2020-01-02", "to": "2020-01-31"} and art["horizons"] == [21, 63, 126]
    assert art["survivorship"] == ev.SURVIVORSHIP_NOTE == "universe as held, survivorship not yet corrected"
    for name, spec in ev.SIGNALS.items():
        sig = art["per_signal"][name]
        assert sig["column"] == spec["column"] and sig["definition"] == spec["definition"]
        assert (sig["n_signals"], sig["dates"], sig["tickers"]) == (0, 0, 0)
        assert set(sig["horizons"]) == {"21", "63", "126"}
        assert sig["horizons"]["21"]["hit_rate"] is None, "no events -> null, never 0"
    assert set(art["baseline"]) == {"21", "63", "126"}
    m = art["method"]
    assert m["display_floor_n"] == ev.DISPLAY_FLOOR_N == 100 and m["publish_floor_rows"] == ev.MIN_ROWS
    assert m["warmup_bars"] == ev.WARMUP_BARS == 852 and m["inputs"]["lookback"] == 252
    assert "O[t+1]" in m["forward_return"] and "open of the session after the signal" in m["forward_return"]
    assert "C[t]" not in m["forward_return"], "the signal-close base is gone (N6)"
    assert m["hit"] == "excess > 0"
    assert ev.ARTIFACT_KEY == "rs/evidence.json"


def test_delisted_fn_none_path_and_window_arguments():
    seen = {}

    def counting(a, b):
        seen["args"] = (a, b)
        return 12
    kw = dict(asof_ymd=20200131, benchmark="SPY", window_from=20200102, window_to=20200131, sessions=1,
              sessions_open=0, universe=1, universe_requested=1)
    assert ev.build_artifact(_summary_with_rows(1), delisted_fn=counting, **kw)["delisted_count"] == 12
    assert seen["args"] == ("2020-01-02", "2020-01-31")
    assert ev.build_artifact(_summary_with_rows(1), delisted_fn=lambda a, b: None, **kw)["delisted_count"] is None

    def boom(a, b):
        raise RuntimeError("registry offline")
    assert ev.build_artifact(_summary_with_rows(1), delisted_fn=boom, **kw)["delisted_count"] is None
    empty = ev.build_artifact(_summary_with_rows(0), delisted_fn=counting, asof_ymd=None, benchmark="SPY",
                              window_from=None, window_to=None, sessions=0, sessions_open=0, universe=0,
                              universe_requested=0)
    assert empty["delisted_count"] is None and empty["window"] == {"from": None, "to": None}


def test_default_delisted_count_counts_last_date_inside_the_window(monkeypatch):
    from api.services import delisted_registry
    entries = [{"ticker": "IN1", "last_date": "2020-06-01"}, {"ticker": "EDGE", "last_date": "2020-12-31"},
               {"ticker": "OUT", "last_date": "2019-12-31"}, {"ticker": "NONE", "last_date": None},
               {"ticker": "LATER", "last_date": "2021-01-01"}]
    monkeypatch.setattr(delisted_registry, "all_entries", lambda: entries)
    assert ev.default_delisted_count("2020-01-02", "2020-12-31") == 2
    monkeypatch.setattr(delisted_registry, "all_entries", lambda: (_ for _ in ()).throw(OSError("no file")))
    assert ev.default_delisted_count("2020-01-02", "2020-12-31") is None


# --------------------------------------------------------------------------- #
# the CLI: exit codes, --dry-run writes nothing, --publish needs --dest
# --------------------------------------------------------------------------- #

def test_main_end_to_end_publishes_above_the_floor_and_refuses_below_it(tmp_path, capsys):
    ts, series = _universe_500()
    reader = make_reader(series, ts)
    spy = _Spy()
    db = tmp_path / "ev.db"
    # 3 tickers x 350 sessions = 1050 all-bars rows >= the 1000 floor
    rc = main(["--db", str(db), "--sessions", "350", "--publish", "--dest", "rs/evidence.json"],
              bars_reader=reader, universe=["A", "B", "C"], put_bytes=spy, delisted_fn=lambda a, b: 7)
    assert rc == 0
    assert len(spy.calls) == 1 and spy.calls[0][0] == "rs/evidence.json"
    art = json.loads(spy.calls[0][1])
    assert art["rows"] == 1050 and art["sessions"] == 350 and art["universe"] == 3 and art["delisted_count"] == 7
    assert art["asof"] == J.ymd_to_iso(ts[-1]) and art["benchmark"] == "SPY"
    assert set(art["per_signal"]) == set(ev.SIGNALS)
    out = capsys.readouterr().out
    receipt = json.loads([ln for ln in out.splitlines() if ln.startswith("receipt ")][-1][len("receipt "):])
    assert receipt["ok"] is True and receipt["publish"]["published"] is True
    assert receipt["publish"]["sha256"] and receipt["publish"]["bytes"] == len(spy.calls[0][1])
    assert "rs_new_high" in out and "all_bars (baseline)" in out

    spy2 = _Spy()
    rc2 = main(["--db", str(tmp_path / "small.db"), "--sessions", "100", "--publish", "--dest", "rs/evidence.json"],
               bars_reader=reader, universe=["A", "B", "C"], put_bytes=spy2, delisted_fn=lambda a, b: 0)
    assert rc2 == 1 and spy2.calls == []
    receipt2 = json.loads([ln for ln in capsys.readouterr().out.splitlines()
                           if ln.startswith("receipt ")][-1][len("receipt "):])
    assert receipt2["ok"] is False and receipt2["publish"]["reason"] == "row_floor"
    assert receipt2["artifact"]["rows"] == 300 and receipt2["artifact"]["publishable"] is False


def test_dry_run_writes_nothing_and_publishes_nothing(tmp_path, capsys):
    ts, series = _universe_500()
    reader = make_reader(series, ts)
    spy = _Spy()
    db = tmp_path / "never.db"
    rc = main(["--db", str(db), "--dry-run", "--sessions", "50"],
              bars_reader=reader, universe=["A", "B", "C"], put_bytes=spy, delisted_fn=lambda a, b: 1)
    assert rc == 0
    assert not db.exists() and not list(tmp_path.iterdir()), "a dry run creates no file"
    assert spy.calls == []
    out = capsys.readouterr().out
    receipt = json.loads([ln for ln in out.splitlines() if ln.startswith("receipt ")][-1][len("receipt "):])
    assert receipt["dry_run"] is True and receipt["publish"] is None and receipt["ok"] is True
    assert receipt["artifact"]["rows"] == 150 and receipt["artifact"]["publishable"] is False
    assert receipt["sessions_measured"] == 50 and receipt["pairs_measured"] == 300

    # against an EXISTING store the dry run reads the checkpoint and still writes nothing
    real = tmp_path / "real.db"
    assert ev.run(db=str(real), sessions=50, bars_reader=reader, universe=["A", "B", "C"],
                  delisted_fn=lambda a, b: None)["ok"]
    runs_before = _query(real, f"SELECT COUNT(*) FROM {S.RUNS_TABLE}")[0][0]
    cps_before = _query(real, f"SELECT COUNT(*) FROM {S.CHECKPOINT_TABLE}")[0][0]
    rc2 = main(["--db", str(real), "--dry-run", "--sessions", "60"], bars_reader=reader, universe=["A", "B", "C"],
               put_bytes=spy, delisted_fn=lambda a, b: None)
    assert rc2 == 0 and spy.calls == []
    assert _query(real, f"SELECT COUNT(*) FROM {S.RUNS_TABLE}")[0][0] == runs_before
    assert _query(real, f"SELECT COUNT(*) FROM {S.CHECKPOINT_TABLE}")[0][0] == cps_before
    receipt2 = json.loads([ln for ln in capsys.readouterr().out.splitlines()
                           if ln.startswith("receipt ")][-1][len("receipt "):])
    assert receipt2["sessions_measured"] == 60, "all 50 were open (asof unchanged) + 10 new"


def test_main_usage_errors_exit_2(tmp_path, capsys):
    ts, series = _universe_500()
    reader = make_reader(series, ts)
    db = str(tmp_path / "ev.db")
    assert main([], bars_reader=reader, universe=["A"]) == 2, "--db is required"
    assert main(["--publish", "--dest", "rs/evidence.json"], bars_reader=reader, universe=["A"]) == 2
    assert main(["--db", db, "--publish"], bars_reader=reader, universe=["A"]) == 2, "--publish needs --dest"
    assert main(["--db", db, "--publish", "--dry-run", "--dest", "x"], bars_reader=reader, universe=["A"]) == 2
    assert main(["--db", db, "--sessions", "-1"], bars_reader=reader, universe=["A"]) == 2
    assert main(["--db", db, "--universe", str(tmp_path / "missing.txt")], bars_reader=reader) == 2
    assert not pathlib.Path(db).exists(), "a usage error opens nothing"
    capsys.readouterr()


def test_main_reads_a_universe_file_and_a_failed_run_exits_1(tmp_path, capsys):
    ts, series = _universe_500()
    reader = make_reader(series, ts)
    uni = tmp_path / "u.txt"
    uni.write_text("# names\nA\nb  # lower\n\nC\n", encoding="utf-8")
    rc = main(["--db", str(tmp_path / "ev.db"), "--sessions", "5", "--universe", str(uni)],
              bars_reader=reader, delisted_fn=lambda a, b: None)
    assert rc == 0
    receipt = json.loads([ln for ln in capsys.readouterr().out.splitlines()
                          if ln.startswith("receipt ")][-1][len("receipt "):])
    assert receipt["universe_requested"] == 3 and receipt["universe"] == 3
    uni_json = tmp_path / "u.json"
    uni_json.write_text(json.dumps(["A", "C"]), encoding="utf-8")
    from api.services.rs_evidence.__main__ import read_universe_file
    assert read_universe_file(str(uni_json)) == ["A", "C"]

    def broken(ticker, n, to_key):
        raise RuntimeError("bars store offline")
    assert main(["--db", str(tmp_path / "ev2.db"), "--sessions", "5"], bars_reader=broken, universe=["A"]) == 1
    receipt = json.loads([ln for ln in capsys.readouterr().out.splitlines()
                          if ln.startswith("receipt ")][-1][len("receipt "):])
    assert receipt["ok"] is False and "bars store offline" in receipt["error"]


# --------------------------------------------------------------------------- #
# the rail: maths from relative_strength only, no environment, no re-implementation
# --------------------------------------------------------------------------- #

ALLOWED_API_IMPORTS = {
    "api.services.relative_strength",     # the maths
    "api.services.bars_sqlite",           # the default reader seam
    "api.services.data_sync",             # the default put_bytes
    "api.services.delisted_registry",     # the default survivorship count
    "api.services.groups",                # the default universe
    # 2026-11-07 (N5): the split guard. Not maths: the repo's ONE split detector and
    # the declared split lists it judges with.
    "api.services.bars_sanitize.unadjusted_splits",
    "api.services.declared_splits.DeclaredSplits",
    "api.services.declared_splits.DEFAULT_FETCH_BUDGET",
}


def test_package_imports_its_maths_from_relative_strength_only():
    files = sorted(PKG.glob("*.py"))
    assert {f.name for f in files} >= {"__init__.py", "__main__.py", "job.py", "measure.py", "signals.py", "store.py"}
    rs_public = {n for n in dir(rs) if not n.startswith("_") and callable(getattr(rs, n))}
    for path in files:
        src = path.read_text(encoding="utf-8")
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    assert not a.name.startswith("api."), f"{path.name}: `import {a.name}` - use from-imports"
                    assert a.name.split(".")[0] not in ("numpy", "pandas"), f"{path.name} imports {a.name}"
            elif isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                if node.level:
                    continue                                  # inside the package
                if mod.startswith("api."):
                    names = {f"{mod}.{a.name}" for a in node.names}
                    assert mod in ALLOWED_API_IMPORTS or names <= ALLOWED_API_IMPORTS, \
                        f"{path.name} imports {mod} ({sorted(names)}); maths comes from relative_strength only"
                assert mod.split(".")[0] not in ("numpy", "pandas"), f"{path.name} imports {mod}"
                assert "indicator_compute" not in mod, f"{path.name} reaches past relative_strength"
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                assert node.name not in rs_public, \
                    f"{path.name} defines {node.name}(), a name relative_strength already owns: reuse, never re-implement"
        assert "os.environ" not in src and "getenv" not in src, f"{path.name} reads the environment"
        assert "/data" not in src.replace("data_sync", "").replace("data directory", ""), \
            f"{path.name} names a data directory; the store path is an argument"
    sig_src = (PKG / "signals.py").read_text(encoding="utf-8")
    assert "rs.compute_phase1_columns(" in sig_src and "rs.compute_mansfield_columns(" in sig_src, \
        "the positive control: the signal columns ARE the compute functions' output"


def test_lists_left_unknown_by_the_nightly_budget_keep_sessions_open_until_answered(tmp_path, provider):
    """Review, 2026-11-07: a `done` pair is never asked for again, so closing
    sessions over names this run could not look up (budget spent) made the split
    guard a one-shot. They stay open, and close on the night the lists are known."""
    ts, series = _universe_500()
    db = str(tmp_path / "ev.db")
    provider["answers"]["A"] = []
    first = ev.run(db=db, sessions=300, bars_reader=make_reader(series, ts), universe=["A", "B"],
                   delisted_fn=lambda a, b: None, split_fetch_budget=1)
    assert first["ok"] and first["split_unchecked"] == 1 and first["split_lists"]["budget_exhausted"] is True
    assert first["split_guard_pending"] is True and first["pairs_done"] == 0
    provider["answers"]["B"] = []
    second = ev.run(db=db, sessions=300, bars_reader=make_reader(series, ts), universe=["A", "B"],
                    delisted_fn=lambda a, b: None)
    assert second["ok"] and second["split_unchecked"] == 0 and second["split_guard_pending"] is False
    assert second["pairs_done"] > 0


def test_a_name_the_provider_refuses_does_not_hold_sessions_open_forever(tmp_path, provider):
    ts, series = _universe_500()
    r = ev.run(db=str(tmp_path / "ev.db"), sessions=300, bars_reader=make_reader(series, ts), universe=["A", "B"],
               delisted_fn=lambda a, b: None)
    assert r["split_unchecked"] == 2 and r["split_guard_pending"] is False and r["pairs_done"] > 0
