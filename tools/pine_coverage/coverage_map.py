# -*- coding: utf-8 -*-
"""coverage_map.py - the Pine coverage map: inventory x usage x member-door verdicts.

  python tools/pine_coverage/coverage_map.py --cache <cache> --ref <pine_v6_reference.json> \
      --verdicts <verdicts.json> [--engine-door <engine_door.json>] \
      --out docs/pine/coverage-map.json [--tables <scratch.md>]

Reads (nothing here asks the engine anything; it joins what the door answered):
  --ref        TradingView's own Pine v6 reference (tools/pine_survey/pine_reference_extract.js)
  <cache>/sample_manifest.json + census.jsonl   (fetch_sample.py, run_census.py)
  --verdicts   a fresh vendor-harness verdicts.json over tests/fixtures/vendor/harness
  --engine-door  doorCoverage's probe of the engine's own declared functions. Optional: left out,
                 engineTableThroughPineDoor is empty (not measured); named but missing, refused

Writes coverage-map.json: deterministic (sorted keys, no wall-clock stamp unless
--measured-on is passed), so a daily job can recompute and DIFF it.

⭐⭐ THE RUNTIME-ON LANE (Phase 3, WS-0), optional:
  --runtime-cache     a SECOND census cache, run with `run_census.py --runtime-on`
  --runtime-verdicts  a vendor-harness verdicts.json run with VENDOR_HARNESS_RUNTIME_ON=1
adds a `runtimeOn` section: the transfer count with the runtime pane on at every peel
step (same predicate as `runtimeClean`: a runtime-lane attach counts, an order-placing
strategy never does), what it adds and loses against production, the runtime lane's
own walls per script, and the parity verdicts with the pane on, capture by capture
against the production run.
⛔ Every input names its lane, and this refuses to mix them: --cache and --verdicts
must be PRODUCTION, the two runtime inputs RUNTIME-ON (a census row or verdicts file
written before WS-0 carries no lane and reads as production).

THE HEADLINE PREDICATE lives in the census (`isClean`): a script TRANSFERS FULLY when
the member door (memberPaneDefinition -> installUserDefinitions, production flag
state) attaches it with zero refusals, nothing dropped or withheld from its object
program, and no paint withheld. It is a door verdict, NOT a numeric-parity verdict:
parity is graded only where a vendor capture exists, reported separately.
"""
import argparse
import collections
import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── what each door guard is, as a CAPABILITY. Derived from pine.js REFUSALS sentences.
GUARD_BUCKET = {
    "pine:block": "imperative", "pine:reassign": "imperative", "pine:statement": "imperative",
    "pine:state": "imperative", "pine:cycle": "imperative", "pine:undefined": "imperative",
    "pine:function-def": "user-functions",
    "pine:type": "udt-methods", "pine:member": "udt-methods",
    "pine:collection": "collections",
    "pine:tuple": "tuples",
    "pine:module": "imports-libraries", "pine:declaration-library": "imports-libraries",
    "pine:declaration-strategy": "strategy", "pine:strategy-call": "strategy",
    "pine:request": "request-security",
    "pine:text-value": "text-colour-values", "pine:colour-value": "text-colour-values",
    "pine:history-ref": "history-offsets", "pine:offset-literal": "history-offsets",
    "pine:offset-negative": "history-offsets", "pine:plot-offset": "history-offsets",
    "pine:window": "history-offsets", "pine:window-dependent": "history-offsets",
    "pine:na": "na-semantics",
    "pine:live-bar-state": "realtime-bar-state",
    "pine:function": "builtin-missing", "pine:builtin": "builtin-missing",
    "pine:arity": "call-mapping", "pine:named-argument": "call-mapping", "pine:role-order": "call-mapping",
    "pine:input-kind": "call-mapping", "pine:operator": "call-mapping",
    "pine:drawing": "drawing-objects",
    # objects-only in the STRICT lane = an object-only script whose object program is not clean
    "pine:no-output": "output-contract", "pine:objects-only": "drawing-objects",
    "pine:presentation-only": "output-contract", "pine:constant-only": "output-contract",
    "pine:hidden-only": "output-contract",
    "pine:timeout": "translator-robustness", "pine:roundtrip": "translator-robustness",
    "pine:budget": "translator-robustness", "pine:character": "translator-robustness",
    "pine:empty": "translator-robustness", "threw": "translator-robustness", "killed": "translator-robustness",
}
BUCKET_LABEL = {
    "imperative": "Imperative execution: if/for/while blocks, := reassignment, var state carried across bars",
    "user-functions": "User-defined functions with multi-line bodies",
    "udt-methods": "User-defined types (type), fields and methods",
    "collections": "Arrays, matrices and maps as values",
    "tuples": "Tuple returns and [a, b] = destructuring",
    "imports-libraries": "import of published libraries / library() scripts",
    "strategy": "strategy() order simulation and strategy.* values",
    "request-security": "request.security / request.* across symbols and timeframes",
    "text-colour-values": "Text and colour as computed values",
    "history-offsets": "History references and offsets beyond literal whole numbers",
    "na-semantics": "na carry-forward (fixnan-like) semantics",
    "realtime-bar-state": "Forming-bar (realtime) state",
    "builtin-missing": "A built-in name the door does not know",
    "call-mapping": "A known name whose call shape / argument order is not mapped",
    "drawing-objects": "Drawing objects (line/label/box/table/polyline/linefill): an op the object program could not carry that no host guard explains, or a loss with nothing named",
    "drawing-never-attempted": "Drawing script whose object program attempted NO op (nothing was dropped; nothing was built)",
    "drawing-no-output-other": "Drawing script with an empty object program: ops attempted, none dropped and nothing else named",
    "paint-withheld": "A per-bar paint the door withheld (colour typing), with the object program clean",
    "output-contract": "Script offers nothing the pane carries (no plot, hidden-only, constant-only)",
    "translator-robustness": "Translator timeout / crash / round-trip failure",
}
ITEM_GUARDS = {"pine:function", "pine:builtin", "pine:arity", "pine:named-argument", "pine:role-order",
               "pine:input-kind", "pine:request", "pine:strategy-call", "pine:drawing", "pine:text-value",
               "pine:live-bar-state", "pine:collection", "pine:tuple", "pine:na", "pine:window-dependent"}
NAME_UNKNOWN = {"pine:function", "pine:builtin"}
# a refusal that says the CAPABILITY is not built (as opposed to this call's shape)
CAPABILITY_MISSING = NAME_UNKNOWN | {"pine:module", "pine:type", "pine:member", "pine:function-def",
                                     "pine:block", "pine:drawing", "pine:declaration-library"}
CALL_UNMAPPED = {"pine:arity", "pine:named-argument", "pine:role-order", "pine:input-kind"}

# ── items that cannot be matched exactly without data we do not hold.
# (prefix match on the item name; the value names the source that would close it)
DATA_LIMITED = [
    ("request.financial", "Company fundamentals time series as TradingView serves them (FactSet financial statements, per fiscal period, with TV's field ids)"),
    ("request.economic", "Economic indicator series by country/field (TradingView economic data; FRED/IMF/OECD equivalents differ in revision vintage)"),
    ("request.dividends", "Dividend history with ex-date / pay-date and gross/net amounts per symbol"),
    ("request.earnings", "Earnings history: actual / estimate / standardized EPS per fiscal period"),
    ("request.splits", "Split history (numerator/denominator by date) per symbol"),
    ("request.quandl", "Nasdaq Data Link (Quandl) datasets - deprecated in Pine, no public source"),
    ("request.seed", "TradingView's Pine Seeds GitHub-hosted custom datasets"),
    ("request.footprint", "Tick-by-tick trades with aggressor side (bid/ask classified volume) to build footprint rows"),
    ("footprint.", "Tick-by-tick trades with aggressor side (bid/ask classified volume)"),
    ("volume_row.", "Tick-by-tick trades with aggressor side (bid/ask classified volume)"),
    ("request.currency_rate", "FX cross rates on TradingView's daily conversion basis"),
    ("request.security_lower_tf", "Intraday (and for seconds timeframes, sub-minute) bars for the chart symbol and any requested symbol"),
    ("bid", "Live best bid quotes (only defined on the 1T tick timeframe)"),
    ("ask", "Live best ask quotes (only defined on the 1T tick timeframe)"),
    ("timeframe.isseconds", "Seconds-resolution bars"),
    ("timeframe.isticks", "Tick-resolution bars"),
    ("dividends.", "Dividend history (see request.dividends)"),
    ("earnings.", "Earnings history (see request.earnings)"),
    ("splits.", "Split history (see request.splits)"),
    ("syminfo.employees", "Company fundamentals (headcount)"),
    ("syminfo.shareholders", "Company fundamentals (shareholder count)"),
    ("syminfo.shares_outstanding", "Shares outstanding / float history"),
    ("syminfo.recommendations", "Analyst recommendation counts"),
    ("syminfo.target_price", "Analyst price targets"),
    ("syminfo.expiration_date", "Futures contract expiry metadata"),
    ("syminfo.current_contract", "Futures continuous-contract roll metadata"),
    ("syminfo.root", "Futures root symbol metadata"),
    ("syminfo.volumetype", "Per-symbol volume type metadata (base/quote/tick volume)"),
    ("syminfo.mincontract", "Per-symbol minimum contract metadata"),
    ("syminfo.minmove", "Exchange tick-size metadata"),
    ("syminfo.pricescale", "Exchange tick-size metadata"),
    ("syminfo.pointvalue", "Contract point value metadata (futures)"),
    ("syminfo.basecurrency", "Crypto/FX base currency metadata"),
    ("syminfo.country", "Issuer country metadata"),
    ("syminfo.isin", "ISIN identifiers"),
    ("syminfo.main_tickerid", "TradingView main ticker id mapping"),
    ("syminfo.sector", "Sector classification on TradingView's taxonomy"),
    ("syminfo.industry", "Industry classification on TradingView's taxonomy"),
    ("ticker.inherit", "TradingView ticker-id modifiers (session, adjustment, settlement) applied to another symbol's feed"),
]

