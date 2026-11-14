# -*- coding: utf-8 -*-
"""ONE Pine capability detector (WS-I Part 2, 2026-11-13: admission by capability).

A member's own copy of a script differs by a byte from any graded copy, so the per-script
sha256 allowlist (`api/data/pine_runtime_allowlist.json` `scripts[]`) admits nothing a member
brings. Admission by capability asks a different question: does this script use ONLY
capabilities that carry vendor-graded MATCH evidence with the runtime pane on? This module is
the ONE answer to "which capabilities does a script use". `runtime_definitions.
capability_admitted` asks it on the server; the census (`tools/pine_coverage/coverage_map.py`)
re-imports `strip_code` / `FEATURES` / `usage_of` from here, so the census and the gate can
never disagree about a feature (derived, never restated).

⛔⛔ IT OVER-DECLARES AND NEVER UNDER-DECLARES. Every rule below errs toward naming a
capability the script may not really use: a capability named but unused can only WITHHOLD a
script, a capability used but unnamed would ADMIT one on evidence that never measured it.
`tests/test_pine_capabilities.py` holds it to the coverage census snapshot (A6).

⛔⛔ CLOSED WORLD. `capabilities_of` returns ids from `CAPABILITY_IDS` and, for a source the
repaint classifier cannot read, `UNREADABLE`. The gate admits a script only when EVERY id it
returns is admitted in the registry; an id absent from the registry (a new feature, an object
family, `UNREADABLE`) withholds it.

The vocabulary:
  * `core`: declared by EVERY readable script (series expressions, built-in calls, plots). It
    is what keeps the world closed for a script that uses no listed feature: without it such a
    script would name nothing and be admitted vacuously, even by an empty or unreadable
    registry. It is admitted only on its own evidence, like every other id;
  * the census FEATURES ids (language features: `var`, `if-block`, `switch`, `method-call` ...);
  * `obj:*` the drawing-object families and their operations (line, label, box, table,
    linefill, polyline, delete, getter, collection);
  * the runtime-only ids, things only the per-bar run can do and no capture grades:
    `varip` (also a feature), `calc-bars`, `realtime-state`, `request-other`.

Pure: no env, no network. The repaint classifier (`runtime_repaint`) is read for
`realtime-state` / `request-other` so those two derive from its rule table, not a copy.
`engine_order_calls` reads `pine.js` LAZILY (`strategy_orders`), so the server never opens a
front-end file at import; only `usage_of` (the census) asks it.
"""
from __future__ import annotations

import functools
import os
import re

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ⭐⭐ WS-C (2026-10-31) — `conditional-ta`: a `ta.*` CALL WRITTEN INSIDE a block
# that does not run on every bar (an `if` / `else` / `switch` arm, a `for` /
# `while` body) or inside a user function's body. Pine keeps such a call's
# history PER CALL SITE (C48, `vw-call-site-history`), which the runtime lane
# serves for `ta.sma` / `ta.ema` in a root-level block and refuses by name
# (`runtime:conditional-history`, R4) everywhere else.
#
# ⛔ BLOCK-AWARE, NOT "the script has an `if` and a `ta.`". The header line's own
# condition (`if ta.crossover(a, b)`) runs every bar and does NOT count; only a
# DEEPER-indented line in the header's contiguous block does (blank lines may sit
# inside it).
# ⛔ v1-v4 spell the same calls bare (`sma(`, `rsi(`), so the bare names Pine had
# before namespaces are matched too; a v5+ user function that reuses one of
# those names is over-reported, which is the safe direction for a grading gate.
#
# ⛔⛔ WS-I Part 2 review B1 (2026-11-13): IT IS A LINE SCAN, NOT A REGEX. The regex this
# replaced (`COND_TA_RX`: a lazy group of block lines over a back-referenced indentation)
# backtracked super-linearly: a 33.8 KB source took 15.3 s and a 126 KB one 230 s, holding the
# GIL on a sync route, so ONE request froze the web pod. `conditional_ta_in` walks each logical
# line once with a stack of open block indents: linear. Every regex left in this module is
# anchored or bounded so that it is linear too (`^[ \t]*+` is POSSESSIVE and never crosses a
# line; `\s` under `re.M` used to let `^\s*` restart from every blank line, quadratic on a file
# of blank lines). `tests/test_pine_capabilities.py` times adversarial 128 KiB sources (B1).
_COND_TA_BARE = ("sma|ema|rma|wma|vwma|swma|hma|alma|linreg|rsi|atr|tr|stdev|dev|variance|"
                 "highest|lowest|highestbars|lowestbars|change|mom|roc|cum|sum|crossover|crossunder|"
                 "cross|valuewhen|barssince|pivothigh|pivotlow|rising|falling|correlation|percentrank|"
                 "percentile_linear_interpolation|percentile_nearest_rank|median|mode|range|stoch|cci|"
                 "mfi|cmo|tsi|bb|bbw|kc|kcw|macd|dmi|sar|supertrend|vwap|wpr|cog")
