"""Vendor Parity Tranche 2, Lane A -- fifth batch (Stoch) permanent regression.
Mirrors `test_vendor_parity_rma_wma.py`'s shape. Full detail, decay curve (none
needed -- Stoch is memoryless), and the safety-incident trail:
`VENDOR_PARITY_TRANCHE_2_LANE_A_STOCH_REPORT.md`.

Stoch's %K (`computeStochastic`/`compute_stoch_raw`) is a rolling max/min over
the trailing `kPeriod` bars plus one arithmetic step -- NO recursive or leaky
state carried between bars. Like sma/wma/hma it is structurally incapable of a
capture-window seed-convergence lag, and this is now verified empirically for
Stoch too, not merely assumed by analogy: EVERY bar from the true 13-bar
structural period-warmup boundary onward agrees with the real vendor
immediately (max abs delta 1.4e-14, pure float noise).

⭐⭐ THIS OBSERVATION IS THE FIRST REAL-VENDOR CONFIRMATION OF THE ROLE-ORDER
PERMUTATION `pine.js::PINE_CALL_SHAPES.stoch` applies to translate Pine's
`ta.stoch(source, high, low, length)` onto this table's `stoch(h, l, c, n)`.
That permutation was previously checked only against a hand-coded
re-implementation of Pine's *published* formula (`pine.roles.test.js`) -- a
self-consistency check, not real vendor evidence. This file's
`test_MUTATION_wrong_role_order_...` runs the WRONG (verbatim) argument order
against the SAME real captured vendor values and confirms it disagrees on
every steady-state bar, closing that gap.

⛔ ZERO-RANGE (`highestHigh == lowestLow`) IS GENUINELY UNTESTABLE AGAINST THIS
REAL CAPTURE -- a liquid ETF's 14-day high-low range is never exactly zero
(confirmed: 0 of 287 real rolling windows in this capture have zero range).
`test_zero_range_fallback_is_internally_consistent_NOT_vendor_verified` is a
SYNTHETIC, clearly-labelled control proving UCT's own `range == 0 -> 50`
convention is deterministic and internally consistent -- it does NOT claim
TradingView's real behavior for this case, which remains UNVERIFIED. Do not
read that test as vendor evidence.

⛔ THIS CAPTURE IS ONLY 300 REAL BARS (2025-06-27..2026-09-04), not the
~2,031-bar window prior Lane A batches used -- taken on a deliberately fresh,
disposable TradingView layout (`qAHjBkf4`) rather than the program's usual
`jHASRSzx` chart, per an owner-authorized safety procedure after an
unexplained (and ultimately unattributed-to-any-Claude-session) chart-state
anomaly on `jHASRSzx` during the first capture attempt. `jHASRSzx` itself was
never modified. See the report's own Appendix A for the full incident trail.
Fewer bars, but every one real; 286 genuine steady-state comparisons is still
comfortably enough to be non-vacuous (`compared_non_warmup > 200`, not the
`> 1000` bar prior larger-window batches could assert).
"""
import copy
import json
from pathlib import Path

import pytest

from api.services import ast_interpret
from tools.vendor_parity_compare import VendorSourceRefused, compare

ROOT = Path(__file__).resolve().parent.parent
OBS_DIR = ROOT / "tests" / "fixtures" / "vendor" / "observations"

_OBS_NAME = "stoch-k-14-2026-09-06.json"


def _load() -> dict:
    return json.loads((OBS_DIR / _OBS_NAME).read_text(encoding="utf-8"))


def _ast_with_args(*names_or_nums):
    """A `stoch(...)` call AST with the given positional args -- each entry is
    either a bare series name (str) or a numeric literal (int/float)."""
    args = []
    for a in names_or_nums:
        if isinstance(a, str):
            args.append({"type": "series", "name": a})
        else:
            args.append({"type": "num", "value": a})
    return {"type": "call", "name": "stoch", "args": args}


def test_vendor_parity_verified_against_real_multi_bar_capture():
    obs = _load()
    warmup = obs["_vendor_parity_warmup_bars"]
    assert warmup == 13

    result = compare(obs, warmup_bars=warmup, tolerance_rel=1e-6)

    assert result["verdict"] == "VENDOR-PARITY VERIFIED", (
        f"expected VENDOR-PARITY VERIFIED, got {result['verdict']} "
        f"(disagreements={result['disagreement_count']})"
    )
    # ⛔ 287, not >1000 -- this capture is deliberately smaller (a fresh,
    # disposable layout; see the module docstring). Still comfortably
    # non-vacuous.
    assert result["compared_non_warmup"] > 200
    assert result["max_abs_delta_non_warmup"] < 1e-9


