"""Vendor Parity Tranche 2, Lane A -- sixth batch (ADX family) permanent
regression. Mirrors `test_vendor_parity_hma_macd.py`'s multi-output shape.
Full detail, decay tables, and the capture-safety trail (a second incident,
independent of the Stoch batch's own):
`VENDOR_PARITY_TRANCHE_2_LANE_A_ADX_REPORT.md`.

UCT's `computeADX`/`compute_adx_raw` shares the Wilder/RMA recursive-smoother
primitive already vendor-verified standalone for `rma`, applied to THREE
series (+DM, -DM, TR) plus a SECOND smoothing pass over DX for ADX itself --
so its own convergence boundary must be measured separately per output, not
assumed inherited from RMA's own (already-accepted) initialization evidence.

⭐⭐ CRITICAL, MEASURED (NOT ASSUMED) MATHEMATICAL PROPERTY THIS FILE DEPENDS
ON: `DX = 100*|+DI--DI|/(+DI+-DI)` is INVARIANT under any mutation that scales
BOTH +DI and -DI by the same per-bar factor -- because a common factor cancels
in that ratio. Three of the mutations below (directional-condition swap, wrong
TR, wrong DI denominator) are EXACTLY this shape, and each one correctly,
100%-confirmedly corrupts +DI/-DI while leaving ADX completely unaffected --
not a testing gap, a real property of the formula, reported honestly rather
than reported as "the mutation failed." Two OTHER mutations (DX missing its
abs(), a wrong ADX smoother) operate strictly downstream of +DI/-DI and
correctly isolate ADX alone, mirroring the MACD batch's own signal/line
isolation proof.

⛔ UCT'S OWN SCOPE LIMIT, ALREADY VERIFIED BY DIRECT TRANSLATION (no vendor
capture needed for this specific claim -- it is about translator behavior,
not real-runtime arithmetic): Pine's real `ta.dmi(diLength, adxSmoothing)`
allows those two lengths to differ; UCT's table uses ONE shared `period` for
both, and `pine.js`'s `dmiParts`/`dmiLeg` resolver REFUSES (`pine:tuple`) any
asymmetric pair rather than silently collapsing it -- already covered by
`pine.tupleBuiltins.test.js`/`pine.tuples.test.js`, not re-tested here.
"""
import json
from pathlib import Path

import pytest

from api.services import ast_interpret
from tools.vendor_parity_compare import VendorSourceRefused, compare

ROOT = Path(__file__).resolve().parent.parent
OBS_DIR = ROOT / "tests" / "fixtures" / "vendor" / "observations"

_CASES = {
    "plus_di": ("plus-di-14-2026-09-06.json", 170, 14),
    "minus_di": ("minus-di-14-2026-09-06.json", 170, 14),
    "adx": ("adx-14-2026-09-06.json", 220, 27),
}


def _load(name: str) -> dict:
    return json.loads((OBS_DIR / name).read_text(encoding="utf-8"))


def _raw_dm_tr(bars):
    """The per-bar +DM/-DM/TR arrays `compute_adx_raw` itself computes --
    factored out here only so the mutations below don't re-derive it
    differently by accident."""
    n = len(bars)
    plus_dm = [0.0] * n
    minus_dm = [0.0] * n
    tr = [0.0] * n
    for i in range(1, n):
        up = bars[i]["h"] - bars[i - 1]["h"]
        down = bars[i - 1]["l"] - bars[i]["l"]
        plus_dm[i] = up if (up > down and up > 0) else 0.0
        minus_dm[i] = down if (down > up and down > 0) else 0.0
        prev_c = bars[i - 1]["c"]
        tr[i] = max(bars[i]["h"] - bars[i]["l"],
                    abs(bars[i]["h"] - prev_c), abs(bars[i]["l"] - prev_c))
    return plus_dm, minus_dm, tr


