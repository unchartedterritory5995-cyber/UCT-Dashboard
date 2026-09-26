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
    print("SELF-CHECK PASSED (4 cases, incl. the whole-row-search regression and "
          "a control proving the empty-parse guard fires)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--path", default=CHECKLIST)
    args = ap.parse_args()

    if args.self_check:
        return self_check()

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
