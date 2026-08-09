"""The operand grammar — one relational primitive, and the bb-only one retired.

Until Phase C an alert condition compared an indicator value to a NUMBER, with
exactly one exception hard-wired to one indicator. This file is the grammar's own
tests: the three operand kinds, the boundary that refuses a malformed one, and —
the part that matters most — the equivalence proof that `bb`'s dynamic threshold
resolves to the SAME number through the general form.

⚠️ THE EQUIVALENCE IS ASSERTED AGAINST A RE-STATED COPY OF THE OLD FUNCTION, NOT
AGAINST THE NEW ONE. `test_the_retired_bb_override_and_the_grammar_agree` inlines
the pre-Phase-C body verbatim and demands exact equality over a parameter grid. A
test that compared the grammar to itself would be green on any tree.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from api.services import alert_conditions as ac
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_compute

_FIXTURES = pathlib.Path(__file__).parent / "fixtures"


def _load_alert_baseline() -> dict:
    """The 5,040-row baseline's bars — REAL-shaped, 220 of them, committed."""
    path = _FIXTURES / "indicator_alert_baseline.json"
    assert path.exists(), "the pre-B5 alert baseline is missing"
    return json.loads(path.read_text(encoding="utf-8"))


# ─── the three kinds ─────────────────────────────────────────────────────────

def test_a_bb_touch_resolves_through_the_generic_operand_now():
    """`_bb_threshold_override` was the module's ONE relational primitive and it
    was bb-only. It is now one CASE of a general grammar, and this is the case.
    """
    bars = _load_alert_baseline()["bars"]
    upper = indicator_compute.compute_bb([b["c"] for b in bars], 20, 2.0)[0]
    got = ac.resolve_operand({"kind": "address", "address": "bb.upper"},
                             bars, {"period": 20, "stddev": 2.0}, ev.address_value)
    assert got == upper[-1]
    # …and the LOWER band is a different number, so "it resolved something" is
    # not what makes this pass.
    lower = indicator_compute.compute_bb([b["c"] for b in bars], 20, 2.0)[2]
    assert lower[-1] != upper[-1]
    assert ac.resolve_operand({"kind": "address", "address": "bb.lower"},
                              bars, {"period": 20, "stddev": 2.0},
                              ev.address_value) == lower[-1]


def test_close_is_an_operand_and_it_is_not_the_same_thing_as_a_constant():
    bars = _load_alert_baseline()["bars"]
    assert ac.resolve_operand({"kind": "close"}, bars, {}, None) == bars[-1]["c"]
    assert ac.resolve_operand({"kind": "const", "value": 70.0}, bars, {}, None) == 70.0
    # …and they are genuinely different answers on this series, so a `close`
    # operand silently resolving to a constant (or vice versa) is visible.
    assert bars[-1]["c"] != 70.0


def test_an_unknown_operand_kind_raises_rather_than_returning_none():
    """⛔ RAISES. `None` is this lane's "could not compute" answer and
    `_evaluate_one` turns it into a silent no-fire — which is the `vwap` class of
    defect (an alert offered that can never fire) reached from a new direction.
    A malformed operand is a BUG, not a quiet bar.
    """
    with pytest.raises(ValueError, match="unknown operand kind"):
        ac.resolve_operand({"kind": "vibes"}, [], {}, None)
    # An absent spec and an absent kind are the same bug wearing two hats.
    with pytest.raises(ValueError, match="unknown operand kind"):
        ac.resolve_operand(None, [], {}, None)
    with pytest.raises(ValueError, match="unknown operand kind"):
        ac.resolve_operand({}, [], {}, None)
    # …and the message names the legal answers, so the raise is actionable.
    with pytest.raises(ValueError, match="const"):
        ac.resolve_operand({"kind": "vibes"}, [], {}, None)


