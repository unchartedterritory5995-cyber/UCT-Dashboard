"""Vendor Parity Tranche 2, Lane A -- third batch (RMA + WMA) permanent
regression. Mirrors `test_vendor_parity_sma_ema.py`'s shape. Full detail,
decay curve, and the initialization finding:
`VENDOR_PARITY_TRANCHE_2_LANE_A_RMA_WMA_REPORT.md`.

RMA (Wilder's smoothing, alpha=1/n) shares UCT's own `_smooth_col` primitive
with ema (alpha=2/(n+1)) -- SMA-of-first-window seeded, matching Pine's own
documented `ta.rma` convention. It underlies rsi/atr/adx-family directly, so
this is the first STANDALONE real-vendor confirmation of the shared
primitive those composites are built on. It shows the same general
capture-window cold-start effect already documented for rsi/atr/ema
(`divergences.json::recursive-smoother-cold-start-in-a-finite-capture`),
converging FASTER than the RSI/ATR composites built on it (measured boundary:
bar 130 of 2,031, vs rsi/atr's ~169-172) -- expected, since RSI/ATR compound
TWO independent RMA seed errors while a standalone rma carries only its own.

WMA, like SMA, is memoryless (a finite-impulse linearly-weighted rolling
mean) -- it carries NO capture-window seed-convergence lag. `warmup_bars=19`
is its true, full semantic period-warmup with no additional margin needed.

⛔⛔ SAME BOUNDARY AS EMA: a steady-state check alone cannot discriminate a
wrong RMA seeding convention -- `test_MUTATION_rma_wrong_seed_is_NOT_caught_
by_the_steady_state_check_alone` is a CONFIRMED-vacuous control, kept and
asserted on PURPOSE. Do NOT read RMA's "VENDOR-PARITY VERIFIED" alone as an
unqualified initialization claim -- the separate real-early-bar candidate-
discrimination test is what proves the initialization.
"""
import json
import math
from pathlib import Path

import pytest

from api.services import ast_interpret
from tools.vendor_parity_compare import VendorSourceRefused, compare

ROOT = Path(__file__).resolve().parent.parent
OBS_DIR = ROOT / "tests" / "fixtures" / "vendor" / "observations"

_CASES = {
    "rma": "rma-close14-2026-09-06.json",
    "wma": "wma-close20-2026-09-06.json",
}


def _load(name: str) -> dict:
    return json.loads((OBS_DIR / name).read_text(encoding="utf-8"))


def _wrong_seed_rma_col(series, n):
    """Seeds with the single first finite value instead of SMA(n)."""
    out = [float("nan")] * len(series)
    prev = float("nan")
    k = 1.0 / n
    for i, v in enumerate(series):
        if not math.isfinite(v):
            prev = float("nan")
            continue
        if math.isnan(prev):
            prev = v
            out[i] = prev
        else:
            prev = prev * (1 - k) + v * k
            out[i] = prev
    return out


def _reversed_weighted_mean(series, lo, hi):
    weighted = 0.0
    weights = 0.0
    for i in range(lo, hi + 1):
        w = float(hi - i + 1)  # REVERSED: oldest gets the highest weight
        weighted += series[i] * w
        weights += w
    return weighted / weights


def _wrong_denominator_weighted_mean(series, lo, hi):
    weighted = 0.0
    n = hi - lo + 1
    for i in range(lo, hi + 1):
        w = float(i - lo + 1)
        weighted += series[i] * w
    return weighted / n  # WRONG: should divide by sum(1..n), not n


@pytest.mark.parametrize("fn_name", sorted(_CASES.keys()))
def test_vendor_parity_verified_against_real_multi_bar_capture(fn_name):
    obs = _load(_CASES[fn_name])
    warmup = obs["_vendor_parity_warmup_bars"]

    result = compare(obs, warmup_bars=warmup, tolerance_rel=1e-6)

    assert result["verdict"] == "VENDOR-PARITY VERIFIED", (
        f"{fn_name}: expected VENDOR-PARITY VERIFIED, got {result['verdict']} "
        f"(disagreements={result['disagreement_count']})"
    )
    assert result["compared_non_warmup"] > 1000


def test_wma_has_zero_seed_convergence_lag_the_naive_period_warmup_suffices():
    """WMA-specific: like sma, EVERY bar from the true period-warmup boundary
    onward already agrees -- no additional margin needed."""
    obs = _load(_CASES["wma"])
    assert obs["_vendor_parity_warmup_bars"] == 19
    result = compare(obs, warmup_bars=19, tolerance_rel=1e-6)
    assert result["verdict"] == "VENDOR-PARITY VERIFIED"
    assert result["max_abs_delta_non_warmup"] < 1e-6


@pytest.mark.parametrize("fn_name", sorted(_CASES.keys()))
def test_the_true_period_warmup_bars_are_reported_not_silently_dropped(fn_name):
    obs = _load(_CASES[fn_name])
    expected_warmup = {"rma": 13, "wma": 19}[fn_name]
    result = compare(obs, warmup_bars=obs["_vendor_parity_warmup_bars"], tolerance_rel=1e-6)

    assert len(result["rows"]) == len(obs["market"]["bars"])
    blocked = [r for r in result["rows"] if r["status"] == "DATA_BLOCKED"]
    assert len(blocked) == expected_warmup
    assert result["any_data_blocked"] is True


