# -*- coding: utf-8 -*-
"""THE ASSISTANT WRITES PINE: its instructions, built from the engine's own reference (2026-11-18).

Create Indicator's assistant wrote a FORMULA and nothing else. A table, a drawn line, a label with
text, a list of levels: out of reach however a member worded it, while the engine ran every one of
them for a member who PASTED a script. So the assistant is to write Pine, and this module is what
it writes from.

⛔ THE DOCUMENT LISTS ONLY WHAT THE ENGINE SERVES TODAY. Every name in it comes from
``app/src/components/chart/supportLoop/assistantPineReference.json``, which is GENERATED from the
engine's own tables and from running each output call, each pitfall and each worked example
through the member's own paste path (``assistantPineReference.test.js`` regenerates it and fails
when the committed bytes differ). Nothing here adds a Pine name of its own: the hand-written parts
are the contract, the words for each admitted language feature, and one sentence per pitfall, and
a pitfall's sentence is printed only while the reference says the engine still does not draw it.

⛔ THE ENGINE JUDGES, NEVER THE MODEL. A script the assistant writes goes through the same door a
pasted script goes through, and the member is shown that door's verdict. ``script_problem`` below
is only the server's first look (size, shape, capabilities the runtime lane admits); it never
replaces the browser engine's check.

Pure: no network, no model call. Fail closed: an unreadable reference is no document at all
(``available()`` is False), and a caller that cannot build the document makes no script turn.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from typing import Any, Dict, List, Mapping, Optional

from api.services import indicator_support

REFERENCE_PATH = indicator_support.ALLOWLIST_PATH.parent / "assistantPineReference.json"

#: The verdict states that mean "runs for a member with nothing withheld" (the generator's own
#: `RUNS_STATES`; held equal by `tests/test_pine_authoring.py`).
RUNS_STATES = ("runs", "runs-with-notes")

#: The longest script the assistant may write (characters). Far under the runtime document's own
#: cap (`runtime_definitions.RUNTIME_MAX_DEFINITION_BYTES`), which a test holds this below.
SCRIPT_MAX_CHARS = 24_000
NAME_MAX_CHARS = 60
REPLY_MAX_CHARS = 600

#: ⭐ WHAT EACH ADMITTED CAPABILITY IS, IN THE WORDS THE ASSISTANT READS. Keyed by the runtime lane's
#: capability id. A capability with no entry here is NOT written into the document (a new id is
#: silent until someone words it), and an entry whose id is not admitted is never printed: the
#: admitted list decides, this only words it. `tests/test_pine_authoring.py` holds both.
CAPABILITY_WORDS: Dict[str, str] = {
    "core": "series expressions, built-in calls and plots",
    "reassign": "reassignment with `:=`",
    "compound-assign": "compound assignment (`+=`, `-=`, `*=`, `/=`)",
    "ternary": "the conditional `a ? b : c`",
    "if-block": "`if` / `else if` / `else` blocks",
    "switch": "`switch`",
    "for": "`for i = a to b` loops",
    "for-in": "`for x in array` loops",
    "while": "`while` loops",
    "var": "`var` declarations (a value kept from bar to bar)",
    "history-expr": "history references on any expression (`x[1]`, `(a + b)[n]`)",
    "fn-single": "your own one-line functions (`f(x) => x * 2`)",
    "fn-multi": "your own multi-line functions",
    "tuple-destructure": "tuple returns (`[a, b] = f()`)",
    "typed-array": "typed array declarations (`float[] xs`, `array<float>`)",
    "collections:array": "arrays (`array.*`)",
    "method-call": "method-call syntax on built-in types (`xs.push(v)`)",
    "udt": "your own types (`type Point` with fields, `Point.new(...)`)",
    "generics": "generic type arguments (`array<line>`)",
    "max_bars_back": "`max_bars_back`",
    "realtime-state": "`barstate.*` reads (a value read on the newest bar can move until that bar closes)",
    "conditional-ta": "a `ta.sma` / `ta.ema` call inside an `if` block at the top level of the script",
    "obj:line": "lines (`line.*`)",
    "obj:label": "labels (`label.*`)",
    "obj:box": "boxes (`box.*`)",
    "obj:table": "tables (`table.*`)",
    "obj:delete": "deleting a drawing (`line.delete`, `label.delete`, `box.delete`)",
    "obj:getter": "reading a drawing back (`line.get_y1`, `label.get_text`)",
    "obj:collection": "the list of drawings of a kind (`line.all`, `label.all`)",
}

#: ⭐ ADMITTED BY THE ENGINE AND DELIBERATELY NOT OFFERED TO THE ASSISTANT, each with its reason. The
#: assistant writes INDICATORS: the rule that every admitted capability is worded has these named
#: exceptions and no silent ones (`tests/test_pine_authoring.py`).
NOT_FOR_THE_ASSISTANT: Dict[str, str] = {
    "strategy-decl": "the assistant writes indicators; a strategy is a different document with its own gates",
}

#: ⭐ ONE SENTENCE PER PITFALL, keyed by the generator's pitfall id (`PITFALL_PROBES`). Printed only
#: while the reference says that pitfall still STANDS (its probe did not run fully).
PITFALL_WORDS: Dict[str, str] = {
    "hline": ("`hline` is not drawn here yet. For a fixed level, plot a constant instead: "
              "`plot(70, \"Overbought\", color=color.gray)`."),
    "untitled-fill-anchor": ("Give every plot a title, above all one you pass to `fill`: "
                             "`a = plot(x, \"Upper\")`. Two untitled plots kept only to fill between draw nothing."),
}

CONTRACT = """You write ONE complete Pine Script indicator for UCT's chart engine, from a member's plain-words request.

