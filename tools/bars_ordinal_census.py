"""D2 CP5 (closes F-D2-3) — the ordinal-fragility inventory. DETECTION ONLY.

⛔ APPROVED SCOPE (owner, 2026-09-22), verbatim: "an AST sweep that finds every
call to a function returning the (ts,o,h,l,c,v) shape (bars_sqlite.get_bars/
get_bars_before/get_bars_since, extendable if more are found) and classifies
each consumer as named-access (goes through address_book.row_position or an
equivalent declared accessor) or positional (bare integer index / unpack).
Refuses rather than guesses on an ambiguous call site... No schema change on
any live store. No production reader's runtime behavior changes."

⛔⛔ THIS IS A MODULE-LEVEL CENSUS, NOT A CALL-SITE-LEVEL ONE, AND THAT IS A
MEASURED CHOICE, NOT A SHORTCUT. `bars_fetch.py` calls `get_bars_before` in one
function and unpacks the result via `for ts,o,h,l,c,v in rows:` in a DIFFERENT
function (`_fmt_sqlite_bars`, called with the fetched rows as a parameter).
Tracing that link would need real interprocedural dataflow analysis — this
tool does not attempt it. Instead it asks a narrower, still-honest question per
MODULE: does this module call a bars-family function, AND does it ALSO,
anywhere in it, either (a) call `row_position` (named-access), or (b) show the
positional-unpack shape (a 5/6-element tuple unpack, or an integer-literal
subscript)? A module showing neither is UNCLASSIFIED and fails the build
rather than being silently marked either way.

⛔ CODE, NEVER PROSE. Every AST walk below inspects executable nodes
(ast.Call, ast.Assign, ast.For, ast.Subscript) — never string contents — so a
docstring or comment that merely MENTIONS "get_bars(...)" or "row[4]" cannot
manufacture a false positive the way a text/regex scan could.

Usage:
    python tools/bars_ordinal_census.py            # write api/data/bars_ordinal_census.json
    python tools/bars_ordinal_census.py --check    # exit 1 if stale
"""
from __future__ import annotations

import argparse
import ast
import json
import pathlib
import sys

_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

OUT_PATH = _ROOT / "api" / "data" / "bars_ordinal_census.json"
SCHEMA_VERSION = 1

#: The bars-family functions this census tracks. Extendable (per the approved
#: scope) if a fourth function returning the same shape is ever added to
#: bars_sqlite.py — nothing else in this file needs to change.
_BARS_FAMILY_FUNCS = frozenset({"get_bars", "get_bars_before", "get_bars_since"})

#: A row's shape is (ts, o, h, l, c, v) — 6 elements. A 5-element unpack
#: (dropping one column, e.g. `_ts,o,h,l,c` with v discarded via `*_`) is
#: deliberately ALSO counted: it is still an ordinal dependency on the same
#: projection, just one that drops a trailing column instead of naming it.
_UNPACK_SIZES = frozenset({5, 6})

#: Constant-index subscripts in this range are the ordinal positions a real
#: bars row can occupy (0=ts .. 5=v). A subscript outside this range (e.g. a
#: date-keyed dict lookup elsewhere in the same module) is not evidence.
_ORDINAL_INDEX_RANGE = frozenset(range(0, 6))

#: Directories under api/ this census walks. Scoped to api/ because every
#: enumerated positional consumer (per the proposal's own sources list) is
#: backend Python; bars_sqlite.py itself and the canonical/ package are
#: excluded — they DECLARE and ADDRESS the shape, they do not consume it as a
#: positional reader.
_EXCLUDE_MODULES = frozenset({
    "api/services/bars_sqlite.py",
    "api/services/canonical/address_book.py",
    "api/services/canonical/dual_read.py",
})

