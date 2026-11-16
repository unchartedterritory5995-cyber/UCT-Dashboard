"""Study -- put APPROVED items back on the owner's review list, unchanged, with a reason (run ON the web pod).

WHY
---
The import keeps an item's approval when only its content changes (study_store.upsert_items at the same version). When
a change is one the owner should see before members do (2026-11-16: a real index chart added to a question he may
already have approved), this sends the item back: study_store.fix with the item's own lesson_text, unchanged, which
logs a correction, bumps the version and sets the item to draft, so it leaves members' sessions and shows on the review
screen again. Only APPROVED items are touched; a draft or rejected one is counted and left alone. Nothing else changes.

    railway ssh --service web -- /opt/venv/bin/python scripts/study/back_to_review.py --reason "<why>" --ids si_a,si_b [--dry-run]
    (or --bank-chart-source index: every course item in the bank whose chart is an index chart)
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))


def bank_ids_with_chart_source(source: str, bank_dir: pathlib.Path = REPO / "docs" / "study" / "bank") -> list[str]:
    out = []
    for p in sorted(bank_dir.glob("course.*.json")):
        for it in json.loads(p.read_text(encoding="utf-8")):
            if (it.get("bars") or {}).get("source") == source:
                out.append(it["id"])
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--reason", required=True)
    ap.add_argument("--ids", default="", help="comma-separated item ids")
    ap.add_argument("--bank-chart-source", default="", help="every bank course item whose chart has this source (index)")
    ap.add_argument("--by", default="session (back to review)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    from api.services import study_store
    ids = [x.strip() for x in args.ids.split(",") if x.strip()]
    if args.bank_chart_source:
        ids += bank_ids_with_chart_source(args.bank_chart_source)
    out = {"dry_run": args.dry_run, "asked": len(ids), "moved": [], "not_approved": 0, "missing": []}
    for iid in dict.fromkeys(ids):
        it = study_store.get_item_full(iid)
        if not it:
            out["missing"].append(iid)
            continue
        if it.get("review_status") != study_store.STATUS_APPROVED:
            out["not_approved"] += 1
            continue
        if not args.dry_run:
            study_store.fix(iid, args.by, "lesson_text", it.get("lesson_text"), reason=args.reason)
        out["moved"].append(iid)
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
