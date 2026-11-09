"""Rails for the Phase 3 (unit 3-03) functions of
`api/services/relative_strength.py`: the rotation reading (`rrg_columns`, the
Terminal's RRG formula per engineering map decision D1), Clenow's momentum
quality (`clenow_columns`) and OANDA's volatility-adjusted RS (`vars_columns`).

Three kinds of rail live here:

1. THE SHARED FIXTURES. `rs_rrg.json`, `rs_clenow.json` and `rs_vars.json`
   were written once by a generator that never imported this module (exact
   rational arithmetic for RRG and VARS, numpy for the Clenow regression), and
   `rs_rrg.json` is ALSO read by
   `app/src/pages/terminal/panels/relativeMath.rsFixture.test.js` against the
   Terminal's real `rrgPath`, so the Terminal and the server cannot drift.
2. HAND-DERIVED ROWS, each with its arithmetic in the test body, plus the
   behaviours the contract names: warm-up is None (never 0), a halted benchmark
   bar stays None and is skipped, Clenow's gap flag at the threshold, VARS ATR
   seeding.
3. THE NO-MOVE RAIL. Phase 3 must leave `compute_phase1_columns` and
   `compute_mansfield_columns` byte-identical, because saved RS alerts compute
   from them directly (engineering map §0 point 7, F44); a `compute.rev` bump
   costs no binding migration only while this holds.
"""
from __future__ import annotations

import ast
import copy
import json
import math
import pathlib

import pytest

from api.services import relative_strength as rs
from tests.test_indicator_golden import _close, _rs_event_inputs, load_case
from tests.test_single_authority_rails import (
    _find,
    _is_rolling_accumulator,
    _module_declares_rs_lookbacks,
)

MODULE = pathlib.Path(rs.__file__)
NEW_FUNCTIONS = ("rrg_columns", "clenow_columns", "vars_columns",
                 "_quadrant_code", "_r_squared", "_atr_by_time",
                 "_length_or_none", "_positive_closes")


def _bars(closes, start_t=1_000, spread=0.0):
    return [{"t": start_t + i, "o": c, "h": c * (1 + spread), "l": c * (1 - spread), "c": c, "v": 1}
            for i, c in enumerate(closes)]


def _assert_matches(name, got, expected, rel):
    assert set(got) == set(expected), f"{name}: column set drifted"
    for col, exp in expected.items():
        assert len(got[col]) == len(exp), f"{name}.{col} not aligned"
        for i, (g, e) in enumerate(zip(got[col], exp)):
            assert _close(g, e, rel), f"{name}.{col}[{i}]: {g!r} != {e!r}"


# ═════════════════════════════════════════════════════════════════════════════
# 1. The shared fixtures
# ═════════════════════════════════════════════════════════════════════════════

def test_rs_rrg_fixture_every_value():
    case = load_case("rs_rrg")
    assert case["kind"] == "rs_rrg"
    p = case["params"]
    got = rs.rrg_columns(case["bars"], case["benchmarkBars"], p["ratio_len"], p["mom_len"])
    _assert_matches("rs_rrg", got, case["expected"], case["relTol"])
    # the default call IS the fixture's call: the Terminal's RRG_METHOD
    assert rs.rrg_columns(case["bars"], case["benchmarkBars"]) == got


def test_rs_rrg_fixture_pins_the_terminal_constants_in_this_lane():
    """`relativeMath.RRG_METHOD = { ratioLen: 10, momLen: 5 }` and
    `QUADRANTS` are pinned against these same fields by the vitest lane; this
    is the Python half, so a change on either side is red until both move."""
    case = load_case("rs_rrg")
    assert case["params"] == {"ratio_len": rs.DEFAULT_RRG_RATIO_LEN, "mom_len": rs.DEFAULT_RRG_MOM_LEN}
    assert tuple(case["quadrantNames"]) == rs.RRG_QUADRANT_NAMES


