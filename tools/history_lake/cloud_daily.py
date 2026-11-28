"""The history lake's daily refresh WITHOUT the owner's PC (2026-11-28): the same R2 result as daily.py.

WHY. daily.py runs on the owner's PC (Task Scheduler, 4x a day) over D:/uct-history: the vendor's 1-minute
day files, seven pack trees (~70 GB) and the split / ticker-event references. A PC that is off, asleep or
offline (11-27 06:30: "Could not resolve host: github.com") leaves the lake behind, and a day the lake
lacks is a day every intraday chart reads from the slower origin. This runs on a GitHub Actions runner.

WHAT IT NEEDS, AND WHY IT IS SMALL. A day only rewrites its CURRENT periods: one pack per series (this
month of 1m, this quarter of 5m, this year of 15/30/60/60e), ~1.7 GB. Everything else the publish needs
from the other ~460 packs is their TRAILER (pack.py: every piece's place, size, bars and CRC), which a
ranged read of the pack's tail returns without the pieces. So one run:

  1. lists the vendor's day files (sizes) for this year (and last year in January);
  2. reads the build ledger from R2 (`<prefix>state/ledger.json`: the days folded, with their sizes) and
     plans the days exactly as daily.py does (`daily.days_to_fold`: new, holes, changed);
  3. nothing to fold: the lag check only (exit 3 when the lake is more than one trading session behind);
  4. downloads those day files and the packs they rewrite (from R2), and runs build.py --packs on them:
     the same builder, the same bytes (folding is deterministic, and folding a day twice is a no-op);
  5. refreshes the split reference from the vendor (the last copy in R2 when that fails);
  6. builds every symbol's index from the rebuilt packs (read and CHECKED, as daily.py does) and every
     other pack's trailer (read from R2), stamps the splits, applies the ticker events (identity.py), and
     uploads the rebuilt packs first, the indexes last (publish.upload). ⛔ A pack it did not rebuild is
     NEVER uploaded: only a trailer of it is on the runner;
  7. reads SPY's live index back: its newest 1m bar must reach the newest folded day, or the run fails;
  8. only then writes the ledger and `<prefix>state/runner.json` back to R2.

LAG ALERT. Every run ends with the lag check: the lake (SPY's live index, the authority members read)
more than one trading session behind the vendor's newest day file is exit 3 and a red run; the workflow
posts it to Discord. Weekends and holidays never count as sessions (the vendor publishes no file).

State in R2 (under the lake's prefix, never served: the edge reads only `packs/` and `v1/index/`):
  state/ledger.json          the build ledger of the current-period tree
  state/ticker_events.jsonl  identity input (seeded from the PC's ref/; refreshed by hand, as there)
  state/splits.json          the last split reference fetched
  state/runner.json          what this runner last published, when, and from which days

Credentials (environment, never printed): DATA_SYNC_ENDPOINT_URL / DATA_SYNC_ACCESS_KEY /
DATA_SYNC_SECRET_KEY (R2), MASSIVE_ACCESS_KEY / MASSIVE_SECRET_KEY (vendor flat files), MASSIVE_API_KEY
(split reference). The Actions log is PUBLIC: this prints counts, dates and sizes only, never a key, a
URL with a credential, or a price.

    python tools/history_lake/cloud_daily.py --work /tmp/lake --bucket uct-bars-snapshots --prefix hist/
    python tools/history_lake/cloud_daily.py ... --check-only        # the lag check alone
    python tools/history_lake/cloud_daily.py ... --dry-run           # plan and print, change nothing
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import struct
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Tuple

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import daily  # noqa: E402  (script-mode imports, as build.py / publish.py do)
import identity  # noqa: E402
import pack  # noqa: E402
import piece  # noqa: E402
import publish  # noqa: E402

VENDOR_BUCKET = "flatfiles"
VENDOR_PREFIX = "us_stocks_sip/minute_aggs_v1/"
VENDOR_ENDPOINT = "https://files.massive.com"
SPLITS_URL = "https://api.massive.com/v3/reference/splits"
STATE = "state/"
EXIT_OK, EXIT_FAILED, EXIT_BEHIND = daily.EXIT_OK, daily.EXIT_FAILED, daily.EXIT_BEHIND
_TAIL = struct.Struct("<Q")


def log(msg: str) -> None:
    print(msg, flush=True)


# ── pure parts (tests/test_history_lake_cloud_daily.py) ─────────────────────────────────────────

def vendor_sizes(listing: Iterable[Tuple[str, int]]) -> Dict[str, int]:
    """{day: size} from (key, size) pairs of the vendor's listing (`.../YYYY/YYYY-MM-DD.csv.gz`)."""
    out = {}
    for key, size in listing:
        name = key.rsplit("/", 1)[-1]
        if name.endswith(".csv.gz") and len(name) == 17:
            out[name[:10]] = int(size)
    return out


