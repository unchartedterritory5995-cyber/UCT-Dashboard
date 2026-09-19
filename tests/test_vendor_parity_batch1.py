"""Vendor-Backed Unserved Builtins — Batch 1 — the permanent regression.

Proves, for `ta.falling` and the `ta.pvt` windowed-delta (`pvtN`), the full
required evidence chain:

    raw TradingView artifact -> semantic ruling -> UCT implementation
    -> JS/Python conformance -> exact vendor comparison -> parity observation

`ta.kcw` is covered differently: its formula needs a 20-bar EMA warm-up and
this batch's raw artifact holds only 15 real trading days (the CSV-download
mechanism prior tranches used was blocked in this environment — see the
observation's own provenance note), so a from-scratch re-execution of either
kernel over just 15 bars would be all-NaN and prove nothing. Its vendor-parity
claim instead rests on DIRECT ARITHMETIC over the observation's own recorded
values — `kcw_builtin` and `kcw_candRatio` were both plotted live inside the
SAME TradingView session, with TradingView's own full historical warm-up, so
their agreement IS the vendor-parity evidence. `test_vendor_parity_batch1.js`
side (`pine.batch1VendorBacked.test.js`) separately proves the FORMULA
translates to that exact candidate shape. `ta.cmf` and `ta.accdist` are not
implemented (see `closedTable.json`'s `_functions_excluded.accdist` and the
`ta.cmf`-is-not-real-Pine finding) and are not covered here as vendor-parity
claims for that reason — `pine.batch1VendorBacked.test.js` covers their
refusal messages as regression protection instead.
"""
import json
from pathlib import Path

import pytest

from tools import ast_conformance

ROOT = Path(__file__).resolve().parent.parent
OBS_DIR = ROOT / "tests" / "fixtures" / "vendor" / "observations"

_RE_EXECUTABLE_CASES = {
    # (fixture file, vendor column, this engine's own warm-up in bars, the
    # per-row comparison tolerance). `pvtN` is volume-weighted and the raw
    # capture's OHLCV was read off TradingView's Table View, which displays
    # volume rounded to "34.05M" (2 decimal places of millions) rather than
    # the exact share count TradingView's own internal computation used --
    # so a from-scratch re-execution using that ROUNDED volume necessarily
    # drifts from the real value by a small amount (measured: ~25 on a
    # ~530,000 delta, 0.005% relative). `falling` is a boolean comparison of
    # close alone and carries no such rounding, so its tolerance stays tight.
    "falling": ("ta-falling-close3-2026-09-06.json", "falling_real_builtin", 3, 1e-6),
    "pvtN": ("ta-pvt-delta5-2026-09-06.json", "pvt_change5", 5, None),
}


def _load(name: str) -> dict:
    return json.loads((OBS_DIR / name).read_text(encoding="utf-8"))


def _bars_for(obs: dict) -> list[dict]:
    """`market.bars`, coerced to the shape both kernels expect (`t` as an int,
    matching every other fixture in this repo)."""
    out = []
    for b in obs["market"]["bars"]:
        out.append({"t": int(b["t"]), "o": b["o"], "h": b["h"], "l": b["l"],
                    "c": b["c"], "v": b["v"]})
    return out


def _index_by_epoch(bars: list[dict]) -> dict:
    return {str(b["t"]): i for i, b in enumerate(bars)}


@pytest.mark.skipif(not ast_conformance.js_lane_available(), reason="JS lane unavailable")
@pytest.mark.parametrize("fn_name", sorted(_RE_EXECUTABLE_CASES.keys()))
def test_dual_kernel_conformance_js_vs_python(fn_name):
    """JS and Python agree on the real captured series — NOT vendor parity,
    the separate, already-standing 1e-9 cross-lane check."""
    fname, _col, _warmup, _tol = _RE_EXECUTABLE_CASES[fn_name]
    obs = _load(fname)
    ast = obs["engine"]["ast"]
    bars = _bars_for(obs)

    case = {"id": fn_name, "ast": ast}
    js_cols = ast_conformance.run_js([case], bars)
    py_cols = ast_conformance.run_py([case], bars)
    result = ast_conformance.compare_lanes(js_cols, py_cols)
    assert result["differences"] == [], (
        f"{fn_name}: JS and Python disagree — {result['differences']}"
    )
    assert result["compared"] == len(bars)


@pytest.mark.parametrize("fn_name", sorted(_RE_EXECUTABLE_CASES.keys()))
def test_vendor_parity_verified_against_real_capture(fn_name):
    """UCT's own interpreter (Python lane) matches the REAL TradingView values
    captured for this function, across every real trading day THIS ENGINE can
    compute from the 15-bar capture (a bar inside this engine's own warm-up
    window is skipped — the real TradingView builtin needed no warm-up because
    it had years of prior history, which this 15-bar re-execution does not)."""
    fname, col, warmup, tol = _RE_EXECUTABLE_CASES[fn_name]
    obs = _load(fname)
    ast = obs["engine"]["ast"]
    bars = _bars_for(obs)
    by_epoch = _index_by_epoch(bars)

    py_cols = ast_conformance.run_py([{"id": fn_name, "ast": ast}], bars)
    col_values = py_cols[fn_name]

    compared = 0
    skipped_warmup = 0
    for epoch, row in obs["vendor"]["values"].items():
        idx = by_epoch[epoch]
        if idx < warmup:
            skipped_warmup += 1
            continue
        got = col_values[idx]
        assert got is not None, (
            f"{fn_name}: bar {epoch} (index {idx}) is not-computable in this "
            "engine but the real vendor has a value there — a warm-up window "
            "wider than expected, or a genuine gap this test needs to know about"
        )
        approx = pytest.approx(row[col], abs=tol) if tol is not None else pytest.approx(row[col], rel=1e-3)
        assert got == approx, f"{fn_name}: bar {epoch} — engine {got} vs real vendor {row[col]}"
        compared += 1
    # NON-VACUITY: past warm-up, every real vendor row was actually compared,
    # and warm-up itself did not eat the whole fixture.
    assert compared == len(obs["vendor"]["values"]) - skipped_warmup
    assert compared >= 8
    assert skipped_warmup == warmup


