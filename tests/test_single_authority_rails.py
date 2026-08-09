"""Single-authority rails for four de-duplicated numeric values.

🔴 WHY THESE ARE AST RAILS AND NOT BEHAVIOURAL TESTS. Every defect below was a
SECOND IMPLEMENTATION of one value — this repo's most repeated defect — and a
second implementation that agrees with the first today passes every behavioural
test there is. It only diverges later, at a boundary, on one symbol, on one bar.
So these read the PRODUCT SOURCE with an AST and fail when the shape of a second
implementation reappears, whatever it computes.

⛔ AND THEY ARE DERIVED, NEVER HAND-LISTED. Each one walks `api/**`, collects
every site matching a structural shape, and compares the collected SET against
the single authority's own qualified name. A hand-list of "files that are allowed
to do this" agrees with today's tree and falls back silently the day a file moves
(`lesson_probe_names_must_be_derived_not_typed`).

⚠️ EVERY AST RAIL CARRIES A CONTROL that feeds the retired shape to the same
detector and asserts it FIRES. A rail nobody has seen fire is not a rail
(`lesson_gate_that_cannot_fail`), and these are precisely the rails whose "0
matches" reading is indistinguishable from a broken matcher.

The four values, and the measurements that made each one a defect (2026-08-09,
against `C:\\data\\screener.db` @ 3,708 rows and `C:\\data\\bars.db`):

  * **the window mean** — a rolling subtract-and-add SMA disagreed with the
    re-summing lane the chart draws on 33,913 of 37,761 bars; CAN 2025-12-09
    read "above the 20-day" on one lane and "not above" on the other, and GETY's
    50/200 golden cross landed on a different session.
  * **RSI at 0/0** — `avg_loss == 0` fired when gains AND losses were zero, so a
    stock that had not moved read as maximally overbought. CWEN-A carried
    `rsi14 = 100.0` on 14 consecutive identical closes.
  * **ATR%** — `atr_pct` was literally assigned from `adr_pct` on 3,708 of 3,708
    rows; TTE stored 1.64 against a true Wilder 2.14.
  * **the weighted RS return** — two implementations 15.7% apart on identical
    inputs (32.40 vs 28.00) because one substituted for missing periods and the
    other renormalised.
"""

from __future__ import annotations

import ast
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
API = ROOT / "api"


# ─── the corpus walk ─────────────────────────────────────────────────────────

def _product_files():
    """Every product `.py` under `api/`, tests excluded.

    ⚠️ `api/services/**/test_*.py` exists (a few modules keep their tests
    beside them), and a rail that counted those would report the retired shape
    living on in a fixture as if it were live code.
    """
    for path in sorted(API.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        if path.name.startswith("test_") or path.name.endswith("_test.py"):
            continue
        yield path


def _trees():
    for path in _product_files():
        try:
            yield path, ast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError) as exc:   # pragma: no cover
            pytest.fail(f"{path.relative_to(ROOT)} does not parse: {exc}")


def _functions(tree):
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield node


def _find(tree, predicate):
    """``[(function_name, lineno)]`` for every node in ``tree`` matching."""
    hits = []
    for fn in _functions(tree):
        for node in ast.walk(fn):
            if predicate(node):
                hits.append((fn.name, node.lineno))
    return hits


def _scan(predicate):
    """``{"path::function": lineno}`` over the whole product corpus."""
    found = {}
    for path, tree in _trees():
        for name, lineno in _find(tree, predicate):
            found[f"{path.relative_to(ROOT).as_posix()}::{name}"] = lineno
    return found


def _scan_source(source, predicate):
    """The same detector, run over one source STRING — the control."""
    return _find(ast.parse(source), predicate)


def _function_named(path: pathlib.Path, name: str):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for fn in _functions(tree):
        if fn.name == name:
            return fn
    pytest.fail(f"{path.relative_to(ROOT)} no longer defines {name}()")


# ═════════════════════════════════════════════════════════════════════════════
# 1.1 — ONE WINDOW MEAN
# ═════════════════════════════════════════════════════════════════════════════

