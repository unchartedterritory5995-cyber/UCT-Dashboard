"""Rails for the three UCT RS Phase 3 screener columns (engineering map unit
3-10, decision D7): `rrg_quadrant` (WEEKLY, vs SPY), `clenow_score` (DAILY, 90
closes, 4 dp) and `vars_state` (DAILY), written by `rs_columns.collect_one(...,
phase3=True)` inside the builder's `bars_rs` step, dark unless
`snapshot_builder.rs_v3_enabled()`.

Every expected value below is computed straight from `relative_strength` (unit
3-03) on the same bars, with the weekly series made by the ONE resampler
(`bars_fetch._resample_weekly_iso`) over the FULL daily series: the collector's
tail-first resample has to land on exactly that answer.

Synthetic bars throughout (seeded random walks on a weekday calendar, `t` as
YYYYMMDD ints like the screener's own bars). No bars.db, no network.
"""
from __future__ import annotations

import datetime as dt
import random

import pytest

import api.services.screener.snapshot_builder as b
from api.services import bars_fetch
from api.services import relative_strength as rs
from api.services.screener import rs_columns, snapshot_db
from api.services.signature import registry_defs
from tests.test_rs_fix_u3_screener import _no_provider, _stub_build  # noqa: F401  (autouse fixture)

THREE = ("rrg_quadrant", "clenow_score", "vars_state")
WINDOW = b.RS_WINDOW_BARS      # 652: the step's daily window


# ───────────────────────────── the fixture ──────────────────────────────────

def _weekdays(n, end=dt.date(2026, 11, 6)):
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= dt.timedelta(days=1)
    return sorted(out)


def _ymd(d: dt.date) -> int:
    return d.year * 10000 + d.month * 100 + d.day


def _walk(days, seed, drift=0.0004, vol=0.018, start=100.0):
    rnd = random.Random(seed)
    out, c = [], start
    for d in days:
        o = c
        c = max(0.5, c * (1.0 + rnd.gauss(drift, vol)))
        hi = max(o, c) * (1.0 + abs(rnd.gauss(0, 0.006)))
        lo = min(o, c) * (1.0 - abs(rnd.gauss(0, 0.006)))
        out.append({"t": _ymd(d), "o": o, "h": hi, "l": lo, "c": c, "v": 1000.0})
    return out


DAYS = _weekdays(5000)
SPY = _walk(DAYS, seed=1, drift=0.0003, vol=0.011, start=100.0)
RSP = _walk(DAYS, seed=2, drift=0.0003, vol=0.012, start=50.0)


def _iso_bars(bars):
    return [{**x, "t": f"{x['t'] // 10000:04d}-{x['t'] // 100 % 100:02d}-{x['t'] % 100:02d}"}
            for x in bars]


def _expected(full, spy=SPY):
    """The three columns straight from `relative_strength`, the slow way: the
    whole daily series resampled to weeks (ticker and SPY, SPY as of the
    ticker's newest bar), Clenow over the whole daily window, VARS over the
    window against SPY's own sessions in the window's span."""
    win = full[-WINDOW:]
    asof = full[-1]["t"]
    t_w = bars_fetch._resample_weekly_iso(_iso_bars(full))
    s_w = bars_fetch._resample_weekly_iso(_iso_bars([x for x in spy if x["t"] <= asof]))
    quad = rs.rrg_columns(t_w, s_w)["quadrant"][-1]
    score = rs.clenow_columns(win)["clenowScore"][-1]
    span = [x for x in spy if win[0]["t"] <= x["t"] <= win[-1]["t"]]
    state = rs.vars_columns(win, span)["varsState"][-1]
    return {
        "rrg_quadrant": rs.RRG_QUADRANT_NAMES[quad - 1] if quad else None,
        "clenow_score": round(score, 4) if score is not None else None,
        "vars_state": rs_columns.VARS_STATE_NAMES[state - 1] if state else None,
    }


