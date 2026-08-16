"""`app/node_modules` must satisfy `app/package.json` — or say so in ONE line.

⛔ WHY THIS IS A *BACKEND* TEST. Several backend rails cross into the JS lane:
`test_alert_user_admission`, `test_ast_*`, `test_scan_definition`,
`test_definition_concierge` and `test_phase_e_acceptance` all shell out to node
and import the shipped engine (`app/src/components/chart/engine/ast/parse.js`).
They refuse rather than skip when the lane cannot run — deliberately, because a
box that quietly skips the cross-lane equality would admit a formula that
computes one number on the server and another on the author's chart.

🔴 WHAT THAT COST, 2026-08-16. Worktrees junction `app/node_modules` to the main
checkout's copy, and that checkout sits on an old branch whose `package.json`
predates `jsep`. So the shared directory satisfied a package manifest nobody is
building against any more, `import 'jsep'` failed, and the JS lane raised
`LaneUnavailable` in **91 tests across seven files** — every one of them reading
like a product defect in alerts, screener definitions or the AST. It took an
hour to walk back to one absent package. (`jsep` had already been hand-installed
once, on 8/9, and had regressed since.)

Eight of `package.json`'s dependencies were missing or wrong that morning:
`jsep`, `@tiptap/extension-table`, `mammoth`, `markdown-it`,
`markdown-it-task-lists`, `modern-screenshot`, `spark-md5`, and a
`lightweight-charts` a minor version behind.

This test turns all of that into one failure that names the packages and the
command. ⭐ It is deliberately PURE PYTHON — no `npm ls` subprocess — so it costs
milliseconds and works on a box where npm is not on PATH.

⚠️ It does NOT skip when `app/node_modules` is absent. "No install at all" is
the loudest version of the very problem this file exists to report, and a skip
there would be the vacuous pass (`lesson_test_that_passes_vacuously`).
"""
from __future__ import annotations

import json
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / "app"
PACKAGE_JSON = APP / "package.json"
NODE_MODULES = APP / "node_modules"

#: Specs this check cannot evaluate as a simple range — presence is all it
#: claims for these. A local/git/alias dependency has no registry version to
#: compare against, and a compound range is npm's job, not ours.
_UNCHECKABLE_PREFIXES = ("file:", "link:", "git+", "github:", "workspace:", "npm:", "http")

_VERSION = re.compile(r"^(\d+)\.(\d+)\.(\d+)")


def _parts(v: str):
    m = _VERSION.match(v.strip())
    return tuple(int(g) for g in m.groups()) if m else None


def _satisfies(installed: str, spec: str) -> bool | None:
    """True/False, or None when the spec is one this check does not evaluate."""
    spec = (spec or "").strip()
    if (not spec or spec in ("*", "latest", "x")
            or spec.startswith(_UNCHECKABLE_PREFIXES)
            or "||" in spec or " " in spec):
        return None
    got = _parts(installed)
    op = ""
    body = spec
    for prefix in ("^", "~", ">=", ">"):
        if spec.startswith(prefix):
            op, body = prefix, spec[len(prefix):]
            break
    want = _parts(body)
    if got is None or want is None:
        return None
    if op in (">=", ">"):
        return got >= want if op == ">=" else got > want
    if op == "~":                       # same major.minor, at least the patch
        return got[:2] == want[:2] and got >= want
    if op == "^":                       # same LEFT-MOST NON-ZERO, at least this
        if want[0]:
            return got[0] == want[0] and got >= want
        if want[1]:                     # 0.y.z — the minor is the compat unit
            return got[:2] == want[:2] and got >= want
        return got == want              # 0.0.z — nothing is compatible but itself
    return got == want                  # exact pin


def _declared() -> dict[str, str]:
    manifest = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    return {**(manifest.get("dependencies") or {}),
            **(manifest.get("devDependencies") or {})}


def test_the_frontend_manifest_is_actually_installed():
    declared = _declared()
    assert declared, (
        f"{PACKAGE_JSON} declares no dependencies — this check is reading the "
        "wrong file and would pass for every possible install")

    missing, mismatched = [], []
    for name, spec in sorted(declared.items()):
        pkg = NODE_MODULES.joinpath(*name.split("/")) / "package.json"
        if not pkg.is_file():
            missing.append(f"{name}@{spec}")
            continue
        try:
            installed = json.loads(pkg.read_text(encoding="utf-8")).get("version") or ""
        except (OSError, ValueError):
            missing.append(f"{name}@{spec} (unreadable package.json)")
            continue
        if _satisfies(installed, spec) is False:
            mismatched.append(f"{name}: installed {installed}, manifest wants {spec}")

    assert not (missing or mismatched), (
        "app/node_modules does not satisfy app/package.json, so every backend "
        "rail that crosses into the JS lane will fail as `LaneUnavailable` / "
        "`Cannot find package` instead of saying this.\n"
        f"  missing    ({len(missing)}): {missing}\n"
        f"  mismatched ({len(mismatched)}): {mismatched}\n"
        "  fix: cd app && npm install\n"
        "  ⚠️ In a WORKTREE, `app/node_modules` is usually a junction to the main "
        "checkout's copy — which is installed from THAT checkout's branch. If it "
        "sits on an older branch, the shared directory can never satisfy this "
        "manifest; run npm install from the worktree (it replaces the junction "
        "with a real directory and leaves package-lock.json untouched).")


@pytest.mark.parametrize("installed,spec,expected", [
    # ^ — same left-most non-zero, at or above
    ("1.4.0", "^1.4.0", True), ("1.5.2", "^1.4.0", True), ("2.0.0", "^1.4.0", False),
    ("1.3.9", "^1.4.0", False),
    ("0.4.24", "^0.4.20", True), ("0.5.0", "^0.4.20", False),   # 0.x: minor is the unit
    # ~ — same major.minor
    ("3.23.6", "~3.23.0", True), ("3.24.0", "~3.23.0", False),
    # exact / >=
    ("1.4.0", "1.4.0", True), ("1.4.1", "1.4.0", False), ("5.2.0", ">=5.1.0", True),
    # the real 2026-08-16 reading
    ("5.1.0", "^5.2.0", False),
])
def test_the_version_comparison_itself(installed, spec, expected):
    """⛔ The comparator gets its own cases. A `_satisfies` that returned None
    (or True) for everything would make the check above pass on ANY install —
    which is precisely the shape of the problem it was written to catch."""
    assert _satisfies(installed, spec) is expected


def test_an_unevaluatable_spec_is_reported_as_such_not_as_a_pass():
    """A local/git/alias/compound spec has no registry version to compare, so
    the check claims presence only — and says None rather than True, so it can
    never be mistaken for a satisfied range."""
    for spec in ("file:../pkg", "git+https://x/y.git", "workspace:*", ">=1 <2", "*"):
        assert _satisfies("1.0.0", spec) is None, spec
