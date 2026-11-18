"""⭐ SEVERAL RUNNING VALUES THAT FEED EACH OTHER: WHICH ONES SETTLE, AND AFTER HOW MANY BARS.

The engine computes `accumK(output, warmup, seed1..seedK, update1..updateK)` for K = 2..4: K values
that each bar are all replaced together, every update reading the others' PREVIOUS values through
`state1`..`stateK`. Like the one-value `accum`, it is a WINDOWED restart: at every bar the values
are seeded afresh `warmup` bars back and run forward. So the question that decides whether the
chart can be trusted is the same one the one-value form answers: by the time the window ends, does
where it STARTED still matter?

This module answers that from the shape of the updates alone. No bars are read.

Two shapes SETTLE (rulings of 2026-11-18):

* LINEAR. Every update is a sum of plain-number multiples of the states, plus terms that read no
  state. That is x(t) = A x(t-1) + b(t) with a K x K matrix A of literals. What is left of the
  starting point after n steps is A^n times it, so the bound for the COUPLED system is read off
  the powers of A directly (`needs`: the first step from which every later power is under the
  tolerance). A two-pole filter is this shape (the second state carries the value before last);
  so is a Laguerre filter (four stages, each a plain-number mix of itself and the one before).

* CASCADE. The states can be ordered so each update reads only itself and EARLIER ones, and what
  it keeps of ITSELF is under 1: a plain-number multiple under 1 in size, possibly through a
  CLAMP (max, min, abs: none of them can widen a difference, so `max(-0.999, min(0.999, 0.67 *
  state1 + ...))` keeps 0.67). Earlier states may be read any way at all (inside a logarithm, say).
  Each stage forgets its own start geometrically. THE BOUND IS (STAGES + 1) PASSES OF THE SLOWEST
  STAGE, not the stages' sum: while an earlier stage is still settling it keeps handing the next
  one a little of its start, and a steep function in between magnifies that (a logarithm near its
  edge: 500 times). With one whole spare pass per hand-off (a factor of 10,000 each) the bound
  holds for a hand-off gain into the thousands. Measured on a smoothed range position stretched
  with a logarithm and smoothed again (a Fisher-style transform with its fed-back value CLAMPED),
  over 4,000 random series: after the stages' plain sum (37 steps) the worst trace of the start
  was 3.5e-4, ABOVE the tolerance; at 69 steps (3 passes of 23) it is under 1e-9.
  ⛔ NOT THIS SHAPE: the Fisher Transform as published and as TradingView's built-in computes it.
  That SNAPS the fed-back value (past 0.99 it becomes 0.999), a choice on its own value, which is
  path-dependent here however well it behaves. It is a library matter, per indicator, on a capture.
  WHAT IT DOES NOT COVER: a hand-off far steeper than that (an exponential of a large multiple of
  an earlier value). Nothing in the first set is, and each named indicator carries its own value
  check against a run from the first bar.

Everything else that reads a state is PATH-DEPENDENT: a maximum or minimum of it, a condition on
it, one state times another, a coefficient that is itself a series. There the starting point can
matter for ever (a ratchet, a count, a switch), and a restart `warmup` bars back is a different
indicator from the same formula run from the first bar.

    classify(node, settled=1e-4, cap=960) -> {"shape", "k", "warmup", "needs", "why", ...}
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set, Tuple

#: The multi-value functions, by how many values each carries.
FUNCTIONS: Mapping[str, int] = {"accum2": 2, "accum3": 3, "accum4": 4}
#: The names an update reads the previous values by.
STATES: Tuple[str, ...] = ("state1", "state2", "state3", "state4")

LINEAR, CASCADE, PATH, MALFORMED = "linear", "cascade", "path-dependent", "malformed"
#: The engine itself will not compute it, whatever its numbers: a running value read where the engine
#: holds no value for it (`engine_objection`).
UNREADABLE = "unreadable"


def _is(node: Any, kind: str) -> bool:
    return isinstance(node, Mapping) and node.get("type") == kind


def _args(node: Any) -> List[Any]:
    args = node.get("args") if isinstance(node, Mapping) else None
    return args if isinstance(args, list) else []


def _whole(node: Any) -> Optional[int]:
    v = node.get("value") if _is(node, "num") else None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not float(v).is_integer():
        return None
    return int(v)


def parts(node: Any) -> Optional[Dict[str, Any]]:
    """An accumK call taken apart, or None when it is not one written as the engine reads it:
    `(output, warmup, seed1..seedK, update1..updateK)`, the first two plain whole numbers."""
    if not _is(node, "call") or node.get("name") not in FUNCTIONS:
        return None
    k = FUNCTIONS[node["name"]]
    args = _args(node)
    if len(args) != 2 + 2 * k:
        return None
    output, warmup = _whole(args[0]), _whole(args[1])
    if output is None or warmup is None or not (1 <= output <= k) or warmup < 1:
        return None
    return {"k": k, "output": output, "warmup": warmup, "seeds": args[2:2 + k], "updates": args[2 + k:]}


def engine_objection(update: Any, k: int) -> Optional[str]:
    """Why THE ENGINE will not compute this update, or None. ⭐ THE ENGINE IS THE AUTHORITY, AND IT IS
    ASKED, NOT RESTATED: this walks the update the way `ast_interpret` plans one and uses the
    engine's own predicates (`_is_stateful_call`, `is_pointwise`). One previous set of values is
    carried per step, not a history, so a running value may be read through operators and one-bar
    functions only: never under a bar offset, never inside another running value, never inside a
    function that reads a window of bars.

    ⚰️ Found live, 2026-11-18. A second stage that took `lowest(... state1 ..., 10)` was called a
    chain here ("earlier states, any way at all") and refused by the browser's engine: the door
    accepted what the engine does not compute, and the member's request went round twice."""
    from api.services import ast_interpret as engine
    stack = [update]
    while stack:
        x = stack.pop()
        if not isinstance(x, Mapping) or not reads(x, k) or _is(x, "series"):
            continue
        if _is(x, "offset"):
            return ("a running value sits under a bar offset; only last bar's values are carried, so it is written "
                    "state1, never state1[1]")
        if _is(x, "call"):
            name = str(x.get("name"))
            try:
                nested = engine._is_stateful_call(x)
                one_bar = (not nested) and engine.is_pointwise(engine._fn_spec(name))
            except Exception:                              # noqa: BLE001 -- a name the engine does not know reads no bar
                nested, one_bar = False, False
            if nested:
                return f"a running value sits inside a nested {name}(...)"
            if not one_bar:
                return f"a running value sits inside {name}(...), which reads a window of bars rather than one"
        stack.extend(_args(x))
    return None