def test_rs_rrg_fixture_shape_and_domains():
    case = load_case("rs_rrg")
    exp = case["expected"]
    q = exp["quadrant"]
    assert all(v is None or (type(v) is int and v in (1, 2, 3, 4)) for v in q)
    assert {v for v in q if v is not None} == {1, 2, 3, 4}, "every quadrant must occur"
    # the halted benchmark week: stock bar 33 has no benchmark bar
    bench_t = {b["t"] for b in case["benchmarkBars"]}
    halted = [i for i, b in enumerate(case["bars"]) if b["t"] not in bench_t]
    assert halted == [33]
    assert all(exp[c][33] is None for c in exp)
    # and the benchmark carries a week the stock does not (read by nobody)
    assert len({b["t"] for b in case["benchmarkBars"]} - {b["t"] for b in case["bars"]}) == 1


def test_rs_clenow_fixture_every_value():
    case = load_case("rs_clenow")
    assert case["kind"] == "rs_clenow"
    p = case["params"]
    got = rs.clenow_columns(case["bars"], p["window"], p["gap_pct"])
    _assert_matches("rs_clenow", got, case["expected"], case["relTol"])
    for i, v in enumerate(got["clenowGap"]):
        assert v is None or (type(v) is float and v in (0.0, 1.0)), (i, v)


def test_rs_vars_fixture_every_value():
    case = load_case("rs_vars")
    assert case["kind"] == "rs_vars"
    p = case["params"]
    got = rs.vars_columns(case["bars"], case["benchmarkBars"], p["atr_length"], p["lookback"], p["ma_length"])
    _assert_matches("rs_vars", got, case["expected"], case["relTol"])
    st = got["varsState"]
    assert all(v is None or (type(v) is int and v in (1, 2, 3, 4)) for v in st)
    assert {v for v in st if v is not None} == {1, 2, 3, 4}, "every state must occur"


def test_phase3_columns_is_exactly_what_the_three_functions_return():
    b = _bars([100.0 + i for i in range(30)])
    keys = (list(rs.rrg_columns(b, b)) + list(rs.clenow_columns(b)) + list(rs.vars_columns(b, b)))
    assert tuple(keys) == rs.PHASE3_COLUMNS
    assert len(set(keys)) == len(keys)
    assert not set(rs.PHASE3_COLUMNS) & (set(rs.PHASE1_COLUMNS) | set(rs.PHASE2A_COLUMNS))


# ═════════════════════════════════════════════════════════════════════════════
# 2a. Rotation: hand-derived rows and behaviour
# ═════════════════════════════════════════════════════════════════════════════

def test_rrg_hand_derived_rows_from_the_fixture_note():
    """The note's three rows, recomputed here from the fixture's own closes.

    BAR 9: RS = 100 × C / B for bars 0-9; rsRatio = 100 × RS[9] / mean(RS[0..9]).
    BAR 13: rsMomentum = 100 × rsRatio[13] / mean(rsRatio[9..13]) → Lagging.
    BAR 34: the window skips the halted benchmark week (bar 33).
    """
    case = load_case("rs_rrg")
    bars, exp = case["bars"], case["expected"]
    bmap = {b["t"]: b["c"] for b in case["benchmarkBars"]}
    rs100 = [100 * b["c"] / bmap[b["t"]] if b["t"] in bmap else None for b in bars]
    assert rs100[0] == 25.0                    # 100 × 100.00 / 400.00
    assert rs100[9] == pytest.approx(100 * 105.46 / 416.23)
    ratio9 = 100 * rs100[9] / (sum(rs100[0:10]) / 10)
    assert ratio9 == pytest.approx(97.376521, abs=1e-6)
    assert exp["rsRatio"][9] == pytest.approx(ratio9, rel=1e-12)
    mom13 = 100 * exp["rsRatio"][13] / (sum(exp["rsRatio"][9:14]) / 5)
    assert mom13 == pytest.approx(99.114658, abs=1e-6)
    assert exp["rsMomentum"][13] == pytest.approx(mom13, rel=1e-12)
    assert exp["quadrant"][13] == 3
    window34 = [rs100[i] for i in list(range(24, 33)) + [34]]
    ratio34 = 100 * rs100[34] / (sum(window34) / 10)
    assert ratio34 == pytest.approx(98.561117, abs=1e-6)
    assert exp["rsRatio"][34] == pytest.approx(ratio34, rel=1e-12)
    assert exp["rsMomentum"][34] == pytest.approx(103.278405, abs=1e-6)
    assert exp["quadrant"][34] == 4


