"""Generate the RSA-4096 keypair that encrypts every backup leaving the web pod.

    python tools/gen_backup_keypair.py --out D:\\offline\\uct-backup-private.pem
    python tools/gen_backup_keypair.py --out ~/offline/uct-backup-private.pem --passphrase-env UCT_KEY_PASS

Writes the PRIVATE key (PKCS#8 PEM) to ``--out`` and prints ONLY the PUBLIC key, base64-encoded
on one line, to stdout -- that line is the value for the ``BACKUP_PUBLIC_KEY`` variable on
Railway's ``web`` service. The private key is never printed.

Refusals (exit 2, nothing written, nothing printed to stdout):
  * ``--out`` already exists (a keypair is never silently replaced: the old private key may be
    the only thing that can read backups already in R2);
  * ``--out`` is inside this repository (a private key must never be one ``git add`` away
    from GitHub).

⛔ The private key lives OFFLINE: the owner's machine plus a copy in the password manager.
NEVER on Railway, never in the repo, never in a chat or a ticket.
Runbook: docs/runbooks/backup-encryption.md.

``--passphrase-env NAME`` encrypts the private key PEM with the passphrase held in that
environment variable (restore tools then read it from ``BACKUP_PRIVATE_KEY_PASSPHRASE``).
"""
from __future__ import annotations

import argparse
import base64
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
KEY_BITS = 4096


def _inside_repo(path: Path) -> bool:
    try:
        path.resolve().relative_to(REPO.resolve())
        return True
    except ValueError:
        return False


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", required=True, help="where to write the PRIVATE key PEM (outside the repo)")
    ap.add_argument("--passphrase-env", help="encrypt the private key with the passphrase in this env var")
    args = ap.parse_args(argv)

    out = Path(os.path.expanduser(args.out))
    if out.exists():
        print(f"REFUSED: {out} already exists; a keypair is never overwritten", file=sys.stderr)
        return 2
    if _inside_repo(out):
        print(f"REFUSED: {out} is inside the repository {REPO}; the private key must live offline",
              file=sys.stderr)
        return 2
    passphrase = None
    if args.passphrase_env:
        passphrase = os.environ.get(args.passphrase_env, "")
        if not passphrase:
            print(f"REFUSED: --passphrase-env {args.passphrase_env} is unset or empty", file=sys.stderr)
            return 2

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=KEY_BITS)
    enc = (serialization.BestAvailableEncryption(passphrase.encode("utf-8")) if passphrase
           else serialization.NoEncryption())
    priv = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, enc)
    pub = key.public_key().public_bytes(serialization.Encoding.PEM,
                                        serialization.PublicFormat.SubjectPublicKeyInfo)

    out.parent.mkdir(parents=True, exist_ok=True)
    # O_EXCL: if something appeared at `out` since the check above, refuse rather than clobber.
    fd = os.open(str(out), os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(priv)
    print(f"private key written to {out} -- move a copy into the password manager; never put it on "
          f"Railway. The line on stdout is BACKUP_PUBLIC_KEY.", file=sys.stderr)
    print(base64.b64encode(pub).decode("ascii"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
