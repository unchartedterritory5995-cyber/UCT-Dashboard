"""Study blocker B1 -- copy the Sunday Scans chart images into our own storage.

WHY
---
`wisdom_chart_images` rows for `origin='sunday_scans'` hold only a Substack CDN
`public_url` (`r2_key` is NULL, `status='provisional'`, and `label_ticker` is a
GUESS from the nearest short line of text). Study's "take the call" drills need
bytes we serve ourselves, with a content hash, and a ticker the OWNER confirmed.

WHAT THIS DOES
--------------
One resumable pass: for every provisional sunday_scans image, download the
bytes (browser User-Agent, bounded timeout, polite pacing), hash them, upload
to R2 under `study/scans/<sha256>.<ext>`, and record the result in a JSON
ledger (`STUDY_SCANS_LEDGER`, default `<DATA_DIR>/study_scans_ledger.json`).
Idempotent by `image_id`; a re-run skips what the ledger already holds and
retries what failed. It NEVER writes to `wisdom_chart_images` (that table is the
Wisdom programme's) and NEVER trusts `label_ticker` -- it is copied into the
ledger as `ticker_hint` for the owner's review screen to confirm or correct.

HOW TO RUN
----------
  python scripts/study/copy_scans_images.py --dry-run         # count only
  python scripts/study/copy_scans_images.py --limit 50        # a first batch
  python scripts/study/copy_scans_images.py                   # the rest

Needs the wisdom DB (WISDOM_DB_PATH) and R2 (DATA_SYNC_*) reachable, i.e. the
web pod (`railway ssh`) or a box with both. Pure helpers are unit-tested in
tests/test_study_copy_scans_images.py; the network and R2 doors are injected.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Callable, Iterable, Optional

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

R2_PREFIX = "study/scans/"
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/129.0 Safari/537.36")
_CONTENT_TYPES = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
}


def ledger_path() -> Path:
    env = os.environ.get("STUDY_SCANS_LEDGER")
    if env:
        return Path(env)
    return Path(os.environ.get("DATA_DIR", "/data")) / "study_scans_ledger.json"


def load_ledger(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_ledger(path: Path, ledger: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(ledger, indent=1, sort_keys=True), encoding="utf-8")
    os.replace(tmp, path)


def ext_for(content_type: Optional[str], data: bytes) -> Optional[str]:
    """The file extension for an image payload, by content type then by magic
    bytes. None when it is not an image we accept (an HTML error page is the
    common case: a hot-link that died)."""
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct in _CONTENT_TYPES:
        return _CONTENT_TYPES[ct]
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    return None


def r2_key_for(sha256_hex: str, ext: str) -> str:
    return f"{R2_PREFIX}{sha256_hex}.{ext}"


def pending_rows(conn: sqlite3.Connection) -> list[dict]:
    """Every sunday_scans image with a public_url, oldest source first."""
    rows = conn.execute(
        """SELECT image_id, source_id, segment_id, public_url, width, height,
                  label_text, label_ticker, label_timeframe, created_at
             FROM wisdom_chart_images
            WHERE origin = 'sunday_scans' AND public_url IS NOT NULL AND public_url != ''
            ORDER BY created_at, image_id"""
    ).fetchall()
    cols = ["image_id", "source_id", "segment_id", "public_url", "width", "height",
            "label_text", "label_ticker", "label_timeframe", "created_at"]
    return [dict(zip(cols, r)) for r in rows]


def copy_one(row: dict, *, fetch: Callable[[str], tuple[int, Optional[str], bytes]],
             put: Callable[[str, bytes, str], bool]) -> dict:
    """Download one image and upload it. Returns the ledger entry for it; a
    failure is recorded with `status` != 'stored' and a reason, never raised."""
    entry = {
        "image_id": row["image_id"], "source_id": row["source_id"],
        "segment_id": row.get("segment_id"), "public_url": row["public_url"],
        "ticker_hint": row.get("label_ticker"), "label_text": row.get("label_text"),
        "timeframe_hint": row.get("label_timeframe"),
        "ticker_confirmed": None,  # the owner's review screen fills this
    }
    try:
        status_code, content_type, data = fetch(row["public_url"])
    except Exception as exc:  # noqa: BLE001 - a dead link must not stop the pass
        return {**entry, "status": "fetch_error", "reason": f"{type(exc).__name__}: {exc}"}
    if status_code != 200 or not data:
        return {**entry, "status": "fetch_failed", "reason": f"http {status_code}"}
    ext = ext_for(content_type, data)
    if ext is None:
        return {**entry, "status": "not_an_image",
                "reason": f"content-type {content_type!r}, {len(data)} bytes"}
    sha = hashlib.sha256(data).hexdigest()
    key = r2_key_for(sha, ext)
    if not put(key, data, f"image/{'jpeg' if ext == 'jpg' else ext}"):
        return {**entry, "status": "put_failed", "reason": "R2 put returned False"}
    return {**entry, "status": "stored", "r2_key": key, "sha256": sha,
            "bytes": len(data), "ext": ext}


def run(rows: Iterable[dict], ledger: dict, *, fetch, put, limit: Optional[int] = None,
        pace_seconds: float = 0.25, sleep=time.sleep, on_progress=None) -> dict:
    """Copy every row the ledger does not already hold as 'stored'. Returns
    counts. The ledger dict is mutated in place so a caller can save it."""
    counts = {"stored": 0, "skipped": 0, "failed": 0}
    done = 0
    for row in rows:
        prior = ledger.get(row["image_id"])
        if prior and prior.get("status") == "stored":
            counts["skipped"] += 1
            continue
        if limit is not None and done >= limit:
            break
        entry = copy_one(row, fetch=fetch, put=put)
        ledger[row["image_id"]] = entry
        done += 1
        if entry["status"] == "stored":
            counts["stored"] += 1
        else:
            counts["failed"] += 1
        if on_progress:
            on_progress(entry)
        if pace_seconds:
            sleep(pace_seconds)
    return counts


def _real_fetch(url: str):
    import httpx
    with httpx.Client(timeout=20.0, follow_redirects=True,
                      headers={"User-Agent": _UA}) as client:
        resp = client.get(url)
        return resp.status_code, resp.headers.get("content-type"), resp.content


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="count only; fetch nothing")
    ap.add_argument("--limit", type=int, default=None, help="max images to copy this run")
    ap.add_argument("--pace", type=float, default=0.25, help="seconds between fetches")
    args = ap.parse_args(argv)

    from api.services import data_sync
    from api.services.wisdom.core import store as wisdom_store

    conn = wisdom_store.connect()
    try:
        rows = pending_rows(conn)
    finally:
        conn.close()
    path = ledger_path()
    ledger = load_ledger(path)
    stored_already = sum(1 for v in ledger.values() if v.get("status") == "stored")
    print(f"[scans-copy] {len(rows)} sunday_scans images in wisdom_chart_images; "
          f"{stored_already} already stored in {path}")
    if args.dry_run:
        return 0
    if data_sync._client() is None:  # noqa: SLF001 - the one honest readiness check
        print("[scans-copy] R2 is not configured (DATA_SYNC_*); refusing to run", file=sys.stderr)
        return 2

    seen = {"n": 0}

    def progress(entry):
        print(f"[scans-copy] {entry['image_id'][:24]} {entry['status']}"
              + (f" {entry['r2_key']}" if entry.get("r2_key") else f" {entry.get('reason', '')}"))
        seen["n"] += 1
        if seen["n"] % 25 == 0:  # checkpoint the ledger so a killed run resumes
            save_ledger(path, ledger)

    counts = run(rows, ledger, fetch=_real_fetch, put=data_sync.put_bytes,
                 limit=args.limit, pace_seconds=args.pace, on_progress=progress)
    save_ledger(path, ledger)
    print(f"[scans-copy] done: {counts}")
    return 0 if counts["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
