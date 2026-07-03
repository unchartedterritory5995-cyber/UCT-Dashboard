"""Regression: _drain_pending_queue must declare its module-level queue sets global.

The re-queue paths do `_pending_subscribe |= ...` / `_pending_unsubscribe |= ...`
(augmented assignment). In Python an augmented assignment to a bare name makes
that name FUNCTION-LOCAL for the entire scope at compile time — so without a
`global` declaration the reads at the top of the loop (`sorted(_pending_subscribe)`)
raise UnboundLocalError on the drain task's first tick. The task then dies
silently and the subscribe queue never flushes → bars never subscribe when
STREAM_BARS_ENABLED=1 (a dormant bug found via cross-session review 2026-07-03).

This test is AST-based (no import of websockets/network deps) and generic: it
asserts that EVERY module-level global that any function augment-assigns is also
declared `global` in that function — catching this whole bug class, not just the
one occurrence.
"""
import ast
import os

_SRC_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "api", "services", "bar_stream.py",
)


def _module_globals(tree):
    names = set()
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    names.add(t.id)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
    return names


def test_drain_pending_queue_declares_queue_globals():
    tree = ast.parse(open(_SRC_PATH, encoding="utf-8").read())
    fn = next(
        n for n in ast.walk(tree)
        if isinstance(n, (ast.AsyncFunctionDef, ast.FunctionDef))
        and n.name == "_drain_pending_queue"
    )
    declared = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.Global):
            declared.update(node.names)
    assert {"_pending_subscribe", "_pending_unsubscribe"} <= declared


def test_no_function_augment_assigns_a_global_without_declaring_it():
    tree = ast.parse(open(_SRC_PATH, encoding="utf-8").read())
    module_globals = _module_globals(tree)
    offenders = []
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.AsyncFunctionDef, ast.FunctionDef)):
            continue
        declared = set()
        for node in ast.walk(fn):
            if isinstance(node, ast.Global):
                declared.update(node.names)
        for node in ast.walk(fn):
            if isinstance(node, ast.AugAssign) and isinstance(node.target, ast.Name):
                name = node.target.id
                if name in module_globals and name not in declared:
                    offenders.append(f"{fn.name}: {name}")
    assert not offenders, f"augmented-assign of module global without `global`: {offenders}"