def _is_rolling_accumulator(node) -> bool:
    """``total += series[i] - series[i - period]`` — the retired SMA's shape.

    Deliberately structural rather than name-based: the defect is the ALGORITHM
    (an accumulator that carries every earlier bar's rounding error forward), and
    it is that shape whatever the variable is called.
    """
    return (isinstance(node, ast.AugAssign)
            and isinstance(node.op, ast.Add)
            and isinstance(node.value, ast.BinOp)
            and isinstance(node.value.op, ast.Sub)
            and isinstance(node.value.left, ast.Subscript)
            and isinstance(node.value.right, ast.Subscript))


_RETIRED_SMA_SOURCE = '''
def compute_sma(closes, period):
    out = [None] * len(closes)
    window_sum = sum(closes[:period])
    out[period - 1] = window_sum / period
    for i in range(period, len(closes)):
        window_sum += closes[i] - closes[i - period]
        out[i] = window_sum / period
    return out
'''


def test_the_rolling_subtract_moving_average_detector_fires():
    """CONTROL. The retired implementation, fed to the detector, must be found."""
    assert _scan_source(_RETIRED_SMA_SOURCE, _is_rolling_accumulator), (
        "the rolling-accumulator detector no longer recognises the very code it "
        "was written to retire — every '0 matches' it reports is vacuous"
    )


def test_no_rolling_subtract_moving_average_survives_in_the_backend():
    """There were THREE — `indicator_compute.compute_sma`, and a private copy in
    the `remount` detector. All of them disagreed with the re-summing lane the
    chart draws, `interpret.js` computes and the frozen conformance digests pin.
    """
    found = _scan(_is_rolling_accumulator)
    assert found == {}, (
        "a rolling subtract-and-add moving average is back in the product:\n  "
        + "\n  ".join(f"{k} (line {v})" for k, v in sorted(found.items()))
        + "\nIt accumulates float drift, so its answer depends on how far back "
          "the caller happened to start reading bars — measured at 89.8% of "
          "bars disagreeing with the re-sum, and at a flipped price-vs-MA "
          "verdict on CAN 2025-12-09. Re-sum the window."
    )


def test_compute_sma_does_no_arithmetic_of_its_own():
    """The delivery lane is an ADAPTER over the interpreter's registry.

    ⭐ "No arithmetic" is the assertion, because that is what makes "one window
    mean" checkable: an SMA that agreed today and drifted tomorrow would still
    have to compute SOMETHING here.
    """
    fn = _function_named(API / "services" / "indicator_compute.py", "compute_sma")

    def is_pad(node) -> bool:
        # `[None] * n` — the alignment pad every column in this module builds.
        # It is list replication, not arithmetic on a price.
        return (isinstance(node.op, ast.Mult)
                and isinstance(node.left, (ast.List, ast.Tuple)))

    arithmetic = [n.lineno for n in ast.walk(fn)
                  if isinstance(n, ast.BinOp)
                  and isinstance(n.op, (ast.Add, ast.Sub, ast.Mult, ast.Div,
                                        ast.FloorDiv, ast.Pow))
                  and not is_pad(n)]
    assert not arithmetic, (
        f"compute_sma computes again, at line(s) {arithmetic}. It must read "
        f"ast_interpret's own `sma` and adapt the NaN pad to a None pad, so the "
        f"Python backend has exactly one window mean."
    )
    reads_registry = [
        n for n in ast.walk(fn)
        if isinstance(n, ast.Subscript)
        and isinstance(n.value, ast.Attribute) and n.value.attr == "FN"
    ]
    assert reads_registry, (
        "compute_sma no longer reads `ast_interpret.FN` — the registry the "
        "interpreter itself iterates. Reading the registry is what keeps the "
        "two lanes the same lane rather than two that happen to agree."
    )


