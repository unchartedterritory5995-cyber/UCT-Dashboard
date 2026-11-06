"""The owner's narrow exception to F-16 (2026-11-05): the Agent may operate the Calls Only chip a member already has.

A message that names an options-flow hidden phrase, asks for calls and is shaped like a screen is decided HERE, before the
turn reaches research, knowledge, planner v2 or E-1, and whatever the manifest holds: routing v2's request for these messages
does not carry screener.run, so the F-16 check after the model never runs on them.

    classify()  → None     not this class: the turn runs as ever
                  "refuse" the F-16 sentence, with no model call
                  "clear"  the fixed clearing sentence, with no model call
                  "chip"   ONE model call, no streaming, and only restrict() decides what leaves

The chip path trusts no model text: its envelope is built here from nothing but the chip ops. The only thing the model
contributes is which widget. It holds only when the message says nothing but the widget's name, the word on the chip and the
everyday words around them (FILLER): anything else in it (a universe, a ranking, a threshold, a word nobody listed) is more
than the chip, so it is refused rather than half-done. That is a closed list on purpose, and the browser holds the same one
(app/src/agent/capabilities/screener.js FLOW_CHIP_FILLER; tests/test_uct_agent_f16_calls_control.py pins the two equal).
"""
from __future__ import annotations

import re
from typing import Any, Optional

from api.services.uct_agent.scan import hidden

WIDGET_NAME = "options flow"
FILLER = frozenset("""
    a an and at can could display filter filtered for from get give i in just keep like limit list me my narrow now of on only
    our panel please pls see set show that the this to view want widget will would you
""".split())
CALLS_ONLY_SENTENCE = ("The only Options Flow filter I can set is Calls Only. To clear it, use Undo or the All chip on the "
                       "widget itself.")
_MARGIN_CALL = re.compile(r"\bmargin calls?\b")
_CALLS = re.compile(r"\bcalls\b|\bcall options?\b")
_CLEARING = re.compile(r"\b(?:clear|remove|reset|undo|unset|drop|cancel|stop)\b|\bturn off\b|\btake off\b")
_WORD = re.compile(r"[a-z0-9$%.&'-]+")
_CHIP_VALUES = ("calls", "c")


def says_calls(low: str) -> bool:
    """The word on the chip: "calls" or "call options", never "call up the flow" or "margin call"."""
    return bool(_CALLS.search(_MARGIN_CALL.sub(" ", low)))


def hidden_hits(low: str) -> list:
    """EVERY hidden phrase in the message as (key, words), not the first: a second one must not ride in behind the name."""
    return [(key, m.group(0)) for pat, key in hidden.HIDDEN_PHRASES for m in re.finditer(pat, low)]


def _is_widget_name(words: str) -> bool:
    return re.sub(r"[\s-]+", " ", words).replace("option ", "options ", 1) == WIDGET_NAME


def _flow_widgets(context: Any) -> set:
    entries = context.get("board") if isinstance(context, dict) else None
    return {str(w.get("id")) for b in (entries if isinstance(entries, list) else []) if isinstance(b, dict)
            for w in (b.get("widgets") or []) if isinstance(w, dict) and w.get("type") == "optionsflow"}


def _only_the_chip(low: str) -> bool:
    """Nothing in the message but the widget's name, the chip's word and FILLER."""
    rest = re.sub(r"\boptions?[\s-]flow\b", " ", low)
    rest = _CALLS.sub(" ", rest)
    return all(w.strip(".,!?'") in FILLER for w in _WORD.findall(rest))


def classify(message: Any, context: Any, screen_shaped: bool) -> Optional[str]:
    low = str(message or "").lower().replace("’", "'")
    hits = hidden_hits(low)
    if not any(hidden.refusal_for([key]) == hidden.FLOW_REFUSAL for key, _ in hits) or not says_calls(low):
        return None
    named = all(_is_widget_name(words) for _, words in hits)
    here = bool(_flow_widgets(context))
    if _CLEARING.search(low) and named and here:
        return "clear"
    if not screen_shaped:
        return None
    return "chip" if named and here and _only_the_chip(low) else "refuse"


def restrict(env: Any, context: Any) -> Optional[dict]:
    """The envelope that may leave a chip turn, or None for the F-16 sentence. `env` holds normalized ops. Nothing of the
    model's text, research, question or groups survives, and every op must set the Calls chip on this board's flow widget."""
    if not isinstance(env, dict) or env.get("disposition") not in ("apply", "propose"):
        return None
    ops = env.get("ops")
    flow = _flow_widgets(context)
    if not isinstance(ops, list) or not ops:
        return None
    for o in ops:
        args = o.get("args") if isinstance(o, dict) else None
        if not isinstance(args, dict) or o.get("action") != "widget.setOption" or set(args) != {"widget", "key", "value"}:
            return None
        if str(args["widget"]) not in flow or args["key"] != "callPut" or str(args["value"]).strip().lower() not in _CHIP_VALUES:
            return None
    return {"disposition": env["disposition"], "reply": "", "question": None, "ops": ops, "unsupported_category": None,
            "research": None, "need_groups": None}
