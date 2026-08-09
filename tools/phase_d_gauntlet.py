#!/usr/bin/env python3
"""Phase D's mutation gauntlet -- the instrument's own gate that it can SEE a change.

Generalized from `tools/phase_c_gauntlet.py`. A mutation harness that never
starts scores a perfect KILLED, so this one refuses to report anything without:

  **CONTROL A** -- the UNMUTATED suite, run first, ANSI-stripped, and ABORTED on a
  zero passed-count. A runner that cannot run makes every subsequent `rc=1` a
  claim about nothing.
  **CONTROL B** -- the same `-k` / `-t` filter each mutation is judged under, run
  UNMUTATED, asserting a NONZERO passed count.

Verdicts come from the EXIT CODE, never from grepping output for the word FAIL.

    python tools/phase_d_gauntlet.py            # all
    python tools/phase_d_gauntlet.py --only M3

CARRIED FORWARD FROM PHASE C (do not re-derive these)
-----------------------------------------------------
NONZERO IS NECESSARY BUT NOT SUFFICIENT. B5 Task 10's M15 filter selected a
pure-helper case its binder mutation could not REACH, and CONTROL B reported
passed=1 throughout. Every mutation therefore declares `must_reach` -- the test
whose failure is the kill -- and a kill whose failing test is not that one is
reported SUSPECT, not KILLED.

ARGV AS A LIST, shell=False. A `-t` containing a double quote SPLIT under
cmd.exe and selected TEN tests; a single-quoted `-t` selected NOTHING and
reported passed=None. Both happened, on this branch, in the same phase.

`PYTHONDONTWRITEBYTECODE=1` IS NOT OPTIONAL. A same-size mutation applied within
one second of the previous run imports the previous `.pyc` and the mutation
silently never executes. Measured on this branch.

`core.autocrlf` IS TRUE IN THIS CHECKOUT, so `git checkout -- <file>` does NOT
restore bytes and an anchor written with `\\n` matches ZERO times in a CRLF file.
Every mutator is handed LF; the restore is byte-for-byte from an in-memory backup
with sha256 asserted in BOTH directions.

`passed=None` IS AMBIGUOUS between "the filter selected nothing" (abort) and
"everything selected failed" (a GOOD kill). Disambiguate with `collected > 0`.

ADDED AFTER PHASE C WROTE ITS GAUNTLET -- four this branch learned the hard way
-----------------------------------------------------------------------------
A HARNESS CAN CORRUPT THE ARTIFACT IT MEASURES. Phase C's M2 reported 3/3
KILLED, exit 0, AND LEFT A CORRUPTED FIRE LOG: with `--record --append`'s refusal
deleted the test really re-recorded and really WROTE, and the harness restored
the file it PATCHED and never looked at the file the mutation WROTE. Every
artifact a mutation can reach is snapshotted in `GUARDED` and verified by sha256
in the same `finally`.

cp1252 KILLS A HARNESS'S OWN STDOUT AND LEAVES THE MUTATION APPLIED. Two belts:
stdout is reconfigured to UTF-8 before anything prints, AND every printed line is
ASCII-sanitised, because the failure mode is not a cosmetic traceback -- it is a
mutated working tree nobody restored.

pytest EXIT 4 IS A USAGE ERROR that prints "no tests ran", WHICH READS EXACTLY
LIKE A PASS. It is detected by code and aborts; it is never a verdict.

vitest PRINTS `Test Files N passed` BEFORE `Tests M passed`. A control reading
the first under-reads its own baseline and can bless anything -- measured: read 1
where the truth was 35. `run_vitest` parses the `Tests` line and refuses if it
cannot find one.
"""
from __future__ import annotations

import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

import argparse  # noqa: E402
import glob  # noqa: E402
import hashlib  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import subprocess  # noqa: E402
from pathlib import Path  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

TOOL = "tools/ast_conformance.py"
ESCAPES = "tests/fixtures/ast/escapes.json"
TEST = "tests/test_ast_conformance.py"

