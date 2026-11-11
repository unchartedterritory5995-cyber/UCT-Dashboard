"""W1.1 repair-a, R-01 (LT-3, live production planner 2026-11-03): the model's args for chart.setSetting (promoted rows),
chart.replay ("exit replay"), a screener.run refinement sort and widget.addCharts came back OFF-SCHEMA and every turn
ended in "I couldn't fill in the details of one of the steps". The deterministic tests fed exact args; the live model
sends variants. These tests replay realistic wrong-but-recoverable shapes per capability family through the REAL
golden manifest (validate_manifest → normalize_args → args_match, exactly expand_compact_ops' path) and hold that:
  • each recoverable shape expands to the schema's own shape (never a guessed value);
  • the genuinely invalid ones still refuse (unreadable, "nothing was changed");
  • every rule applied is logged by NAME and KEY only;
  • the catalog prints each repaired capability's exact `shape` under its line;
  • the strict (embedded-args) path gets the same normalizer;
R-02 (LT-1): the catalog tells the planner the empty-board rule; R-03 (LT-10): a keyboard-run message is a clarify with
choices and ZERO model calls, a real message's unreadable plan keeps its own sentence."""
from __future__ import annotations

import json
import logging
import types
from pathlib import Path

import pytest

from api.services.uct_agent import turn

ROOT = Path(__file__).resolve().parents[1]
GOLDEN = json.loads((ROOT / "app/src/agent/contract/manifest.golden.json").read_text(encoding="utf-8"))
BY = {c["name"]: c for c in GOLDEN["capabilities"]}
FAMILIES = ("chart.setSetting", "chart.replay", "screener.run", "widget.addCharts")


def cap(name: str) -> dict:
    kept = turn.validate_manifest([BY[name]])
    assert kept and kept[0]["name"] == name, f"{name} must survive validation"
    return kept[0]


def expand(name: str, args_json: str) -> dict:
    """Exactly expand_compact_ops' path for ONE op (the compact shape the production planner uses)."""
    env = {"ops": [{"action": name, "target": "x1", "args_json": args_json}]}
    return turn.expand_compact_ops(env, [cap(name)])["ops"][0]["args"]


def refuses(name: str, args_json: str) -> None:
    with pytest.raises(turn.TurnError, match="couldn.t fill in the details of one of the steps"):
        expand(name, args_json)


# ── the declarations reach the server ──────────────────────────────────────────────────────────────────────────

def test_the_golden_manifest_carries_the_tolerance_declarations_and_the_server_keeps_them():
    for name in FAMILIES:
        c = cap(name)
        assert c["shape"], f"{name} declares its exact shape"
        assert len(c["shape"]) <= turn.MAX_SHAPE
    assert cap("chart.setSetting")["argAliases"] == {"setting": BY["chart.setSetting"]["argAliases"]["setting"]}
    assert cap("chart.replay")["coerce"]["date"]["exit"] is None
    assert cap("screener.run")["defaults"] == {"filters": []}
    assert cap("screener.run")["defaultsWhen"] == {"filters": {"mode": ["refine"]}}   # W1.1 review NB-2
    assert "sort.field" in cap("screener.run")["argAliases"]["sort_field"]
    assert "symbols.count" in cap("widget.addCharts")["argAliases"]["symbols.top"]
    # a capability that declares nothing carries nulls (the manifest's keys are fixed — agentContracts.test.js)
    plain = cap("chart.setType")
    assert plain["argAliases"] is None and plain["coerce"] is None and plain["defaults"] is None


def test_a_malformed_declaration_is_dropped_but_the_capability_is_kept(caplog):
    bad = dict(BY["chart.replay"], argAliases={"nope": ["x"], "date": "not-a-list", "date.x": ["ok"]},      # date.x: date is not an object
               coerce={"zzz": {"a": 1}, "date": "x"}, defaults={"date": {"not": "a string"}, "other": 1})
    with caplog.at_level(logging.WARNING):
        kept = turn.validate_manifest([bad])
    assert kept[0]["name"] == "chart.replay"
    assert kept[0]["argAliases"] is None and kept[0]["coerce"] is None and kept[0]["defaults"] is None
    assert "dropped" in caplog.text


