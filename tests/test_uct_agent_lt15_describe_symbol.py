"""LT-15 (live 2026-11-03, 4-chart board: top-left NVDA daily, the others SPY): "describe the setup on nvda" was
answered "Checking NVDA's daily setup now." and then NOTHING appeared. The reply was not blanked, so the plan was
not an apply of chart.describeSetup alone (the data-read rule would have emptied it): the planner returned the read
under TALK (`answer` + the op, which TALK drops) or an `answer` with no op at all — and "Checking …" slipped past the
claim rule, which names changes, not lookups.

Server half of the fix (the browser half: app/src/agent/agentChartDescribe.test.jsx "LT-15"):
- an `answer` whose ops are ALL data reads is served as the `apply` it is (the read runs, its card leads, the
  pre-read reply is dropped);
- an `answer` with no op that ANNOUNCES a lookup is replaced by an honest sentence (NOTHING_LOOKED_UP);
- anything else is unchanged (a write under TALK is still dropped; ordinary answers pass).
Scripted model, real capability shapes, no network, no paid call.
"""
from __future__ import annotations

import pytest

from api.services.uct_agent import turn
from tests.test_uct_agent import CAPS, OP, _resp, caller_of, env

# chart.describeSetup exactly as app/src/agent/capabilities/chartDescribe.js registers it (target chart, a query)
DESCRIBE = {"name": "chart.describeSetup", "domain": "chart", "target": "chart", "summary": "Describe ONE chart's setup.",
            "hints": None, "risk": "local", "reversible": True, "query": True,
            "args": {"type": "object",
                     "properties": {"symbol": {"type": ["string", "null"]},
                                    "timeframe": {"type": ["string", "null"], "enum": ["D", "W", None]}},
                     "required": ["symbol", "timeframe"], "additionalProperties": False}}
ALL = CAPS + [DESCRIBE]
CTX4 = {"surface": "charts", "charts": [
    {"ref": "c1", "label": "Top-left chart (NVDA)", "symbol": "NVDA", "position": "top-left"},
    {"ref": "c2", "label": "Top-right chart (SPY)", "symbol": "SPY", "position": "top-right"},
    {"ref": "c3", "label": "Bottom-left chart (SPY)", "symbol": "SPY", "position": "bottom-left"},
    {"ref": "c4", "label": "Bottom-right chart (SPY)", "symbol": "SPY", "position": "bottom-right"},
]}
LIVE_REPLY = "Checking NVDA's daily setup now."
MSG = "describe the setup on nvda"


@pytest.fixture(autouse=True)
def _no_cost(monkeypatch):
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.001)


def _run(envelope, message=MSG, **kw):
    return turn.run_turn(message=message, context=CTX4, history=[], capabilities=ALL, caller=caller_of(_resp(envelope)),
                         **kw)["envelope"]


def _op(target="c1", symbol="NVDA"):
    return {"action": "chart.describeSetup", "target": target, "args": {"symbol": symbol, "timeframe": None}}


@pytest.mark.parametrize("target", ["c1", "c2"])          # NVDA's own chart, or an SPY chart with the symbol named
def test_the_live_shape_a_read_under_talk_is_served_as_its_apply(target):
    out = _run(env("answer", [_op(target)], reply=LIVE_REPLY))
    assert out["disposition"] == "apply"
    assert out["ops"] == [_op(target)]                      # the read runs: its card is what the member sees
    assert out["reply"] == ""                               # the pre-read announcement never leads the card


def test_the_apply_the_planner_should_have_written_is_unchanged():
    out = _run(env("apply", [_op()], reply=LIVE_REPLY))
    assert out["disposition"] == "apply" and out["ops"] == [_op()] and out["reply"] == ""


def test_an_announced_lookup_with_no_op_says_nothing_was_read():
    out = _run(env("answer", [], reply=LIVE_REPLY))
    assert out["disposition"] == "answer" and out["ops"] == []
    assert out["reply"] == turn.NOTHING_LOOKED_UP
    assert "NVDA" not in out["reply"] and "Checking" not in out["reply"]