def test_the_legal_kinds_are_declared_once_and_every_one_of_them_resolves():
    """`OPERAND_KINDS` is quoted in the error message, so a kind listed there and
    not implemented would advertise an operand that raises."""
    bars = _load_alert_baseline()["bars"]
    assert set(ac.OPERAND_KINDS) == {"const", "address", "close"}
    specs = {
        "const": {"kind": "const", "value": 1.0},
        "close": {"kind": "close"},
        "address": {"kind": "address", "address": "rsi"},
    }
    assert set(specs) == set(ac.OPERAND_KINDS), (
        "a kind is declared and this test does not drive it")
    for kind, spec in specs.items():
        got = ac.resolve_operand(spec, bars, {}, ev.address_value)
        assert got is not None, f"the {kind} operand resolved to nothing"


# ─── the "not computable yet" answers, which are NOT bugs ────────────────────

def test_a_const_with_no_value_and_an_empty_window_are_data_not_declarations():
    assert ac.resolve_operand({"kind": "const", "value": None}, [], {}, None) is None
    assert ac.resolve_operand({"kind": "close"}, [], {}, None) is None
    # An address whose value function has no answer for this window: 3 bars is
    # far short of a 20-period band.
    short = _load_alert_baseline()["bars"][:3]
    assert ac.resolve_operand({"kind": "address", "address": "bb.upper"},
                              short, {}, ev.address_value) is None
    # …and an address that does not exist resolves to None rather than raising:
    # the create path validates nothing, so a stored typo must stay the silent
    # no-op it has always been rather than becoming a new crash.
    assert ac.resolve_operand({"kind": "address", "address": "not_an_address"},
                              _load_alert_baseline()["bars"], {},
                              ev.address_value) is None


def test_an_address_operand_without_a_resolver_raises():
    """Passing `None` where the resolver belongs would make every relation
    silently unresolvable — a threshold that quietly reverts to the user's."""
    with pytest.raises(ValueError, match="address_value"):
        ac.resolve_operand({"kind": "address", "address": "rsi"},
                           _load_alert_baseline()["bars"], {}, None)


# ─── ⭐ THE RETIREMENT, PROVEN AGAINST THE CODE THAT WAS DELETED ─────────────

def _pre_phase_c_bb_threshold_override(bars, params, condition):
    """The body of `_bb_threshold_override` as it stood BEFORE Phase C, verbatim.

    ⚠️ COPIED HERE ON PURPOSE. The frozen replay proves the whole lane did not
    move; this proves the specific substitution, in isolation, against the exact
    arithmetic that was removed — so if the replay ever had to be re-recorded for
    an unrelated reason, this claim would survive it.
    """
    if condition not in ("touch_upper", "touch_lower"):
        return None
    from api.services import indicator_compute as ic
    period = int(params.get("period", 20))
    stddev = float(params.get("stddev", 2.0))
    closes = [b["c"] for b in bars]
    upper, _mid, lower = ic.compute_bb(closes, period, stddev)
    series = upper if condition == "touch_upper" else lower
    for v in reversed(series):
        if v is not None:
            return float(v)
    return None


@pytest.mark.parametrize("params", [
    {}, {"period": 20, "stddev": 2.0}, {"period": 10, "stddev": 1.5},
    {"period": 5}, {"stddev": 3.0}, {"period": 50, "stddev": 2.5},
])
@pytest.mark.parametrize("condition", [
    "touch_upper", "touch_lower", "above", "below", "cross_above", "cross_zero",
])
def test_the_retired_bb_override_and_the_grammar_agree(params, condition):
    """EXACT equality, never approx — half a unit in the last place is precisely
    what flips a comparison at a band boundary."""
    bars = _load_alert_baseline()["bars"]
    want = _pre_phase_c_bb_threshold_override(bars, params, condition)
    got = ev.threshold_operand_value("bb", condition, bars, params)
    assert got == want, (condition, params, got, want)
    # ⚰️ `ev._bb_threshold_override` was asserted here too, as the surviving
    # delegation. Phase C Task 5 deleted the symbol once it owned the last two
    # files that bound it; `test_the_retired_override_is_gone_from_every_lane_that_bound_it`
    # is the rail on the deletion. The equality above is unchanged and is still
    # measured against the verbatim pre-Phase-C body, which is the claim that
    # matters: the ARITHMETIC did not move, whatever the name did.
    assert not hasattr(ev, "_bb_threshold_override"), (
        "the retired override came back — a delegation nobody calls is a twin "
        "waiting to drift")


