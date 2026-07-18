"""One-shot: preserve the newest PRE-purge auth.db backup outside the prune window.

Context (2026-07-18): the legacy pattern_* purge permanently removes ~15 GB of
historical pattern detections from auth.db. Every R2 backup taken before the
purge still contains them, but ``authdb_backup._prune`` keeps only the newest
``AUTHDB_BACKUP_KEEP`` (default 14) objects under ``authdb/backup/`` — at ~5
backups/day the last pre-purge copy falls off in ~3 days. This tool server-side
copies the newest backup to ``authdb/archive/pre_pattern_purge_<ts>.db.gz``,
which the pruner never touches. Run it BEFORE the purge (or at least before the
pre-purge backups age out). Idempotent — re-runs skip if already archived.

  railway ssh -s web "/opt/venv/bin/python /app/tools/archive_authdb_backup.py"
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ARCHIVE_PREFIX = "authdb/archive/"


def main() -> int:
    from api.services import data_sync
    from api.services.authdb_backup import KEY_PREFIX

    client = data_sync._client()
    bucket = data_sync._bucket()
    if not (client and bucket):
        print("R2 creds/bucket missing — cannot archive")
        return 1

    resp = client.list_objects_v2(Bucket=bucket, Prefix=KEY_PREFIX)
    objs = sorted(resp.get("Contents", []) or [], key=lambda o: o["Key"], reverse=True)
    if not objs:
        print(f"no backups found under {KEY_PREFIX}")
        return 1
    print(f"{len(objs)} backups under {KEY_PREFIX}; newest 3:", flush=True)
    for o in objs[:3]:
        print(f"  {o['Key']}  {o['Size'] / 1e9:.2f} GB  {o['LastModified']}", flush=True)

    src = objs[0]
    dst_key = ARCHIVE_PREFIX + "pre_pattern_purge_" + src["Key"].rsplit("/", 1)[-1]

    existing = client.list_objects_v2(Bucket=bucket, Prefix=ARCHIVE_PREFIX)
    for e in existing.get("Contents", []) or []:
        if e["Key"] == dst_key:
            print(f"already archived: {dst_key} ({e['Size'] / 1e9:.2f} GB) — nothing to do")
            return 0

    print(f"archiving {src['Key']} -> {dst_key} …", flush=True)
    # client.copy = boto3's managed transfer — multipart under the hood, so a
    # >5 GB gz (plain copy_object's ceiling) still works.
    client.copy({"Bucket": bucket, "Key": src["Key"]}, bucket, dst_key)
    head = client.head_object(Bucket=bucket, Key=dst_key)
    print(f"ARCHIVED OK: {dst_key} ({head['ContentLength'] / 1e9:.2f} GB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
