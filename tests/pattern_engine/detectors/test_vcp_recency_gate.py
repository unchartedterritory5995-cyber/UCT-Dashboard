"""Discriminating boundary test for the pattern-engine VCP detector's OWN
recency gate (`_MAX_FINAL_LOW_AGE = 15`, vcp.py:99), isolated from
`api/services/screener/base_catalog.py`'s unrelated `VCP_MAX_AGE_BARS = 60`.

⛔⛔ WHY THIS FILE EXISTS. Owner adjudication (2026-09-06): "15 vs 60" was
flagged as a possible freshness-gate mismatch between the two engines that
both answer "is there a VCP". Tracing both values shows they are NOT the same
concept measured with different thresholds:

  - `_MAX_FINAL_LOW_AGE` (this file's subject) is a pre-`_build_detection()`
    CANDIDATE-QUALIFICATION gate inside `detect_vcp()`'s own loop (vcp.py:137)
    -- part of this detector's definition of "is a VCP occurring right now",
    on the bar index of the CANDIDATE'S final contraction low.
  - `VCP_MAX_AGE_BARS` (base_catalog.py:2670) is a DELIBERATELY LOOSE
    pre-filter on how stale the last CONFIRMED SWING may be, paired with the
    real currency test (`floor <= last_close <= top`, base_catalog.py:2809) --
    already boundary-tested in tests/pattern_engine/primitives/test_vcp.py
    (`test_a_base_price_has_already_BROKEN_OUT_of_is_no_longer_a_VCP`,
    `test_a_base_price_has_broken_DOWN_from_is_no_longer_a_VCP`,
    `test_a_FIVE_contraction_base_survives_the_confirmation_lag`).

Both constants are pinned TOGETHER in tests/test_two_engines_do_not_agree.py
(`MEASURED_AGAINST['vcp']`) as part of a statistically independent (kappa
~0.003, n=1397) pair of detectors -- "these are not the same rule at
different sensitivities. They are different rules." That file proves the two
engines disagree at scale; this file proves the ONE constant this owner pass
is about actually IS the gate it claims to be, at its own exact boundary, on
its own detector, with nothing else in that detector's remaining gates
recruited as an accidental explanation.

No prior test isolated `_MAX_FINAL_LOW_AGE` at its boundary in isolation --
`tests/fixtures/vcp/*.json` all ship at the generator's default
`final_tail_bars=2`, far inside the gate. This file closes that one gap.
"""
import importlib.util
import pathlib

from api.services.pattern_engine.detectors.uct.vcp import (
    _MAX_FINAL_LOW_AGE,
    _enumerate_contraction_sequences,
    detect_vcp,
)
from api.services.pattern_engine.primitives.context import build_context
from api.services.pattern_engine.primitives.pivots import detect_pivots

# ── reuse the SHIPPED fixture generator's bar-builder, not a new one ────────
# tests/fixtures/vcp/_generate.py has no __init__.py (it is a one-shot script,
# not a package), so it is loaded by path -- the same technique
# tests/test_two_engines_do_not_agree.py uses for the pattern registry.
_GEN_PATH = (pathlib.Path(__file__).resolve().parents[2]
             / "fixtures" / "vcp" / "_generate.py")
_spec = importlib.util.spec_from_file_location("_vcp_fixture_generate", _GEN_PATH)
_gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gen)

# The exact recipe already shipped as the "clean_3_contractions" POSITIVE
# fixture (tests/fixtures/vcp/clean_3_contractions.json) -- known-firing,
# at the generator's default final_tail_bars=2. Only `final_tail_bars` varies
# below; `_build_vcp_bars` appends it as bars hovering just above the final
# low (still inside the contraction range), which is exactly what
# `last_bar_idx - final_low_idx` in vcp.py:136-137 counts.
_RECIPE = dict(
    contractions=[(0.25, 8), (0.12, 6), (0.06, 5)],
    volume_ratios=[0.9, 0.55, 0.25],
    seed=1,
)


def _bars(final_tail_bars):
    return _gen._build_vcp_bars(final_tail_bars=final_tail_bars, **_RECIPE)


def _ctx(bars):
    return build_context(bars, sym="TEST")


