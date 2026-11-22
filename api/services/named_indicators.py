"""⭐ THE NAMED-INDICATOR LIBRARY: a named indicator means ONE checked formula. Lookup, not recall.

`api/data/named_indicators.json` is the ONE store of named formulas. When a member names an
indicator in it ("Add the McGinley Dynamic"), the planner hands the assistant THAT formula as
data, and the door accepts the change only if the patch holds it (`holds`). The assistant is never
asked to remember what the McGinley Dynamic is, and can never substitute something near it.

WHY IT EXISTS. A run of Title-Case words the planner does not know is refused before any model
call (the McGinley rule, `definition_concierge._named_phrases`): found live, a model asked for the
McGinley Dynamic returned an EMA and reported success. That rule is right, and it locked out every
named indicator the engine can compute. This file is the key: a KNOWN name passes, WITH its formula.

ONE ENTRY: id, name, aliases (the words members use; never a bare two- or three-letter acronym,
several are tickers), parameters, outputs (the formula as TEXT a person wrote, the TREE the shipped
parser makes of it, and the SITES where each parameter's number sits), its evidence, and its
versions. `tools/named_indicators_build.py` writes the derived halves.

EVIDENCE, per entry (`evidence`):
  (a) `value_check`  an independent plain-Python calculation it is held equal to
                     (`tests/test_named_indicators_values.py`). The minimum; an entry without one
                     fails the file's own test.
  (b) `published`    who defined it and the page the definition was READ on.
  (c) `capture`      a TradingView capture it was graded against, where TradingView ships it. Only
                     a grade in `CAPTURE_SAID` counts; an explained difference is recorded and
                     claims nothing.
A name passes the planner at (a) and (b) or better (`passes`). The member is told which
(`member_sentence`). ⛔ An entry below that is REFUSED by name, never approximated.

⛔ NOT A SECOND STORE OF THE SAME THING. `chart_twins` holds the Screener's columns (authority:
the Screener); the house set holds UCT's own indicators. One id never appears in two of the three
(`tests/test_named_indicators.py`).
"""
from __future__ import annotations

import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

PATH = Path(__file__).resolve().parents[1] / "data" / "named_indicators.json"

#: The lexicon section a library name is filed under: what marks a planner term as one of these.
SECTION = "named_indicators"

#: The longest sentence an assumption may carry (the patch contract's `maxTextLength`; held equal
#: to it by `tests/test_named_indicators.py`).
SENTENCE_MAX = 300


@lru_cache(maxsize=1)
def library() -> Dict[str, Any]:
    return json.loads(PATH.read_text(encoding="utf-8"))


def entries() -> List[Dict[str, Any]]:
    """The indicators with a formula."""
    return list(library()["indicators"])


def held_names() -> List[Dict[str, Any]]:
    """⭐ HELD NAMES: indicators UCT knows BY NAME and has no checked formula for (the definition
    could not be confirmed on a page read, or it belongs to another store). Each is refused by
    name, in any spelling, with the way forward: `describe` is the rule in plain words, as an
    example of what the member can ask for instead. A held name has no formula here at all, so
    there is nothing a model could be handed and nothing it could approximate from."""
    return list(library().get("held") or [])


def entry(entry_id: Any) -> Optional[Dict[str, Any]]:
    return next((e for e in entries() + held_names() if e["id"] == entry_id), None)


def phrases() -> Tuple[Tuple[str, str], ...]:
    """Every (words a member uses, entry id), the name itself included, held names too, and each
    entry's acronyms (read by the Create Indicator door, which is the only reader of this)."""
    return tuple((spelling, e["id"]) for e in entries() + held_names()
                 for spelling in list(e["aliases"]) + list(e.get("acronyms") or ()))


def initials(name: Any) -> str:
    """"On Balance Volume" -> "obv"."""
    return "".join(word[0] for word in re.findall(r"[A-Za-z]+", str(name or ""))).lower()


def acronym_entry(wrote: Any) -> Optional[str]:
    """The id of the entry these letters are an ACRONYM of (in any capitals), or None."""
    want = str(wrote or "").strip().lower()
    return next((e["id"] for e in entries() if want in (e.get("acronyms") or ())), None)


