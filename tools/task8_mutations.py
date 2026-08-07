"""Task 8 mutation harness — 'Add Alert' stops failing silently.

Rules this harness obeys, each because something went wrong earlier this phase:

  * READ/WRITE BYTES. A text-mode round-trip on this tree converts a whole file
    CRLF -> LF and the "mutation" becomes an 819-line diff.
  * ANCHOR ON SINGLE LINES. A multi-line `\n` anchor matches ZERO under CRLF —
    and a no-op that reports a kill is worse than no harness.
  * PROVE THE MUTATION APPLIED (bytes differ AND the new text is present) and
    ABORT if it did not.
  * RESTORE IN A `finally`, and verify the restored bytes are byte-identical.
  * ASCII-SANITISE EVERY PRINTED LINE. cp1252 killed a harness mid-run once and
    LEFT A MUTATION APPLIED on disk.
  * PARSE THE `Tests` LINE, never `Test Files` (a control once read passed=1
    when the truth was 35). `passed=None` is ambiguous -> disambiguated by the
    collected total.
  * VERDICT FROM THE EXIT CODE, plus the parsed counts.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
HOOK = ROOT / "app/src/hooks/useIndicatorAlerts.js"
POP = ROOT / "app/src/components/chart/IndicatorAlertPopover.jsx"
TEST = "src/components/chart/IndicatorAlertPopover.test.jsx"

ANSI = re.compile(r"\x1b\[[0-9;]*m")


def say(*parts):
    line = " ".join(str(p) for p in parts)
    sys.stdout.write(line.encode("ascii", "replace").decode("ascii") + "\n")
    sys.stdout.flush()


def run_vitest(extra=()):
    proc = subprocess.run(
        ["cmd", "/c", "npx", "vitest", "run", TEST, *extra],
        cwd=str(APP), capture_output=True,
    )
    out = ANSI.sub("", proc.stdout.decode("utf-8", "replace")
                   + proc.stderr.decode("utf-8", "replace"))
    return proc.returncode, out


# `Tests  10 failed | 32 passed (42)` / `Tests  42 passed (42)` / `Tests  no tests`
TESTS_LINE = re.compile(r"^\s*Tests\s+(.+)$", re.M)


def parse_counts(out):
    """-> (failed, passed, collected). None where the line does not state it."""
    m = TESTS_LINE.search(out)
    if not m:
        return (None, None, None)
    seg = m.group(1)
    failed = re.search(r"(\d+)\s+failed", seg)
    passed = re.search(r"(\d+)\s+passed", seg)
    total = re.search(r"\((\d+)\)", seg)
    return (int(failed.group(1)) if failed else None,
            int(passed.group(1)) if passed else None,
            int(total.group(1)) if total else None)


FAIL_LINE = re.compile(r"^\s*FAIL\s+\S+\s*>\s*(.+?)\s*$", re.M)


def failing_names(out):
    return sorted({n.strip() for n in FAIL_LINE.findall(out)})


# ─── the three mutations ────────────────────────────────────────────────────
# Each is a SINGLE LINE, verbatim from the shipped source (no newline in the
# anchor, so CRLF cannot make it match zero).

MUTATIONS = [
    dict(
        name="M1  the non-OK response is SWALLOWED again (return null)",
        path=HOOK,
        old="  return { ok: false, error: detail || `The server refused this alert (${r.status}).` }",
        new="  return null // MUTANT M1",
        why="the create path's 400s reach nobody, exactly as they did before this task",
    ),
    dict(
        name="M2  the network branch says the SAME sentence as a refusal",
        path=HOOK,
        old="    return { ok: false, error: 'Could not reach the server — check your connection and try again.' }",
        new="    return { ok: false, error: 'The server refused this alert (503).' }",
        why=("a transport failure and a refusal read alike, so the user is sent to the wrong fix. "
             "The literal carries the status the no-body case uses, because that is the only way "
             "to make the module's two SELF-WRITTEN sentences identical"),
    ),
    dict(
        name="M4  the popover receives the refusal and DROPS it",
        path=POP,
        old="      setSubmitError(res.ok ? null : res.error)",
        new="      setSubmitError(null) // MUTANT M4",
        why=("the hook can hand back a perfect message and the user still reads nothing - "
             "the OTHER half of defect 1, and the half M1 does not touch"),
    ),
    dict(
        name="M3  the timeframe list is hand-written again (the old five)",
        path=POP,
        old="const TFS = NATIVE_TFS.map((value) => ({ value, label: tfLabel(value) }))",
        new=("const TFS = [{ value: '5', label: '5m' }, { value: '15', label: '15m' }, "
             "{ value: '30', label: '30m' }, { value: '60', label: '1h' }, "
             "{ value: 'D', label: 'Daily' }]"),
        why="a weekly chart has no weekly alert again, and the two lists are free to drift",
    ),
]


def main():
    say("=" * 78)
    say("CONTROL A - unmutated")
    code, out = run_vitest()
    failed, passed, total = parse_counts(out)
    say(f"  exit={code} failed={failed} passed={passed} collected={total}")
    if not total:
        say("  ABORT: nothing was collected. A green claim from an empty run is worthless.")
        return 2
    if not passed:
        say("  ABORT: zero passed. Every 'kill' below would be meaningless.")
        return 2
    if code != 0 or failed:
        say("  ABORT: the unmutated tree is not green.")
        return 2
    baseline_pass, baseline_total = passed, total
    say(f"  OK - {passed}/{total} green before a byte was moved.")

    say("=" * 78)
    say("CONTROL B - filtered, must report a NONZERO passed count")
    code, out = run_vitest(["-t", "offers exactly NATIVE_TFS"])
    failed, passed, total = parse_counts(out)
    say(f"  exit={code} failed={failed} passed={passed} collected={total}")
    if not total or not passed:
        say("  ABORT: the filter selected nothing. A filter that matches no test "
            "reports success identically to one that passes.")
        return 2
    if passed >= baseline_pass:
        say("  ABORT: the filter did not actually narrow the run.")
        return 2
    say(f"  OK - the filter ran {passed} of {baseline_pass} and it passed.")

    results = []
    abort = None
    for mut in MUTATIONS:
        path, original = mut["path"], mut["path"].read_bytes()
        say("=" * 78)
        say(mut["name"])
        say("  file:", path.relative_to(ROOT).as_posix())
        say("  why :", mut["why"])
        old_b, new_b = mut["old"].encode("utf-8"), mut["new"].encode("utf-8")
        try:
            hits = original.count(old_b)
            if hits != 1:
                say(f"  ABORT: the anchor matched {hits} times, not 1. "
                    "A no-op reported as a kill is the defect this rule exists for.")
                abort = 2
                continue
            path.write_bytes(original.replace(old_b, new_b))
            after = path.read_bytes()
            if after == original or new_b not in after or old_b in after:
                say("  ABORT: the mutation did not apply.")
                abort = 2
                continue
            crlf = bytes([13, 10])
            say(f"  applied: {len(original)} -> {len(after)} bytes, "
                f"CRLF {original.count(crlf)} -> {after.count(crlf)}")
            code, out = run_vitest()
            failed, passed, total = parse_counts(out)
            names = failing_names(out)
            say(f"  exit={code} failed={failed} passed={passed} collected={total}")
            if not total:
                say("  ABORT: the mutated run collected nothing - that is a crash, not a kill.")
                abort = 2
                continue
            verdict = "KILLED" if (code != 0 and failed) else "SURVIVED"
            say(f"  {verdict} by {len(names)} case(s):")
            for n in names:
                say("     -", n)
            results.append(dict(name=mut["name"], verdict=verdict, names=set(names),
                                failed=failed, passed=passed, total=total))
        finally:
            path.write_bytes(original)
            restored = path.read_bytes()
            say("  restored byte-identical:", restored == original)
            if restored != original:
                say("  !!! THE TREE IS DIRTY - restore by hand before doing anything else.")
                abort = 2
    if abort:
        return abort

    say("=" * 78)
    say("SUMMARY")
    ok = True
    for r in results:
        say(f"  {r['verdict']:9} {r['name']}")
        if r["verdict"] != "KILLED":
            ok = False
    # Each mutation must have at least one killer NO OTHER mutation has: a single
    # blanket assertion failing on everything would prove only that the file runs.
    for r in results:
        others = set().union(*[o["names"] for o in results if o is not r])
        uniq = sorted(r["names"] - others)
        say(f"  unique killers of {r['name'].split()[0]}: {len(uniq)}")
        for n in uniq:
            say("     *", n)
        if not uniq:
            ok = False
            say("     ABORT: no unique killer - this mutation is caught only by "
                "assertions another mutation also trips.")
    say("=" * 78)

    code, out = run_vitest()
    failed, passed, total = parse_counts(out)
    say(f"POST-RUN CONTROL (tree restored): exit={code} failed={failed} passed={passed} collected={total}")
    if code != 0 or passed != baseline_pass or total != baseline_total:
        say("  ABORT: the tree did not come back to the control state.")
        return 2
    say("VERDICT:", "all mutations killed with disjoint unique killers" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