LEGACY = {  # v1-v4 bare name -> v6 name (only applied when the script's version is < 5)
    "study": "indicator", "security": "request.security", "financial": "request.financial",
    "tostring": "str.tostring", "tonumber": "str.tonumber", "tickerid": "ticker.new",
    "heikinashi": "ticker.heikinashi", "renko": "ticker.renko", "linebreak": "ticker.linebreak",
    "kagi": "ticker.kagi", "pointfigure": "ticker.pointfigure", "iff": "iff", "rsi": "ta.rsi",
    "input": "input", "fixnan": "fixnan", "nz": "nz", "na": "na",
}
LEGACY_COLOURS = {"aqua", "black", "blue", "fuchsia", "gray", "green", "lime", "maroon", "navy", "olive",
                  "orange", "purple", "red", "silver", "teal", "white", "yellow"}

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
# inside it). Each alternative is deterministic (`[ \t]+\S` cannot split two
# ways), so the scan is linear per header, never exponential.
# ⛔ v1-v4 spell the same calls bare (`sma(`, `rsi(`), so the bare names Pine had
# before namespaces are matched too; a v5+ user function that reuses one of
# those names is over-reported, which is the safe direction for a grading gate.
_COND_TA_BARE = ("sma|ema|rma|wma|vwma|swma|hma|alma|linreg|rsi|atr|tr|stdev|dev|variance|"
                 "highest|lowest|highestbars|lowestbars|change|mom|roc|cum|sum|crossover|crossunder|"
                 "cross|valuewhen|barssince|pivothigh|pivotlow|rising|falling|correlation|percentrank|"
                 "percentile_linear_interpolation|percentile_nearest_rank|median|mode|range|stoch|cci|"
                 "mfi|cmo|tsi|bb|bbw|kc|kcw|macd|dmi|sar|supertrend|vwap|wpr|cog")
_COND_TA_CALL = r"(?<![\w.])(?:ta\.\w+|(?:%s))\s*\(" % _COND_TA_BARE
_COND_TA_HEADER = (r"(?:(?:[\w\[\], ]+=\s*)?(?:if|for|while|switch)\b|else\b"
                   r"|(?:export\s+)?(?:method\s+)?\w+\s*\([^()\n]*\)\s*=>[ \t]*$)")
COND_TA_RX = (r"^(?P<ci>[ \t]*)%s[^\n]*\n(?:[ \t]*\n|(?P=ci)[ \t]+\S[^\n]*\n)*?(?P=ci)[ \t]+(?=\S)[^\n]*?%s"
              r"|^[ \t]*(?:export\s+)?(?:method\s+)?\w+\s*\([^()\n]*\)\s*=>[^\n]*?%s"
              % (_COND_TA_HEADER, _COND_TA_CALL, _COND_TA_CALL))

FEATURES = [  # (id, label, regex over comment/string-stripped code, flags)
    ("var", "var declarations (state that persists across bars)", r"^\s*var\s+", re.M),
    ("varip", "varip (intrabar-persistent state, realtime only)", r"\bvarip\b", 0),
    ("if-block", "if statements / blocks", r"^\s*(?:[\w\[\], ]+=\s*)?if\b", re.M),
    ("for", "for loops", r"^\s*(?:[\w\[\], ]+=\s*)?for\s+\w+\s*=", re.M),
    ("for-in", "for...in loops", r"^\s*(?:[\w\[\], ]+=\s*)?for\s+(?:\[[^\]]*\]|\w+)\s+in\b", re.M),
    ("while", "while loops", r"^\s*(?:[\w\[\], ]+=\s*)?while\b", re.M),
    ("switch", "switch", r"\bswitch\b", 0),
    ("reassign", ":= reassignment", r":=", 0),
    ("compound-assign", "+= -= *= /= %=", r"[+\-*/%]=(?!=)", 0),
    ("tuple-destructure", "[a, b] = tuple destructuring", r"^\s*\[[\w\s,]+\]\s*=", re.M),
    ("fn-single", "user function, single-line body", r"^\s*(?:export\s+)?\w+\s*\([^()]*\)\s*=>\s*\S", re.M),
    ("fn-multi", "user function, multi-line body", r"^\s*(?:export\s+)?\w+\s*\([^()]*\)\s*=>\s*$", re.M),
    ("udt", "type (user-defined types)", r"^\s*(?:export\s+)?type\s+\w+", re.M),
    ("method-def", "method definitions", r"^\s*(?:export\s+)?method\s+\w+", re.M),
    ("enum", "enum", r"^\s*(?:export\s+)?enum\s+\w+", re.M),
    ("import", "import of a library", r"^\s*import\s+\S+", re.M),
    ("library-decl", "library() declaration", r"^\s*library\s*\(", re.M),
    ("strategy-decl", "strategy() declaration", r"^\s*strategy\s*\(", re.M),
    ("generics", "array<T> / matrix<T> / map<K,V> generics", r"\b(?:array|matrix|map)\s*<", 0),
    ("typed-array", "float[] style array types", r"\b(?:float|int|bool|string|color|line|label|box)\s*\[\s*\]", 0),
    ("history-expr", "history reference on an expression  (expr)[n]", r"\)\s*\[", 0),
    # decided in usage_of(): `x.f(` where x is NOT a built-in namespace (this regex never matches)
    ("method-call", "method-call syntax  x.f(...) on a value", r"(?!)", 0),
    ("max_bars_back", "max_bars_back", r"\bmax_bars_back\b", 0),
    ("ternary", "?: ternary", r"\?[^?:\n]+:", 0),
    ("conditional-ta", "ta.* called inside an if / loop / switch arm or a function body (per-call-site history)",
     COND_TA_RX, re.M),
]


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


class Inventory:
    def __init__(self, ref):
        self.items = {}   # name -> {kind, namespace}
        for coll, kind in (("functions", "function"), ("variables", "variable"), ("constants", "constant"),
                           ("types", "type"), ("keywords", "keyword"), ("annotations", "annotation"),
                           ("operators", "operator")):
            for e in ref.get(coll, []):
                nm = e["name"]
                if nm in self.items:
                    # a name that is BOTH a function and a variable (time, volume...) keeps both kinds
                    if kind not in self.items[nm]["kinds"]:
                        self.items[nm]["kinds"].append(kind)
                    self.items[nm]["overloads"] += 1 if kind == "function" else 0
                    continue
                ns = nm.split(".")[0] if "." in nm and kind in ("function", "variable", "constant") else (
                    "(language)" if kind in ("keyword", "operator", "annotation", "type") else "(global)")
                self.items[nm] = {"kinds": [kind], "namespace": ns, "overloads": 1 if kind == "function" else 0}
        self.methods = collections.defaultdict(set)  # method name -> {namespace}
        for e in ref.get("methods", []):
            orig = e.get("originalName") or ""
            if "." in orig:
                self.methods[e["name"]].add(orig.split(".")[0])
                self.items.setdefault(orig, {"kinds": ["function"], "namespace": orig.split(".")[0], "overloads": 1})
        self.namespaces = {v["namespace"] for v in self.items.values()}
        self.fn_names = {k for k, v in self.items.items() if "function" in v["kinds"]}

    def normalise(self, name, version):
        """A name as written -> the inventory item it denotes, or None."""
        if not name:
            return None
        if name in self.items:
            return name
        if version < 5 and "." not in name:
            if name in LEGACY and LEGACY[name] in self.items:
                return LEGACY[name]
            for ns in ("ta", "math", "str", "request", "ticker"):
                if ns + "." + name in self.items:
                    return ns + "." + name
            if version < 4 and name in LEGACY_COLOURS:
                return "color." + name
        return None


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
    feats = {fid for fid, _l, rx, fl in FEATURES if re.search(rx, code, fl)}
    for m in re.finditer(r"(?:(?<![\w.])([A-Za-z_]\w*)|[\)\]])\s*\.\s*[a-z_]\w*\s*\(", code):
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


