"""Vendor Parity Tranche 2, Lane A -- fourth batch (HMA + MACD) permanent
regression. Mirrors `test_vendor_parity_rma_wma.py`'s shape. Full detail,
decay curves, and the isolation findings:
`VENDOR_PARITY_TRANCHE_2_LANE_A_HMA_MACD_REPORT.md`.

HMA composes ONLY `wma` (near-window WMA(n/2), full-window WMA(n),
2*near-full, then a final WMA over sqrt(n)) -- a memoryless, finite-impulse
construction with no recursive/leaky state. Confirmed empirically (0
disagreements among all 2,009 comparable bars, `warmup_bars=22` = its own
true structural period-warmup, no additional margin) that it shares sma/wma's
own zero-capture-window-lag finding, and its max delta is EXACTLY 0 -- tying
wma for the tightest result this program has vendor-verified.

MACD is a 3-output composite and gets THREE separate observations (line,
signal, histogram) so no output's agreement can mask another's disagreement.
The LINE is UCT's shipped `macd` builtin (internally
`indicator_compute._ema_core`-seeded fast/slow EMAs -- recursive, carries the
SAME capture-window cold-start lag already documented for ema/rma/rsi/atr,
compounding TWO independent EMA seed errors). The SIGNAL and HISTOGRAM are
member-composed formulas (`ema(macd(...),9)` / `macd(...) - ema(macd(...),9)`)
per `closedTable.json::_functions_excluded.macdSignal` -- the signal is built
via `ast_interpret._ema_col`, an ARCHITECTURALLY SEPARATE smoother from the
line's own internal `indicator_compute._ema_core`. This gives clean mutation
isolation, proven below: mutating `_ema_col` corrupts signal+histogram while
the LINE stays VERIFIED; mutating `_ema_core` corrupts line+signal+histogram
together (the signal is built on the line's own now-wrong output).

⛔⛔ SWAPPED fast/slow ARGS DO NOT PRODUCE A WRONG NUMBER -- they RAISE
`TableRefusal` at the table/budget level (`ast_budget._assert_arg_domain`)
before any computation is attempted, a STRONGER protection than a silent
DATA_BLOCKED result. `test_MUTATION_macd_swapped_fast_slow_is_refused_at_the_table_level`
asserts the raise, not a comparison verdict.
"""
import copy
import json
import math
from pathlib import Path

import pytest

from api.services import ast_interpret
from api.services import indicator_compute
from api.services.ast_interpret import TableRefusal
from tools.vendor_parity_compare import VendorSourceRefused, compare

ROOT = Path(__file__).resolve().parent.parent
OBS_DIR = ROOT / "tests" / "fixtures" / "vendor" / "observations"

_CASES = {
    "hma": ("hma-close20-2026-09-06.json", 22),
    "macd_line": ("macd-line-12-26-2026-09-06.json", 210),
    "macd_signal": ("macd-signal-12-26-9-2026-09-06.json", 210),
    "macd_hist": ("macd-hist-12-26-9-2026-09-06.json", 210),
}


def _load(name: str) -> dict:
    return json.loads((OBS_DIR / name).read_text(encoding="utf-8"))


def _obs(key: str) -> dict:
    name, _ = _CASES[key]
    return _load(name)


def _warmup(key: str) -> int:
    _, warmup = _CASES[key]
    return warmup


_MACD_LINE_AST = {"type": "call", "name": "macd", "args": [
    {"type": "series", "name": "close"}, {"type": "num", "value": 12},
    {"type": "num", "value": 26}]}
_MACD_SIGNAL_AST = {"type": "call", "name": "ema", "args": [
    _MACD_LINE_AST, {"type": "num", "value": 9}]}


@pytest.mark.parametrize("key", sorted(_CASES.keys()))
def test_vendor_parity_verified_against_real_multi_bar_capture(key):
    obs = _obs(key)
    warmup = _warmup(key)
    result = compare(obs, warmup_bars=warmup, tolerance_rel=1e-6)
    assert result["verdict"] == "VENDOR-PARITY VERIFIED", (
        f"{key}: expected VENDOR-PARITY VERIFIED, got {result['verdict']} "
        f"(disagreements={result['disagreement_count']})"
    )
    assert result["compared_non_warmup"] > 1000


def test_hma_has_zero_seed_convergence_lag_the_naive_period_warmup_suffices():
    """HMA-specific: like sma/wma, EVERY bar from the true structural
    period-warmup boundary onward already agrees -- no additional margin
    needed, and the max delta is EXACTLY 0 (ties wma's own tightest result)."""
    obs = _obs("hma")
    assert obs["_vendor_parity_warmup_bars"] == 22
    result = compare(obs, warmup_bars=22, tolerance_rel=1e-6)
    assert result["verdict"] == "VENDOR-PARITY VERIFIED"
    assert result["max_abs_delta_non_warmup"] == 0.0