def reads(node: Any, k: int) -> Set[int]:
    """Which of state1..stateK (as 0-based numbers) a formula reads. Iterative."""
    found: Set[int] = set()
    stack = [node]
    while stack:
        n = stack.pop()
        if _is(n, "series") and n.get("name") in STATES[:k]:
            found.add(STATES.index(n["name"]))
        stack.extend(_args(n))
    return found


#: The engine's own maths on plain numbers (radians, as the engine computes them). A filter's
#: coefficients are written "exp(-1.414 * 3.14159 / 10)": a model asked to work that out by hand
#: gets it wrong, and a wrong coefficient is a different filter.
_MATHS = {
    "exp": (1, math.exp), "ln": (1, math.log), "log10": (1, math.log10), "sqrt": (1, math.sqrt),
    "cos": (1, math.cos), "sin": (1, math.sin), "tan": (1, math.tan), "atan": (1, math.atan),
    "abs": (1, abs), "pow": (2, math.pow),
}


def literal(node: Any) -> Optional[float]:
    """The value of a formula made ONLY of plain numbers, + - * / (and a leading minus) and the
    engine's maths functions of them, or None. "2 / (10 + 1)" and "exp(-0.444)" are plain numbers;
    anything that reads a bar, a setting or a running value is not."""
    if _is(node, "num"):
        v = node.get("value")
        return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None
    if _is(node, "call") and node.get("name") in _MATHS:
        arity, fn = _MATHS[node["name"]]
        values = [literal(a) for a in _args(node)]
        if len(values) != arity or any(v is None for v in values):
            return None
        try:
            out = float(fn(*values))
        except (ValueError, OverflowError, ZeroDivisionError):
            return None
        return out if math.isfinite(out) else None
    if not _is(node, "op"):
        return None
    name, args = node.get("name"), _args(node)
    if name == "u-" and len(args) == 1:
        v = literal(args[0])
        return None if v is None else -v
    if name in ("+", "-", "*", "/") and len(args) == 2:
        a, b = literal(args[0]), literal(args[1])
        if a is None or b is None:
            return None
        if name == "+":
            return a + b
        if name == "-":
            return a - b
        if name == "*":
            return a * b
        return a / b if b != 0 else None
    return None