def data_limited(name):
    for pre, why in DATA_LIMITED:
        if name == pre or (pre.endswith(".") and name.startswith(pre)) or (name.startswith(pre) and not pre.endswith(".") and name[len(pre):len(pre) + 1] in ("", "_", ".")):
            return why
    return None


KEYWORD_FEATURE = {"type": "udt", "in": "for-in", "as": "import", "import": "import", "method": "method-def",
                   "enum": "enum", "while": "while", "for": "for", "switch": "switch", "varip": "varip"}
# ⭐ W9 T0 - ONE authority for "which calls place or manage orders": the engine's own
# STRATEGY_ORDER_CALLS (pine.js), read from the source, never restated here (the old copy named 5 of the
# engine's 13). Detection is from the SCRIPT'S TEXT, never from the reference inventory: a reference
# extract that lacks a name (the 11-03 map's lacks strategy.entry / exit / order / position_size) makes
# an inventory lookup say "no orders" and a strategy placing orders counted as transferring.
PINE_JS = os.path.join(ROOT, "app", "src", "components", "chart", "engine", "ast", "pine.js")


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


STRATEGY_ORDERS = engine_order_calls()


def order_calls_in(code, orders=None):
    """The order-set names a script CALLS, read from its comment- and string-stripped code
    (`strategy.entry(`, with whitespace around the dots allowed). Version-independent."""
    names = sorted(orders if orders is not None else STRATEGY_ORDERS, key=len, reverse=True)
    rx = r"(?<![\w.])(" + "|".join(r"\s*\.\s*".join(re.escape(p) for p in n.split(".")) for n in names) + r")\s*\("
    return {re.sub(r"\s+", "", m.group(1)) for m in re.finditer(rx, code)}


def places_orders(u):
    """Whether a usage_of() result is a strategy that places or manages orders."""
    return declaration_of(u) == "strategy" and bool(u["orders"])


def strategy_on_block(scripts):
    """⭐ W9 T0 - what the census knows about strategies, read from each script's text.
    `orderSet` is the engine's own set; `byCall` counts the scripts calling each name; `doorCleanPlacingOrders`
    counts the strategies whose plots the door draws and that still never transfer (their orders are not simulated)."""
    strat = [s for s in scripts if s["declaration"] == "strategy"]
    placing = [s for s in strat if s["placesOrders"]]
    by_call = collections.Counter(n for s in placing for n in s["_orders"])
    return {
        "orderSet": sorted(STRATEGY_ORDERS), "orderSetSource": "app/src/components/chart/engine/ast/pine.js STRATEGY_ORDER_CALLS",
        "strategies": len(strat), "placingOrders": len(placing), "notPlacingOrders": len(strat) - len(placing),
        "byCall": dict(sorted(by_call.items())),
        "doorCleanPlacingOrders": sum(1 for s in placing if s["doorClean"]),
        "transferringPlacingOrders": sum(1 for s in placing if s["clean"]),
        "wave": "W9",
    }


UNGRADED_PREFIXES = ("strategy", "alert", "alertcondition", "log.", "runtime.")

DRAWING_CTORS = {"line.new", "label.new", "box.new", "table.new", "polyline.new", "linefill.new"}


def declaration_of(u):
    return "strategy" if "strategy-decl" in u["features"] else "library" if "library-decl" in u["features"] else "indicator"


def transfers_fully(census_row, u):
    """⭐ THE HEADLINE PREDICATE, in one place: the census's door verdict (`isClean`)
    AND not a strategy that places orders. Read by main() below and by
    tools/support_loop/remeasure.py, so the daily number and the map cannot disagree."""
    return bool((census_row or {}).get("clean")) and not (
        places_orders(u))


# ⭐ W3W4-T0 - THE OBJECT PROGRAM'S OWN VERDICT, READ ON REFUSED STEPS TOO.
# A door `pine:no-output` / `pine:objects-only` says "ZERO SURVIVING ops" (PJ `refusal: hardRefusals[0] || r`,
# `draws = program.ops.length > 0`). That is three different facts, told apart by the step's own counters:
#   dropped          attemptedOps > 0 and droppedOps > 0: an op was ATTEMPTED and DROPPED (named op + host guard);
#   never attempted  attemptedOps == 0: the object pass never tried an op for a drawing constructor;
#   no-output other  attemptedOps > 0, droppedOps == 0: the program is empty for a reason no counter names.
# (W3W4-NEXT review B1: "39 dropped every op" was never established; the screener-lane why file split the 39
# into 27 all-dropped, 10 partial and 2 zero-attempted.)
OBJECT_PROGRAM_GUARDS = frozenset({"pine:no-output", "pine:objects-only"})
BUCKET_NEVER_ATTEMPTED = "drawing-never-attempted"
BUCKET_NO_OUTPUT_OTHER = "drawing-no-output-other"
BUCKET_PAINT_WITHHELD = "paint-withheld"
# a drop key naming a host guard: `guard:create <- pine:state`
DROP_VIA = " <- "
_HEAD_RX = re.compile(r"^([\w:.\-]+)@([\d?]+): (\S+)(?: (.*))?$")


def parse_drop_heads(heads):
    """[{op, line, guard, token}] from the census's `dropHeads` strings (`<op>@<line>: <guard>[ <subject>]`).
    An unparseable string is kept as op None so a format drift shows up as an unresolved drop, not silence."""
    out = []
    for h in heads or []:
        m = _HEAD_RX.match(str(h).strip())
        if not m:
            out.append({"op": None, "line": None, "guard": None, "token": None})
            continue
        g = m.group(3)
        out.append({"op": m.group(1), "line": None if m.group(2) == "?" else int(m.group(2)),
                    "guard": "unrecorded" if g in ("unrecorded", "no", "refused") else g,
                    "token": (m.group(4) or "").strip("` ") or None})
    return out


def _drop_key_ops(key):
    """The dropHeads `op` names a `dropReasons` key can be explained by: `guard:create` <- op `create`,
    `create:line` <- op `create:line`, `cell:text` <- op `cell:text`. None for a key no guard explains
    (`coll:*`, `loop:*`, `fn:*`, `update:props`, geometry)."""
    kind, _, rest = key.partition(":")
    if kind == "guard" and rest:
        return {rest}
    if key == "cell:text" or kind == "create":
        return {key}
    return None


def drop_walls(st):
    """[(key, guard)] the dropped ops of one door step name: ("drop", "<reason>") unchanged for a reason no
    host guard explains, ("drop", "<reason> <- <guard>") once per distinct host guard that explains it."""
    heads = parse_drop_heads(st.get("dropHeads"))
    out = []
    for k in sorted((st.get("dropReasons") or {}).keys()):
        base = k.split(":")[0] + ":" + (k.split(":")[1] if ":" in k else "")
        ops = _drop_key_ops(base)
        guards = sorted({h["guard"] for h in heads if ops and h["op"] in ops and h["guard"]})
        if guards:
            for g in guards:
                out.append((("drop", base + DROP_VIA + g), g))
        else:
            out.append((("drop", base), None))
    return out


def drop_guard_of(drop_value):
    """The host guard a resolved drop label names, or None (`guard:create <- pine:state` -> `pine:state`)."""
    if DROP_VIA not in drop_value:
        return None
    g = drop_value.split(DROP_VIA, 1)[1]
    return None if g == "unrecorded" else g


