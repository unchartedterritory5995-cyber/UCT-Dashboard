"""C45 -- how a canonical tree's value moves with the unknown bars before the window.

The Python twin of ``app/src/components/chart/engine/ast/barIndexShift.js``. It
lives in its OWN module for the reason that file does: the pass signals "not
provable" by raising its own exception and catching it, and ``ast_interpret.py``
may not contain a single ``try`` (``tests/test_ast_budget.py``) -- a caught
``RecursionError`` there is one line from being a budget refusal. This module
never evaluates a tree and never touches the budget; it reads the tree's SHAPE.

``ast_interpret.bar_index_mask`` is the one consumer that turns a verdict into
withheld bars; the two lanes are held equal by
``tests/fixtures/ast/bar_index_shift_parity.json``.
"""
from __future__ import annotations

import json
import math
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple

from api.services.ast_table import recurrences

#: The closed table's recurrences -- the same object ``ast_interpret.RECURRENCES``
#: is built from (``barIndexShift.js`` reads it from ``parse.js`` the same way).
RECURRENCES: Mapping[str, Any] = recurrences()



# --------------------------------------------------------------------------- #
# C45 -- does a tree's value depend on where the series starts?
# The port of ``ast/barIndexShift.js`` and ``interpret.js::barIndexMask``.
# --------------------------------------------------------------------------- #
#
# Pine's ``bar_index`` counts from the first bar of the symbol's HISTORY; the
# ``barindex`` leaf counts from the first bar this lane was HANDED. Off the
# listing they differ by an unknown ``D >= 0``, so every value is ``V + D*K`` and
# the question is what ``K`` is:
#
#   'inv'  K = 0 -- served; it is TradingView's number
#   'pos'  K = 1 -- the value IS a bar index: right as a drawing's x-coordinate,
#          ``D`` away from TradingView's as a value. This lane holds no drawings,
#          so here it is withheld.
#   'dep'  anything else, and anything the pass cannot prove -- withheld.
#
# A PROOF, not a probe: each node is ``P0 + D*P1`` with ``P0``, ``P1`` polynomials
# over opaque atoms, so a least-squares line (``x*slope + (mean(y) - slope*mean(x))``)
# cancels exactly. An ordering test against the index (``bar_index > 100``) is the
# one per-bar case: ``D`` is never negative, so it is known wherever a larger ``D``
# can only confirm this lane's answer, and LISTED (``thresholds``) so
# ``bar_index_mask`` withholds the other bars. Read ``barIndexShift.js`` for every
# rule; the two lanes are held equal by
# ``tests/fixtures/ast/bar_index_shift_parity.json``.

BAR_INDEX_LEAVES = ("barindex", "lastbarindex")

_BI_MONO_SEP = "\x02"
_BI_INV_PREFIX = "1/"
_BI_MAX_TERMS = 96
_BI_MAX_DEPTH = 128
_BI_EPS = 1e-12

#: Linear, time-invariant window operators and what each answers for the constant
#: series 1 (``"period"``: the literal window).
_BI_LINEAR_CALLS = {"sma": 1, "wma": 1, "ema": 1, "rma": 1, "hma": 1, "sum": "period", "change": 0}
#: Unchanged when their FIRST argument moves by a constant.
_BI_SHIFT_INVARIANT_CALLS = frozenset(
    ("stdev", "dev", "rising", "falling", "highestbars", "lowestbars", "rsi", "percentrank"))
#: Move by the same constant as their SOURCE argument (the index names it).
_BI_SHIFT_EQUIVARIANT_CALLS = {
    "highest": 0, "lowest": 0, "median": 0, "pivothigh": 0, "pivotlow": 0,
    "valuewhen": 1, "valuewhenOccurrence": 1, "barsAgo": 0,
}
_BI_WHOLE_SHIFT_CALLS = frozenset(("floor", "round", "ceil"))
_BI_COMPARISONS = frozenset((">", "<", ">=", "<=", "==", "!="))
_BI_LOGICAL = frozenset(("&&", "||", "!"))


class _BarIndexUnprovable(Exception):
    """The pass's own "not provable" -- never a refusal, never a crash."""


def reads_bar_index(tree: Any) -> bool:
    """Does this tree read a bar-index leaf at all? Iterative."""
    stack = [tree]
    seen = set()
    while stack:
        node = stack.pop()
        if not isinstance(node, dict) or id(node) in seen:
            continue
        seen.add(id(node))
        if node.get("type") == "series" and node.get("name") in BAR_INDEX_LEAVES:
            return True
        args = node.get("args")
        if isinstance(args, list):
            stack.extend(args)
    return False


