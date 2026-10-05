"""F9 -- ``ta.wma`` first answers on its n-th FINITE input (rule A), Python twin.

CAP4 ``vw-rt8-runtime-followups-rddt-1d-2026-10-04`` (Q-RT8a): W01 first on bar 26,
W03 on bar 58. The JS twin and the same trees/bars:
``app/src/components/chart/engine/ast/f9WmaRuleA.test.js``.
"""
import math
from datetime import date, timedelta

from api.services import ast_interpret

N = 80


def _bars():
    out = []
    for i in range(N):
        c = 50 + (i % 7) * 1.5 + i * 0.1
        t = (date(2025, 1, 6) + timedelta(days=i)).isoformat()
        out.append({"t": t, "o": c - 0.5, "h": c + 1, "l": c - 1, "c": c, "v": 1000})
    return out


def num(v):
    return {"type": "num", "value": v}


NA = {"type": "op", "name": "/", "args": [num(0), num(0)]}
BI = {"type": "series", "name": "barindex"}
CLOSE = {"type": "series", "name": "close"}


def lt(k):
    return {"type": "op", "name": "<", "args": [BI, num(k)]}


def eq(k):
    return {"type": "op", "name": "==", "args": [BI, num(k)]}


def tern(c, a, b):
    return {"type": "op", "name": "?:", "args": [c, a, b]}


def wma(x, n):
    return {"type": "call", "name": "wma", "args": [x, num(n)]}


def _first_finite(col):
    for i, v in enumerate(col):
        if v is not None and isinstance(v, (int, float)) and math.isfinite(v):
            return i
    return -1


def test_w01_first_answer_on_the_tenth_finite_input():
    col = ast_interpret.interpret(wma(tern(lt(3), CLOSE, tern(lt(20), NA, CLOSE)), 10), _bars())
    assert _first_finite(col) == 26


def test_w03_first_answer_on_bar_58():
    col = ast_interpret.interpret(wma(tern(eq(0), num(0), tern(lt(50), NA, CLOSE)), 10), _bars())
    assert _first_finite(col) == 58


def test_control_finite_from_bar_0_answers_on_n_minus_1():
    col = ast_interpret.interpret(wma(CLOSE, 10), _bars())
    assert _first_finite(col) == 9
