"""Vendor Parity Tranche 2, Lane A — first batch (RSI + ATR) permanent regression.

Mirrors `test_vendor_parity_lane_b.py`'s shape, adapted for a MULTI-BAR (1,328
real bar) capture rather than a single probe row, per the explicit instruction
to avoid Lane B's first-pass single-probe overclaim. Full detail, decay curve
and mutation results: `VENDOR_PARITY_TRANCHE_2_LANE_A_RSI_ATR_REPORT.md`.

⛔ `warmup_bars=180` on both observations is NOT the semantic 14-bar period-
warmup — it additionally covers an empirically measured seed-convergence lag
(UCT re-seeds cold at this capture window's own first bar; the real vendor
value already reflects decades of continuous smoothing). See each
observation's own `_vendor_parity_warmup_bars_note` and the report's §9.
"""
import json
from pathlib import Path

import pytest

from api.services import ast_interpret
from tools.vendor_parity_compare import VendorSourceRefused, compare

ROOT = Path(__file__).resolve().parent.parent
OBS_DIR = ROOT / "tests" / "fixtures" / "vendor" / "observations"

_CASES = {
    "rsi": "rsi-close14-2026-09-06.json",
    "atr": "atr-14-2026-09-06.json",
}


def _load(name: str) -> dict:
    return json.loads((OBS_DIR / name).read_text(encoding="utf-8"))


def _cutler_rsi_col(closes, n=14):
    """Cutler's RSI: SIMPLE means over the trailing N diffs, no recursion --
    the exact historical bug shape RISK-019 shipped (rsi14 under Wilder's name).
    """
    out = [None] * len(closes)
    for i in range(n, len(closes)):
        gain = loss = 0.0
        for k in range(i - n + 1, i + 1):
            d = closes[k] - closes[k - 1]
            gain += max(d, 0.0)
            loss += max(-d, 0.0)
        avg_gain, avg_loss = gain / n, loss / n
        if avg_loss == 0:
            out[i] = 100.0 if avg_gain else None
        else:
            out[i] = 100.0 - 100.0 / (1 + avg_gain / avg_loss)
    return out


def _bad_atr_col(bars, n=14):
    """A bare high-low range, never the true range."""
    hl = [b["h"] - b["l"] for b in bars]
    out = [None] * len(bars)
    if len(bars) < n:
        return out
    avg = sum(hl[1:n + 1]) / n
    out[n] = avg
    for i in range(n + 1, len(bars)):
        avg = (avg * (n - 1) + hl[i]) / n
        out[i] = avg
    return out


@pytest.mark.parametrize("fn_name", sorted(_CASES.keys()))
def test_vendor_parity_verified_against_real_multi_bar_capture(fn_name):
    """UCT's own interpreter matches the REAL TradingView value on every one
    of 1,148 real, current-market steady-state bars -- not one probe row."""
    obs = _load(_CASES[fn_name])
    warmup = obs["_vendor_parity_warmup_bars"]

    result = compare(obs, warmup_bars=warmup, tolerance_rel=1e-6)

    assert result["verdict"] == "VENDOR-PARITY VERIFIED", (
        f"{fn_name}: expected VENDOR-PARITY VERIFIED, got {result['verdict']} "
        f"(disagreements={result['disagreement_count']})"
    )
    # ⛔ NON-VACUITY: a real, large number of bars were actually compared, not
    # silently excluded as warm-up. 1,328 total - 180 warmup-and-lag = 1,148.
    assert result["compared_non_warmup"] == 1148
    assert result["max_abs_delta_non_warmup"] < 1e-4


@pytest.mark.parametrize("fn_name", sorted(_CASES.keys()))
def test_the_true_period_warmup_bars_are_reported_not_silently_dropped(fn_name):
    """Every one of the 1,328 bars appears in the output; the 14 genuinely
    non-computable bars are explicit DATA_BLOCKED rows, not absent ones."""
    obs = _load(_CASES[fn_name])
    result = compare(obs, warmup_bars=obs["_vendor_parity_warmup_bars"], tolerance_rel=1e-6)

    assert len(result["rows"]) == len(obs["market"]["bars"]) == 1328
    blocked = [r for r in result["rows"] if r["status"] == "DATA_BLOCKED"]
    assert len(blocked) == 14
    assert result["any_data_blocked"] is True


@pytest.mark.parametrize("fn_name", sorted(_CASES.keys()))
def test_MUTATION_a_different_formula_disagrees_on_every_steady_state_bar(fn_name):
    """Non-vacuity control: swap the real formula for a different, wrong one
    and confirm the SAME comparison mechanism catches it on effectively every
    steady-state bar -- proving this check discriminates a real formula bug,
    not merely a coincidentally-close number."""
    obs = _load(_CASES[fn_name])
    warmup = obs["_vendor_parity_warmup_bars"]

    if fn_name == "rsi":
        orig = ast_interpret.compute_rsi_raw
        ast_interpret.compute_rsi_raw = lambda closes, n=14: _cutler_rsi_col(closes, n)
        try:
            result = compare(obs, warmup_bars=warmup, tolerance_rel=1e-6)
        finally:
            ast_interpret.compute_rsi_raw = orig
        # unmutated must still verify -- proves the monkeypatch/restore left
        # nothing broken behind it.
        assert compare(obs, warmup_bars=warmup, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"
    else:
        orig = ast_interpret.compute_atr_raw
        ast_interpret.compute_atr_raw = lambda bars, n=14: _bad_atr_col(bars, n)
        try:
            result = compare(obs, warmup_bars=warmup, tolerance_rel=1e-6)
        finally:
            ast_interpret.compute_atr_raw = orig
        assert compare(obs, warmup_bars=warmup, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"

    assert result["verdict"] != "VENDOR-PARITY VERIFIED"
    assert result["disagreement_count"] == result["compared_non_warmup"] == 1148


@pytest.mark.parametrize("fn_name", sorted(_CASES.keys()))
@pytest.mark.parametrize("bad_token", ["uct-generated", "internal-generated", "self-generated", ""])
def test_a_non_vendor_provenance_is_refused_never_treated_as_truth(fn_name, bad_token):
    """The exact guard against the authorization's own named failure mode:
    'UCT output was accidentally substituted for vendor output'."""
    obs = _load(_CASES[fn_name])
    poisoned = json.loads(json.dumps(obs))
    poisoned["provenance"]["platform"] = bad_token
    with pytest.raises(VendorSourceRefused):
        compare(poisoned, warmup_bars=obs["_vendor_parity_warmup_bars"], tolerance_rel=1e-6)
