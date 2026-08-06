"""The operand grammar — what a condition's RIGHT-HAND SIDE is allowed to be.

⭐ WHY THIS MODULE EXISTS. Until Phase C an alert condition compared an indicator
value against a NUMBER the user typed, and there was exactly ONE exception:
`indicator_alert_evaluator._bb_threshold_override`, hard-wired to a single
indicator. That single exception is why two obviously-useful alerts could not be
expressed at all, and both refusals are written down in the evaluator:

  * comparing a line to ANOTHER LINE (the `macd` note in `ALERT_CONDITIONS`), and
  * the two meaningful questions about a trailing stop (`_SAR_IS_NOT_A_THRESHOLD`).

Both were deferred with the same sentence — *a second relational primitive is a
change to the evaluation lane, spec section 8, Phase C*. This is that change, and
it is built ONCE rather than a third time: an operand is a declared spec, not a
branch, so a new relation is a new ROW.

⚠️ IT READS THE DELIVERY WRAPPERS, like every other consumer of this lane. A
relation between a rounded left side and an unrounded right side would flip at
boundaries in a way no user could predict, and the Global Constraint is that both
live consumers compare against the ROUNDED form. `resolve_operand` never reaches
into `indicator_compute` itself — it calls back through the injected
`address_value`, which is the same value function the LEFT side is computed with,
so the two sides cannot round differently even in principle.

⛔ `check_condition` LIVES HERE AND IT WAS MOVED VERBATIM. Its oracle is
`tests/fixtures/indicator_alert_baseline.json` — 5,040 recorded `(value,
triggered)` pairs — plus `tests/fixtures/alerts/fire_log_forming.json`, 691,195
frozen fires. A re-typed copy is a new function wearing an old name, and both
oracles are pointed at the name.
"""

from __future__ import annotations

from typing import Callable, Optional

# The three shapes a right-hand side may take. Declared as data because the
# ValueError below quotes it: a malformed operand must be able to say what the
# legal answers were, and a hand-written sentence would drift from the branches.
OPERAND_KINDS = ("const", "address", "close")


# ─── pure condition matching (MOVED VERBATIM from indicator_alert_evaluator) ──

def check_condition(
    condition: str,
    current: Optional[float],
    prev: Optional[float],
    threshold: Optional[float],
) -> bool:
    """Does an alert fire given current + previous indicator values?

    ``current`` is the latest indicator value (last computed bar). ``prev``
    is the value persisted from the previous evaluation cycle — used only by
    cross-* conditions. ``threshold`` is the user-supplied trigger level for
    above / below / cross_above / cross_below.

    Returns ``False`` for unknown conditions, missing values, or any case
    where the condition is well-defined but not met. Pure function — no
    side effects, no I/O, no module imports.
    """
    if current is None:
        return False

    if condition == "above":
        return threshold is not None and current > threshold
    if condition == "below":
        return threshold is not None and current < threshold
    if condition == "cross_above":
        # Crossed UP through threshold: prev was at/below, current is strictly above.
        return (
            prev is not None
            and threshold is not None
            and prev <= threshold
            and current > threshold
        )
    if condition == "cross_below":
        # Crossed DOWN through threshold: prev was at/above, current is strictly below.
        return (
            prev is not None
            and threshold is not None
            and prev >= threshold
            and current < threshold
        )
    if condition == "cross_zero":
        # Crossed through zero in either direction.
        if prev is None:
            return False
        return (prev <= 0 < current) or (prev >= 0 > current)
    if condition == "touch_upper":
        # Used for Bollinger Band upper-touch — current is expected to be the
        # close, threshold is the upper-band value at the same bar.
        return threshold is not None and current >= threshold
    if condition == "touch_lower":
        # Mirror of touch_upper for the lower band.
        return threshold is not None and current <= threshold
    return False


# ─── the operand grammar ─────────────────────────────────────────────────────

def resolve_operand(
    spec: Optional[dict],
    bars: list[dict],
    params: dict,
    address_value: Optional[Callable[[str, list[dict], dict], Optional[float]]],
) -> Optional[float]:
    """One operand → one number at the LAST bar of ``bars``.

    Three kinds, and the difference between them is the whole point:

        {"kind": "const",   "value": 70.0}      the number the user typed
        {"kind": "close",   }                   the bar's close
        {"kind": "address", "address": "…"}     ANOTHER plot's value, right now

    ``address`` is what makes this general. It is resolved through the injected
    ``address_value(address, bars, params)`` — the evaluator's own dispatch — so
    this module holds no table of indicators and the two sides of a relation are
    computed by the identical function. A line compared against another line is
    now a declaration rather than a branch.

    ⛔ AN UNKNOWN KIND RAISES. ``None`` is this lane's "could not compute" answer
    and ``_evaluate_one`` turns it into a silent no-fire — an alert that is
    offered and can never tell the user anything, which is the exact defect
    (`vwap`, pre-B5) this programme has been closing, reached from a new
    direction. A malformed operand is a BUG in a declaration, not a quiet bar, so
    it is loud at the boundary where the declaration is read.

    ``None`` is still returned for the two cases that are genuinely "not
    computable yet": a const whose value is absent, an empty bar window, or an
    address whose value function has no answer for this window. Those are data,
    not declarations.
    """
    kind = (spec or {}).get("kind")
    if kind == "const":
        v = spec.get("value")
        return None if v is None else float(v)
    if kind == "close":
        return float(bars[-1]["c"]) if bars else None
    if kind == "address":
        if address_value is None:
            raise ValueError(
                "an address operand needs an `address_value` resolver — passing "
                "None would make every relation silently unresolvable"
            )
        return address_value(spec["address"], bars, params)
    raise ValueError(
        f"unknown operand kind {kind!r} — legal kinds are {OPERAND_KINDS}"
    )