def test_rrg_tiny_series_by_hand():
    """Benchmark flat at 100, closes 10, 11, 12, 13, 14, ratio_len 2, mom_len 2.

    RS        = 10, 11, 12, 13, 14
    SMA2(RS)  = —, 10.5, 11.5, 12.5, 13.5
    rsRatio   = —, 100×11/10.5, 100×12/11.5, 100×13/12.5, 100×14/13.5
    rsMomentum[2] = 100 × rsRatio[2] / mean(rsRatio[1], rsRatio[2])
    """
    got = rs.rrg_columns(_bars([10.0, 11.0, 12.0, 13.0, 14.0]), _bars([100.0] * 5), 2, 2)
    r = got["rsRatio"]
    assert r[0] is None
    assert r[1] == pytest.approx(100 * 11 / 10.5)
    assert r[4] == pytest.approx(100 * 14 / 13.5)
    m = got["rsMomentum"]
    assert m[:2] == [None, None]
    assert m[2] == pytest.approx(100 * r[2] / ((r[1] + r[2]) / 2))
    # a ratio rising at a decelerating rate: above 100, momentum below 100
    assert got["quadrant"] == [None, None, 2, 2, 2]


def test_rrg_quadrant_codes_split_at_100_with_greater_or_equal():
    q = rs._quadrant_code
    assert q(100, 100) == 1 and q(100.1, 99.9) == 2 and q(99.9, 99.9) == 3 and q(99.9, 100) == 4
    assert q(None, 100) is None and q(100, None) is None


def test_rrg_warmup_is_none_never_zero_and_a_halted_benchmark_bar_stays_none():
    closes = [50 + 3 * math.sin(i / 2) + 0.2 * i for i in range(40)]
    bars = _bars(closes)
    bench = [b for i, b in enumerate(_bars([400 + i for i in range(40)])) if i != 25]
    got = rs.rrg_columns(bars, bench)
    assert got["rsRatio"][:9] == [None] * 9 and got["rsMomentum"][:13] == [None] * 13
    assert all(got[c][25] is None for c in got), "the halted benchmark bar is None in every column"
    assert all(v is not None and v != 0 for i, v in enumerate(got["rsMomentum"]) if i >= 13 and i != 25)


def test_rrg_a_skipped_bar_is_the_same_as_the_bar_not_existing():
    """Skip, not zero and not restart: the columns on every other bar equal
    the columns computed with that bar deleted from the stock series too —
    exactly what `alignCloses` does on the Terminal's side."""
    closes = [50 + 3 * math.sin(i / 2) + 0.2 * i for i in range(40)]
    bars = _bars(closes)
    full_bench = _bars([400 + 2 * math.cos(i) for i in range(40)])
    bench = [b for i, b in enumerate(full_bench) if i != 25]
    got = rs.rrg_columns(bars, bench)
    ref = rs.rrg_columns([b for i, b in enumerate(bars) if i != 25], bench)
    for col in got:
        assert got[col][:25] + got[col][26:] == ref[col], col


def test_rrg_degenerate_lengths_and_empty_inputs():
    b = _bars([10.0 + i for i in range(20)])
    for r_len, m_len in ((0, 5), (10, 0), (None, 5), (float("nan"), 5)):
        got = rs.rrg_columns(b, b, r_len, m_len)
        assert all(v is None for col in got.values() for v in col)
    assert rs.rrg_columns([], b) == {"rsRatio": [], "rsMomentum": [], "quadrant": []}
    assert all(v is None for v in rs.rrg_columns(b, [])["rsRatio"])


