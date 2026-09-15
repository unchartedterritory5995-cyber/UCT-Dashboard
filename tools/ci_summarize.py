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

_P_TOTALS = re.compile(
    r"(?:(\d+) failed)?(?:[,\s]*)(?:(\d+) passed)?(?:[,\s]*)(?:(\d+) skipped)?"
    r"(?:[,\s]*)(?:(\d+) error)?[^\n]*?in ([\d.]+)s")
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
        tail = text.strip().splitlines()[-1] if text.strip() else ""
        m = _P_TOTALS.search(tail)
        if m:
            out["totals_line_found"] = True
            out["failed"], out["passed"] = _i(m.group(1)), _i(m.group(2))
            out["skipped"], out["errored"] = _i(m.group(3)), _i(m.group(4))
            out["wall_s"] = float(m.group(5))
            out["runner_line"] = tail.strip()
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
