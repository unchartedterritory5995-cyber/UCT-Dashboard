#!/usr/bin/env python3
"""Track E runner -- fires tests/test_golden_journey_04_05_live.py the moment
a scoped Anthropic dev/test credential exists in this environment, with no
further setup.

    python tools/track_e_run_golden_journey.py

This does exactly what GOLDEN_JOURNEY_04_05_READY_TO_RUN.md's own prepared
command does:

    ANTHROPIC_API_KEY=... INDICATOR_VISION_ENABLED=1 \\
        pytest tests/test_golden_journey_04_05_live.py -v -rs -s

plus two things a bare pytest invocation doesn't give you:

  * A pre-flight check that BOTH gates (the key, the vision flag) are set
    BEFORE spawning pytest, with a clear, specific message about which is
    missing and why -- rather than a wall of skip reasons after the fact.
  * The full pytest output written to a timestamped log file under
    tools/_track_e_runs/ (gitignored-by-convention alongside this repo's
    other tools/_*_out/ working directories), so the exact evidence survives
    the terminal scrollback for the write-up step in
    GOLDEN_JOURNEY_04_05_READY_TO_RUN.md's "Evidence-capture plan".

⛔ THIS SCRIPT NEVER PRINTS, LOGS, OR ECHOES THE KEY VALUE. It only checks
`bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())` -- exactly the same
presence check tests/test_golden_journey_04_05_live.py itself uses -- and lets
pytest's own subprocess environment carry the real value. The log file it
writes is pytest's stdout/stderr, which the test file itself never prints the
key into (confirmed by reading it in full).

What this script does NOT do, even in the automated evidence-capture path
below: pass semantic judgment on an ambiguous result. Per DEC-008 and this
program's own discipline against silent-wrong-answer classification, deciding
whether an ambiguous-prompt response was handled correctly, or which of
sma/ema the model picked, is a judgment call for whoever reviews the run --
this script only ever MECHANICALLY EXTRACTS what the test file itself already
printed (the `[CGJ4 evidence]`/`[CGJ5 evidence]` lines each case emits for
exactly this purpose) and per-test pass/fail/skip outcomes. It never invents
prose, never infers "why", and never touches this program's AUTHORITATIVE
status docs (VALIDATION_COVERAGE_MAP.md, RISK_REGISTER.md, PHASE_ONE_PLAN.md)
-- those still require a reviewer to actually read the extracted evidence and
judge whether the run genuinely clears the bar, the same discipline
CORE_GOLDEN_JOURNEY_02_THINKSCRIPT_ADX.md's hand-verified, scope-limited
prose demonstrates a script cannot replicate. On a full pass (pytest exit
code 0 -- every non-skipped case passed) this script writes a DRAFT
GOLDEN_JOURNEY_04_05_LIVE_RESULTS.md from that extraction, clearly labeled
DRAFT, so the reviewer edits/confirms it rather than starting from a blank
page and re-transcribing printed evidence by hand.
"""

from __future__ import annotations

import datetime
import json
import os
import re
import subprocess
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, ".."))
LOG_DIR = os.path.join(_HERE, "_track_e_runs")
TEST_PATH = os.path.join("tests", "test_golden_journey_04_05_live.py")
RESULTS_DOC = os.path.join(
    _ROOT, "docs", "superpowers", "specs", "universal-indicator-ecosystem",
    "GOLDEN_JOURNEY_04_05_LIVE_RESULTS.md")

#: ⚠️ TWO SEPARATE PATTERNS, PAIRED BY ORDER, NOT ONE LINE-ANCHORED PATTERN.
#: `pytest -v -s` prints "tests/....py::name" the MOMENT a test starts, then
#: whatever the test/fixtures print to stdout interleaves, and the bare
#: PASSED/FAILED/SKIPPED/ERROR word lands on its OWN line only once the test
#: finishes (confirmed against a real captured run, e.g.
#: golden_journey_04_05_20260905-145122.log's own layout: the node-id line
#: ends with print() output, not the verdict). A single-line-anchored regex
#: silently matches ZERO tests against real pytest output while still passing
#: against a hand-typed same-line sample -- this file has no `-n` (xdist), so
#: tests run strictly sequentially and pairing by encounter ORDER is sound.
_TEST_START_RE = re.compile(
    r"^tests/test_golden_journey_04_05_live\.py::(\S+)", re.MULTILINE)
_OUTCOME_WORD_RE = re.compile(r"^(PASSED|FAILED|SKIPPED|ERROR)\s*$", re.MULTILINE)
_EVIDENCE_RE = re.compile(r"^\[(CGJ4|CGJ5) evidence\].*$", re.MULTILINE)
_SUMMARY_RE = re.compile(
    r"^=+ (.+?) in [\d.]+s(?: \(\d+:\d+:\d+\))? =+\s*$", re.MULTILINE)