def _collect(full, spy=SPY, rsp=RSP, **kw):
    return rs_columns.collect_one(full[-WINDOW:], spy, rsp, phase3=True, full=full, **kw)


@pytest.fixture
def rs_on(monkeypatch):
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    monkeypatch.setattr(registry_defs, "RS_V3_ENABLED", True, raising=False)


@pytest.fixture
def v3_off(monkeypatch):
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    monkeypatch.setattr(registry_defs, "RS_V3_ENABLED", False, raising=False)


# ───────────────────── the columns and their contract ───────────────────────

def test_the_three_are_declared_once_and_typed():
    assert rs_columns.PHASE3_COLUMNS == THREE
    assert not (set(THREE) & set(rs_columns.COLUMNS)), "the ten stay the ten"
    assert rs_columns.PHASE3_TEXT_COLUMNS == {"rrg_quadrant", "vars_state"}
    assert rs_columns.RRG_RATIO_LEN == rs.DEFAULT_RRG_RATIO_LEN == 10
    assert rs_columns.RRG_MOM_LEN == rs.DEFAULT_RRG_MOM_LEN == 5
    assert rs_columns.CLENOW_WINDOW == rs.DEFAULT_CLENOW_WINDOW == 90
    assert rs_columns.CLENOW_DP == 4
    assert rs_columns.VARS_STATE_NAMES == (
        "Strong, rising", "Strong, fading", "Weak, improving", "Weak, falling")
    assert rs.RRG_QUADRANT_NAMES == ("Leading", "Weakening", "Lagging", "Improving")
    assert rs_columns.PHASE3_MIN_BARS == {"rrg_quadrant": 14, "clenow_score": 90,
                                          "vars_state": 129}


@pytest.mark.parametrize("seed", [11, 12, 13])
def test_values_equal_relative_strength_on_5000_bar_series(seed):
    full = _walk(DAYS, seed=seed, drift=0.0006, vol=0.025)
    got = _collect(full)
    assert {c: got[c] for c in THREE} == _expected(full)
    assert all(got[c] is not None for c in THREE)
    assert set(got) == set(rs_columns.COLUMNS) | set(THREE)
    assert isinstance(got["clenow_score"], float)


def test_the_tail_first_quadrant_is_the_full_series_answer_on_every_session():
    """The collector resamples the last 260 daily bars first. Over 60 sessions
    of three names it must give exactly the full-series quadrant, and the
    sample has to visit all four quadrants for the check to mean anything."""
    seen_q, seen_v = set(), set()
    for seed in (21, 22, 23):
        full = _walk(DAYS, seed=seed, drift=0.0005, vol=0.022)
        for k in range(20):
            cut = full[:len(full) - 7 * k]
            got, want = _collect(cut), _expected(cut)
            assert got["rrg_quadrant"] == want["rrg_quadrant"], (seed, k)
            assert got["vars_state"] == want["vars_state"], (seed, k)
            assert got["clenow_score"] == want["clenow_score"], (seed, k)
            seen_q.add(got["rrg_quadrant"])
            seen_v.add(got["vars_state"])
    assert seen_q == set(rs.RRG_QUADRANT_NAMES), seen_q
    assert len(seen_v) >= 3, seen_v


def test_when_the_tail_has_no_quadrant_the_full_series_is_asked():
    """SPY with a 60-week hole that ends 10 weeks before today: the 260-bar
    tail joins only 10 weeks (no quadrant), the full series joins the weeks
    before the hole too (the averages skip a missing bar), so the answer exists
    and must be the full-series one."""
    hole_lo, hole_hi = _ymd(DAYS[-360]), _ymd(DAYS[-51])
    spy = [x for x in SPY if not (hole_lo <= x["t"] <= hole_hi)]
    full = _walk(DAYS, seed=31)
    tail_only = rs.rrg_columns(
        bars_fetch._resample_weekly_iso(_iso_bars(full[-rs_columns.RRG_DAILY_TAIL:])),
        bars_fetch._resample_weekly_iso(_iso_bars(spy)))["quadrant"][-1]
    assert tail_only is None, "the fixture must defeat the tail"
    got = _collect(full, spy=spy)
    want = _expected(full, spy=spy)
    assert want["rrg_quadrant"] is not None
    assert got["rrg_quadrant"] == want["rrg_quadrant"]


