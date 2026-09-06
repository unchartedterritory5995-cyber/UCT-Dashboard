"""Vendor Parity Tranche 2, Lane A -- second batch (SMA + EMA) permanent
regression. Mirrors `test_vendor_parity_rsi_atr.py`'s shape. Full detail,
decay curve, and the initialization-discrimination finding:
`VENDOR_PARITY_TRANCHE_2_LANE_A_SMA_EMA_REPORT.md`.

SMA is memoryless (a finite rolling mean) -- it carries NO capture-window
seed-convergence lag, unlike the Wilder/RMA-recursive rsi/atr or the
exponentially-recursive ema. `warmup_bars=19` is its true, full semantic
period-warmup with no additional margin needed.

EMA IS recursive (a leaky exponential filter) and DOES show the same general
capture-window cold-start effect already documented for rsi/atr
(`divergences.json::recursive-smoother-cold-start-in-a-finite-capture`), just
smaller and faster-converging (its SMA-of-window seed starts much closer to
the true value than rsi/atr's simple-mean-of-diffs seed).

⛔⛔ THE STEADY-STATE CHECK ALONE CANNOT DISCRIMINATE A WRONG SEEDING
CONVENTION -- discovered here, not assumed. A "seed with the first value
instead of SMA(20)" mutation was tried against `warmup_bars=100`'s steady-state
check and IT STILL VERIFIED CLEAN, because a bounded seed error decays
exponentially at the SAME rate regardless of which (bounded) seed was used --
by bar 100 either seed's error has already decayed below the 1e-6 tolerance.
So `test_MUTATION_wrong_seed_is_NOT_caught_by_the_steady_state_check_alone`
below is a CONFIRMED-vacuous control, kept and asserted on PURPOSE (not
deleted) as a permanent record of the boundary of what the steady-state check
proves. The REAL initialization proof is the separate candidate-discrimination
test: on 81/81 real early bars (index 19-99), UCT's ACTUAL seeding convention
(SMA-of-first-window) sits closer to the real vendor value than the wrong-seed
alternative -- a check that uses the EARLY bars specifically, rather than
excluding them.
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
    "sma": "sma-close20-2026-09-06.json",
    "ema": "ema-close20-2026-09-06.json",
}


def _load(name: str) -> dict:
    return json.loads((OBS_DIR / name).read_text(encoding="utf-8"))


def _wrong_seed_ema_col(series, n):
    """Seeds with the single first finite value instead of SMA(n) -- a
    plausible, DIFFERENT initialization convention, never the real one."""
    out = [float("nan")] * len(series)
    prev = float("nan")
    k = 2.0 / (n + 1)
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


@pytest.mark.parametrize("fn_name", sorted(_CASES.keys()))
def test_vendor_parity_verified_against_real_multi_bar_capture(fn_name):
    obs = _load(_CASES[fn_name])
    warmup = obs["_vendor_parity_warmup_bars"]

    result = compare(obs, warmup_bars=warmup, tolerance_rel=1e-6)

    assert result["verdict"] == "VENDOR-PARITY VERIFIED", (
        f"{fn_name}: expected VENDOR-PARITY VERIFIED, got {result['verdict']} "
        f"(disagreements={result['disagreement_count']})"
    )
    # ⛔ NON-VACUITY: a real, large number of bars were actually compared.
    assert result["compared_non_warmup"] > 1000


def test_sma_has_zero_seed_convergence_lag_the_naive_period_warmup_suffices():
    """SMA-specific: unlike rsi/atr/ema, EVERY bar from the true period-warmup
    boundary onward already agrees -- no additional margin is needed. This is
    the structural claim ("SMA is memoryless") turned into an executable
    check, not merely asserted in prose."""
    obs = _load(_CASES["sma"])
    assert obs["_vendor_parity_warmup_bars"] == 19
    result = compare(obs, warmup_bars=19, tolerance_rel=1e-6)
    assert result["verdict"] == "VENDOR-PARITY VERIFIED"
    assert result["max_abs_delta_non_warmup"] < 1e-6


@pytest.mark.parametrize("fn_name", sorted(_CASES.keys()))
def test_the_true_period_warmup_bars_are_reported_not_silently_dropped(fn_name):
    obs = _load(_CASES[fn_name])
    result = compare(obs, warmup_bars=obs["_vendor_parity_warmup_bars"], tolerance_rel=1e-6)

    assert len(result["rows"]) == len(obs["market"]["bars"])
    blocked = [r for r in result["rows"] if r["status"] == "DATA_BLOCKED"]
    assert len(blocked) == 19
    assert result["any_data_blocked"] is True


def test_MUTATION_sma_wrong_denominator_disagrees_on_every_steady_state_bar():
    obs = _load(_CASES["sma"])
    orig = ast_interpret._window_mean

    def bad_window_mean(series, lo, hi):
        total = 0.0
        for i in range(lo, hi + 1):
            total += series[i]
        return total / (hi - lo + 2)  # wrong: one more than the true window size

    ast_interpret._window_mean = bad_window_mean
    try:
        result = compare(obs, warmup_bars=19, tolerance_rel=1e-6)
    finally:
        ast_interpret._window_mean = orig
    assert compare(obs, warmup_bars=19, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"

    assert result["verdict"] != "VENDOR-PARITY VERIFIED"
    assert result["disagreement_count"] == result["compared_non_warmup"]


def test_MUTATION_ema_wrong_alpha_disagrees_on_every_steady_state_bar():
    obs = _load(_CASES["ema"])
    warmup = obs["_vendor_parity_warmup_bars"]
    orig = ast_interpret._ema_col
    ast_interpret._ema_col = lambda series, n: ast_interpret._smooth_col(series, n, (2.0 / (n + 1)) * 3.0)
    try:
        result = compare(obs, warmup_bars=warmup, tolerance_rel=1e-6)
    finally:
        ast_interpret._ema_col = orig
    assert compare(obs, warmup_bars=warmup, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"

    assert result["verdict"] != "VENDOR-PARITY VERIFIED"
    assert result["disagreement_count"] == result["compared_non_warmup"]


def test_MUTATION_wrong_seed_is_NOT_caught_by_the_steady_state_check_alone():
    """⛔⛔ A CONFIRMED-VACUOUS CONTROL, KEPT ON PURPOSE. A wrong EMA seeding
    convention (first-value seed instead of SMA(20)) still passes the
    steady-state check at warmup_bars=100 -- its bounded seed error has
    already decayed below tolerance by then, exactly like a correct seed's
    error does. This is not a bug in the check; it is the documented boundary
    of what a steady-state-only comparison can prove, and it is WHY the
    separate initialization-discrimination test below exists. If this
    assertion ever starts FAILING (i.e. the wrong seed starts getting
    caught), that is not a regression -- investigate why the boundary moved
    before touching anything."""
    obs = _load(_CASES["ema"])
    warmup = obs["_vendor_parity_warmup_bars"]
    orig = ast_interpret._ema_col
    ast_interpret._ema_col = lambda series, n: _wrong_seed_ema_col(series, n)
    try:
        result = compare(obs, warmup_bars=warmup, tolerance_rel=1e-6)
    finally:
        ast_interpret._ema_col = orig

    assert result["verdict"] == "VENDOR-PARITY VERIFIED", (
        "the wrong-seed mutation was expected to still pass the steady-state-only "
        "check -- if it now fails, the exponential decay boundary moved; "
        "re-investigate before assuming this is progress"
    )


def test_ema_initialization_the_real_seeding_convention_matches_early_vendor_bars():
    """⭐⭐ THE ACTUAL INITIALIZATION PROOF. Not "does it eventually converge"
    (any bounded seed does) -- does UCT's REAL seeding convention (SMA of the
    first window) track the real vendor's OWN early-bar trajectory more
    closely than a plausible wrong alternative (first-value seed), on the
    SAME real captured bars, at EVERY early bar? Measured: 81/81 (100%) of
    bars 19-99 (the region the steady-state check excludes) favor the real
    convention. This is what makes the initialization claim non-vacuous."""
    obs = _load(_CASES["ema"])
    bars = obs["market"]["bars"]
    closes = [b["c"] for b in bars]
    vendor = obs["vendor"]["values"]

    real_col = ast_interpret._ema_col(closes, 20)
    wrong_col = _wrong_seed_ema_col(closes, 20)

    checked = 0
    real_closer = 0
    for i in range(19, 100):
        t = bars[i]["t"]
        v = vendor.get(t)
        if v is None:
            continue
        checked += 1
        if abs(real_col[i] - v) < abs(wrong_col[i] - v):
            real_closer += 1

    # ⛔ NON-VACUITY: a real, non-trivial number of early bars were checked.
    assert checked >= 50
    assert real_closer == checked, (
        f"the real seeding convention was closer to the real vendor value on only "
        f"{real_closer}/{checked} early bars -- expected all of them"
    )


@pytest.mark.parametrize("fn_name", sorted(_CASES.keys()))
@pytest.mark.parametrize("bad_token", ["uct-generated", "internal-generated", "self-generated", ""])
def test_a_non_vendor_provenance_is_refused_never_treated_as_truth(fn_name, bad_token):
    obs = _load(_CASES[fn_name])
    poisoned = json.loads(json.dumps(obs))
    poisoned["provenance"]["platform"] = bad_token
    with pytest.raises(VendorSourceRefused):
        compare(poisoned, warmup_bars=obs["_vendor_parity_warmup_bars"], tolerance_rel=1e-6)
