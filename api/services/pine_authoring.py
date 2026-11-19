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
    "obj:linefill": ("admitted for a member's own pasted script on the runtime lane (PARITY UNIT LF); the assistant's "
                     "drawing vocabulary does not teach line fills yet, so it never writes one"),
    # admit:request-other (2026-11-19): admitted for CLOSED-BAR HISTORY only (G6), so a script that reads another
    # timeframe or symbol is refused by name on every chart whose newest bar is forming, all session long
    "request-other": ("admitted for closed-bar history only: a script that requests another timeframe or symbol is "
                      "refused while the chart's newest bar is forming, so it is not offered until a forming bar is graded"),
}

#: ⭐ ONE SENTENCE PER PITFALL, keyed by the generator's pitfall id (`PITFALL_PROBES`). Printed only
#: while the reference says that pitfall still STANDS (its probe did not run fully).
PITFALL_WORDS: Dict[str, str] = {
    "candle-one-colour": ("For `plotcandle` and `plotbar` write ALL THREE colours (`color`, `wickcolor`, `bordercolor`), each a "
                          "fixed colour, `na`, `color.new(<fixed>, <number>)` or a `?:` of those. A candle that writes only "
                          "`color` is withheld."),
    "drawings-beside-plain-plots": ("When a script makes its drawings from a list or in a loop, PLOT a value taken from that "
                                    "same list or state (`plot(array.get(prices, 3), \"50% level\")`), not only plots of plain "
                                    "formulas: beside plain plots alone, the drawings are not drawn."),
    "fill-with-var": ("Do not use `fill` in a script that carries a value from bar to bar (`var`, `:=`) or loops: that "
                      "script is run bar by bar, and that run does not draw a fill between plots. Plot the lines."),
    "input-time": ("Do not use `input.time`: its default is not held. For a date the member can change, use three "
                   "`input.int` (year, month, day) and compare them with the bar's own `year`, `month` and `dayofmonth`."),
    "no-plot": ("Every script needs at least one `plot` (or `alertcondition`): a script that only draws lines, labels, "
                "boxes or a table is refused. Plot the value the drawings are made from."),
    "hline": ("`hline` is not drawn here yet. For a fixed level, plot a constant instead: "
              "`plot(70, \"Overbought\", color=color.gray)`."),
    "untitled-fill-anchor": ("Give every plot a title, above all one you pass to `fill`: "
                             "`a = plot(x, \"Upper\")`. Two untitled plots kept only to fill between draw nothing."),
}

#: ⭐ STOPS OF THE RUN (`assistantRecipes.json::stops`): what the member's paste check PASSES and the
#: engine then refuses when it computes. One sentence each, printed only while the probe is still refused.
RUN_STOP_WORDS: Dict[str, str] = {
    "running-total": ("Never keep a value since the chart's first bar (a running total, a count of every bar, an "
                      "all-history average or win rate). On a chart whose history does not reach the symbol's first day "
                      "that value depends on where the chart starts, and the engine draws nothing rather than a guess. "
                      "Work statistics over a FIXED window of the last N bars (an `input.int`), in a loop, or with "
                      "`ta.*` functions that take a length. A sum that RESTARTS (each new day, at an anchor date inside "
                      "the chart) is fine."),
    "delete-in-one-call": ("Take a drawing out of a list and delete it in TWO steps: `old = array.shift(marks)` then "
                           "`label.delete(old)` (the same for `array.pop`, `array.remove`, and for lines and boxes). Written "
                           "as one call, `label.delete(array.shift(marks))`, the drawing is deleted and stays in the list: "
                           "the list never shrinks, and a `while` over its size never ends."),
    "higher-timeframe-newest-bar": ("A weekly or monthly value read with `request.security` has NO value on the chart's "
                                    "newest bar while that week or month is still forming, and nothing computed from it "
                                    "has one either: reading it one bar back, `nz()` and `na(x) ? x[1] : x` do not rescue "
                                    "it. PLOT such a value as a line (it simply ends one bar early) and say so in `reply`. "
                                    "Do not build a last-bar table, label or level on it; if that is what was asked, say "
                                    "the newest bar cannot show it yet (disposition `unsupported`)."),
    "timestamp-clock": ("Do not use `timestamp(...)`: this chart's exchange zone is not one the engine answers for. "
                        "Compare the bar's own `year`, `month`, `dayofmonth`, `hour` and `minute` with numbers instead."),
}

