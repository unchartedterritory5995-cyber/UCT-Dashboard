"""RS screens unit U4, part A: the bar-derived RS screens columns in the nightly build.

``snapshot_builder.build_row`` writes thirteen columns while ``RS_SCREENS_ENABLED`` is on:

  * six last-bar measures of the RS line (``rs_columns.screen_fields``) in the
    ``bars_rs_screens`` step, inside the RS_V2 ``bars_rs`` gate, reusing that step's
    Phase 1 pass (measured 0.10 ms a ticker handed in, 2.67 ms recomputed);
  * the Setup label and its inputs (``rs_setup.label`` over ``technicals.setup_inputs``)
    in the ``bars_rs_setup`` step, after the row's base pivot and tightness are final.

Why each rail exists:
  * off, the build must cost and write exactly what it did (the flag is dark in production);
  * a label is member-facing words ("At pivot", "Buyout pending"), so every input that
    reaches it is pinned to the row's own stored value, and a series the build already
    refuses to trust gets no label at all;
  * a raise in either step costs that step's columns, never the row or the ten RS columns.

Synthetic bars throughout (the fixture universe of ``tests/test_screener_rs_columns.py``).
"""
from __future__ import annotations

import ast as pyast
import importlib
import pathlib
import sqlite3

import pytest

from api.services.screener import (bases, candles, rs_columns, rs_setup, snapshot_db,
                                   technicals)
from api.services.screener import snapshot_builder as sb
from tests.test_screener_rs_columns import AAA, CCC, RSP, SPY, TIMES, _arm_rs_v2, _bars

SCREEN = tuple(rs_columns.SCREEN_COLUMNS)
SETUP = tuple(sb.RS_SETUP_COLUMNS)
THIRTEEN = SCREEN + SETUP
TEN = tuple(rs_columns.COLUMNS)


@pytest.fixture
def on(monkeypatch):
    _arm_rs_v2(monkeypatch)
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")


def _series(closes, times=None, spread=1.0):
    times = TIMES[-len(closes):] if times is None else times
    return [{"t": t, "o": float(c), "h": float(c) + spread, "l": float(c) - spread,
             "c": float(c), "v": 1000} for t, c in zip(times, closes)]


def _row(bars, name="AAA", **kw):
    failures = {}
    row = sb.build_row(name, bars, None, None, failures=failures, spy_bars=SPY, rsp_bars=RSP, **kw)
    return row, failures


# ───────────────────────── the thirteen, and the flag ─────────────────────────

def test_the_thirteen_columns_are_the_contracts():
    assert SCREEN == ("rs_nh_count_20", "rs_nh_quiet", "rs_nh_red_bars_ago",
                      "px_below_high_pct", "rs_nhbp_age", "rs_nh_span")
    assert SETUP == ("rs_setup", "rs_tight", "rs_flag", "rs_near_buy",
                     "atr_ext_ema21", "pct_vs_ema8", "pct_vs_ema21")
    assert len(set(THIRTEEN)) == 13 and not (set(THIRTEEN) & set(TEN))


def test_flag_on_the_build_writes_the_six_measures_from_the_same_bars(on):
    """AAA gains 0.1% a day against a flat SPY that dips 1% on session 290: the RS line
    made a new high on every session to 290 (the dip is a spike in the ratio) and none in
    the nine since. Hand-derived: 11 of the last 20 sessions (280 to 290) were RS highs,
    the newest came the session after the one before it, it fell on a market down day 9
    sessions ago, the close is its own 252-session high, and price has made a high since."""
    row, failures = _row(AAA)
    assert {c: row[c] for c in SCREEN} == {
        "rs_nh_count_20": 11, "rs_nh_quiet": 1, "rs_nh_red_bars_ago": 9,
        "px_below_high_pct": 0.0, "rs_nhbp_age": None, "rs_nh_span": None}
    assert {c: row[c] for c in SCREEN} == rs_columns.screen_fields(AAA, SPY)
    assert row["rs_nh_bars_ago"] == 9, "the ten still land beside them"
    assert "bars_rs_screens" not in failures and "bars_rs_setup" not in failures
    # a window too short for a 252-session high: every measure blank, never a guess
    row, _ = _row(CCC, "CCC")
    assert [row[c] for c in SCREEN] == [None] * 6


