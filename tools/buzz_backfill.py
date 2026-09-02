# tools/buzz_backfill.py
"""One-time 30-day backfill of #main-chat mentions.

Usage: python tools/buzz_backfill.py [--days 30] [--channel <id>] [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import sys
import time


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--channel", default="")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    from dotenv import load_dotenv
    load_dotenv()
    from api.services import buzz_ingest, buzz_store

    buzz_store.init_db()
    chans = [args.channel] if args.channel else buzz_ingest.channels()
    t0 = time.time()
    for ch in chans:
        print(f"backfilling {ch} for {args.days} day(s)...")

        def progress(pages, fetched, rows):
            print(f"   page {pages:>4}  messages {fetched:>6}  mentions {rows:>6}", end="\r")

        if args.dry_run:
            page = buzz_ingest.fetch_messages(ch, limit=5)
            if page is None:
                print("   dry run: fetch FAILED (permission, rate limit or API error)")
            else:
                print(f"   dry run: {len(page)} message(s) readable")
            continue
        out = buzz_ingest.backfill(ch, days=args.days, progress=progress)
        print(f"\n   {out['pages']} pages, {out['fetched']} messages, {out['rows']} mentions")
        if out.get("truncated"):
            print("   ⚠️  TRUNCATED — hit a rate limit or an API error before reaching the "
                  "cutoff.\n       This is NOT the end of the channel's history. Re-run to continue.")
    print(f"done in {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.getcwd())
    raise SystemExit(main())
