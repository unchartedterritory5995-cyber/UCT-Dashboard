#!/usr/bin/env python3
"""Phase D Task 3's mutation gauntlet -- can the parser's own suite SEE a change?

Same shape as `tools/phase_d_gauntlet.py` (Task 2), driving **vitest** instead of
pytest because the subject is `app/src/components/chart/engine/ast/parse.js`.

  **CONTROL A** -- the UNMUTATED file, run first, ANSI-stripped, ABORTED on a zero
  passed-count. A runner that cannot run makes every subsequent `rc=1` a claim
  about nothing.
  **CONTROL B** -- the same `-t` filter each mutation is judged under, run
  UNMUTATED, asserting a NONZERO passed count AND a nonzero SELECTED count.

Verdicts come from the EXIT CODE, never from grepping output for the word FAIL.

    python tools/phase_d_task3_gauntlet.py
    python tools/phase_d_task3_gauntlet.py --only M3

WHY THIS FILE PARSES THE SUMMARY THE WAY IT DOES
------------------------------------------------
vitest prints `Test Files  1 passed` BEFORE `Tests  27 passed`. A control reading
the first under-reads its own baseline and can bless anything -- measured on this
branch: read 1 where the truth was 35. The `Tests` line is anchored on
`^\\s*Tests\\s`, which cannot match `Test Files` (there is no `s` before the
space), and a capture with NO such line REFUSES rather than reporting zero.

⚠️ AND A HOLE TASK 2's `run_vitest` STILL HAD, FIXED HERE. Its regex required the
literal `N passed`, so a run where EVERY selected test failed
(`Tests  2 failed | 25 skipped`) parsed as "no summary" -- i.e. a real, total
kill would have been reported as a usage error. Counts are taken from every
`(\\d+) (passed|failed|skipped|todo)` pair ON THE `Tests` LINE, so all three
shapes read correctly.

⚠️ A `-t` FILTER THAT MATCHES NOTHING EXITS 0 with "N skipped" -- a green exit
over zero work. `selected` deliberately EXCLUDES `skipped` so CONTROL B aborts on
it instead of blessing it.

UNIQUENESS IS MEASURED, NOT ASSUMED
-----------------------------------
The `-t` run proves the mutation is KILLED by the test that is supposed to kill
it. It says nothing about whether any OTHER test also dies. So every mutation is
ALSO run against the WHOLE file unfiltered, the failing set is recorded, and the
report names -- per mutation -- the tests that fail under it and under no other.
A mutation with no such test is reported as SHARED, with its overlap named, never
silently accepted.

CARRIED FORWARD (do not re-derive)
----------------------------------
`core.autocrlf` IS TRUE IN THIS CHECKOUT. Every mutator is handed LF; the restore
is byte-for-byte from an in-memory snapshot with sha256 asserted in BOTH
directions, in a `finally`. `git checkout --` does NOT restore bytes here.

cp1252 KILLS A HARNESS'S OWN STDOUT AND LEAVES THE MUTATION APPLIED. stdout is
reconfigured to UTF-8 AND every printed line is ASCII-sanitised, because the
failure mode is not a cosmetic traceback -- it is a mutated working tree nobody
restored.

EVERY ARTIFACT A MUTATION CAN REACH IS SNAPSHOTTED, not just the file patched.
Phase C's M2 reported 3/3 KILLED, exit 0, and left a corrupted fire log because
the harness restored the file it PATCHED and never looked at the file the
mutation WROTE.
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
import shutil  # noqa: E402
import subprocess  # noqa: E402
from pathlib import Path  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

PARSE = "app/src/components/chart/engine/ast/parse.js"
PKG = "app/package.json"
TEST = "src/components/chart/engine/ast/parse.test.js"   # relative to app/

#: EVERY ARTIFACT A MUTATION CAN REACH.
GUARDED = sorted(
    [os.path.relpath(p, ROOT).replace(os.sep, "/")
     for p in glob.glob(str(ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "*"))]
    + [os.path.relpath(p, ROOT).replace(os.sep, "/")
       for p in glob.glob(str(ROOT / "tests" / "fixtures" / "ast" / "*.json"))]
    + [PKG, "app/package-lock.json"])

ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def strip(s: str) -> str:
    return ANSI.sub("", s)


def say(*parts) -> None:
    line = " ".join(str(p) for p in parts)
    sys.stdout.write(line.encode("ascii", "backslashreplace").decode("ascii") + "\n")
    sys.stdout.flush()


def _env() -> dict:
    e = dict(os.environ)
    e["PYTHONIOENCODING"] = "utf-8"
    e["NO_COLOR"] = "1"
    return e


#: vitest's own `Tests` summary line, and NOTHING else. `Test Files` cannot match:
#: there is no `s` before its space.
_TESTS_LINE = re.compile(r"^\s*Tests\s+(.*)$", re.M)
_COUNT = re.compile(r"(\d+)\s+(passed|failed|skipped|todo)")


def _parse_vitest_summary(out: str) -> dict:
    lines = _TESTS_LINE.findall(out)
    if not lines:
        return {"summary": None, "passed": None, "failed": 0, "selected": 0}
    line = lines[-1]
    counts = {kind: int(n) for n, kind in _COUNT.findall(line)}
    passed = counts.get("passed", 0)
    failed = counts.get("failed", 0)
    # SELECTED EXCLUDES `skipped`: a `-t` that matched nothing skips everything
    # and exits 0, which is a green exit over zero work.
    return {"summary": line.strip(), "passed": passed, "failed": failed,
            "selected": passed + failed}


#: ⚠️ `npx` IS `npx.cmd` ON WINDOWS AND `shell=False` CANNOT RESOLVE IT --
#: `CreateProcess` raises `FileNotFoundError: [WinError 2]`. Measured the first
#: time this harness ran, and Task 2's `run_vitest` carries the same latent
#: defect (its docstring says it is unused, so it has never been executed).
#: The fix is `shutil.which`, NOT `shell=True`: a `-t` containing a double quote
#: SPLIT under cmd.exe on this branch and selected TEN tests, and a single-quoted
#: one selected NOTHING and reported passed=None.
_NPX = shutil.which("npx") or shutil.which("npx.cmd")


def run_vitest(tfilter: str | None = None) -> dict:
    if not _NPX:
        raise SystemExit("npx is not on PATH; this gauntlet cannot run vitest at all")
    cmd = [_NPX, "vitest", "run", TEST]
    if tfilter:
        cmd += ["-t", tfilter]      # ARGV AS A LIST -- never a quoted shell string
    p = subprocess.run(cmd, cwd=ROOT / "app", capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=_env(), shell=False)
    out = strip(p.stdout + p.stderr)
    parsed = _parse_vitest_summary(out)
    names = re.findall(r"(?m)^\s*FAIL\s+\S+\s*>\s*(.+?)\s*$", out)
    return {"rc": p.returncode, "passed": parsed["passed"], "failed": parsed["failed"],
            "selected": parsed["selected"], "usage_error": parsed["summary"] is None,
            "summary": parsed["summary"], "failing": names, "out": out}


# --------------------------------------------------------------------------- #
# mutations
# --------------------------------------------------------------------------- #

def _once(text: str, anchor: str, name: str) -> str:
    """THE PREFLIGHT: the anchor must match EXACTLY ONCE.

    Zero is a mutation nobody ran (usual cause on this checkout: CRLF against an
    anchor written with `\\n`). TWO is worse -- the mutator silently edits a
    second site nobody reasoned about and the kill is a claim about the wrong
    code. A harness on this branch aborted on `hits != 1` and the fourth hit
    turned out to be a COMMENT IT HAD JUST WRITTEN.
    """
    n = text.count(anchor)
    if n != 1:
        crlf = "\r\n" in text
        raise SystemExit(
            f"{name}: anchor matched {n} times, expected exactly 1 "
            f"(file is {'CRLF' if crlf else 'LF'}) -- "
            f"{anchor.splitlines()[0][:70]!r}")
    return anchor


def _member_passes_through(text: str) -> str:
    """M1: `canonicalise` lets a MemberExpression through as `{type:'member'}`.

    `close.constructor` is how a closed table stops being closed, and
    `close.constructor.constructor` is `Function`. The persisted tree would carry
    a fifth node type straight into a Python walker with four cases.
    """
    a = _once(text, "  MemberExpression: 'canonicalise:member',\n", "M1a")
    text = text.replace(a, "", 1)
    b = _once(text, "    case 'Identifier':\n", "M1b")
    return text.replace(
        b,
        "    case 'MemberExpression':\n"
        "      return { type: 'member', name: node.property?.name, args: [convert(node.object)] }\n"
        "    case 'Identifier':\n", 1)


def _hash_does_not_sort_keys(text: str) -> str:
    """M2: `astHash` serialises with raw key order.

    `compute.ast` comes back out of a database and through `JSON.parse`; key
    order is whatever the round trip left. A hash that depends on it bumps
    `compute.rev` on a save that changed nothing, which force-migrates every
    binding and resets `last_value`.
    """
    a = _once(text, "    const keys = Object.keys(value).sort()\n", "M2")
    return text.replace(a, "    const keys = Object.keys(value)\n", 1)


def _keep_jseps_default_operators(text: str) -> str:
    """M3: `jsep.removeAllBinaryOps()` is dropped.

    Seven-plus operators jsep ships (`**`, `%`, `&`, `|`, `^`, `<<`, `>>`,
    `>>>`, `??`, `===`, `!==`) become parseable and reach a walker with no case
    for them. The whole ruling is that a feature is REMOVED, not blocked.
    """
    a = _once(text, "  jsep.removeAllBinaryOps()\n", "M3")
    return text.replace(a, "  // jsep.removeAllBinaryOps()  // M3\n", 1)


def _parse_formula_throws(text: str) -> str:
    """M4: `parseFormula` throws a syntax error instead of returning it.

    A throw from a parser reaches the builder as a blank screen, and a parse
    failure is the NORMAL case here -- the surface is a text box a user is
    halfway through typing into.
    """
    a = _once(
        text,
        "    return { ok: false, error: String(err && err.message ? err.message : err), guard: 'parser' }\n",
        "M4")
    return text.replace(a, "    throw err\n", 1)


def _caret_pin(text: str) -> str:
    """M5: `^jsep` instead of an exact pin.

    A parser that can move under a PERSISTED AST. `lightweight-charts` is pinned
    exact for a weaker reason than this one.
    """
    a = _once(text, '"jsep": "1.4.0",', "M5")
    return text.replace(a, '"jsep": "^1.4.0",', 1)


MUTATIONS = {
    "M1": dict(file=PARSE, mutate=_member_passes_through,
               filter="refused BY ITS DECLARED GUARD",
               must_reach="refused BY ITS DECLARED GUARD",
               why="canonicalise passes MemberExpression through as {type:'member'}"),
    "M2": dict(file=PARSE, mutate=_hash_does_not_sort_keys,
               filter="KEY ORDER IS NOT SEMANTICS",
               must_reach="KEY ORDER IS NOT SEMANTICS",
               why="astHash serialises with raw key order (no sort)"),
    "M3": dict(file=PARSE, mutate=_keep_jseps_default_operators,
               filter="the rest are REMOVED",
               must_reach="the rest are REMOVED",
               why="jsep.removeAllBinaryOps() dropped"),
    "M4": dict(file=PARSE, mutate=_parse_formula_throws,
               filter="it does not throw",
               must_reach="it does not throw",
               why="parseFormula throws instead of returning {ok:false}"),
    "M5": dict(file=PKG, mutate=_caret_pin,
               filter="pinned EXACT",
               must_reach="pinned EXACT",
               why="^jsep instead of an exact pin"),
}

#: THE GAUNTLET'S OWN ABORT MESSAGES, DISJOINT BY CONSTRUCTION -- a log reader
#: must be able to tell WHICH protection fired.
ABORTS = {
    "control_a": "CONTROL A is not green with a nonzero passed count",
    "control_b": "CONTROL B selects nothing the mutation could be judged by",
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
        f"{ABORTS['duplicate_killer']}: {sorted(killers)}")


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _snapshot() -> dict:
    return {rel: (ROOT / rel).read_bytes() for rel in GUARDED
            if (ROOT / rel).is_file()}


def _restore(snap: dict) -> list:
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
        say(f"  {rel}  {'present' if (ROOT / rel).is_file() else 'ABSENT'}")

    say("\n=== CONTROL A - the unmutated suite ===")
    res = run_vitest()
    say(f"  vitest {TEST}: rc={res['rc']} passed={res['passed']} "
        f"failed={res['failed']} selected={res['selected']}")
    say(f"  summary line read: {res['summary']!r}")
    if res["usage_error"]:
        say(res["out"][-3000:])
        raise SystemExit(ABORTS["no_summary"])
    if res["rc"] != 0 or not res["passed"]:
        say(res["out"][-4000:])
        raise SystemExit(ABORTS["control_a"] + " - every verdict below would be "
                         "a claim about nothing.")
    baseline = res["passed"]

    results = []
    for name in names:
        m = MUTATIONS[name]
        say(f"\n=== {name} ({m['why']}) ===")
        ctl = run_vitest(m["filter"])
        say(f"  CONTROL B (unmutated, -t {m['filter']!r}): rc={ctl['rc']} "
            f"passed={ctl['passed']} selected={ctl['selected']} "
            f"summary={ctl['summary']!r}")
        if ctl["usage_error"]:
            raise SystemExit(f"{name}: " + ABORTS["no_summary"])
        if ctl["rc"] != 0 or not ctl["selected"] or not ctl["passed"]:
            raise SystemExit(f"{name}: " + ABORTS["control_b"])

        path = ROOT / m["file"]
        snap = _snapshot()
        original = path.read_bytes()
        before = _sha(original)
        try:
            mutated = m["mutate"](original.decode("utf-8").replace("\r\n", "\n"))
            path.write_text(mutated, encoding="utf-8", newline="\n")
            after = path.read_bytes()
            if after == original:
                raise SystemExit(f"{name}: " + ABORTS["identical_bytes"])
            say(f"  applied: {len(original)} -> {len(after)} bytes ({_sha(after)[:12]})")
            got = run_vitest(m["filter"])
            # …and the WHOLE file, so uniqueness is measured rather than assumed.
            whole = run_vitest()
        finally:
            moved = _restore(snap)
        assert _sha(path.read_bytes()) == before, f"{name}: " + ABORTS["restore_failed"]
        collateral = [r for r in moved if r != m["file"]]
        say(f"  restored {len(moved)} guarded artifact(s)"
            + (f"; {ABORTS['artifact_moved']}: {collateral}" if collateral else ""))

        reached = any(m["must_reach"] in f for f in got["failing"])
        verdict = ("KILLED" if got["rc"] != 0 and reached else
                   "SUSPECT" if got["rc"] != 0 else "SURVIVED")
        say(f"  mutated (-t): rc={got['rc']} passed={got['passed']} "
            f"failed={got['failed']} summary={got['summary']!r}")
        say(f"  failing (-t): {got['failing'] or '(none)'}")
        say(f"  mutated (whole file): rc={whole['rc']} passed={whole['passed']} "
            f"failed={whole['failed']} of a {baseline}-test baseline")
        say(f"  failing (whole file): {whole['failing'] or '(none)'}")
        say(f"  -> {verdict}" + ("" if reached or got["rc"] == 0
                                 else f"  (expected to reach: {m['must_reach']})"))
        results.append((name, verdict, got["failing"], set(whole["failing"]), m["must_reach"]))

    say("\n=== UNIQUENESS (measured on the UNFILTERED run) ===")
    shared = []
    for name, _v, _f, whole_set, killer in results:
        others = set()
        for n2, _v2, _f2, w2, _k2 in results:
            if n2 != name:
                others |= w2
        only = sorted(whole_set - others)
        say(f"  {name}: {len(whole_set)} test(s) fail; UNIQUE to it: {only or '(none)'}")
        if not only:
            shared.append(name)
    if shared:
        say(f"  SHARED (no test fails under this mutation alone): {shared}")

    say("\n=== SUMMARY ===")
    for name, verdict, failing, _w, killer in results:
        say(f"  {name:4} {verdict:9} killer={killer!r}")
    bad = [n for n, v, _f, _w, _k in results if v != "KILLED"]
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
