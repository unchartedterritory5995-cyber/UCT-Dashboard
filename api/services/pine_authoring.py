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
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

from api.services import indicator_support
from api.services import pine_capabilities

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

#: ⭐ AND ONE OPEN FAMILY, named once, never one entry per id: `library:Author/Library/N` (U15, the libraries
#: chain), one capability per published library version a member's script imports
#: (`pine_capabilities.is_library_capability`, the detector's own reader). The assistant writes one
#: self-contained indicator and never an `import` line, so no admitted library version is offered to it.
NOT_FOR_THE_ASSISTANT_LIBRARIES = ("an admitted library version serves a member's own pasted script that imports "
                                   "it; the assistant writes one self-contained indicator and never an `import` line")


def not_offered(cap: str) -> bool:
    """Admitted by the engine and deliberately not offered to the assistant: a named id, or a library version."""
    return cap in NOT_FOR_THE_ASSISTANT or pine_capabilities.is_library_capability(cap)


# ⭐ A READ OF ANOTHER SYMBOL OR TIMEFRAME THE MEMBER DID NOT ASK FOR (found by the value cases, 2026-11-22).
# `request-other` is not offered to the assistant (above), and the assistant wrote it anyway, from what it knows
# of Pine: "yesterday's high" on a DAILY chart came back as `request.security(syminfo.tickerid, "D", high[1])`,
# a read the chart's own `high[1]` already is. Such a script is admitted for finished bars only, so it carries a
# limit the member never asked to take on.
# The rule, decided by READING THE SCRIPT'S OWN REQUESTS against the member's words and the chart (never by the
# assistant): a request for a TICKER the member named, or for a TIMEFRAME the member's words name, was ASKED for
# and is kept; a request for a ticker nobody named, or for the chart's own symbol on the chart's own timeframe,
# was NOT asked for and gets one repair; anything this cannot read for certain is UNSURE and is KEPT (a silent
# rewrite that changes what the script means is worse than a limit the window already tells the member about).
OTHER_READ_ASKED, OTHER_READ_NOT_ASKED, OTHER_READ_UNSURE = "asked", "not asked", "unsure"
_REQUEST_CALL = re.compile(r"\brequest\.security(?:_lower_tf)?\s*\(")
_CHART_SYMBOLS = ("syminfo.tickerid", "syminfo.ticker")
_CHART_TIMEFRAMES = ("timeframe.period", '""', "''")
#: the member's words for a timeframe, by the code a request names it with
_TIMEFRAME_WORDS: Dict[str, "re.Pattern[str]"] = {
    "W": re.compile(r"\bweek(?:ly|s|'s)?\b", re.I),
    "M": re.compile(r"\bmonth(?:ly|s|'s)?\b", re.I),
    "D": re.compile(r"\b(?:daily|days?|day's|yesterday(?:'s)?|session(?:'s)?)\b", re.I),
    "intraday": re.compile(r"\b(?:minutes?|hours?|hourly|intraday)\b", re.I),
}
_ANY_TIMEFRAME_WORD = re.compile(r"\btime ?frames?\b", re.I)
OTHER_READ_REPAIR_LINE = (
    "[script:not-asked] This script reads {what} with `request.security`, and the member did not ask for another "
    "symbol or timeframe. A script that requests one is drawn on finished bars only, a limit this request does not "
    "need. Return the WHOLE script without `request.security`: read the chart's own bars (`high[1]` is the bar "
    "before this one; on the member's chart that is the prior {bar}). Change nothing else about what it computes.")


def _code_only(script: str) -> str:
    """The script without its comments (a `//` inside a string literal is kept)."""
    out = []
    for line in script.splitlines():
        quote, cut = None, len(line)
        for i, ch in enumerate(line):
            if quote:
                if ch == quote and line[i - 1] != "\\":
                    quote = None
            elif ch in "\"'":
                quote = ch
            elif ch == "/" and line[i:i + 2] == "//":
                cut = i
                break
        out.append(line[:cut])
    return "\n".join(out)


def _strings_blanked(code: str) -> str:
    """The code with the INSIDE of every string literal blanked, the same length: a call named in a string
    (`"request.security(x, y, z) is not used"`) is prose, and prose is never matched."""
    out, quote = [], None
    for i, ch in enumerate(code):
        if quote:
            if ch == quote and code[i - 1] != "\\":
                quote = None
                out.append(ch)
            else:
                out.append("\n" if ch == "\n" else " ")
        else:
            if ch in "\"'":
                quote = ch
            out.append(ch)
    return "".join(out)


def _first_two_args(code: str, start: int) -> Optional[Tuple[str, str]]:
    """The first two arguments of the call whose `(` ends at `start`, split at the top level, or None."""
    depth, quote, args, cur = 1, None, [], []
    for i in range(start, len(code)):
        ch = code[i]
        if quote:
            cur.append(ch)
            if ch == quote and code[i - 1] != "\\":
                quote = None
            continue
        if ch in "\"'":
            quote = ch
        elif ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
            if depth == 0:
                args.append("".join(cur).strip())
                break
        elif ch == "," and depth == 1:
            args.append("".join(cur).strip())
            cur = []
            if len(args) == 2:
                break
            continue
        cur.append(ch)
    return (args[0], args[1]) if len(args) >= 2 else None