def test_flag_off_the_build_writes_none_and_calls_none(monkeypatch):
    """Dark is the production state: no column, no call, and the `bars_rs` call is the
    one it was (no new keyword reaches the collector)."""
    _arm_rs_v2(monkeypatch)
    monkeypatch.delenv("RS_SCREENS_ENABLED", raising=False)
    calls, kwargs_seen = [], []
    real = rs_columns.collect_one

    def _collect(*a, **k):
        kwargs_seen.append(sorted(k))
        return real(*a, **k)

    def _spy(name):
        def _f(*a, **k):
            calls.append(name)
            raise AssertionError(f"{name} ran while RS_SCREENS_ENABLED is off")
        return _f
    monkeypatch.setattr(rs_columns, "collect_one", _collect)
    monkeypatch.setattr(rs_columns, "screen_fields", _spy("screen_fields"))
    monkeypatch.setattr(technicals, "setup_inputs", _spy("setup_inputs"))
    monkeypatch.setattr(rs_setup, "label", _spy("label"))
    timing = {}
    row, failures = _row(AAA, rs_timing=timing)
    assert calls == []
    assert [row[c] for c in THIRTEEN] == [None] * 13
    assert kwargs_seen == [["session", "stats"]]
    assert row["rs_nh_bars_ago"] == 9 and failures == {"bars_rs": {"rated": 1}}
    assert sorted(timing) == ["ms", "rows"], "a dark row adds no timing key"
    monkeypatch.setenv("RS_SCREENS_ENABLED", "true")
    assert sb.rs_screens_enabled() is False, "only the literal 1 arms it"


def test_the_six_reuse_the_ten_s_phase_1_pass(on, monkeypatch):
    """One Phase 1 pass per row, not two: the six are handed the columns the ten computed."""
    n = []
    real = rs_columns.rs.compute_phase1_columns

    def _counted(*a, **k):
        n.append(1)
        return real(*a, **k)
    monkeypatch.setattr(rs_columns.rs, "compute_phase1_columns", _counted)
    row, _ = _row(AAA)
    assert row["rs_nh_count_20"] == 11
    assert len(n) == 1, "the screens step recomputed Phase 1"


def test_collect_one_hands_its_phase_1_out_and_changes_no_value():
    out = {}
    assert rs_columns.collect_one(AAA, SPY, RSP, phase1_out=out) == rs_columns.collect_one(AAA, SPY, RSP)
    assert set(rs_columns.SCREEN_PHASE1_READS) <= set(out["phase1"])
    assert len(out["phase1"]["rsLine"]) == len(AAA)
    assert rs_columns.screen_fields(AAA, SPY, phase1=out["phase1"]) == rs_columns.screen_fields(AAA, SPY)
    # no benchmark: Phase 1 never ran, and nothing is handed out
    out = {}
    rs_columns.collect_one(AAA, [], RSP, phase1_out=out)
    assert out == {}


# ───────────────────────── the label and the flags reach the row ─────────────────────────

def test_the_label_is_rs_setups_answer_over_the_rows_own_values(on):
    """The seven are exactly `rs_setup.label` over `technicals.setup_inputs` of the 400-bar
    window, with the pivot and the tightness the ROW holds."""
    row, _ = _row(AAA)
    inp = technicals.setup_inputs(technicals.usable_bars(AAA[-400:]))
    res = rs_setup.label({**inp, "pivot": row["base_pivot_px"],
                          "tight_consolidation": row["tight_consolidation"],
                          "closes": [b["c"] for b in AAA[-64:]]})
    assert (row["rs_setup"], row["rs_tight"], row["rs_flag"]) == (res["setup"], res["tight"], res["flag"])
    # hand-read: a steady riser sitting on its rising 8-day average, in a tight range
    assert (row["rs_setup"], row["rs_tight"], row["rs_flag"], row["rs_near_buy"]) == ("pullback_8", 1, None, 1)
    assert row["atr_ext_ema21"] == inp["atr_ext_ema21"] == 1.0
    assert row["pct_vs_ema8"] == round((inp["close"] - inp["ema8"]) / inp["ema8"] * 100, 2) == 0.35
    assert row["pct_vs_ema21"] == round((inp["close"] - inp["ema21"]) / inp["ema21"] * 100, 2) == 1.0
    assert row["tight_consolidation"] is True and isinstance(row["rs_tight"], int)


