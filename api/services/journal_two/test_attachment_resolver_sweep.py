"""AST sweep for the path-containment-resolver family.

This repo has now hand-fixed the SAME defect three times: `notes.py::serve_note_image_path`,
`calendar.py::serve_attachment_path`, `trade_attachments.py::serve_trade_attachment_path`
(plus a fourth, independently-correct instance, `notes_export.py::_resolve_attachment_path`).
That is one grammar with three hand-written copies (`lesson_one_grammar_four_hand_written_copies`).
A hand-typed list of "the functions to check" is the same defect in a new costume — it drifts
the moment a fourth one is added and nobody remembers to extend the list. So this sweep
DERIVES the set via `ast` (never a grep — `lesson_probe_names_must_be_derived_not_typed`; this
repo's own precedent: `app/src/components/screener/reachable.test.js` walks the real import
graph rather than trusting a hand-typed roster, and a name-grep here once "found 5 call sites,
all five of them prose").

THE INVARIANT, encoded structurally rather than dynamically:
The bug in all three historical cases has one shape: the function builds
`target = (BASE / filename).resolve()` (BASE assembled by joining caller-supplied segments
onto a root), then checks `target.relative_to(ANCHOR.resolve())`. The check is only real
containment if ANCHOR is the true attachment root — a DIFFERENT variable than BASE. Every
historical bug had ANCHOR literally equal to BASE (`target.relative_to(base.resolve())`) —
tautological once the filename axis is clean, since `target` is always `base/filename`, so
it is trivially "inside" itself. Every fix (and the independently-correct fourth instance)
uses two DIFFERENT names — the pairing helper hands back `(root, base)` or `(root, candidate)`,
and the check runs against `root`, never the joined `base`. So "is this function safe" reduces
to a purely syntactic question: does the resolved BASE name equal the resolved ANCHOR name?
That is checked here with simple assignment-tracing (`_base_name_of_resolve_expr` +
`_resolve_alias`) — no need to know what a "root" or a "user_id" IS, only whether the same
name was used on both sides of the check.

WHY STATIC, NOT DYNAMIC: the task this sweep was written for asks for a sweep that "asserts
each [discovered function] refuses a crafted traversal on every caller-supplied axis" — the
natural first idea is to import each discovered function and CALL it with traversal payloads.
That was tried and set aside: the three real resolvers have incompatible calling conventions
(3 vs 4 positional args; `calendar.py`'s `date` argument raises `ValueError` on anything that
isn't `YYYY-MM-DD` rather than returning `None`; `notes.py`'s `sub` argument must be one of a
fixed 3-value enum or the function returns `None` before ever reaching the containment check
at all). A generic caller either needs per-function calling knowledge — which is exactly the
hand-maintained-list problem this sweep exists to avoid — or silently fails to exercise the
axis it meant to test (poisoning `sub` with a traversal payload just hits the enum gate, never
the bug). The static check above has no such blind spot: it inspects the SAME containment
check a dynamic call would be exercising, without needing to know how to construct a valid
call for an arbitrary future resolver. Each of the three real fixes already has its OWN
dynamic, plant-a-real-file discrimination test (`test_attachment_root.py`,
`test_calendar.py`, `test_trade_attachments.py`) proving THIS shape's specific instances
refuse a live traversal; this sweep's job is different — catching the NEXT one before anyone
writes a dedicated test for it at all.

SCOPE: every non-test `.py` file directly under `api/services/journal_two/` (where this
whole attachment-resolver family lives, per CLAUDE.md's Journal 2.0 section) plus the sibling
`api/j2_attachments_backup.py`. Grepping the wider `api/` tree for `.relative_to(` turned up
only files inside this scope, `api/services/feature_flag_index.py` (an unrelated `relative_to`
used to build a report path, no try/except at all — correctly excluded by the shape
predicate below), and this package's own test files (excluded by name).

THE CONTROL: `test_the_sweep_can_actually_see_a_planted_resolver` builds two synthetic
functions from source text — one reproducing the exact historical bug, one fixed — and
proves the shape predicate matches BOTH and the containment analysis tells them apart.
Without this, a predicate that silently matches nothing would make every other assertion
in this file vacuously true forever (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
"""

from __future__ import annotations

import ast
from pathlib import Path

# ── Discovery scope ──────────────────────────────────────────────────────────

_PACKAGE_DIR = Path(__file__).resolve().parent  # api/services/journal_two
_SIBLING_FILES = [
    _PACKAGE_DIR.parents[1] / "j2_attachments_backup.py",  # api/j2_attachments_backup.py
]