def test_the_bb_equivalence_grid_is_not_vacuous():
    """A grid where every case is `None` would agree with a deleted feature."""
    bars = _load_alert_baseline()["bars"]
    resolved = [
        ev.threshold_operand_value("bb", c, bars, {})
        for c in ("touch_upper", "touch_lower", "above", "cross_zero")
    ]
    assert resolved[0] is not None and resolved[1] is not None
    assert resolved[0] != resolved[1], "the two bands resolved to one number"
    assert resolved[2] is None and resolved[3] is None, (
        "a condition with no declared operand picked one up — every armed "
        "non-touch alert would silently change meaning")


def test_nothing_but_the_declared_pairs_gets_a_dynamic_threshold():
    """The table is consulted by (address, condition), and that is the whole
    difference from `if indicator == "bb"`. Every other address keeps the number
    the user typed — which is what the 5,040-row baseline replays.

    🔴 THIS ASSERTED HALF OF ITSELF FOR TWO PHASES, AND THE HALF IT DROPPED IS
    THE ONE THAT MATTERS MOST. It read

        assert (got is not None) == declared or got is None

    which Python groups as `((got is not None) == declared) or (got is None)` —
    **true whenever `got is None`, whatever `declared` says**. So a DECLARED
    operand that stopped resolving (returns `None`, the user's typed threshold
    silently stands, `bb`'s band touch quietly becomes a fixed number) passed
    this rail. What was left could only fail on `not declared and got is not
    None`, which the `if not declared` branch below already asserted — so the
    line contributed nothing and the declared⇒resolves direction was asserted
    nowhere. It is now a real biconditional, one line, both directions.

    ⛔ AND THE LOOP COULD NOT SEE HALF THE TABLE. It iterated
    `ev.INDICATOR_FUNCS`, but two of `THRESHOLD_OPERAND`'s four rows are the
    `sar` EVENTS, which live in `EVENT_FUNCS` — a test titled *"nothing but the
    declared pairs"* never visited half the declared pairs, and `close`
    (`PRICE_FUNCS`, a third partition) was invisible too. The iteration set is
    now `ALERT_CONDITIONS` — the table that decides which (address, condition)
    pairs a user can arm at all, whatever partition the function lives in — and
    a FOURTH partition cannot hide from it because the coverage assertion below
    is against `THRESHOLD_OPERAND` itself, not against a list of partitions.
    """
    bars = _load_alert_baseline()["bars"]
    visited: set[tuple[str, str]] = set()
    for address, conditions in ev.ALERT_CONDITIONS.items():
        for cond in conditions:
            pair = (address, cond["value"])
            visited.add(pair)
            got = ev.threshold_operand_value(address, cond["value"], bars, {})
            declared = pair in ev.THRESHOLD_OPERAND
            assert (got is not None) == declared, (
                f"{address}/{cond['value']} resolved {got!r} with declared={declared}"
                " — a declared pair must resolve and an undeclared one must not")
    # ⭐ THE RAIL ON THE ITERATION SET, not on a number: every declared pair had
    # to be REACHED above, or the loop was measuring a subset of the table and
    # the assertion inside it was a statement about the wrong thing.
    unreached = sorted(set(ev.THRESHOLD_OPERAND) - visited)
    assert not unreached, (
        f"{len(unreached)} declared operand pair(s) live in a partition this "
        f"loop never visits: {unreached}")


# ─── `check_condition` moved, and it is the SAME function ────────────────────

def test_check_condition_is_re_exported_by_the_evaluator_as_the_same_object():
    """Two committed oracles and three other modules reach it through the
    evaluator's name. A move that broke that binding would be a rename."""
    assert ev.check_condition is ac.check_condition