def test_a_stale_ticker_pairs_with_spys_week_to_its_own_newest_day():
    """The ticker's newest bar is a Wednesday while SPY runs to Friday: the
    ticker's week closes on Wednesday, so SPY's must too (never SPY's Friday)."""
    wed = max(i for i, d in enumerate(DAYS) if d.weekday() == 2 and i < len(DAYS) - 3)
    full = _walk(DAYS[:wed + 1], seed=41)
    assert SPY[-1]["t"] > full[-1]["t"]
    got = _collect(full)
    assert got["rrg_quadrant"] == _expected(full)["rrg_quadrant"]
    # control: against SPY's later Friday close the reading is a different sum
    s_w = bars_fetch._resample_weekly_iso(_iso_bars(SPY))
    t_w = bars_fetch._resample_weekly_iso(_iso_bars(full))
    late = rs.rrg_columns(t_w, s_w)["rsRatio"][-1]
    clipped = rs.rrg_columns(t_w, bars_fetch._resample_weekly_iso(
        _iso_bars([x for x in SPY if x["t"] <= full[-1]["t"]])))["rsRatio"][-1]
    assert late != clipped


def test_spys_weekly_resample_is_made_once_per_session_per_build():
    cache = {}
    a = _walk(DAYS, seed=51)
    c = _walk(DAYS, seed=52)
    _collect(a, weekly_cache=cache)
    _collect(c, weekly_cache=cache)
    assert len(cache) == 1
    _collect(a[:-1], weekly_cache=cache)            # a row a session behind
    assert len(cache) == 2
    # the cached path gives the uncached answer
    assert _collect(c, weekly_cache=cache) == _collect(c)


# ───────────────────── short history: None plus a count ─────────────────────

def test_short_history_is_none_and_counted_per_column():
    stats = {}
    got = _collect(_walk(DAYS[-50:], seed=61), stats=stats)       # 10 weeks, 50 days
    assert all(got[c] is None for c in THREE)
    assert stats == {"short": 1, "phase3_short:rrg_quadrant": 1,
                     "phase3_short:clenow_score": 1, "phase3_short:vars_state": 1}

    stats = {}
    got = _collect(_walk(DAYS[-100:], seed=62), stats=stats)      # 20 weeks, 100 days
    assert got["rrg_quadrant"] is not None and got["clenow_score"] is not None
    assert got["vars_state"] is None                              # needs 129
    assert stats == {"short": 1, "phase3_short:vars_state": 1}

    stats = {}
    got = _collect(_walk(DAYS[-130:], seed=63), stats=stats)
    assert all(got[c] is not None for c in THREE)
    assert stats == {"short": 1}

    stats = {}
    got = rs_columns.collect_one([], SPY, RSP, phase3=True, stats=stats)
    assert all(got[c] is None for c in THREE) and set(got) >= set(THREE)
    assert stats == {"short": 1, "phase3_short:rrg_quadrant": 1,
                     "phase3_short:clenow_score": 1, "phase3_short:vars_state": 1}


def test_a_flat_window_is_none_and_counted_as_none_not_short():
    days = DAYS[-300:]
    flat = [{"t": _ymd(d), "o": 50.0, "h": 50.0, "l": 50.0, "c": 50.0, "v": 1.0} for d in days]
    stats = {}
    got = _collect(flat, stats=stats)
    assert got["clenow_score"] is None, "a flat ln C has no R^2 (3-03's rule)"
    assert stats.get("phase3_none:clenow_score") == 1
    assert "phase3_short:clenow_score" not in stats


# ───────────────────── dark: nothing runs, nothing is spent ─────────────────