def built_in(e: Any) -> Optional[Mapping[str, Any]]:
    """⭐ `built_in` {indicator, name, what} when this name IS one of UCT's own built-in indicators
    (ruling 2026-11-18): computed by the server, already shipped, and not a formula this library
    holds. `indicator` is the native registry's id and `name` its name there."""
    got = e.get("built_in") if isinstance(e, Mapping) else None
    if not isinstance(got, Mapping):
        return None
    if not all(isinstance(got.get(k), str) and got[k] for k in ("indicator", "name", "what")):
        return None
    # ⛔ a `setting` that does not read is NOT a plain built-in: adding the indicator without the
    # setting would add something other than what the member asked for
    return got if "setting" not in got or _setting_of(got) is not None else None


def _setting_of(b: Mapping[str, Any]) -> Optional[Mapping[str, Any]]:
    got = b.get("setting")
    if not isinstance(got, Mapping):
        return None
    values = got.get("values")
    ok = (all(isinstance(got.get(k), str) and got[k] for k in ("input", "label", "default"))
          and isinstance(values, list) and bool(values) and all(isinstance(v, str) and v for v in values)
          and got["default"] in values)
    return got if ok else None


def built_in_setting(e: Any) -> Optional[Mapping[str, Any]]:
    """⭐ `built_in.setting` {input, label, values, default} when this name is ONE SETTING of a
    built-in indicator, not an indicator of its own (2026-11-19: VWAP's standard-deviation bands are
    the Session VWAP with its "Std dev bands" setting on). `input` and `label` are the native
    registry's input key and its label there; `values` are the values the door may ask for, and
    `default` the one it asks for when the member named none."""
    b = built_in(e)
    return _setting_of(b) if b is not None else None


def built_ins() -> List[Dict[str, Any]]:
    """The held names that are UCT's own built-in indicators."""
    return [e for e in held_names() if built_in(e) is not None]


OPEN_DEFECTS_PATH = Path(__file__).resolve().parents[1] / "data" / "builtin_open_defects.json"
OPEN_DEFECTS_CONTRACT = "uct.builtin-open-defects/1"
#: Said beside a built-in a member could also have their own version of (coordinator's ruling 2026-11-19).
OWN_VERSION_LINE = "Add it with one tap, or describe what you'd change and I'll build your own."


@lru_cache(maxsize=1)
def open_defects() -> Dict[str, Dict[str, Any]]:
    """⭐ THE OPEN PARITY DEFECTS OF UCT'S OWN BUILT-INS, by registry id (`builtin_open_defects.json`).
    A recorded fact per built-in, so an answer's wording FOLLOWS it: a built-in listed here is never
    offered without saying what differs. Unreadable or malformed: {} (and a test holds the file)."""
    try:
        doc = json.loads(OPEN_DEFECTS_PATH.read_text(encoding="utf-8"))
    except Exception:                              # noqa: BLE001
        return {}
    rows = doc.get("defects") if isinstance(doc, dict) and doc.get("contract") == OPEN_DEFECTS_CONTRACT else None
    if not isinstance(rows, dict):                  # (a list or a string here used to raise, on every built-in answer)
        return {}
    return {k: v for k, v in rows.items()
            if isinstance(k, str) and isinstance(v, Mapping) and isinstance(v.get("what"), str) and v["what"].strip()}


def open_defect(indicator: Any) -> Optional[str]:
    """What differs today in this built-in (plain words), or None when nothing is recorded open."""
    row = open_defects().get(indicator) if isinstance(indicator, str) else None
    return row["what"].strip() if row else None


def own_version(e: Any) -> bool:
    """May a member have their own version of this built-in built (a formula could hold it)? False for
    one the server computes (the RS family): nothing a formula here could be."""
    b = built_in(e)
    return bool(b and b.get("own_version") is True)


