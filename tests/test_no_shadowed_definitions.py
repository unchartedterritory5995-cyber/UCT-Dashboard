"""No module may define the same top-level name twice.

⭐⭐ THE OUTAGE THIS COMES FROM, MEASURED. `base_catalog.py` defined `_sma`
TWICE: `_sma(closes, period)` beside `_detect_pocket_pivot`, and
`_sma(bars, n, end=None)` about 2,900 lines below. Python keeps the LAST one, so
the first was dead and every caller written against it was silently calling a
function with a different signature. `_detect_pocket_pivot` passed `closes` and
raised `AttributeError: 'float' object has no attribute 'get'` on every symbol
that reached that line; `bases._collect_relations` swallows per-predicate
exceptions by design, so the structure fired on 0 of 2,811 tickers while its
catalog entry advertised 1.5% coverage. After the fix: 43 of 2,811 (1.53%).

⛔ THIS IS `lesson_a_second_authority_over_one_value` IN CODE. Two definitions
of one name, where the second silently wins and the first stays on screen
looking authoritative — a reader who greps for `_sma` finds the wrong one 50% of
the time, which is how the caller came to be written against a signature that
does not exist at runtime.

⛔ WHY NO LINTER CAUGHT IT HERE: the repo runs no flake8/ruff gate over
`api/**`, so F811 never fired. This rail is that check, derived by AST rather
than grep.

─────────────────────────────────────────────────────────────────────────────
WIDENED 2026-08-31 — TO EVERYTHING, WITH THE MEASUREMENT IN HAND.

This file used to say: "Scoped deliberately. Widening this to all of `api/**` is
a one-line change, but it must be done with a measurement in hand — a sweep that
lights up 40 pre-existing hits gets muted, and a muted rail is worse than none."

The measurement, taken with the helper below BEFORE widening anything:

    scope      modules   modules with a duplicate top-level DEFINITION
    api          1033      1   (api/live_massive_router.py :: _parse_mdy)
    tools         134      0
    scripts        32      0
    services        1      0
    tests        1127      1   (tests/test_discord_chart.py, two dup tests)
    root            2      0

    scope      modules   modules with a duplicate CONSTANT assignment
    api          1033      1   (api/services/screener/base_catalog.py::_MINERVINI)
    everything else        0

So the number was TWO and ONE, not forty, and the honest scope is EVERYTHING.
All three offenders were real and ALL THREE ARE NOW FIXED, so the allow-list is
empty — see the note in it for what passed through and why each left. Whole-repo
sweep cost: 2,327 modules parsed in ~5s.

⛔ MODULE-BODY ASSIGNMENTS ARE THE SAME DEFECT, AND THE SWEEP WAS BLIND TO THEM.
`base_catalog.py` sets `_MINERVINI` at line 674 and again at line 2229. Python
keeps the second, but the Structures are CONSTRUCTED as the module body runs —
so the 8 criteria declared between the two assignments carry
`source_id="minervini_ttlac_2017"` and the 13 after carry `"minervini_ttlac"`.
One constant, two shipped provenance ids, decided by nothing but where in a
4,000-line file a criterion happens to sit. That is the `_sma` story in a
constant, and a sweep that only inspected `FunctionDef`/`ClassDef` could not see
it.

⛔ BUT ONLY CONSTANT-STYLE NAMES (`^_?[A-Z][A-Z0-9_]*$`). Ordinary lowercase
rebinding at module level is a legitimate idiom — accumulators, conditional
config, `x = decorate(x)` — and flagging it is precisely how a rail gets muted.
The regex is the line between "a constant with two values" and "a variable
doing its job".
"""
import ast
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

#: Every Python root in the repo. Measured clean before widening — see the
#: header. `app/` holds the frontend and contains no Python.
PACKAGES = [
    "api",
    "tools",
    "scripts",
    "services",
    "tests",
]

#: Module-level names that LOOK like constants. Anything else at module scope is
#: a variable, and rebinding a variable is not a shadow.
_CONST_NAME = re.compile(r"^_?[A-Z][A-Z0-9_]*$")

