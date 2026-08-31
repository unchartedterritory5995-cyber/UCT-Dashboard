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
`api/**`, so F811 never fired. This rail is that check, scoped to the packages
where the defect actually cost something, and derived by AST rather than grep.
"""
import sys, pathlib, ast
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

#: Scoped deliberately. Widening this to all of `api/**` is a one-line change,
#: but it must be done with a measurement in hand — a sweep that lights up 40
#: pre-existing hits gets muted, and a muted rail is worse than none.
PACKAGES = [
    "api/services/screener",
    "api/services/pattern_engine",
]


def _module_files():
    for pkg in PACKAGES:
        for f in sorted((ROOT / pkg).rglob("*.py")):
            if "__pycache__" in f.parts:
                continue
            yield f


def _top_level_dupes(path: pathlib.Path) -> dict:
    """Names defined more than once directly in the module body.

    ⛔ MODULE BODY ONLY — never a recursive walk. A method named `detect` on two
    different classes is not a shadow, and a nested helper redefined in two
    functions is not either. Flagging those would bury the real signal, which is
    the failure mode that gets rails muted.

    ⛔ AND CONDITIONAL DEFINITIONS ARE NOT SHADOWS. A name defined inside an
    `if`/`try` (the import-fallback idiom) is deliberate; only sibling
    definitions at the same unconditional level shadow each other.
    """
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError as e:                                # noqa: BLE001
        pytest.fail(f"{path} does not parse: {e}")
    seen, dupes = {}, {}
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef,
                                 ast.ClassDef)):
            continue
        # `@overload` / `@typing.overload` stubs are a legitimate repetition.
        decs = {getattr(d, "id", getattr(d, "attr", "")) for d in node.decorator_list}
        if "overload" in decs:
            continue
        if node.name in seen:
            dupes.setdefault(node.name, [seen[node.name]]).append(node.lineno)
        seen[node.name] = node.lineno
    return dupes


def test_the_sweep_actually_reads_modules():
    """⛔ NON-VACUITY. The rule asserts "no duplicates found"; a sweep pointed at
    an empty or wrong directory finds none and passes loudly."""
    files = list(_module_files())
    assert len(files) > 20, (
        f"only {len(files)} modules found under {PACKAGES} — the sweep is not "
        f"reading the packages it claims to check")
    defs = sum(len([n for n in ast.parse(f.read_text(encoding='utf-8')).body
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
    assert dupes["_sma"] == [1, 9]


def test_a_method_on_two_classes_is_not_flagged(tmp_path):
    """The control against over-reporting. A rail that flags 40 innocent things
    to catch one real one gets muted, and a muted rail is worse than none."""
    f = tmp_path / "ok.py"
    f.write_text(
        "class A:\n    def detect(self):\n        return 1\n\n\n"
        "class B:\n    def detect(self):\n        return 2\n",
        encoding="utf-8")
    assert _top_level_dupes(f) == {}


def test_no_module_shadows_its_own_definitions():
    offenders = {}
    for f in _module_files():
        d = _top_level_dupes(f)
        if d:
            offenders[str(f.relative_to(ROOT))] = d
    assert not offenders, (
        "these modules define a top-level name more than once. Python keeps the "
        "LAST definition, so the earlier one is dead code that still reads as "
        "authoritative — and any caller written against its signature is "
        "calling a different function at runtime:\n"
        + "\n".join(f"  {mod}: " + ", ".join(f"{n} at lines {ls}"
                                             for n, ls in sorted(dd.items()))
                    for mod, dd in sorted(offenders.items()))
    )