def test_the_two_python_sma_lanes_are_bit_identical():
    """Behavioural half. ⚠️ EXACT equality — a tolerance here would admit exactly
    the 1e-14 drift that flipped CAN's verdict.
    """
    from api.services import ast_interpret, indicator_compute

    closes = [0.96, 0.95, 0.97, 0.94, 1.02, 0.99, 0.93, 0.96, 0.96, 0.98,
              0.97, 0.95, 0.94, 0.99, 1.01, 0.96, 0.95, 0.97, 0.98, 0.96,
              0.94, 0.93, 0.97, 1.00, 0.99, 0.96, 0.95, 0.94, 0.96, 0.97]
    for period in (2, 3, 5, 10, 20):
        adapter = indicator_compute.compute_sma(closes, period)
        native = ast_interpret.FN["sma"](list(closes), period)
        for i, (a, b) in enumerate(zip(adapter, native)):
            if b != b:                       # NaN pad
                assert a is None, f"period {period} bar {i}: pad became {a!r}"
            else:
                assert a == b, f"period {period} bar {i}: {a!r} != {b!r}"


def test_compute_sma_still_refuses_a_degenerate_period():
    """The guards stay in the adapter — `params_json` on a stored alert row is
    user-supplied and unvalidated, and the interpreter's `_rolling` assumes a
    schema-checked period."""
    from api.services import indicator_compute
    assert indicator_compute.compute_sma([1.0, 2.0, 3.0], 0) == [None, None, None]
    assert indicator_compute.compute_sma([1.0, 2.0, 3.0], -4) == [None, None, None]
    assert indicator_compute.compute_sma([1.0], 5) == [None]


# ═════════════════════════════════════════════════════════════════════════════
# 5.1 — ONE ZERO-MOVEMENT RSI DECISION
# ═════════════════════════════════════════════════════════════════════════════

def _is_zero_loss_hundred_decision(node) -> bool:
    """``if <…loss…> == 0:`` with the literal 100 in either arm.

    Both halves matter. The name test alone hits profit-factor code (`gross_loss
    == 0`), which is a different question with a different right answer; the 100
    is what makes it the RSI decision.
    """
    if not isinstance(node, ast.If):
        return False
    test = node.test
    if not (isinstance(test, ast.Compare) and len(test.ops) == 1
            and isinstance(test.ops[0], ast.Eq)
            and isinstance(test.comparators[0], ast.Constant)
            and test.comparators[0].value == 0):
        return False
    name = getattr(test.left, "id", None) or getattr(test.left, "attr", "") or ""
    if "loss" not in name.lower():
        return False
    return any(isinstance(k, ast.Constant) and k.value in (100, 100.0)
               for branch in list(node.body) + list(node.orelse)
               for k in ast.walk(branch))


_RETIRED_RSI_SOURCE = '''
def _rsi(closes, period):
    avg_gain = avg_loss = 0.0
    if avg_loss == 0:
        return 100.0
    return 100.0 - 100.0 / (1 + avg_gain / avg_loss)
'''

#: The one function allowed to decide it, as `path::name`. ⛔ NOT A LIST OF
#: FILES — a single qualified name, compared against a DERIVED set.
RSI_DECISION_AUTHORITY = "api/services/indicator_compute.py::rsi_from_wilder_averages"


def test_the_zero_movement_rsi_detector_fires():
    """CONTROL. The retired branch, fed to the detector, must be found."""
    assert _scan_source(_RETIRED_RSI_SOURCE, _is_zero_loss_hundred_decision), (
        "the RSI-100 detector no longer recognises the branch it was written to "
        "retire — its '1 match' reading below would be vacuous"
    )


def test_the_zero_movement_rsi_decision_is_made_in_exactly_one_function():
    """There were FOUR copies: `indicator_compute`, the screener's `technicals`,
    and both RSI-divergence detectors. Every one of them read a stock that had
    not moved at all as maximally overbought.
    """
    found = set(_scan(_is_zero_loss_hundred_decision))
    assert found == {RSI_DECISION_AUTHORITY}, (
        "the `avg_loss == 0 → 100` decision is no longer made in exactly one "
        f"place.\n  expected: {RSI_DECISION_AUTHORITY}\n  found:    "
        + "\n            ".join(sorted(found) or ["<nothing — did the authority "
                                                  "get renamed?>"])
        + "\nA second copy is how SIM/TMTS/CWEN-A/DRDB/OBA came to sit at the "
          "top of an 'RSI > 70' screen with chg_pct_1d = 0.00."
    )