_COND_TA_CALL_RX = re.compile(r"(?<![\w.])(?:ta\.\w+|(?:%s))\s*\(" % _COND_TA_BARE)
#: A block header, matched at the START of one logical line (indentation removed).
_COND_TA_HEADER_RX = re.compile(r"(?:[\w\[\], ]+=[ \t]*)?(?:if|for|while|switch)\b|else\b"
                                r"|(?:export\s+)?(?:method\s+)?\w+\s*\([^()]*\)\s*=>")


def _indent_of(line):
    n = 0
    for ch in line:
        if ch == " ":
            n += 1
        elif ch == "\t":
            n += 4
        else:
            break
    return n


def join_continuations(code):
    """Fold Pine's wrapped lines into the logical line they continue (C2, review 2026-11-13).

    A physical line CONTINUES the previous logical line when a `(` or `[` is still open at its
    start, or when it is indented deeper than that line by a number of columns that is NOT a
    multiple of 4 (Pine's own rule for a wrapped line; a multiple of 4 opens a block). The
    logical line keeps its first line's indentation; a continuation is appended after one space.
    Comments and string contents must already be stripped (`strip_code`). Linear. Returns the
    SAME string when nothing is folded."""
    out = []                       # logical lines, each a list of pieces (no quadratic appends)
    depth = 0
    base = 0
    folded = False
    for line in code.split("\n"):
        body = line.strip()
        ind = _indent_of(line) if body else 0
        if out and body and (depth > 0 or (ind > base and (ind - base) % 4 != 0)):
            out[-1].append(body)
            folded = True
        else:
            out.append([line])
            if body:
                base = ind
        if body:
            depth = max(0, depth + body.count("(") + body.count("[") - body.count(")") - body.count("]"))
    return "\n".join(" ".join(parts) for parts in out) if folded else code


def conditional_ta_in(code, *, joined=None):
    """Does a ta call sit INSIDE a block (an if / else / switch arm, a for / while body, a user
    function body)? One pass over the logical lines (`join_continuations` first, or `joined` when
    the caller already folded them), a stack of the open headers' indentation: a line deeper than
    an open header is in its block."""
    stack = []
    for line in (joined if joined is not None else join_continuations(code)).split("\n"):
        text = line.strip()
        if not text:
            continue
        ind = _indent_of(line)
        while stack and stack[-1] >= ind:
            stack.pop()
        if stack and _COND_TA_CALL_RX.search(text):
            return True
        m = _COND_TA_HEADER_RX.match(text)
        if m:
            if "=>" in m.group(0) and _COND_TA_CALL_RX.search(text, m.end()):
                return True                       # a single-line function body
            stack.append(ind)
    return False


