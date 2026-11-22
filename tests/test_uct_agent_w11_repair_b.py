"""W1.1 repair-b (overnight 2026-11-03, BOARD R-04..R-06) — the server half.

R-04 (live LT-4): "mark when the 9 ema crosses above the 20 on this chart" → "Indicator alerts … I can't create them
yet from here" while indicatorAlert.create was in the manifest. The server never lets a false capability claim reach
the member: a claim about a family in the manifest gets ONE repair round (legacy and NL-1 alike) and, if repeated,
becomes a clarify; a claim about a family in a group the request was not given becomes need_groups (the browser's
bounded reroute). An honest limit (no such actions anywhere) is left alone.

R-05 (live LT-8 / LT-11): a hidden-field PHRASE in the member's own words ("rs rank", "uct composite", "dark pool"…)
is refused with the F-16 sentence + the public alternative BEFORE any catalog look-alike mapping — in refine.py
(refusal_for_text, from hidden.py's one phrase list) and in the turn (a planned screen is dropped, nothing runs).
Mutation: removing the phrase list / the turn guard turns these red. No model, no provider, no network.
"""
from __future__ import annotations

import json

import pytest

from api.services.uct_agent import turn
from api.services.uct_agent.scan import hidden, refine
from tests.test_uct_agent import CAPS, CTX, _resp, caller_of, env  # noqa: F401

ARGS = {"type": "object", "properties": {}, "required": [], "additionalProperties": False}
IA_CREATE = {"name": "indicatorAlert.create", "domain": "indicatorAlert", "target": "indicatorAlertLibrary", "risk": "confirm",
             "reversible": True, "summary": "Create an indicator alert.", "hints": None,
             "args": {"type": "object", "properties": {"instance": {"type": "string"}, "plot": {"type": "string"},
                                                       "condition": {"type": "string"}, "threshold": {"type": ["number", "null"]}},
                      "required": ["instance", "plot", "condition", "threshold"], "additionalProperties": False}}
IA_TOGGLE = {"name": "indicatorAlert.toggle", "domain": "indicatorAlert", "target": "indicatorAlert", "risk": "local", "reversible": True,
             "summary": "Pause / resume.", "hints": None, "args": ARGS}
PRICE_ALERT = {"name": "alert.create", "domain": "alert", "target": "alertLibrary", "risk": "confirm", "reversible": True,
               "summary": "Create a price alert.", "hints": None,
               "args": {"type": "object", "properties": {"symbol": {"type": "string"}, "price": {"type": "number"}},
                        "required": ["symbol", "price"], "additionalProperties": False}}
LAYOUT_RENAME = {"name": "layout.rename", "domain": "layout", "target": "layout", "risk": "confirm", "reversible": True,
                 "summary": "Rename a saved layout.", "hints": None,
                 "args": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"], "additionalProperties": False}}
SCREEN = {"name": "screener.run", "domain": "screener", "target": "screener", "risk": "local", "reversible": True,
          "summary": "Run a screen.", "hints": None,
          "args": {"type": "object", "properties": {"filters": {"type": "array"}, "sort_field": {"type": ["string", "null"]},
                                                    "sort_dir": {"type": ["string", "null"]}, "mode": {"type": "string"},
                                                    "show": {"type": ["integer", "null"]}, "as": {"type": ["string", "null"]},
                                                    "within": {"type": ["string", "null"]}},
                   "required": ["filters", "sort_field", "sort_dir", "mode", "show", "as", "within"], "additionalProperties": False}}
ALL = CAPS + [IA_CREATE, IA_TOGGLE, PRICE_ALERT, LAYOUT_RENAME, SCREEN]
CTX2 = {**CTX, "indicatorAlertLibrary": [{"ref": "indicatorAlerts", "label": "Indicator alerts"}],
        "screener": [{"ref": "screener", "label": "Screener"}], "layouts": [{"ref": "l1", "label": "Main Trading", "protected": True}]}
NAMES = {c["name"] for c in ALL}

LT4_REPLY = ("Indicator alerts (like an EMA crossover) are set up in UCT's Indicator Alerts panel from the chart's indicator menu. "
             "I can't create them yet from here.")
LT9_REPLY = "Renaming chart tabs is in UCT's Workspace menu — I can't do it yet from here. You can right-click the tab to rename it."


@pytest.fixture(autouse=True)
def _no_cost(monkeypatch):
    monkeypatch.setattr(turn, "_record_cost", lambda resp: 0.001)


def _unsupported(reply, cat="alerts"):
    return env("unsupported", reply=reply, cat=cat)


# ── R-04: the detector ──────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("reply,disp", [
    (LT4_REPLY, "unsupported"),
    (LT4_REPLY, "answer"),
    ("Indicator alerts aren't available in UCT Agent yet.", "answer"),
    ("I don't have a way to create an indicator alert from here. Use the Indicator Alerts popover on the chart.", "answer"),
    ("An alert on the 9 EMA crossing the 20 isn't something I can set up from here yet.", "unsupported"),
    ("Setting indicator alerts is not supported in UCT Agent; it's handled in the alert manager.", "answer"),
])
def test_a_claim_about_indicator_alerts_is_caught_when_the_actions_are_in_the_manifest(reply, disp):
    c = turn.false_capability_claim(env(disp, reply=reply, cat="alerts" if disp == "unsupported" else None), NAMES)
    assert c and c["family"] == "indicatorAlerts" and c["where"] == "caps"
    assert "indicatorAlert.create" in c["error"] and "AVAILABLE ACTIONS" in c["error"]
    assert "indicator alerts" in c["question"].lower()