def years_for(today: _dt.date) -> List[int]:
    return sorted({today.year, today.year - 1} if today.month == 1 else {today.year})


def parse_trailer(tail: bytes, size: int) -> Tuple[int, int]:
    """(trailer offset, trailer length) from the last 16 bytes of a pack of `size` bytes."""
    if len(tail) != _TAIL.size + len(pack.MAGIC) or tail[_TAIL.size:] != pack.MAGIC:
        raise publish.BuildError("not a pack (no end marker)")
    (n,) = _TAIL.unpack(tail[:_TAIL.size])
    start = size - len(pack.MAGIC) - _TAIL.size - n
    if n <= 0 or start < 0:
        raise publish.BuildError(f"trailer length {n} does not fit a {size}-byte pack")
    return start, n


def trailer_entries(doc: dict, series: str, period: str) -> list:
    """A pack trailer's index entries, exactly as publish._read_pack makes them (unchecked)."""
    if not isinstance(doc, dict) or doc.get("v") != pack.PACK_VERSION or not isinstance(doc.get("pieces"), dict):
        raise publish.BuildError(f"{series}/{period}: not a version {pack.PACK_VERSION} pack trailer")
    if doc.get("series") != series or doc.get("period") != period:
        raise publish.BuildError(f"pack {series}/{period} holds {doc.get('series')}/{doc.get('period')}")
    out = []
    for sym, e in doc["pieces"].items():
        if not (isinstance(e, list) and len(e) == 6 and all(isinstance(x, int) and x >= 0 for x in e)):
            raise publish.BuildError(f"{series}/{period}: bad entry for {sym!r}")
        off, length, bars, first, last, crc = e
        out.append((sym, {"bars": bars, "bytes": length, "crc": crc, "first": first, "last": last, "off": off}))
    return out


def merge_indexes(per_pack: Iterable[Tuple[str, str, list]]) -> Dict[str, dict]:
    """symbol -> index document from (series, period, entries), in (series, period) order: the same
    documents publish.build_indexes makes from the same packs."""
    out: Dict[str, dict] = {}
    for series, period, entries in sorted(per_pack, key=lambda x: (x[0], x[1])):
        for sym, entry in entries:
            doc = out.setdefault(sym, {"v": piece.FORMAT_VERSION, "symbol": sym, "series": {}})
            doc["series"].setdefault(series, {})[period] = entry
    return dict(sorted(out.items()))


def pack_key_of(key: str, prefix: str) -> Optional[Tuple[str, str]]:
    """(series, period) of a bucket key `<prefix>packs/<series>/<period>.pack`, or None."""
    if not key.startswith(prefix + "packs/") or not key.endswith(".pack"):
        return None
    rest = key[len(prefix) + len("packs/"):-len(".pack")].split("/")
    if len(rest) != 2 or rest[0] not in piece.SERIES_IDS:
        return None
    return rest[0], rest[1]


def lag_sessions(lake_last_day: Optional[str], vendor_last_day: Optional[str]) -> int:
    """Trading sessions the vendor has published that the lake lacks: weekdays after the lake's last day
    up to and including the vendor's newest file. The vendor publishes no file for a weekend or a holiday,
    so a holiday is never counted unless a later session exists."""
    if not vendor_last_day:
        return 0
    if not lake_last_day:
        return 99
    if vendor_last_day <= lake_last_day:
        return 0
    return daily.trading_days_between(lake_last_day, _dt.date.fromisoformat(vendor_last_day)) + 1


