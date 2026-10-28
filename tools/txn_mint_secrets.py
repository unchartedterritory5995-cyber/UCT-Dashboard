"""Mint the two Trade Exchange News secrets WITHOUT printing either.

    python tools/txn_mint_secrets.py --out C:/Users/<you>/txn-secrets.json

Writes, to ``--out`` (which must be OUTSIDE this repository, and must not exist):
  * ``webhook_token``  -- the path segment of the Trade Exchange destination URL
                          (the owner pastes ``https://<receiver-domain>/hook/<token>``
                          into the Trade Exchange dashboard; nobody else sees it);
  * ``ingest_token``   -- the receiver's bearer to web (set as TXN_INGEST_TOKEN on
                          the receiver service only).

Prints ONLY the SHA-256 digests, which are what the services hold:
  receiver: TXN_WEBHOOK_TOKEN_SHA256=<digest>
  web:      TXN_INGEST_TOKEN_SHA256=<digest>

Rotation: mint a new pair, set ``old,new`` digests (both live), move the sender
to the new URL, then remove the old digest. Delete the file once both values
are in Railway / the Trade Exchange dashboard.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import secrets
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]


def mint() -> dict[str, str]:
    # 32 random bytes = 256 bits each; urlsafe so the token is a valid path segment.
    return {"webhook_token": "txn_" + secrets.token_urlsafe(32),
            "ingest_token": secrets.token_urlsafe(32)}


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", required=True, help="new file OUTSIDE the repo")
    args = ap.parse_args(argv)
    out = pathlib.Path(args.out).resolve()
    if out == REPO or REPO in out.parents:
        print("refusing: --out is inside the repository (secrets must never be committed)")
        return 2
    if out.exists():
        print("refusing: --out already exists (never overwrite a live secret)")
        return 2
    pair = mint()
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(pair, fh)
    print(f"wrote 2 secrets to {out} (not shown)")
    print(f"receiver: TXN_WEBHOOK_TOKEN_SHA256={digest(pair['webhook_token'])}")
    print(f"web:      TXN_INGEST_TOKEN_SHA256={digest(pair['ingest_token'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
