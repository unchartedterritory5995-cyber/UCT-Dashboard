"""Fold one or more finished history-lake trees into one.

    python tools/history_lake/merge_lakes.py --into D:/uct-history/lake --from D:/uct-history/lake-a \
        --from D:/uct-history/lake-b [--copy]

The full build runs as several processes over disjoint date ranges, each into its own tree
(``build.py --out``). Their pieces never share a path as long as the ranges split on a year
boundary (a period is a month, a quarter or a year). This tool:

1. moves (default) or copies every piece ``v1/<series>/<symbol>/<period>.ubh`` into ``--into``;
   a path that already exists there must hold the SAME bytes, otherwise it stops;
2. writes each symbol's index as the union of the trees' indexes;
3. writes the union of the ledgers (the same day in two trees must record the same file size);
4. checks the result: every index entry names a file of the recorded size, and every piece file
   on disk is in an index.

It refuses a tree that another build still holds (``build.lock``) or left unfinished (``_spill``
with files in it). Rerunning after an interruption picks up where it stopped.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Optional

try:
    from . import piece
    from .build import LEDGER_VERSION, BuildError, _json_bytes, _write_atomic
except ImportError:  # script mode
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import piece  # type: ignore[no-redef]
    from build import LEDGER_VERSION, BuildError, _json_bytes, _write_atomic  # type: ignore[no-redef]

VDIR = f"v{piece.FORMAT_VERSION}"


def _check_source(src: Path) -> None:
    if not (src / VDIR).is_dir():
        raise BuildError(f"{src} is not a history-lake tree (no {VDIR}/)")
    if (src / "build.lock").exists():
        raise BuildError(f"{src} is held by a build (build.lock); wait for it or remove a stale lock")
    spill = src / "_spill"
    if spill.is_dir() and any(spill.iterdir()):
        raise BuildError(f"{src} has an unfinished build (_spill is not empty); rerun its build first")


def _iter_pieces(root: Path):
    """Yield (series, encoded symbol, file name, path) for every piece under ``root``."""
    base = root / VDIR
    for series in piece.SERIES_IDS:
        sdir = base / series
        if not sdir.is_dir():
            continue
        with os.scandir(sdir) as syms:
            for sym in syms:
                if not sym.is_dir():
                    continue
                with os.scandir(sym.path) as files:
                    for f in files:
                        if f.name.endswith(".ubh") and f.is_file():
                            yield series, sym.name, f.name, Path(f.path)


def _same_bytes(a: Path, b: Path) -> bool:
    if a.stat().st_size != b.stat().st_size:
        return False
    with open(a, "rb") as fa, open(b, "rb") as fb:
        while True:
            x, y = fa.read(1 << 20), fb.read(1 << 20)
            if x != y:
                return False
            if not x:
                return True


def _load_json(path: Path) -> Optional[dict]:
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except ValueError as exc:
        raise BuildError(f"{path} is unreadable: {exc}") from exc
    if not isinstance(doc, dict):
        raise BuildError(f"{path} is not a JSON object")
    return doc


def _merge_pieces(src: Path, dest: Path, copy: bool, stats: dict) -> None:
    made = set()
    for series, enc, name, path in _iter_pieces(src):
        target_dir = dest / VDIR / series / enc
        target = target_dir / name
        if target.exists():
            if not _same_bytes(path, target):
                raise BuildError(f"{target} already exists with different bytes than {path}")
            stats["already_there"] += 1
            if not copy:
                path.unlink()
            continue
        if target_dir not in made:
            target_dir.mkdir(parents=True, exist_ok=True)
            made.add(target_dir)
        if copy:
            tmp = target.with_name(target.name + ".tmp")
            shutil.copyfile(path, tmp)
            os.replace(tmp, target)
        else:
            try:
                os.replace(path, target)
            except OSError:                     # another volume
                tmp = target.with_name(target.name + ".tmp")
                shutil.copyfile(path, tmp)
                os.replace(tmp, target)
                path.unlink()
        stats["pieces_moved"] += 1


def _merge_indexes(src: Path, dest: Path, stats: dict) -> None:
    sdir = src / VDIR / "index"
    if not sdir.is_dir():
        return
    ddir = dest / VDIR / "index"
    ddir.mkdir(parents=True, exist_ok=True)
    with os.scandir(sdir) as it:
        names = sorted(e.name for e in it if e.name.endswith(".json"))
    for name in names:
        doc = _load_json(sdir / name)
        symbol = doc.get("symbol")
        if not isinstance(symbol, str) or piece.index_relpath(symbol) != f"{VDIR}/index/{name}" \
                or not isinstance(doc.get("series"), dict):
            raise BuildError(f"{sdir / name} is not a symbol index")
        target = ddir / name
        cur = _load_json(target) or {"v": piece.FORMAT_VERSION, "symbol": symbol, "series": {}}
        if cur.get("symbol") != symbol or not isinstance(cur.get("series"), dict):
            raise BuildError(f"{target} is not the index of {symbol!r}")
        before = _json_bytes(cur)
        for series, periods in doc["series"].items():
            have = cur["series"].setdefault(series, {})
            for period, entry in periods.items():
                if period in have and have[period] != entry:
                    raise BuildError(f"{symbol} {series}/{period}: the two trees describe different pieces")
                have[period] = entry
        after = _json_bytes(cur)
        if after != before or not target.exists():
            _write_atomic(target, after)
        stats["indexes"] += 1


def _merge_ledger(src: Path, ledger: dict) -> None:
    doc = _load_json(src / "ledger.json")
    if doc is None:
        raise BuildError(f"{src} has no ledger.json")
    if doc.get("v") != LEDGER_VERSION or not isinstance(doc.get("days"), dict):
        raise BuildError(f"{src / 'ledger.json'} is not a version {LEDGER_VERSION} ledger")
    if "symbols" not in ledger:
        ledger["symbols"] = doc.get("symbols")
    elif ledger["symbols"] != doc.get("symbols"):
        raise BuildError(f"{src} was built for a different --symbols scope than the other trees")
    for day, info in doc["days"].items():
        if day in ledger["days"] and ledger["days"][day] != info:
            raise BuildError(f"day {day} is in two trees with different day files ({ledger['days'][day]} vs {info})")
        ledger["days"][day] = info


def verify(root: Path) -> dict:
    """Every index entry names a file of the recorded size; every piece file is indexed."""
    on_disk = {(series, enc, name[:-4]): path.stat().st_size for series, enc, name, path in _iter_pieces(root)}
    idx_dir = root / VDIR / "index"
    indexed = 0
    problems: List[str] = []
    seen = set()
    if idx_dir.is_dir():
        for entry in sorted(os.listdir(idx_dir)):
            if not entry.endswith(".json"):
                continue
            doc = _load_json(idx_dir / entry)
            enc = entry[:-5]
            for series, periods in doc.get("series", {}).items():
                for period, info in periods.items():
                    indexed += 1
                    key = (series, enc, period)
                    seen.add(key)
                    size = on_disk.get(key)
                    if size is None:
                        problems.append(f"index names a missing piece: {series}/{enc}/{period}")
                    elif size != info.get("bytes"):
                        problems.append(f"{series}/{enc}/{period}: file is {size} bytes, index says {info.get('bytes')}")
    for key in on_disk.keys() - seen:
        problems.append(f"piece is not in any index: {'/'.join(key)}")
    return {"pieces": len(on_disk), "indexed": indexed, "bytes": sum(on_disk.values()), "problems": sorted(problems)}


def merge(into: Path, sources: List[Path], *, copy: bool = False, log=print) -> dict:
    into = Path(into)
    sources = [Path(s) for s in sources]
    if not sources:
        raise BuildError("nothing to merge: give at least one --from")
    resolved = {into.resolve()}
    for src in sources:
        if src.resolve() in resolved:
            raise BuildError(f"{src} is named twice, or is the destination")
        resolved.add(src.resolve())
        _check_source(src)
    if (into / "build.lock").exists():
        raise BuildError(f"{into} is held by a build (build.lock)")
    into.mkdir(parents=True, exist_ok=True)

    stats = {"pieces_moved": 0, "already_there": 0, "indexes": 0}
    ledger: Dict = {"v": LEDGER_VERSION, "days": {}}
    existing = _load_json(into / "ledger.json")
    if existing is not None:
        if existing.get("v") != LEDGER_VERSION or not isinstance(existing.get("days"), dict):
            raise BuildError(f"{into / 'ledger.json'} is not a version {LEDGER_VERSION} ledger")
        ledger["symbols"] = existing.get("symbols")
        ledger["days"].update(existing["days"])
    for src in sources:                         # every ledger is checked before a single file moves
        _merge_ledger(src, ledger)
    ledger.setdefault("symbols", None)
    for src in sources:
        log(f"{src}: pieces ...")
        _merge_pieces(src, into, copy, stats)
        log(f"{src}: indexes ...")
        _merge_indexes(src, into, stats)
    _write_atomic(into / "ledger.json", _json_bytes(ledger))
    log("checking the merged tree ...")
    check = verify(into)
    stats.update(days=len(ledger["days"]), pieces=check["pieces"], bytes=check["bytes"],
                 problems=check["problems"])
    if check["problems"]:
        raise BuildError(f"merged tree failed its check ({len(check['problems'])} problems; first: "
                         f"{check['problems'][0]})")
    return stats


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--into", required=True, type=Path)
    ap.add_argument("--from", dest="sources", action="append", default=[], type=Path)
    ap.add_argument("--copy", action="store_true", help="leave the source trees untouched (needs the disk space)")
    ap.add_argument("--verify-only", action="store_true", help="only check --into")
    args = ap.parse_args(argv)
    try:
        if args.verify_only:
            out = verify(args.into)
            print(f"pieces {out['pieces']:,}  indexed {out['indexed']:,}  bytes {out['bytes']:,}  "
                  f"problems {len(out['problems'])}")
            for p in out["problems"][:20]:
                print("  ", p)
            return 1 if out["problems"] else 0
        out = merge(args.into, args.sources, copy=args.copy)
    except BuildError as exc:
        print(f"MERGE FAILED: {exc}")
        return 2
    print(f"merged: {out['pieces']:,} pieces, {out['bytes']:,} bytes, {out['days']:,} days "
          f"({out['pieces_moved']:,} moved, {out['already_there']:,} already there, {out['indexes']:,} indexes read)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
