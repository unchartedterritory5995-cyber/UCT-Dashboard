"""TRADE_DETECTION subscription management — list / add / cancel.

SnapTrade confirmed (Slack, 2026-08-21) that trade-detection subscriptions are
self-serve via the API. The pinned SDK (11.0.2xx) wraps the endpoints under
`experimental_endpoints`. Seat pricing (docs/trade-detection, 8/21):
300s $2.50 · 100s $7.50 · 25s $25 per account/month; Robinhood supports 300s+
only (which matches the free Recent Orders rail — don't buy seats there);
Webull has full support (100s/25s are the value tiers).

Runs ON the web pod (needs SNAPTRADE_* + BROKER_ENCRYPTION_KEY + auth.db):

  /opt/venv/bin/python /app/tools/snaptrade_trade_detection.py list
  /opt/venv/bin/python /app/tools/snaptrade_trade_detection.py add --account <snaptradeAccountId> --interval 300
  /opt/venv/bin/python /app/tools/snaptrade_trade_detection.py cancel --account <snaptradeAccountId>

`add`/`cancel` resolve the owning member's SnapTrade identity from
j2_broker_accounts + j2_broker_users automatically. The webhook consumer is
already wired (broker_sync.py routes TRADE_DETECTION into the sync queue), so
an added subscription is live end-to-end with zero further changes.
NOTE: `check_interval_seconds` must match an ACTIVE plan on the SnapTrade
customer dashboard (dashboard.snaptrade.com/webhooks) — activate the tier
there first if `add` returns 400.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, "/app")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _sdk():
    import snaptrade_client
    cid = os.environ.get("SNAPTRADE_CLIENT_ID")
    key = os.environ.get("SNAPTRADE_CONSUMER_KEY")
    if not cid or not key:
        sys.exit("SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY not set")
    return snaptrade_client.SnapTrade(consumer_key=key, client_id=cid)


def _body(resp):
    try:
        return resp.body
    except Exception:
        return resp


def _resolve_identity(snaptrade_account_id: str):
    """(user_id, snaptrade_user_id, user_secret) for the account's owner."""
    from api.services.auth_db import get_connection
    from api.services.journal_two.broker import connections

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT user_id FROM j2_broker_accounts WHERE snaptrade_account_id = ?",
            (snaptrade_account_id,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        sys.exit(f"no j2_broker_accounts row for snaptrade account {snaptrade_account_id}")
    bu = connections.get_broker_user(row["user_id"])
    if bu is None:
        sys.exit(f"no broker user identity for user {row['user_id']}")
    return row["user_id"], bu["snaptradeUserId"], bu["userSecret"]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="List active trade-detection subscriptions")
    p_add = sub.add_parser("add", help="Subscribe one account")
    p_add.add_argument("--account", required=True, help="snaptrade_account_id (UUID)")
    p_add.add_argument("--interval", type=int, required=True,
                       help="check_interval_seconds (must match an active plan; "
                            "300 for Robinhood-class, 100/25 for Webull-class)")
    p_cancel = sub.add_parser("cancel", help="Unsubscribe one account")
    p_cancel.add_argument("--account", required=True)
    args = ap.parse_args()

    api = _sdk().experimental_endpoints
    if args.cmd == "list":
        out = _body(api.list_subscriptions())
        print(json.dumps(out, indent=2, default=str))
    elif args.cmd == "add":
        user_id, su, secret = _resolve_identity(args.account)
        print(f"subscribing {args.account} (user {user_id[:8]}…) at {args.interval}s")
        out = _body(api.add_subscription(
            account_id=args.account,
            check_interval_seconds=args.interval,
            user_id=su, user_secret=secret,
        ))
        print(json.dumps(out, indent=2, default=str))
    elif args.cmd == "cancel":
        out = _body(api.cancel_subscription(account_id=args.account))
        print(json.dumps(out, indent=2, default=str))


if __name__ == "__main__":
    main()