def built_in_answer(e: Mapping[str, Any]) -> str:
    """What a member is told when the browser CAN add the built-in from where they are: what it
    is. The offer to add it rides beside this sentence, never inside it.
    ⛔ It never calls a built-in checked; and a built-in with an OPEN DEFECT says what differs."""
    b = built_in(e) or {}
    defect = open_defect(b.get("indicator"))
    differs = f" UCT's built-in differs from the published indicator today: {defect}; a fix is pending." if defect else ""
    if own_version(e):
        named = e["name"] if e["name"] == b["name"] else f"{e['name']} ({b['name']})"
        return f"{named} is one of UCT's own indicators: {b['what']}.{differs} {OWN_VERSION_LINE}"
    s = built_in_setting(e)
    if s is not None:
        return (f"{b['name']}, one of UCT's own indicators, draws {e['name']} itself when its {s['label']} setting "
                f"is on: {b['what']}.{differs} It is not a formula to build here.")
    named = e["name"] if e["name"] == b["name"] else f"{e['name']} is one of UCT's own indicators, {b['name']}"
    if e["name"] == b["name"]:
        return f"{named} is one of UCT's own indicators: {b['what']}.{differs} It is not a formula to build here."
    return f"{named}: {b['what']}.{differs} It is not a formula to build here."


#: ⭐ ANOTHER PUBLISHER'S OWN NUMBER (found by the first full live run of the value cases, 2026-11-22). Asked for "the
#: same proprietary RS Rating number IBD publishes", the door answered by name: "RS Rating is one of UCT's own
#: indicators, UCT RS Rating: ...", with the offer to add it. It never said it is NOT IBD's number. A named offer under
#: the words of another publisher's proprietary number reads as a yes.
#: Each row: the name the member is told, and the words that name that publisher. Only publishers of ratings, ranks
#: and scores of their own; a data vendor or a charting site named in passing is not one.
OTHER_PUBLISHERS: Tuple[Tuple[str, str], ...] = (
    ("IBD", r"\bibd\b|investor'?s\s+business\s+daily|\bmarket\s?smith\b|\bmarket\s?surge\b"),
    ("Zacks", r"\bzacks\b"),
    ("Morningstar", r"\bmorningstar\b"),
    ("Value Line", r"\bvalue\s+line\b"),
    ("TipRanks", r"\btip\s?ranks\b"),
    ("Barchart", r"\bbarchart\b"),
    ("Seeking Alpha", r"\bseeking\s+alpha\b"),
)


def other_publisher(message: Any) -> Optional[str]:
    """The other publisher the member's words name (the first of the table that they do), or None."""
    if not isinstance(message, str):
        return None
    import re
    for name, words in OTHER_PUBLISHERS:
        if re.search(words, message, re.I):
            return name
    return None


#: What the member is told for a publisher's own number UCT has NOTHING by the name of (`their_unknown_name`).
THEIR_UNKNOWN_NAME = ('"{name}" is {publisher}\'s own number and is not available here. UCT has nothing by that name. '
                      "To build something of your own, describe the rule (what it measures, over how many bars) and "
                      "the assistant will build exactly that.")


def publisher_of(message: Any, phrase: Any) -> Optional[str]:
    """The publisher an unknown name BELONGS to in the member's words, or None. It belongs to a publisher when the
    publisher's word is in the name itself ("Zacks Rank"), stands right before it ("IBD's Composite Rating", "the IBD
    Composite Rating"), or right after it with "from", "by" or "of" ("the Composite Rating from IBD"). A publisher
    named elsewhere in the sentence ("plot the Foo Line, I saw it on Barchart") does not claim the name."""
    if not isinstance(message, str) or not isinstance(phrase, str) or not phrase.strip():
        return None
    import re
    said = re.escape(phrase.strip()).replace(r"\ ", r"\s+")
    for name, words in OTHER_PUBLISHERS:
        if re.search(words, phrase, re.I):
            return name
        if re.search(rf"(?:{words})(?:'s|\u2019s)?\s+(?:own\s+|proprietary\s+)?{said}", message, re.I):
            return name
        if re.search(rf"{said}\s+(?:from|by|of)\s+(?:the\s+)?(?:{words})", message, re.I):
            return name
    return None


def their_unknown_name(message: Any, phrase: Any) -> Optional[str]:
    """The door's sentence for an unknown name that is a publisher's own number, or None (the usual sentence stands)."""
    publisher = publisher_of(message, phrase)
    return None if publisher is None else THEIR_UNKNOWN_NAME.format(name=str(phrase).strip(), publisher=publisher)