FEATURES = [  # (id, label, regex over comment/string-stripped code, flags) - every regex linear (B1)
    # B1: each line-anchored row opens `^[ \t]*+` (possessive, never crosses a line) where it was
    # `^\s*`; the rest of each pattern is the census's own, unchanged.
    ("var", "var declarations (state that persists across bars)", r"^[ \t]*+var\s+", re.M),
    ("varip", "varip (intrabar-persistent state, realtime only)", r"\bvarip\b", 0),
    ("if-block", "if statements / blocks", r"^[ \t]*+(?:[\w\[\], ]+=\s*)?if\b", re.M),
    ("for", "for loops", r"^[ \t]*+(?:[\w\[\], ]+=\s*)?for\s+\w+\s*=", re.M),
    ("for-in", "for...in loops", r"^[ \t]*+(?:[\w\[\], ]+=\s*)?for\s+(?:\[[^\]]*\]|\w+)\s+in\b", re.M),
    ("while", "while loops", r"^[ \t]*+(?:[\w\[\], ]+=\s*)?while\b", re.M),
    ("switch", "switch", r"\bswitch\b", 0),
    ("reassign", ":= reassignment", r":=", 0),
    ("compound-assign", "+= -= *= /= %=", r"[+\-*/%]=(?!=)", 0),
    ("tuple-destructure", "[a, b] = tuple destructuring", r"^[ \t]*+\[[\w\s,]+\]\s*=", re.M),
    ("fn-single", "user function, single-line body", r"^[ \t]*+(?:export\s+)?\w+\s*\([^()]*\)\s*=>\s*\S", re.M),
    ("fn-multi", "user function, multi-line body", r"^[ \t]*+(?:export\s+)?\w+\s*\([^()]*\)\s*=>\s*$", re.M),
    ("udt", "type (user-defined types)", r"^[ \t]*+(?:export\s+)?type\s+\w+", re.M),
    ("method-def", "method definitions", r"^[ \t]*+(?:export\s+)?method\s+\w+", re.M),
    ("enum", "enum", r"^[ \t]*+(?:export\s+)?enum\s+\w+", re.M),
    ("import", "import of a library", r"^[ \t]*+import\s+\S+", re.M),
    ("library-decl", "library() declaration", r"^[ \t]*+library\s*\(", re.M),
    ("strategy-decl", "strategy() declaration", r"^[ \t]*+strategy\s*\(", re.M),
    # C1 (review 2026-11-13): `matrix.new<float>` / `map.new<string, float>` / `array.new<line>` are generics too
    ("generics", "array<T> / matrix<T> / map<K,V> generics", r"\b(?:array|matrix|map)(?:\s*\.\s*new\w*)?\s*<", 0),
    ("typed-array", "float[] style array types", r"\b(?:float|int|bool|string|color|line|label|box)\s*\[\s*\]", 0),
    ("history-expr", "history reference on an expression  (expr)[n]", r"\)\s*\[", 0),
    # decided in usage_of()/capabilities_of(): `x.f(` where x is NOT a built-in namespace (never matches)
    ("method-call", "method-call syntax  x.f(...) on a value", r"(?!)", 0),
    ("max_bars_back", "max_bars_back", r"\bmax_bars_back\b", 0),
    ("ternary", "?: ternary", r"\?[^?:\n]+:", 0),
    # decided in features_of() by `conditional_ta_in`, a line scan (never matches)
    ("conditional-ta", "ta.* called inside an if / loop / switch arm or a function body (per-call-site history)",
     r"(?!)", 0),
]


def features_of(code):
    """The census FEATURES a comment- and string-stripped script uses: each row's regex over the
    code AND over its logical lines (`join_continuations`, so a wrapped ternary or a function
    header split over lines is seen; C2), plus `conditional-ta` from its line scan. Never fewer
    than either form alone. Linear (B1). `method-call` is decided by the caller (namespaces)."""
    joined = join_continuations(code)
    found = set()
    for fid, _l, rx, fl in FEATURES:
        if re.search(rx, code, fl) or (joined is not code and fid in _LINE_SENSITIVE
                                       and re.search(rx, joined, fl)):
            found.add(fid)
    if conditional_ta_in(code, joined=joined):
        found.add("conditional-ta")
    return found


#: The rows whose answer can change when wrapped lines are folded: those anchored at a line
#: start (`re.M`) or stopping at a newline. Every other row already reads across lines.
_LINE_SENSITIVE = frozenset(fid for fid, _l, rx, fl in FEATURES if fl & re.M or r"\n" in rx)


