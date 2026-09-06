"""Mutation/non-vacuity tests for tools/vendor_parity_compare.py.

Per the Vendor Parity Tranche 2 authorization: "at least one deliberate
semantic perturbation must cause the parity check to fail for each major
comparison mechanism," and the tooling "must not pass merely because both
sides are reading the same derived values; UCT output was accidentally
substituted for vendor output; empty/null rows are skipped; tolerance is
excessively broad; only the easy steady-state bars are compared." Every one
of those five failure modes gets its own test below, not just the happy path.

Uses a small hand-computable `sma(close, 3)` fixture rather than the real
rsi/atr capture (not yet available) — this file proves the TOOL is correct
and mutation-sensitive independent of when the real TradingView capture
lands; the real capture plugs into the same `compare()` function unchanged.
"""
import math

import pytest

from tools.vendor_parity_compare import VendorSourceRefused, compare

# sma(close, 3): bar 2 = mean(10,20,30) = 20; bar 3 = mean(20,30,40) = 30;
# bar 4 = mean(30,40,50) = 40. Warm-up = 2 (bars 0, 1 have no valid sma(3)).
_SMA3_AST = {
    "type": "call", "name": "sma",
    "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 3}],
}
_BARS = [
    {"t": "0", "o": 10, "h": 10, "l": 10, "c": 10, "v": 0},
    {"t": "1", "o": 20, "h": 20, "l": 20, "c": 20, "v": 0},
    {"t": "2", "o": 30, "h": 30, "l": 30, "c": 30, "v": 0},
    {"t": "3", "o": 40, "h": 40, "l": 40, "c": 40, "v": 0},
    {"t": "4", "o": 50, "h": 50, "l": 50, "c": 50, "v": 0},
]
_TRUE_VENDOR_VALUES = {"2": 20.0, "3": 30.0, "4": 40.0}


def _observation(ast=_SMA3_AST, vendor_values=None, platform="TradingView", who="owner"):
    return {
        "engine": {"ast": ast},
        "market": {"bars": _BARS, "timeframe": "D"},
        "vendor": {"values": _TRUE_VENDOR_VALUES if vendor_values is None else vendor_values},
        "provenance": {"platform": platform, "who": who},
    }


# ─── the happy path, and it must be genuinely non-vacuous ─────────────────

def test_a_correct_observation_is_verified_and_actually_compares_something():
    result = compare(_observation(), warmup_bars=2)
    assert result["verdict"] == "VENDOR-PARITY VERIFIED"
    # ⛔ NON-VACUITY: a verdict of VERIFIED over zero actual comparisons would
    # be exactly the "passes merely because... only the easy steady-state
    # bars are compared" failure the authorization names — assert real work.
    assert result["compared_non_warmup"] == 3
    assert result["disagreement_count"] == 0


# ─── mutation 1: a real semantic perturbation must flip the verdict ───────

def test_MUTATION_a_different_period_disagrees_with_the_same_vendor_values():
    """sma(close, 2) at bar 2 is mean(20,30)=25, not 20 — a genuine formula
    difference, not a rounding wobble. This is the required "at least one
    deliberate semantic perturbation" proof for this comparison mechanism."""
    mutated_ast = {
        "type": "call", "name": "sma",
        "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 2}],
    }
    result = compare(_observation(ast=mutated_ast), warmup_bars=2)
    assert result["verdict"] in ("PARTIAL",), (
        "a genuinely different formula must NOT read as VERIFIED — the check "
        "would be vacuous if it could not fail")
    assert result["disagreement_count"] > 0


# ─── mutation 2: UCT output substituted for vendor output must be refused ─

@pytest.mark.parametrize("platform,who", [
    ("uct-self-check", "owner"),
    ("TradingView", "our-own capture script"),
    ("internal-synthetic-self", "owner"),
])
def test_MUTATION_uct_sourced_provenance_is_refused_not_silently_accepted(platform, who):
    with pytest.raises(VendorSourceRefused):
        compare(_observation(platform=platform, who=who), warmup_bars=2)


