"""Re-measure the ENGINE setup strings against the vocabulary maps (W1 §3.2).

    python tools/wisdom/core_vocab_engine_check.py --engine-db C:/Users/Patrick/uct-intelligence/data/uct_intelligence.db

setup_triggers.setup_name, leadership_snapshots.setup_type and setup_templates.name live in
the uct-intelligence database, not in this repository, so CI cannot derive them. This tool
opens that database READ-ONLY (sqlite URI mode=ro), lists every distinct non-blank string,
and names each one with no row in docs/wisdom/vocabulary/setup-vocabulary-v1.json.

Exit 0 = every string has a row. Exit 1 = unmapped strings, named. Exit 2 = the database or
a table could not be read (never reported as a pass). Standard library only; writes nothing.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sqlite3
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
VOCAB_FILE = REPO / "docs" / "wisdom" / "vocabulary" / "setup-vocabulary-v1.json"
ENGINE_LISTS = {
    "engine_setup_triggers": "SELECT DISTINCT setup_name FROM setup_triggers",
    "engine_leadership_setup_type": "SELECT DISTINCT setup_type FROM leadership_snapshots",
    "engine_setup_templates": "SELECT DISTINCT name FROM setup_templates",
}


def unmapped(engine_db: str, vocab_file: pathlib.Path = VOCAB_FILE) -> tuple[dict, dict]:
    """({list_name: [unmapped strings]}, {list_name: distinct strings read})."""
    maps = json.loads(vocab_file.read_text(encoding="utf-8"))["maps"]
    uri = pathlib.Path(engine_db).resolve().as_uri() + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    try:
        missing, seen = {}, {}
        for list_name, sql in ENGINE_LISTS.items():
            strings = sorted({(r[0] or "").strip() for r in conn.execute(sql)} - {""})
            rows = {row["external_name"] for row in maps.get(list_name, {}).get("rows", [])}
            seen[list_name] = len(strings)
            missing[list_name] = [s for s in strings if s not in rows]
        return missing, seen
    finally:
        conn.close()


def main(argv=None) -> int:
    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if reconfigure is not None:  # ENGINE strings are free text; cp1252 cannot print all of them
        reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="ENGINE setup strings vs the vocabulary maps")
    parser.add_argument("--engine-db", required=True, help="path to uct_intelligence.db (opened read-only)")
    args = parser.parse_args(argv)
    if not pathlib.Path(args.engine_db).is_file():
        print(f"INCONCLUSIVE: {args.engine_db} does not exist")
        return 2
    try:
        missing, seen = unmapped(args.engine_db)
    except sqlite3.Error as exc:
        print(f"INCONCLUSIVE: cannot read the ENGINE database ({type(exc).__name__}: {exc})")
        return 2
    for list_name, strings in missing.items():
        print(f"{list_name}: {seen[list_name]} distinct, {len(strings)} without a map row")
        for value in strings:
            print(f"    UNMAPPED {value!r}")
    if not any(seen.values()):
        print("INCONCLUSIVE: every ENGINE list read empty")
        return 2
    return 1 if any(missing.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