def strip_code(src):
    """Remove // comments and string CONTENTS (quotes kept). Returns (code, strings)."""
    out, strings, i, n = [], [], 0, len(src)
    while i < n:
        c = src[i]
        if c == "/" and src.startswith("//", i):
            while i < n and src[i] != "\n":
                i += 1
            continue
        if c in "\"'":
            q, j, buf = c, i + 1, []
            while j < n and src[j] != q and src[j] != "\n":
                if src[j] == "\\" and j + 1 < n:
                    buf.append(src[j:j + 2])
                    j += 2
                    continue
                buf.append(src[j])
                j += 1
            strings.append("".join(buf))
            out.append(q + q)
            i = j + 1
            continue
        out.append(c)
        i += 1
    return "".join(out), strings


def version_of(src):
    m = re.search(r"//\s*@version\s*=\s*(\d+)", src)
    return int(m.group(1)) if m else 1

#: The census's method-call rule: `x.f(` (or `).f(` / `].f(`), the receiver in group 1. A call on a
#: receiver that is NOT a built-in namespace is a method call. ONE regex for `usage_of` (the census,
#: namespaces from the reference inventory) and `capabilities_of` (the gate, `BUILTIN_NAMESPACES`).
METHOD_CALL_RX = re.compile(r"(?:(?<![\w.])([A-Za-z_]\w*)|[\)\]])\s*\.\s*[a-z_]\w*\s*\(")


def usage_of(src, inv):
    """Which inventory items, legacy names, features and method calls one script uses."""
    version = version_of(src)
    code, strings = strip_code(src)
    used = set()
    for m in re.finditer(r"(?<![\w.])([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)", code):
        raw = re.sub(r"\s+", "", m.group(1))
        nm = inv.normalise(raw, version)
        if nm:
            # a bare word that is ALSO a keyword/type (`float`, `color`) is only that when it IS the item
            used.add(nm)
            continue
        parts = raw.split(".")
        # `color.new` inside `ns.fn` chains, and method calls `x.push(`
        if len(parts) >= 2:
            tail_call = code[m.end():m.end() + 3].lstrip().startswith("(")
            head = parts[0]
            last = parts[-1]
            if head not in inv.namespaces and tail_call and last in inv.methods:
                cands = inv.methods[last]
                typed = {ns for ns in cands if re.search(r"\b%s\s*(?:\.|<)" % re.escape(ns), code)
                         or (ns == "array" and re.search(r"\w\s*\[\s*\]", code))}
                for ns in (typed or cands):
                    used.add(ns + "." + last)
    for op in ("+", "-", "*", "/", "==", "!=", ">", "<", ">=", "<=", "="):
        if op in code:
            used.add(op)
    for op in ("?:", ":=", "+=", "-=", "*=", "/=", "%=", "=>", "[]", "%"):
        if op == "?:":
            if re.search(r"\?[^?:\n]+:", code):
                used.add("?:")
        elif op == "[]":
            if re.search(r"[\w\)]\s*\[", code):
                used.add("[]")
        elif op in code:
            used.add(op)
    feats = features_of(code)
    for m in METHOD_CALL_RX.finditer(code):
        if m.group(1) is None or m.group(1) not in inv.namespaces:
            feats.add("method-call")
            break
    if re.search(r"\b(?:float|int|bool|string|color)\s*\[\s*\]", code):
        used.add("array")
    # request.security symbol literals, for the cross-symbol census
    syms = []
    for m in re.finditer(r"(?:request\.security|security)\s*\(\s*\"([^\"]*)\"", src):
        syms.append(m.group(1))
    for m in re.finditer(r"input\.symbol\s*\(\s*\"([^\"]*)\"", src):
        syms.append(m.group(1))
    # ⛔ A KEYWORD SPELLED AS A WORD IS NOT THE KEYWORD: `type = input.integer` (a v4 named
    # argument) is not a UDT, `in` / `as` appear in prose-like identifiers. These keywords
    # count only when the statement that USES them is present.
    for kw, feat in KEYWORD_FEATURE.items():
        used.discard(kw)
        if feat in feats:
            used.add(kw)
    return {"version": version, "items": used, "features": feats, "symbols": syms, "orders": order_calls_in(code)}


KEYWORD_FEATURE = {"type": "udt", "in": "for-in", "as": "import", "import": "import", "method": "method-def",
                   "enum": "enum", "while": "while", "for": "for", "switch": "switch", "varip": "varip"}