def _bi_reads_binding(tree: Any, name: str) -> bool:
    stack = [tree]
    seen = set()
    while stack:
        node = stack.pop()
        if not isinstance(node, dict) or id(node) in seen:
            continue
        seen.add(id(node))
        if node.get("type") == "series" and node.get("name") == name:
            return True
        args = node.get("args")
        if isinstance(args, list):
            stack.extend(args)
    return False


def _bi_is_na_literal(node: Any) -> bool:
    if not (isinstance(node, dict) and node.get("type") == "op" and node.get("name") == "/"):
        return False
    args = node.get("args")
    return (isinstance(args, list) and len(args) == 2
            and all(isinstance(a, dict) and a.get("type") == "num" and a.get("value") == 0
                    and not isinstance(a.get("value"), bool) for a in args))


class _BarIndexAlgebra:
    """Polynomials over opaque atoms: ``{monomial key: coefficient}``; a monomial
    key is its atom keys, sorted, joined; ``""`` is the constant term."""

    def __init__(self) -> None:
        self._keys: Dict[int, str] = {}
        self._hold: List[Any] = []          # keeps keyed nodes alive (ids stay unique)
        self._atoms: Dict[str, Any] = {}

    def key_of(self, node: Any) -> str:
        if not isinstance(node, dict):
            return "l" + _bi_json(node)
        hit = self._keys.get(id(node))
        if hit is not None:
            return hit
        args = node.get("args")
        inner = ",".join(self.key_of(a) for a in args) if isinstance(args, list) else "-"
        key = "%s\x01%s\x01%s\x01(%s)" % (
            node.get("type"), _bi_json(node.get("name")), _bi_json(node.get("value")), inner)
        self._keys[id(node)] = key
        self._hold.append(node)
        return key

    def _atom_of(self, tree: Any) -> str:
        key = self.key_of(tree)
        self._atoms.setdefault(key, tree)
        return key

    @staticmethod
    def _inverse_key(key: str) -> str:
        return key[len(_BI_INV_PREFIX):] if key.startswith(_BI_INV_PREFIX) else _BI_INV_PREFIX + key

    def _tree_of_atom(self, key: str) -> Any:
        if key.startswith(_BI_INV_PREFIX):
            return {"type": "op", "name": "/",
                    "args": [{"type": "num", "value": 1}, self._atoms[key[len(_BI_INV_PREFIX):]]]}
        return self._atoms[key]

    def _mono_key(self, atoms: List[str]) -> str:
        count: Dict[str, int] = {}
        for a in atoms:
            inv = self._inverse_key(a)
            if count.get(inv, 0) > 0:
                count[inv] -= 1
            else:
                count[a] = count.get(a, 0) + 1
        out: List[str] = []
        for a, n in count.items():
            out.extend([a] * n)
        return _BI_MONO_SEP.join(sorted(out))

    @staticmethod
    def _atoms_of(key: str) -> List[str]:
        return [] if key == "" else key.split(_BI_MONO_SEP)

    @staticmethod
    def constant(c: float) -> Dict[str, float]:
        return {} if abs(c) < _BI_EPS else {"": float(c)}

    def atom(self, tree: Any) -> Dict[str, float]:
        return {self._atom_of(tree): 1.0}

    @staticmethod
    def add(a: Dict[str, float], b: Dict[str, float], sign: float = 1.0) -> Dict[str, float]:
        if not b:
            return a
        out = dict(a)
        for k, c in b.items():
            v = out.get(k, 0.0) + sign * c
            if abs(v) < _BI_EPS:
                out.pop(k, None)
            else:
                out[k] = v
        return out

    @staticmethod
    def scale(a: Dict[str, float], c: float) -> Dict[str, float]:
        if abs(c) < _BI_EPS:
            return {}
        return {k: v * c for k, v in a.items()}

    def mul(self, a: Dict[str, float], b: Dict[str, float]) -> Dict[str, float]:
        if not a or not b:
            return {}
        if len(a) * len(b) > _BI_MAX_TERMS:
            raise _BarIndexUnprovable()
        out: Dict[str, float] = {}
        for ka, ca in a.items():
            for kb, cb in b.items():
                k = self._mono_key(self._atoms_of(ka) + self._atoms_of(kb))
                v = out.get(k, 0.0) + ca * cb
                if abs(v) < _BI_EPS:
                    out.pop(k, None)
                else:
                    out[k] = v
        return out

    @staticmethod
    def equal(a: Dict[str, float], b: Dict[str, float]) -> bool:
        if len(a) != len(b):
            return False
        for k, c in a.items():
            d = b.get(k)
            if d is None or abs(c - d) > _BI_EPS * max(1.0, abs(c)):
                return False
        return True

    @staticmethod
    def is_constant(a: Dict[str, float]) -> bool:
        return len(a) == 0 or (len(a) == 1 and "" in a)

    @staticmethod
    def constant_of(a: Dict[str, float]) -> float:
        return 0.0 if not a else a[""]

    def reciprocal(self, q: Dict[str, float], tree: Any) -> Dict[str, float]:
        if len(q) == 1:
            (k, c), = q.items()
            if abs(c) < _BI_EPS:
                raise _BarIndexUnprovable()
            return {self._mono_key([self._inverse_key(x) for x in self._atoms_of(k)]): 1.0 / c}
        if not q:
            raise _BarIndexUnprovable()
        return {_BI_INV_PREFIX + self._atom_of(tree): 1.0}

    def _mono_tree(self, key: str) -> Any:
        acc = None
        for a in self._atoms_of(key):
            t = self._tree_of_atom(a)
            acc = t if acc is None else {"type": "op", "name": "*", "args": [acc, t]}
        return acc

    def linear(self, p: Dict[str, float], wrap: Callable[[Any], Any], on_constant: float) -> Dict[str, float]:
        out: Dict[str, float] = {}
        for k, c in p.items():
            if k == "":
                out = self.add(out, self.constant(c * on_constant))
            else:
                out = self.add(out, self.scale(self.atom(wrap(self._mono_tree(k))), c))
        return out


