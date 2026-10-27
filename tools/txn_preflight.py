"""Trade Exchange News — preflight a service's configuration WITHOUT printing it.

    railway run -s trade-exchange-news-receiver -- python tools/txn_preflight.py --role receiver
    railway run -s web -- python tools/txn_preflight.py --role web [--r2-write-check]

Checks, and prints only names, booleans and counts (never a value):
  * every variable the role needs is set; digests are 64 hex characters;
  * the receiver's dark/permission switches are in the state the runbook step expects;
  * R2: the bucket answers a LIST under the journal prefix, and its lifecycle
    configuration expires that prefix (the retention the recovery floor assumes);
  * --r2-write-check (web): this credential can PUT (it must, for the repair pass)
    — writes one canary object under ``trade-exchange-news/v1/preflight/``, a prefix
    the reconciler never reads.
Exit 0 = ready for the step; 1 = not ready (each reason printed).
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time

JOURNAL_VARS = ("TXN_JOURNAL", "TXN_JOURNAL_ENDPOINT_URL", "TXN_JOURNAL_ACCESS_KEY_ID",
                "TXN_JOURNAL_SECRET_ACCESS_KEY", "TXN_JOURNAL_BUCKET")
REQUIRED = {
    "receiver": ("TXN_WEBHOOK_TOKEN_SHA256", "TXN_INGEST_TOKEN", *JOURNAL_VARS),
    "web": ("TXN_INGEST_TOKEN_SHA256", *JOURNAL_VARS),
}
DIGEST_VARS = ("TXN_WEBHOOK_TOKEN_SHA256", "TXN_INGEST_TOKEN_SHA256")
SWITCHES = {
    "receiver": ("TXN_RECEIVER_ENABLED", "TXN_STORAGE_PERMISSION_CONFIRMED"),
    "web": ("TXN_ENABLED", "TXN_STORAGE_PERMISSION_CONFIRMED", "ALERT_NEWS_MATCH_ENABLED"),
}
PREFIX = "trade-exchange-news/v1/events"


def check(role: str, env: dict[str, str], r2_write: bool = False, client=None) -> list[str]:
    problems: list[str] = []
    for name in REQUIRED[role]:
        if not env.get(name):
            problems.append(f"missing {name}")
    for name in DIGEST_VARS:
        if name in REQUIRED[role] and env.get(name):
            bad = [d for d in env[name].split(",") if not re.fullmatch(r"[0-9a-f]{64}", d.strip())]
            if bad:
                problems.append(f"{name}: {len(bad)} entry(ies) are not 64-hex sha256 digests")
    if env.get("TXN_JOURNAL") and env.get("TXN_JOURNAL") != "s3":
        problems.append("TXN_JOURNAL must be s3 on Railway")
    for name in SWITCHES[role]:
        print(f"switch {name} = {'on' if env.get(name) == '1' else 'off'}")
    if problems:
        return problems
    if client is None:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "services", "trade_exchange_news_receiver"))
        from txn_journal import s3_client_from_env
        client = s3_client_from_env(env)
    bucket = env["TXN_JOURNAL_BUCKET"]
    prefix = env.get("TXN_JOURNAL_PREFIX") or PREFIX
    try:
        page = client.list_objects_v2(Bucket=bucket, Prefix=prefix + "/", MaxKeys=5)
        print(f"r2 list ok: {page.get('KeyCount', len(page.get('Contents', []) or []))} object(s) visible (≤5 shown)")
    except Exception as e:  # noqa: BLE001
        problems.append(f"r2 list failed: {type(e).__name__}")
        return problems
    try:
        rules = client.get_bucket_lifecycle_configuration(Bucket=bucket).get("Rules", [])
        days = [r.get("Expiration", {}).get("Days") for r in rules
                if r.get("Status") == "Enabled" and prefix.startswith((r.get("Filter", {}) or {}).get("Prefix", r.get("Prefix", "")) or "")]
        days = [d for d in days if d]
        if not days:
            problems.append("no enabled lifecycle rule expires the journal prefix")
        else:
            print(f"r2 lifecycle: journal prefix expires after {min(days)} day(s)")
            if min(days) < 8:
                problems.append("journal lifecycle is shorter than 8 days (recovery floor assumes >= history + 1 day)")
    except Exception as e:  # noqa: BLE001
        problems.append(f"r2 lifecycle unreadable: {type(e).__name__}")
    if r2_write:
        key = f"trade-exchange-news/v1/preflight/{int(time.time())}.txt"
        try:
            client.put_object(Bucket=bucket, Key=key, Body=b"preflight canary", ContentType="text/plain")
            print("r2 write ok (canary written under trade-exchange-news/v1/preflight/)")
        except Exception as e:  # noqa: BLE001
            problems.append(f"r2 write failed: {type(e).__name__} (web's repair pass needs Object Read & Write)")
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--role", choices=sorted(REQUIRED), required=True)
    ap.add_argument("--r2-write-check", action="store_true")
    args = ap.parse_args(argv)
    problems = check(args.role, dict(os.environ), r2_write=args.r2_write_check)
    for p in problems:
        print(f"NOT READY: {p}")
    print("READY" if not problems else f"{len(problems)} problem(s)")
    return 0 if not problems else 1


if __name__ == "__main__":
    raise SystemExit(main())
