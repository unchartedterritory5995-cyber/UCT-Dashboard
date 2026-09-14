"""Reconcile the legacy classified #tsdr corpus with the Wisdom Discord store BY MESSAGE ID.

W1 §2.1: "reconcile with the 7,766 already-classified messages (2024-03-11 → 2026-02-20)
by message id so nothing double-counts". This reads the legacy export and sends
ONLY the ids — no text, no author, no classification — to

    POST {base}/api/internal/wisdom/sources/discord/legacy-ids   (PUSH_SECRET bearer)

which marks them legacy_classified = 1; the extraction view then never offers them
to the Wave 1 extractor. DRY-RUN BY DEFAULT: without --apply nothing is sent.

Usage:
  python tools/wisdom/sources_discord_legacy_ids.py \\
      --export C:/Users/Patrick/uct_intelligence/data/processed/processed_messages.json
  ... --apply            (after the sources routes are deployed; PUSH_SECRET in env)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

TSDR_CHANNEL = "882459873823043655"
_ID = re.compile(r"^\d{15,21}$")
_DISCORD_EPOCH_MS = 1420070400000
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 wisdom-legacy-ids"


def load_ids(path: str) -> list[str]:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, dict):
        data = next((v for v in data.values() if isinstance(v, list)), [])
    ids = []
    for row in data if isinstance(data, list) else []:
        if isinstance(row, dict):
            mid = str(row.get("message_id") or row.get("id") or "").strip()
            if _ID.match(mid):
                ids.append(mid)
    return list(dict.fromkeys(ids))


def snowflake_date(mid: str) -> str:
    ms = (int(mid) >> 22) + _DISCORD_EPOCH_MS
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).date().isoformat()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--export", required=True, help="legacy export JSON (processed_messages.json or the raw export)")
    ap.add_argument("--channel-id", default=TSDR_CHANNEL)
    ap.add_argument("--base", default="https://uctintelligence.com")
    ap.add_argument("--batch", type=int, default=500)
    ap.add_argument("--apply", action="store_true", help="actually POST the ids (default: dry-run)")
    args = ap.parse_args(argv)

    ids = load_ids(args.export)
    report = {"export": os.path.basename(args.export), "channel_id": args.channel_id, "ids": len(ids),
              "batches": (len(ids) + args.batch - 1) // max(1, args.batch), "dry_run": not args.apply}
    if ids:
        ordered = sorted(ids, key=int)
        report.update({"oldest_id": ordered[0], "newest_id": ordered[-1],
                       "date_range": [snowflake_date(ordered[0]), snowflake_date(ordered[-1])]})
    if not args.apply:
        print(json.dumps(report, indent=1))
        return 0

    secret = os.environ.get("PUSH_SECRET", "")
    if not secret:
        print("PUSH_SECRET is not set", file=sys.stderr)
        return 2
    import requests

    totals = {"inserted": 0, "marked_existing": 0, "already_marked": 0, "rejected": 0}
    url = f"{args.base.rstrip('/')}/api/internal/wisdom/sources/discord/legacy-ids"
    headers = {"Authorization": f"Bearer {secret}", "User-Agent": BROWSER_UA}
    for i in range(0, len(ids), args.batch):
        chunk = ids[i:i + args.batch]
        for attempt in range(3):
            resp = requests.post(url, json={"channel_id": args.channel_id, "message_ids": chunk},
                                 headers=headers, timeout=60)
            if resp.status_code < 500:
                break
            time.sleep(3 * (attempt + 1))
        if resp.status_code != 200:
            print(json.dumps({**report, "failed_batch": i // args.batch, "status": resp.status_code}))
            return 1
        for k in totals:
            totals[k] += int(resp.json().get(k) or 0)
    print(json.dumps({**report, **totals}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