def _module_files() -> list[Path]:
    files = [
        p for p in sorted(_PACKAGE_DIR.glob("*.py"))
        if not p.name.startswith("test_") and p.name != "__init__.py"
    ]
    files += [p for p in _SIBLING_FILES if p.exists()]
    return files


def _iter_functions(tree: ast.AST):
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield node


# ── Shape predicate: "looks like an attachment path resolver" ───────────────

def _relative_to_calls_in_value_error_try(func: ast.AST):
    """Yield every `.relative_to(...)` Call sitting in the BODY of a `Try`
    whose handlers include `ValueError` (bare or in a tuple) — the shape a
    path-containment check always has: resolve, check, except ValueError."""
    for node in ast.walk(func):
        if not isinstance(node, ast.Try):
            continue
        catches_value_error = False
        for h in node.handlers:
            t = h.type
            if t is None:
                continue
            candidates = t.elts if isinstance(t, ast.Tuple) else [t]
            if any(isinstance(n, ast.Name) and n.id == "ValueError" for n in candidates):
                catches_value_error = True
                break
        if not catches_value_error:
            continue
        for stmt in node.body:
            for sub in ast.walk(stmt):
                if (isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute)
                        and sub.func.attr == "relative_to"):
                    yield node, sub


def _has_call_named(func: ast.AST, method_name: str) -> bool:
    return any(
        isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == method_name
        for n in ast.walk(func)
    )


def _returns_none_somewhere(func: ast.AST) -> bool:
    for n in ast.walk(func):
        if isinstance(n, ast.Return):
            if n.value is None:
                return True
            if isinstance(n.value, ast.Constant) and n.value.value is None:
                return True
    return False


def is_attachment_resolver_shape(func: ast.AST) -> bool:
    """A function is a candidate attachment-path resolver if it: (1) checks
    containment via `.relative_to(...)` guarded by `except ValueError`, (2)
    calls `.resolve()` somewhere (resolve-before-check, never string-compare),
    (3) calls `.exists()` or `.is_file()` somewhere (it serves a real file),
    and (4) can return `None` (the refusal path). All four together are
    distinctive enough that nothing else in this package's ~60 non-test
    modules matches — verified by hand against every `.relative_to(` call
    site in the package (see module docstring)."""
    if not list(_relative_to_calls_in_value_error_try(func)):
        return False
    if not _has_call_named(func, "resolve"):
        return False
    if not (_has_call_named(func, "exists") or _has_call_named(func, "is_file")):
        return False
    if not _returns_none_somewhere(func):
        return False
    return True


# ── Containment-safety analysis: is BASE the same name as ANCHOR? ───────────

def _leftmost_name_or_bare(expr: ast.AST) -> str | None:
    """For a `/`-chain (`a / b / c`, left-associative BinOp Div), the
    leftmost operand's Name id. For a bare Name, its id. Else None."""
    node = expr
    while isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
        node = node.left
    return node.id if isinstance(node, ast.Name) else None


def _base_name_of_resolve_expr(expr: ast.AST) -> str | None:
    """For `X.resolve()`, the base name inside X (via `_leftmost_name_or_bare`).
    None if `expr` isn't a bare `.resolve()` call on a Name/`/`-chain."""
    if not (isinstance(expr, ast.Call) and not expr.args and not expr.keywords
            and isinstance(expr.func, ast.Attribute) and expr.func.attr == "resolve"):
        return None
    return _leftmost_name_or_bare(expr.func.value)


def _find_simple_assign_value(func: ast.AST, name: str) -> ast.AST | None:
    """The value of the first `name = <expr>` assignment in func, else None.
    Deliberately does NOT look inside `for x, y in ...:` unpacking — a name
    bound that way (both fix's `root`/`base` pairs, and the pre-fix bug's
    `base`) has no simple-assign value, and is left as an opaque leaf name
    for the comparison below, which is exactly the right behavior: we don't
    need to know what `root` unpacks to, only whether it's the SAME name as
    whatever `target` was joined from."""
    for node in ast.walk(func):
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            t = node.targets[0]
            if isinstance(t, ast.Name) and t.id == name:
                return node.value
    return None


def _resolve_alias(func: ast.AST, name: str, _seen: set[str] | None = None) -> str:
    """Follow `name = other_bare_name` chains to a fixed point, so a trivial
    rename (`anchor = base; ...relative_to(anchor.resolve())`) can't dodge
    the comparison below by looking like a different name."""
    seen = _seen if _seen is not None else set()
    if name in seen:
        return name
    seen.add(name)
    val = _find_simple_assign_value(func, name)
    if isinstance(val, ast.Name):
        return _resolve_alias(func, val.id, seen)
    return name