def lake_last_day(index_doc: Optional[dict]) -> Optional[str]:
    """The New York date of the newest 1m bar of a live index (SPY), or None."""
    last = daily.newest_1m_bar(index_doc or {})
    if last is None:
        return None
    ny = _dt.datetime.fromtimestamp(last, _dt.timezone.utc) - _dt.timedelta(hours=5)
    return ny.date().isoformat()


#: Weekdays strictly between the lake's last day and today that may pass before the calendar alone is an
#: alarm: the vendor posts a session's file the next morning, and one holiday a week is common.
CALENDAR_ALLOWANCE = 2


def lag_verdict(lake_day: Optional[str], vendor_day: Optional[str], today: _dt.date, *,
                max_behind: int = 1) -> Tuple[int, str]:
    """(exit code, sentence) for the lag check. BEHIND when the vendor has published more than
    `max_behind` sessions the lake lacks (our refresh failed), or when more than CALENDAR_ALLOWANCE
    weekdays have passed since the lake's last day whatever the vendor has (the vendor stopped)."""
    n = lag_sessions(lake_day, vendor_day)
    cal = daily.trading_days_between(lake_day, today) if lake_day else 99
    if n > max_behind:
        return EXIT_BEHIND, f"LAKE BEHIND: ends {lake_day}, the vendor has {vendor_day} ({n} sessions behind)"
    if cal > CALENDAR_ALLOWANCE:
        return EXIT_BEHIND, (f"LAKE BEHIND: ends {lake_day}, {cal} weekdays before {today} "
                             f"(the vendor's newest day is {vendor_day})")
    return EXIT_OK, f"lake ends {lake_day}; vendor's newest day {vendor_day} ({n} behind)"


# ── the network ─────────────────────────────────────────────────────────────────────────────────

def r2_client():
    return publish.s3_client_from_env()


def vendor_client():
    import boto3
    from botocore.config import Config
    env = os.environ
    return boto3.client("s3", endpoint_url=VENDOR_ENDPOINT, aws_access_key_id=env["MASSIVE_ACCESS_KEY"],
                        aws_secret_access_key=env["MASSIVE_SECRET_KEY"], region_name="us-east-1",
                        config=Config(signature_version="s3v4", request_checksum_calculation="when_required",
                                      response_checksum_validation="when_required",
                                      retries={"max_attempts": 6, "mode": "adaptive"}, read_timeout=300))


def list_keys(client, bucket: str, prefix: str) -> List[Tuple[str, int]]:
    out, tok = [], None
    while True:
        kw = {"Bucket": bucket, "Prefix": prefix}
        if tok:
            kw["ContinuationToken"] = tok
        r = client.list_objects_v2(**kw)
        out += [(o["Key"], int(o["Size"])) for o in r.get("Contents", [])]
        tok = r.get("NextContinuationToken")
        if not tok:
            return out


def get_json(client, bucket: str, key: str) -> Optional[dict]:
    try:
        return json.loads(client.get_object(Bucket=bucket, Key=key)["Body"].read())
    except client.exceptions.NoSuchKey:
        return None


def remote_trailer(client, bucket: str, key: str, size: int, series: str, period: str) -> list:
    tail = client.get_object(Bucket=bucket, Key=key, Range=f"bytes={size - 16}-{size - 1}")["Body"].read()
    start, n = parse_trailer(tail, size)
    raw = client.get_object(Bucket=bucket, Key=key, Range=f"bytes={start}-{start + n - 1}")["Body"].read()
    if len(raw) != n:
        raise publish.BuildError(f"{key}: trailer read short ({len(raw)} of {n})")
    return trailer_entries(json.loads(raw.decode("ascii")), series, period)


