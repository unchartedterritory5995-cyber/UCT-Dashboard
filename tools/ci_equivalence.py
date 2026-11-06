"""Did two runs of the same commit test the same things with the same outcome?

Compares a GitHub-hosted run with a self-hosted one. Each side is a directory of whatever that run left:

    *.json       vitest --reporter=json reports (shards are summed)
    *.xml        JUnit (pytest --junitxml, vitest junit)
    *.log *.txt  raw logs: pytest totals lines and vitest totals lines
    jobs.json    `gh api repos/<r>/actions/runs/<id>/jobs` for that run (a run's job data)

    python tools/ci_equivalence.py --a hosted/ --b selfhosted/ --sha-a <sha> --sha-b <sha>
    python tools/ci_equivalence.py --self-check

Exit 0 EQUIVALENT, 1 DIFFERENT, 2 INCOMPARABLE.

INCOMPARABLE is not a softer DIFFERENT and never a pass: it means the evidence cannot answer, because the
SHAs differ or are unknown, a side has no results, or the two sides have no result kind in common.
Timing is ignored on purpose. Runner names, labels and durations are expected to differ.
EQUIVALENT does not mean green: two runs failing the same tests are equivalent, and the report says so.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET

EQUIVALENT, DIFFERENT, INCOMPARABLE = "EQUIVALENT", "DIFFERENT", "INCOMPARABLE"
EXIT = {EQUIVALENT: 0, DIFFERENT: 1, INCOMPARABLE: 2}

_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
_PYTEST_TOTAL = re.compile(r"(?m)(?:^|\s)((?:\d+ (?:passed|failed|errors?|skipped|xfailed|xpassed|deselected|warnings?)(?:, )?)+) in \d+(?:\.\d+)?s")
_PYTEST_PART = re.compile(r"(\d+) (passed|failed|errors?|skipped|xfailed|xpassed|deselected)")
_VITEST_FILES = re.compile(r"Test Files\s+(.*?)\((\d+)\)")
_VITEST_TESTS = re.compile(r"(?m)^(?:\S+\s+)?\s*Tests\s+(.*?)\((\d+)\)\s*$")
_VITEST_PART = re.compile(r"(\d+) (passed|failed|skipped|todo)")


def _app_path(name: str) -> str:
    """The repo-relative test path, whatever checkout directory the runner used."""
    p = name.replace("\\", "/")
    m = re.search(r"(?:^|/)(app/src/.*|tests/.*)$", p)
    return m.group(1) if m else p


def _status(raw: str) -> str:
    return {"passed": "passed", "failed": "failed", "pending": "skipped", "skipped": "skipped",
            "todo": "todo", "disabled": "skipped"}.get(raw, raw)


def empty_side() -> dict:
    return {"kinds": set(), "files": set(), "tests": {}, "duplicates": 0, "problems": [],
            "vitest_json": {"total": 0, "passed": 0, "failed": 0, "skipped": 0, "todo": 0, "failed_files": 0},
            "junit": {"total": 0, "passed": 0, "failed": 0, "skipped": 0},
            "pytest_log": {}, "vitest_log": [], "jobs": {}, "shas": set()}


def _record(side: dict, key: str, status: str) -> None:
    if key in side["tests"]:
        side["duplicates"] += 1
        if status == "failed":       # a repeated name never hides a failure
            side["tests"][key] = status
    else:
        side["tests"][key] = status


def read_vitest_json(side: dict, doc: dict) -> None:
    v = side["vitest_json"]
    side["kinds"].add("vitest_json")
    v["total"] += doc.get("numTotalTests") or 0
    v["passed"] += doc.get("numPassedTests") or 0
    v["failed"] += doc.get("numFailedTests") or 0
    v["skipped"] += doc.get("numPendingTests") or 0
    v["todo"] += doc.get("numTodoTests") or 0
    v["failed_files"] += doc.get("numFailedTestSuites") or 0
    for result in doc.get("testResults") or []:
        path = _app_path(result.get("name") or "")
        side["files"].add(path)
        for a in result.get("assertionResults") or []:
            _record(side, f"{path}::{a.get('fullName') or a.get('title')}", _status(a.get("status") or ""))


def read_junit(side: dict, text: str) -> None:
    root = ET.fromstring(text)
    j = side["junit"]
    side["kinds"].add("junit")
    for case in root.iter("testcase"):
        key = f"{case.get('classname') or ''}::{case.get('name') or ''}"
        if case.find("failure") is not None or case.find("error") is not None:
            status = "failed"
        elif case.find("skipped") is not None:
            status = "skipped"
        else:
            status = "passed"
        j["total"] += 1
        j[status] += 1
        _record(side, key, status)


def read_log(side: dict, text: str, label: str) -> None:
    """Every totals line counts, because one job log holds several pytest runs, in the same order each side."""
    clean = _ANSI.sub("", text)
    for m in _PYTEST_TOTAL.finditer(clean):
        side["kinds"].add("pytest_log")
        for n, word in _PYTEST_PART.findall(m.group(1)):
            word = "errors" if word.startswith("error") else word
            side["pytest_log"][word] = side["pytest_log"].get(word, 0) + int(n)
    files = _VITEST_FILES.search(clean)
    tests = _VITEST_TESTS.search(clean)
    if tests:
        side["kinds"].add("vitest_log")
        parts = {w: int(n) for n, w in _VITEST_PART.findall(tests.group(1))}
        side["vitest_log"].append({"label": label, "total": int(tests.group(2)), **parts,
                                   "files": int(files.group(2)) if files else None})


def read_jobs(side: dict, doc: dict) -> None:
    jobs = doc.get("jobs")
    if not isinstance(jobs, list):
        side["problems"].append("a jobs file has no `jobs` list")
        return
    side["kinds"].add("jobs")
    for j in jobs:
        if j.get("head_sha"):
            side["shas"].add(j["head_sha"])
        steps = [(s.get("name"), s.get("conclusion")) for s in j.get("steps") or []
                 if not re.match(r"^(Set up job|Complete job|Post )", s.get("name") or "")]
        # a job in a called workflow is "<caller job> / <job>"; the shadow and the deciding run share the last part
        side["jobs"][(j.get("name") or "").split(" / ")[-1]] = {"conclusion": j.get("conclusion"), "status": j.get("status"), "steps": steps}


def read_dir(root: pathlib.Path) -> dict:
    side = empty_side()
    if not root.is_dir():
        side["problems"].append(f"{root} is not a directory")
        return side
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        try:
            if path.suffix == ".json":
                doc = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(doc, dict) and "testResults" in doc:
                    read_vitest_json(side, doc)
                elif isinstance(doc, dict) and "jobs" in doc:
                    read_jobs(side, doc)
            elif path.suffix == ".xml":
                read_junit(side, path.read_text(encoding="utf-8"))
            elif path.suffix in (".log", ".txt"):
                read_log(side, path.read_text(encoding="utf-8", errors="replace"), path.name)
        except (ValueError, ET.ParseError) as err:
            # a truncated report from a killed job must not read as a smaller, matching one
            side["problems"].append(f"{path.name}: unreadable ({type(err).__name__})")
    return side


def _vitest_log_multiset(side: dict) -> list:
    return sorted((r["total"], r.get("passed", 0), r.get("failed", 0), r.get("skipped", 0), r.get("todo", 0),
                   r["files"] or 0) for r in side["vitest_log"])


def compare(a: dict, b: dict, *, sha_a: str | None = None, sha_b: str | None = None,
            kinds: list | None = None) -> dict:
    """`{verdict, reasons, notes, compared}`. Only result kinds BOTH sides hold are compared; a kind on one
    side only is reported, and `kinds` makes it required."""
    reasons, notes = [], []
    verdict_incomparable = []

    known_a = (a["shas"] | ({sha_a} if sha_a else set()))
    known_b = (b["shas"] | ({sha_b} if sha_b else set()))
    if len(known_a) != 1 or len(known_b) != 1:
        verdict_incomparable.append(f"the commit is not established: side A {sorted(known_a)}, side B {sorted(known_b)}")
    elif known_a != known_b:
        verdict_incomparable.append(f"different commits: {sorted(known_a)} vs {sorted(known_b)}")
    for label, side in (("A", a), ("B", b)):
        for problem in side["problems"]:
            verdict_incomparable.append(f"side {label}: {problem}")
        if not side["kinds"]:
            verdict_incomparable.append(f"side {label} holds no results")

    common = a["kinds"] & b["kinds"]
    if not common and a["kinds"] and b["kinds"]:
        verdict_incomparable.append(f"no result kind in common: {sorted(a['kinds'])} vs {sorted(b['kinds'])}")
    for kind in sorted((a["kinds"] | b["kinds"]) - common):
        notes.append(f"only one side has {kind}; not compared")
    for kind in kinds or []:
        if kind not in common:
            verdict_incomparable.append(f"required result kind {kind} is not on both sides")

    if "vitest_json" in common:
        for field in ("total", "passed", "failed", "skipped", "todo", "failed_files"):
            x, y = a["vitest_json"][field], b["vitest_json"][field]
            if x != y:
                reasons.append(f"vitest {field}: {x} vs {y}")
        only_a, only_b = sorted(a["files"] - b["files"]), sorted(b["files"] - a["files"])
        if only_a:
            reasons.append(f"{len(only_a)} test file(s) only in A, e.g. {only_a[:5]}")
        if only_b:
            reasons.append(f"{len(only_b)} test file(s) only in B, e.g. {only_b[:5]}")
    if "junit" in common:
        for field in ("total", "passed", "failed", "skipped"):
            x, y = a["junit"][field], b["junit"][field]
            if x != y:
                reasons.append(f"junit {field}: {x} vs {y}")
    if common & {"vitest_json", "junit"}:
        shared = a["tests"].keys() & b["tests"].keys()
        changed = sorted(k for k in shared if a["tests"][k] != b["tests"][k])
        if changed:
            reasons.append(f"{len(changed)} test(s) changed outcome, e.g. "
                           + "; ".join(f"{k}: {a['tests'][k]} vs {b['tests'][k]}" for k in changed[:5]))
        for label, mine, theirs in (("A", a, b), ("B", b, a)):
            extra = sorted(mine["tests"].keys() - theirs["tests"].keys())
            if extra:
                reasons.append(f"{len(extra)} test(s) only in {label}, e.g. {extra[:5]}")
    if "pytest_log" in common and a["pytest_log"] != b["pytest_log"]:
        reasons.append(f"pytest totals: {a['pytest_log']} vs {b['pytest_log']}")
    if "vitest_log" in common and _vitest_log_multiset(a) != _vitest_log_multiset(b):
        reasons.append(f"vitest log totals (total, passed, failed, skipped, todo, files): "
                       f"{_vitest_log_multiset(a)} vs {_vitest_log_multiset(b)}")
    if "jobs" in common:
        for name in sorted(a["jobs"].keys() | b["jobs"].keys()):
            ja, jb = a["jobs"].get(name), b["jobs"].get(name)
            if ja is None or jb is None:
                reasons.append(f"job only on one side: {name}")
            elif ja["conclusion"] != jb["conclusion"]:
                reasons.append(f"job {name}: {ja['conclusion']} vs {jb['conclusion']}")
            elif ja["steps"] != jb["steps"]:
                reasons.append(f"job {name}: step list or step conclusions differ")

    for label, side in (("A", a), ("B", b)):
        failed = sum(1 for s in side["tests"].values() if s == "failed") + side["pytest_log"].get("failed", 0) \
            + side["pytest_log"].get("errors", 0)
        if failed:
            notes.append(f"side {label} has {failed} failing test(s): equivalent does not mean green")
        if side["duplicates"]:
            notes.append(f"side {label} repeats {side['duplicates']} test name(s) within a file")

    if verdict_incomparable:
        verdict = INCOMPARABLE
        reasons = verdict_incomparable + reasons
    else:
        verdict = DIFFERENT if reasons else EQUIVALENT
    return {"verdict": verdict, "reasons": reasons, "notes": notes, "compared": sorted(common)}


def describe(side: dict) -> str:
    bits = []
    if "vitest_json" in side["kinds"]:
        bits.append(f"vitest {side['vitest_json']} in {len(side['files'])} files")
    if "junit" in side["kinds"]:
        bits.append(f"junit {side['junit']}")
    if "pytest_log" in side["kinds"]:
        bits.append(f"pytest {side['pytest_log']}")
    if "vitest_log" in side["kinds"]:
        bits.append(f"vitest logs {_vitest_log_multiset(side)}")
    if "jobs" in side["kinds"]:
        bits.append(f"{len(side['jobs'])} jobs")
    return "; ".join(bits) or "nothing"


def _self_check() -> int:
    def run(failed=0, name="a.test.js"):
        return {"numTotalTests": 2, "numPassedTests": 2 - failed, "numFailedTests": failed, "numPendingTests": 0,
                "numTodoTests": 0, "numFailedTestSuites": 1 if failed else 0,
                "testResults": [{"name": f"/x/app/src/{name}", "assertionResults": [
                    {"fullName": "one", "status": "failed" if failed else "passed"},
                    {"fullName": "two", "status": "passed"}]}]}

    def side(doc):
        s = empty_side()
        if doc:
            read_vitest_json(s, doc)
        return s

    cases = [("identical", run(), run(), "s", "s", EQUIVALENT),
             ("one test fails", run(), run(1), "s", "s", DIFFERENT),
             ("a file vanished", run(), run(name="b.test.js"), "s", "s", DIFFERENT),
             ("different commits", run(), run(), "s", "t", INCOMPARABLE),
             ("no results", run(), None, "s", "s", INCOMPARABLE)]
    bad = 0
    for label, x, y, sx, sy, want in cases:
        got = compare(side(x), side(y), sha_a=sx, sha_b=sy)["verdict"]
        print("  %s %-20s -> %s" % ("ok  " if got == want else "FAIL", label, got))
        bad += got != want
    print("self-check: %d case(s), %d failure(s)" % (len(cases), bad))
    return 1 if bad else 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--a", help="directory: reference run (hosted)")
    p.add_argument("--b", help="directory: candidate run (self-hosted)")
    p.add_argument("--sha-a")
    p.add_argument("--sha-b")
    p.add_argument("--require", action="append", default=[], help="a result kind that must be on both sides")
    p.add_argument("--json", action="store_true")
    p.add_argument("--self-check", action="store_true")
    a = p.parse_args(argv)
    if a.self_check:
        return _self_check()
    if not a.a or not a.b:
        p.error("--a and --b are required")
    left, right = read_dir(pathlib.Path(a.a)), read_dir(pathlib.Path(a.b))
    out = compare(left, right, sha_a=a.sha_a, sha_b=a.sha_b, kinds=a.require)
    if a.json:
        print(json.dumps(out, indent=2))
    else:
        print("A: " + describe(left))
        print("B: " + describe(right))
        print("compared: " + (", ".join(out["compared"]) or "nothing"))
        for r in out["reasons"]:
            print("  DIFF  " + r)
        for n in out["notes"]:
            print("  note  " + n)
        print(out["verdict"])
    return EXIT[out["verdict"]]


if __name__ == "__main__":
    sys.exit(main())
