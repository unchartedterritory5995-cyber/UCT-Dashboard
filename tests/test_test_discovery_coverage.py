"""Every collectable test file must live under a declared `testpaths` root.

93 test files under `api/**` were collectable and never collected. `pytest.ini`
declared no `testpaths`, so a bare `pytest` had to guess and every runner in this
repo globbed `tests/**` and walked past them. When they were finally run: 1,289
passed, 3 failed, and one file HUNG — a hang that made a full-suite run
impossible, sitting in the tree unnoticed for as long as the file existed.

The gap was silent because the number that would have surfaced it looked fine on
its own: `tests/` held 525 files and 9,731 passing assertions. **A count cannot
name what is missing** — 525 reads as healthy whether the real total is 525 or
618. So this rail does not count anything. It enumerates every file on disk that
matches pytest's OWN `python_files` patterns and fails with the NAMES of any that
sit outside every declared root.

Why this rail AND `testpaths`, rather than either alone:
  * `testpaths` is ignored the moment pytest is handed a path argument, and every
    runner here passes explicit paths (the chunked suite runners, the mutation
    gauntlets). `testpaths` fixes the bare-`pytest` default and leaves the actual
    invocations exactly as blind as before.
  * This rail runs inside the suite, so it is checked by every one of those
    invocations, and it names the offenders instead of reporting a number.

Both patterns and roots are read from the LIVE pytest config, never retyped here
— a rail that restates the config it guards is a second authority over it.
"""
import ast
import fnmatch
import os
import pathlib

import pytest

# Directories that never hold a suite. `node_modules` and `.git` are volume;
# `external/*` are git submodules that are EMPTY inside a worktree (walking them
# would make this rail read clean for the wrong reason); leading-dot directories
# in this repo are gitignored scratch and tool state.
_PRUNED = {"node_modules", "__pycache__", "external", "venv", ".venv", "dist", "build"}

# Files that MATCH pytest's naming patterns but are NOT suites. Every entry
# carries the reason it must stay out of collection — several would do real
# damage if collected. `test_the_exemptions_are_all_still_real` re-checks each
# one against disk, so a stale exemption can never quietly cover a future file.
NOT_A_SUITE = {
    "test_code_review.py":
        "one-off review script — reads a source file and prints at import time",
    "scripts/test_massive_ws.py":
        "manual probe against the LIVE Massive WS; Massive allows ~1 connection "
        "per key, so running it kicks production off the OPRA feed",
    "scripts/verify_phase_checks/test_suite.py":
        "a runner that shells out to `pytest tests/pattern_engine` — collecting "
        "it would recurse into a nested suite run",
    "tools/full_chart_diagnostic_test.py":
        "manual diagnostic that fetches from live bar providers",
    "tools/snaptrade_smoke_test.py":
        "manual smoke test against the live SnapTrade production account",
    "tools/twitterapi_io_smoke_test.py":
        "manual smoke test that spends real TwitterAPI.io credit",
}


def _discover(root: pathlib.Path, patterns) -> set:
    """Every file under `root` whose name matches one of pytest's own
    `python_files` patterns, as repo-relative posix paths."""
    found = set()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            d for d in dirnames if d not in _PRUNED and not d.startswith(".")
        ]
        for name in filenames:
            if any(fnmatch.fnmatch(name, pat) for pat in patterns):
                found.add(
                    (pathlib.Path(dirpath) / name).relative_to(root).as_posix()
                )
    return found


@pytest.fixture
def discovery(pytestconfig):
    root = pathlib.Path(pytestconfig.rootpath)
    return {
        "root": root,
        "roots": list(pytestconfig.getini("testpaths")),
        "patterns": list(pytestconfig.getini("python_files")),
        "files": _discover(root, list(pytestconfig.getini("python_files"))),
    }


def test_testpaths_declares_at_least_one_real_root(discovery):
    """Without this the rail below is vacuous: an empty `testpaths` makes the
    'under a declared root' check trivially unsatisfiable, and a root that has
    been renamed away makes it trivially satisfiable for that tree."""
    roots = discovery["roots"]
    assert roots, (
        "pytest.ini declares no `testpaths`. That is the original defect: with "
        "nothing declared, a bare `pytest` guesses and every runner globs a "
        "single directory by hand."
    )
    missing = [r for r in roots if not (discovery["root"] / r).is_dir()]
    assert not missing, f"testpaths names directories that do not exist: {missing}"


