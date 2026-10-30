# -*- coding: utf-8 -*-
"""coverage_map.py - the Pine coverage map: inventory x usage x member-door verdicts.

  python tools/pine_coverage/coverage_map.py --cache <cache> --ref <pine_v6_reference.json> \
      --verdicts <verdicts.json> [--engine-door <engine_door.json>] \
      --out docs/pine/coverage-map.json [--tables <scratch.md>]

Reads (nothing here asks the engine anything; it joins what the door answered):
  --ref        TradingView's own Pine v6 reference (tools/pine_survey/pine_reference_extract.js)
  <cache>/sample_manifest.json + census.jsonl   (fetch_sample.py, run_census.py)
  --verdicts   a fresh vendor-harness verdicts.json over tests/fixtures/vendor/harness
  --engine-door  doorCoverage's probe of the engine's own declared functions

Writes coverage-map.json: deterministic (sorted keys, no wall-clock stamp unless
--measured-on is passed), so a daily job can recompute and DIFF it.

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
    "drawing-objects": "Drawing objects (line/label/box/table/polyline/linefill): ops dropped or withheld",
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
    return {"version": version, "items": used, "features": feats, "symbols": syms}


def data_limited(name):
    for pre, why in DATA_LIMITED:
        if name == pre or (pre.endswith(".") and name.startswith(pre)) or (name.startswith(pre) and not pre.endswith(".") and name[len(pre):len(pre) + 1] in ("", "_", ".")):
            return why
    return None


KEYWORD_FEATURE = {"type": "udt", "in": "for-in", "as": "import", "import": "import", "method": "method-def",
                   "enum": "enum", "while": "while", "for": "for", "switch": "switch", "varip": "varip"}
STRATEGY_ORDERS = {"strategy.entry", "strategy.order", "strategy.exit", "strategy.close", "strategy.close_all"}
UNGRADED_PREFIXES = ("strategy", "alert", "alertcondition", "log.", "runtime.")

DRAWING_CTORS = {"line.new", "label.new", "box.new", "table.new", "polyline.new", "linefill.new"}


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
        for r in st.get("refusals") or []:
            g = r.get("guard") or "unnamed"
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
                named = False
                for nm in (st.get("unsupported") or []) + (st.get("loopBlockedCalls") or []):
                    it = inv.normalise(nm, 6)
                    if it:
                        keys.add(("item", it))
                        named = True
                for ns in st.get("outOfScope") or []:
                    keys.add(("item", ns + ".*"))
                    named = True
                for k in sorted((st.get("dropReasons") or {}).keys()):
                    keys.add(("drop", k.split(":")[0] + ":" + (k.split(":")[1] if ":" in k else "")))
                    named = True
                if not named:
                    keys.add(("bucket", "drawing-objects"))
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
        return "drawing-objects"
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
    a = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    ref = json.load(open(a.ref, encoding="utf-8"))
    inv = Inventory(ref)
    cache = os.path.abspath(a.cache)
    manifest = {r["key"]: r for r in json.load(open(os.path.join(cache, "sample_manifest.json"), encoding="utf-8"))["rows"]}
    census = {}
    for l in open(os.path.join(cache, "census.jsonl"), encoding="utf-8"):
        if l.strip():
            d = json.loads(l)
            census[d["key"]] = d
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
        if decl == "strategy" and u["items"] & STRATEGY_ORDERS:
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
            "clean": bool(c.get("clean")) and not (decl == "strategy" and u["items"] & STRATEGY_ORDERS),
            "doorClean": bool(c.get("clean")),
            "runtimeAttached": bool((c.get("runtime") or {}).get("attached")),
            # ⚠️ COUNTERFACTUAL, AN UPPER BOUND: with the dark runtime pane on, the door
            # handed the script to the per-bar RUNTIME lane and attached it. The host
            # translation's refusals stay on that result by design, so `isClean` cannot
            # judge it; nothing here proves the runtime lane drew every output.
            "runtimeClean": not (decl == "strategy" and u["items"] & STRATEGY_ORDERS) and (
                bool((c.get("runtime") or {}).get("clean")) or (
                    bool((c.get("runtime") or {}).get("attached")) and (c.get("runtime") or {}).get("lane") == "runtime")),
            "peelSteps": c.get("peelSteps"), "reachedAfterPeel": c.get("reachedAfterPeel"), "stuck": c.get("stuck"),
            "firstGuards": sorted({r.get("guard") for r in ((c.get("steps") or [{}])[0].get("refusals") or [])} - {None}),
            "walls": sorted(key_label(k) for k in walls),
            "_walls": walls, "_items": u["items"], "_features": u["features"], "_symbols": u["symbols"],
        })
    N = len(scripts)
    clean = [s for s in scripts if s["clean"]]

    # ── vendor parity evidence
    # a capture is joined to a sample script by its source, whitespace-insensitive
    def norm_src(t):
        return hashlib.sha1(re.sub(r"\s+", "", t).encode("utf-8")).hexdigest()
    by_norm = {norm_src(open(inputs[s["key"]]["path"], encoding="utf-8").read()): s for s in scripts}
    vd = json.load(open(a.verdicts, encoding="utf-8"))
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
        v = s.pop("_captures", None)
        s["vendorVerdict"] = None if not v else ("MATCH" if "MATCH" in v else "DIVERGE" if "DIVERGE" in v else "INCONCLUSIVE")
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

    engine_door = json.load(open(a.engine_door, encoding="utf-8")) if a.engine_door and os.path.exists(a.engine_door) else []

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
