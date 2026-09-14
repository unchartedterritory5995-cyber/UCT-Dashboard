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


# ── Visibility flags — a SECOND axis, and the one that was invisible ─────────
# ⚰️ 2026-09-13: `DESK_PUBLIC_SHOWS` decided whether a PAID Zoom session became a
# searchable public YouTube video, and **no rail could see it**. Two independent
# reasons, which is why it survived: `is_gate()` is false for it (no ENABLED /
# DISABLE in the name), and the ledger rail only asks about gates. It was set to
# the wildcard `*` on 2026-08-19 and 27 paid sessions published public until the
# 2026-09-13 revert.
#
# ⛔ A gate is "does this feature run". A VISIBILITY flag is "who can see the
# output", and the blast radius of getting it wrong is not an outage — it is paid
# content on the open internet, which cannot be un-published.
#
# The markers are DECISION words. The exclusions are the other three kinds of
# name that carry them and decide nothing: a DESTINATION (`*_URL`, `*_CHANNEL`,
# anything WEBHOOK), a CREDENTIAL (`*_SECRET`, `*_TOKEN`, `*_KEY`), and a
# LOCATION (`*_PATH`, `*_BASE`, `*_ID`). Measured against the real census this
# yields 4 flags and excludes exactly `DESK_ANNOUNCE_DB_PATH`,
# `DISCORD_CHART_PUBLIC_KEY` and `UCT_PUBLIC_BASE` — a path, a signing key and a
# base URL.
#
# ⚠️ RESIDUAL, stated rather than hidden: this is a NAME test. A new flag that
# decides public exposure without one of these words in its name is not caught.
# That is a smaller hole than the one it closes, and naming it here is the only
# honest way to carry it.
_VISIBILITY_MARKERS = ("PUBLIC", "ANNOUNCE", "PUBLISH", "VISIBILITY", "BROADCAST")
_NOT_A_DECISION = ("_URL", "_URI", "_SECRET", "_TOKEN", "_KEY", "_ID", "_IDS",
                   "_PATH", "_MODEL", "_CHANNEL", "_BASE", "_WEBHOOK")


def is_visibility_flag(name: str) -> bool:
    """True for an env name whose VALUE decides who can see the output."""
    upper = name.upper()
    if "WEBHOOK" in upper:
        return False
    if any(upper.endswith(suffix) for suffix in _NOT_A_DECISION):
        return False
    return any(marker in upper for marker in _VISIBILITY_MARKERS)


def visibility_flags(roots: list[Path], base: Path | None = None) -> dict[str, dict[str, Any]]:
    """`scan` narrowed to the names that decide public exposure.

    ⛔ Narrowed from `scan`, never from `gates` — `gates` cannot see a flag whose
    name carries no ENABLED/DISABLE marker, which is exactly how the one that
    published paid sessions stayed invisible.
    """
    return {k: v for k, v in scan(roots, base).items() if is_visibility_flag(k)}