CONTRACT = """You write ONE complete Pine Script indicator for UCT's chart engine, from a member's plain-words request.

THE RULES
1. Write Pine v5: the first line is `//@version=5`, then `indicator("<name>", overlay=<true|false>)`. Never `strategy(...)`, never `library(...)`, never `import`.
2. Use ONLY the functions, constants, outputs and language features listed in this document. This engine is not TradingView: a built-in that is not listed here is refused, and a script that uses one does not run. If the request cannot be met with what is listed, say so (disposition `unsupported`) and name the closest thing that can be built. Never substitute a different indicator under the same name.
3. UCT's engine checks the script after you write it, and the member is shown the ENGINE's verdict, not yours. Do not claim it runs. In `reply`, say in one or two plain sentences what the script draws and which numbers a member can change.
4. Every number a member might want to change is an `input.*` with a title. Every `plot` has a title.
5. Draw on the last bar what only needs drawing once (a summary table, a set of levels): `if barstate.islast`. Keep a drawing you redraw in a `var` handle and delete it before making it again, so the chart never fills with stale copies.
6. Stay inside the limits listed below. A script is at most a few hundred lines.
7. If you are sent an engine refusal for a script you wrote, fix exactly what it names and return the whole corrected script. Do not change what the member asked for to make the refusal go away; if the engine cannot do it, say so.
8. When the request comes with RECIPES, start from the closest one: each is a whole script this engine runs as written and whose numbers were checked. Keep its structure, change what the request needs (the numbers, the condition, the colours, the title), and never import a habit from another platform that the recipe does not use.
9. Say what the script MEANS by a term that has more than one reading (which pivot rule, which window, which average) in `reply`, in plain words."""


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


def document(ref: Optional[Mapping[str, Any]] = None, run_stops: Optional[List[str]] = None) -> str:
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
    stops = standing_run_stops() if run_stops is None else run_stops
    never += [f"- {RUN_STOP_WORDS[s]}" for s in stops if s in RUN_STOP_WORDS]
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


# --------------------------------------------------------------------------- #
# ⭐ WHAT A MEMBER STILL CANNOT GET: docs/pine/assistant-writes-pine/GAPS.md
# --------------------------------------------------------------------------- #
#
# GENERATED from the engine's own verdict on each gap probe (`assistantGaps.json`, written by the
# browser lane's generator) and the server's admission of whatever the bar-by-bar lane draws.
# ⛔ CAPABILITIES ONLY: a row is something a script cannot do here and what the engine says about
# it. No member's request, no answer and no count from a live round is ever written into it.

GAPS_PATH = REFERENCE_PATH.parent / "assistantGaps.json"
GAPS_DOC = REFERENCE_PATH.parents[5] / "docs" / "pine" / "assistant-writes-pine" / "GAPS.md"
GAP_KIND_TITLES = {
    "output": "What a script can show",
    "calculation": "Calculations",
    "drawing": "Drawings",
    "data": "Data a script can read",
    "language": "Language",
}
NOT_ADMITTED_GUARD = "runtime:not-yet-graded"


@lru_cache(maxsize=1)
def gaps() -> Dict[str, Any]:
    try:
        doc = json.loads(GAPS_PATH.read_text(encoding="utf-8"))
    except Exception:                              # noqa: BLE001
        return {}
    return doc if isinstance(doc, dict) and doc.get("version") == 1 else {}


