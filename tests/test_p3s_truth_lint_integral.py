"""P3S 5D -- an integral float length is that integer in the server linter too.

MEASURED: ``ema(close, 21.0)`` was ``repaints`` ("unanalysable: `ema` declares a
window this linter cannot bound") while ``ema(close, 21)`` was ``non-repainting``.
JSON has one number type: ``lint.js`` reads 21.0 as 21 (``Number.isInteger``), the
interpreter takes it as a length (``float(v).is_integer()``) and this linter's own
bind-foldable fallback already did -- only its literal path refused. A NON-integral
length still fails closed.
"""
import pytest

from api.services import ast_lint

C = {"type": "series", "name": "close"}


def call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def num(v):
    return {"type": "num", "value": v}


@pytest.mark.parametrize("fn", ["ema", "sma", "rsi", "highest", "lowest"])
def test_an_integral_float_length_lints_exactly_like_the_integer(fn):
    a = ast_lint.lint_repaint(call(fn, C, num(21)))
    b = ast_lint.lint_repaint(call(fn, C, num(21.0)))
    assert a["mode"] != "repaints"
    assert b == a


@pytest.mark.parametrize("v", [21.5, float("nan"), "21", True])
def test_a_non_integral_or_non_number_length_still_fails_closed(v):
    assert ast_lint.lint_repaint(call("ema", C, num(v)))["mode"] == "repaints"


def test_a_forward_reach_keeps_its_sign():
    """The literal path serves the FORWARD slot too (negative): -1.0 is -1."""
    a = ast_lint.lint_repaint({"type": "offset", "value": 1, "args": [C]})
    assert a["mode"] == "non-repainting"