def test_the_catalog_prints_each_repaired_capabilitys_exact_shape_under_its_line_and_the_empty_board_rule():
    lines = turn._catalog_lines([cap(n) for n in FAMILIES])
    for n in FAMILIES:
        i = next(k for k, line in enumerate(lines) if line.startswith(f"- {n}("))
        assert lines[i + 1].startswith("  SHAPE: "), n
    text = "\n".join(lines)
    assert '{"setting":"bgMode","value":"solid"}' in text                     # LT-3 (a)
    assert '{"date":null} to EXIT replay' in text                              # LT-3 (b)
    assert '"filters":[],"sort_field":"chg_pct_3m","sort_dir":"desc","mode":"refine"' in text   # LT-3 (c)
    assert '{"symbols":["NVDA"],"timeframe":"D"' in text                      # LT-3 (d)
    assert "With NO chart in <workspace_context>" in text and "never chart.setSymbol" in text   # LT-1 (R-02)
    assert "SHAPE:" not in "\n".join(turn._catalog_lines([cap(n) for n in FAMILIES], lean=True))


def test_the_rename_pair_tells_the_planner_which_rename_is_which():
    text = "\n".join(turn._catalog_lines([cap("layout.rename"), cap("chart.renameTab")]))
    assert "never chart.renameTab" in text and "is layout.rename" in text     # LT-9 (R-03)


# ── (a) chart.setSetting — "turn the gradient off on this chart" ──────────────────────────────────────────────────

SETTING_OK = [
    ('{"setting":"bgMode","value":"solid"}', {"setting": "bgMode", "value": "solid"}),
    ('{"key":"bgMode","value":"solid"}', {"setting": "bgMode", "value": "solid"}),                 # key for setting
    ('{"id":"bgMode","value":"off"}', {"setting": "bgMode", "value": "off"}),                     # the dialog reads "off"
    ('{"name":"bgMode","value":false}', {"setting": "bgMode", "value": False}),
    ('{"option":"bgMode","value":"gradient"}', {"setting": "bgMode", "value": "gradient"}),
    ('{"settingId":"bgMode","value":"Solid"}', {"setting": "bgMode", "value": "Solid"}),          # the dialog case-folds
    ('{"setting":"BGMODE","value":"solid"}', {"setting": "bgMode", "value": "solid"}),             # enum case-fold
    ('{"setting":"grid.visible","value":"false"}', {"setting": "grid.visible", "value": "false"}),
    ('{"setting":"Grid.Visible","value":false}', {"setting": "grid.visible", "value": False}),
    ('{"setting":"volume.paneHeightPct","value":"90%"}', {"setting": "volume.paneHeightPct", "value": "90%"}),  # the range check is the dialog's
    ('{"setting":"watermark.opacity","value":0.5}', {"setting": "watermark.opacity", "value": 0.5}),
    ('{"path":"darkPool.enabled","value":"on"}', {"setting": "darkPool.enabled", "value": "on"}),
    ('{"property":"heikinAshi","value":true}', {"setting": "heikinAshi", "value": True}),
    ('{"setting":"bgMode","value":"solid","key":"ignored-twin"}', None),                           # (refuses: an extra key)
]


@pytest.mark.parametrize("args_json,want", [(a, w) for a, w in SETTING_OK if w is not None])
def test_chart_setSetting_live_shapes_expand(args_json, want):
    assert expand("chart.setSetting", args_json) == want


@pytest.mark.parametrize("args_json", [
    '{"setting":"bgGradient.enabled","value":false}',      # an invented id (the live failure's likely shape) — never guessed
    '{"setting":"background.gradient","value":"off"}',
    '{"key":"bgMode","value":"solid","extra":1}',
    '{"value":"solid"}',                                   # no setting at all
    '{"setting":"bgMode"}',                                # no value (not nullable)
    '{"setting":"bgMode","value":null}',
    '{"setting":"bgMode","value":["solid"]}',
    '{"setting":42,"value":"solid"}',
])
def test_chart_setSetting_invalid_shapes_still_refuse(args_json):
    refuses("chart.setSetting", args_json)


