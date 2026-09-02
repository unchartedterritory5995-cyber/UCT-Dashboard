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
and the check runs against `root`, never the joined `base`.

THE ANCHOR MUST BE PROVEN, NOT ASSUMED (fix round 1): the first version of this file reduced
"is this function safe" to "does the resolved BASE name equal the resolved ANCHOR name",
resolving trivial aliases (`anchor = base`) but falling back to treating ANY other
assignment shape as an independent, trustworthy leaf. A reviewer built
`anchor = _passthrough_anchor(base)` (an identity helper — the same object as `base` at
runtime) and the sweep called it `"safe"`: the exact tautology bug, laundered through one
level of indirection the old alias-resolver couldn't see through. The classifier's DEFAULT
was backwards — it reached `"safe"` unless it could show otherwise, when a static analyser
must do the opposite. `_resolve_anchor_root` now reaches `"safe"` ONLY when the anchor's
provenance is a bare-name alias chain or has NO local assignment at all (a module-level
global, or a `for x, y in ...:` tuple-unpack target — the exact shape every real fix uses).
Anything else the anchor passes through — a helper call, a lambda, an attribute chain, a
subscript, a binop — is now `indeterminate`, which fails the sweep rather than passing it.
The RECEIVER's base name (`_resolve_receiver_alias`) keeps the old, permissive tracing: it
is a LABEL for the known-tainted side of the comparison, not a claim that needs proving, so
an opaque or absent assignment there is fine to leave as-is. See
`test_identity_helper_indirection_is_not_trusted_as_safe` and
`test_lambda_indirection_is_not_trusted_as_safe` for the reviewer's exact adversarial shape,
kept as permanent fixtures — and the "Containment-safety analysis" section below for the
full mechanics.

THE STATED LIMIT MUST BE THE REAL LIMIT (fix round 2): after round 1 shipped, a second
reviewer pointed out that its disclosed gap ("a `for` loop iterating a single-element list
holding `base`") understated the true scope — `_lookup_simple_assign` recognized ONLY a
single-target `Name = <expr>` assign, so ANY other binding form was equally invisible to it,
and an anchor bound that way, even when PROVABLY the same object as `base` at runtime, still
read `"safe"`. A documented limit narrower than the real one is the same defect this whole
file exists to fix, in the one artifact a future engineer reads to decide whether to trust
the sweep. `_lookup_simple_assign` was widened to also recognize CHAINED assignment
(`anchor = other = base`) and determinable-position TUPLE/LIST assignment
(`anchor, other = base, base` — only when target and value are same-length literal
tuples/lists with no starred element) — both common, cheap to recognize exactly, and
covered by `test_tuple_assignment_indirection_is_now_detected` /
`test_chained_assignment_indirection_is_now_detected`. THREE forms remain real, standing
blind spots — not fixed, on purpose, per this task's own brief against general dataflow
analysis: starred unpacking (`anchor, *rest = [base]`), `with ... as anchor:`, and a `for`
target (`for anchor in [base]:`, used ON PURPOSE by every real fix's own `root`/`base` pair,
so it can never simply be banned). An anchor disguised through any of these three still
reads `"safe"` today. Each has a permanent PINNING fixture —
`test_star_unpack_indirection_is_a_known_blind_spot`,
`test_with_as_indirection_is_a_known_blind_spot`,
`test_for_loop_single_value_indirection_is_a_known_blind_spot` — asserting that CURRENT
`"safe"` result, so a future change that accidentally closes (or widens) any of them shows
up as a test diff, never a silent surprise. See `_lookup_simple_assign`'s own docstring for
the exact recognized/not-recognized boundary.

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
inside its own `try`/`except ValueError`, used to build a repo-relative report path — but
with no `.resolve()` call and no reachable `return None` anywhere in the function, so the
shape predicate correctly excludes it for those two reasons, not for lacking a `try`/`except`
at all), and this package's own test files (excluded by name).

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


