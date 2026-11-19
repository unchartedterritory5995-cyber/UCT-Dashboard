"""VWAP'S STANDARD-DEVIATION BANDS ARE ONE SETTING OF A BUILT-IN, OFFERED IN ONE TAP
(coordinator's approval 2026-11-19).

"VWAP with 2 standard deviation bands" used to go to the assistant, which may not write those bands
as a formula (UCT's ruling: the bands are the session's volume-weighted deviation, and nothing else
may stand in for it). The honest answer was a sentence pointing at the Indicators list. UCT's own
Session VWAP draws the bands when its "Std dev bands" setting is on, so the door now answers that
request itself and offers the one action: add Session VWAP with that setting on.

Held here:
  * the library entry is ONE SETTING of a built-in (`built_in.setting`), with no aliases; the
    setting's input, label, values and what each value draws ARE the native registry's (read from
    `nativeRegistry.js`, so a change there fails here);
  * the request is read by a closed-form reader (`vwap_bands_ask`): "vwap", "band(s)", multiples of
    1, 2 or 3 and a short list of words, and NOTHING else. One other word and the door does not
    answer, so it can be wrong one way only: by not offering;
  * the offer always carries the setting's value, and is made only to a browser that said it can add
    Session VWAP now; every other browser, and every other request, goes on as before.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import json
import pathlib
import re

import pytest

from api.services import named_indicators as ni
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num, op,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

ROOT = pathlib.Path(__file__).resolve().parents[1]
INTRADAY, DAILY = {"sym": "NVDA", "tf": "5"}, {"sym": "NVDA", "tf": "D"}
OFFERS = ["note.by", "offer"]
BANDS = ni.entry("session_vwap_bands")
PM, SIGMA = chr(0xB1), chr(0x3C3)


def ask(conv, words, chart=INTRADAY, **kw):
    return conv.converse(words, user_id="u1", view=empty_view(0), chart=chart, **kw)


# ═══ 1. the entry, and the registry it speaks for ════════════════════════

def test_the_entry_is_one_setting_of_session_vwap():
    assert ni.built_in(BANDS)["indicator"] == "vwap" and ni.built_in(BANDS)["name"] == "Session VWAP"
    assert ni.built_in_setting(BANDS) == {"input": "bands", "label": "Std dev bands", "values": ["1", "2", "3"], "default": "2"}
    assert BANDS["aliases"] == [] and BANDS in ni.held_names() and not ni.passes(BANDS)
    # no phrase in the door's lexicon leads to it: it is never refused by name
    assert not [spelling for spelling, entry_id in ni.phrases() if entry_id == BANDS["id"]]
    assert ni.built_in_answer(BANDS) == (
        "Session VWAP, one of UCT's own indicators, draws VWAP standard deviation bands itself when its Std dev bands "
        "setting is on: bands one, two or three volume-weighted standard deviations either side of the session's VWAP, "
        "on intraday charts. It is not a formula to build here.")
    assert ni.way_forward(BANDS).endswith("Look for Session VWAP in the Indicators list and turn on its Std dev bands setting.")
    # a plain built-in has no setting
    assert ni.built_in_setting(ni.entry("rs_rating")) is None and ni.built_in_setting(None) is None


@pytest.mark.parametrize("broken", [
    {"input": "bands", "label": "Std dev bands", "values": ["1", "2"], "default": "3"},     # a default it does not hold
    {"input": "bands", "label": "Std dev bands", "values": [], "default": "2"},
    {"input": "", "label": "Std dev bands", "values": ["2"], "default": "2"},
    {"input": "bands", "values": ["2"], "default": "2"},
    {"input": "bands", "label": "Std dev bands", "values": [2], "default": "2"},
    "bands",
])
def test_a_setting_that_does_not_read_is_not_a_plain_built_in_either(broken):
    """Adding Session VWAP WITHOUT the setting would add something other than what was asked for."""
    e = json.loads(json.dumps(BANDS))
    e["built_in"]["setting"] = broken
    assert ni.built_in(e) is None and ni.built_in_setting(e) is None


def _registry_bands():
    registry = (ROOT / "app" / "src" / "components" / "chart" / "engine" / "nativeRegistry.js").read_text(encoding="utf-8")
    block = re.search(r"nativeDef\('vwap', 'vwap',(.*?)compute: \{ kind: 'native', fn: 'vwap'", registry, re.S)
    assert block, "no Session VWAP definition in the native registry"
    got = re.search(r"key: '([^']+)', type: 'enum', label: '(Std dev bands)', default: '([^']+)',\s*options: \[(.*?)\],\n",
                    block.group(1), re.S)
    assert got, "Session VWAP has no 'Std dev bands' setting in the native registry"
    return got.group(1), got.group(2), got.group(3), dict(re.findall(r"\['([^']+)', '([^']+)'\]", got.group(4)))


def test_the_setting_is_the_native_registrys_own():
    """The door asks for a value of the browser registry's setting, by its key. The key, the label, the
    values and WHAT EACH VALUE DRAWS are read from the registry's source here."""
    key, label, default, options = _registry_bands()
    setting = ni.built_in_setting(BANDS)
    assert (key, label) == (setting["input"], setting["label"])
    # OFF unless asked for: an offer that did not carry the value would add a VWAP with no bands
    assert default == "off" and options["off"] == "Off"
    # the door may ask for every value that draws bands, and no other
    assert setting["values"] == [v for v in options if v != "off"]
    # ⭐ value n draws EVERY band up to n: what makes "the largest multiple named" the value to ask for
    for value in setting["values"]:
        assert options[value] == ", ".join(f"{PM}{k}{SIGMA}" for k in range(1, int(value) + 1)), value


