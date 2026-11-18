"""COND-TA (coordinator rulings 2026-11-15) -- the Python twin of
``app/src/components/chart/engine/ast/barConstant.js::barConstantTree``, node for node.

Is this CANONICAL tree the same value on every bar of one binding? Literals (``num``, ``str``),
the chart symbol's own text (``symtext``), the chart's timeframe flags (``BIND_TIME_CLOCK``, the
manifest's own roster), operators (``op``, ``textop``) and pointwise table calls (the manifest's
``isPointwise``: no lookback, no forward read, series arguments only) over those. A declared
input leaf's ``inputName`` / ``inputDefault`` are non-enumerable in the browser and never reach a
saved tree, so a saved input reads as an unknown series here: NOT constant (fail closed, the safe
direction for the Pine-import hold that asks this). Anything else fails closed.

Held to the same answers as the browser by ``tests/fixtures/ast/bar_constant_cases.json`` (both
sides read it).
"""
from __future__ import annotations

import math
from typing import Any, Mapping


def is_pointwise(spec: Any) -> bool:
    """``parse.js::isPointwise``: lookback 0, no ``forward``, every argument a series."""
    return (isinstance(spec, Mapping) and spec.get("lookback") == 0 and "forward" not in spec
            and isinstance(spec.get("args"), (list, tuple)) and all(k == "series" for k in spec["args"]))


def bar_constant_tree(tree: Any, table: Any = None, clock: Any = None) -> bool:
    if table is None or clock is None:
        from api.services.ast_bind import BIND_TIME_CLOCK
        from api.services.ast_interpret import TABLE
        table = TABLE if table is None else table
        clock = BIND_TIME_CLOCK if clock is None else clock
    functions = table.get("functions") if isinstance(table, Mapping) else None
    stack = [tree]
    steps = 0
    while stack:
        steps += 1
        if steps > 100000:
            return False
        n = stack.pop()
        if isinstance(n, Mapping) and "type" not in n and "value" in n:
            n = n["value"]   # a `{value}` argument
        if not isinstance(n, Mapping):
            return False
        t = n.get("type")
        if t in ("num", "str", "symtext"):
            continue
        if t == "series":
            if n.get("name") in clock:
                continue
            if isinstance(n.get("inputName"), str):
                continue
            d = n.get("inputDefault")
            if isinstance(d, (int, float)) and not isinstance(d, bool) and math.isfinite(d):
                continue
            return False
        args = n.get("args")
        if t in ("op", "textop") and isinstance(args, list):
            stack.extend(args)
            continue
        if t == "call" and isinstance(args, list):
            spec = functions.get(n.get("name")) if isinstance(functions, Mapping) else None
            if not is_pointwise(spec):
                return False
            stack.extend(args)
            continue
        return False
    return True
