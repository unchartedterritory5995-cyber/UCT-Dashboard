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
import time
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional

try:
    from . import factors, identity, pack, piece
    from .build import BuildError, _json_bytes, _write_atomic
except ImportError:  # script mode
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import factors  # type: ignore[no-redef]
    import identity  # type: ignore[no-redef]
    import pack  # type: ignore[no-redef]
    import piece  # type: ignore[no-redef]
    from build import BuildError, _json_bytes, _write_atomic  # type: ignore[no-redef]

VDIR = f"v{piece.FORMAT_VERSION}"
#: Fewer packs to check than this are checked in the publishing process itself (no process pool).
POOL_MIN_CHECKED = 24


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


def build_indexes(packs: Dict[tuple, Path], *, check: bool = True, log=print, jobs: int = 1,
                  check_since: Optional[float] = None) -> Dict[str, dict]:
    """symbol -> index document. With `check`, every piece's header is read and must agree with the
    pack's trailer (symbol, series, period, bars, first, last, crc, length). `jobs` > 1 reads the
    packs in a process pool; results are merged in the same order as one process, so the documents
    are identical.

    `check_since` (epoch seconds, 2026-11-17): only packs written at or after it are checked. A pack is
    immutable once written and was checked by the publish that followed its build; re-reading all 469
    packs' piece headers took ~35 minutes of random reads on the lake's disk at every daily run."""
    out: Dict[str, dict] = {}
    work = [(key, path, check and (check_since is None or path.stat().st_mtime >= check_since))
            for key, path in packs.items()]
    # ⛔ A pool only when there is real checking to share out (2026-11-17). An identity publish crashed
    # (segfault, exit 139) right where the upload began after a 469-pack pool check; the same upload
    # alone, and the same check alone, both ran clean. A daily run checks only the few packs it rebuilt:
    # it reads them in this process and never puts the pool and the uploader in one process.
    checked = sum(1 for _key, _path, c in work if c)
    pool = ProcessPoolExecutor(max_workers=jobs) if jobs > 1 and checked > POOL_MIN_CHECKED else None
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
    tables = factors.with_class_share_spellings(tables, indexes.keys())
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
        for k in ("splits", "splits_as_of", "identity"):
            if k in doc:
                d[k] = doc[k]
        plain[sym] = d
    write_indexes(plain, out)
    return n


#: Tries per index put (the first included) and the backoff base between them (0.5, 1, 2, 4 s).
INDEX_RETRIES = 5
INDEX_RETRY_BASE_S = 0.5


def upload(packs: Dict[tuple, Path], indexes: Dict[str, dict], put_file: Callable, put_bytes: Callable, *,
           prefix: str = "", jobs: int = 16, log=print, exists: Optional[Callable] = None,
           every: int = 10, sleep: Callable[[float], None] = time.sleep,
           force: Optional[set] = None) -> dict:
    """Packs first, indexes last (an index never names a pack the bucket does not have yet).
    `put_file(key, path, content_type)` / `put_bytes(key, data, content_type)` do the network.

    RESUMABLE (2026-11-17): `exists(key, size)` answers whether the bucket already holds that key
    at that byte size; such a pack is not sent again, so a re-run after an interrupted upload (the
    whole lake is ~65 GB) carries on where it stopped. A pack is immutable for its key (its content
    names its period), so a same-size object IS the pack. Progress is logged every `every` packs."""
    stats = {"packs": 0, "pack_bytes": 0, "skipped": 0, "indexes": 0}
    items = list(packs.items())
    total = len(items)

    # DAILY REFRESH (2026-11-17): a CURRENT period's pack (this month of 1m, this quarter of 5m, this
    # year of the rest) is rebuilt in place every day, so "same key, same size, same pack" no longer
    # holds for it. Keys in `force` (the packs rebuilt by this run) are always sent.
    forced = set(force or ())

    def _one(key: str, path: Path):
        size = path.stat().st_size
        if key not in forced and exists is not None and exists(key, size):
            return size, True
        put_file(key, path, "application/octet-stream")
        return size, False

    with ThreadPoolExecutor(max_workers=max(1, min(jobs, 8))) as ex:
        futs = [ex.submit(_one, f"{prefix}{pack.pack_relpath(s, p)}", path) for (s, p), path in items]
        for n, f in enumerate(futs, 1):
            size, skipped = f.result()
            if skipped:
                stats["skipped"] += 1
            else:
                stats["packs"] += 1
                stats["pack_bytes"] += size
            if n % max(1, every) == 0 or n == total:
                log(f"packs {n}/{total}: {stats['packs']} sent ({stats['pack_bytes'] / 1e9:.1f} GB), "
                    f"{stats['skipped']} already there")
    log(f"uploaded {stats['packs']} packs, {stats['pack_bytes']:,} bytes ({stats['skipped']} already there)")

    # ⚰️ 2026-11-17: ONE of 36,676 index puts failed with R2's "Reduce your concurrent request rate for
    # the same object" (503, after botocore's own retries) and the whole run died on it, logging nothing
    # after the packs line. Each index is now retried on its own with a backoff, the rest carry on, and a
    # key that still fails is NAMED in the error (re-running sends every index again: they are small).
    def _put_index(key: str, data: bytes) -> Optional[str]:
        last: Optional[BaseException] = None
        for attempt in range(INDEX_RETRIES):
            try:
                put_bytes(key, data, "application/json")
                return None
            except Exception as exc:          # noqa: BLE001 — retried, then reported by name
                last = exc
                if attempt + 1 < INDEX_RETRIES:
                    sleep(INDEX_RETRY_BASE_S * (2 ** attempt))
        return f"{key}: {type(last).__name__}: {last}"

    failed: List[str] = []
    with ThreadPoolExecutor(max_workers=max(1, jobs)) as ex:
        futs = [ex.submit(_put_index, f"{prefix}{piece.index_relpath(sym)}", _json_bytes(doc))
                for sym, doc in indexes.items()]
        for f in futs:
            err = f.result()
            if err:
                failed.append(err)
            else:
                stats["indexes"] += 1
    log(f"uploaded {stats['indexes']} indexes")
    if failed:
        raise BuildError(f"{len(failed)} of {len(indexes)} indexes failed after {INDEX_RETRIES} tries "
                         f"(re-run to send them again): {failed[:5]}")
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


