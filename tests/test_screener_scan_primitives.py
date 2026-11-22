"""Scan primitives: every expected value below is worked out by hand from the fixture beside it, never read back from the
code. Boundary and missing-data cases are the point: a primitive that matches on an absent value is a broader screen."""
from __future__ import annotations

import ast
import pathlib
import sqlite3

import pytest

from api.services.screener import filters, query
from api.services.screener import technicals as T
from api.services.uct_agent.scan import hidden

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _bar(c, h=None, l=None, v=1000):
    return {"o": c, "h": c if h is None else h, "l": c if l is None else l, "c": c, "v": v}


def _flat(n, c=100.0, v=1000):
    return [_bar(c, v=v) for _ in range(n)]


def _t(bars):
    return T.compute_technicals(bars)


# ── MA distance ───────────────────────────────────────────────────────────────

def test_ema9_and_ema10_distance_by_hand():
    # Seed = mean(1..9) = 5. Close 10: 10 * 0.2 + 5 * 0.8 = 6. (10 - 6) / 6 = 66.67%.
    # EMA10 seed = mean(1..10) = 5.5. (10 - 5.5) / 5.5 = 81.82%.
    out = _t([_bar(float(c)) for c in range(1, 11)])
    assert out["pct_vs_ema9"] == 66.67
    assert out["pct_vs_ema10"] == 81.82


def test_ema9_needs_nine_closes_exactly():
    assert _t([_bar(float(c)) for c in range(1, 9)])["pct_vs_ema9"] is None
    assert _t([_bar(float(c)) for c in range(1, 10)])["pct_vs_ema9"] == 80.0      # (9 - 5) / 5
    assert _t([_bar(float(c)) for c in range(1, 10)])["pct_vs_ema10"] is None


def test_the_ema_primitive_agrees_with_the_published_ema20_lane():
    closes = [100 + (i * 7) % 13 for i in range(60)]
    assert T._pct(closes[-1], T._ema(closes, 9)) == _t([_bar(float(c)) for c in closes])["pct_vs_ema9"]


# ── signed runs ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("fast,slow,want", [
    ([1, 3, 5], [2, 2, 2], 2),               # below, then two sessions above: crossed up 2 sessions ago counts as 2
    ([2, 2, 3], [2, 2, 2], 1),               # level then above: that IS the cross
    ([3, 3, 1], [2, 2, 2], -1),              # crossed down on the last session
    ([1, 1, 1], [2, 2, 2], -3),              # below throughout
    ([3, 2], [2, 2], 0),                     # level on the last session
    ([None, 3, 3], [2, 2, 2], 2),            # the count stops where a side runs out
    ([3, 3], [None, 2], 1),
    ([3, None], [2, 2], None),               # undefined on the last session
    ([3, 3], [2, None], None),
    ([], [], None),
])
def test_signed_run(fast, slow, want):
    assert T._signed_run(fast, slow) == want


def test_a_cross_that_reversed_does_not_read_as_a_recent_cross():
    assert T._signed_run([1, 3, 1], [2, 2, 2]) == -1


def test_a_golden_cross_on_its_day_and_the_day_after():
    # 250 flat at 100, then 150. SMA50 = (49*100 + 150)/50 = 101. SMA200 = (199*100 + 150)/200 = 100.25.
    # They were level, so the 50 crossing above the 200 happens on this bar.
    bars = _flat(250) + [_bar(150.0)]
    out = _t(bars)
    assert out["run_sma50_sma200"] == 1 and out["run_sma20_sma50"] == 1
    assert out["run_close_sma50"] == 1 and out["run_close_sma200"] == 1 and out["run_close_ema20"] == 1
    assert out["run_ema9_ema20"] == 1
    assert _t(bars + [_bar(150.0)])["run_sma50_sma200"] == 2


def test_a_death_cross():
    # SMA50 = (4900 + 50)/50 = 99, SMA200 = (19900 + 50)/200 = 99.75.
    assert _t(_flat(250) + [_bar(50.0)])["run_sma50_sma200"] == -1


def test_a_flat_series_has_crossed_nothing():
    out = _t(_flat(250))
    assert out["run_sma50_sma200"] == 0 and out["run_close_sma50"] == 0


def test_runs_are_blank_without_the_longer_average():
    bars = [_bar(100.0 + i) for i in range(199)]
    out = _t(bars)
    assert out["run_close_sma200"] is None and out["run_sma50_sma200"] is None
    assert out["run_close_sma50"] == 150                          # bars 49..198: SMA50 exists from index 49
    assert _t(bars + [_bar(299.0)])["run_close_sma200"] == 1      # SMA200 exists only on this last bar


# ── rising ────────────────────────────────────────────────────────────────────

