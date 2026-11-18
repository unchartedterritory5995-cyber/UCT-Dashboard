"""WHEN IT DECLINES, IT OFFERS THE CLOSEST THING IT CAN BUILD. And a stop that only rises is not
something to decline at all.

⚰️ FOUND LIVE, 2026-11-18. In the morning's round of well-known names a trailing stop was BUILT, as
a stop that only rises (one running value). In the afternoon's it was DECLINED: "a ratcheting line
... needs a line that can remember its own earlier value ... I can't write that here. What I can
build instead: SuperTrend, Parabolic SAR". Those are an older instruction paragraph's own words. It
still said a ratcheting stop "cannot be written" and that nothing but those two functions reads
its own earlier value, a few lines above the running-value section that shows how to write exactly
that stop. Two instructions that contradict each other are a coin toss.

The paragraph now says what is true: a stop that only ever moves ONE way is a running value; only
one that FLIPS sides is unsupported, and then the same stop on one side is what to offer first. And
the general rule for declining (coordinator's ruling the same day): one sentence saying so, one
more offering the closest thing to what was asked that can be built, before any other indicator.

Held here: the instructions as SENT (not the source text) say each of those and no longer say the
contradicting sentences; and the stop the instructions teach passes the door.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import json

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num, op,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}
S = lambda n: {"type": "series", "name": n}  # noqa: E731
ATR = call("atr", S("high"), S("low"), S("close"), num(14))
RISING_STOP = call("accum", S("low"), call("max", S("self"), op("-", S("close"), op("*", num(3), ATR))), num(300))


def stop_patch():
    return env(0, [{"op": "create", "name": "Stop that only rises", "placement": "price",
                    "outputs": [{"key": "stop", "tree": RISING_STOP}]}])


def instructions(conv, model):
    """Everything the assistant is sent that is not the member's own message, as one text."""
    client = model([emits(stop_patch())])
    conv.converse("Add a trailing stop 3 ATR under the close that only rises", user_id="u1", view=empty_view(0), chart=CHART)
    (sent,) = client.calls
    return " ".join(json.dumps(v) if not isinstance(v, str) else v for k, v in sent.items() if k != "messages")


def test_the_instructions_say_a_one_way_stop_is_a_running_value_and_no_longer_say_it_cannot_be_written(conv, clean_env, model):
    text = instructions(conv, model)
    assert "accum(seed, update, warmup)" in text                              # the instructions ARE in this text
    assert "A stop or level that only ever moves ONE way" in text and "is a RUNNING VALUE: write it with accum" in text
    assert "A stop that only rises: accum(low, max(self, close - 3 * atr(high, low, close, 14)), 300)" in text
    # only the stop that switches sides is declined, and the one-sided stop is offered first
    assert "A stop that FLIPS to the other side when price crosses it" in text
    assert "offer the same stop on ONE side" in text
    # the two sentences that contradicted the running-value section are gone
    for stale in ("Nothing else can read its own earlier value",
                  "is not one of those two cannot be written",
                  "say it needs a line that remembers its own earlier value"):
        assert stale not in text, stale


def test_the_instructions_say_how_to_decline(conv, clean_env, model):
    text = instructions(conv, model)
    assert "CLOSEST THING TO WHAT WAS ASKED that can be built" in text
    assert "before naming any other indicator" in text and "Offer it, do not build it" in text
    assert "Never substitute something different" in text                     # the rule it sits beside still stands


def test_the_stop_the_instructions_teach_passes_the_door(conv, clean_env, model):
    client = model([emits(stop_patch())])
    r = conv.converse("Add a trailing stop 3 ATR under the close that only rises", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1, r
    # and the member is told what a running value costs them (it starts 300 bars back)
    assert any("300" in str(a.get("text")) for a in r["envelope"].get("assumptions") or []), r["envelope"].get("assumptions")


def test_a_decline_with_an_offer_reaches_the_member_as_written(conv, clean_env, model):
    """The door passes an honest decline through: nothing is built, and the offer is the member's to take."""
    reply = ("A stop that switches sides when price crosses it cannot be written here. "
             "I can build the long side on its own, a stop that only rises: shall I?")
    model([emits({"contract": conv.PATCH_CONTRACT, "baseRevision": 0, "disposition": "unsupported", "ops": [], "reply": reply})])
    r = conv.converse("Add a trailing stop that switches sides with the trend", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "unsupported" and r["reply"] == reply
    assert r["envelope"]["ops"] == []
