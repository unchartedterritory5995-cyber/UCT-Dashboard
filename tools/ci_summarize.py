"""Turn a vitest or pytest log into the JSON the `ci-results` branch carries.

⛔⛔ **CI RESULTS ARE READ FROM THE REPO.** The workflow writes this JSON onto an orphan
branch and the next session reads it with `git` — a durable, committed, diffable record
that outlives Actions log retention.

⚰️ **THIS DOCSTRING USED TO SAY THE RESULT WAS "UNREADABLE" WITHOUT `gh` OR A TOKEN, AND
THAT WAS FALSE (F-CI-2).** The repository is public, so `api.github.com` answers
ANONYMOUSLY: `/repos/…` and `/actions/runs/…` return full run and job records with no
credential at all. "I lack the tool I reached for" had been written down as "the thing
cannot be read". ⚠️ What IS genuinely unreadable anonymously is the **log** endpoint —
it returns **403** — so publishing the error text into the repo remains the only
no-account path to detail. The unit is right; the reason on it was wrong.

⛔ **THE JOB'S OUTCOME IS NOT IN THIS FILE.** A log cannot say whether the runner cancelled
the job. `tools/ci_outcome.py` reads that from the runner's own verdict, and
`ci_outcome.suite_ok()` composes the two.

⛔ **ZERO COLLECTED IS NOT ZERO FAILED.** A run that collected nothing — a bad glob, a
crashed collector, an OOM before the first test — produces `passed=0, failed=0`, which is
indistinguishable from a clean sweep unless `collected` is carried beside it. Every summary
therefore records `collected`, and `ok` is FALSE when it is zero.

⛔ **A RUN WITHOUT A TOTALS LINE IS NOT A RUN.** When no totals line is found the summary
says `totals_line_found: false` and `ok: false`; it never reports a zero as a pass.

Usage:
    python tools/ci_summarize.py --suite vitest --log vitest.log --out v.json
    python tools/ci_summarize.py --suite pytest --log pytest.log --out p.json
    python tools/ci_summarize.py --self-check
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re

OK, FAIL = 0, 1

#: ⛔ Strip ANSI before matching. vitest colours its totals line, and a colourised
#: "2 failed" does not match a plain-text pattern — the run would read as green.
_ANSI = re.compile(r"\x1b\[[0-9;]*m")

_V_FILES = re.compile(r"Test Files\s+(?:(\d+)\s+failed\D+)?(?:(\d+)\s+passed\D+)?\((\d+)\)")
_V_TESTS = re.compile(r"Tests\s+(?:(\d+)\s+failed\D+)?(?:(\d+)\s+passed\D+)?"
                      r"(?:(\d+)\s+skipped\D+)?\((\d+)\)")
_V_DUR = re.compile(r"Duration\s+([\d.]+)s")
_V_FAILFILE = re.compile(r"(?:FAIL|❯)\s+(\S+\.(?:test|spec)\.[jt]sx?)")

# ⚰️⚰️ E CP20 — THE OLD PATTERN WAS ALL-OPTIONAL AND MATCHED ALMOST ANYWHERE.
# Every count group was `(?:…)?`, so the whole thing reduced to "…in <float>s" and matched
# any line mentioning a duration. Against `tests-07` it matched and returned
# `totals_line_found: True` with **passed=0 failed=0** — zeros that `ci_aggregate` then SUMS
# into the suite total. ⛔ A partial match that yields zeros is worse than no match: it
# reports fewer failures than there were, which is the flattering direction.
# ⭐ A totals line must carry a DURATION *and at least one COUNT*. The counts are then read
# individually, so their ORDER does not matter — run #16's line put `15192 warnings` between
# `skipped` and `error`, which the positional pattern could not express.
_P_SUMMARY_LINE = re.compile(
    r"^(?=[^\n]*\bin [\d.]+s)(?=[^\n]*\b\d+ (?:failed|passed|skipped|error))[^\n]*$", re.M)
_P_DUR = re.compile(r"\bin ([\d.]+)s")
#: `\b` before the word matters: `9 xfailed` must not read as `9 failed`.
def _count(line, word):
    m = re.search(r"(\d+)\s+\b%s\b" % word, line)
    return int(m.group(1)) if m else 0
_P_FAILFILE = re.compile(r"^FAILED\s+(\S+?)(?:::|\s|$)", re.M)
_P_COLLECTED = re.compile(r"(\d+) (?:tests? )?collected")



def _i(v):
    return int(v) if v else 0


def summarize(suite: str, text: str) -> dict:
    text = _ANSI.sub("", text)
    out = {"suite": suite, "collected": 0, "passed": 0, "failed": 0, "errored": 0,
           "skipped": 0, "wall_s": None, "failed_files": [], "totals_line_found": False,
           "runner_line": ""}

    if suite == "vitest":
        m = _V_TESTS.search(text)
        if m:
            out["totals_line_found"] = True
            out["failed"], out["passed"] = _i(m.group(1)), _i(m.group(2))
            out["skipped"], out["collected"] = _i(m.group(3)), _i(m.group(4))
        d = _V_DUR.search(text)
        if d:
            out["wall_s"] = float(d.group(1))
        out["failed_files"] = sorted(set(_V_FAILFILE.findall(text)))
        fm = _V_FILES.search(text)
        if fm:
            out["runner_line"] = fm.group(0)
    else:
        c = _P_COLLECTED.search(text)
        if c:
            out["collected"] = _i(c.group(1))
        # ⚰️⚰️ E CP20 — THIS READ ONLY THE LAST LINE, AND LOST A SHARD THAT RAN.
        # Run #16's `tests-07` printed `37 failed, 2362 passed, 2 skipped, 15192 warnings,
        # 1 error in 443.42s` at line **4,424 of 142,028** — and then 137,604 lines of
        # background-thread noise (`[mem] rss_mb=…`, a logo prewarm) kept writing after
        # pytest had finished. The totals line was in the log the whole time; this function
        # was looking one line from the end.
        # ⛔ The shard was reported as having produced NO totals, which made the suite
        # ok:false for a reason that was not true and dropped 2,364 tests and 37 failures
        # out of the published counts.
        # ⭐ Same class as E CP18: a rule applied to one suite and not the other. The vitest
        # branch above searches the WHOLE text; this one read a single line.
        # The LAST match wins — a re-run or a nested summary must not be overridden by an
        # earlier one.
        hits = _P_SUMMARY_LINE.findall(text)
        line = hits[-1].strip() if hits else ""
        if line:
            out["totals_line_found"] = True
            out["failed"] = _count(line, "failed")
            out["passed"] = _count(line, "passed")
            out["skipped"] = _count(line, "skipped")
            out["errored"] = _count(line, "error") or _count(line, "errors")
            d = _P_DUR.search(line)
            out["wall_s"] = float(d.group(1)) if d else None
            out["runner_line"] = line
            if not out["collected"]:
                out["collected"] = (out["passed"] + out["failed"]
                                    + out["skipped"] + out["errored"])
        out["failed_files"] = sorted(set(_P_FAILFILE.findall(text)))

    # ⛔ THE THREE WAYS A RUN LIES GREEN, all folded into one honest flag.
    # ⛔ E CP5: the OUTCOME half of `ok` moved to tools/ci_outcome.py, which reads the
    # RUNNER's verdict. This function sees only the LOG and must not pretend to know
    # whether the job survived — that pretence is exactly what `oom_or_timeout` was.
    # `ci_outcome.suite_ok(summary, outcome)` is the composition.
    out["ok"] = bool(out["totals_line_found"] and out["collected"] > 0)
    return out


def _self_check() -> int:
    ok = True

    def show(label, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print("  %-56s -> %-8s %s" % (label, got, "ok" if good else "WRONG (want %s)" % (want,)))

    green_v = ("\x1b[32m Test Files \x1b[0m 1 passed (1)\n"
               "      Tests  8 passed (8)\n   Duration  4.7s\n")
    s = summarize("vitest", green_v)
    show("CLEAN vitest: passed/collected read through ANSI",
         (s["passed"], s["collected"], s["ok"]), (8, 8, True))

    red_v = (" FAIL  src/pages/Thing.test.jsx\n Test Files  1 failed (1)\n"
             "      Tests  2 failed | 6 passed (8)\n   Duration  9.1s\n")
    s = summarize("vitest", red_v)
    show("DIRTY vitest: failed_files is non-empty",
         (s["failed"], s["failed_files"]), (2, ["src/pages/Thing.test.jsx"]))

    s = summarize("vitest", "no totals here at all\n")
    show("EMPTY vitest: zero collected is NOT a pass",
         (s["collected"], s["totals_line_found"], s["ok"]), (0, False, False))

    green_p = "collected 25 items\n\n25 passed, 906 warnings in 1.42s\n"
    s = summarize("pytest", green_p)
    show("CLEAN pytest: collected and passed", (s["collected"], s["passed"], s["ok"]),
         (25, 25, True))

    red_p = ("collected 8 items\nFAILED tests/test_a.py::test_x - AssertionError\n"
             "1 failed, 7 passed in 0.80s\n")
    s = summarize("pytest", red_p)
    show("DIRTY pytest: failed + failed_files",
         (s["failed"], s["failed_files"]), (1, ["tests/test_a.py"]))


    s = summarize("pytest", "")
    show("EMPTY pytest: nothing collected, not ok",
         (s["collected"], s["ok"]), (0, False))

    # ⚰️ E CP20 — THE REAL LINE THAT WAS LOST, verbatim from run #16's `tests-07`, with the
    # background-thread noise that followed it. 137,604 lines came after this in the log.
    real = ("collected 2401 items\n"
            "37 failed, 2362 passed, 2 skipped, 15192 warnings, 1 error in 443.42s (0:07:23)\n"
            + "[mem] rss_mb=748.3 threads=21\n" * 500
            + "[startup] logo_hires_v1: upgrade pass complete\n")
    s = summarize("pytest", real)
    show("totals line found 500 lines from the end", s["totals_line_found"], True)
    show("...failed", s["failed"], 37)
    show("...passed", s["passed"], 2362)
    show("...skipped", s["skipped"], 2)
    show("...errored, though `warnings` sits between skipped and error", s["errored"], 1)
    show("...duration", s["wall_s"], 443.42)
    # ⛔ CONTROL: a log with noise and NO totals line must still report false, or the check
    # above proves only that the parser matches everything.
    s = summarize("pytest", "[mem] rss_mb=748.3\n" * 200 + "some 12 things in 3.0s of prose\n")
    show("CONTROL: noise with no counts is NOT a totals line", s["totals_line_found"], False)
    # ⛔ The all-optional regression: a bare duration must not read as a totals line.
    s = summarize("pytest", "warming caches in 12.5s\n")
    show("CONTROL: a bare duration is NOT a totals line", s["totals_line_found"], False)
    # ⛔ `9 xfailed` must not be read as 9 failed.
    s = summarize("pytest", "1 failed, 2615 passed, 9 xfailed, 2 warnings in 25.00s\n")
    show("xfailed is not read as failed", (s["failed"], s["passed"]), (1, 2615))
    # ⛔ The LAST summary wins, so a re-run cannot be overridden by an earlier one.
    s = summarize("pytest", "1 failed, 2 passed in 1.0s\nnoise\n5 failed, 9 passed in 2.0s\n")
    show("the LAST summary line wins", (s["failed"], s["passed"]), (5, 9))

    print("SELF-CHECK: %s" % ("PASS" if ok else "FAIL"))
    return OK if ok else FAIL


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--suite", choices=["vitest", "pytest"])
    ap.add_argument("--log")
    ap.add_argument("--out")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return _self_check()
    if not (a.suite and a.log):
        print("need --suite and --log (or --self-check)")
        return FAIL
    text = pathlib.Path(a.log).read_text(encoding="utf-8", errors="replace")
    data = summarize(a.suite, text)
    blob = json.dumps(data, indent=2)
    if a.out:
        pathlib.Path(a.out).write_text(blob + "\n", encoding="utf-8")
    print(blob)
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