def _bi_json(value: Any) -> str:
    """A stable spelling of a leaf for a structural key (internal to this pass)."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(float(value))
    return repr(value)


def bar_index_class(tree: Any) -> str:
    """``barIndexShift.js::barIndexClass`` -- ``'inv'``, ``'pos'`` or ``'dep'``."""
    return bar_index_verdict(tree)["cls"]


def bar_index_verdict(tree: Any) -> dict:
    """``barIndexShift.js::barIndexVerdict`` -- the class, and the threshold
    comparisons it rests on: ``{"cls", "thresholds": [(node, sign)]}``."""
    if not reads_bar_index(tree):
        return {"cls": "inv", "thresholds": []}
    thresholds: List[tuple] = []
    alg = _BarIndexAlgebra()
    NA = {"na": True}

    def lin(p0, p1):
        return {"p0": p0, "p1": p1}

    def fixed(node):
        return lin(alg.atom(node), {})

    def still(s) -> bool:
        return bool(s.get("na")) or not s["p1"]

    memo: Dict[int, Any] = {}
    # one memo per `self` reading; the reading is held beside it so its id stays unique
    self_memos: Dict[int, tuple] = {}

    def walk(node, self_, depth):
        if depth > _BI_MAX_DEPTH or not isinstance(node, dict):
            raise _BarIndexUnprovable()
        seen = memo if self_ is None else self_memos.setdefault(id(self_), (self_, {}))[1]
        if id(node) in seen:
            return seen[id(node)]
        out = visit(node, self_, depth)
        seen[id(node)] = out
        return out

    def visit(node, self_, depth):
        def sub(x):
            return walk(x, self_, depth + 1)
        args = node.get("args") if isinstance(node.get("args"), list) else []
        kind = node.get("type")
        if kind == "num":
            v = node.get("value")
            ok = isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
            return lin(alg.constant(v), {}) if ok else NA
        if kind in ("str", "symtext"):
            return fixed(node)
        if kind == "series":
            if self_ is not None and self_["name"] == node.get("name"):
                return self_["sym"]
            if node.get("name") in BAR_INDEX_LEAVES:
                return lin(alg.atom(node), alg.constant(1))
            return fixed(node)
        if kind == "offset":
            x = sub(args[0])
            if x.get("na"):
                return NA

            def wrap(t):
                return {"type": "offset", "value": node.get("value"), "args": [t]}
            return lin(alg.linear(x["p0"], wrap, 1), alg.linear(x["p1"], wrap, 1))
        if kind in ("tf", "tf_live", "sym", "textop"):
            for a in args:
                if not still(sub(a)):
                    raise _BarIndexUnprovable()
            return fixed(node)
        if kind == "op":
            return visit_op(node, args, sub, self_)
        if kind == "call":
            return visit_call(node, args, sub, self_, depth)
        raise _BarIndexUnprovable()

    def visit_op(node, args, sub, self_):
        if _bi_is_na_literal(node):
            return NA
        name = node.get("name")
        if name == "u-":
            x = sub(args[0])
            return NA if x.get("na") else lin(alg.scale(x["p0"], -1), alg.scale(x["p1"], -1))
        if name in ("+", "-"):
            a, b = sub(args[0]), sub(args[1])
            if a.get("na") or b.get("na"):
                return NA
            s = 1.0 if name == "+" else -1.0
            return lin(alg.add(a["p0"], b["p0"], s), alg.add(a["p1"], b["p1"], s))
        if name == "*":
            a, b = sub(args[0]), sub(args[1])
            if a.get("na") or b.get("na"):
                return NA
            if a["p1"] and b["p1"]:
                raise _BarIndexUnprovable()                    # a D**2 term
            return lin(alg.mul(a["p0"], b["p0"]),
                       alg.add(alg.mul(a["p1"], b["p0"]), alg.mul(a["p0"], b["p1"])))
        if name == "/":
            a, b = sub(args[0]), sub(args[1])
            if a.get("na") or b.get("na"):
                return NA
            if b["p1"]:
                raise _BarIndexUnprovable()
            r = alg.reciprocal(b["p0"], args[1])
            return lin(alg.mul(a["p0"], r), alg.mul(a["p1"], r))
        if name in _BI_COMPARISONS:
            a, b = sub(args[0]), sub(args[1])
            if a.get("na") or b.get("na"):
                return fixed(node)
            if alg.equal(a["p1"], b["p1"]):
                return fixed(node)
            gap = alg.add(a["p1"], b["p1"], -1)
            if name in ("==", "!=") or not alg.is_constant(gap):
                raise _BarIndexUnprovable()
            if self_ is not None and _bi_reads_binding(node, self_["name"]):
                raise _BarIndexUnprovable()
            if not any(t[0] is node for t in thresholds):
                thresholds.append((node, 1 if alg.constant_of(gap) > 0 else -1))
            return fixed(node)
        if name in _BI_LOGICAL:
            for a in args:
                if not still(sub(a)):
                    raise _BarIndexUnprovable()
            return fixed(node)
        if name == "?:":
            if not still(sub(args[0])):
                raise _BarIndexUnprovable()
            y, e = sub(args[1]), sub(args[2])
            if y.get("na") and e.get("na"):
                return NA
            if y.get("na"):
                return lin(alg.atom(node), e["p1"])
            if e.get("na"):
                return lin(alg.atom(node), y["p1"])
            if not alg.equal(y["p1"], e["p1"]):
                raise _BarIndexUnprovable()
            return lin(alg.atom(node), y["p1"])
        raise _BarIndexUnprovable()

    def literal_period(node):
        if isinstance(node, dict) and node.get("type") == "num":
            v = node.get("value")
            if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
                return v
        return None

    def visit_call(node, args, sub, self_, depth):
        name = node.get("name")
        rec = RECURRENCES.get(name) if isinstance(name, str) else None
        if rec is not None:
            seed_at, body_at, binds = rec["seed"], rec["body"], rec["binds"]
            for i, a in enumerate(args):
                if i != seed_at and i != body_at and not still(sub(a)):
                    raise _BarIndexUnprovable()
            seed = sub(args[seed_at])
            bind_name = {"type": "series", "name": binds}

            def fits(s, p1):
                return bool(s.get("na")) or alg.equal(s["p1"], p1)
            for p1 in ({}, alg.constant(1)):
                kept = len(thresholds)
                try:
                    body = walk(args[body_at], {"name": binds, "sym": lin(alg.atom(bind_name), p1)}, depth + 1)
                except _BarIndexUnprovable:
                    del thresholds[kept:]
                    continue
                if not fits(body, p1) or not fits(seed, p1):
                    del thresholds[kept:]
                    continue
                if body.get("na") and seed.get("na"):
                    return NA
                return lin(alg.atom(node), p1)
            # an index once written: a plain-number seed, and every write an index
            if not seed.get("na") and not seed["p1"] and alg.is_constant(seed["p0"]):
                kept = len(thresholds)
                try:
                    body = walk(args[body_at],
                                {"name": binds, "sym": lin(alg.atom(bind_name), alg.constant(1))}, depth + 1)
                except _BarIndexUnprovable:
                    del thresholds[kept:]
                    raise
                if not body.get("na") and alg.equal(body["p1"], alg.constant(1)):
                    return lin(alg.atom(node), body["p1"])
                del thresholds[kept:]
            raise _BarIndexUnprovable()
        if name == "na":
            sub(args[0])
            return fixed(node)
        if name == "nz":
            x = sub(args[0])
            y = sub(args[1]) if len(args) > 1 else lin({}, {})
            if x.get("na"):
                return y
            if y.get("na") or not alg.equal(x["p1"], y["p1"]):
                raise _BarIndexUnprovable()
            return lin(alg.atom(node), x["p1"])
        if name in ("max", "min"):
            a, b = sub(args[0]), sub(args[1])
            if a.get("na") or b.get("na") or not alg.equal(a["p1"], b["p1"]):
                raise _BarIndexUnprovable()
            return lin(alg.atom(node), a["p1"])
        if name in _BI_LINEAR_CALLS:
            x = sub(args[0])
            for a in args[1:]:
                if not still(sub(a)):
                    raise _BarIndexUnprovable()
            if x.get("na"):
                return NA
            one = literal_period(args[1]) if _BI_LINEAR_CALLS[name] == "period" else _BI_LINEAR_CALLS[name]
            if one is None:
                raise _BarIndexUnprovable()

            def wrap(t):
                return {"type": "call", "name": name, "args": [t] + list(args[1:])}
            return lin(alg.linear(x["p0"], wrap, one), alg.linear(x["p1"], wrap, one))
        if name in _BI_SHIFT_INVARIANT_CALLS:
            x = sub(args[0])
            for a in args[1:]:
                if not still(sub(a)):
                    raise _BarIndexUnprovable()
            if not x.get("na") and not alg.is_constant(x["p1"]):
                raise _BarIndexUnprovable()
            return fixed(node)
        if name in _BI_SHIFT_EQUIVARIANT_CALLS:
            at = _BI_SHIFT_EQUIVARIANT_CALLS[name]
            for i, a in enumerate(args):
                if i != at and not still(sub(a)):
                    raise _BarIndexUnprovable()
            x = sub(args[at])
            if x.get("na"):
                return NA
            if not alg.is_constant(x["p1"]):
                raise _BarIndexUnprovable()
            return lin(alg.atom(node), x["p1"])
        if name in _BI_WHOLE_SHIFT_CALLS:
            x = sub(args[0])
            if x.get("na"):
                return NA
            c = alg.constant_of(x["p1"]) if alg.is_constant(x["p1"]) else None
            if c is None or c != math.floor(c):
                raise _BarIndexUnprovable()
            return lin(alg.atom(node), x["p1"])
        if name in ("crossOver", "crossUnder"):
            a, b = sub(args[0]), sub(args[1])
            if a.get("na") or b.get("na"):
                return fixed(node)
            if not alg.equal(a["p1"], b["p1"]):
                raise _BarIndexUnprovable()
            return fixed(node)
        for a in args:
            if not still(sub(a)):
                raise _BarIndexUnprovable()
        return fixed(node)

    try:
        root = walk(tree, None, 0)
    except _BarIndexUnprovable:
        return {"cls": "dep", "thresholds": []}
    if root.get("na") or not root["p1"]:
        return {"cls": "inv", "thresholds": thresholds}
    pos = alg.is_constant(root["p1"]) and abs(alg.constant_of(root["p1"]) - 1) < _BI_EPS
    return {"cls": "pos", "thresholds": thresholds} if pos else {"cls": "dep", "thresholds": []}


def threshold_unknown(op: str, sign: int, gap: float) -> bool:
    """``barIndexShift.js::thresholdUnknown`` -- is this lane's answer to an
    ordering test one TradingView may not share, for some ``D >= 0``?"""
    if gap is None or math.isnan(gap) or math.isinf(gap):
        return False
    up = sign > 0
    if op == ">":
        return gap <= 0 if up else gap > 0
    if op == ">=":
        return gap < 0 if up else gap >= 0
    if op == "<":
        return gap < 0 if up else gap >= 0
    if op == "<=":
        return gap <= 0 if up else gap > 0
    return True