def test_the_browsers_copy_carries_the_input_and_its_values():
    doc = json.loads((ROOT / "app" / "src" / "components" / "chart" / "builder" / "authoring" / "checkedLibrary.json").read_text(encoding="utf-8"))
    row = next(r for r in doc["builtIns"] if r["id"] == "session_vwap_bands")
    assert row == {"id": "session_vwap_bands", "name": "VWAP standard deviation bands", "indicator": "vwap",
                   "builtInName": "Session VWAP", "setting": {"input": "bands", "values": ["1", "2", "3"]}}


# ═══ 2. the reader ═══════════════════════════════════════════════════════

@pytest.mark.parametrize("words,value", [
    ("vwap bands", "2"), ("VWAP with 2 standard deviation bands", "2"), ("Can you add VWAP with 3 sigma bands?", "3"),
    (f"add vwap with {PM}1{SIGMA} and {PM}2{SIGMA} bands", "2"), (f"vwap 2{SIGMA} bands", "2"),
    ("plot session vwap with upper and lower std dev bands", "2"), ("vwap bands at 1, 2 and 3 standard deviations", "3"),
    ("vwap 1-2 sd bands", "2"), ("vwap with +/-2 std dev bands", "2"), ("VWAP std-dev bands", "2"),
    ("show me the vwap and its 1 and 2 standard deviation bands please", "2"), ("vwap bands 1.0 and 2.0", "2"),
    ("vwap with 1 standard deviation band", "1"),
])
def test_a_request_that_is_only_the_bands_is_read(conv, words, value):
    assert conv.vwap_bands_ask(words) == value, words


@pytest.mark.parametrize("words", [
    "anchored vwap bands", "weekly vwap with sigma bands", "daily vwap bands",          # another VWAP
    "add vwap with bands at 2.5 standard deviations", "vwap bands at 4 std dev",       # a multiple the setting does not draw
    "vwap with 20 period bands", "vwap bands 0",
    "alert when price closes above the upper vwap band", "color bars above vwap band",  # a rule, not the bands
    "vwap bands and rsi", "vwap bands on AAPL", "vwap bands since the open of the year",
    "what are vwap bands?", "does vwap have bands",                                    # a question about them
    "vwap", "bands", "bollinger bands", "vwap vwap bands", "volume weighted average price bands",
    "vwap bands #2", "vwap bands = 2", "", "   ", "vwap bands " + "please " * 30,
])
def test_one_other_word_and_the_door_does_not_answer(conv, words):
    assert conv.vwap_bands_ask(words) is None, words


def test_what_is_not_text_is_not_a_request(conv):
    for other in (None, 7, ["vwap bands"], {"message": "vwap bands"}):
        assert conv.vwap_bands_ask(other) is None


# ═══ 3. the offer ════════════════════════════════════════════════════════

