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
        # ⛔ A GATE NOBODY HAS SEEN FAIL IS NOT A GATE (`lesson_gate_that_cannot_fail`).
        bogus = "__definitely_not_a_real_path__.test.js"
        ok = main([bogus])
        print(f"[self-check] a bogus path returned {ok} (expected 1)", file=sys.stderr)
        return 0 if ok == 1 else 1

    root = pathlib.Path(args.root).resolve()
    missing = []
    for p in args.paths:
        if not pathlib.Path(p).is_file():
            missing.append(p)

    if not missing:
        print(f"[scope] {len(args.paths)} path(s), all present")
        return 0

    print(f"[scope] REFUSED - {len(missing)} of {len(args.paths)} path(s) do not exist:",
          file=sys.stderr)
    for p in missing:
        print(f"  MISSING  {p}", file=sys.stderr)
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