def test_a_claim_about_a_family_in_an_unsent_group_becomes_a_reroute_and_an_honest_limit_is_left_alone():
    # the family lives in a group the request was not given → need_groups (the browser asks once more)
    c = turn.false_capability_claim(env("answer", reply=LT4_REPLY), {"chart.setType"}, {"indicatorAlerts", "lists"})
    assert c == {"family": "indicatorAlerts", "where": "group", "groups": ["indicatorAlerts"], "question": c["question"], "error": None}
    # no such actions anywhere (a member without the capability): the model's limit is honest
    assert turn.false_capability_claim(env("answer", reply=LT4_REPLY), {"chart.setType"}, {"lists"}) is None
    assert turn.false_capability_claim(env("answer", reply=LT4_REPLY), {"chart.setType"}, None) is None


@pytest.mark.parametrize("e", [
    # an honest unsupported that points to a REAL alternative in another sentence is not a claim about that family
    _unsupported("Trading and order execution aren't available in UCT Agent yet. You can set a price alert instead.", "account"),
    # an answer with no limitation in it
    env("answer", reply="The 9 EMA crossing above the 20 is a short-term momentum signal; many traders use it as an entry trigger."),
    # a plan is never a claim (ops present)
    env("apply", ops=[{"action": "indicatorAlert.create", "target": "indicatorAlerts", "args": {}}], reply=""),
    # a question is never a claim
    env("clarify", reply="", question={"text": "Which chart?", "choices": []}),
    # "can't" about something that is not an action family in the manifest
    env("answer", reply="I can't predict where NVDA will be next week — nobody can — but the trend is up on the daily."),
])
def test_no_false_positive_on_honest_or_unrelated_replies(e):
    assert turn.false_capability_claim(e, NAMES, {"lists"}) is None


def test_only_the_live_families_are_checked_and_price_alerts_are_out_of_scope():
    # W1.1 review BLOCKING-1: the check covers the families seen live (indicator alerts, rename) only
    assert turn.false_capability_claim(env("answer", reply="Price alerts aren't available from here yet."), NAMES) is None
    assert [f[0] for f in turn.CLAIM_FAMILIES] == ["indicatorAlerts", "rename", "undo"]   # undo: live T2, hotfix 2026-11-03
    # "indicator alerts" never counts when only alert.* exists
    assert turn.false_capability_claim(env("answer", reply="Indicator alerts aren't available from here yet."), {"alert.create"}) is None


# W1.1 review BLOCKING-1: the reviewer's six probes — honest PARTIAL limits, never a claim (no repair, no clarify)
HONEST_PARTIAL = [
    "Screens run on end-of-day data, so a live intraday count isn't available.",
    "Alerts by SMS aren't supported yet.",
    "Exporting a layout to a file isn't possible from here.",
    "Sharing drawings with other members isn't available from here.",
    "I can't share a watchlist with another member.",
    "I can't place trades from here, but I can set a price alert.",
]


@pytest.mark.parametrize("reply", HONEST_PARTIAL)
@pytest.mark.parametrize("disp", ["answer", "unsupported"])
def test_honest_partial_limits_are_never_claims(reply, disp):
    e = env(disp, reply=reply, cat="account" if disp == "unsupported" else None)
    assert turn.false_capability_claim(e, NAMES) is None
    assert turn.false_capability_claim(e, NAMES, {"lists", "layouts", "alerts", "drawings", "screener", "indicatorAlerts"}) is None


