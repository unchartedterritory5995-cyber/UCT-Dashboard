"""Write a WEEKLY WISDOM REPORT preview to a file (stream S-F; docs/wisdom/CONTRACTS.md §6.6).

    python tools/wisdom/publish_report_preview.py --db <wisdom.db> --out <report.md>
        [--json <report.json>] [--week 2026-W38] [--persist]

--db and --out are required and are never defaulted. Before any api module is
imported, the repo-root conftest is imported: it derives the census of every
shared-data-root env var, pins each one to a sandbox, and arms the tripwire that
refuses writes into the shared data root. A --db or --out inside that root is
refused outright.

The preview is built from --db (the publish migrations are applied to it first;
they are additive CREATE ... IF NOT EXISTS only) and written to --out. Nothing is
delivered. --persist also stores the preview row in --db.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEEK_RE = re.compile(r"^\d{4}-W\d{2}$")


class RefusedPath(SystemExit):
    pass


def prepare_isolated_env(db_path: str, outputs: list) -> None:
    """Census pins + tripwire BEFORE any api import; refuse the shared data root.

    Shared by every tools/wisdom/publish_* script — keep ONE copy of this guard."""
    if REPO_ROOT not in sys.path:
        sys.path.insert(0, REPO_ROOT)
    import conftest  # noqa: F401  (import = census, redirect every pinned var, arm the tripwire)

    roots = [os.path.normcase(os.path.abspath(r)) for r in conftest.SHARED_DATA_ROOTS]
    for path in [db_path, *outputs]:
        norm = os.path.normcase(os.path.abspath(path))
        if any(norm == r or norm.startswith(r + os.sep) for r in roots):
            print(f"refusing {path}: it is inside the shared data root", file=sys.stderr)
            raise RefusedPath(2)
    os.environ["WISDOM_DB_PATH"] = os.path.abspath(db_path)


def _write_atomic(path: str, text: str) -> int:
    data = text.encode("utf-8")
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    tmp = os.path.abspath(path) + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(data)
    os.replace(tmp, path)
    return len(data)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--db", required=True, help="wisdom.db to read (explicit; never defaulted)")
    parser.add_argument("--out", required=True, help="markdown file to write")
    parser.add_argument("--json", dest="json_out", help="also write the report JSON here")
    parser.add_argument("--week", help="ISO week, e.g. 2026-W38 (default: the current week)")
    parser.add_argument("--persist", action="store_true", help="also store the preview row in --db")
    args = parser.parse_args(argv)
    if args.week and not WEEK_RE.match(args.week):
        print(f"--week must look like 2026-W38, got {args.week!r}", file=sys.stderr)
        return 2
    if not os.path.isfile(args.db):
        print(f"--db {args.db} does not exist", file=sys.stderr)
        return 2
    try:
        prepare_isolated_env(args.db, [args.out] + ([args.json_out] if args.json_out else []))
    except RefusedPath as exc:
        return int(exc.code)

    from api.services.wisdom.core import store
    from api.services.wisdom.publish import report

    store.init_db()
    out = report.generate_preview(week_key=args.week, persist=args.persist)
    written = _write_atomic(args.out, out["markdown"])
    if args.json_out:
        _write_atomic(args.json_out, json.dumps(out["report"], indent=2, default=str, ensure_ascii=False))
    errors = sorted(k for k, v in out["report"]["sections"].items() if isinstance(v, dict) and "error" in v)
    print(json.dumps({"report_id": out["report_id"], "period_key": out["period_key"], "out": args.out,
                      "bytes": written, "persisted": bool(args.persist), "section_errors": errors}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
