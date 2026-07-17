"""SnapTrade end-to-end smoke test (manual, local).

Validates the whole broker-sync ecosystem against the LIVE SnapTrade API
WITHOUT touching auth.db / J2 — it drives the isolated wrapper
(`api/services/journal_two/broker/snaptrade_client.py`) directly.

Reads creds from the environment (or the repo .env if present):
  SNAPTRADE_CLIENT_ID, SNAPTRADE_CONSUMER_KEY   — required
  BROKER_ENCRYPTION_KEY                          — required for `crypto`

Usage (run from the broker-sync worktree root):
  python tools/snaptrade_smoke_test.py status        # 1. creds valid? (api_status.check)
  python tools/snaptrade_smoke_test.py crypto        # 2. encrypt/decrypt round-trip
  python tools/snaptrade_smoke_test.py register       # 3. register a throwaway SnapTrade user
  python tools/snaptrade_smoke_test.py portal         # 4. mint a Connection-Portal URL (open in browser, connect a broker)
  python tools/snaptrade_smoke_test.py data           # 5. list accounts/balances/positions/activities for the test user
  python tools/snaptrade_smoke_test.py cleanup        # 6. delete the throwaway SnapTrade user (revokes connections)
  python tools/snaptrade_smoke_test.py all            # status -> crypto -> register -> portal (then you connect, then `data`)

The throwaway user id + secret are persisted to tools/.snaptrade_smoke_state.json
(gitignored — it contains a userSecret) so `portal`/`data`/`cleanup` reuse the
same identity across invocations.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

# --- make the repo importable + load .env -----------------------------------
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

def _load_dotenv() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        os.environ.setdefault(k, v)

_load_dotenv()

STATE = ROOT / "tools" / ".snaptrade_smoke_state.json"
TEST_USER_ID = "uct_smoke_test_user"


def _save_state(d: dict) -> None:
    STATE.write_text(json.dumps(d, indent=2), encoding="utf-8")
    print(f"  (state saved -> {STATE})")


def _load_state() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {}


def cmd_status() -> None:
    from snaptrade_client import SnapTrade
    cid = os.getenv("SNAPTRADE_CLIENT_ID")
    ck = os.getenv("SNAPTRADE_CONSUMER_KEY")
    if not cid or not ck:
        print("FAIL: SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY not set.")
        sys.exit(1)
    print(f"clientId = {cid}")
    print(f"consumerKey = {ck[:6]}…{ck[-4:]} (len {len(ck)})")
    s = SnapTrade(consumer_key=ck, client_id=cid)
    resp = s.api_status.check()
    print("API status OK:", json.dumps(getattr(resp, "body", resp), default=str, indent=2))


def cmd_crypto() -> None:
    from api.services import crypto_box
    if not crypto_box.is_configured():
        print("FAIL: BROKER_ENCRYPTION_KEY not set.")
        sys.exit(1)
    secret = "test-user-secret-abc123"
    blob = crypto_box.encrypt(secret)
    back = crypto_box.decrypt(blob)
    print(f"encrypt -> {blob[:24]}…")
    print(f"decrypt round-trip {'OK' if back == secret else 'FAIL'}")
    if back != secret:
        sys.exit(1)


async def cmd_register() -> None:
    from api.services.journal_two.broker import snaptrade_client as snap
    print(f"Registering throwaway SnapTrade user '{TEST_USER_ID}' …")
    try:
        out = await snap.register_user(TEST_USER_ID)
    except snap.SnapError as e:
        # If already registered, SnapTrade 400s — recover the secret only via reset.
        print(f"register raised: {type(e).__name__}: {e}")
        print("If this user already exists, run `cleanup` first, then `register` again.")
        sys.exit(1)
    _save_state({"user_id": out["snaptrade_user_id"], "user_secret": out["user_secret"]})
    print(f"  snaptrade_user_id = {out['snaptrade_user_id']}")
    print(f"  user_secret = {out['user_secret'][:6]}… (stored)")


async def cmd_portal(broker: str | None = None) -> None:
    from api.services.journal_two.broker import snaptrade_client as snap
    st = _load_state()
    if not st.get("user_id"):
        print("No registered user. Run `register` first.")
        sys.exit(1)
    uri = await snap.login_redirect_uri(
        st["user_id"], st["user_secret"], broker=broker, connection_type="read")
    print("\n=== OPEN THIS URL IN A BROWSER TO CONNECT A BROKERAGE ===\n")
    print(uri)
    if broker:
        print(f"\n(Portal pinned to broker={broker}.)")
    print("\nIn the portal pick a brokerage (use SnapTrade's TEST brokerage for a dry run),")
    print("finish the flow, then run:  python tools/snaptrade_smoke_test.py data\n")


async def cmd_sandbox() -> None:
    """E2E against SnapTrade's synthetic SANDBOX brokerage (NON-PRODUCTION
    keys only; enabled by default there). Scenario accounts come pre-loaded
    with positions/orders/transactions incl. error cases — the full
    connect → backfill → sync path without a real brokerage login.
    Flow: register → this (opens portal pinned to SANDBOX) → data."""
    await cmd_portal(broker="SANDBOX")


async def cmd_data() -> None:
    from api.services.journal_two.broker import snaptrade_client as snap
    st = _load_state()
    if not st.get("user_id"):
        print("No registered user. Run `register` first.")
        sys.exit(1)
    uid, secret = st["user_id"], st["user_secret"]
    accounts = await snap.list_accounts(uid, secret)
    print(f"accounts: {len(accounts)}")
    for a in accounts:
        acc_id = a.get("id")
        print(f"\n-- account {acc_id} | {a.get('institution_name')} | {a.get('name')}")
        bals = await snap.get_balances(uid, secret, acc_id)
        print(f"   balances: {json.dumps(bals, default=str)[:400]}")
        pos = await snap.get_positions(uid, secret, acc_id)
        print(f"   positions: {len(pos)}")
        for p in pos[:5]:
            print(f"     {json.dumps(p, default=str)[:200]}")
        acts = await snap.get_activities(uid, secret, acc_id)
        data = acts.get("data", [])
        print(f"   activities: {len(data)}")
        for x in data[:5]:
            print(f"     {json.dumps(x, default=str)[:200]}")
    if not accounts:
        print("(no accounts yet — finish the portal flow, then re-run `data`)")


async def cmd_cleanup() -> None:
    from api.services.journal_two.broker import snaptrade_client as snap
    st = _load_state()
    if not st.get("user_id"):
        print("Nothing to clean up.")
        return
    await snap.delete_user(st["user_id"])
    STATE.unlink(missing_ok=True)
    print(f"Deleted SnapTrade user {st['user_id']} + removed local state.")


def main() -> None:
    cmd = (sys.argv[1] if len(sys.argv) > 1 else "status").lower()
    if cmd == "status":
        cmd_status()
    elif cmd == "crypto":
        cmd_crypto()
    elif cmd == "register":
        asyncio.run(cmd_register())
    elif cmd == "portal":
        asyncio.run(cmd_portal())
    elif cmd == "sandbox":
        asyncio.run(cmd_sandbox())
    elif cmd == "data":
        asyncio.run(cmd_data())
    elif cmd == "cleanup":
        asyncio.run(cmd_cleanup())
    elif cmd == "all":
        cmd_status()
        print("\n" + "=" * 50 + "\n")
        cmd_crypto()
        print("\n" + "=" * 50 + "\n")
        asyncio.run(cmd_register())
        print("\n" + "=" * 50 + "\n")
        asyncio.run(cmd_portal())
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