def _function_named(tree: ast.AST, name: str) -> ast.AST:
    """The FunctionDef called `name` in `tree`, by NAME — never `next(...)`
    on `_iter_functions` alone. `ast.walk` is breadth-first over the whole
    module, so a fixture source that defines a helper function BEFORE the
    resolver under test (e.g. `_IDENTITY_HELPER_SOURCE` below, which needs
    `_passthrough_anchor` defined first) would hand `next()` the helper,
    not the resolver — a real ordering bug caught here while writing the
    adversarial fixtures, not a hypothetical one."""
    for fn in _iter_functions(tree):
        if fn.name == name:
            return fn
    raise AssertionError(f"no function named {name!r} in the parsed fixture source")


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
#
# FAIL-SAFE BY CONSTRUCTION (fix round 1 — see module docstring's "THE
# ANCHOR MUST BE PROVEN, NOT ASSUMED" section): the two sides of the
# comparison below are deliberately asymmetric.
#
#   - The RECEIVER's base name (what `target` was joined from) is just a
#     LABEL — we don't need to prove anything about it; it's the known-
#     tainted side by definition. `_resolve_receiver_alias` follows only
#     bare-name aliases and otherwise returns the name unchanged, including
#     when the name has no local assignment at all (free — a for-loop
#     tuple-unpack target) or an assignment to something else entirely (a
#     `/`-chain, which is the NORMAL, transparent shape `base` always has).
#
#   - The ANCHOR name must be PROVEN independent of the receiver's base
#     before this analysis calls a resolver `safe`. `_resolve_anchor_root`
#     accepts exactly two shapes as proof: (a) a bare-name-to-bare-name
#     alias chain, or (b) a name with NO local assignment at all (a
#     module-level global like `_ATTACHMENT_ROOT`, or a for-loop
#     tuple-unpack target like the `root` in `for root, base in
#     read_candidates_with_roots(rel):` — the exact shape every real fix
#     uses). ANYTHING ELSE the anchor's provenance passes through — a
#     helper call, a lambda, an attribute chain, a subscript, a binop —
#     returns `None` ("cannot prove"), which `analyze_containment` treats
#     as `indeterminate`, never `safe`.
#
# This closes the exact hole a reviewer found in round 1: `anchor =
# _passthrough_anchor(base)` (an identity helper — the same object as
# `base` at runtime) used to slip through as `"safe"` because the old,
# single `_resolve_alias` gave up on non-bare-Name assignments by silently
# treating the name as a trustworthy independent leaf — the same fallback
# for "truly free" and "assigned to something opaque" alike. Now only the
# first is trusted; the second fails the sweep. See
# `test_identity_helper_indirection_is_not_trusted_as_safe` and
# `test_lambda_indirection_is_not_trusted_as_safe` below — both are the
# reviewer's exact adversarial shape, kept as permanent regression fixtures.

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


def _lookup_simple_assign(func: ast.AST, name: str) -> tuple[bool, ast.AST | None]:
    """`(True, value)` for the first binding of `name` this analysis can
    positively resolve to a single value expression, else `(False, None)`.
    The `bool` matters: "no assignment found" (a module-level global, or a
    binding form below that is deliberately NOT recognized) and "assigned
    to something this analysis can't see through" are DIFFERENT facts —
    collapsing them into one `None` return was fix round 1's bug.

    RECOGNIZED (fix round 2 widened this from single-target-only):
      - `name = <expr>` — a single-target assign.
      - `name = other = <expr>` — a CHAINED assign; every target in one
        `Assign` node is bound to the SAME value, so `name` at ANY target
        position resolves to that one `value`.
      - `name, other = <expr1>, <expr2>` — a tuple/list assign, ONLY when
        both the target and the value are literal `Tuple`/`List` nodes of
        the SAME length with no starred element anywhere — so which value
        goes with `name` is determinable by position alone, with no need
        to evaluate anything.

    When `name` sits in a tuple/list target whose value is NOT such a
    matching literal (e.g. `a, b = some_call()`), this returns
    `(True, None)` — "found, but the value can't be seen" — which the
    anchor-side analysis (`_resolve_anchor_root`) treats exactly like any
    other opaque expression: `indeterminate`, never a silent "free".

    NOT RECOGNIZED — deliberately, per this task's brief (do not attempt
    general dataflow analysis, do not contort this to chase these): a
    `for x, y in ...:` loop target (used on PURPOSE by every real fix —
    see module docstring), a `with ... as x:` target, and any tuple/list
    target containing a starred element (`a, *rest = ...`). `found` is
    `False` for a name bound ONLY one of these ways — which the
    anchor-side analysis (wrongly, but knowingly) treats as "free /
    independent" rather than "unknown". An anchor bound through any of
    these forms that is PROVABLY the same object as the joined base at
    runtime will still classify `"safe"`. This is a real, standing blind
    spot, not a hypothetical one — pinned by
    `test_star_unpack_indirection_is_a_known_blind_spot`,
    `test_with_as_indirection_is_a_known_blind_spot`, and
    `test_for_loop_single_value_indirection_is_a_known_blind_spot` below,
    so a future change that accidentally closes (or widens) it shows up as
    a test diff, not a surprise."""
    for node in ast.walk(func):
        if not isinstance(node, ast.Assign):
            continue
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id == name:
                return True, node.value
            if isinstance(t, (ast.Tuple, ast.List)):
                if any(isinstance(e, ast.Starred) for e in t.elts):
                    continue  # starred target — a documented blind spot, not chased
                for i, elt in enumerate(t.elts):
                    if not (isinstance(elt, ast.Name) and elt.id == name):
                        continue
                    val = node.value
                    if (isinstance(val, (ast.Tuple, ast.List))
                            and not any(isinstance(e, ast.Starred) for e in val.elts)
                            and len(val.elts) == len(t.elts)):
                        return True, val.elts[i]
                    return True, None  # found, but position not determinable
    return False, None


