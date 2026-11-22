"""P0 rail: SERVE-LABEL BUDGET — every bars serve label is a declared one.

``bars_fetch._mark_serve(label)`` names the path that answered a /api/bars request and
reaches production as ``Server-Timing: bars;desc="<label>"``; the synthetic monitor and
the warmth gates classify latency by it. An ad-hoc label added on a new serve path is
silently "unclassified" there (no alert, no budget), which is how an unaccounted slow
path hides. So the label set is a declared enum — ``api/services/serve_labels.py`` —
and this test:

  1. finds EVERY ``_mark_serve(...)`` call under ``api/`` by AST;
  2. a string-literal argument must be declared;
  3. a non-literal argument (``_mark_serve(tier)``) must resolve, statically, to a
     closed set of string literals (assignments in the enclosing function, or the
     returned tuples of the same-module function it was unpacked from), all declared —
     an unresolvable dynamic label fails;
  4. every declared label is emitted somewhere (the enum cannot rot), and
  5. the module exports the mapping the monitor reads.
"""

from __future__ import annotations

import ast
import os
import re

import pytest

from api.services.serve_labels import SERVE_CLASSES, SERVE_LABELS, serve_class

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = os.path.join(ROOT, "api")


def _py_files():
    for dp, dn, fn in os.walk(API):
        dn[:] = [d for d in dn if d not in ("__pycache__", "tests") and not d.startswith(".")]
        for f in fn:
            if f.endswith(".py") and not f.startswith("test_"):
                yield os.path.join(dp, f)


def _callee(n: ast.Call):
    f = n.func
    return f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else None


def _str_consts(node) -> set[str] | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return {node.value}
    return None


def _resolve_name(name: str, fn: ast.AST, mod: ast.Module) -> set[str] | None:
    """Closed set of string literals `name` can hold inside function `fn`, or None."""
    vals: set[str] = set()
    funcs = {n.name: n for n in ast.walk(mod) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    for n in ast.walk(fn):
        if not isinstance(n, ast.Assign):
            continue
        for tgt in n.targets:
            if isinstance(tgt, ast.Name) and tgt.id == name:
                s = _str_consts(n.value)
                if s is None:
                    return None
                vals |= s
            elif isinstance(tgt, ast.Tuple):
                names = [e.id if isinstance(e, ast.Name) else None for e in tgt.elts]
                if name not in names:
                    continue
                i = names.index(name)
                if isinstance(n.value, ast.Tuple):
                    s = _str_consts(n.value.elts[i])
                    if s is None:
                        return None
                    vals |= s
                elif isinstance(n.value, ast.Call) and _callee(n.value) in funcs:
                    for r in ast.walk(funcs[_callee(n.value)]):
                        if isinstance(r, ast.Return) and r.value is not None:
                            if not isinstance(r.value, ast.Tuple):
                                return None
                            s = _str_consts(r.value.elts[i])
                            if s is None:
                                return None
                            vals |= s
                else:
                    return None
    return vals or None


def _census():
    """[(relpath, line, label_or_None, kind)] for every _mark_serve call."""
    out = []
    for path in _py_files():
        src = open(path, encoding="utf-8").read()
        if "_mark_serve" not in src:
            continue
        mod = ast.parse(src)
        rel = os.path.relpath(path, ROOT).replace(os.sep, "/")
        parents = {}
        for p in ast.walk(mod):
            for c in ast.iter_child_nodes(p):
                parents[c] = p
        for n in ast.walk(mod):
            if not (isinstance(n, ast.Call) and _callee(n) == "_mark_serve" and n.args):
                continue
            a = n.args[0]
            lit = _str_consts(a)
            if lit:
                out.append((rel, n.lineno, next(iter(lit)), "literal"))
                continue
            fn = n
            while fn in parents and not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                fn = parents[fn]
            vals = _resolve_name(a.id, fn, mod) if isinstance(a, ast.Name) else None
            if vals is None:
                out.append((rel, n.lineno, None, f"unresolvable:{ast.unparse(a)}"))
            else:
                out.extend((rel, n.lineno, v, "dynamic") for v in sorted(vals))
    return out


CENSUS = _census()


def test_census_sees_the_known_serve_paths():
    files = {c[0] for c in CENSUS}
    assert "api/services/bars_fetch.py" in files and "api/routers/bars.py" in files
    assert sum(1 for c in CENSUS if c[0] == "api/services/bars_fetch.py") >= 20


def test_every_serve_label_is_declared():
    bad = [f"{f}:{ln} {lab!r} ({kind})" for f, ln, lab, kind in CENSUS
           if lab is None or lab not in SERVE_LABELS]
    assert bad == [], ("undeclared / unresolvable _mark_serve label(s) — declare them in "
                       "api/services/serve_labels.py with a class, or reuse an existing label:\n"
                       + "\n".join(bad))


def test_server_timing_literals_are_declared():
    """Router responses that stamp Server-Timing directly (not via _mark_serve)."""
    src = open(os.path.join(API, "routers", "bars.py"), encoding="utf-8").read()
    lits = set(re.findall(r'bars;desc="([a-z][a-z0-9-]*)"', src))
    assert lits, "expected at least one literal Server-Timing desc in routers/bars.py"
    assert sorted(lits - set(SERVE_LABELS)) == []


def test_get_serve_layer_default_is_declared():
    src = open(os.path.join(API, "services", "bars_fetch.py"), encoding="utf-8").read()
    m = re.search(r'getattr\(_serve_diag,\s*"layer",\s*"([^"]+)"\)', src)
    assert m and m.group(1) in SERVE_LABELS


def test_every_declared_label_is_still_emitted():
    """The enum is a budget, not a wish list: a label no code emits is removed."""
    emitted = {c[2] for c in CENSUS if c[2]}
    src = open(os.path.join(API, "routers", "bars.py"), encoding="utf-8").read()
    emitted |= set(re.findall(r'bars;desc="([a-z][a-z0-9-]*)"', src))
    emitted.add("unknown")
    assert sorted(set(SERVE_LABELS) - emitted) == []


def test_every_label_has_a_known_class_and_the_mapping_is_read_only():
    assert all(v in SERVE_CLASSES for v in SERVE_LABELS.values())
    assert serve_class("definitely-not-a-label") == "undeclared"
    with pytest.raises(TypeError):
        SERVE_LABELS["x"] = "warm"  # type: ignore[index]


@pytest.mark.xfail(strict=True, reason=(
    "KNOWN ROT (P0 rails 2026-11-11): tools/bars_warmth_audit.py classifies by its own "
    "hand-copied sets; they name 'disk' (never emitted) and omit most deadline/delta "
    "labels. TODO(P1 monitor): import api.services.serve_labels.SERVE_LABELS there and "
    "delete the copies — then drop this xfail."))
def test_warmth_audit_tool_classifies_only_declared_labels_and_all_of_them():
    import importlib.util
    spec = importlib.util.spec_from_file_location("_bwa", os.path.join(ROOT, "tools", "bars_warmth_audit.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    tool = set(mod.WARM) | set(mod.STALE_SERVED) | set(mod.COLD)
    assert tool <= set(SERVE_LABELS)
    assert tool >= {k for k, v in SERVE_LABELS.items() if v != "route"}