#: The verbose per-test PASSED/FAILED/SKIPPED section always precedes BOTH of
#: these (pytest's fixed output order). Cutting the search to before whichever
#: comes first matters concretely: pytest's own "warnings summary" section
#: reprints bare `tests/....py::test_name` lines (attributing a warning to the
#: test that raised it) with NO outcome word to pair with -- confirmed against
#: a real captured run, where it silently added an 8th test_starts match a
#: length-blind version of this function would have mis-paired against.
_FAILURES_OR_WARNINGS_HEADER_RE = re.compile(
    r"^=+ (FAILURES|warnings summary) =+\s*$", re.MULTILINE)


def extract_evidence(output: str) -> dict:
    """MECHANICAL extraction only -- no judgment, no invented prose.

    Every field here is either a regex pull of something pytest/the test file
    already printed verbatim, or a plain count. Nothing here decides whether a
    result is GOOD; that stays for whoever reads `evidence["lines"]`.
    """
    header_match = _FAILURES_OR_WARNINGS_HEADER_RE.search(output)
    verbose_section = output[:header_match.start()] if header_match else output
    test_names = [m.group(1) for m in _TEST_START_RE.finditer(verbose_section)]
    outcome_words = [m.group(1) for m in _OUTCOME_WORD_RE.finditer(verbose_section)]
    # ⛔ ZIP, NEVER ASSUME EQUAL LENGTH. A crashed collection or an unexpected
    # pytest output shape must show up as a SHORTER list here, not a
    # mis-paired test<->outcome that reports the wrong verdict for a name.
    outcomes = [{"test": name, "outcome": outcome}
                for name, outcome in zip(test_names, outcome_words)]
    lines = [m.group(0) for m in _EVIDENCE_RE.finditer(output)]
    summary_match = _SUMMARY_RE.search(output)
    return {
        "outcomes": outcomes,
        "lines": lines,
        "summary": summary_match.group(1) if summary_match else None,
        "counts": {
            outcome: sum(1 for o in outcomes if o["outcome"] == outcome)
            for outcome in ("PASSED", "FAILED", "SKIPPED", "ERROR")
        },
        # ⛔ VISIBLE, NEVER SILENT. `zip()` truncates to the shorter list with
        # no signal of its own -- a mismatch here means the pairing above is
        # NOT trustworthy (a crash mid-collection, an unrecognized pytest
        # output shape) and `outcomes` must not be read as complete.
        "raw_counts": {"test_starts": len(test_names), "outcome_words": len(outcome_words)},
    }


def _draft_results_doc(evidence: dict, *, log_path: str, stamp: str) -> str:
    """A DRAFT, not a finished evidence document. Every judgment-call field
    (scope limits, hand-verification, "why this matters") that
    CORE_GOLDEN_JOURNEY_02_THINKSCRIPT_ADX.md carries is left as an explicit
    placeholder for the reviewer -- this function only ever transcribes what
    was mechanically extracted above.
    """
    lines = ["# Golden Journey #4/#5 -- Live Results (DRAFT)", "",
             "> ⚠️ **DRAFT — MECHANICALLY GENERATED, NOT YET REVIEWED.** Every "
             "pass/fail outcome and evidence line below is copied verbatim "
             "from the pytest run; nothing here has been read or judged by a "
             "reviewer yet. Do not cite this file, and do not update "
             "`VALIDATION_COVERAGE_MAP.md` or any other authoritative doc "
             "from it, until a reviewer has confirmed each finding below and "
             "removed this banner.", "",
             f"**Run:** `{stamp}` -- full log: `{os.path.relpath(log_path, _ROOT)}`",
             f"**Summary:** {evidence['summary'] or '(not found)'}", ""]
    lines.append("## Per-test outcome (mechanical)")
    lines.append("")
    lines.append("| Test | Outcome |")
    lines.append("|---|---|")
    for o in evidence["outcomes"]:
        lines.append(f"| `{o['test']}` | **{o['outcome']}** |")
    lines.append("")
    lines.append("## Evidence lines printed by the test file (verbatim)")
    lines.append("")
    if evidence["lines"]:
        lines.append("```")
        lines.extend(evidence["lines"])
        lines.append("```")
    else:
        lines.append("(none captured -- check the full log)")
    lines.append("")
    lines.append("## Reviewer judgment (TODO -- not filled in by this script)")
    lines.append("")
    lines.append(
        "- [ ] For the ambiguous-prompt case: did the model correctly refuse/"
        "clarify rather than silently guess? Quote the actual response.")
    lines.append(
        "- [ ] For the positive case: which of sma/ema (or other reading) did "
        "the model pick? Is it defensible?")
    lines.append(
        "- [ ] For the screenshot case: which function(s) did the model name? "
        "Is the confidence/labeling honest about it being a guess?")
    lines.append(
        "- [ ] Any scope limits, gaps, or things this run did NOT cover "
        "(mirror CORE_GOLDEN_JOURNEY_02_THINKSCRIPT_ADX.md's own \"What this "
        "journey did NOT cover\" section)?")
    lines.append(
        "- [ ] Does this run genuinely clear the evidence bar required before "
        "VALIDATION_COVERAGE_MAP.md's plain-language/screenshot rows may move "
        "to '4 -- End-to-End'? (Only a reviewer answers this -- see the "
        "banner above.)")
    lines.append("")
    return "\n".join(lines)


