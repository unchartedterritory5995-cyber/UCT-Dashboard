"""v2-readiness-2 (Mission 3): the deterministic v1-vs-v2 cost estimate over the capability-regression corpus
(tools/agent_v2_corpus_cost.py). NO model call. Pins, on the current production model (claude-haiku-4-5) and the kept
$0.25 per-turn cap:
  * the v2 "index" layout (default) finishes EVERY corpus intent, every canonical step accepted by the server, with the
    runtime gate (spent + worst case of the next request, checked before each call) under the cap — with a margin;
  * the Wave 1 "search" layout cannot (its first request alone reserves most of the cap): why index is the default;
  * v1's single call stays under the cap for every intent."""
from __future__ import annotations

import pytest

from tools import agent_v2_corpus_cost as cc


@pytest.fixture(scope="module")
def index():
    return cc.measure("claude-haiku-4-5", "index")


def test_index_layout_finishes_every_corpus_intent_under_the_cap_with_margin(index):
    s = index["summary"]
    assert index["turn_cap_usd"] == 0.25 and s["intents"] == 46
    assert s["v2_finished"] == s["intents"] and s["v2_stopped"] == []
    assert all(r["v2"]["steps_done"] == r["v2"]["steps"] for r in index["rows"])           # no step refused (args / target)
    assert s["v2_gate_peak_usd_max"] < 0.25 and s["v2_margin_usd"] >= 0.10                  # measured ≈ $0.072 → margin ≈ $0.178
    assert all(r["v2"]["rounds"] <= index["rounds_cap"] for r in index["rows"])


def test_v1_one_call_is_under_the_cap_for_every_intent(index):
    assert index["summary"]["v1_worst_call_usd_max"] < 0.25
    assert all(r["v1"]["calls"] >= 1 and r["v1"]["tokens_in"] > 0 for r in index["rows"])


def test_the_wave1_search_layout_stops_at_the_turn_cap_which_is_why_index_is_the_default():
    s = cc.measure("claude-haiku-4-5", "search")["summary"]
    assert s["v2_finished"] == 0 and s["v2_stopped"] == ["turn_cap"]


def test_the_token_approximation_is_bpe_like():
    assert cc.approx_tokens("") == 0
    assert cc.approx_tokens("switch to weekly") == 2 + 1 + 2
    assert cc.approx_tokens('{"a":12345}') == 1 + 1 + 1 + 1 + 1 + 2 + 1