def _wilder_di_adx(plus_dm, minus_dm, tr, period, denom_fn=None, dx_fn=None, adx_fn=None):
    """The SAME Wilder-recursion skeleton `compute_adx_raw` uses, with
    optional injection points for `denom_fn(s_plus,s_minus,s_tr)->denom`,
    `dx_fn(pdi,mdi)->dx`, and `adx_fn(dx_list,period)->adx_out` -- so each
    mutation below changes EXACTLY one step and nothing else."""
    n = len(plus_dm)
    denom_fn = denom_fn or (lambda sp, sm, st: st)
    dx_fn = dx_fn or (lambda pdi, mdi: (0.0 if (pdi + mdi) == 0 else 100.0 * abs(pdi - mdi) / (pdi + mdi)))
    s_plus = s_minus = s_tr = 0.0
    for i in range(1, period + 1):
        s_plus += plus_dm[i]; s_minus += minus_dm[i]; s_tr += tr[i]
    dx = [None] * n
    plus_di = [None] * n
    minus_di = [None] * n

    def push(idx):
        denom = denom_fn(s_plus, s_minus, s_tr)
        pdi = 0.0 if denom == 0 else 100.0 * s_plus / denom
        mdi = 0.0 if denom == 0 else 100.0 * s_minus / denom
        plus_di[idx] = pdi
        minus_di[idx] = mdi
        dx[idx] = dx_fn(pdi, mdi)

    push(period)
    for i in range(period + 1, n):
        s_plus = s_plus - s_plus / period + plus_dm[i]
        s_minus = s_minus - s_minus / period + minus_dm[i]
        s_tr = s_tr - s_tr / period + tr[i]
        push(i)

    if adx_fn:
        adx_out = adx_fn(dx, period)
    else:
        adx = 0.0
        for i in range(period, 2 * period):
            adx += dx[i]
        adx /= period
        adx_out = [None] * n
        adx_out[2 * period - 1] = adx
        for i in range(2 * period, n):
            adx = (adx * (period - 1) + dx[i]) / period
            adx_out[i] = adx
    return adx_out, plus_di, minus_di


def _compare_all(period=14):
    plus_obs = _load(_CASES["plus_di"][0])
    minus_obs = _load(_CASES["minus_di"][0])
    adx_obs = _load(_CASES["adx"][0])
    return (
        compare(plus_obs, warmup_bars=_CASES["plus_di"][1], tolerance_rel=1e-6),
        compare(minus_obs, warmup_bars=_CASES["minus_di"][1], tolerance_rel=1e-6),
        compare(adx_obs, warmup_bars=_CASES["adx"][1], tolerance_rel=1e-6),
    )


@pytest.mark.parametrize("fn_name", sorted(_CASES.keys()))
def test_vendor_parity_verified_against_real_multi_bar_capture(fn_name):
    obs_name, warmup, _true_warmup = _CASES[fn_name]
    obs = _load(obs_name)
    assert obs["_vendor_parity_warmup_bars"] == warmup

    result = compare(obs, warmup_bars=warmup, tolerance_rel=1e-6)

    assert result["verdict"] == "VENDOR-PARITY VERIFIED", (
        f"{fn_name}: expected VENDOR-PARITY VERIFIED, got {result['verdict']} "
        f"(disagreements={result['disagreement_count']})"
    )
    # ⛔ THIS CAPTURE IS ONLY 300 BARS (a disposable layout, not the ~2,031-bar
    # jHASRSzx window) AND ADX's OWN seed-convergence margin (220 bars) is
    # deep relative to that -- so its genuine steady-state comparison count is
    # thin (80 bars) compared to prior batches' hundreds-to-thousands.
    # Reported honestly rather than asserting a threshold this capture cannot
    # meet.
    min_compared = {"plus_di": 100, "minus_di": 100, "adx": 50}[fn_name]
    assert result["compared_non_warmup"] > min_compared


@pytest.mark.parametrize("fn_name", sorted(_CASES.keys()))
def test_the_true_period_warmup_bars_are_reported_not_silently_dropped(fn_name):
    obs_name, warmup, true_warmup = _CASES[fn_name]
    obs = _load(obs_name)
    result = compare(obs, warmup_bars=true_warmup, tolerance_rel=1e-6)

    assert len(result["rows"]) == len(obs["market"]["bars"]) == 300
    blocked = [r for r in result["rows"] if r["status"] == "DATA_BLOCKED"]
    assert len(blocked) == true_warmup
    assert result["any_data_blocked"] is True
    assert all(r["index"] < true_warmup for r in blocked)


