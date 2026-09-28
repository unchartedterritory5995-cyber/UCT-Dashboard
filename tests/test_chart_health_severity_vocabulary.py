"""TWO severity scales meet in `bars_reconciliation._run_detect_only`, fourteen
lines apart, and they share the word `warn`. This rail tells them apart by
construction, with both vocabularies DERIVED from the modules that declare them
— never typed here.

WHY THE DEFECT SURVIVED. `_run_detect_only` reads `d.severity` (the AUDIT's
per-bar diff scale) and then calls `chart_health_alerts.emit(key, severity, ...)`
(the ALERT scale). A reader scanning that function for `"warn"` finds several
hits and cannot tell which scale each belongs to, so the wrong one reads as a
consistent pattern rather than a typo:

  * `api/services/audit.py` classifies every bar diff as `ok` / `warn` / `fail`.
    `_run_detect_only`'s two filters are on THAT scale and are correct.
  * `api/services/alerts.py` declares the app's alert severities as
    `SEVERITY_INFO/WARNING/CRITICAL` = `info` / `warning` / `critical`.
    `emit()`'s second argument is on THAT scale — and it VALIDATES NOTHING, so a
    word from the wrong scale is accepted, stored, and then does nothing at all.

The two sets are disjoint (asserted below), which is what makes any single
literal attributable to exactly one scale.

⛔ WHY THIS DOES NOT READ `app/src/pages/admin/ChartHealth.jsx`, though it is a
real consumer: that file is another workstream's and is being rewritten right
now, and its replacement deliberately NORMALISES `warn` to the warning tier. A
set derived from it would therefore contain `warn` and this rail would agree the
typo was fine — the fixture that cannot distinguish. The declared vocabulary is
the stable authority; the admin view is a renderer of it.

⛔ EVERY DERIVATION RAISES ON AN EMPTY RESULT. An empty set satisfies "no
unrecognised severity" trivially, so a broken parse would read as a clean rail.

⛔ EVERY DERIVATION IS AN AST WALK, so a comment or a docstring mentioning a
severity word cannot contribute one — proved by controls below rather than
asserted, with a real occurrence in the same fixture to show the check still
sees one. Nothing here matches a literal against source TEXT, which is why this
file carries no comment/docstring stripper: there is no text-matching path for
prose to leak into. `tests/test_term018_every_guard_can_fire.py` needs one
because its pins ARE source excerpts.

════════════════════════════════════════════════════════════════════════════════
⛔⛔ THE SWEEP WAS BLIND TO AN ALIAS, AND WHAT IT MISSED WAS THE WAVE'S OWN FIX
════════════════════════════════════════════════════════════════════════════════

The repo-wide sweep below used to hard-match the bare module name::

    isinstance(func.value, ast.Name) and func.value.id == "chart_health_alerts"

`api/services/bars_continuous_audit.py` binds the sink as `_alerts` — by a
`from api.services import chart_health_alerts as _alerts` INSIDE a function body
— and emits four times through it. Measured on this tree: **21 literal-severity
emit sites under `api/` alias-resolved, 17 name-literal-only**, and the four the
old matcher could not see are ALL in that one file:

    bars_store_unhealthy::critical      bars_daily_store_stale::critical
    intraday_hotset_stale::critical     intraday_hotset_stale::warning

⭐⭐ Both `intraday_hotset_stale` tiers are in that list — the exact pair whose
escalation defect this wave fixed. The rail built to protect the fix could not
see the sites the fix touched. Identical numbers at `e28834d82`, the commit that
introduced this file, so its message's "sweeps every literal-severity `emit`
under `api/**` (20 sites, non-vacuity floor 10)" was wrong when written: not
"every" (4 of 21 invisible), not 20 (the population is 21, the swept set was
17), and 10 is not a non-vacuity floor against 21 — it cannot tell 17 from 21.

════════════════════════════════════════════════════════════════════════════════
WHAT THE ALIAS RESOLUTION GUARANTEES — AND WHAT IT DOES NOT
════════════════════════════════════════════════════════════════════════════════

GUARANTEES:
  * Every binding form is collected AT THE SCOPE THAT OWNS IT — `import X as`,
    `from P import X`, `from P import X as` — at module level, inside a function
    body, inside a `try`, or inside a class body.
  * Lookup follows Python's own chain, innermost scope first, with CLASS scopes
    skipped for nested scopes. So an inner rebinding SHADOWS an outer sink
    binding and the inner one wins. (No live instance in this tree, so that is
    proved by a planted fixture, not by the sweep.)
  * A scope binding the name to the sink AND to a CONSTANT is the optional-import
    idiom — `try: from api.services import chart_health_alerts` /
    `except ImportError: chart_health_alerts = None`, which `api/routers/push.py`
    does — and resolves to the module, because the guarded call only runs when
    the import succeeded.
  * A scope binding the name to the sink AND to a NON-constant expression is NOT
    decidable by a static walk. It is reported BY NAME and FAILS this rail rather
    than being guessed in either direction.

DOES NOT — stated plainly, because an overclaim here is the defect repeating:
  * Python has no block scope, so a rebinding anywhere in a function is a
    rebinding for that whole function. This walk cannot say which of two bindings
    is live at a given line; that is exactly what the ambiguous verdict refuses
    to guess about.
  * `global` / `nonlocal` re-pointing a sink alias is not modelled. Asserted
    absent instead, so the gap is a checked precondition rather than a claim.
  * A star import could introduce the name invisibly. Not modelled; instead an
    `emit` call on an UNBOUND name spelled exactly `chart_health_alerts` is
    reported and fails, which is the only way that hole could widen the
    population without this file noticing.
  * A dotted call (`api.services.chart_health_alerts.emit(...)`) is a different
    call shape. It IS counted — zero today — so one arriving moves the pinned
    count rather than escaping.
"""
import ast
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ALERT_VOCAB_SRC = ROOT / "api" / "services" / "alerts.py"
PAGER_SRC = ROOT / "api" / "services" / "chart_health_alerts.py"
AUDIT_SRC = ROOT / "api" / "services" / "audit.py"
RECONCILER_SRC = ROOT / "api" / "services" / "bars_reconciliation.py"
ALIAS_SRC_REL = "api/services/bars_continuous_audit.py"
API_ROOT = ROOT / "api"