#: EVERY ARTIFACT A MUTATION CAN REACH. Snapshotted before, restored and verified
#: after -- not just the file that was patched. See the module docstring.
GUARDED = sorted(
    [os.path.relpath(p, ROOT).replace(os.sep, "/")
     for p in glob.glob(str(ROOT / "tests" / "fixtures" / "ast" / "*.json"))]
    + [TOOL, TEST])

ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def strip(s: str) -> str:
    return ANSI.sub("", s)


def say(*parts) -> None:
    """ASCII-sanitised print.

    cp1252 killed a sibling harness's stdout mid-run and LEFT A MUTATION APPLIED.
    A print that cannot fail is not a nicety here; it is what keeps the `finally`
    reachable.
    """
    line = " ".join(str(p) for p in parts)
    sys.stdout.write(line.encode("ascii", "backslashreplace").decode("ascii") + "\n")
    sys.stdout.flush()


def _env() -> dict:
    e = dict(os.environ)
    e["PYTHONDONTWRITEBYTECODE"] = "1"
    e["PYTHONIOENCODING"] = "utf-8"
    return e


#: pytest's own summary line, and NOTHING ELSE. Anchored on the trailing
#: `in <n>s` because that is the only thing unique to it.
#:
#: MEASURED DEFECT, FOUND BY RUNNING THIS GAUNTLET, FIXED BEFORE ANY VERDICT
#: STOOD: a bare `re.search(r"(\d+) passed", out)` reads the FIRST match in the
#: whole capture, and pytest echoes a failing test's DOCSTRING into that capture.
#: `test_the_coverage_floor_...`'s docstring contains the words "left the file
#: `5 passed rc=0`", so M4's real result -- `1 failed, 1 passed, 41 deselected`
#: -- was reported as `passed=5 failed=0`. It is the same class as the vitest
#: `Test Files` trap: a control that reads a number from the wrong place can
#: bless anything, and here the wrong place was PROSE INSIDE THE SUBJECT.
_SUMMARY_LINE = re.compile(r"^.*\bin \d+(?:\.\d+)?s.*$", re.M)
_COUNT = re.compile(r"(\d+) (passed|failed|error|errors|skipped|deselected|"
                    r"xfailed|xpassed|warnings?)")


def _parse_pytest_summary(out: str) -> dict:
    """Counts from pytest's SUMMARY LINE only. Refuses if there is not one.

    Returns `{"summary": None}` when no summary line exists, which the caller
    treats as an abort -- never as a zero.
    """
    lines = [ln for ln in _SUMMARY_LINE.findall(out) if ln.strip()]
    if not lines:
        return {"summary": None, "passed": None, "failed": 0, "selected": 0}
    line = lines[-1]
    counts = {kind: int(n) for n, kind in _COUNT.findall(line)}
    if re.search(r"no tests ran", line, re.I):
        return {"summary": line, "passed": 0, "failed": 0, "selected": 0}
    passed = counts.get("passed")
    failed = counts.get("failed", 0) + counts.get("error", 0) + counts.get("errors", 0)
    # SELECTED, not collected: `deselected` is deliberately excluded, because a
    # filter that selected nothing and deselected everything is exactly the
    # "abort" half of the `passed=None` ambiguity.
    selected = sum(v for k, v in counts.items()
                   if k in ("passed", "failed", "error", "errors", "skipped",
                            "xfailed", "xpassed"))
    if passed is None and selected:
        passed = 0
    return {"summary": line, "passed": passed, "failed": failed,
            "selected": selected}