@pytest.mark.parametrize("reply", HONEST_PARTIAL)
def test_honest_partial_limits_are_served_with_one_call(reply):
    c = caller_of(_resp(env("answer", reply=reply)))
    out = turn.run_turn(message="can you do that", context=CTX2, history=[], capabilities=ALL, caller=c)
    assert out["usage"]["model_calls"] == 1 and "false_claim" not in out["usage"]
    assert out["envelope"]["disposition"] == "answer" and out["envelope"]["reply"] == reply


def test_a_qualified_indicator_alert_limit_is_honest():
    # an indicator-alert limit about a CHANNEL is a partial limit, not the family
    assert turn.false_capability_claim(env("answer", reply="I can't send indicator alerts by SMS from here yet."), NAMES) is None


# ── R-04: the turn — one repair round, then a clarify; never the claim ─────────────────────────────────────────────

def _plan_ia(compact=False):
    args = {"instance": "inst:ema:1", "plot": "ema", "condition": "cross_above", "threshold": None}
    op = {"action": "indicatorAlert.create", "target": "indicatorAlerts", **({"args_json": json.dumps(args)} if compact else {"args": args})}
    return env("propose", ops=[op], reply="Alert when the 9 EMA crosses above the 20 on this chart.")


@pytest.mark.parametrize("interpreter", [None, "nl1"])
def test_the_false_claim_gets_one_repair_round_and_the_repaired_plan_is_served(interpreter, monkeypatch):
    monkeypatch.setenv("UCT_AGENT_NL1", "1")
    c = caller_of(_resp(_unsupported(LT4_REPLY)), _resp(_plan_ia(compact=interpreter == "nl1")))
    out = turn.run_turn(message="mark when the 9 ema crosses above the 20 on this chart", context=CTX2, history=[],
                        capabilities=ALL, caller=c, interpreter=interpreter)
    assert out["usage"]["model_calls"] == 2 and out["usage"]["repaired"] == "server" and out["usage"]["false_claim"] == "indicatorAlerts"
    # the repair message names the actions that exist and says the claim is false
    second = c.calls[1]["messages"]
    assert second[-2]["role"] == "assistant" and "validation_error" in second[-1]["content"]
    assert "indicatorAlert.create" in second[-1]["content"] and "Never say they are unavailable" in second[-1]["content"]
    assert out["envelope"]["disposition"] == "propose" and out["envelope"]["ops"][0]["action"] == "indicatorAlert.create"
    assert "can't" not in out["envelope"]["reply"]


def test_a_repeated_claim_after_the_repair_serves_the_models_reply_and_logs_codes_only(caplog):
    # W1.1 review BLOCKING-1: the detector is a heuristic; after its one repair the model's own reply is served
    c = caller_of(_resp(_unsupported(LT4_REPLY)), _resp(_unsupported(LT4_REPLY)))
    with caplog.at_level("WARNING"):
        out = turn.run_turn(message="mark when the 9 ema crosses above the 20 on this chart", context=CTX2, history=[], capabilities=ALL, caller=c)
    assert out["usage"]["model_calls"] == 2 and out["usage"]["false_claim"] == "indicatorAlerts"
    e = out["envelope"]
    assert e["disposition"] == "unsupported" and e["ops"] == [] and e["reply"] == LT4_REPLY and not e.get("false_claim")
    logged = " | ".join(r.getMessage() for r in caplog.records if "false capability" in r.getMessage())
    assert "repeated after repair (indicatorAlerts)" in logged and "Indicator Alerts panel" not in logged


def test_no_call_left_means_the_clarify_at_once_and_a_reply_that_names_a_real_limit_is_served():
    class Meter:                      # the request's last call was this one: no repair round, the clarify at once
        def calls_left(self):
            return 0

        def call(self, category, fn, **kw):
            return fn(**kw)
    c = caller_of(_resp(_unsupported(LT4_REPLY)))
    out = turn.run_turn(message="mark when the 9 ema crosses above the 20 on this chart", context=CTX2, history=[], capabilities=ALL,
                        caller=c, meter=Meter())
    assert out["usage"]["model_calls"] == 1 and "repaired" not in out["usage"]
    assert out["envelope"]["disposition"] == "clarify" and out["envelope"]["false_claim"] == "indicatorAlerts"
    # the honest limit ("trading") is served as the model wrote it
    c2 = caller_of(_resp(_unsupported("Trading and order execution aren't available in UCT Agent yet.", "account")))
    out2 = turn.run_turn(message="sell 100 nvda", context=CTX2, history=[], capabilities=ALL, caller=c2)
    assert out2["usage"]["model_calls"] == 1 and out2["envelope"]["disposition"] == "unsupported"
    assert out2["envelope"]["reply"].startswith("Trading and order execution")