def _resolve_receiver_alias(func: ast.AST, name: str, _seen: set[str] | None = None) -> str:
    """Follow `name = other_bare_name` chains to a fixed point for the
    RECEIVER's base name. This side is a LABEL, not a safety claim — an
    opaque or absent assignment is fine to leave as-is; we only need a
    stable name to compare against a PROVEN anchor (see
    `_resolve_anchor_root`)."""
    seen = _seen if _seen is not None else set()
    if name in seen:
        return name
    seen.add(name)
    found, val = _lookup_simple_assign(func, name)
    if found and isinstance(val, ast.Name):
        return _resolve_receiver_alias(func, val.id, seen)
    return name


def _resolve_anchor_root(
    func: ast.AST, name: str, target: str, _seen: set[str] | None = None,
) -> str | None:
    """Follow alias chains (bare-name, chained-assign, or determinable-position
    tuple/list assign — see `_lookup_simple_assign`) toward one of three
    outcomes for the ANCHOR, checked against `target` — the RECEIVER's own
    (already-resolved) base name:

      (a) `name` IS `target`, right now or after however many aliasing
          steps — proof the anchor is the SAME thing as the joined base.
          Returns `target`; the caller compares this back against `target`
          and reports `vulnerable`. Checking equality FIRST, before asking
          whether `name` even has a binding, is what lets this catch
          `anchor, other = base, base` and `anchor = other = base`: the
          chase lands on the literal name `"base"`, which IS `target`,
          even though `"base"`'s OWN construction (a `/`-chain) would
          otherwise look opaque to this analysis.
      (b) `name` has NO local binding this analysis recognizes at all (a
          module-level global, or one of `_lookup_simple_assign`'s
          documented blind spots) and is NOT `target` — proof of
          independence. Returns that name.
      (c) anything else — an opaque expression (call, lambda, attribute,
          subscript, binop) that is not itself `target` — returns `None`,
          "cannot prove", which `analyze_containment` reports as
          `indeterminate`, never `safe`. This is the fail-safe half of the
          fix: the default is "not proven", not "assumed safe"."""
    seen = _seen if _seen is not None else set()
    if name == target:
        return name
    if name in seen:
        return None  # a cycle proves nothing
    seen.add(name)
    found, val = _lookup_simple_assign(func, name)
    if not found:
        return name  # genuinely free (or an unrecognized-binding blind spot), and != target
    if isinstance(val, ast.Name):
        return _resolve_anchor_root(func, val.id, target, seen)
    return None  # opaque: call, lambda, attribute chain, binop, whatever


