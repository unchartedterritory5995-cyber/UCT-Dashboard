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


@pytest.mark.parametrize("word", ["1h", "1H", "hourly", "60m", "1hr", "1 hour", "60", "1-hour", "60 minutes", "1 hours"])
def test_chart_set_timeframe_reads_the_hour_spellings(word):
    assert expand("chart.setTimeframe", {"timeframe": word}) == {"timeframe": "60"}


# AUDIT T2 held-out probe 45: spaced and plural forms are read by GRAMMAR (no word list)
@pytest.mark.parametrize("word,want", [("15 minutes", "15"), ("15 min", "15"), ("5 minutes", "5"), ("30 minutes", "30"),
                                       ("15mins", "15"), ("5-minute", "5"), ("1 day", "D"), ("weekly", "W"), ("1 month", "M")])
def test_spaced_and_plural_forms_are_read_by_grammar(word, want):
    assert expand("chart.setTimeframe", {"timeframe": word}) == {"timeframe": want}


TF_ENUM_ACTIONS = [c["name"] for c in GOLDEN["capabilities"] if turn._is_timeframe_enum((c["args"]["properties"].get("timeframe") or {}))]


def test_every_timeframe_enum_in_the_golden_is_read_by_grammar_and_none_carries_a_word_list():
    assert {"chart.setTimeframe", "widget.addCharts", "chartGrid.set", "chart.addTab", "settings.setDefaultTimeframe"} <= set(TF_ENUM_ACTIONS)
    for name in TF_ENUM_ACTIONS:
        enum = BY[name]["args"]["properties"]["timeframe"]["enum"]
        assert turn._parse_timeframe("15 minutes", enum) == ("15" if "15" in enum else None), name
        words = (BY[name].get("coerce") or {}).get("timeframe") or {}
        assert "15 minutes" not in words, f"{name}: a timeframe word list came back"
        if name != "widget.addCharts":                  # (its own pre-existing words stay; no shared list is attached)
            assert "1h" not in words, f"{name}: a timeframe word list came back"


PARITY = json.loads((ROOT / "app/src/agent/contract/timeframe.parity.json").read_text(encoding="utf-8"))


def test_the_server_reads_every_row_of_the_browsers_parity_table():
    """app/src/agent/agentTimeframeWords.test.js writes the table from the browser's parseTimeframe; the server must agree."""
    enums = PARITY["enums"]
    assert len(PARITY["rows"]) > 1000
    bad = [(i, e, want, turn._parse_timeframe(i, enums[e])) for i, e, want in PARITY["rows"] if turn._parse_timeframe(i, enums[e]) != want]
    assert not bad, bad[:10]


@pytest.mark.parametrize("word", ["1m", "1M", "4 hours", "2 weeks", "13min", "2 daily", "h"])
def test_ambiguous_or_unoffered_spellings_are_refused_with_the_honest_sentence(word):
    with pytest.raises(turn.TurnError) as e:
        expand("chart.setTimeframe", {"timeframe": word}, message=f"change SPY to {word}")
    assert str(e.value).startswith("I couldn't read the timeframe")


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