#: Known cross-module delegates that consume a bars row by fixed ordinal
#: position — confirmed by direct source read (`bars_fetch.py`'s
#: `_fmt_sqlite_bars`, which does `for ts, o, h, l, c, v in rows:`), NOT by
#: name-pattern guessing. A module that fetches bars and hands the raw rows to
#: one of these is a positional consumer BY DELEGATION even though the unpack
#: itself lives in a different file — e.g. `api/routers/screener_backtest.py`
#: calls `bars_sqlite.get_bars_before(...)` then `bars_fetch._fmt_sqlite_bars
#: (rows, tf, sym)` in the SAME statement, and the unpack is invisible to a
#: scan of screener_backtest.py alone.
#: ⛔ This is a citation of an already-audited fact, not a second guess — if a
#: future delegate is added here, it must first be read and confirmed the same
#: way, never added on the strength of its name alone.
_KNOWN_POSITIONAL_DELEGATES = frozenset({"_fmt_sqlite_bars"})


def _fail(msg: str) -> None:
    raise SystemExit("[bars-ordinal-census] %s" % msg)


def _module_tree(path: pathlib.Path) -> ast.Module | None:
    try:
        return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except (SyntaxError, UnicodeDecodeError):
        return None


def _local_bars_sqlite_names(tree: ast.Module) -> set:
    """Every local name this module's imports bind to the `bars_sqlite` module
    itself (never to a specific function — every real call site in this repo
    imports the MODULE and calls `<alias>.get_bars(...)`, confirmed by a
    direct grep across all enumerated call sites before this was written).
    Handles both module-level and function-local `from api.services import
    bars_sqlite [as alias]`.
    """
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module in (
                "api.services", "services"):
            for alias in node.names:
                if alias.name == "bars_sqlite":
                    names.add(alias.asname or alias.name)
    return names


def _bars_family_calls(tree: ast.Module, local_names: set) -> list:
    """Every `ast.Call` node whose func is `<local_name>.<one of the three>`,
    with its line number, for citation. Sorted by line — `ast.walk()` visits
    in tree-structural (roughly breadth-first) order, NOT source order, so an
    unsorted result can list a later call before an earlier one."""
    calls = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr in _BARS_FAMILY_FUNCS
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id in local_names):
            calls.append((node.func.attr, node.lineno))
    return sorted(calls, key=lambda c: c[1])


def _has_named_access(tree: ast.Module) -> int | None:
    """The line of the EARLIEST call to something named `row_position` — the
    one declared accessor CP2 built (`address_book.row_position`). Matched on
    the attribute/function NAME alone (not the module it is imported from) so
    a future second declared accessor with the same name is still recognized
    without this file needing to know its import path.

    ⛔ Collects every match and takes min(lineno) rather than returning on the
    first `ast.walk()` hit — `ast.walk()` traverses in tree-structural order,
    not source order, so "first node visited" is not "first line in the
    file." Confirmed the hard way on `api/main.py` in the positional check
    below: `ast.walk()`'s first hit was a line 2,300+ lines after the real
    earliest occurrence.
    """
    lines = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            fn = node.func
            name = fn.attr if isinstance(fn, ast.Attribute) else (
                fn.id if isinstance(fn, ast.Name) else None)
            if name == "row_position":
                lines.append(node.lineno)
    return min(lines) if lines else None


def _unpack_targets(node: ast.AST) -> list | None:
    """The element list of a Tuple/List assignment or for-loop target, or
    None if the target is not a multi-element unpack."""
    if isinstance(node, (ast.Tuple, ast.List)):
        return node.elts
    return None


def _int_index_value(slice_node: ast.AST) -> int | None:
    """The integer value of a Subscript's index/slice, handling a bare
    literal (`row[4]`) and a negated literal (`row[-1]`). Anything else
    (a Name, a computed expression, a Slice) is not a constant ordinal and
    returns None — this is deliberately conservative: a variable index is not
    evidence of the fixed (ts,o,h,l,c,v) ordinal dependency this census looks
    for, whatever else it might be doing.
    """
    node = slice_node
    # Py3.9+: Subscript.slice is the expression directly (no ast.Index wrapper).
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub) \
            and isinstance(node.operand, ast.Constant) and isinstance(node.operand.value, int):
        return -node.operand.value
    if isinstance(node, ast.Constant) and isinstance(node.value, int) \
            and not isinstance(node.value, bool):
        return node.value
    return None