def test_a_claim_about_a_group_the_request_was_not_given_is_a_reroute_with_no_extra_call():
    routing = {"version": 1, "groups": [{"id": "charts", "title": "Charts"}, {"id": "indicatorAlerts", "title": "Indicator alerts"},
                                        {"id": "agent", "title": "UCT Agent"}], "selected": ["charts", "agent"]}
    c = caller_of(_resp({**_unsupported(LT4_REPLY), "need_groups": None}))
    out = turn.run_turn(message="mark when the 9 ema crosses above the 20 on this chart", context=CTX2, history=[], capabilities=CAPS,
                        caller=c, routing=routing)
    e = out["envelope"]
    assert out["usage"]["model_calls"] == 1 and e["disposition"] == "clarify" and e["need_groups"] == ["indicatorAlerts"] and e["ops"] == []


def test_lt9_rename_claim_is_repaired_when_layout_rename_exists():
    c = caller_of(_resp(env("answer", reply=LT9_REPLY)), _resp(env("answer", reply="Main Trading is a protected layout, so I can't rename it — I can save a copy under a new name instead.")))
    out = turn.run_turn(message="rename Main Trading to x", context=CTX2, history=[], capabilities=ALL, caller=c)
    assert out["usage"]["false_claim"] == "rename" and out["usage"]["model_calls"] == 2
    # the second answer names a limit on a PROTECTED layout, not an unavailable family: served
    assert out["envelope"]["disposition"] == "answer" and "protected" in out["envelope"]["reply"]


def test_the_legacy_prompt_carries_the_rule():
    p = turn.system_prompt(turn.validate_manifest(ALL))
    assert "NEVER A FALSE LIMITATION" in p and "validation_error" in p.lower()
    for t in turn.nl1_system_texts(turn.validate_manifest(ALL)):
        assert "NEVER A FALSE LIMITATION" in t


# ── R-05: hidden-field PHRASES → the F-16 sentence + the public alternative, before any look-alike ──────────────────

PHRASES = [
    ("now only the ones with rs rank over 90", "rs_rank"),
    ("stocks with an rs rating above 95", "rs_rank"),
    ("rs over 90", "rs_rank"),
    ("only names with relative strength rank 90 or better", "rs_rank"),
    ("show me the rs leaders", "rs_rank"),
    ("sort them by uct composite", "uct_composite"),
    ("just the ones with a uct score above 80", "uct_composite"),
    ("filter to composite over 85", "uct_composite"),
    ("stocks with an eps rating of 90+", "rating_eps"),
    ("only an smr rating of a", "rating_smr"),
    ("names with sponsorship grade b or better", "sponsorship"),
    ("the ones with acc/dis a", "accdis"),
    ("which stocks have an accumulation distribution grade of a", "accdis"),
    ("keep only setup score over 70", "candle_score"),
    ("stocks with an earnings setup grade of a", "earnings_setup_grade"),
    ("find stocks in the uct 20", "in_uct20"),
    ("only the ones in the uct theme ai", "theme"),
    ("stocks with a high volume close this year", "hvc_52w"),
    ("rank them by pattern engine confidence", "pattern_engine_id"),
    ("find stocks with dark pool prints over 10m", "dp_notional_1d"),
    ("only names with bullish options flow", "opt_net_premium_1d"),
    ("stocks with net premium over 5m", "opt_net_premium_1d"),
    # W1.1 review BLOCKING-2: the hidden forms next to the public ones stay refused
    ("sort by highest rs", "rs_rank"),
    ("composite rating above 90", "uct_composite"),
    # owner HOLD 2026-11-03: the catalog's only A/D field is the proprietary accdis grade (no public OHLCV A/D line)
    ("accumulation distribution line rising", "accdis"),
]


@pytest.mark.parametrize("text", ["sort by highest rs line", "sort by lowest rs line", "highest relative strength line",
                                  "stocks above the nasdaq composite", "outperforming the nasdaq composite"])
def test_blocking2_public_rs_line_and_nasdaq_composite_are_not_hidden(text):
    assert hidden.hidden_phrase_in(text) is None and refine.refusal_for_text(text) is None


def test_no_public_ad_line_field_exists_so_the_ad_phrase_stays_refused():
    # owner 2026-11-03: a conventional OHLCV A/D line would be public; if one is ever added to the catalog, this fails
    # and the accdis phrase must be narrowed to the rating words
    from api.services.screener import filters
    ad = [f["key"] for f in filters.field_catalog()
          if any(w in (f["key"] + " " + str(f.get("label") or "")).lower() for w in ("accum", "distrib", "a/d", "acc/dis", "accdis"))]
    assert ad == ["accdis"] and "accdis" in hidden.hidden_keys()