def fetch_splits(api_key: str) -> list:
    """The vendor's whole split reference (the PC's fetch_splits.py, same endpoint and fields)."""
    url = SPLITS_URL + "?" + urllib.parse.urlencode({"limit": 1000, "order": "asc", "sort": "execution_date"})
    rows = []
    while url:
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + api_key, "User-Agent": "history-lake/1"})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    j = json.loads(r.read())
                break
            except Exception as e:  # noqa: BLE001 - retried, then reported without the URL
                if attempt == 4:
                    raise publish.BuildError(f"split reference read failed: {type(e).__name__}") from None
                time.sleep(2 * (attempt + 1))
        for r_ in j.get("results") or []:
            if r_.get("ticker") and r_.get("execution_date"):
                rows.append({"ticker": r_["ticker"], "execution_date": str(r_["execution_date"])[:10],
                             "split_from": r_.get("split_from"), "split_to": r_.get("split_to")})
        url = j.get("next_url") or None
    return rows


# ── the run ─────────────────────────────────────────────────────────────────────────────────────

def check_lag(r2, bucket: str, prefix: str, vendor_last: Optional[str], today: _dt.date) -> Tuple[int, str]:
    try:
        doc = get_json(r2, bucket, f"{prefix}v1/index/s-{daily.REFERENCE_SYMBOL}.json")
    except Exception as e:  # noqa: BLE001
        return EXIT_FAILED, f"could not read {daily.REFERENCE_SYMBOL}'s live index: {type(e).__name__}"
    return lag_verdict(lake_last_day(doc), vendor_last, today)


def _build(raw: Path, tree: Path, days: List[str], jobs: int) -> int:
    return subprocess.run([sys.executable, str(HERE / "build.py"), "--raw", str(raw), "--out", str(tree),
                           "--days", ",".join(days), "--packs", "--jobs", str(jobs)]).returncode


