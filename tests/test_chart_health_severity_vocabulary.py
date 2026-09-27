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
severity word cannot contribute one — proved by a control below rather than
asserted, with a real occurrence in the same fixture to show the check still
sees one.
"""
import ast
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ALERT_VOCAB_SRC = ROOT / "api" / "services" / "alerts.py"
PAGER_SRC = ROOT / "api" / "services" / "chart_health_alerts.py"
AUDIT_SRC = ROOT / "api" / "services" / "audit.py"
RECONCILER_SRC = ROOT / "api" / "services" / "bars_reconciliation.py"
API_ROOT = ROOT / "api"


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


def chart_health_emits_in(source: str) -> list[tuple[str, str]]:
    """`(alert_key, severity)` for every `chart_health_alerts.emit(k, "<lit>", ...)`.

    Restricted to that module's own calls so an unrelated `.emit()` API cannot
    be mistaken for one. A computed severity argument is skipped (nothing
    static can be said about it) — `api/routers/market_calendar.py` has one.
    """
    out: list[tuple[str, str]] = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == "emit"):
            continue
        if not (isinstance(func.value, ast.Name) and func.value.id == "chart_health_alerts"):
            continue
        if len(node.args) < 2:
            continue
        key, sev = node.args[0], node.args[1]
        if not (isinstance(sev, ast.Constant) and isinstance(sev.value, str)):
            continue
        key_txt = key.value if isinstance(key, ast.Constant) else "<computed>"
        out.append((str(key_txt), sev.value))
    return out


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
    """Repo-wide, because the defect class is one call site away from any module."""
    recognised = recognised_severities()
    seen = 0
    bad: list[tuple[str, str, str]] = []
    for path in sorted(API_ROOT.rglob("*.py")):
        try:
            emits = chart_health_emits_in(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):  # pragma: no cover
            continue
        for key, sev in emits:
            seen += 1
            if sev not in recognised:
                bad.append((str(path.relative_to(ROOT)), key, sev))
    # Non-vacuity: this sweep must actually find call sites (there were 20+ when
    # written). A zero here is a broken walk, not a codebase without alerts.
    assert seen >= 10, f"only {seen} chart_health_alerts.emit() call sites found"
    assert not bad, f"unrecognised alert severities: {bad}; recognised = {sorted(recognised)}"