def _literal(text: str) -> Optional[str]:
    text = text.strip()
    return text[1:-1] if len(text) >= 2 and text[0] in "\"'" and text[-1] == text[0] else None


def _resolved(arg: str, code: str) -> Optional[str]:
    """What a request's argument IS: a chart name as written, a literal's text, or what a plain name was given
    (`sym = input.symbol("SPY", ...)`, `tf = "W"`). None when this cannot say for certain."""
    arg = arg.strip()
    if arg in _CHART_SYMBOLS or arg in _CHART_TIMEFRAMES:
        return arg
    lit = _literal(arg)
    if lit is not None:
        return lit
    if not re.fullmatch(r"[A-Za-z_]\w*", arg):
        return None
    given = re.findall(rf"(?m)^[ \t]*(?:var[ \t]+)?(?:[A-Za-z_][\w.<>]*[ \t]+)?{re.escape(arg)}[ \t]*:?=[ \t]*(.+)$", code)
    if len(given) != 1:                                            # never assigned, or assigned more than once
        return None
    value = given[0].strip()
    if value in _CHART_SYMBOLS or value in _CHART_TIMEFRAMES:
        return value
    lit = _literal(value)
    if lit is not None:
        return lit
    called = re.match(r"input\.(?:symbol|timeframe|string)\s*\(\s*(\"[^\"]*\"|'[^']*')", value)
    return _literal(called.group(1)) if called else None


def _timeframe_kind(tf: Optional[str]) -> Optional[str]:
    """'D', 'W', 'M', 'intraday', or None for a timeframe this does not know."""
    if not isinstance(tf, str):
        return None
    t = tf.strip().upper()
    if re.fullmatch(r"\d*[DWM]", t):
        return t[-1] if t[:-1] in ("", "1") else None
    return "intraday" if re.fullmatch(r"\d+", t) else None


def other_reads(script: Any) -> Optional[List[Tuple[Optional[str], Optional[str]]]]:
    """Every `request.security` of the script as (symbol, timeframe), each resolved or None. None when the script
    is unreadable; [] when it requests nothing."""
    if not isinstance(script, str) or not script.strip():
        return None
    code = _code_only(script)
    out = []
    for m in _REQUEST_CALL.finditer(_strings_blanked(code)):      # found where it is CODE; its arguments read as written
        args = _first_two_args(code, m.end())
        out.append((None, None) if args is None else (_resolved(args[0], code), _resolved(args[1], code)))
    return out


def other_read_asked(message: Any, script: Any, chart: Any = None) -> Tuple[str, List[str]]:
    """(verdict, what was read and not asked for). The verdict is OTHER_READ_ASKED (or nothing is requested),
    OTHER_READ_NOT_ASKED, or OTHER_READ_UNSURE; see the rule above. `chart`: `{sym, tf}` of the member's chart."""
    reads = other_reads(script)
    if reads is None:
        return OTHER_READ_UNSURE, []
    words = str(message or "")
    named = {w.upper().rstrip(".") for w in re.findall(r"[A-Za-z][A-Za-z0-9.\-]{0,9}", words)}
    chart_sym = str(chart.get("sym") or "").upper() if isinstance(chart, Mapping) else ""
    chart_kind = _timeframe_kind(chart.get("tf")) if isinstance(chart, Mapping) else None
    unsure, unasked = False, []
    for sym, tf in reads:
        if sym is None or tf is None:
            unsure = True
            continue
        own_symbol = sym in _CHART_SYMBOLS or (chart_sym and sym.upper().split(":")[-1] == chart_sym)
        if not own_symbol:
            ticker = sym.upper().split(":")[-1]
            if ticker not in named:
                unasked.append(f"the symbol {ticker}")
            continue
        if tf in _CHART_TIMEFRAMES:
            unasked.append("the chart's own symbol on the chart's own timeframe")
            continue
        kind = _timeframe_kind(tf)
        if kind is None or chart_kind is None:
            unsure = True
        elif kind == chart_kind and kind != "intraday":
            unasked.append("the chart's own symbol on the chart's own timeframe")
        elif not (_TIMEFRAME_WORDS[kind].search(words) or _ANY_TIMEFRAME_WORD.search(words)):
            unsure = True                                          # another timeframe nobody named: unsure, so KEPT
    if unsure:
        return OTHER_READ_UNSURE, []
    return (OTHER_READ_NOT_ASKED, sorted(set(unasked))) if unasked else (OTHER_READ_ASKED, [])