def object_program_walls(st, inv):
    """(keys, named) for one door step's object program: the items the translation says it could not draw
    (`unsupported`, `loopBlockedCalls`, `outOfScope`) and the dropped ops (`drop_walls`)."""
    keys, named = set(), False
    for nm in (st.get("unsupported") or []) + (st.get("loopBlockedCalls") or []):
        it = inv.normalise(nm, 6)
        if it:
            keys.add(("item", it))
            named = True
    for ns in st.get("outOfScope") or []:
        keys.add(("item", ns + ".*"))
        named = True
    for k, _ in drop_walls(st):
        keys.add(k)
        named = True
    return keys, named


def object_program_split(st):
    """Which of the three the step's empty object program is: "dropped", "never-attempted", "no-output-other",
    or None when the row carries no counters (a census older than the counters)."""
    if st.get("attemptedOps") is None and st.get("droppedOps") is None:
        return None
    if (st.get("droppedOps") or 0) > 0 or st.get("dropReasons"):
        return "dropped"
    return "never-attempted" if not (st.get("attemptedOps") or 0) else "no-output-other"


def object_program_row(st):
    """The census step's object-program counters for the map: attempted / dropped ops and the three-way split."""
    return {"attemptedOps": st.get("attemptedOps"), "droppedOps": st.get("droppedOps"), "split": object_program_split(st)}


def refused_program_walls(st, inv, items):
    """The walls of a refused step 0 whose guard is only `pine:no-output` / `pine:objects-only`: the dropped ops
    (named op and host guard), else the never-attempted / no-output-other split, else nothing (the caller then
    keeps the old bucket: a census row without counters, or no drawing constructor)."""
    split = object_program_split(st)
    if split is None:
        return set()
    keys, named = object_program_walls(st, inv)
    if named:
        return keys
    if not (items & DRAWING_CTORS) and not st.get("attemptedOps"):
        return set()
    return {("bucket", BUCKET_NEVER_ATTEMPTED if split == "never-attempted" else BUCKET_NO_OUTPUT_OTHER)}


def walls_of(row, inv, version, items=frozenset(), decl="indicator"):
    """The capability keys one census row names as walls (all peel steps)."""
    keys = set()
    detail = []
    steps = row.get("steps") or []
    step0_guards = {r.get("guard") for r in ((steps[0] if steps else {}).get("refusals") or [])}
    for si, st in enumerate(steps):
        if st.get("threw"):
            keys.add(("bucket", "translator-robustness"))
            detail.append(("threw", None))
            continue
        # ⭐ W3W4-T0 - A REFUSED STEP 0 WHOSE ONLY WALL IS "NO SURVIVING OP" SPEAKS FOR ITS OBJECT PROGRAM.
        # Only when no other guard is named beside it (those are the walls); only for a script that calls a
        # drawing constructor (a `pine:no-output` with none is a genuine output-contract gap).
        own_program = set()
        if (si == 0 and not st.get("attached") and step0_guards & OBJECT_PROGRAM_GUARDS
                and not any(GUARD_BUCKET.get(g) != "output-contract" and g not in OBJECT_PROGRAM_GUARDS
                            for g in step0_guards if g)):
            own_program = refused_program_walls(st, inv, items)
            keys |= own_program
        for r in st.get("refusals") or []:
            g = r.get("guard") or "unnamed"
            if own_program and g in OBJECT_PROGRAM_GUARDS:
                detail.append((g, None))
                continue
            # ⛔ PEEL ARTIFACTS ARE NOT WALLS. After step 0 the program has been edited:
            # an output-contract refusal there is the peel having removed the plots, a
            # round-trip / statement refusal on a `x = 0.0` line is the peel's own
            # substitution. Only step 0 speaks for those.
            if si > 0 and GUARD_BUCKET.get(g) in ("output-contract", "translator-robustness"):
                continue
            if si > 0 and re.match(r"^\w+ = 0\.0$", (r.get("text") or "").strip()):
                continue
            # an output-contract refusal BESIDE other refusals is their consequence
            # (every plot refused -> nothing left to carry), not a wall of its own
            if GUARD_BUCKET.get(g) == "output-contract" and len(step0_guards - {k for k, v in GUARD_BUCKET.items() if v == "output-contract"}) > 0:
                continue
            tok = inv.normalise((r.get("token") or "").strip(), version) if r.get("token") else None
            if g in ITEM_GUARDS and tok and tok not in ("=", "na") and "function" in inv.items.get(tok, {}).get("kinds", []) + inv.items.get(tok, {}).get("kinds", []):
                keys.add(("item", tok))
            elif g in ITEM_GUARDS and tok and g in NAME_UNKNOWN | CALL_UNMAPPED | {"pine:request", "pine:strategy-call", "pine:live-bar-state"}:
                keys.add(("item", tok))
            elif g in NAME_UNKNOWN and r.get("token") and not tok:
                # a name the door does not know that is not a Pine built-in: a user function
                # (its definition was refused earlier) or a legacy spelling
                keys.add(("bucket", "user-functions"))
            else:
                keys.add(("bucket", GUARD_BUCKET.get(g, "translator-robustness")))
            detail.append((g, tok))
        if st.get("attached"):
            if st.get("installed") is False:
                keys.add(("bucket", "translator-robustness"))
            lv = st.get("lossVerdict")
            if lv and lv != "clean" or st.get("withheldObjects") or (st.get("withheldPaints") or 0) > 0:
                ks, named = object_program_walls(st, inv)
                keys |= ks
                if not named:
                    # ⭐ W3W4-T0 - a withheld PAINT is not a drawing: with the object program clean, it is its own wall
                    paint_only = ((st.get("withheldPaints") or 0) > 0 and not st.get("withheldObjects")
                                  and lv in (None, "clean"))
                    keys.add(("bucket", BUCKET_PAINT_WITHHELD if paint_only else "drawing-objects"))
    if row.get("stuck") == "killed":
        keys.add(("bucket", "translator-robustness"))
    # ⭐ "NOTHING THE PANE CARRIES" NAMES THE REAL WALL WHEN WE CAN: a strategy with no
    # plot is a strategy-tester script; an indicator whose only output is drawing
    # objects lost its object program. What is left is a genuine output-contract gap.
    if ("bucket", "output-contract") in keys:
        if decl == "strategy":
            keys.discard(("bucket", "output-contract"))
            keys.add(("bucket", "strategy"))
        elif items & DRAWING_CTORS:
            keys.discard(("bucket", "output-contract"))
            keys.add(("bucket", "drawing-objects"))
    return keys, detail


LANE_PRODUCTION = "production"
LANE_RUNTIME_ON = "runtime-on"


def read_census(cache, lane, what):
    """census.jsonl as {key: row}, refusing rows of another lane."""
    census = {}
    lanes = collections.Counter()
    for l in open(os.path.join(cache, "census.jsonl"), encoding="utf-8"):
        if l.strip():
            d = json.loads(l)
            census[d["key"]] = d
            lanes[d.get("lane") or LANE_PRODUCTION] += 1
    if set(lanes) - {lane}:
        sys.exit("%s: census rows of lane %s, expected only %s" % (what, dict(lanes), lane))
    return census


def read_verdicts(path, lane, what):
    vd = json.load(open(path, encoding="utf-8"))
    got = vd.get("lane") or LANE_PRODUCTION
    if got != lane:
        sys.exit("%s: verdicts of lane %s, expected %s (%s)" % (what, got, lane, path))
    return vd


def read_engine_door(path):
    """--engine-door: left out -> [] (not measured; engineTableThroughPineDoor is empty).
    Named but missing -> REFUSED. It used to read as [] too, so a re-run that named the
    probe's output without running the probe wrote "measured, and empty" with no error
    (W0 review, 2026-11-02). main() asks this first, before any input is read."""
    if not path:
        return []
    if not os.path.exists(path):
        sys.exit("--engine-door %s does not exist: run the engine-door probe first (COVERAGE_DOOR_OUT=<file>, "
                 "coverageMapDoorCensus.measure.test.js), or leave --engine-door out "
                 "(engineTableThroughPineDoor is then empty: not measured)" % path)
    return json.load(open(path, encoding="utf-8"))


def norm_src(text):
    """The key a vendor capture is joined to a sample script by: its source, whitespace-insensitive.
    One rule for every such join (main() below, and tools/pine_coverage/w0/targets.py, which joins
    the runtime-on parity changes to scripts with it)."""
    return hashlib.sha1(re.sub(r"\s+", "", text).encode("utf-8")).hexdigest()


