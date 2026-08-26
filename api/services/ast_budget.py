"""The budget — and the door it refuses at is its own.

``compute.budget`` has been RESERVED in ``defSchema.js`` since the schema was
written: the validator checks it is null-or-an-object and nothing reads it. This
module is the Python half of what makes it mean something — node count, lookback
depth and base-series reads — refused as a BUDGET refusal, named as such.

⭐⭐ THE DEFECT THIS FILE WAS WRITTEN AGAINST IS "REFUSED BY A DIFFERENT DOOR",
AND IT HAS APPEARED THREE TIMES ON THIS BRANCH. The escape census read
``0 escaped`` while every one of its fifteen cases — including the three
``budget:*`` ones — was refused at the ROOT by ``interpret:node``, because the
census handed jsep trees to a lane that deliberately has no parser. The same
shape reappeared inside a mutation harness. A refusal that arrives from the wrong
door reads identically to the right one and proves nothing about the guard it is
credited to.

So the rule this module is built on: **every refusal here must be attributable to
a cap declared here, and no refusal that belongs to another guard may be produced
here.**

  * ``check_budget`` calls ``node_count`` and ``max_lookback``, and those two
    refuse ``interpret:node``, ``resolve:function``, ``resolve:arity`` and
    ``resolve:window``. Those refusals PROPAGATE UNCHANGED — not caught, not
    re-wrapped, not renamed.
  * a ``RecursionError`` (this lane's ``RangeError``) is NOT a refusal, and this
    module contains NO ``try``/``except``, so it cannot become one.
    ``test_ast_budget.py`` asserts that by walking this file's OWN AST, and
    separately proves it behaviourally by lowering the recursion limit.

⚠️ THE MODULE-LEVEL EDGE POINTS ONE WAY HERE AND BOTH WAYS IN JS, AND THAT IS A
LANGUAGE PROPERTY RATHER THAN A DESIGN DIFFERENCE. Python has no live bindings,
so a genuine top-level cycle would make whichever module is imported SECOND fail
by ``ImportError`` — and ``tests/test_ast_budget.py`` imports this one first while
``tests/test_ast_interpret.py`` imports the other one first, so the cycle would
break for exactly one of them. Instead: this module imports ``ast_interpret`` at
module level, and ``ast_interpret.interpret`` imports this one INSIDE the
function. Same two edges, same call-time resolution, and both import orders work
— pinned by ``test_either_module_may_be_imported_first``.
"""
from __future__ import annotations

from typing import Any, Dict, Mapping, Optional

from api.services.ast_interpret import (
    SESSION_MAX_BARS, TableRefusal, max_lookback, node_count,
)

# --------------------------------------------------------------------------- #
# the caps
# --------------------------------------------------------------------------- #

