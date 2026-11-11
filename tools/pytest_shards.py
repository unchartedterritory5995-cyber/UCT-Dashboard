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
    python tools/pytest_shards.py --plan --buckets 12   # the OLD count-cut, for comparison
    python tools/pytest_shards.py --record-timings <junit>... --source "<run id>"
                                                         # refresh the timing file, newest run first

⭐ 2026-11-10: the root buckets are cut by MEASURED time from `tools/pytest_shard_timings.json`
(per-file junit seconds from the last completed runs), not by file count — see `ROOT_BUCKETS`.
"""
from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys

OK, FAIL = 0, 1

#: how many alphabetical buckets the loose root files split into.
#:
#: ⚰️⚰️ **8 → 12 WAS TRIED IN RUN #24 AND REVERTED THE SAME HOUR. IT COST 41 NEW FAILURES.**
#: `tests-05` hit the 20-minute cap in run #23 (the Run step killed at **1,142 s**, no
#: totals line, `shards_without_totals = ['tests-05']`, the gate correctly INVALID over 21
#: MISSING entries), and the standing rule says such a job is **SPLIT, not extended**. So it
#: was split — and run #24 came back **NEW_FAILURES, 41 of them, every one in
#: `tests/test_voice_router.py`, every one `402 Payment Required`**:
#:
#:     assert 402 == 401      assert 402 == 200
#:
#: ⛔ **A FINER ALPHABETICAL SPLIT IS NOT A NEUTRAL OPERATION — IT CHANGES WHO SHARES A
#: PROCESS.** At 8 buckets that file lands in `tests-08` beside 155 others; at 12 it lands
#: in `tests-11` beside a different 103, and the paid-subscription state it silently
#: depended on is no longer set up by a neighbour. **The tests are order-dependent**, which
#: is a real defect this partition made visible and did not create — F-CI-36.
#:
#: ⭐ **The gate caught it inside one run, by name, and excused none of it as flaky.** That
#: is the whole apparatus working; the trade is still bad, because one INVALID run is
#: cheaper than 41 failures, so this is back at 8 until the isolation defect is fixed.
#: ⛔ And the real fix is a **time-weighted** partition, not a finer alphabetical one — the
#: alphabet is exactly what re-shuffles neighbours.
#:
#: ⭐⭐ **SECOND ATTEMPT, 2026-09-15 — THE BLOCKER IS GONE.** F-CI-36's cause was ONE file:
#: `tests/test_thesis_reviews_router.py` leaked a `get_current_user` override onto the
#: shared app, so a stub user with no plan answered for every later test in the process.
#: Fixed in `240bb3305`. The exact reproduction that produced 41 failures now produces
#: **62 passed**, and the full 52-file joined set goes **52 failed -> 10**, none in the
#: voice file. ⛔ The joined set lives entirely inside ONE bucket at 12 (`tests-11`,
#: proved), so if it breaks again it breaks in one place.
#:
#: ⚠️ **THE PROJECTION IS CALIBRATED, NOT SUMMED.** junit's per-test `time` excludes
#: COLLECTION, and collection is not evenly spread: measured on run #28, observed/projected
#: ran **1.09 to 2.22** across the eight loose-root shards. Projecting every 12-bucket
#: shard with the WORST of those ratios gives a worst case of **938 s against the 1,200 s
#: cap** (headroom 262 s), with tests-07 second at 902 s. A raw sum would have said 422 s
#: and been wrong by more than double.
#:
#: ⛔ ONE ATTEMPT. A NEW failure among the 52 formerly-leaking files reverts this by EDIT,
#: in the same session, with a finding naming the shared state — no third try.
#:
#: ⚰️⚰️ **2026-11-10 — COUNT-BALANCED BUCKETS CANCELLED EVERY NIGHTLY SINCE ≥10-31.** Twelve
#: buckets of ~224 files each are equal in FILE COUNT and nothing else: `tests-10` carried
#: 5,393 tests, took 33 min locally and was 23% done at 18 min on CI, so the job hit its
#: 20-minute cap and the whole run read `cancelled`. No single test hung.
#: ⭐ The buckets are now cut by MEASURED time (`ROOT_BUCKET_TARGET_S` below): still
#: contiguous and alphabetical (so a shard id still names what is in it, and neighbours move
#: only at the cut points), but the cut points are placed on the cumulative recorded seconds.
#: `ROOT_BUCKETS` is now the FLOOR on the bucket count, not the count.
ROOT_BUCKETS = 12
#: ⛔ The interim when no timing file can be read: pure file count, at twice the buckets, so
#: a missing timing file degrades to "more, smaller shards", never to the cancelled shape.
ROOT_BUCKETS_NO_TIMINGS = 24
#: the most root buckets the planner may use (a ceiling on runner fan-out).
ROOT_BUCKETS_MAX = 40
#: aim for each root bucket at this much RECORDED time; the planner adds buckets until the
#: largest one is at or under it.
ROOT_BUCKET_TARGET_S = 600.0
#: ⛔ THE RAIL: no planned shard (root bucket or directory shard) may exceed this much
#: recorded + estimated time. ⚠️ Recorded junit time is NOT wall time: it excludes
#: collection and job setup, and wall/recorded measured **1.1 to 1.5** on run 42846929317
#: (tests-09: 912 s wall vs 615 s recorded). 720 s × 1.5 ≈ 18 min + ~3 min setup, inside the
#: pytest job's 30-minute cap — that cap is headroom; THIS is the fix.
SHARD_RAIL_S = 720.0
#: files with no recorded time weigh this percentile of the recorded per-file times
#: (conservative: 90% of timed files are faster). It is the "fall back to file count" rule
#: with a unit that is in seconds, so timed and untimed files can share one cut.
FALLBACK_PERCENTILE = 90
#: the timing file must cover at least this share of the loose root files, or the planner
#: is guessing and `--self-check` says so.
MIN_TIMING_COVERAGE = 0.85
TIMINGS_FILE = "tools/pytest_shard_timings.json"
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


# --------------------------------------------------------------------------- timings

def load_timings(path=None) -> dict:
    """{file: seconds} from the committed timing file; {} if it is absent or unreadable.

    Stored as integer MILLISECONDS so the plan is a pure function of the file's bytes.
    """
    p = pathlib.Path(path) if path else (_repo_root() / TIMINGS_FILE)
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
        files = doc["files_ms"]
        return {str(k): int(v) / 1000.0 for k, v in files.items() if int(v) >= 0}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return {}


def fallback_seconds(timings: dict, pct: int = FALLBACK_PERCENTILE) -> float:
    """The weight of a file with no recorded time: a percentile of the recorded ones."""
    vals = sorted(timings.values())
    if not vals:
        return 1.0
    i = min(len(vals) - 1, max(0, (len(vals) * pct) // 100))
    return vals[i]


def file_weights(files: list, timings: dict) -> tuple:
    """([seconds per file], fallback, untimed_count) — recorded where known, fallback otherwise."""
    fb = fallback_seconds(timings)
    w = [timings[f] if f in timings else fb for f in files]
    return w, fb, sum(1 for f in files if f not in timings)


def _cut(weights: list, n: int) -> list:
    """Split [0, len) into <= n CONTIGUOUS non-empty runs at the cumulative-time targets.

    Boundary k sits at the file where the running total is closest to k/n of the whole.
    Deterministic: ties go to the earlier index. Returns [(start, end), ...].
    """
    m = len(weights)
    n = max(1, min(int(n), m))
    total = float(sum(weights))
    pref = [0.0]
    for x in weights:
        pref.append(pref[-1] + x)
    bounds = [0]
    for k in range(1, n):
        target = total * k / n
        lo = bounds[-1] + 1                     # each run is non-empty
        hi = m - (n - k)                        # leave one file per remaining run
        j = lo
        best = abs(pref[lo] - target)
        for c in range(lo + 1, hi + 1):
            d = abs(pref[c] - target)
            if d < best:
                best, j = d, c
            if pref[c] > target:
                break
        bounds.append(j)
    bounds.append(m)
    return [(bounds[i], bounds[i + 1]) for i in range(len(bounds) - 1)]


def root_buckets(loose: list, timings: dict) -> list:
    """The root buckets as lists of files. Time-cut when timings exist, count-cut otherwise."""
    if not loose:
        return []
    if not timings:
        n = ROOT_BUCKETS_NO_TIMINGS
        size = (len(loose) + n - 1) // n
        return [loose[i:i + size] for i in range(0, len(loose), size)]
    w, _fb, _u = file_weights(loose, timings)
    chosen = None
    for n in range(ROOT_BUCKETS, ROOT_BUCKETS_MAX + 1):
        runs = _cut(w, n)
        chosen = runs
        if max(sum(w[a:b]) for a, b in runs) <= ROOT_BUCKET_TARGET_S:
            break
    return [loose[a:b] for a, b in chosen]


# --------------------------------------------------------------------------- the plan

def shard_plan(root: pathlib.Path | None = None, buckets: int | None = None,
               timings: dict | None = None) -> dict:
    """{shard_id: [files]} — a partition of `all_test_files`.

    `buckets` forces the OLD count-based split (kept for `--before` comparisons); the
    default is the time-cut over `timings` (the committed timing file when None).
    """
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

    if buckets is not None:
        n = max(1, int(buckets))
        size = (len(loose) + n - 1) // n if loose else 1
        chunks = [loose[i * size:(i + 1) * size] for i in range(n)]
    else:
        chunks = root_buckets(loose, load_timings() if timings is None else timings)
    for i, chunk in enumerate([c for c in chunks if c]):
        plan["%s-%02d" % (top, i + 1)] = chunk
    return plan


def shard_seconds(plan: dict, timings: dict) -> dict:
    """{shard: {"files", "recorded_s", "estimated_s", "untimed"}} — the rail's numbers."""
    fb = fallback_seconds(timings) if timings else 0.0
    out = collections.OrderedDict()
    for k in sorted(plan):
        v = plan[k]
        rec = sum(timings[f] for f in v if f in timings)
        unt = sum(1 for f in v if f not in timings)
        out[k] = {"files": len(v), "recorded_s": round(rec, 1),
                  "estimated_s": round(rec + unt * fb, 1), "untimed": unt}
    return out