def test_rising_means_strictly_above_its_value_twenty_sessions_ago():
    assert _t(_flat(250))["sma50_rising"] is False                # equal is not rising
    assert _t(_flat(250) + [_bar(150.0)])["sma50_rising"] is True
    assert _t(_flat(250) + [_bar(50.0)])["sma200_rising"] is False


def test_rising_boundary_of_history():
    # SMA20 exists from index 19; it needs an index-19 value 20 sessions back, so 40 bars exactly.
    assert _t(_flat(39))["sma20_rising"] is None
    assert _t(_flat(40))["sma20_rising"] is False
    assert _t(_flat(69))["sma50_rising"] is None
    assert _t(_flat(70))["sma50_rising"] is False
    assert _t(_flat(219))["sma200_rising"] is None
    assert _t(_flat(220))["sma200_rising"] is False


# ── volume ────────────────────────────────────────────────────────────────────

def test_volume_trend_by_hand():
    # Last 5 at 200 mean 200. Last 20: (15*100 + 5*200)/20 = 125. 200/125 - 1 = 60%.
    bars = _flat(15, v=100) + _flat(5, v=200)
    assert _t(bars)["vol_trend_pct"] == 60.0


def test_volume_trend_shrinking_is_negative():
    # Last 5 at 50: mean 50. Last 20: (15*100 + 5*50)/20 = 87.5. 50/87.5 - 1 = -42.86%.
    assert _t(_flat(15, v=100) + _flat(5, v=50))["vol_trend_pct"] == -42.86


def test_volume_trend_boundaries_and_gaps():
    assert _t(_flat(19))["vol_trend_pct"] is None                 # short of 20 sessions
    assert _t(_flat(20))["vol_trend_pct"] == 0.0
    assert _t(_flat(20, v=0))["vol_trend_pct"] is None            # no baseline to compare against
    gap = _flat(20)
    gap[3]["v"] = None
    assert _t(gap)["vol_trend_pct"] is None                       # absent inside the window is not a zero
    older = _flat(21)
    older[0]["v"] = None
    assert _t(older)["vol_trend_pct"] == 0.0                      # outside the window it does not matter


def test_average_volumes_by_hand():
    bars = _flat(40, v=100) + _flat(10, v=300)
    out = _t(bars)
    assert out["avg_volume_10d"] == 300.0
    assert out["avg_volume_50d"] == 140.0                         # (40*100 + 10*300) / 50
    assert _t(_flat(9))["avg_volume_10d"] is None
    assert _t(_flat(49))["avg_volume_50d"] is None


def _vols(*vs):
    return [_bar(100.0, v=v) for v in vs]


@pytest.mark.parametrize("vs,up,down", [
    ((5, 1, 2, 3), 2, 0),
    ((1, 3, 2, 1), 0, 2),
    ((2, 2, 2), 0, 0),                       # unchanged is neither
    ((1, None, 2, 3), 1, 0),                 # a gap ends the run, it does not bridge it
    ((1, 2, None), None, None),              # no volume on the last session
    ((1,), None, None),
])
def test_volume_runs(vs, up, down):
    out = _t(_vols(*vs))
    assert out["vol_up_run"] == up and out["vol_down_run"] == down


# ── breakouts ─────────────────────────────────────────────────────────────────

def test_close_above_prior_highs_excludes_the_session_itself_and_needs_a_strict_beat():
    prior = [_bar(9.0, h=10.0), _bar(9.0, h=12.0), _bar(9.0, h=11.0), _bar(9.0, h=11.0)]
    assert _t(prior + [_bar(12.0, h=99.0)])["new_high_lookback"] == 2      # equals the 12 high: stops there
    assert _t(prior + [_bar(12.01, h=99.0)])["new_high_lookback"] == 4     # clears all four it holds
    assert _t(prior + [_bar(11.0, h=99.0)])["new_high_lookback"] == 0      # equals the very last high


def test_a_twenty_day_breakout_is_exactly_at_least_twenty():
    prior = [_bar(99.0, h=100.0, v=1000) for _ in range(19)]
    assert _t(prior + [_bar(99.0, h=100.0)] + [_bar(101.0)])["new_high_lookback"] == 20
    assert _t([_bar(99.0, h=101.5)] + prior + [_bar(101.0)])["new_high_lookback"] == 19


def test_the_lookback_is_capped_at_a_trading_year():
    assert _t(_flat(300, c=10.0) + [_bar(11.0)])["new_high_lookback"] == 252


def test_close_below_prior_lows_mirrors_it():
    prior = [_bar(11.0, l=10.0), _bar(11.0, l=8.0), _bar(11.0, l=9.0)]
    assert _t(prior + [_bar(8.0, l=1.0)])["new_low_lookback"] == 1         # equals the 8 low: stops there
    assert _t(prior + [_bar(7.5, l=1.0)])["new_low_lookback"] == 3


