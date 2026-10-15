"""Import the LOCAL TSDR Ledger backup into the admin-only wisdom archive.

Reads a local directory (never committed — this repo is public) and POSTs it in batches to
POST /api/internal/wisdom/archive/batch. DRY-RUN BY DEFAULT: without --send nothing leaves
the machine; the script validates every item exactly as the server would and prints counts.

    python tools/wisdom/archive_import.py --src "C:\\path\\to\\TSDR-Ledger-Backup"
    python tools/wisdom/archive_import.py --src "C:\\path\\to\\TSDR-Ledger-Backup" \\
        --url https://uctintelligence.com --send

Layout read under --src:
  records/records/t*.json   {author, date, type, tickers, quote, note[, source]}
  records/retired.json      {record_id: reason}  -- these records are skipped
  images/by_record.json     {record_id: [image, ...]}  -- optional, only the COUNT is sent
  scored/calls.jsonl        one call per line (call_id, record, author, ticker, ...)

The push secret is read from the PUSH_SECRET environment variable and is never printed.
Records whose author is not one of the team authors in docs/wisdom/authors.json are never
sent; record types other than CALL/RESULT/LESSON/MACRO are dropped. Nothing else is
stripped. Only whitelisted fields are sent (no share counts, no position sizes).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from api.services.wisdom.archive import service  # noqa: E402

BATCH = 1000
RETRIES = 4
CALL_KEYS = ("ticker", "direction", "setup", "action", "posted", "entry", "stop", "target", "conf", "reported")


def _sha(obj) -> str:
    body = json.dumps(obj, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _load_json(path: pathlib.Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def build_records(src: pathlib.Path, counts: dict) -> list:
    retired = set(_load_json(src / "records" / "retired.json", {}) or {})
    images = _load_json(src / "images" / "by_record.json", {}) or {}
    authors = service.team_authors()
    out = []
    for f in sorted((src / "records" / "records").glob("t*.json")):
        counts["records_read"] += 1
        rid = f.stem
        if rid in retired:
            counts["records_retired"] += 1
            continue
        raw = json.loads(f.read_text(encoding="utf-8"))
        if raw.get("author") not in authors:
            counts["records_unknown_author"] += 1
            continue
        if raw.get("type") not in service.RECORD_TYPES:
            counts["records_bad_type"] += 1
            continue
        imgs = images.get(rid) or []
        item = {
            "record_id": rid, "author_id": raw.get("author"), "stated_date": raw.get("date"),
            "record_type": raw.get("type"), "tickers": raw.get("tickers") or [],
            "note": raw.get("note") or "", "quote": raw.get("quote") or "",
            "image_count": len(imgs) if isinstance(imgs, list) else 0,
        }
        item["sha"] = _sha(item)
        out.append(item)
    return out


def build_calls(src: pathlib.Path, counts: dict, sent_records: set) -> list:
    path = src / "scored" / "calls.jsonl"
    authors = service.team_authors()
    out = []
    if not path.exists():
        return out
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            counts["calls_read"] += 1
            raw = json.loads(line)
            if raw.get("author") not in authors:
                counts["calls_unknown_author"] += 1
                continue
            if raw.get("record") not in sent_records:
                counts["calls_orphan_record"] += 1      # retired / dropped / unknown-author record
                continue
            item = {"call_id": raw.get("call_id"), "record_id": raw.get("record"), "author_id": raw.get("author")}
            for k in CALL_KEYS:
                item[k] = raw.get(k)
            item["outcome"] = {k: raw[k] for k in service.OUTCOME_FIELDS if raw.get(k) is not None}
            modes = [f"{k}={raw[k]}" for k in ("entry_mode", "stop_mode", "sim_stop_mode") if raw.get(k)]
            item["methodology"] = ";".join(modes) or None
            item["sha"] = _sha(item)
            out.append(item)
    return out


def validate_locally(kind: str, items: list, counts: dict) -> list:
    """Same validators as the server, so a dry run predicts what --send would reject."""
    fn = service.validate_record if kind == "records" else service.validate_call
    good = []
    for item in items:
        try:
            fn(item)
            good.append(item)
        except service.ItemError as exc:
            counts[f"{kind}_invalid"] += 1
            key = f"{kind}_invalid::{str(exc)[:60]}"
            counts[key] = counts.get(key, 0) + 1
    return good


def post_batch(url: str, secret: str, kind: str, items: list) -> dict:
    data = json.dumps({"kind": kind, "items": items}).encode("utf-8")
    last = None
    for attempt in range(RETRIES):
        req = urllib.request.Request(
            url.rstrip("/") + "/api/internal/wisdom/archive/batch", data=data, method="POST",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}",
                     # Cloudflare 1010-blocks bare script user agents.
                     "User-Agent": "Mozilla/5.0 (uct-wisdom-archive-import)"})
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403, 404, 422):
                raise SystemExit(f"batch refused: HTTP {exc.code} {exc.read()[:300]!r}")
            last = f"HTTP {exc.code}"
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = type(exc).__name__
        time.sleep(2 ** attempt)
    raise SystemExit(f"batch failed after {RETRIES} attempts ({last})")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", required=True, help="local TSDR-Ledger-Backup directory")
    ap.add_argument("--url", default="https://uctintelligence.com", help="dashboard base URL")
    ap.add_argument("--send", action="store_true", help="actually POST (default: dry run)")
    ap.add_argument("--only", choices=("records", "calls"), help="import one kind only")
    ap.add_argument("--batch", type=int, default=BATCH)
    args = ap.parse_args(argv)

    src = pathlib.Path(args.src)
    if not (src / "records" / "records").is_dir():
        print(f"--src has no records/records directory: {src}", file=sys.stderr)
        return 2
    counts = {k: 0 for k in ("records_read", "records_retired", "records_unknown_author", "records_bad_type",
                             "records_invalid", "calls_read", "calls_unknown_author", "calls_orphan_record",
                             "calls_invalid")}
    records = validate_locally("records", build_records(src, counts), counts)
    calls = validate_locally("calls", build_calls(src, counts, {r["record_id"] for r in records}), counts)
    counts["records_to_send"] = len(records)
    counts["calls_to_send"] = len(calls)

    totals: dict = {}
    if args.send:
        secret = os.environ.get("PUSH_SECRET", "")
        if not secret:
            print("PUSH_SECRET is not set in the environment", file=sys.stderr)
            return 2
        batch = max(1, min(args.batch, 2000))
        for kind, items in (("records", records), ("calls", calls)):
            if args.only and args.only != kind:
                continue
            for i in range(0, len(items), batch):
                res = post_batch(args.url, secret, kind, items[i:i + batch])
                for k in ("inserted", "updated", "unchanged", "rejected"):
                    totals[f"{kind}_{k}"] = totals.get(f"{kind}_{k}", 0) + int(res.get(k, 0))
                print(f"  {kind} {i + 1}-{i + len(items[i:i + batch])}: "
                      f"+{res.get('inserted', 0)} ~{res.get('updated', 0)} ={res.get('unchanged', 0)} "
                      f"x{res.get('rejected', 0)}", flush=True)
    print(("SENT" if args.send else "DRY RUN (nothing sent; pass --send)") + f" -> {args.url}")
    for k in sorted(counts):
        print(f"  {k}: {counts[k]}")
    for k in sorted(totals):
        print(f"  server {k}: {totals[k]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
