#!/usr/bin/env python3
"""Trigger a universe-wide bars cache warm on the deployed dashboard.

Run nightly via Windows Task Scheduler (e.g. 5:30 AM ET, before market open)
so every ticker in the cap universe + breadth lists is warm in disk cache by
the time the user starts scanning.

Usage:
    python scripts/trigger_warm_universe.py                 # uses production URL
    python scripts/trigger_warm_universe.py --tf W          # warm Weekly instead
    python scripts/trigger_warm_universe.py --poll          # block until complete

Env / .env vars:
    DASHBOARD_URL   default https://web-production-05cb6.up.railway.app
    PUSH_SECRET     required (Bearer auth)
"""
import argparse
import os
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent

try:
    from dotenv import load_dotenv
    # Pull PUSH_SECRET from common locations
    for env_path in (ROOT / ".env", ROOT.parent / "morning-wire" / ".env",
                     ROOT.parent / "uct-intelligence" / ".env"):
        if env_path.exists():
            load_dotenv(env_path)
except ImportError:
    pass


def main():
    parser = argparse.ArgumentParser(description="Trigger universe bars warm on the deployed dashboard")
    parser.add_argument("--url", default=os.environ.get("DASHBOARD_URL", "https://web-production-05cb6.up.railway.app"))
    parser.add_argument("--tf", default="D", help="Timeframe to warm (D, W, M, etc.)")
    parser.add_argument("--bars", type=int, default=5000, help="Bars per ticker")
    parser.add_argument("--poll", action="store_true", help="Block until warm completes, printing progress")
    parser.add_argument("--poll-interval", type=int, default=30, help="Seconds between status polls")
    args = parser.parse_args()

    secret = os.environ.get("PUSH_SECRET", "")
    if not secret:
        print("ERROR: PUSH_SECRET not set in environment / .env", file=sys.stderr)
        sys.exit(2)

    headers = {"Authorization": f"Bearer {secret}"}
    base = args.url.rstrip("/")

    # Kick off
    r = requests.post(f"{base}/api/admin/warm-universe",
                      params={"tf": args.tf, "bars": args.bars},
                      headers=headers, timeout=30)
    if r.status_code == 409:
        body = r.json()
        print(f"Already running since {body.get('started_iso')}: {body.get('done')}/{body.get('total')}")
    elif r.status_code >= 400:
        print(f"ERROR {r.status_code}: {r.text}", file=sys.stderr)
        sys.exit(1)
    else:
        body = r.json()
        print(f"Warm started: {body.get('total_tickers')} tickers, ~{body.get('estimated_minutes')} min ETA, tf={args.tf}")

    if not args.poll:
        return

    # Poll until done
    print("Polling status until complete...")
    last_done = -1
    while True:
        sr = requests.get(f"{base}/api/admin/warm-universe-status", timeout=15)
        s = sr.json()
        if not s.get("running"):
            print(f"Complete: done={s.get('done')}/{s.get('total')}  skipped={s.get('skipped')}  errors={s.get('errors')}")
            break
        done = s.get("done", 0)
        total = s.get("total", 0)
        if done != last_done:
            eta = s.get("eta_seconds")
            eta_min = f"{eta // 60}m" if eta else "?"
            print(f"  {done}/{total} ({s.get('skipped', 0)} cached, {s.get('errors', 0)} errors) — ETA {eta_min}")
            last_done = done
        time.sleep(args.poll_interval)


if __name__ == "__main__":
    main()
