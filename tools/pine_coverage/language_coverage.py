# -*- coding: utf-8 -*-
"""language_coverage.py - the LANGUAGE-COVERAGE SCOREBOARD: of every item in the Pine v6
reference, which work EXACTLY in each lane.

  inputs  reference + sample cache  ->  the scripts to put to both lanes' doors
  probes  reference (+ the items still unanswered)  ->  single-item probes for both lanes' doors
  build   door answers + evidence   ->  docs/pine/language-coverage-<date>.json + .md

(see the module docstring blocks below, and docs/pine/LANGUAGE-COVERAGE-2026-11-02.md)
"""
import argparse
import collections
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import coverage_map as cm  # noqa: E402  (the one authority for inventory, usage and data-limited items)
import run_census  # noqa: E402  (the one authority for which reference examples are whole scripts)


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


# ── inputs ───────────────────────────────────────────────────────────────────
def cmd_inputs(a):
    """The sample scripts and TradingView's own whole-script examples, as the door inputs."""
    cache = os.path.abspath(a.cache)
    out_dir = os.path.abspath(a.out_dir)
    os.makedirs(out_dir, exist_ok=True)
    man = json.load(open(os.path.join(cache, "sample_manifest.json"), encoding="utf-8"))["rows"]
    items = []
    for r in man:
        if r["status"] != "ok":
            continue
        p = r["path"].replace("<cache>", cache)
        if not os.path.isabs(p):
            p = os.path.join(ROOT, p)
        items.append({"key": r["key"], "path": os.path.abspath(p)})
    # ⛔ run_census names an example file by its item name with every non-word character
    # collapsed, so the eight operator examples (`+=`, `?:`, `[]`...) all wrote ONE file and
    # seven of them read the eighth's text. The same selection rule, a collision-free name.
    plain = run_census.safe
    run_census.safe = lambda name: "%s-%s" % (plain(name), hashlib.sha1(name.encode("utf-8")).hexdigest()[:8])
    try:
        examples = run_census.build_examples(a.ref, os.path.join(out_dir, "examples"))
    finally:
        run_census.safe = plain
    for e in examples:
        items.append({"key": e["key"], "path": os.path.abspath(e["path"]),
                      "item": e["item"], "collection": e["collection"]})
    items.sort(key=lambda i: i["key"])
    write_json(os.path.join(out_dir, "inputs.json"), items)
    print("inputs: %d (%d sample, %d examples) -> %s" % (
        len(items), sum(1 for i in items if not i["key"].startswith("example:")),
        sum(1 for i in items if i["key"].startswith("example:")), os.path.join(out_dir, "inputs.json")))


# ── the vocabulary of this scoreboard ────────────────────────────────────────
KIND_COLLECTIONS = (("functions", "function"), ("variables", "variable"), ("constants", "constant"),
                    ("types", "type"), ("keywords", "keyword"), ("annotations", "annotation"),
                    ("operators", "operator"))
KINDS = ("function", "method", "variable", "constant", "type", "keyword", "annotation", "operator")
LANES = ("host", "runtime")
LANE_LABEL = {"host": "host lane (the translator members get today)", "runtime": "runtime lane (dark per-bar interpreter)"}

EXACT = "exact"
SUPPORTED = "supported-unproven"
REFUSED = "refused"
MISSING = "missing"
UNANSWERED = "unanswered"
STATUSES = (EXACT, SUPPORTED, REFUSED, MISSING, UNANSWERED)

# A refusal that says the lane does not KNOW the name (as against knowing it and declining this
# shape or capability). The host's pair is the coverage map's own `NAME_UNKNOWN`.
NAME_UNKNOWN_GUARDS = {
    "host": set(cm.NAME_UNKNOWN),
    # MEASURED 2026-11-02 (the instrument's own control): the runtime lane runs the Pine front end, so a name nobody
    # declares is `pine:builtin` there as well. Grown, per run, by whatever the unknown-name controls are answered with.
    "runtime": set(cm.NAME_UNKNOWN) | {"runtime:unbound"},
}

TIMEOUT_GUARD = "pine:timeout"     # the door's wall-clock limit: a measurement of the machine, not of the script

# A capture's SUBJECT is what it was written to measure. The two legacy formats are purpose-built (one plotted
# value per named function, or a probe script per question); a community script captured as `harness-v1` uses
# dozens of items incidentally, so one such capture cannot say which of them it exercised.
SUBJECT_FORMATS = ("observation", "probe-rows")
CORROBORATION = 2           # distinct community scripts needed to credit an item they merely use

ANNOTATIONS = ("@version=", "@description", "@enum", "@function", "@param", "@returns", "@variable",
               "@type", "@field", "@strategy_alert_message")

# ⛔ "a reference formula": TradingView's own reference carries either a Pine reimplementation of the
# item in its examples (`pine_sma`, `f_bb`: the function name contains the item's short name) or states
# the calculation in its text. The first is a rail's oracle; the second is a rail's oracle too, less
# precisely. Neither is invented here: both are read off the reference.
FORMULA_DEF_RX = re.compile(r"^\s*(?:export\s+)?(?:method\s+)?([A-Za-z_]\w*)\s*\([^()\n]*\)\s*=>", re.M)
FORMULA_STATED_RX = re.compile(
    r"\b(?:is calculated|are calculated|calculated as|is computed|computed as|formula|equivalent to|defined as)\b", re.I)


def reference_items(ref):
    """{(kind, name): {kind, name, namespace, entries}} - one item per kind per name.

    A name that is both a function and a variable (`time`) is two items, because the lanes answer
    them differently; a reference METHOD entry is the method-call form of the function it names
    (`originalName`), a third kind of item."""
    items = {}
    for coll, kind in KIND_COLLECTIONS:
        for e in ref.get(coll, []):
            key = (kind, e["name"])
            it = items.get(key)
            if it is None:
                nm = e["name"]
                ns = nm.split(".")[0] if "." in nm and kind in ("function", "variable", "constant") else (
                    "(language)" if kind in ("keyword", "operator", "annotation", "type") else "(global)")
                it = items[key] = {"kind": kind, "name": nm, "namespace": ns, "entries": []}
            it["entries"].append(e)
    for e in ref.get("methods", []):
        orig = e.get("originalName") or ""
        if not orig:
            continue
        key = ("method", orig)
        it = items.get(key)
        if it is None:
            ns = orig.split(".")[0] if "." in orig else "(global)"
            it = items[key] = {"kind": "method", "name": orig, "namespace": ns, "entries": []}
        it["entries"].append(e)
    return items


def published_formula(item):
    """'implementation' | 'stated' | None, read off the reference entries of one item.

    `implementation`: an example defines a Pine reimplementation named the way TradingView names them
    (`pine_sma`, `f_bb`, or the bare short name). `stated`: the text says how it is calculated, and only for
    `ta.` and `math.` items, where a calculation is what the text is about."""
    short = item["name"].split(".")[-1]
    rx = re.compile(r"(?:pine_|f_|_)?" + re.escape(short), re.I)
    kind = None
    for e in item["entries"]:
        for ex in e.get("examples") or []:
            if isinstance(ex, str) and any(rx.fullmatch(fn) for fn in FORMULA_DEF_RX.findall(ex)):
                return "implementation"
        if kind is None and item["kind"] in ("function", "variable") and item["name"].startswith(("ta.", "math.")):
            txt = " ".join(str(e.get(k) or "") for k in ("desc", "remarks", "detailedDesc"))
            if FORMULA_STATED_RX.search(txt):
                kind = "stated"
    return kind


# ── what a script uses, split by KIND ────────────────────────────────────────
def _occurrences(code, name):
    """(called, bare): is `name` written as a call somewhere, and as a plain reference somewhere."""
    called = bare = False
    for m in re.finditer(r"(?<![\w.])" + re.escape(name) + r"(?!\w)", code):
        if code[m.end():m.end() + 8].lstrip().startswith("("):
            called = True
        else:
            bare = True
    return called, bare


def _method_form_used(code, name, inv):
    """The method-call form `x.push(...)` of `array.push`: a receiver that is not a namespace."""
    last, ns = name.split(".")[-1], name.split(".")[0]
    if ns not in inv.methods.get(last, ()):
        return False
    for m in re.finditer(r"(?<![\w.])([A-Za-z_]\w*)\s*\.\s*%s\s*\(" % re.escape(last), code):
        if m.group(1) not in inv.namespaces:
            return True
    return False


def item_uses(src, inv):
    """(the (kind, name) items one script uses, its language features).

    `coverage_map.usage_of` answers by NAME; the reference keeps a function `time()` and a variable
    `time` apart, and the method-call form `a.push(x)` apart from `array.push(a, x)`, so the code is
    read once more, for those two splits only. ⛔ Comments are stripped first (`strip_code`): a
    name in prose is not a use. The annotations live IN comments, so they are read off the raw text."""
    u = cm.usage_of(src, inv)
    code, _strings = cm.strip_code(src)
    out = set()
    for nm in u["items"]:
        meta = inv.items.get(nm)
        if not meta:
            continue
        kinds = list(meta["kinds"])
        called, bare = _occurrences(code, nm)
        method = "function" in kinds and "." in nm and _method_form_used(code, nm, inv)
        if len(kinds) == 1:
            if kinds[0] == "function" and method and not called:
                out.add(("method", nm))             # only ever written as `x.f(...)`: the function form was not used
            else:
                out.add((kinds[0], nm))
                if method:
                    out.add(("method", nm))
        else:
            if called and "function" in kinds:
                out.add(("function", nm))
            if bare or not called:
                for k in kinds:
                    if k != "function":
                        out.add((k, nm))
                        break
            if method:
                out.add(("method", nm))
    for ann in ANNOTATIONS:
        if re.search(r"//\s*" + re.escape(ann), src):
            out.add(("annotation", ann))
    return out, u["features"]


