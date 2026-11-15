"""Runtime-balanced shards for the UCT Agent browser tests (agent-ci.yml `browser` job).

WHY (2026-11-15, owner D27 #2): `npx vitest run $AGENT_VITEST_PATHS --shard=N/4` splits by FILE COUNT
(vitest's sequencer hashes paths and slices). Measured on five green agent-ci runs (11-15), the four
shards ran ~110 files each but 24.6 / 30.0 / 38.2 / 55.6 summed file-minutes, so shard 4 took ~30 min
of wall while shard 1 took ~17. This module cuts the same file list by MEASURED time instead, the way
tools/pytest_shards.py cut the nightly pytest root buckets in #1064.

THE ASSIGNMENT IS A PURE FUNCTION of (the file list `vitest list` reports, the committed timing file,
the shard count): greedy longest-processing-time-first over integer milliseconds, ties broken by path
and then by the lowest shard index. Every shard job computes the same plan from the same inputs.

COVERAGE (fail closed):
  - every listed file is assigned to exactly one shard; a file with NO recorded time weighs the p90 of
    the recorded ones and is placed by the same greedy rule (onto the lightest shard at that point);
  - a timing entry for a file that no longer exists is ignored (a deleted file never breaks the job);
  - an empty or unreadable timing file degrades to an even split by count, never to an error;
  - vitest treats a positional file argument as a SUBSTRING filter, so `a.test.js` would also run
    `a.test.jsx`. Files where one path is a substring of another are kept in ONE shard together, so
    the files a shard actually runs are exactly the files it was assigned;
  - the `union` job still proves the executed union equals `vitest list` (unchanged), and now also
    refuses a file that ran in two shards.

Usage (from the repo root or anywhere; paths are app-relative, as `vitest list --filesOnly` prints):
    python tools/agent_vitest_shards.py --files-list files.txt --shard 2 --of 4    # shard 2's files
    python tools/agent_vitest_shards.py --files-list files.txt --of 4 --plan       # table for a human
    python tools/agent_vitest_shards.py --record-timings runs/*/agent-shard-*/shard-*.json --source "run 437..."
    python tools/agent_vitest_shards.py --compare runs/<id>/agent-shard-*/shard-*.json --of 4    # before vs after

REFRESH THE TIMINGS (read-only, no reruns):
    for id in $(gh run list --workflow agent-ci.yml --status success --limit 5 --json databaseId -q '.[].databaseId'); do
      gh run download $id -p 'agent-shard-*' -D runs/$id; done
    python tools/agent_vitest_shards.py --record-timings runs/*/agent-shard-*/shard-*.json --source "agent ci runs <ids>"
  Each file's time is the MEDIAN of its observations (endTime - startTime in the vitest json reporter),
  stored as integer ms, so the plan is a pure function of the file's bytes.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

OK, FAIL = 0, 1

TIMINGS_FILE = "tools/agent_vitest_shard_timings.json"
#: weight of a file with no recorded time: this percentile of the recorded per-file times.
FALLBACK_PERCENTILE = 90
#: weight of every file when no timing can be read (any constant gives a count-balanced split).
NO_TIMINGS_MS = 1000


def _repo_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parent.parent


def norm(p: str) -> str:
    """An app-relative, forward-slash path: 'src/agent/x.test.jsx'. Absolute CI paths are cut at '/app/'."""
    p = p.strip().replace("\\", "/")
    m = re.search(r"(^|/)app/(src/.*)$", p)
    if m:
        p = m.group(2)
    while p.startswith("./"):
        p = p[2:]
    return p


TEST_PATH = re.compile(r"^[^\s]+\.(test|spec)\.[cm]?[jt]sx?$")


def read_files_list(text: str) -> list:
    """The `vitest list --filesOnly` output as a sorted, de-duplicated list of app-relative paths.

    Fails closed: a non-blank line that is not a single test-file path raises ValueError — it would otherwise
    be passed to `vitest run` as a filter (word-split, substring-matched) and run files outside the plan."""
    out, bad = set(), []
    for line in text.splitlines():
        if not line.strip():
            continue
        p = norm(line)
        (out.add(p) if TEST_PATH.match(p) else bad.append(line))
    if bad:
        raise ValueError("not a test-file path: %r" % bad[:5])
    return sorted(out)


# --------------------------------------------------------------------------- timings
def load_timings(path=None) -> dict:
    """{file: ms} from the committed timing file; {} if it is absent or unreadable."""
    p = pathlib.Path(path) if path else (_repo_root() / TIMINGS_FILE)
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
        return {norm(str(k)): int(v) for k, v in doc["files_ms"].items() if int(v) >= 0}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return {}


def fallback_ms(timings: dict, pct: int = FALLBACK_PERCENTILE) -> int:
    vals = sorted(timings.values())
    if not vals:
        return NO_TIMINGS_MS
    return vals[min(len(vals) - 1, max(0, (len(vals) * pct) // 100))]


def weights(files: list, timings: dict) -> dict:
    fb = fallback_ms(timings)
    return {f: (timings[f] if f in timings else fb) for f in files}


# --------------------------------------------------------------------------- assignment
def filter_groups(files: list) -> list:
    """Files that vitest's substring filter would conflate, unioned into groups (each group sorted).

    vitest 4 runs every test file whose app-relative path CONTAINS a positional argument (case-insensitive),
    so if path A is a substring of path B, the shard given A would also run B. Keeping them together makes a
    shard's effective set equal its assigned set."""
    files = sorted(set(files))
    parent = {f: f for f in files}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    low = [(f, f.lower()) for f in files]
    for a, al in low:
        for b, bl in low:
            if a != b and al in bl:
                ra, rb = find(a), find(b)
                if ra != rb:
                    parent[max(ra, rb)] = min(ra, rb)
    groups = {}
    for f in files:
        groups.setdefault(find(f), []).append(f)
    return sorted((sorted(g) for g in groups.values()), key=lambda g: g[0])


