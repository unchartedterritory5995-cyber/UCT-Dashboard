"""A NUMBER IS SPELLED THE SAME WAY BY THE SERVER AND THE BROWSER, or it is refused.

A formula's text is derived from its tree on both sides and compared by hash, so a number the two
languages write differently cannot be allowed through (`definition_concierge._spell_number`).

⚰️ FOUND LIVE, 2026-11-18. To keep a division off zero an assistant writes `0.000001`. Python
writes that number `1e-06`; ECMAScript's `String(n)` writes `0.000001`. The server judged the number
by Python's notation and refused it, the repair turn sent the same number back, and the member got
a failure after two paid calls. The two languages do not disagree about that number at all: both
print the same shortest digits, and only Python's NOTATION switches early (below 0.0001, where the
browser's switches below 0.000001). So between the two the server now writes the digits out, as the
browser does.

Held here:
  * for every number in that range, the server's spelling IS the browser's own `String(n)`, asked of
    the browser's engine (node), and reads back as the same number;
  * below 0.000001 both lanes use an exponent, which the formula language does not read: still
    refused, and the refusal says what to write instead;
  * through the door, a tree holding 0.000001 is accepted and one holding 0.0000001 is refused.
"""
from __future__ import annotations

import json
import math
import shutil
import subprocess

import pytest

from api.services import definition_concierge as dc
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num, op,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

S = lambda n: {"type": "series", "name": n}  # noqa: E731

#: Numbers Python writes with an exponent and the browser does not.
BETWEEN = [1e-6, 1.5e-6, 2e-6, 9.99e-6, 1e-5, 2.5e-5, 3e-5, 1e-5 * 3, 7.25e-5, 9.999e-5, 0.1 * 0.0001, 1.0000001e-6]
#: Numbers both already wrote alike.
ALIKE = [0, 1, 20, 1.5, 0.5, 0.0001, 0.00012345, 0.001, 0.02, 123456.789, 1e15, 2.0, 0.1 + 0.2, 2 ** 53 - 1, 2 ** 53]
#: Whole numbers past 2^53: Python prints exact digits, the browser shortest digits and zeros.
TOO_LARGE = [2 ** 53 + 2, 1.2345678901234568e20, 1e21, 1.5e22, 10 ** 30]
#: Numbers the browser itself writes with an exponent: no formula text can hold them.
TOO_SMALL = [1e-7, 9.99e-7, 5e-10, 1e-300]

needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


def test_the_range_python_writes_with_an_exponent_is_spelled_as_plain_decimals():
    assert dc._spell_number(1e-6) == "0.000001" == dc.SMALLEST_SPELLABLE_TEXT and dc.SMALLEST_SPELLABLE == 1e-6
    assert dc._spell_number(2.5e-5) == "0.000025"
    assert dc._spell_number(9.999e-5) == "0.00009999"
    for value in BETWEEN:
        assert "e" in str(value), value                                    # the trap: Python's own notation
        text = dc._spell_number(value)
        assert dc._SPELLABLE.match(text) and "e" not in text, (value, text)
        assert float(text) == value, (value, text)                         # the same number, read back
    for value in ALIKE:
        assert float(dc._spell_number(value)) == value
    assert dc._spell_number(2.0) == "2" and dc._spell_number(0.5) == "0.5"   # unchanged


