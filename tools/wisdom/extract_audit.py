"""The weekly 50-segment extraction audit, on demand (W1 §6.5).

Calls the same extract.audit.run_audit the weekly chain calls. DRY RUN BY DEFAULT:
samples last week's extracted segments and prints what would be submitted and its
budget estimate, with no API call. --submit spends (Batch, one effort level deeper
than extraction) and needs ANTHROPIC_API_KEY; --reap handles ended audit batches,
turning disagreements into review-queue items (tab extraction_audit).

    python tools/wisdom/extract_audit.py --db <path to wisdom.db>            # dry run
    python tools/wisdom/extract_audit.py --db <path> --submit
    python tools/wisdom/extract_audit.py --db <path> --reap
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import extract_common as common  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", required=True)
    ap.add_argument("--n", type=int, default=50)
    ap.add_argument("--submit", action="store_true")
    ap.add_argument("--reap", action="store_true")
    args = ap.parse_args()
    common.bootstrap(args.db)
    from api.services.wisdom.core import store
    from api.services.wisdom.extract import audit, batch

    store.init_db()
    if args.reap:
        out = batch.reap(common.job_context(dry_run=False))
    else:
        out = audit.run_audit(common.job_context(dry_run=not args.submit), n=args.n)
    with store.read() as conn:
        out["open_review_items"] = conn.execute(
            "SELECT COUNT(*) FROM wisdom_review_queue WHERE tab = 'extraction_audit' AND status = 'open'").fetchone()[0]
    print(json.dumps(out, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