def forced_keys(packs: Dict[tuple, Path], since: float, *, prefix: str = "") -> set:
    """The bucket keys of the packs written at or after `since` (epoch seconds): the ones a daily
    refresh rebuilt, which must be sent whatever size the bucket's copy has."""
    return {f"{prefix}{pack.pack_relpath(s, p)}" for (s, p), path in packs.items()
            if path.stat().st_mtime >= since}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--from", dest="roots", action="append", default=[], type=Path, required=True)
    ap.add_argument("--out", type=Path, help="write v1/index/ here")
    ap.add_argument("--explode", type=Path, help="also write a per-piece tree here")
    ap.add_argument("--splits", type=Path, help='the split reference, {"rows": [...]}')
    ap.add_argument("--as-of", help="YYYY-MM-DD: the last date whose splits are executed (with --splits)")
    ap.add_argument("--ticker-events", type=Path,
                    help="ref/ticker_events.jsonl: cut reused tickers, stitch renamed companies (identity.py)")
    ap.add_argument("--no-check", action="store_true", help="skip reading every piece header")
    ap.add_argument("--check-since", type=float, default=None,
                    help="epoch seconds: check only the packs written at or after this (the rest were checked when written)")
    ap.add_argument("--upload", action="store_true")
    ap.add_argument("--bucket")
    ap.add_argument("--prefix", default="")
    ap.add_argument("--jobs", type=int, default=16)
    ap.add_argument("--check-jobs", type=int, default=min(8, os.cpu_count() or 1),
                    help="processes reading and checking the packs (default: up to 8)")
    ap.add_argument("--force-since", type=float, default=None,
                    help="epoch seconds: packs written at or after this are always uploaded (daily refresh)")
    args = ap.parse_args(argv)
    try:
        packs = collect_packs(args.roots)
        print(f"{len(packs)} packs")
        indexes = build_indexes(packs, check=not args.no_check, jobs=args.check_jobs, check_since=args.check_since)
        print(f"{len(indexes):,} symbols")
        if args.splits:
            if not args.as_of:
                raise BuildError("--splits needs --as-of")
            rows = json.loads(args.splits.read_text(encoding="utf-8")).get("rows") or []
            if not rows:
                raise BuildError(f"{args.splits} has no rows")
            print(f"{stamp_indexes(indexes, rows, args.as_of):,} symbols with splits")
        if args.ticker_events:
            # after the splits: the split tables follow the same windows as the pieces
            plans = identity.plan(identity.load_records(args.ticker_events), have=indexes.keys())
            st = identity.apply(indexes, plans)
            print(f"identity: {st['cut']} symbols cut, {st['stitched']} stitched "
                  f"({st['entries_added']:,} entries added, {st['entries_dropped']:,} dropped)")
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

            def exists(key, size):
                try:
                    return int(client.head_object(Bucket=args.bucket, Key=key).get("ContentLength", -1)) == int(size)
                except Exception:                 # noqa: BLE001 — absent / unreadable: send it
                    return False

            force = forced_keys(packs, args.force_since, prefix=args.prefix) if args.force_since is not None else None
            if force:
                print(f"{len(force)} packs rebuilt since {args.force_since:.0f}: always sent")
            upload(packs, indexes, put_file, put_bytes, prefix=args.prefix, jobs=args.jobs, exists=exists,
                   force=force)
    except BuildError as exc:
        print(f"PUBLISH FAILED: {exc}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