def test_the_offer_always_carries_the_settings_value(conv):
    base = {"kind": "add_built_in", "indicator": "vwap", "name": "Session VWAP",
            "label": "Add Session VWAP with its Std dev bands on to this chart"}
    assert conv.built_in_offer(BANDS, "3") == {**base, "inputs": {"bands": "3"}}
    assert conv.built_in_offer(BANDS) == {**base, "inputs": {"bands": "2"}}                 # none named: the default
    for other in ("off", "4", 2, None, ""):
        assert conv.built_in_offer(BANDS, other)["inputs"] == {"bands": "2"}, other         # never a value it does not hold
    # a plain built-in carries no inputs, whatever is passed
    assert "inputs" not in conv.built_in_offer(ni.entry("rs_rating"), "2")


@pytest.mark.parametrize("words,value", [
    ("VWAP with 2 standard deviation bands", "2"), ("add vwap bands", "2"), ("vwap with 3 sigma bands", "3"),
    ("vwap with 1 standard deviation band", "1"),
])
def test_a_browser_that_can_add_session_vwap_is_answered_and_offered_it(conv, clean_env, model, words, value):
    client = model([])
    r = ask(conv, words, accepts=OFFERS, addable=["rsRating", "vwap"])
    assert client.calls == []                                             # no assistant call
    assert r["ok"] is True and r["disposition"] == "answer" and r["turn"] == "offer" and r["answered_by"] == "door"
    assert r["reply"] == ni.built_in_answer(BANDS)
    assert r["offer"] == {"kind": "add_built_in", "indicator": "vwap", "name": "Session VWAP",
                          "label": "Add Session VWAP with its Std dev bands on to this chart", "inputs": {"bands": value}}
    # nothing is built and nothing is changed by the answer itself
    assert r["envelope"]["ops"] == [] and r["envelope"]["disposition"] == "answer" and r["envelope"]["reply"] == r["reply"]
    assert r["cost_usd"] == 0.0 and r["attempts"] == 0
    assert conv.check_envelope(r["envelope"], 0, empty_view(0))


def test_it_is_offered_on_a_daily_chart_too(conv, clean_env, model):
    """Where it draws is the window's to say on the tap (it knows the chart's timeframe at that moment)."""
    client = model([])
    r = ask(conv, "vwap bands", chart=DAILY, accepts=OFFERS, addable=["vwap"])
    assert client.calls == [] and r["offer"]["inputs"] == {"bands": "2"}


@pytest.mark.parametrize("kw,why", [
    ({}, "an older tab says nothing"),
    ({"accepts": ["note.by"], "addable": ["vwap"]}, "it does not accept an offer"),
    ({"accepts": OFFERS}, "it did not say what it can add"),
    ({"accepts": OFFERS, "addable": ["rsRating", "rsPhases"]}, "it can add others, not Session VWAP"),
])
def test_any_other_browser_is_read_by_the_assistant_as_before(conv, clean_env, model, kw, why):
    client = model([emits(env(0, [], disposition="answer", reply="Session VWAP in the Indicators list draws them."))])
    r = ask(conv, "VWAP with 2 standard deviation bands", **kw)
    assert len(client.calls) == 1 and "offer" not in r, why
    assert r["ok"] is True and r.get("answered_by") != "door" and r.get("turn") != "offer", why


@pytest.mark.parametrize("words", ["VWAP with 2.5 standard deviation bands", "vwap bands and mark closes above the upper band"])
def test_a_request_with_more_in_it_is_the_assistants_even_when_the_browser_can_add(conv, clean_env, model, words):
    client = model([emits(env(0, [], disposition="answer", reply="Session VWAP in the Indicators list draws them."))])
    r = ask(conv, words, accepts=OFFERS, addable=["vwap"])
    assert "offer" not in r and len(client.calls) == 1, words


def test_a_name_that_is_a_built_in_is_still_offered_without_inputs(conv, clean_env, model):
    """CONTROL: the plain built-in's offer is what it was."""
    model([])
    r = ask(conv, "Add the RS Rating", chart=DAILY, accepts=OFFERS, addable=["rsRating", "vwap"])
    assert r["offer"] == {"kind": "add_built_in", "indicator": "rsRating", "name": "UCT RS Rating",
                          "label": "Add UCT RS Rating to this chart"}