def other_read_repair(unasked: List[str], chart: Any = None) -> str:
    """What the assistant is told when its script reads what the member did not ask for."""
    kind = _timeframe_kind(chart.get("tf")) if isinstance(chart, Mapping) else None
    bar = {"D": "day", "W": "week", "M": "month"}.get(kind or "", "bar")
    return OTHER_READ_REPAIR_LINE.replace("{what}", " and ".join(unasked) or "another symbol or timeframe").replace("{bar}", bar)

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
                                    "newest bar while that week or month is still forming, and nothing that reads it ON "
                                    "that bar has one either: `nz(x)` and `na(x) ? x[1] : x` do not rescue it. PLOT such "
                                    "a value as a line (it simply ends one bar early) and say so in `reply`. Do not build "
                                    "a last-bar table, label or level on the value itself."),
    # (its own probe: said only while ONE BAR BACK is blank on the newest bar too)
    "higher-timeframe-one-bar-back": ("Reading that weekly or monthly value one bar back (`x[1]`) does not rescue it "
                                      "either: it is blank on the newest bar too. If a last-bar table, label or level "
                                      "on it is what was asked, say the newest bar cannot show it yet (disposition "
                                      "`unsupported`)."),
    "timestamp-clock": ("Do not use `timestamp(...)`: this chart's exchange zone is not one the engine answers for. "
                        "Compare the bar's own `year`, `month`, `dayofmonth`, `hour` and `minute` with numbers instead."),
}

CONTRACT = """You write ONE complete Pine Script indicator for UCT's chart engine, from a member's plain-words request.

THE RULES
1. Write Pine v5: the first line is `//@version=5`, then `indicator("<name>", overlay=<true|false>)`. Never `strategy(...)`, never `library(...)`, never `import`.
2. Use ONLY the functions, constants, outputs and language features listed in this document. This engine is not TradingView: a built-in that is not listed here is refused, and a script that uses one does not run. If the request cannot be met with what is listed, say so (disposition `unsupported`) and name the closest thing that can be built. Never substitute a different indicator under the same name.
3. UCT's engine checks the script after you write it, and the member is shown the ENGINE's verdict, not yours. Do not claim it runs. In `reply`, say in one or two plain sentences what the script draws and which numbers a member can change.
4. Every number a member might want to change is an `input.*` with a title. Every `plot` has a title.
5. A drawing that shows only the newest state (a summary table, a set of levels, a range box) is made ONCE, kept in a `var` handle, and UPDATED ON EVERY BAR with its setters (`table.cell`, `label.set_xy`, `label.set_text`, `line.set_xy1`, `line.set_xy2`, `box.set_lefttop`, `box.set_rightbottom`). Do not delete and remake it on every bar.{last_bar}
6. Stay inside the limits listed below. A script is at most a few hundred lines.
7. If you are sent an engine refusal for a script you wrote, fix exactly what it names and return the whole corrected script. Do not change what the member asked for to make the refusal go away; if the engine cannot do it, say so.
8. When the request comes with RECIPES, start from the closest one: each is a whole script this engine runs as written and whose numbers were checked. Keep its structure, change what the request needs (the numbers, the condition, the colours, the title), and never import a habit from another platform that the recipe does not use.
9. Say what the script MEANS by a term that has more than one reading (which pivot rule, which window, which average) in `reply`, in plain words.
10. For a well-known indicator, when this document lists Pine's OWN function for it, CALL that function: do not re-derive its maths by hand. {own_functions}When this document lists none, write the published calculation yourself and say in `reply` which definition you used.
11. Draw ONLY what the member asked for. A request for a count or a signal is that one plot or mark: do not add a label on every event, a summary table, a background colour, extra shapes or an `alertcondition` the request did not name. Each extra clutters the chart and is one more claim that has to be right. If something more would help, OFFER it in `reply` in one short sentence ("I can also mark each day or add a table") and leave it out of the script. When the request is ONLY a drawing (a box, a line, labels, a table) and names no plotted line, still `plot` the value the drawing is made from, because a script with a plot can be used in alerts and one without cannot; but make that plot INVISIBLE with a fully transparent colour (`plot(level, "Level", color=color.new(color.gray, 100))`) and say in `reply` that a hidden plot is there for alerts. Never hide a plot the member asked to see.
12. {number_on_bars}
13. {format_literal}
14. {fill_in}"""

#: ⭐ RULE 14: A FIGURE THE MEMBER MUST FILL IN (found by the first full live run of the value cases, 2026-11-22). On
#: the formula door an "average cost" setting was drawn bare: a line at price 0 until filled, squeezing the chart. A
#: script reaches the same shape with `avg = input.float(0, ...)` and `plot(avg)`. The member's own figures are never
#: invented (a default of 0), and a figure at 0 is not drawn.
FILL_IN_RULE = (
    "A FIGURE THE MEMBER MUST FILL IN (shares, an entry, an average cost, a stop): never invent it. Give the "
    "setting a default of 0 and draw NOTHING until it is filled: `plot(avg > 0 ? avg : na)`, and a table cell that "
    "shows it only when it is above 0. A bare `plot(avg)` is a line at price 0 that squeezes the chart. Say in "
    "`reply` that the member's own figures cannot be read here and where to enter them.")

