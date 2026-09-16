#!/usr/bin/env python
"""The 42-pair hand check: build the sheet, then read the verdicts back. ⛔ Writes NOTHING to the store.

⭐ WHY THE SHEET NEEDS REBUILDING. The pairs file identified each side by `principle_key`, which is
`p_` + a sha24 — so a human opening it saw two hashes and could not possibly judge whether they are
the same principle. This rebuilds it with the STATEMENTS beside the keys, one pair per line, with a
blank verdict column.

⛔⛔ THE SHEET IS QUOTE-BEARING AND STAYS GITIGNORED. It carries extracted statements, which is
exactly what §0.4f keeps out of git — `data/wisdom/` only. Nothing here ever prints a statement to
a terminal a report is written from: `--build` reports a row count and `--read` reports counts and
pair ids. If you want to see the text, open the file.

Usage (desktop):
    python tools/wisdom/pair_verdicts.py --build          # writes the .tsv sheet, prints the count
    ... open the .tsv, put Y or N in the `verdict` column, save ...
    python tools/wisdom/pair_verdicts.py --read           # counts only, and what a revert implies
"""
from __future__ import annotations

import argparse
import csv
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

STUDY_DIR = REPO / "data" / "wisdom" / "identity-study"
RUNS_ROOT = REPO / "data" / "wisdom" / "gate-runs"
COLUMNS = ("pair_id", "verdict", "jaccard", "segment_id", "key_a", "key_b", "statement_a", "statement_b")

#: Y = the two sides are the same principle (the merge was right).
#: N = they are different principles (an OVER-MERGE).
YES, NO = "Y", "N"


def _one_line(text: str) -> str:
    """Collapse whitespace so one pair is one row in a spreadsheet. ⛔ Never truncated — a clipped
    statement is a statement a human would judge on half the evidence."""
    return re.sub(r"\s+", " ", str(text or "")).strip()


def statements_by_key(rtype: str = "PRINCIPLE") -> dict:
    """principle_key -> its statement, from the persisted runs. First run that carries it wins."""
    out: dict = {}
    for run_dir in sorted(RUNS_ROOT.iterdir()):
        records = run_dir / "records.jsonl"
        if not records.exists():
            continue
        for line in records.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("record_type") != rtype:
                continue
            key = row.get("principle_key")
            if not key or key in out:
                continue
            fields = row.get("fields") or {}
            principle = fields.get("principle") if isinstance(fields, dict) else None
            if isinstance(principle, dict):
                out[key] = _one_line(principle.get("statement"))
    return out


def build(source: pathlib.Path, sheet: pathlib.Path) -> int:
    pairs = [json.loads(l) for l in source.read_text(encoding="utf-8").splitlines() if l.strip()]
    lookup = statements_by_key()
    missing = 0
    with sheet.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=COLUMNS, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        for i, pair in enumerate(pairs, start=1):
            a, b = pair.get("key_a"), pair.get("key_b")
            sa, sb = lookup.get(a, ""), lookup.get(b, "")
            missing += (not sa) + (not sb)
            writer.writerow({"pair_id": i, "verdict": "", "jaccard": pair.get("jaccard", ""),
                             "segment_id": pair.get("segment_id", ""), "key_a": a, "key_b": b,
                             "statement_a": sa, "statement_b": sb})
    if missing:
        # ⛔ A blank statement is a pair nobody can judge. Say so rather than shipping a sheet
        # with silent gaps in it.
        print(f"⚠️  {missing} statement(s) could not be resolved from the persisted runs — "
              f"those rows are judgeable only by key.")
    return len(pairs)


def read(sheet: pathlib.Path) -> dict:
    rows = list(csv.DictReader(sheet.open(encoding="utf-8"), delimiter="\t"))
    verdicts = [(r["pair_id"], (r.get("verdict") or "").strip().upper()) for r in rows]
    yes = [p for p, v in verdicts if v == YES]
    no = [p for p, v in verdicts if v == NO]
    blank = [p for p, v in verdicts if v not in (YES, NO)]
    return {"rows": len(rows), "same_principle": len(yes), "over_merged": len(no),
            "unjudged": len(blank), "over_merged_pair_ids": no}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default=str(STUDY_DIR / "lens-principle-pairs.jsonl"))
    ap.add_argument("--sheet", default=str(STUDY_DIR / "lens-principle-HANDCHECK.tsv"))
    ap.add_argument("--build", action="store_true")
    ap.add_argument("--read", action="store_true")
    args = ap.parse_args()

    sheet = pathlib.Path(args.sheet)
    if args.build:
        n = build(pathlib.Path(args.source), sheet)
        print(f"wrote {sheet} — {n} pairs, one per row, verdict column blank")
        print("   put Y (same principle) or N (over-merge) in `verdict`, save, then --read")
        return 0

    if args.read:
        if not sheet.exists():
            print(f"INCONCLUSIVE: no sheet at {sheet} — run --build first")
            return 2
        out = read(sheet)
        print(json.dumps({k: v for k, v in out.items() if k != "over_merged_pair_ids"}, indent=1))
        if out["unjudged"]:
            print(f"\n{out['unjudged']} pair(s) still blank — the check is not finished.")
        if out["over_merged"]:
            # ⛔ Counts and pair ids only. The report may quote these; it may never quote a row.
            print(f"\n⛔ {out['over_merged']} OVER-MERGE(S) — pair ids {out['over_merged_pair_ids']}.")
            print("   The lens over-merged at least once, so PRINCIPLE should revert:")
            print('     api/services/wisdom/extract/reconcile.py  PRINCIPLE_IDENTITY = "KEY"')
            print("   That restores 31 publishable PRINCIPLE records (from 66). ⛔ This tool writes")
            print("   nothing — the revert is yours to make.")
        elif not out["unjudged"]:
            print("\n✅ No over-merge found. LENS_STRICT_06 stands on the hand check as well as the"
                  " graded 13/13.")
        return 0

    ap.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