THE RULES
1. Write Pine v5: the first line is `//@version=5`, then `indicator("<name>", overlay=<true|false>)`. Never `strategy(...)`, never `library(...)`, never `import`.
2. Use ONLY the functions, constants, outputs and language features listed in this document. This engine is not TradingView: a built-in that is not listed here is refused, and a script that uses one does not run. If the request cannot be met with what is listed, say so (disposition `unsupported`) and name the closest thing that can be built. Never substitute a different indicator under the same name.
3. UCT's engine checks the script after you write it, and the member is shown the ENGINE's verdict, not yours. Do not claim it runs. In `reply`, say in one or two plain sentences what the script draws and which numbers a member can change.
4. Every number a member might want to change is an `input.*` with a title. Every `plot` has a title.
5. Draw on the last bar what only needs drawing once (a summary table, a set of levels): `if barstate.islast`. Keep a drawing you redraw in a `var` handle and delete it before making it again, so the chart never fills with stale copies.
6. Stay inside the limits listed below. A script is at most a few hundred lines.
7. If you are sent an engine refusal for a script you wrote, fix exactly what it names and return the whole corrected script. Do not change what the member asked for to make the refusal go away; if the engine cannot do it, say so."""


@lru_cache(maxsize=1)
def reference() -> Dict[str, Any]:
    """The generated reference, or {} when it cannot be read (fail closed)."""
    try:
        doc = json.loads(REFERENCE_PATH.read_text(encoding="utf-8"))
    except Exception:                              # noqa: BLE001 -- an unreadable reference is no reference
        return {}
    return doc if isinstance(doc, dict) and doc.get("version") == 1 else {}


def _runs(row: Any) -> bool:
    return isinstance(row, Mapping) and row.get("ok") is True and row.get("state") in RUNS_STATES


def served_outputs(ref: Optional[Mapping[str, Any]] = None) -> List[str]:
    """The output calls whose own probe ran fully on the member's path."""
    ref = reference() if ref is None else ref
    return [o["name"] for o in ref.get("outputs") or [] if _runs(o)]


def worked_examples(ref: Optional[Mapping[str, Any]] = None) -> List[Mapping[str, Any]]:
    """The examples that ran fully. One that did not is never shown to the assistant."""
    ref = reference() if ref is None else ref
    return [e for e in ref.get("examples") or [] if _runs(e) and isinstance(e.get("source"), str)]


def standing_pitfalls(ref: Optional[Mapping[str, Any]] = None) -> List[str]:
    ref = reference() if ref is None else ref
    return [p["id"] for p in ref.get("pitfalls") or [] if isinstance(p, Mapping) and p.get("standing") is True]


def available(ref: Optional[Mapping[str, Any]] = None) -> bool:
    """Is there a document to write from? The reference is readable, it admits the core of the
    language, something can be plotted, and at least one worked example ran."""
    ref = reference() if ref is None else ref
    return bool(ref) and "core" in (ref.get("admitted") or []) and "plot" in served_outputs(ref) \
        and bool(worked_examples(ref))