@pytest.mark.parametrize("name, closes, spread, expect", [
    # +1 a day for 300 sessions: 12.25 ATR above its 50-day line
    ("RISE", [100.0 + i for i in range(300)], 1.0,
     {"rs_setup": "extended", "rs_flag": None, "rs_near_buy": 0, "atr_ext_ema21": 5.0}),
    # 60 sessions, falling: under its 50-day line, and a new issue
    ("FALL", [200.0 - i for i in range(60)], 1.0,
     {"rs_setup": "below_50", "rs_flag": "new_issue", "rs_near_buy": 0, "atr_ext_ema21": -5.0}),
    # a 30% jump held flat for five sessions: the pinned price of a deal
    ("DEAL", [100.0] * 294 + [130.0] * 6, 0.0,
     {"rs_setup": "extended", "rs_flag": "buyout_pending", "rs_near_buy": 0, "rs_tight": 0}),
    # the same jump three sessions old: not a deal yet (the tightened rule), a one-day move
    ("GAP", [100.0] * 296 + [130.0] * 4, 0.0,
     {"rs_setup": "extended", "rs_flag": "one_day_move", "rs_near_buy": 0}),
])
def test_each_label_and_flag_reaches_its_row(on, name, closes, spread, expect):
    row, failures = _row(_series(closes, spread=spread), name)
    assert {k: row[k] for k in expect} == expect
    assert "bars_rs_setup" not in failures


def test_the_pivot_and_the_tightness_are_the_rows_own(on, monkeypatch):
    """`pivot` is the `base_pivot_px` this build's `bases.classify` returned, and
    `tight_consolidation` the multi-candle step's: change either and the label follows."""
    close = AAA[-1]["c"]
    real_classify, real_multi = bases.classify, candles.multi_candle

    def _with_pivot(px):
        monkeypatch.setattr(bases, "classify",
                            lambda bars, bars_full=None: {**real_classify(bars, bars_full=bars_full),
                                                          "base_pivot_px": px})
    _with_pivot(close)                                   # at the pivot
    row, _ = _row(AAA)
    assert row["base_pivot_px"] == close
    assert (row["rs_setup"], row["rs_near_buy"]) == ("at_pivot", 1)
    _with_pivot(close / 1.06)                            # 6% past it: beyond the 5% zone
    row, _ = _row(AAA)
    assert (row["rs_setup"], row["rs_near_buy"]) == ("extended", 0)
    _with_pivot(None)
    monkeypatch.setattr(candles, "multi_candle",
                        lambda bars: {**real_multi(bars), "tight_consolidation": False})
    row, _ = _row(AAA)
    assert (row["rs_setup"], row["rs_tight"], row["rs_near_buy"]) == ("pullback_8", 0, 1)
    # tight alone is what makes "Uptrend, no setup" near a buy point: a riser held off its
    # averages (no pullback) reads uptrend, and near only while the range is tight
    monkeypatch.setattr(rs_setup, "PULLBACK_ATR_BAND", -100.0)
    row, _ = _row(AAA)
    assert (row["rs_setup"], row["rs_tight"], row["rs_near_buy"]) == ("uptrend", 0, 0)
    monkeypatch.setattr(candles, "multi_candle",
                        lambda bars: {**real_multi(bars), "tight_consolidation": True})
    row, _ = _row(AAA)
    assert (row["rs_setup"], row["rs_tight"], row["rs_near_buy"]) == ("uptrend", 1, 1)


def test_no_setup_means_no_near_answer_rather_than_a_zero(on):
    """Fourteen bars: no 50-day line, so no label. `rs_near_buy` is blank, not 0: a 0
    would say the row was checked and is not near."""
    row, _ = _row(_series([50.0 + i for i in range(14)]), "TINY")
    assert row["rs_setup"] is None and row["rs_near_buy"] is None
    assert row["rs_flag"] == "new_issue", "the flag does not need the label"