def test_a_single_bar_has_no_lookback():
    out = _t([_bar(10.0)])
    assert out["new_high_lookback"] is None and out["new_low_lookback"] is None


def test_breakout_age_by_hand():
    base = [_bar(99.0, h=100.0) for _ in range(20)]
    # Close 101 beats the prior-20 high of 100: age 0.
    assert _t(base + [_bar(101.0, h=102.0)])["breakout_20d_age"] == 0
    # Three quiet sessions below the new high of 102: the break is now 3 sessions old.
    assert _t(base + [_bar(101.0, h=102.0)] + [_bar(100.0, h=100.5)] * 3)["breakout_20d_age"] == 3


def test_breakout_age_boundaries():
    base = [_bar(99.0, h=100.0) for _ in range(20)]
    assert _t(base + [_bar(100.0)])["breakout_20d_age"] is None            # equal is not a breakout
    assert _t(base[:19] + [_bar(120.0)])["breakout_20d_age"] is None       # 20 sessions cannot hold a prior 20
    quiet = [_bar(100.0, h=100.5)] * 63
    assert _t(base + [_bar(101.0, h=102.0)] + quiet[:62])["breakout_20d_age"] == 62
    assert _t(base + [_bar(101.0, h=102.0)] + quiet)["breakout_20d_age"] is None   # older than the window


# ── 52-week ages ──────────────────────────────────────────────────────────────

def test_fifty_two_week_ages_by_hand():
    bars = [_bar(50.0, h=60.0, l=40.0) for _ in range(252)]
    bars[-8]["h"] = 90.0
    bars[-31]["l"] = 10.0
    out = _t(bars)
    assert out["high_52w_age"] == 7 and out["low_52w_age"] == 30


def test_ties_take_the_newest():
    out = _t([_bar(50.0, h=60.0, l=40.0) for _ in range(252)])
    assert out["high_52w_age"] == 0 and out["low_52w_age"] == 0


def test_ages_are_blank_without_a_full_year_unless_listed_inside_it():
    short = [dict(_bar(50.0, h=60.0, l=40.0), t="2026-01-05") for _ in range(100)]
    assert T.compute_technicals(short)["high_52w_age"] is None
    assert T.compute_technicals(short, ipo_date="2026-01-05")["high_52w_age"] == 0


# ── the catalog, the store and the screen ─────────────────────────────────────

def test_every_primitive_has_a_stated_definition_and_a_column():
    from api.services.screener import snapshot_db
    catalog = {f["key"]: f for f in filters.field_catalog()}
    for key in (*T.SCAN_PRIMITIVE_COLUMNS, "pct_vs_sma50", "pct_vs_sma200"):
        assert catalog[key]["category"] == "technical"
        assert len(catalog[key]["description"]) > 40, key
        assert filters.column_for(key) == key and key in snapshot_db.COLUMNS


def test_existing_meanings_did_not_move():
    bars = [_bar(100 + (i * 7) % 13, h=120, l=90) for i in range(300)]
    out = _t(bars)
    closes = [b["c"] for b in bars]
    assert out["pct_vs_ema20"] == T._pct(closes[-1], T._ema(closes, 20))
    assert out["pct_vs_sma50"] == T._pct(closes[-1], T._sma(closes, 50))


def test_f16_stays_intact():
    names = set(hidden.hidden_keys())
    assert not (set(T.SCAN_PRIMITIVE_COLUMNS) | {"pct_vs_sma50", "pct_vs_sma200"}) & names
    tree = ast.parse((ROOT / "api/services/screener/technicals.py").read_text(encoding="utf-8"))
    fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "scan_primitives")
    imported = {a.name for n in ast.walk(fn) if isinstance(n, ast.ImportFrom) for a in n.names}
    assert imported == {"indicator_compute"}
    assert {n.value for n in ast.walk(fn) if isinstance(n, ast.Constant) and isinstance(n.value, str)} & names == set()


def _db(monkeypatch, tmp_path):
    db = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(db))
    return db


def test_the_migration_is_additive_and_idempotent(monkeypatch, tmp_path):
    db = _db(monkeypatch, tmp_path)
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE screener_rows (ticker TEXT PRIMARY KEY, price REAL, rsi14 REAL)")
    conn.execute("INSERT INTO screener_rows VALUES ('OLD', 12.5, 55.0)")
    conn.commit()
    conn.close()
    from api.services.screener import snapshot_db
    snapshot_db.init_db()
    snapshot_db.init_db()
    with snapshot_db.connect() as c:
        have = [r[1] for r in c.execute("PRAGMA table_info(screener_rows)")]
        row = dict(c.execute("SELECT * FROM screener_rows WHERE ticker = 'OLD'").fetchone())
    assert len(have) == len(set(have)) and set(T.SCAN_PRIMITIVE_COLUMNS) <= set(have)
    assert row["price"] == 12.5 and row["rsi14"] == 55.0
    assert all(row[c] is None for c in T.SCAN_PRIMITIVE_COLUMNS)