def run_pytest(path: str, kfilter: str | None = None) -> dict:
    # ARGV AS A LIST, shell=False. See the module docstring.
    cmd = [sys.executable, "-m", "pytest", path, "-q", "-p", "no:warnings"]
    if kfilter:
        cmd += ["-k", kfilter]
    # `encoding=` IS NOT OPTIONAL ON THIS BOX. Without it Python decodes the
    # child's output as cp1252 and one box-drawing character raises
    # UnicodeDecodeError inside the reader thread, stdout comes back None and the
    # verdict is a TypeError rather than a result.
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=_env())
    out = strip(p.stdout + p.stderr)

    # pytest EXIT 4 IS A USAGE ERROR. It prints "no tests ran" and reads exactly
    # like a pass. The controller hit this for real today.
    parsed = _parse_pytest_summary(out)
    usage_error = p.returncode == 4 or parsed["summary"] is None

    names = re.findall(r"FAILED\s+\S+::(\S+)", out)
    names += re.findall(r"ERROR\s+\S+::(\S+)", out)
    return {"rc": p.returncode, "passed": parsed["passed"],
            "failed": parsed["failed"], "collected": parsed["selected"],
            "usage_error": usage_error, "summary": parsed["summary"],
            "failing": names, "out": out}


def run_vitest(paths: list[str], tfilter: str | None = None) -> dict:
    """The JS half. Unused by Task 2's mutations; present because Tasks 4, 8 and
    11 need it and a gauntlet nobody can extend gets rewritten instead.

    PARSES THE `Tests` LINE, NOT `Test Files`. vitest prints
    `Test Files 1 passed` BEFORE `Tests 35 passed`, and a control reading the
    first under-reads its own baseline and can bless anything.
    """
    cmd = ["npx", "vitest", "run", *paths]
    if tfilter:
        cmd += ["-t", tfilter]   # ARGV AS A LIST -- never a quoted shell string
    p = subprocess.run(cmd, cwd=ROOT / "app", capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=_env(), shell=False)
    out = strip(p.stdout + p.stderr)
    m = re.search(r"^\s*Tests\s+(?:(\d+) failed \| )?(\d+) passed", out, re.M)
    if not m:
        return {"rc": p.returncode, "passed": None, "failed": 0, "collected": 0,
                "usage_error": True, "failing": [], "out": out}
    failed = int(m.group(1)) if m.group(1) else 0
    passed = int(m.group(2))
    names = re.findall(r"(?m)^\s*(?:x|FAIL)\s+\S+\s*>\s*(.+)$", out)
    return {"rc": p.returncode, "passed": passed, "failed": failed,
            "collected": passed + failed, "usage_error": False,
            "failing": names, "out": out}


# --------------------------------------------------------------------------- #
# mutations
# --------------------------------------------------------------------------- #
# Each: a file, a callable returning the mutated TEXT (raising if the anchor it
# needs is gone -- a mutation that did not apply is the loudest possible false
# KILL), its `-k` filter, and the test whose failure IS the kill.

def _once(text: str, anchor: str, name: str) -> str:
    """The PREFLIGHT: the anchor must match EXACTLY ONCE.

    Zero matches is a mutation nobody ran (and on this checkout the usual cause is
    `core.autocrlf` -- an anchor written with `\\n` matches zero times in a CRLF
    file, which happened in six Phase C tasks). TWO matches is worse: the mutator
    silently edits a second site nobody reasoned about, and the kill is then a
    claim about the wrong code.
    """
    n = text.count(anchor)
    if n != 1:
        crlf = "\r\n" in text
        raise SystemExit(
            f"{name}: anchor matched {n} times, expected exactly 1 "
            f"(file is {'CRLF' if crlf else 'LF'}) -- "
            f"{anchor.splitlines()[0][:70]!r}")
    return anchor


def _parser_refused_counts_as_refused(text: str) -> str:
    """M1: a case the PARSER rejected is booked as refused BY A TABLE.

    Deliberately arithmetic-consistent: `parsed` and `refused` both move and
    `parser_refused` stays empty, so every internal invariant still holds and the
    census reports a table refusing something it never saw. A parser change could
    then empty this census with every number unmoved.
    """
    anchor = _once(
        text,
        "            parser_refused.append(cid)\n"
        "            continue\n",
        "M1")
    return text.replace(anchor,
                        "            refused += 1\n"
                        "            parsed += 1\n"
                        "            continue\n", 1)