# ── the evidence ledger ──────────────────────────────────────────────────────
class Evidence:
    """Everything the door said or a rail proved about each (kind, name), per lane.

    accept   a door ACCEPTED the item: [(basis, ref)]                      basis: sample | example | probe | engine-door
    refuse   a door refused the item BY NAME or capability: [(basis, guard, ref)]
    vendor   (id, subject, digest) of fully-compared vendor captures graded MATCH in the lane whose source uses the
             item: `subject` is True for a purpose-built observation or probe, `digest` names the script (a script
             captured on two symbols is still ONE script)
    rails    ids of reference-formula rails (the reference publishes a formula for the item)
    defrails ids of rails that compare to a DEFINITION only (the reference publishes no formula): informative, not exact
    diffs    ids of declared differences between this engine and TradingView for the item
    diverged {lane: {digest}}: the source digests of captures the harness graded DIVERGE in that lane. A script that
             diverges on ANY symbol is not a witness for the items it uses, on any symbol
    timedOut {lane: [(basis, key)]}: asks the door answered with a wall-clock timeout (`pine:timeout`). That is how
             long THIS machine took, not a fact about the script, so such an ask is unanswered and blames nothing
    """

    def __init__(self):
        def tree():
            return collections.defaultdict(lambda: collections.defaultdict(list))
        self.accept, self.refuse, self.vendor = tree(), tree(), tree()
        self.rails, self.defrails, self.diffs = tree(), tree(), tree()
        self.diverged = collections.defaultdict(set)
        self.timedOut = collections.defaultdict(list)

    def add_vendor(self, it, lane, cid, subject, digest):
        self.vendor[it][lane].append((cid, bool(subject), digest))


def read_jsonl(paths):
    rows = {}
    for path in paths or []:
        for line in open(path, encoding="utf-8"):
            if line.strip():
                d = json.loads(line)
                rows[d["key"]] = d
    return rows


def name_kinds_of(items):
    out = collections.defaultdict(list)
    for kind, name in sorted(items):
        out[name].append(kind)
    return out


def resolve_token(token, version, guard, inv, name_kinds, text=None):
    """The item a refusal's token names, or None. A token that is a user's own function or a
    legacy spelling this vocabulary cannot read names no item (never guessed).

    A name that is two kinds of item (`string` the cast and `string` the type, `time` the function and `time` the
    variable) is told apart by the refused line when there is one: written as a call it is the function, written
    bare it is the other kind."""
    nm = inv.normalise((token or "").strip(), version) if token else None
    if not nm or nm not in name_kinds:
        return None
    kinds = name_kinds[nm]
    if len(kinds) == 1:
        return (kinds[0], nm)
    if text:
        code, _strings = cm.strip_code(text)
        written = re.escape(str(token).strip())
        called = re.search(r"(?<![\w.])" + written + r"\s*\(", code) is not None
        bare = re.search(r"(?<![\w.])" + written + r"(?![\w(])", code) is not None
        if called and "function" in kinds:
            return ("function", nm)
        if bare and not called:
            rest = [k for k in kinds if k != "function"]
            if rest:
                return (rest[0], nm)
    if guard == "pine:builtin" and "variable" in kinds:
        return ("variable", nm)
    return ("function", nm) if "function" in kinds else (kinds[0], nm)


# A refusal whose guard is about LANGUAGE (a block, a reassignment, a function body, a type, an import)
# names no builtin, so its token resolves to no item. The refused LINE does say which syntax it wrote:
# these guards blame the syntax items the guard is about that are written ON that line, and nothing else
# (`for` on the line of a `pine:block` refusal; never the `ta.sma` that shares it).
SYNTAX_GUARDS = {
    "pine:block": [("keyword", "if"), ("keyword", "else"), ("keyword", "for"), ("keyword", "while"), ("keyword", "switch")],
    "pine:reassign": [("operator", ":="), ("keyword", "var"), ("keyword", "varip")],
    "pine:state": [("operator", ":="), ("keyword", "var"), ("keyword", "varip")],
    "pine:function-def": [("operator", "=>")],
    "pine:type": [("keyword", "type"), ("keyword", "method"), ("keyword", "enum")],
    "pine:member": [("keyword", "type"), ("keyword", "method")],
    "pine:module": [("keyword", "import"), ("keyword", "export")],
    "pine:declaration-library": [("keyword", "export")],
    "pine:collection": [("type", "array"), ("type", "matrix"), ("type", "map")],
    "pine:operator": [("operator", "%"), ("operator", "?:"), ("operator", "[]")],
    "runtime:loop": [("keyword", "for"), ("keyword", "while")],
    "runtime:function": [("operator", "=>")],
    "runtime:udt": [("keyword", "type")],
    "runtime:udt-field": [("keyword", "type")],
    "runtime:udt-method": [("keyword", "method")],
    "runtime:array": [("type", "array"), ("type", "matrix"), ("type", "map")],
    "runtime:varip": [("keyword", "varip")],
    "runtime:switch": [("keyword", "switch")],
    "runtime:block-value": [("keyword", "if"), ("keyword", "switch")],
    "runtime:library": [("keyword", "import")],
}
_SYNTAX_PRESENT = {
    ("operator", ":="): re.compile(r":="),
    ("operator", "=>"): re.compile(r"=>"),
    ("operator", "%"): re.compile(r"%"),
    ("operator", "?:"): re.compile(r"\?[^?:]+:"),
    ("operator", "[]"): re.compile(r"[\w)\]]\s*\["),
}


def syntax_blame(guard, text, name_kinds):
    """The syntax items a language-guard refusal blames, from the refused line's own text."""
    if not text or guard not in SYNTAX_GUARDS:
        return []
    code, _ = cm.strip_code(text)
    out = []
    for kind, name in SYNTAX_GUARDS[guard]:
        if kind not in name_kinds.get(name, ()):
            continue
        rx = _SYNTAX_PRESENT.get((kind, name)) or re.compile(r"(?<![\w.])" + re.escape(name) + r"(?![\w])")
        if rx.search(code):
            out.append((kind, name))
    return out


def _creditable(uses, features):
    """Which items a script that a lane drew may be credited with.

    A strategy that places orders is drawn as its plots only (ruling C50): nothing simulates its
    broker, so it says nothing about `strategy.*`."""
    if "strategy-decl" in features:
        return {it for it in uses if not it[1].startswith("strategy")}
    return set(uses)


def ingest_script(ev, row, src, inv, name_kinds, basis, key, documented=None):
    """One sample script or example through both lanes."""
    uses, features = item_uses(src, inv)
    seen_uses = set(uses)
    if documented is not None:
        uses = set(uses) | {documented}
    version = cm.version_of(src)
    credit = _creditable(uses, features)
    h = row.get("host") or {}
    if h and not h.get("threw"):
        if h.get("clean"):
            for it in credit:
                ev.accept[it]["host"].append((basis, key))
        else:
            # ⛔ `pine:timeout` is how long THIS machine took, never a limit of the script: on the next pass the same
            # script can come back clean or refused. A refusal with that guard blames nothing, and the walls behind
            # it (the peel) are not read at all, because which of them show depends on the load of the run.
            timed_out = False
            for r in h.get("refusals") or []:
                if r.get("guard") == TIMEOUT_GUARD:
                    timed_out = True
                    continue
                it = resolve_token(r.get("token"), version, r.get("guard"), inv, name_kinds, r.get("text"))
                if it:
                    ev.refuse[it]["host"].append((basis, r.get("guard") or "unnamed", key))
                for sit in syntax_blame(r.get("guard"), r.get("text"), name_kinds):
                    ev.refuse[sit]["host"].append((basis, r.get("guard"), key))
            if timed_out:
                ev.timedOut["host"].append((basis, key))
            named = [(n, "objects:unsupported") for n in h.get("unsupported") or []]
            named += [(n, "objects:loop-blocked") for n in h.get("loopBlockedCalls") or []]
            # the walls BEHIND the first: the production door asked again with each refused line neutralised
            # (`hostPeel`), to name an item by its token. It never credits anything.
            # ⛔ the peel stops at the first wall-clock timeout: `pine:timeout` is how long THIS machine took, so the
            # walls behind it depend on the load of the run (one 21 s script took 45 s on the next pass). Reading on
            # would make the same engine score differently from one run to the next.
            for step in [] if timed_out else (row.get("hostPeel") or []):
                if step.get("guard") == TIMEOUT_GUARD:
                    break
                for r in step.get("refusals") or []:
                    it = resolve_token(r.get("token"), version, r.get("guard"), inv, name_kinds, r.get("text"))
                    if it:
                        ev.refuse[it]["host"].append((basis, r.get("guard") or "unnamed", key))
                    for sit in syntax_blame(r.get("guard"), r.get("text"), name_kinds):
                        ev.refuse[sit]["host"].append((basis, r.get("guard"), key))
                named += [(n, "objects:unsupported") for n in step.get("unsupported") or []]
                named += [(n, "objects:loop-blocked") for n in step.get("loopBlockedCalls") or []]
            for nm, guard in named:
                it = resolve_token(nm, 6, None, inv, name_kinds)
                if it:
                    ev.refuse[it]["host"].append((basis, guard, key))
    rt, own = row.get("runtime") or {}, row.get("runtimeOwn") or {}
    if rt and not rt.get("threw"):
        # ⛔ compiled is not drawn: the member door's runtime fallback declines a program that reads another
        # symbol's or timeframe's bars (`runtime:request`) and one with a condition whose `na` reading is not yet
        # matched to TradingView (`runtime:na-test`: a `?:` below v4, an `or` / `not` in v4 and v5)
        okrow = next((x for x in (rt, own) if x.get("ok") and not x.get("requests") and not x.get("naTests")), None)
        if okrow is not None:
            for it in credit:
                ev.accept[it]["runtime"].append((basis, key))
        elif any(x.get("ok") for x in (rt, own)):
            # compiled by the lane but declined at the door: it reads another symbol's or timeframe's bars, which a
            # pane does not hand the run (`runtime:request`). A decline for an unsettled `na` reading names no item.
            if any(x.get("ok") and x.get("requests") for x in (rt, own)):
                for it in uses:
                    if it[1].startswith("request.") or it[1] == "request":
                        ev.refuse[it]["runtime"].append((basis, "runtime:request", key))
        else:
            # the lane names ONE wall per ask; `runtimePeel` is the same script asked again with each refused line
            # neutralised, so the walls behind the first are named too (used to blame by token, never to credit)
            seen = set()
            for x in [rt, own] + list(row.get("runtimePeel") or []):
                g = x.get("guard")
                if not g or (g, x.get("token"), x.get("line")) in seen:
                    continue
                seen.add((g, x.get("token"), x.get("line")))
                it = resolve_token(x.get("token"), version, g, inv, name_kinds, x.get("text"))
                if it:
                    ev.refuse[it]["runtime"].append((basis, g, key))
                for sit in syntax_blame(g, x.get("text"), name_kinds):
                    ev.refuse[sit]["runtime"].append((basis, g, key))
    return seen_uses