def script_verdict(verdicts):
    """One script's vendor verdict over its captures' verdicts: MATCH if any capture MATCHes,
    else DIVERGE if any DIVERGEs, else INCONCLUSIVE; None for a script without a capture."""
    v = set(verdicts)
    return None if not v else ("MATCH" if "MATCH" in v else "DIVERGE" if "DIVERGE" in v else "INCONCLUSIVE")


# ⭐ W4 T0 — the wall's DETAIL, for the one decision a label cannot carry: which wave owns it.
# `runtime:loop` is `for … in` (W6) wherever the lane says so, and a bare `security(…)` (the
# v1-v4 spelling) reaches `runtime:call-undeclared-builtin-state` as a token (W7). `targets.py`
# reads these tags; no wall LABEL is changed by them.
TAG_FOR_IN = "for-in"
TAG_BARE_SECURITY = "bare-security"
# ⭐ W6 T1 - the W6 guards whose label names a collection or a type that is not what is behind them
# (W6-BREAKDOWN section 0, finding 3). Each tag is read off the step's own detail AND the script's
# unpeeled source; `targets.py::rt_wave` re-waves the wall by it. No wall LABEL changes.
#   ltf-array  `pine:collection` "`x` is read as an array here and nothing in this script creates it",
#              where `x` is bound by `request.security_lower_tf(…)` in the unpeeled source: the peel
#              removed that line, so the array is the lower-timeframe request's result (W7).
#   tuple      `pine:collection` whose step text is a bare bracket list `[a, …]`. Pine has no array
#              literal, so that statement is a tuple value (a function's or an `if` arm's), not a
#              collection (W4, beside `runtime:block-value`).
#   library    `pine:type` / `pine:member` whose head is an `import` alias, or a name declared with a
#              library's type or from a library's call (`chr.DateTimeWindow x = …`, `x = chr.f(…)`) (W8).
#   footprint  `pine:type` / `pine:member` whose head is declared a `footprint` / `volume_row` (the types
#              `request.footprint` returns) or bound by `request.footprint(…)` (W7).
TAG_LTF_ARRAY = "ltf-array"
TAG_TUPLE = "tuple"
TAG_LIBRARY = "library"
TAG_FOOTPRINT = "footprint"

_NOTHING_CREATES = re.compile(r"`([A-Za-z_]\w*)` is read as an array here and nothing in this script creates it")
_LTF_BIND = re.compile(r"(\[[^\[\]]*\]|\b[A-Za-z_]\w*)\s*:?=\s*request\s*\.\s*security_lower_tf\s*\(")
_TUPLE_TEXT = re.compile(r"^\[[^\[\]]*\]$")
_IMPORT = re.compile(r"^[ \t]*import\s+[\w.-]+/(\w+)/\d+(?:[ \t]+as[ \t]+(\w+))?", re.M)


class SourceFacts:
    """What the W6 T1 tags read off a script's unpeeled source (comments and string contents removed)."""

    def __init__(self, src):
        self.code = strip_code(src or "")[0]
        self.aliases = {m.group(2) or m.group(1) for m in _IMPORT.finditer(self.code)}
        self.ltf = set()
        for m in _LTF_BIND.finditer(self.code):
            t = m.group(1)
            self.ltf.update(re.findall(r"[A-Za-z_]\w*", t) if t.startswith("[") else [t])

    def _decls(self, name):
        # `[var] [Type | ns.Type[<…>][[]]] name = rhs` (or `:=`): (declared type, rhs) per binding of `name`
        rx = (r"^[ \t]*(?:(?:var|varip)\s+)?(?:([A-Za-z_][\w.]*)(?:<[^>\n]*>)?(?:\[\])?[ \t]+)?%s[ \t]*:?=(?!=)[ \t]*([^\n]*)"
              % re.escape(name))
        return [(m.group(1) or "", m.group(2)) for m in re.finditer(rx, self.code, re.M)]

    def library_head(self, head):
        if head in self.aliases:
            return True
        for ty, rhs in self._decls(head):
            if "." in ty and ty.split(".")[0] in self.aliases:
                return True
            m = re.match(r"([A-Za-z_]\w*)\s*\.", rhs)
            if m and m.group(1) in self.aliases:
                return True
        return False

    def footprint_head(self, head):
        return any(ty in ("footprint", "volume_row") or re.match(r"request\s*\.\s*footprint\s*\(", rhs)
                   for ty, rhs in self._decls(head))


def _member_head(guard, probe):
    """The name a `pine:type` / `pine:member` step's dotted read starts from: `pine:type`'s token is the
    dotted name itself; `pine:member`'s token is the member, read back along the step text's chain."""
    tok = probe.get("token") or ""
    if not tok:
        return None
    if guard == "pine:type":
        return tok.split(".")[0]
    m = re.search(r"([A-Za-z_]\w*)(?:\s*\.\s*\w+|\s*\((?:[^()]|\([^()]*\))*\))*\s*\.\s*%s\b" % re.escape(tok),
                  probe.get("text") or "")
    return m.group(1) if m else None


def _wall_tags(guard, probe, declined, facts=None):
    tags = []
    detail = (probe.get("message") or "") + (declined.get("why") or "")
    if guard == "runtime:loop" and "for … in" in detail:
        tags.append(TAG_FOR_IN)
    if guard == "runtime:call-undeclared-builtin-state" and probe.get("token") == "security":
        tags.append(TAG_BARE_SECURITY)
    if guard == "pine:collection":
        m = _NOTHING_CREATES.search(detail)
        if m and facts is not None and m.group(1) in facts.ltf:
            tags.append(TAG_LTF_ARRAY)
        if _TUPLE_TEXT.match((probe.get("text") or "").strip()):
            tags.append(TAG_TUPLE)
    if guard in ("pine:type", "pine:member") and facts is not None:
        head = _member_head(guard, probe)
        if head and facts.library_head(head):
            tags.append(TAG_LIBRARY)
        elif head and facts.footprint_head(head):
            tags.append(TAG_FOOTPRINT)
    return tags


def runtime_wall_steps(row, src=None):
    """[(wall, tags)] over every peel step of a runtime-on census row: the runtime lane's own
    walls, its probe's guard where it declined with a position and the probe AGREES with the door,
    else the decline's code, else the host's guards (a refusal the runtime lane was never offered).

    ⭐ W4 T0 - THE DECLINE'S CODE WINS WHEN THE PROBE DISAGREES. The probe is a second build run
    beside the door (`coverageMapDoorCensus.measure.test.js::runtimeProbeOf`); the door's
    `runtimeDeclined.code` is what actually declined the script. Taking the probe's guard first
    called 79 steps `runtime:object-op` in the 2026-11-02 map, of which 2 agreed with the door
    (W4-BREAKDOWN section 0, finding 2). A row from before `agrees` existed carries none: the probe
    is then trusted, as it always was.

    `src` is the script's unpeeled source; without it the W6 T1 tags that read the source are not set."""
    out = []
    facts = SourceFacts(src) if src is not None else None
    for si, st in enumerate(row.get("steps") or []):
        if st.get("attached"):
            break
        if st.get("threw"):
            out.append(("threw", []))
            continue
        pr = st.get("rtProbe") or {}
        rd = st.get("runtimeDeclined") or {}
        # ⛔ peel artifacts: a refusal on the peel's own `x = 0.0`, or a name the peel
        # blanked (most often a tuple binding)
        if si > 0 and re.match(r"^[A-Za-z_]\w*\s*=\s*0\.0$", (pr.get("text") or "").strip()):
            continue
        g = (pr.get("guard") if pr.get("agrees") is not False else None) or rd.get("code") or pr.get("guard")
        if not g:
            gs = sorted({r.get("guard") for r in st.get("refusals") or []} - {None}) or [st.get("guard") or "unnamed"]
            g = "host:" + ",".join(gs)
        if si > 0 and g == "pine:undefined":
            continue
        out.append((g, _wall_tags(g, pr, rd, facts)))
    return out


def runtime_walls_of(row):
    """The runtime lane's walls over every peel step of a runtime-on census row (see
    `runtime_wall_steps`)."""
    return [g for g, _ in runtime_wall_steps(row)]


