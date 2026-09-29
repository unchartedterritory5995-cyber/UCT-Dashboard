#!/usr/bin/env python3
"""TERM-091 — load docs/curriculum/ into the education store (edu_lessons), or reverse it.

Usage:
    python scripts/load_edu_curriculum.py --dry-run      # build rows, print counts, write nothing
    python scripts/load_edu_curriculum.py                # upsert (needs EDU_CURRICULUM_ENABLED=1)
    python scripts/load_edu_curriculum.py --unload       # THE REVERSAL: delete source='curriculum' rows

The target database is `EDUCATION_DB_PATH` (default /data/education.db, the web
pod's volume). ⛔ On the dev box `/data` resolves to the LIVE `C:\\data`, so set
EDUCATION_DB_PATH to a scratch file for any local run.

The load is DARK: it refuses unless EDU_CURRICULUM_ENABLED is on (or --force is
passed). The reversal is never refused — undo must not depend on the switch.
Every count printed here is measured (from the source JSON or the table), never typed.
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services import education_curriculum as ec  # noqa: E402
from api.services import education_service as es  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true", help="build and count; write nothing")
    ap.add_argument("--unload", action="store_true", help="delete every source='curriculum' row")
    ap.add_argument("--force", action="store_true", help="load even when the flag is off")
    args = ap.parse_args(argv)

    print(f"education db: {es._DB_PATH}")
    if args.unload:
        deleted = ec.unload()
        print(f"unloaded: {deleted} row(s) with source='{ec.SOURCE}' deleted; no other table touched")
        return 0

    rows = ec.build_rows()
    lessons = sum(1 for r in rows if r["kind"] == "lesson")
    artifacts = sum(1 for r in rows if r["kind"] == "artifact")
    attributed = sum(1 for r in rows if r["attribution"])
    census = ec.census(rows)
    print(f"source rows: {len(rows)} ({lessons} lessons, {artifacts} artifacts)")
    print(f"attributed (a third-party rule fired): {attributed} of {len(rows)}")
    print("spec_verdict census: " + ", ".join(f"{k}={v}" for k, v in census.items()))
    if args.dry_run:
        print("dry run: nothing written")
        return 0
    if not (ec.is_enabled() or args.force):
        print(f"REFUSED: {ec.FLAG} is off. Set it (or pass --force) to load.")
        return 2
    result = ec.load()
    print("loaded: " + ", ".join(f"{k}={v}" for k, v in result.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