def assign(files: list, timings: dict, n: int) -> list:
    """n sorted file lists — a partition of `files`, balanced by recorded time (greedy LPT).

    Order: heaviest group first, ties by first path; each goes to the shard with the least load so far,
    ties to the lowest index. Integer ms throughout, so the result is identical on every machine."""
    n = int(n)
    if n < 1:
        raise ValueError("shard count must be >= 1")
    w = weights(sorted(set(files)), timings)
    groups = [(sum(w[f] for f in g), g) for g in filter_groups(files)]
    groups.sort(key=lambda t: (-t[0], t[1][0]))
    loads = [0] * n
    bins = [[] for _ in range(n)]
    for gw, g in groups:
        i = min(range(n), key=lambda k: (loads[k], k))
        loads[i] += gw
        bins[i].extend(g)
    return [sorted(b) for b in bins]


def shard_loads(plan: list, timings: dict) -> list:
    """[{"files", "ms", "untimed"}] per shard (index 0 = shard 1)."""
    allf = [f for b in plan for f in b]
    w = weights(allf, timings)
    return [{"files": len(b), "ms": sum(w[f] for f in b), "untimed": sum(1 for f in b if f not in timings)}
            for b in plan]


def partition_report(plan: list, files: list) -> dict:
    seen = {}
    for i, b in enumerate(plan):
        for f in b:
            seen.setdefault(f, []).append(i + 1)
    allf = set(files)
    return {
        "missing": sorted(allf - set(seen)),
        "extra": sorted(set(seen) - allf),
        "duplicated": sorted(f for f, s in seen.items() if len(s) > 1),
        "is_partition": set(seen) == allf and all(len(s) == 1 for s in seen.values()),
    }


# --------------------------------------------------------------------------- recording / measuring
def _results(paths: list):
    for p in paths:
        doc = json.loads(pathlib.Path(p).read_text(encoding="utf-8"))
        yield p, doc


def observed_ms(paths: list) -> dict:
    """{file: [ms, ...]} from vitest json reporter outputs (testResults[].endTime - startTime)."""
    obs = {}
    for _p, doc in _results(paths):
        for t in doc.get("testResults") or []:
            try:
                ms = int(round(float(t["endTime"]) - float(t["startTime"])))
            except (KeyError, TypeError, ValueError):
                continue
            if ms >= 0:
                obs.setdefault(norm(t["name"]), []).append(ms)
    return obs


def median_int(vals: list) -> int:
    v = sorted(vals)
    m = len(v) // 2
    return v[m] if len(v) % 2 else (v[m - 1] + v[m]) // 2


def record_timings(paths: list) -> dict:
    return {f: median_int(v) for f, v in observed_ms(paths).items()}


