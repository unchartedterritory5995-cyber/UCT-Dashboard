"""The strategy brief is DERIVED from the engine's own files, and a gate refusal is read by name (2026-11-26, step 2).

Coordinator's ruling 1, step 2: the assistant writes `strategy()` scripts held to the broker rules UCT has PINNED, and a
request needing an unpinned rule is refused naming the rule. The brief the script turn reads lists the order calls the
engine runs and the broker behaviours confirmed / not confirmed, each READ from the engine (never restated), so a pin
landing moves the brief with no edit. No paid calls.
"""
from __future__ import annotations

import json
import re

import pytest

from api.services import strategy_authoring as sa


def test_the_rules_and_pins_are_read_from_the_engines_own_files():
    rules, pins = sa.broker_rules(), sa.pinned_rules()
    src = open(sa.BROKER_RULES_JS, encoding="utf-8").read().split("export const BROKER_RULES", 1)[1]
    assert set(rules) == set(re.findall(r"'(B-[A-Z0-9-]+)'\s*:\s*Object\.freeze", src))     # every rule, none dropped
    assert pins == set(json.load(open(sa.PINS_RESOLVED, encoding="utf-8"))["rules"])        # the broker's own ledger
    assert pins <= set(rules)                                                               # the ledger names no stranger
    assert pins and set(rules) - pins                                                       # both sides non-empty


def test_the_brief_puts_every_rule_on_its_own_side():
    brief = sa.strategy_brief()
    may, may_not = brief.split("NOT yet confirmed", 1)
    for rid in sa.broker_rules():
        line = f"  - {rid}: "
        if rid in sa.pinned_rules():
            assert line in may and line not in may_not, rid
        else:
            assert line in may_not and line not in may, rid
    for call in sa.order_calls():
        assert call in brief
    assert "strategy.entry" in sa.order_calls() and "strategy.exit" in sa.order_calls()


def test_a_pin_landing_moves_the_brief_with_no_edit(monkeypatch):
    rid = sorted(set(sa.broker_rules()) - sa.pinned_rules())[0]
    before = sa.strategy_brief()
    assert f"  - {rid}: " in before.split("NOT yet confirmed", 1)[1]
    pins = sa.pinned_rules()
    monkeypatch.setattr(sa, "pinned_rules", lambda: frozenset(pins | {rid}))
    after = sa.strategy_brief()
    assert f"  - {rid}: " in after.split("NOT yet confirmed", 1)[0]


@pytest.mark.parametrize("errors,expect", [
    (["strategy-wall run:runtime:strategy-unpinned:B-EXIT-QTY: the broker rule B-EXIT-QTY is not pinned"],
     ("run:runtime:strategy-unpinned:B-EXIT-QTY", "B-EXIT-QTY")),
    (["strategy-wall run:runtime:strategy-start: the backtest cannot start at the listing"], ("run:runtime:strategy-start", None)),
    (["line 3: `ta.foo` is not served"], None),
    ([], None), (None, None),
])
def test_a_gate_refusal_is_read_by_its_mark(errors, expect):
    assert sa.strategy_wall(errors) == expect


def test_the_member_is_told_the_rule_in_the_engines_words():
    rid = sorted(set(sa.broker_rules()) - sa.pinned_rules())[0]
    said = sa.unpinned_reply(rid)
    assert rid in said and sa.broker_rules()[rid] in said
    assert "strategy tester" not in said and "can't backtest" not in said