def _matches(conn, filters_):
    plan = query.build_scan_sql({"filters": filters_, "sort": {"key": "ticker", "dir": "asc"}}, conn=conn)
    return [r["ticker"] for r in conn.execute(plan["sql"], plan["params"]).fetchall()]


def test_an_absent_value_matches_no_threshold(monkeypatch, tmp_path):
    _db(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    snapshot_db.init_db()
    snapshot_db.upsert_rows([
        {"ticker": "BLANK", "price": 10.0},
        {"ticker": "HAS", "price": 10.0, "run_sma50_sma200": 3, "new_high_lookback": 25, "sma200_rising": True,
         "breakout_20d_age": 0, "vol_trend_pct": 12.5},
    ])
    with snapshot_db.connect() as conn:
        assert _matches(conn, [{"key": "run_sma50_sma200", "op": "between", "min": 1, "max": 5}]) == ["HAS"]
        assert _matches(conn, [{"key": "run_sma50_sma200", "op": "lte", "max": 5}]) == ["HAS"]
        assert _matches(conn, [{"key": "new_high_lookback", "op": "gte", "min": 20}]) == ["HAS"]
        assert _matches(conn, [{"key": "new_high_lookback", "op": "lte", "max": 30}]) == ["HAS"]
        assert _matches(conn, [{"key": "sma200_rising", "op": "eq", "value": 1}]) == ["HAS"]
        assert _matches(conn, [{"key": "sma200_rising", "op": "eq", "value": 0}]) == []
        assert _matches(conn, [{"key": "breakout_20d_age", "op": "lte", "max": 5}]) == ["HAS"]
        assert _matches(conn, [{"key": "vol_trend_pct", "op": "lt", "max": 50}]) == ["HAS"]


def test_a_row_built_from_bars_stores_the_primitives(monkeypatch, tmp_path):
    _db(monkeypatch, tmp_path)
    from api.services.screener import snapshot_db
    snapshot_db.init_db()
    row = {k: v for k, v in _t(_flat(250) + [_bar(150.0)]).items() if k in snapshot_db.COLUMNS}
    snapshot_db.upsert_rows([dict(row, ticker="X")])
    got = snapshot_db.get_row("X")
    assert got["run_sma50_sma200"] == 1 and got["sma50_rising"] == 1 and got["pct_vs_ema9"] is not None


def _slow_skip(series, n, reduce):
    """NA_SKIP gathered bar by bar, the path the interpreter takes on a series with an `na` in it."""
    import math
    from api.services import ast_interpret as A
    out = [math.nan] * len(series)
    for i in range(n - 1, len(series)):
        w = A._window_operands(series, n, i, A.NA_SKIP)
        if w is not None:
            out[i] = reduce(*w)
    return out


@pytest.mark.parametrize("seed", range(12))
@pytest.mark.parametrize("n", [1, 2, 20, 50, 200])
def test_the_all_finite_window_gives_exactly_the_gathered_bits(seed, n):
    """float.hex, not approx: a window mean is compared with == by a cross, so a last-bit change would move a signal."""
    import random
    from api.services import ast_interpret as A
    rng = random.Random(seed)
    c, series = 50.0, []
    for _ in range(400):
        c = max(0.01, c * (1 + rng.gauss(0, 0.03)))
        series.append(round(c, rng.choice((2, 4, 9))))
    fast = A._rolling(series, n, A._window_mean, A.NA_SKIP)
    assert [x.hex() for x in fast] == [x.hex() for x in _slow_skip(series, n, A._window_mean)]


def test_a_series_shorter_than_the_window_is_all_nan_and_never_read():
    import math
    from api.services import ast_interpret as A
    for short in ([None, 1.0], [None], [1.0, 2.0], []):
        got = A._rolling(short, 5, A._window_mean, A.NA_SKIP)
        assert len(got) == len(short) and all(math.isnan(x) for x in got)


def test_a_series_with_an_na_still_takes_the_skipping_path():
    import math
    from api.services import ast_interpret as A
    s = [1.0, 2.0, math.nan, 4.0, 5.0]
    got = A._rolling(s, 2, A._window_mean, A.NA_SKIP)
    assert got[1] == 1.5 and got[3] == 3.0 and got[4] == 4.5        # the na is skipped, never read as a value