def test_stoch_has_zero_seed_convergence_lag_the_naive_period_warmup_suffices():
    """Like sma/wma/hma: EVERY bar from the true 13-bar period-warmup boundary
    onward already agrees -- no additional margin needed. Stoch's %K reads
    only the trailing 14 bars' high/low/close (a 14-period window is fully
    computable starting at 0-indexed bar 13, i.e. after 13 bars of insufficient
    history), never a running/recursive state, so there is no cold-start seed
    to converge from."""
    obs = _load()
    result = compare(obs, warmup_bars=13, tolerance_rel=1e-6)
    assert result["verdict"] == "VENDOR-PARITY VERIFIED"
    assert result["max_abs_delta_non_warmup"] < 1e-9


def test_the_true_period_warmup_bars_are_reported_not_silently_dropped():
    obs = _load()
    result = compare(obs, warmup_bars=13, tolerance_rel=1e-6)

    assert len(result["rows"]) == len(obs["market"]["bars"]) == 300
    blocked = [r for r in result["rows"] if r["status"] == "DATA_BLOCKED"]
    assert len(blocked) == 13
    assert result["any_data_blocked"] is True
    # ⛔ EVERY blocked row is a TRUE warmup row (index < 13), never a steady
    # -state gap silently miscounted as warmup.
    assert all(r["index"] < 13 for r in blocked)


def test_MUTATION_wrong_role_order_high_low_close_disagrees_on_real_vendor_data():
    """⭐⭐ THE REAL-VENDOR ROLE-ORDER PROOF. `pine.js::PINE_CALL_SHAPES.stoch`
    permutes Pine's `ta.stoch(source, high, low, length)` onto this table's
    `stoch(high, low, close, length)` -- verified correct ONLY against a
    hand-coded reference formula until this test. Running the WRONG, verbatim
    (unpermuted) argument order `stoch(close, high, low, 14)` -- i.e. feeding
    the real close where the table expects high, the real high where it
    expects low, the real low where it expects close -- against the SAME real
    captured vendor values must disagree on (nearly) every steady-state bar."""
    obs = _load()
    verbatim = copy.deepcopy(obs)
    verbatim["engine"]["ast"] = _ast_with_args("close", "high", "low", 14)

    control = compare(obs, warmup_bars=13, tolerance_rel=1e-6)
    assert control["verdict"] == "VENDOR-PARITY VERIFIED"

    result = compare(verbatim, warmup_bars=13, tolerance_rel=1e-6)
    assert result["verdict"] != "VENDOR-PARITY VERIFIED"
    assert result["disagreement_count"] >= result["compared_non_warmup"] - 5


def test_MUTATION_wrong_window_length_disagrees_on_real_vendor_data():
    """A `stoch(high, low, close, 10)` computed by UCT must NOT match a real
    vendor `ta.stoch(close, high, low, 14)` capture -- a different rolling
    window over real, non-monotone market data produces a different number on
    a material majority of bars.

    ⛔ NOT near-100%, measured: 171/287 (~60%) disagree, not the ~100% a full
    role-order or denominator/numerator swap produces (asserted separately
    below). %K frequently SATURATES at 0 or 100 during a strong local
    trend regardless of the exact window length, so two different window
    lengths can legitimately coincide on a meaningful minority of real bars.
    The real proof is the material majority, not every single bar -- stating
    ~100% here would be an overclaim this real capture does not support."""
    obs = _load()
    wrong_n = copy.deepcopy(obs)
    wrong_n["engine"]["ast"] = _ast_with_args("high", "low", "close", 10)

    result = compare(wrong_n, warmup_bars=13, tolerance_rel=1e-6)
    assert result["verdict"] != "VENDOR-PARITY VERIFIED"
    assert result["disagreement_count"] >= result["compared_non_warmup"] * 0.5


