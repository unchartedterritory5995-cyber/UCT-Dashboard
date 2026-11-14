"""RS screens unit U9, part 1: the shadow Leader score's two bar inputs.

``rs_steady`` (``relative_strength.steady_last``) and ``rs_line_below_high_pct``
(``relative_strength.close_below_high_pct_last`` asked of the RS line) are computed in
the build's RS step while ``RS_LEADER_SHADOW_ENABLED`` is on, and leave it through an
out-dict into the side table ``rs_leader_shadow``. They are never keys of the screener
row: a scan serves every column of that row to members.

Why each rail exists:
  * the Steady measure is a published definition with a sign that is easy to get
    backwards, so every case is counted by hand below;
  * off, the build must cost and write exactly what it did (the flag is dark in production);
  * a value that cannot be computed is blank, and yesterday's value never stands beside
    today's row;
  * nothing about the step may reach the build receipt, which members can read.

Synthetic bars throughout (the fixture universe of ``tests/test_screener_rs_columns.py``).
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from api.services import relative_strength as rs
from api.services.screener import rs_columns, rs_leader_shadow, snapshot_db, technicals
from api.services.screener import snapshot_builder as sb
from tests.test_screener_rs_columns import (AAA, BBB, CCC, FFF, RSP, SPY, TIMES, _arm_rs_v2,
                                            _bars)

SHADOW = ("rs_steady", "rs_line_below_high_pct")
#: AAA's RS line: it gains 0.1% a session against a flat SPY that closes 1% lower on
#: session 290 only. That session's ratio (1.001^290 / 0.99) is the highest of the last
#: 252, and the newest (1.001^299 / 1.00) sits 1.001^9 x 0.99 - 1 = -0.1054% under it.
AAA_RS_BELOW_HIGH = -0.11


def _closes(moves, start=100.0):
    out = [start]
    for m in moves:
        out.append(out[-1] + m)
    return out


def _window(up, down, flat, *, up_size=1.0, down_size=0.5, tail=None):
    """253 closes: 231 daily moves inside the window (sessions t-251 .. t-21), then the
    newest 21 sessions, which the measure must not read."""
    assert up + down + flat == 231
    moves = [up_size] * up + [-down_size] * down + [0.0] * flat
    return _closes(moves + (tail if tail is not None else [0.25] * 21))


# ───────────────────────── steady_last, counted by hand ──────────────────────

def test_the_window_constants_are_the_plans():
    assert (rs.STEADY_FAR, rs.STEADY_NEAR, rs.STEADY_MIN_SESSIONS) == (252, 21, 126)


def test_a_winner_that_rose_on_most_days_scores_high():
    """150 up days, 60 down days, 21 unchanged, in a window that ended higher than it
    began (150 x 1.0 - 60 x 0.5 = +120): (150 - 60) / 231."""
    closes = _window(150, 60, 21)
    assert len(closes) == 253 and closes[231] - closes[0] == pytest.approx(120.0)
    assert rs.steady_last(closes) == pytest.approx(90 / 231)


def test_a_winner_made_by_a_few_big_days_scores_near_zero():
    """116 small up days and 115 down days, still a gain: (116 - 115) / 231. The same
    return in jumps is the choppy climb the measure is there to mark down."""
    closes = _window(116, 115, 0, up_size=2.0, down_size=1.0)
    assert closes[231] > closes[0]
    assert rs.steady_last(closes) == pytest.approx(1 / 231)


def test_the_sign_of_the_return_flips_the_spread():
    """A loser that fell on most days is as smooth as a winner that rose on most:
    60 up, 150 down, the window ends lower, so -1 x (60 - 150) / 231 = +90 / 231.
    And a WINNER that fell on most days (few large up days) is negative."""
    loser = _window(60, 150, 21, up_size=0.1, down_size=0.2, tail=[-0.01] * 21)
    assert loser[231] < loser[0]
    assert rs.steady_last(loser) == pytest.approx(90 / 231)
    jumpy = _window(60, 150, 21, up_size=3.0, down_size=0.1)
    assert jumpy[231] > jumpy[0]
    assert rs.steady_last(jumpy) == pytest.approx(-90 / 231)


def test_an_unchanged_day_is_in_neither_share_and_still_a_day():
    """100 up days and 131 unchanged days: 100 / 231, not 100 / 100."""
    assert rs.steady_last(_window(100, 0, 131)) == pytest.approx(100 / 231)


def test_a_flat_window_is_zero():
    """20 up days of 0.5 and 10 down days of 1.0: twice as many up days as down days,
    and the return over the window is exactly 0, so the sign is 0 and so is the value
    (not the 10 / 231 the day counts alone would give)."""
    closes = _window(20, 10, 201, up_size=0.5, down_size=1.0)
    assert closes[231] == closes[0]
    assert rs.steady_last(closes) == 0.0


def test_the_newest_21_sessions_and_anything_older_than_252_are_not_read():
    base = _window(150, 60, 21)
    wild = _window(150, 60, 21, tail=[-4.0, 9.0, -3.0] * 7)
    assert rs.steady_last(wild) == rs.steady_last(base)
    older = [5.0, 900.0, 3.0] + base
    assert rs.steady_last(older) == rs.steady_last(base)
    # ... and the window's own two end closes ARE read: moving either changes the count
    nudged = list(base)
    nudged[231] = nudged[230] - 0.01              # C[t-21]: an up day becomes a down day
    assert rs.steady_last(nudged) != rs.steady_last(base)


def test_a_young_stock_needs_half_a_year_of_the_window():
    """147 closes hold exactly 126 closes of the window (the first one to C[t-21]);
    146 hold 125, and there is no value."""
    rising = [100.0 + i for i in range(147)]
    assert rs.steady_last(rising) == 1.0
    assert rs.steady_last(rising[1:]) is None
    assert rs.steady_last([]) is None and rs.steady_last([100.0] * 21) is None


def test_a_hole_in_the_window_is_no_value():
    closes = _window(150, 60, 21)
    for bad in (None, 0.0, -1.0, float("nan")):
        holed = list(closes)
        holed[100] = bad
        assert rs.steady_last(holed) is None, bad
    late = list(closes)
    late[240] = None                              # inside the newest 21: not read
    assert rs.steady_last(late) == pytest.approx(90 / 231)


# ───────────────────────── shadow_fields, on the fixture ─────────────────────

def test_the_two_inputs_for_a_steady_leader():
    got = rs_columns.shadow_fields(AAA, SPY)
    assert tuple(got) == SHADOW == rs_columns.SHADOW_COLUMNS
    assert got == {"rs_steady": 1.0, "rs_line_below_high_pct": AAA_RS_BELOW_HIGH}
    assert round((1.001 ** 9 * 0.99 - 1) * 100, 2) == AAA_RS_BELOW_HIGH


def test_a_steady_decliner_is_steady_too_and_its_rs_line_is_far_from_its_high():
    """FFF fell 0.1% on each of 279 sessions and rose 1% on each of the last 20: every
    day of the window was a down day in a window that ended lower, so 1.0. Its RS line
    (SPY flat but for one session) was highest on the first of the 252 sessions, 231
    falling sessions and 20 rising ones ago: 0.999^231 x 1.01^20 - 1 = -3.16%."""
    got = rs_columns.shadow_fields(FFF, SPY)
    assert got["rs_steady"] == 1.0
    assert round((0.999 ** 231 * 1.01 ** 20 - 1) * 100, 2) == -3.16
    assert got["rs_line_below_high_pct"] == -3.16


def test_the_rs_line_measure_is_the_price_measure_asked_of_the_rs_line():
    """Against a benchmark that never moves the RS line IS the close (over 100), so the
    two below-high measures must agree."""
    flat = _bars([100.0] * 300)
    bars = _bars(_closes([0.5] * 200 + [-0.2] * 99))
    assert (rs_columns.shadow_fields(bars, flat)["rs_line_below_high_pct"]
            == rs_columns.screen_fields(bars, flat)["px_below_high_pct"] < 0)


def test_blank_per_input_never_per_row():
    # 100 bars: under the 126-close window and under 252 RS readings
    assert rs_columns.shadow_fields(CCC, SPY) == {"rs_steady": None,
                                                 "rs_line_below_high_pct": None}
    # no benchmark at all: the stock's own input still stands
    assert rs_columns.shadow_fields(AAA, []) == {"rs_steady": 1.0,
                                                 "rs_line_below_high_pct": None}
    # SPY has no bar at the newest time: no RS reading for today
    assert rs_columns.shadow_fields(AAA, SPY[:-1])["rs_line_below_high_pct"] is None
    # one bar of the 252 has no RS reading (a date SPY does not hold): no honest maximum
    assert rs_columns.shadow_fields(BBB, SPY) == {"rs_steady": 1.0,
                                                 "rs_line_below_high_pct": None}
    assert rs_columns.shadow_fields([], SPY) == {"rs_steady": None,
                                                "rs_line_below_high_pct": None}


def test_session_clips_and_a_handed_in_phase_1_is_reused(monkeypatch):
    early = rs_columns.shadow_fields(AAA, SPY, session=TIMES[280])
    assert early == rs_columns.shadow_fields(AAA[:281], SPY)
    assert early["rs_line_below_high_pct"] == 0.0, "before the dip the line is at its high"
    p1 = rs.compute_phase1_columns(AAA, SPY)
    monkeypatch.setattr(rs_columns.rs, "compute_phase1_columns",
                        lambda *a, **k: pytest.fail("Phase 1 recomputed"))
    assert rs_columns.shadow_fields(AAA, SPY, phase1=p1)["rs_line_below_high_pct"] == AAA_RS_BELOW_HIGH


def test_values_are_rounded_and_never_a_negative_zero():
    mixed = _bars(_window(150, 60, 21) + [130.0] * 47)
    got = rs_columns.shadow_fields(mixed, SPY)
    assert got["rs_steady"] == round(got["rs_steady"], 4)
    hair = _bars([100.0] * 298 + [120.0, 119.9999])
    below = rs_columns.shadow_fields(hair, _bars([100.0] * 300))["rs_line_below_high_pct"]
    assert below == 0.0 and str(below) == "0.0"


# ───────────────────────── the build, and the flag ───────────────────────────

@pytest.fixture
def on(monkeypatch):
    _arm_rs_v2(monkeypatch)
    monkeypatch.setenv("RS_LEADER_SHADOW_ENABLED", "1")


def _row(bars, name="AAA", **kw):
    failures = {}
    row = sb.build_row(name, bars, None, None, failures=failures, spy_bars=SPY, rsp_bars=RSP, **kw)
    return row, failures


def test_only_the_literal_1_arms_the_flag(monkeypatch):
    monkeypatch.delenv("RS_LEADER_SHADOW_ENABLED", raising=False)
    assert rs_leader_shadow.enabled() is False and sb.rs_leader_shadow_enabled() is False
    for v in ("true", "yes", "0", " 1", "on"):
        monkeypatch.setenv("RS_LEADER_SHADOW_ENABLED", v)
        assert rs_leader_shadow.enabled() is False, v
    monkeypatch.setenv("RS_LEADER_SHADOW_ENABLED", "1")
    assert rs_leader_shadow.enabled() is True and sb.rs_leader_shadow_enabled() is True


def test_flag_on_the_build_hands_the_inputs_out_and_the_row_never_carries_them(on):
    out = {}
    row, failures = _row(AAA, shadow_out=out)
    assert out == {"AAA": {"rs_steady": 1.0, "rs_line_below_high_pct": AAA_RS_BELOW_HIGH,
                           "bars_asof": str(AAA[-1]["t"])}}
    assert out["AAA"]["bars_asof"] == row["bars_asof"]
    assert not (set(SHADOW) & set(row)), "a shadow input became a key of the served row"
    assert failures == {"bars_rs": {"rated": 1}}, "no step label of its own in the receipt"
    # a row too short for either: written as blanks, stamped with its own bars
    row, _ = _row(CCC, "CCC", shadow_out=out)
    assert out["CCC"] == {"rs_steady": None, "rs_line_below_high_pct": None,
                          "bars_asof": row["bars_asof"]}


def test_flag_off_nothing_is_computed_and_the_rs_call_is_the_one_it_was(monkeypatch):
    _arm_rs_v2(monkeypatch)
    monkeypatch.delenv("RS_LEADER_SHADOW_ENABLED", raising=False)
    monkeypatch.delenv("RS_SCREENS_ENABLED", raising=False)
    kwargs_seen = []
    real = rs_columns.collect_one

    def _collect(*a, **k):
        kwargs_seen.append(sorted(k))
        return real(*a, **k)
    monkeypatch.setattr(rs_columns, "collect_one", _collect)
    monkeypatch.setattr(rs_columns, "shadow_fields",
                        lambda *a, **k: pytest.fail("shadow_fields ran while the flag is off"))
    out, timing = {}, {}
    row, failures = _row(AAA, shadow_out=out, rs_timing=timing)
    assert out == {} and kwargs_seen == [["session", "stats"]]
    assert failures == {"bars_rs": {"rated": 1}} and sorted(timing) == ["ms", "rows"]
    assert row["rs_nh_bars_ago"] == 9


def test_flag_on_with_no_out_dict_nothing_is_computed(on, monkeypatch):
    """A caller that will not store the inputs (every caller but the nightly build)."""
    monkeypatch.setattr(rs_columns, "shadow_fields",
                        lambda *a, **k: pytest.fail("shadow_fields ran with nowhere to put it"))
    row, _ = _row(AAA)
    assert row["rs_nh_bars_ago"] == 9 and not (set(SHADOW) & set(row))


def test_the_inputs_reuse_the_rs_step_s_phase_1_pass(on, monkeypatch):
    n = []
    real = rs_columns.rs.compute_phase1_columns

    def _counted(*a, **k):
        n.append(1)
        return real(*a, **k)
    monkeypatch.setattr(rs_columns.rs, "compute_phase1_columns", _counted)
    out = {}
    _row(AAA, shadow_out=out)
    assert out["AAA"]["rs_line_below_high_pct"] == AAA_RS_BELOW_HIGH
    assert len(n) == 1, "the shadow inputs recomputed Phase 1"
    # with the RS screens step on too it is still one pass for all three readers
    n.clear()
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    row, _ = _row(AAA, shadow_out=out)
    assert len(n) == 1 and row["rs_nh_count_20"] == 11


def test_a_raise_costs_the_two_inputs_and_is_named_in_no_receipt(on, monkeypatch):
    def _boom(*a, **k):
        raise ZeroDivisionError("shadow")
    monkeypatch.setattr(rs_columns, "shadow_fields", _boom)
    out = {}
    row, failures = _row(AAA, shadow_out=out)
    assert out == {"AAA": {"rs_steady": None, "rs_line_below_high_pct": None,
                           "bars_asof": row["bars_asof"]}}
    assert failures == {"bars_rs": {"rated": 1}}
    assert row["rs_nh_bars_ago"] == 9 and row["price"] == AAA[-1]["c"]


def test_a_series_the_build_refuses_to_trust_gets_no_input(on, monkeypatch):
    monkeypatch.setattr(technicals, "seam_withheld_columns", lambda bars: {"dist_52w_high_pct"})
    out = {}
    row, _ = _row(AAA, shadow_out=out)
    assert out["AAA"] == {"rs_steady": None, "rs_line_below_high_pct": None,
                          "bars_asof": row["bars_asof"]}


def test_with_the_rs_step_dark_the_row_is_still_written_as_blanks(monkeypatch):
    """RS_V2 off (or no SPY bars): the RS step does not run, and a blank side row
    replaces whatever an earlier build stored for the ticker."""
    monkeypatch.setenv("RS_LEADER_SHADOW_ENABLED", "1")
    from api.services.signature import registry_defs
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", False)
    monkeypatch.setattr(rs_columns, "shadow_fields",
                        lambda *a, **k: pytest.fail("ran outside the RS step"))
    out = {}
    row, _ = _row(AAA, shadow_out=out)
    assert out == {"AAA": {"rs_steady": None, "rs_line_below_high_pct": None,
                           "bars_asof": row["bars_asof"]}}


# ───────────────────────── the side table ────────────────────────────────────

@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    snapshot_db.init_db()
    return path


def _tables(path):
    with sqlite3.connect(str(path)) as conn:
        return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def test_write_inputs_round_trips_and_a_rewrite_clears_the_score(db):
    assert rs_leader_shadow.TABLE not in _tables(db)
    assert rs_leader_shadow.write_inputs({}) == 0
    assert rs_leader_shadow.TABLE not in _tables(db), "an empty batch creates nothing"
    n = rs_leader_shadow.write_inputs(
        {"aaa": {"rs_steady": 0.5, "rs_line_below_high_pct": -3.25, "bars_asof": "20260306"},
         "BBB": {"rs_steady": None, "rs_line_below_high_pct": None, "bars_asof": "20260306"}},
        now=1000.0)
    assert n == 2
    with sqlite3.connect(str(db)) as conn:
        assert rs_leader_shadow.read_inputs(conn) == {
            "AAA": {"bars_asof": 20260306, "rs_steady": 0.5, "rs_line_below_high_pct": -3.25},
            "BBB": {"bars_asof": 20260306, "rs_steady": None, "rs_line_below_high_pct": None}}
        conn.execute(f"UPDATE {rs_leader_shadow.TABLE} SET rs_leader_score = 77.0, "
                     "score_session = '2026-03-06' WHERE ticker = 'AAA'")
        conn.commit()
    # the next build rewrites AAA: its score must not outlive the inputs it came from
    rs_leader_shadow.write_inputs(
        {"AAA": {"rs_steady": 0.6, "rs_line_below_high_pct": 0.0, "bars_asof": "20260309"}})
    with sqlite3.connect(str(db)) as conn:
        assert conn.execute(f"SELECT rs_steady, rs_leader_score, score_session FROM "
                            f"{rs_leader_shadow.TABLE} WHERE ticker='AAA'").fetchone() == (0.6, None, None)
        assert conn.execute(f"SELECT COUNT(*) FROM {rs_leader_shadow.TABLE}").fetchone()[0] == 2


def test_read_inputs_on_a_pod_without_the_table_is_empty_and_creates_nothing(db):
    with sqlite3.connect(str(db)) as conn:
        assert rs_leader_shadow.read_inputs(conn) == {}
    assert rs_leader_shadow.TABLE not in _tables(db)


def _build(monkeypatch, series):
    monkeypatch.setattr(sb, "_load_universe", lambda: [t for t in series if t not in ("SPY", "RSP")])
    monkeypatch.setattr(sb, "_read_daily_bars", lambda t: list(series.get(t, [])))
    monkeypatch.setattr(sb, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_fundamentals", lambda t, price=None, failures=None: {})
    monkeypatch.setattr(sb, "_read_rs_map", lambda: {})
    monkeypatch.setattr(sb, "_read_bulk_fundamentals", lambda targets, failures=None: {})
    from api.services.screener import context_joins as cj
    for fn in ("read_breadth_flags", "read_uct20", "read_index_flags", "read_etf_flags"):
        monkeypatch.setattr(cj, fn, lambda targets, failures=None: {})
    return sb.run_build()


SERIES = {"AAA": AAA, "CCC": CCC, "SPY": SPY, "RSP": RSP}


def test_a_whole_build_stores_the_inputs_beside_the_rows_and_reports_nothing(db, on, monkeypatch):
    monkeypatch.delenv("RS_SCREENS_ENABLED", raising=False)
    stats = _build(monkeypatch, SERIES)
    assert stats["built"] == 2
    with sqlite3.connect(str(db)) as conn:
        got = rs_leader_shadow.read_inputs(conn)
        asof = dict(conn.execute("SELECT ticker, bars_asof FROM screener_rows"))
        columns = {r[1] for r in conn.execute("PRAGMA table_info(screener_rows)")}
    assert got == {"AAA": {"bars_asof": int(asof["AAA"]), "rs_steady": 1.0,
                           "rs_line_below_high_pct": AAA_RS_BELOW_HIGH},
                   "CCC": {"bars_asof": int(asof["CCC"]), "rs_steady": None,
                           "rs_line_below_high_pct": None}}
    assert not (set(SHADOW) & columns), "a shadow input became a screener_rows column"
    # the build receipt is served to members: no word of this step may be in it
    said = json.dumps(stats, default=str).lower()
    # Pin moved 2026-11-14 (unit U12): UCT RS Leaders' list is PUBLIC and the pass reports it
    # (two screener columns counted in `populated`, and the pass receipt's `leaders` block).
    # Those three names are taken out first; any other "leader" is still this step's word.
    # (This build runs with the screens off: the two column names are in `populated` at 0,
    # and the pass, with its `leaders` block, did not run.)
    assert '"rs_leaders_member"' in said and '"rs_leaders_days"' in said
    for public in ('"rs_leaders_member"', '"rs_leaders_days"', '"leaders"'):
        said = said.replace(public, '""')
    for word in ("shadow", "steady", "leader", "rs_line_below"):
        assert word not in said, word
    assert json.dumps(snapshot_db.status(), default=str).lower().count("shadow") == 0


def test_a_dark_build_creates_no_table(db, monkeypatch):
    _arm_rs_v2(monkeypatch)
    monkeypatch.delenv("RS_LEADER_SHADOW_ENABLED", raising=False)
    monkeypatch.setattr(rs_leader_shadow, "write_inputs",
                        lambda *a, **k: pytest.fail("the side table was written while dark"))
    assert _build(monkeypatch, SERIES)["built"] == 2
    assert rs_leader_shadow.TABLE not in _tables(db)


def test_a_failed_side_write_never_costs_the_build(db, on, monkeypatch):
    def _boom(rows, **k):
        raise sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(rs_leader_shadow, "write_inputs", _boom)
    stats = _build(monkeypatch, SERIES)
    assert stats["built"] == 2 and stats["errors"] == 0
    assert "shadow" not in json.dumps(stats, default=str).lower()