def _delete_the_unguarded_control(text: str) -> str:
    """M2: `escape_verdict` stops consulting its positive control.

    A zero with no control is the vacuity this file exists to refuse, and it is
    the shape that has been vacuous twenty distinct ways on this branch.
    """
    anchor = _once(text, "    if len(control[\"escaped\"]) == 0:\n", "M2")
    return text.replace(anchor, "    if False:\n", 1)


def _two_guards_share_a_fragment(text: str) -> str:
    """M3: `resolve:function` starts speaking `resolve:name`'s refusal.

    C Task 9 measured `pytest.raises(match="forming-bar fires are not
    ledger-grade")` STILL MATCHING with the mode lock deleted, because two
    different gates shared the phrase. The test would have passed on a tree with
    the safety removed.
    """
    anchor = _once(text, '"refuse": "unknown function",', "M3")
    return text.replace(anchor, '"refuse": "unknown name",', 1)


def _hand_list_the_coverage_floor(text: str) -> str:
    """M4: the floor becomes a LIST of what somebody remembered.

    DPC's four constants rode outside `test_all_constants_match_owner_spec` for
    the rule's entire life for exactly this reason: `DPC_LOOKBACK 10 -> 999` left
    the file `5 passed rc=0`.
    """
    anchor = _once(
        text,
        '    declared = (set(manifest["functions"])\n'
        '                | set(manifest["operators"])\n'
        '                | set(manifest["series"]))\n',
        "M4")
    return text.replace(
        anchor,
        '    declared = {"sma", "ema", "highest", "lowest", "close", "high",\n'
        '                "low", "open", "volume", "-", "/", ">", "?:"}\n', 1)


def _digest_drops_the_value(text: str) -> str:
    """M5: `ast_digest` hashes (ast_id, bar_index) only.

    C Task 2 replaced a 42 MB raw log with digests for size and wrote the
    load-bearing note: a digest that hashed only (bar_index, triggered) would
    report a CHANGED NUMBER as no change at all.
    """
    anchor = _once(
        text,
        '        h.update(_FIELD_SEP.join(repr(x) for x in row).encode("utf-8"))\n',
        "M5")
    return text.replace(anchor,
                        '        h.update(repr(row[0]).encode("utf-8"))\n', 1)


def _census_silently_returns_zero(text: str) -> str:
    """M6: the census reports zero escapes while every other number is honest.

    The SILENT version on purpose -- the internal arithmetic assertions read the
    local counters, so they still hold and nothing raises. A census that can
    report zero without anything refusing is the number Task 6 would inherit as
    already-green.
    """
    anchor = _once(text, '        "escaped": escaped,\n', "M6")
    return text.replace(anchor, '        "escaped": [],\n', 1)


def _cross_lane_comparison_always_agrees(text: str) -> str:
    """M7: `compare_lanes` passes when the two lanes disagree.

    The whole conformance log is an equality between two lanes. A comparison that
    cannot report a difference turns a user's alert firing on the server and not
    on their chart into a permanently green build.
    """
    anchor = _once(text, "            if not _agree(x, y, rel_tol):\n", "M7")
    return text.replace(anchor, "            if False:\n", 1)