def runtime_on_section(rt_cache, rt_verdicts, prod_verdicts, scripts, decl_of, orders_of, norm_src, inputs, N, inv=None):
    """⭐ The runtime-on lane, measured: see the module docstring."""
    rows = read_census(rt_cache, LANE_RUNTIME_ON, "--runtime-cache")
    missing = [s["key"] for s in scripts if s["key"] not in rows]
    if missing:
        sys.exit("--runtime-cache has no row for %d sample scripts (first %s) - re-run run_census.py --runtime-on"
                 % (len(missing), missing[0]))

    def transfers(key):
        r = rows[key]
        st0 = (r.get("steps") or [{}])[0]
        return not orders_of(key) and (bool(r.get("clean")) or (bool(r.get("attached")) and st0.get("lane") == "runtime"))

    by_key = {s["key"]: s for s in scripts}
    on = {s["key"] for s in scripts if transfers(s["key"])}
    prod = {s["key"] for s in scripts if s["clean"]}
    walls, wall_tags = {}, {}
    dirty_walls = {}   # W3W4-T0: no runtime wall, attached and dirty: the HOST object program's walls, named
    touches, first, stuck = collections.Counter(), collections.Counter(), collections.Counter()
    enumerated = 0
    for s in scripts:
        k = s["key"]
        if k in on:
            continue
        r = rows[k]
        steps = runtime_wall_steps(r, open(inputs[k]["path"], encoding="utf-8").read())
        ws = [g for g, _ in steps]
        walls[k] = ws
        if not ws and inv is not None:
            dirty_walls[k] = sorted(key_label(x) for x in walls_of(r, inv, s["version"], frozenset(s["_items"]))[0])
        found = {}
        for g, tg in steps:
            if tg:
                found.setdefault(g, set()).update(tg)
        if found:
            wall_tags[k] = {g: sorted(v) for g, v in sorted(found.items())}
        for w in set(ws):
            touches[w] += 1
        first[ws[0] if ws else "attached-dirty"] += 1
        stuck[r.get("stuck") or ("reached" if r.get("reachedAfterPeel") else "cap")] += 1
        if r.get("reachedAfterPeel"):
            enumerated += 1
    by_pop = {}
    for pop in ("committed", "reference", "builtin"):
        ks = [s["key"] for s in scripts if s["population"] == pop]
        by_pop[pop] = {"scripts": len(ks), "transfer": sum(1 for k in ks if k in on)}
    attached_rt = sorted(s["key"] for s in scripts if (rows[s["key"]].get("steps") or [{}])[0].get("lane") == "runtime"
                         and rows[s["key"]].get("attached"))
    out = {
        "lane": LANE_RUNTIME_ON,
        "definition": ("The member door with the runtime pane ON at every peel step, as a permitted member with "
                       "every script graded (the server's starter allowlist is NOT applied: an upper bound). A script "
                       "transfers when it transfers fully on the host lane or attaches on the runtime lane, and is "
                       "not a strategy that places orders. Door acceptance, not numeric parity."),
        "sample": N, "transfer": len(on), "transferPct": round(100.0 * len(on) / N, 1) if N else None,
        "productionTransfer": len(prod),
        "added": sorted(on - prod), "lost": sorted(prod - on),
        "byPopulation": by_pop,
        "runtimeAttached": len(attached_rt),
        "runtimeAttachedOrderStrategies": sorted(k for k in attached_rt if orders_of(k)),
        "walls": {
            "notTransferring": len(walls), "fullyEnumerated": enumerated,
            "touches": dict(sorted(touches.items(), key=lambda kv: (-kv[1], kv[0]))),
            "first": dict(sorted(first.items(), key=lambda kv: (-kv[1], kv[0]))),
            "stuck": dict(sorted(stuck.items(), key=lambda kv: (-kv[1], kv[0]))),
            "byScript": {k: walls[k] for k in sorted(walls)},
            # W4 T0 / W6 T1: the detail behind the walls whose WAVE depends on it (the TAG_* above)
            "tags": {k: wall_tags[k] for k in sorted(wall_tags)},
            "attachedDirtyWalls": {k: dirty_walls[k] for k in sorted(dirty_walls)},
        },
        "parity": None,
    }
    if rt_verdicts:
        rv = read_verdicts(rt_verdicts, LANE_RUNTIME_ON, "--runtime-verdicts")
        pv = {r["file"]: r.get("verdict") for r in (prod_verdicts or {}).get("results", [])}
        changed = collections.Counter()
        changes = []
        for r in rv.get("results", []):
            before = pv.get(r["file"])
            if before is not None and before != r.get("verdict"):
                changed["%s->%s" % (before, r.get("verdict"))] += 1
                changes.append({"file": r["file"], "from": before, "to": r.get("verdict")})
        out["parity"] = {
            "captures": len(rv.get("results", [])),
            "verdicts": dict(sorted(collections.Counter(r.get("verdict") for r in rv.get("results", [])).items())),
            "productionVerdicts": dict(sorted(collections.Counter(pv.values()).items())),
            "changed": dict(sorted(changed.items())), "changes": sorted(changes, key=lambda c: c["file"]),
            "runtimeDeclines": (rv.get("laneEvidence") or {}).get("declines"),
            "laneEvidence": {k: v for k, v in (rv.get("laneEvidence") or {}).items() if k != "declines"},
        }
    return out


def key_label(k):
    kind, v = k
    if kind == "item":
        return v
    if kind == "drop":
        return "object op dropped: " + v
    return "[" + v + "]"


