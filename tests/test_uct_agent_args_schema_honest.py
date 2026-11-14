"""BUG C (owner live test 2026-11-14): "…change SPY to the 1-hour timeframe…" → after the member's pick the model wrote
chart.setTimeframe {"timeframe": "1h"} → the whole envelope was refused with "I couldn't fill in the details of one of the
steps" (no step, no setting named). Now:
  1. the manifest's chart.setTimeframe carries the shared timeframe words (app/src/agent/capabilities/timeframeWords.js), so
     normalize_args reads "1h" / "hourly" / "60m" as "60" — and an unknown word is never coerced;
  2. an op whose args still miss its schema kills the WHOLE envelope (fail-closed, no repair call), with a sentence naming the
     setting (its schema key) and the target (its <workspace_context> label), the value only when the member typed it;
  3. ARGS_SCHEMA_COUNTS counts (action, key) — never a value, never the member's words.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services.uct_agent import turn

ROOT = Path(__file__).resolve().parents[1]
GOLDEN = json.loads((ROOT / "app/src/agent/contract/manifest.golden.json").read_text(encoding="utf-8"))
BY = {c["name"]: c for c in GOLDEN["capabilities"]}
CTX = {"charts": [{"ref": "c1", "label": "Chart (SPY)", "symbol": "SPY"}]}


def cap(name: str) -> dict:
    kept = turn.validate_manifest([BY[name]])
    assert kept and kept[0]["name"] == name
    return kept[0]


def expand(name: str, args: dict, message: str = "", target: str = "c1") -> dict:
    env = {"ops": [{"action": name, "target": target, "args_json": json.dumps(args)}]}
    return turn.expand_compact_ops(env, [cap(name)], message=message, context=CTX)["ops"][0]["args"]


@pytest.mark.parametrize("word", ["1h", "1H", "hourly", "60m", "1hr", "1 hour", "60"])
def test_chart_set_timeframe_reads_the_hour_words(word):
    assert expand("chart.setTimeframe", {"timeframe": word}) == {"timeframe": "60"}


@pytest.mark.parametrize("name", ["chart.setTimeframe", "widget.addCharts", "chartGrid.set"])
def test_every_timeframe_action_in_the_golden_carries_the_shared_words(name):
    words = (BY[name].get("coerce") or {}).get("timeframe") or {}
    assert words.get("1h") == "60" and words.get("weekly") == "W" and words.get("daily") == "D"


@pytest.mark.parametrize("word", ["2h", "4h", "fortnightly", "banana", "intraday"])
def test_an_unknown_word_is_never_coerced_and_names_the_setting(word):
    with pytest.raises(turn.TurnError) as e:
        expand("chart.setTimeframe", {"timeframe": word}, message=f"change SPY to {word}")
    msg = str(e.value)
    assert e.value.reason == "unreadable:args_schema"
    assert msg.startswith("I couldn't read the timeframe")
    assert "for Chart (SPY)" in msg and "nothing was changed" in msg
    assert f"“{word}”" in msg                                  # the member typed it


def test_a_value_the_member_never_typed_is_never_echoed():
    with pytest.raises(turn.TurnError) as e:
        expand("chart.setTimeframe", {"timeframe": "2h"}, message="change SPY to the two hour")
    assert "2h" not in str(e.value)
    assert str(e.value).startswith("I couldn't read the timeframe for Chart (SPY)")


def test_an_extra_or_missing_setting_is_said_without_any_value():
    with pytest.raises(turn.TurnError) as e:
        expand("widget.addCharts", {"symbols": ["NVDA"], "timeframe": None, "chart_type": None, "exact": None, "position": "right of SPY"},
               message="open NVDA beside SPY", target="ws1")
    s = str(e.value)
    assert "couldn't fill in one of the steps" in s and "nothing was changed" in s
    assert "right of SPY" not in s and "position" not in s


def test_one_bad_op_still_kills_the_whole_envelope():
    env = {"ops": [{"action": "chart.setSymbol", "target": "c1", "args_json": json.dumps({"symbol": "NVDA"})},
                   {"action": "chart.setTimeframe", "target": "c1", "args_json": json.dumps({"timeframe": "banana"})}]}
    with pytest.raises(turn.TurnError):
        turn.expand_compact_ops(env, [cap("chart.setSymbol"), cap("chart.setTimeframe")], message="x", context=CTX)


def test_the_counter_holds_action_and_key_only_never_a_value_or_the_members_words():
    turn.ARGS_SCHEMA_COUNTS.clear()
    secret = "SECRETWORD42"
    for args in ({"timeframe": secret}, {"timeframe": "banana"}):
        with pytest.raises(turn.TurnError):
            expand("chart.setTimeframe", args, message=f"please {secret} my chart")
    assert turn.ARGS_SCHEMA_COUNTS == {("chart.setTimeframe", "timeframe"): 2}
    assert secret not in json.dumps([list(k) for k in turn.ARGS_SCHEMA_COUNTS])