def test_MUTATION_blank_provenance_platform_is_refused():
    with pytest.raises(VendorSourceRefused):
        compare(_observation(platform=""), warmup_bars=2)


# ─── mutation 3: empty/null vendor rows are reported, never silently dropped

def test_MUTATION_a_missing_vendor_value_is_DATA_BLOCKED_not_skipped():
    partial_values = {"2": 20.0, "4": 40.0}  # bar 3's vendor value is missing
    result = compare(_observation(vendor_values=partial_values), warmup_bars=2)
    row3 = next(r for r in result["rows"] if r["t"] == "3")
    assert row3["status"] == "DATA_BLOCKED"
    assert result["any_data_blocked"] is True
    # ⛔ the row must still be PRESENT in the output — a dropped row would
    # silently shrink the denominator and could manufacture a false VERIFIED.
    assert len(result["rows"]) == len(_BARS)
    # The two bars that DO have vendor values still verify correctly.
    assert result["verdict"] == "VENDOR-PARITY VERIFIED"
    assert result["compared_non_warmup"] == 2


# ─── mutation 4: tolerance must not be excessively broad ──────────────────

def test_MUTATION_a_real_disagreement_is_not_hidden_by_default_tolerance():
    # bar 3 off by 1.0 on a value of 30 -- ~3.3% relative error, must NOT
    # pass under the tool's own tight default tolerance (1e-6 relative).
    wrong_values = {"2": 20.0, "3": 31.0, "4": 40.0}
    result = compare(_observation(vendor_values=wrong_values), warmup_bars=2)
    assert result["verdict"] == "PARTIAL"
    row3 = next(r for r in result["rows"] if r["t"] == "3")
    assert row3["status"] == "DISAGREE"


def test_an_excessively_broad_tolerance_would_hide_the_same_disagreement():
    """Not asserting this is GOOD — asserting the tool's tolerance PARAMETER
    genuinely does something, so a future caller who widens it can be held
    to the same standard this file holds the default to."""
    wrong_values = {"2": 20.0, "3": 31.0, "4": 40.0}
    result = compare(_observation(vendor_values=wrong_values), warmup_bars=2, tolerance_rel=0.5)
    assert result["verdict"] == "VENDOR-PARITY VERIFIED"  # proves tolerance is load-bearing


# ─── mutation 5: warm-up bars are reported but never gate the verdict ─────

def test_MUTATION_a_wildly_wrong_warmup_value_never_fails_the_verdict_but_IS_reported():
    # ⚠️ bar 0/1 genuinely have NO uct_value at all (sma(close,3)'s own
    # warm-up) -- those correctly report DATA_BLOCKED, not a delta, because
    # there is nothing to diff. To exercise "a warm-up bar WITH a real UCT
    # value that still must not gate the verdict," conservatively widen
    # `warmup_bars` to 3 so bar 2 (uct=20.0, a REAL computed value) is
    # treated as warm-up even though the function itself already answers
    # there -- exactly the kind of conservative warm-up boundary a real
    # vendor capture's caller might choose.
    values_with_bad_warmup = dict(_TRUE_VENDOR_VALUES)
    values_with_bad_warmup["2"] = 9999.0  # wildly wrong "vendor" value at bar 2
    result = compare(_observation(vendor_values=values_with_bad_warmup), warmup_bars=3)
    assert result["verdict"] == "VENDOR-PARITY VERIFIED"
    row2 = next(r for r in result["rows"] if r["t"] == "2")
    assert row2["is_warmup"] is True
    # ⛔ NOT silently dropped -- the wild delta is visible in the report even
    # though it correctly can't fail the verdict.
    assert row2["status"] == "WARMUP_DELTA"
    assert row2["abs_delta"] == pytest.approx(9979.0)


def test_missing_engine_ast_refuses_rather_than_fabricating_a_comparison():
    obs = _observation(ast=None)
    with pytest.raises(ValueError, match="engine.ast is null"):
        compare(obs, warmup_bars=2)