# ─────────────────────────────────────────────────────────────────────────────
#  THE ALLOW-LIST — every entry carries a reason and an owner, and the rail
#  fails when an entry goes STALE. A gate list drifts like any other artifact:
#  an entry that outlives the defect it excuses is indistinguishable from a
#  silently muted rule.
# ─────────────────────────────────────────────────────────────────────────────
ALLOWED: dict[str, dict[str, str]] = {
    # ⭐ EMPTY, AND THAT IS A RESULT RATHER THAN A DEFAULT. Two entries have
    # passed through this list and BOTH were removed because the defect was
    # FIXED, not because it was forgiven -- and in each case it was
    # `test_no_allow_list_entry_has_gone_stale` that demanded the removal the
    # moment the fix landed, not anybody remembering:
    #   base_catalog.py::_MINERVINI  -- one constant with two values, shipping
    #     two different provenance ids depending on where in a 4,000-line file
    #     a criterion happened to sit.
    #   live_massive_router.py::_parse_mdy -- a live 500. Four call sites
    #     written for a sortable tuple were running a date-returning shadow
    #     with no callers of its own.
    # An exemption that outlives its defect reads as coverage and hides the
    # next one, which is why this gate points both ways.
}


def _module_files():
    for pkg in PACKAGES:
        base = ROOT / pkg
        if not base.exists():
            continue
        for f in sorted(base.rglob("*.py")):
            if "__pycache__" in f.parts:
                continue
            yield f
    for f in sorted(ROOT.glob("*.py")):          # conftest.py et al
        yield f


def _rel(path: pathlib.Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def _is_singledispatch_impl(node) -> bool:
    """`@foo.register` — functools.singledispatch's implementation idiom.

    The canonical form names every implementation `_`, so a module with three
    of them has three top-level `_`s ON PURPOSE and only the generic function's
    name is ever looked up. Not currently used anywhere in this repo (measured
    2026-08-31: 0 occurrences), but it is standard Python, and the first person
    to reach for it would otherwise get a red rail for writing correct code —
    which is how a rail earns its mute. `test_a_singledispatch_register_stack_
    is_not_flagged` keeps this branch honest."""
    return any(isinstance(d, ast.Attribute) and d.attr == "register"
               for d in node.decorator_list)


_AST_CACHE: dict = {}


def _parse(path: pathlib.Path) -> ast.Module:
    """Parse once per module per session. The sweep and its non-vacuity control
    both walk every module in the repo; parsing twice doubled the rail's cost
    for nothing."""
    key = str(path)
    if key not in _AST_CACHE:
        try:
            _AST_CACHE[key] = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError as e:                            # noqa: BLE001
            pytest.fail(f"{path} does not parse: {e}")
    return _AST_CACHE[key]


def _top_level_dupes(path: pathlib.Path) -> dict:
    """Names bound more than once directly in the module body.

    Returns `{name: (kind, [line, line, ...])}`.

    ⛔ MODULE BODY ONLY — never a recursive walk. A method named `detect` on two
    different classes is not a shadow, and a nested helper redefined in two
    functions is not either. Flagging those would bury the real signal, which is
    the failure mode that gets rails muted.

    ⛔ AND CONDITIONAL DEFINITIONS ARE NOT SHADOWS. A name defined inside an
    `if`/`try` (the import-fallback idiom, `if TYPE_CHECKING:`) is deliberate;
    only sibling definitions at the same unconditional level shadow each other.
    Those live inside `ast.If`/`ast.Try` nodes, so iterating `tree.body` excludes
    them by construction rather than by a special case.
    """
    tree = _parse(path)
    seen, dupes = {}, {}

    def _bind(name, kind, lineno):
        if name in seen:
            dupes.setdefault(name, (kind, [seen[name]]))[1].append(lineno)
        seen[name] = lineno

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef,
                             ast.ClassDef)):
            # `@overload` / `@typing.overload` stubs are a legitimate repetition.
            decs = {getattr(d, "id", getattr(d, "attr", ""))
                    for d in node.decorator_list}
            if "overload" in decs or _is_singledispatch_impl(node):
                continue
            kind = "class" if isinstance(node, ast.ClassDef) else "def"
            _bind(node.name, kind, node.lineno)
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and _CONST_NAME.match(t.id):
                    _bind(t.id, "constant", node.lineno)
        elif isinstance(node, ast.AnnAssign):
            # A bare `NAME: T` annotation binds nothing; `NAME: T = v` does.
            if (node.value is not None and isinstance(node.target, ast.Name)
                    and _CONST_NAME.match(node.target.id)):
                _bind(node.target.id, "constant", node.lineno)

    return dupes


_SWEEP_CACHE = {}


def _offenders() -> dict:
    """`{relpath: {name: (kind, [lines])}}` for the whole repo, ONE parse pass.

    ⛔ Shared by the rule and by every control — a control that re-implements
    the sweep proves the control works, not the rail."""
    if "o" not in _SWEEP_CACHE:
        out = {}
        for f in _module_files():
            d = _top_level_dupes(f)
            if d:
                out[_rel(f)] = d
        _SWEEP_CACHE["o"] = out
    return _SWEEP_CACHE["o"]


