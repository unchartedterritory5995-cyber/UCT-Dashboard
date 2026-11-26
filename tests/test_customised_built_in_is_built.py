"""A built-in asked for with its look changed is BUILT, never answered with the one-tap offer (2026-11-26).

The fifty-set probe (live, admin measurement only): "In a pane below, plot Bollinger %B (20, 2) as a histogram, green above
1, red below 0, gray otherwise, with dashed lines at 0 and 1" got the one-tap offer of the stock built-in, with no model
call, and the member's histogram, colours and dashed lines were dropped. Held here: such a request is not offered, and with
the script lane open the script turn builds it first, saying no checked reference stands behind it. The reverse control:
the bare name, a placement and settings numbers still get the offer. No paid calls.
"""
from __future__ import annotations

import pytest

from api.services import pine_authoring
from api.services import script_conversation as sc
from tests.test_p2_truth_server import conv, model  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_script_conversation import ask, lane, writes  # noqa: F401 -- fixtures by name

CHART = {"sym": "NVDA", "tf": "D"}
THE_REQUEST = ("In a pane below, plot Bollinger %B (20, 2) as a histogram, green above 1, red below 0, gray otherwise, "
               "with dashed lines at 0 and 1.")
CUSTOMISED = [THE_REQUEST, "Plot ATR Bands in orange with dashed lines", "Bollinger %B with horizontal lines at 0.2 and 0.8",
              "Add Historical Volatility as a histogram"]
BARE = ["Bollinger %B", "Add Bollinger %B", "Show Bollinger %B in a pane below", "Bollinger %B 20 2", "Add ATR Bands",
        "Add Historical Volatility"]


@pytest.mark.parametrize("words", CUSTOMISED)
def test_a_customised_built_in_is_not_offered(conv, words):
    u = conv.understand_turn(words, CHART)
    assert u["refusal"] is not None and "built_in" not in u and u.get("customised_built_in"), words
    assert conv.customised_built_in(words, CHART) is True


@pytest.mark.parametrize("words", BARE)
def test_CONTROL_the_bare_name_is_still_offered(conv, words):
    u = conv.understand_turn(words, CHART)
    assert u.get("built_in") is not None and not u.get("customised_built_in"), words
    assert conv.customised_built_in(words, CHART) is False


def test_the_request_found_live_is_built_by_the_script_turn_and_says_it_is_unchecked(conv, clean_env, model, lane):
    client = model([writes(reply="This plots Bollinger %B as a coloured histogram with dashed lines at 0 and 1.")])
    r = ask(conv, THE_REQUEST, addable=["bbPercentB"])           # the browser COULD add the built-in: still built
    assert [c["tools"][0]["name"] for c in client.calls] == [sc.TOOL_NAME]
    assert r["ok"] is True and r["turn"] == "script" and "offer" not in r
    assert r["reply"].endswith(pine_authoring.UNCHECKED_LINE)


def test_CONTROL_the_bare_name_is_offered_with_no_model_call(conv, clean_env, model, lane):
    client = model([])
    r = ask(conv, "Add Bollinger %B", addable=["bbPercentB"])
    assert client.calls == [] and r["turn"] == "offer" and r.get("offer")