def ingest_engine_door(ev, rows, lane, items):
    """The engine's declared functions, asked through the Pine door (doorCoverage's probe).

    A declared name that is the SAME short name as a reference function (`sma` -> `ta.sma`,
    `abs` -> `math.abs`, `nz` -> `nz`) and that the door reached is that function, accepted. A
    declared name whose Pine signature differs (`atr(high, low, close, n)` against `ta.atr(n)`) is
    not item evidence either way, and a door that did not reach it names no item."""
    for r in rows:
        if r.get("pine") != "reachable":
            continue
        for cand in ("ta." + r["name"], "math." + r["name"], r["name"]):
            if ("function", cand) in items:
                ev.accept[("function", cand)][lane].append(("engine-door", r["name"]))


def capture_source(path):
    """The Pine text a vendor capture ran (harness-v1, observation, or probe-rows)."""
    try:
        d = json.load(open(path, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None
    if isinstance(d.get("source"), dict) and d["source"].get("text"):
        return d["source"]["text"]
    if isinstance(d.get("script"), dict) and d["script"].get("source"):
        return d["script"]["source"]
    if isinstance(d.get("_probe"), str):
        p = os.path.join(ROOT, d["_probe"])
        if os.path.exists(p):
            return open(p, encoding="utf-8").read()
    return None


def _split_args(text):
    """Top-level comma split of one call's argument text."""
    out, depth, cur, quote = [], 0, [], None
    for ch in text:
        if quote:
            cur.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in "\"'":
            quote = ch
            cur.append(ch)
        elif ch in "([":
            depth += 1
            cur.append(ch)
        elif ch in ")]":
            depth -= 1
            cur.append(ch)
        elif ch == "," and depth == 0:
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    if "".join(cur).strip():
        out.append("".join(cur).strip())
    return out


def _plots_of(src):
    """[(title, expression)] for every `plot(expr, title = "t")` / `plot(expr, "t")` call in a script."""
    code, _strings = cm.strip_code(src)
    out = []
    for m in re.finditer(r"(?<![\w.])plot\s*\(", src):
        i, depth = m.end(), 1
        while i < len(src) and depth:
            depth += {"(": 1, ")": -1}.get(src[i], 0)
            i += 1
        args = _split_args(src[m.end():i - 1])
        if not args:
            continue
        title = None
        for a in args[1:]:
            t = re.fullmatch(r"(?:title\s*=\s*)?[\"']([^\"']*)[\"']", a)
            if t:
                title = t.group(1)
                break
        out.append((title, args[0]))
    return out


def compared_plot_items(src, uncompared_titles, inv, untitled_ok=False):
    """The items the COMPARED plots of a purpose-built script exercise: each compared plot's own expression, with a
    plain name expanded to the statement that binds it (`hma20 = ta.hma(close, 20)`; `[a, b] = ta.macd(...)`). A
    plot with no readable title cannot be told apart from an uncompared one, so it credits nothing, unless the
    caller knows NO plot went uncompared (`untitled_ok`: a native capture with an empty `notCompared`)."""
    binds = {}
    for line in src.splitlines():
        t = re.match(r"^\s*\[([\w\s,]+)\]\s*=\s*(.+)$", line)
        if t:
            for nm in re.findall(r"\w+", t.group(1)):
                binds[nm] = t.group(2)
            continue
        b = re.match(r"^\s*(?:var\s+|varip\s+)?(?:(?:float|int|bool|string|color)\s+)?([A-Za-z_]\w*)\s*=(?!=)\s*(.+)$", line)
        if b:
            binds[b.group(1)] = b.group(2)
    texts = []
    for title, expr in _plots_of(src):
        if (title is None and not untitled_ok) or title in uncompared_titles:
            continue
        seen, frontier = set(), [expr]
        while frontier:
            e = frontier.pop()
            texts.append(e)
            for nm in re.findall(r"[A-Za-z_]\w*", e):
                if nm in binds and nm not in seen:
                    seen.add(nm)
                    frontier.append(binds[nm])
    if not texts:
        return set()
    uses, _features = item_uses("//@version=6\n" + "\n".join("plot(%s)" % t for t in texts), inv)
    return uses


def _unmeasured_beyond_colour(value):
    """`notMeasured`: a count in a native capture, a list of names in an adapted one. Colour alone is fine for a
    value comparison (the legacy formats carry no colours); anything else not measured is not a full comparison."""
    if isinstance(value, list):
        return any(str(x) != "colour" for x in value)
    return bool(value)


# What the native harness (`harness-v1`) never measures, by the item's family. The harness compares every plot's
# values bar by bar, plot colours, and the COUNT, TEXT and (paired) COLOUR of drawn objects; its own verdict says
# "coordinates are NOT compared by v1", and sizes, styles, positions and placement are not measured at all. An item
# of these families can therefore be exercised by a MATCH capture without anything about it having been compared.
OBJECT_FAMILIES = frozenset({
    "line", "linefill", "box", "label", "table", "polyline", "chart", "size", "position", "text", "shape",
    "location", "display", "xloc", "yloc", "extend", "font"})
STYLE_PREFIXES = ("plot.style_", "plot.linestyle_", "hline.style_")
COLOUR_FAMILY = "color"


def _family(name):
    return name.split(".", 1)[0]


def _v1_compares(item, result):
    """Whether a `harness-v1` MATCH compared what this item would make the script do.

    Object-family items (and plot styles) need an objects comparison that covers coordinates and styles: none
    does today (`objects.reason` says "coordinates are NOT compared by v1"; a capture whose two sides draw no
    object compared nothing of them). Colour items need colour to have been measured."""
    _kind, name = item
    if name.startswith(STYLE_PREFIXES) or _family(name) in OBJECT_FAMILIES:
        reason = (result.get("objects") or {}).get("reason") or ""
        return bool(reason) and "NOT compared" not in reason and "neither side draws" not in reason
    if _family(name) == COLOUR_FAMILY:
        nm = result.get("notMeasured")
        return not (isinstance(nm, list) and "colour" in nm)
    return True


def _source_digest(src):
    return hashlib.sha1(re.sub(r"\s+", "", src).encode("utf-8")).hexdigest()[:12]


def ingest_vendor(ev, verdicts, lane, inv, capture_lanes=None):
    """Graded MATCH captures, per lane, credited by how the harness compared them.

    A native capture (`harness-v1`) is credited only when EVERY output was compared and agreed (nothing in
    `notCompared`, nothing unmeasured), and then only the items that reach an output the harness actually
    compared: the items of its plots' own expressions (see `compared_plot_items`), never an item that merely
    appears in the source, and no object-family or colour item the harness did not measure (`_v1_compares`).
    A purpose-built observation or probe compares ONE plot against the vendor's reading and lists the rest as
    `notCompared`, so it credits only the items of the plots that WERE compared. For the runtime lane a capture
    counts only when the runtime lane DREW it (a capture the host lane drew says nothing about the runtime lane).
    A capture graded DIVERGE marks its script's digest diverged in that lane (`Evidence.diverged`)."""
    counted = 0
    for r in verdicts.get("results", []):
        if lane == "runtime" and (capture_lanes or {}).get(r["file"]) != "runtime":
            continue
        if r.get("verdict") == "DIVERGE":
            dsrc = capture_source(os.path.join(ROOT, r["file"]))
            if dsrc:
                ev.diverged[lane].add(_source_digest(dsrc))
            continue
        if r.get("verdict") != "MATCH" or _unmeasured_beyond_colour(r.get("notMeasured")):
            continue
        subject = r.get("format") in SUBJECT_FORMATS
        if not subject and r.get("notCompared"):
            continue
        src = capture_source(os.path.join(ROOT, r["file"]))
        if not src:
            continue
        if subject:
            skipped = {x.get("title") for x in (r.get("notCompared") or []) if isinstance(x, dict)}
            uses = compared_plot_items(src, skipped, inv)
        else:
            # nothing in `notCompared`, so every plot was compared, titled or not
            uses = {it for it in compared_plot_items(src, set(), inv, untitled_ok=True) if _v1_compares(it, r)}
        if not uses:
            continue
        counted += 1
        digest = _source_digest(src)
        for it in uses:
            if it[1].startswith(cm.UNGRADED_PREFIXES):
                continue            # the harness grades plots, paints and objects: never orders, alerts or logs
            ev.add_vendor(it, lane, r.get("id") or os.path.basename(r["file"]), subject, digest)
    return counted


def ingest_registry(ev, reg, items, formulas, divergences=None):
    """The hand-kept registry: reference-formula rails and declared differences.

    A rail lifts an item to EXACT only when it compares EVERY bar against a reference formula AND
    the REFERENCE ITSELF publishes a formula for the item (`published_formula`); any other rail is
    recorded as a `defrail` and proves nothing about TradingView. Every cited file must exist."""
    problems = []
    for rail in reg.get("rails", []):
        path = os.path.join(ROOT, rail["test"])
        if not os.path.exists(path):
            problems.append("rail %s: test file %s does not exist" % (rail["id"], rail["test"]))
            continue
        text = open(path, encoding="utf-8").read()
        if rail.get("anchor") and rail["anchor"] not in text:
            problems.append("rail %s: anchor %r not found in %s" % (rail["id"], rail["anchor"], rail["test"]))
            continue
        for kind, name in rail["items"]:
            if (kind, name) not in items:
                problems.append("rail %s: item %s %s is not in the reference" % (rail["id"], kind, name))
                continue
            counts = (bool(formulas.get((kind, name)))
                      and rail.get("scope") == "every-bar"
                      and rail.get("oracle") == "reference-formula")
            (ev.rails if counts else ev.defrails)[(kind, name)][rail["lane"]].append(rail["id"])
    for d in reg.get("knownDifferences", []):
        src = d.get("source") or {}
        if src.get("divergence") and divergences is not None:
            row = next((r for r in divergences.get("rows", []) if r.get("id") == src["divergence"]), None)
            if row is None or row.get("status") not in ("accepted", "open", "suspected"):
                problems.append("difference %s: divergence %s is not an accepted/open/suspected row" % (d["id"], src["divergence"]))
                continue
        if src.get("file"):
            path = os.path.join(ROOT, src["file"])
            if not os.path.exists(path) or (src.get("anchor") and src["anchor"] not in open(path, encoding="utf-8").read()):
                problems.append("difference %s: %s / %r not found" % (d["id"], src["file"], src.get("anchor")))
                continue
        for kind, name in d["items"]:
            if (kind, name) not in items:
                problems.append("difference %s: item %s %s is not in the reference" % (d["id"], kind, name))
                continue
            for lane in d["lanes"]:
                ev.diffs[(kind, name)][lane].append(d["id"])
    return problems


def ingest_probe(ev, row, p, inv, name_kinds):
    """One synthesized probe, asked about ONE item: only that item is credited or blamed.

    A refusal counts against the item only when it is attributable to it: its token IS the item, or
    its line is a line the probe wrote the item on. A refusal on the probe's set-up lines names
    something else (the constructor it needed), so the probe is inconclusive for this item."""
    it = (p["kind"], p["name"])
    target = set(p.get("target_lines") or [])
    h = row.get("host") or {}
    if h and not h.get("threw"):
        if h.get("clean"):
            if p.get("reaches_output", True):       # a statement no output reads is never translated: vacuous
                ev.accept[it]["host"].append(("probe", p["key"]))
        else:
            for r in h.get("refusals") or []:
                if r.get("guard") == TIMEOUT_GUARD:
                    ev.timedOut["host"].append(("probe", p["key"]))
                    continue
                named = resolve_token(r.get("token"), 6, r.get("guard"), inv, name_kinds, r.get("text"))
                # a token that is ANOTHER item (the `str.length` a probe wraps a string in) blames that wrapper's own
                # question, never this item's
                if named == it or (named is None and r.get("line") in target):
                    ev.refuse[it]["host"].append(("probe", r.get("guard") or "unnamed", p["key"]))
            for nm in list(h.get("unsupported") or []) + list(h.get("loopBlockedCalls") or []):
                if resolve_token(nm, 6, None, inv, name_kinds) == it:
                    ev.refuse[it]["host"].append(("probe", "objects:unsupported", p["key"]))
    rt, own = row.get("runtime") or {}, row.get("runtimeOwn") or {}
    if rt and not rt.get("threw"):
        okrow = next((x for x in (rt, own) if x.get("ok")), None)
        if okrow is not None:
            if okrow.get("requests"):
                ev.refuse[it]["runtime"].append(("probe", "runtime:request", p["key"]))
            else:
                ev.accept[it]["runtime"].append(("probe", p["key"]))
        else:
            seen = set()
            for x in (rt, own):
                g = x.get("guard")
                if not g or (g, x.get("line"), x.get("token")) in seen:
                    continue
                seen.add((g, x.get("line"), x.get("token")))
                named = resolve_token(x.get("token"), 6, g, inv, name_kinds, x.get("text"))
                if named == it or (named is None and x.get("line") in target):
                    ev.refuse[it]["runtime"].append(("probe", g, p["key"]))


# ── status ───────────────────────────────────────────────────────────────────
def _count(pairs):
    return dict(sorted(collections.Counter(pairs).items()))


def lane_record(ev, it, lane, unknown=None):
    """One item's answer in one lane, with the evidence it rests on.

    EXACT          a door accepted it in this run AND a rail from the reference's published formula or a
                   fully compared MATCH vendor capture (of a script no capture graded DIVERGE) says it equals
                   TradingView, AND no declared difference
    SUPPORTED      a door accepted it (or a capture proves it) and nothing proves it exact: unproven, or
                   known to differ
    REFUSED        known by name, refused with a guard
    MISSING        refused as a name the lane does not have
    UNANSWERED     no door has been asked about it in a way that answers"""
    acc = ev.accept.get(it, {}).get(lane, [])
    ref = ev.refuse.get(it, {}).get(lane, [])
    vend_all = ev.vendor.get(it, {}).get(lane, [])
    # a script the harness graded DIVERGE on any symbol is no witness on any symbol
    bad = ev.diverged.get(lane, set())
    vend_ok = [v for v in vend_all if v[2] not in bad]
    divergent = {d for _c, _s, d in vend_all if d in bad}
    subject_ids = sorted({c for c, subj, _d in vend_ok if subj})
    script_digests = {d for _c, subj, d in vend_ok if not subj}
    vend = subject_ids if subject_ids else (sorted({c for c, subj, _d in vend_ok if not subj})
                                            if len(script_digests) >= CORROBORATION else [])
    rails = ev.rails.get(it, {}).get(lane, [])
    defr = ev.defrails.get(it, {}).get(lane, [])
    diffs = ev.diffs.get(it, {}).get(lane, [])
    guards = collections.Counter(g for _b, g, _r in ref)
    supported = bool(acc or vend_all or rails)
    guard = None
    if supported:
        # EXACT also needs a door to have accepted the item in THIS run: a lane that refused it every time it was
        # asked does not draw it, whatever a capture's source happens to contain
        status = EXACT if ((vend or rails) and acc and not diffs) else SUPPORTED
    elif ref:
        unknown = (unknown or NAME_UNKNOWN_GUARDS)[lane]
        status = MISSING if set(guards) <= unknown else REFUSED
        pool = {g: n for g, n in guards.items() if g not in unknown} or dict(guards)
        guard = sorted(pool, key=lambda g: (-pool[g], g))[0]
    else:
        status = UNANSWERED
    rec = {"status": status}
    if guard:
        rec["guard"] = guard
    if supported and guards:
        rec["partial"] = True
        rec["refusedAs"] = dict(sorted(guards.items()))
    if diffs:
        rec["knownDifference"] = sorted(set(diffs))
    ev_rec = {}
    if acc:
        ev_rec["accepted"] = _count(b for b, _r in acc)
    if ref and not supported:
        ev_rec["refused"] = dict(sorted(guards.items()))
    if vend_all:
        ev_rec["vendorMatches"] = len({c for c, _s, _d in vend_ok})
        ev_rec["vendorSubjectCaptures"] = len(subject_ids)
        ev_rec["vendorScripts"] = len(script_digests)
        ev_rec["vendor"] = sorted({c for c, _s, _d in vend_ok})[:4]
        if divergent:
            ev_rec["vendorDivergentScripts"] = len(divergent)
        if not vend:
            ev_rec["vendorNotCorroborated"] = True
    if (vend or rails) and not acc and supported and not diffs:
        ev_rec["noDoorAcceptance"] = True
    if rails:
        ev_rec["rails"] = sorted(set(rails))
    if defr:
        ev_rec["definitionRails"] = sorted(set(defr))
    if ev_rec:
        rec["evidence"] = ev_rec
    return rec


def tally(records):
    c = collections.Counter(r["status"] for r in records)
    return {s: c.get(s, 0) for s in STATUSES}


# ── the method, stated once and rendered into both outputs ───────────────────
METHOD = [
    "An ITEM is one entry of TradingView's own Pine v6 reference, one per kind per name: a name that is both a "
    "function and a variable (`time`) is two items, and a METHOD item is the method-call form (`a.push(x)`) of "
    "the function it names. The reference is read locally and never committed; this file carries names, kinds, "
    "counts and guard names only.",
    "TWO LANES, ASKED ABOUT THE SAME SOURCE. HOST is what members get today: the production member door "
    "(`memberPaneDefinition` then `installUserDefinitions`, objects-only pane armed, runtime pane dark). RUNTIME is the "
    "dark per-bar interpreter, asked through its own existing compile check (`probeRuntimeProgram`), in its value "
    "build and its own-drawings build. Nothing here decides what is supported: each answer is what a door said.",
    "SUPPORTED means a door accepted it: a script that uses the item was drawn whole (host: attached, installed, "
    "zero refusals, nothing dropped or withheld; runtime: compiled and reads no other symbol's or timeframe's bars), "
    "or its own probe was accepted, or the engine's declared function of that name was reached through the Pine "
    "door. An order-placing strategy is drawn as its plots only, so it credits no `strategy.*` item.",
    "REFUSED and MISSING need an ATTRIBUTABLE refusal: its token is the item, or it sits on the line a probe wrote the "
    "item on. A refusal on a probe's set-up line names the constructor it needed, so it blames nothing. A refusal about "
    "language (a block, a reassignment, a function body, a type, an import) names no builtin, so it blames the syntax "
    "item the guard is about that is written ON the refused line, and nothing else on the line. A name-unknown guard "
    "(`pine:function`, `pine:builtin` in the host lane; in the runtime lane whatever it answers to the two unknown-name "
    "controls every run asks, with `runtime:unbound` as the floor) is MISSING; any other guard is REFUSED and is named. "
    "The runtime lane names one wall per ask, so a refused script is asked again with each refused line neutralised "
    "(up to eight times); the later walls name items by their token and never credit anything. A wall-clock "
    "timeout (`pine:timeout`) is how long the machine took, not a limit of the script: an ask that ends in one, "
    "whether a script's main attempt or a probe, blames nothing and is unanswered (the walls behind a script's "
    "timed-out main attempt are not read either). An item with no attributable answer is UNANSWERED, never counted "
    "as refused or missing.",
    "EXACT needs proof, and only two kinds count; a door must also have ACCEPTED the item in this run (an item every "
    "ask refused is not drawn, whatever a capture's source contains). (1) A vendor capture the harness graded MATCH, "
    "every output compared (nothing in `notCompared` or `notMeasured`), in THAT lane: the host lane's captures are "
    "the production run's, and a capture counts for the runtime lane only when the runtime lane drew it. The link "
    "from a capture to an item is the item's presence in what the harness COMPARED, not in the source: a native "
    "capture credits only the items of its plots' own expressions (a plot's values are compared bar by bar), and "
    "never an object-family item (line, label, box, table, size, position, text, shape, location, display, xloc, "
    "yloc, extend, chart, plot styles: the harness says \"coordinates are NOT compared by v1\" and measures no sizes, "
    "styles or positions) nor a colour item when colour was not measured. A purpose-built observation or probe "
    "credits the items of its compared plots alone, while a community script captured whole needs TWO distinct "
    "scripts (one script on two symbols is still one script; a script any capture graded DIVERGE, on any symbol, "
    "counts for nothing). An item one such capture touches stays SUPPORTED and is marked not corroborated. (2) A "
    "reference-formula rail from the registry, counted only when it compares every bar AND TradingView's own "
    "reference publishes a formula or a reference implementation for the item. A rail against a definition the "
    "reference does not publish is recorded and proves nothing about TradingView.",
    "A DECLARED DIFFERENCE (the engine's own vendor notes and its accepted or open divergence ledger) keeps an item "
    "at SUPPORTED however many captures matched: a capture that matches in steady state does not erase a documented "
    "difference at the edges.",
    "PARTIAL: an item accepted somewhere and refused elsewhere keeps its best status and carries the guards that "
    "refused it. `request.security` and `array.get` are the usual cases.",
    "Usage counts come from the committed coverage map (679 sample scripts); they only rank. Statuses are re-measured "
    "on the master named above, not read from that map.",
]


# ── build ────────────────────────────────────────────────────────────────────
def _kind_rank(kind):
    return KINDS.index(kind)


def _order(item):
    return (_kind_rank(item[0]), item[1])


def build_scoreboard(ref, coverage, ev, items, formulas, usage, dl, unknown=None):
    """The records, the headline and the ranked lists, from the evidence."""
    recs = []
    for it in sorted(items, key=_order):
        meta = items[it]
        rec = {"kind": it[0], "name": it[1], "namespace": meta["namespace"], "usage": usage.get(it, 0)}
        if formulas.get(it):
            rec["publishedFormula"] = formulas[it]
        if dl.get(it):
            rec["dataLimited"] = dl[it]
        for lane in LANES:
            rec[lane] = lane_record(ev, it, lane, unknown)
        recs.append(rec)
    head = {"items": len(recs), "byLane": {}, "byKind": {}}
    for lane in LANES:
        head["byLane"][lane] = tally(r[lane] for r in recs)
    for kind in KINDS:
        rs = [r for r in recs if r["kind"] == kind]
        head["byKind"][kind] = {"items": len(rs), **{lane: tally(r[lane] for r in rs) for lane in LANES}}
    head["byNamespace"] = {}
    for ns in sorted({r["namespace"] for r in recs}):
        rs = [r for r in recs if r["namespace"] == ns]
        head["byNamespace"][ns] = {"items": len(rs), **{lane: tally(r[lane] for r in rs) for lane in LANES}}
    head["partial"] = {lane: sum(1 for r in recs if r[lane].get("partial")) for lane in LANES}
    head["knownDifference"] = {lane: sum(1 for r in recs if r[lane].get("knownDifference")
                                         and r[lane]["status"] in (EXACT, SUPPORTED)) for lane in LANES}
    ranked = {"refusedOrMissing": {}, "nextRails": {}, "runtimeAdds": [], "knownDifferences": [], "unanswered": {},
              "unansweredTop": {}}
    for lane in LANES:
        bad = [r for r in recs if r[lane]["status"] in (REFUSED, MISSING)]
        bad.sort(key=lambda r: (-r["usage"], _kind_rank(r["kind"]), r["name"]))
        ranked["refusedOrMissing"][lane] = [
            {"kind": r["kind"], "name": r["name"], "usage": r["usage"], "status": r[lane]["status"],
             "guard": r[lane].get("guard"), **({"dataLimited": r["dataLimited"]} if r.get("dataLimited") else {})}
            for r in bad]
        # an item with a declared difference is not "one rail away": no rail lifts it, it is section 5's
        nxt = [r for r in recs if r[lane]["status"] == SUPPORTED and r.get("publishedFormula")
               and not r[lane].get("knownDifference")]
        nxt.sort(key=lambda r: (r["publishedFormula"] != "implementation", -r["usage"], _kind_rank(r["kind"]), r["name"]))
        ranked["nextRails"][lane] = [
            {"kind": r["kind"], "name": r["name"], "usage": r["usage"], "publishedFormula": r["publishedFormula"],
             **({"definitionRails": r[lane]["evidence"]["definitionRails"]}
                if r[lane].get("evidence", {}).get("definitionRails") else {})}
            for r in nxt]
        ranked["unanswered"][lane] = _count(r["kind"] for r in recs if r[lane]["status"] == UNANSWERED)
        top = [r for r in recs if r[lane]["status"] == UNANSWERED and r["usage"]]
        top.sort(key=lambda r: (-r["usage"], _kind_rank(r["kind"]), r["name"]))
        ranked["unansweredTop"][lane] = [{"kind": r["kind"], "name": r["name"], "usage": r["usage"]} for r in top]
    adds = [r for r in recs if r["host"]["status"] in (REFUSED, MISSING, UNANSWERED)
            and r["runtime"]["status"] in (EXACT, SUPPORTED)]
    adds.sort(key=lambda r: (-r["usage"], _kind_rank(r["kind"]), r["name"]))
    ranked["runtimeAdds"] = [{"kind": r["kind"], "name": r["name"], "usage": r["usage"],
                              "hostStatus": r["host"]["status"], "hostGuard": r["host"].get("guard"),
                              "runtimeStatus": r["runtime"]["status"]} for r in adds]
    for r in recs:
        for lane in LANES:
            if r[lane].get("knownDifference") and r[lane]["status"] in (EXACT, SUPPORTED):
                ranked["knownDifferences"].append({"kind": r["kind"], "name": r["name"], "lane": lane,
                                                   "status": r[lane]["status"], "ids": r[lane]["knownDifference"]})
    return recs, head, ranked


def check_controls(plan, prows, unknown):
    """⛔ THE INSTRUMENT'S NON-VACUITY: the same two doors, asked a script that must be accepted and two that
    name something nobody declares. A door that accepted everything, refused everything, or did not answer would
    make every status below it read flat, so a run whose controls disagree writes nothing. The guard each lane
    answers to an unknown name is recorded, and for the runtime lane it is what MISSING means."""
    out = {}
    for key in sorted(k for k, p in plan.items() if p.get("control")):
        row = prows.get(key)
        if row is None:
            sys.exit("the instrument's control %s was never answered - run the probes" % key)
        h, rt, own = row.get("host") or {}, row.get("runtime") or {}, row.get("runtimeOwn") or {}
        hg = sorted({r.get("guard") for r in h.get("refusals") or [] if r.get("guard")} | ({h["guard"]} if h.get("guard") else set()))
        rg = sorted({x.get("guard") for x in (rt, own) if x.get("guard")})
        out[key] = {"hostClean": bool(h.get("clean")), "hostGuards": hg, "runtimeOk": bool(rt.get("ok")), "runtimeGuards": rg}
        if key == "control:good":
            if not (h.get("clean") and rt.get("ok")):
                sys.exit("INSTRUMENT FAILED ITS CONTROL: a known-good script was not accepted by both lanes: %s" % json.dumps(out[key]))
        else:
            if h.get("clean") or rt.get("ok") or not hg or not rg:
                sys.exit("INSTRUMENT FAILED ITS CONTROL: %s must be refused by both lanes with a named guard: %s" % (key, json.dumps(out[key])))
            if key == "control:unknown-function" and not (set(hg) & unknown["host"]):
                sys.exit("INSTRUMENT FAILED ITS CONTROL: %s was refused by the host lane with %s, not a name-unknown guard"
                         % (key, hg))
            unknown["runtime"] |= set(rg)
    return out


def cmd_build(a):
    ref = json.load(open(a.ref, encoding="utf-8"))
    coverage = json.load(open(a.coverage_map, encoding="utf-8"))
    items = reference_items(ref)
    inv = cm.Inventory(ref)
    name_kinds = name_kinds_of(items)
    usage_by_name = {i["name"]: i.get("scriptsUsing", 0) for i in coverage["inventory"]["items"]}
    sample_use = collections.Counter()
    formulas = {it: published_formula(meta) for it, meta in items.items()}
    dl = {it: cm.data_limited(it[1]) for it in items}
    ev = Evidence()
    summary = {"sampleScripts": {}, "examples": {}, "probes": {}, "engineDoor": {}, "captures": {}}

    # 1. the scripts: the sample and TradingView's own whole-script examples
    inputs = json.load(open(a.inputs, encoding="utf-8")) if a.inputs else []
    rows = read_jsonl(a.door_answers)
    kind_of_coll = {"functions": "function", "variables": "variable", "constants": "constant", "types": "type",
                    "keywords": "keyword", "annotations": "annotation", "operators": "operator"}
    per = {"sample": collections.Counter(), "example": collections.Counter()}
    for i in inputs:
        row = rows.get(i["key"])
        if row is None:
            sys.exit("no door answer for %s - run run_language_probe.py over the same inputs" % i["key"])
        src = open(i["path"], encoding="utf-8", errors="replace").read()
        is_ex = i["key"].startswith("example:")
        basis = "example" if is_ex else "sample"
        documented = None
        if is_ex and i.get("collection") in kind_of_coll and (kind_of_coll[i["collection"]], i["item"]) in items:
            documented = (kind_of_coll[i["collection"]], i["item"])
        used = ingest_script(ev, row, src, inv, name_kinds, basis, i["key"], documented)
        if not is_ex:
            sample_use.update(used)
        per[basis]["scripts"] += 1
        h, rt = row.get("host") or {}, row.get("runtime") or {}
        per[basis]["hostClean"] += 1 if h.get("clean") else 0
        per[basis]["hostAttached"] += 1 if h.get("attached") else 0
        per[basis]["runtimeCompiles"] += 1 if (rt.get("ok") or (row.get("runtimeOwn") or {}).get("ok")) else 0
    summary["sampleScripts"] = dict(sorted(per["sample"].items()))
    summary["examples"] = dict(sorted(per["example"].items()))
    usage, same, differs = {}, 0, 0
    for it in items:
        shared = len(name_kinds[it[1]]) > 1 or it[0] == "method"
        if shared and inputs:
            usage[it] = sample_use.get(it, 0)           # a name that is two kinds of item: recounted, by kind
        else:
            usage[it] = usage_by_name.get(it[1], 0)     # the coverage map's own count
            if inputs:
                same, differs = (same + 1, differs) if sample_use.get(it, 0) == usage[it] else (same, differs + 1)
    summary["usageCheck"] = {"sameAsCoverageMap": same, "differs": differs} if inputs else {}

    # 2. the synthesized probes (optional)
    unknown = {lane: set(g) for lane, g in NAME_UNKNOWN_GUARDS.items()}
    if a.probes:
        plan = {p["key"]: p for p in json.load(open(a.probes, encoding="utf-8"))}
        prows = read_jsonl(a.probe_answers)
        n = 0
        for key, p in sorted(plan.items()):
            if key not in prows:
                continue
            if p.get("control"):
                continue
            ingest_probe(ev, prows[key], p, inv, name_kinds)
            n += 1
        summary["probes"] = {"planned": len([p for p in plan.values() if not p.get("control")]), "answered": n}
        summary["controls"] = check_controls(plan, prows, unknown)

    summary["timedOut"] = {"host": {"scripts": sum(1 for b, _k in ev.timedOut["host"] if b != "probe"),
                                    "probes": sum(1 for b, _k in ev.timedOut["host"] if b == "probe")}}

    # 3. the engine's declared functions through the Pine door, both lanes
    for lane, path in (("host", a.engine_door), ("runtime", a.engine_door_runtime)):
        if path:
            door = json.load(open(path, encoding="utf-8"))
            ingest_engine_door(ev, door, lane, items)
            summary["engineDoor"][lane] = {"declared": len(door), "reached": sum(1 for r in door if r.get("pine") == "reachable")}

    # 4. vendor captures, per lane
    clanes = {}
    if a.capture_lanes:
        clanes = {r["file"]: r.get("lane") for r in json.load(open(a.capture_lanes, encoding="utf-8"))["rows"]}
    if a.verdicts:
        v = json.load(open(a.verdicts, encoding="utf-8"))
        n = ingest_vendor(ev, v, "host", inv)
        summary["captures"]["host"] = {"graded": len(v.get("results", [])), "fullMatchesCredited": n,
                                       "verdicts": _count(r.get("verdict") for r in v.get("results", []))}
    if a.runtime_verdicts:
        v = json.load(open(a.runtime_verdicts, encoding="utf-8"))
        n = ingest_vendor(ev, v, "runtime", inv, clanes)
        drawn = sum(1 for r in v.get("results", []) if clanes.get(r.get("file")) == "runtime")
        summary["captures"]["runtime"] = {"graded": len(v.get("results", [])), "drawnByRuntimeLane": drawn,
                                          "fullMatchesCredited": n,
                                          "verdicts": _count(r.get("verdict") for r in v.get("results", []))}

    # 5. the registry
    reg = json.load(open(a.registry, encoding="utf-8"))
    divergences = json.load(open(a.divergences, encoding="utf-8")) if a.divergences and os.path.exists(a.divergences) else None
    problems = ingest_registry(ev, reg, items, formulas, divergences)
    if problems:
        sys.exit("registry problems:\n  " + "\n  ".join(problems))

    recs, head, ranked = build_scoreboard(ref, coverage, ev, items, formulas, usage, dl, unknown)
    out = {
        "schema": "uct.pine-language-coverage/v1",
        "generatedBy": "tools/pine_coverage/language_coverage.py",
        "measuredOn": a.measured_on, "masterSha": a.master_sha,
        "method": METHOD,
        "inputs": summary,
        "usageSource": {"file": "docs/pine/coverage-map.json", "measuredOn": coverage.get("measuredOn"),
                        "masterSha": coverage.get("masterSha"), "sampleScripts": coverage["headline"]["sample"]},
        "headline": head,
        "ranked": ranked,
        "items": recs,
    }
    write_json(a.out, out)
    if getattr(a, "emit_unanswered", None):
        write_json(a.emit_unanswered, [[r["kind"], r["name"]] for r in recs
                                       if any(r[lane]["status"] == UNANSWERED for lane in LANES)])
    if a.md:
        with open(a.md, "w", encoding="utf-8", newline="\n") as f:
            f.write(render_md(out))
    h = head["byLane"]
    print("ITEMS %d" % head["items"])
    for lane in LANES:
        print("  %-8s %s" % (lane, json.dumps(h[lane])))
    return out


# ── the markdown ─────────────────────────────────────────────────────────────
STATUS_LABEL = {EXACT: "exact", SUPPORTED: "supported, unproven", REFUSED: "refused", MISSING: "missing",
                UNANSWERED: "unanswered"}
LANE_SHORT = {"host": "host lane", "runtime": "runtime lane"}


def _md_table(headers, rows):
    """A markdown table; a column whose cells are all numbers (or blank) is right-aligned, the rest left."""
    def numeric(col):
        cells = [str(r[col]) for r in rows if str(r[col]) != ""]
        return bool(cells) and all(c.replace(",", "").replace(".", "", 1).replace("%", "").lstrip("-").isdigit() for c in cells)
    marks = ["---:" if numeric(i) else "---" for i in range(len(headers))]
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join(marks) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(c) for c in r) + " |")
    return out


