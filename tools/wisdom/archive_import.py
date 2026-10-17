"""Import the LOCAL TSDR Ledger backup into the wisdom (TSDR trader) archive.

Reads a local directory (never committed — this repo is public) and POSTs it in batches to
POST /api/internal/wisdom/archive/batch. DRY-RUN BY DEFAULT: without --send nothing leaves
the machine; the script validates every item exactly as the server would and prints counts.

    python tools/wisdom/archive_import.py --src "C:\\path\\to\\TSDR-Ledger-Backup"
    python tools/wisdom/archive_import.py --src "C:\\path\\to\\TSDR-Ledger-Backup" \\
        --url https://uctintelligence.com --send

Layout read under --src:
  records/records/t*.json   {author, date, type, tickers, quote, note[, source]}
  records/zoom/z*.json      spoken Live Trading Session segments; only those a call in
                            scored/calls.jsonl cites are sent. The quote is the spoken segment
                            and the tickers are the reviewed calls' tickers (the file's own
                            tickers field is a machine candidate list).
  records/retired.json      {record_id: reason}  -- these records are skipped
  images/by_record.json     {record_id: [image, ...]}  -- optional, only the COUNT is sent
  scored/calls.jsonl        one call per line (call_id, record, author, ticker, ...)
  images/<author>/<yyyy-mm>/*.png|jpg|webp   chart images, sent only with --only images:
                            --scope library = the charts the setup library's winners, failures and
                            teachings show; calls = every chart of a record with a scored call;
                            all = every chart of every sent record. One POST per image, after asking
                            the server which ones it is missing, so a re-run sends only the rest.
  structured/setup_library/<setup>.json   one setup playbook per file (index.json is skipped);
                            traders are display names there and are mapped back to author slugs.
                            Image paths and long quotes are NOT sent; teachings and examples
                            citing a record that is not sent are dropped.

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

from api.services.wisdom.archive import images as archive_images  # noqa: E402
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


def _spoken_record_tickers(src: pathlib.Path) -> dict:
    """{z record id: sorted tickers of the calls that cite it}, from scored/calls.jsonl.

    A spoken record is sent only when a call cites it, and its tickers are the reviewed
    calls' tickers, never the record file's own machine candidate list."""
    path = src / "scored" / "calls.jsonl"
    out: dict = {}
    if not path.exists():
        return out
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            raw = json.loads(line)
            rid = str(raw.get("record") or "")
            if rid.startswith("z"):
                out.setdefault(rid, set()).add(str(raw.get("ticker") or "").upper())
    return {rid: sorted(t for t in ts if t) for rid, ts in out.items()}


def _record_files(src: pathlib.Path, spoken: dict) -> list:
    """[(record id, path, ticker override or None)]: every written record, then every cited
    spoken record whose file exists."""
    files = [(f.stem, f, None) for f in sorted((src / "records" / "records").glob("t*.json"))]
    zdir = src / "records" / "zoom"
    for rid in sorted(spoken):
        f = zdir / f"{rid}.json"
        if f.is_file():
            files.append((rid, f, spoken[rid]))
    return files


def build_records(src: pathlib.Path, counts: dict) -> list:
    retired = set(_load_json(src / "records" / "retired.json", {}) or {})
    images = _load_json(src / "images" / "by_record.json", {}) or {}
    authors = service.team_authors()
    out = []
    for rid, f, tickers in _record_files(src, _spoken_record_tickers(src)):
        counts["records_read"] += 1
        if rid.startswith("z"):
            counts["records_spoken_read"] += 1
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
            "record_type": raw.get("type"),
            "tickers": tickers if tickers is not None else (raw.get("tickers") or []),
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


_TEACHING_KEYS = ("record_id", "author_id", "date", "note")
_EXAMPLE_KEYS = ("call_id", "record_id", "ticker", "author_id", "posted", "direction", "action", "evidence",
                 "r20", "sim_R", "regime")


def _slug(name, authors) -> str | None:
    s = str(name or "").strip().lower()
    return s if s in authors else None


def build_setups(src: pathlib.Path, counts: dict, sent_records: set) -> list:
    """One playbook per setup from the local setup library. Traders come in as display names
    (TSDR, AtTheAsk, ...) and leave as author slugs; anything citing a record that is not being
    sent is dropped and counted, never sent dangling."""
    lib = src / "structured" / "setup_library"
    authors = service.team_authors()
    out = []
    if not lib.is_dir():
        return out
    for f in sorted(lib.glob("*.json")):
        if f.name == "index.json":
            continue
        counts["setups_read"] += 1
        raw = json.loads(f.read_text(encoding="utf-8"))

        def rows(items, keys, kind):
            kept = []
            for r in items or []:
                rid = r.get("record_id") or r.get("record")
                author = _slug(r.get("trader") or r.get("author_id"), authors)
                if rid not in sent_records or author is None:
                    counts[f"setup_{kind}_dropped"] += 1
                    continue
                full = {**r, "record_id": rid, "author_id": author}
                kept.append({k: full.get(k) for k in keys})
            return kept

        item = {
            "setup_id": raw.get("id"), "name": raw.get("name"), "family": raw.get("family"),
            "aliases": raw.get("aliases") or [],
            "used_by": [a for a in (_slug(u, authors) for u in raw.get("used_by") or []) if a],
            "stats": raw.get("stats") or {}, "stats_trades": raw.get("stats_trades") or {},
            "context": raw.get("context") or {},
            "teachings": rows(raw.get("teachings"), _TEACHING_KEYS, "teachings"),
            "winners": rows(raw.get("winners"), _EXAMPLE_KEYS, "examples"),
            "failures": rows(raw.get("failures"), _EXAMPLE_KEYS, "examples"),
        }
        item["sha"] = _sha(item)
        out.append(item)
    return out


_VALIDATORS = {"records": service.validate_record, "calls": service.validate_call,
               "setups": service.validate_setup}


def validate_locally(kind: str, items: list, counts: dict) -> list:
    """Same validators as the server, so a dry run predicts what --send would reject."""
    fn = _VALIDATORS[kind]
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


IMAGE_SCOPES = ("library", "calls", "all")


def _library_image_paths(src: pathlib.Path) -> dict:
    """{record_id: [relative image path, ...]} exactly as the setup library shows them."""
    out: dict = {}
    lib = src / "structured" / "setup_library"
    for f in sorted(lib.glob("*.json")) if lib.is_dir() else []:
        if f.name == "index.json":
            continue
        raw = json.loads(f.read_text(encoding="utf-8"))
        for key in ("winners", "failures", "teachings"):
            for row in raw.get(key) or []:
                rid = row.get("record_id") or row.get("record")
                for path in row.get("images") or []:
                    lst = out.setdefault(rid, [])
                    if path not in lst:
                        lst.append(path)
    return out


def build_images(src: pathlib.Path, counts: dict, sent_records: set, scope: str, max_mb: float) -> list:
    """[{record_id, ordinal, path, image_id, bytes}] for the scope, validated like the server does.
    ordinal = the image's position in the record's own list (images/by_record.json)."""
    by_record = _load_json(src / "images" / "by_record.json", {}) or {}
    if scope == "library":
        wanted = _library_image_paths(src)
    elif scope == "calls":
        scored: set = set()
        path = src / "scored" / "calls.jsonl"
        if path.exists():
            with path.open(encoding="utf-8") as fh:
                for line in fh:
                    if line.strip():
                        raw = json.loads(line)
                        if raw.get("status") == "scored":
                            scored.add(raw.get("record"))
        wanted = {rid: by_record.get(rid) or [] for rid in scored}
    else:
        wanted = dict(by_record)
    cap = int(max_mb * 1024 * 1024)
    out, seen = [], set()
    for rid in sorted(wanted):
        if rid not in sent_records:
            counts["images_record_not_sent"] += len(wanted[rid] or [])
            continue
        own = by_record.get(rid) or []
        for rel in wanted[rid] or []:
            counts["images_read"] += 1
            f = src / rel
            if not f.is_file():
                counts["images_missing_file"] += 1
                continue
            size = f.stat().st_size
            if size > min(cap, archive_images.MAX_BYTES):
                counts["images_oversize"] += 1
                continue
            data = f.read_bytes()
            try:
                image_id, _ = archive_images.validate(data)
            except archive_images.ImageError:
                counts["images_bad_type"] += 1
                continue
            if image_id in seen:
                counts["images_duplicate"] += 1
                continue
            seen.add(image_id)
            ordinal = own.index(rel) if rel in own else 0
            out.append({"record_id": rid, "ordinal": ordinal, "path": str(f), "image_id": image_id,
                        "bytes": size})
    counts["images_to_send"] = len(out)
    counts["images_to_send_mb"] = round(sum(i["bytes"] for i in out) / 1024 / 1024, 1)
    return out


def _post_json(url: str, secret: str, path: str, body: dict, timeout: int = 120) -> dict:
    data = json.dumps(body).encode("utf-8")
    last = None
    for attempt in range(RETRIES):
        req = urllib.request.Request(
            url.rstrip("/") + path, data=data, method="POST",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}",
                     "User-Agent": "Mozilla/5.0 (uct-wisdom-archive-import)"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403, 404, 422):
                raise SystemExit(f"{path} refused: HTTP {exc.code} {exc.read()[:300]!r}")
            last = f"HTTP {exc.code}"
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = type(exc).__name__
        time.sleep(2 ** attempt)
    raise SystemExit(f"{path} failed after {RETRIES} attempts ({last})")


def send_images(url: str, secret: str, items: list, totals: dict) -> None:
    import base64

    need: set = set()
    ids = [i["image_id"] for i in items]
    for i in range(0, len(ids), 1000):
        need |= set(_post_json(url, secret, "/api/internal/wisdom/archive/images/missing",
                               {"image_ids": ids[i:i + 1000]}).get("missing") or [])
    totals["images_already_stored"] = len(items) - len(need)
    todo = [i for i in items if i["image_id"] in need]
    for n, item in enumerate(todo, 1):
        data = pathlib.Path(item["path"]).read_bytes()
        res = _post_json(url, secret, "/api/internal/wisdom/archive/image",
                         {"record_id": item["record_id"], "ordinal": item["ordinal"],
                          "data_b64": base64.b64encode(data).decode("ascii")})
        key = f"images_{res.get('status', 'unknown')}"
        totals[key] = totals.get(key, 0) + 1
        if n % 100 == 0 or n == len(todo):
            print(f"  images {n}/{len(todo)}", flush=True)


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
    ap.add_argument("--only", choices=service.KINDS + ("images",),
                    help="import one kind only (images are sent ONLY when named here)")
    ap.add_argument("--scope", choices=IMAGE_SCOPES, default="library",
                    help="with --only images: which charts (default library)")
    ap.add_argument("--max-mb", type=float, default=3.0, help="with --only images: skip larger files")
    ap.add_argument("--batch", type=int, default=BATCH)
    args = ap.parse_args(argv)

    src = pathlib.Path(args.src)
    if not (src / "records" / "records").is_dir():
        print(f"--src has no records/records directory: {src}", file=sys.stderr)
        return 2
    counts = {k: 0 for k in ("records_read", "records_spoken_read", "records_retired", "records_unknown_author", "records_bad_type",
                             "records_invalid", "calls_read", "calls_unknown_author", "calls_orphan_record",
                             "calls_invalid", "setups_read", "setups_invalid", "setup_teachings_dropped",
                             "setup_examples_dropped", "images_read", "images_record_not_sent",
                             "images_missing_file", "images_oversize", "images_bad_type",
                             "images_duplicate")}
    records = validate_locally("records", build_records(src, counts), counts)
    calls = validate_locally("calls", build_calls(src, counts, {r["record_id"] for r in records}), counts)
    setups = validate_locally("setups", build_setups(src, counts, {r["record_id"] for r in records}), counts)
    counts["records_to_send"] = len(records)
    counts["calls_to_send"] = len(calls)
    counts["setups_to_send"] = len(setups)
    imgs = (build_images(src, counts, {r["record_id"] for r in records}, args.scope, args.max_mb)
            if args.only == "images" else [])

    totals: dict = {}
    if args.send:
        secret = os.environ.get("PUSH_SECRET", "")
        if not secret:
            print("PUSH_SECRET is not set in the environment", file=sys.stderr)
            return 2
        batch = max(1, min(args.batch, 2000))
        if args.only == "images":
            send_images(args.url, secret, imgs, totals)
        for kind, items in (("records", records), ("calls", calls), ("setups", setups)):
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