def affine(node: Any, k: int, only: Optional[int] = None) -> Optional[List[float]]:
    """The plain-number multiple of each state in `node`, or None when a state is read any other way.

    `[c1..cK]` means node = c1*state1 + ... + cK*stateK + (something that reads no state).
    With `only` (a 0-based state number) every OTHER state counts as "something that reads no
    state": the answer is then about that one state alone, which is what a cascade asks."""
    def free(n: Any) -> bool:
        r = reads(n, k)
        return not r if only is None else only not in r

    def walk(n: Any) -> Optional[List[float]]:
        if free(n):
            return [0.0] * k
        if _is(n, "series"):                                     # a state itself (it is not free)
            out = [0.0] * k
            out[STATES.index(n["name"])] = 1.0
            return out
        if not _is(n, "op"):
            return None                                          # a state inside a function, a choice, a shifted bar ...
        name, args = n.get("name"), _args(n)
        if name == "u-" and len(args) == 1:
            a = walk(args[0])
            return None if a is None else [-x for x in a]
        if len(args) != 2:
            return None
        if name in ("+", "-"):
            a, b = walk(args[0]), walk(args[1])
            if a is None or b is None:
                return None
            return [x + y if name == "+" else x - y for x, y in zip(a, b)]
        if name == "*":
            for number, other in ((args[0], args[1]), (args[1], args[0])):
                c = literal(number)
                if c is not None:
                    a = walk(other)
                    return None if a is None else [c * x for x in a]
            return None                                          # a state times something that is not a plain number
        if name == "/":
            c = literal(args[1])
            a = walk(args[0])
            if c is None or c == 0 or a is None:
                return None                                      # a state divided by something that is not a plain number
            return [x / c for x in a]
        return None                                              # a comparison, and/or, ...
    return walk(node)


_CLAMPS = ("max", "min", "abs")


def own_gain(node: Any, k: int, i: int) -> Optional[float]:
    """The most a difference in state i (0-based) can grow by passing through `node`, or None when
    that cannot be told from its shape. Exact when the read is a plain-number multiple; through a
    clamp (max, min, abs) it is the largest gain among the arguments, since none of those
    functions can widen a difference; through a sum, the sum of the gains."""
    exact = affine(node, k, only=i)
    if exact is not None:
        return abs(exact[i])

    def walk(n: Any) -> Optional[float]:
        if i not in reads(n, k):
            return 0.0
        if _is(n, "series"):
            return 1.0
        name, args = (n.get("name"), _args(n)) if isinstance(n, Mapping) else (None, [])
        if _is(n, "call") and name in _CLAMPS and args:
            gains = [walk(a) for a in args]
            return None if any(g is None for g in gains) else max(gains)          # type: ignore[type-var]
        if not _is(n, "op"):
            return None
        if name == "u-" and len(args) == 1:
            return walk(args[0])
        if len(args) != 2:
            return None
        if name in ("+", "-"):
            a, b = walk(args[0]), walk(args[1])
            return None if a is None or b is None else a + b
        if name == "*":
            for number, other in ((args[0], args[1]), (args[1], args[0])):
                c = literal(number)
                if c is not None:
                    g = walk(other)
                    return None if g is None else abs(c) * g
            return None
        if name == "/":
            c, g = literal(args[1]), walk(args[0])
            return None if c is None or c == 0 or g is None else g / abs(c)
        return None
    return walk(node)