def _pct(n, d):
    return "%.1f%%" % (100.0 * n / d) if d else "-"


def _cell(name):
    return "`%s`" % name.replace("|", "\\|")


def render_md(out):
    head = out["headline"]
    M = head["items"]
    h, r = head["byLane"]["host"], head["byLane"]["runtime"]
    L = []
    L.append("# Pine language coverage: which Pine v6 items work exactly, per lane")
    L.append("")
    L.append("Measured %s on master `%s`. Machine-readable twin: [`language-coverage-2026-11-02.json`](language-coverage-2026-11-02.json). "
             "Built by `tools/pine_coverage/language_coverage.py` (re-run: [How to re-run](#how-to-re-run))." % (
                 out.get("measuredOn") or "(undated)", (out.get("masterSha") or "unknown")[:10]))
    L.append("")
    L.append("Owner goal: paste ANY open-source Pine indicator and get what TradingView draws. The coverage map ranks which "
             "language features block real scripts. This page is the other half: of every item in TradingView's own Pine v6 "
             "reference (%d of them), which does each lane draw **exactly**, which is merely accepted with nothing to prove "
             "it, which is refused by name, and which the lane has never heard of." % M)
    L.append("")
    L.append("## 1. Headline")
    L.append("")
    L.append("> **Host lane (what members get today): %d of %d reference items are EXACT (%s).** %d more are supported but "
             "unproven, %d are refused by a named guard, %d are missing, %d could not be answered."
             % (h[EXACT], M, _pct(h[EXACT], M), h[SUPPORTED], h[REFUSED], h[MISSING], h[UNANSWERED]))
    L.append(">")
    L.append("> **Runtime lane (dark): %d of %d are EXACT (%s).** %d supported but unproven, %d refused, %d missing, %d unanswered."
             % (r[EXACT], M, _pct(r[EXACT], M), r[SUPPORTED], r[REFUSED], r[MISSING], r[UNANSWERED]))
    L.append("")
    L.append("**EXACT is a high bar and deliberately so.** It needs a door to have accepted the item in this run AND either a "
             "TradingView capture the harness graded MATCH with every output compared, crediting only the items that reach an "
             "output the harness compared, or a rail built from a formula TradingView itself publishes; it is withheld from "
             "any item with a declared difference. \"Supported, unproven\" is the honest word for an item a lane draws that nothing "
             "has yet been shown to match: it is not a defect, it is the evidence queue.")
    L.append("")
    rows = []
    for lane in LANES:
        t = head["byLane"][lane]
        rows.append([LANE_LABEL[lane], t[EXACT], t[SUPPORTED], t[REFUSED], t[MISSING], t[UNANSWERED],
                     head["partial"][lane], head["knownDifference"][lane]])
    L += _md_table(["lane", "exact", "supported, unproven", "refused", "missing", "unanswered", "of which partial", "of which known difference"], rows)
    L.append("")
    L.append("`partial` counts items accepted somewhere and refused elsewhere (they keep their best status). `known difference` "
             "counts supported items (exact or supported, unproven) that carry a declared difference. Both are inside the status columns, not extra.")
    L.append("")
    L.append("### 1.1 Per kind")
    L.append("")
    rows = []
    for kind in KINDS:
        k = head["byKind"][kind]
        if not k["items"]:
            continue
        for lane in LANES:
            t = k[lane]
            rows.append([kind if lane == "host" else "", k["items"] if lane == "host" else "", LANE_SHORT[lane], t[EXACT],
                         t[SUPPORTED], t[REFUSED], t[MISSING], t[UNANSWERED]])
    L += _md_table(["kind", "items", "lane", "exact", "supported, unproven", "refused", "missing", "unanswered"], rows)
    L.append("")
    L.append("### 1.2 Per namespace (the 15 largest; every namespace is in the JSON, `headline.byNamespace`)")
    L.append("")
    rows = []
    big = sorted(head["byNamespace"].items(), key=lambda kv: (-kv[1]["items"], kv[0]))[:15]
    for ns, k in big:
        for lane in LANES:
            t = k[lane]
            rows.append([("`%s`" % ns) if lane == "host" else "", k["items"] if lane == "host" else "", LANE_SHORT[lane],
                         t[EXACT], t[SUPPORTED], t[REFUSED], t[MISSING], t[UNANSWERED]])
    L += _md_table(["namespace", "items", "lane", "exact", "supported, unproven", "refused", "missing", "unanswered"], rows)
    L.append("")
    inp = out["inputs"]
    L.append("### 1.3 What the numbers rest on")
    L.append("")
    s, e = inp.get("sampleScripts") or {}, inp.get("examples") or {}
    if s:
        L.append("- **%d sample scripts** put to both doors: the host lane drew %d whole, attached %d; the runtime lane compiled %d."
                 % (s.get("scripts", 0), s.get("hostClean", 0), s.get("hostAttached", 0), s.get("runtimeCompiles", 0)))
    if e:
        L.append("- **%d TradingView whole-script examples** (the reference's own usage of each item): host drew %d whole; "
                 "the runtime lane compiled %d." % (e.get("scripts", 0), e.get("hostClean", 0), e.get("runtimeCompiles", 0)))
    if inp.get("probes"):
        L.append("- **%d synthesized single-item probes** planned, %d answered." % (inp["probes"]["planned"], inp["probes"]["answered"]))
    ctl = inp.get("controls") or {}
    if ctl:
        good = ctl.get("control:good") or {}
        fn = ctl.get("control:unknown-function") or {}
        var = ctl.get("control:unknown-variable") or {}
        L.append("- **The instrument's controls** (a run that fails any of them writes nothing): a known-good script was accepted by both "
                 "lanes (%s); an unknown function was refused by the host lane with %s and by the runtime lane with %s; an unknown "
                 "variable with %s and %s." % (
                     "yes" if good.get("hostClean") and good.get("runtimeOk") else "NO",
                     ", ".join("`%s`" % g for g in fn.get("hostGuards", [])) or "nothing",
                     ", ".join("`%s`" % g for g in fn.get("runtimeGuards", [])) or "nothing",
                     ", ".join("`%s`" % g for g in var.get("hostGuards", [])) or "nothing",
                     ", ".join("`%s`" % g for g in var.get("runtimeGuards", [])) or "nothing"))
    to = (inp.get("timedOut") or {}).get("host") or {}
    if to.get("scripts") or to.get("probes"):
        L.append("- **Wall-clock timeouts**: %d host-lane script asks and %d probes ended in `pine:timeout` (how long this machine "
                 "took, not a fact about the script); they blame nothing and count as unanswered." % (to.get("scripts", 0), to.get("probes", 0)))
    for lane in LANES:
        d = (inp.get("engineDoor") or {}).get(lane)
        if d:
            L.append("- **Engine table through the Pine door, %s**: %d of the engine's %d declared functions reached."
                     % (LANE_SHORT[lane], d["reached"], d["declared"]))
    for lane in LANES:
        c = (inp.get("captures") or {}).get(lane)
        if c:
            extra = (", %d drawn by the runtime lane" % c["drawnByRuntimeLane"]) if "drawnByRuntimeLane" in c else ""
            L.append("- **Vendor captures, %s**: %d graded %s%s; %d fully compared MATCHes credited at least one item."
                     % (LANE_SHORT[lane], c["graded"], json.dumps(c["verdicts"]).replace('"', ""), extra, c["fullMatchesCredited"]))
    us = out["usageSource"]
    chk = inp.get("usageCheck") or {}
    L.append("- **Usage counts** (ranking only) from `%s`: %d sample scripts, measured %s at `%s`; a name that is two kinds of "
             "item (a cast and a type, a function and a variable) and every method are recounted by kind over the same scripts%s."
             % (us["file"], us["sampleScripts"], us.get("measuredOn"), (us.get("masterSha") or "")[:10],
                (" (for the other items this run's recount agrees with the map on %d and differs on %d)"
                 % (chk["sameAsCoverageMap"], chk["differs"])) if chk else ""))
    L.append("")
    L.append("## 2. How an item gets its status")
    L.append("")
    for m in out["method"]:
        L.append("- " + m)
    L.append("")
    L.append("## 3. The top refused and missing items, by how many sample scripts use them")
    L.append("")
    ranked = out["ranked"]
    for lane in LANES:
        lst = ranked["refusedOrMissing"][lane]
        L.append("### 3.%d %s: %d items refused or missing" % (LANES.index(lane) + 1, LANE_SHORT[lane], len(lst)))
        L.append("")
        rows = [[_cell(x["name"]), x["kind"], x["usage"], STATUS_LABEL[x["status"]], "`%s`" % x["guard"] if x.get("guard") else "",
                 "data we do not hold" if x.get("dataLimited") else ""] for x in lst[:25]]
        L += _md_table(["item", "kind", "scripts using it", "status", "guard", "note"], rows)
        L.append("")
    L.append("### 3.3 What arming the runtime lane would add")
    L.append("")
    adds = ranked["runtimeAdds"]
    L.append("%d items the host lane refuses, misses or cannot answer and the runtime lane accepts, by sample-script use "
             "(association, not attribution: the runtime lane may reach them through a statement the host lane lacks)." % len(adds))
    L.append("")
    rows = [[_cell(x["name"]), x["kind"], x["usage"], STATUS_LABEL[x["hostStatus"]],
             "`%s`" % x["hostGuard"] if x.get("hostGuard") else "", STATUS_LABEL[x["runtimeStatus"]]] for x in adds[:20]]
    L += _md_table(["item", "kind", "scripts using it", "host lane", "host guard", "runtime lane"], rows)
    L.append("")
    L.append("## 4. The next conformance rails: supported, unproven, and TradingView publishes the formula")
    L.append("")
    L.append("Each of these is one rail away from EXACT (items with a declared difference are in section 5 instead: no rail lifts them): the reference carries a Pine reimplementation (`implementation`) or "
             "states the calculation (`stated`), so a test can difference our column against it with no capture. "
             "Implementations first, then by use. A `definition rail` is a rail that already compares to a definition the "
             "reference does not publish (informative, not proof).")
    L.append("")
    for lane in LANES:
        lst = ranked["nextRails"][lane]
        L.append("### 4.%d %s: %d items" % (LANES.index(lane) + 1, LANE_SHORT[lane], len(lst)))
        L.append("")
        rows = [[_cell(x["name"]), x["kind"], x["usage"], x["publishedFormula"],
                 "definition rail: " + ", ".join(x["definitionRails"]) if x.get("definitionRails") else ""]
                for x in lst[:40]]
        L += _md_table(["item", "kind", "scripts using it", "formula", "note"], rows)
        if len(lst) > 40:
            L.append("")
            L.append("(%d more in the JSON, `ranked.nextRails.%s`.)" % (len(lst) - 40, lane))
        L.append("")
    L.append("## 5. Supported, but known to differ from TradingView")
    L.append("")
    kd = ranked["knownDifferences"]
    if kd:
        rows = [[_cell(x["name"]), x["kind"], LANE_SHORT[x["lane"]], STATUS_LABEL[x["status"]], ", ".join(x["ids"])] for x in kd]
        L += _md_table(["item", "kind", "lane", "status", "declared difference"], rows)
    else:
        L.append("None registered.")
    L.append("")
    L.append("## 6. Items no door has answered")
    L.append("")
    for lane in LANES:
        u = ranked["unanswered"][lane]
        L.append("- **%s**: %d unanswered (%s)." % (LANE_SHORT[lane], sum(u.values()),
                 ", ".join("%s %d" % (k, n) for k, n in u.items()) or "none"))
    L.append("")
    L.append("An unanswered item is not counted as refused or missing: no script, example or probe put it to a door in a way "
             "that answers, so the honest word is that nobody has asked. They are listed per item in the JSON. The ones real "
             "scripts DO use (usually because every script that uses them is stopped by another wall first) are the queue for "
             "the next probe pass:")
    L.append("")
    for lane in LANES:
        top = ranked["unansweredTop"][lane]
        L.append("- **%s**, %d used items, the busiest: %s." % (LANE_SHORT[lane], len(top),
                 ", ".join("%s (%s, %d)" % (_cell(x["name"]), x["kind"], x["usage"]) for x in top[:12]) or "none"))
    L.append("")
    L.append("## 7. What this cannot see")
    L.append("")
    L.append("- **Door acceptance is not numeric parity.** SUPPORTED means a lane drew it; only EXACT says it equals TradingView, "
             "and only on the evidence named in the JSON for that item and lane.")
    L.append("- **A capture MATCH credits only what the harness compared.** A native capture credits the items of its plots' own "
             "expressions (`plot(...)`, with a plain name followed to the statement that binds it), and no object-family or colour "
             "item the harness did not measure. An item reached only through a function body, a loop, or a plotshape / plotchar / "
             "bgcolor argument is not followed, so it is under-credited rather than over-credited; the harness compares no "
             "object coordinates, sizes or styles, so those items stay SUPPORTED until a capture or rail measures them.")
    L.append("- **The runtime lane is asked only through its compile check.** It declines later (a request for other bars, the "
             "starter allowlist, a repaint class it cannot state) are not visible here beyond `runtime:request`.")
    L.append("- **Real scripts under-use the language**: items nobody wrote into a sample script rest on their probe or TradingView's "
             "own example, and the rest are listed as unanswered.")
    L.append("- **The rail registry is a seed**, not a census of every test in the repo: it lists rails whose items and oracle were "
             "read in full. Every other rail is a candidate for the next pass.")
    L.append("")
    L.append("## 8. How the programme uses it")
    L.append("")
    L.append("- **Re-run it after every merged wave** and diff the JSON: the exact counts and the supported counts should only "
             "move up. A REFUSED or MISSING item turning SUPPORTED is that wave's win; a SUPPORTED item falling to REFUSED is a "
             "regression the sample census would not have named.")
    L.append("- **The conformance queue is section 4**: every item there is one test away from EXACT with no capture needed. "
             "The capture queue (`docs/pine/capture-queue-*.md`) is for the supported items TradingView publishes no formula "
             "for.")
    L.append("- **The walls are section 3**, ranked by what real scripts use, per lane, with the guard that refuses each. "
             "Section 3.3 is what arming the runtime lane would buy today.")
    L.append("- **Never read a status as parity.** EXACT is a claim with a named witness; SUPPORTED is only that a door draws it.")
    L.append("")
    L.append("## How to re-run")
    L.append("")
    L.append("```sh")
    L.append("source docs/pine/parity-programme/scripts/env-laptop.sh        # UCT_PY, UCT_RESUME, hl")
    L.append("R=$UCT_RESUME/runs/lang; mkdir -p $R")
    L.append("python tools/pine_coverage/language_coverage.py inputs --cache $UCT_RESUME/pine-sample \\")
    L.append("    --ref $UCT_RESUME/runs/C/ref_rebuilt.json --out-dir $R/in")
    L.append("cd app")
    L.append("# the engine's declared functions through the Pine door: host lane, then the runtime twin, then the capture lanes")
    L.append("COVERAGE_DOOR_OUT=$R/engine_door.json hl door -- node node_modules/vitest/vitest.mjs run \\")
    L.append("    src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js --maxWorkers=2")
    L.append("LANGUAGE_COVERAGE_DOOR_RUNTIME_OUT=$R/engine_door_runtime.json hl door-rt -- node node_modules/vitest/vitest.mjs run \\")
    L.append("    src/components/chart/engine/ast/languageCoverageDoors.measure.test.js --maxWorkers=2")
    L.append("LANGUAGE_COVERAGE_CAPTURE_LANES_OUT=$R/capture_lanes.json hl lanes -- node node_modules/vitest/vitest.mjs run \\")
    L.append("    src/components/chart/engine/ast/languageCoverageDoors.measure.test.js --maxWorkers=2")
    L.append("# the vendor harness, each lane")
    L.append("VENDOR_HARNESS_RUNTIME_ON=0 VENDOR_HARNESS_OUT=$R/harness-prod hl h0 -- node node_modules/vitest/vitest.mjs run \\")
    L.append("    src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=2")
    L.append("VENDOR_HARNESS_RUNTIME_ON=1 VENDOR_HARNESS_OUT=$R/harness-rt hl h1 -- node node_modules/vitest/vitest.mjs run \\")
    L.append("    src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=2")
    L.append("cd ..")
    L.append("# the sample and the examples through both lanes")
    L.append("hl probe -- python tools/pine_coverage/run_language_probe.py --inputs $R/in/inputs.json --out $R/in-rows.jsonl")
    L.append("# the single-item probes (plus the three controls) through both lanes")
    L.append("python tools/pine_coverage/language_coverage.py probes --ref $UCT_RESUME/runs/C/ref_rebuilt.json --out $R/probes.json")
    L.append("hl probe-items -- python tools/pine_coverage/run_language_probe.py --inputs $R/probes.json --out $R/probe-rows.jsonl")
    L.append("python tools/pine_coverage/language_coverage.py build --ref $UCT_RESUME/runs/C/ref_rebuilt.json \\")
    L.append("    --coverage-map docs/pine/coverage-map.json --inputs $R/in/inputs.json --door-answers $R/in-rows.jsonl \\")
    L.append("    --probes $R/probes.json --probe-answers $R/probe-rows.jsonl \\")
    L.append("    --engine-door $R/engine_door.json --engine-door-runtime $R/engine_door_runtime.json \\")
    L.append("    --verdicts $R/harness-prod/verdicts.json --runtime-verdicts $R/harness-rt/verdicts.json \\")
    L.append("    --capture-lanes $R/capture_lanes.json --measured-on <date> --master-sha <sha> \\")
    L.append("    --out docs/pine/language-coverage-2026-11-02.json --md docs/pine/LANGUAGE-COVERAGE-2026-11-02.md")
    L.append("```")
    L.append("")
    L.append("Deterministic: same inputs, same bytes (sorted keys, no clock). No network. The reference and the sample are "
             "licence-held and read locally; only names, kinds, counts and guard names are written.")
    L.append("")
    return "\n".join(L)


