"""A deterministic PARTITION of the backend test tree, for CI sharding.

⛔⛔ **E CP6 — WHY THIS EXISTS INSTEAD OF `scripts/gate_shards.py`.** The session's default
was to use that script if its output partitions the test tree. **It does not touch the test
tree at all.** Measured with comments stripped: **zero** code references to `pytest` or
`tests/`; it runs `npx vitest run --shard=i/n` over `app/src`. It is the FRONTEND gate.
⚠️ And the word "pytest" appears **0** times in it even raw, so the comment-strip proved
nothing there — the proof is the vitest invocation, not the absence.

⛔ **AND THE OBVIOUS FALLBACK DOES NOT BALANCE.** "Partition by top-level test directory"
yields, measured:

    (root)          1248        api               26
    pattern_engine   136        theme_curation    13
                               theme_engine        7

**1,248 of 1,430 files are loose directly in `tests/`** — one shard would carry 87% of the
suite and still blow any cap. Run #4 ran the whole tree for **2,671 s** without finishing.

⭐ So the partition is: **one shard per populated subdirectory, plus the loose root files
split into N contiguous alphabetical buckets.** Deterministic (sorted), human-readable (a
shard id names what is in it), and provable — which is the part that matters.

⛔ **A SHARD PLAN THAT IS NOT A PARTITION IS WORSE THAN NO SHARDING**: a file in two shards
runs twice and a file in none is silently never tested, and the second failure looks exactly
like a pass. `--self-check` proves union-equals-all and pairwise-empty, and prints every
count.

Usage:
    python tools/pytest_shards.py --list                 # JSON array of shard ids (matrix)
    python tools/pytest_shards.py --files <shard-id>     # newline-separated file list
    python tools/pytest_shards.py --plan                 # the table, for a human
    python tools/pytest_shards.py --self-check
"""
from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys

OK, FAIL = 0, 1

#: how many alphabetical buckets the loose root files split into.
#: ⚰️ **8 UNTIL RUN #23, WHEN `tests-05` HIT THE 20-MINUTE CAP AND WAS CANCELLED** — the
#: Run step was killed at **1,142 s** with the job at 1,234 s, so the shard printed no
#: totals line, the record read `shards_without_totals = ['tests-05']`, and the gate
#: correctly returned INVALID over 21 MISSING baseline entries.
#: ⛔ **A job that cannot print a totals line within its cap is SPLIT, not extended.**
#: Raising `timeout-minutes` buys one run and hides the trend; more buckets is the fix the
#: standing rule names. ⚠️ The partition is by FILE COUNT, not by time, so 8 → 12 is a
#: ~33% cut in expected worst-case work and NOT a guarantee — the next run measures it.
ROOT_BUCKETS = 12
TEST_GLOB = "test_*.py"


def _repo_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parent.parent


def all_test_files(root: pathlib.Path | None = None) -> list:
    """Every backend test file, repo-relative, SORTED. One enumeration, reused."""
    base = root or (_repo_root() / "tests")
    out = []
    for p in base.rglob(TEST_GLOB):
        if "__pycache__" in p.parts:
            continue
        out.append(p.relative_to(base.parent).as_posix())
    return sorted(out)


def shard_plan(root: pathlib.Path | None = None, buckets: int = ROOT_BUCKETS) -> dict:
    """{shard_id: [files]} — a partition of `all_test_files`."""
    base = root or (_repo_root() / "tests")
    files = all_test_files(base)
    top = base.name

    loose, bydir = [], collections.OrderedDict()
    for f in files:
        parts = pathlib.PurePosixPath(f).parts          # ('tests', ...)
        if len(parts) == 2:
            loose.append(f)
        else:
            bydir.setdefault(parts[1], []).append(f)

    plan = collections.OrderedDict()
    for d in sorted(bydir):
        plan["dir-%s" % d] = bydir[d]

    # contiguous alphabetical buckets over the sorted loose files
    n = max(1, int(buckets))
    if loose:
        size = (len(loose) + n - 1) // n
        for i in range(n):
            chunk = loose[i * size:(i + 1) * size]
            if chunk:
                plan["%s-%02d" % (top, i + 1)] = chunk
    return plan


def partition_report(plan: dict, files: list) -> dict:
    """Union / overlap / coverage, as numbers rather than a claim."""
    seen = collections.Counter()
    for members in plan.values():
        seen.update(members)
    union = set(seen)
    allf = set(files)
    dupes = sorted([f for f, c in seen.items() if c > 1])
    return {
        "shards": len(plan),
        "files_total": len(allf),
        "files_in_shards": len(union),
        "sum_of_shard_sizes": sum(len(v) for v in plan.values()),
        "duplicated": dupes,
        "missing": sorted(allf - union),
        "extra": sorted(union - allf),
        "is_partition": (union == allf and not dupes),
        "largest_shard": max(((k, len(v)) for k, v in plan.items()),
                             key=lambda kv: kv[1], default=(None, 0)),
    }


def _self_check() -> int:
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-56s -> %-10s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    files = all_test_files()
    plan = shard_plan()
    rep = partition_report(plan, files)

    # ⛔ NON-VACUITY FIRST: a plan over an empty tree partitions it perfectly and means nothing.
    show("the tree is non-empty (non-vacuity)", rep["files_total"] > 1000, True)
    show("every file lands in a shard", rep["files_in_shards"], rep["files_total"])
    show("no file lands in two shards", rep["duplicated"], [])
    show("no file is missing", rep["missing"], [])
    show("no shard invents a file", rep["extra"], [])
    show("sum of shard sizes == file count (no double count)",
         rep["sum_of_shard_sizes"], rep["files_total"])
    show("IS A PARTITION", rep["is_partition"], True)
    show("more than one shard", rep["shards"] > 1, True)

    # ⛔ the balance claim is the REASON for the design, so it is asserted
    biggest = rep["largest_shard"][1]
    show("largest shard holds under 25%% of the tree",
         biggest < rep["files_total"] * 0.25, True)

    # ⛔ MUTATION CONTROL: a broken plan must FAIL this check, or it proves nothing.
    bad = dict(plan)
    k = sorted(bad)[0]
    bad[k] = bad[k][:-1]                      # drop one file
    show("a plan MISSING one file is refused",
         partition_report(bad, files)["is_partition"], False)
    bad2 = dict(plan)
    ks = sorted(bad2)
    bad2[ks[1]] = bad2[ks[1]] + bad2[ks[0]][:1]   # duplicate one file
    show("a plan DUPLICATING one file is refused",
         partition_report(bad2, files)["is_partition"], False)

    print("SELF-CHECK:", "PASS" if ok else "FAIL")
    return OK if ok else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--files")
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--buckets", type=int, default=ROOT_BUCKETS)
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)

    if a.self_check:
        return _self_check()

    plan = shard_plan(buckets=a.buckets)
    if a.list:
        print(json.dumps(sorted(plan)))
        return OK
    if a.files:
        members = plan.get(a.files)
        if not members:
            print("no such shard: %s" % a.files, file=sys.stderr)
            return FAIL
        print("\n".join(members))
        return OK
    rep = partition_report(plan, all_test_files())
    print("shard | files")
    for k in sorted(plan):
        print("  %-18s %4d" % (k, len(plan[k])))
    print()
    for key in ("shards", "files_total", "files_in_shards", "sum_of_shard_sizes",
                "is_partition", "largest_shard"):
        print("  %-20s %s" % (key, rep[key]))
    if rep["duplicated"] or rep["missing"]:
        print("  ⛔ NOT A PARTITION")
        return FAIL
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