# ─── the controls ───────────────────────────────────────────────────────────

def test_the_sweep_actually_reads_the_whole_repo():
    """⛔ NON-VACUITY. The rule asserts "no duplicates found"; a sweep pointed at
    an empty or wrong directory finds none and passes loudly."""
    files = list(_module_files())
    # Measured 2026-08-31: 2,329 modules across api/tools/scripts/services/tests
    # plus the repo root.
    assert len(files) > 2000, (
        f"only {len(files)} modules found under {PACKAGES} — the sweep is not "
        f"reading the packages it claims to check")
    seen_pkgs = {p for p in PACKAGES
                 if any(_rel(f).startswith(p + "/") for f in files)}
    assert seen_pkgs == set(PACKAGES), (
        f"the sweep found no modules under {sorted(set(PACKAGES) - seen_pkgs)} "
        f"— a scope entry that matches nothing is a rule that checks nothing")
    defs = sum(len([n for n in _parse(f).body
                    if isinstance(n, (ast.FunctionDef, ast.ClassDef))])
               for f in files)
    assert defs > 200, (
        f"only {defs} top-level definitions seen — the parse is not finding code")


def test_the_sweep_detects_a_planted_shadow(tmp_path):
    """The detector responds to input. Without this, a `_top_level_dupes` that
    always returned `{}` would satisfy the rule forever — which is precisely the
    shape of the bug being guarded against."""
    f = tmp_path / "planted.py"
    f.write_text(
        "def _sma(closes, period):\n    return 1\n\n\n"
        "def other():\n    return 2\n\n\n"
        "def _sma(bars, n, end=None):\n    return 3\n",
        encoding="utf-8")
    dupes = _top_level_dupes(f)
    assert "_sma" in dupes, "the sweep cannot see a shadowed definition"
    assert dupes["_sma"] == ("def", [1, 9])


def test_the_sweep_detects_a_planted_CONSTANT_shadow(tmp_path):
    """⛔ THE PLANTED CONTROL FOR THE ASSIGNMENT HALF, through the SAME helper.

    This is `_MINERVINI` reduced to eight lines: one constant, two values, and
    two consumers that read different ones purely because of where they sit.
    Without this case the whole `ast.Assign` branch could be deleted and every
    other test in this file would still pass."""
    f = tmp_path / "planted_const.py"
    f.write_text(
        '_MINERVINI = "minervini_ttlac_2017"\n'
        'EARLY = {"source_id": _MINERVINI}\n'
        'lowercase_rebind = 1\n'
        '_MINERVINI = "minervini_ttlac"\n'
        'LATE = {"source_id": _MINERVINI}\n'
        'lowercase_rebind = 2\n',
        encoding="utf-8")
    dupes = _top_level_dupes(f)
    assert "_MINERVINI" in dupes, (
        "the sweep cannot see a shadowed module-level CONSTANT — the defect "
        "class it was blind to until 2026-08-31")
    assert dupes["_MINERVINI"] == ("constant", [1, 4])
    # And the file really does ship two different values off one name:
    ns = {}
    exec(compile(f.read_text(encoding="utf-8"), "<planted>", "exec"), ns)
    assert ns["EARLY"]["source_id"] != ns["LATE"]["source_id"], (
        "the planted fixture does not actually demonstrate the defect")


def test_ordinary_lowercase_rebinding_is_not_flagged(tmp_path):
    """The control against over-reporting on the assignment half. `x = f(x)` at
    module level is a normal idiom; a rail that flags it lights up half the repo
    and gets muted within a week."""
    f = tmp_path / "ok_assign.py"
    f.write_text(
        "rows = []\n"
        "rows = [r for r in rows if r]\n"
        "handler = None\n"
        "handler = print\n",
        encoding="utf-8")
    assert _top_level_dupes(f) == {}


def test_a_method_on_two_classes_is_not_flagged(tmp_path):
    """The control against over-reporting. A rail that flags 40 innocent things
    to catch one real one gets muted, and a muted rail is worse than none."""
    f = tmp_path / "ok.py"
    f.write_text(
        "class A:\n    def detect(self):\n        return 1\n\n\n"
        "class B:\n    def detect(self):\n        return 2\n",
        encoding="utf-8")
    assert _top_level_dupes(f) == {}