def test_MUTATION_wrong_denominator_disagrees_on_real_vendor_data():
    """Denominator = highestHigh alone, instead of the true range
    (highestHigh - lowestLow)."""
    obs = _load()

    def _wrong_denominator(bars, k_period, d_period):
        n = len(bars)
        k_out = [None] * n
        d_out = [None] * n
        for i in range(k_period - 1, n):
            ll = min(b["l"] for b in bars[i - k_period + 1: i + 1])
            hh = max(b["h"] for b in bars[i - k_period + 1: i + 1])
            k_out[i] = (bars[i]["c"] - ll) / hh * 100.0 if hh else 50.0
        return k_out, d_out

    orig = ast_interpret.compute_stoch_raw
    ast_interpret.compute_stoch_raw = _wrong_denominator
    try:
        result = compare(obs, warmup_bars=13, tolerance_rel=1e-6)
    finally:
        ast_interpret.compute_stoch_raw = orig
    assert compare(obs, warmup_bars=13, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"

    assert result["verdict"] != "VENDOR-PARITY VERIFIED"
    assert result["disagreement_count"] >= result["compared_non_warmup"] - 5


def test_MUTATION_inverted_numerator_disagrees_on_real_vendor_data():
    """Numerator inverted to (highestHigh - close) instead of
    (close - lowestLow) -- the Williams %R shape, not %K's."""
    obs = _load()

    def _inverted_numerator(bars, k_period, d_period):
        n = len(bars)
        k_out = [None] * n
        d_out = [None] * n
        for i in range(k_period - 1, n):
            ll = min(b["l"] for b in bars[i - k_period + 1: i + 1])
            hh = max(b["h"] for b in bars[i - k_period + 1: i + 1])
            rng = hh - ll
            k_out[i] = 50.0 if rng == 0 else (hh - bars[i]["c"]) / rng * 100.0
        return k_out, d_out

    orig = ast_interpret.compute_stoch_raw
    ast_interpret.compute_stoch_raw = _inverted_numerator
    try:
        result = compare(obs, warmup_bars=13, tolerance_rel=1e-6)
    finally:
        ast_interpret.compute_stoch_raw = orig
    assert compare(obs, warmup_bars=13, tolerance_rel=1e-6)["verdict"] == "VENDOR-PARITY VERIFIED"

    assert result["verdict"] != "VENDOR-PARITY VERIFIED"
    assert result["disagreement_count"] >= result["compared_non_warmup"] - 5


def test_zero_range_windows_do_not_occur_in_this_real_capture():
    """⛔ THE HONEST NON-COVERAGE CONTROL. Confirms, directly, that this real
    300-bar SPY capture contains ZERO 14-bar windows where
    highestHigh == lowestLow -- proving the zero-range fallback branch is
    genuinely UNEXERCISED by real data here, rather than silently assumed
    untested. If this ever starts failing (a future re-capture happens to
    include a flat window), that is new coverage, not a regression -- update
    the report rather than the assertion."""
    obs = _load()
    bars = obs["market"]["bars"]
    zero_range = 0
    for i in range(13, len(bars)):
        window = bars[i - 13: i + 1]
        hh = max(b["h"] for b in window)
        ll = min(b["l"] for b in window)
        if hh - ll == 0:
            zero_range += 1
    assert zero_range == 0


def test_zero_range_fallback_is_internally_consistent_NOT_vendor_verified():
    """⛔⛔ SYNTHETIC FIXTURE, NOT REAL VENDOR DATA -- kept and labelled
    honestly as such. Proves ONLY that UCT's own `range == 0 -> 50` branch is
    deterministic and internally self-consistent (every zero-range bar reads
    exactly 50.0, regardless of what close/high/low happen to be, as long as
    high==low for the whole window). This does NOT establish TradingView's
    real behavior for a flat/zero-range window -- that remains genuinely
    unverified (no real market data in any capture this program has taken
    exhibits it). Do not upgrade this test's existence into a vendor-parity
    claim."""
    flat_bars = [{"t": str(1700000000 + i * 86400), "o": 100.0, "h": 100.0,
                  "l": 100.0, "c": 100.0, "v": 1000.0} for i in range(20)]
    synthetic = {
        "market": {"symbol": "SYNTHETIC", "timeframe": "D", "bars": flat_bars},
        "engine": {"ast": _ast_with_args("high", "low", "close", 14)},
        "vendor": {"readDecimals": 6, "values": {}},
        "provenance": {"platform": "synthetic-self-internal-only", "who": "internal"},
    }
    # ⛔ Deliberately NOT run through `compare()` -- `_assert_real_vendor_source`
    # would (correctly) refuse a synthetic provenance, which is exactly right;
    # this test calls the interpreter directly instead, precisely because it
    # is NOT a vendor-parity claim.
    from api.services.ast_interpret import interpret
    col = interpret(synthetic["engine"]["ast"], flat_bars, opts={"tf": "D"})
    for i in range(13, len(flat_bars)):
        assert col[i] == 50.0


@pytest.mark.parametrize("bad_token", ["uct-generated", "internal-generated", "self-generated", ""])
def test_a_non_vendor_provenance_is_refused_never_treated_as_truth(bad_token):
    obs = _load()
    poisoned = json.loads(json.dumps(obs))
    poisoned["provenance"]["platform"] = bad_token
    with pytest.raises(VendorSourceRefused):
        compare(poisoned, warmup_bars=13, tolerance_rel=1e-6)