def _lines(title: str, rows: List[str]) -> List[str]:
    return [f"## {title}", *rows, ""] if rows else []


def document(ref: Optional[Mapping[str, Any]] = None) -> str:
    """The assistant's instructions for a script turn. Deterministic: the same reference gives the
    same text (it is sent as a cached system block)."""
    ref = reference() if ref is None else ref
    if not available(ref):
        raise ValueError("the Pine reference is not available: no script turn may be made")
    admitted = list(ref.get("admitted") or [])
    out: List[str] = [CONTRACT, ""]

    out += _lines("LANGUAGE YOU MAY USE", [f"- {CAPABILITY_WORDS[c]}" for c in admitted if c in CAPABILITY_WORDS])

    out += _lines("WHAT A SCRIPT CAN SHOW", [f"- `{name}`" for name in served_outputs(ref)])

    out += _lines("VALUE FUNCTIONS AND VARIABLES (each with a call the engine accepts)",
                  [f"- `{v['name']}`  e.g. `{v['call']}`" for v in ref.get("values") or []])

    drawing = ref.get("drawing") or {}
    for family in ref.get("families") or []:
        out += _lines(f"DRAWING: {family.upper()}",
                      [f"- `{op['name']}({', '.join(op.get('params') or [])})`" for op in drawing.get(family) or []])
    out += _lines("DRAWING CONSTANTS", [", ".join(f"`{c}`" for c in ref.get("constants") or [])])
    limits = ref.get("limits") or {}
    out += _lines("LIMITS", [f"- {family}: {row['default']} kept by default, at most {row['most']} "
                             f"(declare with `{row['declare']}` in `indicator(...)`)" for family, row in limits.items()]
                  + [f"- a script: at most {SCRIPT_MAX_CHARS:,} characters"])

    out += _lines("TEXT", [", ".join(f"`{t}`" for t in ref.get("text") or [])])
    out += _lines("ARRAYS", [", ".join(f"`{a}`" for a in ref.get("arrays") or [])])
    out += _lines("COLOURS", [", ".join(f"`{c}`" for c in list(ref.get("colours") or []) + list(ref.get("colourNames") or []))])
    out += _lines("SYMBOL AND BAR STATE", [", ".join(f"`{s}`" for s in list(ref.get("symbol") or []) + list(ref.get("barstate") or []))])

    never = [f"- `{name}` is refused by name" for name in ref.get("refusedNames") or []]
    never += [f"- {PITFALL_WORDS[p]}" for p in standing_pitfalls(ref) if p in PITFALL_WORDS]
    out += _lines("NEVER", never)

    examples: List[str] = []
    for e in worked_examples(ref):
        examples += [f"### {e['title']}", f"Shows: {e['shows']}.", "```pine", e["source"].rstrip("\n"), "```", ""]
    out += _lines("WORKED EXAMPLES (each runs on this engine as written)", examples)
    return "\n".join(out).rstrip("\n") + "\n"


_VERSION_LINE = re.compile(r"\s*//\s*@version\s*=\s*([0-9]+)\s*$")
_DECLARATION = re.compile(r"^\s*(indicator|study|strategy|library)\s*\(", re.M)


def script_problem(pine: Any) -> Optional[str]:
    """The server's first look at a script the assistant wrote: None when it may go to the
    browser's engine, else one sentence saying what is wrong (sent back to the assistant for a
    repair, never shown to a member as a verdict).

    ⛔ IT DOES NOT JUDGE WHAT THE ENGINE RUNS. Which lane draws a script, and whether the runtime
    lane admits it, are the browser engine's and the admission route's answers (a script the host
    lane draws needs no admission at all, and the server cannot know the lane). Those refusals come
    back as the ENGINE's words. This looks only at size and shape."""
    if not isinstance(pine, str) or not pine.strip():
        return "no script was written"
    if len(pine) > SCRIPT_MAX_CHARS:
        return f"the script is {len(pine):,} characters; the most is {SCRIPT_MAX_CHARS:,}"
    first_line = pine.splitlines()[0] if pine.splitlines() else ""
    version = _VERSION_LINE.match(first_line)
    if version is None or version.group(1) != "5":
        return "the first line must be `//@version=5`"
    declared = _DECLARATION.search(pine)
    if declared is None or declared.group(1) != "indicator":
        return "the script must declare `indicator(...)` (not a strategy or a library)"
    return None
