"""Refuse a workflow that calls a GitHub Actions expression function that does not exist.

⛔⛔ **E CP10 — THIS EXISTS BECAUSE A ONE-WORD MISTAKE KILLED AN ENTIRE WORKFLOW.**
E CP7 sanitised an artifact name with `${{ replace(matrix.dir, '/', '--') }}`.
**GitHub Actions has no `replace()` function.** Run #7: **0 jobs, `created_at` ==
`updated_at`, conclusion `failure`** — the whole workflow was rejected before a single job
started. The previous defect failed four jobs; the fix failed all twenty.

⛔⛔ **AND `yaml.safe_load` PASSED, BECAUSE IT IS VALID YAML.** The error lives in the
*expression* layer, which a YAML parser cannot see. `actionlint` would have caught it and
was recorded **UNREADABLE-TOOL** — not installed — and the change was pushed anyway.

⭐ **THE LESSON IS NOT "INSTALL ACTIONLINT".** It is that *declaring a validator unavailable
is a reason to be more careful, not a licence to proceed unchecked* — especially when the
unavailable validator is the only one that could see the class of change being made. This
file is the cheap half of that validator, written so the gap has a floor.

The function set is small, documented and stable, so an allowlist is honest here:
https://docs.github.com/actions/learn-github-actions/expressions

Usage:
    python tools/check_workflow_expressions.py .github/workflows/*.yml
    python tools/check_workflow_expressions.py --self-check
"""
from __future__ import annotations

import argparse
import glob
import pathlib
import re
import sys

OK, FAIL = 0, 1

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

#: every function GitHub Actions expressions provide.
ALLOWED = {
    "contains", "startsWith", "endsWith", "format", "join", "toJSON", "fromJSON",
    "hashFiles",
    # status check functions
    "success", "always", "cancelled", "failure",
}

_EXPR = re.compile(r"\$\{\{(.*?)\}\}", re.S)
_CALL = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(")


def findings(text: str):
    """[(expression, function)] for every call to a function not in ALLOWED."""
    bad = []
    for m in _EXPR.finditer(text):
        expr = m.group(1)
        for c in _CALL.finditer(expr):
            fn = c.group(1)
            if fn not in ALLOWED:
                bad.append((expr.strip(), fn))
    return bad


def expressions(text: str):
    return [m.group(1).strip() for m in _EXPR.finditer(text)]


def check(paths, verbose=True):
    total_exprs = 0
    problems = []
    for p in paths:
        text = pathlib.Path(p).read_text(encoding="utf-8", errors="replace")
        exprs = expressions(text)
        total_exprs += len(exprs)
        for expr, fn in findings(text):
            problems.append((p, fn, expr))
    if verbose:
        # ⛔ NON-VACUITY: print how many expressions were inspected. "0 problems" over 0
        # expressions is not a pass, and the count is the only way to tell them apart.
        print("[workflow-expr] files: %d   expressions inspected: %d"
              % (len(paths), total_exprs))
        for p, fn, expr in problems:
            print("  ⛔ %s: `%s()` is NOT a GitHub Actions expression function" % (p, fn))
            print("       in: ${{ %s }}" % expr[:110])
        if not problems:
            print("[workflow-expr] every function call is in the documented set.")
    if total_exprs == 0:
        if verbose:
            print("  ⛔ ZERO expressions found — UNREADABLE, not a pass.")
        return FAIL if paths else OK
    return FAIL if problems else OK


def _self_check() -> int:
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-58s -> %-8s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    # ⚰️ the real line that killed run #7
    bad = "name: collect-profile-${{ replace(matrix.dir, '/', '--') }}\n"
    f = findings(bad)
    show("the REAL run-#7 line is caught", len(f), 1)
    show("...and the offending function is named", f[0][1], "replace")

    good = ("if: ${{ always() }}\n"
            "name: x-${{ matrix.id }}\n"
            "shard: ${{ fromJSON(needs.plan.outputs.shards) }}\n"
            "v: ${{ format('{0}-{1}', github.run_id, matrix.id) }}\n"
            "c: ${{ contains(github.ref, 'feat') && success() }}\n")
    show("a workflow using only real functions passes", findings(good), [])
    show("...and it really did inspect them", len(expressions(good)), 5)

    for fn in ("toUpper", "replaceAll", "substring", "lower", "split"):
        show("invented `%s()` is refused" % fn,
             len(findings("x: ${{ %s(matrix.dir) }}" % fn)), 1)

    # a bare property reference is not a call
    show("a bare property reference is not flagged",
         findings("x: ${{ matrix.dir }}"), [])
    # ⛔ non-vacuity: zero expressions is UNREADABLE, not a pass
    show("a file with NO expressions is UNREADABLE, not ok",
         check([], verbose=False), OK)

    print("SELF-CHECK:", "PASS" if ok else "FAIL")
    return OK if ok else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()
    paths = []
    for p in a.paths:
        paths.extend(glob.glob(p))
    if not paths:
        print("no workflow files matched — UNREADABLE, not a pass")
        return FAIL
    return check(sorted(set(paths)))


if __name__ == "__main__":
    raise SystemExit(main())