def _forbid_maths(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("a dark call reached the Phase 3 maths")
    for fn in ("rrg_columns", "clenow_columns", "vars_columns"):
        monkeypatch.setattr(rs, fn, boom)
    monkeypatch.setattr(bars_fetch, "_resample_weekly_iso", boom)


def test_a_dark_collect_returns_the_ten_and_runs_no_phase3_maths(monkeypatch):
    full = _walk(DAYS, seed=71)
    want = rs_columns.collect_one(full[-WINDOW:], SPY, RSP)
    _forbid_maths(monkeypatch)
    timing = {}
    got = rs_columns.collect_one(full[-WINDOW:], SPY, RSP, timing=timing)
    assert got == want and set(got) == set(rs_columns.COLUMNS)
    assert timing == {}


def test_flag_off_build_row_leaves_the_three_none_at_no_cost(v3_off, monkeypatch):
    full = _walk(DAYS, seed=72)
    seen = []
    real = rs_columns.collect_one

    def spy(bars, spy_bars, rsp_bars=None, **kw):
        seen.append(dict(kw))
        return real(bars, spy_bars, rsp_bars, **kw)
    monkeypatch.setattr(rs_columns, "collect_one", spy)
    _forbid_maths(monkeypatch)
    monkeypatch.setattr(b.candles, "weekly_candle", lambda bars: {})   # its own resample
    failures, timing = {}, {}
    row = b.build_row("AAA", full, None, None, failures=failures,
                      spy_bars=SPY, rsp_bars=RSP, rs_timing=timing)
    assert all(row[c] is None for c in THREE)
    assert row["mansfield"] is not None, "the ten still run under RS_V2"
    assert len(seen) == 1 and set(seen[0]) == {"session", "stats"}, seen
    assert "phase3_ms" not in timing
    assert failures["bars_rs"] == {"rated": 1}


def test_v3_armed_without_v2_writes_none_of_the_thirteen(monkeypatch):
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", False)
    monkeypatch.setattr(registry_defs, "RS_V3_ENABLED", True, raising=False)
    row = b.build_row("AAA", _walk(DAYS, seed=73), None, None, failures={},
                      spy_bars=SPY, rsp_bars=RSP)
    assert all(row[c] is None for c in (*rs_columns.COLUMNS, *THREE))


# ───────────────────── armed: the row, the receipt, the table ───────────────

def test_armed_build_row_writes_the_collectors_three(rs_on):
    full = _walk(DAYS, seed=81)
    failures, timing, cache = {}, {}, {}
    row = b.build_row("AAA", full, None, None, failures=failures, spy_bars=SPY,
                      rsp_bars=RSP, rs_timing=timing, rs_weekly_cache=cache)
    want = _expected(full)
    assert {c: row[c] for c in THREE} == want
    assert all(v is not None for v in want.values())
    assert timing["phase3_ms"] > 0 and timing["phase3_ms"] <= timing["ms"]
    assert len(cache) == 1
    assert failures["bars_rs"] == {"rated": 1}


def test_armed_run_build_times_phase3_and_persists_the_three(rs_on, tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "p3.db"))
    a, c = _walk(DAYS, seed=91), _walk(DAYS[-60:], seed=92)
    _stub_build(monkeypatch, {"AAA": a, "CCC": c, "SPY": SPY, "RSP": RSP})
    stats = b.run_build()
    assert stats["built"] == 2
    rcpt = stats["bars_rs"]
    assert rcpt["enabled"] is True and rcpt["phase3"] is True and rcpt["rows"] == 2
    assert 0 < rcpt["phase3_ms"] <= rcpt["ms"]
    src = stats["sources"]["bars_rs"]
    assert src["rated"] == 1 and src["short"] == 1
    assert src["phase3_short:rrg_quadrant"] == 1 and src["phase3_short:vars_state"] == 1
    assert src["phase3_short:clenow_score"] == 1
    for col in THREE:
        assert stats["populated"][col] == 1, col
    with snapshot_db.connect() as conn:
        r = conn.execute("SELECT rrg_quadrant, clenow_score, vars_state, "
                         "typeof(clenow_score) FROM screener_rows WHERE ticker='AAA'").fetchone()
        r2 = conn.execute("SELECT rrg_quadrant, clenow_score, vars_state "
                          "FROM screener_rows WHERE ticker='CCC'").fetchone()
    want = _expected(a)
    assert tuple(r)[:3] == (want["rrg_quadrant"], want["clenow_score"], want["vars_state"])
    assert r[3] == "real"
    assert tuple(r2) == (None, None, None)
    assert snapshot_db.last_build_run()["bars_rs"]["phase3_ms"] == rcpt["phase3_ms"]


