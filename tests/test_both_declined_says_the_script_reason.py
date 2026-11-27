"""When the formula turn and the script turn both decline, the member is told the script turn's reason (2026-11-26).

The write-capability probe (live, admin measurement only): "Plot annual (fiscal year) net income as columns in a pane
below" -- the formula turn declined with a sentence that is false for the product ("Fundamental data ... isn't available
here -- I can only build formulas from the chart's own price and volume bars"), the script fallback declined too, and the
member was shown the formula's sentence, while the same run built quarterly revenue growth and trailing EPS on the
script lane. Coordinator's ruling: the script turn's own reason is the answer. Held here, with that request as the case;
and the controls: a script failure that is not a decline in the model's words leaves the formula's answer standing.
No paid calls.
"""
from __future__ import annotations

import json

from api.services import script_conversation as sc
from tests.test_p2_truth_server import conv, emits, env, model, prose  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_script_conversation import ask, lane, writes  # noqa: F401 -- fixtures by name

THE_REQUEST = "Plot annual (fiscal year) net income as columns in a pane below."
FALSE_FOR_THE_PRODUCT = ("Fundamental data such as annual net income isn't available here \u2014 I can only build formulas "
                         "from the chart's own price and volume bars, so there's no earnings or income figure to plot.")
THE_SCRIPTS_REASON = ("Annual (fiscal-year) net income is not one of the figures this engine serves; quarterly revenue and "
                      "trailing-twelve-month EPS are, if one of those would do.")


def test_THE_CASE_the_false_formula_sentence_never_reaches_the_member(conv, clean_env, model, lane):
    client = model([emits(env(0, [], disposition="unsupported", reply=FALSE_FOR_THE_PRODUCT)),
                    writes(disposition="unsupported", reply=THE_SCRIPTS_REASON)])
    r = ask(conv, THE_REQUEST)
    assert [c["tools"][0]["name"] for c in client.calls] == [conv.TOOL_NAME, sc.TOOL_NAME]
    assert r["ok"] is False and r["gate"] == sc.DECLINED_GATE and r["disposition"] == "unsupported"
    assert r["reason"] == THE_SCRIPTS_REASON
    assert "isn't available here" not in json.dumps(r, ensure_ascii=False)


def test_CONTROL_a_script_with_no_answer_leaves_the_formula_answer_standing(conv, clean_env, model, lane):
    client = model([emits(env(0, [], disposition="unsupported", reply="A formula cannot hold that.")),
                    prose("I am not sure."), prose("Still not sure.")])
    r = ask(conv, THE_REQUEST)
    assert len(client.calls) >= 2
    assert r.get("gate") != sc.DECLINED_GATE and r.get("reply") == "A formula cannot hold that."


def test_CONTROL_a_decline_with_no_words_of_its_own_says_nothing_new(conv, clean_env, model, lane):
    model([emits(env(0, [], disposition="unsupported", reply="A formula cannot hold that.")),
           writes(disposition="unsupported", reply="")])
    r = ask(conv, THE_REQUEST)
    assert r.get("gate") != sc.DECLINED_GATE and r.get("reply") == "A formula cannot hold that."
    assert conv.said_why({"gate": sc.DECLINED_GATE, "reason": sc.REASONS[sc.DECLINED_GATE]}) is False
    assert conv.said_why({"gate": sc.DECLINED_GATE, "reason": THE_SCRIPTS_REASON}) is True
    assert conv.said_why({"gate": sc.ROUNDS_GATE, "reason": "anything"}) is False
