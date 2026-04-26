#!/usr/bin/env python3
"""Recompute UCT20 portfolio locally and push to the deployed dashboard.

Use when you need the portfolio reflected on Railway between morning wire runs
(e.g., to pick up Friday's EOD snapshot before Monday's wire run).

Reads the current wire_data.json (so we preserve all other dashboard sections),
overwrites uct20_portfolio with a freshly computed value, posts to /api/push.
"""
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent

try:
    from dotenv import load_dotenv
    for env_path in (ROOT / ".env", ROOT.parent / "morning-wire" / ".env"):
        if env_path.exists():
            load_dotenv(env_path)
except ImportError:
    pass

# Make sure uct-intelligence is importable
INTEL_DIR = ROOT.parent / "uct-intelligence"
if str(INTEL_DIR) not in sys.path:
    sys.path.insert(0, str(INTEL_DIR))

import uct_intelligence.api as uct_api  # noqa: E402

WIRE_DATA_PATH = ROOT.parent / "morning-wire" / "data" / "wire_data.json"
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "https://web-production-05cb6.up.railway.app")
PUSH_SECRET = os.environ.get("PUSH_SECRET", "")


def main():
    if not PUSH_SECRET:
        print("ERROR: PUSH_SECRET not set", file=sys.stderr)
        sys.exit(2)

    print("Loading existing wire_data.json...")
    with open(WIRE_DATA_PATH, "r", encoding="utf-8") as f:
        wire = json.load(f)

    print("Computing fresh UCT20 portfolio...")
    portfolio = uct_api.get_uct20_portfolio(account_size=50000, inception_date="2026-03-31")
    if not portfolio:
        print("ERROR: portfolio computation returned empty", file=sys.stderr)
        sys.exit(1)

    open_count = portfolio.get("open_count", 0)
    total_trades = portfolio.get("total_trades", 0)
    print(f"  {open_count} open positions, {total_trades} total trades")
    for p in portfolio.get("open_positions", [])[:5]:
        print(f"    {p['symbol']:6s}  entry {p['entry_date']}  pnl {p.get('pct_return','?'):.1f}%")
    if len(portfolio.get("open_positions", [])) > 5:
        print(f"    ... and {len(portfolio['open_positions']) - 5} more")

    wire["uct20_portfolio"] = portfolio

    print(f"Pushing to {DASHBOARD_URL}/api/push ...")
    r = requests.post(
        f"{DASHBOARD_URL.rstrip('/')}/api/push",
        json=wire,
        headers={"Authorization": f"Bearer {PUSH_SECRET}"},
        timeout=60,
    )
    if r.status_code >= 400:
        print(f"ERROR {r.status_code}: {r.text}", file=sys.stderr)
        sys.exit(1)
    print(f"  OK: {r.json()}")


if __name__ == "__main__":
    main()
