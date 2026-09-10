"""One definition of "a notable move", derived rather than restated (Seam 3).

`watchlist_intelligence` carried its own `3.0` with a comment saying it
"matches massive.py::get_movers()'s own gap-filter threshold" -- and it did,
by coincidence. Nothing imported anything. Tuning either one would have shipped
two different definitions of a notable move side by side, with the comment
still asserting they agreed.

The load-bearing test is the DERIVATION one: move the constant and the
consumer's behaviour must move with it. An equality assertion between two
module attributes would pass just as happily against two hand-typed copies,
which is the state this replaces.
"""
import ast
import inspect

import pytest


def test_the_consumer_tracks_the_constant_not_a_copy(monkeypatch):
    """THE LOAD-BEARING ONE. Raise the threshold and a 5% move stops being
    notable. A restated literal could not do this."""
    from api.services import massive, watchlist_intelligence as wi

    assert wi._price_move_fact("NVDA", 5.0) is not None, "5% is notable at 3.0"

    monkeypatch.setattr(massive, "MOVER_THRESHOLD_PCT", 10.0)
    assert wi._price_move_fact("NVDA", 5.0) is None, (
        "the consumer is still reading its own copy of the threshold"
    )
    assert wi._price_move_fact("NVDA", 12.0) is not None


def test_the_boundary_is_inclusive_on_the_constant(monkeypatch):
    """Exactly at the threshold counts -- the movers feed's own filter is
    `>= 3.0`, and an off-by-one here would silently disagree with it."""
    from api.services import massive, watchlist_intelligence as wi

    monkeypatch.setattr(massive, "MOVER_THRESHOLD_PCT", 3.0)
    assert wi._price_move_fact("NVDA", 3.0) is not None
    assert wi._price_move_fact("NVDA", -3.0) is not None
    assert wi._price_move_fact("NVDA", 2.99) is None


def test_no_bare_threshold_literal_survives_in_the_movers_code():
    """AST sweep, not a grep. The two mover functions must contain no bare 3.0
    -- and the check is scoped to THEM so the unrelated `connect=3.0` in the
    httpx timeout stays untouched. Same literal, different meaning, which is
    why naming it mattered.
    """
    from api.services import massive

    tree = ast.parse(inspect.getsource(massive))
    targets = {"_fetch_finviz_movers_live", "get_movers"}
    offenders = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name in targets:
            for sub in ast.walk(node):
                if isinstance(sub, ast.Constant) and sub.value in (3.0, -3.0):
                    offenders.append("%s:%s" % (node.name, sub.lineno))
    assert offenders == [], (
        "a bare mover threshold came back at: %s" % ", ".join(offenders)
    )


def test_the_constant_exists_and_is_a_number():
    from api.services import massive
    assert isinstance(massive.MOVER_THRESHOLD_PCT, (int, float))
    assert massive.MOVER_THRESHOLD_PCT > 0


def test_the_httpx_timeout_literal_is_deliberately_untouched():
    """Non-vacuity for the sweep above: a 3.0 DOES still exist in this module,
    so the test is not passing because the number vanished everywhere."""
    from api.services import massive

    src = inspect.getsource(massive)
    assert "connect=3.0" in src, (
        "if this ever changes, the AST sweep above lost its control"
    )