def _os_aliases(tree: ast.AST) -> set[str]:
    """Every local name this file's `import os [as X]` statements bind.

    `os.getenv("X")` is matched by name (`f.value.id == "os"`), so a file that
    imports the module under any other name — `import os as _os`, seen live in
    api/services/journal_two/broker/fidelity_audit.py:227 gating
    BROKER_BALANCE_HISTORY_ENABLED — was invisible to `_env_name` even though
    the ledger test's own control (`test_an_undeclared_gate_is_actually_caught`)
    only ever exercises the unaliased form. `os.environ.get`/`os.environ[...]`
    are unaffected: those two forms already match on the ATTRIBUTE name
    (`.environ`), not the base object, so they were never alias-blind.
    """
    names = {"os"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "os":
                    names.add(alias.asname or alias.name)
    return names


def _module_str_consts(tree: ast.AST) -> dict[str, str]:
    """Module-level `NAME = "literal"` bindings.

    ⛔⛔ AN ENV NAME HELD IN A VARIABLE IS INVISIBLE TO A CONSTANT-MATCHING SCAN,
    and this is the SECOND shape of that blind spot found on 2026-09-12. The
    first was a table (`NOTEBOOK_FLAGS`, Wave K). This is the plainer one:

        ENABLED_ENV = "D2_SAMPLE_PERSIST_ENABLED"
        ... os.environ.get(ENABLED_ENV)

    That is GOOD code — one authority over the name, which is what this codebase
    asks for everywhere else — and the index could not see it. The ledger then
    reported the correctly-declared gate as STALE: it told the truth about its
    own blindness and blamed the entry.
    """
    out: dict[str, str] = {}
    for node in getattr(tree, "body", []):
        if (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)
                and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            out[node.targets[0].id] = node.value.value
    return out


def _env_name(node: ast.AST, os_names: set[str] | None = None,
              consts: dict[str, str] | None = None) -> str | None:
    """The env var this expression reads, or None. Handles every form below."""
    if os_names is None:
        os_names = {"os"}
    consts = consts or {}
    if isinstance(node, ast.Call):
        f = node.func
        ok = (
            isinstance(f, ast.Attribute)
            and (
                (f.attr == "getenv" and isinstance(f.value, ast.Name) and f.value.id in os_names)
                or (f.attr == "get" and isinstance(f.value, ast.Attribute)
                    and f.value.attr == "environ")
            )
        )
        if ok and node.args:
            a = node.args[0]
            if isinstance(a, ast.Constant) and isinstance(a.value, str):
                return a.value
            # …and the same read through a module-level constant.
            if isinstance(a, ast.Name) and a.id in consts:
                return consts[a.id]
    # os.environ["X"] — the form an AST-only-on-Call scan silently misses.
    if isinstance(node, ast.Subscript):
        v = node.value
        if isinstance(v, ast.Attribute) and v.attr == "environ":
            sl = node.slice
            if isinstance(sl, ast.Constant) and isinstance(sl.value, str):
                return sl.value
            if isinstance(sl, ast.Name) and sl.id in consts:
                return consts[sl.id]
    return None


def _default_of(node: ast.AST) -> Any:
    if isinstance(node, ast.Call) and len(node.args) > 1 \
            and isinstance(node.args[1], ast.Constant):
        return node.args[1].value
    return None


def _table_gates(tree: ast.AST, rel: str, found: dict) -> None:
    """A TABLE of gates, read through a loop variable.

    (Deliberately not numbered against the forms in the module docstring: a count
    typed beside the list it describes is the defect this repo keeps re-committing.)

    ⛔⛔ THE SCAN IS BLIND TO `os.environ.get(env_name)` BY CONSTRUCTION, and that
    is not a corner case: Wave K's four Notebook capabilities are declared once
    as `NOTEBOOK_FLAGS = {"NAME": default, ...}` and read in a loop, precisely so
    the env name and the payload key cannot drift apart. Four gates therefore
    shipped INVISIBLE to this index on 2026-09-12 — the ledger stayed green while
    describing a repo that was four gates short, which is the exact failure this
    module exists to prevent, one level up.

    ⭐ The default comes from the TABLE'S OWN VALUE, which is better evidence than
    a second argument: it is the literal the code falls back to, in the same
    expression a reader audits.

    Narrow on purpose — a module-level `*_FLAGS` dict whose keys are ALL string
    constants and ALL gate-shaped. A fixture that looks like one is recorded and
    demands a ledger entry; that direction is loud, and the other is silent.
    """
    for node in getattr(tree, "body", []):
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name) or not target.id.endswith("_FLAGS"):
            continue
        if not isinstance(node.value, ast.Dict) or not node.value.keys:
            continue
        pairs = []
        for k, v in zip(node.value.keys, node.value.values):
            if not (isinstance(k, ast.Constant) and isinstance(k.value, str) and is_gate(k.value)):
                pairs = []
                break
            pairs.append((k.value, v.value if isinstance(v, ast.Constant) else None))
        for name, default in pairs:
            e = found.setdefault(name, {"default": None, "sites": set()})
            if e["default"] is None and default is not None:
                e["default"] = default
            e["sites"].add(rel)


def scan(roots: list[Path], base: Path | None = None) -> dict[str, dict[str, Any]]:
    """{env_name: {"default": ..., "sites": [paths]}} over `roots`.

    `base` makes the recorded sites repo-relative, so the ledger reads the same
    on every machine and in CI."""
    found: dict[str, dict[str, Any]] = {}

    class V(ast.NodeVisitor):
        def __init__(self, rel: str, os_names: set[str], consts: dict[str, str]):
            self.rel = rel
            self.os_names = os_names
            self.consts = consts

        def _record(self, node):
            name = _env_name(node, self.os_names, self.consts)
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
                name = _env_name(node.values[0], self.os_names, self.consts)
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
            V(rel, _os_aliases(tree), _module_str_consts(tree)).visit(tree)
            _table_gates(tree, rel, found)

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