MUTATIONS = {
    "M1": dict(file=TOOL, mutate=_parser_refused_counts_as_refused, target=TEST,
               filter="parser_refused",
               must_reach="test_a_parser_refused_case_is_never_counted_as_refused",
               why="a PARSER_REFUSED case booked as refused by a table"),
    "M2": dict(file=TOOL, mutate=_delete_the_unguarded_control, target=TEST,
               filter="verdict",
               must_reach="test_the_verdict_refuses_a_zero_whose_control_read_zero",
               why="the --unguarded positive control deleted from the verdict"),
    "M3": dict(file=ESCAPES, mutate=_two_guards_share_a_fragment, target=TEST,
               filter="fragments_are_disjoint",
               must_reach="test_refusal_fragments_are_disjoint_across_guards",
               why="two DIFFERENT guards made to share one refusal fragment"),
    "M4": dict(file=TOOL, mutate=_hand_list_the_coverage_floor, target=TEST,
               filter="derived_from_the_manifest or hand_listed",
               must_reach="test_the_coverage_floor_is_derived_from_the_manifest_and_never_a_literal",
               why="the coverage floor hand-listed instead of derived"),
    "M5": dict(file=TOOL, mutate=_digest_drops_the_value, target=TEST,
               filter="digest",
               must_reach="test_ast_digest_puts_the_value_inside_the_hashed_text",
               why="ast_digest hashes (ast_id, bar_index) only"),
    "M6": dict(file=TOOL, mutate=_census_silently_returns_zero, target=TEST,
               filter="census or unguarded_walker or wide_open",
               must_reach="test_the_escape_census_reads_non_zero_through_the_unguarded_walker",
               why="the escape census silently returns 0 escapes"),
    "M7": dict(file=TOOL, mutate=_cross_lane_comparison_always_agrees, target=TEST,
               filter="compare_lanes",
               must_reach="test_compare_lanes_reports_a_disagreement_at_ten_times_the_tolerance",
               why="the cross-lane comparison passes when the two lanes disagree"),
}

#: THE GAUNTLET'S OWN ABORT MESSAGES, DISJOINT BY CONSTRUCTION.
#: Phase C measured `raises(match=...)` matching with the safety deleted because
#: two gates shared a phrase. The same hazard applies to a harness's own
#: refusals: two aborts sharing a phrase make a log unreadable about WHICH
#: protection fired. `assert_refusals_are_disjoint()` is asserted at startup and
#: by `tests/test_ast_conformance.py`.
ABORTS = {
    "control_a": "CONTROL A is not green with a nonzero passed count",
    "control_b": "CONTROL B selects nothing the mutation could be judged by",
    "usage_error": "pytest exited 4, a USAGE error whose output reads like a pass",
    "no_summary": "no runner summary line was found; a count taken from anywhere "
                  "else can be prose inside the subject",
    "identical_bytes": "the mutation produced identical bytes",
    "restore_failed": "the patched file was not restored byte-for-byte",
    "artifact_moved": "a GUARDED artifact was rewritten by the mutation and restored",
    "duplicate_killer": "two mutations declare the same must_reach test",
}


def assert_refusals_are_disjoint() -> None:
    keys = sorted(ABORTS)
    for a in keys:
        for b in keys:
            if a != b:
                assert ABORTS[a] not in ABORTS[b], (
                    f"the abort message for {a!r} is a substring of {b!r}; a log "
                    "reader cannot tell which protection fired")
    killers = [m["must_reach"] for m in MUTATIONS.values()]
    assert len(killers) == len(set(killers)), (
        f"{ABORTS['duplicate_killer']}: {sorted(killers)}. Two mutations sharing "
        "a killer means one of them is not testing what it claims, and the fix is "
        "a new test -- never accepting the overlap.")


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _snapshot() -> dict:
    return {rel: (ROOT / rel).read_bytes() for rel in GUARDED
            if (ROOT / rel).exists()}


