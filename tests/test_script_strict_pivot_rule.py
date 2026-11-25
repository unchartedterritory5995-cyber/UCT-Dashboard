"""STRICT WORDS ON BOTH SIDES OF A BAR ARE NOT ta.pivothigh (rule 15 of the script assistant's contract, 2026-11-25).

⚰️ MEASURED live on engine 96 (2026-11-25): cap-03 ("a swing high is a bar whose high is above the highs of the 3 bars
before it and the 3 bars after it") came back as scripts, 6 of 6 right by the case's rule on the script lane's bars,
and 2 of the 6 used `ta.pivothigh(high, 3, 3)` while their reply called the rule "strictly above". The engine's
pivothigh is TradingView-exact and admits a high EQUAL to one of the bars before it: the reply said something false,
and the value is right only where the chart holds no such tie (the script lane's tie edge, unit 2, is what shows it).

Held here, with no model call: the rule is in the contract once, numbered after rule 14, says what the functions
admit, how to write strict words out (the bar N back, `>` on both sides, known on this bar), that it comes before rule
10, and that a reply using the functions never calls them strict. What the assistant then writes is measured live.
"""
from __future__ import annotations

from api.services import pine_authoring as pa


def test_the_rule_is_in_the_contract_once_after_rule_14():
    c = pa.contract()
    assert c.count(pa.STRICT_PIVOT_RULE) == 1
    assert "\n15. " + pa.STRICT_PIVOT_RULE in c
    assert c.index("\n14. ") < c.index("\n15. ")
    assert "{strict_pivot}" not in c


def test_the_rule_says_what_the_functions_admit_and_how_strict_words_are_written():
    rule = pa.STRICT_PIVOT_RULE
    for part in ("`ta.pivothigh` / `ta.pivotlow`: those admit a bar EQUAL to one of the bars before it",
                 "write the comparisons yourself, on the bar N back, known on this bar",
                 "`high[N] > high[N + k]` and `high[N] > high[N - k]` for every k from 1 to N",
                 "This comes before rule 10",
                 "never call its rule strict in `reply`"):
        assert part in rule, part
    assert ">=" not in rule.split("If you do use")[0]                     # the written-out form is strict


def test_rule_10_is_still_there_and_still_says_call_pines_own_function():
    c = pa.contract()
    assert "\n10. For a well-known indicator, when this document lists Pine's OWN function for it, CALL that function" in c