def test_rsi_refuses_no_movement_but_still_pins_100_on_an_unbroken_advance():
    """The two cases are different facts. ⚠️ Exact equality, no `approx`."""
    from api.services import indicator_compute
    from api.services.screener import technicals

    flat = [10.0] * 60
    rising = [10.0 + i for i in range(60)]

    assert indicator_compute.compute_rsi_raw(flat)[-1] is None
    assert indicator_compute.compute_rsi_raw(rising)[-1] == 100.0
    assert indicator_compute.rsi_from_wilder_averages(0.0, 0.0) is None
    assert indicator_compute.rsi_from_wilder_averages(1.5, 0.0) == 100.0
    assert indicator_compute.rsi_from_wilder_averages(0.0, 2.0) == 0.0

    def bars_from(closes):
        return [{"t": 20250101 + i, "o": c, "h": c, "l": c, "c": c, "v": 1000}
                for i, c in enumerate(closes)]

    assert technicals.compute_technicals(bars_from(flat))["rsi14"] is None
    assert technicals.compute_technicals(bars_from(rising))["rsi14"] == 100.0


def test_a_flat_series_yields_no_rsi_divergence_detection():
    """The detectors read RSI as an oversold/overbought LEVEL. A window in which
    nothing moved has no level, and `None` is what they already refuse on."""
    from api.services.pattern_engine.detectors.classical import (
        rsi_bearish_divergence, rsi_bullish_divergence,
    )
    flat = [10.0] * 120
    assert rsi_bullish_divergence._compute_rsi(flat, 14)[-1] is None
    assert rsi_bearish_divergence._compute_rsi(flat, 14)[-1] is None


# ═════════════════════════════════════════════════════════════════════════════
# 3.2 — ATR% IS WILDER'S TRUE RANGE, NOT ADR UNDER ANOTHER NAME
# ═════════════════════════════════════════════════════════════════════════════

def _is_atr_from_adr(node) -> bool:
    """``<anything>["atr_pct"] = <anything>["adr_pct"]`` (or the reverse)."""
    if not isinstance(node, ast.Assign):
        return False

    def key(sub):
        return (sub.slice.value
                if isinstance(sub, ast.Subscript) and isinstance(sub.slice, ast.Constant)
                else None)

    src = key(node.value)
    if src not in ("adr_pct", "atr_pct"):
        return False
    return any(key(t) in ("atr_pct", "adr_pct") and key(t) != src
               for t in node.targets)


_RETIRED_ATR_SOURCE = '''
def compute_technicals(bars):
    out = {}
    out["adr_pct"] = 1.64
    out["atr_pct"] = out["adr_pct"]
    return out
'''


def test_the_atr_from_adr_detector_fires():
    """CONTROL."""
    assert _scan_source(_RETIRED_ATR_SOURCE, _is_atr_from_adr), (
        "the atr_pct/adr_pct aliasing detector no longer recognises the "
        "assignment it was written to retire"
    )


def test_no_module_carries_atr_pct_as_a_second_name_for_adr_pct():
    found = _scan(_is_atr_from_adr)
    assert found == {}, (
        "one of these two columns is being assigned from the other:\n  "
        + "\n  ".join(f"{k} (line {v})" for k, v in sorted(found.items()))
        + "\nADR is the mean of (h-l)/c and ignores the gap; ATR is the "
          "Wilder-smoothed TRUE range and includes it. `atr_pct` is a DECLARED "
          "scalar in closedTable.json, sentenced to members as 'the average "
          "true range percentage' — the name is published, so it has to be true."
    )