def test_the_setup_label_needs_no_benchmark_but_the_six_do(on):
    failures = {}
    row = sb.build_row("AAA", AAA, None, None, failures=failures)      # no SPY this build
    assert [row[c] for c in SCREEN] == [None] * 6
    assert row["rs_setup"] == "pullback_8" and row["pct_vs_ema8"] == 0.35
    assert "bars_rs" not in failures


# ───────────────────────── fail closed ─────────────────────────

def test_a_series_that_contradicts_itself_gets_no_label(on):
    """Three halve-and-recover round trips: the build already withholds every statistic
    whose window holds a seam, and the label's averages are smoothed over all of them."""
    closes = [100.0] * 300
    for i in (250, 251, 260, 261, 270, 271):
        closes[i] = 50.0
    bars = _bars(closes)
    assert technicals.series_contradicts_itself(bars)[0] is True
    assert "dist_52w_high_pct" in technicals.seam_withheld_columns(bars)
    row, failures = _row(bars, "SEAM")
    assert [row[c] for c in SETUP] == [None] * 7
    assert row["px_below_high_pct"] is None, "it reads the same 252 closes as dist_52w_high_pct"
    assert failures["bars_rs_setup"] == {"series_contradicts_itself": 1}
    assert row["ticker"] == "SEAM" and row["bars_asof"] == str(bars[-1]["t"])


def test_a_raising_step_costs_its_own_columns_only(on, monkeypatch):
    def _boom(*a, **k):
        raise RuntimeError("dead")
    monkeypatch.setattr(rs_columns, "screen_fields", _boom)
    row, failures = _row(AAA)
    assert [row[c] for c in SCREEN] == [None] * 6
    assert failures["bars_rs_screens"] == {"RuntimeError": 1}
    assert row["rs_nh_bars_ago"] == 9 and row["rs_setup"] == "pullback_8"
    monkeypatch.undo()
    _arm_rs_v2(monkeypatch)
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    monkeypatch.setattr(technicals, "setup_inputs", _boom)
    row, failures = _row(AAA)
    assert [row[c] for c in SETUP] == [None] * 7
    assert failures["bars_rs_setup"] == {"RuntimeError": 1}
    assert row["rs_nh_count_20"] == 11 and row["price"] == AAA[-1]["c"]


def test_the_two_steps_sit_where_their_inputs_are_final():
    """Read from the source: the six right after `bars_rs` (they reuse its pass); the label
    after the base, the multi-candle step and the seam scan (it reads what they leave)."""
    src = pathlib.Path(sb.__file__).read_text(encoding="utf-8")
    found = []
    for node in pyast.walk(pyast.parse(src)):
        if (isinstance(node, pyast.Call) and isinstance(node.func, pyast.Name)
                and node.func.id == "_step" and node.args
                and isinstance(node.args[0], pyast.Constant)):
            found.append((node.lineno, node.args[0].value))
    labels = [label for _, label in sorted(found)]
    assert labels.index("bars_rs_screens") == labels.index("bars_rs") + 1
    for before in ("bars_structure", "bars_multi_candle", "bars_seam_scan"):
        assert labels.index("bars_rs_setup") > labels.index(before), before


# ───────────────────────── the whole build, and its receipt ─────────────────────────