def test_MUTATION_directional_condition_swap_flips_di_and_is_STRUCTURALLY_VACUOUS_for_adx():
    """⭐⭐ THE DIRECTIONAL-SWAP + ROLE-SWAP PROOF, IN ONE MUTATION. Swapping
    which raw condition feeds +DM vs -DM is MATHEMATICALLY IDENTICAL to
    swapping the +DI/-DI OUTPUT TUPLE ORDER after correct computation --
    verified directly below, not merely asserted: the mutated "+DI" column
    equals the ORIGINAL correct -DI column bar-for-bar. Both the
    "directional-condition swap" and "swapped +DI/-DI roles" items on the
    authorization's mutation list reduce to this one test.

    ⛔⛔ ADX IS **STRUCTURALLY, PROVABLY VACUOUS** UNDER THIS MUTATION --
    reported as such, not pretended to pass by coincidence. `DX = 100*
    |+DI--DI|/(+DI+-DI)` is symmetric in +DI and -DI: swapping which is which
    changes neither `|+DI--DI|` nor `+DI+-DI`. ADX (a pure smoothing of DX)
    is therefore mathematically UNABLE to detect this specific bug class --
    a genuine, honestly-disclosed boundary of what ADX itself can ever prove,
    not a gap in this test."""
    plus_obs = _load(_CASES["plus_di"][0])
    minus_obs = _load(_CASES["minus_di"][0])
    adx_obs = _load(_CASES["adx"][0])

    def swapped(bars, period):
        plus_dm, minus_dm, tr = _raw_dm_tr(bars)
        # SWAPPED: the condition that computed +DM now feeds -DM and vice versa.
        return _wilder_di_adx(minus_dm, plus_dm, tr, period)

    orig = ast_interpret.compute_adx_raw
    ast_interpret.compute_adx_raw = swapped
    try:
        r_plus = compare(plus_obs, warmup_bars=170, tolerance_rel=1e-6)
        r_minus = compare(minus_obs, warmup_bars=170, tolerance_rel=1e-6)
        r_adx = compare(adx_obs, warmup_bars=220, tolerance_rel=1e-6)

        # ⭐ THE MECHANISTIC PROOF: mutated "+DI" now equals the REAL VENDOR's
        # own -DI values (not merely "disagrees with its own paired vendor").
        bars = plus_obs["market"]["bars"]
        _adx_out, mutated_plus, mutated_minus = swapped(bars, 14)
        minus_vendor = minus_obs["vendor"]["values"]
        checked = 0
        matched = 0
        for i, b in enumerate(bars):
            if i < 170:
                continue
            v = minus_vendor.get(b["t"])
            if v is None:
                continue
            checked += 1
            if abs(mutated_plus[i] - v) < 1e-3:
                matched += 1
        assert checked > 50
        assert matched == checked, (
            f"mutated +DI matched the real vendor's -DI on only {matched}/{checked} "
            "bars -- expected all of them if the swap is the exact mechanism claimed"
        )
    finally:
        ast_interpret.compute_adx_raw = orig

    control_plus = compare(plus_obs, warmup_bars=170, tolerance_rel=1e-6)
    assert control_plus["verdict"] == "VENDOR-PARITY VERIFIED"

    assert r_plus["verdict"] != "VENDOR-PARITY VERIFIED"
    assert r_plus["disagreement_count"] == r_plus["compared_non_warmup"]
    assert r_minus["verdict"] != "VENDOR-PARITY VERIFIED"
    assert r_minus["disagreement_count"] == r_minus["compared_non_warmup"]
    # ⛔⛔ THE VACUOUS-BY-CONSTRUCTION ASSERTION, KEPT AND STATED ON PURPOSE.
    assert r_adx["verdict"] == "VENDOR-PARITY VERIFIED", (
        "ADX was expected to be UNAFFECTED by a +DM/-DM directional swap -- "
        "DX's own formula is symmetric in +DI/-DI. If this ever starts "
        "failing, the formula's symmetry assumption itself needs "
        "re-examination before assuming this is a regression."
    )


