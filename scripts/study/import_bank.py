"""Study -- load the bank (docs/study/bank/*.json) into the live Study DB.

WHY
---
Every item is a DRAFT until the owner approves it on the review screen
(StudyReview, PatternReview `?mode=study`). The review screen reads
/data/study.db on the web pod, so the bank has to be imported there. The
import route (`POST /api/study/import`) is gated by the deploy's PUSH_SECRET,
which exists only as a pod env var -- so this script is meant to run ON the
pod, against the pod's own loopback port. It never reads the secret from a
file and never prints it.

WHAT THIS DOES
--------------
Posts each bank segment (one file = one request) to the import route, in file
order, and prints one line per segment with the server's counts:
`inserted / updated / terms` (rows written), `flagged` (stored as drafts with
import flags), `misses` (stored, bars not resolvable from bars.db yet),
`rejected` (bars sha mismatch; NOT stored). Re-runs are safe: the route
upserts by item id, so the same bank imports as `updated`, not duplicates.

HOW TO RUN (on the pod, from PowerShell; Git Bash mangles the python path)
--------------------------------------------------------------------------
  railway ssh --service web -- /opt/venv/bin/python scripts/study/import_bank.py --dry-run
  railway ssh --service web -- /opt/venv/bin/python scripts/study/import_bank.py
  railway ssh --service web -- /opt/venv/bin/python scripts/study/import_bank.py --only recall.glossary

First run 2026-10-19: 660 sent, 660 inserted, 0 flagged / misses / rejected,
205 bar snapshots stored.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Iterable

REPO = pathlib.Path(__file__).resolve().parents[2]
BANK_DIR = REPO / "docs" / "study" / "bank"

COUNT_KEYS = ("inserted", "updated", "terms", "flagged", "misses", "rejected")


def iter_bank(bank_dir: pathlib.Path, only: Iterable[str] = ()) -> list[tuple[str, list]]:
    """Return `(segment, items)` pairs in file order. `only` narrows to segments
    by stem (`recall.glossary`); an empty file is returned with `[]` so the
    caller can report it as skipped rather than silently missing."""
    want = {s.strip() for s in only if s and s.strip()}
    out: list[tuple[str, list]] = []
    for p in sorted(bank_dir.glob("*.json")):
        if want and p.stem not in want:
            continue
        with open(p, encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, list):
            raise ValueError(f"{p.name}: expected a JSON list of items")
        out.append((p.stem, data))
    return out


def summarise(resp: dict[str, Any]) -> dict[str, int]:
    """Collapse the route's response into integer counts. List-valued keys
    (`flagged`, `misses`, `rejected`) become their length; `ids` is dropped."""
    counts: dict[str, int] = {}
    for k in COUNT_KEYS:
        v = resp.get(k, 0)
        counts[k] = len(v) if isinstance(v, (list, tuple)) else int(v or 0)
    return counts


def add_totals(total: dict[str, int], counts: dict[str, int]) -> dict[str, int]:
    for k, v in counts.items():
        total[k] = total.get(k, 0) + v
    return total


def post_segment(url: str, secret: str, items: list, timeout: float = 600.0) -> dict[str, Any]:
    body = json.dumps({"items": items}).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Import docs/study/bank/*.json into the live Study DB.")
    ap.add_argument("--bank", default=str(BANK_DIR), help="bank directory (default docs/study/bank)")
    ap.add_argument("--url", default=None,
                    help="import route; default http://127.0.0.1:$PORT/api/study/import")
    ap.add_argument("--only", action="append", default=[],
                    help="segment stem to import (repeatable), e.g. recall.glossary")
    ap.add_argument("--dry-run", action="store_true", help="count the bank, post nothing")
    args = ap.parse_args(argv)

    segments = iter_bank(pathlib.Path(args.bank), args.only)
    if args.dry_run:
        n = 0
        for stem, items in segments:
            print(f"[import-bank] {stem}: {len(items)} items")
            n += len(items)
        print(f"[import-bank] dry-run: {len(segments)} segments, {n} items, nothing posted")
        return 0

    secret = os.environ.get("PUSH_SECRET", "")
    if not secret:
        print("[import-bank] PUSH_SECRET is not set; run this on the web pod", file=sys.stderr)
        return 2
    url = args.url or f"http://127.0.0.1:{os.environ.get('PORT', '8080')}/api/study/import"

    total: dict[str, int] = {}
    failed = 0
    for stem, items in segments:
        if not items:
            print(f"[import-bank] {stem}: empty, skipped")
            continue
        t0 = time.time()
        try:
            resp = post_segment(url, secret, items)
        except urllib.error.HTTPError as e:
            failed += 1
            print(f"[import-bank] {stem}: HTTP {e.code} {e.read()[:300]!r}")
            continue
        except (urllib.error.URLError, OSError) as e:
            failed += 1
            print(f"[import-bank] {stem}: {e}")
            continue
        counts = summarise(resp)
        add_totals(total, counts)
        print(f"[import-bank] {stem}: {len(items)} sent -> {counts} {time.time() - t0:.1f}s")
        for r in (resp.get("rejected") or [])[:3]:
            print("   rejected:", json.dumps(r)[:200])
        for r in (resp.get("misses") or [])[:3]:
            print("   miss:", json.dumps(r)[:200])
    print(f"[import-bank] TOTAL {total} failed_segments={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
