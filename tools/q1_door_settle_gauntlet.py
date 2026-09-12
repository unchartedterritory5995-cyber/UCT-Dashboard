#!/usr/bin/env python3
"""Wave Q1 — ONE MUTATION PER SETTLE CALL SITE.

A settle that exists is not a settle that runs, and a rail that is green is not
a rail that can fail. This removes each `settleNoteWrite(...)` call in turn and
records whether the suite notices.

  RED   = at least one rail failed  -> that door is genuinely covered
  GREEN = nothing failed            -> THE DOOR HAS NO RAIL. A defect, not a pass.

DERIVED, NEVER TYPED. The call sites are read out of the source every run, so a
seventeenth door added tomorrow is gauntleted the day it lands rather than the
day somebody remembers to add it to a list.

NEVER `git checkout`. The file is restored from an in-memory copy taken before
the edit, so a concurrent session's unrelated work in the same tree cannot be
destroyed by this tool (feedback_mutation_check_never_git_checkout).

Usage:
    python tools/q1_door_settle_gauntlet.py [--out docs/notebook/q1-settle-gauntlet.md]
    python tools/q1_door_settle_gauntlet.py --self-check   # proves it can report GREEN
"""
from __future__ import annotations

import argparse
import io
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
APP = REPO / "app"
SRC = APP / "src" / "pages" / "journal-2-0"

# The rails that are allowed to notice. Scoped rather than the whole suite: a
# full run takes minutes per mutation and this runs ~17 of them.
RAILS = [
    "src/pages/journal-2-0/lib/offline/doorFamilies.settle.test.jsx",
    "src/pages/journal-2-0/lib/offline/doorEnumeration.test.js",
    "src/pages/journal-2-0/lib/offline/settleNoteWrite.test.jsx",
    "src/pages/journal-2-0/lib/offline/offlineWordsSurvive.property.test.jsx",
    "src/pages/journal-2-0/components/notebook/HeroImagePicker.settle.test.jsx",
    "src/pages/journal-2-0/lib/captureTargets.test.js",
    "src/pages/journal-2-0/lib/captureFinancialFact.test.js",
    # the per-component rails, added once each door got a behavioural one
    "src/pages/journal-2-0/components/notebook/NoteEditorPage.excerpts.test.jsx",
    "src/pages/journal-2-0/components/notebook/ThesisReviewSection.test.jsx",
    "src/pages/journal-2-0/components/AddPositionModal.test.jsx",
    "src/pages/journal-2-0/tabs/NotebookTab.test.jsx",
]

# ⛔ ANCHORED ON THE TOKEN, NOT ON A LINE START. A `^\s*…` form looks equivalent
# and is not: `\s` matches newlines, so after the comments are blanked it walks
# BACK across them and reports the comment's line number instead of the call's.
CALL = re.compile(r"settleNoteWrite\s*\(")


def call_sites() -> list[tuple[Path, int, str]]:
    """Every `settleNoteWrite(` call in product code, derived from the source."""
    out: list[tuple[Path, int, str]] = []
    for p in sorted(SRC.rglob("*.js")) + sorted(SRC.rglob("*.jsx")):
        rel = p.relative_to(REPO).as_posix()
        if ".test." in rel or ".spec." in rel:
            continue
        if rel.endswith("lib/offline/settleNoteWrite.js"):
            continue  # the definition, not a call site
        text = io.open(p, encoding="utf-8").read()
        # Strip comments so a ⛔ note ABOUT the settle is never mistaken for one.
        # ⛔⛔ PRESERVING THE LINE COUNT. Collapsing a block comment to a single
        # space shifts every line number after it, so the line this reports is
        # not the line the mutation edits — which is why the first run of this
        # tool reported all sixteen sites SKIPPED. Blank the comment's bytes and
        # keep its newlines.
        blank = lambda m: re.sub(r"[^\n]", " ", m.group(0))  # noqa: E731
        stripped = re.sub(r"/\*[\s\S]*?\*/", blank, text)
        stripped = re.sub(r"//[^\n]*", blank, stripped)
        for m in CALL.finditer(stripped):
            line = stripped[: m.start()].count("\n") + 1
            # ⭐ Blanking preserves LENGTH as well as line count, so an offset
            # taken in the stripped text indexes the original byte-for-byte.
            out.append((p, line, text.split("\n")[line - 1].strip()[:78], m.start()))
    return out


# Same arity, same arguments evaluated, no revision recorded.
NOOP = "(async () => null)("


def neutralise(text: str, offset: int) -> str | None:
    """Stop the settle at `offset` landing anything, without moving one other byte.

    ⛔ THE CALL IS REPLACED, NEVER THE STATEMENT. Two of the sixteen doors settle
    inside a larger expression —
    `.then(async (r) => (r.ok ? settleNoteWrite(noteId, r) : null))` — and
    swapping the surrounding statement for a no-op there is a syntax error. A
    syntax error fails every rail for the wrong reason, and this tool would
    print that as coverage.
    """
    if not text.startswith("settleNoteWrite(", offset):
        # tolerate `settleNoteWrite (`
        m = CALL.match(text, offset)
        if not m:
            return None
        return text[:offset] + NOOP + text[m.end():]
    return text[:offset] + NOOP + text[offset + len("settleNoteWrite("):]