# ── probes: the single-item questions that fill in what no script asked ─────
# ⛔ The coverage census learned the hard way that a probe we construct measures the PROBE as often
# as the item (`constructCoverage.test.js`: the first attempt reported that Pine cannot take a lag-1
# recurrence, which is false). So a probe here is the smallest program that USES the item the way
# the reference's own signature says to, it is asked ONLY about that item, a refusal blames the item
# only when it is attributable (see `ingest_probe`), and a host acceptance counts only when the
# item feeds an output (the host translator is demand-driven: a statement no output reads is never
# translated, so "accepted" would be vacuous). Anything the planner cannot spell stays UNANSWERED.
PROBE_HEADER = ['//@version=6', 'indicator("language probe", overlay = true)']
QUALIFIERS = ("series ", "simple ", "input ", "const ")
LEN_NAMES = {"length", "len", "period", "periods", "bars", "count", "window", "lookback", "lookbackbars", "numbars"}
SHORT_NAMES = {"leftbars", "rightbars", "left", "right"}
IDX_NAMES = {"index", "pos", "row", "col", "column", "offset", "from", "to", "begin_pos", "end_pos", "from_index", "to_index"}
STRING_BY_NAME = {"timeframe": '"D"', "symbol": '"AAPL"', "ticker": '"AAPL"', "tickerid": '"AAPL"', "session": '"0930-1600"',
                  "timezone": '"America/New_York"', "format": '"#.##"', "currency": '"USD"'}