# ⭐ W9 T0 - ONE authority for "which calls place or manage orders": the engine's own
# STRATEGY_ORDER_CALLS (pine.js), read from the source, never restated here (the old copy named 5 of the
# engine's 13). Detection is from the SCRIPT'S TEXT, never from the reference inventory: a reference
# extract that lacks a name (the 11-03 map's lacks strategy.entry / exit / order / position_size) makes
# an inventory lookup say "no orders" and a strategy placing orders counted as transferring.
PINE_JS = os.path.join(_ROOT, "app", "src", "components", "chart", "engine", "ast", "pine.js")


def engine_order_calls(path=PINE_JS):
    """The names in pine.js's `export const STRATEGY_ORDER_CALLS = Object.freeze(new Set([...]))`."""
    src = open(path, encoding="utf-8").read()
    m = re.search(r"STRATEGY_ORDER_CALLS\s*=\s*Object\.freeze\(\s*new Set\(\s*\[(.*?)\]", src, re.S)
    if not m:
        raise SystemExit("coverage_map: STRATEGY_ORDER_CALLS not found in %s" % path)
    names = re.findall(r"'([\w.]+)'", m.group(1))
    if not names:
        raise SystemExit("coverage_map: STRATEGY_ORDER_CALLS in %s is empty" % path)
    return frozenset(names)


@functools.lru_cache(maxsize=1)
def strategy_orders():
    """`engine_order_calls()` read ONCE, on first use (the census), never at import: the server
    imports this module for `capabilities_of`, which never asks it."""
    return engine_order_calls()


def order_calls_in(code, orders=None):
    """The order-set names a script CALLS, read from its comment- and string-stripped code
    (`strategy.entry(`, with whitespace around the dots allowed). Version-independent."""
    names = sorted(orders if orders is not None else strategy_orders(), key=len, reverse=True)
    rx = r"(?<![\w.])(" + "|".join(r"\s*\.\s*".join(re.escape(p) for p in n.split(".")) for n in names) + r")\s*\("
    return {re.sub(r"\s+", "", m.group(1)) for m in re.finditer(rx, code)}

# ─── WS-I Part 2 — THE CAPABILITY VOCABULARY AND THE ONE DETECTOR ──────────────────────────

#: The census FEATURES ids, in census order.
FEATURE_IDS = tuple(fid for fid, _label, _rx, _fl in FEATURES)

#: The drawing-object families. A script that writes one of these words (as a namespace, a type,
#: a generic argument or an `array.new_<family>`) is declared to use that family.
OBJECT_FAMILIES = ("line", "label", "box", "table", "linefill", "polyline")
#: `obj:*`: each family, and three operations over objects (any family).
OBJ_IDS = tuple("obj:" + f for f in OBJECT_FAMILIES) + ("obj:delete", "obj:getter", "obj:collection")
#: Declared by every readable script, so no script is admitted by naming nothing.
CORE_ID = "core"
#: C1 (review 2026-11-13): the collection NAMESPACES, each its own capability, so `core` does not
#: admit a whole namespace no capture exercised (`matrix` and `map` have no runtime-on capture).
#: Every OTHER built-in (ta.*, str.*, math.*, timeframe.*, plotshape ...) rides `core`: core admits
#: every built-in the runtime implements; the runtime front end's named refusals (pine:builtin,
#: runtime:conditional-history ...) and the graph/runtime differential are that net (EVIDENCE).
COLLECTION_IDS = ("collections:array", "collections:matrix", "collections:map")
#: What only the per-bar run can do, and no historical capture grades.
RUNTIME_ONLY_IDS = ("varip", "calc-bars", "realtime-state", "request-other")
#: ⛔ THE CLOSED WORLD: every id `capabilities_of` may return except `UNREADABLE`.
CAPABILITY_IDS = frozenset((CORE_ID,) + FEATURE_IDS + OBJ_IDS + COLLECTION_IDS + RUNTIME_ONLY_IDS)
#: B1/e: the largest source the detector reads: the runtime document's own cap
#: (`runtime_definitions.RUNTIME_MAX_DEFINITION_BYTES`; the rail holds the two equal).
MAX_SOURCE_BYTES = 128 * 1024
#: Returned for a source the repaint classifier cannot read (or that is not a string). It is
#: never in the vocabulary, so it can never be admitted: an unreadable script is withheld.
UNREADABLE = "unreadable"