def rail_violations(plan: dict, timings: dict, rail_s: float = SHARD_RAIL_S) -> list:
    """Shards whose recorded + estimated time exceeds the rail."""
    return sorted(k for k, s in shard_seconds(plan, timings).items() if s["estimated_s"] > rail_s)


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


# --------------------------------------------------------------------------- recording

def record_timings(junit_paths: list, files: list) -> dict:
    """{file: ms} from junit reports, FIRST path wins per file (pass the newest run first).

    junit `classname` is the dotted module path, optionally followed by a class; it is
    mapped to the LONGEST module prefix that is a current test file. A file whose report
    has no testcases (collection error, interrupted run) is simply not observed there.
    """
    import xml.etree.ElementTree as ET

    mods = {f[:-3].replace("/", "."): f for f in files}
    out = {}
    # group by run so "first path wins" is per RUN, not per shard file
    for p in junit_paths:
        acc = collections.defaultdict(float)
        for _ev, el in ET.iterparse(str(p)):
            if el.tag == "testcase":
                parts = (el.get("classname") or "").split(".")
                for i in range(len(parts), 0, -1):
                    f = mods.get(".".join(parts[:i]))
                    if f:
                        try:
                            acc[f] += float(el.get("time") or 0)
                        except ValueError:
                            pass
                        break
            el.clear()
        for f, t in acc.items():
            out.setdefault(f, int(round(t * 1000)))
    return out


