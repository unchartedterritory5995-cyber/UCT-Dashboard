"""P0 TRUTH CORPUS -- slice "unk" (0E / 0F / 0R), Python lane.

Twin of ``app/src/components/chart/engine/__truth__/p0.unk.truth.test.js``; both
read ``p0.unk.controls.json`` so the controls are one snapshot for two lanes.

Each case names ASKED / CLAIMED / DID and an outcome class. "BEFORE" is what the
engine did at base ``a92b96de2``, reproduced before the fix.

THE MODEL (documented, not changed here): unknown is NaN in the walker and
``None`` on the wire; ``&&`` ``||`` ``!`` ``?:`` propagate it strictly; a
comparison against it answers 0 (X23) -- changing that moves warm-up bars of
every comparison (11/176 conformance trees), so it is STOP -- owner review.
Consumers ask "is an input unresolved" BEFORE evaluating; this slice adds the
alert lane's copy of that question for scalars (gate ``scalar``).
"""
from __future__ import annotations

import json
import math
import os

import pytest

from api.services import alert_conditions, alert_user_series as aus, ast_interpret

HERE = os.path.dirname(os.path.abspath(__file__))
CONTROLS_PATH = os.path.join(
    HERE, "..", "app", "src", "components", "chart", "engine", "__truth__",
    "p0.unk.controls.json")
with open(CONTROLS_PATH, encoding="utf-8") as fh:
    CONTROLS = json.load(fh)
BARS = CONTROLS["bars"]


def SER(n):
    return {"type": "series", "name": n}


def NUM(v):
    return {"type": "num", "value": v}


def OP(n, *a):
    return {"type": "op", "name": n, "args": list(a)}


def CALL(n, *a):
    return {"type": "call", "name": n, "args": list(a)}


UNK = OP("/", NUM(0), NUM(0))


def last(ast, scalars=None):
    return ast_interpret.interpret(ast, BARS, scalars=scalars)[-1]


# --------------------------------------------------------------------------- #
# 0E -- the truth table as computed TODAY (pinned; must equal the JS lane's)
# --------------------------------------------------------------------------- #
TRUTH_TABLE = [
    ("unknown > number", OP(">", UNK, NUM(1)), 0.0, "DISCLOSED DIFFERENCE (X23)"),
    ("unknown == number", OP("==", UNK, NUM(1)), 0.0, "DISCLOSED DIFFERENCE (X23)"),
    ("unknown AND true", OP("&&", UNK, NUM(1)), None, "UNKNOWN"),
    ("unknown AND false", OP("&&", UNK, NUM(0)), None, "UNKNOWN (strict, not Kleene)"),
    ("unknown OR true", OP("||", UNK, NUM(1)), None, "UNKNOWN (strict, not Kleene)"),
    ("unknown OR false", OP("||", UNK, NUM(0)), None, "UNKNOWN"),
    ("NOT unknown", OP("!", UNK), None, "UNKNOWN"),
    ("unknown ?: a : b", OP("?:", UNK, NUM(2), NUM(3)), None, "UNKNOWN"),
]


@pytest.mark.parametrize("asked,ast,did,klass", TRUTH_TABLE,
                         ids=[r[0] for r in TRUTH_TABLE])
def test_0E_truth_table(asked, ast, did, klass):
    assert last(ast) == did, f"{asked} [{klass}]"


def test_0E_sequence_functions_keep_unknown_unknown():
    assert last(CALL("crossOver", UNK, SER("close"))) is None
    assert all(v is None for v in ast_interpret.interpret(CALL("barssince", OP("&&", UNK, NUM(1)), NUM(5)), BARS))


def test_0E_residual_X23_a_comparison_feeding_barssince_launders_first():
    """ASKED barssince(market_cap > 1e9) with no scalar. DID: a count since a
    'false' that is really unknown. Pinned -> owner review (gated design)."""
    col = ast_interpret.interpret(
        CALL("barssince", OP(">", SER("market_cap"), NUM(1e9)), NUM(5)), BARS)
    assert col[-1] == 5.0


# --- alert edge semantics on UNKNOWN (unchanged; asserted) ------------------ #
@pytest.mark.parametrize("cond", ["above", "below", "cross_above", "cross_below",
                                  "cross_zero", "touch_upper", "touch_lower"])
def test_0E_alert_an_UNKNOWN_current_value_never_fires(cond):
    """ASKED: alert on a value with no number this bar. DID: no fire. [UNKNOWN]"""
    assert alert_conditions.check_condition(cond, None, 1.0, 0.5) is False


@pytest.mark.parametrize("cond", ["cross_above", "cross_below", "cross_zero"])
def test_0E_alert_an_UNKNOWN_previous_bar_is_not_an_edge(cond):
    """ASKED: a crossing where the previous bar is unknown. DID: no fire -- an
    unknown bar is not counted as the falling/rising side of an edge. [UNKNOWN]"""
    assert alert_conditions.check_condition(cond, 1.0, None, 0.5) is False
    assert alert_conditions.check_condition(cond, -1.0, None, 0.5) is False


# --------------------------------------------------------------------------- #
# 0F -- current scalars are not historical series
# --------------------------------------------------------------------------- #
MCAP = OP(">", SER("market_cap"), NUM(1e9))


def test_0F_evaluator_contract_unchanged_hole_not_refusal():
    """The walker still answers a HOLE for an unsupplied scalar (the railed
    contract in test_ast_scalars.py); the CONSUMER refuses."""
    assert ast_interpret.interpret(SER("market_cap"), BARS) == [None] * len(BARS)


def test_0F_screener_current_scalar_is_a_VALUE():
    assert last(MCAP, {"market_cap": 2e9}) == 1.0
    assert ast_interpret.unresolved_scalars(MCAP, {"market_cap": 2e9}) == []
    assert ast_interpret.unresolved_scalars(MCAP, {}) == ["market_cap"]


def test_0F_alert_lane_REFUSES_a_scalar_formula_at_arm():
    """ASKED: alert on market_cap > 1e9. CLAIMED (before): admitted. BEFORE: the
    column was 0.0 on every bar -- an alert that armed and could never fire, with
    nothing saying why. NOW: REFUSAL by name at arm (gate ``scalar``)."""
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus._make_value_fn("u_p0unk", "value", {"compute": {"kind": "ast", "ast": MCAP}})
    assert exc.value.gate == "scalar"
    assert aus.REFUSAL_FRAGMENTS["scalar"] in str(exc.value)
    assert "market_cap" in str(exc.value)


def test_0F_alert_lane_CONTROL_a_price_formula_is_admitted():
    fn = aus._make_value_fn("u_p0unk", "value",
                            {"compute": {"kind": "ast", "ast": OP(">", SER("close"), NUM(100))}})
    assert fn(BARS, {}) in (0.0, 1.0)


# --------------------------------------------------------------------------- #
# 0R -- controls, unchanged vs the pre-change snapshot
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", sorted(CONTROLS["trees"]))
def test_0R_control_is_the_pre_change_snapshot(name):
    got = ast_interpret.interpret(CONTROLS["trees"][name], BARS)
    want = CONTROLS["expect"][name]
    assert len(got) == len(want)
    for i, (g, w) in enumerate(zip(got, want)):
        if w is None:
            assert g is None or (isinstance(g, float) and math.isnan(g)), f"{name}[{i}]"
        else:
            assert abs(g - w) < 1e-8, f"{name}[{i}]: {g} != {w}"