def _powers_settle(matrix: Sequence[Sequence[float]], settled: float, cap: int) -> Optional[int]:
    """For x(t) = A x(t-1) + b(t): the first step n from which EVERY power A^m, n <= m <= cap, has
    its largest row sum at or under `settled`; None when the power at `cap` itself is above it.
    (The largest row sum of A^m is the most any starting point can still move any state by.)"""
    k = len(matrix)
    power = [[1.0 if i == j else 0.0 for j in range(k)] for i in range(k)]
    last_over = 0
    for m in range(1, cap + 1):
        power = [[sum(power[i][x] * matrix[x][j] for x in range(k)) for j in range(k)] for i in range(k)]
        norm = max(sum(abs(v) for v in row) for row in power)
        if not math.isfinite(norm):
            return None
        if norm > settled:
            last_over = m
    return None if last_over >= cap else last_over + 1


def _stage_steps(c: float, settled: float) -> int:
    """How many steps until |c|^n is at or under `settled` (one step when the stage has no memory)."""
    if c == 0:
        return 1
    return max(1, math.ceil(math.log(settled) / math.log(abs(c))))


def _order(deps: Sequence[Set[int]]) -> Optional[List[int]]:
    """An order in which every state reads only itself and earlier ones, or None when two states
    read each other (then there is no first stage)."""
    k = len(deps)
    left, order = set(range(k)), []
    while left:
        ready = sorted(i for i in left if not ((deps[i] - {i}) & left))
        if not ready:
            return None
        order.append(ready[0])
        left.discard(ready[0])
    return order


def classify(node: Any, settled: float = 1e-4, cap: int = 960) -> Dict[str, Any]:
    """What shape this accumK is and how many bars it needs. See the module's own words.

    Returns `{shape, k, warmup, needs, why}`: `needs` is the number of steps after which the
    starting point no longer matters (None when it is path-dependent, malformed, or does not
    settle within `cap`); `why` says, in a sentence for the assistant's repair, what decided it."""
    p = parts(node)
    if p is None:
        return {"shape": MALFORMED, "k": None, "warmup": None, "needs": None,
                "why": "it is not written as (which value, warm-up, K starting values, K updates), the first two plain whole numbers"}
    k, updates = p["k"], p["updates"]
    base = {"k": k, "warmup": p["warmup"], "output": p["output"]}
    for i, seed in enumerate(p["seeds"]):
        if reads(seed, k):
            return {**base, "shape": MALFORMED, "needs": None,
                    "why": f"starting value {i + 1} reads a running value, and there is none before the start"}
    for i, update in enumerate(updates):
        objection = engine_objection(update, k)
        if objection:
            return {**base, "shape": UNREADABLE, "needs": None, "why": f"in update {i + 1}, {objection}"}
    rows = [affine(u, k) for u in updates]
    if all(r is not None for r in rows):
        needs = _powers_settle(rows, settled, cap)                # type: ignore[arg-type]
        return {**base, "shape": LINEAR, "needs": needs, "matrix": rows,
                "why": ("every update is a plain-number mix of the running values" if needs is not None else
                        "every update is a plain-number mix of the running values, but the mix never forgets its start "
                        f"(a running total, or a multiple of 1 or more): it has not settled after {cap} bars")}
    deps = [reads(u, k) for u in updates]
    order = _order(deps)
    if order is None:
        return {**base, "shape": PATH, "needs": None,
                "why": "two running values read each other and at least one reads the other in a way that is not a plain-number multiple"}
    slowest, stages = 0, []
    for i in order:
        c = own_gain(updates[i], k, i)
        if c is None:
            return {**base, "shape": PATH, "needs": None,
                    "why": (f"update {i + 1} reads its own earlier value ({STATES[i]}) inside a function, a comparison or a "
                            "choice, or times something that is not a plain number: a ratchet, a count or a switch")}
        if c >= 1:
            return {**base, "shape": PATH, "needs": None,
                    "why": (f"update {i + 1} keeps {c:g} times its own earlier value ({STATES[i]}): a multiple of 1 or more "
                            "never forgets where it started (a running total, or a level that only ratchets)")}
        steps = _stage_steps(c, settled)
        stages.append({"state": i + 1, "keeps": c, "steps": steps})
        slowest = max(slowest, steps)
    total = (len(order) + 1) * slowest                           # a spare pass per hand-off (see the module's words)
    return {**base, "shape": CASCADE, "needs": total if total <= cap else None, "stages": stages,
            "why": ("each update reads only itself and earlier ones, and keeps less than all of its own earlier value"
                    if total <= cap else f"the stages together need {total} bars, more than the {cap} allowed")}