#: The built-in namespaces a `x.f(` call may be made on WITHOUT being a method call. It is the
#: census inventory's namespace set (TradingView's v6 reference as `coverage_map.Inventory`
#: reads it, measured 2026-11-13) and must stay a SUBSET of it: a name here that the inventory
#: lacks would let `capabilities_of` miss a `method-call` the census finds (under-declaring).
#: A namespace missing from here only over-declares (`chart.point.new(` reads as a method call
#: and withholds the script), which is the safe direction.
BUILTIN_NAMESPACES = frozenset({
    "array", "box", "color", "input", "label", "line", "log", "map", "math", "matrix",
    "polyline", "request", "session", "str", "strategy", "syminfo", "ta", "table", "ticker",
    "timeframe",
})

_FAM = "|".join(OBJECT_FAMILIES)
_OBJ_FAMILY_RX = {f: re.compile(r"(?<![\w.])%s\b|\bnew_%s\b" % (f, f)) for f in OBJECT_FAMILIES}
_OBJ_DELETE_RX = re.compile(r"\.\s*delete\s*\(")
_OBJ_GETTER_RX = re.compile(r"\.\s*get_\w+\s*\(")
_OBJ_COLLECTION_RX = re.compile(
    r"(?<![\w.])(?:%s)\s*\.\s*all\b|\bnew_(?:%s)\b|<\s*(?:%s)\b|(?<![\w.])(?:%s)\s*\[\s*\]"
    % (_FAM, _FAM, _FAM, _FAM))
#: Over-declared: an `array.` / `array<` use, ANY `x[]` type (user types included), and the
#: built-ins that hand back an array (`str.split`, `request.security_lower_tf`,
#: `ta.pivot_point_levels`, `<object>.all`).
_COLLECTION_RX = {
    "collections:array": re.compile(
        r"(?<![\w.])array\s*[.<]|\b\w+\s*\[\s*\]|(?<![\w.])str\s*\.\s*split\s*\("
        r"|(?<![\w.])request\s*\.\s*security_lower_tf\b|(?<![\w.])ta\s*\.\s*pivot_point_levels\b"
        r"|(?<![\w.])(?:line|label|box|table|linefill|polyline)\s*\.\s*all\b"),
    "collections:matrix": re.compile(r"(?<![\w.])matrix\s*[.<]"),
    "collections:map": re.compile(r"(?<![\w.])map\s*[.<]"),
}
_CALC_BARS_RX = re.compile(r"\bcalc_bars_count\b")
#: Every `barstate.*` but `isfirst` (each other one answers differently on a live or forming
#: bar), and the wall clock.
_REALTIME_RX = re.compile(r"(?<![\w.])barstate\s*\.\s*(?!isfirst\b)[A-Za-z_]\w*|(?<![\w.])timenow\b")
#: Any data request, the chart's own included (over-declared: the identity request is folded by
#: the run, but no capture grades the fold), and the pre-v5 bare spellings.
_REQUEST_RX = re.compile(r"(?<![\w.])(?:request\s*\.\s*[A-Za-z_]\w*|security|financial)\s*\(")