#: ⭐ RULE 13, INTERIM (coordinator's ruling, 2026-11-22). Found by the live re-check of the rule above it: asked for a
#: table of yesterday's high and low, the assistant added a "Decimal places" setting and BUILT the number format from
#: text (`fmt = "#." + str.replace_all(...)`, then `str.tostring(x, fmt)`). The engine WITHHOLDS a text whose format is
#: not a string literal (it cannot know the pattern, and the ten-decimal default would be a different text), so the
#: table drew its labels and NO VALUES, with no error and no word to the member. Measured through the engine: a literal
#: format, `format.mintick` and `format.volume` draw; a format held in a variable, joined from text, or
#: `format.percent` draws nothing. Measured over the 101 scripts on file: 1 builds a format (that one).
#: ⛔ THIS SENTENCE COMES OUT WHEN THE ENGINE SERVES A FOLDED FORMAT (the engine unit that names the withhold and folds
#: a format made of literals and inputs). `tests/test_script_format_is_a_literal.py` runs the shape through the engine
#: on every run and goes RED the day it draws, naming this constant: remove it then, in that commit.
FORMAT_LITERAL_RULE = (
    "Write `str.tostring`'s format as a string literal (\"#.##\"). For a decimals setting, choose among literal "
    "formats (`digits == 0 ? str.tostring(x, \"#\") : digits == 1 ? str.tostring(x, \"#.#\") : str.tostring(x, "
    "\"#.##\")`); never build a format from text or hold one in a variable. `format.mintick` and `format.volume` are "
    "served; for a percent write the number and add \"%\" yourself.")

#: ⭐ RULE 12: A NUMBER WRITTEN ON BARS (found by a value check of a live round, 2026-11-22). Asked to "write the
#: count above each bar of the run as a number from 1 to 9", the assistant wrote
#: `plotchar(cnt > 0 ? cnt : na, "Count", "", location.abovebar)`. `plotchar` draws ONE fixed character wherever
#: its series has a value; with an empty character this engine draws its default mark. Every bar of the run got the
#: same mark and no bar got its number. The next round's answer to the same shape used
#: `label.new(bar_index, low, str.tostring(n))` and was right on every bar it was checked on.
NUMBER_ON_BARS_RULE = (
    "A NUMBER WRITTEN ON BARS that changes from bar to bar (a count, a rank, a value) is written with a label, one "
    "per bar: `if n > 0` then `label.new(bar_index, high, str.tostring(n), style = label.style_none, textcolor = "
    "color.green)`, with `max_labels_count = 500` in `indicator(...)`. `plotchar` and `plotshape` draw ONE FIXED "
    "character or text per call, the same on every bar: `plotchar(n, char = \"\")` writes no number at all.")

#: ⚰️ RULE 12 (a value on another timeframe is read AS IT STANDS, a look-back goes INSIDE the request) WAS HERE,
#: 2026-11-22, for nine hours. It shipped with a condition: `j06` ("a table that says whether the close is above the
#: 10 week and the 10 month moving average"), re-recorded live with the rule served, must be RIGHT. It was not.
#: Measured from recorded answers only: the rule changed that script's FORM (`wMA[1]` after the request became the
#: look-back inside it) and not its VALUE (the same two numbers, one period stale on the bar that completes a week
#: or month), and it made no value case right. The cause is not wording: the engine serves no "as it stands" value
#: of a FORMING higher-timeframe bar (G6), so no last-bar table is right on both a live weekday and a finished
#: Friday. `j06` stays recorded WRONG and is an acceptance case of the engine unit that serves that value.
#: What the measurement could NOT see: no recorded script PLOTS a weekly value, so a benefit to plots was never
#: tested. The pending value case `weekly-plot-01` asks exactly that; bring a rule back on what it shows.

#: ⭐⭐ ADMITTED FOR FINISHED BARS ONLY, SAID TO THE ASSISTANT (found live 2026-11-19). The engine admits some
#: capabilities on CLOSED-BAR evidence only (G6, `historyOnly` in the generated reference, held equal to the
#: server's own list): a script that uses one is not drawn bar by bar while the chart's newest bar is forming,
#: which on a live chart is the whole session. Rule 5 used to TEACH `if barstate.islast`, three recipes and three
#: worked examples did it, and every one was proven on a chart whose newest bar had finished: before the open
#: they ran, and all session long a member's chart refused them.
#: {capability: the reads that make a script one, as the rule says them}. A history-only capability must be
#: worded here or be one the assistant is not offered at all (`NOT_FOR_THE_ASSISTANT`); a test holds that, and
#: holds each read named here to the server's own detector.
HISTORY_ONLY_READS: Dict[str, str] = {
    "realtime-state": "`barstate.*` other than `barstate.isfirst`, `last_bar_index`, `last_bar_time`, `timenow`",
}
#: The work that may still wait for the last bar: too slow to repeat on every bar (measured 2026-11-19 on 5,000
#: bars against the engine's one-second run budget: a profile's loops came within a fifth of it, a 500-bar
#: statistics loop went past it).
_LAST_BAR_WORK = "work that loops over past bars on every update (a volume profile, statistics over the last N bars)"
#: What UCT says beside a script that waits for the bar. ⛔ SAID BY THE WINDOW, which knows the lane that draws
#: the script (`authoring/scriptAnswer.js::WAITS_ON_A_LIVE_CHART_LINE`, held equal to this by a test); the
#: server sends only the fact (`script.waits_for_the_bar`, its own detector on THE SCRIPT).
#: ⚰️ It said "drawn when the newest bar closes". On an intraday chart a new bar starts forming the moment one
#: closes, so during the session that moment never comes: the truthful sentence names the close of the session.
FINISHED_BARS_LINE = ("While the market is open this is not drawn: it appears once the chart's newest bar has "
                      "finished, after the close.")