def analyze_containment(func: ast.AST) -> str:
    """'vulnerable' | 'safe' | 'indeterminate' for one already-shape-matched
    resolver. 'indeterminate' means either the static shape didn't fit the
    exact assign-then-check pattern this analysis understands, OR the
    anchor's provenance could not be PROVEN either equal to, or independent
    of, the joined base (see `_resolve_anchor_root`). Both are treated as a
    FAILURE by the real-code test below, never as a silent pass — 'safe' is
    an earned, positive result, not a default.

    The RECEIVER's base name is resolved first (`_resolve_receiver_alias` —
    permissive; it is a LABEL, not a claim needing proof) and handed to
    `_resolve_anchor_root` as the `target` to check the anchor against. The
    classic, undisguised bug (`target.relative_to(base.resolve())`, the
    exact same name on both sides) is caught by `_resolve_anchor_root`'s
    own first check — `name == target` — with zero tracing needed, so no
    separate raw-name short-circuit is required here."""
    calls = list(_relative_to_calls_in_value_error_try(func))
    if not calls:
        return "indeterminate"
    for _try, call in calls:
        receiver = call.func.value
        if not isinstance(receiver, ast.Name):
            return "indeterminate"
        if not call.args:
            return "indeterminate"

        raw_anchor_base = _base_name_of_resolve_expr(call.args[0])
        if raw_anchor_base is None:
            return "indeterminate"

        receiver_value = _lookup_simple_assign(func, receiver.id)[1]
        if receiver_value is None:
            return "indeterminate"
        raw_receiver_base = _base_name_of_resolve_expr(receiver_value)
        if raw_receiver_base is None:
            return "indeterminate"

        receiver_base = _resolve_receiver_alias(func, raw_receiver_base)
        anchor_base = _resolve_anchor_root(func, raw_anchor_base, receiver_base)
        if anchor_base is None:
            return "indeterminate"  # opaque anchor provenance — FAIL SAFE
        if anchor_base == receiver_base:
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
    bad_fn = _function_named(ast.parse(_BAD_SOURCE), "bad_resolver")
    good_fn = _function_named(ast.parse(_GOOD_SOURCE), "good_resolver")

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


# ── The reviewer's adversarial cases: opaque anchor indirection ─────────────
#
# THE FALSE-SAFE FOUND IN ROUND 1: `analyze_containment`'s first version
# reduced "is this safe" to "does the resolved BASE name equal the resolved
# ANCHOR name", but its alias-follower gave up on any non-bare-Name
# assignment by silently treating the name as an independent, trustworthy
# leaf — exactly the same fallback used for a genuinely free name (a
# module global, a for-loop tuple-unpack target). A reviewer exploited that
# conflation: `anchor = _passthrough_anchor(base)` is a helper call that
# hands back the SAME object as `base` at runtime, but the old resolver
# couldn't see through the call, gave up, and reported `"safe"` — the exact
# historical tautology bug, laundered through one level of indirection.
#
# These two fixtures are that adversarial shape, kept as PERMANENT
# regression tests (not exploratory — they must always fail the sweep).
# `_resolve_anchor_root` fixes this by inverting the fallback: an opaque
# assignment on the anchor side now returns `None` ("cannot prove"), which
# `analyze_containment` reports as `"indeterminate"` — a sweep failure, not
# a silent pass.

_IDENTITY_HELPER_SOURCE = '''
from pathlib import Path

def _passthrough_anchor(x):
    """Looks like it might do something. Returns its argument, unchanged."""
    return x

def sneaky_resolver(user_id: str, note_id: str, filename: str):
    """The reviewer's exact adversarial case: anchor is base, laundered
    through an identity helper call the old analysis couldn't see through."""
    if "/" in filename or "\\\\" in filename or filename.startswith("."):
        return None
    base = _ROOT / user_id / "notes" / note_id
    target = (base / filename).resolve()
    anchor = _passthrough_anchor(base)
    try:
        target.relative_to(anchor.resolve())
    except ValueError:
        return None
    if not target.exists():
        return None
    return target
'''

_LAMBDA_INDIRECTION_SOURCE = '''
from pathlib import Path

def sneaky_lambda_resolver(user_id: str, note_id: str, filename: str):
    """Same shape, via a lambda instead of a named helper — a different
    syntactic disguise for the identical runtime identity."""
    if "/" in filename or "\\\\" in filename or filename.startswith("."):
        return None
    base = _ROOT / user_id / "notes" / note_id
    target = (base / filename).resolve()
    anchor = (lambda x: x)(base)
    try:
        target.relative_to(anchor.resolve())
    except ValueError:
        return None
    if not target.exists():
        return None
    return target
'''


def test_identity_helper_indirection_is_not_trusted_as_safe():
    """The reviewer's exact finding, kept as a permanent regression fixture.
    Before the fix, this asserted `analyze_containment(fn) == "safe"` — a
    demonstrably wrong verdict for a function with the exact historical bug.
    It must now be `"indeterminate"` (a sweep failure), never `"safe"`."""
    fn = _function_named(ast.parse(_IDENTITY_HELPER_SOURCE), "sneaky_resolver")
    assert is_attachment_resolver_shape(fn) is True, (
        "the shape predicate did not even see the planted adversarial resolver"
    )
    verdict = analyze_containment(fn)
    assert verdict != "safe", (
        "an anchor whose provenance passes through an identity HELPER CALL "
        "was accepted as safe — this is the exact false-negative a reviewer "
        "found: anchor and base are the same object at runtime, disguised "
        "behind one level of indirection the analysis must not trust"
    )
    assert verdict == "indeterminate"


