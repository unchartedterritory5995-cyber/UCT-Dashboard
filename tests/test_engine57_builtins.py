"""Engine 57 -- three TradingView built-ins in the PYTHON lane, pinned to the VENDOR'S numbers.

The JS lane is pinned to the same captures by
``app/src/components/chart/engine/ast/engine57Builtins.test.js``. The captures (S6, NYSE:RDDT 1D
from the listing: the builtin ``stochastic-rsi``, ``rank-correlation-index``, ``rci-ribbon`` and
``supertrend``) are licence-held and stay out of git; their bars are the same 666 sessions as the
committed ``support-and-resistance-5f95e90f-rddt-1d-2026-11-13`` fixture, so the trees below run on
committed bars and are graded against numbers read off the captures.

* ``stochPine`` (Pine's ``ta.stoch``): K = sma(stochPine(rsi, rsi, rsi, 14), 3) from bar 17, D = sma(K, 3)
  from bar 19; probe P2's holes (held) and flat run (held 0); S10's flat run after 100 (held 100);
  an unpinned flat run withheld.
* ``rci``: the Pearson correlation of average ranks, first value on bar ``length``; probe P1's
  warm-up ``na`` ranked lowest and flat window ``na``.
* ``supertrend``: this lane runs the bounded window (it has no listing pass); its published bars
  equal Pine's full-history reference, and the trees are the JS lane's node for node
  (``tests/test_call_expansions_parity.py``).
"""
import json
import math
from pathlib import Path

import pytest

from api.services import ast_interpret
from api.services import call_expansions as ce

ROOT = Path(__file__).resolve().parent.parent
RDDT = ROOT / "tests" / "fixtures" / "vendor" / "harness" / "support-and-resistance-5f95e90f-rddt-1d-2026-11-13.json"


def _bars():
    rows = json.loads(RDDT.read_text(encoding="utf-8"))["bars"]["rows"]
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


def S(name):
    return {"type": "series", "name": name}


def N(v):
    return {"type": "num", "value": v}