@pytest.mark.parametrize("key,expected_warmup", [
    ("hma", 22), ("macd_line", 25), ("macd_signal", 33), ("macd_hist", 33),
])
def test_the_true_period_warmup_bars_are_reported_not_silently_dropped(key, expected_warmup):
    """The observation's own `_vendor_parity_warmup_bars` is a conservative
    margin past the measured convergence point, NEVER the semantic
    period-warmup -- assert the semantic warmup separately here."""
    obs = _obs(key)
    result = compare(obs, warmup_bars=obs["_vendor_parity_warmup_bars"], tolerance_rel=1e-6)
    assert len(result["rows"]) == len(obs["market"]["bars"])
    assert result["any_data_blocked"] is True
    # the semantic warmup is a STRICT SUBSET of the blocked rows (the
    # observation's warmup margin is >= the semantic one for every case here)
    blocked_indices = {r["index"] for r in result["rows"] if r["status"] == "DATA_BLOCKED"}
    assert set(range(expected_warmup)) <= blocked_indices


# ============ HMA mutations ============

def _reversed_weighted_mean(series, lo, hi):
    weighted = 0.0
    weights = 0.0
    for i in range(lo, hi + 1):
        w = float(hi - i + 1)  # REVERSED: oldest gets the highest weight
        weighted += series[i] * w
        weights += w
    return weighted / weights