# the constant types that name an argument slot the reference spells for us
ENUM_BASES = ("plot_style", "plot_display", "hline_style", "plot_line_style", "size", "location", "shape", "position", "xloc",
              "yloc", "extend", "display", "barmerge_gaps", "barmerge_lookahead", "scale_type", "font_family", "order",
              "text_format", "settlement", "backadjustment", "adjustment")


def _bases(allowed):
    out = []
    for t in allowed or []:
        for q in QUALIFIERS:
            if t.startswith(q):
                t = t[len(q):]
        if t not in out:
            out.append(t)
    return out


def _const_by_type(ref):
    out = collections.defaultdict(list)
    for e in ref.get("constants", []):
        t = str(e.get("type") or "")
        for q in QUALIFIERS:
            if t.startswith(q):
                t = t[len(q):]
        out[t].append(e["name"])
    return {k: sorted(v) for k, v in out.items()}


def value_for(arg, consts):
    """A literal or series expression for one reference argument, or None (the planner cannot spell it)."""
    allowed = arg.get("allowedTypeIDs") or []
    bases = _bases(allowed)
    name = str(arg.get("name") or "").lower()
    series = any(t.startswith("series ") for t in allowed)
    if "float" in bases or "int" in bases:
        if name in LEN_NAMES:
            return "14"
        if name in SHORT_NAMES:
            return "2"
        if name in IDX_NAMES:
            return "0"
        if series and "float" in bases:
            return "close"
        return "1.0" if "float" in bases and "int" not in bases else "2"
    if "bool" in bases:
        return "close > open" if series else "true"
    if "string" in bases:
        return STRING_BY_NAME.get(name, '"x"')
    if "color" in bases:
        return "color.red"
    for b in bases:
        if b in ENUM_BASES and consts.get(b):
            return consts[b][0]
    return None