@needs_node
def test_the_servers_spelling_is_the_browsers_own():
    """Asked of the browser's engine: `String(n)` for each number, and that its text reads back as
    the number. The server must write exactly that text."""
    values = BETWEEN + ALIKE
    script = ("const v = JSON.parse(process.argv[1]);"
              "console.log(JSON.stringify(v.map((n) => [String(n), Number(String(n)) === n])))")
    res = subprocess.run(["node", "-e", script, json.dumps(values)], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr[-500:]
    browser = json.loads(res.stdout)
    assert len(browser) == len(values)
    for value, (text, reads_back) in zip(values, browser):
        assert reads_back, value
        assert dc._spell_number(value) == text, (value, dc._spell_number(value), text)
    # CONTROL: the comparison can fail. Python's own notation is NOT the browser's in this range.
    assert all(str(value) != text for value, (text, _ok) in zip(BETWEEN, browser[:len(BETWEEN)]))
    # and below the limit the browser itself uses an exponent, which is why those are refused
    res = subprocess.run(["node", "-e", script, json.dumps(TOO_SMALL)], capture_output=True, text=True, timeout=60)
    assert all("e-" in text for text, _ok in json.loads(res.stdout))
    # past 2^53 the two write a whole number differently, which is why those are refused too
    big = [v for v in TOO_LARGE if isinstance(v, float)]
    res = subprocess.run(["node", "-e", script, json.dumps(big)], capture_output=True, text=True, timeout=60)
    assert all(text != str(int(v)) for v, (text, _ok) in zip(big, json.loads(res.stdout)))


@pytest.mark.parametrize("value", TOO_SMALL + TOO_LARGE + [float("nan"), float("inf"), True, None, "3", -5, -0.000001])
def test_what_neither_lane_can_spell_alike_is_still_refused(value):
    with pytest.raises(Exception) as caught:
        dc._spell_number(value)
    assert getattr(caught.value, "gate", None) == "schema:number", (value, caught.value)


def test_the_refusal_for_a_tiny_number_says_what_to_write_instead():
    """The detail is what the assistant's repair turn reads. It used to be "1e-06 spells as '1e-06'",
    which says nothing to do, and the repair repeated the number."""
    with pytest.raises(Exception) as caught:
        dc._spell_number(1e-7)
    said = str(getattr(caught.value, "detail", caught.value))
    assert "plain decimal no smaller than 0.000001" in said and "no exponent" in said
    assert "test the divisor" in said


def test_through_the_door_a_tree_with_the_small_number_is_accepted_and_a_smaller_one_is_not(conv):
    def build(tiny):
        tree = op("/", op("-", S("close"), S("low")), op("+", op("-", S("high"), S("low")), num(tiny)))
        return env(0, [{"op": "create", "name": "Close in range", "placement": "pane",
                        "outputs": [{"key": "pos", "tree": tree}]}])
    assert conv.check_envelope(build(0.000001), 0, empty_view(0))
    assert conv.check_envelope(build(0.00005), 0, empty_view(0))
    with pytest.raises(Exception) as caught:
        conv.check_envelope(build(0.0000001), 0, empty_view(0))
    assert getattr(caught.value, "gate", None) == "schema:number"
    assert math.isclose(float(dc._spell_number(0.000001)), 1e-6)


CHART = {"sym": "NVDA", "tf": "D"}


def _position(tiny):
    tree = op("/", op("-", S("close"), S("low")), op("+", op("-", S("high"), S("low")), num(tiny)))
    return env(0, [{"op": "create", "name": "Close in range", "placement": "pane",
                    "outputs": [{"key": "pos", "tree": tree}]}])


def test_the_whole_turn_the_number_that_failed_live_now_builds_in_one_call(conv, clean_env, model):
    client = model([emits(_position(0.000001))])
    r = conv.converse("Show where the close sits in the bar's range", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1, r


def test_a_smaller_number_is_sent_back_ONCE_with_what_to_write_and_a_repaired_answer_builds(conv, clean_env, model):
    client = model([emits(_position(0.0000001)), emits(_position(0.000001))])
    r = conv.converse("Show where the close sits in the bar's range", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 2, r
    told = str(client.calls[1]["messages"][-1]["content"])
    assert "plain decimal no smaller than 0.000001" in told and "test the divisor" in told


def test_an_answer_that_repeats_the_refused_number_ends_the_turn_by_name_with_no_third_call(conv, clean_env, model):
    """The repair is one call. A second answer carrying the same number is not sent back again: the
    member is told what happened, and nothing is built."""
    client = model([emits(_position(0.0000001)), emits(_position(0.0000001)), emits(_position(0.000001))])
    r = conv.converse("Show where the close sits in the bar's range", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == "schema:number", r
    assert len(client.calls) == 2 == conv.MAX_MODEL_CALLS                    # the third scripted answer is never asked for
    assert r["reason"] == "the UCT Agent wrote a number this formula language cannot spell"

