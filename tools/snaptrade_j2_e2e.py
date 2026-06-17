"""End-to-end J2 ingestion test against the LIVE connected broker account.

Reuses the SnapTrade identity that tools/snaptrade_smoke_test.py registered +
portal-connected (state in tools/.snaptrade_smoke_state.json). Runs the REAL
broker_service.refresh_accounts + sync.sync_all_for_user against an ISOLATED
throwaway auth.db (AUTH_DB_PATH points at a temp file) so your local dev DB is
never touched. Then prints what landed in j2_accounts / j2_positions /
j2_trades / j2_broker_accounts / j2_broker_sync_log.

Run from the broker-sync worktree root:
  python tools/snaptrade_j2_e2e.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# --- load .env (creds + encryption key) BEFORE importing app modules ---------
for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

# --- isolate the DB: point AUTH_DB_PATH at a temp file before auth_db import --
_TMP = Path(tempfile.gettempdir()) / "uct_broker_e2e"
_TMP.mkdir(exist_ok=True)
os.environ["AUTH_DB_PATH"] = str(_TMP / "auth.db")
# fresh each run so the test is deterministic
(_TMP / "auth.db").unlink(missing_ok=True)
print(f"[e2e] isolated auth.db = {os.environ['AUTH_DB_PATH']}\n")

USER_ID = "uct_smoke_test_user"  # matches the registered SnapTrade user id


def _state() -> dict:
    p = ROOT / "tools" / ".snaptrade_smoke_state.json"
    if not p.exists():
        print("No smoke-test state. Run snaptrade_smoke_test.py register + portal first.")
        sys.exit(1)
    return json.loads(p.read_text())


async def main() -> None:
    from api.services import auth_db
    auth_db.init_db()

    from api.services.journal_two.broker import connections, service as broker_service
    from api.services.journal_two.broker import sync as sync_engine

    st = _state()
    # Seed the broker identity (encrypts the secret at rest, records consent).
    connections.save_broker_user(USER_ID, st["user_id"], st["user_secret"], record_consent=True)
    print("[e2e] seeded j2_broker_users (secret encrypted at rest)")

    # 1. Map the connected brokerage account(s) -> j2_account.
    accts = await broker_service.refresh_accounts(USER_ID)
    print(f"[e2e] refresh_accounts mapped {len(accts)} account(s):")
    for a in accts:
        print(f"      broker_account {a['id'][:8]}… | {a['brokerageName']} | "
              f"{a['accountNumberMasked']} -> j2_account {a['j2AccountId'][:8]}…")

    # 2. Run the real sync engine (full backfill).
    print("\n[e2e] running sync_all_for_user(full=True) …")
    results = await sync_engine.sync_all_for_user(USER_ID, full=True, cooldown_seconds=0.0)
    print("[e2e] sync results:", json.dumps(results, default=str, indent=2))

    # 3. Inspect what landed.
    conn = auth_db.get_connection()
    try:
        print("\n========== WHAT LANDED IN JOURNAL 2.0 ==========")

        rows = conn.execute(
            "SELECT id, name, broker, balance_source, starting_balance "
            "FROM j2_accounts WHERE user_id = ?", (USER_ID,)).fetchall()
        print(f"\nj2_accounts ({len(rows)}):")
        for r in rows:
            print(f"  {r['name']} | broker={r['broker']} | "
                  f"balance_source={r['balance_source']} | start={r['starting_balance']}")

        rows = conn.execute(
            "SELECT symbol, side, shares, entry_price, source, entry_estimated "
            "FROM j2_positions WHERE user_id = ? ORDER BY symbol", (USER_ID,)).fetchall()
        print(f"\nj2_positions ({len(rows)}) — open positions from holdings-as-truth:")
        for r in rows:
            est = " (cost-basis seed)" if (r["entry_estimated"] or 0) else " (exact basis from FIFO)"
            print(f"  {r['symbol']:6} {r['side']:5} shares={r['shares']:<10} "
                  f"@ {r['entry_price']} [{r['source']}]{est}")

        tcount = conn.execute(
            "SELECT COUNT(*) AS n FROM j2_trades WHERE user_id = ?", (USER_ID,)).fetchone()["n"]
        rows = conn.execute(
            "SELECT symbol, side, shares, entry_price, exit_price, pnl_dollar, fees, source "
            "FROM j2_trades WHERE user_id = ? ORDER BY exit_date DESC LIMIT 15", (USER_ID,)).fetchall()
        print(f"\nj2_trades total={tcount} (showing 15 most recent) — reconstructed closed trades:")
        for r in rows:
            print(f"  {r['symbol']:6} {r['side']:5} shares={r['shares']} "
                  f"entry={r['entry_price']} exit={r['exit_price']} pnl={r['pnl_dollar']} "
                  f"fees={r['fees']} [{r['source']}]")
        if not tcount:
            print("  (none)")

        ostrat = conn.execute(
            "SELECT COUNT(*) AS n FROM j2_option_strategies WHERE user_id = ?", (USER_ID,)).fetchone()["n"]
        print(f"\nj2_option_strategies total={ostrat}")

        rows = conn.execute(
            "SELECT broker_account_id, status, trades_imported, positions_upserted, "
            "options_imported, dup_candidates, error, started_at "
            "FROM j2_broker_sync_log WHERE user_id = ? ORDER BY started_at DESC LIMIT 5",
            (USER_ID,)).fetchall()
        print(f"\nj2_broker_sync_log (last {len(rows)}):")
        for r in rows:
            print(f"  acct={str(r['broker_account_id'])[:8]} status={r['status']} "
                  f"trades_imported={r['trades_imported']} positions_upserted={r['positions_upserted']} "
                  f"options_imported={r['options_imported']} dups={r['dup_candidates']} err={r['error']}")
    finally:
        conn.close()

    print("\n[e2e] DONE — isolated DB left at", os.environ["AUTH_DB_PATH"])


if __name__ == "__main__":
    asyncio.run(main())
