"""From pack trees (build.py --packs) to what the edge serves.

    # check the packs and write the per-symbol indexes beside them (no network)
    python tools/history_lake/publish.py --from D:/uct-history/packs-a --from D:/uct-history/packs-b \
        --out D:/uct-history/publish --splits D:/uct-history/ref/splits.json --as-of 2026-11-13

    # the same, then upload packs/ and v1/index/ to an S3-compatible bucket (R2)
    ... --upload --bucket uct-history --prefix ""            (credentials: DATA_SYNC_* environment)

    # a per-piece tree (v1/<series>/<symbol>/<period>.ubh), for tests and spot checks
    ... --explode D:/uct-history/exploded

What the edge reads (edge/bars-edge-router/history.js):

    packs/<series>/<period>.pack        every symbol's piece of that period (pack.py); a piece is one
                                        ranged read: offset `off`, length `bytes`, from the index
    v1/index/<encoded symbol>.json      {"v":1,"symbol":..,"series":{s:{period:{bars,bytes,crc,first,
                                         last,off}}},"splits":[[date,ratio],..],"splits_as_of":date}

Index entries are the piece-file format's (FORMAT.md section 6) plus `off`. Several --from trees must
not hold the same pack unless the two files are identical (build ranges split on a year boundary).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional

try:
    from . import factors, pack, piece
    from .build import BuildError, _json_bytes, _write_atomic
except ImportError:  # script mode
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import factors  # type: ignore[no-redef]
    import pack  # type: ignore[no-redef]
    import piece  # type: ignore[no-redef]
    from build import BuildError, _json_bytes, _write_atomic  # type: ignore[no-redef]

VDIR = f"v{piece.FORMAT_VERSION}"


def collect_packs(roots: Iterable[Path]) -> Dict[tuple, Path]:
    """(series, period) -> pack path across the trees; a pack in two trees must be the same file."""
    found: Dict[tuple, Path] = {}
    for root in roots:
        root = Path(root)
        if (root / "build.lock").exists():
            raise BuildError(f"{root} is held by a build (build.lock)")
        for series, period, path in pack.iter_packs(root):
            key = (series, period)
            if key in found:
                a, b = found[key], path
                if a.stat().st_size != b.stat().st_size or a.read_bytes() != b.read_bytes():
                    raise BuildError(f"pack {series}/{period} is in two trees with different contents ({a}, {b})")
                continue
            found[key] = path
    if not found:
        raise BuildError("no packs found")
    return dict(sorted(found.items()))


def _read_pack(job) -> tuple:
    """One pack's index entries, oldest-first as its trailer lists them: (series, period, [(sym, entry)]).
    With `check`, every piece's header is read and must agree with the trailer. Runs in a pool worker
    too, so it raises only BuildError."""
    (series, period), path, check = job
    entries = []
    with pack.PackReader(path) as r:
        tr = r.trailer
        if tr.get("series") != series or tr.get("period") != period:
            raise BuildError(f"{path} holds {tr.get('series')}/{tr.get('period')}, not {series}/{period}")
        for sym, (off, length, bars, first, last, crc) in tr["pieces"].items():
            if check:
                blob = r.get(sym)
                try:
                    h = piece.read_header(blob)
                except piece.PieceError as exc:
                    raise BuildError(f"{path}: {sym}: {exc}") from exc
                if (h["symbol"], h["series"], h["period"], h["bars"], h["first"], h["last"], h["crc"]) !=                         (sym, series, period, bars, first, last, crc):
                    raise BuildError(f"{path}: {sym}: the trailer and the piece header disagree")
            entries.append((sym, {"bars": bars, "bytes": length, "crc": crc, "first": first, "last": last, "off": off}))
    return series, period, entries


def build_indexes(packs: Dict[tuple, Path], *, check: bool = True, log=print, jobs: int = 1) -> Dict[str, dict]:
    """symbol -> index document. With `check`, every piece's header is read and must agree with the
    pack's trailer (symbol, series, period, bars, first, last, crc, length). `jobs` > 1 reads the
    packs in a process pool (the check is CPU-bound: ~80 s a year of packs in one process); results
    are merged in the same order as one process, so the documents are identical."""
    out: Dict[str, dict] = {}
    work = [(key, path, check) for key, path in packs.items()]
    pool = ProcessPoolExecutor(max_workers=jobs) if jobs > 1 and len(work) > 1 else None
    try:
        results = pool.map(_read_pack, work, chunksize=1) if pool else map(_read_pack, work)
        for n, (series, period, entries) in enumerate(results, 1):
            for sym, entry in entries:
                doc = out.setdefault(sym, {"v": piece.FORMAT_VERSION, "symbol": sym, "series": {}})
                doc["series"].setdefault(series, {})[period] = entry
            if n % 50 == 0:
                log(f"  {n}/{len(packs)} packs read")
    finally:
        if pool:
            pool.shutdown(wait=True, cancel_futures=True)
    return dict(sorted(out.items()))


def stamp_indexes(indexes: Dict[str, dict], rows, as_of: str) -> int:
    """Put each symbol's split table (factors.py) in its index. Returns how many have splits."""
    try:
        tables = factors.build_factor_tables(rows, as_of)
    except ValueError as exc:
        raise BuildError(str(exc)) from exc
    n = 0
    for sym, doc in indexes.items():
        doc["splits"] = tables.get(sym, [])
        doc["splits_as_of"] = as_of
        n += bool(doc["splits"])
    return n