def capabilities_of(source):
    """The capability ids this Pine source uses: a frozenset over `CAPABILITY_IDS`, plus
    `UNREADABLE` when the source is not a string, is blank, or the repaint classifier cannot
    read it.

    OVER-DECLARES, NEVER UNDER-DECLARES (module docstring). Comments and string contents are
    stripped first (`strip_code`), exactly as the census reads a script. Never raises."""
    if not isinstance(source, str) or not source.strip():
        return frozenset({UNREADABLE})
    # B1/e: bounded. A source over the runtime document's own cap is never stored or served, so it
    # is not read either: UNREADABLE (withheld, fail closed), in constant time.
    if len(source) > MAX_SOURCE_BYTES or len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
        return frozenset({UNREADABLE})
    code, _strings = strip_code(source)
    found = {CORE_ID} | features_of(code)
    # `method-call` is decided outside FEATURES (its regex never matches), by the census's own
    # rule, over the built-in namespaces instead of the reference inventory
    for m in METHOD_CALL_RX.finditer(code):
        if m.group(1) is None or m.group(1) not in BUILTIN_NAMESPACES:
            found.add("method-call")
            break
    for fam, rx in _OBJ_FAMILY_RX.items():
        if rx.search(code):
            found.add("obj:" + fam)
    if _OBJ_DELETE_RX.search(code):
        found.add("obj:delete")
    if _OBJ_GETTER_RX.search(code):
        found.add("obj:getter")
    if _OBJ_COLLECTION_RX.search(code):
        found.add("obj:collection")
    for cid, rx in _COLLECTION_RX.items():
        if rx.search(code):
            found.add(cid)
    if _CALC_BARS_RX.search(code):
        found.add("calc-bars")
    if _REALTIME_RX.search(code):
        found.add("realtime-state")
    if _REQUEST_RX.search(code):
        found.add("request-other")
    # ⭐ AND THE REPAINT CLASSIFIER'S OWN READS (derived from its rule table, never a copy): a
    # request is `request-other`, `varip` is `varip`, every other read past the run's own bar
    # (the wall clock, the visible range, `barstate.isnew`, a lookahead flag) is `realtime-state`.
    try:
        from api.services import runtime_repaint
        repaint = runtime_repaint.runtime_repaint_of(source)
        req = runtime_repaint.RULES["requests"]
    except Exception:  # noqa: BLE001 - fail closed: an unreadable source is withheld
        repaint, req = None, None
    if not isinstance(repaint, dict) or not repaint.get("ok"):
        found.add(UNREADABLE)
    else:
        for r in repaint.get("reads") or ():
            name = r.get("name") if isinstance(r, dict) else None
            if not isinstance(name, str):
                found.add(UNREADABLE)
            elif name in req["calls"] or name.startswith(req["prefix"]):
                found.add("request-other")
            elif name == "varip":
                found.add("varip")
            else:
                found.add("realtime-state")
    return frozenset(found)


# ─── WS-I Part 2 re-verify (2026-11-13): the PERSISTED capability set and its version ──────────
#
# `runtime_definitions` stores each source's capability set once (keyed by its sha256, beside
# `DETECTOR_VERSION`) so serving a row never re-runs the detector. A stored set is valid only for
# the detector that computed it. ⛔ BUMP `DETECTOR_VERSION` WHENEVER WHAT THIS MODULE ANSWERS CAN
# CHANGE, and record the new `detector_fingerprint()` beside it: the rail
# (`tests/test_pine_capabilities.py`) goes red while the fingerprint and the version disagree, so a
# changed regex can never be served from sets an older detector computed.
DETECTOR_VERSION = 1
DETECTOR_FINGERPRINTS = {1: "797670b04011de780dc26555ee667c87098abb697632e422988b96b5681a5bbf"}


def detector_fingerprint():
    """sha256 over everything `capabilities_of` answers from: the FEATURES rows, the vocabulary,
    every compiled pattern, the built-in namespaces, the size cap, and the repaint classifier's
    rule table (`realtime-state` / `request-other` derive from it)."""
    import hashlib
    import json as _json
    from api.services import runtime_repaint
    patterns = sorted(v.pattern for k, v in globals().items()
                      if isinstance(v, re.Pattern))
    patterns += sorted("%s=%s" % (k, rx.pattern) for k, rx in _COLLECTION_RX.items())
    patterns += sorted("%s=%s" % (k, rx.pattern) for k, rx in _OBJ_FAMILY_RX.items())
    parts = {
        "features": [[fid, rx, fl] for fid, _l, rx, fl in FEATURES],
        "vocabulary": sorted(CAPABILITY_IDS),
        "patterns": patterns,
        "namespaces": sorted(BUILTIN_NAMESPACES),
        "cap": MAX_SOURCE_BYTES,
        "core": CORE_ID,
        "unreadable": UNREADABLE,
        "repaint": runtime_repaint.RULES,
    }
    blob = _json.dumps(parts, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()
