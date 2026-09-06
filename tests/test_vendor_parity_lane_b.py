"""Vendor Parity Tranche 2, Lane B — the permanent regression.

Proves, for each of the four authorized functions (``ta.rising``,
``ta.median`` even-length, ``ta.percentrank``, ``ta.bbw``), the full required
evidence chain still holds:

    raw TradingView artifact -> semantic ruling -> UCT implementation
    -> JS/Python conformance -> exact vendor comparison -> parity observation

Dual-kernel conformance (JS vs Python) is a DIFFERENT claim from vendor parity
(UCT vs the real TradingView runtime) and both are asserted here, separately,
so neither can be mistaken for the other — the exact distinction this
tranche's own authorization insists on ("JS/Python conformance != vendor
parity").
"""
import json
import math
from pathlib import Path

import pytest

from tools import ast_conformance
from tools.vendor_parity_compare import compare

ROOT = Path(__file__).resolve().parent.parent
OBS_DIR = ROOT / "tests" / "fixtures" / "vendor" / "observations"

_CASES = {
    "rising": ("ta-rising-oracle-ambiguity-v3-1-2026-09-05.json", 0.0),
    "median": ("ta-median_even_length-oracle-ambiguity-v3-1-2026-09-05.json", 4.0),
    "percentrank": ("ta-percentrank-oracle-ambiguity-v3-1-2026-09-05.json", 75.0),
    "bbw": ("ta-bbw-oracle-ambiguity-v3-1-2026-09-05.json", 190.83671985126196),
}


def _load(name: str) -> dict:
    return json.loads((OBS_DIR / name).read_text(encoding="utf-8"))


@pytest.mark.skipif(not ast_conformance.js_lane_available(), reason="JS lane unavailable")
@pytest.mark.parametrize("fn_name", sorted(_CASES.keys()))
def test_dual_kernel_conformance_js_vs_python(fn_name):
    """JS and Python agree on the real captured series — NOT vendor parity,
    the separate, already-standing 1e-9 cross-lane check."""
    fname, _expected = _CASES[fn_name]
    obs = _load(fname)
    ast = obs["engine"]["ast"]
    bars = obs["market"]["bars"]

    case = {"id": fn_name, "ast": ast}
    js_cols = ast_conformance.run_js([case], bars)
    py_cols = ast_conformance.run_py([case], bars)
    result = ast_conformance.compare_lanes(js_cols, py_cols)
    assert result["differences"] == [], (
        f"{fn_name}: JS and Python disagree — {result['differences']}"
    )
    # ⛔ NON-VACUITY: the comparison actually walked real bars, not zero of them.
    assert result["compared"] == len(bars)


@pytest.mark.parametrize("fn_name", sorted(_CASES.keys()))
def test_vendor_parity_verified_against_real_capture(fn_name):
    """UCT's own interpreter (Python lane) matches the REAL TradingView value
    captured for this function — the vendor-parity claim itself, independent
    of dual-kernel agreement."""
    fname, expected = _CASES[fn_name]
    obs = _load(fname)
    warmup = obs["_vendor_parity_warmup_bars"]

    result = compare(obs, warmup_bars=warmup)

    assert result["verdict"] == "VENDOR-PARITY VERIFIED", (
        f"{fn_name}: expected VENDOR-PARITY VERIFIED, got {result['verdict']} "
        f"(disagreements={result['disagreement_count']}, rows={result['rows']})"
    )
    # ⛔ NON-VACUITY: the probed bar was actually compared, not silently
    # excluded as warm-up or data-blocked.
    assert result["compared_non_warmup"] == 1

    probed_row = next(r for r in result["rows"] if r.get("vendor_value") is not None)
    assert probed_row["uct_value"] == pytest.approx(expected, abs=1e-6)


@pytest.mark.parametrize("fn_name", sorted(_CASES.keys()))
def test_MUTATION_a_wrong_period_would_fail_this_same_check(fn_name):
    """Non-vacuity control: prove this regression can actually fail. A
    deliberately wrong period must disagree with the real captured value —
    otherwise this file would pass no matter what the implementation did."""
    fname, expected = _CASES[fn_name]
    obs = _load(fname)
    warmup = obs["_vendor_parity_warmup_bars"]

    mutated = json.loads(json.dumps(obs))  # deep copy
    ast = mutated["engine"]["ast"]
    # Force the period/length argument (always the second AST arg, a `num`
    # node) down to 1. ⚠️ NOT an arbitrary offset like `+7`: for a BOOLEAN
    # function (`rising`), a longer window can coincidentally land on the
    # SAME 0/1 answer the real vendor value happens to be (measured: `+7`
    # left `rising` silently unchanged here, which would have made this
    # control vacuous for exactly the case it most needs to catch). Period 1
    # verifiably flips all four: rising(1) reduces to a single `>` step
    # (true here, where length=3's answer is false); median/percentrank/bbw
    # of a 1-bar window degenerate to a different, non-matching value.
    period_node = ast["args"][1]
    assert period_node["type"] == "num"
    period_node["value"] = 1

    result = compare(mutated, warmup_bars=warmup)
    assert result["verdict"] != "VENDOR-PARITY VERIFIED", (
        f"{fn_name}: a wrong period must not still verify against the real "
        f"captured value — the check would be vacuous"
    )