SINK_MODULE = "api.services.chart_health_alerts"
SINK_TAIL = SINK_MODULE.rsplit(".", 1)[-1]
SINK_FUNCTION = "emit"

#: ⛔⛔ PINNED EXACTLY, NOT A FLOOR, AND THE ARGUMENT IS MEASURED. The floor this
#: replaces was `seen >= 10` against a true population of 21: it could not tell
#: 17 from 21, so it sat green through a matcher that was missing a fifth of the
#: tree, and it would not have noticed the 4-site drop either. A floor is only
#: ever wrong in the flattering direction — fewer sites swept, fewer defects
#: found — and this one had gone stale by 11 the day it was written.
#:
#: The alternative considered and rejected: raise the floor to today's count.
#: That fails on a drop TODAY and then rots, because a legitimate new emit site
#: leaves it behind (floor 21 against a population of 25 is the same decoration
#: one wave later) and nothing ever says so. An exact pin cannot rot: adding a
#: site is a visible one-line diff ON THIS RAIL, in the commit that adds it —
#: the same reasoning as `DECLARED_UNOBSERVED_CEILING` in
#: `tests/test_term018_every_guard_can_fire.py`.
#:
#: ⭐ A count alone can be satisfied by the WRONG SET, so it never stands alone
#: here: `ALIAS_ONLY_SITES` below is asserted by name.
#:
#: ADDING AN EMIT SITE? Both numbers move together unless the new site's
#: severity is computed rather than a literal. Update them here and say so in the
#: commit; the failure message prints the full derived inventory to paste from.
EXPECTED_EMIT_SITES = 24
EXPECTED_LITERAL_SEVERITY_SITES = 23

#: The sites the OLD name-literal matcher could not see, `(relpath, key,
#: severity)`, WITHOUT line numbers — a pinned line number is the drift this
#: repo keeps paying for. Both `intraday_hotset_stale` tiers are here on purpose.
ALIAS_ONLY_SITES = (
    (ALIAS_SRC_REL, "bars_store_unhealthy", "critical"),
    (ALIAS_SRC_REL, "bars_daily_store_stale", "critical"),
    (ALIAS_SRC_REL, "intraday_hotset_stale", "critical"),
    (ALIAS_SRC_REL, "intraday_hotset_stale", "warning"),
)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


# ── Derivation helpers (AST only) ─────────────────────────────────────────────

def _is_severity_operand(node: ast.AST) -> bool:
    """True for `severity`, `x.severity`, `x["severity"]`."""
    if isinstance(node, ast.Name):
        return node.id == "severity"
    if isinstance(node, ast.Attribute):
        return node.attr == "severity"
    if isinstance(node, ast.Subscript):
        key = node.slice
        return isinstance(key, ast.Constant) and key.value == "severity"
    return False


def severities_compared_in(source: str) -> set[str]:
    """String literals that a comparison tests a `severity` operand against."""
    found: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Compare):
            continue
        operands = [node.left, *node.comparators]
        if not any(_is_severity_operand(o) for o in operands):
            continue
        for o in operands:
            if isinstance(o, ast.Constant) and isinstance(o.value, str):
                found.add(o.value)
    return found