def key_bucket(k, inv):
    kind, v = k
    if kind == "bucket":
        return v
    if kind == "drop":
        # ⭐ W3W4-T0 - a drop a host guard explains belongs to THAT guard's capability
        g = drop_guard_of(v)
        return GUARD_BUCKET.get(g, "drawing-objects") if g else "drawing-objects"
    ns = v.split(".")[0] if "." in v else "(global)"
    if v.startswith("request."):
        return "request-security"
    if v.startswith("strategy"):
        return "strategy"
    if ns in ("array", "matrix", "map"):
        return "collections"
    if ns in ("line", "label", "box", "table", "polyline", "linefill", "chart"):
        return "drawing-objects"
    return "builtin-missing"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--ref", required=True)
    ap.add_argument("--verdicts", required=True)
    ap.add_argument("--engine-door")
    ap.add_argument("--out", required=True)
    ap.add_argument("--tables")
    ap.add_argument("--measured-on", default=None)
    ap.add_argument("--master-sha", default=None)
    ap.add_argument("--runtime-cache", default=None, help="a census cache run with run_census.py --runtime-on")
    ap.add_argument("--runtime-verdicts", default=None, help="verdicts.json from VENDOR_HARNESS_RUNTIME_ON=1")
    a = ap.parse_args()
    engine_door = read_engine_door(a.engine_door)   # first: a named file that is not there stops here
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    ref = json.load(open(a.ref, encoding="utf-8"))
    inv = Inventory(ref)
    cache = os.path.abspath(a.cache)
    manifest = {r["key"]: r for r in json.load(open(os.path.join(cache, "sample_manifest.json"), encoding="utf-8"))["rows"]}
    census = read_census(cache, LANE_PRODUCTION, "--cache")
    inputs = {i["key"]: i for i in json.load(open(os.path.join(cache, "census_input.json"), encoding="utf-8"))}

    # ── the sample: one row per script
    scripts = []
    for key in sorted(k for k in inputs if not k.startswith("example:")):
        src = open(inputs[key]["path"], encoding="utf-8").read()
        u = usage_of(src, inv)
        c = census.get(key)
        if c is None:
            sys.exit("census has no row for %s - re-run run_census.py" % key)
        m = manifest.get(key, {})
        decl = "strategy" if "strategy-decl" in u["features"] else "library" if "library-decl" in u["features"] else "indicator"
        walls, detail = walls_of(c, inv, u["version"], frozenset(u["items"]), decl)
        if places_orders(u):
            walls.add(("bucket", "strategy"))   # orders are never simulated (see "clean" below)
        scripts.append({
            "key": key, "population": key.split(":")[0], "title": m.get("title"), "author": m.get("author"),
            "agreeCount": m.get("agreeCount"), "version": u["version"], "declaration": decl,
            "sha256": hashlib.sha256(src.encode("utf-8")).hexdigest()[:16],
            "attached": bool(c.get("attached")),
            # ⛔ A STRATEGY THAT PLACES ORDERS DOES NOT TRANSFER FULLY even when the door
            # draws its plots: its trades, markers and tester report are its output, and
            # nothing here simulates the broker. The door's own ruling (C50) draws the
            # plots; the coverage map does not count that as the whole script.
            "clean": transfers_fully(c, u),
            "doorClean": bool(c.get("clean")),
            "runtimeAttached": bool((c.get("runtime") or {}).get("attached")),
            # ⚠️ COUNTERFACTUAL, AN UPPER BOUND: with the dark runtime pane on, the door
            # handed the script to the per-bar RUNTIME lane and attached it. The host
            # translation's refusals stay on that result by design, so `isClean` cannot
            # judge it; nothing here proves the runtime lane drew every output.
            "placesOrders": places_orders(u),
            "runtimeClean": not places_orders(u) and (
                bool((c.get("runtime") or {}).get("clean")) or (
                    bool((c.get("runtime") or {}).get("attached")) and (c.get("runtime") or {}).get("lane") == "runtime")),
            "peelSteps": c.get("peelSteps"), "reachedAfterPeel": c.get("reachedAfterPeel"), "stuck": c.get("stuck"),
            "firstGuards": sorted({r.get("guard") for r in ((c.get("steps") or [{}])[0].get("refusals") or [])} - {None}),
            "walls": sorted(key_label(k) for k in walls),
            # ⭐ W3W4-T0 - step 0's object program, counters only (review B1): attempted / dropped / which of the three
            "objectProgram": object_program_row((c.get("steps") or [{}])[0]),
            "_walls": walls, "_items": u["items"], "_orders": u["orders"], "_features": u["features"], "_symbols": u["symbols"],
        })
    N = len(scripts)
    clean = [s for s in scripts if s["clean"]]
    decl_by_key = {s["key"]: s["declaration"] for s in scripts}
    items_by_key = {s["key"]: s["_items"] for s in scripts}
    orders_by_key = {s["key"]: s["_orders"] for s in scripts}

    # ── vendor parity evidence
    # a capture is joined to a sample script by its source, whitespace-insensitive (norm_src)
    by_norm = {norm_src(open(inputs[s["key"]]["path"], encoding="utf-8").read()): s for s in scripts}
    vd = read_verdicts(a.verdicts, LANE_PRODUCTION, "--verdicts")
    verified_items, diverge_items = collections.Counter(), collections.Counter()
    cap_rows = []
    for r in vd.get("results", []):
        p = os.path.join(ROOT, r["file"]) if not os.path.isabs(r["file"]) else r["file"]
        try:
            cap = json.load(open(p, encoding="utf-8"))
            src = (cap.get("source") or {}).get("text") or ""
        except Exception:  # noqa: BLE001
            src = ""
        u = usage_of(src, inv) if src else {"items": set()}
        cap_rows.append({"id": r.get("id"), "verdict": r.get("verdict")})
        hit = by_norm.get(norm_src(src)) if src else None
        if hit is not None:
            hit.setdefault("_captures", set()).add(r.get("verdict"))
        tgt = verified_items if r.get("verdict") == "MATCH" else diverge_items
        for it in u["items"]:
            # the harness grades plots, paints and drawing objects; it never grades
            # orders, alerts or logs, so a MATCH says nothing about those names
            if it.startswith(UNGRADED_PREFIXES):
                continue
            tgt[it] += 1
    vcount = collections.Counter(r["verdict"] for r in cap_rows)
    for s in scripts:
        s["vendorVerdict"] = script_verdict(s.pop("_captures", ()))
    sample_parity = collections.Counter(
        ("transfers" if s["clean"] else "does-not-transfer") + ":" + s["vendorVerdict"]
        for s in scripts if s["vendorVerdict"])

    # ── TradingView's own examples through the door
    ex_clean, ex_blocked = collections.defaultdict(list), collections.defaultdict(list)
    for key, it in inputs.items():
        if not key.startswith("example:"):
            continue
        c = census.get(key) or {}
        src = open(it["path"], encoding="utf-8").read()
        u = usage_of(src, inv)
        walls, _ = walls_of(c, inv, 6, frozenset(u["items"]))
        for nm in u["items"]:
            if c.get("clean"):
                ex_clean[nm].append(key)
            elif ("item", nm) in walls:
                ex_blocked[nm].append(key)
    examples_total = sum(1 for k in inputs if k.startswith("example:"))
    examples_clean = sum(1 for k in inputs if k.startswith("example:") and (census.get(k) or {}).get("clean"))

    # ── per-item evidence over the sample
    use = collections.defaultdict(set)
    use_clean = collections.defaultdict(set)
    use_rt = collections.defaultdict(set)
    blocked = collections.defaultdict(lambda: collections.Counter())
    for s in scripts:
        for it in s["_items"]:
            use[it].add(s["key"])
            if s["clean"]:
                use_clean[it].add(s["key"])
            elif s["runtimeClean"]:
                use_rt[it].add(s["key"])
        c = census[s["key"]]
        for st in c.get("steps") or []:
            for r in st.get("refusals") or []:
                tok = inv.normalise((r.get("token") or "").strip(), s["version"]) if r.get("token") else None
                if tok:
                    blocked[tok][r.get("guard")] += 1

    def status_of(nm):
        dl = data_limited(nm)
        g = blocked.get(nm, collections.Counter())
        name_unknown = sum(v for k, v in g.items() if k in CAPABILITY_MISSING)
        unmapped = sum(v for k, v in g.items() if k not in CAPABILITY_MISSING)
        translates = bool(use_clean.get(nm)) or bool(ex_clean.get(nm))
        if dl:
            return "data-limited", dl
        if translates and verified_items.get(nm):
            st = "supported-and-verified"
        elif translates:
            st = "supported-unverified"
        elif use_rt.get(nm):
            st = "door-unreachable"
        elif name_unknown:
            st = "missing"
        elif unmapped:
            st = "call-unmapped"
        elif use.get(nm) or nm in ex_blocked:
            st = "unproven"
        else:
            st = "no-evidence"
        # a name that translates in SOME calls and is refused in others
        if st.startswith("supported") and (name_unknown or unmapped):
            st = st + "+partial"
        return st, None

    items_out = []
    for nm in sorted(inv.items):
        meta = inv.items[nm]
        st, why = status_of(nm)
        items_out.append({
            "name": nm, "namespace": meta["namespace"], "kinds": meta["kinds"],
            "status": st, "dataSource": why,
            "scriptsUsing": len(use.get(nm, ())), "scriptsUsingThatTransfer": len(use_clean.get(nm, ())),
            "examplesClean": len(ex_clean.get(nm, ())), "examplesBlocked": len(ex_blocked.get(nm, ())),
            "vendorMatchCaptures": verified_items.get(nm, 0), "vendorOtherCaptures": diverge_items.get(nm, 0),
            "refusedAs": dict(sorted(blocked.get(nm, {}).items())),
        })

    # ── features
    feats_out = []
    for fid, label, _rx, _fl in FEATURES:
        users = [s for s in scripts if fid in s["_features"]]
        feats_out.append({
            "id": fid, "label": label, "scriptsUsing": len(users),
            "scriptsUsingThatTransfer": sum(1 for s in users if s["clean"]),
            "transferRate": round(sum(1 for s in users if s["clean"]) / len(users), 3) if users else None,
        })

    # ── blockers: by key (sole + touched) and by capability bucket (greedy cover)
    notclean = [s for s in scripts if not s["clean"]]
    touched = collections.Counter()
    sole = collections.Counter()
    for s in notclean:
        for k in s["_walls"]:
            touched[k] += 1
        if len(s["_walls"]) == 1:
            sole[next(iter(s["_walls"]))] += 1
    blockers = sorted(touched, key=lambda k: (-sole[k], -touched[k], key_label(k)))
    blockers_out = [{"blocker": key_label(k), "capability": key_bucket(k, inv), "soleBlockerOf": sole[k],
                     "scriptsBlocked": touched[k]} for k in blockers]

    bucket_sets = {s["key"]: {key_bucket(k, inv) for k in s["_walls"]} for s in notclean}
    no_walls = [s["key"] for s in notclean if not s["_walls"]]
    enumerated = {s["key"] for s in notclean if s["attached"] or s["reachedAfterPeel"]}
    remaining = dict(bucket_sets)
    fixed, greedy = set(), []
    while True:
        gain = collections.Counter()
        for key, bs in remaining.items():
            left = bs - fixed
            if len(left) == 1:
                gain[next(iter(left))] += 1
        touched_b = collections.Counter(b for bs in remaining.values() for b in bs - fixed)
        if not touched_b:
            break
        # unblock-most first; ties by how many scripts the capability touches
        best = max(touched_b, key=lambda b: (gain[b], touched_b[b], b))
        fixed.add(best)
        done = [k for k, bs in remaining.items() if not (bs - fixed)]
        for k in done:
            del remaining[k]
        greedy.append({"capability": best, "label": BUCKET_LABEL.get(best, best), "unblocks": len(done),
                       # ⚠️ only these had their WHOLE wall list read (attached, or the peel
                       # reached a build); the rest may hide further walls, so `unblocks` is
                       # an upper bound and this is the firmer number
                       "unblocksFullyEnumerated": sum(1 for k in done if k in enumerated),
                       "touches": touched_b[best],
                       "cumulativeTransfer": len(clean) + sum(g["unblocks"] for g in greedy) + len(done),
                       "cumulativePct": round(100.0 * (len(clean) + sum(g["unblocks"] for g in greedy) + len(done)) / N, 1)})
    bucket_touch = collections.Counter(b for bs in bucket_sets.values() for b in bs)
    bucket_sole = collections.Counter(next(iter(bs)) for bs in bucket_sets.values() if len(bs) == 1)

    # ── cross-symbol census
    sym_prefix = collections.Counter()
    for s in scripts:
        for sy in set(s["_symbols"]):
            sym_prefix[(sy.split(":")[0] if ":" in sy else ("(bare)" if sy else "(empty: chart symbol)"))] += 1

    def pct(n, d):
        return round(100.0 * n / d, 1) if d else None

    by_pop = {}
    for pop in ("committed", "reference", "builtin"):
        ss = [s for s in scripts if s["population"] == pop]
        by_pop[pop] = {"scripts": len(ss), "transfer": sum(1 for s in ss if s["clean"]),
                       "attached": sum(1 for s in ss if s["attached"]),
                       "runtimeCounterfactual": sum(1 for s in ss if s["clean"] or s["runtimeClean"]),
                       "transferPct": pct(sum(1 for s in ss if s["clean"]), len(ss))}
    by_ver = {}
    for s in scripts:
        v = "v%d" % s["version"] if s["version"] >= 4 else "v1-v3"
        by_ver.setdefault(v, [0, 0])
        by_ver[v][0] += 1
        by_ver[v][1] += 1 if s["clean"] else 0
    by_decl = {}
    for s in scripts:
        by_decl.setdefault(s["declaration"], [0, 0])
        by_decl[s["declaration"]][0] += 1
        by_decl[s["declaration"]][1] += 1 if s["clean"] else 0

    status_counts = collections.Counter(i["status"].replace("+partial", "") for i in items_out)
    ns_table = collections.defaultdict(collections.Counter)
    for i in items_out:
        ns_table[i["namespace"]][i["status"].replace("+partial", "")] += 1
    # weighted by use: share of item-USES whose item is in each status
    weighted = collections.Counter()
    for i in items_out:
        weighted[i["status"].replace("+partial", "")] += i["scriptsUsing"]

    out = {
        "schema": "uct.pine-coverage-map/v1",
        "generatedBy": "tools/pine_coverage/coverage_map.py",
        "measuredOn": a.measured_on, "masterSha": a.master_sha,
        "headline": {
            "definition": ("A script TRANSFERS FULLY when the production member door "
                           "(memberPaneDefinition -> installUserDefinitions; objects-only pane armed, runtime pane dark) "
                           "attaches it with zero refusals, with nothing dropped or withheld from its object program "
                           "and no per-bar paint withheld. Door acceptance, not numeric parity."),
            "sample": N, "transfer": len(clean), "transferPct": pct(len(clean), N),
            "attachedAnyForm": sum(1 for s in scripts if s["attached"]),
            "attachedPct": pct(sum(1 for s in scripts if s["attached"]), N),
            "runtimeCounterfactualTransfer": sum(1 for s in scripts if s["clean"] or s["runtimeClean"]),
            "runtimeCounterfactualPct": pct(sum(1 for s in scripts if s["clean"] or s["runtimeClean"]), N),
            "byPopulation": by_pop,
            "byVersion": {k: {"scripts": v[0], "transfer": v[1], "pct": pct(v[1], v[0])} for k, v in sorted(by_ver.items())},
            "byDeclaration": {k: {"scripts": v[0], "transfer": v[1], "pct": pct(v[1], v[0])} for k, v in sorted(by_decl.items())},
        },
        "parity": {
            "captures": len(cap_rows), "verdicts": dict(sorted(vcount.items())),
            "sampleScriptsWithACapture": sum(1 for s in scripts if s["vendorVerdict"]),
            "sampleByTransferAndVerdict": dict(sorted(sample_parity.items())),
            "verifiedTransfer": sum(1 for s in scripts if s["clean"] and s["vendorVerdict"] == "MATCH"),
            "verifiedTransferPct": round(100.0 * sum(1 for s in scripts if s["clean"] and s["vendorVerdict"] == "MATCH") / N, 1),
            "note": "vendor-harness verdicts over tests/fixtures/vendor/harness (RDDT/SPY daily captures of corpus scripts and probes)",
        },
        "examples": {"total": examples_total, "transfer": examples_clean},
        "inventory": {
            "source": "TradingView Pine Script v6 reference, extracted by tools/pine_survey/pine_reference_extract.js",
            "counts": {k: len(ref.get(k, [])) for k in ("functions", "methods", "variables", "constants", "types", "keywords", "operators", "annotations")},
            "uniqueItems": len(items_out),
            "statusCounts": dict(sorted(status_counts.items())),
            "statusWeightedByUse": dict(sorted(weighted.items())),
            "byNamespace": {ns: dict(sorted(c.items())) for ns, c in sorted(ns_table.items())},
            "items": items_out,
        },
        "features": feats_out,
        "blockers": blockers_out,
        "capabilities": {
            "touched": dict(sorted(bucket_touch.items())), "sole": dict(sorted(bucket_sole.items())),
            "labels": BUCKET_LABEL, "greedyRoadmap": greedy, "notCleanWithNoNamedWall": no_walls,
            "notClean": len(notclean), "wallsFullyEnumerated": len(enumerated),
        },
        "crossSymbolPrefixes": dict(sym_prefix.most_common()),
        "strategyOn": strategy_on_block(scripts),
        "runtimeOn": runtime_on_section(
            os.path.abspath(a.runtime_cache), a.runtime_verdicts, vd, scripts,
            None, lambda k: bool(orders_by_key[k]) and decl_by_key[k] == "strategy",
            norm_src, inputs, N, inv=inv) if a.runtime_cache else None,
        "engineTableThroughPineDoor": engine_door,
        "scripts": [{k: v for k, v in s.items() if not k.startswith("_")} for s in scripts],
    }
    tmp = a.out + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1, ensure_ascii=False, sort_keys=False)
        f.write("\n")
    os.replace(tmp, a.out)

    h = out["headline"]
    print("HEADLINE %d/%d = %s%% transfer fully (attached any form %d = %s%%; runtime counterfactual %d = %s%%)" % (
        h["transfer"], N, h["transferPct"], h["attachedAnyForm"], h["attachedPct"],
        h["runtimeCounterfactualTransfer"], h["runtimeCounterfactualPct"]))
    print("by population", json.dumps(by_pop))
    ro = out.get("runtimeOn")
    if ro:
        print("RUNTIME-ON %d/%d = %s%% (production %d; +%d added, -%d lost; runtime-attached %d)" % (
            ro["transfer"], N, ro["transferPct"], ro["productionTransfer"], len(ro["added"]), len(ro["lost"]),
            ro["runtimeAttached"]))
        if ro["parity"]:
            print("RUNTIME-ON parity", json.dumps(ro["parity"]["verdicts"]), "changed", json.dumps(ro["parity"]["changed"]))
    print("parity", json.dumps(out["parity"]["verdicts"]), "examples", examples_clean, "/", examples_total)
    print("status", json.dumps(dict(status_counts)))
    print("weighted", json.dumps(dict(weighted)))
    print("\nTOP BLOCKERS")
    for b in blockers_out[:40]:
        print("  %-48s %-22s sole=%3d touched=%3d" % (b["blocker"][:48], b["capability"], b["soleBlockerOf"], b["scriptsBlocked"]))
    print("\nCAPABILITIES touched / sole")
    for b, n in bucket_touch.most_common():
        print("  %-24s touched=%3d sole=%3d" % (b, n, bucket_sole[b]))
    print("\nGREEDY")
    for g in greedy:
        print("  %-24s +%3d  -> %d (%s%%)" % (g["capability"], g["unblocks"], g["cumulativeTransfer"], g["cumulativePct"]))
    if a.tables:
        with open(a.tables, "w", encoding="utf-8") as f:
            json.dump({"ns": out["inventory"]["byNamespace"]}, f)


if __name__ == "__main__":
    main()