def write_timings(path, files_ms: dict, sources: list) -> None:
    doc = {
        "_about": ("Per-file recorded vitest milliseconds for the UCT Agent browser shards (median of "
                   "endTime - startTime over the sources' agent-shard-N json artifacts). Read by "
                   "tools/agent_vitest_shards.py to balance agent-ci.yml's browser shards by time. "
                   "Refresh: see that module's docstring."),
        "sources": list(sources),
        "files_ms": {k: int(files_ms[k]) for k in sorted(files_ms)},
    }
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(doc, indent=1) + "\n")


def compare(paths: list, timings: dict, n: int) -> dict:
    """Before = what each shard-N.json actually ran (its observed file times); after = this plan over the
    same files and the same observed times. Returns {"before": [ms...], "after": [ms...]}."""
    before = []
    times = {}
    for p, doc in sorted(_results(paths), key=lambda t: str(t[0])):
        s = 0
        for t in doc.get("testResults") or []:
            ms = int(round(float(t["endTime"]) - float(t["startTime"])))
            times[norm(t["name"])] = ms
            s += ms
        before.append(s)
    plan = assign(sorted(times), timings, n)
    after = [sum(times[f] for f in b) for b in plan]
    return {"before": before, "after": after}


# --------------------------------------------------------------------------- cli
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--files-list", help="file holding `vitest list --filesOnly` output ('-' = stdin)")
    ap.add_argument("--of", type=int, default=4, help="shard count")
    ap.add_argument("--shard", type=int, help="print this shard's files (1-based), one per line")
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--timings", default=None, help="timing file (default %s)" % TIMINGS_FILE)
    ap.add_argument("--record-timings", nargs="+", metavar="SHARD_JSON")
    ap.add_argument("--source", action="append", default=[])
    ap.add_argument("--compare", nargs="+", metavar="SHARD_JSON")
    a = ap.parse_args(argv)
    tpath = a.timings or str(_repo_root() / TIMINGS_FILE)

    if a.record_timings:
        ms = record_timings(a.record_timings)
        if not ms:
            print("no per-file timings found in the given files", file=sys.stderr)
            return FAIL
        write_timings(tpath, ms, a.source)
        print("wrote %d file timings to %s" % (len(ms), tpath))
        return OK

    timings = load_timings(tpath)
    if not timings:
        print("::warning title=agent shard timings unreadable::%s could not be read; splitting by count" % tpath,
              file=sys.stderr)

    if a.compare:
        r = compare(a.compare, timings, a.of)
        for label in ("before", "after"):
            print("%-7s %s  max %.1f min" % (label, " ".join("%6.1f" % (x / 60000.0) for x in r[label]),
                                            max(r[label]) / 60000.0))
        return OK

    if not a.files_list:
        ap.error("--files-list is required")
    text = sys.stdin.read() if a.files_list == "-" else pathlib.Path(a.files_list).read_text(encoding="utf-8")
    try:
        files = read_files_list(text)
    except ValueError as e:
        print("::error::the Agent test file list is malformed: %s" % e, file=sys.stderr)
        return FAIL
    if not files:
        print("::error::the Agent test file list is empty; refusing to plan shards", file=sys.stderr)
        return FAIL
    if a.of < 1 or (a.shard is not None and not 1 <= a.shard <= a.of):
        print("::error::bad shard %s of %s" % (a.shard, a.of), file=sys.stderr)
        return FAIL
    plan = assign(files, timings, a.of)
    rep = partition_report(plan, files)
    if not rep["is_partition"]:   # cannot happen by construction; refuse rather than trust
        print("::error::shard plan is not a partition: %s" % rep, file=sys.stderr)
        return FAIL
    if a.shard is not None:
        if not plan[a.shard - 1]:
            print("::error::shard %d has no files (%d files over %d shards)" % (a.shard, len(files), a.of),
                  file=sys.stderr)
            return FAIL
        sys.stdout.write("\n".join(plan[a.shard - 1]) + "\n")
        return OK
    print("shard  files  recorded_min  untimed")
    for i, s in enumerate(shard_loads(plan, timings)):
        print("%5d  %5d  %12.1f  %7d" % (i + 1, s["files"], s["ms"] / 60000.0, s["untimed"]))
    print("files %d, timed %d, fallback %d ms per untimed file" % (
        len(files), sum(1 for f in files if f in timings), fallback_ms(timings)))
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