def test_flag_off_run_build_receipt_says_phase3_off_and_zero(v3_off, tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "p3off.db"))
    _stub_build(monkeypatch, {"AAA": _walk(DAYS, seed=93), "SPY": SPY, "RSP": RSP})
    stats = b.run_build()
    rcpt = stats["bars_rs"]
    assert rcpt["enabled"] is True and rcpt["phase3"] is False and rcpt["phase3_ms"] == 0.0
    assert not any(k.startswith("phase3") for k in stats["sources"]["bars_rs"])
    for col in THREE:
        assert stats["populated"][col] == 0


# ───────────────────────────── the flag reader ──────────────────────────────

def test_rs_v3_enabled_reads_registry_defs_per_call(monkeypatch):
    monkeypatch.delenv("RS_V3_ENABLED", raising=False)
    monkeypatch.setattr(registry_defs, "RS_V3_ENABLED", True, raising=False)
    assert b.rs_v3_enabled() is True
    monkeypatch.setattr(registry_defs, "RS_V3_ENABLED", False, raising=False)
    assert b.rs_v3_enabled() is False
    # the attribute wins over the environment once it exists (3-05's tree)
    monkeypatch.setenv("RS_V3_ENABLED", "1")
    assert b.rs_v3_enabled() is False


def test_rs_v3_enabled_falls_back_to_the_environment_until_3_05_declares_it(monkeypatch):
    monkeypatch.delattr(registry_defs, "RS_V3_ENABLED", raising=False)
    monkeypatch.delenv("RS_V3_ENABLED", raising=False)
    assert b.rs_v3_enabled() is False, "dark by default"
    monkeypatch.setenv("RS_V3_ENABLED", "1")
    assert b.rs_v3_enabled() is True
    monkeypatch.setenv("RS_V3_ENABLED", "true")
    assert b.rs_v3_enabled() is False, "the RS_V2 test exactly: only '1' arms it"


def test_rs_v3_ships_dark():
    import os
    if hasattr(registry_defs, "RS_V3_ENABLED"):
        assert registry_defs.RS_V3_ENABLED is (os.environ.get("RS_V3_ENABLED", "0") == "1")
    if os.environ.get("RS_V3_ENABLED", "0") != "1":
        assert b.rs_v3_enabled() is False


# ───────────────────────────── the schema ───────────────────────────────────

def test_snapshot_db_declares_the_three_additively(tmp_path, monkeypatch):
    for col in THREE:
        assert snapshot_db.COLUMNS.count(col) == 1
    assert snapshot_db._coldef("rrg_quadrant") == "rrg_quadrant TEXT"
    assert snapshot_db._coldef("vars_state") == "vars_state TEXT"
    assert snapshot_db._coldef("clenow_score") == "clenow_score REAL"
    assert not (set(THREE) & snapshot_db.LIVE_ONLY_COLUMNS)
    assert rs_columns.PHASE3_TEXT_COLUMNS <= snapshot_db._TEXT

    import sqlite3
    db = tmp_path / "old.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(db))
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE screener_rows (ticker TEXT PRIMARY KEY, price REAL)")
    snapshot_db.init_db()
    with sqlite3.connect(db) as conn:
        info = {r[1]: r[2] for r in conn.execute("PRAGMA table_info(screener_rows)")}
    assert (info["rrg_quadrant"], info["clenow_score"], info["vars_state"]) == ("TEXT", "REAL", "TEXT")
