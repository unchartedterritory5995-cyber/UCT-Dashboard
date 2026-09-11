# -*- coding: utf-8 -*-
"""RULING K, the Python half — a crash must never be counted as a refusal.

⚰️ WHY THIS EXISTS. The JS door shipped
``guard: err instanceof TableRefusal ? err.guard : 'canonicalise:node'``, so any
exception that was not a refusal was relabelled as one and a stack overflow
reached the member as "I don't recognise this node shape". A laundered crash is
invisible: it is ``ok: False``, it carries a guard name, and every census counts
it as refused.

⭐ THE PYTHON LANE ALREADY GETS THIS RIGHT — ``_refusal_of`` attributes with
``getattr(exc, "guard", None)``, so a crash yields ``None``, and its own docstring
says ``None`` means *"this function could not attribute it, which is a different
sentence from naming the wrong one"*. What was missing was a RAIL saying so, and
an unrailed correct behaviour is one refactor from being a wrong one.

⛔ SO THIS IS NOT A TEST OF A NEW FIX. It is the mirror of the JS contract, on the
side that already held it (`lesson_rail_the_mirror_not_just_the_lane`).
"""

import pytest

from api.services import indicator_alert_service as ias
from api.services import alert_user_series as aus
from api.services import ast_interpret


DEF_ID = "def_k_rail"


def _drive(monkeypatch, boom):
    """Run `_refusal_of` with `_gate_lane` raising whatever `boom` is."""
    def _raise(_row):
        raise boom
    monkeypatch.setattr(aus, "_gate_lane", _raise)
    return ias._refusal_of({"def_id": DEF_ID}, DEF_ID)


def test_a_REFUSAL_is_attributed_to_its_own_door(monkeypatch):
    """The positive half: a real refusal keeps its guard."""
    guard = "interpret:node"
    door, sentence = _drive(monkeypatch, ast_interpret.TableRefusal(guard, "nope"))
    assert door == guard, f"a refusal lost its door: {door!r}"
    assert "nope" in sentence


@pytest.mark.parametrize("boom", [
    RecursionError("maximum recursion depth exceeded"),
    TypeError("'NoneType' object is not subscriptable"),
    ValueError("something the engine did not expect"),
])
def test_a_CRASH_is_attributed_to_NO_door(monkeypatch, boom):
    """⛔⛔ THE RULING. A crash has no guard, so it names no door.

    ``None`` is the honest answer — "we could not attribute this". Any guard name
    here would be a sentence about the MEMBER'S formula for a fault in ours, and
    downstream it would be counted as a refusal.
    """
    door, sentence = _drive(monkeypatch, boom)
    assert door is None, (
        f"a {type(boom).__name__} was attributed to the door {door!r}. A crash is "
        f"not a refusal: there is no guard name that makes 'the engine broke' true.")
    # ⭐ AND THE ORIGINAL MESSAGE SURVIVES — it is the only description of what
    # actually went wrong, so a rewritten one loses the whole diagnosis.
    assert str(boom) in sentence


def test_the_rail_is_not_vacuous_the_two_arms_DIFFER(monkeypatch):
    """⛔ THE CONTROL. If `_refusal_of` returned `None` for everything, the crash
    test above would pass while attributing nothing at all — so the two arms must
    be shown to give different answers on the same code path.
    """
    refused, _ = _drive(monkeypatch, ast_interpret.TableRefusal("resolve:name", "x"))
    crashed, _ = _drive(monkeypatch, TypeError("x"))
    assert refused is not None
    assert crashed is None
    assert refused != crashed


def test_an_exception_carrying_a_guard_is_treated_as_a_refusal(monkeypatch):
    """⭐ THE FIELD IS THE CONTRACT, not the class.

    This engine has SEVEN refusal classes (two of them both called
    `TableRefusal`), each with its own `name` and all carrying `guard`. An
    `isinstance` check against any one of them would relabel the other six — the
    same laundering, one class identity along. Attribution reads the FIELD.
    """
    class SomeOtherDoorRefusal(Exception):
        def __init__(self, guard, msg):
            super().__init__(msg)
            self.guard = guard

    door, _ = _drive(monkeypatch, SomeOtherDoorRefusal("pine:node", "a door we did not enumerate"))
    assert door == "pine:node"