def test_the_screener_computes_no_true_range_of_its_own():
    """`technicals` must reach for `indicator_compute.compute_atr_raw`, which is
    what `tests/fixtures/indicators/atr_14.json` pins in BOTH lanes — a private
    Wilder ATR in the screener would be the same defect in a new place."""
    path = API / "services" / "screener" / "technicals.py"
    fn = _function_named(path, "_atr_pct")
    calls = {n.func.attr for n in ast.walk(fn)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    assert "compute_atr_raw" in calls, (
        "screener/technicals._atr_pct no longer calls compute_atr_raw; it is "
        f"calling {sorted(calls)}"
    )
    tree = ast.parse(path.read_text(encoding="utf-8"))
    true_range = [n.lineno for n in ast.walk(tree)
                  if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "max"
                  and len(n.args) == 3]
    assert not true_range, (
        f"a three-argument max() — the true-range shape — appeared in "
        f"screener/technicals.py at line(s) {true_range}"
    )


def test_atr_pct_is_wilder_true_range_and_differs_from_adr_when_there_are_gaps():
    """⚠️ EXACT equality against an independently written Wilder ATR."""
    from api.services.screener import technicals

    # A series that gaps every other session: (h - l) is small, but the TRUE
    # range spans the gap, so ADR and ATR cannot be the same number.
    bars = []
    price = 100.0
    for i in range(60):
        price = price + 5.0 if i % 2 == 0 else price - 4.0
        bars.append({"t": 20250101 + i, "o": price, "h": price + 0.5,
                     "l": price - 0.5, "c": price, "v": 1000})

    def oracle_atr_pct(rows, period=14):
        trs = []
        for i in range(1, len(rows)):
            prev_c = rows[i - 1]["c"]
            trs.append(max(rows[i]["h"] - rows[i]["l"],
                           abs(rows[i]["h"] - prev_c),
                           abs(rows[i]["l"] - prev_c)))
        atr = sum(trs[:period]) / period
        for i in range(period, len(trs)):
            atr = (atr * (period - 1) + trs[i]) / period
        return atr / rows[-1]["c"] * 100

    out = technicals.compute_technicals(bars)
    assert out["atr_pct"] == round(oracle_atr_pct(bars), 2)
    assert out["atr_pct"] != out["adr_pct"]


def test_atr_pct_refuses_rather_than_falling_back_to_adr_on_a_short_series():
    """Fewer than `period + 1` bars is 'not computable', not 'here is ADR'."""
    from api.services.screener import technicals
    bars = [{"t": 20250101 + i, "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1}
            for i in range(10)]
    out = technicals.compute_technicals(bars)
    assert out["atr_pct"] is None
    assert out["adr_pct"] is not None


def test_adr_counts_the_same_bars_in_its_numerator_and_its_denominator():
    """A zero close was skipped by the sum and counted by the divisor, which
    understated ADR by ~4.8% per affected bar with nothing reported. `usable_bars`
    admits `c == 0` (it checks finiteness, not positivity), so the path is live."""
    from api.services.screener import technicals

    clean = [{"t": 20250101 + i, "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1}
             for i in range(21)]
    holed = [dict(b) for b in clean]
    holed[5]["c"] = 0.0
    # 20 identical bars of (10.5-9.5)/10 = 0.10 → 10.00%, whatever the 21st is.
    assert technicals.compute_technicals(clean)["adr_pct"] == 10.0
    assert technicals.compute_technicals(holed)["adr_pct"] == 10.0


# ═════════════════════════════════════════════════════════════════════════════
# 3.4 — ONE WEIGHTED RS RETURN
# ═════════════════════════════════════════════════════════════════════════════

def _module_declares_rs_lookbacks(tree) -> bool:
    """A module that names BOTH the 3-month and 6-month RS bar offsets.

    ⭐ The PAIR is the fingerprint. `63` alone is a quarter of a year and turns
    up in unrelated code; `63` beside `126` is the RS weighting's own lookback
    table and nothing else in this corpus.
    """
    consts = {n.value for n in ast.walk(tree)
              if isinstance(n, ast.Constant) and isinstance(n.value, int)
              and not isinstance(n.value, bool)}
    return 63 in consts and 126 in consts


_RETIRED_RS_SOURCE = '''
def _compute_returns(closes):
    r3m = pct(63)
    r6m = pct(126)
    return r3m * 0.40 + (r6m if r6m is not None else r3m) * 0.20
'''

RS_AUTHORITY = "api/services/rs_weighted_return.py"


def test_the_rs_lookback_detector_fires():
    """CONTROL."""
    assert _module_declares_rs_lookbacks(ast.parse(_RETIRED_RS_SOURCE)), (
        "the RS-lookback detector no longer recognises the substituting "
        "implementation it was written to retire"
    )


def test_the_rs_lookbacks_and_weights_live_in_exactly_one_module():
    found = {path.relative_to(ROOT).as_posix()
             for path, tree in _trees() if _module_declares_rs_lookbacks(tree)}
    assert found == {RS_AUTHORITY}, (
        f"the RS weighting table is no longer in one module.\n  expected: "
        f"{RS_AUTHORITY}\n  found:    " + ", ".join(sorted(found) or ["<nothing>"])
        + "\nThe two copies disagreed by 15.7% on identical inputs (32.40 vs "
          "28.00) because one substituted for a missing period and the other "
          "renormalised."
    )


def test_the_weighted_rs_return_renormalises_and_never_substitutes():
    """The audit's worked example, both callers, exact.

    r3m = +50%, r1m = +10%, r1w = +2%, r6m unavailable.
      substituting lane (retired): 0.6(50) + 0.2(10) + 0.2(2) = 32.40
      renormalising lane (kept):   (0.4(50) + 0.2(10) + 0.2(2)) / 0.8 = 28.00
    """
    from api.services import rs_weighted_return
    from api.services.research import ratings

    returns = {"3m": 50.0, "6m": None, "1m": 10.0, "1w": 2.0}
    expected = (0.4 * 50.0 + 0.2 * 10.0 + 0.2 * 2.0) / 0.8
    assert rs_weighted_return.weighted_from_returns(returns) == expected
    assert rs_weighted_return.weighted_from_returns(returns) != 32.40

    # …and a close series producing exactly those returns, through BOTH doors.
    closes = [100.0] * 100
    closes[-1 - 63] = 100.0 / 1.50
    closes[-1 - 21] = 100.0 / 1.10
    closes[-1 - 5] = 100.0 / 1.02
    assert rs_weighted_return.period_returns(closes)["6m"] is None, (
        "the fixture must genuinely LACK a 6-month return, or this test proves "
        "nothing about the missing-period rule"
    )
    assert ratings._weighted_rs_return(closes) == rs_weighted_return.weighted_rs_return(closes)
    assert ratings._weighted_rs_return(closes) == expected


def test_an_absent_period_never_becomes_a_value():
    """`None` in, dropped — never `0`, never another period's number."""
    from api.services import rs_weighted_return

    all_present = {"3m": 10.0, "6m": 10.0, "1m": 10.0, "1w": 10.0}
    assert rs_weighted_return.weighted_from_returns(all_present) == 10.0

    only_3m = {"3m": 10.0, "6m": None, "1m": None, "1w": None}
    # Substituting 0 for the three absent terms would give 4.0; renormalising
    # over the one weight that resolved gives the honest 10.0.
    assert rs_weighted_return.weighted_from_returns(only_3m) == 10.0

    # The 3-month term is required: without it there is no RS return at all.
    assert rs_weighted_return.weighted_from_returns(
        {"3m": None, "6m": 10.0, "1m": 10.0, "1w": 10.0}) is None


def test_a_non_positive_reference_close_has_no_percentage():
    """`None`, never 0 — `lesson_a_derived_reference_needs_a_sanity_bound`."""
    from api.services import rs_weighted_return
    closes = [0.0] + [100.0] * 63
    assert rs_weighted_return.period_return(closes, 63) is None
    assert rs_weighted_return.period_return([100.0] * 10, 63) is None
