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

from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple


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


#: ``callExpansions.js::SUPERTREND_WARMUP`` -- the bars each of supertrend's three bounded
#: recurrences re-seeds over. Same number in both lanes (the parity test pins the trees).
SUPERTREND_WARMUP = 200
#: ``closedTable.json::functions.accum.recurrence.binds`` -- asserted equal to the manifest
#: by ``tests/test_call_expansions_parity.py`` rather than read here, so this module stays
#: importable without the interpreter.
ACCUM_SELF = "self"


def _factor(node: Any) -> Optional[Any]:
    """A positive finite number literal (kept as the node carried it), or None."""
    if not isinstance(node, Mapping) or node.get("type") != "num":
        return None
    v = node.get("value")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if v != v or v in (float("inf"), float("-inf")) or v <= 0:
        return None
    return int(v) if v == int(v) else v     # JS writes 3.0 as 3


def supertrend_trees(factor_node: Any, period_node: Any,
                     warmup: int = SUPERTREND_WARMUP) -> Optional[Dict[str, Any]]:
    """``{"value", "direction"}`` for TradingView's ``ta.supertrend(factor, n)`` as three
    bounded ``accum`` recurrences -- ``callExpansions.js::supertrendTrees``, node for node."""
    f = _factor(factor_node)
    n = _window(period_node, 1)
    if f is None or n is None:
        return None
    self_ = _series(ACCUM_SELF)
    close = _series("close")
    prev_close = {"type": "offset", "value": 1, "args": [close]}
    hl2 = _op("/", [_op("+", [_series("high"), _series("low")]), _num(2)])
    atr = _call("atrPine", [_series("high"), _series("low"), close, _num(n)])

    def band(sign: str) -> Dict[str, Any]:
        return _op(sign, [hl2, _op("*", [_num(f), atr])])

    up, dn = band("+"), band("-")
    w = _num(warmup)
    upper = _call("accum", [up, _op("?:", [
        _op("||", [_op("<", [up, self_]), _op(">", [prev_close, self_])]), up, self_]), w])
    lower = _call("accum", [dn, _op("?:", [
        _op("||", [_op(">", [dn, self_]), _op("<", [prev_close, self_])]), dn, self_]), w])
    one, minus_one = _num(1), _num(-1)
    direction = _call("accum", [one, _op("?:", [
        _op("==", [self_, one]),
        _op("?:", [_op(">", [close, upper]), minus_one, one]),
        _op("?:", [_op("<", [close, lower]), one, minus_one]),
    ]), w])
    unknown = _op("||", [
        _call("na", [{"type": "offset", "value": warmup, "args": [upper]}]),
        _call("na", [{"type": "offset", "value": warmup, "args": [lower]}]),
    ])
    na = _op("/", [_num(0), _num(0)])
    return {
        "value": _op("?:", [unknown, na, _op("?:", [_op("==", [direction, minus_one]), lower, upper])]),
        "direction": _op("?:", [unknown, na, direction]),
    }


def _supertrend_part(part: str) -> Callable[[List[Any]], Optional[Dict[str, Any]]]:
    def build(a: List[Any]) -> Optional[Dict[str, Any]]:
        trees = supertrend_trees(a[0], a[1])
        return None if trees is None else trees[part]
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
    "supertrend": (2, 2, "supertrend(factor, atrPeriod)", _supertrend_part("value")),
    "supertrendDirection": (2, 2, "supertrendDirection(factor, atrPeriod)", _supertrend_part("direction")),
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
    if name in ("supertrend", "supertrendDirection"):
        return (f"{name} needs a positive factor and a whole-number ATR period, "
                f"both written as numbers -- {sig}")
    tail = " of at least 2" if name in ("linreg", "correlation") else ""
    return f"{name} needs a whole-number length{tail} written as a number -- {sig}"