def write_indexes(indexes: Dict[str, dict], out: Path) -> int:
    d = Path(out) / VDIR / "index"
    d.mkdir(parents=True, exist_ok=True)
    for sym, doc in indexes.items():
        _write_atomic(Path(out) / piece.index_relpath(sym), _json_bytes(doc))
    return len(indexes)


def explode(packs: Dict[tuple, Path], indexes: Dict[str, dict], out: Path) -> int:
    """The per-piece tree the piece-file builder writes (pieces + indexes WITHOUT `off`): for tests
    and spot checks. Returns the number of pieces."""
    out = Path(out)
    n = 0
    for (series, period), path in packs.items():
        with pack.PackReader(path) as r:
            for sym in r.symbols():
                p = out / piece.piece_relpath(series, sym, period)
                p.parent.mkdir(parents=True, exist_ok=True)
                _write_atomic(p, r.get(sym))
                n += 1
    plain = {}
    for sym, doc in indexes.items():
        d = {"v": doc["v"], "symbol": sym, "series": {
            s: {per: {k: v for k, v in e.items() if k != "off"} for per, e in ps.items()} for s, ps in doc["series"].items()}}
        for k in ("splits", "splits_as_of"):
            if k in doc:
                d[k] = doc[k]
        plain[sym] = d
    write_indexes(plain, out)
    return n


def upload(packs: Dict[tuple, Path], indexes: Dict[str, dict], put_file: Callable, put_bytes: Callable, *,
           prefix: str = "", jobs: int = 16, log=print) -> dict:
    """Packs first, indexes last (an index never names a pack the bucket does not have yet).
    `put_file(key, path, content_type)` / `put_bytes(key, data, content_type)` do the network."""
    stats = {"packs": 0, "pack_bytes": 0, "indexes": 0}
    with ThreadPoolExecutor(max_workers=max(1, min(jobs, 8))) as ex:
        futs = [ex.submit(put_file, f"{prefix}{pack.pack_relpath(s, p)}", path, "application/octet-stream")
                for (s, p), path in packs.items()]
        for f, ((s, p), path) in zip(futs, packs.items()):
            f.result()
            stats["packs"] += 1
            stats["pack_bytes"] += path.stat().st_size
    log(f"uploaded {stats['packs']} packs, {stats['pack_bytes']:,} bytes")
    with ThreadPoolExecutor(max_workers=max(1, jobs)) as ex:
        futs = [ex.submit(put_bytes, f"{prefix}{piece.index_relpath(sym)}", _json_bytes(doc), "application/json")
                for sym, doc in indexes.items()]
        for f in futs:
            f.result()
            stats["indexes"] += 1
    log(f"uploaded {stats['indexes']} indexes")
    return stats


def s3_client_from_env():
    import boto3
    from botocore.config import Config
    env = os.environ
    return boto3.client(
        "s3",
        endpoint_url=env["DATA_SYNC_ENDPOINT_URL"],
        aws_access_key_id=env["DATA_SYNC_ACCESS_KEY"],
        aws_secret_access_key=env["DATA_SYNC_SECRET_KEY"],
        region_name=env.get("DATA_SYNC_REGION") or "auto",
        config=Config(request_checksum_calculation="when_required", response_checksum_validation="when_required",
                      max_pool_connections=32, retries={"max_attempts": 8, "mode": "adaptive"}),
    )


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--from", dest="roots", action="append", default=[], type=Path, required=True)
    ap.add_argument("--out", type=Path, help="write v1/index/ here")
    ap.add_argument("--explode", type=Path, help="also write a per-piece tree here")
    ap.add_argument("--splits", type=Path, help='the split reference, {"rows": [...]}')
    ap.add_argument("--as-of", help="YYYY-MM-DD: the last date whose splits are executed (with --splits)")
    ap.add_argument("--no-check", action="store_true", help="skip reading every piece header")
    ap.add_argument("--upload", action="store_true")
    ap.add_argument("--bucket")
    ap.add_argument("--prefix", default="")
    ap.add_argument("--jobs", type=int, default=16)
    ap.add_argument("--check-jobs", type=int, default=min(8, os.cpu_count() or 1),
                    help="processes reading and checking the packs (default: up to 8)")
    args = ap.parse_args(argv)
    try:
        packs = collect_packs(args.roots)
        print(f"{len(packs)} packs")
        indexes = build_indexes(packs, check=not args.no_check, jobs=args.check_jobs)
        print(f"{len(indexes):,} symbols")
        if args.splits:
            if not args.as_of:
                raise BuildError("--splits needs --as-of")
            rows = json.loads(args.splits.read_text(encoding="utf-8")).get("rows") or []
            if not rows:
                raise BuildError(f"{args.splits} has no rows")
            print(f"{stamp_indexes(indexes, rows, args.as_of):,} symbols with splits")
        if args.out:
            print(f"{write_indexes(indexes, args.out):,} indexes written")
        if args.explode:
            print(f"{explode(packs, indexes, args.explode):,} pieces exploded")
        if args.upload:
            if not args.bucket:
                raise BuildError("--upload needs --bucket")
            client = s3_client_from_env()

            def put_file(key, path, ctype):
                client.upload_file(str(path), args.bucket, key, ExtraArgs={"ContentType": ctype})

            def put_bytes(key, data, ctype):
                client.put_object(Bucket=args.bucket, Key=key, Body=data, ContentType=ctype)

            upload(packs, indexes, put_file, put_bytes, prefix=args.prefix, jobs=args.jobs)
    except BuildError as exc:
        print(f"PUBLISH FAILED: {exc}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