def test_lambda_indirection_is_not_trusted_as_safe():
    """Same adversarial shape via a lambda instead of a named function —
    proves the fix isn't keyed to `_passthrough_anchor`'s specific name or
    call shape, but to "any opaque expression" generically."""
    fn = _function_named(ast.parse(_LAMBDA_INDIRECTION_SOURCE), "sneaky_lambda_resolver")
    assert is_attachment_resolver_shape(fn) is True, (
        "the shape predicate did not even see the planted adversarial resolver"
    )
    verdict = analyze_containment(fn)
    assert verdict != "safe"
    assert verdict == "indeterminate"


# ── Fix round 2: the wider family of opaque-anchor disguises ────────────────
#
# A second reviewer pointed out that round 1's disclosed limitation ("a
# for-loop iterating a single-element list containing base") understated the
# real scope: `_lookup_simple_assign` only ever recognized a single-target
# `Name = <expr>` assign, so ANY other binding form — tuple assignment,
# chained assignment, starred unpacking, `with ... as`, a `for` target — was
# equally invisible, and an anchor bound through any of them that is
# PROVABLY the same object as `base` at runtime still classified `"safe"`.
#
# Per the task brief: chained assignment and determinable-position tuple
# assignment are common and cheap to recognize, so `_lookup_simple_assign`
# was widened to cover them (see its docstring). Starred unpacking, `with
# ... as`, and `for` targets are NOT chased — general dataflow analysis is
# out of scope, and `for` targets are used ON PURPOSE by every real fix.
# Those three remain real, disclosed blind spots. Each gets a fixture below:
# the two widened forms must now be DETECTED (not "safe"); the three
# documented-limit forms must currently STILL read "safe" — pinning the
# honest boundary so a future change to the recognizer shows up as a test
# diff, not a rediscovery.

_TUPLE_ASSIGN_INDIRECTION_SOURCE = '''
from pathlib import Path

def sneaky_tuple_resolver(user_id: str, note_id: str, filename: str):
    """Anchor bound via a plain tuple assignment (no loop, no call) -- the
    same object as base at runtime. WIDENED coverage: must now be caught."""
    if "/" in filename or "\\\\" in filename or filename.startswith("."):
        return None
    base = _ROOT / user_id / "notes" / note_id
    target = (base / filename).resolve()
    anchor, other = base, base
    try:
        target.relative_to(anchor.resolve())
    except ValueError:
        return None
    if not target.exists():
        return None
    return target
'''

_CHAINED_ASSIGN_INDIRECTION_SOURCE = '''
from pathlib import Path

def sneaky_chained_resolver(user_id: str, note_id: str, filename: str):
    """Anchor bound via chained assignment -- the same object as base at
    runtime. WIDENED coverage: must now be caught."""
    if "/" in filename or "\\\\" in filename or filename.startswith("."):
        return None
    base = _ROOT / user_id / "notes" / note_id
    target = (base / filename).resolve()
    anchor = other = base
    try:
        target.relative_to(anchor.resolve())
    except ValueError:
        return None
    if not target.exists():
        return None
    return target
'''

_STAR_UNPACK_INDIRECTION_SOURCE = '''
from pathlib import Path

def sneaky_star_resolver(user_id: str, note_id: str, filename: str):
    """Anchor bound via starred tuple-unpack -- the same object as base at
    runtime. DOCUMENTED LIMIT: not chased on purpose; still reads "safe"."""
    if "/" in filename or "\\\\" in filename or filename.startswith("."):
        return None
    base = _ROOT / user_id / "notes" / note_id
    target = (base / filename).resolve()
    anchor, *_rest = [base]
    try:
        target.relative_to(anchor.resolve())
    except ValueError:
        return None
    if not target.exists():
        return None
    return target
'''

_WITH_AS_INDIRECTION_SOURCE = '''
import contextlib
from pathlib import Path

def sneaky_with_resolver(user_id: str, note_id: str, filename: str):
    """Anchor bound via `with ... as` -- nullcontext just hands its argument
    back, so this is the same object as base at runtime. DOCUMENTED LIMIT:
    not chased on purpose; still reads "safe"."""
    if "/" in filename or "\\\\" in filename or filename.startswith("."):
        return None
    base = _ROOT / user_id / "notes" / note_id
    target = (base / filename).resolve()
    with contextlib.nullcontext(base) as anchor:
        try:
            target.relative_to(anchor.resolve())
        except ValueError:
            return None
        if not target.exists():
            return None
        return target
'''