def expand_call(node: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    spec = CALL_EXPANSIONS.get(node.get("name"))
    args = node.get("args") or []
    if spec is None or not (spec[0] <= len(args) <= spec[1]):
        return None
    return spec[3](list(args))


#: ⭐ The written size an expansion may reach, in tree nodes -- ``callExpansions.js``'s
#: ``MAX_EXPANDED_NODES``, same number, same refusal text (the parity test pins both).
MAX_EXPANDED_NODES = 1000
MAX_EXPANSION_DEPTH = 200
TOO_LARGE = (f"this formula nests linreg, correlation, vwma, roc, mom, the Keltner bands or supertrend so deeply "
             f"that it would write out more than {MAX_EXPANDED_NODES} terms — nest fewer of them")
TOO_DEEP = f"this formula is nested more than {MAX_EXPANSION_DEPTH} levels deep"


def _scan(tree: Any, declared: Callable[[str], bool]) -> Tuple[bool, int]:
    found, depth = False, 0
    stack = [(tree, 1)]
    while stack:
        n, d = stack.pop()
        if not isinstance(n, Mapping):
            continue
        depth = max(depth, d)
        if n.get("type") == "call" and n.get("name") in CALL_EXPANSIONS and not declared(n["name"]):
            found = True
        args = n.get("args")
        if isinstance(args, list):
            stack.extend((a, d + 1) for a in args)
    return found, depth


def expanded_size(tree: Any, cap: float = float("inf")) -> int:
    """The tree-node count of ``tree`` (a shared subtree counted at every place it is
    written), saturating just past ``cap``. Linear in the DISTINCT nodes."""
    memo: Dict[int, int] = {}
    stack = [(tree, False)]
    while stack:
        n, done = stack.pop()
        if not isinstance(n, Mapping) or (id(n) in memo and not done):
            continue
        args = n.get("args") if isinstance(n.get("args"), list) else []
        if not done:
            stack.append((n, True))
            stack.extend((a, False) for a in args if isinstance(a, Mapping) and id(a) not in memo)
            continue
        size = 1 + sum(memo.get(id(a), 0) for a in args if isinstance(a, Mapping))
        memo[id(n)] = int(min(size, cap + 1))
    return memo.get(id(tree), 0)


def expand_calls(tree: Any, declared: Callable[[str], bool] = lambda _n: False) -> Any:
    """Every expansion call in ``tree`` replaced (innermost first) by its expansion. A name
    the closed table declares is never expanded. Raises ``ExpansionRefused``.

    ⛔ As in the browser: a tree with no expansion is returned untouched (no recursion),
    one nested past ``MAX_EXPANSION_DEPTH`` is refused before the recursive pass, and the
    expanded result may not WRITE more than ``MAX_EXPANDED_NODES`` nodes (an expansion
    repeats its arguments, so nesting multiplies)."""
    if not isinstance(tree, Mapping):
        return tree
    found, depth = _scan(tree, declared)
    if not found:
        return tree
    if depth > MAX_EXPANSION_DEPTH:
        raise ExpansionRefused(TOO_DEEP)
    out = _expand_in(tree, declared)
    if expanded_size(out, MAX_EXPANDED_NODES) > MAX_EXPANDED_NODES:
        raise ExpansionRefused(TOO_LARGE)
    return out


def _expand_in(tree: Any, declared: Callable[[str], bool]) -> Any:
    if not isinstance(tree, Mapping):
        return tree
    args = tree.get("args")
    node: Any = tree
    if isinstance(args, list):
        new_args = [_expand_in(a, declared) for a in args]
        if any(x is not y for x, y in zip(new_args, args)):
            node = dict(tree)
            node["args"] = new_args
    if node.get("type") == "call" and node.get("name") in CALL_EXPANSIONS and not declared(node["name"]):
        out = expand_call(node)
        if out is None:
            raise ExpansionRefused(expansion_problem(node["name"], len(node.get("args") or [])))
        return out
    return node