#: ⭐ THE CAPS, AND WHY EACH IS WHERE IT IS.
#:
#:   maxNodes 128     — the largest hand-written native in the chart registry is
#:                      ``ichimoku`` at 5 columns; a 128-node single column is far
#:                      past anything a human composes and far short of anything
#:                      that blocks a frame at the 5,000-bar cap. Measured: the
#:                      whole committed AST corpus tops out at NINE nodes.
#:   maxLookback      — the chart holds 5,000 bars on every timeframe, and the
#:                      warmup a formula may ask for is capped so the user is not
#:                      left reading a mostly-empty pane as broken. ⭐⭐ IT IS
#:                      DERIVED, NOT TYPED: ``max(NESTED_RECURRENCE_WARMUP,
#:                      SESSION_MAX_BARS)`` — the larger of the two families it
#:                      has to hold. See both constants below.
#:                      ⚠️ 500 UNTIL 2026-08-23 IN THIS LANE — the JS twin moved
#:                      to 550 on 2026-08-22 (`942415444`) and this half was
#:                      missed, so for a day the browser ACCEPTED what the server
#:                      REFUSED: a nested recurrence legitimately needs TWO
#:                      warmups (script 10's trailing stop is `accum` inside
#:                      `accum`: 250 + 250 + ATR's 22 + 1 = 524), which is the
#:                      very family that change was made to admit — and every
#:                      one of them still died here on save. The two-lane rail
#:                      caught it; no gate list ran that rail for a day. That is
#:                      also why the number is now an EXPRESSION over two named
#:                      constants rather than a digit either lane can retype.
#:   maxSeriesRefs 8  — spec §5's perf budget is ≤60 series and ≤8 panes per
#:                      chart; eight base-series reads inside ONE definition is
#:                      already the whole pane budget's worth of data in a single
#:                      column. Measured: the corpus tops out at FOUR.
#:
#: ⚠️ EACH IS DERIVED FROM A NUMBER THAT ALREADY EXISTS IN THIS SYSTEM, on
#: purpose. A cap chosen by taste is a cap nobody can re-derive when it needs to
#: move. The three numbers are asserted EQUAL to the JS lane's, read out of
#: ``budget.js`` rather than re-typed.
#:
#: ⚠️ THE LOOKBACK CAP IS ALSO THE CEILING ON A BAR OFFSET, AND THERE IS NO SECOND
#: NUMBER -- ``max_lookback`` counts an offset node as ``value + child``, so
#: ``close[600]`` and ``sma(close, 600)`` are the same 600 bars of warmup meeting
#: the same cap. SO RAISING IT TO HOLD A SESSION RAISED THE OFFSET CEILING WITH
#: IT, by design rather than as an uncosted side effect: ``close[<one session>]``
#: is now well-formed and one bar past the cap still refuses. Stated so the next
#: reader does not discover a second moved ceiling by surprise -- nothing else
#: widens: ``DEFAULT_BUDGET`` has no non-test consumer outside this module and its
#: JS twin, and ``effective_budget`` still clamps a stored budget DOWNWARD only.
#:
#: ⛔ A CAP MUST BE REACHABLE OR IT IS NOT A GUARD. ``maxSeriesRefs`` counts
#: OCCURRENCES, not distinct names: the closed table declares FIVE series, so a
#: distinct-name count could never exceed 8 and ``budget:series`` would be a latch
#: nothing can trip.
#: The nested-recurrence family's warmup — the driver the lookback cap had
#: BEFORE a session had to fit inside it, kept and named rather than deleted.
#: ``accum`` inside ``accum`` needs TWO warmups: 250 + 250 + ATR's 22 + 1 = 524,
#: rounded up. ⛔ IT IS STILL LOAD-BEARING: if a corrected session were ever
#: SHORTER than this, dropping it would silently refuse the whole trailing-stop
#: family the 2026-08-22 move was made to admit.
NESTED_RECURRENCE_WARMUP = 550

#: ⭐⭐ THE LOOKBACK CAP — DERIVED FROM THE LARGER OF THE TWO FAMILIES IT HOLDS,
#: AND NEVER TYPED. Controller ruling O7, 2026-08-26.
#:
#: ⛔ WHY IT MOVED, so the next reader does not see a raised budget and assume
#: somebody was making a script pass. ``lookback: "session"`` bounds to one ET
#: calendar day (``closedTable.json::sessionMaxBars``), which is LONGER than
#: ``NESTED_RECURRENCE_WARMUP``. Under the old cap every session-anchored call
#: refused ``budget:lookback`` at the save door and at compute — the declared
#: grammar shipped unusable, which is worse than the depth it costs. The cap's
#: own note forbids moving it *"to make one script pass"*, and that prohibition
#: is right; this is not one script but an entire declared grammar the spec
#: requires, and the number comes from this engine's own definition of a session
#: rather than being chosen to fit. That is the distinction the note protects.
#:
#: 📏 THE MEASURED COST, at the site rather than only in a report: on the 5,000-bar
#: window the chart holds, a 550-bar warmup left **89%** drawable and one session
#: leaves **81%**. Eight points of one pane, against a grammar that otherwise
#: cannot be used at all. Reversible in one constant.
#:
#: ⚠️ THE UX RULE DID NOT CHANGE, only the number it yields — the same sentence
#: the 500 → 550 move was recorded with.
DEFAULT_BUDGET: Mapping[str, int] = {
    "maxNodes": 128,
    "maxLookback": max(NESTED_RECURRENCE_WARMUP, SESSION_MAX_BARS),
    "maxSeriesRefs": 8,
}