def C(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def _near(a, b, rel=1e-9):
    return a is not None and abs(a - b) <= rel * max(1.0, abs(b))


def _first(col):
    return next(i for i, v in enumerate(col) if v is not None)


def _drawn(col):
    return sum(1 for v in col if v is not None)


def _run(tree, bars=None, sink=None, listing=True):
    """The captures start at the listing, so the rails grade the listing's answer by default."""
    opts = {} if sink is None else {"chartClockSink": sink}
    if listing:
        opts["historyFromListing"] = True
    return ast_interpret.interpret(tree, bars or _bars(), None, None, None, opts)


# --------------------------------------------------------------------------- #
# stochastic
# --------------------------------------------------------------------------- #

SR_K = {17: 11.81834460004229, 18: 11.81834460004229, 19: 37.159810733515634, 20: 44.011448293144525,
        100: 67.88432951934263, 400: 75.84483631298703, 665: 84.01157347795736}
SR_D = {19: 20.26549997786674, 20: 30.996534542234148, 100: 52.05208033208319, 400: 78.19026425931453,
        665: 71.77142513859626}


def _stoch_rsi():
    r = C("rsi", S("close"), N(14))
    k = C("sma", C("stochPine", r, r, r, N(14)), N(3))
    return k, C("sma", k, N(3))


def test_stoch_rsi_k_and_d_are_the_vendors():
    k_tree, d_tree = _stoch_rsi()
    k, d = _run(k_tree), _run(d_tree)
    assert _first(k) == 17 and _first(d) == 19
    assert _drawn(k) == 649 and _drawn(d) == 647
    for i, v in SR_K.items():
        assert _near(k[i], v), (i, k[i], v)
    for i, v in SR_D.items():
        assert _near(d[i], v), (i, d[i], v)


def test_house_stoch_is_untouched_and_starts_late():
    """The control: the house ``stoch`` (native Stochastic) still reads its finite tail and
    starts ten bars later (%K on bar 27, where Pine's is on bar 17; K = sma(%K, 3) on 29, not 19)
    -- the column ``ta.stoch`` used to land on."""
    r = C("rsi", S("close"), N(14))
    assert _first(_run(C("stoch", r, r, r, N(14)))) == 27
    assert _first(_run(C("stochPine", r, r, r, N(14)))) == 15   # bar 14 is a one-value window: range 0, na


def test_stoch_pine_flat_window_with_nothing_before_is_na_and_house_keeps_fifty():
    flat = [5.0] * 12
    assert all(math.isnan(v) for v in ast_interpret.FN["stochPine"](flat, flat, flat, 4))
    assert ast_interpret.FN["stoch"](flat, flat, flat, 4)[3:] == [50.0] * 9


def _holed(period, at):
    """``bar_index % period == at ? na : close``."""
    return {"type": "op", "name": "?:", "args": [
        {"type": "op", "name": "==", "args": [C("mod", S("barindex"), N(period)), N(at)]},
        {"type": "op", "name": "/", "args": [N(0), N(0)]}, S("close")]}


def _run_of(value):
    """``bar_index >= 100 and bar_index < 120 ? value : close``."""
    return {"type": "op", "name": "?:", "args": [
        {"type": "op", "name": "&&", "args": [
            {"type": "op", "name": ">=", "args": [S("barindex"), N(100)]},
            {"type": "op", "name": "<", "args": [S("barindex"), N(120)]}]},
        N(value), S("close")]}


# S1 probe P2 (``vw-cs1-stoch-p2-rddt-1d-2026-11-14``), read off the capture
P2_XXX = {29: 100, 30: 100, 34: 85.58659217877096, 38: 83.53584447144593, 79: 23.370786516853812,
          80: 23.370786516853812, 81: 0}
P2_XHL = {29: 79.52265286725103, 30: 79.52265286725103, 31: 82.2625527999202, 80: 38.535800482703095}
P2_YYY = {108: 0, 109: 0, 119: 0, 120: 100, 121: 94.392523364486}


def test_stoch_probe_p2_holes_hold_and_windows_span_them():
    x = _holed(50, 30)
    for tree, want in [(C("stochPine", x, x, x, N(10)), P2_XXX),
                       (C("stochPine", S("high"), S("low"), x, N(10)), P2_XHL),
                       (C("stochPine", _run_of(50.0), _run_of(50.0), _run_of(50.0), N(10)), P2_YYY)]:
        sink = {}
        col = _run(tree, sink=sink)
        assert _first(col) == 9
        for i, v in want.items():
            assert _near(col[i], v), (i, col[i], v)
        assert sink == {}


def test_stoch_flat_run_after_100_on_its_level_keeps_the_100():
    # S10 ``vw-cs2-stoch-flat-window``: TradingView keeps the 100 through the flat run
    y = _run_of(1000.0)
    sink = {}
    col = _run(C("stochPine", y, y, y, N(10)), sink=sink)
    assert sink == {}
    assert all(col[i] == 100 for i in range(100, 120))


def test_stoch_unpinned_flat_run_is_withheld_by_name():
    y = _run_of(1000.0)
    sink = {}
    src = {"type": "op", "name": "?:", "args": [
        {"type": "op", "name": "==", "args": [S("barindex"), N(108)]}, N(1000.0), S("close")]}
    col = _run(C("stochPine", y, y, src, N(10)), sink=sink)
    assert list(sink) == [ast_interpret.STOCH_FLAT_WINDOW]
    assert col[108] == 100          # kept through the run as in S10, but the source is off the level
    assert all(col[i] is None for i in range(109, 120))
    assert col[120] is not None
    assert ast_interpret._stoch_flat_pinned(True, True)
    assert not ast_interpret._stoch_flat_pinned(False, True) and not ast_interpret._stoch_flat_pinned(True, False)


def test_n2_a_kept_100_that_is_not_the_double_100_is_pinned_by_provenance():
    pair = None
    for t in range(5000):
        lo = 1 + t * 0.37
        hi = lo + 3.3 + t * 0.011
        if (100 * (hi - lo)) / (hi - lo) != 100:
            pair = (lo, hi)
            break
    assert pair is not None
    lo, hi = pair
    out, flags, _ = ast_interpret._stoch_pine_scan([hi] * 7, [lo, lo, lo, hi, hi, hi, hi], [hi] * 7, 3)
    assert out[4] != 100 and abs(out[4] - 100) < 1e-12
    assert flags == [0] * 7 and out[5] == out[4]
    out2, flags2, _ = ast_interpret._stoch_pine_scan([10, 10, 10, 5, 5, 5], [0, 0, 0, 5, 5, 5],
                                                     [4, 4, 4, math.nan, math.nan, 5], 3)
    assert out2[5] == 40 and flags2 == [0, 0, 0, 0, 0, 1]


def test_n1_a_left_edge_under_ema_withholds_only_its_reach():
    bars = _bars()
    suffix = bars[100:]
    for tree, code in [
        (C("ema", C("stochPine", C("rsi", S("close"), N(14)), C("rsi", S("close"), N(14)),
                    C("rsi", S("close"), N(14)), N(14)), N(3)), ast_interpret.STOCH_LEFT_EDGE),
        (C("ema", C("rci", C("sma", S("close"), N(5)), N(10)), N(3)), ast_interpret.RCI_LEFT_EDGE),
    ]:
        sink = {}
        off = _run(tree, suffix, sink=sink, listing=False)
        assert list(sink) == [code]
        first = _first(off)
        assert 10 < first < 40, (code, first)
        assert all(v is not None for v in off[first:]), code


def test_r1_a_left_edge_under_a_value_kept_for_good_withholds_every_later_bar():
    bars = _bars()
    suffix = bars[100:]
    rsi = C("rsi", S("close"), N(14))
    sink = {}
    off = _run(C("cum", C("stochPine", rsi, rsi, rsi, N(14))), suffix, sink=sink, listing=False)
    assert list(sink) == [ast_interpret.STOCH_LEFT_EDGE]
    assert all(v is None for v in off)                   # the edge bars' error never decays under cum
    sink = {}
    plain = _run(C("cum", C("stochPine", S("high"), S("low"), S("close"), N(14))), suffix, sink=sink, listing=False)
    assert sink == {} and sum(1 for v in plain if v is not None) > 400


# --------------------------------------------------------------------------- #
# rci
# --------------------------------------------------------------------------- #

RCI = [
    (10, 10, 656, {10: -45.45454545454545, 11: -75.75757575757575, 103: 44.98501023232478, 665: 47.878787878787875}),
    (30, 30, 636, {30: -42.64738598442713, 55: 67.77172141169241, 665: -81.80200222469408}),
    (50, 50, 616, {50: 45.67106842737095, 55: 78.54210187382422, 665: -66.25210084033614}),
]


@pytest.mark.parametrize("length,first,count,at", RCI)
def test_rci_is_the_vendors(length, first, count, at):
    sink = {}
    col = _run(C("rci", S("close"), N(length)), sink=sink)
    assert _first(col) == first
    assert _drawn(col) == count
    for i, v in at.items():
        assert _near(col[i], v), (i, col[i], v)
    assert sink == {}


def test_rci_ma_is_the_vendors():
    col = _run(C("sma", C("rci", S("close"), N(10)), N(14)))
    assert _first(col) == 23 and _drawn(col) == 643
    for i, v in {23: -66.75324675324676, 24: -59.047619047619044, 665: -52.121212121212125}.items():
        assert _near(col[i], v), (i, col[i], v)


def test_rci_probe_p1_na_ranks_as_zero_and_flat_is_na():
    sink = {}
    col = _run(C("rci", C("sma", S("close"), N(5)), N(10)), sink=sink)
    assert _first(col) == 10 and _drawn(col) == 656
    for i, v in {10: 30.0636128378526, 11: -1.2158110873601293, 12: -44.24242424242424,
                 13: -98.78787878787878}.items():
        assert _near(col[i], v), (i, col[i], v)
    flat = _run(C("rci", C("round", {"type": "op", "name": "/", "args": [S("close"), N(1000)]}), N(10)), sink=sink)
    assert all(v is None for v in flat)
    assert sink == {}


def test_rci_na_ranks_lowest_whatever_the_source():
    """The coordinator's S1 ruling: an ``na`` ranks below every value (ties with other ``na``s),
    on a source with negative values too, and nothing is withheld."""
    sink = {}
    col = _run(C("rci", C("change", C("sma", S("close"), N(5))), N(10)), sink=sink)
    assert sink == {}
    assert _first(col) == 10
    c = [b["c"] for b in _bars()]
    sma = [math.nan if i < 4 else sum(c[i - 4:i + 1]) / 5 for i in range(len(c))]
    ch = [math.nan if i < 5 else sma[i] - sma[i - 1] for i in range(len(c))]
    w = [v if math.isfinite(v) else -math.inf for v in ch[1:11]]
    n, m = 10, 5.5
    rank = lambda v: 1 + sum(1 for x in w if x > v) + (sum(1 for x in w if x == v) - 1) / 2  # noqa: E731
    cov = sum((k + 1 - m) * (rank(w[n - 1 - k]) - m) for k in range(n))
    vp = sum((rank(w[n - 1 - k]) - m) ** 2 for k in range(n))
    assert abs(col[10] - 100 * cov / math.sqrt(n * (n * n - 1) / 12 * vp)) < 1e-9
    assert any(v < 0 for v in ch[5:11])


def test_rci_by_hand():
    col = ast_interpret.FN["rci"]([9.0, 2.0, 1.0, 1.0], 3)
    assert abs(col[3] - (-100 * 1.5 / math.sqrt(3))) < 1e-12
    assert math.isnan(col[2])


# --------------------------------------------------------------------------- #
# supertrend (bounded in this lane)
# --------------------------------------------------------------------------- #

def _pine_supertrend(bars, factor, n):
    atr = [math.nan] * len(bars)
    s = 0.0
    for i, b in enumerate(bars):
        tr = b["h"] - b["l"] if i == 0 else max(b["h"] - b["l"], abs(b["h"] - bars[i - 1]["c"]),
                                                abs(b["l"] - bars[i - 1]["c"]))
        if i < n - 1:
            s += tr
            continue
        atr[i] = (s + tr) / n if i == n - 1 else (atr[i - 1] * (n - 1) + tr) / n
    value, pu, pl, pst = [], math.nan, math.nan, math.nan
    for i, b in enumerate(bars):
        src = (b["h"] + b["l"]) / 2
        u, lo = src + factor * atr[i], src - factor * atr[i]
        pl0 = 0.0 if math.isnan(pl) else pl
        pu0 = 0.0 if math.isnan(pu) else pu
        c1 = bars[i - 1]["c"] if i > 0 else math.nan
        lo = lo if (lo > pl0 or c1 < pl0) else pl0
        u = u if (u < pu0 or c1 > pu0) else pu0
        if i == 0 or math.isnan(atr[i - 1]):
            d = 1
        elif pst == pu:
            d = -1 if b["c"] > u else 1
        else:
            d = 1 if b["c"] < lo else -1
        st = lo if d == -1 else u
        value.append(st)
        pu, pl, pst = u, lo, st
    return value


def test_supertrend_bounded_bars_equal_pines_full_history_and_the_guard_holds():
    bars = _bars()
    ref = _pine_supertrend(bars, 3, 10)
    col = _run(ce.expand_call(C("supertrend", N(3), N(10))), bars, listing=False)
    assert all(v is None for v in col[:409])     # 2W + n - 1, the base expansion's curtain
    published = [i for i, v in enumerate(col) if v is not None]
    assert len(published) > 200
    for i in published:
        assert _near(col[i], ref[i]), (i, col[i], ref[i])
    # the reference reproduces the capture's spot values (S6 `supertrend`)
    assert _near(ref[400], 229.76119713864293) and _near(ref[665], 122.33191288924613)


def test_supertrend_tree_carries_pines_nz_and_the_curtain_guard():
    t = ce.supertrend_trees(N(3), N(10))
    guard = t["value"]["args"][0]
    # the guard is a bounded window's own curtain, 2W deep, over a body that forgets its seed
    assert guard["name"] == "na" and guard["args"][0]["name"] == "accum"
    assert guard["args"][0]["args"] == [N(0), N(0), N(409)]
    upper = t["value"]["args"][2]["args"][2]
    assert upper["name"] == "accum" and upper["args"][0]["name"] == "nz"
    direction = t["direction"]["args"][2]["args"][1]
    assert direction["args"][0]["name"] == "na" and direction["args"][0]["args"][0]["type"] == "offset"
    # this lane runs it bounded: na exactly before bar 2W + n - 1, 0 after
    g = _run(guard, listing=False)
    assert g[:409] == [1] * 409 and all(v == 0 for v in g[409:])


# --------------------------------------------------------------------------- #
# the two lanes agree, bar for bar (host JS vs this lane)
# --------------------------------------------------------------------------- #

import sys  # noqa: E402

if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))
import ast_conformance as ac  # noqa: E402


