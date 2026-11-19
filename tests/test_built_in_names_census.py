"""EVERY UCT BUILT-IN, BY THE NAME ON THE INDICATORS LIST (coordinator's ruling 2026-11-19).

Measured that day, with no assistant call: for each built-in definition of the native registry, how the
Create Indicator door takes "Add <the name on the list>". Three were REFUSED as unknown names although
they are on UCT's own list, and a dozen more went to the assistant with nothing behind the name. A member
who types the name they can see in the Indicators list must never be told UCT does not know it, and must
never get an improvisation where UCT has the checked thing.

THE CENSUS. The names come from `builtInNames.json`, generated from the running registry
(`builtInNames.test.js` holds it byte-for-byte, so a built-in that is added, renamed or removed changes
that file and is then named HERE). For every one, "Add <name>" is exactly one of:

  * a CHECKED LIBRARY FORMULA (the assistant is handed UCT's one formula for the name);
  * a GRAMMAR FUNCTION the whole name grounds (RSI, MACD, Bollinger Bands: built from that function by
    construction), or a HOUSE TERM with a chart formula (Relative Volume);
  * a BUILT-IN OFFER: answered by the door, with no assistant call, with the one-tap add. Its name is the
    registry's own, and where a formula could hold a version of it the answer also says
    "or describe what you'd change and I'll build your own";
  * one of the few NAMED EXCEPTIONS below, each with its reason and a check that the reason still holds.

Never an unknown-name refusal, and never anything else.

ALSO HELD: no answer about a built-in calls it "checked", and a built-in with an OPEN PARITY DEFECT
(`api/data/builtin_open_defects.json`) says what differs. UCT's built-in Ichimoku is the first entry.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import json
import pathlib
import re

import pytest

from api.services import chart_twins
from api.services import named_indicators as ni
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    CLOSE, call, conv, emits, empty_view, env, model, num, op,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

ROOT = pathlib.Path(__file__).resolve().parents[1]
NAMES = json.loads((ROOT / "app" / "src" / "components" / "chart" / "builder" / "authoring" / "builtInNames.json")
                   .read_text(encoding="utf-8"))["names"]
BY_ID = {n["id"]: n for n in NAMES}
CHART = {"sym": "AAPL", "tf": "5"}
OFFERS = ["note.by", "offer"]
spoken = lambda s: re.sub(r"[^a-z0-9%$]+", " ", str(s).lower()).strip()   # noqa: E731

#: ⛔ A SHORT LIST, AND EACH LINE MUST KEEP EARNING ITS PLACE: {registry id: (what the door reads instead,
#: why the name on the list is not an entry)}. `test_each_exception_still_has_its_reason` checks the first.
EXCEPTIONS = {
    "vwap": ("function:vwap", "the name is the `vwap` function with its own qualifier (\"Session\"): the assistant "
                              "builds it from that function; its deviation bands are the one-tap offer"),
    "movingAverage": ("generic:moving_average", "\"Moving Average\" is every average: the door asks which one"),
    "atrPercent": ("function:atr", "the door's matcher cannot anchor a name that ends in a percent sign, so the "
                                   "name could not be an alias; it is read as the `atr` function"),
    "adrPercent": ("house:adr_pct", "the Screener's ADR %, a house term with a chart formula (the percent sign aside)"),
    "upDownVolume": ("scalar:vol_updown_ratio", "a Screener term the door already reads: an earlier measurement ruled "
                                                "that this request is understood, not caught by name"),
    "squeeze": ("nothing", "a common word (\"a squeeze\", \"short squeeze\"): as a name it would catch requests that "
                           "only describe one; TTM Squeeze is its own held name"),
}


def reading(conv, words):
    """How the door takes "Add <words>": (kind, detail)."""
    u = conv.understand_turn("Add " + words, CHART)
    refusal = u.get("refusal")
    if refusal is not None:
        if u.get("built_in"):
            return "offer", u["built_in"]["id"]
        return "refused", refusal.get("gate")
    named = [e["id"] for e in (u.get("named") or [])]
    if named:
        return "library", named[0]
    for t in u.get("terms") or []:
        if spoken(t.get("matched_as")) != spoken(words):
            continue
        if t.get("section") == "functions":
            return "function", t.get("name")
        if t.get("section") == "scalars" and chart_twins.house_formula(t.get("name")):
            return "house", t.get("name")
    return "assistant", sorted(f"{t.get('section')}:{t.get('name')}" for t in (u.get("terms") or []))


# ═══ 1. the census ═══════════════════════════════════════════════════════

def test_the_list_is_the_registrys_and_every_exception_names_a_built_in():
    assert len(NAMES) >= 50 and len(BY_ID) == len(NAMES)
    assert set(EXCEPTIONS) <= set(BY_ID), sorted(set(EXCEPTIONS) - set(BY_ID))
    assert len(EXCEPTIONS) <= 6, "this list may only shrink: a new built-in gets an entry, a formula or a function"
    for reason in EXCEPTIONS.values():
        assert len(reason[1]) > 40


def test_every_built_in_is_answered_by_the_name_on_the_list(conv):
    found = {}
    for n in NAMES:
        kind, detail = reading(conv, n["name"])
        found.setdefault(kind, []).append(n["id"])
        if n["id"] in EXCEPTIONS:
            assert kind == "assistant", (n["id"], kind, detail)            # (its own check is below)
            continue
        # ⛔ never an unknown-name refusal, never an improvisation
        assert kind in ("library", "function", "house", "offer"), (
            f"{n['name']} ({n['id']}) is on UCT's Indicators list and the door takes its name as: {kind} {detail}. "
            "Give it a built-in name entry (named_seed), a checked formula, or record the exception with its reason.")
        if kind == "offer":
            assert ni.built_in(ni.entry(detail))["indicator"] == n["id"], (n["id"], detail)
    # every way of being answered is in use (so the reader above can tell them apart)
    assert {k for k in found} == {"library", "function", "house", "offer", "assistant"}
    assert sorted(found["assistant"]) == sorted(EXCEPTIONS)
    assert len(found["offer"]) >= 14 and len(found["library"]) >= 15 and len(found["function"]) >= 15


def test_each_exception_still_has_its_reason(conv):
    """An exception cannot outlive what excuses it: the door must still read what the line says it reads."""
    for def_id, (reads, _why) in EXCEPTIONS.items():
        u = conv.understand_turn("Add " + BY_ID[def_id]["name"], CHART)
        assert u.get("refusal") is None, (def_id, u.get("refusal"))
        terms = {f"{t.get('section')}:{t.get('name')}" for t in (u.get("terms") or [])}
        kind, name = reads.split(":") if ":" in reads else (reads, "")
        if kind == "function":
            assert f"functions:{name}" in terms, (def_id, terms)
        elif kind == "house":
            assert f"scalars:{name}" in terms and chart_twins.house_formula(name), (def_id, terms)
        elif kind == "scalar":
            assert f"scalars:{name}" in terms, (def_id, terms)
        elif kind == "generic":
            assert f"generic_phrases:{name}" in terms, (def_id, terms)
        else:
            assert kind == "nothing" and terms == set(), (def_id, terms)


# ═══ 2. an offered built-in is the registry's own ════════════════════════

def _offered():
    return [e for e in ni.built_ins() if ni.built_in_setting(e) is None]


def test_an_offer_names_the_built_in_exactly_as_the_list_does(conv):
    """The name a member is offered is the name they will then see in the Indicators list (derived from the
    registry's own list, never typed twice), and the list's own name always finds the entry."""
    for e in _offered():
        b = ni.built_in(e)
        row = BY_ID.get(b["indicator"])
        assert row is not None, f"{e['id']} offers {b['indicator']}, which the registry does not serve"
        assert b["name"] == row["name"], (e["id"], b["name"], row["name"])
        assert conv.built_in_offer(e) == {"kind": "add_built_in", "indicator": row["id"], "name": row["name"],
                                          "label": f"Add {row['name']} to this chart"}
        # the list's own name is one of the entry's spellings (this is what makes the offer reachable by it)
        assert row["name"].lower() in e["aliases"], (e["id"], row["name"])
        # its short name too, where it is a phrase the matcher can hold (two or more words of letters, one of four
        # letters or more) and not the name again; a bare acronym ("HV", "52W") never is
        short = row["shortName"]
        words = short.lower().split()
        if short and short != row["name"] and len(words) >= 2 and all(w.isalpha() for w in words) and any(len(w) >= 4 for w in words):
            assert short.lower() in e["aliases"], (e["id"], short)
        for spelled in e["aliases"]:
            kind, detail = reading(conv, spelled)
            assert (kind, detail) == ("offer", e["id"]), (e["id"], spelled, kind, detail)
    # an entry made for the name on the list carries that name itself
    own = [e for e in _offered() if e["id"].startswith("builtin_")]
    assert len(own) >= 10 and all(e["name"] == ni.built_in(e)["name"] for e in own)


def test_the_answer_says_what_it_is_and_what_else_the_member_can_do():
    said = ni.built_in_answer(ni.entry("builtin_atr_bands"))
    assert said == ("ATR Bands is one of UCT's own indicators: the close with a band a multiple of ATR either side of it. "
                    "Add it with one tap, or describe what you'd change and I'll build your own.")
    assert ni.OWN_VERSION_LINE == "Add it with one tap, or describe what you'd change and I'll build your own."
    # a rank across the whole market is nothing a formula on one chart could be, and the answer does not offer one
    rs = ni.built_in_answer(ni.entry("rs_rating"))
    assert rs.endswith("It is not a formula to build here.") and "build your own" not in rs
    assert ni.own_version(ni.entry("builtin_atr_bands")) and ni.own_version(ni.entry("builtin_uct_relative_strength"))
    assert not ni.own_version(ni.entry("rs_rating")) and not ni.own_version(None)
    # a name with a second, built-in name says both, once
    assert ni.built_in_answer(ni.entry("mansfield_relative_strength")) == (
        "Mansfield Relative Strength (UCT Mansfield RS) is one of UCT's own indicators: the RS line as a percent above "
        "or below its own long average, around a zero line. Add it with one tap, or describe what you'd change and "
        "I'll build your own.")
    for e in ni.built_ins():
        answer = ni.built_in_answer(e)
        assert len(answer) <= ni.SENTENCE_MAX, (e["id"], len(answer))
        assert ni.own_version(e) == answer.endswith(ni.OWN_VERSION_LINE) or ni.built_in_setting(e) is not None, e["id"]
        assert "::" not in answer and ": :" not in answer and answer.count(": ") <= 1, (e["id"], answer)


@pytest.mark.parametrize("words,entry_id", [
    ("Add Historical Volatility", "builtin_historical_volatility"), ("add the data series", "builtin_data_series"),
    ("UCT Relative Strength", "builtin_uct_relative_strength"), ("add bollinger %b", "builtin_bollinger_percent_b"),
    ("Add UCT Mansfield RS", "mansfield_relative_strength"), ("add the chaikin oscillator", "builtin_chaikin_oscillator"),
    ("52-Week High/Low", "builtin_fifty_two_week"), ("add % from ma", "builtin_percent_from_ma"),
])
def test_a_browser_that_can_add_it_is_answered_and_offered_it(conv, clean_env, model, words, entry_id):
    client = model([])
    e = ni.entry(entry_id)
    r = conv.converse(words, user_id="u1", view=empty_view(0), chart=CHART, accepts=OFFERS,
                      addable=[ni.built_in(e)["indicator"]])
    assert client.calls == []                                             # no assistant call
    assert r["ok"] is True and r["turn"] == "offer" and r["answered_by"] == "door"
    assert r["reply"] == ni.built_in_answer(e)
    assert r["offer"]["indicator"] == ni.built_in(e)["indicator"] and r["offer"]["name"] == ni.built_in(e)["name"]
    assert r["cost_usd"] == 0.0


def test_the_members_own_version_is_still_theirs_to_have_built(conv):
    """The name with a rule beside it is not held: the assistant builds the member's description, and the note
    on what was built says UCT's own one is on the list (it never says UCT has no formula for a built-in)."""
    got = conv.understand_turn("ATR bands of 3 ATR around a 20 EMA of the close", CHART)
    assert got["refusal"] is None and [e["id"] for e in got["own_words"]] == ["builtin_atr_bands"]
    patch = env(0, [{"op": "create", "name": "x", "placement": "price", "outputs": [
        {"key": "a", "tree": call("ema", {"type": "series", "name": "close"}, num(20))}]}])
    notes = conv.own_words_notes(patch, got["own_words"])
    assert [n["text"] for n in notes] == ["Built from your own description, as your own formula. UCT's own ATR Bands is in "
                                          "the Indicators list."]


# ═══ 2b. "build your own" is said exactly where the door takes one ════════
#
# Coordinator's ruling 2026-11-19: the sentence stays only where a member's own version really runs here. For a
# built-in a plain formula describes (ATR Bands, Bollinger %B ...) that is the grammar's ordinary work. For the
# RELATIVE-STRENGTH family it is not obvious, so each is held one way or the other, by name:
#
#   * OWN_VERSIONS: the member's own version AS A FORMULA (the close over a named symbol's close, `sym`, with an
#     average), sent through the door's real acceptance of an assistant's answer. Refused there, the sentence
#     would be a promise the door cannot keep.
#   * NO_OWN_VERSION: why none is offered.

SPY_CLOSE = {"type": "sym", "value": "SPY", "args": [CLOSE]}
RS = op("/", CLOSE, SPY_CLOSE)
_pct_from = lambda average: op("*", op("-", op("/", RS, average), num(1)), num(100))   # noqa: E731
OWN_VERSIONS = {
    "builtin_uct_relative_strength": (
        "Plot the close divided by SPY's close with a 50 bar simple average of that ratio",
        [("rs", RS), ("average", call("sma", RS, num(50)))]),
    "builtin_uct_rs_vs_21_ema": (
        "Show how far the close divided by SPY's close sits above or below the 21 EMA of that ratio, in percent",
        [("gap", _pct_from(call("ema", RS, num(21))))]),
    "mansfield_relative_strength": (
        "The close divided by SPY's close, as a percent above or below its own 52 bar simple average",
        [("mansfield", _pct_from(call("sma", RS, num(52))))]),
}
NO_OWN_VERSION = {
    "rs_rating": "a rank of this stock against every other stock: no formula on one chart can be that",
    "rs_phases": "read from the RS line against the market's own state, which the server computes",
    "builtin_uct_rs_exit_warnings": "UCT's reading of a method with no published formula to hold a member's version to",
    "session_vwap_bands": "one setting of a built-in, offered as that setting (tests/test_vwap_bands_offer.py)",
}
RS_FAMILY = {"rsLine", "rsVsEma", "rsMansfield", "rsRating", "rsPhases", "rsExit"}


def test_every_relative_strength_built_in_is_held_one_way_or_the_other():
    family = {e["id"] for e in ni.built_ins() if ni.built_in(e)["indicator"] in RS_FAMILY}
    assert len(family) == len(RS_FAMILY)
    assert {i for i in family if ni.own_version(ni.entry(i))} == set(OWN_VERSIONS)
    # and, over every built-in name: none is offered no own version without its reason written here
    assert {e["id"] for e in ni.built_ins() if not ni.own_version(e)} == set(NO_OWN_VERSION)
    assert all(len(why) > 30 for why in NO_OWN_VERSION.values())


@pytest.mark.parametrize("entry_id", sorted(OWN_VERSIONS))
def test_the_door_takes_a_members_own_version_of_it(conv, clean_env, model, entry_id):
    words, outputs = OWN_VERSIONS[entry_id]
    patch = env(0, [{"op": "create", "name": "My own", "placement": "pane",
                     "outputs": [{"key": key, "tree": tree} for key, tree in outputs]}], reply="Built your own.")
    client = model([emits(patch)])
    r = conv.converse(words, user_id="u1", view=empty_view(0), chart=CHART, accepts=OFFERS,
                      addable=[ni.built_in(ni.entry(entry_id))["indicator"]])
    assert r["ok"] is True and r.get("disposition") == "change", r
    assert len(client.calls) == 1                                         # the assistant built it: no offer stood in the way
    assert "offer" not in r
    kept = r["envelope"]["ops"][0]["outputs"]
    assert [o["key"] for o in kept] == [key for key, _tree in outputs]
    assert json.dumps(kept).count('"sym"') >= 1                           # it still reads the named symbol


def test_control_the_door_can_refuse_an_own_version(conv, clean_env, model):
    """The acceptance above is not a formality: the same formula reading a symbol the member never named is refused."""
    words, outputs = OWN_VERSIONS["builtin_uct_relative_strength"]
    other = json.loads(json.dumps(outputs[0][1]).replace('"SPY"', '"QQQ"'))
    model([emits(env(0, [{"op": "create", "name": "My own", "placement": "pane",
                          "outputs": [{"key": "rs", "tree": other}]}], reply="Built."))] * 3)
    r = conv.converse(words, user_id="u2", view=empty_view(0), chart=CHART, accepts=OFFERS)
    assert r["ok"] is False, r


# ═══ 3. an open defect is a recorded fact, and the wording follows it ════

def test_the_ledger_of_open_defects_names_built_ins_and_says_what_differs():
    doc = json.loads(ni.OPEN_DEFECTS_PATH.read_text(encoding="utf-8"))
    assert doc["contract"] == ni.OPEN_DEFECTS_CONTRACT
    assert set(doc["defects"]) == set(ni.open_defects()) and "ichimoku" in ni.open_defects()
    for def_id, row in ni.open_defects().items():
        assert def_id in BY_ID, f"{def_id} is not a built-in the registry serves: remove the line or correct the id"
        assert set(row) == {"what", "ref", "since"} and all(isinstance(row[k], str) and row[k].strip() for k in row)
        assert not row["what"].endswith(".") and row["what"][0].islower()      # it finishes a sentence
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", row["since"])
    assert ni.open_defect("ichimoku") == "its two leading spans are drawn on the bar they are computed on, not shifted forward"
    assert ni.open_defect("rsi") is None and ni.open_defect(None) is None and ni.open_defect(7) is None


def test_a_built_in_with_an_open_defect_is_never_offered_without_saying_so(monkeypatch):
    plain = ni.built_in_answer(ni.entry("builtin_atr_bands"))
    assert "differs" not in plain
    monkeypatch.setattr(ni, "open_defects", lambda: {"atrBands": {"what": "its bands are drawn one bar late", "ref": "X", "since": "2026-11-19"},
                                                     "rsLine": {"what": "its average is a bar short", "ref": "Y", "since": "2026-11-19"}})
    said = ni.built_in_answer(ni.entry("builtin_atr_bands"))
    assert said == ("ATR Bands is one of UCT's own indicators: the close with a band a multiple of ATR either side of it. "
                    "UCT's built-in differs from the published indicator today: its bands are drawn one bar late; a fix is "
                    "pending. Add it with one tap, or describe what you'd change and I'll build your own.")
    own = ni.built_in_answer(ni.entry("builtin_uct_relative_strength"))
    assert "UCT's built-in differs from the published indicator today: its average is a bar short; a fix is pending." in own
    # one that offers no own version says it the same way
    monkeypatch.setattr(ni, "open_defects", lambda: {"rsRating": {"what": "it is a session late", "ref": "Z", "since": "2026-11-19"}})
    assert ni.built_in_answer(ni.entry("rs_rating")) == (
        "RS Rating is one of UCT's own indicators, UCT RS Rating: the stock's RS Rating, 1 to 99, session by session on "
        "daily charts. UCT's built-in differs from the published indicator today: it is a session late; a fix is "
        "pending. It is not a formula to build here.")
    monkeypatch.setattr(ni, "open_defects", lambda: {"atrBands": {"what": "x", "ref": "X", "since": "2026-11-19"}})
    # and one with nothing recorded is said as before
    assert "differs" not in ni.built_in_answer(ni.entry("builtin_dollar_volume"))


def test_no_answer_about_a_built_in_calls_it_checked():
    """A built-in is UCT's own; "checked" is a claim this door makes only of a library formula."""
    for e in ni.built_ins():
        for text in (ni.built_in_answer(e), ni.way_forward(e)):
            assert "checked" not in text.lower(), (e["id"], text)
    # ⛔ and the one built-in with an open defect today is NOT offered by name at all: "Ichimoku Cloud" is built
    # from the library's checked formula (shifted spans), never added as the unshifted built-in
    assert "ichimoku" not in {ni.built_in(e)["indicator"] for e in ni.built_ins()}
    assert ni.passes(ni.entry("ichimoku_cloud"))


def test_a_malformed_ledger_is_no_ledger(monkeypatch, tmp_path):
    for body in ("not json", json.dumps({"contract": "other", "defects": {"rsi": {"what": "x"}}}),
                 json.dumps({"contract": ni.OPEN_DEFECTS_CONTRACT, "defects": {"rsi": {"what": ""}, "macd": "late", 7: {}}})):
        path = tmp_path / "defects.json"
        path.write_text(body, encoding="utf-8")
        monkeypatch.setattr(ni, "OPEN_DEFECTS_PATH", path)
        ni.open_defects.cache_clear()
        assert ni.open_defects() == {}
    ni.open_defects.cache_clear()
