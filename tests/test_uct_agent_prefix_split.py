"""Prefix split (2026-11-22, docs/agent/LATENCY.md "Cache prefix"): the routed actions are cut at a line boundary into two
cache blocks, so requests that share a lead group share a cached prefix past Haiku 4.5's 4,096-token minimum. The text the
model reads is unchanged, the kill switch restores the two-block layout exactly, and a request never carries more than the
API's 4 cache marks."""
from __future__ import annotations

import pytest

from api.services.uct_agent import budget, turn
from tests.test_uct_agent import CAPS, CTX, _resp, caller_of, env

GROUP = [{"id": "alerts", "title": "Alerts"}]


def caps_named(prefix, n):
    return turn.validate_manifest([{**CAPS[0], "name": f"{prefix}.a{i}", "summary": "Does one thing on a chart. " * 6}
                                   for i in range(n)], 60)


BIG = caps_named("x", 40)                 # a catalog past the target
SMALL = caps_named("x", 2)                # a short one: never split


def test_a_long_catalog_is_cut_into_two_blocks_at_an_action_line():
    parts = turn.system_parts(BIG, GROUP, True)
    assert len(parts) == 3
    assert parts[2].startswith("- ") and parts[1].endswith("\n")
    assert len(parts[0]) + len(parts[1]) >= turn.PREFIX_TARGET_CHARS


def test_the_text_is_the_same_characters_in_the_same_order(monkeypatch):
    on = "".join(turn.system_parts(BIG, GROUP, True))
    monkeypatch.setenv(turn.PREFIX_SPLIT_ENV, "0")
    assert "".join(turn.system_parts(BIG, GROUP, True)) == on


def test_a_short_catalog_keeps_two_blocks():
    assert len(turn.system_parts(SMALL, GROUP, True)) == 2


@pytest.mark.parametrize("off", ["0", "false", "OFF", "no"])
def test_the_kill_switch_restores_the_two_block_layout(monkeypatch, off):
    monkeypatch.setenv(turn.PREFIX_SPLIT_ENV, off)
    parts = turn.system_parts(BIG, GROUP, True)
    assert len(parts) == 2 and parts[1].startswith(turn._ACTIONS_HEADING)


def test_requests_that_share_a_lead_group_share_the_first_two_blocks():
    one = turn.system_parts(BIG, GROUP, True)
    more = turn.validate_manifest(list(BIG) + list(caps_named("y", 5)), 60)
    other = turn.system_parts(more, [{"id": "layouts", "title": "Layouts"}], True)
    assert one[:2] == other[:2] and one[2] != other[2]


def test_the_lead_block_never_reaches_the_groups_note():
    parts = turn.system_parts(BIG, GROUP, True)
    assert "OTHER ACTION GROUPS" not in parts[1] and "OTHER ACTION GROUPS" in parts[2]


@pytest.mark.parametrize("n", [1, 2, 3, 4, 5, 6])
def test_never_more_than_four_cache_marks_and_always_the_first_and_last(n):
    blocks = turn.cache_blocks([f"p{i}" for i in range(n)])
    marked = [i for i, b in enumerate(blocks) if "cache_control" in b]
    assert len(marked) == min(n, 4) and marked[0] == 0 and marked[-1] == n - 1
    assert [b["text"] for b in blocks] == [f"p{i}" for i in range(n)]


def test_up_to_four_parts_every_block_is_marked_as_before():
    assert all("cache_control" in b for b in turn.cache_blocks(["a", "b", "c", "d"]))


def test_a_real_turn_sends_the_split_blocks_and_the_same_schema(monkeypatch):
    seen = []

    def spy(**kw):
        seen.append(kw)
        return caller_of(_resp(env("answer", reply="Hello.")))(**kw)

    turn.run_turn(message="hello", context=CTX, history=[], capabilities=[dict(c) for c in BIG], caller=spy,
                  routing={"groups": [{"id": "charts", "title": "Charts"}, {"id": "alerts", "title": "Alerts"}],
                           "selected": ["charts"]})
    on = seen[-1]
    assert len(on["system"]) == 3 and all(b["cache_control"] == {"type": "ephemeral"} for b in on["system"])
    monkeypatch.setenv(turn.PREFIX_SPLIT_ENV, "0")
    turn.run_turn(message="hello", context=CTX, history=[], capabilities=[dict(c) for c in BIG], caller=spy,
                  routing={"groups": [{"id": "charts", "title": "Charts"}, {"id": "alerts", "title": "Alerts"}],
                           "selected": ["charts"]})
    off = seen[-1]
    assert on["output_config"] == off["output_config"] and on["messages"] == off["messages"]
    assert "".join(b["text"] for b in on["system"]) == "".join(b["text"] for b in off["system"])


def test_the_worst_case_reservation_moves_by_bytes_only(monkeypatch):
    ask = lambda parts: budget.worst_case_usd({"model": "claude-haiku-4-5", "max_tokens": 2048, "system": turn.cache_blocks(parts),
                                               "messages": [{"role": "user", "content": "hello"}]})
    on = ask(turn.system_parts(BIG, GROUP, True))
    monkeypatch.setenv(turn.PREFIX_SPLIT_ENV, "0")
    off = ask(turn.system_parts(BIG, GROUP, True))
    assert 0 <= on - off < 0.0002          # one more block's JSON framing, priced as tokens — the $0.25 cap is unchanged