def _call_args(entry, consts):
    """The required arguments of one reference overload, spelled; None when any cannot be."""
    vals = []
    for arg in entry.get("args") or []:
        if not arg.get("required"):
            continue
        v = value_for(arg, consts)
        if v is None:
            return None
        vals.append(v)
    return vals


def _unqualified(t):
    t = (t or "").strip()
    qual = ""
    for q in QUALIFIERS:
        if t.startswith(q):
            qual, t = q.strip(), t[len(q):]
    return qual, t


def _wrap(call, ret, varies):
    """How a returned value reaches an output, by its reference type: (source lines, output-reaching).

    ⛔ An output that cannot vary is refused as `pine:constant-only` with no token, which says nothing about the item
    asked: `plot(math.pi)` measures the plot, not `math.pi`. So a value that is not a series is added to `close`, and
    a bool that is not a series picks between two series."""
    qual, t = _unqualified(ret)
    series = varies or qual == "series"
    if t in ("int", "float"):
        return (["plot(%s)" % call] if series else ["plot(close + %s)" % call]), True
    if t == "bool":
        return (["plot(%s ? 1 : 0)" % call] if series else ["plot(%s ? close : open)" % call]), True
    if t == "color":
        return ["plot(close, color = %s)" % call], True
    if t == "string":
        return ["plot(str.length(%s))" % call], True
    return None, False