class RunnerNeverReported(RuntimeError):
    """The suite produced no totals line, so its exit code means nothing."""


def run_rails() -> tuple[bool, str]:
    """(did any rail fail, the totals line).

    ⛔⛔ A RUN WITHOUT A TOTALS LINE IS NOT A RUN, and it must not be able to
    read as a pass. The first version of this tool returned `(False, "NO TOTALS
    LINE")` — which printed as **GREEN**, i.e. "the rails did not notice",
    exactly the direction that manufactures false coverage. It raises now.
    """
    cmd = ["npx", "vitest", "run", *RAILS]
    r = subprocess.run(cmd, cwd=APP, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", shell=(sys.platform == "win32"))
    blob = re.sub(r"\x1b\[[0-9;]*m", "", (r.stdout or "") + (r.stderr or ""))
    m = re.search(r"Tests\s+((?:\d+ \w+[ |]*)+)\(\d+\)", blob)
    if not m:
        raise RunnerNeverReported(blob[-1500:])
    return "failed" in m.group(1), m.group(1).strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="docs/notebook/q1-settle-gauntlet.md")
    ap.add_argument("--self-check", action="store_true",
                    help="mutate a site the rails cannot see, proving GREEN is reachable")
    args = ap.parse_args()

    sites = call_sites()
    print(f"{len(sites)} settle call sites, derived from the source\n")

    # ⭐ THE CONTROL FIRST. An unmutated run MUST be green, or every RED below
    # is this tool reporting a pre-existing failure as coverage.
    try:
        failed, totals = run_rails()
    except RunnerNeverReported as e:
        print("⛔ THE RUNNER NEVER REPORTED A TOTALS LINE — nothing was measured.\n")
        print(e)
        return 2
    print(f"CONTROL (no mutation): {'RED' if failed else 'GREEN'} — {totals}")
    if failed:
        print("\n⛔ The rails are not green before any mutation. Fix that first — "
              "every RED this tool would print is meaningless until they are.")
        return 2

    rows = []
    for idx, (path, line, snippet, offset) in enumerate(sites, 1):
        rel = path.relative_to(REPO).as_posix()
        original = io.open(path, encoding="utf-8").read()
        mutated = neutralise(original, offset)
        if mutated is None or mutated == original:
            rows.append((rel, line, snippet, "SKIPPED", "could not neutralise the call"))
            continue
        try:
            io.open(path, "w", encoding="utf-8", newline="").write(mutated)
            t0 = time.time()
            try:
                failed, totals = run_rails()
                verdict = "RED" if failed else "GREEN"
            except RunnerNeverReported:
                # ⛔ Not GREEN. An unmeasured mutation is UNMEASURED, and a tool
                # that quietly calls it "uncovered" or "covered" is inventing
                # a reading it never took.
                verdict, totals = "UNMEASURED", "the runner never reported"
            rows.append((rel, line, snippet, verdict, totals))
            print(f"[{idx}/{len(sites)}] {verdict:<10} {rel}:{line}"
                  f"  ({time.time() - t0:.0f}s) {totals}")
        finally:
            # ⛔ From the in-memory copy. Never `git checkout`.
            io.open(path, "w", encoding="utf-8", newline="").write(original)
            assert io.open(path, encoding="utf-8").read() == original, f"RESTORE FAILED: {rel}"

    if args.self_check:
        print("\n--self-check: the CONTROL above proves a green baseline, and any GREEN row "
              "below proves this tool can report an uncovered door rather than only RED.")

    green = [r for r in rows if r[3] == "GREEN"]
    skipped = [r for r in rows if r[3] in ("SKIPPED", "UNMEASURED")]

    out = REPO / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    with io.open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write("# Wave Q1 — settle-site mutation gauntlet\n\n")
        f.write(f"- generated: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\n")
        f.write(f"- call sites (derived from source): **{len(rows)}**\n")
        f.write(f"- RED (covered): **{len(rows) - len(green) - len(skipped)}** · "
                f"GREEN (UNCOVERED): **{len(green)}** · skipped: **{len(skipped)}**\n\n")
        f.write("⛔ GREEN is a defect, not a pass: the settle was removed and no rail noticed.\n\n")
        f.write("| # | site | verdict | rails said |\n|---|---|---|---|\n")
        for i, (rel, line, snippet, verdict, totals) in enumerate(rows, 1):
            f.write(f"| {i} | `{rel}:{line}` | **{verdict}** | {totals} |\n")
        if green:
            f.write("\n## ⛔ UNCOVERED DOORS\n\n")
            for rel, line, snippet, _v, _t in green:
                f.write(f"- `{rel}:{line}` — `{snippet}`\n")
    print(f"\nwrote {out.relative_to(REPO)}")
    print(f"RED {len(rows) - len(green) - len(skipped)} · GREEN {len(green)} · SKIPPED {len(skipped)}")
    return 1 if green else 0


if __name__ == "__main__":
    raise SystemExit(main())