def history_only(ref: Optional[Mapping[str, Any]] = None) -> List[str]:
    """The admitted capabilities admitted for finished bars only, from the generated reference."""
    ref = reference() if ref is None else ref
    return [c for c in ref.get("historyOnly") or [] if isinstance(c, str)]


def _last_bar_said(ref: Optional[Mapping[str, Any]] = None) -> str:
    """The second half of rule 5: what waiting for the last bar costs today, and the one thing that may."""
    reads = [HISTORY_ONLY_READS[c] for c in history_only(ref) if c in HISTORY_ONLY_READS]
    if not reads:
        return f" Do {_LAST_BAR_WORK} once, under `if barstate.islast`."
    return (f" Do not wait for the last bar to draw it: a script that reads where the chart ends ({'; '.join(reads)}) "
            "is drawn only once the chart's newest bar has FINISHED, so on a live chart it shows nothing all session. "
            f"The ONE exception is {_LAST_BAR_WORK}: that is too slow to repeat on every bar, so do it under "
            "`if barstate.islast`.")


def script_capabilities(script: Any) -> Optional[frozenset]:
    """The server's own capability detector on THIS script, run ONCE per script answer: the set answers
    both `waits_for_the_bar` and the admission verdict that rides the answer
    (`runtime_definitions.script_answer_admission`). ``None`` for an unreadable script or a detector that
    raised (the engine's verdict still stands; the window then asks the verdict door as before)."""
    if not isinstance(script, str) or not script.strip():
        return None
    from api.services import pine_capabilities
    try:
        return frozenset(pine_capabilities.capabilities_of(script))
    except Exception:                              # noqa: BLE001 -- the engine's verdict still stands
        return None


def waits_for_the_bar(script: Any, ref: Optional[Mapping[str, Any]] = None,
                      caps: Optional[frozenset] = None) -> bool:
    """Does THIS script use anything admitted for finished bars only, so that the bar-by-bar lane draws it
    only once the chart's newest bar has finished? The server's own capability detector (`caps`: its set when
    the caller already has it, `script_capabilities`), asked about EVERY history-only capability of the
    reference (a script that requests another timeframe or symbol waits exactly as one that reads
    `barstate.islast` does; review 2026-11-19). Whether that delays THIS script depends on the lane that draws
    it, which only the window knows: the window says the sentence, this is the fact. False on an unreadable
    script (which the engine refuses anyway)."""
    worded = set(history_only(ref))
    if not worded or not isinstance(script, str) or not script.strip():
        return False
    if caps is None:
        caps = script_capabilities(script)
    return bool(caps is not None and set(caps) & worded)


#: Pine's own functions for well-known indicators, as candidates for rule 10's examples. ⛔ ONLY the ones
#: the generated reference lists as served are ever named to the assistant (`_own_functions_said`): naming a
#: function this engine refuses would teach a script the engine refuses.
OWN_FUNCTION_CANDIDATES = ("ta.supertrend", "ta.sar", "ta.kc", "ta.kcw", "ta.bb", "ta.bbw", "ta.accdist", "ta.vwap",
                           "ta.cmo", "ta.tsi", "ta.mfi", "ta.cci", "ta.obv", "ta.rsi", "ta.macd", "ta.atr", "ta.stoch",
                           "ta.dmi", "ta.wpr", "ta.hma", "ta.linreg")


#: ⭐ (T4 E2, NUMBER PENDING, train e95) the event reads the engine serves (`request.earnings` / `.dividends` / `.splits`)
#: are supplied by ONE door, `GET /api/pine/events/<symbol>`, staged by `PINE_EVENTS_SUPPLY_ENABLED`
#: (`pine_events.stage()`). Until it is `all` a member's chart answers "earnings data is not available on this chart
#: yet", so the assistant is never handed them and the gap stays a gap: the stage the door reads is the one authority.
EVENT_READS = ("request.earnings", "request.dividends", "request.splits")
EVENTS_DARK_GUARD = "other-symbol:event-not-available"


def events_open_to_members() -> bool:
    """Does the events door answer every paid member (`PINE_EVENTS_SUPPLY_ENABLED=all`)? Read per call."""
    from api.services import pine_events
    return pine_events.stage() == "all"