def test_MUTATION_falling_running_minimum_disagrees_with_the_real_capture():
    """Non-vacuity control: the real vendor capture itself proves
    strict-monotone and running-minimum are DIFFERENT functions — they
    disagree at 2026-08-20 (epoch 1787184000). If they never disagreed
    anywhere in this fixture, `test_vendor_parity_verified_against_real_capture`
    could not tell the two readings apart and would be vacuous."""
    obs = _load("ta-falling-close3-2026-09-06.json")
    row = obs["vendor"]["values"]["1787184000"]
    assert row["falling_real_builtin"] == 0
    assert row["falling_real_candMonotone"] == 0
    assert row["falling_real_candRunningMin"] == 1
    # And the implementation this batch shipped chose the reading that
    # actually matches the real builtin at this discriminating row.
    bars = _bars_for(obs)
    ast = obs["engine"]["ast"]
    py_cols = ast_conformance.run_py([{"id": "falling", "ast": ast}], bars)
    idx = _index_by_epoch(bars)["1787184000"]
    assert py_cols["falling"][idx] == 0


def test_MUTATION_pvt_wrong_previous_close_disagrees():
    """Non-vacuity control: a plausible wrong candidate for `ta.pvt`'s
    recurrence (dividing by THIS bar's close instead of the PRIOR bar's — an
    easy off-by-one) must disagree with the real captured value somewhere in
    this fixture, or the vendor comparison above could not tell right from
    wrong."""
    obs = _load("ta-pvt-delta5-2026-09-06.json")
    bars = _bars_for(obs)

    correct = [0.0]
    wrong = [0.0]
    for i in range(1, len(bars)):
        prev_close = bars[i - 1]["c"]
        this_close = bars[i]["c"]
        v = float(bars[i]["v"])
        correct.append(correct[i - 1] + (((bars[i]["c"] - prev_close) / prev_close) * v
                                          if prev_close else 0.0))
        wrong.append(wrong[i - 1] + (((bars[i]["c"] - prev_close) / this_close) * v
                                     if this_close else 0.0))

    by_epoch = _index_by_epoch(bars)
    disagreements = 0
    for epoch, row in obs["vendor"]["values"].items():
        i = by_epoch[epoch]
        if i < 5:
            continue
        correct_delta = correct[i] - correct[i - 5]
        wrong_delta = wrong[i] - wrong[i - 5]
        # ⚠️ rel, not abs — see this file's module docstring / `_RE_EXECUTABLE_CASES`
        # comment on why a from-scratch re-execution with rounded display volume
        # drifts a small relative amount from the real vendor value.
        assert correct_delta == pytest.approx(row["pvt_change5"], rel=1e-3)
        if abs(wrong_delta - row["pvt_change5"]) > 1.0:
            disagreements += 1
    assert disagreements > 0, (
        "the wrong previous-close candidate never disagreed with the real "
        "vendor capture anywhere in this fixture — the mutation control is "
        "vacuous"
    )


def test_MUTATION_kcw_percent_form_disagrees_with_the_ratio_on_every_real_row():
    """Non-vacuity control, direct-arithmetic form (see this file's module
    docstring for why kcw cannot be re-executed from only 15 bars): the real
    vendor capture's own `kcw_candPercent` column (the plausible-but-wrong
    x100 convention) disagrees with the real `kcw_builtin` on every single
    real trading day this fixture holds, while `kcw_candRatio` (the formula
    this batch shipped) agrees exactly."""
    obs = _load("ta-kcw-close20-2-2026-09-06.json")
    values = obs["vendor"]["values"]
    assert len(values) >= 10
    for epoch, row in values.items():
        assert row["kcw_builtin"] == pytest.approx(row["kcw_candRatio"], abs=1e-4), (
            f"kcw: bar {epoch} — builtin {row['kcw_builtin']} vs the shipped "
            f"ratio candidate {row['kcw_candRatio']}"
        )
        assert abs(row["kcw_builtin"] - row["kcw_candPercent"]) > 1.0, (
            f"kcw: bar {epoch} — the percent candidate must visibly disagree "
            "with the real builtin, or this control proves nothing"
        )


def test_accdist_and_cmf_have_no_implementation_to_verify():
    """Documents the scope boundary this batch drew, rather than silently
    having no test for it: `ta.accdist` gets a vendor observation (the
    per-bar formula, for the ruling's own citation) but NO primitive, and
    `ta.cmf` gets no observation at all because it is not real Pine."""
    obs = _load("ta-accdist-delta5-2026-09-06.json")
    assert obs["engine"]["ast"] is None
    assert not (OBS_DIR / "ta-cmf-2026-09-06.json").exists()