def run(work: Path, bucket: str, prefix: str, *, dry_run: bool = False, check_only: bool = False,
        jobs: int = 4, today: Optional[_dt.date] = None, r2=None, vend=None,
        builder: Callable[[Path, Path, List[str], int], int] = _build,
        splits_fn: Optional[Callable[[], list]] = None) -> int:
    """One refresh. `r2` / `vend` (S3 clients), `builder` and `splits_fn` are parameters so the rails
    can drive a whole run against stand-ins; production passes none of them."""
    work = Path(work)
    today = today or _dt.datetime.now(_dt.timezone.utc).date()
    r2 = r2 or r2_client()
    vend = vend or vendor_client()
    splits_fn = splits_fn or (lambda: fetch_splits(os.environ["MASSIVE_API_KEY"]))
    years = years_for(today)
    listing = []
    for y in years:
        listing += list_keys(vend, VENDOR_BUCKET, f"{VENDOR_PREFIX}{y}/")
    sizes = vendor_sizes(listing)
    vendor_last = max(sizes) if sizes else None
    log(f"vendor: {len(sizes)} day files in {years}, newest {vendor_last}")
    if check_only:
        code, msg = check_lag(r2, bucket, prefix, vendor_last, today)
        log(f"[lake-cloud] {msg}")
        return code

    ledger = get_json(r2, bucket, f"{prefix}{STATE}ledger.json")
    if not ledger or not isinstance(ledger.get("days"), dict):
        log(f"[lake-cloud] no build ledger at {prefix}{STATE}ledger.json: seed it from the PC first")
        return EXIT_FAILED
    plan = daily.days_to_fold(sizes, ledger["days"])
    days = sorted(set(plan["new"]) | set(plan["holes"]) | set(plan["changed"]))
    log(f"plan: new={plan['new']} holes={plan['holes']} changed={plan['changed']}")
    if not days:
        code, msg = check_lag(r2, bucket, prefix, vendor_last, today)
        log(f"[lake-cloud] nothing to fold; {msg}")
        return code
    if dry_run:
        log(f"[lake-cloud] dry run: would fold {days} and rebuild {daily.touched_packs(days)}")
        return EXIT_OK

    tree = work / "tree"
    raw = work / "raw"
    (tree / "packs").mkdir(parents=True, exist_ok=True)
    # 4. the day files and the packs they rewrite
    for d in days:
        dst = raw / d[:4] / f"{d}.csv.gz"
        dst.parent.mkdir(parents=True, exist_ok=True)
        vend.download_file(VENDOR_BUCKET, f"{VENDOR_PREFIX}{d[:4]}/{d}.csv.gz", str(dst))
        if dst.stat().st_size != sizes[d]:
            log(f"[lake-cloud] {d}: downloaded {dst.stat().st_size} bytes, the vendor lists {sizes[d]}")
            return EXIT_FAILED
    remote_packs = {}
    for key, size in list_keys(r2, bucket, f"{prefix}packs/"):
        sp = pack_key_of(key, prefix)
        if sp:
            remote_packs[sp] = (key, size)
    touched = daily.touched_packs(days)
    for rel in touched:
        series, period = rel[:-5].split("/")
        if (series, period) in remote_packs:
            key, size = remote_packs[(series, period)]
            dst = tree / "packs" / series / f"{period}.pack"
            dst.parent.mkdir(parents=True, exist_ok=True)
            r2.download_file(bucket, key, str(dst))
            if dst.stat().st_size != size:
                log(f"[lake-cloud] {key}: downloaded {dst.stat().st_size} of {size} bytes")
                return EXIT_FAILED
    (tree / "ledger.json").write_text(json.dumps(ledger), encoding="utf-8")
    log(f"fetched {len(days)} day files and {len(touched)} packs")

    built_at = time.time()
    rc = builder(raw, tree, days, jobs)
    if rc != 0:
        log(f"[lake-cloud] build failed ({rc}); nothing published")
        return EXIT_FAILED
    new_ledger = json.loads((tree / "ledger.json").read_text(encoding="utf-8"))
    through = max(max(new_ledger["days"]), days[-1])

    # 5. splits
    splits_key = f"{prefix}{STATE}splits.json"
    try:
        rows = splits_fn()
        if not rows:
            raise publish.BuildError("the vendor returned no splits")
        r2.put_object(Bucket=bucket, Key=splits_key, Body=json.dumps({"rows": rows}).encode(), ContentType="application/json")
    except Exception as e:  # noqa: BLE001 - the last copy is used, as daily.py does
        log(f"[lake-cloud] split reference not refreshed ({type(e).__name__}); publishing with the last one")
        rows = (get_json(r2, bucket, splits_key) or {}).get("rows") or []
    if not rows:
        log("[lake-cloud] no split reference at all; nothing published")
        return EXIT_FAILED

    # 6. indexes: rebuilt packs read and checked; every other pack by its trailer
    local = dict(publish.collect_packs([tree]))
    per_pack = [publish._read_pack((k, p, True)) for k, p in local.items()]
    for (series, period), (key, size) in sorted(remote_packs.items()):
        if (series, period) not in local:
            per_pack.append((series, period, remote_trailer(r2, bucket, key, size, series, period)))
    indexes = merge_indexes(per_pack)
    log(f"{len(per_pack)} packs ({len(local)} rebuilt), {len(indexes):,} symbols")
    publish.stamp_indexes(indexes, rows, through)
    events = work / "ref" / identity.EVENTS_FILE
    events.parent.mkdir(parents=True, exist_ok=True)
    try:
        r2.download_file(bucket, f"{prefix}{STATE}{identity.EVENTS_FILE}", str(events))
    except Exception as e:  # noqa: BLE001
        log(f"[lake-cloud] no ticker events in state ({type(e).__name__}); nothing published")
        return EXIT_FAILED
    st = identity.apply(indexes, identity.plan(identity.load_records(events), have=indexes.keys()))
    log(f"identity: {st['cut']} cut, {st['stitched']} stitched")

    def put_file(key, path, ctype):
        r2.upload_file(str(path), bucket, key, ExtraArgs={"ContentType": ctype})

    def put_bytes(key, data, ctype):
        r2.put_object(Bucket=bucket, Key=key, Body=data, ContentType=ctype)

    # ⛔ ONLY the packs this run rebuilt are in `local`: a pack read by its trailer is never sent.
    force = {f"{prefix}{pack.pack_relpath(s, p)}" for (s, p) in local}
    publish.upload(local, indexes, put_file, put_bytes, prefix=prefix, jobs=16, force=force, log=log)

    # 7. verify, 8. only then record
    doc = get_json(r2, bucket, f"{prefix}v1/index/s-{daily.REFERENCE_SYMBOL}.json")
    if not daily.reaches_day(daily.newest_1m_bar(doc or {}), through):
        log(f"[lake-cloud] {daily.REFERENCE_SYMBOL}'s live index does not reach {through}")
        return EXIT_FAILED
    r2.put_object(Bucket=bucket, Key=f"{prefix}{STATE}ledger.json", Body=json.dumps(new_ledger).encode(),
                  ContentType="application/json")
    r2.put_object(Bucket=bucket, Key=f"{prefix}{STATE}runner.json", ContentType="application/json",
                  Body=json.dumps({"published_through": through, "at": time.time(), "runner": "github-actions",
                                   "days": days, "built_at": built_at}).encode())
    log(f"[lake-cloud] published through {through} ({len(days)} days, {len(local)} packs)")
    code, msg = check_lag(r2, bucket, prefix, vendor_last, today)
    log(f"[lake-cloud] {msg}")
    return code