def _restore(snap: dict) -> list:
    """Restore EVERY guarded artifact and report any that had moved.

    Not just the file that was patched. Phase C's M2 reported 3/3 KILLED, exit 0,
    and left a corrupted fire log because the harness only ever looked at the file
    it patched.
    """
    moved = []
    for rel, original in snap.items():
        path = ROOT / rel
        if not path.exists() or path.read_bytes() != original:
            moved.append(rel)
            path.write_bytes(original)
        assert _sha(path.read_bytes()) == _sha(original), (
            f"{ABORTS['restore_failed']}: {rel}")
    return moved


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()

    assert_refusals_are_disjoint()
    names = args.only or list(MUTATIONS)

    say("=== GUARDED artifacts ===")
    for rel in GUARDED:
        exists = (ROOT / rel).exists()
        say(f"  {rel}  {'present' if exists else 'ABSENT'}")

    say("\n=== CONTROL A - the unmutated suite ===")
    res = run_pytest(TEST)
    say(f"  pytest {TEST}: rc={res['rc']} passed={res['passed']} "
        f"failed={res['failed']} selected={res['collected']}")
    say(f"  summary line read: {res['summary']!r}")
    if res["summary"] is None:
        raise SystemExit(ABORTS["no_summary"])
    if res["usage_error"]:
        say(res["out"][-3000:])
        raise SystemExit(ABORTS["usage_error"])
    if res["rc"] != 0 or not res["passed"]:
        say(res["out"][-4000:])
        raise SystemExit(ABORTS["control_a"] + " - every verdict below would be "
                         "a claim about nothing.")

    results = []
    for name in names:
        m = MUTATIONS[name]
        say(f"\n=== {name} ({m['why']}) ===")
        ctl = run_pytest(m["target"], m["filter"])
        say(f"  CONTROL B (unmutated, -k {m['filter']!r}): rc={ctl['rc']} "
            f"passed={ctl['passed']} selected={ctl['collected']} "
            f"summary={ctl['summary']!r}")
        if ctl["summary"] is None:
            raise SystemExit(f"{name}: " + ABORTS["no_summary"])
        if ctl["usage_error"]:
            raise SystemExit(f"{name}: " + ABORTS["usage_error"])
        # `passed is None` is ambiguous; `collected` is what tells the two apart.
        if ctl["rc"] != 0 or not ctl["collected"] or not ctl["passed"]:
            raise SystemExit(f"{name}: " + ABORTS["control_b"])

        path = ROOT / m["file"]
        snap = _snapshot()
        original = path.read_bytes()
        before = _sha(original)
        try:
            mutated = m["mutate"](original.decode("utf-8").replace("\r\n", "\n"))
            path.write_text(mutated, encoding="utf-8", newline="\n")
            after = path.read_bytes()
            # PREFLIGHT: the mutation must have CHANGED THE FILE before anything runs.
            if after == original:
                raise SystemExit(f"{name}: " + ABORTS["identical_bytes"])
            say(f"  applied: {len(original)} -> {len(after)} bytes "
                f"({_sha(after)[:12]})")
            got = run_pytest(m["target"], m["filter"])
        finally:
            moved = _restore(snap)
        assert _sha(path.read_bytes()) == before, (
            f"{name}: " + ABORTS["restore_failed"])
        # The patched file always shows as moved -- that is the mutation. What
        # matters is any OTHER artifact, which means the mutated code WROTE
        # something. Phase C's M2 did exactly that and reported 3/3 KILLED.
        collateral = [r for r in moved if r != m["file"]]
        say(f"  restored {len(moved)} guarded artifact(s)"
            + (f"; {ABORTS['artifact_moved']}: {collateral}" if collateral else ""))

        reached = any(m["must_reach"] in f for f in got["failing"])
        verdict = ("KILLED" if got["rc"] != 0 and reached else
                   "SUSPECT" if got["rc"] != 0 else "SURVIVED")
        say(f"  mutated: rc={got['rc']} passed={got['passed']} "
            f"failed={got['failed']} summary={got['summary']!r}")
        # DISTINCT names, not the first N -- a parametrized test contributes a row
        # per case and would otherwise crowd out the kill that actually matters.
        seen_names: list = []
        for f in got["failing"]:
            base = f.split("[")[0]
            if base not in seen_names:
                seen_names.append(base)
        say(f"  failing: {seen_names or '(none)'}")
        say(f"  -> {verdict}" + ("" if reached or got["rc"] == 0
                                 else f"  (expected to reach: {m['must_reach']})"))
        results.append((name, verdict, seen_names, m["must_reach"]))

    say("\n=== SUMMARY ===")
    for name, verdict, failing, killer in results:
        say(f"  {name:4} {verdict:9} killer={killer}")
        say(f"       failing={failing[:3]}")
    bad = [n for n, v, _, _ in results if v != "KILLED"]
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
