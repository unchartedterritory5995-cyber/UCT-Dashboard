"""BATCH 2 -- the exact-identity formula functions, mirrored for the server's tree checks.

The browser's ``app/src/components/chart/engine/ast/callExpansions.js`` is the authority:
linear regression, correlation, VWMA, rate of change, momentum and the Keltner Channel
bands are each an exact closed form over functions the closed table already declares, and
a stored definition carries only that expansion (no new name reaches any interpreter).

This module exists for ONE door: a model's conversational patch may write
``{"type": "call", "name": "linreg", ...}``, and ``definition_conversation._check_tree``
must check the tree the browser will store -- budget, lint, schema -- not a name the closed
table does not declare. ``tests/test_call_expansions_parity.py`` runs the JS builders through
node and requires the trees to be byte-identical, so the two copies cannot drift.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Mapping, Optional


def _num(value: Any) -> Dict[str, Any]:
    # a negative literal is `u-` of a positive one (the printer/parser round trip)
    if value < 0:
        return {"type": "op", "name": "u-", "args": [{"type": "num", "value": -value}]}
    return {"type": "num", "value": value}


def _series(name: str) -> Dict[str, Any]:
    return {"type": "series", "name": name}


def _op(name: str, args: List[Any]) -> Dict[str, Any]:
    return {"type": "op", "name": name, "args": args}


def _call(name: str, args: List[Any]) -> Dict[str, Any]:
    return {"type": "call", "name": name, "args": args}


def _window(node: Any, minimum: int) -> Optional[Any]:
    """A whole-number literal window >= ``minimum`` (kept as the node carried it), or None."""
    if not isinstance(node, Mapping) or node.get("type") != "num":
        return None
    v = node.get("value")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if v != v or v in (float("inf"), float("-inf")) or v != int(v) or v < minimum:
        return None
    return int(v)   # JS writes 50.0 as 50; the trees must be byte-identical


def true_range_tree() -> Dict[str, Any]:
    prev_close = {"type": "offset", "value": 1, "args": [_series("close")]}

    def gap(side: str) -> Dict[str, Any]:
        return _call("abs", [_op("-", [_series(side), prev_close])])

    return _call("max", [_op("-", [_series("high"), _series("low")]),
                         _call("max", [gap("high"), gap("low")])])


def _roc(a: List[Any]) -> Optional[Dict[str, Any]]:
    n = _window(a[1], 1)
    if n is None:
        return None
    prev = {"type": "offset", "value": n, "args": [a[0]]}
    return _op("/", [_op("*", [_num(100), _op("-", [a[0], prev])]), prev])


def _mom(a: List[Any]) -> Optional[Dict[str, Any]]:
    n = _window(a[1], 1)
    if n is None:
        return None
    return _op("-", [a[0], {"type": "offset", "value": n, "args": [a[0]]}])


def _vwma(a: List[Any]) -> Optional[Dict[str, Any]]:
    n = _window(a[1], 1)
    if n is None:
        return None
    vol = _series("volume")
    return _op("/", [_call("sma", [_op("*", [a[0], vol]), _num(n)]), _call("sma", [vol, _num(n)])])


def _linreg(a: List[Any]) -> Optional[Dict[str, Any]]:
    n = _window(a[1], 2)
    if len(a) < 3:
        off: Any = 0
    else:
        node = a[2]
        off = node.get("value") if isinstance(node, Mapping) and node.get("type") == "num" else None
        if isinstance(off, bool) or not isinstance(off, (int, float)) or off != off:
            off = None
    if n is None or off is None:
        return None
    total = _call("sum", [a[0], _num(n)])
    weighted = _call("wma", [a[0], _num(n)])
    c = (6 * ((n - 1) / 2 - off)) / (n * (n - 1))
    return _op("+", [_op("/", [total, _num(n)]),
                     _op("*", [_op("-", [_op("*", [_num(n), weighted]), total]), _num(c)])])


def _correlation(a: List[Any]) -> Optional[Dict[str, Any]]:
    n = _window(a[2], 2)
    if n is None:
        return None
    x, y = a[0], a[1]
    covariance = _op("-", [_call("sma", [_op("*", [x, y]), _num(n)]),
                           _op("*", [_call("sma", [x, _num(n)]), _call("sma", [y, _num(n)])])])
    return _op("/", [covariance, _op("*", [_call("stdev", [x, _num(n)]), _call("stdev", [y, _num(n)])])])


def _kc_middle(a: List[Any]) -> Optional[Dict[str, Any]]:
    n = _window(a[1], 1)
    return None if n is None else _call("ema", [a[0], _num(n)])


def _kc_band(sign: str) -> Callable[[List[Any]], Optional[Dict[str, Any]]]:
    def build(a: List[Any]) -> Optional[Dict[str, Any]]:
        n = _window(a[1], 1)
        if n is None or not a[2]:
            return None
        mid = _call("ema", [a[0], _num(n)])
        return _op(sign, [mid, _op("*", [a[2], _call("ema", [true_range_tree(), _num(n)])])])
    return build


#: name -> (min args, max args, signature, builder). Same order and words as the JS module.
CALL_EXPANSIONS: Dict[str, tuple] = {
    "roc": (2, 2, "roc(source, length)", _roc),
    "mom": (2, 2, "mom(source, length)", _mom),
    "vwma": (2, 2, "vwma(source, length)", _vwma),
    "linreg": (2, 3, "linreg(source, length, offset = 0)", _linreg),
    "correlation": (3, 3, "correlation(source1, source2, length)", _correlation),
    "kcMiddle": (2, 2, "kcMiddle(source, length)", _kc_middle),
    "kcUpper": (3, 3, "kcUpper(source, length, multiplier)", _kc_band("+")),
    "kcLower": (3, 3, "kcLower(source, length, multiplier)", _kc_band("-")),
}

EXPANSION_NAMES = tuple(CALL_EXPANSIONS)


class ExpansionRefused(ValueError):
    """A call of an expansion name that has no expansion (wrong arity, or a window that
    is not a whole-number literal). ``guard`` is the browser's own."""

    guard = "resolve:expansion"


def expansion_problem(name: str, n_args: int) -> str:
    lo, hi, sig, _ = CALL_EXPANSIONS[name]
    if n_args < lo or n_args > hi:
        count = str(lo) if lo == hi else f"{lo} or {hi}"
        return f"{name} takes {count} arguments -- {sig}"
    tail = " of at least 2" if name in ("linreg", "correlation") else ""
    return f"{name} needs a whole-number length{tail} written as a number -- {sig}"


def expand_call(node: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    spec = CALL_EXPANSIONS.get(node.get("name"))
    args = node.get("args") or []
    if spec is None or not (spec[0] <= len(args) <= spec[1]):
        return None
    return spec[3](list(args))


def expand_calls(tree: Any, declared: Callable[[str], bool] = lambda _n: False) -> Any:
    """Every expansion call in ``tree`` replaced (innermost first) by its expansion. A name
    the closed table declares is never expanded. Raises ``ExpansionRefused``."""
    if not isinstance(tree, Mapping):
        return tree
    args = tree.get("args")
    node: Any = tree
    if isinstance(args, list):
        new_args = [expand_calls(a, declared) for a in args]
        if any(x is not y for x, y in zip(new_args, args)):
            node = dict(tree)
            node["args"] = new_args
    if node.get("type") == "call" and node.get("name") in CALL_EXPANSIONS and not declared(node["name"]):
        out = expand_call(node)
        if out is None:
            raise ExpansionRefused(expansion_problem(node["name"], len(node.get("args") or [])))
        return out
    return node