def plan_probe(item, consts):
    """The probes for one item: [{variant, lines, target, reaches}] (possibly none).

    Only value-returning functions, plain variables and plain constants are planned: the families
    that need a handle or a collection built first (`line.*`, `array.*`, `matrix.*`, `map.*`,
    `table.*`) would be blamed or credited for their constructor, so they stay with the examples and
    the sample scripts."""
    kind, name = item["kind"], item["name"]
    out = []
    # ⛔ `strategy.*` is a compile error in an `indicator()` on TradingView and `runtime.*` ends the run: a probe
    # for either would measure the wrong program, so those items are answered by the scripts that use them.
    if item["namespace"] in ("strategy", "runtime"):
        return out
    if kind == "function":
        best = None
        for e in item["entries"]:
            args = _call_args(e, consts)
            if args is None:
                continue
            ret = (e.get("returnedTypes") or [None])[0]
            varies = any(re.search(r"\bclose\b", a) for a in args)
            lines, reaches = _wrap("%s(%s)" % (name, ", ".join(args)), ret, varies)
            if lines is None:
                continue
            # the fewest arguments, then the overload whose arguments make the output VARY
            key = (len(args), 0 if varies else 1)
            if best is None or key < best[0]:
                best = (key, lines, reaches)
        if best:
            out.append({"variant": "call", "lines": best[1], "reaches": best[2]})
    elif kind in ("variable", "constant"):
        typ = str(item["entries"][0].get("type") or "")
        _qual, base = _unqualified(typ)
        # a string CONSTANT (`location.abovebar`, `currency.USD`, `format.price`) is an argument to one
        # particular call; wrapping it in `str.length` would measure that wrapper, not the constant
        if kind == "constant" and base == "string":
            return out
        lines, reaches = _wrap(name, typ, False)
        if lines is None and kind == "constant":
            slot = {"plot_style": "plot(close, style = %s)", "plot_display": "plot(close, display = %s)",
                    "plot_line_style": "plot(close, linestyle = %s)"}.get(base)
            if slot:
                lines, reaches = [slot % name], True
            elif base == "hline_style":
                # `hline` is presentation: the pane needs a plot of its own, and an accepted `hline` feeds no output
                lines, reaches = ["plot(close)", "hline(0, linestyle = %s)" % name], False
        if lines:
            out.append({"variant": "use", "lines": lines, "reaches": reaches})
    return out


def cmd_probes(a):
    """Probes for the items stage 1 left UNANSWERED in some lane."""
    ref = json.load(open(a.ref, encoding="utf-8"))
    items = reference_items(ref)
    consts = _const_by_type(ref)
    wanted = json.load(open(a.wanted, encoding="utf-8")) if a.wanted else None
    plan = []
    for it in sorted(items, key=_order):
        if wanted is not None and ["%s" % it[0], it[1]] not in wanted:
            continue
        for n, p in enumerate(plan_probe(items[it], consts)):
            lines = PROBE_HEADER + p["lines"]
            plan.append({
                "key": "probe:%s:%s#%s" % (it[0], it[1], p["variant"]), "kind": it[0], "name": it[1],
                "source": "\n".join(lines) + "\n", "target_lines": [len(PROBE_HEADER) + len(p["lines"])],
                "reaches_output": p["reaches"],
            })
    head = "\n".join(PROBE_HEADER) + "\n"
    plan += [
        {"key": "control:good", "control": True, "source": head + "plot(ta.sma(close, 14))\n"},
        {"key": "control:unknown-function", "control": True, "source": head + "plot(ta.language_probe_no_such(close))\n"},
        {"key": "control:unknown-variable", "control": True, "source": head + "plot(ta.language_probe_no_such_variable)\n"},
    ]
    plan.sort(key=lambda p: p["key"])
    write_json(a.out, plan)
    print("probes: %d for %d items, plus 3 controls -> %s" % (
        len(plan) - 3, len({(p["kind"], p["name"]) for p in plan if not p.get("control")}), a.out))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("inputs")
    p.add_argument("--cache", required=True, help="the pine-sample cache (sample_manifest.json + builtin/ + reference/)")
    p.add_argument("--ref", required=True, help="the Pine v6 reference json (licence-held: read only)")
    p.add_argument("--out-dir", required=True)
    p.set_defaults(fn=cmd_inputs)
    p = sub.add_parser("build")
    p.add_argument("--ref", required=True)
    p.add_argument("--coverage-map", required=True)
    p.add_argument("--inputs")
    p.add_argument("--door-answers", action="append", default=[])
    p.add_argument("--probes")
    p.add_argument("--probe-answers", action="append", default=[])
    p.add_argument("--engine-door")
    p.add_argument("--engine-door-runtime")
    p.add_argument("--verdicts")
    p.add_argument("--runtime-verdicts")
    p.add_argument("--capture-lanes")
    p.add_argument("--registry", default=os.path.join(HERE, "language_coverage_registry.json"))
    p.add_argument("--divergences", default=os.path.join(ROOT, "tests", "fixtures", "vendor", "divergences.json"))
    p.add_argument("--measured-on", default=None)
    p.add_argument("--master-sha", default=None)
    p.add_argument("--out", required=True)
    p.add_argument("--md")
    p.add_argument("--emit-unanswered", help="write the [kind, name] of every item still unanswered in some lane")
    p.set_defaults(fn=cmd_build)
    p = sub.add_parser("probes")
    p.add_argument("--ref", required=True)
    p.add_argument("--wanted", help="json [[kind, name], ...] (build --emit-unanswered); default every item")
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_probes)
    a = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    a.fn(a)


if __name__ == "__main__":
    main()