def is_their_unknown_name(reason: Any, phrase: Any) -> bool:
    """`reason` is that sentence for `phrase`, whichever publisher it names."""
    return isinstance(reason, str) and isinstance(phrase, str) and any(
        reason == THEIR_UNKNOWN_NAME.format(name=phrase.strip(), publisher=name) for name, _words in OTHER_PUBLISHERS)


def their_number(message: Any, e: Mapping[str, Any], can_add: bool) -> Optional[str]:
    """What the door says, IN PLACE of its usual sentence, when the member asked for another publisher's own number
    and named something UCT holds by that name. None when the words name no other publisher (the usual sentence
    stands). It says FIRST that the publisher's number cannot be given here; only then that UCT has its own, what
    that is (the built-in's own `what`, said once), and that it is not theirs. `can_add`: this browser can add the
    built-in now (the one-tap offer rides beside the sentence), else where to look for it."""
    publisher = other_publisher(message)
    if publisher is None:
        return None
    first = f"{publisher}'s {e['name']} is {publisher}'s own and is not available here."
    b = built_in(e)
    if b is None:
        return f"{first} {way_forward(e)}"
    defect = open_defect(b.get("indicator"))
    differs = f" UCT's built-in differs from the published indicator today: {defect}; a fix is pending." if defect else ""
    said = f"{first} UCT has its own, {b['name']}: {b['what']}.{differs} It is not {publisher}'s number"
    return said + (", and it is not a formula to build here." if can_add else f". Look for {b['name']} in the Indicators list.")


def needs_script(e: Any) -> Optional[str]:
    """Why a held name can only be a script (its published form is more than a formula holds), or None."""
    because = e.get("needs_script") if isinstance(e, Mapping) else None
    return because if isinstance(because, str) and because.strip() else None


def way_forward(e: Mapping[str, Any]) -> str:
    """What a member is told when they name something UCT will not build by name yet."""
    example = f" (for example: {e['describe']})" if e.get("describe") else ""
    describe = (f"describe the rule itself in your own words{example} and the assistant will build exactly that, "
                "as your own formula.")
    b = built_in(e)
    if b is not None:
        # a browser that did not say it can add it (an older tab, or a build that does not offer
        # it): where to look, and nothing promised about what that list shows
        s = built_in_setting(e)
        if s is not None:
            return (f"{e['name']} is a setting of one of UCT's own indicators ({b['name']}), not a formula this window "
                    f"builds. Look for {b['name']} in the Indicators list and turn on its {s['label']} setting.")
        return (f"{e['name']} is one of UCT's own indicators ({b['name']}), not a formula this window builds. "
                f"Look for {b['name']} in the Indicators list.")
    because = needs_script(e)
    if because:
        return (f"{e['name']} needs the script builder: {because}. Paste a Pine version of it into the builder's "
                f"script tab. Or {describe}")
    lives = e.get("lives_in") if isinstance(e.get("lives_in"), Mapping) else None
    if lives and lives.get("what") and lives.get("where"):
        return (f"{e['name']} is {lives['what']} in UCT today ({lives['where']}), not a chart line yet. To draw "
                f"something like it here, {describe}")
    return f"{e['name']} isn't in UCT's checked library yet. D{describe[1:]}"


# ── text ─────────────────────────────────────────────────────────────────────

def number_text(value: Any) -> str:
    """A number as formula text: 14, 1.5, never 14.0."""
    return str(int(value)) if isinstance(value, float) and value.is_integer() else str(value)


def formula_at(formula: str, values: Mapping[str, Any]) -> str:
    """The formula text with each `{param}` replaced by its number."""
    out = formula
    for key, value in values.items():
        out = out.replace("{" + key + "}", number_text(value))
    if "{" in out or "}" in out:
        raise ValueError(f"an unknown parameter in: {formula}")
    return out


def defaults(e: Mapping[str, Any]) -> Dict[str, Any]:
    return {p["key"]: p["default"] for p in e["params"]}


