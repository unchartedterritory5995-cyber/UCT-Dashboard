#!/usr/bin/env python
"""⭐⭐ A VITEST SCOPE LIST FAILS OPEN. THIS CLOSES IT.

⚰️ MEASURED 2026-09-13, on the first resume after the operator reboot. A rails
run named SEVEN test files and vitest ran SIX, **exiting 0**:

    node vitest.mjs run ...six real paths... \\
        src/components/chart/engine/__tests__/symbolFoldParity.test.js
    → Test Files  6 passed (6)        # and the seventh does not exist

`symbolFoldParity.test.js` is at ``engine/ast/``, not ``engine/__tests__/``.
Vitest treats a path that matches nothing as a filter that selected nothing,
which is not an error — so a scope list quietly shrinks and the run still reports
success. It was caught by counting files against paths BY HAND, which works
exactly as long as somebody remembers to count.

⛔ THIS IS THE SAME DEFECT FAMILY AS ``lesson_a_green_suite_can_hide_a_layout_regression``
(*"`vitest -t` is a REGEX: a filter matching nothing exits 0 = false PASS"*) and
``lesson_a_fixture_that_cannot_distinguish_is_not_a_rail``. A verification whose
scope can silently shrink is not a verification.

Usage — put it in front of the runner, never after:

    python tools/check_scope_paths.py <path> [<path> ...] && node ... run <path> ...

Exit 0 when every path exists, 1 naming each miss. ``--suggest`` looks for a file
of the same basename elsewhere in the tree, because the realistic mistake is a
moved file rather than a typo.
"""
import argparse
import os
import pathlib
import sys

SKIP_DIRS = {"node_modules", ".git", "dist", "build", "__pycache__", ".venv", "venv"}


def find_basename(root: pathlib.Path, name: str, limit: int = 5):
    """Where else a file of this basename lives — the moved-file case."""
    hits = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        if name in filenames:
            hits.append(pathlib.Path(dirpath) / name)
            if len(hits) >= limit:
                break
    return hits


def count_tests(root: pathlib.Path, limit: int = 1) -> int:
    """How many test files a DIRECTORY scope would actually select.

    ⛔ The same silent-shrink defect, one level up: `vitest run src/does/exist`
    on a directory holding no `*.test.*` runs nothing and exits 0, so "is the
    directory there" is not the question — "does it select a test" is.
    """
    seen = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            if ".test." in f or ".spec." in f:
                seen += 1
                if seen >= limit:
                    return seen
    return seen


def main(argv=None):
    ap = argparse.ArgumentParser(description="Assert every path in a scope list exists.")
    ap.add_argument("paths", nargs="*", help="the scope list, exactly as the runner will get it")
    ap.add_argument("--root", default=".", help="search root for --suggest (default: cwd)")
    ap.add_argument("--suggest", action="store_true",
                    help="on a miss, look for the same basename elsewhere")
    ap.add_argument("--self-check", action="store_true",
                    help="prove the check can FAIL, then exit non-zero")
    args = ap.parse_args(argv)

    if not args.paths and not args.self_check:
        ap.error("give at least one path (or --self-check)")

    if args.self_check:
        # ⛔ A GATE NOBODY HAS SEEN FAIL IS NOT A GATE (`lesson_gate_that_cannot_fail`),
        # and it now has TWO ways to fail, so both are driven — plus a POSITIVE
        # control, because a checker that refused everything would sail through a
        # self-check made only of refusals.
        import tempfile
        results = []
        results.append(("a bogus path", main(["__definitely_not_a_real_path__.test.js"]), 1))
        with tempfile.TemporaryDirectory() as td:
            empty = pathlib.Path(td) / "no_tests_here"
            empty.mkdir()
            (empty / "readme.md").write_text("not a test", encoding="utf-8")
            results.append(("a directory with no test file", main([str(empty)]), 1))
            real = pathlib.Path(td) / "has_tests"
            real.mkdir()
            (real / "a.test.js").write_text("// a test", encoding="utf-8")
            results.append(("a directory that holds one", main([str(real)]), 0))
        bad = [r for r in results if r[1] != r[2]]
        for what, got, want in results:
            print(f"[self-check] {what} returned {got} (expected {want})", file=sys.stderr)
        return 1 if bad else 0

    root = pathlib.Path(args.root).resolve()
    missing = []
    for p in args.paths:
        node = pathlib.Path(p)
        if node.is_file():
            continue
        # ⭐ A DIRECTORY IS A LEGITIMATE SCOPE, and refusing one would make this
        # cry wolf on the sweep scope, which names three — and a gate that cries
        # wolf gets muted, which is the failure this file exists to prevent.
        # ⛔ But "it exists" is not enough for a directory: a scope naming one
        # that holds no test file selects nothing and STILL exits 0, which is the
        # same silent shrink one level up.
        if node.is_dir():
            if count_tests(node):
                continue
            missing.append((p, "selects no test file"))
            continue
        missing.append((p, "does not exist"))

    if not missing:
        print(f"[scope] {len(args.paths)} path(s), all present")
        return 0

    print(f"[scope] REFUSED - {len(missing)} of {len(args.paths)} path(s) select nothing:",
          file=sys.stderr)
    for p, why in missing:
        print(f"  {why.upper():<22} {p}", file=sys.stderr)
        if args.suggest:
            for hit in find_basename(root, pathlib.Path(p).name):
                try:
                    shown = hit.relative_to(root)
                except ValueError:
                    shown = hit
                print(f"           did you mean: {shown}", file=sys.stderr)
    print("\nA runner would have SKIPPED these and exited 0. That is a scope list\n"
          "shrinking in silence, not a passing suite.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