def test_a_write_under_talk_is_still_dropped_and_its_announcement_is_honest():
    # TALK never mutates: a read beside a WRITE is not promoted (only an all-read plan is)
    out = _run(env("answer", [_op(), OP], reply=LIVE_REPLY))
    assert out["disposition"] == "answer" and out["ops"] == []
    assert out["reply"] == turn.NOTHING_LOOKED_UP


def test_an_unresolvable_target_asks_never_runs():
    out = _run(env("answer", [_op("c9")], reply=LIVE_REPLY))
    assert out["disposition"] == "clarify" and out["ops"] == [] and out["reply"] == ""


def test_the_news_ask_box_never_runs_a_promoted_read():
    out = _run(env("answer", [_op()], reply=LIVE_REPLY), answer_only=True)
    assert out["ops"] == [] and out["disposition"] == "answer"


def test_promote_talk_reads_is_by_name_only():
    assert turn.promote_talk_reads(env("answer", [_op()]))["disposition"] == "apply"
    assert turn.promote_talk_reads(env("answer", [OP]))["disposition"] == "answer"
    assert turn.promote_talk_reads(env("answer", []))["disposition"] == "answer"
    assert turn.promote_talk_reads(env("clarify", [_op()]))["disposition"] == "clarify"
    assert turn.promote_talk_reads(env("answer", [{**_op(), "action": "chart.describeSetupX"}]))["disposition"] == "answer"


@pytest.mark.parametrize("reply", [
    LIVE_REPLY, "Let me check NVDA's setup.", "Let me pull up NVDA.", "I'll fetch NVDA's daily bars.",
    "Fetching that for you now!", "I'll pull up NVDA's daily bars.", "Sure, checking that now.",
    "OK — fetching NVDA's daily bars now.",
    # matches the template too, and that is intended: a talk-only reply promising a check that never happens is
    # exactly the LT-15 failure, so the honest sentence replaces it
    "Sure, I'll check with the team.",
])
def test_announced_lookups_with_no_op_are_replaced(reply):
    # (a promise the older claim rule already names — "I'll pull up …" — keeps its NOTHING_DONE; both are honest)
    assert turn.sanitize_envelope(env("answer", reply=reply), {"c1"})["reply"] in (turn.NOTHING_LOOKED_UP, turn.NOTHING_DONE)


@pytest.mark.parametrize("reply", [
    "RSI measures momentum on a 0-100 scale.",
    "Looking at the 50-day, a rising average shows a healthy trend.",
    "Looks like NVDA is now above its 50-day.",
    "Reviewing a chart weekly helps you see the bigger trend.",
    "Describing a setup means naming its trend, its range and its volume.",
    "I'll describe how a cup-and-handle forms: a rounded base, then a short pullback.",
    "Checking the weekly chart is a good habit before a daily entry.",
    "Loading up on a stock before earnings adds gap risk.",
    "Adding a 200-day SMA shows the long-term trend.",
    "Let me show you how RSI works: it compares average gains to average losses.",
])
def test_ordinary_answers_still_pass(reply):
    assert turn.sanitize_envelope(env("answer", reply=reply), {"c1"})["reply"] == reply


# ── PR #763 review B1: only a reply that is NOTHING BUT the announcement is replaced ─────────────────────────────
BASICS = ("Let me review the basics: a base is a period of sideways price action after an advance, where supply is "
          "absorbed. A tight base shows contracting ranges and drying volume; a breakout on rising volume through the "
          "pivot is the classic entry. The 50-day moving average often acts as support during the base, and a stock "
          "that holds it while the market corrects is showing relative strength. Risk is set below the low of the "
          "final contraction, so the position size follows from that distance.")