# ═════════════════════════════════════════════════════════════════════════════
# 2b. Quality (Clenow)
# ═════════════════════════════════════════════════════════════════════════════

def test_clenow_on_an_exact_exponential_is_slope_ln_growth_and_r2_one():
    """C[i] = 100 × 1.01^i ⇒ ln C = ln 100 + i × ln 1.01 exactly, so
    b = ln 1.01, R² = 1, annual = (1 + ln 1.01)^252 − 1 and score = annual."""
    closes = [100 * 1.01 ** i for i in range(30)]
    got = rs.clenow_columns(_bars(closes), 10, 15)
    annual = (1 + math.log(1.01)) ** 252 - 1
    assert got["clenowAnnual"][:9] == [None] * 9
    for t in range(9, 30):
        assert got["clenowAnnual"][t] == pytest.approx(annual, rel=1e-9)
        assert got["clenowR2"][t] == pytest.approx(1.0, abs=1e-12)
        assert got["clenowScore"][t] == pytest.approx(annual, rel=1e-9)
        assert got["clenowGap"][t] == 0.0
    assert annual == pytest.approx(11.122829, abs=1e-6)   # (1.00995033)^252 − 1


def test_clenow_gap_flag_at_the_threshold_is_strict():
    """100.00 → 115.00 is (115 − 100) / 100 × 100 = 15.0 exactly: NOT > 15.
    100.00 → 115.01 is 15.01 > 15: flagged in every window holding the pair."""
    base = [90 + i for i in range(10)] + [100.0]
    at = rs.clenow_columns(_bars(base + [115.0] + [116 + i for i in range(5)]), 5, 15)
    assert all(v in (0.0, None) for v in at["clenowGap"])
    over = rs.clenow_columns(_bars(base + [115.01] + [116 + i for i in range(5)]), 5, 15)
    # the pair is bars 10 and 11; 5-bar windows ending at 11..14 hold both
    assert [i for i, v in enumerate(over["clenowGap"]) if v == 1.0] == [11, 12, 13, 14]
    assert over["clenowGap"][15] == 0.0
    # a fall counts as a move too: 100 → 85 is exactly 15 (no flag), → 84.99 flags
    down_at = rs.clenow_columns(_bars(base + [85.0, 86, 87, 88, 89]), 5, 15)
    assert all(v in (0.0, None) for v in down_at["clenowGap"])
    down_over = rs.clenow_columns(_bars(base + [84.99, 86, 87, 88, 89]), 5, 15)
    assert down_over["clenowGap"][11] == 1.0


def test_clenow_score_is_annual_times_r2_and_the_fixture_has_both_signs():
    case = load_case("rs_clenow")
    exp = case["expected"]
    for a, r2, s in zip(exp["clenowAnnual"], exp["clenowR2"], exp["clenowScore"]):
        if a is None:
            assert r2 is None and s is None
            continue
        assert 0 <= r2 <= 1
        assert s == pytest.approx(a * r2, rel=1e-12)
    assert exp["clenowAnnual"][59] < 0 < exp["clenowAnnual"][44]
    assert [i for i, g in enumerate(exp["clenowGap"]) if g == 1.0] == list(range(60, 79))
    assert exp["clenowGap"][25] == 0.0, "the exact 15 % step must not flag"


def test_clenow_flat_window_has_no_r2_and_no_score():
    got = rs.clenow_columns(_bars([50.0] * 15 + [50.0 + i for i in range(1, 6)]), 10, 15)
    # windows ending at bars 9-14 hold only 50.0 (exactly flat)
    assert all(got[c][t] is None for c in got for t in range(9, 15)), "a frozen tape is not a score of 0"
    assert got["clenowScore"][15] is not None