def test_normalization_is_logged_by_rule_and_key_never_by_value(caplog):
    with caplog.at_level(logging.INFO):
        expand("chart.setSetting", '{"key":"BGMODE","value":"solid"}')
    line = next(r for r in caplog.records if "args normalized" in r.getMessage()).getMessage()
    assert "chart.setSetting" in line and "alias:key->setting" in line and "setting:enum-case" in line
    assert "solid" not in line and "bgmode" not in line.lower().replace("setting", "")


# ── (b) chart.replay — "exit replay" ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("args_json,want", [
    ('{"date":null}', None),
    ('{}', None),                                   # left out: nullable → null (as before)
    ('{"date":"null"}', None),                      # the word
    ('{"date":"none"}', None),
    ('{"date":""}', None),
    ('{"date":"exit"}', None),                      # the capability's own synonyms
    ('{"date":"off"}', None),
    ('{"date":"stop"}', None),
    ('{"date":"EXIT"}', None),
    ('{"date":"exit replay"}', None),
    ('{"cutoff":null}', None),                      # another key for the cutoff
    ('{"to":"2026-03-02"}', "2026-03-02"),
    ('{"until":"last friday"}', "last friday"),     # the capability resolves date words itself
    ('{"replay_date":"2026-10-15"}', "2026-10-15"),
    ('{"date":"2026-03-02"}', "2026-03-02"),
])
def test_chart_replay_live_shapes_expand(args_json, want):
    assert expand("chart.replay", args_json) == {"date": want}


@pytest.mark.parametrize("args_json", [
    '{"exit":true}',                                # an invented boolean key — nothing says what it means
    '{"date":null,"exit":true}',
    '{"enabled":false}',
    '{"date":false}',                               # a boolean is not a date and not the exit word
    '{"date":20260302}',
    '{"date":["2026-03-02"]}',
])
def test_chart_replay_invalid_shapes_still_refuse(args_json):
    refuses("chart.replay", args_json)


# ── (c) screener.run — "sort them by 3 month performance" (a refinement that only re-orders) ─────────────────────

WANT_SORT = {"filters": [], "sort_field": "chg_pct_3m", "sort_dir": "desc", "mode": "refine", "show": None, "as": None, "within": None,
             "logic": None, "rank": None}

SORT_OK = [
    '{"filters":[],"sort_field":"chg_pct_3m","sort_dir":"desc","mode":"refine","show":null,"as":null,"within":null}',
    '{"sort_field":"chg_pct_3m","sort_dir":"desc","mode":"refine"}',                      # filters left out
    '{"filters":null,"sort_field":"chg_pct_3m","sort_dir":"desc","mode":"refine"}',      # filters null
    '{"sort_field":"chg_pct_3m","sort_dir":"descending","mode":"refine"}',               # the word
    '{"sort_field":"chg_pct_3m","sort_dir":"DESC","mode":"refine"}',                     # the case
    '{"sort_field":"chg_pct_3m","sort_dir":"Desc","mode":"Refine"}',
    '{"sort_field":"chg_pct_3m","sort_dir":"highest first","mode":"refinement"}',
    '{"sort":{"field":"chg_pct_3m","dir":"desc"},"mode":"refine"}',                      # nested sort object
    '{"sort":{"key":"chg_pct_3m","direction":"descending"},"mode":"refine"}',
    '{"sort":{"by":"chg_pct_3m","order":"desc"},"mode":"refine","filters":[]}',
    '{"sort_by":"chg_pct_3m","sort_order":"desc","mode":"refine"}',
    '{"sortBy":"chg_pct_3m","sortDir":"desc","mode":"refine","limit":null}',
    '{"order_by":"chg_pct_3m","direction":"high to low","mode":"refine","conditions":[]}',
    '{"sort_field":"chg_pct_3m","sort_dir":"desc","mode":"refine","show":"null","as":"","within":"null"}',   # null words
]


@pytest.mark.parametrize("args_json", SORT_OK)
def test_screener_refinement_sort_live_shapes_expand(args_json):
    assert expand("screener.run", args_json) == WANT_SORT


def test_nb1_an_explicit_none_word_is_kept_where_the_field_is_a_name():
    # W1.1 review NB-1: a list / screen literally named "None" is not lost; "null" / "" still read as null
    out = expand("screener.run", '{"sort_field":"chg_pct_3m","sort_dir":"desc","mode":"refine","as":"Nothing","within":"none"}')
    assert out["within"] == "none" and out["as"] == "Nothing"
    assert expand("screener.run", '{"sort_field":"chg_pct_3m","sort_dir":"desc","mode":"refine","as":"NIL","within":""}')["as"] == "NIL"
    # a field with no string type still reads the words (show is integer|null)
    assert expand("screener.run", '{"sort_field":"chg_pct_3m","sort_dir":"desc","mode":"refine","show":"none"}')["show"] is None