#: ⭐⭐ (T4 B2, NUMBER PENDING, train e95) TradingView's `USI:` breadth spellings the engine serves from UCT's own breadth
#: counts are supplied by ONE door, `GET /api/pine/breadth/<spelling>` (B1), staged by `PINE_BREADTH_SUPPLY_ENABLED`
#: (`pine_breadth.stage()`), and each spelling is served only once its capture witnesses it (`requestWitnesses.json`
#: rows of kind `breadth`, the engine's one authority, read here as data). The assistant is handed a spelling only
#: while BOTH hold (the E2 pattern): below `all` a member's chart answers "UCT breadth data is not available on this
#: chart yet", so the gap stays a gap.
BREADTH_DARK_GUARD = "other-symbol:breadth-not-available"
WITNESSES_PATH = Path(__file__).resolve().parents[2] / "app" / "src" / "components" / "chart" / "engine" / "requestWitnesses.json"
BREADTH_WORDS = "UCT breadth data (our own counts), not the exchange's official figures"
_BREADTH_IN_SOURCE = re.compile(r"(?i)[\"']\s*USI\s*:")


def breadth_open_to_members() -> bool:
    """Does the breadth door answer every paid member (`PINE_BREADTH_SUPPLY_ENABLED=all`)? Read per call."""
    from api.services import pine_breadth
    return pine_breadth.stage() == "all"


def breadth_spellings_served(path=None) -> List[str]:
    """The `USI:` spellings the engine serves: the breadth witness rows whose capture is in (`witness` + `captured`)."""
    try:
        rows = json.loads((path or WITNESSES_PATH).read_text(encoding="utf-8")).get("rows") or {}
    except (OSError, ValueError):
        return []
    return sorted(k for k, v in rows.items() if isinstance(v, Mapping) and v.get("kind") == "breadth"
                  and str(v.get("witness") or "").strip() and str(v.get("captured") or "").strip())


def breadth_handed(path=None) -> List[str]:
    """The `USI:` spellings the assistant is handed: served by the engine AND its door open to members, else none."""
    return breadth_spellings_served(path) if breadth_open_to_members() else []


def _values(ref: Mapping[str, Any]) -> List[Mapping[str, Any]]:
    """`ref["values"]`, less the event reads while their door is dark for members."""
    rows = [v for v in ref.get("values") or [] if isinstance(v, Mapping) and isinstance(v.get("name"), str)]
    return rows if events_open_to_members() else [v for v in rows if v["name"] not in EVENT_READS]


def served_names(ref: Optional[Mapping[str, Any]] = None) -> frozenset:
    """The value functions and variables the document lists as served: the SAME rows it prints under
    "VALUE FUNCTIONS AND VARIABLES" (`_values`), so rule 10 can never name one the document does not."""
    ref = reference() if ref is None else ref
    return frozenset(v["name"] for v in _values(ref))


def _own_functions_said(ref: Optional[Mapping[str, Any]] = None) -> str:
    """Rule 10's examples: the candidates this engine serves, or '' when it serves none of them."""
    served = served_names(ref)
    said = [f"`{name}`" for name in OWN_FUNCTION_CANDIDATES if name in served]
    return f"The ones listed here: {', '.join(said)}. " if said else ""


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


def contract(ref: Optional[Mapping[str, Any]] = None) -> str:
    """The contract as the assistant reads it: the rules, with rule 10's examples taken from the reference."""
    return (CONTRACT.replace("{own_functions}", _own_functions_said(ref)).replace("{last_bar}", _last_bar_said(ref))
            .replace("{number_on_bars}", NUMBER_ON_BARS_RULE)
            .replace("{format_literal}", FORMAT_LITERAL_RULE).replace("{fill_in}", FILL_IN_RULE))


def document(ref: Optional[Mapping[str, Any]] = None, run_stops: Optional[List[str]] = None) -> str:
    """The assistant's instructions for a script turn. Deterministic: the same reference gives the
    same text (it is sent as a cached system block)."""
    ref = reference() if ref is None else ref
    if not available(ref):
        raise ValueError("the Pine reference is not available: no script turn may be made")
    admitted = list(ref.get("admitted") or [])
    out: List[str] = [contract(ref), ""]

    out += _lines("LANGUAGE YOU MAY USE", [f"- {CAPABILITY_WORDS[c]}" for c in admitted if c in CAPABILITY_WORDS])

    out += _lines("WHAT A SCRIPT CAN SHOW", [f"- `{name}`" for name in served_outputs(ref)])

    out += _lines("VALUE FUNCTIONS AND VARIABLES (each with a call the engine accepts)",
                  [f"- `{v['name']}`  e.g. `{v['call']}`" for v in _values(ref)])
    # ⭐⭐ T4 B2 -- only while the breadth door serves members, and only the spellings the engine serves
    out += _lines(f"MARKET BREADTH ({BREADTH_WORDS}; read each as `request.security(<symbol>, \"D\", close)` on a daily, "
                  "weekly or monthly chart)", [f"- `{s}`" for s in breadth_handed()])

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
    for s in stops:
        if s in RUN_STOP_WORDS:
            never.append(f"- {RUN_STOP_WORDS[s]}")
        # ⭐ THE WAY THROUGH, said right under the limit it is a way through: only while that limit
        # stands and the probe that would close the way does NOT (`RUN_STOP_RELIEFS`)
        never += [f"- {words}" for closed_by, (limit, words) in RUN_STOP_RELIEFS.items() if limit == s and closed_by not in stops]
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
        elif pine_capabilities._EVENTS_RX.search(p["source"]) and not events_open_to_members():
            # the engine reads it; the door that supplies it is dark for members (`EVENT_READS`)
            row["guard"] = EVENTS_DARK_GUARD
            row["says"] = "the engine reads it, and the data is not available on a member's chart yet"
        elif _BREADTH_IN_SOURCE.search(p["source"]) and not breadth_handed():
            # ⭐⭐ T4 B2 -- a `USI:` read: the engine reads it, and the breadth door is dark for members (or the
            # spelling's capture has not landed)
            row["guard"] = BREADTH_DARK_GUARD
            row["says"] = "the engine reads it, and UCT breadth data is not available on a member's chart yet"
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