def _delegate_call_name(node: ast.Call) -> str | None:
    fn = node.func
    if isinstance(fn, ast.Attribute):
        return fn.attr
    if isinstance(fn, ast.Name):
        return fn.id
    return None


def _has_positional_evidence(tree: ast.Module) -> dict | None:
    """The EARLIEST evidence, anywhere in the module, that a value is
    consumed by fixed ordinal position rather than by name: a 5- or
    6-element tuple/list unpack (Assign target or For target), an
    integer-literal subscript in the 0-5 ordinal range (including a negated
    literal, e.g. `rows[-1][4]` — both subscripts in a chain are checked
    independently, so either one alone is sufficient evidence), or a call
    handing the raw rows to a KNOWN positional delegate
    (`_KNOWN_POSITIONAL_DELEGATES`).

    ⛔ Collects every match and returns the one with the LOWEST line number,
    never the first one `ast.walk()` happens to visit — `ast.walk()`
    traverses in tree-structural (roughly breadth-first) order, not source
    order. On `api/main.py` this genuinely differed: `ast.walk()` visited an
    unrelated 5-element bookkeeping tuple (`problems, asofs, active_n, cur,
    err = [], [], 0, None, None`) before it visited the real evidence — a
    bars row unpacked via `r[0]..r[5]` roughly 2,300 lines EARLIER in the
    file. Returning the walk order's first hit would have cited the
    irrelevant line and made a real positional consumer look like a
    false-positive to a human reviewer.

    This is still a census of EXPOSURE (does this module have the shape at
    all), not a full accounting of every occurrence within an
    already-flagged module — "earliest" picks one representative citation,
    not the most relevant one to any particular bars-family call site.
    """
    hits = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            elts = _unpack_targets(node.targets[0])
            if elts is not None and len(elts) in _UNPACK_SIZES:
                hits.append({"line": node.lineno, "pattern": "assign-unpack",
                             "size": len(elts)})
        if isinstance(node, ast.For):
            elts = _unpack_targets(node.target)
            if elts is not None and len(elts) in _UNPACK_SIZES:
                hits.append({"line": node.lineno, "pattern": "for-unpack",
                             "size": len(elts)})
        if isinstance(node, ast.Subscript):
            idx = _int_index_value(node.slice)
            if idx is not None and idx in _ORDINAL_INDEX_RANGE:
                hits.append({"line": node.lineno, "pattern": "int-subscript",
                             "index": idx})
        if isinstance(node, ast.Call):
            name = _delegate_call_name(node)
            if name in _KNOWN_POSITIONAL_DELEGATES:
                hits.append({"line": node.lineno, "pattern": "known-positional-delegate",
                             "delegate": name})
    if not hits:
        return None
    return min(hits, key=lambda h: h["line"])


class UnclassifiableModule(Exception):
    """Raised by `_classify_module` for a module that calls a bars-family
    function but shows neither recognized pattern. A distinct exception type
    (rather than a bare `SystemExit` from `_fail`) so a test can assert this
    specific refusal without the whole process exiting — `census()` below
    catches it and converts it to the same `_fail()` behaviour the tool has
    always had, at the top level, which IS meant to abort the whole run.
    """


