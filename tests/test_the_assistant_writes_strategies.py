"""The assistant writes strategies, held to the pinned broker rules (2026-11-26, coordinator ruling 1, step 2).

A strategy request goes to the script lane FIRST with its brief (the order calls and the broker behaviours confirmed /
not confirmed, read from the engine), and a `strategy(...)` answer is offered for the browser's gate (#2861) to check.
When the gate refuses for an unpinned rule, the refusal is answered BY NAME with no repair and no call. A request that
is not a strategy still never gets one; a member's own pasted strategy goes to the gate as written. No paid calls.
"""
from __future__ import annotations

from api.services import script_conversation as sc
from api.services import strategy_authoring as sa
from tests.test_p2_truth_server import conv, emits, env, model  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_script_conversation import GOOD, TABLE_REQUEST, ask, lane, writes  # noqa: F401 -- fixtures by name

W26 = ("Backtest a strategy that buys when the 20 EMA crosses above the 50 EMA and sells when it crosses below, "
       "with a 7% stop loss.")
STRATEGY = ('//@version=5\nstrategy("EMA 20/50 cross", overlay=true)\nf = ta.ema(close, 20)\ns = ta.ema(close, 50)\n'
            'if ta.crossover(f, s)\n    strategy.entry("Long", strategy.long)\n'
            'if ta.crossunder(f, s)\n    strategy.close("Long")\n')


def sent(call):
    return str(call["messages"][0]["content"])


def test_a_strategy_request_is_written_as_a_strategy_on_the_script_lane_first(conv, clean_env, model, lane):
    client = model([writes(pine=STRATEGY, name="EMA 20/50 cross", reply="Buys when the 20 EMA crosses above the 50 EMA.")])
    r = ask(conv, W26)
    assert [c["tools"][0]["name"] for c in client.calls] == [sc.TOOL_NAME]           # no formula turn first
    assert "THIS IS A STRATEGY REQUEST" in sent(client.calls[0])
    assert all(f"  - {rid}: " in sent(client.calls[0]) for rid in sa.pinned_rules())   # the brief, derived
    assert r["ok"] is True and r["turn"] == "script" and r["script"]["pine"] == STRATEGY
    assert "doesn't write strategies" not in r["reply"] and "strategy tester" not in r["reply"]


def test_a_gate_refusal_for_an_unpinned_rule_is_answered_by_name_with_no_call(conv, clean_env, model, lane):
    rule = sorted(set(sa.broker_rules()) - sa.pinned_rules())[0]
    client = model([])
    r = ask(conv, W26, script_refusal={"pine": STRATEGY, "round": 1, "errors": [
        f"strategy-wall run:runtime:strategy-unpinned:{rule}: the broker rule {rule} is not pinned by a matching capture"]})
    assert client.calls == []
    assert r["ok"] is False and r["gate"] == sc.STRATEGY_WALL_GATE
    assert rule in r["reason"] and sa.broker_rules()[rule] in r["reason"]


def test_a_gate_refusal_of_another_kind_is_answered_with_the_brokers_sentence(conv, clean_env, model, lane):
    client = model([])
    r = ask(conv, W26, script_refusal={"pine": STRATEGY, "round": 1, "errors": [
        "strategy-wall run:runtime:strategy-start: the backtest cannot start at this symbol's listing on this chart"]})
    assert client.calls == [] and r["gate"] == sc.STRATEGY_WALL_GATE
    assert "cannot start at this symbol's listing" in r["reason"]


def test_CONTROL_a_request_that_is_not_a_strategy_never_gets_one(conv, clean_env, model, lane):
    client = model([writes(pine=STRATEGY), writes()])
    r = ask(conv, TABLE_REQUEST)
    assert len(client.calls) == 2                                                     # the strategy went back for repair
    assert "THIS IS A STRATEGY REQUEST" not in sent(client.calls[0])
    assert r["ok"] is True and r["script"]["pine"] == GOOD


def test_a_members_own_pasted_strategy_goes_to_the_gate_as_written(conv, clean_env, model, lane):
    client = model([])
    r = ask(conv, STRATEGY)
    assert client.calls == []
    assert r["ok"] is True and r["turn"] == "script" and r["script"]["pine"].strip() == STRATEGY.strip()