def severity_constants_in(source: str) -> set[str]:
    """Values of module-level `SEVERITY_<WORD> = "<word>"` assignments."""
    found: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Assign):
            continue
        if not (isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id.startswith("SEVERITY_"):
                found.add(node.value.value)
    return found


def severities_returned_by_classifiers_in(source: str) -> set[str]:
    """String literals returned by `_classify_*severity*` functions."""
    found: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if not (node.name.startswith("_classify") and "severity" in node.name):
            continue
        for inner in ast.walk(node):
            if isinstance(inner, ast.Return) and isinstance(inner.value, ast.Constant) \
                    and isinstance(inner.value.value, str):
                found.add(inner.value.value)
    return found


# ══════════════════════════════════════════════════════════════════════════════
#  Alias resolution — scope-aware, shadowing-respecting. See the module
#  docstring for exactly what this guarantees and what it refuses to guess.
# ══════════════════════════════════════════════════════════════════════════════

_SCOPE_NODES = (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef,
                ast.Lambda, ast.ListComp, ast.SetComp, ast.DictComp,
                ast.GeneratorExp)


def _parents(tree: ast.AST) -> dict[int, ast.AST]:
    out: dict[int, ast.AST] = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            out[id(child)] = node
    return out


def _enclosing_scope(node: ast.AST, parents: dict[int, ast.AST]):
    """The scope a binding written AT `node` lands in."""
    cur = parents.get(id(node))
    while cur is not None and not isinstance(cur, _SCOPE_NODES):
        cur = parents.get(id(cur))
    return cur


def _scope_chain(node: ast.AST, parents: dict[int, ast.AST]) -> list[ast.AST]:
    """Enclosing scopes, INNERMOST FIRST, in Python's own lookup order.

    A CLASS body is visible to statements directly inside it and to nothing
    nested within it, so class scopes are kept only as the innermost entry.
    """
    chain: list[ast.AST] = []
    cur: ast.AST | None = node
    while cur is not None:
        if isinstance(cur, _SCOPE_NODES) and cur is not node:
            chain.append(cur)
        cur = parents.get(id(cur))
    if isinstance(node, _SCOPE_NODES):
        chain.insert(0, node)
    if not chain:
        return []
    return [chain[0]] + [s for s in chain[1:] if not isinstance(s, ast.ClassDef)]


def _target_names(node: ast.AST) -> list[str]:
    """Names bound by an assignment/for/with target, tuples unpacked."""
    out: list[str] = []
    stack = [node]
    while stack:
        cur = stack.pop()
        if isinstance(cur, ast.Name):
            out.append(cur.id)
        elif isinstance(cur, (ast.Tuple, ast.List, ast.Starred)):
            stack.extend(ast.iter_child_nodes(cur))
    return out


def sink_bindings_in(tree: ast.AST, parents: dict[int, ast.AST]):
    """`({id(scope): {name: {"sink"|"const"|"other"}}}, global/nonlocal names)`.

    ⛔ THE FUNCTION-LOCAL CASE IS THE ONE THAT MATTERS: the four most
    load-bearing guards on this channel are bound by an import written INSIDE a
    function body, so a collector that only reads module-level imports finds
    none of them.
    """
    binds: dict[int, dict[str, set[str]]] = {}
    declared: set[str] = set()

    def bind(scope, name: str, kind: str) -> None:
        if scope is None:
            return
        binds.setdefault(id(scope), {}).setdefault(name, set()).add(kind)

    for node in ast.walk(tree):
        scope = _enclosing_scope(node, parents)
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == SINK_MODULE and alias.asname:
                    bind(scope, alias.asname, "sink")
                else:
                    # `import a.b.c` binds `a`, never `c`.
                    bind(scope, alias.asname or alias.name.split(".")[0], "other")
        elif isinstance(node, ast.ImportFrom):
            pkg = node.module or ""
            for alias in node.names:
                kind = "sink" if f"{pkg}.{alias.name}" == SINK_MODULE else "other"
                bind(scope, alias.asname or alias.name, kind)
        elif isinstance(node, (ast.Assign, ast.AugAssign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            value = getattr(node, "value", None)
            kind = "const" if isinstance(value, ast.Constant) else "other"
            for target in targets:
                for name in _target_names(target):
                    bind(scope, name, kind)
        elif isinstance(node, (ast.For, ast.AsyncFor, ast.comprehension)):
            for name in _target_names(node.target):
                bind(scope, name, "other")
        elif isinstance(node, ast.withitem):
            if node.optional_vars is not None:
                for name in _target_names(node.optional_vars):
                    bind(scope, name, "other")
        elif isinstance(node, ast.ExceptHandler):
            if node.name:
                bind(scope, node.name, "other")
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bind(scope, node.name, "other")
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            declared.update(node.names)
        elif isinstance(node, ast.arg):
            bind(_enclosing_scope(node, parents), node.arg, "other")
    return binds, declared


def resolve_sink_name(name: str, node: ast.AST, parents, binds) -> str:
    """What object is `name` at `node`? One of:

    `module`   — the owning scope binds it to the sink and nothing else.
    `optional` — and also to a constant: the `except ImportError: X = None` idiom.
    `shadowed` — the owning scope rebinds it while an OUTER scope calls it the
                 sink. The inner binding wins; that is the point of respecting
                 shadowing, so this is a correct NO, not a failure.
    `other`    — some other object entirely.
    `ambiguous`— sink AND a non-constant rebinding in one scope. Undecidable
                 here; named and failed rather than guessed.
    `unbound`  — no enclosing scope binds it at all.
    """
    chain = _scope_chain(node, parents)
    for i, scope in enumerate(chain):
        kinds = binds.get(id(scope), {}).get(name)
        if not kinds:
            continue
        if kinds == {"sink"}:
            return "module"
        if "sink" in kinds:
            return "optional" if kinds <= {"sink", "const"} else "ambiguous"
        for outer in chain[i + 1:]:
            outer_kinds = binds.get(id(outer), {}).get(name)
            if outer_kinds and "sink" in outer_kinds:
                return "shadowed"
        return "other"
    return "unbound"


def _dotted_of(node: ast.AST) -> str | None:
    """`a.b.c` for an attribute chain rooted in a plain Name, else None."""
    parts: list[str] = []
    cur = node
    while isinstance(cur, ast.Attribute):
        parts.append(cur.attr)
        cur = cur.value
    if isinstance(cur, ast.Name):
        parts.append(cur.id)
        return ".".join(reversed(parts))
    return None


def _literal_str(node) -> str | None:
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def emit_sites_in(source: str, rel: str, *, names: set[str] | None = None) -> dict[str, dict]:
    """`{site_id: {...}}` for every `<sink>.emit(key, severity, ...)` call.

    `site_id` is `<relpath>:<lineno>::<key>::<severity>`; a non-literal key or
    severity reads `<computed>`, and `severity` is `None` in the record so a
    caller can tell "not a string literal" from the word.

    ⛔ `names` REPRODUCES THE OLD, ALIAS-BLIND MATCHER: match these literal
    names with NO scope resolution at all. That is what makes the control below
    a real comparison rather than a filtered view of one answer.
    """
    tree = ast.parse(source)
    parents = _parents(tree)
    binds, _declared = (None, None) if names is not None else sink_bindings_in(tree, parents)
    out: dict[str, dict] = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == SINK_FUNCTION):
            continue
        if names is not None:
            if not (isinstance(func.value, ast.Name) and func.value.id in names):
                continue
            verdict, used = "module", func.value.id
        elif isinstance(func.value, ast.Name):
            used = func.value.id
            verdict = resolve_sink_name(used, node, parents, binds)
        else:
            used = _dotted_of(func.value)
            verdict = "module" if used == SINK_MODULE else "other"
        key = _literal_str(node.args[0]) if node.args else None
        sev = _literal_str(node.args[1]) if len(node.args) > 1 else None
        site = f"{rel}:{node.lineno}::{key or '<computed>'}::{sev or '<computed>'}"
        out[site] = {"rel": rel, "lineno": node.lineno, "key": key,
                     "severity": sev, "name": used, "verdict": verdict}
    return out


def chart_health_emits_in(source: str) -> list[tuple[str, str]]:
    """`(alert_key, severity)` for every literal-severity emit, ALIAS-RESOLVED.

    A computed severity argument is skipped — nothing static can be said about
    it; `api/routers/market_calendar.py` has the one instance in this tree.
    """
    return [(s["key"] if s["key"] is not None else "<computed>", s["severity"])
            for s in emit_sites_in(source, "<inline>").values()
            if s["verdict"] in ("module", "optional") and s["severity"] is not None]


def sweep_api_emit_sites() -> dict:
    """One walk of `api/**.py`; both populations derived from the same parse.

    Returns `resolved` / `blind` (the alias-blind matcher's view, keyed on the
    bare module name with no resolution) plus every verdict this walk refuses to
    act on, so none of them can be swallowed.
    """
    resolved: dict[str, dict] = {}
    blind: dict[str, dict] = {}
    ambiguous: list[str] = []
    shadowed: list[str] = []
    unbound_sink_name: list[str] = []
    global_declared: list[str] = []
    skips: list[str] = []
    for path in sorted(API_ROOT.rglob("*.py")):
        rel = path.relative_to(ROOT).as_posix()
        try:
            source = path.read_text(encoding="utf-8")
            tree = ast.parse(source)
        except (SyntaxError, UnicodeDecodeError, ValueError, OSError) as exc:
            skips.append(f"{rel}: {type(exc).__name__}")
            continue
        parents = _parents(tree)
        binds, declared = sink_bindings_in(tree, parents)
        if SINK_TAIL in declared:
            global_declared.append(rel)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if not (isinstance(func, ast.Attribute) and func.attr == SINK_FUNCTION):
                continue
            if isinstance(func.value, ast.Name):
                used = func.value.id
                verdict = resolve_sink_name(used, node, parents, binds)
            else:
                used = _dotted_of(func.value)
                verdict = "module" if used == SINK_MODULE else "other"
            key = _literal_str(node.args[0]) if node.args else None
            sev = _literal_str(node.args[1]) if len(node.args) > 1 else None
            site = f"{rel}:{node.lineno}::{key or '<computed>'}::{sev or '<computed>'}"
            rec = {"rel": rel, "lineno": node.lineno, "key": key,
                   "severity": sev, "name": used, "verdict": verdict}
            if verdict == "ambiguous":
                ambiguous.append(f"{site} (name={used})")
                continue
            if verdict == "shadowed":
                shadowed.append(f"{site} (name={used})")
                continue
            if verdict == "unbound" and used == SINK_TAIL:
                unbound_sink_name.append(site)
                continue
            if verdict not in ("module", "optional"):
                continue
            resolved[site] = rec
            # The old matcher: the bare module name, no resolution.
            if used == SINK_TAIL:
                blind[site] = rec
    return {"resolved": resolved, "blind": blind, "ambiguous": ambiguous,
            "shadowed": shadowed, "unbound_sink_name": unbound_sink_name,
            "global_declared": global_declared, "skips": skips}


#: Collected once: the sweep is the same for every test and costs a repo walk.
_SWEEP = sweep_api_emit_sites()


def _literal_severity(sites: dict[str, dict]) -> dict[str, dict]:
    return {k: v for k, v in sites.items() if v["severity"] is not None}


def _sink_sites(sites: dict[str, dict]) -> dict[str, dict]:
    """Only the calls that resolve TO THE SINK MODULE.

    ⛔ `emit_sites_in` deliberately records every `.emit()` call it sees, verdict
    included, so a caller can tell "not the sink" from "not present". Any caller
    reasoning about the population MUST apply this filter, or it is counting
    unrelated `.emit()` methods and cannot notice resolution being disabled.
    """
    return {k: v for k, v in sites.items() if v["verdict"] in ("module", "optional")}


def _by_name(sites: dict[str, dict]) -> set[tuple[str, str, str]]:
    """`(relpath, key, severity)` — the line-number-free identity of a site."""
    return {(v["rel"], v["key"], v["severity"]) for v in sites.values()
            if v["key"] is not None and v["severity"] is not None}


def _inventory(sites: dict[str, dict]) -> str:
    return "\n  ".join(sorted(sites))


# ── The two vocabularies ─────────────────────────────────────────────────────

def _nonempty(found: set[str], what: str, path: Path) -> set[str]:
    if not found:
        raise AssertionError(
            f"empty derivation of {what} from {path}. An empty result is a failed "
            "invocation, not a module that declares nothing — every membership "
            "assertion below would pass trivially over an empty set."
        )
    return found


def recognised_severities() -> frozenset[str]:
    """The ALERT scale: what `chart_health_alerts.emit`'s severity may be.

    Declared in `alerts.py` as `SEVERITY_*`; `chart_health_alerts` itself
    attaches behaviour to exactly one member (`critical` pages Discord), and
    `pager_severities()` below is cross-checked against this set so the two
    modules cannot silently disagree.
    """
    return frozenset(_nonempty(
        severity_constants_in(_read(ALERT_VOCAB_SRC)), "the alert severities", ALERT_VOCAB_SRC))


def pager_severities() -> frozenset[str]:
    """The severities `chart_health_alerts` itself branches on — i.e. pages for."""
    return frozenset(_nonempty(
        severities_compared_in(_read(PAGER_SRC)), "the pager's severities", PAGER_SRC))


def audit_diff_severities() -> frozenset[str]:
    """The AUDIT scale: `api/services/audit.py`'s per-bar diff classification."""
    src = _read(AUDIT_SRC)
    found = severities_returned_by_classifiers_in(src) | severities_compared_in(src)
    return frozenset(_nonempty(found, "the audit diff severities", AUDIT_SRC))


# ── The derivations are real (non-vacuity controls) ──────────────────────────

def test_the_alert_vocabulary_derivation_is_not_vacuous():
    found = recognised_severities()
    # A named expected member, not a count: `critical` is the word the pager
    # acts on, so a parse answering about nothing cannot satisfy this.
    assert "critical" in found, sorted(found)


def test_the_pager_derivation_reads_its_own_branch():
    assert "critical" in pager_severities(), sorted(pager_severities())


def test_the_audit_derivation_reads_its_own_scale():
    assert "fail" in audit_diff_severities(), sorted(audit_diff_severities())


def test_a_comment_or_docstring_cannot_contribute_a_severity():
    source = (
        '"""severity == "ghost_docstring" — prose, not code."""\n'
        "def f(severity):\n"
        '    # severity == "ghost_comment"\n'
        '    if severity != "real":\n'
        "        return False\n"
        "    return True\n"
    )
    found = severities_compared_in(source)
    # Control: the check still SEES a real occurrence.
    assert "real" in found, found
    assert "ghost_docstring" not in found
    assert "ghost_comment" not in found


def test_a_commented_out_severity_constant_cannot_contribute():
    source = (
        "# SEVERITY_GHOST = \"ghost\"\n"
        'SEVERITY_REAL = "real"\n'
        'OTHER_NAME = "not_a_severity"\n'
    )
    found = severity_constants_in(source)
    assert found == {"real"}, found


def test_the_pager_word_is_a_member_of_the_declared_vocabulary():
    """If this fails, the derivation is pointed at the wrong authority — say so
    rather than letting a membership check pass on an unrelated set."""
    assert pager_severities() <= recognised_severities(), (
        sorted(pager_severities()), sorted(recognised_severities()))


# ── What the sets may and may not contain ────────────────────────────────────

def test_the_two_scales_are_disjoint_so_a_literal_is_attributable():
    overlap = recognised_severities() & audit_diff_severities()
    assert not overlap, (
        f"the alert scale and the audit diff scale now share {sorted(overlap)} — "
        "a literal in _run_detect_only is no longer attributable to one of them "
        "by reading it, which is exactly how the `warn` defect survived."
    )


def test_warn_is_not_an_alert_severity_but_is_an_audit_one():
    """The defect, in one line: the right word, on the wrong scale."""
    assert "warn" not in recognised_severities()
    assert "warn" in audit_diff_severities()


@pytest.mark.parametrize("invented", ["catastrophic", "notice", "severe", "WARNING", "error"])
def test_an_invented_severity_word_cannot_pass(invented):
    assert invented not in recognised_severities()


# ── The alias resolution is real, and is LOAD-BEARING ────────────────────────

def test_ALIAS_RESOLUTION_IS_LOAD_BEARING_and_finds_the_function_local_import():
    """⭐⭐ THE CONTROL THAT MAKES THE ALIAS PATH PROVABLY NECESSARY.

    Both populations are derived by the same function on the same file: once
    alias-resolved, once through the OLD matcher (`names=`, the bare module name
    with no resolution). The second must find STRICTLY FEWER, and this names
    exactly which sites it loses. A control asserting only that both are
    non-empty would prove nothing at all.

    Shape borrowed from `tests/test_term018_every_guard_can_fire.py::
    test_ALIAS_RESOLUTION_IS_LOAD_BEARING_and_finds_the_function_local_import`
    rather than reinvented, because that one already works.
    """
    src = _read(ROOT / ALIAS_SRC_REL)
    # ⛔ `_sink_sites` IS LOAD-BEARING IN THIS LINE, and the first draft of this
    # test did not have it. `emit_sites_in` records EVERY `.emit()` call with its
    # verdict, so reading it unfiltered counts the four sites even when alias
    # resolution is switched off entirely — the control passed its own mutation.
    # Measured: mutation m1 (bare-name matcher) left this test green until the
    # filter went in. A control that cannot fail is not a control.
    resolved = _sink_sites(emit_sites_in(src, ALIAS_SRC_REL))
    blind = emit_sites_in(src, ALIAS_SRC_REL, names={SINK_TAIL})

    assert resolved, (
        f"the alias-resolved derivation found NO emit site in {ALIAS_SRC_REL}. "
        "An empty result is a failed invocation, and every comparison below "
        "would pass trivially over it. These four are what it must find, and "
        "they are invisible to a bare-name matcher:\n  "
        + "\n  ".join(f"{k}::{s}" for _rel, k, s in ALIAS_ONLY_SITES)
    )
    assert len(blind) < len(resolved), (
        "the alias-blind matcher now finds as much as the alias-resolved one — "
        "re-read this test's docstring before relaxing it; if the file stopped "
        "using an alias, this control has stopped controlling anything."
    )
    assert not blind, (
        f"the alias-blind derivation now finds sites in {ALIAS_SRC_REL}: "
        f"{sorted(blind)}"
    )
    missing = _by_name(resolved) - _by_name(blind)
    assert missing == set(ALIAS_ONLY_SITES), (
        "the sites only the alias-resolved matcher can see have changed.\n"
        f"  expected: {sorted(ALIAS_ONLY_SITES)}\n  derived : {sorted(missing)}"
    )
    # Named, not counted: both tiers of the guard pair this wave fixed.
    for key, sev in (("intraday_hotset_stale", "critical"),
                     ("intraday_hotset_stale", "warning"),
                     ("bars_store_unhealthy", "critical"),
                     ("bars_daily_store_stale", "critical")):
        assert (ALIAS_SRC_REL, key, sev) in _by_name(resolved), (
            key, sev, sorted(_by_name(resolved)))


def test_the_REPO_WIDE_sweep_loses_exactly_the_alias_sites_when_it_is_alias_blind():
    """The same control one level up, over `api/**`, and the sentence the old
    commit message got wrong: the alias-blind sweep is not "every" emit site."""
    resolved = _literal_severity(_SWEEP["resolved"])
    blind = _literal_severity(_SWEEP["blind"])
    assert len(blind) < len(resolved), (
        f"the alias-blind sweep now finds {len(blind)} of the alias-resolved "
        f"sweep's {len(resolved)} literal-severity sites, so the alias path is "
        "buying nothing. Either the tree stopped using an alias, or resolution "
        "has been switched off. These four are the sites only resolution can "
        "reach:\n  " + "\n  ".join(f"{r}::{k}::{s}" for r, k, s in ALIAS_ONLY_SITES)
    )
    missing = _by_name(resolved) - _by_name(blind)
    assert missing == set(ALIAS_ONLY_SITES), (
        "the repo-wide alias-only set has moved.\n"
        f"  expected: {sorted(ALIAS_ONLY_SITES)}\n  derived : {sorted(missing)}\n"
        f"resolved inventory:\n  {_inventory(resolved)}"
    )
    assert len(resolved) - len(blind) == len(ALIAS_ONLY_SITES), (
        len(resolved), len(blind))


def test_the_alias_collector_ignores_a_commented_out_or_prose_import():
    """CONTROL: an alias can only come from a real import node.

    Nothing in this file matches source TEXT, and this is the proof for the
    alias half specifically — with a REAL import beside the ghosts so the check
    cannot pass by seeing nothing at all.
    """
    source = (
        '"""from api.services import chart_health_alerts as _ghost_doc — prose."""\n'
        "def f():\n"
        "    # from api.services import chart_health_alerts as _ghost_comment\n"
        "    from api.services import chart_health_alerts as _real\n"
        '    _real.emit("k", "critical", "m")\n'
        '    _ghost_doc.emit("k", "nonsense", "m")\n'
        '    _ghost_comment.emit("k", "nonsense", "m")\n'
    )
    sites = emit_sites_in(source, "planted.py")
    kept = {v["name"] for v in sites.values() if v["verdict"] in ("module", "optional")}
    assert kept == {"_real"}, sites          # ← the control is `_real` surviving
    assert "nonsense" not in {v["severity"] for v in sites.values()
                              if v["verdict"] in ("module", "optional")}


def test_shadowing_is_RESPECTED_a_rebound_local_is_not_the_module():
    """Proved on a planted fixture, because this tree contains no live instance.

    An inner rebinding must win over an outer sink import, or the resolver would
    count an unrelated object's `.emit()` as an alert — which is the same class
    of error as missing one, pointing the other way.
    """
    source = (
        "from api.services import chart_health_alerts\n"
        "def outer():\n"
        '    chart_health_alerts.emit("outer_key", "critical", "m")\n'
        "def inner():\n"
        "    chart_health_alerts = SomethingElse()\n"
        '    chart_health_alerts.emit("inner_key", "not_a_severity", "m")\n'
    )
    sites = emit_sites_in(source, "planted.py")
    verdicts = {v["key"]: v["verdict"] for v in sites.values()}
    assert verdicts["outer_key"] == "module", verdicts   # ← the control
    assert verdicts["inner_key"] == "shadowed", verdicts


def test_the_optional_import_idiom_still_resolves_to_the_module():
    """`api/routers/push.py`'s live shape: sink import plus `X = None` fallback.

    Resolving it as "not the module" would drop a real site — the defect this
    fix exists to remove, re-committed by being too clever about shadowing.
    """
    source = (
        "try:\n"
        "    from api.services import chart_health_alerts\n"
        "except ImportError:\n"
        "    chart_health_alerts = None\n"
        "def f():\n"
        "    if chart_health_alerts is not None:\n"
        '        chart_health_alerts.emit("k", "warning", "m")\n'
    )
    sites = emit_sites_in(source, "planted.py")
    assert [v["verdict"] for v in sites.values()] == ["optional"], sites
    # And the live instance is in the swept population, by name.
    assert ("api/routers/push.py", "taxonomy_version_mismatch", "warning") \
        in _by_name(_SWEEP["resolved"]), sorted(_by_name(_SWEEP["resolved"]))


def test_a_sink_rebound_to_a_NON_constant_is_reported_never_guessed():
    """The undecidable case fails loudly instead of being resolved either way."""
    source = (
        "from api.services import chart_health_alerts\n"
        "chart_health_alerts = pick_a_sink()\n"
        'chart_health_alerts.emit("k", "critical", "m")\n'
    )
    sites = emit_sites_in(source, "planted.py")
    assert [v["verdict"] for v in sites.values()] == ["ambiguous"], sites


# ── The sweep is complete, and its size is PINNED ────────────────────────────

def test_the_sweep_read_every_file_it_walked():
    assert not _SWEEP["skips"], (
        f"files skipped during the sweep: {_SWEEP['skips']}. An emit site in an "
        "unreadable file is invisible to this rail, which is why the skip list "
        "is asserted empty instead of swallowed by an `except: continue`."
    )


def test_the_sweep_has_nothing_it_refused_to_decide():
    """Every verdict this walk will not act on, asserted absent BY NAME.

    Each is a hole the resolver declines to guess about (module docstring,
    "DOES NOT"). Zero of each today; one arriving fails here rather than
    quietly shrinking or inflating the population.
    """
    assert not _SWEEP["ambiguous"], (
        f"a scope binds a sink alias both to the module and to a non-constant "
        f"expression: {_SWEEP['ambiguous']}. Which object `.emit()` is called on "
        "there is not decidable by this walk — disambiguate the code, or widen "
        "this rail deliberately."
    )
    assert not _SWEEP["unbound_sink_name"], (
        f"`{SINK_TAIL}.emit()` is called where no enclosing scope binds that "
        f"name: {_SWEEP['unbound_sink_name']}. A star import can do this, and "
        "this resolver does not model star imports."
    )
    assert not _SWEEP["global_declared"], (
        f"`global {SINK_TAIL}` / `nonlocal {SINK_TAIL}` appears in "
        f"{_SWEEP['global_declared']} — this resolver does not model either."
    )


def test_the_swept_population_is_PINNED_not_floored():
    """⛔⛔ THE CLAUSE THAT CAN NOTICE A 4-SITE DROP.

    The floor this replaces was `seen >= 10` against a population of 21: it
    could not distinguish 17 from 21, so it sat green beside a matcher missing
    a fifth of the tree. See `EXPECTED_LITERAL_SEVERITY_SITES` for why this is
    an exact pin rather than a tighter floor.
    """
    sites = _SWEEP["resolved"]
    lits = _literal_severity(sites)
    fewer = (
        "FEWER than pinned — sites have VANISHED, which is the regression this "
        "pin exists to catch. Look for a deleted guard, or for a matcher that "
        "stopped resolving an alias, BEFORE you touch the number."
    )
    more = (
        "MORE than pinned — a new emit site was added. That is fine and expected: "
        "update EXPECTED_LITERAL_SEVERITY_SITES (and EXPECTED_EMIT_SITES) in the "
        "SAME commit that adds the site, so the number stays a measurement rather "
        "than becoming a floor nobody trusts."
    )
    assert len(lits) == EXPECTED_LITERAL_SEVERITY_SITES, (
        f"{len(lits)} literal-severity chart_health_alerts.emit() sites under "
        f"api/, pinned at {EXPECTED_LITERAL_SEVERITY_SITES}.\n"
        f"{fewer if len(lits) < EXPECTED_LITERAL_SEVERITY_SITES else more}\n"
        f"derived inventory:\n  {_inventory(lits)}"
    )
    assert len(sites) == EXPECTED_EMIT_SITES, (
        f"{len(sites)} emit sites in total (literal + computed severity), pinned "
        f"at {EXPECTED_EMIT_SITES}. A literal severity turned into a computed "
        "one would shrink the literal count while leaving this one alone, which "
        "is why both are pinned.\n"
        f"computed-severity sites: "
        f"{sorted(set(sites) - set(_literal_severity(sites)))}"
    )


def test_the_pinned_count_is_not_satisfiable_by_the_WRONG_SET():
    """A COUNT can be satisfied by the wrong set, so name members too.

    These four are the ones the old matcher could not see. If a future edit
    keeps the count and loses them, the count says nothing and this fails.
    """
    derived = _by_name(_SWEEP["resolved"])
    missing = [s for s in ALIAS_ONLY_SITES if s not in derived]
    assert not missing, (
        f"the sweep no longer finds sites it names by name: {missing}\n"
        f"derived:\n  {_inventory(_SWEEP['resolved'])}"
    )


# ── The product side, read statically ────────────────────────────────────────

def test_every_alert_the_reconciler_emits_uses_a_recognised_severity():
    emitted = chart_health_emits_in(_read(RECONCILER_SRC))
    # Non-vacuity: the module does emit, so the assertion below has a subject.
    assert emitted, "no chart_health_alerts.emit() with a literal severity found"
    recognised = recognised_severities()
    bad = [(k, s) for k, s in emitted if s not in recognised]
    assert not bad, (
        f"emit() called with a severity outside the declared vocabulary: {bad}; "
        f"recognised = {sorted(recognised)}"
    )


def test_the_reconcilers_alert_severity_is_never_the_audit_scales_word():
    emitted = chart_health_emits_in(_read(RECONCILER_SRC))
    assert emitted
    audit_scale = audit_diff_severities()
    crossed = [(k, s) for k, s in emitted if s in audit_scale]
    assert not crossed, (
        f"an audit diff severity was passed as an alert severity: {crossed}. "
        "These are two scales; see this module's docstring."
    )


def test_the_reconcilers_diff_filters_stay_on_the_audit_scale():
    """The mirror of the test above, and the one that stops the WRONG fix.

    `_run_detect_only` filters `d.severity == "fail"` / `== "warn"`. Renaming
    either to the alert scale's word would make the predicate select zero rows
    SILENTLY — no exception, no red, just a count that is always 0. So the
    filters are pinned to the audit scale, derived from `audit.py`.
    """
    compared = severities_compared_in(_read(RECONCILER_SRC))
    assert compared, "no `severity` comparison found in the reconciler"
    audit_scale = audit_diff_severities()
    off_scale = sorted(compared - audit_scale)
    assert not off_scale, (
        f"the reconciler filters `severity` against {off_scale}, which audit.py "
        f"never produces (its scale is {sorted(audit_scale)}) — that predicate "
        "matches nothing and fails silently."
    )


def test_the_daily_drift_alert_is_deliberately_not_a_page():
    """Pins the RULING, not just the spelling.

    Detect-only never heals, so a drifted CLOSED daily bar stays drifted and is
    re-detected every time its ticker is resampled: `_CYCLE_SECONDS` 1800 with a
    24/7 loop is 48 cycles/day, `_DETECT_PAIRS_PER_CYCLE` 12 (half of them drawn
    from `_PRIORITY_TICKERS`' 24 names), and the alert_key is a CONSTANT, so one
    unhealed bar on a priority ticker alerts ~12x/day, ceiling 48/day. That is
    routine, and `critical` is what pages Discord. If a future session wants
    this to page, that is a decision — and this line is where it is taken.
    """
    emitted = dict(chart_health_emits_in(_read(RECONCILER_SRC)))
    assert "daily_drift_detected" in emitted, sorted(emitted)
    assert emitted["daily_drift_detected"] not in pager_severities(), (
        "the daily-drift alert now pages; re-derive the frequency first"
    )


def test_no_chart_health_emit_under_api_uses_an_unrecognised_severity():
    """Repo-wide, because the defect class is one call site away from any module.

    ⭐ The four alias-only sites had NEVER been checked against the two-scale
    rule before this sweep could see them. They pass: three `critical` and one
    `warning`, all on the declared alert scale. Had one of them been off-scale
    the finding would be reported, never papered over by widening a vocabulary
    to fit an unswept site — which is how `warn`/`warning` happened.
    """
    recognised = recognised_severities()
    bad = [(v["rel"], v["lineno"], v["key"], v["severity"])
           for v in _literal_severity(_SWEEP["resolved"]).values()
           if v["severity"] not in recognised]
    assert not bad, (
        f"unrecognised alert severities: {bad}; recognised = {sorted(recognised)}"
    )


def test_the_four_recovered_alias_sites_are_on_the_declared_scale():
    """The same assertion narrowed to the four sites the fix recovered, so a
    regression on THEM cannot hide inside a repo-wide pass."""
    recognised = recognised_severities()
    audit_scale = audit_diff_severities()
    for rel, key, sev in ALIAS_ONLY_SITES:
        assert sev in recognised, (rel, key, sev, sorted(recognised))
        assert sev not in audit_scale, (
            f"{rel}::{key} emits {sev!r}, which is an AUDIT diff severity — the "
            "cross-scale defect, in a site no rail had ever swept."
        )
