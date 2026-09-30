"""C12r (2026-09-29) — the recurrence work rules, ported to the Python lane.

``interpret.js`` gained two rules the day ``rsi-swing-indicator``'s object trees
were measured at 3-32 s each (``interpretWork.test.js`` holds the JS side):

1. a recurrence BINDS the ``self`` in its own body, so an ``accum`` whose seed
   and warm-up read no outer ``self`` is memoisable like any other column
   (``structural_maps``' ``free_of``);
2. one step evaluates each spine node ONCE — the spine is a DAG, and walking it
   as a tree paid once per path.

``structural_maps`` is a faithful port and the two must not drift, so the same
rules are railed here.
"""
from __future__ import annotations

from api.services import ast_interpret as ai


def _num(v):
    return {"type": "num", "value": v}


def _series(name):
    return {"type": "series", "name": name}


def _op(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


def _accum(seed, body, w):
    return {"type": "call", "name": "accum", "args": [seed, body, _num(w)]}


def _bars(n):
    return [{"t": f"2020-01-{(i % 28) + 1:02d}", "o": 100.0, "h": 102.0, "l": 98.0,
             "c": 101.0 if i % 3 else 99.0, "v": 1.0} for i in range(n)]


def test_an_accumulator_is_free_of_its_own_self():
    body = _op("+", _series("self"), _series("close"))
    acc = _accum(_num(0), body, 20)
    root = _op("*", acc, _num(2))
    id_of, free_of, _ = ai.structural_maps(root)
    assert free_of[id(body)] is False, "the body reads its own running value"
    assert free_of[id(acc)] is True, "…which the accumulator binds"
    assert free_of[id(root)] is True
    # ⛔ CONTROL: a `self` OUTSIDE any recurrence is still free-reading.
    bare = _op("+", _series("self"), _num(1))
    _, free2, _ = ai.structural_maps(bare)
    assert free2[id(bare)] is False


def test_a_shared_spine_steps_once_per_node_and_keeps_its_value():
    # s0 = self, s(k+1) = (s(k) + s(k)) / 2 — the value stays `self`; a tree walk
    # pays 2^12 visits per step over 12,500 steps.
    s = _series("self")
    for _ in range(12):
        s = _op("/", _op("+", s, s), _num(2))
    col = ai.interpret(_accum(_num(1), s, 250), _bars(300), {}, None, None, {"tf": "D"})
    assert col[299] == 1
    assert col[250] == 1
    assert col[249] is None