def test_clenow_skips_a_missing_close_and_counts_valid_closes():
    closes = [100 * 1.01 ** i for i in range(15)]
    bars = _bars(closes)
    holed = copy.deepcopy(bars)
    holed.insert(7, {"t": 1006.5, "o": None, "h": None, "l": None, "c": None, "v": 0})
    a = rs.clenow_columns(bars, 5, 15)
    b = rs.clenow_columns(holed, 5, 15)
    for c in a:
        assert b[c][7] is None
        assert b[c][:7] + b[c][8:] == a[c], c


def test_clenow_degenerate_window():
    b = _bars([10.0 + i for i in range(10)])
    for w in (1, 0, None):
        assert all(v is None for col in rs.clenow_columns(b, w).values() for v in col)


# ═════════════════════════════════════════════════════════════════════════════
# 2c. VARS
# ═════════════════════════════════════════════════════════════════════════════

def test_vars_atr_seeding_hand_derived_from_the_fixture():
    """Wilder ATR, seeded with the mean of TR 1..5 on bar 5 (note): stock
    TRs 2.26, 2.50, 2.44, 2.12, 1.70 → 2.204; benchmark 4.36, 3.36, 2.56, 2.56,
    3.42 → 3.252. So d[5] = 0.71 / 2.204 − 0.67 / 3.252, and the first vars
    (lookback 10) is on bar 14 = 5 + 10 − 1, the first MA (5) on bar 18."""
    case = load_case("rs_vars")
    p = case["params"]
    atr_s = rs._atr_by_time(case["bars"], p["atr_length"])
    atr_b = rs._atr_by_time(case["benchmarkBars"], p["atr_length"])
    t = [b["t"] for b in case["bars"]]
    assert t[4] not in atr_s and t[4] not in atr_b, "no ATR before its seed bar"
    assert atr_s[t[5]] == pytest.approx((2.26 + 2.50 + 2.44 + 2.12 + 1.70) / 5) == pytest.approx(2.204)
    assert atr_b[t[5]] == pytest.approx((4.36 + 3.36 + 2.56 + 2.56 + 3.42) / 5) == pytest.approx(3.252)
    exp = case["expected"]
    assert exp["vars"][:14] == [None] * 14 and exp["vars"][14] is not None
    assert exp["varsMa"][:18] == [None] * 18 and exp["varsMa"][18] is not None
    assert exp["varsMa"][18] == pytest.approx(sum(exp["vars"][14:19]) / 5, rel=1e-12)
    # the first vars is the sum of d over bars 5..14 — rebuild it from the closes
    c = [b["c"] for b in case["bars"]]
    bc = {b["t"]: b["c"] for b in case["benchmarkBars"]}
    d = [(c[i] - c[i - 1]) / atr_s[t[i]] - (bc[t[i]] - bc[t[i - 1]]) / atr_b[t[i]] for i in range(5, 15)]
    assert d[0] == pytest.approx(0.71 / 2.204 - 0.67 / 3.252) == pytest.approx(0.116115, abs=1e-6)
    assert exp["vars"][14] == pytest.approx(sum(d), rel=1e-12)


def test_vars_the_bar_after_a_halted_benchmark_bar_reads_from_the_last_shared_bar():
    case = load_case("rs_vars")
    exp = case["expected"]
    assert all(exp[c][45] is None for c in exp), "the halted benchmark bar stays None"
    p = case["params"]
    atr_s = rs._atr_by_time(case["bars"], p["atr_length"])
    atr_b = rs._atr_by_time(case["benchmarkBars"], p["atr_length"])
    c = [b["c"] for b in case["bars"]]
    t = [b["t"] for b in case["bars"]]
    bc = {b["t"]: b["c"] for b in case["benchmarkBars"]}
    d46 = (c[46] - c[44]) / atr_s[t[46]] - (bc[t[46]] - bc[t[44]]) / atr_b[t[46]]
    assert d46 == pytest.approx(-0.435745, abs=1e-6)
    window = list(range(36, 45)) + [46]

    def d(i, prev):
        return (c[i] - c[prev]) / atr_s[t[i]] - (bc[t[i]] - bc[t[prev]]) / atr_b[t[i]]
    total = sum(d(i, i - 1) for i in range(36, 45)) + d46
    assert len(window) == p["lookback"]
    assert exp["vars"][46] == pytest.approx(total, rel=1e-12)