def test_nb2_filters_default_only_for_a_refinement_never_a_new_screen():
    # W1.1 review NB-2: a NEW screen with filters left out is refused as before (never universe-wide); a refinement is read
    refuses("screener.run", '{"sort_field":"chg_pct_3m","sort_dir":"desc","mode":"new"}')
    refuses("screener.run", '{"filters":null,"sort_field":null,"sort_dir":null,"mode":"new"}')
    refuses("screener.run", '{"sort_field":"chg_pct_3m","sort_dir":"desc","mode":"fresh"}')       # coerced to new first
    assert expand("screener.run", '{"filters":[],"sort_field":null,"sort_dir":null,"mode":"new"}')["filters"] == []   # explicit [] kept
    assert expand("screener.run", '{"sort_field":"chg_pct_3m","sort_dir":"desc","mode":"refine"}')["filters"] == []


def test_screener_show_as_a_string_number_and_a_nested_sort_leave_no_container_behind():
    out = expand("screener.run", '{"sort":{"field":"chg_pct_3m","dir":"desc"},"mode":"refine","show":"10"}')
    assert out == {**WANT_SORT, "show": 10}
    assert "sort" not in out


@pytest.mark.parametrize("args_json", [
    '{"sort_field":"chg_pct_3m","sort_dir":"sideways","mode":"refine"}',     # not an order
    '{"sort_field":"chg_pct_3m","sort_dir":"desc","mode":"again"}',          # not a mode
    '{"sort_field":"chg_pct_3m","sort_dir":"desc"}',                          # mode left out (required, not nullable)
    '{"sort":{"field":"chg_pct_3m","dir":"desc","extra":1},"mode":"refine"}', # a leftover in the nested object
    '{"filters":"price > 10","sort_field":null,"sort_dir":null,"mode":"refine"}',   # filters as prose
    '{"sort_field":"chg_pct_3m","sort_dir":"desc","mode":"refine","show":"ten"}',
    '{"sort_field":["chg_pct_3m"],"sort_dir":"desc","mode":"refine"}',
])
def test_screener_invalid_shapes_still_refuse(args_json):
    refuses("screener.run", args_json)


# ── (d) widget.addCharts — "open the top two from w1test-movers in the bottom row with the 9 and 20 ema" ─────────

TOP2 = {"symbols": {"from": "w3", "top": 2}, "timeframe": None, "chart_type": None, "exact": None}

ADD_OK = [
    ('{"symbols":{"from":"w3","top":2},"timeframe":null,"chart_type":null,"exact":null}', TOP2),
    ('{"symbols":{"from":"w3","top":2}}', TOP2),                                        # nullables left out
    ('{"symbols":{"from":"w3","top":"2"}}', TOP2),                                      # top as a string
    ('{"symbols":{"list":"w3","top":2}}', TOP2),                                        # nested key names
    ('{"symbols":{"watchlist":"w3","count":2}}', TOP2),
    ('{"symbols":{"source":"w3","n":"2"}}', TOP2),
    ('{"tickers":{"from":"w3","top":2}}', TOP2),                                        # the list under another key
    ('{"list":{"from":"w3","top":2}}', TOP2),
    ('{"from":"w3","top":2}', TOP2),                                                    # flat (the 2026-10-08 rule)
    ('{"symbols":{"from":"w3","top":2},"timeframe":"daily"}', {**TOP2, "timeframe": "D"}),     # timeframe words
    ('{"symbols":{"from":"w3","top":2},"tf":"1D"}', {**TOP2, "timeframe": "D"}),
    ('{"symbols":{"from":"w3","top":2},"interval":"d"}', {**TOP2, "timeframe": "D"}),  # enum case-fold
    ('{"symbols":{"from":"w3","top":2},"timeframe":"hourly","exact":"false"}', {**TOP2, "timeframe": "60", "exact": False}),
    ('{"symbols":["NVDA","AMD"],"timeframe":"weekly","type":"candlestick","exact":"true"}',
     {"symbols": ["NVDA", "AMD"], "timeframe": "W", "chart_type": "candles", "exact": True}),
    ('{"tickers":["NVDA"],"timeframe":"D","chart_type":"Candles"}', {"symbols": ["NVDA"], "timeframe": "D", "chart_type": "candles", "exact": None}),
    ('{"symbols":["NVDA"],"timeframe":"default","chart_type":"","exact":null}', {"symbols": ["NVDA"], "timeframe": None, "chart_type": None, "exact": None}),
    ('{"symbols":["NVDA"],"timeframe":60}', {"symbols": ["NVDA"], "timeframe": "60", "chart_type": None, "exact": None}),   # a number for the enum
]