def test_the_moved_check_condition_still_answers_every_branch():
    """One probe per branch, both directions — a copy that dropped a branch
    returns False for it, which reads as 'condition not met'."""
    cc = ac.check_condition
    assert cc("above", 72, 65, 70) is True
    assert cc("above", 68, 65, 70) is False
    assert cc("below", 25, 35, 30) is True
    assert cc("below", 35, 25, 30) is False
    assert cc("cross_above", 72, 65, 70) is True
    assert cc("cross_above", 72, 71, 70) is False
    assert cc("cross_below", 25, 35, 30) is True
    assert cc("cross_below", 35, 40, 30) is False
    assert cc("cross_zero", 0.5, -0.3, None) is True
    assert cc("cross_zero", 0.5, 0.3, None) is False
    assert cc("touch_upper", 70, None, 70) is True
    assert cc("touch_upper", 69.9, None, 70) is False
    assert cc("touch_lower", 30, None, 30) is True
    assert cc("touch_lower", 30.1, None, 30) is False
    assert cc("bogus", 70, 60, 50) is False
    assert cc("above", None, 60, 50) is False


def test_every_comparison_in_check_condition_is_pinned_AT_the_boundary():
    """🔴 THE GAP A MUTATION FOUND, AND WHY IT MATTERS MORE THAN IT LOOKS.

    Flipping `cross_above`'s `current > threshold` to `>=` SURVIVED both
    committed oracles — the 5,040-row baseline AND the 691,195-fire replay. Not
    because either is weak: both walk REAL-shaped float series, and a computed
    indicator value landing EXACTLY on a round threshold is a measure-zero event
    on real tape. So neither grid contains the one input that separates strict
    from non-strict, and `check_condition`'s eight comparisons rode uncovered.

    That is precisely the comparison a user notices. "Crosses above 70" firing
    when RSI touches 70.00 and stops is a different alert from the one they
    armed, and on a rounded delivery value (4dp / 5dp) an exact hit is far from
    hypothetical — `bb`'s touch conditions are ONLY ever exact-ish, which is why
    they are `>=` and `<=` on purpose while the crosses are strict.

    One assertion per comparison, at equality, in both directions.
    """
    cc = ac.check_condition

    # above / below: STRICT. Equality is not "above".
    assert cc("above", 70.0, None, 70.0) is False
    assert cc("above", 70.000001, None, 70.0) is True
    assert cc("below", 30.0, None, 30.0) is False
    assert cc("below", 29.999999, None, 30.0) is True

    # cross_above: prev <= threshold (NON-strict), current > threshold (STRICT).
    assert cc("cross_above", 70.0, 65.0, 70.0) is False   # landed ON it
    assert cc("cross_above", 70.5, 70.0, 70.0) is True    # prev ON it, then up
    assert cc("cross_above", 70.5, 70.5, 70.0) is False   # prev already above

    # cross_below: prev >= threshold (NON-strict), current < threshold (STRICT).
    assert cc("cross_below", 30.0, 35.0, 30.0) is False
    assert cc("cross_below", 29.5, 30.0, 30.0) is True
    assert cc("cross_below", 29.5, 29.5, 30.0) is False

    # cross_zero: NON-strict on prev, strict on current, both directions.
    assert cc("cross_zero", 0.0, -1.0, None) is False     # landed ON zero
    assert cc("cross_zero", 1.0, 0.0, None) is True       # prev ON zero, then up
    assert cc("cross_zero", 0.0, 1.0, None) is False
    assert cc("cross_zero", -1.0, 0.0, None) is True

    # touch_upper / touch_lower: NON-strict, and that asymmetry is the point —
    # a band touch that required strictly-beyond would miss the exact touch it
    # is named after.
    assert cc("touch_upper", 70.0, None, 70.0) is True
    assert cc("touch_upper", 69.999999, None, 70.0) is False
    assert cc("touch_lower", 30.0, None, 30.0) is True
    assert cc("touch_lower", 30.000001, None, 30.0) is False