def write_timings(path, files_ms: dict, sources: list) -> None:
    doc = {
        "_about": ("Per-file recorded pytest seconds (junit testcase time, summed per file), in "
                   "integer ms. Read by tools/pytest_shards.py to cut the root buckets by time. "
                   "Refresh: python tools/pytest_shards.py --record-timings <junit>... "
                   "(newest run first)."),
        "sources": list(sources),
        "files_ms": {k: files_ms[k] for k in sorted(files_ms)},
    }
    pathlib.Path(path).write_text(json.dumps(doc, indent=1, sort_keys=False) + "\n",
                                  encoding="utf-8")


# --------------------------------------------------------------------------- self-check

def _self_check(timings_path=None) -> int:
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-56s -> %-10s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    files = all_test_files()
    timings = load_timings(timings_path)
    plan = shard_plan(timings=timings)
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

    # ⛔ TIME RAILS — the timing file is real, covers the tree, and the plan fits the rail.
    loose = [f for f in files if f.count("/") == 1]
    cov = sum(1 for f in loose if f in timings) / float(len(loose) or 1)
    show("timing file loads and is non-empty", len(timings) > 1000, True)
    show("timing covers >= %d%% of loose root files" % int(MIN_TIMING_COVERAGE * 100),
         cov >= MIN_TIMING_COVERAGE, True)
    secs = shard_seconds(plan, timings)
    worst = max(secs.items(), key=lambda kv: kv[1]["estimated_s"])
    print("  (largest planned shard: %s %.0f s recorded+estimated)" % (worst[0],
                                                                      worst[1]["estimated_s"]))
    show("no planned shard exceeds the %d s rail" % SHARD_RAIL_S,
         rail_violations(plan, timings), [])
    show("the plan is deterministic (two builds identical)",
         shard_plan(timings=timings) == plan, True)

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
    # the rail must be able to fire: on THIS plan just under its own maximum, and on the
    # old 12-bucket count-cut plan — the measured shape that cancelled every nightly.
    show("the rail REFUSES this plan with the rail set 1 s under its max",
         bool(rail_violations(plan, timings, rail_s=worst[1]["estimated_s"] - 1)), True)
    old = rail_violations(shard_plan(buckets=ROOT_BUCKETS, timings=timings), timings)
    print("  (old %d-bucket count-cut plan over the rail: %s)" % (ROOT_BUCKETS, old))
    show("the rail REFUSES the old count-cut plan", bool(old), True)

    print("SELF-CHECK:", "PASS" if ok else "FAIL")
    return OK if ok else FAIL