def compare_live(work: Path, bucket: str, prefix: str, *, sample: int = 200, seed: int = 7) -> int:
    """PROOF OF EQUIVALENCE, no writes: build every index the way `run` does, from every pack's TRAILER
    (none rebuilt), the split reference and ticker events in state, as of the ledger's last day, and
    compare them with the LIVE indexes (published by the PC's publish.py) for SPY, AAPL and `sample`
    random symbols. Prints symbol names and counts only. 0 when every compared document is identical."""
    import random
    r2 = r2_client()
    ledger = get_json(r2, bucket, f"{prefix}{STATE}ledger.json") or {}
    as_of = max((ledger.get("days") or {"": 0}).keys())
    rows = (get_json(r2, bucket, f"{prefix}{STATE}splits.json") or {}).get("rows") or []
    per_pack = []
    for key, size in list_keys(r2, bucket, f"{prefix}packs/"):
        sp = pack_key_of(key, prefix)
        if sp:
            per_pack.append((sp[0], sp[1], remote_trailer(r2, bucket, key, size, *sp)))
    indexes = merge_indexes(per_pack)
    publish.stamp_indexes(indexes, rows, as_of)
    events = Path(work) / "ref" / identity.EVENTS_FILE
    events.parent.mkdir(parents=True, exist_ok=True)
    r2.download_file(bucket, f"{prefix}{STATE}{identity.EVENTS_FILE}", str(events))
    identity.apply(indexes, identity.plan(identity.load_records(events), have=indexes.keys()))
    syms = sorted(indexes)
    pick = ["SPY", "AAPL"] + random.Random(seed).sample(syms, min(sample, len(syms)))
    same = differ = missing = 0
    for sym in pick:
        live = get_json(r2, bucket, f"{prefix}{piece.index_relpath(sym)}")
        if live is None:
            missing += 1
            log(f"  {sym}: no live index")
        elif publish._json_bytes(live) == publish._json_bytes(indexes[sym]):
            same += 1
        else:
            differ += 1
            log(f"  {sym}: DIFFERS from the live index")
    log(f"[lake-cloud] compare as of {as_of}: {len(per_pack)} packs, {len(indexes):,} symbols; "
        f"{same} identical, {differ} differ, {missing} missing of {len(pick)} compared")
    return EXIT_OK if differ == 0 and missing == 0 else EXIT_FAILED


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--work", type=Path, required=True)
    ap.add_argument("--bucket", default="uct-bars-snapshots")
    ap.add_argument("--prefix", default="hist/")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--check-only", action="store_true")
    ap.add_argument("--compare", type=int, metavar="N", help="prove equivalence with the live indexes (no writes)")
    a = ap.parse_args(argv)
    try:
        if a.compare is not None:
            return compare_live(a.work, a.bucket, a.prefix, sample=a.compare)
        return run(a.work, a.bucket, a.prefix, dry_run=a.dry_run, check_only=a.check_only, jobs=a.jobs)
    except publish.BuildError as e:
        log(f"[lake-cloud] FAILED: {e}")
        return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