#: ⭐ A WAY THROUGH A LIMIT, RECORDED AS A PROBE TOO (2026-11-19). {the probe that CLOSES the way:
#: (the limit it is a way through, the sentence)}. The sentence is said while the limit stands and the
#: closing probe does not; while both stand the closing probe's own `RUN_STOP_WORDS` sentence is said
#: instead; with the limit gone neither is.
#: ⚰️ The reason it is a probe: the limit's sentence used to say "reading it one bar back does not
#: rescue it". Engine 84 made one bar back draw, and the sentence was false until someone read it.
RUN_STOP_RELIEFS: Dict[str, Tuple[str, str]] = {
    "higher-timeframe-one-bar-back": (
        "higher-timeframe-newest-bar",
        "The way through: that value ONE BAR BACK, `x[1]` read alone (not inside `nz()` or a condition that "
        "also reads `x`), DOES have a value on the newest bar: it is the last finished week or month, except on "
        "the bar that completes one, where it is the period before. When the script needs the value on the last "
        "bar (a table, a label, a level), read `x[1]` and say in `reply` that it shows the last finished period "
        "and moves when the next one starts."),
}


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


# ⭐ IS THIS SCRIPT ONE OF THE VALUE-CHECKED RECIPES? (coordinator's ruling 2026-11-19). A recipe's numbers
# are proven against an independent calculation; a script the assistant wrote from the member's words
# alone runs faithfully and its READING is the assistant's. The member must be told which they got.
#
# ⛔ DECIDED HERE, BY COUNTING, NEVER BY THE ASSISTANT. A script is backed by a recipe when the request
# was HANDED that recipe and the script holds at least `RECIPE_BACKED_SHARE` of the recipe's own tokens,
# in order (comments and the `indicator(...)` line aside). Measured on the first live scripts
# (2026-11-19): a script that is its recipe with settings added scores 0.91 to 1.00; one the assistant
# restructured 0.71; a script against a recipe it has nothing to do with at most 0.58. Both ways of being
# wrong are soft, and the bar is set so the common one is the safe one: a recipe-backed script that says
# "check it" (over-told), never an unchecked one that does not.
RECIPE_BACKED_SHARE = 0.85
UNCHECKED_LINE = ("Built from your description; there's no checked reference for this pattern, so check it "
                  "against your own reading.")
_CODE_TOKEN = re.compile(r"[A-Za-z_][A-Za-z0-9_.]*|\d+(?:\.\d+)?|[^\sA-Za-z0-9_]")


def _code_tokens(source: Any) -> List[str]:
    """A script as the tokens that compute: no comments, no `indicator(...)` line (its title is the
    member's), no layout."""
    lines = str(source or "").replace("\r\n", "\n").split("\n")
    code = "\n".join(line.split("//")[0] for line in lines if not line.strip().startswith("indicator("))
    return _CODE_TOKEN.findall(code)


#: ⛔ THE COMPARISON IS BOUNDED (review 2026-11-19). `script` may be a browser-supplied refusal of up to
#: `SCRIPT_MAX_CHARS`, compared before any spend cap is asked; the matcher's cost grows with the product of the
#: two lengths, and a script that is one token repeated twenty thousand times made it seconds of CPU. A script
#: more than this many times the recipe's own length is not "that recipe with settings added" (the measured
#: recipe-backed scripts are 1 to 1.5 times it), so it is not compared at all.
RECIPE_LENGTH_FACTOR = 3
_OWN_CALL = re.compile(r"(?<![\w.])(?:ta|request)\.[a-z_0-9]+")


def _own_calls(source: Any) -> frozenset:
    """The Pine functions a script's maths rests on (`ta.*`, `request.*`), comments aside."""
    code = "\n".join(line.split("//")[0] for line in str(source or "").replace("\r\n", "\n").split("\n"))
    return frozenset(_OWN_CALL.findall(code))