def _hma_wrong_half(series, n):
    half = max(1, int(n) // 2) + 1  # WRONG: off-by-one on the half-length
    root = max(1, int(math.floor(math.sqrt(float(n)) + 0.5)))
    near = ast_interpret._rolling(series, half, ast_interpret._window_weighted_mean)
    full = ast_interpret._rolling(series, n, ast_interpret._window_weighted_mean)
    raw = [2.0 * a - b for a, b in zip(near, full)]
    return ast_interpret._rolling(raw, root, ast_interpret._window_weighted_mean)


def _hma_wrong_root(series, n):
    half = max(1, int(n) // 2)
    root = max(1, int(math.ceil(math.sqrt(float(n)))))  # WRONG: ceil, not round-half-up
    near = ast_interpret._rolling(series, half, ast_interpret._window_weighted_mean)
    full = ast_interpret._rolling(series, n, ast_interpret._window_weighted_mean)
    raw = [2.0 * a - b for a, b in zip(near, full)]
    return ast_interpret._rolling(raw, root, ast_interpret._window_weighted_mean)


def _hma_wrong_coefficient(series, n):
    half = max(1, int(n) // 2)
    root = max(1, int(math.floor(math.sqrt(float(n)) + 0.5)))
    near = ast_interpret._rolling(series, half, ast_interpret._window_weighted_mean)
    full = ast_interpret._rolling(series, n, ast_interpret._window_weighted_mean)
    raw = [1.5 * a - 0.5 * b for a, b in zip(near, full)]  # WRONG: not 2*near-full
    return ast_interpret._rolling(raw, root, ast_interpret._window_weighted_mean)


@pytest.mark.parametrize("mutant,label", [
    (None, "reversed WMA weighting"),  # handled specially below (patches _window_weighted_mean)
    (_hma_wrong_half, "wrong half-length rounding"),
    (_hma_wrong_root, "wrong sqrt-length rounding"),
    (_hma_wrong_coefficient, "wrong arithmetic coefficient"),
])
def test_MUTATION_hma_disagrees_on_every_steady_state_bar(mutant, label):
    obs = _obs("hma")
    if mutant is None:
        orig = ast_interpret._window_weighted_mean
        ast_interpret._window_weighted_mean = _reversed_weighted_mean
        try:
            result = compare(obs, warmup_bars=22, tolerance_rel=1e-6)
        finally:
            ast_interpret._window_weighted_mean = orig
    else:
        orig = ast_interpret._hma_col
        ast_interpret._hma_col = mutant
        try:
            result = compare(obs, warmup_bars=22, tolerance_rel=1e-6)
        finally:
            ast_interpret._hma_col = orig

    assert compare(obs, warmup_bars=22, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED", (
        f"{label}: unmutated control failed to re-verify"
    )
    assert result["verdict"] != "VENDOR-PARITY VERIFIED", f"{label}: mutation did not flip the verdict"
    assert result["disagreement_count"] >= result["compared_non_warmup"] - 5


# ============ MACD mutations ============

def test_MUTATION_macd_swapped_fast_slow_is_refused_at_the_table_level():
    """⛔⛔ NOT a numeric mismatch -- the table/budget guard
    (`ast_budget._assert_arg_domain`, lookback `arg2`) raises `TableRefusal`
    before any computation runs. A STRONGER protection than DATA_BLOCKED:
    the call is refused outright, never silently computed wrong."""
    obs = _obs("macd_line")
    swapped = copy.deepcopy(obs)
    swapped["engine"]["ast"] = {"type": "call", "name": "macd", "args": [
        {"type": "series", "name": "close"}, {"type": "num", "value": 26},
        {"type": "num", "value": 12}]}
    with pytest.raises(TableRefusal):
        compare(swapped, warmup_bars=210, tolerance_rel=1e-6)
    # control: the unswapped observation still verifies
    assert compare(obs, warmup_bars=210, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"


def _wilder_ema_core(values, period):
    """`indicator_compute._ema_core` with Wilder's alpha (1/period) instead
    of 2/(period+1) -- corrupts the LINE's own internal fast/slow EMAs."""
    n = len(values)
    out = [None] * n
    if period <= 0 or n < period:
        return out
    k = 1.0 / period
    seed = sum(values[:period]) / period
    out[period - 1] = seed
    prev = seed
    for i in range(period, n):
        prev = prev * (1 - k) + values[i] * k
        out[i] = prev
    return out


def test_MUTATION_macd_wrong_ema_alpha_isolated_to_the_line_corrupts_all_three_outputs():
    """A wrong alpha in `indicator_compute._ema_core` (the LINE's own internal
    fast/slow EMAs) corrupts the line AND propagates into the signal and
    histogram, since both are built on the line's now-wrong output. This is
    the expected, NOT-masked propagation direction -- not an isolation claim."""
    orig = indicator_compute._ema_core
    indicator_compute._ema_core = _wilder_ema_core
    try:
        line_result = compare(_obs("macd_line"), warmup_bars=210, tolerance_rel=1e-6)
        signal_result = compare(_obs("macd_signal"), warmup_bars=210, tolerance_rel=1e-6)
        hist_result = compare(_obs("macd_hist"), warmup_bars=210, tolerance_rel=1e-6)
    finally:
        indicator_compute._ema_core = orig

    assert line_result["verdict"] != "VENDOR-PARITY VERIFIED"
    assert signal_result["verdict"] != "VENDOR-PARITY VERIFIED"
    assert hist_result["verdict"] != "VENDOR-PARITY VERIFIED"
    for key in ("macd_line", "macd_signal", "macd_hist"):
        assert compare(_obs(key), warmup_bars=210, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"


def test_MUTATION_macd_wrong_signal_smoothing_ISOLATED_to_signal_never_touches_the_line():
    """⭐⭐ THE ISOLATION PROOF. `ast_interpret._ema_col` (what the composed
    `ema(macd(...),9)` signal formula uses) is ARCHITECTURALLY SEPARATE from
    `indicator_compute._ema_core` (what the line's own internal fast/slow EMAs
    use). Mutating `_ema_col` MUST corrupt signal + histogram while the LINE
    stays VENDOR-PARITY VERIFIED -- proving one output's agreement cannot mask
    another's disagreement, and vice versa."""
    orig = ast_interpret._ema_col
    ast_interpret._ema_col = lambda series, n: ast_interpret._smooth_col(series, n, 1.0 / n)
    try:
        line_result = compare(_obs("macd_line"), warmup_bars=210, tolerance_rel=1e-6)
        signal_result = compare(_obs("macd_signal"), warmup_bars=210, tolerance_rel=1e-6)
        hist_result = compare(_obs("macd_hist"), warmup_bars=210, tolerance_rel=1e-6)
    finally:
        ast_interpret._ema_col = orig

    assert line_result["verdict"] == "VENDOR-PARITY VERIFIED", (
        "the LINE must be UNAFFECTED by an _ema_col mutation -- it never calls "
        "_ema_col; if this fails, the architectural isolation claim is false"
    )
    assert signal_result["verdict"] != "VENDOR-PARITY VERIFIED"
    assert hist_result["verdict"] != "VENDOR-PARITY VERIFIED"
    assert compare(_obs("macd_signal"), warmup_bars=210, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"
    assert compare(_obs("macd_hist"), warmup_bars=210, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"


def test_MUTATION_macd_histogram_sign_inversion_flips_only_the_histogram():
    """`signal - line` instead of `line - signal` -- line and signal are
    untouched (their own observations/ASTs are unaffected); only the
    histogram's own verdict flips."""
    hist_obs = _obs("macd_hist")
    inverted = copy.deepcopy(hist_obs)
    inverted["engine"]["ast"] = {"type": "op", "name": "-",
                                  "args": [_MACD_SIGNAL_AST, _MACD_LINE_AST]}
    result = compare(inverted, warmup_bars=210, tolerance_rel=1e-6)
    assert result["verdict"] != "VENDOR-PARITY VERIFIED"
    assert result["disagreement_count"] >= result["compared_non_warmup"] - 5

    assert compare(_obs("macd_line"), warmup_bars=210, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"
    assert compare(_obs("macd_signal"), warmup_bars=210, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"
    assert compare(hist_obs, warmup_bars=210, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"


@pytest.mark.parametrize("key", sorted(_CASES.keys()))
@pytest.mark.parametrize("bad_token", ["uct-generated", "internal-generated", "self-generated", ""])
def test_a_non_vendor_provenance_is_refused_never_treated_as_truth(key, bad_token):
    obs = _obs(key)
    poisoned = json.loads(json.dumps(obs))
    poisoned["provenance"]["platform"] = bad_token
    with pytest.raises(VendorSourceRefused):
        compare(poisoned, warmup_bars=_warmup(key), tolerance_rel=1e-6)