def _print_table(plan: dict, timings: dict, title: str) -> None:
    print(title)
    print("  %-22s %6s %10s %10s %8s" % ("shard", "files", "recorded_s", "est_s", "untimed"))
    for k, s in shard_seconds(plan, timings).items():
        print("  %-22s %6d %10.0f %10.0f %8d" % (k, s["files"], s["recorded_s"],
                                                 s["estimated_s"], s["untimed"]))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--files")
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--buckets", type=int, default=None,
                    help="force the OLD count-based split into N root buckets (comparison only)")
    ap.add_argument("--timings", default=None,
                    help="timing file (default %s)" % TIMINGS_FILE)
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--record-timings", nargs="+", metavar="JUNIT",
                    help="write --timings from these junit files, newest run FIRST")
    ap.add_argument("--source", action="append", default=[],
                    help="with --record-timings: a provenance line to store (repeatable)")
    a = ap.parse_args(argv)

    tpath = a.timings or str(_repo_root() / TIMINGS_FILE)
    if a.record_timings:
        out = tpath
        ms = record_timings(a.record_timings, all_test_files())
        write_timings(out, ms, a.source)
        print("wrote %d file timings to %s" % (len(ms), out))
        return OK

    if a.self_check:
        return _self_check(tpath)

    timings = load_timings(tpath)
    if not timings:
        print("::warning title=pytest shard timings unreadable::%s could not be read; "
              "falling back to %d file-count root buckets" % (tpath,
                                                             ROOT_BUCKETS_NO_TIMINGS),
              file=sys.stderr)
    plan = shard_plan(buckets=a.buckets, timings=timings)
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
    _print_table(plan, timings, "shard plan (seconds are recorded junit time, not wall time)")
    print()
    for key in ("shards", "files_total", "files_in_shards", "sum_of_shard_sizes",
                "is_partition", "largest_shard"):
        print("  %-20s %s" % (key, rep[key]))
    print("  %-20s %.2f s per untimed file (p%d of recorded)" % (
        "fallback", fallback_seconds(timings), FALLBACK_PERCENTILE))
    if rep["duplicated"] or rep["missing"]:
        print("  ⛔ NOT A PARTITION")
        return FAIL
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