def test_non_vacuity_the_recipe_fires_at_the_shipped_default_tail():
    """The exact recipe ships as a firing positive fixture at tail=2. If this
    does not fire, nothing below isolates the recency gate -- it would be
    isolating a broken recipe instead."""
    bars = _bars(final_tail_bars=2)
    assert detect_vcp(bars, _ctx(bars)), (
        "the base recipe must fire before its recency boundary means anything"
    )


def test_final_low_age_boundary_is_inclusive_at_the_gate_value():
    """`if last_bar_idx - final_low_idx > _MAX_FINAL_LOW_AGE: continue` --
    exactly `_MAX_FINAL_LOW_AGE` bars back must NOT be rejected."""
    bars = _bars(final_tail_bars=_MAX_FINAL_LOW_AGE)
    assert detect_vcp(bars, _ctx(bars)), (
        f"a final contraction low exactly {_MAX_FINAL_LOW_AGE} bars back was "
        f"rejected -- the gate is off by one, or something else changed"
    )


def test_final_low_age_boundary_rejects_one_bar_past_the_gate():
    """One bar older than the gate, all else identical: must NOT fire."""
    bars = _bars(final_tail_bars=_MAX_FINAL_LOW_AGE + 1)
    assert detect_vcp(bars, _ctx(bars)) == [], (
        f"a final contraction low {_MAX_FINAL_LOW_AGE + 1} bars back still "
        f"fired -- the recency gate is not the mechanism it claims to be"
    )


def test_the_rejection_is_the_age_gate_and_not_something_else():
    """⛔⛔ THE CONTROL THAT MAKES the prior test mean anything. A candidate
    with the SAME final contraction (depths, volume, tightening ratio) must
    still be found by the enumerator at tail+1 -- proving detect_vcp's empty
    result is the age gate discarding a real candidate, not the enumerator
    failing to find one for an unrelated reason (which would make the
    boundary look like proof of the age gate while proving nothing)."""
    bars = _bars(final_tail_bars=_MAX_FINAL_LOW_AGE + 1)
    pivots = sorted(detect_pivots(bars, window=3), key=lambda p: p["bar_index"])
    candidates = _enumerate_contraction_sequences(bars, pivots)
    assert candidates, (
        "no candidate sequence was found at all -- the tail length broke pivot "
        "detection, so the boundary test above is not isolating the age gate"
    )
    last_bar_idx = len(bars) - 1
    ages = [last_bar_idx - c["contractions"][-1]["low_idx"] for c in candidates]
    assert any(age > _MAX_FINAL_LOW_AGE for age in ages), (
        f"every enumerated candidate's final low is within the gate "
        f"({ages}) -- detect_vcp's empty result at tail={_MAX_FINAL_LOW_AGE + 1} "
        f"cannot be attributed to this gate"
    )


def test_the_two_engines_gates_are_independently_scoped_by_construction():
    """⭐ Restates the architectural fact this whole file exists to verify
    against, rather than re-deriving it. `_MAX_FINAL_LOW_AGE` reads
    `candidate["contractions"][-1]["low_idx"]` -- a bar index produced by
    THIS detector's own `_enumerate_contraction_sequences` / pivot walk.
    `base_catalog.VCP_MAX_AGE_BARS` (base_catalog.py:2670, applied at :2760)
    reads `pulls[-1]["end"]` -- a bar index produced by base_catalog's own,
    separate swing segmenter (`ctx.swings`, confirmed reversals only). Neither
    constant's caller ever reads the other engine's candidate/swing structure,
    so moving one cannot mechanically move the other -- the independence
    tests/test_two_engines_do_not_agree.py measures at the OUTPUT level
    (kappa ~0.003 on live tickers) is not a coincidence of two similar
    numbers; it is a consequence of the two gates never sharing an input."""
    import inspect

    from api.services.pattern_engine.detectors.uct import vcp as pattern_engine_vcp
    from api.services.screener import base_catalog

    engine_src = inspect.getsource(pattern_engine_vcp.detect_vcp)
    assert "candidate[\"contractions\"][-1][\"low_idx\"]" in engine_src
    assert "base_catalog" not in engine_src and "pulls" not in engine_src

    base_src = inspect.getsource(base_catalog.vcp_state)
    assert "pulls[-1][\"end\"]" in base_src
    assert "pattern_engine" not in base_src and "low_idx" not in base_src