def test_MUTATION_rma_wrong_alpha_disagrees_on_almost_every_steady_state_bar():
    """EMA-style alpha (2/(n+1)) instead of Wilder's true 1/n."""
    obs = _load(_CASES["rma"])
    warmup = obs["_vendor_parity_warmup_bars"]
    orig = ast_interpret._rma_col
    ast_interpret._rma_col = lambda series, n: ast_interpret._smooth_col(series, n, 2.0 / (n + 1))
    try:
        result = compare(obs, warmup_bars=warmup, tolerance_rel=1e-6)
    finally:
        ast_interpret._rma_col = orig
    assert compare(obs, warmup_bars=warmup, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"

    assert result["verdict"] != "VENDOR-PARITY VERIFIED"
    # ⛔ NOT necessarily 100%: a materially different alpha can still coincide
    # with the real value at an isolated crossing bar. The real proof is the
    # overwhelming majority, not every single bar.
    assert result["disagreement_count"] >= result["compared_non_warmup"] - 5


def test_MUTATION_rma_wrong_seed_is_NOT_caught_by_the_steady_state_check_alone():
    """⛔⛔ A CONFIRMED-VACUOUS CONTROL, KEPT ON PURPOSE -- mirrors EMA's own
    documented boundary. A wrong RMA seeding convention (first-value seed
    instead of SMA(14)) still passes the steady-state check: its bounded seed
    error decays at the SAME fixed rate a correct seed's error does. If this
    assertion ever starts FAILING, that is not a regression -- investigate why
    the exponential-decay boundary moved before touching anything."""
    obs = _load(_CASES["rma"])
    warmup = obs["_vendor_parity_warmup_bars"]
    orig = ast_interpret._rma_col
    ast_interpret._rma_col = lambda series, n: _wrong_seed_rma_col(series, n)
    try:
        result = compare(obs, warmup_bars=warmup, tolerance_rel=1e-6)
    finally:
        ast_interpret._rma_col = orig

    assert result["verdict"] == "VENDOR-PARITY VERIFIED", (
        "the wrong-seed mutation was expected to still pass the steady-state-only "
        "check, mirroring EMA's own documented boundary -- if it now fails, "
        "re-investigate before assuming this is progress"
    )


def test_rma_initialization_the_real_seeding_convention_matches_early_vendor_bars():
    """⭐⭐ THE ACTUAL RMA INITIALIZATION PROOF, same methodology as EMA's.
    Measured: 137/137 (100%) of bars 13-149 (the region the steady-state
    check excludes) favor UCT's real SMA-of-window seed over a wrong
    first-value-seed alternative, on the SAME real captured bars."""
    obs = _load(_CASES["rma"])
    bars = obs["market"]["bars"]
    closes = [b["c"] for b in bars]
    vendor = obs["vendor"]["values"]

    real_col = ast_interpret._rma_col(closes, 14)
    wrong_col = _wrong_seed_rma_col(closes, 14)

    checked = 0
    real_closer = 0
    for i in range(13, 150):
        t = bars[i]["t"]
        v = vendor.get(t)
        if v is None:
            continue
        checked += 1
        if abs(real_col[i] - v) < abs(wrong_col[i] - v):
            real_closer += 1

    assert checked >= 50
    assert real_closer == checked, (
        f"the real seeding convention was closer to the real vendor value on only "
        f"{real_closer}/{checked} early bars -- expected all of them"
    )


def test_MUTATION_wma_reversed_weight_disagrees_on_every_steady_state_bar():
    obs = _load(_CASES["wma"])
    orig = ast_interpret._window_weighted_mean
    ast_interpret._window_weighted_mean = _reversed_weighted_mean
    try:
        result = compare(obs, warmup_bars=19, tolerance_rel=1e-6)
    finally:
        ast_interpret._window_weighted_mean = orig
    assert compare(obs, warmup_bars=19, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"

    assert result["verdict"] != "VENDOR-PARITY VERIFIED"
    assert result["disagreement_count"] == result["compared_non_warmup"]


def test_MUTATION_wma_wrong_denominator_disagrees_on_every_steady_state_bar():
    obs = _load(_CASES["wma"])
    orig = ast_interpret._window_weighted_mean
    ast_interpret._window_weighted_mean = _wrong_denominator_weighted_mean
    try:
        result = compare(obs, warmup_bars=19, tolerance_rel=1e-6)
    finally:
        ast_interpret._window_weighted_mean = orig
    assert compare(obs, warmup_bars=19, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"

    assert result["verdict"] != "VENDOR-PARITY VERIFIED"
    assert result["disagreement_count"] == result["compared_non_warmup"]


@pytest.mark.parametrize("fn_name", sorted(_CASES.keys()))
@pytest.mark.parametrize("bad_token", ["uct-generated", "internal-generated", "self-generated", ""])
def test_a_non_vendor_provenance_is_refused_never_treated_as_truth(fn_name, bad_token):
    obs = _load(_CASES[fn_name])
    poisoned = json.loads(json.dumps(obs))
    poisoned["provenance"]["platform"] = bad_token
    with pytest.raises(VendorSourceRefused):
        compare(poisoned, warmup_bars=obs["_vendor_parity_warmup_bars"], tolerance_rel=1e-6)