def _has_real_key() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())


def _vision_on() -> bool:
    return os.environ.get("INDICATOR_VISION_ENABLED", "").strip().lower() in ("1", "true", "yes", "on")


def preflight() -> list[str]:
    """Returns a list of blocker messages; empty means ready to run."""
    blockers = []
    if not _has_real_key():
        blockers.append(
            "ANTHROPIC_API_KEY is not set. This must be a scoped, isolated-"
            "environment-only dev/test key per DEC-008 -- never the production "
            "key, never used against member data."
        )
    if not _vision_on():
        blockers.append(
            "INDICATOR_VISION_ENABLED is not '1'. Golden Journey #5 (screenshot "
            "door) needs this set, and per DEC-008 it must be set ONLY in this "
            "same isolated environment, never globally or in production."
        )
    return blockers


def run() -> int:
    blockers = preflight()
    if blockers:
        print("TRACK E: NOT READY TO RUN.")
        for b in blockers:
            print(f"  - {b}")
        print(
            "\nOnce both are set in this process's environment, re-run this "
            "script with no arguments -- it will proceed automatically."
        )
        return 2

    os.makedirs(LOG_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    log_path = os.path.join(LOG_DIR, f"golden_journey_04_05_{stamp}.log")

    cmd = [sys.executable, "-m", "pytest", TEST_PATH, "-v", "-rs", "-s"]
    print(f"Running: {' '.join(cmd)}")
    print(f"(env: ANTHROPIC_API_KEY=<set, {len(os.environ['ANTHROPIC_API_KEY'])} chars>, "
          f"INDICATOR_VISION_ENABLED={os.environ.get('INDICATOR_VISION_ENABLED')!r})")
    proc = subprocess.run(cmd, cwd=_ROOT, capture_output=True, text=True)
    output = proc.stdout + proc.stderr

    with open(log_path, "w", encoding="utf-8") as fh:
        fh.write(output)

    evidence = extract_evidence(output)
    evidence_path = log_path.replace(".log", ".evidence.json")
    with open(evidence_path, "w", encoding="utf-8") as fh:
        json.dump(evidence, fh, indent=2)

    print(output)
    print(f"\nFull output also saved to: {log_path}")
    print(f"Mechanically-extracted evidence saved to: {evidence_path}")
    print(f"pytest exit code: {proc.returncode}")

    # ⛔ A FULL PASS MEANS EVERY NON-SKIPPED CASE PASSED -- pytest's own exit
    # code, never re-derived here. This is a MECHANICAL gate on whether to draft
    # the doc at all, not a judgment that the evidence is GOOD; see the
    # docstring and the draft's own banner.
    if proc.returncode == 0 and evidence["counts"]["FAILED"] == 0 and evidence["counts"]["ERROR"] == 0:
        doc = _draft_results_doc(evidence, log_path=log_path, stamp=stamp)
        os.makedirs(os.path.dirname(RESULTS_DOC), exist_ok=True)
        with open(RESULTS_DOC, "w", encoding="utf-8") as fh:
            fh.write(doc)
        print(f"\nDraft evidence doc written to: {RESULTS_DOC}")
        print(
            "NEXT (manual, deliberately not automated -- see this script's own "
            "docstring for why): read the draft above, fill in the reviewer "
            "judgment checklist, remove the DRAFT banner once confirmed, and "
            "ONLY THEN update VALIDATION_COVERAGE_MAP.md's plain-language/"
            "screenshot rows to '4 -- End-to-End'."
        )
    else:
        print(
            "\nNo draft doc written -- the run did not fully pass "
            f"(exit {proc.returncode}, {evidence['counts']}). Diagnose and "
            "fix before re-running; a draft would misrepresent a failing run "
            "as evidence."
        )
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(run())
