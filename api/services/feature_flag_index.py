"""Every feature GATE the code reads, derived from the source by AST.

The problem this exists for: a gate that ships defaulting off and is never set
is indistinguishable, from outside the repo, from a gate that is off ON PURPOSE.
Measured 2026-08-30 across api/, scripts/ and tools/: 973 env names read, and
twelve `*_ENABLED` gates that default off and are set on no Railway service —
some of them deliberate retirements (`PATTERN_VISION_ENABLED=0` was a decision),
some simply forgotten. Nothing in the repo could tell the two apart, which is
the same shape as every other defect this codebase keeps paying for: a state
nobody can distinguish from failure.

⛔ DERIVED, NEVER TYPED. A hand-maintained list of flag names is the artifact
that goes stale first — this walks the AST for `os.getenv("X")`,
`os.environ.get("X")`, `os.environ["X"]` and the `(os.getenv("X") or "1")`
fallback idiom, and returns what the code ACTUALLY reads (`lesson_probe_names_must_be_derived_not_typed`). The subscript form is
included deliberately: leaving it out made an early pass report SESSION_SECRET
and three others as unreferenced when they were merely read a different way.

This module is the ONE reader. `tests/test_feature_flag_ledger.py` holds the
ledger to it and `tools/flag_ledger_audit.py` compares the ledger to what is
actually set on Railway; neither re-implements the scan.
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

# What counts as a GATE rather than a setting. This predicate IS the
# definition — widen it and the ledger must grow to match, which is the point.
# `*_DISABLED` / `DISABLE_*` are gates too: their sense is inverted, not absent.
_GATE_MARKERS = ("ENABLED", "DISABLE")


def is_gate(name: str) -> bool:
    """True for an env name that turns a feature on or off."""
    return any(m in name for m in _GATE_MARKERS) or name.endswith("_ON")


def _env_name(node: ast.AST) -> str | None:
    """The env var this expression reads, or None. Handles all three forms."""
    if isinstance(node, ast.Call):
        f = node.func
        ok = (
            isinstance(f, ast.Attribute)
            and (
                (f.attr == "getenv" and isinstance(f.value, ast.Name) and f.value.id == "os")
                or (f.attr == "get" and isinstance(f.value, ast.Attribute)
                    and f.value.attr == "environ")
            )
        )
        if ok and node.args and isinstance(node.args[0], ast.Constant) \
                and isinstance(node.args[0].value, str):
            return node.args[0].value
    # os.environ["X"] — the form an AST-only-on-Call scan silently misses.
    if isinstance(node, ast.Subscript):
        v = node.value
        if isinstance(v, ast.Attribute) and v.attr == "environ" \
                and isinstance(node.slice, ast.Constant) \
                and isinstance(node.slice.value, str):
            return node.slice.value
    return None


def _default_of(node: ast.AST) -> Any:
    if isinstance(node, ast.Call) and len(node.args) > 1 \
            and isinstance(node.args[1], ast.Constant):
        return node.args[1].value
    return None


def scan(roots: list[Path], base: Path | None = None) -> dict[str, dict[str, Any]]:
    """{env_name: {"default": ..., "sites": [paths]}} over `roots`.

    `base` makes the recorded sites repo-relative, so the ledger reads the same
    on every machine and in CI."""
    found: dict[str, dict[str, Any]] = {}

    class V(ast.NodeVisitor):
        def __init__(self, rel: str):
            self.rel = rel

        def _record(self, node):
            name = _env_name(node)
            if not name:
                return
            e = found.setdefault(name, {"default": None, "sites": set()})
            d = _default_of(node)
            if e["default"] is None and d is not None:
                e["default"] = d
            e["sites"].add(self.rel)

        def visit_Call(self, node):
            self._record(node)
            self.generic_visit(node)

        def visit_Subscript(self, node):
            self._record(node)
            self.generic_visit(node)

        def visit_BoolOp(self, node):
            # `(os.getenv("X") or "1") == "1"` — the fallback IS the default, and
            # a scan that reads only the call's second argument reports this gate
            # as off-by-default when it ships ON. Three broker gates were
            # mis-classified exactly this way before this branch existed.
            if isinstance(node.op, ast.Or) and len(node.values) == 2                     and isinstance(node.values[1], ast.Constant)                     and isinstance(node.values[1].value, str):
                name = _env_name(node.values[0])
                if name:
                    e = found.setdefault(name, {"default": None, "sites": set()})
                    e["default"] = node.values[1].value
                    e["sites"].add(self.rel)
            self.generic_visit(node)

    for root in roots:
        if not root.exists():
            continue
        for p in sorted(root.rglob("*.py")):
            if "__pycache__" in p.parts:
                continue
            try:
                tree = ast.parse(p.read_text(encoding="utf-8", errors="ignore"))
            except SyntaxError:
                continue  # a file we cannot parse is not a place a gate hides
            rel = p.as_posix()
            if base:
                try:
                    rel = p.relative_to(base).as_posix()
                except ValueError:
                    pass  # scanning outside the base (a test tree) — absolute is fine
            V(rel).visit(tree)

    return {k: {"default": v["default"], "sites": sorted(v["sites"])}
            for k, v in sorted(found.items())}


def gates(roots: list[Path], base: Path | None = None) -> dict[str, dict[str, Any]]:
    """`scan` narrowed to the names that gate a feature."""
    return {k: v for k, v in scan(roots, base).items() if is_gate(k)}


def repo_roots(repo: Path) -> list[Path]:
    """The trees a deployed gate can live in."""
    return [repo / "api", repo / "scripts", repo / "tools"]


_ON_DEFAULTS = {"1", "true", "yes", "on"}


def defaults_on(name: str, default: Any) -> bool:
    """Is this gate ON when nothing is set in the environment?

    `*_DISABLED` / `DISABLE_*` gates are INVERTED: absent or "0" means the
    feature is on. Getting this backwards would demand a written justification
    for every prewarm that is running perfectly well.
    """
    literal = str("" if default is None else default).strip().lower()
    if "DISABLE" in name:
        return literal not in _ON_DEFAULTS
    return literal in _ON_DEFAULTS


def needs_declaration(name: str, default: Any) -> bool:
    """True for a gate that is OFF unless something turns it on.

    That is the ambiguous class and the only one worth the cost of a written
    entry: a gate on by default is self-evidently a live decision, while a gate
    off by default and set nowhere is indistinguishable from one that was
    forgotten. Gates whose default the AST cannot see (no literal second
    argument — the `os.getenv("X") != "0"` idiom) land here too, deliberately:
    their sense lives in a comparison this scan does not read, so a human says
    which it is once, in the ledger, instead of every reader re-deriving it.
    """
    return not defaults_on(name, default)