def test_a_conditional_import_fallback_is_not_flagged(tmp_path):
    """`try: from x import y / except ImportError: def y(): ...` and
    `if TYPE_CHECKING:` are deliberate. They are excluded BY CONSTRUCTION
    (the definitions are not in `tree.body`), and this pins that."""
    f = tmp_path / "ok_cond.py"
    f.write_text(
        "from typing import TYPE_CHECKING\n"
        "try:\n    from fast import loads\nexcept ImportError:\n"
        "    def loads(s):\n        return s\n"
        "if TYPE_CHECKING:\n    class Bar: ...\n"
        "else:\n    class Bar: ...\n"
        "if 1:\n    TIMEOUT = 1\nelse:\n    TIMEOUT = 2\n",
        encoding="utf-8")
    assert _top_level_dupes(f) == {}


def test_an_overload_stack_is_not_flagged(tmp_path):
    f = tmp_path / "ok_overload.py"
    f.write_text(
        "from typing import overload\n"
        "@overload\ndef f(x: int) -> int: ...\n"
        "@overload\ndef f(x: str) -> str: ...\n"
        "def f(x):\n    return x\n",
        encoding="utf-8")
    assert _top_level_dupes(f) == {}


def test_a_singledispatch_register_stack_is_not_flagged(tmp_path):
    """Pins the `@x.register` exclusion. It guards a standard idiom this repo
    does not currently use (0 occurrences, measured), so without this case the
    branch would be untested code claiming to be protection."""
    f = tmp_path / "ok_singledispatch.py"
    f.write_text(
        "from functools import singledispatch\n"
        "@singledispatch\ndef fmt(v):\n    return str(v)\n"
        "@fmt.register\ndef _(v: int):\n    return 'int'\n"
        "@fmt.register\ndef _(v: str):\n    return 'str'\n",
        encoding="utf-8")
    assert _top_level_dupes(f) == {}
    # non-vacuity: the same file WITHOUT the decorators is flagged, so this is
    # the exclusion doing the work and not the parse missing the functions.
    g = tmp_path / "not_ok_singledispatch.py"
    g.write_text(
        "def _(v: int):\n    return 'int'\n"
        "def _(v: str):\n    return 'str'\n",
        encoding="utf-8")
    assert "_" in _top_level_dupes(g)


# ─── the allow-list's own gate ──────────────────────────────────────────────

def test_no_allow_list_entry_has_gone_stale():
    """⛔ AN EXEMPTION THAT OUTLIVES ITS DEFECT IS A SILENTLY DISABLED RULE.

    Every allow-list entry must still name a real, still-present offender. When
    the owner's `_MINERVINI` fix lands, this goes RED and says to delete the
    entry — so the rail comes back on by itself instead of quietly staying off.
    `lesson_a_gate_list_drifts_like_any_other_artifact`."""
    offenders = _offenders()
    stale = []
    for mod, names in ALLOWED.items():
        found = offenders.get(mod, {})
        if not (ROOT / mod).exists():
            stale.append(f"{mod}: allow-listed module no longer exists")
            continue
        for name in names:
            if name not in found:
                stale.append(
                    f"{mod}::{name}: no longer shadowed — DELETE this "
                    f"allow-list entry, the rail should be guarding it again")
    assert not stale, (
        "these allow-list entries are stale. An exemption for a defect that is "
        "already fixed reads as coverage and hides the next one:\n  "
        + "\n  ".join(stale))


def test_the_allow_list_is_not_a_silent_blanket():
    """The allow-list may only excuse SPECIFIC names in SPECIFIC modules, and
    every entry must carry a reason a human wrote. An empty string, or a
    module-wide exemption, would let a whole file go dark."""
    for mod, names in ALLOWED.items():
        assert isinstance(names, dict) and names, (
            f"{mod} is allow-listed with no names — that exempts the entire "
            f"module, which is indistinguishable from removing it from scope")
        for name, reason in names.items():
            assert len(reason.strip()) > 60, (
                f"{mod}::{name} has no real justification: {reason!r}")


# ─── the rule ───────────────────────────────────────────────────────────────

def test_no_module_shadows_its_own_definitions():
    offenders = {}
    for mod, dd in _offenders().items():
        allowed = ALLOWED.get(mod, {})
        rest = {n: v for n, v in dd.items() if n not in allowed}
        if rest:
            offenders[mod] = rest
    assert not offenders, (
        "these modules bind a top-level name more than once. Python keeps the "
        "LAST binding, so the earlier one is dead code that still reads as "
        "authoritative — and any caller written against it (its signature, or "
        "its value) is using a different one at runtime:\n"
        + "\n".join(
            f"  {mod}: " + ", ".join(
                f"{n} ({kind}) at lines {lines}"
                for n, (kind, lines) in sorted(dd.items()))
            for mod, dd in sorted(offenders.items()))
    )
