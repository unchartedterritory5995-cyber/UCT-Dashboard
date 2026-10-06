"""P1 signal slice -- ``triggerPolicy``: WHEN a yes/no output alerts.

ONE definition -> TYPED OUTPUTS -> MANY SAFE CONSUMERS. A signal alert is the
alert lane reading a CONDITION output of a stored definition; this module is the
member's vocabulary for *when* that yes/no should notify, and it is kept
SEPARATE FROM THE DEFINITION (it lives on the alert row, never in the tree):

    is_true        -> ``above``       0.5   (true on the newest closed bar)
    becomes_true   -> ``cross_above`` 0.5   (false on the bar before, true now)
    becomes_false  -> ``cross_below`` 0.5   (true on the bar before, false now)

⭐ IT COMPILES ONTO THE EXISTING ROW FIELDS (``condition`` + ``threshold``), SO
THERE IS NO SCHEMA CHANGE AND NO NEW EVALUATOR BRANCH. ``check_condition`` is
the one decider, verbatim, in both evaluation modes.

⭐ WHY 0.5 IS SOUND ON THIS ARCHITECTURE (not a copy of the old branch):
  * a CONDITION column's domain is exactly ``{0, 1, NaN}`` (the property test in
    ``p1.core`` item 2, under semantics 1 and 2); a native EVENTS column's domain
    is checked at registration. On that domain every truth threshold this repo
    uses (scan ``!= 0``, markers ``> 0``, colorMode ``!== 0``, the builtin event
    decoder ``> 0.5``) agrees, and 0.5 is the alert lane's existing decoder
    (``indicator_alert_evaluator.THRESHOLD_OPERAND``);
  * NaN becomes ``None`` at the lane boundary (``_make_value_fn.column``) and
    ``check_condition`` never fires on a ``None`` current, and ``cross_*`` needs
    a known ``prev`` -- which is the P0 transition contract (F->T fires; U->T,
    U->U->T, F->U->T do not; U->F->T fires on its F->T).

⛔ A NUMERIC SERIES IS REFUSED, NEVER THRESHOLDED. Reading ``rsi`` as a yes/no
at 0.5 would be "true when RSI > 0.5" -- a different question the member never
asked, answered confidently. The conversion has to be explicit (a comparison in
the definition), so a policy on a SERIES is refused under the shared gate's own
guard, ``signal:numeric-output``, with the gate's own sentence.

The browser twin is ``app/src/components/chart/engine/triggerPolicy.js``; the
table and the sentence are held equal by ``tests/fixtures/ast/p1_trigger_policy.json``.
"""
from __future__ import annotations

from typing import Any, Mapping, Optional

#: The one number that separates 0 from 1 -- a DECODER, never shown to a member.
TRUTH_DECODER = 0.5

#: policy -> (condition, threshold). The order is the order a surface offers.
POLICIES: dict[str, tuple[str, float]] = {
    "is_true": ("above", TRUTH_DECODER),
    "becomes_true": ("cross_above", TRUTH_DECODER),
    "becomes_false": ("cross_below", TRUTH_DECODER),
}

#: The shared gate's guards (``evaluability.js::GATE_GUARDS``) plus the two this
#: door adds for a malformed request.
GUARD_NUMERIC = "signal:numeric-output"
GUARD_UNKNOWN = "trigger-policy:unknown"
GUARD_CONFLICT = "trigger-policy:conflict"
GUARD_NOT_A_FORMULA = "trigger-policy:not-a-user-output"
GUARD_DEAD_THRESHOLD = "signal:threshold-never-fires"

#: ``evaluability.js`` lane ``signal``'s refusal of a SERIES, VERBATIM.
NUMERIC_SENTENCE = (
    "This output is a number on every bar, not a yes/no. A signal needs a "
    "condition — compare it to something (for example `x > 0`) to make one.")


class PolicyRefused(ValueError):
    """A trigger-policy request this door refuses. A ``ValueError`` so the
    router answers 400 with the sentence; ``guard`` names the rule."""

    def __init__(self, guard: str, message: str) -> None:
        self.guard = guard
        super().__init__(f"{message} [guard:{guard}]")


def compile_policy(policy: str) -> tuple[str, float]:
    """``policy`` -> ``(condition, threshold)``, or RAISE ``PolicyRefused``."""
    try:
        return POLICIES[policy]
    except (KeyError, TypeError):
        raise PolicyRefused(
            GUARD_UNKNOWN,
            f"{policy!r} is not a trigger policy. The policies are: "
            + ", ".join(POLICIES) + ".") from None


def policy_of(condition: Optional[str], threshold: Optional[float]) -> Optional[str]:
    """The policy a stored ``(condition, threshold)`` IS, or ``None``."""
    for name, (cond, thr) in POLICIES.items():
        if condition == cond and threshold is not None and float(threshold) == thr:
            return name
    return None


# ─── the output's type, derived on the server from its own resolvers ─────────

_V2_COMPUTE_KEYS = ("trees", "treesHash", "scanPlot", "sources")