def test_the_discovery_walk_actually_reaches_every_declared_root(discovery):
    """The control. A walk that finds nothing — a bad prune, a wrong rootpath —
    would make the coverage assertion below pass over zero work, which is the
    exact failure mode this whole file exists to stop."""
    assert discovery["patterns"], "pytest reports no `python_files` patterns"
    for root in discovery["roots"]:
        prefix = root.replace(os.sep, "/").rstrip("/") + "/"
        assert any(f.startswith(prefix) for f in discovery["files"]), (
            f"the walk found no test files under declared root {root!r} — "
            f"discovery is broken, not the tree"
        )


def test_every_collectable_test_file_lives_under_a_testpaths_root(discovery):
    """The rail itself. Fails BY NAME, never by count."""
    prefixes = tuple(
        r.replace(os.sep, "/").rstrip("/") + "/" for r in discovery["roots"]
    )
    orphans = sorted(
        f for f in discovery["files"]
        if not f.startswith(prefixes) and f not in NOT_A_SUITE
    )
    assert not orphans, (
        f"{len(orphans)} test file(s) match pytest's python_files patterns but "
        f"live outside every declared testpaths root {list(discovery['roots'])!r}, "
        f"so no standard run collects them:\n  "
        + "\n  ".join(orphans)
        + "\n\nAdd the directory to `testpaths` in pytest.ini, or — if the file is "
        "a script rather than a suite — add it to NOT_A_SUITE here with the reason."
    )


def _matches_prefix_or_glob(patterns, name: str) -> bool:
    """pytest's own rule for `python_functions`/`python_classes`: a value with
    glob characters is fnmatched, anything else is a plain prefix."""
    for pat in patterns:
        if set(pat) & {"*", "?", "["}:
            if fnmatch.fnmatch(name, pat):
                return True
        elif name.startswith(pat):
            return True
    return False


def test_no_production_module_is_wearing_a_test_name(pytestconfig, discovery):
    """The inverse of the gap above, and it was also real.

    `api/backfill_tick_test.py` was a production one-shot backfill script — its
    name is about the Lee-Ready *tick test*, not about pytest — and it sat inside
    the tree this change just added to `testpaths`. It held no test callable, so
    it contributed nothing, while every collection run imported it (and anything
    it imports) for free. One module-level side effect away from running
    production code at collection time. It is now `api/backfill_ticktest.py`.

    Exactly 1 file out of 766 was in this state, so the signal is precise:
    a hit here means a module was named into the suite by accident."""
    funcs = list(pytestconfig.getini("python_functions"))
    classes = list(pytestconfig.getini("python_classes"))
    assert funcs and classes, "pytest reports no python_functions/python_classes"

    prefixes = tuple(
        r.replace(os.sep, "/").rstrip("/") + "/" for r in discovery["roots"]
    )
    empty = []
    for rel in sorted(f for f in discovery["files"] if f.startswith(prefixes)):
        path = discovery["root"] / rel
        try:
            tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError as exc:  # a file pytest could not collect either
            empty.append(f"{rel}: does not parse ({exc})")
            continue
        has_test = any(
            (isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
             and _matches_prefix_or_glob(funcs, n.name))
            or (isinstance(n, ast.ClassDef) and _matches_prefix_or_glob(classes, n.name))
            for n in ast.walk(tree)
        )
        if not has_test:
            empty.append(f"{rel}: matches python_files but defines no test")
    assert not empty, (
        "file(s) named into collection that hold no test — rename them out of "
        "pytest's python_files patterns:\n  " + "\n  ".join(empty)
    )


def test_the_exemptions_are_all_still_real(discovery):
    """An exemption list rots into a blindfold: delete `tools/foo_test.py` and
    its stale entry silently exempts the next file that takes that path. Each
    entry must still exist, still match a pytest pattern, and still sit outside
    the declared roots — otherwise it is dead and must be removed."""
    root, patterns = discovery["root"], discovery["patterns"]
    prefixes = tuple(
        r.replace(os.sep, "/").rstrip("/") + "/" for r in discovery["roots"]
    )
    problems = []
    for rel, reason in NOT_A_SUITE.items():
        assert reason.strip(), f"{rel} is exempted with no stated reason"
        path = root / rel
        if not path.is_file():
            problems.append(f"{rel}: no longer exists — remove the exemption")
        elif not any(fnmatch.fnmatch(path.name, pat) for pat in patterns):
            problems.append(f"{rel}: no longer matches python_files — exemption is dead")
        elif rel.startswith(prefixes):
            problems.append(
                f"{rel}: now sits under a testpaths root, so it IS being collected "
                f"— the exemption is not what is keeping it out"
            )
    assert not problems, "stale NOT_A_SUITE entries:\n  " + "\n  ".join(problems)
