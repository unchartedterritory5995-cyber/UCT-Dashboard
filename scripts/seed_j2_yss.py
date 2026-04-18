"""
Seed a YSS reference Open Position for Journal 2.0 manual verification.

Spec §14.7 / Phase 3 gate: after running this against a real user, the
Open Positions row should show Risk $417.50, Heat $1,907.50, B/E Sell
55 (22%), P&L +$1,490.00 at the reference current price of $35.53.

Usage:
    python scripts/seed_j2_yss.py <user_email>

Scoped by email rather than UUID so it's easy to invoke manually. The
user must already exist in the users table (normal signup flow).

This script is READ-ONLY against the existing Journal tables — it only
writes to j2_positions.
"""

import json
import sys
import uuid
from datetime import datetime, timezone

from api.services.auth_db import get_connection, init_db


YSS = {
    "symbol": "YSS",
    "side": "Long",
    "entry_date": "2026-04-09T00:00:00Z",
    "shares": 250.0,
    "original_shares": 250.0,
    "entry_price": 29.57,
    "stop_price": 27.90,
    "breakeven_stop": None,
    "raise_to_breakeven": 0,
    "setup": "VCP",
    "notes": "§14.7 reference position — seed for Journal 2.0 Phase 3 verification",
    "context_at_entry": {
        "navCount": 0,
        "rallyDay": None,
        "powerTrend": None,
        "breadthValue": None,
        "breadthMetricName": "NASI RSI",
        "indexName": "NYA",
        "igRank": None,
        "rsRating": None,
    },
}


def main():
    if len(sys.argv) != 2:
        print("Usage: python scripts/seed_j2_yss.py <user_email>", file=sys.stderr)
        sys.exit(1)
    email = sys.argv[1].strip().lower()

    init_db()
    conn = get_connection()
    try:
        user_row = conn.execute(
            "SELECT id, email FROM users WHERE lower(email) = ?", (email,)
        ).fetchone()
        if user_row is None:
            print(f"User not found: {email}", file=sys.stderr)
            sys.exit(2)
        user_id = user_row["id"]

        # Skip if a YSS row from this seed already exists (idempotent manual reruns).
        existing = conn.execute(
            """
            SELECT id FROM j2_positions
             WHERE user_id = ? AND symbol = 'YSS' AND closed_at IS NULL
               AND entry_price = 29.57 AND original_shares = 250
            """,
            (user_id,),
        ).fetchone()
        if existing:
            print(f"YSS already seeded (id={existing['id']}) — no-op")
            return

        now = datetime.now(timezone.utc).isoformat()
        pid = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO j2_positions (
                id, user_id, symbol, side, entry_date, shares, original_shares,
                entry_price, stop_price, breakeven_stop, raise_to_breakeven,
                setup, notes, context_at_entry, created_at, updated_at, closed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                pid,
                user_id,
                YSS["symbol"],
                YSS["side"],
                YSS["entry_date"],
                YSS["shares"],
                YSS["original_shares"],
                YSS["entry_price"],
                YSS["stop_price"],
                YSS["breakeven_stop"],
                YSS["raise_to_breakeven"],
                YSS["setup"],
                YSS["notes"],
                json.dumps(YSS["context_at_entry"]),
                now,
                now,
                None,
            ),
        )
        conn.commit()
        print(f"Seeded YSS position (id={pid}) for user {email}")
        print()
        print("Expected values at current price $35.53:")
        print("  Risk $:     $417.50")
        print("  Heat $:     $1,907.50")
        print("  P&L $:      +$1,490.00")
        print("  P&L %:      +20.16%")
        print("  Stop Dist:  21.5%")
        print("  B/E Sell:   55 (22%)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
