"""OVERNIGHT D/E -- the server half of authored chart tables and member inputs.

* set_table / remove_table are contract ops the model may emit (schema-valid);
* a tree may read a member input the indicator (or this turn) DECLARES, as a series
  named by its key; an undeclared name is still refused by the concierge's gate;
* an input may not shadow a formula-language name (scalars included).
Each case states ASKED / CLAIMED / DID.
"""
from __future__ import annotations

import pytest

from tests.test_p2_truth_server import (  # noqa: F401  (pytest fixtures by import)
    CLOSE, call, conv, emits, env, model, num, op, out, view,
)

S = lambda n: {"type": "series", "name": n}  # noqa: E731
INPUTS = [{"key": "account", "label": "Account size", "default": 0},
          {"key": "riskPct", "label": "Risk %", "default": 0, "min": 0, "max": 100}]
RISK = op("/", op("*", S("account"), S("riskPct")), num(100))


def _env(ops):
    return env(0, ops)


def test_a_tree_may_read_an_input_this_turn_declares(conv):
    """ASKED: a calculator output reading `account` and `riskPct`, declared in the same
    create. DID: accepted (the inputs are constants to every gate)."""
    got = conv.check_envelope(_env([{"op": "create", "name": "Calc", "inputs": INPUTS,
                                     "outputs": [{"key": "risk", "tree": RISK, "hidden": True}]}]), 0)
    assert got["ops"][0]["inputs"] == INPUTS


def test_a_tree_may_read_an_input_the_indicator_already_declares(conv):
    v = view(0, [out("risk", RISK, type_="series")])
    v["definition"]["memberInputs"] = [{"key": "account", "type": "float", "default": 0},
                                       {"key": "riskPct", "type": "float", "default": 0}]
    got = conv.check_envelope(env(0, [{"op": "set_output_tree", "output": "risk",
                                       "tree": op("*", RISK, num(2))}]), 0, v)
    assert got["disposition"] == "change"


def test_an_UNDECLARED_name_is_still_refused(conv):
    """ASKED: a tree reading `bogusThing`, declared nowhere. DID: refused by name."""
    with pytest.raises(conv._Refused) as exc:
        conv.check_envelope(_env([{"op": "create", "name": "Calc", "inputs": INPUTS,
                                   "outputs": [{"key": "x", "tree": op("*", S("account"), S("bogusThing"))}]}]), 0)
    assert exc.value.gate == "schema:name"


@pytest.mark.parametrize("key", ["close", "price", "roe", "color"])
def test_an_input_may_not_shadow_a_formula_name(conv, key):
    with pytest.raises(conv._Refused) as exc:
        conv.check_envelope(_env([{"op": "create", "name": "Calc",
                                   "inputs": [{"key": key, "label": "x", "default": 0}],
                                   "outputs": [{"key": "x", "tree": op("*", S(key), num(2))}]}]), 0)
    assert exc.value.gate in ("input:name", "unsupported:scalar")


def test_table_ops_are_contract_ops(conv):
    """ASKED: a create with hidden outputs and a set_table, then a remove_table. DID: valid."""
    got = conv.check_envelope(_env([
        {"op": "create", "name": "ADR", "placement": "price",
         "outputs": [{"key": "adr", "tree": call("sma", op("-", S("high"), S("low")), num(20)), "hidden": True}]},
        {"op": "set_table", "position": "top_right", "cells": [
            {"row": 0, "col": 0, "text": "ADR", "bold": True},
            {"row": 0, "col": 1, "output": "adr", "format": "decimal2"}]}]), 0)
    assert got["ops"][1]["op"] == "set_table"
    assert conv.check_envelope(env(0, [{"op": "remove_table"}]), 0)["ops"] == [{"op": "remove_table"}]
    with pytest.raises(conv._Refused):        # a cell must be text OR an output, not neither
        conv.check_envelope(_env([{"op": "set_table", "cells": [{"row": 0, "col": 0}]}]), 0)


def test_the_prompt_names_tables_and_inputs_and_forbids_inventing_figures(conv):
    p = conv.system_prompt()
    assert "set_table" in p and "set_input" in p
    assert "NEVER invent the member's own figures" in p