@pytest.mark.parametrize("args_json,want", ADD_OK)
def test_widget_addCharts_live_shapes_expand(args_json, want):
    assert expand("widget.addCharts", args_json) == want


@pytest.mark.parametrize("args_json", [
    '{"symbols":{"from":"w3","top":2},"indicators":["EMA 9","EMA 20"]}',      # indicators are not this op's (the shape says so)
    '{"symbols":{"from":"w3","top":2},"placement":"bottom row"}',
    '{"symbols":{"from":"w3","top":2},"row":"bottom"}',
    '{"symbols":{"from":"w3","top":2},"timeframe":"2h"}',                       # not a native timeframe
    '{"symbols":{"from":"w3","top":"two"}}',                                   # not a number
    '{"symbols":"w3"}',                                                        # a bare name is neither a list nor a reference
    '{"symbols":{"from":"w3","top":2,"tf":"D"}}',                              # a stray key inside the reference
    '{"symbols":{"top":2}}',                                                   # no source
    '{"symbols":[1,2]}',
    '{}',
])
def test_widget_addCharts_invalid_shapes_still_refuse(args_json):
    refuses("widget.addCharts", args_json)


# ── the same normalizer on the strict (embedded-args) path and on planner v2 ──────────────────────────────────────

def test_the_strict_embedded_path_normalizes_too_and_never_raises():
    caps = [cap("chart.replay"), cap("screener.run")]
    env = {"disposition": "apply", "ops": [
        {"action": "chart.replay", "target": "c1", "args": {"date": "null"}},
        {"action": "screener.run", "target": "s1", "args": {"sort_field": "chg_pct_3m", "sort_dir": "Descending", "mode": "refine", "show": None, "as": None, "within": None}},
        {"action": "nope.action", "target": "c1", "args": {"x": "null"}},
        {"action": "chart.replay", "target": "c1", "args": "not an object"},
    ]}
    out = turn.normalize_embedded_ops(env, caps)
    assert out["ops"][0]["args"] == {"date": None}
    assert {**out["ops"][1]["args"], "logic": None, "rank": None} == WANT_SORT     # the strict grammar always fills these two
    assert out["ops"][2] == env["ops"][2] and out["ops"][3] == env["ops"][3]


def test_normalize_args_never_mutates_the_models_object_and_reports_rules():
    c = cap("screener.run")
    given = {"sort": {"field": "chg_pct_3m", "dir": "DESC"}, "mode": "refine"}
    out, applied = turn.normalize_args(c, given)
    assert given == {"sort": {"field": "chg_pct_3m", "dir": "DESC"}, "mode": "refine"}
    assert out == {"sort_field": "chg_pct_3m", "sort_dir": "desc", "mode": "refine", "filters": []}
    assert applied == ["alias:sort.field->sort_field", "alias:sort.dir->sort_dir", "filters:default", "sort_dir:enum-case"]
    assert turn.normalize_args(c, "nope") == ("nope", [])


