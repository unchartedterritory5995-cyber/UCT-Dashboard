"""Pine's float comparison, the server's twin of ``app/src/components/chart/engine/pineCompare.js``.

TradingView's Pine compares two floats with an ABSOLUTE EPSILON (Q-FCMP / Q-FCMP2, engine 78 (#1858)):

    a == b   when  a == b exactly  or  |a - b| <= PINE_EQ_EPSILON
    a != b   when  not (a == b)
    a <  b   when  not (a == b) and a < b        (and ``<=``, ``>``, ``>=`` the same way)
    any operand ``na``  ->  every one of the six is FALSE, ``!=`` included

The readings, why it is not the v6 reference's "rounds float operands to nine fractional digits", the one
compile-time exception (v1-v4 constants) and which built-ins use it are in the JS module's header and in
``docs/pine/capture-queue-2026-11-18-float-tolerance-form.md``.

ONE NUMBER, ONE PLACE. ``PINE_EQ_EPSILON`` and ``PINE_EQ_INCLUSIVE`` are READ from the JS module's
declarations (the ``user_definitions.read_script_engine_version`` pattern), never restated here. Every runtime
image ships ``app/src`` (``tests/test_pine_compare.py`` pins this file into the same image rule). A declaration
that cannot be read FAILS THE IMPORT: a server that cannot say how Pine compares must not start, and a deploy
whose image lost the file fails its healthcheck instead of serving IEEE answers for Pine scripts.

PINE DOCUMENTS ONLY (coordinator ruling D1). A native / PCF / thinkScript formula keeps IEEE comparison.
"""
from __future__ import annotations

import math
import pathlib
import re
from typing import Any, Callable, Dict, Optional, Tuple

_JS = (pathlib.Path(__file__).resolve().parents[2]
       / "app" / "src" / "components" / "chart" / "engine" / "pineCompare.js")

_EPS_RE = re.compile(r"^export const PINE_EQ_EPSILON = ([0-9.eE+-]+)$", re.M)
_INCL_RE = re.compile(r"^export const PINE_EQ_INCLUSIVE = (true|false)$", re.M)


def read_pine_compare_declarations(path: Any = None) -> Optional[Tuple[float, bool]]:
    """(epsilon, inclusive) as DECLARED in ``pineCompare.js``, or None when the file is absent or either
    declaration is missing, ambiguous or malformed."""
    p = path if path is not None else _JS
    try:
        with open(p, encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return None
    eps, incl = _EPS_RE.findall(text), _INCL_RE.findall(text)
    if len(eps) != 1 or len(incl) != 1:
        return None
    try:
        e = float(eps[0])
    except ValueError:
        return None
    if not (e > 0 and math.isfinite(e)):
        return None
    return e, incl[0] == "true"


_DECL = read_pine_compare_declarations()
if _DECL is None:
    raise RuntimeError(f"pine_compare: cannot read PINE_EQ_EPSILON / PINE_EQ_INCLUSIVE from {_JS}; the server "
                       "will not evaluate Pine documents without TradingView's comparison rule")
PINE_EQ_EPSILON: float = _DECL[0]
PINE_EQ_INCLUSIVE: bool = _DECL[1]


def _isnan(x: Any) -> bool:
    return x != x


def pine_eq(a: float, b: float) -> bool:
    """Pine ``==`` on two NUMBERS (neither ``na``): exact equality first (``inf == inf``)."""
    if a == b:
        return True
    d = abs(a - b)
    return d <= PINE_EQ_EPSILON if PINE_EQ_INCLUSIVE else d < PINE_EQ_EPSILON


def pine_gt(a: float, b: float) -> bool:
    return a > b and not pine_eq(a, b)


def pine_lt(a: float, b: float) -> bool:
    return a < b and not pine_eq(a, b)


def pine_ge(a: float, b: float) -> bool:
    return a > b or pine_eq(a, b)


def pine_le(a: float, b: float) -> bool:
    return a < b or pine_eq(a, b)


def pine_ne(a: float, b: float) -> bool:
    return not pine_eq(a, b)


def _cmp01(f: Callable[[float, float], bool]) -> Callable[[float, float], float]:
    return lambda a, b: 0.0 if (_isnan(a) or _isnan(b)) else (1.0 if f(a, b) else 0.0)


PINE_CMP: Dict[str, Callable[[float, float], float]] = {
    ">": _cmp01(pine_gt),
    "<": _cmp01(pine_lt),
    ">=": _cmp01(pine_ge),
    "<=": _cmp01(pine_le),
    "==": _cmp01(pine_eq),
    "!=": _cmp01(pine_ne),
}

#: IEEE with the same ``na`` rule: a native document's six (``ast_interpret._BINARY``), byte for byte.
EXACT_CMP: Dict[str, Callable[[float, float], float]] = {
    ">": _cmp01(lambda a, b: a > b),
    "<": _cmp01(lambda a, b: a < b),
    ">=": _cmp01(lambda a, b: a >= b),
    "<=": _cmp01(lambda a, b: a <= b),
    "==": _cmp01(lambda a, b: a == b),
    "!=": _cmp01(lambda a, b: a != b),
}


def pine_compare_ambiguous(a: Any, b: Any) -> bool:
    """Do the exact and the Pine compare DISAGREE on this pair? (Two unequal doubles within the epsilon.)"""
    if isinstance(a, bool) or isinstance(b, bool) or not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        return False
    return not _isnan(a) and not _isnan(b) and a != b and pine_eq(a, b)


def compare_range(op: str, A: Tuple[float, float], B: Tuple[float, float],
                  table: Dict[str, Callable[[float, float], float]]) -> Optional[Tuple[bool, bool]]:
    """``pineCompare.js::compareRange``: (can be true, can be false) of ``x OP y`` over x in A, y in B."""
    def T(o: str, x: float, y: float) -> bool:
        return table[o](x, y) == 1.0
    alo, ahi = A
    blo, bhi = B
    if op == ">":
        return T(">", ahi, blo), not T(">", alo, bhi)
    if op == ">=":
        return T(">=", ahi, blo), not T(">=", alo, bhi)
    if op == "<":
        return T("<", alo, bhi), not T("<", ahi, blo)
    if op == "<=":
        return T("<=", alo, bhi), not T("<=", ahi, blo)
    if op == "==":
        overlap = alo <= bhi and blo <= ahi
        can_t = overlap or (T("==", ahi, blo) if ahi < blo else T("==", alo, bhi))
        can_f = (not T("==", alo, bhi)) or (not T("==", ahi, blo))
        return can_t, can_f
    if op == "!=":
        r = compare_range("==", A, B, table)
        return (r[1], r[0]) if r else None
    return None


def compare_slack(table: Dict[str, Callable[[float, float], float]]) -> float:
    """``pineCompare.js::compareSlack``: 0 for IEEE, twice the epsilon for the Pine compare."""
    return 0.0 if table.get("==") is EXACT_CMP["=="] else 2.0 * PINE_EQ_EPSILON


def compare_narrow(op: str, branch: bool, lo: float, hi: float, c: float,
                   table: Dict[str, Callable[[float, float], float]]) -> Tuple[float, float]:
    """``pineCompare.js::compareNarrow``: the states in ``[lo, hi]`` for which ``s OP c`` can answer
    ``branch`` (``ast_interpret.refine``), never narrower than the truth under ``table``."""
    slack = compare_slack(table)
    below = (op in ("<", "<=")) == branch
    return (lo, min(hi, c + slack)) if below else (max(lo, c - slack), hi)