_FOR_LOOP_SINGLE_VALUE_SOURCE = '''
from pathlib import Path

def sneaky_for_loop_resolver(user_id: str, note_id: str, filename: str):
    """Anchor bound via a for-loop iterating a single-element list holding
    base -- the same object as base at runtime. DOCUMENTED LIMIT: for-loop
    targets are deliberately never chased (every real fix's root/base pair
    relies on exactly that); still reads "safe"."""
    if "/" in filename or "\\\\" in filename or filename.startswith("."):
        return None
    base = _ROOT / user_id / "notes" / note_id
    target = (base / filename).resolve()
    for anchor in [base]:
        try:
            target.relative_to(anchor.resolve())
        except ValueError:
            return None
        if not target.exists():
            return None
        return target
'''


def test_tuple_assignment_indirection_is_now_detected():
    """WIDENED coverage. Before fix round 2, `anchor, other = base, base`
    was indistinguishable from a genuinely independent anchor and read
    "safe" -- a real instance of the wider family the second reviewer
    named. Must now fail the sweep."""
    fn = _function_named(ast.parse(_TUPLE_ASSIGN_INDIRECTION_SOURCE), "sneaky_tuple_resolver")
    assert is_attachment_resolver_shape(fn) is True, (
        "the shape predicate did not even see the planted adversarial resolver"
    )
    assert analyze_containment(fn) != "safe", (
        "a tuple-assigned anchor (anchor, other = base, base) was accepted as "
        "safe -- the widened recognizer regressed"
    )


def test_chained_assignment_indirection_is_now_detected():
    """WIDENED coverage, same reasoning as the tuple-assign case above but
    via `anchor = other = base`."""
    fn = _function_named(ast.parse(_CHAINED_ASSIGN_INDIRECTION_SOURCE), "sneaky_chained_resolver")
    assert is_attachment_resolver_shape(fn) is True, (
        "the shape predicate did not even see the planted adversarial resolver"
    )
    assert analyze_containment(fn) != "safe", (
        "a chained-assigned anchor (anchor = other = base) was accepted as "
        "safe -- the widened recognizer regressed"
    )


def test_star_unpack_indirection_is_a_known_blind_spot():
    """PINS a documented, NOT-fixed limit (see `_lookup_simple_assign`'s
    docstring). This must currently read "safe" — that is the honest
    truth about the sweep's coverage, not a bug in this test. If this ever
    starts failing because the recognizer now catches it, update
    `_lookup_simple_assign`'s docstring (the blind-spot list) rather than
    treating the new red as a regression to revert."""
    fn = _function_named(ast.parse(_STAR_UNPACK_INDIRECTION_SOURCE), "sneaky_star_resolver")
    assert is_attachment_resolver_shape(fn) is True, (
        "the shape predicate did not even see the planted adversarial resolver"
    )
    assert analyze_containment(fn) == "safe"


def test_with_as_indirection_is_a_known_blind_spot():
    """PINS a documented, NOT-fixed limit. See
    `test_star_unpack_indirection_is_a_known_blind_spot`'s docstring —
    same reasoning, different disguise."""
    fn = _function_named(ast.parse(_WITH_AS_INDIRECTION_SOURCE), "sneaky_with_resolver")
    assert is_attachment_resolver_shape(fn) is True, (
        "the shape predicate did not even see the planted adversarial resolver"
    )
    assert analyze_containment(fn) == "safe"


def test_for_loop_single_value_indirection_is_a_known_blind_spot():
    """PINS the exact blind spot disclosed (but not, at the time, given a
    permanent fixture) in fix round 1's report — a `for` target is used ON
    PURPOSE by every real fix's `root`/`base` pair, so this form is never
    chased, and an anchor disguised this way still reads "safe"."""
    fn = _function_named(ast.parse(_FOR_LOOP_SINGLE_VALUE_SOURCE), "sneaky_for_loop_resolver")
    assert is_attachment_resolver_shape(fn) is True, (
        "the shape predicate did not even see the planted adversarial resolver"
    )
    assert analyze_containment(fn) == "safe"


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