def _classify_module(rel: str, tree: ast.Module) -> dict | None:
    """Classify one already-parsed module. Returns None if it does not call
    a bars-family function at all (nothing to classify); raises
    `UnclassifiableModule` if it does and shows neither recognized pattern.

    Pulled out of `census()`'s directory walk so it can be exercised directly
    against a synthetic AST in tests, without writing into the real `api/`
    tree or mocking the filesystem walk.
    """
    local_names = _local_bars_sqlite_names(tree)
    if not local_names:
        return None
    calls = _bars_family_calls(tree, local_names)
    if not calls:
        return None

    named_line = _has_named_access(tree)
    if named_line is not None:
        return {
            "classification": "named_access",
            "calls": [{"function": fn, "line": ln} for fn, ln in calls],
            "evidence": {"line": named_line, "pattern": "row_position"},
        }

    evidence = _has_positional_evidence(tree)
    if evidence is not None:
        return {
            "classification": "positional",
            "calls": [{"function": fn, "line": ln} for fn, ln in calls],
            "evidence": evidence,
        }

    # ⛔⛔ REFUSE RATHER THAN GUESS. A module that calls a bars-family
    # function but shows NEITHER recognized pattern is not "probably
    # fine" — every real case measured before this tool was written
    # showed one pattern or the other. An unrecognized third shape needs
    # a human to look at it and either extend the recognizer or classify
    # it by hand, not a silent omission from the census.
    raise UnclassifiableModule(
        "%s calls a bars-family function (%s) but shows neither "
        "named-access (row_position) nor a recognized positional "
        "pattern (tuple/list unpack of 5-6, or an int-literal "
        "subscript in 0-5) — refusing to guess. Extend the recognizer "
        "or classify this module by hand."
        % (rel, ", ".join(sorted({fn for fn, _ in calls}))))


def census() -> dict:
    modules: dict = {}
    scanned = 0
    for path in sorted((_ROOT / "api").rglob("*.py")):
        rel = str(path.relative_to(_ROOT)).replace("\\", "/")
        if rel in _EXCLUDE_MODULES:
            continue
        tree = _module_tree(path)
        if tree is None:
            continue
        scanned += 1
        try:
            result = _classify_module(rel, tree)
        except UnclassifiableModule as exc:
            _fail(str(exc))
        if result is not None:
            modules[rel] = result

    if scanned < 100:
        _fail("the module walk under api/ found almost nothing (%d) — it is "
              "broken, not the population" % scanned)
    if not modules:
        _fail("found zero modules calling a bars-family function — an empty "
              "scan is a failed invocation, not an empty population")

    positional = sorted(m for m, d in modules.items() if d["classification"] == "positional")
    named = sorted(m for m, d in modules.items() if d["classification"] == "named_access")

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_by": "tools/bars_ordinal_census.py",
        "what_this_is": (
            "D2 CP5 (closes F-D2-3) — a MODULE-LEVEL census of every api/** "
            "module that calls bars_sqlite.get_bars/get_bars_before/"
            "get_bars_since, classified as named_access (goes through "
            "address_book.row_position) or positional (a fixed-ordinal "
            "tuple unpack or integer-literal subscript found anywhere in the "
            "module). Detection only — no reader listed here was migrated or "
            "modified by this checkpoint."
        ),
        "bars_family_functions": sorted(_BARS_FAMILY_FUNCS),
        "modules_scanned": scanned,
        "summary": {
            "named_access_count": len(named),
            "positional_count": len(positional),
            "named_access": named,
            "positional": positional,
        },
        "modules": dict(sorted(modules.items())),
    }


def _dumps(data: dict) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False, sort_keys=False) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if the checked-in census is not what the sweep derives")
    args = ap.parse_args(argv)

    data = census()
    text = _dumps(data)

    if args.check:
        if not OUT_PATH.exists():
            print("[bars-ordinal-census] MISSING: %s" % OUT_PATH)
            return 1
        current = OUT_PATH.read_text(encoding="utf-8")
        if current != text:
            print("[bars-ordinal-census] STALE — the checked-in census is not "
                  "what the sweep derives. Re-run without --check.")
            return 1
        print("[bars-ordinal-census] OK — %d modules scanned, %d positional, "
              "%d named-access"
              % (data["modules_scanned"], data["summary"]["positional_count"],
                 data["summary"]["named_access_count"]))
        return 0

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(text, encoding="utf-8")
    print("[bars-ordinal-census] wrote %s — %d modules scanned, %d positional, "
          "%d named-access"
          % (OUT_PATH, data["modules_scanned"],
             data["summary"]["positional_count"], data["summary"]["named_access_count"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