def recipe_share(recipe_source: Any, script: Any) -> float:
    """The share of the recipe's tokens the script holds, in order (0 to 1)."""
    import difflib
    own, got = _code_tokens(recipe_source), _code_tokens(script)
    if not own or not got or len(got) > RECIPE_LENGTH_FACTOR * len(own):
        return 0.0
    blocks = difflib.SequenceMatcher(None, own, got, autojunk=False).get_matching_blocks()
    return sum(b.size for b in blocks) / len(own)


def backed_by(message: Any, script: Any, doc: Optional[Mapping[str, Any]] = None) -> Optional[str]:
    """The id of the value-checked recipe this script IS, or None. Only a recipe this request was
    handed (`recipes_for`) counts: a script cannot be vouched for by a recipe nobody asked about."""
    # ⛔ AND THE SCRIPT STILL CALLS EVERY PINE FUNCTION THE RECIPE'S MATHS RESTS ON (review 2026-11-19). A recipe
    # is handed on one word of its request ("divergence"); the RSI-divergence recipe with `ta.rsi` swapped for
    # `ta.macd` keeps nearly every token and would be vouched for by a check that was made of the RSI's numbers.
    for r in recipes_for(message, doc=doc):
        if not _own_calls(r["source"]) <= _own_calls(script):
            continue
        if recipe_share(r["source"], script) >= RECIPE_BACKED_SHARE:
            return r["id"]
    return None


def said_with_disclosure(said: Any, reference: Optional[str]) -> str:
    """What the member reads beside a script: the assistant's words, and, when no recipe is behind
    the script, UCT's own line saying so. The line is never cut and never said twice."""
    text = str(said or "").strip()
    if reference is not None or UNCHECKED_LINE in text:
        return text[:REPLY_MAX_CHARS]
    room = REPLY_MAX_CHARS - len(UNCHECKED_LINE) - 1
    return (_fit(text, room) + " " + UNCHECKED_LINE).strip()


def _fit(text: str, room: int) -> str:
    """`text` in at most `room` characters, never cut mid-word (review 2026-11-19: a reply of 500 characters
    was sliced wherever the count fell): whole when it fits; else up to the end of its last sentence when that
    keeps at least half the room; else up to its last whole word, with "..."."""
    if len(text) <= room:
        return text
    cut = text[:room]
    end = max(cut.rfind(mark) for mark in (". ", "! ", "? "))
    if end >= room // 2:
        return cut[:end + 1]
    cut = text[:max(0, room - 3)]
    space = cut.rfind(" ")
    return (cut[:space] if space > 0 else cut).rstrip(" ,;:(") + "..."


#: Said under a recipe that does its work on the last bar (`finishedBarsOnly` in the generated file).
LAST_BAR_RECIPE_LINE = ("(This recipe waits for the last bar on purpose: keep its `if barstate.islast`. UCT tells the "
                        "member when it is drawn; do not describe that yourself.)")


def _request_calls(script: Any) -> Optional[List[str]]:
    """Every `request.security(...)` of a script, WHOLE (symbol, timeframe, expression and options), with
    comments and layout aside, sorted. None when one cannot be read to its closing bracket."""
    if not isinstance(script, str):
        return None
    code = _code_only(script)
    blanked = _strings_blanked(code)
    out = []
    for m in _REQUEST_CALL.finditer(blanked):
        depth, i = 1, m.end()
        while i < len(blanked) and depth:
            depth += (blanked[i] == "(") - (blanked[i] == ")")
            i += 1
        if depth:
            return None
        out.append("".join(code[m.start():i].split()))
    return sorted(out)


def recipe_whose_requests_these_are(message: Any, script: Any, doc: Optional[Mapping[str, Any]] = None) -> Optional[str]:
    """The id of the checked recipe this script is backed by AND whose `request.security` calls are EXACTLY
    this script's, or None.

    `backed_by` is a similarity (the script holds 85 percent of the recipe's tokens, in order): right for
    saying which answers were value-checked, too wide for excusing a read. A script that resembles a recipe
    and requests something the recipe does not (one more request, another timeframe, another expression) was
    not checked with that request in it. So the requests are held to IDENTITY: the same calls, whole, the same
    number of times."""
    backed = backed_by(message, script, doc)
    if backed is None:
        return None
    recipe = next((r for r in recipes(doc) if r["id"] == backed), None)
    own = _request_calls(recipe["source"]) if recipe else None
    return backed if own and own == _request_calls(script) else None


def recipes_text(found: List[Mapping[str, Any]]) -> str:
    """The recipes as they ride the request, or '' for none."""
    if not found:
        return ""
    out = ["RECIPES (whole scripts this engine runs as written; start from the closest):"]
    for r in found:
        out += [f"### {r['title']}", f"How it works: {r['shows']}.", "```pine", r["source"].rstrip("\n"), "```"]
        if r.get("finishedBarsOnly") is True:
            out += [LAST_BAR_RECIPE_LINE]
    return "\n".join(out)