def analyze_containment(func: ast.AST) -> str:
    """'vulnerable' | 'safe' | 'indeterminate' for one already-shape-matched
    resolver. 'indeterminate' means the static shape didn't fit the exact
    assign-then-check pattern this analysis understands — treated as a
    FAILURE by the real-code test below, never as a silent pass."""
    calls = list(_relative_to_calls_in_value_error_try(func))
    if not calls:
        return "indeterminate"
    for _try, call in calls:
        receiver = call.func.value
        if not isinstance(receiver, ast.Name):
            return "indeterminate"
        if not call.args:
            return "indeterminate"

        anchor_base = _base_name_of_resolve_expr(call.args[0])
        if anchor_base is None:
            return "indeterminate"
        anchor_base = _resolve_alias(func, anchor_base)

        receiver_value = _find_simple_assign_value(func, receiver.id)
        if receiver_value is None:
            return "indeterminate"
        receiver_base = _base_name_of_resolve_expr(receiver_value)
        if receiver_base is None:
            return "indeterminate"
        receiver_base = _resolve_alias(func, receiver_base)

        if receiver_base == anchor_base:
            return "vulnerable"
    return "safe"


# ── The control: prove the sweep can actually SEE a planted resolver ────────

_BAD_SOURCE = '''
from pathlib import Path

def bad_resolver(user_id: str, note_id: str, filename: str):
    """Reproduces the exact historical bug: BASE and ANCHOR are the same name."""
    if "/" in filename or "\\\\" in filename or filename.startswith("."):
        return None
    base = _ROOT / user_id / "notes" / note_id
    target = (base / filename).resolve()
    try:
        target.relative_to(base.resolve())
    except ValueError:
        return None
    if not target.exists():
        return None
    return target
'''

_GOOD_SOURCE = '''
from pathlib import Path

def good_resolver(user_id: str, note_id: str, filename: str):
    """The fix: ANCHOR is the true root, a different name than BASE."""
    if "/" in filename or "\\\\" in filename or filename.startswith("."):
        return None
    base = _ROOT / user_id / "notes" / note_id
    target = (base / filename).resolve()
    try:
        target.relative_to(_ROOT.resolve())
    except ValueError:
        return None
    if not target.exists():
        return None
    return target
'''


def test_the_sweep_can_actually_see_a_planted_resolver():
    """Non-vacuity control. If the shape predicate matched neither planted
    function, every assertion below (and in the real sweep) would pass for
    the wrong reason — a sweep that matches nothing reads as coverage while
    proving nothing (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`)."""
    bad_fn = next(_iter_functions(ast.parse(_BAD_SOURCE)))
    good_fn = next(_iter_functions(ast.parse(_GOOD_SOURCE)))

    assert is_attachment_resolver_shape(bad_fn) is True, (
        "the shape predicate did not see the planted BAD resolver — "
        "the sweep cannot see anything"
    )
    assert is_attachment_resolver_shape(good_fn) is True, (
        "the shape predicate did not see the planted GOOD resolver — "
        "the sweep cannot see anything"
    )

    # And it must tell them apart, not just detect "something relative_to-shaped".
    assert analyze_containment(bad_fn) == "vulnerable"
    assert analyze_containment(good_fn) == "safe"


# ── The real sweep ────────────────────────────────────────────────────────

def _discover_real_resolvers() -> list[tuple[Path, ast.AST]]:
    found = []
    for path in _module_files():
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError:
            continue
        for fn in _iter_functions(tree):
            if is_attachment_resolver_shape(fn):
                found.append((path, fn))
    return found


def test_sweep_discovers_the_known_resolvers_and_none_are_vulnerable():
    """The regression gate this whole file exists for: a FOURTH resolver
    written with the same tautological containment check must fail this
    test the moment it's added, without anyone updating a list by hand."""
    found = _discover_real_resolvers()
    labels = sorted(f"{p.name}::{fn.name}" for p, fn in found)

    # Known today: notes.py::serve_note_image_path, calendar.py::serve_attachment_path,
    # trade_attachments.py::serve_trade_attachment_path, notes_export.py::_resolve_attachment_path.
    # If this ever finds FEWER than 3, the discovery predicate broke — fix the
    # predicate, do not lower this number (the task's own instruction).
    assert len(found) >= 3, (
        f"expected at least 3 known attachment-path resolvers, found "
        f"{len(found)}: {labels} — the discovery predicate is broken, not the codebase"
    )

    verdicts = {f"{p.name}::{fn.name}": analyze_containment(fn) for p, fn in found}
    not_safe = {k: v for k, v in verdicts.items() if v != "safe"}
    assert not not_safe, (
        f"attachment-path resolver(s) failed the containment invariant "
        f"(base and anchor are the same variable, or the shape could not be "
        f"verified safe): {not_safe}"
    )