REAL_ANSWERS = [
    "I'll describe a VCP setup: a series of contractions, each tighter than the last, on drying volume.",
    BASICS,
    "I'll calculate it for you: 50 times 1.2 is 60.",
    "Sure, I'll look at that from a risk angle: size the position from the stop, not the target.",
    "I'm reading this headline as a supply-chain story: the supplier named is a chip packager.",
    "I'll get straight to it: a pivot is the price that ends a base.",
    "I am looking forward to helping.",
    "Running a scan now and then helps you find new leaders early.",
    "Checking for volume dry-up... is the key signal in the last contraction.",
]


def test_the_basics_answer_is_long():
    assert len(BASICS) > 400


@pytest.mark.parametrize("reply", REAL_ANSWERS)
def test_a_real_answer_that_starts_like_an_announcement_is_never_replaced(reply):
    assert turn.sanitize_envelope(env("answer", reply=reply), {"c1"})["reply"] == reply
    assert turn.sanitize_envelope(env("answer", reply=reply), {"c1"}, grounded=True)["reply"] == reply


@pytest.mark.parametrize("reply", REAL_ANSWERS)
def test_the_news_ask_box_serves_real_answers_unchanged(reply):
    out = _run(env("answer", [], reply=reply), message="what does this headline mean", answer_only=True)
    assert out["disposition"] == "answer" and out["ops"] == [] and out["reply"] == reply


def test_an_announcement_followed_by_anything_else_is_not_replaced():
    for reply in ("Checking NVDA's daily setup now. The 50-day is the line to watch.",
                  "Checking NVDA's daily setup now: it is above its 50-day.",
                  "Checking " + "NVDA " * 30 + "now."):
        assert turn.sanitize_envelope(env("answer", reply=reply), {"c1"})["reply"] == reply


# ── PR #763 delta review: a strict template over the whole reply; everything else stands ──────────────────────────
DELTA_NEGATIVES = [
    "Let me check — yes, RS Rank runs from 1 to 99.",
    "I'll check whether that's a pivot — usually yes.",
    "I'll look at it this way, a pivot is the breakout point.",
    "I will describe it simply, a VCP is a series of tighter pullbacks.",
    "Let me review that, and honestly it looks like a classic flat base.",
    "I'm looking at a 7% max loss as the rule.",
    "I'm calculating risk as 1% of the account per trade.",
    "Checking the stop is wise right now.",
    "Running stops tight works well for you.",
    # a main verb or copula in the object is an answer, never an announcement
    "Checking what it is now.", "Checking which ones are leaders now.", "Checking what it was now.",
    "Checking where they were now.", "Checking how it works now.", "Checking what helps now.",
    "Checking what makes it now.", "Checking what it means now.", "Checking how it runs now.",
    "Let me check it as well.", "I'll check whether it held.", "Let me check it this way.", "I'll describe it simply.",
    # outside the template: more than 6 object tokens, a digit, a comma
    "Checking NVDA AMD AAPL MSFT META TSLA GOOGL now.", "Checking the 50 day now.", "Checking NVDA, AMD now.",
]


@pytest.mark.parametrize("reply", DELTA_NEGATIVES)
def test_delta_review_answers_are_never_replaced(reply):
    assert turn.sanitize_envelope(env("answer", reply=reply), {"c1"})["reply"] == reply


@pytest.mark.parametrize("reply", [LIVE_REPLY, "Let me check NVDA's setup.", "Fetching that for you now!"])
def test_no_rewrite_on_a_grounded_answer_or_the_news_ask_box(reply):
    # those turns cannot carry ops: a short reply stands as written
    assert turn.sanitize_envelope(env("answer", reply=reply), {"c1"}, grounded=True)["reply"] == reply
    assert turn.sanitize_envelope(env("answer", reply=reply), {"c1"}, answer_only=True)["reply"] == reply
    out = _run(env("answer", [], reply=reply), message="what does this headline mean", answer_only=True)
    assert out["disposition"] == "answer" and out["reply"] == reply