def _stub_build(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "rs.db"))
    import api.services.screener.snapshot_builder as b
    import api.services.screener.snapshot_db as sdb
    importlib.reload(sdb)
    importlib.reload(b)
    series = {"AAA": AAA, "CCC": CCC, "SPY": SPY, "RSP": RSP}
    monkeypatch.setattr(b, "_load_universe", lambda: ["AAA", "CCC"])
    monkeypatch.setattr(b, "_read_daily_bars", lambda t: list(series.get(t, [])))
    monkeypatch.setattr(b, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(b, "_read_fundamentals", lambda t, price=None, failures=None: {})
    monkeypatch.setattr(b, "_read_rs_map", lambda: {})
    monkeypatch.setattr(b, "_read_bulk_fundamentals", lambda targets, failures=None: {})
    from api.services.screener import context_joins as cj
    for fn in ("read_breadth_flags", "read_uct20", "read_index_flags", "read_etf_flags"):
        monkeypatch.setattr(cj, fn, lambda targets, failures=None: {})
    return b, sdb


def test_run_build_stores_the_columns_and_times_the_new_work(on, tmp_path, monkeypatch):
    b, sdb = _stub_build(monkeypatch, tmp_path)
    stats = b.run_build()
    assert stats["built"] == 2 and stats["errors"] == 0
    t = stats["bars_rs"]
    assert t["screens"] is True and t["screens_rows"] == 2 and t["rows"] == 2
    assert isinstance(t["screens_ms"], float) and t["screens_ms"] >= 0
    assert t["screens_ms_per_row"] == round(t["screens_ms"] / 2, 3)
    assert t["ms_per_row"] == round(t["ms"] / 2, 2), "the ten's own figure is untouched"
    assert stats["populated"]["rs_setup"] == 2 and stats["populated"]["rs_nh_count_20"] == 1
    assert not ({"rs_setup", "rs_nh_count_20", "px_below_high_pct"} & set(stats["empty_columns"]))
    with sdb.connect() as conn:
        got = dict(conn.execute(f"SELECT {', '.join(THIRTEEN)} FROM screener_rows "
                                "WHERE ticker = 'AAA'").fetchone())
    assert got == {"rs_nh_count_20": 11, "rs_nh_quiet": 1, "rs_nh_red_bars_ago": 9,
                   "px_below_high_pct": 0.0, "rs_nhbp_age": None, "rs_nh_span": None,
                   "rs_setup": "pullback_8", "rs_tight": 1, "rs_flag": None, "rs_near_buy": 1,
                   "atr_ext_ema21": 1.0, "pct_vs_ema8": 0.35, "pct_vs_ema21": 1.0}
    assert sdb.last_build_run()["bars_rs"]["screens_rows"] == 2, "the receipt is stored"


def test_flag_off_run_build_reports_exactly_as_it_did(tmp_path, monkeypatch):
    _arm_rs_v2(monkeypatch)
    monkeypatch.delenv("RS_SCREENS_ENABLED", raising=False)
    b, sdb = _stub_build(monkeypatch, tmp_path)
    stats = b.run_build()
    assert stats["built"] == 2
    assert sorted(stats["bars_rs"]) == ["enabled", "ms", "ms_per_row", "phase3", "phase3_ms", "rows"]
    assert all(stats["populated"][c] == 0 for c in THIRTEEN)
    with sdb.connect() as conn:
        got = conn.execute(f"SELECT {', '.join(THIRTEEN)} FROM screener_rows").fetchall()
    assert all(v is None for r in got for v in tuple(r))


# ───────────────────────── the schema ─────────────────────────

def test_the_thirteen_columns_are_declared_with_their_types(tmp_path, monkeypatch):
    kinds = {"px_below_high_pct": "REAL", "atr_ext_ema21": "REAL", "pct_vs_ema8": "REAL",
             "pct_vs_ema21": "REAL", "rs_setup": "TEXT", "rs_flag": "TEXT"}
    for c in THIRTEEN:
        assert snapshot_db.COLUMNS.count(c) == 1, c
        assert snapshot_db._coldef(c) == f"{c} {kinds.get(c, 'INTEGER')}", c
    assert set(rs_columns.SCREEN_INT_COLUMNS) <= snapshot_db._INT
    assert not (set(THIRTEEN) & snapshot_db.POST_PASS_COLUMNS), "the build loop writes these"
    assert not (set(THIRTEEN) & snapshot_db.LIVE_ONLY_COLUMNS)
    assert not (snapshot_db._INT & snapshot_db._TEXT)
    # a table from before this unit gains them on init
    db = tmp_path / "old.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(db))
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE screener_rows (ticker TEXT PRIMARY KEY, price REAL)")
    snapshot_db.init_db()
    with sqlite3.connect(db) as conn:
        info = {r[1]: r[2] for r in conn.execute("PRAGMA table_info(screener_rows)")}
    for c in THIRTEEN:
        assert info[c] == kinds.get(c, "INTEGER"), c
