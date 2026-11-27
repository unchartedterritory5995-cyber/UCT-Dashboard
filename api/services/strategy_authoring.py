"""⭐⭐ THE ASSISTANT WRITES STRATEGIES, HELD TO THE BROKER RULES UCT HAS PINNED (2026-11-26, coordinator ruling 1, step 2).

The engine runs `strategy()` scripts: the broker (`app/.../engine/runtime/broker.js`) serves a behaviour only when a
MATCHing TradingView capture pins it (`brokerPins.resolved.json`, the ledger the broker itself reads), and a run that
REACHES an unpinned rule stops there by name (`runtime:strategy-unpinned`). Until now the assistant never wrote one
(`pine_authoring`'s rule 1). Now, on a strategy request only, the script turn is told:

  * the order calls the engine runs -- `pine.js::STRATEGY_ORDER_CALLS`, read through `pine_capabilities`;
  * the broker behaviours it may rely on -- every rule of `brokerRules.js::BROKER_RULES` the ledger pins, in the
    engine's own words (`what`);
  * the behaviours it may NOT rely on -- every rule the ledger does not pin -- and that a request needing one is
    answered `unsupported`, naming the rule.

NOTHING IS RESTATED: the three lists are READ from the engine's files on first use, so a pin landing moves this brief
with no edit here. And the brief is only half: the browser runs every written strategy through the census predicate
(`builder/authoring/strategyGate.js`) before it is offered, so a strategy the broker would refuse is never offered as
built, whatever the brief said. When that gate refuses for an unpinned rule, the refusal comes back marked
(`STRATEGY_WALL_MARK`) and is answered by name with no repair round: the request needs a rule UCT has not confirmed.
"""
from __future__ import annotations

import functools
import json
import os
import re
from typing import Any, Dict, FrozenSet, List, Mapping, Optional, Tuple

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_RUNTIME = os.path.join(_ROOT, "app", "src", "components", "chart", "engine", "runtime")
BROKER_RULES_JS = os.path.join(_RUNTIME, "brokerRules.js")
PINS_RESOLVED = os.path.join(_RUNTIME, "brokerPins.resolved.json")

#: The mark a strategy refusal carries back from the browser (`strategyGate.js::STRATEGY_WALL_MARK`).
STRATEGY_WALL_MARK = "strategy-wall"
#: The broker's guard for a rule no capture pins (`brokerRules.js::UNPINNED_GUARD`).
UNPINNED_GUARD = "runtime:strategy-unpinned"

_RULE = re.compile(r"'(B-[A-Z0-9-]+)'\s*:\s*Object\.freeze\(\{\s*capture:\s*(?:'([^']*)'|null)\s*,\s*what:\s*'((?:[^'\\]|\\.)*)'")


@functools.lru_cache(maxsize=1)
def broker_rules() -> Mapping[str, str]:
    """{rule id: what it does}, read from `brokerRules.js::BROKER_RULES`, in the engine's words."""
    src = open(BROKER_RULES_JS, encoding="utf-8").read()
    body = src.split("export const BROKER_RULES", 1)
    if len(body) != 2:
        raise RuntimeError(f"BROKER_RULES not found in {BROKER_RULES_JS}")
    rules = {m.group(1): m.group(3).replace("\\'", "'") for m in _RULE.finditer(body[1])}
    if len(rules) < 20:
        raise RuntimeError(f"only {len(rules)} broker rules read from {BROKER_RULES_JS}: the reader is broken")
    return rules


@functools.lru_cache(maxsize=1)
def pinned_rules() -> FrozenSet[str]:
    """The rules the ledger the broker reads pins (`brokerPins.resolved.json`, `.rules`)."""
    data = json.load(open(PINS_RESOLVED, encoding="utf-8"))
    rules = data.get("rules") if isinstance(data, Mapping) else None
    if not isinstance(rules, Mapping) or not rules:
        raise RuntimeError(f"no pinned rules in {PINS_RESOLVED}")
    return frozenset(rules)


def order_calls() -> List[str]:
    """The order calls the engine runs (`pine.js::STRATEGY_ORDER_CALLS`)."""
    from api.services import pine_capabilities
    return sorted(pine_capabilities.strategy_orders())


def strategy_brief() -> str:
    """What the script turn is told on a strategy request (in the request, never the cached document)."""
    rules, pins = broker_rules(), pinned_rules()
    may = [f"  - {rid}: {what}" for rid, what in sorted(rules.items()) if rid in pins]
    may_not = [f"  - {rid}: {what}" for rid, what in sorted(rules.items()) if rid not in pins]
    return "\n".join([
        "THIS IS A STRATEGY REQUEST. Rule 1's \"never `strategy(...)`\" does not apply to it: write ONE Pine v5 "
        "`strategy(\"<name>\", overlay=<true|false>)` script that places the orders the member described.",
        "The order calls this engine runs: " + ", ".join(order_calls()) + ".",
        "Broker behaviours confirmed against TradingView (rely on these):",
        *may,
        "Broker behaviours NOT yet confirmed (a strategy that needs one does not run here). If the request cannot be met "
        "without one of these, answer `unsupported` and name it in `reply`; never write around it silently:",
        *may_not,
        "Keep `strategy(...)` to its title, `overlay`, and settings the confirmed behaviours cover. In `reply`, say in one "
        "or two plain sentences what the strategy buys and sells and which numbers a member can change.",
    ])


def strategy_wall(errors: Any) -> Optional[Tuple[str, Optional[str]]]:
    """(the wall, the unpinned rule or None) when a browser refusal is the strategy gate's, else None."""
    for e in errors or []:
        if not isinstance(e, str) or not e.startswith(STRATEGY_WALL_MARK + " "):
            continue
        wall = e[len(STRATEGY_WALL_MARK) + 1:].split(" ", 1)[0].rstrip(":")
        m = re.search(r"run:" + re.escape(UNPINNED_GUARD) + r":(B-[A-Z0-9-]+)", e)
        return wall, (m.group(1) if m else None)
    return None


def unpinned_reply(rule: str) -> str:
    """What a member is told when their strategy needs a broker rule UCT has not confirmed."""
    what = broker_rules().get(rule)
    detail = f" ({rule}: {what})" if what else f" ({rule})"
    return ("This strategy needs a broker behaviour UCT hasn't confirmed against TradingView yet" + detail +
            ", so its backtest isn't offered. Ask for the entry and exit rules as an indicator and the assistant will "
            "mark each signal on your chart.")