@pytest.mark.skipif(not ac.js_lane_available(), reason="no JS lane")
def test_js_and_python_lanes_agree_on_rddt():
    bars = _bars()
    k_tree, d_tree = _stoch_rsi()
    hole = _holed(50, 30)
    cases = [
        {"id": "stoch_rsi_k", "ast": k_tree},
        {"id": "stoch_rsi_d", "ast": d_tree},
        {"id": "stoch_pine_hl", "ast": C("stochPine", S("high"), S("low"), S("close"), N(14))},
        {"id": "stoch_pine_hole", "ast": C("stochPine", hole, hole, hole, N(10))},
        {"id": "rci_10", "ast": C("rci", S("close"), N(10))},
        {"id": "rci_50", "ast": C("rci", S("close"), N(50))},
        {"id": "rci_warm", "ast": C("rci", C("sma", S("close"), N(5)), N(10))},
        {"id": "rci_na_window", "ast": C("rci", C("change", C("sma", S("close"), N(5))), N(10))},
        {"id": "stoch_flat_after_100", "ast": C("stochPine", _run_of(1000.0), _run_of(1000.0), _run_of(1000.0), N(10))},
        {"id": "stoch_flat_off_level", "ast": C("stochPine", _run_of(1000.0), _run_of(1000.0), S("close"), N(10))},
        {"id": "supertrend_3_10", "ast": ce.expand_call(C("supertrend", N(3), N(10)))},
    ]
    js = ac.run_js(cases, bars)
    py = ac.run_py(cases, bars)
    verdict = ac.compare_lanes(js, py)
    assert verdict["differences"] == [], verdict["differences"][:5]
    for c in cases:
        assert sum(1 for v in py[c["id"]] if v is not None) > 200, c["id"]