#: cap key → the guard that refuses it.
CAP_GUARD: Mapping[str, str] = {
    "maxNodes": "budget:nodes",
    "maxLookback": "budget:lookback",
    "maxSeriesRefs": "budget:series",
}

#: guard → the sentence it always refuses with.
#:
#: ⛔ PAIRWISE DISJOINT, AND ACROSS ``parse.js``'s NINE AND ``ast_interpret``'s SIX
#: TOO, and byte-identical to ``budget.js``'s. Two gates sharing a phrase let a
#: ``raises(match=…)`` pass with the safety deleted, and that has happened in this
#: repo.
REFUSALS: Mapping[str, str] = {
    "budget:nodes": "exceeds the node budget",
    "budget:lookback": "exceeds the lookback budget",
    "budget:series": "exceeds the series-reference budget",
}


class BudgetExceeded(TableRefusal):
    """A budget refusal, and a ``TableRefusal`` by inheritance rather than by
    resemblance.

    ⛔ THE SUBCLASS IS THE POINT. ``tools/ast_conformance.py`` recognises a
    refusal BY TYPE and reconciles the guard that FIRED against the guard the
    case DECLARES. A separate exception class that merely looked like a refusal
    would be the "right type for the wrong reason" blindness that instrument
    declared about itself; a subclass is caught by ``except TableRefusal`` and
    carries ``.guard == 'budget:*'``, so the census can tell this door from every
    other one.
    """


# --------------------------------------------------------------------------- #
# the third measurement
# --------------------------------------------------------------------------- #

def series_refs(ast: Any) -> int:
    """How many DISTINCT BASE SERIES a canonical tree reads.

    ⭐⭐ DISTINCT, NOT REFERENCES, AND THE CAP'S OWN RATIONALE IS WHY. Eight
    reads are "the whole pane budget's worth of DATA in a single column", and
    data is a function of how many columns must be fetched, held and walked --
    not of how many times the tree mentions one. ``high`` read four times is ONE
    column by every one of those measures.

    ⚰️ IT COUNTED REFERENCES until 2026-08-09. See
    ``budget.js::seriesRefs`` for the false refusal that surfaced it; the CAP did
    not move, and distinct <= references always, so nothing that passed before
    can fail now.

    ⛔ ITERATIVE, like ``node_count`` and ``max_lookback`` and for the same
    reason: the escape corpus's ``too_many_nodes`` case is 8,001 nodes deep and
    Python's recursion limit is ~1,000. A measurement that dies inside the guard
    is not a refusal.

    ⚠️ IT COUNTS EVERY ``series`` NODE, INCLUDING A NAME THE TABLE DOES NOT
    DECLARE. Deciding whether a name resolves is ``resolve:name``'s question, and
    answering it here would move ``escapes.json``'s three ``resolve:name`` cases
    out from under the guard that is supposed to catch them. An over-count can
    only make the budget TIGHTER, never looser.
    """
    found = set()
    stack = [ast]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        if node.get("type") == "series":
            # ⛔ KEYED BY NAME, AND A NON-STRING NAME IS ITS OWN KEY RATHER THAN
            # SKIPPED. A malformed ``{"type": "series"}`` with no name is still a
            # read this measurement cannot account for, and dropping it would
            # make a broken tree look CHEAPER than a working one.
            name = node.get("name")
            found.add(name if isinstance(name, str) else repr(name))
        args = node.get("args")
        if isinstance(args, list):
            stack.extend(args)
    return len(found)


#: cap key → the measurement it thresholds. The key set IS ``DEFAULT_BUDGET``'s,
#: both directions, and ``test_ast_budget.py`` asserts that.
_MEASURE = {
    "maxNodes": node_count,
    "maxLookback": max_lookback,
    "maxSeriesRefs": series_refs,
}

