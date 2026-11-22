"""Write each symbol's split table into its index.

    python tools/history_lake/stamp_splits.py --lake D:/uct-history/lake \
        --splits D:/uct-history/ref/splits.json --as-of 2026-11-13

Pieces are RAW. A reader adjusts them with the symbol's split table (factors.py, and adjust.js in
the browser), which it finds in the symbol's index as

    "splits": [["2020-08-31", 4.0], ...]        ascending, executed splits only, [] when none
    "splits_as_of": "2026-11-13"                the last date whose splits count as executed

so one small request carries everything needed, and a new split changes one index and no piece.
`--splits` is the vendor's split reference saved as {"rows": [{ticker, execution_date, split_from,
split_to}, ...]}. An index is rewritten only when its two fields change; the builder and the merge
tool keep fields they do not own. Running it again with a later `--as-of` is the daily update.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import List, Optional

try:
    from . import factors, piece
    from .build import BuildError, _json_bytes, _write_atomic
except ImportError:  # script mode
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import factors  # type: ignore[no-redef]
    import piece  # type: ignore[no-redef]
    from build import BuildError, _json_bytes, _write_atomic  # type: ignore[no-redef]

VDIR = f"v{piece.FORMAT_VERSION}"


def stamp(lake: Path, rows, as_of: str, *, log=print) -> dict:
    """Stamp every index under `lake`. Returns counts."""
    lake = Path(lake)
    idx_dir = lake / VDIR / "index"
    if not idx_dir.is_dir():
        raise BuildError(f"{lake} is not a history-lake tree (no {VDIR}/index/)")
    if (lake / "build.lock").exists():
        raise BuildError(f"{lake} is held by a build (build.lock)")
    try:
        tables = factors.build_factor_tables(rows, as_of)
    except ValueError as exc:
        raise BuildError(str(exc)) from exc
    stats = {"indexes": 0, "changed": 0, "with_splits": 0, "split_symbols_without_index": 0}
    seen = set()
    with os.scandir(idx_dir) as it:
        names = sorted(e.name for e in it if e.name.endswith(".json"))
    # The lake's own symbols, from the file names (`s-<encoded>.json`), so a class share can borrow
    # the splits the vendor filed under its undotted spelling (factors.with_class_share_spellings).
    lake_symbols = set()
    for name in names:
        try:
            lake_symbols.add(piece.decode_symbol(name[:-5]))
        except piece.PieceError:
            pass
    tables = factors.with_class_share_spellings(tables, lake_symbols)
    for name in names:
        path = idx_dir / name
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as exc:
            raise BuildError(f"{path} is unreadable: {exc}") from exc
        symbol = doc.get("symbol") if isinstance(doc, dict) else None
        if not isinstance(symbol, str) or piece.index_relpath(symbol) != f"{VDIR}/index/{name}" \
                or not isinstance(doc.get("series"), dict):
            raise BuildError(f"{path} is not a symbol index")
        table = tables.get(symbol, [])
        seen.add(symbol)
        stats["indexes"] += 1
        if table:
            stats["with_splits"] += 1
        if doc.get("splits") == table and doc.get("splits_as_of") == as_of:
            continue
        doc["splits"] = table
        doc["splits_as_of"] = as_of
        _write_atomic(path, _json_bytes(doc))
        stats["changed"] += 1
    stats["split_symbols_without_index"] = len(set(tables) - seen)
    log(f"{stats['indexes']:,} indexes, {stats['changed']:,} rewritten, {stats['with_splits']:,} with splits")
    return stats


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--lake", required=True, type=Path)
    ap.add_argument("--splits", required=True, type=Path, help='JSON file: {"rows": [...]}')
    ap.add_argument("--as-of", required=True, help="YYYY-MM-DD (ET): the last date whose splits are executed")
    args = ap.parse_args(argv)
    try:
        try:
            doc = json.loads(args.splits.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise BuildError(f"{args.splits} is unreadable: {exc}") from exc
        rows = doc.get("rows") if isinstance(doc, dict) else None
        if not isinstance(rows, list) or not rows:
            raise BuildError(f"{args.splits} has no rows")
        stamp(args.lake, rows, args.as_of)
    except BuildError as exc:
        print(f"STAMP FAILED: {exc}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