def test_the_existing_refusal_rules_are_unchanged_for_a_capability_that_declares_nothing():
    """The 2026-10-08 cases: a flat lone object is wrapped only on an exact key match; a bare synonym key is not an alias."""
    sym = {"anyOf": [{"type": "array", "items": {"type": "string"}},
                     {"type": "object", "properties": {"from": {"type": "string"}, "top": {"type": ["integer", "null"]}},
                      "required": ["from", "top"], "additionalProperties": False}]}
    caps = turn.validate_manifest([{"name": "watchlist.add", "domain": "watchlist", "target": "watchlist", "summary": "Add.", "risk": "local",
                                    "args": {"type": "object", "properties": {"symbols": sym}, "required": ["symbols"], "additionalProperties": False}}])
    assert caps[0]["argAliases"] is None
    for bad in ('{"tickers": ["NVDA"]}', '{"from": "lastScreen"}', '{"symbols": {"from": "w1", "top": "two"}}'):
        with pytest.raises(turn.TurnError):
            turn.expand_compact_ops({"ops": [{"action": "watchlist.add", "target": "w2", "args_json": bad}]}, caps)
    ok = turn.expand_compact_ops({"ops": [{"action": "watchlist.add", "target": "w2", "args_json": '{"symbols": {"from": "w1", "top": "2"}}'}]}, caps)
    assert ok["ops"][0]["args"] == {"symbols": {"from": "w1", "top": 2}}       # the schema-driven rule alone


# ── R-03 (LT-10): nonsense → a clarify with choices, no model call; a real message keeps its own sentence ────────

def _resp(env_dict):
    return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(env_dict))], stop_reason="end_turn",
                                 usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))


CTX = {"surface": "charts", "charts": [{"ref": "c1", "label": "Chart (SPY)", "symbol": "SPY"}]}


@pytest.mark.parametrize("message", ["asdf qwer", "qwerty", "asdfgh jkl", "zxcv", "aaaa", "???", "...", "asdf, qwer!", "hjkl;"])
def test_a_keyboard_run_is_a_clarify_with_choices_and_zero_model_calls(message):
    assert turn.looks_like_nonsense(message)
    calls = []

    def caller(**kw):
        calls.append(kw)
        raise AssertionError("the model must not be called")
    out = turn.run_turn(message=message, context=CTX, history=[], capabilities=[BY["chart.setType"]], caller=caller)
    env = out["envelope"]
    assert env["disposition"] == "clarify" and env["ops"] == []
    assert env["question"]["text"] == turn.NONSENSE_QUESTION
    assert [c["label"] for c in env["question"]["choices"]] == list(turn.NONSENSE_CHOICES)
    assert calls == [] and out["usage"]["model_calls"] == 0 and out["usage"]["nonsense"] is True


@pytest.mark.parametrize("message", ["nvda", "ok", "undo", "weekly", "add the 9 and 20 ema", "spy", "sell 100 nvda", "123", "what", "hi",
                                     "sad", "pop", "a", "go", "rename Main Trading to x", "sort them by 3 month performance", "x",
                                     # W1.1 review NB-5: a ticker as written ($-prefixed or ALL CAPS) is never nonsense, even on a
                                     # keyboard row ("ASDF" in caps is now read as a ticker; lower-case "asdf" stays nonsense)
                                     "MMM", "RTY", "$RTY", "AAA", "$aaa", "ASDF", "chart RTY"])
def test_ordinary_words_tickers_and_numbers_are_never_nonsense(message):
    assert not turn.looks_like_nonsense(message)


def test_a_real_messages_unreadable_plan_keeps_its_own_sentence_never_the_clarify():
    many = turn.validate_manifest([BY[n] for n in FAMILIES] + [BY[n] for n in ("chart.setType", "chart.setTimeframe", "chart.setScale",
                                                                             "chart.setSession", "chart.goToDate", "chart.compare", "chart.setSymbol")])
    assert turn.compact_ops(many)
    bad = {"disposition": "apply", "reply": "", "question": None, "unsupported_category": None, "research": None,
           "ops": [{"action": "chart.setSetting", "target": "c1", "args_json": '{"setting":"bgGradient.enabled","value":false}'}]}
    with pytest.raises(turn.TurnError, match="couldn.t fill in the details") as e:
        turn.run_turn(message="turn the gradient off on this chart", context=CTX, history=[], capabilities=many, caller=lambda **kw: _resp(bad))
    assert e.value.reason == "unreadable:args_schema"
    empty = {"disposition": "answer", "reply": "  ", "question": None, "unsupported_category": None, "research": None, "ops": []}
    with pytest.raises(turn.TurnError, match="unreadable"):
        turn.run_turn(message="what is going on", context=CTX, history=[], capabilities=many, caller=lambda **kw: _resp(empty))