#: The order the caps are consulted in, cheapest-and-most-bounding first.
#:
#: ⚠️ DECLARED RATHER THAN LEFT TO DICT ORDER. ``node_count`` is what bounds the
#: cost of everything after it, so an 8,001-node tree is refused before
#: ``max_lookback`` ever walks it; and a tree that fails two caps must report the
#: same one on every run, in BOTH lanes, or the census's guard reconciliation
#: measures traversal order instead of the guard. ``parse.js::OFFENCE_PRIORITY``
#: closed the identical question for the canonicalise door.
CAP_ORDER = ("maxNodes", "maxLookback", "maxSeriesRefs")


# --------------------------------------------------------------------------- #
# the budget a definition actually runs under
# --------------------------------------------------------------------------- #

def effective_budget(stored: Optional[Mapping[str, Any]]) -> Dict[str, int]:
    """A stored ``compute.budget`` resolved against the default. **DOWNWARD ONLY.**

    ⛔ DOWNWARD ONLY, AND IT IS NOT BELT-AND-BRACES. ``compute.budget`` arrives
    from a stored definition, which is USER DATA. A stored budget that could
    RAISE the cap is a stored value that turns off its own limit — the same class
    as an ``active=0`` that also blinds a soak, refused for the same reason.

    ⚠️ AND THE CLAMP LIVES HERE, NOT AT THE CALL SITE. ``check_budget`` runs every
    budget it is handed through this function, so there is NO code path in which a
    cap above the default is honoured — not even one a caller constructs by hand.

    A value that is not a whole number ≥ 1 falls back to the DEFAULT rather than
    refusing: the default is the ceiling, so falling back to it can only tighten
    relative to no budget at all. Whether the stored blob is well-formed is
    ``defSchema``'s question, at a different door.
    """
    source = stored if isinstance(stored, Mapping) else {}
    out: Dict[str, int] = {}
    for key, cap in DEFAULT_BUDGET.items():
        asked = source.get(key)
        ok = (isinstance(asked, int) and not isinstance(asked, bool)
              and asked >= 1 and asked < cap)
        out[key] = asked if ok else cap
    return out


# --------------------------------------------------------------------------- #
# the check
# --------------------------------------------------------------------------- #

def budget_result(ast: Any, budget: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """Measure a tree against its budget and RETURN the verdict.

    ⚠️ IT CAN STILL RAISE — a ``TableRefusal`` FROM ANOTHER GUARD. ``node_count``
    refuses ``interpret:node`` for a malformed tree and ``max_lookback`` refuses
    ``resolve:function`` / ``resolve:arity`` / ``resolve:window``. Those propagate
    unchanged, on purpose: the refusal must name the door that decided, not the
    function that happened to be on the stack when it did.
    """
    caps = effective_budget(budget)
    measured: Dict[str, int] = {}
    for key in CAP_ORDER:
        value = _MEASURE[key](ast)
        measured[key] = value
        if value > caps[key]:
            guard = CAP_GUARD[key]
            return {
                "ok": False,
                "guard": guard,
                "error": (f"{REFUSALS[guard]} — this formula measures {value} "
                          f"and the cap is {caps[key]}"),
                "caps": caps,
                "measured": measured,
            }
    return {"ok": True, "caps": caps, "measured": measured}


def check_budget(ast: Any, budget: Optional[Mapping[str, Any]] = None) -> None:
    """The COMPUTE half — the SAFETY one. RAISES ``BudgetExceeded``.

    ⛔ BOTH HALVES EXIST, AND THE REASON IS NOT BELT-AND-BRACES.
      * Registration-only: a definition registered under one budget and run under
        a later, smaller one computes forever at the old cost.
      * Compute-only: the refusal arrives as a chart that draws sometimes — spec
        §6 state 4 — when it should have been an error the author saw while
        typing.
    The registration check is the UX; this one is the safety, and this is the one
    a mutation must not be able to delete quietly.
    """
    result = budget_result(ast, budget)
    if not result["ok"]:
        raise BudgetExceeded(result["guard"], result["error"])