def test_vars_states_by_hand():
    """State 1 > 0 and > MA, 2 > 0 and ≤ MA, 3 < 0 and > MA, 4 < 0 and ≤ MA;
    read off the fixture's own vars/varsMa pairs, so each code is checked
    against its definition rather than against a copy of itself."""
    exp = load_case("rs_vars")["expected"]
    for v, m, s in zip(exp["vars"], exp["varsMa"], exp["varsState"]):
        if v is None or m is None:
            assert s is None
            continue
        want = (1 if v > m else 2) if v > 0 else (3 if v > m else 4)
        assert s == want


def test_vars_of_a_stock_against_itself_is_zero_and_has_no_state():
    b = _bars([100 + 2 * math.sin(i / 3) + 0.1 * i for i in range(40)], spread=0.01)
    got = rs.vars_columns(b, b, 5, 10, 5)
    vals = [v for v in got["vars"] if v is not None]
    assert vals and all(v == 0 for v in vals)
    assert all(s is None for s in got["varsState"])


def test_vars_a_close_only_benchmark_reads_as_h_equals_l_equals_c():
    """The equal-weight composite emits `{t, c}` only; its true range is then
    the close-to-close move, exactly what Wilder's TR is with h = l = c."""
    stock = _bars([50 + 0.3 * i + math.sin(i) for i in range(50)], spread=0.02)
    closes = [200 + 0.5 * i + 2 * math.cos(i / 2) for i in range(50)]
    close_only = [{"t": 1_000 + i, "c": c} for i, c in enumerate(closes)]
    explicit = _bars(closes)     # spread 0: h = l = c
    a = rs.vars_columns(stock, close_only, 5, 10, 5)
    b = rs.vars_columns(stock, explicit, 5, 10, 5)
    assert a == b
    assert any(v is not None for v in a["vars"])


def test_vars_warmup_is_none_never_zero_on_default_lengths():
    """Defaults 20 / 60 / 50: the first vars is on bar 20 + 60 − 1 = 79, the
    first MA and state on bar 79 + 50 − 1 = 128."""
    stock = _bars([50 + 0.3 * i + 3 * math.sin(i / 4) for i in range(160)], spread=0.02)
    bench = _bars([300 + 0.2 * i + 2 * math.cos(i / 5) for i in range(160)], spread=0.01)
    got = rs.vars_columns(stock, bench)
    assert got["vars"][:79] == [None] * 79 and got["vars"][79] is not None
    assert got["varsMa"][:128] == [None] * 128 and got["varsMa"][128] is not None
    assert got["varsState"][:128] == [None] * 128


def test_vars_after_a_halted_benchmark_bar_the_change_spans_the_gap():
    """With a close-only benchmark (TR = |ΔB|, so its ATR does not depend on
    which bars the STOCK has) deleting a halted benchmark bar's stock bar too
    gives the same columns elsewhere — the gap is skipped, not zeroed."""
    stock = _bars([50 + 0.3 * i + math.sin(i) for i in range(60)], spread=0.02)
    bench = [{"t": 1_000 + i, "c": 200 + 0.5 * i + 2 * math.cos(i / 2)} for i in range(60) if i != 40]
    got = rs.vars_columns(stock, bench, 5, 10, 5)
    assert all(got[c][40] is None for c in got)
    # the stock's own ATR still runs over its bar 40, so compare only the
    # benchmark side: d on bar 41 spans B[39] → B[41]
    atr_b = rs._atr_by_time(bench, 5)
    atr_s = rs._atr_by_time(stock, 5)
    c = [b["c"] for b in stock]
    bc = {b["t"]: b["c"] for b in bench}
    t = [b["t"] for b in stock]
    d41 = (c[41] - c[39]) / atr_s[t[41]] - (bc[t[41]] - bc[t[39]]) / atr_b[t[41]]
    window = [i for i in range(31, 42) if i != 40]
    total = sum(((c[i] - c[i - 1]) / atr_s[t[i]] - (bc[t[i]] - bc[t[i - 1]]) / atr_b[t[i]])
                for i in window if i != 41) + d41
    assert got["vars"][41] == pytest.approx(total, rel=1e-12)