def gap_rows(doc: Optional[Mapping[str, Any]] = None, admitted: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Every probe with what stands in a member's way, or nothing: `{id, kind, cannot, source,
    served, guard, says}`. A probe the engine runs on its bar-by-bar lane is served only when the
    server ADMITS every capability it uses (the browser's generator runs the engine itself; the
    admission is the server's)."""
    from api.services import pine_capabilities
    doc = gaps() if doc is None else doc
    allowed = set(reference().get("admitted") or []) if admitted is None else set(admitted)
    rows = []
    for p in doc.get("probes") or []:
        row = {"id": p["id"], "kind": p["kind"], "cannot": p["cannot"], "source": p["source"], "served": False,
               "guard": None, "says": ""}
        if p.get("runs") is not True:
            row["guard"] = p.get("guard")
            row["says"] = (p.get("why") or p.get("headline") or "").strip()
        elif p.get("lane") == "runtime":
            missing = sorted(set(pine_capabilities.capabilities_of(p["source"])) - allowed)
            if missing:
                row["guard"] = NOT_ADMITTED_GUARD
                row["says"] = ("the engine runs it bar by bar, and that lane does not admit this for members yet: "
                               + ", ".join(missing))
            else:
                row["served"] = True
        else:
            row["served"] = True
        rows.append(row)
    return rows


def _cell(text: Any) -> str:
    return " ".join(str(text or "").split()).replace("|", "/")


def gaps_document(doc: Optional[Mapping[str, Any]] = None, admitted: Optional[List[str]] = None) -> str:
    """docs/pine/assistant-writes-pine/GAPS.md, as text. Deterministic."""
    rows = gap_rows(doc, admitted)
    out = [
        "# What a member still cannot get from a script",
        "",
        "GENERATED by `python tools/assistant_gaps_build.py` from the engine's own verdict on each gap probe",
        "(`app/src/components/chart/supportLoop/assistantGaps.json`). Do not edit by hand.",
        "",
        "Create Indicator's assistant writes Pine for what a formula cannot hold, and the engine judges the script.",
        "So what stands between a request and an indicator is what the ENGINE does with the script. Each row below is",
        "the smallest script that shows one thing a member might ask for, run through the member's own paste path, and",
        "what the engine said. A row leaves this file by itself the day the engine serves its probe.",
        "",
        "This file holds capabilities only: no member's request, no answer and no count from any live round.",
        "",
    ]
    for kind, title in GAP_KIND_TITLES.items():
        mine = [r for r in rows if r["kind"] == kind and not r["served"]]
        if not mine:
            continue
        out += [f"## {title}", "", "| a member cannot get | what the engine says | refused as | probe |", "|---|---|---|---|"]
        out += [f"| {_cell(r['cannot'])} | {_cell(r['says'])} | `{r['guard'] or 'withheld'}` | `{r['id']}` |" for r in mine]
        out.append("")
    served = [r for r in rows if r["served"]]
    out += ["## Probes the engine serves today", "",
            "Asked the same way, and not a gap: " + (", ".join(f"`{r['id']}` ({_cell(r['cannot'])[0].lower() + _cell(r['cannot'])[1:]})" for r in served) or "none") + ".",
            "", "## The probes", ""]
    for r in rows:
        out += [f"### `{r['id']}`", "", "```pine", r["source"].rstrip("\n"), "```", ""]
    return "\n".join(out).rstrip("\n") + "\n"


# --------------------------------------------------------------------------- #
# ⭐ RECIPES: one proven script per hard request family, handed over by the request's own words
# --------------------------------------------------------------------------- #
#
# `assistantRecipes.json` is GENERATED (the browser lane's generator): each recipe with the paste
# path's verdict and a real compute on both histories. Only a `served` recipe is ever shown, and a
# script turn is handed only the ones its request NAMES (`asks`), so the instructions stay one
# cached document and a request for a zigzag does not pay for a volume profile.

RECIPES_PATH = REFERENCE_PATH.parent / "assistantRecipes.json"
#: How many recipes one request may carry.
RECIPES_MAX = 2
_NOT_A_WORD = re.compile(r"[^a-z0-9%]+")


@lru_cache(maxsize=1)
def _recipes_doc() -> Dict[str, Any]:
    try:
        doc = json.loads(RECIPES_PATH.read_text(encoding="utf-8"))
    except Exception:                              # noqa: BLE001 -- no file, no recipes (the turn still runs)
        return {}
    return doc if isinstance(doc, dict) and doc.get("version") == 1 else {}


def recipes(doc: Optional[Mapping[str, Any]] = None) -> List[Dict[str, Any]]:
    """Every recipe the engine serves today, in the folder's order."""
    doc = _recipes_doc() if doc is None else doc
    return [r for r in doc.get("recipes") or [] if isinstance(r, Mapping) and r.get("served") is True
            and isinstance(r.get("source"), str) and r.get("asks")]


def standing_run_stops(doc: Optional[Mapping[str, Any]] = None) -> List[str]:
    doc = _recipes_doc() if doc is None else doc
    return [s["id"] for s in doc.get("stops") or [] if isinstance(s, Mapping) and s.get("standing") is True]


def _spoken(text: Any) -> str:
    return " " + _NOT_A_WORD.sub(" ", str(text or "").lower()).strip() + " "


def recipes_for(message: Any, limit: int = RECIPES_MAX, doc: Optional[Mapping[str, Any]] = None) -> List[Dict[str, Any]]:
    """The recipes a request names, best first: by the longest of the recipe's phrases the words
    contain (whole words), then by how many of them, then by the folder's order. None when it names
    none."""
    words = _spoken(message)
    scored = []
    for order, r in enumerate(recipes(doc)):
        hits = [a for a in r["asks"] if _spoken(a) in words]
        if hits:
            scored.append((-max(len(a) for a in hits), -len(hits), order, r))
    return [r for *_rank, r in sorted(scored, key=lambda t: t[:3])][:max(0, int(limit))]


def recipes_text(found: List[Mapping[str, Any]]) -> str:
    """The recipes as they ride the request, or '' for none."""
    if not found:
        return ""
    out = ["RECIPES (whole scripts this engine runs as written; start from the closest):"]
    for r in found:
        out += [f"### {r['title']}", f"How it works: {r['shows']}.", "```pine", r["source"].rstrip("\n"), "```"]
    return "\n".join(out)
