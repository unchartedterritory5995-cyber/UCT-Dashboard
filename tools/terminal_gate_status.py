#!/usr/bin/env python
"""Derive the UCT Terminal gate tally from MASTER_CHECKLIST.md. Never type it.

WHY THIS EXISTS. On 2026-09-26 this session reported "6 gate items remain" to the
owner. Thirteen remained. The number was carried in a head across a summary
boundary instead of being read off the artifact -- which is the defect this whole
programme records against everyone else (a hand-typed count beside the list it
describes). A tally that takes one command cannot go stale between reports.

THE ONE SUBTLETY, and it is the thing that produced a WRONG answer once already:
the status lives in the LAST pipe-delimited cell, and the earlier cells routinely
contain status-shaped words. A row whose notes mention "NOT STARTED" while its
status cell says "DRAFT COMPLETE" must bucket as DRAFT COMPLETE. An earlier
hand-run of this logic searched whole ROWS and reported 13 accepted / 6 drafted
against a true 11 / 11. So: read the last cell, and carry a control proving a
status word in a NON-final cell does not move the bucket.

Usage:
    python tools/terminal_gate_status.py
    python tools/terminal_gate_status.py --json
    python tools/terminal_gate_status.py --self-check   # proves it can FAIL
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys

CHECKLIST = os.path.join(
    "docs", "terminal-research", "00-program-control", "MASTER_CHECKLIST.md")

ROW = re.compile(r"^\|\s*(\d+)\s*\|")

# ⛔ ORDER IS MOST-SPECIFIC-FIRST, AND EACH BUCKET'S NEEDLES ARE CONSUMED FROM THE
# WORKING STRING WHEN THEY MATCH. Without that, the needles overlap by
# construction -- "DRAFT COMPLETE" contains "DRAFT", so every finished row also
# matched DRAFTED (other) and 17 rows were reported AMBIGUOUS when nothing about
# them was ambiguous. Consuming the specific phrase first means a second hit is a
# genuinely different status word, which is the only thing worth flagging.
BUCKETS = (
    ("NOT STARTED", ("NOT STARTED",)),
    ("DRAFT COMPLETE", ("CANONICAL PASS DRAFT COMPLETE", "DRAFT COMPLETE")),
    ("DRAFTED (other)", ("PARTIALLY SATISFIED", "PROVISIO", "DRAFTED", "DRAFT")),
    ("ACCEPTED", ("ACCEPT",)),
)


def split_cells(line: str) -> list[str]:
    """Markdown row -> its cells, outer pipes stripped."""
    return [c.strip() for c in line.strip().strip("|").split("|")]


def classify(status_cell: str) -> str:
    """Bucket a status cell, or refuse to.

    ⛔ THE TRAP THIS REFUSES TO FALL INTO, measured 2026-09-26. Many cells carry
    MORE THAN ONE status word -- "Raw inventory ACCEPTED ...; canonical pass NOT
    STARTED", or a NOT STARTED that a later edit appended DRAFT COMPLETE beside.
    A first-match-wins classifier then answers whatever its own BUCKETS order
    happens to be, and two runs over identical bytes disagreed on rows 15, 22 and
    24 purely because the order changed between them.

    So multiplicity is reported, never resolved: an ambiguous cell is a cell a
    human must read, and "I cannot compute this" is a different fact from "it is
    not started". Silently picking one is how a tally becomes confidently wrong.
    """
    work = status_cell.upper()
    hits = []
    for name, needles in BUCKETS:
        matched = False
        for n in needles:
            if n in work:
                work = work.replace(n, " ")   # consume it, so "DRAFT COMPLETE"
                matched = True                # cannot also satisfy bare "DRAFT"
        if matched:
            hits.append(name)
    if not hits:
        return "UNCLASSIFIED"
    if len(hits) > 1:
        return "AMBIGUOUS: " + " + ".join(hits)
    return hits[0]


def parse(text: str) -> tuple[list[dict], list[str]]:
    """Return (rows, anomalies). Anomalies are reported, never swallowed."""
    rows: list[dict] = []
    anomalies: list[str] = []
    widths: dict[int, int] = {}
    for line in text.splitlines():
        if not ROW.match(line):
            continue
        cells = split_cells(line)
        if len(cells) < 3:
            anomalies.append(f"row {cells[0] if cells else '?'}: only {len(cells)} cells")
            continue
        num = int(cells[0])
        widths[num] = len(cells)
        rows.append({
            "item": num,
            "name": cells[1],
            "status_cell": cells[-1],
            "bucket": classify(cells[-1]),
            "cells": len(cells),
        })
    # A cell containing a literal '|' would silently shift the status cell, so
    # flag rows whose width is not the modal width rather than trusting them.
    if widths:
        modal = max(set(widths.values()), key=list(widths.values()).count)
        for num, w in sorted(widths.items()):
            if w != modal:
                anomalies.append(
                    f"row {num}: {w} cells, modal is {modal} -- a literal '|' in a "
                    f"cell would move the status cell; verify this row by eye")
    return rows, anomalies


def report(rows: list[dict], anomalies: list[str]) -> int:
    # NON-VACUITY CONTROL: an empty parse satisfies every count below, so a
    # broken read must fail loudly instead of reporting a tidy set of zeroes.
    if len(rows) < 20:
        print(f"FAIL: parsed only {len(rows)} numbered rows -- this checklist has "
              f"dozens. A filter matching nothing is a broken invocation, not a "
              f"finding.", file=sys.stderr)
        return 2

    by: dict[str, list[int]] = {}
    for r in rows:
        by.setdefault(r["bucket"], []).append(r["item"])

    print(f"MASTER_CHECKLIST rows parsed: {len(rows)}")

    known = [b[0] for b in BUCKETS]
    ambiguous = sorted(k for k in by if k.startswith("AMBIGUOUS"))
    order = known + ambiguous + ["UNCLASSIFIED"]

    delivered = 0
    for name in order:
        items = sorted(by.get(name, []))
        if not items:
            continue
        if name not in ("NOT STARTED", "UNCLASSIFIED") and not name.startswith("AMBIGUOUS"):
            delivered += len(items)
        print(f"\n{name} ({len(items)})")
        print("  " + ", ".join(str(i) for i in items))

    amb_items = sorted(i for k in ambiguous for i in by[k])
    unresolved = amb_items + sorted(by.get("UNCLASSIFIED", []))
    print(f"\nUNAMBIGUOUSLY DELIVERED: {delivered}"
          f"   |   NOT STARTED: {len(by.get('NOT STARTED', []))}"
          f"   |   NEEDS EYES: {len(unresolved)}")
    print(f"   {delivered} + {len(by.get('NOT STARTED', []))} + {len(unresolved)}"
          f" = {delivered + len(by.get('NOT STARTED', [])) + len(unresolved)}"
          f" of {len(rows)} rows"
          f"   <- must equal the row count, or a bucket is being dropped")

    if unresolved:
        print(f"\n⛔ {len(unresolved)} row(s) carry more than one status word, or none "
              f"this tool knows: {', '.join(str(i) for i in unresolved)}. These are "
              f"NOT counted as delivered and NOT counted as not-started -- read them "
              f"by eye. Reporting a total that quietly picks one reading is the "
              f"defect this tool exists to prevent.", file=sys.stderr)
    for a in anomalies:
        print(f"ANOMALY: {a}", file=sys.stderr)
    return 0


def audit_counts(text: str, resolve=None) -> list[str]:
    """Compare line/byte counts QUOTED in a status cell against the real file.

    ⛔ WHY. The status cells are hand-written prose, and I quoted a stale figure
    in them TWICE in one session: row 14 carried a break-out shape that a later
    correction had moved, and row 17 attributed a count to the wrong document.
    Both survived review because nothing re-derived them. This turns the
    programme's own "derive, never restate" rule on its own index.

    Only LINE and BYTE counts are checked, because those are the two figures a
    file can answer for itself. Item counts inside a document (jobs, workflows,
    tickets) are the document's own to derive and are deliberately out of scope
    -- a check that guesses at them would cry wolf and get muted.

    ⭐ HOW IT TELLS A SELF-DESCRIPTION FROM A QUOTE ABOUT ANOTHER FILE, which is
    the whole difficulty. First pass reported 9 hits of which only 4 were real:
    the rest were `rollout.py` (347 lines), a deleted component's "~320 lines",
    `api/main.py` at 11,066, a "+4 lines" delta, and a retracted "first said 317
    lines". Reporting all nine as stale would be the instrument describing
    itself. But the distinction IS derivable, because the rows obey a convention:

      THE SELF-DESCRIPTION IS THE **FIRST** LINE COUNT AND THE **FIRST** BYTE
      COUNT IN THE CELL. Everything later is commentary -- a delta, a retraction,
      or another artifact's size.

    Two belt-and-braces guards on top, so a row that breaks the convention is
    SKIPPED rather than misread: a count prefixed `~` or `+` is approximate or a
    delta, and a count whose nearest preceding backticked token is a DIFFERENT
    file is about that file.
    """
    # "1,597 lines" / "123,825 bytes" — thousands separators optional.
    LINES = re.compile(r"([\d,]+)\s+lines\b")
    BYTES = re.compile(r"([\d,]+)\s+bytes\b")
    PATH = re.compile(r"`([^`]+\.md)`")

    def _default_resolve(rel: str):
        p = os.path.join("docs", "terminal-research", rel)
        if not os.path.exists(p):
            return None
        raw = io.open(p, "rb").read()
        return raw.count(b"\n"), len(raw)

    resolve = resolve or _default_resolve
    out: list[str] = []
    for line in text.splitlines():
        m = ROW.match(line)
        if not m:
            continue
        item = m.group(1)
        cells = split_cells(line)
        if len(cells) < 3:
            continue
        status = cells[-1]
        paths = PATH.findall(cells[3]) if len(cells) > 3 else []
        # A glob (ADR-*.md) or a multi-path row cannot be resolved to one file.
        paths = [p for p in paths if "*" not in p]
        if len(paths) != 1:
            continue
        got = resolve(paths[0])
        if got is None:
            continue
        real_lines, real_bytes = got
        own = os.path.basename(paths[0])
        for rx, label, real in ((LINES, "lines", real_lines), (BYTES, "bytes", real_bytes)):
            m2 = rx.search(status)          # FIRST match only — later ones are commentary
            if not m2:
                continue
            before = status[:m2.start()]
            # Guard 1: approximate or a delta, so not a self-description.
            if before.rstrip().endswith(("~", "+")):
                continue
            # Guard 2: the nearest preceding backticked token names another file.
            ticks = re.findall(r"`([^`]+)`", before[-60:])
            if ticks and re.search(r"\.(py|js|jsx|md|json)\b", ticks[-1]) \
                    and os.path.basename(ticks[-1].split(":")[0]) != own:
                continue
            claimed = int(m2.group(1).replace(",", ""))
            if claimed != real:
                out.append(f"row {item} ({paths[0]}): status cell says "
                           f"{claimed:,} {label}, file has {real:,}")
    return out


def self_check() -> int:
    """Prove the tool can fail, and that it reads the LAST cell.

    Case 1 is the real regression: a row whose NOTES say "NOT STARTED" while its
    status cell says DRAFT COMPLETE. A whole-row search buckets it wrong, which
    is exactly the mistake this file exists to prevent.
    """
    failures = []

    row = ("| 7 | Some Item | 9 | `x.md` | F-05 | was NOT STARTED before this "
           "file | DRAFT COMPLETE 2026-09-26 -- 800 lines |")
    rows, _ = parse(row)
    if not rows or rows[0]["bucket"] != "DRAFT COMPLETE":
        failures.append(f"case 1: status-word in a non-final cell moved the bucket "
                        f"-> {rows[0]['bucket'] if rows else 'no row parsed'}")

    rows, _ = parse("| 3 | Item | 1 | `y.md` | A-01 | NOT STARTED |")
    if not rows or rows[0]["bucket"] != "NOT STARTED":
        failures.append("case 2: a genuine NOT STARTED row was not classified")

    # The non-vacuity control must actually fire on an empty parse.
    if report([], []) != 2:
        failures.append("case 3: an empty parse did not fail -- the control is inert")

    # THE REGRESSION THAT PROMPTED THE REWRITE: a cell carrying two status words
    # must come back AMBIGUOUS. A first-match-wins classifier answers whichever
    # bucket it happens to check first, and two runs over identical bytes
    # disagreed on three real rows for exactly that reason.
    both = ("| 15 | Item | 11 | `z.md` | F-05 | Raw inventory ACCEPTED (D-13); "
            "canonical pass NOT STARTED |")
    rows, _ = parse(both)
    got = rows[0]["bucket"] if rows else "no row parsed"
    if not got.startswith("AMBIGUOUS"):
        failures.append(f"case 5: a cell with two status words resolved to {got!r} "
                        f"instead of refusing -- ordering now decides the tally")

    # (No report() assertion on a one-row fixture: it would trip the <20-row
    # non-vacuity guard above, which is correct behaviour, not a failure.)

    # --audit-counts must catch a stale quoted figure, and must NOT fire on a
    # correct one. Fixture pair, so the check cannot pass by answering "no".
    hit = audit_counts(
        "| 9 | X | 1 | `a.md` | F | DRAFT COMPLETE -- 100 lines, 200 bytes |",
        resolve=lambda _p: (999, 200))          # lines disagree, bytes agree
    if not any("lines" in m for m in hit):
        failures.append("case 7: a stale LINE count was not reported")
    if any("bytes" in m for m in hit):
        failures.append("case 7: a CORRECT byte count was reported as stale")

    quiet = audit_counts(
        "| 9 | X | 1 | `a.md` | F | DRAFT COMPLETE -- 100 lines, 200 bytes |",
        resolve=lambda _p: (100, 200))
    if quiet:
        failures.append(f"case 8: correct counts were reported as stale -> {quiet}")

    # ⛔ THE DISCRIMINATOR CASES. Each is a REAL shape from the live checklist
    # that the first version of this check misreported as stale. They must all
    # be quiet while the first count is correct.
    for label, cell in (
        ("a later retraction", "**100 lines**. This row first said 317 lines, because"),
        ("a delta in parentheses", "100 lines, 200 bytes (98/190 as authored; +4 lines from"),
        ("another file's size", "100 lines, 200 bytes -- and `rollout.py` (347 lines) ships"),
        ("an approximate size", "100 lines -- records `DrillModal` (~320 lines) as DELETED"),
        ("a path with a line number", "100 lines -- `api/main.py:8830` at 11,066 lines against"),
    ):
        got2 = audit_counts(f"| 9 | X | 1 | `a.md` | F | {cell} |",
                            resolve=lambda _p: (100, 200))
        if got2:
            failures.append(f"case 9 ({label}): reported {got2} — the first count "
                            f"was correct, so this cell must be quiet")

    # ...and the convention must still CATCH a stale FIRST count even when a
    # correct-looking number follows it, or the rule has just muted the check.
    caught = audit_counts(
        "| 9 | X | 1 | `a.md` | F | 999 lines, 200 bytes (`other.py` 100 lines) |",
        resolve=lambda _p: (100, 200))
    if not any("lines" in m for m in caught):
        failures.append("case 10: a stale FIRST count was missed — the "
                        "first-match rule has muted the check")

    # A literal pipe inside a cell must be reported, not silently trusted.
    two = ("| 1 | A | 1 | `a.md` | X | NOT STARTED |\n"
           "| 2 | B | 1 | `b.md` | X | DRAFT COMPLETE |\n"
           "| 3 | C | 1 | `c.md` | X | DRAFT | COMPLETE |\n")
    _, anomalies = parse(two)
    if not any("row 3" in a for a in anomalies):
        failures.append("case 4: an off-width row was not flagged as an anomaly")

    if failures:
        print("SELF-CHECK FAILED:", file=sys.stderr)
        for f in failures:
            print("  - " + f, file=sys.stderr)
        return 1
    # ⛔ No count in this message. It read "(4 cases ...)" while the function had
    # grown to seven checks -- a hand-typed count beside the list it describes,
    # in the tool written to stop exactly that. Describe, do not tally.
    print("SELF-CHECK PASSED -- incl. the whole-row-search regression, the "
          "ordering-dependence regression, a control proving the empty-parse "
          "guard fires, and a fixture PAIR proving --audit-counts reports a "
          "stale figure and stays quiet on a correct one")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--audit-counts", action="store_true",
                    help="re-derive every line/byte count QUOTED in a status cell")
    ap.add_argument("--path", default=CHECKLIST)
    args = ap.parse_args()

    if args.self_check:
        return self_check()

    if args.audit_counts:
        if not os.path.exists(args.path):
            print(f"FAIL: {args.path} not found -- run from the repo root.",
                  file=sys.stderr)
            return 2
        text = io.open(args.path, encoding="utf-8").read()
        rows, _ = parse(text)
        if len(rows) < 20:
            print(f"FAIL: parsed only {len(rows)} rows", file=sys.stderr)
            return 2
        stale = audit_counts(text)
        if not stale:
            print(f"OK -- every line/byte count quoted in a status cell matches "
                  f"its file ({len(rows)} rows scanned).")
            return 0
        # These ARE findings, not candidates: the first-count convention plus the
        # two guards resolve every shape the live checklist actually contains,
        # and the self-check pins all five of them. ⚠️ The honest residual is the
        # other direction: a row that breaks the convention -- one whose cell
        # opens by discussing a different file -- is SKIPPED, not misread. So
        # this check under-reports rather than crying wolf, which is the correct
        # way round for something that runs unattended.
        print(f"STALE QUOTED COUNT(S) ({len(stale)}) -- a status cell's own "
              f"line/byte figure disagrees with the file it names:",
              file=sys.stderr)
        for s in stale:
            print("  " + s, file=sys.stderr)
        return 1

    if not os.path.exists(args.path):
        print(f"FAIL: {args.path} not found -- run from the repo root.",
              file=sys.stderr)
        return 2
    text = io.open(args.path, encoding="utf-8").read()
    rows, anomalies = parse(text)

    if args.json:
        if len(rows) < 20:
            print(f"FAIL: parsed only {len(rows)} rows", file=sys.stderr)
            return 2
        out = {
            "rows": len(rows),
            "buckets": {},
            "anomalies": anomalies,
        }
        for r in rows:
            out["buckets"].setdefault(r["bucket"], []).append(r["item"])
        for v in out["buckets"].values():
            v.sort()
        print(json.dumps(out, indent=2))
        return 0

    return report(rows, anomalies)


if __name__ == "__main__":
    sys.exit(main())