def test_vars_degenerate_lengths():
    b = _bars([10.0 + i for i in range(40)], spread=0.01)
    for args in ((0, 10, 5), (5, 0, 5), (5, 10, 0), (None, 10, 5)):
        assert all(v is None for col in rs.vars_columns(b, b, *args).values() for v in col)


# ═════════════════════════════════════════════════════════════════════════════
# 3. The no-move rail, purity, and the single-authority rails on the new code
# ═════════════════════════════════════════════════════════════════════════════

def _phase3_on(bars, bench):
    rs.rrg_columns(bars, bench)
    rs.clenow_columns(bars)
    rs.vars_columns(bars, bench, 5, 10, 5)


def test_no_move_rail_phase1_columns_reproduce_rs_events_default_byte_for_byte():
    """Saved RS alerts compute from `compute_phase1_columns` (F44). Its output
    must serialise to exactly the fixture's bytes — not merely within 1e-9 —
    before AND after the Phase 3 functions run over the same inputs."""
    case = load_case("rs_events_default")
    bars, bench = case["bars"], case["benchmarkBars"]
    inputs = _rs_event_inputs(case)
    before = copy.deepcopy((bars, bench))
    got = rs.compute_phase1_columns(bars, bench, inputs, short_history=True)
    _phase3_on(bars, bench)
    again = rs.compute_phase1_columns(bars, bench, inputs, short_history=True)
    assert (bars, bench) == before, "a Phase 3 function mutated its inputs"
    assert set(got) == set(case["expected"]) == set(rs.PHASE1_COLUMNS)
    for col, exp in case["expected"].items():
        want = json.dumps(exp)
        assert json.dumps(got[col]) == want, f"rs_events_default.{col} moved"
        assert json.dumps(again[col]) == want, f"rs_events_default.{col} moved after Phase 3 ran"


def test_no_move_rail_mansfield_columns_reproduce_rs_mansfield_byte_for_byte():
    case = load_case("rs_mansfield")
    bars, bench = case["bars"], case["benchmarkBars"]
    length = case["params"]["length"]
    got = rs.compute_mansfield_columns(bars, bench, length)
    _phase3_on(bars, bench)
    again = rs.compute_mansfield_columns(bars, bench, length)
    assert set(got) == set(rs.PHASE2A_COLUMNS)
    for col in rs.PHASE2A_COLUMNS:
        want = json.dumps(case["expected"][col])
        assert json.dumps(got[col]) == want, f"rs_mansfield.{col} moved"
        assert json.dumps(again[col]) == want, f"rs_mansfield.{col} moved after Phase 3 ran"


def test_the_new_functions_carry_no_rolling_accumulator():
    """`test_single_authority_rails` scans the whole backend; this is the same
    detector on just the Phase 3 functions, so a failure names this unit."""
    tree = ast.parse(MODULE.read_text(encoding="utf-8"))
    defined = {fn.name for fn in ast.walk(tree) if isinstance(fn, ast.FunctionDef)}
    assert set(NEW_FUNCTIONS) <= defined
    hits = [h for h in _find(tree, _is_rolling_accumulator) if h[0] in NEW_FUNCTIONS]
    assert hits == []


def test_the_module_does_not_become_a_second_rs_weighting_table():
    assert not _module_declares_rs_lookbacks(ast.parse(MODULE.read_text(encoding="utf-8")))
