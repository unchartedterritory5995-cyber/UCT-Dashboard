"""The union of what a set of vitest shards RAN equals what they were meant to cover, once each.

    python tools/ci_vitest_union.py --expected expected.txt --reports DIR --root app \
        [--floor 1000] [--must-include path ...]

`expected.txt` is `npx vitest list <roots> --filesOnly` (one file per line, relative to `--root`).
`DIR` holds each shard's `--reporter=json` output (`*.json`, searched recursively, as
`actions/download-artifact` lays them out). Paths are compared relative to `--root`, with `/`.

Fails (exit 1), naming every file, when:
  * a file no shard ran                      (a leg's filter dropped it, or a leg never reported)
  * a file two shards ran                    (two legs' filters overlap: paid twice, and a red can
                                              hide behind a green twin)
  * a file a shard ran that is not expected  (a filter reached outside the roots)
  * fewer than `--floor` expected files, or a `--must-include` file missing from the expected list
    (a vacuous expected list would make the three checks above pass on nothing)
Exit 2: a report could not be read. Test FAILURES are reported, not judged: each shard's own job
already fails on them, and this rail's subject is coverage.

WHY (2026-11-15, .github/workflows/pine-heavy.yml): the heavy Pine suites run as folder-sharded
legs. A folder split that silently drops a file is a test nobody runs, reported green.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys


def _rel(path: str, root: pathlib.Path) -> str:
    p = pathlib.PurePosixPath(str(path).replace("\\", "/"))
    r = pathlib.PurePosixPath(str(root).replace("\\", "/"))
    try:
        return str(p.relative_to(r))
    except ValueError:
        return str(p)


def ran_by_report(reports: pathlib.Path, root: pathlib.Path) -> dict[str, list[str]]:
    """{file relative to root: [report names that ran it]}."""
    out: dict[str, list[str]] = {}
    files = sorted(reports.rglob("*.json"))
    if not files:
        raise FileNotFoundError(f"no vitest JSON reports under {reports}")
    for f in files:
        doc = json.loads(f.read_text(encoding="utf-8"))
        for t in doc.get("testResults") or []:
            out.setdefault(_rel(t["name"], root), []).append(f.name)
    return out


def failures(reports: pathlib.Path) -> int:
    return sum(int(json.loads(f.read_text(encoding="utf-8")).get("numFailedTests") or 0)
               for f in sorted(reports.rglob("*.json")))


def judge(expected: list[str], ran: dict[str, list[str]], floor: int, must_include: list[str]) -> list[str]:
    """Every problem, as a line. Empty = the shards are an exact partition of the expected list."""
    exp = set(expected)
    problems = []
    if len(exp) < floor:
        problems.append(f"expected list has {len(exp)} files, under the floor of {floor}: wrong roots or wrong directory?")
    for m in must_include:
        if m not in exp:
            problems.append(f"expected list is missing a named member: {m}")
    problems += [f"no shard ran: {f}" for f in sorted(exp - set(ran))]
    problems += [f"ran by {len(ran[f])} shards ({', '.join(sorted(ran[f]))}): {f}" for f in sorted(ran) if len(ran[f]) > 1]
    problems += [f"ran but not in the expected list: {f}" for f in sorted(set(ran) - exp)]
    return problems


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expected", required=True)
    ap.add_argument("--reports", required=True)
    ap.add_argument("--root", required=True, help="the vitest root the reports' absolute paths are under (app/)")
    ap.add_argument("--floor", type=int, default=1)
    ap.add_argument("--must-include", nargs="*", default=[])
    a = ap.parse_args(argv)
    root = pathlib.Path(os.path.abspath(a.root))
    expected = [line.strip().replace("\\", "/") for line in pathlib.Path(a.expected).read_text(encoding="utf-8").splitlines() if line.strip()]
    try:
        ran = ran_by_report(pathlib.Path(a.reports), root)
        failed = failures(pathlib.Path(a.reports))
    except (OSError, ValueError, KeyError) as err:
        print(f"[vitest-union] cannot read the shard reports: {err}")
        return 2
    problems = judge(expected, ran, a.floor, a.must_include)
    print(f"[vitest-union] expected {len(set(expected))} files; shards ran {len(ran)} distinct; failed tests (judged by each shard): {failed}")
    for p in problems:
        print(f"::error::{p}")
    if problems:
        return 1
    print("[vitest-union] OK: every expected file ran exactly once")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