def test_MUTATION_wrong_wilder_alpha_disagrees_on_all_three_outputs():
    """EMA-style alpha (2/(period+1)) instead of Wilder's true 1/period,
    applied to ALL THREE smoothed series (+DM, -DM, TR). Unlike the
    scale-only mutations below, changing the smoothing TIME-CONSTANT does
    NOT preserve a common per-bar scale factor between +DI and -DI (each
    series' own history-weighted profile differs), so this one is NOT
    vacuous for ADX -- confirmed directly, not assumed by analogy to RMA's
    own wrong-alpha finding."""
    plus_obs = _load(_CASES["plus_di"][0])
    minus_obs = _load(_CASES["minus_di"][0])
    adx_obs = _load(_CASES["adx"][0])

    def wrong_alpha(bars, period):
        plus_dm, minus_dm, tr = _raw_dm_tr(bars)
        n = len(bars)
        alpha = 2.0 / (period + 1)
        s_plus = s_minus = s_tr = 0.0
        for i in range(1, period + 1):
            s_plus += plus_dm[i]; s_minus += minus_dm[i]; s_tr += tr[i]
        dx = [None] * n
        plus_di = [None] * n
        minus_di = [None] * n

        def push(idx):
            pdi = 0.0 if s_tr == 0 else 100.0 * s_plus / s_tr
            mdi = 0.0 if s_tr == 0 else 100.0 * s_minus / s_tr
            plus_di[idx] = pdi; minus_di[idx] = mdi
            tot = pdi + mdi
            dx[idx] = 0.0 if tot == 0 else 100.0 * abs(pdi - mdi) / tot

        push(period)
        for i in range(period + 1, n):
            # WRONG: EMA-style blend instead of Wilder's k=1/period recursion.
            s_plus = s_plus * (1 - alpha) + plus_dm[i] * alpha * period
            s_minus = s_minus * (1 - alpha) + minus_dm[i] * alpha * period
            s_tr = s_tr * (1 - alpha) + tr[i] * alpha * period
            push(i)
        adx = 0.0
        for i in range(period, 2 * period):
            adx += dx[i]
        adx /= period
        adx_out = [None] * n
        adx_out[2 * period - 1] = adx
        for i in range(2 * period, n):
            adx = (adx * (period - 1) + dx[i]) / period
            adx_out[i] = adx
        return adx_out, plus_di, minus_di

    orig = ast_interpret.compute_adx_raw
    ast_interpret.compute_adx_raw = wrong_alpha
    try:
        r_plus = compare(plus_obs, warmup_bars=170, tolerance_rel=1e-6)
        r_minus = compare(minus_obs, warmup_bars=170, tolerance_rel=1e-6)
        r_adx = compare(adx_obs, warmup_bars=220, tolerance_rel=1e-6)
    finally:
        ast_interpret.compute_adx_raw = orig
    assert compare(plus_obs, warmup_bars=170, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"

    for r in (r_plus, r_minus, r_adx):
        assert r["verdict"] != "VENDOR-PARITY VERIFIED"
        assert r["disagreement_count"] == r["compared_non_warmup"]


def test_MUTATION_wrong_tr_normalization_disagrees_on_di_and_is_VACUOUS_for_adx_by_construction():
    """TR = high-low only, ignoring the prior-close gap terms. Both +DI and
    -DI divide by the SAME (now wrong) smoothed TR, so -- exactly like the
    directional-swap mutation above -- DX's own ratio is scale-invariant to
    a common-denominator change and ADX is untouched. Reported precisely as
    vacuous-for-ADX-by-construction, not silently omitted."""
    plus_obs = _load(_CASES["plus_di"][0])
    minus_obs = _load(_CASES["minus_di"][0])
    adx_obs = _load(_CASES["adx"][0])

    def wrong_tr(bars, period):
        plus_dm, minus_dm, _tr = _raw_dm_tr(bars)
        n = len(bars)
        tr = [0.0] * n
        for i in range(1, n):
            tr[i] = bars[i]["h"] - bars[i]["l"]  # WRONG: no gap terms
        return _wilder_di_adx(plus_dm, minus_dm, tr, period)

    orig = ast_interpret.compute_adx_raw
    ast_interpret.compute_adx_raw = wrong_tr
    try:
        r_plus = compare(plus_obs, warmup_bars=170, tolerance_rel=1e-6)
        r_minus = compare(minus_obs, warmup_bars=170, tolerance_rel=1e-6)
        r_adx = compare(adx_obs, warmup_bars=220, tolerance_rel=1e-6)
    finally:
        ast_interpret.compute_adx_raw = orig
    assert compare(plus_obs, warmup_bars=170, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"

    assert r_plus["verdict"] != "VENDOR-PARITY VERIFIED"
    assert r_plus["disagreement_count"] == r_plus["compared_non_warmup"]
    assert r_minus["verdict"] != "VENDOR-PARITY VERIFIED"
    assert r_minus["disagreement_count"] == r_minus["compared_non_warmup"]
    assert r_adx["verdict"] == "VENDOR-PARITY VERIFIED", (
        "ADX was expected to be UNAFFECTED by a common-TR-denominator error -- "
        "a per-bar scale factor shared by +DI and -DI cancels in DX's ratio."
    )


def test_MUTATION_wrong_di_denominator_disagrees_on_di_and_is_VACUOUS_for_adx_by_construction():
    """Denominator = smoothed(+DM)+smoothed(-DM) instead of smoothed(TR).
    Same structural shape as the TR mutation above -- a denominator shared by
    both +DI and -DI -- so DX/ADX are again mathematically unaffected."""
    plus_obs = _load(_CASES["plus_di"][0])
    minus_obs = _load(_CASES["minus_di"][0])
    adx_obs = _load(_CASES["adx"][0])

    def wrong_denom(bars, period):
        plus_dm, minus_dm, tr = _raw_dm_tr(bars)
        return _wilder_di_adx(plus_dm, minus_dm, tr, period,
                               denom_fn=lambda sp, sm, st: sp + sm)

    orig = ast_interpret.compute_adx_raw
    ast_interpret.compute_adx_raw = wrong_denom
    try:
        r_plus = compare(plus_obs, warmup_bars=170, tolerance_rel=1e-6)
        r_minus = compare(minus_obs, warmup_bars=170, tolerance_rel=1e-6)
        r_adx = compare(adx_obs, warmup_bars=220, tolerance_rel=1e-6)
    finally:
        ast_interpret.compute_adx_raw = orig
    assert compare(plus_obs, warmup_bars=170, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"

    assert r_plus["verdict"] != "VENDOR-PARITY VERIFIED"
    assert r_plus["disagreement_count"] == r_plus["compared_non_warmup"]
    assert r_minus["verdict"] != "VENDOR-PARITY VERIFIED"
    assert r_minus["disagreement_count"] == r_minus["compared_non_warmup"]
    assert r_adx["verdict"] == "VENDOR-PARITY VERIFIED", (
        "ADX was expected to be UNAFFECTED -- a denominator shared by +DI "
        "and -DI cancels in DX's own ratio, same reasoning as the TR mutation."
    )


def test_MUTATION_dx_missing_abs_isolates_adx_di_unaffected():
    """⭐⭐ THE FIRST ISOLATION PROOF (DX's own sign handling). Dropping the
    `abs()` in DX (`100*(pdi-mdi)/(pdi+mdi)`, allowed to go negative) touches
    ONLY the DX/ADX computation -- +DI and -DI themselves are computed
    identically. Mirrors the HMA/MACD batch's own architectural-isolation
    finding: mutating a downstream stage cannot corrupt an upstream one."""
    plus_obs = _load(_CASES["plus_di"][0])
    minus_obs = _load(_CASES["minus_di"][0])
    adx_obs = _load(_CASES["adx"][0])

    def dx_no_abs(bars, period):
        plus_dm, minus_dm, tr = _raw_dm_tr(bars)
        return _wilder_di_adx(
            plus_dm, minus_dm, tr, period,
            dx_fn=lambda pdi, mdi: (0.0 if (pdi + mdi) == 0 else 100.0 * (pdi - mdi) / (pdi + mdi)),
        )

    orig = ast_interpret.compute_adx_raw
    ast_interpret.compute_adx_raw = dx_no_abs
    try:
        r_plus = compare(plus_obs, warmup_bars=170, tolerance_rel=1e-6)
        r_minus = compare(minus_obs, warmup_bars=170, tolerance_rel=1e-6)
        r_adx = compare(adx_obs, warmup_bars=220, tolerance_rel=1e-6)
    finally:
        ast_interpret.compute_adx_raw = orig
    assert compare(adx_obs, warmup_bars=220, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"

    # ⭐ THE ISOLATION: +DI/-DI stay VERIFIED, completely unaffected.
    assert r_plus["verdict"] == "VENDOR-PARITY VERIFIED"
    assert r_minus["verdict"] == "VENDOR-PARITY VERIFIED"
    assert r_adx["verdict"] != "VENDOR-PARITY VERIFIED"
    assert r_adx["disagreement_count"] == r_adx["compared_non_warmup"]


def test_MUTATION_wrong_adx_smoother_isolates_adx_di_unaffected():
    """⭐⭐ THE SECOND ISOLATION PROOF (ADX's own smoothing method). A simple
    rolling MEAN of DX over `period` instead of Wilder's recursive smoothing
    -- again touches ONLY the ADX output; +DI/-DI are computed identically
    since they never depend on how ADX itself smooths DX."""
    plus_obs = _load(_CASES["plus_di"][0])
    minus_obs = _load(_CASES["minus_di"][0])
    adx_obs = _load(_CASES["adx"][0])

    def wrong_adx_smoother(bars, period):
        plus_dm, minus_dm, tr = _raw_dm_tr(bars)
        n = len(bars)

        def sma_adx(dx, period):
            adx_out = [None] * n
            for i in range(2 * period - 1, n):
                window = [dx[j] for j in range(i - period + 1, i + 1) if dx[j] is not None]
                adx_out[i] = sum(window) / len(window) if window else None
            return adx_out

        return _wilder_di_adx(plus_dm, minus_dm, tr, period, adx_fn=sma_adx)

    orig = ast_interpret.compute_adx_raw
    ast_interpret.compute_adx_raw = wrong_adx_smoother
    try:
        r_plus = compare(plus_obs, warmup_bars=170, tolerance_rel=1e-6)
        r_minus = compare(minus_obs, warmup_bars=170, tolerance_rel=1e-6)
        r_adx = compare(adx_obs, warmup_bars=220, tolerance_rel=1e-6)
    finally:
        ast_interpret.compute_adx_raw = orig
    assert compare(adx_obs, warmup_bars=220, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"

    assert r_plus["verdict"] == "VENDOR-PARITY VERIFIED"
    assert r_minus["verdict"] == "VENDOR-PARITY VERIFIED"
    assert r_adx["verdict"] != "VENDOR-PARITY VERIFIED"
    assert r_adx["disagreement_count"] == r_adx["compared_non_warmup"]


def test_zero_and_flat_market_boundaries_in_the_real_capture():
    """⛔ HONEST BOUNDARY DISCLOSURE, MEASURED DIRECTLY.

    - TR == 0 (a bar whose high/low/prior-close all coincide): NEVER occurs
      (0 of 299 real bars) -- the same finding already made for stoch's own
      zero-range case; a liquid ETF's true range essentially never hits
      exactly zero.
    - The SMOOTHED DX denominator (+DI+-DI == 0): NEVER occurs across the
      real vendor's own 286 recorded +DI/-DI pairs -- genuinely untestable
      against real data, exactly like stoch's zero-range fallback.
    - A RAW per-bar flat/no-direction bar (+DM==0 AND -DM==0 BEFORE Wilder
      smoothing, i.e. neither high nor low moved decisively) DOES occur --
      26 of 299 real bars. This narrower boundary IS exercised by real data,
      and is implicitly covered by the overall VENDOR-PARITY VERIFIED result
      (a wrong contribution on any of these 26 bars would have shown up as a
      steady-state disagreement) -- but is not separately isolated by its
      own dedicated mutation in this file."""
    plus_obs = _load(_CASES["plus_di"][0])
    minus_obs = _load(_CASES["minus_di"][0])
    bars = plus_obs["market"]["bars"]

    tr_zero = 0
    flat_bar = 0
    for i in range(1, len(bars)):
        tr = max(bars[i]["h"] - bars[i]["l"], abs(bars[i]["h"] - bars[i - 1]["c"]),
                  abs(bars[i]["l"] - bars[i - 1]["c"]))
        if tr == 0:
            tr_zero += 1
        up = bars[i]["h"] - bars[i - 1]["h"]
        down = bars[i - 1]["l"] - bars[i]["l"]
        pdm = up if (up > down and up > 0) else 0.0
        mdm = down if (down > up and down > 0) else 0.0
        if pdm == 0.0 and mdm == 0.0:
            flat_bar += 1

    assert tr_zero == 0
    assert flat_bar == 26

    plus_vendor = plus_obs["vendor"]["values"]
    minus_vendor = minus_obs["vendor"]["values"]
    zero_sum = sum(
        1 for t, pv in plus_vendor.items()
        if t in minus_vendor and (pv + minus_vendor[t]) == 0
    )
    assert zero_sum == 0


@pytest.mark.parametrize("fn_name", sorted(_CASES.keys()))
@pytest.mark.parametrize("bad_token", ["uct-generated", "internal-generated", "self-generated", ""])
def test_a_non_vendor_provenance_is_refused_never_treated_as_truth(fn_name, bad_token):
    obs_name, warmup, _true_warmup = _CASES[fn_name]
    obs = _load(obs_name)
    poisoned = json.loads(json.dumps(obs))
    poisoned["provenance"]["platform"] = bad_token
    with pytest.raises(VendorSourceRefused):
        compare(poisoned, warmup_bars=warmup, tolerance_rel=1e-6)