def tree_at(output: Mapping[str, Any], values: Mapping[str, Any]) -> Dict[str, Any]:
    """The output's tree with each parameter's number written at its sites (a copy)."""
    tree = json.loads(json.dumps(output["tree"]))
    for key, paths in (output.get("sites") or {}).items():
        if key not in values:
            continue
        for path in paths:
            node = tree
            for i in path:
                node = node["args"][i]
            node["value"] = values[key]
    return tree


# ── identity ─────────────────────────────────────────────────────────────────

def fingerprint(e: Mapping[str, Any]) -> str:
    """The whole-maths fingerprint of an entry: every output's tree at its default numbers."""
    body = json.dumps([[o["key"], o["tree"]] for o in e["outputs"]], sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(body.encode("utf-8")).hexdigest()


def version(e: Mapping[str, Any]) -> int:
    return int(e["versions"][-1]["version"])


#: The capture grades that count as tier (c), and what each lets the member be told. Any other
#: grade (a difference explained but not gone, a divergence) says nothing about TradingView.
CAPTURE_SAID = {
    "EQUAL": ", and equal to TradingView's own on captured charts",
    "EQUAL AFTER WARM-UP": ", and equal to TradingView's own after the first bars of captured charts",
}


# ── evidence ─────────────────────────────────────────────────────────────────

def tiers(e: Mapping[str, Any]) -> Tuple[bool, bool, bool]:
    """(value-checked, published definition read, graded equal to a TradingView capture)."""
    ev = e.get("evidence") or {}                             # a held name has none
    published = ev.get("published") or {}
    capture = ev.get("capture") or {}
    return (bool(ev.get("value_check")),
            bool(published.get("by") and published.get("url")),
            bool(capture.get("id") and capture.get("grade") in CAPTURE_SAID))


def follows_house(e: Mapping[str, Any]) -> Optional[Mapping[str, Any]]:
    """⭐ `evidence.house` when this entry FOLLOWS UCT'S OWN READER (ruling 2026-11-18): the product
    already computes this indicator in one place (a Screener detector), and the entry is the chart
    formula of THAT, proved equal to it bar for bar by the test it names. {reader, proof, whose,
    what}. It stands where a published definition would: there is one authority, and it is ours."""
    house = (e.get("evidence") or {}).get("house")
    if not isinstance(house, Mapping):
        return None
    return house if all(isinstance(house.get(k), str) and house[k] for k in ("reader", "proof", "whose", "what")) else None


def passes(e: Mapping[str, Any]) -> bool:
    """May the assistant build it? Value-checked AND a published definition read (or better), or
    value-checked and proved equal to UCT's own reader."""
    checked, published, _captured = tiers(e)
    return checked and (published or follows_house(e) is not None)


def follows_a_capture(e: Mapping[str, Any]) -> Optional[Mapping[str, Any]]:
    """`evidence.follows` when this entry's definition IS a graded capture: {whose, what, others}.
    Only an entry graded EQUAL on every bar may say so; anything less and it is not followed."""
    ev = e.get("evidence") or {}
    follows = ev.get("follows")
    if not isinstance(follows, Mapping) or (ev.get("capture") or {}).get("grade") != "EQUAL":
        return None
    return follows if all(isinstance(follows.get(k), str) and follows[k] for k in ("whose", "what", "others")) else None


def member_sentence(e: Mapping[str, Any], values: Mapping[str, Any]) -> str:
    """What the member is told about an output built to this entry: its numbers and its evidence."""
    # a parameter one of the member's own settings drives (None) is theirs to read off the setting
    numbers = ", ".join(f"{p['label'].lower()} {number_text(values[p['key']])}" for p in e["params"]
                        if values.get(p["key"]) is not None)
    _checked, _published, captured = tiers(e)
    by = (e["evidence"].get("published") or {}).get("by")
    follows = follows_a_capture(e)
    house = follows_house(e)
    if house and not follows:
        # ⭐ THE HOUSE'S OWN READER IS THE DEFINITION: the member is told whose it is and that the
        # chart agrees with it bar for bar. ⛔ It says nothing about any vendor.
        proof = f"it follows {house['whose']} ({house['what']}), and is equal to it bar for bar"
    elif follows:
        # ⭐ THE CAPTURE IS THE DEFINITION (ruling 2026-11-18, TRIX): the pages read describe another
        # form, so the member is told whose form this is, what it is, and that others differ.
        proof = (f"it follows {follows['whose']}, {follows['what']}, and is equal to it on captured charts. "
                 f"{follows['others']}").rstrip(".")
    else:
        proof = f"checked against an independent calculation and the definition published by {by}"
        if captured:
            proof += CAPTURE_SAID[e["evidence"]["capture"]["grade"]]
    said = f"Built to UCT's checked formula for {e['name']}" + (f" ({numbers})" if numbers else "") + f": {proof}."
    if len(said) > SENTENCE_MAX:                              # the numbers are on the chart; the evidence is not
        said = f"Built to UCT's checked formula for {e['name']}: {proof}."
    return said


# ── does a tree hold it? ─────────────────────────────────────────────────────

def _site_value(node: Any, lib: Mapping[str, Any], param: Mapping[str, Any], inputs: frozenset) -> Tuple[bool, Any]:
    """Is `node` an acceptable number for `param` at a site the library holds as `lib`?
    Returns (ok, what it is bound to): a literal, or the name of a declared input."""
    if not isinstance(node, dict):
        return False, None
    if lib.get("type") == "num" and node.get("type") == "series" and node.get("name") in inputs:
        return True, ("input", node["name"])                    # the member's own setting drives it
    if node.get("type") != lib.get("type"):
        return False, None
    v = node.get("value")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False, None
    if param.get("integer") and float(v) != int(v):
        return False, None
    if not (param["min"] <= v <= param["max"]):
        return False, None
    return True, ("num", float(v))


def _same(node: Any, lib: Any, path: Tuple[int, ...], sites: Mapping[Tuple[int, ...], str],
          params: Mapping[str, Mapping[str, Any]], inputs: frozenset, bound: Dict[str, Any]) -> bool:
    if not isinstance(node, dict) or not isinstance(lib, dict):
        return False
    key = sites.get(path)
    if key is not None:
        ok, got = _site_value(node, lib, params[key], inputs)
        if not ok or bound.setdefault(key, got) != got:         # one parameter is ONE number, everywhere
            return False
        if lib.get("type") == "num":
            return True                                         # a number: nothing beneath it
    elif node.get("type") != lib.get("type") or node.get("name") != lib.get("name") or node.get("value") != lib.get("value"):
        return False
    if key is not None and (node.get("type") != lib.get("type") or node.get("name") != lib.get("name")):
        return False
    a, b = node.get("args") or [], lib.get("args") or []
    return len(a) == len(b) and all(_same(x, y, path + (i,), sites, params, inputs, bound) for i, (x, y) in enumerate(zip(a, b)))


def output_in(tree: Any, e: Mapping[str, Any], output: Mapping[str, Any],
              inputs: Sequence[str] = ()) -> Optional[Dict[str, Any]]:
    """Does `tree` hold this library output, whole, anywhere inside it? Equal in shape and in
    every number except a declared parameter's, which may be another number in its range (or one
    of the member's own inputs) and must be the SAME one at each of its sites.

    Returns the parameters' numbers as found ({key: number, or None when an input drives it}), or
    None when the tree does not hold it."""
    params = {p["key"]: p for p in e["params"]}
    sites = {tuple(path): key for key, paths in (output.get("sites") or {}).items() for path in paths}
    declared = frozenset(inputs)
    stack = [tree]
    while stack:
        node = stack.pop()
        if not isinstance(node, dict):
            continue
        bound: Dict[str, Any] = {}
        if _same(node, output["tree"], (), sites, params, declared, bound):
            return {k: (v[1] if v[0] == "num" else None) for k, v in bound.items()}
        stack.extend(node.get("args") or [])
    return None


def held(trees: Sequence[Any], e: Mapping[str, Any], inputs: Sequence[str] = ()) -> List[Tuple[int, str, Dict[str, Any]]]:
    """Which of these trees hold which of the entry's outputs: (index of the tree, output key, numbers)."""
    out: List[Tuple[int, str, Dict[str, Any]]] = []
    for i, tree in enumerate(trees):
        for o in e["outputs"]:
            got = output_in(tree, e, o, inputs)
            if got is not None:
                out.append((i, o["key"], got))
    return out