# --------------------------------------------------------------------------- #
# review #1294: off the listing (F1) and the hold chain (F3)
# --------------------------------------------------------------------------- #

def test_off_listing_left_edge_is_withheld_by_name_and_the_rest_equals_the_listing():
    bars = _bars()
    suffix = bars[100:]
    for tree, edge_end, code in [
        (C("rci", C("sma", S("close"), N(5)), N(10)), 13, ast_interpret.RCI_LEFT_EDGE),
        (C("stochPine", C("sma", S("close"), N(5)), C("sma", S("close"), N(5)), C("sma", S("close"), N(5)), N(14)),
         17, ast_interpret.STOCH_LEFT_EDGE),
    ]:
        on = _run(tree, bars)
        sink = {}
        off = _run(tree, suffix, sink=sink, listing=False)
        assert list(sink) == [code]
        assert all(v is None for v in off[:edge_end])
        for i in range(edge_end, len(suffix)):
            assert _near(off[i], on[i + 100]), (code, i, off[i], on[i + 100])
    sink = {}
    plain = _run(C("rci", S("close"), N(10)), suffix, sink=sink, listing=False)
    assert sink == {} and _first(plain) == 10


def test_a_hold_of_an_unpinned_value_stays_flagged():
    x = [50.0 if 20 <= i < 35 else 10.0 + (i % 7) for i in range(40)]
    x[35] = math.nan
    s = list(x)
    for i in range(29, 35):
        s[i] = 49.0          # the source off the flat level
    out, flags, _ = ast_interpret._stoch_pine_scan(x, x, s, 10)
    assert flags[29:35] == [1] * 6
    assert out[35] == out[34] and flags[35] == 1 and flags[36] == 0
    pinned, pflags, _ = ast_interpret._stoch_pine_scan(x, x, x, 10)      # the S10 shape
    assert pinned[29:36] == [100] * 7 and not any(pflags)
