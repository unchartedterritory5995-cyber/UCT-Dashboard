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


def way_forward(e: Mapping[str, Any]) -> str:
    """What a member is told when they name something UCT will not build by name yet."""
    example = f" (for example: {e['describe']})" if e.get("describe") else ""
    return (f"{e['name']} isn't in UCT's checked library yet. Describe the rule itself in your own words{example} "
            "and the assistant will build exactly that, as your own formula.")


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