@pytest.mark.parametrize("text,key", PHRASES)
def test_the_phrase_detector_names_the_hidden_key_and_the_refusal_carries_the_alternative(text, key):
    hit = hidden.hidden_phrase_in(text)
    assert hit and hit[0] == key and key in hidden.hidden_keys()
    why = refine.refusal_for_text(text)
    assert why and why.startswith(hidden.FLOW_REFUSAL if key in hidden.flow_keys() else hidden.RATINGS_REFUSAL)
    assert "A public alternative:" in why and refine.public_alternative(key)["key"] in why


@pytest.mark.parametrize("text", [
    "stocks with rsi over 70", "rs line above spy", "above the 20 ema with volume 2x", "now only tech",
    "sort them by 3 month performance", "price over 10 bucks", "which stocks gained over 5% today", "my strongest stocks",
    "turn on dark pool levels on this chart",   # a chart control, not a screen — the phrase is seen, the TURN gate ignores it
])
def test_public_fields_and_look_alikes_are_not_hidden_phrases(text):
    assert refine.refusal_for_text(text) is None or turn.hidden_screen_request(text) is False


def test_the_phrase_list_is_the_mirrors_and_every_key_is_hidden():
    assert all(key in hidden.hidden_keys() for _, key in hidden.HIDDEN_PHRASES)
    mirror = hidden.mirror_text()
    assert "export const HIDDEN_PHRASES" in mirror and "hiddenPhraseIn" in mirror
    for pat, key in hidden.HIDDEN_PHRASES:
        assert json.dumps([pat, key]) in mirror


def _screen_op(field="rs_line_trend"):
    return env("apply", ops=[{"action": "screener.run", "target": "screener",
                              "args": {"filters": [{"field": field, "op": "gt", "value": 90, "max": None, "values": None}],
                                       "sort_field": None, "sort_dir": None, "mode": "refine", "show": None, "as": None, "within": None}}])


def test_lt8_a_planned_look_alike_for_a_hidden_phrase_is_dropped_and_the_sentence_with_alternative_is_the_answer():
    c = caller_of(_resp(_screen_op("rs_line_trend")))
    out = turn.run_turn(message="now only the ones with rs rank over 90", context=CTX2, history=[], capabilities=ALL, caller=c)
    e = out["envelope"]
    assert out["usage"]["model_calls"] == 1 and out["usage"]["hidden_phrase"] is True and out["usage"]["research_calls"] == 0
    assert e["disposition"] == "answer" and e["ops"] == []
    assert e["reply"] == f"I didn't run it: {hidden.RATINGS_REFUSAL}. A public alternative: 3-month price change (chg_pct_3m)."


@pytest.mark.parametrize("text", [t for t, _ in PHRASES])
def test_every_phrasing_with_a_planned_screen_is_refused_in_the_turn(text):
    c = caller_of(_resp(_screen_op("chg_pct_3m")))
    out = turn.run_turn(message=text, context=CTX2, history=[], capabilities=ALL, caller=c)
    assert out["envelope"]["ops"] == [] and out["envelope"]["reply"].startswith("I didn't run it: UCT Agent can't screen on")
    assert "A public alternative:" in out["envelope"]["reply"]


def test_a_screen_shaped_hidden_phrase_is_refused_even_when_the_model_answered_in_prose_but_a_question_is_served():
    # the model wrote prose (a research-y answer) for a screen-shaped request on a hidden field: the sentence is served
    c = caller_of(_resp(env("answer", reply="Here are some names with a high RS rank: …")))
    out = turn.run_turn(message="show me stocks with rs rank over 90", context=CTX2, history=[], capabilities=ALL, caller=c)
    assert out["envelope"]["reply"].startswith("I didn't run it:") and "A public alternative:" in out["envelope"]["reply"]
    # a QUESTION about the field is not a screen: the model's explanation is served as written
    c2 = caller_of(_resp(env("answer", reply="RS Rank is UCT's relative-strength percentile.")))
    out2 = turn.run_turn(message="what is rs rank", context=CTX2, history=[], capabilities=ALL, caller=c2)
    assert out2["envelope"]["reply"] == "RS Rank is UCT's relative-strength percentile."
    # without screener.run in the manifest nothing changes (the member cannot screen here anyway)
    c3 = caller_of(_resp(env("answer", reply="Sure.")))
    out3 = turn.run_turn(message="show me stocks with rs rank over 90", context=CTX2, history=[], capabilities=CAPS, caller=c3)
    assert out3["envelope"]["reply"] == "Sure."
