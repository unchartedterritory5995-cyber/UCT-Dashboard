"""Study -- retire (reject) a list of draft items on the live Study DB.

WHY
---
The import route upserts by item id and never deletes, so an item the bank
no longer carries stays on the pod as a draft. An audit that CUTS items
therefore needs a second step: reject each cut id, the same action as the
Reject button on the review screen (`study_store.review(..., "reject")`,
logged to study_corrections, trust counter reset like any reject).

SAFETY
------
* Only items still in DRAFT are retired. An item the owner already approved
  (or fixed, or rejected) is skipped and named, never overwritten.
* It refuses to run off the pod unless STUDY_DB_PATH is set explicitly, so a
  local run can never reach the dev box's C:/data/study.db.
* Re-runs are safe: a retired item is no longer a draft, so it is skipped.

HOW TO RUN (on the pod, from PowerShell)
----------------------------------------
  railway ssh --service web -- /opt/venv/bin/python scripts/study/retire_ids.py docs/study/audits/2026-10-21/retire_batch1.json --dry-run
  railway ssh --service web -- /opt/venv/bin/python scripts/study/retire_ids.py docs/study/audits/2026-10-21/retire_batch1.json

The file is {"why": "...", "ids": {"<segment>": ["si_...", ...]}} or a plain
list of ids. `why` becomes the reject reason.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
_POD_ENV = ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_SERVICE_ID", "RAILWAY_PROJECT_ID")


def load_ids(path: pathlib.Path) -> tuple[list[str], str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return [str(i) for i in data], ""
    ids = data.get("ids")
    if isinstance(ids, dict):
        flat = [str(i) for seg in ids.values() for i in seg]
    else:
        flat = [str(i) for i in (ids or [])]
    return flat, str(data.get("why") or "")


def retire(ids: list[str], reason: str, by: str, *, dry_run: bool = False) -> dict:
    from api.services import study_store as ss
    out = {"retired": [], "not_draft": [], "unknown": [], "duplicate": []}
    seen: set[str] = set()
    for iid in ids:
        if iid in seen:
            out["duplicate"].append(iid)
            continue
        seen.add(iid)
        row = ss.get_item_full(iid)
        if row is None:
            out["unknown"].append(iid)
            continue
        status = row.get("review_status") or ss.STATUS_DRAFT
        if status != ss.STATUS_DRAFT:
            out["not_draft"].append(f"{iid}:{status}")
            continue
        if not dry_run:
            ss.review(iid, "reject", by, reason=reason or None)
        out["retired"].append(iid)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file", help="JSON file of ids (see the module docstring)")
    ap.add_argument("--reason", default=None, help="reject reason (default: the file's `why`)")
    ap.add_argument("--by", default="study audit (owner-delegated)", help="reviewed_by stamp")
    ap.add_argument("--dry-run", action="store_true", help="count what would be retired, write nothing")
    args = ap.parse_args(argv)

    if not os.environ.get("STUDY_DB_PATH") and not any(os.environ.get(k) for k in _POD_ENV):
        print("refusing: not on the pod and STUDY_DB_PATH is not set (this would open the dev box's live data)")
        return 2
    path = pathlib.Path(args.file)
    if not path.is_absolute():
        path = REPO / path
    ids, why = load_ids(path)
    if str(REPO) not in sys.path:
        sys.path.insert(0, str(REPO))
    out = retire(ids, args.reason or why, args.by, dry_run=args.dry_run)
    verb = "would retire" if args.dry_run else "retired"
    print(f"{len(ids)} ids read: {verb} {len(out['retired'])}, not a draft {len(out['not_draft'])}, "
          f"unknown {len(out['unknown'])}, duplicate {len(out['duplicate'])}")
    for k in ("not_draft", "unknown", "duplicate"):
        if out[k]:
            print(f"  {k}: {', '.join(out[k][:40])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