def plot_tree(definition: Mapping[str, Any], plot_key: str) -> Optional[Any]:
    """The tree the alert lane evaluates for ``plot_key`` -- the resolution
    ``alert_user_series._make_value_fn`` makes (``trees[key]``; a document that
    declares v2 and lacks the key has NO tree; else ``compute.ast``). ``None``
    where admission's ``plot`` gate will refuse."""
    compute = definition.get("compute") or {}
    trees = compute.get("trees")
    if isinstance(trees, Mapping) and plot_key in trees:
        return trees[plot_key]
    if any(k in compute for k in _V2_COMPUTE_KEYS):
        return None
    return compute.get("ast")


def output_type_of(definition: Mapping[str, Any], plot_key: str) -> Optional[str]:
    """``'condition' | 'series' | 'scalar'`` for an ``ast`` plot, else ``None``.

    The server twin of ``outputType.js::outputTypeOf`` for the alert lane: the
    manifest ``yields`` resolver (``scan_definition.is_boolean_tree``) and the
    current-only scalar walk (``ast_interpret.unresolved_scalars``) -- the same
    two authorities ``tests/test_p1_truth_core.py`` item 20 holds equal to the
    browser over the shared type fixture. Never read from a client, an intent,
    a label or ``meta``.
    """
    from api.services import ast_interpret, scan_definition

    compute = definition.get("compute") or {}
    if compute.get("kind") != "ast":
        return None
    keys = [str(p.get("key") if isinstance(p, Mapping) else p)
            for p in (definition.get("plots") or [])]
    if plot_key not in keys:
        return None
    tree = plot_tree(definition, plot_key)
    if not isinstance(tree, Mapping):
        return None
    if ast_interpret.unresolved_scalars(tree, None):
        return "scalar"
    return "condition" if scan_definition.is_boolean_tree(tree) else "series"


def is_truth_type(kind: Optional[str]) -> bool:
    return kind in ("condition", "events")


def dead_on_truth_domain(condition: Optional[str], threshold: Optional[float]) -> bool:
    """Can ``(condition, threshold)`` NEVER fire on a ``{0, 1}`` column?

    MEASURED against ``check_condition`` itself over every (current, prev) pair
    the domain allows -- not a hand list. ``cross_above 1`` (what the popover
    used to prefill from a current value of 1) is dead; ``above 0`` is alive
    (it is ``is_true``)."""
    from api.services.alert_conditions import check_condition
    domain = (0.0, 1.0)
    return not any(check_condition(condition or "", cur, prev, threshold)
                   for cur in domain for prev in domain)


def admit_request(user_id: Any, indicator: str, condition: Optional[str],
                  threshold: Optional[float], trigger_policy: Optional[str]
                  ) -> tuple[str, Optional[float]]:
    """The create door's policy step: ``(condition, threshold)`` to store, or
    RAISE ``PolicyRefused``.

    * with a policy: it must be known; a ``condition``/``threshold`` sent beside
      it must equal its compilation; the address must be a member's own formula
      output; and that output must not be a numeric SERIES
      (``signal:numeric-output``). A scalar / missing tree / missing definition
      is left to the admission chain, which refuses it under its own gate.
    * without one, on a formula output that IS a condition: a threshold that can
      never fire on ``{0, 1}`` is refused rather than armed mute.

    ⛔ This does not ADMIT anything. ``ias.create`` -> ``arm_for_alert`` is still
    the authority (repaint, budget, withheld, the cross-lane proof)."""
    from api.services import alert_user_series as aus

    definition = None
    plot_key = None
    if aus.is_user_address(indicator):
        from api.services import user_definitions
        def_id, plot_key = aus.split_user_address(indicator)
        try:
            row = user_definitions.get(user_id, def_id, None)
        except Exception:  # noqa: BLE001 -- the admission chain names it
            row = None
        definition = (row or {}).get("definition") if row else None

    if trigger_policy is not None:
        cond, thr = compile_policy(trigger_policy)
        if (condition is not None and condition != cond) or (
                threshold is not None and float(threshold) != thr):
            raise PolicyRefused(
                GUARD_CONFLICT,
                f"trigger policy {trigger_policy!r} is the rule {cond!r}; the "
                f"request also sent {condition!r} @ {threshold!r}. Send the "
                "policy alone.")
        if not aus.is_user_address(indicator):
            raise PolicyRefused(
                GUARD_NOT_A_FORMULA,
                f"{indicator!r} is a shipped indicator; its alert rules are the "
                "ones the catalog offers for it. A trigger policy applies to a "
                "yes/no output of your own definition.")
        if definition is not None and output_type_of(definition, plot_key) == "series":
            raise PolicyRefused(GUARD_NUMERIC, NUMERIC_SENTENCE)
        return cond, thr

    if condition is None:
        raise PolicyRefused(GUARD_UNKNOWN,
                            "an alert needs a condition or a trigger policy.")
    if (definition is not None
            and output_type_of(definition, plot_key) == "condition"
            and dead_on_truth_domain(condition, threshold)):
        raise PolicyRefused(
            GUARD_DEAD_THRESHOLD,
            f"this output is a yes/no (1 or 0 on every bar), so {condition!r} @ "
            f"{threshold!r} can never fire. Choose when it alerts instead: "
            "is true, becomes true or becomes false.")
    return condition, threshold
